# vector-box — architettura e ricette

Questa pagina è per chi **modifica** il codice (il proprietario o una sessione di Claude). Dice dove sta ogni cosa, che
strada fa una richiesta e, in fondo, **quali file toccare** per i cambi più comuni. La guida per chi usa il sito, l'elenco
delle API e la pubblicazione sul server stanno in [DOCUMENTAZIONE.md](DOCUMENTAZIONE.md) e [DEPLOY.md](DEPLOY.md).

Prima di chiudere qualsiasi modifica: `bash tools/check.sh` (sintassi di ogni file PHP e JS, poi tutti i test).
Con `--fast` controlla solo la sintassi, in pochi secondi.

---

## 1. Mappa delle cartelle

```
public/                 l'unica cartella servita da nginx
  index.php             il desktop (finestre, terminale, chat)
  sitemap.php           elenco delle pagine pubbliche per i motori di ricerca
  pages/                una pagina per file: *.php passano da PHP, *.html sono giochi statici
  api/                  endpoint JSON (un file = un indirizzo) e librerie (*_lib.php, helpers.php, database.php)
  includes/             pezzi di pagina: head.php (ogni pagina PHP), appunti-top.php (barra degli Appunti), ads.php
  js/                   uno script per pagina/finestra; sottocartelle spia/ lupus/ cucu/ nonhomai/ per i giochi da festa
  css/                  uno stile per pagina; base/layout/components/widgets/mobile sono del desktop
  assets/ errors/       icone, font, immagini; pagine di errore statiche (generate da tools/make-error-pages.py)
bin/                    programmi da riga di comando (cron/systemd), mai chiamati dal web
lib/                    codice Node usato da server.js
server.js               hub Node della chat (SSE) e vecchio pannello: NON esegue PHP
tests/                  test automatici (node:test); tests/helpers.js avvia una copia pulita del sito
tools/                  check.sh, backup.sh, generatori (make-lefty-css.py, make-error-pages.py), Whisper
docs/                   questa documentazione
data/                   (non in git, FUORI da public/) database SQLite, sessioni, libri, file delle classi, log
```

### `public/api/`: chi è cosa

| Tipo | File | Note |
|---|---|---|
| Fondamenta | `helpers.php`, `database.php`, `rate_limiter.php`, `debug_logger.php` | incluse da quasi tutto |
| Sessione e account | `login.php`, `logout.php`, `check_session.php`, `save_theme.php`, `account_data.php` (+ `account_data_lib.php`), `get_user_profile.php` | |
| Chat | `get_feed.php`, `uplink_send.php`, `uplink_stream.php`, `rooms.php`, `delete_message.php`, `chat_typing.php`, `dm.php`, `guestbook.php`, `command.php` | stanze nascoste: vedi sezione 3 |
| Biblioteca | `books.php`, `bookmarks.php`, `progress.php`, `epub_meta.php`, `moderate_book_access.php` | |
| Giochi con server | `poker.php` (+ `poker_stats.php`, `poker_leaderboard.php`), `spia.php` + `spia_lib.php`, `lupus_lib.php`, `cucu_lib.php` | Lupus e Cucù usano le stanze di `spia.php` |
| Appunti di classe | `classi.php`, `appunti.php`, `calendario.php`, `bacheca.php`, `classifica.php`, `notifiche.php`, `condividi.php` | librerie: `classi_lib.php`, `appunti_lib.php`, `classifica_lib.php`, `notifiche_lib.php` |
| AI degli Appunti | `appunti_ai.php`, `classi_ai.php`, `gemini.php`, `appunti_zip.php`, `appunti_pptx.php`, `pdf_lib.php`, `appunti_demo.php` | l'AI gira dal lavoratore `bin/appunti-ai.php` |
| E-mail | `mailer.php` (coda e invio), `mail.php` (casella dell'admin), `mail_link.php` (link nelle e-mail) | spenta finché manca `MAIL_DRIVER` |
| Admin e stato | `admin_users.php`, `moderate_user.php`, `donors.php`, `get_log.php`, `status.php`, `pihole.php`, `telemetry.php` | |
| Visite e pulizia | `visits.php`, `visit.php`, `bots.php`, `retention.php`, `webpush.php` | chiamate da `includes/head.php` |

---

## 2. La strada di una richiesta

### Una pagina PHP (`public/pages/*.php`, `public/index.php`)

1. `require_once includes/head.php`: manda le intestazioni di sicurezza (`sendPageSecurityHeaders()`), ferma i bot
   molesti (`botBlockIfAbusive()`), registra la visita (`recordVisit()`), ogni tanto fa pulizia (`maybeRunRetention()`)
   e definisce `APP_VERSION`, il `?v=` di ogni CSS/JS.
2. `initSession()` (in `database.php`) apre la sessione, ricontrolla sul database che l'account esista e sia ancora
   admin, dà un nome `guest_xxxxxxxx` a chi non è entrato e **chiude subito la sessione** (sola lettura).
3. Nel `<head>` la pagina chiama `renderHead(...)`, che carica `js/csrf.js`, gli stili e gli script comuni.

### Una chiamata API (`public/api/*.php`)

Lo schema è sempre lo stesso; `public/api/mail.php` è un buon esempio corto da copiare.

```php
require_once __DIR__ . '/database.php';       // porta con sé helpers.php
require_once __DIR__ . '/rate_limiter.php';   // solo se serve checkRateLimit()

initSession();                                // sola lettura; initSession(true) + session_write_close() se scrivi $_SESSION
requireLogin();                               // oppure requireAdmin(), oppure niente se è pubblico
$me = (int)$_SESSION['user_id'];

try {
    $db = getDbConnection();                  // apre SQLite e, solo se serve, applica le migrazioni
    if ($_SERVER['REQUEST_METHOD'] === 'GET') { /* ...letture... */ }

    requireCsrf();                            // OBBLIGATORIO prima di ogni modifica
    $in = readJsonBody();
    if (!checkRateLimit('nome_azione', 60, 3600, 'user:' . $me)) jsonFail('slow_down', 'Too many requests', 429);
    /* ...modifica... */
    jsonResponse(['success' => true]);
} catch (Throwable $e) {
    failInternal('NOME', $e);                 // scrive in data/system_errors.log, al browser va un testo generico
}
```

- **Risposte:** `jsonResponse($array, $status)` manda il JSON e termina. `jsonFail($code, $message, $status)` è il
  rifiuto standard `{success:false, code, error}`: `code` è la parola che il JavaScript controlla, `error` il testo.
  (`apFail` in `appunti.php` fa lo stesso e aggiunge `Cache-Control: no-store`; `spiaFail` ha una forma sua.)
- **CSRF:** il token sta in `$_SESSION['csrf_token']`; `public/js/csrf.js` avvolge `fetch` e lo aggiunge da solo
  nell'intestazione `X-CSRF-Token` di ogni scrittura verso il sito. Nelle pagine basta usare `fetch`.
- **Limiti di frequenza:** `checkRateLimit('secchio', quante, in_quanti_secondi, chiave)` in `rate_limiter.php`. I numeri
  stanno scritti nel punto in cui si usano, accanto al nome del secchio: per trovarli tutti,
  `grep -rn "checkRateLimit(" public`. Senza chiave limita per indirizzo IP (`getClientIp()`); con `'user:' . $me` per account.
- **Database:** un solo file SQLite. Lo schema cambia **solo** con le migrazioni: `runMigrations()` chiama in ordine
  `migrateV1()` ... fino a `DB_SCHEMA_VERSION`, dentro una transazione, quando il file è a una versione più vecchia.
- **Errori:** mai `$e->getMessage()` al browser; sempre `failInternal()`.
- **IP del visitatore:** sempre `getClientIp()` (crede a `X-Forwarded-For` solo dai proxy di `TRUSTED_PROXIES`).

### Una pagina statica di gioco (`public/pages/*.html`)

Non passa da PHP: nessuna sessione, nessuno script scritto dentro la pagina (la CSP lo vieta), solo file con `?v=N`
scritto a mano. I giochi da festa (Spia, Lupus, Cucù, Non ho mai) parlano con `api/spia.php` e registrano la visita
con `js/visit.js`; i giochi da soli (Campo minato, 2048, Memory, Tris, Snake, Forza 4, Impiccato, Simon) non parlano
con il server e tengono i record nel `localStorage` del browser.

---

## 3. Come girano i dati

**Chat.** `js/uplink_feed.js` legge con `api/get_feed.php` e resta in ascolto su `api/uplink_stream.php` (o sull'hub
Node, se configurato: `chatStreamConfig()` in `helpers.php`). Si scrive con `api/uplink_send.php`, che salva nel
database e avvisa l'hub con `notifyChatHub()`. Le stanze sono in `api/rooms.php`: `is_private = 1` = scrive solo
l'admin, `is_hidden = 1` = legge solo l'admin (`isRoomHidden()`); una stanza nascosta va filtrata **in tutti e tre**:
feed, stream, invio. I messaggi privati sono a parte, in `api/dm.php` e `js/dm.js`.

**Appunti di classe.** Le classi, i membri, i ruoli e l'orario sono di `api/classi.php` (+ `classi_lib.php`); il
materiale, i documenti, i quiz e le verifiche di `api/appunti.php` (+ `appunti_lib.php`); argomenti, compiti e
turni di `api/calendario.php`; annunci di `api/bacheca.php`; punti di `api/classifica.php`; campanella e Web Push di
`api/notifiche.php`. I file caricati passano dalla coda a pezzi (`js/appunti-upload.js` → azioni `upload_*`) e finiscono
in `data/appunti/<classe>/`. L'AI **non gira mai in una richiesta web**: `bin/appunti-ai.php` (ogni 5 minuti) chiama le
funzioni di `api/appunti_ai.php` e `api/notifiche_lib.php`. L'indice di ricerca (`notes_fts`) è tenuto da trigger:
basta scrivere il materiale con INSERT/UPDATE/DELETE normali. Le risposte dei quiz le giudica il server
(`quiz_answer`, `review_answer`): la risposta giusta non va mai mandata alla pagina prima.
Lato browser: `js/appunti-common.js` (funzioni comuni a tutte le pagine degli Appunti), poi uno script per pagina
(`appunti.js`, `appunti-archivio.js`, `appunti-carica.js`, `appunti-impostazioni.js`...).

**Giochi.** L'elenco è `$GAMES` in `pages/giochi.php`. Giochi da festa: stato in JSON per stanza, cambiato dentro
transazioni in `spia_lib.php`, `lupus_lib.php`, `cucu_lib.php`, tutti dietro `api/spia.php`. Poker: `api/poker.php`,
ogni mossa in una sola transazione `BEGIN IMMEDIATE`. Giochi da soli: tutto nel browser, le regole in un file JS che
funziona anche in Node (così i test le provano senza browser).

**E-mail.** Chi vuole mandare un messaggio chiama `mailEnqueue()` (`api/mailer.php`): una riga nella coda. La coda la
svuota `bin/mail-worker.php` (ogni minuto) con `mailProcessQueue()` → `mailTransport()`. Con `MAIL_DRIVER` vuoto non
parte niente; con `log` finisce in `data/mail.log` (così lavorano i test). I link dentro le e-mail (conferma, disiscrizione)
sono firmati con `mailToken()` e arrivano a `api/mail_link.php`.

**Admin.** Tre posti: i comandi del terminale (`js/admin_commands.js` → `api/moderate_user.php`,
`api/moderate_book_access.php`, `api/delete_message.php`...), il pannello delle persone (`pages/admin_users.php` +
`js/admin_users.js` → `api/admin_users.php`) e la casella e-mail (`pages/mail.php` + `js/mail.js` → `api/mail.php`).
Ogni endpoint admin chiama `requireAdmin()` (che rilegge dal database se l'account è ancora admin) e `requireCsrf()`.

---

## 4. Ricette

Ogni ricetta elenca **tutti** i file da toccare. Alla fine, sempre: `bash tools/check.sh`.

### Aggiungere un gioco da soli (pagina statica)

Modello: Tris. Copia i suoi file e cambia il nome (qui `nuovo`).

1. `public/js/nuovo.js`: le **regole** in cima, senza toccare la pagina, esportate con le due righe che hanno tutti:
   `if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }` e `root.Nuovo = api;`.
   Sotto, la parte che disegna e ascolta i tasti. Il record va nel `localStorage` dentro `try/catch` (in navigazione
   privata può fallire). Il testo che arriva dall'utente si scrive con `textContent`.
2. `public/pages/nuovo.html`: copia `public/pages/tris.html` (titolo, descrizione, `og:`). Nessuno script dentro la
   pagina, solo `<script src="../js/nuovo.js?v=1" defer>`.
3. `public/css/nuovo.css`: solo quello che è del gioco; barra, bottoni e messaggi sono già in `public/css/arcade.css`.
4. `public/assets/nuovo/icon.svg`: l'icona.
5. `public/pages/giochi.php`: una voce in `$GAMES` (`'group' => 'solo'`, `href`, `icon`, testi IT/EN).
6. `public/sitemap.php`: una riga `['/pages/nuovo.html', 'monthly', '0.7']`.
7. Test: in `tests/arcade2.test.js` (o un file nuovo uguale) carica le regole con `require` e provale; aggiungi il nome
   all'elenco del test "the three pages are served..." che controlla pagina, file, lista dei giochi e sitemap.
8. Quando poi cambi il JS o il CSS, alza a mano il `?v=` nella pagina `.html`.

### Aggiungere un endpoint API

1. `public/api/nome.php` con lo schema della sezione 2. Commento in cima: cosa fa e l'elenco delle azioni.
2. Se modifica qualcosa: `requireCsrf()`; se è dell'admin anche `requireAdmin()`; se si può abusare: `checkRateLimit()`.
3. Rifiuti con `jsonFail('codice', 'Testo', 4xx)`, errori con `failInternal('NOME', $e)`.
4. Dal browser basta `fetch('/api/nome.php', {method: 'POST', body: JSON.stringify({...})})`: il token lo mette `csrf.js`.
5. Test nuovo in `tests/` (vedi "Aggiungere un test"): almeno il caso buono, senza login, senza CSRF.

Per un'azione nuova degli Appunti non serve un file: aggiungi un blocco `if ($action === '...') { ... }` in
`public/api/appunti.php` e una riga nell'elenco in cima allo stesso file.

### Aggiungere una tabella o una colonna (migrazione)

Tutto in `public/api/database.php`:

1. Scrivi `function migrateVN(PDO $db): void { ... }` (N = il numero dopo l'ultimo, oggi 36 se `DB_SCHEMA_VERSION` è 35). Per una colonna usa
   `addColumnIfMissing($db, 'tabella', 'colonna', 'TIPO DEFAULT ...')`; per una tabella `CREATE TABLE IF NOT EXISTS`.
2. Porta `DB_SCHEMA_VERSION` a N. Basta così: `runMigrations()` chiama da sola ogni `migrateVN` mancante, in ordine.
3. Mai `CREATE`/`ALTER` in una richiesta normale, e mai modificare una migrazione già pubblicata: se ne aggiunge una nuova.
4. I test partono da un database vuoto, quindi provano tutte le migrazioni a ogni giro.
5. Sul server il database vero non si apre mai a mano con `sqlite3`: si lavora su una copia.

### Aggiungere un permesso di classe

1. `public/api/classi_lib.php`: una riga in `CLASS_PERMS` (`'chiave' => 'Testo in italiano'`). Compare da solo nelle
   caselle dei ruoli, perché la pagina le disegna da `perm_labels`.
2. Dove serve il controllo, nell'endpoint: `[$class, $perms] = apClass($db, $classId, $me, $isAdmin);` (o l'equivalente
   del file) e poi `if (!in_array('chiave', $perms, true)) ...Fail('forbidden', '...', 403);`. Il rappresentante e
   l'admin li hanno tutti (`classPerms()`).
3. Nel JavaScript, per nascondere il bottone a chi non può: `(c.perms || []).includes('chiave')`.
4. Test: `tests/classi-permessi.test.js`.

### Aggiungere un tema

1. `public/js/theme.js`: una voce in `THEMES` con **tutti** i colori (`label`, `bg`, `accent`, `muted`, `prompt`, `panel`, `matrix`).
2. `public/api/helpers.php`: lo stesso id in `SYSTEM_THEMES`.
3. `tests/temi.test.js` controlla che i due elenchi coincidano e che non manchi nessun colore.

### Aggiungere un'impostazione nel `.env`

1. Leggila con `envValue('NOME', 'valore di default')` (`helpers.php`): funziona nelle pagine e nei programmi di `bin/`.
2. Aggiungi la riga, commentata, in `.env.example` (il `.env` vero non va mai in git).
3. Nei test si passa a `startSite({ NOME: 'valore' })`.
4. Sul server il `.env` va aggiornato a mano **prima** di pubblicare (`updatesite.sh` non lo tocca), con il sì del proprietario.

### Aggiungere un'azione al pannello admin delle persone

1. `public/api/admin_users.php`: un blocco `if ($action === 'nuova') { ... }` dopo `requireCsrf()` (il file ha già
   `requireAdmin()` in cima); aggiorna l'elenco delle azioni nel commento iniziale.
2. `public/js/admin_users.js`: il bottone e la `fetch`. I nomi e i testi delle persone con `textContent`.
3. `public/pages/admin_users.php` e `public/css/admin_users.css` solo se serve un elemento nuovo nella pagina.
4. Test in `tests/admin-utenti.test.js`: un utente normale deve ricevere 403.

### Aggiungere un tipo di e-mail

Non ci sono modelli separati: il testo si compone nel punto che manda, e passa sempre dalla coda.

1. Componi oggetto e testo (testo semplice) e chiama
   `mailEnqueue($db, null, $accountId, $indirizzo, $oggetto, $testo . mailFooter($db, $accountId), 'tipo')`.
   Esempi: la conferma dell'indirizzo in `public/pages/account.php`, il messaggio diretto in `public/api/admin_users.php`.
2. L'oggetto e i nomi vanno puliti con `mailLine()`; l'indirizzo controllato con `mailValidAddress()`.
3. Un link che deve valere senza login: `mailToken($db, 'tipo', $accountId)` e il controllo in `public/api/mail_link.php`.
4. Test in `tests/email.test.js` con `MAIL_DRIVER=log`: il messaggio si legge in `data/mail.log` della copia di prova.

### Aggiungere una pagina agli Appunti

1. `public/pages/appunti-nome.php`; la barra in alto è `appuntiTop('nome', $username)` di `public/includes/appunti-top.php`
   (un bottone nuovo si aggiunge lì, non a mano nella pagina).
2. Ogni file che la pagina carica deve stare nel suo `$v` (anche `csrf.js`): nginx tiene in cache per un anno i file con `?v=`.
3. Dopo aver cambiato `public/css/appunti.css`: `python3 tools/make-lefty-css.py` (modalità mancini).
4. Non toccare `public/pages/appunti-sw.js` senza motivo: ogni suo cambio fa reinstallare il service worker a tutti.

### Aggiungere un test

```js
// tests/nome.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

let site, anna;
test.before(async () => { site = await startSite(); anna = new Client(site); await anna.register('anna_test'); });
test.after(() => site.stop());

test('cosa deve succedere', async () => {
    const r = await anna.post('/api/nome.php', { action: 'x' });
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
});
```

- `startSite(env)` copia `public/`, `lib/` e `bin/` in una cartella temporanea con un `data/` vuoto e avvia PHP: il
  database vero non viene mai toccato. `site.db('SELECT ...', [parametri])` legge il database di prova.
- `Client` è un piccolo browser: tiene i cookie e manda da solo il token CSRF (`{ csrf: false }` per provare il rifiuto).
  `makeAdmin(site)` restituisce un client admin.
- Un solo file: `node --test tests/nome.test.js`. Tutto: `npm test`, oppure `bash tools/check.sh`.

---

## 5. Regole che non si rompono

Sono quelle di `CLAUDE.md`; qui solo il promemoria con il perché.

| Regola | Perché |
|---|---|
| `initSession(true)` + `session_write_close()` se scrivi `$_SESSION` | `initSession()` chiude la sessione: una scrittura dopo va persa |
| `requireCsrf()` su ogni modifica | senza, un altro sito può far fare l'azione a chi è entrato |
| `failInternal()`, mai `$e->getMessage()` | i messaggi d'errore mostrano percorsi e query |
| `getClientIp()`, mai `X-Forwarded-For` a mano | quell'intestazione la scrive chiunque |
| schema solo con `migrateVN()` | il database del server deve arrivare allo stesso punto di quello dei test |
| testo dell'utente con `textContent` | `innerHTML` esegue quello che l'utente ha scritto |
| niente funzioni che differiscono da una di PHP solo per maiuscole | in PHP `strLen` e `strlen` sono la stessa funzione |
| `textLength()` / `textCut()` invece di `mb_*` | `mbstring` può mancare |
| mai `.env` o `data/` in git | il repository è pubblico |
