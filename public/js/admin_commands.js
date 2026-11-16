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

    // Helper for book permissions management
    async function sendBookAccessCommand(action, targetUser, scope = 'books') {
        const csrfToken = window.SESSION_STATE?.csrfToken || '';
        try {
            const res = await fetch('api/moderate_book_access.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'same-origin',
                body: JSON.stringify({ action, username: targetUser, scope })
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

    // New Book Reader Access Commands
    commandHandlers['/grantbook'] = async function(args, printGuestLog) {
        const target = args[0];
        if (!target) {
            printGuestLog(">> USAGE: /grantbook <username>", COLORS.ERROR);
            return;
        }
        printGuestLog(`>> Granting book reader access to '${target}'...`, COLORS.INFO);
        const res = await sendBookAccessCommand('grant', target);
        if (res.success) {
            printGuestLog(`>> SUCCESS: ${res.message}`, COLORS.PRIMARY);
        } else {
            printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
        }
    };

    commandHandlers['/revokebook'] = async function(args, printGuestLog) {
        const target = args[0];
        if (!target) {
            printGuestLog(">> USAGE: /revokebook <username>", COLORS.ERROR);
            return;
        }
        printGuestLog(`>> Revoking book reader access from '${target}'...`, COLORS.WARNING);
        const res = await sendBookAccessCommand('revoke', target);
        if (res.success) {
            printGuestLog(`>> SUCCESS: ${res.message}`, COLORS.PRIMARY);
        } else {
            printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
        }
    };

    // Private CV page (pages/resume.php)
    const cvCommand = (action) => async function(args, printGuestLog) {
        const target = args[0];
        if (!target) {
            printGuestLog(`>> USAGE: /${action === 'grant' ? 'grantcv' : 'revokecv'} <username>`, COLORS.ERROR);
            return;
        }
        printGuestLog(`>> ${action === 'grant' ? 'Granting' : 'Revoking'} CV access for '${target}'...`, action === 'grant' ? COLORS.INFO : COLORS.WARNING);
        const res = await sendBookAccessCommand(action, target, 'resume');
        printGuestLog(res.success ? `>> SUCCESS: ${res.message}` : `>> ERROR: ${res.error}`, res.success ? COLORS.PRIMARY : COLORS.ERROR);
    };
    commandHandlers['/grantcv'] = cvCommand('grant');
    commandHandlers['/revokecv'] = cvCommand('revoke');
    commandHandlers['grantcv'] = commandHandlers['/grantcv'];
    commandHandlers['revokecv'] = commandHandlers['/revokecv'];

    // Donors and ad-free accounts (api/donors.php): the site never sees payments, the admin records them by hand
    async function donorsApi(method, body) {
        const csrfToken = window.SESSION_STATE?.csrfToken || '';
        try {
            const res = await fetch('api/donors.php', {
                method,
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                credentials: 'same-origin',
                body: method === 'GET' ? undefined : JSON.stringify(body)
            });
            return await res.json();
        } catch (err) {
            return { success: false, error: 'Network request failed' };
        }
    }
    const USAGE_DONOR = '>> USAGE: /donor add <amount> [user=<username>] [name=<shown name>] [public] [date=YYYY-MM-DD] | /donor list | /donor remove <id>';
    commandHandlers['/donor'] = async function(args, printGuestLog) {
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'list') {
            const res = await donorsApi('GET');
            if (!res.success) return printGuestLog(`>> ERROR: ${res.error}`, COLORS.ERROR);
            if (!res.donors.length) return printGuestLog('>> No donations recorded yet.', COLORS.INFO);
            res.donors.forEach((d) => printGuestLog(`>> #${d.id} ${d.donated_at} ${(d.amount_cents / 100).toFixed(2)} ${d.currency}`
                + ` | account: ${d.username || '-'} | name: ${d.display_name || '-'} | ${d.is_public ? 'public' : 'private'}`, COLORS.PRIMARY));
            return;
        }
        if (sub === 'remove' && args[1]) {
            const res = await donorsApi('POST', { action: 'remove', id: Number(args[1]) });
            return printGuestLog(res.success ? `>> SUCCESS: ${res.message}` : `>> ERROR: ${res.error}`, res.success ? COLORS.PRIMARY : COLORS.ERROR);
        }
        if (sub === 'add' && args[1]) {
            const body = { action: 'add', amount: args[1], public: false };
            for (const a of args.slice(2)) {
                if (a === 'public') body.public = true;
                else if (a.startsWith('user=')) body.username = a.slice(5);
                else if (a.startsWith('name=')) body.name = a.slice(5).replace(/_/g, ' ');
                else if (a.startsWith('date=')) body.date = a.slice(5);
            }
            const res = await donorsApi('POST', body);
            return printGuestLog(res.success ? `>> SUCCESS: ${res.message}` : `>> ERROR: ${res.error}`, res.success ? COLORS.PRIMARY : COLORS.ERROR);
        }
        printGuestLog(USAGE_DONOR, COLORS.ERROR);
    };
    commandHandlers['donor'] = commandHandlers['/donor'];

    const adsFreeCommand = async function(args, printGuestLog) {
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'list') {
            const res = await donorsApi('GET');
            return printGuestLog(res.success ? `>> Ad-free accounts: ${res.ads_free.join(', ') || '(none)'}` : `>> ERROR: ${res.error}`, res.success ? COLORS.PRIMARY : COLORS.ERROR);
        }
        if ((sub === 'add' || sub === 'remove') && args[1]) {
            const res = await donorsApi('POST', { action: 'ads_free', username: args[1], value: sub === 'add' });
            return printGuestLog(res.success ? `>> SUCCESS: ${res.message}` : `>> ERROR: ${res.error}`, res.success ? COLORS.PRIMARY : COLORS.ERROR);
        }
        printGuestLog('>> USAGE: /adsfree add <username> | /adsfree remove <username> | /adsfree list  (the admin never sees ads)', COLORS.ERROR);
    };
    commandHandlers['/adsfree'] = adsFreeCommand;
    commandHandlers['adsfree'] = adsFreeCommand;

    // Aliases without leading slashes
    commandHandlers['ban'] = commandHandlers['/ban'];
    commandHandlers['timeout'] = commandHandlers['/timeout'];
    commandHandlers['unban'] = commandHandlers['/unban'];
    commandHandlers['grantbook'] = commandHandlers['/grantbook'];
    commandHandlers['revokebook'] = commandHandlers['/revokebook'];

    // Register commands for help lookup & tab completion
    if (typeof baseSystemCommands !== 'undefined') {
        baseSystemCommands.push('/ban', '/timeout', '/unban', '/grantbook', '/revokebook');
    }
})();