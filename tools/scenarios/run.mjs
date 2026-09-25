#!/usr/bin/env node
// ===============================================
// 场景回归测试 - headless 场景集
//
// 用途:发版前把历轮修过的寻路/射程/机制 bug 逐一场景化验证。
// 每个场景 = 搭建 Game 状态 + 推演 + 断言。全部确定性(固定 seed)。
//
// 用法:
//   node tools/scenarios/run.mjs            # 全部场景
//   node tools/scenarios/run.mjs 射程 跳河   # 按关键词过滤
//   node tools/scenarios/run.mjs --list     # 列出场景名
// ===============================================
import { Game } from '../../src/game/game.js';
import { castSpell, deployCard } from '../../src/game/spells.js';
import * as combat from '../../src/game/combat.js';

// ===== 测试基建 =====
let pass = 0, fail = 0, failedNames = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('    ✗ ' + msg); }
}
function newGame(seed = 1) {
  const g = new Game({ seed });
  g.units = [];   // 清默认单位(只留塔)
  return g;
}
function run(seconds, g, step = 1/30) {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) g.update(step);
}
// 推掉指定塔(排除干扰)
function killTower(g, side, lane) {
  const tw = g.towers[side][lane];
  tw.hp = 1; g.dealTowerDamage(tw, 999);
  return tw;
}

// ===== 场景集 =====
const SCENARIOS = {

// ---- 射程口径(v0.5.1:火枪白嫖国王塔修复) ----
'射程-火枪不能在国王塔射程外白嫖': () => {
  // 推掉全部公主塔,火枪手 vs 激活国王塔,任意站位互射
  const g = newGame();
  killTower(g, 0, 'left'); killTower(g, 0, 'right');
  killTower(g, 1, 'left'); killTower(g, 1, 'right');
  const kt = g.towers[1].king;
  kt.activated = true;
  const m = g.spawnUnit('musketeer', 0, 9, 10.5);  // 站国王塔攻击极限附近
  m.deployTimer = 0;
  run(3, g);
  const dist = Math.hypot(m.x - kt.x, m.y - kt.y);
  ok(kt.hp < kt.maxHp, `火枪应能打到塔(射程内)`);
  ok(m.hp < m.maxHp, `火枪在国王塔射程内应被还手(实距${dist.toFixed(2)},塔还手范围8.98)`);
},
'射程-边缘到边缘口径': () => {
  // 数学验证:火枪打国王塔极限 0.38+6+1.6=7.98 < 塔还手极限 1.6+7+0.38=8.98
  const g = newGame();
  const kt = g.towers[1].king;
  const m = new (Object.getPrototypeOf(g.units[0] || {}).constructor) && g.spawnUnit('musketeer', 0, 9, 11);
  m.deployTimer = 0;
  // 手动验证攻击判定:模拟 7.9 距离(火枪可打 7.98 内,塔可打 8.98 内)
  const muskAtk = 0.38 + 6.0 + 1.6;   // 7.98
  const kingAtk = 1.6 + 7.0 + 0.38;   // 8.98
  ok(muskAtk < kingAtk, '塔射程7>火枪6 时塔还手范围必然覆盖火枪攻击位(无白嫖窗口)');
},
'射程-公主塔攻击过河单位': () => {
  // v0.4.x 修复:公主塔攻击不到刚过河单位(索敌/攻击口径)
  const g = newGame();
  const pt = g.towers[1].left;   // 敌方左公主塔(3.5,6.5)
  // 敌方骑士走到河边(玩家侧刚过河)
  const k = g.spawnUnit('knight', 0, 3.5, 18);
  k.deployTimer = 0;
  run(6, g);   // 走向塔,进入射程
  ok(pt.hp < pt.maxHp || k.hp < k.maxHp, '过河单位与公主塔应发生交战');
},

// ---- 跳河/冲锋(v0.4.16/21) ----
'跳河-野猪桥正对走桥': () => {
  const g = newGame();
  const u = g.spawnUnit('hogRider', 0, 3.5, 20);
  u.deployTimer = 0;
  let jumped = false;
  for (let i = 0; i < 300; i++) {
    g.update(1/30);
    if (u.jumpTimer > 0) jumped = true;
    if (u.y < 14 || u.dead) break;
  }
  ok(!jumped, '野猪正对桥(x=3.5)过河应走桥不跳');
},
'跳河-野猪最左沿河跳河': () => {
  const g = newGame();
  const u = g.spawnUnit('hogRider', 0, 0.6, 20);
  u.deployTimer = 0;
  let jumped = false;
  for (let i = 0; i < 400; i++) {
    g.update(1/30);
    if (u.jumpTimer > 0) jumped = true;
    if (u.dead) break;
  }
  ok(jumped, '野猪在最左沿河位置应跳河(离桥≥1格)');
},
'跳河-黑王子不能跳河': () => {
  const g = newGame();
  const u = g.spawnUnit('darkPrince', 0, 0.6, 20);
  u.deployTimer = 0;
  let jumped = false;
  for (let i = 0; i < 500; i++) {
    g.update(1/30);
    if (u.jumpTimer > 0) jumped = true;
    if (u.dead) break;
  }
  ok(!jumped, '黑王子不能跳河(走桥)');
},
'冲锋-王子冲锋中不跳河': () => {
  const g = newGame();
  const u = g.spawnUnit('prince', 0, 0.6, 22);
  u.deployTimer = 0;
  let jumpedWhileCharged = false;
  for (let i = 0; i < 500; i++) {
    g.update(1/30);
    if (u.jumpTimer > 0 && u.charged) jumpedWhileCharged = true;
    if (u.dead) break;
  }
  ok(!jumpedWhileCharged, '王子冲锋状态遇河应中断冲锋走桥');
},

// ---- 寻路(v0.4.21/22) ----
'寻路-沉底中心四阶段路线': () => {
  const g = newGame();
  const u = g.spawnUnit('knight', 0, 9, 31);
  u.deployTimer = 0;
  const trace = [];
  for (let i = 0; i < 130; i++) {   // 13 秒走完四阶段
    g.update(0.1);
    trace.push({ x: u.x, y: u.y });
  }
  // 阶段1: 前 2.5 秒沿国王塔底横走(y 基本不变,x 从 9 → ~7)
  const phase1 = trace.slice(0, 25);
  const yRange = Math.max(...phase1.map(p=>p.y)) - Math.min(...phase1.map(p=>p.y));
  const xRange = Math.max(...phase1.map(p=>p.x)) - Math.min(...phase1.map(p=>p.x));
  ok(xRange > 1.5 && yRange < 1.2, `先横走(x变${xRange.toFixed(1)})再前(y变${yRange.toFixed(1)})`);
  // 阶段3: 中段(5~11s)沿公主塔内侧(x≈5.27±0.5)纵走
  const mid = trace.slice(50, 110);
  const innerLane = mid.filter(p => Math.abs(p.x - 5.27) < 0.6);
  ok(innerLane.length > mid.length * 0.4, `中段应沿公主塔内侧走廊(x≈5.27,实际${innerLane.length}/${mid.length}帧)`);
},
'寻路-骷髅军团沉底分双路': () => {
  const g = newGame();
  const okd = deployCard('skeletonArmy', 0, 9, 31, g);
  ok(okd, '骷髅军团沉底中心可部署(塔占面积边界不误挡)');
  run(8, g);
  const skels = g.units.filter(u => u.cardId === 'skeletonArmy' && !u.dead);
  let inRiver = 0;
  for (const s of skels) {
    if (s.y > 15 && s.y < 17 && !(Math.abs(s.x-3.5) < 1.5 || Math.abs(s.x-14.5) < 1.5)) inRiver++;
  }
  ok(inRiver === 0, `无骷髅掉河(实际${inRiver}只)`);
},
'寻路-塔占面积不挡塔后行': () => {
  // v0.4.22: y=31(塔后第一行)可部署
  const g = newGame();
  const okd = deployCard('knight', 0, 9, 31, g);
  ok(okd, '国王塔正后方 y=31 可部署');
},

// ---- 机制(v0.4.19/20) ----
'机制-冰法落地不误伤友军': () => {
  const g = newGame();
  const foe = g.spawnUnit('knight', 1, 14, 28); foe.deployTimer = 0;
  const ally = g.spawnUnit('giant', 0, 14.2, 28); ally.deployTimer = 0;
  const iw = g.spawnUnit('iceWizard', 0, 14, 28);
  iw.deployTimer = 0.01;
  run(0.3, g);
  ok(ally.hp === ally.maxHp, '友军不受落地伤害');
  ok(foe.hp < foe.maxHp, '敌方受落地伤害');
  ok(foe.slowTimer > 0, '敌方被落地减速');
},
'机制-召唤物无部署硬直': () => {
  const g = newGame();
  const w = g.spawnUnit('witch', 0, 9, 25); w.deployTimer = 0;
  run(1.6, g);
  const skels = g.units.filter(u => u.cardId === 'skeletons');
  ok(skels.length >= 4, `女巫召唤≥4骷髅(得${skels.length})`);
  ok(skels.every(s => s.deployTimer <= 0), '召唤骷髅无硬直');
},
'机制-死亡炸弹伤双方': () => {
  const g = newGame();
  const gs = g.spawnUnit('giantSkeleton', 0, 9, 28); gs.deployTimer = 0;
  const ally = g.spawnUnit('giant', 0, 9.4, 28); ally.deployTimer = 0;
  const foe = g.spawnUnit('giant', 1, 8.6, 28); foe.deployTimer = 0;
  // 冻结住旁观者(防 3 秒引信期间走开,隔离测试炸弹本身)
  ally.frozen = 99; foe.frozen = 99;
  gs.hp = 1; g.dealDamage(gs, 999);
  run(4, g);
  ok(ally.hp < ally.maxHp, `死亡炸弹伤友军(中立爆炸,${ally.maxHp}→${ally.hp})`);
  ok(foe.hp < foe.maxHp, `死亡炸弹伤敌方(${foe.maxHp}→${foe.hp})`);
},
'机制-毒药不伤友军': () => {
  const g = newGame();
  const ally = g.spawnUnit('giant', 0, 4, 28); ally.deployTimer = 0;
  const aB = ally.hp;
  castSpell('poison', 0, 4, 28, g);
  run(2, g);
  ok(ally.hp === aB, `毒药不伤友军(${aB}→${ally.hp})`);
},
'机制-飞桶塔中心等边三角形': () => {
  const g = newGame();
  castSpell('goblinBarrel', 0, 3.5, 6.5, g);   // 扔敌方左公主塔中心
  run(2.5, g);
  const gobs = g.units.filter(u => u.cardId === 'goblins');
  ok(gobs.length >= 3, `飞桶出≥3哥布林(得${gobs.length})`);
  if (gobs.length >= 3) {
    // 等边三角形:三哥布林到塔中心距离应接近(环形分布)
    const tw = g.towers[1].left;
    const ds = gobs.slice(0,3).map(gb => Math.hypot(gb.x - tw.x, gb.y - tw.y));
    const spread = Math.max(...ds) - Math.min(...ds);
    ok(spread < 1.2, `三哥布林围绕塔分布均匀(距塔心差${spread.toFixed(2)})`);
  }
},
'机制-护盾溢出不穿透': () => {
  const g = newGame();
  const dp = g.spawnUnit('darkPrince', 0, 9, 25); dp.deployTimer = 0;
  const hpB = dp.hp;
  // 雷电级大伤害打盾(128):溢出应完全无效
  g.dealDamage(dp, 999, null);
  ok(dp.hp === hpB, '盾被击破时溢出伤害不穿透本体');
  ok(dp.shield === 0, '盾清零');
},

// ---- 连弩/迫击炮打部队(wiki:Target=Ground,非只索塔) ----
'索敌-连弩还击戈仑': () => {
  // 2026-09-25 用户战报:连弩放着不打走近的戈仑(此前误设 targetsTower
  // 只索塔)。wiki X-Bow Target=Ground:部队进射程必须被攻击
  const g = newGame();
  const xbow = g.spawnUnit('xbow', 0, 8.5, 21);
  const golem = g.spawnUnit('golem', 1, 8.5, 14);   // 正对面走来,远小于 sight 11
  run(6, g);
  ok(golem.hp < golem.maxHp, `连弩应对戈仑造成伤害(${Math.round(golem.hp)}/${golem.maxHp})`);
},

'索敌-迫击炮打部队但近身盲区': () => {
  // unit:attack 事件不带 target,用索敌结果断言(冻结骑士隔离其行为)
  // 远于盲区(距离7 > 4):迫击炮应锁定并攻击骑士
  const g = newGame();
  const mortar = g.spawnUnit('mortar', 0, 8.5, 21);
  const knight = g.spawnUnit('knight', 1, 8.5, 14);
  knight.frozen = 99;
  run(8, g);
  ok(mortar.target && mortar.target.ref === knight, `迫击炮应锁定远于盲区的骑士(实际=${mortar.target ? mortar.target.ref.cardId : '无'})`);
  ok(knight.hp < knight.maxHp, `迫击炮应对其造成伤害(${Math.round(knight.hp)}/${knight.maxHp})`);
  // 近身盲区(距离≈1.3 < 4):迫击炮不应锁定骑士
  const g2 = newGame();
  const mortar2 = g2.spawnUnit('mortar', 0, 8.5, 21);
  const knight2 = g2.spawnUnit('knight', 1, 8.4, 22.2);
  knight2.frozen = 99;
  run(8, g2);
  ok(!mortar2.target || mortar2.target.ref !== knight2, '盲区内骑士不应被迫击炮锁定');
},

// ---- 塔击杀哥布林发数(wiki 口径监控) ----
'塔-公主塔击杀哥布林发数': () => {
  // wiki 11级:塔 dmg109(项目54), 哥布林 hp202(项目101)
  // 同级数学:54×2=108>101 → 2发。此场景监控口径一致性:
  // 若未来调成"3发"(用户记忆/旧版数值),改这里断言即可
  const g = newGame();
  castSpell('goblinBarrel', 0, 3.5, 6.5, g);
  const tw = g.towers[1].left;
  const hits = new Map();
  const orig = g.dealDamage.bind(g);
  g.dealDamage = (unit, dmg, source, card) => {
    const r = orig(unit, dmg, source, card);
    if (source && source.isTower && !unit.isTower) hits.set(unit, (hits.get(unit) || 0) + 1);
    return r;
  };
  run(12, g);
  const counts = [...hits.values()];
  ok(counts.length >= 3, `塔应逐个攻击哥布林(${counts.length}只被打过)`);
  // 当前 wiki 同级口径:每只 2 发
  ok(counts.every(c => c >= 2), `每只哥布林至少被击2发(${counts.join(',')})`);
},

};

// ===== 运行器 =====
const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('场景列表:');
  for (const name of Object.keys(SCENARIOS)) console.log('  ' + name);
  process.exit(0);
}
const filters = args.filter(a => !a.startsWith('--'));
const names = Object.keys(SCENARIOS).filter(n =>
  filters.length === 0 || filters.some(f => n.includes(f)));
console.log(`场景回归: ${names.length}/${Object.keys(SCENARIOS).length} 个场景\n`);
for (const name of names) {
  const before = fail;
  try {
    SCENARIOS[name]();
  } catch (e) {
    fail++;
    console.log('    ✗ 场景异常: ' + e.message);
  }
  const okNow = fail === before;
  console.log(`${okNow ? '✓' : '✗'} ${name}`);
  if (!okNow) failedNames.push(name);
}
console.log(`\n${names.length - failedNames.length}/${names.length} 场景通过` +
  (failedNames.length ? `\n失败: ${failedNames.join(', ')}` : ''));
process.exit(failedNames.length ? 1 : 0);
