// public/js/appunti-prompts.js — prompts to copy for studying with another AI (the text is data: nothing here is a command).
// Study prompt: one version per AI (what each one accepts differs). Essay ("produzione scritta") and test-photo prompts.
// window.AppuntiPrompts.list -> [{key, title, text(options)}]
(() => {
    'use strict';

    const HOW = {
        gemini: 'Allega il file "Per AI" (.md) di vector-box. Se hai le registrazioni della lezione puoi allegare anche quelle: sai ascoltarle. Non leggi gli zip: estrai i file e allega quelli.',
        chatgpt: 'Allega il file "Per AI" (.md) di vector-box (anche più file insieme). Gli zip non si leggono: usa il file .md. Se il file è molto lungo, dimmelo e ti mando una materia alla volta.',
        claude: 'Allega il file "Per AI" (.md) di vector-box come documento. Se è molto lungo, lavora un argomento alla volta e tieni il filo della conversazione. Gli zip non si leggono: usa il file .md.',
    };
    const AI_NAMES = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude' };

    const ESSAY = `PARTE SUL TEMA (produzione scritta)
Voglio allenarmi anche a scrivere il tema, come alla prova scritta di italiano. Il tema lo scrivo IO: tu non lo scrivi mai al posto mio.
1) Chiedimi che traccia voglio: (a) una traccia ministeriale degli anni passati, tipologia A (analisi del testo), B (testo argomentativo) o C (riflessione critica di attualità); (b) una traccia inventata da te su un argomento che abbiamo fatto in classe; (c) la traccia del mio professore, che ti incollo io.
2) Appena scelta la traccia ricordami: "Hai 2 ore: imposta un timer". Il timer lo faccio io, non tu.
3) Se te lo chiedo, aiutami con la scaletta (introduzione, tesi, argomenti con esempi dagli argomenti fatti in classe, conclusione), ma senza scrivere frasi del tema.
4) Quando ti mando il tema, correggilo con la griglia: ortografia e punteggiatura, lessico, coerenza e coesione, correttezza dei contenuti, rielaborazione personale, rispetto della traccia. Per ogni indicatore: cosa va bene, cosa no, un esempio dal mio testo.
5) Dammi un voto indicativo (in decimi) SOLO nella chat. Segna gli errori che ripeto spesso: la frase sbagliata e la stessa frase corretta.
6) Collega la traccia agli argomenti fatti in classe (dal materiale) per darmi spunti che il professore riconosce.
7) A fine correzione scrivi un "REPORT ERRORI" che posso incollare in una chat nuova per continuare da dove ero arrivato.`;

    function study(options) {
        const ai = options.ai || 'gemini';
        return `Sei il mio tutor di studio. Studiamo insieme, con parole semplici.
${HOW[ai]}

Come lavoriamo (parti dal PROMPT 1 del file, poi segui questi passi):
1) Spiegami un argomento alla volta in modo semplice: prima l'idea in due righe, poi i dettagli. Per le materie tecniche (informatica, sistemi, reti, matematica, fisica...) mostra il codice, i comandi e i procedimenti passo per passo, con un esempio svolto.
2) Dopo ogni argomento fammi 3 domande di controllo e aspetta le mie risposte. Se sbaglio spiegami l'errore; riproponi più tardi le domande sbagliate.
3) Dai priorità a quello che il professore ha chiesto o sottolineato in classe (domande del prof, argomenti annunciati).
4) Alla fine fai un quiz di 10 domande miste (scelta multipla e vero/falso) e un riepilogo: cosa so, cosa devo ripassare.
5) Usa solo il materiale del file e ciò che sai con certezza; se un punto non c'è, dillo.${options.essay ? '\n\n' + ESSAY : ''}`;
    }

    const EXAM_PHOTOS = `Ti mando due foto della stessa verifica di scuola: (1) la verifica VUOTA con le domande; (2) la stessa verifica CORRETTA dal professore, con i suoi segni e i suoi voti.
1) Trascrivi le domande della foto 1 (se qualcosa non si legge scrivi [non chiaro]).
2) CORREZIONE COMPLETA: per ogni domanda la risposta giusta spiegata passo per passo, usando le correzioni del professore (foto 2) come riferimento; se il professore ha segnato un errore, spiega perché è sbagliato.
3) VERSIONE SEMPLICE E VELOCE: per ogni domanda una frase o una formula da ricordare, in parole semplici, adatta a ripassare in 5 minuti.
4) I MIEI ERRORI: elenca cosa è stato segnato sbagliato nella foto 2, perché, e come evitarlo la prossima volta.
5) Per esercitarmi: proponi 5 domande nuove dello stesso tipo, senza dare le risposte finché non le chiedo.
Scrivi in italiano, in Markdown. Non inventare risposte che non si capiscono dalle foto.`;

    const ESSAY_REPORT = `Ti incollo i miei temi già corretti (o gli ultimi report errori). Fai un REPORT ERRORI in italiano:
1) Gli errori che ripeto, raggruppati per tipo (ortografia, punteggiatura, lessico, sintassi, coesione, contenuti).
2) Per ogni tipo: almeno due esempi presi dai miei testi, scritti come "Frase mia: ..." e "Frase corretta: ...", e la regola in una riga.
3) I tre errori da eliminare per primi e un esercizio breve per ciascuno.
4) Alla fine un testo "REPORT ERRORI" compatto che potrò incollare in una chat nuova.
Non inventare errori che non sono nei testi.`;

    window.AppuntiPrompts = {
        AI_NAMES,
        list: [
            { key: 'study', title: 'Studiare una materia con un\'altra AI', hasAi: true, hasEssay: true, text: study },
            { key: 'essay', title: 'Allenarsi sul tema (produzione scritta)', text: () => `Sei il mio allenatore per la produzione scritta di italiano.\n\n${ESSAY}` },
            { key: 'exam', title: 'Verifica da foto: correzione completa e versione veloce', text: () => EXAM_PHOTOS },
            { key: 'report', title: 'Report degli errori dei temi', text: () => ESSAY_REPORT },
        ],
    };
})();
