# vector-box

Cyberpunk desktop-style site: PHP frontend/API (SQLite) + Node.js control panel (Minecraft, Wake-on-LAN, telemetry).

## Setup
1. `cp .env.example .env` and fill in **all** the values (the Node server refuses to start without the secrets).
2. `npm install && npm start`
3. PHP: serve `public/` with nginx/Apache + PHP-FPM. `data/` (SQLite, sessions, books) must live **outside** the web root; it is created automatically with `0750` permissions.
4. Behind a reverse proxy set `TRUSTED_PROXIES` (PHP) and `TRUST_PROXY` (Node), otherwise client IPs are the proxy's.

## Database
Schema changes live in `public/api/database.php` (`migrateVx()` + `DB_SCHEMA_VERSION`). They run once per version, tracked with `PRAGMA user_version`.

## Chat rooms
- `is_private = 1` → only admins can **post** (announcement channel)
- `is_hidden  = 1` → only admins can **read** (e.g. `admin`)

## Live chat delivery
- PHP always stores messages (`api/uplink_send.php`).
- **Chat hub (optional):** with `CHAT_HUB_SECRET` + `CHAT_STREAM_URL` set, PHP pushes each new/deleted
  message to Node (`/internal/chat/publish`, loopback + secret only) and browsers hold one SSE connection to
  Node's `/api/chat/stream` using a 10-minute token from `check_session.php`. Proxy only
  `/api/chat/stream` to Node (see `.env.example`), never `/internal/`.
- **Fallback:** without the hub, or when it fails 3 times in a row, the browser uses `api/uplink_stream.php`
  and retries the hub every 5 minutes. Both streams resume from the last event id, so reconnects don't lose
  messages. Deletions only propagate live through the hub.
