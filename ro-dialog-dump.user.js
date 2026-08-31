// ==UserScript==
// @name         RO 对话框载体临时探测
// @namespace    dsh-dialog-dump
// @version      0.1.0
// @description  临时：开一次 NPC 对话，dump DOM 变更与入站包，判对话框文本是 DOM 还是 canvas/协议
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__dshDialogDumpDone) return;
  window.__dshDialogDumpDone = true;

  var T = { dom: [], pkt: [], pktCounts: {} };

  function hex(dv, off, n) {
    var s = '', end = Math.min(off + n, dv.byteLength);
    for (var i = off; i < end; i++) { var x = dv.getUint8(i); s += (x < 16 ? '0' : '') + x.toString(16); }
    return s;
  }
  function asciiRuns(dv, minLen) {
    var runs = [], cur = '';
    for (var i = 0; i < dv.byteLength; i++) {
      var c = dv.getUint8(i);
      if (c >= 0x20 && c <= 0x7e) { cur += String.fromCharCode(c); }
      else { if (cur.length >= minLen) runs.push(cur); cur = ''; }
    }
    if (cur.length >= minLen) runs.push(cur);
    return runs;
  }
  function onInbound(data) {
    try {
      if (!(data && data.byteLength !== undefined)) return;
      var dv = new DataView(data);
      var id = dv.byteLength >= 2 ? dv.getUint16(0, true) : -1;
      var key = id + ':' + hex(dv, 0, Math.min(24, dv.byteLength));
      if (!T.pktCounts[key]) {
        if (T.pkt.length < 120) {
          T.pkt.push({ id: id, len: dv.byteLength, hex: hex(dv, 0, Math.min(20, dv.byteLength)), ascii: asciiRuns(dv, 4).slice(0, 5) });
        }
        T.pktCounts[key] = 1;
      } else {
        T.pktCounts[key]++;
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
      console.log('[ddump] WebSocket 已劫持');
    } catch (e) { console.log('[ddump] WS hook 失败', e); }
  })();

  function textOf(n) {
    var t = (n && n.textContent || '').replace(/\s+/g, ' ').replace(/\s+$/g, '').trim();
    return t.length > 200 ? t.slice(0, 200) + '...' : t;
  }
  var seenDom = {};
  function startMo() {
    if (window.__dshMoStarted || !document.body) return;
    window.__dshMoStarted = true;
    var mo = new MutationObserver(function (muts) {
      var changed = false;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1 && n.nodeType !== 3) continue;
            var t = textOf(n);
            if (!t || t.length < 2 || seenDom[t]) continue;
            seenDom[t] = true;
            if (T.dom.length < 160) T.dom.push(t);
            changed = true;
          }
        }
      }
      if (changed) render();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    render();
  }
  function bootMo() {
    if (document.body) { startMo(); }
    else { document.addEventListener('DOMContentLoaded', startMo, { once: true }); }
  }

  var panel = null, ta = null, btnCopy = null, btnClear = null, status = null;
  function render() {
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:#0b0b0b;color:#3f3;font:12px/1.5 monospace;padding:8px;border:1px solid #3f3;max-width:460px;max-height:82vh;overflow:auto;';
      status = document.createElement('div');
      status.style.cssText = 'margin-bottom:6px;font-weight:bold;';
      ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.style.cssText = 'width:100%;height:200px;background:#000;color:#3f3;font:11px/1.4 monospace;border:1px solid #333;';
      btnClear = document.createElement('button');
      btnClear.textContent = '清空重记';
      btnClear.style.cssText = 'margin:6px 6px 0 0;padding:4px 10px;background:#333;color:#fff;border:0;cursor:pointer;font-weight:bold;';
      btnCopy = document.createElement('button');
      btnCopy.textContent = '复制 dump';
      btnCopy.style.cssText = 'margin-top:6px;padding:4px 10px;background:#3f3;color:#000;border:0;cursor:pointer;font-weight:bold;';
      panel.appendChild(status);
      panel.appendChild(ta);
      panel.appendChild(btnClear);
      panel.appendChild(btnCopy);
      document.body.appendChild(panel);
      btnClear.onclick = function () {
        T.dom = []; T.pkt = []; T.pktCounts = {}; seenDom = {};
        render(); btnClear.textContent = '已清空，去开对话';
      };
      btnCopy.onclick = function () {
        try {
          navigator.clipboard.writeText(ta.value).then(function(){ btnCopy.textContent = '已复制'; });
        } catch (e) {
          ta.select(); document.execCommand('copy'); btnCopy.textContent = '已复制';
        }
      };
    }
    status.textContent = 'DOM 新增 ' + T.dom.length + ' 条 / 入站包 ' + T.pkt.length + ' 种 / 去重后 ' + Object.keys(T.pktCounts).length;
    ta.value = JSON.stringify(T, null, 1);
  }

  bootMo();
  render();
})();

