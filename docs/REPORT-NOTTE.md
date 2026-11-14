# Report della notte (lavoro autonomo sul piano Appunti)

Locale, non in git. Ogni voce: cosa è stato fatto, dove, versione in produzione. Test: `npm test`.

## Fatto
1. **Pulsanti troppo larghi sul telefono** — la testata non scorre più di lato (pulsanti che si restringono sotto i 560 px, `overflow-x: clip` su tutte le pagine Appunti). v2.4.86→87.
2. **Scheda "Classifica"** tra Studio e Materiale (`js/appunti-classifica.js`): i tuoi punti, tabella Settimana/Sempre, esci/partecipa, come si prendono i punti. Tolta dalla Bacheca.
3. **Ricerca nel materiale** (SQLite FTS5, schema v20, `tests/ricerca.test.js`): appunti scritti, testo dei file (trascrizioni, Word, slide) e documenti di studio; indice tenuto aggiornato da trigger; casella "Cerca" nell'Archivio con evidenziazione; dopo una risposta sbagliata nel quiz il link "Cerca nel materiale". v2.4.87.
4. **Quiz su misura** (Studio › "Quiz su misura", schema v21, `tests/quizsumisura.test.js`): scegli materia, 10/20/30/50 domande, scelta multipla / vero-falso / tutti e due, da dove (tutte, fatte dal prof, quelle che sbagli). Il sito pesca a caso dal pool dei quiz della classe (più spesso le domande del prof e quelle sbagliate); le risposte le giudica il server; gli sbagli finiscono nel ripasso; le scelte del modulo si ricordano. Vero/falso ricavati dalle domande a scelta multipla (affermazione giusta o sbagliata). Allenamento: niente punti.
5. **Domande fatte in classe** con conteggio ("Chiesta 3 volte"): la stessa domanda su giorni diversi, anche con parole diverse, si somma; prima quelle del prof, poi le più chieste. In Studio › "Domande fatte in classe". Da lì: **prompt per un'altra AI** che ti interroga con domande aperte una alla volta (scarica o copia).
6. **Lettura a voce** delle domande (pulsante "Leggi" nei quiz, sintesi vocale del browser); voce e velocità in Impostazioni (con l'avviso sulle voci robotiche di Linux/Windows).
7. **Calendario a mese** (computer) con agenda sul telefono, filtro per materia, clic su un giorno per vederlo (v2.4.88).
8. **Riepilogo settimanale** (schema invariato, `digestRun` nel worker, `tests/riepilogo.test.js`): giorno e ora scelti dalla classe in Impostazioni (default domenica 19:00), una volta a settimana, testo personale per chi è interrogato, non parte se non c'è niente; ognuno lo può spegnere ("Cosa ricevere").
9. **Appunti mancanti** (`tests/mancanti.test.js`): attivabile in Impostazioni (da data a data, materie escluse), blocco in Bacheca con "Carica" (apre la pagina Carica già sulla lezione giusta) e menu "Non serve per questa lezione".
10. **Registro delle modifiche** (schema v22, `tests/registro.test.js`): chi ha eliminato o cambiato cosa (appunti, documenti, file, annunci, ruoli, permessi, codice, materie, impostazioni, orario). Si legge nel Pannello del rappresentante, solo con il permesso "impostazioni".
11. **Prompt da copiare** nella pagina Carica: studiare con un'altra AI (una versione per Gemini, ChatGPT, Claude, con la parte sul tema opzionale), allenarsi sul tema (tracce ministeriali A/B/C, timer, scaletta, griglia, report errori), verifica da foto (correzione completa + versione veloce), report errori dei temi.
12. **Carte (flashcard) e Anki**: dalle domande aperte fatte in classe, ripasso a intervalli sul dispositivo; esportazione per Anki (.txt con tab).
13. **Guida aggiornata** (Bacheca, classifica, ricerca, quiz su misura, impostazioni) e **messaggio per il gruppo** (Impostazioni › Codice della classe › "Messaggio per invitare il gruppo": testo da mandare e codice da mandare a parte).
14. Il turno nel calendario mostra il **programma** fino a quel giorno; il file dell'AI (PDF/Word) passa dalla coda dei caricamenti; nel ripasso "la stai sbagliando da un po'" (schema v23).
15. **PDF unico "Per AI"** (prompt, testi, trascrizioni e le foto originali in un solo file): pulsante "Scarica un PDF (con le foto)" nella pagina Carica e voce nei menu ⋯ (giorno, materia, verifica). Niente librerie: ho scritto un piccolo generatore di PDF (accenti ok; foto JPEG e PNG semplici; le altre restano nello zip). Testato con `pdftotext` e `pdfimages`. Lo zip tiene già senza compressione foto, PDF e audio.
16. **L'AI controlla i caricamenti** (schema v24, `tests/classificazione.test.js`, si spegne con `AI_CLASSIFY=false` nel `.env`): dopo la trascrizione legge ogni caricamento nuovo; se tipo, materia o data scelti non coincidono col testo (e l'AI è sicura) manda una **segnalazione** a chi ha caricato e al rappresentante (Bacheca › Da sistemare: "Correggi come suggerito" / "Lascia com'è": **non cambia mai niente da sola**); se hai scelto **"Lo decide l'AI"** (ora il tipo predefinito nella pagina Carica) mette lei il tipo; propone un **argomento** nuovo (da confermare) e una **verifica annunciata** nel materiale ("Aggiungi al calendario"). Usa il modello veloce, al massimo 8 caricamenti per giro.
17. **Altre cose del piano**: promemoria del **ripasso** a un'ora scelta (spento di base); promemoria delle verifiche anche **una settimana** e **3 giorni** prima (a scelta, di base restano 2gg/1gg/sera); **avanzamento di lettura sul server** (stesso punto su telefono e computer); **"Gli Appunti si aprono su…"** (ultima scheda / Bacheca / Classe / …) in Impostazioni; **modalità mancini** (header, menu e pulsanti specchiati); nel quiz "la stai sbagliando da un po'".

## Non fatto (e perché)
- **Cache lunga di /js e /css** (ho preparato le righe in `docs/DA-FARE.md`): è una modifica a nginx, serve il tuo sì. Oggi il browser tiene già i file e chiede solo "è cambiato?" (304).
- **Materiale diviso per data + argomento, con l'AI che lavora "per pezzo"**: cambierebbe tutta la pipeline dell'AI (documenti per lezione → per argomento); troppo rischioso da fare di notte senza che tu lo veda. Oggi gli argomenti guidano *quali* lezioni riassumere, non come si dividono i documenti.
- **Coda dei caricamenti per i libri della Biblioteca**, e coda **in background a pagina chiusa** (service worker con Background Sync, solo Chrome/Android).
- Ho letto "installare il materiale" come "scaricare".

## Cose da guardare domattina
1. Dal telefono: Classe (orario) → Bacheca → Classifica → Studio (Quiz su misura, Domande fatte in classe) → Carica (passo 1 e prompt) → Impostazioni (ingranaggio).
2. Caricare una foto con "Lo decide l'AI" e controllare dopo qualche minuto la Bacheca › Da sistemare.
3. Una prova di Whisper con un audio vero (la sessione del server lo ha installato ma non l'ha ancora provato).
4. Se vuoi la cache lunga: dimmi sì e preparo il messaggio per la sessione del server.
