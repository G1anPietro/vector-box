#!/bin/bash

# Navigate to project directory
PROJECT_DIR="/var/www/vector-box"
cd "$PROJECT_DIR" || exit 1

echo ">> Pulling latest updates from Git..."
git pull origin main

# Extract short git commit hash and current date
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "main")
CURRENT_DATE=$(date +'%Y-%m-%d')

# Read current version or set default, then increment patch number
VERSION_FILE="$PROJECT_DIR/version.php"

if [ -f "$VERSION_FILE" ]; then
    CURRENT_VER=$(grep "APP_VERSION" "$VERSION_FILE" | cut -d"'" -f4)
else
    CURRENT_VER="v2.4.0"
fi

# Bump version number (e.g., v2.4.0 -> v2.4.1)
MAJOR_MINOR=$(echo "$CURRENT_VER" | cut -d'.' -f1,2)
PATCH=$(echo "$CURRENT_VER" | cut -d'.' -f3)
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR_MINOR}.${NEW_PATCH}"

echo ">> Updating version to $NEW_VERSION ($GIT_HASH)..."

# Write updated version file
cat <<EOF > "$VERSION_FILE"
<?php
define('APP_VERSION', '$NEW_VERSION');
define('BUILD_DATE', '$CURRENT_DATE');
define('BUILD_HASH', '$GIT_HASH');
?>
EOF

# Ensure web server can read the updated file
chmod 644 "$VERSION_FILE"
chown www-data:www-data "$VERSION_FILE" 2>/dev/null || true

echo ">> Site updated successfully!"