window.onload = () => {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.height = window.innerHeight; 
    canvas.width = window.innerWidth;

    const alphabet = "0101010101ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$<>[]".split("");
    const fontSize = 14; 
    const columns = canvas.width / fontSize;
    const rainDrops = Array(Math.floor(columns)).fill(1);

    function drawMatrix() {
        ctx.fillStyle = "rgba(6, 8, 12, 0.06)"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = typeof window.matrixColor !== 'undefined' ? window.matrixColor : "#00ff66"; 
        ctx.font = fontSize + "px monospace";

        for (let i = 0; i < rainDrops.length; i++) {
            const text = alphabet[Math.floor(Math.random() * alphabet.length)];
            ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);
            if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.98) rainDrops[i] = 0;
            rainDrops[i]++;
        }
    }

    window.addEventListener('resize', () => { 
        canvas.width = window.innerWidth; 
        canvas.height = window.innerHeight; 
    });

    setInterval(drawMatrix, 35);
};