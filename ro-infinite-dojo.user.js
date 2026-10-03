// ==UserScript==
// @name         仙境传说 · 无限道场（独立版）
// @namespace    dsh.ro-plugin
// @version      1.0.3
// @updateURL    https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-infinite-dojo.user.js
// @downloadURL  https://raw.githubusercontent.com/Keeee1th/Lro-user-scripts/main/ro-infinite-dojo.user.js
// @description  在 post.lastro.cn / game.lastro.cn 的页面上自动完成无限道场：到报名点、按对话流程报名、进道场战斗、按轮次领奖、结束后自动再来一轮；需要先启用 RO 助手。
// @author       DSH
// @match        http://post.lastro.cn/*
// @match        https://post.lastro.cn/*
// @match        http://post.lastro.cn/ro/api.html*
// @match        https://post.lastro.cn/ro/api.html*
// @match        http://post.lastro.cn/ro/api-old.html*
// @match        https://post.lastro.cn/ro/api-old.html*
// @match        http://game.lastro.cn/*
// @match        https://game.lastro.cn/*
// @match        http://game.lastro.cn/ro/api.html*
// @match        https://game.lastro.cn/ro/api.html*
// @match        http://game.lastro.cn/ro/api-old.html*
// @match        https://game.lastro.cn/ro/api-old.html*
// @match        http://127.0.0.1:8971/client/api.html*
// @match        http://localhost:8971/client/api.html*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// ==/UserScript==
//
// ---------------- V1.0.0（独立版本线首版） ----------------
// 1. 道场从 RO 助手里搬出来独立发布：运行时只经助手的对外通道调用走路 / 对话 / 换箭 / 开战 / 飞行 / 传送，
//    本脚本自己不做任何一步动作，也不碰任何底层协议。
// 2. 新增全自动报名：传送到 普隆德拉 148,147 → 走 NPC 相邻格（绝不站 NPC 自己那格）→ 对话链
//    （下一步 → 无限挑战 → 我要报名 → 下一步）→ 进入道场转入战斗循环。
// 3. 修搬运时发现的问题：
//    a 相邻格走路 + 到达校验 + 每 2 秒重试 + 状态行写实际距离；
//    b 接触 / 对话失败必须给出原因（npc-not-found / contact-failed / invalid-menu …），连续失败有明确提示；
//    c 所有停止原因同时进状态行与日志（不再只进一边）；
//    d 开不起来（没进游戏 / 控制权被占 / 助手挂机在跑）写明原因，不静默结束；
//    e 副本内 NPC 别名可配置，找不到时把本图识别到的 NPC 名字与数量打进日志；
//    f 副本内无怪满 20 秒给出明确提示。
// 4. 全自动循环：打 → 每 N 轮结算或到顶结算 → 回报名点再开一轮；随时可停。
// 5. 界面优先复用助手浮窗；不可用时退回自建 RO 皮肤面板（不用旧蓝渐变）。
// 6. 已知契约缺口：助手暂无传送方法，本脚本按约定调用 teleport(owner,{map,x,y})（走 fly 权限）；
//    取不到时若已在报名地图则改用走近兜底，否则明确报「待助手侧实现」，不空转。
// 7. 可选本地配置：在扩展里为本脚本开启「允许访问文件网址」后，可读 file:///dsh-ro-infinite-dojo.config.json
//    覆盖坐标 / NPC 名 / 选项等；读不到一律用内置默认，绝不因此失败。
// ---------------- V1.0.1 ----------------
// 1. 入口阶段：进入报名阶段先无条件传送到报名点（不再看当前地图与坐标）；8 秒内没到位补发一次，
//    两次仍不到位就停手，并把助手返回的原因原文写进状态行与日志。
// 2. 战斗改由助手精灵代打（门面 assistCombat(owner,on)）：有活怪一律指定目标开战；初级难度不再等换箭；助手拒绝开战时立刻停手并写明原因。
// 3. 面板「用法/限制」同步：写明战斗由助手精灵代打、到报名点会消耗 1 个传送卷轴。
// ---------------- V1.0.2 ----------------
// 1. 取消换箭：本脚本不再申请换箭权限，也不再等换箭就绪，有活怪即开战，战斗全部交给助手精灵。
// 2. 拿到控制权后先做一次战斗准备：清空当前角色的锁定名单并改为攻击全部怪；释放控制权时还原「打全部怪」的原值。
// 3. 战斗中自动拾取地面上的卡片与装备；结算与停止时自动收起。
// 4. 面板「用法/限制」同步：写明代打、传送卷轴消耗与自动拾取范围。
// 5. 匹配放宽到 post / game 整站（各 2 条域名通配 + 原有具体 api 页），并在脚本最前面加页面闸门：
//    只有本机 8971、站内网址含 /ro/api 的页面、以及手机版入口（网址含 r=mn）才启动；
//    站点首页、登录页、公告页等一律不启动（不建面板、不挂定时器、不碰页面）。
// ---------------- V1.0.3 ----------------
// 打开游戏不再自动弹出面板，改为点「无限道场」按钮手动打开。

(function () {
  'use strict';

  /* ==================== 页面闸门（必须最先执行） ====================
   * 与 RO 助手同语义，只有三类页面放行：
   *   ① 本机 127.0.0.1 / localhost 的 8971 端口（本机调试入口）；
   *   ② lastro.cn 站内网址含 /ro/api 的页面；
   *   ③ 手机版入口（网址含 r=mn）。
   * 站点首页、登录页、公告页等一律不启动：到这里直接 return，
   * 不建面板、不注入样式、不挂定时器与事件监听、不读配置。
   * 整体 try/catch，任何异常一律按「不放行」处理。 */
  function pageGateTarget() {
    var loc = null;
    try { loc = window.location; } catch (e) { loc = null; }
    var href = "";
    try { href = String((loc && loc.href) || ""); } catch (e) { href = ""; }
    var host = "", port = "";
    // 没有 hostname 的环境（测试夹具等）就从 href 里取；有 hostname / port 的以宿主给的为准
    var um = /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/([^\/?#]*)/.exec(href);
    if (um) {
      var auth = String(um[1]).replace(/^[^@]*@/, "");
      var pm = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(auth);
      host = String(pm ? pm[1] : auth).toLowerCase();
      port = pm && pm[2] ? String(pm[2]) : "";
    }
    try {
      if (loc && loc.hostname) host = String(loc.hostname).toLowerCase();
      if (loc && loc.port) port = String(loc.port);
    } catch (e) {}
    return { href: href, host: host, port: port };
  }
  function pageAllowed() {
    var u = pageGateTarget();
    if ((u.host === "127.0.0.1" || u.host === "localhost") && u.port === "8971") return true;
    if (/(^|\.)lastro\.cn$/.test(u.host) && u.href.indexOf("/ro/api") >= 0) return true;
    if (u.href.indexOf("r=mn") >= 0) return true;
    return false;
  }
  var PAGE_OK = false;
  try { PAGE_OK = pageAllowed() === true; } catch (e) { PAGE_OK = false; }
  if (!PAGE_OK) return;

  /* ==================== 常量 ==================== */

  var VERSION        = "1.0.3";
  var API_PROTOCOL   = 1;
  var OWNER          = "ro-infinite-dojo";      // 控制权属主，全程一致
  var SCOPES         = ["dojo", "battle", "movement", "dialog", "fly"];
  var CLIENT_TAG     = "ro-infinite-dojo";
  var CFG_KEY        = "dsh-ro-dojo-standalone-v1";
  var UI_KEY         = "dsh-ro-dojo-ui-v1";          // 启动按钮位置（与面板配置分开，互不影响）
  var WIN_ID         = "ro-infinite-dojo";
  var REPO_URL       = "https://github.com/Keeee1th/Lro-user-scripts";
  var CONFIG_URL     = "file:///dsh-ro-infinite-dojo.config.json";
  var FILE_HINT      = "如需读取本机文件，请在浏览器扩展详情里为本脚本开启「允许访问文件网址」";
  var NO_MOB_HINT    = "可能需要在副本内对话，请把该 NPC 名字发我";
  var LOG_MAX        = 200;
  var TICK_MS        = 250;
  var ADJ            = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  var LEVEL_WORDS    = { basic: ["初级"], middle: ["中级"], advanced: ["高级"] };
  var REQUIRED_METHODS = [
    "snapshot", "acquire", "release", "contactNpc", "walkTo", "chooseMenu", "assistCombat",
    "setBattleTarget", "clearBattleTarget", "requestFly", "prepareCombat", "requestPickup", "teleport"
  ];

  /* ==================== 配置 ==================== */

  var DEFAULTS = {
    difficulty: "basic",                               // 初级 / 中级 / 高级
    stop100: true,                                     // 到顶结算后重开下一轮
    maxRound: 100,                                     // 到顶轮次
    fly: false,                                        // 无怪时飞行
    emergency: false,                                  // 危险时飞行（中高级）
    autoSignup: true,                                  // 自动报名循环
    settleEvery: 5,                                    // 每 N 轮结算一次（0 = 不按轮次结算）
    entryMap: "prontera",
    entryX: 148,
    entryY: 147,
    npcName: "荣誉管理员",
    dojoNpcAliases: ["喵达人", "猫达人", "白猫", "白猫达人"],
    challengeKeywords: ["无限挑战"],
    challengeIndex: 2,
    signupKeywords: ["我要报名"],
    signupIndex: 1,
    settleKeywords: ["领取奖励", "领奖", "领取"],
    continueKeywords: ["继续挑战", "继续", "下一轮"],
    findNpcTimeoutMs: 30000,
    contactTimeoutMs: 30000,
    dialogStuckMs: 20000,
    noMobWarnMs: 20000,
    walkRetryMs: 2000,
    settleWaitMs: 60000,
    configUrl: CONFIG_URL
  };
  var CFG_KEYS = [
    "difficulty", "stop100", "maxRound", "fly", "emergency", "autoSignup", "settleEvery",
    "entryMap", "entryX", "entryY", "npcName", "dojoNpcAliases",
    "challengeKeywords", "challengeIndex", "signupKeywords", "signupIndex",
    "settleKeywords", "continueKeywords", "configUrl"
  ];

  var cfg = loadCfg();

  function loadCfg() {
    var c = copy(DEFAULTS);
    try {
      var raw = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (raw && typeof raw === "object") applyCfg(c, raw);
    } catch (e) {}
    return c;
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  // 只接受白名单键 + 类型校验：面板与本地配置文件共用同一条入口
  function applyCfg(c, src) {
    if (!c || !src || typeof src !== "object") return c;
    for (var i = 0; i < CFG_KEYS.length; i++) {
      var k = CFG_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k], d = DEFAULTS[k], n = 0;
      if (Array.isArray(d)) {
        if (Array.isArray(v)) c[k] = v.map(function (x) { return String(x); }).filter(function (x) { return x !== ""; });
      } else if (typeof d === "number") {
        n = Number(v);
        if (isFinite(n)) c[k] = n;
      } else if (typeof d === "boolean") {
        if (typeof v === "boolean") c[k] = v;
      } else if (typeof d === "string") {
        if (typeof v === "string" && v) c[k] = v;
      }
    }
    if (!/^(basic|middle|advanced)$/.test(String(c.difficulty))) c.difficulty = DEFAULTS.difficulty;
    return c;
  }

  /* ==================== 运行状态 ==================== */

  var run = {
    on: false, generation: 0, timer: null,
    stage: "idle",                       // idle / entry / battle / settle / stopped
    phase: "未开始", step: "",
    statusLine: "",
    cycle: 0, round: 0, remaining: null, dist: null,
    entry: null, npc: null, dojoNpc: null,
    lastMenuFp: "", lastNextFp: "",
    lastNotice: "", lastNoticeAt: 0,
    lastFly: 0,
    noMobSince: 0, noMobWarned: false,
    settleUntil: 0, settleSeen: false, cycleEnd: false,
    startedAt: 0, log: []
  };
  var mode = "none";                     // none / window / standalone
  var root = null, holder = null, wrap = null;
  var launcherBox = null, launcherBtn = null;    // 常驻启动按钮（两种显示方式下都在）
  var panelOpen = false;                         // 面板是否已由用户打开（拿不到助手浮窗节点时用它跟随）
  var statusEl = null, logEl = null, startBtn = null, stopBtn = null;
  var ctrls = {};

  /* ==================== 小工具 ==================== */

  function isFn(x) { return typeof x === "function"; }
  function msgOf(e) { return e && e.message ? e.message : String(e == null ? "" : e); }
  function copy(o) { var r = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function nowMs() { return Date.now(); }
  function sec(n) { return (Math.round(Number(n) || 0)) + " 秒"; }

  function pageWindow() {
    try { if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow; } catch (e) {}
    return window;
  }
  // 去掉颜色码 / 标签 / 全角数字，繁体「達/貓」归一
  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/\^[0-9a-f]{6}/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
      .replace(/達/g, "达").replace(/貓/g, "猫")
      .replace(/\s+/g, " ").trim();
  }
  // 切比雪夫距离（RO 的格子距离）
  function cheb(a, b) {
    try {
      if (!a || !b) return Infinity;
      return Math.max(Math.abs(Number(a[0]) - Number(b[0])), Math.abs(Number(a[1]) - Number(b[1])));
    } catch (e) { return Infinity; }
  }
  function mapKey(m) {
    return String(m == null ? "" : m).toLowerCase()
      .replace(/\.(gat|rsw)$/, "").replace(/\\/g, "/").replace(/^.*\//, "").trim();
  }
  function sameMap(a, b) {
    var x = mapKey(a), y = mapKey(b);
    return !!x && !!y && x === y;
  }
  function posText(p) { return (p && isFinite(Number(p[0])) && isFinite(Number(p[1]))) ? (Number(p[0]) + "," + Number(p[1])) : "?"; }
  // 走到 NPC 的相邻格：取「离玩家最近的那一格」，绝不会返回 NPC 自己那格
  function adjacentCell(pos, from) {
    if (!pos) return null;
    var cx = Math.round(Number(pos[0])), cy = Math.round(Number(pos[1]));
    if (!isFinite(cx) || !isFinite(cy)) return null;
    var best = null, bd = Infinity, i = 0;
    for (i = 0; i < ADJ.length; i++) {
      var nx = cx + ADJ[i][0], ny = cy + ADJ[i][1];
      var d = from ? cheb(from, [nx, ny]) : i;
      if (d < bd) { bd = d; best = [nx, ny]; }
    }
    return best;
  }
  // 关键词命中（子串匹配，返回命中下标数组）
  function pickIndex(items, keywords) {
    var hits = [], i = 0, k = 0, s = "";
    if (!Array.isArray(items) || !Array.isArray(keywords)) return hits;
    for (i = 0; i < items.length; i++) {
      s = norm(items[i]);
      for (k = 0; k < keywords.length; k++) {
        if (keywords[k] && s.indexOf(String(keywords[k])) >= 0) { hits.push(i); break; }
      }
    }
    return hits;
  }
  function hasWord(items, keywords) { return pickIndex(items, keywords).length > 0; }
  function levelWords(diff) { return LEVEL_WORDS[diff] || LEVEL_WORDS.basic; }

  function classifyMenu(items) {
    if (hasWord(items, cfg.challengeKeywords)) return "challenge";
    if (hasWord(items, cfg.signupKeywords)) return "signup";
    if (hasWord(items, cfg.settleKeywords)) return "settle";
    if (hasWord(items, cfg.continueKeywords)) return "continue";
    if (hasWord(items, levelWords(cfg.difficulty))) return "level";
    return "unknown";
  }
  // 本图 NPC 名单（找不到目标时打进日志，便于用户回报）
  function npcDigest(npcs) {
    var rows = (npcs || []).filter(function (n) { return n && norm(n.name); });
    if (!rows.length) return "（本图没有识别到任何 NPC）";
    var seen = {}, out = [];
    rows.forEach(function (n) {
      var k = norm(n.name);
      seen[k] = (seen[k] || 0) + 1;
    });
    for (var k2 in seen) if (Object.prototype.hasOwnProperty.call(seen, k2)) out.push(k2 + " x" + seen[k2]);
    return out.join("、") + "（共 " + rows.length + " 个）";
  }
  function findNpc(s, name) {
    var want = norm(name).replace(/\s/g, "");
    if (!want) return null;
    var list = (s && s.npcs) || [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n) continue;
      var nm = norm(n.name).replace(/\s/g, "");
      if (nm && (nm === want || nm.indexOf(want) >= 0)) return n;
    }
    return null;
  }
  function dojoNpcList(s) {
    var al = cfg.dojoNpcAliases || [];
    return ((s && s.npcs) || []).filter(function (n) {
      var nm = norm(n.name).replace(/\s/g, "");
      for (var i = 0; i < al.length; i++) if (al[i] && nm.indexOf(String(al[i])) >= 0) return true;
      return false;
    });
  }

  /* ==================== 日志 / 状态 / 推送 ==================== */

  function logLine(text, kind) {
    var t = "[" + (run.startedAt ? ((nowMs() - run.startedAt) / 1000).toFixed(1) + "s" : "0.0s") + "] " + String(text == null ? "" : text);
    run.log.push({ text: t, kind: kind || "" });
    if (run.log.length > LOG_MAX) run.log.splice(0, run.log.length - LOG_MAX);
    paintLog();
  }
  function setPhase(phase, step) {
    run.phase = String(phase == null ? "" : phase);
    run.step = String(step == null ? "" : step);
    paintStatus();
  }
  function statusText() {
    var s = "阶段：" + (run.phase || "未开始") +
      " · 轮次：" + (run.round || 0) + (run.remaining == null ? "" : " / 剩余 " + run.remaining) +
      " · 距离：" + (run.dist == null ? "—" : run.dist) +
      (run.step ? " · " + run.step : "");
    run.statusLine = s;
    return s;
  }
  function paintStatus() {
    var s = statusText();
    try { if (statusEl) statusEl.textContent = s; } catch (e) {}
  }
  function paintLog() {
    try {
      if (!logEl) return;
      var rows = run.log.slice(-40).map(function (r) { return r.text; });
      logEl.textContent = rows.join("\n");
      if (logEl.scrollHeight) logEl.scrollTop = logEl.scrollHeight;
    } catch (e) {}
  }
  function pushNotice(text) {
    try {
      var a = api();
      if (a && a.notify && isFn(a.notify.push)) a.notify.push(String(text == null ? "" : text));
    } catch (e) {}
  }
  function render() {
    paintStatus();
    try {
      if (startBtn) startBtn.disabled = !!run.on;
      if (stopBtn) stopBtn.disabled = !run.on;
    } catch (e) {}
  }

  /* ==================== 助手通道（门禁照抄现实现判据） ==================== */

  function apiReport() {
    var w = pageWindow(), a = null;
    try { a = w.__DSH_RO_ASSIST_API__; } catch (e) { a = null; }
    if (!a) return { ok: false, api: null, reason: "没有找到 RO 助手（请先安装并启用助手，再进入游戏）" };
    var c = null;
    try { c = isFn(a.capabilities) ? a.capabilities() : null; } catch (e2) { return { ok: false, api: null, reason: "助手没有响应（能力自检报错）" }; }
    if (a.protocol !== API_PROTOCOL || !c || c.protocol !== API_PROTOCOL) return { ok: false, api: null, reason: "助手版本不匹配（需要协议 " + API_PROTOCOL + "）" };
    if (c.arrowRules !== true || c.battleTarget !== true) return { ok: false, api: null, reason: "助手缺少换箭或指定目标能力，请更新助手" };
    if (c.assistCombat !== true) return { ok: false, api: null, reason: "助手不支持助手代打战斗（请更新助手）" };
    if (!Array.isArray(c.modules) || c.modules.indexOf("dojo") < 0) return { ok: false, api: null, reason: "助手没有开放道场能力" };
    if (!Array.isArray(c.scopes)) return { ok: false, api: null, reason: "助手没有回报可用权限" };
    var missing = [];
    for (var i = 0; i < SCOPES.length; i++) if (c.scopes.indexOf(SCOPES[i]) < 0) missing.push(SCOPES[i]);
    if (missing.length) return { ok: false, api: null, reason: "助手缺少必需权限：" + missing.join("、") };
    var noMethod = [];
    for (var j = 0; j < REQUIRED_METHODS.length; j++) if (!isFn(a[REQUIRED_METHODS[j]])) noMethod.push(REQUIRED_METHODS[j]);
    if (noMethod.length) return { ok: false, api: null, reason: "助手缺少必需能力：" + noMethod.join("、") };
    return { ok: true, api: a, reason: "" };
  }
  function api() { return apiReport().api; }

  function call(a, name, args) {
    try { return a && isFn(a[name]) ? a[name].apply(a, args || []) : { ok: false, error: "method-missing:" + name }; }
    catch (e) { return { ok: false, error: msgOf(e) }; }
  }
  // 传送：按约定的新方法调用；助手侧还没实现时明确上报，不空转
  function doTeleport(a, map, x, y) {
    if (!isFn(a.teleport)) return { ok: false, error: "teleport-missing" };
    var r = call(a, "teleport", [OWNER, { map: map, x: x, y: y }]);
    if (!r || r.ok !== true) return { ok: false, error: (r && r.error) || "teleport-failed" };
    return { ok: true };
  }

  /* ==================== 对话窗口（下一步） ==================== */

  function requireClient(name) {
    try {
      var req = pageWindow().require;
      if (!isFn(req)) return null;
      if (isFn(req.defined) && !req.defined(name)) return null;
      if (isFn(req.specified) && !req.specified(name)) return null;
      return req(name);
    } catch (e) { return null; }
  }
  function clientUIManager() {
    var names = ["UI/Components/StatusIcons/StatusIcons", "UI/Components/SkillList/SkillList"];
    for (var i = 0; i < names.length; i++) {
      var m = requireClient(names[i]);
      if (m && m.manager) return m.manager;
    }
    return null;
  }
  // 组件可达性：优先直接取模块，拿不到再经管理器取回（线上该模块可能在白名单外）
  function npcBox() {
    var b = requireClient("UI/Components/NpcBox/NpcBox");
    if (b && isFn(b.next)) return b;
    var UM = clientUIManager();
    if (UM && isFn(UM.getComponent)) {
      try {
        var c = UM.getComponent("NpcBox");
        if (c && isFn(c.next)) return c;
      } catch (e) {}
    }
    return null;
  }
  function jqText(j) {
    try { if (j && isFn(j.text)) return String(j.text() == null ? "" : j.text()); } catch (e) {}
    try { if (j && j[0]) return String(j[0].textContent == null ? "" : j[0].textContent); } catch (e2) {}
    return "";
  }
  function jqVisible(j) {
    if (!j) return false;
    try { if (isFn(j.is)) return !!j.is(":visible"); } catch (e) {}
    try {
      if (isFn(j.css)) {
        var d = j.css("display");
        if (d !== undefined && d !== null && d !== "") return String(d) !== "none";
      }
    } catch (e2) {}
    try { if (j[0] && j[0].style && j[0].style.display === "none") return false; return !!(j[0]); } catch (e3) {}
    return false;
  }
  // 返回 {box, visible, text, ownerID}；组件不可达时返回 null（调用方必须明确报错，不许空转）
  function npcBoxButton() {
    var box = npcBox();
    if (!box) return null;
    var el = null;
    try { if (box.ui && isFn(box.ui.find)) el = box.ui.find(".next"); } catch (e) { el = null; }
    if (!el && isFn(box.getRoot)) {
      try {
        var rt = box.getRoot();
        var n = rt && isFn(rt.querySelector) ? rt.querySelector(".next") : null;
        if (n) el = { 0: n, length: 1 };
      } catch (e2) {}
    }
    if (!el) return null;
    var vis = jqVisible(el);
    var text = "";
    try { if (box.ui && isFn(box.ui.find)) text = jqText(box.ui.find(".content")); } catch (e3) {}
    if (!text && isFn(box.getRoot)) {
      try {
        var rt2 = box.getRoot();
        var c = rt2 && isFn(rt2.querySelector) ? rt2.querySelector(".content") : null;
        if (c) text = String(c.textContent == null ? "" : c.textContent);
      } catch (e4) {}
    }
    var owner = null;
    try { if (box.ownerID != null) owner = Number(box.ownerID) || 0; } catch (e5) {}
    return { box: box, visible: vis, text: norm(text), ownerID: owner };
  }
  // 只点一次同一句话；组件不可达时明确报错
  function pressNext(a, s, now, tag) {
    var e = run.entry;
    var inEntry = run.stage === "entry";
    var stage = inEntry ? ("entry:" + (e ? e.expect : "")) : ("stage:" + run.stage);
    var nb = npcBoxButton();
    if (!nb) {
      if (e) {
        if (!e.boxMissAt) e.boxMissAt = now;
        if (now - e.boxMissAt >= 5000) return doStop("取不到对话窗口的「下一步」按钮（npc-box-unreachable），请更新助手或手动点一下", "npc-box-unreachable");
      }
      setPhase("等待对话窗口（" + (tag || "对话") + "）", "");
      return null;
    }
    e && (e.boxMissAt = 0);
    if (!nb.visible) {
      if (!run.noNextSince) run.noNextSince = now;
      else if (now - run.noNextSince >= cfg.dialogStuckMs) {
        return doStop("对话停在没有「下一步」的一层（dialog-stuck），请手动点一下", "dialog-stuck");
      }
      setPhase(nb.text && /报名成功|报名完成/.test(nb.text) ? "已报名，等待传送" : "对话文字层已结束", "");
      return null;
    }
    run.noNextSince = 0;
    if (!nb.box) return null;
    // NAID 校验（只对报名阶段）：对话属于别的 NPC 时一律不碰
    if (inEntry && nb.ownerID && e && e.gid && nb.ownerID !== e.gid) {
      return doStop("对话来自其他 NPC（NAID " + nb.ownerID + "），已停手", "foreign-npc");
    }
    var fp = stage + "|" + (nb.ownerID || 0) + "|" + nb.text;
    if (fp === run.lastNextFp) {
      if (e) {
        if (!e.stuckSince) e.stuckSince = now;
        else if (now - e.stuckSince >= cfg.dialogStuckMs) return doStop("同一句对话停住不动了（dialog-stuck），请手动点一下", "dialog-stuck");
      }
      setPhase("「下一步」已点过，等对话推进", "");
      return null;
    }
    if (e) e.stuckSince = 0;
    try { nb.box.next(); }
    catch (err) { logLine("点「下一步」失败：" + msgOf(err), "warn"); return null; }
    run.lastNextFp = fp;
    logLine("点「下一步」" + (nb.text ? "（" + nb.text.slice(0, 28) + "）" : ""));
    if (inEntry && e && /报名成功|报名完成/.test(nb.text)) {
      e.signedUp = true; e.expect = "goto"; e.gotoAt = now;
      logLine("报名成功，等待传送到道场");
    }
    return null;
  }

  /* ==================== 启动 / 停止 ==================== */

  function acquireReason(r) {
    var e = r && r.error;
    if (e === "owned") return "助手正被其他流程占用（控制权被占），请先停掉那个流程";
    if (e === "assistant-busy") return "助手挂机正在运行，请先停止助手挂机再点开始";
    if (e === "client-not-ready") return "还没进游戏（请先登录角色并站到地面）";
    if (e === "invalid-owner-or-scopes") return "申请参数不被助手接受（请更新本脚本或助手）";
    return "助手拒绝交出控制权（" + (e || "未知原因") + "）";
  }
  // V1.0.2：助手换箭自查（只读：只读一次状态快照，不发任何指令），供用户确认助手自己能不能换箭
  function arrowPreflight(s) {
    var ar = (s && s.arrow) || null;
    var out = { ok: !!ar, enabled: false, defaultArrow: null, currentArrow: null, ready: false, blocked: false, text: "" };
    if (ar) {
      out.enabled = ar.enabled === true;
      out.defaultArrow = (ar.defaultItid == null ? null : Number(ar.defaultItid));
      out.currentArrow = (ar.currentItid == null ? null : Number(ar.currentItid));
      out.ready = ar.ready === true;
      out.blocked = ar.blocked === true;
    }
    out.text = "助手换箭预检：enabled=" + (out.enabled ? "true" : "false") +
      " 默认箭=" + (out.defaultArrow == null ? "未设" : out.defaultArrow) +
      " 当前箭=" + (out.currentArrow == null ? "未装备" : out.currentArrow) +
      " ready=" + (out.ready ? "true" : "false") +
      " blocked=" + (out.blocked ? "true" : "false");
    return out;
  }
  function doStart() {
    if (run.on) return;
    var rep = apiReport();
    if (!rep.ok) return doStop(rep.reason, "api-missing");
    var a = rep.api;
    var r = call(a, "acquire", [OWNER, SCOPES.slice()]);
    if (!r || r.ok !== true) return doStop(acquireReason(r), "acquire-refused");
    var s = null;
    try { s = a.snapshot(OWNER); } catch (e) { s = null; }
    if (!s) return doStop("拿到控制权却读不到游戏状态（snapshot-missing），请重开页面再试", "snapshot-missing");
    if (!s.ready) return doStop("游戏未就绪（可能还在登录或已掉线），请进游戏后再点开始", "client-not-ready");
    run.on = true;
    run.generation++;
    run.startedAt = nowMs();
    run.log = [];
    logLine("已拿到控制权，开始运行（" + VERSION + "）");
    var pf = arrowPreflight(s);
    run.preflight = pf;
    logLine(pf.text);
    // V1.0.2：拿到控制权后只做一次战斗准备（幂等；每轮 entry 不再重复调用）
    var prep = call(a, "prepareCombat", [OWNER, { clearLocks: true, allMobs: true }]);
    if (!prep || prep.ok !== true) {
      logLine("战斗准备未完成（" + ((prep && prep.error) || "unknown") + "），仍继续运行", "warn");
    } else {
      logLine("战斗准备完成：清空锁定名单 " + prep.cleared + " 条，改为攻击全部怪（原值 " + (prep.allMobsRestore ? "开" : "关") + "）");
    }
    beginEntry(1);
    run.timer = setInterval(function () { tick(run.generation); }, TICK_MS);
    render();
    tick(run.generation);
  }
  // 所有停止原因必须同时出现在状态行与日志
  function doStop(reason, code) {
    reason = String(reason == null || reason === "" ? "已停止" : reason);
    var wasOn = run.on;
    run.on = false;
    run.generation++;
    if (run.timer) { try { clearInterval(run.timer); } catch (e) {} run.timer = null; }
    var a = api();
    if (a) {
      call(a, "requestPickup", [OWNER, { on: false }]);
      call(a, "clearBattleTarget", [OWNER]);
      call(a, "release", [OWNER]);
    }
    run.stage = "stopped";
    run.npc = null;
    run.dojoNpc = null;
    run.settleUntil = 0;
    setPhase("已停止：" + reason + (code ? "（" + code + "）" : ""), run.cycle ? "第 " + run.cycle + " 轮循环" : "");
    logLine("停止：" + reason + (code ? "（" + code + "）" : ""), "err");
    if (wasOn) pushNotice("无限道场已停止：" + reason);
    render();
    return reason;
  }

  /* ==================== 主循环 ==================== */

  function tick(gen) {
    if (!run.on || gen !== run.generation) return;
    try { tickBody(); }
    catch (e) { doStop("运行出错：" + msgOf(e), "runtime-error"); }
  }
  function tickBody() {
    var a = api();
    if (!a) return doStop("助手通道没了（可能被停用或页面刷新），请重新点开始", "api-lost");
    var s = null;
    try { s = a.snapshot(OWNER); } catch (e) { s = null; }
    if (!s) return doStop("控制权已不在本脚本手里（lease-lost），请重新点开始", "lease-lost");
    if (!s.ready) return doStop("游戏未就绪（可能掉线或还在登录）", "client-not-ready");
    var now = nowMs();
    if (run.stage === "battle") return battleTick(a, s, now);
    if (run.stage === "settle") return settleTick(a, s, now);
    return entryTick(a, s, now);
  }

  function beginEntry(cycle) {
    run.cycle = cycle;
    run.stage = "entry";
    run.round = 0;
    run.remaining = null;
    run.dist = null;
    run.lastMenuFp = "";
    run.lastNextFp = "";
    run.lastNotice = "";
    run.lastNoticeAt = 0;
    run.lastFly = 0;
    run.noMobSince = 0;
    run.noMobWarned = false;
    run.settleUntil = 0;
    run.settleSeen = false;
    run.cycleEnd = false;
    run.noNextSince = 0;
    run.npc = null;
    run.dojoNpc = null;
    run.entry = {
      startedAt: nowMs(), expect: "next-intro", picks: 0, signedUp: false, gotoAt: 0, gotoRetries: 0, tpAt: 0, tpCount: 0, tpErr: "",
      gid: 0, walkAt: 0, walkTries: 0, walkTarget: null, walkIssuedAt: 0, walkWarned: false,
      arrivedLogged: false, contactAt: 0, firstContactAt: 0, contactErr: "", failStreak: 0,
      dialogSeenAt: 0, stuckSince: 0, boxMissAt: 0, menuWaitAt: 0
    };
    setPhase("准备报名（第 " + cycle + " 轮循环）", "走向报名点");
    logLine("===== 第 " + cycle + " 轮循环：开始自动报名 =====");
  }

  /* ==================== 入口（全自动报名） ==================== */

  function entryTick(a, s, now) {
    var e = run.entry;
    if (!e) { beginEntry(run.cycle + 1); e = run.entry; }

    // 已报名 → 等地图变化进道场
    if (e.signedUp) {
      if (!sameMap(s.map, cfg.entryMap)) return beginBattle(s, now);
      if (now - (e.gotoAt || now) > 15000) {
        e.gotoRetries++;
        if (e.gotoRetries > 3) return doStop("报名后一直没有进入道场（goto-timeout），请手动进一次道场", "goto-timeout");
        run.lastNextFp = "";
        e.gotoAt = now;
        logLine("报名后还没进道场，重新点一次「下一步」（第 " + e.gotoRetries + " 次）", "warn");
      }
      setPhase("报名成功，等待传送到道场", "第 " + e.gotoRetries + " 次等待");
      return;
    }

    // B2：进入报名阶段先无条件传送到报名点（不看当前地图与坐标）
    var atEntry = sameMap(s.map, cfg.entryMap) && cheb(s.player && s.player.position, [cfg.entryX, cfg.entryY]) <= 2;
    if (!e.tpAt) {
      var t0 = doTeleport(a, cfg.entryMap, cfg.entryX, cfg.entryY);
      if (!t0.ok) e.tpErr = t0.error;
      if (!t0.ok && t0.error === "teleport-missing") {
        return doStop("助手暂未提供传送能力（请更新助手）", "teleport-unsupported");
      }
      if (!t0.ok) return doStop("传送到报名点失败（" + t0.error + "）", "teleport-failed");
      e.tpAt = now; e.tpCount = 1;
      setPhase("传送到报名点", cfg.entryMap + " " + cfg.entryX + "," + cfg.entryY);
      return;
    }
    if (!atEntry) {
      if (now - e.tpAt < 8000) {
        setPhase("传送到报名点", "等待落地 " + sec((now - e.tpAt) / 1000));
        return;
      }
      if (e.tpCount >= 2) {
        return doStop("传送到报名点后 8 秒内仍未到位，当前在 " + (s.map || "?") + " " + posText(s.player && s.player.position) + (e.tpErr ? "（助手返回：" + e.tpErr + "）" : ""), "teleport-timeout");
      }
      var t1 = doTeleport(a, cfg.entryMap, cfg.entryX, cfg.entryY);
      if (!t1.ok) e.tpErr = t1.error;
      if (!t1.ok && t1.error === "teleport-missing") {
        return doStop("助手暂未提供传送能力（请更新助手）", "teleport-unsupported");
      }
      if (!t1.ok) return doStop("传送到报名点失败（" + t1.error + "）", "teleport-failed");
      e.tpAt = now; e.tpCount++;
      logLine("8 秒还没到报名点，补发一次传送（第 " + e.tpCount + " 次）", "warn");
      setPhase("传送到报名点", cfg.entryMap + " " + cfg.entryX + "," + cfg.entryY);
      return;
    }

    var p = s.player && s.player.position;

    // 找入口 NPC
    var npc = findNpc(s, cfg.npcName);
    if (!npc) {
      if (now - e.startedAt >= cfg.findNpcTimeoutMs) {
        logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
        return doStop("在 " + cfg.entryMap + " " + cfg.entryX + "," + cfg.entryY + " 附近找不到「" + cfg.npcName + "」（npc-not-found）", "npc-not-found");
      }
      run.dist = null;
      setPhase("寻找「" + cfg.npcName + "」", "已等 " + sec((now - e.startedAt) / 1000));
      return;
    }
    if (e.gid !== npc.gid) {
      e.gid = npc.gid; e.walkAt = 0; e.walkTries = 0; e.walkTarget = null;
      e.contactAt = 0; e.firstContactAt = 0; e.arrivedLogged = false; e.walkWarned = false;
    }
    var d = cheb(p, npc.position);
    run.dist = isFinite(d) ? d : null;

    // 走到相邻格（绝不站 NPC 自己那格），每 2 秒重试
    if (!isFinite(d) || d > 1 || d === 0) {
      var adj = adjacentCell(npc.position, p);
      if (!adj) {
        setPhase("读不到「" + cfg.npcName + "」的坐标", "");
        return;
      }
      if (e.walkTarget && (e.walkTarget[0] !== adj[0] || e.walkTarget[1] !== adj[1])) e.walkAt = 0;
      if (now - e.walkAt >= cfg.walkRetryMs) {
        e.walkAt = now; e.walkTries++; e.walkTarget = adj; e.walkIssuedAt = now; e.walkWarned = false;
        var wr = call(a, "walkTo", [OWNER, { x: adj[0], y: adj[1] }]);
        logLine("走向「" + cfg.npcName + "」相邻格 (" + adj[0] + "," + adj[1] + ")，当前距离 " + (isFinite(d) ? d : "未知") +
          "（第 " + e.walkTries + " 次）" + (wr && wr.ok === false ? "｜助手返回 " + wr.error : ""), e.walkTries > 1 ? "warn" : "");
      }
      if (e.walkIssuedAt && now - e.walkIssuedAt > 3000 && !e.walkWarned) {
        e.walkWarned = true;
        logLine("走路没有靠近（距离 " + (isFinite(d) ? d : "未知") + "），继续重试", "warn");
      }
      setPhase("走向「" + cfg.npcName + "」相邻格", "距离 " + (isFinite(d) ? d : "未知"));
      if (now - e.startedAt >= cfg.findNpcTimeoutMs * 2) {
        return doStop("走不到「" + cfg.npcName + "」的相邻格（walk-failed，距离 " + (isFinite(d) ? d : "未知") + "）", "walk-failed");
      }
      return;
    }
    if (!e.arrivedLogged) {
      e.arrivedLogged = true;
      logLine("已到达「" + cfg.npcName + "」相邻格（距离 " + d + "），准备对话");
    }

    // 接触
    setPhase("接触「" + cfg.npcName + "」", "距离 " + d);
    if (!e.firstContactAt) e.firstContactAt = now;
    if (now - e.contactAt >= 1000) {
      e.contactAt = now;
      var cr = call(a, "contactNpc", [OWNER, npc.gid]);
      if (!cr || cr.ok !== true) {
        e.contactErr = (cr && cr.error) || "unknown";
        e.failStreak++;
        logLine("接触「" + cfg.npcName + "」失败：" + e.contactErr + "（连续 " + e.failStreak + " 次）", "warn");
        if (e.failStreak === 3) logLine("连续 3 次点不开对话，先核对坐标与 NPC 名字；本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
      } else {
        if (e.failStreak) logLine("接触已恢复");
        e.contactErr = "";
        e.failStreak = 0;
      }
    }
    if (s.dialogOpen) {
      e.contactErr = "";
      e.failStreak = 0;
      return dialogTick(a, s, now);
    }
    if (now - e.firstContactAt >= cfg.contactTimeoutMs) {
      logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
      return doStop("点不开「" + cfg.npcName + "」的对话（contact-failed" + (e.contactErr ? "：" + e.contactErr : "") + "）", "contact-failed");
    }
  }

  function dialogTick(a, s, now) {
    var e = run.entry;
    if (!e.dialogSeenAt) { e.dialogSeenAt = now; logLine("对话已打开，开始按流程选择"); }
    var m = (s.menu && Array.isArray(s.menu.items) && s.menu.items.length) ? s.menu : null;

    if (m) {
      if (m.naid && e.gid && m.naid !== e.gid) return doStop("对话来自其他 NPC（NAID " + m.naid + "），已停手", "foreign-npc");
      if (m.fingerprint && m.fingerprint === run.lastMenuFp) {
        setPhase("菜单已选过，等服务器回应", "");
        return;
      }
      return chooseEntryMenu(a, m, now);
    }
    if (!m && !npcBox()) {
      // 没有菜单又取不到对话窗口：只在超时后明确报错
      if (!e.menuWaitAt) e.menuWaitAt = now;
      if (now - e.menuWaitAt > cfg.dialogStuckMs) {
        return doStop("对话里既没有选项也取不到「下一步」按钮（npc-box-unreachable）", "npc-box-unreachable");
      }
      setPhase("等待对话内容", "");
      return;
    }
    e.menuWaitAt = 0;
    pressNext(a, s, now, "报名");
  }

  function chooseEntryMenu(a, m, now) {
    var e = run.entry;
    var items = m.items.slice();
    var kind = classifyMenu(items);
    var CH = { key: cfg.challengeKeywords, index: cfg.challengeIndex, label: "无限挑战", role: "challenge" };
    var SG = { key: cfg.signupKeywords, index: cfg.signupIndex, label: "我要报名", role: "signup" };
    var plan = null;
    if (kind === "challenge") plan = CH;
    else if (kind === "signup") plan = SG;
    else if (kind === "level") plan = { key: levelWords(cfg.difficulty), index: 0, label: "难度", role: "level" };
    else if (kind === "settle") plan = { key: cfg.settleKeywords, index: 0, label: "领奖", role: "settle" };
    else if (e.expect === "menu-challenge") plan = CH;      // 第一个菜单：按无限挑战的规则
    else if (e.expect === "menu-signup") plan = SG;         // 第二个菜单：按我要报名的规则
    else if (e.picks === 0) plan = CH;                      // 兜底：链上第一个菜单
    else if (e.picks === 1) plan = SG;                      // 兜底：链上第二个菜单
    if (!plan) {
      logLine("不认识的菜单：" + items.join(" / "), "warn");
      return doStop("菜单不认识，请把这条对话发我（invalid-menu）：" + items.join(" / "), "invalid-menu");
    }
    if (!m.naid) {
      if (!e.menuWaitAt) e.menuWaitAt = now;
      if (now - e.menuWaitAt > 3000) return doStop("菜单缺少必要的对话标识（invalid-menu）：" + items.join(" / "), "invalid-menu");
      setPhase("菜单缺少对话标识，等一帧", "");
      return;
    }
    e.menuWaitAt = 0;
    var hits = pickIndex(items, plan.key);
    var idx = -1, via = "";
    if (hits.length === 1) { idx = hits[0]; via = "关键词"; }
    else if (hits.length > 1) {
      return doStop("「" + plan.label + "」命中多项，已停手，请手动选择（invalid-menu）：" + hits.map(function (i) { return items[i]; }).join(" / "), "invalid-menu");
    } else if (plan.index >= 1 && plan.index <= items.length) {
      idx = plan.index - 1;
      via = "序号 " + plan.index;
      logLine("没匹配到关键词，按序号兜底选第 " + plan.index + " 项：" + items[idx], "warn");
    } else {
      return doStop("菜单里没有「" + plan.label + "」可用项（invalid-menu）：" + items.join(" / "), "invalid-menu");
    }
    var r = call(a, "chooseMenu", [OWNER, { naid: m.naid, index: idx, fingerprint: m.fingerprint }]);
    if (!r || r.ok !== true) {
      if (r && r.error === "menu-already-used") { run.lastMenuFp = m.fingerprint; return; }
      logLine("选择被拒绝：" + ((r && r.error) || "unknown"), "warn");
      return doStop("菜单提交失败（" + ((r && r.error) || "unknown") + "）", "choose-failed");
    }
    run.lastMenuFp = m.fingerprint;
    run.lastNextFp = "";
    run.noNextSince = 0;
    e.stuckSince = 0;
    logLine("已选" + via + "：" + items[idx] + "（NAID " + m.naid + "）");
    e.picks++;
    if (plan.role === "challenge") {
      e.expect = "menu-signup";
    } else if (plan.role === "signup") {
      e.signedUp = true; e.expect = "goto"; e.gotoAt = now;
      logLine("已报名，等待传送到道场");
    }
  }

  // V2.38.13 FIX-5：进入/回到战斗阶段统一在这里重新打开自动拾取（结算与结算超时兜底都收起过，只开卡片6/装备4/防具5）
  function enterBattleStage() {
    run.stage = "battle";
    run.noMobSince = 0;
    call(api(), "requestPickup", [OWNER, { on: true, types: [4, 5, 6] }]);
  }
  function beginBattle(s, now) {
    enterBattleStage();
    run.noMobWarned = false;
    run.lastMenuFp = "";
    run.lastNextFp = "";
    run.dojoNpc = null;
    run.npc = null;
    run.noNextSince = 0;
    run.entry && (run.entry.boxMissAt = 0);
    setPhase("道场内战斗", "地图 " + (s && s.map ? s.map : "?"));
    logLine("已进入道场（地图 " + ((s && s.map) || "?") + "），开始战斗");
  }

  /* ==================== 战斗循环 ==================== */

  function battleTick(a, s, now) {
    var m = (s.dialogOpen && s.menu && Array.isArray(s.menu.items) && s.menu.items.length) ? s.menu : null;
    if (m) return dojoMenuTick(a, s, m, now);
    if (s.dialogOpen) return pressNext(a, s, now, "副本内对话");

    var live = (s.mobs || []).filter(function (x) { return x && !x.dead && x.mid && x.gid; });
    var t = live.filter(function (x) { return x.isBoss; })[0] || live[0];
    if (t) {
      run.dist = t.position ? (isFinite(cheb(s.player && s.player.position, t.position)) ? cheb(s.player && s.player.position, t.position) : null) : null;
      run.dojoNpc = null;
      run.noMobSince = 0;
      run.noMobWarned = false;
      // V1.0.2：有活怪一律指定目标开战（不再按 BOSS/普通分流，也不再等换箭）；换箭由助手精灵自己接管，代打一律 true
      call(a, "setBattleTarget", [OWNER, { mid: t.mid, gid: t.gid }]);
      var rb = call(a, "assistCombat", [OWNER, true]);
      if (!rb || rb.ok !== true) {
        var rwhy = (rb && (rb.error || rb.result)) || "unknown";
        setPhase("开战失败：" + rwhy, "目标 #" + t.mid);
        logLine("请求开战失败（battle-request-failed）：" + rwhy, "warn");
        return doStop("请求开战失败（battle-request-failed：" + rwhy + "）", "battle-request-failed");
      }
      setPhase("战斗中", "目标 " + (t.isBoss ? "首领" : "普通") + " #" + t.mid);
      if (cfg.emergency && cfg.difficulty !== "basic" && s.player && s.player.maxHp > 0 && s.player.hp / s.player.maxHp < 0.7 && now - run.lastFly > 3000) {
        run.lastFly = now;
        call(a, "requestFly", [OWNER, { reason: "道场低血量" }]);
        logLine("血量偏低，已请求飞行");
      }
      return;
    }

    // 无怪
    call(a, "clearBattleTarget", [OWNER]);
    if (!run.noMobSince) {
      run.noMobSince = now;
      logLine("本图暂时没有怪");
    }
    if (cfg.fly && s.inDojoMap && run.remaining > 0 && now - run.lastFly > 3000) {
      run.lastFly = now;
      call(a, "requestFly", [OWNER, { reason: "道场无怪且仍有剩余" }]);
      logLine("无怪且仍有剩余，已请求飞行");
    }
    dojoNpcTick(a, s, now);
  }

  function dojoNpcTick(a, s, now) {
    var list = dojoNpcList(s);
    var waited = run.noMobSince ? (now - run.noMobSince) / 1000 : 0;
    if (!list.length) {
      if (now - run.noMobSince >= cfg.noMobWarnMs && !run.noMobWarned) {
        run.noMobWarned = true;
        logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
        logLine(NO_MOB_HINT, "warn");
        pushNotice("无限道场：" + NO_MOB_HINT);
      }
      setPhase("道场内没有目标", "无怪 " + sec(waited));
      return;
    }
    var n = run.dojoNpc;
    if (!n || !list.some(function (x) { return x.gid === n.gid; })) {
      run.dojoNpc = { gid: list.length === 1 ? list[0].gid : 0, first: now, walkAt: 0, tries: 0, contactAt: 0, failStreak: 0 };
      n = run.dojoNpc;
    }
    if (list.length > 1) {
      setPhase("副本内 NPC 不唯一，请手动靠近", "");
      if (now - n.first >= cfg.findNpcTimeoutMs) {
        logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
        return doStop("副本内识别到多个候选 NPC，无法确定该找哪一个（npc-ambiguous）", "npc-ambiguous");
      }
      return;
    }
    var npc = list[0];
    var nm = norm(npc.name) || "?";
    if (!npc.position) {
      setPhase("接触副本内 NPC「" + nm + "」", "读不到坐标");
      if (now - n.contactAt >= 1000) {
        n.contactAt = now;
        var cr0 = call(a, "contactNpc", [OWNER, npc.gid]);
        if (!cr0 || cr0.ok !== true) logLine("接触副本内 NPC 失败：" + ((cr0 && cr0.error) || "unknown"), "warn");
      }
      if (!s.dialogOpen && now - n.first >= cfg.contactTimeoutMs) {
        logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
        return doStop("读不到副本内 NPC「" + nm + "」的坐标，也点不开对话（contact-failed）", "contact-failed");
      }
      return;
    }
    var d = cheb(s.player && s.player.position, npc.position);
    run.dist = isFinite(d) ? d : null;
    if (!isFinite(d) || d > 1 || d === 0) {
      var adj = adjacentCell(npc.position, s.player && s.player.position);
      if (!adj) {
        setPhase("读不到副本内 NPC 坐标", "");
        return;
      }
      if (now - n.walkAt >= cfg.walkRetryMs) {
        n.walkAt = now; n.tries++;
        call(a, "walkTo", [OWNER, { x: adj[0], y: adj[1] }]);
        logLine("走向副本内 NPC「" + nm + "」相邻格 (" + adj[0] + "," + adj[1] + ")，距离 " + (isFinite(d) ? d : "未知") + "（第 " + n.tries + " 次）", n.tries > 1 ? "warn" : "");
      }
      setPhase("走向副本内 NPC「" + nm + "」相邻格", "距离 " + (isFinite(d) ? d : "未知"));
      if (now - n.first >= cfg.findNpcTimeoutMs * 2) {
        logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
        return doStop("走不到副本内 NPC「" + nm + "」的相邻格（walk-failed，距离 " + (isFinite(d) ? d : "未知") + "）", "walk-failed");
      }
      return;
    }
    setPhase("接触副本内 NPC「" + nm + "」", "距离 " + d);
    if (now - n.contactAt >= 1000) {
      n.contactAt = now;
      var cr = call(a, "contactNpc", [OWNER, npc.gid]);
      if (!cr || cr.ok !== true) {
        n.failStreak++;
        logLine("接触副本内 NPC「" + nm + "」失败：" + ((cr && cr.error) || "unknown") + "（连续 " + n.failStreak + " 次）", "warn");
      } else n.failStreak = 0;
    }
    if (!s.dialogOpen && now - n.first >= cfg.contactTimeoutMs) {
      logLine("本图识别到的 NPC：" + npcDigest(s.npcs), "warn");
      return doStop("点不开副本内 NPC「" + nm + "」的对话（contact-failed）", "contact-failed");
    }
  }

  function dojoMenuTick(a, s, m, now) {
    if (m.fingerprint && m.fingerprint === run.lastMenuFp) {
      setPhase("菜单已选过，等服务器回应", "");
      return;
    }
    var items = m.items.slice();
    var kind = classifyMenu(items);
    if (kind === "settle" || kind === "continue") return settlePick(a, items, m, now);
    var plan = null;
    if (kind === "level") plan = { key: levelWords(cfg.difficulty), label: "难度" };
    else if (kind === "challenge") plan = { key: cfg.challengeKeywords, index: cfg.challengeIndex, label: "无限挑战" };
    else if (kind === "signup") plan = { key: cfg.signupKeywords, index: cfg.signupIndex, label: "我要报名" };
    if (!plan) {
      logLine("道场内出现不认识的菜单：" + items.join(" / "), "warn");
      return doStop("道场内出现不认识的菜单，已停手（invalid-menu）：" + items.join(" / "), "invalid-menu");
    }
    var hits = pickIndex(items, plan.key);
    var idx = -1, via = "";
    if (hits.length === 1) { idx = hits[0]; via = "关键词"; }
    else if (hits.length > 1) return doStop("「" + plan.label + "」命中多项，已停手，请手动选择（invalid-menu）：" + items.join(" / "), "invalid-menu");
    else if (plan.index >= 1 && plan.index <= items.length) { idx = plan.index - 1; via = "序号 " + plan.index; }
    else return doStop("菜单里没有「" + plan.label + "」可用项（invalid-menu）：" + items.join(" / "), "invalid-menu");
    var r = call(a, "chooseMenu", [OWNER, { naid: m.naid, index: idx, fingerprint: m.fingerprint }]);
    run.lastMenuFp = m.fingerprint;
    if (!r || r.ok !== true) {
      if (r && r.error === "menu-already-used") return;
      return doStop("菜单提交失败（" + ((r && r.error) || "unknown") + "）", "choose-failed");
    }
    run.lastNextFp = "";
    logLine("道场内已选" + via + "：" + items[idx]);
  }

  /* ==================== 结算 ==================== */

  function beginSettle(now, why) {
    if (run.stage !== "battle") return; // V2.38.13 FIX-9：删掉恒假的第二项（语义=只允许从战斗阶段进入结算）
    call(api(), "requestPickup", [OWNER, { on: false }]); // V1.0.2：结算阶段收起自动拾取
    run.stage = "settle";
    run.settleUntil = now + cfg.settleWaitMs;
    run.settleSeen = false;
    run.lastMenuFp = "";
    setPhase("等待结算菜单（" + why + "）", "轮次 " + (run.round || 0));
    logLine("进入结算：" + why + "（轮次 " + (run.round || 0) + "）");
  }

  function settlePick(a, items, m, now) {
    var hs = pickIndex(items, cfg.settleKeywords);
    var hc = pickIndex(items, cfg.continueKeywords);
    var hl = pickIndex(items, levelWords(cfg.difficulty));
    var idx = -1, why = "";
    if (hs.length === 1) { idx = hs[0]; why = "领奖"; }
    else if (hs.length > 1) return doStop("结算菜单「领奖」命中多项，请手动选择（invalid-menu）：" + items.join(" / "), "invalid-menu");
    else if (hc.length === 1) { idx = hc[0]; why = "继续挑战"; }
    else if (hc.length > 1) return doStop("结算菜单「继续挑战」命中多项，请手动选择（invalid-menu）：" + items.join(" / "), "invalid-menu");
    else if (hl.length === 1) { idx = hl[0]; why = "难度"; }
    else return doStop("结算菜单里没有可用的领奖或继续项，请手动选择（invalid-menu）：" + items.join(" / "), "invalid-menu");
    var r = call(a, "chooseMenu", [OWNER, { naid: m.naid, index: idx, fingerprint: m.fingerprint }]);
    run.lastMenuFp = m.fingerprint;
    if (!r || r.ok !== true) {
      if (r && r.error === "menu-already-used") return;
      return doStop("菜单提交失败（" + ((r && r.error) || "unknown") + "）", "choose-failed");
    }
    run.lastNextFp = "";
    run.noNextSince = 0;
    run.settleSeen = true;
    run.settleUntil = now + 8000;
    logLine("结算：已选「" + items[idx] + "」（" + why + "）");
  }

  function settleTick(a, s, now) {
    var m = (s.dialogOpen && s.menu && Array.isArray(s.menu.items) && s.menu.items.length) ? s.menu : null;
    if (m) {
      if (m.fingerprint && m.fingerprint === run.lastMenuFp) {
        setPhase("结算菜单已选过，等服务器回应", "");
        return;
      }
      return settlePick(a, m.items.slice(), m, now);
    }
    if (s.dialogOpen) return pressNext(a, s, now, "结算");
    if (now < run.settleUntil) {
      setPhase(run.settleSeen ? "结算完成，等下一层" : "等待结算菜单", "");
      return;
    }
    if (run.settleSeen) return finishSettle(now);
    logLine("等不到结算菜单，先继续打", "warn");
    enterBattleStage(); // V2.38.13 FIX-5：结算超时兜底回到战斗阶段必须重新打开自动拾取，否则整轮不再捡
    setPhase("继续战斗", "");
  }

  function finishSettle(now) {
    run.lastMenuFp = "";
    run.lastNextFp = "";
    run.settleUntil = 0;
    run.settleSeen = false;
    if (run.cycleEnd) return endCycle("本轮 " + (run.round || 0) + " 轮已结算");
    enterBattleStage(); // V2.38.13 FIX-5：结算完成回到战斗阶段必须重新打开自动拾取
    run.noMobWarned = false;
    setPhase("继续战斗", "");
    logLine("结算完成，继续战斗");
  }

  function endCycle(reason) {
    logLine("本轮结束：" + reason);
    if (cfg.autoSignup && run.on) {
      logLine("自动开始下一轮报名");
      beginEntry(run.cycle + 1);
      return;
    }
    doStop(reason + "（自动报名已关闭）", "cycle-done");
  }

  /* ==================== 公告（轮次 / 剩余） ==================== */

  function onNotice(raw) {
    if (!run.on) return;
    var s = norm(raw), now = nowMs();
    if (!s) return;
    if (s === run.lastNotice && now - run.lastNoticeAt < 2500) return;
    run.lastNotice = s;
    run.lastNoticeAt = now;
    logLine("提示：" + s.slice(0, 80));
    parseNotice(s, now);
    render();
  }
  function parseNotice(s, now) {
    var out = { round: null, remaining: null, completed: null };
    var m = s.match(/第\s*(\d+)\s*[轮层波]/);
    if (m) { run.round = Math.max(run.round || 0, Number(m[1])); out.round = run.round; }
    m = s.match(/(?:还剩|剩余)\s*[:：]?\s*(\d+)/);
    if (m) { run.remaining = Number(m[1]); out.remaining = run.remaining; }
    m = s.match(/(?:完成|通过)\s*第?\s*(\d+)\s*[轮层波]|第\s*(\d+)\s*[轮层波]\s*(?:完成|结束|通过)/);
    if (m) {
      var r = Number(m[1] || m[2]);
      if (isFinite(r)) {
        run.round = Math.max(run.round || 0, r);
        out.completed = run.round;
        onRoundDone(run.round, now);
      }
    }
    return out;
  }
  function onRoundDone(round, now) {
    if (cfg.stop100 && round >= cfg.maxRound) {
      run.cycleEnd = true;
      logLine("已达 " + cfg.maxRound + " 轮，结算后开始下一轮循环");
      return beginSettle(now, "轮次到顶");
    }
    if (cfg.settleEvery > 0 && round > 0 && round % cfg.settleEvery === 0) {
      return beginSettle(now, "每 " + cfg.settleEvery + " 轮结算");
    }
  }

  /* ==================== 界面 ==================== */

  var PANEL_CSS_TEXT =
    "#ro-dojo-standalone{position:fixed;left:14px;bottom:14px;z-index:2147483646;width:308px;max-height:76vh;overflow:auto;" +
    "background:#f4f7fc;border:2px solid #1f9d4d;border-radius:12px;color:#16202c;box-shadow:0 10px 30px rgba(0,0,0,.42);" +
    "font:13px/1.6 'Microsoft YaHei',system-ui,sans-serif}" +
    "#ro-dojo-standalone .bar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#1f9d4d;color:#fff;border-radius:9px 9px 0 0;font-weight:700;cursor:move;user-select:none}" +
    "#ro-dojo-standalone .bar .sp{flex:1 1 auto}" +
    "#ro-dojo-standalone .bar button{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.34);color:#fff;border-radius:6px;padding:1px 8px;font-size:12px;cursor:pointer;font-weight:600}" +
    "#ro-dojo-standalone .bd{padding:8px 10px}" +
    "#ro-dojo-standalone .sec{font-size:12px;color:#1259b3;font-weight:700;border-left:3px solid #2f6fde;padding-left:8px;margin:2px 0 6px}" +
    "#ro-dojo-standalone .row{padding:6px 2px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #e6ebf2}" +
    "#ro-dojo-standalone .row:last-child{border-bottom:0}" +
    "#ro-dojo-standalone button{background:#2f6fde;color:#fff;border:1px solid #1f5cc9;border-radius:6px;padding:3px 10px;font-size:13px;cursor:pointer;font-weight:600;font-family:inherit}" +
    "#ro-dojo-standalone button:hover{background:#3d7de8}" +
    "#ro-dojo-standalone button.green{background:#1f9d4d;border-color:#17793a}" +
    "#ro-dojo-standalone button.red{background:#d64545;border-color:#b33535}" +
    "#ro-dojo-standalone button[disabled]{opacity:.5;cursor:default}" +
    "#ro-dojo-standalone select{background:#fff;border:1px solid #b9c4d4;color:#16202c;border-radius:5px;padding:3px 6px;font-size:13px;font-family:inherit}" +
    "#ro-dojo-standalone .switch{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#3c4d66;font-size:12px}" +
    "#ro-dojo-standalone .switch input{accent-color:#2f6fde;width:13px;height:13px;flex:none}" +
    "#ro-dojo-standalone .box{background:#fff;border:1px solid #dce4f0;border-radius:8px;padding:7px 9px;margin:7px 0}" +
    "#ro-dojo-standalone .b-hd{font-size:12px;color:#1259b3;font-weight:700;margin-bottom:3px}" +
    "#ro-dojo-standalone .st{color:#5a6b7f;font-size:12px;word-break:break-all}" +
    "#ro-dojo-standalone .log{font-size:11px;color:#4a5b76;background:#eef2f8;border-radius:5px;padding:4px 7px;white-space:pre-wrap;max-height:140px;overflow:auto}" +
    "#ro-dojo-standalone .tip{color:#5a6b7f;font-size:12px;line-height:1.55}" +
    "#ro-dojo-standalone .tip a{color:#1259b3}";

  // 启动按钮：默认贴右下角，并避开助手悬浮球（球是 #dsh-ball：right 28 / bottom 80 / 56×56），
  // 所以放在球正上方 right 28 / bottom 146（留 10px 间隙）；自带面板在左下角，互不遮挡。
  var LAUNCHER_CSS_TEXT =
    "#ro-dojo-launcher-box{position:fixed;right:28px;bottom:146px;z-index:2147483645;display:flex;align-items:center}" +
    "#ro-dojo-launcher{padding:4px 10px;border-radius:999px;background:#1f9d4d;border:1px solid #17793a;color:#fff;" +
    "font:12px/1.5 'Microsoft YaHei',system-ui,sans-serif;font-weight:700;cursor:pointer;user-select:none;" +
    "box-shadow:0 4px 12px rgba(0,0,0,.35);white-space:nowrap}" +
    "#ro-dojo-launcher:hover{background:#25ad57}";

  function el(tag, props, kids) {
    var n = document.createElement(tag), k;
    if (props) {
      for (k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (k === "style") { try { n.style.cssText = v; } catch (e) { n.setAttribute("style", v); } }
        else if (k === "text") n.textContent = v;
        else if (k === "cls") n.className = v;
        else if (k === "on") { for (var ev in v) if (Object.prototype.hasOwnProperty.call(v, ev)) n.addEventListener(ev, v[ev]); }
        else n[k] = v;
      }
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) n.appendChild(kids[i]);
    return n;
  }
  function sep() { return el("div", { cls: "sec", text: "无限道场（独立版）" }); }
  function check(id, label) {
    var box = el("input", { type: "checkbox", id: id });
    return { node: el("label", { cls: "switch" }, [box, el("span", { text: label })]), box: box };
  }

  function buildPanel() {
    if (root) return root;
    ctrls = {};
    startBtn = el("button", { id: "ro-dojo-start", cls: "green", text: "开始", on: { click: function () { doStart(); } } });
    stopBtn = el("button", { id: "ro-dojo-stop", cls: "red", text: "停止", disabled: true, on: { click: function () { doStop("手动停止", "manual"); } } });
    var diff = el("select", { id: "ro-dojo-diff" }, [
      el("option", { value: "basic", text: "初级" }),
      el("option", { value: "middle", text: "中级" }),
      el("option", { value: "advanced", text: "高级" })
    ]);
    diff.addEventListener("change", function () { cfg.difficulty = diff.value; saveCfg(); });
    ctrls.diff = diff;
    var c100 = check("ro-dojo-stop100", "100 轮后结算并重开");
    var cFly = check("ro-dojo-fly", "无怪时飞行");
    var cEmg = check("ro-dojo-emergency", "危险时飞行");
    var cAuto = check("ro-dojo-auto", "自动报名循环");
    [c100, cFly, cEmg, cAuto].forEach(function (c) {
      c.box.addEventListener("change", function () {
        cfg.stop100 = c100.box.checked;
        cfg.fly = cFly.box.checked;
        cfg.emergency = cEmg.box.checked;
        cfg.autoSignup = cAuto.box.checked;
        saveCfg();
      });
    });
    ctrls.stop100 = c100.box; ctrls.fly = cFly.box; ctrls.emergency = cEmg.box; ctrls.auto = cAuto.box;
    statusEl = el("div", { cls: "st", id: "ro-dojo-status", text: statusText() });
    logEl = el("div", { cls: "log", id: "ro-dojo-log" });
    var tip = el("div", { cls: "tip" }, [
      el("div", { text: "用法：先启用 RO 助手并进入游戏，再点「开始」；难度与开关可随时改，点「停止」立即停手。" }),
      el("div", { text: "限制：战斗由助手精灵代打；到报名点会消耗 1 个传送卷轴；只自动拾取卡片与装备；副本内的对话请站到 NPC 旁边。" }),
      el("div", { text: FILE_HINT }),
      el("div", {}, [el("span", { text: "脚本仓库：" }), el("a", { href: REPO_URL, target: "_blank", text: REPO_URL })])
    ]);
    root = el("div", { id: "ro-dojo-panel", cls: "ro-dojo-panel" }, [
      sep(),
      el("div", { cls: "row" }, [startBtn, stopBtn]),
      el("div", { cls: "row" }, [el("span", { cls: "st", text: "难度" }), diff]),
      el("div", { cls: "row" }, [c100.node, cFly.node]),
      el("div", { cls: "row" }, [cEmg.node, cAuto.node]),
      el("div", { cls: "box" }, [el("div", { cls: "b-hd", text: "状态" }), statusEl]),
      el("div", { cls: "box" }, [el("div", { cls: "b-hd", text: "日志" }), logEl]),
      el("div", { cls: "box" }, [el("div", { cls: "b-hd", text: "说明" }), tip])
    ]);
    try { root.setAttribute("data-ro-dojo", "1"); } catch (e) {}
    syncPanelFromCfg();
    return root;
  }
  function syncPanelFromCfg() {
    try {
      if (ctrls.diff) ctrls.diff.value = cfg.difficulty;
      if (ctrls.stop100) ctrls.stop100.checked = !!cfg.stop100;
      if (ctrls.fly) ctrls.fly.checked = !!cfg.fly;
      if (ctrls.emergency) ctrls.emergency.checked = !!cfg.emergency;
      if (ctrls.auto) ctrls.auto.checked = !!cfg.autoSignup;
    } catch (e) {}
  }

  function injectCss(text) {
    try {
      var st = document.createElement("style");
      st.textContent = text;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  function mountStandalone() {
    if (wrap && wrap.parentNode) return;
    buildPanel();
    injectCss(PANEL_CSS_TEXT);
    var close = el("button", { text: "收起", on: { click: function () { showPanel(false); } } });
    var bar = el("div", { cls: "bar" }, [el("span", { cls: "sp", text: "无限道场（独立版）" }), close]);
    var body = el("div", { cls: "bd" }, [root]);
    wrap = el("div", { id: "ro-dojo-standalone" }, [bar, body]);
    try { wrap.style.display = "none"; } catch (e) {}      // 开局一律隐藏：只有用户点按钮才显示
    dragify(wrap, bar);
    document.body.appendChild(wrap);
    mode = "standalone";
  }
  function detachStandalone() {
    try { if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (e) {}
    wrap = null;
    try { if (root && holder && root.parentNode !== holder) holder.appendChild(root); } catch (e) {}
  }
  function dragify(node, handle) {
    try {
      var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
      handle.addEventListener("mousedown", function (ev) {
        if (ev.target && ev.target.tagName === "BUTTON") return;
        dragging = true;
        moved = false;
        try { node.__dshDragged = false; } catch (e) {}
        sx = ev.clientX; sy = ev.clientY;
        var r = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, top: 0 };
        ox = r.left; oy = r.top;
        node.style.right = "auto";
        ev.preventDefault();
      });
      document.addEventListener("mousemove", function (ev) {
        if (!dragging) return;
        if (Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3) {
          moved = true;
          try { node.__dshDragged = true; } catch (e) {}
        }
        node.style.left = Math.max(0, ox + ev.clientX - sx) + "px";
        node.style.top = Math.max(0, oy + ev.clientY - sy) + "px";
        node.style.bottom = "auto";
      });
      document.addEventListener("mouseup", function () {
        if (dragging && moved && node === launcherBox) saveUiPos();   // 拖过才记位置：拖动后不触发展开
        dragging = false;
      });
    } catch (e) {}
  }
  // 优先复用助手浮窗；不可用时退回自建面板。
  // V1.0.3：这里只注册，不替用户打开 —— 打开 / 收起一律由「无限道场」按钮触发。
  function registerWindowMode() {
    var a = api();
    if (!a || !isFn(a.registerWindow) || !isFn(a.openWindow)) return false;
    buildPanel();
    var reg = call(a, "registerWindow", [WIN_ID, "无限道场（独立版）", function () { return root; }]);
    if (!reg || reg.ok !== true) return false;
    mode = "window";
    return true;
  }
  function openAssistantWindow() {
    var a = api();
    if (!a || !isFn(a.openWindow)) return false;
    var op = call(a, "openWindow", [WIN_ID]);
    if (!op || op.ok !== true) return false;
    panelOpen = true;
    render();
    return true;
  }

  /* ==================== 启动按钮（常驻小胶囊） ====================
   * 打开游戏不自动弹面板：两种显示方式下都挂这个按钮，用户点它才打开 / 收起。
   * 位置：默认贴右下角并避开助手悬浮球（球是 #dsh-ball：right 28 / bottom 80 / 56×56，
   * 见助手样式），按钮取球正上方 right 28 / bottom 146（留 10px 间隙）；
   * 自带面板在左下角（left 14 / bottom 14），两处互不遮挡。拖动后可记住位置。 */
  function loadUiPos() {
    try {
      var raw = JSON.parse(localStorage.getItem(UI_KEY) || "null");
      if (raw && typeof raw === "object" && isFinite(Number(raw.lx)) && isFinite(Number(raw.ly))) {
        return { lx: Number(raw.lx), ly: Number(raw.ly) };
      }
    } catch (e) {}
    return null;
  }
  function saveUiPos() {
    try {
      if (!launcherBox || !launcherBox.style) return;
      var l = parseFloat(launcherBox.style.left), t = parseFloat(launcherBox.style.top);
      if (!isFinite(l) || !isFinite(t)) return;
      localStorage.setItem(UI_KEY, JSON.stringify({ lx: Math.round(l), ly: Math.round(t) }));
    } catch (e) {}
  }
  function placeLauncher() {
    var p = loadUiPos();
    try {
      if (p) {                                        // 用户拖过就按记住的位置放
        launcherBox.style.left = p.lx + "px";
        launcherBox.style.top = p.ly + "px";
        launcherBox.style.right = "auto";
        launcherBox.style.bottom = "auto";
        return;
      }
      var ball = document.getElementById("dsh-ball");
      var r = (ball && isFn(ball.getBoundingClientRect)) ? ball.getBoundingClientRect() : null;
      var vh = Number(pageWindow().innerHeight);
      var bottom = 146;                               // 悬浮球底部 80 + 高 56 + 10 间隙
      if (r && r.height > 0 && isFinite(vh) && vh > 0) bottom = Math.max(8, Math.min(vh - 40, Math.round(vh - r.top) + 10));
      launcherBox.style.right = "28px";
      launcherBox.style.bottom = bottom + "px";
    } catch (e) {}
  }
  function mountLauncher() {
    if (launcherBox && launcherBox.parentNode) return launcherBox;
    injectCss(LAUNCHER_CSS_TEXT);
    launcherBtn = el("div", { id: "ro-dojo-launcher", cls: "ro-dojo-launcher", text: "无限道场", title: "打开或收起无限道场面板" });
    launcherBox = el("div", { id: "ro-dojo-launcher-box" }, [launcherBtn]);
    placeLauncher();
    launcherBtn.addEventListener("click", function () {
      if (launcherBox && launcherBox.__dshDragged) { launcherBox.__dshDragged = false; return; }  // 拖动结束那次 click 不算点开
      togglePanel();
    });
    dragify(launcherBox, launcherBtn);
    try { document.body.appendChild(launcherBox); } catch (e) { try { document.documentElement.appendChild(launcherBox); } catch (e2) {} }
    return launcherBox;
  }
  // 面板是否处于打开状态：拿得到助手浮窗节点就以它为准，拿不到退化为本地标记
  function winNode() {
    try { return document.getElementById("dsh-win-fw-" + WIN_ID) || null; } catch (e) { return null; }
  }
  function winShown() {
    var n = winNode();
    if (!n) return null;
    try {
      var st = n.style || {};
      if (st.display === "none" || st.visibility === "hidden") return false;
      return true;
    } catch (e) { return null; }
  }
  function panelShown() {
    if (mode === "window") {
      var seen = winShown();
      if (seen !== null) return seen;
    }
    return panelOpen === true;
  }
  function showPanel(on) {
    panelOpen = on === true;
    try { if (wrap) wrap.style.display = panelOpen ? "block" : "none"; } catch (e) {}
  }
  function togglePanel() {
    var want = !panelShown();
    if (mode === "window") {
      if (!api()) { logLine("没有找到 RO 助手，暂时打不开面板", "warn"); return; }
      if (want) {
        if (!openAssistantWindow()) logLine("助手浮窗没打开，请确认助手已就绪", "warn");
      } else {
        panelOpen = false;
        var a = api(), cl = call(a, "closeWindow", [WIN_ID]);
        if (!cl || cl.ok !== true) logLine("收起助手浮窗没成功", "warn");
        render();
      }
      return;
    }
    if (want && !wrap) mountStandalone();
    showPanel(want);
  }

  /* ==================== 本地配置（可选） ==================== */

  function loadFileCfg(done) {
    var url = cfg.configUrl || CONFIG_URL;
    if (typeof GM_xmlhttpRequest !== "function") { logLine("未启用本地配置读取（扩展未授权本机文件）"); return done(null); }
    try {
      GM_xmlhttpRequest({
        method: "GET", url: url, timeout: 5000,
        onload: function (r) {
          var text = r && r.responseText;
          if (!text) return done(null);
          var j = null;
          try { j = JSON.parse(text); } catch (e) { logLine("本地配置格式不对，继续用内置默认", "warn"); return done(null); }
          done(j && typeof j === "object" ? j : null);
        },
        onerror: function () { done(null); },
        ontimeout: function () { done(null); }
      });
    } catch (e) { done(null); }
  }

  /* ==================== 启动 ==================== */

  function boot() {
    buildPanel();
    holder = el("div", { id: "ro-dojo-holder", style: "display:none" }, [root]);
    try { document.body.appendChild(holder); } catch (e) { try { document.documentElement.appendChild(holder); } catch (e2) {} }
    mountLauncher();
    // 助手可用只注册浮窗，不替用户打开；不可用退回自带面板，同样先隐藏 —— 任何路径都不得让面板可见
    if (!registerWindowMode()) mountStandalone();
    logLine("脚本已就绪（" + VERSION + "）；点右下角「无限道场」按钮打开面板");
    render();

    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (mode === "window" || tries > 20) { clearInterval(t); return; }
      if (api() && registerWindowMode()) {
        detachStandalone();
        logLine("已切换到助手浮窗显示");
        if (panelOpen) openAssistantWindow();      // 用户先前已手动打开才跟着打开
        clearInterval(t);
      }
    }, 3000);

    loadFileCfg(function (j) {
      if (!j) return;
      applyCfg(cfg, j);
      saveCfg();
      syncPanelFromCfg();
      logLine("已读取本地配置：" + CFG_KEYS.filter(function (k) { return Object.prototype.hasOwnProperty.call(j, k); }).join("、"));
    });

    try {
      window.addEventListener("dsh-ro-assist-notice", function (ev) {
        try { onNotice(ev && ev.detail && (ev.detail.text || ev.detail.message)); } catch (e) {}
      });
      window.addEventListener("dsh-ro-assist-ready", function () {
        if (mode !== "window" && api() && registerWindowMode()) {
          detachStandalone();
          logLine("已切换到助手浮窗显示");
          if (panelOpen) openAssistantWindow();    // 用户先前已手动打开才跟着打开，不替用户打开
        }
      });
      window.addEventListener("pagehide", function () { if (run.on) doStop("页面离开", "pagehide"); });
    } catch (e) {}
  }

  try { boot(); } catch (e) { try { console.error("[无限道场] 启动失败", e); } catch (e2) {} }

  /* ==================== 测试钩子（只在显式打开时挂上） ==================== */

  try {
    if (window.__RO_DOJO_TEST_HOOK__ === true) {
      window.__RO_DOJO_TEST__ = {
        version: VERSION, defaults: DEFAULTS, cfg: cfg, run: run,
        api: api, apiReport: apiReport, norm: norm, cheb: cheb, mapKey: mapKey, sameMap: sameMap,
        adjacentCell: adjacentCell, pickIndex: pickIndex, classifyMenu: classifyMenu, npcDigest: npcDigest,
        parseNotice: parseNotice, onNotice: onNotice, onRoundDone: onRoundDone,
        doStart: doStart, doStop: doStop, tick: tick, tickBody: tickBody,
        entryTick: entryTick, dialogTick: dialogTick, chooseEntryMenu: chooseEntryMenu,
        battleTick: battleTick, dojoNpcTick: dojoNpcTick, dojoMenuTick: dojoMenuTick,
        beginSettle: beginSettle, settleTick: settleTick, settlePick: settlePick,
        finishSettle: finishSettle, endCycle: endCycle, beginEntry: beginEntry, beginBattle: beginBattle,
        pressNext: pressNext, npcBoxButton: npcBoxButton, npcBox: npcBox, doTeleport: doTeleport, arrowPreflight: arrowPreflight,
        statusText: statusText, logLines: function () { return run.log.slice(); }, root: function () { return root; },
        mode: function () { return mode; }, applyCfg: applyCfg,
        togglePanel: togglePanel, panelShown: panelShown, wrap: function () { return wrap; },
        launcher: function () { return launcherBox; }, winShown: winShown
      };
    }
  } catch (e) {}
})();
