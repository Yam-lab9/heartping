import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, createHash } from 'node:crypto';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');
const DAY = 86400000;

// One server owns this file. Replace atomically and roll back failed writes.
export function createBackend(filename) {
  let db = { users: {} };
  if (fs.existsSync(filename)) {
    db = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!db.users || typeof db.users !== 'object') throw new Error('Invalid HeartPing data file');
  }
  const limits = new Map();
  function code() {
    let value;
    do { value = String(randomInt(100000, 1000000)); }
    while (Object.values(db.users).some(u => u.code === value));
    return value;
  }
  function save(change) {
    const before = structuredClone(db);
    try {
      const result = change();
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename + '.tmp', JSON.stringify(db), { mode: 0o600 });
      fs.renameSync(filename + '.tmp', filename);
      return result;
    } catch (error) { db = before; throw error; }
  }
  function snapshot(user) {
    const partner = db.users[user.partner];
    return { myName: user.name, myCode: user.code, codeExpiresAt: user.expires,
      partnerName: partner?.name || '', partnerCode: partner?.code || '',
      isPaired: Boolean(partner), history: user.history };
  }
  return async function api(req, res, pathname) {
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (!['GET', 'POST'].includes(req.method)) fail(405, 'Method not allowed.');
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid origin.'); }
        if (origin.host !== req.headers.host) fail(403, 'Use HeartPing from this server.');
      }
      if (req.method === 'POST') {
        const now = Date.now();
        for (const [key, value] of limits) if (value.until < now) limits.delete(key);
        const key = `${req.socket.remoteAddress}:${pathname}`;
        const limit = limits.get(key) || { count: 0, until: now + 60000 };
        limits.set(key, limit);
        if (++limit.count > (pathname === '/api/join' ? 10 : 60)) fail(429, 'Please wait a minute and try again.');
      }
      let body = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Send JSON data.');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) fail(413, 'Request is too large.'); }
        try { body = JSON.parse(raw); } catch { fail(400, 'Invalid request data.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request data.');
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const id = hash(token);
      let user = db.users[id];
      if (pathname === '/api/session' && req.method === 'POST') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 24 || /[\u0000-\u001f]/.test(name)) fail(400, 'Please enter a first name of 1–24 characters.');
        if (token && !user) fail(401, 'Your session has expired. Please enter your name again.');
        const nextToken = token || randomBytes(32).toString('hex');
        save(() => {
          user = db.users[hash(nextToken)] ||= { code: code(), expires: Date.now() + DAY, history: [], partner: null };
          user.name = name;
          if (!user.partner && user.expires < Date.now()) { user.code = code(); user.expires = Date.now() + DAY; }
        });
        return send(200, { token: nextToken, ...snapshot(user) });
      }
      if (!user) fail(401, 'Your session has expired. Please enter your name again.');
      if (pathname === '/api/state' && req.method === 'GET') return send(200, snapshot(user));
      if (pathname === '/api/join' && req.method === 'POST') {
        if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail(400, 'Enter a valid six-digit pairing code.');
        if (body.code === user.code) fail(400, 'Share your code with your partner; you cannot join yourself.');
        const entry = Object.entries(db.users).find(([, u]) => u.code === body.code);
        if (!entry || entry[1].expires < Date.now()) fail(404, 'That code was not found or has expired. Ask your partner for a new one.');
        const [partnerId, partner] = entry;
        if (user.partner === partnerId) return send(200, snapshot(user));
        if (user.partner || partner.partner) fail(409, 'One of you is already paired. Unpair first.');
        save(() => { user.partner = partnerId; partner.partner = id; user.history = []; partner.history = []; });
        return send(200, snapshot(user));
      }
      if (pathname === '/api/ping' && req.method === 'POST') {
        const partner = db.users[user.partner];
        if (!partner || partner.partner !== id) fail(409, 'Connect with your partner before sending a ping.');
        if (typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.id)) fail(400, 'Invalid ping identifier.');
        if (!(user.sentIds || []).includes(body.id)) save(() => {
          user.sentIds = [body.id, ...(user.sentIds || [])].slice(0, 200);
          const ping = { id: body.id, sender: user.name, receiver: partner.name, timestamp: Date.now() };
          user.history = [{ ...ping, type: 'sent' }, ...user.history].slice(0, 100);
          partner.history = [{ ...ping, type: 'received' }, ...partner.history].slice(0, 100);
        });
        return send(200, snapshot(user));
      }
      if (pathname === '/api/unpair' && req.method === 'POST') {
        save(() => {
          const partner = db.users[user.partner];
          for (const member of [user, partner].filter(Boolean)) {
            member.partner = null; member.history = []; member.code = code(); member.expires = Date.now() + DAY;
          }
        });
        return send(200, snapshot(user));
      }
      if (pathname === '/api/history/clear' && req.method === 'POST') {
        save(() => { user.history = []; });
        return send(200, snapshot(user));
      }
      fail(404, 'Endpoint not found.');
    } catch (error) {
      if (!error.status) console.error('HeartPing API failure:', error.message);
      send(error.status || 500, { error: error.status ? error.message : 'Could not save your change. Please try again.' });
    }
  };
}
