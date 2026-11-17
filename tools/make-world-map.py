#!/usr/bin/env python3
"""tools/make-world-map.py — builds public/assets/stats/world.json (the map of the admin statistics) from Natural Earth.

Source (public domain): https://github.com/nvkelso/natural-earth-vector  geojson/ne_110m_admin_0_countries.geojson
Usage:  python3 tools/make-world-map.py ne_110m_admin_0_countries.geojson
Output: {"viewBox": "0 0 360 142", "countries": {"IT": {"n": "Italy", "d": "M... Z"}, ...}}
Projection: equirectangular, x = lon + 180, y = 84 - lat (Antarctica is left out: nobody visits from there).
"""
import json, sys

src = sys.argv[1] if len(sys.argv) > 1 else 'ne_110m_admin_0_countries.geojson'
data = json.load(open(src, encoding='utf-8'))
out = {}
fmt = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')
for f in data['features']:
    p = f['properties']
    code = p.get('ISO_A2_EH') or p.get('ISO_A2')
    if not code or code in ('-99', 'AQ'):
        continue
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    d = ''
    for poly in polys:
        for ring in poly:
            pts = [(round(lon + 180, 1), round(84 - lat, 1)) for lon, lat in ring]
            # drop consecutive duplicates after rounding
            clean = [pts[0]] + [q for i, q in enumerate(pts[1:], 1) if q != pts[i - 1]]
            if len(clean) < 3:
                continue
            d += 'M' + 'L'.join(f'{fmt(x)} {fmt(y)}' for x, y in clean) + 'Z'
    if d:
        if code in out:
            out[code]['d'] += d
        else:
            out[code] = {'n': p.get('NAME_EN') or p.get('NAME'), 'd': d}
json.dump({'viewBox': '0 0 360 142', 'countries': dict(sorted(out.items()))}, open('public/assets/stats/world.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'countries,', sum(len(v['d']) for v in out.values()) // 1024, 'KB of paths')
