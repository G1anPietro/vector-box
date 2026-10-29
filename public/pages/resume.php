<?php
// public/pages/resume.php
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("Operative Dossier // Resume", true); ?>
    <style>
        .resume-grid { 
            max-width: 800px; 
            margin: 100px auto 40px auto; 
            padding: 0 20px; 
            display: flex; 
            flex-direction: column; 
            gap: 20px; 
            position: relative;
            z-index: 10;
        }
        .skill-tag { 
            background: rgba(0, 255, 102, 0.1); 
            border: 1px solid var(--accent-color); 
            color: var(--accent-color); 
            padding: 6px 12px; 
            font-size: 0.8rem; 
            border-radius: 2px; 
            display: inline-block; 
            margin: 5px 5px 0 0; 
            font-family: monospace;
            font-weight: bold;
        }
        .timeline-item { 
            border-left: 2px solid var(--accent-color); 
            padding-left: 15px; 
            margin-bottom: 20px; 
        }
        .timeline-date { 
            color: var(--accent-color); 
            font-weight: bold; 
            font-size: 0.85rem; 
            font-family: monospace;
        }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// OPERATIVE_DOSSIER: CLASSIFIED</div>
        <a href="../index.php" class="nav-btn" style="text-decoration: none;">// RETURN</a>
    </header>

    <main class="resume-grid">
        <div class="cyber-panel" style="padding: 20px;">
            <h1 style="color: #fff; margin: 0; font-size: 1.8rem; letter-spacing: 2px;">DENYS KHAVRUNIAK</h1>
            <p class="desc-text" style="color: var(--accent-color); font-weight: bold; margin-top: 5px;">COMPUTER SCIENCE STUDENT</p>
            <p class="desc-text" style="margin-top: 15px;">A computer science student specializing in Linux environments, software deployment, and server infrastructure.</p>
        </div>

        <div class="cyber-panel" style="padding: 20px;">
            <h2 style="color: var(--accent-color); border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">>_ CORE_COMPETENCIES</h2>
            <div style="margin-top: 10px;">
                <div class="skill-tag">Linux (Ubuntu/Arch)</div>
                <div class="skill-tag">Network Architecture (NAT/DNS)</div>
                <div class="skill-tag">C / Java / Python / PHP</div>
                <div class="skill-tag">Hardware Assembly</div>
            </div>
        </div>

        <div class="cyber-panel" style="padding: 20px;">
            <h2 style="color: var(--accent-color); border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">>_ RECENT_DEPLOYMENTS</h2>
            
            <div class="timeline-item" style="margin-top: 15px;">
                <div class="timeline-date">2026 - PRESENT</div>
                <h3 style="margin: 5px 0; font-size: 1.1rem; color: #fff;">Project: Vector-Box Infrastructure</h3>
                <p class="desc-text">Engineered a screenless laptop into a headless home server running Ubuntu. Deployed Node.js reverse-proxy pipelines, configured Zyxel NAT routing, and established dynamic DNS architecture.</p>
            </div>

            <div class="timeline-item">
                <div class="timeline-date">HIGH SCHOOL // 4° YEAR INFORMATICS</div>
                <h3 style="margin: 5px 0; font-size: 1.1rem; color: #fff;">Hardware & OS Specialization</h3>
                <p class="desc-text">Diagnosed motherboard logic issues, configured custom multi-boot environments (Windows 11 / Linux), managed drive partitioning utilities (GParted), and sourced components for upgrades.</p>
            </div>
        </div>
    </main>
</body>
</html>