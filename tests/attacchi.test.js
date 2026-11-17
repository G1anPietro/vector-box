// tests/attacchi.test.js — attack summary: log parsing, one event per attempt, local addresses left out, shown to the admin only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startSite, Client, makeAdmin } = require('./helpers');

const NOW = Math.floor(Date.now() / 1000);
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 19) + '+0000';
const ssh = (t, pid, msg) => `${iso(t)} laptop0 sshd-session[${pid}]: ${msg}`;
const nginx = (t, ip, p) => `${ip} - - [${new Date(t * 1000).toUTCString().slice(5, 16).replace(/ /g, '/')}:${new Date(t * 1000).toISOString().slice(11, 19)} +0000] "GET ${p} HTTP/1.1" 404 12 "-" "x"`;

const php = (code) => JSON.parse(execFileSync('php', ['-r', `require "${path.join(__dirname, '..', 'public/api/attacks.php')}"; ${code}`], { encoding: 'utf8' }));

test('summary: one event per attempt, local addresses out, bans counted', () => {
    const lines = {
        ssh: [ssh(NOW - 60, 1, 'Invalid user admin from 1.2.3.4 port 5'), ssh(NOW - 59, 1, 'Connection closed by invalid user admin 1.2.3.4 port 5 [preauth]'),
               ssh(NOW - 50, 2, 'Connection closed by 5.6.7.8 port 9 [preauth]'), ssh(NOW - 40, 3, 'Connection closed by 192.168.1.9 port 9 [preauth]'),
               ssh(NOW - 30, 4, 'Failed password for root from 1.2.3.4 port 5 ssh2')],
        web: [nginx(NOW - 20, '9.9.9.9', '/.env'), nginx(NOW - 10, '9.9.9.9', '/wp-login.php'), nginx(NOW - 5, '9.9.9.9', '/pages/giochi.php')],
        ban: [`${iso(NOW - 5)} laptop0 fail2ban-server[1]: 2026-11-17 10:00:00,000 fail2ban.actions        [1]: NOTICE  [sshd] Ban 1.2.3.4`],
    };
    const d = php(`echo json_encode(attacksBuild(json_decode('${JSON.stringify(lines.ssh)}'), json_decode('${JSON.stringify(lines.web)}'), json_decode('${JSON.stringify(lines.ban)}'), ${NOW}));`);
    assert.equal(d.ssh.total, 3);        // admin attempt, one scan, one failed password; the LAN line and the "closed" duplicate are out
    assert.equal(d.ssh.logins, 2);
    assert.equal(d.ssh.top_ips[0].ip, '1.2.3.4');
    assert.equal(d.web.total, 2);        // the normal page is not a probe
    assert.equal(d.web.top_keys['/.env'], 1);
    assert.equal(d.bans.total, 1);
});

test('the stats page shows the summary to the admin, and the collector writes it', async () => {
    const site = await startSite();
    try {
        const admin = await makeAdmin(site, 'atk_admin');
        assert.match((await admin.get('/pages/stats.php?lang=en')).text, /Attacks on the server/);
        fs.writeFileSync(path.join(site.root, 'data', 'attacks.json'), JSON.stringify(php(`echo json_encode(attacksBuild(['${iso(NOW - 5)} h sshd-session[1]: Invalid user <b>x from 1.2.3.4 port 5'], [], [], ${NOW}));`)));
        const html = (await admin.get('/pages/stats.php?lang=en')).text;
        assert.match(html, /1\.2\.3\.4/);
        assert.ok(!html.includes('<b>x'), 'user names tried by attackers are escaped');
        assert.equal((await new Client(site).init().then(c => c.get('/pages/stats.php'))).status, 403);
    } finally { site.stop(); }
});
