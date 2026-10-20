(function () {
    // Utility per impostare e leggere i cookie
    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
        }
        return null;
    }

    function setCookie(name, value, days = 30) {
        if (getCookie("cookie_consent") !== "accepted") return;
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${encodeURIComponent(value)};expires=${date.toUTCString()};path=/;SameSite=Lax`;
    }

    // Mappatura delle opzioni tema
    const themePresets = {
        'amber': { accent: '#ffb000', border: 'rgba(255, 176, 0, 0.3)', matrix: '#ffb000' },
        'cyberpunk': { accent: '#ff007f', border: 'rgba(0, 243, 255, 0.4)', matrix: '#00f3ff' },
        'dracula': { accent: '#bd93f9', border: 'rgba(189, 147, 249, 0.3)', matrix: '#bd93f9' },
        'matrix': { accent: '#00ff66', border: 'rgba(0, 255, 102, 0.25)', matrix: '#00ff66' }
    };

    // 1. ESECUZIONE IMMEDIATA: Imposta il tema e il colore della pioggia prima del rendering
    const savedTheme = getCookie("selected_theme");
    const savedMatrixColor = getCookie("matrix_color");
    const root = document.documentElement;

    if (savedTheme && themePresets[savedTheme]) {
        root.style.setProperty('--accent-color', themePresets[savedTheme].accent);
        root.style.setProperty('--border-color', themePresets[savedTheme].border);
        window.matrixColor = savedMatrixColor || themePresets[savedTheme].matrix;
    } else if (savedMatrixColor) {
        window.matrixColor = savedMatrixColor;
    }

    // 2. GESTIONE DOM: Inizializza il banner dei cookie quando la pagina e pronta
    document.addEventListener("DOMContentLoaded", () => {
        const cookieBanner = document.getElementById('cookie-banner');
        const acceptBtn = document.getElementById('cookie-accept-btn');
        const declineBtn = document.getElementById('cookie-decline-btn');
        const consentStatus = getCookie("cookie_consent");

        if (!consentStatus && cookieBanner) {
            cookieBanner.classList.remove('hidden');
        }

        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                const date = new Date();
                date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
                document.cookie = `cookie_consent=accepted;expires=${date.toUTCString()};path=/;SameSite=Lax`;
                
                if (cookieBanner) cookieBanner.classList.add('hidden');

                // Salva le preferenze attive immediatamente dopo l'accettazione
                if (window.matrixColor) setCookie("matrix_color", window.matrixColor);
                if (savedTheme) setCookie("selected_theme", savedTheme);
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
    });

    // Espone setCookie per registrante dai comandi del terminale
    window.setSystemCookie = setCookie;
})();