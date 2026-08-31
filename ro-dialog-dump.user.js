// ==UserScript==
// @name         RO 对话框载体临时探测
// @namespace    dsh-dialog-dump
// @version      0.3.0
// @description  临时：判对话框载体+逆向封包。加游戏层隔离(不点地面)+可拖动窗口。GBK解码+DOM快照
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-dialog-dump.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-dialog-dump.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__dshDialogDumpDone) return;
  window.__dshDialogDumpDone = true;

  var T0 = performance.now();
  function ts() { return Math.round(performance.now() - T0); }
  var T = { dom: [], pkt: [], snap: null };
  var seenDom = {};

  // ---- 与游戏层隔离 + 拖动（复用 ro-assist isolateEl / dragEl 思路）----
  var ISO = ["mousedown", "mousemove", "mouseup", "click", "dblclick", "wheel", "contextmenu",
    "touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup"];
  function isolateEl(el) {
    if (!el) return;
    for (var i = 0; i < ISO.length; i++) {
      el.addEventListener(ISO[i], function (ev) { try { ev.stopPropagation(); } catch (e) {} }, false);
    }
    return el;
  }
  function fallbackStop(ev) {
    try { if (ev.target && ev.target.closest && ev.target.closest('[data-dsh-dump]')) ev.stopPropagation(); } catch (e) {}
  }
  function makeDraggable(handle, panelEl) {
    var sx, sy, ox, oy, moving = false;
    try { handle.style.touchAction = 'none'; handle.style.cursor = 'move'; } catch (e) {}
    function onMove(e) {
      if (!moving) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { onUp(e); return; }
      var nx = ox + e.clientX - sx, ny = oy + e.clientY - sy;
      nx = Math.max(0, Math.min(nx, window.innerWidth - 60));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
      panelEl.style.left = nx + 'px'; panelEl.style.top = ny + 'px';
    }
    function onUp(e) {
      moving = false;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture && handle.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    handle.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      moving = true;
      sx = e.clientX; sy = e.clientY;
      var r = panelEl.getBoundingClientRect();
      ox = r.left; oy = r.top;
      try { if (e.cancelable) e.preventDefault(); } catch (err) {}
      try { handle.setPointerCapture && handle.setPointerCapture(e.pointerId); } catch (err) {}
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  function hex(dv, off, n) {
    var s = '', end = Math.min(off + n, dv.byteLength);
    for (var i = off; i < end; i++) { var x = dv.getUint8(i); s += (x < 16 ? '0' : '') + x.toString(16); }
    return s;
  }
  function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s); }
  function extText(buf) {
    var out = [];
    function collect(s, enc) {
      var runs = s.split(/[\x00-\x1f\x7f]+/);
      for (var i = 0; i < runs.length; i++) {
        var r = runs[i].replace(/\s+/g, ' ').trim();
        if (!r) continue;
        if ((hasCJK(r) && r.length >= 2) || (!hasCJK(r) && r.length >= 6)) out.push('[' + enc + '] ' + r);
      }
    }
    try { collect(new TextDecoder('utf-8', { fatal: false }).decode(buf), 'utf8'); } catch (e) {}
    try { collect(new TextDecoder('gbk').decode(buf), 'gbk'); } catch (e) {}
    return out.slice(0, 8);
  }
  function onInbound(data) {
    try {
      if (!(data && data.byteLength !== undefined)) return;
      var dv = new DataView(data);
      var id = dv.byteLength >= 2 ? dv.getUint16(0, true) : -1;
      var key = id + ':' + hex(dv, 0, Math.min(24, dv.byteLength));
      if (!T.pktSeen) T.pktSeen = {};
      if (!T.pktSeen[key]) {
        if (T.pkt.length < 200) {
          T.pkt.push({ t: ts(), id: id, len: dv.byteLength, hex: hex(dv, 0, Math.min(64, dv.byteLength)), text: extText(data) });
        }
        T.pktSeen[key] = 1;
      } else {
        T.pktSeen[key]++;
      }
      render();
    } catch (e) {}
  }
  (function hookWs() {
    try {
      var N = window.WebSocket;
      if (!N || N.__dshDump) return;
      function PW(url, protocols) {
        var inst = protocols !== undefined ? new N(url, protocols) : new N(url);
        try { inst.addEventListener('message', function (ev) { onInbound(ev.data); }); } catch (e) {}
        return inst;
      }
      PW.prototype = N.prototype;
      PW.CONNECTING = N.CONNECTING; PW.OPEN = N.OPEN; PW.CLOSING = N.CLOSING; PW.CLOSED = N.CLOSED;
      PW.__dshDump = true;
      window.WebSocket = PW;
      console.log('[ddump] WebSocket hooked');
    } catch (e) { console.log('[ddump] WS hook fail', e); }
  })();

  function nameOf(n) {
    if (n.nodeType === 3) return '#text';
    if (n.nodeType !== 1) return '?';
    var s = n.tagName ? n.tagName.toLowerCase() : '';
    if (n.id) s += '#' + n.id;
    if (n.className && typeof n.className === 'string') s += '.' + String(n.className).trim().replace(/\s+/g, '.');
    return s;
  }
  function textOf(n) {
    var t = (n && n.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 200 ? t.slice(0, 200) : t;
  }
  function startMo() {
    if (window.__dshMoStarted || !document.body) return;
    window.__dshMoStarted = true;
    var mo = new MutationObserver(function (muts) {
      var changed = false;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type !== 'childList') continue;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1 && n.nodeType !== 3) continue;
          if (panel && panel.contains(n)) continue;
          var t = textOf(n);
          if (!t) continue;
          var k = nameOf(n) + '|' + t;
          if (seenDom[k]) continue;
          seenDom[k] = true;
          if (T.dom.length < 300) T.dom.push({ t: ts(), at: nameOf(n), text: t });
          changed = true;
        }
      }
      if (changed) render();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    render();
  }
  function bootMo() {
    if (document.body) { startMo(); }
    else { document.addEventListener('DOMContentLoaded', startMo, { once: true }); }
  }

  var panel = null, ta = null;
  function mkBtn(label, bg, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin:6px 6px 0 0;padding:4px 10px;background:' + bg + ';color:#fff;border:0;cursor:pointer;font-weight:bold;';
    b.onclick = fn;
    return b;
  }
  function render() {
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement('div');
      panel.setAttribute('data-dsh-dump', '1');
      panel.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:#0b0b0b;color:#3f3;font:12px/1.5 monospace;padding:8px;border:1px solid #3f3;max-width:480px;max-height:82vh;overflow:auto;';
      var hd = document.createElement('div');
      hd.textContent = 'Dump 探测 — 按住此处拖动';
      hd.style.cssText = 'padding:4px 8px;background:#153;color:#3f3;font-weight:bold;user-select:none;-webkit-user-select:none;cursor:move;margin:-8px -8px 6px;';
      panel.appendChild(hd);
      ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.style.cssText = 'width:100%;height:220px;background:#000;color:#3f3;font:11px/1.4 monospace;border:1px solid #333;';
      panel.appendChild(ta);
      panel.appendChild(mkBtn('清空重记', '#333', function () {
        T.dom = []; T.pkt = []; T.snap = null; T.pktSeen = {}; seenDom = {};
        render();
      }));
      panel.appendChild(mkBtn('抓 DOM 快照', '#226', function () {
        var s = document.body.innerText || '';
        T.snap = s.length > 4000 ? s.slice(0, 4000) : s;
        render();
      }));
      panel.appendChild(mkBtn('复制 dump', '#3f3', function () {
        try { navigator.clipboard.writeText(ta.value).then(function () {}); } catch (e) { ta.select(); document.execCommand('copy'); }
      }));
      document.body.appendChild(panel);
      isolateEl(panel);
      makeDraggable(hd, panel);
      for (var i3 = 0; i3 < ISO.length; i3++) { document.addEventListener(ISO[i3], fallbackStop, false); }
    }
    var o = { counts: { dom: T.dom.length, pkt: T.pkt.length }, dom: T.dom.slice(-60), pkt: T.pkt, snap: T.snap };
    ta.value = JSON.stringify(o, null, 1);
  }

  bootMo();
  render();
})();

