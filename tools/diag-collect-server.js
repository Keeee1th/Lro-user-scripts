// diag-collect 接收服务：检测插件(ro-detect)回传日志落盘 + 多账号平台中心（账号状态表 + 总页面 + 同步器）
// 用法: node tools/diag-collect-server.js （监听 8899）
// 多账号平台路由：
//   POST /api/acct/report  节点(ro-assist)上报角色状态+同步操作 → 更新状态表并落盘，响应带回待执行广播
//   GET  /api/acct/state   总页面轮询读取全表（在线=60s 内有上报；24h 无上报自动清理）
//   GET  /acct             总页面（只读总览，页面在 tools/acct-page.html）
var http = require('http');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', '..', 'diag-collect'); // 工作区根 D:/0_Harness/1_RObot/diag-collect（仓库外）
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

var STATE_FILE = path.join(DIR, 'acct-state.json');
var ONLINE_MS = 60 * 1000;        // 60s 无上报 → 离线
var CLEAN_MS = 24 * 3600 * 1000;  // 24h 无上报 → 清理出表

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
    json(res, 200, { ts: now, accounts: list });
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