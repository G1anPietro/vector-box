<?php
// public/api/nomi_lib.php — "Nomi, cose, città" (name, thing, city + animal, job, film, colour, food), on the shared rooms of spia.php (game "nomi").
// One JSON state per room (table nomi_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Every round the server draws a letter. Everybody writes one word per category that starts with it, from their own phone; the answers of the
// others are NEVER sent while the round is open (nobody can copy). When the first player has filled every category the others get 10 more
// seconds (the "STOP"); when everybody has sent, or the time is up, the round goes to the review: every answer is shown with its points.
// Points per category: a valid word nobody else wrote 10, the same word as somebody else 5, the only valid word of the table 20, nothing or a word
// that does not start with the letter 0. The server judges only the letter and the family filter; the host can cancel a doubtful word in the review.
// Texts and words are never trusted: they are shown with textContent and the family filter reuses the word list of dieci_lib.php.

require_once __DIR__ . '/dieci_lib.php';   // the word cleaning and the family filter are shared

const NOMI_CATS = ['name', 'thing', 'city', 'animal', 'job', 'film', 'color', 'food'];
const NOMI_LETTERS = 'ABCDEFGILMNOPRSTUV';   // no H (mute in Italian, rare elsewhere), no Q/Z/J/K/W/X/Y
const NOMI_MIN_PLAYERS = 2;
const NOMI_MAX_LEN = 30;
const NOMI_REVIEW_SECONDS = 35;
const NOMI_CUT_SECONDS = 10;

function nomiDefaultSettings(): array {
    return ['cats' => NOMI_CATS, 'time' => 90, 'rounds' => 5, 'family' => true];
}

function nomiSanitizeSettings(array $in, array $base): array {
    $s = array_merge(nomiDefaultSettings(), array_intersect_key($base, nomiDefaultSettings()));
    if (isset($in['cats']) && is_array($in['cats'])) {
        $cats = array_values(array_filter(NOMI_CATS, fn($c) => in_array($c, $in['cats'], true)));   // canonical order, no strangers, no repeats
        if (count($cats) >= 2) $s['cats'] = $cats;
    }
    if (isset($in['time']) && in_array($in['time'], [60, 90, 120], true)) $s['time'] = $in['time'];
    if (isset($in['rounds']) && in_array($in['rounds'], [3, 5, 8], true)) $s['rounds'] = $in['rounds'];
    $s['family'] = isset($in['family']) && is_bool($in['family']) ? $in['family'] : (bool)$s['family'];
    return $s;
}

/** Lower case, no accents, only letters, digits and single spaces. */
function nomiNorm(string $s): string {
    $s = dieciNorm($s);
    $s = preg_replace('/[^a-z0-9 ]+/', ' ', $s) ?? '';
    return trim(preg_replace('/ +/', ' ', $s) ?? '');
}

/** The same word without its leading article, so that "il gatto" and "gatto" are the same answer. */
function nomiCore(string $norm): string {
    return preg_replace('/^(?:il|lo|la|le|gli|i|un|uno|una|the|an|a|el|los|las|une|les|le|der|die|das|ein|eine) (?=.)/', '', $norm, 1) ?? $norm;
}

/** Cleans one answer: returns the text ('' when empty) or null when it must be refused (not text, too long, HTML, heavy word). */
function nomiCleanAnswer($raw, bool $family): ?string {
    if (!is_string($raw)) return null;
    $t = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $raw);
    $t = $t === null ? null : preg_replace('/\s+/u', ' ', $t);
    if ($t === null) return null;
    $t = trim($t);
    if (textLength($t) > NOMI_MAX_LEN || strpbrk($t, '<>') !== false) return null;
    if ($family && $t !== '' && dieciHasBadWord($t)) return null;
    return $t;
}

/** Does this answer count? Starts with the letter (with or without its article), at least two letters. */
function nomiValid(string $text, string $letter): bool {
    $n = nomiNorm($text);
    if (strlen(str_replace(' ', '', $n)) < 2) return false;
    $l = strtolower($letter);
    return $n[0] === $l || nomiCore($n)[0] === $l;
}

function nomiLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM nomi_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function nomiSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO nomi_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function nomiEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function nomiActive(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

function nomiShuffle(array $a): array {
    for ($i = count($a) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$a[$i], $a[$j]] = [$a[$j], $a[$i]]; }
    return $a;
}

/**
 * The points of the open round. Returns ['cats' => [[cat, answers: [[p, text, ok, kind, pts]]]], 'round' => pid => points].
 * kind: solo | unique | shared | none (nothing written) | wrong (not a valid word) | cancelled (the host cancelled it).
 */
function nomiScoreRound(array $g): array {
    $letter = $g['q']['letter'];
    $active = nomiActive($g);
    $out = ['cats' => [], 'round' => array_fill_keys(array_map('strval', $active), 0)];
    foreach ($g['rules']['cats'] as $ci => $cat) {
        $rows = []; $keys = [];
        foreach ($active as $p) {
            $text = (string)($g['answers'][(string)$p][$ci] ?? '');
            $cancelled = in_array($p . ':' . $ci, $g['rejects'], true);
            $ok = $text !== '' && !$cancelled && nomiValid($text, $letter);
            $rows[$p] = ['p' => $p, 'text' => $text, 'ok' => $ok, 'kind' => $text === '' ? 'none' : ($cancelled ? 'cancelled' : ($ok ? '' : 'wrong')), 'pts' => 0];
            if ($ok) $keys[$p] = nomiCore(nomiNorm($text));
        }
        $count = array_count_values($keys);
        foreach ($keys as $p => $key) {
            $rows[$p]['kind'] = count($keys) === 1 && count($active) > 1 ? 'solo' : ($count[$key] > 1 ? 'shared' : 'unique');
            $rows[$p]['pts'] = $rows[$p]['kind'] === 'solo' ? 20 : ($rows[$p]['kind'] === 'shared' ? 5 : 10);
            $out['round'][(string)$p] += $rows[$p]['pts'];
        }
        $out['cats'][] = ['cat' => $cat, 'answers' => array_values($rows)];
    }
    return $out;
}

function nomiEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (nomiActive($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'pts' => $s['pts'], 'best' => $s['best']];
    }
    usort($rows, fn($a, $b) => [$b['pts'], $b['best']] <=> [$a['pts'], $a['best']]);
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'rows' => $rows];
    nomiEvent($g, ['t' => 'end']);
}

function nomiStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $time = (int)$g['rules']['time'];
    $g['q'] = ['letter' => $g['letters'][$g['round'] - 1], 'started' => $now, 'deadline' => $now + $time, 'time' => $time, 'cut' => false];
    $g['answers'] = []; $g['rejects'] = []; $g['review'] = null;
    $g['phase'] = 'write';
    nomiEvent($g, ['t' => 'round', 'n' => $g['round'], 'l' => $g['q']['letter']]);
}

/** The round is over: the points are added to the standings and the next round (or the end) follows. */
function nomiFinishRound(array &$g, ?float $now = null): void {
    $score = nomiScoreRound($g);
    foreach ($score['round'] as $p => $pts) {
        $s = &$g['stats'][(string)$p];
        $s['pts'] += $pts;
        $s['best'] = max($s['best'], $pts);
        unset($s);
    }
    if ($g['round'] >= count($g['letters'])) { nomiEnd($g, 'finished'); return; }
    $g['round']++;
    nomiStartRound($g, $now);
}

function nomiStartReview(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $g['phase'] = 'review';
    $g['review'] = ['next_at' => $now + NOMI_REVIEW_SECONDS, 'last' => $g['round'] >= count($g['letters'])];
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function nomiTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'write') {
        $all = !array_filter(nomiActive($g), fn($p) => !isset($g['answers'][(string)$p]));
        if ($now >= $g['q']['deadline'] || $all) { nomiStartReview($g, $now); return true; }
    } elseif ($g['phase'] === 'review' && $now >= $g['review']['next_at']) {
        nomiFinishRound($g, $now);
        return true;
    }
    return false;
}

function nomiStart(PDO $db, array $room): ?string {
    $s = nomiSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < NOMI_MIN_PLAYERS) return 'need_players_nomi';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = nomiLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'write', 'rules' => $s, 'order' => $order, 'gone' => [],
        'letters' => array_slice(nomiShuffle(str_split(NOMI_LETTERS)), 0, $s['rounds']),
        'stats' => array_fill_keys(array_map('strval', $order), ['pts' => 0, 'best' => 0]),
        'round' => 1, 'q' => null, 'answers' => [], 'rejects' => [], 'review' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    nomiEvent($g, ['t' => 'start']);
    nomiStartRound($g);
    nomiSave($db, (int)$room['id'], $g);
    return null;
}

/** A player leaves or is excluded: out of the match (their points stay out of the standings). */
function nomiPlayerLeft(array &$g, int $pid, string $ev = 'left'): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    nomiEvent($g, ['t' => $ev, 'p' => $pid]);
    if (count(nomiActive($g)) < NOMI_MIN_PLAYERS) nomiEnd($g, 'too_few');
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function nomiHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = nomiLoad($db, (int)$room['id']);
    if ($g && nomiTick($g)) nomiSave($db, (int)$room['id'], $g);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = nomiSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return nomiStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            nomiEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'review') return 'not_now';
            nomiFinishRound($g);
            break;
        case 'exclude':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            $pid = $in['player_id'] ?? null;
            if (!is_int($pid) || !in_array($pid, nomiActive($g), true)) return 'bad_target';
            nomiPlayerLeft($g, $pid, 'excluded');
            break;
        case 'reject':   // the host cancels (or gives back) one doubtful word of the review
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'review') return 'not_now';
            $pid = $in['player_id'] ?? null; $ci = $in['cat'] ?? null;
            if (!is_int($pid) || !in_array($pid, nomiActive($g), true) || !is_int($ci) || $ci < 0 || $ci >= count($g['rules']['cats'])) return 'bad_target';
            $key = $pid . ':' . $ci;
            $i = array_search($key, $g['rejects'], true);
            if ($i === false) { $g['rejects'][] = $key; nomiEvent($g, ['t' => 'rejected', 'p' => $pid]); }
            else { array_splice($g['rejects'], $i, 1); }
            break;
        case 'submit':
            if (!$playing || $g['phase'] !== 'write') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, nomiActive($g), true)) return 'you_are_out';
            if (isset($g['answers'][(string)$pid])) return 'already_wrote';
            if (microtime(true) > $g['q']['deadline'] + 0.5) return 'not_now';
            $raw = $in['answers'] ?? null;
            $n = count($g['rules']['cats']);
            if (!is_array($raw) || count($raw) !== $n) return 'bad_text';
            $clean = [];
            foreach (array_values($raw) as $a) {
                $c = nomiCleanAnswer($a, !empty($g['rules']['family']));
                if ($c === null) return is_string($a) && textLength($a) <= NOMI_MAX_LEN && strpbrk($a, '<>') === false ? 'bad_word' : 'bad_text';
                $clean[] = $c;
            }
            $g['answers'][(string)$pid] = $clean;
            if (!in_array('', $clean, true) && !$g['q']['cut']) {   // the first complete sheet: the others have 10 seconds left
                $g['q']['cut'] = true;
                $g['q']['deadline'] = min($g['q']['deadline'], microtime(true) + NOMI_CUT_SECONDS);
                nomiEvent($g, ['t' => 'cut', 'p' => $pid]);
            }
            nomiTick($g);
            break;
        default:
            return null;
    }
    nomiSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. Other people's answers only in the review. */
function nomiView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'nomi';
    $view['settings'] = nomiSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = nomiLoad($db, (int)$room['id']);
    $view['nomi'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $phase = $g['phase'];
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = ['player_id' => $pid, 'active' => !in_array($pid, $g['gone'], true), 'sent' => isset($g['answers'][(string)$pid])];
    }
    $review = null;
    if ($phase === 'review') {
        $sc = nomiScoreRound($g);
        $review = ['cats' => $sc['cats'], 'round' => $sc['round'], 'last' => $g['review']['last'], 'next_left' => max(0, round($g['review']['next_at'] - $now, 1))];
    }
    $view['nomi'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $phase, 'round' => $g['round'], 'rounds' => count($g['letters']),
        'order' => $g['order'], 'active' => nomiActive($g), 'rules' => $g['rules'],
        'letter' => $g['q']['letter'] ?? null,
        'q' => $phase === 'write' && $g['q'] ? ['time' => $g['q']['time'], 'left' => max(0, round($g['q']['deadline'] - $now, 1)), 'cut' => $g['q']['cut']] : null,
        'sent' => in_array($phase, ['write'], true) ? array_map('intval', array_keys($g['answers'])) : [],
        'review' => $review, 'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
        'scores' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
    return $view;
}

/** For the admin LIVE panel: the admin sees what everybody has written (the players do not, until the review). */
function nomiLiveInfo(PDO $db, int $roomId): ?array {
    $g = nomiLoad($db, $roomId);
    if (!$g) return null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'rounds' => count($g['letters']),
        'letter' => $g['q']['letter'] ?? null, 'cats' => $g['rules']['cats'], 'answers' => $g['answers'],
        'scores' => array_map(fn($s) => $s['pts'], $g['stats']),
    ];
}
