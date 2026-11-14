// public/js/dropzone.js — drag files anywhere on a page: while files are over the window a see-through layer appears with a
// dashed frame and "Mettili qui"; letting go hands the files to onFiles(files). No special zone is needed on the page.
//   VBDrop.attach({ label: 'Mettili qui', hint: 'per caricarli', onFiles(files) {} })   (css/dropzone.css)
(() => {
    'use strict';
    const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');

    function attach({ label = 'Mettili qui', hint = '', onFiles }) {
        const layer = document.createElement('div');
        layer.className = 'vbd';
        layer.setAttribute('aria-hidden', 'true');
        const frame = document.createElement('div');
        frame.className = 'vbd-frame';
        const big = document.createElement('b');
        big.textContent = label;
        frame.append(big);
        if (hint) { const small = document.createElement('span'); small.textContent = hint; frame.append(small); }
        layer.append(frame);
        document.body.append(layer);

        let depth = 0;
        const show = (on) => layer.classList.toggle('on', on);
        window.addEventListener('dragenter', (ev) => { if (!hasFiles(ev)) return; depth++; show(true); });
        window.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
        window.addEventListener('dragleave', (ev) => { if (!hasFiles(ev)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
        window.addEventListener('drop', (ev) => {
            if (!hasFiles(ev)) return;
            ev.preventDefault();            // never let the browser open the file instead
            depth = 0; show(false);
            const files = Array.from(ev.dataTransfer.files || []);
            if (files.length) onFiles(files);
        });
        window.addEventListener('dragend', () => { depth = 0; show(false); });
    }

    window.VBDrop = { attach };
})();
