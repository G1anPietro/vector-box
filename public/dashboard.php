<?php
session_start();

// Security Guard: Redirect unauthenticated visitors back to home/login
if (!isset($_SESSION['user'])) {
    header("Location: index.php");
    exit();
}

$user = $_SESSION['user'];
$isAdmin = ($user['role'] === 'admin');

// Backend Action Handler for Fetch requests (Minecraft & Wake-On-LAN)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');
    $action = $_POST['action'];

    // Hardware Power Action (Admin only)
    if ($action === 'wakemainpc' && $isAdmin) {
        exec('/home/user/bin/wakemainpc.sh 2>&1', $output, $returnCode);
        echo json_encode(['success' => ($returnCode === 0)]);
        exit();
    }

    // Minecraft Launch Action (Runs detached in a screen session)
    if ($action === 'start_mc') {
        exec('cd /home/user/minecraft/minecraft_server && screen -dmS mc_server bash start.sh');
        echo json_encode(['success' => true, 'status' => 'initializing']);
        exit();
    }

    // Minecraft Stop Action
    if ($action === 'stop_mc') {
        exec('screen -S mc_server -X stuff "stop^M" || pkill -f server.jar');
        echo json_encode(['success' => true, 'status' => 'terminating']);
        exit();
    }

    echo json_encode(['success' => false, 'error' => 'Unauthorized or unknown action']);
    exit();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hypervisor // Vector-Box</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch" id="dash-welcome">// PROFILED_LAYER: <?php echo htmlspecialchars(strtoupper($user['name'])); ?></div>
        <div style="display: flex; gap: 15px; align-items: center;">
            <a href="/resume.html" class="nav-btn" style="text-decoration: none;">// DOSSIER</a>
            <a href="logout.php" class="nav-btn" style="border-color: #ff3333; color: #ff3333; text-decoration: none;">// DISCONNECT</a>
        </div>
    </header>

    <main class="dashboard-grid">
        <!-- Hardware Panel: Rendered server-side only for Admin role -->
        <?php if ($isAdmin): ?>
        <div class="cyber-panel" id="pc-panel">
            <h2>HARDWARE_POWER</h2>
            <p class="desc-text">Transmit Wake-on-LAN magic broadcast frames to boot the main workstation.</p>
            <button class="action-btn execution-btn" id="wake-pc-btn" style="--btn-color: #8ab4f8; margin-top: 10px;">>_ EXECUTE: wakemainpc</button>
        </div>
        <?php endif; ?>

        <div class="cyber-panel" id="telemetry-panel">
            <h2>SYSTEM_TELEMETRY_STREAM</h2>
            <p class="desc-text">Real-time hardware resource telemetry tracking background daemon impact.</p>
            
            <div class="telemetry-grid">
                <div class="metric-container">
                    <div class="metric-header">
                        <span>CPU_UTILIZATION</span>
                        <span id="cpu-val" style="color: var(--accent-color); font-weight: bold;">0%</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" id="cpu-bar" style="width: 0%;"></div>
                    </div>
                </div>
                
                <div class="metric-container" style="margin-top: 20px;">
                    <div class="metric-header">
                        <span>RAM_UTILIZATION</span>
                        <span id="ram-val" style="color: var(--accent-color); font-weight: bold;">0%</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" id="ram-bar" style="width: 0%;"></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="cyber-panel">
            <h2>MINECRAFT SERVER</h2>
            <p class="desc-text">Boot up or shut down the server world.</p>
            <div class="btn-group">
                <button class="action-btn execution-btn" id="mc-start-btn" style="--btn-color: #00ff66;">START MINECRAFT</button>
                <button class="action-btn execution-btn" id="mc-stop-btn" style="--btn-color: #ff3333;">STOP MINECRAFT</button>
            </div>

            <h3 style="margin-top: 20px; font-size: 0.9rem; color: #8ab4f8;">>_ ACTIVE_CONNECTIONS</h3>
            <div id="player-list-container" style="background: rgba(0,0,0,0.4); border: 1px solid rgba(138, 180, 248, 0.2); padding: 10px; border-radius: 2px; min-height: 40px; display: flex; gap: 10px; flex-wrap: wrap;">
                <span style="color: #555;">// NO_PLAYERS_DETECTED</span>
            </div>

            <h3 style="margin-top: 30px; font-size: 0.9rem; color: #00ff66;">>_ SERVER_CONSOLE</h3>
            <div class="terminal-box">
                <div id="mc-log">Listening to server output...<br></div>
                <div class="terminal-input-line">
                    <span class="prompt-symbol">mc_server@core:~$</span>
                    <div style="position: relative; flex-grow: 1; display: flex; align-items: center;">
                        <span id="ghost-text" style="position: absolute; color: #444; pointer-events: none; white-space: pre; font-family: inherit; font-size: 0.9rem;"></span>
                        <input type="text" id="mc-cmd-input" class="terminal-input" autocomplete="off" style="background: transparent; position: relative; z-index: 2;">
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script src="commands.js"></script>
    <script src="script.js" defer></script>
</body>
</html>