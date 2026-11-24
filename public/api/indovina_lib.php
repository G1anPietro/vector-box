<?php
// public/api/indovina_lib.php — "Indovina cosa" (twenty questions), on the shared rooms of spia.php (game "indovina").
// One JSON state per room (table indovina_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Each round one player is the KEEPER and receives a secret word (a famous person, object, place or animal) on their own phone
// only. The others ask yes/no questions OUT LOUD; the keeper answers with three buttons (yes / no / maybe) and the server keeps the
// count (max 20) and the history. Anyone who thinks they know presses "I'll try" and types the word: the SERVER judges it
// (case, accents, articles and the aliases of lib/indovina-q.json are tolerated). One attempt per round and player: a wrong
// guess puts you out of the round. First right guess +3; if nobody finds it (time, 20 questions used and the last 30 seconds,
// or every guesser failed) the keeper gets +1 per guesser. The word is in NO response except the keeper's own `secret`, until the
// round is over. The end of the round is a server instant; clients only draw the time left that the server reports.
// Bank: lib/indovina-q.json {"w": [[cat(p|o|l|a), level(1|2), [it,en,es,fr,de], [aliases]], ...]}.

const INDOVINA_MIN_PLAYERS = 3;
const INDOVINA_MAX_QUESTIONS = 20;
const INDOVINA_LAST_SECONDS = 30;     // after the 20th answer only this much time is left for the final guesses
const INDOVINA_REVEAL_SECONDS = 12;
const INDOVINA_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function indovinaDefaultSettings(): array {
    return ['rounds' => 1, 'cat' => 'mix', 'diff' => 'mix', 'time' => 300];
}

function indovinaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(indovinaDefaultSettings(), array_intersect_key($base, indovinaDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [1, 2], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['cat']) && in_array($in['cat'], ['mix', 'people', 'objects', 'places', 'animals'], true)) $s['cat'] = $in['cat'];
    if (isset($in['diff']) && in_array($in['diff'], ['easy', 'mix', 'hard'], true)) $s['diff'] = $in['diff'];
    if (isset($in['time']) && in_array($in['time'], [180, 300], true)) $s['time'] = $in['time'];
    return $s;
}

function indovinaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = (json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/indovina-q.json'), true) ?: [])['w'] ?? [];
    return $bank;
}

/** Lower case ASCII words of a text: accents and punctuation gone, articles dropped ("Il Colosseo" and "colosseo" are the same). */
function indovinaNorm(string $s): string {
    static $map = null;
    if ($map === null) {
        $map = ['ß' => 'ss', 'œ' => 'oe', 'Œ' => 'oe', 'æ' => 'ae', 'Æ' => 'ae', 'ø' => 'o', 'Ø' => 'o'];
        foreach (['a' => 'àáâãäåāăÀÁÂÃÄÅĀĂ', 'c' => 'çćčÇĆČ', 'e' => 'èéêëēėęÈÉÊËĒĖĘ', 'i' => 'ìíîïīÌÍÎÏĪ', 'n' => 'ñńÑŃ', 'o' => 'òóôõöōÒÓÔÕÖŌ', 'u' => 'ùúûüūÙÚÛÜŪ', 'y' => 'ýÿÝŸ', 's' => 'šśŠŚ', 'z' => 'žźŽŹ'] as $a => $chars) {
            foreach (preg_split('//u', $chars, -1, PREG_SPLIT_NO_EMPTY) as $c) $map[$c] = $a;
        }
    }
    $s = strtolower(strtr($s, $map));
    $words = preg_split('/[^a-z0-9]+/', $s, -1, PREG_SPLIT_NO_EMPTY);
    $articles = ['il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una', 'the', 'a', 'an', 'el', 'los', 'las', 'unos', 'unas', 'les', 'une', 'des', 'der', 'die', 'das', 'ein', 'eine'];
    return implode(' ', array_values(array_filter($words, fn($w) => !in_array($w, $articles, true))));
}

/** True when the typed text is the word (in any of the five languages) or one of its aliases. */
function indovinaJudge(array $entry, string $guess): bool {
    $g = indovinaNorm(textCut($guess, 60));
    if ($g === '') return false;
    $gc = str_replace(' ', '', $g);
    foreach (array_merge($entry[2], $entry[3] ?? []) as $cand) {
        $c = str_replace(' ', '', indovinaNorm((string)$cand));
        if ($c === '') continue;
        if ($c === $gc) return true;
        if (strlen($c) >= 8 && strlen($gc) >= 8 && levenshtein($c, $gc) <= 1) return true;   // one typo on a long word
    }
    return false;
}

function indovinaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM indovina_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function indovinaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO indovina_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function indovinaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['round'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function indovinaActive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true)));
}

/** The players who may still try in this round: present, not the keeper, no attempt used yet. */
function indovinaGuessers(array $g): array {
    return array_values(array_filter(indovinaActive($g), fn($p) => $p !== (int)$g['keeper'] && !in_array($p, $g['tried'], true)));
}

function indovinaHasNext(array $g): bool {
    for ($i = $g['turn'] + 1; $i < count($g['turns']); $i++) if (!in_array($g['turns'][$i], $g['gone'], true)) return true;
    return false;
}

function indovinaEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach ($g['order'] as $p) {
        if (in_array($p, $g['gone'], true)) continue;
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'pts' => $g['scores'][(string)$p], 'hits' => $s['hits'], 'kept' => $s['kept']];
    }
    usort($rows, fn($a, $b) => [$b['pts'], $b['hits']] <=> [$a['pts'], $a['hits']]);
    $top = $rows ? $rows[0]['pts'] : 0;
    $g['result'] = ['reason' => $reason, 'rounds' => $g['round'], 'rows' => $rows,
        'winners' => $top > 0 ? array_values(array_map(fn($r) => $r['p'], array_filter($rows, fn($r) => $r['pts'] === $top))) : []];
    indovinaEvent($g, ['t' => 'end']);
}

/** Starts the next round with the next keeper that is still here, or ends the match. */
function indovinaStartRound(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    while ($g['turn'] < count($g['turns']) && in_array($g['turns'][$g['turn']], $g['gone'], true)) $g['turn']++;
    if ($g['turn'] >= count($g['turns'])) { indovinaEnd($g, 'done'); return; }
    $bank = indovinaBank();
    $cats = ['people' => 'p', 'objects' => 'o', 'places' => 'l', 'animals' => 'a'];
    $pool = array_keys(array_filter($bank, function ($e) use ($g, $cats) {
        if ($g['rules']['cat'] !== 'mix' && $e[0] !== $cats[$g['rules']['cat']]) return false;
        return $g['rules']['diff'] === 'mix' || (int)$e[1] === ($g['rules']['diff'] === 'easy' ? 1 : 2);
    }));
    if (!$pool) $pool = array_keys($bank);
    $free = array_values(array_diff($pool, $g['used']));
    if (!$free) { $g['used'] = array_values(array_diff($g['used'], $pool)); $free = $pool; }
    $w = $free[random_int(0, count($free) - 1)];
    $g['used'][] = $w;
    $g['round']++;
    $g['keeper'] = $g['turns'][$g['turn']];
    $g['w'] = $w;
    $g['answers'] = [];
    $g['tried'] = [];
    $g['tries'] = [];
    $g['reveal'] = null;
    $g['phase'] = 'ask';
    $g['ends_at'] = $now + (int)$g['rules']['time'];
    $g['next_at'] = null;
    indovinaEvent($g, ['t' => 'round', 'n' => $g['round'], 'p' => $g['keeper']]);
}

/** Closes the round: kind found (winner), nobody (the keeper scores) or void (the keeper left). The word becomes public. */
function indovinaFinish(array &$g, string $kind, ?int $winner = null, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $keeper = (int)$g['keeper'];
    $pts = [];
    if ($kind === 'found' && $winner !== null) {
        $pts[$winner] = 3;
        $g['stats'][(string)$winner]['hits']++;
    } elseif ($kind === 'nobody') {
        $n = count(array_filter(indovinaActive($g), fn($p) => $p !== $keeper));
        if (!in_array($keeper, $g['gone'], true) && $n > 0) $pts[$keeper] = $n;
    }
    foreach ($pts as $p => $v) {
        $g['scores'][(string)$p] += $v;
        if ($p === $keeper) $g['stats'][(string)$p]['kept'] += $v;
    }
    $row = indovinaBank()[$g['w']] ?? null;
    $g['reveal'] = ['kind' => $kind, 'p' => $winner, 'keeper' => $keeper, 'pts' => (object)$pts,
        'word' => $row ? array_combine(INDOVINA_LANGS, $row[2]) : null, 'asked' => count($g['answers']), 'tries' => $g['tries']];
    $g['phase'] = 'reveal';
    $g['next_at'] = $now + INDOVINA_REVEAL_SECONDS;
    indovinaEvent($g, ['t' => $kind, 'p' => $winner ?? $keeper]);
}

function indovinaAdvance(array &$g, ?float $now = null): void {
    if (!indovinaHasNext($g)) { indovinaEnd($g, 'done'); return; }
    $g['turn']++;
    indovinaStartRound($g, $now);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function indovinaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'ask' && $now >= $g['ends_at']) { indovinaFinish($g, 'nobody', null, $now); return true; }
    if ($g['phase'] === 'reveal' && $now >= $g['next_at']) { indovinaAdvance($g, $now); return true; }
    return false;
}

function indovinaStart(PDO $db, array $room): ?string {
    $s = indovinaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < INDOVINA_MIN_PLAYERS) return 'need_players_indovina';
    if (!indovinaBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = indovinaLoad($db, (int)$room['id']);
    $turns = [];
    for ($i = 0; $i < $s['rounds']; $i++) $turns = array_merge($turns, $order);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'ask', 'rules' => $s, 'order' => $order, 'gone' => [], 'turns' => $turns, 'turn' => 0,
        'scores' => array_fill_keys(array_map('strval', $order), 0),
        'stats' => array_fill_keys(array_map('strval', $order), ['hits' => 0, 'kept' => 0]),
        'round' => 0, 'used' => $prev['used'] ?? [], 'w' => null, 'keeper' => null, 'answers' => [], 'tried' => [], 'tries' => [],
        'ends_at' => null, 'next_at' => null, 'reveal' => null, 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    indovinaEvent($g, ['t' => 'start']);
    indovinaStartRound($g);
    indovinaSave($db, (int)$room['id'], $g);
    return null;
}

function indovinaPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    indovinaEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(indovinaActive($g)) < INDOVINA_MIN_PLAYERS) { indovinaEnd($g, 'too_few'); return; }
    if ($g['phase'] !== 'ask') return;
    if ((int)$g['keeper'] === $pid) indovinaFinish($g, 'void');
    elseif (!indovinaGuessers($g)) indovinaFinish($g, 'nobody');
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function indovinaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = indovinaLoad($db, (int)$room['id']);
    if ($g && indovinaTick($g)) indovinaSave($db, (int)$room['id'], $g);
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
            $new = indovinaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return indovinaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            indovinaEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            indovinaAdvance($g);
            break;
        case 'answer':
        case 'undo':
            if (!$playing || $g['phase'] !== 'ask') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['keeper']) return 'not_keeper';
            if ($action === 'undo') { array_pop($g['answers']); break; }
            $a = $in['a'] ?? '';
            if (!in_array($a, ['y', 'n', 'm'], true)) return 'bad_answer';
            if (count($g['answers']) >= INDOVINA_MAX_QUESTIONS) return 'limit_reached';
            $g['answers'][] = $a;
            if (count($g['answers']) === INDOVINA_MAX_QUESTIONS) {
                $g['ends_at'] = min($g['ends_at'], microtime(true) + INDOVINA_LAST_SECONDS);
                indovinaEvent($g, ['t' => 'limit']);
            }
            break;
        case 'guess':
            if (!$playing || $g['phase'] !== 'ask') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid === (int)$g['keeper'] || !in_array($pid, indovinaActive($g), true)) return 'you_are_out';
            if (in_array($pid, $g['tried'], true)) return 'already_tried';
            $text = trim(textCut((string)($in['text'] ?? ''), 60));
            if ($text === '') return 'bad_guess';
            $g['tried'][] = $pid;
            $g['tries'][] = ['p' => $pid, 'text' => $text];
            if (indovinaJudge(indovinaBank()[$g['w']], $text)) {
                indovinaFinish($g, 'found', $pid);
            } else {
                indovinaEvent($g, ['t' => 'wrong', 'p' => $pid]);
                if (!indovinaGuessers($g)) indovinaFinish($g, 'nobody');
            }
            break;
        default:
            return null;
    }
    indovinaSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The word only reaches the keeper's own phone while the round is on (`secret`), everybody after it. */
function indovinaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'indovina';
    $view['settings'] = indovinaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = indovinaLoad($db, (int)$room['id']);
    $view['indovina'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $ask = $g['status'] === 'play' && $g['phase'] === 'ask';
    $guessers = $ask ? indovinaGuessers($g) : [];
    $me = [];
    $secret = null;
    $row = $g['w'] !== null ? (indovinaBank()[$g['w']] ?? null) : null;
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $keeper = $g['status'] === 'play' && (int)$g['keeper'] === $pid;
        $me[] = ['player_id' => $pid, 'keeper' => $keeper, 'can_try' => in_array($pid, $guessers, true), 'tried' => in_array($pid, $g['tried'], true)];
        if ($keeper && $ask && $row) $secret = ['player_id' => $pid, 'word' => array_combine(INDOVINA_LANGS, $row[2])];
    }
    $remaining = 0;
    for ($i = $g['turn'] + 1; $i < count($g['turns']); $i++) if (!in_array($g['turns'][$i], $g['gone'], true)) $remaining++;
    $view['indovina'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'],
        'total' => $g['round'] + $remaining, 'order' => $g['order'], 'active' => indovinaActive($g), 'scores' => $g['scores'],
        'rules' => $g['rules'], 'limit' => INDOVINA_MAX_QUESTIONS,
        'keeper' => $g['status'] === 'play' ? $g['keeper'] : null,
        'cat' => $row && $g['status'] === 'play' ? $row[0] : null,
        'answers' => $g['answers'], 'tried' => $g['tried'],
        'ends_at' => $ask ? round($g['ends_at'], 1) : null,
        'left' => $ask ? max(0, round($g['ends_at'] - $now, 1)) : null,
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'reveal' => $g['reveal'], 'last' => $g['phase'] === 'reveal' && !indovinaHasNext($g),
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me, 'secret' => $secret,
    ];
    return $view;
}

/** For the admin LIVE panel (admin sessions only): the secret word included, the answers so far and the scores. */
function indovinaLiveInfo(PDO $db, int $roomId): ?array {
    $g = indovinaLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['w'] !== null ? (indovinaBank()[$g['w']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => $g['round'], 'keeper' => $g['keeper'],
        'word' => $row ? array_combine(INDOVINA_LANGS, $row[2]) : null, 'answers' => $g['answers'], 'tried' => $g['tried'], 'scores' => $g['scores'],
    ];
}
