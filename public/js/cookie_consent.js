// public/js/cookie_consent.js — the only thing on this site that needs your consent is Google advertising (AdSense).
// Everything else that the browser keeps (session, language, theme, window positions, reading progress...) is technical or
// functional: it is there because you asked for the service or chose the setting, and it never leaves your browser.
//
// So the banner appears only on pages that carry ads (<meta name="vb-ads" content="own|google">): "Reject" and "Accept" look the
// same, nothing is ticked beforehand, the choice is remembered for 6 months in the cookie vb_consent, and it can be changed any
// time with any element marked data-vb-cookie (or VBConsent.open()). Ads load only after "Accept" (see ads.js).
// With content="google" Google's own certified message does the asking instead (ADSENSE_CMP=google in .env) and this banner stays quiet.
(function () {
    'use strict';
    if (window.VBConsent) return;

    var COOKIE = 'vb_consent';
    var MAX_AGE_DAYS = 180;          // ask again after 6 months (Garante's guidelines)
    var listeners = [];

    function readCookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
        return m ? m[1] : null;
    }
    /** {ads: bool, t: ms} from the cookie text, or null when missing, damaged or older than 6 months. */
    function parse(raw, now) {
        if (!raw) return null;
        try {
            var v = JSON.parse(decodeURIComponent(raw));
            if (!v || v.v !== 1 || typeof v.t !== 'number') return null;
            if ((now || Date.now()) - v.t > MAX_AGE_DAYS * 86400000) return null;
            return { ads: v.ads === true, t: v.t };
        } catch (e) { return null; }
    }
    function get() { return parse(readCookie(COOKIE)); }
    function save(ads) {
        var value = encodeURIComponent(JSON.stringify({ v: 1, ads: !!ads, t: Date.now() }));
        var secure = location.protocol === 'https:' ? ';Secure' : '';
        document.cookie = COOKIE + '=' + value + ';max-age=' + (MAX_AGE_DAYS * 86400) + ';path=/;SameSite=Lax' + secure;
        document.cookie = 'cookie_consent=;max-age=0;path=/';     // the old banner's cookie
    }
    function has(category) { var c = get(); return !!(c && c[category]); }

    function decide(ads) {
        var before = has('ads');
        save(ads);
        removeBanner();
        listeners.forEach(function (fn) { try { fn(get()); } catch (e) { /* a listener must not break the others */ } });
        if (before && !ads) location.reload();       // withdrawn: the ad scripts are already running, a reload stops them
    }

    // ---------- the banner ----------
    var CSS = '#vb-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:560px;margin:0 auto;padding:16px;'
        + 'background:#16141c;color:#f2f2f2;border:1px solid rgba(242,242,242,.45);border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.6);'
        + 'font:15px/1.45 system-ui,sans-serif}#vb-consent h2{margin:0 0 6px;font-size:1.05em}#vb-consent p{margin:0 0 12px;color:#d6d6d6}'
        + '#vb-consent a{color:#f2c66d}#vb-consent .vb-row{display:flex;gap:10px;flex-wrap:wrap}'
        + '#vb-consent button{flex:1 1 140px;min-height:44px;padding:10px 14px;border-radius:8px;border:1px solid #f2f2f2;background:#f2f2f2;color:#16141c;'
        + 'font:inherit;font-weight:700;cursor:pointer}#vb-consent button:focus-visible{outline:3px solid #f2c66d;outline-offset:2px}';
    var bannerEl = null;
    function removeBanner() { if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl); bannerEl = null; }
    function open() {
        if (bannerEl) return;
        var it = (window.VBLang ? VBLang.lang : (document.documentElement.lang || 'en')).slice(0, 2) === 'it';
        var t = it
            ? { title: 'Pubblicità e cookie', body: 'Questo sito mostra annunci di Google solo se acconsenti: servono cookie e identificatori di Google. Tutto il resto (accesso, lingua, tema) non ha bisogno del tuo consenso. Puoi cambiare idea in ogni momento dal link "Cookie".', no: 'Rifiuta', yes: 'Accetta', more: 'Leggi la privacy' }
            : { title: 'Ads and cookies', body: 'This site shows Google ads only if you agree: they need Google cookies and identifiers. Everything else (login, language, theme) needs no consent. You can change your mind any time from the "Cookies" link.', no: 'Reject', yes: 'Accept', more: 'Read the privacy page' };
        var style = document.createElement('style'); style.textContent = CSS;
        var box = document.createElement('div');
        box.id = 'vb-consent'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', t.title);
        var h = document.createElement('h2'); h.textContent = t.title;
        var p = document.createElement('p'); p.textContent = t.body + ' ';
        var a = document.createElement('a'); a.href = (location.pathname.indexOf('/pages/') !== -1 ? '' : 'pages/') + 'privacy.php'; a.textContent = t.more; p.appendChild(a);
        var row = document.createElement('div'); row.className = 'vb-row';
        var no = document.createElement('button'); no.type = 'button'; no.textContent = t.no; no.addEventListener('click', function () { decide(false); });
        var yes = document.createElement('button'); yes.type = 'button'; yes.textContent = t.yes; yes.addEventListener('click', function () { decide(true); });
        row.appendChild(no); row.appendChild(yes);        // same look, same size: refusing is as easy as accepting
        box.appendChild(style); box.appendChild(h); box.appendChild(p); box.appendChild(row);
        document.body.appendChild(box);
        bannerEl = box;
    }

    function mode() {
        var m = document.querySelector('meta[name="vb-ads"]');
        return m ? (m.getAttribute('content') === 'google' ? 'google' : 'own') : '';
    }

    window.VBConsent = {
        get: get, has: has, open: open, mode: mode,
        onChange: function (fn) { listeners.push(fn); },
        _parse: parse,        // for the tests
    };

    // Small helpers other scripts already use (window states): functional storage, no consent needed.
    window.getSystemCookie = function (name) {
        var m = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    };
    window.setSystemCookie = function (name, value, days) {
        var d = new Date(); d.setTime(d.getTime() + (days || 30) * 86400000);
        var secure = location.protocol === 'https:' ? ';Secure' : '';
        document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' + secure;
    };

    document.addEventListener('DOMContentLoaded', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-vb-cookie]'), function (el) {
            el.addEventListener('click', function (e) { e.preventDefault(); open(); });
        });
        if (mode() === 'own' && !get()) open();
    });
})();
