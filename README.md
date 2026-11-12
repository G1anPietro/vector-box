# vector-box

Cyberpunk desktop-style personal site: windows, a terminal and a taskbar in the browser, with a chat (rooms and private
messages), a private book reader, party games for phones (Who's the spy?, Lupus, Never have I ever…) and solo games
(Solitaire, Node Breach, ARG Vault). PHP + SQLite, with an optional Node.js hub that delivers the chat in real time.

**Full documentation (Italian): [`docs/DOCUMENTAZIONE.md`](docs/DOCUMENTAZIONE.md)** — architecture, database, API,
security rules, configuration, deploy.

## Quick start

```bash
cp .env.example .env          # fill it in: Node refuses to start without SESSION_SECRET, ADMIN_PASSWORD, GUEST_PASSWORD
npm install
php -S 127.0.0.1:8080 -t public
npm start                     # optional: the chat hub
npm test                      # automated tests
```

- Serve **only** `public/`; `data/` (SQLite, sessions, books, logs) lives outside it and is created automatically.
- Behind a reverse proxy set `TRUSTED_PROXIES` (PHP) and `TRUST_PROXY` (Node).
- Schema changes: a new `migrateVN()` in `public/api/database.php` plus `DB_SCHEMA_VERSION` (tracked with
  `PRAGMA user_version`).

## Chat delivery

PHP always stores the messages. With `CHAT_HUB_SECRET` and `CHAT_STREAM_URL` set, PHP pushes new and deleted messages to
the Node hub (`/internal/chat/publish`, loopback + secret only) and each browser keeps one SSE connection to
`/api/chat/stream`, authenticated with a signed token valid for **60 seconds and one connection**. On failure the browser
retries after 1, 2, 4 and 8 seconds, then falls back to `api/uplink_stream.php` and tries the hub again every minute.
Both streams resume from the last event id. Proxy only `/api/chat/stream` to Node, never `/internal/`.

## Rooms

- `is_private = 1`: only admins can post (announcements)
- `is_hidden = 1`: only admins can read
