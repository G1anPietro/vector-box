// public/js/visit.js — tells the server about a visit to a static page (see api/visit.php).
(() => {
    try {
        fetch('../api/visit.php?p=' + encodeURIComponent(location.pathname), { credentials: 'same-origin', keepalive: true, cache: 'no-store' }).catch(() => {});
    } catch (e) { /* never break the page */ }
})();
