// ==UserScript==
// @name         RO 物品标色 (ItemHighlight)
// @namespace    dsh.ro
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-itemhl.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-itemhl.user.js
// @description  物品栏赏金材料/自定义 ID 金边高亮（独立版）：赏金任务收集品默认金色（92 件清单），自定义高亮 ID[颜色] 进名单可增删；名单数据与助手共用（localStorage dsh_ro_hlrules）。纯显示，不影响拾取/防御。
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__dsh_ihl) return; window.__dsh_ihl = true;

  // ---------------- 常量 ----------------
  var V = '1.1';
  // 与 ro-assist / ro-wiki BOUNTY 一致（赏金任务收集品 92 件，按游戏内导出重建）
  var BOUNTY_ITEMS = ['507','508','509','510','511','518','526','608','618','714','719','720','721','723','726','727','729','741','750','751','753','754','7206','7038','1001','733','1004','7027','7026','7035','722','7047','7048','7209','970','7002','922','7014','1097','7015','7016','713','919','921','931','948','950','1038','7114','7113','7211','7023','7022','701','743','1041','730','731','732','934','1020','539','609','604','915','1059','739','1008','1009','971','972','1051','1049','1047','7041','7054','1064','7063','1040','7053','901','1094','1025','1045','941','1034','7108','7020','7036','958','740','742'];
  // 颜色白名单（防 CSS 注入，白名单外忽略）
  var HL_COLORS = {
    yellow: { c: '#e8b400', r: '232,180,0' },
    red:    { c: '#e04b3a', r: '224,75,58' },
    green:  { c: '#4caf50', r: '76,175,80' },
    blue:   { c: '#4a90e2', r: '74,144,226' },
    purple: { c: '#9c6ade', r: '156,106,222' },
    orange: { c: '#ff8f2b', r: '255,143,43' },
    cyan:   { c: '#2ec4b6', r: '46,196,182' },
    white:  { c: '#f2f3f5', r: '242,243,245' },
    pink:   { c: '#f26d9c', r: '242,109,156' }
  };
  var RULE_KEY = 'dsh_ro_hlrules';

  // ---------------- 规则存储（与助手共用同一份名单） ----------------
  var rules = [];
  function loadRules() {
    try {
      var raw = localStorage.getItem(RULE_KEY);
      if (raw) { var j = JSON.parse(raw); if (Array.isArray(j)) rules = j; }
    } catch (e) {}
    // 去重（同 id 后覆盖前）+ 颜色白名单过滤
    var map = {};
    rules.forEach(function (r) { if (r && HL_COLORS[r.color]) map[String(r.id)] = r.color; });
    rules = [];
    for (var k in map) rules.push({ id: k, color: map[k] });
  }
  function saveRules() {
    try { localStorage.setItem(RULE_KEY, JSON.stringify(rules)); } catch (e) {}
    var c = $('hlcount'); if (c) c.textContent = rules.length + ' 条';
  }
  function parseHlText(txt) {
    var arr = [], re = /(\d+)\[(\w+)\]/g, mm;
    while ((mm = re.exec(txt || '')) !== null) {
      var col = (mm[2] || '').toLowerCase();
      if (HL_COLORS[col]) arr.push({ id: String(mm[1]), color: col });
    }
    return arr;
  }

  // ---------------- 样式 ----------------
  var styleEl = null;
  function ruleCss(id, col) {
    var def = HL_COLORS[col] || HL_COLORS.yellow;
    return '.item[data-itid="' + id + '"]{border-left:3px solid ' + def.c + ' !important;outline:none !important;box-shadow:none !important;}';
  }
  function rebuild() {
    try {
      var on = $('bounty') && $('bounty').checked;
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      styleEl = null;
      if (!on) { renderList(); return; }
      styleEl = document.createElement('style');
      styleEl.id = 'dsh-ihl-style';
      var hl = {};
      rules.forEach(function (r) { hl[r.id] = r.color; });
      var css = '';
      for (var i = 0; i < BOUNTY_ITEMS.length; i++) {
        var bId = BOUNTY_ITEMS[i];
        if (hl[bId]) continue;
        css += ruleCss(bId, 'yellow');
      }
      for (var k in hl) css += ruleCss(k, hl[k]);
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
      renderList();
    } catch (e) {}
  }

  // ---------------- 物品名 ----------------
  function nameOf(id) {
    try {
      var w = window, CL = w.CLIENT, DB = null;
      if (CL && CL.DB) DB = CL.DB;
      else if (typeof w.require === 'function') DB = w.require('DB/DBManager');
      if (DB && typeof DB.getItemInfo === 'function') {
        var info = DB.getItemInfo(id);
        if (info) return info.identifiedDiSPlayName || info.name || null;
      }
    } catch (e) {}
    return null;
  }

  // ---------------- 名单列表 ----------------
  function renderList() {
    try {
      var el = $('list');
      if (!el) return;
      saveRules();
      if (!rules.length) { el.innerHTML = '<span style="color:#7b86a0">空（输入 ID[颜色] 添加）</span>'; return; }
      var html = '';
      rules.forEach(function (r) {
        var def = HL_COLORS[r.color] || HL_COLORS.yellow;
        var nm = nameOf(r.id) || ('ID' + r.id);
        html += '<div class="li"><span class="sw" style="background:' + def.c + '"></span>' +
                '<span class="nm" title="' + nm + '">' + nm + '(<span style="color:#8a94aa">' + r.id + '</span>)</span>' +
                '<span style="color:#7b86a0">[' + r.color + ']</span>' +
                '<button type="button" data-id="' + r.id + '" title="删除">×</button></div>';
      });
      el.innerHTML = html;
      el.querySelectorAll('button[data-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          rules = rules.filter(function (x) { return String(x.id) !== b.getAttribute('data-id'); });
          saveRules();
          renderList();
          rebuild();
        });
      });
    } catch (e) {}
  }

  // ---------------- 输入 ----------------
  function addFromInput() {
    try {
      var inp = $('input');
      if (!inp) return;
      var arr = parseHlText(inp.value);
      if (!arr.length) { flash('格式：ID[颜色]，颜色限 yellow/red/green/blue/purple/orange/cyan/white/pink'); return; }
      var map = {};
      rules.forEach(function (r) { map[r.id] = r.color; });
      arr.forEach(function (r) { map[r.id] = r.color; });
      rules = [];
      for (var k in map) rules.push({ id: k, color: map[k] });
      inp.value = '';
      saveRules();
      renderList();
      rebuild();
    } catch (e) {}
  }

  // ---------------- 小工具 ----------------
  function $(id) { return document.getElementById('dsh-ihl-' + id); }
  function flash(msg) {
    try {
      var f = $('flash');
      if (!f) return;
      f.textContent = msg;
      f.style.opacity = '1';
      clearTimeout(f._t);
      f._t = setTimeout(function () { f.style.opacity = '0'; }, 2200);
    } catch (e) {}
  }

  // 拖拽（鼠标 + 触摸，作用于悬浮按钮/面板卡片，可随心移动并保存位置）
  function makeDraggable(el, handle, posKey, isBtn) {
    if (!el || !handle) return;
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', function (e) {
      // 卡片用标题栏当把手时，点按钮/输入框不触发拖拽；按钮整体拖动（isBtn）不排除自身
      if (!isBtn && e.target && e.target.closest && e.target.closest('button,input,select,textarea,label')) return;
      moved = false;
      sx = e.clientX; sy = e.clientY;
      var r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      handle.style.cursor = 'grabbing';
      try { e.preventDefault(); } catch (err) {}
      function onMove(ev) {
        var nx = ox + (ev.clientX - sx), ny = oy + (ev.clientY - sy);
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
        nx = Math.max(0, Math.min(window.innerWidth - 24, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 24, ny));
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      }
      function onUp() {
        handle.style.cursor = 'grab';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // 若发生了拖动，标记本次松手为「拖动结束」而非「点击」，抑制随后触发的 click 切换
        if (moved) { el.__dsDragged = true; setTimeout(function () { el.__dsDragged = false; }, 60); }
        try {
          localStorage.setItem(posKey, JSON.stringify([parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0]));
        } catch (err) {}
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    // 恢复上次位置
    try {
      var p = JSON.parse(localStorage.getItem(posKey) || 'null');
      if (p && isFinite(p[0]) && isFinite(p[1])) {
        el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      }
    } catch (e) {}
  }

  // ---------------- UI ----------------
  var CSS =
    '#dsh-ihl-btn{position:fixed;top:14px;right:14px;z-index:2147483640;background:#232b3a;color:#e8e8e8;border:1px solid #3a4a66;border-radius:18px;padding:6px 14px;font-size:12px;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.4);font-family:system-ui,sans-serif;touch-action:none;user-select:none}' +
    '#dsh-ihl-btn:active{cursor:grabbing}' +
    '#dsh-ihl-btn:hover{border-color:#5a6d94}' +
    '#dsh-ihl-card{display:none;position:fixed;top:52px;right:14px;z-index:2147483641;width:280px;max-height:70vh;overflow:auto;background:#1a2030;border:1px solid #3a4a66;border-radius:10px;padding:12px;font-size:12px;color:#e2e6ef;box-shadow:0 4px 18px rgba(0,0,0,.5);font-family:system-ui,sans-serif}' +
    '#dsh-ihl-card .hd{display:flex;align-items:center;margin-bottom:10px;cursor:grab;touch-action:none;user-select:none}' +
    '#dsh-ihl-card .hd:active{cursor:grabbing}' +
    '#dsh-ihl-card .hd b{font-size:13px}' +
    '#dsh-ihl-card .hd .x{margin-left:auto;background:none;border:none;color:#9aa4ba;cursor:pointer;font-size:16px;padding:0 2px}' +
    '#dsh-ihl-row1{display:flex;align-items:center;gap:6px;margin-bottom:10px}' +
    '#dsh-ihl-bounty{accent-color:#e8b400}' +
    '#dsh-ihl-input{width:100%;box-sizing:border-box;background:#0f1522;border:1px solid #3a4a66;color:#e2e6ef;border-radius:6px;padding:6px 8px;font-size:12px}' +
    '#dsh-ihl-input::placeholder{color:#5a6580}' +
    '#dsh-ihl-list{margin-top:8px;border-top:1px dashed #33405a;padding-top:8px}' +
    '#dsh-ihl-list .li{display:flex;align-items:center;gap:6px;padding:3px 0}' +
    '#dsh-ihl-list .sw{width:10px;height:10px;border-radius:2px;flex:none}' +
    '#dsh-ihl-list .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#dsh-ihl-list button{background:none;border:none;color:#9aa4ba;cursor:pointer;font-size:14px;line-height:1;padding:0 4px}' +
    '#dsh-ihl-list button:hover{color:#ff6b5e}' +
    '#dsh-ihl-flash{min-height:14px;color:#ffb36b;opacity:0;transition:opacity .3s;margin-top:6px;word-break:break-all}';

  function init() {
    try {
      var st = document.createElement('style');
      st.id = 'dsh-ihl-ui';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);

      var btn = document.createElement('button');
      btn.id = 'dsh-ihl-btn';
      btn.type = 'button';
      btn.textContent = '标色';
      document.body.appendChild(btn);

      var card = document.createElement('div');
      card.id = 'dsh-ihl-card';
      card.innerHTML =
        '<div class="hd"><b>物品标色 v' + V + '</b><button type="button" class="x" title="关闭">×</button></div>' +
        '<div id="dsh-ihl-row1"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="dsh-ihl-bounty" checked>赏金材料金边（默认黄）</label></div>' +
        '<input type="text" id="dsh-ihl-input" placeholder="ID[颜色] 回车添加，如 970[yellow]，724[red]" style="width:100%">' +
        '<div id="dsh-ihl-list"></div>' +
        '<div id="dsh-ihl-flash"></div>';
      document.body.appendChild(card);

      // 事件
      btn.addEventListener('click', function () {
        if (btn.__dsDragged) { btn.__dsDragged = false; return; } // 拖动松手不切换
        card.style.display = (card.style.display === 'none') ? 'block' : 'none';
      });
      card.querySelector('.x').addEventListener('click', function () { card.style.display = 'none'; });
      var inp = $('input');
      function addH() { addFromInput(); }
      inp.addEventListener('change', addH);
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addH(); } });
      $('bounty').addEventListener('change', rebuild);

      // 可拖动：悬浮按钮整体、面板卡片用标题栏当把手（位置持久化）
      makeDraggable(btn, btn, 'dsh_ihl_btn_pos', true);
      makeDraggable(card, card.querySelector('.hd'), 'dsh_ihl_card_pos', false);

      loadRules();
      rebuild();
    } catch (e) {}
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();