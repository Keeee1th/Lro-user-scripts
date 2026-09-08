// diag-collect 接收服务：检测插件(ro-detect)回传日志落盘，DSH 自取验证
// 用法: node tools/diag-collect-server.js （监听 8899）
var http = require('http');
var fs = require('fs');
var path = require('path');

var DIR = path.join(__dirname, '..', '..', 'diag-collect'); // 工作区根 D:/0_Harness/1_RObot/diag-collect（仓库外）
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}

var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var body = Buffer.concat(chunks).toString('utf8');
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.appendFileSync(path.join(DIR, 'collect.log'), ts + ' ' + body + '\n'); } catch (e) {}
    try { fs.writeFileSync(path.join(DIR, 'p-' + ts + '.json'), body); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
server.on('error', function (e) { console.error('server error:', e.message); });
server.listen(8899, function () { console.log('diag-collect listening on 8899, dir=' + DIR); });
