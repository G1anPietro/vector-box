<?php
// public/api/get_ip.php — GET: returns the caller's IP as {ip} (via getClientIp(), proxy-aware). Called by the browser tools.
require_once __DIR__ . '/helpers.php';
jsonResponse(['ip' => getClientIp()]);
