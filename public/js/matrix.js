// public/matrix.js
(function () {
    let canvas = null;
    let ctx = null;
    let animationFrameId = null;
    
    let lastDrawTime = 0;
    window.matrixIntervalSpeed = 35; // Target delay in ms

    const fontSize = 14;
    const alphabet = "0101010101ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$<>[]";
    let columns = 0;
    let rainDrops = [];

    function setupCanvasDimensions() {
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        
        ctx.scale(dpr, dpr);

        columns = Math.floor(window.innerWidth / fontSize);
        
        // Preserve position data or reset on resize
        const currentLength = rainDrops.length;
        if (columns > currentLength) {
            for (let i = currentLength; i < columns; i++) {
                rainDrops[i] = Math.floor(Math.random() * -100); // Stagger initial drops off-screen
            }
        } else {
            rainDrops.length = columns;
        }
    }

    function drawMatrix(timestamp) {
        animationFrameId = requestAnimationFrame(drawMatrix);

        // Throttle frame rate based on matrixIntervalSpeed delay
        const elapsed = timestamp - lastDrawTime;
        if (elapsed < window.matrixIntervalSpeed) return;
        lastDrawTime = timestamp - (elapsed % window.matrixIntervalSpeed);

        // Fade clear effect
        ctx.fillStyle = window.matrixFade || "rgba(6, 8, 12, 0.06)";
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

        ctx.fillStyle = window.matrixColor || "#00ff66";
        ctx.font = `${fontSize}px monospace`;

        const charCount = alphabet.length;
        const screenHeight = window.innerHeight;

        for (let i = 0; i < columns; i++) {
            const char = alphabet.charAt(Math.floor(Math.random() * charCount));
            const x = i * fontSize;
            const y = rainDrops[i] * fontSize;

            ctx.fillText(char, x, y);

            if (y > screenHeight && Math.random() > 0.98) {
                rainDrops[i] = 0;
            }
            rainDrops[i]++;
        }
    }

    // Public API to dynamically modify speed
    window.updateMatrixSpeed = (newSpeedMs) => {
        window.matrixIntervalSpeed = Math.max(10, newSpeedMs);
    };

    const KEY = 'vb_matrix';
    const stored = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    // nobody chose yet: people who asked their system for less motion get no rain (they can still switch it on)
    const reduced = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
    let enabled = stored() === null ? !reduced() : stored() !== 'off';
    window.isMatrixEnabled = () => enabled;

    /** Switches the rain on or off (it stays off in this browser until switched on again). Off: no drawing at all, no battery used. */
    window.setMatrixEnabled = (on) => {
        enabled = !!on;
        try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) { /* private mode */ }
        if (canvas) canvas.style.display = enabled ? '' : 'none';
        if (!enabled && animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
        if (enabled && canvas && !animationFrameId) { setupCanvasDimensions(); animationFrameId = requestAnimationFrame(drawMatrix); }
        window.dispatchEvent(new CustomEvent('vb-matrix-change', { detail: { on: enabled } }));
    };

    // Initialize engine on DOM Ready
    document.addEventListener("DOMContentLoaded", () => {
        canvas = document.getElementById("canvas");
        if (!canvas) return;

        ctx = canvas.getContext("2d", { alpha: false });
        if (!enabled) { canvas.style.display = 'none'; }
        setupCanvasDimensions();

        // Debounced Window Resize Handler
        let resizeTimeout = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(setupCanvasDimensions, 100);
        });

        // Start High-Performance Animation Loop (not when the user switched the rain off)
        if (enabled) animationFrameId = requestAnimationFrame(drawMatrix);
    });
})();