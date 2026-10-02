// V2.38.6 手机端「身份门 + char_id 包流 + 中继 fail-closed」专项测试
//   运行：node --test tools/mobile-identity-gear.test.mjs
//   口径：未识别（selfCharId()<=0）= 只读不写；未识别期间的界面改动进内存缓冲，身份到位后沿 onCharChanged
//   自愈切档并回填；换图 / 重登 / socket 重建 → 缓冲整份作废（宁丢不错）。char_id 从入站包 113/2757 的 GID 字段补。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = [
  ['stable', fs.readFileSync(path.join(here, '..', 'ro-assist.user.js'), 'utf8')],
  ['exp', fs.readFileSync(path.join(here, '..', 'ro-assist-exp.user.js'), 'utf8')],
];
const lfSrc = (s) => s.replace(/\r\n/g, '\n');
function cut(s, a, b) {
  const t = lfSrc(s);
  const i = t.indexOf(a), j = t.indexOf(b, i);
  assert.ok(i >= 0 && j > i, '切不出来: ' + a + ' → ' + b);
  return t.slice(i, j);
}
// 切片：档案核心（含身份门新原语）/ 老档认领 / onCharChanged（含回填）/ 入站包身份 / 技能 / 锁定名单 / 设置 / 中继
const CORE = (s) => cut(s, '  var profiles = loadProfiles();', '  var version = (location.href.match');
const CLAIM = (s) => cut(s, '  // V2.38.4-身份修复：旧档认领（复制语义）', '  // 角色切换 → 切档');
const ONCHAR = (s) => cut(s, '  function onCharChanged(ent) {', '  onId("dsh-saveprofile"');
const PKT = (s) => cut(s, '  // ================= V2.38.6 手机端 char_id 的包流来源', '  // ---------------- V2.38.4 入站分帧');
const ASK = (s) => cut(s, '  var askList = (function () {', '  function renderAskList() {');
const LOCK = (s) => cut(s, '  var lockList = (function () {', '  onId("dsh-locklist"');
const CAPTURE = (s) => cut(s, '  var PROF_CONTROLS = [', '  // V2.16.7：配置控件统一 change 即时保存');
const APPLY = (s) => cut(s, '  function applyProfileUI() {', '  // V2.38.4-身份修复：旧档认领（复制语义）');
const KV = (s) => cut(s, '  function kvRelayKeyAllowedForSelf(ak) {', '  function kvRefreshHotkeys() {');

function pkt113(gid, map) {
  const buf = new ArrayBuffer(28), dv = new DataView(buf);
  dv.setUint16(0, 113, true); dv.setUint32(2, gid, true);
  for (let i = 0; i < Math.min(15, map.length); i++) dv.setUint8(6 + i, map.charCodeAt(i));
  return buf;
}
function pkt107() { const b = new ArrayBuffer(6); new DataView(b).setUint16(0, 107, true); return b; }

// opt: { store, CLIENT, els, lockList, askList, profMemKey, activeProfileKey }
function world(src, opt) {
  opt = opt || {};
  const store = new Map(Object.entries(opt.store || {}));
  const statuses = [], logs = [];
  const els = opt.els || {};
  const ctx = {
    console, JSON, Object, Array, Number, String, Math, Date, isFinite, isNaN, parseFloat, parseInt, Error, RegExp,
    PROF_KEY: 'dsh_ro_profiles_v2', LS_KEY: 'dsh_ro_plugin_v1', LOGIN_KEYS: ['account', 'password', 'server', 'autoBoot'],
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    store, statuses, logs, els,
    $id: (id) => els[id] || null,
    document: { hidden: false, visibilityState: 'visible', querySelector: () => null, addEventListener() {}, removeEventListener() {} },
    location: { href: 'https://post.lastro.cn/ro/api.html', search: '', hostname: 'post.lastro.cn', origin: 'https://post.lastro.cn' },
    CLIENT: opt.CLIENT || {}, IS_MN: !!opt.IS_MN,
    lockList: opt.lockList || {}, askList: opt.askList || [], profMemKey: opt.profMemKey === undefined ? null : opt.profMemKey,
    profUIApplied: !!opt.profUIApplied, saved: null, panel: null,
    setStatus: (s, l) => statuses.push([s, l]), tlog: (m) => logs.push(String(m)),
    renderLockList() {}, renderAskList() {}, renderGearAll() {}, renderWinInfo() {}, fillZhuQoaskill() {},
    syncApplyRuntime() {}, renderSyncState() {}, perfApply() {}, rebuildBountyStyle() {}, renderHlList() {},
    npSyncTargetsDom() {}, npSyncTargets() {}, btDiagOn: false, hkOf: () => null, renderStatbar() {},
    clientReady: () => false, requireDB: () => null, gearAskRecover() {}, syncRealAtkRange() {},
    npClearBattleIntent() {}, deathReturnCancel() {}, npBattleState: () => false, npResetBattleState() {},
    dojoStop() {}, npZeroBattle() {}, migrateZControlsAll() {},
    bagClean: { generation: 0, busy: false, pending: false, config: null, enabled: false, render: null },
    bagCleanLoad: () => ({ armed: false, enabled: false, generation: 0 }), bagCleanSave() {}, bagCleanSay() {},
    psFuncSig: () => 0, pickCv: () => '',
  };
  vm.createContext(ctx);
  const code = CORE(src) + '\n' + CLAIM(src) + '\n' + ONCHAR(src) + '\n' + PKT(src) + '\n' + ASK(src) + '\n' + LOCK(src) + '\n' + CAPTURE(src) + '\n' + APPLY(src) + '\n' + KV(src);
  vm.runInContext(code, ctx);
  return ctx;
}
function seedProfiles(o) { return JSON.stringify(o); }
const P999 = { ch999: { name: '旧角色', gid: 999, charId: 999, saved: {}, lockList: { '1': { name: '旧锁' } }, askList: [{ skid: 1 }], lastAt: 4700000000000 } };

// ============ I1 未识别：两条真实写路径（锁定名单 / 技能）都不落盘，只进缓冲 ============
function checkNoWriteWhileUnidentified(src, tag) {
  const store = { 'dsh_ro_profiles_v2': seedProfiles(P999), 'dsh_ro_last_active': 'ch999' };
  const w = world(src, { store, lockList: { '1': { name: '旧锁' } }, askList: [{ skid: 1 }] });
  assert.equal(w.selfCharId(), 0, tag + ' 无 SS.GID 必须未识别');
  assert.equal(w.profiles.ch999.lockList['7'], undefined, tag + ' 前置：ch999 不含 7');
  const blob0 = JSON.stringify(w.profiles), raw0 = w.store.get('dsh_ro_profiles_v2');
  w.addLock('7', '怪物');
  w.askList.push({ skid: 5 });
  w.saveAskList();
  assert.equal(w.lockList['7'] !== undefined, true, tag + ' 内存名单必须保留用户刚加的那条（显示层不丢）');
  assert.equal(w.profiles.ch999.lockList['7'], undefined, tag + ' 未识别：锁定名单绝不能写进继承来的档');
  assert.equal(w.profiles.ch999.askList.length, 1, tag + ' 未识别：技能配置绝不能写进继承来的档');
  assert.equal(JSON.stringify(w.profiles), blob0, tag + ' 未识别：档案对象整份不得被改动');
  assert.equal(w.store.get('dsh_ro_profiles_v2'), raw0, tag + ' 未识别：档案绝不能落盘');
  assert.ok(w.pendingEdits.n >= 2 && w.pendingEdits.epoch >= 0, tag + ' 未识别：改动必须进缓冲（含世代）');
  assert.ok(w.pendingEdits.ui && w.lockList['7'], tag + ' 缓冲必须覆盖名单改动');
  // 界面控件改动也必须只进缓冲（即使 profUIApplied 被置位）
  const store2 = { 'dsh_ro_profiles_v2': seedProfiles(P999), 'dsh_ro_last_active': 'ch999' };
  const w2 = world(src, { store: store2, els: { 'dsh-askint': { value: '9', checked: false, type: 'text' } } });
  w2.profUIApplied = true; w2.profMemKey = 'ch999'; // 核心切片会重置运行期变量，这里显式模拟「界面已填充」态
  w2.profiles.ch999.saved = { ui: { KEEP: 'x' } };
  w2.saved = { ui: { KEEP: 'x' } };
  const savedBefore = JSON.stringify(w2.saved);
  w2.captureAll();
  assert.equal(JSON.stringify(w2.saved), savedBefore, tag + ' 未识别：captureAll 不得把界面值收进内存 saved');
  assert.equal(w2.profiles.ch999.saved.ui['dsh-askint'], undefined, tag + ' 未识别：界面值绝不许写进继承来的档');
  return w;
}

// ============ I2 识别到位：自愈切档 + 回填到 ch<charId>，继承档逐字节不变 ============
function checkHealFlush(src, tag) {
  const store = { 'dsh_ro_profiles_v2': seedProfiles(P999), 'dsh_ro_last_active': 'ch999' };
  const w = world(src, { store, lockList: { '1': { name: '旧锁' } }, askList: [{ skid: 1 }] });
  const before999 = JSON.stringify(w.profiles.ch999);
  w.addLock('7', '怪物');
  delete w.lockList['1'];
  w.removeLock('1');
  w.askList.push({ skid: 5 });
  w.saveAskList();
  w.CLIENT.SS = { GID: 1000, Entity: { GID: 777.5, display: { name: '新角色' } } };
  assert.equal(w.identityReady(), true, tag + ' charId 到位后必须身份就绪');
  assert.equal(w.identityCommit('test'), true, tag + ' 身份到位必须提交（切档）');
  assert.equal(w.activeProfileKey(), 'ch1000', tag + ' 必须自愈切到 ch<charId>');
  const p = w.profiles.ch1000;
  assert.ok(p && p.charId === 1000, tag + ' 必须建出 ch1000 且写 charId');
  assert.ok(p.lockList['7'] && !p.lockList['1'], tag + ' 回填：加 7 / 删 1 必须落到新档，实际=' + JSON.stringify(p.lockList));
  assert.equal(JSON.stringify(p.askList.map((e) => e.skid)), '[5]', tag + ' 回填：技能按 skid 增删必须落到新档，实际=' + JSON.stringify(p.askList));
  assert.equal(JSON.stringify(w.profiles.ch999), before999, tag + ' 回填绝不能污染继承来的旧档');
  assert.equal(w.pendingEdits.epoch, -1, tag + ' 回填后缓冲必须清空');
  assert.equal(w.profileTrusted('ch1000'), true, tag + ' 回填后新档必须可信');
  return w;
}

// ============ I3 换图（同角色第二个 113）→ 缓冲整份作废（fail-closed，宁丢不错） ============
function checkFlushInvalidated(src, tag) {
  const store = { 'dsh_ro_profiles_v2': seedProfiles(P999), 'dsh_ro_last_active': 'ch999' };
  const w = world(src, { store, lockList: { '1': { name: '旧锁' } }, askList: [{ skid: 1 }] });
  w.identityPktHook(pkt113(12345, 'prontera'), 113);
  assert.equal(w.selfCharId(), 12345, tag + ' 包流必须补上 char_id');
  w.addLock('7', '怪物'); // 身份已从包里拿到，但档还没提交 → 仍属未识别窗口，改动进缓冲
  assert.ok(w.pendingEdits.n >= 1, tag + ' 未提交前改动必须进缓冲');
  w.identityPktHook(pkt113(12345, 'geffen'), 113); // 同一角色换图 → 缓冲作废（身份保留）
  assert.equal(w.pendingEdits.epoch, -1, tag + ' 换图必须作废缓冲');
  assert.equal(w.selfCharId(), 12345, tag + ' 换图不得丢掉身份');
  w.identityCommit('test');
  assert.equal(w.activeProfileKey(), 'ch12345', tag + ' 换图后仍要切到正确档');
  assert.equal(w.profiles.ch12345.lockList['7'], undefined, tag + ' 换图后的缓冲必须整份作废，绝不回填');
  // socket 重建 → 身份与缓冲一起作废
  w.identityPktHook(pkt113(12345, 'geffen'), 113);
  w.identityPktHook(pkt107(), 107);
  assert.equal(w.selfCharId(), 0, tag + ' 回角色列表必须清身份');
  return w;
}

// ============ I4 中继 fail-closed：未识别不采纳、不写回；身份到位后重放采纳 ============
function checkRelay(src, tag) {
  const store = {
    'dsh_ro_profiles_v2': seedProfiles({ ch123: { charId: 123, lockList: {}, askList: [] }, ch999: { charId: 999, name: '我', lockList: {}, askList: [] } }),
  };
  const w = world(src, { store });
  assert.equal(w.activeProfileKey(), 'default', tag + ' 前置：没有 dsh_ro_last_active 时活跃档必须是 default');
  w.store.set('dsh_ro_last_active', 'ch999'); // 中继把「我自己的键」推过来，但此刻还未识别
  assert.equal(w.kvRelayKeyAllowedForSelf('ch999'), false, tag + ' 未识别：中继档键一律不采纳（fail-closed）');
  w.kvRefreshProfile();
  assert.equal(w.activeProfileKey(), 'default', tag + ' 未识别：不得被中继切档');
  assert.equal(w.store.get('dsh_ro_last_active'), 'ch999', tag + ' 未识别：只读不写，不得回写 dsh_ro_last_active');
  w.CLIENT.SS = { GID: 999, Entity: { GID: 2007018.5, display: { name: '我' } } };
  w.kvRefreshProfile(true);
  assert.equal(w.activeProfileKey(), 'ch999', tag + ' 身份到位后必须采纳自己的中继键（重放）');
  w.store.set('dsh_ro_last_active', 'ch123'); // 别人的键
  w.kvRefreshProfile(true);
  assert.equal(w.activeProfileKey(), 'ch999', tag + ' 别人的键绝不采纳');
  assert.equal(w.store.get('dsh_ro_last_active'), 'ch999', tag + ' 别人的键必须把本地正确值写回 localStorage');
  return w;
}

// ============ I5 char_id 包流：113/2757 解析 GID@2；107 清；SS.GID 优先 ============
function checkPktIdentity(src, tag) {
  const store = { 'dsh_ro_profiles_v2': seedProfiles({}) };
  const w = world(src, { store });
  w.identityPktHook(pkt113(4242, 'prontera'), 113);
  assert.equal(w.pktCharId, 4242, tag + ' 113 的 GID@2 必须被解析为 char_id');
  assert.equal(w.selfCharId(), 4242, tag + ' 客户端对象不可达时必须用包流 char_id');
  w.identityCommit('pkt');
  assert.equal(w.activeProfileKey(), 'ch4242', tag + ' 包流身份必须能驱动切档');
  // SS.GID 一旦可达 → 优先（不被包流覆盖）
  w.CLIENT.SS = { GID: 9, Entity: { GID: 1.2 } };
  assert.equal(w.selfCharId(), 9, tag + ' SS.GID 必须优先于包流');
  assert.equal(w.pktCharId, 4242, tag + ' 包流值保留作诊断，不参与优先级');
  return w;
}

// ============ I6 PC 正常路径回归：有 charId 时闸门全开、切档/落盘/采纳与旧版一致 ============
function checkPcNormal(src, tag) {
  const store = { 'dsh_ro_profiles_v2': seedProfiles(P999), 'dsh_ro_last_active': 'ch999', 'dsh_ro_plugin_v1': JSON.stringify({ account: 'a' }) };
  const w = world(src, { store, lockList: { '1': { name: '旧锁' } }, askList: [], profMemKey: 'ch999', profUIApplied: true, els: { 'dsh-askint': { value: '7', checked: false, type: 'text' } } });
  w.CLIENT.SS = { GID: 999, Entity: { GID: 2007018.9, display: { name: '旧角色' } } };
  w.profUIApplied = true; w.profMemKey = 'ch999'; // 核心切片会重置这两个运行期变量，这里显式按「已填充」态设置
  assert.equal(w.selfCharId(), 999, tag + ' PC：charId 必须来自 SS.GID');
  assert.equal(w.profileTrusted('ch999'), true, tag + ' PC：已登录角色档必须可信');
  assert.equal(w.identityTick(), false, tag + ' PC：已对齐时身份拍必须空转（不重复切档）');
  assert.equal(w.activeProfileKey(), 'ch999', tag + ' PC：启动恢复的活跃档必须保持');
  w.captureAll();
  assert.equal(w.profiles.ch999.saved.ui['dsh-askint'], '7', tag + ' PC：captureAll 必须照常落盘');
  w.addLock('9', 'PC锁');
  assert.equal(w.profiles.ch999.lockList['9'] !== undefined, true, tag + ' PC：addLock 必须照常落盘');
  assert.ok(w.store.get('dsh_ro_plugin_v1').indexOf('"account":"a"') >= 0, tag + ' PC：全局登录键必须照常保存');
  const self = w.kvRelayKeyAllowedForSelf('ch999');
  assert.equal(self, true, tag + ' PC：自己的档键必须可采纳');
  // 档键对了但档内 charId 是别人的 → 绝不可信（防「键对了、档是别人的」）
  const keepCharId = w.profiles.ch999.charId;
  w.profiles.ch999.charId = 123;
  assert.equal(w.profileTrusted('ch999'), false, tag + ' PC：档内 charId 与当前角色不符时必须判为不可信');
  w.profiles.ch999.charId = keepCharId;
  return w;
}

const checks = [
  ['I1 未识别不写（名单/技能/界面）', checkNoWriteWhileUnidentified],
  ['I2 识别后自愈切档 + 回填', checkHealFlush],
  ['I3 换图/重登作废缓冲', checkFlushInvalidated],
  ['I4 中继 fail-closed + 重放', checkRelay],
  ['I5 char_id 包流', checkPktIdentity],
  ['I6 PC 正常路径回归', checkPcNormal],
];
for (const [label, fn] of checks) {
  test('V2.38.6 ' + label + '（VM · 两文件）', () => {
    for (const [name, src] of SOURCES) fn(src, name);
  });
}

// ============ I7 结构断言：版本 / 门位置清单 / EOL / 行数 / 差异 ============
test('V2.38.6 结构断言：版本 2.38.6、九处门就位、EOL 与两文件差异不变', () => {
  const stable = SOURCES[0][1], exp = SOURCES[1][1];
  for (const [name, src] of SOURCES) {
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.6', name + ' @version 必须是 2.38.6');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.6', name + ' VER 必须是 2.38.6');
    const t = lfSrc(src);
    const gates = [
      ['saveProfiles', '      if (!profWriteGuard("档案落盘")) return;'],
      ['saveSaved', '      if (!profWriteGuard("设置")) return;'],
      ['captureAll', '      if (!profileTrusted(_capKey) && !(_capKey && _capKey === lastTrustedKey && profileHarvestable(_capKey))) { profWriteGuard("设置"); return; }'],
      ['applyProfileUI', '      if (!profileTrusted(activeProfileKey())) profUIApplied = false;'],
      ['dsh-saveprofile', '    if (!profWriteGuard("保存角色设置")) { renderWinInfo(); return; }'],
      ['dsh-clear', '    if (!profileTrusted(activeProfileKey())) { profWriteGuard("清空配置");'],
      ['profileLockSave', '    try { if (!profWriteGuard("锁定名单")) return;'],
      ['saveAskList', '      if (!profWriteGuard("技能配置")) { pendingEditsTouch(); renderAskList(); return; }'],
      ['gearSaveSets', '  function gearSaveSets() { try { if (!profWriteGuard("换装预设")) return;'],
      ['bagCleanSave', '  function bagCleanSave(){try{if(!profileTrusted(activeProfileKey()))return;'],
      ['goldenAutoRecover', '      if (!profileTrusted(activeProfileKey())) return; // V2.38.6'],
      ['kvRefreshProfile', '      if (!identityReady()) { if (ak) kvPendingRelayKey = ak;'],
      ['onCharChanged 回填', '      try { flushPendingEdits(); } catch (ePE) {}'],
      ['包流分派钩子', '      identityPktHook(bytes, op); // V2.38.6'],
      ['新 socket 清身份', 'try { clearPktIdentity("new-socket"); } catch (eWS) {}'],
      ['身份拍注册', '  masterTickReg(function () { try { identityTick(); } catch (e) {} });'],
    ];
    for (const [what, anchor] of gates) assert.ok(t.includes(anchor), name + ' 缺门/缺锚点：' + what);
    // 老行为必须删净
    assert.equal(t.includes('if (!ent || !(gid > 0) || !(cid > 0)) return true;'), false, name + ' 旧的「未识别可采纳」必须删净');
    assert.equal(t.includes('return gidInt(p.gid) === gid; // 老档无 charId：比实体 GID'), false, name + ' 老档「比实体 GID」必须删净');
    assert.equal(t.includes('return gidInt(ent && ent.GID);'), false, name + ' selfCharId 绝不许退回实体 GID');
  }
  const a = stable.split(/\r\n|\n/), b = exp.split(/\n/);
  assert.equal(a.length, b.length, '两文件行数必须一致');
  const diffs = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i + 1);
  assert.deepEqual(diffs, [2, 5, 6], '两文件逐行差异必须只有 2/5/6（@name/@updateURL/@downloadURL）');
  assert.equal(lfSrc(stable).indexOf('\r'), -1, '实验版对比前稳定版必须能被正常归一化');
  assert.equal((stable.match(/(?<!\r)\n/g) || []).length, 0, '稳定版必须纯 CRLF');
  assert.equal((exp.match(/\r\n/g) || []).length, 0, '实验版必须纯 LF');
  assert.equal((stable.match(/\r\r\n/g) || []).length, 0, '不得出现 \r\r\n');
});


// ============ 全文件级：真实加载整份脚本按真实启动顺序验证（不是切片） ============
//   为什么必须全文件：F1 的根因是「3449 的 saveSaved 先于 6148/7584 的名单 IIFE 执行」——切片 VM 看不见这个先后顺序。
function stubElFull(tag) {
  const el = {
    tagName: tag || 'div', style: {}, dataset: {}, className: '', id: '', innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    type: 'text', title: '', placeholder: '', children: [], childNodes: [], parentNode: null, firstChild: null, nextSibling: null,
    offsetWidth: 100, offsetHeight: 20, clientWidth: 100, clientHeight: 20, scrollTop: 0, scrollLeft: 0, hidden: false, draggable: false, __h: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this['_a_' + k] = String(v); }, getAttribute(k) { return this['_a_' + k] !== undefined ? this['_a_' + k] : null; },
    removeAttribute(k) { delete this['_a_' + k]; }, hasAttribute(k) { return this['_a_' + k] !== undefined; },
    addEventListener(type, fn) { this.__h[type] = fn; }, removeEventListener() {}, dispatchEvent() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {}, select() {},
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { return c; }, removeChild(c) { return c; }, remove() {},
    querySelector(sel) { return fmCache('e:' + String(sel)); }, querySelectorAll() { return []; }, closest() { return stubElFull('div'); }, contains() { return false; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }; },
    insertAdjacentHTML() {}, cloneNode() { return stubElFull(tag); }, getElementsByTagName() { return []; }, animate() { return { cancel() {} }; },
  };
  return el;
}
const fmQ = new Map();
const fmCache = (key) => { if (!fmQ.has(key)) fmQ.set(key, stubElFull('div')); return fmQ.get(key); };
function fullVm(src, seed) {
  const store = new Map(Object.entries(seed || {}));
  const els = new Map(); const timers = []; const docH = {};
  const SS = { Entity: { GID: 2007018.9, display: { name: '我' } } }; // PC：真实登录后才有 SS.GID
  const NM = { sendPacket() {}, addListener() {}, removeListener() {} };
  const el = (id) => { if (!els.has(id)) els.set(id, stubElFull('div')); return els.get(id); };
  const document = {
    getElementById: el,
    querySelector(sel) { return fmCache('d:' + sel); }, querySelectorAll() { return []; }, getElementsByTagName() { return []; }, getElementsByClassName() { return []; },
    createElement(t) { return stubElFull(t); }, createTextNode(t) { return stubElFull('#text'); }, createDocumentFragment() { return stubElFull('#frag'); },
    addEventListener(type, fn) { (docH[type] = docH[type] || []).push(fn); }, removeEventListener() {}, dispatchEvent() {}, execCommand() { return false; },
    head: stubElFull('head'), body: stubElFull('body'), documentElement: stubElFull('html'),
    readyState: 'complete', hidden: false, visibilityState: 'visible', cookie: '', title: '', activeElement: stubElFull('body'),
  };
  const noop = () => {};
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    JSON, Math, Date, isFinite, isNaN, parseInt, parseFloat, String, Number, Object, Array, Boolean, RegExp, Error, TypeError, Promise, Map, Set, Symbol, Function, Proxy, Reflect,
    DataView, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, TextEncoder, TextDecoder, URL, Blob, encodeURIComponent, decodeURIComponent, escape, unescape, btoa, atob,
    performance: { now: () => Date.now() }, queueMicrotask: (f) => { try { f(); } catch (e) {} },
    document,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); }, clear: () => store.clear(), key: (i) => Array.from(store.keys())[i], get length() { return store.size; } },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    location: { href: 'https://post.lastro.cn/ro/api.html', search: '', hash: '', host: 'post.lastro.cn', hostname: 'post.lastro.cn', origin: 'https://post.lastro.cn', protocol: 'https:', pathname: '/ro/api.html', reload: noop, replace: noop, assign: noop },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36', platform: 'Win32', language: 'zh-CN', onLine: true },
    screen: { width: 1920, height: 1080 }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    WebSocket: class { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} abort() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    setTimeout: (f, ms) => { timers.push({ f, ms, kind: 'timeout' }); return timers.length; }, clearTimeout: noop,
    setInterval: (f, ms) => { timers.push({ f, ms, kind: 'interval' }); return timers.length; }, clearInterval: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    alert: noop, confirm: () => false, prompt: () => null, open: () => null,
    GM_getValue: (k, d) => d, GM_setValue: noop, GM_deleteValue: noop, GM_registerMenuCommand: noop, GM_unregisterMenuCommand: noop, GM_addStyle: () => stubElFull('style'), GM_xmlhttpRequest: noop, GM_info: { script: { version: '0' } },
    // 客户端模块位：真实客户端里 clientReady() 先看 window.require，再把 SS/NM/PS 绑到 CLIENT；这里给同形替身
    require: (name) => (name === 'Engine/SessionStorage' ? SS : (name === 'Network/NetworkManager' ? NM : null)),
    requireDB: (name) => ctx.require(name), // CLIENT.SS 绑定到 SS 对象（改它的 GID = 真登录）
    CLIENT: {}, IS_MN: false, __DSH_RO_ASSIST_API__: null,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx; ctx.top = ctx; ctx.parent = ctx; ctx.frames = ctx; ctx.unsafeWindow = ctx;
  vm.createContext(ctx);
  let err;
  try { vm.runInContext(src, ctx, { filename: 'ro-assist.user.js' }); } catch (e) { err = e; }
  return {
    ctx, store, els, err, SS, el,
    blob: () => { try { return JSON.parse(store.get('dsh_ro_profiles_v2') || '{}'); } catch (e) { return {}; } },
    pump: (n) => { const list = timers.filter((x) => x.kind === 'interval').slice(); for (let i = 0; i < (n || 1); i++) for (const x of list) { try { x.f(); } catch (e) {} } },
    fireDoc: (type, ev) => { for (const fn of (docH[type] || [])) { try { fn(ev); } catch (e) {} } },
  };
}
function fullSeed(flagSet) {
  const s = {
    dsh_ro_profiles_v2: JSON.stringify({ ch999: { name: '我', charId: 999, gid: 2007018, saved: {}, lockList: { '1': { name: 'a' }, '2': { name: 'b' }, '3': { name: 'c' } }, askList: [{ skid: 1 }, { skid: 2 }], lastAt: Date.now() } }),
    dsh_ro_last_active: 'ch999',
  };
  if (flagSet) s.dsh_ro_uiclear170_v1 = '1'; // 老用户「一次性清空」标志已置
  return s;
}
// F1：整份脚本启动（未识别）→ 身份到位 → 名单/技能一条不丢
function checkFullStartupLists(src, tag) {
  for (const flag of [true, false]) {
    const sub = tag + (flag ? ' 标志已置' : ' 标志未置');
    const w = fullVm(src, fullSeed(flag));
    assert.equal(typeof w.err, 'undefined', sub + ' 整份脚本必须能加载：' + (w.err && w.err.message));
    const b0 = w.blob();
    assert.equal(Object.keys(b0.ch999.lockList || {}).sort().join(), '1,2,3', sub + ' 加载阶段不得丢锁定名单');
    assert.equal((b0.ch999.askList || []).map((e) => e.skid).join(), '1,2', sub + ' 加载阶段不得丢技能表');
    w.SS.GID = 999; // 真实 PC：登录后 SS.GID 才出现
    w.pump(3);
    const b1 = w.blob();
    assert.equal(Object.keys(b1.ch999.lockList || {}).sort().join(), '1,2,3', sub + ' F1：识别/切档后锁定名单必须一条不丢，实际=' + JSON.stringify(Object.keys(b1.ch999.lockList || {})));
    assert.equal((b1.ch999.askList || []).map((e) => e.skid).join(), '1,2', sub + ' F1：识别/切档后技能表必须一条不丢，实际=' + JSON.stringify(b1.ch999.askList));
    assert.equal(b1.ch999._movedTo, undefined, sub + ' 不得把档标记迁移');
  }
  return true;
}
// F2：未识别时破坏性动作（解除）被拦截 + 列表标注只读
function checkFullDestructiveBlocked(src, tag) {
  const w = fullVm(src, fullSeed(true));
  assert.equal(typeof w.err, 'undefined', tag + ' 整份脚本必须能加载');
  const el = w.el('dsh-locklist');
  assert.equal(typeof el.__h.click, 'function', tag + ' 锁定名单必须挂上点击处理器');
  el.__h.click({ target: { closest: () => ({ getAttribute: () => '1' }) } }); // 点「解除 ID1」
  assert.match(String(el.innerHTML), /暂不可编辑/, tag + ' F2：未识别时列表必须明确标注暂不可编辑');
  assert.match(String(el.innerHTML), /disabled/, tag + ' F2：未识别时「解除」按钮必须禁用');
  assert.equal(!!(w.blob().ch999.lockList || {})['1'], true, tag + ' F2：拦截后当前档的键必须仍在');
  w.SS.GID = 999; w.pump(3);
  assert.equal(Object.keys(w.blob().ch999.lockList || {}).sort().join(), '1,2,3', tag + ' F2：识别后锁定名单一条不丢（回填绝不按假差异删键）');
  return true;
}
// F3：身份到位但档键已自洽 → 未识别期间的界面改动必须补落盘
function checkFullUiPersisted(src, tag) {
  const w = fullVm(src, fullSeed(true));
  assert.equal(typeof w.err, 'undefined', tag + ' 整份脚本必须能加载');
  const inp = w.el('dsh-askint'); inp.id = 'dsh-askint'; inp.type = 'text'; inp.value = '77';
  w.fireDoc('change', { target: inp }); // 真实面板 change
  assert.equal(!!((w.blob().ch999.saved || {}).ui), false, tag + ' 前置：未识别时面板改动绝不落盘');
  w.SS.GID = 999; w.pump(2); // 档键已是 ch999（自洽）→ 旧实现 identityTick 直接空转
  const ui = ((w.blob().ch999.saved || {}).ui) || {};
  assert.equal(ui['dsh-askint'], '77', tag + ' F3：识别后必须把未识别期间的界面改动补落盘，实际=' + JSON.stringify(ui));
  return true;
}
// F4：包流 gid=0 / 0xFFFFFFFF（保留值）必须拒绝
function checkPktReservedGid(src, tag) {
  const w = world(src, { store: { 'dsh_ro_profiles_v2': seedProfiles({}) } });
  w.identityPktHook(pkt113(0, 'prontera'), 113);
  assert.equal(w.pktCharId, 0, tag + ' gid=0 必须拒绝');
  w.identityPktHook(pkt113(4294967295, 'prontera'), 113);
  assert.equal(w.pktCharId, 0, tag + ' F4：gid=0xFFFFFFFF（保留值）必须拒绝，实际=' + w.pktCharId);
  assert.equal(w.selfCharId(), 0, tag + ' 保留值不得成为身份');
  w.identityCommit('t');
  const junk = Object.keys(w.profiles).filter((k) => /4294967295/.test(k));
  assert.equal(junk.length, 0, tag + ' F4：不得建出 ch4294967295 垃圾档，实际=' + JSON.stringify(Object.keys(w.profiles)));
  assert.equal(/4294967295/.test(String(w.activeProfileKey())), false, tag + ' F4：活动档不得是保留值档，实际=' + w.activeProfileKey());
  return true;
}
const fullChecks = [
  ['F1 全文件 PC 启动→识别：名单/技能一条不丢', checkFullStartupLists],
  ['F2 全文件：未识别破坏性动作拦截 + 只读标注', checkFullDestructiveBlocked],
  ['F3 全文件：档已自洽也要补回填 + 界面改动落盘', checkFullUiPersisted],
  ['F4 gid=0/0xFFFFFFFF 保留值拒绝', checkPktReservedGid],
];
for (const [label, fn] of fullChecks) {
  test('V2.38.6 ' + label + '（两文件）', () => {
    for (const [name, src] of SOURCES) fn(src, name);
  });
}

// ============ 变异测试：7 个变异体，必须被真实断言杀死 ============
function mutate(src, old, nw) {
  const t = lfSrc(src);
  const out = t.split(old).join(nw);
  assert.notEqual(out, t, '变异体必须命中：' + old.slice(0, 70));
  return out;
}
const MUTANTS = [
  ['① 未识别改回「可采纳别页档键」', 'if (!(cid > 0)) return false; // V2.38.6：未识别一律不采纳', 'if (!(cid > 0)) return true; // 变异①：未识别可采纳', checkRelay, /不采纳/],
  ['② 闸门永远放行（未识别也写档）', 'if (profileTrusted(activeProfileKey())) return true;', 'return true; // 变异②：闸门永远放行', checkNoWriteWhileUnidentified, /未识别：/],
  ['③ 档案可信判定丢掉 charId 自洽校验', 'var ok = !!(p && typeof p === "object" && gidInt(p.charId) === selfCharId());', 'var ok = !!(p && typeof p === "object"); // 变异③：丢掉 charId 自洽校验', checkPcNormal, /不可信/],
  ['④ 删掉切档时的回填', '      try { flushPendingEdits(); } catch (ePE) {} // V2.38.6：把未识别期间缓冲的改动回填到正确档（世代不符则整份作废）\n', '', checkHealFlush, /回填/],
  ['⑤ selfCharId 不再用包流 char_id', '      return gidInt(pktCharId); // V2.38.6', '      return 0; // 变异⑤：忽略包流 char_id', checkPktIdentity, /char_id|包流/],
  ['⑥ 换图不再作废缓冲', '      if (pktCharId > 0 && pktCharId === gid) { identityEpoch++; pendingEditsDrop("map-change"); }', '      if (false) { } // 变异⑥：换图不作废缓冲', checkFlushInvalidated, /作废/],
  ['⑦ captureAll 门失效（未识别也收割界面值）', '      if (!profileTrusted(_capKey) && !(_capKey && _capKey === lastTrustedKey && profileHarvestable(_capKey))) { profWriteGuard("设置"); return; }', '      if (false) { } // 变异⑦：captureAll 门失效', checkNoWriteWhileUnidentified, /captureAll/],
  ['⑧ F1 启动把基线/cu 同步删掉（切档按假差异删空当前档）', '      if (pendingEdits.epoch >= 0) pendingEdits.curLock = cloneList(base, false);\n', '', checkFullStartupLists, /F1/],
  ['⑨ F2 未识别时解除不再拦截（删掉自己档的同名键）', '    if (!profileTrusted(activeProfileKey())) { setStatus("角色未识别：锁定名单暂不可编辑（识别后自动可用）", "warn"); renderLockList(); return; }\n', '', checkFullDestructiveBlocked, /F2/],
  ['⑩ F3 档已自洽时不再补回填（界面改动永不落盘）', '        if (pendingEdits.epoch >= 0) {\n          try { flushPendingEdits(); } catch (eF) {}\n          try { applyProfileUI(); } catch (eP) {} // 档已可信 → profUIApplied 置位，界面按档回填\n          try { captureAll(); } catch (eC) {}      // 把用户本会话的界面改动真正写进档\n          try { saveProfiles(); } catch (eS) {}\n        }\n', '', checkFullUiPersisted, /F3/],
  ['⑪ F4 保留值 gid 不再拒绝（建 ch4294967295 垃圾档）', '      if (!(gid > 0) || gid === 4294967295 || !isFinite(gid)) return;', '      if (!(gid > 0)) return; // 变异⑪：放行保留值', checkPktReservedGid, /F4/],
];
test('V2.38.6 变异测试：⑪ 个变异体必须全部被真实断言杀死（两文件）', () => {
  for (const [name, src] of SOURCES) {
    for (const [label, old, nw, fn, expect] of MUTANTS) {
      const m = mutate(src, old, nw);
      let msg = '';
      try { fn(m, name + ' 变异' + label); } catch (e) { msg = String((e && e.message) || e); }
      assert.match(msg, expect, '[' + name + '] 变异体' + label + ' 必须被杀死，实际=' + JSON.stringify(msg.slice(0, 160)));
      console.log('[V2.38.6 变异][' + name + '] ' + label + ' 被杀死：' + msg.split(String.fromCharCode(10))[0].slice(0, 120));
    }
  }
});
