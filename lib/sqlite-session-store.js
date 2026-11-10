// lib/sqlite-session-store.js
// Persistent express-session store on Node's built-in node:sqlite (Node >= 22.5),
// so logins survive restarts. Kept in its own DB file so it never locks the PHP DB.
'use strict';
const fs = require('fs');
const path = require('path');

function createSessionStore(session, dbPath, { ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    let DatabaseSync;
    try {
        // Built-in; prints an ExperimentalWarning on some Node 22 releases
        ({ DatabaseSync } = require('node:sqlite'));
    } catch (e) {
        console.warn('>>> node:sqlite unavailable, sessions stay in memory (lost on restart)');
        return null;
    }

    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o750 });
    const db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS sessions (
                 sid TEXT PRIMARY KEY,
                 data TEXT NOT NULL,
                 expires INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);`);
    try { fs.chmodSync(dbPath, 0o600); } catch (e) { /* best effort */ }

    const q = {
        get: db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?'),
        set: db.prepare(`INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
                         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`),
        touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
        destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
        prune: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };

    const expiryOf = (sess) => {
        const exp = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
        return Number.isFinite(exp) ? exp : Date.now() + ttlMs;
    };

    class SqliteStore extends session.Store {
        get(sid, cb) {
            try {
                const row = q.get.get(sid, Date.now());
                cb(null, row ? JSON.parse(row.data) : null);
            } catch (e) { cb(e); }
        }
        set(sid, sess, cb = () => {}) {
            try { q.set.run(sid, JSON.stringify(sess), expiryOf(sess)); cb(null); } catch (e) { cb(e); }
        }
        touch(sid, sess, cb = () => {}) {
            try { q.touch.run(expiryOf(sess), sid); cb(null); } catch (e) { cb(e); }
        }
        destroy(sid, cb = () => {}) {
            try { q.destroy.run(sid); cb(null); } catch (e) { cb(e); }
        }
    }

    // Drop expired sessions every 15 minutes
    setInterval(() => {
        try { q.prune.run(Date.now()); } catch (e) { console.error('session prune failed:', e.message); }
    }, 15 * 60 * 1000).unref();

    return new SqliteStore();
}

module.exports = { createSessionStore };
