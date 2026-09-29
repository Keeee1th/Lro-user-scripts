import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const assist=fs.readFileSync(new URL('../ro-assist.user.js',import.meta.url),'utf8');
const dojo=fs.readFileSync(new URL('../ro-infinite-dojo.user.js',import.meta.url),'utf8');
function between(src,a,b){const x=src.indexOf(a),y=src.indexOf(b,x);assert.ok(x>=0&&y>x,a);return src.slice(x,y)}
function fn(src,name,next,ctx){vm.createContext(ctx);vm.runInContext(between(src,'function '+name,next)+';this.out='+name,ctx);return ctx.out}

test('unknown battle state never toggles ON',()=>{let toggles=0;const ctx={apiGuard:()=>null,apiBattleTick(){},apiLease:{battle:{state:'none'},generation:1},npBattleState:()=>null,apiCurrent:()=>true,npRequestBattle(){toggles++;return 'sent'}};const battle=fn(assist,'apiBattle','  function apiSetArrow',ctx);const r=battle('owner-123',true);assert.equal(r.ok,true);assert.equal(r.result,'unknown');assert.equal(toggles,0)});

test('release preserves queued OFF until confirmation',()=>{let cleared=0,requested=0;const ctx={apiLease:{owner:'owner-123',generation:4,scopes:['battle'],released:false,battle:{state:'owned'}},apiBattleTick(){},moveXY:{},arrowTarget:null,arrowPending:null,arrowReady:false,arrowBlocked:false,npRequestBattle(w,s,i,guard){requested++;assert.equal(w,false);assert.equal(guard(),true);return 'queued'},npClearBattleIntent(){cleared++},apiEmit(){}};const release=fn(assist,'apiRelease','  function apiContact',ctx);assert.equal(release('owner-123').result,'pending-off');assert.equal(requested,1);assert.equal(cleared,0);assert.equal(ctx.apiLease.released,true)});

test('menu occurrence fingerprint and selected NPC binding',()=>{const menu=fn(assist,'apiMenu','  function apiSnapshot',{menuRecon:{NAID:7,items:['初级'],time:100,generation:1},Number,String});const a=menu();const ctx2={apiGuard:()=>null,apiMenu:()=>a,apiLease:{selectedNpc:8},arrowPos:Number,CLIENT:{PS:{CZ:{CHOOSE_MENU:function(){}}},NM:{sendPacket(){throw Error('must not send')}}},apiMenuUsed:''};const choose=fn(assist,'apiChoose','  function apiBattle',ctx2);assert.equal(choose('owner-123',{naid:7,index:0,fingerprint:a.fingerprint}).error,'invalid-menu');ctx2.apiLease.selectedNpc=7;const sent=[];ctx2.CLIENT.NM.sendPacket=p=>sent.push(p);const first=choose('owner-123',{naid:7,index:0,fingerprint:a.fingerprint});assert.equal(first.ok,true);assert.equal(sent.length,1,'首次提交必须恰好发一次包');const again=choose('owner-123',{naid:7,index:0,fingerprint:a.fingerprint});assert.equal(again.ok,false);assert.equal(again.error,'menu-already-used');assert.equal(sent.length,1,'同一指纹第二次必须去重且零发包');ctx2.apiLease.selectedNpc=8;const other=choose('owner-123',{naid:7,index:0,fingerprint:a.fingerprint});assert.equal(other.ok,false);assert.equal(other.error,'invalid-menu','selectedNpc 不同必须拒绝');assert.equal(sent.length,1,'被拒绝时不得发包')});

test('dojo handshake rejects malformed API without throwing',()=>{const raw={protocol:1,handshake:()=>({protocol:1,capabilities:()=>({protocol:1,scopes:[],arrowRules:true})})};const api=fn(dojo,'api','function norm',{window:{__DSH_RO_ASSIST_API__:raw},PROTOCOL:1,Array});assert.equal(api(),null);raw.handshake=()=>{throw Error('bad')};assert.equal(api(),null)});

test('ambiguous NPC search times out after thirty seconds',()=>{let stopped='';const ctx={run:{npc:null,phase:'',owner:'owner-123'},npcs:()=>[{gid:1},{gid:2}],stop:r=>{stopped=r},Math};const contact=fn(dojo,'contact','function tick',ctx);contact({}, {},1000);assert.equal(ctx.run.npc.firstAt,1000);contact({}, {},31000);assert.match(stopped,/30秒/)});

test('arrow battle gate blocks stale and permits matching ready target',()=>{
  // 原为纯字符串断言（对 dojo 文本 includes）。dojo 本体现已退化为自禁用 shim（并入主脚本），
  // 字符串断言不再对应真实行为；同样的门禁语义已由 tools/ro-script-runtime-check.mjs 的
  // 「V2.36.1 内置道馆换箭 gate」用例在合并后主脚本上以 vm 行为断言覆盖（未就绪 / blocked /
  // 目标不匹配均不开战，basic 且未启用换箭放行）。此处只保留一条有覆盖价值的不变量：
  // 主脚本 dojoTick 必须经由 setArrowTarget → snapshot → match 重取换箭状态后再决定开战。
  const tick=between(assist,'  function dojoTick(g){','  function dojoStart(){');
  const set=tick.indexOf('a.setArrowTarget(DOJO_OWNER,{mid:t.mid,gid:t.gid})');
  const fresh=tick.indexOf(',fresh=a.snapshot(DOJO_OWNER)'); // 注意取 setArrowTarget 之后那次快照，不是行首的首次快照
  const match=tick.indexOf('fresh.arrow.target.mid===t.mid');
  const battle=tick.indexOf('a.requestBattle(DOJO_OWNER,!!allowed)');
  assert.ok(set>=0&&fresh>set,'换箭设置后必须重新取快照确认');
  assert.ok(match>fresh,'匹配判定必须基于新快照');
  assert.ok(battle>match,'开战必须排在换箭匹配判定之后');
});

test('arrow migration is one-time non-destructive and new key wins',()=>{const code=between(assist,'  function arrowPos','  var arrowRules=arrowLoad()');const store=new Map([['dsh-ro-challenge-v1',JSON.stringify({arrowOn:true,neutralItid:11,ghostItid:22,bossByMid:{100:{itid:33}}})]]);const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)};const ctx={Number,Object,JSON,localStorage,ARROW_RULES_KEY:'dsh-ro-arrow-rules-v1'};vm.createContext(ctx);vm.runInContext(code+';this.load=arrowLoad',ctx);let got=ctx.load();assert.equal(got.enabled,true);assert.equal(got.neutralItid,11);assert.ok(store.has('dsh-ro-challenge-v1'));store.set('dsh-ro-arrow-rules-v1',JSON.stringify({enabled:false,neutralItid:44,bossByMid:{}}));got=ctx.load();assert.equal(got.enabled,false);assert.equal(got.neutralItid,44)});

test('bundled dojo facade disables the shim before any lease or packet',()=>{
  function facade(mods){var f={moves:0,acquires:0,releases:0};f.protocol=1;f.handshake=function(r){return r&&r.client==='ro-infinite-dojo'?f:null};f.capabilities=function(){return{protocol:1,scopes:['dojo','battle','movement','dialog','arrow','fly'],arrowRules:true,modules:mods}};f.ready=function(){return true};f.acquire=function(){f.acquires++;return{ok:true}};f.release=function(){f.releases++};f.clearArrowTarget=function(){f.moves++};f.snapshot=function(){f.moves++;return{ready:true}};return f}
  const hasDojo=fn(dojo,'hasDojo','function api',{Array});
  const fresh=facade(['dojo']),legacy=facade(undefined);
  assert.equal(hasDojo(fresh),true);
  assert.equal(hasDojo(legacy),false);
  assert.equal(hasDojo(null),false);
  const run={on:false,owner:'owner-123',generation:0,round:0,remaining:null,lastMenu:'',lastNotice:'',lastNoticeAt:0,timer:null,phase:'等待助手',npc:null,lastFly:0};
  const ctx={api:()=>fresh,hasDojo,run,BUNDLED:'道馆已并入主脚本，本脚本可卸载',stop:r=>{ctx.stopped=r},tick:()=>{ctx.api().moves++},setInterval:()=>0,clearInterval:()=>{}};
  const start=fn(dojo,'start','function stop',ctx);
  start();
  assert.equal(fresh.acquires,0);
  assert.equal(fresh.moves,0);
  assert.equal(run.on,false);
  assert.equal(run.timer,null);
  assert.match(ctx.stopped,/并入主脚本/);
  ctx.api=()=>legacy;
  start();
  assert.equal(legacy.acquires,1);
  assert.equal(run.on,true);
  assert.ok(legacy.moves>=1);
  const sctx={api:()=>fresh,hasDojo,run:{on:false,timer:null,npc:null,phase:'',generation:0,owner:'owner-123'},clearInterval:()=>{},render:()=>{}};
  const stopFn=fn(dojo,'stop','var p=document.createElement',sctx);
  stopFn('页面离开');
  assert.equal(fresh.releases,0);
  assert.equal(fresh.moves,0);
  sctx.api=()=>legacy;
  stopFn('页面离开');
  assert.equal(legacy.releases,1);
  assert.ok(dojo.includes('q("[data-start]").disabled=run.on||b||!a'));
});

