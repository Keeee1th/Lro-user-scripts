// V2.38.10：手机端只读包流来源（背包整表 0x0b09/2825 ＋ 换图 145 / 进区 113·2757 / 走路 135）——真帧 + 变异体
// 证据（逐字核对本机客户端，不是猜）：
//  · 背包 PacketStructure.js 14315-14344「//0xb09 PACKET.ZC.SPLIT_SEND_ITEMLIST_NORMAL」：invType u8@4，
//    item_size = PACKETVER>=20181121 ? 34 : 24；记录 34B：index i16@0 · ITID u32@2 · type u8@6 · count i16@7 ·
//    WearState u32@9 · card1..4 u32@13/17/21/25 · HireExpireDate i32@29 · flag u8@33（bit0=IsIdentified、bit1=PlaceETCTab）。
//  · 换图 Online.js 166107-166112 / 号表 208171（145）/ hookPacket 380928 / onMapChange 380209 / MapRenderer.setMap 380324。
//  · 进区 Online.js 384225-384226 hookPacket(→onReceiveMapInfo 384134) → 384161 MapEngine.init(..., pkt.mapName)。
//  · 自身坐标 Online.js 368171 onPlayerMove → SessionStorage.Entity.walkTo(MoveData[0..3])；Pos2 解码器 10933-10946。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STABLE = fs.readFileSync(path.join(DIR, '..', 'ro-assist.user.js'), 'utf8');
const EXP = fs.readFileSync(path.join(DIR, '..', 'ro-assist-exp.user.js'), 'utf8');
const SOURCES = [['stable', STABLE], ['exp', EXP]];

function slice(src, name) {
  const key = '\n  function ' + name + '(';
  const i = src.indexOf(key);
  assert.ok(i > 0, '找不到函数 ' + name);
  const rest = src.slice(i + key.length);
  const cands = ['\n  function ', '\n  var '].map((m) => rest.indexOf(m)).filter((v) => v > 0);
  const end = cands.length ? Math.min(...cands) : rest.length;
  return src.slice(i, i + key.length + end);
}
// 测试侧小工具：ArrayBuffer 视图 / 截短真帧（变异体断言也用到，必须显式定义）
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const short = (b, n) => b.slice(0, n);
// vm 新 realm 自带的 DataView 拒收跨 realm 的 Buffer/Uint8Array（"First argument ... must be an ArrayBuffer"）
// → 统一在入口把入参转成同 realm 的 ArrayBuffer，测试其余部分照旧用 Buffer
const HostDataView = DataView;
// vm 新 realm 的对象/数组原型与宿主不同：deepStrictEqual 会因原型不同而失败 → 先转成纯 JSON 值
const plain = (v) => JSON.parse(JSON.stringify(v));
function DataViewShim(bytes) {
  if (bytes instanceof ArrayBuffer) return new HostDataView(bytes);
  if (bytes && bytes.buffer) return new HostDataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return new HostDataView(bytes);
}
function newSection(src) {
  const a = src.indexOf('  // ===== V2.38.10');
  const b = src.indexOf('  function gearReadEquipped() {');
  assert.ok(a > 0 && b > a, '找不到 V2.38.10 段');
  return src.slice(a, b);
}
function readFixedStrStub(dv, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); }
  return s;
}

// 真帧构造：549B = 5 + 16×34（与真机 burst 里那一帧同形），每条记录字段各不相同 → 任何偏移错位都会被逐字段断言抓到
function buildBagFrame(recs, invType = 0) {
  const buf = Buffer.alloc(5 + recs.length * 34);
  buf.writeUInt16LE(0x0b09, 0);
  buf.writeUInt16LE(buf.length, 2);
  buf.writeUInt8(invType, 4);
  recs.forEach((r, i) => {
    const b = 5 + i * 34;
    buf.writeInt16LE(r.index, b);
    buf.writeUInt32LE(r.ITID, b + 2);
    buf.writeUInt8(r.type, b + 6);
    buf.writeInt16LE(r.count, b + 7);
    buf.writeUInt32LE(r.WearState, b + 9);
    buf.writeUInt32LE(r.card1, b + 13); buf.writeUInt32LE(r.card2, b + 17);
    buf.writeUInt32LE(r.card3, b + 21); buf.writeUInt32LE(r.card4, b + 25);
    buf.writeInt32LE(r.HireExpireDate, b + 29);
    buf.writeUInt8(r.flag, b + 33);
  });
  return buf;
}
const REAL16 = Array.from({ length: 16 }, (_, i) => ({
  index: i + 1, ITID: 500 + i, type: i % 2 ? 10 : 0, count: 1 + i, WearState: i === 2 ? 2 : 0,
  card1: 4000 + i, card2: i % 3 === 0 ? 4100 + i : 0, card3: 0, card4: i === 5 ? 4200 : 0,
  HireExpireDate: i === 7 ? 1893456000 : -1, flag: (i % 2) | (i % 4 >= 2 ? 2 : 0),
}));
// Pos2（客户端 readPos2 的逆编码，只用到 x0,y0,x1,y1，dir/n 置 0）
function pos2Bytes(v0, v1, v2, v3) {
  return [ (v0 >> 2) & 255, ((v0 & 3) << 6) | ((v1 >> 4) & 63), ((v1 & 15) << 4) | ((v2 >> 6) & 15), ((v2 & 63) << 2) | ((v3 >> 8) & 3), v3 & 255, 0 ];
}
function buildMoveFrame(x0, y0, x1, y1, t = 123456) {
  const buf = Buffer.alloc(12);
  buf.writeUInt16LE(135, 0); buf.writeUInt32LE(t, 2);
  Buffer.from(pos2Bytes(x0, y0, x1, y1)).copy(buf, 6);
  return buf;
}
function buildMapMoveFrame(map, x, y) {
  const buf = Buffer.alloc(22);
  buf.writeUInt16LE(145, 0); buf.write(map, 2, 16, 'ascii');
  buf.writeUInt16LE(x, 18); buf.writeUInt16LE(y, 20);
  return buf;
}
function buildZoneFrame(map, gid = 42, bytes = 28) {
  const buf = Buffer.alloc(bytes);
  buf.writeUInt16LE(113, 0); buf.writeUInt32LE(gid, 2); buf.write(map, 6, 16, 'ascii');
  return buf;
}

function makeWorld(src, over = {}) {
  const log = [];
  const parts = [
    'var bagRead = { source: "", count: 0, arrows: 0 };',
    newSection(src),
    slice(src, 'bagCountArrows'), slice(src, 'bagListOk'), slice(src, 'bagSourceTry'), slice(src, 'bagInvComp'),
    slice(src, 'bagItemByIndex'), slice(src, 'bagList'), slice(src, 'findInventory'),
    slice(src, 'getMapName'), slice(src, 'normMapKey'),
  ];
  const code = parts.join('\n') + '\n;this.API={bagPkt,worldPkt,bagPktHook,worldPktHook,bagPktSnapshot,bagPktByIndex,bagPktDiagText,bagList,bagItemByIndex,getMapName,worldPktMap,worldPktPos,worldPktDiagText,bagSourceTry};';
  const ctx = {
    DataView: DataViewShim, Date, Number, String, Boolean, Array, Object, Math, JSON, isFinite, isNaN, parseInt, parseFloat,
    console, Buffer,
    identityLogLine: (m) => { log.push(String(m)); try { if (over && over.logs) over.logs.push(String(m)); } catch (e) {} },
    identityPktOps: () => ({ zone: { 113: 1, 2757: 1 }, charlist: { 107: 1 } }),
    psClassIndex: over.psClassIndex || (() => null),
    readFixedStr: over.readFixedStr || readFixedStrStub,
    uiComp: over.uiComp || (() => null),
    requireDB: over.requireDB || (() => null),
    UM: over.UM === undefined ? null : over.UM,
    CLIENT: over.CLIENT || { SS: null, MR: null, DB: null, PS: null },
    getItemName: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { W: ctx.API, ctx, log };
}
function bagParseOk(w, buf, op = 2825) { w.W.bagPktHook(buf, op); return w.W.bagPktSnapshot(); }
function mkOk(w) { return assert.ok(w.W.bagPktSnapshot(), '背包整表应可用'); }

// ============ 一、背包整表：真帧逐字段 ============
for (const [name, src] of SOURCES) {
  test('V2.38.10 背包真帧：549B/16 条逐字段（stable/exp 一致）', () => {
    const w = makeWorld(src);
    const buf = buildBagFrame(REAL16);
    assert.equal(buf.length, 549, '真帧必须是 549B（5 + 16×34）');
    assert.equal(w.W.bagPktHook(buf, 2825), undefined, 'hook 不返回值，状态走快照');
    const list = w.W.bagPktSnapshot();
    assert.ok(Array.isArray(list) && list.length === 16, '必须解析出 16 条');
    assert.equal(w.ctx.bagPkt.n, 16); assert.equal(w.ctx.bagPkt.rec, 34);
    assert.equal(w.ctx.bagPkt.complete, true); assert.equal(w.ctx.bagPkt.src, 'packet');
    assert.ok(w.log.some((m) => m.indexOf('bag-pkt-split op=2825') >= 0 && m.indexOf('n=16') >= 0), '产品日志必须写下 n=16');
    list.forEach((it, i) => {
      const r = REAL16[i];
      assert.equal(it.index, r.index, '#' + i + ' index');
      assert.equal(it.ITID, r.ITID, '#' + i + ' ITID(u32@2)');
      assert.equal(it.type, r.type, '#' + i + ' type(u8@6)');
      assert.equal(it.count, r.count, '#' + i + ' count(i16@7)');
      assert.equal(it.amount, r.count, '#' + i + ' amount 不得与 count 分叉');
      assert.equal(it.WearState, r.WearState, '#' + i + ' WearState(u32@9)');
      assert.equal(it.slot.card1, r.card1, '#' + i + ' card1(u32@13)');
      assert.equal(it.slot.card2, r.card2, '#' + i + ' card2(u32@17)');
      assert.equal(it.slot.card3, r.card3, '#' + i + ' card3(u32@21)');
      assert.equal(it.slot.card4, r.card4, '#' + i + ' card4(u32@25)');
      assert.equal(it.HireExpireDate, r.HireExpireDate, '#' + i + ' HireExpireDate(i32@29)');
      assert.equal(it.IsIdentified, r.flag & 1, '#' + i + ' IsIdentified(flag bit0)');
      assert.equal(it.PlaceETCTab, (r.flag & 2), '#' + i + ' PlaceETCTab = flag & 2（客户端/roBrowser 同义，不是右移）');
      assert.equal(it.identified, !!(r.flag & 1), '#' + i + ' identified 镜像');
      // 记录里没有的字段必须显式「未知」，绝不填 0
      assert.equal(it.damaged, null, '#' + i + ' 背包记录没有损坏位 → 必须是 null 而不是 0');
      assert.equal(it.damagedKnown, false);
      assert.equal(it.refine, null); assert.equal(it.refineKnown, false);
      assert.equal(it.options, null); assert.equal(it.optionsKnown, false);
      assert.equal(it.enchantgrade, null); assert.equal(it.enchantKnown, false);
    });
    // cards 数组只收非 0 卡
    assert.deepEqual(plain(list[0].cards), [4000, 4100], 'cards 只放非 0 卡，按 card1..4 顺序');
    assert.deepEqual(plain(list[5].cards), [4005, 4200]);
  });

  test('V2.38.10 背包校验：不整除 / invType≠0（1=推车 2=仓库） / 太短 / 空表 一律拒绝且不动现有快照', () => {
    const w = makeWorld(src);
    bagParseOk(w, buildBagFrame(REAL16)); mkOk(w);
    const good = w.W.bagPktSnapshot();
    assert.equal(good.length, 16);
    // (a) 帧长 −5 不整除 34：切掉 1 字节（模拟版本差）
    assert.equal(w.W.bagPktHook(buildBagFrame(REAL16).subarray(0, 548), 2825), undefined);
    assert.equal(w.W.bagPktSnapshot().length, 16, '不整除必须被拒绝且保留旧快照');
    assert.ok(/不是「5 \+ 记录长34 的整数倍」/.test(w.ctx.bagPkt.why), '拒绝原因必须写清楚，实际：' + w.ctx.bagPkt.why);
    assert.ok(w.log.some((m) => m.indexOf('bag-pkt-split-reject') >= 0 && m.indexOf('rec=34') >= 0), '拒绝必须落日志');
    // (b) invType=1（推车分流）：绝不能当成背包
    w.W.bagPktHook(buildBagFrame([{ index: 9, ITID: 999, type: 4, count: 1, WearState: 2, card1: 0, card2: 0, card3: 0, card4: 0, HireExpireDate: -1, flag: 1 }], 1), 2825);
    assert.equal(w.W.bagPktSnapshot().length, 16, 'invType≠0（推车/仓库）必须被拒绝且保留旧快照');
    assert.ok(/invType=1/.test(w.ctx.bagPkt.why), '拒绝原因必须带 invType（推车=1），实际：' + w.ctx.bagPkt.why);
    // (c) 太短（< 5）
    w.W.bagPktHook(Buffer.from([0x09, 0x0b, 0x04, 0x00]), 2825);
    assert.equal(w.W.bagPktSnapshot().length, 16, '太短必须被拒绝且保留旧快照');
    // (d) 空表（5B、invType=0=背包）：0 件绝不是「成功」
    w.W.bagPktHook(buildBagFrame([], 0), 2825);
    assert.equal(w.W.bagPktSnapshot(), null, '空表不得置 complete');
    assert.equal(w.ctx.bagPkt.complete, false);
    assert.equal(w.ctx.bagPkt.why.indexOf('0 条') >= 0, true, '必须说明 0 条，实际：' + w.ctx.bagPkt.why);
  });

  test('V2.38.10 背包会话：SET 清空 → 整表 → RESULT 只关标记；本次没拿到才整份失效；非背包分流(2824/2827 invType=1/2)不碰背包', () => {
    const w = makeWorld(src);
    const setBag = ab(Buffer.from([0x08, 0x0b, 0x05, 0x00, 0x00]));
    const setEquip = ab(Buffer.from([0x08, 0x0b, 0x05, 0x00, 0x01]));
    const endBag = ab(Buffer.from([0x0b, 0x0b, 0x00, 0x00]));
    const endEquip = ab(Buffer.from([0x0b, 0x0b, 0x01, 0x00]));
    bagParseOk(w, buildBagFrame(REAL16));
    mkOk(w);
    w.W.bagPktHook(setEquip, 2824); w.W.bagPktHook(endEquip, 2827);
    assert.equal(w.W.bagPktSnapshot().length, 16, '装备分流会话不得动背包快照');
    w.W.bagPktHook(setBag, 2824);
    assert.equal(w.W.bagPktSnapshot(), null, '背包 SET 必须清空');
    bagParseOk(w, buildBagFrame(REAL16.slice(0, 4)));
    assert.equal(w.W.bagPktSnapshot().length, 4);
    w.W.bagPktHook(endBag, 2827);
    assert.equal(w.W.bagPktSnapshot().length, 4, '会话结束只关标记：本次拿到过整表 → 保留');
    // 本次会话一条都没拿到 → 整份失效（fail-closed）
    w.W.bagPktHook(setBag, 2824);
    w.W.bagPktHook(endBag, 2827);
    assert.equal(w.W.bagPktSnapshot(), null, '整份会话没拿到整表 → 必须失效');
    assert.equal(w.ctx.bagPkt.complete, false);
  });

  test('V2.38.10 换图/回角色列表必须作废背包整表（绝不沿用上一张图的背包）', () => {
    const w = makeWorld(src);
    bagParseOk(w, buildBagFrame(REAL16));
    mkOk(w);
    w.W.bagPktHook(buildZoneFrame('prontera'), 113);
    assert.equal(w.W.bagPktSnapshot(), null, '换图(op113)后背包整表必须作废');
    bagParseOk(w, buildBagFrame(REAL16));
    w.W.bagPktHook(Buffer.from([0x6b, 0x00, 0x00, 0x00]), 107);
    assert.equal(w.W.bagPktSnapshot(), null, '回角色列表后必须作废');
  });

  test('V2.38.10 手机场景：五路组件全不可用，只用包流也能列出背包（列/按 index 取）', () => {
    const dead = { uiComp: () => null, requireDB: () => null, UM: null, CLIENT: { SS: null, MR: null, DB: null, PS: null } };
    const w = makeWorld(src, dead);
    w.W.bagPktHook(buildBagFrame(REAL16), 2825);
    const list = w.W.bagList();
    assert.ok(Array.isArray(list) && list.length === 16, '组件全挂时包流必须顶上，实际：' + JSON.stringify(list));
    assert.equal(w.ctx.bagRead.source, 'packet.0x0b09', '来源标记必须是包流，实际：' + w.ctx.bagRead.source);
    assert.equal(list[7].ITID, 507);
    assert.equal(list[7].HireExpireDate, 1893456000);
    assert.equal(list[7].IsIdentified, 1);
    assert.equal(list[2].WearState, 2);           // 穿戴位来自 WearState
    const it = w.W.bagItemByIndex(3);
    assert.ok(it && it.ITID === 502 && it.index === 3, '按 index 取必须命中包流那条，实际：' + JSON.stringify(it));
  });

  test('V2.38.10 没包流时旧五路原样可用（⓪不得取代组件路线）', () => {
    const inv = { list: [{ index: 1, ITID: 501, type: 0, count: 5, WearState: 0 }] };
    const w = makeWorld(src, { uiComp: (n) => (n === 'Inventory' ? inv : null) });
    const list = w.W.bagList();
    assert.ok(Array.isArray(list) && list.length === 1 && list[0].ITID === 501, '旧组件路线必须仍然可用：' + JSON.stringify(list));
    assert.equal(w.ctx.bagRead.source, 'uiComp.Inventory.list', '来源标记必须仍是组件路线，实际：' + w.ctx.bagRead.source);
    assert.ok(w.W.bagItemByIndex(1) && w.W.bagItemByIndex(1).ITID === 501, '没有包流时组件路线必须照常返回那条，实际：' + JSON.stringify(w.W.bagItemByIndex(1)));
  });

  test('V2.38.10 类名路线：CLIENT.PS 给出新 opcode 时同样认（数字表 + 类名升级）', () => {
    const w = makeWorld(src, { psClassIndex: () => ({ sig: 7, byName: { 'ZC.SPLIT_SEND_ITEMLIST_NORMAL': { id: 8765, size: -1, name: 'ZC.SPLIT_SEND_ITEMLIST_NORMAL' } } }) });
    bagParseOk(w, buildBagFrame(REAL16.slice(0, 2)), 8765);
    assert.equal(w.W.bagPktSnapshot().length, 2, '类名升级出的 opcode 必须能解析');
  });
}

// ============ 二、地图 / 自身坐标 ============
for (const [name, src] of SOURCES) {
  test('V2.38.10 换图真帧（145，22B）：地图名 + 同包落地坐标一起更新', () => {
    const w = makeWorld(src);
    assert.equal(w.W.worldPktMap(), '', '初始必须是空串（未知），不得伪造');
    w.W.worldPktHook(buildMapMoveFrame('prontera', 150, 200), 145);
    assert.equal(w.W.worldPktMap(), 'prontera');
    assert.deepEqual(plain(w.W.worldPktPos()), { x: 150, y: 200, at: w.ctx.worldPkt.posAt, op: 145 });
    assert.ok(w.log.some((m) => m.indexOf('world-pkt-map op=145') >= 0 && m.indexOf('map=prontera') >= 0));
    // 客户端路线优先：MR 可用时 getMapName() 必须是客户端那一份
    const w2 = makeWorld(src, { CLIENT: { SS: null, MR: { currentMap: 'geffen.gat' }, DB: null, PS: null } });
    w2.W.worldPktHook(buildMapMoveFrame('prontera', 1, 2), 145);
    assert.equal(w2.W.getMapName(), 'geffen.gat', 'PC 路径必须优先，包流只是兜底');
    // 客户端整条不可达时才兜底
    assert.equal(w.W.getMapName(), 'prontera', '客户端拿不到时必须用包流兜底');
  });

  test('V2.38.10 自身坐标真帧（135，12B，Pos2 位打包）：MoveData[2]/[3] 是目的地', () => {
    const w = makeWorld(src);
    // 自检编码器与客户端解码器同构
    const buf = buildMoveFrame(11, 22, 150, 200);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const md = w.ctx.worldPktPos2(dv, 6);
    assert.deepEqual(plain(md.slice(0, 4)), [11, 22, 150, 200], 'Pos2 编码/解码必须互逆，实际：' + JSON.stringify(md));
    w.W.worldPktHook(buf, 135);
    assert.deepEqual(plain(w.W.worldPktPos()), { x: 150, y: 200, at: w.ctx.worldPkt.posAt, op: 135 });
    assert.equal(w.ctx.worldPkt.x, 150, '起点不是目的地：必须取 MoveData[2]/[3]');
    // (0,0) 是合法坐标：不能被真假值判断吞掉
    w.W.worldPktHook(buildMoveFrame(0, 0, 0, 0), 135);
    assert.deepEqual(plain(w.W.worldPktPos()), { x: 0, y: 0, at: w.ctx.worldPkt.posAt, op: 135 }, 'x=0/y=0 必须仍然「已知」');
  });

  test('V2.38.10 未知不伪造：没有包就是空串/null；换区清坐标；回角色列表清地图', () => {
    const w = makeWorld(src);
    assert.equal(w.W.getMapName(), '', '客户端与包流都没有 → 只能返回空串');
    assert.equal(w.W.worldPktPos(), null, '没有坐标 → 必须 null，不得是 {0,0}');
    w.W.worldPktHook(buildMapMoveFrame('morocc', 30, 40), 145);
    w.W.worldPktHook(buildZoneFrame('geffen'), 113);
    assert.equal(w.W.worldPktMap(), 'geffen', '进区通知必须更新地图名');
    assert.equal(w.W.worldPktPos(), null, '换区后坐标未知：绝不沿用上一张图的坐标');
    w.W.worldPktHook(buildMapMoveFrame('morocc', 1, 2), 145);
    w.W.worldPktHook(Buffer.from([0x6b, 0x00, 0x00, 0x00]), 107);
    assert.equal(w.W.worldPktMap(), '', '回角色列表必须清空地图（不得沿用上一张）');
    assert.equal(w.W.worldPktPos(), null);
  });

  test('V2.38.10 畸形帧不污染状态：短帧/空名字一律忽略', () => {
    const w = makeWorld(src);
    w.W.worldPktHook(buildMapMoveFrame('prontera', 5, 6), 145);
    w.W.worldPktHook(buildMapMoveFrame('prontera', 5, 6).subarray(0, 21), 145);   // 22B 少一字节
    assert.equal(w.W.worldPktMap(), 'prontera', '短帧不得覆盖已收到的好值');
    assert.deepEqual(plain(w.W.worldPktPos()), { x: 5, y: 6, at: w.ctx.worldPkt.posAt, op: 145 });
    const emptyName = Buffer.alloc(22); emptyName.writeUInt16LE(145, 0);
    w.W.worldPktHook(emptyName, 145);
    assert.equal(w.W.worldPktMap(), 'prontera', '空地图名不得写成空');
    w.W.worldPktHook(buildMoveFrame(1, 1, 2, 2).subarray(0, 11), 135);            // 12B 少一字节
    assert.deepEqual(plain(w.W.worldPktPos()), { x: 5, y: 6, at: w.ctx.worldPkt.posAt, op: 145 }, '短走路帧不得改动坐标');
  });
}

// ============ 二·补：C1/C2/C3 审计修正后的方向性用例 ============
const REAL14 = Array.from({ length: 14 }, (_, i) => ({
  index: i + 1, ITID: 600 + i, type: (i % 3), count: 2 + i, WearState: i % 2,
  card1: 700 + i, card2: (i % 4 === 0) ? 710 + i : 0, card3: 0, card4: (i === 13) ? 720 : 0,
  HireExpireDate: (i % 5 === 0) ? -1 : 1900000000 + i, flag: (i % 2) | (i % 3 === 0 ? 2 : 0),
}));
function rawBagFrame(len, invType) {
  const b = Buffer.alloc(len);
  b.writeUInt16LE(2825, 0); b.writeUInt16LE(len, 2); b.writeUInt8(invType, 4);
  return b;
}
function forceVer(w, v) { try { if (!w.ctx.CLIENT) w.ctx.CLIENT = {}; w.ctx.CLIENT.PACKETVER = v; } catch (e) {} }
test('V2.38.10 C1 方向：invType=0（背包）必须被接受；invType=1（推车）/2（仓库）必须被拒绝', () => {
  for (const [name, src] of SOURCES) {
    const w = makeWorld(src);
    w.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
    assert.equal(w.ctx.bagPkt.complete, true, 'invType=0（背包）必须被接受（' + name + '）');
    assert.equal(w.W.bagPktSnapshot().length, 16, 'invType=0 必须解析出 16 条（' + name + '）');
    w.W.bagPktHook(buildBagFrame(REAL16, 1), 2825);
    assert.equal(w.W.bagPktSnapshot().length, 16, 'invType=1（推车）不得替换背包快照（' + name + '）');
    assert.ok(/invType=1/.test(String(w.ctx.bagPkt.why || '')), '必须留下 invType=1 的拒绝理由（' + name + '）：' + w.ctx.bagPkt.why);
    w.W.bagPktHook(buildBagFrame(REAL16, 2), 2825);
    assert.equal(w.W.bagPktSnapshot().length, 16, 'invType=2（仓库）不得替换背包快照（' + name + '）');
    assert.ok(/invType=2/.test(String(w.ctx.bagPkt.why || '')), '必须留下 invType=2 的拒绝理由（' + name + '）：' + w.ctx.bagPkt.why);
  }
});
test('V2.38.10 C1 真实形状帧（2825 + invType=0，481B = 5+14×34）：手机端 bagList 必须读出 14 条', () => {
  for (const [name, src] of SOURCES) {
    const w = makeWorld(src);
    const frame = buildBagFrame(REAL14, 0);
    assert.equal(frame.length, 481, '真实形状帧必须是 481B = 5 + 14×34（ItemInfo 12~14 条那种）');
    w.W.bagPktHook(frame, 2825);
    assert.equal(w.ctx.bagPkt.complete, true, 'invType=0 真实形状帧必须被接受（' + name + '）');
    const list = w.ctx.bagList();
    assert.ok(Array.isArray(list) && list.length === 14, '手机端必须列出 14 条背包物品，实际 ' + (list && list.length) + '（' + name + '）');
    assert.equal(w.ctx.bagRead.source, 'packet.0x0b09', '来源必须是包流（' + name + '）');
    assert.equal(list[0].ITID, REAL14[0].ITID, '首条 ITID（' + name + '）');
    assert.equal(list[13].count, REAL14[13].count, '末条 count（' + name + '）');
    console.log('[V2.38.10 C1][' + name + '] 481B/invType=0 → bagList 条数=' + list.length + ' 来源=' + w.ctx.bagRead.source
      + ' 首条=' + JSON.stringify({ index: list[0].index, ITID: list[0].ITID, count: list[0].count, WearState: list[0].WearState, IsIdentified: list[0].IsIdentified, PlaceETCTab: list[0].PlaceETCTab, damaged: list[0].damaged }));
  }
});
test('V2.38.10 C2 包流是最高优先级：组件路线无效时不得覆盖或清空包流结果', () => {
  const w1 = makeWorld(STABLE);
  w1.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
  w1.ctx.uiComp = () => ({ list: [] });                          // 组件在但 .list 无效
  const l1 = w1.ctx.bagList();
  assert.ok(l1 && l1.length === 16, '组件 .list 无效时包流结果必须保留，实际 ' + (l1 && l1.length));
  assert.equal(w1.ctx.bagRead.source, 'packet.0x0b09', '来源仍必须是包流，实际 ' + w1.ctx.bagRead.source);
  const w2 = makeWorld(STABLE);
  w2.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
  w2.ctx.uiComp = () => null;                                     // 组件整条拿不到
  const l2 = w2.ctx.bagList();
  assert.ok(l2 && l2.length === 16, '组件整条拿不到时包流结果必须保留，实际 ' + (l2 && l2.length));
  const w3 = makeWorld(STABLE, { uiComp: () => ({ list: [{ index: 1, ITID: 501, type: 0, count: 5, WearState: 0 }] }) });
  const l3 = w3.ctx.bagList();                                    // 没有包流 → 旧组件路线照常
  assert.ok(l3 && l3.length === 1 && l3[0].ITID === 501, '没有包流时必须照常走组件路线，实际 ' + JSON.stringify(l3));
});
test('V2.38.10 C3 记录长以 PACKETVER 为权威：歧义帧一律拒绝、不动快照并记日志', () => {
  for (const [name, src] of SOURCES) {
    const logs = [];
    const w = makeWorld(src, { logs: logs });
    w.W.bagPktHook(buildBagFrame(REAL14, 0), 2825);
    assert.equal(w.W.bagPktSnapshot().length, 14, '前置 14 条（' + name + '）');
    w.W.bagPktHook(rawBagFrame(413, 0), 2825);                    // 413 = 5+17×24 = 5+12×34
    assert.equal(w.W.bagPktSnapshot().length, 14, 'PACKETVER 未知 + 帧长有歧义 → 拒绝且不动快照（' + name + '）');
    assert.ok(/有歧义/.test(String(w.ctx.bagPkt.why || '')), '必须写明歧义理由（' + name + '）：' + w.ctx.bagPkt.why);
    assert.ok(logs.some((l) => l.indexOf('bag-pkt-split-ambiguous') >= 0), '必须留一条歧义日志（' + name + '），实际 ' + JSON.stringify(logs.slice(-4)));
  }
});
test('V2.38.10 C3 本服 20211103：413B 按 34B 读作 12 条；<20181121 一律拒绝（24B 布局未实现）', () => {
  const w1 = makeWorld(STABLE); forceVer(w1, 20211103);
  w1.W.bagPktHook(rawBagFrame(413, 0), 2825);
  assert.equal(w1.W.bagPktSnapshot().length, 12, 'PACKETVER=20211103 ≥ 20181121 → 413B 就是 12×34B');
  const w2 = makeWorld(STABLE); forceVer(w2, 20180101);
  w2.W.bagPktHook(buildBagFrame(REAL14, 0), 2825);
  assert.equal(w2.W.bagPktSnapshot(), null, 'PACKETVER<20181121 → 拒绝且不动（本版只实现 34B）');
  assert.ok(/PACKETVER=20180101/.test(String(w2.ctx.bagPkt.why || '')), '拒绝理由必须带 PACKETVER，实际：' + w2.ctx.bagPkt.why);
  const w3 = makeWorld(STABLE); forceVer(w3, 0);
  w3.W.bagPktHook(buildBagFrame(REAL14, 0), 2825);
  assert.equal(w3.W.bagPktSnapshot().length, 14, 'PACKETVER 拿不到但长度无歧义 → 按本服 34B 分支解析');
});
test('V2.38.10 审计变异体：invType 方向反转 / PlaceETCTab 恒 0 / 接线改回覆盖式 / 去掉歧义拒绝 四处必须被杀死', () => {
  mustDie('M-BAG7 PlaceETCTab 恒 0', [['it.PlaceETCTab = flag & 2;', 'it.PlaceETCTab = 0;']],
    (w) => { w.W.bagPktHook(buildBagFrame(REAL16), 2825); BAG_FIELDS(w); });
  mustDie('M-BAG8 invType 方向反转(0↔1)', [['if (invType !== 0) {', 'if (invType !== 1) {', 2, '  function bagPktParseSplit(bytes, op, f) {']],
    (w) => {
      w.W.bagPktHook(buildBagFrame(REAL14, 0), 2825);
      assert.equal(w.W.bagPktSnapshot().length, 14, 'invType=0（背包）必须被接受');
    });
  mustDie('M-C2 包流接线改回覆盖式', [['if (_bpk) { var _plist = bagSourceTry("packet.0x0b09", _bpk); if (Array.isArray(_plist) && _plist.length) return _plist; }', 'if (_bpk) list = bagSourceTry("packet.0x0b09", _bpk);']],
    (w) => {
      w.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
      w.ctx.uiComp = () => ({ list: [] });
      const l = w.ctx.bagList();
      assert.ok(l && l.length === 16, '组件 .list 无效时包流结果必须保留');
    });
  mustDie('M-C3 去掉 24B/34B 歧义拒绝', [['} else if (((total - 5) > 0) && (((total - 5) % 24) === 0) && (((total - 5) % 34) === 0)) {', '} else if (false) {']],
    (w) => {
      w.W.bagPktHook(buildBagFrame(REAL14, 0), 2825);
      w.W.bagPktHook(rawBagFrame(413, 0), 2825);
      assert.equal(w.W.bagPktSnapshot().length, 14, '歧义帧必须拒绝且不动快照');
    });
});
test('V2.38.10 F3 145（同 zone 换图）不作废背包：长度与首条 ITID 不变', () => {
  for (const [name, src] of SOURCES) {
    const w = makeWorld(src);
    w.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
    const a = w.W.bagPktSnapshot();
    assert.ok(a && a.length === 16, '前置 16 条（' + name + '）');
    w.W.worldPktHook(buildMapMoveFrame('morocc', 30, 40), 145);          // 同 zone 换图
    w.W.bagPktHook(ab(Buffer.from([0x08, 0x0b, 0x05, 0x00, 0x01])), 2824); // 推车 SET
    w.W.bagPktHook(buildBagFrame(REAL16, 1), 2825);                      // 推车整表
    const b = w.W.bagPktSnapshot();
    assert.ok(b && b.length === a.length && b[0].ITID === a[0].ITID, '145 换图 / 推车帧都不得动背包快照（' + name + '）');
    assert.equal(w.W.bagPkt.rec, 34, '记录长仍是 34（' + name + '）');
    assert.equal(w.W.worldPktMap(), 'morocc', '同时确认 145 地图已更新（' + name + '）');
  }
});
test('V2.38.10 F2 遍历必须用权威 rec：表内 rec 写 33（与 PACKETVER 派生的 34 不一致）也必须按 34 解析', () => {
  const src = STABLE.replace('{ 2825: { rec: 34 } }', '{ 2825: { rec: 33 } }');
  assert.notEqual(src, STABLE, '表内 rec 的改写锚点必须存在');
  const logs = [];
  const w = makeWorld(src, { logs: logs });
  forceVer(w, 20211103);                                                  // 权威 = 34B
  w.W.bagPktHook(buildBagFrame(REAL16, 0), 2825);
  const list = w.W.bagPktSnapshot();
  assert.ok(list && list.length === 16, '权威 rec=34 必须解析出 16 条，实际 ' + (list && list.length));
  assert.equal(list[0].ITID, REAL16[0].ITID, '首条 ITID 必须按 34B 偏移读出');
  assert.equal(list[1].ITID, REAL16[1].ITID, '第 2 条 ITID 必须按 34B 偏移读出（按 33B 走会错位）');
  assert.equal(list[15].ITID, REAL16[15].ITID, '末条 ITID 必须按 34B 偏移读出');
  assert.equal(w.ctx.bagPkt.rec, 34, '快照记录长必须是权威 34');
  assert.ok(logs.some((l) => l.indexOf('bag-pkt-split-rec-mismatch') >= 0), '表内 rec 与权威不一致时必须留日志，实际 ' + JSON.stringify(logs.slice(-4)));
});
// ============ 三、自动丢弃门禁回归（红线段） ============
// 真跑产品里的 bagCleanExecute（门禁本体），不测副本：未武装时它必须在发任何包之前 return。
// 两个独立可观测信号：① czp("ITEM_THROW") 被调用 = 真的试图丢；② requireDB('Preferences/Controls') 被调用 = 已经走进发包循环。
function runGate(src) {
  const sent = [], reqs = [];
  const bagItems = [{ index: 1, ITID: 501, type: 0, count: 10, WearState: 0, IsIdentified: 1, src: 'packet' }];
  const start = src.indexOf("  var BAG_CLEAN_KEY = 'dsh-bag-clean-v2'");
  const end = src.indexOf('  function bagCleanEnsureHost(');
  assert.ok(start > 0 && end > start, '找不到 bagClean 门禁段');
  const code = src.slice(start, end) + '\n;this.API={bagClean, bagCleanExecute, bagCleanInventory, bagCleanPlan};';
  const el = (t) => ({ textContent: t, value: t, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = {
    requireDB: (n) => { reqs.push(String(n)); return null; }, Array, Object, Number, String, Boolean, Math, JSON, Date, isFinite, isNaN,
    Promise, setTimeout, clearTimeout,
    CLIENT: { SS: { Entity: {} }, PS: { CZ: { ITEM_THROW: function () {} } } },
    getMapName: () => 'prontera',
    bagList: () => bagItems,
    bagCleanSay: (m) => { if (m) sent.push('say:' + m); },
    czp: (n) => { sent.push(String(n)); return function () {}; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      querySelector: (sel) => (String(sel).indexOf('weight') >= 0 ? el(sel.indexOf('total') >= 0 ? '2000' : '2000') : el('0')),
      querySelectorAll: () => [],
    },
    setStatus: () => {}, activeProfileKey: () => 'test', getItemName: () => '苹果',
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const { bagClean } = ctx.API;
  assert.ok(bagClean && typeof ctx.API.bagCleanExecute === 'function', '门禁段必须能载入');
  const inv = ctx.API.bagCleanInventory();
  assert.ok(Array.isArray(inv) && inv.length === 1, '背包数据（包流）必须可见，否则这条测试没有意义：' + JSON.stringify(inv));
  bagClean.enabled = true; bagClean.config.enabled = true; bagClean.config.armed = false;
  bagClean.config.discardRules = { 501: 10 }; bagClean.config.categoryTypes = [0]; bagClean.config.protectedIds = [];
  bagClean.config.anytime = false;
  const p = ctx.API.bagCleanExecute(() => {}, false);
  if (p && typeof p.catch === 'function') p.catch(() => {});
  return { sent, reqs, throws: sent.filter((s) => s === 'ITEM_THROW').length, bagClean };
}
test('V2.38.10 红线段：换成包流来源后，未武装时一个都不丢（真跑 bagCleanExecute）', () => {
  const r = runGate(STABLE);
  assert.equal(r.throws, 0, '未武装时一个都不丢，实际发包：' + JSON.stringify(r.sent));
  assert.equal(r.reqs.length, 0, '未武装时连发包循环都不该进（requireDB 不应被调用），实际：' + JSON.stringify(r.reqs));
  assert.equal(r.sent.length, 0, '未武装时不该产生任何日志/包，实际：' + JSON.stringify(r.sent));
  assert.equal(r.bagClean.busy, false, '未武装路径必须立刻 return（finally 已复位 busy）');
});

// ============ 四、变异体：每处改动都必须被真实行为断言杀死 ============
// 锚点唯一性在 try 外断言；每处变异都要在 stable 与 exp 两份产物上都被杀死。
const BAG_FIELDS = (w) => {
  const list = w.W.bagPktSnapshot();
  assert.ok(Array.isArray(list) && list.length === 16, '16 条');
  list.forEach((it, i) => {
    assert.equal(it.index, REAL16[i].index); assert.equal(it.ITID, REAL16[i].ITID);
    assert.equal(it.type, REAL16[i].type); assert.equal(it.count, REAL16[i].count);
    assert.equal(it.WearState, REAL16[i].WearState);
    assert.equal(it.slot.card1, REAL16[i].card1); assert.equal(it.slot.card4, REAL16[i].card4);
    assert.equal(it.HireExpireDate, REAL16[i].HireExpireDate);
    assert.equal(it.IsIdentified, REAL16[i].flag & 1);
    assert.equal(it.PlaceETCTab, REAL16[i].flag & 2, '#' + i + ' PlaceETCTab 取 flag bit1（REAL16 里 i=2,3… 有置位 → 恒 0 变异会被杀）');
    assert.equal(it.damaged, null, '损坏位不在背包记录里 → 必须是「未知」');
  });
};
function mustDie(id, subs, check) {
  for (const [name, src] of SOURCES) {
    let s = src;
    for (const [a, b, want, after] of subs) {
      if (after) {
        const from = s.indexOf(after);
        assert.ok(from > 0, id + ' after 锚点必须存在：' + after);
        let k = s.indexOf(a, from);
        assert.ok(k > 0, id + ' 变异锚点必须命中（' + name + '）：' + a.slice(0, 60));
        let cnt = want == null ? 1 : want;
        while (k > 0 && cnt > 0) { s = s.slice(0, k) + b + s.slice(k + a.length); cnt--; k = s.indexOf(a, k + b.length); }
      } else {
        const n = s.split(a).length - 1;
        assert.equal(n, want == null ? 1 : want, id + ' 变异锚点命中数（' + name + '）：' + a.slice(0, 60) + ' 命中 ' + n);
        s = s.split(a).join(b);
      }
    }
    let died = null;
    try { check(makeWorld(s), s); } catch (e) { died = e && e.message; }
    assert.ok(died, id + ' 必须被真实行为断言杀死（' + name + '）');
    console.log('[V2.38.10 变异][' + name + '] ' + id + ' 被杀死：' + String(died).split(String.fromCharCode(10))[0].slice(0, 120));
  }
}
function mustLive(id, subs, check) {
  for (const [name, src] of SOURCES) {
    let s = src;
    for (const [a, b, want] of subs) {
      const n = s.split(a).length - 1;
      assert.equal(n, want == null ? 1 : want, id + ' 锚点命中数 ' + n + '：' + a.slice(0, 50));
      s = s.split(a).join(b);
    }
    let died = null;
    try { check(makeWorld(s), s); } catch (e) { died = e && e.message; }
    assert.ok(!died, id + ' 已证明是等效变异体，却被杀了（说明漏想了一条区分行为）：' + String(died).split(String.fromCharCode(10))[0]);
    console.log('[V2.38.10 等效变异][' + name + '] ' + id + ' 存活（与原实现行为等价，如实记录）');
  }
}
test('V2.38.10 背包变异体：记录长/计数偏移/invType 校验/complete 置真/会话计数/损坏位填 0 六处必须被杀死', () => {
  mustDie('M-BAG1 记录长 34→33', [['var ZC_BAG_SPLIT_NUM = { 2825: { rec: 34 } };', 'var ZC_BAG_SPLIT_NUM = { 2825: { rec: 33 } };']],
    (w) => { w.W.bagPktHook(buildBagFrame(REAL16), 2825); BAG_FIELDS(w); });
  mustDie('M-BAG2 计数偏移 i16@7→@6', [['count: dv.getInt16(b + 7, true)', 'count: dv.getInt16(b + 6, true)']],
    (w) => { w.W.bagPktHook(buildBagFrame(REAL16), 2825); BAG_FIELDS(w); });
  // 该条件在背包段出现两次（整表解析 + 会话状态机），两处一起摘掉 = 「invType 校验被删」的忠实变异
  mustDie('M-BAG3 去掉 invType 校验', [['if (invType !== 0) {', 'if (false) {', 2, '  function bagPktParseSplit(bytes, op, f) {']],
    (w) => {
      w.W.bagPktHook(buildBagFrame(REAL16), 2825);
      const equipShape = [{ index: 9, ITID: 999, type: 4, count: 1, WearState: 2, card1: 0, card2: 0, card3: 0, card4: 0, HireExpireDate: -1, flag: 1 }];
      w.W.bagPktHook(buildBagFrame(equipShape, 1), 2825);
      assert.equal(w.W.bagPktSnapshot().length, 16, 'invType=1（推车）绝不能当背包（条数必须还是 16）');
      assert.equal(w.W.bagPktSnapshot()[0].ITID, 500, '旧快照必须原样保留');
    });
  mustDie('M-BAG4 空表也置 complete', [['bagPkt.complete = (cnt > 0);', 'bagPkt.complete = true;']],
    (w) => {
      w.W.bagPktHook(buildBagFrame([], 0), 2825);
      assert.equal(w.ctx.bagPkt.complete, false, '空表绝不能置 complete');
      assert.equal(w.W.bagPktSnapshot(), null, '空表必须不可用');
    });
  // 修正记录：C1 会话 invType 判据修好之前，这个变异看起来「等价」（旧实现根本没进会话分支）→ 修好 C1 后它立刻被真实断言杀死。
  mustDie('M-BAG5 会话 chunks 不计数（结束即失效）', [['bagPkt.chunks++', 'bagPkt.chunks = bagPkt.chunks', 1]],
    (w) => {
      const set = ab(Buffer.from([0x08, 0x0b, 0x05, 0x00, 0x00])), end = ab(Buffer.from([0x0b, 0x0b, 0x00, 0x00]));
      w.W.bagPktHook(set, 2824); w.W.bagPktHook(buildBagFrame(REAL16.slice(0, 4)), 2825); w.W.bagPktHook(end, 2827);
      assert.ok(w.W.bagPktSnapshot() && w.W.bagPktSnapshot().length === 4, '本次会话拿到过整表 → 结束只关标记，必须保留');
    });
  mustDie('M-BAG6 损坏位填 0', [['it.damaged = null; it.damagedKnown = false;', 'it.damaged = 0; it.damagedKnown = false;']],
    (w) => { w.W.bagPktHook(buildBagFrame(REAL16), 2825); BAG_FIELDS(w); });
});
test('V2.38.10 地图/坐标变异体：地图偏移/坐标取错下标/换区不清坐标/未知伪造 0,0 四处必须被杀死', () => {
  mustDie('M-W1 换图 mapName 偏移 @2→@3', [['var nm = readFixedStr(dv, 2, 16);', 'var nm = readFixedStr(dv, 3, 16);']],
    (w) => { w.W.worldPktHook(buildMapMoveFrame('prontera', 150, 200), 145); assert.equal(w.W.worldPktMap(), 'prontera', '地图名必须来自 mapName@2'); });
  mustDie('M-W2 坐标取起点 md[0]/[1]', [['worldPkt.x = md[2]; worldPkt.y = md[3];', 'worldPkt.x = md[0]; worldPkt.y = md[1];']],
    (w) => { w.W.worldPktHook(buildMoveFrame(11, 22, 150, 200), 135); assert.deepEqual(plain(w.W.worldPktPos()), { x: 150, y: 200, at: w.ctx.worldPkt.posAt, op: 135 }, '目的地在 MoveData[2]/[3]'); });
  mustDie('M-W3 换区不坐标作废', [['worldPkt.x = null; worldPkt.y = null; worldPkt.posAt = 0; worldPkt.posOp = 0;   // 换区', 'worldPkt.posAt = 0; worldPkt.posOp = 0;   // 换区']],
    (w) => {
      w.W.worldPktHook(buildMapMoveFrame('morocc', 30, 40), 145);
      w.W.worldPktHook(buildZoneFrame('geffen'), 113);
      assert.equal(w.W.worldPktPos(), null, '换区后坐标未知：绝不沿用上一张图的坐标');
    });
  mustDie('M-W4 未知伪造 0,0', [['if (worldPkt.x == null || worldPkt.y == null) return null;', 'if (worldPkt.x == null || worldPkt.y == null) return { x: Number(worldPkt.x) || 0, y: Number(worldPkt.y) || 0, at: 0, op: 0 };']],
    (w) => { assert.equal(w.W.worldPktPos(), null, '没收到坐标必须是未知，不能伪造 0,0'); });
});
test('V2.38.10 门禁变异体：把 armed 从门禁里摘掉必须被红线段测试杀死', () => {
  const subs = [['(manual||bagClean.enabled&&bagClean.config.armed)', '(manual||bagClean.enabled)']];
  for (const [name, src] of SOURCES) {
    let s = src;
    for (const [a, b] of subs) {
      const n = s.split(a).length - 1;
      assert.equal(n, 1, '门禁变异锚点必须唯一（' + name + '），命中 ' + n);
      s = s.split(a).join(b);
    }
    let died = null;
    try {
      const r = runGate(s);
      if (r.throws !== 0 || r.reqs.length !== 0) throw new Error('未武装却进了发包循环：throws=' + r.throws + ' reqs=' + JSON.stringify(r.reqs));
    } catch (e) { died = e && e.message; }
    assert.ok(died, 'M-GATE1 必须被杀死（' + name + '）');
    console.log('[V2.38.10 变异][' + name + '] M-GATE1 摘掉 armed → 被杀死：' + String(died).split(String.fromCharCode(10))[0].slice(0, 120));
  }
});
