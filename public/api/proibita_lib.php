<?php
// public/api/proibita_lib.php — "Parola proibita" (forbidden word), on the shared rooms of spia.php (game "proibita").
// One JSON state per room (table proibita_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Two teams (red "A", white "B"), 2*N turns (N rounds, the host picks 2/3/5), the teams alternate. In a turn one player of the
// active team is the CLUE-GIVER and sees a secret word with 5 forbidden words; he makes his team guess it by speaking, without
// the word, the forbidden ones, derivatives, gestures or sounds. One player of the OTHER team is the GUARDIAN: he sees the same card
// (he must know what is forbidden) and presses BUZZ when he hears a forbidden word: -1 point and the next card. The clue-giver presses
// "Got it" (+1) when the team guessed, or "Skip" (max 3 per turn). The SERVER owns the clock (ends_at) and the cards: they are
// never sent to the other phones (the guessing team, spectators); the admin LIVE panel sees the card.
// Cards: lib/proibita-q.json {"easy": [card...], "hard": [card...]}, card = [[it x6], [en x6], [es x6], [fr x6], [de x6]] (word, then 5 forbidden).

const PB_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const PB_SKIPS = 3;
const PB_REVIEW_SECONDS = 12;

function proibitaDefaultSettings(): array {
    return ['rounds' => 3, 'time' => 60, 'level' => 'mix'];
}

function proibitaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(proibitaDefaultSettings(), array_intersect_key($base, proibitaDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [2, 3, 5], true)) $s['rounds'] = $in['rounds'];
    if (isset($in['time']) && in_array($in['time'], [45, 60, 90], true)) $s['time'] = $in['time'];
    if (isset($in['level']) && in_array($in['level'], ['easy', 'hard', 'mix'], true)) $s['level'] = $in['level'];
    return $s;
}

function proibitaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/proibita-q.json'), true) ?: [];
    return $bank;
}

function proibitaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM proibita_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function proibitaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO proibita_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function proibitaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['turn'] = $g['turn'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function proibitaTotalTurns(array $g): int {
    return 2 * (int)$g['rules']['rounds'];
}

function proibitaTeam(array $g): string {
    return $g['turn'] % 2 === 0 ? 'A' : 'B';
}

function proibitaOther(string $t): string {
    return $t === 'A' ? 'B' : 'A';
}

function proibitaMembers(array $g, string $team): array {
    return array_values(array_filter($g['teams'][$team], fn($p) => !in_array($p, $g['gone'], true)));
}

function proibitaCard(?string $ref): ?array {
    if (!$ref) return null;
    $row = proibitaBank()[$ref[0] === 'e' ? 'easy' : 'hard'][(int)substr($ref, 1)] ?? null;
    return $row ? array_combine(PB_LANGS, $row) : null;
}

function proibitaEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $g['card'] = null;
    $g['ends_at'] = null;
    $a = $g['score']['A']; $b = $g['score']['B'];
    $rows = [];
    foreach (['A', 'B'] as $t) {
        foreach ($g['teams'][$t] as $p) {
            if (in_array($p, $g['gone'], true)) continue;
            $rows[] = ['p' => $p, 'team' => $t, 'ok' => $g['stats'][(string)$p]['ok'], 'buzz' => $g['stats'][(string)$p]['buzz']];
        }
    }
    $g['result'] = ['reason' => $reason, 'turns' => $g['turn'] + ($reason === 'done' ? 1 : 0), 'score' => $g['score'],
                    'winner' => $a === $b ? null : ($a > $b ? 'A' : 'B'), 'rows' => $rows];
    proibitaEvent($g, ['t' => 'end']);
}

/** Draws a card that has not been used (the pile starts again when it is used up). Counts a new card for the clients. */
function proibitaDraw(array &$g): void {
    $bank = proibitaBank();
    $kinds = $g['rules']['level'] === 'mix' ? ['easy', 'hard'] : [$g['rules']['level']];
    $k = $kinds[random_int(0, count($kinds) - 1)];
    $pre = $k[0];
    $free = array_values(array_filter(array_keys($bank[$k]), fn($i) => !in_array("$pre$i", $g['used'], true)));
    if (!$free) {
        $g['used'] = array_values(array_filter($g['used'], fn($u) => $u[0] !== $pre));
        $free = array_keys($bank[$k]);
    }
    $i = $free[random_int(0, count($free) - 1)];
    $g['used'][] = "$pre$i";
    $g['card'] = "$pre$i";
    $g['card_n']++;
}

/** Prepares a turn: who gives the clues, who guards. False when a team has nobody left (the match is over). */
function proibitaAssign(array &$g): bool {
    $t = proibitaTeam($g);
    $mine = proibitaMembers($g, $t);
    $opp = proibitaMembers($g, proibitaOther($t));
    if (!$mine || !$opp) { proibitaEnd($g, 'too_few'); return false; }
    $k = intdiv($g['turn'], 2);   // the n-th turn of this team: the roles rotate inside both teams
    $g['giver'] = $mine[$k % count($mine)];
    $g['guardian'] = $opp[$k % count($opp)];
    return true;
}

function proibitaStartTurn(array &$g): void {
    $g['phase'] = 'ready';
    $g['card'] = null;
    $g['ends_at'] = null;
    $g['next_at'] = null;
    $g['passes_left'] = PB_SKIPS;
    $g['log'] = [];
    $g['turn_pts'] = 0;
    if (!proibitaAssign($g)) return;
    proibitaEvent($g, ['t' => 'turn', 'team' => proibitaTeam($g), 'p' => $g['giver'], 'q' => $g['guardian']]);
}

function proibitaBegin(array &$g, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $g['phase'] = 'play';
    $g['ends_at'] = $now + (int)$g['rules']['time'];
    proibitaDraw($g);
    proibitaEvent($g, ['t' => 'begin']);
}

/** Closes the turn (time up, or one of the two main players left): shows what happened, then moves on. */
function proibitaEndTurn(array &$g, string $why, ?float $now = null): void {
    $now = $now ?? microtime(true);
    if ($g['card'] !== null) $g['log'][] = ['c' => $g['card'], 'r' => 'time'];
    $g['card'] = null;
    $g['ends_at'] = null;
    $g['phase'] = 'turn_end';
    $g['next_at'] = $now + PB_REVIEW_SECONDS;
    proibitaEvent($g, ['t' => $why, 'team' => proibitaTeam($g), 'n' => $g['turn_pts']]);
}

function proibitaNext(array &$g): void {
    if ($g['turn'] + 1 >= proibitaTotalTurns($g)) { proibitaEnd($g, 'done'); return; }
    $g['turn']++;
    proibitaStartTurn($g);
}

/** Advances the clock-driven parts. Returns true when the state changed (the caller saves it). */
function proibitaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'play' && $now >= $g['ends_at']) { proibitaEndTurn($g, 'time', $now); return true; }
    if ($g['phase'] === 'turn_end' && $now >= $g['next_at']) { proibitaNext($g); return true; }
    return false;
}

function proibitaStart(PDO $db, array $room): ?string {
    $s = proibitaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    $devices = count(array_unique(array_map(fn($p) => (int)$p['device_id'], $players)));
    if (count($players) < ($devices > 1 ? 4 : 2)) return 'need_players_proibita';
    $bank = proibitaBank();
    if (empty($bank['easy']) || empty($bank['hard'])) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    shuffle($order);
    $half = intdiv(count($order) + 1, 2);
    $prev = proibitaLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'ready', 'rules' => $s,
        'teams' => ['A' => array_slice($order, 0, $half), 'B' => array_slice($order, $half)], 'gone' => [],
        'stats' => array_fill_keys(array_map('strval', $order), ['ok' => 0, 'buzz' => 0]),
        'score' => ['A' => 0, 'B' => 0], 'turn' => 0, 'turn_pts' => 0, 'giver' => null, 'guardian' => null,
        'card' => null, 'card_n' => (int)($prev['card_n'] ?? 0), 'used' => $prev['used'] ?? [], 'passes_left' => PB_SKIPS, 'log' => [],
        'ends_at' => null, 'next_at' => null, 'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    proibitaEvent($g, ['t' => 'start']);
    proibitaStartTurn($g);
    proibitaSave($db, (int)$room['id'], $g);
    return null;
}

function proibitaPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || in_array($pid, $g['gone'], true) || !in_array($pid, array_merge($g['teams']['A'], $g['teams']['B']), true)) return;
    $g['gone'][] = $pid;
    proibitaEvent($g, ['t' => 'left', 'p' => $pid]);
    if ($g['phase'] === 'ready') { proibitaAssign($g); return; }
    if ($g['phase'] === 'play' && ($pid === (int)$g['giver'] || $pid === (int)$g['guardian'])) { proibitaEndTurn($g, 'time'); return; }
    if (!proibitaMembers($g, 'A') || !proibitaMembers($g, 'B')) proibitaEnd($g, 'too_few');
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function proibitaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = proibitaLoad($db, (int)$room['id']);
    if ($g && proibitaTick($g)) proibitaSave($db, (int)$room['id'], $g);
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
            $new = proibitaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return proibitaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            proibitaEnd($g, 'host_ended');
            break;
        case 'next':   // the host skips the wait after a turn, or a turn nobody wants to start
            if (!$isHost) return 'host_only';
            if (!$playing || !in_array($g['phase'], ['ready', 'turn_end'], true)) return 'not_now';
            proibitaNext($g);
            break;
        case 'begin':
            if (!$playing || $g['phase'] !== 'ready') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if (!($pid !== null && $pid === (int)$g['giver']) && !$isHost) return $pid === null ? 'not_your_player' : 'not_giver';
            proibitaBegin($g);
            break;
        case 'right':
        case 'skip':
            if (!$playing || $g['phase'] !== 'play') return 'not_now';   // the time may have just run out: the tick above already closed the turn
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['giver']) return 'not_giver';
            if ((int)($in['n'] ?? -1) !== (int)$g['card_n']) return 'not_now';   // a double tap or a late answer for an old card
            if ($action === 'skip') {
                if ($g['passes_left'] < 1) return 'no_skips';
                $g['passes_left']--;
            } else {
                $g['score'][proibitaTeam($g)]++;
                $g['turn_pts']++;
                $g['stats'][(string)$pid]['ok']++;
            }
            $g['log'][] = ['c' => $g['card'], 'r' => $action === 'skip' ? 'skip' : 'ok'];
            proibitaEvent($g, ['t' => $action === 'skip' ? 'skip' : 'ok', 'p' => $pid]);
            proibitaDraw($g);
            break;
        case 'buzz':
            if (!$playing || $g['phase'] !== 'play') return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if ($pid !== (int)$g['guardian']) return 'not_guardian';
            if ((int)($in['n'] ?? -1) !== (int)$g['card_n']) return 'not_now';
            $g['score'][proibitaTeam($g)]--;
            $g['turn_pts']--;
            $g['stats'][(string)$pid]['buzz']++;
            $g['log'][] = ['c' => $g['card'], 'r' => 'buzz'];
            proibitaEvent($g, ['t' => 'buzz', 'p' => $pid]);
            proibitaDraw($g);
            break;
        default:
            return null;
    }
    proibitaSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The card only reaches a phone that owns the clue-giver or the guardian (and the admin LIVE panel). */
function proibitaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'proibita';
    $view['settings'] = proibitaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = proibitaLoad($db, (int)$room['id']);
    $view['proibita'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $all = array_merge($g['teams']['A'], $g['teams']['B']);
    $me = [];
    foreach (array_values(array_intersect($mine, $all)) as $pid) {
        $me[] = ['player_id' => $pid, 'team' => in_array($pid, $g['teams']['A'], true) ? 'A' : 'B',
                 'giver' => $g['status'] === 'play' && (int)$g['giver'] === $pid, 'guardian' => $g['status'] === 'play' && (int)$g['guardian'] === $pid];
    }
    $sees = $g['phase'] === 'play' && ($me && array_filter($me, fn($m) => $m['giver'] || $m['guardian']));
    $reveal = $g['phase'] === 'turn_end';
    $view['proibita'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'],
        'turn' => $g['turn'], 'turns' => proibitaTotalTurns($g), 'team' => proibitaTeam($g),
        'rules' => $g['rules'], 'teams' => $g['teams'], 'gone' => $g['gone'], 'score' => $g['score'],
        'giver' => $g['status'] === 'play' ? $g['giver'] : null, 'guardian' => $g['status'] === 'play' ? $g['guardian'] : null,
        'skips_left' => $g['passes_left'], 'card_n' => $g['card_n'], 'turn_pts' => $g['turn_pts'],
        'ends_at' => $g['phase'] === 'play' ? round($g['ends_at'], 1) : null,
        'left' => $g['phase'] === 'play' ? max(0, round($g['ends_at'] - $now, 1)) : null,
        'next_left' => $g['phase'] === 'turn_end' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'card' => $sees ? ['text' => proibitaCard($g['card'])] : null,
        // after the turn the words that came up are shown to everybody (the forbidden ones never are)
        'log' => $reveal ? array_map(fn($l) => ['r' => $l['r'], 'word' => array_map(fn($c) => $c[0], proibitaCard($l['c']) ?? [])], $g['log']) : [],
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: teams, score, roles and the current card (Italian text). */
function proibitaLiveInfo(PDO $db, int $roomId): ?array {
    $g = proibitaLoad($db, $roomId);
    if (!$g) return null;
    $c = $g['phase'] === 'play' ? proibitaCard($g['card']) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'turn' => $g['turn'] + 1, 'turns' => proibitaTotalTurns($g), 'team' => proibitaTeam($g),
        'teams' => $g['teams'], 'score' => $g['score'], 'giver' => $g['status'] === 'play' ? $g['giver'] : null,
        'guardian' => $g['status'] === 'play' ? $g['guardian'] : null, 'skips_left' => $g['passes_left'],
        'word' => $c ? $c['it'][0] : null, 'taboo' => $c ? array_slice($c['it'], 1) : [],
    ];
}
