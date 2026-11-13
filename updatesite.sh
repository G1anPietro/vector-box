#!/bin/bash
# updatesite.sh — deploy the latest code to the server.
#
# Usage:  sudo bash updatesite.sh [branch]        (default branch: main)
#
# Steps: pre-flight checks -> save local edits (git stash, never lost) -> update code
#        -> npm deps if they changed -> data/ permissions -> DB migrations
#        -> restart the Node chat hub if it runs under PM2 -> bump version.php
#
# Optional environment variables:
#   PROJECT_DIR  (default /var/www/vector-box)
#   PM2_APP      PM2 process name of this repo's server.js (default vector-box-hub)
#   PM2_USER     user that owns that PM2 process (default: the user who ran sudo)
#   WEB_USER     PHP-FPM user (default www-data)

set -euo pipefail

BRANCH="${1:-main}"
PROJECT_DIR="${PROJECT_DIR:-/var/www/vector-box}"
PM2_APP="${PM2_APP:-vector-box-hub}"
PM2_USER="${PM2_USER:-${SUDO_USER:-}}"
WEB_USER="${WEB_USER:-www-data}"

say()  { echo ">> $*"; }
warn() { echo "!! $*" >&2; }
die()  { warn "$*"; warn "Nothing after this point was changed."; exit 1; }

IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1
[ "$IS_ROOT" -eq 1 ] || warn "Not running as root: permissions and the www-data migration check will be skipped."

as_web_user() {
    if [ "$IS_ROOT" -eq 1 ] && id "$WEB_USER" >/dev/null 2>&1; then
        sudo -u "$WEB_USER" "$@"
    else
        "$@"
    fi
}

cd "$PROJECT_DIR" || die "Project directory $PROJECT_DIR not found."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$PROJECT_DIR is not a git repository."

# ---------- 1. Pre-flight ----------
[ -f .env ] || die ".env is missing in $PROJECT_DIR. Create it first (see .env.example)."

# The repo is public and has no .gitignore: keep secrets and data out of git on this machine
# with the local, never-published exclude file.
EXCLUDE_FILE="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$EXCLUDE_FILE")"
for p in .env data/ version.php node_modules/ '*.sqlite' '*.log'; do
    grep -qxF "$p" "$EXCLUDE_FILE" 2>/dev/null || echo "$p" >> "$EXCLUDE_FILE"
done

say "Fetching origin/$BRANCH..."
git fetch --quiet origin "$BRANCH" || die "git fetch failed (network or SSH key?)."
OLD_REV=$(git rev-parse HEAD)
NEW_REV=$(git rev-parse "origin/$BRANCH")

# ---------- 2. Keep local edits instead of silently deleting them ----------
if ! git diff --quiet || ! git diff --cached --quiet; then
    STASH_MSG="updatesite $(date +'%Y-%m-%d %H:%M:%S')"
    warn "Local changes found on the server:"
    git status --short --untracked-files=no >&2
    git stash push --quiet -m "$STASH_MSG"
    warn "They were saved with: git stash  (\"$STASH_MSG\")"
    warn "See them: git stash show -p stash@{0}   Restore: git stash pop"
fi

# ---------- 3. Update the code ----------
if [ "$OLD_REV" = "$NEW_REV" ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ]; then
    say "Already up to date ($(git rev-parse --short HEAD))."
else
    say "Updating $(git rev-parse --short "$OLD_REV") -> $(git rev-parse --short "$NEW_REV") ($BRANCH)"
    git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    git reset --quiet --hard "origin/$BRANCH"
    echo "   Changes:"
    git log --oneline --no-decorate "$OLD_REV..$NEW_REV" 2>/dev/null | sed 's/^/     /' | head -40 || true
fi

# ---------- 4. Node dependencies (only when they changed) ----------
if command -v npm >/dev/null 2>&1; then
    if [ ! -d node_modules ] || ! git diff --quiet "$OLD_REV" HEAD -- package.json package-lock.json 2>/dev/null; then
        say "Installing Node dependencies (npm ci --omit=dev)..."
        npm ci --omit=dev --no-audit --no-fund --loglevel=error || warn "npm ci failed: the Node chat hub may not start."
        # node_modules must stay readable by whoever runs Node, not owned by root only
        if [ "$IS_ROOT" -eq 1 ] && [ -n "$PM2_USER" ] && id "$PM2_USER" >/dev/null 2>&1; then
            chown -R "$PM2_USER":"$PM2_USER" node_modules
        fi
    fi
else
    warn "npm not found: skipping Node dependencies."
fi

# ---------- 5. Permissions on data/ (DB, sessions, books) ----------
if [ "$IS_ROOT" -eq 1 ]; then
    mkdir -p data
    chown -R "$WEB_USER":"$WEB_USER" data
    chmod -R u+rwX,g+rwX,o-rwx data          # not world-readable (password hashes live there)
    chmod o-rwx .env
fi

# ---------- 6. Database migrations (run as the PHP user, so no root-owned -wal/-shm files) ----------
say "Checking the database schema..."
SCHEMA=$(as_web_user php -r 'require "public/api/database.php"; echo getDbConnection()->query("PRAGMA user_version")->fetchColumn();' 2>&1) \
    || { warn "Migration failed:"; warn "$SCHEMA"; exit 1; }
# The expected version comes from the code just checked out (bash keeps running the old copy of this script)
EXPECTED_SCHEMA=$(php -r 'require "public/api/database.php"; echo DB_SCHEMA_VERSION;' 2>/dev/null || echo '?')
if [ "$SCHEMA" = "$EXPECTED_SCHEMA" ]; then
    say "Database schema: version $SCHEMA"
else
    warn "Database schema is version $SCHEMA, expected $EXPECTED_SCHEMA. Check data/system_errors.log."
fi

# ---------- 7. Restart the Node chat hub, if it runs under PM2 ----------
# Only talks to an already-running PM2 daemon (pm2 would otherwise start a new one).
if [ -n "$PM2_USER" ] && command -v pm2 >/dev/null 2>&1; then
    PM2_HOME_DIR="$(getent passwd "$PM2_USER" | cut -d: -f6)/.pm2"
    if [ -S "$PM2_HOME_DIR/rpc.sock" ]; then
        if sudo -u "$PM2_USER" PM2_HOME="$PM2_HOME_DIR" pm2 describe "$PM2_APP" >/dev/null 2>&1; then
            say "Restarting PM2 app $PM2_APP (user $PM2_USER)..."
            sudo -u "$PM2_USER" PM2_HOME="$PM2_HOME_DIR" pm2 restart "$PM2_APP" --update-env >/dev/null \
                || warn "pm2 restart failed."
        else
            say "No PM2 app named $PM2_APP: chat hub not restarted (the site uses the PHP stream)."
        fi
    fi
fi

# ---------- 8. Version file ----------
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "$BRANCH")
CURRENT_DATE=$(date +'%Y-%m-%d')
VERSION_FILE="$PROJECT_DIR/version.php"

if [ -f "$VERSION_FILE" ]; then
    CURRENT_VER=$(grep "APP_VERSION" "$VERSION_FILE" | cut -d"'" -f4)
else
    CURRENT_VER="v2.4.0"
fi
MAJOR_MINOR=$(echo "$CURRENT_VER" | cut -d'.' -f1,2)
PATCH=$(echo "$CURRENT_VER" | cut -d'.' -f3)
NEW_VERSION="${MAJOR_MINOR}.$((PATCH + 1))"

say "Updating version to $NEW_VERSION ($GIT_HASH)..."
cat <<EOF > "$VERSION_FILE"
<?php
define('APP_VERSION', '$NEW_VERSION');
define('BUILD_DATE', '$CURRENT_DATE');
define('BUILD_HASH', '$GIT_HASH');
?>
EOF
chmod 644 "$VERSION_FILE"
[ "$IS_ROOT" -eq 1 ] && chown "$WEB_USER":"$WEB_USER" "$VERSION_FILE" 2>/dev/null || true

say "Site updated successfully!"
