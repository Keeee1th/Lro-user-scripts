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
  'autoBattleProbe', 'notes', 'frame', 'assistant'
];

const SECRET = 'SECRET_STRING_CONTENT_DO_NOT_PRINT';

function loadCollectFrom() {
  const i0 = SRC.indexOf(BEGIN);
  const i1 = SRC.indexOf(END);
  assert.ok(i0 >= 0, '源码必须含 ' + BEGIN);
  assert.ok(i1 > i0, '源码必须含 ' + END + ' 且位于 BEGIN 之后');
  const core = SRC.slice(i0 + BEGIN.length, i1);
  assert.ok(core.includes('function collectFrom('), 'core 区必须定义 collectFrom');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(core + '\n;globalThis.__collectFrom = collectFrom;', sandbox, { filename: 'probe-core.js' });
  assert.equal(typeof sandbox.__collectFrom, 'function', 'vm 里应能取到 collectFrom');
  return sandbox.__collectFrom;
}

function el(tag) { return { nodeType: 1, tagName: tag, checked: false }; }

// 假目标窗口：带一个计数 getter、sendPacket 间谍、封包构造器间谍、只读存储
function makeFakeWin() {
  const calls = { sendPacket: 0, requestAct: 0, useSkill: 0, setItem: 0, removeItem: 0, clear: 0, getItem: 0, lsKey: 0, counterGetter: 0 };

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
    __roeLocalClient: { engine: 'ok' },
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
