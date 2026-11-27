# Deploying vector-box (server checklist)

Written from a report of the server of 2026-11-10 (Ubuntu 26.04, nginx 1.28,
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
STATUS_CHECKS=Minecraft=192.168.0.20:25565,Cloud=192.168.0.21:80

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

# /.well-known/security.txt (RFC 9116: how to report a vulnerability) must stay reachable.
# `^~` stops nginx from trying the regex below, which would otherwise hide it.
location ^~ /.well-known/ { default_type text/plain; try_files $uri =404; }

# Dotfiles in public/ (.user.ini) are currently downloadable
location ~ /\. { deny all; return 404; }

# Static files (doom.html, spia.html, css, js) don't go through PHP, so they need
# the headers from nginx (PHP pages already send their own)
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

Also delete `public/tree.txt` on the server if it exists (it lists the site's files; it is
gitignored, so it was copied by hand).

Check: `curl -i https://SITE/.well-known/security.txt` must answer 200 with the `Contact:` line, and
`curl -i https://SITE/.user.ini` 404. The file is static: its domain must match `SITE_URL`, and its `Expires:` date
(less than a year ahead) has to be renewed by hand before it passes; `tests/sicurezza-pagina.test.js` fails when it is
in the past. If certbot uses the webroot method, its own `/.well-known/acme-challenge/` location keeps working (a longer
prefix wins).

HSTS: the PHP pages already send `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` when the request is HTTPS
(`sendBaseSecurityHeaders()` in `public/api/helpers.php`), so a browser that has seen the site will not open
`http://<the same host>:<port>` any more. Nothing on that host should be reached over plain HTTP (the Node panel
listens on loopback behind nginx). Adding the header in nginx too would only extend it to the static pages.

Class notes (`pages/appunti.php`): uploads up to 40 MB (raised by the admin up to 95) and the
timetable read from a photo, which waits for Gemini up to a minute:

```nginx
client_max_body_size 100M;
fastcgi_read_timeout 120s;   # in the PHP location
```

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

## 4b. Class notes worker (every 5 minutes)

`bin/appunti-ai.php` sends the test reminders (push + bell), transcribes photos/PDFs and writes the AI
study documents. Run it as the PHP user with a systemd timer:

```ini
# /etc/systemd/system/vector-box-appunti-ai.service
[Service]
Type=oneshot
User=www-data
Group=www-data
ExecStart=/usr/bin/php /var/www/vector-box/bin/appunti-ai.php
Nice=10
TimeoutStartSec=50min

# /etc/systemd/system/vector-box-appunti-ai.timer
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
```

`sudo systemctl daemon-reload && sudo systemctl enable --now vector-box-appunti-ai.timer`; log:
`journalctl -u vector-box-appunti-ai -n 50`. Exit code 1 only for real Gemini faults (key refused,
model name unknown, Google down); 0 for "nothing to do" and "daily quota reached".
`.env`: `GEMINI_API_KEY`, `GEMINI_AUTH`, optionally `GEMINI_MODEL_FAST` / `GEMINI_MODEL_SMART`
(`sudo -u www-data php bin/appunti-ai.php --models` lists what the key can use).

## 4c. Whisper for audio recordings (optional)

Transcribes lesson recordings on the server, any length, without Gemini:

Whisper gets its own environment in `/opt/vector-box-whisper`, separate from the system Python and from the site,
with its own Python version: faster-whisper (ctranslate2) may not have wheels for a very new system Python (3.14),
so the venv uses Python 3.12 through `uv`:

```bash
sudo apt install ffmpeg                       # if missing
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh   # or: pipx install uv
sudo UV_PYTHON_INSTALL_DIR=/opt/vector-box-whisper/python uv venv --python 3.12 /opt/vector-box-whisper/venv
sudo uv pip install --python /opt/vector-box-whisper/venv/bin/python faster-whisper
sudo mkdir -p /opt/vector-box-whisper/models && sudo chown www-data: /opt/vector-box-whisper/models
```

`.env`: `WHISPER_CMD=/opt/vector-box-whisper/venv/bin/python /var/www/vector-box/tools/whisper-transcribe.py`,
`WHISPER_MODELS_DIR=/opt/vector-box-whisper/models` (the model is downloaded there at the first run).

`WHISPER_MODEL=small`. A separate timer (one file per run, its own lock):
`vector-box-appunti-whisper.service` (`User=www-data`, `ExecStart=/usr/bin/php /var/www/vector-box/bin/appunti-whisper.php`,
`TimeoutStartSec=4h`, `Nice=15`) and `.timer` (`OnUnitActiveSec=5min`). Exit code 1 when a transcription fails.

## 4d. Next-lesson pushes on time (optional)

`bin/appunti-ai.php` sends the "next lesson" pushes (5 minutes before the end of each hour, for members who turn them
on) at the start of every run, before the AI lock. With the 5-minute timer they can arrive up to 5 minutes late, and
not at all while a long AI run keeps the service busy. For punctual ones add a second timer every minute:
`vector-box-appunti-bells.service` (`User=www-data`, `ExecStart=/usr/bin/php /var/www/vector-box/bin/appunti-ai.php --bells-only`)
and `.timer` (`OnCalendar=*-*-* *:*:30`, `AccuracySec=5s`). Each push is sent once per lesson (table `class_bell_sent`).

## 4e. E-mail box (optional, off by default)

Nothing is sent while `MAIL_DRIVER` is empty: the admin box (`pages/mail.php`) still works and messages wait in the
queue. To try it without a provider set `MAIL_DRIVER=log` (messages are written to `data/mail.log`). To really send:
`MAIL_DRIVER=http`, `MAIL_HTTP_URL` (an https address; the body is Resend's JSON shape), `MAIL_API_KEY`, `MAIL_FROM`
and `MAIL_DAILY_LIMIT` in the server's `.env` (the key goes only there). Then the worker, every minute, as the PHP user:

```bash
echo '* * * * * www-data php /var/www/vector-box/bin/mail-worker.php >/dev/null 2>&1' | sudo tee /etc/cron.d/vector-box-mail
```

"Send now" in the box does the same by hand. The links inside the messages (`api/mail_link.php`) are built from
`SITE_URL`, so it must be the public address.

## 4f. Data retention (nothing to install)

`public/api/retention.php` deletes old personal data once a day, started by the first page request of the day (a stamp
file in `data/`). Periods: `RETENTION_*_DAYS` in `.env` (defaults in `.env.example`; the privacy page prints the same
numbers). By hand, as the PHP user: `sudo -u www-data php /var/www/vector-box/public/api/retention.php`.

## 5. After deploying

```bash
cd /var/www/vector-box
# Run AS www-data: running as root could leave root-owned -wal/-shm files PHP-FPM can't write
sudo -u www-data php -r 'require "public/api/database.php"; echo getDbConnection()->query("PRAGMA user_version")->fetchColumn(), PHP_EOL;'
```

The first web request also runs the migrations; doing it by hand just shows errors right away.
Expected schema version: the `DB_SCHEMA_VERSION` constant in `public/api/database.php` (35 at the time of writing).

Open each page with the browser console open and look for `Content-Security-Policy` report
messages. When there are none, set `CSP_ENFORCE=true`.

## Error pages (static, in `public/errors/`)

Generated by `python3 tools/make-error-pages.py` (400 401 403 404 405 408 413 414 429 500 502 503 504). They are plain
HTML + `errors.css`/`errors.js`, so they work even when PHP or Node are down; 5xx pages retry by themselves every 15 s.
They do nothing until nginx uses them (needs the owner's yes). In the 443 server block:

```nginx
error_page 400 401 403 404 405 408 413 414 429 500 502 503 504 /errors/$status.html;
location ^~ /errors/ { root /var/www/vector-box/public; internal; }
location = /errors/errors.css { root /var/www/vector-box/public; }
location = /errors/errors.js  { root /var/www/vector-box/public; }
# PHP-FPM / proxied apps: let nginx replace their error bodies too
fastcgi_intercept_errors on;
proxy_intercept_errors on;
```

`internal` would also block the css/js the page loads, hence the two `location =` lines. Check with
`curl -i https://SITE/nonexistent` (expect 404 with the cyberpunk page), then `sudo nginx -t && sudo systemctl reload nginx`.

## Bots (what the code already does, and the nginx part that needs the owner's yes)

In the code (`public/api/bots.php`): bots are classified by User-Agent and counted per day in `bot_stats` (schema v31), the
latest lines go to `data/bots.log`, and the stats page shows them. SEO/data scrapers (Ahrefs, Semrush, MJ12, Bytespider...) get
403 on every PHP page; an address probing wp-login, `.env`, phpmyadmin etc. more than 8 times an hour gets 429 for the rest of
that hour. AI crawlers are only listed in `robots.txt`; `BOT_BLOCK_AI=true` in `.env` refuses them too.
Only requests that reach PHP are counted. What nginx rejects before PHP is not seen by the stats page.

Optional nginx hardening (http block + 443 server block), to drop junk before it reaches PHP:

```nginx
# http { ... }
map $http_user_agent $bad_bot {
    default 0;
    "~*(AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|Bytespider|BLEXBot|DataForSeoBot|serpstatbot|MegaIndex|Barkrowler)" 1;
}
limit_req_zone $binary_remote_addr zone=scan_zone:5m rate=1r/s;
# combined + $request_time at the end (keeps fail2ban and log tools working)
log_format timed '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time';

# server { ... 443 ... }
access_log /var/log/nginx/access.log timed;                  # adds $request_time: slow endpoints become visible
if ($bad_bot) { return 444; }                                # close the connection, no answer at all
location ~* ^/(wp-(admin|login|content|includes)|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin|boaform|HNAP1|\.env|\.git|vendor/phpunit|actuator) {
    return 444;   # (limit_req would never fire here: `return` runs first, so it was left out in production)
}
# books.php covers and the list share the 5 r/s zone with the whole API: give the book library its own bigger one
# (limit_req_zone $binary_remote_addr zone=books_zone:5m rate=20r/s; then limit_req zone=books_zone burst=40 nodelay; in a
#  `location = /api/books.php` block that repeats the fastcgi settings) and `limit_req_status 429;` so a refusal is not a 503.
```

Then `sudo nginx -t && sudo systemctl reload nginx`. Optional: fail2ban with a jail on 444/404 bursts from the access log.

## Health check for an external monitor

`GET /api/health.php` (public, no session, `Cache-Control: no-store`, 60 requests/minute per client) returns
`{"ok":true,"db":true,"time":<unix>,"disk_free_pct":<int>}`. It answers HTTP 503 with `ok:false` when the database
cannot be read or the data disk has under 5% free. Point an uptime monitor at it and alert on anything but 200.
The collector (`bin/attacks-collect.php`, same cron) also sends a daily digest after 08:00 and a disk alert under 15%
through ntfy (off with `ATTACK_NOTIFY=false`).

## Cloudflare proxy (orange cloud)

Only `@` and `www` are proxied; `*` (cloud., crafty., navidrome. ...) and the mail records stay DNS-only (media streaming and big uploads must not go through the free proxy).
Before turning it on, `.env` must trust Cloudflare's ranges, otherwise every visitor looks like a Cloudflare address:
`TRUSTED_PROXIES=127.0.0.1,::1,<ranges from https://www.cloudflare.com/ips-v4 and /ips-v6>` (CIDR works) and the same ranges after `loopback,` in `TRUST_PROXY`.
`getClientIp()` then reads the visitor from `X-Forwarded-For` only when the request really comes from one of those addresses. Test: `tests/client-ip.test.js`.
The origin IP is still public (DuckDNS name and the DNS-only subdomains point to it), so the proxy hides nothing by itself.
