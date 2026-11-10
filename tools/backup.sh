#!/bin/bash
# tools/backup.sh — nightly backup of vector-box to the USB stick.
#
# Usage:   sudo bash tools/backup.sh            (normally from cron, see docs/BACKUP.md)
#
# What it saves, under $BACKUP_DIR:
#   db/vector_uplink-YYYY-MM-DD_HHMM.sqlite.gz   consistent copy of the live database (kept $KEEP_DAYS days)
#   env/env-YYYY-MM-DD.txt                       copy of .env (secrets: the stick must stay at home)
#   files/                                       mirror of data/ (books, covers, logs; no sessions)
#
# Safety: it refuses to run if the stick is not mounted, so it can never fill the internal disk.
#
# Environment variables (all optional):
#   PROJECT_DIR (/var/www/vector-box)  BACKUP_MOUNT (/mnt/usb)  BACKUP_DIR ($BACKUP_MOUNT/vector-box-backups)
#   KEEP_DAYS (30)  WEB_USER (www-data)  BACKUP_REQUIRE_MOUNT (1; 0 only for testing)

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/vector-box}"
BACKUP_MOUNT="${BACKUP_MOUNT:-/mnt/usb}"
BACKUP_DIR="${BACKUP_DIR:-$BACKUP_MOUNT/vector-box-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
WEB_USER="${WEB_USER:-www-data}"
STAMP="$(date +'%Y-%m-%d_%H%M')"
DB="$PROJECT_DIR/data/vector_uplink.sqlite"

log() { echo "[$(date +'%F %T')] $*"; }
die() { log "ERROR: $*"; exit 1; }

# ---------- 1. The stick must really be there ----------
if [ "${BACKUP_REQUIRE_MOUNT:-1}" = "1" ]; then
    mountpoint -q "$BACKUP_MOUNT" || die "$BACKUP_MOUNT is not mounted (stick unplugged?). Nothing written."
fi
[ -f "$DB" ] || die "database not found: $DB"
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/env" "$BACKUP_DIR/files"

# ---------- 2. Database: SQLite online backup, then an integrity check ----------
# Run as the PHP user: running PHP as root on the live DB could leave root-owned -wal/-shm files.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 777 "$TMP"
as_web() {
    if [ "$(id -u)" -eq 0 ] && id "$WEB_USER" >/dev/null 2>&1; then sudo -u "$WEB_USER" "$@"; else "$@"; fi
}
as_web php -r '
    $src = new SQLite3($argv[1], SQLITE3_OPEN_READWRITE);
    $src->busyTimeout(10000);
    $dst = new SQLite3($argv[2]);
    if (!$src->backup($dst)) { fwrite(STDERR, "backup failed\n"); exit(1); }
    $ok = $dst->querySingle("PRAGMA integrity_check");
    if ($ok !== "ok") { fwrite(STDERR, "integrity check: $ok\n"); exit(1); }
' "$DB" "$TMP/backup.sqlite" || die "database backup failed"

OUT="$BACKUP_DIR/db/vector_uplink-$STAMP.sqlite.gz"
gzip -c "$TMP/backup.sqlite" > "$OUT.part" && mv "$OUT.part" "$OUT"
log "database: $OUT ($(du -h "$OUT" | cut -f1))"

# ---------- 3. .env (needed to restore; contains secrets) ----------
if [ -f "$PROJECT_DIR/.env" ]; then
    install -m 600 "$PROJECT_DIR/.env" "$BACKUP_DIR/env/env-$(date +'%F').txt"
fi

# ---------- 4. Files in data/ (books, covers, logs): mirror, only what changed ----------
EXCLUDES=(--exclude 'sessions/' --exclude '*.sqlite' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' --exclude 'status_cache.json')
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "${EXCLUDES[@]}" "$PROJECT_DIR/data/" "$BACKUP_DIR/files/"
else
    # no rsync: copy new/changed files (deleted files stay in the mirror)
    (cd "$PROJECT_DIR/data" && find . -type f ! -path './sessions/*' ! -name '*.sqlite*' ! -name 'status_cache.json' -print0 |
        while IFS= read -r -d '' f; do
            dst="$BACKUP_DIR/files/$f"
            if [ ! -f "$dst" ] || [ "$f" -nt "$dst" ]; then mkdir -p "$(dirname "$dst")"; cp -p "$f" "$dst"; fi
        done)
fi
log "files: $BACKUP_DIR/files ($(du -sh "$BACKUP_DIR/files" | cut -f1))"

# ---------- 5. Keep the last $KEEP_DAYS days ----------
find "$BACKUP_DIR/db" -name 'vector_uplink-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR/env" -name 'env-*.txt' -mtime +"$KEEP_DAYS" -delete
log "done. Free space on the stick: $(df -h "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
