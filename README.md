# vector-box

A cyberpunk desktop in the browser: windows, a terminal and a taskbar. Inside it there are a chat (rooms and private
messages), a private book reader, shared class notes with AI-written study documents, party games for phones and a shelf
of solo games. It is self-hosted on a small home server and built by one student.

PHP + SQLite do the work; a small optional Node.js process delivers the chat in real time.

![vector-box desktop](docs/img/desktop.png)

| Read this | For |
|---|---|
| [`docs/DOCUMENTAZIONE.md`](docs/DOCUMENTAZIONE.md) (Italian) | user guide, terminal commands, database, every API endpoint, security rules, configuration |
| [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md) (Italian) | a map of the code: which file does what |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | server checklist: nginx, timers, workers |
| [`docs/BACKUP.md`](docs/BACKUP.md) | nightly backup and restore |
| [`docs/ADSENSE.md`](docs/ADSENSE.md) | turning the (optional) ads on |

## What's inside

| | |
|---|---|
| **Desktop** | Draggable windows (terminal, chat, poker, tools, vault, status, guestbook wall, private messages, reader); on phones one app at a time with a tab bar. 18 themes saved on the account. |
| **Terminal** | A fake filesystem, network toys, themes, chat commands and admin moderation (`help` lists everything). |
| **Chat** | Rooms (announcement-only and admin-only ones too), @mentions, who's online, "is typing", real-time through the hub. |
| **Private messages** | Between registered users, with blocking; no admin access path in the API. |
| **Library** | EPUB and PDF reader for allowed accounts: covers, reading progress, bookmarks, multi-file upload, an optional "like a book" page turn. |
| **Class notes** | Shared notes per school class: admin-approved classes, invite codes, roles and permissions, a timetable read from a photo, resumable uploads, full-text search, a board, a calendar with tests, homework and oral-exam turns, reminders (in-site and Web Push), temporary share links, and study documents written by Google Gemini (lesson notes, handouts, summaries, quizzes judged by the server, custom quizzes, spaced review, mind maps). The AI is used only for classes declared to be adults-only. An example class is open to everyone, read-only. |
| **Party games** | *Who's the spy?*, *Lupus* (werewolf) and *Cucù* (an Italian card game) with multi-phone rooms, *Never have I ever…*, and Texas Hold'em poker with real hand ranking. Five languages for the party games. |
| **Solo games** | Solitaire (Klondike), Connect Four, Hangman, Simon, Memory, Tic-tac-toe, Snake, 2048, Minesweeper, Tetris, Node Breach, ARG Vault. Static pages, no account needed. Coming soon: a roguelike campaign, *Il Dungeon del Server*. |
| **Accounts and privacy** | Optional confirmed e-mail address with separate consent to news, download of all your data, account deletion, automatic data retention, a cookie banner that loads nothing from Google before consent. Public [privacy](public/pages/privacy.php) and [security](public/pages/sicurezza.php) pages. |
| **Admin** | People panel (search, permissions, ban/timeout, supporter badge), an e-mail box with a queue (off until configured), donors list and a "where the money goes" page, visit and bot statistics. |

<img src="docs/img/giochi.png" alt="Games page" width="640">

## Quick start

Requirements: PHP 8 with `pdo_sqlite`, `curl`, `zip`, `xml`, `fileinfo` (`mbstring` recommended); Node.js 22 or newer.

```bash
cp .env.example .env              # fill it in (every key is explained in the file)
php -S 127.0.0.1:8080 -t public   # the site: open http://127.0.0.1:8080
```

That is enough for the site: the database and the `data/` folder are created at the first request. The first account
is a normal one; an admin is an account with `is_admin = 1` in the `accounts` table.

Optional parts:

```bash
npm install                       # only needed for the Node process
npm start                         # chat hub + old control panel; refuses to start without SESSION_SECRET, ADMIN_PASSWORD, GUEST_PASSWORD
php bin/appunti-ai.php            # one run of the class-notes worker (reminders; the AI part needs GEMINI_API_KEY)
php bin/mail-worker.php           # one run of the e-mail queue (says so and sends nothing while MAIL_DRIVER is empty)
```

When testing the chat stream or anything concurrent, give the PHP server more workers:
`PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8080 -t public`.

## Configuration

Everything is in `.env` (never committed); `.env.example` documents each key. The groups:

- **Node secrets** (`SESSION_SECRET`, `ADMIN_PASSWORD`, `GUEST_PASSWORD`): required only by `server.js`.
- **Proxy** (`TRUSTED_PROXIES` for PHP, `TRUST_PROXY` for Node): who may set `X-Forwarded-For`.
- **Site** (`SITE_URL`, `CONTACT_EMAIL`, `CSP_ENFORCE`, `STATUS_CHECKS`).
- **Chat hub** (`CHAT_HUB_SECRET`, `CHAT_STREAM_URL`, `PORT`, `BIND_HOST`).
- **Notifications** to the owner (`NTFY_TOPIC_URL`, `VISIT_*`).
- **Class-notes AI** (`GEMINI_*`, `WHISPER_*`, `DEMO_CLASS`).
- **E-mail** (`MAIL_*`), **ads and donations** (`ADSENSE_*`, `DONATE_*`), **data retention** (`RETENTION_*_DAYS`).

Serve **only** `public/`. `data/` (SQLite database, sessions, books, class files, logs) lives outside it.

## Tests

```bash
npm test                          # needs only PHP and Node on the PATH, no npm install
node --test tests/chat.test.js    # one file
```

About 340 tests (`node:test`). Each suite starts a throwaway copy of the site on a free port with an empty database, so
the real one is never touched. Before a commit: `npm test`, `php -l` on every PHP file touched and `node --check` on
every JS file touched. Every new endpoint or page gets a test.

## Where things live

```
public/               the web root (the only folder the web server serves)
  index.php           the desktop
  pages/              pages: games, reader, class notes, account, privacy, security, admin panels
  api/                JSON endpoints and shared libraries
    helpers.php         env, client IP, JSON answers, CSRF/login/admin guards, security headers
    database.php        connection, session start, versioned migrations (schema v35)
    rate_limiter.php    SQLite-backed rate limits
  includes/           head.php (headers, version, visit log), ads.php, appunti-top.php
  js/ css/ assets/    scripts, styles, icons, self-hosted fonts
  errors/             static error pages
  .well-known/        security.txt
bin/                  command-line workers (class-notes AI, Whisper, e-mail queue, example class)
lib/                  code shared with the tests and the Node process
server.js             Node: chat hub (SSE) and the old control panel
tests/                automated tests
tools/                backup script, generators (error pages, left-handed CSS), Whisper wrapper
docs/                 documentation
updatesite.sh         deploy script (run on the server)
data/                 (not in git) database, sessions, uploads, logs
```

## Contributing

- Keep changes small and separate; say what a commit does in its message.
- **State-changing endpoint:** call `requireCsrf()` (and `requireAdmin()` for admin ones), report errors with
  `failInternal()` (never the exception text), add `checkRateLimit()` if it can be abused, and write a test.
- **Database change:** a new `migrateVN()` in `public/api/database.php`, bump `DB_SCHEMA_VERSION`, call it from
  `runMigrations()`. No DDL on normal requests.
- **User text** goes into the page with `textContent`, never `innerHTML`.
- **Client IP:** only through `getClientIp()`.
- **New game on the Games page:** one entry in `$GAMES` at the top of `public/pages/giochi.php`.
- After changing `public/css/appunti.css` run `python3 tools/make-lefty-css.py`.
- The repository is public: no secrets, no personal data, never `.env` or `data/`.

More recipes are in section 10 of the documentation.

## Chat delivery

PHP always stores the messages. With `CHAT_HUB_SECRET` and `CHAT_STREAM_URL` set, PHP pushes new and deleted messages to
the Node hub (`/internal/chat/publish`, loopback + secret only) and each browser keeps one SSE connection to
`/api/chat/stream`, authenticated with a signed token valid for **60 seconds and one connection**. On failure the browser
falls back to `api/uplink_stream.php` and tries the hub again later. Both streams resume from the last event id. Proxy
only `/api/chat/stream` to Node, never `/internal/`.

## Security in short

Passwords stored only as hashes, login limits per address and per account, sessions re-checked against the database on
every action that needs a login, CSRF tokens on state-changing requests, a Content-Security-Policy (report-only until `CSP_ENFORCE=true`),
SQLite-backed rate limits, user text rendered with `textContent` (AI-written Markdown too), uploads checked by content and
stored outside the web root, one-use chat stream tokens, Web Push only to the browsers' push services.

The plain-language version, with the honest limits, is the site's security page (`public/pages/sicurezza.php`);
the technical one is section 6 of the documentation. **Found a vulnerability?** See
[`public/.well-known/security.txt`](public/.well-known/security.txt): please report it privately first.

## Deploy

On the server: `sudo bash updatesite.sh` (pulls `main`, keeps local edits in a stash, updates dependencies, fixes the
permissions of `data/`, runs the migrations as the PHP user, bumps the version used for cache-busting). `.env` must
already exist there. The full checklist is [`docs/DEPLOY.md`](docs/DEPLOY.md).
