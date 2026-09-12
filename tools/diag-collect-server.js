// diag-collect 接收服务：检测插件(ro-detect)回传日志落盘 + 多账号平台中心（账号状态表 + 总页面）
// 用法: node tools/diag-collect-server.js （监听 8899）
// 多账号平台路由：
//   POST /api/acct/report  节点(ro-assist)每 15s 上报角色状态 → 更新状态表并落盘 acct-state.json
//   GET  /api/acct/state   总页面轮询读取全表（在线=60s 内有上报；24h 无上报自动清理）
//   GET  /acct             总页面（只读总览）
var http = require('http');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', '..', 'diag-collect'); // 工作区根 D:/0_Harness/1_RObot/diag-collect（仓库外）
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

var STATE_FILE = path.join(DIR, 'acct-state.json');
var ONLINE_MS = 60 * 1000;        // 60s 无上报 → 离线
var CLEAN_MS = 24 * 3600 * 1000;  // 24h 无上报 → 清理出表

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

// ---------------- 总页面 /acct（只读总览）----------------
var ACCT_PAGE = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>多账号状态总览</title>',
  '<style>',
  '  * { box-sizing: border-box; }',
  '  body { margin: 0; padding: 20px; background: #10151c; color: #dbe4ee; font: 13px/1.6 "Microsoft YaHei", system-ui, sans-serif; }',
  '  h1 { font-size: 18px; margin: 0 0 4px; color: #7fd1ff; }',
  '  .sub { color: #7a8794; font-size: 12px; margin-bottom: 16px; }',
  '  .wrap { overflow-x: auto; background: #171e27; border: 1px solid #26313d; border-radius: 8px; }',
  '  table { border-collapse: collapse; width: 100%; min-width: 980px; }',
  '  th, td { padding: 7px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid #222c37; }',
  '  th { background: #1c2530; color: #9fb3c8; font-weight: 600; position: sticky; top: 0; }',
  '  tr:last-child td { border-bottom: none; }',
  '  .off td { color: #5d6875; opacity: .75; }',
  '  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; margin-right: 6px; }',
  '  .tag.on { background: #12351f; color: #5fd68a; }',
  '  .tag.off { background: #2b3138; color: #7d8894; }',
  '  .ts { color: #5d6875; font-size: 11px; }',
  '  .empty { padding: 30px; text-align: center; color: #5d6875; }',
  '  .foot { margin-top: 10px; color: #5d6875; font-size: 11px; }',
  '</style>',
  '</head>',
  '<body>',
  '<h1>多账号状态总览</h1>',
  '<div class="sub">各游戏窗口每 15s 自动上报 · 60s 无上报显示离线 · 24h 无上报自动清理</div>',
  '<div class="wrap"><div class="empty" id="box">等待节点上报…</div></div>',
  '<div class="foot" id="foot"></div>',
  '<script>',
  'var ONLINE_MS = 60000;',
  'function esc(s){ return String(s == null ? "" : s).replace(/[&<>"\']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[c]; }); }',
  'function fmtTime(ts){ if (!ts) return "—"; var d = new Date(ts); function p(n){ return (n<10?"0":"")+n; } return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }',
  'function weightPct(w, mw){ if (w == null || !mw) return "—"; return Math.round(w/mw*100)+"% ("+w+"/"+mw+")"; }',
  'function load(){',
  '  fetch("/api/acct/state").then(function(r){ return r.json(); }).then(function(data){',
  '    var now = Date.now();',
  '    var list = (data && data.accounts) || [];',
  '    var box = document.getElementById("box");',
  '    if (!list.length){ box.className = "empty"; box.textContent = "暂无账号上报 —— 请确认游戏窗口已登录且助手已开启"; document.getElementById("foot").textContent=""; return; }',
  '    list.sort(function(a,b){ var oa = now-(a._serverTs||0)<=ONLINE_MS?0:1, ob = now-(b._serverTs||0)<=ONLINE_MS?0:1; if (oa!==ob) return oa-ob; return String(a.account).localeCompare(String(b.account)); });',
  '    var rows = list.map(function(a){',
  '      var online = now - (a._serverTs||0) <= ONLINE_MS;',
  '      var st = a.stat || {};',
  '      return "<tr class=\""+(online?"on":"off")+"\">" +',
  '        "<td><span class=\"tag "+(online?"on":"off")+"\">"+(online?"在线":"离线")+"</span>"+esc(a.account)+"</td>" +',
  '        "<td>"+esc(st.name||"—")+"</td>" +',
  '        "<td>"+esc(st.job||"—")+"</td>" +',
  '        "<td>"+esc(st.map||"—")+"</td>" +',
  '        "<td>"+((a.x!=null&&a.y!=null)?(a.x+","+a.y):"—")+"</td>" +',
  '        "<td>"+((st.lv!=null)?st.lv:"—")+"</td>" +',
  '        "<td>"+((st.hp!=null)?(st.hp+"/"+(st.maxhp!=null?st.maxhp:"?")):"—")+"</td>" +',
  '        "<td>"+((st.sp!=null)?(st.sp+"/"+(st.maxsp!=null?st.maxsp:"?")):"—")+"</td>" +',
  '        "<td>"+weightPct(st.weight, st.maxWeight)+"</td>" +',
  '        "<td>"+esc(a.line||"—")+"</td>" +',
  '        "<td>"+esc(a.task||"—")+"</td>" +',
  '        "<td class=\"ts\">"+fmtTime(a._serverTs)+"</td>" +',
  '        "</tr>";',
  '    }).join("");',
  '    box.className = "";',
  '    box.innerHTML = "<table><thead><tr><th>账号</th><th>角色</th><th>职业</th><th>地图</th><th>坐标</th><th>等级</th><th>HP</th><th>SP</th><th>负重</th><th>线路</th><th>当前任务</th><th>上报时间</th></tr></thead><tbody>" + rows + "</tbody></table>";',
  '    var on = list.filter(function(a){ return now-(a._serverTs||0)<=ONLINE_MS; }).length;',
  '    document.getElementById("foot").textContent = "共 " + list.length + " 个账号 · 在线 " + on + " · 刷新于 " + fmtTime(now);',
  '  }).catch(function(){});',
  '}',
  'load();',
  'setInterval(load, 5000);',
  '</script>',
  '</body>',
  '</html>'
].join('\n');

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
      json(res, 200, { ok: true, ts: snap._serverTs });
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