/* ============================================================
 * private-client-probe.js —— 本机私有客户端页面「只读」探针
 * 目标页面：http://127.0.0.1:8971/client/api.html
 *
 * 使用步骤（3 步）：
 *   1. 浏览器打开目标页面，按 F12 切到 Console。
 *   2. 把本文件全部内容整段粘贴进 Console，回车运行。
 *   3. 复制输出的 JSON（脚本会自动尝试复制到剪贴板）并回传。
 *
 * 只读探测，不发包、不登录：
 *   - 不发送任何游戏封包；封包构造器只做 typeof 检查，绝不实例化、绝不调用 sendPacket。
 *   - 不登录、不读取账号/口令/令牌一类敏感数据，不碰浏览器本地存储的任何键值。
 *   - 不开启也不切换自动战斗，不点击、不修改任何对象与 DOM 状态，不注册定时器、不循环。
 *   - 只输出白名单化的键名与类型，不打印完整 window 对象；字符串内容一律不打印。
 * ============================================================ */
(function () {
  'use strict';

  var CAP_KEYS = 200;
  var CAP_CZ_KEYS = 160;
  var CAP_LIST = 300;
  var CAP_ITER = 5000;

  var out = {
    probe: 'private-client-probe',
    version: '1.0.0',
    generatedAt: null,
    href: null,
    hasRequire: null,
    hasClient: null,
    clientKeys: null,
    clientReadError: null,
    clientSSKeys: null,
    clientNMKeys: null,
    clientPSKeys: null,
    globals: null,
    globalsInfo: null,
    requireProbe: null,
    moduleSources: null,
    entityProbe: null,
    lifeProbe: null,
    packetProbe: null,
    autoBattleProbe: null,
    notes: []
  };

  /* ---------------- 安全小工具（每一项都不会抛错） ---------------- */

  function errOf(e) {
    try {
      if (!e) return 'unknown error';
      var nm = e.name ? String(e.name) : '';
      var msg = (e.message === undefined || e.message === null) ? String(e) : String(e.message);
      return (nm ? nm + ': ' : '') + msg;
    } catch (e2) {
      return 'unreadable error';
    }
  }

  function note(s) {
    try { out.notes.push(String(s)); } catch (e) {}
  }

  function typeName(v) {
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'object' && Object.prototype.toString.call(v) === '[object Array]') return 'array';
      return typeof v;
    } catch (e) { return 'unreadable'; }
  }

  function ctorName(v) {
    try {
      if (v === null || v === undefined) return null;
      var c = v.constructor;
      return (c && c.name) ? String(c.name) : null;
    } catch (e) { return null; }
  }

  // 只返回类型/结构；boolean 与 number 附带取值，字符串只给长度（内容不打印）
  function safeValue(v) {
    var r = { type: typeName(v) };
    try {
      if (r.type === 'boolean' || r.type === 'number') {
        r.value = v;
      } else if (r.type === 'string') {
        r.length = v.length;
      } else if (r.type === 'object' || r.type === 'function' || r.type === 'array') {
        r.ctor = ctorName(v);
      }
    } catch (e) { r.error = errOf(e); }
    return r;
  }

  function keysOf(o, cap) {
    var res = { ok: false, count: null, keys: null, error: null, truncated: false };
    try {
      if (o === null || o === undefined) { res.error = 'not available (' + typeName(o) + ')'; return res; }
      var t = typeof o;
      if (t !== 'object' && t !== 'function') { res.error = 'not an object (' + t + ')'; return res; }
      var ks = Object.keys(o);
      res.ok = true;
      res.count = ks.length;
      res.keys = ks.slice(0, cap || CAP_KEYS);
      res.truncated = ks.length > res.keys.length;
    } catch (e) { res.error = errOf(e); }
    return res;
  }

  function keyList(o, cap) {
    var k = keysOf(o, cap);
    return k.ok ? k.keys : null;
  }

  // 取属性可能抛错（getter），统一包住
  function getter(fn, cap, label) {
    try { return keyList(fn(), cap); }
    catch (e) { note(label + ': ' + errOf(e)); return null; }
  }

  function describe(v) {
    var d = { type: typeName(v) };
    try {
      if (d.type === 'boolean' || d.type === 'number') d.value = v;
      if (v !== null && v !== undefined && (d.type === 'object' || d.type === 'function' || d.type === 'array')) {
        d.ctor = ctorName(v);
        var k = keysOf(v, 60);
        d.keyCount = k.count;
        d.keys = k.keys;
        d.keysError = k.error;
      }
    } catch (e) { d.error = errOf(e); }
    return d;
  }

  function describeProp(o, k) {
    try { return describe(o[k]); }
    catch (e) { return { type: 'unreadable', error: errOf(e) }; }
  }

  function hasProp(o, k) {
    try { return !!(o && (k in o)); } catch (e) { return null; }
  }

  /* ---------------- 0. 页面基本信息 ---------------- */

  try { out.generatedAt = new Date().toISOString(); } catch (e) {}

  var W = null;
  try { W = window; } catch (e) { note('window 不可读: ' + errOf(e)); }
  try { out.href = String(window.location.href); } catch (e) { note('href: ' + errOf(e)); }

  /* ---------------- 1. window.require ---------------- */

  var req = null;
  try { req = W ? W.require : null; } catch (e) { note('window.require: ' + errOf(e)); }
  out.hasRequire = typeName(req);

  /* ---------------- 2. window.CLIENT ---------------- */

  var CLI = null;
  var cliSS = null, cliNM = null, cliPS = null;
  try { CLI = W ? W.CLIENT : null; } catch (e) { note('window.CLIENT: ' + errOf(e)); }
  out.hasClient = (CLI !== null && CLI !== undefined);

  if (out.hasClient) {
    var ck = keysOf(CLI, CAP_KEYS);
    out.clientKeys = ck.keys;
    out.clientReadError = ck.error;
    out.clientSSKeys = getter(function () { return CLI.SS; }, 120, 'CLIENT.SS');
    out.clientNMKeys = getter(function () { return CLI.NM; }, 120, 'CLIENT.NM');
    out.clientPSKeys = getter(function () { return CLI.PS; }, CAP_CZ_KEYS, 'CLIENT.PS');
    try { cliSS = CLI.SS; } catch (e) { note('CLIENT.SS ref: ' + errOf(e)); }
    try { cliNM = CLI.NM; } catch (e) { note('CLIENT.NM ref: ' + errOf(e)); }
    try { cliPS = CLI.PS; } catch (e) { note('CLIENT.PS ref: ' + errOf(e)); }
  } else {
    out.clientReadError = 'window.CLIENT = ' + typeName(CLI);
  }

  /* ---------------- 3. window 全局键名（白名单正则） ---------------- */

  var GLOB_RE = /client|entity|network|packet|legacy|bridge|ro|renderer|engine/i;
  try {
    var allKeys = Object.keys(W);
    var hits = [];
    for (var gi = 0; gi < allKeys.length; gi++) {
      if (GLOB_RE.test(allKeys[gi])) hits.push(allKeys[gi]);
    }
    out.globals = hits.slice(0, CAP_LIST);
    out.globalsInfo = {
      pattern: 'client|entity|network|packet|legacy|bridge|ro|renderer|engine（忽略大小写）',
      windowKeyCount: allKeys.length,
      matchedCount: hits.length,
      truncated: hits.length > CAP_LIST
    };
  } catch (e) {
    out.globals = null;
    out.globalsInfo = { error: errOf(e) };
    note('globals: ' + errOf(e));
  }

  /* ---------------- 4. requireProbe ---------------- */

  var REQ_CANDIDATES = [
    'Renderer/EntityManager',
    'Utils/PathFinding',
    'Engine/SessionStorage',
    'Network/NetworkManager',
    'Network/PacketStructure'
  ];
  var store = {};
  out.requireProbe = [];

  for (var ri = 0; ri < REQ_CANDIDATES.length; ri++) {
    var entry = {
      module: REQ_CANDIDATES[ri],
      ok: false,
      type: null,
      ctor: null,
      keyCount: null,
      keys: null,
      keysError: null,
      error: null,
      extraCandidate: ri >= 2
    };
    try {
      if (typeof req !== 'function') {
        entry.error = 'window.require is not a function（' + typeName(req) + '）';
      } else {
        var mod = req(REQ_CANDIDATES[ri]);
        if (mod === null || mod === undefined) {
          entry.error = 'require 返回 ' + typeName(mod);
        } else {
          entry.ok = true;
          entry.type = typeName(mod);
          entry.ctor = ctorName(mod);
          var mk = keysOf(mod, 60);
          entry.keyCount = mk.count;
          entry.keys = mk.keys;
          entry.keysError = mk.error;
          store[REQ_CANDIDATES[ri]] = mod;
        }
      }
    } catch (e) {
      entry.error = errOf(e);
    }
    out.requireProbe.push(entry);
  }

  /* ---------------- 5. 模块来源（require 优先，window.CLIENT 兜底） ---------------- */

  var EM = store['Renderer/EntityManager'] || null;
  var SS = store['Engine/SessionStorage'] || cliSS || null;
  var NM = store['Network/NetworkManager'] || cliNM || null;
  var PS = store['Network/PacketStructure'] || cliPS || null;

  out.moduleSources = {
    EntityManager: EM ? (store['Renderer/EntityManager'] ? 'window.require' : 'window.CLIENT') : null,
    SessionStorage: SS ? (store['Engine/SessionStorage'] ? 'window.require' : 'window.CLIENT.SS') : null,
    NetworkManager: NM ? (store['Network/NetworkManager'] ? 'window.require' : 'window.CLIENT.NM') : null,
    PacketStructure: PS ? (store['Network/PacketStructure'] ? 'window.require' : 'window.CLIENT.PS') : null,
    note: '本仓库脚本以 window.require 为准；window.CLIENT 仅作兜底，二者都拿不到即 null'
  };

  /* ---------------- 6. entityProbe ---------------- */

  var mob = null;
  var EP = {
    source: null,
    forEachIsFunction: null,
    getIsFunction: null,
    entityCount: null,
    iterCapped: null,
    firstMob: null,
    error: null
  };
  out.entityProbe = EP;

  try {
    if (EM) {
      EP.source = out.moduleSources.EntityManager;
      EP.forEachIsFunction = (typeof EM.forEach === 'function');
      EP.getIsFunction = (typeof EM.get === 'function');
      var count = 0;
      var capped = false;
      if (EP.forEachIsFunction) {
        EM.forEach(function (e) {
          try {
            if (count >= CAP_ITER) { capped = true; return; }
            count++;
            if (!mob && e && e.objecttype === 5) mob = e;
          } catch (e2) { /* 单个实体读失败不影响整体 */ }
        });
      } else if (typeof EM.getList === 'function') {
        var list = EM.getList();
        if (list && typeof list.length === 'number') {
          for (var li = 0; li < list.length && li < CAP_ITER; li++) {
            count++;
            var le = list[li];
            if (!mob && le && le.objecttype === 5) mob = le;
          }
          capped = list.length > CAP_ITER;
        }
      }
      EP.entityCount = count;
      EP.iterCapped = capped;
    } else {
      EP.error = 'EntityManager 不可用（require 与 window.CLIENT 都未取到）';
    }
  } catch (e) {
    EP.error = errOf(e);
  }

  try {
    if (mob) {
      var own = keysOf(mob, 120);
      var chain = [];
      try {
        var proto = Object.getPrototypeOf(mob);
        var depth = 0;
        while (proto && proto !== Object.prototype && depth < 5) {
          var pk = Object.keys(proto);
          for (var pi = 0; pi < pk.length; pi++) {
            if (chain.indexOf(pk[pi]) < 0) chain.push(pk[pi]);
          }
          proto = Object.getPrototypeOf(proto);
          depth++;
        }
      } catch (e4) { note('原型链读取: ' + errOf(e4)); }
      EP.firstMob = {
        found: true,
        objecttype: describeProp(mob, 'objecttype'),
        ownKeyCount: own.count,
        ownKeys: own.keys,
        chainKeyCount: chain.length,
        chainKeys: chain.slice(0, 150),
        fieldTypes: {
          GID: describeProp(mob, 'GID'),
          _job: describeProp(mob, '_job'),
          job: describeProp(mob, 'job'),
          position: describeProp(mob, 'position'),
          life: describeProp(mob, 'life'),
          action: describeProp(mob, 'action')
        }
      };
    } else {
      EP.firstMob = { found: false, error: EP.error || '遍历完成但未找到 objecttype===5 的实体' };
    }
  } catch (e) {
    EP.firstMob = { found: false, error: errOf(e) };
  }

  /* ---------------- 7. lifeProbe ---------------- */

  var LP = {
    source: null,
    exists: false,
    keyCount: null,
    keys: null,
    hasHp: null,
    hasMaxHp: null,
    maxHpFields: null,
    hpIsNumber: null,
    maxHpIsNumber: null,
    hp: null,
    maxHp: null,
    fieldTypes: null,
    error: null
  };
  out.lifeProbe = LP;

  try {
    var life = null;
    if (mob) {
      LP.source = 'firstMob.life';
      try { life = mob.life; } catch (e) { note('mob.life: ' + errOf(e)); }
    }
    if (life === null || life === undefined) {
      var se = null;
      try { se = SS ? SS.Entity : null; } catch (e) { note('SS.Entity: ' + errOf(e)); }
      if (se && se.life) { life = se.life; LP.source = 'SS.Entity.life'; }
    }

    if (life === null || life === undefined) {
      LP.error = 'life 对象不可用（无 objecttype===5 实体，或该实体没有 life）';
    } else {
      LP.exists = true;
      var lk = keysOf(life, 80);
      LP.keys = lk.keys;
      LP.keyCount = lk.count;
      var LIFE_FIELDS = ['hp', 'maxhp', 'maxHp', 'hp_max', 'max_hp', 'sp', 'maxsp', 'maxSp', 'sp_max'];
      var types = {};
      var maxHpFound = [];
      for (var lf = 0; lf < LIFE_FIELDS.length; lf++) {
        var fname = LIFE_FIELDS[lf];
        if (!hasProp(life, fname)) continue;
        types[fname] = describeProp(life, fname);
        if (fname === 'maxhp' || fname === 'maxHp' || fname === 'hp_max' || fname === 'max_hp') maxHpFound.push(fname);
      }
      LP.fieldTypes = types;
      LP.hasHp = hasProp(life, 'hp');
      LP.hasMaxHp = maxHpFound.length > 0;
      LP.maxHpFields = maxHpFound;
      var hpv = null, mhv = null;
      try { hpv = life.hp; } catch (e) {}
      if (maxHpFound.length) { try { mhv = life[maxHpFound[0]]; } catch (e) {} }
      LP.hpIsNumber = (typeof hpv === 'number');
      LP.maxHpIsNumber = (typeof mhv === 'number');
      LP.hp = LP.hpIsNumber ? hpv : null;
      LP.maxHp = LP.maxHpIsNumber ? mhv : null;
    }
  } catch (e) {
    LP.error = errOf(e);
  }

  /* ---------------- 8. packetProbe ---------------- */

  var PP = {
    nmSource: null,
    psSource: null,
    nmSendPacketIsFunction: null,
    nmKeys: null,
    psKeys: null,
    psCZExists: null,
    psCZKeyCount: null,
    psCZKeys: null,
    psCZFunctionKeys: null,
    hasREQUEST_ACT: null,
    hasUSE_SKILL: null,
    REQUEST_ACT: null,
    USE_SKILL: null,
    note: '只做 typeof 检查：未 new、未调用 sendPacket，未发送任何封包',
    error: null
  };
  out.packetProbe = PP;

  try {
    PP.nmSource = out.moduleSources.NetworkManager;
    PP.psSource = out.moduleSources.PacketStructure;

    if (NM) {
      PP.nmSendPacketIsFunction = (typeof NM.sendPacket === 'function');
      PP.nmKeys = keyList(NM, 60);
    } else if (!PP.error) {
      PP.error = 'NetworkManager 不可用';
    }

    if (PS) {
      PP.psKeys = keyList(PS, CAP_CZ_KEYS);
    } else if (!PP.error) {
      PP.error = 'PacketStructure 不可用';
    }

    var CZ = null;
    try { CZ = PS ? PS.CZ : null; } catch (e) { note('PS.CZ: ' + errOf(e)); }

    if (CZ === null || CZ === undefined) {
      PP.psCZExists = false;
      if (!PP.error) PP.error = 'PS.CZ 不可用';
    } else {
      PP.psCZExists = true;
      var czk = keysOf(CZ, CAP_CZ_KEYS);
      PP.psCZKeyCount = czk.count;
      PP.psCZKeys = czk.keys;
      var czf = [];
      for (var ci = 0; ci < (czk.keys || []).length; ci++) {
        var cname = czk.keys[ci];
        var isFn = false;
        try { isFn = typeof CZ[cname] === 'function'; } catch (e) { isFn = false; }
        if (isFn) czf.push(cname);
      }
      PP.psCZFunctionKeys = czf;
      PP.REQUEST_ACT = describeProp(CZ, 'REQUEST_ACT');
      PP.USE_SKILL = describeProp(CZ, 'USE_SKILL');
      PP.hasREQUEST_ACT = (PP.REQUEST_ACT && PP.REQUEST_ACT.type === 'function');
      PP.hasUSE_SKILL = (PP.USE_SKILL && PP.USE_SKILL.type === 'function');
    }
  } catch (e) {
    PP.error = errOf(e);
  }

  /* ---------------- 9. autoBattleProbe（只读存在性，不改变状态） ---------------- */

  var AB = {
    readOnly: true,
    dom: [],
    globalFlags: [],
    note: '只读存在性探测：不点击、不勾选、不取消、不触发任何开关，不改变状态',
    error: null
  };
  out.autoBattleProbe = AB;

  var AB_SELS = [
    { sel: '#vbk', what: '内挂主面板容器' },
    { sel: '#vbk input.openattack', what: '内挂自动战斗开关（面板权威状态来源）' },
    { sel: 'input.openattack', what: '自动战斗开关（不限容器）' },
    { sel: '#chatbox', what: '聊天窗容器' },
    { sel: '#chatbox .containers .border', what: '聊天回执容器（开启/关闭自动战斗文本）' },
    { sel: '#dsh-ro-panel', what: '本仓库助手主面板' },
    { sel: '#dsh-ro-menu', what: '本仓库助手菜单' },
    { sel: '#dsh-ball', what: '本仓库助手悬浮球' }
  ];

  try {
    for (var si = 0; si < AB_SELS.length; si++) {
      var item = AB_SELS[si];
      var de = { selector: item.sel, what: item.what, source: 'document.querySelector', exists: false };
      try {
        var el = document.querySelector(item.sel);
        de.exists = !!(el && el.nodeType === 1);
        if (de.exists && item.sel === '#vbk input.openattack') {
          de.tag = el.tagName ? String(el.tagName).toLowerCase() : null;
          de.hasCheckedProp = (typeof el.checked === 'boolean'); // 只判断可读性，不读取/不改变取值
        }
      } catch (e) {
        de.error = errOf(e);
      }
      AB.dom.push(de);
    }
  } catch (e) {
    AB.error = errOf(e);
  }

  var FLAG_NAMES = ['__dshBattle', 'npHuntOn', 'ROConfig', '__ROExt', '__ROPlugin', '__dshStorageCache', 'autoBattle', 'autoAttack', 'autoFight', '__AUTO_BATTLE__'];
  var AUTO_RE = /auto|assist|robot|bot|hunt|battle|farm/i;

  try {
    var seen = {};
    var addFlag = function (name, source) {
      try {
        if (seen[name]) return;
        seen[name] = true;
        var v = null;
        var readErr = null;
        try { v = W[name]; } catch (e) { readErr = errOf(e); }
        var sv = safeValue(v);
        var fe = { name: name, source: source, exists: (v !== undefined && v !== null), type: sv.type };
        if (sv.value !== undefined) fe.value = sv.value;   // 仅 boolean/number 带值
        if (sv.ctor) fe.ctor = sv.ctor;
        if (sv.length !== undefined) fe.length = sv.length;
        if (readErr) fe.error = readErr;
        AB.globalFlags.push(fe);
      } catch (e) { /* 单个标志位失败不影响整体 */ }
    };

    for (var fn2 = 0; fn2 < FLAG_NAMES.length; fn2++) addFlag(FLAG_NAMES[fn2], 'window（已知候选名）');

    try {
      var wk = Object.keys(W);
      for (var wi = 0; wi < wk.length && AB.globalFlags.length < 60; wi++) {
        if (!AUTO_RE.test(wk[wi])) continue;
        addFlag(wk[wi], 'window（正则扫描 auto|assist|robot|bot|hunt|battle|farm）');
      }
    } catch (e) { note('标志位扫描: ' + errOf(e)); }
  } catch (e) {
    AB.error = errOf(e);
  }

  /* ---------------- 10. 输出（纯 JSON 字符串） ---------------- */

  var json = null;
  try {
    json = JSON.stringify(out, null, 2);
  } catch (e) {
    json = '{"probe":"private-client-probe","error":"JSON.stringify failed: ' + errOf(e) + '"}';
  }

  try { console.log('[private-client-probe] 只读探测完成（不发包、不登录），结果 JSON 如下：'); } catch (e) {}
  try { console.log(json); } catch (e) {}
  try {
    if (typeof copy === 'function') {
      copy(json);
      console.log('[private-client-probe] 已尝试把结果复制到剪贴板。');
    }
  } catch (e) {}

  return json;
})();
