// diag-collect 接收服务：检测插件(ro-detect)回传日志落盘 + 多账号平台中心（账号状态表 + 总页面 + 同步器）
// 用法: node tools/diag-collect-server.js （监听 8899）
// 多账号平台路由：
//   POST /api/acct/report  节点(ro-assist)上报角色状态+同步操作 → 更新状态表并落盘，响应带回待执行广播
//   GET  /api/acct/state   总页面轮询读取全表（附加服务端在线验证 serverOnline；在线=60s 内有上报；24h 无上报自动清理）
//   GET  /api/acct/server-online  服务端在线验证结果（mn/search 官方接口，直读调试用）
//   GET  /api/acct/accounts       账号配置列表（本机 accounts 文件，密码掩码）
//   GET  /acct             总页面（只读总览，页面在 tools/acct-page.html）
var http = require('http');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', '..', 'diag-collect'); // 工作区根 D:/0_Harness/1_RObot/diag-collect（仓库外）
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

var STATE_FILE = path.join(DIR, 'acct-state.json');
var ONLINE_MS = 60 * 1000;        // 60s 无上报 → 离线
var CLEAN_MS = 24 * 3600 * 1000;  // 24h 无上报 → 清理出表

// ---------------- 账号配置（本机 accounts 文件：谁填自己的号，不写代码里）----------------
var ACCOUNTS_FILE = path.join(DIR, 'acct-accounts.json');
var ACCOUNT_LIST = [];   // [{userid, passwd, note, nid, enabled}]
try { ACCOUNT_LIST = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) || []; } catch (e) {}
function saveAccounts() {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(ACCOUNT_LIST)); } catch (e) {}
}
// ---------------- 服务端在线验证（lastRO 官方接口 mn/search）----------------
// SERVER_ONLINE: userid -> { online:bool, name, class, base_level, job_level, last_map, hp, max_hp, sp, max_sp,
//                           weight, maxweight, inminute, updatetime, autoattack/autoloot/autopots, err }
var SERVER_ONLINE = {};
var SERVER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
// 线路 nid → 账号字段前缀（实测：nid5 V6-Eden=Login_debug / nid3 V6-Online=Login_cn2 / nid4=Login_ts）
function mnPrefix(nid) {
  if (nid === 3) return 'Login_cn2';
  if (nid === 4) return 'Login_ts';
  return 'Login_debug';
}
function mnSearch(userid, passwd, nid) {
  var prefix = mnPrefix(nid || 5);
  return fetch('https://post.lastro.cn/?r=pc/index', {
    headers: { 'User-Agent': SERVER_UA }, signal: AbortSignal.timeout(20000)
  }).then(function (r) { return r.text(); }).then(function (t) {
    var m = t.match(/id="_csrf" value="([^"]+)"/);
    var token = m ? m[1] : '';
    var form = new URLSearchParams();
    form.set('_csrf', token);
    form.set(prefix + '[userid]', userid);
    form.set(prefix + '[user_pass]', passwd);
    return fetch('https://post.lastro.cn/?r=mn/search&nid=' + (nid || 5), {
      method: 'POST',
      headers: { 'User-Agent': SERVER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(20000)
    }).then(function (r) { return r.text(); });
  }).then(function (body) {
    var j;
    try { j = JSON.parse(body); } catch (e) { return { online: false, err: 'bad-resp:' + body.slice(0, 40) }; }
    if (j && typeof j === 'object' && j.name) {
      return {
        online: true, name: j.name, class: j.class,
        base_level: j.base_level, job_level: j.job_level, last_map: j.last_map,
        hp: j.hp, max_hp: j.max_hp, sp: j.sp, max_sp: j.max_sp,
        weight: j.weight, maxweight: j.maxweight,
        inminute: j.inminute, updatetime: j.updatetime,
        autoattack: j.autoattack, autoloot: j.autoloot, autopots: j.autopots,
        hppotion: j.hppotion, sppotion: j.sppotion, bpower: j.bpower,
        base_exp: j.base_exp, job_exp: j.job_exp
      };
    }
    if (j === 1) return { online: false, err: '密码错' };
    if (j === 2) return { online: false, err: '离线' };
    return { online: false, err: '未知:' + String(j).slice(0, 30) };
  }).catch(function (e) { return { online: false, err: 'net:' + e.message.slice(0, 50) }; });
}
// 轮询所有启用账号（错开 1.5s/个，避免同时请求）
function refreshServerOnline() {
  var list = ACCOUNT_LIST.filter(function (a) { return a && a.userid && a.enabled !== false; });
  var i = 0;
  function next() {
    if (i >= list.length) { setTimeout(refreshServerOnline, 60000); return; }
    var a = list[i++];
    mnSearch(a.userid, a.passwd, a.nid).then(function (r) {
      SERVER_ONLINE[a.userid] = r;
      r._ts = Date.now();
      setTimeout(next, 1500);
    });
  }
  next();
}
setTimeout(refreshServerOnline, 2000); // 启动 2s 后开始首轮

// ---------------- 同步广播表（主号操作 → 其他账号取走执行）----------------
// SYNC_OPS: fromAccount -> { seq, op, ts }；每个主号只保留最新一条未确认广播
// 从号上报 syncAcked（已执行的最大 seq）后，中心不再下发 <= 该 seq 的广播
var SYNC_OPS = {};
var SYNC_SEQ = 0;

// ---------------- 账号状态表（account → 最新快照）----------------
var ACCOUNTS = {};
try { ACCOUNTS = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch (e) {}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(ACCOUNTS)); } catch (e) {}
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () { cb(Buffer.concat(chunks).toString('utf8')); });
}

// ---------------- 总页面 /acct（只读总览，页面 JS 在独立文件避免转义）----------------
var ACCT_PAGE = null;
try {
  ACCT_PAGE = fs.readFileSync(path.join(__dirname, 'acct-page.html'), 'utf8');
} catch (e) {
  ACCT_PAGE = '<!doctype html><html lang="zh-CN"><body><h1>总页面文件缺失</h1><p>缺少 tools/acct-page.html，请确认该文件存在。</p></body></html>';
}

// ---------------- 无头端控制台状态（模块作用域，跨请求共享）----------------
var NODES_FILE = path.join(DIR, 'nodes.json');
var SCRIPTS_FILE = path.join(DIR, 'scripts.json');
var EVENT_FILE = path.join(DIR, 'panel-events.log');
var NODES = {};
try { NODES = JSON.parse(fs.readFileSync(NODES_FILE, 'utf8')) || {}; } catch (e) {}
var CMDS = {};      // nodeId -> { seq, cmd, ts }，每个节点只保留最新一条
var CMD_SEQ = 0;
var EVENTS = [];    // 内存事件流，最多 500 条
function saveNodes() { try { fs.writeFileSync(NODES_FILE, JSON.stringify(NODES)); } catch (e) {} }

// ---------------- 路由 ----------------
var server = http.createServer(function (req, res) {
  cors(res);
  var url = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 节点上报：POST /api/acct/report
  if (url === '/api/acct/report' && req.method === 'POST') {
    readBody(req, function (body) {
      var snap = null;
      try { snap = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      if (!snap || !snap.account) { json(res, 400, { ok: false, err: 'no account' }); return; }
      snap._serverTs = Date.now();
      ACCOUNTS[snap.account] = snap;
      saveState();
      // 同步器：本窗口是主号时，把待广播操作写入广播表（每个主号保留最新一条）
      if (Array.isArray(snap.syncPending)) {
        for (var pi = 0; pi < snap.syncPending.length; pi++) {
          var pop = snap.syncPending[pi];
          if (pop && pop.type && (pop.type === 'move' || pop.type === 'npc')) {
            SYNC_OPS[snap.account] = { seq: ++SYNC_SEQ, op: pop, ts: Date.now() };
          }
        }
      }
      // 同步器：本窗口是从号时，上报已执行的最大 seq（确认，防重复下发）
      var acked = (typeof snap.syncAcked === 'number') ? snap.syncAcked : 0;
      // 取给本账号的最新未确认广播（其他账号发来的，seq > 已确认）
      var sync = null, keys = Object.keys(SYNC_OPS);
      for (var si = 0; si < keys.length; si++) {
        var from = keys[si], b = SYNC_OPS[from];
        if (from === snap.account) continue; // 自己广播的不回给自己
        if (!b || !b.op) continue;
        if (b.seq <= acked) continue;         // 已确认过
        if (!sync || b.seq > sync.seq) sync = { seq: b.seq, from: from, op: b.op };
      }
      json(res, 200, { ok: true, ts: snap._serverTs, sync: sync, hurry: !!sync });
    });
    return;
  }

  // 总页面轮询：GET /api/acct/state
  if (url === '/api/acct/state') {
    var now = Date.now(), keys = Object.keys(ACCOUNTS), changed = false;
    var list = [];
    for (var i = 0; i < keys.length; i++) {
      var a = ACCOUNTS[keys[i]];
      if (!a || !a._serverTs || now - a._serverTs > CLEAN_MS) { delete ACCOUNTS[keys[i]]; changed = true; continue; }
      list.push(a);
    }
    if (changed) saveState();
    var sv = {};
    for (var si2 = 0; si2 < ACCOUNT_LIST.length; si2++) {
      var acc = ACCOUNT_LIST[si2];
      if (acc && acc.userid) sv[acc.userid] = SERVER_ONLINE[acc.userid] || null;
    }
    json(res, 200, { ts: now, accounts: list, serverOnline: sv });
    return;
  }

  // 服务端在线验证结果（直读）：GET /api/acct/server-online
  if (url === '/api/acct/server-online') {
    json(res, 200, { ts: Date.now(), online: SERVER_ONLINE });
    return;
  }

  // 账号配置：GET 列表（掩码密码）/ POST 保存（密码留空=保留原密码）
  if (url === '/api/acct/accounts') {
    if (req.method === 'GET') {
      var masked = ACCOUNT_LIST.map(function (a) {
        return { userid: a.userid, note: a.note || '', nid: a.nid || 5, enabled: a.enabled !== false, hasPass: !!(a.passwd && a.passwd.length) };
      });
      json(res, 200, { accounts: masked });
      return;
    }
    if (req.method === 'POST') {
      readBody(req, function (body) {
        var data = null;
        try { data = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
        var list = Array.isArray(data) ? data : (data && Array.isArray(data.accounts) ? data.accounts : null);
        if (!list) { json(res, 400, { ok: false, err: 'need accounts array' }); return; }
        var seen = {}, out = [];
        for (var ai = 0; ai < list.length; ai++) {
          var a = list[ai];
          var uid = a && typeof a.userid === 'string' ? a.userid.trim() : '';
          if (!uid || seen[uid]) continue;              // 去空去重
          seen[uid] = true;
          var old = null;
          for (var oi = 0; oi < ACCOUNT_LIST.length; oi++) { if (ACCOUNT_LIST[oi].userid === uid) { old = ACCOUNT_LIST[oi]; break; } }
          var pwd = typeof a.passwd === 'string' ? a.passwd : '';
          if (!pwd && old && old.passwd) pwd = old.passwd;   // 留空保留原密码
          if (!pwd && !old) continue;                          // 新行必须带密码
          out.push({
            userid: uid,
            passwd: pwd,
            note: (a && a.note) || (old && old.note) || '',
            nid: (a && a.nid) || (old && old.nid) || 5,
            enabled: a ? (a.enabled !== false) : true
          });
        }
        ACCOUNT_LIST = out;
        saveAccounts();
        // 立即刷新这些账号的服务端在线验证（并清理已删除账号的缓存）
        var nowKeys = {};
        out.forEach(function (x) { nowKeys[x.userid] = true; });
        Object.keys(SERVER_ONLINE).forEach(function (k) { if (!nowKeys[k]) delete SERVER_ONLINE[k]; });
        out.filter(function (x) { return x.enabled; }).forEach(function (x) {
          mnSearch(x.userid, x.passwd, x.nid).then(function (r) { SERVER_ONLINE[x.userid] = r; r._ts = Date.now(); });
        });
        json(res, 200, { ok: true, count: out.length });
      });
      return;
    }
    json(res, 405, { ok: false, err: 'method' });
    return;
  }

  // 仓库跨端口同步（V2.16.2）：POST /api/inv/save 按账号保存仓库+背包，GET /api/inv/get?account= 拉取
  // 数据落盘 diag-collect/inv-sync.json：{ account: { accountName, storage, characters, _ts } }
  var INV_FILE = path.join(DIR, 'inv-sync.json');
  function loadInvSync() { try { return JSON.parse(fs.readFileSync(INV_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
  function saveInvSync(d) { try { fs.writeFileSync(INV_FILE, JSON.stringify(d)); } catch (e) {} }
  if (url === '/api/inv/save' && req.method === 'POST') {
    readBody(req, function (body) {
      var snap = null;
      try { snap = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      if (!snap || !snap.account) { json(res, 400, { ok: false, err: 'no account' }); return; }
      var db = loadInvSync();
      var cur = db[snap.account] || { accountName: snap.account, storage: null, characters: {} };
      if (snap.storage && snap.storage.lastUpdate) cur.storage = snap.storage;
      if (snap.characters && typeof snap.characters === 'object') {
        cur.characters = cur.characters || {};
        Object.keys(snap.characters).forEach(function (cn) {
          var nc = snap.characters[cn];
          if (nc && nc.lastUpdate) {
            var oc = cur.characters[cn];
            if (!oc || nc.lastUpdate >= oc.lastUpdate) cur.characters[cn] = nc;
          }
        });
      }
      cur._ts = Date.now();
      db[snap.account] = cur;
      saveInvSync(db);
      json(res, 200, { ok: true, account: snap.account });
    });
    return;
  }
  if (url === '/api/inv/clear' && req.method === 'POST') {
    readBody(req, function (body) {
      var snap = null;
      try { snap = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      var db3 = loadInvSync();
      if (snap && snap.account && db3[snap.account]) { delete db3[snap.account]; saveInvSync(db3); }
      json(res, 200, { ok: true });
    });
    return;
  }
  if (url === '/api/inv/get' && req.method === 'GET') {
    var q = require('url').parse(req.url, true).query;
    var db2 = loadInvSync();
    if (q.account) {
      json(res, 200, { ok: true, account: q.account, data: db2[q.account] || null });
    } else {
      json(res, 200, { ok: true, accounts: Object.keys(db2) });
    }
    return;
  }

  // ================= 无头端控制台（阶段 1：中枢侧）=================
  // 节点 = 浏览器端(ro-assist) 或 无头端(test-p24.mjs)，统一「上报 + 取指令」。
  // 指令队列：每个节点只保留最新一条未确认指令（和 SYNC_OPS 同一套思路，用 seq 确认防重复）。
  // 落盘全部在仓库外 diag-collect/（只存本机，不进公开仓库）。
  // 状态变量一律在模块作用域声明（见上方「无头端控制台状态」）——
  // 写在这个请求处理函数里会变成「每个请求重建一次」，队列和事件流会立刻丢。
  function saveNodes() { try { fs.writeFileSync(NODES_FILE, JSON.stringify(NODES)); } catch (e) {} }
  function ev(lv, nodeId, msg) {
    var e = { t: Date.now(), lv: lv || 'info', node: nodeId || '', msg: String(msg == null ? '' : msg) };
    EVENTS.push(e);
    if (EVENTS.length > 500) EVENTS.splice(0, EVENTS.length - 500);
    try { fs.appendFileSync(EVENT_FILE, JSON.stringify(e) + '\n'); } catch (e2) {}
  }
  // 脚本库默认种子（只在文件不存在时写入；之后一律读本地文件）
  // 脚本格式与 ro-assist 脚本执行器完全一致：{ templateId, version, name, desc, steps[] }
  // 每步：{ action, params, arrive?, until?, timeoutMs?, retry?, onFail? }
  // action 白名单：teleport / walk / battleOn / battleOff / useItem / stopMove / check / talk / loop / ifWeight / store
  // 条件 until / loop.until（两类，AND）：
  //   物品类 { item:ID | items:[] | range:[lo,hi] | keyword:"卡片" | class:"card", count:N, mode:"any|all", dropOnly:true }
  //   杀怪类 { kill:"怪名" | killId:GID | killAny:N, killCount:N }
  //   辅助   { weight:80, zeny:N, time:秒 }
  // 官方 ITID 类别：potion 501-699 / etc 700-999 / weapon 1100-1749 / ammo 1750-1799 /
  //                armor 2100-2699 / card 4001-4999 / pet 5000-5999 / material 7000-7999 / cash 10000+
  var SCRIPT_SEED = [
    { templateId: "farm_item", version: 1, name: "自动刷指定物品", desc: "传送到指定地图刷怪，凑够指定物品就回城存仓", killNearby: false,
      steps: [
        { action: "teleport", params: { map: "moc_fild16" }, arrive: { map: "moc_fild16" }, timeoutMs: 30000, retry: 1, onFail: "stop" },
        { action: "walk", params: { x: 212, y: 88 }, arrive: { x: 212, y: 88, dist: 2 }, timeoutMs: 30000, retry: 2, onFail: "stop" },
        { action: "battleOn", params: {} },
        { action: "loop", params: { back: 3, maxLoops: 200, until: { "class": "material", count: 30, dropOnly: true } } },
        { action: "battleOff", params: {} },
        { action: "ifWeight", params: { over: 80, goto: 7 } },
        { action: "walk", params: { x: 120, y: 70 }, arrive: { x: 120, y: 70, dist: 2 }, timeoutMs: 30000, retry: 2, onFail: "skip" },
        { action: "teleport", params: { map: "geffen" }, arrive: { map: "geffen" }, timeoutMs: 30000, retry: 1, onFail: "skip" },
        { action: "store", params: { "class": "material" } }
      ] },
    { templateId: "farm_kill", version: 1, name: "自动刷指定怪", desc: "按杀怪数量判断，杀够指定怪就停（只算自己打死的）",
      steps: [
        { action: "teleport", params: { map: "moc_fild16" }, arrive: { map: "moc_fild16" }, timeoutMs: 30000, retry: 1, onFail: "stop" },
        { action: "walk", params: { x: 212, y: 88 }, arrive: { x: 212, y: 88, dist: 2 }, timeoutMs: 30000, retry: 2, onFail: "stop" },
        { action: "battleOn", params: {} },
        { action: "loop", params: { back: 3, maxLoops: 500, until: { kill: "沙漠幼狼", killCount: 50 } } },
        { action: "battleOff", params: {} }
      ] },
    { templateId: "bounty_gef", version: 1, name: "自动做赏金任务", desc: "吉芬赏金猎人：接任务 → 打怪 → 回城交付，循环",
      steps: [
        { action: "teleport", params: { map: "geffen" }, arrive: { map: "geffen" }, timeoutMs: 30000, retry: 1, onFail: "stop" },
        { action: "walk", params: { x: 124, y: 73 }, arrive: { x: 124, y: 73, dist: 3 }, timeoutMs: 30000, retry: 2, onFail: "stop" },
        { action: "talk", params: { npc: "赏金猎人#gef" }, timeoutMs: 8000, retry: 2, onFail: "stop" },
        { action: "check", params: {}, until: { time: 3 } },
        { action: "loop", params: { back: 3, maxLoops: 60, until: { item: 7054, count: 10, dropOnly: true } } },
        { action: "talk", params: { npc: "赏金猎人#gef" }, timeoutMs: 8000, retry: 2, onFail: "skip" }
      ] },
    { templateId: "move_item", version: 1, name: "自动转移物品", desc: "把指定物品从本角色转到仓库（先打开仓库窗口）",
      steps: [
        { action: "check", params: {}, until: { item: 7054, count: 1 } },
        { action: "store", params: { item: 7054, count: 10 } },
        { action: "check", params: {}, until: { time: 2 } },
        { action: "loop", params: { back: 1, maxLoops: 50, until: { item: 7054, count: 0 } } }
      ] }
  ];
  function loadScripts() {
    var t = null;
    try { t = fs.readFileSync(SCRIPTS_FILE, 'utf8'); } catch (e) { t = null; }
    if (t == null) {
      try { fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(SCRIPT_SEED, null, 1)); } catch (e) {}
      return SCRIPT_SEED;
    }
    try { return JSON.parse(t) || []; } catch (e) { return []; }
  }
  function saveScripts(list) { try { fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(list, null, 1)); } catch (e) {} }

  // 节点上报 + 取指令：POST /api/node/report
  // body: { node:{id,kind,account,char,map,x,y,hp,mhp,sp,msp,wt,mwt,zeny,script,step,msg}, acked:12 }
  if (url === '/api/node/report' && req.method === 'POST') {
    readBody(req, function (body) {
      var d = null;
      try { d = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      var n = d && d.node;
      if (!n || !n.id) { json(res, 400, { ok: false, err: 'need node.id' }); return; }
      n._ts = Date.now();
      var isNew = !NODES[n.id];
      NODES[n.id] = n;
      saveNodes();
      if (isNew) ev('info', n.id, '节点上线 ' + (n.account || '') + ' / ' + (n.char || ''));
      var acked = (typeof d.acked === 'number') ? d.acked : 0;
      var c = CMDS[n.id];
      var out = null;
      if (c && c.seq > acked) out = { seq: c.seq, cmd: c.cmd };
      else if (c) { delete CMDS[n.id]; }
      json(res, 200, { ok: true, ts: n._ts, cmd: out });
    });
    return;
  }

  // 面板读节点表：GET /api/node/state
  if (url === '/api/node/state') {
    var nowN = Date.now(), kk = Object.keys(NODES), lst = [], ch = false;
    for (var ni = 0; ni < kk.length; ni++) {
      var nn = NODES[kk[ni]];
      if (!nn || !nn._ts || nowN - nn._ts > 24 * 3600 * 1000) { delete NODES[kk[ni]]; ch = true; continue; }
      lst.push(nn);
    }
    if (ch) saveNodes();
    json(res, 200, { ts: nowN, nodes: lst, cmds: CMDS });
    return;
  }

  // 下发指令：POST /api/cmd   body: { node:'h1', cmd:{ do:'run', script:'bounty' } }
  if (url === '/api/cmd' && req.method === 'POST') {
    readBody(req, function (body) {
      var d2 = null;
      try { d2 = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      if (!d2 || !d2.node || !d2.cmd) { json(res, 400, { ok: false, err: 'need node + cmd' }); return; }
      var seq = ++CMD_SEQ;
      CMDS[d2.node] = { seq: seq, cmd: d2.cmd, ts: Date.now() };
      ev('cmd', d2.node, '下发 ' + JSON.stringify(d2.cmd));
      json(res, 200, { ok: true, seq: seq });
    });
    return;
  }

  // 指令结果回执：POST /api/cmd/ack   body: { node:'h1', seq:12, ok:true, msg:'...' }
  if (url === '/api/cmd/ack' && req.method === 'POST') {
    readBody(req, function (body) {
      var d3 = null;
      try { d3 = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
      if (!d3 || !d3.node) { json(res, 400, { ok: false, err: 'need node' }); return; }
      var c3 = CMDS[d3.node];
      if (c3 && (!d3.seq || c3.seq <= d3.seq)) delete CMDS[d3.node];
      ev(d3.ok === false ? 'err' : 'ok', d3.node, (d3.ok === false ? '执行失败: ' : '执行完成: ') + (d3.msg || ''));
      json(res, 200, { ok: true });
    });
    return;
  }

  // 事件流：GET /api/events?since=<ts>
  if (url === '/api/events') {
    var qs = require('url').parse(req.url, true).query;
    var since = parseInt(qs.since || '0', 10) || 0;
    json(res, 200, { ts: Date.now(), events: EVENTS.filter(function (e4) { return e4.t > since; }) });
    return;
  }

  // 脚本库：GET 读取 / POST 覆盖保存
  if (url === '/api/script') {
    if (req.method === 'GET') { json(res, 200, { ok: true, scripts: loadScripts() }); return; }
    if (req.method === 'POST') {
      readBody(req, function (body) {
        var d4 = null;
        try { d4 = JSON.parse(body); } catch (e) { json(res, 400, { ok: false, err: 'bad json' }); return; }
        var list4 = Array.isArray(d4) ? d4 : (d4 && Array.isArray(d4.scripts) ? d4.scripts : null);
        if (!list4) { json(res, 400, { ok: false, err: 'need scripts array' }); return; }
        saveScripts(list4);
        ev('info', '', '脚本库已保存（' + list4.length + ' 个）');
        json(res, 200, { ok: true, count: list4.length });
      });
      return;
    }
    json(res, 405, { ok: false, err: 'method' });
    return;
  }

  // 面板页：GET /panel
  if (url === '/panel' || url === '/panel/') {
    var pg = null;
    try { pg = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8'); } catch (e) { pg = null; }
    if (!pg) pg = '<!doctype html><html lang="zh-CN"><body><h1>缺少 tools/panel.html</h1></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pg);
    return;
  }

  // 总页面：GET /acct
  if (url === '/acct') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ACCT_PAGE);
    return;
  }

  // 原有宽松行为：其余一切 POST 都落盘 collect.log + p-ts.json（ro-detect 探针回传等）
  readBody(req, function (body) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.appendFileSync(path.join(DIR, 'collect.log'), ts + ' ' + body + '\n'); } catch (e) {}
    try { fs.writeFileSync(path.join(DIR, 'p-' + ts + '.json'), body); } catch (e) {}
    json(res, 200, { ok: true });
  });
});
server.on('error', function (e) { console.error('server error:', e.message); });
server.listen(8899, function () {
  console.log('diag-collect listening on 8899, dir=' + DIR + ' (accounts=' + Object.keys(ACCOUNTS).length + ')');
});