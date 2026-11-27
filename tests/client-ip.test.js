// tests/client-ip.test.js — the real visitor IP behind Cloudflare: trusted proxies may be ranges (CIDR), a forged header never wins.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { REPO } = require('./helpers');

const ip = (trusted, remote, xff) => spawnSync('php', ['-r', `
    putenv('TRUSTED_PROXIES=${trusted}');
    $_SERVER['REMOTE_ADDR'] = '${remote}'; ${xff ? `$_SERVER['HTTP_X_FORWARDED_FOR'] = '${xff}';` : ''}
    require '${path.join(REPO, 'public', 'api', 'helpers.php')}';
    echo getClientIp();`], { encoding: 'utf8' }).stdout.trim();
const CF = '127.0.0.1,::1,173.245.48.0/20,2400:cb00::/32';

test('a range of trusted proxies is understood (IPv4 and IPv6)', () => {
    assert.equal(ip(CF, '173.245.50.7', '203.0.113.9'), '203.0.113.9', 'inside 173.245.48.0/20');
    assert.equal(ip(CF, '173.245.64.1', '203.0.113.9'), '173.245.64.1', 'just outside the range: not a proxy, header ignored');
    assert.equal(ip(CF, '2400:cb00:1::5', '2001:db8::1'), '2001:db8::1', 'IPv6 range');
    assert.equal(ip(CF, '2400:cb01::5', '2001:db8::1'), '2400:cb01::5');
});

test('a forged header never wins: untrusted senders are ignored, the rightmost non-proxy address counts', () => {
    assert.equal(ip(CF, '198.51.100.4', '9.9.9.9'), '198.51.100.4', 'direct visitor lying in X-Forwarded-For');
    assert.equal(ip(CF, '173.245.50.7', '9.9.9.9, 203.0.113.9'), '203.0.113.9', 'a forged left entry is skipped');
    assert.equal(ip(CF, '173.245.50.7', '203.0.113.9, 173.245.48.1'), '203.0.113.9', 'a proxy at the end of the chain is skipped');
    assert.equal(ip('127.0.0.1', '127.0.0.1', '203.0.113.9'), '203.0.113.9', 'a single address still works as before');
    assert.equal(ip('127.0.0.1', '127.0.0.1', ''), '127.0.0.1');
});
