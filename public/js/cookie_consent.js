// public/js/cookie_consent.js
(function () {
    // Utility to parse cookies safely
    function getCookie(name) {
        // If user explicitly declined during this session, ignore all non-essential cookies
        if (sessionStorage.getItem('cookie_consent') === 'declined') {
            return null;
        }
        const match = document.cookie.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
    }

    // Set a cookie only if consent is accepted
    function setCookie(name, value, days = 30) {
        if (getCookie("cookie_consent") !== "accepted") return;
        
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const isSecure = window.location.protocol === 'https:' ? ';Secure' : '';
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/;SameSite=Lax${isSecure}`;
    }

    // Completely wipe all non-essential browser cookies
    function clearAllCookies() {
        const cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf("=");
            const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
        }
    }

    // Expose global utilities
    window.getSystemCookie = getCookie;
    window.setSystemCookie = setCookie;
    window.clearAllCookies = clearAllCookies;

    document.addEventListener("DOMContentLoaded", () => {
        const cookieBanner = document.getElementById('cookie-banner');
        const acceptBtn = document.getElementById('cookie-accept-btn');
        const declineBtn = document.getElementById('cookie-decline-btn');

        const consentStatus = getCookie("cookie_consent");
        const sessionDeclined = sessionStorage.getItem('cookie_consent') === 'declined';

        // Show banner only if no consent cookie is saved and user hasn't already declined in this session
        if (!consentStatus && !sessionDeclined && cookieBanner) {
            cookieBanner.classList.remove('hidden');
        }

        // Handle Accept
        acceptBtn?.addEventListener('click', () => {
            sessionStorage.removeItem('cookie_consent');
            
            const date = new Date();
            date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 Year
            const isSecure = window.location.protocol === 'https:' ? ';Secure' : '';
            document.cookie = `cookie_consent=accepted;expires=${date.toUTCString()};path=/;SameSite=Lax${isSecure}`;
            
            cookieBanner?.classList.add('hidden');
        });

        // Handle Decline (Fixes saved state on decline)
        declineBtn?.addEventListener('click', () => {
            // 1. Wipe all existing persistent cookies immediately
            clearAllCookies();

            // 2. Use sessionStorage ONLY so the banner stays hidden for this browsing tab without writing persistent cookies
            sessionStorage.setItem('cookie_consent', 'declined');

            // 3. Hide banner
            cookieBanner?.classList.add('hidden');
        });
    });
})();