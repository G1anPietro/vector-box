<?php
// public/includes/appunti-top.php — the bar at the top of every page of the class notes: the same four buttons everywhere
// (Archivio, Carica, Guida, Impostazioni) so that nothing is "only on some pages". Usage: appuntiTop('archivio', $username)
function appuntiTop(string $current, string $username = ''): void {
    $e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
    $item = function (string $key, string $href, string $label, string $class = 'top-btn', string $extra = '') use ($current, $e) {
        $cur = $current === $key;
        echo '<a class="' . $e($class) . ($cur ? ' current' : '') . '" href="' . $e($href) . '"' . ($cur ? ' aria-current="page"' : '') . $extra . '>' . $e($label) . '</a>' . "\n";
    };
    ?>
    <header class="top app-top">
        <?php if ($current === 'appunti'): ?>
            <a class="home" href="../index.php">vector-box</a>
        <?php else: ?>
            <a class="home back-link" href="appunti.php">Appunti</a>
        <?php endif; ?>
        <nav class="top-right app-nav" aria-label="Appunti di classe">
            <?php $item('archivio', 'appunti-archivio.php', 'Archivio', 'top-btn needs-class'); ?>
            <?php $item('carica', 'appunti-carica.php', 'Carica', 'top-btn primary ico-up needs-class'); ?>
            <?php $item('guida', 'appunti-guida.php', 'Guida'); ?>
            <?php if ($username !== ''): ?><span class="who hide-phone"><?= $e($username) ?></span><?php endif; ?>
            <a id="bell" class="bell<?= $current === 'impostazioni' ? ' current' : '' ?>" href="appunti-impostazioni.php" aria-label="Impostazioni e notifiche" title="Impostazioni e notifiche"<?= $current === 'impostazioni' ? ' aria-current="page"' : '' ?>>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>
                <span id="bell-count" class="bell-count" hidden></span>
            </a>
        </nav>
    </header>
    <?php
}
