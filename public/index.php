<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Node // Vector-Box</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// VECTOR-BOX // AUTH_REQUIRED</div>
        <div class="menu-container">
            <button id="menu-toggle-btn" class="nav-btn">// MENU</button>
            
            <div id="dropdown-menu" class="cyber-panel menu-dropdown hidden">
                <a href="resume.html" class="menu-item btn-dossier">// VIEW DOSSIER</a>
                <a href="ads.html" class="menu-item btn-adwall">// AD WALL</a>
                <a href="spia.html" class="menu-item">// WHO'S THE SPY</a> 
                
                <button id="menu-login-btn" class="menu-item">// SYSTEM_LOGIN</button>
                
                <div class="menu-divider"></div>
                
                <div class="settings-section">
                    <span class="settings-title">>_ OPTIONS</span>
                    <div class="toggle-row">
                        <span id="theme-label" class="toggle-label">MODE: NIGHT</span>
                        <label class="cyber-switch">
                            <input type="checkbox" id="theme-toggle">
                            <span class="switch-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <main class="center-container">
        <!-- TOP BOX: INTERACTIVE SHELL TERMINAL -->
        <div class="cyber-panel public-panel auth-panel">
            <div class="terminal-box auth-terminal" id="guest-term-box">
                <div id="guest-term-log">
                    <p class="term-accent">>_ public_node initialized...</p>
                    <p class="term-muted">>_ establishing secure handshake...</p>
                    <p class="term-white">>_ connection stable. Type 'help' for commands.</p>
                </div>
                <div class="terminal-input-line clean-input-line">
                    <span class="prompt-symbol">guest@vector-box:~$</span>
                    <input type="text" id="guest-cmd-input" class="terminal-input" autocomplete="off" autofocus>
                </div>
            </div>
        </div>

        <!-- BOTTOM BOX: PUBLIC UPLINK MESSAGE TRANSMISSION -->
        <div class="cyber-panel public-panel uplink-panel">
            <h2 class="uplink-title">>_ PUBLIC_UPLINK_TERMINAL</h2>
            <p class="uplink-desc">Leave an encrypted transmission for the system administrator. Spamming triggers network isolation.</p>
            
            <textarea id="public-msg-input" class="uplink-textarea" placeholder="Enter transmission data..."></textarea>
            
            <button id="public-send-btn" class="uplink-btn">>_ TRANSMIT MESSAGE</button>
            <div id="public-msg-status" class="uplink-status"></div>
        </div>
    </main>

    <div id="login-modal" class="modal hidden">
        <div class="cyber-panel modal-content">
            <h2>SYSTEM_LOGIN</h2>
            
            <div class="terminal-input-line auth-input-group">
                <span class="prompt-symbol">user:</span>
                <input type="text" id="auth-user" class="terminal-input" placeholder="admin" autocomplete="off">
            </div>

            <div class="terminal-input-line">
                <span class="prompt-symbol">pass:</span>
                <input type="password" id="auth-password" class="terminal-input" autocomplete="off">
            </div>
            
            <p id="login-err" class="err-text"></p>
            <button id="submit-login-btn" class="action-btn execution-btn">AUTHENTICATE</button>
        </div>
    </div>

    <footer class="cyber-footer">
        <a href="credits.html" class="credits-link">ciao zuffi</a>
    </footer>

    <script src="script.js"></script>
</body>
</html>