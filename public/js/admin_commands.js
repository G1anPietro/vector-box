// public/js/admin_commands.js
(function () {
    if (typeof commandHandlers === 'undefined') return;

    // Helper to send moderation requests to server
    async function sendModerationCommand(action, targetUser, extra = null) {
        const csrfToken = window.SESSION_STATE?.csrfToken || '';
        const payload = { action, username: targetUser };
        if (extra !== null) payload.minutes = extra;

        try {
            const res = await fetch('api/moderate_user.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'same-origin',
                body: JSON.stringify(payload)
            });
            return await res.json();
        } catch (err) {
            return { success: false, error: 'Network request failed' };
        }
    }

    // Register admin handlers into terminal router
    commandHandlers['/ban'] = async function(args, printGuestLog) {
        const target = args[0];
        if (!target) {
            printGuestLog(">> USAGE: /ban <username>", COLORS.ERROR);
            return;
        }
        printGuestLog(`>> Executing ban sequence on '${target}'...`, COLORS.WARNING);
        const res = await sendModerationCommand('ban', target);
        if (res.success) {
            printGuestLog(`>> SUCCESS: User '${target}' permanently banned.`, COLORS.PRIMARY);
        } else {
            printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
        }
    };

    commandHandlers['/timeout'] = async function(args, printGuestLog) {
        const target = args[0];
        const minutes = parseInt(args[1] || '10', 10);
        if (!target) {
            printGuestLog(">> USAGE: /timeout <username> [minutes]", COLORS.ERROR);
            return;
        }
        printGuestLog(`>> Executing ${minutes}-minute timeout on '${target}'...`, COLORS.WARNING);
        const res = await sendModerationCommand('timeout', target, minutes);
        if (res.success) {
            printGuestLog(`>> SUCCESS: User '${target}' timed out for ${minutes} min(s).`, COLORS.PRIMARY);
        } else {
            printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
        }
    };

    commandHandlers['/unban'] = async function(args, printGuestLog) {
        const target = args[0];
        if (!target) {
            printGuestLog(">> USAGE: /unban <username>", COLORS.ERROR);
            return;
        }
        printGuestLog(`>> Removing restrictions for '${target}'...`, COLORS.INFO);
        const res = await sendModerationCommand('unban', target);
        if (res.success) {
            printGuestLog(`>> SUCCESS: User '${target}' unbanned.`, COLORS.PRIMARY);
        } else {
            printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
        }
    };

    // Aliases without slash
    commandHandlers['ban'] = commandHandlers['/ban'];
    commandHandlers['timeout'] = commandHandlers['/timeout'];
    commandHandlers['unban'] = commandHandlers['/unban'];

    // Register into systemCommands for help lookup & autocomplete
    if (typeof baseSystemCommands !== 'undefined') {
        baseSystemCommands.push('/ban', '/timeout', '/unban');
    }
})();