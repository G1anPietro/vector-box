#!/bin/bash
# tools/backup.sh — nightly backup of vector-box to the USB stick.
#
# Usage:   sudo bash tools/backup.sh              the backup (normally from cron, see docs/BACKUP.md)
#          sudo bash tools/backup.sh --check      does NOT write: says whether the newest backup is fresh and restorable
#                                                 (exit 0 = fine, 1 = problem; handy for a monitor or a weekly cron)
#
# What it saves, under $BACKUP_DIR:
#   db/vector_uplink-YYYY-MM-DD_HHMM.sqlite.gz   consistent copy of the live database (daily ones kept $KEEP_DAYS days)
#   db/weekly/   the Sunday copy, kept $KEEP_WEEKS weeks      db/monthly/   the copy of day 1, kept $KEEP_MONTHS months
#   env/env-YYYY-MM-DD.txt                       copy of .env (secrets: the stick must stay at home)
#   files/                                       mirror of data/ (books, covers, uploaded notes, logs; not sessions, not temp files)
#   manifest-YYYY-MM-DD_HHMM.txt                 what was saved: code version, schema version, sizes, checksums
#
# Safety:
#   - it refuses to run if the stick is not mounted, so it can never fill the internal disk;
#   - it refuses when the stick has too little free space;
#   - the copy is checked three ways (SQLite integrity check, gzip test, the unpacked copy opens and has the tables);
#   - two runs at once cannot overlap (lock);
#   - on any failure it sends ONE short push to NTFY_TOPIC_URL from .env (no secrets, no data in the message).
#
# Environment variables (all optional):
#   PROJECT_DIR (/var/www/vector-box)  BACKUP_MOUNT (/mnt/usb)  BACKUP_DIR ($BACKUP_MOUNT/vector-box-backups)
#   KEEP_DAYS (30)  KEEP_WEEKS (12)  KEEP_MONTHS (12)  WEB_USER (www-data)  BACKUP_REQUIRE_MOUNT (1; 0 only for testing)
#   BACKUP_MAX_AGE_HOURS (26: --check calls a backup older than this stale)  BACKUP_NOTIFY (1; 0 to stay silent)

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/vector-box}"
BACKUP_MOUNT="${BACKUP_MOUNT:-/mnt/usb}"
BACKUP_DIR="${BACKUP_DIR:-$BACKUP_MOUNT/vector-box-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
KEEP_WEEKS="${KEEP_WEEKS:-12}"
KEEP_MONTHS="${KEEP_MONTHS:-12}"
WEB_USER="${WEB_USER:-www-data}"
MAX_AGE_H="${BACKUP_MAX_AGE_HOURS:-26}"
STAMP="$(date +'%Y-%m-%d_%H%M')"
DB="$PROJECT_DIR/data/vector_uplink.sqlite"
MODE="${1:-backup}"

log() { echo "[$(date +'%F %T')] $*"; }

# The ntfy address comes from .env (never written here). Only a short fixed text is sent: no paths, no secrets.
notify() {
    [ "${BACKUP_NOTIFY:-1}" = "1" ] || return 0
    local url
    url="$(grep -E '^NTFY_TOPIC_URL=' "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"' \r")" || true
    [ -n "$url" ] && command -v curl >/dev/null 2>&1 || return 0
    curl -fsS -m 10 -H "Title: vector-box backup" -H "Tags: warning" -d "$1" "$url" >/dev/null 2>&1 || true
}
die() { log "ERROR: $*"; notify "Backup FAILED on $(hostname -s): $*"; exit 1; }

as_web() {
    if [ "$(id -u)" -eq 0 ] && id "$WEB_USER" >/dev/null 2>&1; then sudo -u "$WEB_USER" "$@"; else "$@"; fi
}

# php one-liner: opens a SQLite file read-only, runs the integrity check and counts the tables; prints "tables=N schema=V"
sqlite_probe() {
    php -r '
        $d = new SQLite3($argv[1], SQLITE3_OPEN_READONLY);
        $ok = $d->querySingle("PRAGMA integrity_check");
        if ($ok !== "ok") { fwrite(STDERR, "integrity check: $ok\n"); exit(1); }
        $t = (int)$d->querySingle("SELECT COUNT(*) FROM sqlite_master WHERE type = \"table\"");
        if ($t < 10) { fwrite(STDERR, "only $t tables: this does not look like the site database\n"); exit(1); }
        echo "tables=$t schema=" . $d->querySingle("PRAGMA user_version"), "\n";
    ' "$1"
}

# ---------- --check: is the newest backup fresh and does it open? (writes nothing) ----------
if [ "$MODE" = "--check" ]; then
    if [ "${BACKUP_REQUIRE_MOUNT:-1}" = "1" ]; then mountpoint -q "$BACKUP_MOUNT" || die "$BACKUP_MOUNT is not mounted (stick unplugged?)"; fi
    newest="$(ls -1t "$BACKUP_DIR"/db/vector_uplink-*.sqlite.gz 2>/dev/null | head -1 || true)"
    [ -n "$newest" ] || die "no backup found in $BACKUP_DIR/db"
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
    [ "$age_h" -le "$MAX_AGE_H" ] || die "the newest backup is $age_h hours old ($(basename "$newest"))"
    gzip -t "$newest" || die "the newest backup is damaged (gzip test failed)"
    T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
    gunzip -c "$newest" > "$T/check.sqlite"
    info="$(sqlite_probe "$T/check.sqlite")" || die "the newest backup does not open cleanly"
    log "OK: $(basename "$newest"), $age_h h old, $info"
    exit 0
fi
[ "$MODE" = "backup" ] || { echo "usage: $0 [--check]"; exit 2; }

# ---------- 0. One run at a time ----------
exec 9>"${TMPDIR:-/tmp}/vector-box-backup.lock"
flock -n 9 || { log "another backup is already running: nothing to do"; exit 0; }

# ---------- 1. The stick must really be there, with room ----------
if [ "${BACKUP_REQUIRE_MOUNT:-1}" = "1" ]; then
    mountpoint -q "$BACKUP_MOUNT" || die "$BACKUP_MOUNT is not mounted (stick unplugged?). Nothing written."
fi
[ -f "$DB" ] || die "database not found: $DB"
mkdir -p "$BACKUP_DIR/db/weekly" "$BACKUP_DIR/db/monthly" "$BACKUP_DIR/env" "$BACKUP_DIR/files"
need_kb=$(( $(stat -c %s "$DB") / 1024 * 3 + 102400 ))          # three times the database plus 100 MB
free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
[ "$free_kb" -ge "$need_kb" ] || die "not enough free space on the stick (${free_kb} KB free, ${need_kb} KB needed)"

# ---------- 2. Database: SQLite online backup, then three checks ----------
# Run as the PHP user: running PHP as root on the live DB could leave root-owned -wal/-shm files.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# the web user writes the copy here: give it the folder, nobody else (not world-writable)
if [ "$(id -u)" -eq 0 ] && id "$WEB_USER" >/dev/null 2>&1; then chown "$WEB_USER" "$TMP"; fi
chmod 700 "$TMP"
as_web php -r '
    $src = new SQLite3($argv[1], SQLITE3_OPEN_READWRITE);
    $src->busyTimeout(10000);
    $dst = new SQLite3($argv[2]);
    if (!$src->backup($dst)) { fwrite(STDERR, "backup failed\n"); exit(1); }
    $ok = $dst->querySingle("PRAGMA integrity_check");
    if ($ok !== "ok") { fwrite(STDERR, "integrity check: $ok\n"); exit(1); }
' "$DB" "$TMP/backup.sqlite" || die "database backup failed"

OUT="$BACKUP_DIR/db/vector_uplink-$STAMP.sqlite.gz"
gzip -c "$TMP/backup.sqlite" > "$OUT.part" || die "writing the compressed copy failed (stick full or failing?)"
gzip -t "$OUT.part" || { rm -f "$OUT.part"; die "the compressed copy is damaged (gzip test)"; }
# the unpacked copy must open and look like the site database: a backup nobody tested is a hope, not a backup
gunzip -c "$OUT.part" > "$TMP/restored.sqlite"
PROBE="$(sqlite_probe "$TMP/restored.sqlite")" || { rm -f "$OUT.part"; die "the copy does not open cleanly after unpacking"; }
mv "$OUT.part" "$OUT"
log "database: $OUT ($(du -h "$OUT" | cut -f1)); $PROBE"

# weekly (Sunday) and monthly (day 1) copies live longer than the daily ones
[ "$(date +%u)" = "7" ] && cp -p "$OUT" "$BACKUP_DIR/db/weekly/"
[ "$(date +%d)" = "01" ] && cp -p "$OUT" "$BACKUP_DIR/db/monthly/"

# ---------- 3. .env (needed to restore; contains secrets) ----------
if [ -f "$PROJECT_DIR/.env" ]; then
    install -m 600 "$PROJECT_DIR/.env" "$BACKUP_DIR/env/env-$(date +'%F').txt"
fi

# ---------- 4. Files in data/ (books, covers, uploaded notes, logs): mirror, only what changed ----------
# Left out: sessions (temporary), tmp/ and appunti-tmp/ (zips and uploads still in progress, up to hundreds of MB, deleted
# right after), the database (saved above in a consistent way), caches, lock files, and the e-mail test log (addresses).
EXCLUDES=(--exclude 'sessions/' --exclude 'tmp/' --exclude 'appunti-tmp/' --exclude '*.sqlite' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm'
          --exclude 'status_cache.json' --exclude '*.lock' --exclude 'mail.log')
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${EXCLUDES[@]}" "$PROJECT_DIR/data/" "$BACKUP_DIR/files/"
else
    # no rsync: copy new/changed files (deleted files stay in the mirror)
    (cd "$PROJECT_DIR/data" && find . -type f ! -path './sessions/*' ! -path './tmp/*' ! -path './appunti-tmp/*' ! -name '*.sqlite*' \
        ! -name 'status_cache.json' ! -name '*.lock' ! -name 'mail.log' -print0 |
        while IFS= read -r -d '' f; do
            dst="$BACKUP_DIR/files/$f"
            if [ ! -f "$dst" ] || [ "$f" -nt "$dst" ]; then mkdir -p "$(dirname "$dst")"; cp -p "$f" "$dst"; fi
        done)
fi
log "files: $BACKUP_DIR/files ($(du -sh "$BACKUP_DIR/files" | cut -f1))"

# ---------- 5. Manifest: what exactly this backup is (no secrets in it) ----------
code="unknown"; command -v git >/dev/null 2>&1 && code="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
{
    echo "date:      $(date -Is)"
    echo "host:      $(hostname -s)"
    echo "code:      $code"
    echo "database:  $(basename "$OUT")  $(stat -c %s "$OUT") bytes  sha256 $(sha256sum "$OUT" | cut -d' ' -f1)"
    echo "checks:    $PROBE (integrity ok, gzip ok, opens after unpacking)"
    echo "files:     $(find "$BACKUP_DIR/files" -type f | wc -l) files, $(du -sh "$BACKUP_DIR/files" | cut -f1)"
} > "$BACKUP_DIR/manifest-$STAMP.txt"

# ---------- 6. Keep: $KEEP_DAYS daily, $KEEP_WEEKS weekly, $KEEP_MONTHS monthly ----------
find "$BACKUP_DIR/db" -maxdepth 1 -name 'vector_uplink-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR/db/weekly" -name 'vector_uplink-*.sqlite.gz' -mtime +$(( KEEP_WEEKS * 7 )) -delete
find "$BACKUP_DIR/db/monthly" -name 'vector_uplink-*.sqlite.gz' -mtime +$(( KEEP_MONTHS * 31 )) -delete
find "$BACKUP_DIR/env" -name 'env-*.txt' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'manifest-*.txt' -mtime +"$KEEP_DAYS" -delete
log "done. Free space on the stick: $(df -h "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
