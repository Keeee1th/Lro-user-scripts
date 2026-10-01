import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ro-assist.user.js',import.meta.url),'utf8');
test('death return clicks restart, retries while HP is zero, and auto-hangs only when the switch is on',()=>{
  for(const file of ['ro-assist.user.js','ro-assist-exp.user.js']){
    const src=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(src,/dsh-z-returncity/,'回城点即寄存点，不得再有回城地图设置项');
    assert.ok(src.includes('id="dsh-z-returnauto"'),'必须有「回到目标图自动开启助手挂机」开关');
    assert.ok(src.includes('["dsh-z-returnauto", "c"]'),'开关必须进角色档案存档表');
    assert.ok(src.includes('new CLIENT.PS.CZ.RESTART()'),'助手必须能自己点「重新开始」回寄存点');
    const start=src.indexOf('  // Session-only intent: no stale recovery');
    const end=src.indexOf('  // ================= 无限道场',start);
    assert.ok(start>0&&end>start);
    const controls={ 'dsh-z-deathreturn':{checked:true},'dsh-z-returnmap':{value:'pay_fild01'},'dsh-z-returnauto':{checked:true} };
    const ent={GID:42,display:{name:'测试角色'},life:{hp:70,hp_max:100},action:0,ACTION:{DIE:9,SIT:2}};
    let map='pay_fild01',clock=100000,mode=true,stops=0,starts=0,sits=[],teleports=[],packets=[];
    const saveButton={clicked:0,getClientRects:()=>[{}],click(){this.clicked++;}};
    let escapeHost=null;
    const context={Date:{now:()=>clock},Number,String,
      document:{getElementById:id=>id==='Escape'?escapeHost:null},
      CLIENT:{SS:{Entity:ent},PS:{CZ:{RESTART:function(){this.type=0;}}},NM:{sendPacket:p=>packets.push(p.type)}},
      activeProfileKey:()=> 'hero_42',lastCharGid:42,lastCharName:'测试角色',charNameOf:e=>e.display.name,profUIApplied:true,
      $id:id=>controls[id],normMapKey:m=>String(m||'').replace(/\.(gat|rsw)$/,'').toLowerCase(),getMapName:()=>map,
      gidInt:Number,clientReady:()=>true,apiLease:null,scrRun:{running:false},dojoRun:{on:false},bagClean:{busy:false},moveXY:{busy:false},escapePending:()=>false,
      zRunning:true,npBattleState:()=>mode,npRequestBattle:(want)=>{mode=want;return 'sent';},stopZhu(){stops++;context.zRunning=false;mode=false},startZhu(){starts++;context.zRunning=true},
      sendSit:x=>{sits.push(x);ent.action=x?2:0;},isSitting:()=>ent.action===2,isWinOpen:()=>false,gptTeleport:x=>{teleports.push(x);return true},setStatus(){},deathGuardRun:null,deathGuardDone:false,masterTickReg(fn){context.tick=fn}};
    vm.createContext(context);vm.runInContext(src.slice(start,end),context);
    context.tick();assert.equal(stops,0);assert.equal(teleports.length,0);
    map='prontera';context.tick();assert.equal(stops,0); // 不在目标图不布防
    map='pay_fild01';context.tick();                       // 目标图 + 战斗中 → 布防
    // 死亡菜单开着：先点客户端真实按钮（与手动点击同一条路径），不发裸包
    escapeHost={shadowRoot:{querySelector:()=>saveButton}};
    ent.life.hp=0;ent.isDeath=true;context.tick();assert.equal(stops,1); // 亲眼目睹死亡才停手
    assert.equal(saveButton.clicked,1);assert.deepEqual(packets,[]);
    clock+=4000;context.tick();assert.equal(saveButton.clicked,2);       // HP 仍为 0 → 重试
    clock+=4000;context.tick();clock+=4000;context.tick();assert.equal(saveButton.clicked,4); // 上限 4 次（首发 + 3 次重试）
    clock+=4000;context.tick();assert.equal(saveButton.clicked,4);       // 不再发，等你手点
    escapeHost=null;
    map='prontera';ent.isDeath=false;ent.life.hp=70;context.tick();assert.deepEqual(sits,[true]); // 回城坐下回血
    ent.life.hp=99;clock+=3000;context.tick();assert.deepEqual(sits,[true]);assert.equal(teleports.length,0);
    ent.life.hp=100;clock+=3000;context.tick();assert.deepEqual(sits,[true,false]); // 满血站起
    context.tick();assert.deepEqual(teleports,['pay_fild01']); // 满血后才提交传送
    map='pay_fild01';context.tick();assert.equal(starts,0);      // 换图结算期内不恢复，避免刚开打就被换图逻辑停掉
    clock+=2500;context.tick();assert.equal(starts,1);
    // 死亡菜单取不到按钮（客户端换了实现）→ 直接发同一个 CZ.RESTART type=0 包
    context.zRunning=false;mode=false;context.tick();context.zRunning=true;mode=true;context.tick();
    ent.life.hp=0;ent.isDeath=true;context.tick();assert.deepEqual(packets,[0]);
    ent.isDeath=false;ent.life.hp=55;context.tick(); // 未满血不开打
    ent.life.hp=100;context.tick();context.tick();
    assert.equal(teleports.length,1); // 寄存点就在目标图 → 不传送
    assert.equal(saveButton.clicked,4); // 复活（HP>0）后绝不再补发「重新开始」
    // 内挂模式死亡 + 开关开着 → 回图后无条件开助手挂机，不恢复内挂
    let stopsBefore=stops,startsBefore=starts;
    context.zRunning=false;mode=true;context.tick(); // 内挂运行中 → 布防（builtin）
    ent.life.hp=0;ent.isDeath=true;context.tick();assert.equal(mode,false);assert.equal(stops,stopsBefore); // 内挂由 npRequestBattle 关，不走 stopZhu
    ent.isDeath=false;ent.life.hp=100;context.tick();
    assert.equal(starts,startsBefore+1);assert.equal(context.zRunning,true); // 助手挂机被自动拉起
    // 开关关掉 → 回图按死亡前的方式恢复（内挂开回来）
    stopsBefore=stops;startsBefore=starts;
    controls['dsh-z-returnauto'].checked=false;
    context.zRunning=false;mode=true;context.tick();
    ent.life.hp=0;ent.isDeath=true;context.tick();assert.equal(mode,false);assert.equal(stops,stopsBefore);
    ent.isDeath=false;ent.life.hp=100;context.tick();
    assert.equal(mode,true);assert.equal(starts,startsBefore); // 开关关 → 内挂照旧开回来
    controls['dsh-z-returnauto'].checked=true;
    // 冲突租约：取消而不是动作；取消后不得自动恢复
    context.zRunning=false;mode=false;context.tick();context.zRunning=true;mode=true;context.tick();
    stopsBefore=stops;startsBefore=starts;
    ent.life.hp=0;ent.isDeath=true;context.apiLease={owner:'other'};context.tick();assert.equal(stops,stopsBefore);
    context.apiLease=null;ent.isDeath=false;ent.life.hp=70;context.tick();assert.equal(starts,startsBefore);assert.equal(teleports.length,1);
    // 未填目标地图：一律不动作
    controls['dsh-z-returnmap'].value='';map='pay_fild01';context.tick();ent.isDeath=true;ent.life.hp=0;context.tick();assert.equal(stops,stopsBefore);
  }
});

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

test('battle state prefers local prediction over stale panel and chat',()=>{
  const code=extract('  function npBattleState() {','  function npSyncBattleCheckbox');
  const ctx={npHuntOn:true,npBattleKnown:true};vm.createContext(ctx);vm.runInContext(code+';this.fn=npBattleState',ctx);
  assert.equal(ctx.fn(),true);ctx.npBattleKnown=false;assert.equal(ctx.fn(),null);ctx.npBattleKnown=true;ctx.npHuntOn=false;assert.equal(ctx.fn(),false);
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
  const castCode=extract('  function castOrderSkill(order, target) {','  onId("dsh-z-on",');
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
  assert.deepEqual(Array.from(ctx.bySec['常用']), ['menu', 'tp', 'np', 'zhu', 'scr']);
  assert.deepEqual(Array.from(ctx.bySec['战斗功能']), ['arrowrules', 'mlock', 'zhu2', 'zskill']);
  assert.deepEqual(Array.from(ctx.bySec['战斗辅助']), ['aid', 'party', 'dps', 'boss', 'askcombo', 'item']);
  assert.deepEqual(Array.from(ctx.bySec['提示']), ['zhud', 'ztip', 'tgt', 'znear']);
  assert.deepEqual(Array.from(ctx.bySec['其他']), ['perf', 'txcap', 'mvp', 'panel']);
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
  assert.ok(expSource.includes('{ id: "scr",   name: "脚本执行"'), 'RO_MODULES 缺 scr');
  assert.ok(expSource.includes('fwReg("scr", "脚本执行", scrEnsureHost)'), '缺少 fwReg("scr")');
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

test('exp 攻击名单与物品窗口拆分：mlock 独立、掉落树已随白名单回 item 页、白名单/背包归 item', () => {
  const html = expHtmlByAttr('data-subpage="ap-item"', '// 子页9');
  const anc = expAncestors(html);
  assert.ok(html.includes('id="dsh-fw-item"') && html.includes('id="dsh-fw-mlock"'));
  assert.ok(!(anc['dsh-fw-mlock'] || '').includes('dsh-fw-item'), '#dsh-fw-mlock 不得嵌套在 #dsh-fw-item 内');
  assert.ok((anc['dsh-drop-tree'] || '').includes('dsh-fw-item'), 'V2.36.13：怪物掉落树随「拾取白名单」回到物品拾取页');
  assert.ok((anc['dsh-z-maplock'] || '').includes('dsh-fw-mlock'), '本图攻击名单应在 mlock');
  assert.ok((anc['dsh-locklist'] || '').includes('dsh-fw-mlock'), '攻击名单列表应在 mlock');
  assert.ok((anc['dsh-lockcount'] || '').includes('dsh-fw-mlock'));
  assert.ok((anc['dsh-mobsearch'] || '').includes('dsh-fw-item'), 'V2.36.13：怪物搜索（掉落树搜索）随掉落树回物品拾取页');
  assert.ok((anc['dsh-locksearch'] || '').includes('dsh-fw-mlock'), 'V2.36.13：攻击名单窗口的怪物搜索归 mlock');
  assert.ok((anc['dsh-lockhits'] || '').includes('dsh-fw-mlock'), 'V2.36.13：攻击名单搜索结果区归 mlock');
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
  assert.ok(expSource.includes('onId("dsh-wladdbtn", "click"'), '「＋加入」必须已绑定新的小ID输入行');
  assert.ok(expSource.includes('function getItemNameS(id)'), 'getItemNameS 仍被图鉴/仓库统计复用，必须保留');
});

test('exp 技能点选/顺序表等级输入与释放% 即时写回守卫', () => {
  assert.ok(expSource.includes('data-lvsel="'), '点选网格每行必须有等级输入');
  assert.ok(expSource.includes('skillLine({ skid: skid, lv: lv, cond: "", prob: 100 })'), '勾选加入顺序表必须用输入框里的等级');
  assert.ok(expSource.includes("if (++skillPickTicker % 3 === 0 && !skillEditFocused())"), '3 秒自动重绘必须有焦点守卫');
  const guard = expExtract('  function skillEditFocused() {', '  onId("dsh-skillorder", "input"');
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
  // 1) 版本号：稳定版与实验版都必须是 2.36.1（@version 与运行时常量一致）
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal(/@version\s+(\S+)/.exec(src)?.[1], '2.36.16', name + ' @version 必须是 2.36.16');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.36.16', name + ' 运行时常量 VER 必须是 2.36.16');
  }
  // 2) 头部只差 3 行（@name / @updateURL / @downloadURL），其余逐字节相同
  const stripHead = (s) => s.replace(/\r\n/g,'\n').split('\n').filter((_, i) => i !== 1 && i !== 4 && i !== 5).join('\n');
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
  // 4) 内挂接管兜底保留；状态切换统一委托新事务接口。
  assert.ok(source.includes('hyTakeoverUntil'), '必须有混合接管兜底字段');
  assert.ok(source.includes('zWalkState.hyTakeoverUntil = hyNow + 12000'), '接管窗口必须是 12 秒');
  assert.ok(source.includes('内挂未接管（'), '必须提示「内挂未接管」');
  const ensSrc = extract('  function npEnsureHunt() {', '  function npHuntStop(');
  const stopSrc = extract('  function npHuntStop(', '  // 寻怪方式下拉 change');
  const calls=[]; const ctx={npRequestBattle:(...x)=>{calls.push(x);return 'debouncing'},npIsThree:()=>false,npSendUpdate(){},tlog(){},DEFAULTS:{ClientVer:5}};
  vm.createContext(ctx); vm.runInContext(ensSrc+stopSrc+';this.ensure=npEnsureHunt;this.stop=npHuntStop',ctx);
  ctx.ensure();ctx.stop('test-stop',true);
  assert.equal(calls.length,2);assert.equal(calls[0][0],true);assert.equal(calls[0][2],false);
  assert.equal(calls[1][0],false);assert.equal(calls[1][1],'test-stop');assert.equal(calls[1][2],true);
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

// ================= V2.36.1：补全格子距离口径（侦查扫描 / 技能射程 / 上马判定） =================
test('v2.36.1 侦查扫描/技能射程/上马三处距离统一为格子口径（max），不再残留曼哈顿', () => {
  const scanSeg = extract('  function scanOnce() {', '  function hpDrop2sPct(');
  assert.ok(scanSeg.includes('Math.max(Math.abs(e.position[0] - ent.position[0]), Math.abs(e.position[1] - ent.position[1]))'), 'scanOnce 距离必须是格子口径');
  assert.doesNotMatch(scanSeg, /Math\.abs\(e\.position\[0\] - ent\.position\[0\]\) \+ Math\.abs\(e\.position\[1\] - ent\.position\[1\]\)/, 'scanOnce 仍残留曼哈顿距离');
  const castSeg = extract('  function castOrderSkill(order, target) {', '  function learnedActiveSkills() {');
  assert.ok(castSeg.includes('Math.max(Math.abs(target.position[0] - ent.position[0]), Math.abs(target.position[1] - ent.position[1]))'), 'castOrderSkill 距离必须是格子口径');
  assert.doesNotMatch(castSeg, /Math\.abs\(target\.position\[0\] - ent\.position\[0\]\) \+ Math\.abs\(target\.position\[1\] - ent\.position\[1\]\)/, 'castOrderSkill 仍残留曼哈顿距离');
  const mountSeg = extract('  function lockMobInAtkRange() {', '  function tickRein() {');
  assert.ok(mountSeg.includes('Math.max(Math.abs(e.position[0] - entR.position[0]), Math.abs(e.position[1] - entR.position[1]))'), 'lockMobInAtkRange 距离必须是格子口径');
  assert.doesNotMatch(mountSeg, /Math\.abs\(e\.position\[0\] - entR\.position\[0\]\) \+ Math\.abs\(e\.position\[1\] - entR\.position\[1\]\)/, 'lockMobInAtkRange 仍残留曼哈顿距离');
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
    assert.equal(/@version\s+(\S+)/.exec(src)?.[1], '2.36.16', name + ' @version 必须是 2.36.16');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.36.16', name + ' 运行时常量 VER 必须是 2.36.16');
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
    assert.ok(src.includes('onId("dsh-cfg-golden-save", "click"'), name + ' 缺保存按钮监听');
    assert.ok(src.includes('onId("dsh-cfg-golden-restore", "click"'), name + ' 缺恢复按钮监听');
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

function battleVm(){let now=0,id=1;const timers=new Map(),packets=[];const code=extract('  function npBattleState() {','  onId("dsh-battleon",');const ctx={Math,Date:{now:()=>now},npBattleKnown:false,npHuntOn:false,npBattleLastSentAt:-Infinity,npBattleConfirmedAt:0,npBattleCandidate:null,npBattleExplicit:null,npBattleExplicitTimer:null,setTimeout(fn,ms){const n=id++;timers.set(n,{fn,at:now+ms});return n},clearTimeout(n){timers.delete(n)},npToggleHunt(){packets.push(ctx.want);return ctx.send!==false},npSyncBattleCheckbox(){},tlog(){}};vm.createContext(ctx);vm.runInContext(code+';this.req=npRequestBattle;this.reset=npResetBattleState',ctx);return{ctx,packets,req(w,s,i){ctx.want=w;return ctx.req(w,s,i)},tick(ms){now+=ms;for(const[n,t]of[...timers])if(t.at<=now){timers.delete(n);t.fn()}},pending:()=>timers.size}}
test('V2.34.6 VM auto debounce stability oscillation and liveness',()=>{let h=battleVm();h.req(true,'auto',false);h.tick(800);h.req(true,'auto',false);for(let i=0;i<20;i++){h.tick(250);h.req(true,'auto',false)}assert.deepEqual(h.packets,[true]);h=battleVm();for(let i=0;i<40;i++){h.req(i%2===0,'auto',false);h.tick(250)}assert.equal(h.packets.length,0);h=battleVm();h.req(true,'auto',false);h.tick(800);h.req(true,'auto',false);h.req(false,'auto',false);h.tick(800);h.req(false,'auto',false);assert.deepEqual(h.packets,[true,false])});
test('V2.34.6 VM explicit latest wins finite queue failure and reset',()=>{let h=battleVm();h.req(true,'click',true);h.tick(100);h.req(false,'click',true);h.tick(100);assert.equal(h.req(true,'click',true),'already');h.tick(500);assert.deepEqual(h.packets,[true]);assert.equal(h.pending(),0);h=battleVm();h.ctx.send=false;assert.equal(h.req(true,'click',true),'failed');assert.equal(h.ctx.npBattleKnown,false);assert.equal(h.ctx.npBattleLastSentAt,-Infinity);h=battleVm();h.req(true,'click',true);h.tick(100);h.req(false,'click',true);h.ctx.reset();h.tick(1000);assert.deepEqual(h.packets,[true]);assert.equal(h.pending(),0)});
test('V2.34.6 structure guards shared entry points incremental receipt and local display',()=>{for(const src of[source,expSource]){const btn=src.slice(src.indexOf('onId("dsh-np-atk",'),src.indexOf('onId("dsh-np-pick",'));assert.ok(btn.includes('setBattle(true)'));assert.doesNotMatch(btn,/npCmd|npToggleHunt/);const hk=src.slice(src.indexOf('  function npToggleFight()'),src.indexOf('  // 助手自动战斗快捷键'));assert.ok(hk.includes('npRequestBattle(want, "hotkey", true)'));assert.equal((src.match(/npToggleHunt\(\)/g)||[]).length,3);const paint=src.slice(src.indexOf('  function qswPaint()'),src.indexOf('  try {',src.indexOf('  function qswPaint()')+10));assert.doesNotMatch(paint,/npReadPanelState|npHuntOn\s*=/);assert.ok(src.includes('npResetBattleState(); } catch (e0) {} // 换角色'));assert.ok(src.includes('npChatSeen.has(p)'));assert.ok(src.includes('var bsLocal = npBattleState(), bsPanel = npReadPanelState()'))}});

test('V2.34.6 explicit OFF after ON waits remainder then sends once',()=>{const h=battleVm();h.req(true,'on',true);h.tick(100);assert.equal(h.req(false,'off',true),'queued');h.tick(249);assert.deepEqual(h.packets,[true]);h.tick(1);assert.deepEqual(h.packets,[true,false]);assert.equal(h.pending(),0)});
test('V2.34.6 failed explicit timer clears without periodic retry',()=>{const h=battleVm();h.req(true,'on',true);h.tick(100);h.ctx.send=false;h.req(false,'off',true);h.tick(250);assert.equal(h.pending(),0);assert.equal(h.ctx.npBattleExplicit,null);h.tick(30000);assert.equal(h.packets.length,2)});
test('V2.34.6 automatic twenty rounds do not resend after prediction',()=>{const h=battleVm();h.req(true,'auto',false);h.tick(800);h.req(true,'auto',false);for(let i=0;i<20;i++){h.tick(800);h.req(true,'auto',false)}assert.equal(h.packets.length,1);assert.equal(h.ctx.npHuntOn,true)});
test('V2.34.6 state declarations precede observer installation',()=>{for(const src of[source,expSource])assert.ok(src.indexOf('var npHuntOn = false')<src.indexOf('npWatchBattleChat();'))});

// ================= V2.34.7：功能菜单独立数据抓包浮窗 =================
test('V2.34.7 数据抓包由功能菜单打开标准独立浮窗且不依赖旧面板页面 DOM', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('{ id: "txcap", name: "数据抓包",        kind: "fw", sec: "其他" }'), name + ' RO_MODULES 缺数据抓包');
    assert.ok(src.includes('fwReg("txcap", "数据抓包", txCapEnsureHost);'), name + ' 未走标准 fwReg');
    const host = src.slice(src.indexOf('  function txCapEnsureHost() {'), src.indexOf('  // 三个可浮窗区块注册'));
    for (const id of ['dsh-txcap', 'dsh-txstop', 'dsh-txexp', 'dsh-txdl', 'dsh-txlog', 'dsh-txout']) assert.ok(host.includes(id), name + ' 抓包浮窗缺 ' + id);
    assert.ok(host.includes('document.documentElement.appendChild(dock)'), name + ' 抓包宿主未独立挂载');
    const teleport = src.slice(src.indexOf('    teleport:'), src.indexOf('    system:'));
    assert.doesNotMatch(teleport, /dsh-tx(?:cap|stop|exp|dl|log|out)/, name + ' 抓包仍依赖 teleport 页 DOM');
    assert.ok(src.includes('if (!fwActualOpen(id)) fwOpen(id, false);'), name + ' 功能菜单未走标准 fwOpen 分支');
  }
});


// ================= bagClean v2：丢弃黑名单、类别与逐包复核 =================
function bagCleanVm(storeInit={},typeDb=null){
  const store=new Map(Object.entries(storeInit));
  const code=extract("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'",'  function bagCleanUnitWeight(id)');
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},requireDB:n=>n==='DB/Items/ItemType'?typeDb:null,require:()=>null,
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))},bagCleanSay(){}};
  vm.createContext(ctx);vm.runInContext(code+';this.load=bagCleanLoad;this.validate=bagCleanValidateImport;this.norm=bagCleanNormalize;this.describe=bagCleanDescribe;this.typeNames=bagCleanTypeNames;this.disarm=bagCleanDisarm',ctx);
  return {ctx,store};
}
function safeGear(extra={}){return Object.assign({ITID:1201,index:7,type:4,count:1,IsIdentified:1,RefiningLevel:0,slot:{card1:0,card2:0,card3:0,card4:0},nRandomOptionCnt:0,IsDamaged:0,IsEquipped:0},extra)}
function withoutGear(...keys){const item=safeGear();for(const key of keys)delete item[key];return item}

test('bagClean v2 migration copies simple v1 rules without deleting old key',()=>{
  const old=JSON.stringify({'501':4,'1201:u':0}),h=bagCleanVm({'dsh-bag-clean-rules-v1':old});const cfg=h.ctx.load();
  assert.equal(JSON.stringify(cfg.discardRules),JSON.stringify({'501':4,'1201:u':0}));assert.equal(cfg.armed,false);assert.deepEqual(Array.from(cfg.categoryTypes),[]);assert.equal(h.store.get('dsh-bag-clean-rules-v1'),old);assert.ok(h.store.has('dsh-bag-clean-v2'));
});

test('bagClean v2 migration accepts legacy wrapper discardRules and starts disabled',()=>{
  const h=bagCleanVm({'dsh-bag-clean-rules-v1':JSON.stringify({discardRules:{'502':9},enabled:true,armed:true})});const cfg=h.ctx.load();
  assert.equal(cfg.discardRules['502'],9);assert.equal(cfg.armed,false);assert.equal(h.ctx.bagClean.enabled,false);
});

test('bagClean v2 normalization validates rules categories protected IDs and forces legacy unarmed',()=>{
  const h=bagCleanVm(),cfg=h.ctx.norm({version:2,discardRules:{'501':2,bad:3},categoryTypes:[0,2,99,4,10],protectedIds:[501,501,-1],armed:true},false);
  assert.equal(JSON.stringify(cfg.discardRules),JSON.stringify({'501':2}));assert.deepEqual(Array.from(cfg.categoryTypes),[0,2,10]);assert.deepEqual(Array.from(cfg.protectedIds),[501]);assert.equal(cfg.armed,true);
  assert.equal(h.ctx.norm({'501':2},true).armed,false);
});

test('bagClean import limits reject rather than truncate and localStorage fails closed',()=>{
  const rules=n=>Object.fromEntries(Array.from({length:n},(_,i)=>[String(i+1),0])),v2=(r=rules(1),categoryTypes=[],protectedIds=[])=>({version:2,discardRules:r,categoryTypes,protectedIds,armed:true}),h=bagCleanVm();
  assert.doesNotThrow(()=>h.ctx.validate(v2(rules(2000)),false));assert.throws(()=>h.ctx.validate(v2(rules(2001)),false),/2000/);
  assert.doesNotThrow(()=>h.ctx.validate(v2(rules(1),Array(64).fill(0)),false));assert.throws(()=>h.ctx.validate(v2(rules(1),Array(65).fill(0)),false),/64/);
  assert.doesNotThrow(()=>h.ctx.validate(v2(rules(1),[],Array(2000).fill(1)),false));assert.throws(()=>h.ctx.validate(v2(rules(1),[],Array(2001).fill(1)),false),/2000/);
  assert.doesNotThrow(()=>h.ctx.validate(rules(2000),true));assert.throws(()=>h.ctx.validate(rules(2001),true),/2000/);
  const inherited=Object.create(rules(2001));inherited['501']=0;assert.doesNotThrow(()=>h.ctx.validate(inherited,true));assert.equal(h.ctx.norm(h.ctx.validate(inherited,true),true).discardRules['501'],0);
  for(const bad of[v2(rules(2001)),v2(rules(1),Array(65).fill(0)),v2(rules(1),[],Array(2001).fill(1))]){const x=bagCleanVm({'dsh-bag-clean-v2':JSON.stringify(bad)});let cfg;assert.doesNotThrow(()=>{cfg=x.ctx.load()});assert.equal(JSON.stringify(cfg.discardRules),'{}');assert.deepEqual(Array.from(cfg.categoryTypes),[]);assert.deepEqual(Array.from(cfg.protectedIds),[]);assert.equal(cfg.armed,false);}
});

test('bagClean UI validates imports before normalization and reports failure',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));const handler=ui.slice(ui.indexOf("box.querySelector('[data-import]')"));assert.ok(handler.indexOf('bagCleanValidateImport(raw,legacy)')>=0,name+' import must validate');assert.ok(handler.indexOf('bagCleanValidateImport(raw,legacy)')<handler.indexOf('bagCleanNormalize('),name+' validation must precede normalization');assert.ok(handler.includes("bagCleanSay('导入失败："),name+' import must show failure');}
});

test('bagClean type names reverse runtime ItemType mappings and retain safe generic names',()=>{
  const h=bagCleanVm({}, {Healing:0,Material:3}),names=h.ctx.typeNames();assert.equal(names[0],'Healing');assert.equal(names[3],'Material');assert.equal(names[2],'消耗');assert.equal(names[11],'技能消耗');
});

test('bagClean runtime-named unsafe and conflicting types are not batch selectable',()=>{
  const unsafe=bagCleanVm({}, {SEARCH:99}),unsafeNames=unsafe.ctx.typeNames();
  assert.equal(unsafeNames[99],'SEARCH');assert.equal(unsafe.ctx.describe({ITID:501,index:1,type:99,count:2},{discardRules:{},categoryTypes:[99],protectedIds:[]},unsafeNames).ok,false);
  const h=bagCleanVm({}, {Material:3,Etc:3}),names=h.ctx.typeNames();assert.equal(names[3],false);
  const cfg={discardRules:{},categoryTypes:[3],protectedIds:[]};assert.equal(h.ctx.describe({ITID:501,index:1,type:3,count:2},cfg,names).ok,false);
});

test('bagClean blacklist keeps configured quantity and category is union fallback',()=>{
  const h=bagCleanVm(),names=h.ctx.typeNames(),explicit={discardRules:{'501':3},categoryTypes:[],protectedIds:[]},category={discardRules:{},categoryTypes:[3],protectedIds:[]};
  const a=h.ctx.describe({ITID:501,index:1,type:3,count:8},explicit,names),b=h.ctx.describe({ITID:502,index:2,type:3,count:8},category,names);
  assert.equal(a.ok,true);assert.equal(a.keep,3);assert.equal(a.source,'黑名单');assert.equal(b.ok,true);assert.equal(b.keep,0);assert.match(b.source,/类别/);
});

test('bagClean protectedIds overrides explicit blacklist and category selection',()=>{
  const h=bagCleanVm(),d=h.ctx.describe({ITID:501,index:1,type:3,count:8},{discardRules:{'501':0},categoryTypes:[3],protectedIds:[501]},h.ctx.typeNames());
  assert.equal(d.ok,false);assert.match(d.reason,/永不丢/);
});

test('bagClean unknown type is protected even under explicit blacklist',()=>{
  const h=bagCleanVm(),d=h.ctx.describe({ITID:501,index:1,type:255,count:8},{discardRules:{'501':0},categoryTypes:[255],protectedIds:[]},h.ctx.typeNames());
  assert.equal(d.ok,false);assert.match(d.reason,/未知/);
});

test('bagClean unidentified equipment requires explicit :u rule and never category',()=>{
  const h=bagCleanVm(),names=Object.assign(h.ctx.typeNames(),{4:'武器'}),byCategory=h.ctx.describe(safeGear({IsIdentified:0}),{discardRules:{},categoryTypes:[4],protectedIds:[]},names),explicit=h.ctx.describe(safeGear({IsIdentified:0}),{discardRules:{'1201:u':0},categoryTypes:[],protectedIds:[]},names);
  assert.equal(byCategory.ok,false);assert.match(byCategory.reason,/:u/);assert.equal(explicit.ok,true);assert.equal(explicit.key,'1201:u');
});

test('bagClean equipment protection fields fail closed and complete zero gear remains eligible',()=>{
  const h=bagCleanVm(),names=Object.assign(h.ctx.typeNames(),{4:'武器',5:'防具',8:'影子装备',12:'服饰'}),cfg={discardRules:{'1201':0},categoryTypes:[],protectedIds:[]};
  for(const type of [4,5,8,12])assert.equal(h.ctx.describe(safeGear({type}),cfg,names).ok,true);
  const incomplete=[withoutGear('IsIdentified'),withoutGear('RefiningLevel','refiningLevel'),safeGear({slot:null}),safeGear({slot:{card2:0,card3:0,card4:0}}),safeGear({slot:{card1:0,card3:0,card4:0}}),safeGear({slot:{card1:0,card2:0,card4:0}}),safeGear({slot:{card1:0,card2:0,card3:0}}),withoutGear('nRandomOptionCnt'),withoutGear('IsDamaged'),withoutGear('IsEquipped','WearState','wearState','equipped')];
  for(const item of incomplete){const d=h.ctx.describe(item,cfg,names);assert.equal(d.ok,false);assert.equal(d.reason,'装备保护字段不完整')}
  const unsafe=[safeGear({RefiningLevel:1}),safeGear({refiningLevel:1}),...['card1','card2','card3','card4'].map(key=>safeGear({slot:Object.assign({card1:0,card2:0,card3:0,card4:0},{[key]:4001})})),safeGear({nRandomOptionCnt:1}),safeGear({IsDamaged:true}),...['IsEquipped','WearState','wearState','equipped'].map(key=>safeGear({[key]:1}))];
  for(const item of unsafe)assert.equal(h.ctx.describe(item,cfg,names).ok,false);
});

test('bagClean preview and ITEM_THROW paths contain fresh index identity type quantity and rule checks',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){const preview=src.slice(src.indexOf('  function bagCleanPreview()'),src.indexOf('  function bagCleanInit()'));const execute=src.slice(src.indexOf('  function bagCleanRevalidate('),src.indexOf('  function bagCleanPreview()'));
    assert.ok(preview.includes('bagCleanRevalidate(s,s.amount)'),name+' preview must reread each index');assert.ok(execute.includes('d.amount!==stack.amount'),name+' quantity must match when captured');assert.ok(execute.includes('d.id!==stack.id'));assert.ok(execute.includes('d.type!==stack.type'));assert.ok(execute.includes('d.source!==stack.source'));assert.ok(execute.indexOf('bagCleanRevalidate(stack,want)')<execute.indexOf('new CLIENT.PS.CZ.ITEM_THROW()'));
  }
});

test('bagClean rule changes disarm automation and initial automatic enable requires preview arming',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));
    assert.ok(ui.includes("function changed(msg){bagCleanDisarm("),name+' changes must disarm');assert.ok(ui.includes("if(!bagClean.config.armed){this.checked=false"),name+' enable must require armed');assert.ok(ui.includes('bagClean.config.armed=true'),name+' preview confirmation must arm');assert.ok(ui.includes('这是不可逆操作，确认执行？'),name+' manual cleanup needs detailed confirmation');
  }
});

test('bagClean v2 UI and storage contract is lockstep and documents unsupported boss-source filtering',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){assert.ok(src.includes("'dsh-bag-clean-v2'"));assert.ok(src.includes("'dsh-bag-clean-rules-v1'"));assert.ok(src.includes('丢弃黑名单（勾选=要丢'));assert.ok(src.includes('类别保护例外（永不丢）'));assert.ok(src.includes('协议不含掉落怪来源，无法安全区分BOSS掉落，故不提供该规则。'));assert.ok(src.includes('导出v2'));const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));assert.ok(ui.includes('Object.keys(BAG_SAFE_TYPES).map(Number)'),name+' UI must enumerate only safe types');assert.ok(ui.includes("ch.setAttribute('data-type',String(type))"),name+' UI category checkbox needs safe type marker');assert.ok(!ui.includes('presentTypes'),name+' UI must not derive category choices from runtime type 99');assert.ok(!ui.includes('data-type=99'),name+' UI must not generate data-type=99');}
  const a=source.slice(source.indexOf('  // ---------------- 背包安全清理 v2'),source.indexOf('  // ---------------- 拾取页：内挂百分比联动')).replace(/\r\n/g,'\n');
  const b=expSource.slice(expSource.indexOf('  // ---------------- 背包安全清理 v2'),expSource.indexOf('  // ---------------- 拾取页：内挂百分比联动')).replace(/\r\n/g,'\n');assert.equal(a,b);
});


// ================= V2.35.1 assistant API + standalone dojo =================
const splitSources=[['stable',source],['exp',expSource]];
test('V2.35.1 assistant removes challenge and keeps arrow rules plus API lockstep',()=>{for(const[name,s]of splitSources){assert.match(s,/@version\s+2\.36\.16/);assert.equal((s.match(/dsh-ro-challenge-v1/g)||[]).length,1,name+' keeps only one non-destructive arrow migration read');assert.ok(!/function challenge|challengeOwnsCombat|challengeStop/.test(s),name+' challenge automation removed');assert.ok(s.includes('dsh-ro-arrow-rules-v1'));assert.ok(s.includes('function arrowDecision('));assert.ok(s.includes('fwReg("arrowrules", "换箭设置", arrowEnsureHost)'));assert.ok(s.includes('window.__DSH_RO_ASSIST_API__'));assert.ok(s.includes('externalAutomationOwns("arrow") || arrowTarget'));assert.ok(s.includes('externalAutomationOwns("battle")'));}});
test('V2.35.1 public API uses owner-only external signatures and validates the current lease owner',()=>{for(const[,s]of splitSources){assert.ok(s.includes('/^[A-Za-z0-9_.:-]{8,128}$/'));assert.ok(s.includes('dojo:1,battle:1,movement:1,dialog:1,arrow:1,fly:1'));assert.ok(s.includes('if(apiLease&&apiLease.owner!==owner)'));for(const sig of ['apiHas(owner,scope)','apiSnapshot(owner)','apiRelease(owner)','apiContact(owner,gid)','apiWalk(owner,payload)','apiChoose(owner,payload)','apiBattle(owner,on)','apiSetArrow(owner,target)','apiClearArrow(owner)','apiFly(owner,payload)'])assert.ok(s.includes('function '+sig),sig);assert.ok(s.includes('apiLease.generation===generation'));assert.ok(!s.includes('apiHas(owner,generation'));}});
test('V2.35.1 snapshot and battle/menu ownership contracts are explicit',()=>{for(const[,s]of splitSources){for(const key of ['ready:','map:','player:','mobs:','npcs:','target:','inDojoMap:','dialogOpen:','menu:','battleState:','busy:','arrow:'])assert.ok(s.includes(key),key);assert.ok(s.includes('if(fp===apiMenuUsed)return {ok:false,error:"menu-already-used"}'));assert.ok(s.includes('b.state="pending-on"'));assert.ok(s.includes('if(b.state!=="owned")return {ok:true,result:"not-owned"}'));assert.ok(s.includes('l.battle.state==="owned"||l.battle.state==="pending-off"'));assert.ok(s.includes('if(s!==false)return {ok:true,result:s===true?"preexisting":"unknown"}'));}});
test('V2.36.11 arrow rules use a per-monster table plus a default arrow',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function arrowDecision(mid,cfg)'),name+' 决策改为按怪物 id');
  assert.ok(s.includes('add("elem",ev)')&&s.includes('add("mob",v&&v.itid!=null?v.itid:v)'),name+' 属性箭 > 指定怪箭');
  assert.ok(s.includes('add("default",cfg.defaultItid)'),name+' 回退默认箭');
  assert.ok(s.includes('defaultItid=arrowPos(r.defaultItid)||arrowPos(r.neutralItid)'),name+' 旧无属性箭迁移为默认箭');
  assert.ok(s.includes('legacy=r.byMid&&typeof r.byMid==="object"?r.byMid'),name+' 旧 Boss 箭表迁移');
  assert.ok(s.includes('id="dsh-arrow-rules-default"'),name+' 默认箭按钮');
  assert.ok(s.includes('id="dsh-arrow-rules-mobsave"'),name+' 指定怪箭保存按钮');
  assert.ok(s.includes('id="dsh-arrow-rules-cur"'),name+' 取当前目标按钮');
  assert.ok(s.includes('id="dsh-arrow-rules-mobitem"'),name+' 指定怪箭矢下拉');
  assert.ok(!s.includes('ghostItid')&&!s.includes('if(type===8&&level===3)')&&!s.includes('arrowFillBosses'),name+' 旧念3/念4与内挂 Boss 规则必须移除');
  assert.ok(s.includes('confirmUntil:now+5000')&&s.includes('p.retryAt=now+3000'),name+' 换箭确认重试保留');
}});
test('V2.36.12 arrow decision picks the override then the default and stays silent when nothing is configured',()=>{
  const code=extract('  function arrowPos(v)','  function arrowLoad(){')+extract('  function arrowBoss(mid)','  function arrowFill(s)');
  const ctx={};vm.createContext(ctx);vm.runInContext(code+';this.decide=arrowDecision',ctx);
  assert.equal(ctx.decide(1002,{byMid:{},defaultItid:null}),null,'没配置任何箭 → 不换箭');
  assert.equal(JSON.stringify(ctx.decide(1002,{byMid:{1002:1751},defaultItid:1750})),JSON.stringify({kind:'mob',itid:1751}),'指定怪优先');
  assert.equal(JSON.stringify(ctx.decide(1003,{byMid:{1002:1751},defaultItid:1750})),JSON.stringify({kind:'default',itid:1750}),'没配过的怪用默认箭');
  assert.equal(JSON.stringify(ctx.decide(1002,{byMid:{1002:{itid:1752}},defaultItid:null})),JSON.stringify({kind:'mob',itid:1752}),'旧 {itid} 结构兼容');
  assert.equal(ctx.decide(0,{byMid:{},defaultItid:null}),null,'非法 mid 不报错');
  assert.equal(JSON.stringify(ctx.decide(0,{byMid:{},defaultItid:1750})),JSON.stringify({kind:'default',itid:1750}),'mid 未知也能用默认箭');
});
test('V2.36.12 换箭跟随当前攻击目标：助手锁定 → 客户端锁定 → 最近打伤',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function arrowCurrentMid(){try{var gid=gidInt(zLock&&zLock.gid);if(!gid){var me=CLIENT.SS&&CLIENT.SS.Entity;gid=gidInt(me&&me.targetGID);}'),name+' 助手锁定优先，其次客户端锁定');
  assert.ok(s.includes('dps.cur&&Number(dps.cur.lastAt)')&&s.includes('dps.cur.gid'),name+' 最近打伤的怪兜底');
  assert.ok(s.includes('function arrowSelfTick(now)'),name+' 必须有按目标换箭实现');
  assert.ok(s.includes('if(!arrowRules.enabled||arrowTarget||externalAutomationOwns("arrow")||!clientReady())return;'),name+' 道场租约优先让位');
  assert.ok(s.includes('arrowSelfWanted()) return;'),name+' 通用耗尽换箭必须让位给按怪换箭');
  assert.ok(s.includes('try{arrowTargetTick(t);}catch(e){}try{arrowSelfTick(t);}catch(e){}'),name+' 必须挂到 250ms 周期');
}});
test('V2.36.12 缺箭兜底 + 箭矢筒按当前箭矢匹配',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function arrowCandidates(mid,cfg)'),name+' 候选箭列表');
  assert.ok(s.includes('function add(kind,itid){itid=arrowPos(itid);if(!itid||seen[itid])return'),name+' 默认箭兜底');
  assert.ok(s.includes('function arrowQuiverFor(itid)'),name+' 必须有箭矢筒匹配');
  assert.ok(s.includes('/[筒袋囊]$/'),name+' 只认箭矢筒/袋/囊');
  assert.ok(s.includes('base==="魔法"+want'),name+' 魔法前缀箭矢筒要认');
  assert.ok(s.includes('if (quiver && quiver.used)'),name+' 耗尽换箭也要用对应箭矢筒');
  assert.ok(s.includes('箭矢筒（风灵箭矢 → 风灵箭矢筒'),name+' 窗口说明要写箭矢筒');
}});
test('V2.36.12 按目标换箭行为：换指定箭 / 缺箭用默认箭 / 没配不动 / 缺箭开对应箭矢筒',()=>{
  const code=extract('  function arrowPos(v)','  function arrowLoad(){')+extract('  function arrowBoss(mid)','  function arrowFill(s)')+extract('  var arrowSelfPending=null,arrowSelfSaid="",arrowQuiverAt=0;','  function arrowEnsureHost(){');
  const names={1750:'弓箭',1751:'银箭矢',1755:'风灵箭矢',1757:'无形箭矢',12010:'风灵箭矢筒',22107:'魔法风灵箭矢筒',22119:'魔法无形箭矢筒'};
  function mk(cfg,mid,ammo,bag,inv){
    const ctx={};vm.createContext(ctx);
    vm.runInContext('this.getMobDb=function(){return {};};this.arrowRules='+JSON.stringify(cfg)+';this.arrowTarget=null;this.curMid='+mid+';'
      +'this.ammo='+JSON.stringify(ammo)+';this.bag='+JSON.stringify(bag)+';this.inv='+JSON.stringify(inv||[])+';'
      +'this.getItemName=function(i){return ('+JSON.stringify(names)+')[i]||"";};'
      +'this.findInventory=function(){return inv;};this.useItemById=function(i){used.push(i);return true;};'
      +'this.clientReady=function(){return true;};this.equipArrow=function(i){equipped.push(i);return true;};'
      +'this.readEquippedAmmo=function(){return ammo;};this.readBagArrows=function(){return bag;};'
      +'this.arrowCurrentMid=function(){return curMid;};this.arrowSay=function(s){said.push(s);};'
      +'this.externalAutomationOwns=function(){return false;};'
      +'this.arrowKindName=function(k){return k==="mob"?"指定怪箭":"默认箭";};this.arrowMobName=function(m){return "怪"+m;};this.arrowItemName=function(i){return "箭"+i;};'
      +'this.used=[];this.equipped=[];this.said=[];'
      +code+';this.tick=function(t){arrowSelfTick(t);arrowSelfTick(t+2000);};this.quiver=arrowQuiverFor;this.want=arrowSelfWanted;',ctx);
    return ctx;
  }
  let c=mk({enabled:true,defaultItid:1750,byMid:{1002:1751}},1002,{index:9,itid:1750,count:100},[{index:5,itid:1751,count:500}]);
  c.tick(1000);assert.equal(JSON.stringify(c.equipped),'[5]','目标怪配过箭 → 换成它');
  c=mk({enabled:true,defaultItid:1750,byMid:{1002:1751}},1002,{index:9,itid:1751,count:0},[{index:6,itid:1750,count:100}]);
  c.tick(1000);assert.equal(JSON.stringify(c.equipped),'[6]','配的箭背包里没有 → 默认箭兜底');
  c=mk({enabled:false,defaultItid:1750,byMid:{1002:1751}},1002,{index:9,itid:1750,count:100},[{index:5,itid:1751,count:500}]);
  c.tick(1000);assert.equal(c.equipped.length,0,'换箭没开 → 不动');
  c=mk({enabled:true,defaultItid:null,byMid:{}},1002,{index:9,itid:1750,count:100},[{index:5,itid:1751,count:500}]);
  c.tick(1000);assert.equal(c.equipped.length,0,'什么都没配 → 不动');
  c=mk({enabled:true,defaultItid:1750,byMid:{1002:1751}},1002,{index:9,itid:1751,count:12},[{index:5,itid:1751,count:500}]);
  c.tick(1000);assert.equal(c.equipped.length,0,'已经装对了 → 不重复换');
  assert.ok(String(c.said[c.said.length-1]).indexOf('已按目标换好')>=0,'已经装对了要报状态');
  c=mk({enabled:true,defaultItid:null,byMid:{1004:1755}},1004,{index:9,itid:1750,count:0},[],[{index:7,ITID:12010,count:1},{index:8,ITID:22107,count:1}]);
  c.tick(1000);assert.equal(JSON.stringify(c.used),'[12010]','缺箭 → 开对应箭矢筒（精确名优先于魔法前缀）');
  c=mk({enabled:true,defaultItid:null,byMid:{1004:1755}},1004,{index:9,itid:1750,count:0},[],[{index:8,ITID:22107,count:1},{index:7,ITID:12010,count:0}]);
  assert.equal(Number((c.quiver(1755)||{}).itid),22107,'数量为 0 的箭矢筒不算数');
  c=mk({enabled:true,defaultItid:null,byMid:{1004:1757}},1004,{index:9,itid:1750,count:0},[],[{index:8,ITID:22119,count:3}]);
  assert.equal(Number((c.quiver(1757)||{}).itid),22119,'只有魔法前缀箭矢筒时也能认');
  c.tick(1000);assert.equal(JSON.stringify(c.used),'[22119]','缺箭时用对应箭矢筒补充');
  c=mk({enabled:true,defaultItid:1750,byMid:{1002:1751}},1002,{index:9,itid:1750,count:100},[{index:5,itid:1751,count:500}]);
  assert.equal(c.want(),true,'有可用候选箭时通用耗尽换箭让位');
  c=mk({enabled:true,defaultItid:null,byMid:{1004:1755}},1004,{index:9,itid:1750,count:0},[],[{index:7,ITID:12010,count:1}]);
  assert.equal(c.want(),false,'只有箭矢筒时不许拦通用耗尽换箭（免得站着不射）');
});
test('V2.36.11 script window imports from file and exports every script',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('id="dsh-scr-file">从文件导入…'),name+' 必须提供从文件导入');
  assert.ok(s.includes('id="dsh-scr-fileinput" type="file"'),name+' 必须有隐藏 file input');
  assert.ok(s.includes('id="dsh-scr-backup">备份全部脚本到文件'),name+' 必须提供整表备份');
  assert.ok(s.includes('>导入上面的 JSON<'),name+' 粘贴导入按钮改名');
  assert.ok(s.includes('rd.readAsText(f, "utf-8")'),name+' 文件读取走 FileReader');
  assert.ok(s.includes('Array.isArray(obj) ? obj : [obj]'),name+' 导入支持一次多条');
  assert.ok(s.includes('function scrExportAll()'),name+' 必须有导出实现');
  assert.ok(s.includes('expB.textContent = "导出"'),name+' 每条脚本必须有导出按钮');
  assert.ok(s.includes('$id("dsh-scr-backup").onclick = function () { scrExportAll(); };'),name+' 备份按钮必须接上导出');
}});


// ================= V2.36.0 内置道馆并入主脚本 + 新门面能力 =================
test('V2.36.0 window facade registers opens and closes through the shared fw layer',()=>{
  for(const[name,s]of splitSources){
    assert.ok(s.includes('fwReg("scr", "脚本执行", scrEnsureHost)'),name+' 脚本必须注册为标准浮窗');
    assert.ok(s.includes('function apiRegisterWindow(id,title,getEl)'));
    assert.ok(s.includes('function apiOpenWindow(id)'));
    assert.ok(s.includes('function apiCloseWindow(id)'));
    assert.ok(s.includes('registerWindow:apiRegisterWindow,openWindow:apiOpenWindow,closeWindow:apiCloseWindow'));
    assert.ok(s.includes('modules:["dojo"]'),name+' capabilities 必须声明 modules:["dojo"]');
    assert.ok(s.includes('fwMakeWin(id,fwState[id].title)'),name+' openWindow 必须复用 fwMakeWin');
    assert.ok(s.includes('fwReg(id,String(title||id),getEl)'),name+' registerWindow 必须复用 fwReg');
    assert.ok(s.includes('fwClose(id)'),name+' closeWindow 必须复用 fwClose');
    assert.ok(s.includes('h.id = "dsh-fw-scr"'),name+' 脚本宿主必须沿用 dsh-fw-* 约定');
    assert.ok(s.includes('<div class="sec">脚本执行'),name+' 脚本必须用 sec 区块样式');
    assert.ok(s.includes('<span class="st" id="dsh-scr-state"'),name+' 脚本必须用 st 状态样式');
    assert.ok(s.includes('<div class="log" id="dsh-scr-log"'),name+' 脚本必须用 log 说明样式');
    assert.ok(!s.includes('id="dsh-dojo-panel"'),name+' 禁止自建左上角 plain 面板');
  }
  // 行为：合法 id 走 fwReg，非法 id / 未登记窗口一律 fail-closed
  const code=extract('  function apiRegisterWindow(id,title,getEl){','  // bag：规划与执行');
  const registered=[];const ctx={fwState:{},fwReg(id,title,getEl){registered.push(id);ctx.fwState[id]={title:title,getEl:getEl};},fwMakeWin(id){ctx.made=id;return {};},fwOpen(id){return !!ctx.fwState[id];},fwClose(id){ctx.closed=id;},String};
  vm.createContext(ctx);vm.runInContext(code+';this.reg=apiRegisterWindow;this.open=apiOpenWindow;this.close=apiCloseWindow',ctx);
  assert.equal(ctx.reg('bad id','x',()=>null).error,'invalid-id');
  assert.equal(ctx.reg('x'.repeat(33),'x',()=>null).error,'invalid-id');
  assert.equal(ctx.reg('ok','x',null).error,'invalid-getter');
  assert.equal(ctx.open('nope').error,'unknown-window');
  assert.equal(ctx.close('nope').error,'unknown-window');
  const okReg=ctx.reg('extwin','外部窗口',()=>null);
  assert.equal(okReg.ok,true);assert.equal(okReg.id,'extwin');
  assert.deepEqual(registered,['extwin']);
  assert.equal(ctx.open('extwin').ok,true);
  assert.equal(ctx.made,'extwin');
  assert.equal(ctx.close('extwin').ok,true);
  assert.equal(ctx.closed,'extwin');
});

test('V2.36.0 builtin dojo joins the shared lease and refuses when the lease is occupied',()=>{
  for(const[name,s]of splitSources){
    assert.ok(s.includes('var DOJO_OWNER="builtin-dojo"'));
    assert.ok(s.includes('a.acquire(DOJO_OWNER,["dojo","battle","movement","dialog","arrow","fly"])'),name+' 内置道馆必须走同一租约');
    assert.ok(s.includes('a.release(DOJO_OWNER)'),name+' 停止必须释放租约');
    assert.ok(s.includes('if(!r||!r.ok)return dojoStop(r&&r.error||"助手正被其他流程占用")'),name+' 被占用必须拒绝并提示');
    assert.ok(s.includes('if(apiLease&&apiLease.owner!==owner)return {ok:false,error:"owned"}')); // apiAcquire 单一租约不变
    assert.ok(s.includes('externalAutomationOwns("arrow") || arrowTarget'),name+' 通用换箭让位逻辑不得改动');
    assert.ok(s.includes('externalAutomationOwns("battle")'),name+' 助手战斗让位逻辑不得改动');
    assert.ok(s.includes('++menuReconGeneration'),name+' apiMenu 仍用 menuRecon 指纹');
    assert.ok(s.includes('if(fp===apiMenuUsed)return {ok:false,error:"menu-already-used"}'));
    assert.ok(s.includes('dojo:1,battle:1,movement:1,dialog:1,arrow:1,fly:1'));
    for(const sig of ['apiHas(owner,scope)','apiSnapshot(owner)','apiRelease(owner)','apiContact(owner,gid)','apiWalk(owner,payload)','apiChoose(owner,payload)','apiBattle(owner,on)','apiSetArrow(owner,target)','apiClearArrow(owner)','apiFly(owner,payload)'])assert.ok(s.includes('function '+sig),sig);
    assert.ok(s.includes('if(dojoRun.timer)clearInterval(dojoRun.timer)'),name+' 停止/暂停必须清定时器');
  }
  const code=extract('  function dojoStart(params){','  function dojoStop(reason){')+extract('  function dojoStop(reason){','  function dojoRender(){');
  function run(startOk,apiMissing){
    const calls=[];let timerSet=null;
    const ctx={DOJO_OWNER:'builtin-dojo',dojoCfg:{difficulty:'basic',stop100:true,fly:false,emergency:false},dojoRun:{on:false,generation:0,timer:null,phase:''},dojoRender(){},
      dojoTick:g=>calls.push(['tick',g]),dojoStop:r=>{calls.push(['stop',r]);return r;},
      dojoApi:()=>apiMissing?null:{ready:()=>true,acquire:(o,sc)=>{calls.push(['acquire',o,sc.join('+')]);return startOk?{ok:true}:{ok:false,error:'owned'};},clearArrowTarget:o=>calls.push(['clear',o]),release:o=>calls.push(['release',o])},
      setInterval:(fn,ms)=>{timerSet=ms;return 7;},clearInterval:id=>{calls.push(['clearInterval',id]);},Date,Math};
    vm.createContext(ctx);vm.runInContext(code+';this.start=dojoStart;this.stop=dojoStop',ctx);
    return {ctx,timerSet:()=>timerSet,calls};
  }
  const busy=run(false,false);
  busy.ctx.start();
  assert.equal(busy.ctx.dojoRun.phase,'owned'); // dojoStop(原因) 无返回值，原因落在 phase
  assert.equal(busy.ctx.dojoRun.on,false);
  assert.equal(busy.ctx.dojoRun.timer,null);
  assert.deepEqual(busy.calls.filter(c=>c[0]==='acquire').length,1);
  assert.deepEqual(busy.calls.filter(c=>c[0]==='acquire')[0][1],'builtin-dojo');
  assert.equal(busy.calls.filter(c=>c[0]==='acquire')[0][2],'dojo+battle+movement+dialog+arrow+fly');
  const missing=run(false,true);
  missing.ctx.start();
  assert.equal(missing.ctx.dojoRun.phase,'缺少兼容的 RO助手 API，功能已禁用');
  assert.equal(missing.ctx.dojoRun.on,false);
  const okk=run(true,false);
  okk.ctx.start();
  assert.equal(okk.ctx.dojoRun.on,true);
  assert.equal(okk.ctx.dojoRun.timer,7);
  assert.equal(okk.timerSet(),250);
  assert.equal(okk.ctx.dojoRun.phase,'启动中');
  assert.deepEqual(okk.calls.filter(c=>c[0]==='tick').length,1);
  okk.ctx.stop('页面离开');
  assert.equal(okk.ctx.dojoRun.phase,'页面离开');
  assert.equal(okk.ctx.dojoRun.on,false);
  assert.equal(okk.ctx.dojoRun.timer,null);
  assert.deepEqual(okk.calls.filter(c=>c[0]==='clearInterval')[0],['clearInterval',7]);
  assert.deepEqual(okk.calls.filter(c=>c[0]==='release')[0],['release','builtin-dojo']);
  assert.deepEqual(okk.calls.filter(c=>c[0]==='clear')[0],['clear','builtin-dojo']);
});

test('V2.36.1 出口策略三态：显式不可丢锁 mail/bag，unknown 与普通物品放行',()=>{
  for(const[name,s]of splitSources){
    assert.ok(s.includes('itemOutletAllowed(it.ITID, "sell")'),name+' NPC 出售必须走出口校验');
    assert.ok(s.includes('itemOutletAllowed(id, "store")'),name+' 仓库存放必须走出口校验');
    assert.ok(s.includes('items:{noDrop:itemNoDropState,outlet:itemOutletAllowed,note:ITEM_OUTLET_NOTE}'));
    assert.ok(s.includes('只允许「邮件发送」「背包丢弃」两个出口，NPC 出售 / 仓库存放等其它出口一律拒绝。'));
    for(const marker of ['NoDrop','noDrop','nodrop','NoDropFlag','Undroppable','CantDrop','CannotDrop','NotDroppable','DropDeny','no_drop'])assert.ok(s.includes('"'+marker+'"'),'不可丢字段探测缺少 '+marker);
    assert.ok(s.includes('无法丢弃|不可丢弃|不能丢弃'),'描述文本探测必须保留');
  }
  const code=extract('  var ITEM_OUTLET_NOTE=','  // pushplus：token');
  function outlet(info){
    const ctx={CLIENT:{DB:{getItemInfo:()=>info}},requireDB:()=>null,Object,Number,String,Array};
    vm.createContext(ctx);vm.runInContext(code+';this.state=itemNoDropState;this.out=itemOutletAllowed',ctx);
    return ctx;
  }
  const nd=outlet({NoDrop:1});
  assert.equal(nd.state(501),'nodrop');
  assert.equal(nd.out(501,'sell').ok,false);
  assert.equal(nd.out(501,'sell').error,'item-outlet-locked');
  assert.equal(nd.out(501,'store').ok,false);
  assert.equal(nd.out(501,'trade').ok,false);
  assert.equal(nd.out(501,'mail').ok,true);
  assert.equal(nd.out(501,'mail').restricted,true);
  assert.equal(nd.out(501,'bag').ok,true);
  const un=outlet(null); // V2.36.1：DB / 字段完全无法判定 → unknown 不锁出口，恢复原行为放行
  assert.equal(un.state(501),'unknown');
  assert.equal(un.out(501,'sell').ok,true);
  assert.equal(un.out(501,'store').ok,true);
  assert.equal(un.out(501,'mail').ok,true);
  assert.equal(un.out(501,'bag').ok,true);
  const keep=outlet({NoDrop:0});
  assert.equal(keep.state(501),'keep');
  assert.equal(keep.out(501,'sell').ok,true);
  const keepStr=outlet({no_drop:'0'});
  assert.equal(keepStr.state(501),'keep');
  assert.equal(keepStr.out(501,'store').ok,true);
  const keepUndef=outlet({NoDrop:undefined}); // 字段疑似存在但没给值 → 视同无证据，按可丢放行
  assert.equal(keepUndef.state(501),'keep');
  assert.equal(keepUndef.out(501,'sell').ok,true);
  const unk=outlet({NoDrop:'yes'}); // 字段在但取值无法判定 → 保守锁出口
  assert.equal(unk.state(501),'nodrop');
  assert.equal(unk.out(501,'sell').ok,false);
  assert.equal(unk.out(501,'mail').ok,true);
  const plain=outlet({identifiedDisplayName:'红色药水',identifiedDescriptionName:'恢复少量 HP'}); // 普通物品无任何 NoDrop 字段 → 必须可卖可存
  assert.equal(plain.state(501),'keep');
  assert.equal(plain.out(501,'sell').ok,true);
  assert.equal(plain.out(501,'store').ok,true);
  const txt=outlet({identifiedDescriptionName:'某材料'+String.fromCharCode(10)+'无法丢弃'});
  assert.equal(txt.state(501),'nodrop');
  const badId=outlet({NoDrop:0});
  assert.equal(badId.state('x'),'unknown');
  assert.equal(badId.out(0,'sell').ok,true); // 非法 ID → unknown → 放行，不再整类拒绝
});

test('V2.36.0 mail probing is fail-closed when no complete MAIL packet constructor exists',()=>{
  for(const[name,s]of splitSources){
    assert.ok(s.includes('if(!probe)return {ok:false,error:"mail-unsupported"}'),name+' 探测不到邮件包必须 fail-closed');
    assert.ok(s.includes('if(!/MAIL/i.test(name))continue'),name+' 必须按 /MAIL/ 探测构造器');
    assert.ok(s.includes('if(!ok)continue'),name+' 字段不齐备的构造器必须放弃');
    assert.ok(s.includes('CLIENT.NM.sendPacket(packet)'));
  }
  const probeCode=extract('  var MAIL_FIELD_RE=','  function apiMailSend(payload){');
  const sendCode=extract('  function apiMailSend(payload){','  var apiFacade={protocol:API_PROTOCOL');
  function mailVm(CZ,ready){
    const sent=[];
    const ctx={CLIENT:{PS:{CZ:CZ},NM:{sendPacket:p=>sent.push(p)}},clientReady:()=>ready!==false,Object,Number,String,Array};
    vm.createContext(ctx);vm.runInContext(probeCode+sendCode+';this.probe=mailProbe;this.send=apiMailSend',ctx);
    return {ctx,sent};
  }
  const none=mailVm({CONTACTNPC:function(){this.NAID=0;this.type=1;}},true);
  assert.equal(none.ctx.probe(),null);
  const noneRes=none.ctx.send({to:'u1',title:'t',body:'b'});
  assert.equal(noneRes.ok,false);assert.equal(noneRes.error,'mail-unsupported');
  assert.equal(none.sent.length,0,'探测不到邮件包时绝不允许发包');
  const thin=mailVm({MAIL_X:function(){this.to='';this.title='';}},true);
  assert.equal(thin.ctx.probe(),null);
  assert.equal(thin.ctx.send({to:'u1'}).error,'mail-unsupported');
  assert.equal(thin.sent.length,0);
  const boom=mailVm({MAIL_BOOM:function(){throw new Error('ctor')}},true);
  assert.equal(boom.ctx.send({to:'u1'}).error,'mail-unsupported');
  const good=mailVm({MAIL_SEND:function(){this.to='';this.title='';this.body='';this.itemIndex=0;this.itemAmount=0;}},true);
  assert.equal(good.ctx.probe().name,'MAIL_SEND');
  const r=good.ctx.send({to:'u1',title:'你好',body:'正文',itemIndex:3,itemAmount:2});
  assert.equal(r.ok,true);
  assert.equal(r.packet,'MAIL_SEND');
  assert.equal(good.sent.length,1);
  assert.equal(good.sent[0].to,'u1');
  assert.equal(good.sent[0].title,'你好');
  assert.equal(good.sent[0].body,'正文');
  assert.equal(good.sent[0].itemIndex,3);
  assert.equal(good.sent[0].itemAmount,2);
  assert.equal(good.ctx.send({to:'u1',itemIndex:-1}).error,'invalid-item');
  assert.equal(good.ctx.send({to:''}).error,'invalid-to');
  assert.equal(good.sent.length,1,'非法入参不得发包');
  const notReady=mailVm({MAIL_SEND:function(){this.to='';this.title='';this.body='';this.itemIndex=0;this.itemAmount=0;}},false);
  assert.equal(notReady.ctx.send({to:'u1'}).error,'client-not-ready');
  assert.equal(notReady.sent.length,0);
});

// ================= V2.36.1 出口策略三态修正 + 合并后行为门禁（独立审计 B1 / B2）=================
test('V2.36.1 普通物品（无 NoDrop 字段）恢复可卖可存，只有显式或可疑不可丢才锁出口',()=>{
  const code=extract('  var ITEM_OUTLET_NOTE=','  // pushplus：token');
  function outlet(info){
    const ctx={CLIENT:{DB:{getItemInfo:()=>info}},requireDB:()=>null,Object,Number,String,Array};
    vm.createContext(ctx);vm.runInContext(code+';this.state=itemNoDropState;this.out=itemOutletAllowed',ctx);
    return ctx;
  }
  const plain=outlet({identifiedDisplayName:'红色药水',identifiedDescriptionName:'恢复少量 HP'}); // 普通物品：DB 里没有 NoDrop 类字段
  assert.equal(plain.state(501),'keep','无 NoDrop 字段的普通物品必须判为可丢');
  assert.equal(plain.out(501,'sell').ok,true,'普通物品必须允许 NPC 出售（回归点）');
  assert.equal(plain.out(501,'store').ok,true,'普通物品必须允许存仓（回归点）');
  assert.equal(plain.out(501,'sell').state,'keep');
  const undef=outlet({NoDrop:undefined});
  assert.equal(undef.state(501),'keep','字段没给值不算不可丢证据');
  assert.equal(undef.out(501,'sell').ok,true);
  const zero=outlet({Undroppable:'0'});
  assert.equal(zero.state(501),'keep');
  assert.equal(zero.out(501,'store').ok,true);
  const odd=outlet({NoDrop:'yes'}); // 字段在但取值无法判定 → 保守
  assert.equal(odd.state(501),'nodrop');
  assert.equal(odd.out(501,'sell').ok,false);
  assert.equal(odd.out(501,'store').error,'item-outlet-locked');
  assert.equal(odd.out(501,'mail').ok,true);
  assert.equal(odd.out(501,'bag').ok,true);
  assert.match(odd.out(501,'sell').note,/只允许/,'锁定文案必须保留');
  const explicit=outlet({NoDrop:1});
  assert.equal(explicit.state(501),'nodrop');
  assert.equal(explicit.out(501,'sell').ok,false);
  assert.equal(explicit.out(501,'mail').ok,true);
  assert.equal(explicit.out(501,'mail').restricted,true);
  assert.equal(explicit.out(501,'bag').ok,true);
  const described=outlet({identifiedDescriptionName:'某材料'+String.fromCharCode(10)+'无法丢弃'});
  assert.equal(described.state(501),'nodrop');
  assert.equal(described.out(501,'store').ok,false);
  const noDb=outlet(null); // DB 拿不到 / 物品不在库 → unknown → 放行（恢复原行为）
  assert.equal(noDb.state(501),'unknown');
  assert.equal(noDb.out(501,'sell').ok,true);
  assert.equal(noDb.out(501,'store').ok,true);
  const badId=outlet({NoDrop:0});
  assert.equal(badId.state('x'),'unknown');
  assert.equal(badId.out(0,'store').ok,true);
});

test('V2.36.1 内置道馆换箭 gate：未就绪 / 被阻塞 / 目标不匹配都不开战',()=>{
  const code=extract('  function dojoTick(g){','  function dojoStart(params){');
  const base={ready:true,inDojoMap:true,mobs:[],npcs:[],player:{position:[0,0],hp:100,maxHp:100},dialogOpen:false,menu:null}; // ready:true 否则 dojoTick 直接 dojoStop
  function tick(arrow,arrowCfg,mob,extra){
    const calls=[];
    const run={on:true,generation:1,phase:'',npc:null,lastMenu:'',lastFly:0,round:0,remaining:null,timer:null};
    const arrowRules=arrowCfg||{enabled:false};
    const m=mob||{mid:1002,gid:42,dead:false};
    const e=extra||{};
    const snap=Object.assign({},base,{mobs:[m],arrow:arrow},e.arrow!==undefined?{arrow:e.arrow}:{});
    const a={snapshot:()=>snap,setArrowTarget:()=>{calls.push(['setArrow']);return{ok:true};},requestBattle:(o,on)=>{calls.push(['battle',on]);},clearArrowTarget:()=>calls.push(['clearArrow']),contactNpc:()=>calls.push(['contact']),walkTo:()=>calls.push(['walk']),requestFly:()=>calls.push(['fly']),chooseMenu:()=>calls.push(['choose'])};
    const ctx={dojoRun:run,dojoCfg:Object.assign({difficulty:'advanced',stop100:false,fly:false,emergency:false},e.cfg||{}),
      arrowRules:e.arrowRules||arrowRules,DOJO_OWNER:'builtin-dojo',dojoApi:()=>a,dojoRender:()=>{},dojoStop:r=>{calls.push(['stop',r]);return r;},
      dojoChoose:()=>false,dojoContact:()=>{},dojoNorm:s=>String(s||''),Math,Number,String,Array,Object,Infinity,Date};
    vm.createContext(ctx);vm.runInContext(code+';this.tick=dojoTick',ctx);
    ctx.tick(1);
    const battles=calls.filter(c=>c[0]==='battle');
    return {calls,on:battles.length?battles[battles.length-1][1]:undefined,phase:run.phase};
  }
  const r1=tick({enabled:true,ready:false,blocked:false,target:{mid:1002,gid:42}});
  assert.equal(r1.on,false,'enabled=true 但 ready=false 必须禁止开战');
  assert.equal(r1.phase,'等待换箭就绪');
  assert.equal(tick({enabled:true,ready:true,blocked:true,target:{mid:1002,gid:42}}).on,false,'blocked=true 必须禁止开战');
  assert.equal(tick({enabled:true,ready:true,blocked:false,target:{mid:9999,gid:42}}).on,false,'换箭目标不匹配（mid 不同）必须禁止开战');
  assert.equal(tick({enabled:true,ready:true,blocked:false,target:{mid:1002,gid:77}}).on,false,'换箭目标不匹配（gid 不同）必须禁止开战');
  assert.equal(tick({enabled:true,ready:true,blocked:false,target:null}).on,false,'没有换箭目标必须禁止开战');
  const ok=tick({enabled:true,ready:true,blocked:false,target:{mid:1002,gid:42}});
  assert.equal(ok.on,true,'ready 且未阻塞且目标匹配必须开战');
  assert.equal(ok.phase,'战斗中');
  const basic=tick({enabled:false}, {enabled:false}, null, {cfg:{difficulty:'basic'}}); // basic + arrow.enabled=false → 放行
  assert.equal(basic.on,true,'基本难度且未启用换箭必须放行（不受 ready/blocked 影响）');
  assert.equal(basic.phase,'战斗中');
  const basicOn=tick({enabled:false}, {enabled:false}, null, {cfg:{difficulty:'basic'}, arrowRules:{enabled:true}});
  assert.equal(basicOn.on,true,'放行只看快照 arrow.enabled=false，与本地 arrowRules.enabled 无关');
  const mid=tick({enabled:false});
  assert.equal(mid.on,false,'advanced 难度且换箭未启用必须禁止开战');
});

test('V2.36.1 暂停与限次顺序：先清定时器 / 先占位指纹再发包（审计 B2 迁移）',()=>{
  // B2-1 占位先于发包：菜单指纹必须在 chooseMenu 之前写进 dojoRun.lastMenu（防重复提交）
  const choose=extract('  function dojoChoose(a,s)','  function dojoNpcs(');
  const reserve=choose.indexOf('dojoRun.lastMenu=m.fingerprint');
  const send=choose.indexOf('a.chooseMenu(DOJO_OWNER,');
  assert.ok(reserve>=0&&send>reserve,'菜单指纹必须在发包前占位');
  // B2-2 暂停先清 interval：dojoStop 必须先清定时器再进入停止态
  const stop=extract('  function dojoStop(reason){','  function dojoRender(){');
  const onOff=stop.indexOf('dojoRun.on=false');
  const clear=stop.indexOf('clearInterval(dojoRun.timer)');
  const null0=stop.indexOf('dojoRun.timer=null');
  assert.ok(onOff>=0&&clear>onOff,'dojoStop 必须先置 on=false 再清定时器（顺序性回归）');
  assert.ok(null0>clear,'清定时器后必须把 timer 置回 null');
  for(const[name,s]of splitSources){
    assert.ok(s.includes('(dojoRun.cfg||dojoCfg).stop100&&dojoRun.round>=100'), name+' 100 轮领奖前暂停条件仍在');
    assert.ok(s.includes('return dojoStop("第100轮领奖前暂停")'), name+' 100 轮领奖前暂停必须仍然触发 dojoStop');
    assert.ok(s.includes('notifyPush("无限道场已达 100 轮，领奖前已暂停")'), name+' 100 轮暂停应推送通知');
  }
  // 行为：定期器在清掉时必须已经不再挂在 run.timer 上
  const run={on:true,generation:1,phase:'',npc:null,lastMenu:'',lastFly:0,round:100,remaining:1,timer:7};
  const calls=[];
  const ctx={dojoRun:run,dojoCfg:{difficulty:'basic',stop100:true,fly:false,emergency:false},
    dojoApi:()=>null,dojoRender:()=>{},clearInterval:t=>{calls.push(['clearInterval',t,run.on,run.timer]);run.timer=null;},
    Math,Number,String,Array,Object,Date};
  vm.createContext(ctx);vm.runInContext(extract('  function dojoStop(reason){','  function dojoRender(){')+';this.stop=dojoStop',ctx);
  ctx.stop('第100轮领奖前暂停');
  assert.deepEqual(calls[0],['clearInterval',7,false,7],'清定时器时 run.on 必须已是 false');
  assert.equal(run.timer,null);
  assert.equal(run.phase,'第100轮领奖前暂停');
});

test('V2.36.0 builtin dojo keeps standalone semantics for menu NPC and arrow gates',()=>{
  for(const[name,s]of splitSources){
    assert.ok(s.includes('if(now-dojoRun.npc.firstAt>=30000)return dojoStop("寻找 NPC 超过30秒，已停止")'),name+' 30 秒 NPC 止损');
    assert.ok(s.includes('now-dojoRun.npc.firstAt>=8000&&!dojoRun.npc.walked'),name+' 8 秒后才走近');
    assert.ok(s.includes('dojoDist(s.player.position,n.position)>2'),name+' 距离>2 才走近');
    assert.ok(s.includes('if(m.fingerprint===dojoRun.lastMenu)return true'),name+' 菜单指纹不重复提交');
    assert.ok(s.includes('if(hits.length!==1){dojoRun.phase="菜单不唯一，请手动选择"'),name+' 菜单必须唯一');
    assert.ok(s.includes('if(list.length>1){dojoRun.phase="NPC 别名不唯一，请手动靠近"'),name+' 别名必须唯一');
    assert.ok(s.includes('(dojoRun.cfg||dojoCfg).stop100&&dojoRun.round>=100'),name+' 100 轮领奖前暂停');
    assert.ok(s.includes('dojoRun.phase=allowed?"战斗中":"等待换箭就绪"'),name+' 换箭未就绪不开战');
    assert.ok(s.includes('allowed=(dojoRun.cfg||dojoCfg).difficulty==="basic"&&fresh&&fresh.arrow&&fresh.arrow.enabled===false'),name+' basic 且未启用换箭时放行');
    assert.ok(s.includes('window.addEventListener("pagehide",function(){try{if(dojoRun.on)dojoStop("页面离开");'),name+' 页面离开停止');
    assert.ok(s.includes('try { dojoStop("换角色"); } catch (e5) {}'),name+' 换角色停止');
    assert.ok(s.includes('difficulty:"basic",stop100:true,fly:false,emergency:false,migrated:false'));
    assert.ok(s.includes('CHALLENGE_KEY="dsh-ro-challenge-v1"'),name+' 旧配置迁移键必须复用常量');
    assert.equal((s.match(/dsh-ro-challenge-v1/g)||[]).length,1,name+' 迁移键只允许出现一次');
  }
  const code=extract('  function dojoContact(a,s,now){','  function dojoTick(g){');
  const calls=[];
  const aliases=s=>(s.npcs||[]).filter(n=>/^(喵达人|猫达人|白猫|白猫达人)$/.test(String(n.name)));
  const ctx={DOJO_OWNER:'builtin-dojo',dojoRun:{npc:null,phase:''},dojoNpcs:aliases,dojoDist:(x,y)=>x&&y?Math.max(Math.abs(x[0]-y[0]),Math.abs(x[1]-y[1])):Infinity,dojoStop:r=>{calls.push(['stop',r]);return r;},Math,String};
  vm.createContext(ctx);vm.runInContext(code+';this.contact=dojoContact',ctx);
  const a={contactNpc:(o,g)=>calls.push(['contact',o,g]),walkTo:(o,p)=>calls.push(['walk',o,p.x,p.y])};
  ctx.contact(a,{npcs:[{gid:7,name:'喵达人',position:[10,10]}],player:{position:[10,12]}},1000);
  assert.deepEqual(calls[0],['contact','builtin-dojo',7]);
  ctx.contact(a,{npcs:[{gid:7,name:'喵达人',position:[10,10]}],player:{position:[10,12]}},9100);
  assert.equal(calls.filter(c=>c[0]==='walk').length,0,'距离<=2 不得走近');
  ctx.contact(a,{npcs:[{gid:7,name:'喵达人',position:[10,10]}],player:{position:[10,30]}},9100);
  assert.deepEqual(calls.filter(c=>c[0]==='walk')[0],['walk','builtin-dojo',10,10]);
  ctx.dojoRun.npc=null;
  ctx.contact(a,{npcs:[{gid:7,name:'喵达人'},{gid:8,name:'白猫'}],player:{position:[0,0]}},500);
  assert.equal(ctx.dojoRun.phase,'NPC 别名不唯一，请手动靠近');
  ctx.dojoRun.npc=null;
  ctx.contact(a,{npcs:[],player:{position:[0,0]}},500);
  ctx.contact(a,{npcs:[],player:{position:[0,0]}},31500);
  assert.equal(calls.filter(c=>c[0]==='stop').slice(-1)[0][1],'寻找 NPC 超过30秒，已停止');
  assert.ok(code.includes('x:99')&&code.includes('y:107'),'无 NPC 候选坐标兜底不变');
});

// ================= V2.35.4：统一采集器注册表 dsh-collect v1 =================
test('V2.35.4 统一采集器：旧探针与所有权契约保持不变、环形与上报收敛', () => {
  for (const [name, s] of splitSources) {
    // 1) 注册表命名空间 + 版本标识（内部 IIFE，不新增 window 全局）
    assert.ok(s.includes('var DSHCollect = (function'), name + ' 必须存在 DSHCollect 注册表');
    assert.ok(s.includes('var NS = "dsh-collect"'), name + ' 命名空间必须是 dsh-collect');
    assert.ok(s.includes('var VERSION = 1;'), name + ' 版本标识必须是 1');
    assert.ok(!/window\.__dshCollect\s*=|window\.DSHCollect\s*=/.test(s), name + ' 不得新增 window 全局');
    // 2) 五方法 + 三助手全部暴露
    for (const m of ['register','sample','query','refresh','release','ringPush','ringUnshift','post']) {
      assert.ok(new RegExp(m+':\\s*'+m).test(s), name + ' 必须暴露方法 ' + m);
    }
    // 3) 收敛：环形与上报走统一入口（旧手工 push+splice 模式已消除）
    assert.ok((s.match(/DSHCollect\.ringPush\(/g) || []).length >= 5, name + ' 追加式环形 ≥5 处收敛');
    assert.ok((s.match(/DSHCollect\.ringUnshift\(/g) || []).length >= 1, name + ' 前插式环形 ≥1 处收敛');
    assert.ok((s.match(/DSHCollect\.post\(/g) || []).length >= 3, name + ' 上报传输 ≥3 处收敛');
    assert.ok(!s.includes('btRing.push(line); if (btRing.length > 60)'), name + ' btLog 旧环形模式必须移除');
    assert.ok(!s.includes('__dshSphereLog.push({ t: Date.now()'), name + ' sphere 旧环形模式必须移除');
    assert.ok(!s.includes('fetch(INGEST_URL, {'), name + ' ingest 旧 fetch 必须移除');
    // 4) 旧探针入口全部保留（可回溯）
    for (const fn of ['function btLog(','function btSnap(','function btMarkTarget(','function hkProbe(','function neiProbe(','function ingest(','function probeCollect(','function dshDiag(','function dshSphereLog(','function dshCastLog(']) {
      assert.ok(s.includes(fn), name + ' 旧探针必须保留 ' + fn);
    }
    // 5) window 事件环/探针暴露点全部保留
    for (const g of ['window.__dshDiag','window.__dshCast','window.__dshBattle','window.__dshZDiag','window.__dshSphereLog','window.__dshCastTrace','window.__dshSkillDelay','window.__dshSkillNext']) {
      assert.ok(s.includes(g), name + ' window 探针必须保留 ' + g);
    }
    // 6) 对外所有权契约不受影响
    assert.ok(s.includes('function externalAutomationOwns('), name + ' 所有权判定必须保留');
    assert.ok(s.includes('window.__DSH_RO_ASSIST_API__'), name + ' 外部 API 门面必须保留');
    for (const sc of ['dojo','battle','movement','dialog','arrow','fly']) {
      assert.ok(new RegExp('["\']'+sc+'["\']').test(s), name + ' 作用域必须保留 ' + sc);
    }
  }
});

// ================= V2.36.0：道馆菜单入口 + pushplus token UI（统一落全局键） =================
test('V2.36.2 pushplus token UI lives inside the script window and persists through the global key', () => {
  for (const [name, s] of splitSources) {
    assert.ok(s.includes('{ id: "scr",   name: "脚本执行"'), name + ' RO_MODULES 必须有脚本执行条目');
    assert.ok(s.includes('<input id="dsh-scr-pptoken" type="password"'), name + ' 脚本窗口必须提供 pushplus token 密码框');
    assert.ok(s.includes('id="dsh-scr-ppsave"'), name + ' 必须提供「保存推送」按钮');
    assert.ok(s.includes('<input id="dsh-scr-ppen" type="checkbox">启用推送'), name + ' 必须提供「启用推送」复选框');
    const seg = s.slice(s.indexOf('function scrEnsureHost()'), s.indexOf('try { fwReg("scr"'));
    assert.ok(seg.includes('notifyLoadToken()'), name + ' 脚本窗口必须回填 token');
    assert.ok(seg.includes('notifyPushEnabled()'), name + ' 脚本窗口必须回填启用状态');
    assert.ok(seg.includes('notifySaveToken($id("dsh-scr-pptoken").value)'), name + ' 保存必须走 notifySaveToken 链路');
    assert.ok(seg.includes('notifySetPushEnabled($id("dsh-scr-ppen").checked)'), name + ' 勾选状态必须落盘');
  }
  // 行为：token / 启用状态同写全局键 dsh_ro_plugin_v1；未显式关闭默认启用；关闭后 notifyPush 静默
  const store = {};
  const ctx = { LS_KEY: 'dsh_ro_plugin_v1',
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    JSON, String, fetch: () => Promise.resolve({ ok: true }) };
  vm.createContext(ctx);
  vm.runInContext(extract('  // pushplus：token', '  // 窗口注册入口') + ';this.load=notifyLoadToken;this.save=notifySaveToken;this.on=notifyPushEnabled;this.setOn=notifySetPushEnabled;this.push=notifyPush', ctx);
  assert.equal(ctx.load(), '');
  assert.equal(ctx.on(), true, '未写入该键时必须默认启用（兼容旧配置）');
  assert.equal(ctx.save('tk-123'), true);
  assert.equal(ctx.load(), 'tk-123');
  assert.deepEqual(JSON.parse(store['dsh_ro_plugin_v1']), { pushplusToken: 'tk-123' }, 'token 必须写进全局键');
  assert.equal(ctx.push('hi'), true);
  assert.equal(ctx.setOn(false), true);
  assert.equal(ctx.on(), false);
  assert.equal(ctx.push('hi'), false, '停用后不得再发送');
  assert.deepEqual(JSON.parse(store['dsh_ro_plugin_v1']), { pushplusToken: 'tk-123', pushplusEnabled: false }, 'token 与启用状态必须同键共存');
});

// ================= V2.36.2：道馆移出主脚本 · 脚本系统承载 =================
test('v2.36.2 道馆脚本化：动作/窗口/模板/门面', () => {
  for (const [name, s] of splitSources) {
    assert.ok(s.includes('"dojoStart", "dojoWait", "dojoStop"'), name + ' SCR_ACTIONS 含 dojo 三动作');
    assert.ok(s.includes('case "dojoStart": scrDojoStart(step);'), name + ' dojoStart 分发');
    assert.ok(s.includes('case "dojoStop": scrDojoStop();'), name + ' dojoStop 分发');
    assert.ok(s.includes('fwReg("scr", "脚本执行", scrEnsureHost)'), name + ' 脚本窗口注册');
    assert.ok(s.includes('function scrEnsureHost()'), name + ' 脚本窗口宿主');
    assert.ok(s.includes('var DOJO_SCRIPT_TPL'), name + ' 道馆模板');
    assert.ok(s.includes('templateId: "infinite-dojo"'), name + ' 模板 templateId');
    assert.ok(s.includes('type: "dojo"'), name + ' 模板 type=dojo');
    assert.ok(s.includes('action: "dojoWait"'), name + ' 模板 dojoWait 步');
    // 内置道馆窗口移除，但门面能力保留
    assert.ok(!s.includes('fwReg("dojo"'), name + ' 内置道馆窗口必须移除');
    assert.ok(!s.includes('dojoEnsureHost'), name + ' 内置道馆宿主必须移除');
    assert.ok(s.includes('modules:["dojo"]'), name + ' API 门面保留 dojo 模块');
    assert.ok(s.includes('function dojoStart(params)'), name + ' dojoStart 动作实现保留');
    // 顶层字段校验
    assert.ok(s.includes('obj.priority != null'), name + ' priority 校验');
    assert.ok(s.includes('obj.loop.mode === "count"'), name + ' loop.count 校验');
    assert.ok(s.includes('obj.loop.mode === "duration"'), name + ' loop.duration 校验');
    assert.ok(s.includes('obj.loop.mode === "until"'), name + ' loop.until 校验');
  }
});

test('v2.36.2 串行队列按 priority 降序 / order 升序', () => {
  const code = extract('  function scrQueueSort(list) {', '  function scrQueueStart() {');
  const list = [{ priority: 1, order: 2 }, { priority: 3, order: 1 }, { priority: 1, order: 1 }, {}, { priority: 0, order: 0 }];
  const ctx = { scrQueue: [0, 1, 2, 3, 4] };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.sort=scrQueueSort', ctx);
  ctx.sort(list);
  assert.deepEqual(ctx.scrQueue, [1, 2, 0, 3, 4], 'priority 降序 + 同级 order 升序');
});

test('v2.36.2 脚本级循环三选一（count/duration/until）', () => {
  const code = extract('  function scrLoopMore(loopCfg) {', '  function scrScriptLoopAgain(loopCfg) {');
  function mk(run, cond) {
    const ctx = { scrRun: run, scrCondMet: cond || (() => true), parseInt, Date: { now: () => 100000 } };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.fn=scrLoopMore', ctx);
    return ctx;
  }
  let c = mk({ scriptLoops: 2 });
  assert.equal(c.fn({ mode: 'count', n: 3 }), true, 'count 未达上限继续');
  assert.equal(c.fn({ mode: 'count', n: 2 }), false, 'count 达上限停止');
  assert.equal(mk({ scriptLoops: 0, startedAt: 100000 - 59999 }).fn({ mode: 'duration', minutes: 1 }), true, 'duration 未超时继续');
  assert.equal(mk({ scriptLoops: 0, startedAt: 100000 - 60001 }).fn({ mode: 'duration', minutes: 1 }), false, 'duration 超时停止');
  assert.equal(mk({ scriptLoops: 0 }, () => false).fn({ mode: 'until', until: { item: 1 } }), true, 'until 未达成继续');
  assert.equal(mk({ scriptLoops: 0 }, () => true).fn({ mode: 'until', until: { item: 1 } }), false, 'until 达成停止');
});

test('v2.36.2 dojoWait 语义：已停/轮次/条件', () => {
  const code = extract('  function scrDojoWaitMet(step) {', '  function scrNextStep() {');
  function run(dojoRun, step, cond) {
    const ctx = { dojoRun, scrCheckUntil: cond || (() => true), parseInt };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.fn=scrDojoWaitMet', ctx);
    return ctx.fn(step);
  }
  assert.equal(run(null, {}), true, '未启动视为完成');
  assert.equal(run({ on: false }, {}), true, '已暂停视为完成');
  assert.equal(run({ on: true, round: 50 }, { params: { round: 100 } }), false, '未达轮次继续等');
  assert.equal(run({ on: true, round: 100 }, { params: { round: 100 } }), true, '达轮次完成');
  assert.equal(run({ on: true, round: 1 }, {}), false, '无轮次无条件等到道馆停止');
  assert.equal(run({ on: true, round: 1 }, { until: { item: 1 } }, () => false), false, '条件未达继续等');
  assert.equal(run({ on: true, round: 1 }, { until: { item: 1 } }, () => true), true, '条件达成完成');
});

// ================= V2.36.3：索敌优先级（已攻击 > 身侧 > 血少 > 距离） =================
test('v2.36.3 索敌优先级：已攻击 > 身侧 > 血少 > 距离', () => {
  for (const [name, s] of splitSources) {
    assert.ok(s.includes('var target = null, best = 1e9, bestHp = 1e18, bestTier = -1'), name + ' zAttack 声明 bestTier');
    assert.ok(s.includes('tier > bestTier'), name + ' zAttack 按 tier 优先');
    assert.ok(s.includes('lockNearTier = -1'), name + ' zWalk 声明 lockNearTier');
    assert.ok(s.includes('tier > lockNearTier'), name + ' zWalk 按 tier 优先');
    const tierExpr = '(zHitBy[gidK] && (now - zHitBy[gidK].ts) < zHitKeepMs) ? 2 : (d <= 1 ? 1 : 0)';
    assert.ok(s.includes(tierExpr), name + ' tier 判定：已攻击(2) > 身侧(1) > 其他(0)');
    assert.ok(s.includes('tier === bestTier && (hpNow < bestHp || (hpNow === bestHp && d < best))'), name + ' 同 tier 才比血少→距离');
  }
});

// ================= V2.36.4：脚本执行表单式设置弹窗 =================
test('v2.36.4 脚本执行：点「执行」弹表单设置界面', () => {
  for (const [name, s] of splitSources) {
    assert.ok(s.includes('function scrEditModal()'), name + ' 设置弹窗宿主');
    assert.ok(s.includes('function scrEditOpen(idx)'), name + ' 打开设置入口');
    assert.ok(s.includes('runB.addEventListener("click", function () { scrEditOpen(i); });'), name + ' 执行按钮改为弹设置');
    assert.ok(s.includes('id="dsh-scr-e-diff"'), name + ' 难度下拉');
    assert.ok(s.includes('id="dsh-scr-e-stop100"'), name + ' 100轮暂停开关');
    assert.ok(s.includes('id="dsh-scr-e-fly"'), name + ' 无怪飞行开关');
    assert.ok(s.includes('id="dsh-scr-e-emergency"'), name + ' 紧急飞行开关');
    assert.ok(s.includes('id="dsh-scr-e-loopmode"'), name + ' 循环方式下拉');
    assert.ok(s.includes('id="dsh-scr-e-count"'), name + ' 循环次数输入');
    assert.ok(s.includes('id="dsh-scr-e-minutes"'), name + ' 循环时长输入');
    assert.ok(s.includes('id="dsh-scr-e-priority"'), name + ' 优先级输入');
    assert.ok(s.includes('id="dsh-scr-e-order"'), name + ' 顺序输入');
    assert.ok(s.includes('id="dsh-scr-modal-ok"'), name + ' 确认执行按钮');
    assert.ok(s.includes('scrRunScript(idx)'), name + ' 确认后入队执行');
  }
});


// ================= V2.36.13 走路拾取下线 / 内挂校对 / 属性箭 / 防抖粘性 =================
test('V2.36.13 走路拾取暂时下线：三条拾取路径都被同一个开关挡住，界面标注暂时下线',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('var PICKUP_WALK_OFF = true;'),name+' 总开关必须存在且默认下线');
  assert.ok(s.includes('if (!PICKUP_WALK_OFF && wl[String(itid)]'),name+' 掉落钩子路径已挡');
  assert.ok(s.includes('var en = !PICKUP_WALK_OFF && $id("dsh-picken")'),name+' 5 秒轮询路径已挡');
  assert.ok(s.includes('if (PICKUP_WALK_OFF) return;'),name+' 走过去拾取已挡');
  assert.ok(s.includes('id="dsh-pickoff"'),name+' 界面必须标注暂时下线');
  assert.ok(s.includes('id="dsh-wllist"'),name+' 白名单数据/界面保留（只是走路拾取下线）');
}});
test('V2.36.13 攻击名单怪物搜索：整行点选加入 + 跳转（游戏内导航魔物搜索）/小册子两个入口',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function renderLockHits(kw)'),name+' 搜索结果渲染');
  assert.ok(s.includes('data-lockadd='),name+' 整行可点加入名单');
  assert.ok(s.includes('data-mobgoto='),name+' 行尾跳转入口');
  assert.ok(s.includes('requireDB("UI/Components/Navigation")'),name+' 跳转用客户端导航窗口');
  assert.ok(s.includes('Nav.onSearch()'),name+' 直接调用客户端搜索（不是自己造协议）');
  const ref=s.slice(s.indexOf('function mobRefLinksHtml(mid)'),s.indexOf('function mobRefLinksHtml(mid)')+600);
  assert.ok(!/ro321/i.test(ref),name+' 旧 RO321「数量」外链必须从攻击名单入口移除');
  assert.ok(ref.includes('小册子'),name+' 小册子外链保留');
}});
test('V2.36.13 内挂状态快速校对：回执优先 → 关；读到开启立刻关回去；超时宽松兜底',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function npProbeBattle(reason, done)'),name+' 校对实现');
  assert.ok(s.includes('if (npBattleConfirmedAt >= from) return cb(!!npHuntOn);'),name+' 聊天回执是权威');
  assert.ok(s.includes('tap("restore");'),name+' 读到开启必须立刻关回去');
  assert.ok(s.includes('tap("restore-timeout");'),name+' 读不到回执也要再关一次');
  assert.ok(s.includes('id="dsh-np-probe"'),name+' 功能菜单里能手动点');
  assert.ok(s.includes('npApplyBattleState(false, "probe")'),name+' 校对结束必须落成关闭态');
}});
test('V2.36.13 死亡回图布防：助手模式不再依赖内挂状态，读不到就校对一次/明确不布防',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('var mode = zRunning ? "assistant" : npNow === true ? "builtin" : "";'),name+' 助手模式只认助手在跑');
  assert.ok(s.includes('npProbeBattle("death-arm"'),name+' 读不到内挂状态时自动校对一次');
  assert.ok(s.includes('内挂状态未知：发起一次快速校对'),name+' 必须明确提示，不能静默');
  assert.ok(s.includes('本图没在挂战斗（助手没跑、内挂也没开），暂不布防'),name+' 无战斗模式时如实提示');
  assert.ok(s.includes('var npBusy = r.mode === "assistant" ? false :'),name+' 助手模式不再把未知态当异常取消');
}});
test('V2.36.13 属性→箭：十属性表 + 优先级 属性箭>指定怪箭>默认箭 + 元素码表',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('var ARROW_ELEM_ORDER=["火","水","风","地","毒","圣","暗","念","不死","无"]'),name+' 十个属性');
  assert.ok(s.includes('var MOB_ELEM_RAW="'),name+' 内嵌元素表');
  assert.ok(s.includes('add("elem",ev)'),name+' 属性箭优先级最高');
  assert.ok(s.includes('add("mob",v&&v.itid!=null?v.itid:v)'),name+' 指定怪箭第二');
  assert.ok(s.includes('add("default",cfg.defaultItid)'),name+' 默认箭兜底');
  assert.ok(s.includes('k==="elem"?"属性箭"'),name+' 状态文案要有属性箭');
  assert.ok(s.includes('arrowFillElemSelect(sel,arrowPos(arrowRules.byElem[en]))'),name+' 十行下拉都要能配');
  assert.ok(s.includes('byMid:{},byElem:{}'),name+' 配置结构含 byElem');
  assert.ok(s.includes('if(ARROW_ELEM_ORDER.indexOf(String(k))>=0&&eit)d.byElem[String(k)]=eit;'),name+' 读取时校验属性名');
}});
test('V2.36.13 换箭防抖 1.5 秒 + 大 MVP 30 秒粘性',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('ARROW_STABLE_MS=1500'),name+' 1.5 秒防抖');
  assert.ok(s.includes('ARROW_BOSS_KEEP_MS=30000'),name+' boss 粘性 30 秒');
  assert.ok(s.includes('function arrowStableGate(key,now)'),name+' 防抖实现');
  assert.ok(s.includes('function arrowEffectiveMid(mid,gid,now)'),name+' 有效目标（含粘性）');
  assert.ok(s.includes('function arrowBossAlive(mid,gid)'),name+' 粘性要求 boss 还在实体列表');
  assert.ok(s.includes('if(!arrowStableGate("s"+mid,now))'),name+' 助手换箭要过防抖门');
  assert.ok(s.includes('if(!arrowStableGate("t"+midUse+"@"+arrowTarget.gid,now))'),name+' 道场/外部换箭也要过防抖门');
}});

test('V2.36.14 换箭打完后自动换回默认箭（默认箭可设置 · 实体列表不可用不得误判）', () => {
  const src = expExtract('  function arrowSelfTick(now){', '  function arrowEnsureHost(){');
  assert.ok(src.includes('if(mid0&&arrowMobGone(mid0))mid0=0;'), '目标怪已从实体列表消失必须按「打完了」处理');
  assert.ok(src.includes('if(!mid0){'), '必须有无目标分支');
  assert.ok(src.includes('arrowStableGate("s#idle"'), '打完后换默认箭必须先过 1.5 秒稳定门（防目标抖动）');
  assert.ok(src.includes('var defIdle=arrowPos(arrowRules.defaultItid)'), '默认箭取自换箭设置里可设置的「默认箭」');
  assert.ok(src.includes('if(!defIdle)return;'), '没配默认箭就什么都不做（保持当前装备）');
  assert.ok(src.includes('if(equipArrow(rowI.index)){arrowSelfPending={itid:defIdle'), '打完必须自动装回默认箭');
  assert.ok(src.includes('var qI=arrowUseQuiver(defIdle);'), '默认箭不在背包时仍按箭矢筒兜底');
  assert.ok(src.includes('arrowStickyBoss=null;'), '打完要清掉 boss 粘性，下一场重新判定');
  const gone = expExtract('  function arrowMobGone(mid){', '  function arrowBossAlive(mid,gid){');
  assert.ok(gone.includes('if(!em||!em.forEach)return false;'), '实体列表不可用时不得判定为已消失（否则会把属性箭全换成默认箭）');
  assert.ok(gone.includes('return any&&!found;'), '只有列表可用且列表里找不到这只怪才算消失');
  assert.ok(extract('  function arrowMobGone(mid){', '  function arrowBossAlive(mid,gid){').includes('return any&&!found;'), '稳定版必须同步');
  // vm 实跑：默认箭在包里 → 无目标时自动装回；没配默认箭 → 什么都不做；实体列表不可用 → 不误判
  const code = expExtract('  function arrowSelfTick(now){', '  function arrowEnsureHost(){');
  let clock = 10000, escaped = [];
  const ctx = {
    Number, String, Date: { now: () => clock },
    arrowRules: { enabled: true, defaultItid: 1802, byMid: {}, byElem: {} },
    arrowTarget: null, arrowSelfPending: null, arrowStickyBoss: null,
    externalAutomationOwns: () => false, clientReady: () => true,
    arrowCurrentMid: () => ctx.__mid, arrowMobGone: (m) => !!ctx.__gone,
    arrowPos: (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; },
    arrowStableGate: (key, now) => { if (ctx.__gk !== key) { ctx.__gk = key; ctx.__ga = now; return false; } return now - ctx.__ga >= 1500; },
    readEquippedAmmo: () => ctx.__ammo, readBagArrows: () => ctx.__bag,
    equipArrow: (i) => { escaped.push(i); return true; },
    arrowItemName: (i) => 'IT' + i, arrowSelfSay: (s) => { ctx.__said = s; }, arrowSay: () => {},
    arrowUseQuiver: () => null, arrowEffectiveMid: (mid) => ({ mid, sticky: false }),
    arrowMobName: () => '怪', arrowBoss: () => false, arrowKindName: (k) => k, arrowCandidates: () => [],
    __mid: 0, __gone: false, __ammo: null, __bag: [], __gk: '', __ga: 0,
  };
  ctx.context = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  ctx.__ammo = { itid: 1757, count: 50 }; ctx.__bag = [{ index: 7, itid: 1802, count: 30 }];
  ctx.arrowSelfTick(clock);            // 第一拍只起稳定门
  assert.deepEqual(escaped, [], '稳定门内不得换箭');
  ctx.arrowSelfTick(clock + 1600);     // 过门 → 装回默认箭
  assert.equal(JSON.stringify(escaped), '[7]', '打完后必须自动装回默认箭（背包里的那个 index）');
  assert.equal(JSON.stringify(ctx.arrowSelfPending), JSON.stringify({ itid: 1802, confirmUntil: clock + 1600 + 5000, retryAt: 0 }), '换回默认箭后要等确认回执');
  ctx.arrowRules.defaultItid = null; ctx.__ammo = { itid: 1757, count: 50 }; escaped = []; ctx.__gk = '';
  ctx.arrowSelfTick(clock + 4000); ctx.arrowSelfTick(clock + 6000);
  assert.deepEqual(escaped, [], '没配默认箭就不得动装备');
  ctx.arrowRules.defaultItid = 1802; ctx.__mid = 1002; ctx.__gone = true; ctx.__gk = ''; ctx.__ammo = { itid: 1757, count: 50 }; escaped = []; ctx.arrowSelfPending = null;
  ctx.arrowSelfTick(clock + 8000); ctx.arrowSelfTick(clock + 9700);
  assert.equal(JSON.stringify(escaped), '[7]', '目标怪已消失 = 打完了，也必须换回默认箭');
});

test('V2.36.14 连续死亡自动下线：5 分钟 3 次走「ESC→选择角色→取消→确认结束游戏」', () => {
  const gsrc = expExtract('  var DEATH_GUARD_WINDOW = 300000, DEATH_GUARD_LIMIT = 3;', '  masterTickReg(function () { deathGuardTick(); });');
  assert.ok(gsrc.includes('DEATH_GUARD_WINDOW = 300000, DEATH_GUARD_LIMIT = 3'), '阈值必须是 5 分钟 3 次');
  assert.ok(gsrc.includes('.charselect'), '必须点客户端真实按钮「选择角色」');
  assert.ok(gsrc.includes('pkt.type = 1'), '按钮取不到时发的是 CZ.RESTART type=1（回角色服）');
  assert.ok(gsrc.includes('CharSelectV4') && gsrc.includes('.btn.cancel'), '角色选择界面的「取消」按钮必须点到');
  assert.ok(gsrc.includes('WinPrompt') && gsrc.includes('btn_ok.bmp'), '确认框必须点第一颗 ok 按钮（真正下线）');
  assert.ok(gsrc.includes('stopZhu()') && gsrc.includes('npRequestBattle(false'), '下线前必须停助手并关内挂');
  assert.ok(gsrc.includes('deathReturnCancel("连续死亡自动下线")'), '必须接管死亡回图布防（不能一边回图一边下线）');
  assert.ok(gsrc.includes('zRunning === true || npBattleState() === true'), '只统计助手或内挂在跑时的死亡');
  assert.ok(gsrc.includes('gid !== lastCharGid'), '必须确认是自己的角色');
  assert.ok(gsrc.includes('请手动下线'), '走不完必须明确提示手动下线');
  assert.ok(source.includes('DEATH_GUARD_WINDOW = 300000, DEATH_GUARD_LIMIT = 3'), '稳定版必须同步');
  assert.ok(expSource.includes('id="dsh-z-deathguard"'), '必须有关闭开关');
  assert.ok(expSource.includes('["dsh-z-deathguard", "c"]'), '开关必须进角色档案存档表');
  assert.ok(expSource.includes('连续死亡自动下线：5 分钟内死亡 3 次'), '设置页必须写明口径');
  assert.ok(expExtract('  function deathReturnTick() {', '    var opt = $id("dsh-z-deathreturn")').includes('deathGuardRun || deathGuardDone'), 'deathReturnTick 必须先让位给连续死亡守卫');
  // vm 实跑：手动玩不计数 / 助手在跑 5 分钟 3 次 → 停助手 + 三步下线
  let clock = 1000000, stops = 0, cancels = [], packets = [], statuses = [], notes = [];
  const promptOk = { dataset: { background: 'btn_ok.bmp' }, click: () => { ctx.okClicks++; } };
  const cancelBtn = { click: () => { ctx.cancelClicks++; } };
  const ctx = {
    Number, String, Math, Date: { now: () => clock },
    $id: (id) => (id === 'dsh-z-deathguard' ? { checked: ctx.__guard } : null),
    setStatus: (s) => statuses.push(s), notifyPush: (s) => notes.push(s), roFeedback: (s) => notes.push(s), tlog: () => {},
    clientReady: () => true, gidInt: Number, charNameOf: () => '测试角色', lastCharGid: 42, lastCharName: '测试角色',
    zRunning: false, npBattleState: () => false,
    npRequestBattle: (w) => { cancels.push('np' + w); return 'sent'; },
    stopZhu: () => { stops++; }, deathReturnCancel: (r) => { cancels.push(r); },
    masterTickReg: (fn) => { ctx.tick = fn; },
    CLIENT: { SS: { Entity: { GID: 42, isDeath: false, life: { hp: 100, hp_max: 100 }, ACTION: { DIE: 9 }, action: 0 } },
      PS: { CZ: { RESTART: function () { this.type = 0; } } }, NM: { sendPacket: (p) => packets.push(p.type) } },
    __guard: true, __charlist: false, __prompt: false, escapes: 0, cancelClicks: 0, okClicks: 0,
    document: { getElementById: (id) => {
      if (id === 'Escape') return { shadowRoot: { querySelector: () => ({ click: () => { ctx.escapes++; } }) } };
      if (id === 'CharSelectV4' && ctx.__charlist) return { shadowRoot: { querySelector: (s) => (s === '.btn.cancel' ? cancelBtn : null) } };
      if (id === 'WinPrompt' && ctx.__prompt) return { shadowRoot: { querySelectorAll: () => [promptOk] } };
      return null;
    } },
  };
  vm.createContext(ctx); vm.runInContext(gsrc, ctx);
  const live = () => { ctx.CLIENT.SS.Entity.isDeath = false; clock += 1000; ctx.deathGuardTick(); };
  const die = () => { ctx.CLIENT.SS.Entity.isDeath = true; clock += 1000; ctx.deathGuardTick(); };
  ctx.zRunning = false;
  for (let i = 0; i < 3; i++) { live(); die(); }
  assert.equal(stops, 0, '手动玩（助手没跑、内挂没开）时不得自动下线');
  assert.equal(ctx.deathGuardAt.length, 0, '手动玩不计数');
  ctx.zRunning = true;
  for (let i = 0; i < 3; i++) { live(); die(); }
  assert.equal(stops, 1, '助手在跑时 5 分钟 3 次死亡必须停助手');
  assert.equal(cancels.indexOf('连续死亡自动下线') >= 0, true, '必须取消死亡回图布防');
  assert.equal(ctx.escapes >= 1, true, '必须点真实按钮「选择角色」（不裸发包）');
  assert.equal(JSON.stringify(packets), '[]', 'ESC 窗口能点时不得发包');
  assert.equal(ctx.deathGuardRun.phase, 'charselect');
  ctx.deathGuardTick();
  assert.equal(ctx.deathGuardRun.phase, 'charselect', '角色选择界面还没出来时不得乱点');
  ctx.__charlist = true; clock += 500; ctx.deathGuardTick();
  assert.equal(ctx.cancelClicks, 1, '角色选择界面出现后必须点「取消」');
  assert.equal(ctx.deathGuardRun.phase, 'cancel');
  ctx.__prompt = true; clock += 500; ctx.deathGuardTick();
  assert.equal(ctx.okClicks, 1, '确认框必须点 ok（真正下线）');
  assert.equal(ctx.deathGuardDone, true, '走完必须锁定，不得重复下线');
  assert.ok(notes.join('|').includes('已自动下线'), '必须有一次下线通知');
  // 5 分钟窗口外的旧死亡不计数
  ctx.deathGuardAt = [clock - 400000, clock - 350000]; stops = 0; statuses = []; ctx.deathGuardDone = false;
  live(); die();
  assert.equal(stops, 0, '窗口外的旧死亡不得算进阈值');
  assert.equal(ctx.deathGuardAt.length, 1, '过窗记录必须被清掉');
  // 下线走不完 → 提示手动，且不误标完成
  ctx.deathGuardDone = false; ctx.deathGuardRun = null; ctx.deathGuardAt = []; ctx.__charlist = false; ctx.__prompt = false; statuses = [];
  for (let i = 0; i < 3; i++) { live(); die(); }
  for (let i = 0; i < 3; i++) { clock += 9000; ctx.deathGuardTick(); }
  assert.equal(ctx.deathGuardDone, false, '走不完不得标成已下线');
  assert.equal(statuses.join('|').includes('请手动下线'), true, '走不完必须提示手动下线');
  assert.equal(JSON.stringify([]), '[]');
});

test('V2.36.15 战斗提示横条可拖动 + 战斗监控横条默认关闭 + 怪物距离只保留整数', () => {
  // 1) 战斗提示横条：可拖动 + 位置持久化 + 不再 pointer-events:none
  const tip = expExtract('  function ensureZTip() {', '  function renderZTip() {');
  assert.ok(tip.includes('dragEl(zTipEl'), '战斗提示横条必须绑定拖动');
  assert.ok(tip.includes('dsh_ztip_pos'), '拖动后位置必须持久化');
  assert.ok(tip.includes('localStorage.setItem("dsh_ztip_pos"'), '松手要写回位置');
  assert.ok(tip.includes('cursor:move'), '横条要显示可拖动光标');
  assert.ok(!tip.includes('pointer-events:none'), '提示横条不能再是 pointer-events:none（否则拖不动）');
  assert.ok(tip.includes('isolateEl(zTipEl)'), '拖动的横条仍必须做事件隔离，不能把点击漏给游戏');
  assert.ok(extract('  function ensureZTip() {', '  function renderZTip() {').includes('dragEl(zTipEl'), '稳定版必须同步');
  // 2) 战斗监控横条默认关闭（表里 defOff；ztip 不受影响）
  const mods = expExtract('  var RO_MODULES = [', '  ];');
  const zhudRow = mods.split('\n').find((l) => l.includes('id: "zhud"'));
  assert.ok(zhudRow.includes('defOff: true'), '战斗监控横条必须 defOff（默认关闭）');
  const ztipRow = mods.split('\n').find((l) => l.includes('id: "ztip"'));
  assert.ok(!ztipRow.includes('defOff'), '战斗提示横条仍按原样（只改可拖动）');
  assert.ok(source.includes('{ id: "zhud",  name: "战斗监控横条",    kind: "custom", defOff: true, sec: "提示" }'), '稳定版必须同步');
  // 3) 距离取整：helper + 各处显示点
  for (const [name, s] of [['stable', source], ['exp', expSource]]) {
    assert.ok(s.includes('function distInt(v) {'), name + ' 必须有 distInt 取整 helper');
    assert.ok(s.includes('? distInt(mm.dist) + "m"'), name + ' 回退列表距离要取整');
    assert.ok(s.includes('? distInt(m.dist) + "m"'), name + ' 附近怪物列表距离要取整');
    assert.ok(s.includes('+ distInt(b.dist) + " 格"'), name + ' 首领警报距离要取整');
    assert.ok(s.includes('"锁定怪距" + distInt(nearD)'), name + ' 混合寻怪提示距离要取整');
    assert.ok(!/Math\.round\(Math\.sqrt\([^;]*\* 10\) \/ 10/.test(s), name + ' 当前目标窗不得再四舍五入到 0.1m');
    assert.ok(s.includes('dist = Math.floor(Math.sqrt('), name + ' 当前目标窗距离必须向下取整');
  }
  const zhud = expExtract('  function renderZMonitor() {', '  // ================= V2.23.0');
  assert.ok(zhud.includes('var dTxt = distIntTxt(zLock.dist);'), '战斗监控横条的距离必须走取整 helper');
  assert.ok(zhud.includes('" [" + dTxt + "格]"'), '战斗监控横条要显示取整后的格数');
  // 4) vm 实跑：默认关闭语义 + 取整行为
  let modCtx = {
    Number, String, isFinite, JSON, console,
    RO_MOD_KEY: 'dsh_ro_modules_v1', roModC: null,
    RO_MODULES: [{ id: 'zhud', defOff: true }, { id: 'boss', defOff: true }, { id: 'ztip' }],
    localStorage: { getItem: () => null, setItem: () => {} },
    roMenuRender: () => {},
  };
  vm.createContext(modCtx);
  vm.runInContext(expExtract('  function roMods() {', '  function roModPage(id) {'), modCtx);
  assert.equal(modCtx.roModOn('zhud'), false, '没存过状态时战斗监控横条必须默认关');
  assert.equal(modCtx.roModOn('ztip'), true, '战斗提示横条默认仍开');
  modCtx.roMods().zhud = true;
  assert.equal(modCtx.roModOn('zhud'), true, '手动开启后要生效（默认值不覆盖用户设置）');
  const dCtx = { Number, String, isFinite, Math };
  vm.createContext(dCtx);
  vm.runInContext(expExtract('  function distInt(v) {', '  function renderZMonitor() {'), dCtx);
  assert.equal(dCtx.distInt(12.7), 12, '12.7 格必须显示 12');
  assert.equal(dCtx.distInt(3.999), 3, '3.999 必须显示 3');
  assert.equal(dCtx.distInt(8), 8, '整数不变');
  assert.equal(dCtx.distIntTxt(1e9), null, '未知距离（1e9）不得显示成天文数字');
  assert.equal(dCtx.distIntTxt(null), null, '空距离不显示');
  assert.equal(dCtx.distIntTxt(5.4), 5, '5.4 格必须显示 5');
});

test('V2.36.16 加载期空安全：内挂「开自动吃药」按钮回归 + 全部绑定走 onId + 引用的 id 必须在标记里', () => {
  // 1) 内挂页必须有「开自动吃药」按钮（V2.36.13 误删后加载期取到 null，整个脚本中断）
  for (const [name, s] of [['stable', source], ['exp', expSource]]) {
    assert.ok(s.includes('id="dsh-np-eat"'), name + ' 内挂页必须存在「开自动吃药」按钮');
    assert.ok(s.includes('onId("dsh-np-eat", "click"'), name + ' 「开自动吃药」必须绑定到发包逻辑');
  }
  // 2) 不得再出现裸 $id(...).addEventListener（加载期 null 会中断该行之后的全部代码）
  for (const [name, s] of [['stable', source], ['exp', expSource]]) {
    assert.equal((s.match(/\$id\("[^"]+"\)\.addEventListener\(/g) || []).length, 0, name + ' 不得再有裸 $id(...).addEventListener 绑定');
    assert.ok(s.includes('function onId(id, ev, fn, opt) {'), name + ' 必须有空安全绑定 helper onId');
    assert.ok(s.includes('[RO助手] 绑定跳过'), name + ' 缺元素时必须留一行控制台警告');
  }
  // 3) onId 引用的每个 id 都必须在标记里存在（旧辅助页遗留、已带 if 守卫的除外）
  const legacy = new Set(['dsh-peten', 'dsh-petfeednow']);
  for (const [name, s] of [['stable', source], ['exp', expSource]]) {
    const markup = new Set(); { const re = /id="([^"]+)"/g; let m; while ((m = re.exec(s))) markup.add(m[1]); }
    const used = new Set(); { const re = /onId\("([^"]+)",/g; let m; while ((m = re.exec(s))) used.add(m[1]); }
    const missing = [...used].filter((x) => !markup.has(x) && !legacy.has(x));
    assert.deepEqual(missing, [], name + ' onId 引用了标记里不存在的 id: ' + missing.join(','));
  }
  // 4) vm 实跑：缺元素只跳过绑定并返回 null，有元素时正常绑定
  const ctx = { document: { getElementById: () => null }, console: { warn: () => {} } };
  vm.createContext(ctx);
  vm.runInContext(expExtract('  // ---------------- 工具 ----------------', '  // 通用拖拽排序'), ctx);
  assert.equal(ctx.onId('dsh-不存在', 'click', () => {}), null, '缺元素必须返回 null 而不是抛错');
  let hit = 0;
  const fake = { addEventListener: () => { hit++; } };
  ctx.document.getElementById = () => fake;
  assert.equal(ctx.onId('dsh-x', 'click', () => {}), fake, '有元素时必须返回该元素');
  assert.equal(hit, 1, '有元素时必须真的调用 addEventListener');
});
