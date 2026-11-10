// public/js/csrf.js
// Transparently adds the X-CSRF-Token header to every same-origin state-changing fetch().
(() => {
    const checkUrl = new URL('../api/check_session.php', document.currentScript.src).href;
    const origFetch = window.fetch.bind(window);
    let tokenPromise = null;

    const getToken = () => {
        const known = window.SESSION_STATE && window.SESSION_STATE.csrfToken;
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
            if (!headers.has('X-CSRF-Token')) {
                const token = await getToken();
                if (token) headers.set('X-CSRF-Token', token);
            }
            init = { credentials: 'same-origin', ...init, headers };
        }
        return origFetch(input, init);
    };
})();
