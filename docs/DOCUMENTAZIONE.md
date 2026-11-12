# vector-box — documentazione

> **Bozza** (2026-11-12). Le parti da completare sono segnate con **TODO**. Codice: <https://github.com/G1anPietro/vector-box>

vector-box è un sito personale in stile desktop cyberpunk: finestre, terminale e barra delle applicazioni nel browser.
Dentro ci sono una chat con stanze e messaggi privati, un lettore di libri privato, giochi da festa per telefono e giochi
da soli. Gira su un piccolo server di casa (Ubuntu, nginx, PHP-FPM, Node.js).

---

## 1. Panoramica

| Parte | Cosa fa |
|---|---|
| **Desktop** (`public/index.php`) | Finestre trascinabili: TERMINAL, CHAT, UPLINK, POKER, TOOLS, VAULT, STATUS, WALL, DM, READER. Su telefono: un'app alla volta con una barra di schede in basso. |
| **Terminale** | Comandi per utenti e admin (`help` per l'elenco), piccolo filesystem, minigiochi, comandi di moderazione. |
| **Chat** | Stanze pubbliche, private (solo l'admin scrive) e nascoste (solo l'admin legge); menzioni @, chi è online, "sta scrivendo". |
| **Messaggi privati** | Tra utenti registrati, con blocco; nessuna via di accesso per l'admin nelle API. |
| **Lettore di libri** | EPUB e PDF, solo per gli account autorizzati: copertine, "continua a leggere", segnalibri, caricamento di più file. |
| **Giochi** (`pages/giochi.php`) | Chi è la spia?, Lupus, Non ho mai…, Poker, Solitario, Node Breach, ARG Vault. |
| **Pagine pubbliche** | Giochi, Supporta (`ads.php`), Privacy, Credits. Il Curriculum (`resume.php`) è privato come la biblioteca (`/grantcv`). |
| **Hub Node** (`server.js`) | Facoltativo: consegna la chat in tempo reale con una sola connessione SSE per browser. |

## 2. Architettura

```
 browser ──HTTPS──► nginx ─┬─► PHP-FPM ── public/ (pagine e API) ──► SQLite (data/vector_uplink.sqlite)
                           │                     │
                           │                     └─ notifica i messaggi nuovi ──► hub Node (127.0.0.1)
                           └─ /api/chat/stream ─────────────────────────────────► hub Node (SSE)
```

- **PHP è la fonte di verità**: salva ogni messaggio, gestisce account, permessi e giochi.
- **Node** (`server.js`) è opzionale: riceve da PHP i messaggi nuovi/cancellati (`/internal/chat/publish`, solo da
  loopback e con un segreto condiviso) e li spinge ai browser collegati a `/api/chat/stream`. Senza Node la chat usa lo
  stream PHP (`api/uplink_stream.php`). Node contiene anche un vecchio pannello di controllo (Minecraft, Wake-on-LAN) non
  esposto in produzione.
- **Pagine statiche** (`pages/spia.html`, `lupus.html`, `nonhomai.html`, `solitario.html`): girano anche offline nel
  browser e parlano con il server solo tramite le API dei giochi.
- `data/` sta **fuori** dalla cartella pubblicata: database, sessioni PHP, libri, copertine, log.

## 3. Struttura delle cartelle

```
public/            radice del sito (l'unica cartella servita da nginx)
  index.php        il desktop
  pages/           pagine: giochi, lettore, curriculum, privacy, supporta, giochi statici
  api/             endpoint JSON e librerie condivise (helpers, database, rate limiter, motori dei giochi)
  includes/        head.php (intestazioni di sicurezza, versione, registro visite), ads.php
  js/ css/ assets/ script, stili, icone, font self-hosted
lib/               codice condiviso con i test
server.js          hub Node / pannello
tests/             test automatici (node:test)
tools/backup.sh    backup notturno
updatesite.sh      aggiornamento del sito sul server
data/              (non in git) database, sessioni, libri, log
```

## 4. Database

SQLite in modalità WAL. Lo schema ha una versione (`PRAGMA user_version`, oggi **10**): le modifiche sono funzioni
`migrateVN()` in `public/api/database.php`, eseguite una sola volta sotto lock.

| Versione | Cosa aggiunge |
|---|---|
| V1 | account, stanze, messaggi (`transmissions`), poker, libri, avanzamento lettura, limiti di richieste |
| V2 | `books.meta_checked` (riparazione dei metadati EPUB) |
| V3 | `guestbook` (muro dei graffiti) |
| V4 | `bookmarks` (segnalibri) |
| V5 | `poker_stats` (classifica) |
| V6 | stanze di Chi è la spia? (`spia_rooms`, `spia_devices`, `spia_players`, `spia_rounds`, `spia_assign`, `spia_votes`) |
| V7 | stanze multi-gioco e `lupus_games` (stato della partita in JSON) |
| V8 | messaggi privati (`dm_messages`, `dm_blocks`) |
| V9 | `visitors` (registro visite); riprova le copertine EPUB mancanti |
| V10 | `accounts.can_view_resume` (curriculum privato) |

**Regole:** mai DDL fuori dalle migrazioni; ogni modifica = nuova `migrateVN()` + `DB_SCHEMA_VERSION` + chiamata in
`runMigrations()` + `EXPECTED_SCHEMA` in `updatesite.sh`. Sul server il database non va aperto con `sqlite3` da un
utente diverso da quello di PHP: usare una copia.

## 5. API (public/api)

Tutte rispondono in JSON. Le richieste che modificano qualcosa richiedono il token CSRF (`X-CSRF-Token`, aggiunto da
solo da `js/csrf.js`).

| Endpoint | Chi | Cosa fa |
|---|---|---|
| `check_session.php` | tutti | sessione, token CSRF, configurazione dello stream della chat |
| `login.php`, `logout.php` | tutti | registrazione, accesso, uscita |
| `uplink_send.php` | utenti | invia un messaggio in chat |
| `get_feed.php`, `uplink_stream.php` | tutti* | messaggi (storico / stream SSE di riserva) |
| `rooms.php` | tutti* / admin | elenco stanze; creazione (admin) |
| `delete_message.php` | admin | cancella un messaggio |
| `chat_typing.php` | utenti | segnale "sta scrivendo" (solo via hub) |
| `dm.php` | registrati | messaggi privati, blocco |
| `books.php` | autorizzati | catalogo, caricamento, lettura/scaricamento, copertine |
| `progress.php`, `bookmarks.php` | autorizzati | avanzamento e segnalibri |
| `moderate_user.php`, `moderate_book_access.php` | admin | moderazione; permessi di biblioteca e curriculum (`scope`: `books` / `resume`) |
| `spia.php` | tutti | stanze di Chi è la spia? e Lupus (token del dispositivo in `X-Spia-Device`) |
| `poker.php`, `poker_stats.php`, `poker_leaderboard.php` | tutti / utenti | tavolo, statistiche, classifica |
| `guestbook.php` | tutti | muro dei graffiti |
| `status.php` | tutti | stato pubblico del server (finestra STATUS) |
| `command.php` | tutti (con CSRF) | modulo "lascia un messaggio all'admin" (notifica ntfy) |
| `get_log.php` | admin | log degli errori |
| `visit.php` | tutti | beacon delle pagine statiche per il registro visite |

\* le stanze nascoste sono escluse per chi non è admin.

**TODO:** parametri e risposte di ogni endpoint.

## 6. Sicurezza

- **Sessioni:** `initSession()` apre e chiude subito (sola lettura); chi scrive in sessione usa `initSession(true)` e
  `session_write_close()`.
- **CSRF:** ogni endpoint che modifica chiama `requireCsrf()`; quelli admin anche `requireAdmin()`.
- **Errori:** mai il messaggio dell'eccezione al browser: `failInternal()` scrive nel log e risponde in modo generico.
- **IP del client:** solo con `getClientIp()`; `X-Forwarded-For` vale solo dai proxy in `TRUSTED_PROXIES`.
- **XSS:** il testo degli utenti entra con `textContent`, mai `innerHTML` o `onclick` inline.
- **Content-Security-Policy** (`sendPageSecurityHeaders()`): `CSP_ENFORCE=true` per applicarla; le pagine con
  annunci (`VB_ADS_PAGE`) aprono solo i domini di Google necessari.
- **Limiti di richieste** salvati in SQLite (`checkRateLimit()`).
- **Hub della chat:** token firmato (HMAC), valido 60 secondi e per **una sola** connessione.
- **Biblioteca e curriculum privati:** pagina, file e copertine solo per gli account con il permesso (`/grantbook`,
  `/grantcv`); `robots.txt` tiene fuori i motori di ricerca.
- **Logout e modulo per l'admin** rifiutano le richieste che partono da altri siti; le sessioni accettano solo ID creati
  dal server (`session.use_strict_mode`).

## 7. Configurazione (`.env`)

Si parte da `.env.example`. Le voci principali:

| Variabile | A cosa serve |
|---|---|
| `SESSION_SECRET`, `ADMIN_PASSWORD`, `GUEST_PASSWORD` | obbligatorie per Node |
| `TRUSTED_PROXIES` (PHP), `TRUST_PROXY` (Node) | proxy fidati per l'IP del client |
| `NTFY_TOPIC_URL` | notifiche del modulo "messaggio all'admin" |
| `CHAT_HUB_SECRET`, `CHAT_STREAM_URL`, `CHAT_HUB_INTERNAL_URL`, `CHAT_STREAM_CORS_ORIGIN`, `PORT`, `BIND_HOST` | hub della chat |
| `CSP_ENFORCE` | applica la Content-Security-Policy |
| `STATUS_CHECKS` | servizi mostrati nella finestra STATUS |
| `ADSENSE_CLIENT`, `ADSENSE_SLOT_GAMES`, `ADSENSE_SLOT_SUPPORT` | annunci (spenti se vuoti), vedi `docs/ADSENSE.md` |
| `CONTACT_EMAIL` | contatto nella pagina privacy |
| `VISIT_NTFY_URL`, `VISIT_NOTIFY`, `VISIT_GAP_MIN`, `VISIT_NOTIFY_MAX_PER_HOUR` | registro visite e notifiche |

## 8. Sviluppo in locale

```bash
cp .env.example .env              # e riempirlo
npm install
php -S 127.0.0.1:8080 -t public   # PHP_CLI_SERVER_WORKERS=4 per provare SSE e concorrenza
npm start                         # hub Node (facoltativo)
npm test                          # 83 test: account, CSRF, stanze, chat, hub, giochi, DM, visite, permessi…
```

Prima di ogni commit: `php -l` sui file PHP toccati e `node --check` sui JS. Usare sempre una **copia** del database.

## 9. Pubblicazione sul server

`sudo bash updatesite.sh` sul server: scarica `main`, conserva eventuali modifiche locali, aggiorna le dipendenze Node se
cambiate, scrive la versione (`version.php`, usata per i `?v=` dei file), esegue le migrazioni, riavvia l'hub e controlla
che lo schema sia quello atteso. Serve un `.env` già presente. Dettagli e configurazione nginx: `docs/DEPLOY.md`;
backup: `docs/BACKUP.md`.

Estensioni PHP necessarie: `pdo_sqlite`, `curl`, `zip` e `xml` (per le copertine EPUB), `mbstring` consigliata.
**TODO:** elenco completo verificato.

## 10. Come si fa…

- **Aggiungere un gioco alla pagina Giochi:** una voce nell'elenco `$GAMES` in cima a `public/pages/giochi.php`
  (gruppo, colori, link, icona, testi IT/EN) e lo stile della "scatola" in `public/css/giochi.css`.
- **Aggiungere una tabella o una colonna:** nuova `migrateVN()` (vedi sezione 4).
- **Aggiungere un endpoint che modifica dati:** `requireCsrf()` (e `requireAdmin()` se serve), `failInternal()` per gli
  errori, `checkRateLimit()` se può essere abusato, e un test in `tests/`.
- **Aggiungere testi tradotti ai giochi:** chiavi in `public/js/spia/i18n.js` per tutte e 5 le lingue (it, en, es, fr, de).

## 11. Limiti noti e lavori aperti

- Il pannello Node (Minecraft, Wake-on-LAN) è vecchio e non va esposto.
- La pagina Doom non funziona.
- **TODO:** schermate, guida per gli utenti (come si gioca, come si usa il terminale), elenco dei comandi del terminale.
