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
