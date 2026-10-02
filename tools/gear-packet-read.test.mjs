// V2.38.7 装备包流读取专项测试（只读路线①：整表五版 + 穿脱确认 + 分帧补充表 + complete 门）
//   全部用例跑两文件（stable CRLF / exp LF）；帧用手搭真字节，驱动真实源码切片（零桩替身语义）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (f) => fs.readFileSync(path.join(here, '..', f), 'utf8');
const splitSources = [['stable', readSrc('ro-assist.user.js')], ['exp', readSrc('ro-assist-exp.user.js')]];
const lf = (s) => s.replace(/\r\n/g, '\n');
function cut(s, a, b) {
  const i = s.indexOf(a), j = s.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, '切片锚点必须命中：' + a.slice(0, 46) + ' → ' + b.slice(0, 46));
  return s.slice(i, j);
}

// ================= 帧构造（手搭真字节） =================
const LIST_REC = { 1: 20, 2: 24, 3: 28, 4: 31, 5: 57 };
function writeRec(dv, b, ver, r) {
  const cards = r.cards || [];
  dv.setInt16(b, r.index, true); dv.setUint16(b + 2, r.itid, true); dv.setUint8(b + 4, r.type || 0);
  if (ver >= 4) {
    dv.setUint32(b + 5, r.locRaw || 0, true); dv.setUint32(b + 9, r.wearMask || 0, true); dv.setUint8(b + 13, r.refine || 0);
    for (let c = 0; c < 4; c++) dv.setUint16(b + 14 + c * 2, cards[c] || 0, true);
    dv.setInt32(b + 22, r.expire || 0, true); dv.setUint16(b + 26, r.bind || 0, true); dv.setUint16(b + 28, r.sprite || 0, true);
    const opts = r.options || [];
    if (ver >= 5) {
      dv.setInt8(b + 30, opts.length);
      opts.forEach((o, i) => { const ob = b + 31 + i * 5; dv.setInt16(ob, o.index, true); dv.setInt16(ob + 2, o.value, true); dv.setInt8(ob + 4, o.param, true); });
      dv.setUint8(b + 56, (r.identified ? 1 : 0) | (r.damaged ? 2 : 0));
    } else dv.setUint8(b + 30, (r.identified ? 1 : 0) | (r.damaged ? 2 : 0));
  } else {
    dv.setUint8(b + 5, r.identified ? 1 : 0); dv.setUint16(b + 6, r.locRaw || 0, true); dv.setUint16(b + 8, r.wearMask || 0, true);
    dv.setUint8(b + 10, r.damaged ? 1 : 0); dv.setUint8(b + 11, r.refine || 0);
    for (let c = 0; c < 4; c++) dv.setUint16(b + 12 + c * 2, cards[c] || 0, true);
    if (ver === 2) dv.setInt32(b + 20, r.expire || 0, true);
    if (ver === 3) { dv.setInt32(b + 20, r.expire || 0, true); dv.setUint16(b + 24, r.bind || 0, true); dv.setUint16(b + 26, r.sprite || 0, true); }
  }
}
function listFrame(op, ver, recs) {
  const rec = LIST_REC[ver], buf = new ArrayBuffer(4 + recs.length * rec), dv = new DataView(buf);
  dv.setUint16(0, op, true); dv.setUint16(2, buf.byteLength, true);
  recs.forEach((r, i) => writeRec(dv, 4 + i * rec, ver, r));
  return buf;
}
const ACK_LEN = { 170: 9, 2256: 9, 2457: 11, 172: 7, 2257: 7, 2458: 9 };
function ackFrame(op, o) {
  const len = ACK_LEN[op], buf = new ArrayBuffer(len), dv = new DataView(buf);
  dv.setUint16(0, op, true); dv.setUint16(2, o.index, true);
  if (len >= 11) dv.setUint32(4, o.loc || 0, true); else dv.setUint16(4, o.loc || 0, true);
  dv.setUint8(len - 1, o.raw);
  return buf;
}
function zoneFrame(gid, map) {
  const buf = new ArrayBuffer(6 + 16), dv = new DataView(buf);
  dv.setUint16(0, 113, true); dv.setUint16(2, buf.byteLength, true); dv.setUint32(2, gid, true);
  dv.setUint16(0, 113, true); dv.setUint16(2, buf.byteLength, true);
  const m = String(map || 'prontera');
  for (let i = 0; i < 16; i++) dv.setUint8(6 + i, i < m.length ? m.charCodeAt(i) : 0);
  return buf;
}
function concat(...bufs) {
  const total = bufs.reduce((n, b) => n + b.byteLength, 0), out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(new Uint8Array(b), off); off += b.byteLength; }
  return out.buffer;
}

// ================= 世界 =================
function psWith(entries) {
  const ZC = {}, CZ = {};
  for (const [name, id, size] of entries) { const S = function () {}; S.id = id; S.size = size; ZC[name] = S; }
  return { ZC, CZ };
}
const PS_MAIN = () => psWith([
  ['EQUIPMENT_ITEMLIST', 164, -1], ['EQUIPMENT_ITEMLIST2', 661, -1], ['EQUIPMENT_ITEMLIST3', 720, -1], ['EQUIPMENT_ITEMLIST4', 2450, -1], ['EQUIPMENT_ITEMLIST5', 2573, -1],
  ['REQ_WEAR_EQUIP_ACK', 170, 0], ['REQ_TAKEOFF_EQUIP_ACK', 172, 7], ['REQ_WEAR_EQUIP_ACK2', 2256, 9], ['REQ_TAKEOFF_EQUIP_ACK2', 2257, 7],
  ['ACK_WEAR_EQUIP_V5', 2457, 0], ['ACK_TAKEOFF_EQUIP_V5', 2458, 9],
  ['NOTIFY_ZONESVR', 113, -1], ['NOTIFY_ZONESVR2', 2757, -1], ['ACCEPT_ENTER_NEO_UNION', 107, -1],
]);
function world(src, opt = {}) {
  const s = lf(src);
  const code = [
    cut(s, '  function dispatchInbound(bytes) {', '  function onSelfSpirits('),
    cut(s, '  var GEAR_SLOTS = [', '  function gearReadEquipped() {'),
    cut(s, '  function gearReadEquipped() {', '  function gearApply('),
    cut(s, '  function gearApply(', '  function gearAfterDeck('),
  ].join('\n');
  const log = [], statuses = [], packets = [];
  const CZ = { REQ_TAKEOFF_EQUIP: function () { this.op = 'off'; }, REQ_WEAR_EQUIP: function () { this.op = 'on'; } };
  const profiles = opt.profiles || { ch999: { charId: 999, gearSets: { list: [], sel: '' } } };
  const ctx = {
    Date, Math, Number, String, Object, Array, JSON, isFinite, parseInt, DataView, Uint8Array, console, NaN,
    CLIENT: {
      SS: opt.ss === undefined ? { AID: 999, GID: 999, Entity: { GID: 999 } } : opt.ss,
      PS: opt.ps === undefined ? PS_MAIN() : opt.ps,
      NM: { sendPacket: (p) => packets.push({ op: p.op, index: p.index, wearLocation: p.wearLocation }) },
      DB: null, EquipmentLocation: {},
    },
    CZ, czp: (name) => CZ[name],
    profiles, activeProfileKey: () => 'ch999', profileTrusted: () => true, profWriteGuard: () => true,
    selfCharId: () => 999, selfName: () => '测试', ensureProfile: () => {}, saveProfiles: () => {},
    setStatus: (m, k) => statuses.push(String(m)), gearLog: (m) => log.push(String(m)),
    identityLog: { blocked: {}, last: 0 }, identityLogLine: (m) => log.push('ID:' + m), identityEpoch: 0,
    pendingEditsDrop: () => {}, pendingEditsTouch: () => {},
    selfSpirits: { aid: 0, num: 0, map: '' }, txCap: { on: false, ring: [], n: 0, drop: 0 },
    collectOpStat() {}, itipPktProbe() {}, DPS_PKTS: [], dpsParsedSeen: false,
    dpsOnRawDamage() {}, scrOnRawVanish() {}, onMenuList() {}, onSayDialog() {}, onCloseDialog() {},
    onSkillPostDelay() {}, onSkillAck3() {}, itipShopPkt() {}, onRawOpcode() {}, blockMcHit() {}, onSelfSpirits() {},
    gidInt: (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; },
    normMapKey: (m) => String(m || '').toLowerCase(), getMapName: () => 'prontera', dshSphereLog() {},
    requireDB: () => null, gearLocation: (n, fallback) => fallback,
    // 切片内真实实现的驱动器：gearEquipmentComp() 走 uiComp("Equipment")，gearEqRoot() 走 EQ.getRoot()，
    //   gearDomIdx() 走 root.querySelector(".<cls> .item[data-index]") —— 用真依赖驱动真实现，不替换语义。
    uiComp: (n) => (n === 'Equipment' ? (opt.eq || null) : (n === 'Inventory' ? (opt.inv || null) : null)),
    bagItemByIndex: opt.bagItemByIndex === undefined ? (() => null) : opt.bagItemByIndex,
    clientReady: () => true, gearWatchdog: null, gearAfterDeck() {}, gearDeckSnapshot: () => ({ ok: false, cards: [], wasOpen: false }),
    gearCardComp: () => null, gearCardTabMap: () => null, GEAR_HK_PRE: 'gearpreset:',
    bagList: () => null, findInventory: () => null, bagRead: { source: 'stub', count: 0, arrows: 0 }, clientUIManager: () => null, gearCharLabel: () => '测试',
    $id: () => null, navigator: {}, localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 1; }, clearTimeout() {}, VER: '2.38.7',
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.W={dispatchInbound,walkInboundFrames,framePartialGet:()=>framePartial,gearPkt,gearPktHook,'
    + 'gearPktSnapshot,gearPktReset,gearPktOps,gearPktDiagText,gearPktParseList,gearPktParseAck,gearPktParseSplit2,gearPktParseSess,GEAR_SLOTS,gearReadEquipped,'
    + 'gearApply,gearSigEqual,gearName,zcLenTable};', ctx);
  const W = ctx.W;
  return { ctx, W, log, statuses, packets, profiles, blob: (v) => JSON.stringify(v) };
}
const DOM_ROOT = { querySelector: (sel) => (sel.indexOf('.weapon ') === 0 ? { getAttribute: () => '7' } : null) };
// 部分快照世界：有装备窗口 DOM、没有 isInEquipList → 只看得见「有东西的槽」→ ok=true / complete=false
function partialOpt() {
  return {
    eq: { name: 'Equipment', getRoot: () => DOM_ROOT },
    bagItemByIndex: (i) => (i === 7 ? { ITID: 1101, index: 7, RefiningLevel: 0, slot: { card1: 0 } } : null),
    profiles: { ch999: { charId: 999, gearSets: { list: [{ id: 'x', name: '套', at: 1, eq: { 2: { itid: 9999, refine: 0, cards: [], idx: 5 } } }], sel: 'x' } } },
  };
}
function mutantKill(label, oldStr, newStr, expectFail, makeWorld) {
  const build = makeWorld || world;
  for (const [name, src] of splitSources) {
    const base = lf(src);
    assert.equal(base.split(oldStr).length - 1, 1, label + ' 变异锚点必须唯一（' + name + '）');
    const code = base.split(oldStr).join(newStr);
    assert.notEqual(code, base, label + ' 变异必须改变源码');
    let failed = false, msg = '';
    try { expectFail(build(code)); } catch (e) { failed = true; msg = String((e && e.message) || e); }
    assert.ok(failed, label + ' 变异体必须被真实断言杀死（' + name + '）');
    console.log('[V2.38.7 变异][' + name + '] ' + label + ' 被杀死：' + msg.split(String.fromCharCode(10))[0].slice(0, 120));
  }
}

// ================= G1：整表五版逐字段 =================
test('V2.38.7 G1 整表五版：记录长 20/24/28/31/57 逐字段解析（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    const OP = { 1: 164, 2: 661, 3: 720, 4: 2450, 5: 2573 };
    const rec = { index: 7, itid: 1101, type: 4, refine: 7, cards: [4001, 4002], wearMask: 2, identified: true, damaged: false, expire: 1234, bind: 1, sprite: 99 };
    for (const ver of [1, 2, 3, 4, 5]) {
      const r = { ...rec, options: ver >= 5 ? [{ index: 1, value: 5, param: 2 }] : undefined };
      B.W.dispatchInbound(listFrame(OP[ver], ver, [r]));
      const p = B.W.gearPkt;
      assert.equal(p.complete, true, name + ' v' + ver + ' 非空整表必须 complete');
      assert.equal(p.ver, ver, name + ' v' + ver + ' 版本必须识别');
      assert.equal(p.rec, LIST_REC[ver], name + ' v' + ver + ' 记录长必须识别');
      assert.equal(p.n, 1, name + ' v' + ver + ' 条数');
      const sl = p.slots[2];
      assert.ok(sl, name + ' v' + ver + ' 必须命中武器槽（mask 2）');
      assert.equal(sl.itid, 1101, name + ' v' + ver + ' ITID');
      assert.equal(sl.refine, 7, name + ' v' + ver + ' 精炼');
      assert.equal(B.blob(sl.cards), '[4001,4002]', name + ' v' + ver + ' 卡片');
      assert.equal(sl.idx, 7, name + ' v' + ver + ' idx');
      assert.equal(sl.identified, true, name + ' v' + ver + ' 已鉴定');
      assert.equal(sl.damaged, false, name + ' v' + ver + ' 未损坏');
      assert.equal(sl.src, 'packet', name + ' v' + ver + ' 来源路线');
      // 未知字段必须标未知：非 2573 版没有随机词条；五版都没有 enchantgrade
      assert.equal(sl.enchantKnown, false, name + ' v' + ver + ' 附魔必须标未知');
      assert.equal(sl.enchantgrade, null, name + ' v' + ver + ' 附魔绝不填 0');
      if (ver >= 5) { assert.equal(sl.optionsKnown, true, name + ' v5 词条已知'); assert.equal(B.blob(sl.options), '[{"index":1,"value":5,"param":2}]', name + ' v5 词条值'); }
      else { assert.equal(sl.optionsKnown, false, name + ' v' + ver + ' 词条必须标未知'); assert.equal(sl.options, null, name + ' v' + ver + ' 词条绝不填空数组'); }
    }
    // 多槽 + v4 尾部 flag 位（bit1=damaged）
    const B2 = world(src);
    B2.W.dispatchInbound(listFrame(2450, 4, [{ index: 3, itid: 2222, wearMask: 64, refine: 0, damaged: true, cards: [] }, { index: 9, itid: 3333, wearMask: 128 }]));
    assert.equal(B2.W.gearPkt.n, 2, name + ' v4 两条');
    assert.equal(B2.W.gearPkt.slots[64].damaged, true, name + ' v4 flag bit1=damaged');
    assert.equal(B2.W.gearPkt.byIndex[9].itid, 3333, name + ' byIndex 必须按 index 建索引');
  }
});

test('V2.38.7 G12 未知字段不判「一致」：v1 帧 vs 含词条预设（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    B.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, refine: 7, cards: [4001], wearMask: 2 }]));
    const have = B.W.gearPkt.slots[2];
    const wantOpt = { itid: 1101, refine: 7, cards: [4001], options: [{ index: 1, value: 5, param: 2 }] };
    assert.equal(B.W.gearSigEqual(wantOpt, have), false, name + ' 预设要词条、包流读不到 → 绝不判一致');
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001] }, have), true, name + ' 预设不要词条 → 其余一致即一致');
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001], enchantgrade: 3 }, have), false, name + ' 预设要附魔、包流读不到 → 绝不判一致');
  }
  mutantKill('M5 未知字段填成「空数组 + 已知」',
    'options: it.optionsKnown ? it.options : null, optionsKnown: !!it.optionsKnown,',
    'options: it.options || [], optionsKnown: true,',
    (B) => {
      B.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, refine: 7, cards: [4001], wearMask: 2 }]));
      const sl = B.W.gearPkt.slots[2];
      assert.equal(sl.optionsKnown, false, '词条必须标未知');
      assert.equal(sl.options, null, '词条绝不为空数组');
    });
});

// ================= G2：穿脱确认六种 + 成功语义 =================
test('V2.38.7 G2 穿脱确认 170/172/2256/2257/2457/2458：直读与取反都必须正确（两文件）', () => {
  for (const [name, src] of splitSources) {
    const CASES = [
      [170, 'wear', 9, false], [2256, 'wear', 9, true], [2457, 'wear', 11, true],
      [172, 'takeoff', 7, false], [2257, 'takeoff', 7, true], [2458, 'takeoff', 9, true],
    ];
    for (const [op, kind, len, inv] of CASES) {
      for (const raw of [0, 1]) {
        const B = world(src);
        B.W.dispatchInbound(ackFrame(op, { index: 42, loc: 2, raw }));
        const d = B.W.gearPkt.dirty[42];
        assert.ok(d, name + ' op' + op + ' 必须记 dirty[index]（raw=' + raw + '）');
        assert.equal(d.kind, kind, name + ' op' + op + ' 类型');
        assert.equal(d.op, op, name + ' op' + op + ' opcode');
        assert.equal(d.raw, raw, name + ' op' + op + ' 原值');
        assert.equal(d.ok, inv ? (raw === 0) : (raw !== 0), name + ' op' + op + ' 成功语义（inv=' + inv + ' raw=' + raw + '）');
        assert.equal(B.W.gearPkt.ackN, 1, name + ' op' + op + ' ack 计数');
        assert.equal(B.W.gearPkt.complete, false, name + ' op' + op + ' 只有 ack 绝不算完整快照');
        assert.equal(Object.keys(B.W.gearPkt.slots).length, 0, name + ' op' + op + ' 默认不直接改槽（只标 dirty）');
      }
    }
    // 2457 的 wearLocation 是 u32，必须在 @4 读全 4 字节
    const B = world(src);
    B.W.dispatchInbound(ackFrame(2457, { index: 5, loc: 70000, raw: 0 }));
    assert.equal(B.W.gearPkt.dirty[5].loc, 70000, name + ' 2457 wearLocation 必须按 u32 读');
    const B2 = world(src);
    B2.W.dispatchInbound(ackFrame(170, { index: 5, loc: 70000, raw: 1 }));
    assert.equal(B2.W.gearPkt.dirty[5].loc, 70000 & 0xFFFF, name + ' 170 wearLocation 按 u16 读（口径与客户端类一致）');
  }
  mutantKill('M3 成功语义忽略取反（ACK2/V5 读反）',
    'var ok = f.inv ? (raw === 0) : (raw !== 0); // ACK2/V5 类内 result = !readUChar()',
    'var ok = raw !== 0; // 变异：忽略取反',
    (B) => {
      B.W.dispatchInbound(ackFrame(2256, { index: 42, loc: 2, raw: 0 }));
      assert.equal(B.W.gearPkt.dirty[42].ok, true, '2256 raw=0 必须算成功');
    });
});

// ================= G6：补充长度表 =================
test('V2.38.7 G6 分帧补充表：主表跳过 size=0 时，穿脱确认帧仍必须切出来（两文件）', () => {
  for (const [name, src] of splitSources) {
    // PS 里 170 声明 size=0（真实客户端如此）→ 主表跳过 → 靠 ZC_EXTRA_LEN 切帧
    const B = world(src);
    assert.equal(B.W.zcLenTable()[170], undefined, name + ' 前置：主表必须没有 170（size=0 被跳过）');
    const msg = concat(listFrame(164, 1, [{ index: 7, itid: 1101, wearMask: 2, refine: 3, cards: [] }]), ackFrame(170, { index: 7, loc: 2, raw: 1 }));
    B.W.dispatchInbound(msg);
    assert.equal(B.W.framePartialGet(), 0, name + ' 两个包必须被完整切分');
    assert.equal(B.W.gearPkt.complete, true, name + ' 整表必须被解析');
    assert.equal(B.W.gearPkt.slots[2].itid, 1101, name + ' 整表槽必须正确');
    assert.equal(B.W.gearPkt.dirty[7].raw, 1, name + ' 非首位的 170 帧必须被切出并解析');
    // 无主表（手机端 CLIENT.PS 拿不到）：首包不是补充表里的 op → 仍退化成整条一个包（旧行为）
    const C = world(src, { ps: null });
    assert.equal(C.W.zcLenTable(), null, name + ' 前置：无主表');
    C.W.dispatchInbound(msg);
    assert.equal(C.W.gearPkt.complete, false, name + ' 无主表时整条交付 → 帧长不整除必须拒绝解析（绝不错读）');
    assert.equal(C.W.gearPkt.n, 0, name + ' 无主表时绝不产出假槽');
  }
  mutantKill('M2 去掉补充长度表回退',
    'if (typeof size !== "number") size = ZC_EXTRA_LEN[op];',
    'if (false) size = ZC_EXTRA_LEN[op];',
    (B) => {
      B.W.dispatchInbound(concat(listFrame(164, 1, [{ index: 7, itid: 1101, wearMask: 2 }]), ackFrame(170, { index: 7, loc: 2, raw: 1 })));
      assert.ok(B.W.gearPkt.dirty[7], '170 帧必须被解析');
    });
  mutantKill('M11 去掉整表记录长整除校验（版本不符也硬解析）',
    'if (((total - 4) % f.rec) !== 0) { gearPkt.why =',
    'if (false) { gearPkt.why =',
    (B) => {
      B.W.dispatchInbound(concat(listFrame(164, 1, [{ index: 7, itid: 1101, wearMask: 2 }]), ackFrame(170, { index: 7, loc: 2, raw: 1 })));
      assert.equal(B.W.gearPkt.n, 0, '不整除必须拒绝解析');
    });
});

test('V2.38.7 G7 严格等长：整条消息被当一个包交付时绝不把后续字节读成字段（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null }); // 无主表 → 首包 170 在补充表里也只会切出 9B；这里直接喂超长帧
    const over = new ArrayBuffer(20), dv = new DataView(over);
    dv.setUint16(0, 170, true); dv.setUint16(2, 7, true); dv.setUint16(4, 2, true); dv.setUint16(6, 999, true); dv.setUint8(8, 1); dv.setUint8(10, 77);
    assert.equal(B.W.gearPktParseAck(over, 170, { kind: 'wear', len: 9, inv: false, loc32: false, resOff: 8 }), false, name + ' 长度不符必须拒绝');
    assert.equal(Object.keys(B.W.gearPkt.dirty).length, 0, name + ' 长度不符绝不记 dirty');
    const exact = ackFrame(170, { index: 7, loc: 2, raw: 1 });
    assert.equal(B.W.gearPktParseAck(exact, 170, { kind: 'wear', len: 9, inv: false, loc32: false, resOff: 8 }), true, name + ' 等长必须接受');
    assert.ok(B.W.gearPkt.dirty[7], name + ' 等长必须解析出 idx');
  }
  mutantKill('M8 去掉确认帧严格等长校验',
    'if (total !== f.len) { identityLogLine(',
    'if (false) { identityLogLine(',
    (B) => {
      const over = new ArrayBuffer(20), dv = new DataView(over);
      dv.setUint16(0, 170, true); dv.setUint16(2, 7, true); dv.setUint16(4, 2, true); dv.setUint16(6, 999, true); dv.setUint8(8, 1);
      assert.equal(B.W.gearPktParseAck(over, 170, { kind: 'wear', len: 9, inv: false, loc32: false, resOff: 8 }), false, '长度不符必须拒绝');
    });
});

// ================= G4 / G8：0 槽与进图清空 =================
test('V2.38.7 G4 空表 0 槽必须失败（绝不假装「已穿 0 件」）（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    B.W.dispatchInbound(listFrame(164, 1, []));
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, false, name + ' 0 槽必须 ok=false');
    assert.equal(cur.complete, false, name + ' 空表绝不算完整快照');
    assert.ok(String(cur.why).indexOf('0 槽') >= 0, name + ' why 必须写明 0 槽，实际=' + cur.why);
    assert.equal(B.W.gearPkt.n, 0, name + ' 空表条数 0');
  }
  mutantKill('M9 0 槽也当成成功', 'out.ok = (out.n > 0); // 0 槽必须失败（现状保留）：解析成功但 0 条绝不是「已穿 0 件」', 'out.ok = true; // 变异：0 槽也成功', (B) => {
    B.W.dispatchInbound(listFrame(164, 1, []));
    assert.equal(B.W.gearReadEquipped().ok, false, '0 槽必须失败');
  });
});

test('V2.38.7 G8 进图（113）必须清空整表 → 预检拒绝，绝不用上一张图的快照（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
    assert.equal(B.W.gearPkt.complete, true, name + ' 前置：整表已就绪');
    B.W.dispatchInbound(zoneFrame(999, 'prontera'));
    assert.equal(B.W.gearPkt.complete, false, name + ' 进图必须清 complete');
    assert.equal(Object.keys(B.W.gearPkt.slots).length, 0, name + ' 进图必须清槽');
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, false, name + ' 清空后没有客户端路线 → 必须 0 槽失败');
  }
  mutantKill('M6 进图不清空包流快照', '      gearPkt.complete = false; gearPkt.at = 0; gearPkt.n = 0; gearPkt.ver = 0; gearPkt.rec = 0; gearPkt.listOp = 0;', '      ', (B) => {
    B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
    B.W.dispatchInbound(zoneFrame(999, 'prontera'));
    assert.equal(B.W.gearPkt.complete, false, '进图必须清 complete');
  });
});

// ================= 路线优先级 / complete 门 =================
test('V2.38.7 路线①优先：组件全不可达（手机端）时包流必须顶上；客户端路线只补缺口（两文件）', () => {
  for (const [name, src] of splitSources) {
    // 手机端场景：uiComp(Equipment) 拿不到、没有 isInEquipList、没有 DOM、没有背包
    const B = world(src);
    B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, refine: 7, cards: [4001], wearMask: 2 }, { index: 3, itid: 2222, wearMask: 64 }]));
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, true, name + ' 包流路线必须成功');
    assert.equal(cur.complete, true, name + ' 整表必须算完整');
    assert.equal(cur.src, 'packet', name + ' 来源必须是包流');
    assert.equal(cur.n, 2, name + ' 两个槽');
    assert.equal(cur.routes[2], 'packet', name + ' 武器槽路线');
    assert.equal(cur.slots[2].itid, 1101, name + ' 武器槽内容');
    assert.equal(cur.slots[64].itid, 2222, name + ' 鞋槽内容');
    assert.equal(cur.missing.length, 9, name + ' 其余 9 个槽必须明确记为未读到');
    // 客户端路线补缺口：isInEquipList 给出饰品槽，武器槽仍以包流为准
    const C = world(src, { eq: { name: 'Equipment', isInEquipList: (m) => (m === 8 ? { ITID: 4444, index: 11, RefiningLevel: 0, slot: { card1: 0 } } : null) } });
    C.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
    const cur2 = C.W.gearReadEquipped();
    assert.equal(cur2.complete, true, name + ' isInEquipList 是整槽枚举 → 完整');
    assert.equal(cur2.src, 'packet', name + ' 有整表时来源仍是包流');
    assert.equal(cur2.routes[2], 'packet', name + ' 重叠槽必须以包流为准（路线①最高优先级）');
    assert.equal(cur2.routes[8], 'isInEquipList', name + ' 缺口必须由客户端路线补上');
    assert.equal(cur2.slots[8].itid, 4444, name + ' 补上的槽内容');
  }
  mutantKill('M7 关掉路线①（包流整表不用）',
    '      var pk = (typeof gearPktSnapshot === "function") ? gearPktSnapshot() : null; // typeof 守卫：局部切片测试环境可缺',
    '      var pk = null; // 变异：不走包流整表',
    (B) => {
      B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
      const cur = B.W.gearReadEquipped();
      assert.equal(cur.complete, true, '包流整表必须算完整');
      assert.equal(cur.routes[2], 'packet', '武器槽必须来自包流');
    });
});

test('V2.38.7 complete 门：部分快照绝不允许规划换装（不许只穿不脱 → 叠穿）（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, partialOpt());
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, true, name + ' 前置：部分快照必须读到 1 槽');
    assert.equal(cur.complete, false, name + ' 前置：非 isInEquipList 路线必须算部分快照');
    assert.equal(B.packets.length, 0, name + ' 前置：还没发包');
    assert.equal(B.W.gearApply('x'), false, name + ' complete 门必须拒绝换装');
    assert.equal(B.packets.length, 0, name + ' 拒绝时绝不发包（部分快照里的槽绝不能被当成「该脱」）');
    assert.ok(B.statuses.some((m) => m.indexOf('未收到装备数据') >= 0), name + ' 必须明确报「未收到装备数据」，实际=' + B.blob(B.statuses));
  }
  mutantKill('M4 去掉 complete 门（只判 cur.ok）',
    '    if (cur.complete !== true) {',
    '    if (false) {',
    (B) => {
      // 变异体：没有门 → 部分快照被当成完整 → 先发「脱」包（正是叠穿的来路）
      assert.equal(B.W.gearApply('x'), false, 'complete 门必须拒绝换装');
      assert.equal(B.packets.length, 0, '拒绝时绝不发包');
    },
    (code) => world(code, partialOpt()));
});

test('V2.38.7 快照过期（>60s）与只收到 ack 都必须判为「未收到装备数据」（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    B.W.dispatchInbound(ackFrame(170, { index: 7, loc: 2, raw: 1 }));
    assert.equal(B.W.gearPktSnapshot(), null, name + ' 只有 ack 时快照必须不可用');
    B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
    assert.ok(B.W.gearPktSnapshot(), name + ' 整表到达后快照可用');
    B.W.gearPkt.at = Date.now() - 61000; // 只改「整表时刻」模拟过期
    assert.equal(B.W.gearPktSnapshot(), null, name + ' 超过 60s 必须不可用');
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, false, name + ' 过期且无客户端路线 → 必须 0 槽失败');
  }
});

// ================= 诊断 & 只读 =================
test('V2.38.7 诊断与只读：包流状态可读；全程零发包、零新增端点（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src);
    B.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, refine: 7, cards: [4001], wearMask: 2 }]));
    B.W.dispatchInbound(ackFrame(170, { index: 7, loc: 2, raw: 1 }));
    const txt = String(B.W.gearPktDiagText());
    assert.ok(txt.indexOf('装备包流=') === 0, name + ' 诊断必须以「装备包流=」开头，实际=' + txt.slice(0, 40));
    assert.ok(txt.indexOf('complete:true') >= 0, name + ' 诊断必须含 complete');
    assert.ok(txt.indexOf('穿脱ack:1') >= 0, name + ' 诊断必须含 ack 计数');
    assert.equal(B.packets.length, 0, name + ' 只读路线绝不发包');
    assert.ok(B.log.some((m) => m.indexOf('gear-pkt-list') >= 0), name + ' 必须留下可定位的日志');
    // 解析异常绝不外抛（喂一堆垃圾字节）
    const junk = new ArrayBuffer(64), dv = new DataView(junk);
    dv.setUint16(0, 164, true); dv.setUint16(2, 64, true);
    for (let i = 4; i < 64; i++) dv.setUint8(i, 0xFF);
    B.W.dispatchInbound(junk);
    assert.equal(B.W.framePartialGet() >= 0, true, name + ' 垃圾包之后分帧器仍然活着');
  }
});

// ================= 9a：未进游戏不刷「角色未识别」 =================
function gateWorld(src) {
  const s = lf(src);
  const code = cut(s, '  function profWriteGuard(what) {', '  function flushPendingEdits() {');
  const statuses = [], lines = [];
  let inGame = false, pktAt = 0;
  const ctx = {
    Date, Math, Number, String, Object, Array, JSON, isFinite, parseInt, console,
    identityLog: { blocked: {}, last: 0 }, identityLogLine: (m) => lines.push(String(m)),
    profileTrusted: () => false, activeProfileKey: () => 'default', selfCharId: () => 0,
    pendingEditsTouch: () => {}, setStatus: (m) => statuses.push(String(m)),
    pktCharIdAt: 0, get inGameNow() { return inGame; },
    clientReady: () => inGame,
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.guard=profWriteGuard;this.reset=()=>{identityLog.last=0;};', ctx);
  return { ctx, statuses, lines, setGame: (v) => { inGame = v; }, setPkt: (v) => { ctx.pktCharIdAt = v; } };
}
test('V2.38.7 9a 启动期（未进游戏）不刷「角色未识别」，已进游戏仍未识别必须提示（两文件）', () => {
  for (const [name, src] of splitSources) {
    const G = gateWorld(src);
    assert.equal(G.ctx.guard('设置'), false, name + ' 未识别必须拒绝');
    assert.equal(G.statuses.length, 0, name + ' 未进游戏时不得弹提示，实际=' + JSON.stringify(G.statuses));
    assert.ok(G.lines.some((m) => m.indexOf('inGame=0') >= 0), name + ' 必须留下 inGame=0 的日志而不是弹提示');
    G.setGame(true); G.ctx.reset();
    assert.equal(G.ctx.guard('设置'), false, name + ' 仍然拒绝');
    assert.ok(G.statuses.some((m) => m.indexOf('角色未识别') >= 0), name + ' 已进游戏必须提示');
    G.setGame(false); G.setPkt(999); G.ctx.reset();
    G.ctx.guard('设置');
    assert.ok(G.statuses.some((m) => m.indexOf('角色未识别') >= 0), name + ' 包流已拿到 char_id（进游戏）也必须提示');
  }
  mutantKill('M10 去掉「已进游戏」闸门',
    '        if (inGame) { try { setStatus("角色未识别，已暂停保存（" + key + "）；识别后会自动恢复", "warn"); } catch (e0) {} }',
    '        try { setStatus("角色未识别，已暂停保存（" + key + "）；识别后会自动恢复", "warn"); } catch (e0) {}',
    (G) => {
      G.ctx.guard('设置');
      assert.equal(G.statuses.length, 0, '未进游戏时不得弹提示');
    }, gateWorld);
});

// ================= 结构断言（版本 / EOL / 两文件差异） =================
test('V2.38.7 结构断言：版本与 EOL 不变量（两文件）', () => {
  const stable = readSrc('ro-assist.user.js'), exp = readSrc('ro-assist-exp.user.js');
  for (const [name, src] of [['stable', stable], ['exp', exp]]) {
    assert.equal(/^\/\/\s*@version\s+(\S+)/m.exec(src)?.[1], '2.38.7', name + ' @version 必须是 2.38.7');
    assert.equal(/var VER = "([^"]+)"/.exec(src)?.[1], '2.38.7', name + ' VER 必须是 2.38.7');
    assert.ok(src.includes('// ---------------- V2.38.7 变更摘要 ----------------'), name + ' 必须有 V2.38.7 变更摘要');
    assert.ok(src.includes('170: 9, 2256: 9, 2457: 11, 172: 7, 2257: 7, 2458: 9'), name + ' 必须有补充长度表（穿脱确认）');
    assert.ok(src.includes('2824: -1, 2825: -1, 2826: -1, 2827: 4, 2873: -1'), name + ' 必须有补充长度表（分流式 itemlist 家族）');
    assert.ok(src.includes('SPLIT_SEND_ITEMLIST_EQUIP2'), name + ' 必须认分流整表类名');
    assert.ok(src.includes('gearPktHook(bytes, op)'), name + ' 必须挂上收包入口');
  }
  assert.equal(stable.includes('\r\n'), true, 'stable 必须是 CRLF');
  assert.equal(/\r/.test(exp), false, 'exp 必须是纯 LF');
  const a = lf(stable).split('\n'), b = lf(exp).split('\n');
  assert.equal(a.length, b.length, '两文件行数必须一致');
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i + 1);
  assert.equal(JSON.stringify(diff), '[2,5,6]', '两文件逐行差异必须恰好是 [2,5,6]，实际=' + JSON.stringify(diff));
});


// ================= 分流式 itemlist 家族（0x0b39/2824/2827）真字节构造 =================
//   逐字对齐客户端 Online.js 173794-173833（EQUIP2，item_size=68）：op@0 total@2 invType@4 记录自 @5。
function writeSplit2Rec(dv, b, r) {
  dv.setInt16(b, r.index, true);
  dv.setUint32(b + 2, r.itid, true);
  dv.setUint8(b + 6, r.type || 0);
  dv.setUint32(b + 7, r.locRaw || 0, true);
  dv.setUint32(b + 11, r.wearMask || 0, true);
  const cards = r.cards || [];
  for (let c = 0; c < 4; c++) dv.setUint32(b + 15 + c * 4, cards[c] || 0, true);
  dv.setInt32(b + 31, r.expire || 0, true);
  dv.setUint16(b + 35, r.bind || 0, true);
  dv.setUint16(b + 37, r.sprite || 0, true);
  const opts = r.options || [];
  dv.setInt8(b + 39, opts.length);
  opts.forEach((o, i) => { const ob = b + 40 + i * 5; dv.setInt16(ob, o.index, true); dv.setInt16(ob + 2, o.value, true); dv.setInt8(ob + 4, o.param, true); });
  dv.setUint8(b + 65, r.refine || 0);
  dv.setUint8(b + 66, r.enchant || 0);
  dv.setUint8(b + 67, (r.identified ? 1 : 0) | (r.damaged ? 2 : 0) | (r.etc ? 4 : 0));
}
function split2Frame(recs, invType, op) {
  const buf = new ArrayBuffer(5 + recs.length * 68), dv = new DataView(buf);
  dv.setUint16(0, op || 2873, true); dv.setUint16(2, buf.byteLength, true); dv.setUint8(4, invType == null ? 0 : invType);
  recs.forEach((r, i) => writeSplit2Rec(dv, 5 + i * 68, r));
  return buf;
}
function sessFrame(op, invType, name) {
  if (op === 2827) { const b = new ArrayBuffer(4), d = new DataView(b); d.setUint16(0, 2827, true); d.setUint8(2, invType || 0); d.setUint8(3, 0); return b; }
  const nm = String(name == null ? '' : name);
  const len = 5 + nm.length, b = new ArrayBuffer(len), d = new DataView(b);
  d.setUint16(0, op, true); d.setUint16(2, len, true); d.setUint8(4, invType || 0);
  for (let i = 0; i < nm.length; i++) d.setUint8(5 + i, nm.charCodeAt(i));
  return b;
}
function invFrame2825(recs, invType) { // 2825 背包整表（34B 记录）：本批只验分帧切分，不解析内容
  const buf = new ArrayBuffer(5 + recs * 34), dv = new DataView(buf);
  dv.setUint16(0, 2825, true); dv.setUint16(2, buf.byteLength, true); dv.setUint8(4, invType == null ? 1 : invType);
  return buf;
}
const SPLIT2_SEVEN = () => [
  { index: 1, itid: 1101, type: 4, wearMask: 2, refine: 7, cards: [4001, 4002], expire: 111, bind: 1, sprite: 90, options: [{ index: 1, value: 5, param: 2 }], enchant: 3, identified: true },
  { index: 2, itid: 2101, type: 4, wearMask: 1, refine: 4, cards: [4101], expire: 222, bind: 2, sprite: 91, enchant: 0, identified: true },
  { index: 3, itid: 2301, type: 4, wearMask: 16, refine: 0, cards: [], identified: false, damaged: true },
  { index: 4, itid: 2150, type: 4, wearMask: 4, refine: 5, cards: [4201, 4202, 4203, 4204], options: [{ index: 2, value: 9, param: 1 }, { index: 3, value: 4, param: 0 }], enchant: 2, identified: true, etc: true },
  { index: 5, itid: 2401, type: 4, wearMask: 64, refine: 0, cards: [], identified: true },
  { index: 6, itid: 2501, type: 4, wearMask: 8, refine: 0, cards: [], identified: true },
  { index: 7, itid: 2201, type: 4, wearMask: 32, refine: 0, cards: [], identified: true },
];

test('V2.38.7 G13 分流整表 0x0b39：真字节 481B / 7 条逐字段（无类名索引，只走数字兜底表）（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null }); // 审计 #5：不依赖客户端类名索引
    const frame = split2Frame(SPLIT2_SEVEN(), 0);
    assert.equal(frame.byteLength, 481, name + ' 真帧必须 481B（5 + 7×68）');
    assert.equal((frame.byteLength - 5) % 68, 0, name + ' (481-5)%68 必须为 0');
    assert.equal(B.W.zcLenTable(), null, name + ' 前置：没有主长度表');
    const seen = [];
    B.W.walkInboundFrames(frame, () => seen.push(1));
    assert.equal(seen.length, 1, name + ' 481B 必须被切成 1 帧（靠 ZC_EXTRA_LEN 的 2873:-1）');
    B.W.dispatchInbound(frame);
    const p = B.W.gearPkt;
    assert.equal(p.ver, 6, name + ' 家族标号 v6');
    assert.equal(p.rec, 68, name + ' 记录长 68');
    assert.equal(p.n, 7, name + ' 条数 7');
    assert.equal(p.complete, true, name + ' 非空整表必须 complete');
    assert.equal(p.listOp, 2873, name + ' opcode');
    assert.equal(Object.keys(p.slots).length, 7, name + ' 7 个槽全部命中');
    const w = p.slots[2], h = p.slots[1], g = p.slots[4], s = p.slots[64], a = p.slots[8], sh = p.slots[32];
    assert.equal(w.itid, 1101, name + ' 武器 ITID（u32@2）');
    assert.equal(w.refine, 7, name + ' 武器精炼（u8@65，在词条之后）');
    assert.equal(B.blob(w.cards), '[4001,4002]', name + ' 武器卡片（u32@15/19）');
    assert.equal(B.blob(w.options), '[{"index":1,"value":5,"param":2}]', name + ' 武器词条（@40）');
    assert.equal(w.optionsKnown, true, name + ' 本家族词条必须已知');
    assert.equal(w.enchantgrade, 3, name + ' 附魔等级（u8@66）');
    assert.equal(w.enchantKnown, true, name + ' 本家族附魔必须已知');
    assert.equal(w.identified, true, name + ' flag bit0 鉴定');
    assert.equal(w.damaged, false, name + ' flag bit1 未损坏');
    assert.equal(w.expire, 111, name + ' HireExpireDate i32@31');
    assert.equal(w.bindType, 1, name + ' bind u16@35');
    assert.equal(w.sprite, 90, name + ' sprite u16@37');
    assert.equal(w.optCnt, 1, name + ' nRandomOptionCnt i8@39');
    assert.equal(w.idx, 1, name + ' index i16@0');
    assert.equal(w.src, 'packet', name + ' 来源');
    assert.equal(h.wearLocation, 1, name + ' 头上 WearState u32@11');
    assert.equal(h.refine, 4, name + ' 头上精炼');
    assert.equal(B.blob(h.options), '[]', name + ' 没词条就是空数组（本家族「已知为空」）');
    assert.equal(p.slots[16].damaged, true, name + ' 铠甲 flag bit1 损坏（u32 WearState@11 → 16）');
    assert.equal(p.slots[16].identified, false, name + ' 铠甲未鉴定');
    assert.equal(B.blob(p.slots[16].options), '[]', name + ' 无词条（本家族「已知为空」）');
    assert.equal(g.damaged, false, name + ' 披风未损坏');
    assert.equal(g.identified, true, name + ' 披风已鉴定');
    assert.equal(B.blob(sh && sh.cards) || '[]', '[]', name + ' 盾槽命中（32）');
    assert.equal(B.blob(p.slots[4].cards), '[4201,4202,4203,4204]', name + ' 披风 4 张卡（u32@15..27）');
    assert.equal(B.blob(p.slots[4].options), '[{"index":2,"value":9,"param":1},{"index":3,"value":4,"param":0}]', name + ' 披风两条词条');
    assert.equal(p.slots[4].enchantgrade, 2, name + ' 披风附魔');
    assert.equal(p.slots[4].bindType, 0, name + ' 披风无绑定');
    assert.equal(s.itid, 2401, name + ' 鞋槽');
    assert.equal(a.itid, 2501, name + ' 饰品1');
    assert.equal(p.byIndex[7].itid, 2201, name + ' byIndex 索引');
    assert.equal(B.packets.length, 0, name + ' 解析全程零发包');
    console.log('[分流整表][ ' + name + '] 0x0b39 481B → n=' + p.n + ' 槽=' + Object.keys(p.slots).length + ' complete=' + p.complete +
      ' 武器{' + w.itid + ',+' + w.refine + ',cards=' + B.blob(w.cards) + ',opt=' + B.blob(w.options) + ',ench=' + w.enchantgrade + '}');
  }
});

test('V2.38.7 G14 分流生命周期：0x0b08 开始清空 → 0x0b39 整表 complete → 0x0b0b 结束（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null });
    B.W.dispatchInbound(listFrame(2450, 4, [{ index: 7, itid: 1101, wearMask: 2 }]));
    assert.equal(B.W.gearPkt.complete, true, name + ' 前置：旧家族整表已就绪');
    B.W.dispatchInbound(concat(sessFrame(2824, 0, '装备'), split2Frame(SPLIT2_SEVEN(), 0), sessFrame(2827, 0)));
    const p = B.W.gearPkt;
    assert.equal(p.sess, 0, name + ' 结束包必须关闭会话标记');
    assert.equal(p.chunks, 1, name + ' 会话内整表块计数');
    assert.equal(p.complete, true, name + ' 真机 burst（开始→整表→结束）后快照必须可用');
    assert.equal(p.n, 7, name + ' 7 条');
    assert.ok(B.W.gearPktSnapshot(), name + ' 快照必须可用');
    // 整条 burst 一起喂（含背包分流 2825）：四帧必须全部切出来，会话状态照旧
    const C = world(src, { ps: null });
    const burst = concat(sessFrame(2824, 0, '装'), invFrame2825(16, 1), split2Frame(SPLIT2_SEVEN(), 0), sessFrame(2827, 0));
    assert.equal(burst.byteLength, 1040, name + ' burst 真字节 1040B（6 + 549 + 481 + 4）');
    let nf = 0;
    const wr = C.W.walkInboundFrames(burst, () => nf++);
    assert.equal(nf, 4, name + ' 四帧必须全部切出（2824/2825/2873/2827 都要在分帧表里）');
    assert.equal(wr.rest, burst.byteLength, name + ' 整条切完');
    C.W.dispatchInbound(burst);
    assert.equal(C.W.gearPkt.n, 7, name + ' burst 内整表必须解析');
    assert.equal(C.W.gearPkt.complete, true, name + ' burst 后 complete');
    assert.equal(C.W.gearPkt.sess, 0, name + ' burst 后会话关闭');
    // 会话开始必须清空：拿旧表 seed 后只有 SET 也必须清
    const D = world(src, { ps: null });
    D.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
    assert.equal(Object.keys(D.W.gearPkt.slots).length, 7, name + ' 前置 seed');
    D.W.dispatchInbound(sessFrame(2824, 0, '装备'));
    assert.equal(Object.keys(D.W.gearPkt.slots).length, 0, name + ' SET 必须清空槽位');
    assert.equal(D.W.gearPkt.complete, false, name + ' SET 后 complete=false');
    assert.equal(D.W.gearPkt.sess, 1, name + ' SET 打开会话');
    assert.equal(D.W.gearPktSnapshot(), null, name + ' SET 后快照不可用');
    // 结束但本次会话没拿到整表 → 整份标记失效（fail-closed）
    const E = world(src, { ps: null });
    E.W.dispatchInbound(sessFrame(2824, 0, '装备'));
    E.W.dispatchInbound(sessFrame(2827, 0));
    assert.equal(E.W.gearPkt.complete, false, name + ' 空会话结束必须 complete=false');
    assert.equal(E.W.gearPktSnapshot(), null, name + ' 空会话结束后快照不可用');
    // invType!=0（推车/仓库分流）不得动装备快照
    const F = world(src, { ps: null });
    F.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
    F.W.dispatchInbound(sessFrame(2824, 2, '仓库'));
    assert.equal(F.W.gearPkt.complete, true, name + ' 仓库分流的 SET 不得清装备快照');
    F.W.dispatchInbound(sessFrame(2827, 2));
    assert.equal(F.W.gearPktSnapshot() !== null, true, name + ' 仓库分流的 RESULT 不得失效装备快照');
  }
  mutantKill('M15 去掉会话开始清空（0x0b08 状态机）',
    '        gearPktReset("分流会话开始 op" + op);',
    '        void 0;',
    (B) => {
      B.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
      B.W.dispatchInbound(sessFrame(2824, 0, '装备'));
      assert.equal(Object.keys(B.W.gearPkt.slots).length, 0, 'SET 必须清空槽位');
    }, (code) => world(code, { ps: null }));
  mutantKill('M20 会话结束一律失效（与真机 burst 相反，会让手机端永远读不到）',
    '      if (!(gearPkt.n > 0)) gearPktInvalidate("分流会话结束 op" + op + " 但本次没拿到整表");',
    '      gearPktInvalidate("变异：结束一律失效");',
    (B) => {
      B.W.dispatchInbound(concat(split2Frame(SPLIT2_SEVEN(), 0), sessFrame(2827, 0)));
      assert.ok(B.W.gearPktSnapshot(), '拿到整表后结束仍须可用');
    }, (code) => world(code, { ps: null }));
});

test('V2.38.7 G15 分流整表校验：整除/invType/长度 三条不满足一律拒绝且不写档（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null });
    B.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
    const snap = B.blob(B.profiles);
    assert.equal(B.W.gearPkt.n, 7, name + ' 前置：好帧已解析');
    // ① (total-5)%68 != 0
    const bad = new ArrayBuffer(5 + 68 * 2 + 3), bd = new DataView(bad);
    bd.setUint16(0, 2873, true); bd.setUint16(2, bad.byteLength, true); bd.setUint8(4, 0);
    assert.equal(B.W.gearPktParseSplit2(bad, 2873, { rec: 68 }), false, name + ' 不整除必须拒绝');
    assert.ok(B.W.gearPkt.why.indexOf('整数倍') >= 0, name + ' why 必须写明版本不符，实际=' + B.W.gearPkt.why);
    // ② invType != 0
    assert.equal(B.W.gearPktParseSplit2(split2Frame(SPLIT2_SEVEN(), 1), 2873, { rec: 68 }), false, name + ' invType=1 必须拒绝');
    assert.ok(B.W.gearPkt.why.indexOf('invType=1') >= 0, name + ' why 必须写明 invType，实际=' + B.W.gearPkt.why);
    // ③ 长度不足
    const tiny = new ArrayBuffer(4), td = new DataView(tiny);
    td.setUint16(0, 2873, true); td.setUint16(2, 4, true);
    assert.equal(B.W.gearPktParseSplit2(tiny, 2873, { rec: 68 }), false, name + ' 长度不足必须拒绝');
    // 拒绝不得污染既有快照，也不得写档/发包
    assert.equal(B.W.gearPkt.n, 7, name + ' 既有快照条数不变');
    assert.equal(B.W.gearPkt.complete, true, name + ' 既有快照仍可用');
    assert.equal(Object.keys(B.W.gearPkt.slots).length, 7, name + ' 既有槽位不变');
    assert.equal(B.blob(B.profiles), snap, name + ' 拒绝路径绝不写档');
    assert.equal(B.packets.length, 0, name + ' 拒绝路径绝不发包');
    assert.equal(B.W.gearPktSnapshot() !== null, true, name + ' 拒绝后快照仍可用');
  }
  mutantKill('M13 去掉 invType 校验',
    '      if (invType !== 0) { gearPkt.why = "分流整表 op" + op + " invType=" + invType + "（不是 0=装备/背包）→ 不解析（fail-soft）"; identityLogLine("gear-pkt-split-reject op=" + op + " invType=" + invType); return false; }',
    '      if (false) { return false; }',
    (B) => { assert.equal(B.W.gearPktParseSplit2(split2Frame(SPLIT2_SEVEN(), 1), 2873, { rec: 68 }), false, 'invType=1 必须拒绝'); },
    (code) => world(code, { ps: null }));
  mutantKill('M14 去掉 (total-5)%68 整除校验',
    '      if (((total - 5) % f.rec) !== 0) { gearPkt.why = "分流整表 op" + op + " 帧长 " + total + " 不是「5 + 记录长" + f.rec + " 的整数倍」→ 版本不符，不解析"; identityLogLine("gear-pkt-split-reject op=" + op + " len=" + total + " rec=" + f.rec); return false; }',
    '      if (false) { return false; }',
    (B) => {
      const bad = new ArrayBuffer(5 + 68 * 2 + 3), bd = new DataView(bad);
      bd.setUint16(0, 2873, true); bd.setUint16(2, bad.byteLength, true);
      assert.equal(B.W.gearPktParseSplit2(bad, 2873, { rec: 68 }), false, '不整除必须拒绝');
    }, (code) => world(code, { ps: null }));
});

test('V2.38.7 G16 数字兜底表：无类名索引时旧家族五版的 ver/rec 与分流家族都必须认得（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null });
    assert.equal(B.W.zcLenTable(), null, name + ' 前置：主表不可用');
    const map = B.W.gearPktOps();
    assert.equal(map[164].ver, 1, name + ' 数字表 164 ver');
    assert.equal(map[164].rec, 20, name + ' 数字表 164 rec');
    assert.equal(map[2573].ver, 5, name + ' 数字表 2573 ver');
    assert.equal(map[2573].rec, 57, name + ' 数字表 2573 rec');
    assert.equal(map[2873].split, true, name + ' 数字表必须认得 2873（审计 #5）');
    assert.equal(map[2873].rec, 68, name + ' 2873 记录长');
    assert.equal(map[2824].sess, 'start', name + ' 数字表 2824 会话开始');
    assert.equal(map[2827].sess, 'end', name + ' 数字表 2827 会话结束');
    // 164（rec 20）逐字段：整表只有这一帧时整条交付也要能解析
    B.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, refine: 6, cards: [4001], wearMask: 2 }]));
    assert.equal(B.W.gearPkt.ver, 1, name + ' 164 必须按 v1 解析');
    assert.equal(B.W.gearPkt.rec, 20, name + ' 164 记录长必须 20');
    assert.equal(B.W.gearPkt.slots[2].itid, 1101, name + ' 164 槽内容');
    assert.equal(B.W.gearPkt.slots[2].refine, 6, name + ' 164 精炼');
    assert.equal(B.W.gearPkt.slots[2].optionsKnown, false, name + ' 旧家族词条仍必须标未知');
    assert.equal(B.W.gearPkt.slots[2].enchantKnown, false, name + ' 旧家族附魔仍必须标未知');
    // 2573（rec 57）
    const C = world(src, { ps: null });
    C.W.dispatchInbound(listFrame(2573, 5, [{ index: 9, itid: 2222, refine: 3, cards: [4301], wearMask: 64, options: [{ index: 1, value: 5, param: 2 }] }]));
    assert.equal(C.W.gearPkt.ver, 5, name + ' 2573 必须按 v5 解析');
    assert.equal(C.W.gearPkt.rec, 57, name + ' 2573 记录长必须 57');
    assert.equal(C.W.gearPkt.slots[64].itid, 2222, name + ' 2573 槽内容');
    assert.equal(C.W.gearPkt.slots[64].optionsKnown, true, name + ' 2573 的词条已知');
    assert.equal(B.blob(C.W.gearPkt.slots[64].options), '[{"index":1,"value":5,"param":2}]', name + ' 2573 词条值');
    // 有类名索引时按类名换成真实 opcode（本构建把 2873 类挂在 3001 上）
    const D = world(src, { ps: psWith([['SPLIT_SEND_ITEMLIST_EQUIP2', 3001, -1], ['SPLIT_SEND_ITEMLIST_SET', 3002, -1], ['SPLIT_SEND_ITEMLIST_RESULT', 3003, 4], ['EQUIPMENT_ITEMLIST', 10164, -1]]) });
    const dm = D.W.gearPktOps();
    assert.equal(dm[3001].split, true, name + ' 类名索引必须把分流整表换成真实 opcode');
    assert.equal(dm[3001].rec, 68, name + ' 类名索引记录长');
    assert.equal(dm[3002].sess, 'start', name + ' 类名索引会话开始');
    assert.equal(dm[3003].sess, 'end', name + ' 类名索引会话结束');
    assert.equal(dm[10164].ver, 1, name + ' 类名索引旧家族');
    D.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0, 3001));
    assert.equal(D.W.gearPkt.n, 7, name + ' 真实 opcode 下整表也必须解析');
  }
  mutantKill('M17 兜底表把 164 的记录长改错（无类名索引时才会暴露）',
    'var ZC_GEAR_LIST_NUM = { 164: { ver: 1, rec: 20 },',
    'var ZC_GEAR_LIST_NUM = { 164: { ver: 1, rec: 19 },',
    (B) => {
      B.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, wearMask: 2 }]));
      assert.equal(B.W.gearPkt.rec, 20, '164 记录长必须 20');
      assert.equal(B.W.gearPkt.n, 1, '164 必须解析出 1 条');
    }, (code) => world(code, { ps: null }));
  mutantKill('M18 兜底表把 2573 的记录长改错（无类名索引时才会暴露）',
    '2573: { ver: 5, rec: 57 } };',
    '2573: { ver: 5, rec: 56 } };',
    (B) => {
      B.W.dispatchInbound(listFrame(2573, 5, [{ index: 9, itid: 2222, wearMask: 64 }]));
      assert.equal(B.W.gearPkt.rec, 57, '2573 记录长必须 57');
      assert.equal(B.W.gearPkt.n, 1, '2573 必须解析出 1 条');
    }, (code) => world(code, { ps: null }));
  mutantKill('M16 分帧补充表漏掉 2873（burst 中途 break，整表永远收不到）',
    '  var ZC_EXTRA_LEN = { 170: 9, 2256: 9, 2457: 11, 172: 7, 2257: 7, 2458: 9, 2824: -1, 2825: -1, 2826: -1, 2827: 4, 2873: -1 };',
    '  var ZC_EXTRA_LEN = { 170: 9, 2256: 9, 2457: 11, 172: 7, 2257: 7, 2458: 9, 2824: -1, 2825: -1, 2826: -1, 2827: 4 };',
    (B) => {
      B.W.dispatchInbound(concat(sessFrame(2824, 0, '装备'), split2Frame(SPLIT2_SEVEN(), 0), sessFrame(2827, 0)));
      assert.equal(B.W.gearPkt.n, 7, 'burst 里的整表必须被切出并解析');
    }, (code) => world(code, { ps: null }));
});

test('V2.38.7 G17 complete 直接断言：条数为 0 绝不置 complete（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null });
    const empty4 = new ArrayBuffer(4), d4 = new DataView(empty4);
    d4.setUint16(0, 164, true); d4.setUint16(2, 4, true);
    assert.equal(B.W.gearPktParseList(empty4, 164, { ver: 1, rec: 20 }), true, name + ' 0 条帧本身解析成功');
    assert.equal(B.W.gearPkt.n, 0, name + ' 0 条');
    assert.equal(B.W.gearPkt.complete, false, name + ' complete 必须由条数决定（0 → false）');
    assert.equal(B.W.gearPktSnapshot(), null, name + ' 0 条快照不可用');
    const one = listFrame(164, 1, [{ index: 7, itid: 1101, wearMask: 2 }]);
    assert.equal(B.W.gearPktParseList(one, 164, { ver: 1, rec: 20 }), true, name + ' 1 条帧解析成功');
    assert.equal(B.W.gearPkt.n, 1, name + ' 1 条');
    assert.equal(B.W.gearPkt.complete, true, name + ' complete 必须由条数决定（>0 → true）');
    assert.equal(B.W.gearPktSnapshot() !== null, true, name + ' 1 条快照可用');
    // 分流家族同样口径：5B（0 条）→ false；5+68 → true
    const C = world(src, { ps: null });
    const s0 = new ArrayBuffer(5), d0 = new DataView(s0);
    d0.setUint16(0, 2873, true); d0.setUint16(2, 5, true); d0.setUint8(4, 0);
    assert.equal(C.W.gearPktParseSplit2(s0, 2873, { rec: 68 }), true, name + ' 分流 0 条解析成功');
    assert.equal(C.W.gearPkt.complete, false, name + ' 分流 0 条 → complete=false');
    assert.equal(C.W.gearPktParseSplit2(split2Frame([SPLIT2_SEVEN()[0]], 0), 2873, { rec: 68 }), true, name + ' 分流 1 条解析成功');
    assert.equal(C.W.gearPkt.complete, true, name + ' 分流 1 条 → complete=true');
    assert.equal(C.W.gearPkt.n, 1, name + ' 分流 1 条条数');
  }
});

test('V2.38.7 G18 分流家族词条/附魔为「已知」：gearSigEqual 必须真比较而不是判未知（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null });
    B.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
    const have = B.W.gearPkt.slots[2];
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001, 4002], options: [{ index: 1, value: 5, param: 2 }], enchantgrade: 3 }, have), true, name + ' 完全一致必须判一致');
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001, 4002], options: [{ index: 1, value: 6, param: 2 }], enchantgrade: 3 }, have), false, name + ' 词条值不同必须判不一致');
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001, 4002], options: [{ index: 1, value: 5, param: 2 }], enchantgrade: 4 }, have), false, name + ' 附魔等级不同必须判不一致');
    assert.equal(B.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001, 4002], options: [{ index: 1, value: 5, param: 2 }] }, have), true, name + ' 预设不关心附魔 → 其余一致即一致');
    // 旧家族对照：读不到词条/附魔 → 预设要就必须判不一致（上一轮已修，不能被这次改动带回去）
    const C = world(src, { ps: null });
    C.W.dispatchInbound(listFrame(164, 1, [{ index: 7, itid: 1101, refine: 7, cards: [4001], wearMask: 2 }]));
    assert.equal(C.W.gearSigEqual({ itid: 1101, refine: 7, cards: [4001], options: [{ index: 1, value: 5, param: 2 }] }, C.W.gearPkt.slots[2]), false, name + ' 旧家族词条未知 → 预设要就必须判不一致');
  }
  mutantKill('M19 分流家族词条/附魔退回「未知」',
    '        options: opts, optionsKnown: true, enchantgrade: Number(it.enchantgrade) || 0, enchantKnown: true,',
    '        options: opts, optionsKnown: false, enchantgrade: Number(it.enchantgrade) || 0, enchantKnown: false,',
    (B) => {
      B.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
      assert.equal(B.W.gearPkt.slots[2].optionsKnown, true, '本家族词条必须已知');
      assert.equal(B.W.gearPkt.slots[2].enchantKnown, true, '本家族附魔必须已知');
    }, (code) => world(code, { ps: null }));
  mutantKill('M12 分流记录偏移写错（精炼/附魔错位）',
    '      it.refine = dv.getUint8(b + 65); it.enchantgrade = dv.getUint8(b + 66);',
    '      it.refine = dv.getUint8(b + 64); it.enchantgrade = dv.getUint8(b + 65);',
    (B) => {
      B.W.dispatchInbound(split2Frame(SPLIT2_SEVEN(), 0));
      assert.equal(B.W.gearPkt.slots[2].refine, 7, '精炼必须在 @65');
      assert.equal(B.W.gearPkt.slots[2].enchantgrade, 3, '附魔必须在 @66');
    }, (code) => world(code, { ps: null }));
});

test('V2.38.7 G19 手机端端到端：组件全不可用 + 只有包流 burst → 7 槽 / complete / 预检通过（两文件）', () => {
  for (const [name, src] of splitSources) {
    const B = world(src, { ps: null }); // Equipment/Inventory 组件、DOM、背包全部不可用
    const burst = concat(sessFrame(2824, 0, '装'), invFrame2825(16, 1), split2Frame(SPLIT2_SEVEN(), 0), sessFrame(2827, 0));
    B.W.dispatchInbound(burst);
    const cur = B.W.gearReadEquipped();
    assert.equal(cur.ok, true, name + ' 手机端必须读得到装备');
    assert.equal(cur.complete, true, name + ' 必须是完整枚举（否则预检会拒绝）');
    assert.equal(cur.src, 'packet', name + ' 来源必须是包流');
    assert.equal(cur.n, 7, name + ' 7 个槽');
    assert.equal(cur.missing.length, 4, name + ' 其余 4 个槽记为未读到');
    for (const m of [1, 2, 4, 8, 16, 32, 64]) {
      assert.equal(cur.routes[m], 'packet', name + ' 槽 ' + m + ' 必须来自包流');
    }
    assert.equal(cur.slots[2].itid, 1101, name + ' 武器内容');
    // 预检必须通过：预设 = 当前读到的内容 → 无待穿待脱，绝不出现「未收到装备数据」
    const eq = {};
    for (const m of Object.keys(cur.slots)) {
      const s = cur.slots[m];
      eq[m] = { itid: s.itid, refine: s.refine, cards: (s.cards || []).slice(), options: (s.options || []).slice(), enchantgrade: s.enchantgrade, idx: s.idx };
    }
    B.profiles.ch999.gearSets = { list: [{ id: 'x', name: '套', at: 1, eq: eq }], sel: 'x' };
    const r = B.W.gearApply('x');
    assert.equal(r, true, name + ' 预检必须通过并规划成功，实际返回 ' + r);
    assert.equal(B.statuses.some((m) => m.indexOf('未收到装备数据') >= 0), false, name + ' 绝不能再报「未收到装备数据」，实际=' + B.blob(B.statuses));
    console.log('[手机端 burst][' + name + '] 0x0b08→0x0b09→0x0b39→0x0b0b → 槽=' + cur.n + ' complete=' + cur.complete + ' src=' + cur.src +
      ' 预检=' + r + ' 状态=' + B.blob(B.statuses));
  }
});
