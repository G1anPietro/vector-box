<?php
// public/api/totp_lib.php — two-step login for admin accounts (TOTP, RFC 6238: the 6-digit code of an authenticator app).
// The secret is stored encrypted (AES-256-GCM) with TOTP_KEY from .env, or with a key file data/totp.key made on first use.
// Backup codes are stored only as SHA-256 hashes and work once. A code can never be used twice (totp_last_step).
require_once __DIR__ . '/helpers.php';

const TOTP_PERIOD = 30;
const TOTP_BACKUP_COUNT = 8;

function totpKey(): string {
    $env = (string)envValue('TOTP_KEY', '');
    if (strlen($env) >= 16) return hash('sha256', $env, true);
    $file = dirname(__DIR__, 2) . '/data/totp.key';
    if (!is_file($file)) {
        $tmp = $file . '.' . bin2hex(random_bytes(4));
        file_put_contents($tmp, bin2hex(random_bytes(32)));
        chmod($tmp, 0600);
        @rename($tmp, $file);                       // two requests racing: the first one wins, both then read the same file
    }
    return hash('sha256', (string)file_get_contents($file), true);
}

function totpEncrypt(string $plain): string {
    $iv = random_bytes(12);
    $ct = openssl_encrypt($plain, 'aes-256-gcm', totpKey(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $ct);
}

function totpDecrypt(string $stored): ?string {
    $raw = base64_decode($stored, true);
    if ($raw === false || strlen($raw) < 29) return null;
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', totpKey(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $p === false ? null : $p;
}

const TOTP_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(string $bin): string {
    $bits = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 5) as $chunk) $out .= TOTP_B32[bindec(str_pad($chunk, 5, '0'))];
    return $out;
}

function base32Decode(string $s): string {
    $bits = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $c) $bits .= str_pad(decbin(strpos(TOTP_B32, $c)), 5, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
    return $out;
}

/** The 6-digit code for one 30-second step. */
function totpAt(string $secret, int $step): string {
    $h = hash_hmac('sha1', pack('J', $step), $secret, true);
    $o = ord($h[19]) & 15;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT);
}

/** The step a code belongs to (one step either side of now is accepted: clocks differ), only if it is newer than $lastStep; else null. */
function totpCheck(string $secret, string $code, int $lastStep, ?int $now = null): ?int {
    $code = preg_replace('/\s+/', '', $code);
    if (!preg_match('/^\d{6}$/', $code)) return null;
    $cur = intdiv($now ?? time(), TOTP_PERIOD);
    for ($s = $cur - 1; $s <= $cur + 1; $s++) {
        if ($s > $lastStep && hash_equals(totpAt($secret, $s), $code)) return $s;
    }
    return null;
}

/** Eight one-time codes like "k3f9-x2mq": returns [plain codes, JSON of their hashes to store]. */
function totpNewBackup(): array {
    $plain = []; $hashes = [];
    for ($i = 0; $i < TOTP_BACKUP_COUNT; $i++) {
        $c = strtolower(substr(base32Encode(random_bytes(6)), 0, 8));
        $plain[] = substr($c, 0, 4) . '-' . substr($c, 4);
        $hashes[] = hash('sha256', $c);
    }
    return [$plain, json_encode($hashes)];
}

/** Is this the right second step for the account (an app code, or an unused backup code that is then used up)? */
function totpVerifyLogin(PDO $db, array $acc, string $input): bool {
    $secret = totpDecrypt((string)$acc['totp_secret']);
    if ($secret !== null && ($step = totpCheck($secret, $input, (int)$acc['totp_last_step'])) !== null) {
        $db->prepare('UPDATE accounts SET totp_last_step = :s WHERE id = :i AND totp_last_step < :s')->execute([':s' => $step, ':i' => (int)$acc['id']]);
        return true;
    }
    $code = strtolower(preg_replace('/[^a-z0-9]/i', '', $input));
    $list = json_decode((string)$acc['totp_backup'], true) ?: [];
    $i = $code === '' ? false : array_search(hash('sha256', $code), $list, true);
    if ($i === false) return false;
    unset($list[$i]);
    $upd = $db->prepare('UPDATE accounts SET totp_backup = :b WHERE id = :i AND totp_backup = :old');   // two uses of one code at once: only one wins
    $upd->execute([':b' => json_encode(array_values($list)), ':i' => (int)$acc['id'], ':old' => (string)$acc['totp_backup']]);
    return $upd->rowCount() === 1;
}

/** An account with the second step on must not get a session from the password alone. */
function totpEnabled(array $acc): bool { return !empty($acc['totp_enabled']); }
