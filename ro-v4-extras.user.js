// ==UserScript==
// @name         RO v4.47 功能包（挑战/追怪巡查/换箭/回车/推送/白素贞）
// @namespace    dsh.ro-v4-extras
// @version      1.0.0
// @description  v4.47 独立功能包（除背包清理外全部）：无限挑战·初级（自动找喵达人循环+pushplus推送）、原生追怪/初级副本巡查（1518白素贞识别）、MVP 换箭（按Boss自动换箭矢）、重复进入（回车+确认循环）。各功能为可拖动浮窗，独立于 ro-assist；开启追怪/挑战前建议先关闭助手自动战斗或寻怪。安装后自动注册进助手「系统」页扩展列表。
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // 通用工具（自包含，不依赖 ro-assist）
  // ============================================================
  function requireDB(name) { try { if (!window.require) return null; return window.require(name); } catch (e) { return null; } }
  function clientReady() {
    try {
      if (!window.require) return false;
      if (!CLIENT.SS) CLIENT.SS = window.require("Engine/SessionStorage");
      if (!CLIENT.NM) CLIENT.NM = window.require("Network/NetworkManager");
      if (!CLIENT.PS) CLIENT.PS = window.require("Network/PacketStructure");
      return !!(CLIENT.SS && CLIENT.NM && CLIENT.NM.sendPacket && CLIENT.PS);
    } catch (e) { return false; }
  }
  function getMapName() {
    try {
      if (!CLIENT.MR) CLIENT.MR = window.require && window.require("Renderer/MapRenderer");
      var cur = CLIENT.MR && CLIENT.MR.currentMap;
      return cur || "";
    } catch (e) { return ""; }
  }
  var _mobDbCache = null;
  function getMobDb() {
    try {
      if (!_mobDbCache) _mobDbCache = requireDB("DB/Mobs/mob_db");
      if (!_mobDbCache) {
        var DB = CLIENT.DB || requireDB("DB/DBManager");
        if (DB && DB.mob_db) _mobDbCache = DB.mob_db;
        else if (DB && DB.MobDB) _mobDbCache = DB.MobDB;
      }
      return _mobDbCache;
    } catch (e) { return null; }
  }
  function getMobName(mid) {
    try {
      var mob = getMobDb();
      var m = mob && mob[mid];
      return (m && (m.kName || m.name)) || null;
    } catch (e) { return null; }
  }
  function getItemName(itemid) {
    try {
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      if (!DB || typeof DB.getItemInfo !== "function") return null;
      var info = DB.getItemInfo(itemid);
      return (info && (info.identifiedDiSPlayName || info.name)) || null;
    } catch (e) { return null; }
  }
  // 移动：挑战/追怪共用（服务器寻路，一次 REQUEST_MOVE 到目标）
  var moveXY = { busy: false };
  function walkToXY(x, y, cb) {
    try {
      if (!clientReady()) return false;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) return false;
      var p = new CLIENT.PS.CZ.REQUEST_MOVE();
      p.dest = [Math.floor(x), Math.floor(y)];
      CLIENT.NM.sendPacket(p);
      moveXY.busy = true;
      var t0 = Date.now();
      var iv = setInterval(function () {
        try {
          var e = CLIENT.SS && CLIENT.SS.Entity;
          var done = false;
          if (e && e.position) { var d = Math.max(Math.abs(e.position[0] - x), Math.abs(e.position[1] - y)); if (d <= 2) done = true; }
          if (done || Date.now() - t0 > 25000) { clearInterval(iv); moveXY.busy = false; try { if (cb) cb(); } catch (e2) {} }
        } catch (e3) { clearInterval(iv); moveXY.busy = false; }
      }, 400);
      return true;
    } catch (e) { return false; }
  }
  function stopWalkXY() {
    try {
      moveXY.busy = false;
      if (clientReady()) {
        var ent = CLIENT.SS.Entity;
        if (ent && ent.position) {
          var p = new CLIENT.PS.CZ.REQUEST_MOVE();
          p.dest = [Math.floor(ent.position[0]), Math.floor(ent.position[1])];
          CLIENT.NM.sendPacket(p);
        }
      }
    } catch (e) {}
  }
  // 简化寻路：目标格不可走则取 8 邻域最近可行格；返回 {x,y,n=距角色格数}（服务器自行走路径）
  var _altCache = null;
  function _gatWalkable(x, y) {
    try {
      if (!_altCache) _altCache = requireDB("Renderer/Map/Altitude");
      var g = _altCache && _altCache.getGat && _altCache.getGat();
      if (!g || !g.cells || !g.types || !g.types.WALKABLE) return null;
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) return false;
      return !!(g.cells[x + y * g.width] & g.types.WALKABLE);
    } catch (e) { return null; }
  }
  function pathFindTo(x, y) {
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      var px = ent && ent.position ? Math.floor(ent.position[0]) : Math.floor(x);
      var py = ent && ent.position ? Math.floor(ent.position[1]) : Math.floor(y);
      x = Math.floor(x); y = Math.floor(y);
      var tx = x, ty = y;
      if (_gatWalkable(x, y) === false) {
        var best = null, bd = 1e9;
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          if (_gatWalkable(x + dx, y + dy) === true) { var d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = [x + dx, y + dy]; } }
        }
        if (!best) return null;
        tx = best[0]; ty = best[1];
      }
      return { x: tx, y: ty, n: Math.max(Math.abs(tx - px), Math.abs(ty - py)) };
    } catch (e) { return null; }
  }
  // 背包读取（换箭用）：补 type 字段（弹药=10）
  function bagCleanInventory() {
    try {
      var list = null;
      try {
        if (!CLIENT.UI) CLIENT.UI = window.require && window.require("UI/UIManager");
        var UM = CLIENT.UI;
        if (UM) {
          var cands = ["BasicInventory", "Inventory", "ItemInfo"];
          for (var c = 0; c < cands.length; c++) {
            var inst = null;
            try { if (typeof UM.get === "function") inst = UM.get(cands[c]); } catch (e) {}
            if (!inst && UM.components) inst = UM.components[cands[c]] || null;
            if (!inst && UM.instance && UM.instance.components) inst = UM.instance.components[cands[c]] || null;
            if (inst && Array.isArray(inst.list) && inst.list.length && inst.list[0] && typeof inst.list[0] === "object" && ("ITID" in inst.list[0] || "itemid" in inst.list[0])) { list = inst.list; break; }
          }
        }
      } catch (e) {}
      if (!list && CLIENT.SS) {
        var keys = Object.keys(CLIENT.SS);
        for (var i = 0; i < keys.length; i++) {
          var v = CLIENT.SS[keys[i]];
          if (v && typeof v === "object" && Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && ("ITID" in v[0] || "itemid" in v[0])) { list = v; break; }
        }
      }
      if (!list || !list.length) return [];
      return list.map(function (it) {
        var o = { ITID: it.ITID != null ? it.ITID : it.itemid, index: it.index != null ? it.index : (typeof it.i === "number" ? it.i : null), count: it.count != null ? it.count : it.amount, type: it.type };
        if (o.type == null) {
          try {
            var DB = CLIENT.DB || requireDB("DB/DBManager");
            var info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(o.ITID);
            o.type = info && (info.type != null ? info.type : info.ItemType);
          } catch (e) {}
        }
        return o;
      }).filter(function (o) { return o.ITID != null; });
    } catch (e) { return []; }
  }
  // 背包清理占位（挑战/换箭引用；本功能包不含背包清理，enabled=false 自然短路）
  var bagClean = { busy: false, hold: null, enabled: false, pending: false, error: "" };
  function bagCleanExecute(cb) { try { if (cb) cb(); } catch (e) {} }
  var lastTalkNpc = {};
  var npHuntOn = false; // 内挂自动战斗跟踪（挑战恢复战斗用）
  function npIsThree() { return false; } // 本功能包按二转指令包处理（NOTIFY_UPDATEINFO id=34）
  var zRunning = false; // ro-assist 助手战斗标志（独立脚本读不到，保持 false；开启追怪前请手动关闭助手战斗）
  var bookRouteRun = false;

  // ============================================================
  // 模块 A：无限挑战 + pushplus + 重复进入 + 浮窗拖拽
  // ============================================================
// 提取自 RO助手 v4.47（@version 2.9.1-mvp.4.47）源文档
// ============ 无限挑战（初级）+ pushplus 推送（challengeRun/challengePush 全量） ============
  // ---------------- 无限挑战（初级） ----------------
  var challengeRun = { on:false, phase:"idle", round:0, monsters:"—", left:"—", timer:null, npc:null, dialogTimer:null, lastDone:0 };
  // CHALLENGE_PUSH_START
  var challengePush = { enabled:false, token:'', busy:false, status:null, lastTest:0 };
  function challengePushStatus(text) { if(challengePush.status) challengePush.status.textContent=text; }
  async function challengePushSend(message, test) {
    var state=challengePush;
    if(!test&&!state.enabled)return false;
    if(state.busy)return false;
    if(!state.token.trim()){challengePushStatus('请先填写 pushplus Token');return false;}
    if(test&&Date.now()-state.lastTest<10000){challengePushStatus('测试间隔至少10秒');return false;}
    if(test)state.lastTest=Date.now();
    state.busy=true;challengePushStatus('正在提交手机提醒…');
    var controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},12000);
    try{
      var response=await fetch('https://www.pushplus.plus/send',{
        method:'POST',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:state.token.trim(),channel:'app',template:'txt',
          title:test?'无限挑战：手机 / 手表测试':'无限挑战：剩余不足一分钟',content:message})
      });
      if(!response.ok){challengePushStatus('推送接口 HTTP '+response.status+'，请稍后手动测试');return false;}
      var result=await response.json();
      if(Number(result.code)!==200){challengePushStatus('推送未受理，错误码 '+String(result.code)+'；请在 pushplus 检查账号和额度');return false;}
      challengePushStatus('pushplus 已受理，请检查手机 / 手表（不代表已送达）');return true;
    }catch(error){
      challengePushStatus('提交结果未确认：网络、跨域限制或超时；请检查 pushplus 历史消息');return false;
    }finally{clearTimeout(timeout);state.busy=false;}
  }
  function challengePushInit(box) {
    var panel=document.createElement('details');panel.style.cssText='margin-top:4px;font-size:11px;flex-shrink:0';
    panel.innerHTML='<summary style="cursor:pointer">手机 / WATCH 5 提醒</summary>'+
      '<label><input data-enable type="checkbox">启用手机推送</label>'+
      '<input data-token type="password" autocomplete="off" placeholder="填写 pushplus Token" aria-label="pushplus Token" style="width:100%;box-sizing:border-box;margin:4px 0">'+
      '<button data-test>发送测试提醒</button><div data-result style="color:#ffca70;margin-top:3px">Token 保存在本浏览器当前游戏网址；清空输入框可删除。</div>';
    box.appendChild(panel);challengePush.status=panel.querySelector('[data-result]');
    try{challengePush.token=localStorage.getItem('dsh-pushplus-token-v1')||'';}catch(ignore){}
    panel.querySelector('[data-token]').value=challengePush.token;
    panel.querySelector('[data-token]').oninput=function(){challengePush.token=this.value.trim();try{if(challengePush.token)localStorage.setItem('dsh-pushplus-token-v1',challengePush.token);else localStorage.removeItem('dsh-pushplus-token-v1');challengePushStatus(challengePush.token?'Token 已保存到本机':'Token 已清除');}catch(e){challengePushStatus('浏览器禁止存储：Token 仅本次有效');}};
    panel.querySelector('[data-enable]').onchange=function(){challengePush.enabled=this.checked;challengePushStatus(this.checked?'已启用：剩余≤60秒且还有怪，每轮一次':'手机推送已关闭');};
    panel.querySelector('[data-test]').onclick=function(){challengePushSend('这是游戏助手测试通知。如果 WATCH 5 同步收到提醒，手机推送配置已完成。',true);};
  }
  // CHALLENGE_PUSH_END
  function challengeInit() {
    var box=document.createElement("div"), head=document.createElement("div"), body=document.createElement("div"), title=document.createElement("span"), btn=document.createElement("button"), info=document.createElement("div");
    box.id="dsh-infinite-challenge"; box.style.cssText="position:fixed;left:12px;bottom:12px;z-index:2147483644;width:205px;min-width:180px;min-height:40px;max-width:100vw;max-height:100vh;padding:6px;color:#eff7ff;background:rgba(20,31,49,.55);border:1px solid #8298b066;border-radius:8px;font:11px/1.4 sans-serif;text-shadow:0 1px 3px #000;display:flex;flex-direction:column;resize:both;overflow:hidden";
    head.style.cssText="display:flex;align-items:center;gap:6px;cursor:move;user-select:none;touch-action:none"; title.textContent="无限挑战·初级 ⠿"; title.style.flex="1"; btn.style.cssText="background:#304765aa;color:#fff;border:1px solid #8298b066;border-radius:4px;padding:2px 6px;cursor:pointer"; head.appendChild(title); head.appendChild(btn);
    body.style.cssText="display:flex;flex-direction:column;gap:4px;margin-top:5px"; info.style.cssText="color:#c6def9;white-space:pre-line";
    var status=document.createElement("div"); status.textContent="关闭"; status.style.cssText="font-size:10px;color:#ffd58a";
    body.appendChild(info); body.appendChild(status); box.appendChild(head); box.appendChild(body); document.body.appendChild(box);
    var alpha=document.createElement("input"); alpha.type="range"; alpha.min=0;alpha.max=100;alpha.value=55;alpha.title="透明度";alpha.style.width="70px";head.appendChild(alpha); alpha.oninput=function(){box.style.background="rgba(20,31,49,"+(Number(alpha.value)/100)+")";};
    function render(){ btn.textContent=challengeRun.on?"停止":"开始"; body.hidden=!challengeRun.on; info.textContent=challengeRun.on?("轮次："+(challengeRun.round||"准备中")+"\n怪物："+challengeRun.monsters+"\n剩余："+challengeRun.left):"点击开始后自动寻找白猫(99,107)"; status.textContent=challengeRun.phase||"关闭"; }
    challengeRun.render=render; render();
    btn.onclick=function(){ if(challengeRun.on){ challengeStop(); } else { challengeUnlockAudio(); challengeStart(); } render(); };
    var alarmButton=document.createElement("button"),alarmInfo=document.createElement("div");
    alarmButton.textContent="启用声音 / 桌面提醒";
    alarmButton.style.cssText="font:10px sans-serif;color:#d9edff;background:#30476588;border:1px solid #8298b066;border-radius:4px;cursor:pointer;padding:3px";
    alarmInfo.id="dsh-challenge-alert";alarmInfo.style.cssText="font-size:10px;color:#ffca70";
    alarmInfo.textContent="剩余≤1分钟且未清怪：每轮提醒一次";
    box.appendChild(alarmButton);box.appendChild(alarmInfo);
    challengePushInit(box);
    var stop100=document.createElement('label');stop100.innerHTML='<input type="checkbox">完成第100轮后暂停（领奖前）';
    try{challengeRun.stopAt100=localStorage.getItem('dsh-challenge-stop100')==='1';}catch(ignore){}
    stop100.firstChild.checked=!!challengeRun.stopAt100;
    stop100.firstChild.onchange=function(){challengeRun.stopAt100=this.checked;try{localStorage.setItem('dsh-challenge-stop100',this.checked?'1':'0');}catch(ignore){}};box.appendChild(stop100);
    alarmButton.onclick=function(){
      challengeUnlockAudio();challengeBeep();
      if(typeof Notification!=="undefined"&&Notification.permission==="default"){
        Notification.requestPermission().then(function(permission){alarmInfo.textContent=permission==="granted"?"声音与桌面提醒已启用":"声音提醒已启用；桌面通知未获允许";}).catch(function(){alarmInfo.textContent="声音提醒已启用；桌面通知不可用";});
      }else alarmInfo.textContent=typeof Notification!=="undefined"&&Notification.permission==="granted"?"声音与桌面提醒已启用":"声音提醒已启用；桌面通知不可用";
    };
    var drag=null; head.onpointerdown=function(e){if(e.target===btn||e.target===alpha||e.button!==0)return;var r=box.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,l:r.left,t:r.top};head.setPointerCapture(e.pointerId);};head.onpointermove=function(e){if(!drag)return;box.style.left=drag.l+e.clientX-drag.x+"px";box.style.top=drag.t+e.clientY-drag.y+"px";};head.onpointerup=head.onpointercancel=function(){drag=null;};
    challengeUiTick=setInterval(function(){if(challengeRun.on){challengeDriveDialog();challengeScanAnnouncement();}},600);
  }
  function challengeSet(text){ challengeRun.phase=text; try{if(challengeRun.render)challengeRun.render();}catch(e){} }
  var challengeAudio=null;
  function challengeUnlockAudio(){
    try{var Audio=window.AudioContext||window.webkitAudioContext;if(!challengeAudio&&Audio)challengeAudio=new Audio();if(challengeAudio&&challengeAudio.state==="suspended")challengeAudio.resume().catch(function(){});}catch(ignore){}
  }
  function challengeBeep(){
    try{
      if(!challengeAudio||challengeAudio.state!=="running")return;
      for(var i=0;i<3;i++){
        var tone=challengeAudio.createOscillator(),volume=challengeAudio.createGain(),at=challengeAudio.currentTime+i*0.45;
        tone.frequency.value=880;volume.gain.setValueAtTime(0,at);volume.gain.linearRampToValueAtTime(0.15,at+0.02);volume.gain.linearRampToValueAtTime(0,at+0.3);
        tone.connect(volume);volume.connect(challengeAudio.destination);tone.start(at);tone.stop(at+0.32);
        tone.onended=(function(t,g){return function(){t.disconnect();g.disconnect();};})(tone,volume);
      }
    }catch(ignore){}
  }
  function challengeCheckAlert(remaining){
    if(!challengeRun.on||remaining>60||remaining<0||challengeRun.alertIssued||challengeRun.monsters==="0 只"||challengeRun.monsters==="完成")return;
    challengeRun.alertIssued=true;
    var message="第"+(challengeRun.round||"?")+"轮，剩余"+remaining+"秒，怪物："+challengeRun.monsters+"。请手动检查漏怪。";
    var tip=document.getElementById("dsh-challenge-alert");if(tip)tip.textContent="⚠ "+message;
    challengeBeep();
    if(parseInt(challengeRun.monsters,10)>0)challengePushSend(message,false);
    try{if(typeof Notification!=="undefined"&&Notification.permission==="granted")new Notification("无限挑战：剩余不足一分钟",{body:message,tag:"dsh-challenge-minute",requireInteraction:true});}catch(ignore){}
  }
  function challengeStop(){ challengeRun.on=false; challengeRun.lookupGeneration=(challengeRun.lookupGeneration||0)+1; challengeBattlePending=null; challengeUiWaiting=false; challengeRun.phase="已停止"; if(challengeRun.timer)clearInterval(challengeRun.timer); if(challengeRun.dialogTimer)clearTimeout(challengeRun.dialogTimer); challengeRun.timer=null; challengeRun.dialogTimer=null; try{stopWalkXY();}catch(e){} if(challengeRun.render)challengeRun.render(); }
  function challengeStart(){ if(!clientReady()){challengeSet("客户端未就绪");return;} challengeRun.patrolActive=false;challengeRun.patrolStartPending=false;challengeRun.rewardPending=false;challengeRun.rewardClosedAt=0; challengeRun.on=true; challengeRun.lookupGeneration=(challengeRun.lookupGeneration||0)+1; challengeBattlePending=null; challengeMessageRecent={}; challengeRun.phase="寻找白猫…"; challengeRun.round=0; challengeRun.monsters="—"; challengeRun.left="—"; challengeRun.npc=null; challengeRun.lastDone=0; challengeRun.resumeBattle=false; challengeRun.battleReceipt=null; challengeRun.deadline=null; challengeRun.alertIssued=false; challengeRun.chatBaseline=false; challengeScanAnnouncement(); challengeGoNpc(); }
  function challengePickNpc(entities, playerPosition) {
    var named = [], nearAnchor = [];
    entities.forEach(function (entity) {
      if (!challengeIsNpc(entity)) return;
      var labels = [entity.displayName, entity.name, entity.display && entity.display.name].map(function (value) {
        return challengeNpcName(value);
      });
      var anchorDistance = Math.abs(entity.position[0]-99) + Math.abs(entity.position[1]-107);
      if (labels.some(function (name) { return name === "喵达人" || name === "白猫"; })) named.push(entity);
      // 只在所有名称字段都未加载时使用位置兜底，不把其他有名 NPC 当成白猫。
      else if (labels.every(function (name) { return !name || /^\d+$/.test(name); }) && anchorDistance <= 5) nearAnchor.push(entity);
    });
    function distance(entity) { return playerPosition ? Math.abs(entity.position[0]-playerPosition[0])+Math.abs(entity.position[1]-playerPosition[1]) : Math.abs(entity.position[0]-99)+Math.abs(entity.position[1]-107); }
    named.sort(function (a,b) { return distance(a)-distance(b); });
    return named[0] || (nearAnchor.length === 1 ? nearAnchor[0] : null);
  }
  function challengeNpcName(value){
    return String(value||"").replace(/\^[0-9a-f]{6}/gi,"").replace(/<[^>]*>/g,"").replace(/\[[^\]]*\]|【[^】]*】/g,function(part){return /喵[达達]人|白猫/.test(part)?part.slice(1,-1):"";}).split("#")[0].replace(/[\s\u0000-\u001f\u200b-\u200f\ufeff]/g,"").replace(/達/g,"达");
  }
  function challengeIsNpc(entity){
    if(!entity||!entity.position||!isFinite(entity.position[0])||!isFinite(entity.position[1]))return false;
    var gid=Number(entity.GID),type=Number(entity.objecttype),ctor=entity.constructor||{};
    if(!isFinite(gid)||gid===0||gid < -2147483648||gid>4294967295)return false;
    return type===6||type===12||(typeof ctor.TYPE_NPC==="number"&&type===ctor.TYPE_NPC)||(typeof ctor.TYPE_NPC2==="number"&&type===ctor.TYPE_NPC2);
  }
  function challengeFindNpc(){
    try{
      var entities=[],EM=window.require("Renderer/EntityManager"),me=CLIENT.SS.Entity;
      EM.forEach(function(e){entities.push(e);});
      var result=challengePickNpc(entities,me&&me.position);
      var nearby=entities.filter(challengeIsNpc).sort(function(a,b){
        var p=me&&me.position||[99,107];return Math.abs(a.position[0]-p[0])+Math.abs(a.position[1]-p[1])-Math.abs(b.position[0]-p[0])-Math.abs(b.position[1]-p[1]);
      });
      challengeRun.npcCandidates=nearby.slice(0,6).map(function(e){return {name:String(e.display&&e.display.name||e.name||e.displayName||"未加载名称"),type:e.objecttype,gid:e.GID,x:Math.floor(e.position[0]),y:Math.floor(e.position[1])};});
      if(!result){
        var requests=challengeRun.nameRequests||(challengeRun.nameRequests={}),sent=0,now=Date.now();
        Object.keys(requests).forEach(function(key){if(now-requests[key]>60000)delete requests[key];});
        nearby.forEach(function(e){
          var p=me&&me.position||[99,107],distance=Math.abs(e.position[0]-p[0])+Math.abs(e.position[1]-p[1]);
          var key=String(getMapName())+":"+String(e.GID);
          if(distance>25||sent>=3||(requests[key]&&now-requests[key]<10000))return;
          if(CLIENT.PS.CZ.REQNAME){var packet=new CLIENT.PS.CZ.REQNAME();packet.AID=e.GID;CLIENT.NM.sendPacket(packet);requests[key]=now;sent++;}
        });
      }
      return result;
    }catch(e){challengeRun.npcScanError=String(e.message||e);return null;}
  }
  function challengeContact(npc){
    if(!challengeRun.on)return;
    try{
      var p=new CLIENT.PS.CZ.CONTACTNPC();p.NAID=npc.GID;p.type=1;
      challengeRun.npc=npc;
      challengeRun.battleReceipt=null;
      lastTalkNpc={GID:npc.GID,name:npc.name||npc.displayName||"喵达人",pos:[npc.position[0],npc.position[1]]};
      CLIENT.NM.sendPacket(p);challengeSet("已点击喵达人，等待挑战菜单…");
    }catch(e){challengeSet("对话失败："+e.message);}
  }
  function challengeGoNpc(attempt){
    if(!challengeRun.on)return;
    if(bagClean.busy)return;
    if(bagClean.hold){
      if(bagClean.hold.run===challengeRun.lookupGeneration)return;
      bagClean.hold=null;bagClean.error='';
    }
    if(bagClean.enabled && (challengeRun.monsters==="0 只" || challengeRun.monsters==="完成") && bagClean.pending){
      bagCleanExecute(function(){challengeGoNpc(attempt);});return;
    }
    attempt=Number(attempt)||0;
    var n=challengeFindNpc();
    if(!n){
      challengeRun.npc=null;
      var anchorMe=CLIENT.SS.Entity,anchorMap=getMapName();
      if(/(^|[/\\])pvp_n_1-5(?:\.(?:gat|rsw))?$/i.test(String(anchorMap))&&anchorMe&&anchorMe.position&&
         Math.max(Math.abs(anchorMe.position[0]-99),Math.abs(anchorMe.position[1]-107))>3){
        if(moveXY.busy)return;
        var anchorGeneration=challengeRun.lookupGeneration;
        challengeSet('本轮结束，返回中央寻找喵达人(99,107)…');
        if(walkToXY(99,107,function(){
          if(challengeRun.on&&challengeRun.lookupGeneration===anchorGeneration&&getMapName()===anchorMap)challengeGoNpc(0);
        }))return;
      }
      var candidates=challengeRun.npcCandidates||[],hint=candidates.slice(0,2).map(function(e){return e.name+"("+e.x+","+e.y+")";}).join(" / ");
      challengeSet("查找喵达人：自动重试中"+(hint?"；已读到 "+hint:"；等待 NPC 实体加载"));
      if(challengeRun.timer)clearTimeout(challengeRun.timer);
      var generation=challengeRun.lookupGeneration;
      challengeRun.timer=setTimeout(function(){challengeRun.timer=null;if(challengeRun.on&&challengeRun.lookupGeneration===generation)challengeGoNpc(attempt+1);},attempt<5?1000:3000);
      return;
    }
    challengeRun.npc=n;
    var me=CLIENT.SS.Entity,d=me&&me.position?Math.abs(n.position[0]-me.position[0])+Math.abs(n.position[1]-me.position[1]):99;
    if(d<=2){challengeContact(n);return;}
    var map=getMapName(),walkGeneration=challengeRun.lookupGeneration;
    challengeSet("已识别喵达人，走向("+Math.floor(n.position[0])+","+Math.floor(n.position[1])+")…");
    if(!walkToXY(n.position[0],n.position[1],function(){
      if(!challengeRun.on||challengeRun.lookupGeneration!==walkGeneration||getMapName()!==map)return;
      var live=challengeFindNpc();
      if(live)challengeContact(live);else challengeGoNpc(0);
    }))challengeSet("已找到喵达人，但无法启动走路");
  }
  // 对话操作只通过已显示的原生按钮；不再由正文关键词直接发送协议包。
  function challengeMenu() {}
  var challengeUiTick = null, challengeUiLast = 0, challengeUiWaiting = false;
  function challengeChooseOption(options) {
    var normalized = options.map(function (text) { return String(text).replace(/\^[0-9a-f]{6}/gi, "").replace(/\s/g, ""); });
    var rules = [/^初级(?:挑战)?$/, /^继续挑战$/, /^开始挑战$/, /^领取奖励$/, /^(确认|确定|是|好的)$/];
    for (var r=0;r<rules.length;r++) {
      var matches=[];
      normalized.forEach(function (text,index) { if(rules[r].test(text))matches.push(index); });
      if(matches.length===1)return matches[0];
    }
    return -1;
  }
  function challengeDriveDialog() {
    if(!challengeRun.on||!challengeRun.npc||Date.now()-challengeUiLast<800)return;
    try {
      var box=requireDB("UI/Components/NpcBox/NpcBox"), menu=requireDB("UI/Components/NpcMenu/NpcMenu");
      if(!box||!box.ui||!box.ui.is(":visible")){
        challengeUiWaiting=false;
        if(menu&&menu.ui&&menu.ui.is(":visible"))return;
        if(challengeRun.rewardPending){
          challengeRun.resumeBattle=false;
          if(!challengeRun.rewardClosedAt){challengeRun.rewardClosedAt=Date.now();return;}
          if(Date.now()-challengeRun.rewardClosedAt<1500)return;
          challengeRun.rewardPending=false;challengeRun.rewardClosedAt=0;
          challengeBattlePending=null;
          if(challengeRun.timer){clearTimeout(challengeRun.timer);challengeRun.timer=null;}
          challengeRun.lookupGeneration=(challengeRun.lookupGeneration||0)+1;
          challengeRun.round=0;challengeRun.lastDone=0;challengeRun.monsters="—";
          challengeRun.deadline=null;challengeRun.left="—";challengeRun.alertIssued=false;
          challengeSet("领奖对话已结束，重新找喵达人开启初级挑战…");
          challengeGoNpc();return;
        }
        if(challengeRun.resumeBattle){challengeRun.resumeBattle=false;if(challengeRun.patrolStartPending){challengeRun.patrolStartPending=false;challengeRun.patrolActive=true;}challengeResumeBattle();}
        return;
      }
      var text=box.ui.find(".content").text();
      if(!/喵达人/.test(text))return;
      challengeRun.rewardClosedAt=0;
      challengeRun.resumeBattle=true;
      var hasMenu=menu&&menu.ui&&menu.ui.is(":visible");
      var next=box.ui.find(".next"), close=box.ui.find(".close");
      var ready=hasMenu||next.is(":visible")||close.is(":visible");
      if(!ready){challengeUiWaiting=false;return;}
      if(challengeUiWaiting)return;
      if(hasMenu){
        var rows=menu.ui.find(".content div"), options=[];
        rows.each(function(){options.push(this.textContent||"");});
        var index=challengeChooseOption(options);
        if(index<0){if(challengeRun.phase!=="未知挑战选项，请手动选择后继续")challengeSet("未知挑战选项，请手动选择后继续");return;}
        challengeUiLast=Date.now();challengeUiWaiting=true;
        if(/^领取奖励$/.test(String(options[index]).replace(/\^[0-9a-f]{6}/gi,"").replace(/\s/g,""))){
          challengeRun.patrolActive=false;challengeRun.patrolStartPending=false;challengeRun.rewardPending=true;challengeRun.rewardClosedAt=0;
          challengeBattlePending=null;
        }
        if(/^(继续挑战|开始挑战)$/.test(String(options[index]).replace(/\s/g,"")))challengeRun.patrolStartPending=true;
        rows.eq(index).trigger("mousedown");
        menu.ui.find(".ok").trigger("click");
        if(!menu.ui.is(":visible"))challengeUiWaiting=false;
        challengeSet("已选择："+options[index]);
      }else if(next.is(":visible")){
        challengeUiLast=Date.now();challengeUiWaiting=true;
        next.trigger("click");
        if(!next.is(":visible"))challengeUiWaiting=false;
        challengeSet("已点击下面，等待服务器对话…");
      }else if(close.is(":visible")){
        challengeUiLast=Date.now();challengeUiWaiting=true;
        close.trigger("click");
        if(!box.ui.is(":visible"))challengeUiWaiting=false;
        challengeSet("对话结束，等待挑战公告…");
      }
    }catch(e){if(challengeRun.phase!=="对话处理失败："+e.message)challengeSet("对话处理失败："+e.message);}
  }
  var challengeChatHooked=false, challengeChatSeen=new WeakMap(), challengeMessageRecent={}, challengeBattlePending=null;
  function challengeReadBattle(){
    if(challengeRun.battleReceipt===true)return true;
    var controls=requireDB("Preferences/Controls");
    var checkbox=document.querySelector('#vbk input.openattack[type="checkbox"]');
    if(checkbox&&checkbox.checked)return true;
    if(controls&&controls.autoattack===true)return true;
    if(controls&&typeof controls.autoattack==="boolean")return controls.autoattack;
    return checkbox?!!checkbox.checked:null;
  }
  function challengeResumeBattle(){
    if(!challengeRun.on)return;
    if(!challengeBattlePending)challengeBattlePending={sent:false,since:Date.now()};
    challengeCheckBattle();
  }
  function challengeCheckBattle(){
    if(!challengeRun.on){challengeBattlePending=null;return;}
    if(!challengeBattlePending)return;
    try{
      var pending=challengeBattlePending,controls=requireDB("Preferences/Controls");
      var box=requireDB("UI/Components/NpcBox/NpcBox"),menu=requireDB("UI/Components/NpcMenu/NpcMenu");
      var dialogOpen=(controls&&controls.talk)||(box&&box.ui&&box.ui.is(":visible"))||(menu&&menu.ui&&menu.ui.is(":visible"));
      if(dialogOpen){
        if(Date.now()-pending.since>12000){challengeBattlePending=null;challengeSet("对话状态未结束，暂未恢复战斗");}
        return;
      }
      var real=challengeReadBattle();
      if(real===true){npHuntOn=true;challengeBattlePending=null;challengeSet("内挂自动战斗已确认开启");return;}
      if(pending.sent){
        if(Date.now()-pending.since>8000){challengeBattlePending=null;challengeSet("战斗指令已发，状态未同步；以游戏为准");}
        return;
      }
      if(real===null){challengeBattlePending=null;challengeSet("无法读取内挂状态，请打开内挂窗口");return;}
      if(!clientReady()){challengeBattlePending=null;challengeSet("客户端未就绪，未发送战斗指令");return;}
      var packet;
      if(npIsThree()){packet=new CLIENT.PS.CZ.WHISPER();packet.receiver="NPC:setautoattack";packet.msg="0";}
      else {packet=new CLIENT.PS.CZ.NOTIFY_UPDATEINFO();packet.id=34;packet.value=1;}
      pending.sent=true;pending.since=Date.now();
      CLIENT.NM.sendPacket(packet);
      challengeSet("已发送内挂战斗指令，等待服务器确认…");
    }catch(e){challengeBattlePending=null;challengeSet("恢复内挂失败："+e.message);}
  }
  function challengeObserveMessage(message){
    if(!challengeRun.on)return;
    var text=String(message||"").replace(/<[^>]*>/g," ").replace(/\^[0-9a-f]{6}/gi,"").trim();
    if(!text)return;
    var now=Date.now();
    // 同一广播同时经过聊天和屏幕公告入口，只消费一次。
    if(challengeMessageRecent.text===text&&now-challengeMessageRecent.at<250)return;
    challengeMessageRecent={text:text,at:now};
    challengeHandleAnnouncement(text);
  }
  function challengeInstallMessageHooks(){
    function wrap(object,key){
      if(!object||typeof object[key]!=="function")return false;
      if(object[key].__dshChallengeObserve)return true;
      var original=object[key];
      var hook=function(message){
        var result=original.apply(this,arguments);
        try{challengeObserveMessage(message);}catch(ignore){}
        return result;
      };
      hook.__dshChallengeObserve=true;object[key]=hook;return true;
    }
    var chat=requireDB("UI/Components/ChatBox/ChatBox"),announce=requireDB("UI/Components/Announce/Announce");
    var normal=wrap(chat,"addText"),broadcast=wrap(chat,"addText2"),screen=wrap(announce,"set");
    // 客户端部分版本把“开始自动战斗”回执显示在角色头顶。
    wrap(CLIENT.SS&&CLIENT.SS.Entity&&CLIENT.SS.Entity.dialog,"set");
    challengeChatHooked=broadcast||screen;
  }
  function challengeHandleAnnouncement(message){
    if(!challengeRun.on)return;
    var text=String(message||"").replace(/<[^>]*>/g," ").replace(/\^[0-9a-f]{6}/gi,"");
    if(/(?:开启|开始|打开)自动战斗/.test(text)){challengeRun.battleReceipt=true;npHuntOn=true;challengeSet("内挂自动战斗已确认开启");}
    else if(/关闭自动战斗/.test(text)){challengeRun.battleReceipt=false;npHuntOn=false;}
    var events=/第\s*(\d+)\s*轮[^\r\n]{0,30}?(?:还剩余?|剩余)\s*(\d+)\s*只|挑战时间\s*(?:还剩余?|剩余)\s*[:：]?\s*(\d+)\s*(分钟|分|秒)|完成第\s*(\d+)\s*轮挑战/g;
    var match,changed=false;
    while((match=events.exec(text))){
      if(match[1]){
        var round=Number(match[1]);
        if(round!==challengeRun.round){challengeRun.deadline=null;challengeRun.left="—";challengeRun.alertIssued=false;}
        challengeRun.round=round;challengeRun.monsters=Number(match[2])+" 只";challengeRun.patrolActive=Number(match[2])>0;
        if(challengeRun.lastDone!==round)challengeRun.lastDone=0;
        // 新一轮公告到达后，取消尚未发出的上一轮对话重试。
        if(Number(match[2])>0&&challengeRun.timer){clearTimeout(challengeRun.timer);challengeRun.timer=null;}
        changed=true;
      }else if(match[3]){
        challengeRun.deadline=Date.now()+Number(match[3])*(match[4]==="秒"?1000:60000);
        changed=true;
      }else{
        var done=Number(match[5]);challengeRun.patrolActive=false;challengeRun.patrolStartPending=false;challengeRun.round=done;challengeRun.monsters="0 只";challengeRun.deadline=null;challengeRun.left="—";changed=true;
        if(challengeRun.stopAt100&&done>=100){
          challengeStop();challengeSet('第'+done+'轮完成，已暂停（领奖前）；可手动领奖或点击开始');
          challengeBeep();challengePushSend('第'+done+'轮挑战已完成，脚本已暂停，等待手动领奖。',false);return;
        }
        if(challengeRun.lastDone!==done){
          challengeRun.lastDone=done;
          challengeSet("第"+done+"轮完成，准备继续挑战…");
          if(challengeRun.timer)clearTimeout(challengeRun.timer);
          challengeRun.timer=setTimeout(function(){challengeRun.timer=null;if(challengeRun.on)challengeGoNpc();},1000);
        }
      }
    }
    if(changed&&challengeRun.render)challengeRun.render();
  }
  function challengeScanAnnouncement(){
    if(!challengeRun.on)return;
    challengeInstallMessageHooks();
    // 聊天入口、广播入口和屏幕公告都未就绪时，才扫描原生窗口新增行。
    if(!challengeChatHooked){
      var rows=document.querySelectorAll("#chatbox p, .chatbox p, #Announce, #announce");
      for(var i=0;i<rows.length;i++){
        var row=rows[i],text=row.textContent||"",previous=challengeChatSeen.get(row);
        challengeChatSeen.set(row,text);
        if(challengeRun.chatBaseline&&previous!==text)challengeObserveMessage(text);
      }
      challengeRun.chatBaseline=true;
    }
    challengeCheckBattle();
    if(challengeRun.deadline){
      var remaining=Math.max(0,Math.ceil((challengeRun.deadline-Date.now())/1000));
      challengeRun.left=Math.floor(remaining/60)+":"+("0"+remaining%60).slice(-2)+(remaining===0?" 待确认":"");
      challengeCheckAlert(remaining);
    }
    if(challengeRun.render)challengeRun.render();
  }
  window.__dshChallenge={start:challengeStart,stop:challengeStop,state:function(){return JSON.parse(JSON.stringify(challengeRun));}};
  // MVP_TIMER_END

// ============ 重复进入浮窗（repeatEnterInit） ============
  function repeatEnterInit() {
    if (document.getElementById('dsh-repeat-enter')) return;
    var box = document.createElement('div'), timer = null, count = 0, clicked = null, nextAt = 0;
    box.id = 'dsh-repeat-enter';
    box.style.cssText = 'position:fixed;left:12px;bottom:16px;z-index:100000;padding:5px 7px;border:1px solid #71849c;border-radius:6px;background:rgba(15,28,45,.65);color:#e9f3ff;font:12px/1.5 sans-serif;';
    box.innerHTML = '<span data-handle style="cursor:move;touch-action:none">回车＋确认 ⋮⋮</span> <button data-toggle>开启</button> ' +
      '<input data-interval aria-label="循环间隔（秒）" type="number" value="1" min="1" max="30" step="0.1" style="width:45px"> 秒' +
      '<div data-status style="font-size:10px;color:#ffdc88">已关闭 · Esc 停止</div>';
    document.body.appendChild(box);
    var toggle = box.querySelector('[data-toggle]'), input = box.querySelector('[data-interval]'), status = box.querySelector('[data-status]');
    function stop() {
      if (timer !== null) clearInterval(timer);
      timer = null; clicked = null; nextAt = 0; toggle.textContent = '开启'; status.textContent = '已关闭 · Esc 停止';
    }
    function press() {
      if (timer === null) return;
      if(typeof bagClean!=='undefined'&&bagClean.busy){status.textContent='背包清理中，暂停回车';return;}
      if (Date.now() < nextAt) return;
      // 消息弹窗在断线和登录阶段也存在，不能被 clientReady 阻断。
      var visible = function (el) { return el && el.isConnected && el.getClientRects().length > 0; };
      if (clicked) {
        if (visible(clicked)) { status.textContent = '已点确认，等待弹窗关闭 · Esc 停止'; return; }
        clicked = null;
      }
      var popups = Array.from(document.querySelectorAll('#win_popup, #WinMSG, #WinError')).filter(visible);
      for (var pi = popups.length - 1; pi >= 0; pi--) {
        var popup = popups[pi], buttons = Array.from(popup.querySelectorAll('.btns button')).filter(visible);
        var ok = buttons.find(function (button) {
          var label = String(button.textContent || button.value || '').trim();
          var bg = String(button.getAttribute('data-background') || '') + ' ' + button.style.backgroundImage;
          try { bg += ' ' + window.require('Utils/jquery')(button).data('background'); } catch (ignore) {}
          return !button.disabled && (/^(确认|确定|OK)$/i.test(label) || /btn_ok(?:[_.]|$)/i.test(bg));
        });
        if (ok) {
          clicked = popup; nextAt = Date.now() + Math.max(1000, Number(input.value) * 1000);
          ok.click(); status.textContent = '已点击确认 · 等待下一轮'; return;
        }
      }
      if (popups.length) {
        status.textContent = popups.some(function (p) { return /请稍[候后]/.test(p.textContent); }) ?
          '请稍后，等待游戏响应 · Esc 停止' : '等待可识别的确认按钮 · Esc 停止';
        return;
      }
      var target = document.activeElement;
      if (target && (target.matches('input,textarea,select') || target.isContentEditable)) {
        status.textContent = '输入框获得焦点，暂停回车'; return;
      }
      // 只向游戏页面派发，不对本浮窗按钮触发默认点击。
      if (!target || box.contains(target)) target = document.body;
      try {
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
          var event = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            charCode: type === 'keypress' ? 13 : 0, bubbles: true, cancelable: true });
          if (event.keyCode !== 13) Object.defineProperty(event, 'keyCode', { get: function () { return 13; } });
          if (event.which !== 13) Object.defineProperty(event, 'which', { get: function () { return 13; } });
          target.dispatchEvent(event);
        });
        status.textContent = '运行中 · 已发出 ' + (++count) + ' 次 · Esc 停止';
        nextAt = Date.now() + Math.max(1000, Number(input.value) * 1000);
      } catch (e) { stop(); status.textContent = '回车派发失败，已停止'; }
    }
    function start() {
      stop(); count = 0;
      var value = Number(input.value);
      value = Number.isFinite(value) ? Math.max(1, Math.min(30, value)) : 1;
      input.value = value; toggle.textContent = '停止'; status.textContent = '运行中 · Esc 停止';
      timer = setInterval(press, 250);
    }
    toggle.onclick = function () { if (timer === null) start(); else stop(); toggle.blur(); };
    input.onchange = function () { if (timer !== null) start(); };
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && event.isTrusted) stop(); }, true);
    window.addEventListener('pagehide', stop);
    var handle = box.querySelector('[data-handle]'), drag = null;
    handle.onpointerdown = function (event) {
      if (event.button !== 0) return;
      drag = { x: event.clientX - box.offsetLeft, y: event.clientY - box.offsetTop };
      handle.setPointerCapture(event.pointerId); event.preventDefault();
    };
    handle.onpointermove = function (event) {
      if (!drag) return;
      box.style.bottom = 'auto';
      box.style.left = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, event.clientX - drag.x)) + 'px';
      box.style.top = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, event.clientY - drag.y)) + 'px';
    };
    handle.onpointerup = handle.onpointercancel = function () { drag = null; };
  }

// ============ 浮窗拖拽（movableDetails） ============
  function movableDetails(box,key){
    var saved={},drag=null,moved=false,saveTimer=null,fullHeight=null;
    try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch(ignore){}
    var header=box.querySelector('summary');
    header.style.cursor='move';header.style.touchAction='none';header.style.userSelect='none';
    header.title='拖动标题移动；点击展开/收起；展开后拖动右下角调整大小';
    box.style.boxSizing='border-box';box.style.minWidth='220px';box.style.maxWidth='100vw';box.style.maxHeight='90vh';
    if(Number.isFinite(saved.width))box.style.width=Math.max(220,Math.min(innerWidth,saved.width))+'px';
    if(Number.isFinite(saved.height))fullHeight=Math.max(100,Math.min(innerHeight*.9,saved.height));
    if(Number.isFinite(saved.left)&&Number.isFinite(saved.top)){
      box.style.right='auto';box.style.bottom='auto';box.style.left=saved.left+'px';box.style.top=saved.top+'px';
    }
    if(typeof saved.open==='boolean')box.open=saved.open;
    function clamp(){
      var rect=box.getBoundingClientRect();
      box.style.right='auto';box.style.bottom='auto';
      box.style.left=Math.max(0,Math.min(rect.left,innerWidth-rect.width))+'px';
      box.style.top=Math.max(0,Math.min(rect.top,innerHeight-rect.height))+'px';
    }
    function save(){
      clearTimeout(saveTimer);saveTimer=setTimeout(function(){
        var r=box.getBoundingClientRect();
        if(box.open)fullHeight=r.height;
        try{localStorage.setItem(key,JSON.stringify({left:r.left,top:r.top,width:r.width,height:fullHeight,open:box.open}));}catch(ignore){}
      },180);
    }
    function layout(){box.style.resize=box.open?'both':'none';box.style.minHeight=box.open?'100px':'0';box.style.height=box.open&&fullHeight?fullHeight+'px':'auto';clamp();}
    layout();
    box.addEventListener('toggle',function(event){if(event.target!==box)return;layout();save();});
    header.addEventListener('pointerdown',function(e){
      if(e.button!==0||e.target.closest('button,input,select,a'))return;
      var r=box.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};moved=false;
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove',function(e){
      if(!drag)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(!moved&&Math.abs(dx)+Math.abs(dy)<5)return;
      moved=true;box.style.left=drag.left+dx+'px';box.style.top=drag.top+dy+'px';clamp();
    });
    header.addEventListener('pointerup',function(){drag=null;save();});
    header.addEventListener('pointercancel',function(){drag=null;moved=false;save();});
    header.addEventListener('click',function(e){if(moved){e.preventDefault();e.stopPropagation();moved=false;}},true);
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(function(){clamp();save();}).observe(box);
    window.addEventListener('resize',function(){clamp();save();});
  }

  // ============================================================
  // 模块 B：原生追怪巡查 + MVP 换箭 + 1518 白素贞识别
  // ============================================================
  // NATIVE_CHASE_START — 只辅助走位，不修改内挂攻击或技能参数。
  var nativeChase = { on: false, idleAt: 0, lastSend: 0, position: "", player: null,
    blocked: {}, pending: null, target: null, ui: null,
    cfg: { range: 20, idle: 2, near: 3, opacity: 0.65 } };
  function nativeChaseClamp(value, min, max, fallback) {
    var n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  function nativeChaseStatus(text) {
    if (nativeChase.ui) {
      var el=nativeChase.ui.querySelector('[data-status]');
      var value=text+(nativeChase.on && nativeChase.source ? ' · ' + nativeChase.source : '');
      if(el.textContent!==value)el.textContent=value;
    }
  }
  function nativeChaseReadBattle(controls) {
    // 真实的开始/停止按钮优先，避免默认 false 覆盖正在运行的内挂。
    var buttons = document.querySelectorAll('.startButton');
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      if (!button.isConnected || !button.getClientRects().length) continue;
      var text = String(button.textContent || '').replace(/\s/g, '');
      if (/停止/.test(text)) return { on: true, source: '内挂按钮：停止' };
      if (/开始/.test(text)) return { on: false, source: '内挂按钮：开始' };
    }
    var checkbox = document.querySelector('#vbk input.openattack[type="checkbox"]');
    if (checkbox && checkbox.checked) return { on: true, source: '内挂勾选状态' };
    var value = controls && controls.autoattack;
    if (value === true || value === 1 || value === '1') return { on: true, source: '内挂运行标志' };
    return { on: false, source: '未取得开启状态，请展开内挂面板' };
  }
  function nativeChasePause(text, now) {
    nativeChase.idleAt = now; if(nativeChase.patrol)nativeChase.patrol.pending=null; nativeChase.pending = null; nativeChase.target = null; nativeChaseStatus(text);
  }
  // 本地掉落表中1518白素贞的MvpDropsNum为0，不能据此排除Boss。
  function nativeChaseIsBoss(mid,record){
    return Number(mid)===1518 || !!(record && record.MvpDropsNum>0);
  }
  function nativeChaseScan(ent) {
    // 独立复用助手侦查的 EntityManager、_job 和怪物名称库，不依赖助手战斗开关。
    var em = CLIENT.EM || requireDB('Renderer/EntityManager'), mobs = [], db = null;
    try { db = getMobDb(); } catch(ignore) {}
    em.forEach(function (mob) {
      if (!mob || mob.objecttype !== 5 || !mob.position ||
          mob.isDeath || (mob.ACTION && mob.action === mob.ACTION.DIE) || mob.remove_tick) return;
      var x = Number(mob.position[0]), y = Number(mob.position[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      var mid = mob._job != null ? mob._job : (mob.job != null ? mob.job : mob.mobId);
      var name = (mob.display && mob.display.name) || mob.displayName || mob.name || String(mid || mob.GID);
      try { name = getMobName(mid) || name; } catch (ignore) {}
      var isMvp = false;
      var record = db && db[mid]; isMvp = nativeChaseIsBoss(mid,record);
      mobs.push({ entity: mob, mid: mid, name: name, isMvp: isMvp, distance: Math.max(Math.abs(x - ent.position[0]), Math.abs(y - ent.position[1])) });
    });
    mobs.sort(function (a, b) { return a.distance - b.distance; });
    nativeChase.mobs = mobs;
    nativeChase.scanAt=Date.now();nativeChase.scanPlayer=ent;
    var list = nativeChase.ui && nativeChase.ui.querySelector('[data-mobs]');
    var signature=JSON.stringify([mobs.length,mobs.filter(function(m){return m.distance<=nativeChase.cfg.range;}).length,
      mobs.slice(0,8).map(function(m){return [m.name,Math.ceil(m.distance),m.isMvp,m.distance>nativeChase.cfg.range];})]);
    if (list && !document.hidden && list.getClientRects().length && list.dataset.signature!==signature) {
      list.dataset.signature=signature;
      list.textContent = '周边活怪 ' + mobs.length + ' · 范围内 ' + mobs.filter(function (m) { return m.distance <= nativeChase.cfg.range; }).length;
      mobs.slice(0, 8).forEach(function (m) {
        var row = document.createElement('div');
        if (m.isMvp) { row.style.color = '#ff6666'; row.style.fontWeight = 'bold'; row.title = 'MVP'; }
        row.textContent = m.name + ' · ' + Math.ceil(m.distance) + ' 格' +
          (m.distance > nativeChase.cfg.range ? '（超范围）' : '');
        list.appendChild(row);
      });
    }
    return mobs;
  }
  // 怪物所在格可能不可走；先走本格路径，再尝试周围8格。
  function nativeChasePath(mob, ent) {
    var x=Math.floor(mob.position[0]), y=Math.floor(mob.position[1]);
    var step=pathFindTo(x,y);
    if(step) return step;
    var candidates=[];
    for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){
      if(!dx&&!dy)continue;
      var p=pathFindTo(x+dx,y+dy);
      if(p)candidates.push(p);
    }
    candidates.sort(function(a,b){return a.n-b.n;});
    return candidates[0]||null;
  }
  // 巡查只读取当前地图真实可走格；每8格分区选点，不从截图推算坐标。
  function nativePatrolBuild(ent) {
    var alt=requireDB('Renderer/Map/Altitude'), g=alt&&alt.getGat&&alt.getGat();
    if(!g||!g.cells||!g.types||!g.types.WALKABLE)throw Error('地图通行数据未加载');
    var w=g.width,h=g.height,sx=Math.floor(ent.position[0]),sy=Math.floor(ent.position[1]);
    if(!(w>0&&h>0&&w*h<=1048576))throw Error('地图尺寸异常');
    function walk(x,y){return x>=0&&y>=0&&x<w&&y<h&&!!(g.cells[x+y*w]&g.types.WALKABLE);}
    if(!walk(sx,sy))throw Error('角色所在格暂不可走');
    var queue=[[sx,sy]],seen=new Set([sx+sy*w]),groups={};
    for(var head=0;head<queue.length;head++){
      if(head>=65536)throw Error('连通区域过大，暂停巡查');
      var cell=queue[head],x=cell[0],y=cell[1],bx=Math.floor(x/8),by=Math.floor(y/8),key=bx+','+by;
      var score=Math.abs(x-(bx*8+3.5))+Math.abs(y-(by*8+3.5));
      if(!groups[key]||score<groups[key].score)groups[key]={x:x,y:y,bx:bx,by:by,score:score};
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var nx=x+d[0],ny=y+d[1],id=nx+ny*w;
        if(walk(nx,ny)&&!seen.has(id)){seen.add(id);queue.push([nx,ny]);}
      });
    }
    // 连通可走区的最大矩形作为大厅，避免十字形侧厅把宽行阈值挤成中央窄条。
    var heights=new Array(w).fill(0),bestArea=0,left=sx,right=sx,bottom=sy,top=sy;
    for(var row=0;row<h;row++){
      for(var col=0;col<w;col++)heights[col]=seen.has(col+row*w)?heights[col]+1:0;
      var stack=[];
      for(var col=0;col<=w;col++){
        var height=col<w?heights[col]:0,start=col;
        while(stack.length&&stack[stack.length-1].height>height){
          var bar=stack.pop(),area=bar.height*(col-bar.start);start=bar.start;
          if(area>bestArea){bestArea=area;left=bar.start;right=col-1;bottom=row-bar.height+1;top=row;}
        }
        if(height&&(!stack.length||stack[stack.length-1].height<height))stack.push({start:start,height:height});
      }
    }
    // 四角只向内留1格，扩大覆盖；中央仅用于轮末返回NPC。
    var ix=Math.min(1,Math.floor((right-left)/2)),iy=Math.min(1,Math.floor((top-bottom)/2));
    var hall=queue.filter(function(p){return p[0]>=left&&p[0]<=right&&p[1]>=bottom&&p[1]<=top;});
    var result=[],used={};
    [[left+ix,top-iy],[right-ix,top-iy],[right-ix,bottom+iy],[left+ix,bottom+iy]].forEach(function(goal){
      var best=null,dist=Infinity;hall.forEach(function(p){var d=Math.abs(p[0]-goal[0])+Math.abs(p[1]-goal[1]);if(d<dist){best=p;dist=d;}});
      if(best&&!used[best.join(',')]){used[best.join(',')]=true;result.push({x:best[0],y:best[1]});}
    });
    return result;
  }
  function nativePatrolAllowed(map) {
    return /(^|[/\\])pvp_n_1-5(?:\.(?:gat|rsw))?$/i.test(String(map)) &&
      typeof challengeRun!=='undefined'&&challengeRun.on&&(challengeRun.patrolActive===true||parseInt(challengeRun.monsters,10)>0);
  }
  function nativePatrolTick(ent,now) {
    var s=nativeChase;
    if(!s.cfg.patrol)return nativeChaseStatus('扫描范围内无可追目标 · 巡查未开启');
    if(!nativePatrolAllowed(s.map))return nativeChaseStatus('巡查待命：仅限初级副本战斗轮');
    var round=challengeRun.round;
    if(!s.patrol||s.patrol.map!==s.map||s.patrol.round!==round){
      s.patrol={map:s.map,round:round,points:nativePatrolBuild(ent),index:0,lap:1,pending:null};
    }
    var p=s.patrol,points=p.points;
    if(!points.length)return nativeChaseStatus('未生成可走巡查点');
    var x=Math.floor(ent.position[0]),y=Math.floor(ent.position[1]),pos=x+','+y;
    if(p.pending){
      var q=p.pending;
      if(pos!==q.pos){q.pos=pos;q.at=now;}
      if(pos===q.dest)p.pending=null;
      else if(now-q.at>=3000){p.pending=null;p.index++;return nativeChaseStatus('巡查移动无进展，跳过此点');}
      else return nativeChaseStatus('巡查 '+(p.index+1)+'/'+points.length+' · 第'+p.lap+'圈');
    }
    if(now-s.lastSend<500)return nativeChaseStatus('巡查连续移动中');
    // 每个tick最多尝试3个点，避免持续不可达时大量寻路。
    for(var i=0;i<3;i++){
      if(p.index>=points.length){p.index=0;p.lap++;}
      var point=points[p.index];
      if(Math.max(Math.abs(x-point.x),Math.abs(y-point.y))<=2){p.index++;continue;}
      var step=pathFindTo(point.x,point.y);
      if(!step||!Number.isFinite(step.x)||!Number.isFinite(step.y)||step.x===x&&step.y===y){p.index++;continue;}
      var packet=new CLIENT.PS.CZ.REQUEST_MOVE();packet.dest=[step.x,step.y];
      s.lastSend=now;p.pending={pos:pos,dest:step.x+','+step.y,at:now};
      CLIENT.NM.sendPacket(packet);
      return nativeChaseStatus('巡查 '+(p.index+1)+'/'+points.length+' → ('+point.x+','+point.y+') · 第'+p.lap+'圈');
    }
    nativeChaseStatus('巡查点检查中，下一次继续');
  }
  function nativeChaseTick() {
    var s = nativeChase, now = Date.now();
    try {
      if (!clientReady()) { s.mobs = []; return nativeChasePause('等待进入游戏', now); }
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) return nativeChasePause('等待角色', now);
      // 扫描先于运行状态判断；关闭追怪也可查看周边怪物，不发送移动指令。
      var scanned = nativeChaseScan(ent);
      var controls = requireDB('Preferences/Controls');
      if (!s.on) return nativeChaseStatus('仅扫描 · 追怪已关闭');
      if(typeof bagClean!=='undefined'&&bagClean.busy)return nativeChasePause('背包清理中，暂停追怪',now);
      var map = typeof getMapName === 'function' ? getMapName() : '';
      if (s.player !== ent || s.map !== map) { s.player = ent; s.map = map; s.blocked = {}; s.position = ''; s.pending = null; s.target = null; s.lastSend = 0; s.patrol = null; }
      if(s.cfg.patrol&&!nativePatrolAllowed(map)){s.patrol=null;return nativeChasePause('巡查待命：仅在 pvp_n_1-5 初级挑战有剩余怪物时移动',now);}
      // 用户的辅助开关就是运行授权，不再被未同步的内挂标志阻断。
      s.source = '独立辅助';
      var dialogOpen = ['UI/Components/NpcBox/NpcBox', 'UI/Components/NpcMenu/NpcMenu'].some(function (id) {
        var mod = requireDB(id), el = mod && mod.ui && mod.ui[0];
        return el && el.isConnected && el.getClientRects().length > 0;
      });
      if ((controls && controls.talk) || dialogOpen || moveXY.busy || bookRouteRun || zRunning)
        return nativeChasePause((controls && controls.talk || dialogOpen) ? 'NPC对话中，暂停追怪' : moveXY.busy ? '坐标寻路占用，暂停追怪' : bookRouteRun ? '书本传送占用，暂停追怪' : '助手战斗运行中，暂停追怪', now);
      var pos = Math.floor(ent.position[0]) + ',' + Math.floor(ent.position[1]);
      if (s.position !== pos) {
        s.position = pos;
        if (s.pending) { s.pending.progressAt = now; s.pending.moved = true; }
      }
      // 只在确认闲置时介入，坐下、死亡、攻击、施法及行走均让位。
      if (!ent.ACTION || (ent.action !== ent.ACTION.IDLE && ent.action !== ent.ACTION.WALK) || (ent.cast && ent.cast.isCasting && ent.cast.isCasting()))
        return nativeChaseStatus('角色正在行动，交由内挂');
      if (s.pending && !scanned.some(function (m) { return m.entity.GID === s.pending.id; })) s.pending = null;
      // 到达短路径终点立即续走；无坐标进展3秒后换路，不因任何一步移动就丢失追踪。
      if (s.pending) {
        var p = s.pending;
        if (pos === p.dest || (p.moved && ent.action === ent.ACTION.IDLE)) s.pending = null;
        else if (now - p.progressAt >= 3000) {
          s.blocked[p.id] = now + 3000; s.pending = null; s.target = null;
        } else return nativeChaseStatus('正在靠近目标 · 等待坐标进展');
      }
      Object.keys(s.blocked).forEach(function (id) { if (s.blocked[id] <= now) delete s.blocked[id]; });
      var mobs = scanned.filter(function (m) { return m.distance <= s.cfg.range && !(s.blocked[m.entity.GID] > now); });
      if (s.target != null && !mobs.some(function (m) { return m.entity.GID === s.target; })) s.target = null;
      if (!mobs.length) return nativePatrolTick(ent,now);
      if(s.patrol)s.patrol.pending=null; // 发现目标，立即让追击接管移动
      var locked = mobs.find(function (m) { return m.entity.GID === s.target; });
      if (locked) mobs = [locked].concat(mobs.filter(function (m) { return m !== locked; }));
      s.target = mobs[0].entity.GID;
      if (now - s.lastSend < s.cfg.idle * 1000) return nativeChaseStatus('追击 ' + mobs[0].name + ' · 等待走位间隔');
      // 每轮最多检查三个目标，沿已有寻路器生成的路径走一小段。
      for (var i = 0; i < Math.min(mobs.length, 3); i++) {
        var mob = mobs[i].entity, step = nativeChasePath(mob, ent);
        // 近距离也必须有短路径，隔墙目标不能直接交接。
        if (step && mobs[i].distance <= s.cfg.near && step.n <= s.cfg.near + 1) {
          s.target = mob.GID;
          return nativeChaseStatus('已靠近：' + mobs[i].name + ' · 交由内挂攻击');
        }
        if (!step || !Number.isFinite(step.x) || !Number.isFinite(step.y)) {
          s.blocked[mob.GID] = now + 3000; continue;
        }
        if (step.x === Math.floor(ent.position[0]) && step.y === Math.floor(ent.position[1])) continue;
        var packet = new CLIENT.PS.CZ.REQUEST_MOVE(); packet.dest = [step.x, step.y];
        // 在发送前记录；发送失败也不会每个 tick 重复发包。
        s.target = mob.GID; s.lastSend = now; s.pending = { id: mob.GID, at: now, progressAt: now, moved: false, dest: step.x + ',' + step.y };
        CLIENT.NM.sendPacket(packet);
        nativeChaseStatus('追击 ' + mobs[i].name + ' · ' + Math.ceil(mobs[i].distance) + ' 格'); return;
      }
      s.idleAt = now; nativeChaseStatus('目标暂不可达，稍后重试');
    } catch (e) {
      nativeChasePause('追怪接口异常：' + String(e && e.message || e).slice(0,100), now);
    }
  }
  function nativeChaseInit() {
    if (nativeChase.ui) return;
    var s = nativeChase, saved = {};
    try { saved = JSON.parse(localStorage.getItem('dsh-native-chase-v1') || '{}') || {}; } catch (e) {}
    s.cfg.patrol = saved.patrol === true;
    s.cfg.range = nativeChaseClamp(saved.range, 5, 40, 20);
    s.cfg.idle = nativeChaseClamp(saved.idle, 0.5, 15, 0.5);
    s.cfg.near = nativeChaseClamp(saved.near, 1, 8, 3);
    s.cfg.opacity = nativeChaseClamp(saved.opacity, 0.1, 1, 0.65);
    var box = document.createElement('div'); s.ui = box;
    box.id = 'dsh-native-chase';
    box.style.cssText = 'position:fixed;left:12px;top:190px;width:218px;min-width:190px;max-width:95vw;max-height:90vh;resize:both;overflow:auto;z-index:99999;color:#e9f3ff;border:1px solid #71849c;border-radius:6px;font:12px/1.5 sans-serif;box-sizing:border-box;padding:6px;';
    box.innerHTML = '<div data-drag style="cursor:move;touch-action:none;display:flex;align-items:center;gap:6px"><b style="flex:1">内挂辅助追怪</b><button data-toggle>开启</button><button data-fold>−</button></div>' +
      '<div data-body><label>扫描范围 <input data-key="range" type="number" min="5" max="40" style="width:48px"> 格</label><br>' +
      '<label>走位间隔 <input data-key="idle" type="number" min="0.5" max="15" step="0.1" style="width:48px"> 秒</label><br>' +
      '<label>交给内挂 <input data-key="near" type="number" min="1" max="8" style="width:48px"> 格以内</label><br>' +
      '<label><input data-patrol type="checkbox">初级副本巡查（内挂设原地寻怪）</label><br>' +
      '<label>背景 <input data-key="opacity" type="range" min="0.1" max="1" step="0.05" style="width:125px"></label>' +
      '<div style="font-size:10px;color:#bbcadd">开启后独立追怪，不依赖内挂状态。<br>仅负责接近怪物，攻击与技能由内挂执行。<br>近战请将交接距离设为 1 格。刷新后默认关闭。</div>' +
      '<div data-mobs style="max-height:110px;overflow:auto;font-size:11px;border-top:1px solid #71849c;margin-top:4px">等待扫描周边怪物…</div></div>' +
      '<div data-status style="font-size:11px;color:#ffdc88">已关闭</div>';
    document.body.appendChild(box);
    function save() {
      try { localStorage.setItem('dsh-native-chase-v1', JSON.stringify(Object.assign({}, s.cfg, {
        left: box.offsetLeft, top: box.offsetTop, width: box.offsetWidth, height: box.offsetHeight, folded: folded
      }))); } catch (e) {}
    }
    function keepVisible() {
      box.style.left = Math.max(0, Math.min(box.offsetLeft, window.innerWidth - box.offsetWidth)) + 'px';
      box.style.top = Math.max(0, Math.min(box.offsetTop, window.innerHeight - 40)) + 'px';
    }
    var folded = !!saved.folded, fullHeight = saved.height;
    function fold() {
      box.querySelector('[data-body]').style.display = folded ? 'none' : '';
      box.querySelector('[data-fold]').textContent = folded ? '+' : '−';
      box.style.height = folded ? 'auto' : (fullHeight > 100 ? fullHeight + 'px' : 'auto');
      box.style.resize = folded ? 'none' : 'both';
    }
    if (Number.isFinite(saved.left)) box.style.left = saved.left + 'px';
    if (Number.isFinite(saved.top)) box.style.top = saved.top + 'px';
    if (Number.isFinite(saved.width)) box.style.width = Math.max(190, saved.width) + 'px';
    fold(); keepVisible();
    box.querySelectorAll('[data-key]').forEach(function (input) {
      var key = input.dataset.key; input.value = s.cfg[key];
      input.addEventListener('change', function () {
        s.cfg[key] = nativeChaseClamp(input.value, Number(input.min), Number(input.max), s.cfg[key]);
        input.value = s.cfg[key]; s.idleAt = Date.now(); paint(); save();
      });
      if (key === 'opacity') input.addEventListener('input', function () { s.cfg.opacity = Number(input.value); paint(); });
    });
    function paint() { box.style.background = 'rgba(15,28,45,' + s.cfg.opacity + ')'; }
    paint();
    box.querySelector('[data-patrol]').checked=s.cfg.patrol;
    box.querySelector('[data-patrol]').onchange=function(){s.cfg.patrol=this.checked;s.patrol=null;s.pending=null;save();};
    box.querySelector('[data-toggle]').onclick = function () {
      s.on = !s.on; s.idleAt = Date.now(); s.pending = null; s.blocked = {}; s.target = null; s.lastSend = 0; s.patrol=null;
      this.textContent = s.on ? '停止' : '开启'; nativeChaseStatus(s.on ? '已开启，扫描并追踪可达目标' : '已关闭');
    };
    box.querySelector('[data-fold]').onclick = function () {
      if (!folded) fullHeight = box.offsetHeight; folded = !folded; fold(); save();
    };
    var drag = null, handle = box.querySelector('[data-drag]');
    handle.onpointerdown = function (event) {
      if (event.target.closest('button') || event.button !== 0) return;
      drag = { x: event.clientX - box.offsetLeft, y: event.clientY - box.offsetTop };
      handle.setPointerCapture(event.pointerId); event.preventDefault();
    };
    handle.onpointermove = function (event) {
      if (!drag) return; box.style.left = event.clientX - drag.x + 'px'; box.style.top = event.clientY - drag.y + 'px'; keepVisible();
    };
    handle.onpointerup = handle.onpointercancel = function () { drag = null; save(); };
    box.addEventListener('pointerup', function () { if (!folded) fullHeight = box.offsetHeight; save(); });
    window.addEventListener('resize', keepVisible);
    setInterval(nativeChaseTick, 500);
  }
  // NATIVE_CHASE_END

  // ============ 以下为 MVP 换箭（依赖上方 nativeChase 的扫描） ============

  // ARROW_HELPER_START
  var arrowHelper={on:false,rules:{},target:null,seen:0,manual:null,pending:null,last:0,ui:null};
  function arrowKind(name){
    var names=[['火','火'],['水灵','水'],['风灵','风'],['地灵','地'],['水','水'],['风','风'],['地','地'],['无形','念'],['影子','暗'],['银','圣']];
    for(var i=0;i<names.length;i++)if(new RegExp('^'+names[i][0]+'(?:箭|箭矢)$').test(String(name).replace(/\s/g,'')))return names[i][1];
    return null;
  }
  function arrowScanned(){
    // 共用同一个扫描函数；追怪循环受其他模块阻断时，换箭可主动补齐扫描。
    if(!nativeChase.scanAt||Date.now()-nativeChase.scanAt>1000||nativeChase.scanPlayer!==CLIENT.SS.Entity){
      try{nativeChaseScan(CLIENT.SS.Entity);arrowHelper.scanError='';}catch(e){arrowHelper.scanError=String(e.message||e);return [];}
    }
    return (nativeChase.mobs||[]).filter(function(m){return m.mid!=null&&m.isMvp&&!m.entity.isDeath&&!m.entity.remove_tick&&!(m.entity.ACTION&&m.entity.action===m.entity.ACTION.DIE);}).map(function(m){return {e:m.entity,mid:m.mid,name:m.name};});
  }
  function arrowDeathCheck(){
    var s=arrowHelper,last=s.lastBoss;
    if(!s.on){s.lastBoss=null;s.returnSilver=false;return;}
    if(last&&(last.player!==CLIENT.SS.Entity||last.map!==getMapName())){s.lastBoss=null;s.returnSilver=false;return;}
    if(last&&(last.e.isDeath||(last.e.ACTION&&last.e.action===last.e.ACTION.DIE))){s.lastBoss=null;s.returnSilver=true;}
  }
  function arrowHistory(mobs){
    var s=arrowHelper,changed=false;
    var db=getMobDb();
    // 历史已确认的 Boss 记录不随当前数据库加载状态清除。
    mobs.forEach(function(m){if(!s.records[m.mid]||s.records[m.mid]!==m.name){s.records[m.mid]=m.name;changed=true;}});
    if(changed){try{localStorage.setItem('dsh-arrow-seen-v1',JSON.stringify(s.records));}catch(ignore){}s.historyDirty=true;}
    if(!s.historyDirty)return;
    var list=s.ui.querySelector('[data-history]');list.textContent='';
    Object.keys(s.records).forEach(function(mid){
      // 刚打开页面数据库可能尚未就绪，历史记录仍直接显示。
      var row=document.createElement('div'),label=document.createElement('span'),select=document.createElement('select');
      label.textContent=s.records[mid]+' #'+mid+' ';
      [['','不切换'],['火','火箭矢'],['水','水灵箭矢'],['风','风灵箭矢'],['地','地灵箭矢'],['念','无形箭矢'],['暗','影子箭矢'],['圣','银箭矢']].forEach(function(pair){var o=document.createElement('option');o.value=pair[0];o.textContent=pair[1];select.appendChild(o);});
      select.value=s.rules[mid]||'';select.onchange=function(){if(this.value)s.rules[mid]=this.value;else delete s.rules[mid];localStorage.setItem('dsh-arrow-rules-v1',JSON.stringify(s.rules));s.ui.querySelector('[data-rule]').dataset.mid='';};
      row.append(label,select);list.appendChild(row);
    });s.historyDirty=false;
  }
  function arrowRead(){
    var inv=bagCleanInventory()||[],equipment=requireDB('UI/Components/Equipment/Equipment');
    var slot=equipment&&equipment.ui&&equipment.ui.find('.ammo .item[data-index]');
    var index=slot&&slot.length?Number(slot.attr('data-index')):null;
    var equipped=index!=null&&equipment.getItemByIndex?equipment.getItemByIndex(index):null;
    var all=inv.slice();if(equipped&&!all.some(function(x){return x.index===equipped.index;}))all.push(equipped);
    return {index:index,items:all.filter(function(it){return it.type===10&&Number(it.count)>0&&Number.isInteger(it.index)&&arrowKind(getItemName(it.ITID));})};
  }
  function arrowTick(){
    var s=arrowHelper;if(!s.ui||!clientReady())return;
    if(!CLIENT.SS.Entity||!CLIENT.SS.Entity.position){s.ui.querySelector('[data-info]').textContent='等待进入游戏';return;}
    try{
      arrowDeathCheck();
      var mobs=arrowScanned();arrowHistory(mobs);
      var select=s.ui.querySelector('[data-target]'),signature=JSON.stringify(mobs.map(function(m){return [m.e.GID,m.name];}));
      if(select.dataset.sig!==signature){var old=select.value;select.textContent='';var initial=document.createElement('option');initial.value='';initial.textContent='自动：辅助锁定 / 唯一出现的怪';select.appendChild(initial);mobs.forEach(function(m){var o=document.createElement('option');o.value=String(m.e.GID);o.textContent=m.name;select.appendChild(o);});select.value=mobs.some(function(m){return String(m.e.GID)===old;})?old:'';select.dataset.sig=signature;}
      var manual=select.value;
      var target=mobs.find(function(m){return manual?String(m.e.GID)===manual:m.e.GID===s.target&&Date.now()-s.seen<10000;});
      if(!manual&&!target&&nativeChase.on)target=mobs.find(function(m){return m.e.GID===nativeChase.target;});
      if(!manual&&!target&&mobs.length===1)target=mobs[0];
      if(s.returnSilver)target={mid:null,name:'Boss 已死亡 → 恢复银箭矢'};
      else if(s.on&&target)s.lastBoss={e:target.e,player:CLIENT.SS.Entity,map:getMapName()};
      var read=arrowRead(),info=s.ui.querySelector('[data-info]'),rule=s.ui.querySelector('[data-rule]');
      var current=read.items.find(function(it){return it.index===read.index;}),message='当前箭矢：'+(current?getItemName(current.ITID):'未读取')+'\n';
      if(!target){s.currentMid=null;rule.dataset.mid='';
        var live=nativeChase.mobs||[];
        info.textContent=message+(mobs.length>1?'扫描到多只 Boss：请在上方指定目标':'当前未匹配到活 Boss')+
          '\n实时扫描：'+live.length+' 只活怪 / '+mobs.length+' 只 Boss'+
          '\n'+live.slice(0,6).map(function(m){return m.name+' #'+m.mid+(m.isMvp?' [Boss]':' [普通]');}).join('；')+
          (s.scanError?'\n扫描失败：'+s.scanError:'')+'\n历史名单不代表怪物当前在场';return;}
      s.currentMid=target.mid;
      if(rule.dataset.mid!==String(target.mid)){rule.value=s.rules[target.mid]||'';rule.dataset.mid=String(target.mid);}
      var desired=s.returnSilver?'圣':s.rules[target.mid],candidate=read.items.find(function(it){return arrowKind(getItemName(it.ITID))===desired&&it.index===read.index;})||read.items.find(function(it){return arrowKind(getItemName(it.ITID))===desired;});
      message+='目标：'+target.name+(manual?'（手动指定）':'（扫描联动）')+'\n配置：'+(desired||'未设置')+'；'+(candidate?getItemName(candidate.ITID)+' ×'+candidate.count:'没有对应箭矢');
      if(s.pending){if(read.index===s.pending.index){s.pending=null;message+='\n切换已确认';}else if(Date.now()-s.pending.at>5000){s.pending=null;s.on=false;s.ui.querySelector('[data-on]').checked=false;message+='\n未确认切换，自动切换已停止';}else{info.textContent=message+'\n等待装备确认';return;}}
      info.textContent=message;
      if(s.returnSilver&&candidate&&candidate.index===read.index){s.returnSilver=false;info.textContent=message+'\n已恢复银箭矢';return;}
      if(!s.on||!candidate||candidate.index===read.index||Date.now()-s.last<3000||bagClean.busy)return;
      var controls=requireDB('Preferences/Controls'),ent=CLIENT.SS.Entity;
      if(!ent||controls&&controls.talk||ent.cast&&ent.cast.isCasting&&ent.cast.isCasting())return;
      var p=new CLIENT.PS.CZ.REQ_WEAR_EQUIP();p.index=candidate.index;p.wearLocation=32768;
      s.last=Date.now();s.pending={index:candidate.index,at:s.last};CLIENT.NM.sendPacket(p);
      info.textContent=message+'\n已请求换箭，等待确认';
    }catch(e){s.ui.querySelector('[data-info]').textContent='读取失败，请打开背包和装备栏后重试';}
  }
  function arrowInit(){
    var s=arrowHelper;try{s.rules=JSON.parse(localStorage.getItem('dsh-arrow-rules-v1')||'{}')||{};}catch(ignore){}
    s.records={};s.historyDirty=true;try{s.records=JSON.parse(localStorage.getItem('dsh-arrow-seen-v1')||'{}')||{};}catch(ignore){}
    var box=document.createElement('details');s.ui=box;box.id='dsh-arrow-helper';box.style.cssText='position:fixed;right:12px;top:240px;width:265px;max-height:65vh;overflow:auto;background:rgba(20,31,49,.75);color:white;padding:7px;border:1px solid #8298b0;border-radius:6px;z-index:2147483645;font:12px/1.5 sans-serif';
    box.innerHTML='<summary style="cursor:pointer">MVP 换箭 · 试用版</summary><label><input data-on type="checkbox">自动切换（刷新默认关闭）</label><select data-target style="width:100%"></select><div data-info style="white-space:pre-line"></div><label>这只 MVP 使用 <select data-rule><option value="">不配置</option><option>火</option><option>水</option><option>风</option><option>地</option><option>念</option><option>暗</option><option>圣</option></select></label><button data-save>保存配置</button><div style="font-size:10px">无形=念，影子=暗，银=圣。<br>本服属性表缺失，本版不计算伤害倍率。<br>手动目标仅在附近存在时有效，请随实际目标调整。</div>';
    document.body.appendChild(box);movableDetails(box,'dsh-arrow-layout-v1');
    var history=document.createElement('details');history.open=true;history.innerHTML='<summary>出现过的怪物 · 选择箭矢自动保存</summary><div data-history style="max-height:220px;overflow:auto"></div><div style="font-size:10px">与内挂辅助共用扫描。仅记录扫描中标记为 MVP/Boss 的魔物。再次出现按配置换箭；目标确认死亡后恢复银箭矢。多怪无明确目标时不乱切。</div>';box.appendChild(history);
    arrowHistory([]);
    var backup=document.createElement('details');backup.innerHTML='<summary>名单备份 / 恢复</summary><button data-export>导出名单及用箭配置</button><button data-import>合并导入</button><textarea data-data rows="3" aria-label="MVP名单备份" style="width:100%;box-sizing:border-box"></textarea><div data-backup-status>同一浏览器、同一游戏网址自动保存；换网址或清缓存前请导出备份。</div>';box.appendChild(backup);
    backup.querySelector('[data-export]').onclick=function(){backup.querySelector('[data-data]').value=JSON.stringify({records:s.records,rules:s.rules},null,2);backup.querySelector('[data-backup-status]').textContent='已生成备份，请复制保存到文本文件';};
    backup.querySelector('[data-import]').onclick=function(){
      var status=backup.querySelector('[data-backup-status]');
      try{var data=JSON.parse(backup.querySelector('[data-data]').value);
        if(!data||!data.records||!data.rules||Array.isArray(data.records)||Array.isArray(data.rules)||typeof data.records!=='object'||typeof data.rules!=='object')throw Error();
        var ids=Object.keys(data.records),rules=Object.keys(data.rules);
        if(ids.length>3000||rules.length>3000||ids.some(function(id){return !/^[1-9]\d*$/.test(id)||typeof data.records[id]!=='string'||data.records[id].length>150;})||rules.some(function(id){return !/^[1-9]\d*$/.test(id)||['火','水','风','地','念','暗','圣'].indexOf(data.rules[id])<0;}))throw Error();
        var records=Object.assign({},s.records,data.records),merged=Object.assign({},s.rules,data.rules);
        localStorage.setItem('dsh-arrow-seen-v1',JSON.stringify(records));localStorage.setItem('dsh-arrow-rules-v1',JSON.stringify(merged));
        s.records=records;s.rules=merged;s.historyDirty=true;arrowHistory([]);box.querySelector('[data-rule]').dataset.mid='';status.textContent='名单和用箭配置已合并保存';
      }catch(e){status.textContent='导入失败：请检查备份格式或浏览器存储权限';}
    };
    box.querySelector('[data-on]').onchange=function(){s.on=this.checked;s.pending=null;};
    box.querySelector('[data-save]').onclick=function(){if(!s.currentMid)return;var value=box.querySelector('[data-rule]').value;if(value)s.rules[s.currentMid]=value;else delete s.rules[s.currentMid];localStorage.setItem('dsh-arrow-rules-v1',JSON.stringify(s.rules));arrowTick();};
    setInterval(function(){
      if(clientReady()&&CLIENT.NM&&!CLIENT.NM.sendPacket.__dshArrow){var original=CLIENT.NM.sendPacket;var wrapped=function(p){var result=original.apply(this,arguments);try{if(p&&((CLIENT.PS.CZ.REQUEST_ACT&&p instanceof CLIENT.PS.CZ.REQUEST_ACT&&(p.action===0||p.action===7))||(CLIENT.PS.CZ.USE_SKILL&&p instanceof CLIENT.PS.CZ.USE_SKILL))){s.target=p.targetGID!=null?p.targetGID:p.targetID;s.seen=Date.now();}}catch(ignore){}return result;};wrapped.__dshArrow=true;CLIENT.NM.sendPacket=wrapped;}
      arrowTick();
    },1000);
  }
  // ARROW_HELPER_END

  // ============================================================
  // 初始化 + 注册进助手扩展列表
  // ============================================================
  function v4Ready() { try { return !!(window.CLIENT && CLIENT.SS && CLIENT.NM && CLIENT.PS && window.require); } catch (e) { return false; } }
  var v4Tries = 0;
  function v4Boot() {
    try {
      if (v4Ready()) {
        if (!document.getElementById("dsh-infinite-challenge")) challengeInit();
        if (!document.getElementById("dsh-native-chase")) nativeChaseInit();
        repeatEnterInit();
        arrowInit();
        console.log("[V4-EXTRAS] v4.47 功能包已就绪（挑战/追怪巡查/换箭/回车/推送/白素贞1518）");
        try { if (window.__dshMenuReconHooked || document.getElementById("dsh-ro-panel")) console.log("[V4-EXTRAS] 检测到 ro-assist 运行中：开启原生追怪/挑战前请先关闭助手自动战斗或寻怪"); } catch (e) {}
        return;
      }
      if (++v4Tries < 120) setTimeout(v4Boot, 1000);
    } catch (e) { console.log("[V4-EXTRAS] 初始化异常: " + (e && e.message)); }
  }
  setTimeout(v4Boot, 500);
  try {
    if (window.__ROExt && window.__ROExt.register) {
      window.__ROExt.register({
        id: "v4-extras",
        name: "v4.47 功能包",
        ver: "1.0.0",
        desc: "无限挑战·初级 / 原生追怪巡查 / MVP 换箭 / 重复进入回车 / pushplus 推送 / 白素贞1518识别。浮窗在页面左侧与右侧，独立于助手；开启追怪/挑战前建议先关闭助手自动战斗或寻怪。",
        enabled: true,
        onEnable: function () { try { if (!document.getElementById("dsh-infinite-challenge")) challengeInit(); if (!document.getElementById("dsh-native-chase")) nativeChaseInit(); repeatEnterInit(); arrowInit(); } catch (e) {} },
        onDisable: function () {}
      });
    }
  } catch (e) {}
})();
