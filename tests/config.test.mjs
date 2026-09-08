import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createStore } from '../supabase-store.js';
import { createServer } from '../server.js';

test('server rejects missing credentials, insecure project URLs, and invalid PORT', () => {
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.SUPABASE_URL; delete env.SUPABASE_SERVICE_ROLE_KEY;
  const run = extra => spawnSync(process.execPath, ['server.js'], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 });
  assert.match(run({}).stderr, /SUPABASE_URL/);
  assert.match(run({ SUPABASE_URL: 'https://example.supabase.co' }).stderr, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(run({ SUPABASE_URL: 'http://example.supabase.co' }).stderr, /HTTPS/);
  assert.match(run({ PORT: 'invalid' }).stderr, /PORT must be/);
});

test('SDK uses the server RPC contract and redacts upstream failures', async t => {
  // This is a transport contract test, NOT proof of database persistence.
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://contract-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-secret';
  t.after(() => {
    for (const [name, value] of [['SUPABASE_URL', oldUrl], ['SUPABASE_SERVICE_ROLE_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let mode = 'success', calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    if (mode === 'throw') throw new Error('test-only-not-a-real-secret');
    if (mode === 'error') return new Response(JSON.stringify({ message: 'test-only-not-a-real-secret' }), { status: 500 });
    if (mode === 'malformed') return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ status: 200, data: { status: 'ok' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const store = createStore();
  assert.deepEqual(await store('health'), { status: 200, data: { status: 'ok' } });
  const call = calls[0];
  assert.equal(call.url, 'https://contract-test.supabase.co/rest/v1/rpc/heartping_api');
  assert.equal(new Headers(call.options.headers).get('apikey'), 'test-only-not-a-real-secret');
  assert.equal(call.options.redirect, 'error');
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(call.options.body), { p_action: 'health', p_user_id: '', p_body: {}, p_new_session: false });
  for (mode of ['throw', 'error', 'malformed']) await assert.rejects(store('state', 'a'.repeat(64)), /^Error: Supabase persistence request failed\.$/);
});

test('database failures fail health and API requests closed, without exposing secrets', async t => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://contract-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-secret';
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('http://127.0.0.1:')
    ? realFetch(url, options) : Promise.reject(new Error('test-only-not-a-real-secret')));
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of [['SUPABASE_URL', oldUrl], ['SUPABASE_SERVICE_ROLE_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/healthz')).status, 503);
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Alex"}' });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not save your change. Please try again.' });
  assert.equal((await fetch(base + '/supabase-store.js')).status, 404);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/supabase/migrations/001_heartping.sql')).status, 404);
});

test('HTTP session contract hashes bearer tokens before the SDK call', async t => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://contract-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-a-real-secret';
  const realFetch = globalThis.fetch, calls = [];
  const snapshot = { myName: 'Alex', myCode: '123456', codeExpiresAt: 1000,
    partnerName: '', partnerCode: '', isPaired: false, history: [] };
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, options);
    calls.push(JSON.parse(options.body));
    return Promise.resolve(new Response(JSON.stringify({ status: 200, data: snapshot }), { status: 200 }));
  });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of [['SUPABASE_URL', oldUrl], ['SUPABASE_SERVICE_ROLE_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":" Alex "}' });
  const { token, ...state } = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(state, snapshot);
  assert.match(token, /^[a-f0-9]{64}$/);
  const hash = createHash('sha256').update(token).digest('hex');
  assert.deepEqual(calls[0], { p_action: 'session', p_user_id: hash, p_body: { name: 'Alex' }, p_new_session: true });
  assert.deepEqual(await (await fetch(base + '/api/state', { headers: { Authorization: 'Bearer ' + token } })).json(), snapshot);
  assert.equal(calls[1].p_user_id, hash); assert.equal(calls[1].p_new_session, false);
  assert.ok(!JSON.stringify(calls).includes(token));
  const denied = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{"name":"Bad"}' });
  assert.equal(denied.status, 403); assert.equal(calls.length, 2);
});

test('deployment assets contain no server credentials or file persistence requirement', () => {
  const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(folder, e.name)) : [path.join(folder, e.name)]);
  for (const file of [...walk('public'), ...walk('app/src/main/assets/www')]) {
    assert.doesNotMatch(fs.readFileSync(file).toString(), /SUPABASE_SERVICE_ROLE_KEY|supabase-store|sb_secret_/);
  }
  const render = fs.readFileSync('render.yaml', 'utf8');
  assert.match(render, /plan: free/);
  assert.doesNotMatch(render, /disk:|DATA_FILE|\/var\/data/);
  assert.match(render, /SUPABASE_SERVICE_ROLE_KEY\s+sync: false/);
  assert.doesNotMatch(fs.readFileSync('backend.js', 'utf8'), /node:fs|DATA_FILE/);
  assert.doesNotMatch(fs.readFileSync('server.js', 'utf8'), /DATA_FILE|writeFile|mkdir/);
});
