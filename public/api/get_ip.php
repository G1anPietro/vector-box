<?php
require_once __DIR__ . '/helpers.php';
jsonResponse(['ip' => getClientIp()]);
