# vector-box — documentazione

> Aggiornata al 2026-11-12 (schema del database **v14**, 162 test). Codice: <https://github.com/G1anPietro/vector-box>

vector-box è un sito personale in stile desktop cyberpunk: finestre, terminale e barra delle applicazioni nel browser.
Dentro ci sono una chat con stanze e messaggi privati, un lettore di libri privato, giochi da festa per telefono e giochi
da soli, e gli **Appunti di classe** (appunti condivisi per classe, riassunti e dispense scritti da un'AI, calendario
delle verifiche con promemoria). Gira su un piccolo server di casa (Ubuntu, nginx, PHP-FPM, Node.js).

![Il desktop di vector-box](img/desktop.png)

**Indice:** [Guida per chi usa il sito](#parte-1--guida-per-chi-usa-il-sito) · [Appunti di classe](#appunti-di-classe) ·
[Comandi del terminale](#comandi-del-terminale) ·
[Documentazione tecnica](#parte-2--documentazione-tecnica) · [API](#5-api) · [Sicurezza](#6-sicurezza) ·
[Configurazione](#7-configurazione-env) · [Sviluppo](#8-sviluppo-in-locale) · [Pubblicazione](#9-pubblicazione-sul-server)

---

# Parte 1 — Guida per chi usa il sito

## Il desktop

La home è un desktop: ogni funzione è una **finestra** che si apre dalla barra in basso, si trascina, si riduce, si
ingrandisce e si chiude. Il **MENU** in alto a destra porta alle altre pagine (Giochi, Supporta, accesso, impostazioni
dell'account) e ai temi grafici.

| Finestra | A cosa serve |
|---|---|
| **TERMINAL** | Riga di comando: `help` mostra tutti i comandi (elenco più sotto). |
| **CHAT_FEED** | La chat pubblica, divisa in stanze (le schede in alto). |
| **UPLINK** | Lascia un messaggio privato a chi gestisce il sito: arriva come notifica sul suo telefono. |
| **POKER** | Texas Hold'em con fiches finte, contro altri giocatori e bot (serve un account). |
| **TOOLS** | Strumenti: banner ASCII, ROT13/ROT47, cifrario di Cesare, Morse, binario. |
| **VAULT** | Il caveau dell'ARG: inserisci le chiavi trovate in giro per il sito. |
| **STATUS** | Stato del server: da quanto è acceso, carico, memoria, servizi. |
| **WALL** | Il muro dei graffiti: lascia una frase visibile a tutti. |
| **DM** | Messaggi privati con gli altri utenti registrati. |
| **READER** | La biblioteca (solo per gli account autorizzati). |

**Sul telefono** si vede un'app alla volta, e si cambia con la barra di schede in basso (scorre di lato). Mentre la tastiera
è aperta la barra si nasconde, poi torna.

<img src="img/desktop-telefono.png" alt="Il desktop sul telefono" width="300">

## Account

- **Senza account** puoi leggere la chat, scrivere come ospite (`guest_` più 8 caratteri), usare il terminale e giocare
  ai giochi da festa.
- **Con un account** (MENU → LOGIN / REGISTER; password di almeno 8 caratteri) hai il tuo nome in chat, i messaggi
  privati, il poker con la classifica e il tema grafico che resta.
- La **biblioteca** e il **curriculum** si vedono solo se l'admin ti dà il permesso (`/grantbook`, `/grantcv`).

## Chat e messaggi privati

- Scegli la stanza dalle schede in alto. Alcune stanze sono solo per gli annunci (scrive solo l'admin).
- Scrivi `@nome` per menzionare qualcuno: il messaggio si evidenzia e, se ha la scheda in background, riceve una notifica.
- Quando il collegamento in tempo reale è attivo, sotto la chat vedi chi è online e chi sta scrivendo.
- **Messaggi privati (DM):** cerca un utente per nome e scrivigli. Puoi **bloccare** qualcuno: nessuno dei due potrà più
  scrivere all'altro. Scorrendo verso l'alto i messaggi più vecchi si caricano da soli. L'admin non ha un modo per leggerli.

## Biblioteca

Per chi ha il permesso: libri **EPUB** e **PDF** con copertina, scaffale "Continua a leggere", avanzamento salvato,
segnalibri, quattro colori di pagina e filtro luce blu. Nel lettore: barra in alto (indietro, segnalibro, elenco segnalibri,
**Aa**) e in basso (pagina precedente/successiva, cursore della posizione, numero di pagina). Nel pannello **Aa**: dimensione
del testo per gli EPUB (70–200%) e zoom per i PDF (50–300%, 100% = pagina intera sullo schermo, "Adatta" per tornarci),
**una pagina alla volta** o due affiancate (solo su schermi larghi), colori, filtro luce blu, scarica. Si gira pagina con le
frecce, con i bordi della pagina, con lo scorrimento del dito o con i tasti ← → (+ e − per lo zoom). Un tocco al centro
della pagina mostra o nasconde la **barra in basso**, che di base è nascosta mentre leggi ("Quando serve": compare sopra
il testo e si nasconde da sola dopo 6 secondi; in fondo resta una linea sottile con la posizione); in **Aa** si può scegliere
"Sempre". **Schermo intero** (in **Aa**) nasconde anche la barra in alto; si esce con il pulsante **✕ Esci** in alto a
destra (chiaro per qualche secondo, poi semitrasparente), un tocco al centro, il **tasto indietro** del telefono o Esc.
Il tasto indietro, nel lettore, esce prima dallo schermo intero e poi chiude il libro, senza lasciare la biblioteca.
In **Aa → Come si usa** ci sono tutti i gesti. I menu si chiudono toccando in un punto qualsiasi fuori. In biblioteca la ricerca parte mentre scrivi e
"+ Carica libri" carica appena scegli i file. Chi può caricare sceglie più file insieme o li trascina sul riquadro.

## Giochi

Tutti i giochi sono nella pagina **Giochi** (MENU → GIOCHI), in italiano e inglese.

![La pagina dei giochi](img/giochi.png)

- **Chi è la spia?** (3–20 giocatori): tutti conoscono il luogo segreto tranne le spie. Si fanno domande a turno, poi si
  vota; la spia può provare a indovinare il luogo. Si gioca con un telefono a testa (stanza con un codice di 4 lettere) o
  con un solo telefono da passare. Nelle impostazioni della stanza: numero di spie, categorie di luoghi, modalità famiglia.
- **Lupus** (4–20 giocatori): di notte gli assassini scelgono una vittima, di giorno il villaggio vota chi giustiziare.
  Ruoli della casa (puttana, joker, pescatore, giudice) e ruoli facoltativi (veggente, guardia, strega, cacciatore…).
- **Non ho mai…** (2 o più): un telefono in mezzo al tavolo, una frase alla volta; chi l'ha fatto perde una vita.
- **Cucù** (2–20, un telefono a testa): una carta a testa dal mazzo italiano. Il nuovo mazziere dice a voce le vite di
  tutti (se ne sbaglia una perde una vita e passa il mazzo); le carte si guardano dopo che il mazziere **bussa due volte**;
  a turno si tiene o si cambia col vicino, il **Re blocca** lo scambio («Cucù!»), il mazziere per ultimo può cambiare col
  mazzo; la carta più bassa perde una vita (pari merito: si ripesca). **Le vite non si vedono**, si ricordano a memoria;
  ogni vita persa o guadagnata compare su tutti i telefoni. Chi crea la stanza è il **capotavola**: conferma chi perde,
  segnala chi parla con i morti (il vivo perde una vita, il morto ne guadagna una; il mazziere può parlarci). Poteri
  facoltativi nelle impostazioni (Cavallo che salta, Re pescato dal mazzo) e un "potere dell'admin" dichiarato a tutti.
- **Solitario**: Klondike. Si gioca toccando o trascinando le carte; doppio clic per mandarle sulle pile dei semi (doppio
  clic su una pila raccoglie tutto quello che può salire). Suggerimento, annulla/ripeti, punteggio, quattro tavoli
  (Classico, Neon, Legno, Notte). Sul computer ha menu e scorciatoie: Ctrl+Z, Ctrl+Y, H (suggerimento), D (distribuisci),
  F2 (nuova partita).
- **Node Breach**: trova la sequenza esadecimale nella griglia in 15 secondi.
- **ARG Vault**: le chiavi sono nascoste in giro per il sito.
- **Poker**: per ora è la finestra POKER del desktop.

<img src="img/spia-telefono.png" alt="Chi è la spia? sul telefono" width="300"> <img src="img/solitario.png" alt="Il solitario" width="480">

## Appunti di classe

Dal **MENU → APPUNTI DI CLASSE** (`/pages/appunti.php`, serve un account). Ogni classe ha i suoi appunti, separati da
quelli delle altre classi e delle altre scuole.

**Entrare in una classe.** Chiedi il **codice d'invito** al responsabile della classe e scrivilo nella pagina. Se la tua
classe non c'è ancora, chiedila (classe, scuola, una nota): la approva l'amministratore, e chi l'ha chiesta ne diventa il
**responsabile**. L'amministratore può chiudere le richieste nuove quando vuole.

**Il responsabile** (scheda *Classe*): vede e rigenera il codice d'invito, toglie i compagni o passa il ruolo a un altro,
sceglie l'ora del riassunto automatico (18:00 se non la cambia) e inserisce l'**orario**:
- con **"Compila da foto o PDF"**: carica lo screenshot dell'orario e, se c'è, la foto degli orari della campanella;
  l'AI riempie la tabella, lui la controlla e preme *Salva l'orario*;
- oppure a mano: per ogni giorno gli orari della campanella (possono cambiare da un giorno all'altro) e la materia di ogni
  ora. "Etichetta" distingue il laboratorio dalla teoria ("Lab TPSIT" e "TPSIT" sono la stessa materia). L'orario ha una
  data d'inizio, così il passaggio dal provvisorio al definitivo non cambia gli appunti vecchi.

**Caricare il materiale** (scheda *Materiale*): appunti, slide o materiale del prof, pagine del libro, domande fatte dal
prof alle interrogazioni, verifiche di preparazione. Foto, PDF, Word, PowerPoint, LibreOffice o testo scritto lì. Il sito
propone da solo la lezione giusta guardando l'ora della foto e l'orario (le ore di fila della stessa materia sono una
lezione sola); si può sempre cambiare. Tutti i compagni vedono tutto il materiale, con il nome di chi l'ha caricato; chi
l'ha caricato e il responsabile possono modificarlo o cancellarlo. Limiti: 40 MB per file e 5 GB per classe (li cambia
l'amministratore).

**Pagina Carica** (`/pages/appunti-carica.php`, *+ Carica* in alto): **l'unico posto** dove si carica (la scheda Materiale e
la scheda Studio hanno solo i pulsanti che ci portano, già impostati sulla lezione o sulla verifica): tutti i modi in un posto solo, cioè
fotocamera del telefono, file scelti o trascinati (con anteprima e barra di avanzamento), testo scritto o incollato (anche da
ChatGPT/Gemini: grassetto, corsivo, elenchi e titoli in Markdown vengono mostrati formattati) e documenti fatti con un'altra
AI; il responsabile trova anche il rimando all'orario da foto.

**Archivio** (`/pages/appunti-archivio.php`): il materiale come cartelle. Dentro ogni materia ci sono le cartelle **per tipo**
(Appunti, Foto, Audio, Domande del prof, Slide e materiale del prof, Libro, Verifiche di prova, Appunti fatti dall'AI,
Schemi, Verifiche con i documenti di studio; solo quelle non vuote) e **per giorno**, poi i file, con l'anteprima accanto: foto con la trascrizione, PDF, testi, documenti dell'AI e quiz. Sul
computer le colonne scorrono ciascuna per conto suo e la pagina resta ferma; sul telefono si apre una cartella alla volta,
con il percorso in alto.

**Calendario:** verifiche scritte, interrogazioni e altre date, con gli argomenti detti dal prof. Le aggiungono tutti.

**Studio** (i documenti scritti dall'AI, Google Gemini):
- ogni giorno all'ora del riassunto, o subito con **"Genera ora"** (una volta l'ora per classe), per ogni **lezione**
  gli appunti di tutti uniti in un documento completo, con le fonti numerate, i punti "⚠️ Da verificare" dove i compagni
  dicono cose diverse e le **possibili domande all'interrogazione**;
- per ogni **verifica o interrogazione** dei prossimi 30 giorni, con tutto il materiale dalla verifica precedente della
  stessa materia: **Completo** (dispensa divisa per argomento, con l'elenco delle lezioni senza appunti), **Riassunto**,
  **Preparazione mirata** (come interroga il prof, domande probabili con le risposte, verifica di prova svolta) e
  **Quiz** a scelta multipla da fare nella pagina;
- **Orario:** nella scheda Classe è una griglia come l'orario stampato (giorni in colonna, ore in riga, orari dentro
  ogni casella); tocca una casella per materia, aula e orari ("stessi orari per tutti i giorni"), "✕" toglie un giorno,
  "+ ora" aggiunge un'ora, "Aggiungi giorno" rimette un giorno tolto. Le modifiche valgono dopo "Salva l'orario".
- **Date:** i campi data aprono un calendario che parte dal **lunedì**; nel calendario "Settimana da" passa a domenica
  (scelta salvata nel browser).
- **Schemi:** per ogni lezione e ogni verifica l'AI fa anche uno schema (mappa concettuale) in JSON di testo, non un'immagine
  (pochi KB, si apre subito): la pagina lo disegna come un albero con rami che si aprono e si chiudono. Si può caricare anche
  uno schema fatto con un'altra AI (l'ultimo PROMPT del file "Per AI").
- **Audio:** si possono caricare registrazioni delle lezioni (mp3, m4a, aac, wav, ogg, opus, flac, webm). Con **Whisper** sul
  server (`WHISPER_CMD`, `bin/appunti-whisper.php` con il suo timer) vengono trascritte lì, di qualsiasi lunghezza e senza
  Gemini; senza Whisper le trascrive Gemini fino a circa 18 MB. La trascrizione entra negli appunti.
- **Domande:** per ogni lezione l'AI scrive anche un documento con le **domande**, separate dagli appunti: prima quelle che
  il prof ha fatto davvero (dalle registrazioni, dalle domande caricate, dagli appunti), con la risposta; quelle probabili solo
  se sono poche. Stanno nella cartella **Domande** dell'Archivio e accanto a ogni lezione in Studio; la risposta si apre con
  un tocco. Il **quiz** di una verifica parte da queste domande (prima quelle del prof) e ne crea di nuove solo se mancano.
- ogni documento si scarica o si stampa in PDF. L'AI può sbagliare: va sempre controllata.

**Notifiche:** la campanella in alto raccoglie i promemoria di ogni verifica e interrogazione (2 giorni prima e il giorno
prima alle 16:00, la sera prima alle 21:00). Con *Attiva le notifiche su questo dispositivo* arrivano anche sul telefono a
sito chiuso; sull'iPhone prima bisogna aggiungere gli Appunti alla schermata Home (Condividi → Aggiungi alla schermata Home).

**Scaricare tutto e usare un'altra AI:** ogni giorno ha i pulsanti *↓ Per AI* (un solo file `.md` con i prompt e tutto il
materiale già come testo, comprese le trascrizioni: lo legge qualsiasi AI) e *↓ .zip*, con il filtro di una materia c'è *Tutta la
materia (.zip)*, e ogni verifica nella scheda Studio ha *Materiale + prompt per un'altra AI*. Lo zip contiene gli originali,
i testi, le trascrizioni, i documenti dell'AI, `INDICE.txt` (chi ha scritto cosa) e `PROMPT.txt` con i prompt pronti per
ChatGPT, Claude o Gemini. La risposta si ricarica dalla pagina *+ Carica → Documento da un'altra AI*: compare
accanto agli altri, con il nome di chi l'ha caricato. Guida completa per tutti, anche per chi non ha l'account:
`/pages/appunti-guida.php` (gli ospiti che aprono gli Appunti arrivano lì).

**Privacy:** il materiale viene letto da Google Gemini (livello gratuito: Google può usarlo per migliorare i suoi
prodotti). Niente dati personali, voti o documenti.

## Comandi del terminale

Si scrivono nella finestra TERMINAL. `help <comando>` spiega un comando.

| Gruppo | Comandi |
|---|---|
| **File (finti, solo nel browser)** | `ls`/`dir`, `cd`, `pwd`, `cat`, `nano`, `mkdir`, `touch`, `echo … > file`, `rm`, `find`, `grep` |
| **Sistema e rete** | `whoami`/`id`, `uptime`, `history`, `ip` (il tuo IP pubblico), `ping`, `traceroute`, `scan`, `nmap`, `status`, `fetch` |
| **Aspetto** | `theme <nome>` (cyberpunk, nord, catppuccin, gruvbox, dracula, synthwave, solarized), `rice`, `matrix <colore>`, `cmatrix`, `glitch`, `nuke`, `clear` |
| **Chat** | `rooms`, `join <stanza>`, `create <id> [nome]`, `whois <utente>` |
| **Finestre e giochi** | `poker …`, `vault`, `tools`, `hack` |
| **Varie** | `fortune`/`quote`, `ascii <testo>`, `decrypt`, `sudo` |
| **Solo admin** | `/ban <utente>`, `/timeout <utente> [minuti]`, `/unban <utente>`, `/grantbook`/`/revokebook <utente>` (biblioteca), `/grantcv`/`/revokecv <utente>` (curriculum), `syslog` (log degli errori) |

---

# Parte 2 — Documentazione tecnica

## 1. Panoramica

| Parte | Cosa fa |
|---|---|
| **Desktop** (`public/index.php`) | Finestre trascinabili; su telefono un'app alla volta (`js/mobile.js`, `css/mobile.css`). |
| **Terminale** | `js/terminal.js`, `js/commands.js`, `js/admin_commands.js`. |
| **Chat** | Stanze pubbliche, private (solo l'admin scrive) e nascoste (solo l'admin legge). |
| **Messaggi privati** | `api/dm.php`, `js/dm.js`. Nessuna via di accesso per l'admin nelle API. |
| **Lettore di libri** | `pages/reader.php`, `js/reader.js` (epub.js e pdf.js da CDN), `api/books.php`. |
| **Giochi** | Pagine statiche (`pages/spia.html`, `lupus.html`, `nonhomai.html`, `solitario.html`) con motori lato server per le stanze (`api/spia_lib.php`, `api/lupus_lib.php`). |
| **Pagine pubbliche** | Giochi, Supporta (`ads.php`), Privacy, Credits. Curriculum (`resume.php`) privato. |
| **Appunti di classe** | `pages/appunti.php`, `js/appunti.js`; API `api/classi.php`, `api/appunti.php`, `api/notifiche.php`; lavoratore AI `bin/appunti-ai.php` (Gemini, promemoria). |
| **Hub Node** (`server.js`) | Facoltativo: chat in tempo reale con una sola connessione SSE per browser. |

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
  stream PHP (`api/uplink_stream.php`). Node contiene anche un vecchio pannello di controllo (Minecraft, Wake-on-LAN) da
  non esporre.
- **Pagine statiche dei giochi**: funzionano anche offline nel browser e parlano con il server solo tramite `api/spia.php`.
- `data/` sta **fuori** dalla cartella pubblicata: database, sessioni PHP, libri, copertine, log, registro visite.
- **Appunti di classe:** le pagine non aspettano mai l'AI (tranne la lettura dell'orario da foto). Un timer systemd
  lancia ogni 5 minuti `bin/appunti-ai.php` come utente di PHP: manda i promemoria delle verifiche (Web Push e campanella),
  trascrive una volta sola le foto e i PDF nuovi (modello veloce), e all'ora di ogni classe scrive i documenti delle
  lezioni e delle verifiche, solo quelli il cui materiale è cambiato (il controllo è un hash del testo inviato all'AI).
  Le richieste a Gemini sono contate per modello e per giorno (`ai_usage`, giorno del Pacifico come Google) e restano al
  90% dei limiti gratuiti; i file Word/PowerPoint/testo sono letti dal sito senza AI. Se Google è sovraccarico
  (503 "high demand") ogni richiesta viene ritentata due volte (`GEMINI_RETRY_WAITS`), poi si passa al modello di
  riserva (`gemini-3.8-flash` → `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite`; il tempo che il browser aspetta è diviso tra
  i modelli, così uno che non risponde non lo consuma tutto);
  se sono occupati tutti, il giro si ferma senza contarlo come guasto e riprende 5 minuti dopo. La lettura dell'orario,
  che il browser aspetta, si ferma entro 140 secondi (nginx ne concede 180) con il messaggio "Gemini è sovraccarico".
- **Registro visite**: `includes/head.php` (pagine PHP) e `api/visit.php` (pagine statiche) chiamano `recordVisit()`;
  una visita è "nuova" dopo 30 minuti di assenza: una riga in `data/visits.log` e una notifica ntfy.

## 3. Struttura delle cartelle

```
public/            radice del sito (l'unica cartella servita da nginx)
  index.php        il desktop
  pages/           pagine: giochi, lettore, curriculum, privacy, supporta, giochi statici
  api/             endpoint JSON e librerie condivise (helpers, database, rate limiter, motori dei giochi, visite)
  includes/        head.php (intestazioni di sicurezza, versione, registro visite), ads.php
  js/ css/ assets/ script, stili, icone, font self-hosted
bin/appunti-ai.php lavoratore degli Appunti (promemoria, trascrizioni, documenti AI), da lanciare ogni 5 minuti
lib/               codice condiviso con i test
server.js          hub Node / pannello
tests/             test automatici (node:test)
tools/backup.sh    backup notturno
updatesite.sh      aggiornamento del sito sul server
data/              (non in git) database, sessioni, libri, copertine, log, appunti/ (file delle classi), vapid.json
```

## 4. Database

SQLite in modalità WAL. Lo schema ha una versione (`PRAGMA user_version`, oggi **14**): le modifiche sono funzioni
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
| V11 | `cucu_games` (stato delle partite di Cucù in JSON) |
| V12 | Appunti di classe: `app_settings`, `school_classes`, `class_members`, `class_subjects`, `class_timetables` (orario a versioni, JSON), `class_items` e `class_item_files` (materiale e trascrizioni), `class_events` (calendario), `class_docs` (documenti dell'AI), `ai_usage` |
| V13 | notifiche: `notifications` (campanella), `push_subscriptions` (Web Push), `class_event_reminders` (promemoria già mandati) |
| V14 | `class_docs.author_id`: documenti fatti con un'altra AI e caricati a mano (NULL = scritti dall'AI del sito) |

**Regole:** mai DDL fuori dalle migrazioni; ogni modifica = nuova `migrateVN()` + `DB_SCHEMA_VERSION` + chiamata in
`runMigrations()` + `EXPECTED_SCHEMA` in `updatesite.sh`. Sul server il database non va aperto con `sqlite3` da un utente
diverso da quello di PHP (in WAL crea file `-shm`/`-wal` che poi PHP non può aprire): usare una copia.

## 5. API

Tutte in `public/api/`, rispondono in JSON (`{"success": true|false, …}`; in caso di errore `"error"` con un messaggio
generico). Le richieste che modificano qualcosa vogliono l'intestazione `X-CSRF-Token`, che `js/csrf.js` aggiunge da solo
a ogni `fetch` verso il sito (il token arriva da `check_session.php`).

**Chi:** *tutti* = anche gli ospiti; *utenti* = sessione (anche ospite con nome `guest_…`); *registrati* = account vero;
*autorizzati* = account con il permesso della biblioteca; *admin* = `is_admin`.

### Sessione e account

| Endpoint | Chi | Richiesta | Risposta |
|---|---|---|---|
| `check_session.php` | tutti | GET | `logged_in`, `username`, `user_id`, `is_admin`, `csrf_token`, `chat_stream` (`url`, `token` monouso da 60 s, `cookie`: se l'hub è sullo stesso sito il token arriva nel cookie `vb_chat_ticket` e qui è `null`) |
| `login.php` | tutti | POST `{username, password}`; registrazione `{action:"register", username, password}` | `username`, `is_admin`, `theme`, `csrf_token`. Limiti: 10 tentativi/5 min per IP, 5 per utente; 5 registrazioni/ora per IP |
| `logout.php` | tutti | GET o POST (rifiutato se parte da un altro sito) | redirect a `pages/login.php`, o JSON con `Accept: application/json` |
| `save_theme.php` | registrati | POST `{theme}` | `theme` |
| `get_user_profile.php` | tutti | GET `?username=` | `username`, `is_admin`, `created_at`, `bio` |
| `get_ip.php` | tutti | GET | `ip` |

### Chat

| Endpoint | Chi | Richiesta | Risposta |
|---|---|---|---|
| `rooms.php` | tutti / admin | GET: elenco (le nascoste solo all'admin). POST (admin) `{id, name, is_private, is_hidden}` | `rooms` / `room` |
| `get_feed.php` | tutti* | GET `?room_id=&limit=&before_id=` | `messages`, `has_more`, `latest_id` |
| `uplink_send.php` | utenti | POST `{room_id, message}` | il messaggio salvato (nelle stanze private scrive solo l'admin) |
| `uplink_stream.php` | tutti* | GET `?last_id=` (SSE) | flusso di messaggi, riprende dall'ultimo id |
| `delete_message.php` | admin | POST `{id}` | `id`, `room_id` |
| `chat_typing.php` | utenti | POST `{room_id}` | segnale "sta scrivendo" (solo via hub, non salvato) |
| `command.php` | tutti (CSRF) | POST `{message}` (max 500 caratteri, 2 ogni 30 s) | invia una notifica ntfy all'admin |

\* le stanze nascoste sono escluse per chi non è admin.

### Messaggi privati — `dm.php` (registrati)

| Richiesta | Risposta |
|---|---|
| GET `?action=conversations` | le mie conversazioni (ultimo messaggio, non letti) |
| GET `?action=thread&with=ID[&before=ID]` | 50 messaggi con un utente in ordine cronologico, `more` se ce ne sono altri; segna come letti |
| GET `?action=since&after=ID` | i miei messaggi più nuovi di ID (polling) |
| GET `?action=users&q=TESTO` | utenti registrati il cui nome inizia con TESTO |
| GET `?action=blocks` | utenti che ho bloccato |
| POST `{action:"send", to, body}` · `{action:"block"|"unblock", user_id}` | esito |

### Biblioteca (autorizzati)

| Endpoint | Richiesta | Risposta |
|---|---|---|
| `books.php` | GET `?q=` (catalogo; ripara al massimo 3 copertine per richiesta) | `books`, `can_read`, `can_upload` |
| `books.php` | GET `?action=stream&id=` / `?action=download&id=` / `?action=cover&id=` | il file (le copertine solo jpg/png/gif/webp) |
| `books.php` | POST `?action=upload`, multipart `book_file` (chi ha `can_upload_books`) | `.epub` o `.pdf` con controllo del contenuto vero; limite 64 MB (nginx) |
| `progress.php` | GET `?book_id=` o `?all=1`; POST `{book_id, cfi_or_page, percentage}` | avanzamento di lettura |
| `bookmarks.php` | GET `?book_id=`; POST `{action:"add", book_id, location, label, percentage}` · `{action:"delete", id}` | segnalibri (max 100 per libro) |
| `moderate_book_access.php` | admin: POST `{action:"grant"|"revoke", username, scope:"books"|"resume"}` | permesso di biblioteca o curriculum |

### Giochi

| Endpoint | Chi | Richiesta |
|---|---|---|
| `spia.php` | tutti (telefono identificato dall'intestazione `X-Spia-Device`) | GET `?action=state` (vista di questo telefono, ogni ~2 s); POST `{action}`: `create`, `join`, `leave`, `kick`, `host`, `take`, `player_add`, `player_remove`, `settings`, `start`, `seen`, `vote_call`, `vote`, `vote_close`, `guess`, `end`, `reset_scores`; le azioni di Lupus per le stanze `game:"lupus"`; per `game:"cucu"`: `recite {ok}`, `knock`, `keep`, `swap`, `deck`, `confirm {player_id}`, `life {player_id, delta}`, `talk {player_id, dead_id}`, `admin_power {player_id}` (motore in `api/cucu_lib.php`) |
| `poker.php` | utenti | GET `?action=state`; POST `?action=` `create_room`, `join`, `leave`, `deal`, `play` |
| `poker_leaderboard.php` | tutti | classifica (`top`, e `me` se hai fatto l'accesso) |
| `guestbook.php` | tutti / admin | GET: ultime frasi; POST `{action:"sign", message}` · admin `{action:"delete", id}` |
| `visit.php` | tutti | GET `?p=/pages/…` → 204 (registro visite delle pagine statiche) |

### Appunti di classe (registrati)

| Endpoint | Chi | Richiesta |
|---|---|---|
| `classi.php` | registrati / responsabile / admin | GET `?action=mine` (le mie classi e richieste), `class&id=` (membri e admin: orario, materie, membri, codice solo al responsabile), `requests` e `all` (admin). POST `{action}`: `request {name, school, note}`, `join {code}`, `leave`; responsabile: `regen_code`, `remove_member`, `set_manager`, `settings {summary_time, timezone}`, `save_timetable {valid_from, periods, slots}`, `read_timetable` (multipart con le foto, risponde con l'orario letto dall'AI senza salvarlo); admin: `decide {approve}`, `set_requests_open {open}`, `set_limits {file_mb, class_mb[, id]}`, `delete_class` |
| `appunti.php` | membri della classe (admin: tutte) | GET `?action=` `tree` (materie → giorni con i conteggi, per l'Archivio), `file_text&id=` (testo estratto o trascritto di un file), `lessons&date=` (lezioni del giorno), `suggest&ts=` (lezione di un momento), `items` (filtri `subject_id`, `kind`, `from`, `to`), `file&id=`, `events`, `usage`, `docs`, `doc&id=`, `zip&scope=day&date=[&subject_id]` / `scope=subject&subject_id` / `scope=event&event_id` (materiale + INDICE.txt + PROMPT.txt, al massimo 300 MB), `ai_pack` con gli stessi parametri (un file Markdown con prompt e tutto il testo). POST `upload_doc {kind, target:"lesson"|"event", subject_id+lesson_date | event_id, title, content o file}` e `delete_doc {id}` (solo documenti caricati a mano, autore o responsabile). POST multipart `upload {class_id, subject_id, kind, lesson_date, period, title, body, files[]}`; JSON `edit_item`, `delete_item` (autore o responsabile), `add_event`, `edit_event`, `delete_event`, `generate` ("Genera ora", una volta l'ora per classe) |
| `notifiche.php` | registrati | GET `?action=list` (ultime 30, non lette, dispositivi), `vapid` (chiave pubblica). POST `read {ids}`, `read_all`, `subscribe {endpoint, keys}`, `unsubscribe {endpoint}`, `test` |

Tipi di materiale (`kind`): `appunti`, `slide`, `libro`, `domande`, `prova`, `altro`. Tipi di data: `verifica`,
`interrogazione`, `altro`. Tipi di documento: `lezione`, `domande` (JSON: `{domande:[{domanda, risposta, origine: prof|ai, fonte}]}`), `completo`,
`riassunto`, `preparazione`, `quiz` (JSON), `schema` (JSON:
`{title, children:[{label, note, children}]}`).

### Amministrazione e stato

| Endpoint | Chi | Cosa fa |
|---|---|---|
| `moderate_user.php` | admin | POST `{action:"ban"|"timeout"|"unban", username, minutes}` |
| `get_log.php` | admin | log degli errori (contiene IP) |
| `status.php` | tutti | uptime, carico, memoria, servizi di `STATUS_CHECKS` (solo i nomi) |
| `telemetry.php` | tutti | percentuali di CPU e RAM |

Le librerie (`helpers.php`, `database.php`, `rate_limiter.php`, `epub_meta.php`, `spia_lib.php`, `lupus_lib.php`,
`visits.php`, `debug_logger.php`, `classi_lib.php`, `classi_ai.php`, `appunti_lib.php`, `appunti_ai.php`, `gemini.php`,
`webpush.php`, `notifiche_lib.php`) non sono endpoint: se richieste direttamente definiscono solo funzioni.

## 6. Sicurezza

- **Sessioni:** cookie `HttpOnly`, `Secure` (in HTTPS), `SameSite=Lax`, modalità strict (ID inventati rifiutati), ID
  rigenerato al login. `initSession()` apre e chiude subito (sola lettura); chi scrive in sessione usa `initSession(true)`
  e `session_write_close()`.
- **CSRF:** ogni endpoint che modifica chiama `requireCsrf()`; quelli admin anche `requireAdmin()`. Il logout (un link)
  rifiuta le richieste che partono da altri siti (`Sec-Fetch-Site`).
- **Errori:** mai il messaggio dell'eccezione al browser: `failInternal()` scrive nel log e risponde in modo generico.
- **IP del client:** solo con `getClientIp()`; `X-Forwarded-For` vale solo dai proxy in `TRUSTED_PROXIES`.
- **XSS:** il testo degli utenti entra con `textContent`, mai `innerHTML` o `onclick` inline.
- **Content-Security-Policy** (`sendPageSecurityHeaders()`): `CSP_ENFORCE=true` per applicarla; le pagine con annunci
  (`VB_ADS_PAGE`) aprono solo i domini di Google necessari, e solo con `ADSENSE_CLIENT` impostato.
- **Limiti di richieste** in SQLite (`checkRateLimit()`): login, registrazione, chat, messaggi privati, guestbook,
  modulo per l'admin, beacon delle visite, stanze dei giochi.
- **Hub della chat:** token firmato (HMAC), valido 60 secondi e per **una sola** connessione. Se l'hub è sullo stesso
  sito (`CHAT_STREAM_URL` è un percorso come `/api/chat/stream`) il token viaggia in un cookie `HttpOnly`,
  `SameSite=Strict`, limitato a quel percorso: non compare negli URL né nei log di nginx.
- **Appunti di classe:** ogni richiesta controlla che l'utente sia nella classe (attiva); i codici d'invito (8 caratteri)
  hanno limiti di tentativi per account e per IP; i file sono controllati per contenuto e salvati in `data/appunti/<id>/`
  con un nome casuale; le immagini sono servite con `Content-Security-Policy: sandbox`. Il testo scritto dall'AI è
  mostrato con un piccolo convertitore Markdown → DOM (`js/appunti-common.js`, condiviso dalle tre pagine) che usa solo
  `textContent`; capisce il Markdown di ChatGPT/Gemini/Claude (grassetto, corsivo, elenchi con righe vuote tra i punti,
  elenchi annidati, tabelle, titoli). Il materiale va all'AI dentro
  `<materiale>…</materiale>` con l'istruzione di non seguire ordini scritti lì dentro.
- **Web Push:** cifratura RFC 8291 e firma VAPID fatte con openssl; chiavi in `data/vapid.json`. Si accettano solo
  endpoint `https` dei servizi push dei browser (Google, Mozilla, Apple, Microsoft): il server non fa richieste ad
  indirizzi scelti dagli utenti.
- **File caricati:** estensione e contenuto vero controllati, nome ripulito, salvati fuori dalla cartella pubblica.
- **Biblioteca e curriculum privati:** solo per gli account con il permesso; `robots.txt` tiene fuori i motori di ricerca.

## 7. Configurazione (`.env`)

Si parte da `.env.example`, che spiega ogni voce.

| Variabile | A cosa serve |
|---|---|
| `SESSION_SECRET`, `ADMIN_PASSWORD`, `GUEST_PASSWORD` | obbligatorie per Node |
| `TRUSTED_PROXIES` (PHP), `TRUST_PROXY` (Node) | proxy fidati per l'IP del client |
| `NTFY_TOPIC_URL` | notifiche del modulo "messaggio all'admin" |
| `CHAT_HUB_SECRET`, `CHAT_STREAM_URL`, `CHAT_HUB_INTERNAL_URL`, `CHAT_STREAM_CORS_ORIGIN`, `PORT`, `BIND_HOST` | hub della chat |
| `CSP_ENFORCE` | applica la Content-Security-Policy |
| `STATUS_CHECKS` | servizi mostrati nella finestra STATUS (max 8) |
| `ADSENSE_CLIENT`, `ADSENSE_SLOT_GAMES`, `ADSENSE_SLOT_SUPPORT` | annunci (spenti se vuoti), vedi `docs/ADSENSE.md` |
| `CONTACT_EMAIL` | contatto nella pagina privacy |
| `VISIT_NTFY_URL`, `VISIT_NOTIFY`, `VISIT_GAP_MIN`, `VISIT_NOTIFY_MAX_PER_HOUR` | registro visite e notifiche |
| `MC_DIR`, `WAKE_SCRIPT` | vecchio pannello Node (Minecraft, Wake-on-LAN) |
| `GEMINI_API_KEY`, `GEMINI_AUTH` | chiave di Google AI Studio per gli Appunti; `bearer` per le chiavi nuove `AQ.` se Google rifiuta l'header |
| `GEMINI_MODEL_FAST`, `GEMINI_FAST_RPM`, `GEMINI_FAST_RPD`, `GEMINI_MODEL_SMART`, `GEMINI_SMART_RPM`, `GEMINI_SMART_RPD` | modelli e limiti gratuiti (al minuto e al giorno); `php bin/appunti-ai.php --models` elenca i modelli della chiave |
| `GEMINI_MODEL_SMART2`, `GEMINI_SMART2_*`, `GEMINI_MODEL_SMART3`, `GEMINI_SMART3_*` | modelli di riserva quando quello principale è sovraccarico (`gemini-3.7-flash`, `gemini-3.6-flash`) |
| `GEMINI_RETRY_WAITS` | secondi di attesa prima di ritentare quando Google è sovraccarico (predefinito `2,5`) |
| `SITE_URL` | indirizzo del sito (anteprime dei link, contatto VAPID delle notifiche push) |
| `WEBPUSH_EXTRA_HOSTS` | solo per i test: servizi push finti ammessi |

## 8. Sviluppo in locale

```bash
cp .env.example .env              # e riempirlo
npm install
php -S 127.0.0.1:8080 -t public   # PHP_CLI_SERVER_WORKERS=4 per provare SSE e concorrenza
npm start                         # hub Node (facoltativo)
npm test                          # 162 test: account, CSRF, stanze, chat, hub, giochi, DM, visite, permessi, appunti…
php bin/appunti-ai.php            # un giro del lavoratore degli Appunti (serve GEMINI_API_KEY per la parte AI)
```

I test degli Appunti usano un **finto Gemini** e un finto servizio push (nessuna richiesta vera; le notifiche vengono
decifrate e la firma VAPID verificata). I test (`tests/*.test.js`) avviano ogni volta una **copia** del sito in una cartella temporanea con un database vuoto
(`tests/helpers.js`: `startSite()`, `Client`, `makeAdmin()`). Prima di ogni commit: `npm test`, `php -l` sui file PHP
toccati e `node --check` sui JS. Mai lavorare sul database vero.

**Requisiti:** PHP 8.x con `pdo_sqlite`, `curl`, `zip` e `xml` (le ultime due per copertine e autori degli EPUB),
`mbstring` consigliata (senza, il sito usa le sue funzioni `textLength()`/`textCut()`); Node.js 22 (usato sul server).

## 9. Pubblicazione sul server

`sudo bash updatesite.sh` sul server: scarica `main`, mette da parte eventuali modifiche locali, aggiorna le dipendenze
Node se cambiate, sistema i permessi di `data/`, esegue le migrazioni come utente di PHP, riavvia l'hub se gira sotto PM2,
scrive la versione (`version.php`, usata per i `?v=` dei file) e controlla che lo schema sia quello atteso. Serve un `.env`
già presente. Per gli Appunti servono anche: il timer systemd `vector-box-appunti-ai.timer` (ogni 5 minuti lancia
`php bin/appunti-ai.php` come `www-data`; log con `journalctl -u vector-box-appunti-ai`; esce con 1 solo per guasti veri
di Gemini, così l'avviso ntfy lo segnala), `client_max_body_size 100M` e `fastcgi_read_timeout` di almeno 120 s in nginx
(caricamenti grandi e lettura dell'orario). Dettagli e configurazione nginx: `docs/DEPLOY.md`; backup: `docs/BACKUP.md`; annunci: `docs/ADSENSE.md`.

## 10. Come si fa…

- **Aggiungere un gioco alla pagina Giochi:** una voce nell'elenco `$GAMES` in cima a `public/pages/giochi.php`
  (gruppo, colori, link, icona, testi IT/EN) e lo stile della "scatola" in `public/css/giochi.css`. Per le pagine statiche
  nuove: `<script src="../js/visit.js?v=1" defer></script>` per il registro visite.
- **Aggiungere una tabella o una colonna:** nuova `migrateVN()` (sezione 4).
- **Aggiungere un endpoint che modifica dati:** `requireCsrf()` (e `requireAdmin()` se serve), `failInternal()` per gli
  errori, `checkRateLimit()` se può essere abusato, e un test in `tests/`.
- **Aggiungere un permesso per account** (come biblioteca e curriculum): colonna in una migrazione, controllo nella pagina,
  uno `scope` in `moderate_book_access.php`, comandi in `js/admin_commands.js` e `js/commands.js`.
- **Aggiungere testi tradotti ai giochi:** chiavi in `public/js/spia/i18n.js` per tutte e 5 le lingue (it, en, es, fr, de).
- **Cambiare cosa scrive l'AI negli Appunti:** i prompt sono costanti in `public/api/appunti_ai.php` (`AI_PROMPT_*`) e
  `public/api/classi_ai.php` (orario); i modelli si cambiano nel `.env`. I test con il finto Gemini riconoscono i prompt da
  alcune parole ("trascrittore", "DISPENSA COMPLETA", "RIASSUNTO", "PREPARAZIONE MIRATA", "quiz", "orario scolastico"):
  se le cambi, aggiorna anche `tests/appunti-ai.test.js`.
- **Cambiare gli orari dei promemoria:** `REMINDER_SLOTS` in `public/api/notifiche_lib.php`.
- **Cambiare un file CSS/JS di una pagina statica:** alzare a mano il suo `?v=` (le pagine PHP lo fanno da sole).

## 11. Limiti noti

- Il pannello Node (Minecraft, Wake-on-LAN) è vecchio e non va esposto.
- La pagina Doom non funziona.
- Il poker è ancora una finestra del desktop: va rifatto come pagina della sezione Giochi.
- Le cancellazioni dei messaggi arrivano in tempo reale solo con l'hub Node attivo.
- Appunti: con il livello gratuito di Gemini le richieste al giorno sono poche (circa 450 veloci e 18 del modello migliore):
  con molte classi i documenti possono arrivare il giorno dopo. Non c'è ancora la copia su Google Drive.
- Le notifiche push su iPhone funzionano solo dall'icona aggiunta alla schermata Home (iOS 16.4 o successivo).
- Avvisi: nelle pagine degli Appunti i messaggi compaiono in un riquadro fisso in basso (visibile anche a pagina scrollata) e il
  pulsante premuto resta bloccato con "…" finché la richiesta non finisce, così un secondo tocco non la manda due volte.
- Biblioteca: le copertine passano da `api/books.php`, che nginx limita; la pagina le carica 3 alla volta e ritenta quelle
  rifiutate.
- Biblioteca: i PDF non hanno una copertina finché qualcuno che può caricare libri non apre la biblioteca: allora il browser
  disegna la prima pagina con pdf.js e la manda al server (`books.php?action=set_cover`, solo PDF senza copertina).
