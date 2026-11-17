# Il Dungeon del Server (roguelike)

Pagina `public/pages/dungeon.html`, interfaccia `public/js/dungeon.js`, regole in `public/js/rogue/` (senza DOM, testabili da Node).
Test: `tests/dungeon.test.js`. Nessuna rete: tutto sta nel browser (localStorage: `vb_dg_run` partita, `vb_dg_meta` profilo, `vb_dg_opt` opzioni).

## Come è fatto
- `rng.js` numeri casuali con seme (tutta la partita è un oggetto JSON: stesso seme, stessa partita).
- `map.js` piani (stanze e corridoi, porte segrete), campo visivo, percorsi. Un piano dipende solo da (seme, piano).
- `mobs.js` settori e mostri (dati). `items.js` oggetti (dati). `classes.js` classi e abilità (dati). `meta.js` albero dei potenziamenti e medaglie (dati). `sprites.js` disegni 8x8.
- `game.js` le regole: `newGame`, `act`, `save/load`, profilo (`recordRun`, `buyUpgrade`, `checkMedals`).
- Ogni file di dati ha in cima un commento che spiega come aggiungere un elemento.

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
