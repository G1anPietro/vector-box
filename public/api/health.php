<?php
// public/api/health.php — public "is the site up" check for an external monitor. GET -> {"ok","db","time","disk_free_pct"}; 503 when not ok.
// Deliberately says nothing else (no versions, paths, counts). No session.
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/attacks.php';

header('Cache-Control: no-store');
if (!checkRateLimit('health', 60, 60, null, false)) jsonResponse(['ok' => false], 429);   // fail-open by default
$db = false;
try { $db = getDbConnection()->query('SELECT 1')->fetchColumn() == 1; } catch (Throwable $e) { $db = false; }
$pct = attacksDiskPct(dirname(__DIR__, 2) . '/data');
$ok = attacksHealthOk($db, $pct);
jsonResponse(['ok' => $ok, 'db' => $db, 'time' => time(), 'disk_free_pct' => $pct], $ok ? 200 : 503);
