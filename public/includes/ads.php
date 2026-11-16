<?php
// public/includes/ads.php — Google AdSense, off until ADSENSE_CLIENT is set in .env.
// A page that shows ads defines VB_ADS_PAGE *before* including head.php (so the CSP lets
// Google in), prints adsScriptTag() in <head> and adsSlot() where an ad unit goes.
// Rules (AdSense policy): ads only on pages with real content, clearly labelled, never
// next to game buttons, and never ask people to look at or click them.
require_once __DIR__ . '/../api/helpers.php';

/** Ads are for everybody except the admin and the accounts the admin marked with /adsfree. */
function adsHiddenForViewer(): bool {
    static $hidden = null;
    if ($hidden !== null) return $hidden;
    $hidden = false;
    try {
        initSession();   // read-only
        if (!empty($_SESSION['is_admin'])) return $hidden = true;
        $uid = (int)($_SESSION['user_id'] ?? 0);
        if ($uid > 0) {
            require_once __DIR__ . '/../api/database.php';
            $st = getDbConnection()->prepare('SELECT ads_free FROM accounts WHERE id = :i');
            $st->execute([':i' => $uid]);
            $hidden = (int)$st->fetchColumn() === 1;
        }
    } catch (Throwable $e) { /* show ads rather than break the page */ }
    return $hidden;
}

/** 'google' when Google's own certified consent message does the asking (ADSENSE_CMP=google), otherwise 'own': our banner. */
function adsConsentMode(): string {
    return strtolower(trim((string)envValue('ADSENSE_CMP', 'own'))) === 'google' ? 'google' : 'own';
}

/**
 * Nothing from Google is in the page HTML: this prints the consent marker and two of OUR scripts. The banner (cookie_consent.js)
 * asks; ads.js loads Google's script only after "Accept" (or at once when Google's own message is in charge).
 */
function adsScriptTag(): string {
    $client = adsenseClient();
    if ($client === '' || adsHiddenForViewer()) return '';
    $v = defined('APP_VERSION') ? APP_VERSION : '1';
    $mode = adsConsentMode();
    return '<meta name="vb-ads" content="' . $mode . '">' . "\n"
        . '    <script src="../js/cookie_consent.js?v=' . htmlspecialchars($v) . '"></script>' . "\n"
        . '    <script src="../js/ads.js?v=' . htmlspecialchars($v) . '" defer data-client="' . htmlspecialchars($client) . '" data-cmp="' . $mode . '"></script>';
}

/** One responsive ad unit; nothing at all when ads are off or the unit id is missing. */
function adsSlot(string $slotEnvKey, string $lang): string {
    $client = adsenseClient();
    $slot = trim((string)envValue($slotEnvKey, ''));
    if ($client === '' || adsHiddenForViewer() || !preg_match('/^\d{6,20}$/', $slot)) return '';
    $label = $lang === 'it' ? 'Pubblicità' : 'Advertisement';
    // hidden until ads.js has loaded Google's script (no empty "Advertisement" box for someone who said no)
    return '<aside class="ad-slot" hidden aria-label="' . $label . '"><span class="ad-label">' . $label . '</span>'
        . '<ins class="adsbygoogle" style="display:block" data-ad-client="' . htmlspecialchars($client) . '"'
        . ' data-ad-slot="' . $slot . '" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>';
}

/** The footer link that reopens the consent choice ("Cookie"); nothing when there are no ads to consent to. */
function adsCookieLink(string $lang): string {
    if (adsenseClient() === '' || adsHiddenForViewer()) return '';
    return '<a href="#" data-vb-cookie>' . ($lang === 'it' ? 'Cookie' : 'Cookies') . '</a>';
}
