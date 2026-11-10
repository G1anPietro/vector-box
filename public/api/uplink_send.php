<?php
// public/api/uplink_send.php

// Disabilita il buffering dell'output per inviare il JSON immediatamente
@ini_set('zlib.output_compression', 0);
@ini_set('implicit_flush', 1);
for ($i = 0; $i < ob_get_level(); $i++) {
    @ob_end_clean();
}

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/rate_limiter.php';

header('Content-Type: application/json; charset=utf-8');

try {
    initSession();

    // Rilascia immediatamente il lock della sessione per non bloccare lo stream SSE
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    if (!empty($_SESSION['user_id'])) {
        requireCsrf();
    }

    $senderKey = !empty($_SESSION['user_id']) ? 'u' . $_SESSION['user_id'] : getClientIp();
    if (empty($_SESSION['is_admin']) && !checkRateLimit('chat_send', 8, 10, $senderKey)) {
        jsonResponse(['success' => false, 'error' => 'RATE_LIMIT: Slow down'], 429);
    }

    $rawInput = file_get_contents('php://input');
    $input = json_decode($rawInput, true) ?? [];
    $message = trim($input['message'] ?? '');
    $roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim($input['room_id'] ?? 'general')));

    if (empty($message)) {
        echo json_encode(['success' => false, 'error' => 'Message cannot be empty']);
        exit();
    }

    // Fallback sicuro se mbstring non è installato sul server
    $msgLength = function_exists('mb_strlen') ? mb_strlen($message) : strlen($message);
    if ($msgLength > 500) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'MESSAGE_TOO_LONG: Maximum length is 500 characters']);
        exit();
    }

    $clientIp = getClientIp();
    $userId = $_SESSION['user_id'] ?? null;
    $username = $_SESSION['username'] ?? 'guest';
    $isAdmin = !empty($_SESSION['is_admin']);

    $db = getDbConnection();

    if ($userId) {
        $stmt = $db->prepare("SELECT is_banned, banned_until FROM accounts WHERE id = :id");
        $stmt->execute([':id' => $userId]);
        $account = $stmt->fetch();

        if ($account) {
            if ((int)$account['is_banned'] === 1) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'ACCESS DENIED: Account permanently banned']);
                exit();
            }

            if (!empty($account['banned_until'])) {
                $bannedUntilTime = strtotime($account['banned_until']);
                if ($bannedUntilTime > time()) {
                    $timeLeft = ceil(($bannedUntilTime - time()) / 60);
                    http_response_code(403);
                    echo json_encode(['success' => false, 'error' => "ACCESS RESTRICTED: Timed out for {$timeLeft} more minute(s)"]);
                    exit();
                }
            }
        }
    }

    // Intercetta i comandi di moderazione riservati agli admin
    if (strpos($message, '/') === 0) {
        $parts = explode(' ', $message);
        $cmd = strtolower($parts[0]);

        if (in_array($cmd, ['/ban', '/timeout', '/unban'])) {
            if (!$isAdmin) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'UNAUTHORIZED: Moderation commands require admin rights']);
                exit();
            }

            $targetUser = trim($parts[1] ?? '');
            if (empty($targetUser)) {
                echo json_encode(['success' => false, 'error' => "USAGE: {$cmd} <username>"]);
                exit();
            }

            if ($cmd === '/ban') {
                $stmt = $db->prepare("UPDATE accounts SET is_banned = 1, banned_until = NULL WHERE username = :u AND is_admin = 0");
                $stmt->execute([':u' => $targetUser]);
                
                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found or is an admin"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' permanently banned"]);
                }
                exit();
            }

            if ($cmd === '/timeout') {
                $minutes = isset($parts[2]) ? (int)$parts[2] : 10;
                if ($minutes <= 0) $minutes = 10;
                $minutes = min($minutes, 525600);
                $until = date('Y-m-d H:i:s', strtotime("+{$minutes} minutes"));

                $stmt = $db->prepare("UPDATE accounts SET banned_until = :until WHERE username = :u AND is_admin = 0");
                $stmt->execute([':until' => $until, ':u' => $targetUser]);

                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found or is an admin"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' timed out for {$minutes} minute(s)"]);
                }
                exit();
            }

            if ($cmd === '/unban') {
                $stmt = $db->prepare("UPDATE accounts SET is_banned = 0, banned_until = NULL WHERE username = :u");
                $stmt->execute([':u' => $targetUser]);

                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' unbanned"]);
                }
                exit();
            }
        }
    }

    // Verifica permessi canale
    $stmt = $db->prepare("SELECT is_private, is_hidden FROM rooms WHERE id = :id");
    $stmt->execute([':id' => $roomId]);
    $room = $stmt->fetch();

    if ($room && (int)$room['is_hidden'] === 1 && !$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'FORBIDDEN: Restricted room']);
        exit();
    }

    $isAnnouncementRoom = ($roomId === 'announcements' || $roomId === 'news' || ($room && (int)$room['is_private'] === 1));

    if ($isAnnouncementRoom && !$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => "READ_ONLY: Room '#{$roomId}' is an announcement channel. Only administrators can post."]);
        exit();
    }

    $stmt = $db->prepare("INSERT INTO transmissions (room_id, user_id, username, message, sender_ip) VALUES (:rid, :uid, :uname, :msg, :ip)");
    $stmt->execute([
        ':rid' => $roomId,
        ':uid' => $userId,
        ':uname' => $username,
        ':msg' => $message,
        ':ip' => $clientIp
    ]);

    echo json_encode(['success' => true, 'username' => $username, 'room_id' => $roomId]);
    exit();

} catch (Throwable $e) {
    failInternal('UPLINK_SEND', $e, 'DB_ERROR');
}