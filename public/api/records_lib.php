<?php
// public/api/records_lib.php — personal records of the solo games: which games and variants exist, what a believable value is,
// and how they are listed on the Account page. Private to the account (the public leaderboards are api/game_scores.php).
//
// 'lower' = the best is the smallest (Memory: fewest moves). 'max'/'min' = believable range.
// shortcut: like the leaderboards, the server cannot replay a game: the range only stops silly numbers. It is a private
// record, so nobody else is hurt by a made-up one.
const RECORD_RULES = [
    'skillcheck' => ['variants' => ['easy', 'normal', 'hard', 'easy-endless', 'normal-endless', 'hard-endless'], 'lower' => false, 'min' => 1, 'max' => 100000],
    'botola'     => ['variants' => ['easy', 'normal', 'hard', 'rising'], 'lower' => false, 'min' => 1, 'max' => 100000],
    'bandiere'   => ['variants' => ['easy', 'normal', 'hard', 'mix'], 'lower' => false, 'min' => 1, 'max' => 100000],
    'inventato'  => ['variants' => ['easy', 'hard', 'mix'], 'lower' => false, 'min' => 1, 'max' => 100000],
    'memory'     => ['variants' => ['easy', 'medium', 'hard'], 'lower' => true, 'min' => 4, 'max' => 9999],
    'simon'      => ['variants' => [''], 'lower' => false, 'min' => 1, 'max' => 1000],
    'difesa'     => ['variants' => [''], 'lower' => false, 'min' => 1, 'max' => 30],
];

/** null when the value is believable for that game and variant, else a short reason. */
function recordCheck(string $game, string $variant, $value): ?string {
    $r = RECORD_RULES[$game] ?? null;
    if (!$r) return 'unknown game';
    if (!in_array($variant, $r['variants'], true)) return 'unknown variant';
    if (!is_int($value)) return 'value must be an integer';
    if ($value < $r['min'] || $value > $r['max']) return 'value out of range';
    return null;
}

/** Keeps the better of the stored and the new value. Returns the value now stored. */
function recordSave(PDO $db, int $userId, string $game, string $variant, int $value): int {
    $lower = RECORD_RULES[$game]['lower'];
    $op = $lower ? 'MIN' : 'MAX';
    $db->prepare("INSERT INTO personal_records (user_id, game, variant, best, updated_at) VALUES (:u, :g, :v, :b, :t)
                  ON CONFLICT(user_id, game, variant) DO UPDATE SET
                    updated_at = CASE WHEN {$op}(best, excluded.best) <> best THEN excluded.updated_at ELSE updated_at END,
                    best = {$op}(best, excluded.best)")
       ->execute([':u' => $userId, ':g' => $game, ':v' => $variant, ':b' => $value, ':t' => time()]);
    $st = $db->prepare('SELECT best FROM personal_records WHERE user_id = :u AND game = :g AND variant = :v');
    $st->execute([':u' => $userId, ':g' => $game, ':v' => $variant]);
    return (int)$st->fetchColumn();
}

/** Names for the Account page: [game => [name it, name en, unit it, unit en, variant labels]]. */
function recordLabels(): array {
    $lv = ['easy' => ['Facile', 'Easy'], 'normal' => ['Normale', 'Normal'], 'hard' => ['Difficile', 'Hard'], 'rising' => ['Crescente', 'Rising'], 'medium' => ['Medio', 'Medium']];
    $sc = [];
    foreach (['easy', 'normal', 'hard'] as $d) {
        $sc[$d] = [$lv[$d][0] . ' · tre vite', $lv[$d][1] . ' · three lives'];
        $sc[$d . '-endless'] = [$lv[$d][0] . ' · infinita', $lv[$d][1] . ' · endless'];
    }
    return [
        'skillcheck' => ['Skill check', 'Skill check', 'colpi', 'hits', $sc],
        'botola'     => ['Botola (da solo)', 'Botola (alone)', 'risposte giuste', 'right answers', array_intersect_key($lv, array_flip(['easy', 'normal', 'hard', 'rising']))],
        'bandiere'   => ['Bandiere (da solo)', 'Flags (alone)', 'punti', 'points', ['easy' => ['Facile', 'Easy'], 'normal' => ['Medio', 'Medium'], 'hard' => ['Difficile', 'Hard'], 'mix' => ['Mix', 'Mix']]],
        'inventato'  => ['Vero o inventato (da solo)', 'Fake or fact (alone)', 'risposte giuste', 'right answers', ['easy' => ['Facile', 'Easy'], 'hard' => ['Difficile', 'Hard'], 'mix' => ['Mix', 'Mix']]],
        'memory'     => ['Memory', 'Memory', 'mosse', 'moves', array_intersect_key($lv, array_flip(['easy', 'medium', 'hard']))],
        'simon'      => ['Simon', 'Simon', 'colori', 'colours', ['' => ['Sequenza più lunga', 'Longest sequence']]],
        'difesa'     => ['Difesa del server', 'Server defence', 'ondata', 'wave', ['' => ['Ondata raggiunta', 'Wave reached']]],
        'tetris'     => ['Tetris', 'Tetris', 'punti', 'points', ['' => ['Classifica', 'Leaderboard']]],
        'dueamila'   => ['2048', '2048', 'punti', 'points', ['' => ['Classifica', 'Leaderboard']]],
        'snake'      => ['Snake', 'Snake', 'punti', 'points', ['' => ['Classifica', 'Leaderboard']]],
        'minato'     => ['Campo minato', 'Minesweeper', 's', 's', ['easy' => ['Facile', 'Easy'], 'medium' => ['Medio', 'Medium'], 'hard' => ['Difficile', 'Hard']]],
    ];
}

/** All the records of an account (personal ones and the best results of the leaderboard games), in the order of recordLabels(). */
function recordsOfAccount(PDO $db, int $userId): array {
    $out = [];
    $st = $db->prepare('SELECT game, variant, best, updated_at FROM personal_records WHERE user_id = :u');
    $st->execute([':u' => $userId]);
    foreach ($st->fetchAll() as $r) $out[$r['game']][$r['variant']] = ['best' => (int)$r['best'], 'at' => (int)$r['updated_at']];
    $st = $db->prepare('SELECT game, variant, score, created_at FROM game_scores WHERE user_id = :u');
    $st->execute([':u' => $userId]);
    foreach ($st->fetchAll() as $r) $out[$r['game']][$r['variant']] = ['best' => (int)$r['score'], 'at' => (int)$r['created_at']];
    $sorted = [];
    foreach (array_keys(recordLabels()) as $g) if (isset($out[$g])) $sorted[$g] = $out[$g];
    return $sorted;
}
