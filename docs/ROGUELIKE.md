# Il Dungeon del Server (roguelike)

Pagina `public/pages/dungeon.html`, interfaccia `public/js/dungeon.js`, regole in `public/js/rogue/` (senza DOM, testabili da Node).
Test: `tests/dungeon.test.js` e `tests/dungeon-touch.test.js`. Nessuna rete: tutto sta nel browser (localStorage: `vb_dg_run` partita, `vb_dg_meta` profilo, `vb_dg_opt` opzioni).

## Come è fatto
- `rng.js` numeri casuali con seme (tutta la partita è un oggetto JSON: stesso seme, stessa partita).
- `map.js` piani (stanze e corridoi, porte segrete), campo visivo, percorsi. Un piano dipende solo da (seme, piano).
- `mobs.js` settori e mostri (dati). `items.js` oggetti (dati). `classes.js` classi e abilità (dati). `meta.js` albero dei potenziamenti e medaglie (dati). `sprites.js` vecchi disegni 8x8 (restano come ripiego), `sprites-art*.js` disegni 16x16 (vedi sotto).
- `game.js` le regole: `newGame`, `act`, `save/load`, profilo (`recordRun`, `buyUpgrade`, `checkMedals`).
- `hazards.js` i pericoli del terreno (uno per settore). `sprites-tiles.js` l'aspetto dei piani (un set di tessere per settore) e i disegni dei pericoli. `recipes.js` le ricette del banco di lavoro e gli oggetti creati. `text-systems.js` le frasi di questi sistemi (si fonde dentro `MSG` di `text.js`).
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

## Movimento in 8 direzioni
Eroe e mostri si muovono e colpiscono anche in diagonale. Regola dell'angolo (`MAP.diagOk`): una diagonale è permessa solo se le due caselle ortogonali accanto sono libere (niente muro, niente mobili) e né la casella di partenza né quella d'arrivo è una porta (le porte si passano dritte). I mobili (negozio, panchina, terminale) si usano solo di lato. Tutti i percorsi (tocca per camminare, Esplora, inseguimento dei mostri) usano `flood`/`downhill` con 8 vicini e la stessa regola, e a parità scelgono il passo dritto. Il campo visivo non cambia. `G.touching(s, e)` dice se un mostro è colpibile. Croce direzionale 3x3 (centro = aspetta); tastiera: Y U V N (e Q) per le diagonali, tastierino numerico 1-9 (il B è il tasto "nascondi").

## Dormi
Azione `sleep` (pulsante Dormi, pressione lunga su Aspetta, tasto Z): un turno di sonno alla volta, la pagina li ripete finché `s.sleeping > 0` (ogni turno è salvato e un tocco interrompe). Si cura il doppio più in fretta, la fame va a ritmo normale, i mostri ti notano da 2 caselle più lontano. Rifiutato con un nemico in vista, con fame (< 150) o a vita piena. Si sveglia da solo per: mostro in vista ("X compare!"), ferita, fame, vita piena, 100 turni.

## Pericoli del terreno
Ogni settore ha il suo pericolo (`hazards.js`): Scantinato pozza velenosa, Aula Server ghiaccio (scivoli di una casella), Cablaggi cavo scoperto (scossa), Rete flusso di pacchetti (ti spinge; controcorrente no), Archivio scaffale che crolla (una volta), Cloud nebbia (nasconde mostri e oggetti finché non sei accanto), Firewall fiamme (danno e bruciatura), Kernel lag (perdi il turno), Mainframe calore (perdi fame e ricarica dell'abilità), Root un misto. Sono a chiazze di 2-4 caselle, 1-4 chiazze per piano (di più andando avanti nel settore), dal seme (`placeHazards` in `game.js`, stesso seme = stessi pericoli), mai sull'inizio, sulle scale o su oggetti/mostri/trappole, e **mai tagliano il piano**: ogni casella raggiungibile senza pericoli lo resta (controllato casella per casella e dai test su 300 semi per settore). Si vedono sempre, la scheda (pressione lunga) li spiega, il cammino automatico li aggira (`knownPass`; solo se non c'è altra via ci passa) e Esplora non li usa mai come meta. Il danno cresce poco: +1 ogni 8 piani e +1 per livello di accesso (`damageRange`).
- **Aggiungere un pericolo**: un oggetto in `LIST` di `hazards.js` (id, sector, kind, name, info, col, shape, dmg/turns/food), il disegno in `SPR` di `sprites-tiles.js`; i testi dei messaggi `haz_<kind>` in `text-systems.js`. Un tipo nuovo: una funzione in `HAZARD_FX` di `game.js` (riceve stato, casella, definizione, passo).
- **Aspetto di un settore**: la sua voce in `SETS` di `sprites-tiles.js` (due pavimenti e un muro 8x8, due colori d'accento).

## Banco di lavoro (crafting)
Alla panchina della Sala Server: "Banco di lavoro", si scelgono 2 o 3 oggetti dallo zaino (una pila conta un'unità per tocco) e si preme Unisci. Se corrispondono a una ricetta (in qualsiasi ordine) vengono consumati e arriva il risultato; altrimenti non succede nulla e non si perde niente. Non costa turni. Le ricette scoperte stanno nel ricettario (sul banco) e si conservano tra le partite (`meta.recipes`); l'oggetto Ricettario (`c_ricettario`, raro dal piano 2) le rivela tutte.
- **Aggiungere una ricetta**: un oggetto in `RECIPES` di `recipes.js`: `id`, `name {en,it}`, `in` (2 o 3 id oggetto o `'cat:usb'`), `out` (`{ give: [id o {k, n}] }` oppure `{ fn: 'nome' }` con la funzione in `CRAFT_FX` di `game.js`). Gli ingressi non devono ripetersi tra ricette (i test lo controllano) e gli oggetti nuovi vanno in `ITEMS` dello stesso file (`from: 99` = solo creabili).

## Élite (mini-boss) e comportamenti nuovi
Un mostro di `mobs.js` con `elite: true` (3° piano del settore in cui iniziano i suoi `floors`) o `elite: <numero piano>` compare una volta per piano, addormentato in una stanza tutta sua (`MAP.generate(seed, depth, { elite: true })` segna `room.elite`; il resto del piano non cambia), con corona e cornice oro; alla morte lascia sempre un oggetto (`drop: 'id'` nel mostro, altrimenti uno buono a caso) e dà il messaggio di vittoria. Le élite non escono come mostri normali.
Un flag nuovo su un mostro diventa comportamento con una funzione in `G.MOB_HOOKS.turn|hit|death` sotto il nome del flag (vedi il commento in `game.js`): nessun'altra modifica al motore.

## Lingue (EN predefinita, IT)
Le regole (`game.js`) non scrivono mai frasi: `log(s, 'chiave', {parametri}, colore)` salva un messaggio `{m:{k,p}}` e la pagina lo traduce con `G.text(msg, lang)` / `G.logText(voce, lang)`. Nei parametri gli id (mob, item, skill, cls, active, trap, sector, intro, verb, desc) diventano nomi nella lingua scelta. Così una partita salvata si legge in entrambe le lingue e il cambio lingua (EN | IT nel Menu, evento `vb-lang`) funziona a partita in corso. Le partite salvate prima con testo semplice (`{t:'…'}`) si mostrano com'erano.
- Testi delle tabelle (mostri, oggetti, classi, abilità, settori, trappole, medaglie, potenziamenti): oggetti `{ en: '…', it: '…' }` dentro la voce stessa. Entrambe obbligatorie.
- Altre frasi: chiave in `MSG` di `text.js` con `{en, it}`; stessi segnaposto `{x}` nelle due lingue.
- Test: `tests/dungeon-i18n.test.js` (due lingue presenti, segnaposto uguali, nessun italiano nell'inglese e viceversa, chiavi usate esistenti, vecchi salvataggi).

## Come disegnare uno sprite
Motore: `public/js/rogue/sprites-art.js` (`Rogue.art`). I disegni stanno in `sprites-art-heroes.js` (8 eroi + base), `sprites-art-mobs.js` (archetipi e singoli mostri), `sprites-art-bosses.js` (10 boss), `sprites-art-items.js` (oggetti, arredi, effetti `fx:*`). Ogni file chiama `A.add({ chiave: { r: [16 righe] } })`.
- **Formato**: 16 stringhe da 16 caratteri. `.` vuoto. Ogni carattere e' un RUOLO di colore, ricavato dal colore `col` del mostro/oggetto (stesso disegno, tanti colori): `o` contorno scuro, `s` ombra, `b` base (il colore stesso), `l` luce, `a` accento (caldo se il colore e' freddo e viceversa), `e` pupilla, `w` bianco. Colori fissi comuni: `n`/`N` pelle, `h`/`H` capelli, `k` metallo scuro, `g`/`G` grigi, `y` oro, `r` rosso, `t` legno, `p` carta, `c` vetro. Un disegno puo' ridefinire un carattere con `p: { x: 'ruolo' | '#rrggbb' }`.
- **Tre toni piu' contorno**: contorno, ombra, base, luce. Regola: contorno sempre intorno alla sagoma, luce in alto a sinistra, ombra in basso a destra, occhi con `w`+`e` (pupille verso il centro = cattivo). Il piano deve restare leggibile a 24 px su pavimento scuro: sagoma prima, dettagli poi.
- **Simmetria**: `A.mirror([8 colonne sinistre x 16 righe], [[riga, colonna, 'testo'], ...])` specchia, poi scrive le parti asimmetriche (usato per boss e oggetti). Per gli eroi `hero(patches)` parte dal corpo comune e cambia solo le righe che servono.
- **Animazione**: `A.add(defs, { anim: true })` (eroi, mostri, boss). Il fotogramma 1 abbassa di 1 px le prime `bob` righe (predefinito 10; per i volanti `bob: 13/14` = tutto il corpo); `f2: [[riga, col, 'c'], ...]` ritocca pixel solo nel fotogramma 1 (occhi, bocca). `A.sprite(nome, col, frame)`; senza `frame` segue l'orologio a 2 fps e sotto `prefers-reduced-motion` resta fermo. Una piccola canvas per (nome, colore, fotogramma), cache limitata a 500 (poi si svuota).
- **Chiavi e ripiego**: `A.chain(voce, 'm'|'i'|'h')` costruisce `sprite > m:<id> > archetype > shape > m:generic` (per gli oggetti `i:<id>` e `i:generic`, per gli eroi `hero:<classe>` e `hero`). Si disegna il primo nome che esiste; i vecchi 8x8 di `sprites.js` contano come esistenti (raddoppiati); chiave sconosciuta = punto interrogativo rosso `fx:unknown`. Nelle voci dei dati si puo' scrivere `sprite: 'chiave'` e `archetype: 'bug'` oltre a `shape`.
- **Aggiungere un mostro**: (1) se somiglia a un archetipo (`bug worm bat blob human ghost eye spider swarm robot hood chest daemon printer script crown`) basta `shape`/`archetype` + `col`: nessun disegno nuovo. (2) per un disegno proprio aggiungi `'m:<id>': { r: [...] }` in `sprites-art-mobs.js` (boss: `-bosses.js`). Oggetto: `'i:<id>'` in `-items.js` (`alias` li riusa). Eroe: `'hero:<id classe>'`.
- **Controllo**: apri `tools/sprite-sheet.html` direttamente dal disco (nessun server): ogni sprite a 64 px (due fotogrammi) e a 16/24/36 px, cornice arancione = disegnato da un ripiego, elenco "Fallbacks" in fondo. `?only=heroes|mobs|items|keys|strip`, `?f=testo` filtra, `?floor=%23rrggbb` cambia lo sfondo. Test: `tests/sprites.test.js` (16x16, caratteri definiti, ogni chiave dei dati si risolve, due fotogrammi, cache limitata).
- Se cambi un file `sprites-art*.js` alza il suo `?v=` in `dungeon.html`.

## Aggiungere contenuti
- Mostro: una riga `mk(settore, { id, name, shape, col, info, …comportamenti })` in `mobs.js` (numeri calcolati dal settore; `hpx`, `atkx`, `xpx` per ritoccarli).
- Oggetto: un oggetto in `items.js`; se usa un effetto nuovo, aggiungi la funzione in `EFFECTS` di `game.js`.
- Disegno: sedici righe da sedici caratteri in `sprites-art-*.js` (vedi "Come disegnare uno sprite").
- Settore: un oggetto in `SECTORS` (ogni settore dura 5 piani, il boss è all'ultimo), poi mostri e boss con `mk`.
- Classe, abilità, potenziamento, medaglia: un oggetto nella tabella giusta.

## Com'è fatta una partita
10 settori da 5 piani (50 piani), un boss ogni 5 piani (le scale restano bloccate). Dopo ogni boss c'è la Sala Server: negozio, panchina (riposo e riciclo) e scale per il settore dopo. Si salva dopo ogni turno e si riprende esattamente da lì.
Fuori dalla partita: Archivio (albero dei potenziamenti comprati con i crediti, medaglie, bestiario, storia), livelli di accesso (si sblocca il successivo vincendo; mostri +30% vita e più forti), sfida del giorno (seme dalla data).

## Contenuti (numeri)
91 tipi di nemico normali (9-10 per settore, comportamenti diversi nello stesso settore: lo controlla `tests/dungeon-content.test.js`), 12 boss (uno per settore; i settori 5 e 10 ne hanno due), 10 mini-boss (uno per settore, al piano 3 del settore), 238 oggetti (59 armi di cui 22 uniche, 33 protezioni, 12 da lancio, 16 cibi, 27 lattine, 32 script, 22 chiavette, 37 plugin), 8 classi con 4 abilità proprie ciascuna (+ le comuni).
- Mini-boss: `mini(settore, {...})` in `mobs.js` (`mini: piano`, `floors: [0, 0]` li tiene fuori dal sorteggio normale, `drop` = oggetto che lasciano sempre, `info` = la frase mostrata all'arrivo). Gli oggetti dei mini-boss hanno `from: 99`: non si trovano per terra.
- Oggetti: aiutanti `W` (arma), `A` (protezione), `T` (lancio), `F` (cibo), `I` (resto) in `items.js`; `from`/`to` sono piani (il settore n inizia al piano 5n-4). Il prezzo di armi e protezioni segue i numeri.
- Immagini: ogni voce nuova ha `sprite` (chiave descrittiva, `monster_<id>` o `item_<id>`) e `shape` (archetipo già esistente in `sprites.js`, usato finché l'immagine non c'è). Il commento `// art:` accanto a ogni mostro nuovo dice cosa disegnare.
- Cosa NON c'è perché il motore non lo sa fare: armi con portata o furto di vita, oggetti maledetti/benedetti, chiavi, set di armature con bonus, effetti nuovi. Le armi uniche variano solo danno, mira, critici e danno ai non-morti.
- Ganci del motore richiesti: `docs/rogue-engine-hooks.patch` (da applicare a `game.js` quando l'agente dei sistemi lo permette): `to` nelle tabelle di bottino (gli oggetti bassi spariscono nei settori alti), spawn del mini-boss (+ messaggio `mini_here`, già in `text.js`), `drop` alla morte, e due boss sullo stesso piano scelti dal seme (`bossOf(depth, seed)`). Senza il patch i dati sono validi ma i mini-boss non compaiono e il secondo boss dei settori 5 e 10 non viene scelto.

## Bilanciamento
`node tools/rogue-balance.js [partite per classe=200] [turni max=40000] [classe,classe]` fa giocare a un bot semplice (combatte, equipaggia il meglio, beve, mangia, usa l'abilità, compra cure) partite con seme, e stampa per classe: piano medio raggiunto, % vittorie, turni medi, morti per settore. Obiettivo: un bot decente muore in media tra i settori 4 e 7 e una partita fortunata o forte vince. Ritocchi fatti per arrivarci: vita e bonus di base delle classi, rapporto tra cure e cibo nel bottino, mostri nuovi dei primi settori più deboli.

Ultima misura (12 partite per classe, bot semplice, 20000 turni al massimo; 200 per classe con il comando sopra richiede ore su un PC condiviso):

| classe | piano medio | vittorie | morti nei settori 1..10 |
|---|---|---|---|
| studente | 22.7 | 0% | 0 1 1 1 4 0 0 3 0 0 |
| hacker | 17.0 | 0% | 0 0 6 4 1 0 0 1 0 0 |
| prof | 13.2 | 0% | 0 5 4 1 0 0 1 0 0 0 |
| tecnico | 17.8 | 0% | 0 2 5 2 1 0 0 2 0 0 |
| bidello | 28.8 | 0% (15% in una misura da 20) | 0 0 0 3 3 1 2 1 0 1 |
| sistemista | 15.0 | 0% | 1 2 4 2 2 1 0 0 0 0 |
| designer | 13.1 | 0% | 0 1 10 1 0 0 0 0 0 0 |
| segreteria | 14.8 | 0% | 2 0 6 1 2 1 0 0 0 0 |
| **tutte** | **17.8 (settore 4)** | ~2% | muro al settore 3 |

Il bot è più debole di una persona (non scappa, non sceglie le abilità), quindi 4-5 settori di media sono in linea con l'obiettivo 4-7. Da ritoccare: il settore 3 (cavi: ranged corto, nodo che si divide) uccide troppo le classi fragili (designer, segreteria); bidello e studente sono i più forti. I mini-boss non entrano nella misura finché non c'è il patch del motore.

## Stato e idee future
Fatto: motore, 10 settori con 74 tipi di nemico e 10 boss, 54 oggetti, 8 classi, hub, negozi, potenziamenti, 33 medaglie, bestiario, accesso, sfida del giorno.
Da fare: 80+ nemici e 200+ oggetti, 12 boss e le élite vere (il motore c'è, mancano le definizioni), altri disegni per i mostri, bilanciamento con partite vere.

Fatto: motore, 10 settori con 91 tipi di nemico, 12 boss e 10 mini-boss, 238 oggetti, 8 classi con abilità proprie, hub, negozi, potenziamenti, 33 medaglie, bestiario, accesso, sfida del giorno.
Da fare: ganci del motore per mini-boss e `to` (vedi sopra), crafting vero (ora c'è il riciclo), pericoli di terreno per settore (acqua, lava, buio), disegni per le chiavi `sprite` nuove, bilanciamento con partite vere.
