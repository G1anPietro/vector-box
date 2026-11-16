// tests/classi-permessi.test.js — class permissions: a "roles" holder cannot grant what they lack; AI declaration and timetable rules
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, Client, makeAdmin } = require('./helpers');

test.describe('class permissions', () => {
    let site, mario, luigi, classId, luigiId;
    const api = (c, body) => c.post('/api/classi.php', body);
    const clear = () => { try { site.db('DELETE FROM rate_limits'); } catch (e) { /* not there yet */ } };
    test.before(async () => {
        site = await startSite();
        const admin = await makeAdmin(site, 'cp_admin');
        clear(); mario = new Client(site); await mario.register('cp_mario');
        clear(); luigi = new Client(site); await luigi.register('cp_luigi');
        classId = (await api(mario, { action: 'request', name: '5A', school: 'ITIS', adults: true })).json.id;
        await api(admin, { action: 'decide', id: classId, approve: true });
        const code = (await mario.get(`/api/classi.php?action=class&id=${classId}`)).json.class.invite_code;
        await api(luigi, { action: 'join', code });
        luigiId = site.db("SELECT id FROM accounts WHERE username = 'cp_luigi'")[0].id;
    });
    test.after(async () => { await site.stop(); });

    test('a member with only "roles" cannot give themselves other permissions, nor sign the adults declaration', async () => {
        const role = await api(mario, { action: 'save_role', id: classId, name: 'Capo ruoli', perms: ['roles'] });
        assert.equal(role.status, 200);
        assert.equal((await api(mario, { action: 'set_member_access', id: classId, user_id: luigiId, role_id: role.json.role_id, perms: [] })).status, 200);
        const big = await api(luigi, { action: 'save_role', id: classId, name: 'Tutto', perms: ['roles', 'settings', 'members', 'timetable'] });
        assert.equal(big.status, 200);
        const saved = JSON.parse(site.db('SELECT perms FROM class_roles WHERE id = ?', [big.json.role_id])[0].perms);
        assert.deepEqual(saved, ['roles'], 'only what luigi holds');
        assert.equal((await api(luigi, { action: 'set_member_access', id: classId, user_id: luigiId, role_id: 0, perms: ['members', 'settings'] })).status, 200);
        assert.deepEqual(JSON.parse(site.db('SELECT perms FROM class_members WHERE user_id = ?', [luigiId])[0].perms), []);
        assert.equal((await api(luigi, { action: 'ai_switch', id: classId, on: true, adults_confirm: true })).status, 403);
    });
});
