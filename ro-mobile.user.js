// ==UserScript==
// @name         RO 手机自适应 ro-mobile
// @namespace    https://github.com/Keeee1th/Lro-user-scripts
// @version      1.0.2
// @description  手机使用 PC 网页 api.html 的触控适配与掉线防护:自动加载手机内核(Online_mn),自定义操作键(开窗/键盘/点地),后台保活(隐藏PING+音频+WebLock+防熄屏),可与 ro-assist 双开(检测式不抢占)
// @match        https://post.lastro.cn/ro/api.html*
// @match        http://post.lastro.cn/ro/api.html*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-mobile.user.js
// ==/UserScript==

(function () {
  "use strict";
  var VER = "1.0.2";
  var LS_KEY = "dsh_ro_mobile_v1";
  var version = (location.href.match(/[?&]v=([\d.]+)/i) || [null, "69.32"])[1];

  // 仅 api.html 生效(PC 网页壳)
  if (!/\/ro\/api\.html/.test(location.pathname)) return;

  // ---------------- 客户端配置(对齐 ro-assist 的 ROConfig DEFAULTS,application 换手机内核) ----------------
  function urlCv() { var m = location.href.match(/[?&]cv=(\d+)/); return m ? parseInt(m[1], 10) : null; }
  function pickCv() { var u = urlCv(); if (u != null) return u; return (cfg && cfg.line) ? cfg.line : 3; }
  var DEFAULTS = {
    application: "Online_mn",           // 手机内核:原生摇杆 + 触摸驱动 + 掉线 keepalive
    servers: "data/clientinfo.xml",
    grfList: null,
    remoteClient: "/ro/client_re/",
    packetver: "auto",
    development: false,
    api: false,
    socketProxy: "wss://port.lastro.cn/",
    packetKeys: false,
    saveFiles: true,
    skipServerList: true,
    skipIntro: true,
    autoLogin: [],
    clientHash: null,
    plugins: { IntroMessagePc: {}, LoadingDonate: {} },
    charBlockSize: 0,
    BGMFileExtension: ["mp3"],
    ClientVer: pickCv()
  };

  // 开窗组件名(UI/UIManager.getComponent) → 中文名
  var WIN_MAP = {
    Equipment: "装备", Inventory: "物品", SkillList: "技能", Storage: "仓库",
    ChatBox: "聊天", MiniMap: "小地图", WorldMap: "世界地图", BasicInfo: "状态",
    Escape: "菜单", StatusIcons: "状态栏", ShortCut: "快捷键栏", WinList: "窗口列表"
  };
  var WIN_ORDER = ["Equipment", "Inventory", "SkillList", "Storage", "ChatBox", "MiniMap", "WorldMap", "BasicInfo", "Escape", "StatusIcons", "ShortCut", "WinList"];
  // 合成键盘映射(keyCode 对齐客户端 Controls/KeyEventHandler)
  var KEY_MAP = {
    Enter: { key: "Enter", keyCode: 13, code: "Enter" }, Escape: { key: "Escape", keyCode: 27, code: "Escape" },
    Tab: { key: "Tab", keyCode: 9, code: "Tab" }, Space: { key: " ", keyCode: 32, code: "Space" },
    ArrowUp: { key: "ArrowUp", keyCode: 38, code: "ArrowUp" }, ArrowDown: { key: "ArrowDown", keyCode: 40, code: "ArrowDown" },
    ArrowLeft: { key: "ArrowLeft", keyCode: 37, code: "ArrowLeft" }, ArrowRight: { key: "ArrowRight", keyCode: 39, code: "ArrowRight" },
    W: { key: "w", keyCode: 87, code: "KeyW" }, A: { key: "a", keyCode: 65, code: "KeyA" },
    S: { key: "s", keyCode: 83, code: "KeyS" }, D: { key: "d", keyCode: 68, code: "KeyD" },
    "1": { key: "1", keyCode: 49, code: "Digit1" }, "2": { key: "2", keyCode: 50, code: "Digit2" },
    "3": { key: "3", keyCode: 51, code: "Digit3" }, "4": { key: "4", keyCode: 52, code: "Digit4" },
    "5": { key: "5", keyCode: 53, code: "Digit5" }, "6": { key: "6", keyCode: 54, code: "Digit6" },
    "7": { key: "7", keyCode: 55, code: "Digit7" }, "8": { key: "8", keyCode: 56, code: "Digit8" },
    "9": { key: "9", keyCode: 57, code: "Digit9" }, "0": { key: "0", keyCode: 48, code: "Digit0" }
  };
  var KEY_ORDER = ["Enter", "Escape", "Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "W", "A", "S", "D", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

  // ---------------- 默认配置与持久化 ----------------
  function defaultCfg() {
    return {
      v: 2,
      kernel: "auto",                    // auto|mn|pc(内核偏好;auto=跟随已启动,未启动注入 Online_mn)
      bar: [
        { id: "b1", t: "win", label: "装备", win: "Equipment" },
        { id: "b2", t: "win", label: "物品", win: "Inventory" },
        { id: "b3", t: "win", label: "技能", win: "SkillList" },
        { id: "b4", t: "win", label: "仓库", win: "Storage" },
        { id: "b5", t: "win", label: "聊天", win: "ChatBox" }
      ],
      col: [
        { id: "c1", t: "key", label: "回车", key: "Enter" },
        { id: "c2", t: "key", label: "菜单", key: "Escape" }
      ],
      line: null,                       // 线路:null=未选(首次弹层),3=V6-Online 三转,5=V6-Eden 进阶二转
      opts: { bgkeep: true, fullscreen: true, autoReload: false, remember: false, edge: true },
      acc: "",
      pwd: ""
    };
  }
  function loadCfg() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_KEY));
      if (o && (o.v === 1 || o.v === 2)) {
        if (o.v === 1) { // v1→v2:右侧剔除方向/移动键(摇杆承担移动),补线路与避让开关
          o.col = (o.col || []).filter(function (k) {
            return !(k && k.t === "key" && ["W", "A", "S", "D", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(k.key) >= 0);
          });
          o.v = 2;
        }
        if (o.line == null) o.line = null;
        o.opts = o.opts || {};
        if (typeof o.opts.edge !== "boolean") o.opts.edge = true;
        return o;
      }
    } catch (e) {}
    return defaultCfg();
  }
  function saveCfg() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  var cfg = loadCfg();

  // ---------------- 状态 ----------------
  var state = { ready: false, injected: false, kernel: null, shown: false, hiddenAt: 0, dcAlerting: false, clickTarget: null };

  // ---------------- 工具 ----------------
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  // 触摸隔离:只阻断传播(防穿透游戏),不 preventDefault——否则真机吞掉 click 与原生控件激活(单选/下拉/按钮全点不动)
  function isolate(el_) {
    var stop = function (e) { try { e.stopPropagation(); } catch (err) {} };
    ["touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"].forEach(function (t) {
      el_.addEventListener(t, stop, { passive: false });
    });
    return el_;
  }
  function clientReady() { return typeof window.require === "function"; }
  function clientScript() { return document.querySelector('script[src*="Online"]'); }
  function kernelNow() {
    var s = document.querySelector('script[src*="Online_mn"]');
    if (s) return "mn";
    return "pc";
  }
  function CL() {
    try {
      return {
        SS: window.require("Engine/SessionStorage"),
        NM: window.require("Network/NetworkManager"),
        PS: window.require("Network/PacketStructure")
      };
    } catch (e) { return null; }
  }

  // ---------------- 启动接管(检测式不抢占) ----------------
  function buildConfig() {
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    c.version = version;
    c.ClientVer = pickCv();
    if (cfg.opts.remember && cfg.acc && cfg.pwd) c.autoLogin = [cfg.acc, cfg.pwd];
    return c;
  }
  function injectClient(kernel) {
    if (state.injected || clientScript()) return; // 对方已注入则不重复
    state.injected = true;
    var app = kernel === "pc" ? "Online.js" : "Online_mn.js";
    try { window.ROConfig = buildConfig(); } catch (e) {}
    var s = document.createElement("script");
    s.type = "text/javascript";
    s.src = app + "?" + version;
    (document.head || document.documentElement).appendChild(s);
    waitReady();
  }
  function waitReady() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (clientReady()) {
        clearInterval(iv);
        onClientUp();
      } else if (tries > 60) { // 20s 超时
        clearInterval(iv);
        toast("客户端加载超时,请刷新重试");
      }
    }, 400);
  }
  function onClientUp() {
    if (state.ready) return;
    state.ready = true;
    state.kernel = kernelNow();
    initOverlay();
    initKeepalive();
    toast("客户端已启动 " + (state.kernel === "mn" ? "(手机内核)" : "(电脑内核,已启用自建摇杆)"));
  }
  function bootCheck() {
    hideShell();
    if (clientScript()) { waitReady(); return; }        // 已启动(ro-assist 先注入):不接管
    setTimeout(function () {                              // 给其他脚本(document-idle)注入窗口,超时未启动才自己上
      if (clientScript()) { waitReady(); return; }
      if (!cfg.line && urlCv() == null) { showLinePicker(); return; } // 首次使用:先选线路再注入
      injectClient(cfg.kernel === "pc" ? "pc" : "mn");
    }, 300);
  }
  function boot() {
    if (document.readyState === "interactive" || document.readyState === "complete") bootCheck();
    else document.addEventListener("DOMContentLoaded", bootCheck);
  }

  // ---------------- 壳清理与全局样式 ----------------
  function injectStyle() {
    if (document.getElementById("dsh-mk-style")) return;
    var st = el("style");
    st.id = "dsh-mk-style";
    st.textContent = "html,body{position:fixed;inset:0;overflow:hidden;width:100%;height:100%;margin:0;touch-action:manipulation}" +
      "#dsh-mk-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none;-webkit-user-select:none}" +
      ".dsh-mk-btn{pointer-events:auto;position:absolute;display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(255,255,255,.92);border:1px solid rgba(30,60,120,.35);color:#16305f;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.18);touch-action:none}" +
      ".dsh-mk-btn:active{background:rgba(210,228,255,.95)}" +
      "#dsh-mk-toast{position:absolute;left:50%;bottom:calc(166px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(8px);background:rgba(20,30,50,.86);color:#fff;font-size:13px;padding:7px 14px;border-radius:16px;opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis}" +
      "#dsh-mk-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}" +
      "#dsh-mk-alert{position:absolute;top:0;left:0;right:0;background:rgba(200,40,40,.94);color:#fff;font-size:15px;text-align:center;padding:12px 30px;display:none;pointer-events:auto;z-index:5;border-radius:0 0 10px 10px}" +
      ".dsh-mk-gear{pointer-events:auto;position:absolute;top:calc(10px + env(safe-area-inset-top));right:calc(48px + env(safe-area-inset-right));width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.9);border:1px solid rgba(30,60,120,.35);color:#16305f;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18);touch-action:none}" +
      "#dsh-mk-joy{pointer-events:auto;position:absolute;left:calc(16px + env(safe-area-inset-left));bottom:calc(96px + env(safe-area-inset-bottom));width:96px;height:96px;z-index:4}" +
      "#dsh-mk-joy .dsh-mk-joy-base{position:absolute;inset:0;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.65);box-shadow:0 2px 10px rgba(0,0,0,.25);touch-action:none}" +
      "#dsh-mk-joy .dsh-mk-joy-knob{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(255,255,255,.92);border:1px solid rgba(30,60,120,.4);box-shadow:0 2px 6px rgba(0,0,0,.25);touch-action:none}" +
      "#dsh-mk-edit{position:absolute;inset:0;background:rgba(10,20,40,.45);display:none;pointer-events:auto;z-index:10}" +
      "#dsh-mk-edit .dsh-mk-panel{position:absolute;left:0;right:0;bottom:0;max-height:78vh;overflow-y:auto;background:#f4f7fc;border-radius:14px 14px 0 0;padding:14px 14px 26px;box-shadow:0 -4px 20px rgba(0,0,0,.25);font-size:14px;color:#1c3a66}" +
      ".dsh-mk-panel h3{margin:2px 0 8px;font-size:15px;color:#16305f}" +
      ".dsh-mk-row{display:flex;align-items:center;gap:6px;padding:8px 4px;border-bottom:1px solid #e2e8f2}" +
      ".dsh-mk-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".dsh-mk-mini{flex:0 0 auto;padding:6px 10px;border-radius:8px;border:1px solid #b9c8e2;background:#fff;color:#1c3a66;font-size:13px;cursor:pointer;touch-action:none}" +
      ".dsh-mk-mini.del{color:#b3261e;border-color:#e6b4b0}" +
      ".dsh-mk-add{flex:0 0 auto;padding:6px 12px;border-radius:8px;background:#2b7fd0;color:#fff;border:none;font-size:13px;cursor:pointer;touch-action:none}" +
      ".dsh-mk-sel{padding:6px 8px;border-radius:8px;border:1px solid #b9c8e2;background:#fff;font-size:13px;color:#1c3a66;max-width:150px}" +
      ".dsh-mk-inp{padding:6px 8px;border-radius:8px;border:1px solid #b9c8e2;background:#fff;font-size:13px;color:#1c3a66;width:56px}" +
      "#dsh-mk-line *{touch-action:manipulation}" +
      "#dsh-mk-edit .dsh-mk-sel,#dsh-mk-edit .dsh-mk-inp,#dsh-mk-edit .dsh-mk-sw,#dsh-mk-edit .dsh-mk-sw *{touch-action:manipulation}" +
      ".dsh-mk-sw{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #e2e8f2}" +
      ".dsh-mk-sw input{width:44px;height:24px;flex:0 0 auto}" +
      ".dsh-mk-panel .dsh-mk-foot{display:flex;gap:10px;margin-top:14px}" +
      ".dsh-mk-panel .dsh-mk-ok{flex:1;padding:12px;border-radius:10px;background:#2b7fd0;color:#fff;border:none;font-size:15px;font-weight:600;cursor:pointer;touch-action:none}" +
      ".dsh-mk-panel .dsh-mk-reset{flex:1;padding:12px;border-radius:10px;background:#fff;color:#b3261e;border:1px solid #e6b4b0;font-size:15px;font-weight:600;cursor:pointer;touch-action:none}";
    (document.head || document.documentElement).appendChild(st);
  }
  function hideShell() {
    injectStyle();
    ["#header", "#body_bg", ".cg", ".cbutton", "#shadow-cover", "#body-cover"].forEach(function (sel) {
      var e = document.querySelector(sel);
      if (e) e.style.display = "none";
    });
  }

  // ---------------- 操作层(操作键 + 摇杆 + 齿轮) ----------------
  var rootEl = null, toastEl = null, alertEl = null, gearEl = null, joyEl = null;
  function initOverlay() {
    if (state.shown) return;
    state.shown = true;
    rootEl = el("div");
    rootEl.id = "dsh-mk-root";
    alertEl = el("div");
    alertEl.id = "dsh-mk-alert";
    alertEl.addEventListener("click", function () { alertEl.style.display = "none"; });
    isolate(alertEl);
    rootEl.appendChild(alertEl);
    toastEl = el("div");
    toastEl.id = "dsh-mk-toast";
    rootEl.appendChild(toastEl);
    // 触摸隔离网:操作层内事件不再穿透到游戏 document/#vbk
    ["touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup", "click"].forEach(function (t) {
      rootEl.addEventListener(t, function (e) { try { e.stopPropagation(); } catch (err) {} }, { passive: false });
    });
    renderKeys();
    gearEl = el("div", "dsh-mk-gear", "设");
    gearEl.addEventListener("click", function (e) { e.stopPropagation(); openEdit(); });
    isolate(gearEl);
    applyEdgeUI();
    rootEl.appendChild(gearEl);
    document.body.appendChild(rootEl);
    if (state.kernel === "pc") showJoystick();
  }
  function toast(msg) {
    if (!toastEl) { try { console.log("[ro-mobile] " + msg); } catch (e) {} return; }
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
  }
  function showAlert(msg) {
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.style.display = "block";
  }
  // 边缘避让开关:齿轮/摇杆坐标(默认开=退出手势区)
  function applyJoyEdge() {
    if (!joyEl) return;
    if (cfg.opts.edge) {
      joyEl.style.left = ""; joyEl.style.right = ""; joyEl.style.bottom = "";
    } else {
      joyEl.style.left = "auto"; joyEl.style.right = "18px"; joyEl.style.bottom = "96px";
    }
  }
  function applyEdgeUI() {
    try {
      if (gearEl) {
        gearEl.style.top = ""; gearEl.style.right = "";
        if (!cfg.opts.edge) { gearEl.style.top = "10px"; gearEl.style.right = "10px"; }
      }
    } catch (e) {}
    try { applyJoyEdge(); } catch (e) {}
  }
  function renderKeys() {
    if (!rootEl) return;
    var old = rootEl.querySelector(".dsh-mk-bar");
    if (old) old.parentNode.removeChild(old);
    var old2 = rootEl.querySelector(".dsh-mk-col");
    if (old2) old2.parentNode.removeChild(old2);
    var bar = el("div", "dsh-mk-bar");
    var barBottom = cfg.opts.edge ? "calc(100px + env(safe-area-inset-bottom))" : "calc(8px + env(safe-area-inset-bottom))";
    bar.style.cssText = "position:absolute;left:0;right:0;bottom:" + barBottom + ";display:flex;justify-content:center;gap:8px;padding:0 8px;z-index:3;flex-wrap:wrap";
    cfg.bar.forEach(function (k, i) {
      var b = keyBtn(k);
      b.style.width = "52px";
      b.style.height = "46px";
      b.style.position = "static";
      bar.appendChild(b);
    });
    var col = el("div", "dsh-mk-col");
    var colRight = cfg.opts.edge ? "calc(48px + env(safe-area-inset-right))" : "10px";
    col.style.cssText = "position:absolute;right:" + colRight + ";top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;z-index:2";
    cfg.col.forEach(function (k) {
      var b = keyBtn(k);
      b.style.width = "48px";
      b.style.height = "48px";
      b.style.position = "static";
      col.appendChild(b);
    });
    rootEl.insertBefore(bar, rootEl.firstChild);
    rootEl.insertBefore(col, rootEl.firstChild);
    if (rootEl.parentNode && !rootEl.isConnected) document.body.appendChild(rootEl);
  }
  function keyBtn(k) {
    var b = el("div", "dsh-mk-btn", escapeHtml(k.label));
    isolate(b);
    var timer = null, iv = null;
    function down(e) {
      if (e) { try { e.preventDefault(); e.stopPropagation(); } catch (err) {} }
      var resume = !!(b._breakTs && Date.now() - b._breakTs < 1000);
      b._breakTs = 0;
      if (!resume) trigger(k);
      if (k.t === "key") { // 方向/按键长按立即连发,消除空窗(引擎按 keydown 状态持续走)
        iv = setInterval(function () { synthKey(k.key, "keydown", k.mods); }, 120);
      } else if (k.t === "move") {
        if (resume) iv = setInterval(function () { walkTo(k.x, k.y); }, 600);
        else timer = setTimeout(function () { iv = setInterval(function () { walkTo(k.x, k.y); }, 600); }, 300);
      }
    }
    function up() {
      clearTimeout(timer); timer = null;
      if (iv) { clearInterval(iv); iv = null; }
      if (k.t === "key") synthKey(k.key, "keyup", k.mods);
    }
    function broken() { // 断触/滑出:立即停,记录断点;1 秒内重按即恢复连发
      clearTimeout(timer); timer = null;
      if (iv) { clearInterval(iv); iv = null; b._breakTs = Date.now(); }
      if (k.t === "key") synthKey(k.key, "keyup", k.mods);
    }
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", broken);
    b.addEventListener("pointerleave", broken);
    return b;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function trigger(k) {
    if (k.t === "win") toggleWin(k.win);
    else if (k.t === "key") synthKey(k.key, "keydown", k.mods);
    else if (k.t === "move") walkTo(k.x, k.y);
  }

  // ---------------- 三类触发 ----------------
  function uiComponents() {
    try {
      var UI = window.require("UI/UIManager");
      return { UI: UI, map: (UI && UI.components) || null };
    } catch (e) { return { UI: null, map: null }; }
  }
  function findComponent(name) {
    var r = uiComponents();
    var map = r.map;
    if (!map) return null;
    if (map[name]) return map[name];
    var low = name.toLowerCase();
    var hits = Object.keys(map).filter(function (k) {
      var kl = k.toLowerCase();
      return kl === low || kl.indexOf(low) >= 0 || low.indexOf(kl) >= 0;
    });
    return hits.length === 1 ? map[hits[0]] : null;
  }
  function toggleWin(name) {
    if (!clientReady()) { toast("客户端未就绪"); return; }
    var label = WIN_MAP[name] || name;
    var c = null;
    try { c = findComponent(name); } catch (e) { c = null; }
    if (!c) { toast("组件未就绪: " + label + " (进入游戏后可用)"); return; }
    try {
      var open = !!c.__active;
      if (open) {
        try { c.remove(); } catch (e) {}
        toast(label + " 已关闭");
      } else {
        try { c.append(); } catch (e) { toast("打开失败: " + label + ": " + (e && e.message ? e.message : e)); return; }
        // 300ms 后确认窗口真的挂上,没有则重试一次
        setTimeout(function () {
          try { if (c.__active && c.ui && !c.ui.isConnected && c.append) c.append(); } catch (e2) {}
        }, 300);
        toast(label + " 已打开");
      }
    } catch (e) { toast("组件未就绪: " + label + ": " + (e && e.message ? e.message : e)); }
  }
  function synthKey(code, kind, mods) {
    var m = KEY_MAP[code];
    if (!m) return;
    var mod = mods || {};
    try {
      var ev = new KeyboardEvent(kind, {
        key: m.key, code: m.code,
        bubbles: true, cancelable: true,
        ctrlKey: !!mod.ctrl, altKey: !!mod.alt, shiftKey: !!mod.shift
      });
      try { Object.defineProperty(ev, "keyCode", { value: m.keyCode }); Object.defineProperty(ev, "which", { value: m.keyCode }); } catch (e) {}
      window.dispatchEvent(ev);
    } catch (e) {}
  }
  function walkTo(x, y) {
    if (!clientReady()) return;
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ || !cl.PS.CZ.REQUEST_MOVE || !cl.NM) return;
      var pm = new cl.PS.CZ.REQUEST_MOVE();
      pm.dest = [x, y];
      cl.NM.sendPacket(pm);
    } catch (e) {}
  }

  // ---------------- 自建摇杆(仅电脑内核 Online;协议直驱 REQUEST_JOYSTICK_DIR) ----------------
  var JOY_DIRS = [
    { dx: 0, dy: -1 }, { dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 },
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: -1 }
  ];
  function joySend(move, dir) {
    if (!clientReady()) return;
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ || !cl.PS.CZ.REQUEST_JOYSTICK_DIR || !cl.NM) return;
      var p = new cl.PS.CZ.REQUEST_JOYSTICK_DIR();
      p.move = move; p.direction = dir;
      cl.NM.sendPacket(p);
    } catch (e) {}
  }
  function showJoystick() {
    if (document.getElementById("dsh-mk-joy")) return;
    var joy = el("div");
    joy.id = "dsh-mk-joy";
    var base = el("div", "dsh-mk-joy-base");
    var knob = el("div", "dsh-mk-joy-knob");
    base.appendChild(knob);
    joy.appendChild(base);
    isolate(base); isolate(knob);
    (rootEl || document.body).appendChild(joy);
    joyEl = joy;
    applyJoyEdge();
    var o = { px: 0, py: 0, ax: 0, ay: 0, active: false, dir: -1, lastDir: -1, lastSent: 0, breakTs: 0 };
    function dir8() {
      var dx = o.ax - o.px, dy = o.ay - o.py;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 5) return -1;   // 死区
      var best = -1, bestDot = -1;
      for (var i = 0; i < 8; i++) {
        var d = JOY_DIRS[i];
        var dl = Math.sqrt(d.dx * d.dx + d.dy * d.dy); // 对角向量归一化,避免与轴向平局
        var dot = (dx * d.dx + dy * d.dy) / (len * dl);
        if (dot > bestDot) { bestDot = dot; best = i; }
      }
      return best;
    }
    function knobPos(e) {
      var dx = e.clientX - o.px, dy = e.clientY - o.py;
      var len = Math.sqrt(dx * dx + dy * dy);
      var r = Math.min(len, 30);
      if (len < 0.001) return;
      knob.style.transform = "translate(" + (dx / len * r) + "px," + (dy / len * r) + "px)";
    }
    function start(e) {
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (err) {} }
      o.px = o.ax = e.clientX; o.py = o.ay = e.clientY;
      o.active = true; o.dir = -1;
      knob.style.transition = "none";
      knob.style.transform = "translate(0,0)";
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      // 断触兜底:1 秒内重新按下即带入上次方向续走
      if (o.breakTs && Date.now() - o.breakTs < 1000 && o.lastDir >= 0) {
        o.dir = o.lastDir; o.lastSent = 0;
        joySend(1, o.dir);
      }
      o.breakTs = 0;
    }
    function move(e) {
      if (!o.active) return;
      o.ax = e.clientX; o.ay = e.clientY;
      knobPos(e);
    }
    function end() {
      if (!o.active) return;
      o.active = false;
      o.breakTs = Date.now();
      if (o.dir >= 0) { joySend(0, -1); o.lastDir = o.dir; o.dir = -1; }
      knob.style.transition = "transform .15s";
      knob.style.transform = "translate(0,0)";
    }
    var steerTimer = setInterval(function () {
      if (!o.active || !clientReady()) return;
      var d = dir8();
      var now = Date.now();
      if (d >= 0) {
        if (d !== o.dir) { o.dir = d; o.lastSent = 0; }
        else if (now - o.lastSent < 700) return;   // 同方向 700ms 心跳刷新即可
        o.lastSent = now;
        joySend(1, o.dir);
      } else {
        if (o.dir >= 0) { joySend(0, -1); o.lastDir = o.dir; o.dir = -1; }
      }
    }, 140);
    base.addEventListener("pointerdown", start);
    base.addEventListener("pointermove", move);
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    joy._timer = steerTimer;
  }

  // ---------------- 掉线防护(核心) ----------------
  function sendPing() {
    if (!clientReady()) return;
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ || !cl.PS.CZ.PING || !cl.NM) return;
      var p = new cl.PS.CZ.PING();
      if (cl.SS && cl.SS.AID) p.AID = cl.SS.AID;
      cl.NM.sendPacket(p);
    } catch (e) {}
  }
  var bgAc = null, bgOsc = null, bgGain = null, bgLockHeld = false, bgLockCtrl = null, wakeSentinel = null;
  function bgAudioStart() {
    try {
      if (bgAc && bgOsc) { if (bgAc.state === "suspended") { try { bgAc.resume(); } catch (e) {} } return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ac = new Ctx();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = "sine"; osc.frequency.value = 60; gain.gain.value = 0.003;
      osc.connect(gain); gain.connect(ac.destination); osc.start();
      if (ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
      bgAc = ac; bgOsc = osc; bgGain = gain;
    } catch (e) {}
  }
  function bgAudioStop() {
    try { if (bgOsc) { bgOsc.stop(); bgOsc = null; } } catch (e) {}
    try { if (bgAc) { bgAc.close(); bgAc = null; } } catch (e) {}
    bgGain = null;
  }
  function bgLockAcquire() {
    try {
      if (bgLockHeld || !navigator.locks || typeof navigator.locks.request !== "function") return;
      var opts = { mode: "shared" };
      if (window.AbortController) { bgLockCtrl = new AbortController(); opts.signal = bgLockCtrl.signal; }
      navigator.locks.request("dsh-romobile-bgkeep", opts, function () { return new Promise(function () {}); })
        .then(function () { bgLockHeld = true; }).catch(function () {});
    } catch (e) {}
  }
  function bgLockRelease() {
    try { if (bgLockCtrl) { bgLockCtrl.abort(); bgLockCtrl = null; } } catch (e) {}
    bgLockHeld = false;
  }
  function wakeLockRequest() {
    try {
      if (wakeSentinel || !navigator.wakeLock || typeof navigator.wakeLock.request !== "function") return;
      navigator.wakeLock.request("screen").then(function (s) { wakeSentinel = s; }).catch(function () {});
    } catch (e) {}
  }
  function wakeLockRelease() {
    try { if (wakeSentinel) { wakeSentinel.release(); wakeSentinel = null; } } catch (e) {}
  }
  function bgKeepStart() { bgAudioStart(); bgLockAcquire(); wakeLockRequest(); }
  function bgKeepStop() { bgAudioStop(); bgLockRelease(); wakeLockRelease(); }
  function bgOnce() {
    document.removeEventListener("click", bgOnce, true);
    document.removeEventListener("keydown", bgOnce, true);
    document.removeEventListener("touchstart", bgOnce, true);
    if (!cfg.opts.bgkeep) return;
    bgKeepStart();
  }
  var dcHooked = false;
  function hookDisconnect() {
    try {
      if (dcHooked || !clientReady()) return;
      var UI = window.require("UI/UIManager");
      if (!UI || typeof UI.showErrorBox !== "function") return;
      var orig = UI.showErrorBox;
      dcHooked = true;
      UI.showErrorBox = function (msg) {
        try { if (/断开/.test(String(msg || ""))) onDisconnect(); } catch (e) {}
        return orig.apply(this, arguments);
      };
    } catch (e) {}
  }
  function onDisconnect() {
    if (state.dcAlerting) return;
    state.dcAlerting = true;
    showAlert("连接已断开,正在尝试处理…");
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    var flashes = 0;
    var iv = setInterval(function () {
      document.title = (flashes++ % 2) ? "掉线了 - RO" : "仙境的传说";
      if (flashes > 14) { clearInterval(iv); document.title = "仙境的传说"; }
    }, 600);
    if (cfg.opts.autoReload && cfg.opts.remember && cfg.acc) {
      showAlert("10 秒后自动重连…");
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 10000);
    }
    setTimeout(function () { state.dcAlerting = false; }, 30000);
  }
  function initKeepalive() {
    // 1) 切后台 burst + 回前台补 PING + 超 90s 处理
    document.addEventListener("visibilitychange", function () {
      try {
        if (document.hidden) {
          state.hiddenAt = Date.now();
          for (var i = 0; i < 6; i++) sendPing();
          wakeLockRelease();
        } else {
          sendPing();
          if (cfg.opts.bgkeep) { bgAudioStart(); bgLockAcquire(); wakeLockRequest(); }
          var gap = state.hiddenAt ? (Date.now() - state.hiddenAt) : 0;
          if (gap > 90000) {
            if (cfg.opts.autoReload && cfg.opts.remember && cfg.acc) {
              showAlert("切后台超过 90 秒,自动重载重登…");
              var u = location.href;
              u = u.replace(/([?&])(run|auto)=/g, "$1auto=");
              if (!/\bauto=/.test(u)) u += (u.indexOf("?") >= 0 ? "&" : "?") + "auto=1";
              setTimeout(function () { try { location.replace(u); } catch (e) {} }, 600);
            } else {
              toast("切后台超过 90 秒,可能已掉线");
            }
          }
        }
      } catch (e) {}
    });
    // 2) 后台保活(首次手势后启动音频/锁/防熄屏)
    if (cfg.opts.bgkeep) {
      document.addEventListener("click", bgOnce, true);
      document.addEventListener("keydown", bgOnce, true);
      document.addEventListener("touchstart", bgOnce, true);
    }
    // 3) 掉线 hook(UI showErrorBox) + ws 轮询兜底
    hookDisconnect();
    setInterval(function () {
      if (!clientReady()) return;
      hookDisconnect();
      try {
        var nm = CL() && CL().NM;
        if (nm && (nm.ws || nm.websocket || nm.socket)) {
          var w = nm.ws || nm.websocket || nm.socket;
          if (w.readyState === 3 || w.readyState === 2) onDisconnect();
        }
      } catch (e) {}
    }, 5000);
    window.addEventListener("beforeunload", function () { try { bgKeepStop(); } catch (e) {} });
  }

  // ---------------- 全屏(首次触摸) ----------------
  function initFullscreen() {
    if (!cfg.opts.fullscreen) return;
    var once = function () {
      document.removeEventListener("touchend", once, true);
      document.removeEventListener("click", once, true);
      try {
        var d = document.documentElement;
        if (d.requestFullscreen && !document.fullscreenElement) {
          var pr = d.requestFullscreen();
          if (pr && pr.catch) pr.catch(function () {});
        }
      } catch (e) {}
    };
    document.addEventListener("touchend", once, true);
    document.addEventListener("click", once, true);
  }

  // ---------------- 编辑面板 ----------------
  function openEdit() {
    if (!rootEl) return;
    var old = document.getElementById("dsh-mk-edit");
    if (old) { old.parentNode.removeChild(old); }
    var mask = el("div");
    mask.id = "dsh-mk-edit";
    var panel = el("div", "dsh-mk-panel");
    var h = el("h3", null, "操作键与设置");
    panel.appendChild(h);
    // 键组编辑
    [["底部键区", cfg.bar], ["右侧键列", cfg.col]].forEach(function (pair) {
      var t = el("h3", null, pair[0]);
      panel.appendChild(t);
      pair[1].forEach(function (k, i) {
        var row = el("div", "dsh-mk-row");
        var lb = el("div", "dsh-mk-label", escapeHtml(descKey(k)));
        row.appendChild(lb);
        var up = el("button", "dsh-mk-mini", "上");
        if (i === 0) up.disabled = true;
        up.addEventListener("click", function () {
          if (i <= 0) return;
          var arr = pair[1];
          var tmp = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = tmp;
          saveCfg(); renderKeys(); openEdit();
        });
        var dn = el("button", "dsh-mk-mini", "下");
        if (i === pair[1].length - 1) dn.disabled = true;
        dn.addEventListener("click", function () {
          var arr = pair[1];
          if (i >= arr.length - 1) return;
          var tmp = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = tmp;
          saveCfg(); renderKeys(); openEdit();
        });
        var del = el("button", "dsh-mk-mini del", "删");
        del.addEventListener("click", function () {
          pair[1].splice(i, 1);
          saveCfg(); renderKeys(); openEdit();
        });
        row.appendChild(up); row.appendChild(dn); row.appendChild(del);
        panel.appendChild(row);
      });
    });
    // 添加键
    var addH = el("h3", null, "添加操作键");
    panel.appendChild(addH);
    var addRow = el("div", "dsh-mk-row");
    var posSel = el("select", "dsh-mk-sel");
    posSel.innerHTML = '<option value="bar">底部</option><option value="col">右侧</option>';
    var typeSel = el("select", "dsh-mk-sel");
    typeSel.innerHTML = '<option value="win">开窗</option><option value="key">键盘</option><option value="move">点地</option>';
    var paramSel = el("select", "dsh-mk-sel");
    function fillParams() {
      var t = typeSel.value;
      paramSel.innerHTML = "";
      if (t === "win") {
        WIN_ORDER.forEach(function (w) {
          var op = document.createElement("option");
          op.value = w; op.textContent = WIN_MAP[w] || w;
          paramSel.appendChild(op);
        });
      } else if (t === "key") {
        KEY_ORDER.forEach(function (kk) {
          var op = document.createElement("option");
          op.value = kk; op.textContent = kk;
          paramSel.appendChild(op);
        });
      } else {
        paramSel.style.display = "none";
      }
    }
    typeSel.addEventListener("change", function () {
      paramSel.style.display = "inline-block";
      fillParams();
    });
    fillParams();
    var xInp = el("input", "dsh-mk-inp");
    xInp.type = "number"; xInp.placeholder = "x";
    xInp.style.display = "none";
    var yInp = el("input", "dsh-mk-inp");
    yInp.type = "number"; yInp.placeholder = "y";
    yInp.style.display = "none";
    var addBtn = el("button", "dsh-mk-add", "添加");
    addBtn.addEventListener("click", function () {
      var t = typeSel.value;
      var k;
      if (t === "win") k = { id: Math.random().toString(36).slice(2, 9), t: "win", label: WIN_MAP[paramSel.value] || paramSel.value, win: paramSel.value };
      else if (t === "key") k = { id: Math.random().toString(36).slice(2, 9), t: "key", label: paramSel.value, key: paramSel.value };
      else {
        var xx = parseFloat(xInp.value), yy = parseFloat(yInp.value);
        if (!isFinite(xx) || !isFinite(yy)) { toast("请填写点地坐标"); return; }
        k = { id: Math.random().toString(36).slice(2, 9), t: "move", label: "点地", x: Math.round(xx), y: Math.round(yy) };
      }
      if (posSel.value === "bar") cfg.bar.push(k); else cfg.col.push(k);
      saveCfg(); renderKeys(); openEdit();
    });
    addRow.appendChild(posSel); addRow.appendChild(typeSel); addRow.appendChild(paramSel); addRow.appendChild(xInp); addRow.appendChild(yInp); addRow.appendChild(addBtn);
    panel.appendChild(addRow);
    typeSel.addEventListener("change", function () {
      var isMove = typeSel.value === "move";
      xInp.style.display = isMove ? "inline-block" : "none";
      yInp.style.display = isMove ? "inline-block" : "none";
      paramSel.style.display = isMove ? "none" : "inline-block";
    });
    if (typeSel.value === "move") { xInp.style.display = "inline-block"; yInp.style.display = "inline-block"; paramSel.style.display = "none"; }
    // 设置区
    var st = el("h3", null, "设置");
    panel.appendChild(st);
    function swRow(label, getv, setv) {
      var row = el("div", "dsh-mk-sw");
      var lb = el("div", "dsh-mk-label", label);
      var inp = el("input");
      inp.type = "checkbox";
      inp.checked = getv();
      inp.addEventListener("change", function () { setv(inp.checked); saveCfg(); });
      row.appendChild(lb); row.appendChild(inp);
      return row;
    }
    panel.appendChild(swRow("后台保活(音频+锁+防熄屏)", function () { return cfg.opts.bgkeep; }, function (v) { cfg.opts.bgkeep = v; }));
    panel.appendChild(swRow("首次操作自动全屏", function () { return cfg.opts.fullscreen; }, function (v) { cfg.opts.fullscreen = v; }));
    panel.appendChild(swRow("掉线自动重连(需记住账号)", function () { return cfg.opts.autoReload; }, function (v) { cfg.opts.autoReload = v; }));
    panel.appendChild(swRow("边缘避让(避开系统手势区)", function () { return cfg.opts.edge; }, function (v) { cfg.opts.edge = v; saveCfg(); renderKeys(); try { applyEdgeUI(); } catch (e) {} }));
    var remRow = el("div", "dsh-mk-sw");
    var remLb = el("div", "dsh-mk-label", "记住账号(自动重登)");
    var remInp = el("input");
    remInp.type = "checkbox";
    remInp.checked = !!cfg.opts.remember;
    remInp.addEventListener("change", function () { cfg.opts.remember = remInp.checked; saveCfg(); });
    remRow.appendChild(remLb); remRow.appendChild(remInp);
    panel.appendChild(remRow);
    if (cfg.opts.remember) {
      var ar = el("div", "dsh-mk-row");
      var ai = el("input", "dsh-mk-inp");
      ai.placeholder = "账号"; ai.style.width = "90px"; ai.value = cfg.acc || "";
      var pi = el("input", "dsh-mk-inp");
      pi.type = "password"; pi.placeholder = "密码"; pi.style.width = "90px"; pi.value = cfg.pwd || "";
      ai.addEventListener("change", function () { cfg.acc = ai.value.trim(); saveCfg(); });
      pi.addEventListener("change", function () { cfg.pwd = pi.value; saveCfg(); });
      ar.appendChild(ai); ar.appendChild(pi);
      panel.appendChild(ar);
    }
    var ker = el("div", "dsh-mk-sw");
    var kerLb = el("div", "dsh-mk-label", "内核偏好");
    var kerSel = el("select", "dsh-mk-sel");
    kerSel.innerHTML = '<option value="auto">自动(手机内核优先)</option><option value="mn">手机内核</option><option value="pc">电脑内核</option>';
    kerSel.value = cfg.kernel;
    kerSel.addEventListener("change", function () { cfg.kernel = kerSel.value; saveCfg(); });
    ker.appendChild(kerLb); ker.appendChild(kerSel);
    panel.appendChild(ker);
    var line = el("div", "dsh-mk-sw");
    var lineLb = el("div", "dsh-mk-label", "登录线路");
    var lineSel = el("select", "dsh-mk-sel");
    lineSel.innerHTML = '<option value="3">V6-Online 三转</option><option value="5">V6-Eden 进阶二转</option>';
    lineSel.value = String(pickCv());
    lineSel.addEventListener("change", function () {
      cfg.line = parseInt(lineSel.value, 10);
      saveCfg();
      toast("切换线路,重载中…");
      var u = location.href.replace(/([?&])cv=\d+/, "$1cv=" + lineSel.value);
      if (!/[?&]cv=/.test(u)) u += (u.indexOf("?") >= 0 ? "&" : "?") + "cv=" + lineSel.value;
      setTimeout(function () { try { location.replace(u); } catch (e) {} }, 400);
    });
    isolate(lineSel);
    line.appendChild(lineLb); line.appendChild(lineSel);
    panel.appendChild(line);
    // 底部按钮
    var foot = el("div", "dsh-mk-foot");
    var ok = el("button", "dsh-mk-ok", "完成");
    ok.addEventListener("click", function () { saveCfg(); mask.style.display = "none"; });
    var reset = el("button", "dsh-mk-reset", "恢复默认");
    reset.addEventListener("click", function () {
      cfg = defaultCfg();
      saveCfg(); renderKeys(); openEdit();
    });
    foot.appendChild(ok); foot.appendChild(reset);
    panel.appendChild(foot);
    mask.appendChild(panel);
    (rootEl || document.body).appendChild(mask);
    isolate(mask);
    mask.style.display = "block";
  }
  function descKey(k) {
    if (k.t === "win") return (WIN_MAP[k.win] || k.win) + "(开窗)";
    if (k.t === "key") return "按键 " + k.key;
    return "点地 " + k.x + "," + k.y;
  }

  // ---------------- 线路选择(首次使用;选定前不注入) ----------------
  function showLinePicker() {
    if (document.getElementById("dsh-mk-line")) return;
    var mask = el("div");
    mask.id = "dsh-mk-line";
    mask.style.cssText = "position:fixed;inset:0;z-index:2147483001;background:rgba(10,20,40,.6);display:flex;align-items:center;justify-content:center;pointer-events:auto";
    var box = el("div");
    box.style.cssText = "width:84%;max-width:340px;background:#f4f7fc;border-radius:14px;padding:20px 18px;box-shadow:0 -4px 20px rgba(0,0,0,.3);font-size:14px;color:#1c3a66";
    var h = el("h3", null, "选择登录线路");
    h.style.cssText = "margin:0 0 4px;font-size:16px;color:#16305f";
    var sub = el("div", null, "二转服请选 V6-Eden 进阶二转(之后可在设置里修改)");
    sub.style.cssText = "color:#666;font-size:12px;margin:0 0 12px";
    box.appendChild(h); box.appendChild(sub);
    function opt(cv, title, desc) {
      var row = el("label"); // label 整行可点选(原生激活不依赖 JS)
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:12px;border:2px solid #b9c8e2;border-radius:10px;margin-bottom:10px;background:#fff;touch-action:manipulation";
      var radio = el("input");
      radio.type = "radio"; radio.name = "dsh-mk-line"; radio.value = String(cv);
      if (cv === 5) radio.checked = true; // 预选二转(用户目标线路)
      var tx = el("div", null, "<b>" + title + "</b><br><span style='color:#777;font-size:12px'>" + desc + "</span>");
      row.appendChild(radio); row.appendChild(tx);
      isolate(row);
      return row;
    }
    box.appendChild(opt(3, "V6-Online 三转", "ClientVer 3"));
    box.appendChild(opt(5, "V6-Eden 进阶二转", "ClientVer 5"));
    var foot = el("div");
    foot.style.cssText = "display:flex;gap:10px;margin-top:14px";
    var go = el("button", "dsh-mk-ok", "进入游戏");
    go.addEventListener("click", function () {
      var checked = null;
      (box.querySelectorAll("input") || []).forEach(function (inp) { if (inp.checked) checked = inp; });
      cfg.line = checked ? parseInt(checked.value, 10) : 5;
      saveCfg();
      mask.style.display = "none";
      injectClient(cfg.kernel === "pc" ? "pc" : "mn");
    });
    var skip = el("button", "dsh-mk-reset", "默认三转(不记忆)");
    skip.addEventListener("click", function () {
      cfg.line = 3; // 本次生效但不保存:下次打开仍询问
      mask.style.display = "none";
      injectClient(cfg.kernel === "pc" ? "pc" : "mn");
    });
    isolate(go); isolate(skip);
    foot.appendChild(go); foot.appendChild(skip);
    box.appendChild(foot);
    mask.appendChild(box);
    (document.body || document.documentElement).appendChild(mask);
  }

  // ---------------- 启动 ----------------
  injectStyle();
  initFullscreen();
  boot();
})();
