// js/rogue/mobs.js — the sectors of the datacentre, the monsters that live in them and the traps. Data only.
//
// HOW TO ADD A SECTOR: add one object to SECTORS (name, colours). Every sector is PER_SECTOR floors deep and the game
// is as long as the list: a new sector makes the run 5 floors longer. Give it monsters (below) and a boss.
//
// SHORTCUT FOR SECTORS 2+: mk(sector, { id, name, shape, col, info, …behaviours }) fills floors (the sector's 5 floors),
// hp, atk and xp from the depth of the sector; hpx / atkx / xpx multiply them (1 = normal, 0.5 = weak, 2 = tough).
// A boss is mk(sector, { …, boss: true }): it gets the last floor of the sector and about 3x the life.
// HOW TO ADD A MONSTER: add one object to LIST. Needed: id, name, shape (a picture in sprites.js), col, hp,
// atk [min, max], xp, floors [first, last] (absolute floor numbers: sector 1 is 1-5, sector 2 is 6-10…).
// Optional numbers: def (armour), acc (aim), dodge, w (how common, default 10), speed (2 = two moves a turn, 0.5 = one every two).
// Optional behaviours (mix them freely):
//   erratic: 0.5        moves at random half of the time
//   ranged: { range, dmg: [a, b], verb }   attacks from far when it sees you
//   summon: { k: 'id', every: 5 }          calls another monster every 5 turns
//   steal: 'gold' | 'item'                 robs you, runs away and disappears if you lose sight of it
//   poison: 5, weaken: true, stun: true, confuse: true, leech: true    what its hit does to you
//   regen: 1            heals every turn          split: true     divides when hit
//   explode: [a, b]     bursts when it dies       phase: true     walks through walls
//   invisible: true     seen only from one step   ambush: true    looks like a crate until you are next to it
//   still: true         never moves               coward: true    runs when badly hurt
//   blink: true         teleports when hit        undead: true    (some weapons and skills hit these harder)
//   boss: 5             the boss of floor 5: the stairs stay locked until it dies. The boss of the last floor ends the game.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else (root.Rogue = root.Rogue || {}).mobs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const PER_SECTOR = 5;
    const SECTORS = [
        { id: 'scantinato', name: 'Scantinato', wall: '#3d4a3f', edge: '#57695a', floor: '#161b17', dot: '#232b25',
          intro: 'Sotto la palestra c’è una porta che nessuno apre dal 1998. Dietro: polvere, cavi e qualcosa che ronza.' },
        { id: 'aula', name: 'Aula Server', wall: '#2f4a5e', edge: '#4a7691', floor: '#0e1519', dot: '#1b2a33', intro: 'Rack in fila, ventole che soffiano. Qualcuno ha lasciato un registro delle presenze: i nomi cambiano da soli.' },
        { id: 'cablaggi', name: 'Cablaggi', wall: '#5a4a2a', edge: '#8a7240', floor: '#181409', dot: '#2a2210', intro: 'Canaline ovunque. Migliaia di cavi, tutti etichettati “prova”.' },
        { id: 'rete', name: 'Rete', wall: '#2a4f4f', edge: '#3f8a8a', floor: '#081616', dot: '#102a2a', intro: 'Qui i pacchetti viaggiano a piedi. Alcuni si sono persi e non sono contenti.' },
        { id: 'archivio', name: 'Archivio', wall: '#5a3f2e', edge: '#8a6448', floor: '#150f0b', dot: '#261b14', intro: 'Faldoni, nastri, floppy. Tutto è catalogato. Nulla si trova.' },
        { id: 'cloud', name: 'Cloud', wall: '#3f4f7a', edge: '#6a82c0', floor: '#0b0f1c', dot: '#171e36', intro: 'Il soffitto è sparito. Pare di camminare su un abbonamento mensile.' },
        { id: 'firewall', name: 'Firewall', wall: '#7a2f2f', edge: '#c04a4a', floor: '#190909', dot: '#2e1313', intro: 'Pareti rosse e regole in elenco. Tutto ciò che non è permesso è vietato. Tu non sei permesso.' },
        { id: 'kernel', name: 'Kernel', wall: '#5a2f7a', edge: '#8f4ac0', floor: '#110918', dot: '#20122e', intro: 'Il cuore del sistema. Si sente un battito: è il clock.' },
        { id: 'mainframe', name: 'Mainframe', wall: '#4f5a2a', edge: '#82924a', floor: '#0f1308', dot: '#1d240f', intro: 'Una sala grande come una chiesa. Il computer più vecchio dell’edificio, e il più orgoglioso.' },
        { id: 'root', name: 'Root', wall: '#7a6a2f', edge: '#c0a84a', floor: '#181508', dot: '#2c260f', intro: 'Nessun muro vero: solo permessi. In fondo, una finestra con scritto “#”.' },
    ];
    const FIRST = 1;
    /** Fills the numbers of a monster from the depth of its sector (1-based). */
    function mk(sector, o) {
        const d = sector * 5 - 2, lo = 5 * (sector - 1) + 1, boss = !!o.boss, hx = (o.hpx || 1) * (boss ? 3.2 : 1), ax = (o.atkx || 1) * (boss ? 1.3 : 1);
        const m = Object.assign({
            hp: Math.round((5 + 0.9 * Math.pow(d, 1.25)) * hx), atk: [Math.max(1, Math.round((1 + d / 6) * ax)), Math.round((3 + d / 3.2) * ax)],
            xp: Math.round((2 + d * 0.8) * (o.xpx || 1) * (boss ? 5 : 1)), floors: [lo, lo + 4],
        }, o);
        delete m.hpx; delete m.atkx; delete m.xpx;
        if (boss) { m.boss = sector * 5; delete m.floors; }
        return m;
    }
    const LIST = [
        // ── settore 1: Scantinato (piani 1-5)
        { id: 'bug', name: 'Bug', shape: 'bug', col: '#7bd86a', hp: 5, atk: [1, 3], xp: 2, floors: [1, 3],
          info: 'Piccolo, verde, ovunque. Nessuno sa chi l’ha scritto.' },
        { id: 'topo', name: 'Topo di rete', shape: 'bat', col: '#b9a48a', hp: 4, atk: [1, 2], dodge: 3, speed: 2, erratic: 0.5, xp: 3, floors: [1, 5],
          info: 'Rosicchia i cavi e scappa in ogni direzione.' },
        { id: 'polvere', name: 'Gomitolo di polvere', shape: 'blob', col: '#9a94a8', hp: 12, atk: [1, 3], speed: 0.5, split: true, xp: 3, floors: [2, 5],
          info: 'Se lo colpisci si divide. Andava passato l’aspirapolvere.' },
        { id: 'ragno', name: 'Ragno dei cavi', shape: 'spider', col: '#c97fd8', hp: 7, atk: [1, 3], poison: 4, xp: 4, floors: [2, 5],
          info: 'Il suo morso dà la scossa per qualche turno.' },
        { id: 'cavo', name: 'Cavo vivo', shape: 'worm', col: '#e8b84a', hp: 9, atk: [1, 5], def: 1, xp: 5, floors: [1, 5],
          info: 'Un cavo di rete che ha deciso di non farsi più calpestare.' },
        { id: 'stampante', name: 'Stampante posseduta', shape: 'printer', col: '#8fa3b8', hp: 8, atk: [1, 3], still: true, w: 6,
          ranged: { range: 5, dmg: [1, 4], verb: 'ti spara un foglio inceppato' }, xp: 6, floors: [2, 5],
          info: 'Non si muove, ma stampa. Contro di te.' },
        { id: 'kiddie', name: 'Script kiddie', shape: 'hood', col: '#5fb4e8', hp: 10, atk: [1, 3], dodge: 2, steal: 'gold', w: 6, xp: 6, floors: [2, 5],
          info: 'Ti svuota il portafoglio e scappa. Se lo prendi, riprendi tutto.' },
        { id: 'cassa', name: 'Scatolone sospetto', shape: 'chest', col: '#b98a55', hp: 16, atk: [3, 7], ambush: true, w: 3, xp: 9, floors: [3, 5],
          info: 'Sembra uno scatolone. Morde.' },
        { id: 'boss1', name: 'Il Nido dei Bug', shape: 'bug', col: '#ffb000', hp: 48, atk: [2, 6], def: 1, acc: 1, boss: 5,
          summon: { k: 'bug', every: 4 }, xp: 40,
          info: 'Il primo bug mai scritto in questa scuola. Da allora ne produce altri.' },

        // ── settori 2-10 (numeri dal settore, vedi mk)
        mk(2, { id: 'cavorack', name: 'Cavo da rack', shape: 'worm', col: '#4aa8e8', poison: 4, info: 'Si arrotola intorno alle caviglie e punge.' }),
        mk(2, { id: 'ventola', name: 'Ventola impazzita', shape: 'eye', col: '#9ab0c0', speed: 2, erratic: 0.4, hpx: 0.6, info: 'Gira, gira, gira. Si ferma solo per colpirti.' }),
        mk(2, { id: 'phish', name: 'Phishing', shape: 'hood', col: '#e8d45a', steal: 'item', w: 6, dodge: 2, info: 'Ti scrive che hai vinto un premio. In realtà ti prende lo zaino.' }),
        mk(2, { id: 'spam', name: 'Nugolo di spam', shape: 'swarm', col: '#e88ac0', split: true, hpx: 0.8, info: 'Se ne elimini uno, ne arrivano due.' }),
        mk(2, { id: 'bkcorr', name: 'Backup corrotto', shape: 'ghost', col: '#a8a0c8', undead: true, leech: true, info: 'Dovevi controllarlo. Non l’hai fatto.' }),
        mk(2, { id: 'switch', name: 'Switch guasto', shape: 'robot', col: '#8fb4e8', stun: true, def: 1, info: 'Tutte le porte accese, nessuna che funziona.' }),
        mk(2, { id: 'stampa2', name: 'Stampante di rete', shape: 'printer', col: '#d8d8e8', still: true, w: 6, ranged: { range: 6, dmg: [2, 5], verb: 'ti lancia un toner' }, info: 'Coda di stampa: 4000 documenti. Tutti per te.' }),
        mk(2, { id: 'boss2', name: 'L’Admin Dimenticato', shape: 'human', col: '#ffb000', boss: true, summon: { k: 'spam', every: 5 }, def: 1, info: 'Nessuno ricorda la sua password. Neanche lui.' }),
        mk(3, { id: 'serpe', name: 'Serpente di cavi', shape: 'worm', col: '#e8964a', poison: 5, info: 'Cat 6, lunghissimo.' }),
        mk(3, { id: 'corto', name: 'Cortocircuito', shape: 'eye', col: '#fff060', ranged: { range: 5, dmg: [3, 7], verb: 'ti fulmina' }, hpx: 0.6, erratic: 0.3, info: 'Un lampo in cerca di un conduttore. Sei tu.' }),
        mk(3, { id: 'crimpa', name: 'Crimpatrice', shape: 'robot', col: '#c0c0d0', def: 2, hpx: 1.2, info: 'Stringe fino al clic.' }),
        mk(3, { id: 'ratto', name: 'Ratto di canalina', shape: 'bat', col: '#b9a48a', speed: 2, erratic: 0.4, hpx: 0.5, info: 'Veloce e affamato di guaina.' }),
        mk(3, { id: 'fibra', name: 'Fibra spezzata', shape: 'spider', col: '#6ae8e8', poison: 6, w: 8, info: 'Una scheggia di vetro che cammina.' }),
        mk(3, { id: 'nodo', name: 'Nodo gordiano', shape: 'blob', col: '#c9b07a', split: true, speed: 0.5, hpx: 1.4, info: 'Taglialo e diventa due nodi.' }),
        mk(3, { id: 'manut', name: 'Manutentore stanco', shape: 'human', col: '#5a8fe8', steal: 'gold', coward: true, w: 6, info: 'Ti chiede i soldi per il cavo e scappa.' }),
        mk(3, { id: 'boss3', name: 'La Matassa', shape: 'worm', col: '#ffb000', boss: true, poison: 6, summon: { k: 'ratto', every: 5 }, info: 'Un groviglio grande come un autobus.' }),
        mk(4, { id: 'pacchetto', name: 'Pacchetto perso', shape: 'ghost', col: '#8fd0e8', blink: true, undead: true, info: 'Cerca il destinatario. Ti ha scambiato per lui.' }),
        mk(4, { id: 'pingmorte', name: 'Ping della morte', shape: 'eye', col: '#ff6a6a', ranged: { range: 6, dmg: [3, 8], verb: 'ti spara un pacchetto enorme' }, hpx: 0.7, info: '65.535 byte di cattive intenzioni.' }),
        mk(4, { id: 'mitm', name: 'Man in the middle', shape: 'hood', col: '#c97fd8', steal: 'item', dodge: 3, w: 6, info: 'Si mette in mezzo. Sempre.' }),
        mk(4, { id: 'ddos', name: 'DDoS', shape: 'swarm', col: '#ff8a4a', speed: 2, split: true, hpx: 0.7, info: 'Sono in tanti, e sono tutti uguali.' }),
        mk(4, { id: 'routerr', name: 'Router rabbioso', shape: 'robot', col: '#6ad87b', stun: true, hpx: 1.2, info: 'Lampeggia tutto: non è un buon segno.' }),
        mk(4, { id: 'sniffer', name: 'Sniffer', shape: 'spider', col: '#e8e8a0', invisible: true, w: 6, info: 'Lo senti prima di vederlo.' }),
        mk(4, { id: 'boss4', name: 'Il Gateway', shape: 'robot', col: '#ffb000', boss: true, stun: true, summon: { k: 'ddos', every: 6 }, info: 'Tutto passa da lui. Anche tu, adesso.' }),
        mk(5, { id: 'faldone', name: 'Faldone vivente', shape: 'chest', col: '#c9a070', ambush: true, w: 4, hpx: 1.3, info: 'Sembrava una pratica da archiviare.' }),
        mk(5, { id: 'logeterno', name: 'Log infinito', shape: 'worm', col: '#9ab07a', regen: 1, hpx: 1.2, info: 'Ogni riga ne genera due. Non finisce.' }),
        mk(5, { id: 'bibli', name: 'Bibliotecaria fantasma', shape: 'ghost', col: '#e8e0c8', undead: true, weaken: true, info: 'Shhh. Poi colpisce.' }),
        mk(5, { id: 'pdfrot', name: 'PDF corrotto', shape: 'printer', col: '#e85a5a', still: true, ranged: { range: 6, dmg: [3, 8], verb: 'ti spara pagine nere' }, w: 6, info: 'Non si apre. Si apre da solo contro di te.' }),
        mk(5, { id: 'tarlo', name: 'Tarlo digitale', shape: 'bug', col: '#c0a060', def: 2, info: 'Mangia i file e la pazienza.' }),
        mk(5, { id: 'nastro', name: 'Nastro magnetico', shape: 'worm', col: '#6a6a7a', leech: true, info: 'Si riavvolge intorno alla vita.' }),
        mk(5, { id: 'boss5', name: 'La Grande Bibliotecaria', shape: 'ghost', col: '#ffb000', boss: true, weaken: true, undead: true, summon: { k: 'bibli', every: 7 }, info: 'Il regolamento dice: silenzio. Il regolamento dice anche altro.' }),
        mk(6, { id: 'nuvola', name: 'Nuvola temporalesca', shape: 'blob', col: '#8aa0d8', ranged: { range: 5, dmg: [4, 9], verb: 'ti fulmina' }, info: 'Piove dati. A dirotto.' }),
        mk(6, { id: 'latenza', name: 'Latenza', shape: 'ghost', col: '#b0b8d0', blink: true, undead: true, info: 'È qui. Ma anche un secondo fa.' }),
        mk(6, { id: 'spot', name: 'Istanza spot', shape: 'bat', col: '#e8d060', speed: 2, erratic: 0.5, hpx: 0.6, info: 'Appare e scompare, secondo il prezzo.' }),
        mk(6, { id: 'container', name: 'Container', shape: 'chest', col: '#6a8ad8', ambush: true, w: 4, hpx: 1.3, info: 'Funzionava sul mio computer.' }),
        mk(6, { id: 'syncloop', name: 'Sync loop', shape: 'swarm', col: '#9ae8c0', split: true, hpx: 0.8, info: 'Si sincronizza con se stesso. Per sempre.' }),
        mk(6, { id: 'lockin', name: 'Vendor lock-in', shape: 'hood', col: '#a070e8', leech: true, steal: 'gold', info: 'Entrare è gratis. Uscire, molto meno.' }),
        mk(6, { id: 'boss6', name: 'Il Cloud Provider', shape: 'blob', col: '#ffb000', boss: true, ranged: { range: 6, dmg: [5, 11], verb: 'ti addebita una fattura' }, summon: { k: 'spot', every: 5 }, info: 'Paghi per ciò che usi. E per ciò che non usi.' }),
        mk(7, { id: 'drop', name: 'Regola DROP', shape: 'robot', col: '#e85a5a', def: 3, info: 'Non risponde. Neanche per dire no.' }),
        mk(7, { id: 'honey', name: 'Honeypot', shape: 'chest', col: '#e8b84a', ambush: true, w: 4, hpx: 1.4, info: 'Troppo bello per essere vero.' }),
        mk(7, { id: 'scanner', name: 'Port scanner', shape: 'eye', col: '#7ae8e8', ranged: { range: 7, dmg: [4, 9], verb: 'ti scansiona' }, hpx: 0.7, info: 'Bussa a tutte le porte. Tutte.' }),
        mk(7, { id: 'rootkit', name: 'Rootkit', shape: 'ghost', col: '#6a6a7a', invisible: true, undead: true, info: 'Non c’è. È qui da anni.' }),
        mk(7, { id: 'ids', name: 'Sistema anti-intrusione', shape: 'daemon', col: '#ff7a4a', stun: true, hpx: 1.2, info: 'Ha visto tutto. Ha segnato tutto.' }),
        mk(7, { id: 'brute', name: 'Brute force', shape: 'swarm', col: '#ffb060', speed: 2, hpx: 0.8, info: 'Prova ogni combinazione. Anche te.' }),
        mk(7, { id: 'boss7', name: 'Il Grande Firewall', shape: 'robot', col: '#ffb000', boss: true, def: 3, stun: true, summon: { k: 'brute', every: 5 }, info: 'Nessuno entra. Nessuno esce. Neanche il personale.' }),
        mk(8, { id: 'panic', name: 'Kernel panic', shape: 'daemon', col: '#ff5a8a', explode: [6, 14], hpx: 0.8, info: 'Meglio non stargli accanto quando succede.' }),
        mk(8, { id: 'zombie', name: 'Processo zombie', shape: 'human', col: '#8aa07a', undead: true, regen: 1, info: 'È morto ma nessuno gliel’ha detto.' }),
        mk(8, { id: 'deadlock', name: 'Deadlock', shape: 'eye', col: '#c0c0ff', still: true, ranged: { range: 6, dmg: [5, 10], verb: 'ti blocca' }, w: 6, info: 'Aspetta qualcosa che non arriverà.' }),
        mk(8, { id: 'segfault', name: 'Segmentation fault', shape: 'bug', col: '#ff8a8a', explode: [4, 10], speed: 2, hpx: 0.7, info: 'Errore. Nient’altro. Esplode.' }),
        mk(8, { id: 'irq', name: 'Interrupt', shape: 'bat', col: '#ffd060', speed: 2, erratic: 0.4, hpx: 0.6, info: 'Ti interrompe. Sempre sul più bello.' }),
        mk(8, { id: 'race', name: 'Race condition', shape: 'swarm', col: '#a0e0ff', blink: true, split: true, info: 'Chi arriva prima? Dipende da quando guardi.' }),
        mk(8, { id: 'boss8', name: 'Il Kernel Panic', shape: 'daemon', col: '#ffb000', boss: true, explode: [8, 16], summon: { k: 'segfault', every: 6 }, info: 'La schermata blu fatta persona.' }),
        mk(9, { id: 'operatore', name: 'Operatore di sala', shape: 'human', col: '#d8d8a0', def: 2, info: 'Porta il camice. Non è chiaro di chi sia il camice.' }),
        mk(9, { id: 'perfor', name: 'Scheda perforata', shape: 'script', col: '#e8d8a8', ambush: false, speed: 2, erratic: 0.3, hpx: 0.6, info: 'Se la piegano, non funziona più. Neanche lei.' }),
        mk(9, { id: 'cobol', name: 'Demone COBOL', shape: 'daemon', col: '#7ae88a', def: 3, hpx: 1.3, info: 'Ha trent’anni di esperienza e nessun commento.' }),
        mk(9, { id: 'valvola', name: 'Valvola surriscaldata', shape: 'robot', col: '#e8964a', ranged: { range: 4, dmg: [5, 11], verb: 'ti scotta' }, hpx: 1.1, info: 'Ci vuole mezz’ora per accenderla. Anche per spegnerla.' }),
        mk(9, { id: 'spooler', name: 'Spooler', shape: 'printer', col: '#a0a0b8', still: true, ranged: { range: 7, dmg: [4, 10], verb: 'ti stampa addosso' }, w: 6, info: 'Coda piena dal 1987.' }),
        mk(9, { id: 'batch', name: 'Job batch', shape: 'worm', col: '#80c8a0', regen: 2, hpx: 1.1, info: 'Gira di notte. Anche di giorno, adesso.' }),
        mk(9, { id: 'boss9', name: 'Il Mainframe', shape: 'printer', col: '#ffb000', boss: true, def: 3, ranged: { range: 6, dmg: [6, 13], verb: 'ti spara una scheda' }, summon: { k: 'perfor', every: 5 }, info: 'Più vecchio di tutti. E ha ragione lui.' }),
        mk(10, { id: 'rogueai', name: 'IA ribelle', shape: 'eye', col: '#ff5aff', ranged: { range: 7, dmg: [6, 14], verb: 'ti calcola' }, summon: { k: 'forkbomb', every: 8 }, hpx: 1.2, w: 6, info: 'Ha letto tutti i libri della biblioteca. Ha tratto conclusioni.' }),
        mk(10, { id: 'forkbomb', name: 'Fork bomb', shape: 'swarm', col: '#ff6a2a', speed: 2, split: true, hpx: 0.7, info: ':(){ :|:& };: — non fare quella faccia.' }),
        mk(10, { id: 'memleak', name: 'Memory leak', shape: 'blob', col: '#6aff9a', regen: 3, hpx: 1.2, info: 'Più la combatti, più occupa spazio.' }),
        mk(10, { id: 'rootd', name: 'Demone di root', shape: 'daemon', col: '#ffd24a', def: 3, stun: true, info: 'Ha tutti i permessi. Soprattutto quelli su di te.' }),
        mk(10, { id: 'sudoer', name: 'Sudoer', shape: 'hood', col: '#e8e8e8', steal: 'item', dodge: 3, w: 6, info: 'Non è nel file sudoers. Lo sa, e lo sapete.' }),
        mk(10, { id: 'ghost404', name: 'Fantasma 404', shape: 'ghost', col: '#ffffff', phase: true, invisible: true, undead: true, info: 'Non trovato. Ma ti ha trovato.' }),
        mk(10, { id: 'boss10', name: 'ROOT', shape: 'crown', col: '#ffb000', boss: true, def: 4, ranged: { range: 7, dmg: [8, 16], verb: 'ti revoca i permessi' }, summon: { k: 'forkbomb', every: 6 }, info: 'L’amministratore finale. Ha un solo comando e non è “ciao”.' }),
    ];
    // Traps: `effect` is one of the effects in game.js (the same ones the items use), `power` its strength.
    const TRAPS = [
        { id: 'scossa', name: 'Presa scoperta', effect: 'zap', power: 3 },
        { id: 'colla', name: 'Toner rovesciato', effect: 'poison', power: 5 },
        { id: 'redirect', name: 'Redirect', effect: 'teleport' },
        { id: 'allarme', name: 'Allarme', effect: 'alarm' },
        { id: 'botola', name: 'Botola', effect: 'pit', power: 3, w: 5 },
    ];
    return { PER_SECTOR, SECTORS, LIST, TRAPS };
});
