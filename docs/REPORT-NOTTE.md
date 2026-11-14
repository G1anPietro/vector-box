# Report della notte (lavoro autonomo sul piano Appunti)

Locale, non in git. Ogni voce: cosa è stato fatto, dove, versione in produzione. Test: `npm test`.

## Fatto
1. **Pulsanti troppo larghi sul telefono** — la testata non scorre più di lato (pulsanti che si restringono sotto i 560 px, `overflow-x: clip` su tutte le pagine Appunti). v2.4.86→87.
2. **Scheda "Classifica"** tra Studio e Materiale (`js/appunti-classifica.js`): i tuoi punti, tabella Settimana/Sempre, esci/partecipa, come si prendono i punti. Tolta dalla Bacheca.
3. **Ricerca nel materiale** (SQLite FTS5, schema v20, `tests/ricerca.test.js`): appunti scritti, testo dei file (trascrizioni, Word, slide) e documenti di studio; indice tenuto aggiornato da trigger; casella "Cerca" nell'Archivio con evidenziazione; dopo una risposta sbagliata nel quiz il link "Cerca nel materiale". v2.4.87.
4. **Quiz su misura** (Studio › "Quiz su misura", schema v21, `tests/quizsumisura.test.js`): scegli materia, 10/20/30/50 domande, scelta multipla / vero-falso / tutti e due, da dove (tutte, fatte dal prof, quelle che sbagli). Il sito pesca a caso dal pool dei quiz della classe (più spesso le domande del prof e quelle sbagliate); le risposte le giudica il server; gli sbagli finiscono nel ripasso; le scelte del modulo si ricordano. Vero/falso ricavati dalle domande a scelta multipla (affermazione giusta o sbagliata). Allenamento: niente punti.
5. **Domande fatte in classe** con conteggio ("Chiesta 3 volte"): la stessa domanda su giorni diversi, anche con parole diverse, si somma; prima quelle del prof, poi le più chieste. In Studio › "Domande fatte in classe". Da lì: **prompt per un'altra AI** che ti interroga con domande aperte una alla volta (scarica o copia).
6. **Lettura a voce** delle domande (pulsante "Leggi" nei quiz, sintesi vocale del browser); voce e velocità in Impostazioni (con l'avviso sulle voci robotiche di Linux/Windows).
