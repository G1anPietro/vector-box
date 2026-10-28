<?php
if (file_exists('version.php')) {
    require_once 'version.php';
} else {
    define('APP_VERSION', 'v2.4.0');
    define('BUILD_DATE', date('Y-m-d'));
    define('BUILD_HASH', 'dev');
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Node // Vector-Box</title>
    <link rel="stylesheet" href="css/style.css?v=<?php echo APP_VERSION; ?>">
    <script src="js/menu.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/cookie_consent.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/theme.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/matrix.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/terminal.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/commands.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/uplink.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/uplink_feed.js?v=<?php echo APP_VERSION; ?>"></script>
    <script src="js/window_manager.js?v=<?php echo APP_VERSION; ?>"></script>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // AUTH_REQUIRED</div>
        <div class="menu-container">
            <button id="menu-toggle-btn" class="nav-btn" type="button">// MENU</button>
            
            <div id="dropdown-menu" class="cyber-panel menu-dropdown hidden">
                <a href="pages/resume.html" class="menu-item btn-dossier">// VIEW DOSSIER</a>
                <a href="pages/ads.html" class="menu-item btn-adwall">// AD WALL</a>
                <a href="pages/spia.html" class="menu-item">// WHO'S THE SPY</a> 
                <a href="pages/hack.html" class="menu-item">// NODE BREACH</a>
                
                <button id="menu-login-btn" class="menu-item" type="button">// USER_ACCOUNT</button>
                
                <div class="settings-section">
                    <span class="settings-title">>_ OPTIONS</span>
                    
                    <div class="toggle-row">
                        <span id="theme-label" class="toggle-label">MODE: NIGHT</span>
                        <label class="cyber-switch">
                            <input type="checkbox" id="theme-toggle">
                            <span class="switch-slider"></span>
                        </label>
                    </div>

                    <div class="toggle-row" style="margin-top: 8px;">
                        <span class="toggle-label">SCANLINES</span>
                        <label class="cyber-switch">
                            <input type="checkbox" id="scanline-toggle">
                            <span class="switch-slider"></span>
                        </label>
                    </div>

                    <div class="cyber-slider-row">
                        <span class="toggle-label" style="font-size: 0.75rem; color: var(--text-muted);">MATRIX_SPEED</span>
                        <input type="range" id="matrix-speed-slider" class="cyber-range" min="10" max="70" value="45">
                    </div>
                </div>
            </div>
        </div>
    </header>

    <main class="desktop-viewport">
        <!-- 1. SHELL TERMINAL CONTAINER -->
        <div id="win-terminal" class="cyber-panel draggable-window" style="top: 100px; left: 60px; width: 620px; height: 440px;">
            <div class="window-header">>_ TERMINAL</div>
            <div class="terminal-box auth-terminal" id="guest-term-box">
                <div id="guest-term-log">
                    <p class="term-accent">>_ public_node initialized...</p>
                    <p class="term-muted">>_ establishing secure handshake...</p>
                    <p class="term-white">>_ connection stable. Type 'help' for commands.</p>
                </div>
                <div class="terminal-input-line clean-input-line">
                    <span class="prompt-symbol">guest@vector-box:~$</span>
                    <input type="text" 
                        id="guest-cmd-input" 
                        class="terminal-input" 
                        autocomplete="off" 
                        autocorrect="off" 
                        autocapitalize="off" 
                        spellcheck="false" 
                        name="terminal_command_input">
                </div>
            </div>
        </div>

        <!-- 2. REAL-TIME CHAT FEED CONTAINER -->
        <div id="win-chatfeed" class="cyber-panel draggable-window" style="top: 100px; left: 710px; width: 440px; height: 440px;">
            <div class="window-header">>_ CHAT_FEED</div>
            <div class="terminal-box auth-terminal" id="feed-term-box">
                <div id="uplink-chat-log"></div>
                <div class="terminal-input-line clean-input-line">
                    <span class="prompt-symbol">chat@vector-box:~$</span>
                    <input type="text" 
                        id="chat-feed-input" 
                        class="terminal-input" 
                        placeholder="Type message to feed..." 
                        autocomplete="off" 
                        autocorrect="off" 
                        autocapitalize="off" 
                        spellcheck="false"
                        name="chat_feed_input">
                </div>
            </div>
        </div>

        <!-- 3. PUBLIC UPLINK TRANSMISSION CONTAINER -->
        <div id="win-msgbox" class="cyber-panel draggable-window public-panel uplink-panel" style="top: 560px; left: 240px; width: 720px; height: 260px;">
            <div class="window-header">>_ PUBLIC_UPLINK_TERMINAL</div>
            <div class="window-content-inner">
                <p class="uplink-desc">Leave an encrypted transmission for the system administrator. Spamming triggers network isolation.</p>
                
                <textarea id="public-msg-input" 
                    class="uplink-textarea" 
                    placeholder="Enter transmission data..." 
                    autocomplete="off" 
                    autocorrect="off" 
                    autocapitalize="off" 
                    spellcheck="false"
                    name="public_transmission_text"></textarea>
                
                <button id="public-send-btn" type="button" class="uplink-btn">>_ TRANSMIT MESSAGE</button>
                <div id="public-msg-status" class="uplink-status"></div>
            </div>
        </div>
    </main>

    <div id="login-modal" class="modal hidden">
        <div class="cyber-panel modal-content">
            <h2>ACCOUNT_LOGIN</h2>
            
            <div class="terminal-input-line auth-input-group">
                <span class="prompt-symbol">user:</span>
                <input type="text" id="auth-user" class="terminal-input" placeholder="username" autocomplete="username">
            </div>

            <div class="terminal-input-line">
                <span class="prompt-symbol">pass:</span>
                <input type="password" id="auth-password" class="terminal-input" placeholder="••••••••" autocomplete="current-password">
            </div>
            
            <p id="login-err" class="err-text"></p>
            <button id="submit-login-btn" type="button" class="action-btn execution-btn">AUTHENTICATE</button>
        </div>
    </div>

    <!-- BANNER CONSENSO COOKIE GDPR -->
    <div id="cookie-banner" class="cyber-panel cookie-popup hidden">
        <div class="cookie-content">
            <span class="term-accent">>_ COOKIE_POLICY_NOTICE</span>
            <p class="desc-text" style="font-size: 0.75rem; margin: 8px 0;">
                This node uses local cookies to preserve system preferences (Matrix colors, theme presets). No telemetry tracking or third-party cookies are set.
            </p>
            <div class="btn-group" style="margin-top: 10px;">
                <button id="cookie-accept-btn" type="button" class="nav-btn" style="padding: 4px 12px; font-size: 0.75rem;">ACCEPT</button>
                <button id="cookie-decline-btn" type="button" class="nav-btn" style="border-color: #ff3333; color: #ff3333; padding: 4px 12px; font-size: 0.75rem;">DECLINE</button>
            </div>
        </div>
    </div>

    <footer class="cyber-footer">
        <span class="term-muted">BUILD // <?php echo APP_VERSION; ?>-<?php echo BUILD_HASH; ?> (<?php echo BUILD_DATE; ?>)</span>
        <a href="pages/credits.html" class="credits-link">ciao zuffi</a>
    </footer>
</body>
</html>