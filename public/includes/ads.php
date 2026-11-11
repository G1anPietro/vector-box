<?php
// public/includes/ads.php — Google AdSense, off until ADSENSE_CLIENT is set in .env.
// A page that shows ads defines VB_ADS_PAGE *before* including head.php (so the CSP lets
// Google in), prints adsScriptTag() in <head> and adsSlot() where an ad unit goes.
// Rules (AdSense policy): ads only on pages with real content, clearly labelled, never
// next to game buttons, and never ask people to look at or click them.
require_once __DIR__ . '/../api/helpers.php';

function adsScriptTag(): string {
    $client = adsenseClient();
    if ($client === '') return '';
    return '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='
        . htmlspecialchars($client) . '" crossorigin="anonymous"></script>' . "\n"
        . '    <script src="../js/ads.js?v=1" defer></script>';
}

/** One responsive ad unit; nothing at all when ads are off or the unit id is missing. */
function adsSlot(string $slotEnvKey, string $lang): string {
    $client = adsenseClient();
    $slot = trim((string)envValue($slotEnvKey, ''));
    if ($client === '' || !preg_match('/^\d{6,20}$/', $slot)) return '';
    $label = $lang === 'it' ? 'Pubblicità' : 'Advertisement';
    return '<aside class="ad-slot" aria-label="' . $label . '"><span class="ad-label">' . $label . '</span>'
        . '<ins class="adsbygoogle" style="display:block" data-ad-client="' . htmlspecialchars($client) . '"'
        . ' data-ad-slot="' . $slot . '" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>';
}
