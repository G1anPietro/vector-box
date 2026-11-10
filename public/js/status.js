// public/js/status.js
// STATUS window: polls api/status.php every 30s, only while the window is open.
document.addEventListener("DOMContentLoaded", () => {
    const win = document.getElementById('win-status');
    const body = document.getElementById('status-body');
    if (!win || !body) return;

    const fmtUptime = (s) => {
        if (s === null || s === undefined) return 'n/a';
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    };

    const bar = (pct) => {
        if (pct === null || pct === undefined) return 'n/a';
        const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
        return `[${'#'.repeat(filled)}${'.'.repeat(10 - filled)}] ${pct}%`;
    };

    const row = (label, value, color) => {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex; justify-content:space-between; gap:12px; padding:2px 0; font-family:monospace; font-size:0.82rem;';
        const l = document.createElement('span');
        l.className = 'term-muted';
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = value;
        if (color) v.style.color = color;
        line.appendChild(l);
        line.appendChild(v);
        return line;
    };

    const render = (data, pingMs) => {
        body.replaceChildren();
        body.appendChild(row('LINK', pingMs !== null ? `ONLINE // ${pingMs} ms` : 'OFFLINE', pingMs !== null ? '#33ff77' : '#ff3333'));
        if (!data) return;

        body.appendChild(row('UPTIME', fmtUptime(data.uptime_seconds)));
        if (Array.isArray(data.load)) {
            const perCpu = data.cpus ? ` (${data.cpus} cpu)` : '';
            body.appendChild(row('LOAD 1/5/15', `${data.load.join(' / ')}${perCpu}`));
        }
        body.appendChild(row('MEMORY', bar(data.mem_used_pct)));

        if (Array.isArray(data.services) && data.services.length) {
            const hdr = document.createElement('div');
            hdr.className = 'term-muted';
            hdr.style.cssText = 'margin-top:8px; font-size:0.75rem; letter-spacing:1px;';
            hdr.textContent = '-- SERVICES --';
            body.appendChild(hdr);
            data.services.forEach((s) => {
                body.appendChild(row(String(s.name), s.up ? `UP // ${s.ms} ms` : 'DOWN', s.up ? '#33ff77' : '#ff3333'));
            });
        }

        const age = Math.max(0, Math.round(Date.now() / 1000 - (data.generated_at || 0)));
        const foot = document.createElement('div');
        foot.className = 'term-muted';
        foot.style.cssText = 'margin-top:8px; font-size:0.7rem; opacity:0.7;';
        foot.textContent = `sampled ${age}s ago`;
        body.appendChild(foot);
    };

    let lastRefresh = 0;
    const refresh = async () => {
        if (win.classList.contains('hidden')) return;
        // class changes also happen on focus/drag: don't refetch more than every 5s
        if (Date.now() - lastRefresh < 5000) return;
        lastRefresh = Date.now();
        const t0 = performance.now();
        try {
            const res = await fetch('api/status.php', { cache: 'no-store' });
            const pingMs = Math.round(performance.now() - t0);
            const data = await res.json();
            render(data && data.success ? data : null, pingMs);
        } catch (err) {
            render(null, null);
        }
    };

    // Refresh immediately when the window becomes visible, then every 30s while open
    new MutationObserver(() => {
        if (!win.classList.contains('hidden')) refresh();
    }).observe(win, { attributes: true, attributeFilter: ['class'] });

    setInterval(refresh, 30000);
    refresh();
});
