<?php
// public/api/uplink_send.php
require_once __DIR__ . '/database.php';

initSession();
header('Content-Type: application/json');

if (!empty($_SESSION['user_id'])) {
    $csrfHeader =$_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $sessionToken =$_SESSION['csrf_token'] ?? '';

    if (empty($sessionToken) || !hash_equals($sessionToken,$csrfHeader)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'FORBIDDEN: Invalid CSRF token']);
        exit();
    }
}

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true) ?? [];
$message = trim($input['message'] ?? '');
$roomId = preg_replace('/[^a-zA-Z0-9_\-]/', '', strtolower(trim($input['room_id'] ?? 'general')));

if (empty($message)) {
    echo json_encode(['success' => false, 'error' => 'Message cannot be empty']);
    exit();
}

if (mb_strlen($message) > 500) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'MESSAGE_TOO_LONG: Maximum length is 500 characters']);
    exit();
}

$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
$userId =$_SESSION['user_id'] ?? null;
$username =$_SESSION['username'] ?? 'guest';
$isAdmin = !empty($_SESSION['is_admin']);

try {
    $db = getDbConnection();

    if ($userId) {
        $stmt =$db->prepare("SELECT is_banned, banned_until FROM accounts WHERE id = :id");
        $stmt->execute([':id' =>$userId]);
        $account =$stmt->fetch();

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

    // Intercept moderation commands reserved for admin
    if (strpos($message, '/') === 0) {
        $parts = explode(' ',$message);
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
                $stmt =$db->prepare("UPDATE accounts SET is_banned = 1, banned_until = NULL WHERE username = :u AND is_admin = 0");
                $stmt->execute([':u' =>$targetUser]);
                
                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found or is an admin"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' permanently banned"]);
                }
                exit();
            }

            if ($cmd === '/timeout') {$minutes = isset($parts[2]) ? (int)$parts[2] : 10;
                if ($minutes <= 0)$minutes = 10;
                $until = date('Y-m-d H:i:s', strtotime("+{$minutes} minutes"));

                $stmt =$db->prepare("UPDATE accounts SET banned_until = :until WHERE username = :u AND is_admin = 0");
                $stmt->execute([':until' => $until, ':u' =>$targetUser]);

                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found or is an admin"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' timed out for {$minutes} minute(s)"]);
                }
                exit();
            }

            if ($cmd === '/unban') {
                $stmt =$db->prepare("UPDATE accounts SET is_banned = 0, banned_until = NULL WHERE username = :u");
                $stmt->execute([':u' =>$targetUser]);

                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'error' => "User '{$targetUser}' not found"]);
                } else {
                    echo json_encode(['success' => false, 'error' => "COMMAND SUCCESS: User '{$targetUser}' unbanned"]);
                }
                exit();
            }
        }
    }

    // Verify channel permissions
    $stmt =$db->prepare("SELECT is_private FROM rooms WHERE id = :id");
    $stmt->execute([':id' =>$roomId]);
    $room =$stmt->fetch();

    $isAnnouncementRoom = ($roomId === 'announcements' \vert{}\vert{}$roomId === 'news' || ($room && (int)$room['is_private'] === 1));

    if ($isAnnouncementRoom && !$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => "READ_ONLY: Room '#{$roomId}' is an announcement channel. Only administrators can post."]);
        exit();
    }

    $stmt =$db->prepare("INSERT INTO transmissions (room_id, user_id, username, message, sender_ip) VALUES (:rid, :uid, :uname, :msg, :ip)");
    $stmt->execute([
        ':rid' => $roomId,
        ':uid' => $userId,
        ':uname' => $username,
        ':msg' => $message,
        ':ip' => $clientIp
    ]);

    echo json_encode(['success' => true, 'username' => $username, 'room_id' =>$roomId]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}