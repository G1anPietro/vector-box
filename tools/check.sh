#!/bin/bash
# tools/check.sh — the one command to run before finishing any change.
#
# Usage:   bash tools/check.sh          (syntax of every PHP and JS file, then the whole test suite)
#          bash tools/check.sh --fast   (syntax only, a few seconds)
#
# It checks: `php -l` on every .php, `node --check` on every .js (node_modules and data/ excluded),
# then `npm test`. Exit code 0 only when everything passed.

set -uo pipefail
cd "$(dirname "$0")/.."

bad=0
php_n=0
js_n=0

while IFS= read -r -d '' f; do
    php_n=$((php_n + 1))
    out=$(php -l "$f" 2>&1) || { echo "PHP  $out"; bad=$((bad + 1)); }
done < <(find . -name '*.php' -not -path './node_modules/*' -not -path './data/*' -not -path './.git/*' -not -path './.claude/*' -print0)

while IFS= read -r -d '' f; do
    js_n=$((js_n + 1))
    out=$(node --check "$f" 2>&1) || { echo "JS   $f"; echo "$out"; bad=$((bad + 1)); }
done < <(find . -name '*.js' -not -path './node_modules/*' -not -path './data/*' -not -path './.git/*' -not -path './.claude/*' -print0)

echo "syntax: $php_n PHP files, $js_n JS files, $bad with errors"
[ "$bad" -eq 0 ] || exit 1
[ "${1:-}" = "--fast" ] && exit 0

log=$(mktemp)
npm test >"$log" 2>&1
status=$?
grep -E '^ℹ (tests|pass|fail|skipped) ' "$log" | tr '\n' ' '
echo
if [ "$status" -ne 0 ]; then
    grep -E '^\s*✖' "$log" | sort -u
    echo "tests FAILED (full output: $log)"
    exit 1
fi
rm -f "$log"
echo "all good"
