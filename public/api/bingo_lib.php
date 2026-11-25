<?php
// public/api/bingo_lib.php — "Bingo della lezione" (bingo), on the shared rooms of spia.php (game "bingo").
// One JSON state per room (table bingo_games), changed inside the caller's BEGIN IMMEDIATE transaction.
//
// The room keeps ONE shared list of phrases (max 60, 60 characters each, plain text) in the room settings: the host (or everybody, if the
// host allows it) adds them, or loads a starter list from lib/bingo-q.json. At least size*size phrases are needed to start. At the start
// the SERVER deals every player a card (size x size, 4 or 5) made of phrases of the list in a different random order. While the
// lesson / meeting / dinner goes on, a player taps a square when they hear the phrase: the marks live on the server and nobody else sees
// them (only the count). "BINGO!" is checked by the server: the line must be complete in the marks the server holds (and, in the
// "room referee" mode, every square of it must have been confirmed as said by the host). The first valid claim is first place.
// Match: a single winner, or up to the podium (three places). No timer, nothing runs on the clock.

const BINGO_MIN_PLAYERS = 2;
const BINGO_MAX_PHRASES = 60;
const BINGO_PHRASE_LEN = 60;
const BINGO_LANGS = ['it', 'en', 'es', 'fr', 'de'];

function bingoDefaultSettings(): array {
    return ['size' => 4, 'mode' => 'single', 'open' => true, 'judge' => false, 'phrases' => [], 'seq' => 0];
}

function bingoSanitizeSettings(array $in, array $base): array {
    $s = array_merge(bingoDefaultSettings(), array_intersect_key($base, bingoDefaultSettings()));
    if (isset($in['size']) && in_array($in['size'], [4, 5], true)) $s['size'] = $in['size'];
    if (isset($in['mode']) && in_array($in['mode'], ['single', 'podium'], true)) $s['mode'] = $in['mode'];
    if (isset($in['open']) && is_bool($in['open'])) $s['open'] = $in['open'];
    if (isset($in['judge']) && is_bool($in['judge'])) $s['judge'] = $in['judge'];
    // the phrases and the counter only change through the phrase actions, never through "settings"
    $clean = [];
    foreach (is_array($s['phrases']) ? $s['phrases'] : [] as $p) {
        if (is_array($p) && isset($p['id'], $p['t']) && is_string($p['t']) && $p['t'] !== '') $clean[] = ['id' => (int)$p['id'], 't' => $p['t'], 'by' => (int)($p['by'] ?? 0)];
    }
    $s['phrases'] = array_slice($clean, 0, BINGO_MAX_PHRASES);
    $s['seq'] = (int)$s['seq'];
    return $s;
}

function bingoLists(): array {
    static $lists = null;
    if ($lists === null) $lists = (json_decode((string)@file_get_contents(dirname(__DIR__, 2) . '/lib/bingo-q.json'), true) ?: [])['lists'] ?? [];
    return $lists;
}

/** Plain text only: tags, control characters and runs of spaces are gone, cut to 60 characters. */
function bingoCleanPhrase(string $s): string {
    $s = preg_replace('/<[^>]*>/u', ' ', $s) ?? '';
    $s = str_replace(['<', '>'], '', $s);
    $s = preg_replace('/[\p{C}\s]+/u', ' ', $s) ?? '';
    return trim(textCut(trim($s), BINGO_PHRASE_LEN));
}

function bingoKey(string $s): string {
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function bingoLoad(PDO $db, int $roomId): ?array {
    $st = $db->prepare('SELECT state FROM bingo_games WHERE room_id = :r');
    $st->execute([':r' => $roomId]);
    $raw = $st->fetchColumn();
    return $raw ? json_decode($raw, true) : null;
}

function bingoSave(PDO $db, int $roomId, array $g): void {
    $db->prepare('INSERT INTO bingo_games (room_id, state, updated_at) VALUES (:r, :s, :t)
                  ON CONFLICT(room_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at')
       ->execute([':r' => $roomId, ':s' => json_encode($g), ':t' => time()]);
}

function bingoEvent(array &$g, array $ev): void {
    $ev['id'] = ++$g['event_seq'];
    $g['events'][] = $ev;
    if (count($g['events']) > 40) $g['events'] = array_slice($g['events'], -40);
}

function bingoActive(array $g): array {
    return array_values(array_filter($g['order'], fn($p) => !in_array($p, $g['gone'], true)));
}

function bingoWon(array $g, int $pid): bool {
    foreach ($g['winners'] as $w) if ((int)$w['p'] === $pid) return true;
    return false;
}

/** Players who can still claim a place. */
function bingoRacers(array $g): array {
    return array_values(array_filter(bingoActive($g), fn($p) => !bingoWon($g, $p)));
}

/** The winning lines of a size x size card, as lists of cell positions: rows, columns and the two diagonals. */
function bingoLines(int $n): array {
    $lines = [];
    for ($i = 0; $i < $n; $i++) {
        $row = $col = [];
        for ($j = 0; $j < $n; $j++) { $row[] = $i * $n + $j; $col[] = $j * $n + $i; }
        $lines[] = $row;
        $lines[] = $col;
    }
    $d1 = $d2 = [];
    for ($i = 0; $i < $n; $i++) { $d1[] = $i * $n + $i; $d2[] = $i * $n + ($n - 1 - $i); }
    $lines[] = $d1;
    $lines[] = $d2;
    return $lines;
}

/** The first complete line of a player: every cell marked by them and, with a referee, said by the host. Null when there is none. */
function bingoFindLine(array $g, int $pid): ?array {
    $marks = $g['marks'][(string)$pid] ?? [];
    $card = $g['cards'][(string)$pid] ?? [];
    foreach (bingoLines((int)$g['rules']['size']) as $line) {
        $ok = true;
        foreach ($line as $c) {
            if (!in_array($c, $marks, true) || ($g['rules']['judge'] && !in_array($card[$c], $g['said'], true))) { $ok = false; break; }
        }
        if ($ok) return $line;
    }
    return null;
}

function bingoEnd(array &$g, string $reason): void {
    $g['status'] = 'ended';
    $rows = [];
    foreach ($g['order'] as $p) {
        if (in_array($p, $g['gone'], true)) continue;
        $rows[] = ['p' => $p, 'marked' => count($g['marks'][(string)$p] ?? [])];
    }
    $g['result'] = ['reason' => $reason, 'rows' => $rows, 'winners' => array_map(fn($w) => $w['p'], $g['winners'])];
    bingoEvent($g, ['t' => 'end']);
}

/** The match is over when the places are filled (1 for "single", 3 for "podium") or nobody is left to win. */
function bingoCheckEnd(array &$g): void {
    if ($g['status'] !== 'play') return;
    $places = $g['rules']['mode'] === 'podium' ? min(3, count(bingoActive($g))) : 1;
    if (count($g['winners']) >= $places || !bingoRacers($g)) bingoEnd($g, $g['winners'] ? 'done' : 'nobody');
}

function bingoShuffle(array $a): array {
    for ($i = count($a) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
    }
    return $a;
}

function bingoStart(PDO $db, array $room): ?string {
    $s = bingoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $players = spiaPlayers($db, (int)$room['id']);
    if (count($players) < BINGO_MIN_PLAYERS) return 'need_players_bingo';
    $n = (int)$s['size'];
    if (count($s['phrases']) < $n * $n) return 'need_phrases';
    $order = array_map(fn($p) => (int)$p['id'], $players);
    $prev = bingoLoad($db, (int)$room['id']);
    $texts = array_map(fn($p) => $p['t'], $s['phrases']);
    $cards = [];
    foreach ($order as $pid) $cards[(string)$pid] = array_slice(bingoShuffle(array_keys($texts)), 0, $n * $n);
    $g = [
        'match' => (int)($prev['match'] ?? 0) + 1, 'status' => 'play',
        'rules' => ['size' => $n, 'mode' => $s['mode'], 'judge' => $s['judge']],
        'phrases' => $texts, 'order' => $order, 'gone' => [], 'cards' => $cards,
        'marks' => array_fill_keys(array_map('strval', $order), []), 'said' => [], 'winners' => [],
        'events' => [], 'event_seq' => (int)($prev['event_seq'] ?? 0), 'result' => null,
    ];
    bingoEvent($g, ['t' => 'start']);
    bingoSave($db, (int)$room['id'], $g);
    return null;
}

function bingoPlayerLeft(array &$g, int $pid): void {
    if ($g['status'] !== 'play' || !in_array($pid, $g['order'], true) || in_array($pid, $g['gone'], true)) return;
    $g['gone'][] = $pid;
    bingoEvent($g, ['t' => 'left', 'p' => $pid]);
    if (count(bingoActive($g)) < BINGO_MIN_PLAYERS) { bingoEnd($g, 'too_few'); return; }
    bingoCheckEnd($g);
}

function bingoStoreSettings(PDO $db, array $room, array $s): void {
    $db->prepare('UPDATE spia_rooms SET settings = :s WHERE id = :id')->execute([':s' => json_encode($s), ':id' => $room['id']]);
}

/** Room actions for the game. Returns true (handled), null (not one of its actions) or an error code. */
function bingoHandle(PDO $db, array $room, array $device, bool $isHost, array $in, string $action) {
    $g = bingoLoad($db, (int)$room['id']);
    $playing = $g && $g['status'] === 'play';
    $own = function ($pid) use ($db, $device): ?int {
        $st = $db->prepare('SELECT id FROM spia_players WHERE id = :id AND device_id = :d AND removed = 0');
        $st->execute([':id' => (int)$pid, ':d' => $device['id']]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int)$id;
    };
    $cur = fn() => bingoSanitizeSettings([], json_decode($room['settings'], true) ?: []);

    switch ($action) {
        case 'settings':
            if (!$isHost) return 'host_only';
            bingoStoreSettings($db, $room, bingoSanitizeSettings(is_array($in['settings'] ?? null) ? $in['settings'] : [], $cur()));
            return true;
        case 'phrase_add':
        case 'phrase_del':
        case 'load_list':
        case 'phrases_clear':
            if ($playing) return 'round_running';
            $s = $cur();
            if ($action === 'phrase_add') {
                if (!$isHost && !$s['open']) return 'host_only';
                $t = bingoCleanPhrase((string)($in['text'] ?? ''));
                if ($t === '') return 'bad_phrase';
                if (count($s['phrases']) >= BINGO_MAX_PHRASES) return 'phrases_full';
                foreach ($s['phrases'] as $p) if (bingoKey($p['t']) === bingoKey($t)) return 'phrase_dup';
                $s['phrases'][] = ['id' => ++$s['seq'], 't' => $t, 'by' => (int)$device['id']];
            } elseif ($action === 'phrase_del') {
                $id = (int)($in['id'] ?? 0);
                $s['phrases'] = array_values(array_filter($s['phrases'], fn($p) => $p['id'] !== $id || (!$isHost && $p['by'] !== (int)$device['id'])));
            } elseif ($action === 'load_list') {
                if (!$isHost) return 'host_only';
                $list = null;
                foreach (bingoLists() as $l) if ($l['id'] === ($in['list'] ?? '')) $list = $l;
                if (!$list) return 'no_list';
                $li = array_search($in['lang'] ?? 'en', BINGO_LANGS, true);
                $li = $li === false ? 1 : $li;
                $have = array_map(fn($p) => bingoKey($p['t']), $s['phrases']);
                foreach ($list['p'] as $row) {
                    $t = bingoCleanPhrase((string)$row[$li]);
                    if ($t === '' || in_array(bingoKey($t), $have, true) || count($s['phrases']) >= BINGO_MAX_PHRASES) continue;
                    $have[] = bingoKey($t);
                    $s['phrases'][] = ['id' => ++$s['seq'], 't' => $t, 'by' => (int)$device['id']];
                }
            } else {
                if (!$isHost) return 'host_only';
                $s['phrases'] = [];
            }
            bingoStoreSettings($db, $room, $s);
            return true;
        case 'start':
            if (!$isHost) return 'host_only';
            if ($playing) return 'round_running';
            return bingoStart($db, $room) ?? true;
        case 'end':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            bingoEnd($g, 'host_ended');
            break;
        case 'say':
            if (!$isHost) return 'host_only';
            if (!$playing) return 'no_round';
            $i = $in['phrase'] ?? null;
            if (!is_int($i) || $i < 0 || $i >= count($g['phrases'])) return 'bad_cell';
            if (in_array($i, $g['said'], true)) $g['said'] = array_values(array_diff($g['said'], [$i]));
            else { $g['said'][] = $i; bingoEvent($g, ['t' => 'said', 'i' => $i]); }
            break;
        case 'mark':
        case 'bingo':
            if (!$playing) return 'no_round';
            $pid = $own($in['player_id'] ?? 0);
            if ($pid === null) return 'not_your_player';
            if (!in_array($pid, bingoActive($g), true)) return 'not_now';
            if (bingoWon($g, $pid)) return 'already_won';
            $key = (string)$pid;
            if ($action === 'mark') {
                $c = $in['cell'] ?? null;
                if (!is_int($c) || $c < 0 || $c >= count($g['cards'][$key])) return 'bad_cell';
                if (in_array($c, $g['marks'][$key], true)) {
                    $g['marks'][$key] = array_values(array_diff($g['marks'][$key], [$c]));
                } else {
                    if ($g['rules']['judge'] && !in_array($g['cards'][$key][$c], $g['said'], true)) return 'not_said';
                    $g['marks'][$key][] = $c;
                }
                break;
            }
            $line = bingoFindLine($g, $pid);
            if ($line === null) return 'no_bingo';
            $g['winners'][] = ['p' => $pid, 'place' => count($g['winners']) + 1, 'line' => $line,
                'row' => array_map(fn($c) => $g['phrases'][$g['cards'][$key][$c]], $line)];
            bingoEvent($g, ['t' => 'bingo', 'p' => $pid, 'place' => count($g['winners'])]);
            bingoCheckEnd($g);
            break;
        default:
            return null;
    }
    bingoSave($db, (int)$room['id'], $g);
    return true;
}

/** What one phone may see: its own cards and marks, only the NUMBER of marks of the others, the shared list and the winners' rows. */
function bingoView(PDO $db, array $room, array $device, bool $adminSession): array {
    $view = spiaView($db, $room, $device, $adminSession);
    $view['game'] = 'bingo';
    $s = bingoSanitizeSettings([], json_decode($room['settings'], true) ?: []);
    $s['phrases'] = array_map(fn($p) => ['id' => $p['id'], 't' => $p['t'], 'mine' => $p['by'] === (int)$device['id']], $s['phrases']);
    unset($s['seq']);
    $s['max'] = BINGO_MAX_PHRASES;
    $view['settings'] = $s;
    $g = bingoLoad($db, (int)$room['id']);
    $view['bingo'] = null;
    if (!$g) return $view;
    $mine = array_map(fn($p) => (int)$p['id'], array_filter($view['players'], fn($p) => $p['device_id'] === (int)$device['id']));
    $me = [];
    foreach (array_values(array_intersect($mine, $g['order'])) as $pid) {
        $k = (string)$pid;
        $cells = [];
        foreach ($g['cards'][$k] as $i => $idx) $cells[] = ['t' => $g['phrases'][$idx], 'm' => in_array($i, $g['marks'][$k], true), 'said' => in_array($idx, $g['said'], true)];
        $place = null;
        foreach ($g['winners'] as $w) if ((int)$w['p'] === $pid) $place = $w['place'];
        $me[] = ['player_id' => $pid, 'cells' => $cells, 'place' => $place, 'ready' => bingoFindLine($g, $pid) !== null];
    }
    $view['bingo'] = [
        'match' => $g['match'], 'status' => $g['status'], 'rules' => $g['rules'], 'order' => $g['order'], 'active' => bingoActive($g),
        'counts' => array_map('count', $g['marks']), 'pool' => $g['phrases'], 'said' => $g['said'],
        'winners' => $g['winners'], 'events' => $g['events'], 'result' => $g['result'], 'me' => $me,
    ];
    return $view;
}

/** For the admin LIVE panel (admin sessions only): every card with its marks, the phrases said by the host and the winners. */
function bingoLiveInfo(PDO $db, int $roomId): ?array {
    $g = bingoLoad($db, $roomId);
    if (!$g) return null;
    $cards = [];
    foreach ($g['cards'] as $k => $idxs) {
        $cards[$k] = ['cells' => array_map(fn($i) => $g['phrases'][$i], $idxs), 'marks' => $g['marks'][$k] ?? []];
    }
    return ['status' => $g['status'], 'size' => $g['rules']['size'], 'judge' => $g['rules']['judge'], 'cards' => $cards,
        'said' => array_map(fn($i) => $g['phrases'][$i], $g['said']), 'winners' => array_map(fn($w) => $w['p'], $g['winners'])];
}
