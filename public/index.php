<?php
require_once __DIR__ . '/includes/head.php';
if (file_exists('version.php')) {
    require_once 'version.php';
} else {
    define('BUILD_DATE', date('Y-m-d'));
    define('BUILD_HASH', 'dev');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("Node // Vector-Box", false); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // AUTH_REQUIRED</div>
        <div class="menu-container">
            <button id="menu-toggle-btn" class="nav-btn" type="button">// MENU</button>
            
            <div id="dropdown-menu" class="cyber-panel menu-dropdown hidden">
                <a href="pages/resume.php" class="menu-item btn-dossier">// VIEW DOSSIER</a>
                <a href="pages/ads.php" class="menu-item btn-adwall">// AD WALL</a>
                <a href="pages/spia.html" class="menu-item">// WHO'S THE SPY</a> 
                <a href="pages/hack.php" class="menu-item">// NODE BREACH</a>
                <a href="pages/vault.php" class="menu-item">// ARG VAULT</a>
                
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
                        <span class="toggle-label">HIGH CONTRAST</span>
                        <label class="cyber-switch">
                            <input type="checkbox" id="contrast-toggle">
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

                    <div class="cyber-slider-row" style="margin-top: 10px;">
                        <span class="toggle-label" style="font-size: 0.75rem; color: var(--text-muted);">DESKTOP_RICE</span>
                        <select id="rice-selector" class="nav-btn" style="width: 100%; text-align: left; padding: 4px 8px; font-size: 0.8rem; background: #020304;">
                            <option value="cyan">Cyan (Default)</option>
                            <option value="matrix">Matrix</option>
                            <option value="amber">Amber</option>
                            <option value="cyberpunk">Cyberpunk</option>
                            <option value="dracula">Dracula</option>
                            <option value="synthwave">Synthwave</option>
                            <option value="nord">Nord</option>
                            <option value="monochrome">Monochrome</option>
                            <option value="blood">Blood</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <main class="desktop-viewport">
        <!-- 1. SHELL TERMINAL -->
        <div id="win-terminal" class="cyber-panel draggable-window" style="top: 90px; left: 40px; width: 580px; height: 380px;">
            <div class="window-header">
                <span>>_ TERMINAL</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div class="terminal-box auth-terminal" id="guest-term-box">
                <div id="guest-term-log">
                    <p class="term-accent">>_ public_node initialized...</p>
                    <p class="term-muted">>_ establishing secure handshake...</p>
                    <p class="term-white">>_ connection stable. Type 'help' for commands.</p>
                </div>
                <div class="terminal-input-line clean-input-line">
                    <span class="prompt-symbol">guest@vector-box:~$</span>
                    <input type="text" id="guest-cmd-input" class="terminal-input" autocomplete="off" name="terminal_command_input">
                </div>
            </div>
        </div>

        <!-- 2. CHAT FEED -->
        <div id="win-chatfeed" class="cyber-panel draggable-window" style="top: 90px; left: 640px; width: 480px; height: 380px;">
            <div class="window-header">
                <span>>_ CHAT_FEED</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div id="chat-room-tabs" class="chat-tab-bar"></div>
            <div class="terminal-box auth-terminal" id="feed-term-box">
                <div id="uplink-chat-log"></div>
                <div class="terminal-input-line clean-input-line">
                    <span class="prompt-symbol" id="chat-prompt-label">#general:$</span>
                    <input type="text" id="chat-feed-input" class="terminal-input" placeholder="Type message to feed..." autocomplete="off">
                </div>
            </div>
        </div>

        <!-- 3. PUBLIC UPLINK TRANSMISSION -->
        <div id="win-msgbox" class="cyber-panel draggable-window public-panel uplink-panel" style="top: 490px; left: 40px; width: 580px; height: 260px;">
            <div class="window-header">
                <span>>_ PUBLIC_UPLINK_TERMINAL</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div class="window-content-inner">
                <p class="uplink-desc">Leave an encrypted transmission for the system administrator.</p>
                <textarea id="public-msg-input" class="uplink-textarea" placeholder="Enter transmission data..."></textarea>
                <button id="public-send-btn" type="button" class="uplink-btn">>_ TRANSMIT MESSAGE</button>
                <div id="public-msg-status" class="uplink-status"></div>
            </div>
        </div>

        <!-- 4. CYBERPUNK POKER MINIGAME CONTAINER -->
        <div id="win-poker" class="cyber-panel draggable-window hidden" style="top: 140px; left: 240px; width: 620px; height: 460px;">
            <div class="window-header">
                <span>>_ CYBER_POKER // NEON_HOLDEM</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div class="window-content-inner" style="padding: 10px; display: flex; flex-direction: column; justify-content: space-between; height: calc(100% - 30px);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">
                    <div style="display: flex; flex-direction: column;">
                        <span class="term-accent" style="font-weight: bold; font-size: 0.9rem;">POT: <span id="poker-pot-val">0</span> CR</span>
                        <span id="poker-stage-indicator" style="font-size: 0.75rem; color: var(--text-muted);">STAGE: WAITING</span>
                    </div>
                    <div id="poker-community-cards" style="display: flex; gap: 6px;"></div>
                </div>

                <div id="poker-seats-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0;"></div>

                <div id="poker-winner-banner" class="hidden" style="background: rgba(0, 255, 102, 0.15); border: 1px solid var(--accent-color); padding: 8px; text-align: center; font-size: 0.85rem; font-weight: bold; margin-bottom: 8px;"></div>

                <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 8px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span style="font-size: 0.75rem; color: var(--text-muted);">BET:</span>
                        <input type="number" id="poker-bet-input" value="40" min="10" step="10" style="width: 70px; background: rgba(0,0,0,0.8); border: 1px solid var(--border-color); color: #fff; padding: 4px; font-family: monospace; font-size: 0.85rem; outline: none;">
                        <button id="poker-btn-raise" type="button" class="nav-btn" style="flex: 1; border-color: #ffaa00; color: #ffaa00; padding: 4px 8px; font-size: 0.75rem;">RAISE / BET</button>
                    </div>

                    <div style="display: flex; gap: 6px;">
                        <button id="poker-btn-join" type="button" class="nav-btn" style="flex: 1; padding: 6px; font-size: 0.75rem;">SEAT</button>
                        <button id="poker-btn-leave" type="button" class="nav-btn" style="flex: 1; border-color: #ff3333; color: #ff3333; padding: 6px; font-size: 0.75rem;">LEAVE</button>
                        <button id="poker-btn-deal" type="button" class="nav-btn" style="flex: 1; border-color: #ffaa00; color: #ffaa00; padding: 6px; font-size: 0.75rem;">DEAL</button>
                        <button id="poker-btn-fold" type="button" class="nav-btn" style="flex: 1; border-color: #ff3333; color: #ff3333; padding: 6px; font-size: 0.75rem;">FOLD</button>
                        <button id="poker-btn-call" type="button" class="nav-btn" style="flex: 1; border-color: #00f3ff; color: #00f3ff; padding: 6px; font-size: 0.75rem;">CALL/CHECK</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 5. DEVELOPER / SECURITY TOOLBOX WORKBENCH -->
        <div id="win-tools" class="cyber-panel draggable-window hidden" style="top: 150px; left: 180px; width: 520px; height: 360px;">
            <div class="window-header">
                <span>>_ TOOLBOX // ENCODER_CONVERTER</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div class="window-content-inner">
                <div class="tools-container">
                    <select id="tool-mode" class="tools-select">
                        <option value="b64-enc">Base64 Encode</option>
                        <option value="b64-dec">Base64 Decode</option>
                        <option value="url-enc">URL Encode</option>
                        <option value="url-dec">URL Decode</option>
                        <option value="hex-enc">Hex Encode</option>
                        <option value="sha256">SHA-256 Hash</option>
                    </select>
                    <textarea id="tool-input" class="tools-textarea" placeholder="Input raw string..."></textarea>
                    <textarea id="tool-output" class="tools-textarea" placeholder="Converted result..." readonly></textarea>
                </div>
            </div>
        </div>

        <!-- 6. ARG CIPHER VAULT WINDOW -->
        <div id="win-vault" class="cyber-panel draggable-window hidden" style="top: 200px; left: 320px; width: 520px; height: 320px;">
            <div class="window-header">
                <span>>_ SYSTEM // CIPHER_VAULT</span>
                <div class="win-controls">
                    <button class="win-btn win-btn-min" title="Minimize">_</button>
                    <button class="win-btn win-btn-max" title="Maximize">□</button>
                    <button class="win-btn win-btn-close" title="Close">X</button>
                </div>
            </div>
            <div class="window-content-inner">
                <div class="vault-container" style="gap: 10px;">
                    <p class="term-muted" style="margin: 0; font-size: 0.8rem;">ENTER DISCOVERED PASSPHRASE KEY:</p>
                    <div class="terminal-input-line">
                        <span class="prompt-symbol">KEY:</span>
                        <input type="text" id="vault-key-input" class="terminal-input" placeholder="Enter key..." autocomplete="off">
                    </div>
                    <button id="vault-unlock-btn" class="nav-btn hack-reset-btn" style="max-width: 100%;">>_ SUBMIT KEY</button>
                    <div id="vault-output" class="vault-output-box" style="min-height: 80px;"></div>
                </div>
            </div>
        </div>
    </main>

    <!-- CONSOLIDATED APPLICATION TASKBAR & FOOTER -->
    <div class="cyber-taskbar" id="cyber-taskbar">
        <div class="taskbar-apps">
            <button class="taskbar-btn active" id="tb-win-terminal">>_ TERMINAL</button>
            <button class="taskbar-btn active" id="tb-win-chatfeed">>_ CHAT_FEED</button>
            <button class="taskbar-btn active" id="tb-win-msgbox">>_ UPLINK</button>
            <button class="taskbar-btn" id="tb-win-poker">>_ POKER</button>
            <button class="taskbar-btn" id="tb-win-tools">>_ TOOLS</button>
            <button class="taskbar-btn" id="tb-win-vault">>_ VAULT</button>
        </div>
        <div class="taskbar-info">
            <span class="term-muted">BUILD // <?php echo APP_VERSION; ?>-<?php echo BUILD_HASH; ?> (<?php echo BUILD_DATE; ?>)</span>
            <a href="pages/credits.php" class="credits-link">ciao zuffi</a>
        </div>
    </div>
</body>
</html>