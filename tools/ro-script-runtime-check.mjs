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
    assert.ok(src.includes('new (czp("RESTART"))()'),'助手必须经能力探测后的构造器点「重新开始」回寄存点');
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
      sendSit:x=>{sits.push(x);ent.action=x?2:0;},isSitting:()=>ent.action===2,isWinOpen:()=>false,gptTeleport:x=>{teleports.push(x);return true},setStatus(){},czp:name=>context.CLIENT.PS.CZ[name],deathGuardRun:null,deathGuardDone:false,masterTickReg(fn){context.tick=fn}};
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
    dpsOnDamage(){dpsCalls++},window:{},requireDB:n=>n==='Engine/MapEngine/Entity'?()=>packets.forEach(p=>nm.hookPacket(p,()=>{gameCalls++})):null};
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
  const castCode=extract('  function castOrderSkill(order, target) {','  // V2.38.0 包体自检按钮');
  const now=Date.now(),sent=[];const ctx={Date,Math,CLIENT:{SS:{Entity:{GID:1,position:[0,0]}},PS:{CZ:{USE_SKILL:function(){}}},NM:{sendPacket:p=>sent.push(p)}},zCastIdx:0,zUseCounts:{},zLockCounts:{},skillNextAt:{10:now+250},zSkillSentAt:{},zLastCastAt:0,zLastCastSkid:0,btDiagOn:false,
    ordinaryCastBlocked:()=>false,clampSkillLv:()=>1,dshCastSkip(){},tlog(){},$id:()=>({checked:false}),skillReq:()=>null,skillTypeBits:()=>0,getSkillRange:()=>9,dshCastMark(){},skillCdMs:()=>250,dshDiag(){},checkSkillCond:()=>({ok:true}),castStatusPrep:()=>false,czp:name=>ctx.CLIENT.PS.CZ[name]};
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
  assert.ok(!source.includes('o.skid === 267 ? realLv : req[2]'), '弹指(267) 不得再按实际技能等级吃球（V2.38.4 收口：一律用需求表 267=1 颗）');
  assert.ok(source.includes('var sphereNeed = req[2];'), '弹指耗球必须一律取释放需求表的值');
  assert.ok(source.includes('buffStateOn(86)'));
  assert.ok(source.includes('[267, "MO_FINGEROFFENSIVE", 1, null]'));
  assert.ok(!source.includes('document.querySelector(".startButton")'));
  assert.ok(source.includes('return npIsThree() ? npSendWhisper("NPC:setautoattack") : npSendUpdate(34, 1)'));
  assert.ok(!/spheres\s*>=\s*5[\s\S]{0,120}(爆气|270)/.test(source));
});

test('spirit packets cache only the current character',()=>{
  const code=extract('  function onSelfSpirits(bytes, frameOff, lenTblOk) {','  // V2.15.24：拦截服务器下发的技能真实后摇');
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
    normMapKey:x=>x,getMapName:()=> 'field',isSitting:()=>sitting,sendSit:down=>sent.push({action:down?'sit':'stand'}),setStatus(){},tlog(){},lockAct(act,ms){ctx.actLock={act,until:now+ms};return true},czp:name=>ctx.CLIENT.PS.CZ[name],
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
  const meta=source.match(/^\/\/\s*@version\s+(\S+)/m)?.[1], runtime=source.match(/var VER = "([^"]+)"/)?.[1];
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
  assert.ok(expSource.includes('id="dsh-z-bossignorelock" type="checkbox">优先攻击忽略攻击名单'));
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
  assert.deepEqual(Array.from(ctx.bySec['常用']), ['gear', 'menu', 'tp', 'np', 'zhu', 'scr']);
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
  for (const id of ['dsh-wllist', 'dsh-wlcount', 'dsh-fw-btn-bagclean', 'dsh-picken', 'dsh-pickwalk', 'dsh-picksafe', 'dsh-pickmap', 'dsh-pickmapbtn']) assert.ok((anc[id] || '').includes('dsh-fw-item'), id + ' 应在 #dsh-fw-item');
  assert.equal(anc['dsh-bag-clean'], undefined, 'V2.38.2：丢弃名单容器必须移出物品页');
  const bagHost = expSource.slice(expSource.indexOf('function bagCleanEnsureHost(){'), expSource.indexOf('function bagCleanInit(){'));
  assert.ok(bagHost.includes("h.id='dsh-fw-bagclean'") && bagHost.includes('id="dsh-bag-clean"'), 'V2.38.2：丢弃名单必须落在独立浮窗 #dsh-fw-bagclean 内');
  assert.ok(bagHost.indexOf('dsh-fw-bagclean') < bagHost.indexOf('id="dsh-bag-clean"'), 'V2.38.2：容器顺序必须是浮窗在外、名单在内');
  assert.ok(expSource.includes('fwReg("bagclean", "自动丢弃", bagCleanEnsureHost)'), 'V2.38.2：自动丢弃必须注册成标准浮窗');
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
  const hv = /^\/\/\s*@version\s+(\S+)/m.exec(expSource)?.[1];
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
  assert.ok(expSource.includes('if (!target && zLock.gid && !zLockBossSkip) {'), '临时目标未命中时才校验原锁定目标，且尾刀跳过仍生效');
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
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.5', name + ' @version 必须是 2.38.5（锚定行首元数据行）');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.5', name + ' 运行时常量 VER 必须是 2.38.5');
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
    assert.equal((attackSeg.match(/zBossAllowedByLock\(/g) || []).length, 0, name + ' zAttack 不得再次拦截 zBossDecide 已批准的忽略名单目标');
    // zBossDecide 段内无 zLock.gid/sendLockInject：门必须早于产出 want/skip（本函数内「产出」点）
    const decideGate = decideSeg.indexOf('zBossAllowedByLock(');
    assert.ok(decideGate >= 0 && decideGate < decideSeg.indexOf('out.want') && decideGate < decideSeg.indexOf('out.skip'), name + ' zBossDecide 名单门必须在产出 want/skip 之前');
    // zAttack 直接消费 zBossDecide 的 want；否则会把复选框已批准的名单外 BOSS 再次拦掉。
    const gidAt = attackSeg.indexOf('zLock.gid = bgid;'), injectAt = attackSeg.indexOf('sendLockInject(bgid);');
    assert.ok(gidAt >= 0 && injectAt > gidAt, name + ' zAttack 必须写锁并注入已批准的 BOSS');
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
    assert.ok(src.includes('优先攻击忽略攻击名单'), name + ' BOSS 模式必须提供逐角色忽略名单开关');
    assert.ok(src.includes('瞬移/尾刀仍受名单限制'), name + ' 文案必须明确只有优先攻击可放宽');
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
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.5', name + ' @version 必须是 2.38.5（锚定行首元数据行）');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.5', name + ' 运行时常量 VER 必须是 2.38.5');
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

function battleVm(){let now=0,id=1;const timers=new Map(),packets=[];const code=extract('  function npBattleState() {','  onId("dsh-battleon",');const ctx={Math,Date:{now:()=>now},npBattleKnown:false,npHuntOn:false,npBattleLastSentAt:-Infinity,npBattleConfirmedAt:0,npBattleCandidate:null,npBattleExplicit:null,npBattleExplicitTimer:null,npZeroVerifyTimer:null,setTimeout(fn,ms){const n=id++;timers.set(n,{fn,at:now+ms});return n},clearTimeout(n){timers.delete(n)},npToggleHunt(){packets.push(ctx.want);return ctx.send!==false},npSyncBattleCheckbox(){},tlog(){}};vm.createContext(ctx);vm.runInContext(code+';this.req=npRequestBattle;this.reset=npResetBattleState',ctx);return{ctx,packets,req(w,s,i){ctx.want=w;return ctx.req(w,s,i)},tick(ms){now+=ms;for(const[n,t]of[...timers])if(t.at<=now){timers.delete(n);t.fn()}},pending:()=>timers.size}}
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

test('V2.38.2 bagClean 类别名一律用中文安全表，不再依赖 DB/Items/ItemType',()=>{
  const h=bagCleanVm({}, {Healing:0,Material:3}),names=h.ctx.typeNames();
  assert.equal(names[0],'治疗');assert.equal(names[3],'材料');assert.equal(names[2],'消耗');assert.equal(names[10],'箭矢');assert.equal(names[11],'技能消耗');
  assert.equal(names[99],undefined,'未登记类型不得冒出英文名');
  const src=extract("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'",'  function bagCleanUnitWeight(id)');
  assert.ok(!src.includes("requireDB('DB/Items/ItemType')")&&!src.includes('requireDB("DB/Items/ItemType")'),'类别名不再读客户端 ItemType 模块');
});

test('V2.38.2 bagClean 未登记/冲突类型不做类别规则，只认显式名单',()=>{
  const h=bagCleanVm(),names=h.ctx.typeNames(),cfg=n=>({discardRules:{},categoryTypes:[n],protectedIds:[]});
  assert.equal(h.ctx.describe({ITID:501,index:1,type:99,count:2},cfg(99),names).ok,false,'类型 99 未登记 → 保护');
  [4,5,8,12,18].forEach(type=>assert.equal(h.ctx.describe({ITID:501,index:1,type:type,count:2},cfg(type),names).ok,false,'冲突类型 '+type+' 不得批量可丢'));
  assert.equal(h.ctx.describe({ITID:501,index:1,type:3,count:2},cfg(3),names).ok,true,'材料 3 属安全类型 → 类别可丢');
  assert.equal(h.ctx.describe({ITID:501,index:1,type:4,count:1},{discardRules:{'501':0},categoryTypes:[],protectedIds:[]},names).ok,false,'装备即使显式列入也必须过装备保护');
});

test('bagClean blacklist keeps configured quantity and category is union fallback',()=>{
  const h=bagCleanVm(),names=h.ctx.typeNames(),explicit={discardRules:{'501':3},categoryTypes:[],protectedIds:[]},category={discardRules:{},categoryTypes:[3],protectedIds:[]};
  const a=h.ctx.describe({ITID:501,index:1,type:3,count:8},explicit,names),b=h.ctx.describe({ITID:502,index:2,type:3,count:8},category,names);
  assert.equal(a.ok,true);assert.equal(a.keep,3);assert.equal(a.source,'丢弃名单');assert.equal(b.ok,true);assert.equal(b.keep,0);assert.match(b.source,/类别/);
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
    assert.ok(preview.includes('bagCleanRevalidate(s,s.amount)'),name+' preview must reread each index');assert.ok(execute.includes('d.amount!==stack.amount'),name+' quantity must match when captured');assert.ok(execute.includes('d.id!==stack.id'));assert.ok(execute.includes('d.type!==stack.type'));assert.ok(execute.includes('d.source!==stack.source'));assert.ok(execute.indexOf('bagCleanRevalidate(stack,want)')<execute.indexOf('new (czp("ITEM_THROW"))()'));
  }
});

test('bagClean rule changes disarm automation and initial automatic enable requires preview arming',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));
    assert.ok(ui.includes("function changed(msg){bagCleanDisarm("),name+' changes must disarm');assert.ok(ui.includes("if(!bagClean.config.armed){this.checked=false"),name+' enable must require armed');assert.ok(ui.includes('bagClean.config.armed=true'),name+' preview confirmation must arm');assert.ok(ui.includes('这是不可逆操作，确认执行？'),name+' manual cleanup needs detailed confirmation');
  }
});

test('bagClean v2 UI and storage contract is lockstep and documents unsupported boss-source filtering',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){assert.ok(src.includes("'dsh-bag-clean-v2'"));assert.ok(src.includes("'dsh-bag-clean-rules-v1'"));assert.ok(src.includes('丢弃黑名单（勾选=要丢'));assert.ok(src.includes('类别保护例外（永不丢）'));assert.ok(src.includes('协议不含掉落怪来源，无法安全区分BOSS掉落，故不提供该规则。'));assert.ok(src.includes('导出名单'));const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));assert.ok(ui.includes('Object.keys(BAG_SAFE_TYPES).map(Number)'),name+' UI must enumerate only safe types');assert.ok(ui.includes("ch.setAttribute('data-type',String(type))"),name+' UI category checkbox needs safe type marker');assert.ok(!ui.includes('presentTypes'),name+' UI must not derive category choices from runtime type 99');assert.ok(!ui.includes('data-type=99'),name+' UI must not generate data-type=99');}
  const a=source.slice(source.indexOf('  // ---------------- 背包安全清理 v2'),source.indexOf('  // ---------------- 拾取页：内挂百分比联动')).replace(/\r\n/g,'\n');
  const b=expSource.slice(expSource.indexOf('  // ---------------- 背包安全清理 v2'),expSource.indexOf('  // ---------------- 拾取页：内挂百分比联动')).replace(/\r\n/g,'\n');assert.equal(a,b);
});


// ================= V2.38.2 定点修复：随时丢弃（anytime）开启时零候选走正常收尾 =================
// 口径：anytime 开 = 不看负重与空格，于是外层 500ms 轮询每拍都会进 bagCleanExecute；
//       零候选时旧代码 throw bagCleanShortage → 「背包清理暂停」错误态被反复刷到状态栏。
//       本组用例锁死：自动+随时丢弃：正常 idle 收尾；阈值模式/手动/预览的原因清单不被削弱。
function bagCleanExecVm(cfg){
  const code=extract("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'",'  function bagCleanUnitWeight(id)')
    +extract('  function bagCleanRows(inv,cfg){','  async function bagCleanExecute(done,manual){')
    +extract('  async function bagCleanExecute(done,manual){','  function bagCleanPreview(){');
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},
    CLIENT:{SS:{Entity:{GID:42}},PS:{CZ:{}},NM:{sendPacket(){}}},requireDB:()=>null,getMapName:()=> 'prontera',czp:()=>function(){},bagCleanUnitWeight:()=>null};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  ctx.bagClean.config=Object.assign({version:2,discardRules:{},categoryTypes:[],protectedIds:[],armed:true,enabled:true,anytime:false},cfg);
  ctx.bagClean.enabled=ctx.bagClean.config.enabled===true;
  ctx.bagClean.status={textContent:''};ctx.bagClean.detail={textContent:''};
  return ctx;
}
test('V2.38.2 定点修复：随时丢弃开启时零候选不抛错（阈值模式与手动仍保留原因清单）',async()=>{
  const one=[{ITID:501,index:1,type:3,count:1}]; // 背包可读、但名单与类别都为空，即零候选
  const on=bagCleanExecVm({anytime:true});on.bagCleanInventory=()=>one;let doneOn=0;
  await on.bagCleanExecute(()=>{doneOn++;},null);
  assert.equal(on.bagClean.error,'','anytime 开启时零候选不得产生错误态');
  assert.equal(on.bagClean.pending,false,'正常收尾必须清掉 pending');
  assert.equal(on.bagClean.detail.textContent,'随时丢弃待命：当前没有可丢候选');
  assert.equal(doneOn,1,'正常收尾仍要回调 done');
  const noInv=bagCleanExecVm({anytime:true});noInv.bagCleanInventory=()=>null;
  await noInv.bagCleanExecute(()=>{},null);
  assert.equal(noInv.bagClean.error,'','anytime 开启时读不到背包也不得反复刷错误态');
  assert.match(noInv.bagClean.detail.textContent,/^随时丢弃待命：/);
  const off=bagCleanExecVm({anytime:false});off.bagCleanInventory=()=>one;off.bagCleanWeight=()=>80;
  await off.bagCleanExecute(()=>{},null);
  assert.match(off.bagClean.error,/^背包清理暂停：/,'阈值模式必须继续告诉用户为什么没丢');
  assert.match(off.bagClean.error,/当前没有可丢候选/);
  const manual=bagCleanExecVm({anytime:false});manual.bagCleanInventory=()=>one;
  await manual.bagCleanExecute(()=>{},{});
  assert.equal(manual.bagClean.error,'','手动「立即清理」零候选仍是原有 break 收尾');
  assert.equal(manual.bagClean.detail.textContent,'清理完成');
  assert.ok(source.includes("throw Error(bagCleanShortage(inv))"),'阈值模式仍须用 bagCleanShortage 说明原因');
  assert.ok(source.includes('bagCleanSay(bagCleanShortage(inv))'),'预览路径仍须保留 bagCleanShortage 原因清单');
});

// ================= V2.35.1 assistant API + standalone dojo =================
const splitSources=[['stable',source],['exp',expSource]];
test('V2.35.1 assistant removes challenge and keeps arrow rules plus API lockstep',()=>{for(const[name,s]of splitSources){assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(s)?.[1],'2.38.5',name+' @version 必须锚定行首元数据行（旧的非锚定正则可能命中变更日志/正文里的 @version 字样）');assert.equal((s.match(/dsh-ro-challenge-v1/g)||[]).length,1,name+' keeps only one non-destructive arrow migration read');assert.ok(!/function challenge|challengeOwnsCombat|challengeStop/.test(s),name+' challenge automation removed');assert.ok(s.includes('dsh-ro-arrow-rules-v1'));assert.ok(s.includes('function arrowDecision('));assert.ok(s.includes('fwReg("arrowrules", "换箭设置", arrowEnsureHost)'));assert.ok(s.includes('window.__DSH_RO_ASSIST_API__'));assert.ok(s.includes('externalAutomationOwns("arrow") || arrowTarget'));assert.ok(s.includes('externalAutomationOwns("battle")'));}});
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
      dojoApi:()=>apiMissing?null:{ready:()=>true,acquire:(o,sc)=>{calls.push(['acquire',o,sc.join('+')]);return startOk?{ok:true}:{ok:false,error:'owned'};},clearBattleTarget:o=>calls.push(['clearBattle',o]),clearArrowTarget:o=>calls.push(['clear',o]),release:o=>calls.push(['release',o])},
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
    const a={snapshot:()=>snap,setBattleTarget:(o,t)=>calls.push(['setBattleTarget',t.mid,t.gid]),clearBattleTarget:()=>calls.push(['clearBattleTarget']),setArrowTarget:()=>{calls.push(['setArrow']);return{ok:true};},requestBattle:(o,on)=>{calls.push(['battle',on]);},clearArrowTarget:()=>calls.push(['clearArrow']),contactNpc:()=>calls.push(['contact']),walkTo:()=>calls.push(['walk']),requestFly:()=>calls.push(['fly']),chooseMenu:()=>calls.push(['choose'])};
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
test('V2.36.13/17 攻击名单怪物搜索：整行点选加入 + 跳转（游戏内世界地图魔物搜索）/小册子两个入口',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('function renderLockHits(kw)'),name+' 搜索结果渲染');
  assert.ok(s.includes('data-lockadd='),name+' 整行可点加入名单');
  assert.ok(s.includes('data-mobgoto='),name+' 行尾跳转入口');
  assert.ok(s.includes('requireDB("UI/Components/WorldMap/WorldMap")'),name+' 跳转必须用客户端世界地图组件');
  assert.ok(s.includes('WM.selectMob('),name+' 直接调用客户端自己的魔物搜索（不是自己造协议）');
  assert.ok(!s.includes('requireDB("UI/Components/Navigation")'),name+' 客户端里不存在的 Navigation 模块不得再被 require');
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
    arrowPickSay: () => '换箭', ARROW_PLAIN_ITID: 1750, mobElemName: () => '',
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
  assert.ok(gsrc.includes('stopZhu()') && gsrc.includes('npZeroBattle("death-guard")'), '下线前必须停助手并关内挂（统一走 npZeroBattle）');
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

test('V2.36.17 「跳转」改走客户端世界地图（select + selectMob）：中文名命中/精灵名兜底/ID 兜底/老客户端搜索框/窗口缺失', () => {
  for (const [name, s] of [['stable', source], ['exp', expSource]]) {
    assert.ok(s.includes('requireDB("UI/Components/WorldMap/WorldMap")'), name + ' 跳转必须用客户端世界地图组件');
    assert.ok(s.includes('WM.select()'), name + ' 必须用客户端自己的 select() 打开世界地图');
    assert.ok(s.includes('WM.selectMob('), name + ' 必须调用客户端自己的魔物搜索');
    assert.ok(s.includes('selectMob(String(mid))'), name + ' 名字搜不到要按怪物 ID 兜底');
    assert.ok(!s.includes('requireDB("UI/Components/Navigation")'), name + ' 客户端里不存在的 Navigation 模块不得再被 require');
    assert.ok(s.includes('已打开游戏内搜索：魔物 · '), name + ' 成功时状态栏要说明打开了哪一页');
  }
  const code = extract('  function mobGotoSearch(mid, name) {', '  // 「跳转」按钮全局委托');
  const status = [];
  const build = (opts) => {
    const calls = [];
    let kw = '', hits = 0;
    const ui = { parent: () => ({ length: 1 }), find(sel) {
      if (sel.indexOf('mobtitle') >= 0) return { length: hits };
      if (sel.indexOf('.msg') >= 0) return { length: 1, val(v) { if (v === undefined) return kw; kw = v; } };
      if (sel.indexOf('search_btn') >= 0) return { length: opts.withBtn ? 1 : 0, trigger() { calls.push('btn'); } };
      if (sel.indexOf('.stype') >= 0) return { length: 1, val(v) { calls.push('stype:' + v); } };
      return { length: 0 };
    } };
    const WM = { ui, select() { calls.push('select'); } };
    if (!opts.noSelectMob) WM.selectMob = function (n) { calls.push('mob:' + n); kw = n; hits = (opts.hitFor || []).indexOf(n) >= 0 ? 2 : 0; };
    const ctx = {
      requireDB: (n) => (n === 'UI/Components/WorldMap/WorldMap' ? (opts.noWindow ? null : WM) : null),
      getMobDb: () => ({ '1002': { kName: '火焰龟', name: 'FLAME_TURTLE' } }),
      setStatus: (m) => status.push(m),
      document: { getElementById: () => ({ style: {} }) },
    };
    vm.createContext(ctx); vm.runInContext(code + ';this.mobGoto=mobGotoSearch', ctx);
    return { ctx, calls };
  };
  status.length = 0;
  // 1) 中文名命中：开窗口 + 搜魔物，状态栏如实说明
  let r = build({ hitFor: ['火焰龟'] });
  assert.equal(r.ctx.mobGoto(1002, ''), true);
  assert.deepEqual(r.calls, ['select', 'mob:火焰龟']);
  assert.ok(status[0].indexOf('已打开游戏内搜索：魔物 · 火焰龟') >= 0, '命中时状态=' + status[0]);
  // 2) 中文名没命中 → 用精灵名再搜一次
  r = build({ hitFor: ['FLAME_TURTLE'] });
  r.ctx.mobGoto(1002, '');
  assert.deepEqual(r.calls, ['select', 'mob:火焰龟', 'mob:FLAME_TURTLE']);
  // 3) 两个名字都没命中 → 按怪物 ID 搜（必定命中那一只）
  r = build({ hitFor: ['1002'] });
  r.ctx.mobGoto(1002, '');
  assert.deepEqual(r.calls, ['select', 'mob:火焰龟', 'mob:FLAME_TURTLE', 'mob:1002']);
  assert.ok(status[status.length - 1].indexOf('魔物 · 1002') >= 0, 'ID 兜底状态=' + status[status.length - 1]);
  // 4) 老客户端没有 selectMob → 按客户端自己的搜索框走（切「魔物」+ 填词 + 点搜索）
  r = build({ noSelectMob: true, withBtn: true });
  r.ctx.mobGoto(1002, '');
  assert.ok(r.calls.indexOf('select') >= 0, '仍要先开窗口');
  assert.ok(r.calls.indexOf('stype:0') >= 0, '必须切到「魔物」这一类');
  assert.ok(r.calls.indexOf('btn') >= 0, '必须触发客户端的搜索按钮');
  // 5) 客户端世界地图窗口不可用 → 如实报错、返回 false、不抛异常
  r = build({ noWindow: true });
  assert.equal(r.ctx.mobGoto(1002, ''), false);
  assert.ok(status[status.length - 1].indexOf('世界地图窗口不可用') >= 0, '缺失时状态=' + status[status.length - 1]);
});

test('V2.37.1 「一键换装 · 卡册」挂在菜单首页第一行且只发可逆包',()=>{
  const g = source.indexOf('{ id: "gear"'), m = source.indexOf('{ id: "menu"');
  assert.ok(g > 0, '必须登记 gear 模块');
  assert.match(source.slice(g, g + 120), /name: "\u4e00\u952e\u6362\u88c5 \u00b7 \u5361\u518c"/);
  assert.ok(g < m, 'gear 必须在 menu 之前（菜单首页第一行）');
  assert.ok(source.includes('fwReg("gear", "\u4e00\u952e\u6362\u88c5 \u00b7 \u5361\u518c", gearEnsureHost)'), '必须登记浮窗宿主');
  // 存储：逐角色档案 + 存回 profiles（进而进 8899 KV 中继）
  assert.ok(source.includes('p.gearSets'), '预设必须落在角色档案 p.gearSets');
  assert.ok(source.includes('var GEAR_HK_PRE = "gearpreset:"'), '预设快捷键 id 前缀');
  assert.ok(source.includes('hkBeginSet(GEAR_HK_PRE + ps.id)'), '每套预设要能单独设键');
  assert.ok(source.includes('id.indexOf(GEAR_HK_PRE) === 0'), 'hkAction 要能派发预设快捷键');
  assert.ok(source.includes('renderGearAll(); gearAskRecover(); } catch (e6) {}'), '换角色后要刷新该角色的换装预设');
  // 执行：只发客户端自己的穿/脱包与卡册加/减包
  assert.ok(source.includes('czp("REQ_TAKEOFF_EQUIP")'), '装备脱包必须走已探测构造器');
  assert.ok(source.includes('czp("REQ_WEAR_EQUIP")'), '装备穿包必须走已探测构造器');
  assert.ok(source.includes('czp("REQUEST_CARDCONNECTION_ADDMYDECK")'), '卡册加入卡组必须走构造器门面');
  assert.ok(source.includes('czp("REQUEST_CARDCONNECTION_CANCEL")'), '卡册移出卡组必须走构造器门面');
  assert.ok(!source.includes('CLIENT.PS.CZ.REQUEST_CARDCONNECTION_RECHARGE'), '红线：永不发卡册充能包（吃卡不可逆）');
  // buff 预设同层找回
  assert.ok(source.includes('dsh_ro_askrecover_v1'), 'buff 预设要有一次旧存档找回');
});
test('V2.37.1 换装读取/匹配（VM）',()=>{
  const code = extract('  var GEAR_HK_PRE = "gearpreset:";', '  // ---- 卡册（卡片典藏）读取');
  const saved = [];
  const inv = [
    { ITID: 1101, index: 5, WearState: 2, RefiningLevel: 7, slot: { card1: 4001, card2: 0, card3: 0, card4: 0 } },
    { ITID: 2301, index: 9, WearState: 16 },
    { ITID: 1101, index: 12, WearState: 0, RefiningLevel: 7, slot: { card1: 4001 } },
    { ITID: 1101, index: 13, WearState: 0, RefiningLevel: 0, slot: {} },
    { ITID: 1601, index: 20, WearState: 0 },
  ];
  const profiles = {};
  // V2.38.4-装备读取修复：Equipment 走 uiComp（StatusIcons.manager → UIManager.getComponent），
  //   槽位索引走 getRoot().querySelector(".槽位 .item[data-index]")，index→item 走 Inventory.getItemByIndex。
  const gdom = { querySelector: (sel) => { const q = String(sel); const idx = q.indexOf('.weapon ') >= 0 ? 5 : (q.indexOf('.armor ') >= 0 ? 9 : null); return idx == null ? null : { getAttribute: (a) => (a === 'data-index' ? String(idx) : null) }; } };
  const EQ = { name: 'Equipment', getRoot: () => gdom };
  const INV = { list: inv, getItemByIndex: (i) => inv.find((x) => x.index === i) || null };
  const ctx = {
    profiles, Date, Number, String, Array, Object, Math, JSON,
    activeProfileKey: () => '阿龟_12345',
    ensureProfile: (k) => { if (!profiles[k]) profiles[k] = { name: '阿龟', gid: 12345, askList: [] }; return profiles[k]; },
    saveProfiles: () => saved.push(1),
    findInventory: () => inv,
    clientReady: () => true,
    uiComp: (n) => (n === 'Equipment' ? EQ : (n === 'Inventory' ? INV : null)),
    requireDB: () => null,
    bagItemByIndex: (i) => INV.getItemByIndex(i),
    CLIENT: {},
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.G={gearData,gearPreset,gearSaveSets,gearReadEquipped,gearFindInvItem,gearSlotName,gearItid,gearRefine,gearOptions,gearEnchantGrade,gearCards,gearSigEqual};', ctx);
  const G = ctx.G;
  // 空档案 → 建结构；再取是同一个对象
  const d1 = G.gearData();
  assert.equal(JSON.stringify(d1), '{"list":[],"sel":""}');
  assert.ok(G.gearData() === d1, "gearData 每次必须返回同一个对象：" + JSON.stringify(ctx.profiles));
  // 脏数据防御：数组 → 重建成对象
  ctx.profiles['阿龟_12345'].gearSets = [1, 2];
  assert.equal(JSON.stringify(G.gearData()), '{"list":[],"sel":""}');
  // 预设读写
  const ps = { id: 'g1', name: '练级套', eq: {}, deck: [] };
  G.gearData().list.push(ps);
  assert.equal(G.gearPreset('g1'), ps);
  assert.equal(G.gearPreset('nope'), null);
  G.gearSaveSets();
  assert.equal(saved.length, 1, 'gearSaveSets 必须写回档案');
  // 读当前装备：按 WearState 位归类，精炼/插卡一并带上
  const cur = G.gearReadEquipped();
  assert.equal(cur.n, 2);
  assert.equal(JSON.stringify(cur.slots[2]), JSON.stringify({ itid: 1101, refine: 7, cards: [4001], options: [], enchantgrade: 0, idx: 5, name: 'ID 1101', wearLocation: 2, instanceKey: 'idx:5' }));
  assert.equal(JSON.stringify(cur.slots[16]), JSON.stringify({ itid: 2301, refine: 0, cards: [], options: [], enchantgrade: 0, idx: 9, name: 'ID 2301', wearLocation: 16, instanceKey: 'idx:9' }));
  assert.equal(cur.slots[64], undefined);
  // 背包匹配：必须在未穿的同 ID 里挑，优先精炼+插卡全同
  const cand = G.gearFindInvItem(1101, 7, [4001], {});
  assert.equal(cand.index, 12, '不能挑到身上那件，也不能挑不同精炼/插卡的');
  assert.equal(G.gearFindInvItem(1101, 0, [], {}).index, 13);
  assert.equal(G.gearFindInvItem(1601, 0, [], {}).index, 20);
  assert.equal(G.gearFindInvItem(9999, 0, [], {}), null);
  // 槽名 + 字段兜底（旧客户端用 itemid/refine/cards 数组）
  assert.equal(G.gearSlotName(32768), '\u7bad');
  assert.equal(G.gearSlotName(3), '\u69fd3');
  assert.equal(G.gearItid({ itemid: 501 }), 501);
  assert.equal(G.gearRefine({ refine: 4 }), 4);
  assert.equal(JSON.stringify(G.gearCards({ cards: [4001, 4002] })), '[4001,4002]');
  const opts=[null,{Index:11,Value:22,Param:33},null,{index:44,value:55,param:66}];
  assert.equal(JSON.stringify(G.gearOptions({Options:opts})), '[{"index":11,"value":22,"param":33},{"index":44,"value":55,"param":66}]');
  assert.equal(JSON.stringify(G.gearOptions({options:[{id:7,value:8,param:9},{id:0,value:0,param:0},{id:10,value:0,param:1}]})), '[{"index":7,"value":8,"param":9},{"index":10,"value":0,"param":1}]', '0 起始 options（{id,value,param}）必须能解析，空位跳过');
  assert.equal(JSON.stringify(G.gearOptions({options:{Index0:7,Value0:8,Param0:9}})), '[]', '虚构的 Index0/Value0/Param0 对象分支必须已删除（V2.38.4）');
  for (const k of ['enchantgrade','Enchantgrade','enchantGrade','EnchantGrade']) assert.equal(G.gearEnchantGrade({[k]:4}),4);
  const legacy={itid:1101,refine:7,cards:[4001]}, exact={...legacy,options:[{index:1,value:2,param:3}],enchantgrade:4};
  assert.equal(G.gearSigEqual(legacy,{...legacy,options:[{index:9,value:9,param:9}],enchantgrade:9}),true,'旧预设不要求新字段');
  assert.equal(G.gearSigEqual(exact,{...exact}),true);
  assert.equal(G.gearSigEqual(exact,{...exact,options:[{index:1,value:99,param:3}]}),false,'词条不同必须校验失败');
  assert.equal(G.gearSigEqual(exact,{...exact,enchantgrade:3}),false,'附魔等级不同必须校验失败');
});

test('V2.38.1 BOSS 忽略名单只放宽最终优先攻击（VM）',()=>{
  const code=extract('  function zBossAllowedByLock(mid)', '  // A6：早退点不冻结整拍');
  function run(act,checked,locked){
    const els={'dsh-z-bossact':{value:act},'dsh-z-bossignorelock':{checked},'dsh-z-bosshp':{value:'30'}};
    const ctx={lockList:locked?{'2001':1}:{'9999':1},scanMobs:[{GID:77,mid:2001,isBoss:true,dist:1,name:'B'}],lastMobs:[],$id:id=>els[id],gidInt:Number,zEntHpPct:()=>10,Object,String,Number,parseInt,isNaN,DS_BOSS_DIST:30};
    vm.createContext(ctx);vm.runInContext(code+';this.run=zBossDecide',ctx);return ctx.run(ctx.scanMobs);
  }
  assert.equal(run('优先攻击',false,false).want,0);
  assert.equal(run('优先攻击',true,false).want,77);
  assert.equal(run('等待残血补尾刀',true,false).want,0,'尾刀不可绕名单');
  assert.equal(run('瞬移',true,false).fly,false,'瞬移不可绕名单');
  assert.equal(run('瞬移',true,true).want,77,'已锁定瞬移仍转优先攻击');
});

test('V2.38.1 临时战斗目标严格验证、死亡清理与 ONLYTARGET 恢复（VM）',()=>{
  const code=extract('  function npSyncTargets() {', '  // 玩家真实操作内挂开关才更新本地态')+extract('  var API_PROTOCOL=1,', '  function apiContact(owner,gid)');
  const packets=[],entities=[],checks=[];let changeHandler=null;
  const em={forEach(fn){entities.forEach(fn);}};
  const ctx={zRunning:false,clientReady:()=>true,arrowPos:v=>{v=Number(v);return Number.isInteger(v)&&v>0?v:0;},lockList:{},npOnlyTarget:(mid,v)=>packets.push([Number(mid),v]),tlog(){},document:{querySelectorAll:()=>checks,addEventListener:(type,fn)=>{if(type==='change')changeHandler=fn;}},npBattleState:()=>false,npClearBattleIntent(){},npRequestBattle:()=> 'failed',moveXY:{},arrowTarget:null,arrowPending:null,arrowReady:false,arrowBlocked:false,apiEmit(){},bagClean:{busy:false},DOJO_OWNER:'builtin-dojo',CLIENT:{EM:em,PS:{CZ:{NOTIFY_ONLYTARGET:function(){}}}},window:{require:()=>em},getMobDb:()=>({2001:{MvpDropsNum:1},2002:{MvpDropsNum:1},3001:{MvpDropsNum:0}}),Number,String,Array,Object,Date,Math};
  const mob=(gid,mid,boss=true)=>({GID:gid,objecttype:5,_job:mid,position:[1,1],isDeath:false,ACTION:{DIE:9},action:0,display:{name:'M'},...(boss?{}:{})});
  vm.createContext(ctx);vm.runInContext(code+';this.A={acquire:apiAcquire,set:apiSetBattleTarget,clear:apiClearBattleTarget,tick:apiBattleTick,release:apiRelease,get:function(){return apiBattleTarget},lease:function(){return apiLease}}',ctx);
  assert.equal(ctx.A.acquire('owner-one',['battle']).ok,true);
  entities.push(mob(7,3001));
  assert.equal(ctx.A.set('owner-one',{mid:3001,gid:7}).error,'battle-target-not-live-boss');assert.deepEqual(packets,[],'普通怪非法 set 必须零发包');
  entities.length=0;entities.push(mob(77,2001));
  assert.equal(ctx.A.set('owner-one',{mid:2001,gid:77}).ok,true);assert.deepEqual(packets,[[2001,1]],'合法 BOSS 可设置');
  entities[0].isDeath=true;ctx.A.tick();assert.equal(ctx.A.get(),null);assert.deepEqual(packets.slice(-1),[[2001,0]],'下个 API tick 自动清死亡目标');
  ctx.A.release('owner-one');assert.equal(ctx.A.lease(),null,'runtime fixture 必须覆盖 apiRelease 依赖');

  packets.length=0;entities[0]=mob(88,2002);ctx.lockList={'1001':{name:'A'},'1002':{name:'B'}};
  const tempCheck={checked:true,getAttribute:k=>k==='data-id'?'2002':k==='data-name'?'Boss':null,closest:()=>true};checks.push(tempCheck);ctx.A.acquire('builtin-dojo',['battle']);
  assert.equal(ctx.A.set('builtin-dojo',{mid:2002,gid:88}).ok,true);
  assert.deepEqual(packets.filter(x=>x[0]===2002).at(-1),[2002,1],'DOM 历史清理后临时 BOSS 最终值必须为 1');
  assert.deepEqual(packets.filter(x=>x[0]===1001).at(-1),[1001,0]);assert.deepEqual(packets.filter(x=>x[0]===1002).at(-1),[1002,0],'其他永久 mid 必须压成 0');
  assert.equal(tempCheck.checked,true,'临时 BOSS DOM 必须保持勾选');assert.equal(ctx.lockList['2002'],undefined,'临时 BOSS 不得写入 lockList');
  changeHandler({target:tempCheck});assert.equal(tempCheck.checked,true);assert.equal(ctx.lockList['2002'],undefined,'临时 BOSS change 不得改 lockList');
  ctx.lockList={'1002':{name:'B'},'1003':{name:'C'}};ctx.A.clear('builtin-dojo');
  assert.equal(ctx.lockList['1002'].name,'B');assert.equal(ctx.lockList['1003'].name,'C','临时覆盖不得持久修改 lockList');
  assert.deepEqual(packets.filter(x=>x[0]===1002).at(-1),[1002,1]);assert.deepEqual(packets.filter(x=>x[0]===1003).at(-1),[1003,1],'clear 后当前 lockList 最终恢复 1');
});

test('V2.38.1 master 租约驱动 zAttack 且临时射程外不选普通目标（VM）',()=>{
  const drive=extract('  function apiBattleDrive(){','  function apiRelease(owner)');let now=1000,calls=0;
  const dc={Date:{now:()=>now},apiBattleAttackAt:0,zRunning:false,apiLease:{owner:'builtin-dojo',scopes:['battle'],battle:{state:'pending-on'}},apiBattleTarget:{owner:'builtin-dojo',mid:2,gid:8},apiBattleTargetEntity:()=>({gid:8}),zAttack:()=>calls++};
  vm.createContext(dc);vm.runInContext(drive+';this.run=apiBattleDrive',dc);dc.run();dc.run();assert.equal(calls,1);now=1250;dc.run();assert.equal(calls,2);dc.zRunning=true;now=1500;dc.run();assert.equal(calls,2);
  const atk=extract('  function zAttack() {','  // 技能行统一序列化'),boss={GID:8,objecttype:5,_job:2,position:[20,20],life:{hp:10}},normal={GID:9,objecttype:5,_job:3,position:[1,1],life:{hp:10}},seen=[];
  const ac={CLIENT:{SS:{Entity:{life:{hp:100},position:[0,0]}}},clientReady:()=>true,escapePending:()=>false,updateHpWatch(){},sitMaintain(){},isSitting:()=>false,window:{},requireDB:()=>({forEach(fn){seen.push('scan');[boss,normal].forEach(fn);}}),$id:id=>({value:id==='dsh-z-range'?'12':id==='dsh-z-pmrange'?'2':id==='dsh-z-mgrange'?'9':'0',checked:true}),calcAtkRange:()=>2,npHuntMode:()=> 'np',isHybrid:()=>false,takeoverDist:()=>12,lockList:{3:1},zHpWatch:{lastHitAt:0},zLock:{gid:null,name:'',dist:null,done:false,reactive:false},apiBattleTarget:{owner:'builtin-dojo',mid:2,gid:8},apiBattleTargetEntity:()=>({gid:8,mid:2,name:'Boss'}),zEntOf:g=>Number(g)===8?boss:Number(g)===9?normal:null,zRangeDist:(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])),gidInt:Number,zLockCounts:{},zCastIdx:0,zBossDecide:()=>null,zBossSkipGid:0,defSnap:{isCombatMap:true},zMon:{},zAtkWhy:'',Date:{now:()=>1000},Object,Math,Number,String,parseInt,parseFloat,isFinite};
  vm.createContext(ac);vm.runInContext(atk+';this.run=zAttack',ac);ac.run();assert.equal(ac.zLock.gid,8);assert.equal(ac.zAtkWhy,'临时目标在射程外');assert.ok(seen.length<=1,'不得进入普通候选扫描接管');
});

test('V2.38.1 dojo 优先 BOSS、普通怪回原行为并在 stop 前清临时目标（VM）',()=>{
  const tickCode=extract('  function dojoTick(g){','  function dojoStart(params){');
  function run(mobs){const calls=[],snap={ready:true,mobs,dialogOpen:false,player:{hp:100,maxHp:100},arrow:{enabled:false,target:{mid:(mobs[0]||{}).mid,gid:(mobs[0]||{}).gid}}};const api={snapshot:()=>snap,setBattleTarget:(o,t)=>calls.push(['setBattle',t.mid,t.gid]),clearBattleTarget:()=>calls.push(['clearBattle']),setArrowTarget:(o,t)=>calls.push(['setArrow',t.mid,t.gid]),requestBattle:(o,on)=>calls.push(['battle',on]),clearArrowTarget(){},requestFly(){}};const ctx={dojoRun:{on:true,generation:1,cfg:{difficulty:'basic'},npc:null,lastFly:0},dojoCfg:{difficulty:'basic'},DOJO_OWNER:'builtin-dojo',dojoApi:()=>api,dojoChoose:()=>false,dojoRender(){},dojoStop(){},dojoContact(){},Date:{now:()=>1},Array,Object,Math};vm.createContext(ctx);vm.runInContext(tickCode+';this.tick=dojoTick',ctx);ctx.tick(1);return calls;}
  assert.deepEqual(run([{mid:100,gid:1,dead:false,isBoss:false},{mid:200,gid:2,dead:false,isBoss:true}]).slice(0,2),[['setBattle',200,2],['setArrow',200,2]]);
  assert.equal(run([{mid:100,gid:1,dead:false,isBoss:false}])[0][0],'clearBattle','无 BOSS 有普通怪时先 clear 并保持原箭/内挂流程');
  const stopCode=extract('  function dojoStop(reason){','  function dojoRender(){'),stopCalls=[],stopApi={clearBattleTarget:()=>stopCalls.push('battle'),clearArrowTarget:()=>stopCalls.push('arrow'),release:()=>stopCalls.push('release')};const sc={dojoRun:{on:true,generation:1,timer:null,npc:null,phase:''},dojoApi:()=>stopApi,DOJO_OWNER:'builtin-dojo',dojoRender(){},clearInterval(){}};vm.createContext(sc);vm.runInContext(stopCode+';this.stop=dojoStop',sc);sc.stop('x');assert.deepEqual(stopCalls,['battle','arrow','release']);
});

test('V2.37.1 装备槽位与严格签名 VM 回归',()=>{
  const code=extract('  function gearLocation(', '  // ---- 卡册（卡片典藏）读取');
  const items={5:{ITID:1101,index:5,RefiningLevel:7,slot:{card1:4001}},9:{ITID:2301,index:9,RefiningLevel:0,slot:{}}};
  const mk=(idx)=>({getAttribute:k=>k==='data-index'?String(idx):null});
  const gdom2={querySelector:q=>q.indexOf('.weapon ')>=0?mk(5):(q.indexOf('.armor ')>=0?mk(9):null)};
  const EQ2={name:'Equipment',getRoot:()=>gdom2}, INV2={getItemByIndex:i=>items[i]||null};
  const ctx={CLIENT:{EquipmentLocation:{WEAPON:2,ARMOR:16}},uiComp:n=>n==='Equipment'?EQ2:(n==='Inventory'?INV2:null),requireDB:()=>null,bagItemByIndex:i=>items[i]||null,profiles:{},activeProfileKey:()=> 'hero',ensureProfile:k=>ctx.profiles[k]||(ctx.profiles[k]={}),saveProfiles(){},findInventory:()=>[{ITID:1101,index:12,RefiningLevel:7,slot:{card1:4001}},{ITID:1101,index:13,RefiningLevel:0,slot:{}}],clientReady:()=>true,Number,String,Array,Object,Math,JSON,isFinite};
  vm.createContext(ctx);vm.runInContext(code+';this.G={GEAR_SLOTS,gearReadEquipped,gearFindInvItem,gearSigEqual};',ctx);
  assert.deepEqual(Array.from(ctx.G.GEAR_SLOTS,x=>x.m),[1,2,4,8,16,32,64,128,256,512,32768]);
  const cur=ctx.G.gearReadEquipped();assert.equal(cur.ok,true);assert.equal(cur.slots[2].idx,5);assert.equal(cur.slots[16].idx,9);
  assert.equal(ctx.G.gearFindInvItem(1101,7,[4001],{}).index,12);assert.equal(ctx.G.gearFindInvItem(1101,7,[],{}),null);assert.equal(ctx.G.gearFindInvItem(1101,7,[4001],{12:true}),null);
});

test('V2.37.1 双槽组合与同款双饰品行为 VM',()=>{
  const readCode=extract('  function gearLocation(', '  // ---- 卡册（卡片典藏）读取');
  const combo={ITID:1101,index:5,WearState:34,slot:{}}, mk=idx=>({getAttribute:()=>String(idx)});
  const gdom3={querySelector:q=>q.indexOf('.weapon ')>=0?mk(5):(q.indexOf('.shield ')>=0?mk(5):null)};
  const EQ3={name:'Equipment',getRoot:()=>gdom3}, INV3={getItemByIndex:i=>i===5?combo:null};
  const readCtx={CLIENT:{EquipmentLocation:{WEAPON:2,SHIELD:32}},uiComp:n=>n==='Equipment'?EQ3:(n==='Inventory'?INV3:null),requireDB:()=>null,bagItemByIndex:i=>i===5?combo:null,profiles:{},activeProfileKey:()=>'h',ensureProfile:k=>readCtx.profiles[k]||(readCtx.profiles[k]={}),saveProfiles(){},findInventory:()=>[combo],clientReady:()=>true,Number,String,Array,Object,Math,JSON,isFinite};
  vm.createContext(readCtx);vm.runInContext(readCode+';this.G={gearReadEquipped};',readCtx);
  const cur=readCtx.G.gearReadEquipped();
  assert.equal(cur.slots[2].idx,5); assert.equal(cur.slots[32].idx,5); assert.equal(cur.slots[2].wearLocation,34); assert.equal(cur.slots[32].instanceKey,'idx:5');

  const applyCode=extract('  function gearApply(', '  function gearAfterDeck(');
  function run(eq, inventory){
    const packets=[];
    const ctx={gearBusy:false,gearWatchdog:null,gearPreset:()=>({name:'套装',eq}),gearInGame:()=>true,setStatus(){},gearLog(){},gearReadEquipped:()=>({ok:true,slots:{2:{itid:999,refine:0,cards:[],idx:5,name:'旧双手',wearLocation:34,instanceKey:'idx:5'},32:{itid:999,refine:0,cards:[],idx:5,name:'旧双手',wearLocation:34,instanceKey:'idx:5'}}}),gearSigEqual:(a,b)=>!!(a&&b&&a.itid===b.itid&&(a.cards||[]).join(',')===(b.cards||[]).join(',')),gearFindInvItem:(id,r,c,res)=>inventory.find(x=>x.ITID===id&&!res[x.index])||null,gearSlotName:m=>'槽'+m,gearAfterDeck(){},setTimeout:fn=>{fn();return 1},clearTimeout(){},GEAR_SLOTS:[{m:2},{m:32},{m:8},{m:128}],CLIENT:{PS:{CZ:{REQ_TAKEOFF_EQUIP:function(){this.op='off'},REQ_WEAR_EQUIP:function(){this.op='on'}}},NM:{sendPacket:p=>packets.push({op:p.op,index:p.index,wearLocation:p.wearLocation})}},czp:name=>ctx.CLIENT.PS.CZ[name],Number,Array,Object,isFinite};
    vm.createContext(ctx);vm.runInContext(applyCode+';this.run=gearApply;',ctx);ctx.run('x');return packets;
  }
  const shared={itid:1101,refine:0,cards:[],name:'双手剑',wearLocation:34,instanceKey:'idx:20'};
  let packets=run({2:shared,32:shared},[{ITID:1101,index:20}]);
  assert.deepEqual(packets,[{op:'off',index:5,wearLocation:undefined},{op:'on',index:20,wearLocation:34}]);
  const ring1={itid:2201,refine:0,cards:[],name:'戒指'}, ring2={itid:2201,refine:0,cards:[],name:'戒指'};
  packets=run({8:ring1,128:ring2},[{ITID:2201,index:21},{ITID:2201,index:22}]);
  assert.deepEqual(packets.filter(x=>x.op==='on').map(x=>x.index),[21,22]);
});

test('V2.37.1 主审回归：真实装备接口、失败保护与 KV dirty',()=>{
  assert.ok(source.includes('requireDB("DB/Items/EquipmentLocation")'));
  assert.doesNotMatch(source,/DB\/Enum\/EquipmentLocation|LOWER_HEADGEAR|UPPER_HEADGEAR|MIDDLE_HEADGEAR|headgear-bottom/);
  for(const x of ['HEAD_BOTTOM','HEAD_TOP','HEAD_MID','WEAPON','GARMENT','ACCESSORY1','ARMOR','SHIELD','SHOES','ACCESSORY2','AMMO','head_bottom','head_top','head_mid']) assert.ok(source.includes(x),x);
  assert.ok(source.includes('eqOk: !!eq.ok')); assert.ok(source.includes('if (!cap.eqOk)')); assert.ok(source.includes('if (cap.eqOk) { ps.eq = cap.eq'));
  assert.ok(source.includes('(cap.deck ? cap.deck.length : 0)')); assert.ok(source.includes('待穿 " + (wears.length)'));
  assert.ok(source.includes('deckMissing')); assert.ok(source.includes('deckExcess')); assert.doesNotMatch(source,/deckN - deckBad/);
  assert.ok(source.includes("#all,input#all")); assert.ok(source.includes('oldFilter')); assert.ok(source.includes('oldTab'));
  assert.ok(source.includes('function kvMarkLocal(key, value)')); assert.ok(source.includes('kvMarkLocal(PROF_KEY, value)')); assert.ok(source.includes('kvMarkLocal(HK_KEY2, value)'));
  assert.ok(source.includes('Object.prototype.hasOwnProperty.call(KV_PREV, key)')); assert.ok(source.includes('hkLoad(); roMenuRender();'));
});

test('V2.37.1 安全语义结构守卫',()=>{
  ['if (!Array.isArray(ps.deck))','for (var x = 0; x < ids.length; x++)','if (sent.cardFail) bad.push','if (cap.deckOk) { ps.deck = cap.deck','if (!has(lp, "gearSets")','if (cur !== startValue || curTs !== startTs) return;','return; // pull 只应用，不立即反推'].forEach(x=>assert.ok(source.includes(x),x));
  assert.ok(source.includes("var mk = 'dsh_ro_st_migrate_v21530_' + activeProfileKey()"));
});

// ================= V2.38.2：背包读取 / 换箭兜底 / 辅助技能 / 自动丢弃 =================
test('V2.38.2 背包读取统一走 bagList()：组件与 UIManager 缺一不可地兜底',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('function bagList()'),name+' 必须有统一背包读取');
    assert.ok(src.includes('function findInventory() { return bagList(); }'),name+' findInventory 必须复用 bagList');
    assert.ok(src.includes('function readBagWorn(slotBit)'),name+' 必须能按穿戴位回读背包实例');
    assert.ok(src.includes('function readBagAmmo()'),name+' 箭矢槽必须有组件→背包回读兜底');
    assert.ok(src.includes('function readBagArrows()'),name+' 必须有背包箭矢读取');
    assert.ok(src.includes('var rawT = it.type, t = Number(rawT);')&&src.includes('/箭矢$/.test(nm)'),name+' 箭矢类型必须数字规范化 + 名字二次确认');
    assert.ok(src.includes('arrowBagDiagRender'),name+' 必须有背包数据源诊断');
    assert.ok(src.includes('id="dsh-arrowbaglog"')&&src.includes('id="dsh-arrow-rules-bagdiag"'),name+' 两个诊断行必须在界面里');
  }
});

test('V2.38.2 自动续箭阈值 50 支且按「对应箭袋→普通箭矢」顺序兜底',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('var ARROW_PLAIN_ITID=1750, ARROW_MAGIC_QUIVER=2000030, ARROW_LOW_AMMO=50;'),name+' 普通箭矢/魔法箭矢筒/阈值必须集中声明');
    assert.ok(src.includes('if (have >= ARROW_LOW_AMMO)'),name+' 阈值必须是「当前装备箭矢 >= 50」才不动手');
    assert.ok(src.includes('var needItid = (ammo && arrowPos(ammo.itid)) || arrowPos(arrowRules.defaultItid) || ARROW_PLAIN_ITID;'),name+' 续箭目标=当前那支→默认箭→普通箭');
    assert.ok(src.includes('var quiver = arrowUseQuiver(needItid);'),name+' 必须优先开当前那支箭对应的箭袋');
    assert.ok(src.includes('useItemById(ARROW_MAGIC_QUIVER)'),name+' 没有对应箭袋时才用魔法箭矢筒');
    assert.ok(src.includes('箭矢不足 50 支时自动补箭（打开对应箭袋，没有则换普通箭矢）'),name+' 界面文案要写明 50 支与兜底');
    assert.ok(!src.includes('箭矢耗尽时用魔法箭袋'),name+' 旧「耗尽才补」文案必须删净');
  }
});

test('V2.38.2 换箭候选链：属性箭 → 指定怪箭 → 念/不死属性补偿 → 通用箭 → 普通箭矢',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('if(en==="念")'),name+' 念属性补偿分支');
    assert.ok(src.includes('["水","火","地","风"].forEach'),name+' 念→水/火/地/风 顺序不能乱');
    assert.ok(src.includes('addElem("elemfallback","火","不死")'),name+' 不死→火');
    assert.ok(src.includes('addElem("elemfallback","圣","不死")'),name+' 不死→火→圣');
    assert.ok(src.includes('add("default",cfg.defaultItid)'),name+' 通用箭仍要保留');
    assert.ok(src.includes('if(out.length)add("plain",ARROW_PLAIN_ITID);'),name+' 普通箭矢只在前面有配置时才兜底，且必须走 add() 的 seen 去重（默认箭恰为 1750 时不重复）');
    assert.ok(src.includes('"属性箭缺失，已用 "+(c.useElem||"")+"属性箭 补偿："+tag'),name+' 属性补偿提示');
    assert.ok(src.includes('"背包缺 "+en+"箭矢，改用通用箭矢 "'),name+' 通用箭兜底提示');
    assert.ok(src.includes('"通用箭矢也没有，已用魔法箭袋补充普通箭矢"'),name+' 普通箭矢兜底提示');
    assert.ok(src.includes('"没有任何可用的箭矢/箭袋，保持当前箭："'),name+' 全都没有时只提示不换');
  }
});

test('V2.38.2 辅助技能：默认关闭、SP 下限可 0、名单归属校验、状态栏实时',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('saved.askEn === true'),name+' 自动 buff 必须默认关闭');
    assert.ok(src.includes('dsh_ro_uiclear170_v1'),name+' 一次性清空键必须是浏览器级');
    assert.ok(!src.includes('saved.uiClear170'),name+' 旧的角色档内清空标志必须删净');
    assert.ok(src.includes('function askSpGuard()'),name+' SP 下限必须有共享解析');
    assert.ok(src.includes("var n = parseInt($id(id) ? $id(id).value : \"\", 10); return isFinite(n) ? n : def;"),name+' SP 下限必须允许 0');
    assert.ok(src.includes('if (profMemKey && profMemKey !== k)'),name+' saveAskList 必须有归属校验');
    assert.ok(src.includes('function renderBuffLog()'),name+' 状态栏必须有实时渲染');
    for(const txt of ['辅助技能：未启用（勾选"启用自动释放"）','辅助技能：待机（自动战斗未开启）','辅助技能：暂停（SP ','辅助技能：运行中']) assert.ok(src.includes(txt),name+' 状态栏文案 '+txt);
    assert.ok(src.includes('if (txt === buffLogLast) return;'),name+' 状态栏内容不变不得重写（防闪）');
    assert.ok(src.includes('var list = askList.slice()'),name+' 一键补 buff 必须用快照，避免切档/刷新错档');
  }
});

test('V2.38.2 自动丢弃：逐角色保存、默认关闭、随时丢弃独立开关、提速',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('function bagCleanStorageKey()')&&src.includes("return k?(BAG_CLEAN_KEY+':'+k):BAG_CLEAN_KEY;"),name+' 必须逐角色保存且能退回全局键');
    assert.ok(src.includes('bagClean.config.enabled===true&&bagClean.config.armed===true'),name+' 启用状态必须逐角色记忆');
    assert.ok(src.includes('data-anytime'),name+' 必须有「随时丢弃」开关');
    assert.ok(src.includes('function bagCleanNeeded(weight,free){if(bagClean.config.anytime===true)return true;return (weight!==null&&weight>70)||(free!==null&&free<20);}'),name+' anytime 为真时不看负重/空格阈值：名单命中即丢');
    assert.ok(src.includes('cfg.armed=false; // 安全门禁'),name+' 加载后必须回到未授权');
    assert.ok(src.includes('setTimeout(poll,80)'),name+' 确认轮询必须提速到 80ms');
    assert.ok(src.includes('plan.slice(0,4)'),name+' 每轮最多连丢 4 个不同 index 的堆叠');
    assert.ok(src.includes('URL.createObjectURL'),name+' 导出必须真的下载 JSON');
    assert.ok(src.includes('readAsText'),name+' 导入必须支持选择文件');
    assert.ok(src.includes("已导入 '+outN+' 条名单（跳过 '+Math.max(0,inN-outN)+' 条无效"),name+' 导入提示要报条目数');
  }
});

test('V2.38.2 物品说明浮窗可加入/移出丢弃名单（左键，不劫持右键）',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    assert.ok(src.includes('data-dsh-bagact'),name+' 必须有名单按钮');
    assert.ok(src.includes('加入丢弃名单')&&src.includes('移出丢弃名单'),name+' 按钮两种文案都要有');
    assert.ok(src.includes('function bagCleanToggleItem(item,remove)'),name+' 按钮后端');
    assert.ok(src.includes('t.closest("#dsh-itemtip")'),name+' 鼠标进浮窗不得收起来（否则点不到按钮）');
    assert.ok(src.includes('e.preventDefault(); e.stopPropagation();'),name+' 点按钮必须拦下，别落到游戏画面');
  }
});

test('V2.38.2 bagClean 逐角色键与角色档隔离（VM）',()=>{
  const store=new Map();
  const code=extract("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'",'  function bagCleanSay(text)'); // 末尾放宽到 bagCleanSay 之前，把 bagCleanNeeded 口径一并纳入 VM 验证
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},requireDB:()=>null,require:()=>null,activeProfileKey:()=>'abc',
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))},bagCleanSay(){}};
  vm.createContext(ctx);vm.runInContext(code+';this.load=bagCleanLoad;this.save=bagCleanSave;this.key=bagCleanStorageKey;this.needed=bagCleanNeeded',ctx);
  assert.equal(ctx.key(),'dsh-bag-clean-v2:abc','逐角色键必须是 <全局键>:<角色档键>');
  ctx.bagClean.config={version:2,discardRules:{'501':0},categoryTypes:[],protectedIds:[],armed:true,enabled:true,anytime:true};
  ctx.save();
  assert.ok(store.get('dsh-bag-clean-v2:abc').includes('"anytime":true'),'随时丢弃必须落盘');
  assert.ok(!store.has('dsh-bag-clean-v2'),'逐角色时不得写全局键');
  const cfg=ctx.load();
  assert.equal(cfg.armed,false,'加载后必须回到未授权');
  assert.equal(cfg.enabled,true,'启用状态必须逐角色记住');
  assert.equal(cfg.anytime,true,'随时丢弃必须逐角色记住');
  // 口径：开启「随时丢弃」= 不看负重与空格；关闭 = 只在 负重>70% 或 空格<20 时动手
  ctx.bagClean.config={anytime:true};
  assert.equal(ctx.needed(10,999),true,'anytime 为真：负重/空格再宽裕也判需要丢弃');
  assert.equal(ctx.needed(null,null),true,'anytime 为真：读不到负重/空格也判需要丢弃');
  ctx.bagClean.config={anytime:false};
  assert.equal(ctx.needed(70,20),false,'anytime 为假：负重 70% / 空格 20 是边界，不触发');
  assert.equal(ctx.needed(70.5,100),true,'anytime 为假：负重>70% 才动手');
  assert.equal(ctx.needed(10,19),true,'anytime 为假：空格<20 才动手');
  assert.equal(ctx.needed(null,null),false,'anytime 为假：读不到负重/空格不动手');
});

// ================= V2.38.2 第三批定点修复：切角色复位自动丢弃 / anytime 归零 armed / 陈旧预览清 enabled / 状态去重 / 补偿箭顺序 =================
test('第三批 F1/F3/F4/F5：切角色复位自动丢弃、anytime 改动归零 armed、陈旧预览清 enabled、状态去重',()=>{
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    const chg=src.slice(src.indexOf('  function onCharChanged(ent) {'),src.indexOf('  onId("dsh-saveprofile"'));
    assert.ok(chg.includes('bagClean.config = bagCleanLoad();')&&chg.includes('bagClean.config.armed = false;')&&chg.includes("bagCleanSay('切换角色：自动丢弃已关闭，需重新预览确认。')"),name+' F1 切角色必须复位自动丢弃并给出中文提示');
    assert.ok(chg.indexOf('captureAll();')<chg.indexOf('bagClean.generation++'),name+' F1 复位必须在 captureAll（旧档落盘）之后');
    assert.ok(chg.indexOf('askList = profiles[key].askList')<chg.indexOf('bagClean.config = bagCleanLoad();'),name+' F1 复位必须在重绑 lockList/askList 之后');
    assert.ok(chg.includes('} catch (eBC) {}'),name+' F1 复位必须自带 try/catch，不得影响换角色主流程');
    const ui=src.slice(src.indexOf('  function bagCleanInit()'),src.indexOf('  // ---------------- 拾取页：内挂百分比联动'));
    assert.ok(ui.includes("box.querySelector('[data-anytime]').onchange=function(){bagClean.config.anytime=this.checked===true;changed('随时丢弃已修改：自动已关闭，需重新预览确认。');};"),name+' F3 随时丢弃改动必须走 changed()（armed 归零）');
    assert.ok(!ui.includes("bagClean.config.anytime=this.checked===true;bagCleanSave();"),name+' F3 旧「只赋值 + save」写法必须删净');
    const prev=src.slice(src.indexOf('  function bagCleanPreview()'),src.indexOf('  function bagCleanInit()'));
    assert.ok(prev.includes("if(stale){bagCleanDisarm('预览期间索引/ITID/type/数量/保护或规则变化，已停止；请重新预览。');return null;}"),name+' F4 陈旧候选必须走 bagCleanDisarm（同时清 enabled）');
    assert.ok(src.includes('var bagCleanSayLast="";'),name+' F5 状态文本必须记住上一次内容');
    assert.ok(src.includes('function bagCleanSay(text){text=String(text);if(text===bagCleanSayLast)return;bagCleanSayLast=text;'),name+' F5 文本未变不得重写 DOM');
  }
});

test('第三批 F2：bagCleanSave 一律写回加载时记住的键，旧角色规则不得写进新角色档（VM）',()=>{
  const store=new Map();let profile='A';
  const code=extract("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'",'  function bagCleanSay(text)');
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},requireDB:()=>null,require:()=>null,
    activeProfileKey:()=>profile,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))}};
  vm.createContext(ctx);vm.runInContext(code+';this.load=bagCleanLoad;this.save=bagCleanSave;this.key=bagCleanStorageKey',ctx);
  assert.equal(ctx.key(),'dsh-bag-clean-v2:A','逐角色键仍是 <全局键>:<角色档键>');
  ctx.load();
  assert.equal(ctx.bagClean.key,'dsh-bag-clean-v2:A','bagCleanLoad 必须记住加载时用的键');
  profile='B';
  ctx.bagClean.config={version:2,discardRules:{'999':0},categoryTypes:[],protectedIds:[],armed:false,enabled:false,anytime:false};
  ctx.save();
  assert.ok(store.get('dsh-bag-clean-v2:A').includes('"999":0'),'切档复位还没跑时也必须写回记住的旧键');
  assert.ok(!store.has('dsh-bag-clean-v2:B'),'绝不能把旧角色的规则写进新角色档');
  ctx.load();
  assert.equal(ctx.bagClean.key,'dsh-bag-clean-v2:B','重新加载后记住的键跟到新角色');
  ctx.bagClean.config={version:2,discardRules:{'888':0},categoryTypes:[],protectedIds:[],armed:false,enabled:false,anytime:false};
  ctx.save();
  assert.ok(store.get('dsh-bag-clean-v2:B').includes('"888":0'),'复位之后写到新角色档');
});

test('第三批 F9：属性箭已配但背包里没有时，补偿箭仍排在通用箭之前（VM）',()=>{
  const code=extract('  function arrowPos(v)','  function arrowLoad(){')+extract('  function arrowBoss(mid)','  function arrowFill(s)');
  const ctx={};vm.createContext(ctx);vm.runInContext(code+';this.cand=arrowCandidates;this.decide=arrowDecision',ctx);
  // 1061 = 念属性怪，1015 = 不死属性怪（取本机 MOB_ELEM_RAW 交核对）
  const nian=ctx.cand(1061,{byElem:{'念':1758,'水':1754},byMid:{},defaultItid:1750}),nids=nian.map(x=>x.itid);
  assert.equal(nids[0],1758,'属性箭本身仍然是第一优先');
  assert.ok(nids.indexOf(1754)>=0&&nids.indexOf(1750)>=0&&nids.indexOf(1754)<nids.indexOf(1750),'念箭已配但用不上时，水属性箭必须排在通用箭之前');
  const fb=nian.filter(x=>x.kind==='elemfallback');
  assert.equal(fb.length,1,'只有配过的补偿箭才进候选');
  assert.equal(fb[0].itid,1754);assert.equal(fb[0].useElem,'水');assert.equal(fb[0].missElem,'念','kind/useElem/missElem 标记必须保留（提示文案靠它）');
  const ud=ctx.cand(1015,{byElem:{'不死':1766,'火':1752,'圣':1765},byMid:{},defaultItid:1750}).map(x=>x.itid);
  assert.ok(ud.indexOf(1752)<ud.indexOf(1750)&&ud.indexOf(1765)<ud.indexOf(1750),'不死用不上时火/圣必须排在通用箭之前');
  assert.ok(ud.indexOf(1752)<ud.indexOf(1765),'不死补偿顺序必须是 火 → 圣');
  assert.equal(ctx.cand(1061,{byElem:{},byMid:{},defaultItid:null}).length,0,'什么都没配 → 仍然是空列表、不动作');
  assert.equal(ctx.decide(1061,{byElem:{},byMid:{},defaultItid:null}),null,'什么都没配 → 不换箭');
  assert.equal(JSON.stringify(ctx.decide(1061,{byElem:{'水':1754},byMid:{},defaultItid:null})),JSON.stringify({kind:'elemfallback',itid:1754,useElem:'水',missElem:'念'}),'念箭没配置时补偿链口径不变');
});


// ================= V2.38.2 第四批定点修复：切角色复位无视 bagCleanLoad 失败 / 普通箭矢候选去重 ==================
test('第四批 G1：bagCleanLoad 抛错时切角色复位仍必须完成安全归零并落盘（VM）',()=>{
  const head='      // 切角色复位：',tail='      profMemKey = activeProfileKey();';
  for(const [name,src] of [['stable',source],['exp',expSource]]){
    const a=src.indexOf(head),b=src.indexOf(tail,a);
    assert.ok(a>=0&&b>a,name+' 必须能切出切角色复位块');
    const block=src.slice(a,b);
    assert.ok(block.indexOf('} catch (eBC) {}')<block.indexOf('bagClean.enabled = false;'),name+' 安全归零必须排在 try/catch 之后，不能排在 bagCleanLoad 之后');
    assert.ok(block.indexOf('bagClean.enabled = false;')<block.indexOf('bagCleanSave();'),name+' 归零必须先于落盘');
    function run(load,extra){
      const store=new Map();
      const ctx={bagClean:{enabled:true,busy:true,pending:true,generation:1,key:'dsh-bag-clean-v2:A',render:null,
        config:{version:2,discardRules:{'501':0},categoryTypes:[],protectedIds:[],armed:true,enabled:true,anytime:true}},
        bagCleanLoad:load,
        bagCleanSave(){store.set(ctx.bagClean.key,JSON.stringify(ctx.bagClean.config));ctx.__saved=(ctx.__saved||0)+1;},
        bagCleanSay(t){ctx.__said=t;}};
      if(extra)extra(ctx);
      vm.createContext(ctx);vm.runInContext(block,ctx);
      return {ctx,store};
    }
    // 1) 加载直接抛错：旧角色的 armed 授权绝不能残留
    let {ctx,store}=run(()=>{throw Error('模拟 bagCleanLoad 失败');});
    assert.equal(ctx.bagClean.enabled,false,name+' 加载失败也必须 enabled=false');
    assert.equal(ctx.bagClean.config.armed,false,name+' 加载失败也必须 config.armed=false');
    assert.equal(ctx.bagClean.config.enabled,false,name+' 加载失败也必须 config.enabled=false');
    assert.equal(ctx.bagClean.generation,2,name+' 复位代数仍要自增');
    assert.equal(ctx.bagClean.busy,false);assert.equal(ctx.bagClean.pending,false);
    assert.ok(ctx.__saved>=1,name+' 加载失败也必须落盘');
    let raw=JSON.parse(store.get('dsh-bag-clean-v2:A'));
    assert.equal(raw.armed,false,name+' 落盘内容 armed 必须是 false');
    assert.equal(raw.enabled,false,name+' 落盘内容 enabled 必须是 false');
    assert.equal(ctx.__said,'切换角色：自动丢弃已关闭，需重新预览确认。',name+' 复位提示必须照常给出');
    // 2) 加载成功但 render 抛错：归零与落盘不得被带偏
    ({ctx,store}=run(()=>({version:2,discardRules:{},categoryTypes:[],protectedIds:[],armed:true,enabled:true,anytime:true}),c=>{c.bagClean.render=()=>{throw Error('渲染失败');};}));
    assert.equal(ctx.bagClean.enabled,false,name+' render 抛错也必须 enabled=false');
    assert.equal(ctx.bagClean.config.armed,false,name+' render 抛错也必须 config.armed=false');
    assert.equal(ctx.__said,'切换角色：自动丢弃已关闭，需重新预览确认。');
    raw=JSON.parse(store.get('dsh-bag-clean-v2:A'));
    assert.equal(raw.armed,false,name+' render 抛错也必须落盘 armed=false');
  }
});

test('第四批 G2：默认箭恰好是普通箭矢 1750 时候选链不出现重复（VM）',()=>{
  const code=extract('  function arrowPos(v)','  function arrowLoad(){')+extract('  function arrowBoss(mid)','  function arrowFill(s)');
  const ctx={};vm.createContext(ctx);vm.runInContext(code+';this.cand=arrowCandidates',ctx);
  const dup=ctx.cand(1002,{byMid:{},byElem:{},defaultItid:1750});
  assert.equal(JSON.stringify(dup),JSON.stringify([{kind:'default',itid:1750}]),'默认箭=普通箭矢 1750 时候选只能有一支（1750 不得出现两次）');
  assert.equal(ctx.cand(1002,{byMid:{},byElem:{},defaultItid:null}).length,0,'什么都没配置 → 仍然不补普通箭矢（保护不变）');
  const withMob=ctx.cand(1002,{byMid:{1002:1751},byElem:{},defaultItid:1750});
  assert.equal(withMob.length,2,'指定怪箭 + 默认箭，普通箭矢被 seen 去重');
  assert.equal(withMob.filter(x=>x.itid===1750).length,1,'1750 只能出现一次');
  const fb=ctx.cand(1002,{byMid:{},byElem:{},defaultItid:1802});
  assert.equal(JSON.stringify(fb.map(x=>x.kind)),JSON.stringify(['default','plain']),'默认箭不是 1750 时普通箭矢仍要兜底在最后');
  assert.equal(fb[fb.length-1].itid,1750);
  assert.ok(source.includes('if(out.length)add("plain",ARROW_PLAIN_ITID);'),'稳定版必须走 add() 的 seen 去重');
  assert.ok(expSource.includes('if(out.length)add("plain",ARROW_PLAIN_ITID);'),'实验版必须同步');
});

// ================= V2.38.2 挂机结束时置零内挂自动战斗（全局设置 dsh_ro_npzero_v1） =================
const NP_ZERO_LOAD = '  var NP_ZERO_KEY = "dsh_ro_npzero_v1";';
const NP_ZERO_END = '  // 设置界面：';

test('V2.38.2 置零设置：默认开、读取失败按开、关闭时一个包都不发（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('var NP_ZERO_KEY = "dsh_ro_npzero_v1";'), name + ' 必须用稳定全局键 dsh_ro_npzero_v1');
    assert.ok(src.includes('var npZeroCfg = { enabled: true };'), name + ' 默认值必须是开');
    assert.ok(src.includes('id="dsh-npzero" type="checkbox"') && src.includes('挂机结束时关闭内挂自动战斗（默认开）'), name + ' 内挂页必须有中文复选框');
    assert.ok(src.includes('npZeroSave(this.checked)'), name + ' 勾选必须立刻落盘');
    assert.ok(src.includes('已开启：挂机结束时自动关闭内挂自动战斗') && src.includes('已关闭：挂机结束时不再关闭内挂自动战斗'), name + ' 勾选进/出都要有中文 setStatus 提示');
    const load = src.slice(src.indexOf(NP_ZERO_LOAD), src.indexOf(NP_ZERO_END, src.indexOf(NP_ZERO_LOAD)));
    assert.ok(load.length > 0, name + ' 必须能切出设置与置零函数块');
    function boot(stored) {
      const packets = [];
      const store = new Map();
      if (stored !== undefined) store.set('dsh_ro_npzero_v1', stored);
      const ctx = { JSON, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
        npReadPanelState: () => null, // 面板读不到 → 走既有语义
        npRequestBattle: (w, s, i) => { packets.push([w, s, i]); return 'sent'; }, tlog() {} };
      vm.createContext(ctx); vm.runInContext(load + ';this.zero=npZeroBattle;this.on=npZeroEnabled;this.save=npZeroSave', ctx);
      return { ctx, packets, store };
    }
    // 无值 → 默认开，且立刻请求一次「关自动战斗」（走立即事务；面板读不到 → 未知态照发）
    let { ctx, packets } = boot(undefined);
    assert.equal(ctx.on(), true, name + ' 无值时一律按开');
    assert.equal(ctx.zero('dojoStop'), 'sent', name + ' 开启时置零必须走 npRequestBattle');
    assert.equal(JSON.stringify(packets), JSON.stringify([[false, 'zero:dojoStop', true]]), name + ' 必须是 npRequestBattle(false, "zero:...", true)');
    // 读取失败（坏 JSON / null / 非对象 / 非布尔）→ 一律按开
    for (const bad of ['{坏', 'null', '[]', '"x"', '{"enabled":"yes"}']) {
      const b = boot(bad);
      assert.equal(b.ctx.on(), true, name + ' 读取失败(' + bad + ')必须按开');
    }
    // 显式关闭 → 直接返回，一个包都不发
    const off = boot('{"enabled":false}');
    assert.equal(off.ctx.on(), false, name + ' 落盘 false 必须生效');
    assert.equal(off.ctx.zero('dojoStop'), 'disabled', name + ' 关闭时必须直接返回');
    assert.equal(off.packets.length, 0, name + ' 关闭时绝不能发包');
    off.ctx.save(true);
    assert.equal(off.store.get('dsh_ro_npzero_v1'), '{"enabled":true}', name + ' 重新勾选必须立刻落盘');
    assert.equal(off.ctx.on(), true, name + ' 重新勾选后立刻生效');
  }
});

// V2.38.2 置零 VM 夹具：document 里必须有真实的 #vbk input.openattack 节点——
//   生产 npSendBattle→npSyncBattleCheckbox 会把面板写回 false，800ms 复核读到 false 就不再补发；
//   夹具没有 document 时这条写回被 try/catch 吞掉，会测出生产根本不成立的「补发 2 次」路径（假绿）。
function npZeroVm(known, on, panel) {
  const toggles = [], logs = [], timers = [], cleared = [];
  let now = 1000, tid = 0;
  const vbk = panel === null ? null : { checked: panel === true };
  const ctx = { Math, Date: { now: () => now },
    document: { querySelector: (sel) => (sel === '#vbk input.openattack' ? vbk : null) },
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, fn: fn, ms: ms }); return tid; },
    clearTimeout: (id) => { cleared.push(id); },
    npHuntOn: !!on, npBattleKnown: !!known, npBattleLastSentAt: -Infinity, npBattleConfirmedAt: 0,
    npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null,
    npReadPanelState: () => { const el = ctx.document.querySelector('#vbk input.openattack'); return el ? !!el.checked : null; },
    npToggleHunt: () => { toggles.push(1); return true; }, npIsThree: () => false, npSendUpdate: () => true,
    tlog: (m) => logs.push(m) };
  vm.createContext(ctx);
  vm.runInContext(extract('  function npBattleState() {', '  onId("dsh-battleon",') + extract(NP_ZERO_LOAD, NP_ZERO_END)
    + ';this.zero=npZeroBattle;this.state=npBattleState;this.req=npRequestBattle;this.clear=npClearBattleIntent;this.reset=npResetBattleState', ctx);
  return { ctx, toggles, logs, timers, cleared,
    panelChecked: () => (vbk ? vbk.checked : null),
    setPanel: (v) => { if (vbk) vbk.checked = v === true; },
    later: (ms) => { now += ms; while (timers.length) { const t = timers.shift(); if (cleared.indexOf(t.id) >= 0) continue; t.fn(); } } };
}

test('V2.38.2 置零真值表：面板=服务器权威 → 面板关 0 发包 / 面板开必真发关包（缓存说关也照发）（VM）', () => {
  // 真值表：面板明确「已关」→ already，任何缓存组合都 0 发包
  for (const [known, on] of [[true, true], [true, false], [false, false]]) {
    const a = npZeroVm(known, on, false);
    assert.equal(a.ctx.zero('dojoStop'), 'already', '面板说已关 (' + known + ',' + on + ') 必须 already');
    assert.equal(a.toggles.length, 0, '面板说已关时一个包都不发');
    assert.equal(a.timers.length, 0, '面板说已关时不得起任何定时器');
    assert.equal(a.ctx.state(), false, '面板=服务器权威，缓存必须被纠回「已关」');
    assert.ok(a.logs.join('|').includes('panel=false'), '必须写下面板口径的 tlog');
  }
  // 关键用例一：缓存说关、面板说开 → 必须绕过缓存去重真发一次关闭包
  const b = npZeroVm(true, false, true);
  assert.equal(b.ctx.state(), false, '前置：本地缓存认为内挂已关');
  assert.equal(b.ctx.zero('stopZhu'), 'sent', '面板说在跑即使缓存说关也必须真发关包');
  assert.equal(b.toggles.length, 1, '面板说在跑只发一次 toggle');
  assert.equal(b.ctx.state(), false, '发包后本地态回到已关');
  assert.ok(b.logs.join('|').includes('panel=true'), '必须写下面板口径的 tlog');
  // 发完复核：生产里 npSyncBattleCheckbox 已把面板写回「关」→ 复核读到关，不再补发
  assert.equal(b.panelChecked(), false, '生产：关包发出后 #vbk 被写回 false');
  b.later(800);
  assert.equal(b.toggles.length, 1, '面板已收敛时不得补发第二次');
  // 关键用例二：缓存说开、面板说开 → 发一次；800ms 复核读到生产写回的「关」→ 不得补发（生产实际只发 1 次）
  const c = npZeroVm(true, true, true);
  assert.equal(c.ctx.state(), true, '前置：缓存与面板都说在跑');
  assert.equal(c.ctx.zero('换角色'), 'sent', '面板说在跑必须发关包');
  assert.equal(c.toggles.length, 1);
  assert.equal(c.panelChecked(), false, '生产：关包发出后 npSyncBattleCheckbox 已把 #vbk 写回 false');
  c.later(800);
  assert.equal(c.toggles.length, 1, '复核读到面板已关 → 不得补发');
  c.later(5000);
  assert.equal(c.toggles.length, 1, '绝不循环');
  assert.equal(c.timers.length, 0, '复核跑完不得再排定时器');
  // 面板读不到 → 保持既有语义：已知开发一次 / 已知关 already / 未知发一次
  const u = npZeroVm(false, false, null);
  assert.equal(u.ctx.state(), null, '前置：权威状态未知');
  assert.equal(u.ctx.zero('换角色'), 'sent', '未知态必须照发一次');
  assert.equal(u.toggles.length, 1, '未知态只发一次');
  assert.equal(u.ctx.zero('dojoStop'), 'already', '同一波挂机结束的第二次置零必须 already');
  assert.equal(u.toggles.length, 1, '同一波挂机结束不得重复 toggle');
  const d = npZeroVm(true, true, null);
  assert.equal(d.ctx.zero('death-guard'), 'sent', '面板读不到 + 已知在跑 → 照发一次');
  assert.equal(d.toggles.length, 1);
  const e = npZeroVm(true, false, null);
  assert.equal(e.ctx.zero('apiRelease'), 'already', '面板读不到 + 已知关 → already，不重复发包');
  assert.equal(e.toggles.length, 0);
  // npZeroBattle 内部异常不得外抛
  const boom = { JSON, localStorage: { getItem: () => null, setItem() {} }, npReadPanelState: () => null, npRequestBattle: () => { throw Error('boom'); }, tlog() {} };
  vm.createContext(boom); vm.runInContext(extract(NP_ZERO_LOAD, NP_ZERO_END) + ';this.zero=npZeroBattle', boom);
  assert.equal(boom.zero('x'), 'error', 'npRequestBattle 抛错时 npZeroBattle 必须吞掉并返回 error');
});

test('V2.38.2 置零复核：关包发出后服务器把面板重新渲染成「开」→ 允许补发一次，总计硬上限 2 次（VM）', () => {
  const c = npZeroVm(true, true, true);
  assert.equal(c.ctx.zero('换角色'), 'sent', '面板说在跑 → 先发一次关包');
  assert.equal(c.toggles.length, 1);
  assert.equal(c.panelChecked(), false, '前置：客户端把面板写回「关」');
  c.setPanel(true); // 服务器下一帧把 #vbk 重新渲染成开（本地缓存被污染 / 面板被重绘）
  c.later(800);
  assert.equal(c.toggles.length, 2, '复核读到面板又在跑 → 允许补发一次');
  assert.ok(c.logs.join('|').includes('np-zero retry result='), '补发必须写 tlog');
  c.later(5000);
  assert.equal(c.toggles.length, 2, '总计硬上限 2 次，绝不循环');
  assert.equal(c.timers.length, 0, '补发后不得再排定时器');
});

test('V2.38.2 内挂置零：800ms 复核定时器必须存句柄，换角色复位 / 清战斗意图后立即撤销且绝不再发包（VM）', () => {
  const c = npZeroVm(true, true, true);
  assert.equal(c.ctx.zero('换角色'), 'sent', '面板说在跑 → 发一次关包并排一个复核');
  assert.equal(c.toggles.length, 1);
  assert.equal(c.timers.length, 1, '复核必须排一个 800ms 定时器');
  c.ctx.reset(); // 换角色复位：npResetBattleState → npClearBattleIntent
  assert.ok(c.cleared.indexOf(c.timers[0].id) >= 0, '换角色复位必须 clearTimeout 掉待复核定时器');
  c.later(800);
  assert.equal(c.toggles.length, 1, '被撤销的复核绝不能再对（可能已切换的）角色发一次');
  const d = npZeroVm(true, true, true);
  assert.equal(d.ctx.zero('stopZhu'), 'sent');
  assert.equal(d.timers.length, 1);
  d.ctx.clear(); // 直接清战斗意图
  assert.ok(d.cleared.indexOf(d.timers[0].id) >= 0, 'npClearBattleIntent 本身也要清掉复核定时器');
  d.later(800);
  assert.equal(d.toggles.length, 1, '清意图后复核同样不得再发包');
});

test('V2.38.2 dojoStop 只在真正跑过道场时置零一次，且排在 release 之后（VM）', () => {
  const code = extract('  function dojoStop(reason){', '  function dojoRender(){');
  function run(on) {
    const calls = [];
    const api = { clearBattleTarget: () => calls.push('clearBattle'), clearArrowTarget: () => calls.push('clearArrow'), release: () => calls.push('release') };
    const ctx = { dojoRun: { on: on, generation: 1, timer: 7, npc: null, phase: '' }, dojoApi: () => api,
      DOJO_OWNER: 'builtin-dojo', dojoRender() {}, clearInterval() {}, npZeroBattle: (r) => { calls.push('zero:' + r); return 'sent'; } };
    vm.createContext(ctx); vm.runInContext(code + ';this.stop=dojoStop', ctx);
    ctx.stop('测试');
    return { ctx, calls };
  }
  assert.deepEqual(run(true).calls, ['clearBattle', 'clearArrow', 'release', 'zero:dojoStop'], '道场跑过 → 释放租约后必须置零内挂自动战斗');
  assert.deepEqual(run(false).calls, ['clearBattle', 'clearArrow', 'release'], '租约没拿到（被别的流程占用 / 未启动就失败）→ 释放路径照旧但绝不置零别人的内挂');
  assert.equal(run(true).ctx.dojoRun.on, false, '停止后必须不再是运行态');
  assert.equal(run(true).ctx.dojoRun.timer, null, '停止必须清掉定时器');
});

test('V2.38.2 apiRelease 只在持有 battle 能力且内挂确认在跑时置零（VM）', () => {
  const code = extract('  function apiRelease(owner)', '  function apiContact(owner,gid)');
  function run(lease, npState) {
    const zeros = [];
    const ctx = { apiLease: lease, npBattleState: () => npState, npZeroBattle: (r) => { zeros.push(r); return 'sent'; },
      apiClearBattleTarget: () => ({ ok: true }), apiBattleTick() {}, npClearBattleIntent() {}, npRequestBattle: () => 'sent', apiEmit() {},
      moveXY: {}, arrowTarget: null, arrowPending: null, arrowReady: false, arrowBlocked: false };
    vm.createContext(ctx); vm.runInContext(code + ';this.rel=apiRelease', ctx);
    const out = ctx.rel('owner-123');
    return { ctx, zeros, out };
  }
  const lease = (scopes, state) => ({ owner: 'owner-123', generation: 1, scopes: scopes, released: false, battle: { state: state } });
  const a = run(lease(['battle'], 'none'), true);
  assert.deepEqual(a.zeros, ['apiRelease'], '外部脚本持有 battle 且内挂还在跑 → 释放时必须置零');
  assert.equal(a.ctx.apiLease, null, '释放后租约必须清空');
  assert.equal(a.out.ok, true);
  assert.deepEqual(run(lease(['battle'], 'none'), false).zeros, [], '内挂确认已关时不得再发关包');
  assert.deepEqual(run(lease(['movement'], 'none'), true).zeros, [], '只持有移动能力的脚本释放时不得碰内挂');
  assert.deepEqual(run(lease(['battle'], 'owned'), true).zeros, [], 'owned 已走既有 external-release 路径，不得重复发包');
});

test('V2.38.2 stopZhu 统一走 npZeroBattle，且置零只从挂机结束路径触发', () => {
  const code = extract('  function stopZhu() {', '  // 无目标自动走路寻怪（2s 判定一次）');
  const calls = [];
  const ctx = { deathReturnStopping: false, deathReturnCancel() {}, zRunning: true, stopScan() {}, zAttTimer: null, clearInterval() {},
    zLock: { gid: 3, done: false }, zUseCounts: { a: 1 }, zLockCounts: { b: 1 }, dshDiag() {}, zMon: {},
    $id: () => ({ textContent: '' }), setStatus() {}, npZeroBattle: (r) => { calls.push(r); return 'already'; } };
  vm.createContext(ctx); vm.runInContext(code + ';this.stop=stopZhu', ctx);
  ctx.stop();
  assert.equal(JSON.stringify(calls), '["stopZhu"]', 'stopZhu 必须恰好置零一次');
  assert.equal(ctx.zRunning, false, 'stopZhu 仍然要停助手');
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal((src.match(/npZeroBattle\(/g) || []).length, 6, name + ' npZeroBattle 只允许 1 处定义 + 5 处挂机结束调用');
    assert.equal((src.match(/function npZeroBattle\(/g) || []).length, 1, name + ' 置零函数只能有一个定义');
    for (const c of ['npZeroBattle("stopZhu");', 'npZeroBattle("death-guard");', 'npZeroBattle("dojoStop");', 'npZeroBattle("换角色");', 'npZeroBattle("apiRelease");']) {
      assert.ok(src.includes(c), name + ' 缺少挂机结束调用点 ' + c);
    }
    const zwalk = src.slice(src.indexOf('  function zWalk() {'), src.indexOf('  function zAttack() {'));
    assert.ok(zwalk.length > 0 && !zwalk.includes('npZeroBattle'), name + ' 寻怪热路径绝不允许调用置零');
    assert.ok(!src.slice(src.indexOf('  function zAttack() {'), src.indexOf('  // 技能行统一序列化')).includes('npZeroBattle'), name + ' 攻击热路径绝不允许调用置零');
    assert.ok(src.includes('npHuntStop("walkToXY", true)'), name + ' 临时让位路径不得被改成置零');
  }
});
test('V2.38.2 换图分支无条件补一次停战：置零开关关闭时也停、面板明确已关时不盲发（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const seg = src.slice(src.indexOf('              npCalibrate();                     // 对齐服务器实际状态'), src.indexOf('              setStatus("换图：自动战斗已停止"'));
    assert.ok(seg.length > 0, name + ' 必须能切出换图停战分支');
    assert.ok(seg.includes('npHuntStop("map-change", true)'), name + ' 换图必须保留显式停战调用');
    assert.ok(/if \(npReadPanelState\(\) !== false\) \{ npHuntStop\("map-change", true\); \}/.test(seg), name + ' 换图停战必须无条件执行（不受置零开关门控），且面板明确已关时不盲发（toggle 型，盲发会把内挂打开）');
  }
  const s0 = source.indexOf('              npCalibrate();                     // 对齐服务器实际状态');
  const e0 = source.indexOf('              setStatus("换图：自动战斗已停止"');
  const code = source.slice(s0, e0);
  function run(zRunning, npHuntOn, panel) {
    const calls = [];
    const ctx = { zRunning: zRunning, npHuntOn: npHuntOn, npReadPanelState: () => panel,
      npCalibrate: () => calls.push('calibrate'), stopZhu: () => calls.push('stopZhu'),
      npHuntStop: (s, i) => calls.push('huntStop:' + s + ':' + i) };
    vm.createContext(ctx); vm.runInContext(code, ctx);
    return calls;
  }
  // 置零开关关闭（stopZhu 内部已不再置零）+ 面板说在跑 → 换图仍必须停服务器自动战斗（缓存说关也照发）
  assert.deepEqual(run(false, false, true), ['calibrate', 'huntStop:map-change:true'], '面板说在跑 → 换图无条件补一次停战');
  assert.deepEqual(run(false, false, null), ['calibrate', 'huntStop:map-change:true'], '面板读不到 → 换图也补一次停战');
  assert.deepEqual(run(false, true, true), ['calibrate', 'huntStop:map-change:true'], '纯内挂模式 → 换图停战照旧（缓存说开 + 面板说开）');
  // 面板明确已关 → 绝不盲发（toggle 型，盲发会把已经关掉的内挂又打开）
  assert.deepEqual(run(false, false, false), ['calibrate'], '面板说已关 → 换图一个包都不发');
  assert.deepEqual(run(false, true, false), ['calibrate'], '缓存说开但面板说关 → 换图仍一个包都不发');
  // 助手运行中 → 完整停止后再补一次兜底（正常只会 already，不重复发包）
  assert.deepEqual(run(true, false, true), ['calibrate', 'stopZhu', 'huntStop:map-change:true'], '助手运行中 → 先 stopZhu 再兜底停战');
  assert.deepEqual(run(true, true, false), ['calibrate', 'stopZhu'], '助手运行中 + 面板已关 → 不再补发');
});
// ================= V2.38.2 一键屏蔽其他玩家的摆摊商店（全局设置 dsh_ro_blockmc_v1） =================
const BLOCK_MC_ANCHOR = '  var BLOCK_MC_KEY = "dsh_ro_blockmc_v1";';
const BLOCK_MC_TAIL = '  function dispatchInbound(bytes) {';
function blockMcBlock(src) {
  const a = src.indexOf(BLOCK_MC_ANCHOR), b = src.indexOf(BLOCK_MC_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出摆摊屏蔽设置与关窗链路');
  return src.slice(a, b);
}
// 部署客户端 #NpcStore 假 DOM：类名严格取自 Online.js:376659 的模板
//   模板真实存在 .WinBuy/.WinSell/.WinVendingStore/.WinBuyingStore/.WinCash 与 .btn.buy/.btn.sell/.btn.cancel/.btn.ok，
//   确认模板里没有 .btn.close（旧假 DOM 对任意选择器都返回可点对象，所以 .btn.close 也能蒙混过关）。
//   setType 只改 style.display（Online.js:376703-376712 _hideAll/_showAll）→ 这里同款模拟。
function mcNode(cls, display) {
  const n = { cls: cls, style: { display: display, visibility: '' }, clicks: 0 };
  n.click = function () { n.clicks++; };
  return n;
}
function mcRoot(kind, opt) {
  opt = opt || {};
  // kind: vending=VENDING_STORE / buying=BUYING_STORE / buy=NPC 商店 / sell=收购 / barter=以物易物 / cash=点数商店 / blank=类型还没落定
  const shown = {
    WinVendingStore: kind === 'vending',
    WinBuyingStore: kind === 'buying',
    WinBuy: kind === 'buy' || kind === 'barter' || kind === 'cash',
    WinSell: kind === 'sell',
    WinCash: kind === 'cash',
  };
  const d = (c) => (shown[c] ? '' : 'none');
  const span = (c) => mcNode(c, d(c));
  const buy = mcNode('btn buy WinBuy WinVendingStore', d('WinBuy'));     // 模板：class="btn buy WinBuy WinVendingStore"（点=提交购买）
  const sell = mcNode('btn sell WinSell WinBuyingStore', d('WinSell')); // 模板：class="btn sell WinSell WinBuyingStore"（点=提交出售）
  const cancel = mcNode('btn cancel', '');                              // 模板：class="btn cancel" → Online.js:377098 remove()
  const ok = mcNode('btn ok', 'none');                                  // 模板：class="btn ok" 在 .PurchaseResult 里 → Online.js:377161 closeStore()
  const nodes = [span('WinVendingStore'), span('WinBuy'), span('WinSell'), span('WinBuyingStore'), span('WinCash'), buy, sell, cancel, ok];
  return {
    nodes: nodes, cancel: cancel, ok: ok, buy: buy, sell: sell, queries: 0,
    querySelector(sel) {
      this.queries++;
      if (opt.noClose && (sel === '.btn.cancel' || sel === '.btn.ok')) return null; // 窗口在但拿不到关闭按钮
      const want = String(sel).replace(/^\./, '').split('.'); // '.btn.cancel' = 同时带 btn 与 cancel 两个类
      for (let i = 0; i < nodes.length; i++) {
        const have = (' ' + nodes[i].cls + ' ').split(' ');
        if (want.every((c) => have.indexOf(c) >= 0)) return nodes[i];
      }
      return null;
    },
  };
}
function blockMcBoot(stored, block, opt) {
  opt = opt || {};
  const store = new Map();
  if (stored !== undefined) store.set('dsh_ro_blockmc_v1', stored);
  const status = [], logs = [], timers = [], els = {};
  let now = 1000;
  function mount(kind, hopt) {
    hopt = hopt || {};
    const host = { style: { display: hopt.hidden === true ? 'none' : 'block', visibility: '' } };
    const root = mcRoot(kind, hopt);
    Object.defineProperty(host, 'shadowRoot', { get() { if (hopt.boomShadow) throw new Error('boom-shadow'); return root; } });
    els.NpcStore = host;
    host.root = root;
    return host;
  }
  const ctx = {
    JSON, Math,
    Date: { now: () => now },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: { getElementById: (id) => els[id] || null },
    getComputedStyle: (el) => ({ display: (el && el.style && el.style.display) || 'block', visibility: (el && el.style && el.style.visibility === 'hidden') ? 'hidden' : 'visible' }),
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: () => {},
    setStatus: (t, c) => status.push([t, c]),
    tlog: (t) => logs.push(t),
  };
  vm.createContext(ctx);
  vm.runInContext(block + ';this.hit=blockMcHit;this.on=blockMcEnabled;this.save=blockMcSave', ctx);
  return {
    ctx, els, status, logs, timers, store, mount,
    pump(max) { let n = 0; while (timers.length && n++ < (max || 400)) { const t = timers.shift(); if (t.ms > 0 && t.ms < 1000) now += t.ms; t.fn(); } },
  };
}

test('V2.38.2 摆摊屏蔽设置：默认开、读取失败按开、勾选框在功能菜单（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('var BLOCK_MC_KEY = "dsh_ro_blockmc_v1";'), name + ' 必须用稳定全局键 dsh_ro_blockmc_v1');
    assert.ok(src.includes('var blockMcCfg = { enabled: true };'), name + ' 默认值必须是开');
    assert.ok(src.includes('roMenuRow(body, "点击其他玩家的摆摊商店不弹出窗口（默认开）", bmc);'), name + ' 功能菜单里必须有表达两层含义的中文勾选框');
    assert.ok(src.includes('blockMcSave(bmc.checked);'), name + ' 勾选必须立刻落盘');
    assert.ok(src.includes('已开启：点击其他玩家的摆摊商店不弹出窗口') && src.includes('已关闭：点击立即恢复正常'), name + ' 勾选进/出都要有中文 setStatus 提示（并说明取消后点击立即恢复正常）');
    assert.ok(!/BLOCK_MC_KEY\s*\+\s*['"]:/.test(src) && !src.includes('blockMcStorageKey'), name + ' 屏蔽开关必须是全局键（不得逐角色分档）');
    const block = blockMcBlock(src);
    const on = blockMcBoot(undefined, block);
    assert.equal(on.ctx.on(), true, name + ' 无值时一律按开');
    for (const bad of ['{坏', 'null', '[]', '"x"', '{"enabled":"yes"}', '{"enabled":0}', '0']) {
      assert.equal(blockMcBoot(bad, block).ctx.on(), true, name + ' 读取失败(' + bad + ')必须按开');
    }
    const off = blockMcBoot('{"enabled":false}', block);
    assert.equal(off.ctx.on(), false, name + ' 只有显式 enabled:false 才算关');
    off.ctx.save(true);
    assert.equal(off.store.get('dsh_ro_blockmc_v1'), '{"enabled":true}', name + ' 重新勾选必须立刻落盘');
    assert.equal(off.ctx.on(), true, name + ' 重新勾选后立刻生效');
  }
});

test('V2.38.2 摆摊屏蔽：识别集合恰好 307/2048/2877/2072，NPC 商人 198/199 与单价读取完全不受影响（VM）', () => {
  const CALL = '      if (op === 307 || op === 2048 || op === 2877 || op === 2072) blockMcHit();';
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes(CALL), name + ' 必须在 dispatchInbound 里就地识别摆摊三包');
    assert.equal((src.match(/op === 307/g) || []).length, 1, name + ' 识别集合只允许出现一处');
    assert.ok(!/op === 198|op === 199/.test(src), name + ' 198/199 绝不能进摆摊识别集合');
    assert.ok(src.includes('else if (op === 0xc6 || op === 0xc7) itipShopPkt(bytes, op);'), name + ' 既有的 0xc6/0xc7 买卖单价读取必须还在');
    assert.ok(src.includes('ITIP.buy[itid6] = { price: dv.getInt32(o6, true), discountprice: dv.getInt32(o6 + 4, true) };'), name + ' itipShopPkt 买价解析不得改动');
  }
  const code = extract('  function dispatchInbound(bytes) {', '  function onSelfSpirits(bytes, frameOff, lenTblOk) {');
  const calls = { mc: 0, shop: [], raw: [] };
  const ctx = { Math, Date, collectOpStat() {}, itipPktProbe() {}, txCap: { on: false }, DPS_PKTS: [], dpsParsedSeen: false,
    dpsOnRawDamage() {}, scrOnRawVanish() {}, onMenuList() {}, onSayDialog() {}, onCloseDialog() {}, onSkillPostDelay() {}, onSkillAck3() {}, onSelfSpirits() {},
    itipShopPkt: (b, op) => calls.shop.push(op), onRawOpcode: (b, op) => calls.raw.push(op), blockMcHit: () => calls.mc++ };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.dispatch=dispatchInbound;this.pkt=function(op){var b=new ArrayBuffer(8);new DataView(b).setUint16(0,op,true);return b;}', ctx);
  const seen = [];
  for (const op of [307, 2048, 2877, 2072]) { const n = calls.mc; ctx.dispatch(ctx.pkt(op)); assert.equal(calls.mc, n + 1, '必须识别摆摊包 ' + op); seen.push(calls.mc); }
  assert.deepEqual(seen, [1, 2, 3, 4], '四个回包（摆摊三版本 + 收购店 2072）各命中一次');
  for (const op of [198, 199, 0x80, 183, 2842]) { const n = calls.mc; ctx.dispatch(ctx.pkt(op)); assert.equal(calls.mc, n, '不得把 ' + op + ' 当摆摊窗口'); }
  assert.deepEqual(calls.shop, [198, 199], 'NPC 商店 198/199 仍要走 itipShopPkt');
  assert.ok(calls.raw.indexOf(307) >= 0 && calls.raw.indexOf(2877) >= 0, '摆摊包仍要进既有 onRawOpcode（不吞包）');
});

test('V2.38.2 摆摊屏蔽第一层：2072（ACK_ITEMLIST_BUYING_STORE）也兜底，且能正确关掉 .WinBuyingStore 窗口；198/199 永不触发（VM）', () => {
  const block = blockMcBlock(source);
  const disp = extract('  function dispatchInbound(bytes) {', '  function onSelfSpirits(bytes, frameOff, lenTblOk) {');
  const B = blockMcBoot(undefined, block);
  // 把 dispatchInbound 接进同一个 VM：2072 必须走到真正的 blockMcHit（而不是只数调用次数）
  B.ctx.collectOpStat = () => {}; B.ctx.itipPktProbe = () => {}; B.ctx.txCap = { on: false };
  B.ctx.DPS_PKTS = []; B.ctx.dpsParsedSeen = false;
  B.ctx.dpsOnRawDamage = () => {}; B.ctx.scrOnRawVanish = () => {};
  B.ctx.onMenuList = () => {}; B.ctx.onSayDialog = () => {}; B.ctx.onCloseDialog = () => {};
  B.ctx.onSkillPostDelay = () => {}; B.ctx.onSkillAck3 = () => {}; B.ctx.onSelfSpirits = () => {};
  B.ctx.itipShopPkt = () => {}; B.ctx.onRawOpcode = () => {};
  vm.runInContext(disp + ';this.dispatch=dispatchInbound;this.pkt=function(op){var b=new ArrayBuffer(8);new DataView(b).setUint16(0,op,true);return b;}', B.ctx);
  const h = B.mount('buying', { hidden: true }); // .WinBuyingStore = 玩家收购店
  B.ctx.dispatch(B.ctx.pkt(2072));
  assert.equal(h.root.cancel.clicks, 1, '2072 是玩家收购店回包，第一层必须兜底关窗');
  assert.equal(h.root.buy.clicks + h.root.sell.clicks + h.root.ok.clicks, 0, '只点客户端关闭按钮，绝不点买卖/确定');
  assert.ok(B.status.join('|').includes('已关闭其他玩家的摆摊商店'), '2072 必须写中文关窗状态');
  const n = B.status.length;
  B.ctx.dispatch(B.ctx.pkt(198));
  B.ctx.dispatch(B.ctx.pkt(199));
  assert.equal(B.status.length, n, '198/199（NPC 商店买卖列表）绝不能触发摆摊关窗');
  assert.equal(h.root.cancel.clicks, 1, '198/199 不得再点任何按钮');
});

test('V2.38.2 摆摊屏蔽关窗链路：按窗口类型判定后只点 .btn.cancel（退路 .btn.ok），绝不点 .btn.buy/.btn.sell、不自己发包（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const block = blockMcBlock(src);
    assert.doesNotMatch(block, /sendPacket|czp\(|CLIENT\.PS\.CZ|hookPacket/, name + ' 屏蔽链路绝不能自己发包');
    assert.ok(block.includes('root.querySelector(".btn.cancel") || root.querySelector(".btn.ok")'), name + ' 关窗必须点客户端真实关闭按钮 .btn.cancel（拿不到再退 .btn.ok）');
    assert.ok(!block.includes('.btn.close'), name + ' #NpcStore 里不存在 .btn.close（旧选择器 100% 空转，必须删干净）');
    assert.ok(block.includes('document.getElementById("NpcStore")'), name + ' 必须复用既有的 #NpcStore 定位');
    assert.ok(block.indexOf('return "disabled"') < 0, name + ' 关闭动作必须由 blockMcHit 自身短路');
    // 摆摊类型判别必须读 .WinVendingStore/.WinBuyingStore 的 style.display（_hideAll/_showAll 改的就是它）
    assert.ok(block.includes('root.querySelector(".WinVendingStore")') && block.includes('root.querySelector(".WinBuyingStore")'), name + ' 必须按窗口类型判别摆摊窗口');
    assert.ok(block.includes('display !== "none"'), name + ' 类型判别必须看 style.display 是否为 none');
    // 三种收尾文案必须各自区分（窗口没出现 / 出现的不是摆摊 / 摆摊但找不到按钮）
    for (const m of ['摆摊商店 1.5 秒内未出现，已恢复显示', '出现的不是摆摊商店窗口，未做处理，已恢复显示', '摆摊商店窗口已出现但未找到关闭按钮，已恢复显示']) {
      assert.ok(block.includes(m), name + ' 缺少中文收尾文案：' + m);
    }
  }
  const block = blockMcBlock(source);
  // A：摆摊窗口本来就开着（VENDING_STORE）→ 恰好点一次 .btn.cancel，买卖按钮一个都不许点
  const A = blockMcBoot(undefined, block), hA = A.mount('vending');
  A.ctx.hit();
  assert.equal(hA.root.cancel.clicks, 1, '命中摆摊窗口必须点一次客户端关闭按钮');
  assert.equal(hA.root.ok.clicks, 0, '能拿到 .btn.cancel 就不得退到 .btn.ok');
  assert.equal(hA.root.buy.clicks, 0, '绝不能点 .btn.buy（那是提交购买）');
  assert.equal(hA.root.sell.clicks, 0, '绝不能点 .btn.sell（那是提交出售）');
  assert.ok(hA.root.queries > 0, '必须真的去查过窗口类型与关闭按钮');
  assert.equal(hA.style.visibility, '', '本来就开着的窗口不得改可见性');
  assert.equal(A.timers.length, 0, '关完不得再轮询');
  A.pump();
  assert.equal(hA.root.cancel.clicks, 1, '一次命中只关一次，不得反复点');
  assert.ok(A.status.join('|').includes('已关闭其他玩家的摆摊商店'), '必须写中文状态');
  assert.ok(A.logs.join('|').includes('block-mc'), '必须写 tlog');
  assert.equal(A.store.get('dsh_ro_blockmc_v1'), undefined, '关窗不得顺手动设置键');
  // B：BUYING_STORE 也是摆摊类型 → 同样关掉；防闪烁路径先藏后关、收尾恢复
  const B = blockMcBoot(undefined, block), hB = B.mount('buying', { hidden: true });
  B.ctx.hit();
  assert.equal(hB.root.cancel.clicks, 1, 'BUYING_STORE 同样是摆摊窗口，必须关');
  assert.equal(hB.root.ok.clicks + hB.root.buy.clicks + hB.root.sell.clicks, 0);
  assert.equal(hB.style.visibility, '', '关完必须恢复可见性');
  // C：NPC 商人商店（BUY）→ 一个按钮都不点，立刻恢复可见性并写说明（客户端关窗会发关店包）
  const C = blockMcBoot(undefined, block), hC = C.mount('buy', { hidden: true });
  C.ctx.hit();
  assert.equal(hC.root.cancel.clicks, 0, 'NPC 商店绝不能点关闭按钮');
  assert.equal(hC.root.ok.clicks + hC.root.buy.clicks + hC.root.sell.clicks, 0, 'NPC 商店一个按钮都不许点');
  assert.equal(hC.style.visibility, '', '非摆摊窗口必须立刻恢复可见性');
  assert.equal(C.timers.length, 0, '不是摆摊窗口就不再轮询');
  assert.ok(C.status.join('|').includes('出现的不是摆摊商店窗口'), '必须写中文说明');
  const nC = C.status.length; C.pump();
  assert.equal(C.status.length, nC, '收尾后不得再动作');
  // C2：收购 / 以物易物 / 点数商店同样一个按钮都不点
  for (const kind of ['sell', 'barter', 'cash']) {
    const S = blockMcBoot(undefined, block), hS = S.mount(kind);
    S.ctx.hit();
    assert.equal(hS.root.cancel.clicks + hS.root.ok.clicks + hS.root.buy.clicks + hS.root.sell.clicks, 0, kind + ' 不是摆摊类型，不得点任何按钮');
    assert.ok(S.status.join('|').includes('出现的不是摆摊商店窗口'), kind + ' 必须写明未做处理');
    assert.equal(hS.style.visibility, '', kind + ' 必须恢复可见性');
  }
  // D（V3）：宿主元素中途被替换 → 收尾恢复的必须是当初被隐藏的那个元素，旧元素不得永久隐藏
  const D = blockMcBoot(undefined, block);
  const d1 = D.mount('blank', { hidden: true }); // 类型还没落定 → 一直等（不点、不提前收尾）
  D.ctx.hit();
  assert.equal(d1.style.visibility, 'hidden', '防闪烁：本来没开着的先藏起来');
  const d2 = D.mount('blank', { hidden: true }); // 宿主被替换
  assert.notEqual(d1, d2);
  D.pump(400);
  assert.equal(d1.style.visibility, '', '收尾必须恢复当初被隐藏的那个元素（否则旧元素被永久隐藏）');
  assert.equal(d2.style.visibility, '', '替换后的新元素从未被隐藏，不得被改写');
  assert.equal(D.timers.length, 0, '超时后必须停止轮询');
  assert.ok(D.status.join('|').includes('摆摊商店 1.5 秒内未出现'), '未落定窗口按「未出现」收尾');
  // E：摆摊窗口出现了但拿不到关闭按钮 → 文案必须单独区分，且恢复可见性
  const E = blockMcBoot(undefined, block), hE = E.mount('vending', { hidden: true, noClose: true });
  E.ctx.hit();
  assert.equal(hE.root.cancel.clicks + hE.root.ok.clicks + hE.root.buy.clicks + hE.root.sell.clicks, 0, '没有被点的按钮');
  assert.equal(hE.style.visibility, 'hidden', '窗口已出现但还没关上 → 先藏着防闪烁');
  E.pump(400);
  assert.equal(hE.style.visibility, '', '超时也必须恢复可见性');
  assert.ok(E.status.join('|').includes('摆摊商店窗口已出现但未找到关闭按钮'), '必须单独写「找不到关闭按钮」');
  assert.ok(!E.status.join('|').includes('1.5 秒内未出现'), '不能把两种情况混成同一条文案');
  assert.equal(E.timers.length, 0, '超时后必须停止轮询');
  const nE = E.status.length; E.pump();
  assert.equal(E.status.length, nE, '超时后不得再动作');
  // F：#NpcStore 始终没出现 → 同样超时收尾，不抛异常
  const F = blockMcBoot(undefined, block);
  F.ctx.hit();
  F.pump(400);
  assert.equal(F.timers.length, 0, '窗口始终不出现也必须超时收尾');
  assert.equal(F.status.length, 1, '始终不出现只写一条状态');
  assert.ok(F.status.join('|').includes('摆摊商店 1.5 秒内未出现'), '文案必须是「未出现」');
  // G：窗口稍后才出现 → 出现即关一次，之后不再点
  const G = blockMcBoot(undefined, block);
  G.ctx.hit();
  G.pump(2);
  assert.equal(G.status.length, 0, '还没出现时不得空写状态');
  const g1 = G.mount('vending');
  G.pump(2);
  assert.equal(g1.root.cancel.clicks, 1, '窗口稍后出现也必须关一次');
  G.pump();
  assert.equal(g1.root.cancel.clicks, 1, '关完不得反复点');
  assert.equal(g1.style.visibility, '', '关完必须恢复可见性');
  // H：设置关闭 → 零查询零动作（摆摊窗口照原样弹出）
  const OFF = blockMcBoot('{"enabled":false}', block), hOff = OFF.mount('vending');
  OFF.ctx.hit();
  assert.equal(hOff.root.cancel.clicks + hOff.root.ok.clicks + hOff.root.buy.clicks + hOff.root.sell.clicks, 0, '设置关闭时不得关摆摊窗口');
  assert.equal(hOff.root.queries, 0, '设置关闭时连窗口查询都不做');
  assert.equal(hOff.style.visibility, '', '设置关闭时不得改可见性');
  assert.equal(OFF.timers.length, 0, '设置关闭时不得起轮询');
  assert.equal(OFF.status.length, 0, '设置关闭时不得写状态');
  assert.equal(OFF.logs.length, 0, '设置关闭时不得写日志');
  // I（Z4）：链路异常（#NpcStore 根节点取 shadowRoot 抛错）必须被吞掉 → 可见性恢复、pending 清空、不抛异常
  const I = blockMcBoot(undefined, block);
  const iHost = I.mount('vending', { hidden: true, boomShadow: true });
  I.ctx.hit();
  assert.equal(iHost.style.visibility, '', '异常时也必须恢复可见性（绝不能把窗口永久藏起来）');
  assert.ok(I.status.join('|').includes('屏蔽摆摊商店异常'), '异常必须有中文状态提示');
  assert.equal(I.timers.length, 0, '异常后 pending 必须清空，不得继续轮询');
  const nI = I.status.length;
  I.pump();
  assert.equal(I.status.length, nI, 'pending 已清空，异常后不得再动作');
  // I2：同一条异常链路接进 dispatchInbound → 异常必须被吞掉，后续分支仍被调用（不吞包）
  const code = extract('  function dispatchInbound(bytes) {', '  function onSelfSpirits(bytes, frameOff, lenTblOk) {');
  const raw = [];
  const dctx = { Math, Date, collectOpStat() {}, itipPktProbe() {}, txCap: { on: false }, DPS_PKTS: [], dpsParsedSeen: false,
    dpsOnRawDamage() {}, scrOnRawVanish() {}, onMenuList() {}, onSayDialog() {}, onCloseDialog() {}, onSkillPostDelay() {}, onSkillAck3() {}, onSelfSpirits() {},
    itipShopPkt() {}, onRawOpcode: (b, op) => raw.push(op), blockMcHit: () => { I.ctx.hit(); } };
  vm.createContext(dctx);
  vm.runInContext(code + ';this.dispatch=dispatchInbound;this.pkt=function(op){var b=new ArrayBuffer(8);new DataView(b).setUint16(0,op,true);return b;}', dctx);
  const nI2 = I.status.length;
  dctx.dispatch(dctx.pkt(307));
  assert.equal(I.status.length, nI2 + 1, '异常路径仍要被吞掉并写一条中文状态');
  assert.ok(raw.indexOf(307) >= 0, '摆摊链路异常绝不能吞包，dispatchInbound 后续分支仍要执行');
  assert.equal(iHost.style.visibility, '', 'dispatchInbound 这条链路异常后可见性同样被恢复');
});


// ================= V2.38.2 点击其他玩家的摊位/收购店：客户端发出请求前直接拦截（第二层） =================
const DROP_TXBUILD_HEAD = '  function txBuild(p) {';
const DROP_HOOK_HEAD = '  function hookSendPacket() {';
const DROP_HOOK_TAIL = '  function txExport() {';
const DROP_RES_HEAD = '  function blockMcDropResolve() {';
const DROP_RES_TAIL = '  var blockMcDropLastLog = 0;';
function segOf(src, head, tail) {
  const a = src.indexOf(head), b = src.indexOf(tail, a);
  assert.ok(a >= 0 && b > a, '必须能切出 ' + head);
  return src.slice(a, b);
}
// txBuild + 第二层拦截 + NM.sendPacket 包装
function blockMcDropChain(src) {
  const seg = segOf(src, DROP_TXBUILD_HEAD, DROP_HOOK_HEAD) + '\n' + segOf(src, DROP_HOOK_HEAD, DROP_HOOK_TAIL);
  assert.ok(seg.includes('blockMcDropResolve') && seg.includes('blockMcDropCheck'), '第二层拦截必须位于 txBuild 与 hookSendPacket 之间');
  assert.ok(seg.includes('if (blockMcDropCheck(p)) {'), '包装函数里必须有丢包分支');
  return seg;
}
// 桩包类：ver 不给就只留 build（= REQ_BUY_FROMMC 那种写死 opcode 的类）
function dropCzCls(ver, bytes, counter) {
  const bump = () => { if (counter) counter.n++; };
  const C = function () {};
  if (ver != null) C.prototype.getPacketVersion = function () { bump(); return [20200101, ver]; };
  C.prototype.build = function () { bump(); const b = new ArrayBuffer(4); new DataView(b).setUint16(0, bytes, true); return new Uint8Array(b); };
  return C;
}
// 线上真实组合：REQ_BUY_FROMMC.build() 写死 304；REQ_CLICK_TO_BUYING_STORE 走版本表——
//   部署客户端 packetver=20211103 下该 CZ 类是 2071（2877 是 ZC 侧 PC_PURCHASE_ITEMLIST_FROMMC 的版本值，两侧绝不能混用）
const DROP_REAL_CZ = { REQ_BUY_FROMMC: dropCzCls(null, 304), REQ_CLICK_TO_BUYING_STORE: dropCzCls(2071, 2071) };
const dropPktVer = (op) => ({ getPacketVersion: function () { return [20200101, op]; } });
const dropPktBuild = (op) => ({ build: function () { const b = new ArrayBuffer(4); new DataView(b).setUint16(0, op, true); return new Uint8Array(b); } });
function blockMcDropBoot(src, opt) {
  opt = opt || {};
  const store = new Map();
  if (opt.stored !== undefined) store.set('dsh_ro_blockmc_v1', opt.stored);
  const logs = [], status = [];
  let calls = 0;
  const CLIENT = { PS: { CZ: opt.CZ || {} }, NM: { sendPacket: function () { calls++; return 'orig'; } } };
  const txCap = { on: !!opt.capOn, ring: [], hooked: false, n: 0, drop: 0, lastLog: 0 };
  let fakeNow = 1000000; // V2.38.3：opt.fakeClock 时用可控时钟，便于断言 5 秒限流窗口（默认仍是真实 Date）
  const ctx = {
    JSON, Math, Date: opt.fakeClock === true ? { now: () => fakeNow } : Date, Object,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: { getElementById: () => null },
    czPacketVer: () => ctx.__ver, // 复用生产同名函数：packetVer 一变必须让解析缓存作废
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: () => 0, clearTimeout: () => {},
    setStatus: (t2, c) => status.push([t2, c]),
    tlog: (t2) => logs.push(t2),
    CLIENT, txCap, clientReady: () => true, $id: () => null,
  };
  vm.createContext(ctx);
  const code = blockMcBlock(src) + '\n' + segOf(src, '  function czOpcodeBoth(Ctor) {', '  // 探测 + 就地安装') + '\n' + blockMcDropChain(src);
  vm.runInContext(code + ';this.hook=hookSendPacket;this.enabled=blockMcEnabled;this.save=blockMcSave;this.raw=function(){return blockMcDropResolve();}', ctx);
  ctx.hook();
  ctx.__ver = 0;
  return {
    ctx, logs, status, store, txCap, client: CLIENT, setVer: (v) => { ctx.__ver = v; }, calls: () => calls,
    tick: (ms) => { fakeNow += ms; },
    send: (p) => CLIENT.NM.sendPacket(p),
    ops: () => Object.keys(ctx.raw()).map(Number).sort((a, b) => a - b),
  };
}

test('V2.38.2 摊位拦截 opcode 解析：优先 getPacketVersion()[1]，拿不到回落 build() 前两字节小端、结果缓存（VM）', () => {
  // 两个口径不一致 → 必须用版本口径（= getPacketVersion()[1]）
  const A = blockMcDropBoot(source, { CZ: { REQ_BUY_FROMMC: dropCzCls(111, 222), REQ_CLICK_TO_BUYING_STORE: dropCzCls(333, 444) } });
  assert.deepEqual(A.ops(), [111, 333], '有 getPacketVersion 必须优先取 [1]，不得用 build() 的字节口径');
  // 只有 build 的类 → 读 build() 前两字节小端
  const B = blockMcDropBoot(source, { CZ: { REQ_BUY_FROMMC: dropCzCls(null, 304), REQ_CLICK_TO_BUYING_STORE: dropCzCls(null, 305) } });
  assert.deepEqual(B.ops(), [304, 305], '拿不到版本口径必须回落 build() 前两字节小端');
  // 线上真实组合 → 恰好这两个 opcode；同一包版本必须命中缓存（解析计数不得再涨）
  const ctr = { n: 0 };
  const C = blockMcDropBoot(source, { CZ: { REQ_BUY_FROMMC: dropCzCls(null, 304, ctr), REQ_CLICK_TO_BUYING_STORE: dropCzCls(2071, 2071, ctr) } });
  assert.deepEqual(C.ops(), [304, 2071], '解析出的集合必须恰好是这两个 opcode');
  assert.equal(ctr.n, 3, '第一次解析：只有 build 的类读 1 次，有版本口径的类读 getPacketVersion+build 各 1 次');
  assert.ok(Object.is(C.ctx.raw(), C.ctx.raw()), '同一版本必须返回同一个缓存对象');
  assert.equal(ctr.n, 3, '包版本没变 → 第二次绝不重新解析（旧断言自比自恒真，此处改为解析调用计数）');
});

test('V2.38.2 摊位拦截解析缓存：客户端 packetver 改变必须重新解析（旧 opcode 立即失效、新 opcode 生效）（VM）', () => {
  const CZ = { REQ_BUY_FROMMC: dropCzCls(111, 111), REQ_CLICK_TO_BUYING_STORE: dropCzCls(222, 222) };
  const B = blockMcDropBoot(source, { CZ: CZ, capOn: true });
  assert.deepEqual(B.ops(), [111, 222], '首次解析');
  let n = B.calls(); B.send(dropPktVer(111));
  assert.equal(B.calls(), n, '首次解析后 111 必须被拦住');
  CZ.REQ_BUY_FROMMC = dropCzCls(333, 333); // 同一 packetver 下偷偷换包类定义 → 必须仍走缓存
  n = B.calls(); B.send(dropPktVer(111));
  assert.equal(B.calls(), n, '包版本没变必须继续用缓存（不得每个包都重新解析）');
  B.setVer(20211103); // 同一页面会话内 packetver 会变（Online.js:315656/315663/389047 三处赋值）
  assert.deepEqual(B.ops(), [222, 333], '包版本一变必须重新解析');
  n = B.calls(); B.send(dropPktVer(111));
  assert.equal(B.calls(), n + 1, '旧 opcode 111 在新版本下必须立刻不再命中（正常包不得被误丢）');
  n = B.calls(); B.send(dropPktVer(333));
  assert.equal(B.calls(), n, '新 opcode 333 必须生效并被拦截');
});

test('V2.38.2/V2.38.3 摊位拦截：解析失败绝不缓存空集 → 限流期满重试解析后包类补齐即可拦（VM）', () => {
  const B = blockMcDropBoot(source, { CZ: {}, capOn: true, fakeClock: true });
  assert.deepEqual(B.ops(), [], '客户端还没就绪时解析不到 → 空集');
  let n = B.calls(); B.send(dropPktVer(304));
  assert.equal(B.calls(), n + 1, '解析不到时一个包都不许丢（fail-safe）');
  B.client.PS.CZ.REQ_BUY_FROMMC = dropCzCls(304, 304);      // 真实包类随后才挂回来
  B.client.PS.CZ.REQ_CLICK_TO_BUYING_STORE = dropCzCls(2071, 2071);
  n = B.calls(); B.send(dropPktVer(304));
  assert.equal(B.calls(), n + 1, 'V2.38.3：不完整解析后 5 秒限流窗口内不重解析（避免每个包都重解析）');
  assert.deepEqual(B.ops(), [], '限流窗口内沿用上次的不完整结果（这里恰好是空集），绝不写正式缓存');
  B.tick(5001);
  n = B.calls(); B.send(dropPktVer(304));
  assert.equal(B.calls(), n, '限流期满重试解析后，已补齐的 304 必须被拦');
  n = B.calls(); B.send(dropPktVer(2071));
  assert.equal(B.calls(), n, '2071 同样必须被拦');
  assert.equal(B.txCap.drop, 2, '两次拦截计数必须正确');
});

test('V2.38.2 摊位拦截：设置关闭 → 命中包也照旧发出，抓包记录行为完全不变（VM）', () => {
  const B = blockMcDropBoot(source, { stored: '{"enabled":false}', capOn: true, CZ: DROP_REAL_CZ });
  for (let i = 0; i < 3; i++) B.send(dropPktVer(304));
  B.send(dropPktVer(2071));
  assert.equal(B.calls(), 4, '设置关闭：命中拦截集合的包也必须一次不落地照原样发出');
  assert.equal(B.txCap.ring.length, 4, '设置关闭：出站抓包记录行为与改动前完全一致');
  assert.equal(B.txCap.n, 4, '设置关闭：抓包计数照旧');
  assert.equal(B.logs.length, 0, '设置关闭不得写任何日志');
  assert.equal(B.status.length, 0, '设置关闭不得写任何状态');
});

test('V2.38.2 摊位拦截：设置开启 + 命中 opcode → orig 一次都不被调用，抓包环里只留带 drop 标记的拦截记录（VM）', () => {
  const B = blockMcDropBoot(source, { capOn: true, CZ: DROP_REAL_CZ });
  for (let i = 0; i < 5; i++) B.send(dropPktVer(304));
  B.send(dropPktVer(2071));
  B.send(dropPktBuild(304)); // 拿不到版本口径 → 回落 build 也必须拦得住
  assert.equal(B.calls(), 0, '命中拦截集合的包一次都不许发出去（这就是「点击不生效」）');
  assert.equal(B.txCap.ring.length, 7, '抓包开启时被丢的包必须在环里留痕');
  assert.equal(B.txCap.ring.every((r) => r.drop === true), true, '这 7 条全部是拦截记录，绝不冒充一次正常发送');
  assert.equal(B.txCap.drop, 7, '被丢的包必须有独立计数');
  assert.equal(B.txCap.n, 7, '抓包计数与环内条数一致');
  assert.equal(B.logs.length, 1, '中文提示必须限流（1.5 秒内最多一条）');
  assert.equal(B.status.length, 1, '状态提示同样限流');
  assert.ok(B.logs[0].includes('已拦截一次点击其他玩家商店的请求'), '必须写中文 tlog');
});

test('V2.38.2 摊位拦截：抓包开启时被丢的包有可区分的 drop 记录/计数（VM）', () => {
  const B = blockMcDropBoot(source, { capOn: true, CZ: DROP_REAL_CZ });
  B.send(dropPktVer(304));
  assert.equal(B.calls(), 0, '被丢的包一次都不许发出去');
  assert.equal(B.txCap.ring.length, 1, '抓包开启时被丢的包必须留痕');
  const rec = B.txCap.ring[0];
  assert.equal(rec.drop, true, '记录必须带 drop 标记（不与正常发包混淆）');
  assert.equal(rec.d, 'U', '方向仍标成客户端发出尝试');
  assert.equal(rec.op, 304, '记录里必须能看到被拦的是哪个 opcode');
  assert.equal(B.txCap.drop, 1, '独立丢弃计数 = 1');
  assert.equal(B.txCap.n, 1, '抓包总数与环内条数一致');
  B.send(dropPktVer(2071));
  assert.equal(B.txCap.drop, 2, '再拦一次计数累加');
  assert.equal(B.txCap.ring.length, 2);
  // 未命中包行为一字不改：照旧发出、记录不带 drop 标记、不进丢弃计数
  B.send(dropPktVer(150));
  assert.equal(B.calls(), 1, '非命中包照旧原样发出');
  assert.equal(B.txCap.ring[2].drop, undefined, '正常发送的记录不得带 drop 标记');
  assert.equal(B.txCap.drop, 2, '正常包不得计入丢弃数');
  assert.equal(B.txCap.n, 3, '正常包照旧计数');
});

test('V2.38.2 摊位拦截：设置开启 + 非命中 opcode（NPC 商店/移动/助手自己的包）一律原样放行（VM）', () => {
  const B = blockMcDropBoot(source, { capOn: true, CZ: DROP_REAL_CZ });
  const others = [198, 199, 0xa7, 2842, 0x96, 150];
  for (const op of others) { const n = B.calls(); B.send(dropPktVer(op)); assert.equal(B.calls(), n + 1, '非命中包必须原样发出：' + op); }
  const n0 = B.calls(); B.send({}); assert.equal(B.calls(), n0 + 1, '读不出 opcode 的包必须原样放行（绝不误伤）');
  assert.equal(B.txCap.ring.length, others.length + 1, '非命中包照旧进抓包环');
  assert.equal(B.logs.length, 0, '非命中包不得写拦截日志');
  assert.deepEqual(B.ops(), [304, 2071], '拦截集合始终只有这两个 opcode');
});

test('V2.38.2 摊位拦截 fail-safe：两个包类都解析不到 → 一个包都不丢，只写一条中文说明（VM）', () => {
  const B = blockMcDropBoot(source, { CZ: {} });
  assert.deepEqual(B.ops(), [], '解析不到必须是空集');
  assert.equal(B.logs.length, 1, '解析失败必须写一条中文 tlog');
  assert.ok(B.logs[0].includes('解析不到'), '必须说明解析失败');
  assert.ok(B.logs[0].includes('仍由回包关窗兜底'), '必须说明仍由第一层兜底');
  for (const op of [304, 2071, 307, 2048, 198]) { const n = B.calls(); B.send(dropPktVer(op)); assert.equal(B.calls(), n + 1, 'fail-safe：解析不到时一个包都不许丢：' + op); }
  assert.equal(B.logs.length, 1, '解析失败只写一条，不得每个包都刷');
});

test('V2.38.2 摊位拦截：每次发包现场读设置（同一次运行先开后关，关掉后立即恢复发包）（VM）', () => {
  const B = blockMcDropBoot(source, { CZ: DROP_REAL_CZ });
  B.send(dropPktVer(304));
  assert.equal(B.calls(), 0, '开启时命中必须丢');
  B.ctx.save(false);
  B.send(dropPktVer(304));
  assert.equal(B.calls(), 1, '同一次运行里关掉后必须立即恢复正常发包（不得用启动时的缓存）');
  B.send(dropPktVer(2071));
  assert.equal(B.calls(), 2, '关掉后两个 opcode 都必须恢复');
  B.ctx.save(true);
  B.send(dropPktVer(304));
  assert.equal(B.calls(), 2, '重新打开后立即恢复拦截');
  assert.equal(B.store.get('dsh_ro_blockmc_v1'), '{"enabled":true}', '开关仍用既有键落盘');
});

test('V2.38.2 摊位拦截静态断言：丢包分支在 orig.apply 之前、两个包名只出现在解析函数里（静态）', () => {
  const noComment = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const hook = segOf(src, DROP_HOOK_HEAD, DROP_HOOK_TAIL);
    const a = hook.indexOf('CLIENT.NM.sendPacket = function (p) {');
    const b = hook.indexOf('txCap.hooked = true;', a);
    assert.ok(a >= 0 && b > a, name + ' 必须能切出 NM.sendPacket 包装函数');
    const wrap = hook.slice(a, b);
    const iDrop = wrap.indexOf('blockMcDropCheck(p)');
    const iOrig = wrap.indexOf('return orig.apply(this, arguments)');
    assert.ok(iDrop >= 0 && iOrig > iDrop, name + ' 丢包分支必须出现在 orig.apply 之前');
    assert.equal((wrap.match(/orig\.apply/g) || []).length, 1, name + ' 包装函数只允许一处转发 orig');
    const res = segOf(src, DROP_RES_HEAD, DROP_RES_TAIL);
    assert.ok(res.includes('CLIENT.PS') && res.includes('czOpcodeBoth('), name + ' 解析函数必须运行时读包并复用 czOpcodeBoth');
    const all = noComment(src), resCode = noComment(res);
    for (const nm of ['REQ_BUY_FROMMC', 'REQ_CLICK_TO_BUYING_STORE']) {
      const total = (all.match(new RegExp(nm, 'g')) || []).length;
      const inRes = (resCode.match(new RegExp(nm, 'g')) || []).length;
      assert.ok(total > 0 && total === inRes, name + ' ' + nm + ' 只允许出现在解析函数里（全文 ' + total + ' 处 / 解析内 ' + inRes + ' 处）');
    }
    assert.doesNotMatch(resCode, /\b(304|307|198|199|2048|2877)\b/, name + ' 解析函数不得写死任何 opcode 数字');
    const chain = blockMcDropChain(src);
    assert.ok(chain.includes('p.getPacketVersion') && chain.includes('txBuild(p).op'), name + ' 每个包先走 getPacketVersion，拿不到才回落 txBuild（不得每包都 build）');
    assert.ok(chain.includes('if (!blockMcEnabled()) return false;'), name + ' 必须复用既有 blockMcEnabled() 并在发包现场读');
    assert.ok(chain.includes('if (blockMcDropCheck(p)) {'), name + ' 丢包必须直接 return（不调用 orig）');
  }
});

// ================= V2.38.3 隐藏其他玩家摊位/商店的名字牌（纯本地显示层 · 全局键 dsh_ro_hideshopname_v1 · 默认关闭） =================
const HIDE_SHOP_ANCHOR = '  // V2.38.3：隐藏其他玩家摊位/商店的名字牌（纯本地显示层 · 全局设置 · 默认关闭 · 绝不发任何包）';
const HIDE_SHOP_TAIL = '  var BLOCK_MC_KEY = "dsh_ro_blockmc_v1";';
const HIDE_SHOP_MENU_ANCHOR = '    // V2.38.3：隐藏其他玩家摊位/商店的名字牌（纯本地显示层 · 全局设置 · 默认关闭；V2.38.4 起归位到「常用」区）';
const HIDE_SHOP_MENU_TAIL = '    var info = document.createElement("div"); info.className = "ro-info";';
function hideShopSegment(src) {
  const a = src.indexOf(HIDE_SHOP_ANCHOR), b = src.indexOf(HIDE_SHOP_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出隐藏摊位名字牌功能段');
  return src.slice(a, b);
}
function hideShopMenuSegment(src) {
  const a = src.indexOf(HIDE_SHOP_MENU_ANCHOR), b = src.indexOf(HIDE_SHOP_MENU_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出「常用」区的新勾选框（V2.38.4 菜单归位后）');
  return src.slice(a, b);
}
// 部署客户端假实体：名字牌元素就是 entity.room.node.ui[0]（Room.render 每帧只改 top/left，从不改 display）
function hideShopEl(display) { return { style: { display: display === undefined ? '' : display }, parentNode: {} }; }
function hideShopEnt(gid, type, opt) {
  opt = opt || {};
  const el = opt.el || hideShopEl();
  const ent = { GID: gid, room: { owner: gid, text: 'shop', display: opt.roomDisplay !== false, node: { ui: [el] }, type: type, id: gid } };
  if (opt.noNode) ent.room.node = null;
  if (opt.emptyUi) ent.room.node = { ui: [] };
  return { ent: ent, el: el };
}
function hideShopBoot(opt) {
  opt = opt || {};
  const store = new Map();
  if (opt.stored !== undefined) store.set('dsh_ro_hideshopname_v1', opt.stored);
  const status = [], logs = [], timers = [];
  let now = 1000000, timerId = 0, scans = 0;
  const entities = opt.entities || [];
  const em = opt.em === undefined
    ? { forEach: function (cb) { scans++; for (let i = 0; i < entities.length; i++) cb(entities[i]); } }
    : opt.em;
  const self = opt.self === undefined ? { GID: 42 } : opt.self;
  const ctx = {
    JSON, Math, Object, Number, Array,
    Date: { now: () => now },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    CLIENT: { SS: { Entity: self } },
    window: {},
    requireDB: () => em,
    gidInt: (v) => { const n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; },
    setStatus: (t, c) => status.push([t, c]),
    tlog: (t) => logs.push(t),
    setInterval: (fn, ms) => { timerId++; timers.push({ id: timerId, fn: fn, ms: ms }); return timerId; },
    clearInterval: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setTimeout: (fn) => { fn(); return 0; },
  };
  vm.createContext(ctx);
  vm.runInContext(hideShopSegment(opt.src || source) +
    ';this.on=hideShopNameEnabled;this.save=hideShopNameSave;this.apply=hideShopNameApply;this.sweep=hideShopNameSweep;' +
    'this.hiddenCount=function(){return hideShopNameHidden.length;};this.hiddenList=function(){return hideShopNameHidden;};this.timer=function(){return hideShopNameTimer;};', ctx);
  return {
    ctx, status, logs, store, timers,
    on: () => ctx.on(),
    hidden: () => ctx.hiddenCount(),
    hiddenList: () => ctx.hiddenList(),
    timerHandle: () => ctx.timer(),
    timerCount: () => timers.length,
    scans: () => scans,
    set(on) { ctx.save(on); ctx.apply(); },
    tick(ms) { now += ms; const snap = timers.slice(); for (let i = 0; i < snap.length; i++) snap[i].fn(); },
  };
}

test('V2.38.3 隐藏摊位名字牌：type 0/1 隐藏、type 2/3（聊天室）原样可见、自己的实体与残缺 room 一律不动（VM）', () => {
  const sell = hideShopEnt(101, 0), buy = hideShopEnt(102, 1), sell2 = hideShopEnt(103, 0);
  const chatPub = hideShopEnt(104, 2), chatPriv = hideShopEnt(105, 3); // 聊天室牌子：绝不许动
  const mineGid = hideShopEnt(42, 0);       // 自己的摊位：GID 与 CLIENT.SS.Entity 相同
  const mineFloat = hideShopEnt(42.0, 1);   // 浮点 GID：归一化后同样是自己的
  const selfObj = hideShopEnt(777, 0);      // 对象同一性：CLIENT.SS.Entity 就是这个实体
  const noRoom = { GID: 106 };
  const noNode = hideShopEnt(107, 0, { noNode: true });
  const emptyUi = hideShopEnt(108, 0, { emptyUi: true });
  const notShown = hideShopEnt(109, 0, { roomDisplay: false });
  const alreadyNone = hideShopEnt(110, 0, { el: hideShopEl('none') });
  const entities = [sell.ent, buy.ent, sell2.ent, chatPub.ent, chatPriv.ent, mineGid.ent, mineFloat.ent, noRoom, noNode.ent, emptyUi.ent, notShown.ent, alreadyNone.ent];
  const b = hideShopBoot({ entities: entities, self: { GID: 42 } });
  assert.equal(b.on(), false, '默认必须关闭');
  assert.equal(b.timerCount(), 0, '默认关闭时一个定时器都不许有');
  assert.equal(b.scans(), 0, '默认关闭时一次扫描都不许做');
  b.set(true);
  assert.equal(sell.el.style.display, 'none', '其他玩家的摆摊商店(type 0)牌子必须隐藏');
  assert.equal(buy.el.style.display, 'none', '其他玩家的收购商店(type 1)牌子必须隐藏');
  assert.equal(sell2.el.style.display, 'none', '第二个摆摊商店同样隐藏');
  assert.notEqual(chatPub.el.style.display, 'none', '公共聊天室牌子(type 2)必须原样可见');
  assert.notEqual(chatPriv.el.style.display, 'none', '私人聊天室牌子(type 3)必须原样可见');
  assert.notEqual(mineGid.el.style.display, 'none', '自己的摊位（GID 相同）必须跳过');
  assert.notEqual(mineFloat.el.style.display, 'none', '自己的摊位（浮点 GID 归一化后相同）必须跳过');
  const ident = hideShopBoot({ entities: [selfObj.ent], self: selfObj.ent }); // 对象同一性：CLIENT.SS.Entity 就是这个实体
  ident.set(true);
  assert.notEqual(selfObj.el.style.display, 'none', '自己的摊位（对象同一性）必须跳过');
  assert.equal(ident.hidden(), 0, '对象同一性跳过时不得计入隐藏块数');
  assert.equal(notShown.el.style.display, '', 'room.display 不为 true 的实体不动');
  assert.equal(alreadyNone.el.style.display, 'none', '本来就 none 的元素不重复处理');
  assert.equal(b.hidden(), 3, '隐藏块数必须去重后恰好 3（自己的/聊天室的/残缺的都不算）');
  assert.equal(b.status.length, 1, '块数变化才提示一次');
  assert.ok(b.status[0][0].includes('只影响显示，不影响能否点击人物'), '中文提示必须说明只影响显示');
  assert.ok(b.logs[0].includes('hideshopname') && b.logs[0].includes('不发任何包'), '必须写中文 tlog');
  // 开启中的 400ms 低频维持：数量没变就不再刷屏
  b.tick(400); b.tick(400);
  assert.equal(b.scans(), 3, '开启后每 400ms 扫描一次（含开启时的立即扫描）');
  assert.equal(b.status.length, 1, '隐藏块数没变，绝不每轮刷屏');
  const extra = hideShopEnt(111, 0);
  entities.push(extra.ent);
  b.tick(400);
  assert.equal(extra.el.style.display, 'none', '开启中新出现的第三家摊位必须被隐藏');
  assert.equal(b.hidden(), 4, '隐藏块数随之更新');
  assert.equal(b.status.length, 2, '块数变了才补一条提示');
});

test('V2.38.3 隐藏摊位名字牌：关闭后全部恢复、定时器立刻停止且零轮询（VM）', () => {
  const sell = hideShopEnt(101, 0), buy = hideShopEnt(102, 1), chat = hideShopEnt(103, 2);
  const entities = [sell.ent, buy.ent, chat.ent];
  const b = hideShopBoot({ entities: entities, stored: '{"enabled":true}' });
  assert.equal(b.on(), true, '已开启的角色重新载入后必须自动开启');
  assert.equal(sell.el.style.display, 'none', '载入即隐藏其他玩家的牌子');
  assert.notEqual(chat.el.style.display, 'none', '聊天室牌子照旧可见');
  assert.equal(b.timerCount(), 1, '开启时必须有一个 400ms 维持定时器');
  assert.equal(b.timerHandle(), b.timers[0] ? b.timers[0].id : -1, '定时器句柄必须记下来才能停');
  b.set(false);
  assert.equal(b.store.get('dsh_ro_hideshopname_v1'), '{"enabled":false}', '关闭必须落盘');
  assert.equal(sell.el.style.display, '', '关闭后立刻恢复被隐藏的牌子（清空 display）');
  assert.equal(buy.el.style.display, '', '关闭后立刻恢复被隐藏的牌子（清空 display）');
  assert.equal(chat.el.style.display, '', '聊天室牌子本来就没动，清空后仍是空');
  assert.equal(b.hidden(), 0, '恢复后跟踪表必须清空');
  assert.equal(b.timerCount(), 0, '关闭后定时器必须停掉');
  assert.equal(b.timerHandle(), null, '关闭后定时器句柄必须置空');
  const s0 = b.scans();
  b.tick(400); b.tick(400); b.tick(5000);
  assert.equal(b.scans(), s0, '关闭状态必须零轮询：一次扫描都不许再有');
  assert.equal(sell.el.style.display, '', '关闭后不再有任何元素被隐藏');
  // 再打开必须只影响显示层，且不叠加定时器
  b.set(true); b.set(true);
  assert.equal(b.timerCount(), 1, '反复开关绝不叠加定时器');
  assert.equal(sell.el.style.display, 'none', '重新开启立刻生效');
});

test('V2.38.3 隐藏摊位名字牌健壮性：EM 缺失 / 无 forEach / room 取值抛错 / 遍历抛错一律静默跳过（VM）', () => {
  const noEm = hideShopBoot({ em: null });
  noEm.set(true);
  assert.equal(noEm.logs.length, 0, 'EM 取不到必须静默跳过，不写日志');
  assert.equal(noEm.timerCount(), 1, 'EM 取不到也不影响开关与定时器');
  const noForEach = hideShopBoot({ em: {} });
  noForEach.set(true);
  assert.equal(noForEach.logs.length, 0, 'EM 没有 forEach 必须静默跳过');
  const boomRoom = { GID: 201, get room() { throw new Error('boom-room'); } };
  const good = hideShopEnt(202, 0);
  const mix = hideShopBoot({ entities: [boomRoom, good.ent] });
  mix.set(true);
  assert.equal(good.el.style.display, 'none', '坏实体不得影响好实体');
  assert.ok(mix.logs.every((l) => !l.includes('扫描异常')), '单个实体取值抛错必须静默跳过（只允许一条块数提示）');
  const bad = hideShopBoot({ em: { forEach: function () { throw new Error('boom-em'); } } });
  bad.set(true);
  assert.equal(bad.logs.length, 1, '遍历整体抛错必须写一条中文 tlog');
  assert.ok(bad.logs[0].includes('hideshopname') && bad.logs[0].includes('只影响显示，不影响能否点击人物'), '日志必须中文并说明只影响显示');
  bad.tick(400); bad.tick(400); bad.tick(4000);
  assert.equal(bad.logs.length, 1, '异常日志必须限流，绝不每轮刷屏');
  assert.equal(bad.timerCount(), 1, '异常不得让定时器丢失');
  // 元素没有 style（客户端换了实现）：跳过而不是抛错，其它实体照常
  const noStyle = hideShopBoot({ entities: [{ GID: 203, room: { display: true, type: 0, node: { ui: [{}] } } }, good.ent] });
  noStyle.set(true);
  assert.ok(noStyle.logs.every((l) => !l.includes('扫描异常')), 'node.ui[0] 没有 style 必须静默跳过（只允许一条块数提示）');
  assert.equal(good.el.style.display, 'none', '同一个 VM 里的好实体照常处理');
});

test('V2.38.3 静态断言：隐藏摊位名字牌区段零发包、不 hook 客户端方法、只在 type 0/1 上加 display（静态）', () => {
  const strip = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const seg = hideShopSegment(src);
    const code = strip(seg + '\n' + hideShopMenuSegment(src));
    assert.doesNotMatch(code, /sendPacket|\bCZ\b|czp/, name + ' 该区段绝不发任何包（不得出现发包接口/包名）');
    assert.doesNotMatch(code, /\.prototype|Object\.defineProperty|defineProperty\(/, name + ' 绝不 hook 客户端任何对象的方法');
    assert.ok(code.includes('room.type !== 0 && room.type !== 1'), name + ' 只处理 type 0/1，聊天室牌子(2/3)原样可见');
    assert.ok(code.includes('hideShopNameIsSelf'), name + ' 自己的实体必须跳过');
    assert.ok(code.includes('ui[0].style.display = "none"'), name + ' 只改牌子元素的 display');
    assert.ok(code.includes('setInterval') && code.includes('}, 400)'), name + ' 开启时必须是 400ms 低频轮询');
    assert.ok(code.includes('if (!hideShopNameEnabled()) { hideShopNameRestore(); return; }'), name + ' 关闭必须先恢复再停表（零轮询）');
    assert.ok(code.includes('hideShopNameStop()'), name + ' 必须有停表出口');
    assert.ok(src.includes('var HIDE_SHOP_NAME_KEY = "dsh_ro_hideshopname_v1";'), name + ' 必须用新键 dsh_ro_hideshopname_v1');
    assert.ok(src.includes('var hideShopNameCfg = { enabled: false };'), name + ' 默认必须关闭');
    assert.ok(src.includes('hideShopNameSave(hsn.checked);') && src.includes('hideShopNameApply();'), name + ' 勾选必须立刻落盘并应用');
    const iBmc = src.indexOf('roMenuRow(body, "点击其他玩家的摆摊商店不弹出窗口（默认开）", bmc);');
    const iNew = src.indexOf('roMenuRow(body, "隐藏其他玩家摊位/商店的名字牌（默认关闭）", hsn);');
    assert.ok(iBmc >= 0 && iNew > iBmc, name + ' 新勾选框必须紧挨既有的摆摊点击开关（V2.38.4 起两行归位到「常用」分区）');
  }
  for (const bad of [undefined, 'garbage', '{}', '{"enabled":"yes"}', '[1,2]']) {
    const b = hideShopBoot({ stored: bad });
    assert.equal(b.on(), false, '读取失败或非 true（' + bad + '）必须按关闭');
    assert.equal(b.timerCount(), 0, '按关闭时不得有任何轮询');
  }
});

test('V2.38.3 D1 解析缓存：部分解析成功绝不写缓存 → 补齐另一个包类后（限流期满）必须能拦（VM）', () => {
  const CZ = { REQ_BUY_FROMMC: dropCzCls(null, 304) }; // 只有 REQ_BUY_FROMMC 能解析出来
  const B = blockMcDropBoot(source, { CZ: CZ, capOn: true, fakeClock: true });
  assert.deepEqual(B.ops(), [304], '部分解析：只解析出 304');
  let n = B.calls(); B.send(dropPktVer(304));
  assert.equal(B.calls(), n, '已解析出来的 304 在限流窗口内仍必须被拦（不因不完整而放弃）');
  assert.equal(B.txCap.drop, 1, '拦截计数照常');
  CZ.REQ_CLICK_TO_BUYING_STORE = dropCzCls(null, 305); // 另一个包类随后才补齐
  n = B.calls(); B.send(dropPktVer(305));
  assert.equal(B.calls(), n + 1, '限流窗口内不重解析 → 305 暂时拦不住（最多 5 秒，绝不是永久）');
  assert.deepEqual(B.ops(), [304], '不完整解析绝不写正式缓存（旧实现会永久锁死在这里）');
  B.tick(5001);
  n = B.calls(); B.send(dropPktVer(305));
  assert.equal(B.calls(), n, '限流期满重试解析：补齐的 305 必须立刻生效并被拦');
  n = B.calls(); B.send(dropPktVer(304));
  assert.equal(B.calls(), n, '304 继续被拦');
  assert.equal(B.txCap.drop, 3, '三次拦截计数必须正确');
  // 两个包类都解析出来 → 写正式缓存，之后不再重解析
  const ctr = { n: 0 };
  const C = blockMcDropBoot(source, { CZ: { REQ_BUY_FROMMC: dropCzCls(null, 304, ctr), REQ_CLICK_TO_BUYING_STORE: dropCzCls(null, 305, ctr) }, fakeClock: true });
  assert.deepEqual(C.ops(), [304, 305], '全部解析成功 → 正常缓存');
  const callsBefore = ctr.n;
  C.tick(60000);
  assert.deepEqual(C.ops(), [304, 305], '缓存有效期内结果不变');
  assert.equal(ctr.n, callsBefore, '两个包类都解析出来后才写缓存：同一包版本下绝不重复解析');
});

test('V2.38.3 D2 出站抓包 drop 计数：开始抓包清零，并写进导出文本与停止提示（VM）', () => {
  const els = { 'dsh-txlog': { textContent: '' }, 'dsh-txout': { value: '' } };
  const cbs = {};
  let now = 1000000;
  const txCap = { on: false, ring: [], hooked: false, n: 0, drop: 7, lastLog: 0, lastText: '' }; // 上一轮遗留 drop=7
  const ctx = {
    JSON, Math, Object, Date: { now: () => now }, navigator: {},
    txCap, VER: '2.38.4', getMapName: () => 'prontera',
    $id: (id) => els[id] || null,
    onId: (id, ev, fn) => { cbs[id] = fn; },
    hookSendPacket: () => true,
    Blob: function () {}, URL: { createObjectURL: () => 'blob:', revokeObjectURL: () => {} },
    document: { createElement: () => ({ style: {}, click: () => {}, set href(v) {}, set download(v) {} }), body: { appendChild: () => {}, removeChild: () => {} } },
    setTimeout: (fn) => { fn(); return 0; },
  };
  vm.createContext(ctx);
  const expSeg = segOf(source, '  function txExport() {', '  onId("dsh-txcap", "click", function () {');
  const btnHead = source.indexOf('  onId("dsh-txcap", "click", function () {');
  const btnTail = source.indexOf('  onId("dsh-txexp", "click", txExport);', btnHead);
  assert.ok(btnHead > 0 && btnTail > btnHead, '必须能切出开始/停止抓包处理');
  vm.runInContext(expSeg + '\n' + source.slice(btnHead, btnTail) + ';this.exportTx=txExport', ctx);
  assert.equal(txCap.drop, 7, '前置：上一轮的拦截计数还在');
  cbs['dsh-txcap']();
  assert.equal(txCap.drop, 0, '开始抓包必须把上一轮的拦截计数清零');
  assert.equal(txCap.on, true, '开始抓包照旧打开');
  assert.equal(txCap.ring.length, 0, '开始抓包照旧清空抓包环');
  assert.equal(txCap.n, 0, '开始抓包照旧清零抓包计数');
  txCap.ring.push({ t: 1, d: 'U', op: 304, len: 4, hex: '3001', drop: true });
  txCap.ring.push({ t: 2, d: 'U', op: 150, len: 4, hex: '9600' });
  txCap.n = 2; txCap.drop = 1;
  ctx.exportTx();
  assert.ok(els['dsh-txout'].value.includes('被拦截未发出 1 条'), '导出文本必须体现被拦截未发出的条数');
  assert.ok(els['dsh-txout'].value.includes('[拦截·未发送]'), '被拦截的单条记录仍要留痕');
  cbs['dsh-txstop']();
  assert.ok(els['dsh-txlog'].textContent.includes('被拦截未发出 1 条'), '停止提示必须体现被拦截未发出的条数');
  assert.equal(txCap.on, false, '停止抓包照旧关闭');
});

// ================= V2.38.4 入站分帧：一条 WebSocket 消息含多个包（武僧气弹读不到的根因） =================
// 真实抓包证据（D:\0_Harness\1_RObot\_tmp_spirit\capture-2.38.0-bra_fild01.txt）：
//   1415ms 行 33B = ZC.PAR_CHANGE(176/0xb0, 8B) + ZC.USE_SKILL2(2507/0x9cb, 17B) + ZC.SPIRITS(464/0x1d0, 8B)，8+17+8=33
//   （该行末帧 num 字节是 04；2010ms 行同结构、末帧 0500=num5。总控台指定夹具取 num=5 版本，两条都覆盖）
const SPIRIT_MSG = 'b00007000c010000cb09050105000000c6bf1e00c6bf1e0001d001c6bf1e000500';      // 夹具：末帧 num=5
const SPIRIT_MSG_CAP = 'b00007000c010000cb09050105000000c6bf1e00c6bf1e0001d001c6bf1e000400';  // 抓包 1415ms 原行：末帧 num=4
const SPIRIT_SELF_AID = 0x001ebfc6; // 自己 AID（U1080 自放 261 的目标字段 + 0xb0 内层 9cb 的 srcAID 交叉验证）
const FRAME_HEAD = '  function dispatchInbound(bytes) {';
const FRAME_TAIL = '  function onSelfSpirits(bytes, frameOff, lenTblOk) {';
const SELF_HEAD = '  function onSelfSpirits(bytes, frameOff, lenTblOk) {';
const SELF_TAIL = '  // V2.15.24：拦截服务器下发的技能真实后摇';
const RECON_HEAD = '  function onReconInbound(data) {';
const RECON_TAIL = '  function hookMenuRecon() {';
function hexBuf(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u.buffer; }
// 假 CLIENT.PS：含 id/size 的假包类（size<0 → 变长包）
function fakePs(map) {
  const ZC = {}, CZ = {};
  for (const k of Object.keys(map)) { const S = function () {}; S.id = Number(k); S.size = map[k]; ZC['PKT_' + k] = S; }
  return { ZC, CZ };
}
function frameSrc(src) {
  const a = src.indexOf(FRAME_HEAD), b = src.indexOf(FRAME_TAIL, a);
  const c = src.indexOf(SELF_HEAD), d2 = src.indexOf(SELF_TAIL, c);
  const e = src.indexOf(RECON_HEAD), f = src.indexOf(RECON_TAIL, e);
  assert.ok(a >= 0 && b > a && c >= 0 && d2 > c && e >= 0 && f > e, '必须能切出入站分帧 / onSelfSpirits / onReconInbound');
  return src.slice(a, b) + src.slice(c, d2) + src.slice(e, f);
}
// 变异体：把逐帧遍历改回「整条消息只当第一个包」（= 修复前的旧行为）
function mutateLegacy(code) {
  return code.replace('var walk = walkInboundFrames(bytes, dispatchInboundFrame);',
    'var walk = (function () { var d = new DataView(bytes); dispatchInboundFrame(bytes, d.getUint16(0, true), 0, false); return { frames: 1, rest: bytes.byteLength }; })();');
}
function frameBoot(src, opt) {
  opt = opt || {};
  let code = frameSrc(src);
  if (opt.mutate) { const m = opt.mutate(code); assert.notEqual(m, code, '变异必须命中分帧调用点'); code = m; }
  const sphereLog = [], raw = [], shop = [];
  const ctx = {
    Math, Date, Number, String, JSON, isFinite, parseInt,
    CLIENT: { SS: opt.ss === undefined ? { AID: SPIRIT_SELF_AID, Entity: { GID: SPIRIT_SELF_AID } } : opt.ss, PS: opt.ps === undefined ? fakePs({ 176: 8, 2507: 17, 464: 8 }) : opt.ps, NM: null },
    selfSpirits: { aid: 0, num: 0, map: '' },
    txCap: { on: opt.capOn === true, ring: [], n: 0, drop: 0 },
    collectOpStat() {}, itipPktProbe() {}, DPS_PKTS: [], dpsParsedSeen: false,
    dpsOnRawDamage() {}, scrOnRawVanish() {}, onMenuList() {}, onSayDialog() {}, onCloseDialog() {},
    onSkillPostDelay() {}, onSkillAck3() {},
    itipShopPkt: (b, op) => shop.push(op), onRawOpcode: (b, op) => raw.push(op),
    blockMcHit() {},
    gidInt: (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
    normMapKey: (m) => String(m || '').replace(/\.(gat|rsw)$/, '').toLowerCase(),
    getMapName: () => 'bra_fild01',
    dshSphereLog: (m) => sphereLog.push(String(m)),
  };
  vm.createContext(ctx);
  vm.runInContext(code
    + ';this.dispatch=dispatchInbound;this.walk=walkInboundFrames;this.tbl=zcLenTable;this.partial=()=>framePartial;'
    + 'this.recon=onReconInbound;this.selfGet=()=>selfSpirits;'
    + 'this.buf=function(h){var u=new Uint8Array(h.length/2);for(var i=0;i<u.length;i++)u[i]=parseInt(h.substr(i*2,2),16);return u.buffer;};', ctx);
  return { ctx, sphereLog, raw, shop };
}
function lastLog(B) { return B.sphereLog.length ? B.sphereLog[B.sphereLog.length - 1] : ''; }

test('V2.38.4 入站分帧：一条 33B 消息的三个包全部被分派（武僧气弹读取恢复）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    // 旧行为对照：整条消息只当第一个包 → 气弹包被丢弃，selfSpirits 恒 0
    const legacy = frameBoot(src, { mutate: mutateLegacy }); // 旧行为：整条消息只当第一个包
    legacy.ctx.dispatch(hexBuf(SPIRIT_MSG));
    assert.equal(legacy.sphereLog.length, 0, name + ' 旧行为（只处理第一帧）必须读不到气弹包');
    assert.equal(legacy.ctx.selfGet().num, 0, name + ' 旧行为下 selfSpirits.num 必须还是 0');
    // 新行为：逐帧切分 → 第 2/3 个包都要被分派
    const B = frameBoot(src);
    B.ctx.recon(B.ctx.buf(SPIRIT_MSG)); // 走真实入口 onReconInbound
    assert.equal(B.ctx.partial(), 0, name + ' 33B 消息必须能被完整切分，不产生残包计数');
    assert.deepEqual(B.raw, [176, 2507], name + ' 176/2507 必须走完分派链（464 走 onSelfSpirits 分支）');
    assert.equal(B.sphereLog.length, 1, name + ' 气弹包必须被读到一次');
    assert.ok(lastLog(B).includes('num=5'), name + ' 气弹帧必须解析出 num=5，实际=' + lastLog(B));
    assert.ok(lastLog(B).includes('aid=' + SPIRIT_SELF_AID), name + ' 气弹帧 AID 必须是自己 ' + SPIRIT_SELF_AID);
    assert.ok(lastLog(B).includes('match=true'), name + ' AID 必须与 CLIENT.SS.AID 匹配');
    assert.ok(lastLog(B).includes('off=25'), name + ' 诊断必须补记帧偏移（8+17=25），实际=' + lastLog(B));
    assert.ok(lastLog(B).includes('lenTbl=on'), name + ' 诊断必须补记长度表可用');
    assert.equal(B.ctx.selfGet().num, 5, name + ' selfSpirits.num 必须恢复为 5');
    assert.equal(B.ctx.selfGet().aid, SPIRIT_SELF_AID, name + ' selfSpirits.aid 必须是自己');
    assert.equal(B.ctx.selfGet().map, 'bra_fild01', name + ' selfSpirits.map 必须记当前图');
    // 抓包文件 1415ms 原行（末帧 num=4）同样成立
    const R = frameBoot(src);
    R.ctx.recon(R.ctx.buf(SPIRIT_MSG_CAP));
    assert.equal(R.ctx.selfGet().num, 4, name + ' 抓包原行（num=4）也必须被正确读取');
  }
});

test('V2.38.4 单包消息不回归 + 长度表不可用/首包未知时退化成旧行为', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    // 1) 单包消息（只有气弹包）照常处理
    const one = frameBoot(src);
    one.ctx.dispatch(hexBuf('d001c6bf1e000500'));
    assert.equal(one.sphereLog.length, 1, name + ' 单包消息照旧分派到气弹处理');
    assert.equal(one.ctx.selfGet().num, 5, name + ' 单包气弹照旧读到');
    // 2) CLIENT.PS 不可用 → 整条消息当第一个包（旧行为），绝不回归
    const noTbl = frameBoot(src, { ps: null });
    assert.equal(noTbl.ctx.tbl(), null, name + ' CLIENT.PS 不可用时长度表必须返回 null');
    noTbl.ctx.dispatch(hexBuf(SPIRIT_MSG));
    assert.deepEqual(noTbl.raw, [176], name + ' 长度表不可用时只处理第一帧（旧行为）');
    assert.equal(noTbl.sphereLog.length, 0, name + ' 长度表不可用时读不到气弹（与修复前一致，不得回归成别的东西）');
    assert.equal(noTbl.ctx.partial(), 0, name + ' 退化路径不得记残包');
    // 3) 首包长度未知（表里没有 176）→ 整条消息按首包处理，绝不整条丢弃
    const noFirst = frameBoot(src, { ps: fakePs({ 2507: 17, 464: 8 }) });
    noFirst.ctx.dispatch(hexBuf(SPIRIT_MSG));
    assert.deepEqual(noFirst.raw, [176], name + ' 首包长度未知必须退化旧行为（整条消息照旧分派，不能凭空消失）');
    assert.equal(noFirst.ctx.partial(), 0, name + ' 退化路径不得记残包');
  }
});

test('V2.38.4 变长包（size<0 读 offset+2 的 UShort）与逐帧偏移', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const B = frameBoot(src, { ps: fakePs({ 100: -1, 200: 4 }) });
    const msg = hexBuf('64000a00010203040506c800aabb'); // 变长包 100 共 10B（长度字段 0x000a）+ 定长包 200 共 4B
    const seen = [];
    const w = B.ctx.walk(msg, (frame, op, off, ok) => seen.push({ op: op, off: off, len: frame.byteLength, ok: ok }));
    assert.equal(w.frames, 2, name + ' 变长包 + 定长包必须切出 2 帧');
    assert.equal(w.rest, 14, name + ' 两帧必须完整覆盖 14B');
    assert.deepEqual(seen.map((x) => [x.op, x.off, x.len, x.ok]), [[100, 0, 10, true], [200, 10, 4, true]], name + ' 变长包长度必须取 offset+2 的 UShort，帧偏移必须正确');
  }
});

test('V2.38.4 未知 opcode / 长度非法：停止遍历、不抛错、只计数；首包切不出退化旧行为', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    // 已知帧(176,8B) + 未知 opcode 尾巴
    const B = frameBoot(src, { ps: fakePs({ 176: 8 }), capOn: true });
    B.ctx.dispatch(hexBuf('b00007000c010000' + '34129999aabbccdd'));
    assert.deepEqual(B.raw, [176], name + ' 未知 opcode 处必须停止遍历（不猜、不继续）');
    assert.equal(B.ctx.partial(), 1, name + ' 尾部切不出的残包必须只累加诊断计数');
    assert.equal(B.ctx.txCap.ring.length, 2, name + ' 抓包必须留一条残包记录（帧记录 + 残包记录）');
    const tail = B.ctx.txCap.ring[1];
    assert.equal(tail.partial, true, name + ' 残包记录必须带 partial 标记');
    assert.equal(tail.op, -1, name + ' 残包记录 opcode 记 -1');
    assert.equal(tail.len, 8, name + ' 残包记录长度 = 剩余字节');
    assert.equal(tail.hex, '34129999aabbccdd', name + ' 残包记录 hex = 剩余字节真实值');
    // 首包长度越界（声称 200B 但消息只有 10B）→ 退化成旧行为：整条消息按一个包分派，绝不整条丢弃
    const O = frameBoot(src, { ps: fakePs({ 176: 200 }) });
    assert.doesNotThrow(() => O.ctx.dispatch(hexBuf('b00007000c010000aabb')), name + ' 长度越界绝不能抛错');
    assert.deepEqual(O.raw, [176], name + ' 首包切不出时整条消息按一个包分派（等于旧行为）');
    assert.equal(O.ctx.partial(), 0, name + ' 首包退化的整条分派不记残包');
    // 中段长度非法（len<2）→ 停止遍历 + 只计数，不抛错
    const M = frameBoot(src, { ps: fakePs({ 176: 8, 300: 1 }) });
    M.ctx.dispatch(hexBuf('b00007000c0100002c0144'));
    assert.deepEqual(M.raw, [176], name + ' 中段非法长度必须停止遍历');
    assert.equal(M.ctx.partial(), 1, name + ' 中段非法长度只计数');
  }
});

test('V2.38.4 残包绝不跨消息缓冲：下一条干净消息不受影响', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const B = frameBoot(src);
    B.ctx.dispatch(hexBuf('b00007000c010000' + 'aabbccddee')); // 8B 帧 + 5B 切不出的尾巴
    assert.equal(B.ctx.partial(), 1, name + ' 5B 尾巴必须记 1 次残包');
    assert.deepEqual(B.raw, [176], name + ' 尾巴不得被当成第二帧');
    B.ctx.dispatch(hexBuf(SPIRIT_MSG)); // 紧接着一条完整的 33B 消息
    assert.equal(B.ctx.selfGet().num, 5, name + ' 残包绝不能被缓冲到下一帧（否则错位串包），下一条消息必须照常读到气弹');
    assert.deepEqual(B.raw, [176, 176, 2507], name + ' 第二条消息仍必须三帧齐全（464 走气弹分支）');
    assert.equal(B.ctx.partial(), 1, name + ' 第二条消息完整，不得多记残包');
  }
});

test('V2.38.4 抓包改为按帧记录：记录数 = 帧数，op/len/hex 都是该帧真实值', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const B = frameBoot(src, { capOn: true });
    B.ctx.dispatch(hexBuf(SPIRIT_MSG));
    const ring = B.ctx.txCap.ring;
    assert.equal(ring.length, 3, name + ' 33B 消息必须记 3 条（一条消息一个包时的老行为已经过时）');
    assert.equal(B.ctx.txCap.n, 3, name + ' 抓包计数必须与帧数一致');
    assert.deepEqual(ring.map((r) => r.d), ['D', 'D', 'D'], name + ' 全部是服务器下发方向');
    assert.deepEqual(ring.map((r) => r.op), [176, 2507, 464], name + ' opcode 必须是每个帧自己的');
    assert.deepEqual(ring.map((r) => r.len), [8, 17, 8], name + ' 长度必须是每个帧自己的');
    assert.deepEqual(ring.map((r) => r.off), [undefined, 8, 25], name + ' 必须记录帧在整条消息里的偏移');
    assert.deepEqual(ring.map((r) => r.hex), [
      'b00007000c010000',
      'cb09050105000000c6bf1e00c6bf1e0001',
      'd001c6bf1e000500',
    ], name + ' hex 必须是每个帧自己的真实字节（464 独立成帧）');
    assert.ok(ring.every((r) => r.partial === undefined), name + ' 完整帧不得带残包标记');
  }
});

test('V2.38.4 静态断言：新函数就位、判定链未改、零发包零 hookPacket、版本/摘要/换行/emoji', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('function zcLenTable() {'), name + ' 必须有运行时长度表 zcLenTable()');
    assert.ok(src.includes('function walkInboundFrames(bytes, onFrame) {'), name + ' 必须有帧遍历 walkInboundFrames()');
    assert.ok(src.includes('function dispatchInboundFrame(bytes, op, frameOff, lenTblOk) {'), name + ' 必须有单帧分派');
    assert.ok(src.includes('var framePartial = 0;'), name + ' 必须有残包诊断计数 framePartial');
    assert.ok(src.includes('var walk = walkInboundFrames(bytes, dispatchInboundFrame);'), name + ' dispatchInbound 必须先走分帧');
    assert.equal((src.match(/op === 307/g) || []).length, 1, name + ' 摆摊识别集合仍只出现一处（判定链未被复制）');
    const code = frameSrc(src);
    assert.doesNotMatch(code, /hookPacket|sendPacket|CLIENT\.PS\.CZ|\.prototype\s*=/, name + ' 分帧/气弹链路不得 hookPacket、不得发包、不得改客户端原型');
    assert.ok(!src.includes('_save_buffer'), name + ' 不得引入跨消息残包缓冲');
    const sum = src.slice(src.indexOf('// ---------------- V2.38.4 变更摘要'), src.indexOf('// ---------------- V2.38.3 变更摘要'));
    assert.ok(sum.includes('入站分帧') && sum.includes('气弹') && sum.includes('按帧') && sum.includes('2.38.4'), name + ' V2.38.4 摘要必须覆盖：分帧 / 气弹 / 抓包按帧 / 版本');
    assert.ok(!EMOJI.test(sum) && !EMOJI.test(code), name + ' 新增内容不得含 emoji');
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.5', name + ' @version 必须是 2.38.5');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.5', name + ' VER 必须是 2.38.5');
  }
  assert.equal((source.match(/(?<!\r)\n/g) || []).length, 0, '稳定版必须纯 CRLF');
  assert.equal((expSource.match(/\r\n/g) || []).length, 0, '实验版必须纯 LF');
});

test('V2.38.4 变异测试：把分帧改回「只处理第一帧」→ 气弹用例必须失败', () => {
  function assertSpirits(B) {
    B.ctx.dispatch(hexBuf(SPIRIT_MSG));
    assert.equal(B.ctx.partial(), 0, '整条消息应被完整切分');
    assert.equal(B.sphereLog.length, 1, '气弹包必须被读到一次');
    assert.ok(lastLog(B).includes('num=5') && lastLog(B).includes('off=25'), '气弹帧必须读出 num=5 且偏移 25，实际=' + lastLog(B));
    assert.equal(B.ctx.selfGet().num, 5, 'selfSpirits.num 必须恢复为 5');
    assert.equal(B.ctx.selfGet().aid, SPIRIT_SELF_AID, 'selfSpirits.aid 必须是自己');
  }
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assertSpirits(frameBoot(src)); // 基线：未变异必须通过
    let mutMsg = '';
    try { assertSpirits(frameBoot(src, { mutate: mutateLegacy })); } catch (e) { mutMsg = String(e && e.message || e); }
    assert.match(mutMsg, /气弹包必须被读到一次|num=5|selfSpirits\.num/, name + ' 变异体（只处理第一帧）必须被本用例杀死，实际=' + JSON.stringify(mutMsg.slice(0, 120)));
    console.log('[V2.38.4 变异测试] ' + name + ' 变异体（分帧改回只处理第一帧）被杀死：' + mutMsg.split('\n')[0]);
  }
});



// ================= V2.38.4 A：隐藏名字牌元素复用 / 剪枝恢复（独立审计缺陷回归） =================
// 客户端事实：Room.create() 在节点已存在时复用同一 DOM 节点（Online.js 311472-311476），Room.remove() 不置空 node、
// 也不动 display。因此同一实体「先开商店再开聊天室」会复用我们改过的那个节点。
function mutateShopA1(src) {
  const start = src.indexOf('if (room.type !== 0 && room.type !== 1) {');
  const ret = src.indexOf('return; // 2/3 = 聊天室牌子，绝不隐藏', start);
  const close = src.indexOf('}', ret);
  assert.ok(start > 0 && ret > start && close > ret, 'A1 变异体必须能定位「非 0/1 还原」分支');
  return src.slice(0, start) + 'if (room.type !== 0 && room.type !== 1) return; // 2/3 = 聊天室牌子，绝不动' + src.slice(close + 1);
}
function mutateShopA2(src) {
  const start = src.indexOf('if (hideShopNameHidden.length > 600) {');
  const note = src.indexOf('hideShopNameNote(hideShopNameHidden.length);', start);
  assert.ok(start > 0 && note > start, 'A2 变异体必须能定位剪枝分支');
  return src.slice(0, start) + 'if (hideShopNameHidden.length > 600) hideShopNameHidden = hideShopNameHidden.filter(function (el) { return el && el.parentNode; });' + src.slice(note);
}
test('V2.38.4 A1 元素复用：商店隐藏后同一节点被聊天室复用 → 下一次扫描必须恢复可见（VM）', () => {
  const shop = hideShopEnt(301, 0);
  const b = hideShopBoot({ entities: [shop.ent] });
  b.set(true);
  assert.equal(shop.el.style.display, 'none', '前置：其他玩家的摊位牌子先被隐藏');
  assert.equal(b.hidden(), 1, '前置：跟踪表里正好 1 块');
  shop.ent.room.type = 2; // 客户端复用同一个 DOM 节点改画聊天室牌子
  b.tick(400);
  assert.equal(shop.el.style.display, '', '复用成聊天室牌子后必须恢复可见（不得一直 display:none 直到关开关/刷新）');
  assert.equal(b.hidden(), 0, '恢复后必须从跟踪表移除');
  shop.ent.room.type = 0; // 再复用回商店牌子
  b.tick(400);
  assert.equal(shop.el.style.display, 'none', '复用回商店牌子后照旧隐藏');
  assert.equal(b.hidden(), 1, '重新回到跟踪表');
  b.set(false);
  assert.equal(shop.el.style.display, '', '关闭开关后照旧恢复');
});
test('V2.38.4 A2 跟踪表剪枝：>600 且元素已 detach → 丢弃前必须先还原 display，关闭开关后全部恢复（VM）', () => {
  const N = 601, entities = [], els = [];
  for (let i = 0; i < N; i++) {
    const el = { style: { display: '' }, parentNode: null }; // Room.remove() 已摘掉的节点，display 仍是我们置的 none
    els.push(el);
    entities.push({ GID: 5000 + i, room: { display: true, type: 0, node: { ui: [el] }, owner: 5000 + i } });
  }
  const b = hideShopBoot({ entities: entities });
  b.set(true);
  assert.equal(b.hidden(), 0, '剪枝后跟踪表只应保留还被挂着的节点（这里全部已 detach）');
  els.forEach((el, i) => assert.equal(el.style.display, '', '剪枝丢弃前必须先把 display 还原成空串（第 ' + i + ' 块）'));
  b.set(false);
  els.forEach((el, i) => assert.equal(el.style.display, '', '关闭开关后也必须全部恢复成空串（第 ' + i + ' 块）'));
  assert.equal(b.timerCount(), 0, '关闭后必须零轮询');
});
test('V2.38.4 A 变异测试：回退 A1 还原分支 / A2 剪枝还原 → 两条回归用例必须变红', () => {
  const runA1 = (src) => {
    const shop = hideShopEnt(301, 0);
    const b = hideShopBoot({ entities: [shop.ent], src: src });
    b.set(true);
    shop.ent.room.type = 2;
    b.tick(400);
    assert.equal(shop.el.style.display, '', '复用成聊天室牌子后必须恢复可见');
  };
  runA1(source); // 基线：未变异必须通过
  let msgA1 = '';
  try { runA1(mutateShopA1(source)); } catch (e) { msgA1 = String(e && e.message || e); }
  assert.match(msgA1, /复用成聊天室牌子后必须恢复可见/, 'A1 变异体必须被本用例杀死，实际=' + JSON.stringify(msgA1.slice(0, 120)));
  console.log('[V2.38.4 A 变异测试] A1（回退非 0/1 还原分支）被杀死：' + msgA1.slice(0, 90));
  const runA2 = (src) => {
    const N = 601, entities = [], els = [];
    for (let i = 0; i < N; i++) {
      const el = { style: { display: '' }, parentNode: null };
      els.push(el);
      entities.push({ GID: 5000 + i, room: { display: true, type: 0, node: { ui: [el] }, owner: 5000 + i } });
    }
    const b = hideShopBoot({ entities: entities, src: src });
    b.set(true);
    assert.equal(els[0].style.display, '', '剪枝丢弃前必须先把 display 还原成空串');
    b.set(false);
    assert.equal(els[0].style.display, '', '关闭开关后也必须全部恢复成空串');
  };
  runA2(source); // 基线：未变异必须通过
  let msgA2 = '';
  try { runA2(mutateShopA2(source)); } catch (e) { msgA2 = String(e && e.message || e); }
  assert.match(msgA2, /剪枝丢弃前必须先把 display 还原成空串/, 'A2 变异体必须被本用例杀死，实际=' + JSON.stringify(msgA2.slice(0, 120)));
  console.log('[V2.38.4 A 变异测试] A2（回退剪枝还原）被杀死：' + msgA2.slice(0, 90));
});

// ================= V2.38.4 B：补球来源修正（401 狂蓄气 / 261 蓄气；262 吸气是消耗方，已移出） =================
const SPHERE_SCAN_HEAD = '  function checkSkillCond(cond) {';
const SPHERE_SCAN_TAIL = '  // V2.22.0：技能最快还要多少毫秒才能放';
function sphereCodes(src) {
  const a = src.indexOf(SPHERE_SCAN_HEAD), b = src.indexOf(SPHERE_SCAN_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出技能前置判定 / 补球来源 / 补状态段');
  return src.slice(a, b);
}
function sphereBoot(opt) {
  opt = opt || {};
  const code = sphereCodes(opt.src || source);
  const packets = [], logs = [], statuses = [];
  let now = 1000000;
  const learned = Object.assign({ 261: 5, 401: 1 }, opt.learned || {});
  const state = Object.assign({ spheres: 0, explosion: 0 }, opt.state || {});
  const self = { GID: 42, life: { hp: 100, hp_max: 100, sp: 100, sp_max: 100 }, getOpt3: () => 0 };
  const controls = opt.controls || { 'dsh-spheresrc': { value: 'auto' } };
  const ctx = {
    JSON, Math, Object, Number, Array, String, isNaN, isFinite, parseInt, parseFloat,
    Date: { now: () => now },
    CLIENT: { SS: { Entity: self, AID: 42 }, NM: { sendPacket: (p) => packets.push({ type: p.type, SKID: p.SKID }) } },
    window: { __dshCdScale: 0.5 },
    requireDB: (n) => (n === 'UI/Components/SkillList/SkillList' ? { getSkillById: (id) => (learned[id] ? { level: learned[id], type: 1 } : null), getList: () => [] } : null),
    czp: (name) => function () { this.type = name; },
    $id: (id) => controls[id] || null,
    saved: opt.saved || {},
    gidInt: (v) => { const n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; },
    normMapKey: (m) => String(m || '').toLowerCase(),
    getMapName: () => 'prontera',
    selfSpirits: { aid: 42, num: state.spheres, map: 'prontera' },
    dshSphereLog: () => {},
    buffStateOn: () => false,
    buffStId: () => -1,
    getSkillNameById: (id) => '技能' + id,
    tlog: (t) => logs.push(String(t)),
    setStatus: (t, c) => statuses.push([String(t), c]),
    skillDelay: {}, skillNextAt: {}, zSkillRtt: {}, zSkillRttAvg: 0,
    zPrepAt: 0, zPrepSpam: 0, zSphereStallWarned: false, __sphereRecheckMute: opt.mute === true,
    entStatus: () => ({
      ent: self, spheres: state.spheres, explosion: state.explosion, berserk: 0, soullink: 0, riding: 0, falcon: 0, cart: 0,
      hp: 100, hpMax: 100, sp: 100, spMax: 100,
    }),
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.condNeeds=condNeeds;this.checkSkillCond=checkSkillCond;this.cast=castStatusPrep;this.pick=pickSphereSkill;this.srcIds=SKILL_SPHERE_SRC;this.srcGlobal=sphereSrcGlobal;', ctx);
  return {
    ctx, packets, logs,
    tick: (ms) => { now += ms; },
    setSpheres: (n) => { state.spheres = n; ctx.selfSpirits.num = n; },
    spheres: () => state.spheres,
    statuses: () => statuses,
    srcIds: () => Array.from(ctx.srcIds),
    srcGlobal: () => ctx.srcGlobal(),
    condNeeds: (s) => ctx.condNeeds(s),
    check: (s) => ctx.checkSkillCond(s),
    pick: (need, cur) => { if (cur !== undefined) { state.spheres = cur; ctx.selfSpirits.num = cur; } return ctx.pick(need, ctx.entStatus()); },
    cast: (s) => ctx.cast(s, []),
  };
}
test('V2.38.4 B 球源词：condNeeds 解析成 sphereSrc 且绝不进 statuses；checkSkillCond 绝不当门槛（VM）', () => {
  const b = sphereBoot({});
  const n401 = b.condNeeds('球5,球源401,爆气');
  assert.equal(n401.spheres, 5, '球5 仍解析为需 5 颗');
  assert.equal(n401.sphereSrc, '401', '球源401 → sphereSrc=401');
  assert.deepEqual(Array.from(n401.statuses), ['爆气'], '球源401 绝不能进 statuses');
  assert.ok(!n401.statuses.includes('球源401'), '球源401 绝不能进 statuses（否则会去找不存在的补状态技能）');
  assert.equal(b.condNeeds('球源261').sphereSrc, '261', '球源261 → 261');
  assert.equal(b.condNeeds('球源自动').sphereSrc, 'auto', '球源自动 → auto');
  assert.equal(b.condNeeds('球源auto').sphereSrc, 'auto', '球源auto 同样识别为 auto');
  assert.equal(b.condNeeds('球1').sphereSrc, null, '不写球源 → null（跟随全局默认）');
  assert.deepEqual(Array.from(b.condNeeds('球源401,球源261').statuses), [], '两个球源词都不得进 statuses');
  b.setSpheres(5);
  assert.equal(b.check('球5,球源401').ok, true, '球源401 不是门槛，球够就必须通过');
  assert.equal(b.check('球源401').ok, true, '只写球源词 → 无条件通过');
  b.setSpheres(3);
  const miss = b.check('球5,球源401');
  assert.equal(miss.ok, false, '球不够时仍按真门槛拦住');
  assert.equal(miss.miss, '球5', '缺的必须只是真门槛 球5，绝不能是 球源401');
});
test('V2.38.4 B 选源规则：条件里的球源优先于全局默认；自动档按缺口现算（缺1颗→261 / 缺3颗→401）（VM）', () => {
  const auto = sphereBoot({ controls: { 'dsh-spheresrc': { value: 'auto' } } });
  assert.equal(auto.pick({ spheres: 5, sphereSrc: 'auto' }, 4), 261, '自动档缺 1 颗 → 蓄气 261');
  assert.equal(auto.pick({ spheres: 5, sphereSrc: 'auto' }, 3), 261, '自动档缺 2 颗 → 蓄气 261');
  assert.equal(auto.pick({ spheres: 5, sphereSrc: 'auto' }, 2), 401, '自动档缺 3 颗 → 狂蓄气 401');
  assert.equal(auto.pick({ spheres: 5, sphereSrc: '401' }, 4), 401, '条件 球源401 → 只用狂蓄气（优先于全局 自动）');
  assert.equal(auto.pick({ spheres: 5, sphereSrc: '261' }, 2), 261, '条件 球源261 → 只用蓄气（优先于全局 自动）');
  const g261 = sphereBoot({ controls: { 'dsh-spheresrc': { value: '261' } } });
  assert.equal(g261.pick({ spheres: 5 }, 2), 261, '全局只用蓄气 → 即使缺口 3 颗也用蓄气');
  const g401 = sphereBoot({ controls: { 'dsh-spheresrc': { value: '401' } } });
  assert.equal(g401.pick({ spheres: 5 }, 4), 401, '全局只用狂蓄气 → 即使缺口 1 颗也用狂蓄气');
  assert.equal(sphereBoot({ controls: {}, saved: { sphereSrc: '261' } }).srcGlobal(), '261', '下拉不在 DOM 时回落 saved.sphereSrc');
  assert.equal(sphereBoot({ controls: {}, saved: {} }).srcGlobal(), 'auto', '都没有 → 默认自动');
  assert.equal(sphereBoot({ controls: { 'dsh-spheresrc': { value: '401' } }, saved: { sphereSrc: '261' } }).srcGlobal(), '401', '下拉存在时以下拉为准');
});
test('V2.38.4 B 262 吸气移出补球名单：名单只含 401/261，首选不可用时也只回落另一个来源（VM+静态）', () => {
  const m = /var SKILL_SPHERE_SRC = \[([^\]]*)\];/.exec(source);
  assert.ok(m, '必须能取出 SKILL_SPHERE_SRC 声明');
  const ids = m[1].split(',').map((s) => parseInt(s.trim(), 10));
  assert.deepEqual(ids, [401, 261], '补球名单必须是 401 狂蓄气 + 261 蓄气');
  assert.ok(!ids.includes(262), '262 吸气是气弹的消耗方，绝不能出现在补球名单');
  const b = sphereBoot({ learned: { 261: 0, 401: 1, 262: 5 }, controls: {}, saved: { sphereSrc: '261' } });
  assert.equal(b.pick({ spheres: 5, sphereSrc: '261' }, 4), 401, '首选 261 未学 → 回落狂蓄气 401，绝不许回落 262');
  assert.ok(b.logs.some((l) => l.includes('改用另一个补球来源')), '首选不可用必须写一条 tlog');
  const b2 = sphereBoot({ learned: { 261: 3, 401: 1, 262: 5 }, controls: {}, saved: { sphereSrc: '261' } });
  assert.equal(b2.pick({ spheres: 5, sphereSrc: '261' }, 3), 401, '261 已到等级上限（球数>=等级）→ 回落 401，绝不许回落 262');
  const b3 = sphereBoot({ controls: {}, saved: { sphereSrc: 'auto' } });
  assert.notEqual(b3.pick({ spheres: 5, sphereSrc: 'auto' }, 4), 262, '自动档也绝不放 262');
});
test('V2.38.4 收口 A1：撤掉狂蓄气拉黑——首选放下后球数没涨 → 不拉黑、下一次仍按同一规则选回 401（VM+静态）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(!src.includes('sphereSrcBan'), name + ' 补球来源里不得再出现 sphereSrcBan');
    assert.ok(!src.includes('zSphereLastCast'), name + ' 补球来源里不得再出现 zSphereLastCast');
    const code = sphereCodes(src);
    assert.ok(!code.includes('sphereSrcBan') && !code.includes('zSphereLastCast'), name + ' 补球来源选择段不得再有拉黑表 / 复查记录');
    assert.ok(!code.includes('刚复查无效已拉黑10秒'), name + ' 选源里不得再有「刚复查无效已拉黑10秒」分支');
    assert.ok(!code.includes('since < 1000'), name + ' 不得再有「放下后 1 秒复查」的等待');
  }
  const b = sphereBoot({});
  b.setSpheres(2);
  assert.equal(b.cast('球5,球源401'), true, '缺球时必须真的补球');
  assert.equal(b.packets[b.packets.length - 1].SKID, 401, '首选 401 必须先放');
  b.tick(1100);
  assert.equal(b.cast('球5,球源401'), true, '1 秒后照旧补球（不再有复查等待拦截）');
  assert.equal(b.packets[b.packets.length - 1].SKID, 401, '球数没涨也不得换源——下一次仍按同一规则选回 401');
  assert.deepEqual(b.packets.map((p) => p.SKID), [401, 401], '两次都必须是 401，绝不因「没涨」改用 261');
  assert.ok(!b.statuses().some((s) => s[0].includes('气弹数据未更新')), '只连补 2 次不算数据异常，不得提前写「气弹数据未更新」');
});

test('V2.38.4 收口 A2：连续补球球数始终无变化 → 状态栏「气弹数据未更新」+ 停止补球、不再发包（VM）', () => {
  const b = sphereBoot({});
  b.setSpheres(0);
  for (let i = 0; i < 6; i++) { assert.equal(b.cast('球5,球源401'), true, '第 ' + (i + 1) + ' 次仍应补球（阈值前）'); b.tick(1100); }
  assert.equal(b.packets.length, 6, '阈值（沿用 zPrepSpam=6）前共发 6 个补球包');
  assert.equal(b.cast('球5,球源401'), false, '连续 6 次补球球数始终无变化 → 必须停止补球');
  assert.equal(b.packets.length, 6, '停止后绝不再发包');
  assert.ok(b.statuses().some((s) => s[0].includes('气弹数据未更新') && s[0].includes('可能没收到 464 包')), '必须写状态栏「气弹数据未更新（可能没收到 464 包）」，实际=' + JSON.stringify(b.statuses()));
  assert.ok(b.logs.some((l) => l.includes('气弹数据未更新')), '必须写一条 tlog');
  b.tick(1100);
  assert.equal(b.cast('球5,球源401'), false, '继续调用也不得再发包');
  assert.equal(b.packets.length, 6, '停止后持续不再发包');
  assert.equal(b.statuses().filter((s) => s[0].includes('气弹数据未更新')).length, 1, '同一次异常只提示一次（不刷屏）');
  b.setSpheres(3);
  b.tick(1100);
  assert.equal(b.cast('球5,球源401'), true, '球数恢复读取后必须能重新补球');
  assert.equal(b.packets.length, 7, '恢复后照常发包');
  assert.ok(!b.statuses().slice(-1).some((s) => s[0].includes('气弹数据未更新')), '恢复后不得再写「气弹数据未更新」');
});

test('V2.38.4 B 硬约束：球够了 / 已满 5 颗 → 一颗都不补；球够了照旧能去补状态前置（VM）', () => {
  const b = sphereBoot({});
  b.setSpheres(5);
  assert.equal(b.cast('球5,球源401'), false, '需要的球数 <= 当前球数 → 一颗都不补');
  assert.equal(b.packets.length, 0, '一颗都不许补（不放任何技能）');
  b.setSpheres(0);
  assert.equal(b.cast('球5,球源401'), true, '真缺球时必须照补');
  assert.equal(b.packets.length, 1, '真缺球时照发一个补球包');
  const c = sphereBoot({});
  c.setSpheres(5);
  assert.equal(c.cast('球10,球源401'), false, '需要 10 颗但已满 5 颗 → 绝不补（放了也涨不上去）');
  assert.equal(c.packets.length, 0, '绝不发任何技能包');
  const d = sphereBoot({ learned: { 261: 5, 401: 1, 270: 5 }, state: { spheres: 5, explosion: 0 } });
  assert.equal(d.cast('球5,爆气'), true, '球够了 → 补球分支不动它，照旧去补状态');
  assert.equal(d.packets[d.packets.length - 1].SKID, 270, '补的是爆气 270，不是任何补球技能');
});
test('V2.38.4 B 静态断言：条件语法文案含 球源401/球源261/球源自动、下拉三档、摘要追加、新增内容无 emoji（静态）', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const uiHead = src.indexOf('技能释放与顺序（自动判断释放前置');
    const uiTail = src.indexOf('辅助技能（选技能自动加判定条件', uiHead);
    assert.ok(uiHead > 0 && uiTail > uiHead, name + ' 必须能切出技能设置区段');
    const seg = src.slice(uiHead, uiTail);
    for (const tok of ['球源401', '球源261', '球源自动']) assert.ok(seg.includes(tok), name + ' 条件语法说明必须写明 ' + tok);
    assert.ok(seg.includes('id="dsh-spheresrc"'), name + ' 技能设置必须有补球来源下拉');
    assert.ok(seg.includes('<option value="auto" selected>') && seg.includes('<option value="261">') && seg.includes('<option value="401">'), name + ' 下拉必须是 自动(默认) / 只用蓄气 / 只用狂蓄气 三档');
    assert.ok(seg.includes('267:1:球1,球源261:100') && seg.includes('271:5:球5,球源401,爆气:80:20:3:2'), name + ' 文案里必须有球源用法例子');
    assert.ok(src.includes('["dsh-spheresrc", "v"]'), name + ' 补球来源下拉必须登记进 PROF_CONTROLS（随角色档保存/恢复）');
    assert.ok(src.includes('saved.sphereSrc = this.value'), name + ' 下拉改动必须落 saved.sphereSrc');
    const sum = src.slice(src.indexOf('// ---------------- V2.38.4 变更摘要'), src.indexOf('// ---------------- V2.38.3 变更摘要'));
    assert.ok(sum.includes('球源') && sum.includes('401') && sum.includes('261') && sum.includes('262'), name + ' V2.38.4 摘要必须追加补球来源条目（含 262 移出说明）');
    assert.ok(sum.includes('名字牌') || sum.includes('剪枝'), name + ' V2.38.4 摘要必须追加名字牌修复条目');
    const hide = src.slice(src.indexOf(HIDE_SHOP_ANCHOR), src.indexOf(HIDE_SHOP_TAIL, src.indexOf(HIDE_SHOP_ANCHOR)));
    assert.ok(hide.includes('hideShopNameHidden.splice(k, 1)'), name + ' 非 0/1 类型必须还原并移出跟踪表');
    assert.ok(hide.includes('el.style.display = ""'), name + ' 剪枝丢弃前必须还原 display');
    assert.ok(!EMOJI.test(seg) && !EMOJI.test(sum) && !EMOJI.test(hide), name + ' 新增内容不得含 emoji');
  }
});
test('V2.38.4 收口 变异测试：把拉黑/复查、提示停止、267 特例塞回去 → 新用例必须变红', () => {
  const muts = [
    {
      name: '回退 A1：把狂蓄气拉黑机制重新塞回去（拉黑表 + 复查记录）',
      mutate: (s) => s.replace('var order = pref === "401" ? [401, 261] : [261, 401];',
        'var zSphereLastCast = null, sphereSrcBan = {};\n        if ((sphereSrcBan[401] || 0) > Date.now()) why = "刚复查无效已拉黑10秒";\n      var order = pref === "401" ? [401, 261] : [261, 401];'),
      expect: /sphereSrcBan/,
      run: (s, exp) => {
        assert.ok(!s.includes('sphereSrcBan'), exp);
        assert.ok(!s.includes('zSphereLastCast'), exp);
        assert.ok(!sphereCodes(s).includes('刚复查无效已拉黑10秒'), exp);
      },
    },
    {
      name: '回退 A1：首选放下后球数没涨就换源（旧复查口径）',
      mutate: (s) => s.replace('        return sid;', '        return __sphereRecheckMute ? (sid === 401 ? 261 : 401) : sid;'),
      expect: /球数没涨也不得换源/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s, mute: true });
        b.setSpheres(2);
        b.cast('球5,球源401');
        b.tick(1100);
        b.cast('球5,球源401');
        assert.equal(b.packets[b.packets.length - 1].SKID, 401, exp);
      },
    },
    {
      name: '回退 A2：连续补球球数无变化时不再提示 / 不再停止（重新无限补球）',
      mutate: (s) => s.replace('        if (st.spheres <= 0 && zPrepSpam >= 6) {', '        if (false) {'),
      expect: /气弹数据未更新/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s });
        b.setSpheres(0);
        for (let i = 0; i < 8; i++) { b.cast('球5,球源401'); b.tick(1100); }
        assert.ok(b.statuses().some((x) => x[0].includes('气弹数据未更新')), exp);
      },
    },
    {
      name: '回退 A3：弹指重新按实际技能等级吃球',
      mutate: (s) => s.replace('        var sphereNeed = req[2];', '        var sphereNeed = o.skid === 267 ? realLv : req[2];'),
      expect: /弹指 267 不得再按实际技能等级吃球/,
      run: (s, exp) => {
        assert.ok(!s.includes('o.skid === 267 ? realLv : req[2]'), exp);
        assert.ok(s.includes('var sphereNeed = req[2];'), exp);
      },
    },
    {
      name: '自动档缺口规则写死狂蓄气 401',
      mutate: (s) => s.replace('if (pref === "auto") pref = gap >= 3 ? "401" : "261";', 'if (pref === "auto") pref = "401";'),
      expect: /自动档缺 1 颗必须用蓄气 261/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s });
        assert.equal(b.pick({ spheres: 5, sphereSrc: 'auto' }, 4), 261, exp);
      },
    },
    {
      name: '回退 262 剔除（把 262 放回回落链）',
      mutate: (s) => s.replace('var order = pref === "401" ? [401, 261] : [261, 401];', 'var order = pref === "401" ? [401, 261] : [261, 262];'),
      expect: /首选 261 未学 → 回落狂蓄气 401/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s, learned: { 261: 0, 401: 1, 262: 5 }, controls: {}, saved: { sphereSrc: '261' } });
        assert.equal(b.pick({ spheres: 5, sphereSrc: '261' }, 4), 401, exp);
      },
    },
    {
      name: '回退 球源 非门槛处理（当状态名去查）',
      mutate: (s) => s.replace('if (/^球源/.test(cc)) continue;', ''),
      expect: /球源401 不是门槛，球够就必须通过/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s });
        b.setSpheres(5);
        assert.equal(b.check('球5,球源401').ok, true, exp);
      },
    },
    {
      name: '回退 condNeeds 的 球源 解析（当成状态名）',
      mutate: (s) => s.replace('if (mss) { need.sphereSrc = (mss[1] === "自动" || mss[1] === "auto") ? "auto" : mss[1]; continue; }', 'if (mss) { }'),
      expect: /球源401 必须解析成 sphereSrc/,
      run: (s, exp) => {
        const b = sphereBoot({ src: s });
        const n = b.condNeeds('球5,球源401');
        assert.equal(n.sphereSrc, '401', exp);
        assert.ok(!n.statuses.includes('球源401'), '球源401 绝不能进 statuses');
      },
    },
  ];
  for (const m of muts) {
    const mut = m.mutate(source);
    assert.notEqual(mut, source, m.name + ' 变异体必须真的改到源码');
    let msg = '';
    try { m.run(mut, m.expect.source); } catch (e) { msg = String(e && e.message || e); }
    assert.match(msg, m.expect, m.name + ' 变异体必须被本用例杀死，实际=' + JSON.stringify(msg.slice(0, 120)));
    console.log('[V2.38.4 收口 变异测试] ' + m.name + ' 被杀死：' + msg.slice(0, 80));
    m.run(source, m.expect.source); // 基线：未变异必须通过
  }
});


// ================= V2.38.4 收口 B：手机版/登录页启动异常修复（requireDB 永不抛 / 页面闸门 / 启动 try-catch / 背包就绪探测） =================
const REQDB_HEAD = '  function requireDB(name) {';
const REQDB_TAIL = '  // ---------------- 技能名 / 怪物名 / 物品名（客户端模块）----------------';
const GATE_TAIL = '  try { roAssistMain(); } catch (e) {';
const BAGCLEAN_HEAD = '  function bagCleanBoot(attempt) {';
const BAGCLEAN_TAIL = '  bagCleanBoot(0); // V2.38.4：启动阶段只发起「就绪探测」';
function reqdbBoot(src, win) {
  const s = src || source;
  const a = s.indexOf(REQDB_HEAD), b = s.indexOf(REQDB_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出 requireDB');
  const ctx = { window: win };
  vm.createContext(ctx);
  vm.runInContext(s.slice(a, b) + ';this.fn=requireDB', ctx);
  return ctx.fn;
}
function gateBoot(loc, src) {
  const s = src || source;
  const a = s.indexOf('\n(function () {') + 1, b = s.indexOf(GATE_TAIL);
  assert.ok(a >= 0 && b > a, '必须能切出页面闸门（IIFE 头 → 启动 try）');
  const host = { dom: 0, timer: 0, ws: 0, store: 0, listener: 0 };
  const ctx = {
    window: { location: loc },
    document: {
      createElement: () => { host.dom++; return {}; }, createElementNS: () => { host.dom++; return {}; },
      getElementById: () => null, querySelector: () => null, addEventListener: () => { host.listener++; },
      head: { appendChild: () => { host.dom++; }, style: {} }, body: { appendChild: () => { host.dom++; }, style: {} },
    },
    setTimeout: () => { host.timer++; return 0; },
    setInterval: () => { host.timer++; return 0; },
    WebSocket: function () { host.ws++; },
    localStorage: { getItem: () => { host.store++; return null; }, setItem: () => { host.store++; } },
    __continued: false,
  };
  vm.createContext(ctx);
  vm.runInContext(s.slice(a, b) + '\n  __continued = true;\n})();', ctx);
  return { ctx, host, continued: ctx.__continued === true };
}
function bagCleanBootProbe(src, ready) {
  const s = src || source;
  const a = s.indexOf(BAGCLEAN_HEAD), b = s.indexOf(BAGCLEAN_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出 bagCleanBoot');
  const timers = [], calls = [], logs = [];
  const ctx = {
    requireDB: (n) => (ready ? { name: n } : null),
    bagCleanInit: () => calls.push('init'),
    tlog: (x) => logs.push(String(x)),
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; },
  };
  vm.createContext(ctx);
  vm.runInContext(s.slice(a, b) + ';this.boot=bagCleanBoot', ctx);
  return { ctx, timers, calls, logs, boot: (n) => ctx.boot(n) };
}
test('V2.38.4 收口 B1：requireDB 在模块未加载时返回 null 且绝不抛（复现手机版整页报错）（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const NOTLOADED = 'Module name "UI/Components/BasicInventory/BasicInventory" has not been loaded yet for context: __Use require([])';
    let calls = 0, hostErrors = 0;
    const bad = (n) => { calls++; hostErrors++; throw new Error(NOTLOADED); };
    bad.defined = () => false;
    bad.specified = () => true;
    let got = 'x', threw = null;
    try { got = reqdbBoot(src, { require: bad })('UI/Components/BasicInventory/BasicInventory'); } catch (e) { threw = e; }
    assert.equal(threw, null, name + ' requireDB 绝不能把 notloaded 抛给宿主');
    assert.equal(got, null, name + ' 未加载的模块必须返回 null');
    assert.equal(calls, 0, name + ' require.defined()===false 时绝不许真的调 require（那会触发 RequireJS 的 notloaded 错误路径）');
    assert.equal(hostErrors, 0, name + ' 宿主错误处理绝不能被触发');
    let calls2 = 0;
    const good = (n) => { calls2++; return { mod: n }; };
    good.defined = () => true; good.specified = () => true;
    const loaded = reqdbBoot(src, { require: good })('DB/DBManager');
    assert.equal(loaded && loaded.mod, 'DB/DBManager', name + ' 已加载必须照旧返回模块');
    assert.equal(calls2, 1, name + ' 已加载必须真的调一次 require');
    let calls3 = 0;
    const spec = (n) => { calls3++; throw new Error('must not be called'); };
    spec.specified = () => false;
    assert.equal(reqdbBoot(src, { require: spec })('DB/DBManager'), null, name + ' specified()===false 必须返回 null');
    assert.equal(calls3, 0, name + ' specified()===false 时不得调 require');
    assert.equal(reqdbBoot(src, {})('DB/DBManager'), null, name + ' 没有 window.require 必须返回 null');
    assert.equal(reqdbBoot(src, { require: 123 })('DB/DBManager'), null, name + ' window.require 不是函数必须返回 null');
    const boom = (n) => { throw new Error('boom'); };
    assert.equal(reqdbBoot(src, { require: boom })('DB/DBManager'), null, name + ' require 抛错必须被整体 try/catch 兜住返回 null');
  }
});
test('V2.38.4 收口 B2：全文 window.require(...) 调用点统一走 requireDB（静态）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const codeOnly = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const bare = codeOnly.match(/window\.require\s*\(|window\.requirejs\s*\(/g) || [];
    assert.deepEqual(bare, [], name + ' 代码里不得再有裸 window.require(...) / window.requirejs(...) 调用，实际=' + JSON.stringify(bare.slice(0, 5)));
    assert.ok(src.includes('if (typeof req.defined === "function" && !req.defined(name)) return null;'), name + ' requireDB 必须先探测 defined');
    assert.ok(src.includes('if (typeof req.specified === "function" && !req.specified(name)) return null;'), name + ' requireDB 必须先探测 specified');
    assert.ok((src.match(/requireDB\(/g) || []).length >= 60, name + ' requireDB 取用点必须覆盖全文');
    for (const mod of ['DB/DBManager', 'UI/Components/SkillList/SkillList', 'Network/PacketStructure', 'Renderer/EntityManager', 'Network/NetworkManager', 'UI/Components/BasicInventory/BasicInventory']) {
      assert.ok(src.includes(mod), name + ' ' + mod + ' 的取用点必须保留并走 requireDB');
    }
  }
});
test('V2.38.4 收口 B3：背包初始化改为「客户端就绪才做」——模块不可用只重试不抛、不进背包流程（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(!src.includes('try { if (typeof bagCleanInit === "function") { bagCleanInit(); } } catch (e) {}'), name + ' 启动阶段不得再直接跑 bagCleanInit');
    const u = bagCleanBootProbe(src, false);
    assert.doesNotThrow(() => u.boot(0), name + ' 模块不可用时不得抛');
    assert.equal(u.calls.length, 0, name + ' 模块不可用时绝不允许跑 bagCleanInit');
    assert.equal(u.timers.length, 1, name + ' 必须安排一次重试');
    assert.equal(u.timers[0].ms, 500, name + ' 重试间隔必须是有界的 500ms');
    let n = 0;
    while (u.timers.length && n++ < 500) { u.timers.shift().fn(); }
    assert.equal(u.calls.length, 0, name + ' 模块一直不可用必须始终不跑 bagCleanInit');
    assert.ok(u.logs.some((l) => l.includes('bagCleanInit 放弃')), name + ' 有界重试超限必须写一条 tlog 后放弃，实际=' + JSON.stringify(u.logs));
    assert.ok(n <= 60, name + ' 重试必须有界（实际重试 ' + n + ' 次）');
    const r = bagCleanBootProbe(src, true);
    r.boot(0);
    assert.equal(r.calls.length, 1, name + ' 客户端就绪必须执行一次 bagCleanInit');
    assert.equal(r.timers.length, 0, name + ' 就绪时不得再排重试');
    const t2 = bagCleanBootProbe(src, true);
    t2.ctx.bagCleanInit = () => { throw new Error('inner'); };
    assert.doesNotThrow(() => t2.boot(0), name + ' bagCleanInit 抛错不得冒泡');
    assert.ok(t2.logs.some((l) => l.includes('bagCleanInit 异常')), name + ' bagCleanInit 抛错只记 tlog');
  }
});
test('V2.38.4 收口 B4：启动引导异常被 try/catch 吞掉，绝不冒泡到宿主页面（VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const a = src.indexOf('\n(function () {') + 1, b = src.indexOf('  function roAssistMain() {');
    assert.ok(a >= 0 && b > a, '必须能切出启动引导外壳');
    const outer = src.slice(a, b);
    const errs = [];
    const ctx = { window: { location: { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/ro/api.html' } }, console: { error: (...x) => errs.push(x) }, __after: false };
    vm.createContext(ctx);
    vm.runInContext(outer + '\n  function roAssistMain() { throw new Error("boom"); }\n  __after = true;\n})();', ctx);
    assert.equal(ctx.__after, true, name + ' 启动异常必须被吞掉，引导外壳照常收尾（不冒泡到宿主）');
    assert.equal(errs.length, 1, name + ' 必须记一条 console.error');
    assert.ok(String(errs[0][0]).includes('启动异常已拦截'), name + ' 异常日志必须写明「启动异常已拦截」');
    const ok = { window: { location: { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/ro/api.html' } }, console: { error: () => {} }, __after: false, __ran: false };
    vm.createContext(ok);
    vm.runInContext(outer + '\n  function roAssistMain() { __ran = true; }\n  __after = true;\n})();', ok);
    assert.equal(ok.__ran, true, name + ' 正常启动必须真的跑到 roAssistMain');
    assert.equal(ok.__after, true, name + ' 正常启动照常收尾');
  }
});
test('V2.38.4 收口 B5：页面闸门——非客户端页面直接 return（零副作用），客户端页面继续（VM+静态）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const gateDecl = src.indexOf('function roAssistPageAllowed() {');
    const codeAt = src.lastIndexOf('(function () {', gateDecl);
    const gateAt = src.indexOf('if (!roAssistPageAllowed()) return;', codeAt);
    assert.ok(codeAt > 0 && gateDecl > codeAt && gateAt > codeAt, name + ' 必须在引导最开始就有页面闸门');
    const head = src.slice(codeAt, src.indexOf('\n', gateAt)).split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
    assert.ok(head.includes('roAssistPageAllowed'), name + ' 闸门必须是引导里的第一段代码');
    for (const mk of ['dsh-ball', 'createElement', 'addEventListener', 'setInterval(', 'setTimeout(', 'WebSocket', 'localStorage', 'requireDB(']) {
      assert.ok(!head.includes(mk), name + ' 页面闸门之前（去注释后）不得出现 ' + mk + ' —— 闸门必须先于任何 DOM / 定时器 / WebSocket / 存储副作用');
    }
    const bad = [
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/' },
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/notice.html' },
      { hostname: 'game.lastro.cn', port: '', href: 'https://game.lastro.cn/ro/' },
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/?r=mx/index' },
      { hostname: '127.0.0.1', port: '8973', href: 'http://127.0.0.1:8973/' },
      { hostname: 'example.com', port: '', href: 'https://example.com/ro/api.html' },
    ];
    for (const loc of bad) {
      const g = gateBoot(loc, src);
      assert.equal(g.continued, false, name + ' 非客户端页面必须直接 return：' + loc.href);
      assert.deepEqual(g.host, { dom: 0, timer: 0, ws: 0, store: 0, listener: 0 }, name + ' 非客户端页面不得有任何 DOM / 定时器 / WebSocket / 存储副作用：' + loc.href);
    }
    const good = [
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/ro/api.html?69.32' },
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/ro/api-old.html' },
      { hostname: 'post.lastro.cn', port: '', href: 'https://post.lastro.cn/?r=mn/index' },
      { hostname: '127.0.0.1', port: '8971', href: 'http://127.0.0.1:8971/' },
      { hostname: 'localhost', port: '8971', href: 'http://localhost:8971/' },
    ];
    for (const loc of good) {
      const g = gateBoot(loc, src);
      assert.equal(g.continued, true, name + ' 客户端页面必须继续启动：' + loc.href);
    }
  }
});
test('V2.38.4 收口 C：审计小缺陷（注释口径 / 下拉回填 / DataView 失败路径 / 长度表缓存键）（静态+VM）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const c1 = src.slice(src.indexOf('  // V2.38.4 口径纠偏（审计②）'), src.indexOf('  function zcLenTable() {'));
    assert.ok(c1.length > 0, name + ' 必须有 zcLenTable 口径纠偏注释');
    assert.ok(c1.includes('未必等于客户端权威长度'), name + ' 必须写明正 size 未必是客户端权威长度');
    assert.ok(c1.includes('USESKILL_ACK3') && c1.includes('size=32') && c1.includes('2842=29'), name + ' 必须给出 USESKILL_ACK3 size=32 / 权威 2842=29 的例子');
    assert.ok(c1.includes('29/36/59/62/150'), name + ' 必须写明线上实测长度 29/36/59/62/150');
    assert.ok(c1.includes('29B') && c1.includes('共 4 条') && c1.includes('op2435'), name + ' 必须把条数口径更正为实测 4 条（op2842 三条 + op2435 一条）');
    assert.ok(!src.includes('9 条 29B'), name + ' 不得再保留「9 条 29B 消息」的旧口径');
    assert.ok(c1.includes('109 条') && c1.includes('42 条') && c1.includes('伪造帧'), name + ' 必须写明失真点停住 / 不伪造帧 / 109 条中 42 条尾部切不完的取舍');
    assert.ok(c1.includes('不采纳'), name + ' 必须写明不采纳 D1 强形式');
    assert.ok(c1.includes('38%'), name + ' 必须写明不采纳 D1 强形式的理由（42/109 ≈ 38% 消息会退化）');
    assert.ok(src.includes('else sphereSrcEl.value = "auto";'), name + ' 非法/缺失值时必须显式回填 auto');
    assert.ok(src.includes('catch (eDv) { return { frames: 0, rest: total }; }'), name + ' DataView 构造失败必须记 rest=total');
    assert.ok(src.includes('var __zcLenTbl = { tbl: null, src: null, n: 0, sig: -1 };'), name + ' 长度表缓存对象必须带 sig 键');
    assert.ok(src.includes('__zcLenTbl.sig === sig'), name + ' 长度表缓存必须比较 sig');
    assert.ok(src.includes('function psFuncSig(PS)'), name + ' 必须有 CLIENT.PS 可枚举函数计数函数');
  }
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const B = frameBoot(src);
    let called = 0;
    const w = B.ctx.walk({ byteLength: 8 }, () => { called++; });
    assert.deepEqual([w.frames, w.rest, called], [0, 8, 0], name + ' DataView 失败必须返回 {frames:0, rest:total} 且不回调任何帧');
  }
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const B = frameBoot(src, { ps: fakePs({ 176: 8 }) });
    const t1 = B.ctx.tbl();
    assert.equal(t1[176], 8, name + ' 前置：176=8');
    assert.equal(t1[999], undefined, name + ' 前置：999 未注册');
    assert.equal(B.ctx.tbl(), t1, name + ' 函数计数未变必须复用同一张表');
    const S = function () {}; S.id = 999; S.size = 6;
    B.ctx.CLIENT.PS.ZC.PKT_999 = S;
    const t2 = B.ctx.tbl();
    assert.notEqual(t2, t1, name + ' CLIENT.PS 函数计数变化必须重建长度表');
    assert.equal(t2[999], 6, name + ' 新注册的包类必须立刻可见');
  }
});
// ================= V2.38.4 菜单归位 / 手机版旁观模式 / PC 端兜底注入 =================
const MENU_HEAD = '  function roMenuRow(parent, labelText, ctrl) {';
const MENU_TAIL = '  // 鼠标→触摸模拟层';
const BOOT_HEAD = '  // 探测本地数据服务器是否可用（带 1.5s 超时）';
const BOOT_TAIL = '  // ---------------- 工具 ----------------';
const READY_HEAD = '  function waitForReady() {';
const READY_TAIL = '  // ---------------- V2.6.9 选服前白屏自愈';
function lfSrc(src) { return String(src).split(String.fromCharCode(13)).join(''); }
function menuSrc(src) {
  const s = lfSrc(src);
  const a = s.indexOf(MENU_HEAD), b = s.indexOf(MENU_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出 roMenuRow / roMenuRender');
  return s.slice(a, b);
}
function bootSrc(src) {
  const s = lfSrc(src);
  const a = s.indexOf(BOOT_HEAD), b = s.indexOf(BOOT_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出 detectDataServer / boot 启动段');
  return s.slice(a, b);
}
function readySrc(src) {
  const s = lfSrc(src);
  const a = s.indexOf(READY_HEAD), b = s.indexOf(READY_TAIL, a);
  assert.ok(a >= 0 && b > a, '必须能切出 waitForReady 就绪检测');
  return s.slice(a, b);
}
function fakeNode(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(), children: [], parentNode: null,
    className: '', id: '', title: '', type: '', value: '', checked: false, options: [],
    attributes: {}, style: {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); el.children.length = 0; },
  });
  return el;
}
function menuBoot(src) {
  const body = fakeNode('div'); body.id = 'dsh-menu-body';
  const flags = { blockMc: true, hide: false };
  const ctx = {
    RO_MODULES: [
      { id: 'gear', name: '一键换装 · 卡册', kind: 'fw', sec: '常用' },
      { id: 'tp', name: '传送功能', kind: 'fw', sec: '常用' },
      { id: 'arrowrules', name: '换箭设置', kind: 'fw', sec: '战斗功能' },
    ],
    hkTarget: null, VER: '2.38.4',
    roModOn: () => true, roModSet: () => {}, roModClose: () => {},
    roModIsOpen: () => false, roModToggle: () => {},
    hkOf: () => null, hkLabel: (h) => String(h), hkBeginSet: () => {}, hkClear: () => {},
    roUi: () => ({ scale: 'auto', scaleMin: 0.75 }),
    roScaleSet: () => {}, roUiSave: () => {}, roScaleAll: () => {}, roReclampAll: () => {},
    roSkinOn: () => false, roSkinSet: () => {},
    blockMcEnabled: () => flags.blockMc, blockMcSave: (v) => { flags.blockMc = v; },
    hideShopNameEnabled: () => flags.hide, hideShopNameSave: (v) => { flags.hide = v; }, hideShopNameApply: () => {},
    setStatus: () => {}, tlog: () => {},
    roVw: () => 800, roVh: () => 600, roScale: () => 1,
    document: { getElementById: (id) => (id === 'dsh-menu-body' ? body : null), createElement: (t) => fakeNode(t) },
  };
  vm.createContext(ctx);
  vm.runInContext(menuSrc(src) + ';this.render=roMenuRender;', ctx);
  return { ctx, body, flags, render: () => ctx.render() };
}
function menuOrder(src) {
  const m = menuBoot(src);
  m.render();
  const kids = m.body.children;
  const sec = {}, rows = {};
  kids.forEach((el, i) => {
    const cls = String(el.className || '');
    if (cls.indexOf('ro-sec') >= 0) sec[el.textContent] = i;
    if (cls.indexOf('ro-row') >= 0) {
      const nm = el.children.find((c) => String(c.className || '').indexOf('nm') >= 0);
      if (nm) rows[nm.textContent] = { i: i, row: el };
    }
  });
  const box = (label) => {
    const r = rows[label];
    if (!r) return null;
    const cb = r.row.children.find((c) => c.type === 'checkbox');
    return { i: r.i, checked: cb ? cb.checked : null };
  };
  return {
    sec: sec,
    block: box('点击其他玩家的摆摊商店不弹出窗口（默认开）'),
    hide: box('隐藏其他玩家摊位/商店的名字牌（默认关闭）'),
    scale: box('界面缩放'), scaleMin: box('自动缩放下限'), skin: box('RO 原生皮肤'),
    lastModule: rows['换箭设置'] ? rows['换箭设置'].i : -1,
  };
}
function mutateMenuBackToGeneral(src) {
  const s = lfSrc(src);
  const a = s.indexOf('    // V2.38.4 菜单归位：');
  const endMark = '    roMenuRow(body, "隐藏其他玩家摊位/商店的名字牌（默认关闭）", hsn);' + String.fromCharCode(10);
  const b = s.indexOf(endMark, a);
  assert.ok(a >= 0 && b > a, '菜单归位变异体必须能定位两行区块');
  const block = s.slice(a, b + endMark.length);
  const rest = s.slice(0, a) + s.slice(b + endMark.length);
  const anchor = '    body.appendChild(sec2);' + String.fromCharCode(10);
  const ai = rest.indexOf(anchor);
  assert.ok(ai >= 0, '菜单归位变异体必须能定位「通用」标题');
  return rest.slice(0, ai + anchor.length) + block + rest.slice(ai + anchor.length);
}
function bootProbe(src, opt) {
  opt = opt || {};
  const timers = [], xhrs = [], scripts = [], heads = [], logs = [], statuses = [], msgHandlers = [];
  let now = 0, scriptCall = 0, intervalCount = 0;
  const win = { ROConfig: opt.pageSetROConfig ? { page: 1 } : null, postMessage: () => {}, addEventListener: (ev, fn) => { if (ev === 'message') msgHandlers.push(fn); } };
  if (opt.requireEngine) { const r = function () {}; r.defined = function () {}; win.require = r; }
  const doc = {
    createElement: (t) => { const n = { tag: t, style: {}, type: '', src: '' }; scripts.push(n); return n; },
    getElementById: () => null,
    getElementsByTagName: (t) => {
      if (t === 'head') return [{ appendChild: (a) => heads.push(a) }];
      if (t !== 'script') return [];
      scriptCall++;
      const officialNow = opt.scriptPresent === true || (opt.appearAtCall && scriptCall >= opt.appearAtCall);
      return officialNow ? [{ src: '/ro/Online.js?69.32' }] : [];
    },
    addEventListener: (ev, fn) => { if (ev === 'message') msgHandlers.push(fn); },
  };
  const state = { ready: false, bootedByWrapper: false, bootedByPlugin: false, officialBooted: false, account: null };
  const ctx = {
    IS_MN: opt.mn === true, IS_LOCAL_HOST: opt.local === true,
    state: state, window: win, document: doc,
    useLocalData: false, LOCAL_DATA: '', REMOTE_DATA: '/ro/client_re/',
    DATA_CANDIDATES: ['http://127.0.0.1:8971/'],
    version: '69.32',
    buildConfig: () => ({ ClientVer: 5, autoLogin: [], remoteClient: '/ro/client_re/' }),
    tlog: (m) => logs.push(String(m)), setStatus: (m) => statuses.push(String(m)),
    perfApply: () => {}, fpsLockApply: () => {}, renderWinInfo: () => {},
    XMLHttpRequest: function () { xhrs.push(this); this.open = () => {}; this.send = () => {}; },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: () => {}, setInterval: (fn, ms) => { intervalCount++; return intervalCount; },
    Math: Math, Date: Date, JSON: JSON, Number: Number, String: String,
  };
  vm.createContext(ctx);
  vm.runInContext(bootSrc(src) + String.fromCharCode(10) + readySrc(src)
    + ';this.boot=boot;this.detect=detectDataServer;this.signal=officialBootSignal;this.inject=injectClient;this.ready=waitForReady;', ctx);
  return {
    ctx: ctx, state: state, win: win, timers: timers, xhrs: xhrs, scripts: scripts, heads: heads,
    logs: logs, statuses: statuses, msgHandlers: msgHandlers,
    elapsed: () => now,
    tick: () => { const t = timers.shift(); if (!t) return null; now += t.ms; t.fn(); return t; },
    pump: (n) => { let k = 0; while (timers.length && k++ < (n || 100)) { const t = timers.shift(); now += t.ms; t.fn(); } },
    fireReady: () => { msgHandlers.forEach((fn) => fn({ data: 'ready' })); },
  };
}
function mutateBootWaitImmediate(src) {
  const s = lfSrc(src);
  const target = '    setTimeout(waitOfficial, PC_OFFICIAL_WAIT_MS);' + String.fromCharCode(10) + '  }';
  const out = s.replace(target, '    injectClient(cfg, true);' + String.fromCharCode(10) + '  }');
  assert.notEqual(out, s, 'PC 等待窗口变异必须命中启动末段的调度点');
  return out;
}
function mutateBootNoRecheck(src) {
  const s = lfSrc(src);
  const nl = String.fromCharCode(10);
  const target = '        // ③ 注入前再复核一次上面三个信号：等待窗口最后一刻官方起来了 → 退让，绝不注入' + nl
    + '        if (officialBootSignal()) { state.officialBooted = true; tlog("official-booted-late waited=" + waited); return; }' + nl;
  const out = s.replace(target, '');
  assert.notEqual(out, s, '注入前复核变异必须命中');
  return out;
}

test('V2.38.4 菜单归位：两个全局开关行移到「常用」区（RO_MODULES 之后、「通用」之前），默认值与全局键不变（VM+静态）', () => {
  const orderOk = (o, name) => {
    assert.ok(o.block && o.hide, name + ' 两个开关行必须都还在，实际 block=' + JSON.stringify(o.block) + ' hide=' + JSON.stringify(o.hide));
    assert.ok(o.sec['常用'] !== undefined && o.sec['通用'] !== undefined, name + ' 「常用」「通用」两个小标题必须都在');
    assert.ok(o.block.i > o.sec['常用'] && o.hide.i > o.sec['常用'], name + ' 两行必须排在「常用」小标题之后');
    assert.ok(o.block.i > o.lastModule, name + ' 两行必须排在 RO_MODULES 各行之后');
    assert.ok(o.block.i < o.sec['通用'] && o.hide.i < o.sec['通用'], name + ' 两行必须排在「通用」小标题之前');
    assert.ok(o.hide.i > o.block.i, name + ' 顺序必须是先摆摊点击开关、后名字牌开关');
    assert.equal(o.block.checked, true, name + ' 「点击其他玩家的摆摊商店不弹出窗口」默认必须为开');
    assert.equal(o.hide.checked, false, name + ' 「隐藏其他玩家摊位/商店的名字牌」默认必须为关');
    assert.ok(o.scale.i > o.sec['通用'] && o.scaleMin.i > o.sec['通用'] && o.skin.i > o.sec['通用'], name + ' 界面缩放/自动缩放下限/RO 原生皮肤必须仍留在「通用」区');
  };
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    orderOk(menuOrder(src), name);
    const mi = src.indexOf('roMenuRow(body, "点击其他玩家的摆摊商店不弹出窗口（默认开）", bmc);');
    const hi = src.indexOf('roMenuRow(body, "隐藏其他玩家摊位/商店的名字牌（默认关闭）", hsn);');
    const gi = src.indexOf('sec2.textContent = "通用";');
    assert.ok(mi > 0 && hi > mi && gi > hi, name + ' 静态：两行必须在 RO_MODULES 循环之后、「通用」小标题赋值之前');
    assert.ok(src.includes('roMenuRow(body, "界面缩放", sc);'), name + ' 界面缩放必须仍在（通用区）');
    assert.ok(src.includes('var BLOCK_MC_KEY = "dsh_ro_blockmc_v1";') && src.includes('var HIDE_SHOP_NAME_KEY = "dsh_ro_hideshopname_v1";'), name + ' 两个全局键不得改');
  }
  let mutMsg = '';
  try { orderOk(menuOrder(mutateMenuBackToGeneral(source)), 'mutant'); } catch (e) { mutMsg = String(e && e.message || e); }
  assert.match(mutMsg, /排在「通用」小标题之前|排在 RO_MODULES 各行之后/, '菜单归位变异体（把两行移回「通用」区）必须被本用例杀死，实际=' + JSON.stringify(mutMsg.slice(0, 140)));
  console.log('[V2.38.4 变异测试] 菜单归位（两行移回通用区）被杀死：' + mutMsg.slice(0, 90));
});

test('V2.38.4 手机版旁观模式：boot 零注入 / 不碰 ROConfig / 零探测，就绪检测照旧（VM+静态）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    const code = bootSrc(src);
    const mnAt = code.indexOf('if (IS_MN) { tlog("mn-spectator skip-client-inject"); return; }');
    const cfgAt = code.indexOf('var cfg = buildConfig();');
    assert.ok(mnAt > 0 && cfgAt > mnAt, name + ' 手机版必须在 buildConfig() 之前立刻返回（不碰任何全局）');
    assert.ok(code.includes('if (IS_MN) { tlog("detect=mn-official-resource skip-probe"); return finish(); }'), name + ' 手机版探测分支必须同步直接回调');
    assert.ok(src.includes('waitForReady();'), name + ' 启动流程必须仍然调用就绪检测');
    assert.ok(src.includes('window.WebSocket = PW;'), name + ' WebSocket 收发钩子必须保留');
    const p = bootProbe(src, { mn: true });
    let cb = 0;
    assert.doesNotThrow(() => p.ctx.detect(() => { cb++; }), name + ' 手机版探测回调不得抛');
    assert.equal(cb, 1, name + ' 手机版 detectDataServer 必须同步直接回调（不探测、不等待）');
    assert.equal(p.xhrs.length, 0, name + ' 手机版绝不许 new XMLHttpRequest（零探测）');
    p.ctx.boot();
    assert.equal(p.scripts.length, 0, name + ' 手机版不得 append 任何客户端脚本，实际=' + JSON.stringify(p.scripts.map((s) => s.src)));
    assert.equal(p.heads.length, 0, name + ' 手机版不得向 head 追加任何脚本');
    assert.equal(p.win.ROConfig, null, name + ' 手机版绝不许设置 window.ROConfig');
    assert.ok(!('__dshSetROConfig' in p.win), name + ' 手机版不得打助手配置标记');
    assert.equal(p.timers.length, 0, name + ' 手机版 boot 必须立刻返回（不排注入/等待/兜底定时器）');
    assert.equal(p.state.bootedByPlugin, true, name + ' 启动去重标记照旧');
    assert.equal(p.state.ready, false, name + ' boot 自己不得假装已就绪');
    p.ctx.ready();
    assert.equal(p.msgHandlers.length, 1, name + ' boot 返回后助手仍必须挂上 ready 监听');
    p.fireReady();
    assert.equal(p.state.ready, true, name + ' 手机版 boot 返回后助手仍必须走到就绪检测');
    assert.ok(p.statuses.indexOf('客户端已就绪') >= 0, name + ' 就绪时必须照旧写状态栏');
  }
});

test('V2.38.4 PC 端兜底注入：官方先起→退让；3s 无信号才注入；注入前复核；本机入口不等（VM+静态）', () => {
  function pcWait(src) {
    const p = bootProbe(src, {});
    p.ctx.boot();
    assert.equal(p.scripts.length, 0, '等待窗口开始前不得注入');
    assert.equal(p.timers.length, 1, '必须排一个 250ms 等待窗口');
    assert.equal(p.timers[0].ms, 250, '等待间隔必须是 250ms');
    for (let i = 1; i <= 11; i++) { p.tick(); assert.equal(p.scripts.length, 0, '等待窗口内第 ' + i + ' 轮不得注入'); }
    assert.equal(p.elapsed(), 2750, '前 11 轮 = 11 × 250ms');
    assert.equal(p.state.officialBooted, false, '还没到超时，不得写 officialBooted');
    p.tick();
    assert.equal(p.elapsed(), 3000, '等满约 3 秒（12 次 × 250ms）');
    assert.equal(p.scripts.length, 1, '等满仍无信号才注入 1 次');
    assert.equal(p.heads.length, 1, '必须 append 到 head');
    assert.equal(p.win.__dshSetROConfig, true, '注入时必须打助手自己的配置标记');
    assert.equal(p.win.ROConfig && p.win.ROConfig.ClientVer, 5, '兜底注入写入 buildConfig 的配置');
    assert.equal(p.state.officialBooted, false, '无信号路径不写 officialBooted');
    assert.equal(p.logs.filter((m) => m.indexOf('official-booted') >= 0).length, 0, '无信号时不得有退让日志');
  }
  function pcLate(src) {
    const p = bootProbe(src, { appearAtCall: 14 });
    p.ctx.boot();
    for (let i = 1; i <= 12; i++) p.tick();
    assert.equal(p.scripts.length, 0, '等待窗口最后一刻官方起来 → 必须退让，注入 0 次');
    assert.equal(p.win.ROConfig, null, '退让时绝不写 ROConfig');
    assert.equal(p.state.officialBooted, true, '必须写 officialBooted 标记');
    assert.ok(p.logs.some((m) => m.indexOf('official-booted-late waited=12') >= 0), '必须留下延迟退让日志，实际=' + JSON.stringify(p.logs));
  }
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    // ① 官方 script 标签已存在 → 不注入不写 ROConfig
    const a = bootProbe(src, { scriptPresent: true });
    a.ctx.boot();
    assert.equal(a.scripts.length, 0, name + ' 官方 script 标签已存在 → 绝不注入');
    assert.equal(a.win.ROConfig, null, name + ' 官方已在 → 绝不写 ROConfig');
    assert.equal(a.state.officialBooted, true, name + ' 必须写 officialBooted 标记');
    assert.equal(a.timers.length, 0, name + ' 立即退让，不排等待窗口');
    // ② 3 秒内无信号 → 窗口内 0 次、超时后 1 次
    pcWait(src);
    // ③ 等待期间官方脚本出现 → 退让、0 次
    const w = bootProbe(src, { appearAtCall: 5 });
    w.ctx.boot();
    assert.equal(w.scripts.length, 0, name + ' 等待期间官方出现前不得注入');
    for (let i = 1; i <= 4; i++) { w.tick(); assert.equal(w.scripts.length, 0, name + ' 第 ' + i + ' 轮仍无信号，不得注入'); }
    assert.equal(w.state.officialBooted, true, name + ' 探测到官方 → 写标记');
    assert.equal(w.timers.length, 0, name + ' 退让后不得再排下一轮');
    assert.ok(w.logs.some((m) => m.indexOf('official-booted waited=4') >= 0), name + ' 退让日志必须带轮数，实际=' + JSON.stringify(w.logs));
    // ④ 页面自己设过 ROConfig → 绝不覆盖；兜底注入的守卫直接调用也不覆盖
    const c = bootProbe(src, { pageSetROConfig: true });
    c.ctx.boot();
    assert.equal(c.scripts.length, 0, name + ' 页面已有 ROConfig → 退让，绝不注入');
    assert.deepEqual(c.win.ROConfig, { page: 1 }, name + ' 页面配置原样不动');
    assert.ok(!('__dshSetROConfig' in c.win), name + ' 助手不得给页面配置打自己的标记');
    const pageCfg = c.win.ROConfig;
    c.ctx.inject({ ClientVer: 3, autoLogin: [] }, true);
    assert.equal(c.win.ROConfig, pageCfg, name + ' 兜底注入也必须带 if (!window.ROConfig) 守卫（绝不覆盖页面配置）');
    assert.ok(!('__dshSetROConfig' in c.win), name + ' 被守卫挡住时不得打助手标记');
    assert.equal(c.scripts.length, 1, name + ' 守卫只挡配置写入，脚本照注入（兜底语义不变）');
    // 引擎全局已存在（RequireJS 已执行）也算官方接管
    const r = bootProbe(src, { requireEngine: true });
    r.ctx.boot();
    assert.equal(r.scripts.length, 0, name + ' window.require 引擎已执行 → 退让');
    assert.equal(r.state.officialBooted, true, name + ' 引擎信号必须写 officialBooted');
    // ⑤ 本机私有入口保持现状：不等待、立即注入；DOM 去重照旧
    const h = bootProbe(src, { local: true });
    h.ctx.boot();
    assert.equal(h.scripts.length, 1, name + ' 本机私有入口必须立即注入 1 次');
    assert.equal(h.timers.length, 0, name + ' 本机私有入口不等待');
    assert.equal(h.win.__dshSetROConfig, true, name + ' 本机私有入口保持现状（写助手配置标记）');
    assert.equal(h.win.ROConfig && h.win.ROConfig.ClientVer, 5, name + ' 本机私有入口用 buildConfig 的配置覆盖宿主占位对象');
    assert.equal(h.state.officialBooted, false, name + ' 本机私有入口不走官方等待判定');
    const h2 = bootProbe(src, { local: true, scriptPresent: true });
    h2.ctx.boot();
    assert.equal(h2.scripts.length, 0, name + ' 本机私有入口 DOM 去重照旧：已有脚本不再注入');
    // ⑥ 去重保留
    for (const key of ['ready', 'bootedByWrapper', 'bootedByPlugin']) {
      const d = bootProbe(src, {});
      d.state[key] = true;
      d.ctx.boot();
      assert.equal(d.timers.length, 0, name + ' state.' + key + ' 为真时 boot 必须直接返回（去重保留）');
      assert.equal(d.scripts.length, 0, name + ' state.' + key + ' 为真时绝不许注入');
    }
  }
});

test('V2.38.4 变异测试：PC 等待窗口改 0 / 删掉注入前复核 → 兜底注入用例必须变红', () => {
  function pcWait(src) {
    const p = bootProbe(src, {});
    p.ctx.boot();
    assert.equal(p.scripts.length, 0, '等待窗口开始前不得注入');
    for (let i = 1; i <= 12; i++) p.tick();
    assert.equal(p.scripts.length, 1, '等满 3 秒才注入');
  }
  function pcLate(src) {
    const p = bootProbe(src, { appearAtCall: 14 });
    p.ctx.boot();
    for (let i = 1; i <= 12; i++) p.tick();
    assert.equal(p.scripts.length, 0, '等待窗口最后一刻官方起来 → 必须退让，注入 0 次');
  }
  pcWait(source);
  let mA = '';
  try { pcWait(mutateBootWaitImmediate(source)); } catch (e) { mA = String(e && e.message || e); }
  assert.match(mA, /等待窗口开始前不得注入|等满 3 秒才注入/, '变异体 A（等待窗口=0，立即注入）必须被本用例杀死，实际=' + JSON.stringify(mA.slice(0, 140)));
  console.log('[V2.38.4 变异测试] PC 等待窗口改 0（立即注入）被杀死：' + mA.slice(0, 90));
  pcLate(source);
  let mB = '';
  try { pcLate(mutateBootNoRecheck(source)); } catch (e) { mB = String(e && e.message || e); }
  assert.match(mB, /等待窗口最后一刻官方起来/, '变异体 B（删掉注入前复核）必须被本用例杀死，实际=' + JSON.stringify(mB.slice(0, 140)));
  console.log('[V2.38.4 变异测试] 注入前复核被删除被杀死：' + mB.slice(0, 90));
});

test('V2.38.4 静态断言：三处新口径就位、分帧分派链与已完成批次未被回改（静态）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.ok(src.includes('var PC_OFFICIAL_WAIT_TRIES = 12;') && src.includes('var PC_OFFICIAL_WAIT_MS = 250;'), name + ' 等待窗口必须是 12 × 250ms');
    assert.ok(src.includes('function clientScriptPresent() {') && src.includes('function officialBootSignal() {'), name + ' 必须有官方启动信号判定');
    assert.ok(src.includes('if (officialBootSignal()) { state.officialBooted = true; tlog("official-booted-immediate"); return; }'), name + ' 必须先等官方（立即复核）');
    assert.ok(src.includes('if (!guardPageCfg || !window.ROConfig) { window.ROConfig = cfg; window.__dshSetROConfig = true; }'), name + ' 兜底注入必须带 ROConfig 守卫 + 助手标记');
    assert.ok(src.includes('if (!clientScriptPresent()) injectClient(cfg, false);'), name + ' 本机私有入口保持现状（DOM 去重 + 立即注入）');
    assert.ok(src.includes('if (state.ready || state.bootedByWrapper || state.bootedByPlugin) return;'), name + ' 启动去重必须保留');
    assert.ok(src.includes('officialBooted: false,'), name + ' state 必须有 officialBooted 标记');
    assert.ok(src.includes('// @version      2.38.5') && src.includes('var VER = "2.38.5";'), name + ' 版本必须仍是 2.38.5（不新开版本）');
    // 已完成批次与分帧分派链不得回改
    assert.equal((src.match(/op === 307/g) || []).length, 1, name + ' 摆摊识别集合仍只出现一处（拉黑/闸门批次未回改）');
    assert.ok(src.includes('var walk = walkInboundFrames(bytes, dispatchInboundFrame);'), name + ' 入站分帧分派链不得改动');
    assert.ok(src.includes('var framePartial = 0;'), name + ' framePartial 计数不得改动');
    assert.ok(src.includes('if (typeof req.defined === "function" && !req.defined(name)) return null;'), name + ' requireDB 口径不得回改');
    assert.ok(src.includes('if (!roAssistPageAllowed()) return;'), name + ' 页面闸门不得回改');
    assert.ok(src.includes('// 11. 功能菜单归位：') && src.includes('// 12. 手机版旁观模式') && src.includes('// 13. PC 端兜底注入：'), name + ' V2.38.4 摘要必须追加 11/12/13 三条');
  }
  assert.equal((source.match(/(?<!\r)\n/g) || []).length, 0, '稳定版必须纯 CRLF');
  assert.equal((expSource.match(/\r\n/g) || []).length, 0, '实验版必须纯 LF');
});

// ================= V2.38.4 身份修复批次：按角色 ID 分档 / 名字只作显示 / 安全侧身份判定 / 防串档 =================
function extract2(s, a, b) { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, '切不出来: ' + a + ' → ' + b); return s.slice(i, j); }
function gidLike(v) { const n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; }
function identityCodeOf(src) {
  const s = lfSrc(src);
  return extract2(s, '  // V2.38.4-身份修复：稳定的角色 ID', '  // V2.38.4-身份修复：pruneProfiles 不得删掉')
    + extract2(s, '  // V2.38.4-身份修复：旧档认领（复制语义）', '  // 角色切换 → 切档')
    + extract2(s, '  function onCharChanged(ent) {', '  onId("dsh-saveprofile"');
}
function identityVm(src, opt) {
  opt = opt || {};
  const profiles = opt.profiles || {};
  const statuses = [];
  const ctx = {
    profiles, Number, String, Object, Array, JSON, Math, Date, isFinite, console,
    gidInt: gidLike,
    activeCharKey: opt.activeCharKey || 'default',
    activeProfileKey() { return ctx.activeCharKey; },
    setActiveProfile(k) { ctx.activeCharKey = k || 'default'; },
    ensureProfile(k) { if (!profiles[k]) profiles[k] = { name: k, gid: 0, charId: 0, saved: {}, lockList: {}, askList: [], lastAt: 0 }; return profiles[k]; },
    saveProfiles() { ctx.saveCount++; },
    loadSaved() { return {}; },
    lastCharId: opt.lastCharId == null ? 0 : opt.lastCharId,
    lastCharGid: opt.lastCharGid == null ? null : opt.lastCharGid,
    lastCharName: null,
    selfNameCache: {}, selfNamePending: 0,
    CLIENT: opt.CLIENT || {},
    captureAll() {}, deathReturnCancel() {}, npBattleState() { return false; }, npResetBattleState() {}, dojoStop() {}, npZeroBattle() {},
    bagClean: { generation: 0, busy: false, pending: false, config: null },
    bagCleanLoad() { return {}; }, bagCleanSave() {}, bagCleanSay() {},
    applyProfileUI() {}, fillZhuQoaskill() {}, syncApplyRuntime() {}, renderSyncState() {}, perfApply() {},
    renderWinInfo() {}, renderLockList() {}, renderAskList() {}, renderGearAll() { ctx.gearRenders++; }, gearAskRecover() {},
    fwRefreshHosts() {}, fwRestore() {}, setStatus(s) { statuses.push(s); }, tlog() {}, roFeedback() {},
    syncRealAtkRange() {}, renderStatbar() {}, btDiagOn: false, hkOf() { return null; },
    lockList: {}, askList: [], profMemKey: null, profUIApplied: true, saved: null,
    gearRenders: 0, saveCount: 0, statuses,
  };
  vm.createContext(ctx);
  vm.runInContext(identityCodeOf(src) + ';this.onCharChanged=onCharChanged;this.selfCharId=selfCharId;this.selfName=selfName;this.selfNameAsk=selfNameAsk;this.selfProfileInSync=selfProfileInSync;this.claimCandidate=claimCandidate;this.claimProfileForChar=claimProfileForChar;', ctx);
  return ctx;
}
function checkIdentityKey(src, name) {
  const ent = { GID: 2007018.939, display: { name: '' }, life: { hp: 100, hp_max: 100 } };
  const ctx = identityVm(src, { CLIENT: { SS: { GID: 999, Entity: ent } } });
  ctx.onCharChanged(ent);
  const keys = Object.keys(ctx.profiles);
  assert.ok(keys.length > 0, name + ' 必须建出档');
  assert.equal(keys.some((k) => k.indexOf('角色') >= 0), false, name + ' 名字恒空时不得生成含「角色」的档键：' + JSON.stringify(keys));
  assert.equal(ctx.activeCharKey, 'ch999', name + ' activeCharKey 必须是 ch<charId>');
  assert.equal(ctx.profiles.ch999.charId, 999, name + ' 档内必须写 charId');
}
function checkIdentityMigrateName(src, name) {
  const gearSets = { list: [{ id: 'g1', name: '练级套', at: 1, eq: { 2: { itid: 1101, refine: 7, cards: [4001], name: '剑', instanceKey: 'idx:5' } }, deck: [{ id: 4001, name: '卡', tab: 1, level: 3 }] }], sel: 'g1' };
  const before = JSON.stringify(gearSets);
  const ent = { GID: 999, display: { name: '' } };
  const ctx = identityVm(src, { profiles: { '真名_999': { gid: 999, gearSets } }, CLIENT: { SS: { GID: 999, Entity: ent } } });
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch999', name + ' 必须认领到 ch999');
  assert.ok(ctx.profiles.ch999, name + ' ch999 必须存在');
  assert.equal(JSON.stringify(ctx.profiles.ch999.gearSets), before, name + ' gearSets 必须逐字节不变');
  ent.display.name = '真名';
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch999', name + ' 名字到位也不得换键');
  assert.equal(JSON.stringify(ctx.profiles.ch999.gearSets), before, name + ' 第二次切档 gearSets 仍不得变化');
  assert.equal(ctx.profiles.ch999.name, '真名', name + ' 真名到位后档 name 必须刷新');
}
function checkIdentityMigrateDirty(src, name) {
  // V2.38.4 审计修正（F1③）：老档 gid 阶梯只认「恰好 1 个」；这里让 '错名_999' 的 gid 不匹配（=7），
  //   只留 '角色_999'（gid=999）唯一命中，继续覆盖「脏键被认领 + 复制语义 + 旧键保留 + _movedTo」；
  //   「多个老档 gid 相同 → 一律不认领」由新用例 k 覆盖。
  const gsA = { list: [{ id: 'a' }], sel: 'a' };
  const gsB = { list: [], sel: '' };
  const profiles = {
    '角色_999': { gid: 999, name: '角色', saved: { dsh_x: 1 }, gearSets: gsA, lastAt: 1 },
    '错名_999': { gid: 7, name: '错名', gearSets: gsB, lastAt: 2 },
  };
  const ent = { GID: 999, display: { name: '' } };
  const ctx = identityVm(src, { profiles, CLIENT: { SS: { GID: 999, Entity: ent } } });
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch999', name + ' 唯一 gid 命中的历史脏键必须被认领到 ch999');
  assert.equal(JSON.stringify(ctx.profiles.ch999.gearSets), JSON.stringify(gsA), name + ' 认领必须带上该老档的 gearSets');
  assert.equal(ctx.profiles.ch999.saved.dsh_x, 1, name + ' 复制语义必须带上 saved');
  assert.ok(ctx.profiles['角色_999'] && ctx.profiles['错名_999'], name + ' 旧键绝不能删');
  assert.equal(ctx.profiles['角色_999']._movedTo, 'ch999', name + ' 被迁移的旧键必须带 _movedTo');
  assert.equal(ctx.profiles['错名_999']._movedTo, undefined, name + ' 没被认领的老档绝不许加 _movedTo');
}
function checkIdentityCharId(src, name) {
  const ent = { GID: 2007018.939, display: { name: '' } };
  const ctx = identityVm(src, { CLIENT: { SS: { GID: 999, Entity: ent } } });
  assert.equal(ctx.selfCharId(), 999, name + ' 必须优先取 SS.GID');
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch999', name + ' 档键必须用 SS.GID');
  assert.equal(!!ctx.profiles['ch2007018'], false, name + ' 不得用实体 GID 当档键');
  const ctx2 = identityVm(src, { CLIENT: { SS: { Entity: { GID: 2007018.939, display: { name: '' } } } } });
  assert.equal(ctx2.selfCharId(), 0, name + ' 取不到 SS.GID 必须返回 0（审计 F2：实体 GID=账号级 AID，绝不进键）');
  ctx2.onCharChanged(ctx2.CLIENT.SS.Entity);
  assert.equal(Object.keys(ctx2.profiles).length, 0, name + ' 未识别时绝不许用实体 GID 建 ch 档：' + JSON.stringify(Object.keys(ctx2.profiles)));
}
test('V2.38.4 身份修复 a：名字恒空也不得生成「角色_」键，档键必须是 ch<charId>（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityKey(src, name);
});
test('V2.38.4 身份修复 b：预置 真名_999（带 gearSets）必须认领到 ch999 且预设逐字节不变（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityMigrateName(src, name);
});
test('V2.38.4 身份修复 c：唯一 gid 命中的脏键被认领到 ch999，旧键保留且带 _movedTo（多候选见 k）（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityMigrateDirty(src, name);
});
test('V2.38.4 身份修复 d：charId 优先取 SS.GID，实体小数 GID 只是兜底（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityCharId(src, name);
});
function kvVm(src, opt) {
  opt = opt || {};
  const store = new Map();
  if (opt.ak) store.set('dsh_ro_last_active', opt.ak);
  const profiles = opt.profiles || {};
  const statuses = [];
  const ctx = {
    profiles, Number, String, Object, Array, JSON, Math, Date, isFinite, console,
    gidInt: gidLike,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } },
    loadProfiles: () => JSON.parse(JSON.stringify(ctx.profiles)),
    activeCharKey: opt.activeCharKey || 'default',
    activeProfileKey() { return ctx.activeCharKey; },
    ensureProfile(k) { if (!profiles[k]) profiles[k] = { name: k, gid: 0, charId: 0, saved: {}, lockList: {}, askList: [], lastAt: 0 }; return profiles[k]; },
    loadSaved: () => ({}), panel: null, applyProfileUI() {}, renderLockList() {}, renderAskList() {}, renderGearAll() {},
    setStatus(s) { statuses.push(s); }, CLIENT: opt.CLIENT || {}, lockList: {}, askList: [], profMemKey: null, saved: null,
    selfNameCache: {}, selfNamePending: 0, store, statuses, selfCharId: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  // V2.38.4-身份修复：稳定的角色 ID', '  // V2.38.4-身份修复：pruneProfiles 不得删掉')
    + extract2(lfSrc(src), '  function kvRelayKeyAllowedForSelf(ak) {', '  function kvRefreshHotkeys() {')
    + ';this.kvRefreshProfile=kvRefreshProfile;this.allowed=kvRelayKeyAllowedForSelf;', ctx);
  return ctx;
}
function checkKv(src, name) {
  const mk = (o) => kvVm(src, o);
  const self = mk({ profiles: { ch999: { charId: 999 }, ch123: { charId: 123 } }, activeCharKey: 'ch999', ak: 'ch123', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939 } } } });
  assert.equal(self.allowed('ch123'), false, name + ' 别人角色的档键必须拒绝');
  assert.equal(self.allowed('ch999'), true, name + ' 自己角色的档键必须采纳');
  self.kvRefreshProfile();
  assert.equal(self.activeCharKey, 'ch999', name + ' 不得被中继切成别人角色');
  assert.equal(self.store.get('dsh_ro_last_active'), 'ch999', name + ' 必须把本地正确值写回 localStorage');
  const mine = mk({ profiles: { ch999: { charId: 999 }, ch123: { charId: 123 } }, activeCharKey: 'ch123', ak: 'ch999', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939 } } } });
  mine.kvRefreshProfile();
  assert.equal(mine.activeCharKey, 'ch999', name + ' 自己角色的档键必须采纳');
  const pre = mk({ profiles: { ch123: { charId: 123 } }, activeCharKey: 'default', ak: 'ch123', CLIENT: {} });
  assert.equal(pre.allowed('ch123'), true, name + ' 还没进游戏必须可采纳');
  const oldOk = mk({ profiles: { old: { gid: 2007018 } }, activeCharKey: 'default', ak: 'old', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939 } } } });
  assert.equal(oldOk.allowed('old'), true, name + ' 老档无 charId 时 gid 相同必须可采纳');
  const oldNo = mk({ profiles: { old: { gid: 7 } }, activeCharKey: 'default', ak: 'old', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939 } } } });
  assert.equal(oldNo.allowed('old'), false, name + ' 老档无 charId 时 gid 不同必须拒绝');
  const healer = identityVm(src, { profiles: { ch999: { charId: 999, gearSets: { list: [{ id: 'g' }], sel: 'g' } }, ch123: { charId: 123 } }, activeCharKey: 'ch123', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939, display: { name: '' } } } } });
  assert.equal(healer.selfProfileInSync(), false, name + ' 档不是当前角色必须判为失配（触发点每拍据此切回）');
  healer.onCharChanged(healer.CLIENT.SS.Entity);
  assert.equal(healer.activeCharKey, 'ch999', name + ' 下一拍必须切回当前角色档');
}
test('V2.38.4 身份修复 e：kvRefreshProfile 守卫（别人的键不采纳 / 自己的键采纳）+ 下一拍自愈切回（VM）', () => {
  for (const [name, src] of splitSources) checkKv(src, name);
});
function deathGuardVm(src, opt) {
  opt = opt || {};
  const statuses = [], notes = [], packets = [];
  const ctx = {
    Number, String, Math, JSON, isFinite, console,
    Date: { now: () => ctx.clock },
    $id: () => null, setStatus: (s) => statuses.push(s), notifyPush: (s) => notes.push(s), roFeedback: (s) => notes.push(s), tlog: () => {},
    clientReady: () => true, gidInt: gidLike, charNameOf: (e) => ((e && e.display && e.display.name) || ''),
    lastCharId: opt.lastCharId || 0, lastCharGid: opt.lastCharGid == null ? null : opt.lastCharGid, lastCharName: null,
    zRunning: true, npBattleState: () => false, stopZhu: () => { ctx.stops++; }, deathReturnCancel: () => {}, npZeroBattle: () => {},
    document: { getElementById: () => null }, czp: () => function () {},
    CLIENT: { SS: opt.SS, PS: { CZ: { RESTART: function () { this.type = 0; } } }, NM: { sendPacket: (p) => packets.push(p.type) } },
    clock: opt.clock || 1000000, stops: 0, statuses, notes, packets, tick: null,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  var DEATH_GUARD_WINDOW = 300000, DEATH_GUARD_LIMIT = 3;', '  masterTickReg(function () { deathGuardTick(); });') + ';this.deathGuardTick=deathGuardTick;', ctx);
  return ctx;
}
function deathReturnVm(src) {
  let clock = 100000, map = 'pay_fild01', mode = true, stops = 0;
  const escapeHost = null;
  const ent = { GID: 2007018.939, display: { name: '' }, life: { hp: 70, hp_max: 100 }, action: 0, ACTION: { DIE: 9, SIT: 2 } };
  const controls = { 'dsh-z-deathreturn': { checked: true }, 'dsh-z-returnmap': { value: 'pay_fild01' }, 'dsh-z-returnauto': { checked: true } };
  const packets = [], sits = [], teleports = [], statuses = [];
  const ctx = {
    Date: { now: () => clock }, Number, String, Math, JSON, isFinite, console,
    document: { getElementById: (id) => (id === 'Escape' ? escapeHost : null) },
    CLIENT: { SS: { GID: 999, Entity: ent }, PS: { CZ: { RESTART: function () { this.type = 0; } } }, NM: { sendPacket: (p) => packets.push(p.type) } },
    activeProfileKey: () => 'ch999', lastCharGid: 2007018, lastCharId: 999, lastCharName: null,
    charNameOf: (e) => ((e && e.display && e.display.name) || ''),
    profUIApplied: true,
    $id: (id) => controls[id], normMapKey: (m) => String(m || '').replace(/.gat$|.rsw$/, '').toLowerCase(), getMapName: () => map,
    gidInt: gidLike, clientReady: () => true, apiLease: null, scrRun: { running: false }, dojoRun: { on: false }, bagClean: { busy: false }, moveXY: { busy: false }, escapePending: () => false,
    zRunning: true, npBattleState: () => mode, npRequestBattle: (want) => { mode = want; return 'sent'; },
    stopZhu() { stops++; ctx.zRunning = false; mode = false; }, startZhu() { ctx.zRunning = true; },
    sendSit: (x) => { sits.push(x); ent.action = x ? 2 : 0; }, isSitting: () => ent.action === 2, isWinOpen: () => false,
    gptTeleport: (x) => { teleports.push(x); return true; }, setStatus: (s) => statuses.push(s), czp: (n) => ctx.CLIENT.PS.CZ[n],
    deathGuardRun: null, deathGuardDone: false, masterTickReg(fn) { ctx.tick = fn; },
    advance: () => { clock += 1000; }, getStops: () => stops, ent, packets, sits, teleports, statuses, tick: null,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  // Session-only intent: no stale recovery', '  // ================= 无限道场') + ';this.deathReturnTick=deathReturnTick;', ctx);
  return ctx;
}
function checkSafety(src, name) {
  const ent = { GID: 2007018.939, isDeath: false, life: { hp: 100, hp_max: 100 }, ACTION: { DIE: 9 }, action: 0, display: { name: '' } };
  const dg = deathGuardVm(src, { SS: { GID: 999, Entity: ent }, lastCharId: 999, lastCharGid: 2007018 });
  const live = () => { ent.isDeath = false; dg.clock += 1000; dg.deathGuardTick(); };
  const die = () => { ent.isDeath = true; dg.clock += 1000; dg.deathGuardTick(); };
  live(); die();
  assert.equal(dg.deathGuardAt.length, 1, name + ' 名字为空时连续死亡保护必须照常计数（身份判定放行）');
  live(); die(); live(); die();
  assert.equal(dg.stops, 1, name + ' 5 分钟 3 次死亡必须停助手（保护确实生效）');
  assert.equal(dg.deathGuardAt.length, 3, name + ' 死亡必须逐次计数');
  const dr = deathReturnVm(src);
  dr.tick();
  assert.equal(dr.getStops(), 0, name + ' 布防阶段不得停手');
  dr.ent.life.hp = 0; dr.ent.isDeath = true; dr.advance(); dr.tick();
  assert.equal(dr.getStops(), 1, name + ' 名字为空时死亡回图保护必须生效（身份判定放行）');
}
test('V2.38.4 身份修复 f：名字为空时连续死亡自动下线 / 死亡回图的身份判定必须放行（保护生效）（VM）', () => {
  for (const [name, src] of splitSources) checkSafety(src, name);
});
test('V2.38.4 身份修复 g：DB 名字解析成功写回档 + 重渲染；Unknown/失败保持「识别中」不写坏档（VM）', async () => {
  for (const [name, src] of splitSources) {
    const ent = { GID: 2007018.939, display: { name: '' } };
    let asked = 0, askedGid = 0;
    const profiles = { ch999: { name: '', charId: 999, gid: 2007018.939, saved: {}, lockList: {}, askList: [], lastAt: 1 } };
    const ctx = identityVm(src, { profiles, activeCharKey: 'ch999', CLIENT: { SS: { GID: 999, Entity: ent }, DB: { getNameByGID: (g) => { asked++; askedGid = g; return Promise.resolve('真名'); } } } });
    assert.equal(ctx.selfName(), '', name + ' 解析前必须为空（显示层写识别中）');
    ctx.selfNameAsk(999);
    await new Promise((r2) => setTimeout(r2, 0));
    assert.equal(asked, 1, name + ' 必须发起一次解析');
    assert.equal(askedGid, 999, name + ' 必须传 charId（不是实体 GID）');
    assert.equal(ctx.selfNameCache[999], '真名', name + ' 必须写入本会话缓存');
    assert.equal(ctx.profiles.ch999.name, '真名', name + ' 必须写回该档 name');
    assert.equal(ctx.selfName(), '真名', name + ' 解析后必须能拿到真名');
    assert.ok(ctx.gearRenders >= 1, name + ' 必须重渲染换装浮窗');
    ctx.selfNameAsk(999);
    assert.equal(asked, 1, name + ' 已有缓存不得重复请求');
    const mkUnknown = () => identityVm(src, { profiles: { ch999: { name: '', charId: 999 } }, activeCharKey: 'ch999', CLIENT: { SS: { GID: 999, Entity: { GID: 1, display: { name: '' } } }, DB: { getNameByGID: () => Promise.resolve('Unknown') } } });
    const un = mkUnknown();
    un.selfNameAsk(999);
    await new Promise((r2) => setTimeout(r2, 0));
    assert.equal(un.selfName(), '', name + ' Unknown 必须保持未识别');
    assert.equal(un.profiles.ch999.name, '', name + ' Unknown 不得写坏档');
    const rj = identityVm(src, { profiles: { ch999: { name: '', charId: 999 } }, activeCharKey: 'ch999', CLIENT: { SS: { GID: 999, Entity: { GID: 1, display: { name: '' } } }, DB: { getNameByGID: () => Promise.reject(new Error('x')) } } });
    rj.selfNameAsk(999);
    await new Promise((r2) => setTimeout(r2, 0));
    assert.equal(rj.selfName(), '', name + ' reject 必须保持未识别');
    assert.equal(rj.selfNamePending, 0, name + ' reject 后必须清在途标记');
    assert.equal(rj.profiles.ch999.name, '', name + ' reject 不得写坏档');
  }
});
function gearApplyVm(src, opt) {
  opt = opt || {};
  const packets = [], statuses = [];
  const ctx = {
    Number, String, Object, Array, JSON, Math, isFinite, console,
    setTimeout: () => 0, clearTimeout: () => {}, // 假定时器：绝不能留下真实 30 秒看门狗句柄拖住整个测试进程
    GEAR_SLOTS: [{ m: 2, name: '武器' }],
    gearBusy: false, gearWatchdog: null,
    CLIENT: { PS: { CZ: { REQ_TAKEOFF_EQUIP: function () {}, REQ_WEAR_EQUIP: function () {} } }, NM: { sendPacket: (p) => packets.push(p) } },
    selfCharId: () => opt.charId, activeProfileKey: () => opt.key, profiles: opt.profiles || {},
    setStatus: (s) => statuses.push(s), gearLog: (s) => statuses.push(s),
    gearPreset: () => opt.preset || null, gearInGame: () => true,
    gearReadEquipped: () => ({ ok: true, n: 0, slots: {}, why: '' }),
    gearSigEqual: () => false, gearFindInvItem: () => null, gearSlotName: () => '槽',
    gearAfterDeck: () => {}, czp: (n) => ctx.CLIENT.PS.CZ[n],
    packets, statuses,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  function gearIdentified() {', '  function gearAfterDeck(') + ';this.gearApply=gearApply;this.gearIdentified=gearIdentified;', ctx);
  return ctx;
}
function gearStatusVm(src, state) {
  const el = { textContent: '' };
  const profiles = state.profiles || {};
  const ctx = {
    Number, String, Object, Array, JSON, Math, isFinite, console,
    profiles, selfCharId: () => state.charId, selfName: () => state.name,
    activeProfileKey: () => state.key,
    gearP: () => profiles[state.key] || null,
    gearData: () => ((profiles[state.key] && profiles[state.key].gearSets) ? profiles[state.key].gearSets : { list: [], sel: '' }),
    gearReadEquipped: () => state.eq || { ok: true, n: 0, slots: {}, why: '' },
    GEAR_SLOTS: [], gearSlotName: () => '', gearBusy: false, $id: () => el,
    el,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  function gearCharLabel() {', '  function renderGearList() {') + ';this.renderGearStatus=renderGearStatus;', ctx);
  return ctx;
}
test('V2.38.4 身份修复 h：未识别角色时 gearApply 拒绝并提示（绝不发包）；已识别档已绑定必须放行（VM）', () => {
  for (const [name, src] of splitSources) {
    const bad = gearApplyVm(src, { charId: 0, key: 'default', profiles: {}, preset: { id: 'x', name: '套', eq: {} } });
    assert.equal(bad.gearApply('x'), false, name + ' 未识别必须拒绝');
    assert.equal(bad.packets.length, 0, name + ' 未识别绝不发包');
    assert.equal(bad.gearBusy, false, name + ' 拒绝时不得进入执行态');
    assert.ok(bad.statuses.join('|').indexOf('未识别当前角色，已暂停换装') >= 0, name + ' 必须给出暂停提示');
    const noProfile = gearApplyVm(src, { charId: 999, key: 'ch999', profiles: {}, preset: { id: 'x', name: '套', eq: {} } });
    assert.equal(noProfile.gearApply('x'), false, name + ' 档不存在必须拒绝');
    assert.equal(noProfile.packets.length, 0, name + ' 档不存在绝不发包');
    const okv = gearApplyVm(src, { charId: 999, key: 'ch999', profiles: { ch999: { charId: 999 } }, preset: { id: 'x', name: '套', eq: {} } });
    assert.equal(okv.gearIdentified(), true, name + ' 已识别且档已绑定必须放行');
    assert.equal(okv.gearApply('x'), true, name + ' 已识别必须能进入换装流程');
    assert.equal(okv.statuses.some((s) => String(s).indexOf('未识别当前角色') >= 0), false, name + ' 已识别不得被身份关拦下');
  }
});
test('V2.38.4 身份修复 G：换装浮窗未识别显示「角色 识别中」、真名显示真名、读取失败显示原因（VM）', () => {
  for (const [name, src] of splitSources) {
    const s1 = gearStatusVm(src, { charId: 0, name: '', key: 'default', profiles: {} });
    s1.renderGearStatus();
    assert.equal(s1.el.textContent.indexOf('角色 识别中'), 0, name + ' 未识别必须显示「角色 识别中」，实际=' + JSON.stringify(s1.el.textContent));
    const s2 = gearStatusVm(src, { charId: 999, name: '真名', key: 'ch999', profiles: { ch999: { charId: 999 } } });
    s2.renderGearStatus();
    assert.equal(s2.el.textContent.indexOf('角色 真名'), 0, name + ' 真名必须显示在浮窗，实际=' + JSON.stringify(s2.el.textContent));
    const s3 = gearStatusVm(src, { charId: 999, name: '真名', key: 'ch999', profiles: { ch999: { charId: 999 } }, eq: { ok: false, n: 0, slots: {}, why: '装备组件不可用' } });
    s3.renderGearStatus();
    assert.ok(s3.el.textContent.indexOf('读取失败：装备组件不可用') >= 0, name + ' 读取失败必须显示原因，实际=' + JSON.stringify(s3.el.textContent));
    assert.ok(s3.el.textContent.indexOf('未识别') < 0, name + ' 已识别时不得再显示未识别');
  }
});
test('V2.38.4 身份修复 G③：换装浮窗说明只剩「用法/限制」两行短句且无实现词（静态）', () => {
  for (const [name, src] of splitSources) {
    const s = lfSrc(src);
    const block = extract2(s, '    h.innerHTML = \'<div class="sec">一键换装 · 卡册</div>\'', '    var dock = $id("dsh-gear-dock");');
    assert.equal((block.match(/<div class="log">/g) || []).length, 2, name + ' 说明必须只剩两行');
    assert.ok(block.indexOf('用法：游戏里穿好一套装备、在「卡片典藏 → 我的卡组」激活好卡组，点「读取当前配置」存成预设（可改名、可配快捷键），之后点「应用」或按快捷键切回。预设按角色分开保存。') >= 0, name + ' 用法文案必须逐字一致');
    assert.ok(block.indexOf('限制：只调整身上的装备和卡组；不使用背包卡片充能（不会消耗卡片）；读卡组时会短暂打开「卡片典藏」；背包里缺的那件会跳过并列出；切换有间隔，战斗中自行看时机。') >= 0, name + ' 限制文案必须逐字一致');
    for (const w of ['发包', '客户端', '字段', '接口']) assert.equal(block.indexOf(w), -1, name + ' 说明不得出现实现词「' + w + '」');
  }
});
test('V2.38.4 身份修复 C：pruneProfiles 不得删含 gearSets / 刚迁移 / 24 小时内的档（VM）', () => {
  for (const [name, src] of splitSources) {
    const now = 1700000000000;
    const profiles = {
      'hero_1.5': { gid: 1, lastAt: 0 },
      'hero_1': { gid: 1, lastAt: 1 },
      'gear_2.5': { gid: 2, gearSets: { list: [{ id: 'g' }], sel: 'g' }, lastAt: 0 },
      'old_3.5': { gid: 3, _movedTo: 'ch3', lastAt: 0 },
      'new_4.5': { gid: 4, lastAt: now - 1000 },
      'stale_5.5': { gid: 5, lastAt: now - 90000000 },
    };
    const ctx = {
      profiles, Number, String, Object, Array, JSON, Math, isFinite, console,
      Date: { now: () => now }, saveProfiles() { ctx.saved++; }, saved: 0,
    };
    vm.createContext(ctx);
    vm.runInContext(extract2(lfSrc(src), '  function pruneProfileKeep(p, now) {', '  // 首次运行迁移：旧扁平 saved') + ';this.pruneProfiles=pruneProfiles;', ctx);
    ctx.pruneProfiles();
    const keys = Object.keys(ctx.profiles).sort();
    assert.ok(keys.indexOf('hero_1') >= 0, name + ' 整数基键必须保留：' + JSON.stringify(keys));
    assert.equal(keys.indexOf('hero_1.5') >= 0, false, name + ' 普通重复脏键应被归并：' + JSON.stringify(keys));
    assert.ok(keys.indexOf('gear_2.5') >= 0, name + ' 含 gearSets 的档绝不能删：' + JSON.stringify(keys));
    assert.ok(keys.indexOf('old_3.5') >= 0, name + ' 刚迁移的旧键绝不能删：' + JSON.stringify(keys));
    assert.ok(keys.indexOf('new_4.5') >= 0, name + ' 24 小时内的档绝不能删：' + JSON.stringify(keys));
    assert.equal(keys.indexOf('stale_5.5') >= 0, false, name + ' 又旧又无预设的重复脏键应被归并：' + JSON.stringify(keys));
  }
});
function mutateKeyToNameGid(src) {
  const s = lfSrc(src);
  const out = s.replace('      var key = "ch" + cid;', '      var key = ((selfName() || "角色") + "_" + gid);');
  assert.notEqual(out, s, '变异体①必须命中 onCharChanged 的档键派生点');
  return out;
}
function mutateKvRemoveGuard(src) {
  const s = lfSrc(src);
  const out = s.replace('      if (ak && profiles[ak] && kvRelayKeyAllowedForSelf(ak)) activeCharKey = ak;', '      if (ak && profiles[ak]) activeCharKey = ak;');
  assert.notEqual(out, s, '变异体②必须命中中继档键采纳点');
  return out;
}
function mutateSafetyBackToName(src) {
  const s = lfSrc(src);
  const out = s.split('(cid > 0 ? cid !== lastCharId : gid !== lastCharGid)').join('charNameOf(ent) !== lastCharName');
  assert.notEqual(out, s, '变异体③必须命中死亡保护的身份比较');
  return out;
}
test('V2.38.4 身份修复 变异测试：档键回退 name_gid / 删掉 KV 守卫 / 死亡保护回退名字比较 → 必须被杀死', () => {
  let m1 = '';
  try { checkIdentityKey(mutateKeyToNameGid(source), '变异①'); } catch (e) { m1 = String((e && e.message) || e); }
  assert.ok(m1, '变异体①（档键改回 name_gid）必须被身份用例杀死');
  console.log('[V2.38.4 身份修复 变异测试] ① 档键改回 name_gid 被杀死：' + m1.slice(0, 100));
  let m2 = '';
  try { checkKv(mutateKvRemoveGuard(source), '变异②'); } catch (e) { m2 = String((e && e.message) || e); }
  assert.ok(m2, '变异体②（删掉 kvRefreshProfile 守卫）必须被杀死');
  console.log('[V2.38.4 身份修复 变异测试] ② 删掉 KV 守卫被杀死：' + m2.slice(0, 100));
  let m3 = '';
  try { checkSafety(mutateSafetyBackToName(source), '变异③'); } catch (e) { m3 = String((e && e.message) || e); }
  assert.ok(m3, '变异体③（死亡保护身份判定改回名字比较）必须被杀死');
  console.log('[V2.38.4 身份修复 变异测试] ③ 死亡保护改回名字比较被杀死：' + m3.slice(0, 100));
});

// ================= V2.38.4 装备与背包读取修复批次：客户端桥接 / 槽位读取 / 背包首选路线 / 换箭 / 字段兼容 =================
function v2384Cls(sel) { const t = String(sel); const i = t.indexOf(' .item[data-index]'); if (t.charAt(0) !== '.' || i <= 1) return ''; return t.slice(1, i); }
function v2384Dom(map) { return { querySelector: (sel) => { const e = map[v2384Cls(sel)]; if (!e) return null; return { getAttribute: (a) => (a === 'data-index' ? String(e.index) : null) }; } }; }
function v2384GearCode(src) { return extract2(lfSrc(src), '  function gearLocation(', '  // ---- 卡册（卡片典藏）读取'); }
function v2384GearVm(src, opt) {
  opt = opt || {};
  const ctx = {
    Number, String, Object, Array, JSON, Math, Date, isFinite, parseInt, console,
    CLIENT: opt.CLIENT || { EquipmentLocation: { HEAD_TOP: 256, HEAD_MID: 512, HEAD_BOTTOM: 1, ARMOR: 16, WEAPON: 2, SHIELD: 32, GARMENT: 4, SHOES: 64, ACCESSORY1: 8, ACCESSORY2: 128, AMMO: 32768 } },
    profiles: opt.profiles || {}, activeProfileKey: () => opt.key || 'ch999',
    ensureProfile(k) { if (!ctx.profiles[k]) ctx.profiles[k] = { name: k, charId: 999, gearSets: { list: [], sel: '' } }; return ctx.profiles[k]; },
    saveProfiles() {}, findInventory: () => opt.inv || [], clientReady: () => true,
    uiComp: opt.uiComp || (() => null), requireDB: opt.requireDB || (() => null),
    bagItemByIndex: opt.bagItemByIndex || (() => null),
    window: opt.win || {},
    VER: '2.38.4', selfCharId: () => (opt.charId == null ? 999 : opt.charId), selfName: () => opt.name || '真名',
    gearCharLabel: () => opt.label || '真名',
    bagRead: opt.bagRead || { source: 'uiComp.Inventory.list', count: 3, arrows: 2 },
    bagList: opt.bagList || (() => null),
    clientUIManager: opt.clientUIManager || (() => null),
    gidInt: (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
  };
  vm.createContext(ctx);
  vm.runInContext(v2384GearCode(src) + ';this.G={GEAR_SLOTS,gearReadEquipped,gearSigEqual,gearFindInvItem,gearRefine,gearOptions,gearEnchantGrade,gearCards,gearItid,gearSlotName,gearEquipmentComp,gearSwitchComp,gearInventoryComp,gearDomIdx,gearDiagText};', ctx);
  return ctx;
}
test('V2.38.4 装备修复 a：11 槽全读到（isInEquipList 优先）；头三件同穿 / 双手武器 / 两枚同款饰品 / 4 卡 5 词条（1 起始）+ 附魔（VM）', () => {
  for (const [name, src] of splitSources) {
    const HEAD3 = { ITID: 5001, index: 30, RefiningLevel: 4, slot: {}, location: 769, WearState: 769 };
    const TWO = { ITID: 1101, index: 5, RefiningLevel: 7, slot: {}, location: 34 };
    const ARM = { ITID: 2301, index: 9, RefiningLevel: 2, slot: { card1: 4001, card2: 4002, card3: 4003, card4: 4004 }, Options: [null, { index: 1, value: 2, param: 3 }, { index: 4, value: 5, param: 6 }, { index: 7, value: 8, param: 9 }, { index: 10, value: 11, param: 12 }, { index: 13, value: 14, param: 15 }], enchantgrade: 4, location: 16 };
    const R1 = { ITID: 2201, index: 21, location: 8 };
    const R2 = { ITID: 2201, index: 22, location: 128 };
    const GAR = { ITID: 2501, index: 23, location: 4 };
    const SHO = { ITID: 2401, index: 24, location: 64 };
    const AMMO = { ITID: 1751, index: 25, count: 300, location: 32768 };
    const items = [HEAD3, TWO, ARM, R1, R2, GAR, SHO, AMMO];
    const EQ = { name: 'Equipment', isInEquipList: (mask) => { for (const it of items) if (it.location & mask) return it; return 0; }, getRoot: () => null };
    const G = v2384GearVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null) }).G;
    const masks = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 32768];
    assert.deepEqual(Array.from(G.GEAR_SLOTS, (x) => x.m), masks, name + ' 11 个槽位 mask');
    const cur = G.gearReadEquipped();
    assert.equal(cur.ok, true, name + ' 11 槽全读到时 ok 必须为 true，实际 ok=' + cur.ok + ' why=' + cur.why);
    assert.equal(cur.n, 11, name + ' 必须读到 11 槽，实际 ' + cur.n + ' why=' + cur.why);
    assert.equal(JSON.stringify(Object.keys(cur.slots).map(Number).sort((a, b) => a - b)), JSON.stringify(masks), name + ' slots 必须覆盖 11 个 mask');
    for (const m of masks) assert.equal(cur.routes[m], 'isInEquipList', name + ' 槽 ' + m + ' 的来源路线');
    assert.equal(cur.missing.length, 0, name + ' 全读到时不应有 missing');
    for (const m of [1, 256, 512]) { assert.equal(cur.slots[m].itid, 5001, name + ' 头三件同穿 itid'); assert.equal(cur.slots[m].wearLocation, 769, name + ' 头三件同穿 wearLocation'); }
    assert.equal(cur.slots[2].itid, 1101, name + ' 双手武器武器槽');
    assert.equal(cur.slots[2].refine, 7, name + ' 双手武器精炼');
    assert.equal(cur.slots[32].itid, 1101, name + ' 双手武器盾槽同实例');
    assert.equal(cur.slots[2].wearLocation, 34, name + ' 双手武器 WEAPON|SHIELD');
    assert.equal(cur.slots[32].wearLocation, 34, name + ' 双手武器 WEAPON|SHIELD');
    assert.equal(JSON.stringify(cur.slots[16].cards), '[4001,4002,4003,4004]', name + ' 4 张卡');
    assert.equal(cur.slots[16].options.length, 5, name + ' 5 条词条');
    assert.equal(JSON.stringify(cur.slots[16].options[1]), '{"index":4,"value":5,"param":6}', name + ' 1 起始 Options：索引 1 是第二条');
    assert.equal(cur.slots[16].enchantgrade, 4, name + ' 附魔等级');
    assert.equal(cur.slots[16].refine, 2, name + ' 衣服精炼');
    assert.equal(cur.slots[8].itid, 2201, name + ' 饰品1');
    assert.equal(cur.slots[128].itid, 2201, name + ' 饰品2 同款');
    assert.equal(cur.slots[8].idx, 21, name + ' 饰品1 idx');
    assert.equal(cur.slots[128].idx, 22, name + ' 饰品2 idx');
    assert.notEqual(cur.slots[8].instanceKey, cur.slots[128].instanceKey, name + ' 同款双饰品不得共用 instanceKey');
    assert.equal(cur.slots[32768].itid, 1751, name + ' 箭矢槽');
  }
});
function checkGearFallback(src, tag) {
  const swItem = { ITID: 1101, index: 5, RefiningLevel: 3, slot: { card1: 4001 }, location: 2 };
  const swItem2 = { ITID: 2301, index: 9, location: 16 };
  const dom = v2384Dom({ weapon: { index: 5 }, armor: { index: 9 } });
  const EQ = { name: 'Equipment', getRoot: () => dom };
  const SW = { _list: { 5: swItem, 9: swItem2 } };
  const c1 = v2384GearVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : (n === 'SwitchEquip' ? SW : null)) });
  const cur = c1.G.gearReadEquipped();
  assert.equal(cur.ok, true, tag + ' V0/V1/V2 没有 isInEquipList 时必须靠 SwitchEquip 兜底读到装备');
  assert.equal(cur.n, 2, tag + ' 兜底必须读到 2 槽，实际 ' + cur.n + ' why=' + cur.why);
  assert.equal(cur.routes[2], 'switchEquip', tag + ' 武器槽路线');
  assert.equal(cur.routes[16], 'switchEquip', tag + ' 衣服槽路线');
  assert.equal(cur.slots[2].itid, 1101, tag + ' 兜底 itid');
  assert.equal(cur.slots[2].refine, 3, tag + ' 兜底精炼');
  assert.equal(cur.slots[2].cards.join(','), '4001', tag + ' 兜底插卡');
  assert.equal(cur.slots[16].itid, 2301, tag + ' 兜底第二槽');
  const c2 = v2384GearVm(src, { uiComp: () => null, bagItemByIndex: () => null });
  const bad = c2.G.gearReadEquipped();
  assert.equal(bad.ok, false, tag + ' 一个槽都没读到必须 ok:false，绝不是「已穿 0 件」的成功');
  assert.equal(bad.n, 0, tag + ' 一个槽都没读到时 n 必须是 0');
  assert.ok(String(bad.why).length > 0, tag + ' 必须给出 why 说明原因：' + JSON.stringify(bad.why));
  assert.ok(String(bad.why).indexOf('0 槽不是成功') >= 0, tag + ' why 必须写明 0 槽不是成功：' + bad.why);
  assert.equal(bad.missing.length, 11, tag + ' missing 必须逐槽列出 11 个');
  assert.equal(bad.routes[2], 'missing', tag + ' 读不到的槽路线必须是 missing');
  assert.ok(String(bad.missWhy[2]).length > 0, tag + ' 每槽还要有失败原因');
}
test('V2.38.4 装备修复 b：V0/V1/V2 无 isInEquipList → SwitchEquip._list 兜底；全不可达 → ok:false + why（不得静默成功）（VM）', () => {
  for (const [name, src] of splitSources) checkGearFallback(src, name);
});
function gearReadCurrentVm(src, cap) {
  const logs = [], statuses = [];
  const ctx = { Number, String, Object, Array, JSON, Math, isFinite, console, Date, gearInGame: () => true, setStatus: (t) => statuses.push(t), gearLog: (t) => logs.push(t), gearCapture: (cb) => cb(cap), gearData: () => ({ list: [], sel: '' }), gearSaveSets() {}, renderGearAll() {}, logs, statuses };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  function gearReadCurrent() {', '  function gearOverwrite(') + ';this.G={go:gearReadCurrent};', ctx);
  return ctx;
}
test('V2.38.4 装备修复 c：失败显式化 —— renderGearStatus 带 why 与 missing；「读取当前配置」失败也给出原因（VM）', () => {
  for (const [name, src] of splitSources) {
    const st = gearStatusVm(src, { charId: 999, name: '真名', key: 'ch999', profiles: { ch999: { charId: 999 } }, eq: { ok: false, n: 0, slots: {}, why: '装备读取失败：一个槽都没读到（0 槽不是成功）', missing: ['武器', '盾'] } });
    st.renderGearStatus();
    assert.ok(String(st.el.textContent).indexOf('装备读取失败：一个槽都没读到（0 槽不是成功）') >= 0, name + ' 必须显示 why，实际=' + st.el.textContent);
    assert.ok(String(st.el.textContent).indexOf('未读到：武器、盾') >= 0, name + ' 必须逐槽列出 missing，实际=' + st.el.textContent);
    const rc = gearReadCurrentVm(src, { eqOk: false, eqWhy: '装备读取失败：一个槽都没读到', deckOk: false, why: '卡册未测' });
    rc.G.go();
    assert.ok(rc.logs.join('|').indexOf('读取当前配置失败：装备读取失败：一个槽都没读到') >= 0, name + ' 读取失败必须给出原因，实际=' + rc.logs.join('|'));
    assert.ok(rc.statuses.join('|').indexOf('读取当前配置失败：') >= 0, name + ' 状态栏也要给出原因');
  }
});
function v2384BagCode(src) {
  const s = lfSrc(src);
  return extract2(s, '  var bagRead = { source: "未读取", count: 0, arrows: 0 };', '  function bagDiagText() {')
    + extract2(s, '  function readBagWorn(slotBit) {', '  function readBagAmmo() {');
}
function v2384BagVm(src, opt) {
  opt = opt || {};
  const ctx = { Number, String, Object, Array, JSON, Math, isFinite, console, CLIENT: opt.CLIENT || {}, uiComp: opt.uiComp || (() => null), requireDB: opt.requireDB || (() => null) };
  vm.createContext(ctx);
  vm.runInContext(v2384BagCode(src) + ';this.B={bagList,bagItemByIndex,bagRead,bagCountArrows,bagListOk,readBagWorn};', ctx);
  return ctx;
}
function checkBagRoute(src, tag) {
  const inv = [{ ITID: 1750, index: 3, count: 100, type: 10, WearState: 0 }, { ITID: 1751, index: 4, count: 50, type: 10, WearState: 32768 }, { ITID: 501, index: 7, count: 2, type: 0, WearState: 0 }];
  const INV = { list: inv, getItemByIndex: (i) => inv.find((x) => x.index === i) || null };
  const c1 = v2384BagVm(src, { uiComp: (n) => (n === 'Inventory' ? INV : null) });
  const list = c1.B.bagList();
  assert.ok(list === inv, tag + ' bagList 必须原样返回组件 list（数组同一引用），实际=' + (list && list.length));
  assert.equal(c1.B.bagRead.source, 'uiComp.Inventory.list', tag + ' 必须命中 uiComp("Inventory") 首选路线');
  assert.equal(c1.B.bagRead.count, 3, tag + ' 件数');
  assert.equal(c1.B.bagRead.arrows, 2, tag + ' 箭矢种数');
  for (let i = 0; i < inv.length; i++) {
    const it = list[i];
    assert.equal(it.ITID, inv[i].ITID, tag + ' 元素 ' + i + ' ITID');
    assert.equal(it.index, inv[i].index, tag + ' 元素 ' + i + ' index');
    assert.equal(it.count, inv[i].count, tag + ' 元素 ' + i + ' count');
    assert.equal(it.type, inv[i].type, tag + ' 元素 ' + i + ' type');
    assert.equal(it.WearState, inv[i].WearState, tag + ' 元素 ' + i + ' WearState（形状必须与旧契约一致）');
  }
  assert.ok(c1.B.bagItemByIndex(4) === inv[1], tag + ' getItemByIndex 路线必须命中');
  assert.ok(c1.B.readBagWorn(32768) === inv[1], tag + ' readBagWorn(32768) 必须命中箭矢');
  assert.equal(c1.B.readBagWorn(2), null, tag + ' 没有武器槽穿戴标记时必须 null');
  const c2 = v2384BagVm(src, { uiComp: () => null, requireDB: (n) => (n === 'UI/Components/Inventory/Inventory' ? { list: inv } : null) });
  assert.ok(c2.B.bagList() === inv, tag + ' 旧 requireDB 组件路线必须保留为兜底');
  assert.equal(c2.B.bagRead.source, 'Inventory.list', tag + ' 兜底路线名');
  assert.equal(c2.B.readBagWorn(32768).index, 4, tag + ' 兜底路线也要能回读箭矢');
}
test('V2.38.4 背包修复 d：bagList 首选 uiComp("Inventory")，返回形状与旧契约逐字段一致；旧三条路线保留兜底（VM）', () => {
  for (const [name, src] of splitSources) checkBagRoute(src, name);
});
function v2384ArrowCode(src) {
  const s = lfSrc(src);
  return extract2(s, '  function gearLocation(', '  // ---- 卡册（卡片典藏）读取')
    + extract2(s, '  var zArrow = { lastBag: 0, lastEquip: 0, lastLog: "", failBag: 0 };', '  // V2.16.27：读当前装备武器')
    + extract2(s, '  function gearCountOf(it) {', '  function readEquippedWeaponType() {')
    + extract2(s, '  function readEquippedWeaponType() {', '  function readEquippedAmmo() {')
    + extract2(s, '  function readEquippedAmmo() {', '  // V2.38.2：按穿戴位掩码')
    + extract2(s, '  function readBagWorn(slotBit) {', '  function readBagArrows() {')
    + extract2(s, '  function readBagArrows() {', '  function equipArrow(index) {')
    + extract2(s, '  function equipArrow(index) {', '  function tickArrow() {')
    + extract2(s, '  function tickArrow() {', '  masterTickReg(function () { try { tickArrow()');
}
function v2384ArrowVm(src, opt) {
  opt = opt || {};
  const bag = opt.bag || [];
  const packets = [], logEl = { textContent: '' };
  const ctx = {
    Number, String, Object, Array, JSON, Math, isFinite, parseInt, console, Date,
    ARROW_PLAIN_ITID: 1750, ARROW_MAGIC_QUIVER: 2000030, ARROW_LOW_AMMO: 50,
    arrowRules: { enabled: true, defaultItid: 1750, byMid: {}, byElem: {} },
    arrowTarget: null, externalAutomationOwns: () => false, arrowSelfWanted: () => false,
    clientReady: () => true,
    $id: (id) => (id === 'dsh-arrowen' ? { checked: true } : (id === 'dsh-arrowlog' ? logEl : null)),
    arrowPos: (v) => { const n = Number(v); return (isFinite(n) && n > 0) ? n : null; },
    arrowUseQuiver: () => null, useItemById: () => false,
    arrowItemName: (i) => '箭' + i, getItemName: (i) => 'IT' + i,
    itipDB: () => ({ getWeaponType: (id) => (Number(id) === 1101 ? 11 : 0) }),
    CLIENT: { EquipmentLocation: { WEAPON: 2, SHIELD: 32, AMMO: 32768, ARMOR: 16 }, PS: { CZ: { REQ_WEAR_EQUIP: function () {} } }, NM: { sendPacket: (p) => packets.push({ index: p.index, wearLocation: p.wearLocation }) } },
    profiles: {}, activeProfileKey: () => 'ch999',
    ensureProfile(k) { if (!ctx.profiles[k]) ctx.profiles[k] = { name: k, gearSets: { list: [], sel: '' } }; return ctx.profiles[k]; },
    saveProfiles() {}, findInventory: () => bag,
    uiComp: opt.uiComp || (() => null), requireDB: () => null,
    bagItemByIndex: opt.bagItemByIndex || (() => null),
    bagList: () => bag,
    window: {}, packets, logEl,
  };
  ctx.czp = (n) => ctx.CLIENT.PS.CZ[n];
  vm.createContext(ctx);
  vm.runInContext(v2384ArrowCode(src) + ';this.A={tickArrow,readEquippedAmmo,readEquippedWeaponType,equippedWeaponItid,readBagWorn,readBagArrows,zArrow};', ctx);
  return ctx;
}
test('V2.38.4 换箭修复 e：readEquippedAmmo / readEquippedWeaponType 走新路线；存量 50 与 49 的边界与既有规则一致（VM）', () => {
  for (const [name, src] of splitSources) {
    const weapon = { ITID: 1101, index: 5, location: 2 };
    const ammo = { ITID: 1751, index: 4, count: 50, location: 32768 };
    const fallback = { ITID: 1750, index: 6, count: 999, location: 32768 };
    const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? weapon : (m === 32768 ? ammo : 0)) };
    const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
    const c = v2384ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
    assert.equal(c.A.readEquippedWeaponType().wt, 11, name + ' 弓 = 武器类型 11');
    assert.equal(c.A.readEquippedWeaponType().itid, 1101, name + ' 武器 ITID');
    assert.ok(String(c.A.readEquippedWeaponType().why).indexOf('isInEquipList') >= 0, name + ' 必须走 isInEquipList 路线，实际=' + c.A.readEquippedWeaponType().why);
    assert.equal(JSON.stringify(c.A.readEquippedAmmo()), JSON.stringify({ index: 4, count: 50, itid: 1751, src: 'isInEquipList' }), name + ' 箭矢读取走 isInEquipList');
    c.A.tickArrow();
    assert.equal(c.packets.length, 0, name + ' 存量 50 恰好到阈值 → 必须不动作');
    assert.ok(String(c.logEl.textContent).indexOf('当前箭矢 ×50') >= 0, name + ' 存量 50 必须报「当前箭矢 ×50」，实际=' + c.logEl.textContent);
    ammo.count = 49;
    assert.equal(c.A.readEquippedAmmo().count, 49, name + ' 存量 49 读数');
    c.A.tickArrow();
    assert.deepEqual(c.packets, [{ index: 7, wearLocation: 32768 }], name + ' 存量 49 < 阈值 → 必须装上背包里的那支箭');
    assert.ok(String(c.logEl.textContent).indexOf('已装上背包里的') >= 0, name + ' 必须写换箭日志，实际=' + c.logEl.textContent);
    const EQ2 = { name: 'Equipment', getRoot: () => v2384Dom({ weapon: { index: 5 }, ammo: { index: 4 } }) };
    const SW = { _list: { 5: weapon, 4: fallback } };
    const c2 = v2384ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ2 : (n === 'SwitchEquip' ? SW : null)), bagItemByIndex: () => null });
    assert.equal(c2.A.readEquippedWeaponType().wt, 11, name + ' 无 isInEquipList 时武器类型仍必须正确');
    assert.ok(String(c2.A.readEquippedWeaponType().why).indexOf('switchEquip') >= 0, name + ' 武器必须走 switchEquip 兜底，实际=' + c2.A.readEquippedWeaponType().why);
    assert.equal(JSON.stringify(c2.A.readEquippedAmmo()), JSON.stringify({ index: 6, count: 999, itid: 1750, src: 'switchEquip' }), name + ' 箭矢必须走 switchEquip 兜底');
  }
});
test('V2.38.4 字段兼容 f：refiningLevel / Refine、grade、1 起始 Options 与 0 起始 options（VM）', () => {
  for (const [name, src] of splitSources) {
    const G = v2384GearVm(src, {}).G;
    assert.equal(G.gearRefine({ RefiningLevel: 6 }), 6, name + ' RefiningLevel');
    assert.equal(G.gearRefine({ refiningLevel: 5 }), 5, name + ' RefiningLevel 缺失但 refiningLevel 存在');
    assert.equal(G.gearRefine({ Refine: 3 }), 3, name + ' Refine 兜底');
    assert.equal(G.gearRefine({ refine: 2 }), 2, name + ' refine 兜底');
    assert.equal(G.gearRefine({}), 0, name + ' 都没有 = 0');
    for (const k of ['enchantgrade', 'Enchantgrade', 'enchantGrade', 'EnchantGrade', 'grade', 'Grade']) assert.equal(G.gearEnchantGrade({ [k]: 4 }), 4, name + ' 附魔字段 ' + k);
    assert.equal(JSON.stringify(G.gearOptions({ Options: [null, { index: 1, value: 2, param: 3 }, null, { index: 4, value: 5, param: 6 }] })), '[{"index":1,"value":2,"param":3},{"index":4,"value":5,"param":6}]', name + ' 1 起始 Options');
    assert.equal(JSON.stringify(G.gearOptions({ Options: [null, { Index: 11, Value: 22, Param: 33 }] })), '[{"index":11,"value":22,"param":33}]', name + ' Options 里的首字母大写字段兼容');
    assert.equal(JSON.stringify(G.gearOptions({ options: [{ id: 7, value: 8, param: 9 }, { id: 0, value: 0, param: 0 }, { id: 10, value: 0, param: 1 }] })), '[{"index":7,"value":8,"param":9},{"index":10,"value":0,"param":1}]', name + ' 0 起始 options（{id,value,param}，空位跳过）');
    assert.equal(JSON.stringify(G.gearOptions({ options: { Index0: 7, Value0: 8, Param0: 9 } })), '[]', name + ' 虚构的 Index0/Value0/Param0 对象分支必须已删除');
    assert.equal(JSON.stringify(G.gearOptions({})), '[]', name + ' 没有词条 = 空数组');
  }
});
function v2384CaptureVm(src, readEq) {
  const ctx = {
    Number, String, Object, Array, JSON, Math, isFinite, console,
    GEAR_SLOTS: [{ m: 1 }, { m: 2 }, { m: 4 }, { m: 8 }, { m: 16 }, { m: 32 }, { m: 64 }, { m: 128 }, { m: 256 }, { m: 512 }, { m: 32768 }],
    gearReadEquipped: () => readEq,
    gearDeckSnapshot: (cb) => cb({ ok: false, why: '卡册未测', cards: [], wasOpen: false }),
    gearCardComp: () => null, gearCardTabMap: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(extract2(lfSrc(src), '  function gearCapture(cb) {', '  function gearReadCurrent() {') + ';this.C={go:gearCapture};', ctx);
  return ctx;
}
test('V2.38.4 落档 g：新存预设条目不含 idx，旧条目（带 idx）仍能匹配，idx 缺失时 instanceKey 不依赖 index（VM）', () => {
  for (const [name, src] of splitSources) {
    const slot = { itid: 1101, refine: 7, cards: [4001], options: [{ index: 1, value: 2, param: 3 }], enchantgrade: 4, idx: 5, name: '剑', wearLocation: 2, instanceKey: 'idx:5' };
    const c = v2384CaptureVm(src, { ok: true, n: 1, why: '', slots: { 2: slot } });
    let cap = null;
    c.C.go((r) => { cap = r; });
    assert.ok(cap && cap.eqOk === true, name + ' 必须回调出 eqOk=true');
    assert.equal(cap.eqN, 1, name + ' 件数');
    assert.ok(cap.eq[2], name + ' 必须落档槽 2');
    assert.equal(Object.prototype.hasOwnProperty.call(cap.eq[2], 'idx'), false, name + ' 新存预设条目绝不能写 idx：' + JSON.stringify(cap.eq[2]));
    assert.deepEqual(Object.keys(cap.eq[2]), ['itid', 'refine', 'cards', 'options', 'enchantgrade', 'name', 'wearLocation', 'instanceKey'], name + ' 落档字段表必须固定');
    const G = v2384GearVm(src, {}).G;
    const oldWant = { itid: 1101, refine: 7, cards: [4001], options: [{ index: 1, value: 2, param: 3 }], enchantgrade: 4, idx: 5, name: '剑', wearLocation: 2, instanceKey: 'idx:5' };
    assert.equal(G.gearSigEqual(oldWant, cap.eq[2]), true, name + ' 旧预设条目（带 idx）必须仍能与当前读到的条目匹配');
    assert.equal(G.gearSigEqual({ itid: 1101, refine: 7, cards: [4001] }, { itid: 1101, refine: 7, cards: [4001], idx: 9 }), true, name + ' 匹配不得依赖 idx');
  }
});
test('V2.38.4 读取诊断 h：可复制文本含「背包数据源=」、每槽路线、missing、档键+charId+角色名与本服 Equipment 组件名（VM + 静态）', () => {
  for (const [name, src] of splitSources) {
    const EQ = { name: 'Equipment', isInEquipList: () => 0, getRoot: () => null };
    const c = v2384GearVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), label: '真名', charId: 888, bagList: () => [{ index: 1, ITID: 1750, type: 10, count: 5 }], bagRead: { source: 'uiComp.Inventory.list', count: 1, arrows: 1 } });
    const txt = c.G.gearDiagText();
    assert.ok(String(txt).indexOf('背包数据源=uiComp.Inventory.list') >= 0, name + ' 必须带「背包数据源=」：' + String(txt).slice(0, 160));
    assert.ok(String(txt).indexOf('Equipment 组件名=Equipment') >= 0, name + ' 必须带本服 Equipment 组件名');
    assert.ok(String(txt).indexOf('档键=ch999') >= 0, name + ' 必须带当前档键');
    assert.ok(String(txt).indexOf('charId=888') >= 0, name + ' 必须带 charId');
    assert.ok(String(txt).indexOf('角色名=真名') >= 0, name + ' 必须带角色名');
    assert.ok(String(txt).indexOf('missing=') >= 0, name + ' 必须带 missing');
    for (const m of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 32768]) {
      assert.ok(String(txt).indexOf('(' + m + '/.') >= 0, name + ' 每槽都要有一行，缺 ' + m);
    }
    const routeLines = String(txt).split('路线=').length - 1;
    assert.equal(routeLines, 11, name + ' 11 个槽都必须带路线，实际 ' + routeLines);
    assert.ok(src.includes('id="dsh-gear-diag"'), name + ' 换装窗口必须有「读取诊断」按钮');
    assert.ok(src.includes('id="dsh-gear-diagbox"'), name + ' 换装窗口必须有可复制的诊断文本框');
    assert.ok(src.includes('onId("dsh-gear-diag", "click", function () { gearReadDiag(); });'), name + ' 按钮必须绑定 gearReadDiag');
    assert.ok(src.includes('function gearDiagText()'), name + ' 必须有 gearDiagText');
  }
});
test('V2.38.4 客户端桥接：clientUIManager 走 StatusIcons.manager，uiComp 包住 getComponent 的抛错（VM）', () => {
  for (const [name, src] of splitSources) {
    const code = extract2(lfSrc(src), '  function clientUIManager() {', '  // ---------------- 技能名 / 怪物名 / 物品名（客户端模块）----------------');
    const eqComp = { name: 'Equipment' };
    const UM = { getComponent(n) { if (n === 'Equipment') return eqComp; throw new Error('UIManager.getComponent() - Component "' + n + '" not found'); } };
    const SI = { name: 'StatusIcons', manager: UM };
    const base = () => ({ requireDB: (n) => (n === 'UI/Components/StatusIcons/StatusIcons' ? SI : null) });
    const c1 = base(); vm.createContext(c1);
    vm.runInContext(code + ';this.U={clientUIManager,uiComp};', c1);
    assert.ok(c1.U.clientUIManager() === UM, name + ' clientUIManager 必须返回 StatusIcons.manager');
    assert.ok(c1.U.uiComp('Equipment') === eqComp, name + ' uiComp 必须取回真实组件');
    assert.equal(c1.U.uiComp('NoSuchComp'), null, name + ' 组件不存在（getComponent 抛错）必须返回 null 而不是抛');
    assert.equal(c1.U.uiComp(''), null, name + ' 空名字必须返回 null');
    assert.equal(c1.U.uiComp(null), null, name + ' null 名字必须返回 null');
    const c2 = { requireDB: () => null }; vm.createContext(c2);
    vm.runInContext(code + ';this.U={clientUIManager,uiComp};', c2);
    assert.equal(c2.U.clientUIManager(), null, name + ' StatusIcons 拿不到时必须 null');
    assert.equal(c2.U.uiComp('Equipment'), null, name + ' UIManager 不可达时 uiComp 必须 null');
    const c3 = { requireDB: () => { throw new Error('boom'); } }; vm.createContext(c3);
    vm.runInContext(code + ';this.U={clientUIManager,uiComp};', c3);
    assert.equal(c3.U.clientUIManager(), null, name + ' requireDB 抛错时必须被吞掉');
    const c4 = { requireDB: () => ({ name: 'StatusIcons' }) }; vm.createContext(c4);
    vm.runInContext(code + ';this.U={clientUIManager,uiComp};', c4);
    assert.equal(c4.U.uiComp('Equipment'), null, name + ' 组件没有 manager 时 uiComp 必须 null');
  }
});
test('V2.38.4 静态：不再有 EQ.ui.find 代理写法、0 槽不是成功、背包首选 uiComp("Inventory")、requireDB 白名单外零新增依赖', () => {
  for (const [name, src] of splitSources) {
    const s2 = lfSrc(src);
    assert.equal(s2.includes('EQ.ui.find'), false, name + ' 必须删掉 Equipment 的 .ui.find(...).eq(0).attr(...) 代理写法');
    assert.ok(s2.includes('root.querySelector("." + cls + " .item[data-index]")'), name + ' 槽位索引必须走 getRoot().querySelector(".槽位 .item[data-index]")');
    assert.ok(s2.includes('out.ok = (out.n > 0);'), name + ' ok 必须由读到的槽数决定');
    assert.ok(s2.includes('out.missing.push(gearSlotName(mask));'), name + ' missing 必须逐槽记录');
    assert.ok(s2.includes('out.routes[mask]'), name + ' routes 必须逐槽记录路线');
    assert.ok(s2.includes('if (_ic) list = bagSourceTry("uiComp.Inventory.list", _ic.list);'), name + ' bagList 必须首选 uiComp("Inventory")');
    assert.ok(s2.includes('return uiComp("Inventory");') || s2.includes('uiComp("Inventory")'), name + ' 背包路线必须走桥接');
    assert.ok(s2.includes('EQ.isInEquipList(2)'), name + ' 武器读取必须首选 isInEquipList(2)');
    assert.ok(s2.includes('EQ.isInEquipList(32768)'), name + ' 箭矢读取必须首选 isInEquipList(32768)');
    assert.equal(/requireDB\("UI\/Components\/(Equipment|Inventory\/Inventory|BasicInventory|UIManager)/.test(s2), true, name + ' 旧 requireDB 路线仍作为兜底保留');
    assert.equal(s2.includes('charNameOf'), false, name + ' 死代码 charNameOf 必须删除');
  }
});
function mutate2384GearOnlyEquip(src) {
  const s = lfSrc(src);
  const out = s.split('var domIdx = gearDomIdx(root, cls);').join('var domIdx = null; // 变异①：只走 Equipment 组件（去掉 DOM/兜底路线）');
  assert.notEqual(out, s, '变异①必须命中 gearReadEquipped 的槽位 DOM 索引读取');
  return out;
}
function mutate2384ZeroSlotsOk(src) {
  const s = lfSrc(src);
  const out = s.split('out.ok = (out.n > 0);').join('out.ok = true; // 变异②：0 槽也当成功');
  assert.notEqual(out, s, '变异②必须命中 ok 判定');
  return out;
}
function mutate2384BagIgnoreNewRoute(src) {
  const s = lfSrc(src);
  const out = s.split('if (_ic) list = bagSourceTry("uiComp.Inventory.list", _ic.list);').join('if (_ic) list = null; // 变异③：忽略新首选路线');
  assert.notEqual(out, s, '变异③必须命中 bagList 的新首选路线');
  return out;
}
test('V2.38.4 装备/背包修复 变异测试：只走 Equipment 组件 / 0 槽改回 ok:true / bagList 忽略新路线 → 必须被杀死', () => {
  let m1 = '';
  try { checkGearFallback(mutate2384GearOnlyEquip(source), '变异①'); } catch (e) { m1 = String((e && e.message) || e); }
  assert.ok(m1, '变异体①（gearReadEquipped 只走 Equipment 组件）必须被用例 b 杀死');
  console.log('[V2.38.4 装备修复 变异测试] ① 只走 Equipment 组件被杀死：' + m1.slice(0, 110));
  let m2 = '';
  try { checkGearFallback(mutate2384ZeroSlotsOk(source), '变异②'); } catch (e) { m2 = String((e && e.message) || e); }
  assert.ok(m2, '变异体②（0 槽改回 ok:true）必须被用例 b 杀死');
  console.log('[V2.38.4 装备修复 变异测试] ② 0 槽改回 ok:true 被杀死：' + m2.slice(0, 110));
  let m3 = '';
  try { checkBagRoute(mutate2384BagIgnoreNewRoute(source), '变异③'); } catch (e) { m3 = String((e && e.message) || e); }
  assert.ok(m3, '变异体③（bagList 忽略新路线）必须被用例 d 杀死');
  console.log('[V2.38.4 装备修复 变异测试] ③ bagList 忽略新路线被杀死：' + m3.slice(0, 110));
});

// ================= V2.38.4 审计修正批次（F1–F6）：跨角色误认领 / 档身份只用 char_id / 连续死亡保护换角色清零 / readBagWorn location / 分帧 rest / 诊断可见性 =================
function hasOwnKey(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function identityGearVm(src, opt) {
  const ctx = identityVm(src, opt);
  vm.runInContext(extract2(lfSrc(src), '  function gearIdentified() {', '  function gearAfterDeck(') + ';this.gearIdentified=gearIdentified;', ctx);
  return ctx;
}
function checkIdentityUnidentified(src, name) {
  const profiles = { '老档_5555': { gid: 5555, name: '老角色', gearSets: { list: [{ id: 'old' }], sel: 'old' }, saved: { dsh_x: 1 }, lastAt: 9 } };
  const before = JSON.stringify(profiles['老档_5555']);
  const ent = { GID: 5555.9, display: { name: '' } };
  const ctx = identityGearVm(src, { profiles: profiles, CLIENT: { SS: { Entity: ent } } });
  assert.equal(ctx.selfCharId(), 0, name + ' 取不到 SS.GID 必须返回 0（F2：不再回落实体 GID）');
  ctx.onCharChanged(ent);
  assert.equal(Object.keys(ctx.profiles).length, 1, name + ' 未识别（cid<=0）时绝不许新建任何档，实际=' + JSON.stringify(Object.keys(ctx.profiles)));
  assert.equal(ctx.activeCharKey, 'default', name + ' 未识别时绝不许切档');
  assert.equal(ctx.gearIdentified(), false, name + ' 未识别时 gearIdentified() 必须为 false（换装继续拒绝并提示）');
  assert.equal(ctx.profiles['老档_5555']._movedTo, undefined, name + ' 未识别时绝不认领/迁移老档');
  assert.equal(JSON.stringify(ctx.profiles['老档_5555']), before, name + ' 未识别时老档必须逐字节不变');
  ctx.CLIENT.SS.GID = 4321; // 同一页面后续某一拍 char_id 到位
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch4321', name + ' SS.GID 到位后必须正常建 ch<charId> 并切档');
  assert.ok(ctx.profiles.ch4321, name + ' ch4321 必须存在');
  assert.equal(ctx.gearIdentified(), true, name + ' 识别到位后 gearIdentified() 必须放行');
}
test('V2.38.4 审计修正 i：cid<=0（CLIENT.SS 无 GID）不建档/不切档/不认领，gearIdentified()=false；SS.GID 到位后正常建 ch<charId>（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityUnidentified(src, name);
});
function checkIdentityNoCrossClaim(src, name) {
  const gsA = { list: [{ id: 'A', name: 'A套', at: 1 }], sel: 'A' };
  const profiles = { ch999: { charId: 999, gid: 5555, name: '角色A', gearSets: gsA, saved: { dsh_x: 9 }, lockList: { '1': { name: 'A的锁' } }, askList: [{ skid: 1 }], lastAt: 5 } };
  const before999 = JSON.stringify(profiles.ch999);
  const ent = { GID: 5555, display: { name: '' } };
  const ctx = identityGearVm(src, { profiles: profiles, CLIENT: { SS: { GID: 222, Entity: ent } } });
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch222', name + ' 必须切到自己的 ch222');
  assert.ok(ctx.profiles.ch222, name + ' ch222 必须存在（新建空档）');
  assert.equal(hasOwnKey(ctx.profiles.ch222, 'gearSets'), false, name + ' 别人的档（已带 charId=999）绝不能当候选：B 的档不得含 A 的 gearSets，实际=' + JSON.stringify(ctx.profiles.ch222.gearSets));
  assert.equal(ctx.profiles.ch999._movedTo, undefined, name + ' ch999 绝不允许被标 _movedTo');
  assert.equal(JSON.stringify(ctx.profiles.ch999), before999, name + ' ch999 必须逐字节不变（不得被删/被改写）');
}
test('V2.38.4 审计修正 j：跨角色误认领攻击 —— 别人的档（charId=999、gid 相同 5555）绝不被认领，B 拿不到 A 的 gearSets（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityNoCrossClaim(src, name);
});
function checkIdentityAmbiguousGid(src, name) {
  const gsA = { list: [{ id: 'a' }], sel: 'a' }, gsB = { list: [{ id: 'b' }], sel: 'b' };
  const profiles = {
    oldA: { gid: 5555, name: '甲', gearSets: JSON.parse(JSON.stringify(gsA)), saved: { dsh_x: 1 }, lastAt: 5 },
    oldB: { gid: 5555, name: '乙', gearSets: JSON.parse(JSON.stringify(gsB)), saved: { dsh_y: 2 }, lastAt: 6 },
  };
  const snapA = JSON.stringify(profiles.oldA), snapB = JSON.stringify(profiles.oldB);
  const ent = { GID: 5555, display: { name: '' } };
  const ctx = identityGearVm(src, { profiles: profiles, CLIENT: { SS: { GID: 222, Entity: ent } } });
  ctx.onCharChanged(ent);
  assert.equal(ctx.activeCharKey, 'ch222', name + ' 有候选也要切到自己的 ch222');
  assert.equal(hasOwnKey(ctx.profiles.ch222, 'gearSets'), false, name + ' 两个老档 gid 相同 → 多于 1 个一律不认领');
  assert.equal(ctx.profiles.oldA._movedTo, undefined, name + ' oldA 不得被标 _movedTo');
  assert.equal(ctx.profiles.oldB._movedTo, undefined, name + ' oldB 不得被标 _movedTo');
  assert.equal(JSON.stringify(ctx.profiles.oldA), snapA, name + ' oldA 必须逐字节不变');
  assert.equal(JSON.stringify(ctx.profiles.oldB), snapB, name + ' oldB 必须逐字节不变');
  const g = v2384GearVm(src, { profiles: { oldA: { gid: 5555, gearSets: gsA }, oldB: { gid: 5555, gearSets: gsB } }, key: 'ch222', charId: 222 });
  const txt = String(g.G.gearDiagText());
  assert.ok(txt.indexOf('未认领旧档：') >= 0, name + ' 诊断必须有「未认领旧档：」行');
  assert.ok(txt.indexOf('oldA') >= 0 && txt.indexOf('oldB') >= 0, name + ' 候选清单必须列出 oldA/oldB，实际=' + JSON.stringify(txt.slice(txt.indexOf('未认领旧档：'))));
  assert.ok(txt.indexOf('识别状态：') >= 0, name + ' 诊断必须有「识别状态：」行');
  assert.ok(txt.indexOf('charId 可用（222）') >= 0, name + ' 识别状态必须写明 charId 可用，实际=' + JSON.stringify((txt.match(/识别状态：.*/) || [''])[0]));
}
test('V2.38.4 审计修正 k：两个老档 gid 相同、都无 charId、都带 gearSets → 不认领、旧档不动，候选清单出现在诊断文本里（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityAmbiguousGid(src, name);
});
function checkIdentityNameClaim(src, name) {
  const gs = { list: [{ id: 'g1', name: '练级套', at: 1 }], sel: 'g1' };
  const before = JSON.stringify(gs);
  // 唯一同名 → 认领成功（实体 GID 故意不同：只能靠名字阶梯命中）
  const one = identityGearVm(src, { profiles: { '真名老档': { gid: 777, name: '真名', gearSets: JSON.parse(before), lastAt: 3 } }, CLIENT: { SS: { GID: 222, Entity: { GID: 5555, display: { name: '真名' } } } } });
  one.onCharChanged(one.CLIENT.SS.Entity);
  assert.equal(one.activeCharKey, 'ch222', name + ' 唯一同名老档必须被认领到 ch222');
  assert.equal(JSON.stringify(one.profiles.ch222.gearSets), before, name + ' 认领后 gearSets 必须逐字节不变');
  assert.equal(one.profiles['真名老档']._movedTo, 'ch222', name + ' 被认领的旧键必须带 _movedTo');
  // 多个同名 → 一律不认领
  const many = identityGearVm(src, { profiles: { A1: { gid: 1, name: '真名', gearSets: JSON.parse(before), lastAt: 1 }, B1: { gid: 2, name: '真名', gearSets: JSON.parse(before), lastAt: 2 } }, CLIENT: { SS: { GID: 222, Entity: { GID: 5555, display: { name: '真名' } } } } });
  many.onCharChanged(many.CLIENT.SS.Entity);
  assert.equal(many.activeCharKey, 'ch222', name + ' 多个同名时仍切到自己的档');
  assert.equal(hasOwnKey(many.profiles.ch222, 'gearSets'), false, name + ' 多个同名老档 → 一律不认领');
  assert.equal(many.profiles.A1._movedTo, undefined, name + ' A1 不得被标 _movedTo');
  assert.equal(many.profiles.B1._movedTo, undefined, name + ' B1 不得被标 _movedTo');
}
test('V2.38.4 审计修正 l：老档无 charId 且 p.name === 真名（唯一）→ 认领且 gearSets 逐字节不变；多个同名 → 不认领（VM）', () => {
  for (const [name, src] of splitSources) checkIdentityNameClaim(src, name);
});
function checkDeathGuardResetOnSwitch(src, name) {
  const ent1 = { GID: 5555, display: { name: '' } };
  const ctx = identityVm(src, { profiles: {}, CLIENT: { SS: { GID: 222, Entity: ent1 } } });
  ctx.onCharChanged(ent1); // 先建立 ch222
  ctx.deathGuardAt = [1, 2]; ctx.deathGuardDone = true; ctx.deathGuardDead = true;
  ctx.onCharChanged(ent1); // 同一角色重复回调（档已对齐的早退分支）→ 计数必须保留
  assert.equal(ctx.deathGuardAt.length, 2, name + ' 同角色重复回调（档已对齐）绝不许清零死亡计数');
  assert.equal(ctx.deathGuardDone, true, name + ' 同角色重复回调绝不许清 deathGuardDone');
  assert.equal(ctx.deathGuardDead, true, name + ' 同角色重复回调绝不许清 deathGuardDead');
  const ent2 = { GID: 5555, display: { name: '' } };
  ctx.CLIENT.SS.GID = 333; ctx.CLIENT.SS.Entity = ent2;
  ctx.onCharChanged(ent2); // 真换角色
  assert.equal(ctx.activeCharKey, 'ch333', name + ' 必须切到新角色档 ch333');
  assert.equal(ctx.deathGuardAt.length, 0, name + ' 换角色后 deathGuardAt 必须清零（A 的 2 次死亡不得顶掉 B）');
  assert.equal(ctx.deathGuardDone, false, name + ' 换角色后 deathGuardDone 必须复位');
  assert.equal(ctx.deathGuardDead, false, name + ' 换角色后 deathGuardDead 必须复位');
}
test('V2.38.4 审计修正 m：切角色必须重置 deathGuardAt/deathGuardDone/deathGuardDead（同角色重复回调不清零）（VM）', () => {
  for (const [name, src] of splitSources) checkDeathGuardResetOnSwitch(src, name);
});
function checkBagWornLocation(src, name) {
  const invLoc = [
    { ITID: 1751, index: 4, count: 50, type: 10, location: 32768 },
    { ITID: 1101, index: 5, count: 1, type: 0, location: 2 },
    { ITID: 501, index: 7, count: 2, type: 0 },
  ];
  const c = v2384BagVm(src, { uiComp: (n) => (n === 'Inventory' ? { list: invLoc, getItemByIndex: (i) => invLoc.find((x) => x.index === i) || null } : null) });
  assert.ok(c.B.readBagWorn(32768) === invLoc[0], name + ' 只带 location 的箭矢件必须命中 32768');
  assert.ok(c.B.readBagWorn(2) === invLoc[1], name + ' 只带 location 的武器件必须命中 2');
  assert.equal(c.B.readBagWorn(16), null, name + ' 掩码不匹配必须 null');
  assert.equal(c.B.readBagWorn(32768).ITID, 1751, name + ' 命中件的 ITID 必须原样返回');
  const c2 = v2384BagVm(src, { uiComp: (n) => (n === 'Inventory' ? { list: [{ ITID: 1751, index: 9, count: 1, WearState: 2, location: 32768 }] } : null) });
  assert.equal(c2.B.readBagWorn(32768), null, name + ' 有 WearState 时必须仍以 WearState 为准（location 只是兜底）');
  assert.equal(c2.B.readBagWorn(2).index, 9, name + ' WearState=2 必须命中武器槽');
}
test('V2.38.4 审计修正 n：readBagWorn 对只带 location 的背包件也按掩码命中（WearState 仍在先）（VM）', () => {
  for (const [name, src] of splitSources) checkBagWornLocation(src, name);
});
test('V2.38.4 审计修正 静态：F1–F6 锚点就位，旧的跨角色认领分支与 selfCharId 实体 GID 回退已删净', () => {
  for (const [name, src] of splitSources) {
    const t = lfSrc(src);
    // F1
    assert.ok(t.includes('function gearOldProfileKeys() {'), name + ' 必须有老档候选池 gearOldProfileKeys');
    assert.equal((t.match(/if \(gidInt\(p\.charId\) > 0\) continue;/g) || []).length, 1, name + ' 老档池必须只排除一次「已带 charId 的档」');
    assert.ok(t.includes('      if (gidInt(p.charId) !== cid) continue; // 老档与「别人的档」都不在这里命中'), name + ' charId 阶梯必须显式排除别人的档');
    assert.ok(t.includes('if (byGid.length === 1) return byGid[0];'), name + ' gid 阶梯必须恰好 1 个才认领');
    assert.ok(t.includes('if (byName.length === 1) return byName[0];') && t.includes('if (byName.length > 1) return null;'), name + ' name 阶梯必须恰好 1 个才认领');
    assert.equal(t.includes('} else if (gid > 0 && gidInt(p.gid) === gid) {'), false, name + ' 旧的「任何 gid 相同都当候选」分支必须删净');
    assert.ok(t.includes('var cand = claimCandidate(cid, gid, selfName());'), name + ' 认领必须把真名传给候选阶梯');
    // F2
    assert.ok(t.includes('      return gidInt(CLIENT.SS && CLIENT.SS.GID);'), name + ' selfCharId 必须只取 SS.GID');
    assert.equal(t.includes('return gidInt(ent && ent.GID);'), false, name + ' selfCharId 绝不许退回实体 GID');
    // F3
    assert.ok(t.includes('try { deathGuardAt = []; deathGuardDone = false; deathGuardDead = false; } catch (eDG) {}'), name + ' 切档必须重置连续死亡保护计数');
    // F4
    assert.ok(t.includes('it.location != null ? it.location :'), name + ' readBagWorn 必须补 location 兜底');
    // F5
    assert.ok(t.includes('catch (eOp0) { return { frames: 0, rest: total }; }'), name + ' op0 异常回退必须记 rest: total');
    // F6
    assert.ok(t.includes('L.push("识别状态："'), name + ' 诊断必须有「识别状态：」');
    assert.ok(t.includes('L.push("未认领旧档："'), name + ' 诊断必须有「未认领旧档：」');
    // 版本不变
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.5', name + ' @version 必须仍是 2.38.5');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.5', name + ' VER 必须仍是 2.38.5');
  }
  assert.equal((source.match(/(?<!\r)\n/g) || []).length, 0, '稳定版必须纯 CRLF');
  assert.equal((expSource.match(/\r\n/g) || []).length, 0, '实验版必须纯 LF');
});
function mutateClaimAnyGid(src) {
  const s = lfSrc(src);
  const out = s.replace('        if (gidInt(p.charId) > 0) continue;\n        out.push(k);',
    '        out.push(k); // 变异①：不再排除已带 charId 的档（任何 gid 相同都进候选池）');
  assert.notEqual(out, s, '变异体①必须命中老档候选池的 charId 排除');
  return out;
}
function mutateCharIdFallbackGid(src) {
  const s = lfSrc(src);
  const out = s.replace('      return gidInt(CLIENT.SS && CLIENT.SS.GID);',
    '      var cid = gidInt(CLIENT.SS && CLIENT.SS.GID);\n      if (cid > 0) return cid;\n      var ent = CLIENT.SS && CLIENT.SS.Entity;\n      return gidInt(ent && ent.GID); // 变异②：退回实体 GID（账号级 AID）');
  assert.notEqual(out, s, '变异体②必须命中 selfCharId');
  return out;
}
function mutateDropDeathGuardReset(src) {
  const s = lfSrc(src);
  const out = s.replace('      try { deathGuardAt = []; deathGuardDone = false; deathGuardDead = false; } catch (eDG) {}\n', '');
  assert.notEqual(out, s, '变异体③必须命中切档处的计数器重置');
  return out;
}
test('V2.38.4 审计修正 变异测试：候选放宽回「任何 gid 相同」/ selfCharId 退回实体 GID / 删掉切档计数器重置 → 必须被杀死', () => {
  checkIdentityNoCrossClaim(source, '基线复核(未变异)');
  checkIdentityUnidentified(source, '基线复核(未变异)');
  checkDeathGuardResetOnSwitch(source, '基线复核(未变异)');
  let m1 = '';
  try { checkIdentityNoCrossClaim(mutateClaimAnyGid(source), '变异①'); } catch (e) { m1 = String((e && e.message) || e); }
  assert.match(m1, /绝不能当候选|_movedTo|逐字节不变/, '变异体①（候选放宽回任何 gid 相同）必须被用例 j 杀死，实际=' + JSON.stringify(m1.slice(0, 160)));
  console.log('[V2.38.4 审计修正 变异测试] ① 候选放宽回「任何 gid 相同」被杀死：' + m1.slice(0, 110));
  let m2 = '';
  try { checkIdentityUnidentified(mutateCharIdFallbackGid(source), '变异②'); } catch (e) { m2 = String((e && e.message) || e); }
  assert.match(m2, /取不到 SS.GID 必须返回 0|绝不许新建任何档/, '变异体②（selfCharId 退回实体 GID）必须被用例 i 杀死，实际=' + JSON.stringify(m2.slice(0, 160)));
  console.log('[V2.38.4 审计修正 变异测试] ② selfCharId 退回实体 GID 被杀死：' + m2.slice(0, 110));
  let m3 = '';
  try { checkDeathGuardResetOnSwitch(mutateDropDeathGuardReset(source), '变异③'); } catch (e) { m3 = String((e && e.message) || e); }
  assert.match(m3, /换角色后 deathGuardAt 必须清零|deathGuardDone/, '变异体③（删掉切档计数器重置）必须被用例 m 杀死，实际=' + JSON.stringify(m3.slice(0, 160)));
  console.log('[V2.38.4 审计修正 变异测试] ③ 删掉切档计数器重置被杀死：' + m3.slice(0, 110));
});

// ================= V2.38.4 实机反馈三修：寻怪走开（名单门/追怪卡住/混合接管） / 解围技能读丢 / 混合追怪下马 =================
const LF = String.fromCharCode(10);
function cutLf(src, a, b) {
  const s = lfSrc(src);
  const n = s.split(a).length - 1;
  assert.equal(n, 1, '切段锚点必须唯一(' + n + '): ' + a);
  const i = s.indexOf(a), j = s.indexOf(b, i);
  assert.ok(i >= 0 && j > i, '切段失败: ' + a);
  return s.slice(i, j);
}
function vmMob(gid, job, pos, hp) {
  return { GID: gid, _job: job, objecttype: 5, position: pos, life: { hp: hp == null ? 100 : hp }, ACTION: { DIE: 9 }, action: 0, isDeath: false, remove_tick: 0 };
}
// ---------------- A：zWalk 候选池（名单门）VM ----------------
function walkVm(src, opt) {
  const o = opt || {};
  const seg = cutLf(src, '      var EM = requireDB("Renderer/EntityManager");' + LF + '      var anyLock = Object.keys(lockList).length > 0;', '      if (near) {');
  const logs = [];
  const controls = { 'dsh-z-allmobs': { checked: !!o.allMobs }, 'dsh-z-ona': { value: o.ona || '还击' } };
  const ent = o.ent || { position: [0, 0] };
  const ctx = {
    now: o.now == null ? 50000 : o.now,
    zHpWatch: { lastHitAt: o.lastHitAt == null ? -1e9 : o.lastHitAt },
    $id: (id) => controls[id] || null,
    requireDB: () => ({ forEach: (cb) => o.mobs.forEach(cb) }),
    CLIENT: { SS: { Entity: ent } },
    ent: ent,
    lockList: o.lockList || {},
    zLock: { gid: null, reactive: false },
    zBossSkipGid: 0,
    gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
    zRangeDist: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])),
    zHitBy: {}, zHitKeepMs: 3000,
    zWalkState: { lastLockMissLog: 0 },
    zMon: { action: '未启动' },
    zAtkWhy: '',
    tlog: (m) => logs.push(m),
    Object, Math, String, parseInt, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext('this.fn = function () {' + LF + seg + LF + '  return { near: near, nearD: nearD, seen: zWalkSeenMob, blocked: zWalkBlockedMob, why: zAtkWhy, act: zMon.action };' + LF + '};', ctx);
  const out = ctx.fn();
  out.logs = logs;
  out.ctx = ctx;
  return out;
}
function walkScenarios(src, tag) {
  const ent = { position: [0, 0] };
  const a1 = walkVm(src, { mobs: [vmMob(1, '9999', [5, 0])], lockList: { '1002': { name: 'Poring' } }, allMobs: true, ent: ent });
  assert.equal(a1.near, null, tag + ' 名单外怪不得成为追怪目标');
  assert.equal(a1.blocked, 1, tag + ' 必须统计到被名单门挡掉的怪');
  assert.equal(a1.why, '视野内有怪但不在锁定名单', tag + ' zAtkWhy 必须写明原因（不静默直走）');
  assert.match(String(a1.act), /不在锁定名单/, tag + ' zMon.action 必须写明原因');
  assert.ok(a1.logs.some((l) => /walk-lock-miss/.test(l)), tag + ' 必须有 walk-lock-miss 日志');
  const a2 = walkVm(src, { mobs: [vmMob(2, '1002', [5, 0])], lockList: { '1002': { name: 'Poring' } }, allMobs: false, ent: ent });
  assert.ok(a2.near && a2.near.GID === 2, tag + ' 名单内怪必须成为追怪目标（不得直走）');
  assert.equal(a2.why, '', tag + ' 正常追怪不得写名单门原因');
  const a3 = walkVm(src, { mobs: [vmMob(3, '1002', [4, 1])], lockList: {}, allMobs: false, ent: ent });
  assert.equal(a3.near, null, tag + ' 全打关 + 名单空 → 无候选');
  assert.equal(a3.why, '视野内有怪但不在锁定名单', tag + ' 全打关也必须写明原因');
  const a4 = walkVm(src, { mobs: [vmMob(4, '1002', [4, 1])], lockList: {}, allMobs: true, ent: ent });
  assert.ok(a4.near && a4.near.GID === 4, tag + ' 名单空 + 全打开 → 必须追');
}
test('V2.38.4 实机反馈三修 A：名单门不静默直走（不在名单 → 直走+写明原因；在名单/打全部怪 → 必须追）', () => {
  for (const [name, src] of splitSources) walkScenarios(src, name);
  for (const [name, src] of splitSources) {
    const walk = cutLf(src, '  function zWalk() {', '  function zAttack() {');
    const reasonAt = walk.indexOf('if (!near && zWalkBlockedMob > 0) {');
    const nearAt = walk.indexOf('      if (near) {');
    const straightAt = walk.indexOf('var walkInt = Math.max(0.3');
    assert.ok(reasonAt > 0 && nearAt > reasonAt && straightAt > nearAt, name + ' 原因块必须在候选池之后、near 分支之前，直走段在 near 分支之后');
    assert.equal(walk.split('if (!inLockN && !allowHitTarget) return;').length - 1, 1, name + ' 名单门 gate 行必须保持原样且唯一');
    assert.ok(walk.includes('var inLockN = anyLock ? !!(mid && lockList[mid]) : zAllMobsW;'), name + ' 名单语义不得改变（名单非空只打名单）');
  }
});
// ---------------- B：追怪卡住判定 VM ----------------
function chaseVm(src, opt) {
  const o = opt || {};
  const seg = cutLf(src, '        // V2.38.4 追怪卡住判定加强', '        var chaseInt = (parseFloat($id("dsh-z-chaseint").value) || 0.5) * 1000;');
  const logs = [];
  const flew = { n: 0 };
  const ctx = {
    $id: (id) => ({ 'dsh-z-idlefly': { checked: true }, 'dsh-z-flykill': { checked: true } }[id] || null),
    doFly: () => { flew.n++; return true; },
    markFlyOk: () => {}, markFlyFail: () => {},
    tlog: (m) => logs.push(m), setStatus: () => {},
    zWalkState: o.state, near: o.near, ent: o.ent,
    zRangeDist: () => o.dist,
    Math, parseFloat,
  };
  vm.createContext(ctx);
  vm.runInContext('this.fn = function (now) {' + LF + seg + LF + '};', ctx);
  return { ctx: ctx, logs: logs, flew: flew, run: (now) => { ctx.fn(now); return flew.n; }, setDist: (v) => { o.dist = v; } };
}
function chaseScenarios(src, tag) {
  const near = { GID: 77, position: [10, 0] };
  // b1 4s 距离未缩小 + 角色未位移 → 不得瞬移；先重规划，6s+ 才允许
  const st1 = { chaseGid: 77, chaseDist: 5, chaseSince: 0, chaseFrom: null, chaseReplan: false, lastIdleFly: 0 };
  const h1 = chaseVm(src, { state: st1, near: near, ent: { position: [0, 0] }, dist: 5 });
  h1.ctx.fn(10000);
  assert.equal(st1.chaseSince, 10000, tag + ' 距离未缩小必须建立卡住窗口');
  assert.equal(h1.run(12000), 0, tag + ' 2s 未到阈值不得瞬移');
  h1.ctx.fn(14000);
  assert.equal(st1.chaseReplan, true, tag + ' 满 4s 必须先换接近点/重规划，不得立刻瞬移');
  assert.equal(h1.run(15500), 0, tag + ' 5.5s（新阈值 6s 未到）不得瞬移');
  assert.equal(h1.run(16000), 1, tag + ' 6s + 距离未缩小 + 角色未位移 + 已重规划 → 允许瞬移');
  assert.equal(st1.chaseSince, 0, tag + ' 瞬移后窗口清零');
  // b1b 15s 节流仍生效
  const st1b = { chaseGid: 77, chaseDist: 5, chaseSince: 1000, chaseFrom: [0, 0], chaseReplan: true, lastIdleFly: 6000 };
  const h1b = chaseVm(src, { state: st1b, near: near, ent: { position: [0, 0] }, dist: 5 });
  assert.equal(h1b.run(9000), 0, tag + ' 15s 瞬移节流未到不得瞬移');
  // b2 距离未缩小但角色自身在位移 → 不得瞬移，chaseSince 立刻清零
  const st2 = { chaseGid: 77, chaseDist: 5, chaseSince: 0, chaseFrom: null, chaseReplan: false, lastIdleFly: 0 };
  const ent2 = { position: [0, 0] };
  const h2 = chaseVm(src, { state: st2, near: near, ent: ent2, dist: 5 });
  h2.ctx.fn(10000);
  ent2.position = [3, 0];
  h2.ctx.fn(16000);
  assert.equal(st2.chaseSince, 0, tag + ' 角色位移达标必须立刻清零 chaseSince');
  ent2.position = [5, 0];
  h2.ctx.fn(17000);
  ent2.position = [7, 0];
  h2.ctx.fn(20000);
  assert.equal(h2.flew.n, 0, tag + ' 角色在位移 → 不得瞬移（旧口径只看距离会误飞）');
  assert.equal(h2.run(26000), 0, tag + ' 位移清零后重新计时，不得累积到瞬移');
  assert.equal(h2.run(32000), 0, tag + ' 位移清零后重新计时，不得累积到瞬移');
  // b3 与锁定怪距离在缩小 → chaseSince 清零
  const st3 = { chaseGid: 77, chaseDist: 5, chaseSince: 0, chaseFrom: null, chaseReplan: false, lastIdleFly: 0 };
  const h3 = chaseVm(src, { state: st3, near: near, ent: { position: [0, 0] }, dist: 5 });
  h3.ctx.fn(10000);
  h3.ctx.fn(11000);
  assert.equal(st3.chaseSince, 10000, tag + ' 距离持平必须继续计时');
  h3.setDist(4);
  h3.ctx.fn(12000);
  assert.equal(st3.chaseSince, 0, tag + ' 与锁定怪距离缩小 → chaseSince 立刻清零');
  assert.equal(h3.run(20000), 0, tag + ' 距离在缩小不得瞬移');
}
test('V2.38.4 实机反馈三修 B：追怪卡住判定加强（4s 不得瞬移 / 角色位移达标清零 / 6s+已重规划才允许）', () => {
  for (const [name, src] of splitSources) chaseScenarios(src, name);
  const walk = cutLf(source, '  function zWalk() {', '  function zAttack() {');
  for (const k of ['chaseMoved < 2', 'chaseStuckMs >= 6000', 'chaseStuckMs >= 4000 && !zWalkState.chaseReplan', 'zWalkState.chaseReplan = true', 'zWalkState.chaseFrom']) {
    assert.ok(walk.includes(k), 'zWalk 追怪卡住判定缺少 ' + k);
  }
  assert.ok(walk.includes('now - zWalkState.lastIdleFly >= 15000'), '15s 瞬移节流必须保留');
  assert.ok(walk.includes('$id("dsh-z-idlefly") && $id("dsh-z-idlefly").checked'), '防御瞬移总开关必须保留');
});
// ---------------- C：混合寻怪接管改按距离进展 VM ----------------
function hybridVm(src, opt) {
  const o = opt || {};
  const clock = { t: o.t == null ? 1000 : o.t };
  const logs = [], statuses = [];
  const flags = { stops: 0, ensures: 0 };
  const ctx = {
    Date: { now: () => clock.t },
    isHybrid: () => true,
    takeoverDist: () => 12,
    npBattleState: () => (o.realNp === undefined ? true : o.realNp),
    npHuntOn: !!o.npHuntOn,
    npHuntStop: () => { flags.stops++; },
    npEnsureHunt: () => { flags.ensures++; },
    ent: { position: [0, 0] },
    near: { GID: 777, position: [40, 0] },
    nearD: o.nearD,
    zHpWatch: { lastHitAt: -1e9 },
    zWalkState: o.state,
    tlog: (m) => logs.push(m),
    setStatus: (m, c) => statuses.push([m, c]),
    distInt: (v) => Math.floor(v),
    Math, String, parseInt, Object,
  };
  vm.createContext(ctx);
  const seg = cutLf(src, '          if (isHybrid()) {', '          } else if (nearD > atkR0) {');
  vm.runInContext('this.fn = function () {' + LF + seg + LF + '}' + LF + '};', ctx);
  return { ctx: ctx, clock: clock, logs: logs, statuses: statuses, flags: flags };
}
function hybridState() { return { hyTakeoverUntil: 0, hySince: 0, hyGid: 0, hyPos: null, hyDist: 0, hyStillSince: 0 }; }
function hybridScenarios(src, tag) {
  // c1 内挂在跑（realNp=true）但 2.5s 内距离未缩小 → 助手接管 12s + 日志/状态
  const st1 = hybridState();
  const h1 = hybridVm(src, { state: st1, nearD: 20, realNp: true, t: 1000 });
  h1.ctx.fn();
  assert.equal(st1.hyTakeoverUntil, 0, tag + ' 首拍不得立刻接管');
  h1.clock.t = 2000; h1.ctx.fn();
  assert.equal(st1.hyTakeoverUntil, 0, tag + ' 2.5s 未到不得接管');
  h1.clock.t = 3700; h1.ctx.fn();
  assert.equal(st1.hyTakeoverUntil, 3700 + 12000, tag + ' 距离未缩小满 2.5s → 助手接管 12s');
  assert.ok(h1.logs.some((l) => /hybrid-takeover/.test(l)), tag + ' 接管必须有 tlog');
  assert.ok(h1.logs.some((l) => /still=/.test(l)), tag + ' 接管日志必须含距离进展口径');
  assert.ok(h1.statuses.some((s) => /内挂未接管/.test(s[0])), tag + ' 接管必须有状态提示');
  assert.ok(h1.flags.ensures >= 2, tag + ' 接管前必须保持内挂寻怪');
  // c2 距离在缩小 → 不接管
  const st2 = hybridState();
  const h2 = hybridVm(src, { state: st2, nearD: 20, realNp: true, t: 1000 });
  h2.ctx.fn();
  for (const n of [19, 18, 17, 16]) { h2.clock.t += 1000; h2.ctx.nearD = n; h2.ctx.fn(); }
  assert.equal(st2.hyTakeoverUntil, 0, tag + ' 与锁定怪距离在缩小 → 不得接管');
  assert.ok(h2.flags.ensures >= 5, tag + ' 距离在缩小必须继续让内挂走（实际 ' + h2.flags.ensures + '）');
  // c3 内挂实际关闭（realNp=false）→ 立刻接管
  const st3 = hybridState();
  const h3 = hybridVm(src, { state: st3, nearD: 20, realNp: false, t: 1000 });
  h3.ctx.fn();
  assert.equal(st3.hyTakeoverUntil, 1000 + 12000, tag + ' 内挂实际关闭必须立刻接管');
  assert.ok(h3.logs.some((l) => /realNp=false/.test(l)), tag + ' 关闭接管日志必须含 realNp=false');
  // c4 接管窗口内内挂在跑 → 必须先关掉，窗口不重置
  const st4 = hybridState(); st4.hyTakeoverUntil = 5000;
  const h4 = hybridVm(src, { state: st4, nearD: 20, realNp: true, t: 1000, npHuntOn: true });
  h4.ctx.fn();
  assert.equal(h4.flags.stops, 1, tag + ' 接管窗口内内挂在跑必须先关掉（防两边抢控制）');
  assert.equal(st4.hyTakeoverUntil, 5000, tag + ' 接管窗口内不得重置');
}
test('V2.38.4 实机反馈三修 C：混合寻怪接管改按「与锁定怪距离未缩小」判定（VM）', () => {
  for (const [name, src] of splitSources) hybridScenarios(src, name);
  for (const [name, src] of splitSources) {
    const walk = cutLf(src, '  function zWalk() {', '  function zAttack() {');
    assert.ok(walk.includes('hyStill >= 2500'), name + ' 必须沿用 2.5s 口径');
    assert.ok(walk.includes('zWalkState.hyTakeoverUntil = hyNow + 12000'), name + ' 接管窗口必须是 12 秒');
    assert.ok(walk.includes('if (nearD < zWalkState.hyDist) zWalkState.hyStillSince = 0;'), name + ' 距离缩小必须清零停滞计时');
  }
});
// ---------------- D：解围技能下拉（读丢 / 存档清空）VM ----------------
function qoaVm(src, opt) {
  const o = opt || {};
  const logs = [];
  const sel = { value: o.value == null ? '' : o.value, innerHTML: o.html == null ? 'ORIGINAL' : o.html };
  const ctx = {
    $id: (id) => (id === 'dsh-z-qoaskill' ? sel : null),
    learnedActiveSkills: () => (o.skills || []),
    getSkillNameById: (k) => '技能' + k,
    tlog: (m) => logs.push(m),
    Date, String, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(cutLf(src, '  function fillZhuQoaskill() {', '  // V2.16.5 周期兜底') + LF + ';this.fn = fillZhuQoaskill;', ctx);
  ctx.fn();
  return { sel: sel, logs: logs, ctx: ctx };
}
function qoaFillScenarios(src, tag) {
  const d1 = qoaVm(src, { skills: [], value: '171', html: 'ORIGINAL' });
  assert.equal(d1.sel.value, '171', tag + ' learnedActiveSkills 返回 [] → 必须保留当前选择');
  assert.equal(d1.sel.innerHTML, 'ORIGINAL', tag + ' learnedActiveSkills 返回 [] → 绝不重建下拉');
  assert.equal(d1.logs.length, 0, tag + ' 读空不得记录清空日志');
  const d2 = qoaVm(src, { skills: [{ skid: 171, lv: 5, name: '解围' }], value: '171', html: 'OLD' });
  assert.equal(d2.sel.value, '171', tag + ' 列表含当前技能必须保持');
  assert.ok(d2.sel.innerHTML.indexOf('value="171"') >= 0, tag + ' 列表命中必须重建出该技能选项');
  const d3 = qoaVm(src, { skills: [{ skid: 100, lv: 3, name: 'X' }], value: '171', html: 'OLD' });
  assert.equal(d3.sel.value, '', tag + ' 读到了非空列表且不含当前技能 → 才允许清空');
  assert.ok(d3.logs.some((l) => /qoaskill-clear/.test(l) && l.indexOf('171') >= 0 && l.indexOf('1个') >= 0), tag + ' 清空必须记 tlog（含 skid 与技能条数）');
}
function qoaCaptureCtx(src, controls, els, savedUi) {
  const savedState = { ui: savedUi };
  const ctx = { PROF_CONTROLS: controls, $id: (id) => els[id] || null, saved: savedState, saveSaved: () => {}, profUIApplied: true };
  vm.createContext(ctx);
  vm.runInContext(cutLf(src, '  function captureAll() {', '  // V2.16.7：配置控件统一 change 即时保存') + LF + ';this.fn = captureAll', ctx);
  return { ctx: ctx, savedState: savedState };
}
function qoaSaveScenarios(src, tag) {
  const mk = (learned, elValue, savedValue, extra) => {
    const h = qoaCaptureCtx(src, [['dsh-z-qoaskill', 'v']], { 'dsh-z-qoaskill': { value: elValue } }, { 'dsh-z-qoaskill': savedValue });
    h.ctx.learnedActiveSkills = learned;
    Object.assign(h.ctx, extra || {});
    h.ctx.fn();
    return h.savedState.ui['dsh-z-qoaskill'];
  };
  assert.equal(mk(() => [], '', '171', { zRunning: true }), '171', tag + ' 读取不可用时保存必须跳过写入，保留档里已存值');
  assert.equal(mk(() => [{ skid: 100, lv: 1 }], '', '171', { zRunning: false, zQoaSkillCleared: 0, zHpWatch: { lastHitAt: -1e9 }, npHuntOn: false }), '', tag + ' 非战斗且能读到列表时才允许把清空落盘（换角色/洗点语义）');
  assert.equal(mk(() => [{ skid: 100, lv: 1 }], '', '171', { zRunning: true, zQoaSkillCleared: Date.now(), zHpWatch: { lastHitAt: -1e9 }, npHuntOn: false }), '171', tag + ' 战斗中清空只清 UI，不写空值');
}
test('V2.38.4 实机反馈三修 D：解围技能读空不得清空下拉 / 存档不得被空值清掉（VM）', () => {
  for (const [name, src] of splitSources) { qoaFillScenarios(src, name); qoaSaveScenarios(src, name); }
  for (const [name, src] of splitSources) {
    const fn = cutLf(src, '  function fillZhuQoaskill() {', '  // V2.16.5 周期兜底');
    const early = fn.indexOf('if (!skills || !skills.length) return;');
    assert.ok(early > 0 && early < fn.indexOf('sel.innerHTML = html;'), name + ' 读空早退必须在重建下拉之前');
    assert.ok(fn.includes('if (keep) { sel.value = cur; return; }'), name + ' 命中当前技能必须保持');
    const itv = cutLf(src, '  // V2.16.5 周期兜底', '  function fillSkillSelects() {');
    assert.ok(itv.includes('if (selQ.value) return;'), name + ' 8s 兜底必须改为「当前选择为空 → 补」');
    assert.ok(!itv.includes('options.length > 1'), name + ' 旧 options.length 判据必须消失');
    assert.ok(src.includes('if (id === "dsh-z-qoaskill") {'), name + ' captureAll 必须有解围技能存档保护');
  }
});
// ---------------- E：寻怪自动上马（多来源 / fail-closed / 使用后验证 / 追怪窗口）VM ----------------
function reinVm(src, opt) {
  const o = opt || {};
  const clock = { t: o.t == null ? 1000000 : o.t };
  const uses = [], logs = [], statuses = [];
  const ctx = {
    Date: { now: () => clock.t },
    $id: (id) => ({ 'dsh-z-rein': { checked: true }, 'dsh-z-ona': { value: o.ona || '还击' } }[id] || null),
    clientReady: () => true,
    hookStatusIcons: () => {},
    tlog: (m) => logs.push(m),
    setStatus: (m, c) => statuses.push([m, c]),
    useItemById: (id) => { uses.push(id); return true; },
    CLIENT: { SS: { Entity: o.ent } },
    buffActive: o.buffActive || {},
    dshSIState: o.dshSIState || 'no-mod',
    zRunning: true,
    zLock: o.zLock || { gid: null },
    zAtkLast: o.zAtkLast || null,
    npHuntOn: !!o.npHuntOn,
    npBattleState: () => (o.npState === undefined ? (o.npHuntOn ? true : false) : o.npState),
    zWalkState: o.zWalkState || { lastMove: 0 },
    zHpWatch: { lastHitAt: o.lastHitAt == null ? -1e9 : o.lastHitAt },
    entStatus: () => (o.status || null),
    isSitting: () => !!o.sitting,
    needSitNow: () => !!o.needSit,
    escapePending: () => !!o.escapePending,
    lastFly: o.lastFly || 0,
    zLastFlyReason: o.flyReason || '',
    zLastFlyReasonAt: o.flyAt || 0,
    requireDB: () => null, calcAtkRange: () => 2,
    Math, String, parseInt, Number, Object,
  };
  vm.createContext(ctx);
  const code = 'var reinLastUse = 0, reinFailStreak = 0, reinBackoffUntil = 0, reinPendingAt = 0, reinWarnAt = 0, zReinSkipWhy = "", zReinAoeAt = 0, zReinMapAt = 0;' + LF
    + cutLf(src, '  var DSH_ENT_STATE = {', '  // V1.7.7 状态速查弹层按钮')
    + LF + cutLf(src, '  function reinMountState() {', '  function tickRein() {')
    + LF + cutLf(src, '  function tickRein() {', '  masterTickReg(function () { try { tickRein(); }');
  vm.runInContext(code + LF + ';this.tick = tickRein; this.state = reinMountState; this.road = zReinRoadMoving; this.skipWhy = function () { return zReinSkipWhy; }; this.setAoeAt = function (v) { zReinAoeAt = v; }; this.setMapAt = function (v) { zReinMapAt = v; };', ctx);
  return { ctx: ctx, clock: clock, uses: uses, logs: logs, statuses: statuses };
}
function reinScenarios(src, tag) {
  const T = 1000000;
  const cnt = (arr, re) => arr.filter((l) => re.test(l)).length;
  const walking = (h) => { h.ctx.zWalkState.lastMove = h.clock.t - 100; }; // 保持「无目标直走赶路中」
  // e1 判活环 613 可读 → 已骑乘 → 不用道具
  const e1 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: { 613: { on: true, endAt: 2e9 } }, zWalkState: { lastMove: T - 100 } });
  e1.ctx.tick();
  assert.deepEqual(e1.uses, [], tag + ' 613 可读到骑乘 → 不用缰绳');
  assert.equal(e1.ctx.state().riding, true, tag + ' 613 → riding=true');
  // e2 只有 27 可读（实体无 riding 字段）→ 已骑乘 → 不用道具（多来源并集）
  const e2 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: { 27: { on: true, endAt: 2e9 } }, zWalkState: { lastMove: T - 100 } });
  e2.ctx.tick();
  assert.deepEqual(e2.uses, [], tag + ' 27 可读到骑乘 → 不用缰绳');
  assert.equal(e2.ctx.state().known, true, tag + ' 27 → known=true');
  assert.equal(e2.ctx.state().riding, true, tag + ' 27 → riding=true');
  // e3 实体字段 riding=1 可读 → 不用道具
  const e3 = reinVm(src, { t: T, ent: { life: { hp: 1 }, riding: 1 }, zWalkState: { lastMove: T - 100 } });
  e3.ctx.tick();
  assert.deepEqual(e3.uses, [], tag + ' 实体 riding=1 → 不用缰绳');
  // e4 全来源不可用 → fail-closed 不用道具 + 30s 节流日志
  const e4 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'no-mod', zWalkState: { lastMove: T - 100 } });
  e4.ctx.tick();
  assert.deepEqual(e4.uses, [], tag + ' 骑乘状态全来源读不到 → 本拍不上马（fail-closed）');
  assert.equal(e4.ctx.state().known, false, tag + ' 全来源不可用 → known=false');
  assert.equal(cnt(e4.logs, /rein-state-unknown/), 1, tag + ' 必须记一条「骑乘状态读取不可用」');
  e4.clock.t = T + 10000; walking(e4); e4.ctx.tick();
  assert.equal(cnt(e4.logs, /rein-state-unknown/), 1, tag + ' 30s 内不得重复提示');
  e4.clock.t = T + 31000; walking(e4); e4.ctx.tick();
  assert.equal(cnt(e4.logs, /rein-state-unknown/), 2, tag + ' 满 30s 允许再提示一次');
  // e5 使用后 1.5s 状态未变化 → 不重复使用 + 累计失败（3 次 → 30s 退避）
  const e5 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', zWalkState: { lastMove: T - 100 } });
  e5.ctx.tick();
  assert.deepEqual(e5.uses, [12622], tag + ' 可读未骑乘 + 无锁定怪赶路 → 使用缰绳');
  e5.ctx.tick();
  assert.equal(e5.uses.length, 1, tag + ' 验证窗口内绝不再用同一道具');
  e5.clock.t = T + 1600; walking(e5); e5.ctx.tick();
  assert.equal(e5.uses.length, 1, tag + ' 状态未变化不得立刻重试');
  assert.equal(cnt(e5.logs, /rein-verify-fail/), 1, tag + ' 必须记录验证失败');
  e5.clock.t = T + 3200; walking(e5); e5.ctx.tick();
  e5.clock.t = T + 4800; walking(e5); e5.ctx.tick();
  e5.clock.t = T + 6400; walking(e5); e5.ctx.tick();
  e5.clock.t = T + 8000; walking(e5); e5.ctx.tick();
  assert.equal(e5.uses.length, 3, tag + ' 连续失败按 3 次计数（每 1.6s 一次）');
  assert.equal(cnt(e5.logs, /rein-verify-fail/), 3, tag + ' 三次验证失败都要记录');
  assert.equal(cnt(e5.logs, /rein-backoff/), 1, tag + ' 3 次失败 → 30s 退避');
  e5.clock.t = T + 12000; walking(e5); e5.ctx.tick();
  assert.equal(e5.uses.length, 3, tag + ' 退避期内不得再使用缰绳');
  // e6 使用后状态真的变化 → 验证通过、清零失败计数
  const e6 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', zWalkState: { lastMove: T - 100 } });
  e6.ctx.tick();
  assert.equal(e6.uses.length, 1);
  e6.ctx.buffActive[613] = { on: true, endAt: 2e9 };
  e6.clock.t = T + 1600; walking(e6); e6.ctx.tick();
  assert.equal(e6.uses.length, 1, tag + ' 验证通过不得再补一次');
  assert.equal(cnt(e6.logs, /rein-ok/), 1, tag + ' 验证通过必须有日志');
  // e7 追怪窗口（锁定怪在射程外且由助手追）→ 不用缰绳
  const e7 = reinVm(src, { t: T, ent: { life: { hp: 1 }, position: [0, 0] }, buffActive: { 613: { on: false, endAt: 0 } }, dshSIState: 'ok', zLock: { gid: 4321 }, zWalkState: { lastMove: T - 100 } });
  e7.ctx.tick();
  assert.deepEqual(e7.uses, [], tag + ' 有锁定怪（追怪窗口）绝不使用缰绳');
  assert.equal(cnt(e7.logs, /rein-skip-lock/), 1, tag + ' 有锁定怪必须留 rein-skip-lock 原因串');
  // e8 判据⑤：内挂自动战斗确认在跑（npBattleState()===true）→ 不用缰绳
  const e8 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', npHuntOn: true, zWalkState: { lastMove: T - 60000 } });
  e8.ctx.tick();
  assert.deepEqual(e8.uses, [], tag + ' 内挂自动战斗在跑不得上马');
  assert.equal(cnt(e8.logs, /rein-skip-npbattle/), 1, tag + ' 内挂战斗在跑必须留 rein-skip-npbattle 原因串');
  assert.equal(cnt(e8.logs, /rein-skip-lock/), 0, tag + ' 无锁定怪不得写锁定怪原因串');
  // e9 上马口径小改：内挂状态未知（npBattleState()===null）且无其它战斗迹象 → 未知不再当作战斗，允许上马
  const e9 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', npState: null, zWalkState: { lastMove: T - 60000 } });
  e9.ctx.tick();
  assert.deepEqual(e9.uses, [12622], tag + ' 内挂状态未知且无战斗迹象 → 允许使用缰绳（未知不再当作战斗）');
  assert.equal(e9.ctx.road(), true, tag + ' npBattleState()===null 时 zReinRoadMoving 必须为 true');
  // e10 G3：无锁定怪 + 内挂关闭（即使没在移动）→ 放宽口径，允许使用缰绳
  const e10 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', npState: false, zWalkState: { lastMove: T - 60000 } });
  e10.ctx.tick();
  assert.deepEqual(e10.uses, [12622], tag + ' 无锁定怪 + 内挂关闭 → 允许使用缰绳（G3 不再要求 lastMove 5s 内）');
  assert.equal(e10.ctx.road(), true, tag + ' npBattleState()===false 时 zReinRoadMoving 必须为 true');
  // e11 G3：无锁定怪 + 内挂关闭 + 正在移动赶路 → 允许使用
  const e11 = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', npState: false, zWalkState: { lastMove: T - 100 } });
  e11.ctx.tick();
  assert.deepEqual(e11.uses, [12622], tag + ' 无锁定怪 + 移动赶路 → 允许使用缰绳');
}
test('V2.38.4 实机反馈三修 E：寻怪自动上马多来源判定 / fail-closed / 使用后验证 / 追怪窗口不用缰绳（VM）', () => {
  for (const [name, src] of splitSources) reinScenarios(src, name);
  for (const [name, src] of splitSources) {
    assert.ok(src.includes('if (buffStateOn(613) || buffStateOn(27)) { riding = true; src += "buff-on;"; }'), name + ' 已骑乘必须多来源取并集（613 + 27）');
    assert.ok(src.includes('if (!known) { // 前三个来源都读不到'), name + ' 全来源不可读必须 fail-closed');
    assert.ok(src.includes('if (now - reinPendingAt < 1500) return;'), name + ' 使用后 1.5s 验证窗口必须存在');
    assert.ok(src.includes('useItemById(12622)'), name + ' 仍只使用缰绳 12622');
    assert.ok(src.includes('try { return npBattleState() === true; } catch (e) { return false; }'), name + ' 上马判据⑤：只有内挂确认在跑（true）才算战斗（未知不再当作战斗）');
    assert.ok(src.includes('zReinSkipWhy = "rein-skip-" + checks[i][0];'), name + ' 每条判据拦下都要留下可区分的 rein-skip-* 原因串');
    for (const fnName of ['zReinInCombatLock', 'zReinInCombatAtk', 'zReinInCombatHit', 'zReinInCombatAoe', 'zReinInCombatNp', 'zReinInCombatSit', 'zReinInCombatMapChg']) assert.ok(src.includes('function ' + fnName + '()'), name + ' 上马判据必须命名可审计：' + fnName);
    assert.ok(!/useItemById\((?!12622)/.test(src.slice(src.indexOf('  function tickRein() {'), src.indexOf('  masterTickReg(function () { try { tickRein(); }'))), name + ' tickRein 不得新增任何其它道具/技能');
  }
});
// ---------------- 变异测试 ----------------
function mutateChaseBackToDistanceOnly(src) {
  const s = lfSrc(src);
  let out = s.replace('        if (zWalkState.chaseSince && chaseMoved < 2) {', '        if (zWalkState.chaseSince) {');
  out = out.replace('        if (chaseMoved >= 2) { zWalkState.chaseSince = 0; zWalkState.chaseFrom = null; zWalkState.chaseReplan = false; } // ②角色确实在位移 → 不算卡住，立刻清零', '        zWalkState.chaseFrom = null;');
  out = out.replace('} else if (chaseStuckMs >= 6000) {', '} else if (chaseStuckMs >= 4000) {');
  assert.notEqual(out, s, '变异①必须命中追怪卡住判定');
  return out;
}
function mutateQoaRebuildWhenEmpty(src) {
  const s = lfSrc(src);
  const out = s.replace('      if (!skills || !skills.length) return;', '      if (!skills) skills = [];');
  assert.notEqual(out, s, '变异②必须命中「读空早退」');
  return out;
}
function mutateReinOnly613(src) {
  const s = lfSrc(src);
  const out = s.replace('if (buffStateOn(613) || buffStateOn(27)) { riding = true; src += "buff-on;"; }', 'if (buffStateOn(613)) { riding = true; src += "buff-on;"; }');
  assert.notEqual(out, s, '变异③必须命中骑乘多来源并集');
  return out;
}
function mutateQoaSaveGuard(src) {
  const s = lfSrc(src);
  const out = s.replace('            if (qUnread || (qFight && zQoaSkillCleared && (Date.now() - zQoaSkillCleared) < 60000)) continue;', '            if (false) continue;');
  assert.notEqual(out, s, '变异④必须命中解围技能存档保护');
  return out;
}
test('V2.38.4 实机反馈三修 变异测试：只看距离 4s 就瞬移 / 读空仍重建下拉 / 上马只信 613 / 删掉存档保护 → 必须被杀死', () => {
  const killed = (fn, tag) => { let m = ''; try { fn(); } catch (e) { m = String((e && e.message) || e); } assert.ok(m, tag + ' 必须被杀死（没有抛错 = 用例没覆盖）'); return m; };
  const m1 = killed(() => chaseScenarios(mutateChaseBackToDistanceOnly(source), '变异①'), '变异体①（追怪卡住退回只看距离 4s 就瞬移）');
  console.log('[V2.38.4 实机反馈三修 变异测试] ① 只看距离 4s 就瞬移被杀死：' + m1.slice(0, 110));
  const m2 = killed(() => qoaFillScenarios(mutateQoaRebuildWhenEmpty(source), '变异②'), '变异体②（读空仍重建下拉）');
  console.log('[V2.38.4 实机反馈三修 变异测试] ② 读空仍重建下拉被杀死：' + m2.slice(0, 110));
  const m3 = killed(() => reinScenarios(mutateReinOnly613(source), '变异③'), '变异体③（上马 guard 退回只信 buffStateOn(613)）');
  console.log('[V2.38.4 实机反馈三修 变异测试] ③ 只信 613 被杀死：' + m3.slice(0, 110));
  const m4 = killed(() => qoaSaveScenarios(mutateQoaSaveGuard(source), '变异④'), '变异体④（删掉解围技能存档保护）');
  console.log('[V2.38.4 实机反馈三修 变异测试] ④ 删掉存档保护被杀死：' + m4.slice(0, 110));
});

// =====================================================================================
// V2.38.4 走路行为批次：G1 尊重客户端本地路线（只扫不发 / 主动接战） / G2 来回走五条机制 / G3 混合模式上马
//   全部走「整段 zWalk」VM：真 cutLf 取 zWalk 源码、假 EntityManager / 假 Entity.walk / 假状态表 / 记录每一次 REQUEST_MOVE
// =====================================================================================
function zwVm(src, opt) {
  const o = opt || {};
  const clock = { t: o.t == null ? 1000000 : o.t };
  const moves = [], logs = [], statuses = [], flies = [], teleports = [], selfMoves = [], np = { ensure: 0, stop: 0 };
  const rec = { scans: 0 };
  const ent = o.ent || { position: [0, 0], action: 0, ACTION: { SIT: 2, DIE: 9 }, life: { hp: 100, hp_max: 100 } };
  if (o.walk) ent.walk = o.walk;
  const mobs = o.mobs || [];
  const zWalkState = Object.assign({
    lastMove: 0, lastChase: 0, dir: 0, noTargetSince: 0, lastIdleFly: 0, lastPos: null, stuckCnt: 0, stuckAt: 0, tried: 0,
    lastSeenDir: null, lastSeenAt: 0, center: null, chaseGid: null, chaseDist: 0, chaseSince: 0,
    startMap: o.startMap === undefined ? 'A' : o.startMap, lastMoveDir: 0, backMapAt: 0, backDir: 0, backTeleportAt: 0,
    hySince: 0, hyGid: 0, hyPos: null, hyTakeoverUntil: 0, hyDist: 0, hyStillSince: 0,
    chaseFrom: null, chaseReplan: false, lastLockMissLog: 0,
    lastSelfMoveAt: 0, routeExt: false, routeActive: false, routeTotal: 0, routeIdx: 0,
    seenDirCand: null, seenDirCandAt: 0, dirAt: 0,
    chaseHold: null, chaseHoldDist: null, chaseHoldProgressAt: 0,
    stuckEvent: 0, stuckDirs: null, stuckTurns: 0, stuckEscapeAt: 0,
    lastMapName: null, backDone: 0, backCooldownAt: 0, mapChgKey: '', mapChgAt: 0,
  }, o.state || {});
  const controls = {
    'dsh-z-ona': { value: o.ona || '还击' },
    'dsh-z-allmobs': { checked: !!o.allMobs },
    'dsh-z-idlefly': { checked: !!o.idleFly },
    'dsh-z-flykill': { checked: o.flykill === undefined ? true : !!o.flykill },
    'dsh-z-idleflysec': { value: String(o.idleFlySec == null ? 10 : o.idleFlySec) },
    'dsh-z-walkint': { value: String(o.walkInt == null ? 0.3 : o.walkInt) },
    'dsh-z-chaseint': { value: String(o.chaseInt == null ? 0.5 : o.chaseInt) },
    'dsh-z-flymode': { value: o.flymode || '瞬移术Lv1' },
    'dsh-z-flyauto': { checked: true },
    'dsh-z-takeover': { value: '12' },
  };
  const ctx = {
    Date: { now: () => clock.t },
    Math, String, Number, parseInt, parseFloat, isFinite, Object, Array, JSON,
    $id: (id) => controls[id] || null,
    document: { getElementById: (id) => (id === 'dsh-z-astar' ? { checked: !!o.astar } : null) },
    CLIENT: { SS: { Entity: ent }, NM: { sendPacket: (p) => { if (p && p.dest) moves.push(p.dest); } } },
    czp: (name) => function () { this.type = name; this.dest = null; },
    moveXY: { busy: false },
    pendingPick: null,
    zEscape: { until: 0 },
    zAStarState: { active: false, tx: 0, ty: 0, since: 0, lastTry: 0, stuckSince: 0, lastPos: null, aim: null },
    zWalkState: zWalkState,
    zLock: o.zLock || { gid: null, reactive: false },
    zAtkLast: o.zAtkLast || null,
    zBossSkipGid: 0,
    zHitBy: o.zHitBy || {}, zHitKeepMs: 3000,
    zHpWatch: { lastHitAt: o.lastHitAt == null ? -1e9 : o.lastHitAt, hp: 100, sp: 100, maxhp: 100 },
    lockList: o.lockList || {},
    scanMobs: mobs,
    zMon: { action: '' }, zAtkWhy: '',
    btDiagOn: false, btLog: () => {},
    clientReady: () => true,
    gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
    zRangeDist: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])),
    requireDB: (m) => (m === 'Renderer/EntityManager' ? { forEach: (cb) => { rec.scans++; mobs.forEach(cb); } } : null),
    dshAStarData: () => null,
    dshFindPath: () => null,
    mvSnapWalkable: (x, y) => [Math.round(x), Math.round(y)],
    getMapName: () => (o.map === undefined ? 'A' : o.map),
    normMapKey: (m) => String(m || '').replace(/\.(gat|rsw)$/, '').toLowerCase(),
    npHuntOn: !!o.npHuntOn,
    npHuntMode: () => (o.npHuntMode || 'z'),
    isHybrid: () => false,
    npBattleState: () => (o.npState === undefined ? (o.npHuntOn ? true : false) : o.npState),
    npEnsureHunt: () => { np.ensure++; }, npHuntStop: () => { np.stop++; },
    takeoverDist: () => 12,
    calcAtkRange: () => (o.atkRange == null ? 2 : o.atkRange),
    distInt: (d) => Math.round(d),
    scanHasAttackableLockedMob: () => false, scanHasOutOfRangeLockedMob: () => false,
    needSitNow: () => false,
    doSitCycle: () => {}, updateHpWatch: () => {},
    doFly: () => { flies.push(clock.t); return true; }, markFlyOk: () => {}, markFlyFail: () => {},
    teleportToMap: (m) => { teleports.push(m); },
    setStatus: (m, c) => statuses.push([String(m), c]),
    tlog: (m) => logs.push(String(m)),
    zMarkSelfMove: () => { zWalkState.lastSelfMoveAt = clock.t; selfMoves.push(clock.t); },
    zWalk: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(cutLf(src, '  function zWalk() {', '  function zAttack() {') + LF + ';this.run = zWalk;', ctx);
  return {
    ctx: ctx, clock: clock, ent: ent, mobs: mobs, moves: moves, logs: logs, statuses: statuses,
    flies: flies, teleports: teleports, selfMoves: selfMoves, np: np, rec: rec, state: zWalkState,
    tick: (dt) => { if (dt) clock.t += dt; ctx.run(); },
    last: () => (moves.length ? Array.from(moves[moves.length - 1]).join(',') : null),
    txt: () => logs.join(' | '),
    st: () => (statuses.length ? statuses[statuses.length - 1][0] : ''),
  };
}
function zwMob(gid, job, pos, hp) {
  return { GID: gid, _job: job, objecttype: 5, position: pos, life: { hp: hp == null ? 100 : hp }, ACTION: { DIE: 9 }, action: 0, isDeath: false, remove_tick: 0 };
}
function zwTurns(logs) {
  const out = [];
  for (const l of logs) { const m = /walk-stuck turn dir=(\d+)/.exec(l); if (m) out.push(Number(m[1])); }
  return out;
}
// ---------------- a：外部路线进行中 → 只扫不发（直走 / 换点 / 反向走全不发），扫描照常 ----------------
function zwRouteScanOnly(src, tag) {
  const T = 1000000;
  const a1 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], idleFly: true, walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 3000, noTargetSince: T - 100000, lastIdleFly: 0 } });
  a1.tick();
  assert.equal(a1.moves.length, 0, tag + ' 外部路线进行中：直走 / 贴近 / 换点一律不得发位移（czp/sendPacket 位移计数必须为 0）');
  assert.equal(a1.flies.length, 0, tag + ' 外部路线进行中：无目标瞬移换点也不得发');
  assert.ok(a1.rec.scans >= 1, tag + ' 外部路线进行中：扫描必须照常执行');
  assert.match(a1.st(), /客户端路线进行中/, tag + ' 状态栏必须写明「客户端路线进行中…仅扫描」');
  assert.match(String(a1.ctx.zMon.action), /仅扫描/, tag + ' zMon.action 必须写明只扫不发');
  assert.equal(a1.state.routeActive, true, tag + ' 必须记住正在尊重外部路线');
  const a2 = zwVm(src, { t: T, map: 'B', startMap: 'A', mobs: [], walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 3000, mapChgKey: 'B', mapChgAt: T - 2000 } });
  a2.tick();
  assert.equal(a2.moves.length, 0, tag + ' 外部路线进行中：换图反向走不得发位移');
  assert.equal(a2.teleports.length, 0, tag + ' 外部路线进行中：换图传送也不得发');
  assert.ok(a2.rec.scans >= 1, tag + ' 外部路线 + 换图：扫描仍必须执行');
  assert.ok(!a2.txt().includes('walk-mapchange'), tag + ' 外部路线进行中不得触发换图反向走');
  const a3 = zwVm(src, { t: T + 1000, map: 'A', startMap: 'A', mobs: [], walk: { total: 20, index: 20 }, state: { lastSelfMoveAt: T - 3000, routeActive: true, routeTotal: 20, routeIdx: 6 } });
  a3.tick();
  assert.ok(a3.txt().includes('walk-route-end'), tag + ' 路线结束必须记 walk-route-end');
  assert.match(a3.txt(), /自然走完/, tag + ' 走到终点必须记为「自然走完」');
  assert.equal(a3.moves.length, 1, tag + ' 路线结束后必须回到既有寻怪直走逻辑');
  const a4 = zwVm(src, { t: T + 1000, map: 'A', startMap: 'A', mobs: [], state: { lastSelfMoveAt: T - 3000, routeActive: true, routeTotal: 20, routeIdx: 6 } });
  a4.tick();
  assert.match(a4.txt(), /被中断/, tag + ' walk 消失必须记为「被中断/消失」');
  assert.equal(a4.moves.length, 1, tag + ' 路线中断后必须回到既有寻怪逻辑');
}
test('V2.38.4 走路批次 a：外部客户端路线进行中 → 只扫不发（直走/换点/贴近/反向走计数 0）+ 结束后记自然走完/被中断（VM）', () => {
  for (const [name, src] of splitSources) zwRouteScanOnly(src, name);
});
// ---------------- b：路线进行中扫到名单内怪 → 主动接战（先 resetRoute + walk-route-engage） ----------------
function zwRouteEngage(src, tag) {
  const T = 1000000;
  const h1 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [zwMob(1, '1002', [5, 0])], lockList: { '1002': { name: 'Poring' } }, allMobs: false, walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 3000 }, atkRange: 2 });
  let resetCalls = 0;
  h1.ent.resetRoute = () => { resetCalls++; h1.ent.walk = null; };
  h1.tick();
  assert.equal(resetCalls, 1, tag + ' 路线中扫到目标必须先显式取消本地路线（Entity.resetRoute）');
  assert.ok(h1.moves.length >= 1, tag + ' 主动接战必须走既有链路发出追击位移');
  assert.match(h1.txt(), /walk-route-engage/, tag + ' 主动接战必须记 walk-route-engage（可与被动被打断区分）');
  assert.match(h1.txt(), /walk-追怪 1002/, tag + ' 接战入口必须复用现有追怪链路（锁定名单内那只）');
  assert.equal(h1.state.routeActive, false, tag + ' 主动接战后不再处于「只扫不发」');
  const h2 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [zwMob(1, '1002', [5, 0])], lockList: { '1002': {} }, walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 3000 }, atkRange: 2 });
  h2.tick();
  assert.match(h2.txt(), /walk-route-engage/, tag + ' resetRoute 缺失时仍必须主动接战');
  assert.match(h2.txt(), /取消本地路线\(none\)/, tag + ' resetRoute 缺失必须在日志里写明 none');
  assert.ok(h2.moves.length >= 1, tag + ' resetRoute 缺失也必须发出追击位移');
  const h3 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [zwMob(1, '9999', [5, 0])], lockList: { '1002': {} }, allMobs: false, walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 3000 } });
  h3.tick();
  assert.equal(h3.moves.length, 0, tag + ' 名单外的怪不得触发接战（不得发位移）');
  assert.ok(!h3.txt().includes('walk-route-engage'), tag + ' 名单外的怪不得记 walk-route-engage');
  assert.match(h3.st(), /客户端路线进行中/, tag + ' 名单外的怪仍然只扫不发');
}
test('V2.38.4 走路批次 b：外部路线中扫到名单内怪 → resetRoute + walk-route-engage + 复用追怪链路；名单外绝不接战（VM）', () => {
  for (const [name, src] of splitSources) zwRouteEngage(src, name);
});
// ---------------- c：助手自己刚发过位移（<1500ms）不算外部路线 ----------------
function zwSelfMoveNotExternal(src, tag) {
  const T = 1000000;
  const h = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], walk: { total: 20, index: 6 }, state: { lastSelfMoveAt: T - 500 } });
  h.tick();
  assert.equal(h.moves.length, 1, tag + ' 自己 500ms 前刚发过位移 → 不得算外部路线，必须正常走');
  assert.ok(!/客户端路线进行中/.test(String(h.st())), tag + ' 自己刚移动过不得显示客户端路线进行中');
  assert.equal(h.state.lastSelfMoveAt, T, tag + ' 助手自己发位移必须打时间戳');
  h.tick(2000);
  assert.equal(h.moves.length, 1, tag + ' 超过 1500ms 且客户端仍有路线 → 转为外部路线，只扫不发');
  assert.match(h.st(), /客户端路线进行中/, tag + ' 超时后必须识别为外部路线');
}
test('V2.38.4 走路批次 c：助手自己刚发过位移（<1500ms）不得被判成外部路线；超时后才只扫不发（VM）', () => {
  for (const [name, src] of splitSources) zwSelfMoveNotExternal(src, name);
});
// ---------------- d：方向滞回（1.5s 候选稳定 + 3s 直走方向最小保持） ----------------
function zwDirHysteresis(src, tag) {
  const T = 1000000;
  const east = () => zwMob(1, '1002', [5, 0]);
  const west = () => zwMob(2, '1003', [-5, 0]);
  const lockList = { '1002': {}, '1003': {} };
  const h1 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [east()], lockList: lockList, chaseInt: 99999, walk: { total: 0, index: 0 } });
  h1.tick();
  assert.equal(h1.state.lastSeenDir, 0, tag + ' 首次扫到东侧怪 → 方向记忆=东(0)');
  for (const m of [west(), east(), west()]) { h1.mobs.length = 0; h1.mobs.push(m); h1.tick(500); }
  h1.mobs.length = 0;
  h1.tick(500);
  assert.equal(h1.state.lastSeenDir, 0, tag + ' 两方向每拍交替时方向记忆必须保持东(0)（不得每拍翻转）');
  assert.equal(h1.last(), '12,0', tag + ' 交替背景后无怪直走必须仍朝东（发包目标方向稳定）');
  const h2 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [east()], lockList: lockList, chaseInt: 99999, walk: { total: 0, index: 0 } });
  h2.tick();
  assert.equal(h2.state.lastSeenDir, 0, tag + ' d2 起点：方向记忆=东(0)');
  for (let i = 0; i < 5; i++) { h2.mobs.length = 0; h2.mobs.push(west()); h2.tick(500); }
  assert.equal(h2.state.lastSeenDir, 4, tag + ' 单侧候选持续 ≥1.5s → 必须允许改写方向记忆=西(4)');
  h2.mobs.length = 0;
  const before2 = h2.moves.length;
  h2.tick(500);
  assert.equal(h2.moves.length, before2 + 1, tag + ' d2 必须发出一拍无怪直走');
  assert.equal(h2.last(), '-12,0', tag + ' 切换后无怪直走必须朝西(4)');
  const h3 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [east()], lockList: lockList, chaseInt: 99999, walk: { total: 0, index: 0 } });
  h3.tick();
  h3.mobs.length = 0;
  h3.tick(500);
  assert.equal(h3.state.dirAt, T + 500, tag + ' d3 起点：直走方向保持起点已建立');
  assert.equal(h3.last(), '12,0', tag + ' d3 起点：无怪直走朝东');
  for (let i = 0; i < 4; i++) { h3.mobs.length = 0; h3.mobs.push(west()); h3.tick(500); }
  assert.equal(h3.state.lastSeenDir, 4, tag + ' d3 候选西侧已连续 ≥1.5s → 方向记忆已切西');
  assert.equal(h3.state.dir, 0, tag + ' 直走方向最小保持 ≥3s：候选刚稳定（距保持起点仅 2s）不得立刻翻转');
  h3.mobs.length = 0;
  h3.tick(500);
  assert.equal(h3.last(), '12,0', tag + ' 3s 未满时无怪直走必须仍朝东');
  h3.tick(500);
  assert.equal(h3.state.dir, 4, tag + ' 满 3s 后必须允许方向记忆接管（朝西）');
  assert.equal(h3.last(), '-12,0', tag + ' 满 3s 后无怪直走必须朝西');
}
test('V2.38.4 走路批次 d：方向记忆滞回（候选连续 1.5s 才切换）+ 直走方向最小保持 3s（VM）', () => {
  for (const [name, src] of splitSources) zwDirHysteresis(src, name);
});
// ---------------- e：追怪目标保持（chaseHold） ----------------
function zwChaseHold(src, tag) {
  const T = 1000000;
  const A = zwMob(11, '1002', [10, 0], 100);
  const B = zwMob(12, '1003', [0, 10], 50);
  const h = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [A, B], lockList: { '1002': {}, '1003': {} }, chaseInt: 0.5, atkRange: 2 });
  h.tick();
  assert.equal(h.state.chaseHold && h.state.chaseHold.gid, 12, tag + ' 进入追怪必须记录 chaseHold={gid,at}（首拍选血少的 1003）');
  assert.match(h.txt(), /walk-追怪 1003/, tag + ' 首拍追 1003');
  A.life.hp = 10;
  h.tick(1000);
  assert.equal(h.state.chaseHold.gid, 12, tag + ' chaseHold 必须保持同一 GID（不得按血少每拍换目标）');
  assert.match(h.txt(), /walk-追怪 1003/, tag + ' 第二拍追击目标必须仍是 1003');
  assert.ok(!/walk-追怪 1002/.test(h.txt()), tag + ' 不得换到 1002');
  h.mobs.length = 0; h.mobs.push(A);
  h.tick(1000);
  assert.equal(h.state.chaseHold.gid, 11, tag + ' 保持目标消失后必须允许换目标');
  assert.match(h.txt(), /walk-chase-switch/, tag + ' 换目标必须记 tlog');
  assert.match(h.txt(), /walk-追怪 1002/, tag + ' 换目标后追击新目标 1002');
  const C = zwMob(13, '1004', [30, 0], 500);
  const h2 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [C], lockList: { '1004': {} }, chaseInt: 99999, atkRange: 2 });
  h2.tick();
  for (let i = 0; i < 9; i++) h2.tick(1000);
  assert.match(h2.txt(), /walk-chase-hold-timeout/, tag + ' 8s 内既没靠近也没在打必须记保持超时');
}
test('V2.38.4 走路批次 e：追怪目标保持 chaseHold（同一 GID 稳定 / 消失才换并记日志 / 8s 无进展超时）（VM）', () => {
  for (const [name, src] of splitSources) zwChaseHold(src, name);
});
// ---------------- f：卡住转向（禁止转回刚试过的方向 / 4 次后走既定脱困链路） ----------------
function zwStuck(src, tag) {
  const T = 1000000;
  const h = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], idleFly: true, idleFlySec: 9999 });
  for (let i = 0; i < 24; i++) h.tick(500);
  const dirs = zwTurns(h.logs);
  assert.ok(dirs.length >= 4, tag + ' 墙角循环必须触发至少 4 次转向（实际 ' + dirs.length + '）');
  assert.deepEqual(dirs.slice(0, 4), [1, 2, 3, 4], tag + ' 卡住转向不得转回刚试过的方向（实际 ' + JSON.stringify(dirs) + '）');
  assert.equal(h.flies.length, 1, tag + ' 同一卡住事件累计转向 4 次仍无位移 → 必须走既有「瞬移换点」链路');
  assert.match(h.txt(), /walk-stuck-escape/, tag + ' 脱困必须记 walk-stuck-escape');
  assert.ok(h.flies[0] >= T + 2000, tag + ' 脱困瞬移必须发生在卡住事件内（实际 ' + h.flies[0] + '）');
  const h2 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], idleFly: false,
    state: { lastPos: [0, 0], stuckAt: T - 3000, stuckEvent: 1, stuckDirs: [0, 1], stuckTurns: 1, dir: 0, dirAt: T - 3000 } });
  h2.tick();
  assert.deepEqual(zwTurns(h2.logs), [2], tag + ' 已试过 0/1 后必须跳到未试过的 2（不得转回刚试过的方向），实际 ' + JSON.stringify(zwTurns(h2.logs)));
  const h3 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], idleFly: false, idleFlySec: 9999 });
  for (let i = 0; i < 24; i++) h3.tick(500);
  assert.equal(h3.flies.length, 0, tag + ' 瞬移开关关 → 不得瞬移');
  assert.match(h3.txt(), /walk-stuck-reverse/, tag + ' 瞬移不可用时必须走反向走脱困');
}
test('V2.38.4 走路批次 f：卡住转向禁止转回刚试过的方向 + 4 次后走既有脱困链路（含 15s 节流）（VM）', () => {
  for (const [name, src] of splitSources) zwStuck(src, name);
});
// ---------------- g：换图反向走（一次换图只反向一次 + 10s 冷却 + 图名未变不触发） ----------------
function zwMapChange(src, tag) {
  const T = 1000000;
  const h = zwVm(src, { t: T, map: 'B', startMap: 'A', mobs: [] });
  h.tick();
  assert.equal(h.moves.length, 0, tag + ' 图名刚变（未满 1.2s 稳定期）不得反向走');
  h.tick(1500);
  assert.equal(h.moves.length, 1, tag + ' 稳定后必须反向走一次');
  assert.equal(h.last(), '-10,0', tag + ' 反向走 = lastMoveDir+4（0→4 西）10 格');
  assert.equal(h.state.backDone, 1, tag + ' 必须标记「本次换图已反向走过」');
  h.tick(500); h.tick(500); h.tick(500);
  assert.equal(h.moves.length, 1, tag + ' 同一次换图只反向走一次（后续拍不得重发位移）');
  h.tick(8000);
  assert.equal(h.moves.length, 1, tag + ' 同一次换图只反向走一次（不得周期重发截断客户端路线）');
  assert.deepEqual(h.teleports, ['A'], tag + ' 反向走未回图 8s → 仍必须传送回启动图');
  const h2 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [] });
  h2.tick();
  const revN = () => h2.moves.filter((d) => Math.abs(d[0]) === 10 || Math.abs(d[1]) === 10).length; // 反向走=10 格；直走=12 格
  h2.ctx.getMapName = () => 'B';
  h2.tick(500);
  h2.tick(1500);
  assert.equal(revN(), 1, tag + ' g2 首次换图反向走一次');
  h2.ctx.getMapName = () => 'A';
  h2.tick(500);
  h2.ctx.getMapName = () => 'B';
  h2.tick(500);
  h2.tick(1500);
  assert.equal(revN(), 1, tag + ' 10s 冷却内再次换图不得重复反向走');
  assert.match(h2.txt(), /冷却中/, tag + ' 冷却跳过必须留有日志');
  h2.ctx.getMapName = () => 'A';
  h2.tick(500);
  for (let i = 0; i < 12; i++) { h2.ctx.getMapName = () => 'A'; h2.tick(500); }
  h2.ctx.getMapName = () => 'B';
  h2.tick(500);
  h2.tick(1500);
  assert.equal(revN(), 2, tag + ' 冷却期满后再次换图必须允许再反向走一次');
  const h3 = zwVm(src, { t: T, map: 'A', startMap: 'A', mobs: [], state: { lastMapName: 'A' } });
  for (let i = 0; i < 4; i++) h3.tick(1000);
  assert.ok(!h3.txt().includes('walk-mapchange'), tag + ' 图名与启动图相同（实际未变）不得触发换图反向走');
}
test('V2.38.4 走路批次 g：换图反向走——同一次换图只反向一次 + 10s 冷却 + 图名未变不触发（VM）', () => {
  for (const [name, src] of splitSources) zwMapChange(src, name);
});
// ---------------- h：混合 / 内挂模式自动上马口径（G3） ----------------
function zwReinG3(src, tag) {
  const T = 1000000;
  const road = { ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok' };
  const h1 = reinVm(src, Object.assign({ t: T, npState: false, zLock: { gid: 4321 }, zWalkState: { lastMove: T - 60000 } }, road));
  h1.ctx.tick();
  assert.deepEqual(h1.uses, [], tag + ' 有锁定怪 → 不用缰绳');
  assert.equal(h1.ctx.skipWhy(), 'rein-skip-lock', tag + ' 有锁定怪必须记 rein-skip-lock');
  const h2 = reinVm(src, Object.assign({ t: T, npHuntOn: true, zWalkState: { lastMove: T - 60000 } }, road));
  h2.ctx.tick();
  assert.deepEqual(h2.uses, [], tag + ' 内挂战斗确认在跑（true） → 不用缰绳');
  assert.equal(h2.ctx.skipWhy(), 'rein-skip-npbattle', tag + ' 内挂 true 必须记 rein-skip-npbattle');
  const h3 = reinVm(src, Object.assign({ t: T, npState: false, zWalkState: { lastMove: T - 60000 } }, road));
  h3.ctx.tick();
  assert.deepEqual(h3.uses, [12622], tag + ' 内挂确认没跑（false）+ 无锁定怪 → 允许使用缰绳（内挂单纯寻路/混合赶路）');
  const h4 = reinVm(src, Object.assign({ t: T, npState: null, zWalkState: { lastMove: T - 60000 } }, road));
  h4.ctx.tick();
  assert.deepEqual(h4.uses, [12622], tag + ' 内挂状态未知（null）且无其它战斗迹象 → 允许使用缰绳（未知不再当作战斗）');
  assert.equal(h4.ctx.road(), true, tag + ' npBattleState()===null 时 zReinRoadMoving 必须为 true');
  assert.equal(h3.ctx.road(), true, tag + ' npBattleState()===false 时 zReinRoadMoving 必须为 true');
}
test('V2.38.4 走路批次 h：上马口径小改（非战斗即允许：有锁定怪/内挂确认在跑 → 不用；内挂 false/null 且无战斗迹象 → 允许）（VM）', () => {
  for (const [name, src] of splitSources) zwReinG3(src, name);
  for (const [name, src] of splitSources) {
    assert.ok(src.includes('try { return npBattleState() === true; } catch (e) { return false; }'), name + ' 上马判据⑤必须只把 npBattleState()===true 当战斗');
    assert.ok(src.includes('if (hit) { zReinSkipWhy = "rein-skip-" + checks[i][0]; return false; }'), name + ' 判据逐条拦下并记录 rein-skip-* 原因串');
    assert.ok(!/var npB = npBattleState\(\);/.test(src), name + ' 旧的「npB !== false 才放行」口径必须撤掉（未知不再当作战斗）');
    assert.ok(!/var lm = zWalkState\.lastMove \|\| 0;/.test(src), name + ' 必须撤掉 lastMove 5s 门槛');
  }
});
// ---------------- 变异测试 ----------------
function zwMutRouteGate(src) { return src.replace('var zRouteExtNow = !!zWalkState.routeExt;', 'var zRouteExtNow = false;'); }
function zwMutDirFlip(src) { return src.replace('var seenCandStable = (now - (zWalkState.seenDirCandAt || now)) >= 1500;', 'var seenCandStable = true;'); }
function zwMutChaseReselect(src) { return src.replace('if (heldNear && (zReactiveGid === 0 || gidInt(heldNear.GID) === zReactiveGid)) { near = heldNear; nearD = heldNearD; nearHp = heldNearHp; }', 'if (false) { near = heldNear; nearD = heldNearD; nearHp = heldNearHp; }'); }
function zwMutNpUnknown(src) { return src.replace('try { return npBattleState() === true; } catch (e) { return false; }', 'try { return false; } catch (e) { return false; }'); }
function zwMutMapRepeat(src) { return src.replace('var zNewMapChg = (zWalkState.lastMapName == null) || (zWalkState.lastMapName !== curKeyB);', 'var zNewMapChg = true;').replace('if (zWalkState.backDone || (zWalkState.backCooldownAt && nowB - zWalkState.backCooldownAt < 10000)) {', 'if (false) {'); }
function zwMutStuckCycle(src) { return src.replace('if (zWalkState.stuckDirs.indexOf(zCandDir) < 0) { zNewDir = zCandDir; break; }', 'if (true) { zNewDir = zCandDir; break; }'); }
test('V2.38.4 走路批次 变异测试：外部路线仍发位移 / 方向记忆退回每拍翻转 / 追怪候选退回每拍血少重选 / 内挂在跑仍上马 / 换图每拍重发 / 卡住转回已试方向 → 必须被杀死', () => {
  const killed = (fn, tag) => { let m = ''; try { fn(); } catch (e) { m = String((e && e.message) || e); } assert.ok(m, tag + ' 必须被杀死（没有抛错 = 用例没覆盖）'); return m; };
  const m1 = killed(() => zwRouteScanOnly(zwMutRouteGate(source), '变异①'), '变异体①（外部路线期间仍发直走位移）');
  console.log('[V2.38.4 走路批次 变异测试] ① 外部路线仍发位移被杀死：' + m1.slice(0, 120));
  const m2 = killed(() => zwDirHysteresis(zwMutDirFlip(source), '变异②'), '变异体②（方向记忆退回每拍翻转）');
  console.log('[V2.38.4 走路批次 变异测试] ② 方向记忆每拍翻转被杀死：' + m2.slice(0, 120));
  const m3 = killed(() => zwChaseHold(zwMutChaseReselect(source), '变异③'), '变异体③（追怪候选退回每拍按血少重选）');
  console.log('[V2.38.4 走路批次 变异测试] ③ 追怪候选每拍重选被杀死：' + m3.slice(0, 120));
  const m4 = killed(() => zwReinG3(zwMutNpUnknown(source), '变异④'), '变异体④（内挂确认在跑时仍上马：判据⑤失效）');
  console.log('[V2.38.4 走路批次 变异测试] ④ 内挂确认在跑仍上马被杀死：' + m4.slice(0, 120));
  const m5 = killed(() => zwMapChange(zwMutMapRepeat(source), '变异⑤'), '变异体⑤（换图每拍重发反向走）');
  console.log('[V2.38.4 走路批次 变异测试] ⑤ 换图每拍重发被杀死：' + m5.slice(0, 120));
  const m6 = killed(() => zwStuck(zwMutStuckCycle(source), '变异⑥'), '变异体⑥（卡住转向转回已试方向）');
  console.log('[V2.38.4 走路批次 变异测试] ⑥ 卡住转回已试方向被杀死：' + m6.slice(0, 120));
});

// =====================================================================================
// V2.38.4+ 上马口径小改：非战斗即允许（用户口径：「建议只要非战斗都能触发自动上马」）
//   判据①-⑦逐条独立 try/catch + 命名函数；未知（npBattleState()===null）不再当作战斗
// =====================================================================================
function reinGateScenarios(src, tag) {
  const T = 1000000;
  const base = { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'ok', npState: false };
  const on = (extra) => Object.assign({}, base, extra || {});
  const allow = (h, msg) => { assert.deepEqual(h.uses, [12622], tag + ' ' + msg + ' → 允许使用缰绳'); };
  const block = (h, why, msg) => { assert.deepEqual(h.uses, [], tag + ' ' + msg + ' → 不用缰绳'); assert.equal(h.ctx.skipWhy(), 'rein-skip-' + why, tag + ' ' + msg + ' → 原因串必须是 rein-skip-' + why); };
  // a 有锁定怪 → 不用
  const a = reinVm(src, on({ zLock: { gid: 4321 } }));
  a.ctx.tick(); block(a, 'lock', 'a 有锁定怪');
  // b 平A窗口内（zAtkLast 仍锁定且未出射程）→ 不用
  const b = reinVm(src, on({ zAtkLast: { gid: 4321, at: T - 200, outOfRange: false } }));
  b.ctx.tick(); block(b, 'atk', 'b 平A锁定/攻击窗口内');
  // b2 平A标记在但目标已出射程（追怪中）：该判据不成立，且无锁定怪 → 允许
  const b2 = reinVm(src, on({ zAtkLast: { gid: 4321, at: T - 200, outOfRange: true } }));
  b2.ctx.tick(); allow(b2, 'b2 平A标记已出射程且无锁定怪');
  // c 最近 3 秒受击 + 设置=还击/瞬移 → 不用；设置为「无视」或已过 3 秒 → 允许
  const c1 = reinVm(src, on({ lastHitAt: T - 1000 }));
  c1.ctx.tick(); block(c1, 'hit', 'c 受击且设置为还击');
  const c2 = reinVm(src, on({ lastHitAt: T - 1000, ona: '瞬移' }));
  c2.ctx.tick(); block(c2, 'hit', 'c 受击且设置为瞬移');
  const c3 = reinVm(src, on({ lastHitAt: T - 1000, ona: '无视' }));
  c3.ctx.tick(); allow(c3, 'c3 受击但设置为无视');
  const c4 = reinVm(src, on({ lastHitAt: T - 3001 }));
  c4.ctx.tick(); allow(c4, 'c4 受击已超过 3 秒');
  // d 群殴瞬移 / 解围技能正在触发 → 不用；触发已过 1.5s → 允许
  const d1 = reinVm(src, on({ escapePending: true }));
  d1.ctx.tick(); block(d1, 'aoe', 'd 群殴瞬移正在飞（escapePending）');
  const d2 = reinVm(src, on({}));
  d2.ctx.setAoeAt(T - 500); d2.ctx.tick(); block(d2, 'aoe', 'd 解围技能刚触发（1.5s 内）');
  const d3 = reinVm(src, on({ flyAt: T - 500, flyReason: '群殴(6只)' }));
  d3.ctx.tick(); block(d3, 'aoe', 'd 刚发起群殴瞬移（1.5s 内）');
  const d4 = reinVm(src, on({ flyAt: T - 2000, flyReason: '群殴(6只)' }));
  d4.ctx.tick(); allow(d4, 'd4 群殴瞬移已超过 1.5s');
  // e 内挂战斗中（true）→ 不用
  const e = reinVm(src, on({ npState: true }));
  e.ctx.tick(); block(e, 'npbattle', 'e 内挂战斗确认在跑');
  // f 内挂 false（单纯寻路/混合赶路）→ 允许
  const f = reinVm(src, on({ npState: false, zWalkState: { lastMove: T - 60000 } }));
  f.ctx.tick(); allow(f, 'f npBattleState()===false');
  // g 内挂 null 且无其它战斗迹象 → 允许（未知不再当作战斗）
  const g = reinVm(src, on({ npState: null }));
  g.ctx.tick(); allow(g, 'g npBattleState()===null 且无战斗迹象');
  // h 坐着 / 需要坐下 → 不用
  const h1 = reinVm(src, on({ sitting: true }));
  h1.ctx.tick(); block(h1, 'sit', 'h 正在坐下');
  const h2 = reinVm(src, on({ needSit: true }));
  h2.ctx.tick(); block(h2, 'sit', 'h 需要坐下（回血回蓝）');
  // i 换图 / 瞬移瞬间 → 不用；超过 3 秒 → 允许
  const i1 = reinVm(src, on({}));
  i1.ctx.setMapAt(T - 500); i1.ctx.tick(); block(i1, 'mapchg', 'i 换图瞬间（3s 内）');
  const i2 = reinVm(src, on({ lastFly: T - 500 }));
  i2.ctx.tick(); block(i2, 'mapchg', 'i 瞬移瞬间（3s 内）');
  const i3 = reinVm(src, on({}));
  i3.ctx.setMapAt(T - 3100); i3.ctx.tick(); allow(i3, 'i3 换图已超过 3 秒');
  // j 完全空闲/站着不动、无任何战斗迹象 → 允许（用户口径核心）
  const j = reinVm(src, on({ zWalkState: { lastMove: T - 600000 } }));
  j.ctx.tick(); allow(j, 'j 站着不动、无战斗迹象');
  assert.equal(j.ctx.road(), true, tag + ' j 站着不动 zReinRoadMoving 必须为 true');
  // k 无锁定怪直走 → 允许
  const k = reinVm(src, on({ zWalkState: { lastMove: T - 100 } }));
  k.ctx.tick(); allow(k, 'k 无锁定怪直走');
  // l 旧保护回归：1.5s 验证窗口 / 3 次失败退避 / 全来源不可读 fail-closed
  const l = reinVm(src, on({}));
  l.ctx.tick(); assert.deepEqual(l.uses, [12622], tag + ' l 空闲 → 使用缰绳');
  l.ctx.tick(); assert.equal(l.uses.length, 1, tag + ' l 1.5s 验证窗口内绝不重复使用同一道具');
  l.clock.t = T + 1600; l.ctx.tick(); assert.equal(l.uses.length, 1, tag + ' l 状态未变化不得立刻重试');
  assert.equal(l.logs.filter((m) => /rein-verify-fail/.test(m)).length, 1, tag + ' l 验证失败必须记录');
  l.clock.t = T + 3200; l.ctx.tick();
  l.clock.t = T + 4800; l.ctx.tick();
  l.clock.t = T + 6400; l.ctx.tick();
  l.clock.t = T + 8000; l.ctx.tick();
  assert.equal(l.uses.length, 3, tag + ' l 连续 3 次验证失败后停止使用');
  assert.equal(l.logs.filter((m) => /rein-backoff/.test(m)).length, 1, tag + ' l 3 次失败 → 30s 退避');
  l.clock.t = T + 12000; l.ctx.tick(); assert.equal(l.uses.length, 3, tag + ' l 退避期内不得再使用缰绳');
  const lu = reinVm(src, { t: T, ent: { life: { hp: 1 } }, buffActive: {}, dshSIState: 'no-mod', npState: null });
  lu.ctx.tick();
  assert.deepEqual(lu.uses, [], tag + ' l 骑乘状态全来源不可读 → fail-closed 不上马（与「内挂未知」是两件事）');
  assert.equal(lu.logs.filter((m) => /rein-state-unknown/.test(m)).length, 1, tag + ' l 全来源不可读必须有 30s 节流提示');
}
test('V2.38.4+ i：自动上马口径小改——非战斗即允许（锁定怪/平A/受击还击瞬移/群殴解围/内挂 true/坐下/换图瞬移 → 不用；空闲/直走/内挂 false·null → 允许）+ 旧保护回归（VM）', () => {
  for (const [name, src] of splitSources) reinGateScenarios(src, name);
  for (const [name, src] of splitSources) {
    assert.ok(src.includes('return true; // 用户口径：非战斗即允许'), name + ' 非战斗必须默认放行');
    assert.ok(!/if \(npB !== false\) return false;/.test(src), name + ' 旧的「未知即战斗」口径必须撤掉');
    for (const fnName of ['zReinInCombatLock', 'zReinInCombatAtk', 'zReinInCombatHit', 'zReinInCombatAoe', 'zReinInCombatNp', 'zReinInCombatSit', 'zReinInCombatMapChg']) assert.ok(src.includes('function ' + fnName + '()'), name + ' 判据必须命名可审计：' + fnName);
    for (const why of ['lock', 'atk', 'hit', 'aoe', 'npbattle', 'sit', 'mapchg']) assert.ok(src.includes('"' + why + '", zReinInCombat'), name + ' 原因串必须逐条可区分：rein-skip-' + why);
    assert.ok(src.includes('useItemById(12622)'), name + ' 仍只使用缰绳 12622');
    const tick = src.slice(src.indexOf('  function tickRein() {'), src.indexOf('  masterTickReg(function () { try { tickRein(); }'));
    assert.ok(!/useItemById\((?!12622)/.test(tick), name + ' tickRein 不得新增任何其它道具/技能');
  }
});
// ---------------- 变异测试：上马判据逐条失效必须被杀死 ----------------
function mutRein(src, old, neu) { const s = lfSrc(src); const out = s.replace(old, neu); assert.notEqual(out, s, '变异体必须命中：' + old.slice(0, 60)); return out; }
function mutReinSkipNp(src) { return mutRein(src, 'try { return npBattleState() === true; } catch (e) { return false; }', 'try { return false; } catch (e) { return false; }'); }
function mutReinSkipSit(src) { return mutRein(src, 'if (typeof isSitting === "function" && isSitting()) return true;', ''); }
function mutReinSkipHit(src) { return mutRein(src, 'if (Date.now() - zHpWatch.lastHitAt >= 3000) return false;', 'return false;'); }
function mutReinSkipLock(src) { return mutRein(src, 'try { return !!(zLock && zLock.gid); } catch (e) { return false; }', 'try { return false; } catch (e) { return false; }'); }
function mutReinSkipAtk(src) { return mutRein(src, 'try { return !!(zAtkLast && zAtkLast.gid && !zAtkLast.outOfRange); } catch (e) { return false; }', 'try { return false; } catch (e) { return false; }'); }
function mutReinSkipAoe(src) { return mutRein(src, 'if (typeof escapePending === "function" && escapePending()) return true;', ''); }
function mutReinSkipMapChg(src) { return mutRein(src, 'if (zReinMapAt && nowM - zReinMapAt < 3000) return true;', ''); }
function mutReinFailOpen(src) { return mutRein(src, '      if (!mnt.known) {\n        reinFailStreak = 0;', '      if (false) {\n        reinFailStreak = 0;'); }
test('V2.38.4+ 上马判据变异测试：内挂 true 仍上马 / 坐着仍上马 / 受击还击窗口仍上马 / 有锁定怪仍上马 / 平A窗口仍上马 / 群殴解围触发中仍上马 / 换图瞬移瞬间仍上马 / 骑乘状态全不可读仍使用 → 必须被杀死', () => {
  const killed = (fn, tag) => { let m = ''; try { fn(); } catch (e) { m = String((e && e.message) || e); } assert.ok(m, tag + ' 必须被杀死（没有抛错 = 用例没覆盖）'); return m; };
  const cases = [
    ['① 内挂确认在跑（true）仍上马（判据⑤失效）', mutReinSkipNp],
    ['② 坐着仍上马（判据⑥失效）', mutReinSkipSit],
    ['③ 受击还击/瞬移窗口仍上马（判据③失效）', mutReinSkipHit],
    ['④ 有锁定怪仍上马（判据①失效）', mutReinSkipLock],
    ['⑤ 平A窗口内仍上马（判据②失效）', mutReinSkipAtk],
    ['⑥ 群殴瞬移/解围触发中仍上马（判据④失效）', mutReinSkipAoe],
    ['⑦ 换图/瞬移瞬间仍上马（判据⑦失效）', mutReinSkipMapChg],
    ['⑧ 骑乘状态全不可读仍使用（fail-closed 被破坏）', mutReinFailOpen],
  ];
  for (const [label, mut] of cases) {
    const m = killed(() => reinGateScenarios(mut(source), '变异' + label), '变异体（' + label + '）');
    console.log('[V2.38.4+ 上马判据 变异测试] ' + label + ' 被杀死：' + m.slice(0, 120));
  }
});

// ================= V2.38.5：客户端「物品说明」窗口里的「加入/移出丢弃名单」按钮 =================
function bagActExtractFrom(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'bagActExtract 失败: ' + start);
  return src.slice(a, b);
}
function bagActCode(src) {
  return bagActExtractFrom(src, '  function bagCleanInt(v,min,max){', '  function bagCleanRuleKey(k){')
    + bagActExtractFrom(src, '  function bagCleanKeyOfItem(item){', '  // V2.38.2：自动丢弃从物品页拆成独立浮窗')
    + bagActExtractFrom(src, '  function bagActInfoComp() {', '  function itipMouseOut(e) {')
    + bagActExtractFrom(src, '  function itipMouseOut(e) {', '  // ---- 商店单价解析 ----');
}
function bagActCheck(name, fn) { try { fn(); } catch (e) { e.message = '[' + name + '] ' + e.message; throw e; } }
// 最小 DOM：宿主 div + open shadowRoot + .ItemInfo 内容根，够跑真实注入/同步/点击链路
function bagActWorld(src, opt) {
  opt = opt || {};
  function match(el, sel) {
    if (!el || !sel) return false;
    const at = el.__attrs || {};
    if (sel[0] === '#') return at.id === sel.slice(1);
    if (sel[0] === '.') { const cn = ' ' + String(at.class || '') + ' '; return cn.indexOf(' ' + sel.slice(1) + ' ') >= 0; }
    if (sel[0] === '[') { const m = /^\[([^\]=]+)\]$/.exec(sel); return !!m && Object.prototype.hasOwnProperty.call(at, m[1]); }
    return false;
  }
  function all(root, sel) { const out = []; (function walk(n) { for (const k of n.__kids) { if (match(k, sel)) out.push(k); walk(k); } })(root); return out; }
  function mk(tag, attrs) {
    return {
      tagName: String(tag || 'div').toUpperCase(), parentNode: null, shadowRoot: null,
      style: {}, textContent: '', __kids: [], __attrs: Object.assign({}, attrs || {}), __listeners: {},
      addEventListener(t, fn) { (this.__listeners[t] || (this.__listeners[t] = [])).push(fn); },
      removeEventListener(t, fn) { const a = this.__listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      dispatchEvent(ev) { const a = (this.__listeners[ev && ev.type] || []).slice(); for (const fn of a) fn(ev); return true; },
      appendChild(c) { c.parentNode = this; this.__kids.push(c); return c; },
      removeChild(c) { const i = this.__kids.indexOf(c); if (i >= 0) this.__kids.splice(i, 1); c.parentNode = null; return c; },
      setAttribute(n, v) { this.__attrs[n] = String(v); },
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.__attrs, n) ? this.__attrs[n] : null; },
      closest(sel) { let n = this; while (n) { if (match(n, sel)) return n; n = n.parentNode; } return null; },
      querySelector(sel) { return all(this, sel)[0] || null; },
      querySelectorAll(sel) { return all(this, sel); },
    };
  }
  const body = mk('body');
  const host = mk('div', { id: 'ItemInfo' });
  const shadow = mk('shadow'); shadow.parentNode = host; host.shadowRoot = shadow; // 模拟 ShadowRoot.host
  const root = mk('div', { class: 'ItemInfo' }); shadow.appendChild(root);
  const attached = el => { let n = el; while (n) { if (n === body) return true; n = n.parentNode; } return false; };
  const documentMock = { body, createElement: t => mk(t), getElementById: id => (id === 'ItemInfo' && attached(host) ? host : null) };
  const invHost = mk('div', { id: 'InventoryV3' });
  const invShadow = mk('shadow'); invShadow.parentNode = invHost; invHost.shadowRoot = invShadow;
  const invContent = mk('div', { class: 'content' }); invShadow.appendChild(invContent);
  const eqHost = mk('div', { id: 'Equipment' });
  const eqShadow = mk('shadow'); eqShadow.parentNode = eqHost; eqHost.shadowRoot = eqShadow;
  const eqContent = mk('div', { class: 'content' }); eqShadow.appendChild(eqContent);
  const stHost = mk('div', { id: 'Storage' });
  const stShadow = mk('shadow'); stShadow.parentNode = stHost; stHost.shadowRoot = stShadow;
  const stContent = mk('div', { class: 'content' }); stShadow.appendChild(stContent);
  const bag = [{ index: 0, ITID: 100, type: 0 }, { index: 3, ITID: 501, type: 0 }, { index: 7, ITID: 777, type: 0 }];
  const rules = Object.assign({}, opt.rules || {});
  const log = { hidden: 0, placed: 0, refresh: 0, status: [] };
  let clock = 1700000000000;
  class FakeDate extends Date { constructor(...a) { if (a.length === 0) super(clock); else super(...a); } static now() { return clock; } }
  const comp = { _host: host, __autoOpen: false, setItem(item) { if (comp.__autoOpen) { comp.__autoOpen = false; world.openWindow(); } comp.__set = item; } };
  const ITIP = { el: null, elKey: '', hover: null, over: false, bagTarget: null, infoRawCtx: null, infoRawSet: null, infoSetSeen: false, infoPatched: false, infoComp: null, infoGen: 0, infoSrcBag: false, infoSessGen: -1, infoPendGen: -1, infoPendAt: 0, infoOpenSeen: false };
  const bagClean = { config: { discardRules: rules }, render() {}, generation: 0 };
  const ctx = {
    ITIP, document: documentMock, bagClean, Number, String, Object, Math, JSON, Date: FakeDate, isFinite, RegExp,
    bagCleanDisarm() {}, getItemName: id => '物品' + id, setStatus: (m, k) => log.status.push([m, k]),
    bagInvComp: () => ({ _host: invHost }),
    uiComp: nm => (nm === 'ItemInfo' ? comp : (nm === 'Inventory' ? { _host: invHost } : null)),
    itipInvMap: () => { const m = {}; for (const it of bag) m[it.index] = it; return m; },
    itipChain: el => { const out = []; let n = el, g = 0; while (n && g++ < 40) { out.push(n); n = n.parentNode || null; } return out; },
    itipHide: () => { log.hidden++; ITIP.over = false; if (ITIP.el) { ITIP.el.style.display = 'none'; ITIP.elKey = ''; } },
    itipPlace: () => { log.placed++; },
    itipRefresh: () => { log.refresh++; },
  };
  vm.createContext(ctx);
  vm.runInContext(bagActCode(src) + ';this.onCtx=bagActOnContext;this.click=bagActClick;this.sync=bagActInfoSync;this.curItem=bagActInfoItem;this.mouseOut=itipMouseOut;this.mouseMove=itipMouseMove;this.observe=(typeof bagActInfoObserve==="function"?bagActInfoObserve:function(){});', ctx);
  const evt = target => {
    const o = { target, relatedTarget: null, composedPath: () => [target], pd: 0, sp: 0, preventDefault() { o.pd++; }, stopPropagation() { o.sp++; } };
    return o;
  };
  const bagEl = (idx, itid) => { const el = mk('div', { class: 'item', 'data-index': String(idx), 'data-itid': String(itid) }); invContent.appendChild(el); return el; };
  const equipEl = (idx, itid) => { const el = mk('div', { class: 'item', 'data-index': String(idx), 'data-itid': String(itid) }); eqContent.appendChild(el); return el; };
  const storeEl = (idx, itid) => { const el = mk('div', { class: 'item', 'data-index': String(idx), 'data-itid': String(itid) }); stContent.appendChild(el); return el; };
  const world = {
    ITIP, comp, root, host, bag, rules, log, ctx, mk, bagEl, equipEl, storeEl,
    closeWindow() { if (host.parentNode) host.parentNode.removeChild(host); host.style.display = 'none'; host.dispatchEvent({ type: 'x_remove' }); },
    hideWindow() { host.style.display = 'none'; },
    openWindow() { body.appendChild(host); host.style.display = ''; },
    rightClick(el) { const e = evt(el); ctx.onCtx(e); return e; },
    click(el) { const e = evt(el); ctx.click(e); return e; },
    mouseOut(related) { ctx.mouseOut({ relatedTarget: related || null }); },
    mouseMove(x, y) { ctx.mouseMove({ clientX: x, clientY: y }); },
    advanceClock(ms) { clock += ms; },
  };
  return world;
}
function bagActAssertWindowButton(w) {
  assert.equal(w.root.querySelector('[data-dsh-bagrow]'), null, '窗口没开时不得凭空出现按钮');
  const rc = w.rightClick(w.bagEl(3, '501'));
  assert.equal(rc.pd, 0, '右键监听不得 preventDefault');
  assert.equal(rc.sp, 0, '右键监听不得 stopPropagation');
  assert.equal(w.root.querySelector('[data-dsh-bagrow]'), null, '窗口没开时右键不得凭空造按钮');
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  const btn = w.root.querySelector('[data-dsh-bagact]');
  assert.ok(btn, '窗口打开后必须出现丢弃名单按钮');
  assert.equal(btn.textContent, '加入丢弃名单');
  assert.equal(btn.getAttribute('data-dsh-bagact'), 'add');
  w.click(btn);
  assert.deepEqual(Object.keys(w.rules), ['501'], '点击后名单里正好这一条');
  assert.equal(w.root.querySelector('[data-dsh-bagact]').textContent, '移出丢弃名单', '文案立刻翻转');
  assert.equal(w.root.querySelector('[data-dsh-bagact]').getAttribute('data-dsh-bagact'), 'del', '高亮状态立刻翻转');
  w.click(btn);
  assert.deepEqual(Object.keys(w.rules), [], '再点一下正好那一条被移出');
  assert.equal(w.root.querySelector('[data-dsh-bagact]').textContent, '加入丢弃名单');
}
function bagActAssertSwap(w) {
  w.rightClick(w.bagEl(3, '501'));   // 真实入口：右键第 3 格
  w.openWindow();                    // 客户端随后 append()
  w.ctx.sync();                      // 助手自身那一拍（每 700ms）也要校正一次
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.equal(w.root.querySelector('[data-dsh-bagact]').textContent, '加入丢弃名单');
  w.comp.setItem({ index: 7, ITID: 777, type: 0 }); // 客户端复用同一窗口直接换物品（不再经右键）
  const btn = w.root.querySelector('[data-dsh-bagact]');
  assert.equal(btn.textContent, '移出丢弃名单', '换物品后按钮文案必须跟着换');
  assert.equal(btn.getAttribute('data-dsh-bagact'), 'del');
  w.click(btn);
  assert.deepEqual(Object.keys(w.rules), [], '点击移出的必须是新物品 777');
  assert.ok(!('501' in w.rules), '绝不能误动上一件 501');
}
function bagActAssertNonBag(w) {
  w.rightClick(w.bagEl(3, '501'));   // 真实入口：右键第 3 格
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  const row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(row && row.style.display !== 'none', '背包物品必须给按钮');
  w.comp.setItem({ index: 0, ITID: 5001, type: 5 });        // 同格子号、不同实例：映射不上
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '映射不上不得给按钮');
  w.comp.setItem({ index: 42, ITID: 999, type: 0 });        // 根本不在背包里
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '不在背包不得给按钮');
  w.rightClick(w.equipEl(3, '501'));                       // 装备栏格子（号与背包同）绝不是背包
  assert.equal(w.ITIP.infoRawCtx, null, '装备栏格子绝不能被当成背包');
  assert.equal(w.ITIP.infoRawSet, null, '装备栏格子不得让按钮指向背包里的同号物品');
  w.rightClick(w.bagEl(3, '999'));                         // data-itid 与映射不符：禁止按 ITID 反查替代
  assert.equal(w.ITIP.infoRawCtx, null, 'data-itid 不符必须映射失败');
  w.rightClick(w.bagEl(3, '501'));
  assert.equal(w.ITIP.infoRawCtx && w.ITIP.infoRawCtx.ITID, 501, '精确命中的背包格子必须映射成功');
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '恢复显示');
}
function bagActAssertMouseOut(w) {
  const tip = w.mk('div', { id: 'dsh-itemtip' });
  const btnInTip = w.mk('button', { 'data-dsh-bagact': 'add' });
  tip.appendChild(btnInTip);
  w.ITIP.el = tip; w.ITIP.elKey = 'k'; w.ITIP.hover = w.bagEl(3, '501');
  tip.style.display = 'block';
  w.mouseOut(btnInTip);
  assert.equal(tip.style.display, 'block', '鼠标移到浮窗按钮上不得收起');
  assert.equal(w.ITIP.over, true, '必须标记「指针在浮窗上」');
  assert.equal(w.log.hidden, 0, '不得调用收起');
  const before = w.log.placed;
  w.mouseMove(10, 20);
  assert.equal(w.log.placed, before, '指针停在浮窗上时不得再把它挪走');
  w.mouseOut(w.mk('canvas', {}));
  assert.equal(tip.style.display, 'none', '离开浮窗必须收起');
  assert.equal(w.ITIP.over, false);
}
const BAGACT_SOURCES = [['stable', source], ['exp', expSource]];
test('V2.38.5 a 说明窗口按钮：右键背包物品后窗口里出现按钮，点击精确加/移那一条（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertWindowButton(bagActWorld(src)));
});
test('V2.38.5 b 说明窗口换物品：按钮跟着换，点击动的必须是新那一条（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertSwap(bagActWorld(src, { rules: { '777': 0 } })));
});
test('V2.38.5 c 非背包物品不给按钮：装备栏格子 / 不在背包 / data-itid 不符（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertNonBag(bagActWorld(src)));
});
test('V2.38.5 d 旧浮窗保留可用：mouseout 移到浮窗（及其按钮）上不收起，指针停住时不再挪动浮窗（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertMouseOut(bagActWorld(src)));
});
test('V2.38.5 静态断言：注入/只读右键/换物品同步/每拍校正/旧浮窗守卫就位，文案无实现词无 emoji，零新端点零发包', () => {
  const EMOJI5 = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
  for (const [name, src] of BAGACT_SOURCES) {
    const a = src.indexOf('  // ================= V2.38.5：客户端「物品说明」窗口里的');
    const b = src.indexOf('  // ---- 商店单价解析 ----', a);
    assert.ok(a >= 0 && b > a, name + ' 必须能切出 V2.38.5 新增块');
    const block = src.slice(a, b);
    assert.ok(block.includes('function bagActInfoSync()') && block.includes('data-dsh-bagrow'), name + ' 说明窗口注入必须就位');
    assert.ok(block.includes('function bagActInfoPatch()') && block.includes('ITIP.infoRawSet = item'), name + ' 换物品同步必须就位');
    assert.ok(src.includes('document.addEventListener("contextmenu", bagActOnContext, true);'), name + ' 右键必须是只读捕获监听');
    const ctxFn = src.slice(src.indexOf('  function bagActOnContext(e) {'), src.indexOf('  // 两类按钮（说明窗口 / 跟随浮层）共用的点击处理'));
    assert.ok(ctxFn.length > 100, name + ' 必须能切出右键监听');
    assert.ok(!/preventDefault|stopPropagation/.test(ctxFn), name + ' 右键监听只能读，不得 preventDefault/stopPropagation');
    assert.ok(ctxFn.includes('bagActItemByIndex(el.getAttribute("data-index"), el.getAttribute("data-itid"))'), name + ' 必须按 data-index/data-itid 精确映射');
    assert.ok(src.includes('setInterval(function () { try { bagActInfoSync(); } catch (e) {} }, 700);'), name + ' 必须每拍校正按钮');
    assert.ok(src.includes('rt.closest("#dsh-itemtip")'), name + ' mouseout 必须有与 mouseover 同一守卫');
    assert.ok(src.includes('display:none;pointer-events:auto;max-width:340px'), name + ' 旧浮窗容器必须可点');
    const uiTexts = ['"移出丢弃名单"', '"加入丢弃名单"', '"用法：点一下加入，再点一下移出；只对正在查看的这件物品生效"', '"丢弃名单：读不到正在查看的这件物品"'];
    for (const t of uiTexts) assert.ok(block.includes(t), name + ' 界面文案必须就位：' + t);
    assert.ok(!/发包|包|客户端|字段|接口/.test(uiTexts.join('')), name + ' 界面文案不得出现实现词');
    assert.ok(!EMOJI5.test(block), name + ' 新增内容不得含 emoji');
    assert.ok(!/sendPacket\(|hookPacket|CLIENT\.PS\.CZ|(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(block), name + ' 不得新增发包/网络端点');
    assert.ok(!/useItem|ITEM_THROW/.test(block), name + ' 不得新增道具使用/丢弃发包');
    assert.ok(!/dsh-itemtip"\)\.style\.pointerEvents|pointer-events:none/.test(block), name + ' 新增块不得把浮窗改回不可点');
  }
});
test('V2.38.5 变异测试：去掉注入 / 去掉换物品同步 / 去掉 mouseout 守卫 / 去掉背包宿主判定 / 去掉 index+ITID 校验 → 必须被杀死', () => {
  const mut = (label, oldS, newS) => { const out = source.split(oldS).join(newS); assert.notEqual(out, source, '变异体必须命中：' + label); return out; };
  const cases = [
    ['① 去掉说明窗口注入（窗口里再也不会出现那一行按钮）', '      if (!row) { row = bagActInfoMakeRow(); root.appendChild(row); }', '      if (!row) return false;', bagActAssertWindowButton],
    ['② 去掉换物品同步（setItem 包装不再记录/刷新）', '          try { ITIP.infoRawSet = item; ITIP.infoSetSeen = true; bagActInfoSync(); } catch (e0) {}', '', bagActAssertSwap],
    ['③ 去掉 mouseout 守卫（鼠标移到旧浮窗上被收起）', '      try { if (rt && rt.closest && rt.closest("#dsh-itemtip")) { ITIP.over = true; return; } } catch (e2) {}', '', bagActAssertMouseOut],
    ['④ 去掉背包宿主判定（装备栏格子也能映射到同号背包物品）', '      var it = bagActIsBagChain(chain) ? bagActItemByIndex(el.getAttribute("data-index"), el.getAttribute("data-itid")) : null;', '      var it = bagActItemByIndex(el.getAttribute("data-index"), el.getAttribute("data-itid"));', bagActAssertNonBag],
    ['⑤ 去掉 index+ITID 一致性校验（按 ITID 反查替代）', '      if (itid != null && itid !== "" && have !== String(itid)) return null;', '', bagActAssertNonBag],
  ];
  for (const [label, oldS, newS, check] of cases) {
    let m = '';
    try { check(bagActWorld(mut(label, oldS, newS))); } catch (e) { m = String((e && e.message) || e); }
    assert.ok(m, label + ' 必须被杀死（没有抛错 = 用例没覆盖）');
    console.log('[V2.38.5 变异测试] ' + label + ' 被杀死：' + m.split(String.fromCharCode(10))[0].slice(0, 140));
  }
});

// ================= V2.38.5 审计 F1（补充）：setItem 通道的来源凭证 =================
// 审计结论：ItemInfo 是所有容器共用的组件，setItem 会被装备/仓库/邮件/交易/商店等调用；
// 旧实现只要「包装挂上 + 见过一次 setItem」就拿最后那件按 (index,ITID) 去背包里解，
// 仓库/背包同号同 ID 时非背包窗口也会长出按钮。以下负例覆盖审计 F3 的覆盖缺口。
function bagActAssertNonBagSetItem(w) {
  // 装备来源：右键装备格 → 客户端 setItem 恰好是与背包同号同 ID 的那件
  w.rightClick(w.equipEl(3, '501'));
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  let row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '装备来源经 setItem 绝不给按钮');
  assert.equal(w.root.querySelector('[data-dsh-bagact]'), null, '装备来源连按钮元素都不该有');
  w.ctx.sync(); w.ctx.sync();
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '700ms 兜底不得把装备来源的按钮复活');
  // 仓库来源：同一号、同一 ITID 的仓库格子
  w.rightClick(w.storeEl(3, '501'));
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '仓库来源经 setItem 绝不给按钮');
  w.ctx.sync();
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '700ms 兜底不得把仓库来源的按钮复活');
  assert.deepEqual(Object.keys(w.rules), [], '非背包来源一律不得写规则');
}
function bagActAssertNoRightClick(w) {
  w.ctx.sync();                                      // 每拍兜底：包装早已挂上（真实客户端如此）
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });   // 物品预览开窗：一次右键都没有
  let row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '没经过任何右键的 setItem 不给按钮（宁可不显示）');
  w.ctx.sync();
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '每拍兜底也不得凭空给按钮');
  assert.deepEqual(Object.keys(w.rules), [], '没经过右键不得写规则');
}
function bagActAssertCredExpire(w) {
  w.rightClick(w.bagEl(3, '501'));                 // 1) 背包会话正常
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '背包来源必须先正常给按钮');
  w.closeWindow();                                 // 2) 关窗：兜底那一拍必须把会话作废
  w.ctx.sync();
  w.openWindow();                                  // 3) 重开但没有新的右键 = 物品预览
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '关窗重开（预览）不得按旧记录复活按钮');
  for (let i = 0; i < 3; i++) w.ctx.sync();
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '700ms 兜底不得把按钮复活');
  w.rightClick(w.bagEl(3, '501'));                 // 4) 下一次背包右键必须立刻恢复
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '下一次背包右键必须重新给按钮');
  w.rightClick(w.equipEl(3, '501'));               // 5) 同窗换代成非背包来源：按钮必须立刻收起
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '同窗换代成非背包来源必须立刻收起按钮');
  for (let i = 0; i < 3; i++) w.ctx.sync();
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '凭证换代后 700ms 兜底不得把按钮复活');
  assert.deepEqual(Object.keys(w.rules), [], '全程不得写规则');
}
function bagActAssertTipClick(w) {
  const tip = w.mk('div', { id: 'dsh-itemtip' });
  const btn = w.mk('button', { 'data-dsh-bagact': 'add' });
  tip.appendChild(btn);
  w.ITIP.bagTarget = w.bag[1];                     // {index:3, ITID:501}
  const e1 = w.click(btn);
  assert.equal(e1.pd, 1, '旧浮窗按钮点击必须拦下默认行为');
  assert.equal(e1.sp, 1, '旧浮窗按钮点击必须 stopPropagation');
  assert.deepEqual(Object.keys(w.rules), ['501'], '旧浮窗按钮点击必须精确加入这一条');
  assert.equal(w.log.refresh, 1, '点击后必须刷新旧浮窗');
  assert.ok(w.log.status.length === 1 && /已加入丢弃名单/.test(w.log.status[0][0]), '必须有加入提示');
  btn.setAttribute('data-dsh-bagact', 'del');
  const e2 = w.click(btn);
  assert.equal(e2.pd, 1); assert.equal(e2.sp, 1);
  assert.deepEqual(Object.keys(w.rules), [], '再点一下必须精确移出');
  assert.equal(w.log.refresh, 2, '移出后必须再刷新一次');
  w.ITIP.bagTarget = null;
  w.click(btn);
  assert.equal(w.log.status.length, 3, '读不到物品必须给出提示');
  assert.equal(w.log.status[2][1], 'warn', '读不到物品要走告警而不是静默');
}
test('V2.38.5+ F1 负例（审计 F3 缺口）：装备 / 仓库来源经 setItem 都不给按钮、不写规则（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertNonBagSetItem(bagActWorld(src)));
});
test('V2.38.5+ F1 负例：没经过任何右键的 setItem（物品预览开窗）保持宁可不显示（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertNoRightClick(bagActWorld(src)));
});
test('V2.38.5+ F1：凭证过期（关窗重开 / 换代）后按钮必须消失，700ms 兜底不得复活（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertCredExpire(bagActWorld(src)));
});
test('V2.38.5+ 回归：旧浮窗（#dsh-itemtip）按钮点击仍然精确加/移，不动说明窗口凭证（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertTipClick(bagActWorld(src)));
});
test('V2.38.5+ F1 静态断言：右键刷新来源凭证 / setItem 三闸门 / 会话作废就位，解析路径全部排在三闸门之后', () => {
  for (const [name, src] of BAGACT_SOURCES) {
    const a = src.indexOf('  // ================= V2.38.5：客户端「物品说明」窗口里的');
    const b = src.indexOf('  // ---- 商店单价解析 ----', a);
    assert.ok(a >= 0 && b > a, name + ' 必须能切出 V2.38.5 新增块');
    const block = src.slice(a, b);
    assert.ok(block.includes('ITIP.infoGen++'), name + ' 每次右键必须换代');
    assert.ok(block.includes('ITIP.infoSrcBag = !!isBag'), name + ' 右键必须按背包链路刷新来源凭证');
    assert.ok(block.includes('if (!ITIP.infoSrcBag) return null;'), name + ' setItem 通道必须校验背包来源');
    assert.ok(block.includes('if (ITIP.infoSessGen !== ITIP.infoGen) return null;'), name + ' setItem 通道必须校验代际');
    assert.ok(block.includes('ITIP.infoSessGen = ITIP.infoPendGen;'), name + ' 开窗第一帧 setItem 必须认领本代凭证');
    assert.ok(block.includes('bagActInfoCredDrop()'), name + ' 关窗必须作废凭证');
    assert.ok(block.includes('var ITIP_PEND_MS = 2000;'), name + ' 待认领凭证必须有 2 秒上限');
    assert.ok(block.includes('function bagActInfoObserve()'), name + ' 必须有公共观察点');
    assert.ok(block.includes('bagActInfoRemoveHook(c)'), name + ' 宿主 x_remove 同步钩子必须挂上');
    assert.ok(block.includes('h.addEventListener("x_remove"'), name + ' x_remove 必须同步作废凭证');
    assert.ok(src.includes('setInterval(function () { try { bagActInfoObserve(); } catch (e) {} }, 250);'), name + ' 必须有 250ms 观察拍');
    assert.ok(src.includes('setInterval(function () { try { bagActInfoSync(); } catch (e) {} }, 700);'), name + ' 700ms 兜底拍必须保留');
    const patchFn = src.slice(src.indexOf('  function bagActInfoPatch() {'), src.indexOf('  // 只读记录「这次右键的是哪一格背包」'));
    assert.ok(patchFn.indexOf('bagActInfoObserve();') > 0 && patchFn.indexOf('bagActInfoObserve();') < patchFn.indexOf('var r = orig.apply(this, arguments);'), name + ' setItem 处理点必须先观察关窗再放行客户端 setItem');
    assert.ok(block.includes('if (ITIP.infoPatched && ITIP.infoSetSeen) return bagActResolveBagItem(ITIP.infoRawSet);'), name + ' setItem 记录优先的兜底路径必须保留');
    const itemFn = src.slice(src.indexOf('  function bagActInfoItem() {'), src.indexOf('  function bagActInfoCredDrop()'));
    const g1 = itemFn.indexOf('if (!ITIP.infoOpenSeen) return null;');
    const g2 = itemFn.indexOf('if (!ITIP.infoSrcBag) return null;');
    const g3 = itemFn.indexOf('if (ITIP.infoSessGen !== ITIP.infoGen) return null;');
    const use = itemFn.indexOf('ITIP.infoSetSeen');
    assert.ok(g1 > 0 && g2 > g1 && g3 > g2 && use > g3, name + ' 三闸门必须全部在解析出物品之前');
    assert.ok(itemFn.indexOf('bagActResolveBagItem(') > g3 && itemFn.lastIndexOf('bagActResolveBagItem(') > g3, name + ' 两条解析路径都必须排在三闸门之后');
  }
});
test('V2.38.5+ F1 变异测试：① 去掉右键来源凭证 / ② 允许非背包 setItem 解析物品 / ③ 去掉代际校验 / ④ 去掉凭证超时 / ⑤ 去掉 setItem 处理点的即时关窗观察 / ⑥ 去掉 x_remove 同步作废 → 必须被杀死', () => {
  const cases = [
    ['① 去掉右键来源凭证（右键不再区分背包/非背包）', '      ITIP.infoSrcBag = !!isBag;', '      ITIP.infoSrcBag = true;', bagActAssertNonBagSetItem],
    ['② 允许非背包 setItem 解析物品（删掉背包来源校验）', '      if (!ITIP.infoSrcBag) return null;', '      if (false) return null;', bagActAssertNonBagSetItem],
    ['③ 去掉代际校验（关窗/换代后仍按旧 setItem 给按钮）', '      if (ITIP.infoSessGen !== ITIP.infoGen) return null;', '      if (false) return null;', bagActAssertCredExpire],
    ['④ 去掉凭证超时判定（待认领凭证永远有效）', '    return ITIP.infoPendGen >= 0 && (Date.now() - ITIP.infoPendAt) <= ITIP_PEND_MS;', '    return ITIP.infoPendGen >= 0;', bagActAssertPendTimeoutFail],
    ['⑤ 去掉 setItem 处理点的即时关窗观察（只留兜底拍）', '          try { bagActInfoObserve(); } catch (eC) {}', '', bagActAssertEntryObserve],
    ['⑥ 去掉 x_remove 同步作废（关窗后同一任务内重开复活按钮）', '      h.addEventListener("x_remove", function () { try { bagActInfoCredDrop(); } catch (eR) {} });', '', bagActAssertReopenSameTask],
  ];
  for (const [name, src] of BAGACT_SOURCES) {
    for (const [label, oldS, newS, check] of cases) {
      const out = src.split(oldS).join(newS);
      assert.notEqual(out, src, name + ' 变异体必须命中：' + label);
      let m = '';
      try { check(bagActWorld(out)); } catch (e) { m = String((e && e.message) || e); }
      assert.ok(m, name + ' ' + label + ' 必须被杀死（没有抛错 = 用例没覆盖）');
      console.log('[V2.38.5+ F1 变异测试][' + name + '] ' + label + ' 被杀死：' + m.split(String.fromCharCode(10))[0].slice(0, 120));
    }
  }
});

// ================= V2.38.5 审计 F1 第二轮（fail-closed 收紧） =================
// 收紧①：待认领凭证据右键时刻起 2 秒内有效，超时整代作废；
// 收紧②：关窗观察点从「只有 700ms 兜底」扩到「每次 setItem 处理点 + 250ms 拍 + 700ms 拍」。
function bagActAssertPendTimeoutOk(w) {
  w.rightClick(w.bagEl(3, '501'));                 // 窗口关着 → 待认领凭证
  w.advanceClock(1500);                            // 2 秒以内
  w.openWindow();
  w.ctx.observe();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '2 秒内的待认领凭证必须正常兑现按钮');
  assert.deepEqual(Object.keys(w.rules), [], '2 秒内兑现也不得自己写规则');
}
function bagActAssertPendTimeoutFail(w) {
  w.rightClick(w.bagEl(3, '501'));                 // (1) 只走 setItem 处理点
  w.advanceClock(2500);                            // 超过 2 秒
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  let row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '右键超 2 秒后预览 setItem 绝不给按钮');
  w.ctx.sync();
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '超时凭证不得被 700ms 兜底拍复活');
  w.closeWindow();                                 // (2) 只走 250ms 观察拍
  w.ctx.sync();
  w.rightClick(w.bagEl(3, '501'));                 // 窗口关着 → 新一对待认领凭证
  w.advanceClock(2500);
  w.openWindow();
  w.ctx.observe();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  row = w.root.querySelector('[data-dsh-bagrow]');
  assert.ok(!row || row.style.display === 'none', '观察拍判超时后 setItem 也不得给按钮');
  const btn = w.root.querySelector('[data-dsh-bagact]');
  if (btn) w.click(btn);
  assert.deepEqual(Object.keys(w.rules), [], '超时凭证绝不允许写规则');
}
// 真实客户端时序（审计B 实测）：装备 / 仓库 / 邮件 / 商店等 30 个容器 handler 一律 ItemInfo.append() 在前、
//   ItemInfo.setItem(item) 在后；关窗走客户端 remove()，宿主会同步 dispatchEvent(new Event("x_remove"))。
//   所以「关窗 → 同一任务内立刻重开」只能靠 x_remove 同步信号封死，不能指望 setItem 处理点那一瞥。
function bagActAssertReopenSameTask(w) {
  w.rightClick(w.bagEl(3, '501'));                 // 窗口关着 → 待认领凭证
  w.openWindow();                                  // 真实顺序第一步：append()
  w.comp.setItem({ index: 3, ITID: 501, type: 0 }); // 真实顺序第二步：setItem()
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '背包会话先正常给按钮');
  w.closeWindow();                                 // 关窗：宿主被摘掉 + 同步 x_remove
  w.openWindow();                                  // 同一任务里立刻重开（append）
  w.comp.setItem({ index: 3, ITID: 501, type: 0 }); // 同一任务里 setItem
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '关窗后同一任务内重开不得按旧记录复活按钮');
  for (let i = 0; i < 3; i++) w.ctx.sync();
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '700ms 兜底拍也不得复活');
  w.ctx.observe();
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '250ms 观察拍也不得复活');
  assert.deepEqual(Object.keys(w.rules), [], '不得写规则');
}
// 防御路径（不是客户端真实时序，真实时序见上一函数）：客户端只把窗口藏起来（display:none，宿主仍在 DOM 上、
//   且不发 x_remove），并且是在 setItem 内部才把窗口放回来 —— 这条只能靠 setItem 处理点的那一次观察兜住。
function bagActAssertEntryObserve(w) {
  w.rightClick(w.bagEl(3, '501'));                 // 背包会话正常
  w.openWindow();
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.ok(w.root.querySelector('[data-dsh-bagrow]').style.display !== 'none', '背包会话先正常给按钮');
  w.hideWindow();                                  // 只 display:none，不发 x_remove
  w.comp.__autoOpen = true;                        // 客户端在 setItem 内部才把窗口放回来
  w.comp.setItem({ index: 3, ITID: 501, type: 0 });
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '只藏起来的窗口在 setItem 处理点必须被即时作废');
  for (let i = 0; i < 3; i++) w.ctx.sync();
  assert.equal(w.root.querySelector('[data-dsh-bagrow]').style.display, 'none', '兜底拍也不得复活');
  assert.deepEqual(Object.keys(w.rules), [], '不得写规则');
}
test('V2.38.5+ F1 收紧 a：待认领凭证 2 秒上限——2 秒内正常兑现，超时整代作废（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) {
    bagActCheck(name + '·2秒内', () => bagActAssertPendTimeoutOk(bagActWorld(src)));
    bagActCheck(name + '·超2秒', () => bagActAssertPendTimeoutFail(bagActWorld(src)));
  }
});
test('V2.38.5+ F1 收紧 b（真实时序 append→setItem）：关窗后同一任务内立刻重开，x_remove 必须同步作废会话（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertReopenSameTask(bagActWorld(src)));
});
test('V2.38.5+ F1 收紧 b2（防御路径）：只 display:none 不发 x_remove 时，setItem 处理点必须即时作废会话（VM · 两文件）', () => {
  for (const [name, src] of BAGACT_SOURCES) bagActCheck(name, () => bagActAssertEntryObserve(bagActWorld(src)));
});
