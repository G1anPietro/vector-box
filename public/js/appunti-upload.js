// public/js/appunti-upload.js — the upload queue of the class notes, shared by every Appunti page.
// Files are shrunk (photos), fingerprinted (duplicates) and sent in 2 MB pieces (api/appunti.php upload_begin/chunk/commit).
// The queue lives in IndexedDB, so a lost connection, a closed tab or a reload does not lose anything: the next Appunti page
// that opens carries on from the byte where it stopped. Retries wait longer each time (2, 4, 8, 16, 30 s) and give up
// (paused, with a "Riprendi" button) after 8 failures in a row. A small box at the bottom shows the progress on every page.
//   AppuntiUpload.enqueue({ class_id, label, fields: {subject_id, kind, lesson_date, period, title, body}, files: [File] })
//   AppuntiUpload.on('done' | 'failed', (job, info) => ...)    AppuntiUpload.settings()    AppuntiUpload.setSetting(key, bool)
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el } = C;
    const DB_NAME = 'vb-appunti-up';
    const MAX_ATTEMPTS = 8;
    const BACKOFF = [2, 4, 8, 16, 30];
    const KEYS = { auto: 'vb_up_auto', wifi: 'vb_up_wifi', shrink: 'vb_up_shrink' };
    const listeners = { done: [], failed: [] };

    /* ---------- settings of this device ---------- */
    const settings = () => ({ auto: C.stored(KEYS.auto) !== '0', wifi: C.stored(KEYS.wifi) === '1', shrink: C.stored(KEYS.shrink) !== '0' });
    const setSetting = (k, on) => { C.store(KEYS[k], on ? '1' : '0'); if (k !== 'shrink') kick(); };
    /** True unless the user wants Wi-Fi only and the browser says the connection is a mobile one (only Android Chrome can tell). */
    function networkAllowed() {
        if (!navigator.onLine) return false;
        if (!settings().wifi) return true;
        const c = navigator.connection;
        if (!c || !c.type) return true;
        return ['wifi', 'ethernet', 'unknown', 'none'].includes(c.type) ? c.type !== 'none' : false;
    }

    /* ---------- storage: small job records and the files apart ---------- */
    const idb = () => new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('jobs', { keyPath: 'id' }); r.result.createObjectStore('blobs'); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    const tx = async (stores, mode, fn) => {
        const db = await idb();
        return new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode);
            let out;
            Promise.resolve(fn(t)).then((v) => { out = v; }).catch(reject);
            t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
        });
    };
    const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const saveJob = (job) => tx(['jobs'], 'readwrite', (t) => t.objectStore('jobs').put(job));
    const loadJobs = () => tx(['jobs'], 'readonly', (t) => req(t.objectStore('jobs').getAll()));
    const blobKey = (job, i) => `${job.id}:${i}`;
    const getBlob = (job, i) => tx(['blobs'], 'readonly', (t) => req(t.objectStore('blobs').get(blobKey(job, i))));
    async function removeJob(job) {
        await tx(['jobs', 'blobs'], 'readwrite', (t) => {
            t.objectStore('jobs').delete(job.id);
            job.files.forEach((f, i) => t.objectStore('blobs').delete(blobKey(job, i)));
        });
    }

    /* ---------- preparing a file: smaller photos, a fingerprint ---------- */
    async function shrinkImage(file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600 * 1024 || typeof createImageBitmap !== 'function') return file;
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            bmp.close && bmp.close();
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            if (!blob || blob.size > file.size * 0.9) return file;
            return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
        } catch (e) { return file; }
    }
    async function fingerprint(file) {
        try {
            if (!window.crypto || !crypto.subtle || file.size > 60 * 1048576) return '';
            const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
            return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { return ''; }
    }

    /* ---------- state and the box on the page ---------- */
    let jobs = [];
    let running = false;
    let state = { phase: 'idle', text: '', wait: 0 };   // idle | running | waiting | paused
    let cancelWait = null;
    let box = null;

    const totalOf = (list) => list.reduce((a, j) => a + j.files.reduce((b, f) => b + (f.duplicate ? 0 : f.size), 0), 0);
    const doneOf = (list) => list.reduce((a, j) => a + j.files.reduce((b, f) => b + (f.duplicate ? 0 : (f.received || 0)), 0), 0);

    function render() {
        if (!box) {
            box = el('div', { class: 'up-widget', role: 'status', 'aria-live': 'polite', hidden: true });
            document.body.append(box);
        }
        const live = jobs.filter((j) => j.status !== 'failed');
        const failed = jobs.filter((j) => j.status === 'failed');
        box.hidden = !jobs.length;
        if (!jobs.length) return;
        const total = totalOf(live); const done = doneOf(live);
        const pct = total ? Math.round(100 * done / total) : 0;
        const nFiles = live.reduce((a, j) => a + j.files.filter((f) => !f.duplicate).length, 0);
        const rows = [];
        if (live.length) {
            const head = state.phase === 'paused' ? 'Caricamento in pausa' : state.phase === 'waiting' ? state.text : `Carico ${nFiles} file`;
            rows.push(el('div', { class: 'up-line' }, el('b', { text: head }), el('span', { class: 'muted small', text: state.phase === 'running' ? `${pct}%` : `${pct}% fatto` })));
            rows.push(el('div', { class: 'up-bar' }, el('i', { style: `width:${pct}%` })));
            rows.push(el('div', { class: 'up-actions' },
                state.phase === 'paused' || (state.phase === 'idle' && live.length) ? el('button', { type: 'button', class: 'mini', text: 'Riprendi', onclick: () => { resume(); } }) : null,
                el('button', { type: 'button', class: 'ghost mini', text: 'Annulla', onclick: () => cancelAll(live) })));
        }
        failed.forEach((j) => rows.push(el('div', { class: 'up-line up-failed' }, el('span', { text: j.error || 'Caricamento non riuscito.' }),
            el('button', { type: 'button', class: 'ghost mini', text: 'Chiudi', onclick: async () => { await removeJob(j); jobs = jobs.filter((x) => x !== j); render(); } }))));
        box.replaceChildren(...rows);
    }
    const setState = (phase, text = '') => { state = { phase, text }; render(); };

    /* ---------- the engine ---------- */
    class Fatal extends Error {}
    class Tired extends Error {}

    const sleep = (s) => new Promise((resolve) => { const t = setTimeout(resolve, s * 1000); cancelWait = () => { clearTimeout(t); resolve(); }; });

    async function call(url, init) {
        let r;
        try { r = await fetch(url, { credentials: 'same-origin', ...init }); } catch (e) { return { status: 0, json: null }; }
        let json = null;
        try { json = await r.json(); } catch (e) { /* an error page */ }
        return { status: r.status, json };
    }
    const postJson = (body) => call('../api/appunti.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const MESSAGES = { file_too_large: 'Un file è più grande del massimo consentito.', class_full: 'La classe ha finito lo spazio.', bad_type: 'Un file non è di un tipo accettato (foto, PDF, testo, Word, PowerPoint, audio).',
        not_found: 'Il caricamento non esiste più.', restricted: 'Non puoi caricare in questo momento.', bad_file: 'File vuoto.', too_many_open: 'Troppi caricamenti iniziati e non finiti.' };

    /** Runs one request with retries: waits 2, 4, 8, 16, 30 s between failures, a refused request (4xx) is final. */
    async function withRetry(fn, onTick) {
        let attempts = 0;
        for (;;) {
            while (!networkAllowed()) { setState('waiting', navigator.onLine ? 'In attesa del Wi-Fi' : 'Senza connessione: riprendo appena torna'); await sleep(5); if (state.phase === 'paused') throw new Tired(); }
            const r = await fn();
            if (r.status >= 200 && r.status < 300 && r.json && r.json.success !== false) { attempts = 0; return r; }
            if (r.status === 409) return r;   // the caller knows what to do (a different offset, an incomplete file)
            const transient = r.status === 0 || r.status >= 500 || r.status === 429 || r.status === 408;
            if (!transient) throw new Fatal((r.json && (MESSAGES[r.json.code] || r.json.error)) || 'Caricamento non riuscito.');
            if (++attempts > MAX_ATTEMPTS) throw new Tired();
            const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
            for (let s = wait; s > 0; s--) { setState('waiting', `Connessione instabile: riprovo tra ${s} s`); await sleep(1); if (state.phase === 'paused') throw new Tired(); }
            setState('running');
            if (onTick) onTick();
        }
    }

    async function sendFile(job, i) {
        const f = job.files[i];
        const blob = await getBlob(job, i);
        if (!blob) throw new Fatal('Il file non è più disponibile: riscegli i file.');
        if (!f.upload_id) {
            const r = await withRetry(() => postJson({ action: 'upload_begin', class_id: job.class_id, name: f.name, size: f.size, sha256: f.hash || '' }));
            if (r.json.duplicate) { f.duplicate = true; f.dupName = r.json.name; await saveJob(job); return; }
            f.upload_id = r.json.upload_id; f.received = 0; f.chunk = r.json.chunk || 2097152;
            await saveJob(job);
        } else {
            // after a break: where did the server stop?
            const st = await call(`../api/appunti.php?action=upload_status&upload_id=${f.upload_id}`);
            if (st.status === 404) { f.upload_id = null; f.received = 0; await saveJob(job); return sendFile(job, i); }
            if (st.json && st.json.success) f.received = st.json.received;
        }
        while (f.received < f.size) {
            const end = Math.min(f.size, f.received + (f.chunk || 2097152));
            const piece = blob.slice(f.received, end);
            const r = await withRetry(() => {
                const fd = new FormData();
                fd.set('action', 'upload_chunk'); fd.set('upload_id', f.upload_id); fd.set('offset', String(f.received));
                fd.append('chunk', piece, 'chunk');
                return call('../api/appunti.php', { method: 'POST', body: fd });
            });
            if (r.status === 409 && r.json && r.json.code === 'offset') f.received = r.json.received;   // already there: carry on from the server's byte
            else f.received = r.json.received;
            await saveJob(job);
            render();
        }
    }

    async function runJob(job) {
        for (let i = 0; i < job.files.length; i++) {
            if (job.files[i].duplicate || job.files[i].received >= job.files[i].size && job.files[i].upload_id) continue;
            await sendFile(job, i);
        }
        const live = job.files.filter((f) => !f.duplicate);
        let id = null;
        if (live.length || (job.fields.body || '').trim()) {
            const r = await withRetry(() => postJson({ action: 'upload_commit', class_id: job.class_id, upload_ids: live.map((f) => f.upload_id), ...job.fields }));
            if (r.status === 409) { live.forEach((f) => { if (f.upload_id === (r.json && r.json.upload_id)) f.received = r.json.received; }); throw new Tired(); }
            id = r.json.id;
        }
        const dups = job.files.filter((f) => f.duplicate).map((f) => f.name);
        await removeJob(job);
        jobs = jobs.filter((j) => j !== job);
        listeners.done.forEach((fn) => fn(job, { id, duplicates: dups }));
    }

    async function loop() {
        if (running) return;
        running = true;
        try {
            for (;;) {
                const job = jobs.find((j) => j.status !== 'failed');
                if (!job) break;
                setState('running');
                try { await runJob(job); }
                catch (e) {
                    if (e instanceof Fatal) {
                        job.status = 'failed'; job.error = e.message;
                        // pieces already on the server are no use now
                        for (const f of job.files) if (f.upload_id) await postJson({ action: 'upload_cancel', upload_id: f.upload_id });
                        await saveJob(job);
                        listeners.failed.forEach((fn) => fn(job, e.message));
                        continue;
                    }
                    setState('paused'); return;     // Tired or a pause: nothing is lost, "Riprendi" carries on
                }
            }
            setState('idle');
        } finally { running = false; render(); }
    }
    function kick() { if (state.phase !== 'paused' && !running && jobs.some((j) => j.status !== 'failed')) loop(); }
    function resume() { state = { phase: 'idle', text: '' }; if (cancelWait) cancelWait(); loop(); }
    async function cancelAll(list) {
        state = { phase: 'paused', text: '' };
        if (cancelWait) cancelWait();
        for (const j of list) {
            for (const f of j.files) if (f.upload_id) postJson({ action: 'upload_cancel', upload_id: f.upload_id });
            await removeJob(j);
            jobs = jobs.filter((x) => x !== j);
        }
        state = { phase: 'idle', text: '' };
        render();
    }

    /** Adds files to the queue (shrinks and fingerprints them first) and starts sending. */
    async function enqueue({ class_id, label = '', fields, files }) {
        const job = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, class_id, label, fields, status: 'queued', created: Date.now(), files: [] };
        const prepared = [];
        for (const f of files) {
            const file = settings().shrink ? await shrinkImage(f) : f;
            prepared.push(file);
            job.files.push({ name: file.name, size: file.size, hash: await fingerprint(file), upload_id: null, received: 0 });
        }
        await tx(['jobs', 'blobs'], 'readwrite', (t) => {
            t.objectStore('jobs').put(job);
            prepared.forEach((file, i) => t.objectStore('blobs').put(file, blobKey(job, i)));
        });
        jobs.push(job);
        if (state.phase === 'paused') state = { phase: 'idle', text: '' };
        render();
        loop();
    }

    window.addEventListener('online', kick);
    if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', kick);
    window.addEventListener('beforeunload', (ev) => { if (running && state.phase === 'running') { ev.preventDefault(); ev.returnValue = ''; } });

    // Jobs left from an earlier visit: carried on by themselves, or only when asked (setting "Riprendi da solo")
    (async () => {
        try { jobs = (await loadJobs()).sort((a, b) => a.created - b.created); } catch (e) { jobs = []; }
        if (!jobs.length) return;
        if (settings().auto) loop(); else { state = { phase: 'paused', text: '' }; render(); }
    })();

    window.AppuntiUpload = {
        enqueue, settings, setSetting,
        on: (what, fn) => { listeners[what].push(fn); },
        pending: () => jobs.filter((j) => j.status !== 'failed').length,
    };
})();
