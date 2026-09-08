import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.js';

test('real two-user journey, validation, isolation, persistence and static server safety', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'heartping-test-'));
  const dataFile = path.join(folder, 'state.json');
  let server, base;
  async function start() {
    server = createServer({ dataFile });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await stop(); fs.rmSync(folder, { recursive: true, force: true }); });
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
  assert.ok(!fs.readFileSync(dataFile,'utf8').includes(a.token), 'tokens are hashed on disk');
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

test('expired codes and failed storage do not create false pairing state', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'heartping-failure-'));
  const dataFile=path.join(folder,'db','state.json');
  fs.mkdirSync(path.dirname(dataFile));
  const {createHash}=await import('node:crypto');
  const id=token=>createHash('sha256').update(token).digest('hex');
  fs.writeFileSync(dataFile,JSON.stringify({users:{
    [id('a')]:{name:'A',code:'123456',expires:1,history:[],partner:null},
    [id('b')]:{name:'B',code:'234567',expires:Date.now()+86400000,history:[],partner:null}
  }}));
  const server=createServer({dataFile});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,token,body)=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal((await post('join','b',{code:'123456'})).status,404);
  assert.equal((await post('session','a',{name:'A'})).status,200);
  const a=await (await fetch(base+'/api/state',{headers:{Authorization:'Bearer a'}})).json();
  assert.notEqual(a.myCode,'123456');
  // Simulate a read-only/unavailable data directory without changing machine permissions.
  fs.renameSync(path.dirname(dataFile),path.join(folder,'backup'));
  fs.writeFileSync(path.dirname(dataFile),'blocked');
  assert.equal((await post('join','b',{code:a.myCode})).status,500);
  const b=await (await fetch(base+'/api/state',{headers:{Authorization:'Bearer b'}})).json();
  assert.equal(b.isPaired,false);
  for(let i=0;i<8;i++) await post('join','b',{code:'000000'});
  assert.equal((await post('join','b',{code:'000000'})).status,429);
});
