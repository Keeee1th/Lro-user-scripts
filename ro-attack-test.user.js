// ==UserScript==
// @name         RO 攻击测试（独立测试包）
// @namespace    dsh.ro-plugin
// @version      1.1.0
// @description  独立于助手的攻击测试工具：游戏页右下角「攻测」浮动按钮，可标记最近怪坐标（画红框验证坐标换算）、模拟点击（对怪派发合成鼠标点击验证攻击）；含 buff 测试（状态上身诊断：实体字段+状态图标判活表，可发技能看状态是否上身）。自带日志区，默认不干扰游戏，与 ro-assist 可同时启用。
// @author       DSH
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  var lines = [];
  function log(msg) {
    try {
      var t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      lines.push('[' + t + '] ' + msg);
      if (lines.length > 60) lines.splice(0, lines.length - 60);
      var el = document.getElementById('dsh-atk-log');
      if (el) { el.textContent = lines.join('\n'); el.scrollTop = el.scrollHeight; }
      console.log('[ATK-TEST] ' + msg);
    } catch (e) {}
  }
  function btCanvas() {
    try {
      var cvs = document.querySelectorAll('canvas');
      for (var i = 0; i < cvs.length; i++) { if (cvs[i].width > 400) return cvs[i]; }
    } catch (e) {}
    return null;
  }
  // 渲染坐标(Renderer尺寸) → 页面坐标(dispatchEvent 用 clientX/Y)
  function toPage(rx, ry) {
    try {
      var R = window.require && window.require('Renderer/Renderer');
      var cv = btCanvas();
      if (!R || !cv) return { x: rx, y: ry };
      var br = cv.getBoundingClientRect();
      return { x: br.left + rx * (br.width / R.width), y: br.top + ry * (br.height / R.height) };
    } catch (e) { return { x: rx, y: ry }; }
  }
  // 最近的怪实体（objecttype===5 且未死亡）
  function findTarget() {
    try {
      if (!window.require) return null;
      var EM = window.require('Renderer/EntityManager');
      if (!EM || typeof EM.forEach !== 'function') return null;
      var ent = window.CLIENT && window.CLIENT.SS && window.CLIENT.SS.Entity;
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
  // 标记测试：目标怪中心画红框，验证坐标换算
  function markTarget() {
    try {
      var t = findTarget();
      if (!t) { log('标记: 未找到目标怪'); return; }
      var b = t.boundingRect;
      if (!b) { log('标记: 目标无 boundingRect'); return; }
      var cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      var p = toPage(cx, cy);
      var d = document.createElement('div');
      d.id = 'dsh-atk-mark';
      d.style.cssText = 'position:fixed;left:' + p.x + 'px;top:' + p.y + 'px;width:16px;height:16px;border:2px solid red;background:rgba(255,0,0,.25);border-radius:50%;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%)';
      var old = document.getElementById('dsh-atk-mark'); if (old) old.remove();
      document.body.appendChild(d);
      log('标记: GID' + t.GID + ' 渲染(' + cx.toFixed(0) + ',' + cy.toFixed(0) + ')→页面(' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ') 红框已画，看是否罩住怪');
    } catch (e) { log('标记异常: ' + e.message); }
  }
  // 模拟点击测试：对怪派发合成鼠标点击（客户端自己判距/走近/攻击）
  function clickTarget() {
    try {
      var t = findTarget();
      if (!t) { log('点击: 未找到目标怪'); return; }
      var b = t.boundingRect;
      if (!b) { log('点击: 目标无 boundingRect'); return; }
      var cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      var p = toPage(cx, cy);
      var cv = btCanvas();
      if (!cv) { log('点击: 未找到画布'); return; }
      var opts = { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, pointerId: 1, isPrimary: true };
      ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click'].forEach(function (t2) {
        try { cv.dispatchEvent(new (t2.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(t2, opts)); } catch (e) {}
      });
      log('点击: GID' + t.GID + ' 页面(' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ') 已派发合成点击，看角色是否攻击/走近');
    } catch (e) { log('点击异常: ' + e.message); }
  }
  // ---------------- buff 测试（状态上身诊断：实体字段优先 + 状态图标hook判活表）----------------
  var dshAtkBuffs = {};
  var ATK_ENT_FIELDS = {
    12: ['inc_agi', 'IncAgi', 'incAgi'], 10: ['blessing', 'Blessing'], 1: ['endure', 'Endure'],
    86: ['explosion'], 87: ['SteelBody', 'steelbody', 'steel_body'], 149: ['soullink'],
    107: ['berserk'], 27: ['riding', 'riding_'], 28: ['falcon'], 4: ['isHide', 'hiding'], 5: ['isHide', 'hiding']
  };
  function atkHookStatus() {
    try {
      if (window.__dshAtkSIHook) return;
      if (!window.require) return;
      var cands = ['UI/Components/StatusIcons/StatusIcons', 'UI/Components/StatusIcons', 'UI/Components/StatusIcons/StatusIcons.js', 'UI/Components/StatusIcons.js'];
      var SI = null;
      for (var i = 0; i < cands.length; i++) { try { var m = window.require(cands[i]); if (m && typeof m.update === 'function') { SI = m; break; } } catch (e) {} }
      if (!SI) return;
      var orig = SI.update;
      window.__dshAtkSIHook = true;
      SI.update = function (stId, active, layer, dur) {
        try {
          stId = parseInt(stId, 10);
          if (!isNaN(stId)) {
            var now = Date.now();
            if (active) dshAtkBuffs[stId] = { on: true, endAt: (dur === 9999 || dur == null) ? Infinity : now + (dur || 30000) };
            else if (dshAtkBuffs[stId]) dshAtkBuffs[stId].on = false;
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      log('buff: 已挂状态图标hook');
    } catch (e) {}
  }
  function atkEntVal(ent, keys) { for (var i = 0; i < keys.length; i++) { if (ent[keys[i]] !== undefined) return ent[keys[i]]; } return undefined; }
  function atkStateOn(stId) {
    try {
      stId = parseInt(stId, 10);
      var ent = window.CLIENT && window.CLIENT.SS && window.CLIENT.SS.Entity;
      if (ent && ATK_ENT_FIELDS[stId]) { var v = atkEntVal(ent, ATK_ENT_FIELDS[stId]); if (v !== undefined) return { via: '实体字段', on: (v === true || v === 1) }; }
      var st = dshAtkBuffs[stId];
      if (st) return { via: '状态图标hook', on: !!(st.on && st.endAt > Date.now()), endAt: st.endAt };
      return { via: '两者皆无', on: false };
    } catch (e) { return { via: '异常:' + e.message, on: false }; }
  }
  function atkCheckState() {
    try {
      atkHookStatus();
      var stid = parseInt((document.getElementById('dsh-atk-stid') || {}).value, 10);
      if (isNaN(stid)) { log('测状态: 状态ID无效'); return; }
      var r = atkStateOn(stid);
      var line = '状态' + stid + '：' + (r.on ? '在身' : '不在身/检测不到') + '（来源:' + r.via + '）';
      if (r.endAt) line += ' 剩余' + Math.max(0, Math.round((r.endAt - Date.now()) / 1000)) + 's';
      var el = document.getElementById('dsh-atk-buffinfo'), h = line;
      var ent = window.CLIENT && window.CLIENT.SS && window.CLIENT.SS.Entity;
      if (ent) {
        var ks = Object.keys(ATK_ENT_FIELDS), parts = [];
        for (var i = 0; i < ks.length; i++) { var v = atkEntVal(ent, ATK_ENT_FIELDS[ks[i]]); parts.push(ks[i] + '=' + (v === undefined ? '-' : v)); }
        h += '\n实体状态字段: ' + parts.join(' ');
      }
      var bks = Object.keys(dshAtkBuffs);
      if (bks.length) { var ps = []; for (var j = 0; j < bks.length; j++) { var bs = dshAtkBuffs[bks[j]]; ps.push(bks[j] + (bs.on ? '●' : '○')); } h += '\n图标判活表(' + bks.length + '): ' + ps.join(' '); }
      if (el) el.textContent = h;
      log('测状态: ' + line);
    } catch (e) { log('测状态异常: ' + e.message); }
  }
  function atkCastSkill() {
    try {
      if (!window.CLIENT || !CLIENT.NM || !CLIENT.PS) { log('放技能: 客户端未就绪'); return; }
      atkHookStatus();
      var skid = parseInt((document.getElementById('dsh-atk-skillid') || {}).value, 10);
      if (isNaN(skid)) { log('放技能: 技能ID无效'); return; }
      var stid = parseInt((document.getElementById('dsh-atk-stid') || {}).value, 10);
      var lv = 1;
      try {
        var sl = CLIENT.PS.SkillList || (CLIENT.PS.Skill && CLIENT.PS.Skill.list);
        if (sl) { for (var i = 0; i < sl.length; i++) { if (sl[i] && (sl[i].SKID === skid || sl[i].skid === skid)) { lv = sl[i].lv || sl[i].level || 1; break; } } }
      } catch (e) {}
      var p = new CLIENT.PS.CZ.USE_SKILL();
      p.SKID = skid; p.selectedLevel = lv; p.targetID = 0;
      CLIENT.NM.sendPacket(p);
      log('放技能: 已发技能' + skid + ' Lv' + lv + '（对自己）');
      setTimeout(function () {
        try {
          var r = atkStateOn(stid);
          log('上身检查(2s后): 状态' + stid + (r.on ? ' 已在身（来源:' + r.via + '）' : ' 未上身/检测不到（来源:' + r.via + '）'));
          var el = document.getElementById('dsh-atk-buffinfo');
          if (el) el.textContent = '技能' + skid + '释放2s后：状态' + stid + (r.on ? ' 已在身' : ' 未上身') + '（来源:' + r.via + '）';
        } catch (e2) {}
      }, 2000);
    } catch (e) { log('放技能异常: ' + e.message); }
  }
  function build() {
    if (document.getElementById('dsh-atk-root')) return;
    var root = document.createElement('div');
    root.id = 'dsh-atk-root';
    root.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483646;font-family:sans-serif;user-select:none';
    var btn = document.createElement('button');
    btn.textContent = '攻测';
    btn.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;background:#1d4e89;color:#fff;border:none;border-radius:4px';
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;margin-top:6px;width:270px;background:#fff;border:1px solid #b8c6d4;border-radius:6px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,.25)';
    panel.innerHTML =
      '<div style="font-size:12px;color:#1d4e89;margin-bottom:6px">RO 攻击测试（独立测试包）</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<button id="dsh-atk-mark-b" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">标记测试</button>' +
      '<button id="dsh-atk-click-b" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">模拟点击</button>' +
      '<button id="dsh-atk-close-b" style="flex:0 0 46px;padding:4px 0;font-size:11px;cursor:pointer">关闭</button>' +
      '</div>' +
      '<div id="dsh-atk-log" style="font-size:10px;height:140px;overflow:auto;background:#f4f6f8;border:1px solid #d8e0e8;border-radius:4px;padding:4px;font-family:monospace;white-space:pre-wrap;line-height:1.5">就绪。点「标记测试」画红框验证坐标，点「模拟点击」让角色攻击最近怪。</div>' +
      '<div style="border-top:1px solid #d8e0e8;margin-top:6px;padding-top:4px;font-size:11px;color:#1d4e89">buff 测试（状态上身诊断）</div>' +
      '<div style="display:flex;gap:4px;margin:4px 0"><input id="dsh-atk-stid" type="number" placeholder="状态ID" value="12" style="flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid #ccc;border-radius:3px"><input id="dsh-atk-skillid" type="number" placeholder="技能ID" value="29" style="flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid #ccc;border-radius:3px"></div>' +
      '<div style="display:flex;gap:4px;margin-bottom:4px"><button id="dsh-atk-stcheck" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">测状态</button><button id="dsh-atk-stcast" style="flex:1;padding:4px 0;font-size:11px;cursor:pointer">放技能看上身</button></div>' +
      '<div id="dsh-atk-buffinfo" style="font-size:10px;background:#fdf6ec;border:1px solid #eeddbb;border-radius:4px;padding:4px;margin-bottom:6px;white-space:pre-wrap;line-height:1.5">输入状态ID（默认12加速术）点「测状态」；输入技能ID点「放技能看上身」（2秒后自动复查）。</div>';
    btn.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
    panel.addEventListener('click', function (ev) {
      var id = ev.target && ev.target.id;
      if (id === 'dsh-atk-mark-b') markTarget();
      else if (id === 'dsh-atk-click-b') clickTarget();
      else if (id === 'dsh-atk-close-b') panel.style.display = 'none';
      else if (id === 'dsh-atk-stcheck') atkCheckState();
      else if (id === 'dsh-atk-stcast') atkCastSkill();
    });
    // 拖动按钮（拖动后转 left/top 定位）
    var dragging = false, dx = 0, dy = 0;
    btn.addEventListener('pointerdown', function (ev) {
      dragging = true; dx = ev.clientX - root.getBoundingClientRect().left; dy = ev.clientY - root.getBoundingClientRect().top;
      try { ev.preventDefault(); } catch (e) {}
    });
    window.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      root.style.left = (ev.clientX - dx) + 'px';
      root.style.top = (ev.clientY - dy) + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });
    window.addEventListener('pointerup', function () { dragging = false; });
    root.appendChild(btn);
    root.appendChild(panel);
    document.body.appendChild(root);
    log('面板就绪，等待游戏实体数据（点击「标记测试」开始）');
  }
  function ready() {
    try { return !!(window.CLIENT && window.CLIENT.SS && window.CLIENT.SS.Entity && window.require); } catch (e) { return false; }
  }
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (ready() || tries > 300) { clearInterval(iv); if (ready()) build(); }
  }, 1000);
})();
