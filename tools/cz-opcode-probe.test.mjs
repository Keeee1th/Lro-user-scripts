import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const assist = fs.readFileSync(new URL('../ro-assist.user.js', import.meta.url), 'utf8');

function between(src, a, b) {
  const x = src.indexOf(a), y = src.indexOf(b, x);
  assert.ok(x >= 0 && y > x, 'anchor not found: ' + a);
  return src.slice(x, y);
}
// V2.38.0 的 CZ 包体探测模块（clientReady 之后、getMapName 之前）
const PROBE_SRC = between(assist, '  // ===== CZ-PROBE-BEGIN', '\n  function getMapName() {');

// ---- 假 BinaryWriter / 假 PacketStructure（口径与真客户端一致：旧类走版本表，*2 类硬编码）----
function makeWriter(buf) {
  const ab = new ArrayBuffer(64);
  return {
    buffer: ab, byteOffset: 0,
    view: new DataView(ab),
    writeShort(v) { new DataView(ab).setUint16(0, v, true); this._op = v; },
    build() { return this; },
  };
}
function legacy(op, len) {
  function C() {}
  C.prototype.versions = [[20180307, op, len, 2]];
  // 真客户端 getPacketVersion：取最后一个 date <= packetver 的条目。
  // packetver=20211103 >= 20180307，而这张表最后一项就是 20180307 → 恒返回它（这正是错版根因）。
  C.prototype.getPacketVersion = function () {
    const vs = this.versions;
    let i;
    for (i = 0; i < vs.length - 1; ++i) if (20211103 < vs[i + 1][0]) return vs[i];
    return vs[i];
  };
  C.prototype.build = function () {
    const w = makeWriter();
    const v = this.getPacketVersion();
    w.writeShort(v[1]);
    return w;
  };
  return C;
}
function modern(op, len) {
  function C() {}
  C.prototype.build = function () { const w = makeWriter(); w.writeShort(op); return w; }; // *2 类：硬编码，无 getPacketVersion
  return C;
}

function harness(NS, opt) {
  const o = opt || {};
  const ctx = {
    window: { ROConfig: { servers: [{ packetver: o.packetver == null ? 20211103 : o.packetver }] }, require: null },
    CLIENT: { PS: { CZ: NS }, NM: { sendPacket() {} } },
    VER: '2.38.0',
    Object, Uint8Array, Number, Date, Math, String, JSON, console,
    setInterval: () => 0, clearInterval: () => {},
    status: [], logs: [],
    setStatus(t, c) { ctx.status.push([t, c]); },
    tlog(t) { ctx.logs.push(t); },
    $id() { return null; },
  };
  ctx.clientReady = () => (o.ready === false ? false : true);
  vm.createContext(ctx);
  vm.runInContext(PROBE_SRC + '\n;globalThis.__api = { czResolve, czSelfCheck, czp, czOpcodeBoth, czReportText, czPacketVer, CZ_WANT, CZ_PROBE };', ctx);
  return { ctx, api: ctx.__api, NS };
}

// 本服 packetver=20211103 的 CZ 表（headless/cz-20211103.json）
const SERVER = { REQUEST_MOVE: 863, REQUEST_ACT: 1079, USE_SKILL: 1080, ITEM_PICKUP: 866, ITEM_THROW: 867, MOVE_ITEM_FROM_BODY_TO_STORE: 868 };
const LEGACY_WRONG = { REQUEST_MOVE: 2167, REQUEST_ACT: 2409, USE_SKILL: 2195, ITEM_PICKUP: 2388, ITEM_THROW: 1079, MOVE_ITEM_FROM_BODY_TO_STORE: 2336 };

test('探测：旧类名 opcode 错版时，按期望 opcode 挑中 *2 类并就地安装', () => {
  const NS = {
    REQUEST_MOVE: legacy(2167, 5), REQUEST_MOVE2: modern(863, 5),
    REQUEST_ACT: legacy(2409, 7), REQUEST_ACT2: modern(1079, 7),
    USE_SKILL: legacy(2195, 10), USE_SKILL2: modern(1080, 10),
    ITEM_PICKUP: legacy(2388, 6), ITEM_PICKUP2: modern(866, 6),
    ITEM_THROW: legacy(1079, 6), ITEM_THROW2: modern(867, 6),
    MOVE_ITEM_FROM_BODY_TO_STORE: legacy(2336, 8), MOVE_ITEM_FROM_BODY_TO_STORE2: modern(868, 8),
  };
  const { api, NS: ns } = harness(NS);
  const r = api.czResolve();
  assert.equal(r.ok, true, '六个错版包都必须探测成功');
  assert.equal(r.replay.length, 0, '能探到 *2 类就不该走覆写兜底');
  for (const [name, want] of Object.entries(SERVER)) {
    assert.equal(r.resolved[name], ns[name + '2'], name + ' 必须选中 *2 类');
    assert.equal(api.czp(name), ns[name + '2'], name + ' 必须经 czp 返回已核验类');
  }
  assert.equal(ns.REQUEST_MOVE, ns.REQUEST_MOVE2, '旧名必须被就地改写为正确的类');
  assert.equal(ns.REQUEST_ACT, ns.REQUEST_ACT2);
  assert.equal(ns.USE_SKILL, ns.USE_SKILL2);
  assert.equal(ns.ITEM_THROW, ns.ITEM_THROW2, 'ITEM_THROW 旧版实发 1079(=REQUEST_ACT) 必须纠正');
  assert.equal(r.installed.length, 6);
});

test('探测：没有 *2 类时退路=按版本元组覆写旧类 prototype.versions，并登记需重放', () => {
  const NS = {};
  for (const [n, op] of Object.entries(LEGACY_WRONG)) NS[n] = legacy(op, 5);
  const { api, NS: ns } = harness(NS);
  const r = api.czResolve();
  assert.equal(r.ok, true);
  assert.deepEqual(Array.from(r.replay).sort(), Object.keys(SERVER).sort(), '六个类都要走覆写兜底');
  for (const [name, want] of Object.entries(SERVER)) {
    assert.deepEqual(ns[name].prototype.versions, api.CZ_WANT[name].ver, name + ' 版本元组必须被覆写');
    assert.equal(api.czOpcodeBoth(ns[name]).bytes, want, name + ' 覆写后实发 opcode 必须等于本服期望值');
    assert.equal(Array.from(r.rows).find((x) => x.name === name).way, 'override');
  }
});

test('探测：期望 opcode 拿不到且无旧类 → 明确失败（不静默），miss 列出包名', () => {
  const NS = { REQUEST_MOVE: legacy(2167, 5), REQUEST_MOVE2: modern(863, 5) }; // 其余全缺
  const { api } = harness(NS);
  const r = api.czResolve();
  assert.equal(r.ok, false);
  assert.equal(Array.from(r.miss).length, 5);
  assert.match(r.why, /探测不到本服 opcode/);
  assert.match(r.why, /REQUEST_ACT/);
});

test('探测：客户端未就绪 → 失败并给出人话原因', () => {
  const { api } = harness({}, { ready: false });
  const r = api.czResolve();
  assert.equal(r.ok, false);
  assert.match(r.why, /客户端未就绪/);
});

test('自检：通过时 brief 里带全部实测 opcode；失败时给出可读原因', () => {
  const good = {};
  for (const [n, op] of Object.entries(LEGACY_WRONG)) { good[n] = legacy(op, 5); good[n + '2'] = modern(SERVER[n], 5); }
  good.WHISPER = modern(150, 29);
  const A = harness(good);
  const ok = A.api.czSelfCheck();
  assert.equal(ok.ok, true);
  for (const op of Object.values(SERVER)) assert.ok(ok.brief.includes(String(op)), 'brief 必须报出 ' + op);
  assert.deepEqual(Array.from(A.api.CZ_PROBE.replay), [], '能探到就不得走兜底');
  assert.ok(ok.brief.includes('WHISPER=150'));
  assert.ok(ok.text.includes('packetver=20211103'));

  const B = harness({ WHISPER: modern(150, 29) }); // 一个关键包都没有
  const bad = B.api.czSelfCheck();
  assert.equal(bad.ok, false);
  assert.ok(bad.brief.length > 0 && bad.text.includes('自检未通过'));
});

test('自检：实发字节与期望不符 → 拒绝（即使 getPacketVersion 口径说对）', () => {
  // 坏类：版本表报 863，字节流里写 2167（伪造口径不一致）
  function liar() {}
  liar.prototype.versions = [[20180307, 863, 5, 2]];
  liar.prototype.getPacketVersion = function () { return this.versions[0]; };
  liar.prototype.build = function () { const w = makeWriter(); w.writeShort(2167); return w; };
  const NS = { REQUEST_MOVE: liar, REQUEST_MOVE2: liar };
  for (const [n, op] of Object.entries(LEGACY_WRONG)) if (n !== 'REQUEST_MOVE') { NS[n] = legacy(op, 5); NS[n + '2'] = modern(SERVER[n], 5); }
  const { api } = harness(NS);
  const r = api.czResolve();
  assert.equal(r.ok, false, '字节口径才是真相：版本口径说对也必须拒绝');
  assert.ok(r.miss.includes('REQUEST_MOVE'));
});

test('门禁：startZhu 在自检未通过时拒绝启动（不 startScan / zRunning 保持 false / 报错给人话）', () => {
  const src = between(assist, '  function startZhu() {', '  function stopZhu() {');
  const calls = { scan: 0, status: [], logs: [], text: null };
  const ctx = {
    zRunning: false,
    externalAutomationOwns: () => false,
    czSelfCheck: () => ({ ok: false, brief: '探测不到本服 opcode：REQUEST_MOVE', text: '' }),
    czRenderLine() {},
    startScan() { calls.scan++; },
    $id: () => ({ set textContent(v) { calls.text = v; }, get textContent() { return calls.text; }, value: '' }),
    setStatus(t, c) { calls.status.push([t, c]); },
    tlog(t) { calls.logs.push(t); },
    Math, Date, parseFloat, setInterval: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__start = startZhu;', ctx);
  ctx.__start();
  assert.equal(ctx.zRunning, false, '自检未通过绝不允许把 zRunning 置真');
  assert.equal(calls.scan, 0, '自检未通过不得开始扫描/发包');
  assert.equal(calls.status.length, 1);
  assert.equal(calls.status[0][1], 'err');
  assert.match(calls.status[0][0], /^拒绝启动助手模式：/);
  assert.equal(calls.text, '助手未启动（包体自检未通过）');
  assert.ok(calls.logs.some((l) => l.startsWith('zhu-refuse')));
});

test('门禁：自检通过时正常启动，且成功状态里带上实测 opcode', () => {
  const src = between(assist, '  function startZhu() {', '  function stopZhu() {');
  const calls = { scan: 0, status: [], text: null };
  const ctx = {
    zRunning: false,
    externalAutomationOwns: () => false,
    czSelfCheck: () => ({ ok: true, brief: '移动=863 攻击=1079 技能=1080 拾取=866 丢弃=867 存仓=868 WHISPER=150', text: '' }),
    czRenderLine() {},
    startScan() { calls.scan++; },
    npHuntMode: () => 'off', isHybrid: () => false,
    npCalibrate() {}, npSyncTargets() {}, npReadPanelState: () => null, dshDiag() {},
    getMapName: () => 'prontera',
    CLIENT: { SS: { Entity: { position: [10, 20] } } },
    zLock: {}, zMon: {}, zWalkState: {}, zUseCounts: {}, zLockCounts: {},
    $id: (id) => ({ id, value: '0.25', set textContent(v) { calls.text = v; }, get textContent() { return calls.text; } }),
    setStatus(t, c) { calls.status.push([t, c]); },
    zAttack: () => {}, tlog() {}, Math, Date, parseFloat, setInterval: () => 7,
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__start = startZhu;', ctx);
  ctx.__start();
  assert.equal(ctx.zRunning, true);
  assert.equal(calls.scan, 1);
  const okMsg = calls.status.find((s) => s[1] === 'ok');
  assert.ok(okMsg, '必须有 ok 状态');
  assert.ok(okMsg[0].includes('移动=863') && okMsg[0].includes('技能=1080'), '状态栏必须显示实测 opcode：' + okMsg[0]);
});

test('czp：客户端未就绪/类缺失时不抛异常（调用点安全）', () => {
  const { ctx, api } = harness({});
  assert.equal(api.czp('REQUEST_MOVE'), undefined);
  ctx.CLIENT.PS.CZ = null;
  assert.equal(api.czp('REQUEST_MOVE'), null);
  ctx.CLIENT.PS = null;
  assert.equal(api.czp('REQUEST_MOVE'), null);
  assert.equal(api.czp('NOT_IN_TABLE'), null, 'CLIENT.PS 都没了也不得抛异常');
});
