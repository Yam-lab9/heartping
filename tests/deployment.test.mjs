import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from '../server.js';
const root = path.resolve(import.meta.dirname, '..');

test('production entry point uses PORT, public Host/HTTPS Origin and persistent disk across process restarts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'heartping-deploy-'));
  const dataFile = path.join(directory, 'heartping.json');
  let child, port;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root,
      env: { ...process.env, NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '0', DATA_FILE: dataFile },
      stdio: ['ignore', 'pipe', 'pipe'] });
    port = await new Promise((resolve,reject) => {
      const timeout = setTimeout(()=>reject(new Error('Production startup timed out')),10000);
      let output='';
      child.stdout.on('data',chunk=>{
        output+=chunk;
        const match=output.match(/listening on 0\.0\.0\.0:(\d+)/);
        if(match){ clearTimeout(timeout);resolve(Number(match[1])); }
      });
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Early server exit: '+code));});
    });
  }
  const request = (route, token, body, origin = 'https://heartping.example') => new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method:body===undefined?'GET':'POST',headers:{
      Host:'heartping.example',Origin:origin,'X-Forwarded-Proto':'https','Content-Type':'application/json',
      ...(token?{Authorization:'Bearer '+token}:{})
    }},res=>{
      let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw}));
    });
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  t.after(async()=>{await stop();fs.rmSync(directory,{recursive:true,force:true});});
  await start();
  assert.ok(port>0);
  const health=await request('/healthz');
  assert.equal(health.status,200);assert.equal(health.headers['cache-control'],'no-store');
  assert.deepEqual(JSON.parse(health.raw),{status:'ok'});
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/app.js?v=production')).status,200);
  const a=JSON.parse((await request('/api/session','',{name:'Alex'})).raw);
  const b=JSON.parse((await request('/api/session','',{name:'Maya'})).raw);
  assert.ok(a.token&&b.token);
  assert.equal((await request('/api/join',b.token,{code:a.myCode})).status,200);
  assert.equal((await request('/api/ping',a.token,{id:'deployment-ping-123456'})).status,200);
  assert.equal((await request('/api/ping',a.token,{id:'deployment-ping-123457'},'https://foreign.example')).status,403);
  await stop();await start();
  const restored=JSON.parse((await request('/api/state',b.token)).raw);
  assert.equal(restored.isPaired,true);assert.equal(restored.history[0].type,'received');
  assert.equal(restored.history[0].sender,'Alex');
});

test('production rejects missing storage, invalid ports and public data paths',()=>{
  const env={...process.env,NODE_ENV:'production'};delete env.DATA_FILE;
  const missing=spawnSync(process.execPath,['server.js'],{cwd:root,env,encoding:'utf8'});
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/Production requires DATA_FILE/);
  const invalid=spawnSync(process.execPath,['server.js'],{cwd:root,env:{...env,DATA_FILE:'unused.json',PORT:'invalid'},encoding:'utf8'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/PORT must be/);
  assert.throws(()=>createServer({dataFile:path.join(root,'public','private.json')}),/outside the public/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heartping-storage-'));
  try {
    const blocked=path.join(dir,'file');fs.writeFileSync(blocked,'not a directory');
    assert.throws(()=>createServer({dataFile:path.join(blocked,'heartping.json')}));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
