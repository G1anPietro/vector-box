<?php
// public/api/condividi.php — the public side of the temporary links to class material (no login).
// GET ?t=TOKEN&action=info            -> {kind, title, expires_at, ...} of the shared file / document / note (counts one opening)
// GET ?t=TOKEN&action=file[&dl=1]     -> the bytes of a shared file (inline for pictures, PDF and audio; dl=1 forces a download)
// The link is the only key: a random 128-bit token (stored hashed), an expiry, and the owner can revoke it. Never listed, never indexed.
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/appunti_lib.php';

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

function cvGone(): void {
    jsonResponse(['success' => false, 'code' => 'gone', 'error' => 'This link does not exist or has expired'], 404);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') jsonResponse(['success' => false, 'error' => 'Method not allowed'], 405);
try {
    if (!checkRateLimit('share_view', 120, 60, 'ip:' . getClientIp())) jsonResponse(['success' => false, 'code' => 'slow_down', 'error' => 'Too many requests'], 429);
    $db = getDbConnection();
    $token = (string)($_GET['t'] ?? '');
    if (!preg_match('/^[0-9a-f]{32}$/', $token)) cvGone();
    $st = $db->prepare('SELECT * FROM share_links WHERE token_hash = :h AND revoked = 0 AND expires_at > :t');
    $st->execute([':h' => hash('sha256', $token), ':t' => time()]);
    $link = $st->fetch();
    if (!$link) cvGone();
    $classOk = $db->prepare("SELECT 1 FROM school_classes WHERE id = :c AND status = 'active'");
    $classOk->execute([':c' => $link['class_id']]);
    if (!$classOk->fetchColumn()) cvGone();
    $action = (string)($_GET['action'] ?? 'info');
    $base = ['success' => true, 'kind' => $link['kind'], 'title' => $link['title'], 'expires_at' => (int)$link['expires_at']];

    if ($link['kind'] === 'file') {
        $f = $db->prepare('SELECT * FROM class_item_files WHERE id = :id AND class_id = :c');
        $f->execute([':id' => $link['ref_id'], ':c' => $link['class_id']]);
        $file = $f->fetch();
        if (!$file) cvGone();
        if ($action === 'file') {
            $path = notesDir((int)$file['class_id']) . '/' . basename($file['stored_name']);
            if (!is_file($path)) cvGone();
            $mime = (string)$file['mime'];
            $inline = empty($_GET['dl']) && (str_starts_with($mime, 'image/') || str_starts_with($mime, 'audio/') || $mime === 'application/pdf');
            $name = str_replace(['"', '\\'], '', $file['original_name']);
            header('Content-Type: ' . $mime);
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . rawurlencode($name) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
            header('X-Content-Type-Options: nosniff');
            header("Content-Security-Policy: sandbox; default-src 'none'");
            readfile($path);
            exit();
        }
        $db->prepare('UPDATE share_links SET views = views + 1 WHERE id = :id')->execute([':id' => $link['id']]);
        jsonResponse($base + ['name' => $file['original_name'], 'mime' => $file['mime'], 'size' => (int)$file['size'],
            'text' => $file['text_status'] === 'done' ? $file['text'] : null]);
    }

    if ($link['kind'] === 'doc') {
        $d = $db->prepare("SELECT kind, content, updated_at, lesson_date FROM class_docs WHERE id = :id AND class_id = :c AND status = 'ok' AND kind NOT IN ('quiz', 'domande')");
        $d->execute([':id' => $link['ref_id'], ':c' => $link['class_id']]);
        $doc = $d->fetch();
        if (!$doc) cvGone();
        $db->prepare('UPDATE share_links SET views = views + 1 WHERE id = :id')->execute([':id' => $link['id']]);
        jsonResponse($base + ['doc_kind' => $doc['kind'], 'content' => $doc['content'], 'updated_at' => (int)$doc['updated_at'], 'lesson_date' => $doc['lesson_date']]);
    }

    $i = $db->prepare("SELECT body, lesson_date FROM class_items WHERE id = :id AND class_id = :c AND LENGTH(body) > 0");
    $i->execute([':id' => $link['ref_id'], ':c' => $link['class_id']]);
    $item = $i->fetch();
    if (!$item) cvGone();
    $db->prepare('UPDATE share_links SET views = views + 1 WHERE id = :id')->execute([':id' => $link['id']]);
    jsonResponse($base + ['body' => $item['body'], 'lesson_date' => $item['lesson_date']]);
} catch (Throwable $e) {
    failInternal('CONDIVIDI', $e);
}
