// js/condiviso.js — the page of a temporary link: shows one file / document / note (api/condividi.php), no login.
(() => {
    'use strict';
    const C = window.AppuntiCommon;
    const { el } = C;
    const $ = (s) => document.querySelector(s);
    const token = new URLSearchParams(location.search).get('t') || '';
    const api = (extra = '') => `../api/condividi.php?t=${encodeURIComponent(token)}${extra}`;
    const when = (t) => new Date(t * 1000).toLocaleString(VBLang.t('locale'), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

    function gone(msg) {
        $('#s-title').textContent = VBLang.t('invalid_link');
        $('#s-body').replaceChildren(el('p', { class: 'empty', text: msg || VBLang.t('this_link_no_longer_exists_or') }));
    }

    async function init() {
        let info;
        try {
            const r = await fetch(api('&action=info'));
            info = await r.json();
            if (!r.ok || !info.success) { gone(r.status === 429 ? VBLang.t('too_many_requests_try_again_in') : null); return; }
        } catch (e) { gone(VBLang.t('can_t_connect_try_again')); return; }
        document.title = info.title + VBLang.t('shared_notes');
        $('#s-title').textContent = info.title;
        $('#s-meta').textContent = VBLang.t('the_link_is_valid_until') + when(info.expires_at) + '.';
        const actions = $('#s-actions');
        const body = $('#s-body');
        const shareLink = el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('share_the_link'), onclick: async () => {
            await C.shareOut({ title: info.title, text: info.title, url: location.href });
        } });
        if (info.kind === 'file') {
            const fileUrl = api('&action=file');
            const dl = el('a', { class: 'ghost-link ico-dl', href: fileUrl + '&dl=1', download: info.name, text: VBLang.t('download') });
            actions.append(dl, shareLink);
            $('#s-meta').textContent = VBLang.t('the_link_is_valid_until_2', { name: info.name, size: C.sizeText(info.size), date: when(info.expires_at) });
            if (info.mime.startsWith('image/') && !/heic|heif/.test(info.mime)) {
                const img = el('img', { class: 'pv-img', src: fileUrl, alt: info.name });
                const box = el('div', { class: 'shared-img' }, img);
                actions.append(C.fullButton(() => box));
                body.append(box);
                C.enableZoom(box, img);
            } else if (info.mime.startsWith('audio/')) {
                body.append(el('audio', { class: 'pv-audio', controls: true, preload: 'metadata', src: fileUrl }));
            } else if (info.mime === 'application/pdf' && window.AppuntiPdf) {
                const box = el('div', { class: 'shared-pdf' }, window.AppuntiPdf.view(fileUrl, info.name));
                actions.append(C.fullButton(() => box));
                body.append(box);
            } else if (!info.text) {
                body.append(el('p', { class: 'empty', text: VBLang.t('there_is_no_preview_download_the') }));
            }
            if (info.text) body.append(el('div', { class: 'pv-transcript' }, el('p', { class: 'muted small', text: VBLang.t('text_of_the_file') }),
                C.looksLikeMarkdown(info.text) ? el('div', { class: 'md' }, C.md(info.text)) : el('div', { class: 'pv-text', text: info.text })));
        } else if (info.kind === 'doc') {
            actions.append(shareLink);
            if (info.doc_kind === 'schema') {
                body.append(C.renderSchema(info.content));
            } else {
                const f = C.markdownFile(info.title, info.content);
                const md = el('div', { class: 'md' }, C.md(info.content));
                const box = el('div', { class: 'shared-doc' }, md);
                actions.append(el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('download_md'), onclick: () => C.saveBlob(f.blob, f.name) }),
                    el('button', { type: 'button', class: 'ghost mini', text: VBLang.t('print_pdf'), onclick: () => window.print() }), C.fullButton(() => box));
                body.append(box);
                C.addIndex(md, 'shared');
            }
        } else {
            actions.append(shareLink);
            const box = el('div', { class: 'shared-doc' }, C.looksLikeMarkdown(info.body) ? el('div', { class: 'md' }, C.md(info.body)) : el('div', { class: 'pv-text', text: info.body }));
            actions.append(C.fullButton(() => box));
            body.append(box);
        }
        $('#s-foot').textContent = VBLang.t('written_by_students_and_in_part');
    }
    init();
})();
