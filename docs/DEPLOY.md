# Deploying vector-box (server checklist)

Written from the `tools/server-report.sh` output of 2026-11-10 (Ubuntu 26.04, nginx 1.28,
PHP-FPM 8.5, Node 22). Steps are in order; each says what it fixes. Nothing here is run
automatically. `updatesite.sh` still only pulls `main`.

## 0. Before pulling: the server has 3 uncommitted files

`updatesite.sh` runs `git reset --hard`, which will discard them. Check what they are first:

```bash
cd /var/www/vector-box && git status --short && git diff --stat
```

Copy anything you need somewhere outside the repo before the next deploy.

## 1. `.env` (on the server, never committed)

The server `.env` only has the three Node secrets. Add:

```ini
# 17 chars is short for a session secret: regenerate (logs Node users out once)
SESSION_SECRET=<output of: openssl rand -hex 32>
NTFY_TOPIC_URL=https://ntfy.sh/<new-unguessable-topic>

# PHP talks to php-fpm over a unix socket, so REMOTE_ADDR is already the client.
TRUSTED_PROXIES=127.0.0.1,::1
TRUST_PROXY=loopback

# Public STATUS window (names shown, hosts never published)
STATUS_CHECKS=Minecraft=192.168.1.200:25565,Cloud=192.168.1.201:80

# Content-Security-Policy: leave false until the browser console shows no CSP reports
CSP_ENFORCE=false
```

Chat hub settings are in step 4: only add them once Node from this repo is running.

## 2. Permissions on `data/`

The DB file is `-rwxrwxr-x` (world-readable, executable). Password hashes and sessions live there.

```bash
sudo chown -R www-data:www-data /var/www/vector-box/data
sudo find /var/www/vector-box/data -type d -exec chmod 750 {} +
sudo find /var/www/vector-box/data -type f -exec chmod 640 {} +
sudo chmod 640 /var/www/vector-box/.env
```

If Node (this repo's `server.js`) runs as another user, add that user to the `www-data`
group so it can read `.env` and write `data/node_sessions.sqlite`.

## 3. nginx (`server_name vector-box.duckdns.org`, the 443 block)

```nginx
# HTTP/2: each open chat tab holds one SSE connection; over HTTP/1.1 browsers allow only
# 6 connections per site, so a few open tabs would stall every other request.
http2 on;

# Dotfiles in public/ (.user.ini) are currently downloadable
location ~ /\. { deny all; return 404; }

# Static files (doom.html, spia.html, css, js) don't go through PHP, so they need
# the headers from nginx (PHP pages already send their own)
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

Also delete `public/tree.txt` on the server if it exists (it lists the site's files; it is
gitignored, so it was copied by hand).

HSTS (`Strict-Transport-Security`) is intentionally NOT suggested yet: if anything is reached
as `http://vector-box.duckdns.org:<port>` (e.g. the Node panel on :3000), HSTS would break it.

Then: `sudo nginx -t && sudo systemctl reload nginx`.

## 4. Chat hub (Node from this repo)

Right now port 3000 is a different app (`/home/user/vector-dash/server.js`), listening on
all interfaces. Pick one:

- **A. Replace vector-dash with this repo's `server.js`** (if it is an older copy of it).
- **B. Run this repo's `server.js` as a second Node process** on another port (e.g. 3001),
  only for the chat hub.

Either way:

```bash
cd /var/www/vector-box
npm ci --omit=dev
# A: PORT=3000 (stop vector-dash first)   B: PORT=3001
pm2 start server.js --name vector-box-hub --cwd /var/www/vector-box
pm2 save
```

`.env` additions:

```ini
PORT=3001                       # or 3000 for option A
BIND_HOST=127.0.0.1             # loopback only, nginx in front
CHAT_HUB_SECRET=<openssl rand -hex 32>
CHAT_STREAM_URL=/api/chat/stream
```

nginx, inside the same 443 server block, BEFORE `location ~ \.php$`:

```nginx
location = /api/chat/stream {
    proxy_pass http://127.0.0.1:3001;      # 3000 for option A
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
# Never proxy /internal/ : PHP reaches it directly on 127.0.0.1
```

Check: `curl -s -o /dev/null -w '%{http_code}\n' https://vector-box.duckdns.org/api/chat/stream`
must print `401` (no token), not `200`/`404`. Then open the chat: the status line under the
log should show "● N online".

Why it matters here: `pm.max_children = 20`, and every open chat tab on the PHP stream holds
one PHP-FPM worker. Around 20 open tabs would make the whole site stop answering. The hub
holds connections in one Node process instead.

## 5. After deploying

```bash
cd /var/www/vector-box
# Run AS www-data: running as root could leave root-owned -wal/-shm files PHP-FPM can't write
sudo -u www-data php -r 'require "public/api/database.php"; echo getDbConnection()->query("PRAGMA user_version")->fetchColumn(), PHP_EOL;'
```

The first web request also runs the migrations; doing it by hand just shows errors right away.
Expected schema version: 6.

Open each page with the browser console open and look for `Content-Security-Policy` report
messages. When there are none, set `CSP_ENFORCE=true`.
