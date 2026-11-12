<?php
// public/api/gemini.php
// Minimal client for the Gemini API (Google AI Studio), used by the class-notes worker (bin/appunti-ai.php).
// .env: GEMINI_API_KEY, GEMINI_AUTH (header|bearer: new "AQ." keys may need bearer),
//       GEMINI_MODEL_FAST / GEMINI_MODEL_SMART, and per-model limits GEMINI_{FAST,SMART}_{RPM,RPD}.
// The free tier's daily quota resets at midnight Pacific time; usage is counted in ai_usage to stay below it.
require_once __DIR__ . '/helpers.php';

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Free-tier limits seen in AI Studio on 2026-11-12 (Gemini 3.5 Flash Lite: 15/min, 500/day; 3.8 Flash: 5/min, 20/day)
const GEMINI_DEFAULTS = [
    'fast' => ['model' => 'gemini-3.5-flash-lite', 'rpm' => 15, 'rpd' => 500],
    'smart' => ['model' => 'gemini-3.8-flash', 'rpm' => 5, 'rpd' => 20],
];

class GeminiError extends RuntimeException {
    public bool $quota;
    public function __construct(string $message, bool $quota = false) {
        parent::__construct($message);
        $this->quota = $quota;
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
 * One generateContent call. $parts: list of ['text' => ...] or ['mime' => ..., 'data' => raw bytes].
 * Returns the text of the answer. Throws GeminiError (->quota true when the daily/minute quota is used up).
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
    if ($key === '') throw new GeminiError('GEMINI_API_KEY is not set');
    $headers = ['Content-Type: application/json'];
    $headers[] = strtolower((string)envValue('GEMINI_AUTH', 'header')) === 'bearer'
        ? 'Authorization: Bearer ' . $key
        : 'x-goog-api-key: ' . $key;

    $base = rtrim((string)envValue('GEMINI_BASE_URL', GEMINI_DEFAULT_BASE), '/');
    $ch = curl_init($base . '/models/' . rawurlencode($t['model']) . ':generateContent');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 300,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    geminiCount($db, $t['model']);   // a failed call may still count against Google's quota

    if ($raw === false) throw new GeminiError('network error: ' . $err);
    $json = json_decode((string)$raw, true);
    if ($code === 429) throw new GeminiError('quota exceeded (429)', true);
    if ($code !== 200 || !is_array($json)) {
        $msg = is_array($json) ? (string)($json['error']['message'] ?? '') : '';
        throw new GeminiError("HTTP $code " . textCut($msg, 200));
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
