// ==UserScript==
// @name         仙境传说 · 检测插件（ro-detect）
// @namespace    dsh.ro-detect
// @version      1.0.6
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-detect.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-detect.user.js
// @description  v1.0.6：检测插件（合并 ro-probe 回传框架 + ro-attack-test 攻击测试）。模块：A验证码/自动验证日志监控 B攻击测试（标记/模拟点击/buff上身诊断） C自动buff状态监控+自动加buff（状态未常驻自动放技能，面板开关+防抖退避） D防原地走动判定。回传带角色名（多开隔离）+ 面板与游戏页彻底隔层（stopPropagation 防点地板）。抓取 [ASK-DIAG] 自动技能逐项决策日志。检测日志自动回传本机接收服务（8899），DSH 直接自取，无需手动复制控制台。
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      192.168.31.97
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  var COLLECT_URL = 'http://192.168.31.97:8899/api/probe-collect'; // 本机接收服务（DSH 自取）
  var MAX_Q = 200;            // 待回传队列上限
  var FLUSH_MS = 8000;        // 批量回传间隔
  var SESSION = String(Date.now()).slice(-8) + '-' + Math.floor(Math.random() * 900 + 100); // 本次会话标识
  // console 抓取关键词（ro-assist 等外部脚本打的关键日志）
  var HOOK_KW = ['[验证-diag]', '[验证自动过]', '[MVP-DEBUG]', '[ASK-DIAG]', 'buff', 'Buff', '补buff', '掉buff', '技能失败', '未上身', '不在身', '原地走动'];
  // 模块C 要盯的 buff 状态ID（掉/未上身即记日志；可自行增删）
  var WATCH_BUFFS = [12, 10]; // 12=加速术 10=天赐
  var WATCH_INT = 5000;       // buff 检查间隔 ms
  var WALK_WIN = 3000;        // 防原地走动判定窗口 ms
  var WALK_MIN_PKTS = 2;      // 窗口内移动包数量下限

  /* ==================== 回传框架 ==================== */
  var queue = [];             // [{t, lv, m}] 待回传
  var lastPost = 0;
  var device = {};
  try {
    device = { ua: navigator.userAgent || '', screen: (screen && screen.width) ? (screen.width + 'x' + screen.height) : '', lang: navigator.language || '' };
  } catch (e) {}
  function enqueue(m, lv) {
    try {
      queue.push({ t: Date.now(), s: SESSION, lv: lv || 'log', m: String(m || '').slice(0, 900) });
      if (queue.length > MAX_Q) queue.splice(0, queue.length - MAX_Q);
    } catch (e) {}
  }
  function detLog(m) { // 检测插件自己的日志：入队 + 页面console（带前缀便于识别）
    enqueue(m, 'log');
    try { console.log('[DETECT] ' + m); } catch (e) {}
  }
  // V1.0.6 当前角色名（多开隔离：登录后每次回传动态取，未登录为空；同角色多开仅靠 role 区分不了，配合 s 会话号仍可辨）
  function currentRole() {
    try {
      var ent = selfEntity();
      if (!ent) return '';
      var n = (ent.display && ent.display.name) || ent.displayName || ent.name || (ent.character && ent.character.name) || '';
      return String(n).slice(0, 40);
    } catch (e) { return ''; }
  }
  function doPost() {
    try {
      if (!queue.length) return;
      if (typeof GM_xmlhttpRequest !== 'function') return; // 无回传能力时留队（有GM则重试）
      var payload = { s: SESSION, role: currentRole(), dev: device, logs: queue.splice(0, queue.length) };
      GM_xmlhttpRequest({
        method: 'POST', url: COLLECT_URL, data: JSON.stringify(payload), timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
        onerror: function () { queue = payload.logs.concat(queue).slice(-MAX_Q); },
        ontimeout: function () { queue = payload.logs.concat(queue).slice(-MAX_Q); }
      });
    } catch (e) {}
  }
  setInterval(function () { var now = Date.now(); if (now - lastPost >= FLUSH_MS) { lastPost = now; doPost(); } }, FLUSH_MS);

  /* ==================== console 钩子（抓外部脚本关键日志） ==================== */
  function pageWindow() {
    try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow; } catch (e) {}
    return window;
  }
  function hookConsole() {
    try {
      var W = pageWindow();
      var levels = ['log', 'error', 'warn', 'info'];
      for (var i = 0; i < levels.length; i++) {
        (function (lv) {
          var orig = W.console && W.console[lv];
          if (!orig) return;
          W.console[lv] = function () {
            try {
              var txt = '';
              for (var a = 0; a < arguments.length; a++) { try { txt += (a ? ' ' : '') + String(arguments[a]); } catch (e2) {} }
              for (var k = 0; k < HOOK_KW.length; k++) {
                if (txt.indexOf(HOOK_KW[k]) >= 0) { enqueue(txt, lv); break; }
              }
            } catch (e) {}
            return orig.apply(this, arguments);
          };
        })(levels[i]);
      }
    } catch (e) {}
  }
  // 全局错误捕获（JS异常/资源加载失败也回传）
  function hookErrors() {
    try {
      var W = pageWindow();
      W.addEventListener('error', function (ev) {
        try {
          var m = (ev && ev.message) || '';
          var src = (ev && ev.filename) ? (ev.filename.split('/').pop() + ':' + (ev.lineno || '')) : '';
          if (m || src) enqueue('[JSERR] ' + m + ' @ ' + src, 'error');
        } catch (e) {}
      });
      W.addEventListener('unhandledrejection', function (ev) {
        try { var r = ev && ev.reason; enqueue('[UNHANDLED] ' + (r && r.message ? r.message : String(r)), 'error'); } catch (e) {}
      });
      document.addEventListener('error', function (ev) {
        try {
          var t = ev && ev.target;
          if (t && (t.tagName === 'IMG' || t.tagName === 'SCRIPT' || t.tagName === 'LINK' || t.tagName === 'SOURCE')) {
            enqueue('[RESFAIL] ' + (t.currentSrc || t.src || t.href || '(unknown)'));
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  }

  /* ==================== 实体工具（复用 ro-attack-test） ==================== */
  function btCanvas() {
    try {
      var cvs = document.querySelectorAll('canvas');
      for (var i = 0; i < cvs.length; i++) { if (cvs[i].width > 400) return cvs[i]; }
    } catch (e) {}
    return null;
  }
  // v1.0.3：坐标换算修复——canvas 视口 rect 为 0 时回退原始值；Renderer 宽度取不到时用 canvas 像素宽
  function toPage(rx, ry) {
    try {
      var W = pageWindow();
      var cv = btCanvas();
      if (!cv) return { x: rx, y: ry };
      var br = cv.getBoundingClientRect();
      if (!br || br.width <= 0 || br.height <= 0) return { x: rx, y: ry };
      var R = W.require && W.require('Renderer/Renderer');
      var rw = (R && R.width) || cv.width || 1;
      var rh = (R && R.height) || cv.height || 1;
      return { x: br.left + rx * (br.width / rw), y: br.top + ry * (br.height / rh) };
    } catch (e) { return { x: rx, y: ry }; }
  }
  // v1.0.3：CLIENT 不是页面全局（ro-assist 内部对象），各模块须从页面 require 拿（Engine/SessionStorage、Network/NetworkManager、Network/PacketStructure、Renderer/EntityManager）
  function pageModules() {
    try {
      var W = pageWindow();
      if (!W.require) return null;
      var SS = null, NM = null, PS = null, EM = null;
      try { SS = W.require('Engine/SessionStorage'); } catch (e) {}
      try { NM = W.require('Network/NetworkManager'); } catch (e) {}
      try { PS = W.require('Network/PacketStructure'); } catch (e) {}
      try { EM = W.require('Renderer/EntityManager'); } catch (e) {}
      return { SS: SS, NM: NM, PS: PS, EM: EM };
    } catch (e) { return null; }
  }
  function selfEntity() {
    try { var m = pageModules(); return (m && m.SS && m.SS.Entity) || null; } catch (e) { return null; }
  }
  function findTarget() {
    try {
      var m = pageModules();
      var EM = m && m.EM;
      if (!EM || typeof EM.forEach !== 'function') return null;
      var ent = selfEntity();
      var best = null, bestD = 1e9;
      EM.forEach(function (e) {
        try {
          if (e.objecttype !== 5 || !e.position) return;
          if (e.isDeath) return;
          if (ent && ent.position) {
            var d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
            if (d < bestD) { bestD = d; best = e; }
          } else if (!best) { best = e; }
        } catch (e2) {}
      });
      return best;
    } catch (e) { return null; }
  }

  /* ==================== 模块A：验证码/自动验证日志（console钩子已抓[验证-diag]/[验证自动过]） ==================== */
  // 额外：op=180 收到时主动记录一句话（辅助确认弹窗出现）
  function noteSayDialog(bytes) {
    try {
      if (!bytes || bytes.byteLength < 6) return;
      var dv = new DataView(bytes);
      if (dv.getUint16(0, true) !== 180) return;
      detLog('op=180 对话包 len=' + bytes.byteLength + '（验证弹窗或NPC对话，详见[验证-diag]日志）');
    } catch (e) {}
  }

  /* ==================== 模块D：防原地走动判定（WS 出站移动包 + 距怪距离） ==================== */
  var movePkts = [];   // 出站移动包时间戳（窗口内）
  var distLog = [];    // {t, d} 自己与最近怪距离采样
  var walkReported = false;
  function hookWs() {
    try {
      var W = pageWindow();
      var NativeWS = W.WebSocket;
      if (!NativeWS || NativeWS.__dshDetect) return;
      NativeWS.__dshDetect = true;
      var origSend = NativeWS.prototype.send;
      NativeWS.prototype.send = function (data) {
        try {
          if (data && data.byteLength !== undefined && data.byteLength <= 4096) {
            var b = new Uint8Array(data);
            // 出站包流逐2B扫描，id=133 为 CZ.REQUEST_MOVE（移动请求）
            var off = 0;
            while (off + 2 <= b.length) {
              var id = (b[off] | (b[off + 1] << 8)) & 0xffff;
              if (id === 133) { movePkts.push(Date.now()); if (movePkts.length > 40) movePkts.shift(); }
              else if (id === 180) { try { noteSayDialog(b); } catch (e) {} }
              off += 2;
            }
          }
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    } catch (e) {}
  }
  function sampleDist() {
    try {
      var ent = selfEntity();
      var tgt = findTarget();
      if (!ent || !ent.position || !tgt || !tgt.position) return;
      var d = Math.abs(ent.position[0] - tgt.position[0]) + Math.abs(ent.position[1] - tgt.position[1]);
      distLog.push({ t: Date.now(), d: d });
      if (distLog.length > 60) distLog.shift();
    } catch (e) {}
  }
  function judgeWalk() {
    try {
      var now = Date.now();
      var pk = movePkts.filter(function (m) { return now - m < WALK_WIN; });
      if (pk.length < WALK_MIN_PKTS) { walkReported = false; return; }
      var win = distLog.filter(function (s) { return now - s.t < WALK_WIN; });
      if (win.length < 2) return;
      var d0 = win[0].d, d1 = win[win.length - 1].d;
      // 移动包多发但距怪未明显缩短（差 <0.5 格）→ 疑似原地走动
      if (d1 > d0 - 0.5) {
        if (!walkReported) {
          walkReported = true;
          detLog('疑似原地走动：' + WALK_WIN / 1000 + 's内发出 ' + pk.length + ' 个移动包，距怪 ' + d0.toFixed(1) + '→' + d1.toFixed(1) + '（未接近）');
        }
      } else { walkReported = false; }
    } catch (e) {}
  }

  /* ==================== 模块C：自动buff状态监控（StatusIcons hook + 定时检查） ==================== */
  var watchBuffs = {}; // {stId: {on, endAt, seen}}
  function hookStatusIcons() {
    try {
      var W = pageWindow();
      if (!W.require) return;
      var cands = ['UI/Components/StatusIcons/StatusIcons', 'UI/Components/StatusIcons', 'UI/Components/StatusIcons/StatusIcons.js', 'UI/Components/StatusIcons.js'];
      var SI = null;
      for (var i = 0; i < cands.length; i++) { try { var m = W.require(cands[i]); if (m && typeof m.update === 'function') { SI = m; break; } } catch (e) {} }
      if (!SI || SI.__dshDetect) return;
      SI.__dshDetect = true;
      var orig = SI.update;
      SI.update = function (stId, active, layer, dur) {
        try {
          stId = parseInt(stId, 10);
          if (!isNaN(stId)) {
            var now = Date.now();
            if (active) watchBuffs[stId] = { on: true, endAt: (dur === 9999 || dur == null) ? Infinity : now + (dur || 30000), seen: true };
            else if (watchBuffs[stId]) watchBuffs[stId].on = false;
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    } catch (e) {}
  }
  // V1.0.5 自动加buff配置：{stId, skid, lv}（面板 buff 区「状态ID/技能ID」输入 + 「加入自动加buff」按钮维护，存 localStorage）
  var AUTO_BUFFS = [];
  try { AUTO_BUFFS = JSON.parse(localStorage.getItem('dsh_detect_autobuffs')) || []; } catch (e) { AUTO_BUFFS = []; }
  var autoBuffEn = false;   // 面板「自动加buff」开关
  var autoBuffLast = {};    // {stId: lastCastAt} 每状态独立防抖
  var autoBuffMiss = {};    // {stId: missCnt} 连续补不上退避
  function castAutoBuff(stId, skid) {
    try {
      var m = pageModules();
      if (!m || !m.NM || !m.PS || !m.NM.sendPacket) return false;
      var lv = 1;
      try {
        var sl = m.PS.SkillList || (m.PS.Skill && m.PS.Skill.list);
        if (sl) { for (var i = 0; i < sl.length; i++) { if (sl[i] && (sl[i].SKID === skid || sl[i].skid === skid)) { lv = sl[i].lv || sl[i].level || 1; break; } } }
      } catch (e) {}
      var p = new m.PS.CZ.USE_SKILL();
      p.SKID = skid; p.selectedLevel = lv; p.targetID = 0;
      m.NM.sendPacket(p);
      autoBuffLast[stId] = Date.now();
      autoBuffMiss[stId] = (autoBuffMiss[stId] || 0) + 1;
      detLog('自动加buff：状态' + stId + '未常驻，已放技能' + skid + ' Lv' + lv + '（missCnt=' + autoBuffMiss[stId] + '）');
      return true;
    } catch (e) { return false; }
  }
  function setAutoBuffInfo() {
    try { localStorage.setItem('dsh_detect_autobuffs', JSON.stringify(AUTO_BUFFS)); } catch (e) {}
    var el = document.getElementById('dsh-atk-autobuff-list');
    if (!el) return;
    if (!AUTO_BUFFS.length) { el.innerHTML = '<span style="color:#8a97a6">空（填上方状态ID/技能ID 点「加入」）</span>'; return; }
    var h = '';
    for (var i = 0; i < AUTO_BUFFS.length; i++) {
      var ab = AUTO_BUFFS[i];
      h += '<div style="display:flex;align-items:center;gap:4px;padding:2px 0">' +
        '<span style="flex:1;font-size:10px">状态' + ab.stId + ' ← 技能' + ab.skid + '</span>' +
        '<button data-ab-del="' + i + '" style="padding:0 6px;font-size:10px;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#fff">删</button></div>';
    }
    el.innerHTML = h;
  }
  function checkBuffs() {
    try {
      hookStatusIcons();
      for (var i = 0; i < WATCH_BUFFS.length; i++) {
        var st = WATCH_BUFFS[i];
        var cur = watchBuffs[st];
        var on = !!(cur && cur.on && cur.endAt > Date.now());
        if (!on && cur && cur.seen) {
          detLog('buff状态' + st + ' 不在身（已掉或未上身）');
        } else if (!on && !cur) {
          // 从未见过该状态：登录初期不误报，标记已检查
          watchBuffs[st] = { on: false, endAt: 0, seen: false };
        }
      }
      // V1.0.5 自动加buff：状态未常驻（不在身/从未上身）→ 自动放对应技能；5s 防抖，连续2次补不上退避30s
      if (autoBuffEn && AUTO_BUFFS.length) {
        for (var j = 0; j < AUTO_BUFFS.length; j++) {
          var ab = AUTO_BUFFS[j];
          if (!ab || !ab.stId) continue;
          var cur2 = watchBuffs[ab.stId];
          var on2 = !!(cur2 && cur2.on && cur2.endAt > Date.now());
          if (on2) { autoBuffMiss[ab.stId] = 0; continue; } // 状态在身，清零
          var now = Date.now();
          var waitMs = (autoBuffMiss[ab.stId] || 0) >= 2 ? 30000 : 5000;
          if (now - (autoBuffLast[ab.stId] || 0) < waitMs) continue;
          if (castAutoBuff(ab.stId, ab.skid)) { setAutoBuffInfo(); }
        }
      }
    } catch (e) {}
  }
  setInterval(checkBuffs, WATCH_INT);
  setInterval(function () { sampleDist(); judgeWalk(); }, 1000);

  /* ==================== 模块B：攻击测试（移植 ro-attack-test） ==================== */
  var atkBuffs = {};
  var ATK_ENT_FIELDS = {
    12: ['inc_agi', 'IncAgi', 'incAgi'], 10: ['blessing', 'Blessing'], 1: ['endure', 'Endure'],
    86: ['explosion'], 87: ['SteelBody', 'steelbody', 'steel_body'], 149: ['soullink'],
    107: ['berserk'], 27: ['riding', 'riding_'], 28: ['falcon'], 4: ['isHide', 'hiding'], 5: ['isHide', 'hiding']
  };
  function atkHookStatus() {
    try {
      var W = pageWindow();
      if (!W.require) return;
      var cands = ['UI/Components/StatusIcons/StatusIcons', 'UI/Components/StatusIcons', 'UI/Components/StatusIcons/StatusIcons.js', 'UI/Components/StatusIcons.js'];
      var SI = null;
      for (var i = 0; i < cands.length; i++) { try { var m = W.require(cands[i]); if (m && typeof m.update === 'function') { SI = m; break; } } catch (e) {} }
      if (!SI || SI.__dshAtkSIHook) return;
      var orig = SI.update;
      SI.__dshAtkSIHook = true;
      SI.update = function (stId, active, layer, dur) {
        try {
          stId = parseInt(stId, 10);
          if (!isNaN(stId)) {
            var now = Date.now();
            if (active) atkBuffs[stId] = { on: true, endAt: (dur === 9999 || dur == null) ? Infinity : now + (dur || 30000) };
            else if (atkBuffs[stId]) atkBuffs[stId].on = false;
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      detLog('攻击测试：状态图标hook已挂');
    } catch (e) {}
  }
  function atkEntVal(ent, keys) { for (var i = 0; i < keys.length; i++) { if (ent[keys[i]] !== undefined) return ent[keys[i]]; } return undefined; }
  function atkStateOn(stId) {
    try {
      stId = parseInt(stId, 10);
      var ent = selfEntity();
      if (ent && ATK_ENT_FIELDS[stId]) { var v = atkEntVal(ent, ATK_ENT_FIELDS[stId]); if (v !== undefined) return { via: '实体字段', on: (v === true || v === 1) }; }
      var st = atkBuffs[stId];
      if (st) return { via: '状态图标hook', on: !!(st.on && st.endAt > Date.now()), endAt: st.endAt };
      return { via: '两者皆无', on: false };
    } catch (e) { return { via: '异常:' + e.message, on: false }; }
  }
  function atkMarkTarget() {
    try {
      var t = findTarget();
      if (!t) { detLog('攻击测试：标记 未找到目标怪'); return; }
      var b = t.boundingRect;
      if (!b) { detLog('攻击测试：标记 目标无boundingRect'); return; }
      var cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      var p = toPage(cx, cy);
      detLog('攻击测试：标记诊断 b={x1:' + b.x1 + ',x2:' + b.x2 + ',y1:' + b.y1 + ',y2:' + b.y2 + '} 中心(' + cx + ',' + cy + ')→页面(' + p.x + ',' + p.y + ')');
      var d = document.createElement('div');
      d.id = 'dsh-atk-mark';
      d.style.cssText = 'position:fixed;left:' + p.x + 'px;top:' + p.y + 'px;width:16px;height:16px;border:2px solid red;background:rgba(255,0,0,.25);border-radius:50%;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%)';
      var old = document.getElementById('dsh-atk-mark'); if (old) old.remove();
      document.body.appendChild(d);
      detLog('攻击测试：标记 GID' + t.GID + ' 页面(' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ') 红框已画');
    } catch (e) { detLog('攻击测试：标记异常 ' + e.message); }
  }
  function atkClickTarget() {
    try {
      var t = findTarget();
      if (!t) { detLog('攻击测试：点击 未找到目标怪'); return; }
      var b = t.boundingRect;
      if (!b) { detLog('攻击测试：点击 目标无boundingRect'); return; }
      var cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      var p = toPage(cx, cy);
      detLog('攻击测试：点击诊断 b={x1:' + b.x1 + ',x2:' + b.x2 + ',y1:' + b.y1 + ',y2:' + b.y2 + '} 中心(' + cx + ',' + cy + ')→页面(' + p.x + ',' + p.y + ')');
      var cv = btCanvas();
      if (!cv) { detLog('攻击测试：点击 未找到画布'); return; }
      var opts = { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, pointerId: 1, isPrimary: true };
      ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click'].forEach(function (t2) {
        try { cv.dispatchEvent(new (t2.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(t2, opts)); } catch (e) {}
      });
      detLog('攻击测试：点击 GID' + t.GID + ' 已派发合成点击（看角色是否攻击/走近，配合防原地走动判定）');
    } catch (e) { detLog('攻击测试：点击异常 ' + e.message); }
  }
  function atkCheckState() {
    try {
      atkHookStatus();
      var stid = parseInt((document.getElementById('dsh-atk-stid') || {}).value, 10);
      if (isNaN(stid)) { detLog('攻击测试：测状态 状态ID无效'); return; }
      var r = atkStateOn(stid);
      var line = '状态' + stid + '：' + (r.on ? '在身' : '不在身/检测不到') + '（来源:' + r.via + '）';
      if (r.endAt) line += ' 剩余' + Math.max(0, Math.round((r.endAt - Date.now()) / 1000)) + 's';
      var el = document.getElementById('dsh-atk-buffinfo');
      if (el) { el.textContent = line; var ent = selfEntity(); if (ent) { var ks = Object.keys(ATK_ENT_FIELDS), parts = []; for (var i = 0; i < ks.length; i++) { var v = atkEntVal(ent, ATK_ENT_FIELDS[ks[i]]); parts.push(ks[i] + '=' + (v === undefined ? '-' : v)); } el.textContent += '\n实体字段: ' + parts.join(' '); } }
      detLog('攻击测试：测状态 ' + line);
    } catch (e) { detLog('攻击测试：测状态异常 ' + e.message); }
  }
  function atkCastSkill() {
    try {
      var m = pageModules();
      if (!m || !m.NM || !m.PS || !m.NM.sendPacket) { detLog('攻击测试：放技能 客户端未就绪（SS=' + (!!(m && m.SS)) + ' NM=' + (!!(m && m.NM)) + ' PS=' + (!!(m && m.PS)) + '）'); return; }
      atkHookStatus();
      var skid = parseInt((document.getElementById('dsh-atk-skillid') || {}).value, 10);
      if (isNaN(skid)) { detLog('攻击测试：放技能 技能ID无效'); return; }
      var stid = parseInt((document.getElementById('dsh-atk-stid') || {}).value, 10);
      var lv = 1;
      try {
        var sl = m.PS.SkillList || (m.PS.Skill && m.PS.Skill.list);
        if (sl) { for (var i = 0; i < sl.length; i++) { if (sl[i] && (sl[i].SKID === skid || sl[i].skid === skid)) { lv = sl[i].lv || sl[i].level || 1; break; } } }
      } catch (e) {}
      var p = new m.PS.CZ.USE_SKILL();
      p.SKID = skid; p.selectedLevel = lv; p.targetID = 0;
      m.NM.sendPacket(p);
      detLog('攻击测试：已发技能' + skid + ' Lv' + lv + '（对自己）');
      setTimeout(function () {
        try {
          var r = atkStateOn(stid);
          detLog('攻击测试：上身检查(2s后) 状态' + stid + (r.on ? ' 已在身（来源:' + r.via + '）' : ' 未上身/检测不到（来源:' + r.via + '）'));
          var el = document.getElementById('dsh-atk-buffinfo');
          if (el) el.textContent = '技能' + skid + '释放2s后：状态' + stid + (r.on ? ' 已在身' : ' 未上身') + '（来源:' + r.via + '）';
        } catch (e2) {}
      }, 2000);
    } catch (e) { detLog('攻击测试：放技能异常 ' + e.message); }
  }
  function buildPanel() {
    if (document.getElementById('dsh-atk-root')) return;
    var root = document.createElement('div');
    root.id = 'dsh-atk-root';
    root.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;font-family:sans-serif;user-select:none;pointer-events:auto';
    var btn = document.createElement('button');
    btn.textContent = '检测';
    btn.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;background:#1d4e89;color:#fff;border:none;border-radius:4px';
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;margin-top:6px;width:280px;background:#fff;border:1px solid #b8c6d4;border-radius:6px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,.25);pointer-events:auto';
    panel.innerHTML =
      '<div style="font-size:12px;color:#1d4e89;margin-bottom:6px">RO 检测插件（ro-detect v1.0.6）</div>' +
      '<div style="font-size:10px;color:#5a6b7f;margin-bottom:6px">日志自动回传本机8899，DSH自取；含验证码/buff/原地走动监控</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<button id="dsh-atk-mark-b" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">标记测试</button>' +
      '<button id="dsh-atk-click-b" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">模拟点击</button>' +
      '<button id="dsh-atk-close-b" style="flex:0 0 46px;padding:4px 0;font-size:11px;cursor:pointer">关闭</button>' +
      '</div>' +
      '<div id="dsh-atk-log" style="font-size:10px;height:110px;overflow:auto;background:#f4f6f8;border:1px solid #d8e0e8;border-radius:4px;padding:4px;font-family:monospace;white-space:pre-wrap;line-height:1.5">就绪。</div>' +
      '<div style="border-top:1px solid #d8e0e8;margin-top:6px;padding-top:4px;font-size:11px;color:#1d4e89">buff 上身诊断</div>' +
      '<div style="display:flex;gap:4px;margin:4px 0"><input id="dsh-atk-stid" type="number" placeholder="状态ID" value="12" style="flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid #ccc;border-radius:3px"><input id="dsh-atk-skillid" type="number" placeholder="技能ID" value="29" style="flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid #ccc;border-radius:3px"></div>' +
      '<div style="display:flex;gap:4px;margin-bottom:4px"><button id="dsh-atk-stcheck" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">测状态</button><button id="dsh-atk-stcast" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">放技能看上身</button></div>' +
      '<div id="dsh-atk-buffinfo" style="font-size:10px;background:#fdf6ec;border:1px solid #eeddbb;border-radius:4px;padding:4px;white-space:pre-wrap;line-height:1.5">输入状态ID（默认12加速术）测状态；输入技能ID放技能看上身。</div>' +
      '<div style="border-top:1px solid #d8e0e8;margin-top:6px;padding-top:4px;font-size:11px;color:#1d4e89">自动加buff（状态未常驻自动放技能）</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin:4px 0"><label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer"><input id="dsh-atk-autobuff" type="checkbox" style="cursor:pointer">开启</label><button id="dsh-atk-ab-add" style="flex:1;padding:3px 0;font-size:11px;cursor:pointer">加入（用上方 状态ID/技能ID）</button></div>' +
      '<div id="dsh-atk-autobuff-list" style="font-size:10px;background:#f4f8f4;border:1px solid #d8e0d8;border-radius:4px;padding:4px;line-height:1.5"></div>';
    btn.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    panel.addEventListener('click', function (ev) {
      var id = ev.target && ev.target.id;
      if (id === 'dsh-atk-mark-b') atkMarkTarget();
      else if (id === 'dsh-atk-click-b') atkClickTarget();
      else if (id === 'dsh-atk-close-b') panel.style.display = 'none';
      else if (id === 'dsh-atk-stcheck') atkCheckState();
      else if (id === 'dsh-atk-stcast') atkCastSkill();
      else if (id === 'dsh-atk-ab-add') {
        var aSt = parseInt((document.getElementById('dsh-atk-stid') || {}).value, 10);
        var aSk = parseInt((document.getElementById('dsh-atk-skillid') || {}).value, 10);
        if (isNaN(aSt) || isNaN(aSk)) { detLog('自动加buff：状态ID/技能ID 无效'); return; }
        var dup = false;
        for (var di = 0; di < AUTO_BUFFS.length; di++) { if (AUTO_BUFFS[di].stId === aSt) { AUTO_BUFFS[di].skid = aSk; dup = true; break; } }
        if (!dup) AUTO_BUFFS.push({ stId: aSt, skid: aSk });
        setAutoBuffInfo();
        detLog('自动加buff：已加入 状态' + aSt + '←技能' + aSk + '（共' + AUTO_BUFFS.length + '项）');
      }
      var abDel = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-ab-del');
      if (abDel != null) {
        var dIdx = parseInt(abDel, 10);
        if (!isNaN(dIdx) && dIdx >= 0 && dIdx < AUTO_BUFFS.length) { AUTO_BUFFS.splice(dIdx, 1); setAutoBuffInfo(); }
      }
    });
    root.appendChild(btn);
    root.appendChild(panel);
    // V1.0.6 面板与游戏页彻底隔层：游戏在 window 级监听 mousedown/mouseup/touch（MapControl init），
    // 面板内任何鼠标/触摸事件冒泡到 window 都会触发游戏移动/攻击（点面板点到地板、模拟点击点到游戏地板的根因）。
    // 统一在面板容器上 stopPropagation 阻断冒泡；panel 内部按钮的 click 委托在 panel 层先触发，不受影响。
    ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup'].forEach(function (et) {
      root.addEventListener(et, function (ev) { try { ev.stopPropagation(); } catch (e) {} });
    });
    var abEn = document.getElementById('dsh-atk-autobuff');
    if (abEn) { abEn.checked = false; abEn.addEventListener('change', function () { autoBuffEn = this.checked; if (this.checked) { hookStatusIcons(); detLog('自动加buff：已开启（' + AUTO_BUFFS.length + '项）'); } else { detLog('自动加buff：已关闭'); } }); }
    setAutoBuffInfo();
    document.body.appendChild(root);
    detLog('面板就绪（检测插件 v1.0.6，会话 ' + SESSION + '）');
  }
  // v1.0.1：面板不再等游戏客户端就绪，页面 body 出现即构建按钮；v1.0.2：页面对象访问全走 pageWindow()（沙箱 window 无 CLIENT/require）
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (document.body || tries > 300) { clearInterval(iv); if (document.body) buildPanel(); }
  }, 1000);

  /* ==================== 启动 ==================== */
  hookConsole();
  hookErrors();
  hookWs();
  detLog('检测插件启动 会话' + SESSION + '（回传 ' + COLLECT_URL + '）');
})();
