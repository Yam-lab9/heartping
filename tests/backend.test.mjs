import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedOptions } from './hosted.mjs';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.js';

test('hosted Postgres: real two-user journey, isolation and persistence across Node restarts', hostedOptions, async t => {
  let server, base;
  async function start() {
    server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await stop(); });
  await start();
  const request = async (endpoint, token, body) => {
    const response = await fetch(base + '/api/' + endpoint, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await request('session', '', { name: '  ' })).status, 400);
  assert.equal((await request('state')).status, 401);
  const a = (await request('session', '', { name: 'Alex' })).data;
  const b = (await request('session', '', { name: 'Maya' })).data;
  const c = (await request('session', '', { name: 'Other' })).data;
  assert.match(a.myCode, /^\d{6}$/); assert.notEqual(a.myCode, b.myCode);
  assert.equal((await request('join', b.token, { code: '000000' })).status, 404);
  assert.equal((await request('join', b.token, { code: 'xx' })).status, 400);
  assert.equal((await request('join', b.token, { code: b.myCode })).status, 400);
  assert.equal((await request('ping', b.token, { id: randomUUID() })).status, 409);
  assert.equal((await request('join', b.token, { code: a.myCode })).data.partnerName, 'Alex');
  assert.equal((await request('state', a.token)).data.partnerName, 'Maya');
  assert.equal((await request('join', b.token, { code: a.myCode })).status, 200);
  assert.equal((await request('join', c.token, { code: a.myCode })).status, 409);
  const pingId = randomUUID();
  const sent = await Promise.all([request('ping', a.token, { id: pingId }), request('ping', a.token, { id: pingId })]);
  assert.ok(sent.every(r => r.status === 200));
  assert.equal((await request('state', b.token)).data.history.length, 1);
  assert.equal((await request('state', b.token)).data.history[0].type, 'received');
  assert.equal((await request('state', c.token)).data.history.length, 0);
  await request('ping', b.token, { id: randomUUID() });
  assert.equal((await request('state', a.token)).data.history[0].type, 'received');
  await stop(); await start();
  assert.equal((await request('state', a.token)).data.history.length, 2);
  assert.equal((await request('state', b.token)).data.isPaired, true);
  await request('history/clear', a.token, {});
  assert.equal((await request('state', a.token)).data.history.length, 0);
  assert.equal((await request('state', b.token)).data.history.length, 2);
  await request('ping', a.token, { id: pingId });
  assert.equal((await request('state', b.token)).data.history.length, 2);
  await request('unpair', b.token, {});
  assert.equal((await request('state', a.token)).data.isPaired, false);
  assert.notEqual((await request('state', a.token)).data.myCode, a.myCode);
  assert.equal((await request('ping', a.token, { id: randomUUID() })).status, 409);
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/..%5cserver.js')).status, 403);
  assert.equal((await fetch(base + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  assert.equal((await fetch(base + '/', { method: 'HEAD' })).status, 200);
  const denied = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type':'application/json' }, body: '{"name":"Bad"}' });
  assert.equal(denied.status, 403);
  const raw = await fetch(base + '/api/session', {method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(raw.status, 400);
});

test('hosted Postgres: concurrent joins across Node instances cannot form two partnerships', hostedOptions, async t => {
  const servers = [createServer(), createServer()];
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  t.after(() => Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))));
  const post = async (instance, route, token, body) => {
    const response = await fetch(`http://127.0.0.1:${servers[instance].address().port}/api/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const a = (await post(0, 'session', '', { name: 'Race A' })).data;
  const b = (await post(0, 'session', '', { name: 'Race B' })).data;
  const c = (await post(1, 'session', '', { name: 'Race C' })).data;
  const result = await Promise.all([post(0, 'join', b.token, { code: a.myCode }), post(1, 'join', c.token, { code: a.myCode })]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal((await post(0, 'unpair', a.token, {})).status, 200);
  for (let i = 0; i < 9; i++) await post(0, 'join', b.token, { code: '000000' });
  assert.equal((await post(0, 'join', b.token, { code: '000000' })).status, 429);
});
