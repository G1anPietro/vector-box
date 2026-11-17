// tools/sprite-sheet.js — draws the sprite sheet of sprite-sheet.html (static, no server).
(function () {
    const R = self.Rogue, A = R.art, out = document.getElementById('out'), q = new URLSearchParams(location.search), only = q.get('only');
    const floor = q.get('floor') || '#0a0f0c', fallbacks = [];
    let total = 0;
    const el = (t, c, p, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; if (p) p.appendChild(e); return e; };
    const L = (v) => (v && (v.en || v)) || '';
    function draw(host, name, col, frame, px, bg) {
        const c = document.createElement('canvas'); c.width = c.height = 16; c.style.width = c.style.height = px + 'px'; c.style.background = bg || floor;
        c.getContext('2d').drawImage(A.sprite(name, col, frame), 0, 0); host.appendChild(c);
    }
    function cell(g, label, name, col) {
        if (q.get('f') && !label.includes(q.get('f'))) return;
        const r = A.resolve(name), exact = r.exact && r.kind === 'art', c = el('div', 'c' + (r.kind === 'missing' ? ' miss' : exact ? '' : ' fb'), g), row = el('div', 'r', c);
        draw(row, name, col, 0, 64); draw(row, name, col, 1, 64); draw(row, name, col, 0, 16); draw(row, name, col, 0, 24); draw(row, name, col, 0, 36);
        el('div', 'n', c, label);
        if (!exact) { el('div', 'f', c, '-> ' + r.key + ' (' + r.kind + ')'); fallbacks.push(label + ' -> ' + r.key + ' (' + r.kind + ')'); }
        total++;
    }
    const sec = (t) => { el('h2', '', out, t); return el('div', 'g', out); };
    if (!only || only === 'heroes') { const g = sec('Heroes'); for (const c of R.classes.CLASSES) cell(g, c.id, A.chain(c, 'h'), c.col); }
    if (!only || only === 'mobs') {
        const g = sec('Monsters (* = boss)');
        for (const d of R.mobs.LIST) cell(g, (d.boss ? '* ' : '') + d.id + ' (' + L(d.name) + ')', A.chain(d, 'm'), d.col);
    }
    if (!only || only === 'items') {
        const g = sec('Items');
        for (const d of R.items.LIST) { const c = R.items.CATS[d.cat]; cell(g, d.id + ' [' + d.cat + ']', A.chain(Object.assign({}, d, { shape: d.shape || c.shape }), 'i'), d.col || c.col || '#c9d6e3'); }
        const g2 = sec('Categories (what an unknown item looks like)');
        for (const k of Object.keys(R.items.CATS)) cell(g2, k, R.items.CATS[k].shape, R.items.CATS[k].col || '#c9d6e3');
        const g3 = sec('Unknown-item looks (can / usb / script / plugin)');
        for (const k of ['drink', 'usb', 'script', 'plugin']) R.items.LOOKS[k].slice(0, 6).forEach((l) => cell(g3, k + ' ' + L(l[0]), R.items.CATS[k].shape, l[1]));
    }
    if (!only || only === 'keys') {
        const g = sec('Every drawing, by key (tint = amber)');
        for (const k of A.keys().sort()) cell(g, k, k, '#ffb000');
        const g2 = sec('Old 8x8 pictures of sprites.js not redrawn');
        for (const k of Object.keys(R.sprites)) if (!A.def(k)) cell(g2, k, k, '#8fb4e8');
    }
    if (!only || only === 'strip') {
        const g = sec('On the floor of every sector, 24 px: hero, monsters of the sector, boss');
        R.mobs.SECTORS.forEach((s, i) => {
            const d = el('div', 'strip', g); d.style.background = s.floor; d.style.padding = '4px'; d.title = s.id; d.style.width = '100%';
            draw(d, A.chain(R.classes.CLASSES[i % R.classes.CLASSES.length], 'h'), R.classes.CLASSES[i % R.classes.CLASSES.length].col, 0, 24, s.floor);
            R.mobs.LIST.filter((m) => (m.floors && m.floors[0] >= i * 5 + 1 && m.floors[0] <= i * 5 + 5) || m.boss === (i + 1) * 5).forEach((m) => draw(d, A.chain(m, 'm'), m.col, 0, 24, s.floor));
        });
    }
    document.getElementById('sum').textContent = '— ' + total + ' shown, ' + fallbacks.length + ' via fallback';
    if (fallbacks.length) { el('h2', '', out, 'Fallbacks'); el('pre', 'f', out, fallbacks.join('\n')); }
})();
