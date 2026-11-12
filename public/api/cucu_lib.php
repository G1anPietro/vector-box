<?php
// public/api/cucu_lib.php — "Cucù" with the house rules, on the shared rooms of spia.php (game "cucu").
// One JSON state per room (table cucu_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// Italian 40-card deck (suits d/c/s/b = denari/coppe/spade/bastoni, ranks 1-10: 8 Fante, 9 Cavallo, 10 Re).
// Hand: recite (the new dealer says everyone's lives aloud; the host = "capotavola" judges right/wrong; wrong ->
// the dealer loses a life and the deck passes on) -> deal -> knock (cards stay hidden until the dealer knocks
// twice) -> swap (from the player after the dealer: keep, or swap with the next player; a King blocks it; the
// dealer last may swap with the deck) -> reveal (lowest card loses; ties draw again until one is lowest) ->
// confirm (the host confirms who loses the life) -> next dealer.
// Lives are never shown to the players (they remember them): only to the host while judging a recital, and to the
// site admin in the LIVE view. Every life change is an event shown on every phone. Living players who talk to the
// dead (the dealer excepted) are reported by the host: living -1, dead +1.

const CUCU_MIN_PLAYERS = 2;
const CUCU_SUITS = ['d', 'c', 's', 'b'];
const CUCU_KING = 10;
const CUCU_HORSE = 9;

function cucuDefaultSettings(): array {
    return [
        'lives'          => 3,      // lives at the start (remembered by heart)
        'cavallo_salta'  => false,  // optional power: a Cavallo can't be asked to swap, the request skips to the next
        're_mazzo_perde' => false,  // optional power: the dealer who draws a King from the deck loses the hand
        'admin_power'    => false,  // declared, visible to all: the site admin may change their card once per hand
        'scores'         => false,
    ];
}

function cucuSanitizeSettings(array $in, array $base): array {
    $s = array_merge(cucuDefaultSettings(), array_intersect_key($base, cucuDefaultSettings()));
    $bool = fn($v, $def) => is_bool($v) ? $v : (is_numeric($v) ? (bool)(int)$v : $def);
    $s['lives'] = is_numeric($in['lives'] ?? null) ? max(1, min(9, (int)$in['lives'])) : (int)$s['lives'];
    foreach (['cavallo_salta', 're_mazzo_perde', 'admin_power', 'scores'] as $k) $s[$k] = $bool($in[$k] ?? $s[$k], (bool)$s[$k]);
    return $s;
}

function cucuLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM cucu_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function cucuSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO cucu_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

/** Events are what every phone shows (and buzzes for): never secret information. */
function cucuEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $ev['hand'] = $g['hand'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function cucuAlive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => ($g['lives'][(string)$p] ?? 0) > 0));
}

function cucuIsAlive(array $g, int $pid): bool {
    return ($g['lives'][(string)$pid] ?? 0) > 0;
}

/** Next living player after $pid in seating order (wraps around); $pid itself if nobody else is alive. */
function cucuNext(array $g, int $pid): int {
    $order = $g['order'];
    $i = array_search($pid, $order, true);
    $n = count($order);
    for ($k = 1; $k <= $n; $k++) {
        $p = $order[(($i === false ? -1 : $i) + $k) % $n];
        if (cucuIsAlive($g, $p)) return $p;
    }
    return $pid;
}

function cucuNewDeck(array $exclude = []): array {
    $taken = array_flip(array_map(fn($c) => $c[0] . $c[1], $exclude));
    $deck = [];
    foreach (CUCU_SUITS as $s) for ($r = 1; $r <= 10; $r++) if (!isset($taken[$s . $r])) $deck[] = [$s, $r];
    return spiaShuffle($deck);
}

function cucuDraw(array &$g): array {
    if (!$g['deck']) $g['deck'] = cucuNewDeck(array_values($g['cards']));
    return array_pop($g['deck']);
}

function cucuStart(PDO $db, array $room): ?string {
    $s = cucuSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < CUCU_MIN_PLAYERS) return 'need_players_cucu';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = cucuLoad($db, (int)$room['id']);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1,
        'status' => 'play',
        'rules' => $s,
        'order' => $order,
        'lives' => array_fill_keys(array_map('strval', $order), $s['lives']),
        'hand' => 1,
        'dealer' => $order[array_rand($order)],
        'phase' => 'recite',
        'knocks' => 0,
        'cards' => [],
        'deck' => [],
        'turn' => null,
        'admin_used' => false,
        'reveal' => null,
        'events' => [],
        'event_seq' => (int)($prev['event_seq'] ?? 0),
        'result' => null,
    ];
    cucuEvent($g, ['t' => 'start']);
    cucuEvent($g, ['t' => 'dealer', 'p' => $g['dealer']]);
    cucuSave($db, (int)$room['id'], $g);
    return null;
}

function cucuEnd(array &$g, ?int $winner, string $reason): void {
    $g['status'] = 'ended';
    $g['phase'] = 'ended';
    $g['turn'] = null;
    $g['result'] = ['winner' => $winner, 'reason' => $reason, 'lives' => $g['lives']];
    cucuEvent($g, ['t' => 'end', 'p' => $winner, 'why' => $reason]);
}

/** Change one player's lives, with the events everybody sees; ends the match when one player is left. */
function cucuLife(array &$g, int $pid, int $delta, string $why): void {
    $k = (string)$pid;
    if (!isset($g['lives'][$k]) || $g['status'] !== 'play') return;
    $before = $g['lives'][$k];
    $g['lives'][$k] = max(0, $before + $delta);
    cucuEvent($g, ['t' => 'life', 'p' => $pid, 'd' => $delta, 'why' => $why]);
    if ($before > 0 && $g['lives'][$k] === 0) {
        cucuEvent($g, ['t' => 'dead', 'p' => $pid]);
        unset($g['cards'][$k]);
    }
    if ($before === 0 && $g['lives'][$k] > 0) cucuEvent($g, ['t' => 'back', 'p' => $pid]);
    $alive = cucuAlive($g);
    if (count($alive) <= 1) cucuEnd($g, $alive[0] ?? null, 'last_alive');
}

function cucuDeal(array &$g): void {
    $g['deck'] = cucuNewDeck();
    $g['cards'] = [];
    foreach (cucuAlive($g) as $p) $g['cards'][(string)$p] = array_pop($g['deck']);
    $g['phase'] = 'knock';
    $g['knocks'] = 0;
    $g['turn'] = null;
    $g['admin_used'] = false;
    $g['reveal'] = null;
    cucuEvent($g, ['t' => 'deal', 'p' => $g['dealer']]);
}

function cucuNextHand(array &$g, bool $passDeck = true): void {
    if ($g['status'] !== 'play') return;
    if ($passDeck || !cucuIsAlive($g, $g['dealer'])) $g['dealer'] = cucuNext($g, $g['dealer']);
    $g['hand']++;
    $g['phase'] = 'recite';
    $g['cards'] = [];
    $g['turn'] = null;
    $g['reveal'] = null;
    cucuEvent($g, ['t' => 'dealer', 'p' => $g['dealer']]);
}

/** Lowest card loses; tied players draw again until exactly one is lowest. */
function cucuReveal(array &$g): void {
    $g['phase'] = 'confirm';
    $g['turn'] = null;
    $redraws = [];
    $rank = fn($p) => $g['cards'][(string)$p][1];
    $alive = array_values(array_filter(cucuAlive($g), fn($p) => isset($g['cards'][(string)$p])));
    $forced = $g['reveal']['forced'] ?? null;   // dealer who drew a King with "re_mazzo_perde"
    $loser = $forced;
    if ($loser === null && $alive) {
        $tied = $alive;
        $min = min(array_map($rank, $tied));
        $tied = array_values(array_filter($tied, fn($p) => $rank($p) === $min));
        for ($guard = 0; count($tied) > 1 && $guard < 20; $guard++) {
            $round = [];
            foreach ($tied as $p) { $c = cucuDraw($g); $round[(string)$p] = $c; }
            $redraws[] = $round;
            $min = min(array_map(fn($p) => $round[(string)$p][1], $tied));
            $tied = array_values(array_filter($tied, fn($p) => $round[(string)$p][1] === $min));
        }
        $loser = $tied[0];
    }
    $g['reveal'] = ['cards' => $g['cards'], 'redraws' => $redraws, 'loser' => $loser, 'forced' => $forced];
    cucuEvent($g, ['t' => 'reveal', 'p' => $loser, 'redraws' => count($redraws)]);
}

/** After a turn in the swap phase: the next player, or the dealer's deck choice, or the reveal. */
function cucuAdvance(array &$g, int $pid): void {
    if ($pid === $g['dealer']) { cucuReveal($g); return; }
    $g['turn'] = cucuNext($g, $pid);
}

function cucuPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !isset($g['lives'][(string)$pid])) return;
    $wasTurn = $g['turn'] === $pid;
    $wasDealer = $g['dealer'] === $pid;
    $g['lives'][(string)$pid] = 0;
    unset($g['cards'][(string)$pid]);
    cucuEvent($g, ['t' => 'left', 'p' => $pid]);
    $alive = cucuAlive($g);
    if (count($alive) <= 1) { cucuEnd($g, $alive[0] ?? null, 'last_alive'); return; }
    if ($wasDealer) { cucuNextHand($g); return; }
    if ($wasTurn) $g['turn'] = cucuNext($g, $pid);
}

function cucuCardName(array $c): string {
    $names = [8 => 'Fante', 9 => 'Cavallo', 10 => 'Re'];
    return ($names[$c[1]] ?? (string)$c[1]) . ' ' . ['d' => 'denari', 'c' => 'coppe', 's' => 'spade', 'b' => 'bastoni'][$c[0]];
}

/**
 * Room actions for Cucù. Returns true (handled), null (not a Cucù action) or an error code.
 * $siteAdmin: the session is a site admin (for the declared admin power only).
 */
function cucuHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action, bool $siteAdmin) {
    $g = cucuLoad($db, (int)$room['id']);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };
    $pidIn = (int)($in['player_id'] ?? 0);

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            $new = cucuSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], json_decode($room['settings'], true) ?: []);
            $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($new), ':id' => $room['id']]);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return cucuStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            cucuEnd($g, null, 'host_ended');
            break;

        // --- the host (capotavola) ---
        case 'recite':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'recite') return 'not_now';
            if (!empty($in['ok'])) {
                cucuEvent($g, ['t' => 'recite_ok', 'p' => $g['dealer']]);
                cucuDeal($g);
            } else {
                $dealer = $g['dealer'];
                cucuEvent($g, ['t' => 'recite_wrong', 'p' => $dealer]);
                cucuLife($g, $dealer, -1, 'recite');
                cucuNextHand($g);   // the deck passes to the next player, who recites in turn
                $g['hand']--;       // still the same hand: nobody has played it yet
            }
            break;
        case 'confirm':
            if (!$isHost) return 'host_only';
            if (!$playing || $g['phase'] !== 'confirm') return 'not_now';
            $loser = $pidIn ?: (int)($g['reveal']['loser'] ?? 0);
            if (!cucuIsAlive($g, $loser)) return 'bad_target';
            cucuLife($g, $loser, -1, 'hand');
            cucuNextHand($g);
            break;
        case 'life':
            if (!$isHost) return 'host_only';
            if (!$playing || !isset($g['lives'][(string)$pidIn])) return 'bad_target';
            cucuLife($g, $pidIn, ((int)($in['delta'] ?? -1)) > 0 ? 1 : -1, 'host');
            break;
        case 'talk':
            // a living player talked to a dead one: living -1, dead +1 (the dealer may talk to the dead)
            if (!$isHost) return 'host_only';
            $living = $pidIn;
            $dead = (int)($in['dead_id'] ?? 0);
            if (!$playing || !cucuIsAlive($g, $living) || !isset($g['lives'][(string)$dead]) || cucuIsAlive($g, $dead)) return 'bad_target';
            if ($living === $g['dealer']) return 'dealer_may_talk';
            cucuEvent($g, ['t' => 'talk', 'p' => $living, 'q' => $dead]);
            cucuLife($g, $dead, 1, 'talk');
            cucuLife($g, $living, -1, 'talk');
            break;

        // --- players ---
        case 'knock':
            if (!$playing || $g['phase'] !== 'knock') return 'not_now';
            if ($own($g['dealer']) === null) return 'not_your_player';
            $g['knocks']++;
            cucuEvent($g, ['t' => 'knock', 'n' => $g['knocks']]);
            if ($g['knocks'] >= 2) {
                $g['phase'] = 'swap';
                $g['turn'] = cucuNext($g, $g['dealer']);
            }
            break;
        case 'keep':
        case 'swap':
        case 'deck':
            if (!$playing || $g['phase'] !== 'swap') return 'not_now';
            $pid = $g['turn'];
            if ($pid === null || $own($pid) === null) return 'not_your_turn';
            $isDealer = $pid === $g['dealer'];
            if ($action === 'keep') {
                cucuEvent($g, ['t' => 'keep', 'p' => $pid]);
            } elseif ($action === 'deck') {
                if (!$isDealer) return 'not_now';
                $c = cucuDraw($g);
                $g['cards'][(string)$pid] = $c;
                cucuEvent($g, ['t' => 'deck', 'p' => $pid]);
                if (!empty($g['rules']['re_mazzo_perde']) && $c[1] === CUCU_KING) {
                    cucuEvent($g, ['t' => 'deck_king', 'p' => $pid]);
                    $g['reveal'] = ['forced' => $pid];
                }
            } else {
                if ($isDealer) return 'not_now';
                $target = cucuNext($g, $pid);
                if (!empty($g['rules']['cavallo_salta']) && $g['cards'][(string)$target][1] === CUCU_HORSE && $target !== $g['dealer']) {
                    cucuEvent($g, ['t' => 'horse', 'p' => $target]);
                    $target = cucuNext($g, $target);
                }
                if ($target === $pid) {
                    cucuEvent($g, ['t' => 'keep', 'p' => $pid]);
                } elseif ($g['cards'][(string)$target][1] === CUCU_KING) {
                    cucuEvent($g, ['t' => 'cucu', 'p' => $target, 'q' => $pid]);   // "Cucù!": the King stops the swap
                } else {
                    $a = $g['cards'][(string)$pid];
                    $g['cards'][(string)$pid] = $g['cards'][(string)$target];
                    $g['cards'][(string)$target] = $a;
                    cucuEvent($g, ['t' => 'swap', 'p' => $pid, 'q' => $target]);
                }
            }
            cucuAdvance($g, $pid);
            break;
        case 'admin_power':
            // Declared in the room settings and announced to everybody when used
            if (!$playing || $g['phase'] !== 'swap' || empty($g['rules']['admin_power']) || !$siteAdmin || $g['admin_used']) return 'not_now';
            $pid = $own($pidIn);
            if ($pid === null || !cucuIsAlive($g, $pid)) return 'not_your_player';
            $others = array_filter($g['cards'], fn($c, $p) => (int)$p !== $pid, ARRAY_FILTER_USE_BOTH);
            $low = $others ? min(array_map(fn($c) => $c[1], $others)) : 0;
            $pick = null;
            foreach ($g['deck'] as $i => $c) if ($c[1] > $low && ($pick === null || $c[1] < $g['deck'][$pick][1])) $pick = $i;
            if ($pick === null) return 'not_now';
            $g['cards'][(string)$pid] = $g['deck'][$pick];
            array_splice($g['deck'], $pick, 1);
            $g['admin_used'] = true;
            cucuEvent($g, ['t' => 'admin_power', 'p' => $pid]);
            break;
        default:
            return null;
    }
    $wasPlaying = $playing;
    cucuSave($db, (int)$room['id'], $g);
    if ($wasPlaying && $g['status'] === 'ended' && !empty($g['rules']['scores']) && !empty($g['result']['winner'])) {
        $db->prepare('UPDATE spia_players SET score = score + 1 WHERE id = :p')->execute([':p' => $g['result']['winner']]);
    }
    return true;
}

/** What one phone may see. Lives: only the host while judging a recital, and everybody once the match is over. */
function cucuView(PDO $db, array $room, array $device, bool $adminSession): array {
    $isHost = (int)$room['host_device_id'] === (int)$device['id'];
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'cucu';
    $view['settings'] = cucuSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $g = cucuLoad($db, (int)$room['id']);
    $view['cucu'] = null;
    if (!$g) return $view;

    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $cardsOpen = in_array($g['phase'], ['swap'], true);
    $ended = $g['status'] === 'ended';
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $me[] = [
            'player_id' => $pid,
            'alive' => cucuIsAlive($g, $pid),
            'card' => $cardsOpen && isset($g['cards'][(string)$pid]) ? $g['cards'][(string)$pid] : null,
            'can_admin_power' => $cardsOpen && $adminSession && !empty($g['rules']['admin_power']) && !$g['admin_used'] && cucuIsAlive($g, $pid),
        ];
    }
    $view['cucu'] = [
        'match' => $g['match'],
        'status' => $g['status'],
        'phase' => $g['phase'],
        'hand' => $g['hand'],
        'dealer' => $g['dealer'],
        'order' => $g['order'],
        'alive' => cucuAlive($g),
        'knocks' => $g['knocks'],
        'turn' => $g['turn'],
        'rules' => $g['rules'],
        'in_hand' => array_map('intval', array_keys($g['cards'])),
        'reveal' => in_array($g['phase'], ['confirm'], true) ? $g['reveal'] : null,
        'events' => $g['events'],
        'result' => $g['result'],
        'lives' => ($isHost && $g['phase'] === 'recite') || $ended ? $g['lives'] : null,
        'me' => $me,
    ];
    return $view;
}

function cucuLiveInfo(PDO $db, int $roomId): ?array {
    $g = cucuLoad($db, $roomId);
    if (!$g) return null;
    return ['status' => $g['status'], 'phase' => $g['phase'], 'hand' => $g['hand'], 'dealer' => $g['dealer'],
            'lives' => $g['lives'], 'cards' => $g['cards'], 'turn' => $g['turn']];
}
