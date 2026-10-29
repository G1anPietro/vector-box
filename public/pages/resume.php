<?php
require_once __DIR__ . '/../includes/head.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php renderHead("Operative Dossier // Resume", true); ?>
</head>
<body>
    <canvas id="canvas"></canvas>

    <header class="cyber-header">
        <div class="glitch">// OPERATIVE_DOSSIER: CLASSIFIED</div>
        <a href="../index.php" class="nav-btn">// RETURN</a>
    </header>

    <main class="resume-grid">
        <div class="cyber-panel panel-padded">
            <h1 class="dossier-title">DENYS KHAVRUNIAK</h1>
            <p class="desc-text text-accent-bold">COMPUTER SCIENCE STUDENT</p>
            <p class="desc-text space-top-sm">A computer science student specializing in Linux environments, software deployment, and server infrastructure.</p>
        </div>

        <div class="cyber-panel panel-padded">
            <h2 class="panel-section-title">>_ CORE_COMPETENCIES</h2>
            <div class="tag-container">
                <div class="skill-tag">Linux (Ubuntu/Arch)</div>
                <div class="skill-tag">Network Architecture (NAT/DNS)</div>
                <div class="skill-tag">C / Java / Python / PHP</div>
                <div class="skill-tag">Hardware Assembly</div>
            </div>
        </div>

        <div class="cyber-panel panel-padded">
            <h2 class="panel-section-title">>_ RECENT_DEPLOYMENTS</h2>
            
            <div class="timeline-item space-top-sm">
                <div class="timeline-date">2026 - PRESENT</div>
                <h3 class="timeline-heading">Project: Vector-Box Infrastructure</h3>
                <p class="desc-text">Engineered a screenless laptop into a headless home server running Ubuntu. Deployed Node.js reverse-proxy pipelines, configured Zyxel NAT routing, and established dynamic DNS architecture.</p>
            </div>

            <div class="timeline-item">
                <div class="timeline-date">HIGH SCHOOL // 4° YEAR INFORMATICS</div>
                <h3 class="timeline-heading">Hardware & OS Specialization</h3>
                <p class="desc-text">Diagnosed motherboard logic issues, configured custom multi-boot environments (Windows 11 / Linux), managed drive partitioning utilities (GParted), and sourced components for upgrades.</p>
            </div>
        </div>
    </main>
</body>
</html>