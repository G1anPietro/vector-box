<?php
// public/api/news_lib.php — the news board (pages/novita.php): what is new, what is being worked on now, what is planned.
// Used by api/news.php (admin POST) and by tools/news.php (the command line, which is how the work gets onto the board).
require_once __DIR__ . '/database.php';

const NEWS_KINDS = ['feature', 'fix', 'content', 'security', 'ops'];
const NEWS_STATUS = ['planned', 'doing', 'done'];

/** Public view of the board: the open items first, then the last 40 finished. Never returns hidden items. */
function newsBoard(PDO $db): array {
    $rows = $db->query("SELECT * FROM news_items WHERE is_public = 1
                        ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, COALESCE(done_at, updated_at) DESC, id DESC LIMIT 80")->fetchAll(PDO::FETCH_ASSOC);
    // the last 5 notes of every item in ONE query (the page asks every 15 s: one query per item made it slow)
    $notes = [];
    foreach ($db->query('SELECT item_id, text_en, text_it, created_at FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY id DESC) AS rn FROM news_updates) WHERE rn <= 5 ORDER BY item_id, rn')->fetchAll(PDO::FETCH_ASSOC) as $u) {
        $notes[(int)$u['item_id']][] = ['en' => $u['text_en'], 'it' => $u['text_it'], 'at' => (int)$u['created_at']];
    }
    $out = [];
    $done = 0;
    foreach ($rows as $r) {
        if ($r['status'] === 'done' && ++$done > 40) continue;
        $out[] = [
            'slug' => $r['slug'], 'kind' => $r['kind'], 'status' => $r['status'], 'progress' => $r['progress'] === null ? null : (int)$r['progress'],
            'title' => ['en' => $r['title_en'], 'it' => $r['title_it']], 'body' => ['en' => $r['body_en'], 'it' => $r['body_it']],
            'version' => $r['version'], 'updated_at' => (int)$r['updated_at'], 'done_at' => $r['done_at'] === null ? null : (int)$r['done_at'],
            'updates' => $notes[(int)$r['id']] ?? [],
        ];
    }
    return $out;
}

/** Create or change one item by slug. Only the fields present in $f change. A note in $f['note_en'/'note_it'] is added to its log.
 *  Finishing an item (status done) stamps done_at; progress is clamped to 0-100. Returns the item's slug. */
function newsSave(PDO $db, string $slug, array $f): string {
    $slug = strtolower(trim($slug));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,63}$/', $slug)) throw new InvalidArgumentException('slug: 2-64 chars, a-z 0-9 and "-"');
    if (isset($f['kind']) && !in_array($f['kind'], NEWS_KINDS, true)) throw new InvalidArgumentException('kind');
    if (isset($f['status']) && !in_array($f['status'], NEWS_STATUS, true)) throw new InvalidArgumentException('status');
    $now = time();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $st = $db->prepare('SELECT * FROM news_items WHERE slug = :s');
        $st->execute([':s' => $slug]);
        $cur = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        $st->closeCursor();
        $text = fn(string $k) => isset($f[$k]) ? mb_substr(trim((string)$f[$k]), 0, 2000) : null;
        $vals = [];
        foreach (['kind', 'status', 'version', 'title_en', 'title_it', 'body_en', 'body_it'] as $k) {
            $v = $text($k);
            if ($v !== null) $vals[$k] = $v;
        }
        if (array_key_exists('progress', $f)) $vals['progress'] = $f['progress'] === null || $f['progress'] === '' ? null : max(0, min(100, (int)$f['progress']));
        if (isset($f['is_public'])) $vals['is_public'] = $f['is_public'] ? 1 : 0;
        if (($vals['status'] ?? '') === 'done') { $vals['progress'] = 100; $vals['done_at'] = $now; }
        if (isset($vals['status']) && $vals['status'] !== 'done') $vals['done_at'] = null;
        if (!$cur) {
            if (($vals['title_en'] ?? '') === '' && ($vals['title_it'] ?? '') === '') throw new InvalidArgumentException('a new item needs a title');
            // one language missing: reuse the other, so the board is never blank
            foreach (['title', 'body'] as $b) {
                $en = $vals[$b . '_en'] ?? ''; $it = $vals[$b . '_it'] ?? '';
                $vals[$b . '_en'] = $en !== '' ? $en : $it;
                $vals[$b . '_it'] = $it !== '' ? $it : $en;
            }
            $vals += ['slug' => $slug, 'created_at' => $now, 'updated_at' => $now];
            $cols = array_keys($vals);
            $db->prepare('INSERT INTO news_items (' . implode(',', $cols) . ') VALUES (:' . implode(',:', $cols) . ')')->execute($vals);
            $id = (int)$db->lastInsertId();
        } else {
            $id = (int)$cur['id'];
            $vals['updated_at'] = $now;
            $set = implode(',', array_map(fn($c) => "$c = :$c", array_keys($vals)));
            $db->prepare("UPDATE news_items SET $set WHERE id = :__id")->execute($vals + ['__id' => $id]);
        }
        $en = $text('note_en'); $it = $text('note_it');
        if ($en !== null || $it !== null) {
            $db->prepare('INSERT INTO news_updates (item_id, text_en, text_it, created_at) VALUES (:i, :e, :t, :n)')
               ->execute([':i' => $id, ':e' => $en ?? $it, ':t' => $it ?? $en, ':n' => $now]);
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
    return $slug;
}
