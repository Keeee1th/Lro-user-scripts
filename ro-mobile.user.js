// ==UserScript==
// @name         RO 手机自适应 ro-mobile
// @namespace    https://github.com/Keeee1th/Lro-user-scripts
// @version      1.0.14
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
  var VER = "1.0.14";
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
  // 合成键盘映射(keyCode 对齐客户端 Controls/KeyEventHandler;全键位,字母用大写码值;V1.0.11 起 Ctrl/Alt/Shift 作为可选键进列表(组合键可直接选为修饰键,单键亦可)
  var KEY_MAP = (function () {
    var m = {};
    function put(code, key, keyCode, domCode) { m[code] = { key: key, keyCode: keyCode, code: domCode || key }; }
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (var li = 0; li < 26; li++) put(letters[li], letters[li].toLowerCase(), 65 + li, "Key" + letters[li]);
    put("Ctrl", "Control", 17, "ControlLeft"); put("Alt", "Alt", 18, "AltLeft"); put("Shift", "Shift", 16, "ShiftLeft");
    for (var di = 0; di < 10; di++) put(String(di), String(di), 48 + di, "Digit" + di);
    for (var fi = 1; fi <= 12; fi++) put("F" + fi, "F" + fi, 111 + fi, "F" + fi);
    put("Escape", "Escape", 27, "Escape"); put("Tab", "Tab", 9, "Tab"); put("Space", " ", 32, "Space");
    put("Enter", "Enter", 13, "Enter"); put("Backspace", "Backspace", 8, "Backspace"); put("Delete", "Delete", 46, "Delete");
    put("Insert", "Insert", 45, "Insert"); put("Home", "Home", 36, "Home"); put("End", "End", 35, "End");
    put("PageUp", "PageUp", 33, "PageUp"); put("PageDown", "PageDown", 34, "PageDown"); put("CapsLock", "CapsLock", 20, "CapsLock");
    put("ArrowUp", "ArrowUp", 38, "ArrowUp"); put("ArrowDown", "ArrowDown", 40, "ArrowDown");
    put("ArrowLeft", "ArrowLeft", 37, "ArrowLeft"); put("ArrowRight", "ArrowRight", 39, "ArrowRight");
    put("\\", "\\", 220, "Backslash");
    put("`", "`", 192, "Backquote"); put("-", "-", 189, "Minus"); put("=", "=", 187, "Equal");
    put("[", "[", 219, "BracketLeft"); put("]", "]", 221, "BracketRight");
    put(";", ";", 186, "Semicolon"); put("'", "'", 222, "Quote");
    put(",", ",", 188, "Comma"); put(".", ".", 190, "Period"); put("/", "/", 191, "Slash");
    return m;
  })();
  var KEY_ORDER = ["Ctrl","Alt","Shift","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
    "0","1","2","3","4","5","6","7","8","9",
    "F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12",
    "`","-","=","[","]","\\",";","'",",",".","/",
    "Enter","Escape","Tab","Space","Backspace","Delete","Insert","Home","End","PageUp","PageDown","CapsLock",
    "ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];

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
      opts: { bgkeep: true, fullscreen: true, autoReload: false, remember: false, edge: true,
        uiScale: 100, keyScale: 100, joyScale: 100, joyShow: true, joyProto: false, joyPos: null,
        joyDead: 15, joyAng: 20, snap: true },  // V1.0.12 摇杆死区(半径%内不触发)/方向切换回差(°内保持);V1.0.14 拖拽吸附网格
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
        if (typeof o.opts.uiScale !== "number" || o.opts.uiScale < 60 || o.opts.uiScale > 180) o.opts.uiScale = 100;
        if (typeof o.opts.keyScale !== "number" || o.opts.keyScale < 60 || o.opts.keyScale > 200) o.opts.keyScale = 100;
        if (typeof o.opts.joyScale !== "number" || o.opts.joyScale < 50 || o.opts.joyScale > 200) o.opts.joyScale = 100;
        if (typeof o.opts.joyShow !== "boolean") o.opts.joyShow = true;
        if (typeof o.opts.joyProto !== "boolean") o.opts.joyProto = false;
        // V1.0.12 摇杆死区(5%~50%半径,默认15%)/方向切换回差(0~45°,默认20°):防中心抖动误触发与扇区边界跳变「回头」
        if (typeof o.opts.joyDead !== "number" || o.opts.joyDead < 5 || o.opts.joyDead > 50) o.opts.joyDead = 15;
        if (typeof o.opts.joyAng !== "number" || o.opts.joyAng < 0 || o.opts.joyAng > 45) o.opts.joyAng = 20;
        if (typeof o.opts.snap !== "boolean") o.opts.snap = true; // V1.0.14 拖拽结束吸附 5% 网格
        if (!o.opts.joyPos || typeof o.opts.joyPos.x !== "number" || typeof o.opts.joyPos.y !== "number") o.opts.joyPos = null;
        // V1.0.9 配置自愈:bar/col 非数组→重建默认;逐项净化(null/非对象剔除、缺label补默认、非法pos清除),净化结果立即写回(坏配置刷一次即修复)
        var _def = defaultCfg();
        var _needSave = false;
        function _normKey(k) {
          if (!k || typeof k !== "object") return null;
          if (k.pos && (typeof k.pos.x !== "number" || typeof k.pos.y !== "number")) k.pos = null;
          // V1.0.11:旧配置 mods{ctrl,alt,shift} 并入 keys(修饰键现为可选键),删 mods
          if (k.mods && (k.mods.ctrl || k.mods.alt || k.mods.shift)) {
            var _mo = [];
            if (k.mods.ctrl) _mo.push("Ctrl");
            if (k.mods.alt) _mo.push("Alt");
            if (k.mods.shift) _mo.push("Shift");
            var _pv = k.keys || [];
            var _mg = _mo.slice();
            _pv.forEach(function (kk) { if (_mg.indexOf(kk) < 0) _mg.push(kk); });
            k.keys = _mg;
            delete k.mods;
          }
          if (!k.label) {
            if (k.t === "combo") k.label = (k.keys || []).join("+") || "组合";
            else if (k.t === "move") k.label = "点地";
            else k.label = k.key || k.win || "键";
          }
          return k;
        }
        if (!Array.isArray(o.bar) || !o.bar.length) { o.bar = _def.bar; _needSave = true; }
        else { var _nb = o.bar.map(_normKey).filter(Boolean); if (_nb.length !== o.bar.length) _needSave = true; o.bar = _nb; }
        if (!Array.isArray(o.col) || !o.col.length) { o.col = _def.col; _needSave = true; }
        else { var _nc = o.col.map(_normKey).filter(Boolean); if (_nc.length !== o.col.length) _needSave = true; o.col = _nc; }
        if (_needSave) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {} }
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
  var state = { ready: false, injected: false, kernel: null, shown: false, hiddenAt: 0, dcAlerting: false, clickTarget: null, posMode: false };

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
  function showFatal(msg) { // 启动失败全屏提示(不依赖操作层,失败可见不再静默)
    try {
      var b = document.getElementById("dsh-mk-fatal");
      if (!b) {
        b = el("div");
        b.id = "dsh-mk-fatal";
        b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(200,40,40,.95);color:#fff;font-size:14px;text-align:center;padding:10px 16px;font-family:system-ui,-apple-system,sans-serif";
        (document.documentElement || document.body).appendChild(b);
      }
      b.textContent = msg;
    } catch (e) {}
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
        try { toast("客户端加载超时,请刷新重试"); } catch (e) {}
        showFatal("客户端加载超时(20 秒),请刷新重试");
      }
    }, 400);
  }
  function onClientUp() {
    if (state.ready) return;
    state.ready = true;
    state.kernel = kernelNow();
    try { initOverlay(); } catch (e) { try { console.error("[ro-mobile] initOverlay", e); } catch (e2) {} }
    try { initKeepalive(); } catch (e) {}
    try { applyUiScale(); } catch (e) {}
    try { toast("客户端已启动 " + (state.kernel === "mn" ? "(手机内核)" : "(电脑内核)") + (cfg.opts.joyShow ? " · 模拟摇杆可用" : "")); } catch (e) {}
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
      "#dsh-mk-root{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none;-webkit-user-select:none}" +
      ".dsh-mk-btn{pointer-events:auto;position:absolute;display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(255,255,255,.92);border:1px solid rgba(30,60,120,.35);color:#16305f;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.18);touch-action:none}" +
      ".dsh-mk-btn:active{background:rgba(210,228,255,.95)}" +
      "#dsh-mk-toast{position:absolute;left:50%;bottom:calc(166px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(8px);background:rgba(20,30,50,.86);color:#fff;font-size:13px;padding:7px 14px;border-radius:16px;opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis}" +
      "#dsh-mk-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}" +
      "#dsh-mk-alert{position:absolute;top:0;left:0;right:0;background:rgba(200,40,40,.94);color:#fff;font-size:15px;text-align:center;padding:12px 30px;display:none;pointer-events:auto;z-index:5;border-radius:0 0 10px 10px}" +
      ".dsh-mk-gear{pointer-events:auto;position:absolute;top:calc(10px + env(safe-area-inset-top));right:calc(48px + env(safe-area-inset-right));width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.9);border:1px solid rgba(30,60,120,.35);color:#16305f;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.18);touch-action:none}" +
      "#dsh-mk-joy{pointer-events:auto;position:absolute;left:calc(28px + env(safe-area-inset-left));bottom:calc(96px + env(safe-area-inset-bottom));width:96px;height:96px;z-index:4;touch-action:none}" +
      "#dsh-mk-joy .dsh-mk-joy-base{position:absolute;inset:0;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.65);box-shadow:0 2px 10px rgba(0,0,0,.25);touch-action:none}" +
      "#dsh-mk-joy .dsh-mk-joy-knob{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(255,255,255,.92);border:1px solid rgba(30,60,120,.4);box-shadow:0 2px 6px rgba(0,0,0,.25);touch-action:none;pointer-events:none}" +
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
      ".dsh-mk-range{display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid #e2e8f2}" +
      ".dsh-mk-range input[type=range]{flex:1;min-width:0;height:28px}" +
      ".dsh-mk-range-v{flex:0 0 auto;min-width:54px;text-align:right;font-size:12px;color:#1c3a66}" +
      ".dsh-mk-panel .dsh-mk-foot{display:flex;gap:10px;margin-top:14px}" +
      ".dsh-mk-panel .dsh-mk-ok{flex:1;padding:12px;border-radius:10px;background:#2b7fd0;color:#fff;border:none;font-size:15px;font-weight:600;cursor:pointer;touch-action:none}" +
      ".dsh-mk-panel .dsh-mk-reset{flex:1;padding:12px;border-radius:10px;background:#fff;color:#b3261e;border:1px solid #e6b4b0;font-size:15px;font-weight:600;cursor:pointer;touch-action:none}" +
      ".dsh-mk-posmode .dsh-mk-btn,.dsh-mk-posmode .dsh-mk-joy{opacity:.55;box-shadow:0 0 0 2px rgba(43,127,208,.6)}" +
      "#dsh-mk-posdone{pointer-events:auto;position:absolute;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:#2b7fd0;color:#fff;font-size:15px;font-weight:600;padding:10px 22px;border-radius:20px;z-index:12;touch-action:none;box-shadow:0 2px 10px rgba(0,0,0,.3)}";
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
  var rootEl = null, toastEl = null, alertEl = null, gearEl = null, joyEl = null, posDoneEl = null, posDrag = null;
  function initOverlay() {
    if (state.shown) return;
    state.shown = true;
    try {
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
      posDoneEl = el("div", "dsh-mk-posdone", "完成拖拽");
      posDoneEl.id = "dsh-mk-posdone";
      posDoneEl.style.display = "none";
      posDoneEl.addEventListener("click", function (e) { try { e.stopPropagation(); } catch (err) {} posModeExit(); });
      isolate(posDoneEl);
      rootEl.appendChild(posDoneEl);
      try { document.documentElement.appendChild(rootEl); } catch (e) { document.body.appendChild(rootEl); } // 挂 documentElement 末位:与助手面板同层时后挂载者在上(共存)
    } catch (e) {
      // 防御:渲染/初始化失败不再静默吞掉界面——仍挂出操作层,错误可见可反馈
      try { console.error("[ro-mobile] 界面初始化异常", e); } catch (e2) {}
      try { if (rootEl && !rootEl.parentNode) { if (document.documentElement) document.documentElement.appendChild(rootEl); else document.body.appendChild(rootEl); } } catch (e2) {}
      try { if (toastEl) toast("界面初始化异常:" + ((e && e.message) || e)); } catch (e2) {}
    }
    try { if (cfg.opts.joyShow) showJoystick(); } catch (e) {}
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
    if (cfg.opts.joyPos && typeof cfg.opts.joyPos.x === "number") {
      joyEl.style.left = cfg.opts.joyPos.x + "%"; joyEl.style.top = cfg.opts.joyPos.y + "%";
      joyEl.style.right = "auto"; joyEl.style.bottom = "auto";
      return;
    }
    // 防误触开关只调按键/侧列边距,不再移动摇杆(避免左右跳边);摇杆位置用「调整按键位置(拖拽)」自定义
    joyEl.style.left = ""; joyEl.style.right = ""; joyEl.style.bottom = ""; joyEl.style.top = "";
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
  // ---------------- 按键位置调整模式(透明拖拽;位置按视口%记忆) ----------------
  function posModeEnter() {
    state.posMode = true;
    if (rootEl) rootEl.classList.add("dsh-mk-posmode");
    if (posDoneEl) posDoneEl.style.display = "block";
    var em = document.getElementById("dsh-mk-edit");
    if (em) em.style.display = "none"; // 先关设置,露出游戏画面
    toast("拖拽按键/摇杆到新位置");
  }
  function posModeExit() {
    state.posMode = false;
    if (rootEl) rootEl.classList.remove("dsh-mk-posmode");
    if (posDoneEl) posDoneEl.style.display = "none";
    posDrag = null;
    saveCfg();
    renderKeys();
    try { applyJoyEdge(); } catch (e) {} // 摇杆按 joyPos 百分比归位
    toast("位置已保存");
  }
  function dragStart(e, el, target) { // target: {kind:'key',k} | {kind:'joy'}
    if (!state.posMode) return;
    try { e.stopPropagation(); e.preventDefault(); } catch (err) {}
    var rect = null;
    try { rect = el.getBoundingClientRect(); } catch (err) {}
    var l0 = rect ? rect.left : (parseFloat(el.style.left) || 0);
    var t0 = rect ? rect.top : (parseFloat(el.style.top) || 0);
    // 先按当前实际位置固定,再脱离容器,避免"点击即弹到屏幕左上角"
    el.style.position = "absolute";
    el.style.left = l0 + "px";
    el.style.top = t0 + "px";
    var pp = el.parentNode;
    if (pp && pp !== rootEl && pp.classList && (pp.classList.contains("dsh-mk-bar") || pp.classList.contains("dsh-mk-col"))) {
      rootEl.appendChild(el); // 拖出容器,改绝对定位
    }
    posDrag = { el: el, target: target, dx: e.clientX - l0, dy: e.clientY - t0 };
    try { if (e.target && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (err) {} // 捕获到事件源(按键自身/摇杆base),移出仍可拖
  }
  function dragMove(e) {
    if (!posDrag) return;
    try { e.stopPropagation(); e.preventDefault(); } catch (err) {}
    posDrag.el.style.left = Math.max(0, e.clientX - posDrag.dx) + "px";
    posDrag.el.style.top = Math.max(0, e.clientY - posDrag.dy) + "px";
  }
  function dragEnd() {
    if (!posDrag) return;
    var el = posDrag.el, t = posDrag.target;
    var x = parseFloat(el.style.left) || 0, y = parseFloat(el.style.top) || 0;
    var W = window.innerWidth || 375, H = window.innerHeight || 667;
    var px = Math.round(x / W * 100), py = Math.round(y / H * 100);
    if (px < 0) px = 0; if (py < 0) py = 0; if (px > 95) px = 95; if (py > 92) py = 92;
    if (cfg.opts.snap) { // V1.0.14 拖拽吸附 5% 网格,松手即整齐
      px = Math.round(px / 5) * 5; py = Math.round(py / 5) * 5;
      if (px < 0) px = 0; if (py < 0) py = 0; if (px > 95) px = 95; if (py > 92) py = 92;
    }
    posDrag = null;
    if (!t) return;
    if (t.kind === "key" && t.k) { t.k.pos = { x: px, y: py }; saveCfg(); }
    else if (t.kind === "joy") { cfg.opts.joyPos = { x: px, y: py }; saveCfg(); }
  }
  // 画面缩放(游戏主视口 transform:scale;V1.0.14 容器探测优先内核主视口 #map + 面积校验,修复误缩右上小地图)
  var uiWrap = null;
  function applyUiScale() {
    try {
      if (!document.body) return;
      if (!uiWrap) {
        var cands = ["#map", "#view", "#wrap", "#container", "#game", ".game-container", ".view-wrap", "#viewWrap"];
        var got = null;
        for (var i = 0; i < cands.length; i++) {
          try { got = document.querySelector(cands[i]); } catch (e) { got = null; }
          if (got && pickMainView(got)) { uiWrap = got; break; }
        }
        if (!uiWrap) {
          // 兜底:找面积足够大(≥视口40%)的 canvas 宿主,排除小地图等小元素
          var cvs = document.querySelectorAll("canvas");
          for (var ci = 0; ci < cvs.length; ci++) {
            var pe = cvs[ci].parentElement;
            if (pe && pickMainView(pe)) { uiWrap = pe; break; }
          }
        }
      }
      if (!uiWrap) { toast("未找到画面主视口(真机确认页面结构)"); return; }
      var s = (cfg.opts.uiScale || 100) / 100;
      uiWrap.style.transformOrigin = "50% 0";
      uiWrap.style.transform = s === 1 ? "" : "scale(" + s + ")";
    } catch (e) {}
  }
  // V1.0.14 主视口判定:含足够大的 canvas 且尺寸接近屏幕(排除小地图/窗口类小元素)
  function pickMainView(e) {
    try {
      if (!e || !e.getBoundingClientRect) return false;
      var r = e.getBoundingClientRect();
      var rw = window.innerWidth || 375, rh = window.innerHeight || 667;
      if (!rw || !rh) return false;
      if (r.width < rw * 0.4 || r.height < rh * 0.4) return false;
      var has = false, ls = e.querySelectorAll ? e.querySelectorAll("canvas") : [];
      for (var i = 0; i < ls.length; i++) { var lr = ls[i].getBoundingClientRect(); if (lr.width >= rw * 0.4 && lr.height >= rh * 0.4) { has = true; break; } }
      return has;
    } catch (e2) { return false; }
  }
  // V1.0.14 自动排列:全部键(bar+col,含自定义位置键)按 4 列网格顺序重排,写回配置并重绘
  function autoArrange() {
    var all = cfg.bar.concat(cfg.col);
    if (!all.length) return;
    var cols = 4, stepX = 20, stepY = 12, x0 = 10, y0 = 8;
    all.forEach(function (k, i) {
      if (!k || typeof k !== "object") return;
      var col = i % cols, row = Math.floor(i / cols);
      k.pos = { x: x0 + col * stepX, y: y0 + row * stepY };
    });
    saveCfg();
    try { renderKeys(); } catch (e) {}
    toast("已自动排列 " + all.length + " 个按键");
  }
  function renderKeys() {
    if (!rootEl) return;
    var old = rootEl.querySelector(".dsh-mk-bar");
    if (old) old.parentNode.removeChild(old);
    var old2 = rootEl.querySelector(".dsh-mk-col");
    if (old2) old2.parentNode.removeChild(old2);
    // 清理拖拽/重建残留的 root 直子级旧按键(修复:拖拽后原位置残留副本;children 是 HTMLCollection 无 slice,须经 Array.prototype)
    var rk = Array.prototype.slice.call(rootEl.children || []);
    for (var ri = 0; ri < rk.length; ri++) {
      var rc = rk[ri];
      if (rc.classList && rc.classList.contains("dsh-mk-btn")) { try { rc.parentNode.removeChild(rc); } catch (e) {} }
    }
    var ks = (cfg.opts.keyScale || 100) / 100;
    var bar = el("div", "dsh-mk-bar");
    var barBottom = cfg.opts.edge ? "calc(100px + env(safe-area-inset-bottom))" : "calc(8px + env(safe-area-inset-bottom))";
    bar.style.cssText = "position:absolute;left:0;right:0;bottom:" + barBottom + ";display:flex;justify-content:center;gap:" + Math.round(8 * ks) + "px;padding:0 8px;z-index:3;flex-wrap:wrap";
    cfg.bar.forEach(function (k, i) {
      try {
        var b = keyBtn(k);
        if (!b) return; // 非法键条目跳过,不中断整批渲染
        b.style.width = Math.round(52 * ks) + "px";
        b.style.height = Math.round(46 * ks) + "px";
        b.style.fontSize = Math.round(13 * ks) + "px";
        if (k.pos && typeof k.pos.x === "number") { // 自定义位置(拖拽保存,%坐标)
          b.style.position = "absolute";
          b.style.left = k.pos.x + "%"; b.style.top = k.pos.y + "%";
          rootEl.appendChild(b);
        } else {
          b.style.position = "static";
          bar.appendChild(b);
        }
      } catch (e) { try { console.error("[ro-mobile] bar键渲染失败 " + i, e); } catch (e2) {} }
    });
    var col = el("div", "dsh-mk-col");
    var colRight = cfg.opts.edge ? "calc(48px + env(safe-area-inset-right))" : "10px";
    col.style.cssText = "position:absolute;right:" + colRight + ";top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;z-index:2";
    cfg.col.forEach(function (k, i) {
      try {
        var b = keyBtn(k);
        if (!b) return;
        b.style.width = Math.round(48 * ks) + "px";
        b.style.height = Math.round(48 * ks) + "px";
        b.style.fontSize = Math.round(13 * ks) + "px";
        if (k.pos && typeof k.pos.x === "number") { // 自定义位置(拖拽保存,%坐标)
          b.style.position = "absolute";
          b.style.left = k.pos.x + "%"; b.style.top = k.pos.y + "%";
          rootEl.appendChild(b);
        } else {
          b.style.position = "static";
          col.appendChild(b);
        }
      } catch (e) { try { console.error("[ro-mobile] col键渲染失败 " + i, e); } catch (e2) {} }
    });
    synchFightBtn(); // V1.0.12:战斗键为配置项(可单独添加/删除/拖位),不再硬编码→不与其他键重叠
    rootEl.insertBefore(bar, rootEl.firstChild);
    rootEl.insertBefore(col, rootEl.firstChild);
    if (rootEl.parentNode && !rootEl.isConnected) { try { document.documentElement.appendChild(rootEl); } catch (e) { document.body.appendChild(rootEl); } }
  }
  function keyBtn(k) {
    if (!k || typeof k !== "object") return null; // 守卫:非法条目不渲染
    var b = el("div", "dsh-mk-btn", escapeHtml(k.label));
    isolate(b);
    if (k.t === "fight") b.classList.add("dsh-mk-fight"); // V1.0.12 战斗键:高亮同步/可配置
    var timer = null, iv = null;
    function down(e) {
      if (state.posMode) return; // 位置调整模式:不触发功能
      if (e) { try { e.preventDefault(); e.stopPropagation(); } catch (err) {} }
      if (k.t === "fight") { // V1.0.12 内挂战斗键:点一下翻转自动战斗,不连发
        npFightOn = !npFightOn;
        npAutoFight(npFightOn);
        synchFightBtn();
        return;
      }
      if (k.t === "rot") { // V1.0.12 旋转屏幕键:点一下横/竖屏切换,不连发
        toggleRotate();
        return;
      }
      var resume = !!(b._breakTs && Date.now() - b._breakTs < 1000);
      b._breakTs = 0;
      if (!resume) trigger(k);
      if (k.t === "key" || k.t === "combo") { // 按键/组合长按立即连发,消除空窗(引擎按 keydown 状态持续走)
        iv = setInterval(function () { fireKeys(k.t === "combo" ? k.keys : [k.key], "keydown"); }, 120);
      } else if (k.t === "move") {
        if (resume) iv = setInterval(function () { walkTo(k.x, k.y); }, 1200); // 移动发包铁律:低频率重发,防服务器卡顿
        else timer = setTimeout(function () { iv = setInterval(function () { walkTo(k.x, k.y); }, 1200); }, 300);
      }
    }
    function up() {
      clearTimeout(timer); timer = null;
      if (iv) { clearInterval(iv); iv = null; }
      if (k.t === "key" || k.t === "combo") scheduleKeyUp(k.t === "combo" ? k.keys : [k.key]);
    }
    function broken() { // 断触/滑出:立即停,记录断点;1 秒内重按即恢复连发
      clearTimeout(timer); timer = null;
      if (iv) { clearInterval(iv); iv = null; b._breakTs = Date.now(); }
      if (k.t === "key" || k.t === "combo") scheduleKeyUp(k.t === "combo" ? k.keys : [k.key]);
    }
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", broken);
    b.addEventListener("pointerleave", broken);
    b.addEventListener("pointerdown", function (e) { if (state.posMode) dragStart(e, b, { kind: "key", k: k }); });
    b.addEventListener("pointermove", function (e) { if (state.posMode) dragMove(e); });
    b.addEventListener("pointerup", function () { if (state.posMode) dragEnd(); });
    b.addEventListener("pointercancel", function () { if (state.posMode) posDrag = null; });
    return b;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function trigger(k) {
    if (k.t === "win") toggleWin(k.win);
    else if (k.t === "key") synthKey(k.key, "keydown", {});
    else if (k.t === "combo") fireKeys(k.keys, "keydown"); // 组合键:整批同发(修饰与主键同批,keyup 延迟抬起)
    else if (k.t === "move") { toast("点地 " + k.x + "," + k.y); walkTo(k.x, k.y); } // 诊断可见:真机点地不灵时先看 toast
  }
  // V1.0.11 组合键触发:修饰键(Ctrl/Alt/Shift)作为可选键进列表;整批同发——所有键事件携带完整 flags;
  // V1.0.14 修复 Alt 等组合无效:引擎 KeyEventHandler 在 window keydown 时记录修饰键状态(ALT=!!altKey),匹配窗口快捷键时
  // 要求 e.which===init 且 KeyEventHandler.ALT==cfg.alt —— 若主键先于修饰键发出,修饰键状态尚未置位即失配。
  // 因此 keydown 强制"修饰键先发、主键后发";keyup 反序"主键先抬、修饰键后抬",贴合真实键盘时序。
  // keyup 经 scheduleKeyUp 统一延迟 80ms 抬起(先 clearTimeout 再新起)。
  function fireKeys(keys, kind) {
    var flags = { ctrl: false, alt: false, shift: false };
    var mods = [], mains = [];
    (keys || []).forEach(function (kk) {
      if (kk === "Ctrl" || kk === "Alt" || kk === "Shift") { mods.push(kk); if (kk === "Ctrl") flags.ctrl = true; else if (kk === "Alt") flags.alt = true; else flags.shift = true; }
      else mains.push(kk);
    });
    var seq = kind === "keyup" ? mains.concat(mods) : mods.concat(mains); // V1.0.14:按下修饰先,抬起修饰后
    seq.forEach(function (kk) { synthKey(kk, kind, flags); });
  }
  var _upTimer = null;
  function scheduleKeyUp(keys) {
    if (_upTimer) { try { clearTimeout(_upTimer); } catch (e) {} }
    _upTimer = setTimeout(function () { _upTimer = null; fireKeys(keys, "keyup"); }, 80);
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
  // V1.0.14 引擎内置窗口快捷键表(Preferences/ShortCutControls 默认值;Storage 无默认快捷键,须与卡普拉对话打开)
  var WIN_HOTKEY = {
    Equipment: { k: "Q", alt: true }, Inventory: { k: "E", alt: true }, SkillList: { k: "S", alt: true },
    BasicInfo: { k: "V", alt: true }, Basicinfo: { k: "V", alt: true }, WorldMap: { k: "M", alt: true },
    MiniMap: { k: "N", alt: true }, Quest: { k: "U", alt: true }, ChatRoomCreate: { k: "C", alt: true },
    Guild: { k: "G", alt: true }, PetInformations: { k: "J", alt: true }, EMO: { k: "L", alt: true },
    OnPushCart: { k: "W", alt: true }, Friends: { k: "H", alt: true }
  };
  function winHotkeyFallback(name) {
    var h = WIN_HOTKEY[name];
    if (!h) return false;
    try { fireKeys([h.alt ? "Alt" : "Ctrl", h.k], "keydown"); } catch (e) { return false; }
    toast("已触发引擎快捷键(开/关" + (WIN_MAP[name] || name) + ")");
    return true;
  }
  function toggleWin(name) {
    if (!clientReady()) { toast("客户端未就绪"); return; }
    var label = WIN_MAP[name] || name;
    var c = null;
    try { c = findComponent(name); } catch (e) { c = null; }
    // V1.0.14 双通道:组件直开(append/remove)失败或未注册 → 降级引擎快捷键(与官方开窗同机制)
    if (c) {
      try {
        var open = !!c.__active;
        if (open) {
          try { c.remove(); } catch (e) {}
          toast(label + " 已关闭");
        } else {
          try { c.append(); } catch (e) { if (!winHotkeyFallback(name)) toast("打开失败: " + label); return; }
          // 300ms 后确认窗口真的挂上,没有则重试一次
          setTimeout(function () {
            try { if (c.__active && c.ui && !c.ui.isConnected && c.append) c.append(); } catch (e2) {}
          }, 300);
          if (name === "Storage") toast("仓库已打开(数据需先与卡普拉对话,若为空请先对话)"); // V1.0.14 仓库数据提示
          else toast(label + " 已打开");
        }
        return;
      } catch (e) { if (!winHotkeyFallback(name)) toast("打开失败: " + label); return; }
    }
    if (!winHotkeyFallback(name)) toast("组件未就绪: " + label + " (进入游戏后可用)");
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

  // ---------------- 内挂自动战斗快捷开关(V1.0.11,与 ro-assist「开自动战斗(移动寻怪)」同机制) ----------------
  // 三转(WHISPER 可用):NPC:setautoattack(toggle,msg="0");二转(NOTIFY_UPDATEINFO 可用):id=38(移动寻怪,设置型)+id=34(自动战斗,toggle)
  var npFightOn = false;
  function npFightPort() {
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ) return null;
      var C = cl.PS.CZ;
      // V1.0.13:按用户选定线路判断转数(二转进阶内核同样带 WHISPER 聊天协议,按协议探测会误判三转→二转服指令失效)
      if (cfg.line === 5) return "two";   // V6-Eden 进阶二转
      if (cfg.line === 3) return "three"; // V6-Online 三转
      // 线路未显式选择时回退协议探测:二转专有 UPDATEINFO(38移动寻怪)优先,其次才是通用 WHISPER
      if (C.NOTIFY_UPDATEINFO) return "two";
      if (C.WHISPER) return "three";
      return null;
    } catch (e) { return null; }
  }
  function npSend(cls, fill) {
    if (!clientReady()) return false;
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ || !cl.NM) return false;
      var p = new cl.PS.CZ[cls]();
      if (fill) fill(p);
      cl.NM.sendPacket(p);
      return true;
    } catch (e) { return false; }
  }
  function npAutoFight(on) {
    var port = npFightPort();
    if (!port) { toast("未找到内挂指令协议(进入游戏后可用)"); return; }
    if (port === "three") {
      npSend("WHISPER", function (p) { p.receiver = "NPC:setautoattack"; p.msg = "0"; }); // toggle 型
      try { var MM = window.require("UI/Components/MiniMap/MiniMap"); if (MM && MM.removeDestination) MM.removeDestination(); } catch (e) {}
      toast((on ? "开" : "关") + "自动战斗(三转 setautoattack)");
    } else {
      if (on) npSend("NOTIFY_UPDATEINFO", function (p) { p.id = 38; p.value = 0; }); // 移动寻怪(设置型)
      npSend("NOTIFY_UPDATEINFO", function (p) { p.id = 34; p.value = 1; });          // 自动战斗(toggle)
      toast((on ? "开" : "关") + "自动战斗(二转 38移动寻怪/34)");
    }
    if (on && !npFightOn) toast("内挂寻怪中,建议停用摇杆/点地以免打断");
  }
  function synchFightBtn() {
    try {
      var fs = document.querySelectorAll(".dsh-mk-fight");
      for (var i = 0; i < fs.length; i++) fs[i].style.background = npFightOn ? "#b23b3b" : "#2f6bb0";
    } catch (e) {}
  }

  // V1.0.12:旋转屏幕(可配置键「旋转屏幕」,点击即横/竖屏切换,不写死;真机按键可删/可拖)
  // 可行性:浏览器 Screen Orientation API(screen.orientation.lock)通常需全屏态生效(Android Chrome/WebView 支持;
  // iOS Safari 不支持 lock,降级提示)。点击时先请求全屏再 lock,失败仅 toast,不影响游戏操作。
  var rotState = null; // 本地目标记忆:null=跟随 API type 判定,null 且无 API 时翻转
  function toggleRotate() {
    try {
      var so = null;
      try { so = window.screen && (window.screen.orientation || window.screen.mozOrientation || null); } catch (e) {}
      var want = null;
      if (so && so.type) {
        want = /landscape/.test(String(so.type)) ? "portrait" : "landscape"; // 按当前实际朝向取反
      } else {
        rotState = rotState === true ? false : true; // API 无 type:本地翻转(防重复触发同一朝向)
        want = rotState ? "landscape" : "portrait";
      }
      try {
        var d = document.documentElement || document.body;
        if (d.requestFullscreen && !document.fullscreenElement) {
          var pr = d.requestFullscreen();
          if (pr && pr.catch) pr.catch(function () {});
        }
      } catch (e) {}
      if (so && so.lock) {
        var lp = so.lock(want + "-primary");
        if (lp && lp.catch) lp.catch(function () { toast("旋转失败(需允许全屏后重试)"); });
        else toast(want === "landscape" ? "已切横屏" : "已切竖屏");
      } else {
        toast("浏览器不支持屏幕旋转锁定(试用手势/系统旋转锁)");
      }
    } catch (e) { toast("旋转不可用"); }
  }

  // ---------------- 模拟摇杆(两内核均显示;默认「直发移动」:朝方向发 REQUEST_MOVE 目标点,服务端寻路,比协议直驱稳) ----------------
  var JOY_DIRS = [
    { dx: 0, dy: -1 }, { dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 },
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: -1 }
  ];
  function joySend(move, dir) { // 协议直驱(旧模式,可选)
    if (!clientReady()) return;
    try {
      var cl = CL();
      if (!cl || !cl.PS || !cl.PS.CZ || !cl.PS.CZ.REQUEST_JOYSTICK_DIR || !cl.NM) return;
      var p = new cl.PS.CZ.REQUEST_JOYSTICK_DIR();
      p.move = move; p.direction = dir;
      cl.NM.sendPacket(p);
    } catch (e) {}
  }
  // 目标点可走吸附:内核 ALT 可走性检查,3×3 就近吸附,全不可走沿方向退格兜底;接口缺失时原样返回(降级)
  var ALT_CACHE;
  function altApi() {
    if (ALT_CACHE === undefined) {
      try { ALT_CACHE = window.require("Renderer/Map/Altitude"); } catch (e) { ALT_CACHE = null; }
      if (!ALT_CACHE || !ALT_CACHE.getCellType || !ALT_CACHE.TYPE) ALT_CACHE = null;
    }
    return ALT_CACHE;
  }
  function snapWalkable(x, y, dx, dy, px0, py0) {
    var alt = altApi();
    if (!alt) return [x, y];
    var isW = function (cx, cy) {
      try { return (alt.getCellType(cx, cy) & alt.TYPE.WALKABLE) !== 0; } catch (e) { return true; }
    };
    // 坐标自检:玩家当前位置在 ALT 网格判为不可走 ⇒ ALT 坐标系与玩家坐标不匹配,禁用吸附(修复上下镜像错位)
    if (typeof px0 === "number" && typeof py0 === "number" && !isW(px0, py0)) return [x, y];
    if (isW(x, y)) return [x, y];
    for (var gy = -1; gy <= 1; gy++) {
      for (var gx = -1; gx <= 1; gx++) {
        if (!gx && !gy) continue;
        if (isW(x + gx, y + gy)) return [x + gx, y + gy];
      }
    }
    if (dx || dy) {
      for (var k = 1; k <= 7; k++) { var nx = x - dx * k, ny = y - dy * k; if (isW(nx, ny)) return [nx, ny]; }
    }
    return [x, y];
  }
  // 当前玩家坐标(直发移动需要);position 兼容数组与 {x,y} 对象
  function normPos(m) {
    if (!m || !m.position) return null;
    var ps = m.position;
    if (typeof ps[0] === "number") return [ps[0], ps[1]];
    if (typeof ps.x === "number" && typeof ps.y === "number") return [ps.x, ps.y];
    return null;
  }
  function playerPos() {
    try {
      var SS = window.require("Engine/SessionStorage");
      var e = SS && SS.Entity;
      var pos0 = e && e.position;
      if (pos0) { var n0 = normPos({ position: pos0 }); if (n0) return n0; }
      var EM = window.require("Renderer/EntityManager");
      if (EM) {
        try { if (EM.getEntity && SS && SS.GID) { var m = EM.getEntity(SS.GID); var n1 = normPos(m); if (n1) return n1; } } catch (e2) {}
        try { if (EM.forEach && SS && SS.GID) { var found = null; EM.forEach(function (x) { if (x && x.GID === SS.GID) found = x; }); var n2 = normPos(found); if (n2) return n2; } } catch (e2) {}
      }
      return null;
    } catch (e) { return null; }
  }
  function showJoystick() {
    if (document.getElementById("dsh-mk-joy")) { if (joyEl && joyEl._updateSize) joyEl._updateSize(); return; }
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
    var o = { px: 0, py: 0, ax: 0, ay: 0, active: false, dir: -1, lastDir: -1, lastSent: 0, lastTgt: null, breakTs: 0, r: 40, mode: null, stillCnt: 0, lastPos: null };
    function dir8() {
      var dx = o.ax - o.px, dy = o.ay - o.py;
      var len = Math.sqrt(dx * dx + dy * dy);
      // V1.0.12 死区配置化:死区=摇杆半径×joyDead%(默认15%),中心小幅推动/指尖抖动不触发方向(防误出发「回头」)
      var dead = (cfg.opts.joyDead || 15) / 100 * o.r;
      if (len < dead) return -1;
      var best = -1, bestDot = -1;
      for (var i = 0; i < 8; i++) {
        var d = JOY_DIRS[i];
        var dl = Math.sqrt(d.dx * d.dx + d.dy * d.dy); // 对角向量归一化,避免与轴向平局
        var dot = (dx * d.dx + dy * d.dy) / (len * dl);
        if (dot > bestDot) { bestDot = dot; best = i; }
      }
      // V1.0.12 方向切换回差:偏离当前方向中心 < 扇区半宽22.5°+joyAng° 时保持当前方向,
      // 扇区边界抖动/轻微回推不再来回切方向 → 防「回头」(原地转身折返)
      if (o.dir >= 0 && best !== o.dir) {
        var aDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        var cDeg = Math.atan2(JOY_DIRS[o.dir].dy, JOY_DIRS[o.dir].dx) * 180 / Math.PI;
        var off = Math.abs(aDeg - cDeg); if (off > 180) off = 360 - off;
        if (off < 22.5 + (cfg.opts.joyAng || 0)) return o.dir;
      }
      return best;
    }
    function knobPos(e) {
      var dx = e.clientX - o.px, dy = e.clientY - o.py;
      var len = Math.sqrt(dx * dx + dy * dy);
      var r = Math.min(len, o.r);
      if (len < 0.001) return;
      knob.style.transform = "translate(" + (dx / len * r) + "px," + (dy / len * r) + "px)";
    }
    function steerTarget() {
      if (o.dir < 0 || !clientReady()) return null;
      var p = playerPos();
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) {
        if (!steerTarget._warned) { steerTarget._warned = true; toast("未取到玩家坐标(进入游戏后可用)"); }
        return null;
      }
      var d = JOY_DIRS[o.dir];
      // V1.0.10:直发目标 y 轴翻转为内核行进方向(屏幕上拉=行进 y+;协议方向码不变),吸附同步用翻转后方向
      return snapWalkable(p[0] + d.dx * 8, p[1] - d.dy * 8, d.dx, -d.dy, p[0], p[1]); // 朝方向目标点(8格)+可走吸附(自检失配自动禁用)
    }
    function joyDistTo(tgt) {
      var p = playerPos();
      if (!p) return 999;
      return Math.sqrt((p[0] - tgt[0]) * (p[0] - tgt[0]) + (p[1] - tgt[1]) * (p[1] - tgt[1]));
    }
    function start(e) {
      if (state.posMode) return; // 位置调整模式:不触发行走
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (err) {} }
      o.mode = (e && (e.pointerType || typeof e.pointerId === "number")) ? "p" : "t"; // 输入通道:pointer / touch
      o.px = o.ax = e.clientX; o.py = o.ay = e.clientY;
      o.active = true; o.dir = -1;
      knob.style.transition = "none";
      knob.style.transform = "translate(0,0)";
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      // 断触兜底:1 秒内重新按下即带入上次方向续走
      if (o.breakTs && Date.now() - o.breakTs < 1000 && o.lastDir >= 0) {
        o.dir = o.lastDir;
        if (cfg.opts.joyProto) { o.lastSent = 0; joySend(1, o.dir); }
        else { o.lastSent = 0; o.lastTgt = null; var t2 = steerTarget(); if (t2) walkTo(t2[0], t2[1]); }
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
      o.stillCnt = 0; o.lastPos = null; o.mode = null; // 重置静止检测与输入通道
      if (o.dir >= 0) {
        if (cfg.opts.joyProto) joySend(0, -1);
        else {
          // V1.0.11 松开即停:停止包目标取整到最近格(round,防 float 被服务器向前取整拉回身后格→回撤),并清客户端残留导航;心跳由 steerTimer 停发
          try {
            var pp = playerPos();
            if (pp && isFinite(pp[0]) && isFinite(pp[1])) {
              walkTo(Math.round(pp[0]), Math.round(pp[1]));
              var MM = null; try { MM = window.require("UI/Components/MiniMap/MiniMap"); } catch (e) {}
              if (MM && MM.removeDestination) { try { MM.removeDestination(); } catch (e) {} }
            }
          } catch (e) {}
        }
        o.lastDir = o.dir; o.dir = -1;
        o.lastTgt = null;
      }
      knob.style.transition = "transform .15s";
      knob.style.transform = "translate(0,0)";
    }
    var steerTimer = setInterval(function () {
      if (!o.active || !clientReady()) return;
      var d = dir8();
      var now = Date.now();
      var pNow = playerPos(); // 静止检测共用
      if (d >= 0) {
        var dirChanged = (d !== o.dir);
        o.dir = d; o.lastDir = d;
        if (cfg.opts.joyProto) {
          if (!dirChanged && now - o.lastSent < 1200) return; // 协议模式:方向变立即发,同向 1200ms 心跳
          o.lastSent = now;
          joySend(1, o.dir);
        } else {
          // 直发:方向变立即发;同向按 1500ms 心跳,仅「接近目标(<8格)」或「检测到角色停住(坐标连续未变)」才补发
          // 铁律兼容:不近目标且未停住不补发→包率上限约0.67包/秒,不再墙边封死
          if (pNow) {
            var moved = !!(o.lastPos && (Math.abs(pNow[0] - o.lastPos[0]) >= 1 || Math.abs(pNow[1] - o.lastPos[1]) >= 1));
            o.stillCnt = moved ? 0 : (o.stillCnt + 1);
            o.lastPos = pNow;
          }
          var stopped = o.stillCnt >= 2; // 连续 2 tick(约280ms)坐标未变视为卡住
          if (!dirChanged && now - o.lastSent < 1500) return;
          var near = !o.lastTgt || joyDistTo(o.lastTgt) < 8;
          if (!dirChanged && !near && !stopped) return;
          var tgt = steerTarget();
          if (tgt) { o.lastTgt = tgt; o.lastSent = now; o.stillCnt = 0; walkTo(tgt[0], tgt[1]); }
        }
      } else if (o.dir >= 0) {
        if (cfg.opts.joyProto) joySend(0, -1);
        o.lastDir = o.dir; o.dir = -1;
      }
    }, 140);
    function ptGate(fn) { return function (e) { if (o.mode === "t") return; fn(e); }; } // pointer 通道:触摸接管时让位
    function tch(e, fn, dfn) { // touch 兜底通道(webview 吞 pointer 时仍可摇/可拖)
      if (o.mode === "p" && !state.posMode) return;
      var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      var evt = { clientX: t.clientX, clientY: t.clientY, target: base,
        preventDefault: function () { try { e.preventDefault(); } catch (err) {} },
        stopPropagation: function () { try { e.stopPropagation(); } catch (err) {} } };
      if (state.posMode && dfn) dfn(evt); else fn(evt);
    }
    base.addEventListener("pointerdown", ptGate(start));
    base.addEventListener("pointermove", ptGate(move));
    base.addEventListener("pointerup", ptGate(end));
    base.addEventListener("pointercancel", ptGate(end));
    base.addEventListener("touchstart", function (e) { tch(e, start, function (evt) { dragStart(evt, joy, { kind: "joy" }); }); }, { passive: false });
    base.addEventListener("touchmove", function (e) { tch(e, move, dragMove); }, { passive: false });
    base.addEventListener("touchend", function (e) { tch(e, end, function () { dragEnd(); }); }, { passive: false });
    base.addEventListener("touchcancel", function (e) { tch(e, end, function () { posDrag = null; }); }, { passive: false });
    joy._timer = steerTimer;
    // 摇杆位置拖拽:监听必须挂事件源 base(同元素收听才不受 isolate stopPropagation 影响;曾挂 joy 永远收不到)
    base.addEventListener("pointerdown", function (e) { if (state.posMode) dragStart(e, joy, { kind: "joy" }); });
    base.addEventListener("pointermove", function (e) { if (state.posMode) dragMove(e); });
    base.addEventListener("pointerup", function () { if (state.posMode) dragEnd(); });
    base.addEventListener("pointercancel", function () { if (state.posMode) posDrag = null; });
    joy._updateSize = function () {
      var s = (cfg.opts.joyScale || 100) / 100;
      if (s < 0.5) s = 0.5; if (s > 2) s = 2;
      var d0 = Math.round(120 * s), k0 = Math.round(52 * s);
      o.r = Math.max(12, Math.round(40 * s));
      joy.style.width = d0 + "px"; joy.style.height = d0 + "px";
      knob.style.width = k0 + "px"; knob.style.height = k0 + "px";
      knob.style.marginLeft = (-k0 / 2) + "px"; knob.style.marginTop = (-k0 / 2) + "px";
    };
    joy._updateSize();
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
        var re = el("button", "dsh-mk-mini", "名"); // 自定义名称(组合/按键/开窗/点地通用)
        re.addEventListener("click", function () {
          var inp = el("input", "dsh-mk-inp");
          inp.style.width = "72px";
          inp.value = k.label || "";
          lb.textContent = "";
          lb.appendChild(inp);
          re.style.display = "none";
          var ok = el("button", "dsh-mk-mini", "存");
          ok.addEventListener("click", function () {
            var v = inp.value.trim();
            if (v) k.label = v;
            saveCfg(); renderKeys(); openEdit();
          });
          row.insertBefore(ok, re);
        });
        row.appendChild(up); row.appendChild(dn); row.appendChild(del); row.appendChild(re);
        panel.appendChild(row);
      });
    });
    // 添加键
    var addH = el("h3", null, "添加操作键");
    panel.appendChild(addH);
    var addRow = el("div", "dsh-mk-row");
    addRow.style.flexWrap = "wrap";
    var posSel = el("select", "dsh-mk-sel");
    posSel.innerHTML = '<option value="bar">底部</option><option value="col">右侧</option>';
    var typeSel = el("select", "dsh-mk-sel");
    typeSel.innerHTML = '<option value="win">开窗</option><option value="key">键盘</option><option value="combo">组合</option><option value="move">点地</option><option value="fight">内挂战斗</option><option value="rot">旋转屏幕</option>'; // V1.0.12 旋转屏幕(可配置键)
    var paramSel = el("select", "dsh-mk-sel");
    var comboBox = el("div"); // 组合键:自选多键(动态,初始2键,最多6键)
    comboBox.style.cssText = "display:none;flex-direction:column;gap:4px;flex:1 1 100%;min-width:100%";
    var comboNameRow = null, comboNameInp = null; // 组合键自定义名称
    // V1.0.11:不再有外部 Ctrl/Alt/Shift 勾选行——修饰键直接作为可选键进组合列表(见 KEY_ORDER 头三项)
    function fillKeys(sel) {
      sel.innerHTML = "";
      KEY_ORDER.forEach(function (kk) {
        var op = document.createElement("option");
        op.value = kk; op.textContent = kk;
        sel.appendChild(op);
      });
    }
    function comboKeySel() {
      var row = el("div", "dsh-mk-row");
      row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #eef2f8";
      var sel = el("select", "dsh-mk-sel");
      sel.style.flex = "1";
      fillKeys(sel);
      var del = el("button", "dsh-mk-mini del", "删");
      del.addEventListener("click", function () {
        if (comboBox.querySelectorAll("select").length <= 1) { toast("至少保留1个键"); return; }
        row.parentNode.removeChild(row);
      });
      row.appendChild(sel); row.appendChild(del);
      return row;
    }
    var comboRowBt = el("div", "dsh-mk-row");
    comboRowBt.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0";
    var addKeyBt = el("button", "dsh-mk-mini", "+加键");
    addKeyBt.addEventListener("click", function () {
      if (comboBox.querySelectorAll("select").length >= 6) { toast("最多6键"); return; }
      comboBox.insertBefore(comboKeySel(), comboRowBt);
    });
    comboRowBt.appendChild(addKeyBt);
    comboBox.appendChild(comboRowBt);
    function comboVals() {
      var vs = [];
      Array.prototype.forEach.call(comboBox.querySelectorAll("select"), function (s) { if (s.value) vs.push(s.value); }); // NodeList/HTMLCollection 兼容
      return vs;
    }
    function fillParams() {
      var t = typeSel.value;
      paramSel.style.display = "inline-block";
      comboBox.style.display = "none";
      if (t === "win") {
        paramSel.innerHTML = "";
        WIN_ORDER.forEach(function (w) {
          var op = document.createElement("option");
          op.value = w; op.textContent = WIN_MAP[w] || w;
          paramSel.appendChild(op);
        });
      } else if (t === "key") {
        fillKeys(paramSel);
      } else if (t === "fight" || t === "rot") {
        paramSel.style.display = "none";
      } else if (t === "combo") {
        paramSel.style.display = "none";
        while (comboBox.children.length) comboBox.removeChild(comboBox.children[0]); // 清空重建
        comboNameRow = el("div", "dsh-mk-row");
        comboNameRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0";
        comboNameRow.appendChild(el("label", null, "名称"));
        comboNameInp = el("input", "dsh-mk-inp");
        comboNameInp.style.width = "90px";
        comboNameInp.placeholder = "默认键序列";
        comboNameRow.appendChild(comboNameInp);
        comboBox.appendChild(comboNameRow);
        comboBox.appendChild(comboKeySel()); // 初始 1 键,自选任意数量(1..6)
        comboBox.appendChild(comboRowBt);
        comboBox.style.display = "flex";
      } else {
        paramSel.innerHTML = "";
      }
    }
    typeSel.addEventListener("change", function () {
      paramSel.style.display = "inline-block";
      xInp.style.display = "none"; yInp.style.display = "none";
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
      else if (t === "combo") {
        var vs = comboVals();
        if (vs.length < 1) { toast("请选择至少1个键"); return; }
        var nameV = (comboNameInp && comboNameInp.value && comboNameInp.value.trim()) || vs.join("+");
        k = { id: Math.random().toString(36).slice(2, 9), t: "combo", label: nameV, keys: vs };
      } else if (t === "fight") {
        k = { id: Math.random().toString(36).slice(2, 9), t: "fight", label: "内挂战斗" };
      } else if (t === "rot") {
        k = { id: Math.random().toString(36).slice(2, 9), t: "rot", label: "旋转屏幕" };
      } else {
        var xx = parseFloat(xInp.value), yy = parseFloat(yInp.value);
        if (!isFinite(xx) || !isFinite(yy)) { toast("请填写点地坐标"); return; }
        k = { id: Math.random().toString(36).slice(2, 9), t: "move", label: "点地", x: Math.round(xx), y: Math.round(yy) };
      }
      if (posSel.value === "bar") cfg.bar.push(k); else cfg.col.push(k);
      saveCfg(); renderKeys(); openEdit();
    });
    addRow.appendChild(posSel); addRow.appendChild(typeSel); addRow.appendChild(paramSel); addRow.appendChild(comboBox); addRow.appendChild(xInp); addRow.appendChild(yInp); addRow.appendChild(addBtn);
    panel.appendChild(addRow);
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
    // 尺寸与画面
    function rangeRow(label, getv, setv, min, max, step, unit, onapply) {
      var row = el("div", "dsh-mk-range");
      var lb = el("div", "dsh-mk-label", label);
      var sp = el("div", "dsh-mk-range-v", String(getv()) + unit);
      var inp = el("input");
      inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = String(getv());
      inp.addEventListener("input", function () {
        setv(parseInt(inp.value, 10));
        sp.textContent = inp.value + unit;
        saveCfg();
        try { onapply && onapply(); } catch (e) {}
      });
      row.appendChild(lb); row.appendChild(inp); row.appendChild(sp);
      isolate(row);
      return row;
    }
    panel.appendChild(rangeRow("键大小", function () { return cfg.opts.keyScale; }, function (v) { cfg.opts.keyScale = v; }, 60, 200, 5, "%", function () { renderKeys(); }));
    panel.appendChild(rangeRow("摇杆大小", function () { return cfg.opts.joyScale; }, function (v) { cfg.opts.joyScale = v; }, 50, 200, 5, "%", function () { if (joyEl && joyEl._updateSize) joyEl._updateSize(); }));
    panel.appendChild(rangeRow("摇杆死区(半径%内不触发)", function () { return cfg.opts.joyDead; }, function (v) { cfg.opts.joyDead = v; }, 5, 50, 5, "%")); // V1.0.12 防中心抖动误出发
    panel.appendChild(rangeRow("方向切换回差(防回头)", function () { return cfg.opts.joyAng; }, function (v) { cfg.opts.joyAng = v; }, 0, 45, 5, "°")); // V1.0.12 扇区边界抖动不来回切
    panel.appendChild(rangeRow("画面缩放", function () { return cfg.opts.uiScale; }, function (v) { cfg.opts.uiScale = v; }, 60, 180, 5, "%", function () { applyUiScale(); }));
    var posRow = el("div", "dsh-mk-row");
    var posBt = el("button", "dsh-mk-add", "调整按键/摇杆位置(拖拽)");
    posBt.style.flex = "1";
    posBt.addEventListener("click", function () { posModeEnter(); });
    posRow.appendChild(posBt);
    panel.appendChild(posRow);
    var arRow = el("div", "dsh-mk-row"); // V1.0.14 自动排列(4 列网格)
    var arBt = el("button", "dsh-mk-add", "自动排列(4列网格)");
    arBt.style.flex = "1";
    arBt.addEventListener("click", function () { try { autoArrange(); } catch (e) { toast("自动排列失败"); } });
    arRow.appendChild(arBt);
    panel.appendChild(arRow);
    panel.appendChild(swRow("拖拽吸附 5% 网格(松手自动对齐)", function () { return cfg.opts.snap; }, function (v) { cfg.opts.snap = v; saveCfg(); }));
    panel.appendChild(swRow("模拟摇杆(两内核显示)", function () { return cfg.opts.joyShow; }, function (v) {
      cfg.opts.joyShow = v;
      if (v) { if (!joyEl) showJoystick(); }
      else if (joyEl && joyEl.parentNode) { var jj = joyEl; joyEl = null; jj.parentNode.removeChild(jj); }
    }));
    panel.appendChild(swRow("摇杆协议直驱(默认关,不稳时开)", function () { return cfg.opts.joyProto; }, function (v) { cfg.opts.joyProto = v; }));
    panel.appendChild(swRow("内挂自动战斗状态开关(战斗键可在下方单独添加)", function () { return npFightOn; }, function (v) { npFightOn = v; npAutoFight(v); synchFightBtn(); }));
    // 底部按钮
    var foot = el("div", "dsh-mk-foot");
    var ok = el("button", "dsh-mk-ok", "完成");
    ok.addEventListener("click", function () { saveCfg(); mask.style.display = "none"; });
    var reset = el("button", "dsh-mk-reset", "恢复默认");
    reset.addEventListener("click", function () {
      cfg = defaultCfg();
      saveCfg(); renderKeys();
      try { applyEdgeUI(); if (joyEl && joyEl._updateSize) joyEl._updateSize(); } catch (e) {} // 摇杆即时归位
      openEdit();
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
    if (k.t === "combo") return "组合 " + (k.label || (k.keys || []).join("+"));
    if (k.t === "fight") return "内挂战斗 " + (k.label && k.label !== "内挂战斗" ? "(" + k.label + ")" : "");
    if (k.t === "rot") return "旋转屏幕 " + (k.label && k.label !== "旋转屏幕" ? "(" + k.label + ")" : "");
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
