// public/js/csrf.js
// Transparently adds the X-CSRF-Token header to every same-origin state-changing fetch().
(() => {
    const checkUrl = new URL('../api/check_session.php', document.currentScript.src).href;
    const origFetch = window.fetch.bind(window);
    let tokenPromise = null;

    const getToken = (fresh) => {
        const known = !fresh && window.SESSION_STATE && window.SESSION_STATE.csrfToken;
        if (known) return Promise.resolve(known);
        if (!tokenPromise) {
            tokenPromise = origFetch(checkUrl, { credentials: 'same-origin', cache: 'no-store' })
                .then((r) => r.json())
                .then((d) => d.csrf_token || '')
                .catch(() => { tokenPromise = null; return ''; });
        }
        return tokenPromise;
    };

    window.fetch = async (input, init = {}) => {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const method = String(init.method || (isRequest ? input.method : 'GET')).toUpperCase();
        const url = new URL(isRequest ? input.url : String(input), location.href);

        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && url.origin === location.origin) {
            const headers = new Headers(init.headers || (isRequest ? input.headers : undefined));
            let ours = false;
            if (!headers.has('X-CSRF-Token')) {
                const token = await getToken();
                if (token) { headers.set('X-CSRF-Token', token); ours = true; }
            }
            init = { credentials: 'same-origin', ...init, headers };
            const res = await origFetch(input, init);
            // the page lived longer than the session (a login/logout elsewhere): the cached token is stale. Fetch a fresh one and
            // try once more; only for tokens we added ourselves and bodies that can be sent twice.
            const body = init.body;
            if (res.status === 403 && ours && !isRequest && !(body && typeof body.getReader === 'function')) {
                tokenPromise = null;
                const fresh = await getToken(true);            // ask the server again, not the token the page was built with
                if (fresh && fresh !== headers.get('X-CSRF-Token')) {
                    if (window.SESSION_STATE) window.SESSION_STATE.csrfToken = fresh;
                    headers.set('X-CSRF-Token', fresh);
                    return origFetch(input, { ...init, headers });
                }
            }
            return res;
        }
        return origFetch(input, init);
    };
})();
