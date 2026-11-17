# Il Dungeon del Server (roguelike)

Pagina `public/pages/dungeon.html`, interfaccia `public/js/dungeon.js`, regole in `public/js/rogue/` (senza DOM, testabili da Node).
Test: `tests/dungeon.test.js` e `tests/dungeon-touch.test.js`. Nessuna rete: tutto sta nel browser (localStorage: `vb_dg_run` partita, `vb_dg_meta` profilo, `vb_dg_opt` opzioni).

## Come è fatto
- `rng.js` numeri casuali con seme (tutta la partita è un oggetto JSON: stesso seme, stessa partita).
- `map.js` piani (stanze e corridoi, porte segrete), campo visivo, percorsi. Un piano dipende solo da (seme, piano).
- `mobs.js` settori e mostri (dati). `items.js` oggetti (dati). `classes.js` classi e abilità (dati). `meta.js` albero dei potenziamenti e medaglie (dati). `sprites.js` disegni 8x8.
- `game.js` le regole: `newGame`, `act`, `save/load`, profilo (`recordRun`, `buyUpgrade`, `checkMedals`).
- `text.js` tutte le frasi che non stanno nelle tabelle, in inglese e italiano (chiave -> `{en, it}`).
- Ogni file di dati ha in cima un commento che spiega come aggiungere un elemento.

## Comandi
Due modi, scelti dal Menu (`Comandi: Tocco / Croce direzionale`, salvato in `vb_dg_opt`, predefinito Tocco). La tastiera funziona sempre.
**Tocco (come Pixel Dungeon)**, sulla mappa:
- tocca una casella: ci cammini da solo (ti fermi se compare un nemico o succede qualcosa); un nemico: ci vai e attacchi (se è accanto, subito); un oggetto: ci vai e lo raccogli; le scale: ci vai e scendi; negozio, panchina, terminale: ci vai e lo usi.
- tocca te stesso: aspetti un turno (sulle scale: scendi). Doppio tocco (o tieni premuto) su di te: **Cerca**.
- tieni premuto (400 ms) su casella, mostro o oggetto: scheda con nome, descrizione, PS e danno dei mostri, senza agire; si chiude al tocco successivo.
- trascina: sposti la vista (si ricentra sull'eroe appena fai un turno); pizzica o usa + / − : tre livelli di zoom. Lo scorrimento NON muove più l'eroe.
- barra in basso: Aspetta, Cerca, Zaino e 4 slot rapidi. Tocca uno slot per usare (bere, leggere, mangiare, equipaggiare, chiavetta); per gli oggetti da lancio entra nella mira: il tocco successivo su una casella visibile (portata 6) lancia. Tieni premuto uno slot per scegliere cosa ci sta (si riempiono da soli con gli oggetti nuovi; "Vuoto" li lascia liberi). Tastiera: 1-4.
- Feedback: casella bersaglio evidenziata e puntini sul percorso, vibrazione breve (`navigator.vibrate`) quando colpisci o manchi. Con `prefers-reduced-motion` le camminate non hanno pause. La mappa ha `touch-action: none`, niente selezione né menu di pressione lunga.
**Croce direzionale**: frecce, Aspetta, Cerca e i tasti Zaino/Abilità/Esplora/Scale/Mangia/Bevi; i tocchi sulla mappa funzionano comunque.
**Tastiera**: frecce o WASD, spazio aspetta, C cerca, 1-4 slot, I zaino, E esplora, F abilità, > scale, B nascondi.
Il significato dei tocchi sta in `intentForTap(s, x, y, 'tap'|'double'|'long', aim)` e `slotIntent` in `game.js` (funzioni pure, testate in `tests/dungeon-touch.test.js`); `dungeon.js` si limita a eseguire l'intento.
Azioni nuove delle regole: `search` (raggio 3, certa a 1 casella, meno sicura più lontano; un turno) e `throw {i,x,y}` (oggetti di categoria `throw`: dardi, CD, taglierino; portata 6, colpisce il primo mostro sulla linea, il 60% si può recuperare).

## Lingue (EN predefinita, IT)
Le regole (`game.js`) non scrivono mai frasi: `log(s, 'chiave', {parametri}, colore)` salva un messaggio `{m:{k,p}}` e la pagina lo traduce con `G.text(msg, lang)` / `G.logText(voce, lang)`. Nei parametri gli id (mob, item, skill, cls, active, trap, sector, intro, verb, desc) diventano nomi nella lingua scelta. Così una partita salvata si legge in entrambe le lingue e il cambio lingua (EN | IT nel Menu, evento `vb-lang`) funziona a partita in corso. Le partite salvate prima con testo semplice (`{t:'…'}`) si mostrano com'erano.
- Testi delle tabelle (mostri, oggetti, classi, abilità, settori, trappole, medaglie, potenziamenti): oggetti `{ en: '…', it: '…' }` dentro la voce stessa. Entrambe obbligatorie.
- Altre frasi: chiave in `MSG` di `text.js` con `{en, it}`; stessi segnaposto `{x}` nelle due lingue.
- Test: `tests/dungeon-i18n.test.js` (due lingue presenti, segnaposto uguali, nessun italiano nell'inglese e viceversa, chiavi usate esistenti, vecchi salvataggi).

## Aggiungere contenuti
- Mostro: una riga `mk(settore, { id, name, shape, col, info, …comportamenti })` in `mobs.js` (numeri calcolati dal settore; `hpx`, `atkx`, `xpx` per ritoccarli).
- Oggetto: un oggetto in `items.js`; se usa un effetto nuovo, aggiungi la funzione in `EFFECTS` di `game.js`.
- Disegno: otto righe da otto caratteri in `sprites.js`.
- Settore: un oggetto in `SECTORS` (ogni settore dura 5 piani, il boss è all'ultimo), poi mostri e boss con `mk`.
- Classe, abilità, potenziamento, medaglia: un oggetto nella tabella giusta.

## Com'è fatta una partita
10 settori da 5 piani (50 piani), un boss ogni 5 piani (le scale restano bloccate). Dopo ogni boss c'è la Sala Server: negozio, panchina (riposo e riciclo) e scale per il settore dopo. Si salva dopo ogni turno e si riprende esattamente da lì.
Fuori dalla partita: Archivio (albero dei potenziamenti comprati con i crediti, medaglie, bestiario, storia), livelli di accesso (si sblocca il successivo vincendo; mostri +30% vita e più forti), sfida del giorno (seme dalla data).

## Stato e idee future
Fatto: motore, 10 settori con 74 tipi di nemico e 10 boss, 54 oggetti, 8 classi, hub, negozi, potenziamenti, 33 medaglie, bestiario, accesso, sfida del giorno.
Da fare: 80+ nemici e 200+ oggetti, 12 boss (mini-boss a metà settore), crafting vero (ora c'è il riciclo), pericoli di terreno per settore (acqua, lava, buio), altri disegni per i mostri, bilanciamento con partite vere.
