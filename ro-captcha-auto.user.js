// ==UserScript==
// @name         RO 登录验证自动过（独立版）
// @namespace    dsh.ro-captcha-auto
// @version      1.1.1
// @description  收到 op=180 中文数字算式验证弹窗（登录/换角色随时弹出）自动算出结果：点确认/回车 → 填入输入框 → 等 N 秒 → 点「下面」/确认/回车提交。右下角状态条：单击开关，双击设置等待秒数（默认 10）。也可与 ro-assist 共存（助手内已集成时不装本脚本）。
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ---------------- 配置（localStorage：dsh_captcha_enable=1/0，dsh_captcha_wait=秒数）----------------
  var LS_EN = "dsh_captcha_enable";
  var LS_WAIT = "dsh_captcha_wait";
  function getEn() { try { return localStorage.getItem(LS_EN) !== "0"; } catch (e) { return true; } }
  function getWait() { try { var v = parseInt(localStorage.getItem(LS_WAIT), 10); return isNaN(v) ? 10 : Math.max(0, v); } catch (e) { return 10; } }
  function setEn(v) { try { localStorage.setItem(LS_EN, v ? "1" : "0"); } catch (e) {} }
  function setWait(v) { try { localStorage.setItem(LS_WAIT, String(v)); } catch (e) {} }

  // ---------------- 中文数字算式解析 ----------------
  var CAP_DIG = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  var CAP_UNIT = { "十": 10, "百": 100, "千": 1000, "万": 10000 };
  function capCnvNum(s) {
    s = String(s || "").trim(); if (!s) return NaN;
    var total = 0, seg = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (CAP_DIG[ch] !== undefined) cur = CAP_DIG[ch];
      else if (CAP_UNIT[ch] !== undefined) {
        var u = CAP_UNIT[ch];
        if (u === 10000) { total = (total + (seg + (cur || 1))) * u; seg = 0; cur = 0; }
        else { seg += (cur || 1) * u; cur = 0; }
      } else return NaN;
    }
    return total + seg + cur;
  }
  function capEval(txt) {
    try {
      var t = String(txt || "").replace(/[（(]/g, "").replace(/[）)]/g, "").replace(/\s+/g, "");
      var toks = t.match(/[零一二两三四五六七八九十百千万]+|[加减乘除]+/g);
      if (!toks || toks.length < 3) return NaN;
      var nums = [], ops = [];
      for (var i = 0; i < toks.length; i++) {
        if (/^[加减乘除]+$/.test(toks[i])) { for (var j = 0; j < toks[i].length; j++) ops.push(toks[i].charAt(j)); }
        else { var v = capCnvNum(toks[i]); if (isNaN(v)) return NaN; nums.push(v); }
      }
      if (nums.length !== ops.length + 1) return NaN;
      var n2 = [nums[0]], o2 = [];
      for (var k = 0; k < ops.length; k++) {
        var o = ops[k], v = nums[k + 1];
        if (o === "乘") n2[n2.length - 1] = n2[n2.length - 1] * v;
        else if (o === "除") n2[n2.length - 1] = n2[n2.length - 1] / v;
        else { n2.push(v); o2.push(o); }
      }
      var r = n2[0];
      for (var m = 0; m < o2.length; m++) r += (o2[m] === "加" ? 1 : -1) * n2[m + 1];
      return Math.round(r * 1000) / 1000;
    } catch (e) { return NaN; }
  }
  function capTryParse(msg) {
    // 真实弹窗文本形如 " ( 三 （乘） 一百 （加） 二十 四"：先去空格与全角/半角括号再匹配
    var t = String(msg || "").replace(/[（(]/g, "").replace(/[）)]/g, "").replace(/\s+/g, "");
    var m = t.match(/([零一二两三四五六七八九十百千万]+(?:[加减乘除][零一二两三四五六七八九十百千万]+)+)/);
    if (!m) return null;
    var result = capEval(m[1]);
    if (isNaN(result)) return null;
    return { expr: m[1], result: result };
  }
  function capFindConfirm() {
    var all = document.querySelectorAll("button, div, span, li, a, input[type=button], input[type=submit]");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var txt = ((el.textContent || "") + (el.value || "")).replace(/\s+/g, "");
      if (!txt) continue;
      if (txt === "确认" || txt === "确定" || txt === "OK" || txt === "好" || txt === "确定!") return el;
      if ((txt.indexOf("确认") === 0 || txt.indexOf("确定") === 0) && el.children.length === 0 && txt.length <= 8) return el;
    }
    return null;
  }
  function capConfirm() {
    try {
      var el = capFindConfirm();
      if (el) { el.click(); return true; }
      return false;
    } catch (e) { return false; }
  }
  function capEnter() {
    try {
      var el = document.activeElement || document.body;
      var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keypress", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
      return true;
    } catch (e) { return false; }
  }

  // ---------------- 解码 ----------------
  // 1.1.1：op=180 验证包=提示段+空段+算式段，按 00 逐段解码拼接（旧版只取首段会丢算式）
  function decodeMenuMsg(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var parts = [], cur = [];
    for (var i = 0; i <= u.length; i++) {
      var b = (i < u.length) ? u[i] : 0;
      if (b === 0 || i === u.length) {
        if (cur.length) {
          var s;
          try { s = new TextDecoder("gbk").decode(new Uint8Array(cur)); }
          catch (e) { s = new TextDecoder("utf-8").decode(new Uint8Array(cur)); }
          parts.push(s.replace(/[\u0000-\u001f\u007f\ufffd]/g, ""));
        }
        cur = [];
      } else { cur.push(b); }
    }
    return parts.join("");
  }

  // ---------------- DOM 操作 ----------------
  function capFindInput() {
    var ins = document.querySelectorAll("input");
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i], r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var t = (el.type || "").toLowerCase();
      if (t === "text" || t === "number" || t === "tel" || t === "") return el;
    }
    return null;
  }
  function capFillInput(val) {
    try {
      var el = capFindInput();
      if (!el) { setState("已算出 " + val + "，但未找到输入框", true); return false; }
      el.focus();
      try { var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value"); if (setter && setter.set) setter.set.call(el, val); else el.value = val; } catch (e2) { el.value = val; }
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e3) {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e4) {}
      setState("已填入 " + val + "，等 " + getWait() + "s", false);
      return true;
    } catch (e) { setState("填写异常: " + e.message, true); return false; }
  }
  function capClickSubmit() {
    try {
      // 1) 优先点「下面」
      var all = document.querySelectorAll("button, div, span, li, a");
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        var txt = (el.textContent || "").replace(/\s+/g, "");
        if (txt === "下面" || (txt.indexOf("下面") >= 0 && el.children.length === 0 && txt.length <= 8)) {
          el.click(); setState("已点「下面」", false); return true;
        }
      }
      // 2) 其次点「确认/确定」
      if (capConfirm()) { setState("已点「确认」", false); return true; }
      // 3) 最后按回车
      if (capEnter()) { setState("已按回车提交", false); return true; }
      setState("未找到提交按钮（结果已填入）", true);
      return false;
    } catch (e) { setState("提交异常: " + e.message, true); return false; }
  }

  // ---------------- 触发 ----------------
  var busy = false;
  function capTrigger(msg) {
    try {
      if (!getEn() || busy) return;
      var p = capTryParse(msg);
      if (!p) return;
      busy = true;
      setState("算式 " + p.expr + " = " + p.result, false);
      console.log("[验证自动过] 识别算式 " + p.expr + " = " + p.result);
      var wait = getWait() * 1000;
      setTimeout(function () {
        // 第一步：输入框若已就绪直接填；否则先点确认/回车（弹窗第一步确认）
        try {
          var inp = capFindInput();
          if (inp) {
            console.log("[验证自动过] 输入框已就绪，跳过第一步确认");
          } else {
            var ok = capConfirm();
            if (ok) console.log("[验证自动过] 第一步：已点确认按钮");
            else { capEnter(); console.log("[验证自动过] 第一步：已按回车"); }
          }
        } catch (e) {}
        setTimeout(function () {
          try { capFillInput(String(p.result)); } catch (e) {}
          console.log("[验证自动过] 第二步：填入结果 " + p.result);
          setTimeout(function () {
            try { capClickSubmit(); } catch (e) {}
            setTimeout(function () { busy = false; }, 2000);
          }, wait);
        }, 600);
      }, 400);
    } catch (e) {}
  }

  // ---------------- WS hook（只认 op=180 弹窗包）----------------
  function handleBytes(buf) {
    try {
      var dv = new DataView(buf);
      if (buf.byteLength < 6) return;
      if (dv.getUint16(0, true) !== 180) return;
      var u8 = new Uint8Array(buf);
      var msg = decodeMenuMsg(u8.subarray(6));
      if (!msg) return;
      capTrigger(msg);
    } catch (e) {}
  }
  function hookWS() {
    try {
      if (window.__dshCapHooked) return;
      var N = window.WebSocket;
      if (!N) return;
      function PW(url, protocols) {
        var inst = protocols !== undefined ? new N(url, protocols) : new N(url);
        inst.addEventListener("message", function (ev) {
          try {
            var d = ev.data;
            var buf = d instanceof ArrayBuffer ? d : (d && d.buffer instanceof ArrayBuffer ? d.buffer : null);
            if (buf) { handleBytes(buf); return; }
            if (typeof Blob !== "undefined" && d instanceof Blob && d.arrayBuffer) d.arrayBuffer().then(function (b) { try { handleBytes(b); } catch (e) {} });
          } catch (e) {}
        });
        return inst;
      }
      PW.prototype = N.prototype; PW.CONNECTING = N.CONNECTING; PW.OPEN = N.OPEN; PW.CLOSING = N.CLOSING; PW.CLOSED = N.CLOSED;
      window.WebSocket = PW;
      window.__dshCapHooked = true;
    } catch (e) {}
  }
  // 等游戏脚本就绪后 hook（登录页/游戏页都可能在加载）
  var tries = 0;
  (function waitHook() {
    if (!window.WebSocket) { if (++tries < 40) setTimeout(waitHook, 500); return; }
    hookWS();
  })();
  setInterval(function () { try { hookWS(); } catch (e) {} }, 3000); // 页面重载保险

  // ---------------- 右下角状态条 ----------------
  function setState(txt, warn) {
    try {
      var el = document.getElementById("dsh-cap-bar");
      if (!el) return;
      el.textContent = "验证:" + txt;
      el.style.background = warn ? "rgba(180,60,40,.95)" : (getEn() ? "rgba(30,120,60,.92)" : "rgba(90,100,110,.92)");
      el.title = (getEn() ? "自动过验证：开（单击关闭）" : "自动过验证：关（单击开启）") + "\n双击设置等待秒数（当前 " + getWait() + "s）";
    } catch (e) {}
  }
  function buildBar() {
    try {
      if (document.getElementById("dsh-cap-bar")) return;
      var d = document.createElement("div");
      d.id = "dsh-cap-bar";
      d.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:999999;padding:3px 8px;font-size:11px;color:#fff;border-radius:4px;cursor:pointer;font-family:monospace;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      d.addEventListener("click", function () { setEn(!getEn()); setState(getEn() ? "已开启" : "已关闭", false); console.log("[验证自动过] " + (getEn() ? "已开启（等" + getWait() + "s提交）" : "已关闭")); });
      d.addEventListener("dblclick", function () {
        var v = prompt("过验证提交前等待秒数（0=立即提交，当前 " + getWait() + "）:", String(getWait()));
        if (v === null) return;
        var n = parseInt(v, 10);
        if (isNaN(n) || n < 0) { alert("请输入 0 或正整数"); return; }
        setWait(n); setState("等待改为 " + n + "s", false);
      });
      (document.body || document.documentElement).appendChild(d);
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildBar);
  else buildBar();
  setTimeout(function () { setState(getEn() ? "待命(等" + getWait() + "s)" : "已关闭", false); }, 800);

  // 控制台 API：window.__cap({enable:true, wait:5})
  window.__cap = function (cfg) {
    if (cfg && cfg.enable !== undefined) setEn(!!cfg.enable);
    if (cfg && cfg.wait !== undefined) setWait(Math.max(0, parseInt(cfg.wait, 10) || 0));
    setState(getEn() ? "待命(等" + getWait() + "s)" : "已关闭", false);
    return { enable: getEn(), wait: getWait() };
  };
  console.log("[验证自动过] 已注入（" + (getEn() ? "开启，等" + getWait() + "s提交" : "关闭") + "）；单击右下角状态条开关，双击设置等待秒数");
})();
