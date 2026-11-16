<?php
// public/api/donors.php — the list of donors, kept by the admin by hand (the site never sees payments).
//   GET  ?action=list                                            -> every row (admin only)
//   POST {action:'add', amount, username?, name?, date?, public?, note?}
//   POST {action:'remove', id}
//   POST {action:'badge', username, value}                      -> the supporter badge by hand (a row of 0 euro, note 'badge')
//   POST {action:'ads_free', username, value}                    -> accounts that never see ads
// A donor with an account gets the supporter badge. Public = may appear on pages/soldi.php (name chosen by the donor).
require_once __DIR__ . '/database.php';

initSession();
requireAdmin();
$db = getDbConnection();

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        $rows = $db->query('SELECT d.id, d.account_id, a.username, d.display_name, d.amount_cents, d.currency, d.donated_at, d.is_public, d.note
                            FROM donors d LEFT JOIN accounts a ON a.id = d.account_id ORDER BY d.donated_at DESC, d.id DESC LIMIT 500')->fetchAll();
        $ads = $db->query('SELECT username FROM accounts WHERE ads_free = 1 ORDER BY username')->fetchAll(PDO::FETCH_COLUMN);
        jsonResponse(['success' => true, 'donors' => $rows, 'ads_free' => $ads]);
    }

    requireCsrf();
    $in = readJsonBody();
    $action = (string)($in['action'] ?? '');

    if ($action === 'add') {
        $amount = (float)str_replace(',', '.', (string)($in['amount'] ?? '0'));
        if ($amount < 0 || $amount > 100000) jsonResponse(['success' => false, 'error' => 'Invalid amount.'], 400);
        $date = (string)($in['date'] ?? '');
        if ($date === '') $date = date('Y-m-d');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !checkdate((int)substr($date, 5, 2), (int)substr($date, 8, 2), (int)substr($date, 0, 4))) {
            jsonResponse(['success' => false, 'error' => 'Invalid date (YYYY-MM-DD).'], 400);
        }
        $accountId = null;
        $username = trim((string)($in['username'] ?? ''));
        if ($username !== '') {
            $st = $db->prepare('SELECT id FROM accounts WHERE username = :u');
            $st->execute([':u' => $username]);
            $accountId = $st->fetchColumn();
            if ($accountId === false) jsonResponse(['success' => false, 'error' => "User '$username' not found."], 404);
            $accountId = (int)$accountId;
        }
        $name = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($in['name'] ?? '')) ?? '');
        $note = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string)($in['note'] ?? '')) ?? '');
        $db->prepare('INSERT INTO donors (account_id, display_name, amount_cents, currency, donated_at, is_public, note, created_at)
                      VALUES (:a, :n, :c, :cur, :d, :p, :note, :t)')
           ->execute([':a' => $accountId, ':n' => textCut($name, 40), ':c' => (int)round($amount * 100), ':cur' => 'EUR', ':d' => $date,
                      ':p' => !empty($in['public']) ? 1 : 0, ':note' => textCut($note, 200), ':t' => time()]);
        jsonResponse(['success' => true, 'id' => (int)$db->lastInsertId(),
                      'message' => 'Donation recorded' . ($accountId ? " (supporter badge for '$username')" : '') . '.']);
    }

    if ($action === 'remove') {
        $st = $db->prepare('DELETE FROM donors WHERE id = :i');
        $st->execute([':i' => (int)($in['id'] ?? 0)]);
        jsonResponse($st->rowCount() ? ['success' => true, 'message' => 'Removed.'] : ['success' => false, 'error' => 'Not found.'], $st->rowCount() ? 200 : 404);
    }

    if ($action === 'badge') {
        $username = trim((string)($in['username'] ?? ''));
        $st = $db->prepare('SELECT id FROM accounts WHERE username = :u');
        $st->execute([':u' => $username]);
        $id = $st->fetchColumn();
        if ($id === false) jsonResponse(['success' => false, 'error' => "User '$username' not found."], 404);
        if (!empty($in['value'])) {
            $has = $db->prepare("SELECT 1 FROM donors WHERE account_id = :a AND note = 'badge'");
            $has->execute([':a' => $id]);
            if (!$has->fetchColumn()) {
                $db->prepare("INSERT INTO donors (account_id, display_name, amount_cents, currency, donated_at, is_public, note, created_at)
                              VALUES (:a, '', 0, 'EUR', :d, 0, 'badge', :t)")->execute([':a' => $id, ':d' => date('Y-m-d'), ':t' => time()]);
            }
            jsonResponse(['success' => true, 'message' => "Supporter badge given to '$username'."]);
        }
        $db->prepare("DELETE FROM donors WHERE account_id = :a AND note = 'badge'")->execute([':a' => $id]);
        jsonResponse(['success' => true, 'message' => "Manual badge removed from '$username' (a real donation keeps it)."]);
    }

    if ($action === 'ads_free') {
        $username = trim((string)($in['username'] ?? ''));
        $st = $db->prepare('UPDATE accounts SET ads_free = :v WHERE username = :u');
        $st->execute([':v' => !empty($in['value']) ? 1 : 0, ':u' => $username]);
        jsonResponse($st->rowCount()
            ? ['success' => true, 'message' => "Ads " . (!empty($in['value']) ? 'hidden for' : 'shown again to') . " '$username'."]
            : ['success' => false, 'error' => "User '$username' not found."], $st->rowCount() ? 200 : 404);
    }

    jsonResponse(['success' => false, 'error' => 'Invalid action.'], 400);
} catch (Throwable $e) {
    failInternal('DONORS', $e);
}
