# Tecniche di ottimizzazione per vector-box

Elenco completo, ordinato per area. Stato: **[fatto]** già in produzione, **[ok?]** serve il tuo ok (configurazione fuori
dal repo: nginx, PHP, systemd, .env), **[codice]** lo posso fare io nel repo, **[misura]** prima va misurato, **[no]**
sconsigliato per questo sito. Impatto/sforzo: ★ poco … ★★★ molto.

Contesto misurato (controllo del 16/11): il server è quasi fermo (carico 0.00, RAM 1,3 su 7 GB, risposte in 3–10 ms,
SQLite 5,4 MB). Quindi **la velocità oggi non è il problema**: queste tecniche servono a reggere più utenti, a risparmiare
banda (il server è in una casa) e a tenere pulito il sistema. Parti dalle voci marcate ★★★.

---

## 1. nginx (serve il tuo ok, tranne dove indicato)

- [ok?] ★★★ **Cache lunga di `/js` e `/css`** (1 anno con `?v=`): righe già pronte in `docs/DA-FARE.md` (~riga 178). Meno richieste "è cambiato?" a ogni apertura.
- [fatto] Compressione gzip di css/js/json/html (funziona; verificare `gzip_types` con json e svg).
- [ok?] ★★ **Brotli** (`ngx_brotli`): file di testo ~15–20% più piccoli di gzip. Serve il modulo; vale la pena solo se la banda di casa è lenta.
- [ok?] ★★ **`gzip_static` / file `.gz` precompressi** per JS e CSS (li genera `updatesite.sh`): niente CPU a ogni richiesta e livello di compressione massimo.
- [ok?] ★★ **HTTP/2 già attivo; valutare HTTP/3 (QUIC)**: meglio sul Wi-Fi/4G dei telefoni, ma serve aprire UDP 443 sul router.
- [ok?] ★ **`open_file_cache`** (`max=2000 inactive=60s`): meno chiamate al disco per i file statici.
- [ok?] ★ **`sendfile on; tcp_nopush on; tcp_nodelay on;`** (di solito già attivi).
- [ok?] ★ **`keepalive_timeout 30`** invece di 75 s (meno connessioni ferme); `keepalive_requests` più alto.
- [ok?] ★★ **Cache FastCGI per le pagine pubbliche** (`/`, giochi, guida) con chiave che esclude chi ha un cookie di sessione: le pagine statiche in pratica non toccano PHP. Attenzione ai contenuti diversi per utente (la home mostra il nome).
- [ok?] ★★ **`expires` / `Cache-Control` per immagini, font, PDF.js, WAD di Doom**: `public, max-age=31536000, immutable` per ciò che ha il `?v=`.
- [ok?] ★ **`Vary: Accept-Encoding`** corretto e `etag on` dove manca.
- [ok?] ★★ **Zone `limit_req` separate** (API normali, login, libri, upload): fatto per libri e scanner; manca una zona stretta per `/api/login*`.
- [ok?] ★ **`limit_conn`** per IP sulle connessioni SSE (chat): evita che un solo client apra decine di stream.
- [ok?] ★ **`client_body_buffer_size` e `client_max_body_size`** per route (upload di appunti 40 MB, il resto piccolo).
- [fatto] Pagine di errore statiche e 404 vero per indirizzi sconosciuti.
- [ok?] ★ **Log con `$request_time` e `$upstream_response_time`** (fatto `$request_time`; aggiungere upstream).
- [ok?] ★★ **Nextcloud: spegnere il vhost o mettere il computer in rete**: il 79% delle richieste di ieri erano 502 verso un server spento.
- [ok?] ★ **`proxy_buffering off` solo per gli SSE**, `proxy_cache` mai per le API.
- [ok?] ★ **OCSP stapling, `ssl_session_cache shared:SSL:10m`, `ssl_session_tickets off`, TLS 1.3**: handshake più veloci.
- [ok?] ★ **`server_tokens off`** (già in DA-FARE).

## 2. PHP-FPM e OPcache

- [ok?] ★★ **OPcache**: `opcache.validate_timestamps=0` (con `reload` di php-fpm nello script di deploy), `opcache.memory_consumption=128`, `opcache.interned_strings_buffer=16`, `opcache.max_accelerated_files=10000`. Oggi controlla i file ogni 2 s.
- [ok?] ★★ **Preloading** (`opcache.preload`) delle funzioni più usate (helpers, database): meno lavoro a ogni richiesta; porta rischi con le modifiche, solo con `validate_timestamps=0`.
- [misura] ★ **JIT** (`opcache.jit=tracing`): su PHP 8.5 dà poco per codice che aspetta SQLite; lasciarlo spento finché non si misura.
- [ok?] ★★ **`pm = ondemand` o `dynamic` con `pm.max_children` calcolato sulla RAM** (ogni worker ~30–40 MB): oggi 20 worker sono troppi per la RAM libera solo se tutti pesanti; va bene così.
- [ok?] ★ **`pm.max_requests = 500`**: ricicla i worker contro le perdite di memoria.
- [ok?] ★ **`realpath_cache_size=4096K` e `realpath_cache_ttl=600`**.
- [ok?] ★ **`session.gc_probability`** e pulizia sessioni con cron invece che a caso (5.907 file di sessione in `data/sessions`).
- [ok?] ★★ **`request_slowlog_timeout=2s` + slowlog**: la prossima volta si vede quale funzione è lenta.
- [ok?] ★ **`php.ini`**: `zend.assertions=-1`, `expose_php=Off`, `display_errors=Off`, `output_buffering=4096`.
- [ok?] ★★ **Separare un pool FPM per le chat/SSE e le API lunghe** (`/api/uplink_stream.php`): un blocco non ferma le pagine normali.

## 3. SQLite

- [fatto] WAL, `synchronous=NORMAL`, `busy_timeout=5000`; indici principali presenti.
- [codice] ★★ **`PRAGMA cache_size=-8000`** (8 MB), **`temp_store=MEMORY`**, **`mmap_size=268435456`** per connessione. Con 5 MB di DB non cambia nulla ora, ma costa niente.
- [codice] ★ **`PRAGMA optimize` e `ANALYZE`** ogni tanto (job notturno, dopo il backup).
- [codice] ★ **`PRAGMA wal_autocheckpoint`** più basso/alto e un `wal_checkpoint(TRUNCATE)` notturno: tiene piccolo il file `-wal`.
- [codice] ★★ **Indice che copre `ORDER BY` delle notifiche** (`user_id, id DESC`): oggi il piano usa un B-tree temporaneo.
- [codice] ★ **Pulizia periodica di tabelle che crescono** (`rate_limits`, `visitors`, `bot_stats`, log, notifiche lette) con `DELETE` a blocchi.
- [codice] ★★ **Transazioni brevi**: raggruppare più `INSERT` in una `BEGIN IMMEDIATE`; mai una chiamata a Gemini o al disco dentro una transazione.
- [codice] ★ **Prepared statement riusati** nei cicli (la chat lo fa già).
- [codice] ★★ **Evitare `SELECT *`** nelle liste (`class_items`, `books`): meno dati, meno RAM; alcune query leggono colonne di testo grandi (OCR, trascrizioni) senza bisogno.
- [codice] ★★ **Testo grande fuori dalle righe di lista**: `class_item_files.text` e simili in una tabella a parte o letti solo nel dettaglio.
- [codice] ★ **FTS5 (`notes_fts`) già con trigger**: aggiungere `optimize` periodico (`INSERT INTO notes_fts(notes_fts) VALUES('optimize')`).
- [codice] ★ **`VACUUM` raro** (dopo grandi cancellazioni) e `auto_vacuum=INCREMENTAL` solo se il file cresce.
- [no] Passare a MySQL/Postgres: per un sito con 1 scrittore alla volta e 5 MB è un peso inutile. Rivalutare solo oltre ~50 GB o scritture parallele continue.
- [misura] ★ **Litestream / backup continuo** non è velocità ma sicurezza: il backup notturno c'è già.

## 4. Codice PHP

- [codice] ★★★ **Meno richieste per pagina**: dove una pagina fa 5 chiamate `fetch` all'apertura, farne una sola che restituisce tutto (come `books.php?action=list`, che già carica anche i progressi).
- [codice] ★★ **Intestazioni di cache e `ETag`/`304`** nelle API di sola lettura (`status`, liste che cambiano di rado): `If-None-Match` e risposta vuota.
- [codice] ★★ **Cache in memoria con APCu** per dati che cambiano poco (impostazioni di classe, orari, lista materie, ruoli) con scadenza 30–60 s e invalidazione alla scrittura.
- [codice] ★★ **`initSession()` in sola lettura** già c'è: verificare che nessuna API di lettura tenga la sessione aperta più del necessario.
- [codice] ★★ **Spostare il lavoro lento dopo la risposta** con `fastcgi_finish_request()` (notifiche push, ntfy, conteggi, log): già fatto per le visite, estendere a push e statistiche.
- [codice] ★★ **Code in background per il lavoro pesante** (Gemini, Whisper, copertine PDF, zip): c'è un worker ogni 5 minuti; una coda con priorità e limite di concorrenza evita picchi.
- [codice] ★ **Autoload leggero**: oggi si caricano molti `require_once` per richiesta; caricare solo ciò che serve (`appunti_ai.php` da 845 righe non serve a ogni chiamata).
- [codice] ★ **Dividere i file enormi** (`appunti.php` 1300 righe, `database.php` 937): non velocizza, ma OPcache e la manutenzione ringraziano.
- [codice] ★ **Evitare `file_put_contents` con `LOCK_EX` in percorsi caldi**: raggruppare i log o usare `syslog`.
- [codice] ★★ **Streaming di file grandi** con `readfile`/`X-Accel-Redirect`: far servire a nginx i libri/PDF/zip (`internal` + `X-Accel-Redirect`) libera il worker PHP durante il download. [ok?] per la parte nginx.
- [codice] ★ **Range request per i PDF** già fatte; aggiungere `Cache-Control` e `ETag` ai file immutabili.
- [codice] ★ **Confronti e ricerche**: dove c'è `LIKE '%x%'` su tabelle grandi, passare a FTS5.
- [codice] ★ **JSON**: `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES` e niente pretty-print in produzione.
- [codice] ★ **Compressione applicativa** non serve: la fa nginx.

## 5. Tempo reale (chat, poker, giochi)

- [codice] ★★★ **Chat: sleep adattivo** nello stream (1 s se c'è attività, poi 2–3 s) e, meglio, un "numero di messaggio più alto" in memoria condivisa (APCu o file di 8 byte) così lo stream non interroga SQLite se non è cambiato nulla.
- [codice] ★★★ **Spostare gli SSE su Node** (che regge migliaia di connessioni aperte): l'unico caso in cui un altro processo ha davvero senso. Il Node già c'è e fa telemetria SSE.
- [codice] ★★ **Poker: polling ogni 2 s → intervallo variabile** (più lento a scheda nascosta o fuori dal turno), o SSE come la chat.
- [codice] ★★ **`Page Visibility API`**: fermare timer e stream quando la scheda è nascosta (si fa già in alcuni punti, non ovunque).
- [codice] ★ **Giochi da festa (Spia, Lupus, Cucù)**: stato leggero con `ETag`/versione; il client riceve solo "cambiato / non cambiato".
- [codice] ★ **Backoff esponenziale** dopo errori di rete invece di riprovare a intervallo fisso.
- [codice] ★ **WebSocket** non servono: gli SSE bastano per una direzione.
- [ok?] ★ **`limit_conn`** e timeout per gli SSE (vedi nginx).

## 6. Frontend: JavaScript e CSS

- [fatto] `?v=` automatico per la cache (file mtime / versione).
- [codice] ★★ **Caricare lo script solo dove serve** (`defer`, `type=module`): `matrix.js` (sfondo animato) è su ogni pagina.
- [codice] ★★ **Minificare JS e CSS** in `updatesite.sh` (esbuild/terser/lightningcss, zero dipendenze a runtime): ~30–40% in meno prima di gzip. 1,2 MB totali oggi.
- [codice] ★★ **Dividere i file grandi per pagina** (`appunti-common.js` con ~1000 righe) e usare `import()` per le parti rare (editor di calendario, impostazioni).
- [codice] ★★ **PDF.js, pdf-lib e librerie pesanti** solo quando si apre un PDF; non nel caricamento iniziale della pagina.
- [codice] ★★ **Animazioni**: sfondo `canvas` e glitch con `requestAnimationFrame`, a 30 fps, in pausa a scheda nascosta e con `prefers-reduced-motion`; su telefono economico pesano più di tutto il resto.
- [codice] ★ **Debounce** su ricerche e filtri; **delegazione eventi** invece di un listener per riga.
- [codice] ★ **Liste lunghe**: virtualizzare o paginare (archivio con 300 elementi) e `content-visibility: auto`.
- [codice] ★ **`<link rel="preload">` per CSS e font critici**, `preconnect` solo dove serve (niente con terze parti).
- [codice] ★ **Font**: se si caricano font web, `font-display: swap` e sottoinsieme latino; il sito usa Courier di sistema, quindi niente da fare.
- [codice] ★ **CSS critico inline** per la prima schermata: attenzione alla CSP (serve un hash o un nonce).
- [codice] ★ **Service worker per i file statici** (`appunti-sw.js` c'è già per l'upload): cache-first per JS/CSS/icone, il sito si apre anche a rete lenta.
- [codice] ★ **Meno `fetch` all'avvio** e `Promise.all` per quelli che restano.
- [codice] ★ **Evitare reflow**: leggere e scrivere il DOM a blocchi, `DocumentFragment` nelle liste.

## 7. Immagini, PDF, media

- [codice] ★★ **Immagini in WebP/AVIF** (copertine, anteprime Open Graph, miniature) con `loading="lazy"` e `width/height` fissi (niente salti di layout).
- [codice] ★★ **Ridimensionare all'upload** (foto di appunti dal telefono sono 4–12 MB): versione piccola per l'anteprima, originale per il download.
- [codice] ★ **Miniature di copertina** a due misure (`srcset`).
- [codice] ★ **PDF**: già `Range`; evitare di rigenerare copertine a ogni apertura (fatto con cache immutabile).
- [codice] ★ **Audio/video**: trascrizione una volta sola e cache del testo (già così per Whisper/Gemini).
- [codice] ★ **SVG ottimizzati** (svgo) per icone e loghi.
- [ok?] ★ **`doom1.wad` e asset pesanti** con `Cache-Control: immutable` e gzip/brotli.

## 8. Node (pannello di controllo)

- [fatto] Il Node fa solo il pannello; 83 MB di RAM, riavvii solo per i deploy.
- [codice] ★ **`--max-old-space-size`** adeguato e `compression` solo se non già fatta da nginx (di solito no).
- [codice] ★ **Una sola connessione SSE per client** e pulizia alla chiusura; `Cache-Control: no-store`.
- [codice] ★ **`node --check` e `npm ci --omit=dev`** nel deploy: meno pacchetti, avvio più rapido.
- [ok?] ★ **Bun al posto di Node**: avvio e RAM un po' migliori, ma non cambia nulla di misurabile per un pannello con pochi utenti [no, per ora].
- [ok?] ★ **PM2 `max_memory_restart`** come rete di sicurezza.

## 9. Gemini e pipeline appunti

- [fatto] Trascrizione una sola volta, nessun retry automatico (solo "Genera ora").
- [codice] ★★★ **Dividere il materiale per giorno e argomento** e far lavorare l'AI a pezzi (già nel piano, volutamente non iniziato): meno token per chiamata, errori che non buttano via tutto, riuso dei risultati.
- [codice] ★★ **Cache dei risultati per hash del contenuto**: se i file non sono cambiati, nessuna nuova chiamata.
- [codice] ★★ **Modello leggero per classificare, modello migliore solo per la sintesi**; scegliere il modello in base alla quota rimasta (RPM/RPD) e non a ogni tentativo.
- [codice] ★★ **Lotti** (batch) per più piccole richieste dello stesso tipo e rispetto dei limiti di velocità con una coda unica.
- [codice] ★ **Comprimere il testo inviato** (togliere spazi, ripetizioni, intestazioni inutili) e riassumere i testi OCR lunghi prima.
- [codice] ★ **Whisper**: modello `small`/`medium` secondo il carico, un lavoro alla volta, `nice`/`ionice` perché non rallenti il sito.
- [ok?] ★ **Orari**: lavori pesanti di notte (`systemd timer` con `Nice=` e `IOSchedulingClass=idle`).

## 10. Sistema operativo e hardware

- [ok?] ★★★ **NVMe**: pulire i contatti o sostituirlo (in `DA-FARE.md`): la stabilità del disco conta più di qualsiasi cache.
- [ok?] ★★ **Swap e `vm.swappiness=10`**: 76 MB di swap con RAM libera indicano valore alto; `zram` come alternativa leggera.
- [ok?] ★ **`journald`: `SystemMaxUse=200M`**, `logrotate` per i log del sito, limite dimensione di `system_errors.log`.
- [ok?] ★ **`fstrim.timer`** attivo per l'SSD; `noatime` sul filesystem.
- [ok?] ★ **`sysctl`**: `net.core.somaxconn=1024`, `net.ipv4.tcp_fastopen=3`, `fs.file-max` e `nofile` per nginx/PHP/Node alti.
- [ok?] ★ **Governor CPU**: `schedutil` o `ondemand`; temperatura 62–65 °C è nella norma, controllare la polvere.
- [ok?] ★★ **Collegamento di riserva Wi-Fi** (in `DA-FARE.md`): affidabilità, non velocità.
- [ok?] ★ **UPS o almeno spegnimento pulito** se manca la corrente: SQLite in WAL regge, ma il filesystem no sempre.
- [ok?] ★ **`unattended-upgrades` solo per sicurezza** e riavvio programmato.

## 11. Rete e DNS

- [ok?] ★★ **Cloudflare davanti al sito** (nuovo dominio): cache dei file statici sulla loro rete (la banda di casa non si consuma), protezione da bot e DDoS, HTTP/3, compressione Brotli, nasconde l'IP di casa. Il piano gratuito basta.
- [ok?] ★ **TTL DNS** più alto per i record che non cambiano; DNSSEC con il nuovo registrar.
- [ok?] ★ **Pi-hole**: lasciare lì la cache DNS locale; `dnsmasq` con `cache-size` adeguato.
- [ok?] ★ **IP del server prenotato sul router** (porte, WireGuard, Pi-hole puntano lì).
- [misura] ★ **Banda in uscita**: se l'upload di casa è sotto i 20 Mbit, la cache di Cloudflare conta più di ogni ottimizzazione PHP.

## 12. Sicurezza che fa anche risparmiare risorse

- [fatto] Scraper noti respinti con 403, scanner con 429, sonde con 444, contatori e statistiche per i bot.
- [ok?] ★★ **fail2ban** con filtro su 444/404/429 ripetuti: blocca l'IP a livello firewall (zero costo per PHP).
- [codice] ★★ **Limiti più stretti sul login e sulla registrazione** (già a livello di codice; aggiungere nginx).
- [codice] ★ **Honeypot**: un indirizzo vietato in `robots.txt` (`/trappola/`) che, se richiesto, mette l'IP in lista nera per un giorno.
- [codice] ★ **Challenge leggera** (campo nascosto, tempo minimo di compilazione) nei moduli pubblici contro lo spam.
- [ok?] ★ **`Crawl-delay`** non è letto da Google; la limitazione vera si fa con `limit_req`.
- [ok?] ★★ **CSP e header di sicurezza** già attivi; controllare il rapporto costo/beneficio degli header su asset statici.

## 13. Osservabilità: misurare prima di ottimizzare

- [ok?] ★★★ **Log con `$request_time`** (fatto) e uno script che ogni notte riassume: richieste, 5xx, top URL, p50/p95, bot (il server Claude può farlo).
- [codice] ★★ **Pagina statistiche con tempi di risposta** (media/p95 per pagina) dal log di nginx: serve leggere il log (permessi per `www-data` o un job che scrive un riassunto in `data/`).
- [ok?] ★★ **PHP-FPM `status` e nginx `stub_status`** su localhost: worker occupati, connessioni, richieste.
- [codice] ★ **Server-Timing header** (tempo DB, tempo totale) visibile nelle DevTools del browser, solo per admin.
- [codice] ★ **`EXPLAIN QUERY PLAN` automatico in un test** per le query più usate: un indice mancante fa fallire il test.
- [codice] ★ **Test di carico** (k6, `wrk`, `ab`) su una COPIA del sito (mai sulla produzione) per trovare il punto di rottura vero.
- [ok?] ★ **Avvisi ntfy** quando: disco >80%, 5xx in aumento, worker FPM al limite, backup mancato.
- [misura] ★★ **RUM**: misurare i tempi reali dei telefoni (Navigation Timing con un beacon `/api/visit.php`) per capire se il problema è la rete e non il server.

## 14. Deploy e build

- [codice] ★★ **`updatesite.sh`**: minificare, precomprimere (`.gz`/`.br`), fare `php-fpm reload` per l'OPcache, `nginx -t` prima del reload.
- [codice] ★ **Deploy atomico** (cartella nuova + symlink) per non servire file a metà durante `git reset --hard`; con i tuoi pochi utenti il rischio è piccolo.
- [codice] ★ **Verifica dopo il deploy** (smoke test: `/`, `/api/status.php`, una pagina): se fallisce, ripristina la versione precedente.
- [codice] ★ **`composer`/`npm` solo dove servono** e senza dipendenze di sviluppo in produzione.
- [codice] ★ **Test veloci**: oggi 277 test in ~75 s; parallelizzare i file di test se salgono.

## 15. Linguaggi e strumenti diversi (cosa non conviene)

- [no] **Riscrivere l'API in Rust**: mesi di lavoro per un guadagno che oggi non si vede (risposte già 3–10 ms) e rischio di nuovi bug di sicurezza.
- [no] **Sostituire PHP con Node/Bun** per le API: stesso discorso; Node va bene per gli SSE e il pannello.
- [ok?] **Go** solo per un servizio singolo (es. chat in tempo reale con migliaia di connessioni) *se* si dovesse arrivare a quel traffico.
- [no] **Redis/Memcached**: APCu e SQLite bastano; un altro servizio da tenere in piedi non ripaga.
- [no] **Docker/Kubernetes**: complessità senza vantaggio su un solo server di casa.
- [ok?] **Varnish**: nginx con `fastcgi_cache` fa lo stesso con un componente in meno.

---

## Ordine consigliato (più resa, meno rischio)

1. Cache lunga di `/js` e `/css` (nginx) e `gzip_static`/minificazione nel deploy.
2. Nextcloud: spegnere o rimettere in rete (toglie il 79% delle richieste inutili).
3. Chat: sleep adattivo o SSE su Node; poker più lento a scheda nascosta.
4. OPcache con `validate_timestamps=0` + `reload` nel deploy; slowlog attivo.
5. Cloudflare davanti al sito con il nuovo dominio (banda di casa, bot, HTTP/3).
6. Indice delle notifiche, `SELECT` più stretti, testo grande fuori dalle liste.
7. Riassunto notturno dei log (tempi, 5xx, bot) e avvisi su ntfy.
8. Il resto solo dopo aver misurato.
