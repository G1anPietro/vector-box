<?php
// public/includes/head.php
// Every page includes this before any output: send the security headers here.
require_once __DIR__ . '/../api/helpers.php';
sendPageSecurityHeaders();
require_once __DIR__ . '/../api/visits.php';
recordVisit((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

// updatesite.sh writes version.php in the project root, outside public/ (it is not web-reachable).
// APP_VERSION is the ?v= cache-buster of every CSS/JS file, so it must change on each deploy.
if (!defined('APP_VERSION')) {
    $versionFile = dirname(__DIR__, 2) . '/version.php';
    if (file_exists($versionFile)) {
        require_once $versionFile;
    }
    unset($versionFile);
}
if (!defined('APP_VERSION')) define('APP_VERSION', 'v2.4.0');
if (!defined('BUILD_DATE')) define('BUILD_DATE', date('Y-m-d'));
if (!defined('BUILD_HASH')) define('BUILD_HASH', 'dev');

function renderHead($title = "Node // Vector-Box", $isSubpage = false, $customScripts = [], $isLightPage = false) {
    $pathPrefix = $isSubpage ? '../' : '';
    $ver = APP_VERSION;
    ?>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($title); ?></title>
    
    <script src="<?php echo $pathPrefix; ?>js/csrf.js?v=<?php echo $ver; ?>"></script>

    <?php if ($isLightPage): ?>
        <!-- Standalone Light Theme Stack for Reader -->
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/reader.css?v=<?php echo $ver; ?>">
    <?php else: ?>
        <!-- Centralized Cyberpunk CSS Stack -->
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/base.css?v=<?php echo $ver; ?>">
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/layout.css?v=<?php echo $ver; ?>">
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/components.css?v=<?php echo $ver; ?>">
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/widgets.css?v=<?php echo $ver; ?>">
        <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/mobile.css?v=<?php echo $ver; ?>">

        <!-- Core Engine Scripts -->
        <script src="<?php echo $pathPrefix; ?>js/cookie_consent.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/theme.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/matrix.js?v=<?php echo $ver; ?>" defer></script>
        
        <?php if (!$isSubpage): ?>
            <!-- Desktop OS Exclusive Scripts -->
            <script src="<?php echo $pathPrefix; ?>js/menu.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/terminal.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/commands.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/uplink.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/uplink_feed.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/window_manager.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/mobile.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/poker.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/tools.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/status.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/guestbook.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/dm.js?v=<?php echo $ver; ?>" defer></script>
            <script src="<?php echo $pathPrefix; ?>js/arg.js?v=<?php echo $ver; ?>" defer></script>
        <?php endif; ?>
    <?php endif; ?>

    <?php foreach ($customScripts as $script): ?>
        <script src="<?php echo $pathPrefix . htmlspecialchars($script); ?>?v=<?php echo $ver; ?>" defer></script>
    <?php endforeach; ?>
    <?php
}
?>