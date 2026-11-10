// public/js/tools.js
document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("tool-input");
    const output = document.getElementById("tool-output");
    const modeSelect = document.getElementById("tool-mode");
    const keyInput = document.getElementById("tool-key");

    if (!input || !output || !modeSelect) return;

    // ---- 5-row block font for the ASCII banner ('#' = filled) ----------
    const FONT = {
        A: ".###./#...#/#####/#...#/#...#", B: "####./#...#/####./#...#/####.",
        C: ".####/#..../#..../#..../.####", D: "####./#...#/#...#/#...#/####.",
        E: "#####/#..../####./#..../#####", F: "#####/#..../####./#..../#....",
        G: ".####/#..../#..##/#...#/.###.", H: "#...#/#...#/#####/#...#/#...#",
        I: "###/.#./.#./.#./###",           J: "..###/...#./...#./#..#./.##..",
        K: "#...#/#..#./###../#..#./#...#", L: "#..../#..../#..../#..../#####",
        M: "#...#/##.##/#.#.#/#...#/#...#", N: "#...#/##..#/#.#.#/#..##/#...#",
        O: ".###./#...#/#...#/#...#/.###.", P: "####./#...#/####./#..../#....",
        Q: ".###./#...#/#.#.#/#..#./.##.#", R: "####./#...#/####./#..#./#...#",
        S: ".####/#..../.###./....#/####.", T: "#####/..#../..#../..#../..#..",
        U: "#...#/#...#/#...#/#...#/.###.", V: "#...#/#...#/#...#/.#.#./..#..",
        W: "#...#/#...#/#.#.#/##.##/#...#", X: "#...#/.#.#./..#../.#.#./#...#",
        Y: "#...#/.#.#./..#../..#../..#..", Z: "#####/...#./..#../.#.../#####",
        0: ".###./#..##/#.#.#/##..#/.###.", 1: ".#./##./.#./.#./###",
        2: "####./....#/.###./#..../#####", 3: "####./....#/.###./....#/####.",
        4: "#...#/#...#/#####/....#/....#", 5: "#####/#..../####./....#/####.",
        6: ".###./#..../####./#...#/.###.", 7: "#####/....#/...#./..#../..#..",
        8: ".###./#...#/.###./#...#/.###.", 9: ".###./#...#/.####/....#/.###.",
        " ": "../../../../..", "!": "#/#/#/./#", "?": "###./...#/.##./..../.#..",
        ".": "././././#", "-": ".../.../###/.../...",
        ":": "./#/./#/.", "_": "...../...../...../...../#####",
    };

    const banner = (text) => text.split('\n').map((line) => {
        const glyphs = [...line.toUpperCase().slice(0, 40)].map((ch) => (FONT[ch] || FONT['?']).split('/'));
        if (glyphs.length === 0) return '';
        return [0, 1, 2, 3, 4].map((row) => glyphs.map((g) => g[row]).join('.')
            .replace(/#/g, '█').replace(/\./g, ' ').replace(/\s+$/, '')).join('\n');
    }).join('\n\n');

    // ---- Ciphers -------------------------------------------------------------
    const shiftLetters = (str, n) => str.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26 + 26) % 26 + base);
    });
    const rot47 = (str) => str.replace(/[!-~]/g, (c) => String.fromCharCode(33 + ((c.charCodeAt(0) - 33 + 47) % 94)));

    const MORSE = {
        A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
        K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
        U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
        0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
        8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.',
        '-': '-....-', ':': '---...', '@': '.--.-.', '=': '-...-',
    };
    const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
    const morseEncode = (str) => str.toUpperCase().split(/\s+/).filter(Boolean)
        .map((word) => [...word].map((c) => MORSE[c] || '?').join(' ')).join(' / ');
    const morseDecode = (str) => str.trim().split(/\s*\/\s*|\s{3,}/)
        .map((word) => word.split(/\s+/).filter(Boolean).map((code) => MORSE_REV[code] || '?').join('')).join(' ');

    const binEncode = (str) => Array.from(new TextEncoder().encode(str)).map((b) => b.toString(2).padStart(8, '0')).join(' ');
    const binDecode = (str) => {
        const bytes = str.replace(/[^01]/g, '').match(/.{8}/g) || [];
        return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 2))));
    };

    const caesarKey = () => Math.min(25, Math.max(1, parseInt(keyInput && keyInput.value, 10) || 3));

    async function processTool() {
        const val = input.value;
        const mode = modeSelect.value;
        if (keyInput) keyInput.style.display = mode.startsWith('caesar') ? '' : 'none';
        output.style.whiteSpace = mode === 'banner' ? 'pre' : '';
        if (!val) { output.value = ""; return; }

        try {
            switch (mode) {
                case "b64-enc":
                    // UTF-8 safe
                    output.value = btoa(String.fromCharCode(...new TextEncoder().encode(val)));
                    break;
                case "b64-dec":
                    output.value = new TextDecoder().decode(Uint8Array.from(atob(val.trim()), (c) => c.charCodeAt(0)));
                    break;
                case "url-enc":
                    output.value = encodeURIComponent(val);
                    break;
                case "url-dec":
                    output.value = decodeURIComponent(val);
                    break;
                case "hex-enc":
                    output.value = Array.from(new TextEncoder().encode(val))
                        .map(b => b.toString(16).padStart(2, '0')).join(' ');
                    break;
                case "sha256": {
                    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(val));
                    output.value = Array.from(new Uint8Array(hashBuffer))
                        .map(b => b.toString(16).padStart(2, '0')).join('');
                    break;
                }
                case "banner": output.value = banner(val); break;
                case "rot13": output.value = shiftLetters(val, 13); break;
                case "rot47": output.value = rot47(val); break;
                case "caesar": output.value = shiftLetters(val, caesarKey()); break;
                case "caesar-dec": output.value = shiftLetters(val, -caesarKey()); break;
                case "morse-enc": output.value = morseEncode(val); break;
                case "morse-dec": output.value = morseDecode(val); break;
                case "bin-enc": output.value = binEncode(val); break;
                case "bin-dec": output.value = binDecode(val); break;
            }
        } catch (e) {
            output.value = ">> ERROR: INVALID INPUT FOR SELECTED MODE";
        }
    }

    input.addEventListener("input", processTool);
    modeSelect.addEventListener("change", processTool);
    if (keyInput) keyInput.addEventListener("input", processTool);

    // Exposed for the browser console and tests
    window.cyberTools = { banner, shiftLetters, rot47, morseEncode, morseDecode, binEncode, binDecode };
});
