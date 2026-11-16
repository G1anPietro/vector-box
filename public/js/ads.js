// public/js/ads.js — loads Google AdSense and fills every ad unit on the page (an inline script would be blocked by the CSP).
// The ad script is fetched ONLY after the visitor accepted ads in the banner (cookie_consent.js), or at once when Google's own
// certified consent message is in charge (data-cmp="google", ADSENSE_CMP=google in .env).
(() => {
    'use strict';
    const me = document.currentScript;
    const client = me && me.dataset.client;
    if (!client || !/^ca-pub-\d{10,20}$/.test(client)) return;
    const googleCmp = me.dataset.cmp === 'google';
    let started = false;

    function fill() {
        document.querySelectorAll('.ad-slot').forEach((slot) => { slot.hidden = false; });
        document.querySelectorAll('ins.adsbygoogle').forEach(() => {
            try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked or offline */ }
        });
    }
    function start() {
        if (started) return;
        started = true;
        if (googleCmp) {
            // Google's consent message (set up in AdSense > Privacy & messaging): it asks, and tells the ads what was answered
            const fc = document.createElement('script');
            fc.async = true;
            fc.src = 'https://fundingchoicesmessages.google.com/i/pub-' + client.slice('ca-pub-'.length) + '?ers=1';
            document.head.appendChild(fc);
            const f = document.createElement('iframe');
            f.name = 'googlefcPresent'; f.style.display = 'none';
            document.body.appendChild(f);
        }
        const s = document.createElement('script');
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
        s.addEventListener('load', fill);
        document.head.appendChild(s);
    }

    if (googleCmp) { start(); return; }
    if (window.VBConsent && window.VBConsent.has('ads')) start();
    else if (window.VBConsent) window.VBConsent.onChange((c) => { if (c && c.ads) start(); });
})();
