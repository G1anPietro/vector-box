<?php
// public/api/news_ideas.php — the ideas box of the news page.
//   GET                                 -> {ideas: the person's own (an admin: everybody's) with status, answer and votes; public: the ones other people have
//                                          that an admin is considering or has planned/done, without the author, most voted first}
//   POST {action:'vote', id}            -> toggles your vote on a public idea (not your own; 60 a hour)
//   POST {text}                         -> add an idea (account required, CSRF, 5 per day, max 20 waiting)
//   POST {action:'set', id, status, reply?}   admin only: status new|considering|planned|done|declined, optional short answer
//   POST {action:'delete', id}          -> the author deletes their own idea (an admin any)
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

initSession();
header('Content-Type: application/json');
requireLogin();
$db = getDbConnection();
$me = (int)$_SESSION['user_id'];
$isAdmin = !empty($_SESSION['is_admin']);
const IDEA_STATUS = ['new', 'considering', 'planned', 'done', 'declined'];

const IDEA_PUBLIC = "('considering', 'planned', 'done')";   // an idea the admin has looked at is shown to everybody (without the name)

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $cols = 'i.id, i.text, i.status, i.reply, i.created_at, a.username,
             (SELECT COUNT(*) FROM news_idea_votes v WHERE v.idea_id = i.id) AS votes,
             EXISTS (SELECT 1 FROM news_idea_votes v WHERE v.idea_id = i.id AND v.user_id = :me) AS voted';
    $row = fn($r, $names) => [
        'id' => (int)$r['id'], 'text' => $r['text'], 'status' => $r['status'], 'reply' => $r['reply'], 'created_at' => (int)$r['created_at'],
        'votes' => (int)$r['votes'], 'voted' => (bool)$r['voted'], 'username' => $names ? (string)$r['username'] : null,
    ];
    // "ideas": your own (an admin: everybody's); "public": the ones under review or later by other people, most voted first
    $st = $db->prepare("SELECT $cols FROM news_ideas i LEFT JOIN accounts a ON a.id = i.user_id" . ($isAdmin ? '' : ' WHERE i.user_id = :u') . ' ORDER BY i.id DESC LIMIT 200');
    $st->execute($isAdmin ? [':me' => $me] : [':me' => $me, ':u' => $me]);
    $mine = array_map(fn($r) => $row($r, $isAdmin), $st->fetchAll(PDO::FETCH_ASSOC));
    $st = $db->prepare("SELECT $cols FROM news_ideas i LEFT JOIN accounts a ON a.id = i.user_id WHERE i.user_id != :u AND i.status IN " . IDEA_PUBLIC . ' ORDER BY votes DESC, i.id DESC LIMIT 100');
    $st->execute([':me' => $me, ':u' => $me]);
    jsonResponse(['success' => true, 'admin' => $isAdmin, 'ideas' => $mine, 'public' => array_map(fn($r) => $row($r, false), $st->fetchAll(PDO::FETCH_ASSOC))]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonFail('METHOD', 'Method not allowed', 405);

requireCsrf();
$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) jsonFail('BAD_INPUT', 'JSON expected');
$action = (string)($in['action'] ?? 'add');
try {
    if ($action === 'add') {
        $text = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x{200B}-\x{200F}\x{202A}-\x{202E}]/u', '', (string)($in['text'] ?? '')));
        $n = textLength($text);
        if ($n < 10 || $n > 500) jsonFail('BAD_INPUT', 'The idea must be 10-500 characters');
        if (!checkRateLimit('idea_add', 5, 86400, (string)$me, true, true)) jsonFail('RATE', 'Too many ideas today, try again tomorrow', 429);
        $waiting = $db->prepare("SELECT COUNT(*) FROM news_ideas WHERE user_id = :u AND status = 'new'");
        $waiting->execute([':u' => $me]);
        if ((int)$waiting->fetchColumn() >= 20) jsonFail('LIMIT', 'You have 20 ideas waiting: wait for some answers', 429);
        $db->prepare('INSERT INTO news_ideas (user_id, text, created_at) VALUES (:u, :t, :n)')->execute([':u' => $me, ':t' => $text, ':n' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId()]);
    }
    if ($action === 'vote') {
        if (!checkRateLimit('idea_vote', 60, 3600, (string)$me, true, true)) jsonFail('RATE', 'Too many votes, try later', 429);
        $id = (int)($in['id'] ?? 0);
        $st = $db->prepare('SELECT user_id, status FROM news_ideas WHERE id = :i');
        $st->execute([':i' => $id]);
        $idea = $st->fetch(PDO::FETCH_ASSOC);
        $st->closeCursor();
        if (!$idea || (int)$idea['user_id'] === $me || !in_array($idea['status'], ['considering', 'planned', 'done'], true)) jsonFail('NOT_FOUND', 'No such idea', 404);
        $del = $db->prepare('DELETE FROM news_idea_votes WHERE idea_id = :i AND user_id = :u');
        $del->execute([':i' => $id, ':u' => $me]);
        $voted = $del->rowCount() === 0;                                   // there was no vote: this is a new one
        if ($voted) $db->prepare('INSERT OR IGNORE INTO news_idea_votes (idea_id, user_id) VALUES (:i, :u)')->execute([':i' => $id, ':u' => $me]);
        $n = $db->prepare('SELECT COUNT(*) FROM news_idea_votes WHERE idea_id = :i');
        $n->execute([':i' => $id]);
        jsonResponse(['success' => true, 'voted' => $voted, 'votes' => (int)$n->fetchColumn()]);
    }
    if ($action === 'set') {
        requireAdmin();
        $status = (string)($in['status'] ?? '');
        if (!in_array($status, IDEA_STATUS, true)) jsonFail('BAD_INPUT', 'status');
        $db->prepare('UPDATE news_ideas SET status = :s, reply = :r WHERE id = :i')
           ->execute([':s' => $status, ':r' => textCut(trim((string)($in['reply'] ?? '')), 300), ':i' => (int)($in['id'] ?? 0)]);
        jsonResponse(['success' => true]);
    }
    if ($action === 'delete') {
        $own = $isAdmin ? null : $db->prepare('SELECT 1 FROM news_ideas WHERE id = :i AND user_id = :u');
        if ($own) { $own->execute([':i' => (int)($in['id'] ?? 0), ':u' => $me]); if (!$own->fetchColumn()) jsonResponse(['success' => true]); $own->closeCursor(); }
        $db->prepare('DELETE FROM news_idea_votes WHERE idea_id = :i')->execute([':i' => (int)($in['id'] ?? 0)]);
        $db->prepare('DELETE FROM news_ideas WHERE id = :i' . ($isAdmin ? '' : ' AND user_id = :u'))
           ->execute($isAdmin ? [':i' => (int)($in['id'] ?? 0)] : [':i' => (int)($in['id'] ?? 0), ':u' => $me]);
        jsonResponse(['success' => true]);
    }
    jsonFail('BAD_INPUT', 'action');
} catch (Throwable $e) {
    failInternal('NEWS_IDEAS', $e);
}
