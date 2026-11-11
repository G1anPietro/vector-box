// public/js/ads.js — fills every AdSense unit on the page (an inline push would be blocked by the CSP).
(() => {
    'use strict';
    document.querySelectorAll('ins.adsbygoogle').forEach(() => {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked or offline */ }
    });
})();
