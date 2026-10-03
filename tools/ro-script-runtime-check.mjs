import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ro-assist.user.js',import.meta.url),'utf8');
// V2.38.15：版本断言一律从产品文件 @version 派生——升版只需改产品文件，用例不会漏改
const PRODUCT_VERSION=/^\/\/\s*@version\s+(\S+)/m.exec(source)[1];
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
      sendSit:x=>{sits.push(x);ent.action=x?2:0;},isSitting:()=>ent.action===2,isWinOpen:()=>false,tpTeleport:x=>{teleports.push(x);return true},setStatus(){},czp:name=>context.CLIENT.PS.CZ[name],deathGuardRun:null,deathGuardDone:false,masterTickReg(fn){context.tick=fn}};
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
  assert.ok(source.includes('else tpTeleport(p.map, p.x, p.y);'));
  assert.ok(source.includes('data-tpp-edit'));
  assert.ok(source.includes('data-tpp-del'));
});

// ================= V2.38.8：助手直发传送（0x0a49 请求 / 2634 回包）=================
const TP_FILES_SRC=[['stable','ro-assist.user.js'],['exp','ro-assist-exp.user.js']].map(([n,f])=>[n,fs.readFileSync(new URL('../'+f,import.meta.url),'utf8')]);
function tpBody(src){const a=src.indexOf('  var TP_PKT_OP = 2633'),b=src.indexOf('  // V2.29.0：快捷传送点改全局共享',a);assert.ok(a>=0&&b>a,'直发传送代码块必须就位');return src.slice(a,b);}
function tpWorld(src,over,opt){
  const o=opt||{};let code=tpBody(src);
  if(over){assert.equal(code.split(over[0]).length-1,1,'变异锚点必须唯一：'+over[0].slice(0,50));const mut=code.split(over[0]).join(over[1]);assert.notEqual(mut,code,'变异必须真的改到代码');code=mut;}
  const sent=[],logs=[];let ivFn=null,clock=1000;
  const ctx={String,Number,Math,isFinite,
    CLIENT:{NM:{sendPacket:p=>sent.push(p)},SS:{Entity:{position:[152,94]}}},
    clientReady:()=>o.noClient!==true,czPacketVer:()=>o.pv===undefined?20211103:o.pv,
    mvLog:m=>logs.push(m),tlog:m=>logs.push(m),setStatus:()=>{},identityLogLine:()=>{},
    getMapName:()=>o.map||'prontera',normMapKey:m=>String(m||'').replace(/\.(gat|rsw)$/i,'').toLowerCase(),
    setInterval:fn=>{ivFn=fn;return 1;},clearInterval:()=>{ivFn=null;}};
  if(o.now!==undefined)ctx.Date={now:()=>clock};
  if(o.mn)ctx.IS_MN=true;   // F4：手机页分支（脚本里 IS_MN = /[?&]r=mn/.test(location.search) 的等价注入）
  vm.createContext(ctx);
  vm.runInContext(code+';this.send=tpSend;this.frame=tpFrame;this.diag=tpDiagText;this.ack=tpOnAck;this.last=function(){return tpLast};this.wait=waitTeleportMap;this.teleport=teleport;this.tpTeleport=tpTeleport;',ctx);
  assert.equal(typeof ctx.send,'function','直发传送入口必须就位');
  const out={sent,setClock:v=>{clock=v},logs:()=>logs,fire:()=>{if(ivFn)ivFn();},hasIv:()=>!!ivFn,call:(expr)=>vm.runInContext(expr,ctx),ctx};
  for(const k of ['send','frame','diag','ack','last','wait','teleport','tpTeleport'])out[k]=ctx[k];
  return out;
}
function tpByteCheck(w){
  const r1=w.send('prontera',null,null,null);
  assert.equal(r1.ok,true,'城镇（无坐标）必须发出');assert.equal(w.sent.length,1,'一次调用只发一个包');
  const f1=w.sent[0].build();assert.equal(f1.buffer.byteLength,34,'现代协议帧长必须 34B');const d1=f1.view;
  assert.equal(d1.getUint16(0,true),2633,'opcode 必须是 0x0a49/2633');
  const nm=[];for(let i=0;i<16;i++)nm.push(d1.getUint8(2+i));
  assert.deepEqual(nm,[...'prontera'].map(c=>c.charCodeAt(0)).concat(new Array(8).fill(0)),'地图名必须 16B 定长右补 0');
  assert.equal(d1.getUint32(18,true),0,'无坐标 → x=0');assert.equal(d1.getUint32(22,true),0,'无坐标 → y=0');
  assert.equal(d1.getUint32(26,true),1,'前往目标图 type=1');assert.equal(d1.getUint32(30,true),14527,'传送券 14527 必须进包（耗不耗由服务器判）');
  const r2=w.send('iz_dun02',120,30,null);assert.equal(r2.ok,true,'野外带坐标必须发出');
  const d2=w.sent[1].build().view;assert.equal(d2.getUint32(18,true),120,'x 必须进包');assert.equal(d2.getUint32(22,true),30,'y 必须进包');
  assert.ok(w.diag().includes('requested=iz_dun02(120,30)'),'诊断必须暴露 requested：'+w.diag());
  assert.ok(w.diag().includes('券=14527'),'诊断必须写明券 14527');
  const r3=w.send('prontera',null,null,{type:0});assert.equal(r3.ok,true,'同图随机传送必须发出');
  assert.equal(w.sent[2].build().view.getUint32(26,true),0,'type=0 必须原样进包');
  const f4=w.frame('prontera',152,94,1,20180703);
  assert.equal(f4.buffer.byteLength,26,'旧协议帧长必须 26B');assert.equal(f4.view.getUint16(18,true),152);assert.equal(f4.view.getUint16(20,true),94);
  assert.equal(f4.view.getUint16(22,true),1);assert.equal(f4.view.getUint16(24,true),14527);
}
function tpRefuseCheck(w){
  for(const bad of [['Bad Map!',null,null],['prontera',70000,1],['prontera',-1,0],['',null,null],['prontera',1.5,2]]){
    const r=w.send(bad[0],bad[1],bad[2],null);
    assert.equal(r.ok,false,'非法输入必须拒绝：'+JSON.stringify(bad));
    assert.ok(r.why&&r.why.length>0,'拒绝必须给出原因');
  }
  assert.equal(w.sent.length,0,'拒绝时一个包都不许发（绝不假装成功）');
  assert.ok(w.logs().some(l=>l.includes('拒绝发送')),'拒绝必须留日志（可排查）');
}
function tpAckCheck(w){
  assert.equal(w.send('prontera',10,20,null).ok,true,'合法传送必须发出');
  const ack=code=>w.ack(new Uint8Array([0x4a,0x0a,code,0,0,0]).buffer);
  ack(0);assert.equal(w.last().ok,true,'code=0 必须记成功');assert.equal(w.last().code,0);
  ack(2);assert.equal(w.last().ok,false,'code=2 绝不允许当成功');assert.ok(w.last().why.includes('2'),'失败原因必须带原始码');
  assert.ok(w.logs().some(l=>l.includes('背包中找不到传送卷轴或会员卡')),'code=2 必须用客户端原文「背包中找不到传送卷轴或会员卡」（F4）');
  ack(3);assert.equal(w.last().ok,false,'code=3 必须判失败');assert.ok(w.logs().some(l=>l.includes('该地图不支持传送功能')),'code=3 必须用客户端原文「该地图不支持传送功能」（F4）');
  ack(4);assert.equal(w.last().ok,false,'code=4 必须判失败');assert.ok(w.logs().some(l=>l.includes('未知地图')),'code=4 必须用客户端原文「未知地图」（F4）');
  ack(7);assert.equal(w.last().ok,false,'未知码必须判失败');assert.ok(w.last().why.includes('未知代码'),'未知码按原值上报');
  assert.ok(w.logs().some(l=>l.includes('服务器拒绝 code=7')),'未知码必须留原始码');
}
test('V2.38.8 直发传送帧逐字节正确：34B/26B、城镇/野外/带坐标/无坐标、券 14527 恒进包（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    tpByteCheck(tpWorld(src));
    const MUT=[
      ['M-TP1 opcode 写错（2633 → 2634）',['w.writeShort(TP_PKT_OP);','w.writeShort(2634);'],tpByteCheck],
      ['M-TP2 券 id 写错（14527 → 14528）',['var TP_PKT_OP = 2633, TP_PKT_ACK = 2634, TP_SCROLL = 14527','var TP_PKT_OP = 2633, TP_PKT_ACK = 2634, TP_SCROLL = 14528'],tpByteCheck],
      ['M-TP3 现代/旧版判断反了（34B 帧永远不用）',['var modern = Number(pv) >= TP_PKT_MODERN;','var modern = false;'],tpByteCheck],
      ['M-TP4 坐标不进包（x/y 恒 0）',['var vals = [x, y, type, TP_SCROLL], i;','var vals = [0, 0, type, TP_SCROLL], i;'],tpByteCheck],
      ['M-TP5 type 恒 0（跨图变同图随机）',['var type = (o.type === 0) ? 0 : 1;','var type = 0;'],tpByteCheck],
      ['M-TP6 结果码非 0 也当成功',['tpLast.ok = false; tpLast.why = "服务器拒绝 code=" + code + "(" + cn + ")";','tpLast.ok = true; tpLast.why = "";'],tpAckCheck],
      ['M-TP7 地图名校验被去掉',['if (!m || !TP_MAP_RE.test(m)) return fail(','if (false) return fail('],tpRefuseCheck],
    ];
    for(const [label,over,probe] of MUT){
      let killed=false,msg='';
      try{probe(tpWorld(src,over));}catch(e){killed=true;msg=e.message;}
      assert.ok(killed,label+' 必须被真实行为断言杀死（'+(msg||'没有任何断言失败')+'）');
      console.log('[V2.38.8 变异]['+name+'] '+label+' 被杀死：'+String(msg).split(String.fromCharCode(10))[0].slice(0,120));
    }
  }
});
test('V2.38.8 直发传送：非法输入一律拒绝、结果码 0/2/未知如实上报，绝不假装成功（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    const w=tpWorld(src);tpRefuseCheck(w);tpAckCheck(w);
    const w0=tpWorld(src,null,{pv:0});
    assert.equal(w0.send('prontera',null,null,null).ok,false,name+' 协议版本未知必须拒绝（不猜 34B/26B）');
    assert.equal(w0.sent.length,0,name+' 协议版本未知时不得发包');
    const wc=tpWorld(src,null,{noClient:true});
    assert.equal(wc.send('prontera',null,null,null).ok,false,name+' 客户端未就绪必须拒绝');
  }
});
test('V2.38.8 直发传送：落地失配暴露 requested/actual；零对话框、零自发包、零新定时器（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    assert.ok(!src.includes('UI/Components/ChatBox/ChatBox'),name+' 不得再 require ChatBox（对话框路径必须删净）');
    assert.ok(!src.includes('chat.submit()'),name+' 不得再走聊天提交');
    assert.ok(!src.includes('请带我去'),name+' 不得再拼聊天文本当传送手段');
    assert.ok(!src.includes('document.querySelector(".gogogo")'),name+' 不得点客户端世界地图入口');
    assert.ok(!src.includes('new CLIENT.PS.CZ.PRIVATE_AIRSHIP_REQUEST'),name+' 新引擎无此类，绝不 new 客户端类');
    const body=tpBody(src);
    assert.ok(!/showPromptBox|confirm\(|alert\(|ChatBox/.test(body),name+' 传送代码块内不得有任何对话框');
    assert.equal((body.match(/sendPacket\(/g)||[]).length,1,name+' 传送块内只允许一个发包点（无自发传送路径）');
    assert.equal((body.match(/setInterval\(/g)||[]).length,1,name+' 传送块只允许沿用原有落地轮询一个定时器（无新增）');
    const wm=tpWorld(src,null,{now:1000,map:'geffen'});
    assert.equal(wm.send('prontera',152,94,null).ok,true);
    wm.wait('prontera',()=>{throw new Error('失配场景不得回调到达');});
    assert.ok(wm.hasIv(),name+' 落地判定必须布上轮询');
    wm.setClock(1000+21000);wm.fire();
    assert.equal(wm.last().miss,true,name+' 20s 未到必须判失配');
    const d=wm.diag();
    assert.ok(d.includes('requested=prontera(152,94)'),name+' 失配必须暴露 requested：'+d);
    assert.ok(d.includes('actual=geffen'),name+' 失配必须暴露 actual：'+d);
    assert.ok(wm.logs().some(l=>l.includes('落地失配')),name+' 失配必须留日志');
    const wr=tpWorld(src,null,{now:1000,map:'prontera'});
    let arrived=0;assert.equal(wr.send('prontera',152,94,null).ok,true);wr.wait('prontera',()=>{arrived++;});
    wr.setClock(1000+800);wr.fire();
    assert.equal(arrived,1,name+' 到图必须回调一次');
    assert.equal(wr.last().miss,false,name+' 到图不得判失配');
    assert.ok(wr.diag().includes('actual=prontera(152,94)'),name+' 到图必须记 actual 坐标：'+wr.diag());
  }
});
test('V2.38.8 传送入口统一走直发：脚本步骤/快捷点/回城/死亡回图/MVP 都不再点客户端或走聊天（静态）',()=>{
  assert.ok(source.includes('case "teleport": tpTeleport(p.map, p.x, p.y);'),'脚本步骤传送必须走直发');
  assert.ok(source.includes('status(tpTeleport(map) ? "传送包已发出'),'MVP 传送必须走直发');
  assert.ok(source.includes('var ok = tpTeleport("prontera")'),'回城必须走直发');
  assert.ok(source.includes('if (!tpTeleport(r.target)) { deathReturnCancel("传送包发送失败"); return; }'),'死亡回目标图必须走直发');
  assert.ok(source.includes('else tpTeleport(p.map, p.x, p.y);'),'快捷传送点必须走直发');
  assert.ok(source.includes('function teleportToMap(map, onArrive) { return tpTeleport(map, null, null, onArrive); }'),'teleportToMap 必须仍走直发');
  assert.ok(source.includes('function teleport(map, opt) { var o = opt || {}; return tpSend(map, o.x, o.y, o); }'),'必须提供规格示例等价的 teleport(map,{x,y}) 入口');
  assert.ok(source.includes('CLIENT.NM.sendPacket(pkt)'),'必须走助手既有发包封装');
  assert.ok(!source.includes('document.querySelector(".gogogo")'));
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
  const code=extract('  function escapePos() {','  function markFlyFail(');
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
  const flyGate=source.indexOf('if (flyIssued) {',start),qoaGate=source.indexOf('if (!flyIssued) {',start);
  assert.ok(flyGate>cool&&flyGate<qoaGate&&qoaGate<qoa,'V2.38.15：只要本拍没有真的发出瞬移（flyIssued=false）就必须独立判定解围，冷却不得提前整拍返回');
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

test('exp BOSS 四模式与解围技能按确认顺序排列（BOSS→血量→群殴→解围）', () => {
  const sel = expExtract('id="dsh-z-bossact"', '</select>');
  for (const opt of ['瞬移', '优先攻击', '等待残血补尾刀']) assert.ok(sel.includes('<option>' + opt + '</option>'), 'BOSS 选项缺 ' + opt);
  assert.ok(sel.includes('<option selected>不处理</option>'), 'BOSS 默认必须是不处理');
  assert.ok(!expSource.includes('dsh-z-bossignorelock" type="checkbox"'), 'V2.38.15：旧忽略名单勾选项必须移除');
  assert.ok(expSource.includes('var isBoss = isBossMid(mid);'), '首领识别必须统一走 isBossMid（怪物库首领值大于 0）');
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
  const qoaFn = expExtract('  function zQoaTry(mobs, ent, now) {', '  // A3：BOSS 四模式判定');
  assert.ok(!/ordinaryCastBlocked\s*\(/.test(qoaFn), '解围技能不得调用 ordinaryCastBlocked');
  assert.ok(qoaFn.includes('skillNextAt[skid]') && qoaFn.includes('zQoaNextAt'), '解围技能必须有 CD/公共CD 门');
  assert.ok(qoaFn.includes('Math.max(skillCdMs({ skid: skid, cd: 0 }), 1000)'), '解围技能必须有 1s 保底 CD 防每拍重放');
  assert.ok(qoaFn.includes('dsh-z-hpfly'), '解围技能只在血线之上放');
  const bossFn = expExtract('  function zBossDecide(mobs) {', '  // A6：早退点不冻结整拍');
  assert.ok(bossFn.includes('out.hp >= 0 && out.hp <= line'), '残血到位才切过去补尾刀');
  assert.ok(bossFn.includes('else if (out.hp < 0) { out.skip = gidInt(rec.GID); zBossLastBlock = "血量未知"; }'), '血量未知也要进忽略集合');
  assert.ok(bossFn.includes('else { out.skip = gidInt(rec.GID); zBossLastBlock = "尾刀未到线"; }'), '未到尾刀线既不打也不飞');
  assert.ok(!bossFn.includes('lockList'), 'V2.38.15：首领不再受锁定名单约束');
  assert.ok(!bossFn.includes('zBossAllowedByLock') && !bossFn.includes('dsh-z-bossignorelock'), 'V2.38.15：名单门与旧开关必须删净');
  assert.ok(bossFn.includes('var bossDist = zBossDistNow();'), '判定距离必须走可填的判定距离');
  assert.equal((expSource.match(/if \(zBossIgnoredGid\(e\.GID, mid\)\) return;/g) || []).length, 2, 'zAttack/zWalk 都要剔除忽略集合里的首领（且必须把该实体的 mid 传进判据）');
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
  assert.deepEqual(Array.from(ctx.bySec['战斗辅助']), ['aid', 'party', 'dps', 'deathlog', 'boss', 'askcombo', 'item']);
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
  const cool = expExtract('      var critEsc = false;', '      var flyBossStuck = false;');
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
test('exp 首领忽略集合跳过：守卫引用 zBossIgnoredGid 与 zLock.gid 且绝不清锁', () => {
  const guard = expExtract('      // V2.38.15：锁定的首位首领落在忽略集合里', '        EM.forEach(function (e) {');
  assert.ok(guard.includes('zBossIgnoredGid'), '跳过守卫必须引用首领忽略集合判据');
  assert.ok(guard.includes('zLock.gid'), '跳过守卫必须引用 zLock.gid');
  assert.ok(!guard.includes('zBossAllowedByLock') && !guard.includes('dsh-z-bossignorelock'), '跳过守卫不得复用已删除的名单门');
  assert.ok(expSource.includes('if (!target && zLock.gid && !zLockBossSkip) {'), '临时目标未命中时才校验原锁定目标，且忽略集合跳过仍生效');
  assert.ok(expSource.includes('var zLockBossSkip = !!(zLock.gid && zBossIgnoredGid(zLock.gid, zLockMidSkip));'), '守卫判定必须由忽略集合统一裁决，且必须传被锁目标的 mid');
  assert.ok(guard.includes('zEntOf(zLock.gid)') && guard.includes('var zLockMidSkip'), '被锁目标的 mid 必须由实体推导出来（否则普通怪会被当成首领跳过）');
  // 该跳过路径不得清锁：整份脚本里 zLock.gid = null 只允许改动前既有的 3 处
  assert.doesNotMatch(guard, /zLock\.gid\s*=\s*(null|undefined|""|'')/, '跳过分支内不得出现清除 zLock.gid 的赋值');
  assert.equal((expSource.match(/zLock\.gid = null/g) || []).length, 3, '不得新增任何清除 zLock.gid 的赋值（既有 3 处不变）');
});

test('exp 尾刀模式跳过只来自尾刀分支，其它三模式与非选中攻击者一路均未改动', () => {
  // skip 只在「等待残血补尾刀」分支产出；瞬移/优先攻击分支不得出现 out.skip
  const other = expExtract('      if (act === "瞬移") { out.fly = true;', '      else if (act === "等待残血补尾刀") {');
  assert.ok(!other.includes('out.skip'), '瞬移/优先攻击分支不得产出 skip（本拍必须飞）');
  assert.ok(other.includes('out.fly = true'), '瞬移分支必须本拍就飞');
  assert.ok(!other.includes('lockList'), 'V2.38.15：瞬移不再因为首领已在锁定名单里转优先攻击');
  const tail = expExtract('else if (act === "等待残血补尾刀") {', '      if (out.want) { zBossAllowGid = out.want;');
  assert.ok(tail.includes('out.skip'), 'skip 只能由尾刀分支产出');
  assert.ok(other.includes('else if (act === "优先攻击") { out.want = gidInt(rec.GID); }'), '优先攻击分支必须原样保留');
  assert.ok(tail.includes('if (out.hp >= 0 && out.hp <= line) out.want = gidInt(rec.GID);'), '尾刀线内仍切去补尾刀');
  // 候选池剔除保持 2 处（zWalk + zAttack），非选中攻击者一路仍排除锁定目标本身
  assert.equal((expSource.match(/if \(zBossIgnoredGid\(e\.GID, mid\)\) return;/g) || []).length, 2, '候选池剔除必须保持 zWalk/zAttack 各一处（且都传该实体的 mid）');
  assert.ok(expSource.includes('if (gidInt(hk) === gidInt(zLock.gid)) continue; // 排除锁定目标本身'), '非选中攻击者一路必须排除锁定目标本身');
});

// ================= V2.34.3：格子距离口径 / 内挂状态校准 / 混合接管兜底 / 坐下放宽 =================
test('exp v2.34.3 格子距离口径与内挂接管兜底：两文件同步、坐下 gate 已放宽', () => {
  // 1) 版本号：稳定版与实验版都必须等于产品文件 @version（@version 与运行时常量一致）
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], PRODUCT_VERSION, name + ' @version 必须是 ' + PRODUCT_VERSION + '（锚定行首元数据行）');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], PRODUCT_VERSION, name + ' 运行时常量 VER 必须是 ' + PRODUCT_VERSION);
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
      target: null, hitCandDist: 0, parseInt, isFinite, String, isBossMid: () => false,
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
    zQoaTry: expExtract('  function zQoaTry(mobs, ent, now) {', '  // A3：BOSS 四模式判定'),
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
test('V2.38.15 首领绝对优先：名单门与旧忽略开关必须删净（防回退）', () => {
  for (const [name, src] of [['stable', source], ['exp', expSource]]) {
    assert.equal((src.match(/zBossAllowedByLock/g) || []).length, 0, name + ' 首领名单门 helper 必须已删除');
    assert.equal((src.match(/\$id\("dsh-z-bossignorelock"\)/g) || []).length, 0, name + ' 不得再读取旧忽略名单勾选项');
    assert.equal((src.match(/dsh-z-bossignorelock/g) || []).length, 0, name + ' 界面已移除、设置键表死条目已清，整份脚本不得再出现该键');
    assert.ok(!src.includes('type="checkbox">优先攻击忽略攻击名单'), name + ' 旧勾选项界面必须移除');
    const decideAt = src.indexOf('function zBossDecide(mobs) {');
    const attackAt = src.indexOf('function zAttack() {');
    assert.ok(decideAt >= 0 && decideAt < attackAt, name + ' zBossDecide 必须在 zAttack 之前');
    const decideSeg = src.slice(decideAt, src.indexOf('  // A6：早退点不冻结整拍', decideAt));
    const attackSeg = src.slice(attackAt, src.indexOf('  // 技能行统一序列化', attackAt));
    assert.ok(!decideSeg.includes('lockList'), name + ' zBossDecide 不得再引用锁定名单');
    assert.ok(!decideSeg.includes('dsh-z-bossignorelock'), name + ' zBossDecide 不得再读旧忽略名单开关');
    assert.ok(decideSeg.includes('var bossDist = zBossDistNow();'), name + ' 判定距离必须走可填的判定距离');
    assert.ok(decideSeg.includes('zBossIgnoreAll = (act === "不处理" || act === "等待残血补尾刀");'), name + ' 忽略集合必须在「是否侦察到首领」之前定下来');
    assert.equal((attackSeg.match(/zBossAllowedByLock\(/g) || []).length, 0, name + ' zAttack 不得再次拦截 zBossDecide 已批准的目标');
    const gidAt = attackSeg.indexOf('zLock.gid = bgid;'), injectAt = attackSeg.indexOf('sendLockInject(bgid);');
    assert.ok(gidAt >= 0 && injectAt > gidAt, name + ' zAttack 必须写锁并注入已批准的首领');
    assert.ok(attackSeg.includes('bossRecD.mid != null ? bossRecD.mid : (bossRecD._job != null ? bossRecD._job : (bossRecD.job != null ? bossRecD.job : bossRecD.mobId))'), name + ' zAttack mid 推导口径');
  }
});

test('V2.38.15 首领忽略集合真值表（vm 实跑 zBossIgnoredGid）', () => {
  const code = extract('  function isBossMid(mid) {', '  // V2.38.15：首领判定距离（格）');
  assert.ok(code.includes('zBossAllowGid') && code.includes('zBossIgnoreAll'), '判据必须读忽略集合与放行编号');
  assert.ok(code.includes('if (!isBossMid(mid)) return false;'), '判据必须内含「必须是首领」守卫（V2.38.15 审计修复）');
  const gi = v => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; };
  const run = (all, allow, gid, mid) => {
    const ctx = { zBossIgnoreAll: all, zBossAllowGid: allow, gidInt: gi, String, Number, isFinite,
      getMobDb: () => ({ '2001': { MvpDropsNum: 1 }, '2002': { MvpDropsNum: '3' }, '9999': { MvpDropsNum: 0 } }) };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.fn = zBossIgnoredGid', ctx);
    return ctx.fn(gid, mid);
  };
  assert.equal(run(false, 0, 1234, 2001), false, '忽略集合关（瞬移/优先攻击）→ 恒不忽略');
  assert.equal(run(false, 1234, 1234, 2001), false, '忽略集合关时放行编号也无意义');
  assert.equal(run(true, 0, 1234, 2001), true, '不处理 → 首领必须忽略');
  assert.equal(run(true, 0, '1234', '2001'), true, '不处理 → 字符串 GID/mid 同样忽略');
  assert.equal(run(true, 0, 1234, 9999), false, '不处理 → 普通怪（非首领）绝不能被忽略');
  assert.equal(run(true, 0, 1234, null), false, '不处理 → mid 取不到时按普通怪处理，绝不误伤');
  assert.equal(run(true, 0, 1234, 2002), true, '不处理 → 其它首领（首领值 3）同样忽略');
  assert.equal(run(true, 1234, 1234, 2001), false, '尾刀已到尾刀线那一只必须放行');
  assert.equal(run(true, 1234, '1234', 2001), false, '放行判定必须归一化数字/字符串 GID');
  assert.equal(run(true, 1234, 9999, 2001), true, '尾刀其它首领一律忽略');
  assert.equal(run(true, 1234, 9999, 9999), false, '尾刀其它普通怪一律不受影响');
});

test('V2.38.15 文案：打全部怪自动联动 + 首领不再受名单约束 + 判定距离/诊断就位（防回退）', () => {
  for (const [name, srcAll] of [['stable', source], ['exp', expSource]]) {
    // 只扫界面区（PAGE_HTML → PROF_CONTROLS）：变更摘要里的历史措辞不算回退
    const ui = srcAll.slice(srcAll.indexOf('var PAGE_HTML'), srcAll.indexOf('var PROF_CONTROLS'));
    assert.ok(ui.length > 1000, name + ' 必须能切出界面区');
    const src = ui;
    assert.ok(src.includes('打全部怪（仅在未设锁定名单时生效）'), name + ' 标签必须写明仅在未设名单时生效');
    assert.ok(src.includes('id="dsh-z-allmobs" type="checkbox" checked'), name + ' id 与默认勾选不得改变');
    assert.ok(src.includes('内挂/混合模式下内挂自身仍会攻击全部'), name + ' 说明必须点明内挂自身仍会打全部怪');
    assert.ok(src.includes('取消=助手不主动选目标'), name + ' 说明必须写明取消=助手不主动选目标');
    assert.ok(src.includes('且会自动取消勾选；名单清空后会自动重新勾上'), name + ' 说明必须写明名单联动');
    assert.ok(src.includes('首领不受名单约束，只按上面的「BOSS 出现」裁决'), name + ' 说明必须写明首领不再受名单约束');
    assert.ok(!src.includes('优先攻击忽略攻击名单'), name + ' 旧忽略名单文案必须删净');
    assert.ok(!src.includes('瞬移/尾刀仍受名单限制'), name + ' 旧名单受限文案必须删净');
    assert.ok(src.includes('id="dsh-z-bossdist" type="number" value="14" min="5" max="40"'), name + ' 判定距离输入必须就位（默认 14，5~40）');
    assert.ok(src.includes('>首领诊断</button>'), name + ' 首领诊断按钮必须就位');
    assert.ok(src.includes('id="dsh-z-bossdiagbox"'), name + ' 诊断文本框必须就位');
  }
});

// ================= V2.34.5：角色档案回落默认根因（落盘门 / 合并写入 / 名单归属 / 漏登记控件 / 诊断字段）=================
function captureAllCode() { return extract('  function captureAll() {', '  // V2.16.7：配置控件统一 change 即时保存'); }
function makeCaptureCtx(controls, els, savedUi, applied) {
  const savedState = { ui: savedUi };
  const ctx = { PROF_CONTROLS: controls, $id: (id) => els[id] || null, saved: savedState, saveSaved: () => {}, profUIApplied: applied, activeProfileKey: () => 'ch1', profileTrusted: () => true, profileHarvestable: () => false, lastTrustedKey: 'ch1', profWriteGuard: () => true };
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
      saveProfiles: () => {}, saved: null, console: { log: () => {} }, profileTrusted: () => true, profWriteGuard: () => true
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
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], PRODUCT_VERSION, name + ' @version 必须是 ' + PRODUCT_VERSION + '（锚定行首元数据行）');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], PRODUCT_VERSION, name + ' 运行时常量 VER 必须是 ' + PRODUCT_VERSION);
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
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},requireDB:n=>n==='DB/Items/ItemType'?typeDb:null,require:()=>null,activeProfileKey:()=>'',profileTrusted:()=>true,
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
  for(const item of incomplete){const d=h.ctx.describe(item,cfg,names);assert.equal(d.ok,false);assert.equal(d.reason,'装备保护信息不完整')}
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
test('V2.35.1 assistant removes challenge and keeps arrow rules plus API lockstep',()=>{for(const[name,s]of splitSources){assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(s)?.[1],PRODUCT_VERSION,name+' @version 必须锚定行首元数据行（旧的非锚定正则可能命中变更日志/正文里的 @version 字样）');assert.equal((s.match(/dsh-ro-challenge-v1/g)||[]).length,1,name+' keeps only one non-destructive arrow migration read');assert.ok(!/function challenge|challengeOwnsCombat|challengeStop/.test(s),name+' challenge automation removed');assert.ok(s.includes('dsh-ro-arrow-rules-v1'));assert.ok(s.includes('function arrowDecision('));assert.ok(s.includes('fwReg("arrowrules", "换箭设置", arrowEnsureHost)'));assert.ok(s.includes('window.__DSH_RO_ASSIST_API__'));assert.ok(s.includes('externalAutomationOwns("arrow") || arrowTarget'));assert.ok(s.includes('externalAutomationOwns("battle")'));}});
test('V2.35.1 public API uses owner-only external signatures and validates the current lease owner',()=>{for(const[,s]of splitSources){assert.ok(s.includes('/^[A-Za-z0-9_.:-]{8,128}$/'));assert.ok(s.includes('dojo:1,battle:1,movement:1,dialog:1,arrow:1,fly:1'));assert.ok(s.includes('if(apiLease&&apiLease.owner!==owner)'));for(const sig of ['apiHas(owner,scope)','apiSnapshot(owner)','apiRelease(owner)','apiContact(owner,gid)','apiWalk(owner,payload)','apiChoose(owner,payload)','apiBattle(owner,on)','apiSetArrow(owner,target)','apiClearArrow(owner)','apiFly(owner,payload)'])assert.ok(s.includes('function '+sig),sig);assert.ok(s.includes('apiLease.generation===generation'));assert.ok(!s.includes('apiHas(owner,generation'));}});
test('V2.35.1 snapshot and battle/menu ownership contracts are explicit',()=>{for(const[,s]of splitSources){for(const key of ['ready:','map:','player:','mobs:','npcs:','target:','inDojoMap:','dialogOpen:','menu:','battleState:','busy:','arrow:'])assert.ok(s.includes(key),key);assert.ok(s.includes('if(fp===apiMenuUsed)return {ok:false,error:"menu-already-used"}'));assert.ok(s.includes('b.state="pending-on"'));assert.ok(s.includes('if(b.state!=="owned")return {ok:true,result:"not-owned"}'));assert.ok(s.includes('if(s!==false)return {ok:true,result:s===true?"preexisting":"unknown"}'),'内挂入口 requestBattle 的既有语义必须原样保留');assert.ok(s.includes('l.battle.state==="owned"||l.battle.state==="pending-off"'));assert.ok(s.includes('var r=apiCombatStart(owner);')&&s.includes('apiCombatStop();return {ok:true,result:"stopped"}'));assert.ok(s.includes('if(typeof apiCombat!=="undefined"&&apiCombat)return {ok:false,error:"combat-owned"}'),'代打期间必须拒绝再开内挂');assert.ok(s.includes('assistCombat:apiAssistCombat,'),'门面必须暴露 assistCombat 代打入口');assert.ok(s.includes('zMon.action="外部代打启动";')&&s.includes('if(npBattleState()===true){'));}});
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
    for(const sig of ['apiHas(owner,scope)','apiSnapshot(owner)','apiRelease(owner)','apiContact(owner,gid)','apiWalk(owner,payload)','apiChoose(owner,payload)','apiBattle(owner,on)','apiAssistCombat(owner,on)','apiCombatStart(owner)','apiCombatActive()','apiCombatStop()','apiTeleport(owner,payload)','apiSetArrow(owner,target)','apiClearArrow(owner)','apiFly(owner,payload)'])assert.ok(s.includes('function '+sig),sig);
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
    const m=mob||{mid:1002,gid:42,dead:false,isBoss:true}; // V2.38.13 FIX-6：内置道场恢复 BOSS-only，换箭 gate 的夹具必须是 BOSS
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
test('V2.38.13 走路拾取默认仍下线：三条拾取路径被统一开关挡住，只有外部租约能打开',()=>{for(const[name,s]of splitSources){
  assert.ok(s.includes('var PICKUP_WALK_OFF = true;'),name+' 总开关必须存在且默认仍是下线');
  assert.ok(s.includes('function pickupWalkAllowed() { return pickupApiOn === true || PICKUP_WALK_OFF !== true; }'),name+' 统一放行判据必须存在（默认关）');
  assert.ok(s.includes('var pickupApiOn = false, pickupApiTypes = null;'),name+' 外部租约开关必须默认关');
  assert.ok(s.includes('if (pickupWalkAllowed() && ((pickupApiOn && apiPickupWants(itid))'),name+' 掉落钩子路径已挡');
  assert.ok(s.includes('var en = pickupWalkAllowed() && (pickupApiOn || ($id("dsh-picken") && $id("dsh-picken").checked));'),name+' 5 秒轮询路径已挡');
  assert.ok(s.includes('if (!pickupWalkAllowed()) return;'),name+' 走过去拾取已挡');
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
    profWriteGuard: () => true, // V2.38.6：换装预设落盘闸门（本用例只验证写回语义）
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

test('V2.38.1/V2.38.15 首领绝对优先：只按 BOSS 设置裁决，名单门已撤（VM）',()=>{
  const code=extract('  var zBossIgnoreAll = false;', '  // A6：早退点不冻结整拍');
  function mk(act,locked,hp,opts){
    const o=opts||{};
    const els={'dsh-z-bossact':{value:act},'dsh-z-bosshp':{value:'30'},'dsh-z-bossdist':{value:o.dist==null?'14':String(o.dist)}};
    const ctx={lockList:locked?{'2001':1}:{'9999':1},scanMobs:[{GID:77,mid:2001,isBoss:true,dist:o.bossDist==null?1:o.bossDist,name:'B'}],lastMobs:[],$id:id=>els[id],
      gidInt:Number,zEntHpPct:()=>hp,getMobDb:()=>({'2001':{MvpDropsNum:1},'9999':{MvpDropsNum:0}}),Object,String,Number,parseInt,isNaN,isFinite};
    vm.createContext(ctx);
    vm.runInContext(code+';this.run=zBossDecide;this.ign=(g,m)=>zBossIgnoredGid(g,m===undefined?2001:m);this.st=()=>({all:zBossIgnoreAll,allow:zBossAllowGid,want:zBossWantGid,block:zBossLastBlock});',ctx);
    return ctx;
  }
  // 1) 优先攻击越过锁定名单（名单非空且不含该首领）
  const p1=mk('优先攻击',true,10);const rp1=p1.run(p1.scanMobs);
  assert.equal(rp1.want,77,'优先攻击必须越过锁定名单拿到首领');
  assert.equal(p1.st().want,77);
  const p2=mk('优先攻击',false,10);const rp2=p2.run(p2.scanMobs);
  assert.equal(rp2.want,77,'名单不含该首领时同样必须优先攻击');
  assert.equal(p2.st().all,false,'优先攻击不进忽略集合');
  // 2) 瞬移：本拍必须飞，不再因为首领已在锁定名单里转优先攻击
  const f1=mk('瞬移',true,10);const rf1=f1.run(f1.scanMobs);
  assert.equal(rf1.fly,true,'已锁定瞬移也必须本拍就飞');assert.equal(rf1.want,0);
  // 3) 不处理：首领进忽略集合，但裁决照常给出（不计入 want）
  const z1=mk('不处理',true,10);const rz1=z1.run(z1.scanMobs);
  assert.equal(rz1.fly,false);assert.equal(rz1.want,0);
  assert.equal(z1.st().all,true);assert.equal(z1.ign(77),true,'不处理必须把首领放进忽略集合');
  assert.equal(z1.st().block,'不处理');
  // 4) 尾刀：到线才放行；未到线忽略；血量未知也忽略
  const t1=mk('等待残血补尾刀',false,50);t1.run(t1.scanMobs);
  assert.equal(t1.st().allow,0);assert.equal(t1.ign(77),true);assert.equal(t1.st().block,'尾刀未到线');
  const t2=mk('等待残血补尾刀',false,30);const rt2=t2.run(t2.scanMobs);
  assert.equal(rt2.want,77,'到尾刀线必须切过去补尾刀');assert.equal(t2.st().allow,77);assert.equal(t2.ign(77),false);
  const t3=mk('等待残血补尾刀',false,-1);t3.run(t3.scanMobs);
  assert.equal(t3.st().allow,0);assert.equal(t3.ign(77),true,'血量未知也必须忽略');assert.equal(t3.st().block,'血量未知');
  // 5) 判定距离可填：超出判定距离的首领不参与裁决（默认 14）
  const d1=mk('优先攻击',false,10,{dist:5,bossDist:6});assert.equal(d1.run(d1.scanMobs).want,0,'超出判定距离不得参与裁决');
  const d2=mk('优先攻击',false,10,{dist:14,bossDist:14});assert.equal(d2.run(d2.scanMobs).want,77,'判定距离必须按可填值生效');
  // 6) 首领识别统一判据：怪物库命中且首领值大于 0（字符串数字同样认）
  const b1=mk('优先攻击',false,10);
  assert.equal(b1.isBossMid(2001),true);assert.equal(b1.isBossMid('2001'),true);assert.equal(b1.isBossMid(9999),false);assert.equal(b1.isBossMid(4242),false);
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
  assert.equal(ctx.A.set('owner-one',{mid:3001,gid:7}).ok,true,'A3：非 BOSS 的活怪（type=5 且 mid/gid 匹配）也必须能作为租约目标');assert.equal(packets.length,0,'V2.38.13：非 DOJO_OWNER 的代打目标绝不同步内挂 ONLYTARGET（代打由助手自己选目标）');
  entities.length=0;entities.push(mob(77,2001));
  assert.equal(ctx.A.set('owner-one',{mid:2001,gid:77}).ok,true);assert.equal(packets.length,0,'切换代打目标同样一个内挂包都不发');
  entities[0].isDeath=true;ctx.A.tick();assert.equal(ctx.A.get(),null);assert.equal(packets.length,0,'非 DOJO_OWNER 目标死亡清理也不得发内挂包');
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
  const dc={Date:{now:()=>now},apiBattleAttackAt:0,zRunning:false,apiCombat:null,apiLease:{owner:'builtin-dojo',scopes:['battle'],battle:{state:'pending-on'}},apiBattleTarget:{owner:'builtin-dojo',mid:2,gid:8},apiBattleTargetEntity:()=>({gid:8}),zAttack:()=>calls++};
  vm.createContext(dc);vm.runInContext(drive+';this.run=apiBattleDrive',dc);dc.run();dc.run();assert.equal(calls,1);now=1250;dc.run();assert.equal(calls,2);dc.zRunning=true;now=1500;dc.run();assert.equal(calls,2);dc.apiCombat={owner:'builtin-dojo'};dc.zRunning=false;now=1750;dc.run();assert.equal(calls,2,'A5：代打期间 apiBattleDrive 必须让位（不得双份出手）');
  const atk=extract('  function zAttack() {','  // 技能行统一序列化'),boss={GID:8,objecttype:5,_job:2,position:[20,20],life:{hp:10}},normal={GID:9,objecttype:5,_job:3,position:[1,1],life:{hp:10}},seen=[];let walks=0;
  const ac={CLIENT:{SS:{Entity:{life:{hp:100},position:[0,0]}}},clientReady:()=>true,escapePending:()=>false,updateHpWatch(){},sitMaintain(){},isSitting:()=>false,window:{},requireDB:()=>({forEach(fn){seen.push('scan');[boss,normal].forEach(fn);}}),$id:id=>({value:id==='dsh-z-range'?'12':id==='dsh-z-pmrange'?'2':id==='dsh-z-mgrange'?'9':'0',checked:true}),calcAtkRange:()=>2,npHuntMode:()=> 'np',isHybrid:()=>false,takeoverDist:()=>12,lockList:{3:1},zHpWatch:{lastHitAt:0},zLock:{gid:null,name:'',dist:null,done:false,reactive:false},apiBattleTarget:{owner:'builtin-dojo',mid:2,gid:8},apiBattleTargetEntity:()=>({gid:8,mid:2,name:'Boss'}),zEntOf:g=>Number(g)===8?boss:Number(g)===9?normal:null,zRangeDist:(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])),gidInt:Number,zLockCounts:{},zCastIdx:0,zWalk:()=>{walks++;},zBossDecide:()=>null,zBossIgnoredGid:()=>false,isBossMid:()=>false,zBossWantGid:0,defSnap:{isCombatMap:true,inFight:true},zMon:{},zAtkWhy:'',Date:{now:()=>1000},Object,Math,Number,String,parseInt,parseFloat,isFinite};
  vm.createContext(ac);vm.runInContext(atk+';this.run=zAttack',ac);ac.run();assert.equal(ac.zLock.gid,8);assert.equal(ac.zAtkWhy,'临时目标在射程外');assert.ok(seen.length<=1,'不得进入普通候选扫描接管');assert.equal(walks,1,'A4：临时目标在射程外必须先调用 zWalk() 由助手自己走近再 return（不再直接 return）');
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
    const ctx={gearBusy:false,gearWatchdog:null,gearPreset:()=>({name:'套装',eq}),gearInGame:()=>true,setStatus(){},gearLog(){},gearReadEquipped:()=>({ok:true,complete:true,slots:{2:{itid:999,refine:0,cards:[],idx:5,name:'旧双手',wearLocation:34,instanceKey:'idx:5'},32:{itid:999,refine:0,cards:[],idx:5,name:'旧双手',wearLocation:34,instanceKey:'idx:5'}}}),gearSigEqual:(a,b)=>!!(a&&b&&a.itid===b.itid&&(a.cards||[]).join(',')===(b.cards||[]).join(',')),gearFindInvItem:(id,r,c,res)=>inventory.find(x=>x.ITID===id&&!res[x.index])||null,gearSlotName:m=>'槽'+m,gearAfterDeck(){},setTimeout:fn=>{fn();return 1},clearTimeout(){},GEAR_SLOTS:[{m:2},{m:32},{m:8},{m:128}],CLIENT:{PS:{CZ:{REQ_TAKEOFF_EQUIP:function(){this.op='off'},REQ_WEAR_EQUIP:function(){this.op='on'}}},NM:{sendPacket:p=>packets.push({op:p.op,index:p.index,wearLocation:p.wearLocation})}},czp:name=>ctx.CLIENT.PS.CZ[name],Number,Array,Object,isFinite};
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
  const ctx={Number,String,Object,Array,JSON,Math,isFinite,document:{querySelector:()=>null},requireDB:()=>null,require:()=>null,activeProfileKey:()=>'abc',profileTrusted:()=>true,
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
    activeProfileKey:()=>profile,profileTrusted:()=>true,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))}};
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
    const ctx = { apiLease: lease, apiCombat: null, apiCombatStop() {}, npBattleState: () => npState, npZeroBattle: (r) => { zeros.push(r); return 'sent'; },
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
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], PRODUCT_VERSION, name + ' @version 必须是 ' + PRODUCT_VERSION);
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], PRODUCT_VERSION, name + ' VER 必须是 ' + PRODUCT_VERSION);
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
    assert.ok(p.statuses.indexOf('游戏画面已就绪') >= 0, name + ' 就绪时必须照旧写状态栏');
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
    assert.ok(src.includes('// @version      ' + PRODUCT_VERSION) && src.includes('var VER = "' + PRODUCT_VERSION + '";'), name + ' 版本必须与产品文件 @version 一致（V2.38.9 批次：直发传送 + 审计 F1/F2/F4）');
    assert.ok(src.includes('// ---------------- V2.38.9 变更摘要 ----------------'), name + ' 必须有 V2.38.9 变更摘要（视角控制 + 审计收尾）');
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
  assert.equal(pre.allowed('ch123'), false, name + ' V2.38.6 未识别必须一律不采纳（fail-closed）');
  pre.kvRefreshProfile();
  assert.equal(pre.activeCharKey, 'default', name + ' V2.38.6 未识别不得被中继切档');
  assert.equal(pre.store.get('dsh_ro_last_active'), 'ch123', name + ' V2.38.6 未识别不得回写 dsh_ro_last_active');
  const oldOk = mk({ profiles: { old: { gid: 2007018, name: '真名' } }, activeCharKey: 'default', ak: 'old', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939, display: { name: '真名' } } } } });
  assert.equal(oldOk.allowed('old'), true, name + ' V2.38.6 老档无 charId 时按「角色名相同」采纳');
  const oldNo = mk({ profiles: { old: { gid: 2007018, name: '别人' } }, activeCharKey: 'default', ak: 'old', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939, display: { name: '真名' } } } } });
  assert.equal(oldNo.allowed('old'), false, name + ' V2.38.6 老档名字不符必须拒绝（本服实体 GID = 账号级 AID，比 GID 恒等于同账号）');
  const oldGidOnly = mk({ profiles: { old: { gid: 2007018 } }, activeCharKey: 'default', ak: 'old', CLIENT: { SS: { GID: 999, Entity: { GID: 2007018.939 } } } });
  assert.equal(oldGidOnly.allowed('old'), false, name + ' V2.38.6 老档只有 gid、拿不到名字时必须拒绝（旧「gid 相同即采纳」已删）');
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
    tpTeleport: (x) => { teleports.push(x); return true; }, setStatus: (s) => statuses.push(s), czp: (n) => ctx.CLIENT.PS.CZ[n],
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
    gearReadEquipped: () => ({ ok: true, n: 0, slots: {}, why: '', complete: true }),
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
    gearReadEquipped: () => state.eq || { ok: true, n: 0, slots: {}, why: '', complete: true },
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
// ================= V2.38.14：自动续箭不再把插在武器槽上的卡片当武器 / 卡片永远不算箭矢 =================
// 统一桩：物品表（含「系列=卡片」）+ 装备组件 + 背包；行为级真跑读取与换箭函数，只看行为不看源码字面量。
const V23814_ITEMS = {
  4094: { identifiedDisplayName: '邪骸弓箭手卡片', Type: 6, ClassNum: 0 },
  1701: { identifiedDisplayName: '十字长弓', Type: 4, ClassNum: 11 },
  1101: { identifiedDisplayName: '双刃短剑', Type: 4, ClassNum: 1 },
  1751: { identifiedDisplayName: '火箭矢', Type: 10, ClassNum: 0 },
  1750: { identifiedDisplayName: '普通箭矢', Type: 10, ClassNum: 0 },
};
const V23814_WT = { 1701: 11, 1101: 1, 4094: 0, 1751: 0, 1750: 0 };
function v23814ArrowVm(src, opt) {
  opt = opt || {};
  const packets = [], logEl = { textContent: '' };
  const items = Object.assign({}, V23814_ITEMS, opt.items || {});
  const wtMap = Object.assign({}, V23814_WT, opt.wt || {});
  const db = {
    getWeaponType: (id) => (wtMap[Number(id)] != null ? wtMap[Number(id)] : 0),
    getItemInfo: (id) => (items[Number(id)] || null),
  };
  const bag = opt.bag || [];
  const ctx = {
    Number, String, Object, Array, JSON, Math, isFinite, parseInt, console, Date,
    ARROW_PLAIN_ITID: 1750, ARROW_MAGIC_QUIVER: 2000030, ARROW_LOW_AMMO: 50,
    arrowRules: { enabled: true, defaultItid: 1750, byMid: {}, byElem: {} },
    arrowTarget: null, externalAutomationOwns: () => false, arrowSelfWanted: () => false,
    clientReady: () => true,
    $id: (id) => (id === 'dsh-arrowen' ? { checked: true } : (id === 'dsh-arrowlog' ? logEl : null)),
    arrowPos: (v) => { const n = Number(v); return (isFinite(n) && n > 0) ? n : null; },
    arrowUseQuiver: () => null, useItemById: () => false,
    arrowItemName: (i) => '箭' + i,
    getItemName: (i) => (items[Number(i)] ? items[Number(i)].identifiedDisplayName : 'IT' + i),
    itipDB: () => db,
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
  vm.runInContext(v2384ArrowCode(src) + ';this.A={tickArrow,readEquippedAmmo,readEquippedWeaponType,equippedWeaponItid,readBagWorn,readBagAmmo,arrowIsCard,arrowWeaponCandidates,arrowBagWornCands,arrowGearPktStale};', ctx);
  return ctx;
}
// 把「当前装备」整表快照塞进装备读取的首路（包流）：装备槽这一路读到的是卡片
function v23814PktWeapon(c, itid, name) {
  c.gearPkt.slots = { 2: { itid: itid, name: name } };
  c.gearPkt.complete = true; c.gearPkt.n = 1; c.gearPkt.at = Date.now();
}
function v23814CheckA(src, name) {
  const weapon = { ITID: 1701, index: 5, location: 2 };
  const ammo = { ITID: 1751, index: 4, count: 49, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? weapon : (m === 32768 ? ammo : 0)) };
  const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
  v23814PktWeapon(c, 4094, '邪骸弓箭手卡片');
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.wt, 11, name + ' 手持的是弓 → 武器类型必须是 11，实际=' + wq.wt);
  assert.equal(wq.itid, 1701, name + ' 必须跳过卡片采用真弓 1701，实际=' + wq.itid);
  assert.ok(String(wq.why).indexOf('isInEquipList') >= 0, name + ' 必须采用给出真弓的那条候选，实际=' + wq.why);
  c.A.tickArrow();
  assert.deepEqual(c.packets, [{ index: 7, wearLocation: 32768 }], name + ' 认出真弓后必须照常换箭（存量 49 < 50）');
}
function v23814CheckB(src, name) {
  const card = { ITID: 4094, index: 9, location: 2 };
  const ammo = { ITID: 1751, index: 4, count: 10, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? card : (m === 32768 ? ammo : 0)) };
  const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.wt, -1, name + ' 只有卡片时必须算「没认出武器」，实际=' + wq.wt);
  assert.equal(wq.itid, null, name + ' 绝不能把卡片 4094 当手持武器返回，实际=' + wq.itid);
  c.A.tickArrow();
  assert.equal(c.packets.length, 0, name + ' 没认出武器必须零动作（不换箭、不发任何请求）');
  assert.ok(String(c.logEl.textContent).indexOf('没认出当前手持的武器') >= 0, name + ' 必须给玩家能看懂的提示，实际=' + c.logEl.textContent);
  assert.ok(String(c.logEl.textContent).indexOf('邪骸弓箭手卡片') >= 0, name + ' 提示必须带上最近读到的物品名，实际=' + c.logEl.textContent);
  assert.doesNotMatch(String(c.logEl.textContent), /发包|字段|客户端|接口/, name + ' 提示不得出现实现词');
}
function v23814CheckB2(src, name) {
  const sword = { ITID: 1101, index: 5, location: 2 };
  const ammo = { ITID: 1751, index: 4, count: 10, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? sword : (m === 32768 ? ammo : 0)) };
  const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.itid, null, name + ' 不是弓/乐器/鞭子的手持武器必须判成「没认出武器」，实际=' + JSON.stringify(wq));
  assert.equal(wq.wt, -1, name + ' 非弓/乐器/鞭子的类型必须是 -1，实际=' + wq.wt);
  c.A.tickArrow();
  assert.equal(c.packets.length, 0, name + ' 非弓/乐器/鞭子必须零动作');
  assert.ok(String(c.logEl.textContent).indexOf('没认出当前手持的武器') >= 0, name + ' 必须给出「没认出武器」提示，实际=' + c.logEl.textContent);
  assert.ok(String(c.logEl.textContent).indexOf('双刃短剑') >= 0, name + ' 提示必须带上最近读到的物品名，实际=' + c.logEl.textContent);
}
function v23814CheckC(src, name) {
  const card = { ITID: 4094, index: 9, count: 1, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 32768 ? card : 0) };
  const bag = [{ index: 9, ITID: 4094, count: 1, type: 6, WearState: 32768 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
  assert.equal(c.A.arrowIsCard(4094), true, name + ' 系列=卡片 必须被认成卡片');
  assert.equal(c.A.arrowIsCard(1751), false, name + ' 真箭矢不能被误判成卡片');
  assert.equal(c.A.readEquippedAmmo(), null, name + ' 箭矢槽上是卡片时必须当作「没有当前箭矢」，绝不能返回卡片');
  assert.equal(c.A.readBagAmmo(), null, name + ' 背包兜底读到卡片时同样必须当作「没有当前箭矢」');
  const arrow = { ITID: 1751, index: 4, count: 20, location: 32768 };
  const c2 = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? { isInEquipList: (m) => (m === 32768 ? arrow : 0) } : null) });
  assert.equal(JSON.stringify(c2.A.readEquippedAmmo()), JSON.stringify({ index: 4, count: 20, itid: 1751, src: 'isInEquipList' }), name + ' 真箭矢必须照旧原样读出（不得被卡片守卫误伤）');
}
function v23814CheckD(src, name) {
  const card = { ITID: 4094, index: 9, location: 2 };
  const ammo = { ITID: 1751, index: 4, count: 10, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? card : (m === 32768 ? ammo : 0)) };
  const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag, wt: { 4094: 11 } });
  assert.equal(c.A.arrowIsCard(4094), true, name + ' 系列=卡片 优先于武器类型值');
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.itid, null, name + ' 卡片绝不能被当成本身手持的武器，实际=' + JSON.stringify(wq));
  assert.equal(wq.wt, -1, name + ' 必须判成没认出武器，实际=' + wq.wt);
  c.A.tickArrow();
  assert.equal(c.packets.length, 0, name + ' 只读到卡片必须零动作');
  assert.ok(String(c.logEl.textContent).indexOf('没认出当前手持的武器') >= 0, name + ' 必须给「没认出武器」提示，实际=' + c.logEl.textContent);
}

// ===== V2.38.14-审计修正（MEDIUM/LOW-MEDIUM）用例桩 =====
// 把包流整表快照写成「刚收到整表」的干净状态：changedAt 与整表同刻、dirty 为空 → 不算陈旧。
function v23814PktFresh(c, slots) {
  c.gearPkt.slots = slots;
  c.gearPkt.byIndex = {};
  c.gearPkt.n = Object.keys(slots).length;
  c.gearPkt.complete = c.gearPkt.n > 0;
  c.gearPkt.at = Date.now();
  c.gearPkt.changedAt = c.gearPkt.at;
  c.gearPkt.dirty = {};
  return c.gearPkt.at;
}
// 整表之后来一条穿脱确认：只标 dirty + changedAt、不改槽位（方案 E4：等整表校正）。
function v23814PktAck(c, idx, at) {
  c.gearPkt.changedAt = at;
  c.gearPkt.dirty[idx] = { at: at, kind: 'wear', loc: 2, raw: 1, ok: true, op: 170 };
}
// 审计修正（MEDIUM）：整表给出「旧武器（剑 1101，类型 1）」，其后收到穿脱确认（dirty 晚于整表）；
//   实时路（EQ.isInEquipList）给出换武器之后的弓 1701 → 陈旧快照必须让位。
function v23814CheckStale(src, name) {
  const bow = { ITID: 1701, index: 6, location: 2 };
  const ammo = { ITID: 1751, index: 4, count: 49, location: 32768 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? bow : (m === 32768 ? ammo : 0)) };
  const bag = [{ index: 7, ITID: 1751, count: 30, type: 10 }];
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null), bag });
  const at = v23814PktFresh(c, { 2: { itid: 1101, name: '双刃短剑' } });
  assert.equal(c.A.arrowGearPktStale(), false, name + ' 前置：刚收到整表（无 dirty、changedAt=整表时刻）不得算陈旧');
  v23814PktAck(c, 7, at + 1);
  assert.equal(c.A.arrowGearPktStale(), true, name + ' 整表之后出现 dirty 标记（换武器）→ 包流快照必须判成陈旧');
  const cands = c.A.arrowWeaponCandidates();
  assert.ok(!cands.some((x) => Number(x.itid) === 1101), name + ' 陈旧包流快照绝不能再作为候选（否则换武器后仍按旧武器决策、继续消耗箭矢），实际候选=' + JSON.stringify(cands));
  assert.ok(cands.some((x) => Number(x.itid) === 1701), name + ' 实时路给出的新弓必须在候选里，实际候选=' + JSON.stringify(cands));
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.wt, 11, name + ' 陈旧快照必须让位给实时路 → 武器类型必须是 11，实际=' + wq.wt);
  assert.equal(wq.itid, 1701, name + ' 必须采用实时路的弓 1701，实际=' + wq.itid);
  assert.ok(String(wq.why).indexOf('isInEquipList') >= 0, name + ' 必须走实时路，实际=' + wq.why);
  c.A.tickArrow();
  assert.deepEqual(c.packets, [{ index: 7, wearLocation: 32768 }], name + ' 认出真弓后必须照常换箭（存量 49 < 50）');
}
// 陈旧判定的口径已定稿：只认「dirty 晚于整表」这一个信号；changedAt 晚于整表必须「不算」陈旧（反向红线）。
function v23814CheckStaleDirtyOnly(src, name) {
  const c = v23814ArrowVm(src, { uiComp: () => null });
  const at = v23814PktFresh(c, { 2: { itid: 1101, name: '双刃短剑' } });
  v23814PktAck(c, 7, at + 1);
  c.gearPkt.changedAt = at; // 只留「dirty 晚于整表」这一个信号
  assert.equal(c.A.arrowGearPktStale(), true, name + ' 只有 dirty 标记晚于整表（changedAt 与整表同刻）也必须算陈旧');
  assert.ok(!c.A.arrowWeaponCandidates().some((x) => Number(x.itid) === 1101), name + ' 只有 dirty 信号的陈旧快照同样不得作为候选');
}
// 反向定稿：changedAt 会被分流会话结束（gearPktParseSess 结束那一拍）抬高，移动端每次背包整表 burst 结束后都会出现；
//   若把它也算成陈旧，包流（移动端唯一可用的路）会被整体跳过 → 过度判陈旧。故：只 changedAt 晚于整表必须「不算」陈旧。
function v23814CheckStaleChangedOnly(src, name) {
  const c = v23814ArrowVm(src, { uiComp: () => null });
  const at = v23814PktFresh(c, { 2: { itid: 1101, name: '双刃短剑' } });
  c.gearPkt.changedAt = at + 1; // 分流会话结束晚于整表（dirty 仍为空、槽位未变）
  assert.equal(c.A.arrowGearPktStale(), false, name + ' 仅分流会话结束（dirty 为空、changedAt 晚于整表）不得算陈旧');
  assert.ok(c.A.arrowWeaponCandidates().some((x) => Number(x.itid) === 1101), name + ' 不得陈旧的包流快照必须仍作候选（changedAt 不得误杀手机端唯一可用的路）');
}
// 反例方向：非陈旧的包流快照仍然可用（手机端组件不可达时唯一可行路线，绝不能整体关掉）。
function v23814CheckFresh(src, name) {
  const c = v23814ArrowVm(src, { uiComp: () => null });
  v23814PktFresh(c, { 2: { itid: 1701, name: '十字长弓' } });
  assert.equal(c.A.arrowGearPktStale(), false, name + ' 刚收到整表、无 dirty、changedAt=整表时刻不得算陈旧');
  const cands = c.A.arrowWeaponCandidates();
  assert.ok(cands.some((x) => Number(x.itid) === 1701), name + ' 非陈旧的包流快照仍必须是候选（手机端唯一可行路线），实际候选=' + JSON.stringify(cands));
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.wt, 11, name + ' 非陈旧快照必须照旧读出弓（证明不是把包流整体关掉），实际=' + wq.wt);
  assert.equal(wq.itid, 1701, name + ' 必须采用包流快照里的弓 1701，实际=' + wq.itid);
  assert.ok(String(wq.why).indexOf('packet') >= 0, name + ' 必须走包流快照路线，实际=' + wq.why);
}
// 「实时路优先、包流兜底」的红线：即使包流快照不陈旧，也绝不允许它抢在实时路前面决策。
function v23814CheckRealtimeFirst(src, name) {
  const bow = { ITID: 1701, index: 6, location: 2 };
  const EQ = { name: 'Equipment', isInEquipList: (m) => (m === 2 ? bow : 0) };
  const c = v23814ArrowVm(src, { uiComp: (n) => (n === 'Equipment' ? EQ : null) });
  v23814PktFresh(c, { 2: { itid: 1101, name: '双刃短剑' } }); // 快照不陈旧，但内容与实时路不一致
  assert.equal(c.A.arrowGearPktStale(), false, name + ' 前置：这份快照不算陈旧');
  const cands = c.A.arrowWeaponCandidates().map((x) => Number(x.itid));
  assert.equal(cands[0], 1701, name + ' 候选表第一位必须是实时路（包流只作兜底），实际候选=' + JSON.stringify(cands));
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.itid, 1701, name + ' 实时路必须优先于（不陈旧的）包流快照，实际=' + JSON.stringify(wq));
  assert.equal(wq.wt, 11, name + ' 实时路的弓类型必须是 11，实际=' + wq.wt);
  assert.ok(String(wq.why).indexOf('isInEquipList') >= 0, name + ' 必须走实时路，实际=' + wq.why);
}
// 审计修正（LOW-MEDIUM）：背包兜底必须枚举全部穿戴命中项（第一条是卡片、第二条才是真武器）。
function v23814CheckBagMulti(src, name) {
  const bag = [
    { index: 1, ITID: 4094, count: 1, type: 6, WearState: 2 }, // 卡片排在真武器前面
    { index: 2, ITID: 1701, count: 1, type: 4, WearState: 2 }, // 真弓
  ];
  const c = v23814ArrowVm(src, { uiComp: () => null, bag }); // 其它路全部为空
  const cands = Array.from(c.A.arrowBagWornCands(2), (x) => Number(x.itid)); // 跨 realm：必须用宿主 Array.from 收成宿主数组
  assert.deepEqual(cands, [4094, 1701], name + ' 背包候选必须按背包顺序枚举全部命中项，实际=' + JSON.stringify(cands));
  assert.equal(c.A.readBagWorn(2).ITID, 4094, name + ' readBagWorn 保持原样（其它调用方共用，仍只返回第一条）');
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.itid, 1701, name + ' 背包兜底必须跳过第一条的卡片、采用第二条的真弓 1701，实际=' + JSON.stringify(wq));
  assert.equal(wq.wt, 11, name + ' 真弓类型必须是 11，实际=' + wq.wt);
  assert.equal(wq.why, 'getWeaponType/背包穿戴标记', name + ' 必须走背包穿戴标记兜底，实际=' + wq.why);
}

function v23814Mutate(src, from, to, label) {
  const t = lfSrc(src);
  assert.equal(t.split(from).length - 1, 1, label + ' 变异锚点必须唯一: ' + from.slice(0, 60));
  return t.split(from).join(to);
}
// 期望失败必须锁定到「哪一条断言」：只断言「抛了异常」会让语法错误也通过（审计 LOW）。
function v23814ExpectRed(run, src, label, need) {
  assert.ok(need != null && String(need).length > 0, label + ' 必须写明期望被哪条断言抓到（禁止只断言「抛了异常」）');
  let msg = '', nm = '';
  try { run(src, label); } catch (e) { msg = String((e && e.message) || e); nm = String((e && e.name) || ''); }
  assert.ok(msg, label + ' 必须让对应用例变红，但当前未变红（说明该红线是覆盖空洞）');
  assert.notEqual(nm, 'SyntaxError', label + ' 变异把源码改成了语法错误（假红），必须改成行为级变异：' + msg.slice(0, 140));
  assert.match(msg, need instanceof RegExp ? need : new RegExp(String(need)), label + ' 必须被指定断言抓到：期望匹配 ' + need + '，实际=' + msg.slice(0, 160));
  return msg;
}

test('V2.38.14 换箭修复 a：装备槽读到卡片（4094）而另一条路给出弓（1701）→ 必须跳过卡片采用弓（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckA(src, name);
});
test('V2.38.14 换箭修复 b：装备槽只读到卡片 → 必须报「没认出武器」且一拍都不动作（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckB(src, name);
});
test('V2.38.14 换箭修复 b2：手持普通武器（非 11/13/14）→ 必须只提示、零动作（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckB2(src, name);
});
test('V2.38.14 换箭修复 c：卡片永远不算箭矢（箭矢槽读取与背包兜底两条路）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckC(src, name);
});
test('V2.38.14 换箭修复 d：卡片判据优先于武器类型（类型值看着像弓也必须跳过）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckD(src, name);
});
test('V2.38.14 换箭修复 e：陈旧包流快照必须让位给实时路（换武器后不得再按旧武器决策）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckStale(src, name);
});
test('V2.38.14 换箭修复 e2：陈旧判定只认 dirty（dirty 晚于整表必须算陈旧；仅 changedAt 晚于整表必须不算）（VM）', () => {
  for (const [name, src] of splitSources) { v23814CheckStaleDirtyOnly(src, name); v23814CheckStaleChangedOnly(src, name); }
});
test('V2.38.14 换箭修复 e3：非陈旧的包流快照仍可用（无实时路时手机端靠它，不得整体关掉）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckFresh(src, name);
});
test('V2.38.14 换箭修复 e4：实时路必须优先于包流快照（候选表第一位是实时路）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckRealtimeFirst(src, name);
});
test('V2.38.14 换箭修复 f：背包兜底必须枚举全部穿戴命中项（第一条是卡片也要读到第二条真武器）（VM）', () => {
  for (const [name, src] of splitSources) v23814CheckBagMulti(src, name);
});

test('V2.38.14 变异矩阵：卡片守卫 / 弓乐器鞭子过滤 / 陈旧判定（只认 dirty 单一信号）/ 候选顺序 / 背包兜底 → 必须各自被「指定断言」杀死（stable 与 exp 各自独立变异）', () => {
  const MUTS = [
    {
      label: '变异①（撤掉卡片守卫）',
      from: '      if (Number(info.Type) === 6) return true; // 系列 = 卡片\n      var cn = (info.ClassNum == null) ? NaN : Number(info.ClassNum);\n      if (cn === 0 && /卡片$/.test(arrowItemNameOf(itid))) return true;',
      to: '      return false; // 变异①：撤掉卡片守卫',
      cases: [
        ['(c)', (s, n) => v23814CheckC(s, n), /系列=卡片 必须被认成卡片/],
        ['(d)', (s, n) => v23814CheckD(s, n), /系列=卡片 优先于武器类型值/],
      ],
    },
    {
      label: '变异②（撤掉 11/13/14 过滤）',
      from: '        if (wt === 11 || wt === 13 || wt === 14) return { itid: itid, wt: wt, src: cands[i].src, name: last.name };',
      to: '        return { itid: itid, wt: wt, src: cands[i].src, name: last.name }; // 变异②：撤掉 11/13/14 过滤',
      cases: [['(b2)', (s, n) => v23814CheckB2(s, n), /不是弓\/乐器\/鞭子的手持武器必须判成/]],
    },
    {
      label: '变异③（撤掉陈旧判定调用点：陈旧包流快照照用）',
      from: '      if (!arrowGearPktStale() && typeof gearReadEquipped === "function") {',
      to: '      if (typeof gearReadEquipped === "function") { // 变异③：撤掉陈旧判定',
      cases: [['(e)', (s, n) => v23814CheckStale(s, n), /陈旧包流快照绝不能再作为候选/], ['(e5 陈旧+无实时路)', (s, n) => v23815CheckStaleNoRoute(s, n), /陈旧快照且没有任何实时路时必须判成没认出武器/]],
    },
    {
      label: '变异④（陈旧判定恒不陈旧）',
      from: '      if (typeof gearPkt === "undefined" || !gearPkt) return false;',
      to: '      if (true) return false; // 变异④：陈旧判定恒不陈旧',
      cases: [
        ['(e)', (s, n) => v23814CheckStale(s, n), /包流快照必须判成陈旧/],
        ['(e2 dirty)', (s, n) => v23814CheckStaleDirtyOnly(s, n), /只有 dirty 标记晚于整表/],
      ],
    },
    {
      label: '变异⑤（把 changedAt 也算进陈旧）',
      from: '      if (!(at > 0)) return false; // 没收到过整表：不是「旧」是「没有」，快照自身按 complete/n 拒绝\n',
      to: '      if (!(at > 0)) return false; // 没收到过整表：不是「旧」是「没有」，快照自身按 complete/n 拒绝\n      if ((Number(gearPkt.changedAt) || 0) > at) return true; // 变异⑤：把 changedAt 也算进陈旧\n',
      cases: [['(e2 changed)', (s, n) => v23814CheckStaleChangedOnly(s, n), /仅分流会话结束.*不得算陈旧/]],
    },
    {
      label: '变异⑥（撤掉 dirty 陈旧信号）',
      from: '      var dirty = gearPkt.dirty;\n      if (dirty) {\n        for (var k in dirty) {\n          if (!Object.prototype.hasOwnProperty.call(dirty, k)) continue;\n          var d = dirty[k];\n          if (d && (Number(d.at) || 0) > at) return true;\n        }\n      }',
      to: '      var dirty = null; // 变异⑥：撤掉 dirty 陈旧信号',
      cases: [['(e2 dirty)', (s, n) => v23814CheckStaleDirtyOnly(s, n), /只有 dirty 标记晚于整表/]],
    },
    {
      label: '变异⑦（陈旧判定过激：一律视为陈旧）',
      from: '      if (typeof gearPkt === "undefined" || !gearPkt) return false;\n      var at = Number(gearPkt.at) || 0;',
      to: '      if (typeof gearPkt === "undefined" || !gearPkt) return false;\n      var at = Number(gearPkt.at) || 0;\n      return true; // 变异⑦：一律视为陈旧（changedAt 信号已撤，旧锚点 at=1 不再产生陈旧）',
      cases: [['(e3)', (s, n) => v23814CheckFresh(s, n), /不得算陈旧/]],
    },
    {
      label: '变异⑧（包流抢到实时路前面）',
      from: '        if (sl && sl.itid != null) out.push({ itid: Number(sl.itid), src: rt || "装备读取", name: sl.name });',
      to: '        if (sl && sl.itid != null) out.unshift({ itid: Number(sl.itid), src: rt || "装备读取", name: sl.name }); // 变异⑧：包流抢到实时路前面',
      cases: [['(e4)', (s, n) => v23814CheckRealtimeFirst(s, n), /候选表第一位必须是实时路/]],
    },
    {
      label: '变异⑩（枚举器自身只取第一条命中项）',
      from: '        out.push({ itid: id, src: "背包穿戴标记", name: it.name });',
      to: '        out.push({ itid: id, src: "背包穿戴标记", name: it.name }); return out; // 变异⑩：只取第一条命中项',
      cases: [['(f)', (s, n) => v23814CheckBagMulti(s, n), /背包候选必须按背包顺序枚举全部命中项/]],
    },
    {
      label: '变异⑨（背包兜底退回「只取第一条」）',
      from: '      var bagCands = arrowBagWornCands(2);',
      to: '      var _one = readBagWorn(2); // 变异⑨：背包兜底只取第一条（旧行为）\n      var bagCands = _one ? [{ itid: (_one.ITID != null ? _one.ITID : _one.itemid), src: "背包穿戴标记" }] : [];',
      cases: [['(f)', (s, n) => v23814CheckBagMulti(s, n), /背包兜底必须跳过第一条的卡片/]],
    },
  ];
  const rows = [];
  for (const [srcName, rawSrc] of splitSources) {
    for (const m of MUTS) {
      const mutated = v23814Mutate(rawSrc, m.from, m.to, srcName + ' · ' + m.label);
      for (const [caseName, run, need] of m.cases) {
        const tag = srcName + ' · ' + m.label + ' → 期望红/实际红，被 ' + caseName + ' 抓到';
        const msg = v23814ExpectRed(run, mutated, tag, need);
        rows.push(tag + ' —— ' + msg.replace(/\s+/g, ' ').slice(0, 96));
      }
    }
  }
  const want = splitSources.length * MUTS.reduce((s, m) => s + m.cases.length, 0);
  assert.equal(rows.length, want, '变异矩阵必须逐条真跑（期望 ' + want + ' 条）');
  for (const r of rows) console.log('[V2.38.14 变异矩阵] ' + r);
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
    assert.ok(t.includes('      var _c = gidInt(CLIENT.SS && CLIENT.SS.GID);'), name + ' selfCharId 必须只取 SS.GID');
    assert.ok(t.includes('      return gidInt(pktCharId); // V2.38.6'), name + ' selfCharId 的兜底只许是入站包 char_id（V2.38.6）');
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
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], PRODUCT_VERSION, name + ' @version 必须与产品文件一致');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], PRODUCT_VERSION, name + ' VER 必须与产品文件一致');
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
  const out = s.replace('      return gidInt(pktCharId); // V2.38.6：客户端对象拿不到时用入站包解析出的 char_id（手机端，见下方 pkt 块）',
    '      var ent = CLIENT.SS && CLIENT.SS.Entity;\n      return gidInt(ent && ent.GID); // 变异②：退回实体 GID（账号级 AID）');
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
    zBossIgnoredGid: o.ignored || (() => false), isBossMid: o.isBossMid || (() => false), zBossWantGid: o.bossWant || 0,
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
  const ctx = { PROF_CONTROLS: controls, $id: (id) => els[id] || null, saved: savedState, saveSaved: () => {}, profUIApplied: true, activeProfileKey: () => 'ch1', profileTrusted: () => true, profileHarvestable: () => false, lastTrustedKey: 'ch1', profWriteGuard: () => true };
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
    zBossIgnoredGid: o.ignored || (() => false), isBossMid: o.isBossMid || (() => false), zBossWantGid: o.bossWant || 0,
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
  assert.match(a1.st(), /游戏自动寻路进行中/, tag + ' 状态栏必须写明「游戏自动寻路进行中…仅扫描」');
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
test('V2.38.4 走路批次 a：外部游戏自动寻路进行中 → 只扫不发（直走/换点/贴近/反向走计数 0）+ 结束后记自然走完/被中断（VM）', () => {
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
  assert.match(h3.st(), /游戏自动寻路进行中/, tag + ' 名单外的怪仍然只扫不发');
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
  assert.ok(!/游戏自动寻路进行中/.test(String(h.st())), tag + ' 自己刚移动过不得显示游戏自动寻路进行中');
  assert.equal(h.state.lastSelfMoveAt, T, tag + ' 助手自己发位移必须打时间戳');
  h.tick(2000);
  assert.equal(h.moves.length, 1, tag + ' 超过 1500ms 且客户端仍有路线 → 转为外部路线，只扫不发');
  assert.match(h.st(), /游戏自动寻路进行中/, tag + ' 超时后必须识别为外部路线');
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


// ================= V2.38.9：手机页（r=mn）视角控制（电脑鼠标拖动 / 滚轮 / 按钮）=================
const VC_FILES_SRC=[['stable','ro-assist.user.js'],['exp','ro-assist-exp.user.js']].map(([n,f])=>[n,fs.readFileSync(new URL('../'+f,import.meta.url),'utf8')]);
function vcBody(src){
  const a=src.indexOf('      // === VC_BEGIN ==='),b=src.indexOf('      // === VC_END ===',a);
  assert.ok(a>=0&&b>a,'视角控制块必须就位（VC_BEGIN/VC_END）');
  const head=src.slice(Math.max(0,a-60),a).replace(/\r/g,'');
  assert.ok(/if \(IS_MN\) \{\n\s*$/.test(head),'视角控制块必须挂在 if (IS_MN) 之内（非手机页不得强加控件）:'+JSON.stringify(head.slice(-24)));
  return src.slice(a,b+'      // === VC_END ==='.length).split('\r\n').join('\n');   // 归一化成 LF：变异锚点与文件 EOL 无关
}
function vcEl(tag,sink){
  const e={tagName:String(tag||'div').toUpperCase(),children:[],style:{},handlers:{},attrs:{},id:'',className:'',title:'',textContent:'',parentNode:null};
  e.appendChild=c=>{e.children.push(c);c.parentNode=e;return c;};
  e.setAttribute=(k,v)=>{e.attrs[k]=String(v);};
  e.addEventListener=(t,f)=>{(e.handlers[t]=e.handlers[t]||[]).push(f);};
  e.fire=(t,ev)=>{(e.handlers[t]||[]).slice().forEach(f=>f(ev||{}));};
  e.dispatchEvent=ev=>{if(sink)sink.push(ev);(e.handlers[ev.type]||[]).slice().forEach(f=>f(ev));return true;};
  e.closest=()=>null;e.contains=()=>false;
  return e;
}
// 与真客户端 Core/Mobile 同形的两指手势引擎桩：收到的合成触摸真的会改相机（行为断言，不是形状断言）
function vcMobile(cam,rec){
  const M={f:false,A:false,SHIFT:false,action:{active:false,x:0,y:0},l:0,r:0,w:0,x:null,log:{onTouchStart:0,onTouchMove:0,onTouchEnd:0,zoom:0,yaw:0,zoomVals:[]}};
  M.b=t=>-Math.sqrt(Math.pow(t[0].pageX-t[1].pageX,2)+Math.pow(t[0].pageY-t[1].pageY,2));
  M.c=t=>Math.round(360*Math.atan((t[0].pageY-t[1].pageY)/(t[0].pageX-t[1].pageX))/Math.PI%360);
  M.d=(a,b)=>{const c=b[0].pageX-a[0].pageX,d=b[1].pageX-a[1].pageX;return (c&&d&&(c<0)===(d<0)&&0.25>Math.abs(1-c/d))?(c+d)>>1:0;};
  M.e=(a,b)=>{const c=b[0].pageY-a[0].pageY,d=b[1].pageY-a[1].pageY;return (c&&d&&(c<0)===(d<0)&&0.25>Math.abs(1-c/d))?(c+d)>>1:0;};
  M.screen={x:0,y:0,width:1000,height:500};
  M.start=ev=>{
    M.x=ev.touches;rec.events.push({type:'touchstart',n:ev.touches.length});
    if(M.x.length>1){M.l=M.b(M.x);M.r=M.c(M.x);M.w=cam.angle[1];M.f=true;return;}
    M.screen.x=M.x[0].pageX;M.screen.y=M.x[0].pageY;M.A=true;M.intersect=true;
  };
  M.move=ev=>{
    const g=ev.touches;rec.events.push({type:'touchmove',n:g.length});
    M.screen.x=g[0].pageX;M.screen.y=g[0].pageY;
    if(M.f){
      const a=M.b(g)-M.l,u=M.c(g)-M.r+M.w,n=Math.abs(M.d(M.x,g)),e=Math.abs(M.e(M.x,g));
      if(!M.action.active&&(n>10||e>10)){M.SHIFT=e>n;M.action.active=true;M.action.x=M.screen.x;M.action.y=M.screen.y;}
      else if(Math.abs(a)>10){cam.zoomFinal+=0.1*a;cam.zoomFinal=Math.min(cam.zoomFinal,Math.abs(cam.altitudeTo-cam.altitudeFrom)*cam.MAX_ZOOM);cam.zoomFinal=Math.max(cam.zoomFinal,2);M.log.zoom++;M.log.zoomVals.push(cam.zoomFinal);}
      if(u){cam.angleFinal[1]=u;M.log.yaw++;}
    } else if(M.intersect){M.log.onTouchMove++;}
  };
  M.end=ev=>{
    rec.events.push({type:'touchend',n:ev.touches?ev.touches.length:0});
    if(M.f){M.f=false;M.SHIFT=false;M.action.active=false;return;}
    if(M.A){M.A=false;return;}
    M.log.onTouchEnd++;M.intersect=false;
  };
  M.frame=()=>{ // 模拟 Camera.update：触摸手势期间只有 SHIFT（俯仰）这一段由每帧应用
    if(!M.action.active)return;
    if(M.SHIFT){let v=cam.angleFinal[0]+(M.screen.y-M.action.y)/M.screen.height*300;cam.angleFinal[0]=Math.max(Math.min(v,cam.zoomTo),cam.zoomFrom);}
    M.action.x=M.screen.x;M.action.y=M.screen.y;
  };
  return M;
}
function vcModeCheck(w,name){
  assert.equal(w.call('vcS.mode'),'',name+' 初始不得有模式缓存');
  const ui=vcEl('div');ui.attrs['data-dsh-ui']='1';
  w.press('pointerdown',10,10,{target:ui});w.press('pointerup',10,10,{target:ui});
  assert.equal(w.call('vcS.mode'),'',name+' 点助手自己的界面不得把模式锁成 touch');
  // 引擎没就绪时拖拽：本次只能尽力而为，但结论不许被定死
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',420,300);w.pump(3);w.press('pointerup',420,300);w.pump(2);
  assert.equal(w.call('vcS.mode'),'',name+' 引擎就绪前的拖拽不得把模式锁成 touch');
  assert.equal(w.vcModeEnsure(),'touch',name+' 引擎就绪前只能按备路尽力跑');
  assert.equal(w.call('vcS.mode'),'',name+' 备路结论在引擎就绪前不得落缓存');
  w.loadEngine();w.cam.angleFinal[1]=0;w.settle();
  assert.equal(w.vcModeEnsure(),'camera',name+' 引擎就绪且相机模块可用后必须判为主路 camera');
  assert.equal(w.call('vcS.mode'),'camera',name+' 主路结论必须落缓存（升级后不再回退）');
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',420,300);w.pump(3);w.press('pointerup',420,300);w.pump(2);
  assert.ok(w.cam.angleFinal[1] < -80, name+' 升级后拖拽必须真的转偏航（实际 '+w.cam.angleFinal[1]+'）');
}
function vcZoomResetCheck(w,name){
  assert.equal(w.vcModeEnsure(),'touch',name+' 前置：必须处于备路 touch');
  w.pump(4);
  w.cam.zoomFinal=80;w.cam.angleFinal[0]=220;w.cam.angle[0]=220;w.cam.angleFinal[1]=0;w.settle();
  for(let i=0;i<3;i++){w.call("vcStep('zoom',-1)");w.pump(10);}
  assert.equal(w.cam.zoomFinal,35,name+' 前置：三档 -1 必须到 35（80-45，实际 '+w.cam.zoomFinal+'）');
  w.vcReset();w.pump(90);
  assert.ok(Math.abs(w.cam.zoomFinal-80)<=2,name+' F1 多档缩放后重置必须回到起点 80（实际 '+w.cam.zoomFinal+'）');
  // 量程上限那侧同样要回得去（一段一段搬，每段受两指间距限制）
  w.cam.zoomFinal=150;w.cam.angleFinal[0]=220;w.cam.angle[0]=220;w.cam.angleFinal[1]=0;w.settle();
  w.vcReset();w.pump(90);
  assert.ok(Math.abs(w.cam.zoomFinal-80)<=2,name+' F1 从量程上限 150 重置也必须回到起点 80（实际 '+w.cam.zoomFinal+'）');
}
function vcPendingDragCheck(w,name){
  assert.equal(w.vcModeEnsure(),'touch',name+' 前置：必须处于备路 touch');
  w.pump(4);
  w.cam.angleFinal[0]=220;w.cam.angle[0]=220;w.cam.angleFinal[1]=0;w.cam.angle[1]=0;w.settle();
  w.call("vcStep('pitch',1)");                                     // 上一段手势（按钮）已经受理、还没发完
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',400,300);   // 紧接着就开始拖拽（V2.38.11：右键）
  w.pump(3);w.press('pointerup',400,300);w.pump(30);
  assert.ok(w.cam.angleFinal[1] < -60, name+' F2 上一段手势没收完时的拖拽不许被吃掉（期望≈-72，实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(Math.abs(w.cam.angleFinal[0]-228)<=2, name+' F2 旧队列的俯仰只算按钮那一次、不许泄漏进拖拽（期望 228，实际 '+w.cam.angleFinal[0]+'）');
}
function vcPitchCheck(w,name){
  assert.equal(w.vcModeEnsure(),'touch',name+' 前置：必须处于备路 touch');
  w.pump(3);
  w.cam.angleFinal[0]=220;w.cam.angle[0]=220;                                 // 已知俯仰起点
  assert.equal(w.call("vcStep('pitch',1)"),true,name+' 前置：俯仰按钮必须成功');
  w.pump(6);
  assert.ok(Math.abs(w.cam.angleFinal[0]-228)<=1.5, name+' F-B 俯仰按钮必须真的改变俯仰（期望 228，实际 '+w.cam.angleFinal[0]+'）');
}
function vcFixCheck(w,name){
  assert.equal(w.vcModeEnsure(),'touch',name+' 前置：必须处于备路 touch');
  // 非收敛场景：拖拽后**不给引擎帧**就把目标拉走（引擎当前角度 angle[1] 还停在起点）
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',420,300);w.pump(2,true);   // 只发事件、不跑引擎帧 → 未收敛
  assert.ok(Math.abs(w.cam.angleFinal[1])>80,name+' 前置：拖拽必须已经把目标偏航拉走（实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(Math.abs(w.cam.angle[1])<1,name+' 前置：此时引擎的当前角度还没收敛（实际 '+w.cam.angle[1]+'）');
  w.vcReset();w.pump(24);
  assert.ok(Math.abs(w.cam.angleFinal[1])<=1.5,name+' F-C 未收敛时重置也必须收敛到起点（实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(Math.abs(w.cam.angle[1])<=1.5,name+' F-C 重置后引擎当前角度也必须回到起点（实际 '+w.cam.angle[1]+'）');
}
function vcWorld(src,over,opt){
  const o=opt||{};let code=vcBody(src);
  if(over){assert.equal(code.split(over[0]).length-1,1,'变异锚点必须唯一：'+String(over[0]).slice(0,56));const mut=code.split(over[0]).join(over[1]);assert.notEqual(mut,code,'变异必须真的改到代码');code=mut;}
  const rec={events:[],dispatched:[],logs:[],pd:0,single:{move:0,end:0}};
  const canvas=vcEl('canvas',rec.dispatched),body=vcEl('body',rec.dispatched),doc=vcEl('document',rec.dispatched);
  doc.body=body;doc.documentElement=body;doc.readyState='complete';
  doc.createElement=tag=>vcEl(tag);
  const docH={};
  doc.addEventListener=(t,f)=>{(docH[t]=docH[t]||[]).push(f);};
  const cam={angle:[220,0],angleFinal:[220,0],zoomFinal:80,currentMap:o.map||'prontera',
    rotationFrom:-360,rotationTo:360,inRotationFrom:-60,inRotationTo:-25,zoomFrom:190,zoomTo:270,inZoomFrom:220,inZoomTo:240,
    MAX_ZOOM:15,altitudeFrom:-70,altitudeTo:-80,saves:0,zoomCalls:[],setZoom:function(a){this.zoomCalls.push(a);this.zoomFinal=Math.trunc(Math.max(Math.min(this.zoomFinal+15*a,150),10));this.save();},
    save:function(){this.saves++;}};
  const meh={screen:{x:0,y:0,width:1000,height:500},intersect:o.intersect===undefined?true:o.intersect};
  const comp=vcEl('div');comp.contains=t=>t===comp||t===compInner;const compInner=vcEl('div');
  const std={'Renderer/Camera':o.noCam?null:cam,'DB/DBManager':{isIndoor:()=>o.indoor===true},'Controls/MouseEventHandler':meh,
    'Renderer/Renderer':{canvas:canvas,camera:cam},'UI/UIManager':{components:o.activeUi===false?{}:{Equipment:{ui:comp,__active:true}}}};
  const modules=o.dead?{}:Object.assign({},std);
  const engine=vcMobile(cam,rec);
  const wireEngine=()=>{body.addEventListener('touchstart',ev=>engine.start(ev));body.addEventListener('touchmove',ev=>engine.move(ev));body.addEventListener('touchend',ev=>engine.end(ev));};
  if(!o.dead)wireEngine();   // o.dead：模拟「引擎还没加载完」——模块取不到、触摸监听也还没接
  const rafQ=[];let rafId=0;
  const win={innerWidth:1000,innerHeight:500,PointerEvent:function(){},addEventListener:function(){},
    requestAnimationFrame:fn=>{rafQ.push(fn);return ++rafId;}};
  const ctx={IS_MN:true,document:doc,window:win,
    Touch:function Touch(p){Object.assign(this,p);},
    TouchEvent:function TouchEvent(t,p){this.type=t;Object.assign(this,p);},
    requireDB:n=>modules[n]||null,inAssistantUI:t=>!!(t&&t.attrs&&t.attrs['data-dsh-ui']==='1'),isolateEl:()=>{},
    mvLog:m=>rec.logs.push(m),tlog:m=>rec.logs.push(m),
    setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},Date:Date,Math:Math,console:console};
  vm.createContext(ctx);
  vm.runInContext(code,ctx);
  const call=(expr)=>vm.runInContext(expr,ctx);
  // 帧泵：每帧先跑排队的合成触摸回调，再跑一次「引擎主循环」（Camera.update 的俯仰段 + 角度收敛）
  const pump=(n,noFrame)=>{for(let i=0;i<(n||1);i++){const due=rafQ.splice(0,rafQ.length);due.forEach(f=>{try{f();}catch(e){}});if(noFrame)continue;engine.frame();cam.angle[1]+=(cam.angleFinal[1]-cam.angle[1])*0.3;cam.angle[0]+=(cam.angleFinal[0]-cam.angle[0])*0.3;}};   // 一帧一次 lerp（k=0.3，接近真实插值）；noFrame=true 只发事件不跑引擎帧
  const loadEngine=()=>{Object.assign(modules,std);wireEngine();};
  const press=(type,x,y,extra)=>{
    const ev={type:type,button:0,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',altKey:false,target:canvas,cancelable:true,deltaY:0,
      preventDefault:()=>{rec.pd++;}};
    Object.assign(ev,extra||{});
    (docH[type]||[]).slice().forEach(f=>f(ev));
    return ev;
  };
  const out={cam,meh,rec,engine,body,doc,canvas,comp,compInner,press,call,ctx,pump,loadEngine,
    settle:()=>{cam.angle[0]=cam.angleFinal[0];cam.angle[1]=cam.angleFinal[1];},
    events:()=>rec.events,dispatched:()=>rec.dispatched,logs:()=>rec.logs,
    box:()=>call('vcS.box')};
  for(const k of ['vcModeEnsure','vcStep','vcReset','vcBounds','vcCamDrag','vcSnapshot','vcEnsureOrigin'])out[k]=()=>call(k+'()');
  return out;
}
function vcCamCheck(w,name){
  assert.equal(w.vcModeEnsure(),'camera',name+' 有相机模块时必须走主路 camera');
  // 1) 拖拽角度累积（公式与 Camera.processMouseAction 同形：dx→偏航 -dx/宽*720、dy→俯仰 +dy/高*300）
  w.press('pointerdown',100,100,{button:2});w.press('pointermove',140,110);w.press('pointermove',200,140);
  assert.equal(w.cam.angleFinal[0],244,name+' 俯仰必须累积（220+40/500*300）');
  assert.equal(w.cam.angleFinal[1],-72,name+' 偏航必须累积（0-100/1000*720）');
  assert.equal(w.rec.dispatched.length,0,name+' 拖拽期间不许向游戏派发任何合成触摸（否则单指摇杆会带着角色乱跑）');
  w.press('pointerup',200,140);
  assert.equal(w.rec.dispatched.length,0,name+' 拖拽抬起也不许派发（否则会触发那一次点击走路）');
  // 2) 重置回首次控制前快照
  w.vcReset();
  assert.equal(w.cam.angleFinal[0],220,name+' 重置必须回俯仰快照');
  assert.equal(w.cam.angleFinal[1],0,name+' 重置必须回偏航快照');
  assert.equal(w.cam.zoomFinal,80,name+' 重置必须回缩放快照');
  // 3) 缩放上下限与方向（绝不拉穿/反转）
  w.cam.zoomCalls.length=0;
  w.vcStep();w.call("vcStep('zoom',-1)");w.call("vcStep('zoom',-1)");
  assert.deepEqual(w.cam.zoomCalls.slice(-2),[-1,-1],name+' 放大必须是 setZoom(-1)（拉近）');
  assert.equal(w.cam.zoomFinal,50,name+' 两档放大 80→50');
  let last=w.cam.zoomFinal,mono=true;
  for(let i=0;i<40;i++){w.call("vcStep('zoom',1)");if(w.cam.zoomFinal<last)mono=false;last=w.cam.zoomFinal;}
  assert.equal(w.cam.zoomFinal,150,name+' 连续缩小必须停在引擎上限 150（不得越界）');
  assert.ok(mono,name+' 缩小方向必须单调不反转');
  for(let i=0;i<40;i++){w.call("vcStep('zoom',-1)");}
  assert.equal(w.cam.zoomFinal,10,name+' 连续放大必须停在引擎下限 10（不得越界/反转）');
  // 4) 阈值：≤5px 是一次点击（照旧走路），>5px 才算拖拽
  w.cam.angleFinal[0]=220;w.cam.angleFinal[1]=0;w.settle();
  w.rec.dispatched.length=0;
  // V2.38.11：左键彻底不参与视角 —— 阈值内/超过阈值都整段原样转发，相机一动不动
  w.rec.dispatched.length=0;
  w.press('pointerdown',50,50);w.press('pointermove',60,50);w.press('pointerup',60,50);
  assert.deepEqual(w.rec.dispatched.map(e=>e.type),['touchstart','touchmove','touchend'],name+' 左键拖拽必须整段原样转发（含 touchmove，恢复 V2.38.8 行为）');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],[220,0],name+' 左键拖拽绝不能改相机');
  // 右键：阈值内只是一次普通右键（不转视角、不拦菜单）；超过阈值才算拖拽
  w.rec.dispatched.length=0;w.rec.pd=0;
  w.press('pointerdown',50,50,{button:2});w.press('pointermove',52,51);w.press('pointerup',52,51);w.press('contextmenu',52,51,{button:2});
  assert.equal(w.rec.dispatched.length,0,name+' 阈值内的右键移动不得合成任何触摸');
  assert.equal(w.rec.pd,0,name+' 阈值内的右键移动不得拦右键菜单');
  w.rec.pd=0;
  w.press('pointerdown',50,50,{button:2});w.press('pointermove',60,50);w.press('pointerup',60,50);
  assert.equal(w.rec.dispatched.length,0,name+' 右键超过阈值必须不派发任何触摸（抑制这次点击走路）');
  assert.equal(w.cam.angleFinal[1],-7.2,name+' 右键超过阈值必须真的转视角');
  w.press('contextmenu',60,50,{button:2});
  assert.equal(w.rec.pd,1,name+' 右键拖拽后 contextmenu 必须恰好被抑制一次（实际 '+w.rec.pd+'）');
  // 5) 按钮组 7 键
  const box=w.box();
  assert.ok(box&&box.children.length===7,name+' 左下角必须有 7 个视角按钮');
  assert.deepEqual(box.children.map(b=>b.title),['左转视角','右转视角','上仰视角','下俯视角','放大（拉近）','缩小（拉远）','重置视角'],name+' 按钮标题必须齐全');
  w.cam.angleFinal[0]=220;w.cam.angleFinal[1]=0;w.cam.zoomFinal=80;w.settle();
  box.children[0].fire('click'); // 左转 = 偏航 +15
  box.children[3].fire('click'); // 下俯 = 俯仰 +8
  box.children[4].fire('click'); // 放大 = setZoom(-1)
  assert.equal(w.cam.angleFinal[1],15,name+' 左转按钮必须 +15°');
  assert.equal(w.cam.angleFinal[0],228,name+' 下俯按钮必须 +8°');
  assert.equal(w.cam.zoomFinal,65,name+' 放大按钮必须拉近 15');
  box.children[6].fire('click'); // 重置
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1],w.cam.zoomFinal],[220,0,80],name+' 重置按钮必须回快照');
  assert.ok(w.logs().some(l=>l.includes('视角控制')),name+' 装配必须留可排查日志');
}
function vcGuardCheck(w,name){
  const base=[w.cam.angleFinal[0],w.cam.angleFinal[1]];
  // 1) V2.38.11：静止右键 = 完全按原样（不合成、不转视角、不拦菜单）；本服手机页右键无游戏内用途，故拖拽抑制菜单不会挡功能
  w.rec.dispatched.length=0;w.rec.pd=0;
  w.press('pointerdown',10,10,{button:2});w.press('pointerup',10,10,{button:2});w.press('contextmenu',10,10,{button:2});
  assert.equal(w.rec.dispatched.length,0,name+' 静止右键不得合成任何触摸');
  assert.equal(w.rec.pd,0,name+' 静止右键不得被 preventDefault');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],base,name+' 静止右键不得改视角');
  // 2) ALT+左键：照旧旧行为（立刻合成），不接管视角
  w.rec.dispatched.length=0;
  w.press('pointerdown',10,10,{altKey:true});w.press('pointermove',90,10,{altKey:true});w.press('pointerup',90,10,{altKey:true});
  assert.deepEqual(w.rec.dispatched.map(e=>e.type),['touchstart','touchmove','touchend'],name+' ALT+左键必须保持旧行为（不接管）');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],base,name+' ALT+左键不得改视角');
  // 3) 真实触摸指针：整条路径不得被改动
  w.rec.dispatched.length=0;
  w.press('pointerdown',10,10,{pointerType:'touch'});w.press('pointermove',90,10,{pointerType:'touch'});w.press('pointerup',90,10,{pointerType:'touch'});
  assert.equal(w.rec.dispatched.length,0,name+' 真实触摸指针不得被鼠标层合成/接管');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],base,name+' 真实触摸指针不得改视角（触摸设备原有手势一行不动）');
  assert.equal(w.call('vcS.pend'),null,name+' 触摸指针不得进鼠标待定态');
  // 4a) 引擎活动 UI 组件的 DOM 上（intersect 仍为 true，例如非 STOP 组件）一律不接管
  const uiTarget=w.compInner;
  w.rec.dispatched.length=0;w.rec.pd=0;w.cam.zoomCalls.length=0;
  w.press('wheel',10,10,{target:uiTarget,deltaY:-120});
  assert.equal(w.cam.zoomCalls.length,0,name+' 引擎 UI 组件上的滚轮不得缩放');
  assert.equal(w.rec.pd,0,name+' 引擎 UI 组件上的滚轮不得 preventDefault');
  const rUi=[];const oldTU=w.ctx.TouchEvent;w.ctx.TouchEvent=function(ty,p){rUi.push(ty);this.type=ty;Object.assign(this,p);};
  w.press('pointerdown',10,10,{target:uiTarget});w.press('pointermove',120,10,{target:uiTarget});w.press('pointerup',120,10,{target:uiTarget});
  assert.equal(w.cam.angleFinal[1],base[1],name+' 引擎 UI 组件上的拖拽不得转视角');
  w.ctx.TouchEvent=oldTU;
  assert.deepEqual(rUi,['touchstart','touchmove','touchend'],name+' 该目标在可区分桩下 inAssistantUI=false、vcEngineUiDom=true → 左键按 v2.38.8 照旧整段合成触摸（F3：旧消息声称「被判成助手 UI」与桩不符）');
  // 4b) 指针停在引擎窗口上（MouseEventHandler.intersect=false）且不在画布：同样不接管
  w.meh.intersect=false;
  w.rec.dispatched.length=0;w.rec.pd=0;w.cam.zoomCalls.length=0;
  const uiFar=vcEl('div');
  w.press('wheel',10,10,{target:uiFar,deltaY:-120});
  assert.equal(w.cam.zoomCalls.length,0,name+' intersect=false（指针在引擎窗口上）的滚轮不得缩放');
  const rFar=[];const oldTF=w.ctx.TouchEvent;w.ctx.TouchEvent=function(ty,p){rFar.push(ty);this.type=ty;Object.assign(this,p);};
  w.press('pointerdown',10,10,{target:uiFar});w.press('pointermove',120,10,{target:uiFar});w.press('pointerup',120,10,{target:uiFar});
  assert.equal(w.cam.angleFinal[1],base[1],name+' intersect=false 时的拖拽不得转视角');
  w.ctx.TouchEvent=oldTF;
  assert.deepEqual(rFar,['touchstart','touchmove','touchend'],name+' 该目标在可区分桩下 inAssistantUI=false（仅 intersect=false）→ 左键同样照 v2.38.8 合成触摸（F3）');
  w.meh.intersect=true;
  // 5) 滚轮方向与吞掉行为
  w.cam.zoomCalls.length=0;w.rec.pd=0;
  w.press('wheel',500,300,{deltaY:-120});w.press('wheel',500,300,{deltaY:120});
  assert.deepEqual(w.cam.zoomCalls,[-1,1],name+' 滚轮上=放大(-1)、下=缩小(1)');
  assert.equal(w.rec.pd,2,name+' 生效的滚轮必须 preventDefault（防页面滚动）');
  // 6) 助手 UI 内一律不接管
  const aui=vcEl('div');aui.attrs['data-dsh-ui']='1';
  w.cam.zoomCalls.length=0;w.rec.dispatched.length=0;
  w.press('wheel',10,10,{target:aui,deltaY:-120});
  w.press('pointerdown',10,10,{target:aui});w.press('pointermove',120,10,{target:aui});w.press('pointerup',120,10,{target:aui});
  assert.equal(w.cam.zoomCalls.length,0,name+' 助手 UI 内的滚轮不得缩放');
  assert.equal(w.rec.dispatched.length,0,name+' 助手 UI 内不得合成触摸');
  // 7) V2.38.11：左键完全恢复原样（不参与视角、整段原样转发）
  w.rec.dispatched.length=0;w.rec.pd=0;
  const lb=[w.cam.angleFinal[0],w.cam.angleFinal[1]];
  w.press('pointerdown',300,300);w.press('pointermove',340,300);w.press('pointermove',420,300);w.press('pointerup',420,300);
  assert.deepEqual(w.rec.dispatched.map(e=>e.type),['touchstart','touchmove','touchmove','touchend'],name+' 左键必须整段原样转发（恢复原行为）');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],lb,name+' 左键拖拽绝不能改视角');
  // 8) V2.38.11：右键拖拽生效、期间零合成触摸、菜单恰好抑制一次且只消费一次
  w.rec.dispatched.length=0;w.rec.pd=0;w.cam.angleFinal[1]=0;
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',340,300);w.press('pointermove',420,300);w.press('pointerup',420,300);
  assert.equal(w.rec.dispatched.length,0,name+' 右键拖拽期间与抬起不得派发任何合成触摸');
  assert.ok(w.cam.angleFinal[1]<-80,name+' 右键拖拽必须真的转偏航（实际 '+w.cam.angleFinal[1]+'）');
  w.press('contextmenu',420,300,{button:2});
  assert.equal(w.rec.pd,1,name+' 右键拖拽后 contextmenu 必须恰好被抑制一次（实际 '+w.rec.pd+'）');
  w.press('contextmenu',420,300,{button:2});
  assert.equal(w.rec.pd,1,name+' 抑制标志只消费一次：第二个 contextmenu 不许再被拦');
  // 9) V2.38.11：静止右键 / 阈值内右键移动一律按原样
  w.rec.dispatched.length=0;w.rec.pd=0;const rb=[w.cam.angleFinal[0],w.cam.angleFinal[1]];
  w.press('pointerdown',50,50,{button:2});w.press('pointerup',50,50,{button:2});w.press('contextmenu',50,50,{button:2});
  assert.equal(w.rec.dispatched.length,0,name+' 静止右键点击不得合成任何触摸');
  assert.equal(w.rec.pd,0,name+' 静止右键点击不得拦右键菜单');
  w.press('pointerdown',50,50,{button:2});w.press('pointermove',52,51);w.press('pointerup',52,51);w.press('contextmenu',52,51,{button:2});
  assert.equal(w.rec.pd,0,name+' 阈值内的右键移动同样不得拦右键菜单');
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],rb,name+' 静止右键/阈值内右键移动不得改视角');
  // 10) V2.38.11：引擎活动 UI 与助手 UI 上的右键拖拽一律不接管、菜单原样
  w.rec.dispatched.length=0;w.rec.pd=0;const ub=[w.cam.angleFinal[0],w.cam.angleFinal[1]];
  w.press('pointerdown',10,10,{button:2,target:uiTarget});w.press('pointermove',120,10,{target:uiTarget});w.press('pointerup',120,10,{target:uiTarget});w.press('contextmenu',120,10,{button:2,target:uiTarget});
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],ub,name+' 引擎活动 UI 上的右键拖拽不得转视角');
  assert.equal(w.rec.pd,0,name+' 引擎 UI 上的右键菜单必须按原样（不得拦）');
  w.press('pointerdown',10,10,{button:2,target:aui});w.press('pointermove',120,10,{target:aui});w.press('pointerup',120,10,{target:aui});w.press('contextmenu',120,10,{button:2,target:aui});
  assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],ub,name+' 助手 UI 上的右键拖拽不得转视角');
  assert.equal(w.rec.pd,0,name+' 助手 UI 上的右键菜单必须按原样');
  // 11) F4：引擎/助手 UI 上的右键必须先清零抑制标志，否则上一次拖拽欠下的抑制会吞掉这次原生菜单
  w.rec.pd=0;
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',420,300);w.press('pointerup',420,300);   // 拖拽命中阈值 → 欠一次抑制
  const auiF=vcEl('div');auiF.attrs['data-dsh-ui']='1';
  w.press('pointerdown',300,300,{button:2,target:auiF});w.press('pointerup',300,300,{button:2,target:auiF});   // UI 上的右键：只清零、不接管
  w.press('contextmenu',300,300,{button:2});   // 这一次菜单必须按原样（不得被上次欠账吞掉）
  assert.equal(w.rec.pd,0,name+' F4：UI 上的右键必须清零抑制标志，不得吞掉这一次原生菜单');
  // 12) F5：抑制只对目标仍在游戏区域的本次拖拽生效；UI 上弹的菜单放行，但标志照样清零
  w.rec.pd=0;
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',420,300);w.press('pointerup',420,300);   // 又一次命中阈值的拖拽
  w.press('contextmenu',420,300,{button:2,target:auiF});
  assert.equal(w.rec.pd,0,name+' F5：目标在 UI 上的 contextmenu 不得被吞（有界行为）');
  w.press('contextmenu',420,300,{button:2});
  assert.equal(w.rec.pd,0,name+' F5：UI 上放行后标志必须清零，不许留给下一次菜单');
}
function vcLeftGateCheck(w,name,fullSrc){
  const eng=w.compInner;   // 引擎活动 UI 的 DOM：桩可区分（inAssistantUI=false / vcEngineUiDom=true）
  const inA=w.ctx.inAssistantUI(eng);
  const fE=w.call('vcEngineUiDom'),fU=w.call('vcInUi'),fS=w.call('simInUi');
  const vcE=fE(eng),vcU=fU(eng),sU=fS(eng);
  assert.equal(inA,false,name+' 桩必须可区分：inAssistantUI(引擎 DOM)=false');
  assert.equal(vcE,true,name+' 桩必须可区分：vcEngineUiDom(同一元素)=true');
  assert.equal(vcU,true,name+' 该元素上 vcInUi=true（宽排除，右键拖拽/滚轮用）');
  assert.equal(sU,false,name+' 该元素上 simInUi=false（v2.38.8 窄排除：左键只排除助手界面）');
  const rec=()=>{const m=[];const old=w.ctx.TouchEvent;w.ctx.TouchEvent=function(ty,p){m.push(ty);this.type=ty;Object.assign(this,p);};return{m,stop:()=>{w.ctx.TouchEvent=old;}};};
  const r1=rec();w.press('pointerdown',10,10,{target:eng});w.press('pointermove',120,10,{target:eng});w.press('pointerup',120,10,{target:eng});r1.stop();
  assert.deepEqual(r1.m,['touchstart','touchmove','touchend'],name+' 引擎活动 UI 的 DOM 上左键必须整段合成触摸（改回 vcInUi 这里立刻为空 → F1 红线）');
  const aui=vcEl('div');aui.attrs['data-dsh-ui']='1';
  const r2=rec();w.press('pointerdown',10,10,{target:aui});w.press('pointerup',10,10,{target:aui});r2.stop();
  assert.deepEqual(r2.m,[],name+' 助手自己的界面上左键不得合成（v2.38.8 的唯一排除项）');
  const out={桩可区分:'inAssistantUI=false / vcEngineUiDom=true / vcInUi=true / simInUi=false',引擎DOM左键:r1.m,助手UI左键:r2.m};
  if(fullSrc&&fullSrc.indexOf('function simInUi(t)')>=0){   // 附带源码形状检查（有全文时才做；变异世界没有全文，避免假阳性）
    const src=fullSrc;
    assert.ok(/function simInUi\(t\) \{[^}]*return inAssistantUI\(t\);/.test(src),name+' 左键守卫必须是 v2.38.8 的 simInUi=inAssistantUI');
    const leftGate=src.split('\n').filter(l=>l.indexOf('if (simInUi(e.target)) return;')>=0);
    assert.equal(leftGate.length,1,name+' 左键分支必须且只能有一道 simInUi 守卫（实际 '+leftGate.length+'）');
    const down=src.slice(src.indexOf('function simDown(e)'),src.indexOf('function simMove(e)'));
    assert.ok(down.indexOf('if (simInUi(e.target)) return;')>down.indexOf('if (e.button !== 0) return;'),name+' 左键守卫必须在「非左键直接 return」之后（只作用于左键）');
    assert.ok(down.indexOf('if (vcInUi(e.target)) return;')<down.indexOf('if (e.button !== 0) return;'),name+' vcInUi 必须在左键分支之前（只作用于右键候选）');
    assert.ok(src.indexOf('vcCtxOnce = 0;')<src.indexOf('if (vcInUi(e.target)) return;   // 右键拖拽仍用宽排除'),name+' F4：抑制标志清零必须在 vcInUi 早退之前');
    out.源码守卫=leftGate.length+' 道 simInUi 守卫 + F4 清零顺序正确';
  }
  return JSON.stringify(out);
}
function vcBoundsCheck(w,name){
  const b=w.vcBounds();
  assert.deepEqual([b.a0.lo,b.a0.hi],[190,270],name+' 室外俯仰界必须从相机对象读（190..270）');
  assert.deepEqual([b.a1.lo,b.a1.hi],[-360,360],name+' 室外偏航界必须从相机对象读（±360）');
  const wi=vcWorld(w.src||'',null,{indoor:true});
  const bi=wi.vcBounds();
  assert.deepEqual([bi.a0.lo,bi.a0.hi],[220,240],name+' 室内俯仰界必须用 inZoomFrom/To');
  assert.deepEqual([bi.a1.lo,bi.a1.hi],[-60,-25],name+' 室内偏航界必须用 inRotationFrom/To');
}
function vcTouchCheck(w,name){
  assert.equal(w.vcModeEnsure(),'touch',name+' 相机模块不可达时必须退到备路 touch');
  // 1) 水平拖拽 = 合成两指旋转 → 偏航（dx 120 → -120/1000*720 = -86.4；引擎 c() 会量化到整度）
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',340,300);w.pump(2);w.press('pointermove',420,300);w.pump(2);w.press('pointerup',420,300);w.pump(3);
  assert.deepEqual(w.rec.events.map(e=>e.type),['touchstart','touchmove','touchmove','touchend'],name+' 备路拖拽必须是两指手势序列');
  assert.ok(w.rec.events[0].n===2&&w.rec.events[1].n===2,name+' 备路必须是 2 指（单指会走摇杆走路）');
  assert.equal(w.engine.log.onTouchMove,0,name+' 备路绝不能触发 Core/Mobile 的单指 onTouchMove（会带着角色走）');
  assert.equal(w.engine.log.onTouchEnd,0,name+' 备路绝不能触发单指 onTouchEnd（会触发点地走路/攻击）');
  assert.ok(Math.abs(w.cam.angleFinal[1] + 86.4) <= 2, name+' 备路水平拖拽必须真的转偏航（期望≈-86.4，实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(w.cam.angleFinal[1] < -80, name+' 备路偏航量级必须与主路一致（不得只动一点点）');
  // 2) F-C 重置：按「当前真实角度」算剩余差值 + 复核，偏航/俯仰都要回起点（俯仰会被两指手势的 SHIFT 带偏，也要一并纠回）
  w.vcReset();w.pump(24);
  assert.ok(Math.abs(w.cam.angleFinal[1]) <= 1.5, name+' 备路重置必须把偏航转回来（实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(Math.abs(w.cam.angleFinal[0]-220) <= 2, name+' 备路重置必须把俯仰也带回起点（实际 '+w.cam.angleFinal[0]+'）');
  assert.equal(w.engine.log.onTouchMove + w.engine.log.onTouchEnd,0,name+' 重置手势也不得触发单指路径');
  // 3) 竖直拖拽 = 俯仰（走引擎 SHIFT 分支，每帧由 Camera.update 应用）
  w.press('pointerdown',300,300,{button:2});w.press('pointermove',302,320);w.pump(4);w.press('pointermove',302,400);w.pump(4);
  w.press('pointerup',302,400);w.pump(6);
  assert.ok(Math.abs(w.cam.angleFinal[0]-268)<=1.5, name+' 备路俯仰增量必须等于 dy/高*300（期望 268，实际 '+w.cam.angleFinal[0]+'）');
  assert.equal(w.engine.SHIFT,false,name+' 手势结束后 SHIFT 必须复位');
  // 4) 重置 → 俯仰回起点
  w.vcReset();w.pump(24);
  assert.ok(Math.abs(w.cam.angleFinal[0]-220)<=2, name+' 备路重置必须把俯仰转回来（实际 '+w.cam.angleFinal[0]+'）');
  // 5) F-B 俯仰按钮：必须真的改变俯仰（原来一帧内全发完 → 引擎 Camera.update 吃不到那一帧 → Δ=0）
  w.cam.angleFinal[0]=220;w.cam.angle[0]=220;
  assert.equal(w.call("vcStep('pitch',1)"),true,name+' 备路俯仰按钮必须成功');
  w.pump(10);
  assert.ok(Math.abs(w.cam.angleFinal[0]-228)<=1.5, name+' F-B 俯仰按钮必须真的改变俯仰（期望 228，实际 '+w.cam.angleFinal[0]+'）');
  w.vcReset();w.pump(24);
  assert.ok(Math.abs(w.cam.angleFinal[0]-220)<=2, name+' 俯仰按钮后重置必须回到起点（实际 '+w.cam.angleFinal[0]+'）');
  // 6) 滚轮 = 指距变化 → zoomFinal ±15（上下限用引擎触摸路径自带的那套）
  w.cam.zoomFinal=80;w.settle();
  assert.equal(w.call("vcStep('zoom',-1)"),true,name+' 备路缩放必须成功');
  w.pump(10);
  assert.equal(w.cam.zoomFinal,65,name+' 备路一档缩放必须 = 15（与 setZoom(1) 等价）');
  for(let i=0;i<40;i++){w.call("vcStep('zoom',1)");w.pump(10);}   // 一档一次点击（真实点击每帧最多一次；同帧连发会撞上上一段手势还没发完）
  w.pump(20);
  assert.equal(w.cam.zoomFinal,150,name+' 备路缩放上限必须被引擎钳住（|altTo-altFrom|*MAX_ZOOM=150）');
  for(let i=0;i<40;i++){w.call("vcStep('zoom',-1)");w.pump(10);}
  w.pump(20);
  assert.equal(w.cam.zoomFinal,2,name+' 备路缩放下限必须被引擎钳住（2）');
  // 7) yaw/zoom 步进 + 重置
  w.cam.zoomFinal=80;w.cam.angleFinal[0]=220;w.cam.angle[0]=220;w.cam.angleFinal[1]=0;w.settle();
  w.call("vcStep('yaw',1)");w.pump(10);w.call("vcStep('zoom',-1)");w.pump(10);   // 两次点击必须隔开：一段手势发完（≈4 帧）才发下一段
  assert.ok(w.cam.angleFinal[1]<-5&&w.cam.zoomFinal<80,name+' 备路 yaw/zoom 步进必须先动起来（yaw='+w.cam.angleFinal[1]+' zoom='+w.cam.zoomFinal+'）');
  w.vcReset();w.pump(24);
  assert.ok(Math.abs(w.cam.angleFinal[1])<=1.5,name+' 备路 step 重置必须把偏航转回来（实际 '+w.cam.angleFinal[1]+'）');
  assert.ok(Math.abs(w.cam.zoomFinal-80)<=1,name+' 备路 step 重置必须把缩放退回来（实际 '+w.cam.zoomFinal+'）');
}
test('V2.38.9 视角控制（主路 camera）：拖拽累积/重置、缩放上下限不反转、阈值与点击抑制、右键/ALT/触摸不碰（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src);
    try{vcCamCheck(w,name);vcGuardCheck(w,name);}catch(e){console.log('[VC 主路 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC 主路]['+name+'] 通过：拖拽 angleFinal='+JSON.stringify([w.cam.angleFinal[0],w.cam.angleFinal[1]])+' 合成事件='+w.rec.events.length);
  }
});
test('V2.38.9 视角控制（备路 touch）：相机模块不可达时合成两指手势，仍能旋转/俯仰/缩放/重置且绝不触发单指走路（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src,null,{noCam:true});w.src=src;
    try{vcTouchCheck(w,name);}catch(e){console.log('[VC 备路 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC 备路]['+name+'] 通过：偏航='+Math.round(w.cam.angleFinal[1])+' 俯仰='+Math.round(w.cam.angleFinal[0])+' 缩放='+w.cam.zoomFinal+' 单指回调=0');
  }
});
test('V2.38.9 视角控制：边界一律从 Renderer/Camera 读（室内外两套），不抄常量（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){const w=vcWorld(src);w.src=src;vcBoundsCheck(w,name);}
  console.log('[VC 边界] 室外/室内两套边界均由相机对象读得');
});
test('V2.38.9 F-A：引擎就绪前不锁死模式（点助手自己的界面不算数），引擎就绪后必须判为主路（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src,null,{dead:true});
    try{vcModeCheck(w,name);}catch(e){console.log('[VC F-A 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC F-A]['+name+'] 通过：未就绪时不锁模式 → 就绪后自动升级 camera');
  }
});
test('V2.38.9 F-C：备路重置按「当前真实角度」算剩余差值——未收敛时也必须收敛（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src,null,{noCam:true});
    try{vcFixCheck(w,name);}catch(e){console.log('[VC F-C 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC F-C]['+name+'] 通过：未收敛场景重置后 偏航='+w.cam.angleFinal[1]+' 俯仰='+w.cam.angleFinal[0]+'（引擎当前角 '+w.cam.angle[1]+'）');
  }
});
test('V2.38.9 F1：备路多档缩放后重置必须回到起点（单段手势不得越过两指间距 0 把缩放反向拉走）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src,null,{noCam:true});
    try{vcZoomResetCheck(w,name);}catch(e){console.log('[VC F1 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC F1]['+name+'] 通过：80→35→重置回到 '+w.cam.zoomFinal+'；150→重置回到 80 档');
  }
});
test('V2.38.9 F2：上一段合成手势还没发完时的拖拽不许被吃掉、旧手势俯仰不许泄漏',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src,null,{noCam:true});
    try{vcPendingDragCheck(w,name);}catch(e){console.log('[VC F2 失败]['+name+'] '+e.message);throw e;}
    console.log('[VC F2]['+name+'] 通过：按钮手势未完时拖拽 偏航='+w.cam.angleFinal[1]+' 俯仰='+w.cam.angleFinal[0]+'（旧版会被吃到 0）');
  }
});
test('V2.38.9 F4：结果码 4 的文案分平台——手机页用手机版原文，桌面页用旧引擎原文（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    const wm=tpWorld(src,null,{mn:true});
    assert.equal(wm.call('TP_ACK_WHY[4]'),'当前地图无法使用该功能',name+' 手机页（IS_MN）结果码 4 必须是手机版原文');
    wm.ack(new Uint8Array([0x4a,0x0a,4,0,0,0]).buffer);
    assert.ok(wm.diag().indexOf('当前地图无法使用该功能')>=0,name+' 手机页回包诊断文本必须写手机版原文：'+wm.diag());
    const wd=tpWorld(src);
    assert.equal(wd.call('TP_ACK_WHY[4]'),'未知地图',name+' 桌面页结果码 4 必须仍是旧引擎原文「未知地图」');
    wd.ack(new Uint8Array([0x4a,0x0a,4,0,0,0]).buffer);
    assert.ok(wd.diag().indexOf('未知地图')>=0,name+' 桌面页回包诊断文本必须写旧引擎原文：'+wd.diag());
    console.log('[F4 文案]['+name+'] 手机「当前地图无法使用该功能」/ 桌面「未知地图」双向核对通过');
  }
});
test('V2.38.9 F5：teleport(map,opt) 挂在公开门面 window.__ROPlugin 上且真的可达（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    const m=/teleport: function \(map, opt\) \{ return teleport\(map, opt\); \}/.exec(src);
    assert.ok(m,name+' 门面必须把 teleport 挂到公开接口对象上（window.__ROPlugin）');
    const at=src.indexOf('window.__ROPlugin = {');
    assert.ok(at>=0&&src.indexOf(m[0])>at&&src.indexOf(m[0])-at<900,name+' 门面条目必须写在 window.__ROPlugin 对象里（不是随手写在别处）');
    const w=tpWorld(src);
    assert.equal(w.call('(function(){ var f = { '+m[0]+' }; return typeof f.teleport; })()'),'function',name+' 门面条目必须是可调用函数');
    const r=w.call('(function(){ var f = { '+m[0]+' }; return f.teleport("iz_dun02",{x:11,y:22}); })()');
    assert.equal(r&&r.ok,true,name+' 门面调用必须真的发包（不是死代码）');
    assert.equal(w.sent.length,1,name+' 门面一次调用只发一个包');
    const v=w.sent[0].build().view;
    assert.equal(v.getUint16(0,true),2633,name+' 门面发出的必须是 0x0a49/2633');
    assert.equal(v.getUint32(18,true),11,name+' 门面必须把 x 带进包');
    assert.equal(v.getUint32(22,true),22,name+' 门面必须把 y 带进包');
    console.log('[F5 门面]['+name+'] window.__ROPlugin.teleport 可达且发出 0x0a49');
  }
});
test('V2.38.11 电脑版零影响：整块视角控件（含全部监听器）只在 IS_MN 手机页装配（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const lines=src.split(/\r?\n/);
    const iBegin=lines.findIndex(l=>l.includes('// === VC_BEGIN ==='));
    const iEnd=lines.findIndex(l=>l.includes('// === VC_END ==='));
    let iIsMn=-1;for(let i=iBegin;i>=0;i--){if(/(^|[^A-Za-z0-9_])(if\s*\(\s*IS_MN\s*\)|IS_MN\s*&&|IS_MN\s*\?)/.test(lines[i])){iIsMn=i;break;}}
    assert.ok(iIsMn>=0&&iBegin>iIsMn&&iEnd>iBegin,name+' 视角控件必须整块包在 IS_MN 条件里（找到的行 '+(iIsMn+1)+'）');
    const HANDLERS='simDown|simMove|simUp|vcCtx|vcOnWheel';
    const inside=lines.slice(iIsMn,iEnd+1).filter(l=>new RegExp('document\\.addEventListener\\("(pointerdown|pointermove|pointerup|pointercancel|mousedown|mousemove|mouseup|contextmenu|wheel)",\\s*('+HANDLERS+')').test(l)).length;
    const outside=lines.filter((l,i)=>new RegExp('document\\.addEventListener\\("(pointerdown|pointermove|pointerup|pointercancel|mousedown|mousemove|mouseup|contextmenu|wheel)",\\s*('+HANDLERS+')').test(l)&&!(i>iIsMn&&i<iEnd)).length;
    assert.ok(inside>=9,name+' IS_MN 分支内必须有整套监听器（实际 '+inside+'）');
    assert.equal(outside,0,name+' 这套监听器一个都不许出现在 IS_MN 条件之外（PC 页零监听器，实际 '+outside+'）');
    console.log('[V2.38.11 IS_MN 门禁]['+name+'] IS_MN 判定='+(iIsMn+1)+' 行；VC 块='+(iBegin+1)+'..'+(iEnd+1)+' 行；门禁内 document.addEventListener='+inside+' 门禁外同类='+outside);
  }
  console.log('[V2.38.11 IS_MN 门禁] IS_MN = /[?&]r=mn/.test(location.search)（产品第 470 行）→ PC 客户端页为 false，整块 VC 一行都不执行');
});
test('V2.38.11 左键恢复原样 / 右键拖拽生效：原始输出（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src);
    const base=[w.cam.angleFinal[0],w.cam.angleFinal[1]];
    w.rec.dispatched.length=0;w.rec.pd=0;
    w.press('pointerdown',300,300);w.press('pointermove',340,300);w.press('pointermove',420,300);w.press('pointerup',420,300);
    const left=w.rec.dispatched.map(e=>e.type);
    console.log('[V2.38.11 左键]['+name+'] 合成事件='+JSON.stringify(left)+' 相机='+JSON.stringify([w.cam.angleFinal[0],w.cam.angleFinal[1]])+' 与基线相同='+(JSON.stringify([w.cam.angleFinal[0],w.cam.angleFinal[1]])===JSON.stringify(base))+' contextmenu抑制='+w.rec.pd);
    assert.deepEqual(left,['touchstart','touchmove','touchmove','touchend'],name+' 左键必须整段原样转发');
    assert.deepEqual([w.cam.angleFinal[0],w.cam.angleFinal[1]],base,name+' 左键拖拽不得改视角');
    w.rec.dispatched.length=0;w.rec.pd=0;w.cam.angleFinal[1]=0;
    w.press('pointerdown',300,300,{button:2});w.press('pointermove',340,300);w.press('pointermove',420,300);w.press('pointerup',420,300);
    console.log('[V2.38.11 右键]['+name+'] 合成事件='+JSON.stringify(w.rec.dispatched.map(e=>e.type))+' 偏航='+w.cam.angleFinal[1]+'（右键拖拽生效）');
    assert.equal(w.rec.dispatched.length,0,name+' 右键拖拽期间与抬起不得派发任何合成触摸');
    assert.ok(w.cam.angleFinal[1]<-80,name+' 右键拖拽必须真的转偏航（实际 '+w.cam.angleFinal[1]+'）');
    w.rec.pd=0;w.press('contextmenu',420,300,{button:2});
    console.log('[V2.38.11 右键菜单]['+name+'] 拖拽后 contextmenu 抑制次数='+w.rec.pd);
    assert.equal(w.rec.pd,1,name+' 右键拖拽后 contextmenu 恰好抑制一次');
  }
});

test('V2.38.11/12 B1 左键守卫：可区分桩行为断言（引擎活动 UI 的 DOM 上左键必须合成触摸）+ 源码形状 + M-VC15 mustDie（两文件）',()=>{
  for(const [name,src] of VC_FILES_SRC){
    const w=vcWorld(src);
    let info='';
    try{info=vcLeftGateCheck(w,name,src);}catch(e){console.log('[V2.38.11 B1 失败]['+name+'] '+e.message);throw e;}
    console.log('[V2.38.11 B1]['+name+'] '+info);
  }
});
test('V2.38.9 视角控制变异体：阈值/上下限/右键/触摸/派发/快照/引擎UI/模式锁定/一帧全发/重置算死/缩放反拉/同步start 十九处改动必须被真实行为断言杀死（两文件）',()=>{
  const MUT=[
    ['M-VC1 拖拽阈值判定去掉（1px 抖动也算拖拽）',
      '            if ((dx * dx + dy * dy) <= VC_TH * VC_TH) return;   // 还在阈值内：不接管、也不派发给游戏',
      '            if (false) return;   // 变异：阈值判定去掉'],
    ['M-VC2 缩放改直写 zoomFinal（绕过引擎 setZoom 的上下限）',
      '        cam.setZoom(dir * VC_ZOOM_STEP);',
      '        cam.zoomFinal = cam.zoomFinal + 15 * dir;   // 变异：绕过上限/下限'],
    ['M-VC3 左键也被当成拖拽候选（不再区分左右键 → 左键交互又被接管）',
      "          if (e.button === 2) {   // V2.38.11：右键 = 视角拖拽候选（先只记待定；阈值内抬起就完全按原样走）",
      "          if (e.button === 0 || e.button === 2) {   // 变异：左键也接管"],
    ['M-VC4 触摸路径被覆盖（任何指针都当成真实鼠标）',
      '          if (e.pointerType !== undefined) return e.pointerType === "mouse";',
      '          return true;   // 变异：触摸指针也合成'],
    ['M-VC5 拖拽期间仍向游戏派发 touchmove（摇杆会带着角色乱跑）',
      '          if (p.mode === "camera") { vcCamDrag(ddx, ddy); return; }',
      '          if (p.mode === "camera") { vcCamDrag(ddx, ddy); var tm = simMkTouch(e.clientX, e.clientY, p.target); if (tm) simFire("touchmove", [tm], [tm], p.target); return; }'],
    ['M-VC6 重置快照在改动之后才拍（每次都用当前状态当起点 → 重置回不到原始视角）',
      '      function vcEnsureOrigin() { return vcS.origin || vcSnapshot(); }',
      '      function vcEnsureOrigin() { return vcSnapshot(); }   // 变异：起点每次都重拍（快照落在改动之后）'],
    ['M-VC7 引擎活动 UI 窗口上也接管（拖窗口会变成转视角）',
      '          if (vcEngineUiDom(t)) return true;',
      '          if (false) return true;   // 变异：不再排除引擎 UI 窗口'],
    ['M-VC8 引擎就绪前就把备路结论锁死（引擎加载前点过屏幕/助手界面就整局走备路）',
      '          return "touch";',
      '          vcS.mode = "touch"; return vcS.mode;   // 变异：未就绪也把结论定死'],
    ['M-VC9 合成手势退回一帧内全发完（俯仰按钮 Δ=0）',
      '        vcSynEmit(items);',
      '        items.forEach(function (it) { if (it.t === "end") vcSynEnd(); else vcSynMove(it.mid, it.sub, it.ang, it.dist, it.dy); });   // 变异：一帧内全发完'],
    ['M-VC10 备路重置改回按累计量一次算死（不回读当前真实角度）',
      '        var o = vcS.origin, cur = vcAngle(), live = !!(cur && o);',
      '        var o = vcS.origin, cur = null, live = false;   // 变异：不看当前真实角度'],
    ['M-VC11 备路缩放纠偏不再钳单段手势（两指间距越过 0 → 缩放被反向拉到底）',
      'var zm = Math.abs(dz) / (VC_ZOOM_STEP * 15), zmax = (VC_D0 - 12) / VC_DZ;',
      'var zm = Math.abs(dz) / (VC_ZOOM_STEP * 15), zmax = 99;   // 变异：不钳'],
    ['M-VC12 合成手势 touchstart 退回同步发（上一段迟到的 touchend 把新手势一起关掉 → 拖拽被吃）',
      '        vcQPush({ t: "start", mid: { x: mid.x, y: mid.y }, sub: sub });\n        return true;',
      '        vcSynStartNow({ x: mid.x, y: mid.y }, sub); return true;   // 变异：同步发 touchstart'],
    // V2.38.11/12 新增变异：左键守卫 / 静止右键 / 菜单抑制 / 左键合成 四条红线。剔除记录（F2，落盘写明）：
    //   · M-VC15「左键守卫退回宽排除 vcInUi」—— V2.38.12 起**恢复并列为 mustDie**（审计判定当初「与 p.btn===2 守卫等效」的剔除理由不成立）。
    //   · M-VC18「左键守卫退回 vcInUi（旧命名）」—— 剔除理由成立：vcLeftGateCheck 取源时回退 `w.src || ""`，而变异世界的
    //     w.src 是空串（vcWorld 只给切片），源码正则必然失败 → 那是「空源码假阳性击杀」，不是真实断言杀死；
    //     同一条风险现由 M-VC15 的行为级断言（可区分桩 + 合成触摸序列）正面覆盖。
        ["M-VC19 F4 退化：UI 上的右键不再清零抑制标志（吞掉下一次原生菜单）",
      "            vcCtxOnce = 0;         // F4：任何右键按下都先清零（含引擎/助手 UI 上的右键）—— 否则上一次没被消费的抑制标志会吞掉这次原生菜单\n            if (vcInUi(e.target)) return;   // 右键拖拽仍用宽排除（与滚轮同口径）：引擎活动 UI / 助手 UI 上一律不接管（标志此时已清零）",
      "            if (vcInUi(e.target)) return;   // 变异：先判 UI 再清零\n            vcCtxOnce = 0;"],
        ["M-VC20 F5 退化：菜单抑制不再校验目标（UI 上弹的菜单也被吞）",
      "          if (vcInUi(e.target)) {   // F5：只对它自己 claim 的那次拖拽生效，且目标必须仍在游戏区域；UI 上弹的菜单一律放行\n            vcCtxOnce = 0;          //    但标志照样清零：平台若在 mousedown 阶段就发 contextmenu（拖拽中弹出），也不会把它留到下一次右键\n            return;\n          }",
      "          // 变异：去掉目标校验（保留 try 结构，避免语法错误假击杀）"],
    ["M-VC15 左键守卫退回宽排除 vcInUi（引擎活动 UI 的 DOM 上左键不再合成触摸）",
      "          if (simInUi(e.target)) return;   // 左键恢复 V2.38.8 排除语义：引擎界面 DOM 的 button/a/input、intersect=false 处**不**排除",
      "          if (vcInUi(e.target)) return;   // 变异：左键守卫换回宽排除"],
    ["M-VC13 静止右键也拦菜单（右键菜单被无条件 preventDefault）",
      "          if (!vcCtxOnce) return;   // 静止右键点击 / 阈值内的右键移动：一律不拦（浏览器与游戏自己处理）",
      "          if (false) return;   // 变异：无条件拦"],
    ["M-VC14 右键拖拽不抑制菜单（命中阈值也不欠这一次抑制）",
      "            if (p.btn === 2) vcCtxOnce = 1;   // V2.38.11：只有「确实超过阈值的右键拖拽」才抑制这一次右键菜单",
      "            if (false) vcCtxOnce = 1;   // 变异：不抑制"],
    ["M-VC16 左键不再合成触摸（手机页左键点不动，含 NPC 对话）",
      "          var ta = simMkTouch(e.clientX, e.clientY, e.target);",
      "          var ta = null;   // 变异：左键不合成"],
    ["M-VC17 静止右键点击也合成触摸（点一下就走一步）",
      "          if (p.claimed) { if (p.mode === \"touch\" && p.sub) vcQPush({ t: \"end\", wait: 1 }); return; }   // F-B：末帧之后再 touchend\n          if (p.btn === 2) return;   // V2.38.11：静止右键点击按原样 —— 不合成触摸、不拦菜单（右键菜单照旧由游戏/浏览器处理）",
      "          if (p.claimed) { if (p.mode === \"touch\" && p.sub) vcQPush({ t: \"end\", wait: 1 }); return; }   // F-B：末帧之后再 touchend\n          if (false) return;   // 变异：静止右键也合成"],
  ];
  for(const [name,src] of VC_FILES_SRC){
    for(const [label,from,to] of MUT){
      let killed=false,msg='';
      assert.equal(vcBody(src).split(from).length-1,1,name+' 变异锚点必须唯一（锚点自身有问题不算杀死）：'+label);
      try{
        const opt=label.indexOf('M-VC8')===0?{dead:true}:((label.indexOf('M-VC9')===0||label.indexOf('M-VC10')===0||label.indexOf('M-VC11')===0||label.indexOf('M-VC12')===0)?{noCam:true}:{noCam:label.indexOf('备路')===0});
        const w=vcWorld(src,[from,to],opt);
        if(label.indexOf('M-VC8')===0)vcModeCheck(w,name);
        else if(label.indexOf('M-VC9')===0)vcPitchCheck(w,name);
        else if(label.indexOf('M-VC10')===0)vcFixCheck(w,name);
        else if(label.indexOf('M-VC11')===0)vcZoomResetCheck(w,name);
        else if(label.indexOf('M-VC12')===0)vcPendingDragCheck(w,name);
        else if(label.indexOf('M-VC7')===0)vcGuardCheck(w,name);else if(label.indexOf('M-VC6')===0)vcCamCheck(w,name);
        else if(label.indexOf('M-VC4')===0)vcGuardCheck(w,name);
        else if(label.indexOf('M-VC3')===0)vcGuardCheck(w,name);
        else if(label.indexOf('M-VC13')===0||label.indexOf('M-VC14')===0||label.indexOf('M-VC15')===0||label.indexOf('M-VC16')===0||label.indexOf('M-VC17')===0)vcGuardCheck(w,name);
        else if(label.indexOf('M-VC19')===0||label.indexOf('M-VC20')===0)vcGuardCheck(w,name);
        else vcCamCheck(w,name);
      }catch(e){killed=true;msg=e&&e.message||String(e);}
      assert.ok(killed,name+' 变异体必须被真实行为断言杀死：'+label);
      console.log('[V2.38.9 变异]['+name+'] '+label+' 被杀死：'+String(msg).split(String.fromCharCode(10))[0].slice(0,110));
    }
  }
});
test('V2.38.9 F6：公开入口 teleport(map,{x,y}) 真行为调用（帧、券、type、拒绝路径）（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    const w=tpWorld(src);
    const r=w.teleport('iz_dun02',{x:120,y:30});
    assert.equal(r&&r.ok,true,name+' teleport(map,{x,y}) 必须真的发出（不是死代码）');
    assert.equal(w.sent.length,1,name+' 一次调用只发一个包');
    const v=w.sent[0].build().view;
    assert.equal(v.getUint16(0,true),2633,name+' opcode 2633');
    assert.equal(v.getUint32(18,true),120,name+' x 必须进包');
    assert.equal(v.getUint32(22,true),30,name+' y 必须进包');
    assert.equal(v.getUint32(26,true),1,name+' 默认 type=1');
    assert.equal(v.getUint32(30,true),14527,name+' 券 14527 必须进包');
    assert.equal(w.teleport('prontera',{x:5,y:6,type:0}).ok,true,name+' type=0 也必须能发');
    assert.equal(w.sent[1].build().view.getUint32(26,true),0,name+' type=0 必须原样进包');
    assert.equal(w.teleport('Bad Map!',{x:1,y:2}).ok,false,name+' 非法地图必须拒绝');
    assert.equal(w.sent.length,2,name+' 拒绝时绝不发包（零假成功）');
    console.log('[F6 teleport]['+name+'] 72B 帧 opcode/坐标/type/券 全部行为核对通过');
  }
});
test('V2.38.9 F7：守卫加回——PRIVATE_AIRSHIP_REQUEST 只允许出现在注释里（两文件）',()=>{
  for(const [name,src] of TP_FILES_SRC){
    const lines=src.split(/\r?\n/).filter(l=>l.indexOf('PRIVATE_AIRSHIP_REQUEST')>=0);
    assert.ok(lines.length>0,name+' 白名单断言必须能命中（否则守卫形同虚设）');
    for(const l of lines)assert.ok(/^\s*\/\//.test(l),name+' 裸引用（非注释）必须为 0：'+l.trim().slice(0,120));
    assert.ok(!src.includes('new CLIENT.PS.CZ.PRIVATE_AIRSHIP_REQUEST'),name+' 不许 new 客户端类');
    console.log('[F7 守卫]['+name+'] '+lines.length+' 处引用全部在注释里');
  }
});
// ================= 契约 v2：道场联调（外部代打 / 对外传送）=================
test('契约 v2：外部代打期间 npHuntMode 强制 self，无代打时按控件原值（VM）',()=>{
  const code=extract('  function npHuntMode() {','  // V2.33.0 混合寻怪');
  const mk=(el,combat)=>{const ctx={apiCombat:combat||null,$id:()=>el};vm.createContext(ctx);vm.runInContext(code+';this.f=npHuntMode',ctx);return ctx.f();};
  assert.equal(mk({value:'np'},null),'np','无代打时必须原样返回控件值');
  assert.equal(mk({value:'hybrid'},null),'hybrid');
  assert.equal(mk({value:'np'},{owner:'builtin-dojo'}),'self','代打期间必须强制自研直走寻怪');
  assert.equal(mk({value:'hybrid'},{owner:'builtin-dojo'}),'self');
  assert.equal(mk(null,null),'self','读不到控件时仍按 self');
  assert.equal(mk({value:'np'},null),'np','代打结束后必须恢复原值');
});
test('契约 v2：代打启动/停止、幂等与租约校验（VM）',()=>{
  const code=extract('  var apiCombat=null;','  function apiEmit(kind,detail)');
  const J=v=>JSON.parse(JSON.stringify(v));
  function mk(o){
    o=o||{};
    const st={intervals:0,cleared:0,attacks:0,inner:0,want:null,ms:0,fn:null,clearedId:null};
    const ctx={apiGuard:()=>o.guard||null,zRunning:!!o.busy,apiLease:{owner:'builtin-dojo',generation:3,scopes:['battle']},
      zLock:{gid:1,name:'x',dist:3,done:true,reactive:true},zMon:{action:''},zUseCounts:{a:1},zLockCounts:{b:1},zCastIdx:2,
      zAtkLast:{gid:7,at:9,outOfRange:true},npBattleState:()=>o.npHunt===false?false:true,
      npRequestBattle:(want,src,opt)=>{st.inner++;st.want=[want,src,opt];return 'sent';},
      tlog:()=>{},$id:id=>id==='dsh-z-attint'?(o.att===undefined?{value:'0.4'}:o.att):null,
      setInterval:(fn,ms)=>{st.intervals++;st.fn=fn;st.ms=ms;return 7;},clearInterval:id=>{st.cleared++;st.clearedId=id;},
      zAttack:()=>st.attacks++,Date:{now:()=>1000},Math,Number,parseFloat,isFinite};
    vm.createContext(ctx);vm.runInContext(code+';this.C={apiCombatActive,apiCombatStart,apiCombatStop};this.get=()=>apiCombat;',ctx);
    return {ctx,st};
  }
  const a=mk();
  assert.deepEqual(J(a.ctx.C.apiCombatStart('builtin-dojo')),{ok:true,result:'started'});
  assert.equal(a.st.intervals,1,'必须开代打定时器');assert.equal(a.st.ms,400,'间隔必须取 #dsh-z-attint 的秒数');
  assert.equal(a.st.inner,1,'原先内挂开着时只发一次关闭');assert.deepEqual(J(a.st.want),[false,'external:builtin-dojo',true]);
  assert.equal(a.ctx.C.apiCombatActive(),true);assert.equal(a.ctx.zLock.gid,null);assert.equal(a.ctx.zCastIdx,0);assert.equal(a.ctx.zUseCounts.a,undefined);assert.equal(a.ctx.zMon.action,'外部代打启动');
  a.st.fn();assert.equal(a.st.attacks,1,'定时器必须驱动助手自己的 zAttack');
  assert.deepEqual(J(a.ctx.C.apiCombatStart('builtin-dojo')),{ok:true,result:'already'},'同租约重复启动必须幂等');
  assert.equal(a.st.intervals,1,'幂等不得再开定时器');
  assert.deepEqual(J(a.ctx.C.apiCombatStart('other-script')),{ok:false,error:'combat-owned'},'别的租约不能接管');
  a.ctx.C.apiCombatStop();
  assert.equal(a.st.cleared,1);assert.equal(a.st.clearedId,7);assert.equal(a.ctx.get(),null);assert.equal(a.ctx.C.apiCombatActive(),false);assert.equal(a.ctx.zMon.action,'外部代打已停止');
  assert.equal(a.st.inner,1,'代打期间不得再发内挂包');
  const b=mk({busy:true});assert.deepEqual(J(b.ctx.C.apiCombatStart('builtin-dojo')),{ok:false,error:'assistant-busy'});assert.equal(b.st.intervals,0,'助手挂机在跑时不得抢控制');
  const c=mk({guard:{ok:false,error:'lease-required'}});assert.deepEqual(J(c.ctx.C.apiCombatStart('builtin-dojo')),{ok:false,error:'lease-required'});
  const d=mk({npHunt:false});assert.deepEqual(J(d.ctx.C.apiCombatStart('builtin-dojo')),{ok:true,result:'started'});assert.equal(d.st.inner,0,'原先没开内挂时一个内挂包都不发');
  const e=mk({att:{value:'abc'}});assert.deepEqual(J(e.ctx.C.apiCombatStart('builtin-dojo')),{ok:true,result:'started'});assert.equal(e.st.ms,250,'读不到/非法间隔必须退回 0.25 秒');
});
test('契约 v2：apiRelease 必须先停代打再释放租约（VM）',()=>{
  const code=extract('  function apiRelease(owner)','  function apiContact(owner,gid)');
  const order=[];
  const ctx={apiLease:{owner:'builtin-dojo',generation:1,scopes:['battle'],battle:{state:'none'}},apiCombat:{owner:'builtin-dojo',generation:1},
    apiCombatStop:()=>order.push('combat-stop'),apiBattleTick(){},apiClearBattleTarget:()=>order.push('clear-target'),
    npBattleState:()=>false,npZeroBattle:()=>order.push('zero'),npClearBattleIntent:()=>order.push('clear-intent'),npRequestBattle:()=>order.push('inner'),
    apiEmit(){},moveXY:{},arrowTarget:null,arrowPending:null,arrowReady:false,arrowBlocked:false,zRunning:true};
  vm.createContext(ctx);vm.runInContext(code+';this.release=apiRelease',ctx);
  const r=JSON.parse(JSON.stringify(ctx.release('builtin-dojo')));
  assert.deepEqual(order.slice(0,2),['combat-stop','clear-target'],'必须先停代打，再清战斗目标');
  assert.deepEqual(r,{ok:true});
  assert.equal(ctx.apiLease,null,'释放完成后租约必须清空');
});
test('契约 v2：apiTeleport 守卫与参数校验，失败一律 {ok:false,error}（VM）',()=>{
  const code=extract('  function apiTeleport(owner,payload){','  function apiChoose(owner,payload)');
  const J=v=>JSON.parse(JSON.stringify(v));
  const calls=[];
  function mk(guard,tp){
    const ctx={apiGuard:()=>guard||null,tpSend:(m,x,y,o)=>{calls.push([m,x,y,o]);return tp||{ok:true,map:m,x:x,y:y,bytes:9};},Number,String,Array,Object,Math,isFinite,parseFloat};
    vm.createContext(ctx);vm.runInContext(code+';this.t=apiTeleport',ctx);return ctx;
  }
  assert.deepEqual(J(mk({ok:false,error:'lease-required'}).t('o',{map:'prontera'})),{ok:false,error:'lease-required'},'守卫失败必须原样返回');
  assert.deepEqual(J(mk(null).t('o',null)),{ok:false,error:'invalid-map'});
  const a=mk(null);
  assert.deepEqual(J(a.t('o',{map:'prontera',x:1})),{ok:false,error:'invalid-position'},'只给 x 必须拒绝');
  assert.deepEqual(J(a.t('o',{map:'prontera',x:'1.5',y:2})),{ok:false,error:'invalid-position'},'非整数必须拒绝');
  assert.deepEqual(J(a.t('o',{map:'prontera',x:-1,y:2})),{ok:false,error:'invalid-position'},'负坐标必须拒绝');
  assert.deepEqual(J(a.t('o',{map:'prontera',x:1,y:70000})),{ok:false,error:'invalid-position'},'越界坐标必须拒绝');
  assert.deepEqual(J(a.t('o',{map:'prontera'})),{ok:true,map:'prontera',x:null,y:null,bytes:9},'只给地图（不带坐标）必须放行');
  assert.deepEqual(calls.at(-1),['prontera',null,null,null],'不带坐标必须按 tpSend(map,null,null,null) 委托');
  assert.deepEqual(J(a.t('o',{map:'prontera',x:148,y:147})),{ok:true,map:'prontera',x:148,y:147,bytes:9});
  assert.deepEqual(calls.at(-1),['prontera',148,147,null],'必须复用既有 tpSend，不新造发包逻辑');
  assert.equal(calls.length,2,'非法参数不得进到发送层');
  const f=mk(null,{ok:false,why:'teleport-blocked'});
  assert.deepEqual(J(f.t('o',{map:'prontera',x:1,y:2})),{ok:false,error:'teleport-blocked'},'tpSend 失败必须把 why 原文带回');
  const g=mk(null,{ok:false});
  assert.deepEqual(J(g.t('o',{map:'prontera',x:1,y:2})),{ok:false,error:'teleport-failed'},'没有 why 时给 teleport-failed');
});
test('契约 v2：assistCombat 是新代打入口，代打期间 requestBattle(true) 必须被拒（VM）',()=>{
  const code=extract('  function apiBattle(owner,on){','  function apiAssistCombat(owner,on){')+extract('  function apiAssistCombat(owner,on){','  function apiSetArrow(owner,target)');
  const J=v=>JSON.parse(JSON.stringify(v));
  function mk(o){
    o=o||{};
    const st={inner:0,started:0,stopped:0};
    const ctx={apiGuard:()=>o.guard||null,apiBattleTick(){},apiLease:{owner:'owner-123',generation:4,battle:{state:'none'}},
      npBattleState:()=>o.np===undefined?null:o.np,apiCurrent:()=>true,npRequestBattle:(...a)=>{st.inner++;st.args=a;return 'sent';},
      apiCombat:o.combat||null,apiCombatStart:()=>{st.started++;return o.startResult||{ok:true,result:'started'};},apiCombatStop:()=>{st.stopped++;},
      Date:{now:()=>1},Math,Number,String,Array,Object,isFinite};
    vm.createContext(ctx);vm.runInContext(code+';this.C={apiBattle,apiAssistCombat};',ctx);
    return {ctx,st};
  }
  const a=mk();
  assert.deepEqual(J(a.ctx.C.apiBattle('owner-123',true)),{ok:true,result:'unknown'},'内挂状态未知时老入口保持原语义');
  assert.equal(a.st.inner,0,'未知状态不得发内挂包');
  const b=mk({np:false});
  assert.deepEqual(J(b.ctx.C.apiBattle('owner-123',true)),{ok:true,result:'sent'},'状态明确时老入口仍按原语义工作');
  assert.equal(b.st.inner,1);
  const c=mk({combat:{owner:'owner-123'}});
  assert.deepEqual(J(c.ctx.C.apiBattle('owner-123',true)),{ok:false,error:'combat-owned'},'代打期间禁止再开内挂');
  assert.equal(c.st.inner,0,'被拒时不得发任何内挂包');
  const d=mk();
  assert.deepEqual(J(d.ctx.C.apiAssistCombat('owner-123',true)),{ok:true,result:'started'});
  assert.equal(d.st.started,1);assert.equal(d.st.inner,0,'代打入口绝不碰内挂');
  assert.deepEqual(J(d.ctx.C.apiAssistCombat('owner-123',false)),{ok:true,result:'stopped'});
  assert.equal(d.st.stopped,1);
  assert.deepEqual(J(d.ctx.C.apiAssistCombat('owner-123','x')),{ok:false,error:'invalid-payload'});
  const e=mk({guard:{ok:false,error:'lease-required'}});
  assert.deepEqual(J(e.ctx.C.apiAssistCombat('owner-123',true)),{ok:false,error:'lease-required'});
  const f=mk({startResult:{ok:false,error:'assistant-busy'}});
  assert.deepEqual(J(f.ctx.C.apiAssistCombat('owner-123',true)),{ok:false,error:'assistant-busy'},'代打启动失败必须原样回传');
});

// ================= V2.38.13：取消换箭 / 传送权限 / 战斗准备 / 自动拾取 / 代打零内挂包 =================
const A23813 = (s, a, b) => { const t = String(s); const i = t.indexOf(a); const j = t.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, "提取失败: " + a.slice(0, 60)); return t.slice(i, j); };
const M23813 = (src, from, to) => { const s = String(src).replace(/\r\n/g, "\n"); assert.equal(s.split(from).length - 1, 1, "变异锚点必须唯一: " + from.slice(0, 70)); return s.replace(from, to); };
const J23813 = (v) => JSON.parse(JSON.stringify(v));

test("V2.38.13 R1 助手换箭自主接管：租约不含 arrow 必须自己换箭，含 arrow 一律让位（VM）", () => {
  const code = A23813(expSource, "  function arrowSelfTick(now){", "  function arrowEnsureHost(){");
  assert.ok(code.includes('externalAutomationOwns("arrow")'), "助手换箭必须真的去看租约是否含 arrow");
  const run = (script, ownsArrow) => {
    const clock = 10000; const equipped = [];
    const ctx = { Number, String, Date: { now: () => clock },
      arrowRules: { enabled: true, defaultItid: 1802, byMid: {}, byElem: {} },
      arrowTarget: null, arrowSelfPending: null, arrowStickyBoss: null,
      externalAutomationOwns: () => ownsArrow, clientReady: () => true,
      arrowCurrentMid: () => 0, arrowMobGone: () => false,
      arrowPos: (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; },
      arrowStableGate: (key, now) => { if (ctx.__gk !== key) { ctx.__gk = key; ctx.__ga = now; return false; } return now - ctx.__ga >= 1500; },
      readEquippedAmmo: () => ({ itid: 1757, count: 50 }), readBagArrows: () => [{ index: 7, itid: 1802, count: 30 }],
      equipArrow: (i) => { equipped.push(i); return true; },
      arrowItemName: (i) => "IT" + i, arrowSelfSay: () => {}, arrowSay: () => {},
      arrowUseQuiver: () => null, arrowEffectiveMid: (mid) => ({ mid, sticky: false }),
      arrowMobName: () => "怪", arrowBoss: () => false, arrowKindName: (k) => k, arrowCandidates: () => [],
      arrowPickSay: () => "换箭", ARROW_PLAIN_ITID: 1750, mobElemName: () => "",
      __gk: "", __ga: 0,
    };
    ctx.context = ctx; vm.createContext(ctx); vm.runInContext(script, ctx);
    ctx.arrowSelfTick(clock); ctx.arrowSelfTick(clock + 1600);
    return equipped;
  };
  assert.equal(JSON.stringify(run(code, false)), "[7]", "租约不含 arrow：助手必须自己走到换箭决策路径并装回默认箭（可观测装备动作）");
  assert.equal(JSON.stringify(run(code, true)), "[]", "租约含 arrow：助手换箭必须被抑制（一个装备动作都不做）");
  // 变异 M-R1a：删掉「被外部接管就让位」这一道门 → 第二对必须红
  const mut = M23813(expSource, '||externalAutomationOwns("arrow")||', "||");
  const mutCode = A23813(mut, "  function arrowSelfTick(now){", "  function arrowEnsureHost(){");
  assert.equal(JSON.stringify(run(mutCode, true)), "[7]", "变异体删掉让位门后含 arrow 的租约也会自己换箭（说明该断言能抓到这个缺陷）");
});

test("V2.38.13 R2 传送权限：movement 或 fly 任一即可，两者都没有一律 lease-required（VM）", () => {
  const guard = A23813(source, "  function apiHas(owner,scope){", "  function apiBattleTargetEntity(target){");
  const mk = (script) => {
    const body = A23813(script, "  function apiTeleport(owner,payload){", "    var hasX=payload.x!=null") + '    return {ok:true,gate:"passed"};\n  }';
    const run = (scopes) => {
      const ctx = { clientReady: () => true, apiLease: { owner: "o", generation: 1, scopes: scopes } };
      vm.createContext(ctx); vm.runInContext(guard + body + ";this.t=apiTeleport", ctx);
      return J23813(ctx.t("o", { map: "prontera", x: 148, y: 147 }));
    };
    return run;
  };
  const run = mk(source);
  assert.equal(run(["movement"]).ok, true, "只持 movement 必须能调传送");
  assert.equal(run(["fly"]).ok, true, "只持 fly 必须能调传送（语义交给服务器 2634 回包判定）");
  assert.equal(run(["battle"]).error, "lease-required", "两个都没有必须 lease-required");
  assert.equal(run(["dialog"]).error, "lease-required");
  assert.equal(run([]).error, "lease-required");
  // 变异 M-R2：退回「只认 movement」→ 只持 fly 必须红
  const mut = M23813(source, 'var bad=apiGuard(owner,"movement"); if(bad&&bad.error==="lease-required")bad=apiGuard(owner,"fly"); if(bad)return bad;', 'var bad=apiGuard(owner,"movement"); if(bad)return bad;');
  assert.equal(mk(mut)(["fly"]).error, "lease-required", "变异体只认 movement，只持 fly 的租约被拒（说明该断言能抓到这个缺陷）");
  assert.equal(mk(mut)(["movement"]).ok, true, "变异体仍放行 movement（证明变异不是把整段删空）");
});

test("V2.38.13 R3 prepareCombat：清当前档锁定名单 + 改打全部怪，租约外拒绝，幂等（VM）", () => {
  const boot = (script) => {
    const h = A23813(script, "  var PICKUP_WALK_OFF = true;", "  var wl = (function () {");
    const g = A23813(script, "  function apiHas(owner,scope){", "  function apiCurrent(owner,generation){")
      + A23813(script, "  function apiGuard(owner,scope){", "  function apiBattleTargetEntity(target){");
    const blk = A23813(script, "  // ================= V2.38.13 外部租约战斗准备 / 拾取开关 =================", "  // ================= V2.38.13 结束 =================");
    assert.ok(blk.includes("function apiPrepareCombat(owner, opts)"), "提取必须命中战斗准备块");
    assert.ok(g.includes("function apiGuard(owner,scope){"), "提取必须覆盖 apiGuard（FIX-3 的 scope 门就是它）");
    const calls = { save: 0, render: 0, sync: 0 };
    const box = { checked: false };
    const ctx = { clientReady: () => true,
      apiLease: { owner: "ext", generation: 1, scopes: ["dojo", "battle"] },
      lockList: { "1002": { name: "A" }, "1003": { name: "B" } },
      activeProfileKey: () => "p1", profileTrusted: () => true,
      profileLockSave: () => calls.save++, renderLockList: () => calls.render++, npSyncTargets: () => calls.sync++,
      $id: (id) => (id === "dsh-z-allmobs" ? box : null), pendingPick: 1, CLIENT: {}, requireDB: () => null };
    vm.createContext(ctx);
    vm.runInContext(g + h + blk + ";this.prep=apiPrepareCombat;this.pick=apiRequestPickup;this.restore=apiAllMobsRestore;this.walk=pickupWalkAllowed;this.wants=apiPickupWants;this.reset=apiPickupReset", ctx);
    return { ctx, calls, box };
  };
  const out = boot(source);
  out.ctx.apiLease = null;
  assert.equal(J23813(out.ctx.prep("ext", { clearLocks: true, allMobs: true })).error, "lease-required", "非租约持有者调用必须拒绝");
  assert.equal(Object.keys(out.ctx.lockList).length, 2, "被拒绝时一个条目都不能动");
  const t = boot(source);
  t.ctx.profileTrusted = () => false;
  assert.equal(J23813(t.ctx.prep("ext", { clearLocks: true })).error, "profile-untrusted");
  assert.equal(Object.keys(t.ctx.lockList).length, 2, "未识别档案时一个条目都不能删");
  const a = boot(source);
  const r = J23813(a.ctx.prep("ext", { clearLocks: true, allMobs: true }));
  assert.equal(r.ok, true);
  assert.equal(r.cleared, 2, "必须报出清掉的条数");
  assert.equal(Object.keys(a.ctx.lockList).length, 0, "当前角色档的锁定名单必须被清空");
  assert.equal(a.calls.save, 1, "必须走档案持久化（不能只改内存）");
  assert.equal(a.calls.render, 1, "必须刷新名单界面");
  assert.equal(a.calls.sync, 1, "必须按空名单同步一次");
  assert.equal(a.box.checked, true, "必须勾上「打全部怪」");
  assert.equal(r.allMobsRestore, false, "必须记下原值（原本没勾）");
  const r2 = J23813(a.ctx.prep("ext", { clearLocks: true, allMobs: true }));
  assert.equal(r2.ok, true);
  assert.equal(r2.cleared, 0, "第二次没有可清的条目（幂等）");
  assert.equal(r2.allMobsRestore, false, "原值必须仍是第一次记下的");
  const b = boot(source);
  b.box.checked = true;
  assert.equal(J23813(b.ctx.prep("ext", { allMobs: true })).allMobsRestore, true, "原本已勾选时必须记下 true");
  assert.equal(b.ctx.restore(), true);
  assert.equal(b.box.checked, true, "原本是开 → 还原成开");
  // FIX-3：只申请 dialog 权限的租约不得清名单 / 强开「打全部怪」——必须被 scope 门挡住且零副作用
  const scoped = boot(source);
  scoped.ctx.apiLease = { owner: "ext", generation: 1, scopes: ["dialog"] };
  assert.equal(J23813(scoped.ctx.prep("ext", { clearLocks: true, allMobs: true })).error, "lease-required", "只持 dialog 不得调 prepareCombat");
  assert.equal(Object.keys(scoped.ctx.lockList).length, 2, "被 scope 门拒绝时名单一条都不能动");
  assert.equal(scoped.box.checked, false, "被 scope 门拒绝时不得改「打全部怪」");
  assert.equal(scoped.calls.save + scoped.calls.render + scoped.calls.sync, 0, "被 scope 门拒绝时零持久化 / 零渲染 / 零同步");
  // 变异 M-FIX3a：删掉 dojo scope 门 → 上面那条「只持 dialog 必须被拒」必然红
  const mutScope = M23813(source, '      var badScope = apiGuard(owner, "dojo"); if (badScope) return badScope; ', "");
  const sc = boot(mutScope);
  sc.ctx.apiLease = { owner: "ext", generation: 1, scopes: ["dialog"] };
  assert.equal(J23813(sc.ctx.prep("ext", { clearLocks: true, allMobs: true })).ok, true, "变异体只持 dialog 也能清名单（说明该断言能抓到这个缺陷）");
  assert.equal(Object.keys(sc.ctx.lockList).length, 0, "变异体确实动了名单");
  // 变异 M-R3a：prepareCombat 不清名单 → 上面「名单清空」断言必须红
  const mutList = M23813(source, "          lockList = {};\n          profileLockSave();", "          profileLockSave();");
  const m2 = boot(mutList);
  J23813(m2.ctx.prep("ext", { clearLocks: true }));
  assert.equal(Object.keys(m2.ctx.lockList).length, 2, "变异体不清名单：条目仍在（说明该断言能抓到这个缺陷）");
});

test("V2.38.13 R3b apiRelease 必须还原「打全部怪」并收起自动拾取（VM）+ 变异 M-R3b", () => {
  const mk = (script) => {
    const code = A23813(script, "  function apiRelease(owner)", "  function apiContact(owner,gid)");
    const order = [];
    const ctx = { apiLease: { owner: "builtin-dojo", generation: 1, scopes: ["battle"], battle: { state: "none" } },
      apiCombat: { owner: "builtin-dojo", generation: 1 }, apiCombatStop: () => order.push("combat-stop"),
      apiAllMobsRestore: () => { order.push("allmobs-restore"); return true; }, apiPickupReset: () => { order.push("pickup-reset"); return true; },
      apiBattleTick() {}, apiClearBattleTarget: () => order.push("clear-target"), npBattleState: () => false, npZeroBattle: () => order.push("zero"),
      npClearBattleIntent: () => order.push("clear-intent"), npRequestBattle: () => order.push("inner"), apiEmit() {}, moveXY: {},
      arrowTarget: null, arrowPending: null, arrowReady: false, arrowBlocked: false, zRunning: true };
    vm.createContext(ctx); vm.runInContext(code + ";this.release=apiRelease", ctx);
    return { order, res: J23813(ctx.release("builtin-dojo")) };
  };
  const a = mk(source);
  assert.equal(a.res.ok, true);
  assert.ok(a.order.indexOf("allmobs-restore") >= 0, "释放租约必须还原「打全部怪」的原值");
  assert.ok(a.order.indexOf("pickup-reset") >= 0, "释放租约必须收起自动拾取");
  assert.ok(a.order.indexOf("combat-stop") < a.order.indexOf("allmobs-restore"), "必须先停代打再还原");
  const mut = M23813(source, 'apiCombatStop();if(typeof apiAllMobsRestore==="function")apiAllMobsRestore();', "apiCombatStop();");
  const b = mk(mut);
  assert.equal(b.order.indexOf("allmobs-restore"), -1, "变异体释放时不还原（说明该断言能抓到这个缺陷）");
  assert.ok(b.order.indexOf("pickup-reset") >= 0, "变异只删还原那一处，收起拾取仍在（证明变异是定点的）");
});

test("V2.38.13 R4 requestPickup：只认卡片6/装备4/防具5，类型过滤、租约外拒绝、off 复位（VM）", () => {
  const helpers = A23813(source, "  var PICKUP_WALK_OFF = true;", "  var wl = (function () {");
  const block = A23813(source, "  // ================= V2.38.13 外部租约战斗准备 / 拾取开关 =================", "  // ================= V2.38.13 结束 =================");
  const TYPES = { 3001: { type: 6 }, 1101: { type: 4 }, 2101: { type: 5 }, 501: { type: 0 }, 1201: { type: 2 }, 601: { type: 11 }, 9999: null };
  const boot = (script) => {
    const h = A23813(script, "  var PICKUP_WALK_OFF = true;", "  var wl = (function () {");
    const blk = A23813(script, "  // ================= V2.38.13 外部租约战斗准备 / 拾取开关 =================", "  // ================= V2.38.13 结束 =================");
    const g = A23813(script, "  function apiHas(owner,scope){", "  function apiCurrent(owner,generation){")
      + A23813(script, "  function apiGuard(owner,scope){", "  function apiBattleTargetEntity(target){");
    assert.ok(g.includes("function apiGuard(owner,scope){"), "提取必须覆盖 apiGuard（FIX-3 的 scope 门就是它）");
    const hk = { hooks: 0 };
    const ctx = { clientReady: () => true, apiLease: { owner: "ext", generation: 1, scopes: ["battle"] },
      lockList: {}, activeProfileKey: () => "p1", profileTrusted: () => true, profileLockSave: () => {}, renderLockList: () => {}, npSyncTargets: () => {},
      $id: () => null, hookItemObjects: () => { hk.hooks++; }, zLock: { gid: null }, apiCombatActive: () => false,
      gidInt: (v) => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; },
      CLIENT: { DB: { getItemInfo: (itid) => TYPES[itid] || null } }, requireDB: () => null };
    vm.createContext(ctx);
    vm.runInContext(g + h + blk + ";this.pick=apiRequestPickup;this.walk=pickupWalkAllowed;this.wants=apiPickupWants;this.mayWalk=pickupMayWalk;this.restore=apiAllMobsRestore", ctx);
    ctx.__hk = hk;
    return ctx;
  };
  const ctx = boot(source);
  assert.equal(ctx.walk(), false, "默认必须仍是关（普通用户行为一字不变）");
  assert.equal(J23813(ctx.pick("ext", {})).error, "invalid-payload", "非法载荷必须拒绝");
  assert.equal(J23813(ctx.pick("ext", { on: true })).error, "invalid-types", "没配类型必须拒绝");
  assert.equal(J23813(ctx.pick("ext", { on: true, types: [0, 2] })).error, "invalid-types", "一个有效类型都没有必须拒绝");
  const on = J23813(ctx.pick("ext", { on: true, types: [4, 5, 6] }));
  assert.equal(on.ok, true);
  assert.equal(JSON.stringify(on.types), "[4,5,6]");
  assert.equal(ctx.walk(), true, "打开后走路拾取才被放行");
  assert.equal(ctx.wants(3001), true, "卡片(6)必须捡");
  assert.equal(ctx.wants(1101), true, "装备武器(4)必须捡");
  assert.equal(ctx.wants(2101), true, "装备防具(5)必须捡");
  assert.equal(ctx.wants(501), false, "消耗品(0)不得捡");
  assert.equal(ctx.wants(1201), false, "使用品(2)不得捡");
  assert.equal(ctx.wants(601), false, "其它类型(11)不得捡");
  assert.equal(ctx.wants(9999), false, "查不到物品信息的不得捡");
  assert.equal(JSON.stringify(J23813(ctx.pick("ext", { on: true, types: [0, 2, 6] })).types), "[6]", "只保留卡片/装备/防具三类");
  const off = J23813(ctx.pick("ext", { on: false }));
  assert.equal(off.ok, true);
  assert.equal(ctx.walk(), false, "off 后必须恢复默认关闭");
  assert.equal(ctx.wants(3001), false, "off 后不再捡");
  ctx.apiLease = { owner: "other", generation: 1, scopes: ["battle"] };
  assert.equal(J23813(ctx.pick("ext", { on: true, types: [6] })).error, "lease-required", "租约外一律拒绝");
  // FIX-3：只申请 dialog 权限的租约不得打开自动拾取（零拾取包、零副作用）
  const scoped = boot(source);
  scoped.apiLease = { owner: "ext", generation: 1, scopes: ["dialog"] };
  assert.equal(J23813(scoped.pick("ext", { on: true, types: [4, 5, 6] })).error, "lease-required", "只持 dialog 不得调 requestPickup");
  assert.equal(scoped.walk(), false, "被 scope 门拒绝时走路拾取必须仍关闭");
  assert.equal(scoped.wants(3001), false, "被 scope 门拒绝时卡片也不得捡");
  assert.equal(scoped.__hk.hooks, 0, "被 scope 门拒绝时零副作用（不装物品钩子）");
  assert.equal(J23813(scoped.pick("ext", { on: false })).error, "lease-required", "只持 dialog 连 off 也必须被门挡（门禁在入口）");
  // 变异 M-FIX3b：删掉 battle scope 门 → 上面「只持 dialog 必须被拒」必然红
  const mutScope = M23813(source, '      var badScope = apiGuard(owner, "battle"); if (badScope) return badScope; ', "");
  const s2 = boot(mutScope);
  s2.apiLease = { owner: "ext", generation: 1, scopes: ["dialog"] };
  assert.equal(J23813(s2.pick("ext", { on: true, types: [4, 5, 6] })).ok, true, "变异体只持 dialog 也能打开自动拾取（说明该断言能抓到这个缺陷）");
  assert.equal(s2.walk(), true, "变异体确实放行了走路拾取");
  // 走路策略：只在没有战斗目标时才走过去捡
  const w = boot(source);
  assert.equal(w.mayWalk(), true, "没有战斗目标时才允许走远捡");
  w.zLock = { gid: 5001 };
  assert.equal(w.mayWalk(), false, "有战斗目标时绝不移动");
  w.zLock = { gid: null }; w.apiCombatActive = () => true;
  assert.equal(w.mayWalk(), false, "代打正在追怪时也绝不移动");
  // 变异 M-R4a：拾取不看类型 → 消耗品也会被捡
  const mutA = M23813(source, "return t != null && pickupApiTypes.indexOf(t) >= 0;", "return t != null;");
  const a2 = boot(mutA);
  a2.pick("ext", { on: true, types: [4, 5, 6] });
  assert.equal(a2.wants(501), true, "变异体不看类型，消耗品也被捡（说明该断言能抓到这个缺陷）");
  // 变异 M-R4b：有战斗目标也走过去捡
  const mutB = M23813(source, 'if (typeof gidInt === "function" && gidInt(zLock && zLock.gid)) return false;', "");
  const b2 = boot(mutB);
  b2.zLock = { gid: 5001 };
  assert.equal(b2.mayWalk(), true, "变异体有战斗目标也走远（说明该断言能抓到这个缺陷）");
});


// ================= FIX23813：13 条 FIX-* 用例的文件参数化 + 变异矩阵 harness =================
// 约定：
//   * 13 条标题含 FIX-n 的用例一律对 [stable, exp] 两文件分别跑（FIX23813_SRC 复用 splitSources）；
//   * 断言消息前缀 fileLabel，失败时直接看出是哪个文件；
//   * 每个变异都分别作用在 stable 与 exp 上，两次都必须让对应用例变红（rmCheck）；
//   * rmCheck 把「期望红 / 实际红 / 被抓断言」记进 FIX23813_MATRIX，报告可一次取证。
const FIX23813_SRC = [['stable', source], ['exp', expSource]];
const FIX23813_MATRIX = [];
globalThis.__FIX23813_MATRIX__ = FIX23813_MATRIX;
const fixCatch23813 = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const fixErrMsg23813 = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 200);
// verifyFn(fileLabel, mutate) 必须抛出「目标断言」：抛了才算变异被杀死，没抛就是变异存活。
const rmCheck = (fix, fileLabel, mutate, verifyFn) => {
  const tag = fix + '@' + fileLabel;
  const v = fixCatch23813(() => verifyFn(fileLabel, mutate));
  const killed = v.ok === false;
  FIX23813_MATRIX.push({ fix: fix, file: fileLabel, tag: tag, expected: '红', actual: killed ? '红' : '绿', caught: killed ? fixErrMsg23813(v.e) : '未被抓（变异存活）' });
  if (!killed) throw new Error('[FIX23813 变异矩阵] ' + tag + ' 必须让对应用例变红，实际：变异体通过了 verify（该断言没抓到缺陷）');
  return mutate;
};


test("V2.38.13 FIX-2 代打期间：开一律抑制 / 关永远允许（四差分对）+ 变异 M-FIX2（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const MOBPOS = [60, 50];
    const ENT = { GID: 5001, gid: 5001, objecttype: 5, type: 5, dead: false, isDeath: false, mid: 1002, _job: 1002, position: MOBPOS,
      life: { hp: 900, hp_max: 1000 }, display: { name: "Mob" }, ACTION: { DIE: 9 }, action: 0, job: 1002 };
    const el = (x) => Object.assign({ value: "12", checked: true, textContent: "", style: {}, addEventListener() {}, getAttribute() { return null; },
      setAttribute() {}, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; } } }, x || {});
    const VALS = { "dsh-z-switchdelay": "0.001", "dsh-z-minrange": "0", "dsh-z-attint": "0.25" };
    const boot = (script, npHuntOn) => {
      const region = A23813(script, "  function zRangeDist(a, b) {", "  function skillLine(o) {");
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      const apiBlock = A23813(script, "  var apiCombat=null;", "  function apiEmit(kind,detail){");
      assert.ok(region.includes("function zAttack() {"), fileLabel + "：" + "提取必须命中 zAttack");
      assert.ok(region.includes("function npHuntStop(source, immediate) {"), fileLabel + "：" + "提取必须覆盖内挂关闭通道");
      assert.ok(pre.includes("function npRequestBattle(want, source, immediate, beforeToggle) {"), fileLabel + "：" + "提取必须覆盖内挂事务入口");
      assert.ok(apiBlock.includes("function apiCombatStart(owner){"), fileLabel + "：" + "提取必须覆盖代打启动");
      const inner = []; const wire = []; const requests = []; const EM = { forEach(fn) { fn(ENT); } };
      let NOW = 1000000;
      const ctx = { Math, Number, String, Array, Object, JSON, Date: { now: () => NOW }, parseInt, parseFloat, isNaN, isFinite, RegExp, Error,
        Int16Array, Promise, Map, Set, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 7, clearInterval() {},
        document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement: () => el(), documentElement: {}, head: {}, body: {}, getElementById() { return null; } },
        window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, getComputedStyle: () => ({ display: "block", visibility: "visible" }),
        $id: (id) => el({ value: (id in VALS) ? VALS[id] : "12" }),
        czp: (n) => function () { this.__t = n; },
        CLIENT: { SS: { Entity: { GID: 1, position: [50, 50], life: { hp: 1000, hp_max: 1000 } } },
          NM: { sendPacket: (p) => { wire.push(p); return true; } }, PS: { CZ: { NOTIFY_ONLYTARGET: function () {} } } },
        requireDB: (n) => (String(n).indexOf("EntityManager") >= 0 ? EM : null),
        gidInt: (v) => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; },
        zLock: { gid: 5001, name: "Mob", dist: 10, reactive: false, done: false }, zLockCounts: {}, zCastIdx: 0, zHitBy: {}, zHpWatch: { lastHitAt: 0, lastHp: 1000 },
        zMon: { action: "" }, zUseCounts: {}, zAtkLast: { gid: null, at: 0, outOfRange: false },
        apiLease: { owner: "ext", generation: 1, scopes: ["battle"] }, apiGuard: () => null,
        apiCombat: null,
        apiBattleTarget: { owner: "ext", mid: 1002, gid: 5001, npAdded: false },
        lockList: {}, DEFAULTS: { ClientVer: 5 }, zRunning: false, moveXY: {}, arrowRules: { enabled: false }, arrowTarget: null,
        npHuntOn: !!npHuntOn, npBattleKnown: true, npBattleLastSentAt: -Infinity, npBattleConfirmedAt: 0, npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null,
        npIsThree: () => false, npSendUpdate: () => { inner.push({ __t: "NPC_TOGGLE" }); return true; }, npSendWhisper: () => { inner.push({ __t: "NPC_TOGGLE" }); return true; },
        npSyncBattleCheckbox: () => {}, npBattleState: () => ctx.npHuntOn,
        zEntOf: (g) => ({ GID: Number(g), gid: Number(g), type: 5, dead: false, position: MOBPOS, life: { hp: 900, hp_max: 1000 }, display: { name: "Mob" }, _job: 1002, action: 0, ACTION: { DIE: 9 } }),
        isSitting: () => false, escapePending: () => false, requestEmergencyEscape() {}, zHoldTick() {}, updateHpWatch() {}, sitMaintain() {}, entStatus: () => ({}),
        clientReady: () => true, tlog() {}, setStatus() {}, onId() {}, npLog() {}, npApplyBattleState() {}, npClearBattleIntent() {},
        npHuntMode: () => "self", isHybrid: () => false, parseSkillOrder: () => [], captureAll() {}, ensureProfilesInit() {}, activeProfileKey: () => "p1", cloneList: (o) => o,
        profileTrusted: () => true, profWriteGuard: () => true, ensureProfile: () => ({}), saveProfiles() {}, renderMapLock() {}, roListReadOnly: () => false, roListRoBanner() {}, mobRefLinksHtml: () => "", pendingEditsTouch() {},
        distInt: () => 1, btLog() {}, normMapKey: (m) => m, skillCdMs: () => 0, dshCastMark() {}, BOSS: 1, learnedSkillLv: () => 1, masterTickReg() {}, potHpThr: () => 0.5,
        uiComp: () => null, bagPktByIndex: () => null, bagPktSnapshot: () => null, readEquippedAmmo: () => null, arrowItemName: () => "", poll: () => 0, qswPaint() {}, dshDiag() {}, czSelfCheck() {}, czRenderLine() {},
        deathReturnCancel() {}, buffStateOn: () => false, hookStatusIcons() {}, teleportToMap: () => true, castOrderSkill: () => false, skillNextGap: () => 0, mobid: (m) => Number(m),
        getSkillRange: () => 1, getSkillNameById: () => "Sk", getMobName: () => "Mob", getMapName: () => "dojo_a", getMobDb: () => ({ 1002: { MvpDropsNum: 0 } }), getworldData: () => ({}), getmobData: () => ({}),
        apiBattleTargetEntity: () => ENT, apiClearBattleTarget: () => ({ ok: true }), btDiagOn: () => false, skillTypeBits: () => ({ phy: true, mag: false }), mvSnapWalkable: (x, y) => [x, y] };
      vm.createContext(ctx); vm.runInContext(apiBlock + pre + region, ctx);
      // 真实 npRequestBattle 之上包一层，只为记录「意图」（want=true 就是开启包）
      const realRequestBattle = ctx.npRequestBattle;
      ctx.npRequestBattle = function (want, source, immediate, beforeToggle) {
        requests.push([!!want, source]);
        return realRequestBattle.call(this, want, source, immediate, beforeToggle);
      };
      const packets = () => inner.map((x) => x && x.__t); // 只统计内挂包（NPC_TOGGLE / UPDATEINFO / WHISPER），不把 zAttack 的 REQUEST_ACT 混进来
      return { ctx, requests, packets, wire, tick: (n) => { for (let i = 0; i < n; i++) { NOW += 1000; ctx.zAttack(); } } };
    };
    // (a) 内挂原本关着 + 代打 → 零内挂包（开与关都为 0）
    const a = boot(source, false);
    assert.equal(J23813(a.ctx.apiCombatStart("ext")).ok, true, fileLabel + "：" + "代打必须真的启动");
    assert.equal(a.ctx.apiCombatActive(), true, fileLabel + "：" + "夹具必须处于代打态");
    a.ctx.npEnsureHunt();       // 打开路径（zAttack 的 np/hybrid 分支同款）
    a.tick(4);
    assert.equal(a.ctx.zAtkWhy, "已出手", fileLabel + "：" + "夹具必须真的走到「有目标开打」那一步（否则用例是空跑）：" + a.ctx.zAtkWhy);
    assert.deepEqual(a.packets(), [], fileLabel + "：" + "(a) 内挂关着 + 代打：开与关都必须是 0 个内挂包");
    assert.equal(a.ctx.npHuntOn, false, fileLabel + "：" + "(a) 代打不得把内挂态改成 on");

    // (b) 内挂原本开着 + 代打启动 → 恰好 1 个关闭包，之后不得再出第二个
    const b = boot(source, true);
    assert.equal(J23813(b.ctx.apiCombatStart("ext")).ok, true);
    assert.deepEqual(b.packets(), ["NPC_TOGGLE"], fileLabel + "：" + "(b) 原先开着 → 启动只发一次关闭包");
    assert.equal(b.ctx.npHuntOn, false, fileLabel + "：" + "(b) 关闭后本地态必须落实到 false");
    b.ctx.npEnsureHunt();
    b.tick(4);
    assert.deepEqual(b.packets(), ["NPC_TOGGLE"], fileLabel + "：" + "(b) 之后的每拍不得再补第二个内挂包（与 zAttack 的关闭收敛为只发一次）");

    // (c) 代打期间手动 setBattle(true) → 零开启包，内挂态不得被改成 on
    const c = boot(source, false);
    c.ctx.apiCombat = { owner: "ext", generation: 1 };
    assert.equal(c.ctx.apiCombatActive(), true);
    c.ctx.setBattle(true);
    c.tick(4);
    assert.deepEqual(c.packets(), [], fileLabel + "：" + "(c) 代打期间不得发出任何开启包");
    assert.equal(c.ctx.npHuntOn, false, fileLabel + "：" + "(c) 内挂态不得被改成 on");
    assert.equal(c.requests.some((r) => r[0] === true), true, fileLabel + "：" + "(c) 必须真的走到「打开路径」才会被抑制（否则用例是空跑）");

    // (d) 代打期间手动触发 npHuntStop("map-change",true) → 必须真的发出关闭包（审计红过的场景）
    const d = boot(source, true);
    d.ctx.apiCombat = { owner: "ext", generation: 1 };
    assert.equal(d.ctx.apiCombatActive(), true);
    d.ctx.npHuntStop("map-change", true);
    assert.deepEqual(d.packets(), ["NPC_TOGGLE"], fileLabel + "：" + "(d) 代打期间「关」必须真的出包");
    assert.equal(d.ctx.npHuntOn, false, fileLabel + "：" + "(d) 关闭后本地态必须落实");

    // 变异 M-FIX2a@stable / M-FIX2a@exp：删掉 npRequestBattle 的开启门 → (c) 必须红
    rmCheck("M-FIX2a", fileLabel, M23813(source, '    if (want && typeof apiCombatActive === "function" && apiCombatActive()) { try { tlog("np-hunt-on suppressed (external combat) source=" + source); } catch (eS) {} return "suppressed"; }\n', ""), (fl, mut) => {
      const ma = boot(mut, false);
      ma.ctx.apiCombat = { owner: "ext", generation: 1 };
      ma.ctx.setBattle(true);
      assert.deepEqual(ma.packets(), [], fileLabel + "：" + fl + "：[M-FIX2a] 变异体删掉开启门后仍发出开启包");
      assert.equal(ma.ctx.npHuntOn, false, fileLabel + "：" + fl + "：[M-FIX2a] 变异体把内挂态改成了 on");
    });
    // 变异 M-FIX2b@stable / M-FIX2b@exp：把 npHuntStop 的早退加回来 → (d) 必须红
    rmCheck("M-FIX2b", fileLabel, M23813(source, '  function npHuntStop(source, immediate) {\n    try {\n', '  function npHuntStop(source, immediate) {\n    try {\n      if (typeof apiCombatActive === "function" && apiCombatActive()) return;\n'), (fl, mut) => {
      const mb = boot(mut, true);
      mb.ctx.apiCombat = { owner: "ext", generation: 1 };
      mb.ctx.npHuntStop("map-change", true);
      assert.equal(mb.packets().indexOf("NPC_TOGGLE"), 0, fileLabel + "：" + fl + "：[M-FIX2b] 变异体把早退加回来后，代打期间关不掉内挂");
      assert.equal(mb.ctx.npHuntOn, false, fileLabel + "：" + fl + "：[M-FIX2b] 变异体把内挂态留在 on");
    });
  }
});

test("V2.38.13 变异 M-R5：把非 DOJO_OWNER 的 ONLYTARGET 同步加回去 → 必须被真实断言杀死", () => {
  const mk = (script) => {
    const code = A23813(script, "  function apiClearBattleTarget(owner){", "  function apiBattleTick(){");
    const packets = []; let syncs = 0;
    const ctx = { apiGuard: () => null, arrowPos: (v) => { const n = Number(v); return n > 0 ? n : null; },
      apiBattleTargetEntity: () => ({ gid: 7, mid: 3001, type: 5, dead: false }),
      npSyncTargets: () => { syncs++; }, npOnlyTarget: (mid, v) => packets.push([Number(mid), v]),
      DOJO_OWNER: "builtin-dojo", apiBattleTarget: null, apiBattleSuppressed: {}, lockList: {} };
    vm.createContext(ctx); vm.runInContext(code + ";this.set=apiSetBattleTarget;this.clear=apiClearBattleTarget", ctx);
    return { ctx, packets, syncs: () => syncs };
  };
  const a = mk(source);
  assert.equal(J23813(a.ctx.set("owner-one", { mid: 3001, gid: 7 })).ok, true);
  assert.equal(a.packets.length, 0, "非 DOJO_OWNER 的代打目标一个内挂包都不发");
  a.ctx.clear("owner-one");
  assert.equal(a.packets.length, 0, "非 DOJO_OWNER 清目标也不发");
  const d = mk(source);
  d.ctx.set("builtin-dojo", { mid: 3001, gid: 7 });
  assert.equal(d.syncs(), 1, "内置道场路径必须保持原样（仍同步锁定目录）");
  // 变异 M-R5：恢复非 DOJO_OWNER 的 npOnlyTarget
  const mut = M23813(source, "apiBattleTarget={owner:owner,mid:mid,gid:gid,npAdded:false};if(owner===DOJO_OWNER)npSyncTargets();return {ok:true};}",
    "var added=!lockList[String(mid)];apiBattleTarget={owner:owner,mid:mid,gid:gid,npAdded:added};if(owner===DOJO_OWNER)npSyncTargets();else if(added)npOnlyTarget(mid,1);return {ok:true};}");
  const b = mk(mut);
  b.ctx.set("owner-one", { mid: 3001, gid: 7 });
  assert.equal(b.packets.length, 1, "变异体把 ONLYTARGET 加回来了（说明该断言能抓到这个缺陷）");
});

test("V2.38.13 契约锁：门面新增 prepareCombat / requestPickup / teleportResult，版本与 capabilities 就位", () => {
  for (const [name, src] of [["stable", source], ["exp", expSource]]) {
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], PRODUCT_VERSION, name + " @version 必须是 " + PRODUCT_VERSION);
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], PRODUCT_VERSION, name + " VER 必须是 " + PRODUCT_VERSION);
    const line = src.split(/\r?\n/).find((l) => l.indexOf("var apiFacade={protocol:API_PROTOCOL") >= 0);
    assert.ok(line, name + " 必须能找到 apiFacade 字面量");
    for (const k of ["teleport", "teleportResult", "prepareCombat", "requestPickup", "assistCombat", "setBattleTarget", "clearBattleTarget", "requestFly", "release", "acquire", "snapshot", "contactNpc", "walkTo", "chooseMenu"]) {
      assert.ok(line.includes(k + ":"), name + " 门面必须有 " + k);
    }
    const flat = src.replace(/\r?\n/g, "");
    const cap = /capabilities:function\(\)\{return \{protocol:API_PROTOCOL,scopes:\[([^\]]*)\],modules:\[([^\]]*)\],arrowRules:true,battleTarget:true,\s*assistCombat:true\};\}/.exec(flat);
    assert.ok(cap, name + " capabilities 必须是六项 scopes + dojo 模块 + 三项能力全 true");
    assert.equal(cap[1], '"dojo","battle","movement","dialog","arrow","fly"', name + " scopes 六项不得变");
    assert.equal(cap[2], '"dojo"', name + " modules 必须含 dojo");
  }
  // 变异 M-R1b：把 arrow 加回具名能力门面之外的口径 —— 只允许换箭能力本身保留，防止误删
  assert.ok(source.includes('externalAutomationOwns("arrow")'), "助手侧换箭让位门必须仍在");
  assert.ok(source.includes("function arrowSelfTick(now){"), "助手侧换箭实现必须仍在（取消的是道场申请，不是助手能力）");
});

test("V2.38.13 FIX-1/FIX-8 apiBattleTick 状态迁移 + 关闭包必须发出 + 租约消失收起拾取（VM）+ 变异 M-FIX1（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const t = A23813(script, "  function apiBattleTick(){", "  function apiBattleDrive(){");
      const b = A23813(script, "  function apiBattle(owner,on){", "  function apiAssistCombat(owner,on){");
      assert.ok(t.includes("if(!apiLease)return;"), fileLabel + "：" + "提取必须命中 apiBattleTick");
      assert.ok(b.includes("function apiBattle(owner,on){"), fileLabel + "：" + "提取必须命中 apiBattle");
      const sent = []; const emits = [];
      let pickupResets = 0;
      const ctx = {
        apiGuard: () => null,
        apiLease: { owner: "ext", generation: 4, scopes: ["battle"], released: false, battle: { state: "none" } },
        npBattleState: () => ctx.__npOn,
        npRequestBattle: (want, src, imm, cb) => { sent.push([!!want, src]); ctx.__npOn = !!want; return "sent"; },
        apiBattleTargetEntity: () => true, apiClearBattleTarget: () => {},
        apiPickupReset: () => { pickupResets++; },
        apiEmit: (k, d) => emits.push([k, d]),
        apiCombat: null, apiCurrent: () => true,
        Date: { now: () => 1000 }, Math, Number, String, Array, Object, isFinite,
        __npOn: false };
      vm.createContext(ctx);
      vm.runInContext(t + b + ";this.tick=apiBattleTick;this.battle=apiBattle;this.lease=()=>apiLease", ctx);
      return { ctx, sent, emits, pickupResets: () => pickupResets };
    };
    const h = boot(source);
    assert.ok(h.ctx.lease().battle, fileLabel + "：" + "租约必须带 battle 事务槽");
    h.ctx.tick();
    assert.equal(h.ctx.lease().battle.state, "none", fileLabel + "：" + "初始态必须是 none");
    const r1 = J23813(h.ctx.battle("ext", true));
    assert.equal(r1.ok, true);
    assert.deepEqual(h.sent, [[true, "external:ext"]], fileLabel + "：" + "开启必须真的出包");
    assert.equal(h.ctx.lease().battle.state, "pending-on", fileLabel + "：租约 battle 必须进入 pending-on");
    h.ctx.tick();
    assert.equal(h.ctx.lease().battle.state, "owned", fileLabel + "：" + "FIX-1：pending-on + 内挂确认在跑 → owned");
    h.sent.length = 0;
    const r2 = J23813(h.ctx.battle("ext", false));
    assert.equal(r2.ok, true);
    assert.deepEqual(h.sent, [[false, "external:ext"]], fileLabel + "：" + "FIX-1：owned 之后关闭包必须真的发出去（不得静默 not-owned）");
    assert.equal(h.ctx.lease().battle.state, "pending-off", fileLabel + "：租约 battle 必须进入 pending-off");
    h.ctx.tick();
    assert.equal(h.ctx.lease().battle.state, "none", fileLabel + "：" + "FIX-1：pending-off + 内挂确认关闭 → none");
    // FIX-8：released 且已收敛 → 租约消失的同一条路径必须一并收起自动拾取
    const before = h.pickupResets();
    h.ctx.lease().released = true;
    h.ctx.tick();
    assert.equal(h.ctx.lease(), null, fileLabel + "：" + "released 且已收敛 → 租约必须消失");
    assert.equal(h.pickupResets(), before + 1, fileLabel + "：" + "FIX-8：租约消失路径必须一并 apiPickupReset()");
    // 变异 M-FIX1@stable / M-FIX1@exp：删掉两句状态迁移 → pending-on 永远不收敛，关闭包发不出去
    rmCheck("M-FIX1", fileLabel, M23813(source, 'var b=apiLease.battle,s=npBattleState();if(b.state==="pending-on"&&s===true)b.state="owned";else if(b.state==="pending-off"&&s===false)b.state="none";', ""), (fl, mut) => {
      const m = boot(mut);
      m.ctx.battle("ext", true); m.ctx.tick();
      assert.equal(m.ctx.lease().battle.state, "pending-on", fileLabel + "：" + fl + "：[M-FIX1] 变异体状态永远停在 pending-on");
      m.sent.length = 0;
      const mr = J23813(m.ctx.battle("ext", false));
      assert.equal(mr.result, "sent", fileLabel + "：" + fl + "：[M-FIX1] 变异体关闭分支被 not-owned 门槛挡住");
      assert.equal(m.sent.length, 1, fileLabel + "：" + fl + "：[M-FIX1] 变异体关闭包发不出去");
    });
  }
});

test("V2.38.13 FIX-7 apiTeleportResult(owner)：租约门 + 0/2/3/4/no-ack 映射（VM）+ 变异 M-FIX7（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const g = A23813(script, "  function apiHas(owner,scope){", "  function apiCurrent(owner,generation){")
        + A23813(script, "  function apiGuard(owner,scope){", "  function apiBattleTargetEntity(target){");
      const f = A23813(script, "  function apiTeleportResult(owner){", "  function apiChoose(owner,payload){");
      assert.ok(f.startsWith("  function apiTeleportResult(owner)"), fileLabel + "：" + "FIX-7：apiTeleportResult 必须接收 owner");
      assert.ok(g.includes("function apiGuard(owner,scope){"), fileLabel + "：" + "提取必须覆盖 apiGuard");
      const ctx = { clientReady: () => true, apiLease: { owner: "ext", generation: 1, scopes: ["movement"] },
        tpLast: { code: null }, TP_ACK_WHY: { 0: "受理", 2: "没卷轴或会员卡", 3: "地图不支持", 4: "未知地图" },
        Number, String, Array, Object };
      vm.createContext(ctx);
      vm.runInContext(g + f + ";this.res=apiTeleportResult", ctx);
      return ctx;
    };
    const ctx = boot(source);
    ctx.apiLease = null;
    assert.equal(J23813(ctx.res("ext")).error, "lease-required", fileLabel + "：" + "无租约必须拒绝（FIX-7）");
    ctx.apiLease = { owner: "other", generation: 1, scopes: ["movement"] };
    assert.equal(J23813(ctx.res("ext")).error, "lease-required", fileLabel + "：" + "他人租约必须拒绝");
    ctx.apiLease = { owner: "ext", generation: 1, scopes: ["dialog"] };
    assert.equal(J23813(ctx.res("ext")).error, "lease-required", fileLabel + "：" + "本人租约但没有 movement/fly 也必须拒绝");
    ctx.apiLease = { owner: "ext", generation: 1, scopes: ["movement"] };
    ctx.tpLast = { code: 0 };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: true, code: 0, error: "" }, fileLabel + "：" + "code=0 必须映射成受理成功（审计点名的覆盖洞）");
    ctx.tpLast = { code: 2 };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: false, code: 2, error: "code=2（没卷轴或会员卡）" });
    ctx.tpLast = { code: 3 };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: false, code: 3, error: "code=3（地图不支持）" });
    ctx.tpLast = { code: 4 };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: false, code: 4, error: "code=4（未知地图）" });
    ctx.tpLast = { code: 9 };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: false, code: 9, error: "code=9（未知代码）" });
    ctx.tpLast = { code: null };
    assert.deepEqual(J23813(ctx.res("ext")), { ok: null, code: null, error: "no-ack" }, fileLabel + "：" + "没有回包必须 no-ack");
    // 变异 M-FIX7a@stable / M-FIX7a@exp：把 code=0 改成失败 → 映射用例必须红
    rmCheck("M-FIX7a", fileLabel, M23813(source, 'if(tpLast.code===0)return {ok:true,code:0,error:""};', 'if(false)return {ok:true,code:0,error:""};'), (fl, mut) => {
      const ma = boot(mut);
      ma.apiLease = { owner: "ext", generation: 1, scopes: ["movement"] }; ma.tpLast = { code: 0 };
      assert.deepEqual(J23813(ma.res("ext")), { ok: true, code: 0, error: "" }, fileLabel + "：" + fl + "：[M-FIX7a] 变异体把 code=0 也当失败");
    });
    // 变异 M-FIX7b@stable / M-FIX7b@exp：退回无租约校验的全局单槽 → 无租约也能读回执
    rmCheck("M-FIX7b", fileLabel, M23813(source, 'function apiTeleportResult(owner){var bad=apiGuard(owner,"movement");if(bad&&bad.error==="lease-required")bad=apiGuard(owner,"fly");if(bad)return {ok:false,error:"lease-required"};', 'function apiTeleportResult(owner){'), (fl, mut) => {
      const mb = boot(mut);
      mb.apiLease = null; mb.tpLast = { code: 0 };
      assert.equal(J23813(mb.res("ext")).error, "lease-required", fileLabel + "：" + fl + "：[M-FIX7b] 变异体无租约也能读回执");
    });
  }
});

test("V2.38.13 FIX-6 内置道场恢复 BOSS-only（外部租约路径不得连坐）（VM）+ 变异 M-FIX6（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const base = { ready: true, inDojoMap: true, mobs: [], npcs: [], player: { position: [0, 0], hp: 100, maxHp: 100 }, dialogOpen: false, menu: null };
    const runTick = (script, mob) => {
      const c = A23813(script, "  function dojoTick(g){", "  function dojoStart(params){");
      assert.ok(c.includes("live.filter"), fileLabel + "：" + "提取必须命中内置道场战斗分支");
      const calls = [];
      const a = { snapshot: () => Object.assign({}, base, { mobs: [mob], arrow: { enabled: false, ready: false, blocked: false, target: null } }),
        setBattleTarget: (o, t) => { calls.push(["setBattleTarget", t.mid]); },
        clearBattleTarget: () => calls.push(["clearBattleTarget"]),
        setArrowTarget: (o, t) => { calls.push(["setArrowTarget", t.mid]); return { ok: true }; },
        clearArrowTarget: () => calls.push(["clearArrowTarget"]),
        requestBattle: (o, on) => calls.push(["requestBattle", on]),
        contactNpc: () => calls.push(["contact"]), walkTo: () => calls.push(["walk"]),
        requestFly: () => calls.push(["fly"]), chooseMenu: () => calls.push(["choose"]) };
      const run = { on: true, generation: 1, phase: "", npc: null, lastMenu: "", lastFly: 0, round: 0, remaining: null, timer: null };
      const ctx = { dojoRun: run, dojoCfg: { difficulty: "basic", stop100: false, fly: false, emergency: false },
        arrowRules: { enabled: false }, DOJO_OWNER: "builtin-dojo", dojoApi: () => a, dojoRender: () => {},
        dojoStop: (r) => { calls.push(["stop", r]); return r; }, dojoChoose: () => false,
        dojoContact: () => calls.push(["contactPath"]), dojoNorm: (s) => String(s || ""),
        Math, Number, String, Array, Object, Infinity, Date };
      vm.createContext(ctx); vm.runInContext(c + ";this.tick=dojoTick", ctx);
      ctx.tick(1);
      return { calls, run };
    };
    const boss = { mid: 2002, gid: 7, dead: false, isBoss: true };
    const normal = { mid: 1002, gid: 8, dead: false, isBoss: false };
    const withBoss = runTick(source, boss);
    assert.deepEqual(withBoss.calls.filter((x) => x[0] === "setBattleTarget"), [["setBattleTarget", 2002]], fileLabel + "：" + "BOSS 必须被指定为战斗目标（证明用例不是空跑）");
    assert.ok(withBoss.calls.some((x) => x[0] === "requestBattle" && x[1] === true), fileLabel + "：" + "BOSS 在场必须开战");
    const withNormal = runTick(source, normal);
    assert.equal(withNormal.calls.some((x) => x[0] === "setBattleTarget"), false, fileLabel + "：" + "FIX-6：非 BOSS 不得被指定为战斗目标");
    assert.equal(withNormal.calls.some((x) => x[0] === "setArrowTarget"), false, fileLabel + "：" + "FIX-6：非 BOSS 不得被指定为换箭目标（普通怪不进客户端锁定名单）");
    assert.equal(withNormal.calls.some((x) => x[0] === "requestBattle"), false, fileLabel + "：" + "FIX-6：非 BOSS 不得开战，必须回到 NPC 接触流程");
    assert.equal(withNormal.calls.some((x) => x[0] === "contactPath"), true, fileLabel + "：" + "FIX-6：非 BOSS 必须回到 dojoContact");
    // 外部租约路径不得被连坐：apiBattleTargetEntity 仍认任何活怪，apiSetBattleTarget 必须接受非 BOSS
    const entCtx = { DOJO_OWNER: "builtin-dojo", apiGuard: () => null, arrowPos: (v) => { const n = Number(v); return n > 0 ? n : null; },
      apiEntities: () => [{ gid: 8, mid: 1002, type: 5, dead: false, isBoss: false }],
      apiBattleTarget: null, apiBattleSuppressed: {}, lockList: {}, npSyncTargets: () => {}, npOnlyTarget: () => {} };
    const entCode = A23813(source, "  function apiBattleTargetEntity(target){", "  function apiBattleTick(){");
    vm.createContext(entCtx);
    vm.runInContext(entCode + ";this.set=apiSetBattleTarget;this.ent=apiBattleTargetEntity", entCtx);
    assert.equal(!!entCtx.ent({ mid: 1002, gid: 8 }), true, fileLabel + "：" + "非 BOSS 也必须能被 apiBattleTargetEntity 认成活怪");
    assert.equal(J23813(entCtx.set("ext-owner", { mid: 1002, gid: 8 })).ok, true, fileLabel + "：" + "FIX-6：外部租约路径喂非 BOSS 必须 setBattleTarget");
    // 变异 M-FIX6@stable / M-FIX6@exp：把内置那条改回 live[0] 兜底 → 非 BOSS 用例必须红
    rmCheck("M-FIX6", fileLabel, M23813(source, '})[0]; // V2.38.13 FIX-6：内置道场恢复 BOSS-only（普通怪不再占用战斗/换箭目标）；外部租约路径的 apiBattleTargetEntity 不变', "})[0]||live[0];"), (fl, mut) => {
      const mutNormal = runTick(mut, normal);
      assert.equal(mutNormal.calls.some((x) => x[0] === "setBattleTarget"), false, fileLabel + "：" + fl + "：[M-FIX6] 变异体把普通怪指定为战斗目标");
      assert.equal(mutNormal.calls.some((x) => x[0] === "setArrowTarget"), false, fileLabel + "：" + fl + "：[M-FIX6] 变异体把普通怪当目标指定换箭");
    });
  }
});

test("V2.38.13 FIX-10b assistCombat(owner,false) 停代打必须还原「打全部怪」原值（VM）+ 变异 M-FIX10b（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const allmobs = A23813(script, "  var apiAllMobsSaved = null;", "  function apiRequestPickup(owner, payload) {");
      const combat = A23813(script, "  var apiCombat=null;", "  function apiEmit(kind,detail){");
      const assist = A23813(script, "  function apiAssistCombat(owner,on){", "  function apiSetArrow(owner,target){");
      const box = { checked: false };
      const ctx = { apiGuard: () => null, clientReady: () => true,
        apiLease: { owner: "ext", generation: 1, scopes: ["dojo", "battle"], battle: { state: "none" } },
        npBattleState: () => false, npRequestBattle: () => "already",
        zRunning: false, tlog: () => {}, $id: (id) => (id === "dsh-z-allmobs" ? box : null),
        zLock: {}, zMon: {}, zUseCounts: {}, zLockCounts: {}, zCastIdx: 0, zAtkLast: {},
        setInterval: () => 7, clearInterval: () => {}, Date: { now: () => 1 },
        Math, Number, String, Array, Object, isFinite, parseFloat,
        profileTrusted: () => true, activeProfileKey: () => "p1", lockList: {},
        profileLockSave: () => {}, renderLockList: () => {}, npSyncTargets: () => {} };
      vm.createContext(ctx);
      vm.runInContext(allmobs + combat + assist + ";this.prep=apiPrepareCombat;this.assist=apiAssistCombat;this.stop=apiCombatStop", ctx);
      return { ctx, box, combat };
    };
    const h = boot(source);
    const prep = J23813(h.ctx.prep("ext", { allMobs: true }));
    assert.equal(prep.ok, true, fileLabel + "：" + "战斗准备必须成立");
    assert.equal(h.box.checked, true, fileLabel + "：" + "准备阶段先勾上「打全部怪」");
    assert.equal(prep.allMobsRestore, false, fileLabel + "：" + "必须记下原值 false");
    assert.equal(J23813(h.ctx.assist("ext", true)).ok, true, fileLabel + "：" + "开启代打");
    assert.equal(h.box.checked, true, fileLabel + "：" + "开启代打本身不得改动「打全部怪」");
    assert.equal(J23813(h.ctx.assist("ext", false)).ok, true, fileLabel + "：" + "关闭代打");
    assert.equal(h.box.checked, false, fileLabel + "：" + "FIX-10b：assistCombat(owner,false) 停代打必须还原 #dsh-z-allmobs 原值");
    assert.equal(J23813(h.ctx.assist("ext", false)).ok, true, fileLabel + "：" + "重复关闭必须幂等");
    assert.equal(h.box.checked, false, fileLabel + "：" + "幂等关闭后仍必须是还原值");
    // 变异 M-FIX10b@stable / M-FIX10b@exp：删掉 apiCombatStop 里的还原 → 「打全部怪」留在开
    rmCheck("M-FIX10b", fileLabel, M23813(source, '\n    if(typeof apiAllMobsRestore==="function")apiAllMobsRestore();\n', "\n"), (fl, mut) => {
      const m = boot(mut);
      J23813(m.ctx.prep("ext", { allMobs: true }));
      J23813(m.ctx.assist("ext", true));
      J23813(m.ctx.assist("ext", false));
      assert.equal(m.box.checked, false, fileLabel + "：" + fl + "：[M-FIX10b] 变异体停代打不还原，「打全部怪」留在开");
    });
  }
});

test("V2.38.13 FIX-12 代打期间快捷键与 setBattle 必须给出同一句「已抑制」文案（VM）+ 变异 M-FIX12（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      const hk = A23813(script, "  function npToggleFight() {", "  // 助手自动战斗快捷键");
      assert.ok(pre.includes("function setBattle(on) {"), fileLabel + "：" + "提取必须覆盖 setBattle");
      assert.ok(hk.includes('npRequestBattle(want, "hotkey", true)'), fileLabel + "：" + "提取必须覆盖快捷键入口");
      const statuses = []; const toggles = [];
      const ctx = { Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN, RegExp, Error, JSON,
        Date: { now: () => 1000000 }, setTimeout: () => 0, clearTimeout: () => {},
        npHuntOn: false, npBattleKnown: true, npBattleLastSentAt: -Infinity, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        apiCombatActive: () => true, npToggleHunt: () => { toggles.push(1); return true; }, npSyncBattleCheckbox: () => {},
        tlog: () => {}, setStatus: (t) => statuses.push(String(t)), dshDiag: () => {} };
      vm.createContext(ctx); vm.runInContext(pre + hk, ctx);
      return { ctx, statuses, toggles };
    };
    const SUPPRESSED = "外部代打进行中：不开内挂自动战斗（已抑制）";
    const a = boot(source);
    a.ctx.setBattle(true);
    assert.equal(a.statuses[0], SUPPRESSED, fileLabel + "：" + "setBattle 路径在代打期间必须明确说「已抑制」");
    a.ctx.npToggleFight();
    assert.equal(a.statuses[1], a.statuses[0], fileLabel + "：" + "FIX-12：快捷键路径必须与 setBattle 说同一句话");
    assert.deepEqual(a.toggles, [], fileLabel + "：" + "两条路径都不得发出任何开启包");
    assert.equal(a.ctx.npHuntOn, false, fileLabel + "：" + "两条路径都不得改动本地内挂态");
    // 变异 M-FIX12@stable / M-FIX12@exp：把快捷键那条改回通用文案 → 两条路径不再同一句
    rmCheck("M-FIX12", fileLabel, M23813(source, '      setStatus(result === "sent" ? "内挂自动战斗：已用快捷键切换一次" : (result === "suppressed" ? "外部代打进行中：不开内挂自动战斗（已抑制）" : "内挂自动战斗状态未确认，未重复切换"), npResultKind(result, result === "sent" ? "ok" : "warn"));', '      setStatus(result === "sent" ? "内挂自动战斗：已用快捷键切换一次" : "内挂自动战斗状态未确认，未重复切换", npResultKind(result, result === "sent" ? "ok" : "warn"));'), (fl, mut) => {
      const m = boot(mut);
      m.ctx.setBattle(true); m.ctx.npToggleFight();
      assert.equal(m.statuses[1], m.statuses[0], fileLabel + "：" + fl + "：[M-FIX12] 变异体把「被抑制」说成「状态未确认」，两条路径不再同一句");
    });
  }
});

test("V2.38.13 FIX-13 代打开始必须显式撤销排队中的开内挂意图并留日志（VM）+ 变异 M-FIX13（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const combat = A23813(script, "  var apiCombat=null;", "  function apiEmit(kind,detail){");
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      assert.ok(combat.includes("function apiCombatStart(owner){"), fileLabel + "：" + "提取必须覆盖代打启动");
      assert.ok(pre.includes("function npRunExplicit() {"), fileLabel + "：" + "提取必须覆盖排队定时器回调");
      const logs = []; const packets = []; const timers = new Map(); let tid = 0; const NOW = 1000000;
      const ctx = { Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN, RegExp, Error, JSON,
        Date: { now: () => NOW }, setTimeout: (fn) => { timers.set(++tid, { fn: fn, cleared: false }); return tid; },
        clearTimeout: (id) => { const t = timers.get(id); if (t) t.cleared = true; },
        setInterval: () => 7, clearInterval: () => {},
        npHuntOn: false, npBattleKnown: false, npBattleLastSentAt: NOW, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        apiCombat: null, apiLease: { owner: "ext-owner", generation: 3, scopes: ["battle"] }, apiGuard: () => null,
        zRunning: false, zLock: {}, zUseCounts: {}, zLockCounts: {}, zCastIdx: 0, zAtkLast: {}, zMon: {},
        $id: () => ({ value: "0.25" }), tlog: (msg) => logs.push(String(msg)), setStatus: () => {}, dshDiag: () => {},
        npBattleState: () => ctx.npHuntOn, apiAllMobsRestore: () => {}, npToggleHunt: () => { packets.push(1); return true; } };
      vm.createContext(ctx); vm.runInContext(combat + pre, ctx);
      return { ctx, logs, packets, timers };
    };
    const CANCEL = "已取消排队的开内挂";
    const h = boot(source);
    h.ctx.setBattle(true);
    assert.equal(h.ctx.npHuntOn, false, fileLabel + "：" + "夹具必须处在内挂关（开内挂才需要排队）");
    assert.equal(h.ctx.npBattleExplicit && h.ctx.npBattleExplicit.want, true, fileLabel + "：" + "夹具必须真的把「开内挂」意图排进队");
    const qid = h.ctx.npBattleExplicitTimer;
    assert.ok(qid && h.timers.has(qid), fileLabel + "：" + "排队必须真的挂上定时器");
    assert.equal(h.timers.get(qid).cleared, false, fileLabel + "：" + "排队中定时器不得已被撤销");
    assert.deepEqual(h.packets, [], fileLabel + "：" + "入队阶段不得发出开启包");
    assert.equal(J23813(h.ctx.apiCombatStart("ext-owner")).ok, true, fileLabel + "：" + "代打必须真的启动");
    assert.equal(h.ctx.npBattleExplicit, null, fileLabel + "：" + "FIX-13：代打开始必须显式清掉排队中的开内挂意图");
    assert.equal(h.ctx.npBattleExplicitTimer, null, fileLabel + "：" + "FIX-13：排队定时器句柄必须一并清空");
    assert.equal(h.timers.get(qid).cleared, true, fileLabel + "：" + "FIX-13：排队定时器必须被撤销");
    assert.ok(h.logs.some((msg) => msg.indexOf(CANCEL) >= 0), fileLabel + "：" + "FIX-13：必须留下「外部代打开始，已取消排队的开内挂」日志：" + JSON.stringify(h.logs));
    h.timers.get(qid).fn();
    assert.deepEqual(h.packets, [], fileLabel + "：" + "FIX-13：排队定时器即便触发也必须是零开启包");
    assert.equal(h.ctx.npHuntOn, false, fileLabel + "：" + "FIX-13：本地态不得被改成 on");
    // 变异 M-FIX13@stable / M-FIX13@exp：删掉代打开始时的清理 → 意图残留、日志缺失
    rmCheck("M-FIX13", fileLabel, M23813(source, 'if(typeof npBattleExplicit!=="undefined"&&npBattleExplicit&&npBattleExplicit.want){\n      if(typeof npBattleExplicitTimer!=="undefined"&&npBattleExplicitTimer)clearTimeout(npBattleExplicitTimer);\n      npBattleExplicitTimer=null;\n      npBattleExplicit=null;\n      try{tlog("np-hunt-on queued cancel 外部代打开始，已取消排队的开内挂 source=external:"+owner);}catch(eQ){}\n    }', ""), (fl, mut) => {
      const m = boot(mut);
      m.ctx.setBattle(true);
      const mq = m.ctx.npBattleExplicitTimer;
      J23813(m.ctx.apiCombatStart("ext-owner"));
      assert.equal(m.ctx.npBattleExplicit, null, fileLabel + "：" + fl + "：[M-FIX13] 变异体代打开始后排队意图仍然留着");
      assert.equal(m.logs.some((msg) => msg.indexOf(CANCEL) >= 0), true, fileLabel + "：" + fl + "：[M-FIX13] 变异体取消日志缺失");
      m.timers.get(mq).fn();
    });
  }
});

test("V2.38.13 FIX-14 release 后同一 owner 立刻 acquire：released 复位 / scopes 刷新 / 代次递增（VM）+ 变异 M-FIX14（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const tick = A23813(script, "  function apiBattleTick(){", "  function apiBattleDrive(){");
      const acq = A23813(script, "  function apiAcquire(owner,scopes){", "  function apiGuard(owner,scope){");
      const rel = A23813(script, "  function apiRelease(owner){", "  function apiContact(owner,gid){");
      assert.ok(tick.includes('if(apiLease.released&&b.state==="none")'), fileLabel + "：" + "提取必须覆盖租约清空路径");
      assert.ok(rel.includes('npRequestBattle(false,"external-release:"+owner'), fileLabel + "：" + "提取必须覆盖 release 的关闭包");
      const sent = []; let pickups = 0;
      const ctx = { Math, Number, String, Array, Object, isFinite, RegExp, Error, JSON, Date: { now: () => 1000 },
        apiLease: { owner: "ext-owner", generation: 4, scopes: ["battle"], released: false, selectedNpc: 0, battle: { state: "owned" } },
        apiGeneration: 4, clientReady: () => true,
        apiOwner: (o) => typeof o === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(o),
        apiScopes: (s) => Array.isArray(s) && s.length > 0 && s.every((x) => ["dojo", "battle", "movement", "dialog", "arrow", "fly"].indexOf(x) >= 0),
        npBattleState: () => false, npRequestBattle: (want, src) => { sent.push([!!want, src]); return "sent"; },
        npClearBattleIntent: () => {}, npZeroBattle: () => {}, apiCombat: null,
        apiAllMobsRestore: () => {}, apiPickupReset: () => { pickups++; },
        apiClearBattleTarget: () => ({ ok: true }), apiEmit: () => {},
        moveXY: {}, arrowTarget: null, arrowPending: null, arrowReady: false, arrowBlocked: false,
        zRunning: false, bagClean: { busy: false } };
      vm.createContext(ctx);
      vm.runInContext(tick + acq + rel + ";this.acquire=apiAcquire;this.release=apiRelease;this.tick=apiBattleTick;this.lease=()=>apiLease", ctx);
      return { ctx, sent, pickups: () => pickups };
    };
    const h = boot(source);
    const rel1 = J23813(h.ctx.release("ext-owner"));
    assert.equal(rel1.ok, true);
    assert.equal(rel1.result, "pending-off", fileLabel + "：" + "owned 走 release 必须停在 pending-off 并把租约留在原地");
    assert.deepEqual(h.sent, [[false, "external-release:ext-owner"]], fileLabel + "：" + "旧语义：release 该发的关闭包必须照样发出");
    assert.equal(h.ctx.lease().released, true, fileLabel + "：" + "release 后租约必须被标记已释放");
    const p0 = h.pickups();
    h.sent.length = 0;
    const acq1 = J23813(h.ctx.acquire("ext-owner", ["battle", "movement"]));
    assert.equal(acq1.ok, true, fileLabel + "：" + "同一 owner 在 released 窗口内重新获取必须成功");
    assert.equal(acq1.generation, 5, fileLabel + "：" + "FIX-14：必须递增代次（不得把旧代次 4 原样发回去）");
    assert.deepEqual(J23813(h.ctx.lease().scopes), ["battle", "movement"], fileLabel + "：" + "FIX-14：scopes 必须是本次请求的值");
    for (let i = 0; i < 5; i++) h.ctx.tick();
    assert.ok(h.ctx.lease(), fileLabel + "：" + "FIX-14：连续 5 帧 apiBattleTick 之后新租约必须还在（不得被当成已释放的旧租约清空）");
    assert.equal(h.ctx.lease().released, false, fileLabel + "：" + "FIX-14：必须复位 released，否则下一帧会把新租约清掉");
    assert.equal(h.ctx.lease().generation, 5, fileLabel + "：" + "FIX-14：活下来的必须是新代次");
    assert.deepEqual(J23813(h.ctx.lease().scopes), ["battle", "movement"], fileLabel + "：" + "FIX-14：活下来的 scopes 必须是本次请求值");
    assert.deepEqual(h.sent, [], fileLabel + "：" + "重新获取本身不得补发任何内挂包");
    assert.equal(h.pickups(), p0, fileLabel + "：" + "重新获取不得误触发 apiPickupReset（租约未被清空 → 不得多一次）");
    // 变异 M-FIX14@stable / M-FIX14@exp：把 released 复位去掉 → 下一帧按旧租约清空
    rmCheck("M-FIX14", fileLabel, M23813(source, ';apiLease.released=false;apiLease.scopes=scopes.slice();', ';apiLease.scopes=scopes.slice();'), (fl, mut) => {
      const m = boot(mut);
      m.ctx.release("ext-owner");
      const mAcq = J23813(m.ctx.acquire("ext-owner", ["battle", "movement"]));
      assert.equal(mAcq.generation, 5, fileLabel + "：" + fl + "：[M-FIX14] 变异体代次照样递增");
      assert.equal(m.ctx.lease().released, false, fileLabel + "：" + fl + "：[M-FIX14] 变异体 released 未复位");
      m.ctx.tick();
      assert.ok(m.ctx.lease(), fl + "：[M-FIX14] 变异体下一帧把刚到手的租约清空");
    });
  }
});

// ================= 第五轮：FIX-15 / FIX-16 / FIX-17 / FIX-18 =================

test("V2.38.13 FIX-15 限流窗口内 release 的同属主重取：迟到的关闭包必须兑现且租约可回收（VM）+ 变异 M-FIX15（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      const tick = A23813(script, "  function apiBattleTick(){", "  function apiBattleDrive(){");
      const acq = A23813(script, "  function apiAcquire(owner,scopes){", "  function apiGuard(owner,scope){");
      const rel = A23813(script, "  function apiRelease(owner){", "  function apiContact(owner,gid){");
      assert.ok(pre.includes("function npSendBattle(want, source, beforeToggle) {"), fileLabel + "：" + "提取必须覆盖内挂发包");
      let NOW = 1000000; const timers = new Map(); let tid = 0;
      const packets = [];
      const ctx = { Math, Number, String, Array, Object, isFinite, RegExp, Error, JSON, parseInt, parseFloat, isNaN,
        Date: { now: () => NOW },
        setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, { fn: fn, at: NOW + ms }); return id; },
        clearTimeout: (id) => { timers.delete(id); },
        npHuntOn: true, npBattleKnown: true, npBattleLastSentAt: NOW, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        npToggleHunt: () => { packets.push("NPC_TOGGLE"); return true; }, npSyncBattleCheckbox: () => {}, tlog: () => {},
        npBattleState: () => ctx.npHuntOn, apiCombatActive: () => false, apiCombat: null, npZeroBattle: () => {},
        apiLease: { owner: "ext-owner", generation: 4, scopes: ["battle"], released: false, selectedNpc: 0, battle: { state: "owned" } },
        apiGeneration: 4, clientReady: () => true,
        apiOwner: (o) => typeof o === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(o),
        apiScopes: (s) => Array.isArray(s) && s.length > 0 && s.every((x) => ["dojo", "battle", "movement", "dialog", "arrow", "fly"].indexOf(x) >= 0),
        apiAllMobsRestore: () => {}, apiPickupReset: () => {}, apiClearBattleTarget: () => ({ ok: true }),
        apiBattleTarget: null, apiBattleTargetEntity: () => true,
        apiEmit: () => {}, moveXY: {}, arrowTarget: null, arrowPending: null, arrowReady: false, arrowBlocked: false,
        zRunning: false, bagClean: { busy: false } };
      vm.createContext(ctx);
      vm.runInContext(tick + acq + rel + pre + ";this.acquire=apiAcquire;this.release=apiRelease;this.tick=apiBattleTick;this.lease=()=>apiLease", ctx);
      return { ctx, packets, timers,
        release: (o) => J23813(ctx.apiRelease(o)), acquire: (o, s) => J23813(ctx.apiAcquire(o, s)),
        fire: () => { NOW += 500; for (const [id, t] of [...timers]) if (t.at <= NOW) { timers.delete(id); t.fn(); } } };
    };
    // 抽取窗口必须真正覆盖目标代码：守卫本体若不在 apiRelease → apiContact 之间，下面的「恰好一次兑现」就是在空跑
    assert.ok(A23813(source, "  function apiRelease(owner){", "  function apiContact(owner,gid){").includes("function(){return !!(apiLease&&apiLease.owner===owner);}"), fileLabel + "：" + "FIX-15：提取窗口必须覆盖按属主放行的守卫");
    // (a) 精确重放：release 落在 350ms 限流窗口内（改成 pending-off 排队）→ 同属主立刻 acquire（代次 +1）→ 队列兑现
    const h = boot(source);
    const rel1 = h.release("ext-owner");
    assert.equal(rel1.ok, true, fileLabel + "：" + "(a) release 必须被受理");
    assert.equal(rel1.result, "pending-off", fileLabel + "：" + "(a) 限流窗口内必须变成「排队等兑现」的 pending-off");
    assert.deepEqual(h.packets, [], fileLabel + "：" + "(a) 入队阶段不得发出关闭包");
    assert.ok(h.ctx.npBattleExplicit && h.ctx.npBattleExplicit.want === false, fileLabel + "：" + "(a) 必须真的把「关内挂」意图排进队");
    assert.equal(h.timers.size, 1, fileLabel + "：" + "(a) 必须真的挂上限流队列定时器（否则用例是空跑）");
    const acq1 = h.acquire("ext-owner", ["battle"]);
    assert.equal(acq1.ok, true, fileLabel + "：" + "(a) 同属主在 released 窗口内重取必须成功");
    assert.equal(acq1.generation, 5, fileLabel + "：" + "(a) FIX-14：重取递增代次（这正是让旧守卫失效的成因）");
    h.fire();
    assert.deepEqual(h.packets, ["NPC_TOGGLE"], fileLabel + "：" + "(a) 迟到的关闭包必须恰好兑现一次");
    assert.equal(h.ctx.npHuntOn, false, fileLabel + "：" + "(a) 关闭后本地态必须落实为 false");
    h.ctx.tick();
    assert.equal(h.ctx.lease().battle.state, "none", fileLabel + "：" + "(a) pending-off 必须收敛为 none");
    assert.ok(h.ctx.lease(), fileLabel + "：" + "(a) 重取后的租约必须还在（不得被当成已释放的旧租约清空）");
    const rel2 = h.release("ext-owner");
    assert.equal(rel2.ok, true, fileLabel + "：" + "(a) 收敛后必须能正常回收租约");
    assert.equal(h.ctx.lease(), null, fileLabel + "：" + "(a) 租约必须最终被回收（不得被永久占住）");
    assert.deepEqual(h.packets, ["NPC_TOGGLE"], fileLabel + "：" + "(a) 回收过程不得再补发内挂包");
    // (b) 反例：属主已换 / 租约已清空 → 迟到的关闭包必须被否决（零包），语义不得回退
    const negative = (mangle, label) => {
      const n = boot(source);
      assert.equal(n.release("ext-owner").result, "pending-off", fileLabel + "：" + label + "：夹具必须真的把关闭包排进队");
      mangle(n);
      n.fire();
      assert.deepEqual(n.packets, [], fileLabel + "：" + label + "：迟到的关闭包必须被否决（零包）");
      assert.equal(n.ctx.npHuntOn, true, fileLabel + "：" + label + "：被否决时本地内挂态不得被改成 off");
    };
    negative((n) => { n.ctx.apiLease = { owner: "other-owner", generation: 9, scopes: ["battle"], released: false, battle: { state: "none" } }; }, "FIX-15(b1) 属主已换");
    negative((n) => { n.ctx.apiLease = null; }, "FIX-15(b2) 租约已清空");
    // 变异 M-FIX15@stable / M-FIX15@exp：还原 FIX-15 之前的「同属主且代次未变」口径 → 迟到的关闭包必须被否决
    rmCheck("M-FIX15", fileLabel, M23813(source, "function(){return !!(apiLease&&apiLease.owner===owner);}", "(function(){var gAtRel=apiLease?apiLease.generation:null;return function(){return !!(apiLease&&apiLease.owner===owner&&apiLease.generation===gAtRel);};})()"), (fl, mut) => {
      const m = boot(mut);
      assert.equal(m.release("ext-owner").result, "pending-off", fileLabel + "：" + fl + "：[M-FIX15] 变异体照样把关闭包排进队");
      m.acquire("ext-owner", ["battle"]);
      m.fire();
      assert.equal(m.ctx.lease().battle.state, "none", fileLabel + "：" + fl + "：[M-FIX15] 变异体代次等式守卫失败：迟到关闭包被否决，battle 卡在 pending-off 永不收敛");
    });
  }
});

test("V2.38.13 FIX-16 setBattle 与快捷键的「已抑制」必须同文案同颜色（VM）+ 变异 M-FIX16（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      const hk = A23813(script, "  function npToggleFight() {", "  // 助手自动战斗快捷键");
      assert.ok(pre.includes("function npResultKind(result, other)"), fileLabel + "：" + "FIX-16：两条入口必须共用同一个颜色映射");
      const statuses = []; const toggles = [];
      const ctx = { Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN, RegExp, Error, JSON,
        Date: { now: () => 1000000 }, setTimeout: () => 0, clearTimeout: () => {},
        npHuntOn: false, npBattleKnown: true, npBattleLastSentAt: -Infinity, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        apiCombatActive: () => true, npToggleHunt: () => { toggles.push(1); return true; }, npSyncBattleCheckbox: () => {},
        tlog: () => {}, setStatus: (t, k) => statuses.push([String(t), k]), dshDiag: () => {} };
      vm.createContext(ctx); vm.runInContext(pre + hk, ctx);
      return { ctx, statuses, toggles };
    };
    const SUPPRESSED = "外部代打进行中：不开内挂自动战斗（已抑制）";
    const h = boot(source);
    h.ctx.setBattle(true);
    h.ctx.npToggleFight();
    assert.equal(h.statuses.length, 2, fileLabel + "：" + "两条路径都必须真的刷新状态栏");
    assert.equal(h.statuses[0][0], SUPPRESSED, fileLabel + "：" + "setBattle 在代打期间必须明确说「已抑制」");
    assert.equal(h.statuses[1][0], h.statuses[0][0], fileLabel + "：" + "FIX-12：快捷键必须与 setBattle 同一句话");
    assert.equal(h.statuses[0][1], "warn", fileLabel + "：" + "FIX-16：请求被拒绝必须用 warn（不得再标成 ok）");
    assert.equal(h.statuses[1][1], "warn", fileLabel + "：" + "FIX-16：快捷键同样是 warn");
    assert.equal(h.statuses[1][1], h.statuses[0][1], fileLabel + "：" + "FIX-16：同一句话必须同一个颜色");
    assert.deepEqual(h.toggles, [], fileLabel + "：" + "两条路径都不得发出开启包");
    // 变异 M-FIX16@stable / M-FIX16@exp：把 setBattle 这一侧改回 ok（两处颜色不一致）
    rmCheck("M-FIX16", fileLabel, M23813(source, 'npResultKind(result, result === "failed" ? "err" : "ok")', 'result === "failed" ? "err" : "ok"'), (fl, mut) => {
      const m = boot(mut);
      m.ctx.setBattle(true);
      m.ctx.npToggleFight();
      assert.equal(m.statuses[0][1], "warn", fileLabel + "：" + fl + "：[M-FIX16] 变异体 setBattle 把「已抑制」又标成 ok");
    });
  }
});

test("V2.38.13 FIX-17 代打取消排队中的开内挂意图必须同步刷新状态栏（VM）+ 变异 M-FIX17（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const combat = A23813(script, "  var apiCombat=null;", "  function apiEmit(kind,detail){");
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      assert.ok(combat.includes("function apiCombatStart(owner){"), fileLabel + "：" + "提取必须覆盖代打启动");
      const statuses = []; const logs = []; const timers = new Map(); let tid = 0; const NOW = 1000000;
      const ctx = { Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN, RegExp, Error, JSON,
        Date: { now: () => NOW },
        setTimeout: (fn) => { timers.set(++tid, { fn: fn, cleared: false }); return tid; },
        clearTimeout: (id) => { const t = timers.get(id); if (t) t.cleared = true; },
        setInterval: () => 7, clearInterval: () => {},
        npHuntOn: false, npBattleKnown: false, npBattleLastSentAt: NOW, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        apiCombat: null, apiLease: { owner: "ext-owner", generation: 3, scopes: ["battle"] }, apiGuard: () => null,
        zRunning: false, zLock: {}, zUseCounts: {}, zLockCounts: {}, zCastIdx: 0, zAtkLast: {}, zMon: {},
        $id: () => ({ value: "0.25" }), tlog: (msg) => logs.push(String(msg)), setStatus: (t, k) => statuses.push([String(t), k]), dshDiag: () => {},
        npBattleState: () => ctx.npHuntOn, apiAllMobsRestore: () => {}, npToggleHunt: () => true };
      vm.createContext(ctx); vm.runInContext(combat + pre, ctx);
      return { ctx, statuses, logs, timers };
    };
    const h = boot(source);
    h.ctx.setBattle(true);
    assert.equal(h.ctx.npHuntOn, false, fileLabel + "：" + "夹具必须处在内挂关（开内挂才需要排队）");
    assert.ok(h.ctx.npBattleExplicit && h.ctx.npBattleExplicit.want === true, fileLabel + "：" + "夹具必须真的排进「开内挂」意图");
    assert.ok(h.ctx.npBattleExplicitTimer, fileLabel + "：" + "排队必须真的挂上定时器");
    h.statuses.length = 0;
    assert.equal(J23813(h.ctx.apiCombatStart("ext-owner")).ok, true, fileLabel + "：" + "代打必须真的启动");
    const canceled = h.statuses.filter((s) => s[0].indexOf("已取消") >= 0);
    assert.equal(canceled.length, 1, fileLabel + "：" + "FIX-17：取消排队必须刷一次状态栏，实际：" + JSON.stringify(h.statuses));
    const text = canceled[0][0];
    assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text), fileLabel + "：" + "FIX-17：文案不得含 emoji");
    assert.ok(!/generation|owner|release|租约|代次|队列项/i.test(text), fileLabel + "：" + "FIX-17：文案不得含实现词：" + text);
    assert.ok(h.logs.some((msg) => msg.indexOf("已取消排队的开内挂") >= 0), fileLabel + "：" + "日志同一事实必须仍在");
    // 变异 M-FIX17@stable / M-FIX17@exp：删掉状态栏刷新 → 「刷了一次」的断言必须红
    rmCheck("M-FIX17", fileLabel, M23813(source, 'try{setStatus("内挂自动战斗：本次开启已取消（外部代打进行中，不再生效）","warn");}catch(eS2){}', ""), (fl, mut) => {
      const m = boot(mut);
      m.ctx.setBattle(true);
      m.statuses.length = 0;
      J23813(m.ctx.apiCombatStart("ext-owner"));
      assert.equal(m.statuses.filter((s) => s[0].indexOf("已取消") >= 0).length, 1, fileLabel + "：" + fl + "：[M-FIX17] 变异体取消只写日志不刷状态栏");
    });
  }
});

test("V2.38.13 FIX-18 代打开始必须丢弃「开」方向候补（「关」方向不动）+ 变异 M-FIX18（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
  const source = src2;
    const boot = (script) => {
      const combat = A23813(script, "  var apiCombat=null;", "  function apiEmit(kind,detail){");
      const pre = A23813(script, "  function npSendBattle(want, source, beforeToggle) {", "  function npRequestBattle(want, source, immediate, beforeToggle) {")
        + A23813(script, "  function npRequestBattle(want, source, immediate, beforeToggle) {", '  onId("dsh-battleon", "click"');
      const ensure = A23813(script, "  function npEnsureHunt() {", "  function npHuntStop(source, immediate) {");
      assert.ok(ensure.includes("npRequestBattle(true, \"npEnsureHunt\""), fileLabel + "：" + "提取必须覆盖 npEnsureHunt");
      let NOW = 1000000;
      const packets = []; const logs = [];
      const ctx = { Math, Number, String, Array, Object, isFinite, parseInt, parseFloat, isNaN, RegExp, Error, JSON,
        Date: { now: () => NOW }, setTimeout: () => 0, clearTimeout: () => {},
        setInterval: () => 7, clearInterval: () => {},
        npHuntOn: false, npBattleKnown: true, npBattleLastSentAt: -Infinity, npBattleConfirmedAt: 0,
        npBattleCandidate: null, npBattleExplicit: null, npBattleExplicitTimer: null, npZeroVerifyTimer: null,
        apiCombat: null, apiLease: { owner: "ext-owner", generation: 3, scopes: ["battle"] }, apiGuard: () => null,
        zRunning: false, zLock: {}, zUseCounts: {}, zLockCounts: {}, zCastIdx: 0, zAtkLast: {}, zMon: {},
        $id: () => ({ value: "0.25" }), tlog: (msg) => logs.push(String(msg)), setStatus: () => {}, dshDiag: () => {},
        npBattleState: () => ctx.npHuntOn, apiAllMobsRestore: () => {},
        npToggleHunt: () => { packets.push("NPC_TOGGLE"); return true; }, npSyncBattleCheckbox: () => {},
        npIsThree: () => false, DEFAULTS: { ClientVer: 5 },
        npSendUpdate: () => { packets.push("UPDATEINFO:38"); return true; }, npSendWhisper: () => { packets.push("NPC_TOGGLE"); return true; } };
      vm.createContext(ctx); vm.runInContext(combat + pre + ensure, ctx);
      return { ctx, packets, logs, advance: (ms) => { NOW += ms; } };
    };
    // 抽取窗口必须真正覆盖目标代码：「开」候补清理若不在 apiCombatStart 内，下面的清空断言就是在空跑
    assert.ok(A23813(source, "  var apiCombat=null;", "  function apiEmit(kind,detail){").includes('if(typeof npBattleCandidate!=="undefined"&&npBattleCandidate&&npBattleCandidate.want){'), fileLabel + "：" + "FIX-18：提取窗口必须覆盖代打开始处的「开」候补清理");
    const h = boot(source);
    h.ctx.npEnsureHunt(); // 代打前先落一个「开」方向 debounce 候补
    assert.ok(h.ctx.npBattleCandidate && h.ctx.npBattleCandidate.want === true, fileLabel + "：" + "夹具必须真的落下「开」方向候补");
    assert.deepEqual(h.packets, [], fileLabel + "：" + "候补阶段零内挂包");
    h.advance(2000); // 让候补的 800ms 窗口过期（保留原缺陷时它下一拍就会兑现）
    assert.equal(J23813(h.ctx.apiCombatStart("ext-owner")).ok, true, fileLabel + "：" + "代打必须真的启动");
    assert.equal(h.ctx.npBattleCandidate, null, fileLabel + "：" + "FIX-18：代打开始必须丢弃「开」方向候补");
    h.ctx.npEnsureHunt(); // 代打期间驱动 → suppressed，且不得重新落下开启候补
    assert.equal(h.ctx.npBattleCandidate, null, fileLabel + "：" + "FIX-18：代打期间驱动不得留下开启候补");
    assert.deepEqual(h.packets, [], fileLabel + "：" + "代打期间零开启包");
    h.ctx.apiCombatStop(); // 代打结束
    h.ctx.npEnsureHunt();  // 结束后再驱动一次：只能重新 debounce，绝不兑现陈旧候补
    assert.deepEqual(h.packets, [], fileLabel + "：" + "FIX-18：代打结束后不得兑现陈旧候补（零开启包）");
    assert.ok(h.ctx.npBattleCandidate && h.ctx.npBattleCandidate.want === true, fileLabel + "：" + "结束时应当重新落下一个新的开启候补（而非兑现旧的）");
    // 「关」方向候补不受影响
    h.ctx.npBattleCandidate = { want: false, source: "npHuntStop", since: 0, beforeToggle: null };
    J23813(h.ctx.apiCombatStart("ext-owner"));
    assert.ok(h.ctx.npBattleCandidate && h.ctx.npBattleCandidate.want === false, fileLabel + "：" + "FIX-18：「关」方向候补不得被清掉");
    // 变异 M-FIX18@stable / M-FIX18@exp：把「开」候补清理的守卫改成恒假 → 陈旧候补得以兑现
    rmCheck("M-FIX18", fileLabel, M23813(source, 'if(typeof npBattleCandidate!=="undefined"&&npBattleCandidate&&npBattleCandidate.want){', 'if(false){'), (fl, mut) => {
      const m = boot(mut);
      m.ctx.npEnsureHunt();
      m.advance(2000);
      m.ctx.apiCombatStart("ext-owner");
      assert.equal(m.ctx.npBattleCandidate, null, fileLabel + "：" + fl + "：[M-FIX18] 变异体代打开始后陈旧开启候补仍在");
      m.ctx.apiCombatStop();
      m.ctx.npEnsureHunt();
      assert.equal(m.packets.indexOf("NPC_TOGGLE"), -1, fileLabel + "：" + fl + "：[M-FIX18] 变异体陈旧候补被兑现，发出开内挂包");
    });
  }
});

// ================= 第六轮：FIX-19 apiRelease 战斗释放分支的严格模式红线 =================
test("V2.38.13 FIX-19 release 战斗分支必须局部声明 r：严格模式真跑「sent/queued → pending-off，其它 → released=false」+ 变异 M-FIX19", () => {
  // 产品里 "use strict" 在第 445 行（roAssistMain IIFE 顶部）：把函数从 IIFE 里切出来单独执行会丢掉严格模式，
  // 而「未声明的 r」在非严格模式下只会悄悄建一个全局变量、不抛错 → 用例会永远绿。所以下面必须逐字复现严格模式。
  const strictMode = '"use strict";';
  const boot = (script, label) => {
    const rel = A23813(script, "  function apiRelease(owner){", "  function apiContact(owner,gid){");
    // 抽取窗口必须真的盖住被测分支：守卫/判定若不在窗口里，下面的断言就是在空跑
    assert.ok(rel.includes('external-release:'), label + "：提取窗口必须覆盖 release 的关闭包");
    assert.ok(rel.includes('if(r==="sent"||r==="queued")l.battle.state="pending-off";else l.released=false;'), label + "：提取窗口必须覆盖 r 的判定分支");
    const asks = [];
    const state = { result: "sent" };
    const ctx = { Math, Number, String, Array, Object, isFinite, RegExp, Error, JSON, Date: { now: () => 1000 },
      apiLease: { owner: "ext-owner", generation: 4, scopes: ["battle"], released: false, selectedNpc: 0, battle: { state: "owned" } },
      clientReady: () => true,
      apiOwner: (o) => typeof o === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(o),
      apiScopes: (s) => Array.isArray(s) && s.length > 0 && s.every((x) => ["dojo", "battle", "movement", "dialog", "arrow", "fly"].indexOf(x) >= 0),
      npBattleState: () => false, npClearBattleIntent: () => {}, npZeroBattle: () => {},
      npRequestBattle: (want, src, immediate, beforeToggle) => { asks.push([want, String(src), immediate, typeof beforeToggle]); return state.result; },
      apiCombat: null, apiAllMobsRestore: () => {}, apiPickupReset: () => {}, apiClearBattleTarget: () => ({ ok: true }),
      apiBattleTick: () => {}, apiEmit: () => {},
      moveXY: {}, arrowTarget: null, arrowPending: null, arrowReady: false, arrowBlocked: false,
      zRunning: false, bagClean: { busy: false } };
    vm.createContext(ctx);
    vm.runInContext(strictMode + rel + ";this.release=apiRelease;this.lease=()=>apiLease", ctx);
    return { ctx, asks, state,
      release: (o) => J23813(ctx.apiRelease(o)), // 严格模式下的 ReferenceError 必须原样冒出来（绝不 try/catch 吞掉）
      lease: () => ctx.apiLease };
  };
  for (const [fileLabel, script] of FIX23813_SRC) {
    // (1) owned + "sent" → pending-off：租约留在原地并标记 released（内挂关闭包已排队）
    const h = boot(script, fileLabel);
    const r1 = h.release("ext-owner");
    assert.equal(r1.ok, true, fileLabel + "：sent 之后 release 必须报 ok:true");
    assert.equal(r1.result, "pending-off", fileLabel + "：sent 必须走到 pending-off");
    assert.equal(h.asks.length, 1, fileLabel + "：必须真的问过一次关闭包（否则用例空跑）");
    assert.deepEqual(h.asks[0], [false, "external-release:ext-owner", true, "function"], fileLabel + "：关闭包必须带按属主放行的守卫");
    assert.ok(h.lease(), fileLabel + "：pending-off 期间租约必须留在原地等 apiBattleTick 收敛");
    assert.equal(h.lease().battle.state, "pending-off", fileLabel + "：战斗态必须落到 pending-off");
    assert.equal(h.lease().released, true, fileLabel + "：必须标记已释放，否则下一帧不会回收");
    // (1b) queued 与 sent 同权（限流队列兑现）
    const hq = boot(script, fileLabel + "(queued)");
    hq.state.result = "queued";
    assert.equal(hq.release("ext-owner").result, "pending-off", fileLabel + "：queued 必须与 sent 同权走到 pending-off");
    // (2) owned + "failed" → 绝不假装成功：状态不动、released 回滚、如实报 ok:false
    const h2 = boot(script, fileLabel + "(failed)");
    h2.state.result = "failed";
    const r2 = h2.release("ext-owner");
    assert.equal(r2.ok, false, fileLabel + "：关闭包没发出去就不能报成功");
    assert.equal(r2.result, "owned", fileLabel + "：失败时战斗态必须停在 owned");
    assert.equal(h2.lease().battle.state, "owned", fileLabel + "：失败时不得改战斗态");
    assert.equal(h2.lease().released, false, fileLabel + "：失败时必须回滚 released");
    // (3) 已经 pending-off → 一次都不许再问，直接按已释回收口
    const h3 = boot(script, fileLabel + "(pending-off)");
    h3.lease().battle.state = "pending-off";
    h3.lease().released = true;
    const r3 = h3.release("ext-owner");
    assert.equal(r3.ok, true, fileLabel + "：pending-off 必须直接放行");
    assert.equal(r3.result, "pending-off", fileLabel + "：pending-off 必须原样返回");
    assert.deepEqual(h3.asks, [], fileLabel + "：已经在 pending-off 时一个关闭包都不许再发");
  }
  // 变异 M-FIX19@stable / M-FIX19@exp：把局部声明删掉（还原导致发布阻塞的原始写法）→ 严格模式下必须 ReferenceError
  for (const [fl19, src19] of FIX23813_SRC) {
    rmCheck("M-FIX19", fl19, M23813(src19, '{var r=npRequestBattle(false,"external-release:"+owner', '{r=npRequestBattle(false,"external-release:"+owner'), (fl, mut) => {
      const m = boot(mut, fl + "(变异体)");
      assert.throws(() => m.release("ext-owner"),
        (err) => !!err && err.name === "ReferenceError" && /r is not defined/.test(String(err.message)),
        fl + "：[M-FIX19] 未声明的 r 在严格模式下必须抛 ReferenceError（证明用例真的在执行这段分支，不是只比源码字符串）");
      assert.equal(m.lease().released, false, fl + "：[M-FIX19] 变异体抛错发生在写回判定之前 → released 已置 true");
      assert.equal(m.lease().battle.state, "owned", fl + "：[M-FIX19] 变异体战斗态卡在 owned、apiLease 永不清空");
    });
  }
});


// ================= V2.38.13：apiSetBattleTarget 的 battle-target-not-live 行为级用例 =================
// 覆盖 ro-assist.user.js:17571 的分支 {ok:false,error:"battle-target-not-live"}（实体不存在/已死时返回）。
// 全部在 vm 里真跑 apiSetBattleTarget，不看源码字面量。
test("V2.38.13 apiSetBattleTarget 目标不存活必须 battle-target-not-live（活目标仍 ok:true）+ 变异 M-FIX-BTLIVE（两文件）", () => {
  for (const [fileLabel, src2] of FIX23813_SRC) {
    const source = src2; // FIX23813 参数化：本块内 source 指向当前被测文件
    const mk = (script) => {
      const code = A23813(script, "  function apiBattleTargetEntity(target){", "  function apiBattleTick(){");
      // 抽取窗口必须真的盖住被测分支
      assert.ok(code.includes("function apiSetBattleTarget(owner,target){"), fileLabel + "：提取窗口必须覆盖 apiSetBattleTarget");
      if (code.indexOf(String.fromCharCode(34) + "battle-target-not-live" + String.fromCharCode(34)) >= 0) assert.ok(true, fileLabel + "：提取窗口必须覆盖 not-live 分支");
      const entities = []; let syncs = 0; let clears = 0;
      const ctx = {
        DOJO_OWNER: "builtin-dojo",
        apiGuard: () => null,
        apiEntities: () => entities.slice(),
        arrowPos: (v) => { const n = Number(v); return n > 0 ? n : null; },
        apiBattleTarget: null, apiBattleSuppressed: {}, lockList: {},
        npSyncTargets: () => { syncs++; },
        apiClearBattleTarget: () => { clears++; return { ok: true }; },
        Number, Math, String, Array, Object, isFinite };
      vm.createContext(ctx);
      vm.runInContext(code + ";this.set=apiSetBattleTarget;this.ent=apiBattleTargetEntity", ctx);
      return { ctx, entities, syncs: () => syncs, clears: () => clears };
    };
    const live = { gid: 8, type: 5, mid: 1002, dead: false, position: [10, 10] };
    // (a) 目标实体不存在 → battle-target-not-live，且零副作用（不落目标、不同步、不清目标）
    const a = mk(source);
    assert.equal(a.entities.length, 0, fileLabel + "：(a) 夹具必须真的没有任何实体");
    assert.deepEqual(J23813(a.ctx.set("owner-one", { mid: 1002, gid: 8 })), { ok: false, error: "battle-target-not-live" }, fileLabel + "：(a) 实体不存在必须报 battle-target-not-live");
    assert.equal(a.ctx.apiBattleTarget, null, fileLabel + "：(a) 失败时不得落下战斗目标");
    assert.equal(a.syncs(), 0, fileLabel + "：(a) 失败时零内挂同步");
    assert.equal(a.clears(), 0, fileLabel + "：(a) 失败时不得去清目标");
    // (a2) 目标已死 → 同样 not-live
    const a2 = mk(source);
    a2.entities.push({ gid: 8, type: 5, mid: 1002, dead: true, position: [10, 10] });
    assert.deepEqual(J23813(a2.ctx.set("owner-one", { mid: 1002, gid: 8 })), { ok: false, error: "battle-target-not-live" }, fileLabel + "：(a2) 目标已死必须报 battle-target-not-live");
    assert.equal(a2.ctx.apiBattleTarget, null, fileLabel + "：(a2) 目标已死时不得落下战斗目标");
    // (a3) 只有同 gid 但 mid 不匹配 → 同样 not-live（不会张冠李戴）
    const a3 = mk(source);
    a3.entities.push({ gid: 8, type: 5, mid: 9999, dead: false, position: [10, 10] });
    assert.deepEqual(J23813(a3.ctx.set("owner-one", { mid: 1002, gid: 8 })), { ok: false, error: "battle-target-not-live" }, fileLabel + "：(a3) gid 命中但 mid 不匹配必须报 battle-target-not-live");
    // (b) 活着的目标成功路径仍必须 ok:true
    const b = mk(source);
    b.entities.push(live);
    assert.equal(J23813(b.ctx.set("owner-one", { mid: 1002, gid: 8 })).ok, true, fileLabel + "：(b) 活着的目标必须 ok:true");
    assert.deepEqual(J23813(b.ctx.apiBattleTarget), { owner: "owner-one", mid: 1002, gid: 8, npAdded: false }, fileLabel + "：(b) 必须真的落下战斗目标");
    assert.equal(b.syncs(), 0, fileLabel + "：(b) 非 DOJO_OWNER 不得同步内挂目录");
    // (b2) 同一 owner 同一目标重复设置 → 幂等 ok:true，且不得清目标 / 不得重复同步
    const b2 = mk(source);
    b2.entities.push(live);
    assert.equal(J23813(b2.ctx.set("owner-one", { mid: 1002, gid: 8 })).ok, true, fileLabel + "：(b2) 首次设置必须 ok");
    const snap = J23813(b2.ctx.apiBattleTarget);
    assert.equal(J23813(b2.ctx.set("owner-one", { mid: 1002, gid: 8 })).ok, true, fileLabel + "：(b2) 重复设置必须幂等 ok:true");
    assert.deepEqual(J23813(b2.ctx.apiBattleTarget), snap, fileLabel + "：(b2) 幂等路径必须原样保留已有目标");
    assert.equal(b2.clears(), 0, fileLabel + "：(b2) 幂等路径不得先清再设");
    assert.equal(b2.syncs(), 0, fileLabel + "：(b2) 幂等路径不得补发同步");
    // (b3) 内置道场 owner 的活目标 → ok:true 且同步一次
    const b3 = mk(source);
    b3.entities.push(live);
    assert.equal(J23813(b3.ctx.set("builtin-dojo", { mid: 1002, gid: 8 })).ok, true, fileLabel + "：(b3) 内置道场活目标必须 ok:true");
    assert.equal(b3.syncs(), 1, fileLabel + "：(b3) 内置道场路径必须同步一次锁定目录");
    // (c) 变异 M-FIX-BTLIVE@stable / @exp：整段删掉 not-live 判定 → 实体不存在时必须变红（无判定后不再返回 not-live，而是继续走到赋值）。
    //     实测红法：无判定后实体不存在时直接落下目标并返回 {ok:true}（实例：实际 {"ok":true}），与 (a) 的 not-live 期望不符 → 用例变红。
    const mutNotLive = M23813(source, 'var entity=apiBattleTargetEntity({mid:mid,gid:gid});if(!entity)return {ok:false,error:"battle-target-not-live"};', "");
    rmCheck("M-FIX-BTLIVE", fileLabel, mutNotLive, (fl, mut) => {
      const am = mk(mut);
      let res = null;
      try { res = J23813(am.ctx.set("owner-one", { mid: 1002, gid: 8 })); } catch (e) { res = { threw: String(e && e.message) }; }
      assert.deepEqual(res, { ok: false, error: "battle-target-not-live" }, fl + "：[M-FIX-BTLIVE] 删掉 not-live 判定后，实体不存在时不再返回 not-live（实际：" + JSON.stringify(res) + "）");
    });
    // (c2) 变异 M-FIX-BTLIVE-COUNT：把存活判定改成「只数到 gid 就算活」→ 目标已死也放行
    const mutCount = M23813(source, "var rows=apiEntities();for(var i=0;i<rows.length;i++){var e=rows[i];if(e.gid===gid&&e.type===5&&!e.dead&&e.mid===mid)return e;}return null;", "var rows=apiEntities();for(var i=0;i<rows.length;i++){var e=rows[i];if(e.gid===gid&&e.type===5)return e;}return null;");
    rmCheck("M-FIX-BTLIVE-COUNT", fileLabel, mutCount, (fl, mut) => {
      const cm = mk(mut);
      cm.entities.push({ gid: 8, type: 5, mid: 1002, dead: true, position: [10, 10] });
      assert.deepEqual(J23813(cm.ctx.set("owner-one", { mid: 1002, gid: 8 })), { ok: false, error: "battle-target-not-live" }, fl + "：[M-FIX-BTLIVE-COUNT] 变异体把已死实体当成活目标");
    });
  }
});

// ================= FIX23813 变异矩阵：13 条 FIX-* 的每个变异在 stable/exp 上都必须变红 =================
test("FIX23813 变异矩阵：13 条 FIX-* 用例的全部 15 个变异都在 stable/exp 上独立验证且必须变红（覆盖核对）", () => {
  // 13 条 FIX-* 用例共 15 个变异（FIX-2/FIX-7 各两个），每个都必须分别在 stable 与 exp 上独立作用并让用例变红
  const FIX_MUTATIONS = ["M-FIX1","M-FIX2a","M-FIX2b","M-FIX6","M-FIX7a","M-FIX7b","M-FIX10b","M-FIX12","M-FIX13","M-FIX14","M-FIX15","M-FIX16","M-FIX17","M-FIX18","M-FIX19"];
  const FIX_FAMILIES = 13;
  let rows = 0;
  for (const mut of FIX_MUTATIONS) {
    for (const fl of ["stable", "exp"]) {
      const hits = FIX23813_MATRIX.filter((m) => m.fix === mut && m.file === fl);
      assert.equal(hits.length, 1, mut + "@" + fl + "：该变异必须在 " + fl + " 上独立跑一次（当前 " + hits.length + " 次）");
      for (const hit of hits) {
        assert.equal(hit.expected, "红", hit.tag + " 期望必须记成红");
        assert.equal(hit.actual, "红", hit.tag + " 变异必须真的被断言杀死（实际 " + hit.actual + "）");
        assert.ok(hit.caught && hit.caught.indexOf("未被抓") < 0, hit.tag + " 必须记录到被抓断言，实际：" + hit.caught);
        rows++;
      }
    }
  }
  assert.equal(rows, FIX_MUTATIONS.length * 2, "15 个变异 × 两文件 = 30 条覆盖，实际 " + rows + " 条");
  assert.equal(FIX_FAMILIES, 13, "FIX-* 用例数必须是 13 条");
  // 另外 2 个属于本次新增行为级用例（apiSetBattleTarget 的 not-live 分支）的变异，同样必须两文件各自变红
  const NEW_MUTATIONS = ["M-FIX-BTLIVE", "M-FIX-BTLIVE-COUNT"];
  let newRows = 0;
  for (const mut of NEW_MUTATIONS) {
    for (const fl of ["stable", "exp"]) {
      const hits = FIX23813_MATRIX.filter((m) => m.fix === mut && m.file === fl);
      assert.equal(hits.length, 1, mut + "@" + fl + "：新增用例的变异必须在 " + fl + " 上独立跑一次（当前 " + hits.length + " 次）");
      const hit = hits[0];
      assert.equal(hit.expected, "红", hit.tag + " 期望必须记成红");
      assert.equal(hit.actual, "红", hit.tag + " 变异必须真的被断言杀死（实际 " + hit.actual + "）");
      assert.ok(hit.caught && hit.caught.indexOf("未被抓") < 0, hit.tag + " 必须记录到被抓断言，实际：" + hit.caught);
      newRows++;
    }
  }
  assert.equal(newRows, NEW_MUTATIONS.length * 2, "2 个新增变异 × 两文件 = 4 条覆盖，实际 " + newRows + " 条");
  assert.equal(FIX23813_MATRIX.length, rows + newRows, "矩阵里不得出现未被覆盖核对的孤儿行");
  // 无法在 exp 上独立作用的变异必须显式登记为 N/A（当前 0 个：全部变异锚点在 stable/exp 两文件都唯一存在）
  const NA = [];
  assert.equal(NA.length, 0, "当前不存在无法在 exp 独立作用的变异；若出现必须在此登记并给出等价证据");
  console.log("[FIX23813 变异矩阵] " + rows + " 条覆盖全部为红：" + FIX_MUTATIONS.map((m) => m + "@stable, " + m + "@exp").join(", "));
  if (process.env.FIX_MATRIX_JSON) {
    fs.writeFileSync(process.env.FIX_MATRIX_JSON, JSON.stringify(FIX23813_MATRIX, null, 2), "utf8");
    console.log("[FIX23813 变异矩阵] 已写出 " + process.env.FIX_MATRIX_JSON);
  }
  assert.deepEqual([...new Set(FIX23813_MATRIX.map((m) => m.file))].sort(), ["exp", "stable"], "矩阵必须同时覆盖 stable 与 exp");
  assert.ok(FIX23813_MATRIX.every((m) => m.fix.indexOf("M-") === 0), "矩阵键必须使用变异标签命名约定");
  assert.ok(FIX23813_MATRIX.every((m) => String(m.caught).indexOf("未被抓") < 0), "不得存在变异存活行");
});

// ================= V2.38.15：战斗 / 首领 / 防御口径整改 —— 行为用例 + 变异矩阵 =================
const V23815_MATRIX = [];
const v15Catch = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const v15Msg = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 220);
const lf15 = (x) => String(x).split(String.fromCharCode(13)).join('');
function cut15(src, a, b) {
  const t = lf15(src);
  const n = t.split(a).length - 1;
  assert.equal(n, 1, '切段锚点必须唯一(' + n + '): ' + a.slice(0, 80));
  const i = t.indexOf(a), j = t.indexOf(b, i);
  assert.ok(i >= 0 && j > i, '切段失败: ' + a.slice(0, 80));
  return t.slice(i, j);
}
const V15_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const V15_UI_BAN = /发包|客户端|字段|接口|请求/;

// ---------- ① 锁定名单 ↔ 打全部怪 自动联动 ----------
function v15AutoLinkHarness(src, trusted) {
  const code = cut15(src, '  function profileLockSave() {', '  function addLock(id, name) {');
  const box = { checked: true };
  const st = { saves: 0, caps: 0, writes: 0 };
  const ctx = { lockList: {}, $id: (id) => (id === 'dsh-z-allmobs' ? box : null), saved: { allMobs: false },
    saveSaved: () => { st.saves++; }, captureAll: () => { st.caps++; },
    profileTrusted: () => trusted, activeProfileKey: () => 'ch1', profWriteGuard: () => true,
    ensureProfile: (k) => { if (!ctx.profiles[k]) ctx.profiles[k] = {}; return ctx.profiles[k]; },
    profiles: {}, saveProfiles: () => { st.writes++; },
    renderLockList: () => {}, npSyncTargets: () => {}, tlog: () => {},
    Object, Number, String, Array, JSON, Date, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.auto=zAllMobsAutoApply;this.save=profileLockSave;', ctx);
  return { ctx: ctx, box: box, st: st };
}
function v15AutoLink(src, name) {
  const s = lf15(src);
  const h = v15AutoLinkHarness(s, true);
  h.ctx.lockList = {}; h.box.checked = false; h.st.saves = 0;
  assert.equal(h.ctx.auto('t'), true, name + '：名单为空必须自动勾上');
  assert.equal(h.box.checked, true, name + '：名单为空必须把勾选同步到界面');
  assert.equal(h.ctx.saved.allMobs, true, name + '：勾选必须走同一套设置保存路径');
  assert.equal(h.st.saves, 1, name + '：勾选变化必须落盘一次');
  h.ctx.lockList = { '1002': { name: 'A' } }; h.st.saves = 0;
  assert.equal(h.ctx.auto('t'), false, name + '：名单非空必须自动取消勾选');
  assert.equal(h.box.checked, false, name + '：名单非空必须把取消同步到界面');
  assert.equal(h.ctx.saved.allMobs, false, name + '：取消同样必须落盘');
  assert.equal(h.st.saves, 1, name + '：取消必须落盘一次');
  h.st.saves = 0; h.ctx.auto('t');
  assert.equal(h.st.saves, 0, name + '：状态一致时不得重复写盘');
  h.ctx.lockList = {}; h.ctx.save();
  assert.equal(h.box.checked, true, name + '：名单清空后必须自动重新勾上（走真实落盘链路）');
  const hu = v15AutoLinkHarness(s, false);
  hu.ctx.lockList = { '1': { name: 'x' } }; hu.box.checked = true; hu.st.saves = 0;
  hu.ctx.auto('t');
  assert.equal(hu.box.checked, false, name + '：角色档未识别也要同步界面勾选');
  assert.equal(hu.st.saves, 0, name + '：角色档未识别绝不能落盘');
  assert.ok(s.includes('try { zAllMobsAutoApply("锁定名单变更"); } catch (e2) {}'), name + '：名单落盘链必须接上自动联动');
}
test('V2.38.15 ① 锁定名单与「打全部怪」自动联动 + 随档保存 + 未识别不写盘（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15AutoLink(src, name);
});

// ---------- ① 外部代打联动 ----------
function v15AssistHarness(src) {
  const code = cut15(src, '  function profileLockSave() {', '  function addLock(id, name) {')
    + String.fromCharCode(10) + cut15(src, '  var apiAllMobsSaved = null;', '  function apiPickupReset() {')
    + String.fromCharCode(10) + cut15(src, '  function apiPrepareCombat(owner, opts) {', '  function apiRequestPickup(owner, payload) {');
  const box = { checked: false };
  const st = { saves: 0, writes: 0, caps: 0 };
  const ctx = { lockList: {}, $id: (id) => (id === 'dsh-z-allmobs' ? box : null), saved: { allMobs: false },
    saveSaved: () => { st.saves++; }, captureAll: () => { st.caps++; },
    profileTrusted: () => true, activeProfileKey: () => 'ch1', profWriteGuard: () => true,
    ensureProfile: (k) => { if (!ctx.profiles[k]) ctx.profiles[k] = {}; return ctx.profiles[k]; },
    profiles: {}, saveProfiles: () => { st.writes++; },
    renderLockList: () => {}, npSyncTargets: () => {}, tlog: () => {},
    clientReady: () => true, apiLease: { owner: 'builtin-dojo' }, apiGuard: () => null,
    Object, Number, String, Array, JSON, Date, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.prep=apiPrepareCombat;this.restore=apiAllMobsRestore;', ctx);
  return { ctx: ctx, box: box, st: st };
}
function v15AssistLink(src, name) {
  const s = lf15(src);
  const h = v15AssistHarness(s);
  h.ctx.lockList = { '1002': { name: 'A' } };
  h.box.checked = false;
  const r = h.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true });
  assert.equal(r.ok, true, name + '：代打战斗准备必须成立');
  assert.equal(r.cleared, 1, name + '：必须清掉 1 条名单');
  assert.equal(h.ctx.apiAllMobsSaved, false, name + '：原值必须在清空名单之前记下（自动勾选的值绝不能被当成原值）');
  assert.equal(h.box.checked, true, name + '：清空名单自动勾上 + 代打要求全部怪 → 必须为勾选');
  assert.equal(h.ctx.restore(), true, name + '：释放必须执行还原');
  assert.equal(h.box.checked, false, name + '：释放必须还原清空前的原值 false');
  assert.equal(h.ctx.apiAllMobsSaved, null, name + '：还原后必须清空暂存');
  const iRead = s.indexOf('var allMobsWas0 = (o.allMobs === true && allMobsEl0) ? !!allMobsEl0.checked : null;');
  const iClear = s.indexOf('if (o.clearLocks === true) {');
  const iCommit = s.indexOf('if (allMobsWas0 !== null && apiAllMobsSaved === null) apiAllMobsSaved = allMobsWas0;');
  assert.ok(iRead >= 0 && iClear > iRead, name + '：源文件里「读原值」必须排在清名单之前（清名单自动勾上的值绝不能被当成原值）');
  assert.ok(iCommit > iClear, name + '：V2.38.16 F1：只有代打确实启动（可信分支已过）才提交原值，提交点必须在清名单之后');
  assert.ok(!s.includes('apiAllMobsSaved = !!allMobsEl0.checked'), name + '：V2.38.16 F1：不得在清名单之前往暂存值里写自动勾选的结果');
}
test('V2.38.15 ① 代打联动：清空名单→自动勾上，释放还原原值（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15AssistLink(src, name);
});

// ---------- ②③ 首领绝对优先 + 忽略集合 ----------
function v15BossPriority(src, name) {
  const s = lf15(src);
  const code = cut15(s, '  var zBossIgnoreAll = false;', '  // A6：早退点不冻结整拍');
  const mk = (act, locked, hp, o) => {
    const oo = o || {};
    const els = { 'dsh-z-bossact': { value: act }, 'dsh-z-bosshp': { value: '30' },
      'dsh-z-bossdist': { value: oo.dist == null ? '14' : String(oo.dist) } };
    const ctx = { lockList: locked ? { '2001': 1 } : { '9999': 1 },
      scanMobs: [{ GID: 77, mid: 2001, isBoss: true, dist: oo.bossDist == null ? 1 : oo.bossDist, name: 'B' }],
      lastMobs: [], $id: (id) => els[id] || null,
      gidInt: Number, zEntHpPct: () => hp,
      getMobDb: () => ({ '2001': { MvpDropsNum: 1 }, '9999': { MvpDropsNum: '0' } }),
      Object, String, Number, parseInt, isNaN, isFinite };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.run=zBossDecide;this.ign=(g,m)=>zBossIgnoredGid(g,m===undefined?2001:m);this.st=()=>({all:zBossIgnoreAll,allow:zBossAllowGid,want:zBossWantGid,block:zBossLastBlock});', ctx);
    return ctx;
  };
  const z1 = mk('不处理', true, 10); const rz1 = z1.run(z1.scanMobs);
  assert.equal(rz1.fly, false, name + '：不处理不得飞');
  assert.equal(rz1.want, 0, name + '：不处理不得指定最高优先目标');
  assert.equal(z1.st().all, true, name + '：不处理必须把首领放进忽略集合');
  assert.equal(z1.ign(77), true, name + '：不处理必须把首领放进忽略集合');
  const t1 = mk('等待残血补尾刀', false, 50); t1.run(t1.scanMobs);
  assert.equal(t1.ign(77), true, name + '：尾刀未到线必须忽略（不主动打、不还击、不因它飞）');
  assert.equal(t1.st().allow, 0, name + '：尾刀未到线不得放行');
  assert.equal(t1.st().block, '尾刀未到线', name + '：诊断必须写明「尾刀未到线」');
  const t2 = mk('等待残血补尾刀', false, 30); const rt2 = t2.run(t2.scanMobs);
  assert.equal(rt2.want, 77, name + '：到尾刀线必须切过去补尾刀');
  assert.equal(t2.ign(77), false, name + '：到尾刀线那一只必须放行');
  const t3 = mk('等待残血补尾刀', false, -1); t3.run(t3.scanMobs);
  assert.equal(t3.st().allow, 0, name + '：血量未知也必须忽略（不得当成到尾刀线）');
  assert.equal(t3.ign(77), true, name + '：血量未知也必须进忽略集合');
  assert.equal(t3.st().block, '血量未知', name + '：诊断必须写明「血量未知」');
  const f1 = mk('瞬移', true, 10); const rf1 = f1.run(f1.scanMobs);
  assert.equal(rf1.fly, true, name + '：瞬移模式必须本拍就飞（不得因为首领已在锁定名单里转优先攻击）');
  const p1 = mk('优先攻击', false, 10); const rp1 = p1.run(p1.scanMobs);
  assert.equal(rp1.want, 77, name + '：优先攻击必须越过锁定名单拿到首领');
  assert.equal(p1.st().all, false, name + '：优先攻击不进忽略集合');
  const d1 = mk('优先攻击', false, 10, { dist: 5, bossDist: 6 });
  assert.equal(d1.run(d1.scanMobs).want, 0, name + '：超出判定距离的首领不得参与裁决');
  const d2 = mk('优先攻击', false, 10, { dist: 14, bossDist: 14 });
  assert.equal(d2.run(d2.scanMobs).want, 77, name + '：判定距离必须按可填值生效（默认 14）');
  assert.equal(d2.isBossMid('2001'), true, name + '：首领识别必须认怪物库首领值大于 0');
  assert.equal(d2.isBossMid('9999'), false, name + '：首领值 0 不算首领');
  assert.equal(d2.isBossMid(4242), false, name + '：怪物库里没有就不算首领');
  assert.ok(!cut15(s, '  function zBossDecide(mobs) {', '  // A6：早退点不冻结整拍').includes('lockList'), name + '：首领裁决不得引用锁定名单');
}
test('V2.38.15 ②③ 首领绝对优先：四种动作只按 BOSS 设置裁决（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15BossPriority(src, name);
});

// ---------- ② 还击只对非首领怪生效 ----------
function v15Retaliate(src, name) {
  const s = lf15(src);
  const seg = cut15(s, '      // V2.34.0 A5：非选中怪独立一路判定', '      // 换怪延迟：目标变化时记录延迟点');
  const bossCode = cut15(s, '  function isBossMid(mid) {', '  // V2.38.15：首领忽略集合统一判据');
  const run = (lockGid, attackerMid) => {
    const escapes = [];
    const lock = { gid: lockGid, reactive: false, name: '', dist: null };
    const ctx = { gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
      zHitPrune: () => {}, zHitKeepMs: 3000,
      zEntOf: (gid) => ({ GID: gid, display: { name: 'Mob' + gid }, _job: attackerMid, position: [1, 1] }),
      zHitBy: { 4242: { ts: 9000, dist: 3 } }, zLock: lock, zMon: {}, onaMode: '还击', now: 10000,
      requestEmergencyEscape: (reason) => escapes.push(reason), setStatus: () => {}, $id: () => null,
      getMobDb: () => ({ '1002': { MvpDropsNum: 1 }, '1113': { MvpDropsNum: 0 } }),
      target: null, hitCandDist: 0, parseInt, isFinite, String, Number, Object };
    vm.createContext(ctx);
    vm.runInContext(bossCode + ';this.fn = function () {' + String.fromCharCode(10) + seg + String.fromCharCode(10) + '};', ctx);
    ctx.fn();
    return { ctx: ctx, lock: lock, escapes: escapes };
  };
  const rb = run(null, 1002);
  assert.equal(rb.ctx.target, null, name + '：首领不得成为还击目标');
  assert.equal(rb.lock.gid, null, name + '：首领不得被写进锁定目标');
  assert.equal(rb.escapes.length, 0, name + '：首领还击不得触发脱离');
  const rn = run(null, 1113);
  assert.ok(rn.ctx.target, name + '：非名单非首领怪照旧必须能还击');
  assert.equal(rn.ctx.target.GID, 4242, name + '：还击目标必须是那只攻击者');
  assert.equal(rn.lock.reactive, true, name + '：还击必须标记为还击锁定');
  assert.ok(s.includes('if (!isBossMid(mid) && d <= atkRange && d < hitBest)'), name + '：射程内最近怪这条还击候选也必须排除首领');
  assert.ok(s.includes('if (isBossMid(mid)) return;'), name + '：贴身还击候选同样必须排除首领');
  assert.ok(s.includes('if (isBossMid(hitCandMid)) hitCandEnt = null;'), name + '：「最近 3 秒打过我的怪」这条还击候选必须排除首领');
}
test('V2.38.15 ② 还击只对非首领怪生效，非名单非首领怪照旧还击（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15Retaliate(src, name);
});

// ---------- ③ 忽略集合覆盖索敌候选 ----------
function v15WalkIgnore(src, name) {
  const s = lf15(src);
  const ent = { position: [0, 0] };
  const base = { mobs: [vmMob(11, '1002', [1, 0])], lockList: { '1002': { name: 'B' } }, allMobs: false, ent: ent, isBossMid: (m) => String(m) === '1002' };
  const ign = walkVm(s, Object.assign({}, base, { ignored: () => true }));
  assert.equal(ign.near, null, name + '：被忽略的首领不得成为追怪目标');
  const kept = walkVm(s, Object.assign({}, base, { ignored: () => false }));
  assert.ok(kept.near && kept.near.GID === 11, name + '：不在忽略集合里的首领照旧要追（只按 BOSS 设置裁决）');
  assert.ok(s.includes('if (zBossIgnoredGid(e.GID, mid)) return;'), name + '：索敌候选必须统一过首领忽略集合，且必须把该实体的 mid 传进判据');
  assert.ok(s.includes('var zLockBossSkip = !!(zLock.gid && zBossIgnoredGid(zLock.gid, zLockMidSkip));'), name + '：锁定守卫必须由忽略集合统一裁决，并传被锁目标的 mid');
}
test('V2.38.15 ③ 被忽略的首领不进索敌候选，放行的首领照旧追（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15WalkIgnore(src, name);
});

// ---------- ④ 解围技能与非攻击瞬移相互独立 ----------
function v15QoaHarness(src) {
  const seg = cut15(src, '      if (critEsc) { flyFailCount = 0; flyBossFailCount = 0; flyFailUntil = 0; }', '      // V2.16.19：坐下周期已提前到本函数开头');
  const st = { escapes: 0, qoa: 0, fails: 0, oks: 0 };
  const ctx = { critEsc: false, flyFailCount: 0, flyBossFailCount: 0, flyFailUntil: 0, flyFromBoss: false,
    canActNow: () => true, now: 100000, lastFly: 0, flyInt: 30000, needFly: true, reason: 'HP10%',
    requestEmergencyEscape: () => { st.escapes++; return 'teleport'; },
    markFlyFail: () => { st.fails++; }, markFlyOk: () => { st.oks++; },
    setStatus: () => {}, btDiagOn: false, btLog: () => {}, zLastFlyReason: '', zLastFlyReasonAt: 0,
    zQoaTry: () => { st.qoa++; }, mobs: [], ent: {},
    Object, Number, String, Math, Date, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext('this.fn = function () {' + String.fromCharCode(10) + seg + String.fromCharCode(10) + '};', ctx);
  return { ctx: ctx, st: st };
}
function v15QoaIndependent(src, name) {
  const s = lf15(src);
  // (1) 瞬移被冷却挡住的那一拍：解围必须照旧独立判定
  let h = v15QoaHarness(s);
  h.ctx.flyFailUntil = h.ctx.now + 5000; h.ctx.lastFly = 0;
  h.ctx.fn();
  assert.equal(h.st.escapes, 0, name + '：冷却未过不得发瞬移');
  assert.equal(h.st.qoa, 1, name + '：解围必须独立（飞被冷却挡住的那一拍照旧可以放解围技能）');
  // (2) 本拍真的发出瞬移：解围必须让位（不得同拍抢公共冷却）
  h = v15QoaHarness(s);
  h.ctx.flyFailUntil = 0; h.ctx.flyInt = 30000; h.ctx.lastFly = 0;
  h.ctx.fn();
  assert.equal(h.st.escapes, 1, name + '：冷却过了必须真的发瞬移');
  assert.equal(h.st.qoa, 0, name + '：真的飞出去那一拍不得再放解围技能');
  // (3) 首领脱离的 1 秒防抖同样让位（与普通间隔口径分开）
  h = v15QoaHarness(s);
  h.ctx.flyFromBoss = true; h.ctx.lastFly = h.ctx.now - 500;
  h.ctx.fn();
  assert.equal(h.st.escapes, 0, name + '：首领脱离 1 秒防抖内不得重发');
  assert.equal(h.st.qoa, 1, name + '：首领脱离被防抖挡住时解围照旧独立判定');
  h = v15QoaHarness(s);
  h.ctx.flyFromBoss = true; h.ctx.lastFly = h.ctx.now - 2000;
  h.ctx.fn();
  assert.equal(h.st.escapes, 1, name + '：首领脱离过了 1 秒防抖必须飞（且不吃普通间隔）');
}
test('V2.38.15 ④ 解围技能与非攻击瞬移相互独立（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15QoaIndependent(src, name);
});

// ---------- ⑤ 战斗地图门放宽 ----------
function v15InFight(src, name) {
  const s = lf15(src);
  const code = cut15(s, '  function refreshDefSnap(mobs, ent) {', '  function escapePos() {');
  const ent = { life: { hp: 50, maxhp: 100, sp: 5, maxsp: 100 } };
  const run = (mobIds, mobs) => {
    const ctx = { getCurrentMapInfo: () => ({ mobIds: mobIds }), isSitting: () => false, Date,
      Object, Number, String, Array, isFinite };
    vm.createContext(ctx);
    vm.runInContext(code + ';this.snap=()=>defSnap;', ctx);
    // 直接调用：defSnap 是模块级变量，这里用函数返回值取回
    vm.runInContext('refreshDefSnap(' + JSON.stringify(mobs) + ',' + JSON.stringify(ent) + ');', ctx);
    return ctx.snap();
  };
  const noSpawn = run([], [{ dist: 3, isBoss: false }]);
  assert.equal(noSpawn.isCombatMap, false, name + '：前置：刷怪表为空');
  assert.equal(noSpawn.inFight, true, name + '：刷怪表为空但视野内有怪 → 必须算「战斗中」（血线等判定才生效）');
  const idle = run([], []);
  assert.equal(idle.inFight, false, name + '：视野内没有怪 → 不得算「战斗中」（主城无怪不飞）');
  const spawn = run([1002], []);
  assert.equal(spawn.inFight, true, name + '：刷怪表非空 → 仍算「战斗中」');
  assert.ok(s.includes('if (inFight && hpPct < (parseInt($id("dsh-z-hpfly").value, 10) || 20))'), name + '：血线门必须改用 inFight');
  assert.ok(s.includes('if (inFight && spPct < (parseInt($id("dsh-z-spfly").value, 10) || 10))'), name + '：蓝线门必须改用 inFight');
  assert.ok(s.includes('if (inFight && hpDrop >= 25 && mobs.length > 0)'), name + '：失血门必须改用 inFight');
  assert.ok(s.includes('if (inFight && potNoPotion && mobs.length > 0 && hpPct < potThrNow && !needFly)'), name + '：低血无药被围门必须改用 inFight');
  assert.ok(s.includes('var grpFly = grpN > 0 && grpCnt >= grpN && inFight'), name + '：群殴瞬移门必须改用 inFight');
  assert.ok(s.includes('&& !escapePending() && now >= flyFailUntil) { needFly = true; reason = "卡死4s"'), name + '：卡死瞬移必须仍然只认战斗地图（绑定战斗态）');
}
test('V2.38.15 ⑤ 战斗地图门放宽：视野内有怪即生效，无怪不飞（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15InFight(src, name);
});

// ---------- ⑥ 首领脱离不吃普通连败停 10 秒 ----------
function v15BossFlyFail(src, name) {
  const s = lf15(src);
  const code = cut15(s, '  function markFlyFail(fromBoss) {', '  function markFlyOk() {');
  let T0 = 1000000;
  const ctx = { flyFailCount: 0, flyBossFailCount: 0, flyFailUntil: 0, Date: { now: () => T0 } };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.fail=markFlyFail;', ctx);
  for (let i = 0; i < 3; i++) ctx.fail(true);
  assert.equal(ctx.flyFailUntil, 0, name + '：前 3 次首领脱离失败不得停 10 秒（普通口径不适用于首领）');
  for (let i = 3; i < 14; i++) ctx.fail(true);
  assert.equal(ctx.flyFailUntil, 0, name + '：第 14 次首领脱离失败仍不得停 10 秒');
  ctx.fail(true);
  assert.equal(ctx.flyFailUntil, T0 + 10000, name + '：第 15 次首领脱离失败才停 10 秒');
  const ctx2 = { flyFailCount: 0, flyBossFailCount: 0, flyFailUntil: 0, Date: { now: () => T0 } };
  vm.createContext(ctx2);
  vm.runInContext(code + ';this.fail=markFlyFail;', ctx2);
  for (let i = 0; i < 3; i++) ctx2.fail(false);
  assert.equal(ctx2.flyFailUntil, T0 + 10000, name + '：非首领原因的连续 3 次失败口径必须保持 10 秒不变');
  const canCode = cut15(s, '  var DSH_CANT_ACT_ST = [875, 876, 877, 878];', '  // V1.7.7 状态速查弹层按钮');
  const cctx = { buffStateOn: (id) => id === 877, Array };
  vm.createContext(cctx);
  vm.runInContext(canCode + ';this.can=canActNow;', cctx);
  assert.equal(cctx.can(), false, name + '：晕眩状态必须判成不能行动');
  cctx.buffStateOn = () => false;
  assert.equal(cctx.can(), true, name + '：无状态必须判成可以行动');
  cctx.buffStateOn = () => { throw new Error('status-unavailable'); };
  assert.equal(cctx.can(), true, name + '：状态读不到一律按可以行动（绝不永久跳过）');
  const h = v15QoaHarness(s);
  h.ctx.canActNow = () => false; h.ctx.flyFromBoss = true; h.ctx.lastFly = h.ctx.now - 5000;
  h.ctx.fn();
  assert.equal(h.st.escapes, 0, name + '：不能行动时必须跳过本拍尝试（不发瞬移）');
  assert.equal(h.st.fails, 0, name + '：不能行动而跳过的这一拍不得计入失败');
}
test('V2.38.15 ⑥ 首领脱离只用 1 秒防抖、15 次才停 10 秒、不能行动时跳过且不计失败（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15BossFlyFail(src, name);
});

// ---------- ⑦ 首领诊断（只读） ----------
function v15BossDiag(src, name) {
  const s = lf15(src);
  const code = cut15(s, '  function zBossDiagText() {', '  // 「首领诊断」按钮：');
  const ctx = { VER: '2.38.15',
    getMobDb: () => ({ '1002': { MvpDropsNum: 1 }, '1003': { MvpDropsNum: 0 } }),
    zLock: { gid: 55, name: '波利', reactive: false },
    $id: (id) => (id === 'dsh-z-bossact' ? { value: '等待残血补尾刀' } : (id === 'dsh-z-bossdist' ? { value: '14' } : null)),
    scanMobs: [{ GID: 55, mid: 1002, name: '波利', dist: 3, isBoss: true }, { GID: 56, mid: 1003, name: '绿棉虫', dist: 5, isBoss: false }],
    lastMobs: [], gidInt: Number, distInt: (d) => Math.round(Number(d)),
    zBossIgnoreAll: true, zBossAllowGid: 0, zBossWantGid: 0, zBossLastBlock: '尾刀未到线', zBossDistUsed: 14,
    zBossIgnoredGid: (g) => Number(g) === 55, zBossDistNow: () => 14,
    Object, Number, String, Array, Math, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.txt=zBossDiagText;', ctx);
  const txt = String(ctx.txt());
  assert.match(txt, /怪物库条目=2/, name + '：怪物库条目必须给出真实条数');
  assert.match(txt, /编号=1002/, name + '：必须列出附近每只怪的编号');
  assert.match(txt, /首领值=1/, name + '：必须列出首领值');
  assert.match(txt, /首领=是/, name + '：必须标出哪只是首领');
  assert.match(txt, /当前目标=波利/, name + '：必须给出当前目标');
  assert.match(txt, /首领动作=等待残血补尾刀 判定距离=14格/, name + '：必须给出首领动作与判定距离');
  assert.match(txt, /挡住这一只的是：尾刀未到线/, name + '：必须写明被哪一条挡住');
  assert.match(txt, /忽略/, name + '：必须标出被忽略的首领');
  assert.doesNotMatch(txt, V15_UI_BAN, name + '：诊断文本不得出现实现词');
  assert.doesNotMatch(txt, V15_EMOJI, name + '：诊断文本不得出现 emoji');
  assert.doesNotMatch(code, /sendPacket|czp\(|CLIENT\.PS/, name + '：首领诊断必须只读（不得发包）');
  assert.ok(!/lockList|dsh-z-allmobs/.test(code), name + '：首领诊断不得读取锁定名单（只按 BOSS 设置裁决）');
  assert.ok(s.includes('t.id !== "dsh-z-bossdiag"'), name + '：必须接上「首领诊断」按钮事件（委托）');
}
test('V2.38.15 ⑦ 首领诊断只读输出：怪物库条目 / 编号 / 首领值 / 距离 / 挡住它的那一条（两文件 VM）', () => {
  for (const [name, src] of splitSources) v15BossDiag(src, name);
});

// ---------- ⑧ 陈旧包流快照 + 没有实时路 → 判定没认出武器 ----------
function v23815CheckStaleNoRoute(src, name) {
  const c = v23814ArrowVm(src, { uiComp: () => null });
  const at = v23814PktFresh(c, { 2: { itid: 1701, name: '十字长弓' } });
  v23814PktAck(c, 6, at + 1);
  assert.equal(c.A.arrowGearPktStale(), true, name + '：前置：dirty 晚于整表的快照必须算陈旧');
  const wq = c.A.readEquippedWeaponType();
  assert.equal(wq.wt, -1, name + '：陈旧快照且没有任何实时路时必须判成没认出武器（wt=-1），实际=' + JSON.stringify(wq));
  assert.equal(wq.itid, null, name + '：陈旧快照里的旧弓绝不能被当成手持武器，实际=' + wq.itid);
  c.A.tickArrow();
  assert.equal(c.packets.length, 0, name + '：没认出武器必须零动作（不换箭、不发任何请求）');
  assert.ok(String(c.logEl.textContent).indexOf('没认出当前手持的武器') >= 0, name + '：必须给玩家能看懂的提示，实际=' + c.logEl.textContent);
}
test('V2.38.15 ⑧ 陈旧包流快照 + 完全没有实时路 → 必须判成没认出武器（两文件 VM）', () => {
  for (const [name, src] of splitSources) v23815CheckStaleNoRoute(src, name);
});

// ---------- V2.38.15 变异矩阵 ----------
const V23815_MUTS = [
  { tag: 'M-23815-A1', desc: '①名单联动的判据写反（名单非空也当成空）',
    from: '      var want = Object.keys(lockList).length === 0;',
    to: '      var want = true; // 变异：判据写反',
    verify: v15AutoLink, expect: /名单非空必须自动取消勾选/ },
  { tag: 'M-23815-A2', desc: '①代打把自动勾上的值当成原值（提交时才读勾选值）',
    from: '      if (allMobsWas0 !== null && apiAllMobsSaved === null) apiAllMobsSaved = allMobsWas0;',
    to: '      if (o.allMobs === true && allMobsEl0 && apiAllMobsSaved === null) apiAllMobsSaved = !!allMobsEl0.checked; // 变异：提交时才读（读到清名单自动勾上的值）',
    verify: v15AssistLink, expect: /原值必须在清空名单之前记下/ },
  { tag: 'M-23815-B1', desc: '③瞬移模式遇锁定首领又转回优先攻击',
    from: '      if (act === "瞬移") { out.fly = true; out.reason = "BOSS(" + (rec.name || rec.mid) + ")"; }',
    to: '      if (act === "瞬移" && rec.mid != null && lockList[String(rec.mid)]) act = "优先攻击";' + String.fromCharCode(10) + '      if (act === "瞬移") { out.fly = true; out.reason = "BOSS(" + (rec.name || rec.mid) + ")"; }',
    verify: v15BossPriority, expect: /瞬移模式必须本拍就飞/ },
  { tag: 'M-23815-B2', desc: '③忽略集合全关（不处理也当成可打）',
    from: '      zBossIgnoreAll = (act === "不处理" || act === "等待残血补尾刀");',
    to: '      zBossIgnoreAll = false; // 变异：忽略集合全关',
    verify: v15BossPriority, expect: /不处理必须把首领放进忽略集合/ },
  { tag: 'M-23815-B3', desc: '③血量未知被当成已到尾刀线',
    from: '        if (out.hp >= 0 && out.hp <= line) out.want = gidInt(rec.GID);',
    to: '        if (out.hp <= line) out.want = gidInt(rec.GID); // 变异：血量未知也算到线',
    verify: v15BossPriority, expect: /血量未知也必须忽略/ },
  { tag: 'M-23815-C1', desc: '②「最近 3 秒打过我的怪」这条还击候选不排除首领',
    from: '          if (isBossMid(hitCandMid)) hitCandEnt = null;',
    to: '          if (false) hitCandEnt = null; // 变异：首领也能被还击',
    verify: v15Retaliate, expect: /首领不得成为还击目标/ },
  { tag: 'M-23815-C2', desc: '②射程内最近怪这条还击候选不排除首领',
    from: '              if (!isBossMid(mid) && d <= atkRange && d < hitBest) { hitBest = d; hitTarget = e; }',
    to: '              if (d <= atkRange && d < hitBest) { hitBest = d; hitTarget = e; } // 变异：首领也能被还击',
    verify: v15Retaliate, expect: /射程内最近怪这条还击候选也必须排除首领/ },
  { tag: 'M-23815-D1', desc: '③索敌候选不剔除忽略集合里的首领',
    from: '            // V2.38.15：首领忽略集合统一剔除（不处理 / 尾刀未到线 / 血量未知 → 不追、不打、不因它飞）；普通怪一律不受影响' + String.fromCharCode(10) + '            if (zBossIgnoredGid(e.GID, mid)) return;',
    to: '            // 变异：索敌候选不剔除忽略集合里的首领',
    verify: v15WalkIgnore, expect: /被忽略的首领不得成为追怪目标/ },
  { tag: 'M-23815-E1', desc: '④解围退回「必须本拍不打算飞」',
    from: '      if (!flyIssued) {' + String.fromCharCode(10) + '        zQoaTry(mobs, ent, now);',
    to: '      if (!needFly) {' + String.fromCharCode(10) + '        zQoaTry(mobs, ent, now);',
    verify: v15QoaIndependent, expect: /解围必须独立/ },
  { tag: 'M-23815-E2', desc: '⑤战斗地图门又收回只认刷怪表',
    from: '        inFight: isCombatMapV || mobCount > 0,',
    to: '        inFight: isCombatMapV, // 变异：又收回只认刷怪表',
    verify: v15InFight, expect: /刷怪表为空但视野内有怪/ },
  { tag: 'M-23815-F1', desc: '⑥首领脱离沿用普通「3 次停 10 秒」',
    from: '      if (fromBoss) { flyBossFailCount++; if (flyBossFailCount >= 15) flyFailUntil = Date.now() + 10000; return; }',
    to: '      if (fromBoss) { flyBossFailCount++; if (flyBossFailCount >= 3) flyFailUntil = Date.now() + 10000; return; }',
    verify: v15BossFlyFail, expect: /前 3 次首领脱离失败不得停 10 秒/ },
  { tag: 'M-23815-F2', desc: '⑥不能行动时不跳过（照样计数/发瞬移）',
    from: '      if (flyFromBoss) { try { flyBossStuck = !canActNow(); } catch (eSA) { flyBossStuck = false; } }',
    to: '      if (false) { try { flyBossStuck = !canActNow(); } catch (eSA) { flyBossStuck = false; } } // 变异：不跳过',
    verify: v15BossFlyFail, expect: /不能行动时必须跳过本拍尝试/ },
  { tag: 'M-23815-H1', desc: '⑦首领诊断写死怪物库条数',
    from: '      L.push("怪物库条目=" + dbN);',
    to: '      L.push("怪物库条目=0"); // 变异：写死',
    verify: v15BossDiag, expect: /怪物库条目必须给出真实条数/ },
];
test('V2.38.15 变异矩阵：13 个行为变异在 stable/exp 上必须各自被「指定断言」杀死', () => {
  for (const m of V23815_MUTS) {
    for (const [name, src] of splitSources) {
      const mutated = M23813(src, m.from, m.to);
      const v = v15Catch(() => m.verify(mutated, name + '·' + m.tag));
      const killed = v.ok === false;
      V23815_MATRIX.push({ tag: m.tag + '@' + name, desc: m.desc, expected: '红',
        actual: killed ? '红' : '绿', caught: killed ? v15Msg(v.e) : '未被抓（变异存活）' });
      assert.ok(killed, m.tag + '@' + name + '：变异必须让对应用例变红（' + m.desc + '）');
      assert.match(v15Msg(v.e), m.expect, m.tag + '@' + name + '：必须被「指定断言」抓到，实际=' + v15Msg(v.e));
    }
  }
  assert.equal(V23815_MATRIX.length, V23815_MUTS.length * splitSources.length, '每个变异 × 两文件都要独立真跑一次');
  assert.ok(V23815_MATRIX.every((r) => r.actual === '红'), '不得存在变异存活行');
  console.log('[V2.38.15 变异矩阵] ' + V23815_MATRIX.length + ' 条全部为红：' + V23815_MATRIX.map((r) => r.tag).join(', '));
  if (process.env.V23815_JSON) fs.writeFileSync(process.env.V23815_JSON, JSON.stringify(V23815_MATRIX, null, 2), 'utf8');
});

// ================= V2.38.15 界面：悬浮层按屏幕比例跟随 + 队伍血块整块显血 =================
const UI815_MATRIX = [];
const u815Catch = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const u815Msg = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 220);
const u815Lf = (x) => String(x).split(String.fromCharCode(13)).join('');
function u815Cut(src, a, b) {
  const s = u815Lf(src);
  assert.equal(s.split(a).length - 1, 1, 'V2.38.15 界面切段锚点必须唯一: ' + a.slice(0, 60));
  const i = s.indexOf(a), j = s.indexOf(b, i);
  assert.ok(i >= 0 && j > i, 'V2.38.15 界面切段失败: ' + a.slice(0, 60));
  return s.slice(i, j);
}
// ---- 悬浮层比例跟随 harness：把产品里的核心段原样跑在 vm 里 ----
function u815FloatBoot(src, vw, vh) {
  const code = u815Cut(src, '  // ================= V2.38.15 悬浮层比例跟随 =================', '  var roScaleTimer = null;');
  const st = { vw: vw, vh: vh, timers: [], cleared: 0 };
  const el = { parentNode: {}, style: { display: 'flex' }, offsetWidth: 200, offsetHeight: 80, __dsDragging: false };
  const store = { rec: null };
  const ctx = {
    Math, Number, String, Object, JSON, isFinite, parseFloat, parseInt,
    setTimeout: (fn, ms) => { st.timers.push({ fn: fn, ms: ms }); return st.timers.length; },
    clearTimeout: () => { st.cleared++; }, setInterval: () => 0, clearInterval: () => {},
    window: { addEventListener: () => {} },
    roVw: () => st.vw, roVh: () => st.vh,
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.scaled=roFloatScaled;this.fit=roFloatFit;this.reg=roFloatReg;this.follow=roFloatFollow;this.followLayer=roFloatFollowLayer;this.onResize=roFloatOnResize;this.vpSame=roFloatVpSame;', ctx);
  ctx.reg({
    key: 'ui815', el: () => el,
    drag: () => !!el.__dsDragging,
    get: () => store.rec,
    set: (e2, x, y, vw2, vh2) => { e2.style.left = x + 'px'; e2.style.top = y + 'px'; store.rec = { x: x, y: y, vw: vw2, vh: vh2 }; },
  });
  return { ctx: ctx, st: st, el: el, store: store };
}
function u815FloatProportional(src, fl) {
  const h = u815FloatBoot(src, 1600, 900);
  h.store.rec = { x: 800, y: 450, vw: 1600, vh: 900 };
  h.ctx.follow();
  assert.equal(h.el.style.left, '800px', fl + '：视口没变时悬浮层位置不得动');
  assert.equal(h.el.style.top, '450px', fl + '：视口没变时悬浮层位置不得动');
  assert.equal(h.st.timers.length, 0, fl + '：不得引入持续轮询式重算');
  h.st.vw = 800; h.st.vh = 450; h.ctx.follow();
  assert.equal(h.el.style.left, '400px', fl + '：1600x900 下记在 (800,450) 的悬浮层，视口减半后必须按屏幕比例落到 400px');
  assert.equal(h.el.style.top, '225px', fl + '：1600x900 下记在 (800,450) 的悬浮层，视口减半后必须按屏幕比例落到 225px');
  h.el.__dsDragging = true;
  h.st.vw = 400; h.st.vh = 300; h.ctx.follow();
  assert.equal(h.el.style.left, '400px', fl + '：用户正在拖动时不得按比例跟随（松手前不动）');
  h.el.__dsDragging = false;
  h.st.vw = 2000; h.st.vh = 1000; h.ctx.follow();
  assert.equal(h.el.style.left, '1000px', fl + '：再放大到 2000x1000 必须按屏幕比例落到 1000px');
  assert.equal(h.el.style.top, '500px', fl + '：再放大到 2000x1000 必须按屏幕比例落到 500px');
  const before = h.st.timers.length;
  h.ctx.onResize(); h.ctx.onResize(); h.ctx.onResize();
  assert.equal(h.st.timers.length, before + 3, fl + '：窗口尺寸变化必须走 resize 驱动');
  assert.equal(h.st.timers[h.st.timers.length - 1].ms, 150, fl + '：窗口尺寸变化必须走约 150ms 防抖');
  return h;
}
function u815FloatClamp(src, fl) {
  const h = u815FloatBoot(src, 400, 300);
  h.store.rec = { x: 1500, y: 800, vw: 1600, vh: 900 };
  h.ctx.follow();
  const x = parseFloat(h.el.style.left), y = parseFloat(h.el.style.top);
  assert.ok(isFinite(x) && isFinite(y), fl + '：夹回可视区后必须是有效坐标');
  assert.ok(x >= 0 && y >= 0, fl + '：夹回可视区后左/上不得小于 0（实际 ' + x + ',' + y + '）');
  assert.ok(x + 200 <= 400 && y + 80 <= 300, fl + '：夹回可视区后右/下不得超出视口（实际 ' + x + ',' + y + '）');
  h.el.offsetWidth = 500; h.el.offsetHeight = 400;
  h.store.rec = { x: 1500, y: 800, vw: 1600, vh: 900 };
  h.ctx.follow();
  assert.equal(h.el.style.left, '0px', fl + '：夹回可视区：元素比视口大时至少保证左上角可见');
  assert.equal(h.el.style.top, '0px', fl + '：夹回可视区：元素比视口大时至少保证左上角可见');
  h.el.offsetWidth = 200; h.el.offsetHeight = 80;
  const sc = h.ctx.scaled({ x: 1500, y: 800 }, 400, 300);
  assert.equal(sc && sc.x, 1500, fl + '：旧数据（只有 px、没有比例基准）必须按不缩放读取 x');
  assert.equal(sc && sc.y, 800, fl + '：旧数据（只有 px、没有比例基准）必须按不缩放读取 y');
  h.store.rec = { x: 1500, y: 800 };
  const r = u815Catch(() => h.ctx.follow());
  assert.ok(r.ok, fl + '：旧数据（只有 px）读取不得报错：' + u815Msg(r.e));
  const x2 = parseFloat(h.el.style.left), y2 = parseFloat(h.el.style.top);
  assert.ok(x2 >= 0 && y2 >= 0 && x2 + 200 <= 400 && y2 + 80 <= 300, fl + '：旧数据首次尺寸变化后仍必须落在可视区内（实际 ' + x2 + ',' + y2 + '）');
  return h;
}
// ---- 队伍血块 harness ----
function u815Css(src) { return u815Cut(src, '  function dshFloatCss() {', '  // 指针拖拽（按住任一可见元素拖动整个悬浮层'); }
function u815PartyBoot(src) {
  const hpCode = u815Cut(src, '  // V2.38.15：整块显血的颜色三段', '  var dshPartyFloat = null;');
  const cellCode = u815Cut(src, '  function partyCellHtml(o, isSelf) {', '  // ================= V2.28.0 本次登录伤害统计');
  const ctx = {
    Math, Number, String, Object, JSON, isFinite, parseInt, parseFloat,
    zLock: null, fmtK: (n) => String(n), roEscTxt: (s) => String(s == null ? '' : s),
    normMapKey: (m) => String(m || '').toLowerCase(), getMapName: () => 'prontera',
    CLIENT: {}, requireDB: () => null,
    partyJobColor: (job) => (Number(job) === 7 ? '#C79C6E' : '#ABD473'),
  };
  vm.createContext(ctx);
  vm.runInContext(hpCode + cellCode + ';this.hpColor=partyHpColor;this.cell=partyCellHtml;'
    + 'this.C={BASE:PARTY_HP_BASE,HIGH:PARTY_HP_HIGH,MID:PARTY_HP_MID,LOW:PARTY_HP_LOW,ZERO:PARTY_HP_ZERO};', ctx);
  return ctx;
}
function u815Party(src, fl) {
  const ctx = u815PartyBoot(src);
  assert.equal(ctx.hpColor(100), ctx.C.HIGH, fl + '：队伍血块 100% 必须落绿色');
  assert.equal(ctx.hpColor(60), ctx.C.HIGH, fl + '：队伍血块 60% 必须落绿色');
  assert.equal(ctx.hpColor(59), ctx.C.MID, fl + '：队伍血块 59% 必须落黄色');
  assert.equal(ctx.hpColor(30), ctx.C.MID, fl + '：队伍血块 30% 必须落黄色');
  assert.equal(ctx.hpColor(29), ctx.C.LOW, fl + '：队伍血块 29% 必须落红色');
  assert.equal(ctx.hpColor(0), ctx.C.ZERO, fl + '：队伍血块 0% 必须落暗红');
  assert.equal(new Set([ctx.C.HIGH, ctx.C.MID, ctx.C.LOW, ctx.C.ZERO]).size, 4, fl + '：绿/黄/红/暗红必须四色互不相同');
  const mk = (hp, maxhp, extra) => Object.assign({ AID: 1, name: '甲', job: 7, hp: hp, maxhp: maxhp, online: true, map: 'prontera' }, extra || {});
  const h100 = ctx.cell(mk(100, 100), false);
  const h50 = ctx.cell(mk(50, 100), false);
  const h10 = ctx.cell(mk(10, 100), false);
  assert.doesNotMatch(h100, /dsh-hp-edge/, fl + '：队伍血块不得再有那条白色血条');
  assert.ok(h100.indexOf('dsh-hp-edge') < 0 && h50.indexOf('dsh-hp-edge') < 0, fl + '：队伍血块不得再有那条白色血条');
  assert.ok(h100.indexOf('<div class="dsh-pfill" style="width:100%;background:' + ctx.C.HIGH + '"></div>') >= 0, fl + '：队伍血块必须整块按血量百分比填充（宽度=该百分比）');
  assert.ok(h50.indexOf('<div class="dsh-pfill" style="width:50%;background:' + ctx.C.MID + '"></div>') >= 0, fl + '：队伍血块必须整块按血量百分比填充（宽度=该百分比）');
  assert.ok(h10.indexOf('<div class="dsh-pfill" style="width:10%;background:' + ctx.C.LOW + '"></div>') >= 0, fl + '：队伍血块必须整块按血量百分比填充（宽度=该百分比）');
  assert.ok(h50.indexOf('data-pct="50"') >= 0, fl + '：队伍血块必须把百分比落在块上');
  assert.ok(h50.indexOf('--dsh-pjob:#C79C6E') >= 0, fl + '：队伍血块外圈必须用现有职业色');
  assert.ok(h50.indexOf('background:' + ctx.C.BASE) >= 0, fl + '：队伍血块空的那段必须有暗底衬，白字才看得清');
  ctx.zLock = { gid: 1 };
  assert.ok(ctx.cell(mk(50, 100), false).indexOf('class="dsh-pcell selected"') >= 0, fl + '：点击锁定队友的选中态必须保留');
  ctx.zLock = null;
  const dead = ctx.cell(mk(0, 100), false);
  assert.ok(dead.indexOf('dsh-pfill') < 0 && dead.indexOf('background:#5a5a5a') >= 0, fl + '：死亡状态保持原样，不得被画成活着');
  const off = ctx.cell(mk(100, 100, { online: false }), false);
  assert.ok(off.indexOf('dsh-pfill') < 0 && off.indexOf('background:#6b7280') >= 0, fl + '：离线状态保持原样，不得被画成活着');
  const diff = ctx.cell(mk(100, 100, { map: 'geffen' }), false);
  assert.ok(diff.indexOf('dsh-pfill') < 0 && diff.indexOf('background:#2b6cb0') >= 0, fl + '：异图状态保持原样，不得被画成活着');
  const css = u815Css(src);
  assert.ok(css.indexOf('dsh-hp-edge') < 0, fl + '：队伍血块不得再有那条白色血条（样式里也要清掉）');
  const ring = /\.dsh-pcell\{[^}]*box-shadow:0 4px 10px rgba\(0,0,0,\.85\),0 0 0 (\d+(?:\.\d+)?)px var\(--dsh-pjob/.exec(css);
  assert.ok(ring, fl + '：队伍血块必须有加粗外圈职业色环与突出阴影');
  assert.ok(Number(ring[1]) >= 3, fl + '：队伍血块外圈职业色必须明显更粗（≥3px，实际 ' + ring[1] + 'px）');
  assert.ok(/\.dsh-pcell \.dsh-pfill\{position:absolute;left:0;top:0;bottom:0;/.test(css), fl + '：整块显血必须是覆盖整块的绝对定位填充层');
  const gap = /#dsh-party-float\{[^}]*gap:(\d+(?:\.\d+)?)px/.exec(css);
  assert.ok(gap && Number(gap[1]) >= 6, fl + '：队伍血块方块之间的间距必须容得下加粗外圈（≥6px，实际 ' + (gap && gap[1]) + 'px）');
  assert.ok(/\.dsh-pcell:hover\{transform:scale\(1\.03\)\}/.test(css), fl + '：队伍血块悬停放大必须保留');
  assert.ok(/\.dsh-pcell\.selected\{transform:scale\(1\.08\)/.test(css), fl + '：队伍血块选中放大必须保留');
  assert.ok(/\.dsh-pcell\.selected\{[^}]*box-shadow:[^}]*0 0 14px rgba\(255,255,255,\.8\)/.test(css), fl + '：队伍血块选中光晕必须保留');
  return ctx;
}
test('V2.38.15 界面① 悬浮层按屏幕比例跟随 + 夹回可视区 + 旧数据兼容（两文件）', () => {
  for (const [fl, src] of splitSources) {
    u815FloatProportional(src, fl);
    u815FloatClamp(src, fl);
    // 范围清单：所有可拖动的悬浮层与浮窗都必须登记进同一张跟随表
    const reg = [
      '  function roFloatScaled(rec, vw, vh) {',
      'key: "win:" + id,', 'dshFloatRegSaved(el, "tgtBarPos");', 'dshFloatRegSaved(el, "partyPos");',
      'dshFloatRegLs(ball, "dsh_ball_pos", ballAnchorClear);', 'dshFloatRegLs(zHudEl, "dsh_zhud_pos", function (e) { e.style.transform = "none"; });',
      'dshFloatRegLs(zTipEl, "dsh_ztip_pos", function (e) { e.style.bottom = "auto"; });', 'key: "mvp",',
      'try { window.addEventListener("orientationchange", roFloatOnResize); } catch (e) {}',
    ];
    for (const a of reg) assert.ok(u815Lf(src).split(a).length - 1 === 1, fl + '：悬浮层与浮窗范围必须覆盖「' + a.slice(0, 46) + '」');
  }
});
test('V2.38.15 界面② 队伍血块整块按百分比显血 + 加粗职业色环 + 突出阴影（两文件）', () => {
  for (const [fl, src] of splitSources) u815Party(src, fl);
});
const UI815_MUTS = [
  { tag: 'M-UI815-A', desc: '位置回退成纯 px 存储（resize 不重算）',
    from: '    if (isFinite(sw) && sw > 0 && isFinite(sh) && sh > 0) { x = x * vw / sw; y = y * vh / sh; }',
    to: '    // 变异：不按屏幕比例换算',
    verify: u815FloatProportional, expect: /按屏幕比例/ },
  { tag: 'M-UI815-B', desc: '去掉夹回可视区',
    from: '    return { x: Math.max(0, Math.min(mx, x)), y: Math.max(0, Math.min(my, y)) };',
    to: '    return { x: x, y: y }; // 变异：不夹回可视区',
    verify: u815FloatClamp, expect: /夹回可视区/ },
  { tag: 'M-UI815-C', desc: '把白色血条加回去 / 去掉整块填充',
    from: '      fill = \'<div class="dsh-pfill" style="width:\' + pct + \'%;background:\' + partyHpColor(pct) + \'"></div>\';',
    to: '      fill = \'<div class="dsh-hp-edge" style="width:\' + pct + \'%"></div>\';',
    verify: u815Party, expect: /队伍血块/ },
  { tag: 'M-UI815-D', desc: '去掉加粗外圈（3px → 1px）',
    from: 'box-shadow:0 4px 10px rgba(0,0,0,.85),0 0 0 3px var(--dsh-pjob,#7d8894)',
    to: 'box-shadow:0 4px 10px rgba(0,0,0,.85),0 0 0 1px var(--dsh-pjob,#7d8894)',
    verify: u815Party, expect: /外圈职业色/ },
];
test('V2.38.15 界面 变异矩阵：4 个界面变异在 stable/exp 上必须各自被「指定断言」杀死', () => {
  for (const m of UI815_MUTS) {
    for (const [fl, src] of splitSources) {
      const mutated = M23813(src, m.from, m.to);
      const v = u815Catch(() => m.verify(mutated, fl + '·' + m.tag));
      const killed = v.ok === false;
      UI815_MATRIX.push({ tag: m.tag + '@' + fl, desc: m.desc, expected: '红', actual: killed ? '红' : '绿', caught: killed ? u815Msg(v.e) : '未被抓（变异存活）' });
      assert.ok(killed, m.tag + '@' + fl + '：变异必须让对应用例变红（' + m.desc + '）');
      assert.match(u815Msg(v.e), m.expect, m.tag + '@' + fl + '：必须被「指定断言」抓到，实际=' + u815Msg(v.e));
    }
  }
  assert.equal(UI815_MATRIX.length, UI815_MUTS.length * splitSources.length, '每个变异 × 两文件都要独立真跑一次');
  assert.ok(UI815_MATRIX.every((r) => r.actual === '红'), '不得存在变异存活行');
  console.log('[V2.38.15 界面变异矩阵] ' + UI815_MATRIX.length + ' 条全部为红：' + UI815_MATRIX.map((r) => r.tag).join(', '));
  if (process.env.UI815_JSON) fs.writeFileSync(process.env.UI815_JSON, JSON.stringify(UI815_MATRIX, null, 2), 'utf8');
});

// ================= V2.38.15 审计修复（缺陷 1/2/4）：首领忽略集合只对首领生效 / 代打释放回写原值 / 锁定注入口径 =================
const A815_MATRIX = [];
const a815Catch = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const a815Msg = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 220);
const A815_BOSS = { GID: 72, mid: 2001, isBoss: true, dist: 2, name: 'B' };
const A815_NORM = { GID: 71, mid: 9999, isBoss: false, dist: 3, name: 'N' };

// 真跑产品里的 isBossMid + zBossIgnoredGid + zBossDecide（判据不 stub），视野怪物由调用方给
function a815Judge(src, act) {
  const s = lf15(src);
  const code = cut15(s, '  var zBossIgnoreAll = false;', '  // A6：早退点不冻结整拍');
  const els = { 'dsh-z-bossact': { value: act || '不处理' }, 'dsh-z-bosshp': { value: '30' }, 'dsh-z-bossdist': { value: '14' } };
  const ctx = {
    scanMobs: [], lastMobs: [], els: els, $id: (id) => els[id] || null,
    gidInt: (v) => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? n : 0; },
    zEntHpPct: () => -1,
    getMobDb: () => ({ '2001': { MvpDropsNum: 1 }, '2002': { MvpDropsNum: '3' }, '9999': { MvpDropsNum: 0 } }),
    Object, String, Number, parseInt, isNaN, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.run=zBossDecide;'
    + 'this.ign=function(g,m){return zBossIgnoredGid(g,m);};'
    + 'this.st=function(){return {all:zBossIgnoreAll,allow:zBossAllowGid,want:zBossWantGid,block:zBossLastBlock};};', ctx);
  return ctx;
}
function a815Decide(src, act, mobs, hp) {
  const j = a815Judge(src, act);
  j.scanMobs = mobs;
  j.zEntHpPct = () => hp;
  j.run(mobs);
  return j;
}
// 真跑产品 zWalk 候选池（判据用真实现）
function a815Walk(src, mobs, j) {
  return walkVm(src, { mobs: mobs, lockList: {}, allMobs: true, ent: { position: [0, 0] }, ignored: (g, m) => j.ign(g, m) });
}
// 真跑产品「解围技能目标选择」那一段循环
function a815QoaTarget(src, mobs, j) {
  const s = lf15(src);
  const seg = cut15(s, '      var tg = null, td = 1e9;', '      if (!tg) return false;');
  const ctx = { mobs: mobs, atkG: 9, zBossIgnoredGid: (g, m) => j.ign(g, m), Object, Number, String, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext('this.fn = function () {' + LF + seg + LF + '  return tg ? tg.GID : null;' + LF + '};', ctx);
  return ctx.fn();
}
// 真跑产品 zAttack「锁定目标解析」分支
function a815Lock(src, lockGid, lockEnt, j) {
  const s = lf15(src);
  const seg = cut15(s, '      // V2.38.15：锁定的首位首领落在忽略集合里', '      if (tempTargetHeld && !target) {');
  const mobs = lockEnt ? [lockEnt] : [];
  const ctx = {
    zLock: { gid: lockGid, name: '?', dist: null, done: false, reactive: false },
    zLockCounts: {}, zCastIdx: 0, zAtkLast: { gid: lockGid, outOfRange: false },
    zMon: { action: '' }, zAtkWhy: '', tlog: () => {},
    npMode: false, npThD: 10, zFollow: true, zNext: true, range: 12, atkRange: 2,
    ent: { position: [0, 0] }, tempTargetHeld: false,
    zEntOf: (gid) => (lockEnt && !lockEnt.isDeath && Number(gid) === Number(lockEnt.GID) ? lockEnt : null),
    zRangeDist: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])),
    gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
    EM: { forEach: (cb) => mobs.forEach(cb) },
    zBossIgnoredGid: (g, m) => j.ign(g, m),
    Object, Math, String, Number, parseInt, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext('this.fn = function () {' + LF + '  var target = null, lockAliveOutside = false;' + LF + seg + LF + '  return { target: target, lock: zLock.gid, act: zMon.action };' + LF + '};', ctx);
  return ctx.fn();
}

function a815NoBoss(src, name) {
  const j = a815Decide(src, '不处理', [A815_NORM], -1);
  assert.equal(j.st().all, true, name + '：前置——不处理必须把首领放进忽略集合');
  assert.equal(j.ign(71, 9999), false, name + '：视野内没有首领时，普通怪绝不能被忽略（否则助手不索敌/不还击/不解围）');
  assert.equal(j.ign(1234, 4242), false, name + '：怪物库里没有的普通怪同样不能被忽略');
  assert.equal(j.ign(0, null), false, name + '：取不到编号/mid 时也不能误伤（不得当成首领）');
  const w = a815Walk(src, [vmMob(71, '9999', [3, 0])], j);
  assert.ok(w.near && w.near.GID === 71, name + '：普通怪必须照常被追击，实际=' + JSON.stringify(w.near && w.near.GID));
  assert.equal(a815QoaTarget(src, [A815_NORM], j), 71, name + '：解围技能必须照常选中贴身普通怪');
  const lk = a815Lock(src, 71, vmMob(71, '9999', [1, 0]), j);
  assert.ok(lk.target && lk.target.GID === 71, name + '：用户锁定的普通怪必须照常解析成目标并攻击，实际=' + JSON.stringify(lk.target && lk.target.GID));
  assert.equal(lk.lock, 71, name + '：普通怪的锁不得被忽略集合清掉');
}
function a815BossOnly(src, name) {
  const j2 = a815Decide(src, '不处理', [A815_BOSS, A815_NORM], -1);
  assert.equal(j2.ign(72, 2001), true, name + '：不处理必须忽略首领');
  assert.equal(j2.ign(72, '2001'), true, name + '：字符串 mid 同样认首领');
  assert.equal(j2.ign(2002, 2002), true, name + '：其它首领（首领值 3）同样必须忽略');
  assert.equal(j2.ign(71, 9999), false, name + '：同一视野里的普通怪绝不能被忽略');
  const w2 = a815Walk(src, [vmMob(72, '2001', [2, 0]), vmMob(71, '9999', [3, 0])], j2);
  assert.ok(w2.near && w2.near.GID === 71, name + '：首领被忽略时同一视野的普通怪必须照常被追击');
  const wb = a815Walk(src, [vmMob(72, '2001', [2, 0])], j2);
  assert.equal(wb.near, null, name + '：只有首领时不得追它（不处理=不主动打）');
  assert.equal(a815QoaTarget(src, [A815_BOSS, A815_NORM], j2), 71, name + '：解围技能必须跳过被忽略的首领、选中普通怪');
  const lb = a815Lock(src, 72, vmMob(72, '2001', [1, 0]), j2);
  assert.equal(lb.target, null, name + '：被忽略的首领不得成为本拍攻击目标');
  assert.equal(lb.lock, 72, name + '：被忽略的首领必须保留锁（条件满足后同一把锁自动恢复）');
  assert.match(String(lb.act), /忽略集合/, name + '：必须写明「锁定首领在忽略集合」');
  const t1 = a815Decide(src, '等待残血补尾刀', [A815_BOSS, A815_NORM], 50);
  assert.equal(t1.ign(72, 2001), true, name + '：尾刀未到线必须忽略首领');
  assert.equal(t1.ign(71, 9999), false, name + '：尾刀未到线不得影响普通怪');
  const t2 = a815Decide(src, '等待残血补尾刀', [A815_BOSS, A815_NORM], -1);
  assert.equal(t2.st().block, '血量未知', name + '：前置——血量未知必须写明');
  assert.equal(t2.ign(72, 2001), true, name + '：血量未知必须忽略首领');
  assert.equal(t2.ign(71, 9999), false, name + '：血量未知不得影响普通怪');
  const t3 = a815Decide(src, '等待残血补尾刀', [A815_BOSS, A815_NORM], 20);
  assert.equal(t3.st().allow, 72, name + '：前置——到尾刀线必须放行那一只');
  assert.equal(t3.ign(72, 2001), false, name + '：到尾刀线的首领必须可以打');
  assert.equal(t3.ign(71, 9999), false, name + '：到尾刀线也不得影响普通怪');
  const p1 = a815Decide(src, '优先攻击', [A815_BOSS, A815_NORM], 10);
  assert.equal(p1.st().all, false, name + '：优先攻击不得进忽略集合');
  assert.equal(p1.ign(72, 2001), false, name + '：优先攻击时首领不被忽略');
  assert.equal(p1.ign(71, 9999), false, name + '：优先攻击时普通怪不被忽略');
  const f1 = a815Decide(src, '瞬移', [A815_BOSS, A815_NORM], 10);
  assert.equal(f1.st().all, false, name + '：瞬移不得进忽略集合');
  assert.equal(f1.ign(72, 2001), false, name + '：瞬移时首领不被忽略');
  assert.equal(f1.ign(71, 9999), false, name + '：瞬移时普通怪不被忽略');
  assert.ok(lf15(src).includes('function zBossIgnoredGid(gid, mid) {'), name + '：忽略集合判据必须接收该实体的 mid');
  assert.ok(lf15(src).includes('if (!isBossMid(mid)) return false;'), name + '：忽略集合判据必须内含「必须是首领」守卫');
}
test('V2.38.15 审计修复 ① 默认不处理且视野内没有首领：普通怪照常被索敌/追击/解围/锁定（两文件 VM）', () => {
  for (const [name, src] of splitSources) a815NoBoss(src, name);
});
test('V2.38.15 审计修复 ②③ 默认与尾刀模式只忽略首领：同一视野的普通怪与放行首领照旧（两文件 VM）', () => {
  for (const [name, src] of splitSources) a815BossOnly(src, name);
});

function a815AssistRestore(src, name) {
  const h = v15AssistHarness(lf15(src));
  h.ctx.lockList = { '1002': { name: 'A' } };
  h.box.checked = false; h.ctx.saved.allMobs = false;
  const r = h.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true });
  assert.equal(r.ok, true, name + '：代打战斗准备必须成立');
  assert.equal(h.ctx.apiAllMobsSaved, false, name + '：必须记下启动前的原值 false');
  assert.equal(h.box.checked, true, name + '：清空名单自动勾上 + 代打要求全部怪 → 必须为勾选');
  assert.equal(h.ctx.saved.allMobs, true, name + '：前置——自动勾选必须已经落盘（缺陷现场）');
  h.st.saves = 0; h.st.caps = 0;
  assert.equal(h.ctx.restore(), true, name + '：释放必须执行还原');
  assert.equal(h.box.checked, false, name + '：释放后界面勾选必须回到启动前');
  assert.equal(h.ctx.saved.allMobs, false, name + '：释放后必须把原值回写到设置（不得残留自动写入的 true）');
  assert.equal(h.st.saves, 1, name + '：回写必须走同一套保存路径（落盘一次）');
  assert.equal(h.st.caps, 2, name + '：角色档 ui 表必须一起收割（归还名单触发一次 + 回写原值触发一次）');
  h.st.saves = 0;
  assert.equal(h.ctx.restore(), false, name + '：已释放状态不得重复还原');
  assert.equal(h.st.saves, 0, name + '：重复释放必须零落盘');
  const h2 = v15AssistHarness(lf15(src));
  h2.box.checked = true; h2.ctx.saved.allMobs = true;
  h2.ctx.prep('builtin-dojo', { allMobs: true });
  assert.equal(h2.ctx.restore(), true, name + '：第二条链路释放必须执行还原');
  assert.equal(h2.box.checked, true, name + '：原本是开 → 还原成开');
  assert.equal(h2.ctx.saved.allMobs, true, name + '：原本是开 → 设置原值保持 true');
  // V2.38.16 F2/F1 交叉：原值 true 时，「归还名单」触发的自动联动会先把值改成 false，最终必须由「回写原值」纠正回 true
  const h3 = v15AssistHarness(lf15(src));
  h3.ctx.lockList = { '1002': { name: 'A' } };
  h3.box.checked = true; h3.ctx.saved.allMobs = true;
  assert.equal(h3.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true }).ok, true, name + '：第三条链路必须能准备');
  assert.equal(h3.ctx.apiAllMobsSaved, true, name + '：原值 true 必须在清空名单之前记下');
  assert.equal(h3.ctx.restore(), true, name + '：第三条链路释放必须执行还原');
  assert.equal(h3.box.checked, true, name + '：原本是开 → 释放后仍必须是开');
  assert.equal(h3.ctx.saved.allMobs, true, name + '：释放后必须把原值回写到设置（归还名单引发的自动联动会先把值改成 false，不得顶替回写）');
  assert.ok(lf15(src).includes('if (saved && saved.allMobs !== v) { saved.allMobs = v; saveSaved(saved); }'), name + '：释放必须把原值回写 saved 并落盘');
}
test('V2.38.15 审计修复 ④ 代打释放把「打全部怪」原值回写落盘，与启动前完全一致（两文件 VM）', () => {
  for (const [name, src] of splitSources) a815AssistRestore(src, name);
});

function a815BossInject(src, name) {
  const s = lf15(src);
  const seg = cut15(s, '        var bossWantD = zBossDecide();', '      // V2.38.15：锁定的首位首领落在忽略集合里');
  const run = (defSnap) => {
    const bossEnt = { GID: 72, _job: 2001, objecttype: 5, position: [1, 0], display: { name: 'B' }, life: { hp: 100 }, isDeath: false, remove_tick: 0, ACTION: { DIE: 9 }, action: 0 };
    const injected = [];
    const ctx = {
      zBossDecide: () => ({ rec: { GID: 72, mid: 2001 }, want: 72, act: '优先攻击', fly: false }),
      tempTargetHeld: false, zLock: { gid: null, name: '', dist: null, done: false, reactive: false },
      zEntOf: (gid) => (Number(gid) === 72 ? bossEnt : null),
      ent: { position: [0, 0] }, npMode: false, npThD: 10, atkRange: 7,
      zRangeDist: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])),
      gidInt: (v) => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; },
      defSnap: defSnap, sendLockInject: (g) => injected.push(g), tlog: () => {},
      zLockCounts: {}, zCastIdx: 0, zAtkLast: { gid: null, at: 0, outOfRange: false }, now: 1000,
      Object, Math, String, Number, parseInt, isFinite,
    };
    vm.createContext(ctx);
    vm.runInContext('this.fn = function () { try {' + LF + seg + LF + '};', ctx);
    ctx.fn();
    return { injected: injected, lock: ctx.zLock.gid };
  };
  const a = run({ isCombatMap: false, inFight: true });
  assert.deepEqual(JSON.parse(JSON.stringify(a.injected)), [72], name + '：刷怪表为空但视野内有怪（inFight）时同样要注入首领锁定');
  assert.equal(a.lock, 72, name + '：注入必须真的写进锁定目标');
  const b = run({ isCombatMap: true, inFight: false });
  assert.deepEqual(JSON.parse(JSON.stringify(b.injected)), [], name + '：没有怪时（inFight 关）不得注入，哪怕刷怪表非空');
  const c = run({ isCombatMap: true, inFight: true });
  assert.deepEqual(JSON.parse(JSON.stringify(c.injected)), [72], name + '：既有口径必须保持（战斗地图 + 有怪）');
  assert.ok(s.includes('defSnap && defSnap.inFight && gidInt(zLock.gid) !== gidInt(bgid)'), name + '：注入门必须用 inFight（与其它防御判定一致）');
}
test('V2.38.15 审计修复 ⑤ 首领锁定注入改用 inFight 口径：刷怪表为空但视野有怪也会注入（两文件 VM）', () => {
  for (const [name, src] of splitSources) a815BossInject(src, name);
});

const A815_MUTS = [
  { tag: 'M-A815-1a', desc: '①忽略集合判据去掉「必须是首领」守卫（回到只判 gid）→ 用例①红',
    from: '      if (!isBossMid(mid)) return false;',
    to: '      // 变异：去掉首领守卫',
    verify: a815NoBoss, expect: /视野内没有首领时，普通怪绝不能被忽略/ },
  { tag: 'M-A815-1b', desc: '①忽略集合判据去掉「必须是首领」守卫（回到只判 gid）→ 用例②红',
    from: '      if (!isBossMid(mid)) return false;',
    to: '      // 变异：去掉首领守卫',
    verify: a815BossOnly, expect: /同一视野里的普通怪绝不能被忽略/ },
  { tag: 'M-A815-2', desc: '④代打释放不回写 saved.allMobs（原值残留自动写入的 true）',
    from: '      try { if (saved && saved.allMobs !== v) { saved.allMobs = v; saveSaved(saved); } } catch (e1) {}',
    to: '      // 变异：释放不回写 saved.allMobs',
    verify: a815AssistRestore, expect: /释放后必须把原值回写到设置/ },
  { tag: 'M-A815-3', desc: '⑤首领锁定注入退回 isCombatMap 口径',
    from: 'defSnap && defSnap.inFight && gidInt(zLock.gid)',
    to: 'defSnap && defSnap.isCombatMap && gidInt(zLock.gid)',
    verify: a815BossInject, expect: /刷怪表为空但视野内有怪/ },
];
test('V2.38.15 审计修复 变异矩阵：4 个变异在 stable/exp 上必须各自被「指定断言」杀死（覆盖缺陷 1/2/4）', () => {
  for (const m of A815_MUTS) {
    for (const [name, src] of splitSources) {
      const mutated = M23813(src, m.from, m.to);
      const v = a815Catch(() => m.verify(mutated, name + '·' + m.tag));
      const killed = v.ok === false;
      A815_MATRIX.push({ tag: m.tag + '@' + name, desc: m.desc, expected: '红', actual: killed ? '红' : '绿', caught: killed ? a815Msg(v.e) : '未被抓（变异存活）' });
      assert.ok(killed, m.tag + '@' + name + '：变异必须让对应用例变红（' + m.desc + '）');
      assert.match(a815Msg(v.e), m.expect, m.tag + '@' + name + '：必须被「指定断言」抓到，实际=' + a815Msg(v.e));
    }
  }
  assert.equal(A815_MATRIX.length, A815_MUTS.length * splitSources.length, '每个变异 × 两文件都要独立真跑一次');
  assert.ok(A815_MATRIX.every((r) => r.actual === '红'), '不得存在变异存活行');
  console.log('[V2.38.15 审计修复 变异矩阵] ' + A815_MATRIX.length + ' 条全部为红：' + A815_MATRIX.map((r) => r.tag).join(', '));
  if (process.env.A815_JSON) fs.writeFileSync(process.env.A815_JSON, JSON.stringify(A815_MATRIX, null, 2), 'utf8');
});

// ================= V2.38.16：[F1] 代打留痕 / [F2] 永久名单归还 / [F3] 锁定目标编号 / [F4] 首领诊断 / [F5] 用户可见文案 =================
const V23816_MATRIX = [];
const v16Catch = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const v16Msg = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 220);
const v16Lf = (x) => String(x).split(String.fromCharCode(13)).join('');

// ---------- F1：只有代打确实启动（可信分支走完）才提交「打全部怪」原值 ----------
function v16PrepHarness(src, opts) {
  const o = opts || {};
  const h = v15AssistHarness(v16Lf(src));
  h.ctx.profileTrusted = o.trusted === false ? () => false : () => true;
  h.ctx.profWriteGuard = o.guard === false ? () => false : () => true;
  return h;
}
function v16F1(src, name) {
  // ① 角色档未识别：准备被拒 → 不留暂存值、零写盘、界面与设置原样（缺陷现场：留痕会被后续释放误写成 true）
  const bad = v16PrepHarness(src, { trusted: false });
  bad.ctx.lockList = { '1002': { name: 'A' } };
  bad.box.checked = false; bad.ctx.saved.allMobs = false;
  const r0 = bad.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true });
  assert.equal(r0.ok, false, name + '：角色档未识别时代打准备必须被拒');
  assert.equal(r0.error, 'profile-untrusted', name + '：必须如实回报未识别（不得静默成功）');
  assert.equal(bad.ctx.apiAllMobsSaved, null, name + '：被拒时绝不留暂存值（否则后续释放会误写「打全部怪」）');
  assert.equal(Object.keys(bad.ctx.lockList).length, 1, name + '：被拒时永久名单必须原样（不得清）');
  assert.equal(bad.box.checked, false, name + '：被拒时界面勾选不得被改动');
  assert.equal(JSON.stringify(bad.ctx.saved), '{"allMobs":false}', name + '：被拒时设置表必须逐字节原样');
  assert.equal(bad.st.saves, 0, name + '：被拒时零落盘（saved）');
  assert.equal(bad.st.writes, 0, name + '：被拒时零落盘（档案）');
  assert.equal(bad.st.caps, 0, name + '：被拒时不得收割界面');
  assert.equal(bad.ctx.restore(), false, name + '：没有暂存值 → 释放必须什么都不做（返回 false）');
  assert.equal(bad.box.checked, false, name + '：释放后界面勾选仍是原值 false');
  assert.equal(bad.ctx.saved.allMobs, false, name + '：释放后设置仍是原值 false（不得被误写成 true）');
  assert.equal(bad.st.saves, 0, name + '：释放也必须零落盘');
  // ② 之后角色档变为可识别、并且界面收割真的跑过一次 → 依然不得把「打全部怪」打开
  bad.ctx.profileTrusted = () => true;
  bad.ctx.captureAll();
  assert.equal(bad.ctx.apiAllMobsSaved, null, name + '：可识别之后暂存值仍必须是空（残留会被当成原值）');
  assert.equal(bad.ctx.restore(), false, name + '：可识别之后释放仍然必须什么都不做');
  assert.equal(bad.box.checked, false, name + '：可识别之后界面勾选不得自己变成 true');
  assert.equal(bad.ctx.saved.allMobs, false, name + '：可识别之后设置不得自己变成 true');
  // ③ 可信 + 清名单成功：正常留痕与还原（与 2.38.15 语义一致）
  const good = v16PrepHarness(src);
  good.ctx.lockList = { '1002': { name: 'A' } };
  good.box.checked = false; good.ctx.saved.allMobs = false;
  const r1 = good.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true });
  assert.equal(r1.ok, true, name + '：可信时准备必须成立');
  assert.equal(r1.cleared, 1, name + '：必须清掉 1 条名单');
  assert.equal(good.ctx.apiAllMobsSaved, false, name + '：可信分支走完才提交原值 false');
  assert.equal(good.box.checked, true, name + '：清名单自动勾上 + 代打要求全部怪 → 必须为勾选');
  assert.equal(good.ctx.restore(), true, name + '：释放必须执行还原');
  assert.equal(good.box.checked, false, name + '：释放后必须回到清空前的原值');
  assert.equal(good.ctx.saved.allMobs, false, name + '：释放后设置必须回到原值');
  const r2 = good.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true });
  assert.equal(r2.allMobsRestore, false, name + '：再准备一次不得把已改动的界面值当成新原值');
}
test('V2.38.16 F1 代打准备留痕：角色档未识别时零留痕零写盘，可信分支才提交「打全部怪」原值（两文件 VM）', () => {
  for (const [name, src] of splitSources) v16F1(src, name);
});

// ---------- F2：清名单动的是角色档里的永久名单，释放必须归还 ----------
function v16F2(src, name) {
  const h = v16PrepHarness(src);
  const snap = { '1002': { name: 'A' }, '1003': { name: 'B' } };
  h.ctx.lockList = { '1002': { name: 'A' }, '1003': { name: 'B' } };
  h.ctx.profiles['ch1'] = { lockList: { '1002': { name: 'A' }, '1003': { name: 'B' } } };
  h.box.checked = false; h.ctx.saved.allMobs = false;
  assert.equal(h.ctx.prep('builtin-dojo', { clearLocks: true, allMobs: true }).ok, true, name + '：前置——准备必须成立');
  assert.equal(Object.keys(h.ctx.lockList).length, 0, name + '：前置——清名单必须真的清掉内存名单');
  assert.equal(Object.keys(h.ctx.profiles['ch1'].lockList).length, 0, name + '：前置——清名单动的是角色档里的永久名单（这就是会被丢掉的用户数据）');
  // 代打期间用户自己又加了一条 → 释放时不得丢
  h.ctx.lockList['1004'] = { name: 'C' };
  assert.equal(h.ctx.restore(), true, name + '：释放必须执行归还');
  assert.equal(h.ctx.lockList['1002'] && h.ctx.lockList['1002'].name, 'A', name + '：永久名单必须按启动前快照归还（1002）');
  assert.equal(h.ctx.lockList['1003'] && h.ctx.lockList['1003'].name, 'B', name + '：永久名单必须按启动前快照归还（1003）');
  assert.equal(h.ctx.lockList['1004'] && h.ctx.lockList['1004'].name, 'C', name + '：代打期间新加的条目必须保留（不丢用户数据）');
  assert.equal(JSON.stringify(h.ctx.profiles['ch1'].lockList), JSON.stringify({ '1002': { name: 'A' }, '1003': { name: 'B' }, '1004': { name: 'C' } }), name + '：归还必须落盘到角色档，且内容与内存态逐字节一致');
  assert.equal(h.ctx.saved.allMobs, false, name + '：归还名单引发的自动联动不得把「打全部怪」留成 true');
  assert.equal(h.ctx.apiLockListSaved, null, name + '：快照用完必须清空（不得重复归还）');
  assert.equal(h.ctx.restore(), false, name + '：已释放状态不得重复归还（也不得重复落盘）');
  // 未识别档：归还一律不写盘（内存态可以改，磁盘绝不动）
  const u = v16PrepHarness(src, { trusted: false, guard: false });
  u.ctx.lockList = {};
  u.ctx.profiles['ch1'] = { lockList: {} };
  u.ctx.apiLockListSaved = JSON.parse(JSON.stringify(snap));
  u.st.writes = 0; u.st.saves = 0;
  assert.equal(u.ctx.restore(), true, name + '：未识别档也要把内存名单还回去（界面不能停在空名单）');
  assert.equal(u.st.writes, 0, name + '：未识别档归还绝不落盘（档案写入必须为 0）');
  assert.equal(u.st.saves, 0, name + '：未识别档归还绝不落盘（saved 写入必须为 0）');
  assert.equal(Object.keys(u.ctx.profiles['ch1'].lockList).length, 0, name + '：未识别档的磁盘内容必须原样（绝不写坏角色档）');
}
test('V2.38.16 F2 代打释放归还永久锁定名单：按启动前快照合并归还并落盘；未识别档零写盘（两文件 VM）', () => {
  for (const [name, src] of splitSources) v16F2(src, name);
});

// ---------- F3：锁定目标 mid 不再只靠 EntityManager.get（优先本拍扫描表 + .mid 兜底 + 段计数） ----------
function v16F3Harness(src, j, o) {
  const s = v16Lf(src);
  const counter = cut15(s, '  // ================= V2.38.16 F3 锁定目标 mid 诊断（只进诊断环/本机日志，不改用户可见文案） =================', '  function zAttack() {');
  const seg = cut15(s, '      // V2.38.15：锁定的首位首领落在忽略集合里', '      if (tempTargetHeld && !target) {');
  const ctx = {
    zLock: { gid: o.lockGid, name: '?', dist: null, done: false, reactive: false },
    zLockCounts: {}, zCastIdx: 0, zAtkLast: { gid: o.lockGid, outOfRange: false },
    zMon: { action: '' }, zAtkWhy: '', tlog: () => {},
    npMode: false, npThD: 10, zFollow: true, zNext: true, range: 12, atkRange: 2,
    ent: { position: [0, 0] }, tempTargetHeld: false,
    scanMobs: o.scan || [], lastMobs: [],
    zEntOf: o.zEntOf || (() => null),
    zRangeDist: (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])),
    gidInt: (v) => { const x = parseInt(v, 10); return isFinite(x) ? x : 0; },
    EM: { forEach: (cb) => (o.em || []).forEach(cb) },
    zBossIgnoredGid: (g, m) => j.ign(g, m),
    Object, Math, String, Number, parseInt, isFinite,
  };
  vm.createContext(ctx);
  vm.runInContext(counter + ';' + 'this.count=()=>zLockMidMissCount;this.open=()=>zLockMidMissOpen;' +
    'this.fn=function(){var target=null,lockAliveOutside=false;' + seg + 'return {target:target,lock:zLock.gid,act:zMon.action};};', ctx);
  return ctx;
}
function v16F3(src, name) {
  const j = a815Decide(src, '不处理', [A815_BOSS, A815_NORM], -1);
  assert.equal(j.ign(72, 2001), true, name + '：前置——「不处理」必须把首领 2001 放进忽略集合');
  assert.equal(j.ign(71, '9999'), false, name + '：前置——普通怪 9999 不得被忽略');
  // ① 锁定的首领：EntityManager.get 拿不到时，本拍扫描表里的 mid 必须照样认出它是首领并跳过
  const hb = v16F3Harness(src, j, { lockGid: 72, zEntOf: () => null, em: [vmMob(72, '2001', [1, 0])],
    scan: [{ GID: 72, _job: '2001', mid: 2001, name: 'B', dist: 1, isBoss: true }] });
  const rb = hb.fn();
  assert.equal(rb.target, null, name + '：EntityManager.get 不可用时，被忽略的首领同样不得成为攻击目标');
  assert.equal(rb.lock, 72, name + '：被忽略的首领必须保留锁（条件满足后同一把锁自动恢复）');
  assert.match(String(rb.act), /忽略集合/, name + '：必须写明「锁定首领在忽略集合」');
  assert.equal(hb.count(), 0, name + '：能解析出 mid 时不得记「取不到」诊断');
  // ② 锁定的普通怪：mid 只能从扫描表的 .mid 字段拿到（没有 _job），必须照样攻击
  const hn = v16F3Harness(src, j, { lockGid: 71, zEntOf: () => null, em: [vmMob(71, '9999', [1, 0])],
    scan: [{ GID: 71, mid: 9999, name: 'N', dist: 1, isBoss: false }] });
  const rn = hn.fn();
  assert.ok(rn.target && rn.target.GID === 71, name + '：EntityManager.get 不可用时，锁定普通怪必须照样解析成目标并攻击');
  assert.equal(hn.count(), 0, name + '：扫描表的 mid 已经够用，不得记「取不到」诊断（不许只认 EntityManager.get）');
  // ③ 真的取不到 → 按普通怪处理，并且「一段只记一次」
  const hf = v16F3Harness(src, j, { lockGid: 55, zEntOf: () => null, em: [vmMob(55, null, [1, 0])], scan: [] });
  hf.fn();
  assert.equal(hf.count(), 1, name + '：mid 取不到必须记一次诊断计数（按段）');
  hf.fn(); hf.fn();
  assert.equal(hf.count(), 1, name + '：同一段连续取不到只记一次（不得每拍都记）');
  assert.equal(hf.open(), true, name + '：取不到期间段标志必须保持打开');
  hf.zLock.gid = 71; hf.scanMobs = [{ GID: 71, mid: 9999, dist: 1 }];
  hf.fn();
  assert.equal(hf.open(), false, name + '：解析成功必须结束当前段（段标志复位）');
  hf.zLock.gid = 55; hf.scanMobs = []; hf.fn();
  assert.equal(hf.count(), 2, name + '：重新取不到必须记为第二段（一段一记）');
}
test('V2.38.16 F3 锁定目标编号：EntityManager.get 不可用时按本拍扫描表解析 mid，取不到就按普通怪并只记一段（两文件 VM）', () => {
  for (const [name, src] of splitSources) v16F3(src, name);
});
test('V2.38.16 F3 结构：mid 链含 .mid 兜底且扫描表优先、段计数进诊断快照（两文件）', () => {
  for (const [name, src] of splitSources) {
    const s = v16Lf(src);
    assert.ok(s.includes('var zLockEntSkip = zLockScanEnt || (zLock.gid ? zEntOf(zLock.gid) : null);'), name + '：必须先认本拍扫描表，zEntOf 只作兜底');
    assert.ok(s.includes('(zLockEntSkip.mobId != null ? zLockEntSkip.mobId : (zLockEntSkip.mid != null ? zLockEntSkip.mid : null))'), name + '：mid 链必须有 .mid 兜底（与还击候选链同口径）');
    assert.ok(s.includes('lockMidMiss: zLockMidMissCount'), name + '：段计数必须进诊断快照');
    assert.ok(s.includes('if (!zLockMidMissOpen) { zLockMidMissOpen = true; zLockMidMissCount++;'), name + '：一段只记一次');
  }
});

// ---------- F4：首领诊断的「忽略」标记必须按 mid 判 ----------
function v16F4(src, name) {
  const s = v16Lf(src);
  const code = cut15(s, '  function zBossDiagText() {', '  // 「首领诊断」按钮：');
  const mobDb = { '1002': { MvpDropsNum: 1 }, '1003': { MvpDropsNum: 0 } };
  const ctx = {
    VER: '2.38.16',
    getMobDb: () => mobDb,
    zLock: { gid: 55, name: '波利', reactive: false },
    $id: (id) => (id === 'dsh-z-bossact' ? { value: '等待残血补尾刀' } : (id === 'dsh-z-bossdist' ? { value: '14' } : null)),
    scanMobs: [{ GID: 55, mid: 1002, name: '波利', dist: 3, isBoss: true }, { GID: 56, mid: 1003, name: '绿棉虫', dist: 5, isBoss: false }],
    lastMobs: [], gidInt: Number, distInt: (d) => Math.round(Number(d)),
    zBossIgnoreAll: true, zBossAllowGid: 0, zBossWantGid: 0, zBossLastBlock: '尾刀未到线', zBossDistUsed: 14,
    zBossDistNow: () => 14,
    // 与产品同口径：只有「mid 在怪物库里首领值 > 0」才算首领 —— 传 GID 一律认不出
    zBossIgnoredGid: (g, m) => { const e = (m === null || m === undefined) ? null : mobDb[String(m)]; return !!(e && Number(e.MvpDropsNum) > 0); },
    Object, Number, String, Array, Math, isFinite, parseInt };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.txt=zBossDiagText;', ctx);
  const txt = String(ctx.txt());
  const lines = txt.split(String.fromCharCode(10));
  const bossLine = lines.filter((x) => x.indexOf('编号=1002') >= 0).join('|');
  const normLine = lines.filter((x) => x.indexOf('编号=1003') >= 0).join('|');
  assert.ok(bossLine.indexOf('忽略') >= 0, name + '：首领那一行必须标出「忽略」（mid=1002 首领值 1，实际=' + bossLine + '）');
  assert.ok(normLine.indexOf('忽略') < 0, name + '：普通怪那一行绝不能标「忽略」（mid=1003 首领值 0，实际=' + normLine + '）');
  assert.ok(s.includes('zBossIgnoredGid(m.GID, m.mid)'), name + '：首领诊断的「忽略」标记必须按 mid 判（传成 GID 会认不出来）');
}
test('V2.38.16 F4 首领诊断按 mid 标「忽略」：传成 GID 必须认不出（两文件 VM）', () => {
  for (const [name, src] of splitSources) v16F4(src, name);
});

// ---------- F5：用户可见文案不得出现实现词（白名单出口扫描） ----------
function v16UiScan(src) {
  const s = v16Lf(src);
  const n = s.length, out = new Array(n), lits = [];
  const NL = String.fromCharCode(10);
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== NL) { out[i] = ' '; i++; } continue; }
    if (c === '/' && s[i + 1] === '*') { out[i] = ' '; out[i + 1] = ' '; i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { out[i] = s[i] === NL ? NL : ' '; i++; } if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; } continue; }
    if (c === '"' || c === "'" || c === '`') {
      const st = i, q = c; out[i] = ' '; i++;
      while (i < n) {
        if (s[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (s[i] === q) { out[i] = ' '; i++; break; }
        out[i] = s[i] === NL ? NL : ' '; i++;
      }
      lits.push({ start: st, end: i, raw: s.slice(st, i) });
      continue;
    }
    if (c === '/') {
      let k = i - 1; while (k >= 0 && /\s/.test(s[k])) k--;
      const prev = k >= 0 ? s[k] : '';
      if (prev === '' || /[=(,:[!&|?{};+\-*%^~<>]/.test(prev) || /(return|typeof|case|in|of|new|delete|void|do|else)$/.test(s.slice(Math.max(0, k - 6), k + 1))) {
        out[i] = ' '; i++;
        let inClass = false;
        while (i < n) { const ch = s[i]; if (ch === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; } if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) { out[i] = ' '; i++; break; } else if (ch === NL) { break; } out[i] = ch === NL ? NL : ' '; i++; }
        continue;
      }
    }
    out[i] = c; i++;
  }
  const masked = out.join('');
  const spans = [];
  const calls = ['setStatus', 'npLog', 'mvLog', 'petLog', 'gearLog', 'bagCleanSay', 'scrLogLine', 'arrowSay', 'show', 'status', 'alert', 'confirm', 'fail'];
  for (const nm of calls) {
    const re = new RegExp('(?<![A-Za-z0-9_$.])' + nm + '\\s*\\(', 'g');
    let m;
    while ((m = re.exec(masked))) {
      let d = 0, j = m.index + m[0].length - 1;
      for (; j < masked.length; j++) { if (masked[j] === '(') d++; else if (masked[j] === ')') { d--; if (d === 0) { j++; break; } } }
      spans.push({ name: nm, start: m.index, end: j });
    }
  }
  for (const prop of ['innerHTML', 'textContent', 'title', 'placeholder']) {
    const re = new RegExp('\\.' + prop + '\\s*=', 'g');
    let m;
    while ((m = re.exec(masked))) {
      let d = 0, j = m.index + m[0].length;
      for (; j < masked.length; j++) { const ch = masked[j]; if (ch === '(' || ch === '[' || ch === '{') d++; else if (ch === ')' || ch === ']' || ch === '}') { if (d === 0) break; d--; } else if (ch === ';' && d === 0) break; }
      spans.push({ name: '.' + prop, start: m.index, end: j });
    }
  }
  const ph = s.indexOf('var PAGE_HTML'), pc = s.indexOf('var PROF_CONTROLS');
  if (ph >= 0 && pc > ph) spans.push({ name: 'PAGE_HTML', start: ph, end: pc });
  const qi = s.indexOf('var STATUS_QUICKREF_TXT'), qj = s.indexOf('body.textContent = STATUS_QUICKREF_TXT;');
  if (qi >= 0 && qj > qi) spans.push({ name: 'STATUS_QUICKREF_TXT', start: qi, end: qj });
  const lineOf = (idx) => s.slice(0, idx).split(NL).length;
  const violations = [];
  for (const sp of spans) {
    for (const li of lits) {
      if (li.start < sp.start || li.end > sp.end) continue;
      if (V15_UI_BAN.test(li.raw)) violations.push(sp.name + '@' + lineOf(li.start) + ': ' + li.raw.slice(0, 120));
    }
  }
  return { lits: lits.length, spans: spans.length, violations: Array.from(new Set(violations)) };
}
function v16F5Scan(src, name) {
  const r = v16UiScan(src);
  assert.ok(r.lits >= 5000, name + '：扫描必须真的覆盖到大量字符串字面量（实际 ' + r.lits + '）');
  assert.ok(r.spans >= 300, name + '：扫描必须真的覆盖到用户可见出口（实际 ' + r.spans + '）');
  assert.deepEqual(r.violations, [], name + '：用户可见文案出现实现词（' + r.violations.slice(0, 4).join(' / ') + '）');
  return r;
}
test('V2.38.16 F5 用户可见文案扫描：状态行/面板/浮窗/说明文案不得出现实现词（两文件；仅扫用户可见出口）', () => {
  const info = [];
  for (const [name, src] of splitSources) { const r = v16F5Scan(src, name); info.push(name + ' 出口=' + r.spans + ' 字面量=' + r.lits); }
  console.log('[V2.38.16 F5 文案扫描] 实现词违规 0：' + info.join(' / '));
});

// ---------- V2.38.16 变异矩阵：每个缺陷都必须被「指定断言」杀死 ----------
const V23816_MUTS = [
  { tag: 'M-V16-1', desc: 'F1：未识别也照旧在清名单之前记原值（缺陷现场）',
    from: '      var allMobsWas0 = (o.allMobs === true && allMobsEl0) ? !!allMobsEl0.checked : null;',
    to: '      var allMobsWas0 = (o.allMobs === true && allMobsEl0) ? !!allMobsEl0.checked : null;' + String.fromCharCode(10) + '      if (o.allMobs === true && allMobsEl0 && apiAllMobsSaved === null) apiAllMobsSaved = !!allMobsEl0.checked; // 变异：未识别也留痕',
    verify: v16F1, expect: /被拒时绝不留暂存值/ },
  { tag: 'M-V16-2', desc: 'F2：清名单之前不记永久名单快照（释放时用户名单丢失）',
    from: '          if (apiLockListSaved === null) { var snap0 = {}, sk0 = null; for (sk0 in lockList) { if (Object.prototype.hasOwnProperty.call(lockList, sk0)) snap0[sk0] = lockList[sk0]; } apiLockListSaved = snap0; }',
    to: '          // 变异：清空前不记永久名单快照',
    verify: v16F2, expect: /永久名单必须按启动前快照归还（1002）/ },
  { tag: 'M-V16-3a', desc: 'F3：退回只认 EntityManager.get（不认本拍扫描表）',
    from: '      var zLockEntSkip = zLockScanEnt || (zLock.gid ? zEntOf(zLock.gid) : null);',
    to: '      var zLockEntSkip = (zLock.gid ? zEntOf(zLock.gid) : null); // 变异：不认本拍扫描表',
    verify: v16F3, expect: /被忽略的首领同样不得成为攻击目标/ },
  { tag: 'M-V16-3b', desc: 'F3：mid 链去掉 .mid 兜底',
    from: '(zLockEntSkip.mobId != null ? zLockEntSkip.mobId : (zLockEntSkip.mid != null ? zLockEntSkip.mid : null))',
    to: '(zLockEntSkip.mobId != null ? zLockEntSkip.mobId : null)',
    verify: v16F3, expect: /扫描表的 mid 已经够用/ },
  { tag: 'M-V16-3c', desc: 'F3：取不到诊断每拍都记（一段一记被破坏）',
    from: '      if (!zLockMidMissOpen) { zLockMidMissOpen = true; zLockMidMissCount++;',
    to: '      if (true) { zLockMidMissOpen = true; zLockMidMissCount++;',
    verify: v16F3, expect: /同一段连续取不到只记一次/ },
  { tag: 'M-V16-4', desc: 'F4：首领诊断把 mid 传成 GID（评审 V8 那一刀）',
    from: '(zBossIgnoredGid(m.GID, m.mid) ? " 忽略" : "")',
    to: '(zBossIgnoredGid(m.GID, m.GID) ? " 忽略" : "")',
    verify: v16F4, expect: /首领那一行必须标出「忽略」/ },
  { tag: 'M-V16-5', desc: 'F5：把一条用户可见文案改回实现词',
    from: 'setStatus("游戏画面已就绪", "ok")',
    to: 'setStatus("客户端已就绪", "ok")',
    verify: v16F5Scan, expect: /用户可见文案出现实现词/ },
];
test('V2.38.16 变异矩阵：7 个变异在 stable/exp 上必须各自被「指定断言」杀死', () => {
  for (const m of V23816_MUTS) {
    for (const [name, src] of splitSources) {
      const mutated = M23813(src, m.from, m.to);
      const v = v16Catch(() => m.verify(mutated, name + '·' + m.tag));
      const killed = v.ok === false;
      V23816_MATRIX.push({ tag: m.tag + '@' + name, desc: m.desc, expected: '红', actual: killed ? '红' : '绿', caught: killed ? v16Msg(v.e) : '未被抓（变异存活）' });
      assert.ok(killed, m.tag + '@' + name + '：变异必须让对应用例变红（' + m.desc + '）');
      assert.match(v16Msg(v.e), m.expect, m.tag + '@' + name + '：必须被「指定断言」抓到，实际=' + v16Msg(v.e));
    }
  }
  assert.equal(V23816_MATRIX.length, V23816_MUTS.length * splitSources.length, '每个变异 × 两文件都要独立真跑一次');
  assert.ok(V23816_MATRIX.every((r) => r.actual === '红'), '不得存在变异存活行');
  console.log('[V2.38.16 变异矩阵] ' + V23816_MATRIX.length + ' 条全部为红：' + V23816_MATRIX.map((r) => r.tag).join(', '));
  if (process.env.V23816_JSON) fs.writeFileSync(process.env.V23816_JSON, JSON.stringify(V23816_MATRIX, null, 2), 'utf8');
});
// ================= V2.38.17：死亡回放（文字型杀因 + 死亡前 N 秒事件流 · 独立存盘，不进档案与同步键表）=================
const V23817_MATRIX = [];
const v17Catch = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, e: e }; } };
const v17Msg = (e) => String((e && e.message) || e).split(String.fromCharCode(10))[0].slice(0, 220);

function v17Module(src) {
  const s = lf15(src);
  const a = '  // ================= V2.38.17 死亡回放（文字型';
  const b = '  // ================= V2.38.17 死亡回放 END =================';
  const i = s.indexOf(a), j = s.indexOf(b);
  assert.ok(i >= 0 && j > i, '死亡回放模块必须存在且自成一段');
  return s.slice(i, j);
}

function v17Harness(src, opts) {
  const o = opts || {};
  const code = v17Module(src);
  const st = { t: o.t || 1000000, modOn: o.modOn !== false, fwOpenCalls: 0, diag: [], setStatus: 0, setCalls: 0, fail: 0 };
  const ls = new Map();
  const ent = o.ent || { GID: 4242, life: { hp: 500, hp_max: 1000, sp: 120 }, action: 0, isDeath: false, ACTION: { DIE: 9 } };
  const names = o.names || {};
  const ctx = {
    Number, String, Math, JSON, Object, isFinite, parseInt, Infinity, DataView,
    Date: { now: () => st.t },
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { st.setCalls++; if (st.fail > 0) { st.fail--; throw new Error('容量已满'); } ls.set(k, String(v)); },
      removeItem: (k) => { ls.delete(k); },
    },
    CLIENT: { SS: { GID: 4242, AID: 4242, Entity: ent } },
    gidInt: (v) => { const n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; },
    DSHCollect: { ringPush: (ring, item, max) => { ring.push(item); if (max > 0 && ring.length > max) ring.splice(0, ring.length - max); return item; } },
    roModOn: () => st.modOn,
    buffActive: o.buff || {},
    BUFF_DEBUFF_CN: { '中毒': 'POISON' },
    STATUS_ID_TABLE: [{ cn: '中毒', id: 5, deb: 1 }],
    buffStId: (k) => (k === 'POISON' ? 5 : -1),
    statusNameById: (id) => (id === 5 ? '中毒' : null),
    getSkillNameById: (id) => (id === 5 ? '怒雷强击' : null),
    dpsEntName: (gid) => names[gid] || '',
    requireDB: () => null,
    scrPos: () => (o.pos || [120, 80]),
    getMapName: () => (o.map || 'pay_fild01'),
    getMapNameCn: () => '佩伊原野',
    normMapKey: (m) => String(m || '').replace(/\.(rsw|gat)$/i, '').replace(/^map_/i, '').toLowerCase(),
    selfCharId: () => 4242,
    selfName: () => '测试角色',
    activeProfileKey: () => 'ch4242',
    fmtK: (n) => String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    roEscTxt: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    TGT_SPRITE_BASE: 'http://127.0.0.1:8898/monster-sprites/by-id/',
    fwOpen: (id) => { st.fwOpenCalls++; return o.fwOpenFail ? false : true; },
    fwActualOpen: () => false,
    dshDiag: (ev) => { st.diag.push(ev); },
    setStatus: () => { st.setStatus++; },
    document: { addEventListener: () => {}, getElementById: () => null, createElement: () => null, documentElement: null },
    $id: () => null,
    console: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.D={' +
    'push:dlogPushEvt,win:dlogWindowEvents,hatch:dlogHatch,sample:dlogSample,onVanish:dlogOnVanish,' +
    'onRaw:dlogOnRawDamage,onDamage:dlogOnDamage,tick:dlogTick,store:dlogStore,list:dlogList,build:dlogBuild,' +
    'killers:dlogBuildKillers,timeline:dlogTimeline,fallback:dlogAvatarFallback,wire:dlogWireAvatars,' +
    'avsrc:dlogAvatarSrc,avhtml:dlogAvatarHtml,sktext:dlogSkillText,honest:dlogHonestHtml,reset:dlogReset,' +
    'clear:dlogClear,maybePop:dlogMaybePop,ring:function(){return __dshDeathEvt;},' +
    'setCfg:function(a,s){dlogCfg.auto=a;dlogCfg.span=s;},cfg:function(){return dlogCfg;},' +
    'snapshot:function(){return JSON.parse(localStorage.getItem(DLOG_KEY)||"null");},KEY:DLOG_KEY};', ctx);
  return { ctx, D: ctx.D, st, ls, ent, names };
}

const V17_FRAME = new Uint8Array([0x80, 0, 0x92, 0x10, 0, 0, 1]).buffer;   // 我（GID 4242）死亡通知（真实入站消息就是 ArrayBuffer）

// ---------- ① 事件环：追加式 / 超 400 截断 / 读取时按回放时长剔除 ----------
function v17Ring(src, name) {
  const h = v17Harness(src);
  for (let i = 0; i < 401; i++) h.D.push({ t: 1000000 + i * 31, k: 'dmg', src: 7, tg: 4242, dmg: 10 + i, cnt: 1 });
  const r = h.D.ring();
  assert.equal(r.length, 400, name + '：事件环超 400 必须丢最旧');
  assert.equal(r[0].dmg, 11, name + '：丢掉的必须是最旧那条');
  assert.equal(r[399].dmg, 410, name + '：保留的必须是最新那条');
  const h2 = v17Harness(src);
  h2.D.setCfg(true, 3);
  [1000, 4000, 6000, 8000, 9000].forEach((t) => h2.D.push({ t, k: 'dmg', src: 7, tg: 4242, dmg: t, cnt: 1 }));
  const ts = (arr) => { const out = []; for (let i = 0; i < arr.length; i++) out.push(arr[i].t); return out; };
  assert.deepEqual(ts(h2.D.win(9000, 3)), [6000, 8000, 9000], name + '：只保留回放时长内的事件（超时的必须剔除）');
  assert.deepEqual(ts(h2.D.win(9000, 1)), [8000, 9000], name + '：回放时长 1 秒时窗口同样收敛');
  assert.deepEqual(ts(h2.D.win(9000, 99)), [1000, 4000, 6000, 8000, 9000], name + '：回放时长超范围时按上限 10 秒收敛');
}
test('V2.38.17 ① 死亡回放事件环：追加式、超 400 丢最旧、读取时按回放时长剔除（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Ring(src, name);
});

// ---------- ② 同一次死亡只产 1 条 / 上限 / 写盘异常不抛 ----------
function v17Record(src, name) {
  const h = v17Harness(src, { names: { 77: '腐尸' } });
  h.st.t = 1000000;
  h.D.push({ t: 999500, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 0, sk: null, dmg: 300, cnt: 1 });
  assert.equal(h.D.onVanish(V17_FRAME), true, name + '：服务器死亡通知必须产出记录');
  assert.equal(h.D.onVanish(V17_FRAME), false, name + '：同一次死亡再次通知不得重复产记录');
  h.ent.isDeath = true; h.ent.life.hp = 0;
  h.st.t = 1000800;
  assert.equal(h.D.tick(), false, name + '：同一次死亡的每秒兜底不得重复产记录');
  assert.equal(h.D.list().length, 1, name + '：同一次死亡只产 1 条记录');
  h.ent.isDeath = false; h.ent.life.hp = 600; h.st.t = 1002000; h.D.tick();
  h.ent.isDeath = true; h.ent.life.hp = 0; h.st.t = 1002400;
  assert.equal(h.D.tick(), true, name + '：复活后的下一次死亡要重新产记录');
  assert.equal(h.D.list().length, 2, name + '：两次死亡两条记录');
  const snap = h.D.snapshot();
  assert.equal(snap.v, 1, name + '：独立键版本号必须是 1');
  assert.equal(Number(snap.at), 1002400, name + '：独立键要记最近一次的时间');
  const rec = snap.items[0];
  assert.equal(rec.charId, 4242, name + '：记录必须带角色 ID');
  assert.equal(rec.name, '测试角色', name + '：记录必须带角色名');
  assert.equal(rec.key, 'ch4242', name + '：记录必须带档键');
  assert.equal(rec.map, 'pay_fild01', name + '：记录必须带地图');
  assert.deepEqual([rec.x, rec.y], [120, 80], name + '：记录必须带坐标');
  assert.equal(rec.hp, 0, name + '：记录必须带当时的血量');
  const h2 = v17Harness(src);
  for (let i = 0; i < 25; i++) h2.D.store({ at: 5000 + i, events: [], killers: [] });
  const items = h2.D.list();
  assert.equal(items.length, 20, name + '：条数上限 20');
  assert.equal(items[0].at, 5024, name + '：新记录在最前');
  assert.equal(items[19].at, 5005, name + '：超上限时丢最旧');
  const h3 = v17Harness(src);
  h3.D.setCfg(true, 10);
  h3.st.t = 1050000;
  for (let i = 0; i < 130; i++) h3.D.push({ t: 1050000 - (130 - i), k: 'dmg', src: 90, tg: 4242, dmg: 1 + i, cnt: 1 });
  const rec3 = h3.D.build(1050000, 'caps');
  assert.equal(rec3.events.length, 120, name + '：单条事件上限 120');
  assert.equal(rec3.events[0].dmg, 11, name + '：超上限时丢最旧的事件');
  assert.equal(rec3.events[119].dmg, 130, name + '：保留最新的事件');
  const h4 = v17Harness(src);
  for (let i = 0; i < 20; i++) h4.D.store({ at: 1000 + i, events: [], killers: [] });
  assert.equal(h4.D.list().length, 20, name + '：先铺满 20 条');
  const base = h4.st.setCalls;
  h4.st.fail = 2;
  let threw = false, ok = null;
  try { ok = h4.D.store({ at: 9999, events: [], killers: [] }); } catch (e) { threw = true; }
  assert.equal(threw, false, name + '：写盘异常绝不能抛出去');
  assert.equal(ok, false, name + '：两次写盘都失败时要如实回报失败');
  assert.equal(h4.st.setCalls - base, 2, name + '：容量满必须丢最旧后再重试一次（总共两次写）');
  h4.st.fail = 1;
  assert.equal(h4.D.store({ at: 9998, events: [], killers: [] }), true, name + '：第一次失败后重试必须成功');
  const after = h4.D.list();
  assert.equal(after[0].at, 9998, name + '：重试成功后新记录仍在最前');
  assert.equal(after.length, 19, name + '：容量满时丢的是最旧那条');
}
test('V2.38.17 ② 死亡记录：同一次死亡只产 1 条、条数/事件上限、写盘异常不抛（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Record(src, name);
});

// ---------- ③ 静态结构：独立键不进同步键表/档案、模块与浮窗登记齐全 ----------
function v17Static(src, name) {
  const s = lf15(src);
  const kv = /  var KV_KEYS = \[([^\]]*)\];/.exec(s);
  assert.ok(kv, name + '：必须还能找到本机同步键表');
  assert.ok(!kv[1].includes('dsh_ro_deathlog_v1'), name + '：记录键绝不能进同步键表');
  const uses = (s.match(/dsh_ro_deathlog_v1/g) || []).length;
  assert.equal(uses, 1, name + '：记录键只允许出现在它自己的声明处（不得进角色档等其它结构）');
  assert.ok(s.includes('var DLOG_KEY = "dsh_ro_deathlog_v1";'), name + '：缺独立键声明');
  assert.ok(s.includes('{ id:"deathlog", name:"死亡回放", kind:"fw", sec:"战斗辅助" }'), name + '：功能菜单必须登记死亡回放');
  assert.ok(s.includes('fwReg("deathlog", "死亡回放", dlogEnsureHost)'), name + '：必须走标准浮窗登记');
  assert.ok(s.includes('"dsh-fw-deathlog"') && s.includes('"dsh-deathlog-dock"'), name + '：缺浮窗宿主与停靠点');
  assert.ok(s.includes('"dsh-deathlog-list"') && s.includes('"dsh-deathlog-detail"'), name + '：缺历史列表与详情容器');
  assert.ok(s.includes('document.getElementById("dsh-win-fw-" + id)'), name + '：窗口沿用标准浮窗容器命名');
  assert.ok(s.includes('charId: cid, name: nm, key: key,'), name + '：记录必须带角色 ID / 角色名 / 档键');
  assert.ok(s.includes('map: map, mapCn: mapCn, x: x, y: y, hp: hp, hpMax: hpMax, sp: sp,'), name + '：记录必须带地图 / 坐标 / 血量');
  assert.ok(s.includes('DSHCollect.ringPush(__dshDeathEvt, ev, DLOG_RING_MAX)'), name + '：事件必须走统一环形缓冲');
  assert.ok(s.includes('var DLOG_RING_MAX = 400, DLOG_MAX_ITEMS = 20, DLOG_MAX_EVENTS = 120;'), name + '：三个上限必须写死');
  assert.equal((s.match(/localStorage\.setItem\(DLOG_KEY/g) || []).length, 1, name + '：记录键只允许有一处写入口');
  assert.ok(s.includes('masterTickReg(function () { try { dlogSample(); } catch (e) {} });'), name + '：1 秒采样必须挂在主循环上');
  assert.ok(s.includes('try { dlogReset("切换角色"); } catch (eDL) {}'), name + '：换角色必须复位');
  assert.ok(s.includes('try { dlogOnDamage(pkt); } catch (e0b) {}'), name + '：伤害记录必须并列挂在已有回调里');
  assert.equal((s.match(/nm\.hookPacket = function/g) || []).length, 1, name + '：不得为死亡回放再叠一层回调包装');
  assert.ok(s.includes('if (op === 0x80) dlogOnVanish(bytes);'), name + '：死亡瞬间必须走通知主路径');
  assert.ok(s.includes('if (DPS_PKTS.indexOf(op) >= 0) dlogOnRawDamage(bytes, op);'), name + '：原始伤害帧必须无条件记录');
  // 文案自检：窗口里每一句玩家可见文字都不得出现实现词 / 中英夹杂 / 表情符号
  const dl = s.slice(s.indexOf('  // ================= V2.38.17 死亡回放（文字型'), s.indexOf('  // ================= V2.38.17 死亡回放 END ================='));
  const lits = [];
  let mm;
  const re1 = /'(\\.|[^'\\\n])*'/g;
  while ((mm = re1.exec(dl))) lits.push(mm[0].slice(1, -1));
  const re2 = /"(\\.|[^"\\\n])*"/g;
  while ((mm = re2.exec(dl))) lits.push(mm[0].slice(1, -1));
  let seen = 0;
  for (const raw of lits) {
    const txt = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[\u4e00-\u9fa5]/.test(txt)) continue;
    seen++;
    assert.ok(!/发包|客户端|字段|接口|请求/.test(txt), name + '：窗口文案不得出现实现词：' + txt);
    assert.ok(!/[A-Za-z]/.test(txt), name + '：窗口文案不得中英夹杂：' + txt);
    assert.ok(!/[\uD83C-\uD83E\u2600-\u27BF]/.test(txt), name + '：窗口文案不得带表情符号：' + txt);
  }
  assert.ok(seen >= 60, name + '：文案自检必须真的扫到足够多的玩家可见文字（实际 ' + seen + '）');
}
test('V2.38.17 ③ 死亡回放静态结构：独立键不进同步键表与角色档、模块与浮窗登记齐全（两文件）', () => {
  for (const [name, src] of splitSources) v17Static(src, name);
});

// ---------- ④ 技能名未命中留编号、无图走首字色块、onerror 分支 ----------
function v17SkillAvatar(src, name) {
  const h = v17Harness(src, { names: { 77: '腐尸' } });
  h.st.t = 1000000; h.D.setCfg(true, 3);
  h.D.push({ t: 999500, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 0, sk: null, dmg: 120, cnt: 1 });
  h.D.push({ t: 999600, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 5, sk: '怒雷强击', dmg: 200, cnt: 2 });
  h.D.push({ t: 999700, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 60666, sk: null, dmg: 80, cnt: 1 });
  const rec = h.D.build(1000000, 'skill');
  const k = rec.killers[0];
  assert.equal(k.dmg, 400, name + '：同一只怪的伤害要合并');
  assert.equal(k.segs, 3, name + '：段数按记录条数算');
  assert.equal(k.hits, 4, name + '：下数按每段次数累加');
  const by = {}; for (let i = 0; i < k.skills.length; i++) by[k.skills[i].skid] = k.skills[i];
  assert.equal(by[5].name, '怒雷强击', name + '：收录的技能名要显示');
  assert.equal(by[60666].skid, 60666, name + '：没收录的技能必须留下编号');
  assert.equal(by[60666].name, null, name + '：技能名未命中写编号且名字为 null');
  assert.equal(h.D.sktext(0, null), '普攻', name + '：没有法术编号的一律显示普攻');
  assert.equal(h.D.sktext(60666, null), '技能60666', name + '：没收录的技能显示技能加编号');
  const fb = { style: { display: 'none' } };
  const img = { style: { display: '' }, parentNode: { querySelector: () => fb } };
  assert.equal(h.D.fallback(img), true, name + '：头像取不到必须回退首字色块');
  assert.equal(img.style.display, 'none', name + '：头像取不到必须把图藏起来');
  assert.equal(fb.style.display, 'flex', name + '：头像取不到必须亮出首字色块');
  const noMid = h.D.avhtml(0, '腐尸');
  assert.equal(noMid.includes('<img'), false, name + '：无图怪不得出现图片节点');
  assert.ok(noMid.includes('腐'), name + '：无图怪必须显示名字首字');
  const withMid = h.D.avhtml(1002, '腐尸');
  assert.ok(withMid.includes('<img') && withMid.includes('/1002.png'), name + '：有编号的怪才走图源');
  assert.ok(h.D.avsrc(1002).indexOf('127.0.0.1:8898') >= 0, name + '：头像必须沿用既有图源');
  const fb2 = { style: { display: 'none' } };
  const im2 = { style: { display: '' }, parentNode: { querySelector: () => fb2 }, complete: false, naturalWidth: 0 };
  assert.equal(h.D.wire({ querySelectorAll: () => [im2] }), 1, name + '：每个头像都要接上失败分支');
  assert.equal(typeof im2.onerror, 'function', name + '：头像必须有失败回调');
  im2.onerror();
  assert.equal(fb2.style.display, 'flex', name + '：无图必须走首字色块分支');
}
test('V2.38.17 ④ 技能名未命中留编号名字为 null、无图走首次色块与失败回调（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17SkillAvatar(src, name);
});

// ---------- ⑤ 弹出冷却：同一次死亡只弹 1 次、冷却内不重复弹 ----------
function v17Pop(src, name) {
  const h = v17Harness(src);
  h.D.setCfg(true, 3);
  assert.equal(h.D.maybePop(1000000), true, name + '：第一次死亡应当弹出');
  assert.equal(h.D.maybePop(1001000), false, name + '：冷却内不得重复弹');
  assert.equal(h.D.maybePop(1002000), false, name + '：冷却内不得重复弹（第二次）');
  assert.equal(h.st.fwOpenCalls, 1, name + '：冷却内只弹 1 次');
  assert.equal(h.D.maybePop(1006000), true, name + '：冷却满 5 秒后可以再弹');
  assert.equal(h.st.fwOpenCalls, 2, name + '：冷却满 5 秒后才会第二次弹');
  const h2 = v17Harness(src); h2.D.setCfg(false, 3);
  assert.equal(h2.D.maybePop(1000000), false, name + '：关掉自动弹出后不得弹');
  assert.equal(h2.st.fwOpenCalls, 0, name + '：关掉自动弹出后零弹窗');
  const h3 = v17Harness(src, { fwOpenFail: true });
  h3.D.setCfg(true, 3);
  let threw = false;
  try { h3.D.maybePop(1000000); } catch (e) { threw = true; }
  assert.equal(threw, false, name + '：窗口没建起来也绝不能抛');
  assert.ok(h3.st.diag.indexOf('deathlog-pop-fail') >= 0, name + '：窗口没建起来必须写诊断日志');
  const h4 = v17Harness(src);
  h4.D.setCfg(true, 3);
  h4.st.t = 1000000;
  h4.D.onVanish(V17_FRAME);
  h4.st.t = 1000100; h4.D.onVanish(V17_FRAME);
  h4.ent.isDeath = true; h4.st.t = 1000200; h4.D.tick();
  assert.equal(h4.D.list().length, 1, name + '：同一次死亡三条触发路径只产 1 条');
  assert.equal(h4.st.fwOpenCalls, 1, name + '：同一次死亡只弹 1 次');
  h4.st.t = 1003400; h4.ent.isDeath = false; h4.ent.life.hp = 700; h4.D.tick();
  h4.st.t = 1003800; h4.ent.isDeath = true; h4.ent.life.hp = 0; h4.D.tick();
  assert.equal(h4.D.list().length, 2, name + '：3.4 秒后的第二次死亡要产第 2 条');
  assert.equal(h4.st.fwOpenCalls, 1, name + '：冷却内不得再弹');
  h4.st.t = 1011000; h4.ent.isDeath = false; h4.ent.life.hp = 700; h4.D.tick();
  h4.st.t = 1011400; h4.ent.isDeath = true; h4.ent.life.hp = 0; h4.D.tick();
  assert.equal(h4.D.list().length, 3, name + '：第三次死亡产第 3 条');
  assert.equal(h4.st.fwOpenCalls, 2, name + '：冷却过后才允许再弹');
}
test('V2.38.17 ⑤ 死亡回放弹出冷却：冷却内不重复弹、同一次死亡只弹 1 次（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Pop(src, name);
});

// ---------- ⑥ 模块关闭：不记录、不弹窗、不写盘 ----------
function v17Off(src, name) {
  const h = v17Harness(src, { modOn: false });
  h.st.t = 1000000;
  assert.equal(h.D.onDamage({ GID: 77, targetGID: 4242, damage: 500, count: 1 }), false, name + '：模块关闭时伤害不得进环');
  assert.equal(h.D.onRaw(new Uint8Array(23).buffer, 139), false, name + '：模块关闭时原始伤害帧不得进环');
  assert.equal(h.D.onVanish(V17_FRAME), false, name + '：模块关闭时死亡不得记录');
  h.ent.isDeath = true; h.ent.life.hp = 0;
  assert.equal(h.D.tick(), false, name + '：模块关闭时兜底不得记录');
  assert.equal(h.D.sample(), false, name + '：模块关闭时采样必须直接返回');
  assert.equal(h.D.hatch('off'), false, name + '：模块关闭时记录入口必须直接返回');
  assert.equal(h.D.ring().length, 0, name + '：模块关闭时事件环必须为空');
  assert.equal(h.D.list().length, 0, name + '：模块关闭时必须零写盘');
  assert.equal(h.ls.size, 0, name + '：模块关闭时不得写任何本地键');
  assert.equal(h.st.fwOpenCalls, 0, name + '：模块关闭时不得弹窗');
}
test('V2.38.17 ⑥ 死亡回放模块关闭时零记录零写盘零弹窗（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Off(src, name);
});

// ---------- ⑦ 换角色复位 ----------
function v17Reset(src, name) {
  const h = v17Harness(src);
  h.st.t = 1000000;
  h.D.push({ t: 999000, k: 'dmg', src: 77, tg: 4242, dmg: 10, cnt: 1 });
  h.D.push({ t: 998000, k: 'dmg', src: 77, tg: 4242, dmg: 20, cnt: 1 });
  assert.equal(h.D.ring().length, 2, name + '：事件先入环');
  assert.equal(h.D.onVanish(V17_FRAME), true, name + '：死亡必须产出一条记录');
  assert.equal(h.D.list().length, 1, name + '：死亡记录已落盘');
  assert.equal(h.D.reset('切换角色'), true, name + '：复位必须返回成立');
  assert.equal(h.D.ring().length, 0, name + '：换角色必须清空事件环');
  h.st.t = 1000100;
  assert.equal(h.D.onVanish(V17_FRAME), true, name + '：换角色后去重标志必须复位（新角色第一次死亡仍要记录）');
  assert.equal(h.D.list().length, 2, name + '：换角色后仍能追加新记录');
}
test('V2.38.17 ⑦ 死亡回放换角色复位：清空事件环与去重标志（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Reset(src, name);
});

// ---------- ⑧ 分派主路径：死亡通知与原始伤害帧的调用点 ----------
function v17DispatchHarness(src) {
  const s = lf15(src);
  const a = '  function dispatchInboundFrame(bytes, op, frameOff, lenTblOk) {';
  const b = '  function onSelfSpirits(bytes, frameOff, lenTblOk) {';
  assert.equal(s.split(a).length - 1, 1, '单帧分派函数锚点必须唯一');
  const i = s.indexOf(a), j = s.indexOf(b, i);
  assert.ok(i >= 0 && j > i, '单帧分派函数切段失败');
  const calls = [];
  const ctx = {
    Number, String, Math, Object, JSON, isFinite, parseInt, DataView,
    identityPktHook: () => {}, gearPktHook: () => {}, bagPktHook: () => {}, worldPktHook: () => {},
    tpOnAck: () => {}, collectOpStat: () => {}, itipPktProbe: () => {}, blockMcHit: () => {},
    DPS_PKTS: [138, 139, 737, 2248, 276, 478], dpsParsedSeen: false,
    dpsOnRawDamage: (b2, o) => calls.push('dps:' + o),
    dlogOnRawDamage: (b2, o) => calls.push('dlog:' + o),
    scrOnRawVanish: () => calls.push('scr'),
    dlogOnVanish: () => calls.push('van'),
    onMenuList: () => {}, onSayDialog: () => {}, onCloseDialog: () => {},
    onSkillPostDelay: () => {}, onSkillAck3: () => {}, onSelfSpirits: () => {}, itipShopPkt: () => {}, onRawOpcode: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(s.slice(i, j) + ';this.dispatch=dispatchInboundFrame;', ctx);
  return { ctx, calls };
}
function v17Dispatch(src, name) {
  const h = v17DispatchHarness(src);
  h.ctx.dispatch(V17_FRAME, 0x80, 0, true);
  assert.ok(h.calls.indexOf('van') >= 0, name + '：死亡帧必须走服务器通知主路径（不许只留每秒兜底）');
  assert.ok(h.calls.indexOf('scr') >= 0, name + '：原有击杀统计必须保持');
  h.calls.length = 0;
  h.ctx.dpsParsedSeen = true;
  h.ctx.dispatch(new Uint8Array(23).buffer, 139, 0, true);
  assert.equal(h.calls.indexOf('dps:139'), -1, name + '：已就绪后旧的原始伤害统计口径不变');
  assert.ok(h.calls.indexOf('dlog:139') >= 0, name + '：死亡回放必须无条件记下原始伤害帧（补齐 139 的漏）');
}
test('V2.38.17 ⑧ 死亡回放分派主路径：死亡通知与原始伤害帧（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Dispatch(src, name);
});

// ---------- ⑨ 时间线 + 诚实边界 ----------
function v17Timeline(src, name) {
  const h = v17Harness(src, { names: { 77: '腐尸' } });
  h.D.setCfg(true, 3);
  h.D.push({ t: 997000, k: 'hp', hp: 800, sp: 100, map: 'pay_fild01', x: 1, y: 2 });
  h.D.push({ t: 998000, k: 'hp', hp: 300, sp: 90, map: 'pay_fild01', x: 1, y: 2 });
  h.D.push({ t: 998100, k: 'st', id: 5, name: '中毒', neg: true, rem: 4000 });
  h.D.push({ t: 998500, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 5, sk: '怒雷强击', dmg: 250, cnt: 1 });
  h.D.push({ t: 999000, k: 'dmg', src: 77, tg: 4242, mid: 1002, name: '腐尸', skid: 0, sk: null, dmg: 50, cnt: 1 });
  h.ent.life.hp = 0;
  const rec = h.D.build(1000000, 'timeline');
  assert.equal(rec.total, 300, name + '：总受击伤害');
  assert.equal(rec.top.gid, 77, name + '：最大来源');
  assert.equal(rec.last.dmg, 50, name + '：补最后一刀');
  assert.equal(rec.last.skid, 0, name + '：最后一刀是普攻');
  assert.equal(rec.hp, 300, name + '：死亡瞬间的血量取最近一次采样');
  const rows = h.D.timeline(rec);
  assert.equal(rows.length, 2, name + '：时间线只列受击');
  assert.equal(rows[0].dt, 1.5, name + '：距死亡秒数按死亡时刻倒推');
  assert.equal(rows[0].hp, 300, name + '：时间线要带当时的血量');
  assert.equal(rows[0].sts.length, 1, name + '：时间线要带当时的在身状态');
  assert.equal(rows[0].sts[0].name, '中毒', name + '：状态中文名');
  assert.equal(rec.debuffs.length, 1, name + '：致死时刻的负面状态');
  assert.equal(rec.debuffs[0].id, 5, name + '：负面状态编号');
  assert.equal(rec.debuffs[0].neg, true, name + '：负面状态必须标成负面');
  assert.equal(rec.debuffs[0].rem, 4000, name + '：负面状态剩余时间');
  const honest = h.D.honest({ span: 3 });
  for (const need of ['普攻', '技能', '色块', '每秒采样', '3 秒']) assert.ok(honest.indexOf(need) >= 0, name + '：诚实边界必须写清楚（' + need + '）');
  assert.ok(h.D.honest({ span: 5 }).indexOf('5 秒') >= 0, name + '：诚实边界要跟着回放时长');
}
test('V2.38.17 ⑨ 死亡回放时间线与诚实边界（两文件 VM）', () => {
  for (const [name, src] of splitSources) v17Timeline(src, name);
});

// ---------- ⑩ 变异矩阵：每个变异必须被指定断言杀死 ----------
const V23817_MUTS = [
  { tag: 'M1 去掉死亡通知主路径只留每秒兜底',
    from: '      if (op === 0x80) dlogOnVanish(bytes); // V2.38.17：死亡瞬间主路径',
    to: '      // 变异：去掉死亡通知主路径，只留每秒兜底',
    expect: '死亡帧必须走服务器通知主路径', verify: v17Dispatch },
  { tag: 'M2 原始伤害帧被「已就绪」挡住',
    from: '      if (DPS_PKTS.indexOf(op) >= 0) dlogOnRawDamage(bytes, op); // V2.38.17：按模块开关无条件记录原始伤害帧（补齐 139 的漏）',
    to: '      if (DPS_PKTS.indexOf(op) >= 0 && !dpsParsedSeen) dlogOnRawDamage(bytes, op); // 变异',
    expect: '无条件记下原始伤害帧', verify: v17Dispatch },
  { tag: 'M3 去掉同一次死亡去重',
    from: '      if (dlogDeathAt && now - dlogDeathAt < DLOG_DEATH_GAP) return false; // 同一次死亡只产一条记录',
    to: '      // 变异：不判同一次死亡',
    expect: '同一次死亡再次通知不得重复产记录', verify: v17Record },
  { tag: 'M4 记录键混进本机同步键表',
    from: '"dsh_ro_casttrace"];',
    to: '"dsh_ro_casttrace", "dsh_ro_deathlog_v1"];',
    expect: '记录键绝不能进同步键表', verify: v17Static },
  { tag: 'M5 头像失败不回退首字色块',
    from: '      im.style.display = "none"; // 头像取不到 → 藏图、亮首字色块（服务没启动也不报错）',
    to: '      throw new Error("变异：不回退首字色块");',
    expect: '头像取不到必须回退首字色块', verify: v17SkillAvatar },
  { tag: 'M6 条数上限失效',
    from: '      if (db.items.length > DLOG_MAX_ITEMS) db.items.length = DLOG_MAX_ITEMS; // 条数上限：只留最新 20 条',
    to: '      // 变异：条数上限失效',
    expect: '条数上限 20', verify: v17Record },
  { tag: 'M7 事件上限失效',
    from: '      if (evOut.length > DLOG_MAX_EVENTS) evOut = evOut.slice(evOut.length - DLOG_MAX_EVENTS); // 事件上限：只留最新的 120 条',
    to: '      // 变异：事件上限失效',
    expect: '单条事件上限 120', verify: v17Record },
  { tag: 'M8 回放时长之外的事件没被剔除',
    from: '        if (ev.t < from) continue;              // 回放时长之外的事件一律剔除',
    to: '        if (false) continue; // 变异',
    expect: '只保留回放时长内的事件', verify: v17Ring },
  { tag: 'M9 模块开关被忽略',
    from: '      if (!roModOn("deathlog")) return false; // 模块关闭：不采样',
    to: '      if (false) return false; // 变异：忽略模块开关',
    expect: '模块关闭时采样必须直接返回', verify: v17Off },
  { tag: 'M10 弹出冷却失效',
    from: '      if (dlogPopAt && now - dlogPopAt < DLOG_POP_GAP) return false; // 弹出冷却不少于 5 秒',
    to: '      // 变异：弹出冷却失效',
    expect: '冷却内不得重复弹', verify: v17Pop },
];
test('V2.38.17 ⑩ 变异矩阵：10 个变异在 stable/exp 上必须各自被「指定断言」杀死', () => {
  for (const m of V23817_MUTS) {
    for (const [name, src] of splitSources) {
      const mutated = M23813(src, m.from, m.to);
      const v = v17Catch(() => m.verify(mutated, name + '·' + m.tag));
      const killed = v.ok === false;
      V23817_MATRIX.push({ tag: m.tag + '@' + name, desc: m.tag, expected: '红', actual: killed ? '红' : '绿', caught: killed ? v17Msg(v.e) : '未被抓（变异存活）' });
      assert.ok(killed, m.tag + '@' + name + '：变异必须让对应用例变红（' + m.tag + '）');
      assert.match(v17Msg(v.e), new RegExp(m.expect), m.tag + '@' + name + '：必须被「指定断言」抓到，实际=' + v17Msg(v.e));
    }
  }
  assert.equal(V23817_MATRIX.length, V23817_MUTS.length * splitSources.length, '每个变异 × 两文件都要独立真跑一次');
  assert.ok(V23817_MATRIX.every((r) => r.actual === '红'), '不得存在变异存活行');
  console.log('[V2.38.17 变异矩阵] ' + V23817_MATRIX.length + ' 条全部为红：' + V23817_MATRIX.map((r) => r.tag).join(', '));
  if (process.env.V23817_JSON) fs.writeFileSync(process.env.V23817_JSON, JSON.stringify(V23817_MATRIX, null, 2), 'utf8');
});
