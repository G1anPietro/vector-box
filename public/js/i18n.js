// public/js/i18n.js — translations for the plain .html pages and for the scripts (the PHP pages use pageLang() / tr() instead).
//
// HOW IT WORKS
//  - The text written in the HTML is ENGLISH (the default). A page lists its Italian texts with VBI18N.add('it', { key: 'testo', ... }).
//  - Elements with data-i18n="key" get their text replaced when the language is not English; data-i18n-attr="aria-label:key;title:key2"
//    does the same for attributes (<title> and <meta name=description> work too). Only textContent is set, never HTML.
//  - Scripts that build text themselves call VBLang.t('key', {n: 3}) ("{n}" in the text is replaced). Add the English text with
//    VBI18N.add('en', {...}); a missing text falls back to English, then to the key itself.
//  - Which language: ?lang=xx, then the vb_lang cookie (both are an explicit choice), then what api/lang.php says (Italy -> Italian,
//    otherwise the browser's language, otherwise English; the same rules as the PHP pages). Until the answer comes, the browser's own
//    language is used, and the page stays hidden for at most one second so nobody sees the wrong language flash.
//  - A small EN | IT switch is added to any element with id="vb-lang" (or fixed at the top right if there is none and data-lang-switch is on <html>).
// To add a language: add its code to SUPPORTED here and to SITE_LANGS in api/helpers.php, then translate the dictionaries.
(function (root) {
    'use strict';
    const SUPPORTED = ['en', 'it'];
    const dict = {};
    const add = (lang, texts) => { dict[lang] = Object.assign(dict[lang] || {}, texts); };
    const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : String(text));
    /** The text for a key in a language: that language, else English, else the key. */
    const translate = (lang, key, vars) => fill((dict[lang] && dict[lang][key]) || (dict.en && dict.en[key]) || key, vars);
    /** Best supported language of a browser's list ("it-IT", "en-US"...), or null. */
    const fromBrowser = (list) => {
        for (const l of list || []) { const c = String(l).slice(0, 2).toLowerCase(); if (SUPPORTED.includes(c)) return c; }
        return null;
    };
    const api = { SUPPORTED, add, translate, fromBrowser, fill, dict };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

    const doc = root.document;
    const here = doc.currentScript ? doc.currentScript.src : '';       // where this script came from (document.currentScript is gone later)
    const readCookie = () => { const m = /(?:^|;\s*)vb_lang=([a-z]{2})/.exec(doc.cookie || ''); return m && SUPPORTED.includes(m[1]) ? m[1] : null; };
    const writeCookie = (l) => { try { doc.cookie = 'vb_lang=' + l + '; max-age=31536000; path=/; samesite=lax' + (root.location.protocol === 'https:' ? '; secure' : ''); } catch (e) { /* cookies off */ } };
    const queryLang = () => { const m = /[?&]lang=([a-z]{2})/.exec(root.location.search || ''); return m && SUPPORTED.includes(m[1]) ? m[1] : null; };

    // A PHP page says which language it was written in (<meta name="vb-lang">, from pageLang()): nothing to ask the server, and a switch reloads the page.
    const metaEl = doc.querySelector('meta[name="vb-lang"]');
    const serverLang = metaEl && SUPPORTED.includes(metaEl.content) ? metaEl.content : null;
    let lang = serverLang || queryLang() || readCookie() || fromBrowser(root.navigator && (navigator.languages || [navigator.language])) || 'en';
    const explicit = !!(serverLang || queryLang() || readCookie());
    if (queryLang()) writeCookie(queryLang());
    doc.documentElement.classList.add('i18n-pending');
    const style = doc.createElement('style');
    style.textContent = 'html.i18n-pending body { visibility: hidden; }'                   // hidden until the right language is on (one second at most)
        + '.vb-lang { display: inline-flex; gap: 4px; }'
        + '.vb-lang button { min-width: 38px; min-height: 32px; padding: 2px 8px; background: rgba(0,0,0,.55); color: #e8e6f0; border: 1px solid #3a3550; border-radius: 6px; font: inherit; font-size: .75rem; cursor: pointer; }'
        + '.vb-lang button[aria-pressed="true"] { border-color: #00ff66; color: #00ff66; }'
        + '.vb-lang-fixed { position: fixed; top: calc(6px + env(safe-area-inset-top, 0px)); right: calc(6px + env(safe-area-inset-right, 0px)); z-index: 50; }';
    doc.head.appendChild(style);

    function apply(scope) {
        const host = scope || doc;
        doc.documentElement.lang = lang;
        host.querySelectorAll('[data-i18n]').forEach((e) => {
            if (e.dataset.i18nEn === undefined) e.dataset.i18nEn = e.textContent;              // the English text written in the HTML
            e.textContent = lang === 'en' && !(dict.en && dict.en[e.dataset.i18n]) ? e.dataset.i18nEn : translate(lang, e.dataset.i18n);
        });
        host.querySelectorAll('[data-i18n-attr]').forEach((e) => {
            e.dataset.i18nAttr.split(';').forEach((pair) => {
                const [attr, key] = pair.split(':').map((x) => x.trim());
                if (!attr || !key) return;
                const keep = 'i18nEn' + attr.replace(/(^|-)(\w)/g, (m, a, c) => c.toUpperCase());
                if (e.dataset[keep] === undefined) e.dataset[keep] = e.getAttribute(attr) || '';
                e.setAttribute(attr, lang === 'en' && !(dict.en && dict.en[key]) ? e.dataset[keep] : translate(lang, key));
            });
        });
        const t = doc.querySelector('title[data-i18n]');
        if (t) doc.title = t.textContent;
    }

    function ready() { doc.documentElement.classList.remove('i18n-pending'); }

    function setLang(l, remember) {
        if (!SUPPORTED.includes(l)) return;
        if (remember) writeCookie(l);
        if (serverLang && l !== serverLang) {                                              // PHP pages: the text came from the server, so load it again
            const u = new URL(root.location.href); u.searchParams.delete('lang');
            const go = () => root.location.replace(u.href);
            // a logged-in person: the account remembers it (e-mails follow it); the server ignores visitors without an account
            if (remember && root.fetch) fetch(new URL('../api/lang.php', here || root.location.href).href, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).then(go, go); else go();
            return;
        }
        lang = l;
        apply();
        mountSwitch();
        root.dispatchEvent(new CustomEvent('vb-lang', { detail: { lang: l } }));
    }

    function mountSwitch() {
        let host = doc.getElementById('vb-lang');
        if (!host && doc.documentElement.hasAttribute('data-lang-switch')) {
            host = doc.createElement('div'); host.id = 'vb-lang'; host.className = 'vb-lang-fixed'; doc.body.appendChild(host);
        }
        if (!host) return;
        host.textContent = '';
        host.className = (host.className.replace(/\bvb-lang\b/g, '') + ' vb-lang').trim();
        SUPPORTED.forEach((l) => {
            const b = doc.createElement('button');
            b.type = 'button'; b.textContent = l.toUpperCase(); b.lang = l;
            b.setAttribute('aria-pressed', String(l === lang)); b.setAttribute('aria-label', l === 'it' ? 'Italiano' : 'English');
            b.addEventListener('click', () => setLang(l, true));
            host.appendChild(b);
        });
    }

    root.VBI18N = { add, dict };
    root.VBLang = { get lang() { return lang; }, get server() { return !!serverLang; }, t: (key, vars) => translate(lang, key, vars), set: (l) => setLang(l, true), apply, add, SUPPORTED };

    const start = () => {
        apply(); mountSwitch(); ready();
        if (explicit || !root.fetch) return;
        // no explicit choice: ask the server (Italy -> Italian, otherwise the browser's language, otherwise English)
        const url = new URL('../api/lang.php', here || root.location.href).href;
        fetch(url, { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { if (j && SUPPORTED.includes(j.lang) && j.lang !== lang) setLang(j.lang, false); }).catch(() => { /* keep the browser's language */ });
    };
    // the script runs in <head> before the body exists: wait for it
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
    root.setTimeout(ready, 1000);                                                       // never leave the page hidden
})(typeof window !== 'undefined' ? window : globalThis);
