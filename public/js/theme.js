document.addEventListener("DOMContentLoaded", () => {
    // Utility per impostare e leggere i cookie
    function setCookie(name, value, days = 30) {
        if (getCookie("cookie_consent") !== "accepted") return;
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/;SameSite=Lax`;
    }

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
        }
        return null;
    }

    // Applicazione del tema salvato
    function applySavedTheme() {
        const savedTheme = getCookie("selected_theme");
        const savedMatrixColor = getCookie("matrix_color");
        const root = document.documentElement;

        if (savedMatrixColor) {
            window.matrixColor = savedMatrixColor;
        }

        if (savedTheme === 'amber') {
            root.style.setProperty('--accent-color', '#ffb000');
            root.style.setProperty('--border-color', 'rgba(255, 176, 0, 0.3)');
        } else if (savedTheme === 'cyberpunk') {
            root.style.setProperty('--accent-color', '#ff007f');
            root.style.setProperty('--border-color', 'rgba(0, 243, 255, 0.4)');
        } else if (savedTheme === 'dracula') {
            root.style.setProperty('--accent-color', '#bd93f9');
            root.style.setProperty('--border-color', 'rgba(189, 147, 249, 0.3)');
        } else if (savedTheme === 'matrix') {
            root.style.setProperty('--accent-color', '#00ff66');
            root.style.setProperty('--border-color', 'rgba(0, 255, 102, 0.25)');
        }
    }

    // Gestione Banner Consenso Cookie (Conforme GDPR)
    const cookieBanner = document.getElementById('cookie-banner');
    const acceptBtn = document.getElementById('cookie-accept-btn');
    const declineBtn = document.getElementById('cookie-decline-btn');
    const consentStatus = getCookie("cookie_consent");

    if (!consentStatus && cookieBanner) {
        cookieBanner.classList.remove('hidden');
    }

    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            // Imposta prima il consenso generale
            const date = new Date();
            date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
            document.cookie = `cookie_consent=accepted;expires=${date.toUTCString()};path=/;SameSite=Lax`;
            
            if (cookieBanner) cookieBanner.classList.add('hidden');

            // Salva subito le preferenze correnti
            if (window.matrixColor) setCookie("matrix_color", window.matrixColor);
        });
    }

    if (declineBtn) {
        declineBtn.addEventListener('click', () => {
            const date = new Date();
            date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
            document.cookie = `cookie_consent=declined;expires=${date.toUTCString()};path=/;SameSite=Lax`;
            
            if (cookieBanner) cookieBanner.classList.add('hidden');
        });
    }

    // Inizializza il tema salvato all'avvio
    applySavedTheme();

    // Espone setCookie per registrarlo dai comandi del terminale
    window.setSystemCookie = setCookie;
});