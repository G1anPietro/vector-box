// js/rogue/mobs.js — the sectors of the datacentre, the monsters that live in them and the traps. Data only.
//
// TEXTS: every text the player reads is an object { en: '…', it: '…' } (English first; both are required and the tests check them). Keep ids stable and
// language-free; never write a sentence in game.js. Proper names that are the same in both languages are written twice.
// HOW TO ADD A SECTOR: add one object to SECTORS (id, name {en,it}, intro {en,it}, colours). Every sector is PER_SECTOR floors deep and the game
// is as long as the list: a new sector makes the run 5 floors longer. Give it monsters (below) and a boss.
//
// SHORTCUT FOR SECTORS 2+: mk(sector, { id, name, shape, col, info, …behaviours }) fills floors (the sector's 5 floors),
// hp, atk and xp from the depth of the sector; hpx / atkx / xpx multiply them (1 = normal, 0.5 = weak, 2 = tough).
// name and info are { en, it }; a ranged monster also has verb { en, it }: what its attack does, read as "<name> <verb>: 5" ("fires a paper jam at you").
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
        { id: 'scantinato', name: { en: 'Basement', it: 'Scantinato' }, wall: '#3d4a3f', edge: '#57695a', floor: '#161b17', dot: '#232b25',
          intro: { en: 'Beneath the gym there’s a door nobody has opened since 1998. Behind it: dust, cables and something humming.', it: 'Sotto la palestra c’è una porta che nessuno apre dal 1998. Dietro: polvere, cavi e qualcosa che ronza.' } },
        { id: 'aula', name: { en: 'Server Classroom', it: 'Aula Server' }, wall: '#2f4a5e', edge: '#4a7691', floor: '#0e1519', dot: '#1b2a33', intro: { en: 'Racks in rows, fans blowing. Someone left an attendance register: the names keep changing by themselves.', it: 'Rack in fila, ventole che soffiano. Qualcuno ha lasciato un registro delle presenze: i nomi cambiano da soli.' } },
        { id: 'cablaggi', name: { en: 'Cabling', it: 'Cablaggi' }, wall: '#5a4a2a', edge: '#8a7240', floor: '#181409', dot: '#2a2210', intro: { en: 'Cable trays everywhere. Thousands of cables, all labeled “test”.', it: 'Canaline ovunque. Migliaia di cavi, tutti etichettati “prova”.' } },
        { id: 'rete', name: { en: 'Network', it: 'Rete' }, wall: '#2a4f4f', edge: '#3f8a8a', floor: '#081616', dot: '#102a2a', intro: { en: 'Here the packets travel on foot. Some got lost and they’re not happy about it.', it: 'Qui i pacchetti viaggiano a piedi. Alcuni si sono persi e non sono contenti.' } },
        { id: 'archivio', name: { en: 'Archive', it: 'Archivio' }, wall: '#5a3f2e', edge: '#8a6448', floor: '#150f0b', dot: '#261b14', intro: { en: 'Binders, tapes, floppy disks. Everything is catalogued. Nothing can be found.', it: 'Faldoni, nastri, floppy. Tutto è catalogato. Nulla si trova.' } },
        { id: 'cloud', name: { en: 'Cloud', it: 'Cloud' }, wall: '#3f4f7a', edge: '#6a82c0', floor: '#0b0f1c', dot: '#171e36', intro: { en: 'The ceiling is gone. It feels like walking on a monthly subscription.', it: 'Il soffitto è sparito. Pare di camminare su un abbonamento mensile.' } },
        { id: 'firewall', name: { en: 'Firewall', it: 'Firewall' }, wall: '#7a2f2f', edge: '#c04a4a', floor: '#190909', dot: '#2e1313', intro: { en: 'Red walls and a list of rules. Everything not allowed is forbidden. You are not allowed.', it: 'Pareti rosse e regole in elenco. Tutto ciò che non è permesso è vietato. Tu non sei permesso.' } },
        { id: 'kernel', name: { en: 'Kernel', it: 'Kernel' }, wall: '#5a2f7a', edge: '#8f4ac0', floor: '#110918', dot: '#20122e', intro: { en: 'The heart of the system. You can hear a beat: it’s the clock.', it: 'Il cuore del sistema. Si sente un battito: è il clock.' } },
        { id: 'mainframe', name: { en: 'Mainframe', it: 'Mainframe' }, wall: '#4f5a2a', edge: '#82924a', floor: '#0f1308', dot: '#1d240f', intro: { en: 'A hall as big as a cathedral. The oldest computer in the building, and the proudest.', it: 'Una sala grande come una chiesa. Il computer più vecchio dell’edificio, e il più orgoglioso.' } },
        { id: 'root', name: { en: 'Root', it: 'Root' }, wall: '#7a6a2f', edge: '#c0a84a', floor: '#181508', dot: '#2c260f', intro: { en: 'No real walls: just permissions. At the far end, a window that says “#”.', it: 'Nessun muro vero: solo permessi. In fondo, una finestra con scritto “#”.' } },
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
        { id: 'bug', name: { en: 'Bug', it: 'Bug' }, shape: 'bug', col: '#7bd86a', hp: 5, atk: [1, 3], xp: 2, floors: [1, 3],
          info: { en: 'Small, green, everywhere. Nobody knows who wrote it.', it: 'Piccolo, verde, ovunque. Nessuno sa chi l’ha scritto.' } },
        { id: 'topo', name: { en: 'Network Rat', it: 'Topo di rete' }, shape: 'bat', col: '#b9a48a', hp: 4, atk: [1, 2], dodge: 3, speed: 2, erratic: 0.5, xp: 3, floors: [1, 5],
          info: { en: 'Gnaws the cables and bolts in every direction.', it: 'Rosicchia i cavi e scappa in ogni direzione.' } },
        { id: 'polvere', name: { en: 'Dust Bunny', it: 'Gomitolo di polvere' }, shape: 'blob', col: '#9a94a8', hp: 12, atk: [1, 3], speed: 0.5, split: true, xp: 3, floors: [2, 5],
          info: { en: 'Hit it and it splits in two. Someone should have vacuumed.', it: 'Se lo colpisci si divide. Andava passato l’aspirapolvere.' } },
        { id: 'ragno', name: { en: 'Cable Spider', it: 'Ragno dei cavi' }, shape: 'spider', col: '#c97fd8', hp: 7, atk: [1, 3], poison: 4, xp: 4, floors: [2, 5],
          info: { en: 'Its bite gives you a shock for a few turns.', it: 'Il suo morso dà la scossa per qualche turno.' } },
        { id: 'cavo', name: { en: 'Live Wire', it: 'Cavo vivo' }, shape: 'worm', col: '#e8b84a', hp: 9, atk: [1, 5], def: 1, xp: 5, floors: [1, 5],
          info: { en: 'A network cable that decided it was done being stepped on.', it: 'Un cavo di rete che ha deciso di non farsi più calpestare.' } },
        { id: 'stampante', name: { en: 'Possessed Printer', it: 'Stampante posseduta' }, shape: 'printer', col: '#8fa3b8', hp: 8, atk: [1, 3], still: true, w: 6,
          ranged: { range: 5, dmg: [1, 4], verb: { en: 'shoots a paper jam at you', it: 'ti spara un foglio inceppato' } }, xp: 6, floors: [2, 5],
          info: { en: 'It doesn’t move, but it prints. Against you.', it: 'Non si muove, ma stampa. Contro di te.' } },
        { id: 'kiddie', name: { en: 'Script Kiddie', it: 'Script kiddie' }, shape: 'hood', col: '#5fb4e8', hp: 10, atk: [1, 3], dodge: 2, steal: 'gold', w: 6, xp: 6, floors: [2, 5],
          info: { en: 'Empties your wallet and runs. Catch it and you get everything back.', it: 'Ti svuota il portafoglio e scappa. Se lo prendi, riprendi tutto.' } },
        { id: 'cassa', name: { en: 'Suspicious Box', it: 'Scatolone sospetto' }, shape: 'chest', col: '#b98a55', hp: 16, atk: [3, 7], ambush: true, w: 3, xp: 9, floors: [3, 5],
          info: { en: 'Looks like a cardboard box. Bites.', it: 'Sembra uno scatolone. Morde.' } },
        { id: 'boss1', name: { en: 'The Bug Nest', it: 'Il Nido dei Bug' }, shape: 'bug', col: '#ffb000', hp: 48, atk: [2, 6], def: 1, acc: 1, boss: 5,
          summon: { k: 'bug', every: 4 }, xp: 40,
          info: { en: 'The first bug ever written in this school. It has been making more ever since.', it: 'Il primo bug mai scritto in questa scuola. Da allora ne produce altri.' } },

        // ── settori 2-10 (numeri dal settore, vedi mk)
        mk(2, { id: 'cavorack', name: { en: 'Rack Cable', it: 'Cavo da rack' }, shape: 'worm', col: '#4aa8e8', poison: 4, info: { en: 'Coils around your ankles and stings.', it: 'Si arrotola intorno alle caviglie e punge.' } }),
        mk(2, { id: 'ventola', name: { en: 'Rogue Fan', it: 'Ventola impazzita' }, shape: 'eye', col: '#9ab0c0', speed: 2, erratic: 0.4, hpx: 0.6, info: { en: 'Spins, spins, spins. Only stops to hit you.', it: 'Gira, gira, gira. Si ferma solo per colpirti.' } }),
        mk(2, { id: 'phish', name: { en: 'Phishing', it: 'Phishing' }, shape: 'hood', col: '#e8d45a', steal: 'item', w: 6, dodge: 2, info: { en: 'Emails you that you won a prize. Actually takes your backpack.', it: 'Ti scrive che hai vinto un premio. In realtà ti prende lo zaino.' } }),
        mk(2, { id: 'spam', name: { en: 'Spam Swarm', it: 'Nugolo di spam' }, shape: 'swarm', col: '#e88ac0', split: true, hpx: 0.8, info: { en: 'Take one out and two more show up.', it: 'Se ne elimini uno, ne arrivano due.' } }),
        mk(2, { id: 'bkcorr', name: { en: 'Corrupted Backup', it: 'Backup corrotto' }, shape: 'ghost', col: '#a8a0c8', undead: true, leech: true, info: { en: 'You were supposed to check it. You didn’t.', it: 'Dovevi controllarlo. Non l’hai fatto.' } }),
        mk(2, { id: 'switch', name: { en: 'Broken Switch', it: 'Switch guasto' }, shape: 'robot', col: '#8fb4e8', stun: true, def: 1, info: { en: 'Every port lit up, none of them working.', it: 'Tutte le porte accese, nessuna che funziona.' } }),
        mk(2, { id: 'stampa2', name: { en: 'Network Printer', it: 'Stampante di rete' }, shape: 'printer', col: '#d8d8e8', still: true, w: 6, ranged: { range: 6, dmg: [2, 5], verb: { en: 'hurls a toner cartridge at you', it: 'ti lancia un toner' } }, info: { en: 'Print queue: 4000 documents. All for you.', it: 'Coda di stampa: 4000 documenti. Tutti per te.' } }),
        mk(2, { id: 'boss2', name: { en: 'The Forgotten Admin', it: 'L’Admin Dimenticato' }, shape: 'human', col: '#ffb000', boss: true, summon: { k: 'spam', every: 5 }, def: 1, info: { en: 'Nobody remembers his password. Not even him.', it: 'Nessuno ricorda la sua password. Neanche lui.' } }),
        mk(3, { id: 'serpe', name: { en: 'Cable Snake', it: 'Serpente di cavi' }, shape: 'worm', col: '#e8964a', poison: 5, info: { en: 'Cat 6, extremely long.', it: 'Cat 6, lunghissimo.' } }),
        mk(3, { id: 'corto', name: { en: 'Short Circuit', it: 'Cortocircuito' }, shape: 'eye', col: '#fff060', ranged: { range: 5, dmg: [3, 7], verb: { en: 'zaps you', it: 'ti fulmina' } }, hpx: 0.6, erratic: 0.3, info: { en: 'A flash looking for a conductor. That’s you.', it: 'Un lampo in cerca di un conduttore. Sei tu.' } }),
        mk(3, { id: 'crimpa', name: { en: 'Crimping Tool', it: 'Crimpatrice' }, shape: 'robot', col: '#c0c0d0', def: 2, hpx: 1.2, info: { en: 'Squeezes until it clicks.', it: 'Stringe fino al clic.' } }),
        mk(3, { id: 'ratto', name: { en: 'Conduit Rat', it: 'Ratto di canalina' }, shape: 'bat', col: '#b9a48a', speed: 2, erratic: 0.4, hpx: 0.5, info: { en: 'Fast, and hungry for cable insulation.', it: 'Veloce e affamato di guaina.' } }),
        mk(3, { id: 'fibra', name: { en: 'Broken Fiber', it: 'Fibra spezzata' }, shape: 'spider', col: '#6ae8e8', poison: 6, w: 8, info: { en: 'A splinter of glass that walks.', it: 'Una scheggia di vetro che cammina.' } }),
        mk(3, { id: 'nodo', name: { en: 'Gordian Knot', it: 'Nodo gordiano' }, shape: 'blob', col: '#c9b07a', split: true, speed: 0.5, hpx: 1.4, info: { en: 'Cut it and it becomes two knots.', it: 'Taglialo e diventa due nodi.' } }),
        mk(3, { id: 'manut', name: { en: 'Tired Maintenance Guy', it: 'Manutentore stanco' }, shape: 'human', col: '#5a8fe8', steal: 'gold', coward: true, w: 6, info: { en: 'Asks you to pay for the cable, then runs.', it: 'Ti chiede i soldi per il cavo e scappa.' } }),
        mk(3, { id: 'boss3', name: { en: 'The Tangle', it: 'La Matassa' }, shape: 'worm', col: '#ffb000', boss: true, poison: 6, summon: { k: 'ratto', every: 5 }, info: { en: 'A knot of cables as big as a bus.', it: 'Un groviglio grande come un autobus.' } }),
        mk(4, { id: 'pacchetto', name: { en: 'Lost Packet', it: 'Pacchetto perso' }, shape: 'ghost', col: '#8fd0e8', blink: true, undead: true, info: { en: 'Looking for its recipient. It mistook you for them.', it: 'Cerca il destinatario. Ti ha scambiato per lui.' } }),
        mk(4, { id: 'pingmorte', name: { en: 'Ping of Death', it: 'Ping della morte' }, shape: 'eye', col: '#ff6a6a', ranged: { range: 6, dmg: [3, 8], verb: { en: 'fires a giant packet at you', it: 'ti spara un pacchetto enorme' } }, hpx: 0.7, info: { en: '65,535 bytes of bad intentions.', it: '65.535 byte di cattive intenzioni.' } }),
        mk(4, { id: 'mitm', name: { en: 'Man in the Middle', it: 'Man in the middle' }, shape: 'hood', col: '#c97fd8', steal: 'item', dodge: 3, w: 6, info: { en: 'Always gets in the middle. Always.', it: 'Si mette in mezzo. Sempre.' } }),
        mk(4, { id: 'ddos', name: { en: 'DDoS', it: 'DDoS' }, shape: 'swarm', col: '#ff8a4a', speed: 2, split: true, hpx: 0.7, info: { en: 'There are lots of them, and they all look the same.', it: 'Sono in tanti, e sono tutti uguali.' } }),
        mk(4, { id: 'routerr', name: { en: 'Angry Router', it: 'Router rabbioso' }, shape: 'robot', col: '#6ad87b', stun: true, hpx: 1.2, info: { en: 'All its lights are blinking: never a good sign.', it: 'Lampeggia tutto: non è un buon segno.' } }),
        mk(4, { id: 'sniffer', name: { en: 'Sniffer', it: 'Sniffer' }, shape: 'spider', col: '#e8e8a0', invisible: true, w: 6, info: { en: 'You hear it before you see it.', it: 'Lo senti prima di vederlo.' } }),
        mk(4, { id: 'boss4', name: { en: 'The Gateway', it: 'Il Gateway' }, shape: 'robot', col: '#ffb000', boss: true, stun: true, summon: { k: 'ddos', every: 6 }, info: { en: 'Everything goes through it. So do you, now.', it: 'Tutto passa da lui. Anche tu, adesso.' } }),
        mk(5, { id: 'faldone', name: { en: 'Living Binder', it: 'Faldone vivente' }, shape: 'chest', col: '#c9a070', ambush: true, w: 4, hpx: 1.3, info: { en: 'Looked like paperwork waiting to be filed.', it: 'Sembrava una pratica da archiviare.' } }),
        mk(5, { id: 'logeterno', name: { en: 'Endless Log', it: 'Log infinito' }, shape: 'worm', col: '#9ab07a', regen: 1, hpx: 1.2, info: { en: 'Every line spawns two more. It never ends.', it: 'Ogni riga ne genera due. Non finisce.' } }),
        mk(5, { id: 'bibli', name: { en: 'Ghost Librarian', it: 'Bibliotecaria fantasma' }, shape: 'ghost', col: '#e8e0c8', undead: true, weaken: true, info: { en: 'Shhh. Then it strikes.', it: 'Shhh. Poi colpisce.' } }),
        mk(5, { id: 'pdfrot', name: { en: 'Corrupted PDF', it: 'PDF corrotto' }, shape: 'printer', col: '#e85a5a', still: true, ranged: { range: 6, dmg: [3, 8], verb: { en: 'fires black pages at you', it: 'ti spara pagine nere' } }, w: 6, info: { en: 'Won’t open. Opens by itself, to hit you.', it: 'Non si apre. Si apre da solo contro di te.' } }),
        mk(5, { id: 'tarlo', name: { en: 'Digital Woodworm', it: 'Tarlo digitale' }, shape: 'bug', col: '#c0a060', def: 2, info: { en: 'Eats files and patience.', it: 'Mangia i file e la pazienza.' } }),
        mk(5, { id: 'nastro', name: { en: 'Magnetic Tape', it: 'Nastro magnetico' }, shape: 'worm', col: '#6a6a7a', leech: true, info: { en: 'Rewinds itself around your waist.', it: 'Si riavvolge intorno alla vita.' } }),
        mk(5, { id: 'boss5', name: { en: 'The Grand Librarian', it: 'La Grande Bibliotecaria' }, shape: 'ghost', col: '#ffb000', boss: true, weaken: true, undead: true, summon: { k: 'bibli', every: 7 }, info: { en: 'The rules say: silence. The rules also say other things.', it: 'Il regolamento dice: silenzio. Il regolamento dice anche altro.' } }),
        mk(6, { id: 'nuvola', name: { en: 'Storm Cloud', it: 'Nuvola temporalesca' }, shape: 'blob', col: '#8aa0d8', ranged: { range: 5, dmg: [4, 9], verb: { en: 'strikes you with lightning', it: 'ti fulmina' } }, info: { en: 'It’s raining data. Pouring.', it: 'Piove dati. A dirotto.' } }),
        mk(6, { id: 'latenza', name: { en: 'Latency', it: 'Latenza' }, shape: 'ghost', col: '#b0b8d0', blink: true, undead: true, info: { en: 'It’s here. But also a second ago.', it: 'È qui. Ma anche un secondo fa.' } }),
        mk(6, { id: 'spot', name: { en: 'Spot Instance', it: 'Istanza spot' }, shape: 'bat', col: '#e8d060', speed: 2, erratic: 0.5, hpx: 0.6, info: { en: 'Appears and disappears, depending on the price.', it: 'Appare e scompare, secondo il prezzo.' } }),
        mk(6, { id: 'container', name: { en: 'Container', it: 'Container' }, shape: 'chest', col: '#6a8ad8', ambush: true, w: 4, hpx: 1.3, info: { en: 'It worked on my machine.', it: 'Funzionava sul mio computer.' } }),
        mk(6, { id: 'syncloop', name: { en: 'Sync Loop', it: 'Sync loop' }, shape: 'swarm', col: '#9ae8c0', split: true, hpx: 0.8, info: { en: 'Syncs with itself. Forever.', it: 'Si sincronizza con se stesso. Per sempre.' } }),
        mk(6, { id: 'lockin', name: { en: 'Vendor Lock-in', it: 'Vendor lock-in' }, shape: 'hood', col: '#a070e8', leech: true, steal: 'gold', info: { en: 'Getting in is free. Getting out, much less so.', it: 'Entrare è gratis. Uscire, molto meno.' } }),
        mk(6, { id: 'boss6', name: { en: 'The Cloud Provider', it: 'Il Cloud Provider' }, shape: 'blob', col: '#ffb000', boss: true, ranged: { range: 6, dmg: [5, 11], verb: { en: 'sends you an invoice', it: 'ti addebita una fattura' } }, summon: { k: 'spot', every: 5 }, info: { en: 'You pay for what you use. And for what you don’t.', it: 'Paghi per ciò che usi. E per ciò che non usi.' } }),
        mk(7, { id: 'drop', name: { en: 'DROP Rule', it: 'Regola DROP' }, shape: 'robot', col: '#e85a5a', def: 3, info: { en: 'Doesn’t answer. Not even to say no.', it: 'Non risponde. Neanche per dire no.' } }),
        mk(7, { id: 'honey', name: { en: 'Honeypot', it: 'Honeypot' }, shape: 'chest', col: '#e8b84a', ambush: true, w: 4, hpx: 1.4, info: { en: 'Too good to be true.', it: 'Troppo bello per essere vero.' } }),
        mk(7, { id: 'scanner', name: { en: 'Port Scanner', it: 'Port scanner' }, shape: 'eye', col: '#7ae8e8', ranged: { range: 7, dmg: [4, 9], verb: { en: 'scans you', it: 'ti scansiona' } }, hpx: 0.7, info: { en: 'Knocks on every door. Every single one.', it: 'Bussa a tutte le porte. Tutte.' } }),
        mk(7, { id: 'rootkit', name: { en: 'Rootkit', it: 'Rootkit' }, shape: 'ghost', col: '#6a6a7a', invisible: true, undead: true, info: { en: 'It isn’t there. It has been here for years.', it: 'Non c’è. È qui da anni.' } }),
        mk(7, { id: 'ids', name: { en: 'Intrusion Detection System', it: 'Sistema anti-intrusione' }, shape: 'daemon', col: '#ff7a4a', stun: true, hpx: 1.2, info: { en: 'It has seen everything. It has logged everything.', it: 'Ha visto tutto. Ha segnato tutto.' } }),
        mk(7, { id: 'brute', name: { en: 'Brute Force', it: 'Brute force' }, shape: 'swarm', col: '#ffb060', speed: 2, hpx: 0.8, info: { en: 'Tries every combination. You included.', it: 'Prova ogni combinazione. Anche te.' } }),
        mk(7, { id: 'boss7', name: { en: 'The Great Firewall', it: 'Il Grande Firewall' }, shape: 'robot', col: '#ffb000', boss: true, def: 3, stun: true, summon: { k: 'brute', every: 5 }, info: { en: 'Nobody gets in. Nobody gets out. Not even the staff.', it: 'Nessuno entra. Nessuno esce. Neanche il personale.' } }),
        mk(8, { id: 'panic', name: { en: 'Kernel Panic', it: 'Kernel panic' }, shape: 'daemon', col: '#ff5a8a', explode: [6, 14], hpx: 0.8, info: { en: 'Better not to stand next to it when it happens.', it: 'Meglio non stargli accanto quando succede.' } }),
        mk(8, { id: 'zombie', name: { en: 'Zombie Process', it: 'Processo zombie' }, shape: 'human', col: '#8aa07a', undead: true, regen: 1, info: { en: 'It’s dead, but nobody told it.', it: 'È morto ma nessuno gliel’ha detto.' } }),
        mk(8, { id: 'deadlock', name: { en: 'Deadlock', it: 'Deadlock' }, shape: 'eye', col: '#c0c0ff', still: true, ranged: { range: 6, dmg: [5, 10], verb: { en: 'locks you up', it: 'ti blocca' } }, w: 6, info: { en: 'Waiting for something that will never arrive.', it: 'Aspetta qualcosa che non arriverà.' } }),
        mk(8, { id: 'segfault', name: { en: 'Segmentation Fault', it: 'Segmentation fault' }, shape: 'bug', col: '#ff8a8a', explode: [4, 10], speed: 2, hpx: 0.7, info: { en: 'Error. Nothing more. Then it explodes.', it: 'Errore. Nient’altro. Esplode.' } }),
        mk(8, { id: 'irq', name: { en: 'Interrupt', it: 'Interrupt' }, shape: 'bat', col: '#ffd060', speed: 2, erratic: 0.4, hpx: 0.6, info: { en: 'Interrupts you. Always at the best part.', it: 'Ti interrompe. Sempre sul più bello.' } }),
        mk(8, { id: 'race', name: { en: 'Race Condition', it: 'Race condition' }, shape: 'swarm', col: '#a0e0ff', blink: true, split: true, info: { en: 'Who gets there first? Depends on when you look.', it: 'Chi arriva prima? Dipende da quando guardi.' } }),
        mk(8, { id: 'boss8', name: { en: 'The Kernel Panic', it: 'Il Kernel Panic' }, shape: 'daemon', col: '#ffb000', boss: true, explode: [8, 16], summon: { k: 'segfault', every: 6 }, info: { en: 'The blue screen of death, in person.', it: 'La schermata blu fatta persona.' } }),
        mk(9, { id: 'operatore', name: { en: 'Hall Operator', it: 'Operatore di sala' }, shape: 'human', col: '#d8d8a0', def: 2, info: { en: 'Wears a lab coat. Nobody is sure whose it is.', it: 'Porta il camice. Non è chiaro di chi sia il camice.' } }),
        mk(9, { id: 'perfor', name: { en: 'Punch Card', it: 'Scheda perforata' }, shape: 'script', col: '#e8d8a8', ambush: false, speed: 2, erratic: 0.3, hpx: 0.6, info: { en: 'Do not fold, spindle or mutilate. Apparently that applies to you too.', it: 'Se la piegano, non funziona più. Neanche lei.' } }),
        mk(9, { id: 'cobol', name: { en: 'COBOL Daemon', it: 'Demone COBOL' }, shape: 'daemon', col: '#7ae88a', def: 3, hpx: 1.3, info: { en: 'Thirty years of experience and not a single comment.', it: 'Ha trent’anni di esperienza e nessun commento.' } }),
        mk(9, { id: 'valvola', name: { en: 'Overheated Valve', it: 'Valvola surriscaldata' }, shape: 'robot', col: '#e8964a', ranged: { range: 4, dmg: [5, 11], verb: { en: 'burns you', it: 'ti scotta' } }, hpx: 1.1, info: { en: 'Takes half an hour to warm up. Same to cool down.', it: 'Ci vuole mezz’ora per accenderla. Anche per spegnerla.' } }),
        mk(9, { id: 'spooler', name: { en: 'Spooler', it: 'Spooler' }, shape: 'printer', col: '#a0a0b8', still: true, ranged: { range: 7, dmg: [4, 10], verb: { en: 'prints all over you', it: 'ti stampa addosso' } }, w: 6, info: { en: 'Queue full since 1987.', it: 'Coda piena dal 1987.' } }),
        mk(9, { id: 'batch', name: { en: 'Batch Job', it: 'Job batch' }, shape: 'worm', col: '#80c8a0', regen: 2, hpx: 1.1, info: { en: 'Runs at night. Runs in the daytime too, now.', it: 'Gira di notte. Anche di giorno, adesso.' } }),
        mk(9, { id: 'boss9', name: { en: 'The Mainframe', it: 'Il Mainframe' }, shape: 'printer', col: '#ffb000', boss: true, def: 3, ranged: { range: 6, dmg: [6, 13], verb: { en: 'fires a punch card at you', it: 'ti spara una scheda' } }, summon: { k: 'perfor', every: 5 }, info: { en: 'Older than everyone. And it’s always right.', it: 'Più vecchio di tutti. E ha ragione lui.' } }),
        mk(10, { id: 'rogueai', name: { en: 'Rogue AI', it: 'IA ribelle' }, shape: 'eye', col: '#ff5aff', ranged: { range: 7, dmg: [6, 14], verb: { en: 'optimizes you away', it: 'ti calcola' } }, summon: { k: 'forkbomb', every: 8 }, hpx: 1.2, w: 6, info: { en: 'Has read every book in the library. Drew conclusions.', it: 'Ha letto tutti i libri della biblioteca. Ha tratto conclusioni.' } }),
        mk(10, { id: 'forkbomb', name: { en: 'Fork Bomb', it: 'Fork bomb' }, shape: 'swarm', col: '#ff6a2a', speed: 2, split: true, hpx: 0.7, info: { en: ':(){ :|:& };: — don’t give me that look.', it: ':(){ :|:& };: — non fare quella faccia.' } }),
        mk(10, { id: 'memleak', name: { en: 'Memory Leak', it: 'Memory leak' }, shape: 'blob', col: '#6aff9a', regen: 3, hpx: 1.2, info: { en: 'The more you fight it, the more space it takes up.', it: 'Più la combatti, più occupa spazio.' } }),
        mk(10, { id: 'rootd', name: { en: 'Root Daemon', it: 'Demone di root' }, shape: 'daemon', col: '#ffd24a', def: 3, stun: true, info: { en: 'Has all the permissions. Especially the ones over you.', it: 'Ha tutti i permessi. Soprattutto quelli su di te.' } }),
        mk(10, { id: 'sudoer', name: { en: 'Sudoer', it: 'Sudoer' }, shape: 'hood', col: '#e8e8e8', steal: 'item', dodge: 3, w: 6, info: { en: 'Not in the sudoers file. This incident will be reported.', it: 'Non è nel file sudoers. Lo sa, e lo sapete.' } }),
        mk(10, { id: 'ghost404', name: { en: 'Ghost 404', it: 'Fantasma 404' }, shape: 'ghost', col: '#ffffff', phase: true, invisible: true, undead: true, info: { en: 'Not found. But it found you.', it: 'Non trovato. Ma ti ha trovato.' } }),
        mk(10, { id: 'boss10', name: { en: 'ROOT', it: 'ROOT' }, shape: 'crown', col: '#ffb000', boss: true, def: 4, ranged: { range: 7, dmg: [8, 16], verb: { en: 'revokes your permissions', it: 'ti revoca i permessi' } }, summon: { k: 'forkbomb', every: 6 }, info: { en: 'The final administrator. It has one command, and it isn’t “hello”.', it: 'L’amministratore finale. Ha un solo comando e non è “ciao”.' } }),
    ];
    // Traps: `effect` is one of the effects in game.js (the same ones the items use), `power` its strength.
    const TRAPS = [
        { id: 'scossa', name: { en: 'Bare Socket', it: 'Presa scoperta' }, effect: 'zap', power: 3 },
        { id: 'colla', name: { en: 'Spilled Toner', it: 'Toner rovesciato' }, effect: 'poison', power: 5 },
        { id: 'redirect', name: { en: 'Redirect', it: 'Redirect' }, effect: 'teleport' },
        { id: 'allarme', name: { en: 'Alarm', it: 'Allarme' }, effect: 'alarm' },
        { id: 'botola', name: { en: 'Trapdoor', it: 'Botola' }, effect: 'pit', power: 3, w: 5 },
    ];
    return { PER_SECTOR, SECTORS, LIST, TRAPS };
});
