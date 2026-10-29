// public/js/hack.js
document.addEventListener("DOMContentLoaded", () => {
    const hexPool = ["1C", "E9", "55", "BD", "7A", "FF", "C3", "AA"];
    let targetSeq = [];
    let currentStep = 0;
    let timeLeft = 15;
    let timerInterval = null;

    const targetContainer = document.getElementById("target-container");
    const hexGrid = document.getElementById("hex-grid");
    const timerVal = document.getElementById("timer-val");
    const hackResult = document.getElementById("hack-result");
    const resetBtn = document.getElementById("reset-hack-btn");

    if (!targetContainer || !hexGrid || !timerVal || !hackResult || !resetBtn) return;

    function initGame() {
        clearInterval(timerInterval);
        currentStep = 0;
        timeLeft = 15;
        hackResult.innerHTML = "";
        timerVal.innerText = `${timeLeft}s`;
        timerVal.style.color = "var(--accent-color)";

        targetSeq = [];
        for (let i = 0; i < 3; i++) {
            targetSeq.push(hexPool[Math.floor(Math.random() * hexPool.length)]);
        }

        targetContainer.innerHTML = targetSeq.map((hex, i) => 
            `<div class="target-node" id="target-${i}">${hex}</div>`
        ).join("");

        let gridItems = [...targetSeq];
        while (gridItems.length < 15) {
            gridItems.push(hexPool[Math.floor(Math.random() * hexPool.length)]);
        }
        gridItems.sort(() => Math.random() - 0.5);

        hexGrid.innerHTML = gridItems.map((hex) => 
            `<button class="hex-btn" data-hex="${hex}">${hex}</button>`
        ).join("");

        document.querySelectorAll(".hex-btn").forEach(btn => {
            btn.addEventListener("click", () => handleHexClick(btn));
        });

        timerInterval = setInterval(() => {
            timeLeft--;
            timerVal.innerText = `${timeLeft}s`;
            if (timeLeft <= 5) timerVal.style.color = "#ff3333";
            if (timeLeft <= 0) endGame(false, ">> BREACH FAILED: BUFFER OVERFLOW");
        }, 1000);
    }

    function handleHexClick(btn) {
        const selectedHex = btn.getAttribute("data-hex");

        if (selectedHex === targetSeq[currentStep]) {
            document.getElementById(`target-${currentStep}`).classList.add("matched");
            btn.disabled = true;
            currentStep++;

            if (currentStep === targetSeq.length) {
                endGame(true, ">> BREACH SUCCESSFUL: ACCESS GRANTED");
            }
        } else {
            endGame(false, ">> BREACH FAILED: TRACE DETECTED");
        }
    }

    function endGame(success, message) {
        clearInterval(timerInterval);
        document.querySelectorAll(".hex-btn").forEach(btn => btn.disabled = true);
        
        if (success) {
            hackResult.innerHTML = `<span class="hack-result-success">${message}</span>`;
        } else {
            hackResult.innerHTML = `<span class="hack-result-failure">${message}</span>`;
        }
    }

    resetBtn.addEventListener("click", initGame);
    initGame();
});