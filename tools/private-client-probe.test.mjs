// tools/private-client-probe.test.mjs
// 聚焦测试：tools/private-client-probe.user.js（油猴只读探针）
// 运行：node --test tools/private-client-probe.test.mjs
//
// 覆盖点：
//   1) 从源码抽出 collectFrom，在 vm 里用假 win 实跑：字段齐全、类型正确、不抛错、不打印字符串内容
//   2) 只读性：sendPacket 间谍 0 调用；假 win 可枚举键集合运行前后一致（未被写入）；存储只枚举键名
//   3) 静态断言源码不含 localStorage.setItem / sessionStorage.setItem / new CLIENT. / .sendPacket(
//   4) 头部 @match 覆盖 8971 与 localhost:8971，且 @grant none
//   5) node --check 通过
//   6) 有界重试与 clearInterval（就绪或超时必须清理）
//   7) 就绪判据修正：单独 ROConfig 不算就绪；(a) __roeLocalClient.started / (b) require / (c) CLIENT 任一成立即就绪
//   8) 新增采集字段 bundleHints（webpack/systemjs/amd/requirejs/esm 线索/已知引擎对象/关键词全局）与
//      engineHooks（__roeLocalClient 键名 + 各值 typeof），全部只读、取不到即 null
//   9) 引擎未启动时 notes 逐字写「引擎未启动（宿主页已加载但未收到启动配置）」，不得写成「接口不存在」
//  10) 新增逻辑不执行任何加载器（无 eval / new Function / 动态 import / 加载器调用）；(a) 命中后 3s grace

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(HERE, 'private-client-probe.user.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

const BEGIN = '/* ==PROBE-CORE-BEGIN== */';
const END = '/* ==PROBE-CORE-END== */';

const ASSIST_SEL = '[id^="dsh-"],[class*="dsh-"]';

const REQUIRED_FIELDS = [
  'href', 'hasRequire', 'hasClient', 'clientKeys', 'clientReadError',
  'clientSSKeys', 'clientNMKeys', 'clientPSKeys', 'globals', 'globalsInfo',
  'requireProbe', 'moduleSources', 'entityProbe', 'lifeProbe', 'packetProbe',
  'autoBattleProbe', 'notes', 'frame', 'assistant',
  'engineBooted', 'readiness', 'roConfigKeys', 'roConfigBaseKeys', 'bundleHints', 'engineHooks'
];

const SECRET = 'SECRET_STRING_CONTENT_DO_NOT_PRINT';

let CORE_CACHE = null;
function loadCore() {
  if (CORE_CACHE) return CORE_CACHE;
  const i0 = SRC.indexOf(BEGIN);
  const i1 = SRC.indexOf(END);
  assert.ok(i0 >= 0, '源码必须含 ' + BEGIN);
  assert.ok(i1 > i0, '源码必须含 ' + END + ' 且位于 BEGIN 之后');
  const core = SRC.slice(i0 + BEGIN.length, i1);
  assert.ok(core.includes('function collectFrom('), 'core 区必须定义 collectFrom');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(core + '\n;globalThis.__collectFrom = collectFrom;globalThis.__engineState = engineState;globalThis.__lookLikeClient = lookLikeClient;', sandbox, { filename: 'probe-core.js' });
  assert.equal(typeof sandbox.__collectFrom, 'function', 'vm 里应能取到 collectFrom');
  assert.equal(typeof sandbox.__engineState, 'function', 'vm 里应能取到 engineState（就绪判据）');
  assert.equal(typeof sandbox.__lookLikeClient, 'function', 'vm 里应能取到 lookLikeClient（就绪判据）');
  CORE_CACHE = sandbox;
  return sandbox;
}
function loadCollectFrom() { return loadCore().__collectFrom; }

function el(tag) { return { nodeType: 1, tagName: tag, checked: false }; }

// 假目标窗口：带一个计数 getter、sendPacket 间谍、封包构造器间谍、只读存储
function makeFakeWin() {
  const calls = { sendPacket: 0, requestAct: 0, useSkill: 0, setItem: 0, removeItem: 0, clear: 0, getItem: 0, lsKey: 0, counterGetter: 0, bundleGetter: 0 };

  const mob = {
    objecttype: 5,
    GID: 12345,
    _job: 1,
    job: 1,
    position: { x: 1, y: 2, dir: 0 },
    life: { hp: 100, maxhp: 200, sp: 10, maxsp: 20 },
    action: 0
  };

  const EM = {
    forEach(cb) { cb(mob); },
    get() { return mob; }
  };

  const NM = {
    sendPacket() { calls.sendPacket++; },
    open() {}
  };

  const PS = {
    CZ: {
      REQUEST_ACT() { calls.requestAct++; },
      USE_SKILL() { calls.useSkill++; },
      NOT_A_FUNCTION: 1
    }
  };

  const SS = { Entity: { life: { hp: 1, maxhp: 2 } } };

  const modules = {
    'Renderer/EntityManager': EM,
    'Utils/PathFinding': { find: function () {} },
    'Engine/SessionStorage': SS,
    'Network/NetworkManager': NM,
    'Network/PacketStructure': PS
  };

  const LS_ENTRIES = [['dsh_ro_tp_global_v1', 'A'], ['dsh_ro_cfg_a', 'B'], ['other_key', 'C']];
  const localStorage = {
    get length() { return LS_ENTRIES.length; },
    key(i) { calls.lsKey++; return LS_ENTRIES[i] ? LS_ENTRIES[i][0] : null; },
    getItem() { calls.getItem++; return null; },
    setItem() { calls.setItem++; throw new Error('setItem 绝不允许被调用'); },
    removeItem() { calls.removeItem++; throw new Error('removeItem 绝不允许被调用'); },
    clear() { calls.clear++; throw new Error('clear 绝不允许被调用'); }
  };

  const doc = {
    map: {
      '#vbk': el('div'),
      '#vbk input.openattack': el('input'),
      'input.openattack': el('input'),
      '#chatbox': el('div'),
      '#chatbox .containers .border': el('div'),
      '#dsh-ro-panel': el('div'),
      '#dsh-ro-menu': el('div'),
      '#dsh-ball': el('div')
    },
    querySelector(sel) { return this.map[sel] || null; },
    querySelectorAll(sel) {
      if (sel === ASSIST_SEL) return [el('div'), el('span'), el('div')];
      return [];
    }
  };

  const win = {
    location: { href: 'http://127.0.0.1:8971/client/api.html' },
    require(name) { return Object.prototype.hasOwnProperty.call(modules, name) ? modules[name] : undefined; },
    CLIENT: { SS: SS, NM: NM, PS: PS },
    ROConfig: { something: true },
    __roeLocalClient: { engine: 'ok', started: 1 },
    __dshBattle: false,
    inAssistantUI: true,
    autoSecret: SECRET,
    document: doc,
    localStorage: localStorage
  };

  Object.defineProperty(win, 'autoCounter', {
    enumerable: true,
    configurable: true,
    get() { calls.counterGetter++; return 1; }
  });

  // 新增 bundleHints 探测的只读性观测点：只被读、绝不被写/删/重定义
  Object.defineProperty(win, '__roBrowser', {
    enumerable: true,
    configurable: true,
    get() { calls.bundleGetter++; return undefined; }
  });

  return { win: win, calls: calls, modules: modules, doc: doc, localStorage: localStorage, mob: mob };
}

test('1) collectFrom 在假 win 上实跑：约定字段齐全、类型正确、不抛错', () => {
  const collectFrom = loadCollectFrom();
  const { win } = makeFakeWin();

  let result = null;
  assert.doesNotThrow(() => { result = collectFrom(win); }, 'collectFrom 不应抛错');

  assert.equal(typeof result, 'object');
  for (const f of REQUIRED_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, f), '缺少约定字段: ' + f);
  }

  assert.equal(result.href, 'http://127.0.0.1:8971/client/api.html');
  assert.equal(result.hasRequire, 'function');
  assert.equal(result.hasClient, true);
  assert.ok(Array.isArray(result.clientKeys), 'clientKeys 应为数组');
  assert.deepEqual([...result.clientKeys].sort(), ['NM', 'PS', 'SS']); // spread 回宿主 realm 再比对
  assert.ok(Array.isArray(result.globals), 'globals 应为数组');
  assert.ok(result.globals.includes('CLIENT'), 'globals 应含 CLIENT');
  assert.equal(typeof result.globalsInfo, 'object');
  assert.equal(typeof result.globalsInfo.windowKeyCount, 'number');

  assert.ok(Array.isArray(result.requireProbe));
  assert.equal(result.requireProbe.length, 5);
  for (const e of result.requireProbe) {
    assert.equal(typeof e.module, 'string');
    assert.equal(typeof e.ok, 'boolean');
  }
  assert.equal(result.requireProbe[0].ok, true);
  assert.equal(result.moduleSources.EntityManager, 'window.require');
  assert.equal(result.moduleSources.NetworkManager, 'window.require');

  assert.equal(typeof result.entityProbe, 'object');
  assert.equal(result.entityProbe.entityCount, 1);
  assert.equal(result.entityProbe.firstMob.found, true);
  assert.equal(result.entityProbe.firstMob.objecttype.value, 5);
  assert.equal(result.entityProbe.firstMob.fieldTypes.life.ctor, 'Object');
  assert.ok(result.entityProbe.firstMob.ownKeys.includes('objecttype'));

  assert.equal(result.lifeProbe.exists, true);
  assert.equal(result.lifeProbe.hp, 100);
  assert.equal(result.lifeProbe.maxHp, 200);
  assert.equal(result.lifeProbe.hpIsNumber, true);
  assert.equal(result.lifeProbe.maxHpIsNumber, true);

  assert.equal(typeof result.packetProbe, 'object');
  assert.equal(result.packetProbe.nmSendPacketIsFunction, true);
  assert.equal(result.packetProbe.psCZExists, true);
  assert.equal(result.packetProbe.hasREQUEST_ACT, true);
  assert.equal(result.packetProbe.hasUSE_SKILL, true);
  assert.ok(Array.isArray(result.packetProbe.psCZFunctionKeys));
  assert.deepEqual([...result.packetProbe.psCZFunctionKeys].sort(), ['REQUEST_ACT', 'USE_SKILL']);

  assert.equal(typeof result.autoBattleProbe, 'object');
  assert.equal(result.autoBattleProbe.readOnly, true);
  assert.ok(Array.isArray(result.autoBattleProbe.dom));
  assert.equal(result.autoBattleProbe.dom.length, 8);
  assert.ok(Array.isArray(result.autoBattleProbe.globalFlags));

  assert.ok(Array.isArray(result.notes));

  // frame
  assert.equal(typeof result.frame, 'object');
  assert.equal(typeof result.frame.href, 'string');
  assert.equal(typeof result.frame.hasRequire, 'boolean');
  assert.equal(result.frame.hasRequire, true);
  assert.equal(result.frame.hasClient, true);
  assert.equal(result.frame.engine, true);
  assert.equal(typeof result.frame.engineType, 'string');
  assert.equal(result.frame.engineBooted, true);
  assert.equal(result.engineBooted, true);

  // 就绪判据 verdict + 新增采集字段
  assert.equal(typeof result.readiness, 'object');
  assert.equal(result.readiness.ready, true);
  assert.equal(result.readiness.engineBooted, true);
  assert.equal(result.readiness.hasRequire, true);
  assert.equal(result.readiness.hasClient, true);
  assert.ok(Array.isArray(result.roConfigKeys));
  assert.deepEqual([...result.roConfigKeys], ['something']);
  assert.equal(result.roConfigBaseKeys, null);
  assert.equal(typeof result.bundleHints, 'object');
  assert.equal(typeof result.engineHooks, 'object');
  assert.equal(result.engineHooks.name, '__roeLocalClient');
  assert.equal(result.engineHooks.valueTypes.engine, 'string');
  assert.equal(result.engineHooks.valueTypes.started, 'number');
  assert.ok([...result.engineHooks.keys].includes('started'));

  // assistant
  assert.equal(typeof result.assistant, 'object');
  assert.equal(typeof result.assistant.els, 'number');
  assert.equal(result.assistant.els, 3);
  assert.equal(typeof result.assistant.globals, 'object');
  assert.equal(typeof result.assistant.globals.count, 'number');
  assert.equal(result.assistant.globals.count, 2);
  assert.deepEqual([...result.assistant.globals.hits].sort(), ['__dshBattle', 'inAssistantUI']);
  assert.equal(typeof result.assistant.storageKeys, 'object');
  assert.equal(typeof result.assistant.storageKeys.count, 'number');
  assert.equal(result.assistant.storageKeys.count, 2);
  assert.deepEqual([...result.assistant.storageKeys.keys], ['dsh_ro_tp_global_v1', 'dsh_ro_cfg_a']);

  // 字符串内容绝不外泄（只给 length）
  const json = JSON.stringify(result);
  assert.ok(json.includes('autoSecret'), '键名应出现');
  assert.ok(!json.includes(SECRET), '字符串取值绝不允许出现在输出里');
  assert.ok(json.includes('"length"'), '字符串应只给长度');
});

test('2) collectFrom(null) 走「未就绪」分支：不抛错、字段齐全、notes 非空', () => {
  const collectFrom = loadCollectFrom();
  let result = null;
  assert.doesNotThrow(() => { result = collectFrom(null); });
  for (const f of REQUIRED_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, f), '缺少约定字段: ' + f);
  }
  assert.equal(result.frame, null);
  assert.equal(result.assistant, null);
  assert.ok(result.notes.length > 0, '未就绪必须留下说明，不能静默');
});

test('3) 只读性：sendPacket/封包构造器 0 调用、假 win 键集合未被写入、存储只枚举键名', () => {
  const collectFrom = loadCollectFrom();
  const { win, calls } = makeFakeWin();

  const keysBefore = Object.keys(win);
  const nmBefore = win.CLIENT.NM;
  const sendPacketBefore = win.CLIENT.NM.sendPacket;
  const lsKeysBefore = win.localStorage.length;

  assert.doesNotThrow(() => { collectFrom(win); });

  // 间谍调用数必须为 0
  assert.equal(calls.sendPacket, 0, 'sendPacket 调用数必须为 0');
  assert.equal(calls.requestAct, 0, 'REQUEST_ACT 调用数必须为 0');
  assert.equal(calls.useSkill, 0, 'USE_SKILL 调用数必须为 0');

  // 存储：不写、不读值，只枚举键名
  assert.equal(calls.setItem, 0, 'localStorage.setItem 调用数必须为 0');
  assert.equal(calls.removeItem, 0, 'localStorage.removeItem 调用数必须为 0');
  assert.equal(calls.clear, 0, 'localStorage.clear 调用数必须为 0');
  assert.equal(calls.getItem, 0, 'localStorage.getItem 调用数必须为 0（只枚举键名，不读值）');
  assert.equal(calls.lsKey, lsKeysBefore, '应恰好枚举一遍键名: ' + lsKeysBefore);

  // 目标窗口未被写入：可枚举键集合前后一致
  const keysAfter = Object.keys(win);
  assert.deepStrictEqual(keysAfter, keysBefore, '假 win 可枚举键集合必须与运行前一致（未被写入）');
  assert.equal(win.CLIENT.NM, nmBefore, '既有对象引用不得被替换');
  assert.equal(win.CLIENT.NM.sendPacket, sendPacketBefore, '既有方法引用不得被替换');

  // 计数 getter：确被读取过，且只读不写
  assert.ok(calls.counterGetter >= 1, '计数 getter 应被读取（证明读取路径生效）');
  assert.equal(win.autoCounter, 1, 'getter 返回值未被改动');

  // 新增 bundleHints 探测同样是只读：只读 getter，绝不写入 / 删除 / 重定义
  assert.ok(calls.bundleGetter >= 1, '新增 bundle 探测应读取到 __roBrowser getter（读取路径生效）');
  const bundleDesc = Object.getOwnPropertyDescriptor(win, '__roBrowser');
  assert.equal(typeof bundleDesc.get, 'function', '既有 getter 不得被替换');
  assert.equal(bundleDesc.set, undefined, '探测不得给既有属性加 setter');
  assert.equal(win.__roBrowser, undefined, 'getter 原返回值未被改动');
});

test('4) 静态断言：源码不含存储写入 / new CLIENT. / .sendPacket(', () => {
  assert.ok(!SRC.includes('localStorage.setItem'), '不得出现 localStorage.setItem');
  assert.ok(!SRC.includes('sessionStorage.setItem'), '不得出现 sessionStorage.setItem');
  assert.ok(!SRC.includes('localStorage.removeItem'), '不得出现 localStorage.removeItem');
  assert.ok(!SRC.includes('sessionStorage.removeItem'), '不得出现 sessionStorage.removeItem');
  assert.ok(!SRC.includes('new CLIENT.'), '不得出现 new CLIENT.');
  assert.ok(!SRC.includes('.sendPacket('), '不得出现 .sendPacket(');
});

test('5) 头部 @match 覆盖 8971 与 localhost:8971，@grant none、@run-at document-idle', () => {
  assert.match(SRC, /^\/\/ ==UserScript==/m, '必须有油猴头部');
  assert.match(SRC, /@match\s+http:\/\/127\.0\.0\.1:8971\/\*/);
  assert.match(SRC, /@match\s+http:\/\/localhost:8971\/\*/);
  assert.match(SRC, /@grant\s+none/);
  assert.match(SRC, /@run-at\s+document-idle/);
  assert.match(SRC, /@name\s+私有客户端只读探针/);
  assert.match(SRC, /@namespace\s+dsh\.ro-probe/);
  assert.match(SRC, /@version\s+1\.0\.0/);
  const matches = SRC.match(/^\/\/ @match\s+\S+/gm) || [];
  assert.equal(matches.length, 2, '应恰好两条 @match（8971 / localhost:8971）');
});

test('6) node --check tools/private-client-probe.user.js 通过', () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', SRC_PATH], { stdio: 'pipe' });
  }, 'node --check 必须无输出通过');
});

test('7) 有界重试：500ms / 60s 上限，且就绪或超时必须 clearInterval', () => {
  assert.match(SRC, /var POLL_MS = 500;/);
  assert.match(SRC, /var DEADLINE_MS = 60000;/);
  assert.match(SRC, /setInterval\(tick, POLL_MS\)/);
  assert.match(SRC, /clearInterval\(timer\)/);
  // 只有一处 setInterval，避免额外定时器
  const intervals = SRC.match(/setInterval\(/g) || [];
  assert.equal(intervals.length, 1, '只允许一个 setInterval（等 iframe 就绪）');
  assert.match(SRC, /#roeFrame/, '必须优先解析 #roeFrame');
  assert.match(SRC, /contentWindow/, '必须走 contentWindow');
  assert.match(SRC, /__roeLocalClient/, 'frame.engine 需探测 __roeLocalClient');
});

test('8) 输出与上报：console.log 完整 JSON、copy() 可选、POST 到 8899', () => {
  assert.match(SRC, /console\.log\(json\)/);
  assert.match(SRC, /typeof copy === 'function'/);
  assert.match(SRC, /http:\/\/127\.0\.0\.1:8899\/api\/probe-collect/);
  assert.match(SRC, /已发送到本机 8899/);
});

// ================= 就绪判据修正 + bundle 暴露方式探测（本次新增，既有断言全部保留） =================

test('9) 就绪判据：单独 ROConfig 不判就绪；(a)/(b)/(c) 任一成立即就绪', () => {
  const { __engineState: engineState, __lookLikeClient: lookLikeClient } = loadCore();

  // 只给 ROConfig → 不得判为就绪（宿主页静态 Config.js 不代表引擎在跑）
  const roOnly = { ROConfig: { a: 1 } };
  assert.equal(engineState(roOnly).ready, false, '单独 win.ROConfig 不得构成就绪');
  assert.equal(engineState(roOnly).engineBooted, false);
  assert.equal(lookLikeClient(roOnly), false);

  // (a) __roeLocalClient 存在且 started 为真值
  const booted = { __roeLocalClient: { engine: 'roBrowserLegacy', started: 123 } };
  const s1 = engineState(booted);
  assert.equal(s1.ready, true, '__roeLocalClient.started 为真值必须判就绪');
  assert.equal(s1.engineBooted, true, 'engineBooted 语义 = (a) 成立');
  assert.equal(lookLikeClient(booted), true);

  // (a) 反例：存在但 started 非真值 → 不算就绪
  assert.equal(engineState({ __roeLocalClient: { engine: 'roBrowserLegacy' } }).ready, false);
  assert.equal(engineState({ __roeLocalClient: { started: 0 } }).ready, false);
  assert.equal(engineState({ __roeLocalClient: { started: false } }).ready, false);

  // (b) 只给 require 函数
  const reqOnly = { require: function () {} };
  const s2 = engineState(reqOnly);
  assert.equal(s2.ready, true);
  assert.equal(s2.hasRequire, true);
  assert.equal(lookLikeClient(reqOnly), true);

  // (c) 只给 CLIENT 对象
  const cliOnly = { CLIENT: {} };
  const s3 = engineState(cliOnly);
  assert.equal(s3.ready, true);
  assert.equal(s3.hasClient, true);
  assert.equal(lookLikeClient(cliOnly), true);

  // 空窗口 / null
  assert.equal(engineState({}).ready, false);
  assert.equal(engineState(null).ready, false);
  assert.equal(lookLikeClient(null), false);
});

test('10) collectFrom：ROConfig-only 时 readiness=false，notes 逐字写明「引擎未启动（宿主页已加载但未收到启动配置）」', () => {
  const collectFrom = loadCollectFrom();
  const NOT_BOOTED = '引擎未启动（宿主页已加载但未收到启动配置）';

  const roOnly = { location: { href: 'http://127.0.0.1:8971/client/api.html' }, ROConfig: { a: 1 } };
  const r = collectFrom(roOnly);
  assert.equal(r.readiness.ready, false, '只给 ROConfig 时不得判为就绪');
  assert.equal(r.readiness.engineBooted, false);
  assert.equal(r.engineBooted, false);
  assert.equal(r.frame.engineBooted, false);
  assert.equal(r.frame.roConfig, true);
  assert.deepEqual([...r.roConfigKeys], ['a']);
  assert.equal(r.roConfigBaseKeys, null);
  assert.ok([...r.notes].includes(NOT_BOOTED), 'notes 必须逐字包含「' + NOT_BOOTED + '」');
  assert.ok(!JSON.stringify(r).includes('接口不存在'), '不得把「引擎没启动」写成「接口不存在」');

  const booted = { location: { href: 'http://127.0.0.1:8971/client/api.html' }, __roeLocalClient: { engine: 'roBrowserLegacy', started: 123 } };
  const r2 = collectFrom(booted);
  assert.equal(r2.engineBooted, true);
  assert.equal(r2.readiness.ready, true);
  assert.ok(![...r2.notes].includes(NOT_BOOTED), '引擎已启动时不得再写「引擎未启动」');
});

test('11) bundleHints/engineHooks：结构齐全；没有这些全局时不抛错且值为 null/false；有则只读识别', () => {
  const collectFrom = loadCollectFrom();
  const ESM_KEYS = ['__vite__', '__esModule', '__roBrowser', 'roBrowser', 'roBrowserLegacy', 'Engine', 'Renderer', 'Network'];
  const KNOWN = ['__roeLocalClient', 'ROConfig', 'ROConfigBase'];

  const bare = { location: { href: 'http://127.0.0.1:8971/client/api.html' } };
  let r = null;
  assert.doesNotThrow(() => { r = collectFrom(bare); }, '没有 bundle 全局时不得抛错');
  const bh = r.bundleHints;
  assert.equal(typeof bh, 'object');
  assert.equal(bh.error, null);
  for (const g of ['webpack', 'systemjs', 'amd', 'requirejs', 'esm', 'known', 'globalsInfo']) {
    assert.equal(typeof bh[g], 'object', 'bundleHints.' + g + ' 必须是对象');
  }
  assert.equal(bh.webpack.chunkGlobals, null);
  assert.equal(bh.webpack.chunkGlobalCount, 0);
  assert.equal(bh.webpack.chunkGlobalsCapped, false);
  assert.equal(bh.webpack.webpackRequire.exists, false);
  assert.equal(bh.webpack.webpackRequire.type, null);
  assert.equal(bh.webpack.webpackJsonp.exists, false);
  assert.equal(bh.systemjs.exists, false);
  assert.equal(bh.systemjs.type, null);
  assert.equal(bh.systemjs.constructorName, null);
  assert.equal(bh.amd.defineExists, false);
  assert.equal(bh.amd.defineType, null);
  assert.equal(bh.amd.amdType, null);
  assert.equal(bh.requirejs.requirejs.exists, false);
  assert.equal(bh.requirejs.requirejs.type, null);
  assert.equal(bh.requirejs.require.type, null);
  for (const k of ESM_KEYS) {
    assert.equal(bh.esm[k].exists, false, 'esm.' + k + ' 不存在时应 exists:false');
    assert.equal(bh.esm[k].type, null, 'esm.' + k + ' 取不到时 type 必须为 null');
  }
  for (const k of KNOWN) {
    assert.equal(bh.known[k].exists, false);
    assert.equal(bh.known[k].type, null);
    assert.equal(bh.known[k].keys, null);
  }
  assert.equal(bh.globals, null);
  assert.equal(bh.globalsInfo.matchedCount, 0);
  assert.equal(r.engineHooks, null, '没有 __roeLocalClient 时 engineHooks 必须为 null');

  // 有 bundle 全局：只列名 / 取 typeof，绝不执行
  const SysCtor = function System() {};
  const rich = {
    location: { href: 'http://127.0.0.1:8971/client/api.html' },
    webpackChunkROE: [],
    webpackChunkVendor: [],
    __webpack_require__: function () {},
    webpackJsonp: [],
    System: new SysCtor(),
    define: function () {},
    requirejs: function () {},
    roBrowserLegacy: {},
    __vite__: true,
    ROConfig: { a: 1 },
    __roeLocalClient: { engine: 'roBrowserLegacy', started: 1 }
  };
  rich.define.amd = {};
  const r2 = collectFrom(rich);
  const b2 = r2.bundleHints;
  assert.deepEqual([...b2.webpack.chunkGlobals].sort(), ['webpackChunkROE', 'webpackChunkVendor']);
  assert.equal(b2.webpack.chunkGlobalCount, 2);
  assert.equal(b2.webpack.chunkGlobalsCapped, false);
  assert.equal(b2.webpack.webpackRequire.exists, true);
  assert.equal(b2.webpack.webpackRequire.type, 'function');
  assert.equal(b2.webpack.webpackJsonp.exists, true);
  assert.equal(b2.systemjs.exists, true);
  assert.equal(b2.systemjs.type, 'object');
  assert.equal(b2.systemjs.constructorName, 'System');
  assert.equal(b2.amd.defineExists, true);
  assert.equal(b2.amd.defineType, 'function');
  assert.equal(b2.amd.amdType, 'object');
  assert.equal(b2.requirejs.requirejs.type, 'function');
  assert.equal(b2.requirejs.require.exists, false);
  assert.equal(b2.requirejs.require.type, null);
  assert.equal(b2.esm.roBrowserLegacy.exists, true);
  assert.equal(b2.esm.roBrowserLegacy.type, 'object');
  assert.equal(b2.esm.__vite__.type, 'boolean');
  assert.equal(b2.known.__roeLocalClient.exists, true);
  assert.equal(b2.known.__roeLocalClient.keyCount, 2);
  assert.deepEqual([...b2.known.__roeLocalClient.keys].sort(), ['engine', 'started']);
  assert.deepEqual([...b2.known.ROConfig.keys], ['a']);
  assert.equal(b2.known.ROConfigBase.exists, false);
  assert.ok([...b2.globals].includes('roBrowserLegacy'), 'globals 清单应含 roBrowserLegacy');
  assert.ok([...b2.globals].includes('__roeLocalClient'), 'globals 清单应含 __roeLocalClient');
  assert.equal(b2.globalsInfo.cap, 60);
  assert.ok(b2.globalsInfo.matchedCount >= 2);

  // engineHooks：键名 + 各值 typeof（上限 40）
  assert.equal(typeof r2.engineHooks, 'object');
  assert.equal(r2.engineHooks.name, '__roeLocalClient');
  assert.equal(r2.engineHooks.maxKeys, 40);
  assert.equal(r2.engineHooks.keyCount, 2);
  assert.equal(r2.engineHooks.capped, false);
  assert.deepEqual([...r2.engineHooks.keys].sort(), ['engine', 'started']);
  assert.equal(r2.engineHooks.valueTypes.engine, 'string');
  assert.equal(r2.engineHooks.valueTypes.started, 'number');
  assert.equal(r2.readiness.engineBooted, true);
});

test('12) 新增逻辑不执行任何加载器：源码不含 eval( / new Function( / 动态 import( / 加载器调用', () => {
  assert.ok(!SRC.includes('eval('), '不得出现 eval(');
  assert.ok(!SRC.includes('new Function('), '不得出现 new Function(');
  assert.ok(!/\bimport\s*\(/.test(SRC), '不得出现动态 import(');
  assert.ok(!SRC.includes('__webpack_require__('), '不得调用 webpack 加载器');
  assert.ok(!/webpackChunk\w*\s*[.\[]/.test(SRC), '不得取用 webpackChunk* 加载器');
  assert.ok(!/\.amd\s*\(/.test(SRC), '不得调用 define.amd');
  assert.ok(!/requirejs\s*\(/.test(SRC), '不得调用 requirejs');
  assert.ok(!/\bSystem\s*\.\s*(import|register|set|delete|get)\s*\(/.test(SRC), '不得调用 System 加载器方法');
  // 反向证据：这些全局确实被「只读探测」
  for (const probe of ["probeGlobal(win, 'System')", "probeGlobal(win, '__webpack_require__')", "probeGlobal(win, 'define')", "probeGlobal(win, 'requirejs')", "probeGlobal(win, 'webpackJsonp')"]) {
    assert.ok(SRC.includes(probe), '必须只读探测：' + probe);
  }
  assert.ok(SRC.includes('ESM_KEYS'), '必须探测 esm 线索全局');
  assert.ok(SRC.includes('BUNDLE_RE'), '必须有关键词清单正则');
});

test('13) 命中 (a) 后等引擎挂全局：ENGINE_GRACE_MS=3000、期间按 POLL_MS 复查、总上限仍是 DEADLINE_MS', () => {
  assert.match(SRC, /var ENGINE_GRACE_MS = 3000;/);
  assert.match(SRC, /var DEADLINE_MS = 60000;/);
  assert.match(SRC, /var POLL_MS = 500;/);
  assert.ok(SRC.includes('var st = engineState(t.win);'), 'tick 必须复查就绪判据');
  assert.ok(SRC.includes('if (st.hasRequire || st.hasClient) { stop(); finalize(t.win, t.how, true, tries); return; }'), '(b)/(c) 挂上后立即快照');
  assert.ok(SRC.includes('if (!engineGraceAt) engineGraceAt = now;'), '必须记录首次命中 (a) 的时刻');
  assert.ok(SRC.includes('if ((now - engineGraceAt) >= ENGINE_GRACE_MS) { stop(); finalize(t.win, t.how, true, tries); return; }'), 'grace 到期才 finalize');
  assert.ok(SRC.includes('if ((Date.now() - startedAt) >= DEADLINE_MS)'), '总等待上限仍必须是 60 秒');
  assert.ok(SRC.includes('if (timer === null) timer = setInterval(tick, POLL_MS);'), '轮询仍由 tick 内唯一的 setInterval 启动');
  const intervals = SRC.match(/setInterval\(/g) || [];
  assert.equal(intervals.length, 1, '只允许一个 setInterval');
});
