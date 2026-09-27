import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const serverFile = fileURLToPath(new URL('./diag-collect-server.js', import.meta.url));

async function startHub(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lastro-hub-'));
  const port = 19000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, DSH_DIAG_DIR: dir, DSH_DIAG_PORT: String(port), DSH_SKIP_ONLINE: '1' }, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const base = 'http://127.0.0.1:' + port;
  for (let i=0;i<50;i++) { try { const r=await fetch(base+'/api/node/state'); if(r.ok) break; } catch {} await new Promise(r=>setTimeout(r,50)); }
  t.after(async () => { child.kill(); await rm(dir,{recursive:true,force:true}); });
  return {base,dir,child,output:()=>output};
}
async function post(base,url,obj,extra={}) { return fetch(base+url,{method:'POST',headers:{'content-type':'application/json',...extra},body:typeof obj==='string'?obj:JSON.stringify(obj)}); }

test('strict routes, local CORS and schema validation', async t => {
  const h=await startHub(t);
  assert.equal((await fetch(h.base+'/missing')).status,404);
  assert.equal((await fetch(h.base+'/api/cmd')).status,405);
  const cors=await fetch(h.base+'/api/node/state',{headers:{Origin:'http://evil.example'}});
  assert.equal(cors.headers.get('access-control-allow-origin'),null);
  const bad=await post(h.base,'/api/script',[{templateId:'x',steps:[{action:'evil'}]}]);
  assert.equal(bad.status,400);
  const huge=await post(h.base,'/api/probe-collect','x'.repeat(1024*1024+1),{'content-type':'text/plain'});
  assert.equal(huge.status,413);
});

test('worker process manager starts idle process without login', async t => {
  const h=await startHub(t);
  await post(h.base,'/api/acct/accounts',{accounts:[{userid:'approved-account',passwd:'not-used',enabled:true,nid:5}]});
  let r=await post(h.base,'/api/worker',{action:'create',id:'worker-test',account:'approved-account',charIndex:0}); assert.equal(r.status,200);
  r=await post(h.base,'/api/worker',{action:'start',id:'worker-test'}); assert.equal(r.status,200);
  let state;
  for(let i=0;i<50;i++){state=await (await fetch(h.base+'/api/node/state')).json();if(state.nodes.some(n=>n.id==='worker-test'))break;await new Promise(r=>setTimeout(r,50));}
  const node=state.nodes.find(n=>n.id==='worker-test'); assert.ok(node); assert.equal(node.session,'disconnected'); assert.equal(node.process,'idle');
  r=await post(h.base,'/api/worker',{action:'stop',id:'worker-test'}); assert.equal(r.status,200);
});

test('durable command id, idempotent ack and restart recovery', async t => {
  let h=await startHub(t);
  const create=await (await post(h.base,'/api/cmd',{node:'worker-1',idempotencyKey:'once',cmd:{do:'stop'}})).json();
  assert.ok(create.commandId);
  const dup=await (await post(h.base,'/api/cmd',{node:'worker-1',idempotencyKey:'once',cmd:{do:'stop'}})).json();
  assert.equal(dup.commandId,create.commandId); assert.equal(dup.duplicate,true);
  let report=await (await post(h.base,'/api/node/report',{node:{id:'worker-1'}})).json();
  assert.equal(report.cmd.commandId,create.commandId);
  h.child.kill(); await new Promise(r=>h.child.once('exit',r));
  const port=new URL(h.base).port;
  const child=spawn(process.execPath,[serverFile],{env:{...process.env,DSH_DIAG_DIR:h.dir,DSH_DIAG_PORT:port,DSH_SKIP_ONLINE:'1'},stdio:'ignore'});
  t.after(()=>child.kill());
  for(let i=0;i<50;i++){try{const r=await fetch(h.base+'/api/node/state');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  report=await (await post(h.base,'/api/node/report',{node:{id:'worker-1'}})).json();
  assert.equal(report.cmd.commandId,create.commandId);
  let ack=await (await post(h.base,'/api/cmd/ack',{node:'worker-1',commandId:create.commandId,ok:true,msg:'done'})).json();
  assert.equal(ack.status,'succeeded');
  ack=await (await post(h.base,'/api/cmd/ack',{node:'worker-1',commandId:create.commandId,ok:true,msg:'again'})).json();
  assert.equal(ack.duplicate,true);
  const ledger=JSON.parse(await readFile(path.join(h.dir,'command-ledger.json'),'utf8'));
  assert.equal(ledger.commands[0].status,'succeeded');
});

test('cancelled acknowledgement is terminal and survives restart', async t => {
  const h=await startHub(t);
  const created=await (await post(h.base,'/api/cmd',{node:'worker-cancel',cmd:{do:'run',script:'farm_kill'}})).json();
  const claimed=await (await post(h.base,'/api/node/report',{node:{id:'worker-cancel'}})).json();
  assert.equal(claimed.cmd.commandId,created.commandId);
  let ack=await (await post(h.base,'/api/cmd/ack',{node:'worker-cancel',commandId:created.commandId,ok:true,status:'running',msg:'started'})).json();
  assert.equal(ack.status,'running');
  ack=await (await post(h.base,'/api/cmd/ack',{node:'worker-cancel',commandId:created.commandId,ok:true,status:'cancelled',msg:'stopped'})).json();
  assert.equal(ack.status,'cancelled');
  const state=await (await fetch(h.base+'/api/node/state')).json();
  const command=state.commands.find(c=>c.id===created.commandId);
  assert.equal(command.status,'cancelled'); assert.ok(command.finishedAt); assert.equal(state.cmds['worker-cancel'],undefined);
  const duplicate=await (await post(h.base,'/api/cmd/ack',{node:'worker-cancel',commandId:created.commandId,ok:false,msg:'late'})).json();
  assert.equal(duplicate.status,'cancelled'); assert.equal(duplicate.duplicate,true);
  const ledger=JSON.parse(await readFile(path.join(h.dir,'command-ledger.json'),'utf8'));
  assert.equal(ledger.commands[0].status,'cancelled'); assert.ok(ledger.commands[0].finishedAt);
});

test('generic KV sync: last-write-wins, validation and durable store', async t => {
  const h=await startHub(t);
  // missing key -> value null, ts 0
  let r=await (await fetch(h.base+'/api/kv/get?key=missing')).json();
  assert.deepEqual(r,{ok:true,key:'missing',value:null,ts:0});
  // invalid: no key / bad value / bad ts -> 400
  assert.equal((await fetch(h.base+'/api/kv/get')).status,400);
  assert.equal((await post(h.base,'/api/kv/save',{key:'',value:'x',ts:1})).status,400);
  assert.equal((await post(h.base,'/api/kv/save',{key:'k',value:123,ts:1})).status,400);
  assert.equal((await post(h.base,'/api/kv/save',{key:'k',value:'x',ts:'1'})).status,400);
  // first write wins (no prior ts)
  r=await (await post(h.base,'/api/kv/save',{key:'k',value:'v1',ts:10})).json();
  assert.deepEqual(r,{ok:true,stored:true});
  r=await (await fetch(h.base+'/api/kv/get?key=k')).json();
  assert.deepEqual(r,{ok:true,key:'k',value:'v1',ts:10});
  // older ts -> rejected (stored:false), value unchanged
  r=await (await post(h.base,'/api/kv/save',{key:'k',value:'v2',ts:5})).json();
  assert.deepEqual(r,{ok:true,stored:false});
  r=await (await fetch(h.base+'/api/kv/get?key=k')).json();
  assert.equal(r.value,'v1'); assert.equal(r.ts,10);
  // newer ts -> overwrites
  r=await (await post(h.base,'/api/kv/save',{key:'k',value:'v3',ts:20})).json();
  assert.deepEqual(r,{ok:true,stored:true});
  r=await (await fetch(h.base+'/api/kv/get?key=k')).json();
  assert.deepEqual(r,{ok:true,key:'k',value:'v3',ts:20});
  // durable store file matches { "<key>": { value, ts } }
  const kv=JSON.parse(await readFile(path.join(h.dir,'kv-sync.json'),'utf8'));
  assert.deepEqual(kv,{k:{value:'v3',ts:20}});
  // wrong method on known route -> 405
  assert.equal((await post(h.base,'/api/kv/get',{})).status,405);
});

