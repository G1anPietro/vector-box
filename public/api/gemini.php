<?php
// public/api/gemini.php
// Minimal client for the Gemini API (Google AI Studio), used by the class-notes worker (bin/appunti-ai.php).
// .env: GEMINI_API_KEY, GEMINI_AUTH (header|bearer: new "AQ." keys may need bearer),
//       GEMINI_MODEL_FAST / GEMINI_MODEL_SMART, and per-model limits GEMINI_{FAST,SMART}_{RPM,RPD}.
// The free tier's daily quota resets at midnight Pacific time; usage is counted in ai_usage to stay below it.
require_once __DIR__ . '/helpers.php';

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Free-tier limits seen in AI Studio on 2026-11-12 (Gemini 3.5 Flash Lite: 15/min, 500/day; 3.8 Flash: 5/min, 20/day)
// 'smart2' is the backup of 'smart' when Google says the newest Flash is overloaded
const GEMINI_DEFAULTS = [
    'fast' => ['model' => 'gemini-3.5-flash-lite', 'rpm' => 15, 'rpd' => 500],
    'smart' => ['model' => 'gemini-3.8-flash', 'rpm' => 5, 'rpd' => 20],
    'smart2' => ['model' => 'gemini-3.7-flash', 'rpm' => 5, 'rpd' => 20],
];
const GEMINI_SMART_CHAIN = ['smart', 'smart2', 'fast'];

class GeminiError extends RuntimeException {
    public bool $quota;     // daily/minute quota used up: normal, try again later
    public bool $service;   // Gemini unreachable, key refused, model missing, server error: a real fault
    public bool $busy;      // Google overloaded ("high demand", 503/504) even after retries: not our fault, try later
    public bool $stop;      // any of these: stop this run instead of trying the next document
    public static int $serviceFailures = 0;
    public function __construct(string $message, bool $quota = false, bool $service = false, bool $busy = false) {
        parent::__construct($message);
        $this->quota = $quota;
        $this->service = $service;
        $this->busy = $busy;
        $this->stop = $quota || $service || $busy;
        if ($service) self::$serviceFailures++;
    }
}

function geminiConfigured(): bool {
    return (string)envValue('GEMINI_API_KEY', '') !== '';
}

/** Model name and limits for a tier ('fast' for transcriptions and lessons, 'smart' for test documents). */
function geminiTier(string $tier): array {
    $d = GEMINI_DEFAULTS[$tier];
    $up = strtoupper($tier);
    return [
        'model' => (string)envValue("GEMINI_MODEL_$up", $d['model']),
        'rpm' => max(1, (int)envValue("GEMINI_{$up}_RPM", (string)$d['rpm'])),
        // keep a 10% margin under Google's daily limit
        'rpd' => max(1, (int)floor(0.9 * (int)envValue("GEMINI_{$up}_RPD", (string)$d['rpd']))),
    ];
}

function geminiQuotaDay(): string {
    return (new DateTimeImmutable('now', new DateTimeZone('America/Los_Angeles')))->format('Y-m-d');
}

function geminiUsedToday(PDO $db, string $model): int {
    $st = $db->prepare('SELECT requests FROM ai_usage WHERE day = :d AND model = :m');
    $st->execute([':d' => geminiQuotaDay(), ':m' => $model]);
    return (int)$st->fetchColumn();
}

function geminiLeftToday(PDO $db, string $tier): int {
    $t = geminiTier($tier);
    return max(0, $t['rpd'] - geminiUsedToday($db, $t['model']));
}

function geminiCount(PDO $db, string $model): void {
    $db->prepare('INSERT INTO ai_usage (day, model, requests) VALUES (:d, :m, 1)
                  ON CONFLICT(day, model) DO UPDATE SET requests = requests + 1')
       ->execute([':d' => geminiQuotaDay(), ':m' => $model]);
}

/**
 * Like geminiGenerate(), but when a tier is overloaded or out of quota it moves on to the next one
 * (e.g. ['smart', 'fast']). Returns [text, model]; throws the last error when every tier failed.
 */
function geminiGenerateAny(PDO $db, array $tiers, string $system, array $parts, array $opts = []): array {
    $last = null;
    $tiers = array_values($tiers);
    foreach ($tiers as $i => $tier) {
        $tierOpts = $opts;
        if (isset($opts['deadline'])) {
            // Share the time left among the models still to try, so a model that hangs cannot use it all
            $left = $opts['deadline'] - microtime(true);
            if ($left < 10) break;
            $tierOpts['deadline'] = microtime(true) + $left / (count($tiers) - $i);
        }
        try {
            return [geminiGenerate($db, $tier, $system, $parts, $tierOpts), geminiTier($tier)['model']];
        } catch (GeminiError $e) {
            if (!$e->busy && !$e->quota) throw $e;
            $last = $e;
        }
    }
    throw $last ?? new GeminiError('no time left', false, false, true);
}

/** Seconds to wait before each retry of a 500/503/504 answer (GEMINI_RETRY_WAITS, default "2,5"). */
function geminiRetryWaits(): array {
    return array_map('floatval', array_filter(explode(',', (string)envValue('GEMINI_RETRY_WAITS', '2,5')), 'is_numeric'));
}

/**
 * One generateContent call. $parts: list of ['text' => ...] or ['mime' => ..., 'data' => raw bytes].
 * Returns the text of the answer. Throws GeminiError (->quota when the daily/minute quota is used up, ->busy when
 * Google stays overloaded after the retries). $opts: json, max_tokens, deadline (microtime: give up before it,
 * for requests a browser is waiting on).
 */
function geminiGenerate(PDO $db, string $tier, string $system, array $parts, array $opts = []): string {
    static $lastCall = [];
    $t = geminiTier($tier);
    if (geminiLeftToday($db, $tier) <= 0) throw new GeminiError("daily budget used for {$t['model']}", true);

    // Stay under the per-minute limit
    $gap = 60.0 / $t['rpm'] + 0.5;
    $wait = ($lastCall[$t['model']] ?? 0) + $gap - microtime(true);
    if ($wait > 0 && empty($opts['no_wait'])) usleep((int)($wait * 1e6));
    $lastCall[$t['model']] = microtime(true);

    $apiParts = [];
    foreach ($parts as $p) {
        $apiParts[] = isset($p['text'])
            ? ['text' => $p['text']]
            : ['inlineData' => ['mimeType' => $p['mime'], 'data' => base64_encode($p['data'])]];
    }
    $body = [
        'systemInstruction' => ['parts' => [['text' => $system]]],
        'contents' => [['role' => 'user', 'parts' => $apiParts]],
        'generationConfig' => ['maxOutputTokens' => (int)($opts['max_tokens'] ?? 32768)],
    ];
    if (!empty($opts['json'])) $body['generationConfig']['responseMimeType'] = 'application/json';

    $key = (string)envValue('GEMINI_API_KEY', '');
    if ($key === '') throw new GeminiError('GEMINI_API_KEY is not set', false, true);
    $headers = ['Content-Type: application/json'];
    $headers[] = strtolower((string)envValue('GEMINI_AUTH', 'header')) === 'bearer'
        ? 'Authorization: Bearer ' . $key
        : 'x-goog-api-key: ' . $key;

    $base = rtrim((string)envValue('GEMINI_BASE_URL', GEMINI_DEFAULT_BASE), '/');
    $payload = json_encode($body);
    $deadline = $opts['deadline'] ?? null;
    $waits = geminiRetryWaits();
    for ($attempt = 0; ; $attempt++) {
        $timeout = 300;
        if ($deadline !== null) {
            $timeout = (int)floor($deadline - microtime(true));
            if ($timeout < 5) throw new GeminiError('no time left for Gemini', false, false, true);
        }
        $ch = curl_init($base . '/models/' . rawurlencode($t['model']) . ':generateContent');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => $timeout,
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        $err = curl_error($ch);
        curl_close($ch);
        geminiCount($db, $t['model']);   // a failed call may still count against Google's quota

        // Overloaded or flaky Google: wait a little and try again (only if there is time)
        $transient = in_array($code, [500, 502, 503, 504], true) || $errno === CURLE_OPERATION_TIMEDOUT;
        if (!$transient || !isset($waits[$attempt])) break;
        if ($deadline !== null && microtime(true) + $waits[$attempt] + 10 > $deadline) break;
        usleep((int)($waits[$attempt] * 1e6));
    }

    if ($errno === CURLE_OPERATION_TIMEDOUT) throw new GeminiError('Gemini did not answer in time', false, false, true);
    if ($raw === false) throw new GeminiError('network error: ' . $err, false, true);
    $json = json_decode((string)$raw, true);
    if ($code === 429) throw new GeminiError('quota exceeded (429)', true);
    if ($code !== 200 || !is_array($json)) {
        $msg = is_array($json) ? (string)($json['error']['message'] ?? '') : '';
        // 503/504: Google overloaded (busy, not a fault). 400: this request's content.
        // 401/403 (key), 404 (model name), 500/502: faults of the setup or of Google.
        $busy = in_array($code, [503, 504], true);
        throw new GeminiError("HTTP $code " . textCut($msg, 200), false, !$busy && $code !== 400, $busy);
    }
    $cand = $json['candidates'][0] ?? null;
    $text = '';
    foreach (($cand['content']['parts'] ?? []) as $p) {
        if (isset($p['text']) && empty($p['thought'])) $text .= $p['text'];
    }
    if (trim($text) === '') {
        $reason = (string)($cand['finishReason'] ?? ($json['promptFeedback']['blockReason'] ?? 'empty'));
        throw new GeminiError('no text in the answer (' . $reason . ')');
    }
    return $text;
}
