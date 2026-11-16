<?php
// public/api/bots.php — what automated clients do to the site: classify them, count them (table bot_stats, one row per
// day + kind + label, so the counters stay tiny however many requests arrive), keep the latest lines in data/bots.log
// and refuse the abusive ones. Only requests that reach PHP are seen; whatever nginx answers by itself is not.
//
// kinds: crawler (search engines, link previews, other known bots), ai (AI training crawlers), abusive (SEO / data
// scrapers: always refused with 403), tool (curl, python, empty User-Agent...), scanner (probes for wp-login, .env...).
// .env: BOT_BLOCK_AI=true refuses the AI crawlers too (default: only robots.txt asks them to stay out).
require_once __DIR__ . '/helpers.php';

const BOT_LOG_MAX_BYTES = 1024 * 1024;   // then rotated to bots.log.1
const BOT_KINDS = ['crawler' => 'Motori di ricerca e anteprime', 'ai' => 'Crawler di IA', 'abusive' => 'Scraper bloccati',
                   'tool' => 'Script e strumenti', 'scanner' => 'Scanner di vulnerabilità'];

/** Any client that looks automated (also used to skip bots in the visit counter). */
function visitIsBot(string $ua): bool {
    if ($ua === '') return true;
    return (bool)preg_match('/bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|httpclient|go-http|java\/|'
        . 'headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|mediapartners|adsbot|feedfetcher|scan/i', $ua);
}

/** [kind, label] for a User-Agent that looks automated, or null for a normal browser. */
function botClassify(string $ua): ?array {
    if ($ua === '') return ['tool', 'senza user-agent'];
    // SEO and data scrapers: nothing in them is useful to this site
    foreach (['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'Bytespider', 'BLEXBot', 'DataForSeoBot', 'serpstatbot',
              'MegaIndex', 'Barkrowler', 'ZoominfoBot', 'SeekportBot', 'AwarioBot', 'Screaming Frog', 'SiteAuditBot', 'BrightEdge'] as $n) {
        if (stripos($ua, $n) !== false) return ['abusive', $n];
    }
    foreach (['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'CCBot', 'PerplexityBot',
              'Google-Extended', 'Amazonbot', 'Applebot-Extended', 'Meta-ExternalAgent', 'ImagesiftBot', 'Omgilibot', 'cohere-ai',
              'Diffbot', 'YouBot', 'FacebookBot'] as $n) {
        if (stripos($ua, $n) !== false) return ['ai', $n];
    }
    foreach (['Googlebot' => 'Googlebot', 'bingbot' => 'Bingbot', 'DuckDuckBot' => 'DuckDuckBot', 'Applebot' => 'Applebot',
              'YandexBot' => 'YandexBot', 'Baiduspider' => 'Baiduspider', 'Slurp' => 'Yahoo', 'Mediapartners' => 'Google AdSense',
              'AdsBot' => 'Google Ads', 'facebookexternalhit' => 'Facebook', 'WhatsApp' => 'WhatsApp', 'TelegramBot' => 'Telegram',
              'Discordbot' => 'Discord', 'Twitterbot' => 'Twitter/X', 'LinkedInBot' => 'LinkedIn', 'Slackbot' => 'Slack',
              'Lighthouse' => 'Lighthouse', 'UptimeRobot' => 'UptimeRobot'] as $n => $label) {
        if (stripos($ua, $n) !== false) return ['crawler', $label];
    }
    foreach (['curl' => 'curl', 'wget' => 'wget', 'python' => 'python', 'go-http' => 'go-http', 'java/' => 'java', 'okhttp' => 'okhttp',
              'libwww' => 'libwww', 'scrapy' => 'scrapy', 'headless' => 'headless browser', 'httpclient' => 'httpclient'] as $n => $label) {
        if (stripos($ua, $n) !== false) return ['tool', $label];
    }
    return visitIsBot($ua) ? ['crawler', 'altri bot'] : null;
}

/** What a probe is after ("wordpress", "dotfiles"...), '' when the path looks like an ordinary mistake. */
function botScanLabel(string $path): string {
    static $rules = [
        'wordpress'      => '#/(wp-(login|admin|content|includes|json|config)|xmlrpc\.php|wordpress|wlwmanifest)#i',
        'file nascosti'  => '#/\.(env|git|svn|hg|aws|ssh|docker|npmrc|bash_history|ds_store|htaccess|htpasswd|config|vscode)#i',
        'pannelli admin' => '#/(phpmyadmin|pma|adminer|administrator|myadmin|mysql|manager/html|admin(\.php|/|$)|login\.(php|asp|jsp))#i',
        'router / IoT'   => '#/(boaform|hnap1|cgi-bin|setup\.cgi|gponform|goform|webui|cgi)#i',
        'exploit noti'   => '#(actuator|jenkins|solr|vendor/phpunit|eval-stdin|struts|\.action$|jndi|think\\\\app|console/|geoserver|ecp/|owa/|autodiscover)#i',
        'path traversal' => '#(\.\./|%2e%2e|%252e|etc/passwd|/proc/|\\\\windows|boot\.ini)#i',
        'webshell'       => '#\.(php|phtml|asp|aspx|jsp|cgi)$#i',
    ];
    foreach ($rules as $label => $re) if (preg_match($re, $path)) return $label;
    return '';
}

function botBlockAi(): bool { return strtolower((string)envValue('BOT_BLOCK_AI', 'false')) === 'true'; }

/** Counts one automated request (and keeps its line in bots.log). Never breaks a page. */
function botRecord(string $kind, string $label, string $page, int $status): void {
    try {
        $ip = getClientIp();
        if ($ip === '127.0.0.1' || $ip === '::1') return;   // the server checking itself
        require_once __DIR__ . '/database.php';
        $blocked = $status === 403 || $status === 429 ? 1 : 0;
        getDbConnection()->prepare('INSERT INTO bot_stats (day, kind, label, hits, blocked) VALUES (:d, :k, :l, 1, :b)
                                    ON CONFLICT(day, kind, label) DO UPDATE SET hits = hits + 1, blocked = blocked + :b')
            ->execute([':d' => date('Y-m-d'), ':k' => $kind, ':l' => $label, ':b' => $blocked]);

        $logFile = dirname(__DIR__, 2) . '/data/bots.log';
        if (is_file($logFile) && filesize($logFile) > BOT_LOG_MAX_BYTES) @rename($logFile, $logFile . '.1');
        $clean = fn(string $s, int $n) => substr(preg_replace('/[^\x20-\x7E]/', '', $s) ?? '', 0, $n);
        @file_put_contents($logFile, sprintf("%s\t%s\t%s\t%s\t%s\t%d\n", date('Y-m-d H:i:s'), $ip, $kind,
            $clean($label, 40), $clean($page, 120), $status), FILE_APPEND | LOCK_EX);
    } catch (Throwable $e) {
        if (stripos($e->getMessage(), 'database is locked') !== false) return;   // one lost count is not worth a log line
        require_once __DIR__ . '/debug_logger.php';
        logSystemError('BOTS', $e->getMessage());
    }
}

/** Counts a page request made by a bot (called for every PHP page; normal browsers cost nothing). */
function botNotePageRequest(string $ua, string $page): void {
    $c = botClassify($ua);
    if ($c) botRecord($c[0], $c[1], $page, 200);
}

/** Refuses the scrapers (403 before any work is done). Call it first thing in a page. */
function botBlockIfAbusive(): void {
    if (PHP_SAPI === 'cli') return;
    $c = botClassify(substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 400));
    if (!$c || !($c[0] === 'abusive' || ($c[0] === 'ai' && botBlockAi()))) return;
    botRecord($c[0], $c[1], (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), 403);
    http_response_code(403);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    exit("Automated access is not allowed.\n");
}
