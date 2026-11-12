<?php
// public/api/webpush.php
// Web Push without libraries: payload encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292) with PHP's openssl.
// The VAPID key pair is created on first use in data/vapid.json (private key in PEM, readable only by the web user).
// Only endpoints of the browsers' push services are accepted (no requests to arbitrary addresses).
require_once __DIR__ . '/helpers.php';

const WEBPUSH_HOSTS = [
    'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com',
    'android.googleapis.com',
];
const WEBPUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];
// DER prefix of a P-256 SubjectPublicKeyInfo; the 65-byte uncompressed point follows
const WEBPUSH_P256_SPKI = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

function b64uDecode(string $s): string {
    return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

/** True for https endpoints of known push services (plus WEBPUSH_EXTRA_HOSTS, used by the tests). */
function webpushEndpointAllowed(string $endpoint): bool {
    $p = parse_url($endpoint);
    if (!$p || empty($p['host']) || strlen($endpoint) > 1000) return false;
    $host = strtolower($p['host']);
    $hostPort = $host . (isset($p['port']) ? ':' . $p['port'] : '');
    $extra = array_filter(array_map('trim', explode(',', (string)envValue('WEBPUSH_EXTRA_HOSTS', ''))));
    if (in_array($hostPort, $extra, true)) return in_array($p['scheme'] ?? '', ['http', 'https'], true);
    if (($p['scheme'] ?? '') !== 'https' || isset($p['user']) || isset($p['port'])) return false;
    if (in_array($host, WEBPUSH_HOSTS, true)) return true;
    foreach (WEBPUSH_HOST_SUFFIXES as $suffix) {
        if (str_ends_with($host, $suffix)) return true;
    }
    return false;
}

function webpushPublicPem(string $point): string {
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(hex2bin(WEBPUSH_P256_SPKI) . $point), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** The raw 65-byte public point of an EC key. */
function webpushPoint($key): string {
    $d = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}

function webpushNewKey() {
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$key) throw new RuntimeException('cannot create an EC key');
    return $key;
}

/** ['public' => base64url point, 'private' => PEM], created once. */
function vapidKeys(): array {
    static $keys = null;
    if ($keys) return $keys;
    $file = dirname(__DIR__, 2) . '/data/vapid.json';
    if (is_file($file)) {
        $keys = json_decode((string)file_get_contents($file), true);
        if (is_array($keys) && !empty($keys['public']) && !empty($keys['private'])) return $keys;
    }
    $key = webpushNewKey();
    openssl_pkey_export($key, $pem);
    $keys = ['public' => base64UrlEncode(webpushPoint($key)), 'private' => $pem];
    $tmp = $file . '.' . bin2hex(random_bytes(4));
    $old = umask(0077);
    file_put_contents($tmp, json_encode($keys));
    umask($old);
    // Two first uses at the same time: the first file wins, everyone uses it
    if (!@link($tmp, $file)) {
        @unlink($tmp);
        $keys = json_decode((string)file_get_contents($file), true);
    } else {
        @unlink($tmp);
    }
    return $keys;
}

/** DER ECDSA signature -> the raw r||s (64 bytes) that JWT ES256 wants. */
function webpushDerToRaw(string $der): string {
    $pos = 2;
    if ((ord($der[1]) & 0x80) !== 0) $pos += ord($der[1]) & 0x7f;
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = substr($der, $pos + 2, $len);
        $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $len;
    }
    return $out;
}

function vapidHeader(string $endpoint): string {
    $keys = vapidKeys();
    $p = parse_url($endpoint);
    $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $site = siteUrl();
    $claims = ['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => str_starts_with($site, 'https://') ? $site : 'https://vector-box.duckdns.org'];
    $data = base64UrlEncode(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . base64UrlEncode(json_encode($claims, JSON_UNESCAPED_SLASHES));
    if (!openssl_sign($data, $der, $keys['private'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('VAPID signing failed');
    return 'vapid t=' . $data . '.' . base64UrlEncode(webpushDerToRaw($der)) . ', k=' . $keys['public'];
}

/** Encrypts a payload for one subscription (RFC 8291). Returns the request body. */
function webpushEncrypt(string $payload, string $p256dh, string $authSecret): string {
    $uaPublic = b64uDecode($p256dh);
    $auth = b64uDecode($authSecret);
    if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($auth) !== 16) throw new InvalidArgumentException('bad subscription keys');

    $as = webpushNewKey();
    $asPublic = webpushPoint($as);
    $ecdh = openssl_pkey_derive(webpushPublicPem($uaPublic), $as, 32);
    if ($ecdh === false) throw new InvalidArgumentException('bad subscription key');
    $ikm = hash_hkdf('sha256', $ecdh, 32, "WebPush: info\0" . $uaPublic . $asPublic, $auth);
    $salt = random_bytes(16);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $cipher . $tag;
}

/**
 * Sends one push. Returns the HTTP status (201 = delivered to the push service; 404/410 = subscription gone),
 * or 0 on a network error.
 */
function webpushSend(array $sub, array $message): int {
    if (!webpushEndpointAllowed($sub['endpoint'])) return 410;
    $body = webpushEncrypt(json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $sub['p256dh'], $sub['auth']);
    $ch = curl_init($sub['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/octet-stream', 'Content-Encoding: aes128gcm', 'TTL: 86400', 'Urgency: normal',
            'Authorization: ' . vapidHeader($sub['endpoint']),
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code;
}
