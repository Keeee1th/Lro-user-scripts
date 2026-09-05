// ==UserScript==
// @name         仙境传说 · 原站插件模式（游戏助手）
// @namespace    dsh.ro-plugin
// @version      2.10.6
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-assist.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-assist.user.js
// @description  在 post.lastro.cn 原站以插件模式启动《仙境的传说》ROBrowser 客户端并连接原服务器；数据自动走本地镜像（127.0.0.1:8973）避免加载卡死，支持自动登录。PC 版直接打开 https://post.lastro.cn/ro/api.html；手机版打开 https://post.lastro.cn/?r=mn/index（登录页可选择平台与线路）。
// @author       DSH
// @match        https://post.lastro.cn/*
// @match        https://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ---------------- 配置 ----------------
  // 服务器选择（原站 initialize(nid) 机制）：ClientVer 3 = V6-Online[三转]，5 = V6-Eden[进阶二转]
  // 默认进阶二转；URL 加 ?cv=3 可切回三转（如 api.html?69.32&cv=3）；也可用面板「线路」下拉切换
  var CV_DEFAULT = 5;
  var SERVER_NAMES = { 3: "V6-Online 三转", 5: "V6-Eden 进阶二转" };
  var SERVER_IDS = [3, 5];
  // 手机版检测：post.lastro.cn/?r=mn/index（同客户端 Online_mn.js + 同数据，触摸事件驱动）
  var IS_MN = /[?&]r=mn/.test(location.search);
  // 手机版页面路径：/?r=mn/index（PC 版为 /ro/api.html）
  var MN_PATH = "/?r=mn/index";
  var PC_PATH = "/ro/api.html";
  var cvMatch = (location.search.match(/[?&]cv=(\d+)/) || [null, String(CV_DEFAULT)])[1];
  // 生效线路：URL ?cv= 优先，其次面板保存的选择，最后默认二转
  function pickCv() {
    var u = parseInt(cvMatch, 10), s = saved && saved.server;
    if (SERVER_IDS.indexOf(u) !== -1) return u;
    if (SERVER_IDS.indexOf(s) !== -1) return s;
    return CV_DEFAULT;
  }
  var LS_KEY = "dsh_ro_plugin_v1";
  var VERSION_RE = /\?([0-9.]+)/;
  var VER = "2.10.6"; // 面板标题/加载提示/日志统一版本号（bump 时与 @version 同步改）

  // ---------------- 角色档案（V1.7.0：按「角色名_ID」分档存储 · OpenKore 风格）----------------
  // 全局（登录/线路）→ dsh_ro_plugin_v1；角色设置（全部开关/技能/锁定/自动技能）→ dsh_ro_profiles_v2
  var LOGIN_KEYS = ["account", "password", "server", "autoBoot"];
  var PROF_KEY = "dsh_ro_profiles_v2";
  var profiles = loadProfiles();
  pruneProfiles(); // V2.8.9：启动即归并历史小数垃圾键（无损，只删重复档）
  var activeCharKey = "default";
  var lastCharGid = null; // 已识别的主角色 GID（换角色自动切档）
  function activeProfileKey() { return activeCharKey; }
  function setActiveProfile(k) { activeCharKey = k || "default"; }
  function loadProfiles() { try { return JSON.parse(localStorage.getItem(PROF_KEY)) || {}; } catch (e) { return {}; } }
  function saveProfiles() { try { localStorage.setItem(PROF_KEY, JSON.stringify(profiles)); } catch (e) {} }
  function ensureProfile(k) { if (!profiles[k]) profiles[k] = { name: k, gid: 0, saved: {}, lockList: {}, askList: [], lastAt: 0 }; return profiles[k]; }
  // V2.8.9：lastro 自身实体 GID 是带随机小数的浮点（引擎自己用 parseInt 比较），
  // 这里统一取整（Math.floor），非法/非正数返回 0，避免每秒拼出 name_GID.<小数> 的新档键。
  function gidInt(v) { var n = Math.floor(Number(v)); return (isFinite(n) && n > 0) ? n : 0; }
  // V2.8.9：归并历史小数垃圾键（角色_2007018.9392906795 → 角色_2007018），同一基键只留 lastAt 最新的一份。
  function pruneProfiles() {
    try {
      var keys = Object.keys(profiles);
      if (!keys.length) return;
      var groups = {}, changed = false;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var base = String(k).replace(/\.\d+$/, ""); // 剥掉末尾 .<小数>
        if (base !== k) changed = true;
        if (!groups[base]) groups[base] = [];
        groups[base].push(k);
      }
      if (!changed) return;
      var out = {};
      for (var b in groups) {
        var list = groups[b];
        var best = null, bestT = -1;
        if (profiles[b]) { best = profiles[b]; bestT = (profiles[b].lastAt) || 0; } // 存在整数基键（真实档）优先保留，小数垃圾只作兜底
        for (var j = 0; j < list.length; j++) {
          var p = profiles[list[j]];
          if (p === best) continue;
          var t = (p && p.lastAt) || 0;
          if (!best || t > bestT) { bestT = t; best = p; }
        }
        out[b] = best || {};
      }
      profiles = out;
      saveProfiles();
    } catch (e) {}
  }
  // 首次运行迁移：旧扁平 saved（去登录键）+ 旧锁定/自动技能 → default 档案
  function ensureProfilesInit() {
    if (Object.keys(profiles).length) return;
    try {
      var legacy = {};
      try { legacy = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) {}
      var saved0 = {}, glob0 = {};
      for (var k in legacy) {
        if (LOGIN_KEYS.indexOf(k) >= 0) glob0[k] = legacy[k];
        else saved0[k] = legacy[k];
      }
      var lock0 = {}; try { lock0 = JSON.parse(localStorage.getItem("dsh_ro_locklist")) || {}; } catch (e) {}
      var ask0 = []; try { ask0 = JSON.parse(localStorage.getItem("dsh_ro_asklist")) || []; } catch (e) {}
      profiles["default"] = { name: "默认", gid: 0, saved: saved0, lockList: lock0, askList: ask0, lastAt: Date.now() };
      try { localStorage.setItem(LS_KEY, JSON.stringify(glob0)); } catch (e) {}
      saveProfiles();
    } catch (e) {}
  }
  ensureProfilesInit();
  var saved = loadSaved();
  var DEFAULTS = {
    application: "Online",
    servers: "data/clientinfo.xml",
    grfList: null,
    remoteClient: "/ro/client_re/",
    packetver: "auto",
    development: false,
    api: false,
    socketProxy: "wss://port.lastro.cn/", // 原站 WS 代理（ClientVer 3 三转 / 5 进阶二转 均走此代理）
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
  var LOCAL_DATA = "http://127.0.0.1:8973/ro/client_re/"; // 本地镜像（毫秒级，避免原站数据卡死）
  var REMOTE_DATA = "/ro/client_re/";                        // 原站数据
  var useLocalData = false;

  function loadSaved() {
    try {
      var key = activeProfileKey();
      var p = profiles[key] || profiles["default"] || {};
      var o = {};
      var src = p.saved || {};
      for (var k in src) o[k] = src[k];
      var g = {};
      try { g = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) {}
      for (var kg in g) { if (LOGIN_KEYS.indexOf(kg) >= 0) o[kg] = g[kg]; } // 全局登录键覆盖
      return o;
    } catch (e) { return {}; }
  }
  // 保存分流：登录键→全局存储；其余→当前角色档案（含 lockList/askList 快照）
  function saveSaved(o) {
    try {
      var g = o || saved;
      if (!g) return;
      var glob = {}, prof = {};
      for (var k in g) {
        if (LOGIN_KEYS.indexOf(k) >= 0) glob[k] = g[k];
        else prof[k] = g[k];
      }
      var oldG = {};
      try { oldG = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) {}
      for (var k2 in glob) oldG[k2] = glob[k2];
      try { localStorage.setItem(LS_KEY, JSON.stringify(oldG)); } catch (e) {}
      var key = activeProfileKey();
      ensureProfile(key);
      var p = profiles[key];
      for (var kp in prof) p.saved[kp] = prof[kp];
      p.lockList = (typeof lockList !== "undefined" && lockList) || (p.lockList || {});
      p.askList = (typeof askList !== "undefined" && askList) || (p.askList || []);
      p.lastAt = Date.now();
      saveProfiles();
    } catch (e) {}
  }

  var version = (location.href.match(VERSION_RE) || [null, "69.32"])[1];

  // ---------------- 状态 ----------------
  var state = {
    ready: false,
    bootedByWrapper: false,
    bootedByPlugin: false,
    account: null
  };

  // ---------------- 遥测（诊断用，仅发往本机 127.0.0.1:8973）----------------
  function tlog(msg) {
    try {
      var ver = "?";
      try { if (typeof GM_info !== "undefined" && GM_info && GM_info.script) ver = GM_info.script.version; } catch (e) {}
      var u = "http://127.0.0.1:8973/plugin/log?msg=" + encodeURIComponent("[v" + ver + "] " + msg);
      if (typeof fetch === "function") { fetch(u, { mode: "no-cors" }).catch(function () {}); }
      var img = new Image();
      img.src = u;
    } catch (e) {}
  }

  // ---------------- 客户端启动 ----------------
  function buildConfig() {
    var cfg = {};
    var k;
    for (k in DEFAULTS) cfg[k] = DEFAULTS[k];
    cfg.version = version;
    cfg.remoteClient = useLocalData ? LOCAL_DATA : REMOTE_DATA;
    if (window.__dshRunAcct && window.__dshRunPwd) {
      // 兼容旧多开窗口注入（V1.6.18 已取消多账号 UI，此处保留旧窗口兜底；V1.7.0 起设置按角色分档）
      cfg.autoLogin = [window.__dshRunAcct, window.__dshRunPwd];
    } else if (saved.account && saved.password) {
      // 中转确认机制：默认打开页面不自动登录（避免把中转页/当前会话的账号挤掉）。
      // 仅显式操作才注入 autoLogin：
      //   ?auto=1 → 顶部登录框「保存并自动登录」「中转确认后登录」显式入口（用户已在中转页确认）
      //   saved.autoBoot === true → 恢复旧行为（打开即自动登录，可选）
      var wantAuto = /[?&](run|auto)=/.test(location.search) || saved.autoBoot === true;
      if (wantAuto) cfg.autoLogin = [saved.account, saved.password];
    }
    return cfg;
  }

  // 探测本地数据服务器是否可用（带 1.5s 超时），可用则数据走本地（秒开，不卡加载）
  function detectDataServer(cb) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", LOCAL_DATA + "data/clientinfo.xml", true);
      xhr.timeout = 1500;
      xhr.onload = function () {
        useLocalData = xhr.status === 200 && xhr.responseText.indexOf("clientinfo") !== -1;
        if (useLocalData) setStatus("本地数据源 ✓ 加载秒开", "ok");
        tlog("detect=" + (useLocalData ? "local" : "remote-fallback") + " status=" + xhr.status);
        cb();
      };
      xhr.onerror = function () { useLocalData = false; tlog("detect=error"); cb(); };
      xhr.ontimeout = function () { useLocalData = false; tlog("detect=timeout"); cb(); };
      xhr.send();
    } catch (e) { useLocalData = false; cb(); }
  }

  function boot() {
    if (state.ready || state.bootedByWrapper || state.bootedByPlugin) return;
    state.bootedByPlugin = true;
    var cfg = buildConfig();
    tlog("post-config source=" + (useLocalData ? "local" : "remote") + " version=" + version + " clientver=" + cfg.ClientVer + " autoLogin=" + (cfg.autoLogin.length ? "yes" : "no"));
    var already = false;
    try {
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        if (/Online(_mn)?\.js/.test(scripts[i].src)) { already = true; break; }
      }
    } catch (e) {}
    if (!already) {
      var directInjected = false;
      try {
        window.ROConfig = cfg;
        var app = document.createElement("script");
        app.type = "text/javascript";
        app.src = "Online.js?" + version;
        document.getElementsByTagName("head")[0].appendChild(app);
        directInjected = true;
        setStatus("已注入配置，正在启动客户端…");
      } catch (e) {
        tlog("inject-error " + (e && e.message));
      }
      if (!directInjected) {
        setTimeout(function () {
          if (!state.ready) {
            window.postMessage(cfg, "*");
            tlog("postMessage-fallback");
          }
        }, 1200);
      }
    }
  }

  // ---------------- 工具 ----------------
  var $ = function (tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  };
  var $id = function (id) { return document.getElementById(id); };

  // 通用拖拽排序：给容器内的 .drag-item 行启用 HTML5 拖拽重排，完成后回调 onReorder(旧索引,新索引)
  function enableDragSort(container, onReorder) {
    if (!container) return;
    if (container._dragBound) return; // 已绑定过（容器不重建，防重复监听）
    container._dragBound = true;
    container.addEventListener("dragstart", function (e) {
      var row = e.target.closest ? e.target.closest(".drag-item") : null;
      if (!row) return;
      row.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", row.getAttribute("data-drag-i") || ""); } catch (ex) {}
      e.dataTransfer.effectAllowed = "move";
    });
    container.addEventListener("dragover", function (e) {
      var row = e.target.closest ? e.target.closest(".drag-item") : null;
      if (!row || row.classList.contains("dragging")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var rect = row.getBoundingClientRect();
      var after = e.clientY > rect.top + rect.height / 2;
      container.insertBefore(document.querySelector(".dragging"), after ? row.nextSibling : row);
    });
    container.addEventListener("drop", function (e) {
      e.preventDefault();
      var drag = container.querySelector(".dragging");
      if (!drag) return;
      var from = parseInt(drag.getAttribute("data-drag-i"), 10);
      var rows = container.querySelectorAll(".drag-item");
      var to = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] === drag) { to = i; break; }
      }
      drag.classList.remove("dragging");
      if (from !== to && typeof onReorder === "function") onReorder(from, to);
    });
    container.addEventListener("dragend", function () {
      var d = container.querySelector(".dragging");
      if (d) d.classList.remove("dragging");
    });
  }

  // ---------------- 客户端访问 ----------------
  var CLIENT = { SS: null, NM: null, PS: null, MR: null, DB: null, UI: null, EM: null, hooked: false };
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
      if (cur) return cur;
      if (CLIENT.DB) {
        var nm = CLIENT.DB.getMapName && CLIENT.DB.getMapName(cur);
        return nm || cur || "";
      }
      return cur || "";
    } catch (e) { return ""; }
  }
  function getJobName(jobId) {
    try {
      var map = { 0: "初学者", 1: "剑士", 2: "魔法师", 3: "弓箭手", 4: "服事", 5: "商人", 6: "盗贼", 7: "骑士", 8: "牧师", 9: "巫师", 10: "铁匠", 11: "猎人", 12: "刺客", 13: "骑士", 14: "十字军", 15: "武僧", 16: "贤者", 17: "流氓", 18: "炼金术士", 19: "诗人", 20: "舞者", 4001: "进阶初学者", 4002: "进阶剑士", 4003: "进阶魔法师", 4004: "进阶弓箭手", 4005: "进阶服事", 4006: "进阶商人", 4007: "进阶盗贼", 4008: "骑士领主", 4009: "神官", 4010: "超魔导师", 4011: "神工匠", 4012: "神射手", 4013: "十字刺客", 4015: "武宗", 4016: "智者", 4017: "神行太保", 4018: "创造者", 4019: "搞笑艺人", 4020: "冷艳舞姬" };
      return map[jobId] || String(jobId);
    } catch (e) { return String(jobId); }
  }
  function requireDB(name) {
    try {
      if (!window.require) return null;
      return window.require(name);
    } catch (e) { return null; }
  }

  // ---------------- 技能名 / 怪物名 / 物品名（客户端模块）----------------
  var _skillInfoCache = null;
  // 被动技能判定：SKILLINFO_LIST 的 type 字段（0=被动，1=主动），与 SkillList 组件一致
  function isPassiveSkill(skid) {
    try {
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      var si = DB && typeof DB.getSkillInfo === "function" && DB.getSkillInfo(skid);
      if (si && si.type != null) return !si.type;
    } catch (e) {}
    try {
      if (!_skillInfoCache) _skillInfoCache = requireDB("DB/Skills/SkillInfo");
      var s = _skillInfoCache && _skillInfoCache[skid];
      if (s && s.type != null) return !s.type;
      // 无 type 字段时回退：SpAmount 全 0 视为被动（武器研究/钢制喙/天使之护等）
      if (s && Array.isArray(s.SpAmount) && s.SpAmount.length) {
        var allZero = true;
        for (var i = 0; i < s.SpAmount.length; i++) if (s.SpAmount[i] !== 0) { allZero = false; break; }
        if (allZero) return true;
      }
    } catch (e) {}
    return false;
  }
  function getSkillNameById(skid) {
    try {
      // 优先 DBManager.getSkillInfo（vbk 同款）
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      var si = DB && typeof DB.getSkillInfo === "function" && DB.getSkillInfo(skid);
      if (si && (si.SkillName || si.name || si.Name)) return si.SkillName || si.name || si.Name;
    } catch (e) {}
    try {
      if (!_skillInfoCache) _skillInfoCache = requireDB("DB/Skills/SkillInfo");
      var s = _skillInfoCache && _skillInfoCache[skid];
      if (s && s.SkillName) return s.SkillName;
      if (s && s.Name) return s.Name;
    } catch (e) {}
    return null;
  }
  // 技能攻击射程：按等级取 AttackRange（默认1格近战）
  function getSkillRange(skid, lv) {
    try {
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      var si = DB && typeof DB.getSkillInfo === "function" && DB.getSkillInfo(skid);
      var range = null;
      if (si) {
        var ar = si.AttackRange || si.attackRange || si.Range;
        if (Array.isArray(ar)) range = ar[Math.min((lv || 1) - 1, ar.length - 1)];
        else if (typeof ar === "number") range = ar;
        else if (ar != null) range = parseInt(ar, 10) || null;
      }
      if (range == null && !si) {
        if (!_skillInfoCache) _skillInfoCache = requireDB("DB/Skills/SkillInfo");
        var s = _skillInfoCache && _skillInfoCache[skid];
        if (s) {
          var ar2 = s.AttackRange || s.attackRange || s.Range;
          if (Array.isArray(ar2)) range = ar2[Math.min((lv || 1) - 1, ar2.length - 1)];
          else if (typeof ar2 === "number") range = ar2;
          else if (ar2 != null) range = parseInt(ar2, 10) || null;
        }
      }
      if (range == null) range = 1; // 默认近战
      return range;
    } catch (e) { return 1; }
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

  // ============================================================
  //  面板（分页式 · v1.6 重构）
  // ============================================================
  var PANEL_CSS =
    "#dsh-ro-panel{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:2147483647;width:400px;height:640px;min-width:300px;min-height:360px;max-height:92vh;" +
    "background:rgba(244,247,252,.93);border:2px solid #1f9d4d;border-radius:12px;color:#16202c;" +
    "font:13px/1.6 'Microsoft YaHei',system-ui,sans-serif;" +
    "box-shadow:0 0 0 3px rgba(31,157,77,.35),0 10px 32px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden}" +
    "#dsh-ro-panel .hd{padding:8px 12px;border-bottom:1px solid #c7d3e6;display:flex;justify-content:space-between;align-items:center;cursor:move;background:linear-gradient(135deg,#2f6fde,#1d4ed8);color:#fff;flex:none}" +
    "#dsh-ro-panel .hd b{color:#fff;font-weight:700;font-size:14px}" +
    "#dsh-ro-panel .hd .hbtns{display:flex;align-items:center;gap:6px}" +
    "#dsh-ro-panel .hd .hbtn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;padding:2px 8px;font-size:13px;cursor:pointer;font-weight:600}" +
    "#dsh-ro-panel .hd .hbtn:hover{background:rgba(255,255,255,.3)}" +
    "#dsh-ro-panel .tabs{display:flex;background:rgba(221,229,241,.9);border-bottom:1px solid #c7d3e6;flex:none;padding:4px 6px 0;gap:2px;overflow-x:auto;scrollbar-width:thin}" +
    "#dsh-ro-panel .tab{flex:none;padding:5px 10px 6px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;color:#4a5b76;background:transparent;border:none;border-bottom:2px solid transparent;white-space:nowrap}" +
    "#dsh-ro-panel .tab:hover{background:rgba(255,255,255,.5);color:#1d4ed8}" +
    "#dsh-ro-panel .tab.active{background:rgba(244,247,252,.93);color:#1d4ed8;font-weight:700;border-bottom-color:#1d4ed8}" +
    "#dsh-ro-panel .statbar{display:flex;align-items:center;gap:6px;flex:none;padding:4px 10px;background:rgba(255,255,255,.88);border-bottom:1px solid #d3dff0;font-size:12px;color:#3c4d66;flex-wrap:wrap;white-space:nowrap}" +
    "#dsh-ro-panel .statbar .nm{font-weight:700;color:#16202c}" +
    "#dsh-ro-panel .statbar .job{color:#5a6b7f}" +
    "#dsh-ro-panel .statbar .lv{color:#1259b3;font-weight:700}" +
    "#dsh-ro-panel .statbar .bar{display:inline-flex;align-items:center;gap:3px}" +
    "#dsh-ro-panel .statbar .bar .bg{width:40px;height:7px;border-radius:4px;background:#e5eaf3;overflow:hidden;display:inline-block}" +
    "#dsh-ro-panel .statbar .bar .hp{display:block;height:100%;background:linear-gradient(90deg,#ef4444,#f87171)}" +
    "#dsh-ro-panel .statbar .bar .sp{display:block;height:100%;background:linear-gradient(90deg,#2f6fde,#60a5fa)}" +
    "#dsh-ro-panel .statbar .bar .bnum{color:#3c4d66;font-variant-numeric:tabular-nums}" +
    "#dsh-ro-panel .statbar .warn{color:#d97706}.statbar .warn.hot{color:#dc2626;font-weight:700}" +
    "#dsh-ro-panel .statbar .zeny{color:#b45309;font-weight:700}" +
    "#dsh-ro-panel .pages{flex:auto;min-height:0;overflow-y:auto;padding:16px 22px 20px}" +
    "#dsh-ro-panel .page{display:none}" +
    "#dsh-ro-panel .page.active{display:block}" +
    "#dsh-ro-panel .sub-tabs{display:flex;gap:2px;margin:2px 0 8px;border-bottom:1px solid #c7d3e6}" +
    "#dsh-ro-panel .sub-tab{flex:none;padding:3px 12px 4px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;color:#4a5b76;background:rgba(227,234,244,.9);border:1px solid #c7d3e6;border-bottom:none;font-weight:600}" +
    "#dsh-ro-panel .sub-tab:hover{background:#eef2f8}" +
    "#dsh-ro-panel .sub-tab.active{background:rgba(255,255,255,.9);color:#1d4ed8;border-bottom:2px solid #1d4ed8}" +
    "#dsh-ro-panel .sub-page{display:none}" +
    "#dsh-ro-panel .sub-page.active{display:block}" +
    "#dsh-ro-panel .a-layout{display:flex;gap:8px;align-items:stretch}" +
    "#dsh-ro-panel .a-nav{flex:none;display:flex;flex-direction:column;gap:4px;width:78px}" +
    "#dsh-ro-panel .a-nav .sub-tab{flex:none;padding:7px 8px;text-align:left;border-radius:6px;background:rgba(227,234,244,.92);border:1px solid #c7d3e6;font-weight:600;font-size:12px;line-height:1.35;white-space:normal}" +
    "#dsh-ro-panel .a-nav .sub-tab.active{background:rgba(255,255,255,.97);color:#1d4ed8;border:1px solid #1d4ed8;border-left:3px solid #1f9d4d}" +
    "#dsh-ro-panel .a-body{flex:auto;min-width:0}" +
    "#dsh-ro-panel .sec{margin:10px 0 7px;font-size:12px;color:#1259b3;font-weight:700;border-left:3px solid #2f6fde;padding-left:8px}" +
    "#dsh-ro-panel .sec:first-child{margin-top:0}" +
    "#dsh-ro-panel .row{margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
    "#dsh-ro-panel .row .lb{color:#5a6b7f;flex:none;min-width:50px}" +
    "#dsh-ro-panel input[type=text],#dsh-ro-panel input[type=password],#dsh-ro-panel input[type=number],#dsh-ro-panel select{flex:1;min-width:0;background:rgba(255,255,255,.9);border:1px solid #b9c4d4;color:#16202c;border-radius:5px;padding:3px 6px;font-size:13px;outline:none;font-family:inherit}" +
    "#dsh-ro-panel textarea{width:100%;background:rgba(255,255,255,.9);border:1px solid #b9c4d4;color:#16202c;border-radius:5px;padding:4px 6px;font-size:12px;resize:vertical;outline:none;font-family:Consolas,'Microsoft YaHei',monospace;line-height:1.5}" +
    "#dsh-ro-panel button{background:#2f6fde;color:#fff;border:1px solid #1f5cc9;border-radius:6px;padding:3px 9px;font-size:13px;cursor:pointer;font-weight:600;font-family:inherit}" +
    "#dsh-ro-panel button:hover{background:#3d7de8}" +
    "#dsh-ro-panel button.green{background:#1f9d4d;border-color:#17793a}#dsh-ro-panel button.green:hover{background:#26b25a}" +
    "#dsh-ro-panel button.red{background:#d64545;border-color:#b33535}" +
    "#dsh-ro-panel button.ghost{background:rgba(238,242,248,.92);color:#2a3a52;border-color:#c8d4e4}#dsh-ro-panel button.ghost:hover{background:#e2e9f4}" +
    "#dsh-ro-panel .box{background:rgba(255,255,255,.88);border:1px solid #dce4f0;border-radius:8px;padding:8px 10px;margin:7px 0}" +
    "#dsh-ro-panel .box .b-hd{font-size:12px;color:#1259b3;font-weight:700;margin-bottom:3px}" +
    "#dsh-ro-panel .list-item{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#3c4d66;padding:2px 0;border-bottom:1px dashed #e3e9f3}" +
    "#dsh-ro-panel .drag-item{cursor:grab;user-select:none;background:rgba(255,255,255,.85)}" +
    "#dsh-ro-panel .drag-item.dragging{opacity:.5;background:#e6f0ff}" +
    "#dsh-ro-panel .drag-item .dh{color:#9db1cc;margin-right:4px;font-size:13px;flex:none}" +
    "#dsh-ro-panel .list-item:last-child{border-bottom:none}" +
    "#dsh-ro-panel .log{font-size:11px;color:#7a879b;background:rgba(238,242,248,.9);border-radius:5px;padding:3px 7px;margin-top:4px}" +
    "#dsh-ro-panel .st{color:#5a6b7f}" +
    "#dsh-ro-panel .ok{color:#1a8a3a}#dsh-ro-panel .warn{color:#c77a00}#dsh-ro-panel .err{color:#d93025}" +
    "#dsh-ro-panel .switch{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#3c4d66;font-size:13px}" +
    "#dsh-ro-panel .switch input{accent-color:#2f6fde;width:13px;height:13px;flex:none}" +
    "#dsh-ro-panel .tag{font-size:11px;color:#fff;background:#64748b;border-radius:999px;padding:0 7px;flex:none}" +
    "#dsh-ro-panel .tag.blue{background:#2f6fde}#dsh-ro-panel .tag.green{background:#1f9d4d}" +
    "#dsh-ro-panel [style*=\"font-size:10px;\"]{font-size:11px!important}" +
    "#dsh-ro-panel [style*=\"font-size:11px;\"]{font-size:12px!important}" +
    "#dsh-ro-panel [style*=\"font-size:12px;\"]{font-size:13px!important}" +
    "#dsh-ro-panel .status{flex:none;display:flex;align-items:center;gap:6px;font-size:12px;background:rgba(232,237,245,.92);border-top:1px solid #d4dcea;padding:4px 12px;color:#4a5b76}" +
    "#dsh-ro-panel .status .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex:none}" +
    "#dsh-ro-panel .resize-h{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;z-index:5;display:flex;align-items:flex-end;justify-content:flex-end;padding:4px}" +
    "#dsh-ro-panel .resize-h::after{content:'';display:block;width:9px;height:9px;border-right:2px solid #7d93b3;border-bottom:2px solid #7d93b3;border-bottom-right-radius:3px;opacity:.8}" +
    "#dsh-ro-panel .resize-h:hover::after{border-color:#1d4ed8}" +
    "#dsh-ball{position:fixed;right:28px;bottom:80px;z-index:2147483647;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#1d4ed8);box-shadow:0 6px 18px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.35);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:grab;transition:transform .15s,box-shadow .15s;opacity:.8}" +
    "#dsh-ball:hover{transform:scale(1.06);opacity:1}" +
    "#dsh-ball .ico{font-size:18px;line-height:1}" +
    "#dsh-ball .txt{font-size:10px;font-weight:700;letter-spacing:1px;margin-top:2px}" +
    "#dsh-ball .dot{position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #1d4ed8}" +
    "#dsh-mini{position:fixed;top:12px;right:12px;z-index:2147483647;display:block;background:#2f6fde;border:1px solid #1f5cc9;color:#fff;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600}" +
    "#dsh-mini:hover{background:#3d7de8}" +
    // 侧边抽屉（V1.7.0：战斗页/技能页的 内挂模式/助手模式 配置块滑入右侧抽屉）
    "#dsh-ro-panel .drow{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 6px}" +
    "#dsh-ro-panel .dbtn{flex:1 1 auto;min-width:104px;padding:9px 6px;border-radius:8px;border:1px solid #1f9d4d;background:rgba(31,157,77,.1);color:#166534;font-weight:700;font-size:13px;cursor:pointer}" +
    "#dsh-ro-panel .dbtn:active{background:rgba(31,157,77,.24)}" +
    "#dsh-ro-panel #dsh-drawer{position:absolute;top:0;right:0;bottom:0;width:min(96%,340px);background:#f4f7fc;z-index:41;display:flex;flex-direction:column;transform:translateX(103%);transition:transform .22s ease;border-left:2px solid #1f9d4d;box-shadow:-6px 0 18px rgba(30,50,90,.28)}" +
    "#dsh-ro-panel #dsh-drawer.open{transform:translateX(0)}" +
    "#dsh-ro-panel #dsh-drawer .d-hd{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;background:#1f9d4d;color:#fff;font-weight:700;font-size:13px}" +
    "#dsh-ro-panel #dsh-drawer .d-main{flex:1 1 auto;display:flex;min-height:0}" +
    "#dsh-ro-panel #dsh-drawer .d-rail{flex:none;display:flex;flex-direction:column;gap:8px;padding:8px 6px;background:#eaf1f8;border-right:1px solid #d9e3ee}" +
    "#dsh-ro-panel #dsh-drawer .d-rail button{flex:none;padding:8px 5px;font-size:13px;font-weight:700;border-radius:6px}" +
    "#dsh-ro-panel #dsh-drawer .d-body{flex:1 1 auto;overflow:auto;padding:14px 20px 18px}" +
    // 可见滚动条 + 手机惯性滚动（内容区长，浏览器默认滚动条太细/隐藏 → 用户以为滚不动）
    // 滚动条双兼容：scrollbar-color（Firefox/新版 Chrome）+ ::-webkit-scrollbar（老 Chrome/Safari），均为绿色。
    // V2.6.0 第三轮：轨道底色去掉（rgba(31,157,77,.08) 整条浅绿带被误认"全框填充"），只留滑块；滑块 10→12px、min-height 44px，更醒目。
    // 不写 scrollbar-width:thin（会让 Chrome 只用标准属性、thumb 变细）；去掉 scrollbar-gutter 避免常驻空轨道被误认成额外图层。
    "#dsh-ro-panel .pages,#dsh-ro-panel #dsh-drawer .d-body{scrollbar-color:#1f9d4d transparent;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}" +
    "#dsh-ro-panel .pages::-webkit-scrollbar,#dsh-ro-panel #dsh-drawer .d-body::-webkit-scrollbar{width:12px;height:12px}" +
    "#dsh-ro-panel .pages::-webkit-scrollbar-thumb,#dsh-ro-panel #dsh-drawer .d-body::-webkit-scrollbar-thumb{background:#1f9d4d;border:3px solid rgba(244,247,252,.9);border-radius:8px;min-height:44px}" +
    "#dsh-ro-panel .pages::-webkit-scrollbar-thumb:hover,#dsh-ro-panel #dsh-drawer .d-body::-webkit-scrollbar-thumb:hover{background:#17893f}" +
    "#dsh-ro-panel .pages::-webkit-scrollbar-track,#dsh-ro-panel #dsh-drawer .d-body::-webkit-scrollbar-track{background:transparent;border-radius:8px}" +
    "#dsh-ro-panel .pages *, #dsh-ro-panel #dsh-drawer .d-body *{scrollbar-color:auto}";

  // ---------------- 页签定义 ----------------
  var PAGE_HTML = {
    nei: '' +
      '<div class="drow"><button class="dbtn" data-drw="battle-nei" data-title="内挂 · 战斗设置">战斗设置</button>' +
      '<button class="dbtn" data-drw="skill-np" data-title="内挂 · 技能设置">技能设置</button>' +
      '<span class="st" id="dsh-battlestate" style="font-size:10px;margin-left:auto">内挂状态: 未读取（打开内挂窗口）</span></div>' +
      '<div class="log">内挂模式：战斗/技能/防御/瞬移/坐下由游戏内挂执行，助手只读写内挂设置。开始/停止按钮固定在角色状态条下方（主面板常驻）。</div>' +
      '<div class="sub-page drawer-page" data-subpage="nei" data-dname="battle-nei">' +
      '<div class="sec">内挂模式（技能配置 · 攻击/移动设置）</div>' +
      '<div class="row"><span class="lb">主动技能</span><select id="dsh-autoskill"><option>- 请选择 -</option></select>' +
      '<span class="lb" style="min-width:26px">Lv</span><input id="dsh-autoskilllv" type="number" value="10" style="flex:0 0 38px">' +
      '<span class="lb" style="min-width:26px">概率</span><input id="dsh-autoskillpro" type="number" value="100" style="flex:0 0 40px"><span style="color:#5a6b7f">%</span></div>' +
      '<div class="row"><span class="lb">辅助技能</span><span class="st" id="dsh-nei-addi-count" style="font-size:10px">0 槽</span>' +
      '<button class="ghost" id="dsh-nei-addi-add" style="flex:0 0 auto">添加</button>' +
      '<button class="ghost" id="dsh-nei-addi-import" style="flex:0 0 auto">一次性导入</button>' +
      '<button class="ghost" id="dsh-nei-addi-clear" style="flex:0 0 auto">清空</button></div>' +
      '<div id="dsh-nei-addi" style="display:flex;flex-direction:column;gap:3px"></div>' +
      '<div class="row" id="dsh-nei-addi-importbox" style="display:none;flex-direction:column;align-items:stretch;gap:3px">' +
      '<textarea id="dsh-nei-addi-importta" rows="4" placeholder="一次性导入：每行一条 技能名或ID:等级，例：&#10;12:5&#10;加速术:10&#10;天使之赐福:9&#10;导入=整批替换当前列表，未识别的行跳过并在状态栏提示"></textarea>' +
      '<div class="row"><button id="dsh-nei-addi-importok" style="flex:0 0 auto">导入并替换</button>' +
      '<button class="ghost" id="dsh-nei-addi-importcancel" style="flex:0 0 auto">取消</button></div></div>' +
      '<div class="row"><span class="lb">自动念咒</span><select id="dsh-automatic"><option>- 请选择 -</option></select>' +
      '<span class="lb" style="min-width:40px">触发技能</span><select id="dsh-touchskill"><option>- 请选择 -</option></select>' +
      '<label class="switch"><input id="dsh-touchskillop" type="checkbox" checked>开</label></div>' +
      '<div class="row"><span class="lb">解围技能</span><select id="dsh-qoautoskill"><option>- 请选择 -</option></select>' +
      '<span class="lb" style="min-width:26px">Lv</span><input id="dsh-qoautoskilllv" type="number" value="5" style="flex:0 0 38px"></div>' +
      '<div class="row"><span class="lb">影咒技能</span><select id="dsh-autoshadow"><option>- 请选择 -</option></select></div>' +
      '<div class="row"><span class="lb">寻怪模式</span><select id="dsh-searchmode" style="flex:0 0 90px"><option value="">-</option></select>' +
      '<button class="ghost" id="dsh-readbot" style="flex:0 0 auto">读取内挂</button></div>' +
      '<div class="row"><span class="lb">检测目标</span><span class="st" id="dsh-targets" style="font-size:11px">未读取（打开内挂后点读取）</span></div>' +
      '<div class="row"><span class="lb">攻击距离</span><input id="dsh-distarget" type="number" value="0" style="flex:0 0 46px"><span style="color:#5a6b7f">格</span>' +
      '<span class="lb" style="min-width:44px">被攻击</span><select id="dsh-onlynoattack" style="flex:0 0 80px"><option value="">-</option></select></div>' +
      '<div class="sec">当前地图怪物（读地图表 · 同内挂检测目标）</div>' +
      '<div class="box"><div id="dsh-nei-mapmobs" style="font-size:11px;max-height:110px;overflow:auto"><span class="st">读取地图怪物表（中文名），勾选=加入锁定目录</span></div></div>' +
      '<div class="sec">防御与瞬移（内挂原生设置 · 桥接）</div>' +
      '<div class="row"><span class="lb">非选中怪攻击</span><select id="dsh-ona2" style="flex:0 0 100px"><option>无视</option><option>瞬移</option><option selected>还击</option></select></div>' +
      '<div class="row"><span class="lb">群殴时</span><span style="color:#5a6b7f">n≥</span><input id="dsh-mobnummin" type="number" value="6" style="flex:0 0 38px"><span style="color:#5a6b7f">只怪→</span>' +
      '<select id="dsh-mobnummax" style="flex:0 0 80px"><option>解围技能</option><option selected>瞬移</option></select></div>' +
      '<div class="row"><label class="switch"><input id="dsh-flygroup" type="checkbox" checked>群殴自动瞬移</label>' +
      '<label class="switch"><input id="dsh-flystuck" type="checkbox" checked>卡死自动瞬移</label></div>' +
      '<div class="row"><label class="switch"><input id="dsh-bossfly" type="checkbox" checked>BOSS出现瞬移</label>' +
      '<span class="lb" style="min-width:52px">瞬移间隔</span><input id="dsh-flytimer" type="number" value="30" style="flex:0 0 40px"><span style="color:#5a6b7f">s</span></div>' +
      '<div class="row"><span class="lb">HP低于</span><input id="dsh-minhpfly" type="number" value="20" style="flex:0 0 40px"><span style="color:#5a6b7f">%瞬移</span>' +
      '<span class="lb" style="min-width:50px">SP低于</span><input id="dsh-minspfly" type="number" value="10" style="flex:0 0 40px"><span style="color:#5a6b7f">%瞬移</span></div>' +
      '<div class="row"><span class="lb">HP低于</span><input id="dsh-minhpout" type="number" value="5" style="flex:0 0 40px"><span style="color:#5a6b7f">%下线</span>' +
      '<span class="lb" style="min-width:50px">无法瞬移</span><select id="dsh-keepway" style="flex:0 0 70px"><option selected>无视</option><option>逃脱</option></select></div>' +
      '<div class="sec">坐下（内挂原生 · 桥接）</div>' +
      '<div class="row"><label class="switch"><input id="dsh-opensit" type="checkbox" checked>自动坐下</label>' +
      '<span class="lb" style="margin-left:auto;min-width:26px">HP</span><input id="dsh-sithplo" type="number" value="40" style="flex:0 0 38px"><span style="color:#5a6b7f">~</span><input id="dsh-sithphi" type="number" value="80" style="flex:0 0 38px"><span style="color:#5a6b7f">%</span></div>' +
      '<div class="row"><span class="lb">SP范围</span><input id="dsh-sitsplo" type="number" value="30" style="flex:0 0 38px"><span style="color:#5a6b7f">~</span><input id="dsh-sitsphi" type="number" value="70" style="flex:0 0 38px"><span style="color:#5a6b7f">%</span>' +
      '<span class="lb" style="min-width:60px">坐下被锁定</span><select id="dsh-sitxw" style="flex:0 0 72px"><option selected>无视</option><option>还击</option><option>瞬移</option><option>逃脱</option></select></div>' +
      '<div class="log">内挂模式：技能/战斗/防御/瞬移/坐下全部由游戏内挂执行，助手只读写内挂设置。技能下拉只显示角色已学习。辅助技能支持多槽（每槽独立选技能+独立开关），buff 消失由内挂自动补状态（含队友状态），本页为查看/记录多辅助配置。</div>' +
      '</div>' +
      '<div class="sub-page drawer-page" data-subpage="zhu" data-dname="battle-zhu">' +
      '<div class="sec">助手模式（自控发包 · 无CD）</div>' +
      '<div class="sec">怪物侦查扫描（间隔可调）</div>' +
      '<div class="row"><label class="switch"><input id="dsh-scanen" type="checkbox" checked>启用侦查扫描</label>' +
      '<span class="lb" style="margin-left:auto;min-width:26px">间隔</span>' +
      '<input id="dsh-scanint" type="number" value="0.5" min="0.3" step="0.1" style="flex:0 0 44px"><span style="color:#5a6b7f">s（最低0.3）</span></div>' +
      '<details style="margin:4px 0"><summary style="cursor:pointer;color:#1259b3;font-size:12px">👁 附近怪物（实时 · <span id="dsh-scanst">未启动</span>）— 点开查看</summary>' +
      '<div class="box" style="margin-top:2px"><div id="dsh-scanlist" style="font-size:11px;max-height:120px;overflow:auto">未启动侦查</div></div></details>' +
      '<div id="dsh-fw-mlock">' +
      '<div class="sec" style="display:flex;align-items:center;gap:6px"><span style="flex:1">怪物锁定目录（只打勾选的怪）</span><button class="ghost" id="dsh-fw-btn-mlock" data-fw="mlock" style="flex:0 0 auto;padding:0 8px;font-size:11px">⧉ 浮窗</button></div>' +
      '<details style="margin:4px 0"><summary style="cursor:pointer;color:#1259b3;font-size:12px">📌 本图怪物锁定（读当前地图怪物表 · 勾选=锁定）</summary>' +
      '<div class="box" style="margin-top:2px"><div id="dsh-z-maplock" style="font-size:11px;max-height:120px;overflow:auto"><span class="st">读取当前地图怪物表（换图自动刷新）</span></div></div></details>' +
      '<div class="box"><div class="b-hd">已锁定 <button class="ghost" id="dsh-lockclear" style="flex:0 0 auto;padding:0 8px;font-size:11px">清空锁定</button><span class="tag green" id="dsh-lockcount" style="float:right">0 种</span></div><div id="dsh-locklist" style="font-size:11px">未锁定（勾选本图怪物或侦查扫描到的怪）</div>' +
      '<div class="log" style="margin-top:2px">锁定后自动切换目标：优先级=勾选怪 &gt; 最近 &gt; 血最少</div></div>' +
      '</div>' +
      '<div class="sec">防御与瞬移（助手自实现）</div>' +
      '<div class="row"><span class="lb">非选中怪攻击</span><select id="dsh-z-ona" style="flex:0 0 100px"><option>无视</option><option>瞬移</option><option selected>还击</option></select></div>' +
      '<div class="row"><span class="lb">群殴时</span><span style="color:#5a6b7f">n≥</span><input id="dsh-z-grp" type="number" value="6" min="0" style="flex:0 0 38px"><span style="color:#5a6b7f">只怪（0=关闭）→</span>' +
      '<select id="dsh-z-grpact" style="flex:0 0 88px"><option>解围技能</option><option selected>瞬移</option></select></div>' +
      '<div class="row"><span class="lb">瞬移方式</span><select id="dsh-z-flymode" style="flex:0 0 120px"><option>翅膀→瞬移术</option><option>苍蝇翅膀优先</option><option>瞬移术Lv1</option><option selected>瞬移术→翅膀</option></select>' +
      '<label class="switch"><input id="dsh-z-flyauto" type="checkbox" checked>无翅膀自动瞬移术</label></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-flystuck" type="checkbox">卡死自动瞬移(助手战斗中·10s)</label></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-idlefly" type="checkbox">无目标持续自动瞬移</label>' +
      '<span class="lb" style="min-width:34px">超过</span><input id="dsh-z-idleflysec" type="number" value="10" style="flex:0 0 40px"><span style="color:#5a6b7f">s无锁定怪→瞬移</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-bossfly" type="checkbox">BOSS出现瞬移</label>' +
      '<span class="lb" style="min-width:52px">瞬移间隔</span><input id="dsh-z-flyint" type="number" value="30" style="flex:0 0 40px"><span style="color:#5a6b7f">s</span></div>' +
      '<div class="row"><span class="lb">HP低于</span><input id="dsh-z-hpfly" type="number" value="20" style="flex:0 0 40px"><span style="color:#5a6b7f">%瞬移</span>' +
      '<span class="lb" style="min-width:50px">SP低于</span><input id="dsh-z-spfly" type="number" value="10" style="flex:0 0 40px"><span style="color:#5a6b7f">%瞬移</span></div>' +
      '<div class="row"><span class="lb">HP低于</span><input id="dsh-z-hpout" type="number" value="5" style="flex:0 0 40px"><span style="color:#5a6b7f">%下线</span>' +
      '<span class="lb" style="min-width:50px">无法瞬移</span><select id="dsh-z-keep" style="flex:0 0 70px"><option selected>无视</option><option>逃脱</option></select></div>' +
      '<div class="row"><span class="st" id="dsh-defstate" style="font-size:11px">防御状态：-</span></div>' +
      '<div class="sec">坐下（参考内挂 · 助手自实现）</div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-sit" type="checkbox" checked>自动坐下</label>' +
      '<span class="lb" style="margin-left:auto;min-width:26px">HP</span><input id="dsh-z-sithplo" type="number" value="40" style="flex:0 0 38px"><span style="color:#5a6b7f">~</span><input id="dsh-z-sithphi" type="number" value="80" style="flex:0 0 38px"><span style="color:#5a6b7f">%</span></div>' +
      '<div class="row"><span class="lb">SP范围</span><input id="dsh-z-sitsplo" type="number" value="30" style="flex:0 0 38px"><span style="color:#5a6b7f">~</span><input id="dsh-z-sitsphi" type="number" value="70" style="flex:0 0 38px"><span style="color:#5a6b7f">%</span>' +
      '<span class="lb" style="min-width:60px">坐下被锁定</span><select id="dsh-z-sitxw" style="flex:0 0 72px"><option selected>无视</option><option>还击</option><option>瞬移</option><option>逃脱</option></select></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-sitback" type="checkbox" checked>回满后继续战斗</label>' +
      '<label class="switch"><input id="dsh-z-sitnofight" type="checkbox">战斗状态不坐下</label></div>' +
      '<div class="row"><span class="lb">攻击间隔</span><input id="dsh-z-attint" type="number" value="0.5" min="0.3" step="0.1" style="flex:0 0 44px"><span style="color:#5a6b7f">s（最低0.3）</span>' +
      '<span class="lb" style="min-width:26px">寻怪</span><input id="dsh-z-range" type="number" value="12" style="flex:0 0 40px"><span style="color:#5a6b7f">格</span></div>' +
      '<div class="row"><span class="lb">物理距离</span><input id="dsh-z-pmrange" type="number" value="2" min="1" style="flex:0 0 40px"><span style="color:#5a6b7f">格(普攻/近战)</span>' +
      '<span class="lb" style="min-width:48px">魔法距离</span><input id="dsh-z-mgrange" type="number" value="9" min="1" style="flex:0 0 40px"><span style="color:#5a6b7f">格(远程技能)</span></div>' +
      '<div class="row"><span class="lb">换怪延迟</span><input id="dsh-z-switchdelay" type="number" value="0.3" min="0.1" step="0.1" style="flex:0 0 44px"><span style="color:#5a6b7f">s（打完一只→找下一只的间隔）</span></div>' +
      '<div class="row"><span class="lb">直走节流</span><input id="dsh-z-walkint" type="number" value="0.5" min="0.3" step="0.1" style="flex:0 0 44px"><span style="color:#5a6b7f">s（无怪直走寻怪间隔）</span>' +
      '<span class="lb" style="min-width:26px">追怪</span><input id="dsh-z-chaseint" type="number" value="0.5" min="0.3" step="0.1" style="flex:0 0 44px"><span style="color:#5a6b7f">s（内挂模式助手主动追怪间隔）</span></div>' +
      '<div class="row"><span class="lb">寻怪方式</span><select id="dsh-z-huntmode" style="flex:0 0 118px">' +
      '<option value="self" selected>自研直走寻怪</option><option value="np">内挂机制寻怪</option></select>' +
      '<label class="switch" style="margin-left:2px"><input id="dsh-z-astar" type="checkbox" checked>A*绕障寻路</label><span class="st" style="font-size:10px">（内挂发包时机自动控制，无需调节）</span></div>' +
      '<div class="row"><span class="st" style="font-size:10px">内挂=只有可攻击到的锁定怪（射程内）才停内挂、助手战斗；无怪/锁定怪超出射程→持续内挂寻怪移动靠近</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-follow" type="checkbox" checked>锁定目标跟随追击</label>' +
      '<label class="switch"><input id="dsh-z-next" type="checkbox" checked>打死换下一个</label></div>' +
      '<div class="log">助手模式=自己发包：侦查 EntityManager 附近MOB（跳过死亡）→ 命中锁定目录 → 锁定模式：选定目标后固定GID持续攻击（不死/不丢失不换，防漂移）→ 按技能顺序施放（释放前置自动补，并行判断）→ 无技能默认普攻（穿插平A开关：技能间隙按攻击间隔补普攻）→ 打死换下一个/锁定跟随追击可开关 → 被非锁定怪攻击时按「非选中怪攻击」处理（无视/瞬移/还击，HP下降3s内触发）→ 无目标寻怪：①自研直走+A*避障（定向直走，撞墙/卡住才转向）；②内挂机制寻怪=只有可攻击到的锁定怪（射程内）才停内挂、助手战斗；无怪或锁定怪超出射程→持续发包让服务器移动靠近（二转 UPDATEINFO id38/34，三转 NPC:setautoattack）。持续N秒无锁定怪→自动瞬移换点(苍蝇/瞬移术Lv1)。</div>' +
      '</div>',
    zhu: '' +
      '<div class="drow"><button class="dbtn" data-drw="battle-zhu" data-title="助手 · 战斗设置">战斗设置</button>' +
      '<button class="dbtn" data-drw="skill-zhu" data-title="助手 · 技能设置">技能设置</button>' +
      '<span class="st" id="dsh-z-state" style="font-size:10px;margin-left:auto">助手未启动</span></div>' +
      '<div class="log">助手模式：自控发包战斗（侦查/锁定/防御/坐下/寻怪/追击）+ 技能释放与顺序/多辅助。开始/停止按钮固定在角色状态条下方（主面板常驻）。</div>' +
      '<details class="drawer-page" data-dname="skill-np" style="margin:4px 0" open><summary style="cursor:pointer;color:#1259b3;font-size:12px">⚙ 内挂模式（模拟内挂指令 · 直接发给服务器）</summary>' +
      '<div style="margin-top:4px"><div class="row"><span class="lb">寻怪模式</span><select id="dsh-np-huntmode" style="flex:0 0 96px">' +
      '<option value="0" selected>移动寻怪</option><option value="1">范围寻怪</option><option value="2">原地寻怪</option></select>' +
      '<button class="ghost" id="dsh-np-hunt" style="flex:0 0 auto">📡 发送寻怪模式</button></div>' +
      '<div class="row"><button id="dsh-np-atk" style="flex:0 0 auto">⚔ 模拟内挂：开自动战斗</button>' +
      '<button class="ghost" id="dsh-np-pick" style="flex:0 0 auto">📥 模拟内挂：开自动拾取</button>' +
      '<button class="ghost" id="dsh-np-eat" style="flex:0 0 auto">🍖 模拟内挂：开自动吃药</button></div>' +
      '<div class="row"><span class="st" id="dsh-np-log" style="font-size:10px">未发送（二转=NOTIFY_UPDATEINFO id34/35/36/38 · 三转=WHISPER NPC:setauto*）</span></div>' +
      '<div class="log">内挂模式=游戏内挂执行（技能配置已并入「战斗」页签 · 内挂子页）。</div></div></details>' +
      '<details class="drawer-page" data-dname="skill-zhu" style="margin:4px 0" open><summary style="cursor:pointer;color:#1259b3;font-size:12px">🪄 助手模式（技能释放与顺序 · 多辅助 · 自动施放）<button class="ghost" id="dsh-fw-btn-skill" data-fw="skill" style="flex:0 0 auto;padding:0 8px;font-size:11px;float:right;margin-top:-1px">⧉ 浮窗</button></summary>' +
      '<div style="margin-top:4px"><div class="sec" style="margin-top:0">技能释放与顺序（自动判断释放前置 · 自动补状态）</div>' +
      '<div class="row"><label class="switch"><input id="dsh-prereq" type="checkbox" checked>自动补充释放前置（状态/气弹）</label>' +
      '<span class="tag blue" id="dsh-prereqcnt" style="margin-left:auto">释放需求表: 94技能</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-z-attmix" type="checkbox" checked>穿插平A（锁定普攻：技能放不出/冷却/无技能时补普攻）</label>' +
      '<span class="st" style="font-size:10px">关=纯技能流不普攻（法师等可关）</span></div>' +
      '<details id="dsh-skillpickbox" style="margin:4px 0"><summary style="cursor:pointer;color:#1259b3;font-size:12px">🖱 点选技能释放（展开/收缩）</summary>' +
      '<div class="box"><div class="b-hd">点选已学主动技能 → 自动生成技能顺序（拖拽排序 · 可收缩本栏）</div>' +
      '<div id="dsh-skillpick" style="font-size:11px;max-height:140px;overflow:auto"></div></div></details>' +
      '<div class="box"><div class="b-hd">技能顺序（拖拽排序 · 点选技能自动加入）</div>' +
      '<div id="dsh-skillorderlist" style="font-size:11px;max-height:110px;overflow:auto"><span class="st">空（点选上方技能加入，拖拽调整顺序）</span></div>' +
      '<div class="row" style="margin-top:2px"><button class="ghost" id="dsh-skillclear" style="flex:0 0 auto">清空</button>' +
      '<button class="ghost" id="dsh-skillimp" style="flex:0 0 auto">导入已学技能</button></div></div>' +
      '<details style="margin:4px 0"><summary style="cursor:pointer;color:#1259b3;font-size:12px">📝 手动编辑技能顺序/条件（默认折叠 · 高级用法）</summary>' +
      '<textarea id="dsh-skillorder" rows="3" placeholder="技能顺序：每行 技能ID:等级:条件:释放%:次数:锁定次数&#10;例：271  :5   :球5,爆气:80 :20 :3&#10;   技能ID :等级:条件    :概率:次数:锁定次数&#10;条件=释放前置，须全满足，可空；释放%=0-100（省略=100）&#10;次数=整轮最多放N次（0=不限，重开重置）；锁定次数=每只怪最多放N次（0=不限，换怪重置）&#10;等级超已学自动降级、未学自动跳过；只填ID也能用"></textarea>' +
      '<div class="log" style="margin-top:2px">字段说明：技能ID:等级:条件:释放%:次数:锁定次数。条件=释放前置（如阿修罗需球5,爆气，自动补状态）；释放%=0-100（省略=100）；次数=整轮上限（OpenKore maxUses，重开自动战斗重置）；锁定次数=每只怪上限（换目标/解锁清零重计）。点选/拖拽生成的行只填前2段，无需手写。例：271:5:球5,爆气:80:20:3 = 阿修罗5级，需5球+爆气，80%概率，整轮最多20次，每只怪最多3次。</div>' +
      '</details>' +
      '<div class="row" style="margin:0 0 4px"><span class="sec" style="margin:0">辅助技能（选技能自动加判定条件 · 按间隔施放）</span><button class="ghost" id="dsh-statehelp" style="flex:0 0 auto;margin-left:auto">状态速查</button></div>' +
      '<div class="row"><span class="lb">技能</span><select id="dsh-askskill" style="flex:0 0 auto;max-width:130px"><option value="">选择技能…</option></select>' +
      '<button class="ghost" id="dsh-askskilladd" style="flex:0 0 auto">＋加入</button>' +
      '<button class="ghost" id="dsh-askskillload" style="flex:0 0 auto">读技能栏</button></div>' +
      '<div class="row"><span class="lb">判定</span><select id="dsh-askcond" style="flex:0 0 auto"><option value="">无（纯按间隔放）</option><option value="self" selected>自身状态消失才补</option><option value="party">队友状态消失才补（待支持）</option></select></div>' +
      '<div class="row" style="align-items:center;flex-wrap:wrap;gap:4px 6px"><span class="lb">Debuff</span>' +
      '<div style="position:relative;flex:1 1 130px;min-width:100px"><input id="dsh-askdebuff" placeholder="输入Debuff中文/ID（联想）" autocomplete="off" style="width:100%;box-sizing:border-box;padding:3px 6px">' +
      '<div id="dsh-askdebuff-ac" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:99;background:#fff;border:1px solid #b8c6d4;border-radius:4px;max-height:180px;overflow:auto;box-shadow:0 3px 8px rgba(0,0,0,.18)"></div></div>' +
      '<span style="color:#5a6b7f;font-size:11px;line-height:1.4">选中后=该 Debuff 在身才放（如缓速在身→放加速术）</span></div>' +
      '<div class="row" style="align-items:center;flex-wrap:wrap;gap:4px 6px"><span class="lb">自身状态</span>' +
      '<div style="position:relative;flex:1 1 130px;min-width:100px"><input id="dsh-askstatus" placeholder="状态ID/英文（如 12 或 INC_AGI，联想辅助）" autocomplete="off" style="width:100%;box-sizing:border-box;padding:3px 6px;border:1px solid #b8c6d4;border-radius:4px;font-size:12px">' +
      '<div id="dsh-askstatus-ac" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:99;background:#fff;border:1px solid #b8c6d4;border-radius:4px;max-height:140px;overflow:auto"></div></div>' +
      '<span style="color:#5a6b7f;font-size:11px;line-height:1.4">选中后=该状态不在身才补（消失补）· 数字ID或英文EFST直认</span></div>' +
      '<div class="row"><span class="lb">间隔</span><input id="dsh-askint" type="number" value="120" style="flex:0 0 44px"><span style="color:#5a6b7f">s</span>' +
      '<span class="lb" style="min-width:34px">SP≥</span><input id="dsh-asksp" type="number" value="30" style="flex:0 0 40px"><span style="color:#5a6b7f">%</span>' +
      '<label class="switch" style="margin-left:auto"><input id="dsh-asken" type="checkbox">启用自动释放</label></div>' +
      '<div class="box"><div class="b-hd">技能释放列表 <span class="tag green" id="dsh-askcount" style="float:right">0 项</span></div>' +
      '<div id="dsh-asklist" style="font-size:11px;max-height:120px;overflow:auto"><span class="st">空（点选技能加入，可拖拽调序）</span></div>' +
      '<div class="row" style="margin-top:2px"><button class="ghost" id="dsh-askup" style="flex:0 0 auto">↑上移</button>' +
      '<button class="ghost" id="dsh-askdown" style="flex:0 0 auto">↓下移</button>' +
      '<button class="ghost" id="dsh-askdel" style="flex:0 0 auto">删除选中</button></div></div>' +
      '<div class="log" id="dsh-bufflog" style="margin-top:2px">辅助技能：未启用</div>' +
      '<div class="row" style="margin-top:2px"><span class="lb" style="min-width:48px">当前状态</span><span class="st" id="dsh-statusview" style="font-size:11px;flex:1;line-height:1.5">未读取（客户端就绪后显示）</span></div></div></details>',
    assist: '' +
      '<div class="a-layout">' +
      '<div class="a-nav">' +
      '<button class="sub-tab active" data-sub="ap-pot">自动吃药/物品</button>' +
      '<button class="sub-tab" data-sub="ap-pet">宠物投喂</button>' +
      '<button class="sub-tab" data-sub="ap-hl">物品标色</button>' +
      '<button class="sub-tab" data-sub="ap-mvp">MVP计时</button>' +
      '<button class="sub-tab" data-sub="ap-scr">脚本执行</button></div>' +
      '<div class="a-body">' +
      // 子页1：自动吃药 + 使用背包物品 + 自动跟随（默认）
      '<div class="sub-page active" data-subpage="ap-pot">' +
      '<div class="sec">自动吃药</div>' +
      '<div class="row"><span class="lb">HP低于</span><input id="dsh-pothealhp" type="number" value="40" style="flex:0 0 44px"><span style="color:#5a6b7f">%喝红</span>' +
      '<span class="lb" style="min-width:48px">SP低于</span><input id="dsh-potsp" type="number" value="30" style="flex:0 0 44px"><span style="color:#5a6b7f">%喝蓝</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-poten" type="checkbox">启用自动吃药</label>' +
      '<span class="st" id="dsh-potlog" style="font-size:10px"></span></div>' +
      '<div class="sec">自动使用物品（点选背包 · 条件触发）</div>' +
      '<div class="row"><span class="lb">物品</span><select id="dsh-itempick" style="flex:0 0 auto;max-width:130px"><option value="">选择物品…</option></select>' +
      '<button class="ghost" id="dsh-itempickadd" style="flex:0 0 auto">＋加入</button>' +
      '<button class="ghost" id="dsh-itempickload" style="flex:0 0 auto">读背包</button></div>' +
      '<div class="row"><span class="lb">触发</span><select id="dsh-itemcond" style="flex:0 0 100px"><option value="manual">手动</option><option value="hp">HP低于%</option><option value="sp">SP低于%</option><option value="interval">间隔秒</option><option value="status">状态在身用</option><option value="statusgone">状态消失用</option></select>' +
      '<input id="dsh-itemcondval" type="number" value="50" style="flex:0 0 40px">' +
      '<div style="position:relative;flex:0 0 92px"><input id="dsh-itemstatus" placeholder="状态中文/ID" autocomplete="off" style="width:100%;box-sizing:border-box;padding:3px 6px">' +
      '<div id="dsh-itemstatus-ac" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:99;background:#fff;border:1px solid #b8c6d4;border-radius:4px;max-height:180px;overflow:auto;box-shadow:0 3px 8px rgba(0,0,0,.18)"></div></div>' +
      '<button class="ghost" id="dsh-itemupd" style="flex:0 0 auto">更新</button></div>' +
      '<div class="box"><div class="b-hd">物品使用列表 <span class="tag green" id="dsh-itemcount" style="float:right">0 项</span></div>' +
      '<div id="dsh-itemlist" style="font-size:11px;max-height:90px;overflow:auto"><span class="st">空（选物品加入，可拖拽调序）</span></div>' +
      '<div class="row" style="margin-top:2px"><button class="ghost" id="dsh-itemup" style="flex:0 0 auto">↑上移</button>' +
      '<button class="ghost" id="dsh-itemdown" style="flex:0 0 auto">↓下移</button>' +
      '<button class="ghost" id="dsh-itemdel" style="flex:0 0 auto">删除选中</button>' +
      '<label class="switch" style="margin-left:auto"><input id="dsh-itemen" type="checkbox">启用自动使用</label></div></div>' +
      '<div class="sec">辅助对象 · 自动跟随玩家</div>' +
      '<div class="row"><span class="lb">跟随目标</span><select id="dsh-followtarget" style="flex:0 0 auto;max-width:140px"><option value="">选择玩家…（侦测）</option></select>' +
      '<button class="ghost" id="dsh-followscan" style="flex:0 0 auto">🔄 刷新</button></div>' +
      '<div class="row"><span class="lb">跟随距离</span><input id="dsh-followdist" type="number" value="3" min="1" style="flex:0 0 40px"><span style="color:#5a6b7f">格（达到即停）</span>' +
      '<label class="switch" style="margin-left:auto"><input id="dsh-followen" type="checkbox">启用跟随</label></div>' +
      '<div class="row"><span class="st" id="dsh-followlog" style="font-size:10px">未启用（选择玩家后开启）</span></div>' +
      '</div>' +
      // 子页2：宠物投喂
      '<div class="sub-page" data-subpage="ap-pet">' +
      '<div class="sec">宠物投喂（饱食度低于阈值自动喂）</div>' +
      '<div class="row"><button id="dsh-petfeed2" style="flex:0 0 auto">🍖 喂食</button>' +
      '<span class="lb" style="margin-left:8px;min-width:26px">饱食度&lt;</span><input id="dsh-petfeedhp2" type="number" value="25" style="flex:0 0 44px"><span style="color:#5a6b7f">%自动喂</span>' +
      '<span class="lb" style="min-width:34px">间隔</span><input id="dsh-petfeedint2" type="number" value="10" style="flex:0 0 40px"><span style="color:#5a6b7f">s</span>' +
      '<label class="switch" style="margin-left:auto"><input id="dsh-peten2" type="checkbox">自动喂食</label></div>' +
      '<div class="row"><span class="st" id="dsh-petlog2" style="font-size:10px"></span></div>' +
      '<div class="sec">宠物（召唤蛋/变蛋/表演）</div>' +
      '<div class="box" id="dsh-petbox2"><div class="b-hd">宠物状态</div><div class="st" id="dsh-petinfo2">未读取（登录后自动显示）</div></div>' +
      '<div class="row"><button id="dsh-petegg" style="flex:0 0 auto">召唤宠物蛋</button>' +
      '<button class="ghost" id="dsh-petback" style="flex:0 0 auto">变蛋(收回)</button>' +
      '<button class="ghost" id="dsh-petperf" style="flex:0 0 auto">表演</button></div>' +
      '</div>' +
      // 子页3：物品标色（赏金任务材料提示 + 自定义高亮，自拾取页搬入）
      '<div class="sub-page" data-subpage="ap-hl">' +
      '<div class="sec">赏金任务材料提示</div>' +
      '<div class="row"><label class="switch"><input id="dsh-bountyhl" type="checkbox" checked>物品栏中赏金材料金边高亮</label></div>' +
      '<div class="row"><span class="lb" style="min-width:52px">自定义高亮</span><input id="dsh-hlrule" type="text" placeholder="ID[颜色]逗号分隔，如 970[yellow]；回车添加" style="flex:1 1 auto;min-width:0"></div>' +
      '<div class="box"><div class="b-hd">高亮名单 <span class="tag blue" id="dsh-hlcount" style="float:right">0 条</span></div>' +
      '<div id="dsh-hllist" style="font-size:11px;max-height:110px;overflow:auto"><span class="st">空（输入 ID[颜色] 添加，赏金材料默认黄）</span></div></div>' +
      '<div class="log">按赏金任务收集品清单（92 件，V2.6.5 按游戏内导出重建）给物品栏物品槽加金边框+数量变金（V1.8.4：选择器按实测物品栏结构 .item[data-itid] 重写，v0.13.10 探针取证）。仓库/装备槽无 itid 属性，暂不覆盖。</div>' +
      '</div>' +
            '<div class="sub-page" data-subpage="ap-scr">' +
      '<div class="sec">脚本执行（导入 JSON 模板 · 白名单 8 类动作）</div>' +
      '<div class="row"><span class="lb" style="min-width:42px">脚本名</span><input id="dsh-scr-name" type="text" placeholder="如：每日签到" style="flex:1 1 90px"></div>' +
      '<textarea id="dsh-scr-json" rows="4" placeholder="JSON 模板：{\"templateId\":\"daily\",\"version\":1,\"steps\":[{\"action\":\"walk\",\"params\":{\"x\":100,\"y\":80}},{\"action\":\"talk\",\"params\":{\"npc\":\"^_^\"}}]}"></textarea>' +
      '<div class="row"><button id="dsh-scr-imp" style="flex:0 0 auto">导入校验</button>' +
      '<button class="ghost" id="dsh-scr-clear" style="flex:0 0 auto">清空输入</button>' +
      '<span class="st" id="dsh-scr-msg" style="font-size:10px"></span></div>' +
      '<div class="box"><div class="b-hd">已导入脚本 <span class="tag green" id="dsh-scr-count" style="float:right">0</span></div>' +
      '<div id="dsh-scr-list" style="font-size:11px;max-height:110px;overflow:auto"><span class="st">空（粘贴 JSON 后点「导入校验」）</span></div></div>' +
      '<div class="row"><span class="lb" style="min-width:42px">运行</span><span class="st" id="dsh-scr-state" style="font-size:11px">未运行</span>' +
      '<button class="ghost" id="dsh-scr-stop" style="flex:0 0 auto;color:#b91c1c;border-color:#e5b3b3">停止</button></div>' +
      '<div class="log" id="dsh-scr-log" style="font-size:10px;max-height:64px;overflow:auto">模板动作：teleport 传送 / walk 走路 / battleOn 开自动 / battleOff 关自动 / useItem 用物品 / stopMove 停止 / check 读取状态 / talk 对话NPC；判定：arrive 到达 / waitFor 界面文本 / until 物品数量；HP<25% 自动停手。</div>' +
      '</div>' +
            '<div class="sub-page" data-subpage="ap-mvp">' +
      '<div class="sec">MVP 计时（公告栏 #i1 → MVP 日志自动校准 · 点击地图名传送）</div>' +
      '<div class="row"><button class="ghost" id="dsh-mvp-open" data-fw="mvp" style="flex:0 0 auto">浮窗</button>' +
      '<span class="st" id="dsh-mvp-status" style="font-size:10px;margin-left:6px">拖动窗口可移动 · 点击地图名传送</span></div>' +
      '<div id="dsh-mvp-timers" style="font-size:11px;max-height:220px;overflow:auto;border:1px solid #43506a;border-radius:6px;padding:6px;margin-top:4px"><span class="st">暂无记录。请打开公告栏#i1 → 第一个选项（MVP日志）。</span></div>' +
      '<div class="log" style="margin-top:4px">打开公告栏的第一个选项（MVP 日志）后自动读取并校准；关闭日志继续计时，刷新保留记录。分钟精度日志只能给出预计复活时间。</div>' +
      '</div>' +
      '</div></div>',
    pickup: '' +
      '<div class="sec">① 百分比拾取（直接联动内挂）</div>' +
      '<div class="row"><span class="lb">拾取机率</span>' +
      '<input id="dsh-lootprob" type="number" value="10" style="flex:0 0 50px"><span style="color:#5a6b7f">%</span>' +
      '<span class="tag blue" id="dsh-lootstate" style="margin-left:auto">内挂未读取</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-openpick" type="checkbox" checked>启用百分比拾取（内挂执行）</label>' +
      '<button class="ghost" id="dsh-lootread" style="flex:0 0 auto">读内挂设置</button>' +
      '<button class="ghost" id="dsh-lootwrite" style="flex:0 0 auto">写回内挂</button></div>' +
      '<div class="log">数值直接读取/写回游戏内挂的拾取设置（#lootProbability + .openpick），拾取由内挂自己跑。</div>' +
      '<div class="sec">② 指定 ID 拾取（怪物掉落树 · 点选物品加入）</div>' +
      '<div class="row"><span class="lb">当前地图</span><span class="st" id="dsh-pickmap" style="flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">—（未进图）</span>' +
      '<button class="ghost" id="dsh-pickmapbtn" style="flex:0 0 auto">📌 本图怪物掉落</button>' +
      '<button class="ghost" id="dsh-maplockbtn" style="flex:0 0 auto">🔒 本图锁定目录</button></div>' +
      '<div class="box"><div class="b-hd">本图可锁定怪物目录（勾选=加入锁定 · 换图自动刷新）</div>' +
      '<div id="dsh-maplock" style="font-size:11px;max-height:150px;overflow:auto"><span class="st">点「🔒 本图锁定目录」读取本图怪物表</span></div></div>' +
      '<div class="row"><input id="dsh-mobsearch" type="text" placeholder="搜索怪物名/ID…（全量图鉴）">' +
      '<button class="ghost" id="dsh-mobsearchbtn" style="flex:0 0 auto">搜索</button>' +
      '<button class="ghost" id="dsh-mobsearchclr" style="flex:0 0 auto">✕ 清空</button></div>' +
      '<div class="row"><input id="dsh-itemsearch" type="text" placeholder="搜索物品名/ID…（搜物品查掉落，或直接「＋加入」指定ID）">' +
      '<button class="ghost" id="dsh-itemsearchadd" style="flex:0 0 auto">＋加入</button>' +
      '<button class="ghost" id="dsh-itemsearchbtn" style="flex:0 0 auto">搜物品</button>' +
      '<button class="ghost" id="dsh-itemsearchclr" style="flex:0 0 auto">✕ 清空</button></div>' +
      '<div id="dsh-itemsearch-res" style="font-size:11px;max-height:150px;overflow:auto"></div>' +
      '<div class="box"><div class="b-hd">当前白名单 <span class="tag green" id="dsh-wlcount" style="float:right">0 个物品ID</span></div>' +
      '<div id="dsh-wllist" style="font-size:11px;max-height:70px;overflow:auto">空</div></div>' +
      '<div id="dsh-drop-tree" style="font-size:11px;max-height:200px;overflow:auto">' +
      '<div class="st">怪物掉落树：点「📌 本图怪物掉落」直接看当前地图怪 → 展开勾选物品加入白名单；也可搜索。</div></div>' +
      '<div class="row"><label class="switch"><input id="dsh-picken" type="checkbox">启用指定ID自动拾取</label><span class="st" id="dsh-pickstate" style="margin-left:auto"></span><span class="st" id="dsh-picklog"></span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-pickwalk" type="checkbox" checked>距离不足自动走过去捡</label></div>' +
      '<div class="row"><label class="switch"><input id="dsh-picksafe" type="checkbox" checked>危险时不走过去捡（Boss/低血/低SP 在场）</label></div>' +
      '<div class="log">怪物=当前地图表联动（同内挂检测目标）+挂机实测自动入列；掉落=mob_db 全量数据零网络。勾选物品→自动加入上方白名单并保存；物品一落地即检测白名单并自动拾取（15格内）。「🔒 本图锁定目录」=读本图怪物表生成锁定列表（勾选进战斗锁定目录，换图自动刷新）。</div>',
    teleport: '' +
      '<div class="sec">内挂书本（自动读取 logsTable · 全部分类）</div>' +
      '<div class="sub-tabs">' +
      '<button class="sub-tab active" data-sub="bk-npc">NPC</button>' +
      '<button class="sub-tab" data-sub="bk-train">练级</button>' +
      '<button class="sub-tab" data-sub="bk-money">打钱</button>' +
      '<button class="sub-tab" data-sub="bk-chg">挑战</button>' +
      '<button class="sub-tab" data-sub="bk-dun">副本</button>' +
      '<button class="sub-tab" data-sub="bk-mvp">BOSS</button></div>' +
      '<div id="dsh-book" style="font-size:11px;max-height:180px;overflow:auto"><div class="st">书本数据读取中…（logsTable 6分类×线路）</div></div>' +
      '<div id="dsh-fw-tp">' +
      '<div class="sec" style="display:flex;align-items:center;gap:6px"><span style="flex:1">世界地图传送 + 坐标走路</span><button class="ghost" id="dsh-fw-btn-tp" data-fw="tp" style="flex:0 0 auto;padding:0 8px;font-size:11px">⧉ 浮窗</button></div>' +
      '<div class="row"><span class="lb">世界</span><select id="dsh-world" style="flex:0 0 100px"><option value="黑暗大陆">黑暗大陆</option><option value="次元大陆">次元大陆</option><option value="局部地图01">局部地图01</option><option value="局部地图02">局部地图02</option></select>' +
      '<button id="dsh-tp" style="flex:0 0 auto">传送</button><span class="st" id="dsh-tpmsg"></span></div>' +
      '<div class="row" style="align-items:center;flex-wrap:wrap;gap:7px 7px"><span class="lb" style="min-width:34px;margin:0">地图</span>' +
      '<div style="position:relative;flex:1 1 150px;min-width:120px"><input id="dsh-map" placeholder="输入地图名/拼音（读地图后联想）" autocomplete="off" style="width:100%;box-sizing:border-box;padding:3px 22px 3px 6px">' +
      '<span id="dsh-maptog" title="展开/收起联想" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;color:#5a6b7f;font-size:11px;user-select:none">▾</span>' +
      '<div id="dsh-maplist" style="display:none;position:absolute;top:calc(100% + 3px);left:0;right:0;z-index:99;background:#fff;border:1px solid #b8c6d4;border-radius:4px;max-height:180px;overflow:auto;box-shadow:0 3px 8px rgba(0,0,0,.18)"></div></div></div>' +
      '<div class="row" style="margin-top:8px;gap:7px"><button class="ghost" id="dsh-mapload" style="flex:0 0 auto">读地图</button><button id="dsh-tp-map" style="flex:0 0 auto">传送</button><button class="ghost" id="dsh-tp-walk" style="flex:0 0 auto">走去</button><span class="st" id="dsh-tpmsg2" style="font-size:11px"></span></div>' +
      '<div class="st" id="dsh-route" style="font-size:11px;margin-top:6px">路线：-</div>' +
      '<div class="sec">坐标走路（指定 xy / 跨图落点）</div>' +
      '<div class="row" style="align-items:center;flex-wrap:wrap;gap:7px"><span class="lb" style="min-width:34px;margin:0">地图</span>' +
      '<input id="dsh-mvmap" type="text" placeholder="地图英文名·留空=当前图" autocomplete="off" style="flex:1 1 140px;min-width:100px;padding:3px 6px">' +
      '<span class="lb" style="min-width:14px;margin:0">X</span><input id="dsh-mvx" type="number" placeholder="x" style="flex:0 0 56px;padding:3px 6px">' +
      '<span class="lb" style="min-width:14px;margin:0">Y</span><input id="dsh-mvy" type="number" placeholder="y" style="flex:0 0 56px;padding:3px 6px"></div>' +
      '<div class="row" style="margin-top:6px;gap:7px"><button class="ghost" id="dsh-mvcur" style="flex:0 0 auto">填入当前位置</button>' +
      '<button id="dsh-mvgo" style="flex:0 0 auto">走路过去</button><button class="ghost" id="dsh-mvstop" style="flex:0 0 auto">停止</button>' +
      '<span class="st" id="dsh-mvlog" style="font-size:11px"></span></div>' +
      '</div>' +
      '<div class="sec">回城清理（半自动）</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:6px"><button id="dsh-tp-town" style="flex:0 0 auto">回城</button><button class="ghost" id="dsh-scan-npc" style="flex:0 0 auto">扫描NPC</button><button class="ghost" id="dsh-go-npc" style="flex:0 0 auto">走到选中</button><button class="ghost" id="dsh-talk-npc" style="flex:0 0 auto">点NPC对话</button><button class="ghost" id="dsh-sell" style="flex:0 0 auto">卖装备</button></div>' +
      '<div class="st" id="dsh-npclist" style="font-size:11px;max-height:96px;overflow:auto">NPC: 未扫描（点「扫描NPC」→ 点条目选中）</div>' +
      '<div class="st" id="dsh-cleanlog" style="font-size:11px">流程日志：-</div>' +
      '<div class="sec">菜单侦察（对话采集）</div>' +
      '<div class="st" style="font-size:11px;color:#7c2d12">走到任务NPC前点「点NPC对话」→ 下方自动抓菜单项与序号（序号=「选第N项」的N，从0起）。</div>' +
      '<div id="dsh-menu-recon" style="font-size:11px;max-height:140px;overflow:auto;background:#f6f8fa;border:1px solid #dfe5ec;border-radius:4px;padding:6px;white-space:pre-wrap">菜单：未捕获（点NPC对话后自动出现）</div>' +
      '<div class="st" id="dsh-menu-status" style="font-size:11px">自动上报：待命</div>' +
      '<div class="row" style="margin-top:6px;gap:6px"><button id="dsh-menu-export" style="flex:0 0 auto">导出JSON</button><button class="ghost" id="dsh-menu-copy" style="flex:0 0 auto">复制</button></div>' +
      '<div class="row" style="margin-top:6px;align-items:center;gap:6px"><span class="lb" style="min-width:0;margin:0">选第</span><input id="dsh-menu-num" type="number" min="0" value="0" style="flex:0 0 48px;padding:3px 6px"><span class="lb" style="margin:0">项</span><button id="dsh-menu-choose" style="flex:0 0 auto">发 CHOOSE_MENU</button><button class="ghost" id="dsh-menu-next" style="flex:0 0 auto">下一段</button></div>',
    system: '' +
      '<div class="row"><span class="lb">数据源</span><span id="dsh-datasrc">检测中…</span></div>' +
      '<div class="row"><span class="lb">角色</span><span id="dsh-chr">未登录</span></div>' +
      '<div class="sec">保活与重连</div>' +
      
      '<div class="row"><label class="switch"><input id="dsh-bgkeep" type="checkbox" checked>后台保活(音频+WebLock)</label><span class="tag blue">切后台保持吃药/打怪/拾取</span></div>' +
      '<div class="row"><label class="switch"><input id="dsh-alert" type="checkbox" checked>掉线提醒</label>' +
      '<label class="switch"><input id="dsh-reconn" type="checkbox" checked>自动重连</label></div>' +
      (IS_MN ? '<div class="box" style="background:rgba(255,235,215,.95);border:1px solid #e08a2a"><div class="b-hd" style="color:#b45309">📱 手机版保活 · 重要设置（必做）</div>' +
        '<div class="row"><span class="st" style="font-size:11px;color:#7c2d12">① 系统设置 → 电池/应用管理 → 找到本浏览器（Kiwi 等）→ 电池优化 → 选 <b>「不限制 / 无限制」</b>（小米/华为等品牌在「应用启动管理」里允许后台活动）。<br>② 否则切后台会被系统杀进程/断网络 → 掉线。</span></div>' +
        '<div class="row"><span class="st" style="font-size:11px;color:#7c2d12">③ 助手已加后台保活：切后台瞬间连发心跳 + 回前台自动补心跳，超 90 秒自动重登。切后台勿超 90 秒；长时间挂机请保持屏幕常亮或分屏。</span></div></div>' : '') +
      '<div class="sec">快速侦查（附近怪物/物品）</div>' +
      '<details style="margin-top:2px"><summary style="cursor:pointer;color:#1259b3;font-size:12px">🕵 点开查看附近目标</summary>' +
      '<div class="st" id="dsh-recon" style="font-size:11px;max-height:110px;overflow:auto">未就绪</div></details>' +
      '<div class="sec">面板</div>' +
      '<div class="row"><span class="lb">状态</span><span id="dsh-status" class="warn">等待启动…</span></div>' +
      '<div class="row"><span class="lb">大小</span><span class="st">右下角 ↘ 拖动手柄可拉伸</span></div>' +
      '<div class="row"><span class="lb">面板快捷键</span><span class="st" id="dsh-hotkey-info" style="min-width:0;word-break:break-all"></span></div>' +
      '<div class="row"><button id="dsh-hotkey-set" style="flex:0 0 auto">设置快捷键</button>' +
      '<button class="ghost" id="dsh-hotkey-clear" style="flex:0 0 auto">清除</button></div>' +
      '<div class="row"><span class="lb">内挂自动战斗键</span><span class="st" id="dsh-hotkey-info-np" style="min-width:0;word-break:break-all"></span></div>' +
      '<div class="row"><button id="dsh-hotkey-set-np" style="flex:0 0 auto">设置快捷键</button>' +
      '<button class="ghost" id="dsh-hotkey-clear-np" style="flex:0 0 auto">清除</button></div>' +
      '<div class="row"><span class="lb">助手自动战斗键</span><span class="st" id="dsh-hotkey-info-z" style="min-width:0;word-break:break-all"></span></div>' +
      '<div class="row"><button id="dsh-hotkey-set-z" style="flex:0 0 auto">设置快捷键</button>' +
      '<button class="ghost" id="dsh-hotkey-clear-z" style="flex:0 0 auto">清除</button></div>' +
      '<div class="log">快捷键均为 Switch 单键切换（每次按下切换一次，不分开/关两键）：面板键=面板收起/展开；内挂自动战斗键=直接 toggle 发包；助手自动战斗键=开始/停止。点击「设置快捷键」后按下组合键（支持 Ctrl/Alt/Shift/Win+键），Esc 取消；相同组合不可重复绑定；未设置时悬浮球/按钮照常工作。</div>'
  };

  // ---------------- 构建面板 ----------------
  var style = $("style");
  style.textContent = PANEL_CSS;
  document.documentElement.appendChild(style);

  var tabsHtml = "";
  var tabDefs = [["nei", "内挂模式"], ["zhu", "助手模式"], ["assist", "辅助"], ["pickup", "拾取"], ["teleport", "传送"], ["system", "系统"]];
  for (var ti = 0; ti < tabDefs.length; ti++) {
    tabsHtml += '<button class="tab' + (ti === 0 ? " active" : "") + '" data-page="' + tabDefs[ti][0] + '">' + tabDefs[ti][1] + '</button>';
  }
  var pagesHtml = "";
  for (var pi = 0; pi < tabDefs.length; pi++) {
    pagesHtml += '<div class="page' + (pi === 0 ? " active" : "") + '" data-page="' + tabDefs[pi][0] + '">' + PAGE_HTML[tabDefs[pi][0]] + '</div>';
  }

  var panel = $("div", "", '<div class="hd"><b>仙境传说 V' + VER + ' · 助手</b><span class="hbtns">' +
    '<span class="st" id="dsh-st" style="color:#cfe0ff;font-size:11px"></span>' +
    '<button class="hbtn" id="dsh-min" title="缩成悬浮球">▁</button>' +
    '<button class="hbtn" id="dsh-popout" title="弹出独立窗口">⧉</button></span></div>' +
    '<div class="tabs">' + tabsHtml + '</div>' +
    // 登录信息折叠框（原登录页取消后迁至面板顶部、橘色信息=角色状态条正上方）
    '<details id="dsh-loginbox" style="margin:6px 8px 0"><summary style="cursor:pointer;color:#b45309;font-size:12px;font-weight:bold;display:flex;align-items:center;gap:8px"><span>🔐 登录 · 展开/收起</span><button id="dsh-recenter" title="面板回中" style="margin-left:auto;flex:0 0 auto;color:#b45309;background:rgba(255,255,255,.55);border:1px solid #d9a441;border-radius:5px;padding:1px 8px;font-size:11px;cursor:pointer;font-weight:600">回中</button></summary>' +
    '<div class="row" style="margin-top:4px"><span class="lb">线路</span><select id="dsh-server" style="flex:0 0 140px">' +
    '<option value="5">V6-Eden 进阶二转</option><option value="3">V6-Online 三转</option></select>' +
    '<span class="st" id="dsh-server-note" style="font-size:10px">版本 ' + version + '</span></div>' +
    '<div class="row"><span class="lb">账号</span><input id="dsh-acc" placeholder="游戏账号" autocomplete="off"></div>' +
    '<div class="row"><span class="lb">密码</span><input id="dsh-pwd" type="password" placeholder="游戏密码" autocomplete="off"></div>' +
    '<div class="row"><button id="dsh-save">保存并自动登录</button><button class="ghost" id="dsh-clear">清除</button><button class="ghost" id="dsh-reboot">重启客户端</button></div>' +
    '<div class="row"><button id="dsh-save-confirm" class="green" style="flex:0 0 auto">🔐 中转确认后登录已保存账号</button></div>' +
    '<div class="row"><span class="st" id="dsh-autolognote" style="font-size:10px">默认不自动登录：先在中转页/登录界面确认（避免挤掉中转会话），确认后点上方按钮登录已保存账号</span></div>' +
    '<div class="row"><button class="green" id="dsh-saveprofile" style="flex:0 0 auto">保存当前角色设置</button>' +
    '<span class="st" id="dsh-proflabel" style="font-size:10px"></span></div>' +
    '<div class="row"><span class="lb">当前账号</span><span class="st" id="dsh-wininfo" style="font-size:10px">读取中…</span></div></details>' +
    '<div class="statbar" id="dsh-statbar" style="display:none">' +
    '<span class="nm">—</span><span class="job">未登录</span><span class="lv">—</span>' +
    '<span class="bar">HP <span class="bg"><span class="hp" style="width:0%"></span></span><span class="bnum">—</span></span>' +
    '<span class="bar">SP <span class="bg"><span class="sp" style="width:0%"></span></span><span class="bnum">—</span></span>' +
    '<span class="warn">负重—</span><span class="zeny">Zeny—</span></div>' +
    // V2.3.1 常驻开始/停止命令条：移到角色状态条正下方（内挂页显内挂开/停，助手页显助手开/停），
    // 关闭设置抽屉后回到主面板即可直接开始/停止，无需再进设置。
    '<div class="dsh-cmdbar" id="dsh-cmdbar" style="flex:none;display:flex;gap:8px;align-items:center;margin:0 8px">' +
    '<button class="green" id="dsh-battleon" style="flex:1;padding:7px 4px">开始</button>' +
    '<button class="red" id="dsh-battleoff" style="flex:1;padding:7px 4px">停止</button>' +
    '<button class="green" id="dsh-z-on" style="flex:1;padding:7px 4px;display:none">开始</button>' +
    '<button class="red" id="dsh-z-off" style="flex:1;padding:7px 4px;display:none">停止</button></div>' +
    '<div class="pages">' + pagesHtml + '</div>' +
    '<div class="status"><span class="dot"></span><span class="st" id="dsh-status2">就绪</span></div>' +
    '<div class="resize-h" id="dsh-resize" title="按住拖动调整面板大小"></div>');
  panel.id = "dsh-ro-panel"; // 关键：CSS 选择器全部基于 #dsh-ro-panel，漏设 id 会导致样式全失效

  // 手机版窄屏适配：宽度 92vw（≤400px 屏宽不溢出），PC 版保持 400px
  var PANEL_LAYOUT =
    (IS_MN ? "position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;width:92vw;max-width:420px;min-width:240px;height:calc(100vh - 12px);min-height:240px;max-height:none;" :
      "position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:2147483647;width:400px;min-width:300px;height:640px;min-height:360px;max-height:92vh;") +
    "background:rgba(244,247,252,.93);border:2px solid #1f9d4d;border-radius:12px;color:#16202c;" +
    "font:13px/1.6 'Microsoft YaHei',system-ui,sans-serif;" +
    "box-shadow:0 0 0 3px rgba(31,157,77,.35),0 10px 32px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;";
  panel.style.cssText = PANEL_LAYOUT;
  var innerStyle = $("style");
  innerStyle.textContent = PANEL_CSS;
  panel.insertBefore(innerStyle, panel.firstChild);
  document.documentElement.appendChild(panel);

  // ---- 赏金任务材料提示（V1.8.4）：物品栏槽 data-itid 命中赏金清单 → 金边+数量变金（纯样式注入，不改图片）----
  // V1.8.1 用 .item.maked[data-itid] 从未生效（物品栏真实结构=<div class="item" data-index data-itid draggable>，v0.13.10 探针 domInv 取证）；
  // V1.8.4 重写为 .item[data-itid]，仓库(.items 无 itid)/装备(仅 data-index)槽暂不覆盖
  var BOUNTY_ITEMS = ['507','508','509','510','511','518','526','608','618','714','719','720','721','723','726','727','729','741','750','751','753','754','7206','7038','1001','733','1004','7027','7026','7035','722','7047','7048','7209','970','7002','922','7014','1097','7015','7016','713','919','921','931','948','950','1038','7114','7113','7211','7023','7022','701','743','1041','730','731','732','934','1020','539','609','604','915','1059','739','1008','1009','971','972','1051','1049','1047','7041','7054','1064','7063','1040','7053','901','1094','1025','1045','941','1034','7108','7020','7036','958','740','742']; // 与 ro-wiki/wiki.html BOUNTY 一致（赏金任务收集品 92 件，按 2026-08-29 玩家导出清单重建，截图 32行×3列-4空格）；V2.6.5 全量重写：删除旧错误 ID（740=傀儡 非蜂蜜、725=缠丝玛瑙 等），按游戏内逐件确认名→ID 替换，含 7002=兽人之牙 与 922=兽人犬齿（Orc Tooth vs Orc's Fang）两件分开、958=亡者牙齿
  // V1.9.4：自定义高亮白名单（防 CSS 注入，白名单外颜色忽略）
  var HL_COLORS = {
    yellow: { c: "#e8b400", r: "232,180,0" },
    red:    { c: "#e04b3a", r: "224,75,58" },
    green:  { c: "#4caf50", r: "76,175,80" },
    blue:   { c: "#4a90e2", r: "74,144,226" },
    purple: { c: "#9c6ade", r: "156,106,222" },
    orange: { c: "#ff8f2b", r: "255,143,43" },
    cyan:   { c: "#2ec4b6", r: "46,196,182" },
    white:  { c: "#f2f3f5", r: "242,243,245" },
    pink:   { c: "#f26d9c", r: "242,109,156" }
  };
  function parseHlRules() {
    var map = {};
    hlRules.forEach(function (r) { map[r.id] = r.color; });
    return map;
  }
  // V1.9.4：高亮规则结构化名单（localStorage dsh_ro_hlrules = [{id,color}]）+ 名单框增删管理
  var hlRules = [];
  function parseHlText(txt) {
    var arr = [];
    var re = /(\d+)\[(\w+)\]/g, mm;
    while ((mm = re.exec(txt || "")) !== null) {
      var col = (mm[2] || "").toLowerCase();
      if (HL_COLORS[col]) arr.push({ id: String(mm[1]), color: col }); // 白名单外忽略
    }
    return arr;
  }
  function loadHlRules() {
    var arr = [];
    try { var raw = localStorage.getItem("dsh_ro_hlrules"); if (raw) { var j = JSON.parse(raw); if (Array.isArray(j)) arr = j; } } catch (e) {}
    try {
      // 旧版文本存档迁移（saved.ui.hlrule "ID[color]," 格式）一次性并入
      if (saved.ui && saved.ui.hlrule) {
        arr = arr.concat(parseHlText(String(saved.ui.hlrule)));
        saved.ui.hlrule = undefined;
        try { saveSaved(saved); } catch (e2) {}
      }
    } catch (e) {}
    var map = {};
    arr.forEach(function (r) { if (r && HL_COLORS[r.color]) map[String(r.id)] = r.color; });
    var out = [];
    for (var k in map) out.push({ id: k, color: map[k] });
    return out;
  }
  function saveHlRules() {
    try { localStorage.setItem("dsh_ro_hlrules", JSON.stringify(hlRules)); } catch (e) {}
    var c = $id("dsh-hlcount"); if (c) c.textContent = hlRules.length + " 条";
  }
  function addHlRulesFromInput() {
    try {
      var el = $id("dsh-hlrule");
      if (!el) return;
      var arr = parseHlText(el.value);
      if (!arr.length) { setStatus("未识别到有效规则：格式 ID[颜色]，颜色限 yellow/red/green/blue/purple/orange/cyan/white/pink", "err"); return; }
      var map = {};
      hlRules.forEach(function (r) { map[r.id] = r.color; });
      arr.forEach(function (r) { map[r.id] = r.color; });
      hlRules = [];
      for (var k in map) hlRules.push({ id: k, color: map[k] });
      el.value = "";
      saveHlRules();
      renderHlList();
      rebuildBountyStyle();
      setStatus("已添加 " + arr.length + " 条高亮规则", "ok");
    } catch (e) {}
  }
  function delHlRule(id) {
    try {
      hlRules = hlRules.filter(function (r) { return String(r.id) !== String(id); });
      saveHlRules();
      renderHlList();
      rebuildBountyStyle();
    } catch (e) {}
  }
  function renderHlList() {
    try {
      var el = $id("dsh-hllist");
      if (!el) return;
      if (!hlRules.length) { el.innerHTML = '<span class="st">空（输入 ID[颜色] 添加，赏金材料默认黄）</span>'; return; }
      var html = "";
      hlRules.forEach(function (r) {
        var def = HL_COLORS[r.color] || HL_COLORS.yellow;
        var nm = getItemNameS(r.id);
        var disp = (nm !== ("ID" + r.id)) ? nm + "(" + r.id + ")" : "ID" + r.id;
        html += '<div class="list-item"><span style="display:inline-block;width:10px;height:10px;background:' + def.c + ';border-radius:2px;margin-right:5px;vertical-align:middle"></span>' +
                '<span>' + disp + '</span><span class="st">[' + r.color + ']</span>' +
                '<button class="ghost" data-hldel="' + r.id + '" style="float:right;padding:0 6px">×</button></div>';
      });
      el.innerHTML = html;
      el.querySelectorAll("[data-hldel]").forEach(function (b) {
        b.addEventListener("click", function () { delHlRule(this.getAttribute("data-hldel")); });
      });
    } catch (e) {}
  }
  function hlCss(id, col) {
    var def = HL_COLORS[col] || HL_COLORS.yellow;
    return '.item[data-itid="' + id + '"]{border-left:3px solid ' + def.c + ' !important;outline:none !important;box-shadow:none !important;}';
  }
  var bountyStyleEl = null;
  function applyBountyStyle(on) {
    try {
      if (on && !bountyStyleEl) {
        bountyStyleEl = $("style");
        bountyStyleEl.id = "dsh-bounty-style";
        var hl = parseHlRules();
        var css = "";
        // 1) 赏金材料默认黄色（被自定义规则覆盖的跳过）
        for (var bIdx = 0; bIdx < BOUNTY_ITEMS.length; bIdx++) {
          var bId = BOUNTY_ITEMS[bIdx];
          if (hl[bId]) continue;
          css += hlCss(bId, "yellow");
        }
        // 2) 自定义规则（任意 ID 可配，含覆盖赏金色/非赏金 ID）
        for (var k in hl) {
          css += hlCss(k, hl[k]);
        }
        bountyStyleEl.textContent = css;
        document.documentElement.appendChild(bountyStyleEl);
      } else if (!on && bountyStyleEl) {
        if (bountyStyleEl.parentNode) bountyStyleEl.parentNode.removeChild(bountyStyleEl);
        bountyStyleEl = null;
      }
    } catch (e) {}
  }
  function rebuildBountyStyle() {
    try {
      if (bountyStyleEl) { bountyStyleEl.parentNode.removeChild(bountyStyleEl); bountyStyleEl = null; }
      var bh = $id("dsh-bountyhl");
      applyBountyStyle(!!(bh && bh.checked));
    } catch (e) {}
  }
  try {
    hlRules = loadHlRules();
    var bhEl = $id("dsh-bountyhl");
    renderHlList();
    applyBountyStyle(!!(bhEl && bhEl.checked));
    if (bhEl) bhEl.addEventListener("change", function () { rebuildBountyStyle(); });
    // 自定义高亮输入：回车/切走即添加进名单并重建样式
    var hlEl = $id("dsh-hlrule");
    if (hlEl) {
      hlEl.addEventListener("change", addHlRulesFromInput);
      hlEl.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); addHlRulesFromInput(); } });
    }
  } catch (e) {}

  // ---- 侧边抽屉（V1.7.0）：战斗页/技能页的 内挂模式/助手模式 配置块滑入右侧抽屉 ----
  try {
    var drawerEl = $("div", "", '<div class="d-hd"><span class="st" id="dsh-drawer-title" style="color:#fff;font-size:12px"></span><button class="ghost" id="dsh-drawer-close" style="margin-left:auto;color:#fff;border:1px solid rgba(255,255,255,.55)">返回</button></div><div class="d-main"><div class="d-body"></div></div>');
    drawerEl.id = "dsh-drawer";
    panel.appendChild(drawerEl);
    var drBody = drawerEl.querySelector(".d-body");
    // 四个模式配置块整体迁入抽屉（常驻 DOM：init 阶段 $id() 事件绑定照常生效，移动节点不丢监听）
    // 块物理存放于内挂/助手页内，此处从面板全局定位（不再依赖所在页）
    var neiEl = panel.querySelector('[data-dname="battle-nei"]');
    var zhuEl = panel.querySelector('[data-dname="battle-zhu"]');
    var npEl = panel.querySelector('[data-dname="skill-np"]');
    var zsEl = panel.querySelector('[data-dname="skill-zhu"]');
    if (neiEl) { neiEl.classList.remove("active"); drBody.appendChild(neiEl); }
    if (zhuEl) { zhuEl.classList.remove("active"); drBody.appendChild(zhuEl); }
    if (npEl) drBody.appendChild(npEl);
    if (zsEl) drBody.appendChild(zsEl);
    var openDrawer = function (name, title) {
      var dr = $id("dsh-drawer"); if (!dr) return;
      var pages = dr.querySelectorAll("[data-dname]");
      for (var di = 0; di < pages.length; di++) {
        pages[di].style.display = pages[di].getAttribute("data-dname") === name ? "block" : "none";
      }
      var tt = $id("dsh-drawer-title"); if (tt) tt.textContent = title || "";
      dr.classList.add("open");
    };
    var closeDrawer = function () { var dr = $id("dsh-drawer"); if (dr) dr.classList.remove("open"); };
    panel.querySelectorAll("[data-drw]").forEach(function (b) {
      b.addEventListener("click", function () {
        openDrawer(b.getAttribute("data-drw"), b.getAttribute("data-title") || "");
      });
    });
    $id("dsh-drawer-close").addEventListener("click", closeDrawer);
  } catch (e) {}

  // 事件隔离层：游戏引擎在 document/window 挂全局鼠标/触摸监听（点地图=走路），
  // 助手 UI 内的点击/拖动/滚动冒泡到 document 会被误判为游戏操作 → 角色乱走。
  // 在面板与悬浮球冒泡阶段 stopPropagation，让助手 UI 成为操作「孤岛」：
  // UI 内事件只作用于 UI，不再冒泡到游戏监听；UI 外操作照常。
  // 注意：必须用冒泡阶段 stopPropagation（捕获阶段会阻断面板内元素事件）。
  var isoEvents = ["mousedown", "mousemove", "mouseup", "click", "dblclick", "wheel", "contextmenu",
    "touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup"];
  function isolateEl(el) {
    if (!el) return;
    for (var ie = 0; ie < isoEvents.length; ie++) {
      el.addEventListener(isoEvents[ie], function (ev) { ev.stopPropagation(); }, false);
    }
  }


  try {

    isolateEl(panel);
    // 悬浮球的隔离在 ball 创建后补挂（见 ball 定义处）——此处 ball 尚未创建
    // document 冒泡兜底：万一有事件类型漏网冒泡到 document，且 target 在助手 UI 内，
    // 立即掐断（防游戏误判；正常情况面板/球的隔离已先拦截，到不了这里）
    for (var ie2 = 0; ie2 < isoEvents.length; ie2++) {
      document.addEventListener(isoEvents[ie2], function (ev) {
        try {
          if (ev.target && ev.target.closest && ev.target.closest("#dsh-ro-panel, #dsh-ball, #dsh-mini")) {
            ev.stopPropagation();
          }
        } catch (e) {}
      }, false);
    }
  } catch (e) {}

  // ---------------- V2.10.0 功能独立透明浮窗（拖动/透明度滑块/×关闭/事件隔离）----------------
  // 用法：fwReg(id, title, getEl) 注册区块；点「⧉ 浮窗」按钮 fwOpen(id) 弹出，浮窗标题栏 × fwClose(id) 收回原位。
  // 实现：移动 DOM 节点（appendChild）而非复制 → id 保留，渲染函数与事件监听全部自动跟随；移动前记录 parentNode+nextSibling，收回时 insertBefore 复原。
  var fwState = {}; // id -> {wrap, title, host, parent, next, open}
  var fwOpenIds = {};
  function fwMakeWin(id, title) {
    try {
      if (fwState[id] && fwState[id].win && fwState[id].win.parentNode) return fwState[id].win;
      var win = document.createElement("div");
      win.id = "dsh-fw-" + id;
      win.style.cssText = "position:fixed;z-index:2147483646;" + (IS_MN ? "width:88vw;max-width:420px;left:50%;transform:translateX(-50%);top:10vh;" : "width:320px;left:calc(50% + 80px);top:120px;") +
        "background:rgba(244,247,252,.92);border:1px solid #1f9d4d;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);" +
        "display:flex;flex-direction:column;overflow:hidden;font:12px/1.6 'Microsoft YaHei',system-ui,sans-serif;color:#16202c;";
      win.setAttribute("data-fw", "1");
      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(31,157,77,.14);cursor:move;user-select:none;flex:none;";
      var tt = document.createElement("span");
      tt.textContent = title || "浮窗";
      tt.style.cssText = "flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      var opLab = document.createElement("span");
      opLab.textContent = "透明";
      opLab.style.cssText = "font-size:10px;color:#5a6b7f;";
      var op = document.createElement("input");
      op.type = "range"; op.min = "30"; op.max = "100"; op.value = "90";
      op.style.cssText = "width:56px;height:14px;";
      op.title = "透明度（30%~100%）";
      var x = document.createElement("button");
      x.textContent = "×";
      x.title = "收回浮窗（回到设置抽屉原位）";
      x.style.cssText = "flex:0 0 auto;width:22px;height:22px;line-height:20px;text-align:center;border:1px solid #d0a8a8;border-radius:5px;background:#fff;color:#b91c1c;cursor:pointer;font-size:14px;padding:0;";
      var body = document.createElement("div");
      body.style.cssText = "overflow:auto;max-height:60vh;padding:4px;";
      op.addEventListener("input", function () { try { win.style.background = "rgba(244,247,252," + (parseInt(op.value, 10) / 100) + ")"; } catch (e) {} });
      x.addEventListener("click", function () { fwClose(id); });
      // 拖动：标题栏 pointerdown → document pointermove/pointerup（浮窗不冒泡到游戏由隔离层保证）
      var drag = null;
      bar.addEventListener("pointerdown", function (ev) {
        try {
          if (ev.target === x || ev.target === op || ev.target === opLab) return;
          drag = { sx: ev.clientX, sy: ev.clientY, lx: win.offsetLeft, ty: win.offsetTop };
          try { ev.preventDefault(); } catch (e) {}
        } catch (e) {}
      });
      document.addEventListener("pointermove", function (ev) {
        try { if (!drag) return; var nx = drag.lx + (ev.clientX - drag.sx), ny = drag.ty + (ev.clientY - drag.sy); win.style.left = nx + "px"; win.style.top = ny + "px"; win.style.transform = "none"; } catch (e) {}
      }, true);
      document.addEventListener("pointerup", function () { drag = null; }, true);
      bar.appendChild(tt); bar.appendChild(opLab); bar.appendChild(op); bar.appendChild(x);
      win.appendChild(bar); win.appendChild(body);
      // 先登记 fwState 再挂载/隔离：任何后续异常都不留下「已挂载未记录」的半成品浮窗（防无限生成）
      if (!fwState[id]) fwState[id] = {};
      fwState[id].win = win; fwState[id].body = body;
      document.documentElement.appendChild(win);
      try { isolateEl(win); } catch (e) {} // 事件隔离：点浮窗不触发游戏移动（失败不致命，下次重试）
      // 记住位置（localStorage dsh_ro_fwpos）
      try {
        var pos = JSON.parse(localStorage.getItem("dsh_ro_fwpos") || "{}");
        if (pos[id]) { win.style.left = pos[id].l + "px"; win.style.top = pos[id].t + "px"; win.style.transform = "none"; }
      } catch (e) {}
      return win;
    } catch (e) { return null; }
  }
  function fwOpen(id) {
    try {
      var st = fwState[id];
      if (!st || !st.host) return;
      var win = fwMakeWin(id, st.title);
      if (!win) return;
      // 记录原位并移动
      if (st.host.parentNode) { st.parent = st.host.parentNode; st.next = st.host.nextSibling; }
      st.body.appendChild(st.host);
      win.style.display = "flex";
      fwOpenIds[id] = true;
      try { var b = document.getElementById("dsh-fw-btn-" + id); if (b) b.textContent = "收回"; } catch (e) {}
      try { localStorage.setItem("dsh_ro_fwpos", JSON.stringify((function () { var m = {}; for (var k in fwState) { var w = fwState[k].win; if (w) m[k] = { l: w.offsetLeft, t: w.offsetTop }; } return m; })())); } catch (e) {}
    } catch (e) {}
  }
  function fwClose(id) {
    try {
      var st = fwState[id];
      if (!st) return;
      if (st.parent && st.host) {
        if (st.next && st.next.parentNode === st.parent) st.parent.insertBefore(st.host, st.next);
        else st.parent.appendChild(st.host);
      }
      var win = st.win;
      if (win) win.style.display = "none";
      fwOpenIds[id] = false;
      try { var b = document.getElementById("dsh-fw-btn-" + id); if (b) b.textContent = "⧉ 浮窗"; } catch (e) {}
    } catch (e) {}
  }
  function fwToggle(id) { try { if (fwOpenIds[id]) fwClose(id); else fwOpen(id); } catch (e) {} }
  // 注册区块：getEl 返回要浮窗化的容器节点（其父容器为原位）
  function fwReg(id, title, getEl) {
    try { if (!fwState[id]) fwState[id] = {}; fwState[id].title = title; fwState[id].getEl = getEl; var el = getEl(); if (el) fwState[id].host = el; } catch (e) {}
  }
  // 面板重建后（host 节点已重挂）重新登记 host
  function fwRefreshHosts() {
    try { for (var id in fwState) { var st = fwState[id]; if (st.getEl) { var el = st.getEl(); if (el && el !== st.host) { st.host = el; if (fwOpenIds[id] && st.win && st.body) { st.body.appendChild(el); } } } } } catch (e) {}
  }

  // 三个可浮窗区块注册（V2.10.0）：本图怪物锁定 / 传送功能 / 助手技能设置
  try {
    fwReg("mlock", "本图怪物锁定", function () { return document.getElementById("dsh-fw-mlock"); });
    fwReg("tp", "传送功能", function () { return document.getElementById("dsh-fw-tp"); });
    fwReg("skill", "助手技能设置", function () { var p = document.getElementById("dsh-ro-panel"); return p ? p.querySelector('[data-dname="skill-zhu"]') : null; });
    setTimeout(function () { try { mvpInit(); } catch (e) {} }, 800); // MVP 计时：面板渲染完成后初始化（内嵌 ap-mvp 子页 + 浮窗注册）
  } catch (e) {}

  // 三个可浮窗区块注册（V2.10.0）：本图怪物锁定 / 传送功能 / 助手技能设置
  try {
    fwReg("mlock", "本图怪物锁定", function () { return document.getElementById("dsh-fw-mlock"); });
    fwReg("tp", "传送功能", function () { return document.getElementById("dsh-fw-tp"); });
    fwReg("skill", "助手技能设置", function () { var p = document.getElementById("dsh-ro-panel"); return p ? p.querySelector('[data-dname="skill-zhu"]') : null; });
    document.addEventListener("click", function (ev) {
      try {
        var b = ev.target && ev.target.closest ? ev.target.closest("[data-fw]") : null;
        if (b) { fwToggle(b.getAttribute("data-fw")); return; }
      } catch (e) {}
    }, false);
  } catch (e) {}


  // 鼠标→触摸模拟层：手机版（r=mn）游戏用 jquery.mobile-events 触摸事件驱动，只认触摸不认鼠标；
  // 外接/蓝牙鼠标的 mousedown 不会变成触摸 → 游戏点不动。此处把「真实鼠标」事件合成为触摸派发到游戏。
  // V2.8.1 严格化（修复：手指点开内挂设置页约 1s 后自动关闭）：
  //   兼容 mouse 事件可能由手指触摸派生（iOS Safari / 部分国产内核的 mousedown 不带 sourceCapabilities），
  //   旧逻辑把这类事件误判为外接鼠标，在刚展开页面的遮罩/空白处二次合成触摸 → 引擎按「点外部关窗」默认逻辑关掉窗口。
  //   现在：优先 PointerEvent，仅 pointerType==="mouse" 才合成；无 PointerEvent 回退 mouse 事件仅 firesTouchEvents===false 合成；
  //   属性缺失一律不合成。touchend 始终派发到「按下时」的原目标并保证无悬空触摸。
  try {
    if (IS_MN) {
      var simTouchId = 1;
      var simActive = null;
      function simFromRealMouse(e) {
        try {
          if (e.pointerType !== undefined) return e.pointerType === "mouse";
          if (e.sourceCapabilities) return e.sourceCapabilities.firesTouchEvents === false;
          return false; // 无 PointerEvent 且无 sourceCapabilities → 无法证明是外接鼠标，一律不合成
        } catch (err) { return false; }
      }
      function simMkTouch(x, y, target) {
        try { return new Touch({ identifier: simTouchId, target: target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y }); }
        catch (e) { return null; }
      }
      function simFire(type, touches, changed, target) {
        try {
          var ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches, targetTouches: touches, changedTouches: changed });
          target.dispatchEvent(ev);
        } catch (e) {}
      }
      function simInUi(t) {
        try { return t && t.closest && t.closest("#dsh-ro-panel, #dsh-ball, #dsh-mini"); } catch (e) { return false; }
      }
      function simDown(e) {
        try {
          if (e.button !== 0 || !simFromRealMouse(e) || simInUi(e.target)) return;
          var t = simMkTouch(e.clientX, e.clientY, e.target);
          if (!t) return;
          simActive = { t: t, target: e.target, pid: e.pointerId || 0 };
          simFire("touchstart", [t], [t], e.target);
        } catch (e2) {}
      }
      function simMove(e) {
        try {
          if (!simActive) return;
          if (e.pointerId !== undefined && e.pointerId !== simActive.pid) return;
          if (!simFromRealMouse(e)) return;
          var t = simMkTouch(e.clientX, e.clientY, simActive.target);
          if (!t) return;
          simActive.t = t;
          simFire("touchmove", [t], [t], simActive.target);
        } catch (e2) {}
      }
      function simUp(e) {
        try {
          if (!simActive) return;
          if (e.pointerId !== undefined && e.pointerId !== simActive.pid) return;
          var t = simActive.t;
          var origin = simActive.target;
          simActive = null;
          // 始终派发到按下时的原目标：即使窗口/页面在光标下刚展开，完成点击也不会投到新窗口遮罩上；
          // 落在助手 UI 上同样补发（保证游戏侧不残留按下的合成触摸）
          try { if (origin && t) simFire("touchend", [], [t], origin); } catch (e3) {}
        } catch (e2) {}
      }
      if (window.PointerEvent) {
        document.addEventListener("pointerdown", simDown, true);
        document.addEventListener("pointermove", simMove, true);
        document.addEventListener("pointerup", simUp, true);
        document.addEventListener("pointercancel", simUp, true);
      } else {
        document.addEventListener("mousedown", simDown, true);
        document.addEventListener("mousemove", simMove, true);
        document.addEventListener("mouseup", simUp, true);
      }
    }
  } catch (e) {}
  // 字体提档兜底：内联 font-size 以 10px/11px 结尾（无分号）的静态元素，统一 +1
  // （CSS 属性选择器只覆盖带分号的；此处正则处理结尾不带分号的）
  try {
    var allStyled = panel.querySelectorAll("[style]");
    for (var si = 0; si < allStyled.length; si++) {
      var stTxt = allStyled[si].getAttribute("style") || "";
      var stTxt2 = stTxt.replace(/font-size:\s*10px/g, "font-size:11px").replace(/font-size:\s*11px/g, "font-size:12px");
      if (stTxt2 !== stTxt) allStyled[si].setAttribute("style", stTxt2);
    }
  } catch (e) {}

  // 悬浮球
  var ball = $("div", "", '<span class="ico">🧙</span><span class="txt">RO</span><span class="dot"></span>');
  ball.id = "dsh-ball";
  ball.title = "点击展开助手面板";
  document.documentElement.appendChild(ball);
  ball.style.display = "none";
  // 悬浮球事件隔离：点球展开面板那一下不能穿透到游戏（防角色误走）
  try { isolateEl(ball); } catch (e) {}

  // ---------------- 页签切换 ----------------
  function switchPage(name) {
    var tabs = panel.querySelectorAll(".tab");
    var pages = panel.querySelectorAll(".page");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-page") === name;
      tabs[i].className = "tab" + (on ? " active" : "");
      pages[i].className = "page" + (on ? " active" : "");
    }
    // 登录页签已移除：角色状态条恒显示（原 login 时隐藏）
    panel.querySelector("#dsh-statbar").style.display = "flex";
    // V2.3.1 常驻开始/停止命令条：内挂页显内挂开/停，助手页显助手开/停，其余页隐藏
    var cb = $id("dsh-cmdbar");
    if (cb) {
      var isNei = name === "nei", isZhu = name === "zhu";
      cb.style.display = (isNei || isZhu) ? "flex" : "none";
      var bo = $id("dsh-battleon"), bf = $id("dsh-battleoff"), zo = $id("dsh-z-on"), zf = $id("dsh-z-off");
      if (bo) bo.style.display = isNei ? "" : "none";
      if (bf) bf.style.display = isNei ? "" : "none";
      if (zo) zo.style.display = isZhu ? "" : "none";
      if (zf) zf.style.display = isZhu ? "" : "none";
    }
    try { if (typeof closeDrawer === "function") closeDrawer(); } catch (e) {}
  }
  panel.querySelector(".tabs").addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(".tab");
    if (t) switchPage(t.getAttribute("data-page"));
  });
  // 子标签切换（战斗/传送页）
  panel.addEventListener("click", function (e) {
    var st = e.target.closest && e.target.closest(".sub-tab");
    if (!st) return;
    var host = st.closest(".page");
    if (!host) return;
    host.querySelectorAll(".sub-tab").forEach(function (t) { t.classList.toggle("active", t === st); });
    host.querySelectorAll(".sub-page").forEach(function (p) { p.classList.toggle("active", p.getAttribute("data-subpage") === st.getAttribute("data-sub")); });
    // 传送页书本按分类重渲染
    if (host.querySelector("#dsh-book")) { try { renderBook(); } catch (e) {} }
  });

  // ---------------- 拖动（标题栏 + 悬浮球 + 拉伸手柄）----------------
  function dragEl(el, onmove) {
    var sx, sy, ox, oy, moving = false, dx0 = 0, dy0 = 0;
    // V2.6.6 移动端防断触：禁掉浏览器对 pointer 的默认手势（滚动/缩放），否则 Kiwi/手机
    // 会把拖动当页面滚动而打断 pointermove（断触）。标题栏/球/手柄三处统一。
    try { el.style.touchAction = "none"; } catch (e) {}
    function onMove(e) {
      if (!moving) return;
      // V2.6.8 防「未按住却跟手」：鼠标未按键仍在移动 = 此前的 pointerup 丢失（如
      // captured 元素被隐藏/捕获隐式释放），立即按松手收尾，杜绝残留监听把悬浮标带着跑
      if (e.pointerType === "mouse" && !(e.buttons & 1)) { onUp(e); return; }
      onmove(ox + e.clientX - sx, oy + e.clientY - sy);
    }
    // move/up/cancel 挂到 window：手指移出元素范围仍持续收到事件，拖动跟手不中断
    function onUp(e) {
      moving = false;
      // V1.7.6：拖动位移 >8px = 拖动（松手不触发球展开），未拖动=单击（照常展开）
      el.__dsDragged = Math.abs(e.clientX - dx0) + Math.abs(e.clientY - dy0) > 8;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture && el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    // V2.6.8 捕获隐式释放兜底：元素被 display:none/移除等会导致 setPointerCapture 隐式释放，
    // 此时浏览器只派发 lostpointercapture、不派发 pointerup/pointercancel → 残留监听未清理、
    // moving 恒 true → 悬浮标/面板「没按住也跟鼠标走」。在此事件统一收尾。
    // V2.6.10 回归修复:lostpointercapture 在正常拖拽中也常被派发(改样式重排/移动端手势取消捕获/
    // 松手 releasePointerCapture),V2.6.8 的无脑清理会把正常拖拽打断(删监听+moving=false)→ 拖不动。
    // 仅当「真的松开且未按住」才收尾;仍按住但捕获被临时取消=保留监听继续拖,由 onMove 未按键自愈收尾
    el.addEventListener("lostpointercapture", function (e) {
      if (!moving) return;         // 正常松手:onUp 已收尾,moving=false,忽略
      if (e.buttons & 1) return;   // 仍按住但捕获被取消:保留监听继续拖
      moving = false;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    });
    el.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return;
      moving = true;
      sx = e.clientX; sy = e.clientY;
      dx0 = e.clientX; dy0 = e.clientY; // V1.7.6 拖动位移起点（>8px 判定为拖动，抑制随后 click）
      // 关键修复：面板初始定位是 left:50% + transform:translateX(-50%)（居中），
      // offsetLeft 返回布局坐标（居中值）而非实际渲染坐标，直接用它当拖动起点
      // 会在第一次 move 时把面板「吸」到视口中央。改用 getBoundingClientRect 取
      // 实际渲染位置并固化到 left/top（摊平 transform/right/bottom），拖动跟手不跳位。
      var r = el.getBoundingClientRect();
      el.style.transform = "none";
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      ox = r.left; oy = r.top;
      try { if (e.cancelable) e.preventDefault(); } catch (err) {}
      try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (err) {}
      // 挂到元素本身（配合 setPointerCapture 持续收事件）——隔离层文档级阻断冒泡，window 收不到
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }
  dragEl(panel.querySelector(".hd"), function (x, y) {
    panel.style.left = x + "px"; panel.style.top = y + "px";
    panel.style.transform = "none";
    try { localStorage.setItem("dsh_panel_pos", JSON.stringify([x, y])); } catch (e) {}
  });
  dragEl(ball, function (x, y) {
    ball.style.left = x + "px"; ball.style.top = y + "px";
    ball.style.right = "auto"; ball.style.bottom = "auto";
    try { localStorage.setItem("dsh_ball_pos", JSON.stringify([x, y])); } catch (e) {}
  });
  (function () {
    var rh = panel.querySelector("#dsh-resize");
    if (IS_MN && rh) rh.style.display = "none"; // 手机版铺满视口，隐藏手动缩放手柄
    var resizing = false, rsx, rsy, row, roh;
    rh.addEventListener("pointerdown", function (e) {
      resizing = true; rsx = e.clientX; rsy = e.clientY;
      row = panel.offsetWidth; roh = panel.offsetHeight;
      rh.setPointerCapture && rh.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    rh.addEventListener("pointermove", function (e) {
      if (!resizing) return;
      var w = Math.min(Math.max(row + e.clientX - rsx, 300), window.innerWidth - 40);
      var h = Math.min(Math.max(roh + e.clientY - rsy, 360), window.innerHeight - 40);
      panel.style.width = w + "px"; panel.style.height = h + "px";
      panel.style.transform = "none";
      try { localStorage.setItem("dsh_panel_size", JSON.stringify([w, h])); } catch (err) {}
    });
    rh.addEventListener("pointerup", function () { resizing = false; });
    rh.addEventListener("pointercancel", function () { resizing = false; });
  })();

  // 面板回中：复位默认居中（PC 400×640 top:60 水平居中 / 手机铺满视口），清掉记忆的位置/大小
  function recenterPanel() {
    try {
      if (IS_MN) {
        panel.style.left = "50%"; panel.style.top = "6px"; panel.style.transform = "translateX(-50%)";
        panel.style.width = "92vw"; panel.style.maxWidth = "420px"; panel.style.height = "calc(100vh - 12px)";
        panel.style.minHeight = "240px"; panel.style.maxHeight = "none";
      } else {
        panel.style.left = "50%"; panel.style.top = "60px"; panel.style.transform = "translateX(-50%)";
        panel.style.width = "400px"; panel.style.minWidth = "300px"; panel.style.height = "640px";
        panel.style.minHeight = "360px"; panel.style.maxHeight = "92vh";
      }
      panel.style.right = "auto"; panel.style.bottom = "auto";
      localStorage.removeItem("dsh_panel_pos");
      localStorage.removeItem("dsh_panel_size");
      var st = panel.querySelector("#dsh-status2");
      if (st) { st.textContent = "面板已回中"; setTimeout(function () { st.textContent = "就绪"; }, 1500); }
    } catch (e) {}
  }
  (function () {
    var rcBtn = panel.querySelector("#dsh-recenter");
    if (!rcBtn) return;
    rcBtn.addEventListener("click", function (e) {
      try { e.stopPropagation(); e.preventDefault(); } catch (err) {}
      recenterPanel();
    });
    rcBtn.addEventListener("pointerdown", function (e) { try { e.stopPropagation(); } catch (err) {} });
  })();

  // 展开/收起
  function applyCollapse(c) {
    try {
      if (c) { panel.style.display = "none"; ball.style.display = "flex"; }
      else { panel.style.display = "flex"; ball.style.display = "none"; }
    } catch (e) {}
  }
  panel.querySelector("#dsh-min").addEventListener("click", function () {
    saved.collapsed = true; saveSaved(saved); applyCollapse(true);
  });
  ball.addEventListener("click", function () {
    if (ball.style.display === "none") return;
    if (ball.__dsDragged) { ball.__dsDragged = false; return; } // V1.7.6 拖动松手不弹面板
    saved.collapsed = false; saveSaved(saved); applyCollapse(false);
  });
  if (saved.collapsed) applyCollapse(true);

  // ---------------- 快捷键（V2.8.0 三组 · Switch 单键切换）：面板收起 / 内挂自动战斗 / 助手自动战斗 ----------------
  // 捕获态 hkTarget：null|panel|np|zhu；三组分别存 saved.hotkey / saved.hotkeyNp / saved.hotkeyZhu（面板键向后兼容旧档案）
  var HK_TARGETS = {
    panel: { key: "hotkey", label: "面板", info: "dsh-hotkey-info", set: "dsh-hotkey-set", clear: "dsh-hotkey-clear" },
    np: { key: "hotkeyNp", label: "内挂自动战斗", info: "dsh-hotkey-info-np", set: "dsh-hotkey-set-np", clear: "dsh-hotkey-clear-np" },
    zhu: { key: "hotkeyZhu", label: "助手自动战斗", info: "dsh-hotkey-info-z", set: "dsh-hotkey-set-z", clear: "dsh-hotkey-clear-z" }
  };
  var hkTarget = null;
  function hkLabelName(t) { var d = HK_TARGETS[t]; return d ? d.label : t; }
  function hkAction(t) {
    if (t === "panel") hkToggle();
    else if (t === "np") npToggleFight();
    else if (t === "zhu") zToggleFight();
  }
  // 内挂自动战斗快捷键：校准后 toggle 发包一次（无需开面板），本地 npHuntOn 跟随本次按下翻转
  function npToggleFight() {
    try {
      npCalibrate();
      npToggleHunt();
      npHuntOn = !npHuntOn;
      setStatus("内挂自动战斗：快捷键切换（toggle 一次）", "ok");
      tlog("hk np-toggle");
    } catch (e) {}
  }
  // 助手自动战斗快捷键：运行中→停止，否则→开始
  function zToggleFight() {
    try {
      if (zRunning) stopZhu();
      else startZhu();
    } catch (e) {}
  }
  function hkFriendly(code) {
    try {
      if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      var map = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
        Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "空格", Enter: "Enter", Tab: "Tab" };
      if (map[code]) return map[code];
      return code;
    } catch (e) { return code; }
  }
  function hkLabel(h) {
    if (!h || !h.key) return "未设置";
    var mods = [];
    if (h.ctrl) mods.push("Ctrl");
    if (h.alt) mods.push("Alt");
    if (h.shift) mods.push("Shift");
    if (h.meta) mods.push("Win");
    return mods.concat([hkFriendly(h.key)]).join("+");
  }
  function hkIsSame(a, b) {
    return !!(a && b && a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta);
  }
  function hkRender() {
    Object.keys(HK_TARGETS).forEach(function (t) {
      var d = HK_TARGETS[t];
      var infoEl = $id(d.info);
      if (infoEl) infoEl.textContent = hkLabel(saved[d.key]);
      var sb = $id(d.set);
      if (sb) sb.textContent = hkTarget === t ? "请按组合键…（Esc 取消）" : (saved[d.key] && saved[d.key].key ? "重新设置快捷键" : "设置快捷键");
    });
  }
  function hkIsTyping(e) {
    try {
      var el = e.target;
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el.isContentEditable));
    } catch (e2) { return false; }
  }
  function hkToggle() {
    try {
      if (saved.collapsed) { saved.collapsed = false; saveSaved(saved); applyCollapse(false); }
      else { saved.collapsed = true; saveSaved(saved); applyCollapse(true); }
    } catch (e) {}
  }
  document.addEventListener("keydown", function (e) {
    try {
      if (hkTarget) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Esc") { hkTarget = null; hkRender(); setStatus("快捷键设置已取消", "st"); return; }
        if (e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta") return; // 等待组合键完整按下
        if (hkIsTyping(e)) { hkTarget = null; hkRender(); setStatus("快捷键设置已取消（输入框内不响应）", "st"); return; }
        var h = { ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, key: e.code || e.key };
        var dup = null;
        Object.keys(HK_TARGETS).forEach(function (t2) {
          if (t2 === hkTarget) return;
          if (hkIsSame(h, saved[HK_TARGETS[t2].key])) dup = t2;
        });
        if (dup) { hkRender(); setStatus("此组合已用于「" + hkLabelName(dup) + "」，请换一组", "warn"); return; }
        var curT = hkTarget;
        saved[HK_TARGETS[curT].key] = h;
        saveSaved(saved);
        hkTarget = null;
        hkRender();
        setStatus("「" + hkLabelName(curT) + "」快捷键已设为 " + hkLabel(h), "ok");
        return;
      }
      if (hkIsTyping(e)) return; // 打字/输入框聚焦时不响应
      if (e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta") return;
      var keys = Object.keys(HK_TARGETS);
      for (var ki = 0; ki < keys.length; ki++) {
        var t = keys[ki];
        var hh = saved[HK_TARGETS[t].key];
        if (!hh || !hh.key) continue;
        var match = (hh.ctrl === (e.ctrlKey || e.metaKey)) && (hh.alt === !!e.altKey) && (hh.shift === !!e.shiftKey) &&
          ((hh.key === (e.code || e.key)) || (hh.key === e.key));
        if (!match) continue;
        e.preventDefault();
        e.stopPropagation();
        hkAction(t);
        break;
      }
    } catch (e3) {}
  }, true);
  Object.keys(HK_TARGETS).forEach(function (t) {
    var d = HK_TARGETS[t];
    var sb = $id(d.set), cb = $id(d.clear);
    if (sb) sb.addEventListener("click", function () {
      hkTarget = hkTarget === t ? null : t;
      hkRender();
      if (hkTarget === t) setStatus("请在 5 秒内按下「" + hkLabelName(t) + "」快捷键组合（建议带 Ctrl/Alt）…", "ok");
    });
    if (cb) cb.addEventListener("click", function () {
      if (hkTarget === t) hkTarget = null;
      saved[d.key] = null; saveSaved(saved);
      hkRender();
      setStatus("「" + hkLabelName(t) + "」快捷键已清除", "st");
    });
  });
  hkRender();

  // 悬浮球自动靠边：窗口尺寸变化时保持球在视口内（贴边不丢失）
  function snapBallToEdge() {
    try {
      if (ball.style.display === "none") return;
      var r = ball.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var vw = window.innerWidth, vh = window.innerHeight, mar = 10, bw = r.width, bh = r.height;
      if (r.left >= vw - 12) { ball.style.left = (vw - bw - mar) + "px"; ball.style.right = "auto"; }
      if (r.right <= 12) { ball.style.left = mar + "px"; ball.style.right = "auto"; }
      if (r.top >= vh - 12) { ball.style.top = (vh - bh - mar) + "px"; ball.style.bottom = "auto"; }
      if (r.bottom <= 12) { ball.style.top = mar + "px"; ball.style.bottom = "auto"; }
    } catch (e) {}
  }
  try { window.addEventListener("resize", snapBallToEdge); } catch (e) {}
  setInterval(snapBallToEdge, 3000);

  // 恢复位置/大小
  try {
    if (!IS_MN) { // 手机版铺满视口，不恢复 PC 端位置/尺寸（PC 存的 400×640 会在手机上超屏）
      var pp = JSON.parse(localStorage.getItem("dsh_panel_pos"));
      if (pp) { panel.style.left = pp[0] + "px"; panel.style.top = pp[1] + "px"; panel.style.transform = "none"; }
      var ps = JSON.parse(localStorage.getItem("dsh_panel_size"));
      // V2.6.0 防呆加严：宽>480 或高>680 即丢弃记忆（V2.5.0 实测 670×605 恰好在旧阈值 520×760 内被保留、
      // 内容刚好放下/底部截断、滚动条临界消失——把边界收紧，多数"拖大残留"尺寸都会被复位回默认 400×640）。
      if (ps) {
        var vw = window.innerWidth, vh = window.innerHeight;
        var oversize = ps[0] > 480 || ps[1] > 680 || ps[0] < 300 || ps[1] < 360 ||
          (pp && (pp[0] + ps[0] > vw - 12 || pp[1] + ps[1] > vh - 12));
        if (oversize) {
          try { localStorage.removeItem("dsh_panel_size"); } catch (e) {}
          panel.style.width = ""; panel.style.height = ""; // 回退 PANEL_CSS 默认 400×640
          console.log("[RO助手] 忽略异常面板尺寸记忆，已复位 400×640（宽高需在 300-480 / 360-680 且不出屏）");
        } else {
          panel.style.width = ps[0] + "px"; panel.style.height = ps[1] + "px";
        }
      }
    }
  } catch (e) {}

  // 独立窗口（多开/总控演示：复制本面板到弹窗）
  panel.querySelector("#dsh-popout").addEventListener("click", function () {
    try {
      var w = window.open("about:blank", "RO助手独立面板", "width=440,height=740,popup=yes,resizable=yes");
      if (w && w.document) {
        // 干净弹窗：不复制游戏页内联定位，弹窗内按自身视口铺满
        var doc = w.document;
        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RO助手独立面板</title><style>' +
          'html,body{margin:0;padding:0;background:#eef2f8;overflow:hidden}' +
          PANEL_CSS +
          // 弹窗专用定位：!important 压过 panel 内嵌 style（复制进来加载更晚）
          '#dsh-ro-panel{position:fixed!important;top:8px!important;left:8px!important;right:8px!important;bottom:8px!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;max-height:none!important;transform:none!important}' +
          '#dsh-ro-panel .hd .hbtn{user-select:none}' +
          '</style></head><body><div id="dsh-ro-panel">' + panel.innerHTML + '</div>' +
          '<script>' +
          'var P=document.getElementById("dsh-ro-panel");' +
          // 遥控弹窗：初始切到战斗页，显示 statbar
          '(function(){var t=P.querySelector(\'.tab[data-page="nei"]\');if(t)t.click();})();' +
          'P.querySelector(".tabs").addEventListener("click",function(e){var t=e.target.closest&&e.target.closest(".tab");if(!t)return;var nm=t.getAttribute("data-page");' +
          'P.querySelectorAll(".tab").forEach(function(x){x.classList.toggle("active",x===t);});' +
          'P.querySelectorAll(".page").forEach(function(p){p.classList.toggle("active",p.getAttribute("data-page")===nm);});' +
          'var drq=P.querySelector("#dsh-drawer");if(drq)drq.classList.remove("open");' +
          'P.querySelector("#dsh-statbar").style.display="flex";});' +
          'P.addEventListener("click",function(e){var st=e.target.closest&&e.target.closest(".sub-tab");if(!st)return;var host=st.closest(".page");if(!host)return;' +
          'host.querySelectorAll(".sub-tab").forEach(function(t){t.classList.toggle("active",t===st);});' +
          'host.querySelectorAll(".sub-page").forEach(function(p){p.classList.toggle("active",p.getAttribute("data-subpage")===st.getAttribute("data-sub"));});});' +
          'P.querySelectorAll("[data-drw]").forEach(function(b){b.addEventListener("click",function(){var dr4=P.querySelector("#dsh-drawer");if(!dr4)return;var nm4=b.getAttribute("data-drw");dr4.querySelectorAll("[data-dname]").forEach(function(x){x.style.display=x.getAttribute("data-dname")===nm4?"block":"none";});var tt4=dr4.querySelector("#dsh-drawer-title");if(tt4)tt4.textContent=b.getAttribute("data-title")||"";dr4.classList.add("open");});});' +
          'var dc4=P.querySelector("#dsh-drawer-close");if(dc4)dc4.addEventListener("click",function(){var dr5=P.querySelector("#dsh-drawer");if(dr5)dr5.classList.remove("open");});' +
          'P.querySelector("#dsh-min").addEventListener("click",function(){try{window.close();}catch(e){P.style.display="none";}});' +
          '(function(){var hd=P.querySelector(".hd"),mv=false,ox,oy;hd.addEventListener("pointerdown",function(e){if(e.target.closest&&e.target.closest("button"))return;mv=true;P.style.right="auto";P.style.bottom="auto";P.style.transform="none";ox=e.clientX-P.offsetLeft;oy=e.clientY-P.offsetTop;});' +
          'document.addEventListener("pointermove",function(e){if(mv){P.style.left=(e.clientX-ox)+"px";P.style.top=(e.clientY-oy)+"px";}});' +
          'document.addEventListener("pointerup",function(){mv=false;});})();' +
          '(function(){var rh=P.querySelector("#dsh-resize"),rz=false,sx,sy,ow,oh;rh.addEventListener("pointerdown",function(e){rz=true;sx=e.clientX;sy=e.clientY;ow=P.offsetWidth;oh=P.offsetHeight;P.style.right="auto";P.style.bottom="auto";e.stopPropagation();});' +
          'document.addEventListener("pointermove",function(e){if(!rz)return;P.style.width=Math.max(300,ow+e.clientX-sx)+"px";P.style.height=Math.max(360,oh+e.clientY-sy)+"px";P.style.transform="none";});' +
          'document.addEventListener("pointerup",function(){rz=false;});})();' +
          // 遥控：接收主窗口 BroadcastChannel 快照，实时渲染游戏信息
          '(function(){var CH=null;try{CH=new BroadcastChannel("dsh_ro_remote");}catch(e){}' +
          'var st2=document.getElementById("dsh-status2");if(st2)st2.textContent="遥控等待数据…";' +
          'if(CH){CH.onmessage=function(ev){' +
          'var d=ev.data&&ev.data.data;if(!d)return;' +
          'var st2b=document.getElementById("dsh-status2");if(st2b)st2b.textContent=d.online?"遥控已连接 · 实时同步中":"遥控已连接 · 等待登录";' +
          'var wi=document.getElementById("dsh-wininfo");if(wi&&d.winInfo)wi.textContent=d.winInfo;' +
          'var sb=document.getElementById("dsh-statbar");if(sb){' +
          'if(d.stat){var s=d.stat;var nm=sb.querySelector(".nm"),jb=sb.querySelector(".job"),lv=sb.querySelector(".lv");' +
          'if(nm)nm.textContent=s.name;if(jb)jb.textContent=s.job+" · "+(s.map||"");if(lv)lv.textContent="Lv"+s.lv+"/"+s.jlv;' +
          'var hpPct=s.maxhp>0?Math.round(s.hp/s.maxhp*100):0,spPct=s.maxsp>0?Math.round(s.sp/s.maxsp*100):0;' +
          'var hpb=sb.querySelector(".hp"),spb=sb.querySelector(".sp");if(hpb)hpb.style.width=Math.max(0,Math.min(100,hpPct))+"%";if(spb)spb.style.width=Math.max(0,Math.min(100,spPct))+"%";' +
          'var bn=sb.querySelectorAll(".bnum");if(bn[0])bn[0].textContent=(s.hp!=null?s.hp:"?")+"/"+(s.maxhp!=null?s.maxhp:"?");if(bn[1])bn[1].textContent=(s.sp!=null?s.sp:"?")+"/"+(s.maxsp!=null?s.maxsp:"?");' +
          'var wn=sb.querySelector(".warn");if(wn)wn.textContent="负重"+(s.weight!=null?Math.round(s.weight/(s.maxWeight||1)*100)+"%":"—");' +
          'var zy=sb.querySelector(".zeny");if(zy)zy.textContent="Zeny "+(s.zeny!=null?String(s.zeny).replace(/\\B(?=(\\d{3})+(?!\\d))/g,","):"—");' +
          'var chr=document.getElementById("dsh-chr");if(chr)chr.textContent="Lv"+s.lv+" HP "+(s.hp!=null?s.hp:"?")+"/"+(s.maxhp!=null?s.maxhp:"?")+" SP "+(s.sp!=null?s.sp:"?")+"/"+(s.maxsp!=null?s.maxsp:"?")+" ("+((s.map)||"?")+")";' +
          '}else{var nm2=sb.querySelector(".nm"),jb2=sb.querySelector(".job");if(nm2)nm2.textContent="—";if(jb2)jb2.textContent="未登录";}' +
          '}' +
          'var rl=document.getElementById("dsh-scanlist");if(rl&&d.mobs){' +
          'if(!d.mobs.length){rl.innerHTML="附近无怪物";}' +
          'else{var mh="";for(var mi=0;mi<d.mobs.length;mi++){mh+=\'<div class="list-item"><span>\'+d.mobs[mi].name+\'</span><span style="color:#5a6b7f">\'+((d.mobs[mi].mid!=null?"ID"+d.mobs[mi].mid+" ":"")+(d.mobs[mi].dist>=0?d.mobs[mi].dist+"m":""))+\'</span></div>\';}' +
          'rl.innerHTML=mh;}' +
          '}' +
          '};}' +
          '})();' +
          '<\/script></body></html>');
        doc.close();
        // 弹出后收起原游戏页面板（悬浮球可重新展开）
        panel.style.display = "none";
        ball.style.display = "flex";
        saved.collapsed = true;
        try { saveSaved(saved); } catch (e) {}
        // 启动遥控同步通道（主窗口 → 弹窗，BroadcastChannel 每 1s 推送游戏快照）
        startRemoteSync();
        setStatus("独立面板已弹出（遥控同步已开启）", "ok");
      } else { setStatus("弹窗被浏览器拦截——请允许本站弹窗", "err"); }
    } catch (e) { setStatus("弹窗异常: " + e.message, "err"); }
  });

  // ---------------- 状态条 ----------------
  function setStatus(text, cls) {
    var el = $id("dsh-status");
    if (el) { el.textContent = text; el.className = cls || "warn"; }
    var el2 = $id("dsh-status2");
    if (el2) el2.textContent = text;
    var ds = $id("dsh-datasrc");
    if (ds) ds.textContent = useLocalData ? "本地镜像 ✓" : "原站（可能较慢）";
  }

  // ---------------- 角色状态条更新 ----------------
  function renderStatbar() {
    var sb = panel.querySelector("#dsh-statbar");
    if (!sb) return;
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      // V1.7.0：登录后识别角色 → 自动切档并加载上次保存
      if (ent && ent.GID != null && gidInt(ent.GID) && gidInt(ent.GID) !== lastCharGid) { try { onCharChanged(ent); } catch (e) {} }
      if (!ent) { sb.querySelector(".nm").textContent = "—"; sb.querySelector(".job").textContent = "未登录"; return; }
      var life = ent.life || {};
      var name = ent.displayName || ent.name || (ent.character && ent.character.name) || "角色";
      sb.querySelector(".nm").textContent = name;
      sb.querySelector(".job").textContent = getJobName(ent.job || (ent.character && ent.character.job)) + " · " + (ent.map ? ent.map : "");
      // 基础/职业等级：优先客户端 BasicInfo DOM（PAR_CHANGE 实时更新）；fallback 实体字段
      var blvl = null, jlvl = null;
      try {
        var bl = document.querySelector(".blvl_value"), jl = document.querySelector(".jlvl_value");
        if (bl && bl.textContent) blvl = parseInt(bl.textContent, 10);
        if (jl && jl.textContent) jlvl = parseInt(jl.textContent, 10);
      } catch (e1) {}
      if (blvl == null) blvl = ent.clevel || ent.baseLevel || "?";
      if (jlvl == null) jlvl = ent.jlevel || ent.jobLevel || ent.joblv || "?";
      sb.querySelector(".lv").textContent = "Lv" + blvl + "/" + jlvl;
      // HP/SP：客户端 life.hp / life.hp_max（PAR_CHANGE 写入 life），注意字段名 hp_max/sp_max
      var hp = life.hp, maxhp = life.hp_max != null ? life.hp_max : life.maxhp;
      var sp = life.sp, maxsp = life.sp_max != null ? life.sp_max : life.maxsp;
      var hpPct = maxhp > 0 ? Math.round(hp / maxhp * 100) : 0;
      var spPct = maxsp > 0 ? Math.round(sp / maxsp * 100) : 0;
      sb.querySelector(".hp").style.width = Math.max(0, Math.min(100, hpPct)) + "%";
      sb.querySelector(".sp").style.width = Math.max(0, Math.min(100, spPct)) + "%";
      sb.querySelectorAll(".bnum")[0].textContent = (hp != null ? hp : "?") + "/" + (maxhp != null ? maxhp : "?");
      sb.querySelectorAll(".bnum")[1].textContent = (sp != null ? sp : "?") + "/" + (maxsp != null ? maxsp : "?");
      // 负重：客户端 BasicInfo DOM（.weight_value/.weight_total，单位已/10）；fallback 实体字段
      var wt = null, maxwt = null;
      try {
        var wv = document.querySelector(".weight_value"), wvl = document.querySelector(".weight_total");
        if (wv && wv.textContent) wt = parseInt(wv.textContent, 10);
        if (wvl && wvl.textContent) maxwt = parseInt(wvl.textContent, 10);
      } catch (e2) {}
      if (wt == null && ent.weight != null) wt = Math.round(ent.weight / 10);
      if (maxwt == null && (ent.maxWeight || ent.maxweight)) maxwt = Math.round((ent.maxWeight || ent.maxweight) / 10);
      sb.querySelector(".warn").textContent = "负重" + (wt != null ? (wt + "/" + (maxwt != null ? maxwt : "?") + " " + (maxwt > 0 ? Math.round(wt / maxwt * 100) + "%" : "")) : "—");
      // Zeny：SessionStorage.zeny（PAR_CHANGE MONEY 写入）
      var zeny = CLIENT.SS && CLIENT.SS.zeny != null ? CLIENT.SS.zeny : (ent.zeny != null ? ent.zeny : null);
      sb.querySelector(".zeny").textContent = "Zeny " + (zeny != null ? String(zeny).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—");
    } catch (e) {}
  }

  // ---------------- 遥控同步（主窗口 → 弹窗 BroadcastChannel）----------------
  var remoteCh = null, remoteTimer = null;
  function buildRemoteSnapshot() {
    var snap = { t: Date.now(), winInfo: "", account: null, online: false, stat: null, mobs: [] };
    try { var wi = $id("dsh-wininfo"); if (wi) snap.winInfo = wi.textContent; } catch (e) {}
    try {
      if (window.account && window.account !== "undefined") snap.account = window.account;
      else if (state.account) snap.account = state.account;
    } catch (e) {}
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (ent && ent.life) {
        snap.online = true;
        var blvl2 = null, jlvl2 = null, wt2 = null, mwt2 = null;
        try {
          var bl2 = document.querySelector(".blvl_value"), jl2 = document.querySelector(".jlvl_value");
          var wv2 = document.querySelector(".weight_value"), wvl2 = document.querySelector(".weight_total");
          if (bl2 && bl2.textContent) blvl2 = parseInt(bl2.textContent, 10);
          if (jl2 && jl2.textContent) jlvl2 = parseInt(jl2.textContent, 10);
          if (wv2 && wv2.textContent) wt2 = parseInt(wv2.textContent, 10);
          if (wvl2 && wvl2.textContent) mwt2 = parseInt(wvl2.textContent, 10);
        } catch (e5) {}
        snap.stat = {
          name: ent.displayName || ent.name || (ent.character && ent.character.name) || "角色",
          job: getJobName(ent.job || (ent.character && ent.character.job)),
          map: ent.map || "",
          lv: blvl2 != null ? blvl2 : (ent.clevel || ent.baseLevel || "?"),
          jlv: jlvl2 != null ? jlvl2 : (ent.jlevel || ent.jobLevel || ent.joblv || "?"),
          hp: ent.life.hp,
          maxhp: ent.life.hp_max != null ? ent.life.hp_max : ent.life.maxhp,
          sp: ent.life.sp,
          maxsp: ent.life.sp_max != null ? ent.life.sp_max : ent.life.maxsp,
          weight: wt2 != null ? wt2 : (ent.weight != null ? Math.round(ent.weight / 10) : null),
          maxWeight: mwt2 != null ? mwt2 : ((ent.maxWeight || ent.maxweight) ? Math.round((ent.maxWeight || ent.maxweight) / 10) : null),
          zeny: CLIENT.SS.zeny != null ? CLIENT.SS.zeny : ent.zeny
        };
      }
    } catch (e) {}
    try {
      snap.mobs = scanMobs.slice(0, 20).map(function (m) { return { name: m.name, mid: m.mid, dist: m.dist }; });
    } catch (e) {}
    return snap;
  }
  function startRemoteSync() {
    if (remoteTimer) return;
    try { if (!remoteCh) remoteCh = new BroadcastChannel("dsh_ro_remote"); } catch (e) { remoteCh = null; }
    remoteTimer = setInterval(function () {
      if (!remoteCh) return;
      try { remoteCh.postMessage({ cmd: "snapshot", data: buildRemoteSnapshot() }); } catch (e) {}
    }, 1000);
  }

  // ---------------- 当前窗口账号信息（单账号 · saved 为准）----------------
  function getWinAccountInfo() {
    if (saved.account) return { account: saved.account, server: saved.server || DEFAULTS.ClientVer, via: "已保存自动登录" };
    return null;
  }
  function renderWinInfo() {
    var el = $id("dsh-wininfo");
    if (!el) return;
    var info = getWinAccountInfo();
    var login = null;
    try { if (window.account && window.account !== "undefined") login = window.account; } catch (e) {}
    if (!login && state.account) login = state.account;
    var parts = [];
    if (info) parts.push("账号：" + info.account);
    else parts.push("未保存账号（在上方登录框填写）");
    if (info && info.server) parts.push(SERVER_NAMES[info.server] || ("线路" + info.server));
    if (login && (!info || login !== info.account)) parts.push("已登录：" + login);
    // V1.7.0：角色读取为 角色名（ID）
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (ent) {
        var cn = ent.displayName || ent.name || (ent.character && ent.character.name) || "";
        if (cn) parts.push("角色：" + cn + (ent.GID != null ? "（ID" + ent.GID + "）" : ""));
      }
    } catch (e) {}
    el.textContent = parts.join(" · ");
    var pl = $id("dsh-proflabel");
    if (pl) {
      var k = activeProfileKey();
      pl.textContent = "当前档: " + (profiles[k] && profiles[k].name ? profiles[k].name : k) + "（未登录自动存默认档）";
    }
  }
  // ---------------- 诊断事件环（V1.7.1：供探针采集 · 不改任何行为）----------------
  // window.__dshDiag = 最近 80 条助手事件（zhu-start/zhu-stop/np-calibrate/map-change/cast/cast-skip/ask-cast）
  // window.__dshCast = 助手即将发出的 USE_SKILL 标记（探针据此判定「助手指令」而非内挂指令）
  window.__dshDiag = [];
  window.__dshCast = null;
  function dshDiag(ev, obj) {
    try {
      var e = { t: Date.now(), ev: ev };
      if (obj) for (var k in obj) if (obj[k] !== undefined) e[k] = obj[k];
      window.__dshDiag.push(e);
      if (window.__dshDiag.length > 80) window.__dshDiag.splice(0, window.__dshDiag.length - 80);
    } catch (e2) {}
  }
  function dshCastMark(skid, lv, target, src) {
    try { window.__dshCast = { skid: skid, lv: lv, target: target || 0, src: src || "zhu", t: Date.now() }; } catch (e) {}
  }
  var DSH_LEARN_KEY = "dsh_ro_skill_status_v1";
  function dshLearnStatus(stId) { try { var c=window.__dshCast,n=Date.now(); if(!c||n-c.t>2500||!c.skid||c.target)return; var m={}; try{m=JSON.parse(localStorage.getItem(DSH_LEARN_KEY)||"{}");}catch(e){} m[String(c.skid)]=parseInt(stId,10); localStorage.setItem(DSH_LEARN_KEY,JSON.stringify(m)); } catch(e2){} }
  function dshLearnedStatus(skid) { try { var m=JSON.parse(localStorage.getItem(DSH_LEARN_KEY)||"{}"); var v=parseInt(m[String(skid)],10); return isNaN(v)?-1:v; }catch(e){return -1;} }
  function dshCastSkip(skid, why) {
    dshDiag("cast-skip", { skid: skid, why: why });
  }
  // ---------------- 角色档案：加载/保存（V1.7.0）----------------
  // 需要按角色保存的控件清单 [id, 类型]：c=勾选 v=输入/下拉 ta=多行文本
  var PROF_CONTROLS = [
    ["dsh-skillorder", "ta"],
    ["dsh-askint", "v"], ["dsh-asksp", "v"], ["dsh-asken", "c"],
    ["dsh-prereq", "c"], ["dsh-z-attmix", "c"],
    ["dsh-scanen", "c"], ["dsh-scanint", "v"],
    ["dsh-z-ona", "v"], ["dsh-z-grp", "v"], ["dsh-z-grpact", "v"],
    ["dsh-z-flymode", "v"], ["dsh-z-flyauto", "c"], ["dsh-z-flystuck", "c"],
    ["dsh-z-idlefly", "c"], ["dsh-z-idleflysec", "v"], ["dsh-z-bossfly", "c"], ["dsh-z-flyint", "v"],
    ["dsh-z-hpfly", "v"], ["dsh-z-spfly", "v"], ["dsh-z-hpout", "v"], ["dsh-z-keep", "v"],
    ["dsh-z-sit", "c"], ["dsh-z-sithplo", "v"], ["dsh-z-sithphi", "v"], ["dsh-z-sitsplo", "v"], ["dsh-z-sitsphi", "v"],
    ["dsh-z-sitxw", "v"], ["dsh-z-sitback", "c"], ["dsh-z-sitnofight", "c"],
    ["dsh-z-attint", "v"], ["dsh-z-range", "v"], ["dsh-z-pmrange", "v"], ["dsh-z-mgrange", "v"],
    ["dsh-z-switchdelay", "v"], ["dsh-z-walkint", "v"], ["dsh-z-chaseint", "v"], ["dsh-z-huntmode", "v"], ["dsh-z-follow", "c"], ["dsh-z-next", "c"],
    ["dsh-autoskill", "v"], ["dsh-autoskilllv", "v"], ["dsh-autoskillpro", "v"],

    ["dsh-automatic", "v"], ["dsh-touchskill", "v"], ["dsh-touchskillop", "c"],
    ["dsh-qoautoskill", "v"], ["dsh-qoautoskilllv", "v"], ["dsh-autoshadow", "v"],
    ["dsh-searchmode", "v"], ["dsh-distarget", "v"], ["dsh-onlynoattack", "v"],
    ["dsh-ona2", "v"], ["dsh-mobnummin", "v"], ["dsh-mobnummax", "v"],
    ["dsh-flygroup", "c"], ["dsh-flystuck", "c"], ["dsh-bossfly", "c"], ["dsh-flytimer", "v"],
    ["dsh-minhpfly", "v"], ["dsh-minspfly", "v"], ["dsh-minhpout", "v"], ["dsh-keepway", "v"],
    ["dsh-opensit", "c"], ["dsh-sithplo", "v"], ["dsh-sithphi", "v"], ["dsh-sitsplo", "v"], ["dsh-sitsphi", "v"], ["dsh-sitxw", "v"],
    ["dsh-petfeedhp2", "v"], ["dsh-petfeedint2", "v"], ["dsh-peten2", "c"],
    ["dsh-followtarget", "v"], ["dsh-followdist", "v"], ["dsh-followen", "c"],
    ["dsh-pothealhp", "v"], ["dsh-potsp", "v"], ["dsh-poten", "c"],
    ["dsh-itempick", "v"], ["dsh-itemcond", "v"], ["dsh-itemcondval", "v"], ["dsh-itemen", "c"],
    ["dsh-lootprob", "v"], ["dsh-openpick", "c"], ["dsh-picken", "c"], ["dsh-pickwalk", "c"], ["dsh-picksafe", "c"], ["dsh-bountyhl", "c"], ["dsh-bgkeep", "c"]
  ];
  function captureAll() {
    try {
      var ui = {};
      for (var i = 0; i < PROF_CONTROLS.length; i++) {
        var id = PROF_CONTROLS[i][0], tp = PROF_CONTROLS[i][1];
        var el = $id(id); if (!el) continue;
        if (tp === "c") ui[id] = el.checked ? 1 : 0;
        else ui[id] = String(el.value || "");
      }
      saved.ui = ui; saveSaved(saved);
    } catch (e) {}
  }
  function applyProfileUI() {
    try {
      var ui = saved.ui || {};
      for (var k in ui) {
        var el = $id(k); if (!el) continue;
        if (el.type === "checkbox") el.checked = !!ui[k];
        else { try { el.value = String(ui[k] == null ? "" : ui[k]); } catch (e) {} }
      }
      // V1.9.4：高亮规则名单（localStorage dsh_ro_hlrules）随角色档重建样式与列表
      try { rebuildBountyStyle(); renderHlList(); } catch (e) {}
    } catch (e) {}
  }
  // 角色切换 → 切档 + 自动加载上次保存（第8项）
  function onCharChanged(ent) {
    try {
      var nm = ent.displayName || ent.name || "角色";
      var gid = gidInt(ent.GID);
      if (!gid) return;
      var key = (nm + "_" + gid).replace(/[\\\/:"*?<>|]/g, "_");
      if (activeProfileKey() === key && lastCharGid === gid) return;
      try { captureAll(); } catch (e) {} // 旧档先落盘
      setActiveProfile(key);
      ensureProfile(key);
      profiles[key].name = nm; profiles[key].gid = gid;
      saved = loadSaved();
      lockList = profiles[key].lockList || {};
      askList = profiles[key].askList || [];
      applyProfileUI();
      renderWinInfo(); renderLockList(); renderAskList();
      lastCharGid = gid;
      setStatus("已加载角色档 " + nm + "（ID" + gid + "）", "ok");
      tlog("profile-load " + key);
    } catch (e) {}
  }
  $id("dsh-saveprofile").addEventListener("click", function () {
    try { captureAll(); } catch (e) {}
    renderWinInfo();
    setStatus("已保存当前角色设置（档: " + activeProfileKey() + "）", "ok");
  });
  // 自动存储（第2项）：周期 + 切后台 + 关页面前兜底（V2.5.0：后台隐藏时周期自动拉长到 30s，省 CPU；切后台/关页兜底已在下面保留）
  try { setInterval(function () { if (!UI_BG || Date.now() - lastCaptureAt > 30000) { lastCaptureAt = Date.now(); captureAll(); } }, 8000); } catch (e) {}
  try { window.addEventListener("beforeunload", function () { captureAll(); }); } catch (e) {}
  try { document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") captureAll(); }); } catch (e) {}

  // ---------------- 心跳 PING（V2.2.0 删定时防踢心跳；sendPing 仅保留给手机切后台 burst 连发用） ----------------
  function sendPing() {
    try {
      if (!clientReady()) return;
      var p = new CLIENT.PS.CZ.PING();
      p.AID = CLIENT.SS.AID || 0;
      CLIENT.NM.sendPacket(p);
    } catch (e) {}
  }

  // ---------------- 后台保活（V1.8.2）：音频 + Web Lock 双豁免 Chrome 定时器深度节流 ----------------
  // Chrome 后台 >5 分钟把定时器节流到约 1 次/分钟 → 吃药(tickPots)/打怪(zAttack)/拾取(tickItems)停摆。
  // 页面「在发声」或「持有活跃 Web Lock」均满足 Chrome 不节流条件。
  // 音频：60Hz 正弦波 + gain 0.003 ≈ 近无声；须发生在用户手势后（AudioContext 策略），开关 change 本身即手势。
  // Web Lock：navigator.locks 永续 shared 锁（Chrome 87+），无需手势；AbortController 用于取消勾选时释放（Chrome 105+，旧版无 signal 则锁存续至页面关闭，可接受）。
  var bgAc = null, bgOsc = null, bgGain = null, bgLockHeld = false, bgLockCtrl = null, bgEverGesture = false;
  function bgKeepAudioStart() {
    try {
      if (bgAc && bgOsc) { if (bgAc.state === "suspended") { try { bgAc.resume(); } catch (e) {} } return; }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ac = new Ctx();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = 60;
      gain.gain.value = 0.003;
      osc.connect(gain); gain.connect(ac.destination);
      osc.start();
      if (ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
      bgAc = ac; bgOsc = osc; bgGain = gain;
    } catch (e) {}
  }
  function bgKeepAudioStop() {
    try {
      if (bgOsc) { try { bgOsc.stop(); } catch (e) {} bgOsc = null; }
      if (bgAc) { try { bgAc.close(); } catch (e) {} bgAc = null; }
      bgGain = null;
    } catch (e) {}
  }
  function bgKeepLockAcquire() {
    try {
      if (bgLockHeld || !navigator.locks || typeof navigator.locks.request !== "function") return;
      var opts = { mode: "shared" };
      if (window.AbortController) { bgLockCtrl = new AbortController(); opts.signal = bgLockCtrl.signal; }
      navigator.locks.request("dsh-bgkeep", opts, function () { return new Promise(function () {}); })
        .then(function () { bgLockHeld = true; }).catch(function () {});
    } catch (e) {}
  }
  function bgKeepLockRelease() {
    try { if (bgLockCtrl) { bgLockCtrl.abort(); bgLockCtrl = null; } } catch (e) {}
    bgLockHeld = false;
  }
  function bgKeepStart() { try { bgKeepAudioStart(); bgKeepLockAcquire(); } catch (e) {} }
  function bgKeepStop() { try { bgKeepAudioStop(); } catch (e) {} }
  function bgKeepInit() {
    try {
      var el = $id("dsh-bgkeep");
      if (!el) return;
      if (el.checked) {
        // 默认勾选：页面加载无手势 → 挂一次性首次交互，交互后再真正启动音频（锁无需手势，后台补齐）
        var once = function () {
          bgEverGesture = true;
          document.removeEventListener("click", once);
          document.removeEventListener("keydown", once);
          bgKeepStart();
        };
        document.addEventListener("click", once);
        document.addEventListener("keydown", once);
      }
      el.addEventListener("change", function () {
        bgEverGesture = true;
        if (this.checked) bgKeepStart();
        else { bgKeepStop(); bgKeepLockRelease(); }
      });
      document.addEventListener("visibilitychange", function () {
        try {
          var en = $id("dsh-bgkeep") && $id("dsh-bgkeep").checked;
          if (!en) return;
          if (document.hidden) {
            bgKeepLockAcquire();              // 锁无需手势，后台立即可持
            if (bgEverGesture) bgKeepStart(); // 已有手势 → 确保音频在播（幂等 + resume）
          } else {
            bgKeepAudioStop();                // 回前台停音频省电（锁保留，不重复申请）
            bgKeepLockAcquire();              // 兜底确保锁仍在
          }
        } catch (e) {}
      });
      try { window.addEventListener("beforeunload", function () { bgKeepStop(); bgKeepLockRelease(); }); } catch (e) {}
    } catch (e) {}
  }
  bgKeepInit();

  // ---------------- 后台降帧（V2.2.0）：切后台 RAF 压到 ~2fps，回前台恢复，多开省 CPU/GPU 防白屏 ----------------
  // 游戏逻辑靠 WebSocket 发包驱动，requestAnimationFrame 只负责画面渲染；后台挂机不需要 60fps。
  // hook RAF：hidden 时每 500ms 至多执行一次回调（约 2fps），visible 走原速；回调不丢，只稀疏，游戏重调度链不断。
  var frameSaveOrig = null, frameSaveLastT = 0, frameSaveTimer = null;
  function frameSaverInit() {
    try {
      if (!window.requestAnimationFrame) return;
      frameSaveOrig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) {
        return frameSaveOrig(function (ts) {
          if (!document.hidden) { cb(ts); return; }
          var now = Date.now();
          if (now - frameSaveLastT >= 500) { frameSaveLastT = now; cb(ts); return; }
          if (frameSaveTimer) return; // 已有等待中的补帧，避免累积
          frameSaveTimer = setTimeout(function () {
            frameSaveTimer = null;
            frameSaveLastT = Date.now();
            cb(ts);
          }, 500 - (now - frameSaveLastT));
        });
      };
    } catch (e) {}
  }
  frameSaverInit();

  // ---------------- 手机版后台保活 ----------------
  // 手机浏览器切后台会冻结标签页（Page Lifecycle frozen）或把定时器节流到 ≥1 分钟，
  // 心跳在后台完全失效；且 Android 省电策略可能直接断开 WebSocket。服务器 60~90s 无包判定掉线。
  // 对策（仅 IS_MN 启用）：
  //  ① hidden 瞬间同步连发多个 PING，把服务器端「最后活跃」推到切后台那一刻（撑满判定窗口）；
  //  ② visible 回前台立即补 PING；后台超过判定窗口 → 带 ?auto=1 重载，自动重登（不依赖手动点启动）；
  try {
    if (IS_MN) {
      var mnHiddenAt = 0;
      var mnBgBurst = 6; // 切后台瞬间同步连发 PING 数（处理器同步执行，冻结前全部发出）
      document.addEventListener("visibilitychange", function () {
        try {
          if (document.hidden) {
            mnHiddenAt = Date.now();
            // 同步连发：visibilitychange 处理器内事件循环不让出，冻结前包全部到达服务器
            for (var bi = 0; bi < mnBgBurst; bi++) sendPing();
            tlog("mn-hidden burst x" + mnBgBurst);
          } else {
            sendPing(); // 回前台立即补心跳
            var gap = mnHiddenAt ? (Date.now() - mnHiddenAt) : 0;
            tlog("mn-visible gap=" + gap + "ms");
            // 后台超过服务器判定窗口（约 90s）→ 大概率已掉线。
            // 带 ?auto=1 重载：buildConfig 检测到 auto= 才注入 autoLogin → 自动重登，
            // 比 onDisconnect 的 10s 延迟 + 无参 reload（还需手动启动）更可靠。
            if (gap > 90000 && $id("dsh-reconn") && $id("dsh-reconn").checked && saved.account) {
              setStatus("⚠ 切后台超时，自动重连并重登…", "err");
              tlog("mn-visible auto-reload gap=" + gap);
              var autoU = switchServerUrl(pickCv());
              autoU = autoU.replace(/([?&])(run|auto)=/g, "$1auto=");
              if (!/\bauto=/.test(autoU)) autoU += (autoU.indexOf("?") >= 0 ? "&" : "?") + "auto=1";
              location.replace(autoU);
            } else if (gap > 90000) {
              setStatus("⚠ 切后台超过 90 秒，可能已掉线（未开自动重连）", "err");
            }
          }
        } catch (e) {}
      });
    }
  } catch (e) {}

  // ---------------- 多辅助（OpenKore useSelf_skill 语义：whenStatusInactive → 状态没了才补）----------------
  // V1.7.5 方案A：行格式 技能ID:等级[:状态]，如 12:5:加速 / 14:5:BLESSING。
  //   状态段=状态判活键：读 StatusIcons 状态环（服务器 buff 通知），状态不在身上/已过期 → 才施放该技能；
  //   无状态段 → 按原固定间隔全放（兼容旧行）。
  //   V1.7.6 扩展：状态段加 ! 前缀（如 21:5:!中毒）= 反转语义「状态在身才放」，
  //     用于 debuff 场景（中毒/冰冻在身时才自动净化/治疗）；无前缀保持「不在身才放」。
  //   中文别名映射（常用 buff/debuff → 客户端 StatusConst 状态ID）
  var BUFF_STATUS_CN = {
    "加速": "INC_AGI", "加速术": "INC_AGI",
    "赐福": "BLESSING", "天赐": "BLESSING", "天使赐福": "BLESSING",
    "霸体": "ENDURE",
    "加速武器": "ADRENALINE", "速度激发": "ADRENALINE",
    "武器值最大化": "WEAPONPERFECT", "武器增加值": "WEAPONPERFECT",
    "凶砍": "OVERTHRUST",
    "神威": "GLORIA",
    "牺牲祈福": "SUFFRAGIUM", "牺牲": "SUFFRAGIUM",
    "撒水祈福": "ASPERSIO", "撒水": "ASPERSIO",
    "圣母颂歌": "MAGNIFICAT", "圣母": "MAGNIFICAT",
    "霸邪之阵": "KYRIE", "霸邪": "KYRIE",
    "天使之障壁": "ANGELUS", "障壁": "ANGELUS",
    "能量外套": "ENERGYCOAT",
    "灵魂": "SOULLINK",
    "爆气": "EXPLOSIONSPIRITS",
    "钢体": "STEELBODY",
    "集中攻击": "CONCENTRATION", "集中": "CONCENTRATION",
    "心神凝聚": "LKCONCENTRATION", "心神": "LKCONCENTRATION",
    "双手剑加速": "TWOHANDQUICKEN",
    "长矛加速": "SPEARQUICKEN",
    "风之步": "WINDWALK",
    "凫魅超快感": "CHASEWALK", "追猎者疾走": "CHASEWALK"
  };
  // V1.7.6 debuff 中文别名：多辅助 ! 状态段 / 技能条件段通用；
  //   解析走 buffStId（StatusConst 运行时 + SC_ 前缀兜底），不硬编码 rAthena ID 防错
  var BUFF_DEBUFF_CN = {
    "中毒": "POISON", "剧毒": "DPOISON",
    "冰冻": "FREEZE", "石化": "STONE",
    "诅咒": "CURSE", "沉默": "SILENCE",
    "晕眩": "STUN", "眩晕": "STUN",
    "流血": "BLEEDING", "出血": "BLEEDING",
    "失明": "BLIND", "黑暗": "BLIND",
    "睡眠": "SLEEP", "恐惧": "FEAR",
    "着火": "BURNING", "点燃": "BURNING",
    "混乱": "CONFUSION", "发疯": "CONFUSION",
    "缓速": "DECREASEAGI", "减速": "DECREASEAGI", "缓速术": "DECREASEAGI"
  };
  // V2.3.0 状态联想表（Buff/Debuff 中文 => EFST 图标ID，与 status_cn_table.txt 一致）
  // deb:1=负面(在身才放)；供「物品状态输入」与「辅助技能 Debuff 判定」模糊联想
  var STATUS_ID_TABLE = [
    { cn: "霸体", id: 1 }, { cn: "双手剑加速", id: 2 }, { cn: "集中攻击", id: 3 },
    { cn: "天使之障壁", id: 9 }, { cn: "赐福", id: 10 }, { cn: "加速术", id: 12 },
    { cn: "牺牲祈福", id: 16 }, { cn: "撒水祈福", id: 17 }, { cn: "圣之祝福", id: 18 },
    { cn: "霸邪之阵", id: 19 }, { cn: "圣母颂歌", id: 20 }, { cn: "神威", id: 21 },
    { cn: "加速武器", id: 23 }, { cn: "武器值最大化", id: 24 }, { cn: "凶砍", id: 25 },
    { cn: "能量外套", id: 31 }, { cn: "自动防御", id: 58 }, { cn: "反射盾", id: 59 },
    { cn: "长矛加速", id: 68 }, { cn: "爆气", id: 86 }, { cn: "钢体", id: 87 },
    { cn: "力量增幅", id: 98 }, { cn: "敏捷增幅", id: 99 }, { cn: "光环剑", id: 103 },
    { cn: "防御架势", id: 104 }, { cn: "狂暴", id: 107 }, { cn: "圣洁祝福", id: 110 },
    { cn: "涂毒强化", id: 114 }, { cn: "真视", id: 115 }, { cn: "风之步", id: 116 },
    { cn: "手推车加速", id: 118 }, { cn: "经验保护", id: 130 }, { cn: "灵魂链接", id: 149 },
    { cn: "单剑加速", id: 161 }, { cn: "太阳抚慰", id: 169 }, { cn: "月亮抚慰", id: 170 },
    { cn: "星星抚慰", id: 171 }, { cn: "经验提升", id: 172 }, { cn: "防御提升", id: 179 },
    { cn: "再生术", id: 336 }, { cn: "咏唱辨识", id: 355 }, { cn: "灵感", id: 407 },
    { cn: "圣礼", id: 472 }, { cn: "圣洁祝福(强化)", id: 473 }, { cn: "再生之光", id: 580 },
    { cn: "挑衅", id: 0, deb: 1 }, { cn: "泥沼地", id: 8, deb: 1 }, { cn: "减速术", id: 13, deb: 1 },
    { cn: "减速", id: 180, deb: 1 }, { cn: "血污染", id: 124, deb: 1 }, { cn: "关节破坏", id: 125, deb: 1 },
    { cn: "念力冲击", id: 126, deb: 1 }, { cn: "记忆下降", id: 127, deb: 1 }, { cn: "雾墙", id: 128, deb: 1 },
    { cn: "蛛网", id: 129, deb: 1 }, { cn: "咏唱迟缓", id: 282, deb: 1 }, { cn: "致命伤口", id: 286, deb: 1 },
    { cn: "麻痹", id: 343, deb: 1 }, { cn: "毒流血", id: 344, deb: 1 }, { cn: "魔菇中毒", id: 345, deb: 1 },
    { cn: "死亡之痛", id: 346, deb: 1 }, { cn: "高热", id: 347, deb: 1 }, { cn: "遗忘诅咒", id: 348, deb: 1 },
    { cn: "霜雾", id: 351, deb: 1 }, { cn: "恐惧之风", id: 352, deb: 1 }, { cn: "电击", id: 353, deb: 1 },
    { cn: "深渊沼泽", id: 354, deb: 1 }, { cn: "静止", id: 356, deb: 1 }, { cn: "过热", id: 373, deb: 1 },
    { cn: "变形", id: 374, deb: 1 }, { cn: "卸除饰品", id: 421, deb: 1 }, { cn: "深井", id: 422, deb: 1 },
    { cn: "帝国陨落", id: 424, deb: 1 }, { cn: "深眠", id: 435, deb: 1 }, { cn: "寒冷", id: 437, deb: 1 },
    { cn: "阴郁之日", id: 438, deb: 1 }, { cn: "毒云", id: 440, deb: 1 }, { cn: "坐下压倒", id: 449, deb: 1 },
    { cn: "沉没的旋律", id: 452, deb: 1 }, { cn: "SP冻结", id: 458, deb: 1 }, { cn: "胃痛", id: 476, deb: 1 },
    { cn: "麻痹之针", id: 576, deb: 1 }, { cn: "根绊", id: 896, deb: 1 }, { cn: "咬痕", id: 917, deb: 1 },
    { cn: "压迫", id: 1180, deb: 1 }, { cn: "石化", id: 875, deb: 1 }, { cn: "冰冻", id: 876, deb: 1 },
    { cn: "晕眩", id: 877, deb: 1 }, { cn: "睡眠", id: 878, deb: 1 }, { cn: "不死", id: 879, deb: 1 },
    { cn: "着火", id: 881, deb: 1 }, { cn: "禁锢", id: 882, deb: 1 }, { cn: "中毒", id: 883, deb: 1 },
    { cn: "诅咒", id: 884, deb: 1 }, { cn: "沉默", id: 885, deb: 1 }, { cn: "混乱", id: 886, deb: 1 },
    { cn: "失明", id: 887, deb: 1 }, { cn: "流血", id: 889, deb: 1 }, { cn: "剧毒", id: 890, deb: 1 },
    { cn: "恐惧", id: 891, deb: 1 }
  ];
  // V2.3.0 状态模糊联想：输入中文子串/ID 即联想（不必完全一致），选中回填中文名并记 data-sid
  function bindStatusAc(input, listEl) {
    if (!input || !listEl) return;
    function match(kw) {
      kw = String(kw || "").trim().toLowerCase();
      var hits = [];
      for (var i = 0; i < STATUS_ID_TABLE.length; i++) {
        var it = STATUS_ID_TABLE[i];
        if (!kw) { hits.push(it); continue; }
        if (it.cn.toLowerCase().indexOf(kw) >= 0 || String(it.id).indexOf(kw) >= 0) hits.push(it);
        if (hits.length >= 40) break;
      }
      return hits;
    }
    function render() {
      var hits = match(input.value);
      listEl.style.display = "block";
      listEl.innerHTML = "";
      if (!hits.length) { listEl.innerHTML = '<div style="padding:4px 6px;color:#8a97a6;font-size:11px">无匹配</div>'; return; }
      hits.forEach(function (it) {
        var row = document.createElement("div");
        row.textContent = it.cn + " (ID" + it.id + ")" + (it.deb ? "·debuff" : "");
        row.style.cssText = "padding:4px 6px;font-size:11px;cursor:pointer;border-bottom:1px solid #eef2f6";
        row.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        row.addEventListener("click", function () {
          input.value = it.cn;
          try { input.setAttribute("data-sid", it.id); } catch (e) {}
          listEl.style.display = "none";
          try { input.blur(); } catch (e) {} // 选中后失焦，防止 focus 再弹
        });
        listEl.appendChild(row);
      });
    }
    input.addEventListener("focus", function () { if (!(input.getAttribute("data-sid") && input.value.trim())) render(); });
    input.addEventListener("input", render);
    input.addEventListener("blur", function () { listEl.style.display = "none"; });
    document.addEventListener("mousedown", function (ev) {
      if (listEl.style.display === "block" && ev.target !== input && !listEl.contains(ev.target)) listEl.style.display = "none";
    });
    // 触屏：下拉框内 touch 不外泄到游戏层，保留默认滚动（passive）
    ["touchstart", "touchmove", "touchend"].forEach(function (t) {
      listEl.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
  }
  // 状态输入值 → 数字状态ID：数字直返 / 联想表中文精确匹配 / buffStId 别名兜底
  function statusIdOf(val) {
    try {
      val = String(val == null ? "" : val).trim();
      if (!val) return -1;
      if (/^\d+$/.test(val)) return parseInt(val, 10);
      for (var i = 0; i < STATUS_ID_TABLE.length; i++) if (STATUS_ID_TABLE[i].cn === val) return STATUS_ID_TABLE[i].id;
      return buffStId(val);
    } catch (e) { return -1; }
  }
  var buffActive = {}; // V1.7.5 状态判活表：{状态ID: {on:bool, endAt:ms|Infinity, seenAt:ms}}，由 StatusIcons hook 更新
  var dshSIState = "pending"; // StatusIcons hook 状态：pending/ok/no-require/no-mod/no-update/err（诊断用）
  function parseBuffs(txt) {
    var out = [];
    var lines = String(txt || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/#.*$/, "").trim();
      if (!ln) continue;
      var parts = ln.split(":");
      var skid = parseInt(parts[0], 10);
      if (isNaN(skid)) continue;
      var lv = parts[1] !== undefined && parts[1].length ? parseInt(parts[1], 10) : 5;
      if (isNaN(lv)) lv = 5;
      var st = parts[2] !== undefined ? parts.slice(2).join(":").trim() : "";
      var stInv = false; // V1.7.6 ! 前缀 = 状态在身才放（反转语义）
      if (st.charAt(0) === "!") { stInv = true; st = st.substr(1).trim(); }
      if (!st) stInv = false;
      out.push({ skid: skid, lv: lv, st: st, stInv: stInv });
    }
    return out;
  }
  // 状态键 → 客户端状态ID（StatusConst 常量表；支持 数字/英文SC名/中文别名；查不到返回 -1）
  function buffStId(key) {
    try {
      if (!key) return -1;
      if (/^\d+$/.test(key)) return parseInt(key, 10);
      var up = String(key).toUpperCase();
      var cn = BUFF_STATUS_CN[key.toLowerCase()] || BUFF_STATUS_CN[key] ||
        BUFF_DEBUFF_CN[key.toLowerCase()] || BUFF_DEBUFF_CN[key] || "";
      var tryN = cn ? cn.toUpperCase() : up;
      // V2.2.1 修复「仅天使之障壁识别成功」根因：原实现优先查 StatusConst 的 SC_ 序号，
      // 而 buffActive 判活表用的是 StatusIcons.update 传来的 EFST 图标ID，两者不同源 → 绝大多数 buff 判活错位。
      // 改为硬编码 EFST 图标ID 表优先，SC_ 序号仅作未覆盖状态（debuff 等）的兜底。
      var map = {
        "INC_AGI": 12, "BLESSING": 10, "ENDURE": 1, "ADRENALINE": 23, "WEAPONPERFECT": 24,
        "OVERTHRUST": 25, "GLORIA": 21, "SUFFRAGIUM": 16, "ASPERSIO": 17, "MAGNIFICAT": 20,
        "KYRIE": 19, "ANGELUS": 9, "ENERGYCOAT": 31, "SOULLINK": 149, "EXPLOSIONSPIRITS": 86,
        "STEELBODY": 87, "LKCONCENTRATION": 105, "TWOHANDQUICKEN": 2, "SPEARQUICKEN": 68,
        "WINDWALK": 116, "CHASEWALK": 119, "MAXIMIZE": 26, "AUTOGUARD": 58, "REFLECTSHIELD": 59,
        "AURABLADE": 103, "BERSERK": 107, "ASSUMPTIO": 110, "EDP": 114, "TRUESIGHT": 115,
        "PARRYING": 104, "CONCENTRATION": 3, "POWERUP": 98, "AGIUP": 99, "STRUP": 145,
        "RIDING": 27, "FALCON": 28, "GOSPEL": 109, "INSPIRATION": 407, "ADORAMUS": 401,
        "RENOVATIO": 336, "ORATIO": 330, "LAUDAAGNUS": 331, "LAUDARAMUS": 332, "EPICLESIS": 329,
        "VENOMIMPRESS": 328, "WEAPONBLOCKING": 337, "ROLLINGCUTTER": 339, "POISONINGWEAPON": 341,
        "CRESCENTELBOW": 419, "RAISINGDRAGON": 410, "GN_CARTBOOST": 461, "CARTBOOST": 118,
        "UNLIMIT": 722, "FRIGG_SONG": 715, "KINGS_GRACE": 723, "MOONLIT_SERENADE": 447,
        "SUN_COMFORT": 169, "MOON_COMFORT": 170, "STAR_COMFORT": 171
      };
      var e = map[cn ? cn.toUpperCase() : up];
      if (e != null) return e;
      // 兜底：客户端 StatusConst（SC_ 序号，与 EFST 不同源，仅硬编码未覆盖的状态才降级查）
      try {
        var SC = window.require && window.require("DB/Status/StatusConst");
        if (SC) {
          if (typeof SC[tryN] === "number") return SC[tryN];
          if (typeof SC["SC_" + tryN] === "number") return SC["SC_" + tryN];
          if (tryN !== up) {
            if (typeof SC[up] === "number") return SC[up];
            if (typeof SC["SC_" + up] === "number") return SC["SC_" + up];
          }
        }
      } catch (e2) {}
      return -1;
    } catch (e) { return -1; }
  }
  // V1.7.5 hook StatusIcons.update：服务器 buff 生效/失效的唯一通知入口，维护 buffActive 判活表
  function hookStatusIcons() {
    try {
      if (window.__dshSIHook) return;
      if (!window.require) { dshSIState = "no-require"; return; }
      var SI = null;
      var cands = ["UI/Components/StatusIcons/StatusIcons", "UI/Components/StatusIcons", "UI/Components/StatusIcons/StatusIcons.js", "UI/Components/StatusIcons.js"];
      for (var ci = 0; ci < cands.length; ci++) {
        try { var m = window.require(cands[ci]); if (m && typeof m.update === "function") { SI = m; break; } } catch (e2) {}
      }
      if (!SI) { dshSIState = "no-mod"; return; }
      var orig = SI.update;
      if (typeof orig !== "function") { dshSIState = "no-update"; return; }
      window.__dshSIHook = true;
      SI.update = function (stId, active, layer, dur) {
        try {
          stId = parseInt(stId, 10);
          if (!isNaN(stId)) {
            var now = Date.now();
            if (active) { dshLearnStatus(stId); buffActive[stId] = { on: true, endAt: dur === 9999 || dur == null ? Infinity : now + (dur || 30000), seenAt: now }; try { for (var qi = 0; qi < askList.length; qi++) { var qs = askList[qi]; if (qs && qs.st && buffStId(qs.st) === stId) qs.missCnt = 0; } } catch (qe) {} }
            else if (buffActive[stId]) { buffActive[stId].on = false; buffActive[stId].endAt = 0; buffActive[stId].seenAt = now; }
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      dshSIState = "ok";
      tlog("statusicons hooked (cand " + (ci || 1) + ")");
    } catch (e) { dshSIState = "err"; }
  }
  // 状态是否判为目标"在身上"：on && (未过期)；对从未见过的状态（无通知）→ 视为不在身上（触发补）
  // 状态是否判为目标"在身上"：优先读客户端实体字段（不依赖 hook），实体字段查不到再回落判活表 buffActive（StatusIcons hook）
  // 实体字段映射：EFST ID → 实体字段判定函数（返回 bool；字段缺失返回 undefined 表示该状态无实体字段，回落判活表）
  var DSH_ENT_STATE = {
    // 字段缺失返回 undefined = 该状态无实体字段，回落判活表；字段存在才返回 true/false
    12: function (en) { if (en.inc_agi !== undefined) return en.inc_agi === 1; if (en.IncAgi !== undefined) return en.IncAgi === 1; if (en.incAgi !== undefined) return en.incAgi === 1; return undefined; },
    10: function (en) { if (en.blessing !== undefined) return en.blessing === 1; if (en.Blessing !== undefined) return en.Blessing === 1; return undefined; },
    1: function (en) { if (en.endure !== undefined) return en.endure === 1; if (en.Endure !== undefined) return en.Endure === 1; return undefined; },
    86: function (en) { if (en.explosion !== undefined) return en.explosion === 1; return undefined; },
    87: function (en) { if (en.SteelBody !== undefined) return en.SteelBody === 1; if (en.steelbody !== undefined) return en.steelbody === 1; if (en.steel_body !== undefined) return en.steel_body === 1; return undefined; },
    149: function (en) { if (en.soullink !== undefined) return en.soullink === 1; return undefined; },
    107: function (en) { if (en.berserk !== undefined) return en.berserk === 1; return undefined; },
    27: function (en) { if (en.riding !== undefined) return en.riding === 1; if (en.riding_ !== undefined) return en.riding_ === 1; return undefined; },
    28: function (en) { if (en.falcon !== undefined) return en.falcon === 1; return undefined; },
    4: function (en) { if (en.isHide !== undefined) return en.isHide === true; if (en.hiding !== undefined) return en.hiding === 1; return undefined; },
    5: function (en) { if (en.isHide !== undefined) return en.isHide === true; if (en.hiding !== undefined) return en.hiding === 1; return undefined; }
  };
  function buffStateOn(stId) {
    try {
      stId = parseInt(stId, 10);
      // 1) 实体字段优先（引擎 Entity 实时字段，权威）
      var f = DSH_ENT_STATE[stId];
      if (f) {
        var en = CLIENT.SS && CLIENT.SS.Entity;
        if (en) { var v = f(en); if (v !== undefined) return v === true || v === 1; }
      }
      // 2) 回落判活表（StatusIcons hook 维护；hook 未挂/无通知时表为空 → 视为不在身，触发补）
      var st = buffActive[stId];
      if (!st) return false;
      if (!st.on) return false;
      if (st.endAt <= Date.now()) return false;
      return true;
    } catch (e) { return false; }
  }
  // V1.7.7 状态速查弹层按钮：多辅助区「状态速查」→ 打开全屏速查表（可选中复制）
  var stateHelpBtn = $id("dsh-statehelp");
  if (stateHelpBtn) {
    stateHelpBtn.addEventListener("click", function (e) {
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (err) {} }
      openStatePop();
      setStatus("状态名速查已展开（可选中复制）", "ok");
    });
  }
  // V1.7.7 技能框回车换行：挡住 Enter 冒泡到游戏层（游戏监听 Enter 会抢焦点切聊天框），
  //   保留 textarea 原生换行；中文输入法选字确认回车（isComposing/229）放行
  function dshTaEnterGuard(ta) {
    if (!ta) return;
    var kd = function (e) {
      try {
        if (e.key === "Enter" || e.keyCode === 13) {
          if (e.isComposing || e.keyCode === 229) return;
          e.stopPropagation(); // 不 preventDefault：textarea 原生插入换行
        }
      } catch (err) {}
    };
    var kp = function (e) {
      try {
        if (e.key === "Enter" || e.keyCode === 13) {
          if (e.isComposing || e.keyCode === 229) return;
          e.stopPropagation();
        }
      } catch (err) {}
    };
    var ku = function (e) {
      try {
        if (e.key === "Enter" || e.keyCode === 13) {
          if (e.isComposing || e.keyCode === 229) return;
          e.stopPropagation();
        }
      } catch (err) {}
    };
    ta.addEventListener("keydown", kd, true);
    if (ta.addEventListener) { try { ta.addEventListener("keypress", kp, true); } catch (err) {} }
    if (ta.addEventListener) { try { ta.addEventListener("keyup", ku, true); } catch (err) {} }
  }
  dshTaEnterGuard($id("dsh-skillorder")); // 技能顺序 textarea
  

  // ---------------- 宠物（喂食/变蛋/表演/召唤蛋 · C阶段完整版）----------------
  var petFeedTimer = null, petLastFeed = 0, petLastRender = 0;
  // 宠物实体 objecttype=7（客户端 Entity TYPE_PET=7 实证）
  function getPetEntity() {
    try {
      if (!window.require) return null;
      var EM = window.require("Renderer/EntityManager");
      var pet = null;
      if (EM && typeof EM.forEach === "function") {
        EM.forEach(function (e) {
          if (pet) return;
          if (e && e.objecttype === 7) pet = e; // TYPE_PET
        });
      }
      return pet;
    } catch (e) { return null; }
  }
  function getPetInfo() {
    try {
      if (!CLIENT.SS) return null;
      var petId = CLIENT.SS.petId;
      var p = CLIENT.SS.pet || {};
      // 兜底1：SS 里 petId/pet 没写全（PROPERTY_PET 与 CHANGESTATE 到达顺序不定）→ 直接扫宠物实体
      // 客户端实证：宠物实体 objecttype=7；实体 life.hp=饱食度(0~100)、life.hp_max=100；display.name=宠物名
      if ((!petId || !p.name) && CLIENT.SS.Entity) {
        var pe = getPetEntity();
        if (pe) {
          if (!petId) { petId = pe.GID; try { CLIENT.SS.petId = petId; } catch (e) {} }
          if (!p.name) p.name = (pe.display && pe.display.name) || pe.displayName || pe.name;
          if (!p.job && pe.job != null) p.job = pe.job;
          if (!p.clevel && pe.clevel != null) p.clevel = pe.clevel;
          if (p.hungry == null && pe.life && pe.life.hp != null) p.hungry = pe.life.hp;
          if (p.friendly == null && pe.life && pe.life.friendly != null) p.friendly = pe.life.friendly;
          try { CLIENT.SS.pet = p; } catch (e) {}
        }
      }
      if (!petId) return null;
      return { id: petId, hungry: p.hungry, oldHungry: p.oldHungry, friendly: p.friendly, name: p.name, job: p.job, clevel: p.clevel };
    } catch (e) { return null; }
  }
  function hungryText(h) {
    if (h == null) return "?";
    if (h < 10) return "饥饿(" + h + ")";
    if (h < 25) return "饿(" + h + ")";
    if (h < 75) return "满足(" + h + ")";
    if (h < 90) return "足够(" + h + ")";
    return "吃饱(" + h + ")";
  }
  function renderPetInfo() {
    var p = getPetInfo();
    var txt = !p ? "未召唤宠物（登录后自动显示）" : ((p.name || "宠物") + (p.job != null ? " (job" + p.job + ")" : "") + " · 饱食度 " + hungryText(p.hungry) + " · " + (p.friendly != null ? ("亲密度 " + p.friendly + "/1000") : "亲密度 ?"));
    var el = $id("dsh-petinfo");
    if (el) el.textContent = txt;
    var el2 = $id("dsh-petinfo2");
    if (el2) el2.textContent = txt;
  }
  // 宠物指令：1=喂食 2=表演 3=变蛋(收回) 4=卸装备（客户端真实机制=COMMAND_PET）
  function petCmd(cSub, logName) {
    try {
      if (!clientReady()) { petLog("客户端未就绪"); return false; }
      var p = new CLIENT.PS.CZ.COMMAND_PET();
      p.cSub = cSub;
      CLIENT.NM.sendPacket(p);
      if (cSub === 1) petLastFeed = Date.now();
      tlog("pet-cmd cSub=" + cSub);
      return true;
    } catch (e) { petLog("宠物指令异常: " + e.message); return false; }
  }
  function petFeedNow(manual) {
    var p = getPetInfo();
    if (!p) { petLog("无宠物"); return false; }
    if (petCmd(1)) {
      if (manual) setStatus("已向宠物发送喂食指令", "ok");
      return true;
    }
    return false;
  }
  function petLog(msg) { var el = $id("dsh-petlog"); if (el) el.textContent = msg; var el2 = $id("dsh-petlog2"); if (el2) el2.textContent = msg; }
  function tickPetFeed() {
    try {
      var en = ($id("dsh-peten") && $id("dsh-peten").checked) || ($id("dsh-peten2") && $id("dsh-peten2").checked);
      var now = Date.now();
      // 每 2s 刷新状态显示
      if (now - petLastRender > 2000) { petLastRender = now; renderPetInfo(); }
      if (!en) return;
      if (!clientReady()) return;
      var p = getPetInfo();
      if (!p) { petLog("无宠物，跳过"); return; }
      var thr = parseInt(($id("dsh-petfeedhp") || $id("dsh-petfeedhp2")).value, 10) || 25;
      var intv = (parseInt(($id("dsh-petfeedint") || $id("dsh-petfeedint2")).value, 10) || 10) * 1000;
      if (p.hungry != null && p.hungry < thr && now - petLastFeed >= intv) {
        if (petFeedNow(false)) petLog("饱食度 " + p.hungry + "<" + thr + "，已喂食");
      }
    } catch (e) {}
  }
  // 兼容旧辅助页宠物区块（已迁移到宠物/道具页；元素存在才绑定）
  if ($id("dsh-petfeednow")) $id("dsh-petfeednow").addEventListener("click", function () { petFeedNow(true); });
  if ($id("dsh-peten")) $id("dsh-peten").addEventListener("change", function () {
    saved.petFeed = this.checked; saveSaved(saved);
    if (this.checked) { if (!petFeedTimer) petFeedTimer = setInterval(tickPetFeed, 1000); tickPetFeed(); petLog("自动喂食已启用"); }
    else { if (petFeedTimer) { clearInterval(petFeedTimer); petFeedTimer = null; } petLog("自动喂食已停"); }
  });
  if (saved.petFeed && $id("dsh-peten")) { $id("dsh-peten").checked = true; if (!petFeedTimer) petFeedTimer = setInterval(tickPetFeed, 1000); }

  // ---------------- 宠物/职业道具页按钮（C阶段）----------------
  // 召唤宠物蛋：SELECT_PETEGG（背包宠物蛋 index）
  function findPetEgg() {
    try {
      var inv = findInventory();
      if (!inv) return null;
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i] || {};
        var itid = it.ITID != null ? it.ITID : (it.itemid != null ? it.itemid : null);
        if (itid == null) continue;
        var info = null;
        try { info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(itid); } catch (e) {}
        var nm = (info && (info.identifiedDiSPlayName || info.name)) || "";
        if (/宠物蛋|蛋|egg/i.test(nm) || (info && info.Type === 7)) return { index: it.index != null ? it.index : i, itid: itid, name: nm };
      }
      return null;
    } catch (e) { return null; }
  }
  $id("dsh-petegg").addEventListener("click", function () {
    try {
      if (!clientReady()) { setStatus("客户端未就绪", "err"); return; }
      var egg = findPetEgg();
      if (!egg) { setStatus("背包未找到宠物蛋", "err"); return; }
      var p = new CLIENT.PS.CZ.SELECT_PETEGG();
      p.index = egg.index;
      CLIENT.NM.sendPacket(p);
      setStatus("已召唤宠物蛋 " + (egg.name || egg.itid), "ok");
      tlog("pet-egg idx=" + egg.index);
    } catch (e) { setStatus("召唤异常: " + e.message, "err"); }
  });
  $id("dsh-petback").addEventListener("click", function () {
    if (petCmd(3)) setStatus("宠物已变蛋（收回）", "ok");
  });
  $id("dsh-petperf").addEventListener("click", function () {
    if (petCmd(2)) setStatus("宠物表演指令已发送", "ok");
  });
  $id("dsh-petfeed2").addEventListener("click", function () { petFeedNow(true); });
  $id("dsh-peten2").addEventListener("change", function () {
    saved.petFeed = this.checked; saveSaved(saved);
    if (this.checked) { if (!petFeedTimer) petFeedTimer = setInterval(tickPetFeed, 1000); tickPetFeed(); petLog("自动喂食已启用"); }
    else { if (petFeedTimer) { clearInterval(petFeedTimer); petFeedTimer = null; } petLog("自动喂食已停"); }
  });
  if (saved.petFeed && $id("dsh-peten2")) { $id("dsh-peten2").checked = true; }

  // 主循环里也顺带刷新宠物状态（不进辅助页也能看到）
  var petTicker = setInterval(function () {
    try {
      if (clientReady() && $id("dsh-petinfo")) {
        var now2 = Date.now();
        // V2.5.0：渲染本体门控（后台隐藏跳过），喂食逻辑保留
        if (!UI_BG && now2 - petLastRender > 2000) { petLastRender = now2; try { renderPetInfo(); } catch (e) {} }
        var en2 = ($id("dsh-peten") && $id("dsh-peten").checked) || ($id("dsh-peten2") && $id("dsh-peten2").checked);
        if (en2 && !petFeedTimer) petFeedTimer = setInterval(tickPetFeed, 1000);
      }
    } catch (e) {}
  }, 3000);

  // ---------------- B1：辅助对象 · 自动跟随玩家 ----------------
  // 机制：读取目标玩家坐标 → 轮询 REQUEST_MOVE 靠近 → 距离 ≤ 设定值自动停（纯侦测，不走 shift+右键/内挂）
  var followTargetGID = null, followLastMove = 0, followListCache = [];
  function followLog(msg) { var el = $id("dsh-followlog"); if (el) el.textContent = msg; }
  function scanPlayers() {
    // 枚举附近玩家（objecttype=0=PC），排除自己
    var sel = $id("dsh-followtarget");
    if (!sel) return;
    var list = [];
    try {
      if (!window.require) return;
      var EM = window.require("Renderer/EntityManager");
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      var myGID = ent && ent.GID;
      EM.forEach(function (e) {
        if (e.objecttype !== 0) return;
        if (e.GID === myGID) return;
        var nm = (e.display && e.display.name) || e.displayName || e.name;
        if (!nm) return;
        list.push({ GID: e.GID, name: nm });
      });
    } catch (e) {}
    followListCache = list;
    var cur = sel.value;
    var html = '<option value="">选择玩家…（' + list.length + '人）</option>';
    for (var i = 0; i < list.length; i++) {
      html += '<option value="' + list[i].GID + '"' + (String(list[i].GID) === cur ? " selected" : "") + '>' + list[i].name + '</option>';
    }
    sel.innerHTML = html;
    followLog("侦测到 " + list.length + " 名玩家");
  }
  function getFollowTarget() {
    try {
      if (!window.require || !CLIENT.SS) return null;
      var EM = window.require("Renderer/EntityManager");
      var target = null;
      EM.forEach(function (e) {
        if (e.objecttype !== 0) return;
        if (String(e.GID) === String(followTargetGID)) target = e;
      });
      return target;
    } catch (e) { return null; }
  }
  function tickFollow() {
    try {
      var en = $id("dsh-followen") && $id("dsh-followen").checked;
      if (!en) return;
      if (moveXY && moveXY.busy) return; // 手动坐标走路中 → 跟随让位
      if (!clientReady()) return;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) return;
      var tg = getFollowTarget();
      if (!tg) { followLog("目标玩家不在附近（消失/换图）"); followTargetGID = null; return; }
      if (!tg.position) return;
      var now = Date.now();
      var dist = parseInt($id("dsh-followdist").value, 10) || 3;
      var d = Math.abs(tg.position[0] - ent.position[0]) + Math.abs(tg.position[1] - ent.position[1]);
      if (d <= dist) {
        followLog("已在跟随距离内（" + d + "≤" + dist + "），停止移动");
        return; // 距离达标自动停
      }
      if (now - followLastMove < 1000) return; // 1s 节流
      followLastMove = now;
      // 用 A* 避障走向目标
      var r = pathFindTo(tg.position[0], tg.position[1]);
      if (!r) { followLog("目标不可达（避障失败）"); return; }
      var pm = new CLIENT.PS.CZ.REQUEST_MOVE();
      pm.dest = [r.x, r.y];
      CLIENT.NM.sendPacket(pm);
      followLog("跟随中… 距离 " + d + " 格（目标 " + ((tg.display && tg.display.name) || tg.name || tg.GID) + "）");
    } catch (e) {}
  }
  $id("dsh-followscan").addEventListener("click", function () { scanPlayers(); });
  $id("dsh-followtarget").addEventListener("change", function () {
    followTargetGID = this.value ? this.value : null;
    followLog(followTargetGID ? "跟随目标已设为 GID " + followTargetGID : "已清除跟随目标");
  });
  $id("dsh-followen").addEventListener("change", function () {
    saved.followEn = this.checked; saveSaved(saved);
    if (this.checked && !followTargetGID) { setStatus("请先选择跟随目标玩家", "err"); this.checked = false; return; }
    followLog(this.checked ? "自动跟随已启用" : "自动跟随已停");
    setStatus(this.checked ? "自动跟随已启用" : "自动跟随已停", "ok");
  });
  if (saved.followEn) { $id("dsh-followen").checked = true; }
  // V2.5.0 性能：合并 5 根 1s 功能 tick → 单根 masterTick（减定时器数量）；后台隐藏时跳过纯 UI 渲染（降 CPU/垃圾回收）
  var UI_BG = false; try { UI_BG = document.hidden; } catch (e) {}
  try { document.addEventListener("visibilitychange", function () { UI_BG = document.hidden; }); } catch (e) {}
  var masterTicks = [];
  var lastCaptureAt = 0;
  function masterTickReg(fn) { masterTicks.push(fn); }
  setInterval(function () { for (var i = 0; i < masterTicks.length; i++) { try { masterTicks[i](); } catch (e) {} } }, 1000);
  masterTickReg(function () { try { tickFollow(); } catch (e) {} });
  setTimeout(scanPlayers, 3000);

  // ---------------- B2：自动吃药（背包红/蓝药 + HP/SP 阈值）----------------
  var potLastUse = 0;
  function potLog(msg) { var el = $id("dsh-potlog"); if (el) el.textContent = msg; }
  function findPotion(isHeal) {
    // 读背包，找 红色药水(HP) 或 蓝色药水/圣水(SP)，按名字匹配
    try {
      var inv = findInventory();
      if (!inv) return null;
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i] || {};
        var itid = it.ITID != null ? it.ITID : (it.itemid != null ? it.itemid : null);
        if (itid == null) continue;
        var info = null;
        try { info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(itid); } catch (e) {}
        var nm = (info && (info.identifiedDiSPlayName || info.name)) || "";
        if (isHeal && /红色药水|红水|红色魔力药水|红草|药草/.test(nm)) return { index: it.index != null ? it.index : i, itid: itid, name: nm };
        if (!isHeal && /蓝色药水|蓝水|蓝色魔力药水|圣水/.test(nm)) return { index: it.index != null ? it.index : i, itid: itid, name: nm };
      }
      return null;
    } catch (e) { return null; }
  }
  function tickPots() {
    try {
      var en = $id("dsh-poten") && $id("dsh-poten").checked;
      if (!en) return;
      if (!clientReady()) return;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.life) return;
      var now = Date.now();
      if (now - potLastUse < 3000) return; // 3s 防连喝
      var life = ent.life;
      var hpPct = life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
      var spPct = life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
      var hpThr = parseInt($id("dsh-pothealhp").value, 10) || 40;
      var spThr = parseInt($id("dsh-potsp").value, 10) || 30;
      if (hpPct < hpThr) {
        var hp = findPotion(true);
        if (hp) { useItemByIndex(hp.index); potLastUse = now; potNoPotion = false; potLog("HP" + Math.round(hpPct) + "%<" + hpThr + "% 已喝 " + hp.name); return; }
        potLog("HP" + Math.round(hpPct) + "%<" + hpThr + "% 但无红药"); potNoPotion = true; return;
      }
      if (spPct < spThr) {
        var sp = findPotion(false);
        if (sp) { useItemByIndex(sp.index); potLastUse = now; potLog("SP" + Math.round(spPct) + "%<" + spThr + "% 已喝 " + sp.name); return; }
        potLog("SP" + Math.round(spPct) + "%<" + spThr + "% 但无蓝药");
      }
    } catch (e) {}
  }
  masterTickReg(function () { try { tickPots(); } catch (e) {} });
  if (saved.potEn) { $id("dsh-poten").checked = true; }

  // ---------------- B4：自动使用物品（点选背包 + 调序 + 条件触发）----------------
  var itemList = (function () { try { return JSON.parse(localStorage.getItem("dsh_ro_itemlist")) || []; } catch (e) { return []; } })();
  var itemPickIdx = -1;
  function saveItemList() { try { localStorage.setItem("dsh_ro_itemlist", JSON.stringify(itemList)); } catch (e) {} renderItemList(); }
  function itemCondText(it) {
    var s = { manual: "手动", hp: "HP<" + it.condval + "%", sp: "SP<" + it.condval + "%", interval: "每" + it.condval + "s", status: "状态在身用" + (it.st ? "·" + it.st : ""), statusgone: "状态消失用" + (it.st ? "·" + it.st : "") }[it.cond] || it.cond;
    return s;
  }
  function renderItemList() {
    var el = $id("dsh-itemlist");
    if (!el) return;
    $id("dsh-itemcount").textContent = itemList.length + " 项";
    if (!itemList.length) { el.innerHTML = '<span class="st">空（选物品加入，可拖拽调序）</span>'; return; }
    var html = "";
    for (var i = 0; i < itemList.length; i++) {
      var it = itemList[i];
      html += '<div class="list-item drag-item' + (i === itemPickIdx ? ' active' : '') + '" data-item-i="' + i + '" data-drag-i="' + i + '" draggable="true" style="cursor:grab" title="拖动调整顺序"><span class="dh">⠿</span><span>' + (i + 1) + '. ' + (it.name || ("ID" + it.itid)) + ' ×' + (it.count != null ? it.count : "?") + '</span>' +
        '<span style="color:#5a6b7f;font-size:10px">' + itemCondText(it) + (it.st ? ' ·状态' + it.st : '') + '</span></div>';
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-item-i]").forEach(function (row) {
      row.addEventListener("click", function () {
        itemPickIdx = parseInt(this.getAttribute("data-item-i"), 10);
        var itp = itemList[itemPickIdx];
        if (itp) {
          $id("dsh-itemcond").value = itp.cond || "manual";
          $id("dsh-itemcondval").value = itp.condval != null ? itp.condval : 0;
          if ($id("dsh-itemstatus")) $id("dsh-itemstatus").value = itp.st || "";
        }
        renderItemList();
      });
    });
    enableDragSort(el, function (from, to) {
      var moved = itemList.splice(from, 1)[0];
      itemList.splice(to, 0, moved);
      itemPickIdx = to;
      saveItemList();
      setStatus("物品顺序已调整（第" + (from + 1) + "→第" + (to + 1) + "）", "ok");
    });
  }
  function loadInvItems() {
    var sel = $id("dsh-itempick");
    if (!sel) return;
    var inv = findInventory();
    if (!inv) { setStatus("背包未读取（登录后重试）", "err"); return; }
    var DB = CLIENT.DB || requireDB("DB/DBManager");
    var html = '<option value="">选择物品…</option>';
    var seen = {};
    for (var i = 0; i < inv.length; i++) {
      var it = inv[i] || {};
      var itid = it.ITID != null ? it.ITID : (it.itemid != null ? it.itemid : null);
      if (itid == null || seen[itid]) continue;
      var ityp = it.type != null ? it.type : it.itemType;
      if (ityp != null && ityp !== 0 && ityp !== 2 && ityp !== 11) continue; // 只列可使用的消耗品（回复0/使用2/延迟11），剔装备4/防具5/卡片6/宠物/材料
      seen[itid] = true;
      var info = null;
      try { info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(itid); } catch (e) {}
      var nm = (info && (info.identifiedDiSPlayName || info.name)) || ("ID" + itid);
      html += '<option value="' + itid + '">' + nm + ' (ID' + itid + ')</option>';
    }
    sel.innerHTML = html;
    setStatus("已读取背包 " + Object.keys(seen).length + " 种物品", "ok");
  }
  $id("dsh-itempickload").addEventListener("click", loadInvItems);
  bindStatusAc($id("dsh-itemstatus"), $id("dsh-itemstatus-ac"));
  (function () {
    var icSel = $id("dsh-itemcond"), isIn = $id("dsh-itemstatus");
    if (!icSel || !isIn) return;
    function updateItemStatusHint() {
      var need = icSel.value === "status" || icSel.value === "statusgone";
      isIn.style.borderColor = need ? "#e6a23c" : "";
      isIn.style.background = need ? "#fff7e6" : "";
      isIn.placeholder = need ? (icSel.value === "status" ? "填状态：在身才用（如中毒ID）" : "填状态：消失才用（如加速ID）") : "状态中文/ID";
    }
    icSel.addEventListener("change", updateItemStatusHint);
    updateItemStatusHint();
  })();
  $id("dsh-itempickadd").addEventListener("click", function () {
    var sel = $id("dsh-itempick");
    var itid = sel.value;
    if (!itid) { setStatus("先选择物品", "err"); return; }
    var inv = findInventory();
    var found = null;
    for (var i = 0; i < (inv ? inv.length : 0); i++) {
      var it = inv[i] || {};
      if (it.ITID === parseInt(itid, 10) || it.itemid === parseInt(itid, 10)) { found = { index: it.index != null ? it.index : i, itid: parseInt(itid, 10) }; break; }
    }
    var DB = CLIENT.DB || requireDB("DB/DBManager");
    var info = null;
    try { info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(parseInt(itid, 10)); } catch (e) {}
    var nm = (info && (info.identifiedDiSPlayName || info.name)) || ("ID" + itid);
    var cond = $id("dsh-itemcond").value;
    var condval = parseFloat($id("dsh-itemcondval").value) || 0;
    var _isid = $id("dsh-itemstatus") ? statusIdOf($id("dsh-itemstatus").value) : -1;
    var ist = _isid >= 0 ? _isid : "";
    itemList.push({ itid: parseInt(itid, 10), index: found ? found.index : -1, name: nm, cond: cond, condval: condval, st: ist, stInv: cond === "status" });
    saveItemList();
    setStatus("已加入物品 " + nm + "（" + itemCondText({ cond: cond, condval: condval, st: ist }) + "）", "ok");
  });
  $id("dsh-itemup").addEventListener("click", function () {
    if (itemPickIdx > 0) { var t = itemList[itemPickIdx]; itemList[itemPickIdx] = itemList[itemPickIdx - 1]; itemList[itemPickIdx - 1] = t; itemPickIdx--; saveItemList(); }
  });
  $id("dsh-itemdown").addEventListener("click", function () {
    if (itemPickIdx >= 0 && itemPickIdx < itemList.length - 1) { var t2 = itemList[itemPickIdx]; itemList[itemPickIdx] = itemList[itemPickIdx + 1]; itemList[itemPickIdx + 1] = t2; itemPickIdx++; saveItemList(); }
  });
  $id("dsh-itemdel").addEventListener("click", function () {
    if (itemPickIdx >= 0) { itemList.splice(itemPickIdx, 1); itemPickIdx = -1; saveItemList(); }
  });
  $id("dsh-itemupd").addEventListener("click", function () {
    if (itemPickIdx < 0) { setStatus("先点选列表里的物品", "err"); return; }
    var itp = itemList[itemPickIdx];
    if (!itp) return;
    itp.cond = $id("dsh-itemcond").value;
    itp.condval = parseFloat($id("dsh-itemcondval").value) || 0;
    var _isid2 = $id("dsh-itemstatus") ? statusIdOf($id("dsh-itemstatus").value) : -1;
    itp.st = _isid2 >= 0 ? _isid2 : "";
    itp.stInv = itp.cond === "status";
    saveItemList();
    setStatus("已更新 " + (itp.name || ("ID" + itp.itid)) + " " + itemCondText(itp), "ok");
  });
  $id("dsh-itemen").addEventListener("change", function () { saved.itemEn = this.checked; saveSaved(saved); if (this.checked) hookStatusIcons(); });
  function tickItems() {
    try {
      var en = $id("dsh-itemen") && $id("dsh-itemen").checked;
      if (!en || !itemList.length) return;
      if (!clientReady()) return;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.life) return;
      var now = Date.now();
      var life = ent.life;
      var hpPct = life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
      var spPct = life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
      for (var i = 0; i < itemList.length; i++) {
        var it = itemList[i];
        var fire = false;
        if (it.cond === "hp" && hpPct < it.condval) fire = true;
        else if (it.cond === "sp" && spPct < it.condval) fire = true;
        else if (it.cond === "interval" && now - (it.last || 0) >= (it.condval * 1000)) fire = true;
        else if (it.cond === "status" || it.cond === "statusgone") {
          // 状态识别：status=状态在身才用(debuff 净化·中毒解毒)；statusgone=状态消失才用(buff 补)。5s 冷却防狂喝。
          if (it.st && now - (it.last || 0) >= 5000) {
            var istId = buffStId(it.st);
            if (istId >= 0) {
              var istOn = buffStateOn(istId);
              fire = (it.cond === "status") ? istOn : !istOn;
            }
          }
        }
        if (!fire) continue;
        // 重新找背包 index（可能已变动）
        var inv = findInventory();
        var idx = it.index;
        if (inv) {
          for (var k = 0; k < inv.length; k++) {
            var ik = inv[k] || {};
            if (ik.ITID === it.itid || ik.itemid === it.itid) { idx = ik.index != null ? ik.index : k; break; }
          }
        }
        if (idx < 0) continue;
        useItemByIndex(idx);
        it.last = now;
        return; // 每轮只用一项
      }
    } catch (e) {}
  }
  masterTickReg(function () { try { tickItems(); } catch (e) {} });
  if (saved.itemEn) { $id("dsh-itemen").checked = true; hookStatusIcons(); }
  renderItemList();

  // ---------------- B5：自动使用技能（点选技能栏主动辅助 · 调序）----------------
  var askList = (function () {
    try { ensureProfilesInit(); var k = activeProfileKey(); return (profiles[k] && profiles[k].askList) || []; } catch (e) { return []; }
  })();
  var askPickIdx = -1;
  function saveAskList() {
    try { var k = activeProfileKey(); ensureProfile(k); profiles[k].askList = askList; profiles[k].lastAt = Date.now(); saveProfiles(); } catch (e) {}
    renderAskList();
  }
  function renderAskList() {
    var el = $id("dsh-asklist");
    if (!el) return;
    $id("dsh-askcount").textContent = askList.length + " 项";
    if (!askList.length) { el.innerHTML = '<span class="st">空（点选技能加入，可拖拽调序）</span>'; return; }
    var html = "";
    for (var i = 0; i < askList.length; i++) {
      var s = askList[i];
      html += '<div class="list-item drag-item' + (i === askPickIdx ? ' active' : '') + '" data-ask-i="' + i + '" data-drag-i="' + i + '" draggable="true" style="cursor:grab" title="拖动调整顺序"><span class="dh">⠿</span><span>' + (i + 1) + '. ' + (s.name || ("技能" + s.skid)) + ' Lv' + s.lv + '</span>' + (s.st ? '<span class="tag blue" style="margin-left:4px">' + (s.stInv ? "在身补" : "消失补") + (/^\d+$/.test(String(s.st)) ? "·状态" + s.st : "") + '</span>' : '<span class="tag gray" style="margin-left:4px;color:#8a97a6">按间隔放（未识别状态）</span>') + '</div>';
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-ask-i]").forEach(function (row) {
      row.addEventListener("click", function () { askPickIdx = parseInt(this.getAttribute("data-ask-i"), 10); renderAskList(); });
    });
    enableDragSort(el, function (from, to) {
      var moved = askList.splice(from, 1)[0];
      askList.splice(to, 0, moved);
      askPickIdx = to;
      saveAskList();
      setStatus("技能顺序已调整（第" + (from + 1) + "→第" + (to + 1) + "）", "ok");
    });
  }
  function loadAskSkills() {
    var sel = $id("dsh-askskill");
    if (!sel) return;
    var skills = learnedActiveSkills(); // 已学主动技能（含名字）
    var html = '<option value="">选择技能…</option>';
    for (var i = 0; i < skills.length; i++) {
      html += '<option value="' + skills[i].skid + '">' + skills[i].name + ' Lv' + skills[i].lv + ' (ID' + skills[i].skid + ')</option>';
    }
    sel.innerHTML = html;
    setStatus("已读取 " + skills.length + " 个已学主动技能", "ok");
  }
  $id("dsh-askskillload").addEventListener("click", loadAskSkills);
  bindStatusAc($id("dsh-askdebuff"), $id("dsh-askdebuff-ac"));
  bindStatusAc($id("dsh-askstatus"), $id("dsh-askstatus-ac")); // V2.10.5 自身状态输入框联想（内部只认ID/英文，中文仅展示辅助）
  $id("dsh-askskilladd").addEventListener("click", function () {
    var sel = $id("dsh-askskill");
    var skid = parseInt(sel.value, 10);
    if (!skid) { setStatus("先选择技能", "err"); return; }
    if (askList.some(function (x) { return x.skid === skid; })) { setStatus("该技能已在列表", "err"); return; }
    var skills = learnedActiveSkills();
    var found = null;
    for (var i = 0; i < skills.length; i++) if (skills[i].skid === skid) found = skills[i];
    var sname = found ? found.name : getSkillNameById(skid);
    // Debuff 判定：选中某 debuff → 存 debuff 状态 + stInv=true（该 debuff 在身才放，如缓速在身放加速术、诅咒在身放赐福）
    var debuff = $id("dsh-askdebuff") ? $id("dsh-askdebuff").value.trim() : "";
    if (debuff) {
      var debId = statusIdOf(debuff);
      askList.push({ skid: skid, lv: found ? found.lv : 5, name: sname, st: debId >= 0 ? debId : debuff, stInv: true });
      saveAskList();
      setStatus("已加入 " + sname + "（Debuff「" + debuff + "」在身才放" + (debId >= 0 ? "·ID" + debId : "·ID未识别，请从状态速查确认") + "）", debId >= 0 ? "ok" : "warn");
      return;
    }
    // 自动判定条件 → 存数字状态ID（EFST）：判定语句用ID、UI 显示用中文技能名；buffStId 已修复返回 EFST
    var stId = -1;
    var cond = $id("dsh-askcond") ? $id("dsh-askcond").value : "self";
    // V2.10.5 状态识别：内部只认数字ID/英文EFST；中文仅用于交互联想展示。自身状态框优先（消失才补），
    // 填的数字/英文经 statusIdOf 直认；没填才回退旧「技能名→状态」自动识别（兼容旧配置）。
    var selfSt = $id("dsh-askstatus") ? $id("dsh-askstatus").value.trim() : "";
    if (cond === "self" && selfSt) {
      stId = statusIdOf(selfSt);
      if (stId < 0) { setStatus("未识别状态「" + selfSt + "」：请填数字ID或英文EFST（如 12 / INC_AGI），或从联想表点选", "warn"); return; }
    } else if (cond && sname) {
      stId = buffStId(sname); if (stId < 0) { for (var sk in SKILL_STATUS_SRC) { var arr = SKILL_STATUS_SRC[sk]; for (var ai = 0; ai < arr.length; ai++) { if (arr[ai] === skid) { var tryId = buffStId(sk); if (tryId >= 0) { stId = tryId; } break; } } if (stId >= 0) break; } }
    }
    askList.push({ skid: skid, lv: found ? found.lv : 5, name: sname, st: stId >= 0 ? stId : "", stInv: false });
    saveAskList();
    setStatus("已加入 " + sname + (stId >= 0 ? "（自身状态消失才补·ID" + stId + "）" : (cond === "party" ? "（队友判定待支持，暂按间隔）" : "（未识别状态，按间隔放）")), "ok");
  });
  $id("dsh-askup").addEventListener("click", function () {
    if (askPickIdx > 0) { var t = askList[askPickIdx]; askList[askPickIdx] = askList[askPickIdx - 1]; askList[askPickIdx - 1] = t; askPickIdx--; saveAskList(); }
  });
  $id("dsh-askdown").addEventListener("click", function () {
    if (askPickIdx >= 0 && askPickIdx < askList.length - 1) { var t2 = askList[askPickIdx]; askList[askPickIdx] = askList[askPickIdx + 1]; askList[askPickIdx + 1] = t2; askPickIdx++; saveAskList(); }
  });
  $id("dsh-askdel").addEventListener("click", function () {
    if (askPickIdx >= 0) { askList.splice(askPickIdx, 1); askPickIdx = -1; saveAskList(); }
  });
  function tickAskSkills() {
    try {
      var en = $id("dsh-asken") && $id("dsh-asken").checked;
      if (!en || !askList.length) return;
      if (!clientReady()) return;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.life) return;
      var now = Date.now();
      var intv = (parseInt($id("dsh-askint").value, 10) || 120) * 1000;
      var spMax = ent.life.sp_max != null ? ent.life.sp_max : ent.life.maxsp;
      var spPct = spMax > 0 ? (ent.life.sp != null ? ent.life.sp / spMax * 100 : 100) : 100;
      var spGuard = parseInt($id("dsh-asksp").value, 10) || 30;
      if (spPct < spGuard) return;
      // 修「掉 buff 不及时补」：去掉全局 askLastCast 门禁，改每技能独立 lastAt。
      // 状态判活技能 = 状态消失/在身即补（仅 5s 防抖防重复）；无状态技能 = 按全局间隔放。
      var castAny = false;
      for (var i = 0; i < askList.length; i++) {
        var s = askList[i];
        try {
          if (s.st) {
            var stId = buffStId(s.st);
            if (stId < 0) continue; // 状态名未识别，跳过
            var stOn = buffStateOn(stId);
            var need = s.stInv ? stOn : !stOn; // 在身补 / 消失补
            if (!need) { s.missCnt = 0; continue; }
            // 防抖：刚放出去状态未上身不重复；连续 2 次补后仍未上身（hook 未收到/状态实际加不上）→ 退避到全局间隔，避免每 5s 狂补
            var waitMs = s.missCnt >= 2 ? 30000 : 5000; // V2.10.5 退避固定 30s（原 intv 120s 会卡死补状态）；上身通知会清零 missCnt
            if (s.lastAt && now - s.lastAt < waitMs) continue;
          } else {
            if (s.lastAt && now - s.lastAt < intv) continue; // 纯间隔技能
          }
          var p = new CLIENT.PS.CZ.USE_SKILL();
          p.SKID = s.skid;
          p.selectedLevel = s.lv;
          p.targetID = 0; // 对自己/无目标
          dshCastMark(s.skid, s.lv, 0, "ask");
          CLIENT.NM.sendPacket(p);
          s.lastAt = now;
          if (s.st) s.missCnt = (s.missCnt || 0) + 1; // 补了但判活仍缺 → missCnt++（连续2次退避到全局间隔）
          castAny = true;
        } catch (e) {}
      }
      if (castAny) {
        dshDiag("ask-cast", { list: askList.length });
        setStatus("自动技能已补缺失状态", "ok");
      }
    } catch (e) {}
  }
  masterTickReg(function () { try { tickAskSkills(); } catch (e) {} });
  // 状态挂钩定时重试：asken 开着但 SI 模块未就绪时持续重试，确保 buffActive 判活表可用（否则状态判活失效）
  setInterval(function () { try { if ($id("dsh-asken") && $id("dsh-asken").checked) hookStatusIcons(); } catch (e) {} }, 3000);
  renderAskList();
  // V2.1.0 合并多辅助到辅助技能：旧 saved.buffs 文本（技能ID:等级:状态）迁移进 askList
  if (saved.buffs) {
    try {
      var oldBuffs = parseBuffs(saved.buffs);
      for (var obi = 0; obi < oldBuffs.length; obi++) {
        var obb = oldBuffs[obi];
        if (askList.some(function (x) { return x.skid === obb.skid; })) continue;
        askList.push({ skid: obb.skid, lv: obb.lv, name: getSkillNameById(obb.skid), st: obb.st || "", stInv: obb.stInv || false });
      }
      saveAskList();
      setStatus("已迁移旧多辅助 " + oldBuffs.length + " 项到辅助技能", "st");
    } catch (e) {}
    saved.buffs = "";
  }
  if (saved.buffInterval) { var abi = $id("dsh-askint"); if (abi) abi.value = saved.buffInterval; saved.buffInterval = ""; }
  if (saved.buffSP) { var abs = $id("dsh-asksp"); if (abs) abs.value = saved.buffSP; saved.buffSP = ""; }
  if (saved.buffEnabled) { var abe = $id("dsh-asken"); if (abe) abe.checked = true; saved.askEn = true; saved.buffEnabled = ""; saveSaved(saved); }
  if (saved.askEn) { $id("dsh-asken").checked = true; hookStatusIcons(); }
  $id("dsh-asken").addEventListener("change", function () { saved.askEn = this.checked; saveSaved(saved); if (this.checked) hookStatusIcons(); });
  // V1.7.0 一次性清空：多辅助/自动技能 历史数据（用户要求默认清空「助手内按间隔自动施放的增益」）
  if (!saved.uiClear170) {
    try { askList.length = 0; saveAskList(); } catch (e) {}
    saved.buffs = ""; saved.buffEnabled = false; saved.askEn = false;
    saved.uiClear170 = true; saveSaved(saved);
    var aek170 = $id("dsh-asken"); if (aek170) aek170.checked = false;
    setStatus("已按新版本要求清空多辅助/自动技能历史列表", "st");
  }

  // ---------------- 掉线提醒 + 重连 ----------------
  function hookDisconnect() {
    try {
      if (CLIENT.hooked) return;
      if (!CLIENT.UI) CLIENT.UI = window.require && window.require("UI/UIManager");
      if (!CLIENT.UI || typeof CLIENT.UI.showErrorBox !== "function") return;
      var orig = CLIENT.UI.showErrorBox;
      CLIENT.hooked = true;
      CLIENT.UI.showErrorBox = function (msg) {
        try { if (/断开/.test(String(msg || ""))) onDisconnect(msg); } catch (e) {}
        return orig.apply(this, arguments);
      };
    } catch (e) {}
  }
  var reconnecting = false;
  function onDisconnect(msg) {
    if (reconnecting) return;
    var doAlert = $id("dsh-alert") && $id("dsh-alert").checked;
    var doReload = $id("dsh-reconn") && $id("dsh-reconn").checked && saved.account;
    setStatus("⚠ 已断开连接", "err");
    if (doAlert) {
      var flashes = 0;
      var iv = setInterval(function () {
        document.title = (flashes++ % 2) ? "⚠ 掉线了！" : "仙境传说";
        if (flashes > 14) { clearInterval(iv); document.title = "仙境传说"; }
      }, 600);
    }
    if (doReload) {
      reconnecting = true;
      setStatus("已断开，10 秒后自动重连…", "err");
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 10000);
    }
  }

  // ---------------- 线路切换 ----------------
  function switchServerUrl(cv) {
    var href = location.href, hashIdx = href.indexOf("#");
    var base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    var hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
    if (/[?&]cv=\d+/i.test(base)) base = base.replace(/([?&])cv=\d+/i, "$1cv=" + cv);
    else base += (base.indexOf("?") >= 0 ? "&" : "?") + "cv=" + cv;
    return base + hash;
  }
  var serverSel = $id("dsh-server");
  serverSel.value = String(DEFAULTS.ClientVer);
  serverSel.addEventListener("change", function () {
    var v = parseInt(serverSel.value, 10);
    if (v === DEFAULTS.ClientVer) return;
    if (!window.confirm("切换线路将重启客户端并重新登录（" + (SERVER_NAMES[v] || "未知服") + "）。\n注意：两服账号不互通，切换后需用对应服的账号登录。")) {
      serverSel.value = String(DEFAULTS.ClientVer);
      return;
    }
    saved.server = v;
    saveSaved(saved);
    setStatus("已切换到「" + (SERVER_NAMES[v] || "未知服") + "」，正在重启客户端…", "ok");
    tlog("switch-server cv=" + v);
    location.replace(switchServerUrl(v));
  });
  $id("dsh-save").addEventListener("click", function () {
    var acc = $id("dsh-acc").value.trim();
    var pwd = $id("dsh-pwd").value;
    if (!acc || !pwd) { setStatus("请填写账号和密码", "err"); return; }
    saved.account = acc; saved.password = pwd;
    saveSaved(saved);
    setStatus("已保存，重启客户端生效", "ok");
    renderWinInfo();
  });
  $id("dsh-clear").addEventListener("click", function () {
    saved = {};
    try {
      var k = activeProfileKey(); ensureProfile(k);
      profiles[k].saved = {}; profiles[k].lockList = {}; profiles[k].askList = [];
      lockList = {}; askList = [];
      localStorage.setItem(LS_KEY, JSON.stringify({}));
      saveProfiles();
    } catch (e) {}
    $id("dsh-acc").value = ""; $id("dsh-pwd").value = "";
    try { renderLockList(); renderAskList(); } catch (e) {}
    setStatus("已清除", "st");
  });
  $id("dsh-reboot").addEventListener("click", function () { location.reload(); });
  // 中转确认后登录已保存账号：默认打开不自动登录（防挤掉中转会话），用户在中转页确认后点此按钮
  // → 用输入框当前账号（或已保存 saved）写 saved → 带 ?auto=1 重载（buildConfig 检测到 auto= 才注入 autoLogin）
  $id("dsh-save-confirm").addEventListener("click", function () {
    var acc = ($id("dsh-acc") && $id("dsh-acc").value.trim()) || saved.account;
    var pwd = ($id("dsh-pwd") && $id("dsh-pwd").value) || saved.password;
    if (!acc || !pwd) { setStatus("请先填写账号和密码（登录框）", "err"); return; }
    saved.account = acc; saved.password = pwd; saved.server = DEFAULTS.ClientVer;
    saveSaved(saved);
    setStatus("中转确认完成，登录账号 " + acc + "…", "ok");
    tlog("confirm-login saved account");
    var u = switchServerUrl(DEFAULTS.ClientVer);
    u = u.replace(/([?&])(run|auto)=/g, "$1auto=");
    if (!/\bauto=/.test(u)) u += (u.indexOf("?") >= 0 ? "&" : "?") + "auto=1";
    location.replace(u);
  });
  if (saved.account) { var accEl = $id("dsh-acc"); if (accEl) accEl.value = saved.account; }
  if (saved.password) { var pwdEl = $id("dsh-pwd"); if (pwdEl) pwdEl.value = saved.password; }

  // ---------------- 内挂桥接：读取战斗设置 ----------------
  function readBot() {
    var out = [];
    try {
      var q = function (s) { return document.querySelector(s); };
      var sv = function (s) { var el = q(s); return el ? el.value : null; };
      var sm = q(".searchMode");
      if (sm) {
        out.push("寻怪: " + (sm.options[sm.selectedIndex] ? sm.options[sm.selectedIndex].textContent : sm.value));
        $id("dsh-searchmode").innerHTML = sm.innerHTML;
      }
      var ona = q(".onlynoattack");
      if (ona) {
        out.push("被攻: " + (ona.options[ona.selectedIndex] ? ona.options[ona.selectedIndex].textContent : ona.value));
        $id("dsh-onlynoattack").innerHTML = ona.innerHTML;
      }
      var dt = sv(".disTarget");
      if (dt != null) { $id("dsh-distarget").value = dt; out.push("距离: " + dt + "格"); }
      var tg = [];
      var checks = document.querySelectorAll(".onlyattack_block input");
      for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        var mobid = c.getAttribute("data-id");
        if (mobid && c.checked) tg.push(c.getAttribute("data-name") || mobid);
      }
      $id("dsh-targets").textContent = tg.length ? tg.join("、") : "（未勾选）";
      out.push("目标: " + (tg.length ? tg.join("、") : "无"));
      // 技能下拉（只显示已学）
      fillSkillSelects();
      // 防御设置
      syncBotVal(".mobnumMin", "dsh-mobnummin");
      syncBotVal(".mobnumMax", "dsh-mobnummax");
      syncBotVal(".flytimer", "dsh-flytimer");
      syncBotVal(".MinHpValFly", "dsh-minhpfly");
      syncBotVal(".MinSpValFly", "dsh-minspfly");
      syncBotVal(".MinHpVal", "dsh-minhpout");
      syncBotCheck(".bossfly", "dsh-bossfly");
      syncBotCheck(".opensit", "dsh-opensit");
      syncNeiAddiFromPanel(); // V2.8.0：辅助技能多槽逐槽回填
      syncBotVal(".AutoUseSit_reHpVal", "dsh-sithplo");
      syncBotVal(".AutoUseSit_reHpUpVal", "dsh-sithphi");
      syncBotVal(".AutoUseSit_reSpVal", "dsh-sitsplo");
      syncBotVal(".AutoUseSit_reSpUpVal", "dsh-sitsphi");
    } catch (e) { out.push("读取异常: " + e.message); }
    if (!out.length) out.push("未找到内挂窗口（游戏内打开智能手机会话后重试）");
    return out.join(" | ");
  }
  function syncBotVal(sel, id) {
    try {
      var el = document.querySelector(sel);
      if (el && el.value != null) { var t = $id(id); if (t) t.value = el.value; }
    } catch (e) {}
  }
  function syncBotCheck(sel, id) {
    try {
      var el = document.querySelector(sel);
      if (el) { var t = $id(id); if (t) t.checked = !!el.checked; }
    } catch (e) {}
  }
  function fillSkillSelects() {
    try {
      // 优先：内挂 DOM 自己的技能下拉（带中文名 textContent）
      var domMap = { "dsh-autoskill": ".autoskillid", "dsh-automatic": ".automaticid", "dsh-touchskill": ".touchskillid", "dsh-qoautoskill": ".qoautoskillid", "dsh-autoshadow": ".autoshadowid" };
      var domSynced = false;
      Object.keys(domMap).forEach(function (sid) {
        var src = document.querySelector(domMap[sid]);
        var tgt = $id(sid);
        if (src && tgt && src.options && src.options.length > 1) {
          // 内挂 option 的 value 常为空、data-index 才是技能ID → 转换
          var html = '<option value="">- 请选择 -</option>';
          for (var oi = 0; oi < src.options.length; oi++) {
            var op = src.options[oi];
            var val = op.value || op.getAttribute("data-index") || op.getAttribute("data-id") || "";
            if (!val) continue;
            // 过滤被动技能（data-index=SKID）
            if (/^\d+$/.test(val) && isPassiveSkill(parseInt(val, 10))) continue;
            html += '<option value="' + val + '">' + (op.textContent || val).trim() + '</option>';
          }
          tgt.innerHTML = html;
          domSynced = true;
        }
      });
      if (domSynced) return;
      neiAddiFillOptions(); // V2.8.0：多槽辅助技能下拉填充（面板 option 优先，兜底已学技能）
      var DB = CLIENT.DB;
      if (!DB) { CLIENT.DB = window.require && window.require("DB/DBManager"); DB = CLIENT.DB; }
      if (!DB || typeof DB.getAllSkillInfo !== "function") return;
      var info = DB.getAllSkillInfo();
      if (!info) return;
      var learned = {};
      Object.keys(info).forEach(function (k) {
        var s = info[k];
        // 只收主动技能（type≠0 或 SpAmount 非全0）；被动技能不参与自动施放
        if (s && s.level > 0 && !isPassiveSkill(s.SKID != null ? s.SKID : k)) learned[s.SKID != null ? s.SKID : k] = s;
      });
      var ids = Object.keys(learned);
      var map = { "dsh-autoskill": ids, "dsh-automatic": ids, "dsh-touchskill": ids, "dsh-qoautoskill": ids, "dsh-autoshadow": ids };
      Object.keys(map).forEach(function (sid) {
        var sel = $id(sid);
        if (!sel) return;
        var cur = sel.value;
        var html = '<option value="">- 请选择 -</option>';
        for (var i = 0; i < ids.length; i++) {
          var nm = getSkillNameById(ids[i]) || (learned[ids[i]] && (learned[ids[i]].name || learned[ids[i]].SkillName)) || ids[i];
          html += '<option value="' + ids[i] + '">' + nm + ' Lv' + (learned[ids[i]].level || "?") + '</option>';
        }
        sel.innerHTML = html;
        if (cur) sel.value = cur;
      });
      setStatus("已读取内挂 + 已学技能 " + ids.length + " 个", "ok");
    } catch (e) { console.log("[RO助手] fillSkillSelects: " + e.message); }
  }
  // ---------------- 内挂辅助技能多槽（V2.8.0）：每槽独立技能/等级/开关，可增删、整批导入 ----------------
  function neiAddiDefault() { return [{ sid: "", lv: "10", on: true }]; }
  function neiAddiLoad() {
    if (Array.isArray(saved.neiAddi) && saved.neiAddi.length) return saved.neiAddi;
    // 旧档案迁移：V2.8.0 之前单槽存于 saved.ui（dsh-addiskill/lv/op）
    try {
      var u = saved.ui || {};
      if (u["dsh-addiskill"] || u["dsh-addiskilllv"] || u["dsh-addiskillop"]) {
        var mig = [{ sid: String(u["dsh-addiskill"] || ""), lv: String(u["dsh-addiskilllv"] != null ? u["dsh-addiskilllv"] : "10"), on: !!u["dsh-addiskillop"] }];
        saved.neiAddi = mig;
        saveSaved(saved);
        return mig;
      }
    } catch (e) {}
    return neiAddiDefault();
  }
  function neiAddiFillOptions() {
    try {
      var sels = document.querySelectorAll(".dsh-addi-sel");
      if (!sels.length) return;
      var src = document.querySelector(".addiskillid");
      var html = null;
      if (src && src.options && src.options.length > 1) {
        html = '<option value="">- 请选择 -</option>';
        for (var oi = 0; oi < src.options.length; oi++) {
          var op = src.options[oi];
          var val = op.value || op.getAttribute("data-index") || op.getAttribute("data-id") || "";
          if (!val) continue;
          if (/^\d+$/.test(val) && isPassiveSkill(parseInt(val, 10))) continue;
          html += '<option value="' + val + '">' + (op.textContent || val).trim() + '</option>';
        }
      } else {
        var DB = CLIENT.DB;
        if (!DB) { CLIENT.DB = window.require && window.require("DB/DBManager"); DB = CLIENT.DB; }
        if (!DB || typeof DB.getAllSkillInfo !== "function") return;
        var info = DB.getAllSkillInfo();
        if (!info) return;
        var learned = {};
        Object.keys(info).forEach(function (k) {
          var s = info[k];
          if (s && s.level > 0 && !isPassiveSkill(s.SKID != null ? s.SKID : k)) learned[s.SKID != null ? s.SKID : k] = s;
        });
        var ids = Object.keys(learned);
        html = '<option value="">- 请选择 -</option>';
        for (var i = 0; i < ids.length; i++) {
          var nm = getSkillNameById(ids[i]) || (learned[ids[i]] && (learned[ids[i]].name || learned[ids[i]].SkillName)) || ids[i];
          html += '<option value="' + ids[i] + '">' + nm + ' Lv' + (learned[ids[i]].level || "?") + '</option>';
        }
      }
      for (var si = 0; si < sels.length; si++) {
        var cur = sels[si].value;
        sels[si].innerHTML = html;
        if (!cur) continue;
        for (var oi2 = 0; oi2 < sels[si].options.length; oi2++) {
          if (sels[si].options[oi2].value === cur) { sels[si].selectedIndex = oi2; break; }
        }
      }
    } catch (e) { console.log("[RO助手] neiAddiFillOptions: " + e.message); }
  }
  function neiAddiRender() {
    var box = $id("dsh-nei-addi");
    if (!box) return;
    var list = neiAddiLoad();
    if (list.length > 6) { list = list.slice(0, 6); saved.neiAddi = list; }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var sid = String(it.sid || ""), lv = String(it.lv != null ? it.lv : "10"), on = !!it.on;
      html += '<div class="row" style="gap:3px"><select class="dsh-addi-sel" data-i="' + i + '" style="flex:1 1 90px;min-width:0"><option>- 请选择 -</option></select>' +
        '<span class="lb" style="min-width:22px">Lv</span><input class="dsh-addi-lv" data-i="' + i + '" type="number" value="' + lv + '" min="1" max="10" style="flex:0 0 34px">' +
        '<label class="switch"><input class="dsh-addi-on" data-i="' + i + '" type="checkbox"' + (on ? " checked" : "") + '>开</label>' +
        '<button class="ghost dsh-addi-del" data-i="' + i + '" style="flex:0 0 auto">删</button></div>';
    }
    box.innerHTML = html;
    var cnt = $id("dsh-nei-addi-count");
    if (cnt) cnt.textContent = list.length + " 槽";
    neiAddiFillOptions();
    var sels = box.querySelectorAll(".dsh-addi-sel");
    for (var j = 0; j < sels.length; j++) {
      var v = String((list[j] || {}).sid || "");
      if (!v) continue;
      for (var oi3 = 0; oi3 < sels[j].options.length; oi3++) {
        if (sels[j].options[oi3].value === v) { sels[j].selectedIndex = oi3; break; }
      }
    }
    box.querySelectorAll(".dsh-addi-sel").forEach(function (el) {
      el.addEventListener("change", function () {
        var k = parseInt(el.getAttribute("data-i"), 10);
        var l2 = neiAddiLoad();
        if (!l2[k]) l2[k] = { sid: "", lv: "10", on: true };
        l2[k].sid = el.value;
        saved.neiAddi = l2; saveSaved(saved);
      });
    });
    box.querySelectorAll(".dsh-addi-lv").forEach(function (el) {
      el.addEventListener("input", function () {
        var k = parseInt(el.getAttribute("data-i"), 10);
        var l2 = neiAddiLoad();
        if (!l2[k]) l2[k] = { sid: "", lv: "10", on: true };
        l2[k].lv = el.value;
        saved.neiAddi = l2; saveSaved(saved);
      });
    });
    box.querySelectorAll(".dsh-addi-on").forEach(function (el) {
      el.addEventListener("change", function () {
        var k = parseInt(el.getAttribute("data-i"), 10);
        var l2 = neiAddiLoad();
        if (!l2[k]) l2[k] = { sid: "", lv: "10", on: true };
        l2[k].on = el.checked;
        saved.neiAddi = l2; saveSaved(saved);
      });
    });
    box.querySelectorAll(".dsh-addi-del").forEach(function (el) {
      el.addEventListener("click", function () {
        var k = parseInt(el.getAttribute("data-i"), 10);
        var l2 = neiAddiLoad();
        if (l2.length <= 1) { setStatus("至少保留 1 个辅助技能槽", "warn"); return; }
        l2.splice(k, 1);
        saved.neiAddi = l2; saveSaved(saved);
        neiAddiRender();
      });
    });
  }
  var neiAddiAddBtn = $id("dsh-nei-addi-add");
  if (neiAddiAddBtn) neiAddiAddBtn.addEventListener("click", function () {
    var l2 = neiAddiLoad();
    if (l2.length >= 6) { setStatus("辅助技能最多 6 槽", "warn"); return; }
    l2.push({ sid: "", lv: "10", on: true });
    saved.neiAddi = l2; saveSaved(saved);
    neiAddiRender();
  });
  var neiAddiClearBtn = $id("dsh-nei-addi-clear");
  if (neiAddiClearBtn) neiAddiClearBtn.addEventListener("click", function () {
    saved.neiAddi = neiAddiDefault(); saveSaved(saved); neiAddiRender();
    setStatus("已清空辅助技能（保留 1 空槽）", "ok");
  });
  var neiAddiImportBtn = $id("dsh-nei-addi-import"), neiAddiImportBox = $id("dsh-nei-addi-importbox");
  if (neiAddiImportBtn && neiAddiImportBox) neiAddiImportBtn.addEventListener("click", function () {
    var show = neiAddiImportBox.style.display === "none";
    neiAddiImportBox.style.display = show ? "flex" : "none";
    if (show) { var ta = $id("dsh-nei-addi-importta"); if (ta) ta.focus(); }
  });
  var neiAddiImportCancel = $id("dsh-nei-addi-importcancel");
  if (neiAddiImportCancel) neiAddiImportCancel.addEventListener("click", function () {
    var b = $id("dsh-nei-addi-importbox"); if (b) b.style.display = "none";
  });
  var neiAddiImportOk = $id("dsh-nei-addi-importok");
  if (neiAddiImportOk) neiAddiImportOk.addEventListener("click", function () {
    try {
      var ta = $id("dsh-nei-addi-importta");
      var parsed = [], skipped = [];
      String(ta ? ta.value : "").split(/\r?\n/).forEach(function (lnRaw) {
        var ln = String(lnRaw || "").replace(/#.*$/, "").trim();
        if (!ln) return;
        var parts = ln.split(":");
        var nameOrId = (parts[0] || "").trim();
        var lv2 = parts[1] !== undefined && String(parts[1]).trim().length ? parseInt(parts[1], 10) : 10;
        if (isNaN(lv2) || lv2 <= 0 || lv2 > 10) lv2 = 10;
        if (/^\d+$/.test(nameOrId)) { parsed.push({ sid: nameOrId, lv: String(lv2), on: true }); }
        else {
          var sid3 = neiSkillIdByName(nameOrId);
          if (sid3) parsed.push({ sid: String(sid3), lv: String(lv2), on: true });
          else skipped.push(nameOrId);
        }
      });
      if (!parsed.length) { setStatus("未解析到任何辅助技能行（格式：技能名或ID:等级）", "warn"); return; }
      if (parsed.length > 6) parsed = parsed.slice(0, 6);
      saved.neiAddi = parsed; saveSaved(saved);
      neiAddiRender();
      setStatus("已导入 " + parsed.length + " 个辅助技能槽" + (skipped.length ? "；未识别跳过：" + skipped.join("、") : ""), "ok");
      if (ta) ta.value = "";
      var b2 = $id("dsh-nei-addi-importbox"); if (b2) b2.style.display = "none";
    } catch (e) { setStatus("导入异常: " + e.message, "err"); }
  });
  function neiSkillIdByName(nm) {
    try {
      var DB = CLIENT.DB;
      if (!DB) { CLIENT.DB = window.require && window.require("DB/DBManager"); DB = CLIENT.DB; }
      if (!DB || typeof DB.getAllSkillInfo !== "function") {
        var dsel = document.querySelector(".dsh-addi-sel");
        if (dsel) {
          var found = null, n = 0;
          for (var oi4 = 0; oi4 < dsel.options.length; oi4++) {
            if (String(dsel.options[oi4].textContent || "").indexOf(nm) >= 0) { n++; if (n === 1) found = dsel.options[oi4].value; }
          }
          return n === 1 ? found : null;
        }
        return null;
      }
      var info = DB.getAllSkillInfo(); if (!info) return null;
      var exact = null, exactN = 0, pre = null, preN = 0;
      Object.keys(info).forEach(function (k) {
        var s = info[k];
        if (!s || !(s.level > 0)) return;
        var skid = s.SKID != null ? s.SKID : k;
        if (isPassiveSkill(skid)) return;
        var nm2 = getSkillNameById(skid) || s.SkillName || s.name || "";
        if (!nm2) return;
        if (String(nm2) === nm) { exactN++; if (exactN === 1) exact = skid; }
        if (String(nm2).indexOf(nm) >= 0) { preN++; if (preN === 1) pre = skid; }
      });
      if (exactN === 1) return exact;
      return preN === 1 ? pre : null;
    } catch (e) { return null; }
  }
  function syncNeiAddiFromPanel() {
    try {
      var sels = document.querySelectorAll(".addiskillid");
      var lvs = document.querySelectorAll(".addiskilllv");
      var ops = document.querySelectorAll(".addiskillop");
      if (!sels.length) return;
      var list = Array.isArray(saved.neiAddi) ? saved.neiAddi.slice() : [];
      for (var i = 0; i < sels.length; i++) {
        var sel = sels[i];
        var sid = "";
        if (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
          var opx = sel.options[sel.selectedIndex];
          sid = opx.value || opx.getAttribute("data-index") || opx.getAttribute("data-id") || "";
        }
        var lv = lvs[i] && lvs[i].value != null ? lvs[i].value : "";
        var on = ops[i] ? !!ops[i].checked : true;
        if (i < list.length) list[i] = { sid: sid, lv: String(lv), on: on };
        else list.push({ sid: sid, lv: String(lv), on: on });
      }
      saved.neiAddi = list; saveSaved(saved);
      neiAddiRender();
    } catch (e) { console.log("[RO助手] syncNeiAddiFromPanel: " + e.message); }
  }
  neiAddiRender();
  $id("dsh-readbot").addEventListener("click", function () {
    setStatus("内挂: " + readBot(), "ok");
  });
  // 内挂开关真实状态：读聊天窗绿色系统字（服务器回执「开启自动战斗/关闭自动战斗」）。
  // 内挂开关是单一 toggle（点一次翻转一次），点击前必须判断真实状态，否则把已开翻成关。
  var CHAT_BATTLE_SELS = ['#chatbox .containers .border', '#chatbox .containers', '#chatbox .border', '#chatbox', '.chatbox .containers .border', '.chatbox .border', '.chatbox'];
  function readChatBattle() {
    try {
      for (var i = 0; i < CHAT_BATTLE_SELS.length; i++) {
        var el = document.querySelector(CHAT_BATTLE_SELS[i]);
        if (!el) continue;
        var ps = el.querySelectorAll('p');
        var st = null;
        for (var j = 0; j < ps.length; j++) {
          var t = String(ps[j].textContent || '').trim();
          if (/开启自动战斗/.test(t)) st = true;
          else if (/关闭自动战斗/.test(t)) st = false;
        }
        if (st !== null) return st; // 返回最后一条开关回执
      }
    } catch (e) {}
    return null; // 聊天框没读到开关回执（未知）
  }
  // 登录角色后自动读取内挂配置（一次性 + 读不到重试几次，等内挂窗口渲染）
  var autoReadBotDone = false, autoReadBotTries = 0;
  function autoReadBotOnce() {
    try {
      var r = readBot();
      if (autoReadBotTries < 5 && /未找到内挂窗口/.test(r || "")) {
        autoReadBotTries++;
        setTimeout(autoReadBotOnce, 2500);
      }
    } catch (e) {}
  }
  function setBattle(on) {
    // 判断真实状态：优先聊天窗绿色字（服务器回执「开启/关闭自动战斗」），读不到再回落内挂面板 checkbox。
    // 内挂开关是单一 toggle：点一次翻转一次，点前必须判断，否则把已开翻成关。
    var real = readChatBattle();
    if (real === null) real = npReadPanelState();
    dshDiag("set-battle", { on: on, chat: real, panel: npReadPanelState() });
    if (real === !!on) {
      npHuntOn = !!on;
      setStatus("内挂自动战斗已处于" + (on ? "开启" : "关闭") + "状态，无需重复操作", "ok");
      return;
    }
    // 内挂开关按钮 = .startButton（文字「点击开始/点击停止」，DIV 元素，toggle 型），v0.13.24 探针实锤。
    // 旧猜想 .setAutokey/.openattack 均点不中；兜底仍留兼容。
    var btn = null;
    try { btn = document.querySelector(".startButton"); } catch (e) {}
    if (!btn) { try { btn = document.querySelector(".setAutokey, .content.attack .openattack, .openattack"); } catch (e) {} }
    if (!btn) { setStatus("未找到内挂开关，请先打开内挂窗口", "err"); return; }
    try { btn.click(); } catch (e) {}
    npHuntOn = !!on; // 已 toggle 一次 → 本地认为到达目标状态
    setStatus("内挂自动战斗已切换为" + (on ? "开启" : "关闭") + (real === null ? "（按绿色字/面板推断）" : ""), "ok");
    tlog("setBattle on=" + on + " chatReal=" + real);
  }
  $id("dsh-battleon").addEventListener("click", function () { setBattle(true); });
  $id("dsh-battleoff").addEventListener("click", function () { setBattle(false); });

  // ---------------- 模拟内挂指令（直接发服务器 · 套用内挂机制）----------------
  // 机制（vbk 逆向）：二转 ClientVer=5 → CZ.NOTIFY_UPDATEINFO{id,value}；三转 ClientVer=3 → CZ.WHISPER{receiver:"NPC:setauto*", msg:"0"}
  // id: 34=自动战斗(含移动寻怪) 35=自动拾取 36=自动吃药 37=自动跟随 38=寻怪模式(0移动/1范围/2原地)
  function npLog(msg) { var el = $id("dsh-np-log"); if (el) el.textContent = msg; }
  function npIsThree() { return DEFAULTS.ClientVer === 3; }
  function npSendUpdate(id, value) {
    try {
      if (!clientReady()) { npLog("客户端未就绪"); return false; }
      var p = new CLIENT.PS.CZ.NOTIFY_UPDATEINFO();
      p.id = id; p.value = value;
      CLIENT.NM.sendPacket(p);
      return true;
    } catch (e) { npLog("发包异常: " + e.message); return false; }
  }
  function npSendWhisper(receiver) {
    try {
      if (!clientReady()) { npLog("客户端未就绪"); return false; }
      var p = new CLIENT.PS.CZ.WHISPER();
      p.receiver = receiver; p.msg = "0";
      CLIENT.NM.sendPacket(p);
      return true;
    } catch (e) { npLog("发包异常: " + e.message); return false; }
  }
  function npCmd(label, id3, id5, val) {
    // 三转 → WHISPER NPC:setauto*；二转 → NOTIFY_UPDATEINFO
    if (npIsThree()) {
      var ok = npSendWhisper(id3);
      npLog((ok ? "✓ " : "✗ ") + label + "（三转 WHISPER " + id3 + "）");
    } else {
      var ok2 = npSendUpdate(id5, val != null ? val : 1);
      npLog((ok2 ? "✓ " : "✗ ") + label + "（二转 UPDATEINFO id=" + id5 + " val=" + (val != null ? val : 1) + "）");
    }
    setStatus("已发送模拟内挂指令：" + label, "ok");
    tlog("np-cmd " + label + " cv=" + DEFAULTS.ClientVer);
  }
  $id("dsh-np-atk").addEventListener("click", function () {
    npCmd("开自动战斗(移动寻怪)", "NPC:setautoattack", 34, 1);
    // 三转开自动战斗后也清掉客户端导航目标（同 vbk z.removeDestination()）
    try { var MM = window.require && window.require("UI/Components/MiniMap/MiniMap"); if (MM && MM.removeDestination) MM.removeDestination(); } catch (e) {}
  });
  $id("dsh-np-pick").addEventListener("click", function () { npCmd("开自动拾取", "NPC:setautopick", 35, 1); });
  $id("dsh-np-eat").addEventListener("click", function () { npCmd("开自动吃药", "NPC:setautoeat", 36, 1); });
  $id("dsh-np-hunt").addEventListener("click", function () {
    var v = parseInt($id("dsh-np-huntmode").value, 10);
    if (isNaN(v)) v = 0;
    // 寻怪模式仅二转 UPDATEINFO id=38；三转无此字段则提示
    if (npIsThree()) { npLog("三转寻怪模式由 NPC:setautoattack 自动处理，无需单独发送"); setStatus("三转：自动战斗已含移动寻怪", "ok"); return; }
    var ok = npSendUpdate(38, v);
    npLog((ok ? "✓ " : "✗ ") + "寻怪模式已设为 " + ["移动", "范围", "原地"][v] + "寻怪（id=38 val=" + v + "）");
    setStatus("已发送寻怪模式：" + ["移动", "范围", "原地"][v] + "寻怪", ok ? "ok" : "err");
    tlog("np-hunt mode=" + v);
  });

  // ---------------- 内挂机制寻怪（套用内挂：服务器驱动移动 · 战斗判断仍助手控制）----------------
  // 用法：无目标时发内挂指令让服务器移动寻怪；有目标时助手自己打（锁定目录/技能顺序/换怪延迟全由助手）
  // 二转(5)：UPDATEINFO id=38(移动寻怪) + id=34(toggle 自动战斗)；三转(3)：WHISPER NPC:setautoattack
  // ⚠️ 客户端 vbk 源码实证（Online_mn.js @3336649）：setautoattack 是 toggle 型——
  //    .openattack 勾选/取消都发同一包（二转 id=34 value=1、三转 WHISPER msg="0"），服务器收到就翻转一次。
  //    客户端从不发 value=0；因此「关闭」=再发一次同一包（toggle 回来），绝不能周期重发（否则每 1.5s 开关一次）。
  // 通过 NOTIFY_ONLYTARGET 同步锁定目录 → 服务器寻怪只追锁定怪
  var npHuntOn = false; // 本地跟踪：我们认为服务器内挂自动战斗当前状态（toggle 需精确一次）
  function npHuntMode() {
    var el = $id("dsh-z-huntmode");
    return el ? el.value : "self";
  }
  function npSyncTargets() {
    // 把锁定目录同步给内挂：NOTIFY_ONLYTARGET{id=mobid(4字节), value=1} 只打勾选怪
    try {
      if (!clientReady() || !CLIENT.PS.CZ.NOTIFY_ONLYTARGET) return;
      var ids = Object.keys(lockList);
      for (var i = 0; i < ids.length; i++) {
        var p = new CLIENT.PS.CZ.NOTIFY_ONLYTARGET();
        p.id = parseInt(ids[i], 10) || 0;
        p.value = 1;
        CLIENT.NM.sendPacket(p);
      }
      tlog("np-sync-targets n=" + ids.length);
    } catch (e) {}
  }
  // toggle 一次自动战斗（发同一包：二转 id=34 value=1 / 三转 WHISPER msg="0"）
  function npToggleHunt() {
    if (npIsThree()) npSendWhisper("NPC:setautoattack");
    else npSendUpdate(34, 1);
  }
  function npEnsureHunt() {
    // 需要开启内挂寻怪：本地认为已开 → 不再发包（避免 toggle 多翻一次变关）；未开 → toggle 一次
    try {
      if (npHuntOn) return;
      if (npIsThree()) {
        npToggleHunt();
      } else {
        npSendUpdate(38, 0); // 0=移动寻怪（设置型，可重复）
        npToggleHunt();      // toggle 开自动战斗
      }
      npHuntOn = true;
      tlog("np-hunt-on (toggle) cv=" + DEFAULTS.ClientVer);
    } catch (e) {}
  }
  function npHuntStop() {
    // 停止助手时关闭内挂自动战斗：本地认为已开 → toggle 一次关掉；已关 → 不发
    try {
      if (!npHuntOn) return;
      if (clientReady()) npToggleHunt();
      npHuntOn = false;
      tlog("np-hunt-off (toggle)");
    } catch (e) {}
  }
  // 寻怪方式下拉 change：切到「内挂机制」→ 仅校准面板状态 + 同步锁定目录，不发 toggle（等点开自动战斗后由 zWalk 状态机自动发第一次）；
  // 切走 → 若内挂在跑则关掉（toggle 一次）
  try {
    $id("dsh-z-huntmode").addEventListener("change", function () {
      if (this.value === "np") {
        npCalibrate();               // 对齐服务器实际状态（面板=服务器，不发包）
        npSyncTargets();             // 锁定目录同步给内挂（只追锁定怪）
        setStatus("已切到内挂机制寻怪（点开自动战斗后由助手状态机自动发包寻怪）", "ok");
        tlog("huntmode->np (no toggle until start)");
      } else {
        npHuntStop();
        setStatus("已切到自研直走寻怪", "st");
        tlog("huntmode->self");
      }
    });
  } catch (e) {}
  // 攻击距离计算：物理/魔法按技能射程自动选择（普攻=物理距离；技能=技能射程+1 与普攻取大）
  // 客户端 onUseSkill 机制：attackRange+1；无技能则用普攻物理距离
  function calcAtkRange() {
    try {
      var pmRange = parseInt($id("dsh-z-pmrange").value, 10) || 2;
      var order0 = parseSkillOrder($id("dsh-skillorder").value);
      var atkRange = pmRange;
      if (order0.length) {
        var maxSkillRange = pmRange;
        for (var oi = 0; oi < order0.length; oi++) {
          var sr = getSkillRange(order0[oi].skid, order0[oi].lv);
          if (sr + 1 > maxSkillRange) maxSkillRange = sr + 1;
        }
        atkRange = maxSkillRange;
      }
      return atkRange;
    } catch (e) { return 2; }
  }
  // 侦查扫描是否扫到「可攻击到的锁定怪物」：基于 scanMobs（侦查实时结果，含 mid/距离/锁定目录比对）
  // 内挂寻怪开关依据（用户需求状态机）：
  //   - 可攻击到的锁定怪（dist ≤ atkRange，非超出）→ 停内挂，助手接管战斗
  //   - 只有超出的锁定怪（dist > atkRange）/ 无怪 → 持续内挂寻怪（服务器驱动移动）
  function scanHasAttackableLockedMob(atkRange) {
    try {
      if (!scanMobs || !scanMobs.length) return false;
      if (!atkRange) atkRange = calcAtkRange();
      for (var i = 0; i < scanMobs.length; i++) {
        var m = scanMobs[i];
        if (!m || m.mid == null) continue;
        if (!lockList[String(m.mid)]) continue; // 只认锁定怪
        if (m.dist >= 0 && m.dist <= atkRange) return true; // 可攻击（非超出）
      }
      return false;
    } catch (e) { return false; }
  }
  // 侦查扫描是否扫到「超出攻击范围的锁定怪物」（有锁定怪但够不着 → 需内挂移动靠近）
  function scanHasOutOfRangeLockedMob(atkRange) {
    try {
      if (!scanMobs || !scanMobs.length) return false;
      if (!atkRange) atkRange = calcAtkRange();
      for (var i = 0; i < scanMobs.length; i++) {
        var m = scanMobs[i];
        if (!m || m.mid == null) continue;
        if (!lockList[String(m.mid)]) continue;
        if (m.dist < 0 || m.dist > atkRange) return true; // 距离未知或超出
      }
      return false;
    } catch (e) { return false; }
  }

  // ---------------- 助手模式：侦查扫描 + 锁定 + 攻击循环 ----------------
  var scanTimer = null, scanMobs = [], zAttTimer = null, zRunning = false;
  var zUseCounts = {}; // V1.7.0 本轮技能释放次数计数（maxUses；开/停自动战斗时清空）
  var zLockCounts = {}; // V1.7.5 每次锁定释放次数计数（换目标/重新锁定时清零）
  var zCastIdx = 0;     // V1.7.5 技能轮换游标：下轮从该索引开始扫（拖拽顺序真正生效）
  var lockList = (function () {
    try { ensureProfilesInit(); var k = activeProfileKey(); return (profiles[k] && profiles[k].lockList) || {}; } catch (e) { return {}; }
  })();
  var zLastPos = null, zStuckSince = null;

  function renderLockList() {
    var el = $id("dsh-locklist");
    if (!el) return;
    var ids = Object.keys(lockList);
    $id("dsh-lockcount").textContent = ids.length + " 种";
    if (!ids.length) { el.innerHTML = '<span class="st">未锁定（勾选本图怪物或侦查扫描到的怪）</span>'; return; }
    var html = "";
    ids.forEach(function (id) {
      html += '<div class="list-item"><span>🐛 ' + (lockList[id].name || ("ID" + id)) + ' · ID' + id + '</span>' +
        '<button class="ghost" data-unlock="' + id + '" style="flex:0 0 auto;padding:0 8px;font-size:11px">解除</button></div>';
    });
    el.innerHTML = html;
  }
  function profileLockSave() {
    try { var k = activeProfileKey(); ensureProfile(k); profiles[k].lockList = lockList; profiles[k].lastAt = Date.now(); saveProfiles(); } catch (e) {}
  }
  function addLock(id, name) {
    id = String(id);
    if (!lockList[id]) lockList[id] = { name: name || ("ID" + id), ts: Date.now() };
    profileLockSave();
    renderLockList();
  }
  function removeLock(id) {
    delete lockList[String(id)];
    profileLockSave();
    renderLockList();
  }
  $id("dsh-locklist").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-unlock]");
    if (b) removeLock(b.getAttribute("data-unlock"));
  });
  $id("dsh-lockclear").addEventListener("click", function () {
    lockList = {};
    profileLockSave();
    renderLockList();
    try { renderMapLock($id("dsh-maplock")); renderMapLock($id("dsh-z-maplock")); } catch (e) {}
    try { renderMapMobs(); } catch (e) {}
    setStatus("已清空怪物锁定目录", "ok");
  });

  // 内挂模式页「当前地图怪物」：同内挂检测目标方式——直接读地图怪物表
  // getworldData(currentMap).mobs（怪物ID数组）→ getmobData(id).kName（中文名）
  // 通用：读当前地图信息（同内挂检测目标数据源）
  function getCurrentMapInfo() {
    try {
      if (!window.require) return null;
      var MR = null;
      try { MR = window.require("Renderer/MapRenderer"); } catch (e) {}
      var mapKey = MR && MR.currentMap ? String(MR.currentMap).split(".")[0] : "";
      if (!mapKey) return null;
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      if (!DB || typeof DB.getworldData !== "function") return null;
      var wd = DB.getworldData(mapKey);
      var mobArr = wd && wd.mobs;
      if (mobArr && typeof mobArr === "string") mobArr = mobArr.split(",");
      return { key: mapKey, name: (wd && wd.name) || mapKey, mobIds: mobArr && mobArr.length ? mobArr : null };
    } catch (e) { return null; }
  }
  // 当前地图的怪物列表 [{id, m}]（mob_db 有数据才返回）
  function getMapMobList() {
    try {
      var info = getCurrentMapInfo();
      if (!info || !info.mobIds || !info.mobIds.length) return null;
      var mobDB = getMobDb();
      if (!mobDB) return null;
      var list = [], seen = {};
      for (var i = 0; i < info.mobIds.length; i++) {
        var id = info.mobIds[i];
        if (id == null || seen[id]) continue;
        seen[id] = true;
        var m = mobDB[id];
        if (m) list.push({ id: id, m: m });
      }
      return list.length ? list : null;
    } catch (e) { return null; }
  }
  function renderMapMobs() {
    try {
      var el = $id("dsh-nei-mapmobs");
      if (!el) return;
      var info = getCurrentMapInfo();
      var mobArr = info && info.mobIds;
      if (!mobArr || !mobArr.length) {
        // 地图表无数据（如未进图/表缺失）→ 回退侦查实体列表
        fallbackMobs(el);
        return;
      }
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      var html = "";
      var seen = {};
      for (var i = 0; i < mobArr.length; i++) {
        var id = mobArr[i];
        if (id == null || seen[id]) continue;
        seen[id] = true;
        var mob = null;
        try { mob = DB.getmobData(id); } catch (e) {}
        var nm = (mob && (mob.kName || mob.name)) || getMobName(id) || ("ID" + id);
        var lv = mob && mob.LV != null ? mob.LV : "";
        var locked = lockList[String(id)] ? true : false;
        html += '<div class="list-item"><label class="switch"><input type="checkbox"' + (locked ? " checked" : "") + ' data-lock="' + id + '" data-nm="' + nm + '">' + nm +
          ' <span class="st">ID' + id + (lv ? " · Lv" + lv : "") + "</span></label></div>";
      }
      el.innerHTML = html || '<span class="st">该地图表无怪物</span>';
      el.querySelectorAll("input[data-lock]").forEach(function (c) {
        c.addEventListener("change", function () {
          var id = this.getAttribute("data-lock");
          if (!id) return;
          if (this.checked) addLock(id, this.getAttribute("data-nm"));
          else removeLock(id);
        });
      });
    } catch (e) {}
  }
  // 回退：把侦查实体列表同步到内挂模式页
  function fallbackMobs(nei) {
    try {
      if (!scanMobs.length) { nei.innerHTML = '<span class="st">附近没有怪物（开启侦查扫描后同步）</span>'; return; }
      var nh = "";
      for (var ni = 0; ni < scanMobs.length; ni++) {
        var mm = scanMobs[ni];
        nh += '<div class="list-item"><label class="switch"><input type="checkbox"' + (lockList[String(mm.mid)] ? " checked" : "") + ' data-lock="' + (mm.mid != null ? mm.mid : "") + '" data-nm="' + mm.name + '">' + mm.name +
          (mm.mid != null ? ' <span class="st">ID' + mm.mid + (mm.lv ? " · Lv" + mm.lv : "") + "</span>" : "") +
          '</label><span style="color:#5a6b7f">' + (mm.dist >= 0 ? mm.dist + "m" : "?") + "</span></div>";
      }
      nei.innerHTML = nh;
      nei.querySelectorAll("input[data-lock]").forEach(function (c) {
        c.addEventListener("change", function () {
          var id = this.getAttribute("data-lock");
          if (!id) return;
          if (this.checked) addLock(id, this.getAttribute("data-nm"));
          else removeLock(id);
        });
      });
    } catch (e) {}
  }
  function startScan() {
    stopScan();
    if (!$id("dsh-scanen").checked) return;
    var sec = Math.max(0.3, parseFloat($id("dsh-scanint").value) || 0.5);
    scanTimer = setInterval(scanOnce, sec * 1000);
    scanOnce();
    $id("dsh-scanst").textContent = "扫描中 " + sec + "s";
  }
  function stopScan() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    $id("dsh-scanst").textContent = "已停止";
  }
  function scanOnce() {
    try {
      var el = $id("dsh-scanlist");
      if (!el) return;
      if (!window.require) { el.textContent = "客户端未就绪"; return; }
      var EM = window.require("Renderer/EntityManager");
      if (!EM || !EM.forEach) { el.textContent = "实体管理器不可用"; return; }
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      var mobs = [];
      EM.forEach(function (e) {
        try {
          if (e.objecttype !== 5) return;
          var d = -1;
          if (ent && ent.position && e.position) {
            d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
          }
          // 怪物类ID在 e._job（vbk 用 _job 与地图表怪物ID比对；job 会被变身覆盖）
          var mid = e._job != null ? e._job : (e.job != null ? e.job : (e.mobId != null ? e.mobId : e.GID));
          var nm = getMobName(mid) || (e.display && e.display.name) || e.displayName || e.name || null;
          var lv = "";
          var mb = null;
          try { var dbx = getMobDb(); mb = dbx && dbx[mid]; } catch (e3) {}
          if (mb && mb.LV != null) lv = mb.LV;
          // BOSS 判定：只认 mob_db.MvpDropsNum>0（126只MVP/BOSS），不做地图级 fallback（hasBoss 会把查不到的怪全标成 BOSS）
          var isBoss = !!(mb && mb.MvpDropsNum > 0);
          mobs.push({ GID: e.GID, mid: mid, name: nm || String(mid != null ? mid : e.GID), dist: d, lv: lv, isBoss: isBoss });
        } catch (e2) {}
      });
      scanMobs = mobs;
      var range = parseInt($id("dsh-z-range").value, 10) || 12;
      var html = "";
      for (var i = 0; i < mobs.length; i++) {
        var m = mobs[i];
        var locked = m.mid != null && lockList[String(m.mid)] ? true : false;
        var inR = m.dist >= 0 && m.dist <= range;
        html += '<div class="list-item"><label class="switch"><input type="checkbox"' + (locked ? " checked" : "") + ' data-lock="' + (m.mid != null ? m.mid : "") + '" data-nm="' + m.name + '">' + m.name + (m.mid != null ? " · ID" + m.mid : "") + (m.lv ? ' <span class="st">Lv' + m.lv + "</span>" : "") + '</label>' +
          '<span style="color:#5a6b7f">' + (m.dist >= 0 ? m.dist + "m" : "?") + (inR ? "" : " · 超出") + '</span></div>';
      }
      el.innerHTML = html || '<span class="st">附近没有怪物</span>';
      // 内挂模式页「当前地图怪物」：优先读地图表（getworldData().mobs，同内挂检测目标），失败回退侦查实体
      renderMapMobs();
      // 勾选=锁定
      el.querySelectorAll('input[data-lock]').forEach(function (c) {
        c.addEventListener("change", function () {
          var id = this.getAttribute("data-lock");
          if (!id) return;
          if (this.checked) addLock(id, this.getAttribute("data-nm"));
          else removeLock(id);
        });
      });
      // 被攻击检测（HP 下降 → 反击/瞬移依据）
      try { if (ent) updateHpWatch(ent); } catch (e2) {}
      // 卡死检测
      if (ent && ent.position) {
        var px = ent.position[0], py = ent.position[1];
        if (zLastPos && px === zLastPos[0] && py === zLastPos[1]) {
          if (!zStuckSince) zStuckSince = Date.now();
        } else { zStuckSince = null; }
        zLastPos = [px, py];
      }
      // 群殴/防御检测
      checkDefense(mobs, ent);
      // V1.8.5：缓存侦查结果（拾取走过去安全判定用）
      lastMobs = mobs || [];
    } catch (e) {}
  }

  // ---- 助手防御：群殴 / 低血 / 卡死 / BOSS → 瞬移（翅膀601 或 瞬移术）----
  var lastFly = 0;
  // V1.8.5：最近一次侦查的怪物数组（isBoss 判定供「拾取走过去」安全复查用）
  var lastMobs = [];
  // ================= V1.9.4：中心危险快照 + 动作互斥（防判断冲突锁死）=================
  // 目标：喝水/坐下/瞬移/拾取不再各算各的危险边界——每周期由 checkDefense 刷新一份快照，
  //       所有子系统同读；动作互斥由决策层保证（同 tick 只出一个动作），无等待 → 无死锁。
  var DS_BOSS_DIST = 25;   // Boss 危险距离统一口径（原瞬移=侦测即飞、拾取=20 格，语义分裂已统一）
  var defSnap = { hpPct: 100, spPct: 100, isCombatMap: false, mobCount: 0, bossDist: -1, sitting: false, now: 0 };
  var actLock = { act: null, until: 0 };  // 主动作锁：每 tick 决策重写，超时视为空闲
  var potNoPotion = false;                // 喝水无药标记（瀑布：低血无药被围 → 升级瞬移）
  var flyFailCount = 0, flyFailUntil = 0; // 瞬移连续失败冷却（3 次 → 10s 不重试）
  var sitSince = 0, sitHpAt = -1;         // 坐下看门狗（30s 血未回升 → 站起并入瞬移链）
  function lockAct(act, ms) {
    try {
      var now = Date.now();
      if (actLock.act && actLock.act !== act && now < actLock.until) return false;
      actLock.act = act; actLock.until = now + ms;
      return true;
    } catch (e) { return false; }
  }
  function isActFreeOnline(act) {
    try { return !actLock.act || actLock.act === act || Date.now() >= actLock.until; } catch (e) { return true; }
  }
  function isSitting() {
    try {
      var st = CLIENT && CLIENT.SS && CLIENT.SS.Entity;
      if (!st) return false;
      if (st.sit != null) return !!st.sit;
      if (st.basic_status && st.basic_status.sit != null) return !!st.basic_status.sit;
      return false;
    } catch (e) { return false; }
  }
  function refreshDefSnap(mobs, ent) {
    try {
      var cMap = getCurrentMapInfo();
      var life = ent && ent.life;
      var hpPct = life && life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
      var spPct = life && life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
      var bossDist = -1, mobCount = 0;
      for (var i = 0; i < (mobs || []).length; i++) {
        var mb = mobs[i];
        if (!mb) continue;
        if (mb.dist >= 0) mobCount++;
        if (mb.isBoss && mb.dist >= 0 && (bossDist < 0 || mb.dist < bossDist)) bossDist = mb.dist;
      }
      defSnap = { hpPct: hpPct, spPct: spPct,
        isCombatMap: !!(cMap && cMap.mobIds && cMap.mobIds.length),
        mobCount: mobCount, bossDist: bossDist, sitting: isSitting(), now: Date.now() };
    } catch (e) {}
  }
  function markFlyFail() { try { flyFailCount++; if (flyFailCount >= 3) flyFailUntil = Date.now() + 10000; } catch (e) {} }
  function markFlyOk() { flyFailCount = 0; }
  // ================= /V1.9.4 =================
  function checkDefense(mobs, ent) {
    try {
      // V1.9.4：每周期只刷一次中心快照（本节内所有判定同源，喝水/拾取复用之）
      refreshDefSnap(mobs, ent);
      // V1.8.1：防御瞬移分层——防BOSS/低血/群殴恢复常驻（不绑定战斗态 zRunning），
      //   仅卡死瞬移绑定战斗态；全部防御瞬移仅在「有怪」战斗地图生效（主城/无怪图不触发）。
      var cMap = getCurrentMapInfo();
      var isCombatMap = defSnap.isCombatMap;
      if (!clientReady()) return;
      var now = Date.now();
      // V1.9.4：瞬移连续失败冷却（无翅膀/无瞬移术/SP不足 3 次后 10s 停手，避免空转抖动）
      if (now < flyFailUntil) return;
      var flyInt = (parseInt($id("dsh-z-flyint").value, 10) || 30) * 1000;
      if (now - lastFly < flyInt) return;
      var needFly = false, reason = "";
      var group = parseInt($id("dsh-z-grp").value, 10);
      if (!group || group < 0) group = 0; // 0 = 群殴处理关闭
      var grpAct = $id("dsh-z-grpact") ? $id("dsh-z-grpact").value : "瞬移";
      if (group > 0 && mobs.length >= group) {
        if (grpAct === "解围技能") {
          // 群殴 → 解围技能：用技能顺序第一个技能打最近怪（目标在攻击距离内）
          var orderG = parseSkillOrder($id("dsh-skillorder").value);
          var entG = CLIENT.SS && CLIENT.SS.Entity;
          var tgG = null, tdG = 1e9, atkG = 3;
          try {
            atkG = parseInt($id("dsh-z-mgrange").value, 10) || 9;
            for (var gi = 0; gi < mobs.length; gi++) {
              var mmG = mobs[gi];
              if (mmG && mmG.dist >= 0 && mmG.dist < tdG && mmG.dist <= atkG) { tdG = mmG.dist; tgG = mmG; }
            }
          } catch (e5) {}
          if (tgG && orderG.length && tgG.GID) {
            try {
              var pg = new CLIENT.PS.CZ.USE_SKILL();
              pg.SKID = orderG[0].skid;
              pg.selectedLevel = orderG[0].lv;
              pg.targetID = tgG.GID;
              CLIENT.NM.sendPacket(pg);
              setStatus("群殴(" + mobs.length + "只)，解围技能 " + getSkillNameById(orderG[0].skid), "warn");
              tlog("defense-qo skill=" + orderG[0].skid);
            } catch (e6) {}
            return; // 已施放解围，本轮不做其他防御
          }
        }
        // V1.9.4：群殴瞬移取消独立开关（dsh-z-flygrp 已删）——grp>0 且 grpact=「瞬移」即启用
        if (grpAct === "瞬移" && isCombatMap) {
          needFly = true;
          reason = "群殴(" + mobs.length + "只)";
        }
      }
      // BOSS 瞬移（dsh-z-bossfly 开关，默认关）：V1.9.4 统一距离口径 DS_BOSS_DIST（默认25格），与拾取共用
      if (isCombatMap && $id("dsh-z-bossfly") && $id("dsh-z-bossfly").checked && !needFly) {
        for (var bi = 0; bi < mobs.length; bi++) {
          if (mobs[bi] && mobs[bi].isBoss && mobs[bi].dist >= 0 && mobs[bi].dist <= DS_BOSS_DIST) {
            needFly = true;
            reason = "BOSS(" + (mobs[bi].name || mobs[bi].mid) + ")";
            break;
          }
        }
      }
      var life = ent && ent.life;
      if (life) {
        var hpPct = life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
        var spPct = life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
        if (isCombatMap && hpPct < (parseInt($id("dsh-z-hpfly").value, 10) || 20)) { needFly = true; reason = "HP" + Math.round(hpPct) + "%"; }
        if (isCombatMap && spPct < (parseInt($id("dsh-z-spfly").value, 10) || 10)) { needFly = true; reason = "SP" + Math.round(spPct) + "%"; }
        if (hpPct < (parseInt($id("dsh-z-hpout").value, 10) || 5)) { setStatus("HP极低，10秒后下线", "err"); }
        // V1.9.4 瀑布接管：低血(喝水线) + 无药 + 被围 → 升级瞬移（消 25% 无药死区）
        var potThrNow = parseInt($id("dsh-pothealhp").value, 10) || 40;
        if (isCombatMap && potNoPotion && mobs.length > 0 && hpPct < potThrNow && !needFly) {
          needFly = true; reason = "低血无药被围";
        }
      }
      if (isCombatMap && zRunning && $id("dsh-z-flystuck").checked && zStuckSince && (now - zStuckSince > 10000)) { needFly = true; reason = "卡死10s"; }
      if (needFly) {
        // V1.9.4：doFly 失败计数（无翅膀/无瞬移术/SP不足）——3 次后 10s 冷却防空转
        if (!doFly()) markFlyFail(); else markFlyOk();
        lastFly = now;
        setStatus("瞬移(" + reason + ")", "warn");
      }
      // 坐下（V1.9.4：唯一一套=战斗页；与走路/拾取动作互斥 + 30s 血未回升看门狗→站起入瞬移链）
      if ($id("dsh-z-sit").checked && life) {
        var hpPct2 = life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
        var spPct2 = life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
        var lo = parseInt($id("dsh-z-sithplo").value, 10) || 40;
        var hi = parseInt($id("dsh-z-sithphi").value, 10) || 80;
        var sLo = parseInt($id("dsh-z-sitsplo").value, 10) || 30;
        var sHi = parseInt($id("dsh-z-sitsphi").value, 10) || 70;
        var shouldSit = (hpPct2 < lo || spPct2 < sLo) && !($id("dsh-z-sitnofight").checked && mobs.length > 0) && !pendingPick;
        var winOpen = false; // V2.8.3：游戏窗口(pt-page 弹层)打开期间不点坐/站——防引擎"点外部关窗"把窗口关掉
        try {
          var pgs = (document.getElementById("vbk") || document).querySelectorAll("[class*='pt-page']");
          for (var pi = 0; pi < pgs.length; pi++) {
            var pst = getComputedStyle(pgs[pi]);
            if (pst.display === "none") continue;
            var pr = pgs[pi].getBoundingClientRect();
            if (pr.width > 100 && pr.height > 100) { winOpen = true; break; }
          }
        } catch (e2) {}
        var sitBtn = document.querySelector(".sitButton, .btn.sit button");
        var standBtn = document.querySelector(".standButton");
        if (shouldSit && sitBtn && !defSnap.sitting && isActFreeOnline("sit") && !winOpen) {
          try { sitBtn.click(); } catch (e) {}
          sitSince = Date.now(); sitHpAt = hpPct2;
          lockAct("sit", 60000);
        }
        else if (!shouldSit && defSnap.sitting && standBtn && hpPct2 > hi && spPct2 > sHi && !winOpen) {
          try { standBtn.click(); } catch (e) {}
          sitSince = 0; sitHpAt = -1;
          if (actLock.act === "sit") actLock.act = null;
        }
        // 看门狗：坐下 30s 血未回升（坐不住）→ 站起；战斗图被围 → 下周期并入瞬移链
        if (defSnap.sitting && sitSince && (now - sitSince > 30000) && !winOpen && hpPct2 <= (sitHpAt >= 0 ? sitHpAt + 2 : hpPct2)) {
          try { if (standBtn) standBtn.click(); } catch (e) {}
          sitSince = 0; sitHpAt = -1;
          if (actLock.act === "sit") actLock.act = null;
          if (isCombatMap && mobs.length > 0 && !needFly) { needFly = true; reason = "坐下不回血避战"; }
        }
      }
      // V1.9.4 面板防御状态行
      var dsEl = $id("dsh-defstate");
      if (dsEl) {
        if (needFly) dsEl.textContent = "防御状态：瞬移(" + reason + ")";
        else if (defSnap.sitting) dsEl.textContent = "防御状态：坐下回血";
        else if (potNoPotion && life && life.maxhp > 0 && (life.hp / life.maxhp * 100) < (parseInt($id("dsh-pothealhp").value, 10) || 40) && mobs.length > 0) dsEl.textContent = "防御状态：低血无药被围";
        else dsEl.textContent = "防御状态：正常";
      }
    } catch (e) {}
  }
  function doFly() {
    try {
      if (!clientReady()) return false;
      var mode = $id("dsh-z-flymode").value;
      // V1.7.0 默认「瞬移术→翅膀」：瞬移术Lv1 成功判定（已学+SP足）失败才回退苍蝇翅膀
      if (mode === "瞬移术→翅膀") {
        if (castTeleport()) return true;
        var wingfb = findFlyWing();
        if (wingfb && useItemByIndex(wingfb.index)) {
          zWalkState.dir = Math.floor(Math.random() * 8); // 瞬移后随机换方向，避免走回原地
          zWalkState.lastPos = null; zWalkState.stuckCnt = 0; zWalkState.tried = 0;
          tlog("fly-item-" + wingfb.itid);
          return true;
        }
        return false; // 无瞬移术也无翅膀 → 计失败（V1.9.4 失败冷却用）
      }
      // 优先苍蝇翅膀（模糊搜索：名字含翅膀 + 描述确认瞬移效果）→ 用背包物品；否则瞬移术
      if (mode === "苍蝇翅膀优先" || mode === "翅膀→瞬移术") {
        var wing = findFlyWing();
        if (wing && useItemByIndex(wing.index)) {
          zWalkState.dir = Math.floor(Math.random() * 8); // 瞬移后随机换方向，避免走回原地
          zWalkState.lastPos = null; zWalkState.stuckCnt = 0; zWalkState.tried = 0;
          tlog("fly-item-" + wing.itid);
          return true;
        }
        if (mode === "翅膀→瞬移术" && $id("dsh-z-flyauto").checked) return castTeleport();
        return false;
      }
      if (mode === "瞬移术Lv1") return castTeleport();
      return false;
    } catch (e) { return false; }
  }
  // 模糊搜索背包中的瞬移翅膀（苍蝇翅膀系列）：名字含"翅膀"，且确认具备瞬间移动效果
  function findFlyWing() {
    try {
      var inv = findInventory();
      if (!inv) return null;
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i] || {};
        var itid = it.ITID != null ? it.ITID : (it.itemid != null ? it.itemid : null);
        if (itid == null) continue;
        var info = null;
        try { info = DB && typeof DB.getItemInfo === "function" && DB.getItemInfo(itid); } catch (e) {}
        var nm = (info && (info.identifiedDiSPlayName || info.name)) || "";
        var desc = (info && (info.identifiedDescriptionName || "")) || "";
        // 名字含"翅膀"（苍蝇翅膀/巨型苍蝇翅膀…）且描述确认瞬移效果（排除蝴蝶翅膀=回城）
        var isFly = /翅膀|fly\s*wing/i.test(nm);
        if (!isFly) continue;
        var isTeleport = /瞬移|瞬间移动|随机移动/i.test(desc) || /苍蝇/i.test(nm);
        if (isTeleport) return { index: it.index != null ? it.index : i, itid: itid, name: nm };
      }
      return null;
    } catch (e) { return null; }
  }
  function useItemByIndex(index) {
    try {
      var p = new CLIENT.PS.CZ.USE_ITEM();
      p.index = index;
      CLIENT.NM.sendPacket(p);
      return true;
    } catch (e) { return false; }
  }
  function useItemById(itemid) {
    try {
      var inv = findInventory();
      if (!inv) return false;
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i] || {};
        if (it.ITID === itemid || it.itemid === itemid) {
          return useItemByIndex(it.index != null ? it.index : i);
        }
      }
      return false;
    } catch (e) { return false; }
  }
  // 瞬移术成功判定（V1.7.0）：技能26(AL_TELEPORT)已学 且 SP≥10 才发；失败=false（调用方回退翅膀）
  function castTeleport() {
    try {
      var lv = 0;
      try { lv = learnedSkillLv(26); } catch (e) {}
      if (!lv) { tlog("fly-skill-nolearn"); return false; }
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      var sp = ent && ent.life ? ent.life.sp : null;
      if (sp != null && sp < 10) { tlog("fly-skill-losp"); return false; }
      var p = new CLIENT.PS.CZ.USE_SKILL();
      p.SKID = 26; // AL_TELEPORT 瞬移术
      p.selectedLevel = 1;
      p.targetID = 0;
      CLIENT.NM.sendPacket(p);
      zWalkState.dir = Math.floor(Math.random() * 8); // 瞬移后随机换方向
      zWalkState.lastPos = null; zWalkState.stuckCnt = 0; zWalkState.tried = 0;
      tlog("fly-skill-teleport");
      return true;
    } catch (e) { return false; }
  }
  function findInventory() {
    try {
      // 优先从 UIManager 组件实例取背包 .list（数据源已由探针 v0.13.17 确认：inventory/BasicInventory.list）
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
            if (inst && Array.isArray(inst.list) && inst.list.length && inst.list[0] && typeof inst.list[0] === "object" && ("ITID" in inst.list[0] || "itemid" in inst.list[0])) return inst.list;
          }
        }
      } catch (e) {}
      // 兜底：旧客户端 SessionStorage 顶层直接挂的背包数组
      if (CLIENT.SS) {
        var keys = Object.keys(CLIENT.SS);
        for (var i = 0; i < keys.length; i++) {
          var v = CLIENT.SS[keys[i]];
          if (v && typeof v === "object" && Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && ("ITID" in v[0] || "itemid" in v[0])) return v;
        }
      }
    } catch (e) {}
    return null;
  }

  // ---- 助手攻击循环 ----
  // 内挂面板开关读取：vbk 面板 .openattack checkbox（自动战斗）当前勾选状态 = 服务器内挂实际开关
  // toggle 语义下必须与服务器同步，否则发错次数会反相；用户可能手动在内挂面板点过 → 启动时校准
  function npReadPanelState() {
    try {
      var el = document.querySelector(".openattack");
      if (el) return !!el.checked;
    } catch (e) {}
    return null; // 面板不可读（未知）
  }
  // 校准本地 npHuntOn 与内挂面板实际状态一致（防用户误操作导致 toggle 反相）
  function npCalibrate() {
    try {
      var panel = npReadPanelState();
      if (panel === null) return; // 读不到就不动（保持本地跟踪）
      if (panel !== npHuntOn) {
        dshDiag("np-calibrate", { panel: panel, local: npHuntOn });
        tlog("np-calibrate panel=" + panel + " local=" + npHuntOn + " → 同步");
        npHuntOn = panel; // 与服务器实际状态对齐
      }
    } catch (e) {}
  }
  function startZhu() {
    if (zRunning) return;
    zRunning = true;
    $id("dsh-z-state").textContent = "助手运行中…";
    startScan();
    // 重置锁定模式/监控：重新开始一轮自动战斗（含「打死换下一个=关」的停手状态）
    zLock.gid = null; zLock.name = ""; zLock.dist = null; zLock.done = false;
    zMon.action = "启动中";
    zUseCounts = {}; // V1.7.0 重置本轮技能释放次数（maxUses）
    zLockCounts = {}; // V1.7.5 重置锁定次数（开/停自动战斗清空）
    dshDiag("zhu-start", { mode: npHuntMode(), panel: (function () { try { return npReadPanelState(); } catch (e) { return null; } })() });
    // 内挂机制寻怪：启动时先校准内挂面板实际开关状态（防用户手动点过内挂开关导致 toggle 不同步），
    // 再同步锁定目录给内挂（服务器寻怪只追锁定怪）
    if (npHuntMode() === "np") {
      npCalibrate();
      npSyncTargets();
      tlog("zhu-start np-hunt");
    }
    var sec = Math.max(0.3, parseFloat($id("dsh-z-attint").value) || 0.5);
    zAttTimer = setInterval(zAttack, sec * 1000);
    setStatus("助手模式已启动（扫描+攻击）", "ok");
  }
  function stopZhu() {
    zRunning = false;
    stopScan();
    if (zAttTimer) { clearInterval(zAttTimer); zAttTimer = null; }
    // 内挂机制寻怪：停止时关闭内挂自动战斗
    npHuntStop();
    zLock.gid = null; zLock.done = false; // 解除锁定/停手状态
    zUseCounts = {}; // V1.7.0 重置本轮技能释放次数（maxUses）
    zLockCounts = {}; // V1.7.5 重置锁定次数（开/停自动战斗清空）
    dshDiag("zhu-stop");
    zMon.action = "已停止";
    $id("dsh-z-state").textContent = "助手未启动";
    setStatus("助手模式已停止", "st");
  }
  // 无目标自动走路寻怪（2s 判定一次）
  // 直走策略：持续朝一个方向走 + A*避障，遇障碍/卡住才转向（不再 8 方向轮转兜圈）
  // ================= 坐标走路（指定 xy / 走到 NPC / 跨图落点共用原语）=================
  // moveXY.busy 全局移动锁：手动走路期间，自动寻怪走位 / 跟随 / 拾取接近一律让位，避免移动打架
  // 走路原语 = pathFindTo(A* 避障) 循环 REQUEST_MOVE，曼哈顿距离 ≤2 判到达停（与跟随 tickFollow 同款模式）
  var moveXY = { busy: false, tx: 0, ty: 0, since: 0, last: 0, fail: 0, onArrive: null, logId: "dsh-mvlog" };
  function mvLog(msg) {
    try { var el = $id(moveXY.logId); if (el) el.textContent = msg; } catch (e) {}
    try { setStatus(msg, "st"); } catch (e) {}
  }
  function walkToXY(tx, ty, onArrive, logId) {
    try {
      if (!clientReady()) { mvLog("客户端未就绪"); return false; }
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) { mvLog("未获取到角色坐标"); return false; }
      moveXY.busy = true;
      moveXY.tx = Math.floor(tx);
      moveXY.ty = Math.floor(ty);
      moveXY.since = Date.now();
      moveXY.last = 0;
      moveXY.fail = 0;
      moveXY.onArrive = (typeof onArrive === "function") ? onArrive : null;
      moveXY.logId = logId || "dsh-mvlog";
      mvLog("走路中 → (" + moveXY.tx + "," + moveXY.ty + ")");
      return true;
    } catch (e) { return false; }
  }
  function stopWalkXY() {
    moveXY.busy = false;
    moveXY.onArrive = null;
    mvLog("走路已停止");
  }
  // 引擎点地走 y() 同款：目标格不可走时 3×3 由近及远吸附到最近可走格（防终点在墙/障碍上被服务器拒收）
  function mvSnapWalkable(tx, ty) {
    try {
      var ALT = window.require && window.require("Renderer/Map/Altitude");
      var WALK = ALT && ALT.TYPE && ALT.TYPE.WALKABLE;
      if (!ALT || !ALT.getCellType || !WALK) return [tx, ty];
      for (var g = 0; g <= 1; ++g)
        for (var e = -g; e <= g; ++e)
          for (var f = -g; f <= g; ++f)
            if (ALT.getCellType(tx + e, ty + f) & WALK) return [tx + e, ty + f];
    } catch (e) {}
    return [tx, ty];
  }
  // V2.10.0 客户端 A* 寻路：基于本图全量地形数据（Renderer/Map/Altitude.getGat().cells）
  // 8 方向、WALKABLE=2 判定、终点吸附可走格；节点上限防卡死，返回路径点数组（不含起点）或 null
  var dshAStarCache = null; // {w, h, cells, types} 缓存（换图自动失效：地图名变化重建）
  function dshAStarData() {
    try {
      var ALT = window.require && window.require("Renderer/Map/Altitude");
      if (!ALT || !ALT.getGat || !ALT.TYPE) return null;
      var g = ALT.getGat();
      if (!g || !g.cells || !g.width || !g.height) return null;
      var mapK = ""; try { var MR2 = window.require && window.require("Renderer/MapRenderer"); if (MR2 && MR2.currentMap) mapK = String(MR2.currentMap); } catch (e) {}
      var mk = mapK + "|" + g.width + "x" + g.height;
      if (!dshAStarCache || dshAStarCache.k !== mk) dshAStarCache = { k: mk, w: g.width, h: g.height, cells: g.cells, walk: ALT.TYPE.WALKABLE || 2 };
      return dshAStarCache;
    } catch (e) { return null; }
  }
  function dshWalkable(x, y) {
    try {
      var d = dshAStarData();
      if (!d) return true;
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
      return (d.cells[x + y * d.w] & d.walk) !== 0;
    } catch (e) { return true; }
  }
  function dshFindPath(sx, sy, tx, ty) {
    try {
      var d = dshAStarData();
      if (!d) return null;
      var s = dshSnapWalk(sx, sy), t = dshSnapWalk(tx, ty);
      if (!s || !t) return null;
      var w = d.w, h = d.h;
      var MAXN = 8000;
      var open = [s], closed = {}, g = {}, f = {}, came = {}, dirs = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      var k0 = s[0] + "," + s[1];
      g[k0] = 0; f[k0] = Math.abs(s[0] - t[0]) + Math.abs(s[1] - t[1]);
      var key = function (x, y) { return x + "," + y; };
      var step = 0;
      while (open.length && step < MAXN) {
        step++;
        // 取 f 最小
        var bi = 0;
        for (var oi = 1; oi < open.length; oi++) { if (f[key(open[oi][0], open[oi][1])] < f[key(open[bi][0], open[bi][1])]) bi = oi; }
        var cur = open.splice(bi, 1)[0];
        var ck = key(cur[0], cur[1]);
        if (cur[0] === t[0] && cur[1] === t[1]) {
          var path = [];
          var nk = ck;
          while (nk != null && nk !== k0) { var pp = nk.split(","); path.unshift([parseInt(pp[0], 10), parseInt(pp[1], 10)]); nk = came[nk] != null ? came[nk] : null; }
          return path;
        }
        if (closed[ck]) continue;
        closed[ck] = true;
        for (var di = 0; di < dirs.length; di++) {
          var nx = cur[0] + dirs[di][0], ny = cur[1] + dirs[di][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!dshWalkable(nx, ny)) continue;
          var nk2 = key(nx, ny);
          if (closed[nk2]) continue;
          var ng = g[ck] + ((di < 4) ? 10 : 14);
          if (g[nk2] == null || ng < g[nk2]) {
            g[nk2] = ng; came[nk2] = ck;
            f[nk2] = ng + Math.abs(nx - t[0]) + Math.abs(ny - t[1]);
            if (open.indexOf(cur) < 0) { var found = false; for (var oi2 = 0; oi2 < open.length; oi2++) { if (open[oi2][0] === nx && open[oi2][1] === ny) { found = true; break; } } if (!found) open.push([nx, ny]); }
          }
        }
      }
      return null; // 超限/不可达
    } catch (e) { return null; }
  }
  function dshSnapWalk(x, y) {
    try {
      var d = dshAStarData();
      if (!d) return [x, y];
      if (dshWalkable(x, y)) return [Math.floor(x), Math.floor(y)];
      for (var g = 1; g <= 4; g++)
        for (var e = -g; e <= g; e++)
          for (var f2 = -g; f2 <= g; f2++) {
            var nx = x + e, ny = y + f2;
            if (nx >= 0 && ny >= 0 && nx < d.w && ny < d.h && dshWalkable(nx, ny)) return [nx, ny];
          }
      return null;
    } catch (e) { return [x, y]; }
  }

  function tickMoveXY() {
    if (!moveXY.busy) return;
    try {
      if (!clientReady()) { moveXY.busy = false; mvLog("客户端掉线，停止走路"); return; }
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) return;
      var d = Math.abs(ent.position[0] - moveXY.tx) + Math.abs(ent.position[1] - moveXY.ty);
      if (d <= 2) {
        moveXY.busy = false;
        mvLog("已到达 (" + moveXY.tx + "," + moveXY.ty + ")");
        var cb = moveXY.onArrive; moveXY.onArrive = null;
        if (cb) { try { cb(); } catch (e) {} }
        return;
      }
      if (Date.now() - moveXY.since > 30000) { moveXY.busy = false; mvLog("走路超时（30s 未到达）已停止"); return; }
      if (Date.now() - moveXY.last < 1000) return; // 1s 节流
      moveXY.last = Date.now();
      // 坐标走路修复：直发终点 REQUEST_MOVE（引擎点地走 onRequestWalk→A() 同款），由服务器寻路；
      // 不再客户端 A*（pathFindTo）分段发中间点——分段发包与服务器寻路节奏冲突致走路失效
      var dest = mvSnapWalkable(moveXY.tx, moveXY.ty); // 终点在墙/障碍上时 3×3 就近吸附可走格
      var pm = new CLIENT.PS.CZ.REQUEST_MOVE();
      pm.dest = [dest[0], dest[1]];
      CLIENT.NM.sendPacket(pm);
    } catch (e) {}
  }
  masterTickReg(function () { try { tickMoveXY(); } catch (e) {} });
  var zWalkState = { lastMove: 0, lastChase: 0, dir: 0, noTargetSince: 0, lastIdleFly: 0, lastPos: null, stuckCnt: 0, tried: 0, lastSeenDir: null, lastSeenAt: 0 };
  var zAStarState = { active: false, tx: 0, ty: 0, since: 0, lastTry: 0, stuckSince: 0, lastPos: null, aim: null }; // V2.10.0 A* 绕障行走状态
  // 状态前置穿插平A计时：zWaitSince = 上次穿插普攻时间（间隔跟随攻击循环，见 zAttack wait 分支）
  var zWaitSince = 0;
  // 补状态节流：距上次补状态技能 <1s 不重复补 → 间隙让普攻穿插（蓄气链不再霸占每轮）
  var zPrepAt = 0;
  // 技能释放最小间隔：放完一次技能（含补状态）后 800ms 内不再放 → 转 wait 穿插普攻（避免技能链霸占每轮）
  var zLastCastAt = 0;
  // 被攻击检测：HP 下降窗口 → 触发「非选中怪攻击」处理（无视/瞬移/还击）
  var zHpWatch = { hp: null, lastHitAt: 0 };
  // ---------- V2.7.3 平A断续修复：NOCTRL 模式发包 ----------
  // vbk 客户端铁证：Preferences/Controls 默认 noctrl:!0（夜RO 默认免ctrl自动攻击开），
  //   点击怪 CZ.REQUEST_ACT 的 action = noctrl ? 7 : 0 → noctrl 开应发 7（脚本旧版硬编码 0 = 断续根因）。
  //   且攻击循环由服务器驱动（发一次锁定后服务器自动连击，客户端发包为0仍持续攻击），
  //   故同目标 1s 节流防重复点击打断服务器攻击循环；换目标/重进射程自然触发新包。
  function npNoCtrlOn() {
    try {
      var PC = window.require && window.require("Preferences/Controls");
      if (PC && PC.noctrl != null) return !!PC.noctrl;
    } catch (e) {}
    return true; // 读不到默认 noctrl 开（该服默认开启）
  }
  var zAtkLast = { gid: null, at: 0 }; // 平A 1s 节流：最近一次 REQUEST_ACT 的目标
  function sendNormalAtk(gid) {
    try {
      if (!clientReady() || !gid) return;
      var now = Date.now();
      if (zAtkLast.gid === gid && now - zAtkLast.at < 1000) return; // 同目标 1s 内不重发（服务器驱动持续攻击）
      var p = new CLIENT.PS.CZ.REQUEST_ACT();
      p.targetGID = gid;
      p.action = npNoCtrlOn() ? 7 : 0; // noctrl 开=7（免ctrl锁定攻击），关=0
      CLIENT.NM.sendPacket(p);
      zAtkLast.gid = gid;
      zAtkLast.at = now;
    } catch (e) {}
  }
  // 客户端 A* 避障寻路：从玩家到目标点，返回沿路径约 5 格处的移动目标点（含路径点数）
  function pathFindTo(tx, ty) {
    try {
      var PF = window.require("Utils/PathFinding");
      var ent = CLIENT.SS.Entity;
      if (!PF || typeof PF.search !== "function" || !ent || !ent.position) return null;
      var out = new Int16Array(256);
      var n = PF.search(Math.floor(ent.position[0]), Math.floor(ent.position[1]), Math.floor(tx), Math.floor(ty), 0, out);
      if (!n || n < 2) return null;
      // 沿路径累计约 5 格（避免一格一格走太慢，也不一次跳太远）
      var px = out[0], py = out[1], dist = 0, pick = 1, maxI = Math.min(n - 1, 12);
      for (var i = 1; i <= maxI; i++) {
        var nx = out[i * 2], ny = out[i * 2 + 1];
        dist += Math.abs(nx - px) + Math.abs(ny - py);
        px = nx; py = ny; pick = i;
        if (dist >= 5) break;
      }
      return { x: out[pick * 2], y: out[pick * 2 + 1], n: n };
    } catch (e) { return null; }
  }
  function zWalk() {
    try {
      if (!clientReady()) return;
      if (moveXY.busy) return; // 手动坐标走路中 → 自动寻怪走位让位
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.position) return;
      var now = Date.now();
      // 坐下时不启动自动寻怪（内挂发包 + 自研直走都不做）——回血/回蓝期间保持静止
      // 客户端实证：Entity.ACTION.SIT=2，实体字段 ent.action === ent.ACTION.SIT
      var isSitting = false;
      try {
        var ACT = ent.ACTION || {};
        isSitting = ent.action === ACT.SIT || ent.action === 2;
      } catch (e) {}
      if (isSitting) return;
      // np 模式（内挂机制寻怪）不设 2s 走路门槛：发包时机由状态机控制（可攻击→停、无怪/超出→发）
      // 否则每次巡怪都要等满 2s 才发内挂指令（用户反馈的「巡怪延迟」）
      var npMode = npHuntMode() === "np";
      // V2.7.3：2s 判定门槛下移到「无怪直走」段；追怪用独立 1s 节流（缩短锁定→出手周期）
      // 优先：找最近的锁定怪（任意距离）→ 避障寻路走过去
      var EM = window.require("Renderer/EntityManager");
      var anyLock = Object.keys(lockList).length > 0;
      var beingHit = (now - zHpWatch.lastHitAt) < 3000; // 被攻击中
      var onaMode = $id("dsh-z-ona") ? $id("dsh-z-ona").value : "还击";
      var allowHitTarget = beingHit && onaMode === "还击"; // 被攻击且设置为还击 → 非锁定怪也追
      var near = null, nearD = 1e9;
      if (EM && EM.forEach) {
        EM.forEach(function (e) {
          try {
            if (e.objecttype !== 5) return;
            if (e.isDeath) return;
            if (e.ACTION && e.action != null && e.action === e.ACTION.DIE) return;
            if (e.remove_tick) return;
            var mid = e._job != null ? String(e._job) : (e.job != null ? String(e.job) : null);
            if (anyLock && mid && !lockList[mid] && !allowHitTarget) return;
            if (!ent.position || !e.position) return;
            var d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
            if (d < nearD) { nearD = d; near = e; }
          } catch (e2) {}
        });
      }
      // V2.9.0 方向记忆：记下最近一次锁定怪相对方位（10s 有效），无怪直走时优先朝该方向
      try {
        if (near && ent && ent.position && near.position) {
          var rdx = near.position[0] - ent.position[0];
          var rdy = near.position[1] - ent.position[1];
          zWalkState.lastSeenDir = ((Math.round(Math.atan2(rdy, rdx) / (Math.PI / 4))) % 8 + 8) % 8;
          zWalkState.lastSeenAt = now;
        }
      } catch (e4) {}

      if (near) {
        // V2.9.0 内挂模式主动追怪：锁定怪超射程 → 关内挂一次（防拉锯），助手直发移动靠近（服务器寻路）
        // 完全无锁定怪时才由下方 np 分支重新开内挂兜底
        if (npMode) {
          var atkR0 = calcAtkRange();
          if (nearD > atkR0) {
            if (npHuntOn) npHuntStop(); // 超射程：关内挂一次（助手接管移动），防每轮 toggle 拉锯
            setStatus("锁定怪超出攻击范围(" + nearD + ">" + atkR0 + ")，助手主动追怪靠近中…", "ok");
          } else {
            if (npHuntOn) npHuntStop();
          }
        }
        // V2.7.3：追怪直发怪坐标（服务器寻路，不再 pathFindTo 取 5 格小步）；V2.9.0 节流读设置
        var chaseInt = (parseFloat($id("dsh-z-chaseint").value) || 0.5) * 1000;
        if (now - zWalkState.lastChase < chaseInt) return;
        zWalkState.lastChase = now;
        var cDest = mvSnapWalkable(Math.round(near.position[0]), Math.round(near.position[1]));
        zWalkState.noTargetSince = 0; // 有目标，重置无目标计时
        var pm = new CLIENT.PS.CZ.REQUEST_MOVE();
        pm.dest = [cDest[0], cDest[1]];
        CLIENT.NM.sendPacket(pm);
        tlog("walk-追怪 " + (near._job != null ? near._job : near.GID) + " -> " + cDest[0] + "," + cDest[1]);
        setStatus("发现目标，直发追怪…", "ok");
        return;
      }
      // 无锁定怪持续 N 秒 → 自动瞬移换位置（苍蝇/瞬移术）
      var idleFly = $id("dsh-z-idlefly") && $id("dsh-z-idlefly").checked;
      if (idleFly) {
        if (!zWalkState.noTargetSince) zWalkState.noTargetSince = now;
        var idleSec = (parseInt($id("dsh-z-idleflysec").value, 10) || 10) * 1000;
        if (now - zWalkState.noTargetSince >= idleSec && now - zWalkState.lastIdleFly >= 15000) {
          zWalkState.lastIdleFly = now;
          zWalkState.noTargetSince = 0;
          doFly();
          setStatus("无目标" + Math.round(idleSec / 1000) + "s，自动瞬移换点…", "warn");
          return;
        }
      } else { zWalkState.noTargetSince = 0; }
      // 内挂机制寻怪（用户需求状态机）：
      //   - 侦查扫到「可攻击到的锁定怪」（dist ≤ atkRange，非超出）→ 停内挂，助手接管战斗
      //   - 侦查没扫到怪 / 附近只有「超出」的锁定怪 → 持续发包让服务器自动寻怪（内挂移动靠近）
      if (npHuntMode() === "np") {
        if (!scanHasAttackableLockedMob(calcAtkRange())) {
          npEnsureHunt();
          if (scanHasOutOfRangeLockedMob(calcAtkRange())) {
            setStatus("锁定怪超出攻击范围，内挂移动靠近中…", "st");
          } else {
            setStatus("侦查未扫到可攻击锁定怪，内挂自动寻怪中…", "st");
          }
        } else {
          if (npHuntOn) npHuntStop();
          tlog("np-hunt-stop 侦查扫到可攻击锁定怪");
          setStatus("侦查扫到可攻击锁定怪，内挂寻怪已停（助手接管）…", "ok");
        }
        return;
      }
      // 无怪 / 不可达 → 定向直走寻怪：持续朝一个方向走（A* 避障），遇障/卡住才转向
      // V2.7.3：直走 2s 节流（追怪已独立 1s，不占用此门槛）
      // V2.9.0：直走节流读设置（默认 0.5s，可调 0.3~2s）；追怪已独立节流，不占用此门槛
      var walkInt = Math.max(0.3, Math.min(2, parseFloat($id("dsh-z-walkint").value) || 0.5)) * 1000;
      if (!npMode && now - zWalkState.lastMove < walkInt) return;
      if (!npMode) zWalkState.lastMove = now;
      // 8 方向（0=右,1=右下,2=下,3=左下,4=左,5=左上,6=上,7=右上）
      var dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      // V2.9.0 方向记忆：10s 内侦查扫到过锁定怪 → 优先朝该方向走（不再纯 8 方向盲转）
      if (now - zWalkState.lastSeenAt < 10000 && zWalkState.lastSeenDir != null) {
        zWalkState.dir = zWalkState.lastSeenDir;
        zWalkState.stuckCnt = 0;
      }
      var WALK_RANGE = 12; // 每次向目标方向走 12 格
      var px0 = Math.round(ent.position[0]), py0 = Math.round(ent.position[1]);
      // 卡住检测：本周期坐标与上周期几乎没动 → 计数，连续 2 次卡住就转向
      if (zWalkState.lastPos) {
        var moved = Math.abs(px0 - zWalkState.lastPos[0]) + Math.abs(py0 - zWalkState.lastPos[1]);
        if (moved < 3) zWalkState.stuckCnt++;
        else zWalkState.stuckCnt = 0;
      }
      zWalkState.lastPos = [px0, py0];
      if (zWalkState.stuckCnt >= 2) {
        zWalkState.dir = (zWalkState.dir + 1) % dirs.length; // 卡住 → 顺时针转一个方向
        zWalkState.stuckCnt = 0;
        zWalkState.tried = 0;
        tlog("walk-stuck turn dir=" + zWalkState.dir);
        setStatus("前方卡住，转向 " + zWalkState.dir, "warn");
      }
      // V2.10.0 A* 绕障寻路（dsh-z-astar 开关）：方向预检只是直线 12 格，环绕结构图（回字形/迷宫）会原地打转。
      //   A* 基于本图全量地形（ALT.getGat().cells）找真实可达路径 → 只直发路径终点（服务器寻路一次走通，不逐格发包）。
      //   进入「A* 行走中」：发目标后 3~5s 不重发（防重置服务器寻路）；坐标推进即续走；2s 无位移重新 A*。
      var aStarOn = true;
      try { var aEl = document.getElementById("dsh-z-astar"); aStarOn = aEl ? aEl.checked : true; } catch (e) { aStarOn = true; }
      if (aStarOn && dshAStarData()) {
        var done = false;
        // A* 行走中状态管理
        if (zAStarState.active) {
          var movedA = Math.abs(px0 - zAStarState.lastPos[0]) + Math.abs(py0 - zAStarState.lastPos[1]);
          var nearA = Math.abs(px0 - zAStarState.tx) + Math.abs(py0 - zAStarState.ty) <= 2;
          if (nearA) { zAStarState.active = false; }
          else if (movedA < 3) {
            if (!zAStarState.stuckSince) zAStarState.stuckSince = now;
            if (now - zAStarState.stuckSince >= 2000) { zAStarState.active = false; tlog("walk-astar stuck re-path"); }
          } else { zAStarState.stuckSince = 0; }
          zAStarState.lastPos = [px0, py0];
          // 行走中：距上次发包 <3.5s 不重发（防重置服务器寻路）
          if (zAStarState.active) {
            if (now - zAStarState.lastTry < 3500) return;
            // 超时仍在走且未卡：重发同目标（幂等续走）
            if (!zAStarState.stuckSince) { var pmA = new CLIENT.PS.CZ.REQUEST_MOVE(); pmA.dest = [zAStarState.tx, zAStarState.ty]; CLIENT.NM.sendPacket(pmA); zAStarState.lastTry = now; tlog("walk-astar keep -> " + zAStarState.tx + "," + zAStarState.ty); return; }
          }
        }
        // 选目标：方向记忆（10s 内）→ 朝该方向 50 格外；无记忆 → 当前方向延伸
        if (!zAStarState.active) {
          var aimD = dirs[zWalkState.dir];
          if (now - zWalkState.lastSeenAt < 10000 && zWalkState.lastSeenDir != null) aimD = dirs[zWalkState.lastSeenDir];
          var farT = 50;
          var atx = Math.round(px0 + aimD[0] * farT), aty = Math.round(py0 + aimD[1] * farT);
          var pathA = dshFindPath(px0, py0, atx, aty);
          if (pathA && pathA.length) {
            var lastP = pathA[pathA.length - 1];
            var snapA = mvSnapWalkable(lastP[0], lastP[1]);
            var pmA2 = new CLIENT.PS.CZ.REQUEST_MOVE();
            pmA2.dest = [snapA[0], snapA[1]];
            CLIENT.NM.sendPacket(pmA2);
            zAStarState = { active: true, tx: snapA[0], ty: snapA[1], since: now, lastTry: now, stuckSince: 0, lastPos: [px0, py0], aim: [aimD[0], aimD[1]] };
            zWalkState.stuckCnt = 0;
            tlog("walk-astar path " + pathA.length + " -> " + snapA[0] + "," + snapA[1]);
            setStatus("无目标，A*绕障寻怪（方向" + zWalkState.dir + "）…", "st");
            return;
          }
          // A* 无路径 → 落到下方直线预检 + 12 格直发（原逻辑兜底）
        }
      }

      // V2.9.1 方向可走预检：用客户端地形（Altitude GAT，同本图大地图数据）先验证方向再发包
      //   当前方向 12 格内任意一格不可走 → 顺时针找第一个可走方向；全不通 → 瞬移兜底/不发撞墙包
      function dirWalkable(dd, steps) {
        try {
          var ALT = window.require && window.require("Renderer/Map/Altitude");
          var WALK = ALT && ALT.TYPE && ALT.TYPE.WALKABLE;
          if (!ALT || !ALT.getCellType || !WALK || !ALT.width) return true; // 地形未就绪 → 放行（旧逻辑兜底）
          for (var s = 1; s <= steps; s++) {
            if (!(ALT.getCellType(Math.floor(px0 + dd[0] * s), Math.floor(py0 + dd[1] * s)) & WALK)) return false;
          }
          return true;
        } catch (e) { return true; }
      }
      if (!dirWalkable(dirs[zWalkState.dir], WALK_RANGE)) {
        var foundD = -1;
        for (var ti2 = 1; ti2 <= 8; ti2++) {
          var cand = (zWalkState.dir + ti2) % dirs.length;
          if (dirWalkable(dirs[cand], WALK_RANGE)) { foundD = cand; break; }
        }
        if (foundD >= 0) {
          zWalkState.dir = foundD;
          zWalkState.stuckCnt = 0;
          tlog("walk-precheck turn dir=" + zWalkState.dir);
          setStatus("前方有墙，转到可走方向 " + zWalkState.dir + "…", "st");
        } else {
          zWalkState.tried++;
          if (idleFly && now - zWalkState.lastIdleFly >= 15000) {
            zWalkState.lastIdleFly = now;
            doFly();
            setStatus("四周不可走，瞬移脱困…", "warn");
            return;
          }
          setStatus("四周不可走，等待下一步…", "st");
          return; // 不发撞墙包
        }
      }

      // 当前方向目标点（V2.7.3：直发方向终点 12 格，服务器寻路，不再 pathFindTo 取 5 格小步）
      var dd = dirs[zWalkState.dir];
      var tx = px0 + dd[0] * WALK_RANGE;
      var ty = py0 + dd[1] * WALK_RANGE;
      var dDest = mvSnapWalkable(tx, ty);
      var pmm = new CLIENT.PS.CZ.REQUEST_MOVE();
      pmm.dest = [dDest[0], dDest[1]];
      CLIENT.NM.sendPacket(pmm);
      zWalkState.tried = 0;
      tlog("walk-dir " + zWalkState.dir + " -> " + dDest[0] + "," + dDest[1]);
      setStatus("无目标，直走寻怪（方向" + zWalkState.dir + "）…", "st");
      return;
      // 当前方向不可达（撞墙/边界）→ 转向再试
      zWalkState.tried++;
      if (zWalkState.tried >= 8) {
        // 8 个方向都不通 → 原地瞬移兜底（若有启用），否则重置从头再试
        zWalkState.tried = 0;
        if (idleFly && now - zWalkState.lastIdleFly >= 15000) {
          zWalkState.lastIdleFly = now;
          doFly();
          setStatus("四周不通，瞬移脱困…", "warn");
          return;
        }
      }
      zWalkState.dir = (zWalkState.dir + 1) % dirs.length;
      tlog("walk-block turn dir=" + zWalkState.dir);
      setStatus("前方障碍，转向 " + zWalkState.dir + "…", "st");
      // 转向后立刻走新方向（V2.7.3：直发新方向终点，服务器寻路）
      var dd2 = dirs[zWalkState.dir];
      var tx2 = px0 + dd2[0] * WALK_RANGE;
      var ty2 = py0 + dd2[1] * WALK_RANGE;
      var dDest2 = mvSnapWalkable(tx2, ty2);
      var pm2 = new CLIENT.PS.CZ.REQUEST_MOVE();
      pm2.dest = [dDest2[0], dDest2[1]];
      CLIENT.NM.sendPacket(pm2);
      tlog("walk-turn-go " + zWalkState.dir + " -> " + dDest2[0] + "," + dDest2[1]);
      setStatus("转向后前进（方向" + zWalkState.dir + "）…", "st");
    } catch (e) {}
  }
  // 换怪延迟控制：打完一只 → 等待设定秒数 → 再找下一只攻击
  var zLastTargetGID = null, zTargetSwitchAt = 0;
  // 锁定模式（内挂式锁定）：固定一个目标持续攻击，防目标漂移（每轮不再选「最近的」导致打一下换一只）
  //   gid=锁定目标GID；name=显示名；dist=距离；done=「打死换下一个=关」时击杀后停手标志
  var zLock = { gid: null, name: "", dist: null, done: false };
  // 战斗监控：zAttack 各分支写入当前动作，主循环渲染到游戏正上方浮层 #dsh-ro-z-hud（锁定/动作/HP·SP）
  var zMon = { action: "未启动" };
  // 被攻击检测（轮询）：HP 比上次记录下降 ≥1 → 认为被攻击（记录命中时间）
  function updateHpWatch(ent) {
    try {
      if (!ent || !ent.life) return;
      var hp = ent.life.hp;
      if (hp == null) return;
      if (zHpWatch.hp != null && hp < zHpWatch.hp - 1) zHpWatch.lastHitAt = Date.now();
      zHpWatch.hp = hp;
    } catch (e) {}
  }
  function zAttack() {
    try {
      if (!clientReady()) return;
      var ent = CLIENT.SS.Entity;
      if (!ent || !ent.life) return;
      var now = Date.now();
      // V2.7.2 锁定怪站桩修复：np 模式（内挂机制寻怪）→ 目标判定强制 ld<=atkRange（射程外锁定怪不当目标、
      //   不解锁、交内挂移动靠近），杜绝「npHuntStop 关内挂⇄zWalk npEnsureHunt 开内挂」每轮拉锯站桩
      var npMode = npHuntMode() === "np";
      updateHpWatch(ent);
      var EM = window.require("Renderer/EntityManager");
      var range = parseInt($id("dsh-z-range").value, 10) || 12; // 寻怪范围（触发目标考虑）
      // 攻击距离：物理/魔法按技能射程自动选择（普攻=物理距离；技能=技能射程与对应距离取大）
      var pmRange = parseInt($id("dsh-z-pmrange").value, 10) || 2;
      var mgRange = parseInt($id("dsh-z-mgrange").value, 10) || 9;
      var atkRange = calcAtkRange(); // 技能顺序中最大射程+1 或 普攻物理距离
      var anyLock = Object.keys(lockList).length > 0;
      // 非选中怪攻击选项：无视/瞬移/还击
      var onaMode = $id("dsh-z-ona") ? $id("dsh-z-ona").value : "还击";
      // 被攻击中？最近 3s 内 HP 下降过
      var beingHit = (now - zHpWatch.lastHitAt) < 3000;
      // 「打死换下一个=关」：锁定目标已击杀 → 完全停手（等待用户重新开自动战斗）
      if (zLock.done) {
        zMon.action = "已停手（等指令）";
        setStatus("锁定目标已击杀（打死换下一个=关），等待重新开启…", "st");
        return;
      }
      var zFollow = !$id("dsh-z-follow") || $id("dsh-z-follow").checked; // 锁定目标跟随追击
      var zNext = !$id("dsh-z-next") || $id("dsh-z-next").checked;       // 打死换下一个
      var target = null, best = 1e9;
      var hitTarget = null, hitBest = 1e9;
      // 锁定模式：已锁定目标 → 只认锁定目标（固定 GID 持续攻击，防目标漂移），不重新扫描选最近
      var lockAliveOutside = false; // V2.7.2：锁定怪仍在但超攻击距离（np 模式下不解锁）
      if (zLock.gid) {
        EM.forEach(function (e) {
          try {
            if (e.GID !== zLock.gid || e.objecttype !== 5) return;
            if (e.isDeath || (e.ACTION && e.action === e.ACTION.DIE) || e.remove_tick) return;
            if (!ent.position || !e.position) return;
            var ld = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
            // follow 开：寻怪范围内持续打/追；follow 关：仅攻击距离内，超出即解锁
            // V2.7.2：np 模式下无论 follow 一律仅攻击距离内才当战斗目标（射程外交内挂靠近）
            if (npMode ? ld <= atkRange : (zFollow ? ld <= range : ld <= atkRange)) { target = e; zLock.dist = ld; }
            else if (npMode && ld > atkRange) lockAliveOutside = true;
          } catch (e2) {}
        });
        if (target) {
          zLock.name = (target.display && target.display.name) || String(target._job != null ? target._job : target.GID);
        } else if (npMode && lockAliveOutside) {
          // V2.7.2 站桩修复：np 模式下锁定怪仍存活但超出攻击距离 → 不解锁（交内挂移动靠近，由 zWalk np 分支 ensureHunt）
          zMon.action = "锁定怪超出射程（内挂靠近）";
        } else {
          // 目标死亡/丢失 → 解锁；next=关 时击杀后停手（done），否则重新扫描换下一个
          zLock.done = !zNext;
          zLock.gid = null;
          zLockCounts = {}; // V1.7.5 解锁 → 锁定次数清零（重新锁定重计）
          tlog("lock-release done=" + zLock.done);
        }
      }
      // 无锁定目标 → 扫描选目标：锁定怪里最近的（攻击距离内）；非锁定怪仅作「还击」候选
      if (!target) {
        EM.forEach(function (e) {
          try {
            if (e.objecttype !== 5) return;
            // 跳过死亡实体：isDeath / ACTION.DIE / 已在移除队列
            if (e.isDeath) return;
            if (e.ACTION && e.action != null && e.action === e.ACTION.DIE) return;
            if (e.remove_tick) return;
            var mid = e._job != null ? String(e._job) : (e.job != null ? String(e.job) : (e.mobId != null ? String(e.mobId) : null));
            var inLock = !anyLock || (mid && lockList[mid]);
            if (!ent.position || !e.position) return;
            var d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
            if (inLock) {
              // 锁定怪：攻击距离内直接打（atkRange）；超出但寻怪范围内 → 由 zWalk 追击
              if (d <= atkRange && d < best) { best = d; target = e; }
            } else {
              // 非锁定怪：仅用于「还击」候选（攻击距离内最近的）
              if (d <= atkRange && d < hitBest) { hitBest = d; hitTarget = e; }
            }
          } catch (e2) {}
        });
        // 扫到新目标 → 锁定（固定 GID，直到打死/丢失才换）
        if (target) {
          zLock.gid = target.GID;
          zLock.name = (target.display && target.display.name) || String(target._job != null ? target._job : target.GID);
          zLock.dist = best;
        }
      }
      // 被攻击处理（非选中怪攻击）：有锁定目标 → 正常打锁定；无锁定目标但被攻击 → 按设置处理
      if (!target && beingHit && hitTarget) {
        if (onaMode === "无视") { /* 不反击，继续寻怪 */ }
        else if (onaMode === "瞬移") {
          doFly();
          zMon.action = "瞬移脱离";
          setStatus("被非目标怪攻击，瞬移脱离…", "warn");
          return;
        }
        else { target = hitTarget; setStatus("被攻击，还击 " + (hitTarget.display && hitTarget.display.name || ""), "ok"); }
      }
      // 换怪延迟：目标变化时记录延迟点；延迟窗口内不攻击（等设定秒数再出手）
      var switchDelay = (parseFloat($id("dsh-z-switchdelay").value) || 0.3) * 1000;
      if (target) {
        if (zLastTargetGID !== target.GID) {
          zLastTargetGID = target.GID;
          zTargetSwitchAt = now + switchDelay;
          zLockCounts = {}; // V1.7.5 换目标 → 锁定次数清零重计
          zCastIdx = 0;     // V1.7.5 换目标 → 轮换游标从头开始
        }
        if (now < zTargetSwitchAt) { zMon.action = "换怪延迟"; return; } // 延迟窗口内等待（换怪延迟）
      } else {
        zLastTargetGID = null; // 无目标，重置以便下次直接出手
      }
      if (!target) { zMon.action = "寻怪（走路）"; zWalk(); return; } // 无目标 → 自动走路寻怪
      // 开始战斗（有目标）→ 结束内挂自动寻怪（避免服务器驱动移动与助手抢控制）
      if (npHuntOn) npHuntStop();
      zWalkState.lastMove = 0; // 打到目标，重置走路计时
      zWalkState.noTargetSince = 0; // 有目标，重置无目标瞬移计时
      // ============ 两层并行决策（内挂锁定模式动作） ============
      // 第二层【并行判断层】：castOrderSkill 每轮并行扫描全部技能——前置+射程满足 → 已发技能包
      //   （return true）；前置满足但超射程 → "walk" 走近再放；技能冷却窗口 → "wait-cd"；
      //   全部不满足 → "wait"。
      // 第一层【默认锁定层】：技能层不动作时 → 对锁定目标持续普攻（「穿插平A」开关控制，合并原
      //   锁定普攻开关）：REQUEST_ACT 固定 target.GID（内挂锁定模式动作），目标死亡/丢失才由
      //   zLock 解锁换目标。锁定普攻只作兜底，从不阻塞技能层判断；每轮只发一个动作包（技能优先）。
      // 「穿插平A」开=技能放不出/冷却/无技能时一律普攻兜底；关=纯技能流（法师等不摸怪）。
      var attMix = $id("dsh-z-attmix") ? $id("dsh-z-attmix").checked : true;
      var order = parseSkillOrder($id("dsh-skillorder").value);
      var cast = castOrderSkill(order, target);
      if (cast === "walk") {
        zWaitSince = 0; // 走位后穿插普攻立即出手（上次普攻时间重置）
        zMon.action = "追怪（走近施放）";
        // 技能前置满足但超射程 → 走位靠近后再打（客户端同款：先 REQUEST_MOVE 走近）
        zWalk();
        return;
      }
      if (cast === "wait-cd") {
        // 技能释放冷却窗口（技能层内部冷却）→ 开=冷却间隙补普攻；关=干等技能
        if (!attMix) {
          zMon.action = "技能冷却中";
          setStatus("技能释放冷却中…", "st");
          return;
        }
        var distCd = Math.abs(target.position[0] - ent.position[0]) + Math.abs(target.position[1] - ent.position[1]);
        if (distCd <= pmRange) {
          sendNormalAtk(target.GID); // V2.7.3 NOCTRL 平A（action 跟随 noctrl；同目标 1s 节流，服务器驱动连击）
          zMon.action = "穿插平A(冷却)";
          setStatus("技能冷却，穿插平A…", "st");
          return;
        }
        zMon.action = "追怪（普攻射程外）";
        zWalk();
        return;
      }
      if (cast === "wait") {
        // 技能层全部不满足（前置缺/补状态节流中）→ 落到第一层：默认锁定普攻
        if (!attMix) {
          zMon.action = "等状态前置";
          setStatus("等状态前置（穿插平A已关，纯技能流）…", "st");
          return;
        }
        // 默认锁定普攻：对锁定目标 REQUEST_ACT（间隔=攻击循环本身，每轮一击，无需额外判断）
        var distToT2 = Math.abs(target.position[0] - ent.position[0]) + Math.abs(target.position[1] - ent.position[1]);
        if (distToT2 <= pmRange) {
          sendNormalAtk(target.GID); // V2.7.3 NOCTRL 平A
          zMon.action = "穿插平A(锁定)";
          setStatus("前置未就绪，锁定普攻…", "st");
          return;
        }
        zMon.action = "追怪（普攻射程外）";
        zWalk();
        return;
      }
      zWaitSince = 0; // 释放成功 → 下次技能层不动作时锁定普攻立即出手
      if (cast === "none" || !cast) {
        // 无技能配置 → 默认锁定普攻（穿插平A关时无技能就不攻击）
        if (!attMix) {
          zMon.action = "未配技能";
          setStatus("未配置技能（穿插平A已关），等待…", "st");
          return;
        }
        var distToT = Math.abs(target.position[0] - ent.position[0]) + Math.abs(target.position[1] - ent.position[1]);
        if (distToT > pmRange) { zMon.action = "追怪（普攻射程外）"; zWalk(); return; }
        sendNormalAtk(target.GID); // V2.7.3 NOCTRL 平A
        zMon.action = "普攻(锁定)";
      } else {
        zMon.action = "施放技能";
      }
    } catch (e) {}
  }
  // 技能行统一序列化（对象 → textarea 行）：统一 6 段 skid:lv:cond:prob:uses:lock，行尾两空格+技能名做注释
  // prob：0-100（0=从不释放）；uses：本轮上限；lock：每次锁定上限；空段 cond 保留，与 parse 双向兼容
  function skillLine(o) {
    var nm = getSkillNameById(o.skid);
    var v = parseInt(o.prob, 10);
    var prob = isNaN(v) ? 100 : Math.max(0, Math.min(100, v));
    var cond = String(o.cond || "").trim();
    var u = parseInt(o.uses, 10);
    var tail = (u > 0 || o.lock > 0) ? (":" + u) : "";
    return o.skid + ":" + (o.lv || 5) + ":" + cond + ":" + prob + tail + (o.lock > 0 ? (":" + o.lock) : "") + (nm ? "  " + nm : "");
  }
  function parseSkillOrder(txt) {
    var out = [];
    var lines = String(txt || "").split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
      var l = lines[li].replace(/#.*$/, "").trim();
      if (!l || !/^\d+/.test(l)) continue;
      var parts = l.split(":");
      var skid = parseInt(parts[0], 10);
      if (isNaN(skid)) continue;
      // 每段取「空格前」有效值（空格后为技能名注释垃圾，如 "100  螺旋击刺" 取 "100"）
      var seg = function (s) { return String(s || "").split(/\s+/)[0] || ""; };
      var lv = 5, cond = "", prob = 100, uses = 0, lock = 0;
      // 段1：等级（纯数字）；非数字则视为无等级（skid:cond[:prob] 老格式）
      if (parts.length >= 2) { var s1 = seg(parts[1]); if (/^\d+$/.test(s1)) lv = parseInt(s1, 10); }
      // 段2：cond（可为空）；纯数字 = prob 误放 cond 位（旧 3 段 skid:lv:prob 或污染行）
      if (parts.length >= 3) {
        var s2 = seg(parts[2]);
        if (/^\d+$/.test(s2)) { prob = parts.length >= 4 ? 100 : parseInt(s2, 10); }
        else { cond = s2; }
      }
      // 段3：prob
      if (parts.length >= 4) { var s3 = seg(parts[3]); if (/^\d+$/.test(s3)) prob = parseInt(s3, 10); }
      // 段4：uses 本轮释放次数上限（V1.7.0 · OpenKore maxUses 语义；0/省略=不限）
      if (parts.length >= 5) { var s4 = seg(parts[4]); if (/^\d+$/.test(s4)) uses = parseInt(s4, 10); }
      // 段5：lock 每次锁定释放次数（V1.7.5 · 锁定一个目标期间最多放N次，换目标清零；0/省略=不限）
      if (parts.length >= 6) { var s5 = seg(parts[5]); if (/^\d+$/.test(s5)) lock = parseInt(s5, 10); }
      if (isNaN(prob)) prob = 100;
      if (prob < 0) prob = 0;
      if (prob > 100) prob = 100;
      if (uses < 0) uses = 0;
      if (lock < 0) lock = 0;
      out.push({ skid: skid, lv: lv, cond: cond, prob: prob, uses: uses, lock: lock });
    }
    return out;
  }
  // 已学技能等级：读客户端 SkillList（服务器 ZC.SKILLINFO_LIST）；未学返回 0
  function learnedSkillLvReal(skid) {
    return learnedSkillLv(skid);
  }
  // 释放等级校正：手动选等级 > 已学 → 降为已学最高级；未学 → 返回 0（调用方跳过）
  function clampSkillLv(skid, wantLv) {
    var have = learnedSkillLv(skid);
    if (have <= 0) return 0;
    return Math.min(wantLv || 5, have);
  }
  // 角色自身状态读取（客户端 Entity 字段，服务器 STATUS_CHANGE 实时写入）
  // 气球=Summon1~5 非0个数；爆气=explosion 字段；另有 berserk(狂暴)/soullink(灵魂)/riding/falcon 等
  function entStatus() {
    var ent = CLIENT.SS && CLIENT.SS.Entity;
    if (!ent) return null;
    var spheres = 0;
    for (var i = 1; i <= 5; i++) if (ent["Summon" + i]) spheres++;
    return {
      ent: ent,
      spheres: spheres,            // 气球/气弹数 0~5
      explosion: ent.explosion ? 1 : 0, // 爆气
      berserk: ent.berserk ? 1 : 0,     // 狂暴
      soullink: ent.soullink ? 1 : 0,   // 灵魂
      riding: ent.riding || ent.riding_ ? 1 : 0,
      falcon: ent.falcon ? 1 : 0,
      cart: ent.cart ? 1 : 0,
      hp: ent.life && ent.life.hp != null ? ent.life.hp : null,
      hpMax: ent.life && ent.life.hp_max != null ? ent.life.hp_max : null,
      sp: ent.life && ent.life.sp != null ? ent.life.sp : null,
      spMax: ent.life && ent.life.sp_max != null ? ent.life.sp_max : null
    };
  }
  // 状态前置判断：cond 形如 "球5,爆气,hp>40,sp>30"（逗号分隔，全部满足才 true）
  // 语法：球N=气球≥N；爆气=爆气中；狂暴；灵魂；hp>P/hp<P；sp>P/sp<P；!xxx=无某状态
  function checkSkillCond(cond) {
    if (!cond) return { ok: true, miss: "" };
    var st = entStatus();
    if (!st) return { ok: false, miss: "状态未知" };
    var parts = cond.split(/[,，]/);
    for (var i = 0; i < parts.length; i++) {
      var c = (parts[i] || "").trim();
      if (!c) continue;
      var neg = c.charAt(0) === "!";
      var cc = neg ? c.substr(1) : c;
      var hit = false;
      var ms = cc.match(/^球(\d+)$/);
      if (ms) hit = st.spheres >= parseInt(ms[1], 10);
      else {
        var mh = cc.match(/^hp([><=])(\d+)$/);
        if (mh) {
          var pct = (st.hp != null && st.hpMax) ? Math.round(st.hp * 100 / st.hpMax) : -1;
          var hv = parseInt(mh[2], 10);
          hit = mh[1] === ">" ? pct > hv : mh[1] === "<" ? pct < hv : pct === hv;
        } else {
          var msp = cc.match(/^sp([><=])(\d+)$/);
          if (msp) {
            var pct2 = (st.sp != null && st.spMax) ? Math.round(st.sp * 100 / st.spMax) : -1;
            var sv = parseInt(msp[2], 10);
            hit = msp[1] === ">" ? pct2 > sv : msp[1] === "<" ? pct2 < sv : pct2 === sv;
          }
        }
      }
      if (cc === "爆气") hit = st.explosion === 1;
      if (cc === "狂暴") hit = st.berserk === 1;
      if (cc === "灵魂") hit = st.soullink === 1;
      if (cc === "骑乘") hit = st.riding === 1;
      if (cc === "猎鹰") hit = st.falcon === 1;
      // V1.7.6 状态名判定通用化：英文（rAthena SC 名）与中文（含 debuff 别名）→ statusActive（实体字段 + 判活环兜底）
      if (!ms && !mh && !msp && cc !== "爆气" && cc !== "狂暴" && cc !== "灵魂" && cc !== "骑乘" && cc !== "猎鹰") hit = statusActive(cc);
      if (neg) hit = !hit;
      if (!hit) return { ok: false, miss: c };
    }
    return { ok: true, miss: "" };
  }
  // 技能类型位（客户端 SkillTargetSelection TYPE）：ENEMY=1 PLACE=2 SELF=4 FRIEND=16 TRAP=32 TARGET=51
  function skillTypeBits(skid) {
    try {
      var SL = window.require && window.require("UI/Components/SkillList/SkillList");
      if (SL && typeof SL.getSkillById === "function") {
        var s = SL.getSkillById(skid);
        if (s && s.type != null) return s.type;
      }
    } catch (e) {}
    try {
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      var si = DB && typeof DB.getSkillInfo === "function" && DB.getSkillInfo(skid);
      if (si && si.type != null) return si.type;
    } catch (e) {}
    return null;
  }

  // ---------------- 技能释放需求表（rAthena skill_db.yml 提取，pre-re 二转 + re 三转 合并）----------------
  // [技能ID, 技能名, 需气弹数, 需状态] —— 仅收录有释放前置的技能；null=无此要求
  // 数据来源：rathena/rathena db/{pre-re,re}/skill_db.yml Requires.SpiritSphereCost / Requires.Status（官方服务器真实校验）
  // 合并规则：pre-re 优先（二转主服），re 覆盖同 ID（三转数值可能不同）；共 94 技能
  var SKILL_REQ = [
    [81, "WZ_SIGHTRASHER", null, "Sight"],
    [137, "AS_GRIMTOOTH", null, "Hiding"],
    [214, "RG_RAID", null, "Hiding"],
    [264, "MO_BODYRELOCATION", 1, null],
    [266, "MO_INVESTIGATE", 1, null],
    [267, "MO_FINGEROFFENSIVE", 1, null],
    [268, "MO_STEELBODY", 5, null],
    [269, "MO_BLADESTOP", 1, null],
    [270, "MO_EXPLOSIONSPIRITS", 5, null],
    [271, "MO_EXTREMITYFIST", 5, "Explosionspirits"],
    [273, "MO_COMBOFINISH", 1, null],
    [370, "CH_PALMSTRIKE", null, "Explosionspirits"],
    [371, "CH_TIGERFIST", 1, null],
    [372, "CH_CHAINCRUSH", 1, null],
    [485, "WS_CARTTERMINATION", null, "Cartboost"],
    [501, "GS_FLING", 5, null],
    [502, "GS_TRIPLEACTION", 1, null],
    [503, "GS_BULLSEYE", 1, null],
    [504, "GS_MADNESSCANCEL", 1, null],
    [505, "GS_ADJUSTMENT", 2, null],
    [506, "GS_INCREASING", 4, null],
    [507, "GS_MAGICALBULLET", 1, null],
    [508, "GS_CRACKER", 1, null],
    [529, "NJ_SHADOWJUMP", null, "Hiding"],
    [530, "NJ_KIRIKAGE", null, "Hiding"],
    [1015, "MO_KITRANSLATION", 1, null],
    [2029, "GC_COUNTERSLASH", null, "Weaponblock_On"],
    [2030, "GC_WEAPONCRUSH", null, "Weaponblock_On"],
    [2031, "GC_VENOMPRESSURE", null, "Poisoningweapon"],
    [2032, "GC_POISONSMOKE", null, "Poisoningweapon"],
    [2037, "GC_CROSSRIPPERSLASHER", null, "Rollingcutter"],
    [2329, "SR_FALLENEMPIRE", 2, null],
    [2330, "SR_TIGERCANNON", 2, "Explosionspirits"],
    [2331, "SR_HELLGATE", 5, null],
    [2332, "SR_RAMPAGEBLASTER", 3, "Explosionspirits"],
    [2333, "SR_CRESCENTELBOW", 2, null],
    [2336, "SR_KNUCKLEARROW", 1, null],
    [2341, "SR_POWERVELOCITY", 5, null],
    [2343, "SR_GATEOFHELL", 2, null],
    [2345, "SR_GENTLETOUCH_CURE", 1, null],
    [2347, "SR_GENTLETOUCH_CHANGE", 1, null],
    [2348, "SR_GENTLETOUCH_REVITALIZE", 1, null],
    [2517, "SR_HOWLINGOFLION", 3, null],
    [2518, "SR_RIDEINLIGHTNING", 2, null],
    [2555, "RL_B_TRAP", 1, null],
    [2556, "RL_FLICKER", 1, null],
    [2558, "RL_E_CHAIN", 1, null],
    [2559, "RL_QD_SHOT", null, "Qd_Shot_Ready"],
    [2560, "RL_C_MARKER", 1, null],
    [2563, "RL_P_ALTER", -1, null],
    [2564, "RL_FALLEN_ANGEL", 1, null],
    [2568, "RL_HEAT_BARREL", -1, null],
    [2571, "RL_HAMMER_OF_GOD", -1, null],
    [2596, "SP_SOULGOLEM", 1, null],
    [2597, "SP_SOULSHADOW", 1, null],
    [2598, "SP_SOULFALCON", 1, null],
    [2599, "SP_SOULFAIRY", 1, null],
    [2601, "SP_SOULCURSE", 3, null],
    [2602, "SP_SPA", 1, null],
    [2603, "SP_SHA", 1, null],
    [2604, "SP_SWHOO", 2, null],
    [2605, "SP_SOULUNITY", 10, null],
    [2606, "SP_SOULDIVISION", 1, null],
    [2607, "SP_SOULREAPER", 2, null],
    [2610, "SP_SOULEXPLOSION", 10, null],
    [2612, "SP_KAUTE", 5, null],
    [5009, "SR_FLASHCOMBO", 5, null],
    [5203, "DK_SERVANT_W_SIGN", 1, null],
    [5204, "DK_SERVANT_W_PHANTOM", 5, null],
    [5205, "DK_SERVANT_W_DEMOL", 5, null],
    [5247, "IQ_JUDGE", null, "First_Faith_Power"],
    [5254, "IQ_THIRD_EXOR_FLAME", null, "Second_Judge"],
    [5256, "IG_GUARDIAN_SHIELD", null, "Guard_Stance"],
    [5257, "IG_REBOUND_SHIELD", null, "Guard_Stance"],
    [5261, "IG_ULTIMATE_SACRIFICE", null, "Guard_Stance"],
    [5263, "IG_GRAND_JUDGEMENT", null, "Attack_Stance"],
    [5266, "IG_OVERSLASH", null, "Attack_Stance"],
    [5289, "SHC_ETERNAL_SLASH", null, "Weaponblock_On"],
    [5290, "SHC_POTENT_VENOM", null, "Edp"],
    [5425, "SOA_EXORCISM_OF_MALICIOUS_SOUL", 1, null],
    [5502, "SKE_SKY_SUN", null, "Sky_Enchant"],
    [5503, "SKE_SKY_MOON", null, "Sky_Enchant"],
    [5504, "SKE_STAR_LIGHT_KICK", null, "Sky_Enchant"],
    [6503, "IG_RADIANT_SPEAR", null, "Attack_Stance"],
    [6504, "IG_IMPERIAL_CROSS", null, "Attack_Stance"],
    [6510, "BO_DUST_EXPLOSION", null, "Mystery_Powder"],
    [6519, "IQ_BLAZING_FLAME_BLAST", null, "Explosionspirits"],
    [8028, "MH_SONIC_CRAW", 1, null],
    [8029, "MH_SILVERVEIN_RUSH", 1, null],
    [8030, "MH_MIDNIGHT_FRENZY", 1, null],
    [8036, "MH_TINDER_BREAKER", 1, null],
    [8037, "MH_CBC", 1, null],
    [8038, "MH_EQC", 2, null],
    [8050, "MH_BLAZING_AND_FURIOUS", 1, null]
  ];
  // 补状态技能映射：目标状态 → 达成该状态的技能ID列表（skill_db 施放后 Status 字段反向推导，re 版实证）
  // 键支持英文（rAthena 状态名）与中文（cond 语法）两种写法
  var SKILL_STATUS_SRC = {
    "Explosionspirits": [270], "爆气": [270], "Fury": [270], "fury": [270],
    "Hiding": [51, 165, 528, 3001], "隐匿": [51, 165], "Cloaking": [51, 165], "cloaking": [51, 165],
    "Cartboost": [486], "手推车加速": [486], "Boost": [486], "boost": [486], "CartBoost": [486],
    "Weaponblock_On": [2028], "武器格挡": [2028], "Weaponblock": [2028], "weaponblock": [2028], "WeaponBlocking": [2028],
    "Poisoningweapon": [2033], "涂毒": [2033], "EnchantPoison": [2033], "enchantpoison": [2033],
    "Rollingcutter": [2036], "回旋刀刃": [2036], "RollCounter": [2036],
    "Sight": [10, 1424, 669], "侦测": [10, 1424], "Sightrasher": [1424], "sightrasher": [1424],
    "Qd_Shot_Ready": [2559], "速射待发": [2559],
    "Edp": [378], "涂毒强化": [378], "EDP": [378],
    "Guard_Stance": [5255], "守卫姿态": [5255], "GuardStance": [5255],
    "Attack_Stance": [5260], "攻击姿态": [5260], "AttackStance": [5260],
    "Sky_Enchant": [5475], "天空附魔": [5475], "SkyEnchant": [5475],
    "First_Faith_Power": [5246], "初信之力": [5246],
    "Second_Judge": [5247], "二阶审判": [5247],
    "Mystery_Powder": [6509], "Assumptio": [361], "ASSUMPTIO": [361], "神秘之粉": [6509]
  };
  var SKILL_SPHERE_SRC = [261, 262];    // 蓄气 / 吸魂（补气弹）
  // 解析状态前置条件 → 需要补的资源 { spheres: 需要的球数, statuses: [缺失才补的状态名…] }
  function condNeeds(condStr) {
    var need = { spheres: 0, statuses: [] };
    if (!condStr) return need;
    var parts = String(condStr).split(/[,，]/);
    for (var i = 0; i < parts.length; i++) {
      var c = (parts[i] || "").trim();
      if (!c) continue;
      var neg = c.charAt(0) === "!";
      var cc = neg ? c.substr(1) : c;
      if (neg) continue; // !xxx 是「不需要某状态」，不参与自动补
      var ms = cc.match(/^球(\d+)$/);
      if (ms) {
        var n = parseInt(ms[1], 10);
        if (n > need.spheres) need.spheres = n;
        continue;
      }
      // hp>/sp> 等阈值条件不参与自动补（由战斗逻辑等待）
      if (/^(hp|sp)[><=]/.test(cc)) continue;
      need.statuses.push(cc);
    }
    return need;
  }
  // 查询技能释放需求
  function skillReq(skid) {
    for (var i = 0; i < SKILL_REQ.length; i++) {
      if (SKILL_REQ[i][0] === skid) return SKILL_REQ[i];
    }
    return null;
  }
  // 查已学技能等级（SkillList 组件），用于补状态技能等级
  function learnedSkillLv(skid) {
    try {
      var SL = window.require && window.require("UI/Components/SkillList/SkillList");
      if (SL && typeof SL.getSkillById === "function") {
        var s = SL.getSkillById(skid);
        if (s && s.level) return s.level;
      }
    } catch (e) {}
    return 0;
  }
  // 把英文状态名映射为实体字段判定（与 checkSkillCond 中文语法对齐）
  function statusNameToCond(name) {
    name = String(name || "").toLowerCase();
    if (name === "explosionspirits" || name === "explosionspirit" || name === "fury") return "爆气";
    if (name === "hiding" || name === "cloaking") return "隐匿";
    if (name === "cartboost" || name === "boost") return "手推车加速";
    if (name === "weaponblock_on" || name === "weaponblock") return "武器格挡";
    if (name === "poisoningweapon") return "涂毒";
    if (name === "rollingcutter") return "回旋刀刃";
    if (name === "sight" || name === "sightrasher") return "侦测";
    if (name === "qd_shot_ready") return "速射待发";
    if (name === "steelbody") return "钢体";
    if (name === "bladestop" || name === "bladestop_wait") return "金刚";
    if (name === "edp") return "涂毒强化";
    if (name === "guard_stance" || name === "guardstance") return "守卫姿态";
    if (name === "attack_stance" || name === "attackstance") return "攻击姿态";
    if (name === "sky_enchant" || name === "skyenchant") return "天空附魔";
    if (name === "first_faith_power") return "初信之力";
    if (name === "second_judge") return "二阶审判";
    if (name === "mystery_powder") return "神秘之粉";
    return name;
  }
  // 状态是否生效（中英文名都支持；V1.7.6 中文实体字段别名 + 判活环兜底）
  function statusActive(name) {
    try {
      var st = entStatus();
      if (!st) return false;
      var n = String(name || "").toLowerCase();
      // V1.7.6 中文实体字段别名（与 checkSkillCond 硬编码中文对齐，实体字段优先）
      if (n === "爆气") return st.explosion === 1;
      if (n === "狂暴") return st.berserk === 1;
      if (n === "灵魂") return st.soullink === 1;
      if (n === "骑乘") return st.riding === 1;
      if (n === "猎鹰") return st.falcon === 1;
      if (n === "隐匿" || n === "伪装") return st.ent.isHide === true || st.ent.hiding === 1;
      if (n === "手推车加速") return st.cart === 1;
      if (n === "钢体") return st.ent.SteelBody === 1 || st.ent.steelbody === 1;
      if (n === "涂毒") return st.ent.EnchantPoison === 1 || st.ent.enchantpoison === 1;
      if (n === "武器格挡") return st.ent.WeaponBlock === 1 || st.ent.weaponblock === 1;
      if (n === "回旋刀刃") return st.ent.RollCounter > 0;
      if (n === "侦测") return st.ent.intravision === 1;
      if (n === "速射待发") return st.ent.QDShotReady === 1;
      if (n === "金刚") return st.ent.BladeStop === 1 || st.ent.BladeStop_Wait === 1 || st.ent.BladeStop_Wait2 === 1;
      if (n === "涂毒强化") return st.ent.EDP === 1 || st.ent.Edp === 1 || st.ent.edp === 1;
      if (n === "守卫姿态") return st.ent.GuardStance === 1 || st.ent.guardStance === 1;
      if (n === "攻击姿态") return st.ent.AttackStance === 1 || st.ent.attackStance === 1;
      if (n === "天空附魔") return st.ent.SkyEnchant === 1 || st.ent.skyEnchant === 1;
      if (n === "初信之力") return st.ent.FirstFaithPower === 1 || st.ent.firstFaithPower === 1;
      if (n === "二阶审判") return st.ent.SecondJudge === 1 || st.ent.secondJudge === 1;
      if (n === "神秘之粉") return st.ent.MysteryPowder === 1 || st.ent.mysteryPowder === 1;
      if (n === "explosionspirits" || n === "explosionspirit" || n === "fury") return st.explosion === 1;
      if (n === "hiding" || n === "cloaking") return st.ent.isHide === true || st.ent.hiding === 1;
      if (n === "cartboost" || n === "boost" || n === "cartboost") return st.cart === 1;
      if (n === "weaponblock_on" || n === "weaponblock" || n === "weaponblocking") return st.ent.WeaponBlock === 1 || st.ent.weaponblock === 1;
      if (n === "poisoningweapon") return st.ent.EnchantPoison === 1 || st.ent.enchantpoison === 1;
      if (n === "rollingcutter") return st.ent.RollCounter > 0;
      if (n === "sight" || n === "sightrasher") return st.ent.intravision === 1;
      if (n === "qd_shot_ready") return st.ent.QDShotReady === 1;
      if (n === "steelbody") return st.ent.SteelBody === 1 || st.ent.steelbody === 1;
      if (n === "bladestop" || n === "bladestop_wait") return st.ent.BladeStop === 1 || st.ent.BladeStop_Wait === 1 || st.ent.BladeStop_Wait2 === 1;
      if (n === "edp") return st.ent.EDP === 1 || st.ent.Edp === 1 || st.ent.edp === 1;
      if (n === "guard_stance" || n === "guardstance") return st.ent.GuardStance === 1 || st.ent.guardStance === 1;
      if (n === "attack_stance" || n === "attackstance") return st.ent.AttackStance === 1 || st.ent.attackStance === 1;
      if (n === "sky_enchant" || n === "skyenchant") return st.ent.SkyEnchant === 1 || st.ent.skyEnchant === 1;
      if (n === "first_faith_power") return st.ent.FirstFaithPower === 1 || st.ent.firstFaithPower === 1;
      if (n === "second_judge") return st.ent.SecondJudge === 1 || st.ent.secondJudge === 1;
      if (n === "mystery_powder") return st.ent.MysteryPowder === 1 || st.ent.mysteryPowder === 1;
      // V1.7.6 兜底：实体字段没有该状态 → 回落 StatusIcons 判活环（buff/debuff 服务器通知，中英文均可）
      var fId = buffStId(name);
      if (fId >= 0 && buffStateOn(fId)) return true;
      return false;
    } catch (e) { return false; }
  }
  // 自动补状态：技能前置条件不满足时，解析缺失需求 → 施放能达成前置的技能（如阿修罗→补爆气/蓄气）
  // 基于 condStr（手写或自动推导皆可）通用判断：任何技能只要前置被挡住，就补对应状态技能
  // 返回 true=已施放补状态技能（本周期不再放主技能）
  function castStatusPrep(condStr, order) {
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (!ent) return false;
      var st = entStatus();
      if (!st) return false;
      // 补状态节流：距上次补状态 <1s 不重复补 → 让 wait 分支穿插普攻（蓄气×5 链不再霸占每轮）
      if (Date.now() - zPrepAt < 1000) return false;
      var need = condNeeds(condStr);
      // 1) 气弹不足 → 补气弹（蓄气/吸魂）
      if (need.spheres > 0 && st.spheres < need.spheres) {
        for (var si = 0; si < SKILL_SPHERE_SRC.length; si++) {
          var sid = SKILL_SPHERE_SRC[si];
          var lv = learnedSkillLv(sid);
          if (lv <= 0) continue; // 未学跳过
          // 蓄气需 气弹 < 技能等级（skill.cpp MO_CALLSPIRITS 判断）；吸魂无条件
          if (sid === 261 && st.spheres >= lv) continue;
          try {
            var ps = new CLIENT.PS.CZ.USE_SKILL();
            ps.SKID = sid;
            ps.selectedLevel = lv;
            ps.targetID = ent.GID || 0;
            CLIENT.NM.sendPacket(ps);
            zPrepAt = Date.now(); // 补状态节流：1s 内不再补，间隙穿插普攻
            tlog("cast-prep sphere " + sid + " lv" + lv + " (now " + st.spheres + "/" + need.spheres + ")");
            setStatus("气弹不足(" + st.spheres + "/" + need.spheres + ")，自动蓄气补球…", "st");
            return true;
          } catch (e) { continue; }
        }
      }
      // 2) 状态前置不满足 → 补状态技能（遍历条件里的每个状态）
      for (var si2 = 0; si2 < need.statuses.length; si2++) {
        var stName = need.statuses[si2];
        if (statusActive(stName)) continue; // 该状态已生效
        var srcs = SKILL_STATUS_SRC[stName] || [];
        for (var k = 0; k < srcs.length; k++) {
          var sid2 = srcs[k];
          var lv2 = learnedSkillLv(sid2);
          if (lv2 <= 0) continue;
          try {
            // 补状态技能自身也可能需要气弹（如爆气需5球）→ 先递归补
            var subReq = skillReq(sid2);
            if (subReq && subReq[2] > 0 && st.spheres < subReq[2]) {
              if (castStatusPrep(condStr, order)) return true;
            }
            var ps2 = new CLIENT.PS.CZ.USE_SKILL();
            ps2.SKID = sid2;
            ps2.selectedLevel = lv2;
            ps2.targetID = ent.GID || 0;
            CLIENT.NM.sendPacket(ps2);
            zPrepAt = Date.now(); // 补状态节流：1s 内不再补，间隙穿插普攻
            tlog("cast-prep status " + sid2 + " lv" + lv2 + " -> " + stName);
            setStatus("缺" + statusNameToCond(stName) + "，自动补状态技能(" + (getSkillNameById(sid2) || sid2) + ")…", "st");
            return true;
          } catch (e) { continue; }
        }
      }
      return false;
    } catch (e) { return false; }
  }
  function castOrderSkill(order, target) {
    // 并行判断链条（技能链 + 普攻链 各自独立评估，按优先级合流）：
    //  评估阶段：每轮把所有技能的前置/射程并行扫一遍——前置不满足的技能只记录，不立即停下补状态，
    //            后面的技能照常评估（避免顺序里放一个需前置的技能就把整条链堵住）。
    //  动作阶段（技能链优先级）：① 射程内且前置满足 → 直接放；② 前置满足但超射程 → walk 走近再放；
    //            ③ 全部被前置挡住 → 补第一个被挡技能的前置（补状态节流 1s）；④ 都做不了 → wait
    //  普攻链：独立计时在 zAttack 的 wait 分支（间隔跟随攻击循环，默认 0.5s）——技能冷却窗口/
    //          前置无解期间普攻照打，两条链互不阻塞。
    // 客户端真实机制（onUseSkill 逆向）：先寻路检查目标是否在技能射程内（attackRange+1），
    // 超射程→先发 REQUEST_MOVE 走近，到位后才发 USE_SKILL。直接对超射程目标发 USE_SKILL 会被服务器忽略。
    // 状态前置：技能释放需求表(SKILL_REQ)自动判断——玩家只需把想用的技能加入顺序，
    // 助手自动补状态（蓄气/爆气等）→ 状态满足后再释放指定技能。顺序里也可手写 cond 覆盖。
    // 自身 buff（type & SELF）：对自身施放（targetID=自己 GID），不受怪物距离限制
    // 返回：true=已施放 / "walk"=条件满足但超射程需走近 / "wait-cd"=技能冷却窗口 / "wait"=全被前置挡住 / "none"=无技能配置
    if (!order.length) return "none";
    if (!target || !target.position) return "wait";
    var ent = CLIENT.SS.Entity;
    if (!ent || !ent.position) return "wait";
    // 技能释放最小间隔：上次释放（含补状态）后 800ms 内技能层不动作 → 返回 "wait-cd"（技能冷却窗口），
    // 由外层「穿插平A」开关决定是否普攻——技能释放冷却只约束技能层，不影响普攻层
    if (Date.now() - zLastCastAt < 800) return "wait-cd";
    var d = Math.abs(target.position[0] - ent.position[0]) + Math.abs(target.position[1] - ent.position[1]);
    var prereqEn = $id("dsh-prereq") ? $id("dsh-prereq").checked : true;
    var blocked = null; // 第一个前置不满足的技能（{o, condStr}，合流阶段才补它的前置）
    var walkSk = null;  // 第一个前置满足但超射程的技能（无射程内可放时才走近）
    // V1.7.5 轮换游标：上一轮从 0 扫、第一个满足条件的技能恒占位 → 拖拽顺序无效、后面的技能永远轮不到。
    //   改为从 zCastIdx（上次命中技能的下一格，循环）开始扫：顺序列表决定轮换次序，每个技能都能轮到。
    var orderLen = order.length;
    if (zCastIdx < 0 || zCastIdx >= orderLen) zCastIdx = 0;
    for (var k = 0; k < orderLen; k++) {
      var i = (zCastIdx + k) % orderLen;
      var o = order[i];
      // 等级自动校正：手动等级 > 已学 → 降为已学最高级；未学 → 跳过该技能
      var realLv = clampSkillLv(o.skid, o.lv);
      if (realLv <= 0) {
        dshCastSkip(o.skid, "未学");
        tlog("cast-sk " + o.skid + " 未学，跳过");
        continue;
      }
      // 释放次数上限（V1.7.0 · OpenKore maxUses）：uses>0 且本轮已释放≥上限 → 本轮跳过
      if (o.uses > 0 && (zUseCounts[o.skid] || 0) >= o.uses) {
        dshCastSkip(o.skid, "次数上限" + o.uses);
        tlog("cast-sk " + o.skid + " 已达次数上限" + o.uses + "，本轮跳过");
        continue;
      }
      // 每次锁定次数上限（V1.7.5 · 锁定一个目标期间最多放N次，换目标/重新锁定时清零重计）
      if (o.lock > 0 && (zLockCounts[o.skid] || 0) >= o.lock) {
        dshCastSkip(o.skid, "锁定次数" + o.lock);
        tlog("cast-sk " + o.skid + " 已达锁定次数" + o.lock + "，跳过");
        continue;
      }
      // 释放百分比：prob 0-100，随机不命中 → 跳过该技能（试下一个）
      if (o.prob < 100 && Math.random() * 100 >= o.prob) {
        dshCastSkip(o.skid, "概率" + o.prob);
        tlog("cast-sk " + o.skid + " 概率" + o.prob + "%未命中，跳过");
        continue;
      }
      // 自动前置：技能无手写 cond 时，从释放需求表推导（如阿修罗→"球5,Explosionspirits"）
      var autoCond = "";
      var req = skillReq(o.skid);
      if (req) {
        var parts2 = [];
        if (req[2] > 0) parts2.push("球" + req[2]);
        if (req[3]) parts2.push(req[3]);
        autoCond = parts2.join(",");
      }
      var condStr = o.cond || autoCond;
      // 前置并行评估：不满足只记录（合流阶段补），后面的技能照常评估——输出不断
      if (prereqEn && condStr) {
        var ck = checkSkillCond(condStr);
        if (!ck.ok) {
          if (!blocked) blocked = { o: o, condStr: condStr };
          continue;
        }
      }
      var bits = skillTypeBits(o.skid);
      var isSelf = bits != null ? ((bits & 4) === 4) : false; // SELF=4；无类型信息按非自身处理
      if (isSelf) {
        try {
          var ps = new CLIENT.PS.CZ.USE_SKILL();
          ps.SKID = o.skid;
          ps.selectedLevel = realLv;
          ps.targetID = ent.GID || 0;
          dshCastMark(o.skid, realLv, ent.GID || 0, "zhu");
          CLIENT.NM.sendPacket(ps);
          zLastCastAt = Date.now(); // 记录技能释放时间（触发最小间隔 → 间隙穿插普攻）
          zUseCounts[o.skid] = (zUseCounts[o.skid] || 0) + 1; // V1.7.0 maxUses 计数
          zLockCounts[o.skid] = (zLockCounts[o.skid] || 0) + 1; // V1.7.5 锁定次数计数
          zCastIdx = (i + 1) % orderLen; // V1.7.5 轮换游标：下轮从本技能之后开始扫
          dshDiag("cast", { skid: o.skid, lv: realLv, self: 1 });
          tlog("cast-sk " + o.skid + " lv" + realLv + (realLv !== o.lv ? "(降自" + o.lv + ")" : "") + " [self]" + (condStr ? " cond=" + condStr : "") + " p" + o.prob + "%");
          return true;
        } catch (e) { continue; }
      }
      // 对怪技能：前置已满足，再看射程——射程内直接放；超射程只记录（继续评估后面的技能，找射程内可放的）
      var need = getSkillRange(o.skid, realLv) + 1; // 客户端 onUseSkill：attackRange+1
      if (d > need) {
        if (!walkSk) walkSk = o;
        continue;
      }
      try {
        var p = new CLIENT.PS.CZ.USE_SKILL();
        p.SKID = o.skid;
        p.selectedLevel = realLv;
        p.targetID = target.GID;
        dshCastMark(o.skid, realLv, target.GID, "zhu");
        CLIENT.NM.sendPacket(p);
        zLastCastAt = Date.now(); // 记录技能释放时间（触发最小间隔 → 间隙穿插普攻）
        zUseCounts[o.skid] = (zUseCounts[o.skid] || 0) + 1; // V1.7.0 maxUses 计数
        zLockCounts[o.skid] = (zLockCounts[o.skid] || 0) + 1; // V1.7.5 锁定次数计数
        zCastIdx = (i + 1) % orderLen; // V1.7.5 轮换游标：下轮从本技能之后开始扫
        dshDiag("cast", { skid: o.skid, lv: realLv, target: target.GID });
        tlog("cast-sk " + o.skid + " lv" + realLv + (realLv !== o.lv ? "(降自" + o.lv + ")" : "") + (condStr ? " cond=" + condStr : "") + " p" + o.prob + "%");
        return true;
      } catch (e) { continue; }
    }
    // 合流：无射程内可放技能 → 超射程的走近再放 > 补第一个被挡技能的前置 > 等（外层普攻穿插）
    if (walkSk) return "walk";
    if (blocked) {
      if (castStatusPrep(blocked.condStr, order)) { zLastCastAt = Date.now(); return true; }
    }
    // 全部技能被状态前置挡住且补状态节流/不可用 → 等（外层 wait 分支穿插普攻）
    return "wait";
  }
  $id("dsh-z-on").addEventListener("click", startZhu);
  $id("dsh-z-off").addEventListener("click", stopZhu);
  // 技能前置/穿插平A 开关持久化
  try {
    var prereqEl = $id("dsh-prereq");
    if (prereqEl) {
      if (saved.prereq != null) prereqEl.checked = !!saved.prereq;
      prereqEl.addEventListener("change", function () { saved.prereq = this.checked; saveSaved(saved); });
    }
    var attMixEl = $id("dsh-z-attmix");
    if (attMixEl) {
      if (saved.attMix != null) attMixEl.checked = !!saved.attMix;
      attMixEl.addEventListener("change", function () { saved.attMix = this.checked; saveSaved(saved); });
    }
  } catch (e) {}
  $id("dsh-scanen").addEventListener("change", function () {
    if (this.checked) startScan(); else stopScan();
  });
  // 点选技能释放：已学主动技能勾选 → 生成/更新技能顺序
  function learnedActiveSkills() {
    var out = [];
    // 1) 优先：客户端 SkillList 组件（真实已学技能，含等级/类型/射程，来源服务器 ZC.SKILLINFO_LIST）
    //    之前读 DB.getAllSkillInfo()（静态技能库无 level 字段）导致列表永远为空
    try {
      var SL = window.require && window.require("UI/Components/SkillList/SkillList");
      var list = SL && typeof SL.getList === "function" ? SL.getList() : null;
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s || !s.level) continue;          // 未学(等级0)跳过
          if (!s.type) continue;                 // 被动(type=0)不参与技能顺序
          var skid = s.SKID;
          if (skid == null) continue;
          var nm = getSkillNameById(skid) || s.skillName || String(skid);
          out.push({ skid: skid, lv: s.level, name: nm, range: s.attackRange });
        }
        if (out.length) return out;
      }
    } catch (e) {}
    // 2) 回退：DB 技能库（静态数据一般无 level，仅作兜底）
    try {
      var DB = CLIENT.DB || requireDB("DB/DBManager");
      if (!DB || typeof DB.getAllSkillInfo !== "function") return out;
      var info = DB.getAllSkillInfo();
      Object.keys(info).forEach(function (k) {
        var s = info[k];
        var lv = s && (s.level || s._level);
        if (s && lv > 0 && !isPassiveSkill(s.SKID != null ? s.SKID : k)) {
          var skid = s.SKID != null ? s.SKID : parseInt(k, 10);
          var nm = getSkillNameById(skid) || s.name || s.SkillName || String(skid);
          out.push({ skid: skid, lv: lv, name: nm });
        }
      });
    } catch (e) {}
    return out;
  }
  // 技能顺序可视化列表：textarea ↔ 拖拽列表双向同步
  function renderSkillOrderList() {
    var el = $id("dsh-skillorderlist");
    if (!el) return;
    var order = parseSkillOrder($id("dsh-skillorder").value);
    if (!order.length) { el.innerHTML = '<span class="st">空（点选上方技能加入，拖拽调整顺序）</span>'; return; }
    var html = "";
    for (var i = 0; i < order.length; i++) {
      var o = order[i];
      var nm = getSkillNameById(o.skid) || ("技能" + o.skid);
      // 显示条件：手写优先，否则显示释放需求表自动推导
      var dispCond = o.cond;
      if (!dispCond) {
        var rr = skillReq(o.skid);
        if (rr) {
          var parts2 = [];
          if (rr[2] > 0) parts2.push("球" + rr[2]);
          if (rr[3]) parts2.push(statusNameToCond(rr[3]));
          if (parts2.length) dispCond = "自动:" + parts2.join(",");
        }
      }
      html += '<div class="list-item drag-item" data-drag-i="' + i + '" draggable="true" title="拖动调整顺序"><span class="dh">⠿</span><span>' + (i + 1) + '. ' + nm + ' Lv' + o.lv + ' <span class="st">ID' + o.skid + (dispCond ? ' · 需' + dispCond : '') + '</span></span>' +
        '<input type="number" min="0" max="100" value="' + (o.prob != null ? o.prob : 100) + '" data-prob="' + o.skid + '" title="释放百分比" style="flex:0 0 44px;width:44px;padding:1px 2px;font-size:10px;text-align:center">' +
        '<span class="st" style="font-size:10px">%</span>' +
        '<button class="ghost" data-rm-sk="' + o.skid + '" style="flex:0 0 auto;padding:0 6px;font-size:10px">✕</button></div>';
    }
    el.innerHTML = html;
    // 释放百分比实时修改 → 写回 textarea（对象序列化，保留 cond、不吞技能名）
    el.querySelectorAll("[data-prob]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var skid = parseInt(this.getAttribute("data-prob"), 10);
        var pvRaw = parseInt(this.value, 10);
        // 空值/非法 → 100；输入 0 → 保留 0（0=不释放）
        var pv = (isNaN(pvRaw) ? 100 : Math.max(0, Math.min(100, pvRaw)));
        var order = parseSkillOrder($id("dsh-skillorder").value);
        var hit = false;
        for (var i2 = 0; i2 < order.length; i2++) {
          if (order[i2].skid === skid) { order[i2].prob = pv; hit = true; }
        }
        $id("dsh-skillorder").value = order.map(skillLine).join("\n");
        if (hit) setStatus("技能 " + skid + " 释放概率 → " + pv + "%", "ok");
        renderSkillOrderList();
      });
    });
    el.querySelectorAll("[data-rm-sk]").forEach(function (b) {
      b.addEventListener("click", function () {
        var skid = parseInt(this.getAttribute("data-rm-sk"), 10);
        var lines = String($id("dsh-skillorder").value || "").split(/\r?\n/).filter(function (l) {
          var m = l.match(/^(\d+)(?::(\d+))?/);
          return !(m && parseInt(m[1], 10) === skid);
        });
        $id("dsh-skillorder").value = lines.join("\n");
        renderSkillOrderList();
        renderSkillPick();
      });
    });
    enableDragSort(el, function (from, to) {
      var order2 = parseSkillOrder($id("dsh-skillorder").value);
      var moved = order2.splice(from, 1)[0];
      order2.splice(to, 0, moved);
      $id("dsh-skillorder").value = order2.map(skillLine).join("\n");
      renderSkillOrderList();
      setStatus("技能顺序已调整（第" + (from + 1) + "→第" + (to + 1) + "）", "ok");
    });
  }
  function renderSkillPick() {
    var el = $id("dsh-skillpick");
    if (!el) return;
    var list = learnedActiveSkills();
    if (!list.length) { el.innerHTML = '<span class="st">未读取到已学技能（登录后展开）</span>'; return; }
    // 当前技能顺序里已有的 skid
    var orderSkids = {};
    parseSkillOrder($id("dsh-skillorder").value).forEach(function (o) { orderSkids[o.skid] = true; });
    var html = "";
    list.forEach(function (s) {
      html += '<div class="list-item"><label class="switch"><input type="checkbox" data-sk="' + s.skid + '" data-lv="' + s.lv + '" data-nm="' + s.name + '"' + (orderSkids[s.skid] ? " checked" : "") + '>' +
        s.name + ' Lv' + s.lv + '</label></div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('input[data-sk]').forEach(function (c) {
      c.addEventListener("change", function () {
        var skid = parseInt(this.getAttribute("data-sk"), 10);
        var lv = parseInt(this.getAttribute("data-lv"), 10) || 5;
        var nm = this.getAttribute("data-nm") || String(skid);
        var ta = $id("dsh-skillorder");
        var lines = String(ta.value || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
        // 若该技能已有行（可能带状态前置），勾选/取消时都保留原行（含条件），避免重复
        var hasLine = false;
        for (var li = 0; li < lines.length; li++) {
          var mm = lines[li].match(/^(\d+)/);
          if (mm && parseInt(mm[1], 10) === skid) { hasLine = true; break; }
        }
        if (!hasLine && this.checked) lines.push(skillLine({ skid: skid, lv: lv, cond: "", prob: 100 }));
        if (hasLine && !this.checked) {
          lines = lines.filter(function (l) {
            var m = l.match(/^(\d+)(?::(\d+))?/);
            return !(m && parseInt(m[1], 10) === skid);
          });
        }
        ta.value = lines.join("\n");
        renderSkillOrderList();
        setStatus(this.checked ? "已加入技能顺序: " + nm : "已移除: " + nm, this.checked ? "ok" : "st");
      });
    });
  }
  $id("dsh-skillorder").addEventListener("input", function () { try { renderSkillPick(); renderSkillOrderList(); } catch (e) {} });
  $id("dsh-skillclear").addEventListener("click", function () {
    $id("dsh-skillorder").value = "";
    renderSkillPick();
    renderSkillOrderList();
    setStatus("技能顺序已清空", "st");
  });
  $id("dsh-skillimp").addEventListener("click", function () {
    try {
      var learned = learnedActiveSkills();
      if (!learned.length) { setStatus("角色还没有已学主动技能（登录后重试）", "err"); return; }
      var lines = [];
      learned.forEach(function (s) {
        lines.push(skillLine({ skid: s.skid, lv: s.lv, cond: "", prob: 100 }));
      });
      $id("dsh-skillorder").value = lines.join("\n");
      $id("dsh-prereqcnt").textContent = "已学 " + lines.length + " 技能";
      renderSkillPick();
      renderSkillOrderList();
      setStatus("已导入角色已学技能 " + lines.length + " 个", "ok");
    } catch (e) { setStatus("导入异常: " + e.message, "err"); }
  });

  // ---------------- 拾取页：内挂百分比联动 ----------------
  $id("dsh-lootread").addEventListener("click", function () {
    try {
      var lp = document.querySelector("#lootProbability, .lootProbability");
      var op = document.querySelector(".openpick");
      if (lp) { $id("dsh-lootprob").value = lp.value; $id("dsh-lootstate").textContent = "内挂已读取"; $id("dsh-lootstate").className = "tag green"; }
      if (op) { $id("dsh-openpick").checked = !!op.checked; }
      setStatus("已读取内挂拾取设置", "ok");
    } catch (e) { setStatus("读取异常（需打开内挂窗口）: " + e.message, "err"); }
  });
  $id("dsh-lootwrite").addEventListener("click", function () {
    try {
      var lp = document.querySelector("#lootProbability, .lootProbability");
      var op = document.querySelector(".openpick");
      var v = parseInt($id("dsh-lootprob").value, 10) || 10;
      if (lp) { lp.value = Math.max(0, Math.min(100, v)); try { lp.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {} }
      if (op && $id("dsh-openpick").checked && !op.checked) { try { op.click(); } catch (e) {} }
      setStatus("已写回内挂（拾取机率 " + v + "%）", "ok");
    } catch (e) { setStatus("写回异常（需打开内挂窗口）: " + e.message, "err"); }
  });

  // ---------------- 指定ID拾取：怪物掉落树 ----------------
  var wl = (function () { try { return JSON.parse(localStorage.getItem("dsh_ro_whitelist")) || {}; } catch (e) { return {}; } })();
  function renderWl() {
    var el = $id("dsh-wllist");
    if (!el) return;
    var ids = Object.keys(wl);
    $id("dsh-wlcount").textContent = ids.length + " 个物品ID";
    var psEl = $id("dsh-pickstate");
    if (psEl) psEl.textContent = ids.length ? ("拾取名单 " + ids.length + " 个 ID · 落地即自动拾取") : ("白名单为空：搜物品或直接「＋加入」指定 ID");
    if (!ids.length) { el.innerHTML = '<span class="st">空</span>'; return; }
    var html = "";
    ids.forEach(function (id) {
      html += '<div class="list-item"><span>' + id + (wl[id].name ? " " + wl[id].name : "") + '</span>' +
        '<button class="ghost" data-wlrm="' + id + '" style="flex:0 0 auto;padding:0 7px;font-size:11px">移除</button></div>';
    });
    el.innerHTML = html;
  }
  function addWl(id, name) {
    id = String(id);
    if (!wl[id]) wl[id] = { name: name || "" };
    try { localStorage.setItem("dsh_ro_whitelist", JSON.stringify(wl)); } catch (e) {}
    renderWl();
  }
  function removeWl(id) {
    delete wl[String(id)];
    try { localStorage.setItem("dsh_ro_whitelist", JSON.stringify(wl)); } catch (e) {}
    renderWl();
  }
  $id("dsh-wllist").addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-wlrm]");
    if (b) removeWl(b.getAttribute("data-wlrm"));
  });
  function renderDropTree(list) {
    var el = $id("dsh-drop-tree");
    if (!el) return;
    var mobDB = getMobDb();
    if (!mobDB) { el.innerHTML = '<div class="st">怪物库未就绪（客户端加载后重试）</div>'; return; }
    if (!list || !list.length) {
      // 优先：当前地图怪物（同内挂检测目标地图表）；失败回退图鉴前8只
      var mapList = getMapMobList();
      if (mapList && mapList.length) list = mapList;
      else {
        var all = Object.keys(mobDB).slice(0, 8);
        list = all.map(function (id) { return { id: id, m: mobDB[id] }; });
      }
    }
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var m = it.m;
      if (!m) continue;
      html += '<details><summary style="cursor:pointer;padding:2px 0">🐛 ' + (m.kName || m.name || ("ID" + it.id)) + ' · ID' + it.id + ' · LV' + (m.LV || "?") + ' <span class="tag">掉落树</span></summary><div style="padding-left:8px">';
      for (var d = 0; d < 9; d++) {
        var did = m["Drop" + d + "id"];
        if (did == null) continue;
        var dper = m["Drop" + d + "per"];
        var pct = dper != null ? (dper / 100).toFixed(2) + "%" : "?";
        var nm = getItemName(did) || ("ID" + did);
        var checked = wl[String(did)] ? " checked" : "";
        html += '<div class="list-item"><label class="switch"><input type="checkbox"' + checked + ' data-wladd="' + did + '" data-nm="' + nm + '">' + nm + ' (' + did + ')</label><span class="tag' + (dper != null && dper >= 500 ? " green" : "") + '">' + pct + '</span></div>';
      }
      html += '</div></details>';
    }
    el.innerHTML = html;
    el.querySelectorAll('input[data-wladd]').forEach(function (c) {
      c.addEventListener("change", function () {
        if (this.checked) addWl(this.getAttribute("data-wladd"), this.getAttribute("data-nm"));
        else removeWl(this.getAttribute("data-wladd"));
      });
    });
  }
  $id("dsh-mobsearchbtn").addEventListener("click", function () {
    var kw = ($id("dsh-mobsearch").value || "").trim();
    var mobDB = getMobDb();
    if (!mobDB) { setStatus("怪物库未就绪", "err"); return; }
    if (/^\d+$/.test(kw)) {
      var m = mobDB[parseInt(kw, 10)];
      if (m) { renderDropTree([{ id: kw, m: m }]); setStatus("已显示 " + m.kName, "ok"); return; }
    }
    var hits = [];
    Object.keys(mobDB).forEach(function (id) {
      var mob = mobDB[id];
      if (mob && mob.kName && mob.kName.indexOf(kw) !== -1) hits.push({ id: id, m: mob });
    });
    if (hits.length) { renderDropTree(hits.slice(0, 10)); setStatus("找到 " + hits.length + " 只怪，显示前10", "ok"); }
    else setStatus("未找到怪物", "err");
  });
  // 拾取页清空搜索：清输入框 + 恢复初始掉落树（当前地图怪物掉落）
  $id("dsh-mobsearchclr").addEventListener("click", function () {
    $id("dsh-mobsearch").value = "";
    renderDropTree(null); // null → 内部自动回退当前地图怪物/图鉴前8
    setStatus("搜索已清空，恢复当前地图掉落", "st");
  });
  // ---------------- 拾取页物品搜索（V1.9.4）：搜物品名/ID → 一键加白名单（丢物测试等）----------------
  // 反向索引：扫描 mob_db 全部怪的 Drop0~8id → itid → {name, mobs:[{id,kName,per}]}（懒构建缓存）
  var itemXIndex = null;
  var itemIdxBuiltAt = 0;
  function buildItemXIndex() {
    try {
      var mobDB = getMobDb();
      if (!mobDB) return null;
      var idx = {};
      Object.keys(mobDB).forEach(function (mid) {
        var m = mobDB[mid];
        if (!m) return;
        for (var d = 0; d < 9; d++) {
          var did = m["Drop" + d + "id"];
          if (did == null) continue;
          if (!idx[did]) idx[did] = { mobs: [] };
          idx[did].mobs.push({ id: mid, kName: m.kName || m.name || ("ID" + mid), per: m["Drop" + d + "per"] });
        }
      });
      itemXIndex = idx;
      return idx;
    } catch (e) { return null; }
  }
  function getItemNameS(id) {
    try { return getItemName(id) || ("ID" + id); } catch (e) { return "ID" + id; }
  }
  function renderItemSearch(list, kw) {
    var res = $id("dsh-itemsearch-res");
    if (!res) return;
    if (!list || !list.length) { res.innerHTML = '<span class="st">未找到物品' + (kw ? "：「" + kw + "」" : "") + '</span>'; return; }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var itid = list[i].itid;
      var nm = list[i].name;
      var mobs = list[i].mobs || [];
      var inWl = wl[String(itid)] ? true : false;
      // V1.9.4：加入按钮 HTML 先生成（掉落信息异常也不吞按钮）
      var btnHtml = '<button class="ghost" data-wlswitch="' + itid + '" data-nm="' + nm.replace(/"/g, "&quot;") + '" style="flex:0 0 auto;margin-left:auto">' + (inWl ? "✓ 已加" : "＋ 加入白名单") + '</button>';
      html += '<div class="list-item" style="border-bottom:1px dashed #334"><span class="dh">◆</span>' + nm + ' <span class="st">(' + itid + ')</span>';
      try {
        if (mobs.length) {
          html += '<span class="st"> · ' + mobs.length + ' 只怪掉：</span>';
          for (var mi = 0; mi < mobs.length; mi++) {
            var mob = mobs[mi];
            var pv = Number(mob.per);
            var pct = (mob.per != null && isFinite(pv)) ? (pv / 100).toFixed(2) + "%" : "?";
            html += '<button class="ghost moblk" data-mid="' + mob.id + '" style="flex:0 0 auto;margin-left:3px;font-size:10px;padding:0 4px">' + mob.kName + ' ' + pct + '</button>';
          }
        }
      } catch (e2) {}
      html += btnHtml + '</div>';
    }
    res.innerHTML = html;
    res.querySelectorAll('[data-mid]').forEach(function (b) {
      b.addEventListener("click", function () {
        var mid = this.getAttribute("data-mid");
        var mobDB = getMobDb();
        if (mobDB && mobDB[mid]) { renderDropTree([{ id: mid, m: mobDB[mid] }]); setStatus("已展开 " + (mobDB[mid].kName || mid) + " 掉落树", "ok"); }
      });
    });
    res.querySelectorAll('[data-wlswitch]').forEach(function (b) {
      b.addEventListener("click", function () {
        var id = this.getAttribute("data-wlswitch");
        var nm2 = this.getAttribute("data-nm");
        if (wl[String(id)]) { removeWl(id); }
        else { addWl(id, nm2); }
        renderItemSearch(list, kw); // 刷新按钮态
      });
    });
  }
  $id("dsh-itemsearchbtn").addEventListener("click", function () {
    var kw = ($id("dsh-itemsearch").value || "").trim();
    if (!kw) { setStatus("先输入物品ID或名称", "st"); return; }
    var out = [];
    if (/^\d+$/.test(kw)) {
      // V1.9.4：数字 ID 直查走物品库（CLIENT.DB），不依赖怪物掉落索引——任何 ID 都能出结果并加入拾取名单
      var id2 = parseInt(kw, 10);
      var rIdx = itemXIndex || buildItemXIndex();
      var got = rIdx ? rIdx[id2] : null;
      out.push({ itid: id2, name: getItemNameS(id2), mobs: (got && got.mobs) || [] });
    } else {
      var idx = itemXIndex || buildItemXIndex();
      if (!idx) { setStatus("物品索引未就绪（怪物库加载后重试）", "err"); return; }
      var seen = {};
      Object.keys(idx).forEach(function (itid) {
        if (out.length >= 15 || seen[itid]) return;
        var nm = getItemNameS(itid);
        if (nm && nm.indexOf(kw) !== -1) { seen[itid] = true; out.push({ itid: parseInt(itid, 10), name: nm, mobs: idx[itid].mobs }); }
      });
    }
    renderItemSearch(out, kw);
    setStatus(out.length ? ("找到 " + out.length + " 个物品") : ("未找到物品「" + kw + "」"), out.length ? "ok" : "err");
  });
  $id("dsh-itemsearchclr").addEventListener("click", function () {
    $id("dsh-itemsearch").value = "";
    $id("dsh-itemsearch-res").innerHTML = "";
    setStatus("物品搜索已清空", "st");
  });
  // V1.9.4：「＋加入」直达——输入数字 ID 直接写入拾取名单，不依赖搜索/物品库/掉落索引
  $id("dsh-itemsearchadd").addEventListener("click", function () {
    var kw = ($id("dsh-itemsearch").value || "").trim();
    if (!/^\d+$/.test(kw)) { setStatus("先输入数字物品ID，再点「＋加入」", "st"); return; }
    var id = parseInt(kw, 10);
    if (wl[String(id)]) { setStatus("ID " + id + " 已在拾取名单", "ok"); return; }
    var nm = getItemNameS(id);
    addWl(String(id), nm);
    renderItemSearch([{ itid: id, name: nm, mobs: [] }], kw); // 结果区显示该行并刷新为 ✓ 已加
    setStatus("已加入拾取名单：ID " + id + (nm !== ("ID" + id) ? "（" + nm + "）" : ""), "ok");
  });
  // V1.9.4：开启「指定ID自动拾取」时确认白名单状态（空名单 = 提示先加 ID，避免开关无效感）
  if ($id("dsh-picken")) $id("dsh-picken").addEventListener("change", function () {
    var ids = Object.keys(wl);
    if (this.checked && !ids.length) setStatus("白名单为空：搜物品或直接「＋加入」指定 ID，否则不会拾取任何物品", "st");
    else if (this.checked) setStatus("拾取名单 " + ids.length + " 个 ID，落地即自动拾取", "ok");
    else setStatus("指定ID自动拾取已关闭", "st");
  });
  // 本图怪物掉落：直接读当前地图表（同内挂检测目标）
  function refreshPickMap() {
    var el = $id("dsh-pickmap");
    if (!el) return;
    var info = getCurrentMapInfo();
    if (!info) { el.textContent = "—（未进图）"; return; }
    el.textContent = info.name + " (" + info.key + ")";
  }
  // 本图可锁定怪物目录：读本图怪物表 → 勾选=加入锁定目录（不折叠，换图自动刷新）
  // 拾取页(#dsh-maplock) 与 助手页(#dsh-z-maplock) 共用
  function renderMapLock(el) {
    el = el || $id("dsh-maplock");
    if (!el) return;
    var info = getCurrentMapInfo();
    if (!info || !info.mobIds || !info.mobIds.length) { el.innerHTML = '<span class="st">本图怪物表无数据（未进图/表缺失）</span>'; return; }
    var mobDB = getMobDb();
    if (!mobDB) { el.innerHTML = '<span class="st">怪物库未就绪</span>'; return; }
    var html = '<div class="b-hd">' + info.name + ' · ' + info.mobIds.length + ' 只怪（勾选=锁定）</div>';
    var seen = {};
    for (var i = 0; i < info.mobIds.length; i++) {
      var id = info.mobIds[i];
      if (id == null || seen[id]) continue;
      seen[id] = true;
      var m = mobDB[id];
      if (!m) continue;
      var nm = m.kName || m.name || ("ID" + id);
      var locked = lockList[String(id)] ? true : false;
      html += '<div class="list-item"><label class="switch"><input type="checkbox"' + (locked ? " checked" : "") + ' data-maplock="' + id + '" data-nm="' + nm + '">' + nm + ' <span class="st">ID' + id + ' · Lv' + (m.LV || "?") + '</span></label></div>';
    }
    el.innerHTML = html || '<span class="st">该图怪物库无匹配数据</span>';
    el.querySelectorAll('input[data-maplock]').forEach(function (c) {
      c.addEventListener("change", function () {
        var id = this.getAttribute("data-maplock");
        if (!id) return;
        if (this.checked) addLock(id, this.getAttribute("data-nm"));
        else removeLock(id);
      });
    });
  }
  $id("dsh-maplockbtn").addEventListener("click", function () {
    renderMapLock();
    setStatus("已读取本图锁定目录", "ok");
  });
  $id("dsh-pickmapbtn").addEventListener("click", function () {
    var mobDB = getMobDb();
    if (!mobDB) { setStatus("怪物库未就绪", "err"); return; }
    var info = getCurrentMapInfo();
    if (!info || !info.mobIds || !info.mobIds.length) { setStatus("当前地图怪物表无数据（" + (info ? info.key : "未进图") + "）", "err"); return; }
    var list = [];
    var seen = {};
    for (var i = 0; i < info.mobIds.length; i++) {
      var id = info.mobIds[i];
      if (id == null || seen[id]) continue;
      seen[id] = true;
      var m = mobDB[id];
      if (m) list.push({ id: id, m: m });
    }
    if (!list.length) { setStatus("该图怪物库无匹配数据", "err"); return; }
    renderDropTree(list);
    setStatus("已显示「" + info.name + "」的 " + list.length + " 只怪掉落", "ok");
  });
  // 指定ID拾取轮询
  function parseIds(txt) {
    var out = {};
    String(txt || "").split(/[\r\n,，;；\s]+/).forEach(function (s) { if (/^\d+$/.test(s)) out[s] = true; });
    return out;
  }
  // 物品实体没有 ITID 字段（ItemObject.add 只设 GID=ITAID）→ wrap add 记录 ITAID→ITID 映射
  var ita2itid = {}, itemHookDone = false;
  function hookItemObjects() {
    try {
      if (itemHookDone || !window.require) return;
      var IO = window.require("Renderer/ItemObject");
      if (!IO || typeof IO.add !== "function") return;
      itemHookDone = true;
      var origAdd = IO.add;
      IO.add = function (itaid, itid, isId, count, x, y, z, fx) {
        try {
          ita2itid[String(itaid)] = itid;
          // V1.9.4：开关统一——「启用指定ID自动拾取」关 = 只记录映射不拾取（修复白名单加入即自动拾取、开关无效）
          if (wl[String(itid)] && $id("dsh-picken") && $id("dsh-picken").checked) tryPickupIta(itaid, x, y);
        } catch (e) {}
        return origAdd.apply(this, arguments);
      };
    } catch (e) {}
  }
  // V1.8.5：拾取走过去——距离 >15 格的掉落物品，安全（无Boss/血蓝足/未坐下）时逐跳走过去捡；途中变危险/超时/不可达自动放弃
  var pendingPick = null;
  function pickSafeToWalk() {
    try {
      // V1.9.4：「危险时不走过去捡」开关关 = 无视危险判定（危险也走过去捡）
      if ($id("dsh-picksafe") && !$id("dsh-picksafe").checked) return true;
      if (!CLIENT || !CLIENT.SS || !CLIENT.SS.Entity) return false;
      var ent = CLIENT.SS.Entity;
      var life = ent.life;
      if (life) {
        var hpPct = life.maxhp > 0 ? life.hp / life.maxhp * 100 : 100;
        var spPct = life.maxsp > 0 ? life.sp / life.maxsp * 100 : 100;
        if (hpPct < 40 || spPct < 15) return false;
      }
      // 20 格内 Boss（mob_db.MvpDropsNum>0，与防御瞬移同判定）
      for (var i = 0; i < lastMobs.length; i++) {
        var mb = lastMobs[i];
        if (mb && mb.isBoss && mb.dist >= 0 && mb.dist <= DS_BOSS_DIST) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function walkForPickTick() {
    try {
      if (moveXY && moveXY.busy) { pendingPick = null; return; } // 手动坐标走路中 → 取消拾取接近
      if (!pendingPick) return;
      if (!clientReady()) { pendingPick = null; return; }
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (!ent || !ent.position) { pendingPick = null; return; }
      var now = Date.now();
      if (now - pendingPick.at > 12000) { pendingPick = null; var lgT = $id("dsh-picklog"); if (lgT) lgT.textContent = "拾取走过去超时放弃"; return; }
      var d = Math.abs(pendingPick.x - ent.position[0]) + Math.abs(pendingPick.y - ent.position[1]);
      if (d <= 15) { tryPickupIta(pendingPick.itaid, pendingPick.x, pendingPick.y); pendingPick = null; return; }
      // V1.9.4：去掉 walk 被 sit 锁反向拦截（坐着的锁会卡死「走过去捡」）——互斥改单向：走路时坐下让位，走路不被坐拦
      if (!pickSafeToWalk()) { pendingPick = null; return; } // 途中变危险 → 放弃
      var r = pathFindTo(pendingPick.x, pendingPick.y);
      if (!r) { pendingPick = null; return; } // 不可达 → 放弃
      var pm = new CLIENT.PS.CZ.REQUEST_MOVE();
      pm.dest = [r.x, r.y];
      CLIENT.NM.sendPacket(pm);
      try { if (zWalkState) zWalkState.lastMove = now; } catch (e) {} // 占用 zWalk 的 2s 门槛，避免移动互相打架
      var lg = $id("dsh-picklog");
      if (lg) lg.textContent = "拾取目标较远(" + d + "格)，避障接近中…";
    } catch (e) { pendingPick = null; }
  }
  function tryPickupIta(itaid, x, y) {
    try {
      if (!clientReady()) return;
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      // 距离限制：15 格内直接捡（曼哈顿）；超出 = V1.8.5 走过去捡（开关开 + 安全才走，否则维持放弃）
      if (ent && ent.position && x != null && y != null) {
        var d = Math.abs(x - ent.position[0]) + Math.abs(y - ent.position[1]);
        if (d > 15) {
          if ($id("dsh-pickwalk") && $id("dsh-pickwalk").checked && pickSafeToWalk()) {
            pendingPick = { itaid: itaid, x: x, y: y, at: Date.now() };
          }
          return;
        }
      }
      var p = new CLIENT.PS.CZ.ITEM_PICKUP();
      p.ITAID = itaid;
      CLIENT.NM.sendPacket(p);
      var lg = $id("dsh-picklog");
      if (lg) lg.textContent = "检测到掉落并拾取（" + new Date().toTimeString().slice(0, 8) + "）";
    } catch (e) {}
  }
  setInterval(function () {
    try {
      var en = $id("dsh-picken") && $id("dsh-picken").checked;
      if (!en) return;
      if (!clientReady()) return;
      hookItemObjects();
      var wlKeys = Object.keys(wl);
      if (!wlKeys.length) return;
      var EM = window.require("Renderer/EntityManager");
      var picked = 0;
      EM.forEach(function (e) {
        try {
          if (e.objecttype !== 11) return;
          var itid = ita2itid[String(e.GID)];
          if (itid == null) return;
          if (!wl[String(itid)]) return;
          tryPickupIta(e.GID, e.position && e.position[0], e.position && e.position[1]);
          picked++;
        } catch (e2) {}
      });
      if (picked) $id("dsh-picklog").textContent = "已拾取 " + picked + " 件（" + new Date().toTimeString().slice(0, 8) + "）";
      // V1.8.5：拾取走过去（>15 格目标逐跳接近，安全判定后）
      try { walkForPickTick(); } catch (e) {}
    } catch (e) {}
  }, 1500);

  // ---------------- 掉落实测积累（喂图鉴）----------------
  var drops = {};
  function recordDrop(itid, name) {
    var map = getMapName() || "?";
    drops[map] = drops[map] || {};
    var k = String(itid);
    if (!drops[map][k]) drops[map][k] = { name: name || ("ID" + itid), count: 0 };
    drops[map][k].count++;
  }


  // ---------------- 传送页：内挂书本 ----------------
  function renderBook() {
    var el = $id("dsh-book");
    if (!el) return;
    var logs = requireDB("DB/logsTable");
    if (!logs) { el.innerHTML = '<div class="st">书本数据未就绪（客户端加载后重试）</div>'; return; }
    var cv = DEFAULTS.ClientVer;
    var tbl = logs[cv] || logs[5] || {};
    var catMap = { "bk-npc": "guide", "bk-train": "train", "bk-money": "makeMonzy", "bk-chg": "challenge", "bk-dun": "dungeons", "bk-mvp": "mvp" };
    var active = "";
    var subs = el.closest(".page").querySelectorAll(".sub-tab");
    for (var i = 0; i < subs.length; i++) if (subs[i].classList.contains("active")) active = subs[i].getAttribute("data-sub");
    var cat = catMap[active] || "guide";
    var list = tbl[cat] || {};
    var keys = Object.keys(list);
    if (!keys.length) { el.innerHTML = '<div class="st">该分类暂无数据</div>'; return; }
    var html = '<div class="b-hd">' + cat + '（' + keys.length + ' 条 · 线路 ' + (SERVER_NAMES[cv] || cv) + '）</div>';
    for (var k = 0; k < keys.length; k++) {
      var it = list[keys[k]];
      if (!it) continue;
      html += '<div class="list-item"><span>' + (it.npc || it.name || ("条目" + keys[k])) + '</span>' +
        '<span style="color:#5a6b7f;font-size:10px">' + (it.desc || "") + '</span>' +
        '<button class="ghost" data-goto="' + keys[k] + '" style="flex:0 0 auto;padding:0 8px;font-size:11px">前往</button></div>';
    }
    el.innerHTML = html;
    el.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { gotoBook(this.getAttribute("data-goto")); });
    });
  }
  function gotoBook(key) {
    try {
      var logs = requireDB("DB/logsTable");
      var cv = DEFAULTS.ClientVer;
      var tbl = logs[cv] || logs[5] || {};
      var catMap = { "bk-npc": "guide", "bk-train": "train", "bk-money": "makeMonzy", "bk-chg": "challenge", "bk-dun": "dungeons", "bk-mvp": "mvp" };
      var subs = $id("dsh-book").closest(".page").querySelectorAll(".sub-tab");
      var active = "bk-npc";
      for (var i = 0; i < subs.length; i++) if (subs[i].classList.contains("active")) active = subs[i].getAttribute("data-sub");
      var it = tbl[catMap[active]] && tbl[catMap[active]][key];
      if (!it) { setStatus("书本条目不存在", "err"); return; }
      // 尝试私人飞艇（map#x#y）；失败则走 path 步行
      if (it.outset && it.outset.length >= 3 && clientReady()) {
        var p = new CLIENT.PS.CZ.PRIVATE_AIRSHIP_REQUEST();
        p.mapname = it.outset[0]; p.x = it.outset[1]; p.y = it.outset[2];
        p.type = 1; p.itemid = 14527;
        CLIENT.NM.sendPacket(p);
        setStatus("书本前往: " + (it.npc || "") + "（飞艇，耗会员卡14527）", "ok");
        tlog("book-goto " + (it.npc || ""));
        return;
      }
      if (it.path && it.path.length && clientReady()) {
        var dest = it.path[it.path.length - 1];
        var mv = new CLIENT.PS.CZ.REQUEST_MOVE();
        mv.dest = [dest[1], dest[2]];
        CLIENT.NM.sendPacket(mv);
        setStatus("书本前往: " + (it.npc || "") + "（步行寻路）", "ok");
        return;
      }
      setStatus("客户端未就绪，无法前往", "err");
    } catch (e) { setStatus("前往异常: " + e.message, "err"); }
  }

  // ---------------- 世界地图传送（v1.7.5 输入联想版）----------------
  var mapCache = []; // {map:"prontera", cn:"普隆德拉"} 已读取地图缓存（持久化 saved.mapCache）
  try { if (Array.isArray(saved.mapCache) && saved.mapCache.length) mapCache = saved.mapCache.map(function (x) { return { map: String(x.map || ""), cn: String(x.cn || "") }; }); } catch (e) {}
  function mapCn(map) {
    try {
      var db = CLIENT.DB || (window.require ? window.require("DB/DBManager") : null);
      var nm = db && typeof db.getMapName === "function" ? db.getMapName(map) : "";
      if (nm && nm !== map) return String(nm).trim();
    } catch (e) {}
    return "";
  }
  function renderMapList() {
    var box = $id("dsh-maplist");
    if (!box) return;
    box.innerHTML = "";
    if (!mapCache.length) { box.innerHTML = '<div style="padding:4px 6px;color:#8a97a6;font-size:11px">暂无已读地图 — 先点「读地图」（需游戏内已打开世界地图）</div>'; return; }
    var kw = ($id("dsh-map").value || "").trim().toLowerCase();
    var hits = [];
    for (var i = 0; i < mapCache.length && hits.length < 100; i++) {
      var it = mapCache[i];
      if (!kw) { hits.push(it); continue; }
      if (it.map.toLowerCase().indexOf(kw) >= 0 || (it.cn || "").toLowerCase().indexOf(kw) >= 0) hits.push(it);
    }
    if (!hits.length) { box.innerHTML = '<div style="padding:4px 6px;color:#8a97a6;font-size:11px">没有匹配的地图</div>'; return; }
    hits.forEach(function (it) {
      var row = document.createElement("div");
      row.textContent = (it.cn ? it.cn + " " : "") + it.map;
      row.style.cssText = "padding:4px 6px;font-size:11px;cursor:pointer;border-bottom:1px solid #eef2f6";
      row.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // 防 input 失焦先关
      row.addEventListener("click", function () {
        $id("dsh-map").value = it.map;
        closeMapList();
        planRoute(it.map);
        $id("dsh-tpmsg2").textContent = "已选 " + (it.cn || it.map) + (it.cn ? " (" + it.map + ")" : "");
      });
      box.appendChild(row);
    });
  }
  function openMapList() { var box = $id("dsh-maplist"); if (box) { renderMapList(); box.style.display = "block"; } }
  // 触屏滚动：地图联想下拉框内 touch 不外泄到游戏层，保留默认滚动（passive）
  try {
    var _ml = $id("dsh-maplist");
    if (_ml) ["touchstart", "touchmove", "touchend"].forEach(function (t) {
      _ml.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
  } catch (e) {}
  function closeMapList() { var box = $id("dsh-maplist"); if (box) box.style.display = "none"; }
  function saveMapCache() { try { saved.mapCache = mapCache; saveSaved(saved); } catch (e) {} }
  $id("dsh-map").addEventListener("input", function () { if ($id("dsh-maplist").style.display === "block") renderMapList(); });
  $id("dsh-map").addEventListener("focus", function () { openMapList(); });
  $id("dsh-map").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); closeMapList(); }
    if (e.key === "Escape") { e.preventDefault(); closeMapList(); }
  });
  $id("dsh-maptog").addEventListener("click", function (e) {
    e.stopPropagation();
    var box = $id("dsh-maplist");
    if (box.style.display === "block") closeMapList(); else openMapList();
  });
  document.addEventListener("mousedown", function (e) {
    var inp = $id("dsh-map"), tog = $id("dsh-maptog"), box = $id("dsh-maplist");
    if (!inp || !box) return;
    if (box.style.display === "block" && e.target !== inp && e.target !== tog && !box.contains(e.target)) closeMapList();
  });
  $id("dsh-tp").addEventListener("click", function () {
    try {
      var world = $id("dsh-world").value;
      var wsel = document.querySelector(".bigworld select, select[data-id], .container select");
      var clicked = false;
      if (wsel && wsel.options.length) {
        for (var i = 0; i < wsel.options.length; i++) {
          if (wsel.options[i].textContent === world || wsel.options[i].value === world) {
            wsel.selectedIndex = i;
            try { wsel.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
            clicked = true;
            break;
          }
        }
      }
      var go = document.querySelector(".gogogo");
      if (go) { go.click(); clicked = true; }
      $id("dsh-tpmsg").textContent = clicked ? "已执行（查看游戏内结果）" : "未找到传送窗口：请先在游戏内打开世界地图一次";
      if (!clicked) console.log("[RO助手] 传送定位: .bigworld=" + !!document.querySelector(".bigworld") + " .gogogo=" + !!document.querySelector(".gogogo"));
    } catch (e) { $id("dsh-tpmsg").textContent = "传送异常: " + e.message; }
  });
  // 从元素提取地图名（data-map / id / 背景图 map/*.png·bmp）——PC .bigworld td 与手机嗅探共用
  var MAPBG_RE = new RegExp("map/[a-z]+/([a-zA-Z0-9_]+)[.](png|bmp)", "i");
  function extractMapFromEl(el) {
    try {
      var m = el.getAttribute("data-map");
      if (!m || m === "Mhtmltip") m = (el.id || "").replace(/^map_/, "");
      if (!m) {
        var raw = (el.getAttribute("data-background") || "") + " " + ((el.style && el.style.backgroundImage) || "");
        var mm = MAPBG_RE.exec(raw);
        if (mm) m = mm[1];
      }
      return m || "";
    } catch (e) { return ""; }
  }
  function hasCls(cls, w) { return (" " + cls + " ").indexOf(" " + w + " ") >= 0; }
  // 手机版世界地图嗅探：深度遍历 document（含 open shadow root），收集地图格子与传送前往按钮
  function sniffWorldMap() {
    var out = { maps: [], buttons: [], idMapLike: [], shadowHosts: 0 };
    var seen = {}, seenId = {};
    function visit(root) {
      if (!root || !root.querySelectorAll) return;
      var els = root.querySelectorAll("*");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        try {
          var ta = el.tagName || "";
          var idv = el.id || "";
          var cls = (typeof el.className === "string" ? el.className : ((el.getAttribute && el.getAttribute("class")) || "") || "");
          var hasDM = !!(el.getAttribute && el.getAttribute("data-map"));
          var dn = (el.getAttribute && el.getAttribute("data-displayname")) || "";
          var bg = ((el.getAttribute && el.getAttribute("data-background")) || "") + " " + ((el.style && el.style.backgroundImage) || "");
          var isMapBg = MAPBG_RE.test(bg);
          var isMapId = /^[a-z][a-z0-9_]{2,39}$/.test(idv);
          var isSection = hasCls(cls, "section") || hasCls(cls, "map") || hasCls(cls, "world") || hasCls(cls, "town");
          var m = extractMapFromEl(el) || (isMapId ? idv : "");
          if ((hasDM || isMapBg || (isMapId && isSection)) && m && /^[a-zA-Z0-9_]{2,40}$/.test(m) && !seen[m]) {
            seen[m] = true;
            out.maps.push({ map: m, cn: dn || (el.textContent || "").trim().slice(0, 40), tag: ta, id: idv, cls: cls.slice(0, 60) });
          } else if (isMapId && !seenId[idv]) {
            seenId[idv] = true;
            out.idMapLike.push({ id: idv, tag: ta, cls: cls.slice(0, 40) });
          }
          var isBtn = ta === "BUTTON" || (el.getAttribute && el.getAttribute("type") === "button") || hasCls(cls, "btn") || hasCls(cls, "button");
          if (isBtn) {
            var txt = (((el.textContent || "") + " " + (el.getAttribute && el.getAttribute("value") || "")).trim());
            if (/传送|前往|移动|走去|确定|回去|teleport|gogo|go|move|ok/i.test(txt + " " + cls)) out.buttons.push({ tag: ta, text: txt.slice(0, 30), cls: cls.slice(0, 60), id: idv });
          }
          if (el.shadowRoot) { out.shadowHosts++; visit(el.shadowRoot); }
        } catch (e2) {}
      }
    }
    visit(document);
    return out;
  }
  $id("dsh-mapload").addEventListener("click", function () {
    try {
      var seen = {};
      var n = 0;
      var list = [];
      var cells = document.querySelectorAll('.bigworld td');
      for (var i = 0; i < cells.length; i++) {
        var m = extractMapFromEl(cells[i]);
        if (m) list.push({ map: m, cn: mapCn(m) || (cells[i].textContent || "").trim() });
      }
      var snif = null;
      if (!list.length) {
        snif = sniffWorldMap();
        for (var k = 0; k < snif.maps.length; k++) list.push({ map: snif.maps[k].map, cn: mapCn(snif.maps[k].map) || snif.maps[k].cn || "" });
      }
      for (var j = 0; j < list.length; j++) {
        var it = list[j];
        if (!it.map || seen[it.map]) continue;
        seen[it.map] = true;
        var ex = false;
        for (var q = 0; q < mapCache.length; q++) { if (mapCache[q].map === it.map) { ex = true; if (!mapCache[q].cn && it.cn) mapCache[q].cn = it.cn; break; } }
        if (!ex) mapCache.push({ map: it.map, cn: it.cn });
        n++;
      }
      saveMapCache();
      var box = $id("dsh-maplist");
      if (box) renderMapList();
      if (snif && (snif.maps.length || snif.buttons.length || snif.shadowHosts)) {
        var brief = { shadowHosts: snif.shadowHosts, totalMaps: snif.maps.length, maps: snif.maps.slice(0, 30), buttons: snif.buttons, idLike: snif.idMapLike.slice(0, 30) };
        var dbg = "";
        try { dbg = JSON.stringify(brief); console.log("[RO助手] 世界地图嗅探:", JSON.stringify(snif)); } catch (e) {}
        $id("dsh-tpmsg2").textContent = "手机嗅探命中（复制回传）｜ " + dbg;
      } else if (n) {
        $id("dsh-tpmsg2").textContent = "已读取 " + n + " 张地图（联想列表可输入过滤）";
      } else {
        $id("dsh-tpmsg2").textContent = "未读到地图：请先在游戏内打开世界地图";
        console.log("[RO助手] 地图读取失败: .bigworld=" + !!document.querySelector(".bigworld") + " td数=" + cells.length);
      }
    } catch (e) { $id("dsh-tpmsg2").textContent = "读地图异常: " + e.message; }
  });
  $id("dsh-world").addEventListener("change", function () {
    try { $id("dsh-mapload").click(); } catch (e) {}
  });
  function findMapCell(m) {
    var all = document.querySelectorAll('.bigworld td');
    for (var i = 0; i < all.length; i++) {
      var td = all[i];
      var cm = td.getAttribute("data-map");
      if (!cm || cm === "Mhtmltip") cm = (td.id || "").replace(/^map_/, "");
      if (!cm) {
        var bg = td.getAttribute("data-background") || "";
        var mm = bg.match(/map\/[a-z]+\/([a-zA-Z0-9_]+)\.png/);
        if (mm) cm = mm[1];
      }
      if (cm === m) return td;
    }
    return null;
  }
  $id("dsh-tp-map").addEventListener("click", function () {
    try {
      var m = $id("dsh-map").value;
      if (!m) { $id("dsh-tpmsg2").textContent = "先点「读地图」选择目标地图"; return; }
      var cell = findMapCell(m);
      var clicked = false;
      if (cell) { try { cell.click(); clicked = true; } catch (e) {} }
      var go = document.querySelector(".gogogo");
      if (go) { try { go.click(); clicked = true; } catch (e) {} }
      $id("dsh-tpmsg2").textContent = clicked ? "已前往 " + m : "未找到世界地图窗口：请先在游戏内打开世界地图";
    } catch (e) { $id("dsh-tpmsg2").textContent = "前往异常: " + e.message; }
  });
  $id("dsh-tp-walk").addEventListener("click", function () {
    try {
      var m = $id("dsh-map").value;
      if (!m) { $id("dsh-tpmsg2").textContent = "先「读地图」选目标地图"; return; }
      var cell = findMapCell(m);
      var clicked = false;
      if (cell) { try { cell.click(); clicked = true; } catch (e) {} }
      var mv = document.querySelector(".move");
      if (mv) { try { mv.click(); clicked = true; } catch (e) {} }
      $id("dsh-tpmsg2").textContent = clicked ? "已点「前往」——客户端自动寻路" : "未找到世界地图窗口";
      planRoute(m);
    } catch (e) { $id("dsh-tpmsg2").textContent = "走去异常: " + e.message; }
  });
  function planRoute(target) {
    try {
      var cur = getMapName();
      if (!cur) { $id("dsh-route").textContent = "路线：无法获取当前地图"; return; }
      var ND = requireDB("DB/navigateData");
      if (!ND) { $id("dsh-route").textContent = "路线：导航数据未就绪"; return; }
      var adj = {};
      var src = ND.targets || ND.sources || ND;
      if (src && typeof src === "object") {
        Object.keys(src).forEach(function (map) {
          adj[map] = adj[map] || [];
          var t = src[map];
          if (Array.isArray(t)) t.forEach(function (e) { if (e && e.map) adj[map].push(e.map); });
        });
      }
      if (!Object.keys(adj).length) { $id("dsh-route").textContent = "路线：邻接表未识别"; return; }
      var prev = {}, q = [cur], seen = {}; seen[cur] = true; var found = false;
      while (q.length && !found) {
        var m2 = q.shift();
        (adj[m2] || []).forEach(function (n2) {
          if (!seen[n2]) { seen[n2] = true; prev[n2] = m2; if (n2 === target) found = true; else q.push(n2); }
        });
      }
      if (!found) { $id("dsh-route").textContent = "路线：走不到 " + target; return; }
      var path = [target], p2 = target;
      while (p2 !== cur) { p2 = prev[p2]; if (!p2) break; path.unshift(p2); }
      $id("dsh-route").textContent = "路线: " + path.join(" → ");
    } catch (e) { $id("dsh-route").textContent = "路线异常: " + e.message; }
  }
  // ---------------- 坐标走路 / 跨图传送串接（walkToXY 原语定义见上游移动原语）----------------
  function mvCurMap() {
    try {
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      var mm = getMapName();
      if (mm) $id("dsh-mvmap").value = mm;
      if (ent && ent.position) {
        $id("dsh-mvx").value = Math.floor(ent.position[0]);
        $id("dsh-mvy").value = Math.floor(ent.position[1]);
      }
      var cpos = (ent && ent.position) ? (Math.floor(ent.position[0]) + "," + Math.floor(ent.position[1])) : "?";
      mvLog("已填入当前图 " + (mm || "?") + " 坐标 (" + cpos + ")");
    } catch (e) { mvLog("填入失败: " + e.message); }
  }
  // 世界地图 .gogogo 免费传送：findMapCell 点目标图格子 + 点 .gogogo → 轮询 getMapName 变目标图（超时 20s）
  function teleportToMap(map, onArrive) {
    var t0 = Date.now();
    var clicked = false;
    try {
      var cell = findMapCell(map);
      if (cell) { try { cell.click(); clicked = true; } catch (e) {} }
      var go = document.querySelector(".gogogo");
      if (go) { try { go.click(); clicked = true; } catch (e) {} }
    } catch (e) {}
    if (!clicked) { mvLog("传送失败：未定位世界地图窗口（请先游戏内打开一次世界地图）"); return; }
    mvLog("传送中 → " + map + " …");
    var iv = setInterval(function () {
      try {
        var cur = getMapName();
        if (cur && map && cur.toLowerCase() === map.toLowerCase()) {
          clearInterval(iv);
          mvLog("已到 " + map);
          if (typeof onArrive === "function") onArrive();
        } else if (Date.now() - t0 > 20000) {
          clearInterval(iv);
          mvLog("传送超时（20s 不在 " + map + "，当前 " + (cur || "?") + "）");
        }
      } catch (e) { clearInterval(iv); }
    }, 800);
  }
  $id("dsh-mvcur").addEventListener("click", mvCurMap);
  $id("dsh-mvstop").addEventListener("click", stopWalkXY);
  $id("dsh-mvgo").addEventListener("click", function () {
    try {
      var x = parseInt($id("dsh-mvx").value, 10);
      var y = parseInt($id("dsh-mvy").value, 10);
      if (isNaN(x) || isNaN(y)) { mvLog("先填 X/Y（可点「填入当前位置」）"); return; }
      var want = ($id("dsh-mvmap").value || "").trim();
      var cur = getMapName();
      var sameMap = !want || !cur || want === cur || (want.toLowerCase() === cur.toLowerCase());
      if (sameMap) {
        walkToXY(x, y, null, "dsh-mvlog");
      } else {
        teleportToMap(want, function () { walkToXY(x, y, null, "dsh-mvlog"); });
      }
    } catch (e) { mvLog("走路异常: " + e.message); }
  });
  // 输入框非空时按 Enter/点选条目驱动寻路（联想点选已触发 planRoute；原 select change 已移除）

  // ---------------- 回城 / NPC / 卖装备 ----------------
  var npcList = [];
  var selNpc = null; // 当前选中的 NPC {GID,name,pos}
  $id("dsh-tp-town").addEventListener("click", function () {
    try {
      var clicked = false;
      var cell = document.querySelector('.bigworld td[data-map="prontera"], .bigworld td[data-map="map_prontera"], td[data-map*="pron"]');
      if (cell) { try { cell.click(); clicked = true; } catch (e) {} }
      var go = document.querySelector(".gogogo");
      if (go) { try { go.click(); clicked = true; } catch (e) {} }
      $id("dsh-tpmsg2").textContent = clicked ? "回城指令已发" : "未定位到世界地图：请先在游戏内打开世界地图";
      if (!clicked) console.log("[RO助手] 回城定位: 城镇格子=" + !!cell + " gogogo=" + !!go);
    } catch (e) { $id("dsh-tpmsg2").textContent = "回城异常: " + e.message; }
  });
  $id("dsh-scan-npc").addEventListener("click", function () {
    npcList = [];
    selNpc = null;
    try {
      if (!window.require) throw new Error("客户端未就绪");
      var EM = window.require("Renderer/EntityManager");
      EM.forEach(function (e) {
        try {
          if (e.objecttype === 6 || e.objecttype === 12) {
            npcList.push({ GID: e.GID, name: e.displayName || e.name || (e.display && e.display.name) || String(e.GID), pos: e.position ? [e.position[0], e.position[1]] : null });
          }
        } catch (e2) {}
      });
    } catch (e) { $id("dsh-cleanlog").textContent = "扫描异常: " + e.message; return; }
    var box = $id("dsh-npclist");
    if (!box) return;
    box.innerHTML = "";
    if (!npcList.length) { box.textContent = "未发现NPC（需在城镇内）"; }
    else {
      npcList.forEach(function (n, i) {
        var row = document.createElement("div");
        row.textContent = (i + 1) + ". " + n.name + (n.pos ? " (" + Math.floor(n.pos[0]) + "," + Math.floor(n.pos[1]) + ")" : "");
        row.style.cssText = "padding:3px 5px;cursor:pointer;border-bottom:1px solid #eef2f6";
        row.addEventListener("click", function () {
          selNpc = n;
          var all = box.querySelectorAll("div");
          for (var k = 0; k < all.length; k++) all[k].style.background = "";
          row.style.background = "#eaf2fb";
          $id("dsh-cleanlog").textContent = "已选中 " + n.name + " (GID " + n.GID + ")";
        });
        box.appendChild(row);
      });
      selNpc = npcList[0];
      if (box.firstChild) box.firstChild.style.background = "#eaf2fb";
    }
    $id("dsh-cleanlog").textContent = "扫描到 " + npcList.length + " 个NPC" + (npcList.length ? "（默认选中第 1 个，点条目切换）" : "");
  });
  $id("dsh-go-npc").addEventListener("click", function () {
    try {
      if (!selNpc) { $id("dsh-cleanlog").textContent = "先点「扫描NPC」并选中一个 NPC"; return; }
      if (!selNpc.pos) { $id("dsh-cleanlog").textContent = "NPC 无坐标（需在城镇内扫描）"; return; }
      var ok = walkToXY(selNpc.pos[0], selNpc.pos[1], function () {
        $id("dsh-cleanlog").textContent = "已到达 " + selNpc.name + " 旁，可点「点NPC对话」";
      }, "dsh-cleanlog");
      if (ok) $id("dsh-cleanlog").textContent = "走向 NPC「" + selNpc.name + "」…";
    } catch (e) { $id("dsh-cleanlog").textContent = "走到NPC异常: " + e.message; }
  });
  $id("dsh-talk-npc").addEventListener("click", function () {
    try {
      if (!clientReady()) throw new Error("客户端未就绪");
      var target = null;
      // 优先：对话选中的 NPC（需在 2 格内，否则回退最近 NPC）
      if (selNpc && selNpc.GID != null && selNpc.pos) {
        var ent0 = CLIENT.SS.Entity;
        if (ent0 && ent0.position) {
          var dd0 = Math.abs(selNpc.pos[0] - ent0.position[0]) + Math.abs(selNpc.pos[1] - ent0.position[1]);
          if (dd0 <= 2) target = { GID: selNpc.GID, displayName: selNpc.name };
        }
      }
      if (!target) {
        // 选中不在身边（或无选中）→ 回退最近 NPC
        var EM = window.require("Renderer/EntityManager");
        var ent = CLIENT.SS.Entity;
        var best = 1e9;
        EM.forEach(function (e) {
          try {
            if ((e.objecttype === 6 || e.objecttype === 12) && ent && e.position) {
              var d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
              if (d < best) { best = d; target = e; }
            }
          } catch (e2) {}
        });
        if (!target) throw new Error("附近没有NPC（先扫描并「走到选中」）");
      }
      lastTalkNpc = {
        GID: target.GID,
        name: target.displayName || target.name || (target.display && target.display.name) || "",
        pos: (target.position && target.position.length >= 2) ? [target.position[0], target.position[1]] : (selNpc && selNpc.pos ? [selNpc.pos[0], selNpc.pos[1]] : null)
      };
      var p = new CLIENT.PS.CZ.CONTACTNPC();
      p.NAID = target.GID; p.type = 1;
      CLIENT.NM.sendPacket(p);
      $id("dsh-cleanlog").textContent = "已点击 NPC「" + (target.displayName || target.name || target.GID) + "」";
    } catch (e) { $id("dsh-cleanlog").textContent = "对话异常: " + e.message; }
  });
  $id("dsh-sell").addEventListener("click", function () {
    try {
      if (!clientReady()) throw new Error("客户端未就绪");
      var inv = findInventory();
      if (!inv) { $id("dsh-cleanlog").textContent = "未定位到背包（自动探测中…）。请先在游戏内打开背包"; return; }
      var sellList = [];
      for (var j = 0; j < inv.length; j++) {
        var it = inv[j] || {};
        if (it.ITID != null && (it.type === 4 || it.type === 5 || it.itemType === 4 || it.itemType === 5)) {
          sellList.push({ index: it.index != null ? it.index : j, amount: it.amount || it.count || 1, ITID: it.ITID });
        }
      }
      if (!sellList.length) { $id("dsh-cleanlog").textContent = "背包里没有可卖的装备类物品"; return; }
      var sp = new CLIENT.PS.CZ.PC_SELL_ITEMLIST();
      sp.itemList = sellList;
      CLIENT.NM.sendPacket(sp);
      $id("dsh-cleanlog").textContent = "已发送卖单 " + sellList.length + " 件装备";
    } catch (e) { $id("dsh-cleanlog").textContent = "卖装备异常: " + e.message; }
  });

  // ---------------- 菜单侦察（对话采集 · 阶段1） ----------------
  var menuRecon = { NAID: 0, msg: "", items: [], map: "", npcName: "", pos: null, time: 0 };
  var lastTalkNpc = null; // 点「点NPC对话」时记录的目标实体（真实 GID/name/pos，用于菜单反查）
  function decodeMenuMsg(bytes) {
    var end = bytes.length;
    for (var i = 0; i < bytes.length; i++) { if (bytes[i] === 0) { end = i; break; } }
    var sub = bytes.subarray(0, end);
    var s;
    try { s = new TextDecoder("gbk").decode(sub); }
    catch (e) { s = new TextDecoder("utf-8").decode(sub); }
    return s.replace(/[\u0000-\u001f\u007f\ufffd]/g, "");
  }
  function splitMenu(msg) {
    return String(msg).replace(/[\u0000-\u001f\u007f\ufffd]/g, "").split(":").map(function (s) { return s.replace(/^\s+|\s+$/g, ""); }).filter(function (s) { return s.length > 0; });
  }
  // ---- V2.8.7 任务树采集 + 自动上报（Tailscale → 电脑接收服务）----
  var reconSteps = [];
  var ingestOk = 0, ingestFail = 0;
  var INGEST_URL = "https://node.tail05bb10.ts.net/";
  function renderIngest() {
    var el = $id("dsh-menu-status");
    if (el) el.textContent = "自动上报：成功 " + ingestOk + " 条" + (ingestFail ? "，失败 " + ingestFail + " 条（下次抓到会重试）" : "");
  }
  function ingest(payload) {
    try {
      if (typeof fetch !== "function") { ingestFail++; renderIngest(); return; }
      fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) { if (r && r.ok) ingestOk++; else ingestFail++; renderIngest(); })
        .catch(function () { ingestFail++; renderIngest(); });
    } catch (e) { ingestFail++; }
  }
  function pushStep(kind, text, menu, map, npcName, gid, pos) {
    var g = (gid != null) ? gid : ((lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : 0);
    var step = { kind: kind, text: text || "", menu: menu || null, map: map || getMapName(), npcName: npcName || "", gid: g, pos: pos || null, ts: Date.now() };
    reconSteps.push(step);
    ingest({ type: kind, map: step.map, npcGID: step.gid, npcName: step.npcName, pos: step.pos, text: step.text, menu: step.menu, stepIdx: reconSteps.length - 1, ts: new Date().toISOString() });
  }
  function renderMenuRecon() {
    var el = $id("dsh-menu-recon");
    if (!el) return;
    if (!menuRecon.items.length) { el.textContent = "菜单未拆出选项（原始：" + menuRecon.msg + "）"; return; }
    var lines = [];
    for (var i = 0; i < menuRecon.items.length; i++) lines.push(i + ") " + menuRecon.items[i]);
    var head = "NPC " + (menuRecon.npcName || ("GID " + menuRecon.NAID)) + " · " + (menuRecon.map || "?");
    if (menuRecon.pos) head += " (" + menuRecon.pos[0] + "," + menuRecon.pos[1] + ")";
    el.textContent = head + "\n" + lines.join("\n");
  }
  function onMenuList(bytes) {
    try {
      if (!bytes || bytes.byteLength < 6) return;
      var dv = new DataView(bytes);
      if (dv.getUint16(0, true) !== 183) return; // ZC.MENU_LIST（菜单）
      var NAID = dv.getUint32(2, true);
      var NAIDs = NAID > 2147483647 ? NAID - 4294967296 : NAID;
      var msg = decodeMenuMsg(new Uint8Array(bytes, 6, bytes.byteLength - 6));
      var npcName = "", pos = null;
      try {
        if (lastTalkNpc && lastTalkNpc.GID != null) {
          npcName = lastTalkNpc.name || "";
          pos = lastTalkNpc.pos;
          var gid = lastTalkNpc.GID;
          var gidU = gid < 0 ? gid + 4294967296 : gid;
          var gidS = gid > 2147483647 ? gid - 4294967296 : gid;
          var EM = CLIENT.EM || (window.require && window.require("Renderer/EntityManager"));
          if (EM && EM.forEach) EM.forEach(function (e) {
            if (e && (e.GID === gid || e.GID === gidU || e.GID === gidS)) {
              npcName = e.displayName || e.name || (e.display && e.display.name) || npcName;
              if (e.position) pos = [e.position[0], e.position[1]];
            }
          });
        } else {
          var EM2 = CLIENT.EM || (window.require && window.require("Renderer/EntityManager"));
          if (EM2 && EM2.forEach) EM2.forEach(function (e) {
            if (e && (e.GID == NAID || e.GID == NAIDs)) { npcName = e.displayName || e.name || (e.display && e.display.name) || ""; if (e.position) pos = [e.position[0], e.position[1]]; }
          });
        }
      } catch (e2) {}
      var items = splitMenu(msg);
      menuRecon = { NAID: NAID, msg: msg, items: items, map: getMapName(), npcName: npcName, pos: pos, time: Date.now() };
      renderMenuRecon();
      pushStep("menu", msg, items, menuRecon.map, npcName, (lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : NAID, pos);
    } catch (e) {}
  // MVP_TIMER_START: 公告栏剩余时间以接收时刻为基准，关闭窗口不停止计时。
  var mvpStoreKey = "dsh_mvp_timer_v1_cv_" + pickCv();
  var mvpRecords = {};
  try { mvpRecords = JSON.parse(localStorage.getItem(mvpStoreKey) || "{}"); } catch (e) {}
  if (!mvpRecords || typeof mvpRecords !== "object" || Array.isArray(mvpRecords)) mvpRecords = {};
  var mvpRecent = {}, mvpTimerBody = null, mvpActionStatus = null;
  function mvpParse(text, now) {
    var clean = String(text).replace(/\^[0-9a-f]{6}/gi, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
    var parts = clean.split(/(?=[(（]\s*Lv\.?\s*\d+\s*[)）])/i), rows = [];
    parts.forEach(function (part) {
      var head = part.match(/^[(（]\s*Lv\.?\s*(\d+)\s*[)）]\s*/i);
      if (!head) return;
      var rest = part.slice(head[0].length).trim();
      var dead = rest.match(/^(.+?)\s*被击败\s*[(（]([^()（）]+)后复活[)）]/);
      if (dead) {
        var duration = dead[2].replace(/\s/g, ""), ms = 0;
        var remain = duration.replace(/(\d+)(天|小时|分钟|分|秒钟|秒)/g, function (_, value, unit) {
          ms += Number(value) * ({天:86400000, 小时:3600000, 分钟:60000, 分:60000, 秒钟:1000, 秒:1000}[unit]); return "";
        });
        if (remain || !duration || !isFinite(ms)) return;
        rows.push({ name: dead[1].trim(), level: Number(head[1]), state: "dead", due: now + ms, seen: now });
        return;
      }
      var alive = rest.match(/^(.+?)\s*位于地图\s*([a-z0-9_]+)(?:\.gat)?/i);
      if (alive) rows.push({ name: alive[1].trim(), level: Number(head[1]), state: "alive", map: alive[2], seen: now });
    });
    return rows;
  }
  function mvpReceive(text, force) {
    var now = Date.now(), rows = mvpParse(text, now);
    if (!rows.length) return;
    if (!force && mvpRecent.text === text && now - mvpRecent.at < 1000) return;
    mvpRecent = { text: text, at: now };
    rows.forEach(function (row) { mvpRecords[row.level + ":" + row.name] = row; });
    try { localStorage.setItem(mvpStoreKey, JSON.stringify(mvpRecords)); } catch (e) {}
    mvpRender();
  }
  function mvpClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }
  // 从可见日志正文读取，兼容连接建立早于脚本以及自定义对话协议。
  var mvpDomSeen = new Map(), mvpDomQueued = false;
  function mvpScanDom() {
    mvpDomQueued = false;
    var candidates = new Set(), current = new Map();
    var walker = document.createTreeWalker(document.body, 4), textNode;
    while ((textNode = walker.nextNode())) {
      if (!/MVP\s*日志|[(（]\s*Lv\.?\s*\d+/i.test(textNode.nodeValue || "")) continue;
      var el = textNode.parentElement;
      if (!el || el.closest("#dsh-mvp-timers,script,style,textarea")) continue;
      for (var i = 0; el && el !== document.body && i < 7; i++, el = el.parentElement) {
        if (el.querySelector("#dsh-mvp-timers")) break;
        candidates.add(el);
      }
    }
    candidates.forEach(function (el) {
      if (!el.isConnected || !el.getClientRects().length) return;
      for (var p = el; p && p !== document.body; p = p.parentElement) {
        var css = getComputedStyle(p);
        if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse") return;
      }
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 60000 || !mvpParse(text, 0).length) return;
      current.set(el, text);
    });
    var selected = new Map(), best = null, bestText = "", bestCount = 0;
    current.forEach(function (text, el) {
      var count = mvpParse(text, 0).length;
      if (count > bestCount || (count === bestCount && (!best || text.length < bestText.length || (text.length === bestText.length && best.contains(el))))) {
        best = el; bestText = text; bestCount = count;
      }
    });
    if (best) {
      selected.set(best, bestText);
      if (mvpDomSeen.get(best) !== bestText) mvpReceive(bestText, true);
    }
    mvpDomSeen = selected;
  }
  function mvpWatchDom() {
    function queue() {
      if (mvpDomQueued) return;
      mvpDomQueued = true; setTimeout(mvpScanDom, 120);
    }
    new MutationObserver(function (changes) {
      var relevant = changes.some(function (change) {
        var el = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        return el && !el.closest("#dsh-mvp-timers");
      });
      if (!relevant) return;
      mvpDomSeen.forEach(function (_, el) {
        if (!el.isConnected || !el.getClientRects().length || !mvpParse(el.textContent || "", 0).length) mvpDomSeen.delete(el);
      });
      queue();
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    mvpScanDom(); setInterval(queue, 1500);
  }
  function mvpRender() {
    if (!mvpTimerBody || mvpTimerBody.hidden) return;
    mvpTimerBody.textContent = "";
    var rows = Object.keys(mvpRecords).map(function (k) { return mvpRecords[k]; }).filter(function (r) {
      return r && typeof r.name === "string" && isFinite(r.seen) && (r.state === "alive" || (r.state === "dead" && isFinite(r.due)));
    });
    if (!rows.length) { mvpTimerBody.textContent = "暂无记录。请打开公告栏#i1 → 第一个选项（MVP日志）。"; return; }
    rows.sort(function (a, b) { return (a.due || 0) - (b.due || 0); });
    rows.forEach(function (r) {
      var line = document.createElement("div"), info = document.createElement("div");
      line.style.cssText = "padding:7px 0;border-bottom:1px solid #43506a";
      var remaining = r.due - Date.now();
      line.textContent = r.name + " · " + (r.state === "alive" ? "日志显示存活" : remaining > 0 ? mvpClock(remaining) + " 后预计复活" : "计时已到 · 待确认");
      if (r.map && /^[a-z0-9_]+$/i.test(r.map)) {
        var link = document.createElement("button");
        link.textContent = r.map + " ↗";
        link.title = "传送到 " + r.map;
        link.style.cssText = "background:transparent;color:#8fdcff;border:0;text-decoration:underline;cursor:pointer;padding:2px 4px;font:inherit";
        link.onclick = function () { mvpTeleport(r.map); };
        line.appendChild(link);
      }
      info.style.cssText = "font-size:11px;color:#aebed6;margin-top:3px";
      info.textContent = "校准：" + new Date(r.seen).toLocaleString();
      line.appendChild(info); mvpTimerBody.appendChild(line);
    });
  }
  var mvpTravel = null;
  function mvpTeleport(map) {
    if (!/^[a-z0-9_]{1,15}$/i.test(map)) return;
    function status(text) { if (mvpActionStatus) mvpActionStatus.textContent = text; }
    function current() { return String(getMapName() || "").replace(/\.gat$/i, "").toLowerCase(); }
    if (mvpTravel) { status("正在前往 " + mvpTravel.map + "，请等待结果"); return; }
    if (!clientReady()) { status("传送失败：客户端未就绪，请先进入游戏"); return; }
    if (current() === map.toLowerCase()) { status("已在目标地图 " + map); return; }
    try {
      var Packet = CLIENT.PS && CLIENT.PS.CZ && CLIENT.PS.CZ.PRIVATE_AIRSHIP_REQUEST;
      if (typeof Packet !== "function") { status("当前客户端缺少传送接口 PRIVATE_AIRSHIP_REQUEST"); return; }
      var pkt = new Packet(); pkt.mapname = map; pkt.itemid = 14527;
      CLIENT.NM.sendPacket(pkt);
      status("传送请求已发送 → " + map + "，等待游戏确认…");
      var started = Date.now();
      mvpTravel = { map: map, timer: setInterval(function () {
        var arrived = current() === map.toLowerCase();
        if (!arrived && Date.now() - started < 20000) return;
        clearInterval(mvpTravel.timer); mvpTravel = null;
        status(arrived ? "已到达 " + map : "未到达 " + map + "；请查看游戏提示（地图限制或传送条件）");
      }, 500) };
    } catch (e) { status("传送失败：" + e.message); }
  }
  function mvpInit() {
    // 面板内嵌版：mvpTimerBody/mvpActionStatus 指向辅助页 ap-mvp 子页内的元素
    var host = document.getElementById("dsh-mvp-timers");
    var statusEl = document.getElementById("dsh-mvp-status");
    if (!host) return;
    mvpTimerBody = host;
    mvpActionStatus = statusEl || null;
    // 浮窗按钮已通过 data-fw="mvp" 挂面板统一浮窗分发；这里仅注册区块
    try { fwReg("mvp", "MVP 计时", function () { return document.getElementById("dsh-mvp-timers"); }); } catch (e2) {}
    mvpRender(); setInterval(mvpRender, 1000); mvpWatchDom();
  }
  // MVP_TIMER_END

  }
  function onSayDialog(bytes) {
    try {
      if (!bytes || bytes.byteLength < 6) return;
      var dv = new DataView(bytes);
      if (dv.getUint16(0, true) !== 180) return; // ZC.SAY_DIALOG（对话正文，任务名/要求在这里）
      var NAID = dv.getUint32(2, true);
      var msg = decodeMenuMsg(new Uint8Array(bytes, 6, bytes.byteLength - 6));
      if (!msg) return;
      var gid = (lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : NAID;
      var nm = (lastTalkNpc && lastTalkNpc.name) || "";
      var ps = (lastTalkNpc && lastTalkNpc.pos) || null;
      mvpReceive(msg); // MVP 计时：对话正文含 MVP 日志时自动校准
      pushStep("dialog", msg, null, getMapName(), nm, gid, ps);
    } catch (e) {}
  }
  function onCloseDialog() {
    try { pushStep("close", "", null, getMapName(), (lastTalkNpc && lastTalkNpc.name) || "", (lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : 0, null); } catch (e) {}
    reconSteps = [];
  }
  // V2.9.0 任务正文取证：未知 opcode 里含中文的包 → 上报（定位 lastro 自研任务正文包）
  var rawOpLog = {}, rawOpTotal = 0;
  function onRawOpcode(bytes, op) {
    try {
      if (rawOpTotal >= 200) return; // 总量限流
      var nw = Date.now();
      if (rawOpLog[op] && nw - rawOpLog[op] < 10000) return; // 同 opcode 10s 限 1 条
      if (bytes.byteLength < 8) return;
      var msg = decodeMenuMsg(new Uint8Array(bytes, 6, bytes.byteLength - 6));
      if (!msg || !/[一-鿿]/.test(msg)) return; // 只报含中文的（任务正文候选）
      rawOpLog[op] = nw; rawOpTotal++;
      var hex = "";
      try { var arr = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)); for (var i = 0; i < arr.length; i++) hex += (arr[i] < 16 ? "0" : "") + arr[i].toString(16); } catch (e3) {}
      ingest({ type: "raw", opcode: op, hex: hex, map: getMapName(), npcGID: (lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : 0, npcName: (lastTalkNpc && lastTalkNpc.name) || "", pos: (lastTalkNpc && lastTalkNpc.pos) || null, text: msg.slice(0, 200), stepIdx: reconSteps.length, ts: new Date().toISOString() });
    } catch (e2) {}
  }
  function dispatchInbound(bytes) {
    try {
      var dv = new DataView(bytes);
      var op = dv.getUint16(0, true);
      if (op === 183) onMenuList(bytes);
      else if (op === 180) onSayDialog(bytes);
      else if (op === 182) onCloseDialog();
      else onRawOpcode(bytes, op);
    } catch (e) {}
  }
  function onReconInbound(data) {
    try {
      if (data instanceof ArrayBuffer) { dispatchInbound(data); return; }
      if (data && data.buffer instanceof ArrayBuffer) { dispatchInbound(data.buffer); return; }
      if (typeof Blob !== "undefined" && data instanceof Blob && data.arrayBuffer) { data.arrayBuffer().then(dispatchInbound); }
    } catch (e) {}
  }
  function hookMenuRecon() {
    if (window.__dshMenuReconHooked) return;
    try {
      var N = window.WebSocket;
      if (!N) return;
      function PW(url, protocols) {
        var inst = protocols !== undefined ? new N(url, protocols) : new N(url);
        try { inst.addEventListener("message", function (ev) { onReconInbound(ev.data); }); } catch (e) {}
        return inst;
      }
      PW.prototype = N.prototype; PW.CONNECTING = N.CONNECTING; PW.OPEN = N.OPEN; PW.CLOSING = N.CLOSING; PW.CLOSED = N.CLOSED;
      window.WebSocket = PW;
      window.__dshMenuReconHooked = true;
    } catch (e) {}
  }
  function buildMenuJson() {
    return JSON.stringify({
      type: "npc_menu",
      map: menuRecon.map || "",
      npcName: menuRecon.npcName || "",
      npcGID: (lastTalkNpc && lastTalkNpc.GID != null) ? lastTalkNpc.GID : menuRecon.NAID,
      pos: menuRecon.pos,
      menu: menuRecon.items.map(function (t, i) { return { idx: i, text: t }; }),
      capturedAt: new Date().toISOString()
    }, null, 2);
  }
  $id("dsh-menu-export").addEventListener("click", function () {
    if (!menuRecon.items.length) { $id("dsh-cleanlog").textContent = "先捕获菜单（点NPC对话）"; return; }
    var j = buildMenuJson();
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(j); } catch (e) {}
    $id("dsh-menu-recon").textContent = "已生成JSON（已尝试复制到剪贴板）:\n" + j;
  });
  $id("dsh-menu-copy").addEventListener("click", function () {
    if (!menuRecon.items.length) { $id("dsh-cleanlog").textContent = "先捕获菜单（点NPC对话）"; return; }
    var j = buildMenuJson();
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(j); } catch (e) {}
    $id("dsh-cleanlog").textContent = navigator.clipboard ? "已复制JSON到剪贴板" : "剪贴板不可用";
  });
  $id("dsh-menu-choose").addEventListener("click", function () {
    try {
      if (!clientReady()) throw new Error("客户端未就绪");
      if (!menuRecon.NAID) { $id("dsh-cleanlog").textContent = "先捕获菜单（点NPC对话）"; return; }
      var n = parseInt($id("dsh-menu-num").value, 10);
      if (isNaN(n) || n < 0) { $id("dsh-cleanlog").textContent = "菜单序号无效"; return; }
      var c = new CLIENT.PS.CZ.CHOOSE_MENU();
      c.NAID = menuRecon.NAID; c.num = n + 1; // 协议 1 起(官方 _index+1),界面序号 0 起
      CLIENT.NM.sendPacket(c);
      $id("dsh-cleanlog").textContent = "已发 CHOOSE_MENU：第 " + (n + 1) + " 项" + (menuRecon.items[n] ? "（" + menuRecon.items[n] + "）" : "");
    } catch (e) { $id("dsh-cleanlog").textContent = "选菜单异常: " + e.message; }
  });
  $id("dsh-menu-next").addEventListener("click", function () {
    try {
      if (!clientReady()) throw new Error("客户端未就绪");
      if (!menuRecon.NAID) { $id("dsh-cleanlog").textContent = "先捕获菜单（点NPC对话）"; return; }
      var p = new CLIENT.PS.CZ.REQ_NEXT_SCRIPT();
      p.NAID = menuRecon.NAID;
      CLIENT.NM.sendPacket(p);
      $id("dsh-cleanlog").textContent = "已发 REQ_NEXT_SCRIPT（下一段对话）";
    } catch (e) { $id("dsh-cleanlog").textContent = "下一段异常: " + e.message; }
  });
  hookMenuRecon();

  // ---------------- 快速侦查 ----------------
  var reconSeen = {};
  function renderRecon() {
    var el = $id("dsh-recon");
    if (!el) return;
    try {
      if (!window.require) { el.textContent = "客户端未就绪"; return; }
      var EM = window.require("Renderer/EntityManager");
      if (!EM || !EM.forEach) { el.textContent = "实体管理器不可用"; return; }
      var mobs = 0, items = 0, parts = [];
      EM.forEach(function (e) {
        try {
          if (e.objecttype === 5) { mobs++; parts.push("怪 " + (getMobName(e._job != null ? e._job : e.job) || e.displayName || ("ID" + e.GID))); }
          else if (e.objecttype === 11) {
            items++;
            var itid = (e.ITID != null ? e.ITID : (e.itemid != null ? e.itemid : "?"));
            if (!reconSeen[String(itid)]) {
              reconSeen[String(itid)] = true;
              try { console.log("[RO助手] 地面物品实体字段: " + Object.keys(e).join(",")); } catch (e2) {}
            }
            recordDrop(itid, e.displayName || e.name);
          }
        } catch (e3) {}
      });
      el.textContent = "怪物 " + mobs + " 只 | 物品 " + items + " 个" + (parts.length ? "\n" + parts.slice(0, 15).join("\n") : "");
    } catch (e) { el.textContent = "侦查异常: " + e.message; }
  }

  // ---------------- 战斗监控浮层（游戏画面正上方，独立于助手面板） ----------------
  // 固定在视口顶部居中，半透明深色底保证在游戏画面上可读；pointer-events:none 不挡游戏操作
  var zHudEl = null;
  function ensureZHud() {
    if (zHudEl && zHudEl.parentNode) return;
    try {
      zHudEl = document.createElement("div");
      zHudEl.id = "dsh-ro-z-hud";
      zHudEl.style.cssText =
        "position:fixed;top:4px;left:50%;transform:translateX(-50%);" +
        "background:rgba(0,0,0,0.66);color:#fff;padding:2px 12px;border-radius:12px;" +
        "font-size:11px;line-height:1.5;white-space:nowrap;font-family:inherit;" +
        "z-index:2147483647;user-select:none;cursor:move;" +
        "border:1px solid rgba(255,255,255,0.28);box-shadow:0 1px 8px rgba(0,0,0,0.55);" +
        "text-shadow:0 1px 2px rgba(0,0,0,0.6);";
      document.documentElement.appendChild(zHudEl);
      // V1.7.6 横条可拖动：拖到哪停哪，位置持久化；恢复保存的位置
      try {
        var zp = JSON.parse(localStorage.getItem("dsh_zhud_pos") || "null");
        if (zp && zp.length === 2) {
          zHudEl.style.left = zp[0] + "px"; zHudEl.style.top = zp[1] + "px";
          zHudEl.style.transform = "none";
        }
      } catch (e) {}
      dragEl(zHudEl, function (x, y) {
        zHudEl.style.left = x + "px"; zHudEl.style.top = y + "px";
        zHudEl.style.transform = "none";
        try { localStorage.setItem("dsh_zhud_pos", JSON.stringify([x, y])); } catch (err) {}
      });
    } catch (e) {}
  }
  function renderZMonitor() {
    ensureZHud();
    if (!zHudEl) return;
    try {
      var hpPct = "—", spPct = "—";
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (ent && ent.life) {
        var l = ent.life;
        if (l.hp_max > 0) hpPct = Math.round(l.hp / l.hp_max * 100) + "%";
        if (l.sp_max > 0) spPct = Math.round(l.sp / l.sp_max * 100) + "%";
      }
      var lockTxt = zLock.gid
        ? ("🔒 " + (zLock.name || zLock.gid) + (zLock.dist != null ? " [" + zLock.dist + "格]" : ""))
        : (zLock.done ? "⏹ 已击杀待命" : "未锁定");
      zHudEl.textContent = "⚔ 锁定: " + lockTxt + " | 动作: " + zMon.action + " | HP " + hpPct + " SP " + spPct;
    } catch (e) {}
  }

  // V1.7.6 当前状态查看器：buffActive 判活环（服务器通知）+ 实体字段状态，2s 刷新
  var _stNameRev = null;
  var _stNameEnRev = null;
  function statusNameById(id) { // 状态ID → 中文别名（buff/debuff 表反查，查不到回引擎 StatusConst 英文名，再回数字）
    try {
      if (id == null) return null;
      if (!_stNameRev) {
        _stNameRev = {};
        var scan = function (tbl) {
          for (var k in tbl) {
            var sid = buffStId(k);
            if (sid >= 0 && !_stNameRev[sid]) _stNameRev[sid] = k;
          }
        };
        scan(BUFF_STATUS_CN);
        scan(BUFF_DEBUFF_CN);
      }
      if (_stNameRev[id]) return _stNameRev[id];
      // 英文名兜底：引擎 StatusConst（{NAME: value} 反向 → value: NAME），懒加载缓存
      if (!_stNameEnRev) {
        _stNameEnRev = {};
        try {
          var SC = window.require && window.require("DB/Status/StatusConst");
          if (SC) for (var en in SC) { if (typeof SC[en] === "number" && !_stNameEnRev[SC[en]]) _stNameEnRev[SC[en]] = en; }
        } catch (e2) {}
      }
      return _stNameEnRev[id] || null;
    } catch (e) { return null; }
  }
  function renderStatusView() {
    try {
      var el = $id("dsh-statusview");
      if (!el) return;
      var ent = CLIENT.SS && CLIENT.SS.Entity;
      if (!ent) { el.textContent = "未进入游戏"; return; }
      var now = Date.now(), parts = [];
      // 1) 判活环（服务器状态通知）：在身且未过期
      for (var sid in buffActive) {
        var s = buffActive[sid];
        if (!s || !s.on) continue;
        if (s.endAt !== Infinity && s.endAt <= now) continue;
        var nm = statusNameById(parseInt(sid, 10));
        if (!nm) nm = "状态#" + sid;
        var deb = BUFF_DEBUFF_CN[nm] ? true : false;
        var left = s.endAt === Infinity ? "常驻" : Math.max(0, Math.round((s.endAt - now) / 1000)) + "s";
        parts.push((deb ? "[debuff] " : "") + nm + "[ID:" + sid + "](" + left + ")");
      }
      // 2) 实体字段状态（无通知，判活靠字段位）
      var st = entStatus();
      var ef = [];
      if (st) {
        if (st.explosion) ef.push("爆气");
        if (st.berserk) ef.push("狂暴");
        if (st.soullink) ef.push("灵魂");
        if (st.riding) ef.push("骑乘");
        if (st.falcon) ef.push("猎鹰");
      }
      for (var i = 0; i < ef.length; i++) parts.push(ef[i] + "(实体)");
      parts.push("【判活表 " + Object.keys(buffActive).length + " 条 · hook:" + (typeof dshSIState !== "undefined" ? dshSIState : "?") + "】");
      el.textContent = parts.length ? parts.join(" · ") : "无在身状态";
    } catch (e) {}
  }

  // ---------------- 主循环 ----------------
  // V1.7.6 悬浮动作提示：#dsh-ztip 镜像 setStatus 文本 + zMon.action + 动作停顿秒数
  //   助手/内挂运行时常显（不挡游戏，pointer-events:none），全停自动隐藏
  var zTipEl = null, zTipLastAct = "", zTipActSince = Date.now();
  function ensureZTip() {
    if (zTipEl && zTipEl.parentNode) return;
    try {
      zTipEl = document.createElement("div");
      zTipEl.id = "dsh-ztip";
      zTipEl.style.cssText =
        "position:fixed;left:12px;bottom:76px;max-width:min(520px,80vw);" +
        "background:rgba(0,0,0,0.72);color:#fff;padding:6px 12px;border-radius:10px;" +
        "font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "z-index:2147483646;pointer-events:none;user-select:none;display:none;" +
        "border:1px solid rgba(255,255,255,0.25);box-shadow:0 1px 8px rgba(0,0,0,0.5);" +
        "text-shadow:0 1px 2px rgba(0,0,0,0.6);";
      document.documentElement.appendChild(zTipEl);
    } catch (e) {}
  }
  function renderZTip() {
    ensureZTip();
    if (!zTipEl) return;
    try {
      var running = !!zRunning || !!npHuntOn;
      if (!running) { zTipEl.style.display = "none"; return; }
      zTipEl.style.display = "block";
      var stEl = $id("dsh-status");
      var statusTxt = (stEl && stEl.textContent) || "";
      var act = zMon.action || "—";
      if (act !== zTipLastAct) { zTipLastAct = act; zTipActSince = Date.now(); }
      var idleSec = Math.max(0, Math.round((Date.now() - zTipActSince) / 1000));
      zTipEl.textContent = "动作: " + act + " | " + statusTxt + " | 停顿 " + idleSec + "s";
    } catch (e) {}
  }

  // ---------------- V1.7.7 状态名速查弹层：全屏遮罩隔离下层点击/键盘，可选中复制 ----------------
  var STATUS_QUICKREF_TXT = [
    'RO 助手 · 状态名速查表（V1.7.8）',
    '=================================',
    '',
    '使用场景：',
    '- 多辅助技能行：技能ID:等级[:状态]，如 12:5:加速（状态没了才补）',
    '  状态名前面加 ! = 状态在身才放，如 21:5:!中毒（debuff 净化/治疗用）',
    '- 技能顺序条件段：如 球5,爆气 / !中毒（逗号分隔，全部满足才放）',
    '- 面板「当前状态」里正在显示的名字 = 当前可写的名字（含剩余时间）',
    '',
    '=================================',
    '一、中文别名（可直接写中文，约 21 组）',
    '=================================',
    '中文名（可写）          对应英文SC名        常见用途',
    '加速 / 加速术           INC_AGI             AGI提升',
    '赐福 / 天赐 / 天使赐福   BLESSING            STR/INT提升',
    '霸体                    ENDURE              硬直免疫',
    '加速武器 / 速度激发      ADRENALINE          攻速提升(铁匠)',
    '武器值最大化 / 武器增加值 WEAPONPERFECT       武器效果强化',
    '凶砍                    OVERTHRUST          武器破坏',
    '神威                    GLORIA              对魔增伤',
    '牺牲祈福 / 牺牲          SUFFRAGIUM          咏唱加速',
    '撒水祈福 / 撒水          ASPERSIO            圣属性附加',
    '圣母颂歌 / 圣母          MAGNIFICAT          SP恢复',
    '霸邪之阵 / 霸邪          KYRIE               吸收伤害护盾',
    '天使之障壁 / 障壁        ANGELUS             DEF提升',
    '能量外套                ENERGYCOAT          SP抵伤',
    '灵魂                    SOULLINK            灵魂链接',
    '爆气                    EXPLOSIONSPIRITS    武术家前置',
    '钢体                    STEELBODY           DEF大幅提升',
    '集中攻击 / 集中          CONCENTRATION       命中提升(骑士:集中攻击;弓手:心神凝聚)',
    '心神凝聚 / 心神          LKCONCENTRATION     命中暴击提升',
    '双手剑加速              TWOHANDQUICKEN      双手剑攻速',
    '长矛加速                SPEARQUICKEN        长矛攻速',
    '风之步                  WINDWALK            回避提升',
    '凫魅超快感 / 追猎者疾走   CHASEWALK           移动速度增幅',
    '',
    '=================================',
    '二、英文状态名（不写 SC_ 前缀；数字 ID 也可直写，约 40 个）',
    '=================================',
    '英文SC名            中文参考          英文SC名            中文参考',
    'MAXIMIZE           武器值最大化      AUTOGUARD           自动防御',
    'REFLECTSHIELD      反射盾            AURABLADE           光环剑',
    'BERSERK            狂暴              ASSUMPTIO           圣洁祝福',
    'EDP                涂毒强化          TRUESIGHT           真视',
    'PARRYING           防御架势          CONCENTRATION       集中攻击/心神凝聚',
    'POWERUP            力量增幅          AGIUP               敏捷增幅',
    'STRUP              力量提升          RIDING              骑乘',
    'FALCON             猎鹰              GOSPEL              福音',
    'INSPIRATION        灵感              ADORAMUS            赞美',
    'RENOVATIO          再生术            ORATIO              祈愿',
    'LAUDAAGNUS         羊羔赞歌          LAUDARAMUS          礼赞之歌',
    'EPICLESIS          圣灵召唤          VENOMIMPRESS        毒印',
    'WEAPONBLOCKING     武器格挡          ROLLINGCUTTER       回旋刀刃',
    'POISONINGWEAPON    涂毒              CRESCENTELBOW       月牙刃',
    'RAISINGDRAGON      升龙              CARTBOOST           手推车加速',
    'GN_CARTBOOST       疾冲(基因)        UNLIMIT             无限',
    'FRIGG_SONG         芙丽嘉之歌        KINGS_GRACE         王者恩典',
    'MOONLIT_SERENADE   月光小夜曲        SUN_COMFORT         太阳抚慰',
    'MOON_COMFORT       月亮抚慰          STAR_COMFORT        星星抚慰',
    '',
    '=================================',
    '三、技能条件段额外可写的中文（实体字段直判）',
    '=================================',
    '球N（气弹数≥N）、爆气、狂暴、灵魂、骑乘、猎鹰、',
    '隐匿、手推车加速、钢体、涂毒、武器格挡、回旋刀刃、侦测、',
    '速射待发、金刚、涂毒强化、守卫姿态、攻击姿态、天空附魔、',
    '初信之力、二阶审判、神秘之粉，',
    '以及 hp>P / hp<P / sp>P / sp<P（百分比）和 !状态 取反。',
    '',
    '=================================',
    '四、debuff（负面状态）中文别名（状态名加 ! 前缀使用）',
    '=================================',
    '中毒、剧毒、冰冻、石化、诅咒、沉默、晕眩、眩晕、流血、出血、',
    '失明、黑暗、睡眠、恐惧、着火、点燃、混乱、发疯',
    '',
    '=================================',
    '五、规则说明',
    '=================================',
    '1. 表一/表二没列到的状态名，助手会现场查客户端 StatusConst',
    '   （自动补试 SC_ 前缀）；客户端认识就能用。',
    '2. 实在查不到的名字，日志会提示「状态名未识别」，此时直接写',
    '   数字 ID 最稳（游戏/助手状态查看器里可见对应数字）。',
    '3. 面板「当前状态」查看器：无 [debuff] 前缀 = 正面状态，直接写',
    '   名字；有 [debuff] 前缀 = 负面状态，写状态段时加 !。',
    '4. 表中中文参考翻译是常见叫法，本服可能略有出入；以游戏内实际',
    '   状态图标和助手「当前状态」显示为准。',
    '5. 面板「当前状态」查看器每行带 [ID:N]：N=该状态的服务器真实状态ID，',
    '   写不认识的英文/中文状态名时，可用这里显示的 ID 数字直写最稳。'
  ].join("\n");
  var statePopEl = null;
  function ensureStatePop() {
    try {
      if (statePopEl && statePopEl.parentNode) return;
      statePopEl = document.createElement("div");
      statePopEl.id = "dsh-statepop";
      statePopEl.style.cssText =
        "position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;" +
        "background:rgba(8,14,26,0.62);display:none;align-items:center;justify-content:center;" +
        "padding:14px;font-family:inherit;";
      var box = document.createElement("div");
      box.id = "dsh-statepopbox";
      box.style.cssText =
        "width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;" +
        "background:#fbfcfe;border:1px solid #b9c8dd;border-radius:10px;overflow:hidden;" +
        "box-shadow:0 10px 34px rgba(0,0,0,0.45);";
      var hd = document.createElement("div");
      hd.style.cssText =
        "flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;" +
        "background:#2f6fde;color:#fff;font-weight:700;font-size:13px;";
      hd.appendChild(document.createTextNode("状态名速查（可选中复制）"));
      var cp = document.createElement("button");
      cp.id = "dsh-statepopcp";
      cp.textContent = "复制全文";
      cp.style.cssText =
        "margin-left:auto;background:rgba(255,255,255,0.16);color:#fff;border:1px solid rgba(255,255,255,0.55);" +
        "border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer;font-family:inherit;";
      var x = document.createElement("button");
      x.id = "dsh-statepopx";
      x.textContent = "✕";
      x.style.cssText =
        "flex:none;background:transparent;color:#fff;border:none;cursor:pointer;font-size:15px;padding:0 2px;font-family:inherit;";
      hd.appendChild(cp);
      hd.appendChild(document.createTextNode(" "));
      hd.appendChild(x);
      var body = document.createElement("pre");
      body.id = "dsh-statepopbody";
      body.style.cssText =
        "flex:1 1 auto;overflow:auto;margin:0;padding:10px 12px;font-size:12px;line-height:1.55;" +
        "color:#1b2534;white-space:pre-wrap;word-break:break-all;user-select:text;-webkit-user-select:text;" +
        "font-family:Consolas,'Microsoft YaHei',monospace;";
      body.textContent = STATUS_QUICKREF_TXT;
      box.appendChild(hd);
      box.appendChild(body);
      statePopEl.appendChild(box);
      document.documentElement.appendChild(statePopEl);
      // 遮罩拦截：冒泡阶段截停（内部按钮/文本选择先正常处理，事件不再往外冒泡到游戏层）
      ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "contextmenu"].forEach(function (ty) {
        try { statePopEl.addEventListener(ty, function (e) { try { e.stopPropagation(); } catch (err) {} }, false); } catch (err) {}
      });
      document.addEventListener("keydown", function (e) { // 弹层打开时拦截键盘（Esc 关闭），隔离下层键鼠
        if (!statePopEl || statePopEl.style.display === "none") return;
        try {
          if (e.key === "Escape" || e.keyCode === 27) { closeStatePop(); }
          e.stopPropagation();
        } catch (err) {}
      }, true);
      cp.addEventListener("click", function (e) { try { e.stopPropagation(); } catch (err) {} copyQuickRef(); });
      x.addEventListener("click", function (e) { try { e.stopPropagation(); } catch (err) {} closeStatePop(); });
      statePopEl.addEventListener("click", function (e) { // 点遮罩空白处关闭
        try { if (e.target === statePopEl) closeStatePop(); } catch (err) {}
      });
    } catch (e) {}
  }
  function openStatePop() {
    ensureStatePop();
    if (!statePopEl) return;
    statePopEl.style.display = "flex";
  }
  function closeStatePop() {
    try { if (statePopEl) statePopEl.style.display = "none"; } catch (e) {}
  }
  function copyQuickRef() {
    try {
      var done = function () { try { setStatus("速查表已复制", "ok"); } catch (e) {} };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(STATUS_QUICKREF_TXT).then(done, function () { copyQuickRefFallback(); done(); });
      } else { copyQuickRefFallback(); done(); }
    } catch (e) {}
  }
  function copyQuickRefFallback() {
    try {
      var ta = document.createElement("textarea");
      ta.value = STATUS_QUICKREF_TXT;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    } catch (e) {}
  }
  var bookRendered = false, skillPickTicker = 0, _lastMapKey = "";
  setInterval(function () {
    try {
      if (clientReady()) {
        // 登录角色后自动读取内挂配置（一次性，延迟等内挂窗口渲染，读不到重试）
        if (!autoReadBotDone) {
          autoReadBotDone = true;
          autoReadBotTries = 0;
          setTimeout(autoReadBotOnce, 2000);
        }
        hookDisconnect();
        hookStatusIcons(); // V1.7.5 方案A：buff 状态判活 hook（登录后可重试，幂等）
        // V2.5.0：后台标签隐藏时跳过纯 UI 渲染（每秒全量重绘的 statbar/监控/状态表/提示/怪表），后台挂机只保功能逻辑，降 CPU/GC
        if (!UI_BG) {
          renderStatbar();
          renderZMonitor();
          renderStatusView(); // V1.7.6 当前状态查看器（buff/debuff 判活环 + 实体字段）
          renderZTip(); // V1.7.6 悬浮动作提示（镜像 setStatus + 动作 + 停顿秒数）
          renderMapMobs();
        }
        // nei 内挂自动战斗实时状态（面板 .openattack 勾选 = 服务器内挂实际开关）——V2.5.0 后台隐藏跳过
        if (!UI_BG) {
          try {
            var bsEl = $id("dsh-battlestate");
            if (bsEl) {
              var bsPanel = npReadPanelState();
              bsEl.textContent = "内挂状态: " + (bsPanel === null ? "未读取（打开内挂窗口）" : (bsPanel ? "已开启" : "已停止"));
            }
          } catch (e6) {}
          // 宠物状态自动刷新（客户端就绪后即读，2s 周期；含实体兜底）
          try {
            var npNow = Date.now();
            if (npNow - petLastRender > 2000) { petLastRender = npNow; renderPetInfo(); }
          } catch (e5) {}
        }
        // 地图变更检测（功能性，后台保留）：换图 → 自动刷新 拾取页当前地图 + 本图锁定目录 + 地图怪物表
        try {
          if (!CLIENT.MR) CLIENT.MR = window.require && window.require("Renderer/MapRenderer");
          var curMap = CLIENT.MR && CLIENT.MR.currentMap ? String(CLIENT.MR.currentMap).split(".")[0] : "";
          if (curMap && curMap !== _lastMapKey) {
            _lastMapKey = curMap;
            dshDiag("map-change", { map: curMap, zRunning: zRunning, npHuntOn: npHuntOn });
            tlog("map-changed " + curMap);
            // 换图自动停止战斗（用户需求）：先对齐面板实际状态再决策，绝不误翻 toggle
            try {
              npCalibrate();                     // 对齐服务器实际状态（面板=服务器）
              if (zRunning) { stopZhu(); }       // 助手运行中 → 完整停止（内含内挂关闭）
              else if (npHuntOn) { npHuntStop(); } // 纯内挂模式 → 关服务器自动战斗
              setStatus("换图：自动战斗已停止", "st");
              tlog("map-changed: battle stopped");
            } catch (e7) {}
            try { refreshPickMap(); renderMapLock(); renderMapLock($id("dsh-z-maplock")); } catch (e3) {}
          }
        } catch (e4) {}
        // 拾取页当前地图名/技能列表/锁定目录刷新 —— V2.5.0 后台隐藏跳过（纯 UI，换图事件内已补刷）
        if (!UI_BG) {
          refreshPickMap();
          if (++skillPickTicker % 3 === 0) { renderSkillPick(); renderSkillOrderList(); }
          // 助手页本图怪物锁定：details 展开时才刷新（避免频繁重建 DOM）
          try {
            var zmLock = $id("dsh-z-maplock");
            if (zmLock && zmLock.closest && zmLock.closest("details") && zmLock.closest("details").open) renderMapLock(zmLock);
          } catch (e5) {}
          // 图鉴页已移除（wiki 已覆盖），fillMapSelect 相关刷新一并删除
          if (!bookRendered) { bookRendered = true; try { renderBook(); } catch (e) {} }
          var ent = CLIENT.SS.Entity;
          var el = $id("dsh-chr");
          if (el) {
            if (ent && ent.life) {
              var lf = ent.life;
              var pos = ent.position || {};
              el.textContent = "Lv" + (ent.clevel || "?") + " HP " + (lf.hp != null ? lf.hp : "?") + "/" + (lf.hp_max != null ? lf.hp_max : "?") +
                " SP " + (lf.sp != null ? lf.sp : "?") + "/" + (lf.sp_max != null ? lf.sp_max : "?") + " (" + (pos.x != null ? pos.x + "," + pos.y : "?") + ")";
            } else { el.textContent = "未登录"; }
          }
        }
      }
      var det = document.querySelector("#dsh-recon");
      if (det && det.closest("details") && det.closest("details").open) renderRecon();
    } catch (e) {}
  }, 1000);
  setInterval(function () {
    try { renderRecon(); } catch (e) {}
  }, 5000);

  // V2.4.9 开机诊断：状态栏显示面板与内容区实际尺寸 3 秒（排查"没有滚动条"用：内容区 scroll>client 才出滚动条）
  setTimeout(function () {
    try {
      var pg = panel.querySelector(".pages");
      if (!pg) return;
      var st = panel.querySelector("#dsh-status2");
      var info = "面板" + panel.offsetWidth + "x" + panel.offsetHeight +
        " · 内容区 " + pg.clientHeight + "/" + pg.scrollHeight +
        (pg.scrollHeight > pg.clientHeight ? " 可滚" : " 无滚动");
      if (st) {
        st.textContent = info;
        setTimeout(function () { try { st.textContent = "就绪"; } catch (e) {} }, 3000);
      }
    } catch (e) {}
  }, 1500);

  // 自愈：面板出屏幕回正（V1.7.5 守卫：收起状态/用户拖过位置 → 尊重摆放，绝不弹回）
  setInterval(function () {
    try {
      // 收起成球：有悬浮球可找回，无需回正
      if (panel.style.display === "none") return;
      // 用户拖过面板 = 有意摆放（存了 dsh_panel_pos）→ 尊重当前位置，不再强制弹回屏幕中央
      var dragged = false;
      try { dragged = !!localStorage.getItem("dsh_panel_pos"); } catch (e) {}
      if (dragged) return;
      var r = panel.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      if (r.right < 40 || r.left > vw - 40 || r.bottom < 40 || r.top > vh - 40) {
        panel.style.cssText = PANEL_LAYOUT;
        if (saved.collapsed) { panel.style.display = "none"; ball.style.display = "flex"; }
        console.log("[RO助手] 面板已自动回正（未拖动时才回正）");
      }
    } catch (e) {}
  }, 8000);
  setInterval(function () {
    try { if (!panel.parentNode) document.documentElement.appendChild(panel); } catch (e) {}
  }, 5000);

  // 加载提示
  try { console.log("[RO助手] v" + VER + " 已加载（开始停止按钮顶部常驻 + 状态联想 Buff/Debuff 中文模糊 + 地图联想滚动 + 掉buff及时补 + debuff判定 + 状态查看含ID + 拾取页物品搜索 + 后台降帧 + 后台保活 + 侧边抽屉 + 角色档案 + 瞬移术优先 + 技能次数上限 + 锁定清空 + 诊断环 + 状态判活补buff）"); } catch (e) {}
  var toast = $("div", "", '仙境传说 V' + VER + ' · 助手已加载<span style="opacity:.65">（点击关闭）</span>');
  toast.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#0f2a1a;border:1px solid #2e8b57;border-radius:10px;padding:10px 20px;color:#7ef0a8;" +
    "font:13px/1.5 'Microsoft YaHei',system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.55);text-align:center;cursor:pointer";
  toast.addEventListener("click", function () { try { toast.parentNode.removeChild(toast); } catch (e) {} });
  document.documentElement.appendChild(toast);
  setTimeout(function () { try { toast.parentNode.removeChild(toast); } catch (e) {} }, 7000);

  // ---------------- 启动逻辑 ----------------
  function detectWrapperBoot() {
    try {
      if (window.ROConfig && window.ROConfig.application) return true;
    } catch (e) {}
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      if (/Online(_mn)?\.js/.test(scripts[i].src)) return true;
    }
    return false;
  }
  function waitForReady() {
    window.addEventListener("message", function (ev) {
      if (ev.data === "ready") {
        state.ready = true;
        setStatus("客户端已就绪", "ok");
        tlog("client-ready");
      }
    });
    setInterval(function () {
      try {
        if (window.account && window.account !== state.account) {
          state.account = window.account;
          setStatus("已登录：" + window.account, "ok");
          tlog("logged-in=" + window.account);
          // 单账号：刷新本窗口账号信息
          try { renderWinInfo(); } catch (e2) {}
        }
      } catch (e) {}
    }, 2000);
  }

  // ---------------- V2.6.9 选服前白屏自愈（仅 IS_MN；PC 不干预） ----------------
  // 根因1:页面 SW cache-first 且无网络校验,坏缓存被永久喂给客户端;
  // 根因2:Online_mn.js 内置 requirejs waitSeconds=7,弱网下引擎模块 7s 加载不完即超时,客户端永不启动。
  function bootHealSetup() {
    if (!IS_MN) return;
    var HEAL_KEY = 'lro_heal_v269';
    var alive = true;
    function log(m) { try { console.log('[RO助手]自愈 ' + m); } catch (e) {} }
    function show(msg, sticky) {
      try {
        var old = document.getElementById('ro-heal-toast');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var d = document.createElement('div');
        d.id = 'ro-heal-toast';
        d.style.cssText = 'position:fixed;right:10px;bottom:14px;z-index:2147483646;max-width:84vw;' +
          'background:#1e1f26;border:1px solid #e08a2a;border-radius:10px;padding:10px 12px;' +
          'color:#ffd9a0;font:12px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5)';
        var b = document.createElement('div');
        b.textContent = msg;
        d.appendChild(b);
        var retry = document.createElement('div');
        retry.style.cssText = 'margin-top:6px;color:#6cb7ff;text-decoration:underline;cursor:pointer';
        retry.textContent = '点击重试(清缓存刷新)';
        retry.onclick = function () { try { sessionStorage.removeItem(HEAL_KEY); } catch (e) {} runHeal(); };
        d.appendChild(retry);
        document.documentElement.appendChild(d);
        if (!sticky) setTimeout(function () { try { d.parentNode.removeChild(d); } catch (e) {} }, 12000);
      } catch (e) {}
    }
    function groupsExist() {
      try { var l = document.querySelector('#ServerBox .list'); return !!(l && l.children && l.children.length > 0); } catch (e) { return false; }
    }
    function clearSWCache() {
      var p = [];
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          p.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
            rs.forEach(function (r) { try { r.unregister().then(function () { log('SW 已注销'); }); } catch (e) {} });
          }));
        }
      } catch (e) {}
      try {
        if (window.caches && caches.keys) {
          p.push(caches.keys().then(function (ks) {
            ks.forEach(function (k) {
              try { if (/lro|lastro|post\.lastro/i.test(k)) caches.delete(k).then(function () { log('缓存已删 ' + k); }); } catch (e) {}
            });
          }));
        }
      } catch (e) {}
      return Promise.all(p);
    }
    function runHeal() {
      var done = false;
      try { done = sessionStorage.getItem(HEAL_KEY) === '1'; } catch (e) {}
      if (!done) show('检测到加载卡住:正在清除旧缓存并刷新,请稍候(需重新下载约3MB客户端)', true);
      clearSWCache().then(function () {
        setTimeout(function () {
          try { if (!done) sessionStorage.setItem(HEAL_KEY, '1'); } catch (e) {}
          log('reload');
          try { location.reload(); } catch (e) {}
        }, 2500);
      });
    }
    // 1) 提高 requirejs 模块加载超时:弱网 7s 太短,改为 120s(轮询到 window.require 出现即配置,竞态在超时判定前生效)
    var cfgDone = false;
    var cfgTimer = setInterval(function () {
      try {
        if (window.require && window.require.config && !cfgDone) {
          cfgDone = true;
          window.require.config({ waitSeconds: 120 });
          log('waitSeconds→120');
          clearInterval(cfgTimer);
        }
      } catch (e) {}
    }, 150);
    setTimeout(function () { clearInterval(cfgTimer); }, 15000);
    // 2) 捕获 require 超时/脚本错误 = 确定性启动失败,直接清缓存自愈
    window.addEventListener('error', function (ev) {
      try {
        var s = String((ev && ev.message) || ev.error || '').toLowerCase();
        if (/(load timeout|script error|scripterror|timeout for modules)/.test(s)) {
          log('捕获启动错误: ' + String((ev && ev.message) || ev.error).slice(0, 140));
          runHeal();
        }
      } catch (e) {}
    }, true);
    // 3) 兜底:2.5 分钟仍无服务器组 → 提示(不自动刷新,避免打断弱网下的正常慢加载)
    var t0 = Date.now();
    setInterval(function () {
      try {
        if (!alive) return;
        if (groupsExist()) { alive = false; return; }
        if (Date.now() - t0 > 150000) {
          alive = false;
          var done = false;
          try { done = sessionStorage.getItem(HEAL_KEY) === '1'; } catch (e) {}
          log('boot-stuck 150s');
          show(done ? '已清理缓存仍卡在加载面:可能网络过慢(需下载约3MB客户端)或客户端异常。点击重试;仍失败请把浏览器控制台 [RO助手] 日志发来。'
                    : '加载异常:客户端 2.5 分钟未出现服务器列表。点击重试(清缓存刷新)。', true);
        }
      } catch (e) {}
    }, 5000);
  }

  function init() {
    bootHealSetup();
    document.head.appendChild(style);
    tlog("script-loaded url=" + location.href.slice(0, 60));
    waitForReady();
    // 默认页签为战斗（登录页已移除；statbar 默认显示）
    switchPage(tabDefs[0][0]);
    renderWinInfo();
    renderWl();
    renderLockList();
    renderDropTree();
    renderSkillPick();
    renderSkillOrderList();
    // 图鉴页已移除，无 fillMapSelect
    // 侦查扫描：勾选即启动（等客户端就绪后自动开始）
    try {
      if ($id("dsh-scanen") && $id("dsh-scanen").checked) {
        var scanWait = setInterval(function () {
          if (clientReady()) { clearInterval(scanWait); startScan(); }
        }, 2000);
        setTimeout(function () { clearInterval(scanWait); }, 120000); // 2分钟兜底
      }
    } catch (e) {}
    // 面板内嵌样式被客户端清除时重挂（5s 检查）
    setInterval(function () {
      try {
        if (panel && !panel.querySelector("style")) {
          var is2 = $("style");
          is2.textContent = PANEL_CSS;
          panel.insertBefore(is2, panel.firstChild);
        }
      } catch (e) {}
    }, 5000);
    if (detectWrapperBoot()) {
      state.bootedByWrapper = true;
      setStatus("原站模式运行中", "ok");
      tlog("wrapper-boot-detected");
      return;
    }
    detectDataServer(function () {
      setStatus("正在启动客户端…", "warn");
      setTimeout(boot, 300);
      setTimeout(function () {
        if (!state.ready && !state.bootedByPlugin) {
          setStatus("未检测到客户端，尝试启动…", "warn");
          tlog("retry-boot");
          boot();
        }
      }, 3500);
    });
  }

  // ---------------- V2.7.0 脚本执行器（导入 JSON 模板 · 白名单 8 类动作） ----------------
  var SCRIPTS_KEY = "dsh_scripts";
  var SCR_ACTIONS = ["teleport", "walk", "battleOn", "battleOff", "useItem", "stopMove", "check", "talk"];
  function scrLoad() { try { var a = JSON.parse(localStorage.getItem(SCRIPTS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function scrSave(a) { try { localStorage.setItem(SCRIPTS_KEY, JSON.stringify(a)); } catch (e) {} }
  function scrValidate(obj) {
    if (!obj || typeof obj !== "object") return { ok: false, err: "顶层须为对象 {templateId, version, steps[]}" };
    if (typeof obj.templateId !== "string" || !obj.templateId.trim()) return { ok: false, err: "缺少 templateId（脚本名）" };
    if (!Array.isArray(obj.steps) || !obj.steps.length) return { ok: false, err: "steps 须为非空数组" };
    for (var i = 0; i < obj.steps.length; i++) {
      var s = obj.steps[i];
      if (!s || typeof s !== "object") return { ok: false, err: "steps[" + i + "] 须为对象" };
      if (SCR_ACTIONS.indexOf(s.action) < 0) return { ok: false, err: "steps[" + i + "].action 非法: " + s.action + "（白名单: " + SCR_ACTIONS.join("/") + "）" };
      if (s.onFail && ["skip", "alert", "stop"].indexOf(s.onFail) < 0) return { ok: false, err: "steps[" + i + "].onFail 非法" };
    }
    return { ok: true, script: obj };
  }
  var scrRun = { running: false, script: null, stepIndex: 0, timer: null, stop: false };
  function scrLogLine(t) {
    try {
      var el = $id("dsh-scr-log");
      if (!el) return;
      var pre = el.textContent || "";
      el.textContent = (pre ? pre + "\n" : "") + t;
      el.scrollTop = el.scrollHeight;
      if (el.textContent.length > 3000) el.textContent = el.textContent.slice(-3000);
    } catch (e) {}
  }
  function scrSetState(t, cls) {
    try { var el = $id("dsh-scr-state"); if (el) { el.textContent = t; if (cls) el.className = "st " + cls; } } catch (e) {}
  }
  function scrRenderList() {
    try {
      var list = scrLoad(), box = $id("dsh-scr-list"), cnt = $id("dsh-scr-count");
      if (cnt) cnt.textContent = String(list.length);
      if (!box) return;
      box.innerHTML = "";
      if (!list.length) { box.innerHTML = '<span class="st">空（粘贴 JSON 后点「导入校验」）</span>'; return; }
      list.forEach(function (it, i) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 4px;border-bottom:1px solid #eef2f6";
        var nm = document.createElement("span");
        nm.textContent = (i + 1) + ". " + (it.name || it.templateId || "未命名") + " (v" + (it.version || 1) + ") · " + (it.steps ? it.steps.length : 0) + "步";
        nm.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        row.appendChild(nm);
        var runB = document.createElement("button");
        runB.textContent = "执行";
        runB.style.cssText = "flex:0 0 auto;padding:1px 8px;font-size:11px";
        runB.addEventListener("click", function () { scrRunScript(i); });
        row.appendChild(runB);
        var delB = document.createElement("button");
        delB.textContent = "删除";
        delB.style.cssText = "flex:0 0 auto;padding:1px 8px;font-size:11px;background:#fff;color:#b91c1c;border:1px solid #e5b3b3";
        delB.addEventListener("click", function () { var a = scrLoad(); a.splice(i, 1); scrSave(a); scrRenderList(); });
        row.appendChild(delB);
        box.appendChild(row);
      });
    } catch (e) {}
  }
  function scrGetPos() { try { var ent = CLIENT.SS && CLIENT.SS.Entity; return ent && ent.position; } catch (e) { return null; } }
  function scrCheckArrive(step) {
    var a = step.arrive || {};
    if (a.map) {
      var cur = getMapName();
      if (!cur || String(cur).toLowerCase() !== String(a.map).toLowerCase()) return false;
    }
    if (a.x != null && a.y != null) {
      var p = scrGetPos();
      if (!p) return false;
      var d = Math.abs(p[0] - a.x) + Math.abs(p[1] - a.y);
      if (d > (a.dist || 0)) return false;
    }
    return true;
  }
  function scrCheckWait(step) {
    var w = step.waitFor;
    if (!w) return true;
    try {
      var body = document.body ? document.body.innerText : "";
      if (w.text) return body.indexOf(w.text) >= 0;
      var arr = w.options || w.option;
      if (Array.isArray(arr)) { for (var i = 0; i < arr.length; i++) if (body.indexOf(arr[i]) >= 0) return true; return false; }
    } catch (e) {}
    return true;
  }
  function scrCheckUntil(step) {
    var u = step.until;
    if (!u) return true;
    try {
      var inv = findInventory();
      if (!inv) return false;
      var qty = 0;
      for (var i = 0; i < inv.length; i++) {
        var it = inv[i] || {};
        if (it.ITID === u.item || it.itemid === u.item) qty += (it.amount || it.count || 1);
      }
      return qty >= (u.amount || 1);
    } catch (e) { return false; }
  }
  function scrDoAction(step) {
    var p = step.params || {};
    try {
      switch (step.action) {
        case "teleport": teleportToMap(p.map); break;
        case "walk": walkToXY(p.x, p.y, null, "dsh-scr-log"); break;
        case "battleOn": setBattle(true); break;
        case "battleOff": setBattle(false); break;
        case "useItem": useItemById(p.item != null ? p.item : p.id); break;
        case "stopMove": stopWalkXY(); break;
        case "check": scrLogLine("check: map=" + getMapName() + " pos=" + (scrGetPos() ? Math.floor(scrGetPos()[0]) + "," + Math.floor(scrGetPos()[1]) : "?")); break;
        case "talk": scrTalkNpc(p.npc); break;
      }
    } catch (e) { scrLogLine("动作异常: " + e.message); }
  }
  function scrTalkNpc(name) {
    try {
      if (!clientReady()) { scrLogLine("talk: 客户端未就绪"); return; }
      var EM = window.require("Renderer/EntityManager");
      var ent = CLIENT.SS.Entity, target = null, best = 1e9;
      EM.forEach(function (e) {
        try {
          if ((e.objecttype === 6 || e.objecttype === 12) && ent && e.position) {
            if (name && String(e.name || e.displayName || "") !== String(name)) return;
            var d = Math.abs(e.position[0] - ent.position[0]) + Math.abs(e.position[1] - ent.position[1]);
            if (d < best) { best = d; target = e; }
          }
        } catch (e2) {}
      });
      if (!target) { scrLogLine("talk: 附近无目标NPC" + (name ? "（" + name + "）" : "")); return; }
      var pkt = new CLIENT.PS.CZ.CONTACTNPC();
      pkt.NAID = target.GID; pkt.type = 1;
      CLIENT.NM.sendPacket(pkt);
      scrLogLine("talk: 已对话 " + (target.name || target.displayName || target.GID));
    } catch (e) { scrLogLine("talk异常: " + e.message); }
  }
  function scrTick() {
    if (!scrRun.running || scrRun.stop) return;
    var script = scrRun.script, i = scrRun.stepIndex;
    if (!script || i >= script.steps.length) { scrFinish(true); return; }
    var step = script.steps[i];
    try {
      var entG = CLIENT.SS && CLIENT.SS.Entity;
      if (entG && entG.life && entG.life.hp_max > 0 && entG.life.hp / entG.life.hp_max < 0.25) {
        scrLogLine("HP<25% 自动停手");
        stopWalkXY(); try { setBattle(false); } catch (e) {}
        scrFinish(false, "HP<25% 自动停手");
        return;
      }
    } catch (e) {}
    if (!step._started) {
      step._started = Date.now();
      step._tries = 0;
      scrLogLine("[" + (i + 1) + "/" + script.steps.length + "] " + step.action + (step.params && step.params.map ? " " + step.params.map : "") + (step.params && step.params.x != null ? " (" + step.params.x + "," + step.params.y + ")" : ""));
      scrDoAction(step);
      if (step.action === "stopMove" || step.action === "check") {
        if (scrCheckUntil(step)) scrNextStep();
        return;
      }
    }
    if (scrCheckArrive(step) && scrCheckWait(step) && scrCheckUntil(step)) { scrNextStep(); return; }
    var maxT = step.timeoutMs || 20000;
    if (Date.now() - step._started > maxT) {
      step._tries = (step._tries || 0) + 1;
      var retry = step.retry != null ? step.retry : 0;
      if (step._tries <= retry) {
        scrLogLine("步 " + (i + 1) + " 超时,重试 " + step._tries + "/" + retry);
        step._started = Date.now();
        scrDoAction(step);
      } else {
        scrLogLine("步 " + (i + 1) + " 超时(" + maxT + "ms),onFail=" + (step.onFail || "skip"));
        if (step.onFail === "stop") scrFinish(false, "步骤超时停止");
        else if (step.onFail === "alert") { scrSetState("步骤超时", "warn"); scrNextStep(); }
        else scrNextStep();
      }
    }
  }
  function scrNextStep() {
    scrRun.stepIndex++;
    scrSetState("运行中… " + scrRun.stepIndex + "/" + scrRun.script.steps.length, "ok");
  }
  function scrFinish(ok, msg) {
    scrRun.running = false;
    if (scrRun.timer) { clearInterval(scrRun.timer); scrRun.timer = null; }
    scrSetState(ok ? "完成" : (msg || "已停止"), ok ? "ok" : "warn");
    scrLogLine(ok ? "脚本执行完成" : (msg || "已停止"));
  }
  function scrRunScript(idx) {
    if (scrRun.running) { scrRun.stop = true; if (scrRun.timer) { clearInterval(scrRun.timer); scrRun.timer = null; } scrRun.running = false; }
    var list = scrLoad();
    if (idx < 0 || idx >= list.length) return;
    var v = scrValidate(list[idx]);
    if (!v.ok) { scrSetState("脚本无效: " + v.err, "err"); return; }
    scrRun.script = JSON.parse(JSON.stringify(v.script));
    scrRun.script.steps.forEach(function (st) { try { delete st._started; } catch (e) {} });
    scrRun.stepIndex = 0; scrRun.stop = false;
    scrSetState("运行中… 0/" + scrRun.script.steps.length, "ok");
    scrLogLine("执行 " + scrRun.script.templateId + " (v" + (scrRun.script.version || 1) + ")");
    scrRun.running = true;
    scrRun.timer = setInterval(scrTick, 800);
  }
  try {
    var impB = $id("dsh-scr-imp");
    if (impB) impB.addEventListener("click", function () {
      var msg = $id("dsh-scr-msg");
      var name = ($id("dsh-scr-name").value || "").trim();
      var raw = ($id("dsh-scr-json").value || "").trim();
      if (!raw) { msg.textContent = "请粘贴 JSON 模板"; return; }
      var obj = null;
      try { obj = JSON.parse(raw); } catch (e) { msg.textContent = "JSON 解析失败: " + e.message; return; }
      var v = scrValidate(obj);
      if (!v.ok) { msg.textContent = v.err; return; }
      var list = scrLoad();
      v.script.name = name || v.script.templateId || ("脚本" + (list.length + 1));
      list.push(v.script);
      scrSave(list);
      scrRenderList();
      msg.textContent = "已导入 " + list.length + " 个";
      $id("dsh-scr-json").value = "";
    });
    var clrB = $id("dsh-scr-clear");
    if (clrB) clrB.addEventListener("click", function () { $id("dsh-scr-json").value = ""; $id("dsh-scr-name").value = ""; });
    var stopB = $id("dsh-scr-stop");
    if (stopB) stopB.addEventListener("click", function () {
      scrRun.stop = true; scrRun.running = false;
      if (scrRun.timer) { clearInterval(scrRun.timer); scrRun.timer = null; }
      try { stopWalkXY(); } catch (e) {}
      scrSetState("已停止", "warn");
      scrLogLine("手动停止");
    });
    scrRenderList();
  } catch (e) {}
  // ---------------- 自动化 API ----------------

  window.__ROPlugin = {
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    getConfig: buildConfig,
    setAutoLogin: function (acc, pwd) { saved.account = acc; saved.password = pwd; saveSaved(saved); },
    reboot: function () { location.reload(); },
    version: version,
    lockMob: addLock,
    unlockMob: removeLock,
    addPickup: addWl,
    removePickup: removeWl
  };

  init();
})();