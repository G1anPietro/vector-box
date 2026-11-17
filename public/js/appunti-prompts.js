// public/js/appunti-prompts.js — prompts to copy for studying with another AI (the text is data: nothing here is a command).
// Study prompt: one version per AI (what each one accepts differs). Essay ("produzione scritta") and test-photo prompts.
// The prompts are pasted into an AI chat, so they follow the language of the interface (VBLang.lang): P.it and P.en below.
// window.AppuntiPrompts.list -> [{key, title, text(options)}]
(() => {
    'use strict';

    const P = {
        it: {
            how: {
                gemini: 'Allega il file "Per AI" (.md) di vector-box. Se hai le registrazioni della lezione puoi allegare anche quelle: sai ascoltarle. Non leggi gli zip: estrai i file e allega quelli.',
                chatgpt: 'Allega il file "Per AI" (.md) di vector-box (anche più file insieme). Gli zip non si leggono: usa il file .md. Se il file è molto lungo, dimmelo e ti mando una materia alla volta.',
                claude: 'Allega il file "Per AI" (.md) di vector-box come documento. Se è molto lungo, lavora un argomento alla volta e tieni il filo della conversazione. Gli zip non si leggono: usa il file .md.',
            },
            essay: `PARTE SUL TEMA (produzione scritta)
Voglio allenarmi anche a scrivere il tema, come alla prova scritta di italiano. Il tema lo scrivo IO: tu non lo scrivi mai al posto mio.
1) Chiedimi che traccia voglio: (a) una traccia ministeriale degli anni passati, tipologia A (analisi del testo), B (testo argomentativo) o C (riflessione critica di attualità); (b) una traccia inventata da te su un argomento che abbiamo fatto in classe; (c) la traccia del mio professore, che ti incollo io.
2) Appena scelta la traccia ricordami: "Hai 2 ore: imposta un timer". Il timer lo faccio io, non tu.
3) Se te lo chiedo, aiutami con la scaletta (introduzione, tesi, argomenti con esempi dagli argomenti fatti in classe, conclusione), ma senza scrivere frasi del tema.
4) Quando ti mando il tema, correggilo con la griglia: ortografia e punteggiatura, lessico, coerenza e coesione, correttezza dei contenuti, rielaborazione personale, rispetto della traccia. Per ogni indicatore: cosa va bene, cosa no, un esempio dal mio testo.
5) Dammi un voto indicativo (in decimi) SOLO nella chat. Segna gli errori che ripeto spesso: la frase sbagliata e la stessa frase corretta.
6) Collega la traccia agli argomenti fatti in classe (dal materiale) per darmi spunti che il professore riconosce.
7) A fine correzione scrivi un "REPORT ERRORI" che posso incollare in una chat nuova per continuare da dove ero arrivato.`,
            study: (how, essay) => `Sei il mio tutor di studio. Studiamo insieme, con parole semplici.
${how}

Come lavoriamo (parti dal PROMPT 1 del file, poi segui questi passi):
1) Spiegami un argomento alla volta in modo semplice: prima l'idea in due righe, poi i dettagli. Per le materie tecniche (informatica, sistemi, reti, matematica, fisica...) mostra il codice, i comandi e i procedimenti passo per passo, con un esempio svolto.
2) Dopo ogni argomento fammi 3 domande di controllo e aspetta le mie risposte. Se sbaglio spiegami l'errore; riproponi più tardi le domande sbagliate.
3) Dai priorità a quello che il professore ha chiesto o sottolineato in classe (domande del prof, argomenti annunciati).
4) Alla fine fai un quiz di 10 domande miste (scelta multipla e vero/falso) e un riepilogo: cosa so, cosa devo ripassare.
5) Usa solo il materiale del file e ciò che sai con certezza; se un punto non c'è, dillo.${essay ? '\n\n' + essay : ''}`,
            essayIntro: 'Sei il mio allenatore per la produzione scritta di italiano.',
            exam: `Ti mando due foto della stessa verifica di scuola: (1) la verifica VUOTA con le domande; (2) la stessa verifica CORRETTA dal professore, con i suoi segni e i suoi voti.
1) Trascrivi le domande della foto 1 (se qualcosa non si legge scrivi [non chiaro]).
2) CORREZIONE COMPLETA: per ogni domanda la risposta giusta spiegata passo per passo, usando le correzioni del professore (foto 2) come riferimento; se il professore ha segnato un errore, spiega perché è sbagliato.
3) VERSIONE SEMPLICE E VELOCE: per ogni domanda una frase o una formula da ricordare, in parole semplici, adatta a ripassare in 5 minuti.
4) I MIEI ERRORI: elenca cosa è stato segnato sbagliato nella foto 2, perché, e come evitarlo la prossima volta.
5) Per esercitarmi: proponi 5 domande nuove dello stesso tipo, senza dare le risposte finché non le chiedo.
Scrivi in italiano, in Markdown. Non inventare risposte che non si capiscono dalle foto.`,
            report: `Ti incollo i miei temi già corretti (o gli ultimi report errori). Fai un REPORT ERRORI in italiano:
1) Gli errori che ripeto, raggruppati per tipo (ortografia, punteggiatura, lessico, sintassi, coesione, contenuti).
2) Per ogni tipo: almeno due esempi presi dai miei testi, scritti come "Frase mia: ..." e "Frase corretta: ...", e la regola in una riga.
3) I tre errori da eliminare per primi e un esercizio breve per ciascuno.
4) Alla fine un testo "REPORT ERRORI" compatto che potrò incollare in una chat nuova.
Non inventare errori che non sono nei testi.`,
            titles: { study: 'Studiare una materia con un\'altra AI', essay: 'Allenarsi sul tema (produzione scritta)', exam: 'Verifica da foto: correzione completa e versione veloce', report: 'Report degli errori dei temi' },
        },
        en: {
            how: {
                gemini: 'Attach the "Per AI" file (.md) from vector-box. If you have the recordings of the lesson you can attach those too: you can listen to them. You cannot read zip files: unzip them and attach the files inside.',
                chatgpt: 'Attach the "Per AI" file (.md) from vector-box (several files at once are fine). Zip files cannot be read: use the .md file. If the file is very long, tell me and I will send you one subject at a time.',
                claude: 'Attach the "Per AI" file (.md) from vector-box as a document. If it is very long, work on one topic at a time and keep the thread of the conversation. Zip files cannot be read: use the .md file.',
            },
            essay: `ESSAY PART (written composition)
I also want to practise writing essays, like the written exam of the Italian language class ("tema"). I write the essay MYSELF: you never write it for me.
1) Ask me which prompt I want: (a) an official past-exam prompt, type A (text analysis), B (argumentative text) or C (critical reflection on a current topic); (b) a prompt you invent about a topic we covered in class; (c) my teacher's prompt, which I will paste for you.
2) As soon as the prompt is chosen, remind me: "You have 2 hours: set a timer". I run the timer, not you.
3) If I ask, help me with the outline (introduction, thesis, arguments with examples from the topics covered in class, conclusion), but without writing any sentence of the essay.
4) When I send you the essay, mark it with this grid: spelling and punctuation, vocabulary, coherence and cohesion, correctness of the content, personal rework, following the prompt. For each criterion: what is good, what is not, one example from my text.
5) Give me an approximate grade (out of 10, the Italian scale) ONLY in the chat. Point out the mistakes I repeat often: the wrong sentence and the same sentence corrected.
6) Link the prompt to the topics covered in class (from the material) to give me ideas my teacher will recognise.
7) At the end of the marking, write an "ERROR REPORT" that I can paste into a new chat to continue from where I stopped.`,
            study: (how, essay) => `You are my study tutor. We study together, in simple words.
${how}

How we work (start from PROMPT 1 of the file, then follow these steps):
1) Explain one topic at a time in a simple way: first the idea in two lines, then the details. For technical subjects (computer science, systems, networks, maths, physics...) show the code, the commands and the procedures step by step, with a worked example.
2) After each topic ask me 3 check questions and wait for my answers. If I get one wrong, explain the mistake; ask the wrong questions again later.
3) Give priority to what the teacher asked or stressed in class (the teacher's questions, announced topics).
4) At the end, give me a 10-question mixed quiz (multiple choice and true/false) and a summary: what I know, what I need to review.
5) Use only the material in the file and what you know for certain; if something is not there, say so.${essay ? '\n\n' + essay : ''}`,
            essayIntro: 'You are my coach for written composition in Italian class.',
            exam: `I am sending you two photos of the same school test ("verifica", a written test): (1) the EMPTY test with the questions; (2) the same test MARKED by the teacher, with their marks and grades.
1) Transcribe the questions from photo 1 (if something cannot be read, write [unclear]).
2) FULL CORRECTION: for each question the right answer explained step by step, using the teacher's corrections (photo 2) as the reference; if the teacher marked a mistake, explain why it is wrong.
3) SIMPLE AND QUICK VERSION: for each question one sentence or one formula to remember, in simple words, good for a 5-minute review.
4) MY MISTAKES: list what was marked wrong in photo 2, why, and how to avoid it next time.
5) To practise: suggest 5 new questions of the same kind, without giving the answers until I ask.
Write in English, in Markdown. Do not invent answers that cannot be understood from the photos.`,
            report: `I am pasting my essays that have already been marked (or the latest error reports). Write an ERROR REPORT in English:
1) The mistakes I repeat, grouped by type (spelling, punctuation, vocabulary, syntax, cohesion, content).
2) For each type: at least two examples taken from my texts, written as "My sentence: ..." and "Corrected sentence: ...", and the rule in one line.
3) The three mistakes to get rid of first, and a short exercise for each.
4) At the end a compact "ERROR REPORT" text that I can paste into a new chat.
Do not invent mistakes that are not in the texts.`,
            titles: { study: 'Study a subject with another AI', essay: 'Practise the essay (written composition)', exam: 'Test from photos: full correction and quick version', report: 'Error report of the essays' },
        },
    };
    const AI_NAMES = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude' };
    const L = () => P[window.VBLang && window.VBLang.lang === 'it' ? 'it' : 'en'];

    window.AppuntiPrompts = {
        AI_NAMES,
        list: [
            { key: 'study', get title() { return L().titles.study; }, hasAi: true, hasEssay: true, text: (options) => L().study(L().how[options.ai || 'gemini'], options.essay ? L().essay : '') },
            { key: 'essay', get title() { return L().titles.essay; }, text: () => `${L().essayIntro}\n\n${L().essay}` },
            { key: 'exam', get title() { return L().titles.exam; }, text: () => L().exam },
            { key: 'report', get title() { return L().titles.report; }, text: () => L().report },
        ],
    };
})();
