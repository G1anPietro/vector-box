<?php
// public/api/scommessa_lib.php — "Scommessa tra amici" (bet buddy), on the shared rooms of spia.php (game "scommessa").
// One JSON state per room (table scommessa_games), changed inside the caller's BEGIN IMMEDIATE transaction.
// NO MONEY: only made-up chips (everybody starts with 10) and light challenges from lib/scommessa-q.json.
//
// Each round the "challenger" (the seating order, shuffled once, goes round and round, players with no chips are skipped) sees a
// challenge card nobody else sees, picks the "bettor" (the target of the bet) and a stake of 1/2/3 chips. The target ACCEPTS or REFUSES
// (refusing costs 1 chip, paid to the challenger). If accepted, they do it live and press "done"; the jury (everybody except challenger and
// target) votes done / failed in secret and the SERVER judges: failed only if strictly more "failed" than "done" (a tie = done).
// Done: the target wins the stake from the challenger; failed: the challenger wins it from the target. The jury may also bet 1 chip on the
// verdict (won or lost against the bank). Chips never go below 0; a player at 0 sits out (can still judge). Rows: [cat, it, en, es, fr, de],
// cat 0 easy at home | 1 in company | 2 movement | 3 mind.

const SCOMMESSA_MIN_PLAYERS = 3;
const SCOMMESSA_START_CHIPS = 10;
const SCOMMESSA_VOTE_SECONDS = 40;
const SCOMMESSA_REVEAL_SECONDS = 9;
const SCOMMESSA_LANGS = ['it', 'en', 'es', 'fr', 'de'];
const SCOMMESSA_CATS = ['easy' => 0, 'company' => 1, 'move' => 2, 'mind' => 3];

function scommessaDefaultSettings(): array {
    return ['rounds' => 10, 'easy' => true, 'company' => true, 'move' => true, 'mind' => true];
}

function scommessaSanitizeSettings(array $in, array $base): array {
    $s = array_merge(scommessaDefaultSettings(), array_intersect_key($base, scommessaDefaultSettings()));
    if (isset($in['rounds']) && in_array($in['rounds'], [6, 10, 15], true)) $s['rounds'] = $in['rounds'];
    foreach (array_keys(SCOMMESSA_CATS) as $k) {
        if (isset($in[$k]) && is_bool($in[$k])) $s[$k] = $in[$k];
        else $s[$k] = (bool)$s[$k];
    }
    if (!array_filter(array_intersect_key($s, SCOMMESSA_CATS))) $s['easy'] = true;   // at least one category
    return $s;
}

function scommessaBank(): array {
    static $bank = null;
    if ($bank === null) $bank = json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/scommessa-q.json'), true) ?: [];
    return $bank;
}

function scommessaLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM scommessa_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function scommessaSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO scommessa_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function scommessaEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['round'] = $g['ri'] + 1;
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function scommessaPresent(array $g): array {
    return array_values(array_diff($g['order'], $g['gone']));
}

/** Present players who still have chips: the only ones who can challenge, be challenged or bet. */
function scommessaActive(array $g): array {
    return array_values(array_filter(scommessaPresent($g), fn($p) => $g['chips'][(string)$p] > 0));
}

/** The jury: everybody present except the challenger and the target (players with no chips judge too). */
function scommessaJury(array $g): array {
    return array_values(array_filter(scommessaPresent($g), fn($p) => $p !== (int)$g['cur'] && $p !== (int)$g['target']));
}

function scommessaTitles(array $g): array {
    $out = [];
    foreach (['brave' => 'acc', 'ace' => 'succ', 'gambler' => 'bw', 'careful' => 'ref'] as $title => $f) {
        $best = 0;
        foreach (scommessaPresent($g) as $p) $best = max($best, $g['stats'][(string)$p][$f]);
        if ($best > 0) $out[] = ['k' => $title, 'ps' => array_values(array_filter(scommessaPresent($g), fn($p) => $g['stats'][(string)$p][$f] === $best))];
    }
    return $out;
}

function scommessaEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $rows = [];
    foreach (scommessaPresent($g) as $p) {
        $s = $g['stats'][(string)$p];
        $rows[] = ['p' => $p, 'chips' => $g['chips'][(string)$p], 'acc' => $s['acc'], 'ref' => $s['ref'], 'succ' => $s['succ']];
    }
    usort($rows, fn($a, $b) => $b['chips'] <=> $a['chips']);
    $top = $rows ? $rows[0]['chips'] : 0;
    $g['result'] = ['reason' => $reason, 'rounds' => $g['ri'], 'rows' => $rows, 'titles' => scommessaTitles($g),
                    'winners' => array_values(array_map(fn($r) => $r['p'], array_filter($rows, fn($r) => $r['chips'] === $top)))];
    scommessaEvent($g, ['t' => 'end']);
}

/** Draw a challenge from the enabled categories, never twice in a match until the pile is used up. */
function scommessaDraw(array &$g): void {
    $bank = scommessaBank();
    $cats = [];
    foreach (SCOMMESSA_CATS as $name => $c) if (!empty($g['rules'][$name])) $cats[] = $c;
    $used = $g['used'] ?? [];
    $free = fn() => array_values(array_filter(array_keys($bank), fn($i) => in_array($bank[$i][0], $cats, true) && !in_array($i, $used, true)));
    $cands = $free();
    if (!$cands) {
        $used = array_values(array_filter($used, fn($i) => !in_array($bank[$i][0] ?? -1, $cats, true)));
        $cands = $free();
    }
    if (!$cands) $cands = array_keys($bank);
    $i = $cands[random_int(0, count($cands) - 1)];
    $used[] = $i;
    $g['used'] = $used;
    $g['card'] = $i;
}

function scommessaBeginRound(array &$g): void {
    if ($g['ri'] >= $g['rules']['rounds']) { scommessaEnd($g, 'finished'); return; }
    if (count(scommessaActive($g)) < 2) { scommessaEnd($g, 'broke'); return; }
    $n = count($g['seq']);
    do { $g['qi'] = ($g['qi'] + 1) % $n; $c = $g['seq'][$g['qi']]; } while (!in_array($c, scommessaActive($g), true));
    $g['cur'] = $c;
    $g['target'] = null;
    $g['stake'] = 0;
    $g['phase'] = 'pick';
    $g['swapped'] = false;
    $g['accepted'] = false;
    $g['bets'] = [];
    $g['votes'] = [];
    $g['deadline'] = null;
    $g['reveal'] = null;
    $g['next_at'] = null;
    scommessaDraw($g);
    scommessaEvent($g, ['t' => 'round', 'p' => $c]);
}

function scommessaNextRound(array &$g): void {
    $g['ri']++;
    scommessaBeginRound($g);
}

/** A round that cannot go on (somebody left, host skip): nothing changes, the next round starts. */
function scommessaVoid(array &$g, string $why): void {
    scommessaEvent($g, ['t' => $why, 'p' => $g['cur']]);
    scommessaNextRound($g);
}

function scommessaTake(array &$g, int $from, int $to, int $n): int {
    $n = max(0, min($n, $g['chips'][(string)$from]));
    $g['chips'][(string)$from] -= $n;
    $g['chips'][(string)$to] += $n;
    return $n;
}

/** Settle the round: 'refused', or the jury's verdict (done / failed). Chips never go below 0. */
function scommessaResolve(array &$g, string $how, ?float $now = null): void {
    $now = $now ?? microtime(true);
    $c = (int)$g['cur'];
    $t = (int)$g['target'];
    $n = ['ok' => 0, 'no' => 0];
    $bets = [];
    if ($how === 'refused') {
        $amt = scommessaTake($g, $t, $c, 1);
        $g['stats'][(string)$t]['ref']++;
        $result = 'refused';
    } else {
        $jury = scommessaJury($g);
        foreach ($g['votes'] as $pid => $v) if (in_array((int)$pid, $jury, true) && isset($n[$v])) $n[$v]++;
        $success = $n['ok'] >= $n['no'];   // a tie (or no vote) counts as done
        if ($success) { $amt = scommessaTake($g, $c, $t, $g['stake']); $g['stats'][(string)$t]['succ']++; }
        else $amt = scommessaTake($g, $t, $c, $g['stake']);
        $result = $success ? 'done' : 'failed';
        foreach ($g['bets'] as $pid => $v) {
            $win = ($v === 'ok') === $success;
            if ($win) { $g['chips'][$pid]++; $g['stats'][$pid]['bw']++; }
            else $g['chips'][$pid] = max(0, $g['chips'][$pid] - 1);
            $bets[] = ['p' => (int)$pid, 'v' => $v, 'win' => $win];
        }
    }
    foreach ([$c, $t, ...array_map('intval', array_keys($g['bets']))] as $p) {
        if ($g['chips'][(string)$p] === 0) scommessaEvent($g, ['t' => 'out', 'p' => $p]);
    }
    scommessaEvent($g, ['t' => $result, 'p' => $t, 'q' => $c]);
    $g['reveal'] = ['result' => $result, 'ok' => $n['ok'], 'no' => $n['no'], 'amount' => $amt, 'stake' => $g['stake'], 'bets' => $bets];
    $g['phase'] = 'reveal';
    $g['deadline'] = null;
    $g['next_at'] = $now + SCOMMESSA_REVEAL_SECONDS;
}

function scommessaTick(array &$g, ?float $now = null): bool {
    if ($g['status'] !== 'play') return false;
    $now = $now ?? microtime(true);
    if ($g['phase'] === 'vote') {
        $all = !array_diff(array_map('strval', scommessaJury($g)), array_keys($g['votes']));
        if ($now >= $g['deadline'] || $all) { scommessaResolve($g, 'verdict', $now); return true; }
    } elseif ($g['phase'] === 'reveal' && $now >= $g['next_at']) {
        scommessaNextRound($g);
        return true;
    }
    return false;
}

function scommessaStart(PDO $db, array $room): ?string {
    $s = scommessaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < SCOMMESSA_MIN_PLAYERS) return 'need_players_scommessa';
    if (!scommessaBank()) return 'no_questions';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $seq = $order;
    shuffle($seq);
    $prev = scommessaLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play', 'phase' => 'pick', 'rules' => $s, 'order' => $order, 'gone' => [], 'seq' => $seq, 'qi' => -1, 'ri' => 0,
        'chips' => array_fill_keys(array_map('strval', $order), SCOMMESSA_START_CHIPS),
        'stats' => array_fill_keys(array_map('strval', $order), ['acc' => 0, 'ref' => 0, 'succ' => 0, 'bw' => 0]),
        'cur' => null, 'target' => null, 'stake' => 0, 'card' => null, 'swapped' => false, 'accepted' => false, 'used' => $prev['used'] ?? [],
        'bets' => [], 'votes' => [], 'deadline' => null, 'reveal' => null, 'next_at' => null,
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    scommessaEvent($g, ['t' => 'start']);
    scommessaBeginRound($g);
    scommessaSave($db, (int)$room['id'], $g);
    return null;
}

function scommessaPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    unset($g['votes'][(string)$pid], $g['bets'][(string)$pid]);
    scommessaEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(scommessaPresent($g)) < SCOMMESSA_MIN_PLAYERS) { scommessaEnd($g, 'too_few'); return; }
    if ($g['phase'] !== 'reveal' && ($pid === (int)$g['cur'] || $pid === (int)$g['target'])) scommessaVoid($g, 'void');
    else scommessaTick($g);
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function scommessaHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = scommessaLoad($db, (int)$room['id']);
    if ($g && scommessaTick($g)) scommessaSave($db, (int)$room['id'], $g);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };
    // a given role of the round, on this phone: 'cur' (challenger) or 'target'
    $role = function (string $who) use ($own, $in, &$g, $playing) {
        if (!$playing) return 'not_now';
        $pid = $own($in['player_id'] ?? 0);
        if ($pid === null) return 'not_your_player';
        if ($pid !== (int)$g[$who]) return 'not_your_turn';
        return $pid;
    };
    // a jury member who may still bet
    $placeBet = function (int $pid, $v) use (&$g): ?string {
        if ($v !== 'ok' && $v !== 'no') return 'bad_vote';
        if (isset($g['bets'][(string)$pid])) return 'already_bet';
        if ($g['chips'][(string)$pid] < 1) return 'no_chips';
        $g['bets'][(string)$pid] = $v;
        return null;
    };

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = scommessaSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return scommessaStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            scommessaEnd($g, 'host_ended');
            break;
        case 'next':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'reveal') return 'not_now';
            scommessaNextRound($g);
            break;
        case 'skip':   // host tool: a stuck or absent player, the round is void
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] === 'reveal') return 'not_now';
            scommessaVoid($g, 'skip');
            break;
        case 'swap':
            $pid = $role('cur');
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'pick') return 'not_now';
            if ($g['swapped']) return 'swap_used';
            scommessaDraw($g);
            $g['swapped'] = true;
            scommessaEvent($g, ['t' => 'swap', 'p' => $pid]);
            break;
        case 'pick':
            $pid = $role('cur');
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'pick') return 'not_now';
            $t = (int)($in['target'] ?? 0);
            $stake = $in['stake'] ?? null;
            if ($t === $pid || !in_array($t, scommessaActive($g), true)) return 'bad_target';
            if (!is_int($stake) || $stake < 1 || $stake > min(3, $g['chips'][(string)$pid], $g['chips'][(string)$t])) return 'bad_stake';
            $g['target'] = $t;
            $g['stake'] = $stake;
            $g['phase'] = 'respond';
            unset($g['bets'][(string)$t]);
            scommessaEvent($g, ['t' => 'pick', 'p' => $pid, 'q' => $t, 'n' => $stake]);
            break;
        case 'accept':
        case 'refuse':
            $pid = $role('target');
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'respond') return 'not_now';
            if ($action === 'refuse') { scommessaEvent($g, ['t' => 'refuse', 'p' => $pid]); scommessaResolve($g, 'refused'); break; }
            $g['accepted'] = true;
            $g['stats'][(string)$pid]['acc']++;
            $g['phase'] = 'perform';
            scommessaEvent($g, ['t' => 'accept', 'p' => $pid]);
            break;
        case 'done':
            $pid = $role('target');
            if (is_string($pid)) return $pid;
            if ($g['phase'] !== 'perform') return 'not_now';
            $g['phase'] = 'vote';
            $g['votes'] = [];
            $g['deadline'] = microtime(true) + SCOMMESSA_VOTE_SECONDS;
            scommessaEvent($g, ['t' => 'vote', 'p' => $pid]);
            break;
        case 'bet':
        case 'vote':
            if (!$playing || !in_array($g['phase'], $action === 'bet' ? ['respond', 'perform', 'vote'] : ['vote'], true)) return 'not_now';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, scommessaJury($g), true)) return in_array($pid, [(int)$g['cur'], (int)$g['target']], true) ? 'not_your_turn' : 'you_are_out';
            if (isset($g['votes'][(string)$pid])) return 'already_voted';
            $v = $in['v'] ?? null;
            if ($action === 'bet') {
                if ($e = $placeBet($pid, $v)) return $e;
                scommessaEvent($g, ['t' => 'bet', 'p' => $pid]);
                break;
            }
            if ($v !== 'ok' && $v !== 'no') return 'bad_vote';
            if (microtime(true) > $g['deadline'] + 0.5) return 'not_now';   // half a second of grace for the network
            if (!empty($in['bet']) && !isset($g['bets'][(string)$pid]) && $g['chips'][(string)$pid] > 0) {
                $placeBet($pid, $v);
                scommessaEvent($g, ['t' => 'bet', 'p' => $pid]);
            }
            $g['votes'][(string)$pid] = $v;
            scommessaTick($g);
            break;
        default:
            return null;
    }
    scommessaSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see. The card only to the challenger before the bet is made; never who voted what or what the bets are until the verdict. */
function scommessaView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'scommessa';
    $view['settings'] = scommessaSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = scommessaLoad($db, (int)$room['id']);
    $view['scommessa'] = null;
    if (!$g) return $view;
    $now = microtime(true);
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $playing = $g['status'] === 'play';
    $jury = $playing ? scommessaJury($g) : [];
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $k = (string)$pid;
        $me[] = ['player_id' => $pid, 'active' => !in_array($pid, $g['gone'], true), 'current' => $playing && (int)$g['cur'] === $pid,
                 'target' => $playing && (int)$g['target'] === $pid, 'can_vote' => in_array($pid, $jury, true), 'voted' => isset($g['votes'][$k]),
                 'bet' => $g['bets'][$k] ?? null, 'chips' => $g['chips'][$k]];
    }
    $card = null;
    $seesCard = $g['card'] !== null && $playing && ($g['phase'] !== 'pick' || in_array((int)$g['cur'], $mine, true));
    if ($g['status'] === 'ended' && $g['card'] !== null) $seesCard = false;
    if ($seesCard) {
        $row = scommessaBank()[$g['card']] ?? null;
        $card = $row ? ['cat' => $row[0], 'text' => array_combine(SCOMMESSA_LANGS, array_slice($row, 1))] : null;
    }
    $view['scommessa'] = [
        'match' => $g['match'], 'status' => $g['status'], 'phase' => $g['phase'], 'round' => min($g['ri'] + 1, $g['rules']['rounds']), 'rounds' => $g['rules']['rounds'],
        'order' => $g['order'], 'active' => scommessaActive($g), 'present' => scommessaPresent($g), 'rules' => $g['rules'],
        'cur' => $playing ? $g['cur'] : null, 'target' => $playing ? $g['target'] : null, 'stake' => $playing ? $g['stake'] : 0,
        'card' => $card, 'swapped' => $g['swapped'], 'chips' => $g['chips'],
        'acc' => array_map(fn($s) => $s['acc'], $g['stats']),
        'voted' => array_map('intval', array_keys($g['votes'])), 'betted' => array_map('intval', array_keys($g['bets'])),
        'left' => $g['phase'] === 'vote' ? max(0, round($g['deadline'] - $now, 1)) : null,
        'reveal' => $g['reveal'],
        'next_left' => $g['phase'] === 'reveal' ? max(0, round($g['next_at'] - $now, 1)) : null,
        'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel: everybody's chips, the challenge, and who voted / bet what while the round is open. */
function scommessaLiveInfo(PDO $db, int $roomId): ?array {
    $g = scommessaLoad($db, $roomId);
    if (!$g) return null;
    $row = $g['card'] !== null ? (scommessaBank()[$g['card']] ?? null) : null;
    return [
        'status' => $g['status'], 'phase' => $g['phase'], 'round' => min($g['ri'] + 1, $g['rules']['rounds']), 'rounds' => $g['rules']['rounds'],
        'cur' => $g['status'] === 'play' ? $g['cur'] : null, 'target' => $g['status'] === 'play' ? $g['target'] : null, 'stake' => $g['stake'],
        'card' => $row ? $row[1] : null, 'votes' => $g['votes'], 'bets' => $g['bets'], 'chips' => $g['chips'],
    ];
}
