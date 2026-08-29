// ==UserScript==
// @name         仙境传说 · 内挂联动探针（ro-probe）
// @namespace    dsh.ro-probe
// @version      0.13.28
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-probe.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-probe.user.js
// @description  v0.13.28：回传加 selfJob（自己职业）+ 队友实体枚举 job/class/appear 相关字段（jobFields，含原型链），核实职业读取是否正确（e.job 是否=真实职业）。v0.13.27：回传加 selfName（自己角色名，SS.Entity.display.name 优先，双开同时回传时按 selfGID+selfName 区分是哪个号）。v0.13.26：attachments/animations 的 list 数组深采（listLen/listElem/listSample）+ 颜色字段 0/1/2/3 实际值，定位队友 buff 特效附件里是否带状态ID（队友实体无 status/buff 数组，buff 或渲染为附件特效）。v0.13.25：队友实体特效/动画/颜色字段深采（attachments/animations/effectColor/_effectStateColor/_bodyStateColor/_healthStateColor/_virtueColor/_flashColor 回传 fxFields），定位队友 buff 状态渲染源（顶层无 status/buff 数组则看特效附件+状态色）。v0.13.24：扫内挂按钮/勾选框/可点击元素（button/checkbox/[onclick]/[class*=attack|open|start|stop|auto]）回传 p.bot.buttons，定位「开始挂机/停止挂机」开关控件——已实锤开关=.startButton（文字「点击开始」，DIV）。v0.13.23：队友实体字段深采——EM.forEach 采到的队友（objecttype===0 排除自己）额外枚举实体顶层 keys + status/buff/icon/efst/effect 等状态字段结构（keys/elem/sample），定位队友 buff 状态源（队友列表已实锤=EM.forEach+party_name 认队）。v0.13.22：读内挂「辅助选择」DOM（collectBotAssistDom：扫所有 select 控件 option + 队伍/输出/辅助相关 option，回传 p.bot），定位内挂的队伍成员/辅助对象数据源（借鉴内挂同源队友数据）。v0.13.21：EntityManager 命中 Renderer/EntityManager 后直接 EM.forEach 遍历实体，采集玩家实体(objecttype=0)排除自己作为队友候选，回传 p.party.teammates（GID/name/pos/job/clevel/displayKeys）+ selfGID，定位队友列表与队友实体字段。v0.13.20：RAF hook 改到页面真实 window + 所有 iframe（沙箱 window 捕不到游戏渲染致 v0.13.19 raf 恒为 0），按来源(src)区分回传定位游戏渲染链路；队友 party 深挖（SessionStorage.Character 深字段 + 全局 window party 键 + require 模块缓存 party/entity 模块 + EntityManager 扩展路径）。v0.13.19：RAF 帧率探测（hook requestAnimationFrame 统计前台/后台触发频率，回传 p.raf，验证游戏循环是否逐帧渲染驱动，为助手后台降帧提供依据）。v0.13.18：队友 party 数据源探测（新增 collectPartyData：枚举 SessionStorage 顶层键名 + Entity 的 party/member 字段 + EntityManager 实体列表，回传 p.party，定位队友 buff 判定的队友列表与状态源，为助手队友 buff 功能提供数据源）。v0.13.17：修复 collectEntityData/collectStorageDeep/collectInstData/collectInstDataDeep 四函数作用域嵌套 bug（v0.13.15 起节流块调用即 ReferenceError，原被 catch 吞致 ssProbe 空、TC-03 一直无回传；现提升至 IIFE 顶层作用域，THROW 自证机制保留）。旁路监听内挂技能槽配置/服务器回读技能释放状态变化攻击节奏数据包，逆向服务器联动规则与攻击指挥来源。v0.13.16：SessionStorage 模块名枚举（原只读Engine/SessionStorage，TC-03 entity 零回传根因）+ 失败时ssProbe 诊断回传 + 仓库 Storage 二次深探（collectStorageDeep：ITEM 分类值展开 HEALING 等+ 全键名200 枚举，定位仓库装备金边 index→ITID 数据源）。v0.13.14 大地图矩形射线回退。v0.13.13：仓库结构深探（collectInstDataDeep 探ITEM/TAB/ORDER 的typeof/键名/长度/1条截断样本）+ 装备数据源定位（collectEntityData 探SessionStorage.Entity 顶层字段与数组字段，回传 p.entity（0s 节流同domInv）——仓库装备金边 index→itid 映射的取证最后一站。v0.13.12 collectInstData（实例物品数组字段名，实测inventory.list 51条含 index/ITID/count）；v0.13.11 标定 document 委托；v0.13.10 背包 DOM 采集（物品栏=div.item[data-itid] 实证）；v0.13.8 事件隔离；v0.13.4 reqSafe 守卫；只读不改。
// @match        https://post.lastro.cn/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      192.168.31.97
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  var MAX_LOG = 500;              // 日志条数上限（防爆内存）
  var SET_DIRECT_MS = 600;        // REQUEST_ACT 前N ms 内有 SETTARGET 视为服务器指挥
  var TRIGGER_WINDOW_MS = 1000;   // 被击后N ms 内释放的技能视为触发技能
  var SKILL_ID_NAME = {           // 内挂槽位配置 id →中文名（from setReloadInfo case，    39: '主动技能, 40: '主动等级', 41: '主动概率',
    53: '辅助技能', 54: '辅助等级', 55: '辅助开关',
    42: '触发技能', 43: '触发开关',
    44: '解围技能', 45: '解围等级',
    56: '自动念咒', 69: '自动影咒', 61: '辅助对象',
    0: '被非目标攻击', 1: '攻击距离', 2: '技能距离', 3: '瞬移间隔',
    4: 'HP转换', 5: 'BOSS瞬移', 6: '怪数下限', 7: '怪数上限',
    8: '治癒', 9: 'HP低瞬移', 10: 'SP低瞬移', 11: 'HP低攻',
    12: '骑乘', 13: '宠物蛋', 14: '自动坐下', 20: '拾取概率',
    21: '喝HP药', 22: '喝SP药', 26: '齐格弗里德', 27: '跟随状态',
    28: '跟随模式', 29: '目标距离', 30: '辅助目标', 57: '自动道具', 58: '道具',
    31: '辅助对象HP', 32: '辅助对象SP', 33: '元素精灵', 34: '自动攻击',
    35: '自动拾取', 36: '自动药水', 37: '自动跟随', 38: '寻怪模式',
  };
  var CAT_NAME = { CFG: '配置', AUTOSPELL: '念咒', SKILL: '技能', EFFECT: '特效', STATUS: '状态', HP: 'HP/SP', ATK: '普攻', CMD: '指挥', MOVE: '移动' };

  /* ==================== 状态==================== */
  var known = null;               // { byId: {ID: info}, db: DBManager }
  var pendingFrames = [];         // 模块就绪前收到的原始帧
var streamBuf = new Uint8Array(0);
  var logs = [];                  // {t, dir, cat, txt}
  var startTime = Date.now();
  var wsHooked = false;
  var probeSocket = null;         // 最近的活动 WebSocket 实例（v0.8.0 读配置按钮用）
  var moveTail = [];              // v0.13.2 REQUEST_MOVE 出站时间 ms（近 20 条，小地图点选走路判定用）
  var sendHexRing = [];           // v0.13.3 最近出站帧完整 hex（前96B，取证客户端走路移动包格式）
  var unknownRing = [];           // v0.13.3 未知客户端包取证 {t,id,hex}（近 12 条，识别递增 ID 移动包用）
  // v0.13.6 案例捕获模式：手动开启后记录后续 120s 全部出站/入站包（内挂传送→落地走到 NPC→对话全链路取证）
  var capt = { on: false, t0: 0, ring: [], captT: null };
  function captHex(bytes, max) {
    var s = '';
    var m = Math.min(bytes.length, max);
    for (var i = 0; i < m; i++) { var b = bytes[i]; s += (b < 16 ? '0' : '') + b.toString(16); }
    return s;
  }
  function captName(id) {
    try { if (known && known.byId && known.byId[id]) return known.byId[id].name; } catch (e) {}
    return null;
  }
  function startCapt() {
    if (capt.on) return;
    capt.on = true; capt.t0 = Date.now() - startTime; capt.ring = [];
    addLog('↑', 'CFG', '案例捕获已开始（120s 自动停）');
    if (capt.captT) clearTimeout(capt.captT);
    capt.captT = setTimeout(function () { capt.on = false; addLog('↑', 'CFG', '案例捕获超时自动停止'); }, 120000);
  }
  function stopCapt() {
    if (!capt.on) return;
    capt.on = false;
    if (capt.captT) { clearTimeout(capt.captT); capt.captT = null; }
    addLog('↑', 'CFG', '案例捕获已停止（' + capt.ring.length + ' 条）');
  }
  // v0.13.9 标定采集：大地图/小地图点击像素(px,py) + 玩家到达坐标 →线性回归出 像素↔坐标换算常数
  // （方桀A「模拟大地图点击走到任意坐标」的换算参数，零假设由真实数据解出；顺带枚举实例键名找「设置移动目标」API）
var calibRing = [];
  var calibInstalled = false;
  function getSelfPos() {
    try {
      var PW2 = pageWindow();
      if (!PW2) return null;
      var CL2 = null;
      try { CL2 = PW2.CLIENT || null; } catch (e) {}
      if (!CL2 || !CL2.SS) { CL2 = reqSafe(PW2, 'Engine/SessionStorage'); }
      var ent2 = CL2 ? (CL2.Entity || (CL2.SS && CL2.SS.Entity) || null) : null;
      if (ent2 && ent2.position) return [ent2.position[0], ent2.position[1]];
    } catch (e) {}
    return null;
  }
  function currentMapRaw() {
    try { var MR3 = reqSafe(pageWindow(), 'Renderer/MapRenderer'); return MR3 && MR3.currentMap ? String(MR3.currentMap) : null; } catch (e) {}
    return null;
  }
  function onMapDown(ev, src, holder) {
    try {
      var rect = null;
      try { rect = holder.getBoundingClientRect ? holder.getBoundingClientRect() : null; } catch (e) {}
      if (!rect) return;
      var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      var pos = getSelfPos() || [null, null];
      var rec = { t: Date.now() - startTime, src: src, px: Math.round(px), py: Math.round(py), x0: pos[0], y0: pos[1], map: currentMapRaw() };
      calibRing.push(rec);
      if (calibRing.length > 30) calibRing.shift();
      addLog('↑', 'MOVE', '标定:' + src + ' px=' + rec.px + ',' + rec.py + ' 当前=' + rec.x0 + ',' + rec.y0);
      (function (r) {
        setTimeout(function () {
          try {
            var p2 = getSelfPos();
            if (p2) { r.ax = p2[0]; r.ay = p2[1]; }
            addLog('↑', 'MOVE', '标定到达:' + r.ax + ',' + r.ay);
          } catch (e) {}
        }, 8000);
      })(rec);
    } catch (e) {}
  }
  function startCalibListener() {
    if (calibInstalled) return;
    calibInstalled = true;
    try {
      // v0.13.11：改 document 级事件委托（capture）——map/#minimap 元素由地图组件后会重建，
      // 绑元素会丢样本（v0.13.10 实测 cb 0 条）；委托后点击任意时点判定 target.closest，永不错过
      document.addEventListener('mousedown', function (ev) {
        try {
          var t = ev.target;
          if (!t || !t.closest) return;
          var big = t.closest('#map');
          if (!big) {
            // v0.13.14：大地图覆盖层（.zinfos_flow/.zinfos z-index:1 盖住 canvas#map，兄弟层 closest 找不到）
            // →点击坐标落在当前可见 #map 矩形内即认定为大地图点击（地图关闭时 rect 无效自动排除）
            var cm = null;
            try { cm = document.getElementById('map'); } catch (e) {}
            if (cm) {
              var r2 = cm.getBoundingClientRect();
              if (r2 && r2.width > 0 && ev.clientX >= r2.left - 1 && ev.clientX <= r2.right + 1 &&
                  ev.clientY >= r2.top - 1 && ev.clientY <= r2.bottom + 1) { big = cm; }
            }
          }
          if (big) { onMapDown(ev, 'bigmap', big); return; }
          var mini = t.closest('#minimap') || t.closest('.minimap');
          if (mini) { onMapDown(ev, 'minimap', mini); return; }
        } catch (e) {}
      }, true);
      addLog('↑', 'CFG', '标定监听已挂（大地图/小地图点击自动记录，事件委托）');
    } catch (e) {}
  }
  // v0.13.8：事件隔离层（仿助手「操作孤岛」）——游戏引擎在 document/window 挂全局鼠标监听（点地图=走路），
  // 探针 UI 内点击冒泡到 document 会被误判为游戏操作→人物乱走。
  // 面板容器自身挂【冒泡阶段】stopPropagation 3 类鼠标/触摸事件，UI 内部按钮先响应，
  // 冒泡到容器即掐断，到不了 document/window 的游戏监听；再挂 document 冒泡兜底（target.closest 命中即掐）。
  // 注意：必须用冒泡阶段（捕获阶段会阻断面板内元素自身的按钮事件）。
  var isoEvents = ["mousedown", "mousemove", "mouseup", "click", "dblclick", "wheel", "contextmenu",
    "touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup"];
  function isolateEl(el) {
    if (!el) return;
    for (var ie = 0; ie < isoEvents.length; ie++) {
      (function (evt) {
        el.addEventListener(evt, function (ev) { try { ev.stopPropagation(); } catch (e) {} }, false);
      })(isoEvents[ie]);
    }
  }
  function isolateProbeUI() {
    try {
      isolateEl(document.getElementById('dsh-probe-panel'));
      isolateEl(document.getElementById('dsh-probe-btn'));
      for (var ie2 = 0; ie2 < isoEvents.length; ie2++) {
        (function (evt) {
          document.addEventListener(evt, function (ev) {
            try {
              if (ev.target && ev.target.closest && ev.target.closest('#dsh-probe-panel, #dsh-probe-btn')) {
                ev.stopPropagation();
              }
            } catch (e) {}
          }, false);
        })(isoEvents[ie2]);
      }
    } catch (e) {}
  }
  var serverPktRing = [];         // v0.10.0 最近服务器入站包（回执=服务器发包证据）
  var skillFrames = [];           // v0.11.0 出站 CZ.USE_SKILL 记录（来源判定用）
  var mapEvents = [];             // v0.11.0 地图切换事件（NPCACK_MAPMOVE/SERVERMOVE）
  var ui = null;                  // UI 状态
  // v0.12.0：角色行为流水（环形缓冲 →定时批量回传，排技能逻辑 bug）
  var statusFlow = [];            // 状态变化流水：{t, stId, on, dur}（hook StatusIcons，与助手判活同源）
  var ackPending = {};            // 出站 USE_SKILL 期待服务器ACK：{skid: [t, lv, target]}（60ms 窗口）
  var ackMatched = [];            // 受理确认记录：{t, skid, lv, target, ackMs}
  var ackTimeout = [];            // 超时未受理记录：{t, skid, lv, target}
  var behaviorRing = [];          // 统一最近行为（技能发/ACK/状态换图），回传用
  var bhLastPost = 0;             // 上次行为批量回传时间
  var bhHookedSI = false;         // StatusIcons hook 状态（幂等）
  // 攻击节奏统计
  var atk = {
    acts: 0,                      // 客户端攻击请求数（REQUEST_ACT）
    moves: 0,                     // 客户端移动请求数（REQUEST_MOVE）
    switches: 0,                  // 切怪次数（targetGID 变化）
    lastTarget: 0,
    lastActMs: 0,
    intervals: [],                // 切怪间隔ms
    settargets: 0,                // 服务器指定目标次数（NOTIFY_SETTARGET）
    serverDirected: 0,            // 攻击前有 SETTARGET 的次数
    lastSetMs: 0,
    myGID: 0,                     // 自己的GID（推测）
    gidFreq: {},                  // GID 出现频率（用于推测自己）
    // ——服务器驱动攻击统计（NOTIFY_ACT3 广播里GID=自己）——
    serverActs: 0,                // 服务器广播的自己攻击次数
    srvTarget: 0,                 // 服务器广播的当前目标 GID
    srvLastMs: 0,
    srvIntervals: [],             // 服务器广播的切怪间隔ms
    srvTargetCount: {},           // 每个目标的攻击次数
    outPkts: {},                  // 客户端发包ID 计数（全量，v0.7.0）
    outPrinted: {},               // 已打印过的未知客户端包ID（限流）
    serverCasts: {},              // 服务器代施技能计数{技能名: n}（v0.7.0）
    buffEffects: {},               // 自己收到的特效计数{effectID: n}（v0.7.0）
    hitOnMe: 0,                   // 自己被击次数
    hitTimes: [],                 // 自己被击时间线ms（相对startTime）
    mySkills: {},                 // 自己释放技能计数{name: n}
    mySkillTimes: [],             // 自己释放技能时间线 [{ms, name}]
    triggerHits: {},              // 被击窗口内释放的技能计数{name: n}
    loadinfo: null                // 内挂完整配置（ZC.NOTIFY_LOADINFO 解码，v0.8.0）
  };

  /* ==================== 二进制工具==================== */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function i16(b, o) { var v = u16(b, o); return v > 32767 ? v - 65536 : v; }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function i32(b, o) { return u32(b, o) | 0; }
  function concat(a, b) {
    var r = new Uint8Array(a.length + b.length);
    r.set(a, 0); r.set(b, a.length);
    return r;
  }
  // v0.10.0：字节转 hex（入站包证据摘要）
  function toHex(b, max) {
    try {
      var out = '', n = Math.min(b.length, max || 16);
      for (var i = 0; i < n; i++) { var h = b[i].toString(16); out += (h.length < 2 ? '0' : '') + h; }
      return out + (b.length > n ? '...' : '');
    } catch (e) { return ''; }
  }

  /* ==================== 日志 ==================== */
  function skillName(db, skid) {
    try {
      var info = db.getSkillInfo(skid);
      if (info && info.SkillName) return info.SkillName;
    } catch (e) {}
    return '技能' + skid;
  }
  function statusName(sid) {
    return '状态' + sid;
  }
  function addLog(dir, cat, txt) {
    logs.push({ t: Date.now() - startTime, dir: dir, cat: cat, txt: txt });
    if (logs.length > MAX_LOG) logs.splice(0, logs.length - MAX_LOG);
    if (ui && ui.onLog) ui.onLog();
  }
  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function allLogText() {
    var lines = [];
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      lines.push(fmtTime(l.t) + ' ' + l.dir + ' [' + (CAT_NAME[l.cat] || l.cat) + '] ' + l.txt);
    }
    return lines.join('\n');
  }

  /* ==================== 攻击节奏分析 ==================== */
  function guessMyGID() {
    // 统计 NOTIFY_ACT 重GID 出现频率，最高者大概率是自己（挂机时自己攻击最频繁，    // v0.7.0：阈倀3→，低攻职业（牧师等）能更快锁定；单人挂机场景下更早生效
var best = 0, bestGid = 0;
    for (var g in atk.gidFreq) {
      if (atk.gidFreq[g] > best) { best = atk.gidFreq[g]; bestGid = parseInt(g, 10); }
    }
    if (best >= 2) atk.myGID = bestGid;
  }
  function recordAct(targetGID) {
    var ms = Date.now() - startTime;
    atk.acts++;
    if (atk.lastTarget && targetGID !== atk.lastTarget) {
      var iv = ms - atk.lastActMs;
      if (iv > 0 && iv < 120000) atk.intervals.push(iv);
      atk.switches++;
    }
    atk.lastTarget = targetGID;
    atk.lastActMs = ms;
    // 服务器指挥判断：此攻击前 SET_DIRECT_MS 内是否有 SETTARGET
    if (atk.lastSetMs && ms - atk.lastSetMs <= SET_DIRECT_MS) atk.serverDirected++;
  }
  // 服务器驱动攻击（NOTIFY_ACT3 广播里GID=自己）：这才是内挂战斗的真实节奏
  function recordServerAct(targetGID) {
    var ms = Date.now() - startTime;
    atk.serverActs++;
    if (atk.srvTarget && targetGID !== atk.srvTarget) {
      var iv = ms - atk.srvLastMs;
      if (iv > 0 && iv < 120000) atk.srvIntervals.push(iv);
    }
    atk.srvTarget = targetGID;
    atk.srvLastMs = ms;
    atk.srvTargetCount[targetGID] = (atk.srvTargetCount[targetGID] || 0) + 1;
  }
  function recordSetTarget(mobid) {
    atk.settargets++;
    atk.lastSetMs = Date.now() - startTime;
  }
  function recordMySkill(skid) {
    var ms = Date.now() - startTime;
    var nm = skillName(known.DB, skid);
    atk.mySkills[nm] = (atk.mySkills[nm] || 0) + 1;
    atk.mySkillTimes.push({ ms: ms, name: nm });
    if (atk.mySkillTimes.length > 200) atk.mySkillTimes.shift();
    // 触发技能判断：自己最近一次被击在 TRIGGER_WINDOW_MS 内
var lastHit = atk.hitTimes[atk.hitTimes.length - 1];
    if (lastHit !== undefined && ms - lastHit <= TRIGGER_WINDOW_MS) {
      atk.triggerHits[nm] = (atk.triggerHits[nm] || 0) + 1;
    }
  }
  // 服务器代施技能（ZC.USE_SKILL / USESKILL_ACK 里施法者自己 →服务器自动放技能的铁证）
function recordServerCast(skid) {
    var nm = skillName(known.DB, skid);
    atk.serverCasts[nm] = (atk.serverCasts[nm] || 0) + 1;
  }
  function recordHitOnMe() {
    var ms = Date.now() - startTime;
    atk.hitOnMe++;
    atk.hitTimes.push(ms);
    if (atk.hitTimes.length > 200) atk.hitTimes.shift();
  }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }
  function analyzeAttack(ivs) {
    var n = ivs.length;
    if (!n) return null;
    var sum = 0, i;
    for (i = 0; i < n; i++) sum += ivs[i];
    var avg = Math.round(sum / n);
    var med = median(ivs);
    var mn = ivs[0], mx = ivs[0];
    var sq = 0;
    for (i = 0; i < n; i++) {
      if (ivs[i] < mn) mn = ivs[i];
      if (ivs[i] > mx) mx = ivs[i];
      sq += (ivs[i] - avg) * (ivs[i] - avg);
    }
    var sd = Math.round(Math.sqrt(sq / n));
    var cv = avg ? Math.round(sd * 100 / avg) : 0; // 变异系数
    var stable = cv <= 20 ? '稳定' : (cv <= 40 ? '较稳定' : '波动');
    return { n: n, avg: avg, med: med, mn: mn, mx: mx, sd: sd, cv: cv, stable: stable };
  }
  function attackSummaryText() {
    var aC = analyzeAttack(atk.intervals);
    var aS = analyzeAttack(atk.srvIntervals);
    var lines = [];
    lines.push('==== 攻击节奏分析 ====');
    lines.push('📤 客户端攻击请求(REQUEST_ACT): ' + atk.acts + ' 次 · 移动请求: ' + atk.moves + ' 次');
    var op = [], opk;
    for (opk in atk.outPkts) op.push(opk + ':' + atk.outPkts[opk]);
    if (op.length) lines.push('客户端发包分布' + Object.keys(atk.outPkts).length + '移: ' + op.join(', '));
    lines.push('☀ 服务器广播攻击(NOTIFY_ACT3 自己): ' + atk.serverActs + ' 次');
    if (aS) {
      lines.push('☀服务器驱动切怪间隔 平均 ' + aS.avg + 'ms / 中位 ' + aS.med + 'ms / 范围 ' + aS.mn + '~' + aS.mx + 'ms');
      lines.push('☀稳定怀 标准巀' + aS.sd + 'ms · 变异系数 ' + aS.cv + '% →' + aS.stable);
    }
    if (aC) {
      lines.push('客户端发包切怪间隔 平均 ' + aC.avg + 'ms / 中位 ' + aC.med + 'ms / 范围 ' + aC.mn + '~' + aC.mx + 'ms');
      lines.push('客户端稳定怀 标准巀' + aC.sd + 'ms · 变异系数 ' + aC.cv + '% →' + aC.stable);
    }
    lines.push('🎯 服务器指定目标(NOTIFY_SETTARGET): ' + atk.settargets + ' 次');
    if (atk.acts) lines.push('客户端攻击前600ms内有服务器指令 ' + atk.serverDirected + ' / ' + atk.acts + ' (' + Math.round(atk.serverDirected * 100 / atk.acts) + '%)');
    lines.push('自己GID(推测): ' + (atk.myGID || '未知') + ' · 自己被击: ' + atk.hitOnMe + ' 次');
    if (atk.loadinfo) {
      var li = atk.loadinfo;
      lines.push('内挂配置: 寻怪模式' + li.searchMode + ' · 普攻距离=' + li.pmdis + ' · 技能距离' + li.mgdis + ' · 瞬移间隔=' + li.wing +
        ' · 被非目标攻击=' + li.onlyNo + ' · boss瞬移=' + li.seeBoss + ' · HP低瞬移' + li.minHpFly + ' · 自动攻击=' + li.sAtk +
        ' · 自动拾取=' + li.sLoot + ' · 自动药水=' + li.sPots + ' · 自动跟随=' + li.sFollow);
    }
    var tgt = [], k, cnt = atk.srvTargetCount;
    for (k in cnt) tgt.push('#' + k + 'x' + cnt[k]);
    if (tgt.length) lines.push('服务器驱动攻击目标分布' + Object.keys(cnt).length + '主: ' + tgt.join(', '));
    var sk = [];
    for (k in atk.mySkills) sk.push(k + 'x' + atk.mySkills[k]);
    if (sk.length) lines.push('自己释放技能 ' + sk.join(', '));
    var sc = [];
    for (k in atk.serverCasts) sc.push(k + 'x' + atk.serverCasts[k]);
    if (sc.length) lines.push('者服务器代施技能施法者自己): ' + sc.join(', '));
    var be = [], bek;
    for (bek in atk.buffEffects) be.push(bek + 'x' + atk.buffEffects[bek]);
    if (be.length) lines.push('自己身上的特效effectID): ' + be.join(', '));
    var tr = [], t2;
    for (t2 in atk.triggerHits) tr.push(t2 + 'x' + atk.triggerHits[t2]);
    if (tr.length) lines.push('被击后s内释放疑似触发技能: ' + tr.join(', '));
    // v0.12.0：服务器受理 + 状态流水（复制报告用）
    lines.push('==== 技能受理与状态流水(v0.12.0) ====');
    lines.push('[受理] 服务器已受理 ' + ackMatched.length + ' 次 · 发出后 3s 无ACK(未受理 ' + ackTimeout.length + ' 次)');
    var abAll = ackTimeout.slice(-8);
    for (var abi2 = 0; abi2 < abAll.length; abi2++) {
      lines.push('[无ACK] ' + fmtTime(abAll[abi2].t) + ' ' + skillNameSafe(abAll[abi2].skid) + '(#' + abAll[abi2].skid + ') Lv' + abAll[abi2].lv + ' → ' + abAll[abi2].target);
    }
    var acAll = ackMatched.slice(-8);
    for (var aci = 0; aci < acAll.length; aci++) {
      lines.push('[受理] ' + fmtTime(acAll[aci].t) + ' ' + skillNameSafe(acAll[aci].skid) + '(#' + acAll[aci].skid + ') Lv' + acAll[aci].lv + ' +' + acAll[aci].ackMs + 'ms受理');
    }
    lines.push('状态变化流水' + statusFlow.length + ' 条（StatusIcons ' + (bhHookedSI ? '已挂钩' : '未挂钩') + '），最近');
    var stAll = statusFlow.slice(-10);
    for (var sti2 = 0; sti2 < stAll.length; sti2++) {
      lines.push('  ' + fmtTime(stAll[sti2].t) + ' 状态' + stAll[sti2].stId + (stAll[sti2].on ? ' 上身' : ' 消失') + (stAll[sti2].dur ? ' dur=' + stAll[sti2].dur + 'ms' : ''));
    }
    // v0.13.0：网络层自检（沙箱隔离排查：ws 替换是否真生效）
    lines.push('==== 网络层自检 (v0.13.0) ====');
    lines.push('WebSocket ' + (netDiag.wsPatched ? '已替换' : '未替换') + (netDiag.wsUnsafe ? '(unsafeWindow)' : '(window)') + (netDiag.hookErr ? ' err=' + netDiag.hookErr : '') + ' · 收' + netDiag.recvCount + ' 包 · 发' + netDiag.sendCount + ' 包' + (netDiag.firstPktAt ? ' · 首包 ' + fmtTime(netDiag.firstPktAt) : ' · 尚无入站包'));
    if (!netDiag.recvCount && !netDiag.wsPatched) lines.push('（未替换且零收包 → 若游戏有网络活动则 hook 未生效，检查脚本管理器权限/unsafeWindow 支持）');
    return lines.join('\n');
  }

  /* ==================== 包解析==================== */
  // 全量注册：遍历PacketRegister 所有包，size 取自 PacketStructure（精确）。  // 只对关心的包解码，其余静默跳过（拿到 size 就能精确对齐，不再丢帧）。
var REG_WANTS = [
    ['ZC.NOTIFY_RELOADINFOS', 'CFG'], ['ZC.NOTIFY_LOADINFO', 'CFG'], ['ZC.AUTOSPELLLIST', 'AUTOSPELL'], ['ZC.AUTOSPELLLIST2', 'AUTOSPELL'],
    ['ZC.NOTIFY_SKILL', 'SKILL'], ['ZC.NOTIFY_SKILL2', 'SKILL'], ['ZC.NOTIFY_SKILL_POSITION', 'SKILL'],
    ['ZC.NOTIFY_GROUNDSKILL', 'SKILL'],
    ['ZC.USE_SKILL', 'SKILL'], ['ZC.USE_SKILL2', 'SKILL'],
    ['ZC.USESKILL_ACK', 'SKILL'], ['ZC.USESKILL_ACK2', 'SKILL'], ['ZC.USESKILL_ACK3', 'SKILL'],
    ['ZC.ACK_TOUSESKILL', 'SKILL'],
    ['ZC.AUTORUN_SKILL', 'SKILL'],
    ['ZC.NOTIFY_EFFECT', 'EFFECT'], ['ZC.NOTIFY_EFFECT2', 'EFFECT'], ['ZC.NOTIFY_EFFECT3', 'EFFECT'],
    ['ZC.STATUS_CHANGE', 'STATUS'], ['ZC.STATUS_CHANGE_ACK', 'STATUS'],
    ['ZC.PAR_CHANGE', 'HP'], ['ZC.LONGPAR_CHANGE', 'HP'],
    ['ZC.NOTIFY_ACT', 'ATK'], ['ZC.NOTIFY_ACT2', 'ATK'], ['ZC.NOTIFY_ACT3', 'ATK'],
    ['ZC.NOTIFY_SETTARGET', 'CMD'], ['ZC.NOTIFY_SETTARGET2', 'CMD'],
    ['ZC.NOTIFY_MOVEENTRY9', 'MOVE'], ['ZC.NOTIFY_STANDENTRY9', 'MOVE'], ['ZC.NOTIFY_NEWENTRY9', 'MOVE']
  ];
  var regMatched = 0;             // 引用匹配成功数（自检用）
  var regFails = [];              // 匹配失败的包（诊断用）
function buildKnown() {
    var PS, PR, DB;
    // v0.13.1：页面对象必须走 pageWindow()（unsafeWindow）——沙箱window.require 是隔离的，拿不到页面 AMD 模块
    var PW = pageWindow();
    // v0.13.4：require 起reqSafe（defined 守卫），防初始化早期 RequireJS notloaded 击穿页面
    try { PS = reqSafe(PW, 'Network/PacketStructure'); } catch (e) {}
    try { PR = reqSafe(PW, 'Network/PacketRegister'); } catch (e) {}
    try { DB = reqSafe(PW, 'DB/DBManager'); } catch (e) {}
    if (!PS || !PR || !DB) return null;
    var byId = {};
    // 全量注册：遍历PacketRegister（{id: structObj}），size 取自 struct.size
    for (var idStr in PR) {
      var id = parseInt(idStr, 10);
      if (isNaN(id)) continue;
      var st = PR[idStr];
      var sz = -2;
      try { if (st && st.size !== undefined && st.size !== null) sz = st.size; } catch (e) {}
      byId[id] = { name: 'pkt' + id, size: sz, cat: 'SKIP', fields: [] };
    }
    known = { PS: PS, PR: PR, DB: DB, byId: byId };
    // 关心的包：用「对象引用相等」匹配（PS.ZC.XXX === PR[id]），不依赖名字推新    regMatched = 0; regFails = []
;
    for (var i = 0; i < REG_WANTS.length; i++) {
      var ok = regRef(REG_WANTS[i][0], REG_WANTS[i][1]);
      if (!ok) regFails.push(REG_WANTS[i][0]);
    }
    // 降级兜底：引用匹配一个都没成时，尝试名字匹配（兼容部分环境的差异）
if (regMatched === 0) {
      for (var j = 0; j < REG_WANTS.length; j++) {
        var nm = REG_WANTS[j][0], leaf = nm.split('.')[1];
        for (var idStr2 in byId) {
          try {
            if (byId[idStr2].name === nm || byId[idStr2].name === leaf) {
              var st2 = known.PR[idStr2];
              var sz2 = -2;
              try { if (st2 && st2.size !== undefined) sz2 = st2.size; } catch (e) {}
              byId[idStr2] = { name: nm, size: sz2, cat: REG_WANTS[j][1], fields: FIELDS[nm] || [] };
              regMatched++;
              break;
            }
          } catch (e) {}
        }
      }
    }
    return known;
  }
  function regRef(path, cat) {
    var parts = path.split('.');
    var st;
    try { st = known.PS[parts[0]][parts[1]]; } catch (e) { return false; }
    if (!st) return false;
    var sz = -2;
    try { if (st.size !== undefined && st.size !== null) sz = st.size; } catch (e) {}
    for (var idStr in known.PR) {
      try {
        if (known.PR[idStr] === st) {
          known.byId[parseInt(idStr, 10)] = { name: path, size: sz, cat: cat, fields: FIELDS[path] || [] };
          regMatched++;
          return true;
        }
      } catch (e) {}
    }
    return false;
  }
  var FIELDS = {
    'ZC.NOTIFY_RELOADINFOS': [['id', 'u8'], ['value', 'i32']],
    'ZC.NOTIFY_LOADINFO': [['pmdis', 'u8'], ['mgdis', 'u8'], ['AutoUseWing_time', 'u8'], ['usehpConversion', 'u8'], ['AutoSeeBoss', 'u8'], ['qomobnumMin', 'u8'], ['qomobnum', 'u8'], ['usealheal', 'u8'], ['qo_AutoUseSkillid', 'u16'], ['qo_AutoUseSkilllv', 'u8'], ['MinHpValFly', 'u8'], ['MinSpValFly', 'u8'], ['MinHpVal', 'u8'], ['useBoarding', 'u8'], ['petTurnEgg', 'u8'], ['autoloot', 'u32'], ['AutoUseItem_reHpVal', 'u8'], ['AutoUseItem_reSpVal', 'u8'], ['AutoUseItem_jsys', 'u8'], ['AutoUseItem_Elemental', 'u8'], ['AutoUseItem_Panacea', 'u8'], ['useSiegfried', 'u8'], ['AutoAttackstatus', 'u8'], ['AutofollowMode', 'u8'], ['disTarget', 'u8'], ['addisTarget', 'u8'], ['aidddis_reHpVal', 'u8'], ['aidddis_reSpVal', 'u8'], ['AutoUseSit', 'u8'], ['AutoUseSit_reHpVal', 'u8'], ['AutoUseSit_reSpVal', 'u8'], ['AutoUseSit_reHpUpVal', 'u8'], ['AutoUseSit_reSpUpVal', 'u8'], ['AutoUseSit_xw', 'u8'], ['onlynoattack', 'u8'], ['AutoUseItem_Protection', 'u8'], ['startAutoAtk', 'u8'], ['startAutoLoot', 'u8'], ['startAutopots', 'u8'], ['startAutofollow', 'u8'], ['searchMode', 'u8'], ['AutoUseSkillid', 'u16'], ['AutoUseSkilllv', 'u8'], ['useSkill_pro', 'u8'], ['AutoUseItem_Elementalid', 'u16'], ['ProtectTeam', 'u8'], ['keepwayOp', 'u8'], ['useManuals', 'u8'], ['useBubbles', 'u8'], ['useAspersio', 'u8']],
    'ZC.AUTOSPELLLIST': [['SKID0', 'i32'], ['SKID1', 'i32'], ['SKID2', 'i32'], ['SKID3', 'i32'], ['SKID4', 'i32'], ['SKID5', 'i32'], ['SKID6', 'i32']],
    'ZC.AUTOSPELLLIST2': [['SKIDs', 'i32[]']],
    'ZC.NOTIFY_SKILL': [['SKID', 'u16'], ['AID', 'u32'], ['targetID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['damage', 'i16'], ['level', 'i16'], ['count', 'i16'], ['action', 'u8']],
    'ZC.NOTIFY_SKILL2': [['SKID', 'u16'], ['AID', 'u32'], ['targetID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['damage', 'i32'], ['level', 'i16'], ['count', 'i16'], ['action', 'u8']],
    'ZC.NOTIFY_SKILL_POSITION': [['SKID', 'u16'], ['AID', 'u32'], ['targetID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['xPos', 'i16'], ['yPos', 'i16'], ['damage', 'i16'], ['level', 'i16'], ['count', 'i16'], ['action', 'u8']],
    'ZC.USE_SKILL': [['SKID', 'u16'], ['level', 'i16'], ['targetAID', 'u32'], ['srcAID', 'u32'], ['result', 'u8']],
    'ZC.USE_SKILL2': [['SKID', 'u16'], ['level', 'i32'], ['targetAID', 'u32'], ['srcAID', 'u32'], ['result', 'u8']],
    'ZC.USESKILL_ACK': [['AID', 'u32'], ['targetID', 'u32'], ['xPos', 'i16'], ['yPos', 'i16'], ['SKID', 'u16'], ['property', 'u32'], ['delayTime', 'u32']],
    'ZC.ACK_TOUSESKILL': [['SKID', 'u16'], ['meta', 'u32'], ['result', 'u8'], ['cause', 'u8']],
    'ZC.USESKILL_ACK2': [['AID', 'u32'], ['targetID', 'u32'], ['xPos', 'i16'], ['yPos', 'i16'], ['SKID', 'u16'], ['property', 'u32'], ['delayTime', 'u32'], ['isDisposable', 'u8']],
    'ZC.USESKILL_ACK3': [['AID', 'u32'], ['targetID', 'u32'], ['xPos', 'i16'], ['yPos', 'i16'], ['SKID', 'u16'], ['property', 'u32'], ['delayTime', 'u32'], ['isDisposable', 'u8'], ['attackMT', 'u32']],
    'ZC.AUTORUN_SKILL': [['SKID', 'u16'], ['type', 'i32'], ['level', 'i16'], ['spcost', 'i16'], ['attackRange', 'i16'], ['skillName', 'raw'], ['upgradable', 'u8']],
    'ZC.NOTIFY_EFFECT': [['AID', 'u32'], ['effectID', 'i32']],
    'ZC.NOTIFY_EFFECT2': [['AID', 'u32'], ['effectID', 'i32']],
    'ZC.NOTIFY_EFFECT3': [['AID', 'u32'], ['effectID', 'i32'], ['numdata', 'i32']],
    'ZC.NOTIFY_GROUNDSKILL': [['SKID', 'u16'], ['AID', 'u32'], ['level', 'i16'], ['xPos', 'i16'], ['yPos', 'i16'], ['startTime', 'u32']],
    'ZC.STATUS_CHANGE': [['statusID', 'u16'], ['value', 'u8']],
    'ZC.STATUS_CHANGE_ACK': [['statusID', 'u16'], ['result', 'u8'], ['value', 'u8']],
    'ZC.PAR_CHANGE': [['varID', 'u16'], ['count', 'i32']],
    'ZC.LONGPAR_CHANGE': [['varID', 'u16'], ['amount', 'i32']],
    'ZC.NOTIFY_ACT': [['GID', 'u32'], ['targetGID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['damage', 'i16'], ['count', 'i16'], ['action', 'u8'], ['leftDamage', 'i16']],
    'ZC.NOTIFY_ACT2': [['GID', 'u32'], ['targetGID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['damage', 'i32'], ['count', 'i16'], ['action', 'u8'], ['leftDamage', 'i32']],
    'ZC.NOTIFY_ACT3': [['GID', 'u32'], ['targetGID', 'u32'], ['startTime', 'u32'], ['attackMT', 'i32'], ['attackedMT', 'i32'], ['damage', 'i32'], ['seek1', 'u8'], ['count', 'i16'], ['action', 'u8'], ['leftDamage', 'i32']],
    'ZC.NOTIFY_SETTARGET': [['mobid', 'i32'], ['value', 'u8']],
    'ZC.NOTIFY_SETTARGET2': [['mobid', 'i32'], ['value', 'u8']],
    'ZC.NOTIFY_MOVEENTRY9': [['objecttype', 'u8'], ['GID', 'u32'], ['AID', 'u32'], ['speed', 'i16']],
    'ZC.NOTIFY_STANDENTRY9': [['objecttype', 'u8'], ['GID', 'u32'], ['AID', 'u32'], ['speed', 'i16']],
    'ZC.NOTIFY_NEWENTRY9': [['objecttype', 'u8'], ['GID', 'u32'], ['AID', 'u32'], ['speed', 'i16']]
  };

  function readField(b, o, t) {
    switch (t) {
      case 'u8': return { v: b[o], n: 1 };
      case 'i8': return { v: b[o] > 127 ? b[o] - 256 : b[o], n: 1 };
      case 'u16': return { v: u16(b, o), n: 2 };
      case 'i16': return { v: i16(b, o), n: 2 };
      case 'u32': return { v: u32(b, o), n: 4 };
      case 'i32': return { v: i32(b, o), n: 4 };
    }
    return { v: 0, n: 0 };
  }

  function parsePacket(b, o, len, info) {
    var db = known.DB, txt = '', i, r, off = o;
    if (info.name === 'ZC.NOTIFY_RELOADINFOS') {
      var id = b[off], val = i32(b, off + 1);
      txt = 'id=' + id + '(' + (SKILL_ID_NAME[id] || '配置#' + id) + ') value=' + val;
    } else if (info.name === 'ZC.NOTIFY_LOADINFO') {
      // 58B 完整内挂配置（字段偏移来自客户端 ZC.NOTIFY_LOADINFO 结构（6B 实读 + 2B 尾部保留）
var L = {
        pmdis: b[off], mgdis: b[off + 1], wing: b[off + 2], hpConv: b[off + 3], seeBoss: b[off + 4],
        mobMin: b[off + 5], mobMax: b[off + 6], alHeal: b[off + 7], qoSkill: u16(b, off + 8), qoLv: b[off + 10],
        minHpFly: b[off + 11], minSpFly: b[off + 12], minHp: b[off + 13], boarding: b[off + 14], petEgg: b[off + 15],
        loot: u32(b, off + 16), reHp: b[off + 20], reSp: b[off + 21], useSieg: b[off + 25],
        atkStatus: b[off + 26], followMode: b[off + 27], disTgt: b[off + 28], addTgt: b[off + 29],
        aiddisHp: b[off + 30], aiddisSp: b[off + 31], sit: b[off + 32], sitHp: b[off + 33], sitSp: b[off + 34], sitHpUp: b[off + 35], sitSpUp: b[off + 36],
        onlyNo: b[off + 38], itemProt: b[off + 39], sAtk: b[off + 40], sLoot: b[off + 41], sPots: b[off + 42], sFollow: b[off + 43],
        search: b[off + 44], aSkill: u16(b, off + 45), aLv: b[off + 47], aPro: b[off + 48], elemId: u16(b, off + 49),
        protect: b[off + 51], keepway: b[off + 52], manuals: b[off + 53], bubbles: b[off + 54], aspersio: b[off + 55]
      };
      var sm = (['移动寻怪', '范围寻怪', '原地寻怪'][L.search] || ('寻怪#' + L.search));
      var ona = (['无视', '瞬移', '还击'][L.onlyNo] || ('#' + L.onlyNo));
      var atg = (['所有队员', '队长', '其它角色', '混合'][L.addTgt] || ('#' + L.addTgt));
      var on = function (v) { return v ? '开' : '关'; };
      var aSkillTxt = skillName(db, L.aSkill) + 'Lv' + L.aLv + '(' + L.aPro + '%)';
      var qoTxt = L.qoSkill ? skillName(db, L.qoSkill) + 'Lv' + L.qoLv : '无';
      atk.loadinfo = {
        searchMode: sm, onlyNo: ona, addTgt: atg, pmdis: L.pmdis, mgdis: L.mgdis, wing: L.wing,
        seeBoss: on(L.seeBoss), hpConv: on(L.hpConv), alHeal: on(L.alHeal),
        minHpFly: L.minHpFly ? (L.minHpFly + '%') : '无', minSpFly: L.minSpFly ? (L.minSpFly + '%') : '无', minHp: L.minHp,
        loot: Math.round(L.loot / 100), sAtk: on(L.sAtk), sLoot: on(L.sLoot), sPots: on(L.sPots), sFollow: on(L.sFollow),
        boarding: on(L.boarding), petEgg: on(L.petEgg), sit: on(L.sit), reHp: L.reHp, reSp: L.reSp, useSieg: on(L.useSieg),
        mobMin: L.mobMin, mobMax: L.mobMax, aSkill: aSkillTxt, qoSkill: qoTxt, disTgt: L.disTgt
      };
      txt = '内挂配置58B: 寻怪模式' + sm + ' · 普攻距离=' + L.pmdis + ' · 技能距离' + L.mgdis + ' · 瞬移间隔=' + L.wing +
        ' · 被非目标攻击=' + ona + ' · boss瞬移=' + on(L.seeBoss) + ' · HP转换=' + on(L.hpConv) + ' · 治愈最' + on(L.alHeal) +
        '\n  自动攻击=' + on(L.sAtk) + ' · 自动拾取=' + on(L.sLoot) + ' · 自动药水=' + on(L.sPots) + ' · 自动跟随=' + on(L.sFollow) +
        ' · 主动技能' + aSkillTxt + ' · 触发技能' + qoTxt + ' · 骑乘=' + on(L.boarding) + ' · 宠物蛋' + on(L.petEgg) +
        ' · 自动坐下=' + on(L.sit) + ' · 喝HP=' + L.reHp + ' · 喝SP=' + L.reSp + ' · 齐格弗里德' + on(L.useSieg) +
        ' · 怪数' + L.mobMin + '~' + L.mobMax + ' · 跟随距离=' + L.disTgt + '标· 拾取' + Math.round(L.loot / 100) + '%';
    } else if (info.name === 'ZC.AUTOSPELLLIST') {
      var names = [];
      for (i = 0; i < 7; i++) names.push(skillName(db, i32(b, off + i * 4)));
      txt = '念咒7槀[' + names.join(', ') + ']';
    } else if (info.name === 'ZC.AUTOSPELLLIST2') {
      var n = (len - 4) / 4, names2 = [];
      for (i = 0; i < n; i++) names2.push(skillName(db, i32(b, off + 4 + i * 4)));
      txt = '念咒列表(' + n + ')=[' + names2.join(', ') + ']';
    } else if (info.name === 'ZC.NOTIFY_SKILL' || info.name === 'ZC.NOTIFY_SKILL2' || info.name === 'ZC.NOTIFY_SKILL_POSITION') {
      // off = payload 起点。payload 相对偏移（SKID 单2B）：
      // SKILL:  SKID@0,AID@2,target@6,start@10,atkMT@14,atkMT2@18,dmg@22(i16),level@24,count@26,action@28
      // SKILL2: dmg@22(i32),level@26,count@28,action@30
      // POSITION: x@22,y@24,dmg@26(i16),level@28,count@30,action@32
      var skid = u16(b, off), aid = u32(b, off + 2), tid = u32(b, off + 6);
      var dmgOff = info.name === 'ZC.NOTIFY_SKILL_POSITION' ? 26 : 22;
      var lvOff = info.name === 'ZC.NOTIFY_SKILL_POSITION' ? 28 : (info.name === 'ZC.NOTIFY_SKILL2' ? 26 : 24);
      var dmg = info.name === 'ZC.NOTIFY_SKILL2' ? i32(b, off + dmgOff) : i16(b, off + dmgOff);
      var lv = i16(b, off + lvOff);
      txt = skillName(db, skid) + '(#' + skid + ') Lv' + lv + ' AID=' + aid + ' →target=' + tid + (dmg ? ' 伤害=' + dmg : '');
      if (!atk.myGID) guessMyGID();
      if (aid === atk.myGID) recordMySkill(skid);
    } else if (info.name === 'ZC.USE_SKILL' || info.name === 'ZC.USE_SKILL2') {
      // 服务器施法包：SKID@0, level@2(i16/i32), targetAID@4/6, srcAID@8/10, result@12/14
      var usk = u16(b, off);
      var ulev = info.name === 'ZC.USE_SKILL2' ? i32(b, off + 2) : i16(b, off + 2);
      var utgt = u32(b, off + (info.name === 'ZC.USE_SKILL2' ? 6 : 4));
      var usrc = u32(b, off + (info.name === 'ZC.USE_SKILL2' ? 10 : 8));
      var ures = b[off + (info.name === 'ZC.USE_SKILL2' ? 14 : 12)];
      txt = '施法 ' + skillName(db, usk) + '(#' + usk + ') Lv' + ulev + ' 施法者' + usrc + ' →目标' + utgt + ' result=' + ures;
      if (!atk.myGID) guessMyGID();
      if (usrc === atk.myGID) recordServerCast(usk);   // 服务器替自己施法
    } else if (info.name === 'ZC.USESKILL_ACK' || info.name === 'ZC.USESKILL_ACK2' || info.name === 'ZC.USESKILL_ACK3') {
      // 施法确认：AID@0, targetID@4, x@8, y@10, SKID@12, property@14, delay@18, (ACK2:isDisposable@22, ACK3:+attackMT@23)
      var ua = u32(b, off), ut2 = u32(b, off + 4), ux = i16(b, off + 8), uy = i16(b, off + 10);
      var us2 = u16(b, off + 12), udly = u32(b, off + 18);
      txt = '施法确认 ' + skillName(db, us2) + '(#' + us2 + ') AID=' + ua + ' →目标' + ut2 + ' @(' + ux + ',' + uy + ') delay=' + udly;
      if (!atk.myGID) guessMyGID();
      if (ua === atk.myGID) recordServerCast(us2);     // 服务器替自己施法
    } else if (info.name === 'ZC.ACK_TOUSESKILL') {
      // v0.12.0 服务器对出站技能请求的受理回执：SKID@0, meta@2(btype/NUM), result@6, cause@7（老版10B/新版14B）
      // result=1 受理成功；result=0 + cause=失败原因码。与出站 500ms 窗口内同 SKID →「服务器已受理」铁证）
var tsk = u16(b, off);
      var tmeta = u32(b, off + 2);
      var tresult = b[off + 6];
      var tcause = b[off + 7];
      var causeTxt = (tcause === 0 ? '' : ' cause=' + tcause + '(未学/SP不足/射程/变形筀');
      txt = 'ACK_TOUSESKILL ' + skillName(db, tsk) + '(#' + tsk + ') result=' + tresult + ' meta=' + tmeta + causeTxt;
      handleUseSkillAck(b, off);
    } else if (info.name === 'ZC.NOTIFY_EFFECT' || info.name === 'ZC.NOTIFY_EFFECT2' || info.name === 'ZC.NOTIFY_EFFECT3') {
      // 特效：AID@0, effectID@4, (EFFECT3: numdata@8)
      var ea = u32(b, off), eid = i32(b, off + 4);
      txt = '特效 AID=' + ea + ' effectID=' + eid;
      if (ea === atk.myGID) atk.buffEffects[eid] = (atk.buffEffects[eid] || 0) + 1;  // 自己身上的特效（buff 动画）
} else if (info.name === 'ZC.AUTORUN_SKILL') {
      // 自动技能信息：SKID@0, type@2, level@6, spcost@8, attackRange@10, skillName@12, upgradable@36
      var ask = u16(b, off), aty = i32(b, off + 2), alv = i16(b, off + 6), asp = i16(b, off + 8), arng = i16(b, off + 10);
      txt = '自动技能' + skillName(db, ask) + '(#' + ask + ') type=' + aty + ' Lv' + alv + ' SP' + asp + ' 射程' + arng;
    } else if (info.name === 'ZC.NOTIFY_ACT' || info.name === 'ZC.NOTIFY_ACT2' || info.name === 'ZC.NOTIFY_ACT3') {
      var gid = u32(b, off), tgid = u32(b, off + 4);
      // damage@20(i16 for ACT, i32 for ACT2/3)；action 偏移：ACT@24, ACT2@26, ACT3@27（ACT3 服seek1）
var aDmg = info.name === 'ZC.NOTIFY_ACT' ? i16(b, off + 20) : i32(b, off + 20);
      var aActOff = info.name === 'ZC.NOTIFY_ACT' ? 24 : (info.name === 'ZC.NOTIFY_ACT2' ? 26 : 27);
      txt = '普攻 GID=' + gid + ' →target=' + tgid + (aDmg ? ' 伤害=' + aDmg : '') + ' action=' + b[off + aActOff];
      atk.gidFreq[gid] = (atk.gidFreq[gid] || 0) + 1;
      // 服务器广播里 GID=自己 →服务器驱动的攻击节奏（内挂真实战斗）
      if (atk.myGID && gid === atk.myGID) recordServerAct(tgid);
      else if (!atk.myGID) { guessMyGID(); if (atk.myGID && gid === atk.myGID) recordServerAct(tgid); }
      if (atk.myGID && tgid === atk.myGID) recordHitOnMe();
      else if (!atk.myGID) { guessMyGID(); if (atk.myGID && tgid === atk.myGID) recordHitOnMe(); }
    } else if (info.name === 'ZC.NOTIFY_MOVEENTRY9' || info.name === 'ZC.NOTIFY_STANDENTRY9' || info.name === 'ZC.NOTIFY_NEWENTRY9') {
      // 实体移动/出现广播——记录GID 频率辅助推测自己（objecttype 0=PC 5=MOB）
var otype = b[off], mgid = u32(b, off + 1);
      if (otype === 0) atk.gidFreq[mgid] = (atk.gidFreq[mgid] || 0) + 1;
      txt = '实体 type=' + otype + ' GID=' + mgid;
    } else if (info.name === 'ZC.NOTIFY_GROUNDSKILL') {
      var gskid = u16(b, off), gaid = u32(b, off + 2), glv = u16(b, off + 6), gx = i16(b, off + 8), gy = i16(b, off + 10);
      txt = '地面技 ' + skillName(db, gskid) + ' Lv' + glv + ' @(' + gx + ',' + gy + ') AID=' + gaid;
      if (!atk.myGID) guessMyGID();
      if (gaid === atk.myGID) recordMySkill(gskid);
    } else if (info.name === 'ZC.STATUS_CHANGE') {
      txt = statusName(u16(b, off)) + ' →' + b[off + 2];
    } else if (info.name === 'ZC.STATUS_CHANGE_ACK') {
      txt = statusName(u16(b, off)) + ' result=' + b[off + 2] + ' value=' + b[off + 3];
    } else if (info.name === 'ZC.PAR_CHANGE') {
      txt = 'varID=' + u16(b, off) + ' →' + i32(b, off + 2);
    } else if (info.name === 'ZC.LONGPAR_CHANGE') {
      txt = 'varID=' + u16(b, off) + ' →' + i32(b, off + 2);
    } else if (info.name === 'ZC.NOTIFY_SETTARGET' || info.name === 'ZC.NOTIFY_SETTARGET2') {
      var mobid = i32(b, off), val2 = b[off + 4];
      txt = '指定目标 mobid=' + mobid + ' value=' + val2;
      recordSetTarget(mobid);
    } else {
      // 通用回退：逐字段拼
      var parts = [];
      off = o;
      for (i = 0; i < info.fields.length; i++) {
        var f = info.fields[i], ty = f[1];
        if (ty === 'raw' || ty === 'i32[]') break;
        r = readField(b, off, ty);
        if (!r.n) break;
        parts.push(f[0] + '=' + r.v);
        off += r.n;
      }
      txt = parts.join(' ');
    }
    addLog('↑', info.cat, info.name.replace('ZC.', '') + ' ' + txt);
  }

  function parseOutbound(b, o, len) {
    // 发包解析：ID(2) + payload（当前版本固定长度）
    if (len < 2) return;
    var id = u16(b, o);
    var db = known.DB;
    if (id === 2814) { // CZ.NOTIFY_UPDATEINFO {id:u8, value:i32}
      var cid = b[o + 2], val = i32(b, o + 3);
      addLog('↑', 'CFG', 'NOTIFY_UPDATEINFO id=' + cid + '(' + (SKILL_ID_NAME[cid] || '配置#' + cid) + ') value=' + val);
    } else if (id === 2815) { // CZ.NOTIFY_LOADINFO {} 请求完整内挂配置
      addLog('↑', 'CFG', 'NOTIFY_LOADINFO 请求内挂配置');
    } else if (id === 462) { // CZ.SELECTAUTOSPELL {SKID:i32}
      addLog('↑', 'AUTOSPELL', 'SELECTAUTOSPELL SKID=' + skillName(db, i32(b, o + 2)) + '(#' + i32(b, o + 2) + ')');
    } else if (id === 1091) { // CZ.SKILL_SELECT_RESPONSE {why:i32, SKID:u16}
      addLog('↑', 'AUTOSPELL', 'SKILL_SELECT_RESPONSE SKID=' + skillName(db, u16(b, o + 6)) + '(#' + u16(b, o + 6) + ')');
    } else if (id === 137) { // CZ.REQUEST_ACT {targetGID:u32, action:u8}
      var tgid = u32(b, o + 2);
      addLog('↑', 'ATK', 'REQUEST_ACT 攻击目标=' + tgid + ' action=' + b[o + 6]);
      recordAct(tgid);
    } else if (id === 133) { // CZ.REQUEST_MOVE {dest:[x,y] 压缩}
      atk.moves++;
      moveTail.push(Date.now() - startTime);
      if (moveTail.length > 20) moveTail.shift();
      addLog('↑', 'ATK', 'REQUEST_MOVE 移动');
    }
  }

  /* ==================== 流式解析 ==================== */
  function drain() {
    if (!known) return;
    while (streamBuf.length >= 2) {
      var id = u16(streamBuf, 0);
      var info = known.byId[id];
      if (!info) {
        // 理论上全量注册后不会发生；兜底：指2 字节 ID 无法定长，跳过1 字节试探
        streamBuf = streamBuf.slice(1);
        continue;
      }
      var total;
      if (info.size < 0) {
        // 变长包：ID(2)+len(2)+payload(len-4)
        if (streamBuf.length < 4) return;
        total = u16(streamBuf, 2);
        if (total < 4 || total > 65535) { streamBuf = streamBuf.slice(1); continue; }
      } else if (info.size === -2) {
        // 未知大小包：跳过 1 字节试探（极少见，        streamBuf = streamBuf.slice(1)
        continue;
      } else {
        total = info.size;
      }
      if (streamBuf.length < total) return; // 等下一帧
var pkt = streamBuf.slice(0, total);
      streamBuf = streamBuf.slice(total);
      if (info.cat !== 'SKIP') {
        // v0.7.0 修复：off 必须指向 payload 起点（跳过2B ID 头）。        // 旧版 bug 0 导致所有收包字段错位（GID 读到 ID 头、objecttype=包ID低字节等）。
        try { parsePacket(pkt, 2, total, info); } catch (e) { addLog('↑', 'CFG', '解析异常: ' + e.message); }
      }
    }
  }
  function onWsData(ab) {
    var bytes = new Uint8Array(ab);
    // v0.13.0 网络自检：收包计数+ 首包时间
    netDiag.recvCount++;
    if (!netDiag.firstPktAt) netDiag.firstPktAt = Date.now() - startTime;
    // v0.13.6 案例捕获：入站关键回包（切图/落地/NPC 弹窗时序证据）
if (capt.on) {
      try {
        var id0d = bytes.length >= 2 ? u16(bytes, 0) : -1;
        capt.ring.push({ t: Date.now() - startTime, d: 'D', id: id0d, nm: captName(id0d), len: bytes.length, hex: captHex(bytes, 48) });
        if (capt.ring.length > 480) capt.ring.shift();
      } catch (e) {}
    }
    // v0.10.0：服务器入站包环形记录（回执=服务器发包证据）
    try {
      serverPktRing.push({ t: Date.now(), id: bytes.length >= 2 ? u16(bytes, 0) : -1, len: bytes.length, hex: toHex(bytes, 24) });
      if (serverPktRing.length > 12) serverPktRing.shift();
    } catch (e) {}
    // v0.11.0：地图切换事件（不依赖客户端模块，独立扫描）
    try { scanMapFrame(bytes); } catch (e) {}
    if (!known) { pendingFrames.push(bytes); if (pendingFrames.length > 200) pendingFrames.shift(); return; }
    streamBuf = concat(streamBuf, bytes);
    drain();
  }
  // v0.11.0：出站技能发包检测（CZ.USE_SKILL=275）
  // 版本表：[a.CZ.USE_SKILL,275,10,2,4,6]（新 10B：selectedLevel@2,SKID@4,targetID@6）
  //        [a.CZ.USE_SKILL,275,15,4,9,11]（旧 15B：selectedLevel@4,SKID@9,targetID@11）
  // 来源判定：助手在发包前写 window.__dshCast={skid,lv,target,src,t}（src: zhu=技能顺序/ ask=自动技能）
  //   500ms 内同 SKID 命中 →助手指令；否则→内挂指令/客户端其它
  function scanSkillFrames(bytes) {
    var off = 0;
    while (off + 2 <= bytes.length) {
      var id = u16(bytes, off);
      if (id === 275) {
        var lv, skid, tgt, hex, plen;
        if (off + 15 <= bytes.length) { plen = 15; lv = i16(bytes, off + 4); skid = u16(bytes, off + 9); tgt = u32(bytes, off + 11); hex = toHex(bytes.slice(off, off + 15), 15); }
        else if (off + 10 <= bytes.length) { plen = 10; lv = i16(bytes, off + 2); skid = u16(bytes, off + 4); tgt = u32(bytes, off + 6); hex = toHex(bytes.slice(off, off + 10), 10); }
        else break;
        var mc = pageWindow() && pageWindow().__dshCast;
        var src = "内挂/未知";
        if (mc && Date.now() - mc.t < 500 && mc.skid === skid) { src = "助手指令·" + (mc.src === "ask" ? "自动技能" : "技能顺序"); }
        skillFrames.push({ t: Date.now(), skid: skid, lv: lv, target: tgt, src: src, hex: hex });
        if (skillFrames.length > 20) skillFrames.shift();
        // v0.12.0：登记ACK 期待（服务器受理校验， 行为环        registerAckExpect(skid, lv, tgt)
        bhPush({ k: "cast", t: Date.now(), id: skid, lv: lv, tgt: tgt, src: src });
        try { addLog('↑', 'SKILL', 'USE_SKILL ' + skillNameSafe(skid) + '(#' + skid + ') Lv' + lv + ' →target=' + tgt + ' [' + src + ']'); } catch (e) {}
        off += plen;
        continue;
      }
      off += 2;
    }
  }
  // v0.11.0：地图切换事件（ZC.NPCACK_MAPMOVE=145 22B / ZC.NPCACK_SERVERMOVE=146 28B：mapName16+xy）
function scanMapFrame(bytes) {
    var off = 0;
    while (off + 4 <= bytes.length) {
      var id = u16(bytes, off);
      var total = id === 145 ? 22 : (id === 146 ? 28 : 0);
      if (!total) { off += 2; continue; }
      if (off + total > bytes.length) break;
      var nm = "";
      for (var i = 2; i < 18; i++) { var ch = bytes[off + i]; if (ch) nm += String.fromCharCode(ch); }
      var mx = i16(bytes, off + 18), my = i16(bytes, off + 20);
      mapEvents.push({ t: Date.now(), type: id === 145 ? "MAPMOVE" : "SERVERMOVE", map: nm, x: mx, y: my });
      if (mapEvents.length > 8) mapEvents.shift();
      off += total;
    }
  }
  // v0.11.0：技能名安全读取（客户端模块未就绪时降级显示 ID）
function skillNameSafe(skid) {
    try { if (known && known.DB) return skillName(known.DB, skid); } catch (e) {}
    return "技能" + skid;
  }
  // v0.12.0：行为环公共追加（timeout 裁剪，上限60）
function bhPush(obj) {
    try {
      behaviorRing.push(obj);
      if (behaviorRing.length > 60) behaviorRing.splice(0, behaviorRing.length - 60);
    } catch (e) {}
  }
  // v0.12.0：状态变化流水——独立hook 客户端StatusIcons.update（与助手判活同源，各臀wrap 不冲突）
  //   记录 buff/debuff 上身(on=true)/消失(on=false) + 时长 dur，供掀条件认为状态不在身所以不攻籀bug、  //   幂等：已 hook 就不再wrap；客户端模块未就绪时返回 false 由定时器重试）
function hookStatusIcons() {
    try {
      if (bhHookedSI) return true;
      var PW = pageWindow();
      var SI = reqSafe(PW, "UI/Components/StatusIcons/StatusIcons");
      if (!SI || typeof SI.update !== "function") return false;
      var orig = SI.update;
      SI.update = function (stId, active, layer, dur) {
        try {
          stId = parseInt(stId, 10);
          if (!isNaN(stId)) {
            statusFlow.push({ t: Date.now() - startTime, stId: stId, on: active ? 1 : 0, dur: (typeof dur === "number") ? dur : 0 });
            if (statusFlow.length > 200) statusFlow.splice(0, statusFlow.length - 200);
            bhPush({ k: "st", t: Date.now(), id: stId, on: active ? 1 : 0, dur: (typeof dur === "number") ? dur : 0 });
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      bhHookedSI = true;
      addLog('↑', 'STATUS', '状态流水已挂钩 StatusIcons.update（与助手同源）');
      return true;
    } catch (e) { return false; }
  }
  // v0.12.0：登记出站技能→期待服务器ACK（受理校验；同一 SKID 只留最近一次）
  function registerAckExpect(skid, lv, target) {
    try {
      ackPending[skid] = { t: Date.now(), lv: lv, target: target };
    } catch (e) {}
  }
  // v0.12.0：收到ACK_TOUSESKILL →匹配期待（00ms 窗口内同 SKID）判「服务器已受理」；超时的期待记为未受理
  //   结构（parsePacket 已从 payload 起点 off 传入）：SKID@0, meta@2, result@6, cause@7
  function handleUseSkillAck(bytes, off) {
    try {
      var skid = u16(bytes, off);
      var meta = u32(bytes, off + 2);
      var result = bytes[off + 6];
      var now = Date.now();
      var exp = ackPending[skid];
      if (exp && now - exp.t <= 500) {
        ackPending[skid] = null;
        ackMatched.push({ t: now - startTime, skid: skid, lv: exp.lv, target: exp.target, ackMs: now - exp.t });
        if (ackMatched.length > 60) ackMatched.shift();
        bhPush({ k: "ack", t: now, id: skid, lv: exp.lv, ok: result === 1 ? 1 : 0, ms: now - exp.t, meta: meta });
        addLog('↑', 'SKILL', 'ACK_TOUSESKILL 受理 ' + skillNameSafe(skid) + '(#' + skid + ') Lv' + exp.lv + (result === 1 ? '' : ' result=' + result) + '（出站后 ' + (now - exp.t) + 'ms）');
      }
      // 顺带清理 3s 前的过期期待（无 ACK = 服务器没受理/被判挡）
      var stale = [];
      for (var k in ackPending) if (ackPending[k] && now - ackPending[k].t > 3000) stale.push(k);
      for (var si = 0; si < stale.length; si++) {
        var st = ackPending[stale[si]];
        if (!st) continue;
        ackPending[stale[si]] = null;
        var stId = parseInt(stale[si], 10);
        ackTimeout.push({ t: now - startTime, skid: stId, lv: st.lv, target: st.target });
        if (ackTimeout.length > 60) ackTimeout.shift();
        bhPush({ k: "ack", t: now, id: stId, lv: st.lv, ok: 0, ms: now - st.t });
        addLog('↑', 'SKILL', '⚙' + skillNameSafe(stId) + '(#' + stId + ') Lv' + st.lv + ' 发出后3s 无ACK——服务器未受理（条件判挡或未真正发包）');
      }
      return true;
    } catch (e) { return false; }
  }
  function onWsSend(ab) {
    var bytes = new Uint8Array(ab);
    // v0.13.0 网络自检：发包计数    netDiag.sendCount++
;
    // v0.13.6 案例捕获：内挂传送全链路出站完整 hex（切图指令落地移动/对话点击）
if (capt.on) {
      try {
        var id0u = bytes.length >= 2 ? u16(bytes, 0) : -1;
        capt.ring.push({ t: Date.now() - startTime, d: 'U', id: id0u, nm: captName(id0u), len: bytes.length, hex: captHex(bytes, 192) });
        if (capt.ring.length > 240) capt.ring.shift();
      } catch (e) {}
    }
    // v0.13.3 取证：整帧hex（前96B）环形记录——分析客户端点大地图走路的移动包格式
    try {
      var hx0 = '';
      for (var hi0 = 0; hi0 < bytes.length && hi0 < 96; hi0++) { var bz = bytes[hi0]; hx0 += (bz < 16 ? '0' : '') + bz.toString(16); }
      sendHexRing.push({ t: Date.now() - startTime, len: bytes.length, hex: hx0 });
      if (sendHexRing.length > 6) sendHexRing.shift();
    } catch (e) {}
    // v0.11.0：技能发包来源检测不依赖客户端模块（known），独立轻量扫描——CS:选技能后是否真的发出 USE_SKILL
    try { scanSkillFrames(bytes); } catch (e) {}
    if (!known) return;
    // 发包流：逐2B 扫描。已矀ID 按固定长度解析；未知 ID 也计数首次打印（v0.7.0 全量统计）
var off = 0;
    while (off + 2 <= bytes.length) {
      var id = u16(bytes, off);
      var sz = 0;
      if (id === 2814) sz = 7;
      else if (id === 2815) sz = 2;
      else if (id === 462) sz = 6;
      else if (id === 1091) sz = 8;
      else if (id === 137) sz = 7;
      else if (id === 133) sz = 5;
      atk.outPkts[id] = (atk.outPkts[id] || 0) + 1;
      if (sz && off + sz <= bytes.length) { parseOutbound(bytes, off, sz); off += sz; }
      else {
        if (!atk.outPrinted[id]) {
          atk.outPrinted[id] = true;
          addLog('↑', 'CFG', '未知客户端包 id=' + id + ' 已统计（全量分布见攻击卡片）');
        }
        // v0.13.3 取证：记录该未知 id 所在位置的 hex（前 40B），识别递增 ID 移动包结构
try {
          var hx2 = '';
          for (var hi2 = off; hi2 < bytes.length && hi2 < off + 40; hi2++) { var b2 = bytes[hi2]; hx2 += (b2 < 16 ? '0' : '') + b2.toString(16); }
          unknownRing.push({ t: Date.now() - startTime, id: id, hex: hx2 });
          if (unknownRing.length > 12) unknownRing.shift();
        } catch (e) {}
        off += 2; // 未知 ID 无法定长，跳过2B 继续扫描（仅计数，不丢其他包）
}
    }
  }

  /* ==================== WebSocket 劫持（document-start 即挂（==================== */
  // v0.13.0：网络层自检统计（回传判定hook 是否真生效；沙箱隔离旀window 对象与页面不同）
  var netDiag = { wsPatched: 0, wsUnsafe: 0, recvCount: 0, sendCount: 0, firstPktAt: 0, hookErr: '' };
  // 页面真实 window：userscript 默认跑在隔离沙箱，window.WebSocket 替换可能只改到沙箱自己的
  // 对象、游戏页面收不到 →甀unsafeWindow（GM 暴露的页面真实全局）替换才算数；无 GM 时回萀window）
function pageWindow() {
    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow; } catch (e) {}
    return window;
  }
  function hookWebSocket() {
    if (wsHooked) return;
    wsHooked = true;
    var W = pageWindow();
    var NativeWS;
    try { NativeWS = W.WebSocket; netDiag.wsUnsafe = (W !== window) ? 1 : 0; } catch (e) { netDiag.hookErr = 'no-ws'; return; }
    if (!NativeWS || NativeWS.__dshProbe) return;
    try {
      // 收包：监听所有实例的 message
      function PatchedWS(url, protocols) {
        var inst = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
        probeSocket = inst;
        try {
          inst.addEventListener('message', function (ev) {
            if (ev.data && ev.data.byteLength !== undefined) onWsData(ev.data);
          });
        } catch (e) {}
        return inst;
      }
      PatchedWS.prototype = NativeWS.prototype;
      PatchedWS.CONNECTING = NativeWS.CONNECTING;
      PatchedWS.OPEN = NativeWS.OPEN;
      PatchedWS.CLOSING = NativeWS.CLOSING;
      PatchedWS.CLOSED = NativeWS.CLOSED;
      PatchedWS.__dshProbe = true;
      W.WebSocket = PatchedWS;
      netDiag.wsPatched = 1;

      // 发包：wrap send
      var origSend = NativeWS.prototype.send;
      NativeWS.prototype.send = function (data) {
        try {
          if (data && data.byteLength !== undefined && data.byteLength <= 4096) onWsSend(data);
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    } catch (e) { netDiag.hookErr = String(e && e.message || e); }
  }

  /* ==================== 回执采集（v0.9.0：聊天框开关回执+ 设备信息 →本机 8899 txt，==================== */
  var COLLECT_URL = 'http://192.168.31.97:8899/api/probe-collect'
;
  var collectSeenCount = 0;       // 已扫描过的聊天行数（增量检测）
  var collectLastPost = 0;        // 上次回传时间（防抖）
  var collectReady = false;
  function collectDeviceInfo() {
    try {
      return {
        ua: navigator.userAgent || '',
        platform: navigator.platform || '',
        touch: (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints) || (('ontouchstart' in window) ? 1 : 0),
        screen: (screen && screen.width) ? (screen.width + 'x' + screen.height) : '',
        lang: navigator.language || ''
      };
    } catch (e) { return {}; }
  }
  // v0.10.0：聊天容器自动探测+ 回传失败队列 + MutationObserver（函数声明提升，顺序无关）
  var CHAT_SELS = ['#chatbox .containers .border', '#chatbox .containers', '#chatbox .border', '#chatbox', '.chatbox .containers .border', '.chatbox .border', '.chatbox'];
  var collectSel = null;      // 命中的选择器（自我诊断）
var collectPCnt = 0;        // 当前命中容器 p 数量
  var collectObserver = null; // MutationObserver 新行增量监听
  var collectQueue = [];      // 回传失败队列（localStorage 持久化，30s 重试）
function queueLoad() {
    try {
      var q = JSON.parse(localStorage.getItem('dsh_probe_queue')) || [];
      collectQueue = Array.isArray(q) ? q : [];
    } catch (e) { collectQueue = []; }
  }
  function queueSave() { try { localStorage.setItem('dsh_probe_queue', JSON.stringify(collectQueue.slice(-20))); } catch (e) {} }
  function queueRetry() {
    if (!collectQueue.length) return;
    var n = collectQueue.length, done = 0, rest = [];
    for (var i = 0; i < n; i++) {
      var it = collectQueue[i];
      if (!it || !it.payload) { done++; continue; }
      (function (payload, item) {
        try {
          if (typeof GM_xmlhttpRequest !== 'function') { rest.push(item); done++; return; }
          GM_xmlhttpRequest({
            method: 'POST', url: COLLECT_URL, data: JSON.stringify(payload), timeout: 5000,
            headers: { 'Content-Type': 'application/json' },
            onload: function (r) { if (!(r && r.status === 200)) rest.push(item); done++; if (done === n) { collectQueue = rest.slice(-20); queueSave(); } },
            onerror: function () { rest.push(item); done++; if (done === n) { collectQueue = rest.slice(-20); queueSave(); } },
            ontimeout: function () { rest.push(item); done++; if (done === n) { collectQueue = rest.slice(-20); queueSave(); } }
          });
        } catch (e) { rest.push(item); done++; if (done === n) { collectQueue = rest.slice(-20); queueSave(); } }
      })(it.payload, it);
    }
  }
  function findChatBorder() {
    try {
      var i, j, k;
      // 1) 含开关关键词的容器（最可靠）
for (i = 0; i < CHAT_SELS.length; i++) {
        var el0 = document.querySelector(CHAT_SELS[i]);
        if (!el0) continue;
        var ps0 = el0.querySelectorAll('p');
        for (j = 0; j < ps0.length; j++) {
          if (/开启自动战斗|关闭自动战斗/.test(ps0[j].textContent || '')) {
            collectSel = CHAT_SELS[i]; collectPCnt = ps0.length;
            return { sel: CHAT_SELS[i], el: el0 };
          }
        }
      }
      // 2) 退而求其次：p 数量最多的候选层
      var best = null, bestN = -1;
      for (k = 0; k < CHAT_SELS.length; k++) {
        var elK = document.querySelector(CHAT_SELS[k]);
        if (!elK) continue;
        var nK = elK.querySelectorAll('p').length;
        if (nK > bestN) { bestN = nK; best = { sel: CHAT_SELS[k], el: elK }; }
      }
      if (best) { collectSel = best.sel; collectPCnt = bestN; return best; }
      collectSel = null; collectPCnt = 0;
      return null;
    } catch (e) { return null; }
  }
  function ensureChatObserver() {
    try {
      var fb = findChatBorder();
      if (!fb || !fb.el) return;
      if (collectObserver && collectObserver.root === fb.el) return;
      if (collectObserver) { try { collectObserver.disconnect(); } catch (e) {} }
      var target = fb.el;
      collectObserver = new MutationObserver(function (muts) {
        try {
          var found = null;
          for (var mi = 0; mi < muts.length; mi++) {
            var added = muts[mi].addedNodes;
            for (var ai = 0; ai < added.length; ai++) {
              var nd = added[ai];
              if (!nd || nd.nodeType !== 1) continue;
              var ts = (nd.textContent || '');
              if (/开启自动战斗|关闭自动战斗/.test(ts)) { found = ts.trim(); break; }
            }
            if (found) break;
          }
          if (found && Date.now() - collectLastPost > 1500) {
            collectLastPost = Date.now();
            postCollect(buildCollectPayload(collectChatTail(30), 'auto:' + found));
            addLog('↑', 'CFG', '自动采集开关回执(' + found + '): ' + found);
          }
        } catch (e) {}
      });
      collectObserver.root = target;
      collectObserver.observe(target, { childList: true, subtree: true, characterData: false });
    } catch (e) {}
  }
  // v0.13.10：背包仓库/装备 DOM 结构采集——金边高亮选择器取证（真实物品槽的 class/data-属怪数量元素），
  // UIManager 组件实例优先、全文档可见容器 fallback；回传自动做同0s 节流），自检按钮也做
  var lastInvAt = 0;
  function collectInvStructure() {
    try {
      var out = { wins: [], found: false };
      var PW = pageWindow();
      var seen = {};
      function sniffWin(name, inst) {
        try {
          if (seen[name]) return null;
          var root = null;
          try { if (inst && inst.ui && typeof inst.ui === 'object' && typeof inst.ui[0] === 'object' && inst.ui[0].querySelectorAll) root = inst.ui[0]; } catch (e) {}
          try { if (!root && inst && inst.dom && inst.dom.ui && inst.dom.ui.querySelectorAll) root = inst.dom.ui; } catch (e) {}
          if (!root) return null;
          var slots = [];
          var els = root.querySelectorAll('.item, [class*="item"], [data-type="item"]');
          var n = Math.min(els.length, 8);
          for (var i = 0; i < n; i++) {
            var el = els[i];
            var dataKeys = [];
            for (var a = 0; a < el.attributes.length; a++) { var an = el.attributes[a].name; if (/^data-/i.test(an)) dataKeys.push(an); }
            var hasCount = !!el.querySelector('.count, [class*="count"]');
            slots.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 100), dataKeys: dataKeys.slice(0, 12), count: hasCount, html: String(el.outerHTML || '').slice(0, 140) });
          }
          if (!slots.length) return null;
          seen[name] = true;
          return { win: name, rootTag: root.tagName, rootCls: String(root.className || '').slice(0, 120), slotCount: els.length, slots: slots };
        } catch (e) { return null; }
      }
      // ⑁组件实例路径（UIManager）
try {
        var UM = reqSafe(PW, 'UI/UIManager');
        var cands = [['inventory', 'BasicInventory'], ['storage', 'Storage'], ['equipment', 'Equipment'], ['inventory', 'Inventory'], ['storage', 'ItemStorage'], ['inventory', 'ItemInfo']];
        if (UM) {
          for (var ci = 0; ci < cands.length; ci++) {
            var instX = null;
            try { if (typeof UM.get === 'function') instX = UM.get(cands[ci][1]); } catch (e2) {}
            if (!instX && UM.components) instX = UM.components[cands[ci][1]] || null;
            if (!instX && UM.instance && UM.instance.components) instX = UM.instance.components[cands[ci][1]] || null;
            var r2 = sniffWin(cands[ci][0], instX);
            if (r2) {
              r2.inst = collectInstData(instX);
              if (cands[ci][0] === 'storage') r2.instDeep = collectStorageDeep(instX); // v0.13.16 仓库结构深探（ITEM 展开+全键名）
              out.wins.push(r2);
            }
          }
        }
      } catch (e) {}
      // ⑁DOM fallback：全文档可见的物品槽容器
      try {
        if (!out.wins.length) {
          var sels = ['.basicInventory', '[id*="inventory"]', '.inventory', '.storage', '.equipment', '.itemList', '.items'];
          var hitRoots = {};
          for (var si = 0; si < sels.length; si++) {
            try {
              var rr = document.querySelectorAll(sels[si]);
              for (var ri = 0; ri < rr.length; ri++) {
                var elR = rr[ri];
                try { var rc = elR.getBoundingClientRect(); if (rc.width < 10 && rc.height < 10) continue; } catch (e3) {}
                if (hitRoots[elR.tagName + elR.id]) continue;
                hitRoots[elR.tagName + elR.id] = true;
                var r3 = sniffWin('dom-' + sels[si], elR);
                if (r3) out.wins.push(r3);
              }
            } catch (e4) {}
          }
        }
      } catch (e) {}
      out.found = out.wins.length > 0;
      return out;
    } catch (e) { return null; }
  }
      // v0.13.13：指定字段深探——仓库ITEM/TAB/ORDER 内部结构（typeof/键名/长度/1条截断样本）
      function collectInstDataDeep(inst, fields) {
        try {
          if (!inst) return null;
          var out = [];
          for (var i = 0; i < fields.length; i++) {
            try {
              var f = fields[i], v = inst[f];
              if (v == null) { out.push({ k: f, type: typeof v }); continue; }
              var rec = { k: f, type: Array.isArray(v) ? 'array' : typeof v };
              if (Array.isArray(v)) {
                rec.len = v.length;
                if (v.length > 0) {
                  var s0 = v[0];
                  if (s0 != null && typeof s0 === 'object') {
                    var fk = [];
                    for (var q in s0) { fk.push(q); if (fk.length >= 10) break; }
                    rec.elem = fk;
                  } else { rec.first = String(s0).slice(0, 40); }
                }
              } else if (typeof v === 'object') {
                var ok = [];
                for (var q2 in v) { ok.push(q2); if (ok.length >= 14) break; }
                rec.keys = ok;
                // 单条样本（若对象里有索引键）截断
                try {
                  var firstK = Object.keys(v)[0];
                  if (firstK != null && v[firstK] != null) {
                    var sv = v[firstK];
                    if (typeof sv === 'object') { var sk = []; for (var q3 in sv) { sk.push(q3); if (sk.length >= 10) break; } rec.sample = { key: String(firstK).slice(0, 40), keys: sk }; }
                    else { rec.sample = { key: String(firstK).slice(0, 40), val: String(sv).slice(0, 40) }; }
                  }
                } catch (e3) {}
              }
              out.push(rec);
            } catch (e2) {}
          }
          return out;
        } catch (e) { return null; }
      }
      // v0.13.16：装备角色侧数据源探测——SessionStorage 模块名枚举（原只读Engine/SessionStorage，TC-03 entity 零回传根因）+ Entity 顶层字段
      function collectEntityData() {
        try {
          var PW = pageWindow();
          var tried = [];
          var mods = ['Engine/SessionStorage', 'Engine/Storage', 'Engine/GameSession', 'Engine/Session', 'Engine/GameStorage', 'SessionStorage'];
          var SS = null;
          for (var mi = 0; mi < mods.length; mi++) {
            tried.push(mods[mi]);
            try { SS = reqSafe(PW, mods[mi]); } catch (e2) { SS = null; }
            if (SS && SS.Entity) break;
          }
          if (!SS) return { found: false, tried: tried, err: 'no Entity module' };
          var ent = SS.Entity;
          if (!ent) return { found: false, tried: tried, err: 'module ok but no Entity' };
          var keys = [], arrays = [];
          for (var k in ent) {
            try {
              if (typeof ent[k] === 'function') continue;
              keys.push(k);
            } catch (e2) {}
          }
          for (var i = 0; i < keys.length; i++) {
            try {
              var v = ent[keys[i]];
              if (v == null || typeof v !== 'object') continue;
              if (Array.isArray(v)) {
                var elem = null;
                if (v.length > 0 && typeof v[0] === 'object' && v[0]) {
                  elem = [];
                  for (var f in v[0]) { elem.push(f); if (elem.length >= 10) break; }
                }
                arrays.push({ k: keys[i], len: v.length, elem: elem || (v.length ? typeof v[0] : 'empty') });
              }
            } catch (e3) {}
          }
          return { found: true, tried: tried, entity: { keys: keys.length > 40 ? keys.slice(0, 40) : keys, arrays: arrays } };
        } catch (e) { return { found: false, tried: [], err: String(e && e.message || e) }; }
      }
      // v0.13.18：队友 party 数据源探测——枚举 SessionStorage 顶层键名 + Entity 的 party/member 字段 + EntityManager 实体列表
      // （队友 buff 判定需要：队友列表在哪 + 队友对象字段 + 队友状态从哪读；盲采结构回传逆向）
      function collectPartyData() {
        var out = { ssMod: null, ssKeys: [], partyFields: [], entParty: {}, emMod: null, emKeys: [], entityList: null };
        try {
          var PW = pageWindow();
          if (!PW || !PW.require) { out.err = 'no pageWindow/require'; return out; }
          var mods = ['Engine/SessionStorage', 'Engine/Storage', 'Engine/GameSession', 'Engine/Session', 'Engine/GameStorage', 'SessionStorage'];
          var SS = null;
          for (var mi = 0; mi < mods.length; mi++) {
            var m = reqSafe(PW, mods[mi]);
            if (m && (m.Entity || m.Party || m.Entities || m.party)) { SS = m; out.ssMod = mods[mi]; break; }
            if (m && m.Entity && !SS) { SS = m; out.ssMod = mods[mi]; }
          }
          if (SS) {
            var ks = [];
            for (var k in SS) { try { if (typeof SS[k] === 'function') continue; ks.push(k); if (ks.length >= 120) break; } catch (e) {} }
            out.ssKeys = ks;
            var LOW = /party|member|team|group|guild|队|组|盟/i;
            for (var k2 in SS) {
              try {
                if (typeof SS[k2] === 'function') continue;
                if (!LOW.test(k2)) continue;
                var v = SS[k2];
                var info = { k: k2, type: v == null ? String(v) : (Array.isArray(v) ? 'array' : typeof v) };
                if (Array.isArray(v)) {
                  info.len = v.length;
                  if (v.length && typeof v[0] === 'object' && v[0]) { var e0 = []; for (var q in v[0]) { e0.push(q); if (e0.length >= 25) break; } info.elem = e0; }
                  else if (v.length) { info.first = String(v[0]).slice(0, 60); }
                } else if (v != null && typeof v === 'object') { var ok = []; for (var q3 in v) { ok.push(q3); if (ok.length >= 25) break; } info.keys = ok; }
                else { info.val = String(v).slice(0, 60); }
                out.partyFields.push(info);
                if (out.partyFields.length >= 12) break;
              } catch (e) {}
            }
            if (SS.Entity) {
              var LOW2 = /party|member|team|group|队|组|follow/i;
              for (var k3 in SS.Entity) {
                try {
                  if (typeof SS.Entity[k3] === 'function') continue;
                  if (!LOW2.test(k3)) continue;
                  var v3 = SS.Entity[k3];
                  var info3 = { k: k3, type: v3 == null ? String(v3) : (Array.isArray(v3) ? 'array' : typeof v3) };
                  if (Array.isArray(v3)) {
                    info3.len = v3.length;
                    if (v3.length && typeof v3[0] === 'object' && v3[0]) { var f3 = []; for (var q4 in v3[0]) { f3.push(q4); if (f3.length >= 25) break; } info3.elem = f3; }
                  }
                  out.entParty[k3] = info3;
                } catch (e) {}
              }
            }
          }
          var emMods = ['Engine/EntityManager', 'EntityManager', 'Engine/Entities', 'Engine/EntityList', 'Engine/Entity', 'Game/EntityManager', 'Engine/Entity/EntityManager', 'Entity/EntityManager', 'Renderer/EntityManager', 'Engine/GameObject/EntityManager', 'Engine/EntityManager/EntityManager'];
          var EM = null;
          for (var e5 = 0; e5 < emMods.length; e5++) {
            var mm5 = reqSafe(PW, emMods[e5]);
            if (mm5 && typeof mm5 === 'object') { EM = mm5; out.emMod = emMods[e5]; break; }
          }
          if (EM) {
            var ek = [];
            for (var k6 in EM) { try { if (typeof EM[k6] === 'function') continue; ek.push(k6); if (ek.length >= 60) break; } catch (e) {} }
            out.emKeys = ek;
            var LIST = /entit|list|member|party|all|arr/i;
            for (var k7 in EM) {
              try {
                if (typeof EM[k7] === 'function') continue;
                if (!LIST.test(k7)) continue;
                var v7 = EM[k7];
                if (Array.isArray(v7)) {
                  var info7 = { k: k7, len: v7.length };
                  if (v7.length && typeof v7[0] === 'object' && v7[0]) { var e7 = []; for (var q8 in v7[0]) { e7.push(q8); if (e7.length >= 30) break; } info7.elem = e7; }
                  out.entityList = info7;
                  break;
                }
              } catch (e) {}
            }
            // v0.13.21：直接 EM.forEach 遍历实体，采集玩家实体(objecttype=0)作为队友候选（助手已在用此 API 找玩家/宠物）
            if (typeof EM.forEach === 'function') {
              var selfGID = null;
              try { if (SS && SS.Entity) selfGID = SS.Entity.GID; } catch (e0) {}
              var selfJob = null;
              try { if (SS && SS.Entity) selfJob = SS.Entity.job; } catch (e0j) {}
              var selfName = '';
              try { selfName = (SS && SS.Entity && SS.Entity.display && SS.Entity.display.name) || (SS && SS.Entity && SS.Entity.name) || (SS && SS.Character && SS.Character.name) || ''; } catch (e0n) {}
              var tms = [];
              try {
                EM.forEach(function (e) {
                  try {
                    if (!e || e.objecttype !== 0) return; // 仅玩家实体
                    if (selfGID != null && String(e.GID) === String(selfGID)) return; // 排除自己
                    var ti = { GID: e.GID };
                    ti.name = (e.display && e.display.name) || e.displayName || e.name || '';
                    if (e.position) ti.pos = [Math.round(e.position[0] * 10) / 10, Math.round(e.position[1] * 10) / 10];
                    if (e.job != null) ti.job = e.job;
                    if (e.clevel != null) ti.clevel = e.clevel;
                    // v0.13.28：枚举实体(含原型链)所有 job/class/appear 相关字段，定位真实职业字段（确认 e.job 是否=真实职业而非渲染外观 job）
                    var jobF = {};
                    try {
                      var seen = {}, cur = e, d0 = 0;
                      while (cur && d0 < 4) {
                        var pn = Object.getOwnPropertyNames(cur);
                        for (var pi = 0; pi < pn.length; pi++) {
                          var pnm = pn[pi];
                          if (seen[pnm]) continue; seen[pnm] = 1;
                          if (/job|class|appear|occupation/i.test(pnm)) {
                            try { jobF[pnm] = String(cur[pnm]).slice(0, 60); } catch (eJ0) { jobF[pnm] = 'ERR'; }
                          }
                        }
                        try { cur = Object.getPrototypeOf(cur); } catch (eJ1) { break; }
                        d0++;
                      }
                    } catch (eJ2) { jobF.err = String(eJ2 && eJ2.message || eJ2); }
                    ti.jobFields = jobF;
                    var dk = [];
                    if (e.display && typeof e.display === 'object') { for (var q in e.display) { dk.push(q); if (dk.length >= 30) break; } }
                    ti.displayKeys = dk;
                    // v0.13.23：枚举队友实体顶层字段 + 状态相关字段深采（定位队友 buff 状态源）
                    var ek = [];
                    for (var qe in e) { ek.push(qe); if (ek.length >= 40) break; }
                    ti.keys = ek;
                    var stF = {};
                    ['status', 'statuses', 'buff', 'buffs', 'icon', 'icons', 'efst', 'EFST', 'state', 'effect', 'effects', 'statusIcon', 'attachedStatus'].forEach(function (fn) {
                      try {
                        var fv = e[fn];
                        if (fv == null) return;
                        stF[fn] = { t: Array.isArray(fv) ? ('arr' + fv.length) : typeof fv };
                        if (Array.isArray(fv) && fv.length) {
                          var f0 = fv[0];
                          var kk = [];
                          if (f0 && typeof f0 === 'object') { for (var qf in f0) { kk.push(qf); if (kk.length >= 20) break; } }
                          stF[fn].elem = kk;
                          try { stF[fn].sample = JSON.stringify(f0).slice(0, 180); } catch (eS) {}
                        } else if (fv && typeof fv === 'object') {
                          var kk2 = [];
                          for (var qf2 in fv) { kk2.push(qf2); if (kk2.length >= 20) break; }
                          stF[fn].keys = kk2;
                        }
                      } catch (eS2) {}
                    });
                    ti.statusFields = stF;
                    // v0.13.25：采队友实体特效/动画/颜色字段（定位队友 buff 状态渲染源，顶层无 status/buff 则看特效附件）
                    var fx = {};
                    ['attachments', 'animations', 'effectColor', '_effectStateColor', '_bodyStateColor', '_healthStateColor', '_virtueColor', '_flashColor'].forEach(function (fxn) {
                      try {
                        var fxv = e[fxn];
                        if (fxv == null) return;
                        if (Array.isArray(fxv)) {
                          fx[fxn] = { t: 'arr' + fxv.length };
                          if (fxv.length) {
                            try { fx[fxn].sample = JSON.stringify(fxv[0]).slice(0, 240); } catch (e0) {}
                            try {
                              var ak = [];
                              var a0 = fxv[0];
                              if (a0 && typeof a0 === 'object') { for (var aq in a0) { ak.push(aq); if (ak.length >= 16) break; } }
                              fx[fxn].elem = ak;
                            } catch (e1) {}
                          }
                        } else if (typeof fxv === 'object') {
                          var ak2 = [];
                          for (var aq2 in fxv) { ak2.push(aq2); if (ak2.length >= 16) break; }
                          fx[fxn] = { t: 'obj', keys: ak2 };
                          // v0.13.26：attachments/animations 探 list 数组内容（buff 特效附件）；颜色字段读 0/1/2/3 实际值
                          try {
                            var lst = fxv.list;
                            if (Array.isArray(lst)) {
                              fx[fxn].listLen = lst.length;
                              if (lst.length) {
                                var li = lst[0];
                                var lk = [];
                                if (li && typeof li === 'object') { for (var lq in li) { lk.push(lq); if (lk.length >= 16) break; } }
                                fx[fxn].listElem = lk;
                                try { fx[fxn].listSample = JSON.stringify(li).slice(0, 260); } catch (eL) {}
                              }
                            }
                          } catch (eL2) {}
                          if (/Color/.test(fxn)) {
                            try { fx[fxn].vals = [String(fxv[0]).slice(0, 24), String(fxv[1]).slice(0, 24), String(fxv[2]).slice(0, 24), String(fxv[3]).slice(0, 24)]; } catch (eC) {}
                          }
                        } else {
                          fx[fxn] = { t: typeof fxv, v: String(fxv).slice(0, 40) };
                        }
                      } catch (e2) {}
                    });
                    ti.fxFields = fx;
                    tms.push(ti);
                    if (tms.length >= 30) return;
                  } catch (e1) {}
                });
              } catch (e2) { out.forEachErr = String(e2 && e2.message || e2); }
              out.selfGID = selfGID;
              out.selfJob = selfJob;
              out.selfName = selfName;
              out.teammates = tms;
            }
          }
          // v0.13.20 扩展：Character 深字段 + 全局 window party 键 + require 模块缓存（定位队友列表第二源）
          try {
            if (SS && SS.Character && typeof SS.Character === 'object') {
              var cf = [];
              for (var ck in SS.Character) {
                try {
                  if (typeof SS.Character[ck] === 'function') continue;
                  var cv = SS.Character[ck];
                  var ci = { k: ck, t: Array.isArray(cv) ? ('arr' + cv.length) : typeof cv };
                  if (Array.isArray(cv) && cv.length) {
                    if (typeof cv[0] === 'object' && cv[0]) { var cf0 = []; for (var cq in cv[0]) { cf0.push(cq); if (cf0.length >= 20) break; } ci.elem = cf0; }
                    else { ci.first = String(cv[0]).slice(0, 40); }
                  } else if (cv != null && typeof cv === 'object') { var cfk = []; for (var cr in cv) { cfk.push(cr); if (cfk.length >= 20) break; } ci.keys = cfk; }
                  cf.push(ci);
                  if (cf.length >= 50) break;
                } catch (e) {}
              }
              out.charFields = cf;
            }
          } catch (e) {}
          try {
            var wk = [];
            var LOW3 = /party|team|member|group|队|组/i;
            for (var wk0 in PW) {
              try {
                if (wk0 === 'window' || wk0 === 'self' || wk0 === 'frames' || wk0 === 'top' || wk0 === 'parent') continue;
                if (!LOW3.test(wk0)) continue;
                var wv = PW[wk0];
                var wi = { k: wk0, t: Array.isArray(wv) ? ('arr' + wv.length) : typeof wv };
                if (Array.isArray(wv) && wv.length) { if (typeof wv[0] === 'object' && wv[0]) { var ww = []; for (var wq in wv[0]) { ww.push(wq); if (ww.length >= 20) break; } wi.elem = ww; } }
                wk.push(wi);
              } catch (e) {}
              if (wk.length >= 20) break;
            }
            out.winPartyKeys = wk;
          } catch (e) {}
          try {
            var RC = PW.require && PW.require.cache;
            if (RC) {
              var rp = [], re2 = [];
              for (var rk in RC) { if (/party|team|group|member/i.test(rk)) { rp.push(rk); if (rp.length >= 30) break; } }
              for (var rk3 in RC) { if (/entit/i.test(rk3)) { re2.push(rk3); if (re2.length >= 30) break; } }
              out.reqParty = rp;
              out.reqEntity = re2;
            }
          } catch (e) {}
        } catch (e) { out.err = String(e && e.message || e); }
        return out;
      }
      // v0.13.22：读内挂「辅助选择」DOM——扫所有 select 控件 + 队伍/辅助相关 option，定位内挂的队伍成员/辅助对象数据源（借鉴内挂同源队友数据）
      function collectBotAssistDom() {
        var out = { selects: [], teamOpts: [], buttons: [] };
        try {
          var sels = document.querySelectorAll('select');
          for (var i = 0; i < sels.length && i < 30; i++) {
            var s = sels[i];
            var opts = [];
            for (var j = 0; j < s.options.length && j < 10; j++) {
              var o = s.options[j];
              opts.push({ t: String(o.textContent || '').trim().slice(0, 24), v: String(o.value || '').slice(0, 20), id: o.getAttribute('data-index') || o.getAttribute('data-id') || '' });
            }
            out.selects.push({ cls: String(s.className || s.id || '').slice(0, 40), n: s.options.length, opts: opts });
          }
          var allopts = document.querySelectorAll('option');
          var hit = 0;
          for (var k = 0; k < allopts.length && hit < 15; k++) {
            var o2 = allopts[k];
            var raw = String((o2.textContent || '') + '|' + (o2.value || '') + '|' + (o2.getAttribute('data-index') || o2.getAttribute('data-id') || ''));
            if (/队伍|队友|输出|辅助|帮|补|跟随|目标|成员|party|team|target|heal|buff/i.test(raw)) {
              out.teamOpts.push(raw.slice(0, 60));
              hit++;
            }
          }
          // v0.13.24：扫按钮/勾选框/可点击元素（找内挂「开始挂机/停止挂机」开关，之前只扫 select 找不到）
          try {
            var qb = document.querySelectorAll('button, input[type=checkbox], input[type=button], input[type=submit], [onclick], [class*=attack], [class*=open], [class*=start], [class*=stop], [class*=btn], [class*=auto]');
            for (var bi = 0; bi < qb.length && bi < 50; bi++) {
              var b = qb[bi];
              var tx = String((b.textContent || b.value || b.title || '')).trim().replace(/\s+/g, ' ').slice(0, 28);
              var clsb = String(b.className || b.id || '').slice(0, 44);
              var chkb = (b.type === 'checkbox') ? ('checked=' + !!b.checked) : (b.type || b.tagName || '');
              out.buttons.push({ cls: clsb, txt: tx, type: chkb });
            }
          } catch (eb) {}
        } catch (e) { out.err = String(e && e.message || e); }
        return out;
      }
      // v0.13.16：仓库结构二次深探——ITEM 分类值展开（HEALING 等键的值是数组还是对象， Storage 全键名枚举（找物品列表源）
function collectStorageDeep(inst) {
        try {
          if (!inst) return null;
          var base = collectInstDataDeep(inst, ['ITEM', 'TAB', 'ORDER']);
          var out = { base: base, itemChildren: null, keysFull: null };
          try {
            var it = inst.ITEM;
            if (it && typeof it === 'object' && !Array.isArray(it)) {
              var ch = [];
              for (var ck in it) {
                var cv = it[ck];
                var cr = { k: ck, type: cv == null ? String(cv) : (Array.isArray(cv) ? 'array' : typeof cv) };
                if (Array.isArray(cv)) {
                  cr.len = cv.length;
                  if (cv.length && typeof cv[0] === 'object' && cv[0]) {
                    var e0 = []; for (var q in cv[0]) { e0.push(q); if (e0.length >= 10) break; }
                    cr.elem = e0;
                  } else if (cv.length) { cr.first = String(cv[0]).slice(0, 40); }
                } else if (cv != null && typeof cv === 'object') {
                  var ok = []; for (var q2 in cv) { ok.push(q2); if (ok.length >= 10) break; }
                  cr.keys = ok;
                } else { cr.val = String(cv).slice(0, 40); }
                ch.push(cr);
                if (ch.length >= 30) break;
              }
              out.itemChildren = ch;
            }
          } catch (e) {}
          try {
            var kf = [];
            for (var k in inst) { kf.push(k); if (kf.length >= 200) break; }
            out.keysFull = kf;
          } catch (e) {}
          return out;
        } catch (e) { return null; }
      }
      function collectInstData(inst) {
        try {
          if (!inst) return null;
          var keys = [], arrays = [];
          for (var k in inst) {
            try {
              if (typeof inst[k] === 'function') continue;
              keys.push(k);
              if (keys.length >= 40) break;
            } catch (e2) {}
          }
          for (var i = 0; i < keys.length; i++) {
            try {
              var v = inst[keys[i]];
              if (v == null || typeof v !== 'object') continue;
              if (Array.isArray(v)) {
                var itemKeys = null;
                if (v.length > 0 && typeof v[0] === 'object' && v[0]) {
                  itemKeys = [];
                  for (var f in v[0]) { itemKeys.push(f); if (itemKeys.length >= 10) break; }
                }
                arrays.push({ k: keys[i], len: v.length, elem: itemKeys || (v.length ? typeof v[0] : 'empty') });
              }
            } catch (e3) {}
          }
          return { keys: keys, arrays: arrays };
        } catch (e) { return null; }
      }
  function collectDomCheck() {
    try {
      var fb = findChatBorder();
      var html = '';
      try {
        var root = document.querySelector('#chatbox') || (fb && fb.el && fb.el.closest && fb.el.closest('#chatbox, .chatbox')) || (fb ? fb.el : null);
        if (root) html = String(root.outerHTML || '').slice(0, 1800);
      } catch (e) {}
      postCollect(buildCollectPayload(collectChatTail(40), 'domcheck:' + (fb ? collectSel : 'NONE'), {
        dom: { chatboxHtml: html, chatboxExists: !!document.querySelector('#chatbox'), pCount: fb ? fb.el.querySelectorAll('p').length : 0 }
      }));
      addLog('↑', 'CFG', 'DOM自检已回传（chatbox=' + (fb ? (collectSel || '?') : '未命中') + ' p=' + (fb ? fb.el.querySelectorAll('p').length : 0) + '）');
      // v0.13.10：背包仓库/装备结构（打开窗口时点自检最即时；定时回传另同60s 节流自动采）
      try {
        lastInvAt = Date.now();
        var domInv2 = collectInvStructure();
        if (domInv2 && domInv2.found) {
          postCollect(buildCollectPayload([], 'domboost:' + domInv2.wins.map(function (w) { return w.win; }).join(','), { domInv: domInv2 }));
          addLog('↑', 'CFG', '背包结构采集: ' + domInv2.wins.map(function (w) { return w.win + '(' + w.slotCount + ')'; }).join(','));
        } else {
          addLog('↑', 'CFG', '背包结构采集: 未发现打开的背包/仓库/装备窗口');
        }
      } catch (e) {}
    } catch (e) { addLog('↑', 'CFG', 'DOM自检异常: ' + e.message); }
  }
  function collectChatTail(maxN) {
    // 多候选容器：抓最近N 行（含颜色样式），命中「开启关闭自动战斗」单独标计
var out = [];
    try {
      var fb = findChatBorder();
      if (!fb) return out;
      var ps = fb.el.querySelectorAll('p');
      var from = Math.max(0, ps.length - (maxN || 20));
      for (var i = from; i < ps.length; i++) {
        var txt = (ps[i].textContent || '').trim();
        if (!txt) continue;
        var color = (ps[i].style && ps[i].style.color) || '';
        out.push({ i: i, txt: txt, color: color, atk: /开启自动战斗|关闭自动战斗/.test(txt) });
      }
    } catch (e) {}
    return out;
  }
  function collectPanelState() {
    try {
      // v0.13.0：多候选选择器（无.openattack 一旦 unchecked，可能是层级/类名变了）
      var sels = ['.openattack', '[class*="openattack" i]', '[class*="openAttack" i]', '#autoattack', '[class*="autoatk" i]', '[class*="AutoAttack" i]', '[id*="autoatk" i]', '[id*="openatk" i]'];
      var cb = null, hit = '';
      for (var si2 = 0; si2 < sels.length; si2++) {
        var el0 = document.querySelector(sels[si2]);
        if (el0) { cb = el0; hit = sels[si2]; break; }
      }
      return { openattack: cb ? (cb.checked ? 'checked' : 'unchecked') : null, hasCb: !!cb, hit: hit };
    } catch (e) { return { openattack: null }; }
  }
  // v0.13.20：RAF hook 改到页面真实 window + 所有 iframe（沙箱 window 捕不到游戏渲染，致 v0.13.19 raf 恒 0）
  // 统计前台/后台触发频率 + 按来源区分（top/各 iframe/沙箱），定位游戏循环走哪条渲染链路、是否逐帧渲染驱动。
  var rafStat = { v: 0, h: 0, src: {}, frCount: 0, t0: Date.now() };
  function rafHookWin(w, tag) {
    try {
      if (!w || !w.requestAnimationFrame || w.requestAnimationFrame.__dshRaf) return false;
      var orig = w.requestAnimationFrame.bind(w);
      var wrap = function (cb) {
        return orig(function (ts) {
          if (document.hidden) rafStat.h++; else rafStat.v++;
          rafStat.src[tag] = (rafStat.src[tag] || 0) + 1;
          try { cb(ts); } catch (e) {}
        });
      };
      wrap.__dshRaf = true;
      try { w.requestAnimationFrame = wrap; return true; } catch (e) { return false; }
    } catch (e) { return false; }
  }
  function rafHookAll() {
    var PW = pageWindow();
    try { if (PW && PW !== window) rafHookWin(PW, 'top'); } catch (e) {}
    try { rafHookWin(window, 'sbox'); } catch (e) {}
    try {
      var fs = (PW && PW.frames) ? PW.frames : window.frames;
      rafStat.frCount = fs.length;
      for (var i = 0; i < fs.length; i++) rafHookWin(fs[i], 'f' + i);
    } catch (e) {}
  }
  rafHookAll();
  setInterval(rafHookAll, 3000); // iframe 可能晚加载，定期重扫补 hook

  function buildCollectPayload(tail, reason, extra) {
    var p = {
      v: '0.13.28',
      ts: new Date().toISOString(),
      reason: reason,
      url: location.href.slice(0, 200),
      device: collectDeviceInfo(),
      panel: collectPanelState(),
      net: { // v0.13.0 网络自检：判断WebSocket hook 是否真生效（沙箱隔离排查）
        patched: netDiag.wsPatched, unsafe: netDiag.wsUnsafe, err: netDiag.hookErr,
        rx: netDiag.recvCount, tx: netDiag.sendCount, firstPktAt: netDiag.firstPktAt
      },
      chatSel: collectSel,   // v0.10.0 命中的聊天容器选择器（自我诊断）
      chatPCnt: collectPCnt,
      chat: tail,
      srv: serverPktRing.slice(-10), // v0.10.0 服务器入站包证据
      sk: skillFrames.slice(-10),    // v0.11.0 出站技能发包（来源判定）
      map: mapEvents.slice(-4),      // v0.11.0 地图切换事件
      diag: collectDiagTail(),        // v0.11.0 助手诊断事件环尾部
      flow: behaviorRing.slice(-40),  // v0.12.0 角色行为流水（技能发/ACK受理/状态变化，排bug 用）
      status: statusFlow.slice(-30),  // v0.12.0 状态变化流水（StatusIcons 上身/消失）
      ackOk: ackMatched.slice(-15),   // v0.12.0 已受理技能
      ackBad: ackTimeout.slice(-15),  // v0.12.0 未受理技能（该放不放的铁证）
      raf: (function () {             // v0.13.20 RAF 帧率探测（多 window/iframe + 来源 src 区分；读后重置窗口）
        var dt = (Date.now() - rafStat.t0) / 1000;
        var r = { v: rafStat.v, h: rafStat.h, dtSec: Math.round(dt), visibleFps: Math.round(rafStat.v / Math.max(1, dt)), hiddenFps: Math.round(rafStat.h / Math.max(1, dt)), frCount: rafStat.frCount, src: rafStat.src };
        rafStat.v = 0; rafStat.h = 0; rafStat.src = {}; rafStat.t0 = Date.now();
        return r;
      })()
    };
    var mm0 = null, me0 = null;
    try { mm0 = probeMiniMap(); } catch (e) { mm0 = { err: String(e && e.message || e) }; }
    try { me0 = probeMe(); } catch (e) { me0 = { err: String(e && e.message || e) }; }
    if (mm0) { mm0.moveTail = moveTail.slice(); p.mm = mm0; }
    p.me = me0;                  // v0.13.3 玩家坐标 + 出站帧hex + 未知包取证（v0.13.4 调用点兜底try）
    if (capt.ring.length) p.cap = { t0: capt.t0, n: capt.ring.length, ring: capt.ring.slice() }; // v0.13.6 案例捕获环
    if (calibRing.length) p.cb = calibRing.slice(); // v0.13.9 标定样本（大地图点击像素↔到达坐标）
    // v0.13.10：背包仓库/装备结构自动采集：0s 节流：开着背包/仓库窗口时，1-2 次回传内自动带上）
    try {
      var nowI = Date.now();
      if (nowI - lastInvAt > 60000) {
        lastInvAt = nowI;
        // v0.13.16：collectInvStructure 独立 try（抛错不再吞掉后续ssProbe）
try {
          var domInv0 = collectInvStructure();
          if (domInv0 && domInv0.found) p.domInv = domInv0;
        } catch (eI) { p._invErr = String(eI && eI.message || eI).slice(0, 120); }
        // v0.13.16/16：装备角色数据源探测（SessionStorage 模块名枚举）——无论成败异常，ssProbe 必写
        var ssProbe;
        try {
          var entD = collectEntityData();
          ssProbe = { found: !!(entD && entD.entity), tried: (entD && entD.tried) || [], err: (entD && entD.err) || "" };
          if (entD && entD.entity) p.entity = entD.entity;
        } catch (eS) { ssProbe = { found: false, tried: [], err: 'THROW: ' + String(eS && eS.message || eS).slice(0, 160) }; }
        p.ssProbe = ssProbe;
        // v0.13.18：队友 party 数据源探测（队友列表 + 字段 + 状态源）
        try {
          var partyD = collectPartyData();
          p.party = partyD;
        } catch (eP) { p._partyErr = 'THROW: ' + String(eP && eP.message || eP).slice(0, 160); }
        // v0.13.22：内挂「辅助选择」DOM 探测（扫 select + 队伍/辅助 option，定位内挂队友数据源）
        try {
          p.bot = collectBotAssistDom();
        } catch (eB) { p._botErr = 'THROW: ' + String(eB && eB.message || eB).slice(0, 160); }
      }
    } catch (e) {}
    if (extra) { for (var ek in extra) p[ek] = extra[ek]; }
    return p;
  }
  // v0.11.0：读助手 window.__dshDiag 诊断事件环（zhu-start/zhu-stop/map-change/np-calibrate/cast/cast-skip 等）
  // v0.13.1：__dshDiag 是助手写在页面真实window 上的，必须走 pageWindow()（沙箱window 读不到）
  function collectDiagTail() {
    try {
      var d = pageWindow() && pageWindow().__dshDiag;
      if (!Array.isArray(d)) return null;
      return d.slice(-24);
    } catch (e) { return null; }
  }
  // v0.13.4：RequireJS 模块安全加载——页面加载早期同步require 未加载模块会触发 notloaded）
  // 错误经页面onError 重抛路径击穿 try/catch 导致 roBrowser 初始化崩溃（Whoops! 页）。
  // 正解=defined 守卫：模块已加载才同步require，未加载直接返回 null，绝不触发该错误
  function reqSafe(PW, name) {
    try {
      if (!PW || !PW.require) return null;
      var r = PW.require;
      if ((typeof r.defined === 'function') && !r.defined(name)) return null;
      return r(name);
    } catch (e) { return null; }
  }
  // v0.13.2：小地图（MiniMap）探测——确认页面MiniMap 是否自带「点选走路」，以及坐标换算所需信息、  // 采集：MiniMap 类原型方法名 + 实例属性快照+ DOM 结构 + 当前地图键名列表（地图尺寸字段名未知，先回传 keys 再定）
function probeMiniMap() {
    var out = { methods: null, inst: null, dom: null, map: null };
    try {
      var PW = pageWindow();
      if (!PW || !PW.require) return out;
      // ⑁MiniMap 类原型方法
try {
        var MM = reqSafe(PW, 'UI/Components/MiniMap/MiniMap');
        if (MM && MM.prototype) {
          out.methods = Object.getOwnPropertyNames(MM.prototype).filter(function (n) { return n !== 'constructor'; });
        }
      } catch (e) { out.mErr = String(e && e.message || e); }
      // ⑁实例属性快照（数倀布尔/字符一+ 含坐标缩放的小对象）
      try {
        var UM = reqSafe(PW, 'UI/UIManager');
        var inst = null;
        if (UM) {
          try { if (typeof UM.get === 'function') inst = UM.get('MiniMap'); } catch (e2) {}
          if (!inst && UM.components) inst = UM.components['MiniMap'] || null;
          if (!inst && UM.instance && UM.instance.components) inst = UM.instance.components['MiniMap'] || null;
        }
        if (inst && typeof inst === 'object') {
          var snap = {};
          for (var k in inst) {
            try {
              var v = inst[k];
              if (v === null || v === undefined) { snap[k] = null; continue; }
              var t = typeof v;
              if (t === 'number' || t === 'boolean' || t === 'string') snap[k] = v;
              else if (t === 'object' && v !== inst && (v.x !== undefined || v.min !== undefined || v.scale !== undefined || v.width !== undefined)) {
                snap[k] = JSON.stringify(v).slice(0, 120);
              }
            } catch (e3) {}
            if (Object.keys(snap).length > 60) break;
          }
          out.inst = snap;
          // v0.13.9：实例全量键名（等walk/moveTo/setDest 类「设置移动目标」API）
try { out.instKeys = Object.getOwnPropertyNames(inst).slice(0, 160); } catch (e4) {}
        }
      } catch (e) { out.iErr = String(e && e.message || e); }
      // ⑁DOM 结构摘要（是否Canvas、尺寸）
      try {
        var els = document.querySelectorAll('.minimap, [class*="MiniMap"], [class*="minimap"], #minimap');
        if (!els.length) els = document.querySelectorAll('canvas');
        if (els.length) {
          var elp = els[0];
          out.dom = { tag: elp.tagName, cls: String(elp.className || '').slice(0, 120), w: elp.clientWidth, h: elp.clientHeight, innerCanvas: !!elp.querySelector('canvas'), isCanvas: elp.tagName === 'CANVAS' };
        }
      } catch (e) { out.dErr = String(e && e.message || e); }
      // ⑁当前地图：原始key（含 .gar 等后缀，v0.13.3 修复 split 丢后缀， coordinate 值（地图尺寸/边界，坐标换算必需）
try {
        var MR = reqSafe(PW, 'Renderer/MapRenderer');
        var DB = reqSafe(PW, 'DB/DBManager');
        var mkRaw = MR && MR.currentMap ? String(MR.currentMap) : '';
        var mkA = mkRaw.split('.')[0] || mkRaw;
        var wd = null;
        if (mkRaw && DB && typeof DB.getworldData === 'function') { try { wd = DB.getworldData(mkRaw); } catch (e2) {} }
        if (!wd && mkA !== mkRaw && DB && typeof DB.getworldData === 'function') { try { wd = DB.getworldData(mkA); } catch (e3) {} }
        if (mkRaw) out.map = { keyRaw: mkRaw, key: mkA, name: (wd && wd.name) || null, coordinate: (wd && wd.coordinate !== undefined) ? JSON.stringify(wd.coordinate).slice(0, 200) : null, keys: wd ? Object.keys(wd).slice(0, 40) : null };
      } catch (e) { out.mapErr = String(e && e.message || e); }
    } catch (e) { out.err = String(e && e.message || e); }
    return out;
  }
  // v0.13.3：玩家自身快照（坐标 + 发送帧 hex 取证）——「输入XY坐标自动走」的坐标基准与客户端移动包格式取证
  // v0.13.4：require 全部走reqSafe（defined 守卫）——修 Whoops 页崩溃（同步 require('Client') 在初始化早期触发 RequireJS notloaded）
  // v0.13.5：坐标源修正——私服无 'Client' 单例，助手用 Engine/SessionStorage（SS.Entity.position）；兼容双路径
  function probeMe() {
    var out = { pos: null, mapRaw: null, sendHex: sendHexRing.slice(), unknown: unknownRing.slice(), atkMoves: atk.moves };
    try {
      var PW = pageWindow();
      if (!PW) return out;
      var CL = null;
      try { CL = PW.CLIENT || null; } catch (e) {}
      if (!CL || !CL.SS) { CL = reqSafe(PW, 'Engine/SessionStorage'); }
      var ent = null;
      if (CL) { ent = CL.Entity || (CL.SS && CL.SS.Entity) || null; }
      if (ent && ent.position) {
        out.pos = [ent.position[0], ent.position[1], ent.position[2]];
      }
      try {
        var MR2 = reqSafe(PW, 'Renderer/MapRenderer');
        if (MR2 && MR2.currentMap) out.mapRaw = String(MR2.currentMap);
      } catch (e3) {}
    } catch (e) { out.err = String(e && e.message || e); }
    return out;
  }
  function postCollect(payload, fromQueue) {
    try {
      var body = JSON.stringify(payload);
      var fail = function () {
        addLog('↑', 'CFG', '回执回传失败（本机服务器不可达，已入队30s 重试）');
        if (!fromQueue) { collectQueue.push({ ts: Date.now(), payload: payload }); collectQueue = collectQueue.slice(-20); queueSave(); }
      };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST', url: COLLECT_URL, data: body, timeout: 6000,
          headers: { 'Content-Type': 'application/json' },
          onload: function (r) {
            if (r && r.status === 200) {
              addLog('↑', 'CFG', '回执已回传(HTTP 200)');
              if (!fromQueue && collectQueue.length) { collectQueue = []; queueSave(); } // 成功顺清积压
            } else fail();
          },
          onerror: function () { fail(); },
          ontimeout: function () { fail(); }
        });
        return;
      }
      addLog('↑', 'CFG', '无GM_xmlhttpRequest，无法回传');
    } catch (e) { addLog('↑', 'CFG', '回传异常: ' + e.message); }
  }
  // 手动采集：抓当前聊天尀+ 设备信息回传（含命中选择器自检）
function collectNow(reason) {
    var tail = collectChatTail(30);
    var atkHits = tail.filter(function (x) { return x.atk; });
    postCollect(buildCollectPayload(tail, reason || 'manual'));
    addLog('↑', 'CFG', '已采集聊天' + tail.length + ' 行（命中 ' + (collectSel || '无') + '），开关回执' + atkHits.length + ' 条→' + COLLECT_URL + (atkHits.length ? '' : '；无回执=需先开/关自动战斗或换候选层'));
  }
  // 自动采集：增量扫描聊天框新行 + MutationObserver，出现「开启关闭自动战斗」回执即回传（防抖1.5s）
function tickAutoCollect() {
    try {
      var fb = findChatBorder();
      if (!fb) { return; }
      ensureChatObserver();
      var ps = fb.el.querySelectorAll('p');
      if (ps.length < collectSeenCount) collectSeenCount = 0; // 清空过
var found = null;
      for (var i = collectSeenCount; i < ps.length; i++) {
        var txt = (ps[i].textContent || '');
        if (/开启自动战斗|关闭自动战斗/.test(txt)) { found = txt.trim(); }
      }
      collectSeenCount = Math.max(collectSeenCount, ps.length);
      if (found && Date.now() - collectLastPost > 1500) {
        collectLastPost = Date.now();
        postCollect(buildCollectPayload(collectChatTail(30), 'auto:' + found));
        addLog('↑', 'CFG', '自动采集开关回执 ' + found);
      }
    } catch (e) {}
  }

  /* ==================== UI ==================== */
  var PANEL_CSS =
    '#dsh-probe-btn{position:fixed;right:8px;bottom:72px;z-index:2147483647;width:46px;height:46px;border-radius:50%;background:rgba(30,60,120,.92);color:#fff;font-size:20px;line-height:46px;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);user-select:none;-webkit-user-select:none;font-family:sans-serif}' +
    '#dsh-probe-panel{position:fixed;right:8px;bottom:124px;z-index:2147483647;width:min(94vw,460px);max-height:60vh;display:flex;flex-direction:column;background:rgba(16,20,28,.96);border:1px solid rgba(255,255,255,.18);border-radius:10px;color:#e8e8e8;font-family:Menlo,Consolas,monospace;font-size:11px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
    '#dsh-probe-panel .head{display:flex;align-items:center;gap:6px;padding:7px 10px;background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.12)}' +
    '#dsh-probe-panel .head .ttl{flex:1;font-weight:bold;font-size:12px}' +
    '#dsh-probe-panel .head button{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer}' +
    '#dsh-probe-panel .head button:active{background:rgba(255,255,255,.25)}' +
    '#dsh-probe-panel .filters{display:flex;flex-wrap:wrap;gap:4px 10px;padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px}' +
    '#dsh-probe-panel .filters label{cursor:pointer;display:flex;align-items:center;gap:3px}' +
    '#dsh-probe-panel .atkcard{flex:none;padding:6px 10px;background:rgba(120,180,255,.08);border-bottom:1px solid rgba(255,255,255,.12);font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-all}' +
    '#dsh-probe-panel .body{flex:1;overflow-y:auto;padding:6px 8px;min-height:80px}' +
    '#dsh-probe-panel .log{line-height:1.5;white-space:pre-wrap;word-break:break-all}' +
    '#dsh-probe-panel .log .t{color:#8a8f9c;margin-right:6px}' +
    '#dsh-probe-panel .log .up{color:#7ec8ff}' +
    '#dsh-probe-panel .log .down{color:#9fe6a0}' +
    '#dsh-probe-panel .log .cat{color:#ffd479;margin:0 4px}' +
    '#dsh-probe-panel .empty{color:#6a6f7c;text-align:center;padding:14px 0}' +
    '#dsh-probe-status{position:fixed;left:8px;bottom:8px;z-index:2147483647;background:rgba(0,0,0,.55);color:#9fe6a0;font-size:10px;padding:3px 8px;border-radius:4px;font-family:monospace}';

  function injectCSS() {
    var st = document.createElement('style');
    st.textContent = PANEL_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var filters = { CFG: true, AUTOSPELL: true, SKILL: true, EFFECT: true, STATUS: true, HP: false, ATK: true, CMD: true, MOVE: false };
  var panelOpen = false;
  var panelEl = null;

  function buildUI() {
    injectCSS();
    var btn = document.createElement('div');
    btn.id = 'dsh-probe-btn';
    btn.textContent = '📡';
    btn.title = '内挂联动探针';
    btn.addEventListener('click', function () { togglePanel(); });
    document.documentElement.appendChild(btn);

    var status = document.createElement('div');
    status.id = 'dsh-probe-status';
    status.textContent = '探针启动中…';
    document.documentElement.appendChild(status);

    panelEl = document.createElement('div');
    panelEl.id = 'dsh-probe-panel';
    panelEl.style.display = 'none';

    var head = document.createElement('div');
    head.className = 'head';
    var ttl = document.createElement('span');
    ttl.className = 'ttl';
    var _pv = '0.13.22';
    try { if (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) _pv = GM_info.script.version; } catch (e) {}
    ttl.textContent = '📡 内挂联动探针 v' + _pv;
    var btnCfg = document.createElement('button');
    btnCfg.textContent = '读配置';
    btnCfg.title = '通过客户竀NetworkManager 发退CZ.NOTIFY_LOADINFO(2815)（正统发包，不掉线）';
    btnCfg.addEventListener('click', function () {
      // v0.13.1：不再裸发probeSocket.send ——私服出站有封裀校验，裸帧被服务器判非法踢线　      //   改走客户竀NetworkManager.sendPacket（与助手同路径），构退CZ.NOTIFY_LOADINFO 包
try {
        var PW = pageWindow();
        var NM = reqSafe(PW, "Network/NetworkManager");
        var PS = reqSafe(PW, "Network/PacketStructure");
        if (!NM || !NM.sendPacket || !PS || !PS.CZ || !PS.CZ.NOTIFY_LOADINFO) {
          addLog('→', 'CFG', '客户端 NetworkManager 未就绪，无法请求配置');
          return;
        }
        var ps = new PS.CZ.NOTIFY_LOADINFO();
        NM.sendPacket(ps);
        addLog('→', 'CFG', '已通过 NetworkManager 发送 NOTIFY_LOADINFO(2815) 请求内挂配置');
      } catch (e) {
        addLog('→', 'CFG', '发包异常: ' + (e && e.message || e));
      }
    });
    var btnCopy = document.createElement('button');
    btnCopy.textContent = '复制全部';
    btnCopy.addEventListener('click', copyAll);
    var btnCollect = document.createElement('button');
    btnCollect.textContent = '采集';
    btnCollect.title = '抓聊天框开关回执设备信息 →回传本机 8899';
    btnCollect.addEventListener('click', function () { collectNow('manual'); });
    var btnSelf = document.createElement('button');
    btnSelf.textContent = '自检';
    btnSelf.title = 'DOM 自检：聊天框结构+选择器命中→回传，便于定位';
    btnSelf.addEventListener('click', function () { collectDomCheck(); });
    var btnClear = document.createElement('button');
    btnClear.textContent = '清空';
    btnClear.addEventListener('click', function () { logs = []; renderLogs(); });
    // v0.13.6 案例捕获按钮：内挂传送全链路取证
    var btnCapt = document.createElement('button');
    btnCapt.id = 'dsh-probe-capt';
    btnCapt.textContent = '开始捕获';
    btnCapt.title = '案例捕获：记录后续 120s 全部出站/入站包（内挂传送→落地走到 NPC→对话全链路取证），再点一次停止';
    btnCapt.style.borderColor = '#e8c15c';
    btnCapt.addEventListener('click', function () {
      if (capt.on) { stopCapt(); btnCapt.textContent = '开始捕获'; btnCapt.style.borderColor = '#e8c15c'; }
      else { startCapt(); btnCapt.textContent = '停止捕获'; btnCapt.style.borderColor = '#f0a0a0'; }
    });
    head.appendChild(ttl); head.appendChild(btnCfg); head.appendChild(btnCollect); head.appendChild(btnCapt); head.appendChild(btnSelf); head.appendChild(btnCopy); head.appendChild(btnClear);

    var filtersEl = document.createElement('div');
    filtersEl.className = 'filters';
    var cats = [['CFG', '配置'], ['AUTOSPELL', '念咒'], ['SKILL', '技能'], ['EFFECT', '特效'], ['STATUS', '状态'], ['CMD', '指挥'], ['ATK', '普攻'], ['HP', 'HP/SP'], ['MOVE', '移动']];
    for (var i = 0; i < cats.length; i++) {
      (function (key, label) {
        var lb = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = filters[key];
        cb.addEventListener('change', function () { filters[key] = cb.checked; renderLogs(); });
        lb.appendChild(cb);
        lb.appendChild(document.createTextNode(label));
        filtersEl.appendChild(lb);
      })(cats[i][0], cats[i][1]);
    }

    var atkCard = document.createElement('div');
    atkCard.className = 'atkcard';
    atkCard.id = 'dsh-probe-atkcard';
    atkCard.textContent = '攻击分析：等待数据…';

    var body = document.createElement('div');
    body.className = 'body';

    panelEl.appendChild(head);
    panelEl.appendChild(filtersEl);
    panelEl.appendChild(atkCard);
    panelEl.appendChild(body);
    document.documentElement.appendChild(panelEl);
    // v0.13.8：事件隔离（仿助手面板操作孤岛）——点探针 UI 不再穿透到后面游戏层（人物误移动）
    isolateProbeUI();
    // v0.13.11：标定监听（document 事件委托，元素后廀重建不影响）
    startCalibListener();

    ui = {
      onLog: function () { if (panelOpen) { renderAtkCard(); renderLogs(); } else updateStatus(); },
      body: body,
      atkCard: atkCard,
      status: status
    };
    updateStatus();
    renderAtkCard();
    renderLogs();
  }

  function updateStatus() {
    if (!ui) return;
    var cfg = logs.filter(function (l) { return l.cat === 'CFG'; }).length;
    var sk = logs.filter(function (l) { return l.cat === 'SKILL' || l.cat === 'AUTOSPELL'; }).length;
    var regTxt = known ? ('关键包 ' + regMatched + '/' + REG_WANTS.length) : '未注册';
    ui.status.textContent = known ? ('已监听 · ' + regTxt + ' · 配置包 ' + cfg + ' · 技能包 ' + sk + ' · 攻击 ' + atk.acts) : '等待客户端模块…';
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panelEl.style.display = panelOpen ? 'flex' : 'none';
    if (panelOpen) { renderAtkCard(); renderLogs(); }
  }

  function renderAtkCard() {
    if (!ui) return;
    var aS = analyzeAttack(atk.srvIntervals);
    var aC = analyzeAttack(atk.intervals);
    var lines = [];
    if (aS) {
      lines.push('⚀服务器广播攻净' + atk.serverActs + '欀· 切怪间隀平均' + aS.avg + 'ms (' + aS.stable + ')');
      lines.push('  中位' + aS.med + ' · 范围' + aS.mn + '~' + aS.mx + ' · 变异系数' + aS.cv + '% · 所' + Object.keys(atk.srvTargetCount).length + '个目标');
    } else {
      lines.push('⚀服务器广播攻净' + atk.serverActs + '次（等待数据…）');
    }
    lines.push('📤 客户端发包: 攻击 ' + atk.acts + ' · 移动 ' + atk.moves + ' · 共' + Object.keys(atk.outPkts).length + '种ID' + (aC ? (' · 切怪间隔' + aC.avg + 'ms') : ''));
    lines.push('🎯 服务器指定目标: ' + atk.settargets + ' 次');
    lines.push('🛡 自己被击 ' + atk.hitOnMe + '后· 自己GID=' + (atk.myGID || '?'));
    if (atk.loadinfo) {
      var li = atk.loadinfo;
      lines.push('⚙ 内挂配置: ' + li.searchMode + ' · 普攻距离' + li.pmdis + ' · 技能距离' + li.mgdis + ' · 瞬移间隔' + li.wing + ' · ' + li.onlyNo + ' · boss瞬移' + li.seeBoss + ' · 自动攻击' + li.sAtk + ' · 拾取' + li.loot + '%');
    }
    var sc = [], sck;
    for (sck in atk.serverCasts) sc.push(sck + 'x' + atk.serverCasts[sck]);
    if (sc.length) lines.push('✀服务器代施技胀 ' + sc.join(', '));
    var tr = [], t2;
    for (t2 in atk.triggerHits) tr.push(t2 + 'x' + atk.triggerHits[t2]);
    if (tr.length) lines.push('🔥 被击后s内释攻 ' + tr.join(', '));
    // v0.11.0：技术发包来源判定（助手指令 vs 内挂指令）——点选技技发不出去"定位生
var skT = skillFrames.slice(-5);
    if (skT.length) {
      var skLines = skT.map(function (f) {
        return '  ' + fmtTime(f.t) + ' ' + (f.src.indexOf('助手') >= 0 ? '🖱' : '🎮') + skillNameSafe(f.skid) + '(#' + f.skid + ') Lv' + f.lv + ' → ' + f.target;
      });
      lines.push('🧪 技能发包(最近' + skillFrames.length + '):');
      for (var ski = 0; ski < skLines.length; ski++) lines.push(skLines[ski]);
    } else {
      lines.push('🧪 技能发包: 暂无 USE_SKILL(275) 出站记录 —— 勾选后若始终无此日志=技能根本没发出去');
    }
    // v0.12.0：服务器受理判定（ACK_TOUSESKILL）——该放不放的断点定位核心
    if (ackMatched.length || ackTimeout.length) {
      lines.push('[受理] 服务器已受理 ' + ackMatched.length + ' 次 · [无ACK] 未受理 ' + ackTimeout.length + ' 次');
      var ab = ackTimeout.slice(-3);
      for (var abi = 0; abi < ab.length; abi++) {
        lines.push('  [无ACK] ' + fmtTime(ab[abi].t) + ' ' + skillNameSafe(ab[abi].skid) + '(#' + ab[abi].skid + ') Lv' + ab[abi].lv + ' → ' + ab[abi].target);
      }
      if (!ackTimeout.length) lines.push('  （无未受理——技能都发出且被服务器受理）');
    } else {
      lines.push('[受理] 暂无 ACK_TOUSESKILL(272) 记录（出站技能后才有）');
    }
    // v0.12.0：状态流水摘要（与助手判活同源）
    lines.push('[状态] 变化流水 ' + statusFlow.length + ' 条 · StatusIcons ' + (bhHookedSI ? '已挂钩' : '未挂钩') + (bhHookedSI ? '' : '(等待客户端模块…') );
    var stT = statusFlow.slice(-3);
    for (var sti = 0; sti < stT.length; sti++) {
      lines.push('  ' + fmtTime(stT[sti].t) + ' 状怀' + stT[sti].stId + (stT[sti].on ? ' 上身' : ' 消失') + (stT[sti].dur ? ' dur=' + stT[sti].dur + 'ms' : ''));
    }
    // v0.11.0：地图切换事件（换图自动开助手分析）
var mE = mapEvents[mapEvents.length - 1];
    if (mE) {
      lines.push('🗺 最近地图切换 ' + mE.type + ' ' + mE.map + ' @(' + mE.x + ',' + mE.y + ') 共' + mapEvents.length + '条');
      var deco = collectDiagTail() || [];
      var zs = deco.filter(function (d) { return d.ev === 'zhu-start' || d.ev === 'map-change' || d.ev === 'zhu-stop'; }).slice(-4);
      if (zs.length) lines.push('  助手事件玀 ' + zs.map(function (d) { return d.ev + (d.map ? ':' + d.map : '') + (d.mode ? '(' + d.mode + ')' : ''); }).join(' →'));
    }
    ui.atkCard.textContent = lines.join('\n');
  }

  function renderLogs() {
    if (!ui || !panelOpen) return;
    var body = ui.body;
    body.innerHTML = '';
    var shown = logs.filter(function (l) { return filters[l.cat]; });
    if (!shown.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '暂无日志 ‐在游戏里改一下内挂辅助槽试试';
      body.appendChild(e);
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < shown.length; i++) {
      var l = shown[i];
      var div = document.createElement('div');
      div.className = 'log';
      var t = document.createElement('span'); t.className = 't'; t.textContent = fmtTime(l.t);
      var d = document.createElement('span'); d.className = l.dir === '→' ? 'up' : 'down'; d.textContent = l.dir;
      var c = document.createElement('span'); c.className = 'cat'; c.textContent = '[' + (CAT_NAME[l.cat] || l.cat) + ']';
      var x = document.createElement('span'); x.textContent = l.txt;
      div.appendChild(t); div.appendChild(d); div.appendChild(c); div.appendChild(x);
      frag.appendChild(div);
    }
    body.appendChild(frag);
    body.scrollTop = body.scrollHeight;
  }

  function copyAll() {
    var text = '【RO 内挂联动探针日志】\n' + attackSummaryText() + '\n\n' + allLogText();
    var done = function () { addLog('→', 'CFG', '已复制' + logs.length + ' 条日志 + 攻击分析'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.documentElement.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.documentElement.removeChild(ta);
      done();
    } catch (e) {}
  }

  /* ==================== 初始包==================== */
  function tryInit() {
    var k = buildKnown();
    if (!k) return false;
    // 自检：如果关键包一个都没注册成功，显示诊断（不再静默）
    if (regMatched === 0) {
      addLog('→', 'CFG', '⚙ 关键包注册失败！regRef 引用匹配与名字降级均未命中（PS/PR 结构异常）');
    } else if (regFails.length) {
      addLog('→', 'CFG', '部分关键包引用未匹配(已由降级处理): ' + regFails.join(','));
    }
    addLog('→', 'CFG', '初始化完成 · 关键包注册' + regMatched + '/' + REG_WANTS.length + ' · 全量' + Object.keys(k.byId).length + ' 个');
    // v0.13.1：known 就绪后立即补一次状态流水hook（此前模块可能未加载完）
    try { hookStatusIcons(); } catch (e) {}
    // 回放等待期间的帧
    for (var i = 0; i < pendingFrames.length; i++) {
      streamBuf = concat(streamBuf, pendingFrames[i]);
    }
    pendingFrames = [];
    drain();
    if (ui) updateStatus();
    return true;
  }

  hookWebSocket();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { buildUI(); });
  } else {
    buildUI();
  }
  var initTries = 0;
  var initTimer = setInterval(function () {
    if (tryInit()) { clearInterval(initTimer); return; }
    initTries++;
    if (initTries > 120) { clearInterval(initTimer); if (ui) ui.status.textContent = '未发现客户端模块（请刷新页面重试）'; }
  }, 500);
  // 自动回执采集（不依赖客户端模块，独立循环）
try { queueLoad(); } catch (e) {}
  setInterval(tickAutoCollect, 1200);
  // v0.12.0：状态流水hook（客户端模块就绪后成功，水3s 重试，幂等）
  try { setInterval(function () { try { hookStatusIcons(); } catch (e) {} }, 3000); } catch (e) {}
  // v0.12.0：行为流水定时批量回传（毀10s；有行为数据才发，失败入队重试）
  try {
    setInterval(function () {
      try {
        if (bhLastPost && Date.now() - bhLastPost < 10000) return; // 10s 防抖
        var hasFlow = behaviorRing.length || statusFlow.length || ackMatched.length || ackTimeout.length;
        if (!hasFlow) return; // 无行为数据不发（避免空回执刷盘）
        bhLastPost = Date.now();
        postCollect(buildCollectPayload([], 'behavior:tick'));
        addLog('→', 'CFG', '行为流水批量回传（flow ' + behaviorRing.length + ' · status ' + statusFlow.length + ' · ackOK ' + ackMatched.length + ' · ackBad ' + ackTimeout.length + '）');
      } catch (e) {}
    }, 10000);
  } catch (e) {}
  try { setInterval(queueRetry, 30000); } catch (e) {}
})();
