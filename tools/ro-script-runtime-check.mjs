import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ro-assist.user.js',import.meta.url),'utf8');
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
test('runtime fixes are present and stale patterns absent',()=>{
  assert.ok(source.includes('if (!step.arrive) return step.action !== "walk"'));
  assert.ok(source.includes('scrCondMet(step.until)'));
  assert.ok(!source.includes('scrCondMet(lp.until)'));
  assert.doesNotMatch(source,/typeof itemName ===/);
  assert.ok(source.includes('scrKill.byMobId'));
  assert.ok(!source.includes('scrKill.byGid'));
  assert.ok(source.includes('scrRun.stepStartedAt'));
  assert.ok(!source.includes('hookPacket(0x80'));
  assert.ok(!source.includes('hookPacket(pid'));
  assert.ok(source.includes('dpsOnRawDamage(bytes, op)'));
  assert.ok(source.includes('scrOnRawVanish(bytes)'));
  assert.ok(source.includes('</button></span></div>'));
  assert.ok(source.includes('var idx = -1, found = false'));
  assert.ok(source.includes('return castStatusPrep("球" + subReq[2], order)'));
});
test('condition evaluator supports zero quantity',()=>{
  const code=extract('  function scrCondMet(cond) {','  function scrStorageReady()');
  const ctx={scrQtyBySpec:()=>0,scrKill:{byName:{},byMobId:{},total:0},scrWeightPct:()=>0,scrZeny:()=>0,scrRun:{stepStartedAt:Date.now()},Date,isFinite,parseInt,parseFloat};vm.createContext(ctx);vm.runInContext(code+';this.fn=scrCondMet',ctx);
  assert.equal(ctx.fn({item:7054,count:0,compare:'lte'}),true);
  ctx.scrQtyBySpec=()=>1;assert.equal(ctx.fn({item:7054,count:0,compare:'lte'}),false);
});
test('loop success advances instead of finishing script',()=>{
  const code=extract('  function scrDoLoop(step) {','  // 负重分支');let next=0,finish=0;
  const ctx={scrRun:{loops:0,stepIndex:3,script:{steps:[{},{},{},{}]}},scrCondMet:()=>true,scrLogLine(){},scrNextStep(){next++},scrFinish(){finish++}};vm.createContext(ctx);vm.runInContext(code+';this.fn=scrDoLoop',ctx);ctx.fn({params:{back:1,maxLoops:2},until:{item:1,count:1}});assert.equal(next,1);assert.equal(finish,0);
});

test('raw damage packets decode documented offsets',()=>{
  const code=extract('  function dpsOnRawDamage(bytes, op) {','  function dpsNum(n)');
  const got=[];const ctx={DataView,dpsOnDamage:p=>got.push(p)};vm.createContext(ctx);vm.runInContext(code+';this.fn=dpsOnRawDamage',ctx);
  const act=new ArrayBuffer(29),a=new DataView(act);a.setUint32(2,123,true);a.setUint32(6,456,true);a.setInt16(22,321,true);a.setInt16(24,2,true);ctx.fn(act,138);
  assert.equal(got[0].GID,123);assert.equal(got[0].targetGID,456);assert.equal(got[0].damage,321);assert.equal(got[0].count,2);
  const sk=new ArrayBuffer(33),s=new DataView(sk);s.setUint16(2,77,true);s.setUint32(4,123,true);s.setUint32(8,456,true);s.setInt32(24,654321,true);s.setInt16(30,3,true);ctx.fn(sk,478);
  assert.equal(got[1].SKID,77);assert.equal(got[1].AID,123);assert.equal(got[1].targetID,456);assert.equal(got[1].damage,654321);assert.equal(got[1].count,3);
});

test('raw vanish counts own kill and ignores unrelated death',()=>{
  const code=extract('  function scrOnRawVanish(bytes) {','  (function scrKillInit()');
  const scrKill={total:0,byMobId:{},byName:{},atk:{42:Date.now()},name:{42:'Poring'},mobId:{42:1002},pos:{},nearby:false};
  const ctx={DataView,scrKill,scrPos:()=>[0,0],Math};vm.createContext(ctx);vm.runInContext(code+';this.fn=scrOnRawVanish',ctx);
  const own=new ArrayBuffer(7),a=new DataView(own);a.setUint32(2,42,true);a.setUint8(6,1);ctx.fn(own);
  assert.equal(scrKill.total,1);assert.equal(scrKill.byMobId[1002],1);assert.equal(scrKill.byName.Poring,1);
  const other=new ArrayBuffer(7),b=new DataView(other);b.setUint32(2,99,true);b.setUint8(6,1);ctx.fn(other);assert.equal(scrKill.total,1);
});

test('default shortcut opens menu and migrates old panel binding',()=>{
  const code=extract('  var HK_KEY2 =','  function hkSave()');
  const store=new Map([['dsh_ro_hotkeys_v2',JSON.stringify({panel:{ctrl:true,alt:true,shift:false,meta:false,key:'KeyQ'}})]]);
  const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  const ctx={localStorage,JSON,Object};vm.createContext(ctx);vm.runInContext(code+';this.fn=hkLoad',ctx);
  const cfg=ctx.fn();assert.equal(cfg.menu.key,'KeyQ');assert.equal(cfg.menu.ctrl,true);assert.equal(cfg.menu.alt,true);assert.equal(cfg.panel,undefined);
  assert.ok(source.includes('if (id === "menu") { roMenuToggle(); return; }'));
});

test('in-game battle checkbox overrides stale chat state',()=>{
  const code=extract('  function npBattleState() {','  function setBattle(on)');
  const ctx={npReadPanelState:()=>false,readChatBattle:()=>true,npHuntOn:true};vm.createContext(ctx);vm.runInContext(code+';this.fn=npBattleState',ctx);
  assert.equal(ctx.fn(),false);ctx.npReadPanelState=()=>null;assert.equal(ctx.fn(),true);ctx.readChatBattle=()=>null;ctx.npBattleKnown=false;assert.equal(ctx.fn(),null);ctx.npBattleKnown=true;ctx.npHuntOn=false;assert.equal(ctx.fn(),false);
});

test('DPS classifies skill fields and keeps normal attacks separate',()=>{
  const code=extract('  function dpsEmptyCur() {','  function dpsOnRawDamage(bytes, op) {');
  let now=1000;const ctx={Date:{now:()=>now},isFinite,Number,Math,Object,String,parseInt,DPS_IDLE_MS:10000,DPS_SKILL_LIMIT:64,
    DPS_TYPE_RANGES:{physical:'5,46-48',magical:'13-17',special:'115'},dpsTypeCache:{},CLIENT:{DB:{getSkillInfo:id=>id===999?{Type:'Magic'}:null},SS:{AID:10}},window:{require:()=>null},requireDB:()=>null,_skillInfoCache:null,
    dpsSource:'waiting',dpsTapInstalled:false,getSkillNameById:()=>'',dpsRenderSkills(){},dpsSelfAid:()=>10,dpsEntName:()=>''};
  vm.createContext(ctx);vm.runInContext(code+';this.hit=dpsOnDamage;this.kind=dpsSkillType;this.reset=dpsResetAll;this.active=dpsActiveMs',ctx);
  ctx.reset(now);ctx.dps.aid=10;ctx.hit({SKID:5,AID:10,targetID:20,damage:300,count:3});
  now=2000;ctx.hit({SKID:13,AID:10,targetID:20,damage:200,count:1});
  now=3000;ctx.hit({GID:10,targetGID:20,damage:100,count:1});
  assert.equal(ctx.kind(5),'physical');assert.equal(ctx.kind(13),'magical');assert.equal(ctx.kind(999),'magical');
  assert.equal(ctx.dps.types.physical,300);assert.equal(ctx.dps.types.magical,200);assert.equal(ctx.dps.types.melee,100);
  assert.equal(ctx.dps.total,600);assert.equal(ctx.dps.hits,5);assert.equal(ctx.dps.multi,1);assert.equal(ctx.dps.max,200);
  assert.equal(ctx.dps.skills.melee.dmg,100);assert.equal(ctx.dps.skills.s5.exact,300);
});

test('DPS combat segments exclude idle gaps and reset session memory',()=>{
  const code=extract('  function dpsEmptyCur() {','  function dpsOnRawDamage(bytes, op) {');
  let now=1000;const ctx={Date:{now:()=>now},isFinite,Number,Math,Object,String,parseInt,DPS_IDLE_MS:10000,DPS_SKILL_LIMIT:64,
    DPS_TYPE_RANGES:{physical:'5',magical:'13',special:'115'},dpsTypeCache:{},CLIENT:{DB:null,SS:{AID:10}},window:{require:()=>null},requireDB:()=>null,_skillInfoCache:null,
    getSkillNameById:()=>'',dpsRenderSkills(){},dpsSelfAid:()=>10,dpsEntName:()=>''};
  vm.createContext(ctx);vm.runInContext(code+';this.hit=dpsOnDamage;this.reset=dpsResetAll;this.active=dpsActiveMs',ctx);
  ctx.reset(now);ctx.dps.aid=10;ctx.hit({SKID:5,AID:10,targetID:20,damage:100,count:1});
  now=4000;ctx.hit({SKID:5,AID:10,targetID:20,damage:100,count:1});assert.equal(ctx.active(now),3000);
  now=20000;ctx.hit({SKID:13,AID:10,targetID:21,damage:200,count:1});assert.equal(ctx.dps.activeMs,3000);assert.equal(ctx.active(now),3000);
  now=22000;assert.equal(ctx.active(now),3000);ctx.reset(now);
  assert.equal(ctx.dps.total,0);assert.equal(ctx.dps.activeMs,0);assert.equal(ctx.dps.sessionAt,22000);assert.deepEqual(Object.keys(ctx.dps.skills),[]);
  ctx.dps.aid=10;ctx.CLIENT.SS.AID=0;ctx.hit({SKID:5,AID:10,targetID:20,damage:100,count:1});assert.equal(ctx.dps.aid,0);
  now=23000;ctx.CLIENT.SS.AID=10;ctx.hit({SKID:5,AID:10,targetID:20,damage:100,count:1});assert.equal(ctx.dps.sessionAt,23000);assert.equal(ctx.dps.total,100);
});

test('parsed damage tap preserves game callback and installs once',()=>{
  const tapCode=extract('  function dpsInstallTap() {','  function dpsNum(n)');
  const callbacks={},packets=[138,139,737,2248,276,478].map(id=>({id}));let gameCalls=0,dpsCalls=0;
  const nm={hookPacket(packet,cb){callbacks[packet.id]=cb;}};
  const ctx={DPS_PKTS:[138,139,737,2248,276,478],dpsSource:'waiting',dpsTapInstalled:false,dpsParsedSeen:false,CLIENT:{NM:nm},clientReady:()=>true,
    dpsOnDamage(){dpsCalls++},window:{require:n=>n==='Engine/MapEngine/Entity'?()=>packets.forEach(p=>nm.hookPacket(p,()=>{gameCalls++})):null}};
  vm.createContext(ctx);vm.runInContext(tapCode+';this.install=dpsInstallTap',ctx);
  assert.equal(ctx.install(),true);callbacks[138]({GID:10,targetGID:20,damage:300,count:3});
  assert.equal(gameCalls,1);assert.equal(dpsCalls,1);assert.equal(ctx.dpsParsedSeen,true);assert.equal(ctx.dpsSource,'parsed');assert.equal(ctx.install(),false);
});

test('shop sell rows use inventory tooltip path',()=>{
  const code=extract('  function itipShopSide(el) {','  function itipOver(e) {');
  const sell={querySelector:s=>s==='.WinSell'?{}:null};
  const input={closest:s=>s==='#NpcStore'?sell:(s==='#NpcStore .InputWindow'?{}:null)};
  const ctx={getComputedStyle:()=>({display:'block',visibility:'visible'})};vm.createContext(ctx);vm.runInContext(code+';this.side=itipShopSide;this.sell=itipShopSellMode',ctx);
  assert.equal(ctx.side(input),'input');assert.equal(ctx.sell(input),true);
  ctx.getComputedStyle=()=>({display:'none',visibility:'visible'});assert.equal(ctx.sell(input),false);
});

test('teleport shortcuts are global shared, migrated and capped',()=>{
  // V2.29.0：全局键 dsh_ro_tp_global_v1，首读合并角色档旧点（不删旧数据），跨标签 storage 实时刷新
  assert.ok(source.includes('dsh_ro_tp_global_v1'));
  assert.ok(source.includes('profiles[pk].saved.teleportPoints'));
  assert.ok(source.includes('ev.key !== TP_GLOBAL_KEY'));
  assert.ok(source.includes('data-tppf-go')); // 传送点悬浮条（点击直传）
  assert.ok(source.includes('list.length >= 20'));
  assert.ok(source.includes('else gptTeleport(p.map, p.x, p.y);'));
  assert.ok(source.includes('data-tpp-edit'));
  assert.ok(source.includes('data-tpp-del'));
});

test('GPT teleport builds random-map and exact-coordinate commands',()=>{
  const code=extract('  function gptSubmit(text) {','  function teleportToMap(map, onArrive) {');
  const sent=[];const ctx={window:{requirejs:null,require:null},document:{querySelectorAll:()=>[]},String,Number,Math,isFinite,mvLog(){}};
  vm.createContext(ctx);vm.runInContext(code+';gptSubmit=function(text){sent.push(text);return true};this.teleport=gptTeleport',Object.assign(ctx,{sent}));
  assert.equal(ctx.teleport('prontera'),true);
  assert.equal(ctx.teleport('prontera',152,94),true);
  assert.deepEqual(sent,['请带我去 prontera','请带我去 prontera 152 94 这个坐标']);
});

test('all teleport entry points avoid legacy airship and world-map clicks',()=>{
  assert.ok(!source.includes('PRIVATE_AIRSHIP_REQUEST'));
  assert.ok(!source.includes('document.querySelector(".gogogo")'));
  assert.ok(source.includes('case "teleport": gptTeleport(p.map, p.x, p.y);'));
  assert.ok(source.includes('status(gptTeleport(map) ? "GPT 传送请求已提交'));
  assert.ok(source.includes('var ok = gptTeleport("prontera")'));
});

test('assistant battle sub-tabs switch only their direct sibling pages',()=>{
  const code=extract('  function onSubTabClick(e) {','  panel.addEventListener("click", onSubTabClick, false)');
  function classes(...names){const s=new Set(names);return {contains:n=>s.has(n),toggle(n,on){on?s.add(n):s.delete(n)},has:n=>s.has(n)}}
  function node(cls,attrs={}){return {classList:classes(...cls.split(' ').filter(Boolean)),attrs,children:[],parentNode:null,style:{},getAttribute(n){return this.attrs[n]??null},querySelector(){return null},closest(sel){if(sel==='.sub-tab'&&this.classList.contains('sub-tab'))return this;if(sel==='[data-dsh-ui="1"]'||sel==='[id^="dsh-"]')return this.uiRoot||null;return null}}}
  const host=node('host'),tabs=node('sub-tabs'),battle=node('sub-tab active',{'data-sub':'zs-battle'}),skill=node('sub-tab',{'data-sub':'zs-skill'}),near=node('sub-tab',{'data-sub':'zs-near'}),p1=node('sub-page active',{'data-subpage':'zs-battle'}),p2=node('sub-page',{'data-subpage':'zs-skill'}),p3=node('sub-page',{'data-subpage':'zs-near'}),nested=node('sub-page active',{'data-subpage':'other'});
  host.children=[tabs,p1,p2,p3,nested];tabs.parentNode=host;tabs.children=[battle,skill,near];for(const x of tabs.children){x.parentNode=tabs;x.uiRoot=host}for(const x of [p1,p2,p3,nested])x.parentNode=host;
  const ctx={inAssistantUI:()=>true,renderBook(){throw new Error('not expected')}};vm.createContext(ctx);vm.runInContext(code+';this.fn=onSubTabClick',ctx);
  const event={target:skill};ctx.fn(event);
  assert.equal(skill.classList.has('active'),true);assert.equal(battle.classList.has('active'),false);
  assert.equal(p2.classList.has('active'),true);assert.equal(p2.style.display,'block');assert.equal(p1.style.display,'none');
  assert.equal(nested.classList.has('active'),false);assert.equal(event.__dshSubHandled,true);
  assert.ok(source.includes('zhu2TabsRoot.addEventListener("click", onSubTabClick, false)'));
});

test('same-map coordinate routing normalizes map prefixes and extensions',()=>{
  const code=extract('  function normMapKey(m) {','  // V2.13.0');const ctx={String};vm.createContext(ctx);vm.runInContext(code+';this.fn=normMapKey',ctx);
  for(const name of ['prontera','prontera.gat','prontera.rsw','map_prontera'])assert.equal(ctx.fn(name),'prontera');
  assert.equal(ctx.fn('geffen.gat'),'geffen');
  assert.ok(source.includes('normMapKey(want) === normMapKey(cur)'));
  assert.ok(!source.includes('want.toLowerCase() === cur.toLowerCase()'));
});

test('skill scheduler reports cooldown and 300ms margin yields to imminent skill',()=>{
  const castCode=extract('  function castOrderSkill(order, target) {','  $id("dsh-z-on")');
  const now=Date.now(),sent=[];const ctx={Date,Math,CLIENT:{SS:{Entity:{GID:1,position:[0,0]}},PS:{CZ:{USE_SKILL:function(){}}},NM:{sendPacket:p=>sent.push(p)}},zCastIdx:0,zUseCounts:{},zLockCounts:{},skillNextAt:{10:now+250},zSkillSentAt:{},zLastCastAt:0,zLastCastSkid:0,btDiagOn:false,
    ordinaryCastBlocked:()=>false,clampSkillLv:()=>1,dshCastSkip(){},tlog(){},$id:()=>({checked:false}),skillReq:()=>null,skillTypeBits:()=>0,getSkillRange:()=>9,dshCastMark(){},skillCdMs:()=>250,dshDiag(){},checkSkillCond:()=>({ok:true}),castStatusPrep:()=>false};
  vm.createContext(ctx);vm.runInContext(castCode+';this.cast=castOrderSkill',ctx);const order=[{skid:10,lv:1,uses:0,lock:0,prob:100,cond:'',cd:0}];
  assert.equal(ctx.cast(order,{GID:2,position:[1,0]}),'wait-cd');
  const gapCode=extract('  function skillNextGap(order) {','  function castOrderSkill(order, target) {');vm.runInContext(gapCode+';this.gap=skillNextGap',ctx);
  const gap=ctx.gap(order);assert.ok(gap>0&&gap<=300);assert.equal(gap<=300,true);
  ctx.skillNextAt[10]=Date.now()+700;assert.equal(ctx.gap(order)>300,true);
  ctx.skillNextAt[10]=0;assert.equal(ctx.cast(order,{GID:2,position:[1,0]}),true);assert.equal(sent.length,1);
  assert.equal(ctx.cast([],{GID:2,position:[1,0]}),'none');
});

test('lastRO option texts include boss physical damage and max load',()=>{
  const code=extract('  var ITIP_OPT_CN = {','  function itipOptList(item) {');
  const ctx={parseInt,String,itipDB:()=>null};vm.createContext(ctx);vm.runInContext(code+';this.fn=itipOptText',ctx);
  assert.equal(ctx.fn({index:148,value:12}),'对首领类魔物的物理伤害增加 12%');
  assert.equal(ctx.fn({index:203,value:500}),'最大负载增加 500');
});

test('storage cache tracks transfers including empty final state',()=>{
  const code=extract('  function storageClone(v) {','  function storageDecorateDom() {');
  const ctx={window:{},JSON,Array,Number,String};vm.createContext(ctx);vm.runInContext(code+';this.set=storageCacheSet;this.add=storageCacheAdd;this.remove=storageCacheRemove',ctx);
  ctx.set([{index:7,ITID:100,count:1,options:{Index0:148,Value0:10}},{index:8,ITID:100,count:1,options:{Index0:203,Value0:500}}]);
  ctx.add({index:7,ITID:100,count:2});assert.equal(ctx.window.__dshStorageCache[0].count,3);
  ctx.remove(7,3);assert.deepEqual(Array.from(ctx.window.__dshStorageCache,x=>x.index),[8]);
  ctx.remove(8,1);assert.equal(ctx.window.__dshStorageCache.length,0);
  assert.ok(Array.isArray(ctx.set([])));
});

test('warehouse maps identical ITIDs by exact instance index and colors rows',()=>{
  const mapCode=extract('  function itipStorageMap() {','  // ---- 浮层 DOM ----');
  const items=[{index:7,ITID:100,options:{Index0:148,Value0:10}},{index:8,ITID:100,options:{Index0:203,Value0:500}}];
  const ctx={findStorage:()=>items};vm.createContext(ctx);vm.runInContext(mapCode+';this.map=itipStorageMap',ctx);
  const mapped=ctx.map();assert.equal(mapped[7].options.Value0,10);assert.equal(mapped[8].options.Value0,500);
  assert.ok(source.includes('else if (itipIsStorage(el))'));
  assert.ok(source.includes('itipStorageMap()[Number(storageIndex)]'));
  assert.ok(source.includes('.item[data-dsh-itid="'));
});

test('storage close saves synchronized cache before component removal',()=>{
  const code=extract('  function storageClone(v) {','  (function () {');
  let saved=null,removed=false;
  const rows=[];const document={querySelectorAll:()=>rows};
  const inst={setItems(){},addItem(){},removeItem(){},onRemove(){removed=true;}};
  const ctx={window:{require:()=>null},CLIENT:{UI:{components:{Storage:inst}}},VER:'test',JSON,Array,Number,String,Date,console,document,
    localStorage:{getItem:()=> 'true'},findStorage(){return ctx.window.__dshStorageCache;},readStorageAndInventory(){assert.equal(removed,false);saved=JSON.parse(JSON.stringify(ctx.window.__dshStorageCache));},onStorageWindowOpen(){}};
  vm.createContext(ctx);vm.runInContext(code+';this.hook=hookStorageEarly',ctx);assert.equal(ctx.hook(),true);
  inst.setItems([{index:3,ITID:501,count:2}]);inst.removeItem(3,1);inst.onRemove();
  assert.equal(removed,true);assert.equal(saved[0].count,1);
});

test('v2.27 floating windows derive state from DOM and retry restore',()=>{
  assert.ok(source.includes('function fwActualOpen(id)'));
  assert.ok(source.includes('host.parentNode === st.body'));
  assert.ok(source.includes('fwRefreshHosts(id);'));
  assert.ok(source.includes('if (!fwSyncState(id))'));
  assert.ok(source.includes('fwRestoreTries >= FW_RESTORE_MAX'));
  assert.ok(source.includes('document.createComment("dsh-fw-origin:" + id)'));
  assert.ok(source.includes('st.origin.parentNode.insertBefore(st.host, st.origin.nextSibling)'));
  assert.ok(!source.includes('return !!fwOpenIds[id]'));
  assert.ok(!source.includes('fwReg("mvp"'));
});

test('floating actual-state rejects stale and hidden windows',()=>{
  const code=extract('  function fwActualOpen(id) {','  function fwSyncState(id)');
  const ctx={fwState:{}};vm.createContext(ctx);vm.runInContext(code+';this.fn=fwActualOpen',ctx);
  const body={},host={parentNode:body},win={parentNode:{},style:{display:'flex'}};
  ctx.fwState.x={win,body,host};assert.equal(ctx.fn('x'),true);
  win.style.display='none';assert.equal(ctx.fn('x'),false);
  win.style.display='flex';host.parentNode={};assert.equal(ctx.fn('x'),false);
  ctx.fwState.x.win=null;assert.equal(ctx.fn('x'),false);
});

test('safe monster references reject injected IDs',()=>{
  const code=extract('  function mobRefUrl(site, mid) {','  function gameFocusMob()');
  const ctx={String,encodeURIComponent};vm.createContext(ctx);vm.runInContext(code+';this.fn=mobRefUrl',ctx);
  assert.equal(ctx.fn('dvg',1002),'https://ro.dvg.cn/monsterinfo.php?id=1002');
  assert.equal(ctx.fn('ro321','1002'),'https://ro.ro321.com/index.php?page=re_mob_db&mob_id=1002');
  for(const bad of ['',0,-1,'1.2','1&x=1','javascript:1','12345678901'])assert.equal(ctx.fn('dvg',bad),'');
  assert.equal(ctx.fn('evil',1002),'');
  assert.ok(source.includes('target="_blank" rel="noopener noreferrer"'));
});

test('target bar is a transparent draggable float with portrait and ref links',()=>{
  // V2.29.0：目标锁定条 = demo 悬浮层（8898 by-id 头像 + 渐变血条 + 信息小字），面板内旧区块已移除
  assert.ok(source.includes('el.id = "dsh-tgt-bar"'));
  assert.ok(source.includes('http://127.0.0.1:8898/monster-sprites/by-id/'));
  assert.ok(source.includes('dsh-mob-fallback')); // 头像失败退化名字首字占位
  assert.ok(!source.includes('id="dsh-game-tgt"'));
  assert.ok(!source.includes('id="dsh-tgt-list"'));
  assert.ok(source.includes('EM.getFocusEntity'));
  assert.ok(source.includes('攻击名单（只主动攻击勾选的怪）'));
  assert.ok(source.includes('mobRefLinksHtml(id)')); // 任务目标怪外链（数量→RO321 / 资料→DVG）
  assert.ok(source.includes('el.id = "dsh-party-float"'));
  assert.ok(source.includes('p.action = 7;')); // 点色块锁定队友 REQUEST_ACT(7)
});

test('patch regressions cover hosts virtual rows tooltips and monk prerequisites',()=>{
  const item=source.indexOf('id="dsh-fw-item"'),close=source.indexOf("'</div>' +",item),tgt=source.indexOf('el.id = "dsh-tgt-bar"'); // V2.29.0：dsh-fw-tgt 面板区块已移除，锚到悬浮层创建处
  assert.ok(item>=0&&close>item&&close<tgt);
  assert.ok(source.includes('attributeFilter: ["data-index"]'));
  assert.ok(source.includes('setTimeout(itipRefresh, 0)'));
  assert.ok(!source.includes('if (!item) item = itipInvById(itid, inv2)'));
  assert.ok(source.includes('op === 0x1d0 || op === 0x1e1'));
  assert.ok(source.includes('selfSpirits.aid === aid && selfSpirits.map === map'));
  assert.ok(source.includes('o.skid === 267 ? realLv : req[2]'));
  assert.ok(source.includes('buffStateOn(86)'));
  assert.ok(source.includes('[267, "MO_FINGEROFFENSIVE", 1, null]'));
  assert.ok(!source.includes('document.querySelector(".startButton")'));
  assert.ok(source.includes('return npIsThree() ? npSendWhisper("NPC:setautoattack") : npSendUpdate(34, 1)'));
  assert.ok(!/spheres\s*>=\s*5[\s\S]{0,120}(爆气|270)/.test(source));
});

test('spirit packets cache only the current character',()=>{
  const code=extract('  function onSelfSpirits(bytes) {','  // V2.15.24：拦截服务器下发的技能真实后摇');
  // V2.34.0：补齐 vm 注入（gidInt / dshSphereLog）——此前缺失使 onSelfSpirits 内部抛错被 catch 吞掉，缓存永不命中
  const ctx={DataView,Math,CLIENT:{SS:{AID:42,Entity:{GID:42}}},selfSpirits:{aid:0,num:0,map:''},normMapKey:x=>x,getMapName:()=> 'moc_pryd02',
    gidInt:v=>{const n=Math.floor(Number(v));return Number.isFinite(n)&&n>0?n:0;},dshSphereLog:()=>{}};vm.createContext(ctx);vm.runInContext(code+';this.fn=onSelfSpirits;this.read=()=>selfSpirits',ctx);
  const packet=(aid,num)=>{const b=new ArrayBuffer(8),v=new DataView(b);v.setUint32(2,aid,true);v.setUint16(6,num,true);return b};
  ctx.fn(packet(99,5));assert.equal(ctx.read().aid,0);ctx.fn(packet(42,5));assert.equal(ctx.read().aid,42);assert.equal(ctx.read().num,5);assert.equal(ctx.read().map,'moc_pryd02');
});

function selfHealHarness({sitting=false,healFirst=true,healLv=7,sp=100,castOk=true}={}){
  const code=extract('  function escapePos() {','  function markFlyFail()');
  let now=10000;const sent=[];const pos=[10,10];
  const ids={
    'dsh-z-grp':{value:'3'},'dsh-z-grpact':{value:'瞬移'},'dsh-z-flygrp':{checked:true},'dsh-z-ona':{value:'瞬移'}
  };
  const ctx={Number,Math,parseInt,Date:{now:()=>now},CLIENT:{SS:{AID:7,Entity:{GID:7,position:pos,life:{hp:30,maxhp:100,sp}}},PS:{CZ:{USE_SKILL:function(){}}},NM:{sendPacket:p=>sent.push(p)}},saved:{healFirst},
    ESCAPE_TIMEOUT_MS:2500,ESCAPE_MAX_ATTEMPTS:3,escapeSeq:0,escapeBackoffUntil:0,escapeState:{pending:false,id:0,map:'',x:null,y:null,lastCast:0,ackAt:0,deadline:0,attempts:0,nextRetry:0,reason:''},selfHealHoldUntil:0,actLock:{act:null,until:0},lastMobs:[],zHpWatch:{lastHitAt:0},skillNextAt:{},
    normMapKey:x=>x,getMapName:()=> 'field',isSitting:()=>sitting,sendSit:down=>sent.push({action:down?'sit':'stand'}),setStatus(){},tlog(){},lockAct(act,ms){ctx.actLock={act,until:now+ms};return true},
    castTeleport(){if(castOk)sent.push({SKID:26});return castOk},clientReady:()=>true,isActFreeOnline:()=>true,potHpThr:()=>50,learnedSkillLv:id=>id===28?healLv:0,skillCdMs:()=>250,dshCastMark(){},$id:id=>ids[id]||null};
  vm.createContext(ctx);vm.runInContext(code+';this.escape=requestEmergencyEscape;this.pending=escapePending;this.heal=tickSelfHeal;this.blocked=ordinaryCastBlocked;this.state=()=>escapeState;this.reset=resetEmergencyEscape',ctx);
  return {ctx,sent,pos,setSitting:v=>{sitting=v},setNow:v=>{now=v},ack(){ctx.state().ackAt=now}};
}

test('emergency escape stands and teleports before Heal',()=>{
  const h=selfHealHarness({sitting:true});
  assert.equal(h.ctx.escape('群殴'),'stand');assert.deepEqual(h.sent,[{action:'stand'}]);
  h.setSitting(false);assert.equal(h.ctx.escape('群殴'),'teleport');assert.equal(h.sent[1].SKID,26);
  assert.equal(h.ctx.heal(),false);assert.deepEqual(h.sent.map(x=>x.SKID||x.action),['stand',26]);
});

test('unconfirmed teleport blocks Heal and ordinary skill casts',()=>{
  const h=selfHealHarness();h.ctx.escape('最近受击');
  assert.equal(h.ctx.pending(),true);assert.equal(h.ctx.heal(),false);
  assert.ok(source.includes('if (ordinaryCastBlocked()) return "escape";'));
  assert.equal(h.sent.filter(x=>x.SKID===28).length,0);
});

test('escape requires current SKID26 ACK plus credible transition',()=>{
  const h=selfHealHarness();h.ctx.escape('群殴');h.pos[0]=11;
  assert.equal(h.ctx.pending(),true,'ordinary movement without ACK must not confirm');
  h.ack();assert.equal(h.ctx.pending(),true,'small movement remains non-credible');
  h.pos[0]=18;assert.equal(h.ctx.pending(),false);assert.equal(h.ctx.heal(),true);
  assert.deepEqual(h.sent.map(x=>x.SKID),[26,28]);assert.equal(h.sent[1].selectedLevel,7);assert.equal(h.sent[1].targetID,7);
});

test('escape timeout retries finitely then releases pending with backoff',()=>{
  const h=selfHealHarness();h.ctx.escape('群殴');
  for(const at of [12500,12800,15300,15900,18400]){h.setNow(at);h.ctx.pending()}
  assert.equal(h.sent.filter(x=>x.SKID===26).length,3);assert.equal(h.ctx.state().pending,false);assert.equal(h.ctx.heal(),true);
});

test('rejected escape attempts reset after finite retries',()=>{
  const h=selfHealHarness({castOk:false});assert.equal(h.ctx.escape('最近受击'),'reject');
  for(const at of [10300,10900]){h.setNow(at);h.ctx.escape('最近受击')}
  assert.equal(h.ctx.state().pending,false);assert.equal(h.ctx.heal(),true);
});

test('Heal preference defaults off and persists through saved profile',()=>{
  const h=selfHealHarness({healFirst:false});assert.equal(h.ctx.heal(),false);
  assert.ok(source.includes('saved.healFirst = this.checked; saveSaved(saved)'));
  assert.ok(source.includes('checked = saved.healFirst === true'));
});

test('ordinary low HP prefers learned self Heal when enabled',()=>{
  const h=selfHealHarness();assert.equal(h.ctx.heal(),true);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].SKID,28);assert.equal(h.sent[0].selectedLevel,7);
});

test('Heal unavailable SP insufficient or cooldown falls back to items',()=>{
  for(const opts of [{healLv:0},{sp:5}]) assert.equal(selfHealHarness(opts).ctx.heal(),false);
  const h=selfHealHarness();h.ctx.skillNextAt[28]=11000;assert.equal(h.ctx.heal(),false);
  assert.ok(source.includes('masterTickReg(function () { try { tickSelfHeal(); } catch (e) {} });'));
  assert.ok(source.indexOf('tickSelfHeal();')<source.indexOf('tickItems();'));
});

test('sitting-hit direct fly is unified under emergency escape',()=>{
  assert.ok(source.includes('requestEmergencyEscape("坐下受击")'));
  assert.ok(!source.includes('doFly(); zMon.action = "坐下被打，瞬移脱离"'));
});

test('urgent mobbing and recent-hit checks precede sit and ordinary returns',()=>{
  // V2.34.0 重基：checkDefense 已由 zBossDecide/zGrpCount/flyCool/zQoaTry 重写，断言改为真实判定链
  //   坐下 → BOSS → 血量(含卡死4s) → 群殴 → 瞬移冷却/解围；并断言旧版「整拍 return」字样已消失
  const start=source.indexOf('function checkDefense(mobs, ent)'),sit=source.indexOf('doSitCycle(mobs)',start),boss=source.indexOf('var bossD = zBossDecide(mobs);',start),life=source.indexOf('var life = ent && ent.life;',start),stuck=source.indexOf('reason = "卡死4s"',start),grp=source.indexOf('var grpCnt = zGrpCount(mobs).n;',start),bossApply=source.indexOf('if (!needFly && bossFly)',start),grpApply=source.indexOf('if (!needFly && grpFly)',start),cool=source.indexOf('var flyCool',start),qoa=source.indexOf('zQoaTry(mobs, ent, now);',start);
  assert.ok(start>=0&&sit>start&&sit<boss&&boss<life&&life<stuck&&stuck<grp&&grp<bossApply&&bossApply<grpApply&&grpApply<cool&&cool<qoa,'判定顺序必须是 坐下→BOSS→血量(含卡死)→群殴→解围');
  const flyGate=source.indexOf('if (needFly && !flyCool) {',start),qoaGate=source.indexOf('else if (!needFly) {',start);
  assert.ok(flyGate>cool&&flyGate<qoaGate&&qoaGate<qoa,'瞬移冷却与解围必须是并列分支，冷却不得提前整拍返回');
  assert.ok(!source.includes('var urgentReason = emergencyThreatReason(mobs)'),'旧版「紧急原因」提前 return 必须已移除');
  assert.ok(!source.includes('if (now < flyFailUntil) return')&&!source.includes('if (now - lastFly < flyInt) return'),'瞬移冷却不得写成整拍 return');
});

test('configured item automation remains available fallback',()=>{
  const code=extract('  function tickItems() {','  // 自愈先于物品规则');const used=[];
  const ctx={itemList:[{itid:501,cond:'hp',condval:50}],potNoPotion:false,saved:{healFirst:false},selfHealHoldUntil:0,ordinaryCastBlocked:()=>false,clientReady:()=>true,CLIENT:{SS:{Entity:{life:{hp:30,maxhp:100,sp:10,maxsp:100}}}},Date,
    $id:id=>id==='dsh-itemen'?{checked:true}:null,findInventory:()=>[{ITID:501,index:4}],useItemByIndex:i=>used.push(i),buffStId:()=>-1,buffStateOn:()=>false};
  vm.createContext(ctx);vm.runInContext(code+';this.tick=tickItems',ctx);ctx.tick();assert.deepEqual(used,[4]);
  assert.ok(source.includes('masterTickReg(function () { try { tickItems(); } catch (e) {} });'));
});

test('version constants agree and feedback is visible',()=>{
  const meta=source.match(/@version\s+(\S+)/)?.[1], runtime=source.match(/var VER = "([^"]+)"/)?.[1];
  // V2.34.0：不再写死版本号——只校验格式与「文件头 / 运行时常量一致」，升版不用改用例
  assert.ok(/^\d+\.\d+\.\d+$/.test(meta),'@version 必须是 x.y.z，实际=' + meta);assert.equal(runtime,meta);
  assert.ok(source.includes('function roFeedback(text, cls)'));
  assert.ok(source.includes('id = "dsh-feedback"'));
});
test('startup always collapses legacy panel regardless of saved state',()=>{
  // V2.29.0 BUG 修复：saved.collapsed===false 的档案刷新后不再自动弹出旧版设置界面
  const code=extract('  // V2.24.1：旧版设置界面入口','  // ---------------- 快捷键');
  const mk=()=>{const saved={collapsed:false},calls=[];const ctx={saved,saveSaved:()=>calls.push('save'),applyCollapse:c=>calls.push(c)};vm.createContext(ctx);vm.runInContext(code,ctx);return {saved,calls}};
  const a=mk();assert.equal(a.saved.collapsed,true);assert.deepEqual(a.calls,['save',true]); // 启动强制收起并写回
  // 手动打开路径保留：功能菜单打开写 collapsed=false + applyCollapse(false)
  assert.ok(source.includes('saved.collapsed = false; try { saveSaved(saved); } catch (e) {}'));
  assert.ok(source.includes('applyCollapse(false);'));
  // 快捷键 toggle 基于 collapsed 翻转：启动已写回 true → 首次按下即打开，不会「按了没反应」
  assert.ok(source.includes('if (saved.collapsed) { saved.collapsed = false; saveSaved(saved); applyCollapse(false); }'));
});

// ================= V2.34.0 实验版：群殴/解围/BOSS 三模式离线自检 =================
// 说明：上方既有用例读取发布文件 ro-assist.user.js；本次改动落在实验版 ro-assist-exp.user.js，
//       故本组用例显式读取实验版文件（纯新增用例，不改动既有断言与框架）。
const expSource = fs.readFileSync(new URL('../ro-assist-exp.user.js', import.meta.url), 'utf8');
function expExtract(start, end) { const a = expSource.indexOf(start), b = expSource.indexOf(end, a); assert.ok(a >= 0 && b > a, 'expExtract 失败: ' + start); return expSource.slice(a, b); }

test('exp 防御与瞬移新控件 id 全部就位且默认值正确', () => {
  assert.ok(expSource.includes('id="dsh-z-grpn" type="number" value="6" min="0"'));
  assert.ok(expSource.includes('id="dsh-z-flyrange" type="checkbox" checked>远程怪计入群殴'));
  assert.ok(expSource.includes('id="dsh-z-qoaen" type="checkbox" checked>解围技能'));
  assert.ok(expSource.includes('id="dsh-z-qoan" type="number" value="3"'));
  assert.ok(expSource.includes('id="dsh-z-qoaskill"'));
  assert.ok(expSource.includes('id="dsh-z-qoaskilllv"'));
  assert.ok(expSource.includes('id="dsh-z-bossact"'));
  assert.ok(expSource.includes('id="dsh-z-bosshp" type="number" value="30" min="1" max="99"'));
  assert.ok(expSource.includes('%（各职业自填）'));
  assert.ok(expSource.includes('id="dsh-z-flyint" type="number" value="4"'), '瞬移间隔控件不得丢失');
  assert.ok(expSource.includes('id="dsh-z-diag" type="checkbox">战斗判定诊断(默认关)'));
  assert.ok(expSource.includes('id="dsh-z-diagcopy"'));
  assert.ok(expSource.includes('id="dsh-z-diagbox" readonly'));
});

test('exp 旧控件已移除、PROF_CONTROLS 同步清理且旧配置一次性迁移', () => {
  assert.ok(!expSource.includes('id="dsh-z-grp"'));
  assert.ok(!expSource.includes('id="dsh-z-grpact"'));
  assert.ok(!expSource.includes('id="dsh-z-bossfly"'));
  const profCode = expExtract('  var PROF_CONTROLS = [', '  ];') + '  ];';
  assert.ok(!profCode.includes('"dsh-z-grp"'), 'PROF_CONTROLS 仍登记 dsh-z-grp');
  assert.ok(!profCode.includes('"dsh-z-grpact"'), 'PROF_CONTROLS 仍登记 dsh-z-grpact');
  assert.ok(!profCode.includes('"dsh-z-bossfly"'), 'PROF_CONTROLS 仍登记 dsh-z-bossfly');
  const migCode = expExtract('  function migrateZControls(ui) {', '  function migrateZControlsAll() {');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(migCode + ';this.mig = migrateZControls', ctx);
  const ui1 = { 'dsh-z-grp': '8', 'dsh-z-grpact': '解围技能', 'dsh-z-bossfly': 1, 'dsh-z-hpfly': '25' };
  assert.equal(ctx.mig(ui1), true);
  assert.equal(ui1['dsh-z-grpn'], '8');            // 旧群殴数字迁到 dsh-z-grpn
  assert.equal(ui1['dsh-z-bossact'], '瞬移');       // 旧勾选 → 瞬移
  assert.equal(ui1['dsh-z-grp'], undefined);
  assert.equal(ui1['dsh-z-grpact'], undefined);
  assert.equal(ui1['dsh-z-bossfly'], undefined);
  assert.equal(ui1['dsh-z-hpfly'], '25');          // 其它档位不受影响
  const ui2 = { 'dsh-z-bossfly': 0 }; ctx.mig(ui2); assert.equal(ui2['dsh-z-bossact'], '不处理');
  const ui3 = { 'dsh-z-grpn': '4', 'dsh-z-grp': '9' }; ctx.mig(ui3); assert.equal(ui3['dsh-z-grpn'], '4');
  assert.equal(ctx.mig({}), false);
});

test('exp PROF_CONTROLS 已登记全部新控件且类型正确', () => {
  const code = expExtract('  var PROF_CONTROLS = [', '  ];') + '  ];';
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(code + ';this.ids = PROF_CONTROLS.map(function (r) { return r[0]; }); this.types = {}; for (var i = 0; i < PROF_CONTROLS.length; i++) this.types[PROF_CONTROLS[i][0]] = PROF_CONTROLS[i][1];', ctx);
  for (const id of ['dsh-z-grpn', 'dsh-z-qoaen', 'dsh-z-qoan', 'dsh-z-bossact', 'dsh-z-bosshp', 'dsh-z-flyrange', 'dsh-z-diag']) assert.ok(ctx.ids.includes(id), 'PROF_CONTROLS 缺 ' + id);
  assert.equal(ctx.types['dsh-z-grpn'], 'v');
  assert.equal(ctx.types['dsh-z-qoaen'], 'c');
  assert.equal(ctx.types['dsh-z-qoan'], 'v');
  assert.equal(ctx.types['dsh-z-bossact'], 'v');
  assert.equal(ctx.types['dsh-z-bosshp'], 'v');
  assert.equal(ctx.types['dsh-z-flyrange'], 'c');
  assert.equal(ctx.types['dsh-z-diag'], 'c');
});

test('exp 受击观测 zHitBy 在伤害回调里记录攻击者与命中距离', () => {
  assert.ok(expSource.includes('var zHitBy = {};'));
  assert.ok(expSource.includes('zHitBy[gid] = { ts: Date.now(), dist: d };'));
  assert.ok(expSource.includes('EMz.get(gid)'));
  assert.ok(expSource.includes('if (dmg > 0) { dps.taken += dmg; zHitMark(gid); }'), 'dpsOnDamage 必须调用 zHitMark');
  assert.ok(expSource.includes('zHitKeepMs = 3000'));
  assert.ok(expSource.includes('r.dist >= 4 && !rangedOn'), '远程判定必须是命中距离 >= 4');
});

test('exp 群殴数按实际围攻计算并受远程怪开关控制', () => {
  const code = expExtract('  var zHitBy = {};', '  function zEntHpPct(gid) {');
  let rangeOn = true;
  const ctx = { gidInt: v => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; },
    $id: id => (id === 'dsh-z-flyrange' ? { checked: rangeOn } : null), window: {}, Date };
  vm.createContext(ctx); vm.runInContext(code + ';this.count = zGrpCount', ctx);
  const now = Date.now();
  const mobs = [{ GID: 101, dist: 2 }, { GID: 102, dist: 3 }];   // 101 贴身, 102 不贴身
  ctx.zHitBy = { 11: { ts: now - 100, dist: 1 }, 22: { ts: now - 200, dist: 6 }, 33: { ts: now - 9000, dist: 1 } };
  rangeOn = true;
  assert.equal(ctx.count(mobs).n, 3);        // 11 + 22(远程计入) + 101 = 3（33 过期不计）
  assert.equal(ctx.count(mobs).hit, 2);
  rangeOn = false;
  assert.equal(ctx.count(mobs).n, 2);        // 远程 22 不计 → 11 + 101
  ctx.zHitBy = {};
  rangeOn = true;
  assert.equal(ctx.count(mobs).n, 1);        // zHitBy 无数据 → 退化为只数贴身 <=2 格
});

test('exp zWalk 锁定候选口径与 zAttack 一致（V2.34.4 名单优先）', () => {
  assert.ok(expSource.includes('anyLock ? !!(mid && lockList[mid]) : zAllMobsW'));
  const walk = expExtract('  function zWalk() {', '  function zAttack() {');
  assert.ok(walk.includes('var zAllMobsW = !$id("dsh-z-allmobs") || $id("dsh-z-allmobs").checked;'));
});

test('exp 三个早退点不再冻结整拍且卡死判定断开自锁环', () => {
  assert.ok(expSource.includes('zHoldTick("紧急脱战（等待位移确认）", true)'));
  assert.ok(expSource.includes('zHoldTick("坐下回血中", false)'));
  assert.ok(expSource.includes('zHoldTick("已停手（等指令）", true)'));
  assert.ok(!/if \(escapePending\(\)\) \{ requestEmergencyEscape\(escapeState\.reason\); zMon\.action/.test(expSource), 'escapePending 分支不得再整拍 return');
  const hold = expExtract('  function zHoldTick(msg, doWalk) {', '  // ================= V2.34.0 A7');
  assert.ok(hold.includes('checkDefense('), 'zHoldTick 必须继续防御判定');
  assert.ok(hold.includes('zWalk()'), 'zHoldTick 必须继续走路');
  assert.ok(expSource.includes('&& !escapePending() && now >= flyFailUntil) { needFly = true; reason = "卡死4s"; zStuckSince = now; }'));
});

test('exp BOSS 三模式与解围技能按确认顺序排列（BOSS→血量→群殴→解围）', () => {
  const sel = expExtract('id="dsh-z-bossact"', '</select>');
  for (const opt of ['瞬移', '优先攻击', '等待残血补尾刀']) assert.ok(sel.includes('<option>' + opt + '</option>'), 'BOSS 选项缺 ' + opt);
  assert.ok(sel.includes('<option selected>不处理</option>'), 'BOSS 默认必须是不处理');
  assert.ok(expSource.includes('<span class="st">锁定则优先攻击</span>'));
  assert.ok(expSource.includes('var isBoss = !!(mb && mb.MvpDropsNum > 0);'), 'BOSS 识别必须沿用 MvpDropsNum');
  const start = expSource.indexOf('function checkDefense(mobs, ent)');
  const boss = expSource.indexOf('var bossD = zBossDecide(mobs);', start);
  const life = expSource.indexOf('var life = ent && ent.life;', start);
  const stuck = expSource.indexOf('reason = "卡死4s"', start);
  const grp = expSource.indexOf('var grpCnt = zGrpCount(mobs).n;', start);
  const bossApply = expSource.indexOf('if (!needFly && bossFly)', start);
  const grpApply = expSource.indexOf('if (!needFly && grpFly)', start);
  const cool = expSource.indexOf('var flyCool', start);
  const qoa = expSource.indexOf('zQoaTry(mobs, ent, now);', start);
  assert.ok(boss > start && boss < life && life < stuck && stuck < grp && grp < bossApply && bossApply < grpApply && grpApply < cool && cool < qoa, '判定顺序必须是 BOSS→血量(含卡死)→群殴→解围');
  const threat = expExtract('  function emergencyThreatReason(mobs) {', '  function ordinaryCastBlocked() {');
  assert.ok(!threat.includes('qoa'), '解围技能不得进 emergencyThreatReason');
  assert.ok(threat.includes('dsh-z-grpn'), '群殴自动瞬移仍须在紧急原因里');
  const qoaFn = expExtract('  function zQoaTry(mobs, ent, now) {', '  // A3：BOSS 三模式判定');
  assert.ok(!/ordinaryCastBlocked\s*\(/.test(qoaFn), '解围技能不得调用 ordinaryCastBlocked');
  assert.ok(qoaFn.includes('skillNextAt[skid]') && qoaFn.includes('zQoaNextAt'), '解围技能必须有 CD/公共CD 门');
  assert.ok(qoaFn.includes('Math.max(skillCdMs({ skid: skid, cd: 0 }), 1000)'), '解围技能必须有 1s 保底 CD 防每拍重放');
  assert.ok(qoaFn.includes('dsh-z-hpfly'), '解围技能只在血线之上放');
  const bossFn = expExtract('  function zBossDecide(mobs) {', '  // A6：早退点不冻结整拍');
  assert.ok(bossFn.includes('out.hp >= 0 && out.hp <= line'), '残血到位才切过去补尾刀');
  assert.ok(bossFn.includes('else if (out.hp >= 0) out.skip = gidInt(rec.GID)'), '未到尾刀线既不打也不飞');
  assert.ok(bossFn.includes('lockList[String(rec.mid)]'), '瞬移模式遇锁定 BOSS 必须转优先攻击');
  assert.equal((expSource.match(/if \(zBossSkipGid && gidInt\(e\.GID\) === zBossSkipGid\) return;/g) || []).length, 2, 'zAttack/zWalk 都要剔除未到尾刀线的 BOSS');
});

// ================= V2.34.0：功能菜单五栏 / 一级窗口 / 物品区 / 技能输入离线自检 =================
// 说明：读取实验版 ro-assist-exp.user.js；用「极小标签嵌套解析」直接验证 PAGE_HTML 生成的 DOM 归属，
//       不依赖浏览器，能真正抓出「浮窗套浮窗 / 内容留错窗口 / 旧控件没删干净」。
const EXP_VOID = new Set(['input','br','img','hr','meta','link','source','col','area','base','wbr','embed','param','track']);
// id → 祖先链（形如 "div#dsh-fw-mlock>div"），只统计 id，不做样式/文本解析
function expAncestors(html) {
  const out = {}; const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3];
    if (close) { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].tag === tag) { stack.length = i; break; } } continue; }
    const idm = /id="([^"]+)"/.exec(attrs);
    if (idm) out[idm[1]] = stack.map(x => x.tag + (x.id ? '#' + x.id : '')).join('>');
    if (!EXP_VOID.has(tag)) stack.push({ tag, id: idm ? idm[1] : null });
  }
  return out;
}
// 按属性定位 PAGE_HTML 里的某一段纯字符串拼接，从行首截到 endMarker，再当 JS 表达式求值
function expHtmlByAttr(attr, endMarker) {
  const a = expSource.indexOf(attr);
  assert.ok(a >= 0, '找不到标记 ' + attr);
  const lineStart = expSource.lastIndexOf('\n', a) + 1;
  const b = expSource.indexOf(endMarker, a);
  assert.ok(b > a, '找不到结束标记 ' + endMarker);
  return vm.runInNewContext('(' + expSource.slice(lineStart, b).replace(/\+\s*$/, '') + ')');
}
function expZhuHtml() {
  let code = expExtract("zhu: '' +", "assist: '' +");
  code = code.replace(/^\s*zhu:\s*/, '').replace(/,\s*$/, '');
  return vm.runInNewContext('(' + code + ')');
}

test('exp 功能菜单五栏顺序与条目齐全', () => {
  const code = expExtract('  var RO_MODULES = [', '  ];') + '  ];';
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(code + ';this.secs=[];this.bySec={};for(var i=0;i<RO_MODULES.length;i++){var m=RO_MODULES[i];if(this.secs[this.secs.length-1]!==m.sec)this.secs.push(m.sec);(this.bySec[m.sec]=this.bySec[m.sec]||[]).push(m.id);}', ctx);
  assert.deepEqual(Array.from(ctx.secs), ['常用', '战斗功能', '战斗辅助', '提示', '其他'], 'sec 顺序即菜单显示顺序');
  assert.deepEqual(Array.from(ctx.bySec['常用']), ['menu', 'tp', 'np', 'zhu']);
  assert.deepEqual(Array.from(ctx.bySec['战斗功能']), ['mlock', 'zhu2', 'zskill']);
  assert.deepEqual(Array.from(ctx.bySec['战斗辅助']), ['aid', 'party', 'dps', 'boss', 'askcombo', 'item']);
  assert.deepEqual(Array.from(ctx.bySec['提示']), ['zhud', 'ztip', 'tgt', 'znear']);
  assert.deepEqual(Array.from(ctx.bySec['其他']), ['perf', 'mvp', 'panel']);
});

test('exp 三个一级窗口容器 + fwReg + RO_MODULES 登记齐全且走标准浮窗分支', () => {
  const html = expZhuHtml();
  for (const id of ['zhu2', 'zskill', 'znear']) {
    assert.ok(html.includes('id="dsh-fw-' + id + '"'), '缺少容器 #dsh-fw-' + id);
    assert.ok(expSource.includes('fwReg("' + id + '"'), '缺少 fwReg("' + id + '")');
    assert.ok(html.includes('data-fw="' + id + '"'), '缺少浮窗按钮 data-fw=' + id);
    assert.ok(html.includes('id="dsh-fw-btn-' + id + '"'), '缺少浮窗按钮 #dsh-fw-btn-' + id);
  }
  assert.ok(expSource.includes('{ id: "zskill", name: "技能设置"'), 'RO_MODULES 缺 zskill');
  assert.ok(expSource.includes('{ id: "znear", name: "附近怪物实时列表"'), 'RO_MODULES 缺 znear');
  // 新 id 不得另起一套窗口系统：继续沿用 fwSyncState / fwOpen / fwClose
  assert.ok(expSource.includes('return fwSyncState(id);'));
  assert.ok(expSource.includes('if (!fwActualOpen(id)) fwOpen(id, false);'));
  assert.ok(expSource.includes('document.getElementById("dsh-win-fw-" + id)'));
});

test('exp 助手页三个窗口 DOM 归属正确且旧页签 UI 已移除', () => {
  const html = expZhuHtml();
  assert.ok(!/sub-tabs|data-sub="zs-|data-subpage="zs-/.test(html), '旧的三页签 UI 必须移除');
  const anc = expAncestors(html);
  assert.ok((anc['dsh-healfirst'] || '').includes('dsh-fw-zhu2'), '战斗设置内容应在 #dsh-fw-zhu2');
  assert.ok((anc['dsh-z-allmobs'] || '').includes('dsh-fw-zhu2'), '目标范围设置应在 #dsh-fw-zhu2');
  assert.ok((anc['dsh-skillpick'] || '').includes('dsh-fw-zskill'), '点选技能应在 #dsh-fw-zskill');
  assert.ok((anc['dsh-skillorderlist'] || '').includes('dsh-fw-zskill'), '技能顺序表应在 #dsh-fw-zskill');
  assert.ok((anc['dsh-askskill'] || '').includes('dsh-fw-zskill'), '辅助技能应在 #dsh-fw-zskill');
  for (const id of ['dsh-scanen', 'dsh-scanint', 'dsh-scanlist', 'dsh-scanst']) assert.ok((anc[id] || '').includes('dsh-fw-znear'), id + ' 应在 #dsh-fw-znear');
  assert.ok(!(anc['dsh-scanen'] || '').includes('dsh-fw-zhu2'), '侦查扫描行必须自战斗设置移出');
});

test('exp 攻击名单与物品窗口拆分：mlock 独立、掉落树随 mlock、白名单/背包归 item', () => {
  const html = expHtmlByAttr('data-subpage="ap-item"', '// 子页9');
  const anc = expAncestors(html);
  assert.ok(html.includes('id="dsh-fw-item"') && html.includes('id="dsh-fw-mlock"'));
  assert.ok(!(anc['dsh-fw-mlock'] || '').includes('dsh-fw-item'), '#dsh-fw-mlock 不得嵌套在 #dsh-fw-item 内');
  assert.ok((anc['dsh-drop-tree'] || '').includes('dsh-fw-mlock'), '怪物掉落树应留在攻击名单窗口');
  assert.ok((anc['dsh-z-maplock'] || '').includes('dsh-fw-mlock'), '本图攻击名单应在 mlock');
  assert.ok((anc['dsh-locklist'] || '').includes('dsh-fw-mlock'), '攻击名单列表应在 mlock');
  assert.ok((anc['dsh-lockcount'] || '').includes('dsh-fw-mlock'));
  assert.ok((anc['dsh-mobsearch'] || '').includes('dsh-fw-mlock'), '怪物搜索（掉落树搜索）归攻击名单窗口');
  for (const id of ['dsh-wllist', 'dsh-wlcount', 'dsh-bag-state', 'dsh-bag-clean', 'dsh-picken', 'dsh-pickwalk', 'dsh-picksafe', 'dsh-pickmap', 'dsh-pickmapbtn']) assert.ok((anc[id] || '').includes('dsh-fw-item'), id + ' 应在 #dsh-fw-item');
});

test('exp 物品搜索控件与代码已删净，「＋加入」落在白名单区块内', () => {
  assert.ok(!expSource.includes('dsh-itemsearch'), '物品搜索输入框/按钮/结果区与绑定必须删净');
  assert.ok(!expSource.includes('renderItemSearch'), 'renderItemSearch 必须删净');
  assert.ok(!expSource.includes('buildItemXIndex'), '掉落反查索引（只服务物品搜索）必须删净');
  const html = expHtmlByAttr('data-subpage="ap-item"', '// 子页9');
  const anc = expAncestors(html);
  assert.ok((anc['dsh-wlid'] || '').includes('dsh-fw-item'), '手动加ID输入应在物品窗口的白名单区块内');
  assert.ok((anc['dsh-wladdbtn'] || '').includes('dsh-fw-item'), '「＋加入」按钮应在物品窗口的白名单区块内');
  assert.ok(expSource.includes('$id("dsh-wladdbtn").addEventListener("click"'), '「＋加入」必须已绑定新的小ID输入行');
  assert.ok(expSource.includes('function getItemNameS(id)'), 'getItemNameS 仍被图鉴/仓库统计复用，必须保留');
});

test('exp 技能点选/顺序表等级输入与释放% 即时写回守卫', () => {
  assert.ok(expSource.includes('data-lvsel="'), '点选网格每行必须有等级输入');
  assert.ok(expSource.includes('skillLine({ skid: skid, lv: lv, cond: "", prob: 100 })'), '勾选加入顺序表必须用输入框里的等级');
  assert.ok(expSource.includes("if (++skillPickTicker % 3 === 0 && !skillEditFocused())"), '3 秒自动重绘必须有焦点守卫');
  const guard = expExtract('  function skillEditFocused() {', '  $id("dsh-skillorder").addEventListener("input"');
  assert.ok(guard.includes('document.activeElement'), '守卫必须判断 document.activeElement');
  assert.ok(guard.includes('#dsh-skillorderlist') && guard.includes('#dsh-skillpick'), '守卫必须覆盖顺序表与点选网格');
  const order = expExtract('  function renderSkillOrderList() {', '  function renderSkillPick() {');
  assert.ok(order.includes('data-lv="'), '顺序表每行必须有等级输入');
  assert.ok(order.includes('inp.addEventListener("input"'), '等级/释放% 必须走 input 即时写回');
  assert.ok(order.includes('inp.addEventListener("blur"'), '失焦必须归一化');
  assert.ok(order.includes('skDebounce('), '写回必须去抖');
  assert.ok(!order.includes('inp.addEventListener("change"'), '释放% 不得再只绑 change（未失焦会被旧值弹回）');
  assert.ok(order.includes('skPatch(skid'), '写回必须统一走 skillLine 序列化（7 段格式不变）');
  assert.ok(order.includes('map(skillLine).join("\\n")'), '写回必须用 skillLine 原格式（7 段）拼回 textarea');
});

test('exp 版本号格式合法且文件头与运行时常量一致', () => {
  const hv = /@version\s+(\S+)/.exec(expSource)?.[1];
  const rv = /var VER = "([^"]+)"/.exec(expSource)?.[1];
  assert.match(String(hv), /^[0-9]+\.[0-9]+\.[0-9]+$/, '@version 必须是 x.y.z');
  assert.equal(hv, rv, '@version 必须与运行时常量 VER 一致');
  assert.ok(expSource.includes('V2.34.0 变更摘要'), '文件头必须有 V2.34.0 变更摘要');
});

test('exp 战斗诊断升级：每拍含 HP/死亡标记/怪物快照，死亡自动上报，复制按钮走捕获阶段', () => {
  const snap = expExtract('  function zDiagSnapNow() {', '  function zDiagTick() {');
  ['hp:', 'hpMax:', 'sp:', 'spMax:', 'map:', 'x:', 'y:', 'running:', 'npHunt:', 'dead:', 'flyAt:', 'mobs:'].forEach((k) => assert.ok(snap.includes(k), 'zDiagSnapNow 必须含字段 ' + k));
  const tick = expExtract('  function zDiagTick() {', 'masterTickReg(function');
  assert.ok(tick.includes('zDiagPost("zdiag-death")'), '死亡必须自动上报');
  assert.ok(tick.includes('zDiagPost("zdiag-10min")'), '必须有 10 分钟保底上报');
  assert.ok(expSource.includes('zDiagPost("zdiag-manual")'), '复制按钮必须同时触发一次上报');
  assert.ok(expSource.includes('    }, true);'), '复制按钮监听必须在捕获阶段（冒泡会被事件隔离层拦掉）');
  const post = expExtract('  function zDiagPost(tag) {', '  function zDiagSnapNow() {');
  assert.ok(post.includes('127.0.0.1:8899/api/probe-collect'), '上报目标只能本机接收服务');
});

test('exp v2.34.2 救命逃生补丁：失血速率触发 / 强制解锁 / 翅膀兜底 / 上报顺序', () => {
  assert.ok(expSource.includes('function hpDrop2sPct(maxhp, now) {'), '必须有失血速率采样函数');
  assert.ok(expSource.includes('now - hpDropHist[0].t > 2000'), '窗口必须是 2 秒');
  const def = expExtract('  var hpDrop = 0;', '      var flyInt = ');
  assert.ok(def.includes('hpDrop >= 25 && mobs.length > 0'), '失血 ≥25%/2s 必须触发瞬移');
  assert.ok(def.includes('reason = "失血"'), '必须记录原因「失血」');
  const cool = expExtract('      var critEsc = false;', '      if (needFly && !flyCool) {');
  assert.ok(cool.includes('flyFailUntil = 0'), '救命场景必须清连败锁');
  assert.ok(cool.includes('zQoaNearCount(mobs) >= 3'), '贴身≥3只是救命条件之一');
  assert.ok(expSource.includes('|| flyResult === "backoff"'), '退避不得计入失败');
  const esc = expExtract('  function castEmergencyEscape() {', '  function escapePending() {');
  assert.ok(esc.includes('findFlyWing()') && esc.includes('useItemByIndex(wf.index)'), '紧急脱战必须有翅膀兜底');
  assert.ok(esc.includes('escapeState.attempts >= 2'), '第 2 次尝试起优先翅膀');
  const tick = expExtract('  function zDiagTick() {', 'masterTickReg(function');
  assert.ok(tick.indexOf('arr.push(s)') < tick.indexOf('zDiagPost("zdiag-death")'), '死亡那一拍必须先入库再上报');
  assert.ok(expSource.includes('cfg: cfgP'), '上报必须带设置快照');
  const snap = expExtract('  function zDiagSnapNow() {', '  function zDiagTick() {');
  ['s26:', 'wing:', 'flyFail:'].forEach((k) => assert.ok(snap.includes(k), '快照必须含字段 ' + k));
});

// ================= V2.34.0 追改：尾刀模式「等待残血补尾刀」对用户显式锁定的 BOSS 同样生效 =================
test('exp 尾刀模式锁定跳过：守卫同时引用 zBossSkipGid 与 zLock.gid 且绝不清锁', () => {
  const guard = expExtract('      // V2.34.0 追改：尾刀模式下锁定的 BOSS', '        EM.forEach(function (e) {');
  assert.ok(guard.includes('zBossSkipGid'), '跳过守卫必须引用 zBossSkipGid');
  assert.ok(guard.includes('zLock.gid'), '跳过守卫必须引用 zLock.gid');
  assert.ok(expSource.includes('if (zLock.gid && !zLockBossSkip) {'), '锁定目标校验块必须由 !zLockBossSkip 守卫（未命中时整块行为不变）');
  assert.ok(expSource.includes('var zLockBossSkip = !!(zBossSkipGid && zLock.gid && gidInt(zLock.gid) === zBossSkipGid);'), '守卫判定必须同时要求 skip 命中且锁指向它');
  // 该跳过路径不得清锁：整份脚本里 zLock.gid = null 只允许改动前既有的 3 处
  assert.doesNotMatch(guard, /zLock\.gid\s*=\s*(null|undefined|""|'')/, '跳过分支内不得出现清除 zLock.gid 的赋值');
  assert.equal((expSource.match(/zLock\.gid = null/g) || []).length, 3, '不得新增任何清除 zLock.gid 的赋值（既有 3 处不变）');
});

test('exp 尾刀模式跳过只来自尾刀分支，其它三模式与非选中攻击者一路均未改动', () => {
  // skip 只在「等待残血补尾刀」分支产出；瞬移/优先攻击分支不得出现 out.skip
  const other = expExtract('if (act === "瞬移" && rec.mid != null', 'else if (act === "等待残血补尾刀") {');
  assert.ok(!other.includes('out.skip'), '瞬移/优先攻击分支不得产出 skip（三模式行为不变）');
  const tail = expExtract('else if (act === "等待残血补尾刀") {', '      zBossSkipGid = out.skip || 0;');
  assert.ok(tail.includes('out.skip'), 'skip 只能由尾刀分支产出');
  assert.ok(other.includes('act = "优先攻击"'), '瞬移模式下 BOSS 已在锁定名单仍转优先攻击');
  assert.ok(other.includes('else if (act === "优先攻击") { out.want = gidInt(rec.GID); }'));
  assert.ok(tail.includes('if (out.hp >= 0 && out.hp <= line) out.want = gidInt(rec.GID);'), '尾刀线内仍切去补尾刀');
  // 候选池剔除保持 2 处（zWalk + zAttack），非选中攻击者一路仍排除锁定目标本身
  assert.equal((expSource.match(/if \(zBossSkipGid && gidInt\(e\.GID\) === zBossSkipGid\) return;/g) || []).length, 2, '候选池剔除必须保持 zWalk/zAttack 各一处');
  assert.ok(expSource.includes('if (gidInt(hk) === gidInt(zLock.gid)) continue; // 排除锁定目标本身'), '非选中攻击者一路必须排除锁定目标本身');
});

// ================= V2.34.3：格子距离口径 / 内挂状态校准 / 混合接管兜底 / 坐下放宽 =================
test('exp v2.34.3 格子距离口径与内挂接管兜底：两文件同步、坐下 gate 已放宽', () => {
  // 1) 版本号：稳定版与实验版都必须是 2.34.5（@version 与运行时常量一致）
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal(/@version\s+(\S+)/.exec(src)?.[1], '2.34.5', name + ' @version 必须是 2.34.5');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.34.5', name + ' 运行时常量 VER 必须是 2.34.5');
  }
  // 2) 头部只差 3 行（@name / @updateURL / @downloadURL），其余逐字节相同
  const stripHead = (s) => s.split('\n').filter((_, i) => i !== 1 && i !== 4 && i !== 5).join('\n');
  assert.equal(stripHead(source), stripHead(expSource), '两文件除 3 行头部外必须完全一致');
  assert.ok(expSource.includes('// @name         仙境传说 · 原站插件模式（游戏助手 · 实验版）'));
  assert.ok(expSource.includes('main/ro-assist-exp.user.js'));
  assert.ok(!source.includes('main/ro-assist-exp.user.js'), '稳定版不得指向实验版地址');
  // 3) 格子距离口径：函数就位 + 选目标/攻击/追怪链上的位置距离已全部改口径
  const zrd = expExtract('  function zRangeDist(a, b) {', '  function npSyncTargets() {');
  const zctx = { Math }; vm.createContext(zctx); vm.runInContext(zrd + ';this.fn = zRangeDist', zctx);
  assert.equal(zctx.fn([0, 0], [3, 3]), 3, '斜角按格计（max 口径，不是曼哈顿 6）');
  assert.equal(zctx.fn([0, 0], [0, 5]), 5);
  assert.equal(zctx.fn([2, 7], [5, 3]), 4);
  assert.equal(zctx.fn(null, [1, 1]), 1e9, '取不到坐标要给极大值');
  const zWalkSeg = expExtract('  function zWalk() {', '  // 无锁定怪持续 N 秒');
  const zAtkSeg = expExtract('  function zAttack() {', '  // 技能行统一序列化');
  for (const [name, seg] of [['zWalk', zWalkSeg], ['zAttack', zAtkSeg]]) {
    assert.ok(seg.includes('zRangeDist('), name + ' 必须使用 zRangeDist');
    assert.doesNotMatch(seg, /var (?:d|cdist7|bd|ld|dNear|tD2|tD|distCd|distToT2|distToT) = Math\.abs\(/, name + ' 仍残留曼哈顿位置距离');
  }
  // 诊断快照：怪物数组前 5 项顺序不变，末尾追加曼哈顿距离 + 格子距离
  const snap = expExtract('  function zDiagSnapNow() {', '  function zDiagTick() {');
  assert.match(snap, /mobSnap\.push\([\s\S]*?String\(md\.name \|\| ""\), Math\.round\(md\.dist\), mdGrid\]\)/, 'mobSnap 末尾必须追加两列');
  assert.ok(snap.includes('sitWhy: zSitWhy') && snap.includes('atkWhy: zAtkWhy'), '快照必须含 sitWhy/atkWhy');
  // 4) 内挂状态校准 + 混合接管兜底：权威状态优先，一次调用最多一个 toggle（运行时验证）
  assert.ok(source.includes('hyTakeoverUntil'), '必须有混合接管兜底字段');
  assert.ok(source.includes('zWalkState.hyTakeoverUntil = hyNow + 12000'), '接管窗口必须是 12 秒');
  assert.ok(source.includes('内挂未接管（'), '必须提示「内挂未接管」');
  const ensSrc = expExtract('  function npEnsureHunt() {', '  function npHuntStop() {');
  const stopSrc = expExtract('  function npHuntStop() {', '  // 寻怪方式下拉 change');
  const runHunt = (src, fnName, real, startOn) => {
    const calls = [];
    const ctx = { npBattleState: () => real, npIsThree: () => false, clientReady: () => true, tlog: () => {},
      npToggleHunt: () => { calls.push('toggle'); return true; }, npSendUpdate: () => { calls.push('update'); return true; },
      DEFAULTS: { ClientVer: 5 }, npHuntOn: startOn, npBattleKnown: false };
    vm.createContext(ctx); vm.runInContext(src + ';this.fn = ' + fnName, ctx);
    ctx.fn();
    return { ctx, toggles: calls.filter((c) => c === 'toggle').length, sends: calls.length };
  };
  let r = runHunt(ensSrc, 'npEnsureHunt', true, false);
  assert.equal(r.sends, 0, '权威说已开 → npEnsureHunt 绝不再发包');
  assert.equal(r.ctx.npHuntOn, true); assert.equal(r.ctx.npBattleKnown, true);
  r = runHunt(ensSrc, 'npEnsureHunt', false, true);
  assert.equal(r.toggles, 1, '权威说已关 → 只发一次 toggle 打开');
  r = runHunt(ensSrc, 'npEnsureHunt', null, true);
  assert.equal(r.sends, 0, '状态未知且本地认为已开 → 保持原逻辑不发包');
  r = runHunt(stopSrc, 'npHuntStop', false, true);
  assert.equal(r.sends, 0, '权威说已关 → npHuntStop 绝不再发包');
  assert.equal(r.ctx.npHuntOn, false); assert.equal(r.ctx.npBattleKnown, true);
  r = runHunt(stopSrc, 'npHuntStop', true, false);
  assert.equal(r.toggles, 1, '权威说已开 → 只发一次 toggle 关闭');
  r = runHunt(stopSrc, 'npHuntStop', null, false);
  assert.equal(r.sends, 0, '状态未知且本地认为已关 → 保持原逻辑不发包');
  // 5) 坐下 gate 已放宽 + 诊断原因齐全
  const sitSeg = expExtract('  function doSitCycle(mobs) {', '  // V2.15.23：逃脱=直接移动避开怪');
  assert.doesNotMatch(sitSeg, /if \(zLock\.gid\) return;/, '不得保留无条件「有锁定目标就不坐下」');
  assert.ok(sitSeg.includes('var zlLock = zEntOf(zLock.gid);'), '必须用 zEntOf 实时取锁定怪实体');
  assert.ok(sitSeg.includes('zRangeDist(zlLock.position, zlEnt.position)'));
  assert.ok(sitSeg.includes('zlD >= 0 && zlD <= calcAtkRange()'));
  for (const why of ['开关关', '已坐下', '锁定怪在射程内', '刚被打', '附近有怪(战斗状态不坐下)', '等待拾取', '弹层打开', '起身冷却', '动作锁被占', '阈值未到', '已触发坐下']) {
    assert.ok(sitSeg.includes('"' + why + '"'), '坐下诊断缺少原因 ' + why);
  }
  for (const why of ['脱战挂起', '已坐下', '已停手(打死换下一个关)', '锁定怪在射程外', '无怪在射程', '走位追怪', '等技能冷却', '无目标寻怪', '已出手']) {
    assert.ok(zAtkSeg.includes('zAtkWhy = "' + why + '"'), '攻击诊断缺少原因 ' + why);
  }
});

// ================= V2.34.4：锁定名单语义（3A）+ 受击死角（3B） =================
// 权威语义：名单非空 → 只主动攻击名单内怪（「打全部怪」不再覆盖）；名单为空 → 按「打全部怪」；
//           还击 / 群殴瞬移 / 解围技能与名单完全解耦。
const INLOCK_RE = { zWalk: /var inLockN = ([^;]+);/, zAttack: /var inLock = ([^;]+);/ };
function inLockExpr(src, which) {
  const m = INLOCK_RE[which].exec(src);
  assert.ok(m, which + ' 未找到 inLock 表达式');
  return m[1].trim();
}
function inLockEval(expr, anyLock, allMobs, lockList, mid) {
  const ctx = { anyLock, zAllMobs: allMobs, zAllMobsW: allMobs, lockList, mid };
  vm.createContext(ctx);
  vm.runInContext('this.r = !!(' + expr + ')', ctx);
  return ctx.r;
}

test('exp V2.34.4 3A：zWalk/zAttack 的 inLock 表达式已切到「名单优先」且旧口径消失', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('var inLockN = anyLock ? !!(mid && lockList[mid]) : zAllMobsW; // V2.34.4：名单非空→只认名单；名单为空→按「打全部怪」'), name + ' zWalk 表达式必须是名单优先口径');
    assert.ok(src.includes('var inLock = anyLock ? !!(mid && lockList[mid]) : zAllMobs; // V2.34.4：名单非空→只认名单；名单为空→按「打全部怪」'), name + ' zAttack 表达式必须是名单优先口径');
    assert.ok(!src.includes('!anyLock || zAllMobsW || (mid && lockList[mid])'), name + ' 旧 zWalk 口径必须消失');
    assert.ok(!src.includes('!anyLock || zAllMobs || (mid && lockList[mid])'), name + ' 旧 zAttack 口径必须消失');
  }
  const walk = expExtract('  function zWalk() {', '  function zAttack() {');
  const atk = expExtract('  function zAttack() {', '  // 技能行统一序列化');
  assert.ok(walk.includes('var inLockN = anyLock ?'), 'zWalk 段内必须是名单优先口径');
  assert.ok(!walk.includes('var inLock ='), 'zAttack 的口径不得出现在 zWalk 段内');
  assert.ok(atk.includes('var inLock = anyLock ?'), 'zAttack 段内必须是名单优先口径');
  assert.ok(!atk.includes('var inLockN ='), 'zWalk 的口径不得出现在 zAttack 段内');
});

test('exp V2.34.4 3A：名单有/无 × 打全部怪开/关 真值表（vm 实跑两处表达式）', () => {
  const exprs = { zWalk: inLockExpr(expSource, 'zWalk'), zAttack: inLockExpr(expSource, 'zAttack') };
  const list = { 1002: { name: 'Poring' } };
  const midCases = [null, undefined, '', '1002', '9999'];
  for (const [name, expr] of Object.entries(exprs)) {
    assert.ok(expr.includes('anyLock ?'), name + ' 表达式必须是 anyLock 三元');
    for (const mid of midCases) {
      const tag = name + ' mid=' + String(mid) + ' ';
      assert.equal(inLockEval(expr, true, true, list, mid), mid === '1002', tag + '名单非空+全打开:只认名单');
      assert.equal(inLockEval(expr, true, false, list, mid), mid === '1002', tag + '名单非空+全打关:只认名单');
      assert.equal(inLockEval(expr, false, true, {}, mid), true, tag + '名单为空+全打开:全部主动攻击');
      assert.equal(inLockEval(expr, false, false, {}, mid), false, tag + '名单为空+全打关:一律不主动攻击');
    }
  }
});

test('exp V2.34.4 F5：非选中攻击者还击链路行为测试（vm 实跑 zAttack 分支）', () => {
  // 提取还击分支本体：A5 标记 → 「换怪延迟」之前（含 hitCandEnt 处理与 onaMode 三路分支）
  const seg = expExtract('      // V2.34.0 A5：非选中怪独立一路判定', '      // 换怪延迟：目标变化时记录延迟点');
  for (const need of ['target = hitCandEnt;', 'zLock.gid = hitCandEnt.GID;', 'zLock.reactive = true;',
    'if (onaMode === "瞬移" && !($id("dsh-z-flykill") && !$id("dsh-z-flykill").checked))']) {
    assert.ok(seg.includes(need), '还击分支提取不完整，缺少: ' + need);
  }
  const run = (lockGid, mode) => {
    const escapes = [];
    const lock = { gid: lockGid, reactive: false, name: '', dist: null };
    const ctx = {
      gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
      zHitPrune: () => {}, zHitKeepMs: 3000,
      zEntOf: (gid) => ({ GID: gid, display: { name: 'Mob' + gid }, _job: 1002, position: [1, 1] }),
      zHitBy: { 4242: { ts: 9000, dist: 3 } },
      zLock: lock, zMon: {}, onaMode: mode, now: 10000,
      requestEmergencyEscape: (reason) => escapes.push(reason),
      setStatus: () => {}, $id: () => null,
      target: null, hitCandDist: 0, parseInt, isFinite, String,
    };
    vm.createContext(ctx);
    vm.runInContext('this.fn = function () {\n' + seg + '\n};', ctx);
    ctx.fn();
    return { ctx, lock, escapes };
  };
  // 1) 还击 + 一个新近命中过我的攻击者 → 锁上它并追击
  const r1 = run(null, '还击');
  assert.ok(r1.ctx.target, '新近命中过我的攻击者必须成为 target（target = null 变异会被抓）');
  assert.equal(r1.ctx.target.GID, 4242, 'target 必须是该攻击者实体');
  assert.equal(r1.lock.gid, 4242, 'zLock.gid 必须锁到攻击者');
  assert.equal(r1.lock.reactive, true, '必须标记为还击锁定（zLock.reactive = true）');
  // 2) 攻击者 gid 等于 zLock.gid → 排除行仍生效，不还击
  const r2 = run(4242, '还击');
  assert.equal(r2.ctx.target, null, '锁定目标本身必须被排除（排除行仍然生效）');
  assert.equal(r2.lock.reactive, false);
  assert.equal(r2.escapes.length, 0);
  // 3) onaMode=瞬移 → requestEmergencyEscape("最近受击")，不接管目标
  const r3 = run(null, '瞬移');
  assert.deepEqual(r3.escapes, ['最近受击'], '瞬移必须调用紧急逃生，原因=最近受击');
  assert.equal(r3.ctx.target, null, '瞬移分支不得接管目标');
  assert.equal(r3.lock.gid, null);
});

test('exp V2.34.4 F2：zWalk 把还击锁定的攻击者纳入追击候选（结构断言）', () => {
  const walk = expExtract('  function zWalk() {', '  function zAttack() {');
  const anchor = 'var zReactiveGid = zLock.reactive ? gidInt(zLock.gid) : 0;';
  const adopt = 'if (!inLockN && zReactiveGid && gidInt(e.GID) === zReactiveGid) inLockN = true;';
  assert.ok(walk.includes(anchor), 'zWalk 必须有还击锚点 zReactiveGid');
  assert.ok(walk.includes(adopt), '还击锁定的攻击者必须被纳入 zWalk 追击候选');
  const gi = walk.indexOf(adopt), gate = walk.indexOf('if (!inLockN && !allowHitTarget) return;');
  assert.ok(gi >= 0 && gate >= 0 && gi < gate, '纳入行必须在 allowHitTarget 门之前（否则仍被 return 掉）');
  assert.ok(walk.indexOf(anchor) < gi, '锚点必须声明在 forEach 循环之前');
  // 原有还击兜底链路保持（含 allowHitTarget 门与 hitNear 收集/兜底分支）
  assert.ok(walk.includes('var allowHitTarget = beingHit && onaMode === "还击";'), '还击开关判定必须保留');
  assert.ok(walk.includes('if (!inLockN && !allowHitTarget) return;'), '非名单怪仍须走 allowHitTarget 门（还击路径保留）');
  assert.ok(walk.includes('if (!hitNear || hpNow < hitNearHp || (hpNow === hitNearHp && d < hitNearD)) { hitNear = e; hitNearD = d; hitNearHp = hpNow; }'), 'hitNear 还击候选收集必须保留');
  assert.ok(walk.includes('else if (hitNear) { near = hitNear; nearD = hitNearD; nearHp = hitNearHp; }'), 'hitNear 兜底分支必须保留');
});

test('exp V2.34.4：群殴与解围链路与锁定名单／「打全部怪」完全解耦', () => {
  const segs = {
    zGrpCount: expExtract('  function zGrpCount(mobs) {', '  // A3：实体取血量百分比'),
    zQoaNearCount: expExtract('  function zQoaNearCount(mobs) {', '  function zQoaTry(mobs, ent, now) {'),
    zQoaTry: expExtract('  function zQoaTry(mobs, ent, now) {', '  // A3：BOSS 三模式判定'),
    emergencyThreatReason: expExtract('  function emergencyThreatReason(mobs) {', '  function ordinaryCastBlocked() {'),
  };
  for (const [name, seg] of Object.entries(segs)) {
    assert.ok(seg.length > 40, name + ' 段提取失败');
    for (const bad of ['lockList', 'anyLock', 'inLock', 'dsh-z-allmobs']) {
      assert.ok(!seg.includes(bad), name + ' 不得引用 ' + bad);
    }
  }
  assert.ok(segs.emergencyThreatReason.includes('dsh-z-grpn'), '群殴自动瞬移仍须在 emergencyThreatReason 里');
});

test('exp V2.34.4：非选中怪分支必须排除锁定目标本身且与名单/打全部怪解耦', () => {
  // 反向不变量（3B 回退）：该分支语义为「非选中怪攻击」，锁定怪超射程由 zWalk 追怪 / 内挂靠近处理，
  //   因此必须排除 zLock.gid；同时该分支不看 zAllMobs、不看 lockList、不受 atkRange 限制。
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('if (gidInt(hk) === gidInt(zLock.gid)) continue; // 排除锁定目标本身'), name + ' 非选中怪分支必须排除锁定目标本身');
  }
  const seg = expExtract('      // V2.34.0 A5：非选中怪独立一路判定', '        var hitCandEnt = hitCandGid ? zEntOf(hitCandGid) : null;');
  assert.ok(seg.includes('if (!target) {'), '!target 分支必须保留');
  assert.ok(seg.includes('for (var hk in zHitBy) {'), 'zHitBy 扫描必须保留');
  assert.ok(seg.includes('var hg = gidInt(hk); if (!hg) continue;'), 'gid 归一化行必须仍在原位（排除点之后的判定顺序未变）');
  const codeOnly = seg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const bad of ['zAllMobs', 'lockList', 'atkRange']) {
    assert.ok(!codeOnly.includes(bad), '该分支代码不得引用 ' + bad + '（与名单/打全部怪解耦）');
  }
});

// ================= V2.34.4 守名单门：名单非空时 BOSS 优先攻击/补尾刀只认名单（两文件同步） =================
test('V2.34.4 守名单门：zBossAllowedByLock 单点定义且 zBossDecide/zAttack 各调用一次', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal((src.match(/function zBossAllowedByLock\(mid\)/g) || []).length, 1, name + ' helper 必须且只能定义一次');
    const helperAt = src.indexOf('function zBossAllowedByLock(mid)');
    const decideAt = src.indexOf('function zBossDecide(mobs) {');
    const attackAt = src.indexOf('function zAttack() {');
    assert.ok(helperAt >= 0 && helperAt < decideAt && decideAt < attackAt, name + ' helper 必须定义在两处调用之前');
    const decideSeg = src.slice(decideAt, src.indexOf('  // A6：早退点不冻结整拍', decideAt));
    const attackSeg = src.slice(attackAt, src.indexOf('  // 技能行统一序列化', attackAt));
    assert.equal((decideSeg.match(/zBossAllowedByLock\(/g) || []).length, 1, name + ' zBossDecide 必须恰好调用一次（防漏改）');
    assert.equal((attackSeg.match(/zBossAllowedByLock\(/g) || []).length, 1, name + ' zAttack 必须恰好调用一次（防漏改）');
    // zBossDecide 段内无 zLock.gid/sendLockInject：门必须早于产出 want/skip（本函数内「产出」点）
    const decideGate = decideSeg.indexOf('zBossAllowedByLock(');
    assert.ok(decideGate >= 0 && decideGate < decideSeg.indexOf('out.want') && decideGate < decideSeg.indexOf('out.skip'), name + ' zBossDecide 名单门必须在产出 want/skip 之前');
    // zAttack：门必须在写 zLock.gid / sendLockInject 之前
    const attackGate = attackSeg.indexOf('zBossAllowedByLock(');
    const gidAt = attackSeg.indexOf('zLock.gid = bgid;'), injectAt = attackSeg.indexOf('sendLockInject(bgid);');
    assert.ok(attackGate >= 0 && gidAt > attackGate && injectAt > attackGate, name + ' zAttack 名单门必须在写 zLock.gid / sendLockInject 之前');
    // BOSS mid 推导与 zAttack/zWalk 同口径（优先 rec.mid，其后 _job → job → mobId）
    assert.ok(decideSeg.includes('rec.mid != null ? rec.mid : (rec._job != null ? rec._job : (rec.job != null ? rec.job : rec.mobId))'), name + ' zBossDecide mid 推导口径');
    assert.ok(attackSeg.includes('bossRecD.mid != null ? bossRecD.mid : (bossRecD._job != null ? bossRecD._job : (bossRecD.job != null ? bossRecD.job : bossRecD.mobId))'), name + ' zAttack mid 推导口径');
  }
});

test('V2.34.4 守名单门：名单有/无 × mid 形态真值表（vm 实跑 zBossAllowedByLock）', () => {
  const a = source.indexOf('function zBossAllowedByLock(mid) {');
  const b = source.indexOf('\n', a);
  const code = source.slice(a, b);
  assert.ok(code.includes('lockList[String(mid)]'), 'helper 必须用 String(mid) 归一化 lockList 键');
  const run = (lockList, mid) => {
    const ctx = { lockList, Object, String };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.fn = zBossAllowedByLock', ctx);
    return ctx.fn(mid);
  };
  assert.equal(run({}, null), true, '名单为空 → 恒 true（mid=null）');
  assert.equal(run({}, 1234), true, '名单为空 → 恒 true（mid 有值）');
  assert.equal(run({ '1234': { name: 'x' } }, 1234), true, '名单非空且数字 mid 命中');
  assert.equal(run({ '1234': { name: 'x' } }, '1234'), true, '名单非空且字符串 mid 命中');
  assert.equal(run({ '1234': { name: 'x' } }, 9999), false, '名单非空且数字 mid 不在名单 → false');
  assert.equal(run({ '1234': { name: 'x' } }, '9999'), false, '名单非空且字符串 mid 不在名单 → false');
  assert.equal(run({ '1234': { name: 'x' } }, null), false, 'mid=null 且名单非空 → false');
  assert.equal(run({ '1234': { name: 'x' } }, undefined), false, 'mid=undefined 且名单非空 → false');
});

test('V2.34.4 守名单门：打全部怪与 BOSS 模式文案已更新（防回退）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('打全部怪（仅在未设锁定名单时生效）'), name + ' 标签必须写明仅在未设名单时生效');
    assert.ok(src.includes('id="dsh-z-allmobs" type="checkbox" checked'), name + ' id 与默认勾选不得改变');
    assert.ok(src.includes('内挂/混合模式下内挂自身仍会攻击全部'), name + ' 说明必须点明内挂自身仍会打全部怪');
    assert.ok(src.includes('BOSS 优先攻击/补尾刀同样只认名单'), name + ' 说明必须点明 BOSS 两模式也守名单');
    assert.ok(src.includes('取消=助手不主动选目标'), name + ' 说明必须写明取消=助手不主动选目标');
    assert.ok(src.includes('名单非空时，BOSS 优先攻击/补尾刀只对名单内 BOSS 生效'), name + ' BOSS 模式说明行必须补名单口径');
  }
});

// ================= V2.34.5：角色档案回落默认根因（落盘门 / 合并写入 / 名单归属 / 漏登记控件 / 诊断字段）=================
function captureAllCode() { return extract('  function captureAll() {', '  // V2.16.7：配置控件统一 change 即时保存'); }
function makeCaptureCtx(controls, els, savedUi, applied) {
  const savedState = { ui: savedUi };
  const ctx = { PROF_CONTROLS: controls, $id: (id) => els[id] || null, saved: savedState, saveSaved: () => {}, profUIApplied: applied };
  vm.createContext(ctx);
  vm.runInContext(captureAllCode() + ';this.fn = captureAll', ctx);
  return { ctx, savedState };
}

test('V2.34.5 落盘门：profUIApplied=false 时 captureAll 不动 saved.ui，置 true 后才写入控件值', () => {
  const { ctx, savedState } = makeCaptureCtx([['A', 'v']], { A: { value: '9' } }, { A: '1', KEEP: 'x' }, false);
  const before = JSON.stringify(savedState.ui);
  ctx.fn();
  assert.equal(JSON.stringify(savedState.ui), before, 'profUIApplied=false 时必须整体早退，saved.ui 不得被默认值覆盖');
  ctx.profUIApplied = true;
  ctx.fn();
  assert.equal(savedState.ui.A, '9', '置 true 后控件值必须落盘');
  assert.equal(savedState.ui.KEEP, 'x', '既有未覆盖键不得因落盘被删');
});

test('V2.34.5 合并写入：界面本次只读到 A 时，saved.ui 里的 B 仍必须保留', () => {
  const { ctx, savedState } = makeCaptureCtx([['A', 'v'], ['C', 'c'], ['MISS', 'v']], { A: { value: '9' }, C: { checked: true } }, { A: '1', B: '2', MISS: 'keep' }, true);
  ctx.fn();
  assert.equal(savedState.ui.A, '9', 'A 必须被本次界面值覆盖');
  assert.equal(savedState.ui.B, '2', 'B 不得因整体替换被删（合并写入）');
  assert.equal(savedState.ui.C, 1, 'checkbox 口径仍是 checked?1:0');
  assert.equal(savedState.ui.MISS, 'keep', '取不到的元素必须 continue，不得覆盖旧值');
  assert.deepEqual(Object.keys(savedState.ui).sort(), ['A', 'B', 'C', 'MISS'], 'ui 键集合 = 旧键 ∪ 本次读到的新键');
});

test('V2.34.5 PROF_CONTROLS 补齐漏登记控件：dsh-z-allmobs 类型 c 且全表无重复', () => {
  const code = expExtract('  var PROF_CONTROLS = [', '  ];') + '  ];';
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(code + ';this.list = PROF_CONTROLS;', ctx);
  const ids = ctx.list.map((r) => r[0]);
  const types = {}; for (const r of ctx.list) types[r[0]] = r[1];
  const added = ['dsh-z-allmobs', 'dsh-z-astar', 'dsh-z-attmixmargin', 'dsh-np-huntmode', 'dsh-boss-range', 'dsh-boss-toast', 'dsh-alert', 'dsh-reconn', 'dsh-party-self'];
  assert.equal(types['dsh-z-allmobs'], 'c', 'dsh-z-allmobs 必须登记进 PROF_CONTROLS 且类型为 c');
  for (const id of added) assert.ok(ids.includes(id), 'PROF_CONTROLS 缺新增控件 ' + id);
  assert.equal(ids.length, new Set(ids).size, 'PROF_CONTROLS 不得有重复 id');
  for (const id of added) assert.ok(source.includes('id="' + id + '"'), '面板 HTML 找不到控件 id=' + id);
  assert.equal(types['dsh-z-astar'], 'c'); assert.equal(types['dsh-z-attmixmargin'], 'v');
  assert.equal(types['dsh-np-huntmode'], 'v'); assert.equal(types['dsh-boss-range'], 'v');
  assert.equal(types['dsh-boss-toast'], 'c'); assert.equal(types['dsh-alert'], 'c');
  assert.equal(types['dsh-reconn'], 'c'); assert.equal(types['dsh-party-self'], 'c');
});

test('V2.34.5 名单归属校验：profMemKey 与当前档不一致时不得反写 profiles[key].lockList/askList', () => {
  const code = extract('  function saveSaved(o) {', '  var version = (location.href.match');
  const mk = (profMemKey) => {
    const store = {};
    const profiles = { 'hero_1': { name: 'h', gid: 1, saved: {}, lockList: { '1': { name: '旧锁' } }, askList: [{ skid: 1 }], lastAt: 0 } };
    const ctx = {
      LOGIN_KEYS: ['account', 'password', 'server', 'autoBoot'],
      LS_KEY: 'dsh_ro_plugin_v1',
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      profiles, lockList: { '9': { name: '新锁' } }, askList: [{ skid: 99 }], profMemKey,
      activeProfileKey: () => 'hero_1',
      ensureProfile: (k) => { if (!profiles[k]) profiles[k] = { name: k, gid: 0, saved: {}, lockList: {}, askList: [], lastAt: 0 }; return profiles[k]; },
      saveProfiles: () => {}, saved: null, console: { log: () => {} }
    };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.save = saveSaved', ctx);
    return { ctx, profiles };
  };
  const bad = mk('other_2');
  bad.ctx.save({ someKey: 1 });
  assert.deepEqual(bad.profiles['hero_1'].lockList, { '1': { name: '旧锁' } }, '归属不符时 lockList 必须保持原值不动');
  assert.deepEqual(bad.profiles['hero_1'].askList, [{ skid: 1 }], '归属不符时 askList 必须保持原值不动');
  assert.equal(bad.profiles['hero_1'].saved.someKey, 1, '普通设置键仍必须正常写回');
  const good = mk('hero_1');
  good.ctx.save({ someKey: 1 });
  assert.deepEqual(good.profiles['hero_1'].lockList, { '9': { name: '新锁' } }, '归属一致时 lockList 必须写回');
  assert.deepEqual(good.profiles['hero_1'].askList, [{ skid: 99 }], '归属一致时 askList 必须写回');
});

test('V2.34.5 三处结构断言：captureAll 早退 / applyProfileUI 末尾置位 / setActiveProfile 复位必须同时存在', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('var profUIApplied = false; // V2.34.5'), name + ' 缺 profUIApplied 声明');
    const capStart = src.indexOf('  function captureAll() {');
    assert.ok(capStart >= 0, name + ' 找不到 captureAll');
    const capSeg = src.slice(capStart, src.indexOf('\n  }', src.indexOf('saveSaved(saved);', capStart)));
    const capGate = capSeg.indexOf('if (!profUIApplied) return; // V2.34.5');
    assert.ok(capGate >= 0, name + ' captureAll 必须含 profUIApplied 早退');
    assert.ok(capGate < capSeg.indexOf('var ui = {};'), name + ' 早退必须是 captureAll 首句（任何读值之前）');
    assert.ok(capGate < capSeg.indexOf('saveSaved(saved)'), name + ' 早退必须在落盘之前');
    const apStart = src.indexOf('  function applyProfileUI() {');
    const apTrue = src.indexOf('profUIApplied = true;', apStart);
    assert.ok(apTrue > apStart, name + ' applyProfileUI 必须置 profUIApplied = true');
    const apSeg = src.slice(apStart, src.indexOf('\n  }', apTrue));
    assert.ok(apSeg.indexOf('var ui = saved.ui || {};') < apSeg.indexOf('profUIApplied = true;'), name + ' 置位必须在所有控件填充之后（函数体末尾）');
    const spStart = src.indexOf('function setActiveProfile(k)');
    const spSeg = src.slice(spStart, src.indexOf('\n', spStart));
    assert.ok(spSeg.includes('profUIApplied = false;'), name + ' setActiveProfile 必须复位 profUIApplied');
    assert.ok(src.includes('try { profUIApplied = true; captureAll(); } catch (e) {}'), name + ' 「保存当前角色设置」必须显式先置位再落盘（人工兜底）');
  }
});

test('V2.34.5 战斗诊断快照 prof 字段已就位（不改既有字段）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const at = src.indexOf('ready: profUIApplied');
    assert.ok(at > 0, name + ' zDiagSnapNow 必须带 prof.ready');
    assert.ok(src.includes('k: activeCharKey, n: Object.keys(profiles).length, ready: profUIApplied, lock: Object.keys(lockList || {}).length, ask: (askList || []).length'), name + ' prof 字段口径必须完整');
    const snap = src.slice(src.indexOf('  function zDiagSnapNow() {'), at);
    for (const keep of ['atkWhy: zAtkWhy', 'zAllMobs: !$id("dsh-z-allmobs")', 'sitWhy: zSitWhy']) assert.ok(snap.includes(keep), name + ' 既有诊断字段被改动: ' + keep);
  }
});


// ================= V2.34.5：配置自动备份（两代）/ 黄金副本找回（纯函数真值表 / 按钮 / 键隔离）=================
test('V2.34.5 版本号升到 2.34.5（@version 与运行时常量一致，两文件同步）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal(/@version\s+(\S+)/.exec(src)?.[1], '2.34.5', name + ' @version 必须是 2.34.5');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.34.5', name + ' 运行时常量 VER 必须是 2.34.5');
  }
});

test('V2.34.5 goldenFillIn 真值表：缺档补齐 / 缺 ui 键补齐 / 本地已有值胜出 / 缺名单条目补齐 / 无差异返回 false', () => {
  const code = extract('  function goldenFillIn(', '  // 启动自动找回');
  const ctx = { JSON, Object, Array, String };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.fn = goldenFillIn', ctx);
  const golden = {
    hero_1: { name: 'hero', gid: 1, lastAt: 111, saved: { ui: { A: '9', B: '2' }, other: 'keep' }, lockList: { '1002': { name: 'Poring' } }, askList: [{ skid: 10, lv: 5 }, { skid: 20 }] },
    hero_9: { name: 'nine', gid: 9, lastAt: 999, saved: { ui: { Z: '1' } }, lockList: { '5': { name: 'x' } }, askList: [{ skid: 1 }] }
  };
  const snap = JSON.stringify(golden);
  // 1) 本地缺档 → 整档补齐（深拷贝，不共享引用）
  const local1 = { hero_1: { name: 'mine', gid: 1, lastAt: 5, saved: { ui: { A: '1' }, mine: 'x' }, lockList: { '1002': { name: '本地锁定' } }, askList: [{ skid: 10, lv: 99 }] } };
  assert.equal(ctx.fn(local1, golden), true, '有补齐必须返回 true');
  assert.deepEqual(JSON.parse(JSON.stringify(local1.hero_9)), JSON.parse(JSON.stringify(golden.hero_9)), '本地缺失的档必须整档补齐');
  assert.notEqual(local1.hero_9, golden.hero_9, '补齐的档必须是深拷贝，不得与副本共享引用');
  // 2) 已有档：本地已有的值一律胜出，副本只补缺失键
  assert.equal(local1.hero_1.saved.ui.A, '1', '本地已有的 ui 键绝不能被副本覆盖（本地胜出：本地 1 vs 副本 9）');
  assert.equal(local1.hero_1.saved.ui.B, '2', '本地缺失的 ui 键必须补齐');
  assert.equal(local1.hero_1.saved.mine, 'x', '本地 saved 下其它键不得被碰');
  assert.equal(local1.hero_1.name, 'mine', '本地 name 不得被覆盖');
  assert.equal(local1.hero_1.gid, 1, '本地 gid 不得被覆盖');
  assert.equal(local1.hero_1.lastAt, 5, '本地 lastAt 不得被覆盖');
  assert.deepEqual(local1.hero_1.lockList['1002'], { name: '本地锁定' }, '同名 lockList 条目本地胜出');
  assert.deepEqual(local1.hero_1.askList, [{ skid: 10, lv: 99 }, { skid: 20 }], '同 skid 的条目不得重复追加（本地 lv:99 胜出），缺失的 skid:20 必须补齐');
  assert.equal(JSON.stringify(golden), snap, '纯函数不得修改副本对象');
  // 3) 已有档缺 lockList / askList 条目 → 补齐
  const local2 = { hero_1: { name: 'h', gid: 1, lastAt: 0, saved: { ui: { A: '1', B: '2' } }, lockList: {}, askList: [] } };
  assert.equal(ctx.fn(local2, golden), true);
  assert.deepEqual(local2.hero_1.lockList, { '1002': { name: 'Poring' } }, '缺失的 lockList 条目必须补齐');
  assert.deepEqual(local2.hero_1.askList, [{ skid: 10, lv: 5 }, { skid: 20 }], '缺失的 askList 条目必须补齐');
  assert.deepEqual(local2.hero_1.saved.ui, { A: '1', B: '2' }, '已有 ui 键不得被改动');
  // 4) 无差异 → false 且对象逐字节不变
  const local3 = JSON.parse(JSON.stringify(golden));
  const before3 = JSON.stringify(local3);
  assert.equal(ctx.fn(local3, golden), false, '无差异必须返回 false');
  assert.equal(JSON.stringify(local3), before3, '无差异时对象不得被改动');
  // 5) 空/非法输入不抛错
  assert.equal(ctx.fn(null, golden), false);
  assert.equal(ctx.fn({}, null), false);
  assert.equal(ctx.fn({}, {}), false);
});

test('V2.34.5 恢复副本键 dsh_ro_profiles_v2.golden 不进 KV_KEYS（否则 5 秒轮询自动互覆）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const at = src.indexOf('  var KV_KEYS = [');
    assert.ok(at > 0, name + ' 找不到 KV_KEYS');
    const kvSrc = src.slice(at, src.indexOf('];', at));
    assert.ok(!kvSrc.includes('golden'), name + ' KV_KEYS 行内不得出现 golden');
    const ctx = {}; vm.createContext(ctx); vm.runInContext(kvSrc + '];this.keys = KV_KEYS', ctx);
    assert.ok(ctx.keys.includes('dsh_ro_profiles_v2'), name + ' KV_KEYS 必须仍含 dsh_ro_profiles_v2');
    assert.ok(!ctx.keys.includes('dsh_ro_profiles_v2.golden'), name + ' KV_KEYS 不得包含 dsh_ro_profiles_v2.golden');
    assert.ok(src.includes('var PROF_GOLDEN_KEY = PROF_KEY + ".golden";'), name + ' 恢复副本键必须独立定义');
    assert.ok(src.includes('if (typeof fetch !== "function") return;'), name + ' 自动找回必须有 fetch 可用性守卫（8899 未启动静默）');
    assert.ok(src.includes('setTimeout(function () { try { goldenAutoRecover(); } catch (e) {} }, 6000);'), name + ' 启动自动找回必须只跑一次（6000ms）');
  }
});

test('V2.34.5 两个恢复副本按钮与导出/导入同处一行且监听器就位', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const at = src.indexOf('<button id="dsh-cfg-exp"');
    assert.ok(at > 0, name + ' 找不到导出配置按钮');
    const row = src.slice(src.lastIndexOf('<div class="row"', at), src.indexOf('</div>', at));
    for (const id of ['dsh-cfg-exp', 'dsh-cfg-imp', 'dsh-cfg-golden-save', 'dsh-cfg-golden-restore']) {
      assert.ok(row.includes('id="' + id + '"'), name + ' 按钮 ' + id + ' 必须在导出/导入同一 row 字符串内');
    }
    assert.ok(row.includes('<button id="dsh-cfg-golden-save"'), name + ' 「保存为恢复副本」沿用非 ghost 样式（与导出配置一致）');
    assert.ok(row.includes('<button class="ghost" id="dsh-cfg-golden-restore"'), name + ' 「恢复上次配置」必须 class=ghost');
    assert.ok(src.includes('$id("dsh-cfg-golden-save").addEventListener("click"'), name + ' 缺保存按钮监听');
    assert.ok(src.includes('$id("dsh-cfg-golden-restore").addEventListener("click"'), name + ' 缺恢复按钮监听');
    assert.ok(src.includes('"已保存恢复副本"'), name + ' 缺保存成功提示');
    assert.ok(src.includes('setStatus("已从恢复副本补齐缺失配置", "ok")'), name + ' 缺自动补齐提示');
    assert.ok(src.includes('setStatus("恢复副本里没有该角色的档", "err")'), name + ' 缺「副本里没有该角色的档」提示');
  }
});

test('V2.34.5 备份轮转：首轮写 .bak/.bak2、同一次加载第二次不再轮转、值与 .bak 相同不轮转', () => {
  const code = extract('  function profBackupRotate(', '  function ensureProfile(');
  const run = (init) => {
    const store = new Map(Object.entries(init));
    const ctx = {
      PROF_KEY: 'dsh_ro_profiles_v2', PROF_BAK_KEY: 'dsh_ro_profiles_v2.bak', PROF_BAK2_KEY: 'dsh_ro_profiles_v2.bak2',
      PROF_BAK_AT: 'dsh_ro_prof_bak_at', profBackupDone: false, Date,
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } }
    };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.fn = profBackupRotate', ctx);
    return { ctx, store };
  };
  const a = run({ dsh_ro_profiles_v2: 'v2', 'dsh_ro_profiles_v2.bak': 'v1' });
  assert.equal(a.ctx.fn(), true, '首轮必须轮转');
  assert.equal(a.store.get('dsh_ro_profiles_v2.bak'), 'v2', '当前值必须写入 .bak');
  assert.equal(a.store.get('dsh_ro_profiles_v2.bak2'), 'v1', '旧 .bak 必须轮转到 .bak2');
  assert.ok(a.store.get('dsh_ro_prof_bak_at'), '轮转时间戳必须写入独立键 dsh_ro_prof_bak_at（不入 KV_KEYS）');
  a.store.set('dsh_ro_profiles_v2', 'v3');
  assert.equal(a.ctx.fn(), false, '同一次页面加载第二次调用不得再轮转（profBackupDone 语义）');
  assert.equal(a.store.get('dsh_ro_profiles_v2.bak'), 'v2', '.bak 不得被第二次调用改写');
  assert.equal(a.store.get('dsh_ro_profiles_v2.bak2'), 'v1', '.bak2 不得被第二次调用改写');
  const b = run({ dsh_ro_profiles_v2: 'same', 'dsh_ro_profiles_v2.bak': 'same' });
  assert.equal(b.ctx.fn(), false, '当前值等于 .bak 现有值时不得重复轮转');
  assert.ok(!b.store.has('dsh_ro_profiles_v2.bak2'), '值相同时不得写 .bak2');
  const c = run({});
  assert.equal(c.ctx.fn(), false, '无当前值时必须安全返回 false');
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('function profBackupRotate('), name + ' 缺 profBackupRotate');
    const sp = src.slice(src.indexOf('  function saveProfiles() {'), src.indexOf('  function profBackupRotate('));
    assert.ok(sp.indexOf('profBackupRotate()') >= 0, name + ' saveProfiles 必须先调用 profBackupRotate()');
    assert.ok(sp.indexOf('profBackupRotate()') < sp.indexOf('localStorage.setItem(PROF_KEY'), name + ' 轮转必须早于真正写 localStorage');
  }
  assert.ok(source.includes('var profBackupDone = false; // V2.34.5'), '必须有内存标志 profBackupDone');
});
