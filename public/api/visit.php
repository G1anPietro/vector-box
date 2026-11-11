<?php
// public/api/visit.php — beacon for the static pages (games), which don't go through PHP.
// GET ?p=/pages/spia.html -> 204. Only records a visit (see visits.php); changes nothing else,
// so no CSRF token is needed (and a beacon can't send one).
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/rate_limiter.php';
require_once __DIR__ . '/visits.php';

header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET' || !checkRateLimit('visit_beacon', 30, 60)) {
    http_response_code(204);
    exit();
}
$page = (string)($_GET['p'] ?? '');
if (!preg_match('#^/[A-Za-z0-9_./-]{0,100}$#', $page)) $page = '/?';
recordVisit($page);
http_response_code(204);
