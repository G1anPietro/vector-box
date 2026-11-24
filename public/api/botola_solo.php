<?php
// public/api/botola_solo.php — questions for the Botola modes that need no room: alone, and one phone passed around.
// No account, no database: nothing is stored on the server (best scores stay in the phone).
//
// GET  ?action=question&level=easy|normal|hard|rising&round=N&exclude=1,2,3
//        -> {success, id, difficulty, time, text:{it,en}, options:{it:[4],en:[4]}}   (same option order in both languages,
//           NO right answer)
// POST {id, lang: it|en, text}  (+ CSRF)  -> {success, right: bool, answer}   text = the chosen option ('' = no answer / time out)
// The room game never uses this: its questions are drawn and judged inside the room (botola_lib.php).
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/spia_lib.php';   // spiaShuffle
require_once __DIR__ . '/botola_lib.php';

initSession();
header('Cache-Control: no-store');

try {
    $bank = botolaBank();
    if (!$bank) jsonFail('no_questions', 'Questions are not available', 503);

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        requireCsrf();
        if (!checkRateLimit('botola_check', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
        $in = readJsonBody();
        $id = $in['id'] ?? null;
        $lang = ($in['lang'] ?? '') === 'it' ? 'it' : 'en';
        if (!is_int($id) || !isset($bank[$id])) jsonFail('bad_question', 'Unknown question', 400);
        // shortcut: the answer is judged per id with no served-question token, so a cheater can read the bank; personal record only, add an HMAC token if a public ranking appears
        $answer = $bank[$id][$lang === 'it' ? 2 : 1][1];   // row: [difficulty, [en q, right, w1, w2, w3], [it ...]]
        jsonResponse(['success' => true, 'right' => is_string($in['text'] ?? null) && trim($in['text']) === $answer, 'answer' => $answer]);
    }

    if (($_GET['action'] ?? '') !== 'question') jsonFail('unknown_action', 'Unknown action', 400);
    if (!checkRateLimit('botola_question', 300, 600)) jsonFail('slow_down', 'Too many requests', 429);
    $level = is_string($_GET['level'] ?? null) && isset(BOTOLA_LEVELS[$_GET['level']]) ? $_GET['level'] : 'rising';
    $round = max(1, min(1000, (int)($_GET['round'] ?? 1)));
    $exclude = array_slice(array_map('intval', array_filter(explode(',', (string)($_GET['exclude'] ?? '')), 'is_numeric')), 0, 400);
    $d = botolaDifficulty($level, $round);
    $pick = fn(array $skip) => array_values(array_filter(array_keys($bank), fn($i) => $bank[$i][0] === $d && !in_array($i, $skip, true)));
    $cands = $pick($exclude) ?: $pick([]);   // all of that difficulty already seen: start over
    $i = $cands[random_int(0, count($cands) - 1)];
    $perm = spiaShuffle([0, 1, 2, 3]);
    $row = $bank[$i];
    $opts = fn(array $texts) => array_map(fn($k) => $texts[1 + $perm[$k]], [0, 1, 2, 3]);
    jsonResponse([
        'success' => true, 'id' => $i, 'difficulty' => $row[0], 'time' => BOTOLA_LEVELS[$level],
        'text' => ['en' => $row[1][0], 'it' => $row[2][0]],
        'options' => ['en' => $opts($row[1]), 'it' => $opts($row[2])],
    ]);
} catch (Throwable $e) {
    failInternal('BOTOLA_SOLO', $e);
}
