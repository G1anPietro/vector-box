<?php
// public/includes/head.php
if (!defined('APP_VERSION')) {
    if (file_exists(__DIR__ . '/../version.php')) {
        require_once __DIR__ . '/../version.php';
    } else {
        define('APP_VERSION', 'v2.4.0');
    }
}

function renderHead($title = "Node // Vector-Box", $isSubpage = false, $customScripts = []) {
    $pathPrefix = $isSubpage ? '../' : '';
    $ver = APP_VERSION;
    ?>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo htmlspecialchars($title); ?></title>
    
    <!-- Centralized CSS Stack -->
    <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/base.css?v=<?php echo $ver; ?>">
    <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/layout.css?v=<?php echo $ver; ?>">
    <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/components.css?v=<?php echo $ver; ?>">
    <link rel="stylesheet" href="<?php echo $pathPrefix; ?>css/widgets.css?v=<?php echo $ver; ?>">

    <!-- Core Engine Scripts -->
    <script src="<?php echo $pathPrefix; ?>js/cookie_consent.js?v=<?php echo $ver; ?>"></script>
    <script src="<?php echo $pathPrefix; ?>js/theme.js?v=<?php echo $ver; ?>"></script>
    <script src="<?php echo $pathPrefix; ?>js/matrix.js?v=<?php echo $ver; ?>" defer></script>
    
    <?php if (!$isSubpage): ?>
        <!-- Desktop OS Exclusive Scripts -->
        <script src="<?php echo $pathPrefix; ?>js/menu.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/terminal.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/commands.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/uplink.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/uplink_feed.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/window_manager.js?v=<?php echo $ver; ?>"></script>
        <script src="<?php echo $pathPrefix; ?>js/poker.js?v=<?php echo $ver; ?>"></script>
    <?php endif; ?>

    <?php foreach ($customScripts as $script): ?>
        <script src="<?php echo $pathPrefix . htmlspecialchars($script); ?>?v=<?php echo $ver; ?>" defer></script>
    <?php endforeach; ?>
    <?php
}
?>