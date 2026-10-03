import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../ro-infinite-dojo.user.js', import.meta.url), 'utf8');
const NPC = [148, 147];                                              // 荣誉管理员坐标
const NPC_GID = 77;
const OWNER = 'ro-infinite-dojo';
const ENTRY_MAP = 'prontera';
const PLAYER_ADJ = { gid: 1, position: [147, 147], hp: 100, maxHp: 100 };

/* ============================================================
 * 极简 DOM / 环境：足够跑真实脚本体（面板 + 状态机），不做浏览器模拟
 * ============================================================ */

function fakeElement(tag, probe) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '', className: '', textContent: '', innerHTML: '',
    disabled: false, checked: false, value: '', href: '', target: '', type: '',
    children: [], parentNode: null, _listeners: {}, _attrs: {},
    style: { cssText: '' },
    appendChild(child) {
      if (probe) { probe.appendChild++; probe.order.push('appendChild'); }
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = node; node.children.push(child); return child;
    },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i >= 0) node.children.splice(i, 1);
      child.parentNode = null; return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const i = node.children.indexOf(ref);
      child.parentNode = node;
      if (i < 0) node.children.push(child); else node.children.splice(i, 0, child);
      return child;
    },
    setAttribute(k, v) { node._attrs[String(k)] = String(v); if (String(k) === 'id') node.id = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(node._attrs, String(k)) ? node._attrs[String(k)] : null; },
    addEventListener(k, fn) { (node._listeners[k] = node._listeners[k] || []).push(fn); },
    removeEventListener() {},
    dispatch(k, ev) { (node._listeners[k] || []).forEach((fn) => fn(ev || {})); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    closest() { return null; },
    get scrollHeight() { return 0; },
    set scrollTop(_v) {}
  };
  return node;
}
function walk(node, out) {
  out.push(node);
  for (const c of node.children) walk(c, out);
  return out;
}
function fakeDocument(probe) {
  const body = fakeElement('body', probe), head = fakeElement('head', probe), html = fakeElement('html', probe);
  const doc = {
    body, head, documentElement: html,
    createElement: (t) => { if (probe) { probe.createElement++; probe.order.push('createElement'); } return fakeElement(t, probe); },
    getElementById: (id) => walk(body, []).concat(walk(head, [])).find((n) => n.id === id) || null,
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  return doc;
}

/* ============================================================
 * 助手通道替身：按真实语义实现门禁、「NAID 绑定」与「同一指纹只选一次」
 * ============================================================ */

function makeFacade(state, opts = {}) {
  const F = {
    protocol: 1,
    assistantVersion: 'test',
    capabilities() {
      if (opts.capsThrow) throw new Error('caps boom');
      return Object.assign(
        { protocol: 1, scopes: ['dojo', 'battle', 'movement', 'dialog', 'arrow', 'fly'], modules: ['dojo'], arrowRules: true, battleTarget: true, assistCombat: true },
        opts.caps || {}
      );
    },
    ready() { return true; },
    snapshot(owner) {
      state.calls.push(['snapshot', owner]);
      if (!state.lease || state.lease.owner !== owner) return null;
      return state.snap;
    },
    acquire(owner, scopes) {
      state.calls.push(['acquire', scopes]);
      if (opts.acquireError) return { ok: false, error: opts.acquireError };
      state.lease = { owner, scopes: scopes.slice(), generation: 1, selectedNpc: 0 };
      return { ok: true, generation: 1 };
    },
    release(owner) {
      state.calls.push(['release', owner]);
      if (state.lease && state.lease.owner === owner) state.lease = null;
      return { ok: true };
    },
    contactNpc(owner, gid) {
      state.calls.push(['contactNpc', gid]);
      if (opts.contactError) return { ok: false, error: opts.contactError };
      if (state.lease) state.lease.selectedNpc = gid;
      return { ok: true };
    },
    walkTo(owner, p) { state.calls.push(['walkTo', p && p.x, p && p.y]); return { ok: true }; },
    chooseMenu(owner, p) {
      state.calls.push(['chooseMenu', p.naid, p.index, p.fingerprint]);
      const menu = state.snap && state.snap.menu;
      if (!menu || p.naid !== menu.naid || !state.lease || p.naid !== state.lease.selectedNpc) return { ok: false, error: 'invalid-menu' };
      if (!Number.isInteger(p.index) || p.index < 0 || p.index >= menu.items.length) return { ok: false, error: 'invalid-menu' };
      if (p.fingerprint !== menu.fingerprint) return { ok: false, error: 'invalid-menu' };
      if (state.menuUsed === p.fingerprint) return { ok: false, error: 'menu-already-used' };
      state.menuUsed = p.fingerprint;
      return { ok: true };
    },
    requestBattle(owner, on) { state.calls.push(['requestBattle', on]); return { ok: true }; },
    prepareCombat(owner, opts) { state.calls.push(['prepareCombat', opts]); return { ok: true, cleared: 0, allMobsRestore: false }; },
    requestPickup(owner, p) { state.calls.push(['requestPickup', p]); return { ok: true, on: !!(p && p.on === true) }; },
    assistCombat(owner, on) {
      state.calls.push(['assistCombat', on]);
      if (opts.battleError) return { ok: false, error: opts.battleError };
      if (on) { const r = state.combat ? 'already' : 'started'; state.combat = true; return { ok: true, result: r }; }
      state.combat = false;
      return { ok: true, result: 'stopped' };
    },
    setBattleTarget(owner, t) { state.calls.push(['setBattleTarget', t && t.mid]); return { ok: true }; },
    clearBattleTarget() { state.calls.push(['clearBattleTarget']); return { ok: true }; },
    setArrowTarget(owner, t) { state.calls.push(['setArrowTarget', t && t.mid]); return { ok: true }; },
    clearArrowTarget() { state.calls.push(['clearArrowTarget']); return { ok: true }; },
    requestFly(owner, p) { state.calls.push(['requestFly', p && p.reason]); return { ok: true }; },
    registerWindow(id) { state.calls.push(['registerWindow', id]); return opts.noWindow ? { ok: false, error: 'invalid-id' } : { ok: true, id }; },
    openWindow(id) { state.calls.push(['openWindow', id]); return opts.noWindow ? { ok: false, error: 'open-failed' } : { ok: true }; },
    closeWindow(id) { state.calls.push(['closeWindow', id]); return { ok: true }; },
    notify: { push(t) { state.notices.push(t); return true; } }
  };
  if (!opts.noTeleport) F.teleport = function (owner, p) { state.calls.push(['teleport', p.map, p.x, p.y]); return opts.teleportError ? { ok: false, error: opts.teleportError } : { ok: true }; };
  return F;
}

function snap(over) {
  return Object.assign({
    protocol: 1, ready: true, map: ENTRY_MAP,
    player: { gid: 1, position: [140, 140], hp: 100, maxHp: 100 },
    mobs: [], npcs: [{ gid: NPC_GID, name: '荣誉管理员', position: NPC.slice() }],
    target: null, inDojoMap: false, dialogOpen: false,
    menu: { naid: 0, items: [], time: 0, generation: 0, fingerprint: '' },
    battleState: null, busy: {}, arrow: { enabled: false, status: '', blocked: false, ready: false, target: null, defaultItid: null, currentItid: null }
  }, over || {});
}
function menuSnap(items, fp, naid = NPC_GID) {
  return snap({
    player: PLAYER_ADJ, dialogOpen: true,
    menu: { naid, items, time: 1, generation: 1, fingerprint: fp }
  });
}
// 客户端对话窗口替身（组件自己的 next()）
function fakeNpcBox(state) {
  return {
    get ownerID() { return state.boxOwner === undefined ? NPC_GID : state.boxOwner; },
    next() { state.nextCalls = (state.nextCalls || 0) + 1; },
    ui: {
      find(sel) {
        if (sel === '.next') {
          if (state.boxNoNext) return null;
          return { length: 1, 0: {}, is: () => state.boxVisible !== false, css: () => (state.boxVisible === false ? 'none' : 'block') };
        }
        if (sel === '.content') return { length: 1, 0: {}, is: () => true, css: () => 'block', text: () => state.boxText || '' };
        return { length: 0, is: () => false, css: () => 'none', text: () => '' };
      }
    }
  };
}

/* ============================================================
 * 载入
 * ============================================================ */

function boot(src, opts = {}) {
  const state = {
    clock: 100000, seq: 0, intervals: new Map(), timeouts: new Map(),
    listeners: {}, calls: [], notices: [], menuUsed: '', lease: null, snap: snap(), combat: false,
    boxOwner: NPC_GID, boxText: '', boxVisible: true, boxNoNext: false, nextCalls: 0
  };
  const probe = opts.probe || null;                       // 可选的 DOM / 定时器计数器夹具（页面闸门用例用）
  const doc = fakeDocument(probe);
  const facade = opts.facade !== undefined ? opts.facade : makeFacade(state, opts);
  const win = {
    __DSH_RO_ASSIST_API__: facade,
    __RO_DOJO_TEST_HOOK__: true,
    addEventListener(k, fn) { if (probe) probe.order.push('listener'); (state.listeners[k] = state.listeners[k] || []).push(fn); },
    removeEventListener() {},
    location: Object.assign({ href: opts.url || 'https://post.lastro.cn/ro/api.html' }, opts.locationExtra || {})
  };
  if (opts.withRequire) {
    const req = (name) => {
      if (name === 'UI/Components/NpcBox/NpcBox') return null;                    // 线上该模块可能不在白名单里
      if (name === 'UI/Components/StatusIcons/StatusIcons' || name === 'UI/Components/SkillList/SkillList') {
        return { manager: { getComponent: (n) => { if (n === 'NpcBox') return fakeNpcBox(state); throw new Error('not found'); } } };
      }
      throw new Error('not whitelisted: ' + name);
    };
    req.defined = (n) => n === 'UI/Components/StatusIcons/StatusIcons';
    req.specified = (n) => n === 'UI/Components/StatusIcons/StatusIcons';
    win.require = req;
  }
  const storage = new Map();
  const context = {
    window: win,
    document: doc,
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    setInterval(fn) { state.seq++; state.intervals.set(state.seq, fn); if (probe) { probe.setInterval++; probe.order.push('setInterval'); } return state.seq; },
    clearInterval(id) { state.intervals.delete(id); },
    setTimeout(fn) { state.seq++; state.timeouts.set(state.seq, fn); if (probe) { probe.setTimeout++; probe.order.push('setTimeout'); } return state.seq; },
    clearTimeout(id) { state.timeouts.delete(id); },
    Date: { now: () => state.clock },
    GM_xmlhttpRequest: opts.gm,
    JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error,
    isFinite, parseInt, parseFloat, Promise, Map, Set
  };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'ro-infinite-dojo.user.js' });
  const T = win.__RO_DOJO_TEST__;
  const h = {
    state, doc, win, facade, T, storage,
    tick(n = 1) { for (let i = 0; i < n; i++) T.tick(T.run.generation); },
    advance(ms) { state.clock += ms; },
    callsTo(name) { return state.calls.filter((c) => c[0] === name); },
    last(name) { const all = h.callsTo(name); return all.length ? all[all.length - 1] : null; },
    logs() { return T.logLines().map((r) => r.text).join('\n'); },
    status() { return T.statusText(); },
    // 按真实路径走到「站在相邻格 + 已接触」：接触后助手会把选中的 NPC 绑上，选择才可能被接受
    primeContact() {
      h.state.snap = snap({ player: PLAYER_ADJ, dialogOpen: false });
      h.tick();
      return h;
    },
    // 副本内已接触过该 NPC 时，助手侧已绑定选中的 NAID（结算菜单靠这个绑定才接受）
    bindNpc(gid = NPC_GID) { h.facade.contactNpc(OWNER, gid); h.state.calls.length = 0; return h; },
    // 模拟助手传送回执后角色落地：默认落在报名点相邻格（cheb <= 2 视为已到位）
    land(pos) { h.state.snap = Object.assign({}, h.state.snap, { player: { gid: 1, position: (pos || PLAYER_ADJ.position).slice(), hp: 100, maxHp: 100 } }); return h; },
    // 走到对话并给出菜单，再推进一帧让脚本做选择
    toDialog(items, fp, naid = NPC_GID) {
      h.primeContact();
      h.state.snap = menuSnap(items, fp, naid);
      h.tick();
      return h;
    }
  };
  return h;
}

function assertVisible(h, frag) {
  assert.ok(h.status().includes(frag), '状态行必须包含「' + frag + '」，实际：' + h.status());
  assert.ok(h.logs().includes(frag), '日志必须包含「' + frag + '」，实际：' + h.logs());
}
function readyToTalk(h, extra) {
  h.state.snap = snap(Object.assign({ player: PLAYER_ADJ, dialogOpen: true }, extra || {}));
}

/* ============================================================
 * 1. 门面门禁
 * ============================================================ */

test('门禁：能力不齐备的助手一律拒绝，且不抛', () => {
  const good = boot(SRC);
  assert.ok(good.T, '脚本必须能载入并暴露测试钩子');
  assert.equal(good.T.api(), good.facade, '能力齐备必须放行');

  const none = boot(SRC, { facade: null });
  assert.equal(none.T.api(), null, '没有助手必须拒绝');
  assert.match(none.T.apiReport().reason, /助手/, '没有助手必须给出明确提示');

  const mk = (o) => { const s = { calls: [], notices: [], snap: snap() }; return makeFacade(s, o); };
  const cases = [
    ['协议号不一致', (() => { const f = mk({}); f.protocol = 2; return f; })()],
    ['capabilities 抛错', mk({ capsThrow: true })],
    ['arrowRules 未声明', mk({ caps: { arrowRules: false } })],
    ['battleTarget 未声明', mk({ caps: { battleTarget: false } })],
    ['assistCombat 未声明', mk({ caps: { assistCombat: false } })],
    ['没有 dojo 模块', mk({ caps: { modules: [] } })],
    ['scopes 不全', mk({ caps: { scopes: ['dojo', 'battle'] } })]
  ];
  for (const [label, f] of cases) {
    const h = boot(SRC, { facade: f });
    assert.equal(h.T.api(), null, label + ' 必须拒绝');
    assert.ok(h.T.apiReport().reason.length > 0, label + ' 必须给出原因');
  }
  const missing = mk({});
  delete missing.walkTo;
  const hm = boot(SRC, { facade: missing });
  assert.equal(hm.T.api(), null, '必需方法缺失必须拒绝');
  const noTp = mk({});
  delete noTp.teleport;
  const htp = boot(SRC, { facade: noTp });
  assert.equal(htp.T.api(), null, 'REQUIRED_METHODS 缺 teleport 必须拒绝');
  assert.match(htp.T.apiReport().reason, /缺少必需能力/, '必须指出缺 teleport');
  const noCombat = boot(SRC, { facade: mk({ caps: { assistCombat: false } }) });
  assert.equal(noCombat.T.api(), null, '助手不支持代打战斗必须拒绝');
  assert.match(noCombat.T.apiReport().reason, /不支持助手代打战斗/, '必须提示更新助手');
  assert.match(hm.T.apiReport().reason, /缺少必需能力/, '必须指出缺哪种能力');
});

test('门禁：接不上助手时开始/停止都要写明原因，不静默', () => {
  const h = boot(SRC, { facade: null });
  h.T.doStart();
  assert.equal(h.T.run.on, false, '接不上助手不得进入运行');
  assertVisible(h, '没有找到 RO 助手');
  assert.equal(h.state.calls.length, 0, '没有助手时不得发出任何调用');
});

test('开不起来：未进游戏 / 控制权被占 / 助手挂机在跑，都写明原因', () => {
  const busy = boot(SRC, { acquireError: 'assistant-busy' });
  busy.T.doStart();
  assert.equal(busy.T.run.on, false);
  assertVisible(busy, '助手挂机正在运行');

  const owned = boot(SRC, { acquireError: 'owned' });
  owned.T.doStart();
  assertVisible(owned, '控制权被占');

  const raw = boot(SRC, { acquireError: 'client-not-ready' });
  raw.T.doStart();
  assertVisible(raw, '还没进游戏');

  const notReady = boot(SRC);
  notReady.state.snap = snap({ ready: false });
  notReady.T.doStart();
  assert.equal(notReady.T.run.on, false);
  assertVisible(notReady, '游戏未就绪');
  assert.equal(notReady.last('release') !== null, true, '拿不到可用状态必须交还控制权');
});

test('运行中断线：助手消失或控制权被抢走，都写明原因', () => {
  const gone = boot(SRC);
  gone.T.doStart();
  gone.win.__DSH_RO_ASSIST_API__ = null;
  gone.tick();
  assertVisible(gone, 'api-lost');
  assert.equal(gone.T.run.on, false);

  const robbed = boot(SRC);
  robbed.T.doStart();
  robbed.state.lease = { owner: 'someone-else', scopes: ['dojo'], generation: 2, selectedNpc: 0 };
  robbed.tick();
  assertVisible(robbed, 'lease-lost');
});

/* ============================================================
 * 2. 走到相邻格 + 校验 + 2 秒重试 + 距离
 * ============================================================ */

test('入口：先无条件传送，到位后走到 NPC 相邻格（绝不站 NPC 那格），2 秒重试，状态行写实际距离', () => {
  const h = boot(SRC);
  h.T.doStart();
  assert.deepEqual(h.last('teleport'), ['teleport', ENTRY_MAP, 148, 147], '进入入口阶段必须先无条件传送一次');
  assert.equal(h.callsTo('walkTo').length, 0, '传送回执落地之前不得开始走近');
  h.land([146, 146]);                                  // 传送回执：角色落在报名点 2 格内
  h.tick();
  const first = h.last('walkTo');
  assert.ok(first, '必须发出走近相邻格的指令');
  const target = [first[1], first[2]];
  assert.notDeepEqual(target, NPC, '绝不能走 NPC 自己那一格');
  assert.equal(Math.max(Math.abs(target[0] - NPC[0]), Math.abs(target[1] - NPC[1])), 1, '必须落在相邻格');
  assert.match(h.status(), /距离：2/, '状态行必须写实际距离：' + h.status());
  assert.match(h.status(), /阶段：/, '状态行必须有阶段');

  const before = h.callsTo('walkTo').length;
  h.advance(1000); h.tick();
  assert.equal(h.callsTo('walkTo').length, before, '1 秒内不重复发');
  h.advance(1200); h.tick();
  assert.equal(h.callsTo('walkTo').length, before + 1, '超过 2 秒必须重试');
  assert.ok(h.logs().includes('第 2 次'), '重试必须写日志');

  h.state.snap = snap({ player: { gid: 1, position: NPC.slice(), hp: 100, maxHp: 100 } });
  h.advance(2100); h.tick();
  const back = h.last('walkTo');
  assert.notDeepEqual([back[1], back[2]], NPC, '与 NPC 同格时必须退回相邻格');

  h.state.snap = snap({ player: PLAYER_ADJ });
  const walks = h.callsTo('walkTo').length;
  h.tick();
  assert.equal(h.callsTo('walkTo').length, walks, '已到相邻格不得再走');
  assert.deepEqual(h.last('contactNpc'), ['contactNpc', NPC_GID], '必须接触荣誉管理员');
  assert.match(h.status(), /距离：1/);
  assert.ok(h.logs().includes('已到达'), '到达必须写日志');
  assert.equal(h.callsTo('teleport').length, 1, '已经到位就不得再补发传送');
});

test('入口：找不到 NPC 与点不开对话都给出原因', () => {
  const h = boot(SRC);
  h.state.snap = snap({ npcs: [{ gid: 5, name: '路人甲', position: [10, 10] }] });
  h.T.doStart();
  h.land();                                    // 传送回执：落到报名点附近
  h.advance(31000); h.tick();
  assertVisible(h, 'npc-not-found');
  assert.ok(h.logs().includes('本图识别到的 NPC'), '找不到时必须打出本图 NPC 名单');
  assert.ok(h.logs().includes('路人甲'), '名单里必须有识别到的名字');

  const c = boot(SRC, { contactError: 'npc-not-found' });
  c.state.snap = snap({ player: PLAYER_ADJ, dialogOpen: false });
  c.T.doStart();
  for (let i = 0; i < 3; i++) { c.advance(1100); c.tick(); }   // 每秒一次接触，连失败 3 次
  assert.ok(c.logs().includes('连续 3 次点不开对话'), '连续失败必须给明确提示：' + c.logs());
  c.advance(31000); c.tick();
  assertVisible(c, 'contact-failed');
});

/* ============================================================
 * 3. 传送契约（待助手侧实现）
 * ============================================================ */

test('入口传送：不看当前地图与坐标，先无条件发一次；已在报名点也必须发', () => {
  const h = boot(SRC);
  h.state.snap = snap({ player: { gid: 1, position: NPC.slice(), hp: 100, maxHp: 100 } }); // 就站在报名点
  h.T.doStart();
  assert.deepEqual(h.last('teleport'), ['teleport', ENTRY_MAP, 148, 147], '已经在报名点也必须先无条件传送一次');
  assert.equal(h.T.run.on, true, '传送本身不得让脚本停手');
  assert.equal(h.T.run.stage, 'entry');
  h.tick();
  assert.ok(h.last('walkTo'), '就站在报名点那一格时必须先走到 NPC 相邻格');
  assert.equal(h.callsTo('teleport').length, 1, '已经到位不得再补发');
  h.state.snap = snap({ player: PLAYER_ADJ });
  h.tick();
  assert.deepEqual(h.last('contactNpc'), ['contactNpc', NPC_GID], '到位后按原流程继续（接触 NPC）');

  const far = boot(SRC);
  far.state.snap = snap({ map: 'gef_fild01' });
  far.T.doStart();
  assert.deepEqual(far.last('teleport'), ['teleport', ENTRY_MAP, 148, 147], '跨图同样只按配置的报名点传送');
  assert.equal(far.callsTo('walkTo').length, 0, '传送没落地前不得靠走路硬来');
});

test('入口传送：失败 / 超时 / 缺方法都必须停手且原因可见', () => {
  // 失败：把助手返回的 error 原文写进状态行与日志
  const fail = boot(SRC, { teleportError: 'invalid-map' });
  fail.T.doStart();
  assertVisible(fail, 'teleport-failed');
  assertVisible(fail, 'invalid-map');
  assert.equal(fail.T.run.on, false, '传送失败必须停手');
  assert.equal(fail.T.run.stage, 'stopped');

  // 缺方法：提示更新助手
  // 缺方法：门禁（REQUIRED_METHODS 含 teleport）先拦下，提示更新助手
  const miss = boot(SRC, { noTeleport: true });
  miss.T.doStart();
  assertVisible(miss, '缺少必需能力');
  assertVisible(miss, 'teleport');
  assert.equal(miss.T.run.on, false, '能力自检不过必须停手');
  assert.match(SRC, /teleport-missing/, '入口仍必须保留 teleport-missing 的防御分支');

  // 超时：8 秒补发一次，单次 entry 最多 2 发，仍不到位 → teleport-timeout
  const stuck = boot(SRC);
  stuck.T.doStart();
  assert.equal(stuck.callsTo('teleport').length, 1, '第一次必须发');
  stuck.advance(8000); stuck.tick();
  assert.equal(stuck.callsTo('teleport').length, 2, '8 秒没到位必须补发一次');
  stuck.advance(3000); stuck.tick();
  assert.equal(stuck.callsTo('teleport').length, 2, '单次 entry 最多 2 发');
  stuck.advance(6000); stuck.tick();
  assertVisible(stuck, 'teleport-timeout');
  assert.equal(stuck.T.run.on, false, '两次都没到位必须停手');
});

/* ============================================================
 * 4. 对话链：NAID 校验 / 去重 / 序号兜底 / 下一步
 * ============================================================ */

test('对话链：NAID 不是荣誉管理员时一律不碰', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.primeContact();
  h.state.snap = menuSnap(['荣耀积分兑换', '无限挑战', '查看排名'], 'fp-a', 999);
  h.tick();
  assertVisible(h, '其他 NPC');
  assertVisible(h, 'foreign-npc');
  assert.equal(h.callsTo('chooseMenu').length, 0, '别的 NPC 的对话不得提交选择');
  assert.equal(h.T.run.on, false, '不认识的对话必须停手');
});

test('对话链：无限挑战 → 我要报名，同一指纹只提交一次', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.toDialog(['荣耀积分兑换', '无限挑战', '查看排名'], 'fp-a');
  assert.equal(h.T.run.on, true, '正常对话链不得停手：' + h.logs());
  assert.deepEqual(h.last('chooseMenu'), ['chooseMenu', NPC_GID, 1, 'fp-a'], '必须选第 2 项无限挑战');
  assert.equal(h.callsTo('chooseMenu').length, 1);
  h.tick();
  assert.equal(h.callsTo('chooseMenu').length, 1, '同一指纹不得重复提交');

  h.state.snap = menuSnap(['我要报名', '我再想想'], 'fp-b');
  h.tick();
  assert.deepEqual(h.last('chooseMenu'), ['chooseMenu', NPC_GID, 0, 'fp-b'], '必须选我要报名');
  assert.equal(h.T.run.entry.signedUp, true, '选完我要报名即视为已报名');
  assert.ok(h.logs().includes('已报名'), '必须写明已报名');
});

test('对话链：关键词匹配不到时按配置序号兜底', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.toDialog(['荣耀积分兑换', '逛逛再说'], 'fp-x');
  assert.equal(h.T.run.on, true, '兜底后就该继续跑：' + h.logs());
  assert.deepEqual(h.last('chooseMenu'), ['chooseMenu', NPC_GID, 1, 'fp-x'], '兜底必须选配置的第 2 项');
  assert.ok(h.logs().includes('按序号兜底'), '兜底必须在日志里说明');

  const bad = boot(SRC);
  bad.T.cfg.challengeIndex = 0;
  bad.T.doStart();
  bad.toDialog(['荣耀积分兑换', '逛逛再说'], 'fp-y');
  assert.equal(bad.callsTo('chooseMenu').length, 0, '没有兜底项时不得乱点');
  assertVisible(bad, 'invalid-menu');
});

test('对话链：下一步只点一次同一句话，组件不可达时报错不空转', () => {
  const h = boot(SRC, { withRequire: true });
  h.T.doStart();
  h.state.boxText = '荣耀积分可以兑换不少东西。';
  readyToTalk(h);
  h.tick();
  assert.equal(h.state.nextCalls, 1, '同一句话只点一次');
  h.tick();
  assert.equal(h.state.nextCalls, 1, '同一句话第二次不得再点');
  h.state.boxText = '要不要试试无限挑战？';
  h.tick();
  assert.equal(h.state.nextCalls, 2, '对话换了一句必须继续点');
  assert.ok(h.logs().includes('点「下一步」'));

  h.state.boxOwner = 999;
  h.state.boxText = '别的话';
  h.tick();
  assert.equal(h.state.nextCalls, 2, '别的 NPC 的对话不得点下一步');
  assertVisible(h, '其他 NPC');

  // 组件完全取不到 → 明确报错
  const blind = boot(SRC);
  blind.T.doStart();
  readyToTalk(blind);
  blind.tick();
  blind.advance(21000);
  blind.tick();
  assertVisible(blind, 'npc-box-unreachable');
  assert.equal(blind.T.run.on, false, '取不到按钮不得空转');

  // 组件在但按钮取不到 → 5 秒报错
  const half = boot(SRC, { withRequire: true });
  half.state.boxNoNext = true;
  half.T.doStart();
  readyToTalk(half);
  half.tick();
  half.advance(6000);
  half.tick();
  assertVisible(half, 'npc-box-unreachable');
});

test('对话卡住：只剩关闭按钮 / 副本内 NPC 走不到，都报原因不空转', () => {
  const h = boot(SRC, { withRequire: true });
  h.T.doStart();
  h.state.boxVisible = false;                 // 只有关闭按钮，没有下一步
  readyToTalk(h);
  h.tick();
  assert.equal(h.state.nextCalls, 0, '没有下一步按钮时不得乱点');
  h.advance(21000);
  h.tick();
  assertVisible(h, 'dialog-stuck');
  assert.equal(h.T.run.on, false, '卡在同一层不得空转');

  const d = boot(SRC);
  d.T.doStart();
  d.T.beginBattle({ map: 'dojo_d' }, d.state.clock);
  d.state.snap = snap({
    map: 'dojo_d', inDojoMap: true, player: { gid: 1, position: [70, 70], hp: 100, maxHp: 100 },
    mobs: [], npcs: [{ gid: 41, name: '白猫', position: [90, 90] }]
  });
  d.advance(2000); d.tick();
  assert.ok(d.callsTo('walkTo').length >= 1, '先要真的走');
  d.advance(70000); d.tick();
  assertVisible(d, 'walk-failed');
  assert.ok(d.logs().includes('本图识别到的 NPC'), '走不到也必须打出本图 NPC 名单');
});

/* ============================================================
 * 5. 战斗 / 无怪提示 / 循环结算 / 停止
 * ============================================================ */

test('战斗：首领优先、换箭就绪时开战、无怪 20 秒给出明确提示', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  h.state.snap = snap({
    map: 'dojo_a', inDojoMap: true, player: { gid: 1, position: [50, 50], hp: 100, maxHp: 100 },
    mobs: [{ mid: 1002, gid: 9, dead: false, isBoss: false, position: [52, 50] }, { mid: 2001, gid: 10, dead: false, isBoss: true, position: [53, 50] }],
    npcs: [], arrow: { enabled: true, status: '', blocked: false, ready: true, target: { mid: 2001, gid: 10 } }
  });
  h.tick();
  assert.deepEqual(h.last('setBattleTarget'), ['setBattleTarget', 2001], '必须优先锁定首领');
  assert.deepEqual(h.last('assistCombat'), ['assistCombat', true], '换箭就绪必须开战');
  assert.match(h.status(), /距离：3/, '状态行必须写实际距离：' + h.status());


  h.state.snap = snap({ map: 'dojo_a', inDojoMap: true, player: { gid: 1, position: [50, 50], hp: 100, maxHp: 100 }, mobs: [], npcs: [{ gid: 3, name: '冰波利', position: [60, 60] }] });
  h.tick();
  h.advance(21000); h.tick();
  assert.ok(h.logs().includes('可能需要在副本内对话，请把该 NPC 名字发我'), '无怪满 20 秒必须给出该提示');
  assert.ok(h.logs().includes('冰波利'), '必须打出本图识别到的 NPC 与数量');
  assert.ok(h.state.notices.some((n) => n.includes('可能需要在副本内对话')), '该提示必须推送');
});

test('副本内 NPC 别名可配置，命中后走到相邻格再接触', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_b' }, h.state.clock);
  h.state.snap = snap({
    map: 'dojo_b', inDojoMap: true, player: { gid: 1, position: [70, 70], hp: 100, maxHp: 100 },
    mobs: [], npcs: [{ gid: 21, name: '白猫达人', position: [75, 75] }]
  });
  h.tick();
  const w = h.last('walkTo');
  assert.ok(w, '副本内找到别名 NPC 必须走过去');
  assert.equal(Math.max(Math.abs(w[1] - 75), Math.abs(w[2] - 75)), 1, '必须走相邻格');
  h.state.snap = snap({
    map: 'dojo_b', inDojoMap: true, player: { gid: 1, position: [74, 75], hp: 100, maxHp: 100 },
    mobs: [], npcs: [{ gid: 21, name: '白猫达人', position: [75, 75] }]
  });
  h.tick();
  assert.deepEqual(h.last('contactNpc'), ['contactNpc', 21], '到相邻格后必须接触');

  const c = boot(SRC);
  c.T.cfg.dojoNpcAliases = ['道场管理员'];
  c.T.doStart();
  c.T.beginBattle({ map: 'dojo_c' }, c.state.clock);
  c.state.snap = snap({ map: 'dojo_c', inDojoMap: true, player: { gid: 1, position: [70, 70], hp: 100, maxHp: 100 }, mobs: [], npcs: [{ gid: 31, name: '道场管理员', position: [72, 70] }] });
  c.tick();
  assert.ok(c.callsTo('walkTo').length >= 1, '自定义别名必须生效');
});

test('结算：每 5 轮结算，领奖命中不唯一就停手', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  h.T.onNotice('完成第 5 轮');
  assert.equal(h.T.run.stage, 'settle', '每 5 轮必须进入结算');
  assert.equal(h.T.run.round, 5, '必须记住轮次');

  h.bindNpc();
  h.state.snap = menuSnap(['领取奖励', '继续挑战'], 'fp-s1');
  h.tick();
  assert.equal(h.T.run.on, true, '结算选择不得失败：' + h.logs());
  assert.deepEqual(h.last('chooseMenu'), ['chooseMenu', NPC_GID, 0, 'fp-s1'], '必须选领取奖励');
  h.state.snap = snap({ map: 'dojo_a', inDojoMap: true, dialogOpen: false });
  h.advance(9000); h.tick();
  assert.equal(h.T.run.stage, 'battle', '结算完必须回到战斗');
  assert.ok(h.logs().includes('结算完成'));

  const bad = boot(SRC);
  bad.T.doStart();
  bad.T.beginBattle({ map: 'dojo_a' }, bad.state.clock);
  bad.T.onNotice('完成第 5 轮');
  bad.bindNpc();
  bad.state.snap = menuSnap(['领取奖励', '领取礼包'], 'fp-s2');
  bad.tick();
  assertVisible(bad, '命中多项');
  assert.equal(bad.T.run.on, false, '命中不唯一必须停手');
  assert.equal(bad.callsTo('chooseMenu').length, 0, '命中不唯一不得乱点');
});

test('循环：100 轮结算后自动开下一轮报名；关闭自动报名则收尾停止', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  h.T.onNotice('完成第 100 轮');
  assert.equal(h.T.run.cycleEnd, true, '到顶必须标记本轮结束');
  assert.equal(h.T.run.stage, 'settle');
  h.bindNpc();
  h.state.snap = menuSnap(['领取奖励'], 'fp-t1');
  h.tick();
  h.state.snap = snap({ map: 'dojo_a', inDojoMap: true, dialogOpen: false });
  h.advance(9000); h.tick();
  assert.equal(h.T.run.cycle, 2, '必须自动开始下一轮：' + h.logs());
  assert.equal(h.T.run.stage, 'entry', '下一轮必须回到报名入口');
  assert.equal(h.T.run.on, true, '自动循环必须继续运行');

  const c = boot(SRC);
  c.T.cfg.autoSignup = false;
  c.T.doStart();
  c.T.beginBattle({ map: 'dojo_a' }, c.state.clock);
  c.T.onNotice('完成第 100 轮');
  c.bindNpc();
  c.state.snap = menuSnap(['领取奖励'], 'fp-t2');
  c.tick();
  c.state.snap = snap({ map: 'dojo_a', inDojoMap: true, dialogOpen: false });
  c.advance(9000); c.tick();
  assert.equal(c.T.run.on, false, '关闭自动报名必须停');
  assertVisible(c, 'cycle-done');
});

test('停止：随时可停，原因进状态行与日志，并交还控制权', () => {
  const h = boot(SRC);
  h.T.doStart();
  assert.equal(h.T.run.on, true);
  const callsBefore = h.state.calls.length;
  h.T.doStop('手动停止', 'manual');
  assert.equal(h.T.run.on, false);
  assert.equal(h.last('release')[0], 'release');
  assert.equal(h.last('release')[1], OWNER, '必须按同一属主交还控制权');
  assertVisible(h, '手动停止');
  assertVisible(h, 'manual');
  h.tick();
  assert.equal(h.T.run.stage, 'stopped');
  assert.equal(h.state.calls.length, callsBefore + 3, '停止后不得再有任何动作（只剩清目标与交还）');
});

test('公告：轮次与剩余都进状态行，事件通道可用', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  h.state.snap = snap({ map: 'dojo_a', inDojoMap: true, dialogOpen: false, mobs: [] });
  h.T.onNotice('第 7 轮开始，还剩：42');
  assert.equal(h.T.run.round, 7);
  assert.equal(h.T.run.remaining, 42);
  assert.match(h.status(), /轮次：7/);
  assert.match(h.status(), /剩余 42/);
  assert.equal(h.T.run.stage, 'battle', '7 不是 5 的倍数且未到顶，不得进结算');

  const listeners = h.state.listeners['dsh-ro-assist-notice'] || [];
  assert.equal(listeners.length, 1, '必须挂上公告监听');
  listeners[0]({ detail: { text: '第 8 轮开始，还剩：41' } });
  assert.equal(h.T.run.round, 8, '公告事件必须能驱动轮次');
});

/* ============================================================
 * 6. 静态断言：零新增端点 / 零自造动作
 * ============================================================ */

test('静态：不新增端点、不自己做任何一步动作，只走约定的助手通道', () => {
  assert.equal(/new\s+PACKET/.test(SRC), false, '不得构造协议对象');
  assert.equal(/sendPacket/.test(SRC), false, '不得自己发动作');
  assert.equal(/\bCLIENT\b/.test(SRC), false, '不得触碰宿主内部状态');
  assert.equal(/\bczp\s*\(/.test(SRC), false, '不得取协议构造器');
  assert.equal(/new\s+WebSocket/.test(SRC), false, '不得开新连接');
  assert.equal(/fetch\s*\(/.test(SRC), false, '不得直连网络');
  assert.equal(/new\s+XMLHttpRequest/.test(SRC), false, '不得直连网络');
  assert.equal(/document\.cookie/.test(SRC), false, '不得碰 cookie');

  const allow = [
    /^https:\/\/raw\.githubusercontent\.com\/Keeee1th\/Lro-user-scripts\/main\/ro-infinite-dojo\.user\.js$/,
    /^https:\/\/github\.com\/Keeee1th\/Lro-user-scripts$/,
    /^https?:\/\/(post|game)\.lastro\.cn\/ro\/api(-old)?\.html\*$/,
    /^https?:\/\/(post|game)\.lastro\.cn\/\*$/,
    /^http:\/\/(127\.0\.0\.1:8971|localhost:8971)\/client\/api\.html\*$/
  ];
  const urls = [...SRC.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]);
  for (const u of urls) assert.ok(allow.some((re) => re.test(u)), '出现未登记地址：' + u);
  assert.equal(urls.filter((u) => /raw\.githubusercontent\.com/.test(u)).length, 2, '更新地址只允许脚本自身的两条');
  assert.equal(urls.filter((u) => /127\.0\.0\.1:8971|localhost:8971/.test(u)).length, 2, '本机入口只允许那两条');
  assert.equal(urls.filter((u) => /lastro\.cn/.test(u)).length, 12, '站点的匹配是具体 api 页 8 条 + 域名通配 4 条，共 12 条');

  const called = new Set();
  for (const m of SRC.matchAll(/call\(a,\s*"([A-Za-z]+)"/g)) called.add(m[1]);
  for (const m of SRC.matchAll(/\ba\.([A-Za-z]+)\s*\(/g)) called.add(m[1]);
  const contract = ['snapshot', 'acquire', 'release', 'contactNpc', 'walkTo', 'chooseMenu', 'assistCombat', 'requestBattle',
    'setBattleTarget', 'clearBattleTarget', 'setArrowTarget', 'clearArrowTarget', 'requestFly',
    'prepareCombat', 'requestPickup',
    'registerWindow', 'openWindow', 'closeWindow', 'teleport', 'capabilities', 'ready', 'notify'];
  for (const c of called) assert.ok(contract.includes(c), '调用了契约外的方法：' + c);
  assert.ok(called.has('teleport'), '必须按约定调用 teleport');
  assert.ok(called.has('assistCombat'), '战斗必须走助手代打入口 assistCombat(owner,on)');
  assert.ok(SRC.includes('call(a, "teleport", [OWNER, { map: map, x: x, y: y }])'), '传送必须用约定签名');
  assert.ok(SRC.includes('a.contactNpc(OWNER, npc.gid)') === false, '接触只允许经 call() 统一出口');
  assert.ok(SRC.includes('requestFly'), '必须保留飞行能力调用');

  const header = SRC.slice(0, SRC.indexOf('// ==/UserScript=='));
  assert.match(header, /@name\s+仙境传说 · 无限道场（独立版）/);
  assert.match(header, /@namespace\s+dsh\.ro-plugin/);
  assert.match(header, /@version\s+1\.0\.3/);
  assert.match(header, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/Keeee1th\/Lro-user-scripts\/main\/ro-infinite-dojo\.user\.js/);
  assert.match(header, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/Keeee1th\/Lro-user-scripts\/main\/ro-infinite-dojo\.user\.js/);
  assert.match(header, /@grant\s+GM_xmlhttpRequest/);
  assert.match(header, /\/\/ @match\s+http:\/\/post\.lastro\.cn\/ro\/api\.html/);
  assert.match(header, /\/\/ @match\s+https:\/\/game\.lastro\.cn\/ro\/api\.html/);

  // 文案：只写用法与限制，不出现实现词、不出现旧蓝渐变、不出现表情
  const css = SRC.slice(SRC.indexOf('var PANEL_CSS_TEXT'), SRC.indexOf('function el('));
  const tip = SRC.slice(SRC.indexOf('var tip = el('), SRC.indexOf('  function syncPanelFromCfg()'));
  const face = tip + SRC.match(/var FILE_HINT\s*=\s*"[^"]+"/)[0] + SRC.match(/var NO_MOB_HINT\s*=\s*"[^"]+"/)[0];
  for (const bad of ['发包', '包', '客户端', '字段', '接口', '包含']) assert.equal(face.includes(bad), false, '界面文案不得出现「' + bad + '」');
  assert.ok(face.includes('战斗由助手精灵代打'), '限制必须写明战斗由助手精灵代打');
  assert.ok(face.includes('到报名点会消耗 1 个传送卷轴'), '限制必须写明消耗一个传送卷轴');
  assert.ok(face.includes('只自动拾取卡片与装备'), '限制必须写明只自动拾取卡片与装备');
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(face), false, '界面文案不得出现表情');
  assert.ok(face.includes('用法：'), '必须有用法短句');
  assert.ok(face.includes('限制：'), '必须有限制短句');
  assert.ok(face.includes('如需读取本机文件，请在浏览器扩展详情里为本脚本开启「允许访问文件网址」'), '必须有点名提示');
  assert.ok(face.includes('REPO_URL'), '提示附近必须给出脚本仓库地址');
  assert.ok(SRC.includes('var REPO_URL       = "https://github.com/Keeee1th/Lro-user-scripts"'), '脚本仓库地址必须是该仓库');
  assert.equal(/#192332|#8194ad|linear-gradient/.test(css), false, '自带面板不得用旧蓝渐变配色');
});

/* ============================================================
 * 7. 本地配置 + 界面
 * ============================================================ */

test('本地配置：读到就覆盖，读不到就用内置默认且不失败', () => {
  const h = boot(SRC, {
    gm: (o) => { o.onload({ status: 200, responseText: JSON.stringify({ entryX: 155, entryY: 160, npcName: '别的管理员', challengeIndex: 1 }) }); }
  });
  assert.equal(h.T.cfg.entryX, 155);
  assert.equal(h.T.cfg.entryY, 160);
  assert.equal(h.T.cfg.npcName, '别的管理员');
  assert.equal(h.T.cfg.challengeIndex, 1);
  assert.equal(h.T.cfg.stop100, true, '没写的键必须保持内置默认');

  const bad = boot(SRC, { gm: (o) => { o.onerror({}); } });
  assert.equal(bad.T.cfg.entryX, 148, '读不到必须用内置默认');
  assert.equal(bad.T.run.stage, 'idle', '读不到不得影响启动');
  const junk = boot(SRC, { gm: (o) => { o.onload({ status: 200, responseText: 'not json' }); } });
  assert.equal(junk.T.cfg.entryY, 147, '坏文件必须回落默认');
  assert.ok(junk.logs().includes('本地配置格式不对'), '坏文件必须写日志');
});

test('界面：优先用助手浮窗，不可用时退回自带面板且控件齐全可用', () => {
  const w = boot(SRC, {});
  assert.equal(w.T.mode(), 'window', '助手可用时必须用助手浮窗');
  assert.ok(w.callsTo('registerWindow').length >= 1, '助手可用时必须注册浮窗');
  assert.equal(w.callsTo('openWindow').length, 0, 'V1.0.3：boot 期间不得替用户打开浮窗（openWindow 必须为 0 次）');

  const s = boot(SRC, { noWindow: true });
  assert.equal(s.T.mode(), 'standalone', '助手浮窗不可用必须退回自带面板');
  assert.ok(s.T.root(), '自带面板必须挂上');
  const ids = ['ro-dojo-start', 'ro-dojo-stop', 'ro-dojo-diff', 'ro-dojo-stop100', 'ro-dojo-fly',
    'ro-dojo-emergency', 'ro-dojo-auto', 'ro-dojo-status', 'ro-dojo-log'];
  for (const id of ids) assert.ok(s.doc.getElementById(id), '必须有 ' + id);
  const txt = s.doc.getElementById('ro-dojo-status').textContent;
  assert.match(txt, /阶段：/, '状态行必须含阶段');
  assert.match(txt, /轮次：/, '状态行必须含轮次');
  assert.match(txt, /距离：/, '状态行必须含距离');

  s.doc.getElementById('ro-dojo-start').dispatch('click');
  assert.equal(s.T.run.on, true, '面板开始按钮必须生效');
  const fly = s.doc.getElementById('ro-dojo-fly');
  fly.checked = true;
  fly.dispatch('change');
  assert.equal(s.T.cfg.fly, true, '开关必须写回配置');
  const diff = s.doc.getElementById('ro-dojo-diff');
  diff.value = 'advanced';
  diff.dispatch('change');
  assert.equal(s.T.cfg.difficulty, 'advanced', '难度必须写回配置');
  s.doc.getElementById('ro-dojo-stop').dispatch('click');
  assert.equal(s.T.run.on, false, '面板停止按钮必须生效');
});

/* ============================================================
 * 7.5 V1.0.3 手动打开：开局不自动弹出 + 常驻「无限道场」启动按钮
 * ============================================================ */

// 把当前还活着的定时器回调都跑一轮（clearInterval 会从表里移除，先做快照）
function runIntervals(h, rounds = 1) {
  for (let i = 0; i < rounds; i++) {
    for (const fn of [...h.state.intervals.values()]) fn();
  }
  return h;
}
function launcherOf(h) { return h.doc.getElementById('ro-dojo-launcher'); }

test('V1.0.3 手动打开 a：window 模式 boot 期间一次都不许调 openWindow', () => {
  const h = boot(SRC, {});
  assert.equal(h.T.mode(), 'window', '助手可用时仍然走助手浮窗');
  assert.ok(h.callsTo('registerWindow').length >= 1, 'window 模式必须保留 registerWindow');
  assert.equal(h.callsTo('openWindow').length, 0, 'boot 期间不得调用 openWindow（openWindow 调用次数必须为 0）');
  assert.equal(h.T.panelShown(), false, 'boot 后必须是「未打开」状态');
  runIntervals(h, 3);
  assert.equal(h.callsTo('openWindow').length, 0, 'boot 之后的定时器路径也不得把浮窗打开');
});

test('V1.0.3 手动打开 b：standalone 模式容器存在但初始 display:none，启动按钮存在', () => {
  const h = boot(SRC, { noWindow: true });
  assert.equal(h.T.mode(), 'standalone', '助手浮窗不可用必须退回自带面板');
  const wrap = h.doc.getElementById('ro-dojo-standalone');
  assert.ok(wrap, '自带面板容器必须挂上');
  assert.equal(wrap.style.display, 'none', '自带面板初始必须 display:none（boot 期间不得可见）');
  assert.ok(launcherOf(h), '启动按钮必须存在（#ro-dojo-launcher）');
  assert.ok(h.doc.getElementById('ro-dojo-launcher-box'), '启动按钮必须挂在自己创建的容器上');
  assert.equal(launcherOf(h).textContent, '无限道场', '按钮文案必须是「无限道场」');
  assert.equal(h.T.panelShown(), false, 'boot 后必须是「未打开」状态');
  assert.ok(h.logs().includes('点右下角「无限道场」按钮打开面板'), '就绪日志必须引导用户手动打开：' + h.logs());
});

test('V1.0.3 手动打开 c：点启动按钮开关面板（standalone 切显示 / window 调 openWindow + closeWindow）', () => {
  const s = boot(SRC, { noWindow: true });
  const wrap = s.doc.getElementById('ro-dojo-standalone');
  const btn = launcherOf(s);
  btn.dispatch('click');
  assert.equal(wrap.style.display, 'block', '第一次点击必须展开面板');
  assert.equal(s.T.panelShown(), true, '展开后状态必须是「已打开」');
  btn.dispatch('click');
  assert.equal(wrap.style.display, 'none', '再点必须收起面板');
  assert.equal(s.T.panelShown(), false, '收起后状态必须是「未打开」');
  btn.dispatch('click');
  assert.equal(wrap.style.display, 'block', '第三次点击必须再次展开');
  assert.ok(s.doc.getElementById('ro-dojo-start'), '面板控件必须仍然可用');

  // 拖动结束那一下也会冒出一个 click：它不得被当成「点开 / 收起」
  s.T.launcher().__dshDragged = true;
  btn.dispatch('click');
  assert.equal(wrap.style.display, 'block', '拖动结束的 click 不得收起面板');
  assert.equal(s.T.launcher().__dshDragged, false, '拖动标记读过之后必须清掉');

  const w = boot(SRC, {});
  assert.equal(w.callsTo('openWindow').length, 0, 'boot 前不得打开');
  launcherOf(w).dispatch('click');
  assert.deepEqual(w.last('openWindow'), ['openWindow', 'ro-infinite-dojo'], 'window 模式未打开时点击必须调 openWindow(WIN_ID)');
  assert.equal(w.T.panelShown(), true, '打开后状态必须是「已打开」');
  launcherOf(w).dispatch('click');
  assert.deepEqual(w.last('closeWindow'), ['closeWindow', 'ro-infinite-dojo'], 'window 模式已打开时点击必须调 closeWindow(WIN_ID)');
  assert.equal(w.T.panelShown(), false, '收起后状态必须是「未打开」');
  assert.equal(w.callsTo('openWindow').length, 1, '打开只调一次，不得重复打开');
});

test('V1.0.3 手动打开 d：启动后经过若干 tick，面板不会自己变成可见', () => {
  const w = boot(SRC, {});
  for (let i = 0; i < 6; i++) { runIntervals(w, 1); w.tick(); w.advance(3100); }
  assert.equal(w.callsTo('openWindow').length, 0, 'window 模式过了若干 tick 也不得自己打开');
  assert.equal(w.T.panelShown(), false, '过了若干 tick 状态必须仍是「未打开」');

  const s = boot(SRC, { noWindow: true });
  const wrap = s.doc.getElementById('ro-dojo-standalone');
  for (let i = 0; i < 6; i++) { runIntervals(s, 1); s.tick(); s.advance(3100); }
  assert.equal(s.T.mode(), 'standalone', '助手一直不可用就必须留在自带面板');
  assert.equal(wrap.style.display, 'none', '过了若干 tick 自带面板必须仍是隐藏的');

  // 助手后来才就绪：只切换显示方式，不得替用户打开
  const late = boot(SRC, { noWindow: true });
  late.win.__DSH_RO_ASSIST_API__ = makeFacade(late.state, {});
  runIntervals(late, 1);
  assert.equal(late.T.mode(), 'window', '助手就绪后必须切到助手浮窗');
  assert.equal(late.callsTo('openWindow').length, 0, '只切换显示方式，不得把面板打开');
  assert.equal(late.T.panelShown(), false, '切换后状态必须仍是「未打开」');
  assert.equal(late.doc.getElementById('ro-dojo-standalone'), null, '切换后自带面板必须撤掉');
});

test('V1.0.3 手动打开 e：助手就绪只切显示方式；用户先前已打开才保持打开', () => {
  const s = boot(SRC, { noWindow: true });
  launcherOf(s).dispatch('click');                       // 用户自己打开
  assert.equal(s.T.panelShown(), true);
  s.win.__DSH_RO_ASSIST_API__ = makeFacade(s.state, {});
  s.state.listeners['dsh-ro-assist-ready'].forEach((fn) => fn({}));
  assert.equal(s.T.mode(), 'window', '助手就绪后允许切换到助手浮窗');
  assert.deepEqual(s.last('openWindow'), ['openWindow', 'ro-infinite-dojo'], '用户先前已打开 → 切换后保持打开');
  assert.equal(s.T.panelShown(), true, '切换后必须仍然是打开状态');

  const n = boot(SRC, { noWindow: true });
  n.win.__DSH_RO_ASSIST_API__ = makeFacade(n.state, {});
  n.state.listeners['dsh-ro-assist-ready'].forEach((fn) => fn({}));
  assert.equal(n.T.mode(), 'window', '助手就绪后允许切换到助手浮窗');
  assert.equal(n.callsTo('openWindow').length, 0, '用户没打开过 → 就绪时不得自动打开');
  assert.equal(n.T.panelShown(), false, '用户没打开过 → 就绪后必须仍是「未打开」');
});

test('V1.0.3 变异 M-DOJO-AUTOOPEN：把 boot 改回自动打开 → 用例 a 的断言必须红', () => {
  const base = boot(SRC, {});
  assert.equal(base.callsTo('openWindow').length, 0, '基线：boot 期间 openWindow 必须为 0 次');

  // 变异：注册成功后就替用户打开（回到 V1.0.2 的自动弹出）
  const mut = mutate(SRC, '    if (!registerWindowMode()) mountStandalone();',
    '    if (!registerWindowMode()) mountStandalone();\n    else openAssistantWindow();');
  const h = boot(mut, {});
  assert.equal(h.callsTo('openWindow').length, 1, '变异体确实在 boot 里替用户打开了浮窗');
  assert.throws(() => assert.equal(h.callsTo('openWindow').length, 0, 'boot 期间不得调用 openWindow（openWindow 调用次数必须为 0）'),
    /boot 期间不得调用 openWindow/, '变异 M-DOJO-AUTOOPEN：用例 a 的「boot 期间 0 次 openWindow」断言必须真的杀红');
});

test('V1.0.3 变异 M-DOJO-SHOWWRAP：去掉初始隐藏 → 用例 b 的断言必须红', () => {
  const base = boot(SRC, { noWindow: true });
  assert.equal(base.doc.getElementById('ro-dojo-standalone').style.display, 'none', '基线：初始必须隐藏');

  // 变异：删掉 mountStandalone 里的初始隐藏（面板一挂上就可见）
  const mut = mutate(SRC, '    try { wrap.style.display = "none"; } catch (e) {}', '');
  const h = boot(mut, { noWindow: true });
  const wrap = h.doc.getElementById('ro-dojo-standalone');
  assert.notEqual(wrap.style.display, 'none', '变异体不再初始隐藏（面板挂上即可见）');
  assert.throws(() => assert.equal(wrap.style.display, 'none', '自带面板初始必须 display:none（boot 期间不得可见）'),
    /自带面板初始必须 display:none/, '变异 M-DOJO-SHOWWRAP：用例 b 的「初始 display:none」断言必须真的杀红');
});

/* ============================================================
 * 8. 变异测试：把关键判据改坏，测试必须能抓到
 * ============================================================ */

function mutate(src, from, to) {
  const n = src.split(from).length - 1;
  assert.equal(n, 1, '变异锚点必须唯一：' + from);
  return src.replace(from, to);
}

test('变异 1：把相邻格改回 NPC 自己那格 → 走路不变量必须失败', () => {
  const base = boot(SRC);
  base.T.doStart();
  base.land([146, 146]);
  base.tick();
  const b = base.last('walkTo');
  assert.notDeepEqual([b[1], b[2]], NPC, '基线必须不站 NPC 那格');

  const mut = mutate(SRC, 'if (d < bd) { bd = d; best = [nx, ny]; }', 'if (d < bd) { bd = d; best = [cx, cy]; }');
  const h = boot(mut);
  h.T.doStart();
  h.land([146, 146]);
  h.tick();
  const m = h.last('walkTo');
  assert.deepEqual([m[1], m[2]], NPC, '变异体确实走到了 NPC 自己那格（说明该断言能抓到这个缺陷）');
});

test('变异 2：去掉 NAID 校验 → 必须停手的不变量失败', () => {
  const base = boot(SRC);
  base.T.doStart();
  base.primeContact();
  base.state.snap = menuSnap(['无限挑战'], 'fp-m2', 999);
  base.tick();
  assert.equal(base.T.run.on, false, '基线必须停手');

  const mut = mutate(SRC, 'if (m.naid && e.gid && m.naid !== e.gid)', 'if (false && m.naid && e.gid && m.naid !== e.gid)');
  const h = boot(mut);
  h.T.doStart();
  h.primeContact();
  h.state.snap = menuSnap(['无限挑战'], 'fp-m2', 999);
  h.tick();
  assert.equal(h.logs().includes('其他 NPC'), false, '变异体不再拦别的 NPC（说明该断言能抓到这个缺陷）');
});

test('变异 3：停止原因只进日志不进状态行 → 可见性不变量失败', () => {
  const base = boot(SRC);
  base.T.doStop('测试原因', 'unit');
  assert.ok(base.status().includes('测试原因'), '基线状态行必须有原因');

  const mut = mutate(SRC, '    logLine("停止：" + reason + (code ? "（" + code + "）" : ""), "err");', '    void 0;');
  const h = boot(mut);
  h.T.doStop('测试原因', 'unit');
  assert.ok(h.status().includes('测试原因'), '变异体状态行仍有原因');
  assert.equal(h.logs().includes('测试原因'), false, '变异体日志丢了原因（说明该断言能抓到这个缺陷）');
});

test('变异 4：去掉文本指纹去重 → 同一句话只点一次不变量失败', () => {
  const base = boot(SRC, { withRequire: true });
  base.T.doStart();
  base.state.boxText = '同一句话';
  readyToTalk(base);
  base.tick(); base.tick();
  assert.equal(base.state.nextCalls, 1, '基线只点一次');

  const mut = mutate(SRC, 'if (fp === run.lastNextFp) {', 'if (false) {');
  const h = boot(mut, { withRequire: true });
  h.T.doStart();
  h.state.boxText = '同一句话';
  readyToTalk(h);
  h.tick(); h.tick();
  assert.equal(h.state.nextCalls, 2, '变异体重复点同一句话（说明该断言能抓到这个缺陷）');
});

test('变异 5：去掉序号兜底 → 兜底选择不变量失败', () => {
  const base = boot(SRC);
  base.T.cfg.challengeIndex = 2;
  base.T.doStart();
  base.toDialog(['荣耀积分兑换', '逛逛再说'], 'fp-m5');
  assert.equal(base.callsTo('chooseMenu').length, 1, '基线必须兜底选中一项');

  const mut = mutate(SRC, '    } else if (plan.index >= 1 && plan.index <= items.length) {', '    } else if (false) {');
  const h = boot(mut);
  h.T.doStart();
  h.toDialog(['荣耀积分兑换', '逛逛再说'], 'fp-m5');
  assert.equal(h.callsTo('chooseMenu').length, 0, '变异体不再兜底（说明该断言能抓到这个缺陷）');
  assert.match(h.logs(), /invalid-menu/, '变异体必须留下 invalid-menu 痕迹');
});

/* ============================================================
 * 9. 战斗契约：非 BOSS 也指定目标 / 初级不被换箭阻塞 / 助手拒绝开战必须停手
 * ============================================================ */

const NORMAL_MOB = { mid: 1002, gid: 9, dead: false, isBoss: false, position: [52, 50] };
const ARROW_BLOCKED = { enabled: true, status: '', blocked: true, ready: false, target: { mid: 1002, gid: 9 } };
const ARROW_OFF = { enabled: false, status: '', blocked: false, ready: false, target: null };
function dojoBattleSnap(arrow, mobs) {
  return snap({
    map: 'dojo_a', inDojoMap: true, player: { gid: 1, position: [50, 50], hp: 100, maxHp: 100 },
    mobs: mobs || [NORMAL_MOB], npcs: [], arrow: arrow
  });
}
function battleProbe(src, opts) {
  const h = boot(src || SRC, opts || {});
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  return h;
}

test('V1.0.2 战斗：非 BOSS 怪也必须指定目标，且不再碰换箭', () => {
  const h = battleProbe();
  h.state.snap = dojoBattleSnap(ARROW_OFF);
  h.tick();
  assert.deepEqual(h.last('setBattleTarget'), ['setBattleTarget', NORMAL_MOB.mid], '非 BOSS 怪也必须指定为战斗目标');
  assert.equal(h.callsTo('clearBattleTarget').length, 0, '有活怪时不得再清战斗目标');
  assert.equal(h.callsTo('setArrowTarget').length, 0, '不得再指定换箭目标');
  assert.equal(h.callsTo('clearArrowTarget').length, 0, '不得再清换箭目标');
});

test('V1.0.2 战斗：任何难度都不再等换箭，一律开战且状态行直接进战斗中', () => {
  for (const diff of ['basic', 'middle', 'advanced']) {
    const h = battleProbe();
    h.T.cfg.difficulty = diff;
    h.state.snap = dojoBattleSnap(ARROW_BLOCKED);
    h.tick();
    assert.deepEqual(h.last('assistCombat'), ['assistCombat', true], diff + '：换箭被阻塞也必须开战');
    assert.match(h.status(), /阶段：战斗中/, diff + '：状态行必须直接进战斗中：' + h.status());
    assert.equal(h.callsTo('setArrowTarget').length, 0, diff + '：不得再指定换箭目标');
  }
});

test('战斗：助手拒绝开战必须停手，原因进状态行与日志，不得假装在打', () => {
  const h = battleProbe(SRC, { battleError: 'assistant-busy' });
  h.state.snap = dojoBattleSnap(ARROW_OFF);
  h.tick();
  assert.equal(h.T.run.on, false, '助手拒绝开战必须停手');
  assertVisible(h, 'battle-request-failed');
  assertVisible(h, 'assistant-busy');
  assert.equal(h.status().includes('战斗中'), false, '不得再写「战斗中」假装在打');
});

/* ============================================================
 * 10. 契约锁：助手门面键名 / capabilities 字面量（读助手真源码）
 * ============================================================ */

const ASSIST_SRC = fs.readFileSync(new URL('../ro-assist.user.js', import.meta.url), 'utf8');
const FACADE_HEAD = 'var apiFacade=';
function facadeLiteral(src) {
  const line = String(src).split(/\r?\n/).find((l) => l.indexOf(FACADE_HEAD + '{protocol:API_PROTOCOL') >= 0);
  assert.ok(line, '助手源码里必须能找到 apiFacade 字面量');
  return line.slice(line.indexOf(FACADE_HEAD) + FACADE_HEAD.length);
}
function topLevelKeys(lit) {
  const keys = [];
  let depth = 0, i = 0;
  while (i < lit.length) {
    const ch = lit[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (depth === 1) {
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(lit.slice(i));
      if (m) { keys.push(m[1]); i += m[0].length; continue; }
    }
    i++;
  }
  return keys;
}
function capabilitiesLiteral(lit) {
  const head = 'capabilities:function(){return ';
  const i = lit.indexOf(head);
  assert.ok(i >= 0, 'capabilities 必须直接返回字面量');
  const s = i + head.length;
  let depth = 0;
  for (let j = s; j < lit.length; j++) {
    if (lit[j] === '{') depth++;
    else if (lit[j] === '}') { depth--; if (depth === 0) return lit.slice(s, j + 1); }
  }
  throw new Error('capabilities 字面量没有闭合');
}
function dojoScopesHasArrow(src) { return /var SCOPES\s*=\s*\[[^\]]*"arrow"[^\]]*\]/.test(String(src)); }
function assertNoArrowScope(src, label) {
  assert.equal(dojoScopesHasArrow(src), false, label + '：SCOPES 不得再申请 arrow');
  const h = boot(src);
  h.T.doStart();
  const acq = h.callsTo('acquire')[0];
  assert.ok(acq && Array.isArray(acq[1]), label + '：必须真的走一次 acquire（否则观测是空跑）');
  assert.equal(acq[1].includes('arrow'), false, label + '：真实申请范围不得含 arrow，实际 ' + JSON.stringify(acq[1]));
  return acq[1];
}
function requiredMethods(src) {
  const block = /var REQUIRED_METHODS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  assert.ok(block, '道场脚本必须有 REQUIRED_METHODS');
  return [...block[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
}

function assertFacadeContract(assistSrc, label) {
  const lit = facadeLiteral(assistSrc);
  const keys = topLevelKeys(lit);
  const cap = capabilitiesLiteral(lit);
  const required = requiredMethods(SRC);
  assert.ok(required.includes('teleport'), label + '：道场脚本必须把 teleport 列进 REQUIRED_METHODS');
  for (const m of required) assert.ok(keys.includes(m), label + '：门面缺方法：' + m + '（实际键：' + keys.join(',') + '）');
  for (const k of ['teleport', 'assistCombat', 'requestBattle', 'setBattleTarget', 'setArrowTarget', 'walkTo', 'contactNpc', 'chooseMenu', 'requestFly', 'acquire', 'release', 'snapshot']) {
    assert.ok(keys.includes(k), label + '：门面必须有 ' + k);
  }
  const scopes = JSON.parse(/scopes:(\[[^\]]*\])/.exec(cap)[1]);
  const modules = JSON.parse(/modules:(\[[^\]]*\])/.exec(cap)[1]);
  for (const s of ['dojo', 'battle', 'movement', 'dialog', 'arrow', 'fly']) assert.ok(scopes.includes(s), label + '：capabilities.scopes 必须含 ' + s);
  assert.ok(modules.includes('dojo'), label + '：capabilities.modules 必须含 dojo');
  assert.match(cap, /arrowRules:true/, label + '：capabilities.arrowRules 必须为 true');
  assert.match(cap, /battleTarget:true/, label + '：capabilities.battleTarget 必须为 true');
  assert.match(cap, /assistCombat:true/, label + '：capabilities.assistCombat 必须为 true（战斗由助手精灵代打）');
  for (const m of ['prepareCombat', 'requestPickup', 'teleport', 'assistCombat', 'setBattleTarget', 'clearBattleTarget']) {
    assert.ok(keys.includes(m), label + '：本轮门面必须新增/保留 ' + m);
  }
  return keys;
}

test('契约锁：门面键名与 capabilities 字面量必须满足道场脚本的 REQUIRED_METHODS', () => {
  assertFacadeContract(ASSIST_SRC, '基线');
});

test('变异 M-DOJO-TP：删掉门面的 teleport → 把变异后的助手源码喂给同一个契约锁判定函数，必须真的红', () => {
  assert.doesNotThrow(() => assertFacadeContract(ASSIST_SRC, '基线'), '基线必须通过契约锁');
  const broken = mutate(ASSIST_SRC, 'teleport:apiTeleport,', '');
  assert.notEqual(broken, ASSIST_SRC, '变异必须真的改动助手源码');
  assert.throws(() => assertFacadeContract(broken, '变异体'), /门面缺方法：teleport/, '变异体必须被同一个判定函数判红');
  const tmp = path.join(os.tmpdir(), 'dsh-m-dojo-tp-' + process.pid + '.js');
  fs.writeFileSync(tmp, broken, 'utf8');
  try {
    const fromDisk = fs.readFileSync(tmp, 'utf8');
    assert.notEqual(fromDisk, ASSIST_SRC, '落盘的变异体确实不同');
    assert.throws(() => assertFacadeContract(fromDisk, '变异体文件'), /门面缺方法：teleport/, '从仓库外临时文件读回的变异体同样必须判红');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('变异 M-DOJO-BOSS：恢复「非 BOSS 就清目标」→ 非 BOSS 指定目标用例必须红', () => {
  const base = battleProbe();
  base.state.snap = dojoBattleSnap(ARROW_OFF);
  base.tick();
  assert.deepEqual(base.last('setBattleTarget'), ['setBattleTarget', NORMAL_MOB.mid], '基线：非 BOSS 也必须指定目标');

  const mut = mutate(SRC, '      call(a, "setBattleTarget", [OWNER, { mid: t.mid, gid: t.gid }]);',
    '      if (!t.isBoss) call(a, "clearBattleTarget", [OWNER]); else call(a, "setBattleTarget", [OWNER, { mid: t.mid, gid: t.gid }]);');
  const h = battleProbe(mut);
  h.state.snap = dojoBattleSnap(ARROW_OFF);
  h.tick();
  assert.equal(h.last('setBattleTarget'), null, '变异体不再给非 BOSS 指定目标（说明该断言能抓到这个缺陷）');
  assert.deepEqual(h.last('clearBattleTarget'), ['clearBattleTarget'], '变异体确实走了清目标分支');
});



test('变异 M-DOJO-NOERR：忽略 assistCombat 的失败回执 → 停手用例必须红', () => {
  const base = battleProbe(SRC, { battleError: 'assistant-busy' });
  base.state.snap = dojoBattleSnap(ARROW_OFF);
  base.tick();
  assert.equal(base.T.run.on, false, '基线：助手拒绝开战必须停手');

  const mut = mutate(SRC, '      if (!rb || rb.ok !== true) {', '      if (false) {');
  const h = battleProbe(mut, { battleError: 'assistant-busy' });
  h.state.snap = dojoBattleSnap(ARROW_OFF);
  h.tick();
  assert.equal(h.T.run.on, true, '变异体忽略失败回执仍在跑（说明该断言能抓到这个缺陷）');
  assert.match(h.status(), /阶段：战斗中/, '变异体还会假装在打');
});

/* ============================================================
 * 11. V1.0.2：取消换箭 / 战斗准备 / 自动拾取
 * ============================================================ */

test('V1.0.2 取消换箭：SCOPES 不申请 arrow、REQUIRED_METHODS 不含换箭、换箭被阻塞也一律开战', () => {
  assertNoArrowScope(SRC, '基线');
  const req = requiredMethods(SRC);
  assert.deepEqual(req, ['snapshot', 'acquire', 'release', 'contactNpc', 'walkTo', 'chooseMenu', 'assistCombat',
    'setBattleTarget', 'clearBattleTarget', 'requestFly', 'prepareCombat', 'requestPickup', 'teleport'], 'REQUIRED_METHODS 必须是本轮口径');
  assert.equal(req.includes('setArrowTarget') || req.includes('clearArrowTarget'), false, '不得再要求换箭方法');
  assert.equal(req.includes('requestBattle'), false, '不得再要求内挂开战方法');

  const h = battleProbe();
  h.state.snap = dojoBattleSnap(ARROW_BLOCKED);
  h.tick();
  assert.deepEqual(h.last('assistCombat'), ['assistCombat', true], '换箭被阻塞也必须开战（一律 true）');
  assert.match(h.status(), /阶段：战斗中/, '状态行必须直接进战斗中：' + h.status());
  assert.equal(h.callsTo('setArrowTarget').length, 0, '道场不得再指定换箭目标');
  assert.equal(h.callsTo('clearArrowTarget').length, 0, '道场不得再清换箭目标');
});

test('V1.0.2 停止路径不得再碰换箭：doStop / 无怪分支都只剩清目标、收拾取与交还', () => {
  const h = battleProbe();
  h.state.snap = dojoBattleSnap(ARROW_OFF, []);
  h.tick();
  h.T.doStop('手动停止', 'manual');
  assert.equal(h.callsTo('setArrowTarget').length, 0, 'doStop 不得指定换箭目标');
  assert.equal(h.callsTo('clearArrowTarget').length, 0, 'doStop 不得清换箭目标');
  assert.equal(h.last('clearBattleTarget')[0], 'clearBattleTarget', 'doStop 仍必须清战斗目标');
});

test('V1.0.2 助手换箭预检：只读（零动作）且逐项写全 enabled / 默认箭 / 当前箭 / ready / blocked', () => {
  const h = boot(SRC);
  h.T.doStart();
  assert.ok(h.logs().includes('助手换箭预检'), '启动必须打出换箭预检：' + h.logs());
  const before = h.state.calls.length;
  const row = h.T.arrowPreflight({ arrow: { enabled: true, defaultItid: 1750, currentItid: 1751, ready: false, blocked: true } });
  assert.equal(row.ok, true);
  assert.equal(row.enabled, true);
  assert.equal(row.defaultArrow, 1750);
  assert.equal(row.currentArrow, 1751);
  assert.equal(row.ready, false);
  assert.equal(row.blocked, true);
  // V2.38.13 FIX-9：不再断言产品拼出来的整行字符串（纯格式一改就误红），只钉字段值与固定前缀
  assert.ok(typeof row.text === 'string' && row.text.indexOf('助手换箭预检：') === 0, '预检文本必须带固定前缀：' + row.text);
  assert.match(row.text, /enabled=true/, '预检文本必须带上 enabled：' + row.text);
  assert.match(row.text, /ready=false/, '预检文本必须带上 ready：' + row.text);
  assert.match(row.text, /blocked=true/, '预检文本必须带上 blocked：' + row.text);
  const row2 = h.T.arrowPreflight(null);
  assert.equal(row2.ok, false);
  assert.equal(row2.enabled, false);
  assert.equal(row2.defaultArrow, null);
  assert.equal(row2.currentArrow, null);
  assert.equal(row2.ready, false);
  assert.equal(row2.blocked, false);
  assert.ok(typeof row2.text === 'string' && row2.text.indexOf('助手换箭预检：') === 0, '预检文本必须带固定前缀：' + row2.text);
  assert.equal(h.state.calls.length, before, '预检必须只读：不得产生任何动作');
});

test('V1.0.2 战斗准备：拿到控制权只调一次 prepareCombat(清名单 + 打所有怪)，每轮 entry 不重复', () => {
  const h = boot(SRC);
  h.T.doStart();
  const preps = h.callsTo('prepareCombat');
  assert.equal(preps.length, 1, '启动只做一次战斗准备');
  assert.equal(JSON.stringify(preps[0][1]), JSON.stringify({ clearLocks: true, allMobs: true }), '必须先清锁定名单再改为攻击全部怪');
  assert.ok(h.logs().includes('战斗准备完成'), '必须把准备结果写进日志：' + h.logs());
  h.land([148, 147]);
  h.tick(); h.advance(1000); h.tick();
  assert.equal(h.callsTo('prepareCombat').length, 1, '每轮 entry 不得重复准备（幂等，只做一次）');
});

test('V1.0.2 自动拾取：战斗阶段只开卡片与装备(4/5/6)，结算与停止都收起', () => {
  const h = boot(SRC);
  h.T.doStart();
  h.T.beginBattle({ map: 'dojo_a' }, h.state.clock);
  const on = h.callsTo('requestPickup').filter((c) => c[1] && c[1].on === true);
  assert.equal(on.length, 1, '进入战斗必须开启自动拾取');
  assert.equal(JSON.stringify(on[0][1]), JSON.stringify({ on: true, types: [4, 5, 6] }), '只拾取装备(4)/防具(5)/卡片(6)');
  h.T.beginSettle(h.state.clock, '测试结算');
  assert.ok(h.callsTo('requestPickup').some((c) => c[1] && c[1].on === false), '结算必须收起自动拾取');
  h.T.doStop('手动停止', 'manual');
  assert.equal(h.last('requestPickup')[1].on, false, '停止必须收起自动拾取');
});

test('变异 M-R1：把 arrow 加回 SCOPES / 把换箭门禁加回战斗 → 必须被真实断言杀死', () => {
  // ① 加回 arrow 权限：把变异体喂给同一个「不申请 arrow」判定函数（含真实 acquire 观测），必须真的红
  const mutScopes = mutate(SRC, 'var SCOPES         = ["dojo", "battle", "movement", "dialog", "fly"];',
    'var SCOPES         = ["dojo", "battle", "movement", "dialog", "arrow", "fly"];');
  assert.doesNotThrow(() => assertNoArrowScope(SRC, '基线'), '基线必须通过「不申请 arrow」判定');
  assert.throws(() => assertNoArrowScope(mutScopes, '变异体'), /arrow/, '变异体必须被同一个判定函数判红（含真实租约观测）');

  // ② 加回换箭门禁：只有换箭就绪才开战 → 「一律 true」用例必然红
  const mutGate = mutate(SRC, '      var rb = call(a, "assistCombat", [OWNER, true]);',
    '      var arrowNow = a.snapshot(OWNER) && a.snapshot(OWNER).arrow;\n' +
    '      var allowed = !!(arrowNow && arrowNow.enabled === true && arrowNow.ready === true && arrowNow.blocked === false);\n' +
    '      call(a, "setArrowTarget", [OWNER, { mid: t.mid, gid: t.gid }]);\n' +
    '      var rb = call(a, "assistCombat", [OWNER, allowed]);');
  const h = battleProbe(mutGate);
  h.state.snap = dojoBattleSnap(ARROW_BLOCKED);
  h.tick();
  assert.deepEqual(h.last('assistCombat'), ['assistCombat', false], '变异体换箭没就绪就不开战（说明该断言能抓到这个缺陷）');
  assert.deepEqual(h.last('setArrowTarget'), ['setArrowTarget', NORMAL_MOB.mid], '变异体又指定换箭目标了');
});

/* ============================================================
 * V2.38.13 第三轮：FIX-4 / FIX-5 / FIX-9 回归用例与变异
 * ============================================================ */

test('V2.38.13 FIX-4 副本内 NPC 复位字段统一为 run.dojoNpc（doStop / beginEntry / beginBattle 都必须真的清）+ 变异 M-FIX4', () => {
  const probe = (src) => {
    const stale = { gid: 777, first: -1, walkAt: 0, tries: 0, contactAt: 0, failStreak: 0 };
    const h1 = boot(src); h1.T.doStart(); h1.T.run.dojoNpc = Object.assign({}, stale);
    h1.T.doStop('测试停止', 'test'); const afterStop = h1.T.run.dojoNpc;
    const h2 = boot(src); h2.T.doStart(); h2.T.run.dojoNpc = Object.assign({}, stale);
    h2.T.beginEntry(1); const afterEntry = h2.T.run.dojoNpc;
    const h3 = boot(src); h3.T.doStart(); h3.T.run.dojoNpc = Object.assign({}, stale);
    h3.T.beginBattle(h3.state.snap, h3.state.clock); const afterBattle = h3.T.run.dojoNpc;
    return { afterStop, afterEntry, afterBattle };
  };
  assert.deepEqual(probe(SRC), { afterStop: null, afterEntry: null, afterBattle: null }, '基线：三处复位都必须真的把 run.dojoNpc 清成 null（行为侧）');
  assert.equal(SRC.split('run.dojoNpc = null;').length - 1, 4, '四处复位（doStop/beginEntry/beginBattle/battleTick）必须统一写成 run.dojoNpc = null');
  // 变异 M-FIX4：把整份脚本的 run.dojoNpc = null 改回错拼的 run.dojonpc = null（复现修复前的缺陷）
  const mut = SRC.split('run.dojoNpc = null;').join('run.dojonpc = null;');
  assert.notEqual(mut, SRC, '变异必须真的改动脚本');
  const mp = probe(mut);
  assert.notEqual(mp.afterStop, null, '变异体：doStop 清不掉 run.dojoNpc（说明该断言能抓到这个缺陷）');
  assert.notEqual(mp.afterEntry, null, '变异体：beginEntry 清不掉 run.dojoNpc（说明该断言能抓到这个缺陷）');
  assert.notEqual(mp.afterBattle, null, '变异体：beginBattle 清不掉 run.dojoNpc（说明该断言能抓到这个缺陷）');
  assert.equal(mut.split('run.dojoNpc = null;').length - 1, 0, '变异体不再有任何 run.dojoNpc 复位');
  assert.equal(/run\.dojonpc\b/.test(mut), true, '变异体确实写成了错拼字段');
});

test('V2.38.13 FIX-5 结算后必须重新打开自动拾取（finishSettle 与 settleTick 超时兜底两条路径）+ 变异 M-FIX5', () => {
  const seq = (h) => h.callsTo('requestPickup').map((c) => (c[1] && c[1].on === true ? 'on' : 'off'));
  const toSettleTimeout = (src) => {
    const h = boot(src);
    h.T.doStart();
    h.T.beginBattle(h.state.snap, h.state.clock);
    h.T.beginSettle(h.state.clock, '测试结算');
    h.state.snap = snap({ map: 'dojo_a', inDojoMap: true, player: { gid: 1, position: [140, 140], hp: 100, maxHp: 100 }, npcs: [] });
    h.advance(h.T.defaults.settleWaitMs + 1000);
    h.tick();
    return h;
  };
  const a = boot(SRC);
  a.T.doStart();
  a.T.beginBattle(a.state.snap, a.state.clock);
  a.T.beginSettle(a.state.clock, '测试结算');
  a.T.finishSettle(a.state.clock);
  assert.deepEqual(seq(a), ['on', 'off', 'on'], 'FINISH-SETTLE：开→关→再开，回到战斗阶段必须重新打开自动拾取');
  assert.equal(a.T.run.stage, 'battle', 'finishSettle 必须回到战斗阶段');
  assert.ok(a.logs().includes('结算完成，继续战斗'), '必须走的是 finishSettle 那条路：' + a.logs());
  const b = toSettleTimeout(SRC);
  assert.deepEqual(seq(b), ['on', 'off', 'on'], 'TIMEOUT：超时兜底回到战斗阶段必须重新打开自动拾取');
  assert.equal(b.T.run.stage, 'battle', '超时兜底必须真的回到战斗阶段');
  assert.ok(b.logs().includes('等不到结算菜单'), '必须走的是超时兜底那条路：' + b.logs());
  // 变异 M-FIX5a：去掉 finishSettle 的重开（只把阶段改回战斗）→ FINISH-SETTLE 用例必须红
  const mutA = mutate(SRC, '    enterBattleStage(); // V2.38.13 FIX-5：结算完成回到战斗阶段必须重新打开自动拾取\n    run.noMobWarned = false;\n',
    '    run.stage = "battle";\n    run.noMobSince = 0;\n    run.noMobWarned = false;\n');
  const ma = boot(mutA);
  ma.T.doStart(); ma.T.beginBattle(ma.state.snap, ma.state.clock); ma.T.beginSettle(ma.state.clock, '测试结算'); ma.T.finishSettle(ma.state.clock);
  assert.deepEqual(seq(ma), ['on', 'off'], '变异体：结算完成不再重开拾取（说明该断言能抓到这个缺陷）');
  // 变异 M-FIX5b：去掉 settleTick 超时兜底的重开 → TIMEOUT 用例必须红
  const mutB = mutate(SRC, '    enterBattleStage(); // V2.38.13 FIX-5：结算超时兜底回到战斗阶段必须重新打开自动拾取，否则整轮不再捡\n',
    '    run.stage = "battle";\n    run.noMobSince = 0;\n');
  const mb = toSettleTimeout(mutB);
  assert.deepEqual(seq(mb), ['on', 'off'], '变异体：超时兜底不再重开拾取（说明该断言能抓到这个缺陷）');
});

test('V2.38.13 FIX-9 beginSettle 只允许从战斗阶段进入（恒假第二项已删）+ 预检断言只钉字段，纯格式不得误红', () => {
  // ① 死条件删除后语义 = 只允许从 battle 进入（行为侧先行，形状自检放在最后）
  const h1 = boot(SRC); h1.T.doStart();
  assert.equal(h1.T.run.stage, 'entry', 'doStart 之后应当处于报名阶段（证明起点确实不是 battle）');
  h1.T.beginSettle(h1.state.clock, '非战斗阶段');
  assert.equal(h1.T.run.stage, 'entry', '非战斗阶段调用 beginSettle 必须原样不动');
  assert.equal(h1.callsTo('requestPickup').length, 0, '被挡住时一个拾取包都不许发');
  const h2 = boot(SRC); h2.T.doStart(); h2.T.beginBattle(h2.state.snap, h2.state.clock);
  h2.T.beginSettle(h2.state.clock, '战斗后结算');
  assert.equal(h2.T.run.stage, 'settle', '从战斗阶段必须能进结算');
  assert.ok(h2.callsTo('requestPickup').some((c) => c[1] && c[1].on === false), '进结算必须收起自动拾取');
  // 变异 M-FIX9：把门槛放宽成只挡 settle → 从报名阶段调用也会真的切进结算，上面两条必然红
  const mutGate = mutate(SRC, 'if (run.stage !== "battle") return;', 'if (run.stage === "settle") return;');
  const mg = boot(mutGate); mg.T.doStart();
  mg.T.beginSettle(mg.state.clock, '非战斗阶段');
  assert.equal(mg.T.run.stage, 'settle', '变异体从报名阶段也切进了结算（说明该断言能抓到这个缺陷）');
  assert.ok(mg.callsTo('requestPickup').some((c) => c[1] && c[1].on === false), '变异体在被挡住的位置也发了拾取包');
  assert.equal(/run\.stage !== "battle" \|\| run\.stage === "settle"/.test(SRC), false, 'FIX-9：恒假的第二项必须已经删掉');
  assert.ok(/if \(run\.stage !== "battle"\) return;/.test(SRC), 'FIX-9：门槛语义必须是「只允许从战斗阶段进入」（不再依赖尾部注释）');

  // ② 预检：字段值钉死；纯格式改动（只加一个空格）不得误红；行为变异仍必须被字段断言杀死
  const OLD_TEXT = '助手换箭预检：enabled=true 默认箭=1750 当前箭=1751 ready=false blocked=true';
  const probe = (src) => { const h = boot(src); h.T.doStart(); return h.T.arrowPreflight({ arrow: { enabled: true, defaultItid: 1750, currentItid: 1751, ready: false, blocked: true } }); };
  const base = probe(SRC);
  assert.equal(base.text, OLD_TEXT, '基线文本仍是旧断言里的那一行（说明这次放宽不是因为文本变了）');
  const pretty = SRC.replace('"助手换箭预检：enabled="', '"助手换箭预检： enabled="');
  assert.notEqual(pretty, SRC, '格式变异必须真的改动脚本');
  const p2 = probe(pretty);
  assert.notEqual(p2.text, OLD_TEXT, '纯格式变异后，旧的整行字符串断言必然误红');
  assert.equal(p2.enabled, true, '字段断言不受格式影响（这就是放宽的目的）');
  assert.equal(p2.defaultArrow, 1750, '字段断言不受格式影响');
  assert.equal(p2.currentArrow, 1751, '字段断言不受格式影响');
  assert.equal(p2.ready, false, '字段断言不受格式影响');
  assert.equal(p2.blocked, true, '字段断言不受格式影响');
  assert.equal(p2.text.indexOf('助手换箭预检：'), 0, '前缀断言不受格式影响');
  const mutBlocked = mutate(SRC, '      out.blocked = ar.blocked === true;', '      out.blocked = false;');
  const p3 = probe(mutBlocked);
  assert.equal(p3.blocked, false, '变异体把 blocked 写死 false（说明字段断言能抓到这个真·行为缺陷）');
});

test('V2.38.13 FIX-11 M-DOJO-TP / M-R1① 必须把变异体喂给真实的判定函数（写进仓库外临时文件再判一次）', () => {
  // 契约锁：同一个判定函数在基线与变异体上必须给出不同结论
  assert.doesNotThrow(() => assertFacadeContract(ASSIST_SRC, '基线'), '基线必须通过契约锁');
  const brokenAssist = ASSIST_SRC.split('teleport:apiTeleport,').join('');
  assert.notEqual(brokenAssist, ASSIST_SRC, '变异必须真的改动助手源码');
  assert.throws(() => assertFacadeContract(brokenAssist, '变异体'), /门面缺方法：teleport/, '变异体必须判红');
  // 换箭范围：同一个判定函数在基线与变异体上必须给出不同结论
  assert.doesNotThrow(() => assertNoArrowScope(SRC, '基线'), '基线必须通过「不申请 arrow」判定');
  const mutScopes = SRC.replace('var SCOPES         = ["dojo", "battle", "movement", "dialog", "fly"];',
    'var SCOPES         = ["dojo", "battle", "movement", "dialog", "arrow", "fly"];');
  assert.notEqual(mutScopes, SRC, '变异必须真的改动道场脚本');
  assert.throws(() => assertNoArrowScope(mutScopes, '变异体'), /arrow/, '变异体必须被同一个判定函数判红（含真实租约观测）');
  // 把两个变异体写到仓库外临时文件，再从磁盘读回用同一判定函数跑一遍，排除内联字符串自证
  const dir = os.tmpdir();
  const f1 = path.join(dir, 'dsh-m-dojo-tp-' + process.pid + '.js');
  const f2 = path.join(dir, 'dsh-m-r1-scopes-' + process.pid + '.js');
  fs.writeFileSync(f1, brokenAssist, 'utf8');
  fs.writeFileSync(f2, mutScopes, 'utf8');
  try {
    assert.throws(() => assertFacadeContract(fs.readFileSync(f1, 'utf8'), '变异体文件'), /门面缺方法：teleport/, '落盘后的变异体同样必须判红');
    assert.throws(() => assertNoArrowScope(fs.readFileSync(f2, 'utf8'), '变异体文件'), /arrow/, '落盘后的变异体同样必须判红');
  } finally {
    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
  }
});

/* ============================================================
 * 12. 页面闸门：匹配放宽（手机版入口）+ 站内其它页面一律不启动
 * ============================================================ */

const PAGE_URLS = {
  mobile: 'https://post.lastro.cn/?r=mn/index',           // 用户手机上开游戏的入口
  home: 'https://post.lastro.cn/',                        // 站点首页
  login: 'https://post.lastro.cn/login',                  // 登录页
  notice: 'https://game.lastro.cn/notice?id=1',           // 公告页
  api: 'https://post.lastro.cn/ro/api.html?69.8',         // 站内 api 页（带查询串）
  local: 'http://127.0.0.1:8971/client/api.html',         // 本机调试入口
  localBadPort: 'http://127.0.0.1:8972/client/api.html',  // 端口不对
  other: 'https://example.com/'                           // 其它站点
};

// 计数器夹具：数脚本对页面做的每一次 DOM / 定时器 / 事件监听操作，并按发生顺序留痕
function pageProbe(src, url, extra) {
  const probe = { createElement: 0, appendChild: 0, setInterval: 0, setTimeout: 0, order: [] };
  const h = boot(src, Object.assign({ url: url, probe: probe }, extra || {}));
  return {
    h: h, probe: probe,
    started: !!(h.win.__RO_DOJO_TEST__ && h.T && h.T.root && h.T.root()),
    panel: h.doc.getElementById('ro-dojo-holder'),
    root: h.doc.getElementById('ro-dojo-panel')
  };
}
// 放行断言：a / c / d 共用；变异体必须被同一个函数判红
function assertGateStarted(pr, label) {
  assert.equal(pr.started, true, label + '：必须启动并建出面板');
  assert.ok(pr.h.win.__RO_DOJO_TEST__ && pr.h.T, label + '：测试钩子必须挂上');
  assert.ok(pr.root, label + '：面板根节点必须存在');
  assert.ok(pr.panel, label + '：面板容器必须挂上页面');
  assert.match(pr.h.logs(), /脚本已就绪/, label + '：日志必须有「脚本已就绪」');
  assert.ok(pr.probe.createElement > 0 && pr.probe.appendChild > 0, label + '：必须真的建过 DOM');
}
// 不启动断言：b / e 共用；零 DOM、零定时器、零监听，且早退在任何操作之前
function assertGateBlocked(pr, label) {
  assert.equal(pr.started, false, label + '：不得启动');
  assert.equal(pr.h.win.__RO_DOJO_TEST__, undefined, label + '：不得挂测试钩子');
  assert.equal(pr.root, null, label + '：不得建面板节点');
  assert.equal(pr.panel, null, label + '：不得挂面板容器');
  assert.equal(pr.probe.createElement, 0, label + '：零 createElement');
  assert.equal(pr.probe.appendChild, 0, label + '：零 appendChild');
  assert.equal(pr.probe.setInterval, 0, label + '：零 setInterval');
  assert.equal(pr.probe.setTimeout, 0, label + '：零 setTimeout');
  assert.equal(pr.probe.order.length, 0, label + '：早退必须发生在任何 DOM / 定时器操作之前');
  assert.deepEqual(pr.h.state.listeners, {}, label + '：不得挂事件监听');
}

test('页面闸门 a：手机版入口（网址含 r=mn）必须正常启动 + 变异 G1', () => {
  const pr = pageProbe(SRC, PAGE_URLS.mobile, { noWindow: true });
  assertGateStarted(pr, '基线手机版入口');
  assert.equal(pr.h.T.mode(), 'standalone', '手机版入口必须能建出自带面板');

  const mutG1 = mutate(SRC, 'if (u.href.indexOf("r=mn") >= 0) return true;', 'if (false) return true;');
  assert.throws(() => assertGateStarted(pageProbe(mutG1, PAGE_URLS.mobile, { noWindow: true }), '变异 G1'),
    /必须启动并建出面板/, '变异 G1：删掉 r=mn 分支后手机版入口被判不放行，同一个断言必须杀红');
});

test('页面闸门 b：站点首页 / 登录页 / 公告页一律不启动 + 变异 G2', () => {
  assertGateBlocked(pageProbe(SRC, PAGE_URLS.home), '首页');
  assertGateBlocked(pageProbe(SRC, PAGE_URLS.login), '登录页');
  assertGateBlocked(pageProbe(SRC, PAGE_URLS.notice), '公告页');

  const mutG2 = mutate(SRC, 'PAGE_OK = pageAllowed() === true;', 'PAGE_OK = true;');
  assert.throws(() => assertGateBlocked(pageProbe(mutG2, PAGE_URLS.home), '变异 G2'),
    /不得启动/, '变异 G2：闸门恒放行后首页也会启动，同一个断言必须杀红');
});

test('页面闸门 c：站内 /ro/api 页面（带查询串）仍正常启动 + 变异 G3', () => {
  const pr = pageProbe(SRC, PAGE_URLS.api);
  assertGateStarted(pr, '基线 api 页');

  const mutG3 = mutate(SRC,
    'if (/(^|\\.)lastro\\.cn$/.test(u.host) && u.href.indexOf("/ro/api") >= 0) return true;',
    'if (false) return true;');
  assert.throws(() => assertGateStarted(pageProbe(mutG3, PAGE_URLS.api), '变异 G3'),
    /必须启动并建出面板/, '变异 G3：删掉站点 /ro/api 判断后 api 页被判不放行，同一个断言必须杀红');
});

test('页面闸门 d：本机 8971 入口仍正常启动（端口不对不放行）+ 变异 G4', () => {
  const pr = pageProbe(SRC, PAGE_URLS.local);
  assertGateStarted(pr, '基线本机入口');
  assertGateBlocked(pageProbe(SRC, PAGE_URLS.localBadPort), '本机 8972');   // 端口判断真的在起作用
  // 真浏览器里 location 还带 hostname / port（夹具默认只给 href，属于回落路径）
  assertGateStarted(pageProbe(SRC, PAGE_URLS.local, { locationExtra: { hostname: '127.0.0.1', port: '8971' } }), '本机入口（宿主给 hostname/port）');
  assertGateBlocked(pageProbe(SRC, PAGE_URLS.local, { locationExtra: { hostname: 'example.com', port: '80' } }), '宿主字段优先（假装是本机）');

  const mutG4 = mutate(SRC,
    'if ((u.host === "127.0.0.1" || u.host === "localhost") && u.port === "8971") return true;',
    'if (false) return true;');
  assert.throws(() => assertGateStarted(pageProbe(mutG4, PAGE_URLS.local), '变异 G4'),
    /必须启动并建出面板/, '变异 G4：删掉本机分支后 8971 入口被判不放行，同一个断言必须杀红');
});

test('页面闸门 e：不放行页面里早退必须发生在第一次 DOM / 定时器操作之前（计数器为 0）+ 变异 G5', () => {
  // 正对照：同一个夹具在放行页面上必须真的数到操作，否则「0」什么也证明不了
  const live = pageProbe(SRC, PAGE_URLS.mobile);
  assert.ok(live.probe.order.length > 0, '计数器夹具必须能观察到操作（正对照）');
  assert.ok(live.probe.order.indexOf('createElement') >= 0, '正对照里必须看到 createElement');
  assert.ok(live.probe.order.indexOf('setInterval') >= 0, '正对照里必须看到 setInterval');
  assert.ok(live.probe.appendChild > 0, '正对照里必须看到 appendChild');

  const blocked = [['首页', PAGE_URLS.home], ['登录页', PAGE_URLS.login], ['公告页', PAGE_URLS.notice],
    ['其它站点', PAGE_URLS.other], ['本机错端口', PAGE_URLS.localBadPort]];
  for (const [label, url] of blocked) {
    const pr = pageProbe(SRC, url);
    assertGateBlocked(pr, label);
    assert.deepEqual(pr.probe.order, [], label + '：操作序列必须为空，证明早退发生在任何 DOM / 定时器操作之前');
  }

  const mutG5 = mutate(SRC, 'if (!PAGE_OK) return;', 'if (!PAGE_OK) { void 0; }');
  assert.throws(() => assertGateBlocked(pageProbe(mutG5, PAGE_URLS.home), '变异 G5'),
    /不得启动/, '变异 G5：拿掉早退 return 后首页也会启动，同一个断言必须杀红');
});

/* ============================================================
 * 13. 页面闸门 f / g：主机后缀必须整段匹配 + 主机大小写不敏感
 *    （独立审计 Medium-1 / Low-2 的覆盖缺口固化）
 * ============================================================ */

test('页面闸门 f：主机后缀必须整段匹配（notlastro.cn / *.lastro.cn.evil.com 一律不启动）+ 变异 G6a / G6b', () => {
  // 语义断言：这两类主机都必须「不启动、零副作用」
  assertGateBlocked(pageProbe(SRC, 'https://notlastro.cn/ro/api.html'), '前缀伪装 notlastro.cn');
  assertGateBlocked(pageProbe(SRC, 'https://post.lastro.cn.evil.com/ro/api.html'), '后缀投毒 post.lastro.cn.evil.com');

  // 变异 G6a：去掉左锚（审计 Medium-1 的原始场景）。
  // 锚点字符串 (^|\.)lastro\.cn$ 在改前唯一，mutate() 的唯一性断言会通过，
  // 所以这里若被杀红，红必须来自下面的语义断言本身，而不是锚点找不到。
  const mutG6a = mutate(SRC, '(^|\\.)lastro\\.cn$', 'lastro\\.cn$');
  assert.ok(mutG6a.includes('if (/lastro\\.cn$/.test(u.host)'), '变异 G6a：源码文本必须真的变成不左锚的 /lastro\.cn$/');
  assert.equal(mutG6a.includes('(^|\\.)lastro\\.cn$'), false, '变异 G6a：左锚必须真的已经去掉');
  assertGateStarted(pageProbe(mutG6a, PAGE_URLS.api), '变异 G6a 正对照：合法站点 post.lastro.cn 仍然放行（变异体不是被改坏）');
  assert.throws(() => assertGateBlocked(pageProbe(mutG6a, 'https://notlastro.cn/ro/api.html'), '变异 G6a notlastro.cn'),
    /不得启动/, '变异 G6a：去掉左锚后 notlastro.cn 被误放行，语义断言必须杀红');
  // 反证：G6a 抓不到后缀投毒 —— 说明「整段匹配」必须两头都锚住
  assertGateBlocked(pageProbe(mutG6a, 'https://post.lastro.cn.evil.com/ro/api.html'), '变异 G6a 反证：后缀投毒仍被拦');

  // 变异 G6b：去掉右锚 —— 后缀投毒这一类由它抓
  const mutG6b = mutate(SRC, '(^|\\.)lastro\\.cn$', '(^|\\.)lastro\\.cn');
  assert.ok(mutG6b.includes('if (/(^|\\.)lastro\\.cn/.test(u.host)'), '变异 G6b：源码文本必须真的变成不右锚的 /(^|\.)lastro\.cn/');
  assert.equal(mutG6b.includes('lastro\\.cn$'), false, '变异 G6b：右锚必须真的已经去掉');
  assertGateStarted(pageProbe(mutG6b, PAGE_URLS.api), '变异 G6b 正对照：合法站点 post.lastro.cn 仍然放行');
  assert.throws(() => assertGateBlocked(pageProbe(mutG6b, 'https://post.lastro.cn.evil.com/ro/api.html'), '变异 G6b post.lastro.cn.evil.com'),
    /不得启动/, '变异 G6b：去掉右锚后 post.lastro.cn.evil.com 被误放行，语义断言必须杀红');
  // 反证：G6b 抓不到前缀伪装
  assertGateBlocked(pageProbe(mutG6b, 'https://notlastro.cn/ro/api.html'), '变异 G6b 反证：前缀伪装仍被拦');
});

test('页面闸门 g：主机大小写不敏感（宿主 hostname 与 href 回落两条来源都必须放行）+ 变异 G7', () => {
  // 来源①：真浏览器路径 —— 宿主直接给 hostname（这里宿主给的是大写）
  assertGateStarted(pageProbe(SRC, 'https://post.lastro.cn/ro/api.html', { locationExtra: { hostname: 'POST.LASTRO.CN', port: '' } }), '大写 hostname 字段');
  // 来源②：宿主没给 hostname（测试夹具默认路径），走 href 解析回落
  assertGateStarted(pageProbe(SRC, 'https://POST.LASTRO.CN/ro/api.html'), '大写 href 回落');

  // 变异 G7：把闸门里两处 toLowerCase() 全部删掉
  const mutG7 = mutate(SRC, 'host = String(pm ? pm[1] : auth).toLowerCase();', 'host = String(pm ? pm[1] : auth);');
  const mutG7b = mutate(mutG7, 'host = String(loc.hostname).toLowerCase();', 'host = String(loc.hostname);');
  const gate = mutG7b.slice(mutG7b.indexOf('function pageGateTarget'), mutG7b.indexOf('function pageAllowed'));
  assert.equal(/toLowerCase/.test(gate), false, '变异 G7：闸门里不得再有任何 toLowerCase');
  assertGateStarted(pageProbe(mutG7b, PAGE_URLS.api), '变异 G7 正对照：全小写站点仍然放行（变异体不是被改坏）');
  assert.throws(() => assertGateStarted(pageProbe(mutG7b, 'https://POST.LASTRO.CN/ro/api.html'), '变异 G7 大写 href'),
    /必须启动并建出面板/, '变异 G7：删掉 toLowerCase 后大写 href 被判不放行，用例必须杀红');
  assert.throws(() => assertGateStarted(pageProbe(mutG7b, 'https://post.lastro.cn/ro/api.html', { locationExtra: { hostname: 'POST.LASTRO.CN', port: '' } }), '变异 G7 大写 hostname'),
    /必须启动并建出面板/, '变异 G7：删掉 toLowerCase 后大写 hostname 被判不放行，用例必须杀红');
});

/* ============================================================
 * 14. 用户可见文案：禁词与 emoji 扫描覆盖全部文案
 *    （独立审计 Low-4 的覆盖缺口固化：不只面板 face 三处）
 *    范围 = logLine 字面量 + 状态行文案（statusText / setPhase）
 *         + 按钮与标签（el 的 text / check 的 label）+ 助手通知 + 点名提示常量
 *    不算用户可见文案：代码注释、变量名、日志里的技术短码（warn / err / error 码）
 * ============================================================ */

const COPY_FORBIDDEN = ['发包', '包', '客户端', '字段', '接口', '包含'];
const COPY_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
// 技术短码不是用户可见文案：纯小写 ASCII（warn / err / unknown / battle-request-failed …）一律排除
const COPY_TECH_TOKEN = /^[a-z][a-z0-9._-]*$/;

// 跳过一段字符串字面量（含引号内转义），返回结束引号之后的索引
function scanSkipString(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote) {
    if (text[j] === '\\') j++;
    j++;
  }
  return j + 1;
}
// 取出源码里所有字符串字面量的内容（自动跳过注释；转义原样保留）
function scanStringLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1, buf = '';
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') { buf += text[j] + (text[j + 1] || ''); j += 2; continue; }
        buf += text[j]; j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}
// 括号配平地取出每一次 fnName(...) 的实参文本（字符串 / 注释里的括号不计）
function scanCallArgs(text, fnName) {
  const out = [];
  let from = 0, at;
  while ((at = text.indexOf(fnName + '(', from)) >= 0) {
    const prev = at > 0 ? text[at - 1] : '';
    if (/[A-Za-z0-9_$.]/.test(prev)) { from = at + 1; continue; }   // 排除 fooLogLine( / x.el( 之类
    let i = at + fnName.length + 1, depth = 1;
    const start = i;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl + 1; continue; }
      if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
      if (ch === '"' || ch === "'") { i = scanSkipString(text, i); continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
      i++;
    }
    out.push(text.slice(start, i));
    from = i;
  }
  return out;
}
// 取一个函数声明的大括号本体（注释 / 字符串感知）
function scanFunctionBody(text, fnName) {
  const at = text.indexOf('function ' + fnName + '(');
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  let depth = 1, j = open + 1;
  while (j < text.length && depth > 0) {
    const ch = text[j];
    if (ch === '/' && text[j + 1] === '/') { const nl = text.indexOf('\n', j); j = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === '/' && text[j + 1] === '*') { const e = text.indexOf('*/', j + 2); j = e < 0 ? text.length : e + 2; continue; }
    if (ch === '"' || ch === "'") { j = scanSkipString(text, j); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    j++;
  }
  return text.slice(open + 1, j - 1);
}
// 收集全部用户可见文案：[范围, 文案]
function copyInScope(src) {
  const rows = [];
  for (const args of scanCallArgs(src, 'logLine')) {
    for (const lit of scanStringLiterals(args)) if (!COPY_TECH_TOKEN.test(lit)) rows.push(['logLine', lit]);
  }
  for (const lit of scanStringLiterals(scanFunctionBody(src, 'statusText') || '')) rows.push(['statusText', lit]);
  for (const args of scanCallArgs(src, 'setPhase')) {
    for (const lit of scanStringLiterals(args)) if (!COPY_TECH_TOKEN.test(lit)) rows.push(['setPhase', lit]);
  }
  for (const args of scanCallArgs(src, 'el')) {
    for (const m of args.matchAll(/\btext:\s*"((?:[^"\\]|\\.)*)"/g)) rows.push(['el.text', m[1]]);
  }
  for (const args of scanCallArgs(src, 'check')) {
    const lits = scanStringLiterals(args);
    if (lits.length >= 2) rows.push(['check.label', lits[1]]);      // check(id, label)
  }
  for (const args of scanCallArgs(src, 'pushNotice')) {
    for (const lit of scanStringLiterals(args)) if (!COPY_TECH_TOKEN.test(lit)) rows.push(['pushNotice', lit]);
  }
  for (const m of src.matchAll(/var (NO_MOB_HINT|FILE_HINT)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) rows.push([m[1], m[2]]);
  return rows;
}
function assertCopyClean(rows) {
  for (const [where, text] of rows) {
    for (const bad of COPY_FORBIDDEN) {
      assert.equal(text.includes(bad), false, where + '：用户可见文案不得出现「' + bad + '」，实际：' + JSON.stringify(text));
    }
    assert.equal(COPY_EMOJI.test(text), false, where + '：用户可见文案不得出现表情，实际：' + JSON.stringify(text));
  }
}

test('文案扫描：全部用户可见文案（logLine / 状态行 / 按钮标签 / 通知）0 禁词 0 emoji + 变异 G8a~G8c', () => {
  const rows = copyInScope(SRC);

  // 正题：全部范围内 0 禁词、0 emoji —— 先判这条，真实违规必须报在「禁词 / emoji」上，
  // 而不是被下面的范围抽查抢先报成「某条文案不见了」
  assertCopyClean(rows);

  const byWhere = {};
  for (const [where, text] of rows) (byWhere[where] = byWhere[where] || []).push(text);
  const distinct = (n) => new Set(byWhere[n] || []).size;

  // 非空断言：扫描必须真的扫到东西，否则「0 命中」什么也证明不了
  assert.ok(distinct('logLine') >= 70, 'logLine 文案必须成规模（实际 ' + distinct('logLine') + '）');
  assert.ok(distinct('statusText') + distinct('setPhase') >= 50, '状态行文案必须成规模（实际 ' + (distinct('statusText') + distinct('setPhase')) + '）');
  assert.ok(distinct('el.text') >= 12, '按钮 / 标签 / 选项文案必须成规模（实际 ' + distinct('el.text') + '）');
  assert.equal((byWhere['check.label'] || []).length, 4, '四个开关标签必须全部进入扫描范围');
  assert.ok(new Set(rows.map((r) => r[1])).size >= 150, '扫描总量必须成规模（实际 ' + new Set(rows.map((r) => r[1])).size + '）');

  // 范围抽查：每个面都必须真的被覆盖到（防止提取器以后悄悄退化成只扫 face）
  const texts = new Set(rows.map((r) => r[1]));
  for (const must of ['开始', '停止', '收起', '100 轮后结算并重开', '无怪时飞行', '危险时飞行', '自动报名循环']) {
    assert.ok(texts.has(must), '按钮 / 标签文案必须在扫描范围内：' + must);
  }
  for (const must of ['阶段：', ' · 距离：', '未开始', '地图 ', '道场内战斗']) {
    assert.ok(texts.has(must), '状态行文案必须在扫描范围内：' + must);
  }
  for (const must of ['本图识别到的 NPC：', '脚本已就绪（', '已报名，等待传送到道场']) {
    assert.ok(texts.has(must), 'logLine 文案必须在扫描范围内：' + must);
  }
  for (const must of ['无限道场已停止：', '无限道场：']) {
    assert.ok(texts.has(must), '助手通知文案必须在扫描范围内：' + must);
  }
  for (const must of ['可能需要在副本内对话，请把该 NPC 名字发我', '如需读取本机文件，请在浏览器扩展详情里为本脚本开启「允许访问文件网址」']) {
    assert.ok(texts.has(must), '点名提示必须在扫描范围内：' + must);
  }
  // 排除规则反向钉住：技术短码必须不在范围里（不能靠把范围缩小来变绿）
  for (const tech of ['warn', 'err', 'unknown', 'window']) {
    assert.equal(texts.has(tech), false, '技术短码必须排除在用户可见文案之外：' + tech);
  }

  // 变异 G8a：往 logLine 文案里塞禁词 → 禁词断言必须红
  const mutG8a = mutate(SRC, 'logLine("已报名，等待传送到道场");', 'logLine("已报名，等待传送到道场（发包）");');
  assert.equal(copyInScope(mutG8a).some((r) => r[1].includes('发包')), true, '变异 G8a：塞进去的禁词必须真的进入扫描范围');
  assert.throws(() => assertCopyClean(copyInScope(mutG8a)), /不得出现「发包」/, '变异 G8a：logLine 里的禁词必须被扫到');

  // 变异 G8b：往状态行文案里塞 emoji → emoji 断言必须红
  const mutG8b = mutate(SRC, '"道场内战斗"', '"道场内战斗🎉"');
  assert.equal(copyInScope(mutG8b).some((r) => COPY_EMOJI.test(r[1])), true, '变异 G8b：塞进去的 emoji 必须真的进入扫描范围');
  assert.throws(() => assertCopyClean(copyInScope(mutG8b)), /不得出现表情/, '变异 G8b：状态行里的 emoji 必须被扫到');

  // 变异 G8c：往开关标签里塞 emoji → 证明按钮 / 标签面也在范围内（旧的 face 扫描不覆盖这里）
  const mutG8c = mutate(SRC, '"无怪时飞行"', '"无怪时飞行🎉"');
  assert.equal(copyInScope(mutG8c).some((r) => r[0] === 'check.label' && COPY_EMOJI.test(r[1])), true, '变异 G8c：开关标签里的 emoji 必须真的进入扫描范围');
  assert.throws(() => assertCopyClean(copyInScope(mutG8c)), /不得出现表情/, '变异 G8c：开关标签里的 emoji 必须被扫到');
});
