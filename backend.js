import { randomBytes, createHash } from 'node:crypto';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hash = value => createHash('sha256').update(value).digest('hex');

export function createBackend(store) {
  const limits = new Map();
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
      let nextToken = token;
      const action = pathname.slice('/api/'.length);
      const validRoute = (req.method === 'GET' && action === 'state') ||
        (req.method === 'POST' && ['session', 'join', 'ping', 'unpair', 'history/clear'].includes(action));
      if (action === 'session' && req.method === 'POST') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 24 || /[\u0000-\u001f]/.test(name)) fail(400, 'Please enter a first name of 1–24 characters.');
        body = { name };
        nextToken ||= randomBytes(32).toString('hex');
      }
      const result = await store(validRoute ? action : 'unknown', hash(nextToken), body, !token && action === 'session');
      if (result.status !== 200) fail(result.status, result.error);
      return send(200, action === 'session' ? { token: nextToken, ...result.data } : result.data);
    } catch (error) {
      if (!error.status) console.error('HeartPing API failure: persistence unavailable.');
      send(error.status || 500, { error: error.status ? error.message : 'Could not save your change. Please try again.' });
    }
  };
}
