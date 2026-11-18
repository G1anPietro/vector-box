<?php
// public/api/game_scores_lib.php — which games have a leaderboard and what a believable result looks like.
//
// shortcut: the server cannot replay a game, so this only stops casual cheating (a hand-made request with a silly number or an
// impossible time). A determined cheater can send a result that looks plausible; upgrade only if the boards ever matter
// (e.g. send the move list and re-simulate it with the same rules code in Node).
//
// 'lower' = best is the smallest (a time in ms). 'max' = absolute cap. 'perSec' = most points one second of play can give.
// 'minMs' = shortest believable game. 'min' = (lower games) fastest believable time per variant, in ms.
const GAME_SCORE_RULES = [
    'tetris'   => ['variants' => [''], 'lower' => false, 'max' => 2000000, 'perSec' => 1000, 'minMs' => 3000],
    'dueamila' => ['variants' => [''], 'lower' => false, 'max' => 4000000, 'perSec' => 800,  'minMs' => 2000],
    'snake'    => ['variants' => [''], 'lower' => false, 'max' => 253,     'perSec' => 3,    'minMs' => 1000],
    'minato'   => ['variants' => ['easy', 'medium', 'hard'], 'lower' => true, 'max' => 999000, 'minMs' => 700,
                   'min' => ['easy' => 700, 'medium' => 3000, 'hard' => 8000]],
];

/** null when the result is believable, else a short reason. $score and $durationMs come straight from the request. */
function gameScoreCheck(string $game, string $variant, $score, $durationMs): ?string {
    $r = GAME_SCORE_RULES[$game] ?? null;
    if (!$r) return 'unknown game';
    if (!in_array($variant, $r['variants'], true)) return 'unknown variant';
    if (!is_int($score) || !is_int($durationMs)) return 'score and duration must be integers';
    if ($durationMs < $r['minMs'] || $durationMs > 86400000) return 'impossible duration';
    if ($r['lower']) {
        if ($score < $r['min'][$variant] || $score > $r['max']) return 'impossible time';
        if ($score > $durationMs + 1000) return 'time does not match the duration';   // the time is the play time
        return null;
    }
    if ($score < 1 || $score > $r['max']) return 'score out of range';
    if ($score > $r['perSec'] * $durationMs / 1000 + $r['perSec']) return 'score too high for the time played';
    return null;
}
