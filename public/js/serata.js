// js/serata.js — "Serata": three quick party games on one phone (Most likely to…, Would you rather…, The bomb).
// The picking rules have no DOM and are testable from Node; the cards are [Italian, English].
(function (root) {
    'use strict';

    const LIKELY = [
        ['si addormenta durante un film', 'falls asleep during a film'], ['perde le chiavi di casa', 'loses their house keys'],
        ['diventa famoso su internet', 'becomes famous on the internet'], ['arriva in ritardo al proprio matrimonio', 'is late to their own wedding'],
        ['piange guardando un cartone animato', 'cries at a cartoon'], ['sopravvive in un’isola deserta', 'survives on a desert island'],
        ['finisce in prigione per sbaglio', 'ends up in jail by mistake'], ['vince alla lotteria e perde il biglietto', 'wins the lottery and loses the ticket'],
        ['parla da solo/a per strada', 'talks to themselves in the street'], ['si perde con il navigatore acceso', 'gets lost with the satnav on'],
        ['scrive un libro', 'writes a book'], ['fa il giro del mondo', 'travels around the world'],
        ['si innamora al primo sguardo', 'falls in love at first sight'], ['dimentica il compleanno di un amico', 'forgets a friend’s birthday'],
        ['mangia una cosa scaduta da mesi', 'eats something months past its date'], ['litiga con un arbitro', 'argues with a referee'],
        ['rompe il telefono ogni anno', 'breaks their phone every year'], ['diventa il capo di un’azienda', 'becomes the boss of a company'],
        ['ride nel momento sbagliato', 'laughs at the wrong moment'], ['adotta dieci gatti', 'adopts ten cats'],
        ['sa tutto di un argomento inutile', 'knows everything about a useless subject'], ['si fa un tatuaggio sull’impulso', 'gets a tattoo on impulse'],
        ['risponde a un messaggio dopo tre giorni', 'answers a message after three days'], ['corre una maratona senza allenarsi', 'runs a marathon without training'],
        ['cucina una cena disastrosa', 'cooks a disastrous dinner'], ['dice un segreto senza accorgersene', 'spills a secret without noticing'],
        ['va a vivere in un altro paese', 'moves to another country'], ['balla sul tavolo', 'dances on the table'],
        ['non finisce mai quello che comincia', 'never finishes what they start'], ['sopravvive a un’apocalisse zombie', 'survives a zombie apocalypse'],
    ];
    const RATHER = [
        ['non usare più il telefono per un anno', 'give up your phone for a year'], ['non mangiare più dolci', 'never eat sweets again'],
        ['sapere quando morirai', 'know when you will die'], ['sapere come morirai', 'know how you will die'],
        ['poter volare', 'be able to fly'], ['essere invisibile', 'be invisible'],
        ['vivere sempre al caldo', 'always live somewhere hot'], ['vivere sempre al freddo', 'always live somewhere cold'],
        ['avere tantissimi soldi ma niente amici', 'have loads of money but no friends'], ['avere pochi soldi ma amici veri', 'have little money but true friends'],
        ['leggere i pensieri degli altri', 'read other people’s minds'], ['che gli altri non leggano mai i tuoi', 'that nobody ever reads yours'],
        ['perdere tutte le tue foto', 'lose all your photos'], ['perdere tutti i tuoi messaggi', 'lose all your messages'],
        ['parlare con gli animali', 'talk to animals'], ['capire ogni lingua', 'understand every language'],
        ['rivivere il tuo giorno più bello', 'relive your best day'], ['vedere il tuo futuro', 'see your future'],
        ['non dormire mai', 'never need to sleep'], ['non avere mai fame', 'never feel hungry'],
        ['avere sempre ragione ma non essere creduto/a', 'always be right but never believed'], ['essere creduto/a ma sbagliare spesso', 'be believed but often wrong'],
        ['cantare male davanti a tutti', 'sing badly in front of everyone'], ['ballare male davanti a tutti', 'dance badly in front of everyone'],
        ['vivere un anno senza musica', 'live a year without music'], ['vivere un anno senza film e serie', 'live a year without films and series'],
        ['un compleanno a sorpresa', 'a surprise birthday party'], ['nessuna festa mai', 'no party ever'],
        ['mangiare solo pizza per sempre', 'eat only pizza forever'], ['non mangiare mai più pizza', 'never eat pizza again'],
    ];
    const BOMB = [
        ['un animale', 'an animal'], ['una città', 'a city'], ['un cibo', 'a food'], ['un lavoro', 'a job'],
        ['un cantante', 'a singer'], ['un film', 'a film'], ['uno sport', 'a sport'], ['un oggetto in cucina', 'something in a kitchen'],
        ['un paese', 'a country'], ['un colore', 'a colour'], ['una marca', 'a brand'], ['una materia di scuola', 'a school subject'],
        ['un frutto', 'a fruit'], ['un personaggio dei cartoni', 'a cartoon character'], ['un videogioco', 'a video game'],
        ['qualcosa di rotondo', 'something round'], ['qualcosa che si trova in bagno', 'something found in a bathroom'],
        ['una parola con la lettera A', 'a word with the letter A'], ['una parola che inizia per S', 'a word starting with S'],
        ['un mezzo di trasporto', 'a means of transport'],
    ];

    /** Next card index: never the one just shown, and no repeat until the whole deck has been seen. */
    function draw(state, size, rng) {
        rng = rng || Math.random;
        if (!state.left || !state.left.length) state.left = Array.from({ length: size }, (_, i) => i).filter((i) => i !== state.last);
        const k = Math.floor(rng() * state.left.length);
        state.last = state.left.splice(k, 1)[0];
        return state.last;
    }
    /** Hidden fuse of the bomb in milliseconds (12 to 40 seconds). */
    const fuse = (rng) => 12000 + Math.floor((rng || Math.random)() * 28000);

    const api = { LIKELY, RATHER, BOMB, draw, fuse };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
    root.Serata = api;

    VBI18N.add('it', {
        title: 'Serata — vector-box', desc: 'Tre giochi veloci per la serata con gli amici, con un solo telefono: chi è più probabile che…, preferiresti…? e la bomba. Gratis, senza account.',
        back: '← Giochi', mode_likely: 'Chi è più probabile?', mode_rather: 'Preferiresti…?', mode_bomb: 'La bomba', modes: 'Gioco',
        next: 'Avanti', pass: 'Passa', start: 'Via', again: 'Ancora',
        likely_lead: 'Chi è più probabile che…', likely_help: 'Leggi la frase e, al tre, tutti indicano una persona del gruppo. Chi riceve più dita risponde o beve.',
        rather_lead: 'Preferiresti…', rather_or: 'oppure', rather_help: 'Ognuno sceglie, poi si discute: chi ha scelto diversamente dagli altri deve spiegare perché.',
        bomb_help: 'Passa il telefono: chi lo tiene dice una cosa che rientra nella categoria e lo passa. Non sai quando esplode: chi ce l’ha in mano perde.',
        bomb_ready: 'Premi Via e passa il telefono.', bomb_say: 'Di’ {w} e passa!', bomb_boom: 'BOOM! Chi ha il telefono ha perso.',
    });
    VBI18N.add('en', {
        title: 'Party night — vector-box', desc: 'Three quick games for a night with friends, one phone only: most likely to…, would you rather… and the bomb. Free, no account.',
        back: '← Games', mode_likely: 'Most likely to…', mode_rather: 'Would you rather…?', mode_bomb: 'The bomb', modes: 'Game',
        next: 'Next', pass: 'Pass', start: 'Go', again: 'Again',
        likely_lead: 'Who is most likely to…', likely_help: 'Read the sentence and, on three, everyone points at someone in the group. Whoever gets most fingers answers or drinks.',
        rather_lead: 'Would you rather…', rather_or: 'or', rather_help: 'Everybody chooses, then talk it over: whoever chose differently from the others explains why.',
        bomb_help: 'Pass the phone: whoever holds it names something in the category and passes it on. Nobody knows when it blows: whoever holds it loses.',
        bomb_ready: 'Press Go and pass the phone.', bomb_say: 'Say {w} and pass!', bomb_boom: 'BOOM! Whoever holds the phone lost.',
    });

    document.addEventListener('DOMContentLoaded', () => {
        const $ = (id) => document.getElementById(id);
        if (!$('sr-card')) return;
        const tabs = [...document.querySelectorAll('.sr-tab')];
        const lang = () => (window.VBLang && VBLang.lang === 'it' ? 0 : 1);
        const decks = { likely: LIKELY, rather: RATHER, bomb: BOMB };
        const st = { likely: {}, rather: {}, bomb: {} };
        let mode = 'likely', cur = null, boomAt = 0, timer = null, boomed = false;
        try { const m = localStorage.getItem('vb_serata_mode'); if (decks[m]) mode = m; } catch (e) { /* private mode */ }

        function paint() {
            const card = $('sr-card'), btn = $('sr-next');
            card.classList.toggle('boom', boomed);
            tabs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
            $('sr-help').textContent = VBLang.t(mode + '_help');
            card.replaceChildren();
            const line = (cls, text) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; card.append(p); };
            if (mode === 'bomb') {
                btn.textContent = VBLang.t(boomed ? 'again' : (cur === null ? 'start' : 'pass'));
                if (boomed) line('sr-big', VBLang.t('bomb_boom'));
                else if (cur === null) line('sr-big', VBLang.t('bomb_ready'));
                else line('sr-big', VBLang.t('bomb_say', { w: BOMB[cur][lang()] }));
                return;
            }
            btn.textContent = VBLang.t('next');
            if (cur === null) return;
            if (mode === 'likely') { line('sr-lead', VBLang.t('likely_lead')); line('sr-big', LIKELY[cur][lang()]); } else {
                const [a, b] = [RATHER[2 * cur][lang()], RATHER[2 * cur + 1][lang()]];
                line('sr-lead', VBLang.t('rather_lead')); line('sr-big', a); line('sr-lead', VBLang.t('rather_or')); line('sr-big', b);
            }
        }
        function stopBomb() { clearTimeout(timer); timer = null; }
        function go() {
            if (mode === 'bomb') {
                if (boomed) { boomed = false; cur = null; }
                if (cur === null) { boomAt = Date.now() + fuse(); stopBomb(); timer = setTimeout(() => { boomed = true; stopBomb(); if (navigator.vibrate) { try { navigator.vibrate([200, 80, 400]); } catch (e) { /* unsupported */ } } paint(); }, boomAt - Date.now()); }
            }
            cur = draw(st[mode], mode === 'rather' ? RATHER.length / 2 : decks[mode].length);   // "rather" cards come in pairs
            paint();
        }
        tabs.forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; cur = null; boomed = false; stopBomb(); try { localStorage.setItem('vb_serata_mode', mode); } catch (e) { /* private mode */ } paint(); }));
        $('sr-next').addEventListener('click', go);
        window.addEventListener('vb-lang', paint);
        paint();
    });
})(typeof window !== 'undefined' ? window : globalThis);
