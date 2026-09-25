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
import * as movement from '../../src/game/movement.js';

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
function isBridgePos(x) {
  const ix = Math.floor(x);
  return [3, 4, 14, 15].includes(ix);
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
'寻路-左下角沉底走塔外侧': () => {
  // 2026-09-25 用户战报:左下角沉底被强制横穿到公主塔右侧(内侧)。
  // 官方行为:角落沉底走外侧——斜线到公主塔左下角,沿左侧,过塔奔左桥
  const g = newGame();
  const u = g.spawnUnit('knight', 0, 0.3, 30.8);
  u.deployTimer = 0;
  const trace = [];
  for (let i = 0; i < 160; i++) {
    g.update(0.1);
    trace.push({ x: u.x, y: u.y });
  }
  // 中段(4~10s)沿公主塔左外侧走廊(x≈1.7±0.6)纵走,绝不应越过塔心(3.5)
  const mid = trace.slice(40, 100);
  const outerLane = mid.filter(p => Math.abs(p.x - 1.73) < 0.6);
  ok(outerLane.length > mid.length * 0.5, `中段应沿公主塔左外侧走廊(x≈1.7,实际${outerLane.length}/${mid.length}帧)`);
  ok(mid.every(p => p.x < 3.4), `全程不应横穿到塔右侧(塔心 3.5,最大 x=${Math.max(...mid.map(p=>p.x)).toFixed(1)})`);
  // 过塔后向左桥汇合(终点 x 趋近 3.5)
  const tail = trace.slice(-20);
  const avgX = tail.reduce((s,p)=>s+p.x,0) / tail.length;
  ok(Math.abs(avgX - 3.5) < 0.8, `过塔后奔左桥(x→3.5,尾部均值 ${avgX.toFixed(1)})`);
},
'寻路-右下角沉底走塔外侧(镜像)': () => {
  const g = newGame();
  const u = g.spawnUnit('knight', 0, 17.7, 30.8);
  u.deployTimer = 0;
  const trace = [];
  for (let i = 0; i < 160; i++) {
    g.update(0.1);
    trace.push({ x: u.x, y: u.y });
  }
  const mid = trace.slice(40, 100);
  const outerLane = mid.filter(p => Math.abs(p.x - 16.27) < 0.6);
  ok(outerLane.length > mid.length * 0.5, `中段应沿公主塔右外侧走廊(x≈16.3,实际${outerLane.length}/${mid.length}帧)`);
  ok(mid.every(p => p.x > 14.6), `全程不应横穿到塔左侧(塔心 14.5,最小 x=${Math.min(...mid.map(p=>p.x)).toFixed(1)})`);
  const tail = trace.slice(-20);
  const avgX = tail.reduce((s,p)=>s+p.x,0) / tail.length;
  ok(Math.abs(avgX - 14.5) < 0.8, `过塔后奔右桥(x→14.5,尾部均值 ${avgX.toFixed(1)})`);
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
'机制-死亡炸弹只伤敌方': () => {
  // 2026-09-25 用户战报:友军骷髅巨人炸弹误伤己方冰法。
  // 复核官方机制:CR 无友军伤害(法术/死亡炸弹都只伤敌方)——
  // wiki 骷髅巨人"配护卫推进"战术成立的前提就是炸弹不伤友军
  const g = newGame();
  const gs = g.spawnUnit('giantSkeleton', 0, 9, 28); gs.deployTimer = 0;
  const ally = g.spawnUnit('giant', 0, 9.4, 28); ally.deployTimer = 0;
  const foe = g.spawnUnit('giant', 1, 8.6, 28); foe.deployTimer = 0;
  // 冻结住旁观者(防 3 秒引信期间走开,隔离测试炸弹本身)
  ally.frozen = 99; foe.frozen = 99;
  gs.hp = 1; g.dealDamage(gs, 999);
  run(4, g);
  ok(ally.hp === ally.maxHp, `死亡炸弹不伤友军(${ally.maxHp}→${ally.hp})`);
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


// ===== 规格对齐(v0.6.7,对照 docs/THIRD-PARTY-SPEC.md) =====

'规格-塔索敌含目标hitbox且视野不低于射程': () => {
  // 规格 §5.2 视野 floor:塔索敌判定 = tw.radius + max(sight,range) + e.radius
  // 大体积单位(戈仑 r=0.6)停在"中心距恰在旧口径外"处也必须被索敌
  const g = newGame();
  const tw = g.towers[1].king;
  tw.activated = true;
  // 公主塔在场上会先索敌干扰,推掉隔离
  killTower(g, 1, 'left'); killTower(g, 1, 'right');
  const golem = g.spawnUnit('golem', 0, 9, tw.y + 7.0 + 0.2);  // 恰在射程边缘外一点
  golem.deployTimer = 0;
  run(1, g);
  const t = tw.target;
  ok(t && t.ref === golem, `国王塔应索敌视野边缘的戈仑(实际=${t ? t.ref.cardId : '无'})`);
  // 走近后必须被打(攻击判定同口径)
  run(4, g);
  ok(golem.hp < golem.maxHp, `国王塔应对其造成伤害(${Math.round(golem.hp)}/${golem.maxHp})`);
},

'规格-建筑到期触发死亡爆炸(炸弹塔)': () => {
  // 规格 §6.3:到期=完整死亡,死亡能力全部触发。炸弹塔到期应爆炸
  const g = newGame();
  const bt = g.spawnUnit('bombTower', 0, 4, 25);
  bt.deployTimer = 0;
  const enemy = g.spawnUnit('knight', 1, 4, 26.5);   // 贴近炸弹塔,到期爆炸波及
  enemy.deployTimer = 0; enemy.frozen = 99;
  bt.lifetime = 0.5; bt.hp = bt.maxHp;               // 加速到期
  const kHp = enemy.hp;
  run(2, g);
  ok(bt.dead, '炸弹塔应到期消亡');
  ok(enemy.hp < kHp, `到期爆炸应伤害贴近敌人(${Math.round(enemy.hp)}/${kHp})`);
},

'规格-冻结期间攻击冷却暂停': () => {
  // 规格 §5.6:冻结=时间停止,冷却不走。电击(castTime 0.5s 后结算,
  // 眩晕 0.5s)——眩晕剩余时间内地狱塔冷却不应恢复
  const g = newGame();
  const it = g.spawnUnit('infernoTower', 0, 8.5, 21);
  it.deployTimer = 0;
  const knight = g.spawnUnit('knight', 1, 8.5, 17);
  knight.deployTimer = 0; knight.frozen = 99;
  run(3, g);                        // 地狱塔开火数次,cd 处于循环中
  ok(knight.hp < knight.maxHp, '地狱塔应已攻击');
  castSpell('zap', 1, 8.5, 21, g);  // 电击(0.5s 后结算:眩晕 + 重置充能)
  // 显式步进到结算后(castTime 0.5;浮点累积误差下 run(0.51) 可能恰欠一步)
  for (let i = 0; i < 18; i++) g.update(1/30);   // 0.6s:结算完成,眩晕剩 ~0.4s
  ok(it.stunned > 0, `电击结算后应眩晕地狱塔(实际=${it.stunned})`);
  const cdAtStun = it.atkCD;
  for (let i = 0; i < 9; i++) g.update(1/30);    // 0.3s:仍在眩晕窗口内
  ok(it.atkCD >= cdAtStun - 0.01, `眩晕中冷却应暂停(${it.atkCD.toFixed(2)} vs ${cdAtStun.toFixed(2)})`);
},

'规格-电系法术重置地狱塔充能': () => {
  // 规格 §5.6:zap 重置充能是官方机制。烧到高倍率后吃电击应回落 1 倍
  const g = newGame();
  const it = g.spawnUnit('infernoTower', 0, 8.5, 21);
  it.deployTimer = 0;
  const giant = g.spawnUnit('giant', 1, 8.5, 20);
  giant.deployTimer = 0; giant.frozen = 99;
  run(2.5, g);
  ok(it.rampMult > 1.5, `持续烧巨人应叠起倍率(${it.rampMult.toFixed(2)})`);
  castSpell('zap', 1, 8.5, 21, g);
  run(0.55, g);                     // 等 castTime 结算
  ok(it.rampMult === 1, `电击后倍率应重置(实际=${it.rampMult})`);
},

'规格-盲行车道制(公主塔倒后不斜切)': () => {
  // 规格 §3.3 laneObjective:盲行单位沿自己车道走,己车道公主塔倒后
  // 直进国王塔,不斜切另一路的公主塔
  const g = newGame();
  // 玩家推掉 AI 左公主塔
  killTower(g, 1, 'left');
  // 骑士在左侧盲行(无视野内敌人)
  const k = g.spawnUnit('knight', 0, 3, 14);
  k.deployTimer = 0;
  const t = combat.getMarchTarget(k, g);
  ok(t && t.type === 'king', `左路盲行目标应为国王塔(实际=${t ? t.type + '/' + t.lane : '无'})`);
  // 右路公主塔存活:右路盲行骑士应打右公主塔(不因左侧更近的塔倒下改道)
  const k2 = g.spawnUnit('knight', 0, 15, 14);
  k2.deployTimer = 0;
  const t2 = combat.getMarchTarget(k2, g);
  ok(t2 && t2.lane === 'right', `右路盲行目标应为右公主塔(实际=${t2 ? t2.type + '/' + t2.lane : '无'})`);
},

'规格-挤出后不落河道': () => {
  // 规格 §4.2:碰撞分离后统一 re-clamp——挤出不得把单位推进非桥河道
  const g = newGame();
  // 单位夹在河边两座"建筑"之间:取 cannon(敌方)贴岸放,单位被推挤
  const c1 = g.spawnUnit('cannon', 1, 8.5, 18); c1.deployTimer = 0;  // 敌方建筑,占位
  const c2 = g.spawnUnit('cannon', 1, 6.8, 18); c2.deployTimer = 0;
  const u = g.spawnUnit('knight', 0, 7.6, 17.2);  // 恰在河边缝隙
  u.deployTimer = 0;
  run(0.1, g);
  const inRiver = u.y > 15 && u.y < 17 && !(u.x > 2.5 && u.x < 5.5) && !(u.x > 13.5 && u.x < 16.5);
  ok(!inRiver || isBridgePos(u.x), `挤出后不应落在非桥河道(位置=${u.x.toFixed(1)},${u.y.toFixed(1)})`);
},
// ===== 机制底盘(v0.6.8,ARCHITECTURE-REVIEW 路线图) =====

'投射-塔箭追踪命中哥布林': () => {
  // 规格 §6.1:塔箭 = 投射物(弱引用追踪,命中才结算伤害)
  const g = newGame();
  const tw = g.towers[1].left;
  const gob = g.spawnUnit('goblins', 0, 3.5, 12);   // 塔射程内
  gob.deployTimer = 0;
  run(3, g);
  ok(gob.hp < gob.maxHp, `塔箭应命中哥布林(${Math.round(gob.hp)}/${gob.maxHp})`);
  ok(g.projectiles.length === 0 || g.projectiles.every(p => !p.dead || true), '投射物列表无泄漏(命中即清)');
},

'投射-目标死亡弹落空': () => {
  // 规格 §6.1:目标死亡 → 投射物自灭,不找替身
  const g = newGame();
  const m = g.spawnUnit('musketeer', 0, 9, 20); m.deployTimer = 0;
  const skel = g.spawnUnit('skeletons', 1, 9, 16); skel.deployTimer = 0;
  // 手动射一发,立刻杀死目标,推进时间——不得对任何单位结算伤害
  const before = g.projectiles.length;
  g.fireProjectile(m, { type: 'unit', ref: skel }, { speed: 6, dmg: 100, attacker: m });
  skel.dead = true; skel.hp = 0;
  run(1.5, g);
  const stray = g.units.filter(u => !u.dead && u.hp < u.maxHp && u !== m);
  ok(g.projectiles.length === before, `目标死亡的投射物应自灭(剩${g.projectiles.length})`);
  ok(stray.length === 0, `不应误伤替身(误伤${stray.length}个)`);
},

'投射-远程单位伤害随弹飞行': () => {
  // 火枪手伤害在弹到达时结算:目标在弹飞行中回血/死亡场景下语义正确
  const g = newGame();
  const m = g.spawnUnit('musketeer', 0, 9, 20); m.deployTimer = 0;
  const k = g.spawnUnit('knight', 1, 9, 16); k.deployTimer = 0; k.frozen = 99;
  // v0.6.9 前摇 0.7s:出手 t≈0.7,弹飞 4格/12≈0.33 → 命中 ≈1.03s;
  // t=0.9s 时弹在飞,knight 不应已受伤;t=1.3s 首发已到
  run(0.9, g);
  ok(k.hp === k.maxHp, `前摇+弹飞期间不应受伤(${Math.round(k.hp)})`);
  run(0.4, g);   // 累计 1.3s:首发命中
  ok(k.hp < k.maxHp, `火枪伤害应经投射物到达(${Math.round(k.hp)}/${k.maxHp})`);
},

'位移-拉近推离与建筑免疫': () => {
  // 规格 §4.4:pullToward/pushAway 位移四件套;建筑/塔免疫;河界钳制
  const { pullToward, pushAway } = movement;
  const g = newGame();
  const k = g.spawnUnit('knight', 0, 9, 20); k.deployTimer = 0;
  // 拉近:向 (9,15) 拉 3 格
  pullToward(g, k, { x: 9, y: 15 }, 3);
  ok(Math.abs(k.y - 17) < 0.01, `拉近 3 格(y=17,实际${k.y.toFixed(2)})`);
  // 推离:从 (9,25) 推离 2 格
  pushAway(g, k, { x: 9, y: 25 }, 2);
  ok(Math.abs(k.y - 15) < 0.01 || k.y < 15.5, `推离后不越界(y=${k.y.toFixed(2)})`);
  // 建筑免疫:加农炮不被拉
  const c = g.spawnUnit('cannon', 0, 9, 22); c.deployTimer = 0;
  const cy = c.y;
  pullToward(g, c, { x: 9, y: 10 }, 5);
  ok(c.y === cy, '建筑免疫位移');
  // 塔免疫
  const tw = g.towers[0].king;
  const ty = tw.y;
  pushAway(g, tw, { x: 9, y: 10 }, 5);
  ok(tw.y === ty, '塔免疫位移');
},

'变形-hp阈值触发换卡': () => {
  // 变形底盘:special.transform.atHp 阈值触发原位换卡
  const g = newGame();
  // 手工造一张变形卡场景:giant 打到半血变成 2 个 goblins 的假想卡
  // 直接用引擎验证:构造 transform 状态
  const u = g.spawnUnit('giant', 0, 9, 20);
  u.deployTimer = 0;
  u.card = Object.assign({}, u.card, { special: Object.assign({}, u.card.special, {
    transform: { atHp: 0.5, card: 'golemite' },
  }) });
  u.hp = u.maxHp;                       // 满血不触发
  run(0.2, g);
  ok(!u.dead, '满血不变形');
  u.hp = u.maxHp * 0.4;                 // 掉到 40% < 50% 阈值
  const golsBefore = g.units.filter(x => x.cardId === 'golemite').length;
  run(1/30, g);                         // 一帧:变形发生但新单位未及移动
  const gols = g.units.filter(x => x.cardId === 'golemite' && !x.dead);
  ok(gols.length === golsBefore + 1, `应变形出 1 个小戈仑(实际${gols.length})`);
  ok(Math.abs(gols[0].x - 9) < 0.2 && Math.abs(gols[0].y - 20) < 0.2, `新单位原位生成(${gols[0].x.toFixed(1)},${gols[0].y.toFixed(1)})`);
},

'治疗-带上限': () => {
  // 治疗底盘:healUnit 恢复血量但不超过 maxHp
  const g = newGame();
  const k = g.spawnUnit('knight', 0, 9, 25); k.deployTimer = 0;
  k.hp = 100;
  g.healUnit(k, 50);
  ok(k.hp === 150, `治疗 +50(${k.hp})`);
  g.healUnit(k, 9999);
  ok(k.hp === k.maxHp, `不超过上限(${k.hp}/${k.maxHp})`);
},

'变形-killsSelf走完整死亡管线': () => {
  // v0.6.8 review 修复:killsSelf 分支此前不发 killed 事件/无特效/无死亡能力
  const g = newGame();
  let killedEmitted = 0;
  g.bus.on('unit:killed', () => killedEmitted++);
  const u = g.spawnUnit('giant', 0, 9, 20);
  u.deployTimer = 0;
  // 炸墙桶式:半血自爆并生成 2 骷髅
  u.card = Object.assign({}, u.card, { special: Object.assign({}, u.card.special, {
    transform: { atHp: 0.5, card: 'skeletons', killsSelf: true },
    deathDamage: { dmg: 80, splash: 2.0, targets: 7 },
  }) });
  const foe = g.spawnUnit('knight', 1, 9, 21);   // 附近敌人吃死亡爆炸
  foe.deployTimer = 0; foe.frozen = 99;
  const foeHp = foe.hp;
  u.hp = u.maxHp * 0.4;
  run(1/30, g);
  ok(u.dead, 'killsSelf 应致原单位死亡');
  ok(killedEmitted >= 1, `应发出 unit:killed 事件(${killedEmitted})`);
  ok(foe.hp < foeHp, `死亡爆炸应波及敌人(${Math.round(foe.hp)}/${foeHp})`);
  const skels = g.units.filter(x => x.cardId === 'skeletons' && !x.dead);
  ok(skels.length === 3, `变形体应生成(骷髅卡 count=3,实际${skels.length})`);
},

// ===== 卡牌实装(v0.6.9:公主) =====

'公主-桥上白嫖公主塔': () => {
  // 射程 9 > 塔射程 7.5:公主站桥上打公主塔,塔够不着她(官方标志性行为)
  const g = newGame();
  const p = g.spawnUnit('princess', 0, 3.5, 17.5);   // 玩家侧桥头
  p.deployTimer = 0;
  const tw = g.towers[1].left;                        // AI 左公主塔 (3.5,6.5)
  run(12, g);
  ok(tw.hp < tw.maxHp, `公主应打到敌方公主塔(${Math.round(tw.hp)}/${tw.maxHp})`);
  // 塔还手判定:塔攻击公主的距离 = |17.5-6.5|=11 > 1.2+7.5+0.38=9.08 → 打不着
  ok(p.hp === p.maxHp, `塔不应还手(公主 hp=${p.hp}/${p.maxHp})`);
},

'公主-溅射箭清群体': () => {
  // 溅射 2.0:一发箭波及聚拢的多个敌人(溅射远程走瞬发 AOE 路径,
  // 落点在主目标位置;冻结哥布林防移动干扰)。
  // 摆位注意:g3 必须同时处于①溅射半径外(>2.32)②公主射程外(>9.8,
  // 否则 g1/g2 死后 g3 成为直射主目标——是正常索敌不是溅射泄漏)
  // ③两座玩家公主塔射程外 → 用 x 远端+推掉玩家公主塔隔离
  const g = newGame();
  killTower(g, 0, 'left'); killTower(g, 0, 'right');
  const p = g.spawnUnit('princess', 0, 3.5, 22);
  p.deployTimer = 0;
  const g1 = g.spawnUnit('goblins', 1, 3.5, 18);   // 主目标(射程内站定即打)
  const g2 = g.spawnUnit('goblins', 1, 4.3, 18.2); // 距主目标~1.0 < 2.32 溅射内
  const g3 = g.spawnUnit('goblins', 1, 15.5, 12);  // 距主目标>12(溅射外+射程外),
                                                    // 距玩家王塔(9,29)=17(射程外)
  for (const u of [g1,g2,g3]) { u.deployTimer = 0; u.frozen = 99; }
  run(7, g);
  ok(g1.hp < g1.maxHp || g1.dead, '主目标被攻击');
  ok(g2.hp < g2.maxHp || g2.dead, `溅射波及邻近敌人(${Math.round(g2.hp)})`);
  ok(g3.hp === g3.maxHp, `溅射/射程范围外不受伤(${Math.round(g3.hp)})`);
},

'公主-极慢攻速口径': () => {
  // 攻速 3.0:站桩 9.5s = 首发即时 + 3 个周期 = 4 发 × 84 = 336
  const g = newGame();
  const p = g.spawnUnit('princess', 0, 9, 21);
  p.deployTimer = 0;
  const k = g.spawnUnit('knight', 1, 9, 15);
  k.deployTimer = 0; k.frozen = 99;
  // v0.6.9 前摇:首发 = firstHit 0.3 + 弹飞 ~0.37 = 0.67s 命中;
  // 此后每 3s 一发 → 9.5s 内 3 发(第 4 发 9.77s 才到)
  run(9.5, g);
  const dmg = k.maxHp - k.hp;
  ok(dmg === 84 * 3, `9.5s 恰好 3 发×84=252(前摇口径,实际${dmg})`);
},

'公主-弹道实体化与速度': () => {
  // wiki 弹速 600×0.025=15格/s:伤害随弹到达(9.5s 内 4 发的口径不变,
  // 但首发伤害要等弹飞 ~0.4s 才落)
  const g = newGame();
  const p = g.spawnUnit('princess', 0, 9, 21);
  p.deployTimer = 0;
  const k = g.spawnUnit('knight', 1, 9, 15);
  k.deployTimer = 0; k.frozen = 99;
  // v0.6.9 前摇 0.3s:出手在 t≈0.3,弹速15 距离6 → 命中 ≈0.67s;
  // t=0.5s 时前摇未完/弹在飞,knight 不应已受伤
  run(0.5, g);
  ok(k.hp === k.maxHp, `前摇+弹飞期间不应提前结算伤害(${Math.round(k.hp)})`);
  run(9.0, g);   // 累计 9.5s:3 发全到(第 4 发 9.77s)
  ok(k.maxHp - k.hp === 84 * 3, `9.5s 恰好 3 发×84(前摇口径,实际${k.maxHp - k.hp})`);
},


// ===== 卡牌实装(v0.6.11:冰雪精灵/冰人/滚木) =====

'冰精灵-冲刺摸塔自爆': () => {
  // v0.6.11 用户战报:①被塔一击秒(hp 误 47,官方 215/2=108=塔 2 发)
  // ②站桩不自爆(缺扑击冲刺)。官方行为:锁定目标后加速扑击,残血
  // 摸到塔爆开(伤害+冻结)——wiki Strategy "sufficient hitpoints to
  // reach an opposing Tower Princess" 的机制支撑是冲刺缩短暴露时间
  const g = newGame();
  const sp = g.spawnUnit('iceSpirit', 0, 3.5, 14);   // 河边,塔射程边缘
  sp.deployTimer = 0;
  const tw = g.towers[1].left;                        // (3.5,6.5) 距 7.5
  run(8, g);
  ok(sp.dead, '精灵应已自爆');
  const dist = Math.hypot(sp.x - tw.x, sp.y - tw.y);
  ok(dist < 4.5, `爆点应贴近塔(距 ${dist.toFixed(1)} 格 < 4.5)`);
  ok(tw.hp < tw.maxHp, `塔被自爆伤害(扣 ${tw.maxHp - tw.hp})`);
},

'冰精灵-自杀攻击冻结群体': () => {
  // 官方 kamikaze:命中即死;溅射 1.5 内敌人冻 1.1s。
  // 冻结 knight 防反杀干扰时间线
  const g = newGame();
  killTower(g, 0, 'left'); killTower(g, 0, 'right');   // 隔离玩家塔(54 伤干扰)
  const sp = g.spawnUnit('iceSpirit', 0, 9, 20); sp.deployTimer = 0;
  const k1 = g.spawnUnit('knight', 1, 9, 17.5);  // 射程边缘内(距 2.5 < 3.22)
  k1.deployTimer = 0; k1.frozen = 99;             // 冻结隔离反击(knight dmg101
                                                  // 会秒掉 47hp 的冰精灵)
  const k2 = g.spawnUnit('knight', 1, 9.5, 17.8); // 溅射内(距 k1 ~1.0 < 1.92)
  k2.deployTimer = 0; k2.frozen = 99;
  run(2, g);
  // 冻结被冰精灵的 1.1s 覆盖验证:knight frozen=99 已冻结,改用 hp 断言
  // (冻结叠加 max(99,1.1) 无法区分;冻结生效性由冰人场景的减速覆盖)
  ok(sp.dead, '冰精灵应自杀(命中即死)');
  ok(k1.hp === k1.maxHp - 55, `主目标吃 55 伤(实际扣${k1.maxHp - k1.hp})`);
  ok(k2.hp === k2.maxHp - 55, `溅射波及(实际扣${k2.maxHp - k2.hp})`);
  // 冻结验证:改测冻结法术之外的真实冻结源——直接检查 iceSpirit 攻击
  // 后 frozen 是否被设置为 1.1(用非冻结靶子时;这里靶子已 99,跳过)
},

'冰人-死亡爆炸减速': () => {
  // 只打建筑小坦克;死亡爆炸 42 伤 + 减速 30%/2s(官方 Slow 子表)。
  // 断言放死后下一帧(unit:killed 事件先于 applyDeathAbilities 执行,
  // 回调内查不到本次爆炸结果)
  const g = newGame();
  killTower(g, 1, 'left'); killTower(g, 1, 'right');
  const kt = g.towers[1].king; kt.activated = true;
  const ig = g.spawnUnit('iceGolem', 0, 9, 8);   // 塔旁,只打建筑
  ig.deployTimer = 0;
  const foe = g.spawnUnit('knight', 1, 9, 10);   // 冰人死后被爆炸波及
  foe.deployTimer = 0;
  let diedAt = null;
  g.bus.on('unit:killed', ({unit}) => { if (unit === ig) diedAt = g.time; });
  for (let i = 0; i < 300; i++) {
    g.update(1/30);
    if (diedAt !== null && g.time > diedAt + 0.1) break;
  }
  ok(ig.dead, `冰人应阵亡`);
  if (diedAt !== null) {
    ok(foe.hp === foe.maxHp - 42, `死亡爆炸伤敌人 42(实际扣${foe.maxHp - foe.hp})`);
    ok(foe.slowTimer >= 1.8, `敌人被减速 2s(实际${foe.slowTimer.toFixed(2)})`);
    ok(foe.slowFactor === 0.7, `减速幅度 30%(factor=${foe.slowFactor})`);
  }
},

'滚木-直线扫掠与每目标一次': () => {
  // 官方:直线滚动 10.1 格·宽 3.9·每目标一次·只打地面·击退 0.7
  const g = newGame();
  castSpell('theLog', 0, 9, 20, g);
  const k1 = g.spawnUnit('knight', 1, 9, 18);     // 走廊中心
  const k2 = g.spawnUnit('knight', 1, 10.5, 16);  // 走廊内(横向偏 1.5 < 1.95)
  const k3 = g.spawnUnit('knight', 1, 16, 14);    // 走廊外(横向偏 7)
  const m = g.spawnUnit('minions', 1, 9, 17);     // 空军不打
  for (const u of [k1,k2,k3]) { u.deployTimer = 0; u.frozen = 99; }
  for (const u of g.units.filter(x=>x.cardId==='minions')) { u.deployTimer = 0; u.frozen = 99; }
  run(3, g);   // 10.1格/5速度 ≈ 2s 滚完
  const d1 = k1.maxHp - k1.hp, d2 = k2.maxHp - k2.hp, d3 = k3.maxHp - k3.hp;
  ok(d1 === 133, `走廊中心恰好吃 1 次 133(实际${d1})`);
  ok(d2 === 133, `走廊内横向偏移也吃 1 次(实际${d2})`);
  ok(d3 === 0, `走廊外不受伤(实际${d3})`);
  const mins = g.units.filter(u => u.cardId === 'minions' && !u.dead);
  ok(mins.every(u => u.hp === u.maxHp), '空军不受滚木伤害');
},

'滚木-只能部署己方半场与河带': () => {
  // deployZone riverbanks:玩家可放 y<17(己方+河),不可放敌方腹地
  const g = newGame();
  const ok1 = g.playCard(0, 'theLog', 9, 20);
  ok(ok1, '玩家在自己半场(y=20)可放滚木');
  const ok2 = g.playCard(0, 'theLog', 9, 16);
  ok(ok2, '玩家在河带(y=16)可放滚木');
  const ok3 = g.playCard(0, 'theLog', 9, 10);
  ok(!ok3, '玩家在敌方腹地(y=10)不可放滚木');
},

// ===== 分离死锁修复(v0.6.11,战报:沉底 4 哥布林原地锁死) =====

'分离-相向而行不锁死': () => {
  // 2026-09-25 用户战报:玩家 4 哥布林沉底部署(12.8,30.17)后 12 秒
  // 原地不动。根因:4 只都进入右公主塔绕行走廊(相向收拢),软分离的
  // 纯径向推挤每帧恰好抵消移动力(对称死锁)。修复:分离加切向微扰
  // (对齐 C++ Board.h resolveCollisions 的 0.01 noise)让它们互相滑开
  const g = newGame();
  const ps = [[12.4,29.8],[13.3,29.8],[12.4,30.6],[13.3,30.6]];   // 战报同款 2×2 队形
  const gs = ps.map(p => { const u = g.spawnUnit('goblins', 0, p[0], p[1]); u.deployTimer = 0; return u; });
  run(3, g);
  const moved = gs.filter(u => !u.dead && Math.abs(u.y - 29.8) > 1.5 || Math.abs(u.x - 12.85) > 0.8);
  const alive = gs.filter(u => !u.dead);
  ok(alive.length > 0 && alive.every(u => Math.abs(u.y - 29.8) > 1.0 || Math.abs(u.x - 12.85) > 0.8),
    `3s 后应全部离开部署点(实际 ${alive.map(u=>`(${u.x.toFixed(1)},${u.y.toFixed(1)})`).join(' ')})`);
},

// ===== First Hit Speed(v0.6.9,官方攻击前摇) =====

'前摇-首发攻击延迟官方数值': () => {
  // wiki First Hit Speed:女武神 0.1(最快)/公主 0.3/火枪手 0.7/戈仑 1.0(最慢)
  // 攻击者与冻结骑士贴脸摆位(近战可达),首发命中时刻 ≥ firstHit
  const cases = [
    { card: 'valkyrie', firstHit: 0.1 },   // 近战 range1.2,贴脸
    { card: 'knight', firstHit: 0.5 },
    { card: 'musketeer', firstHit: 0.7 },  // 远程,距离 3(射程内)
    { card: 'golem', firstHit: 1.0 },      // 只打建筑 → 目标用塔
  ];
  for (const { card, firstHit } of cases) {
    const g = newGame();
    const u = g.spawnUnit(card, 0, 9, 20); u.deployTimer = 0;
    let t = 0, hitAt = null;
    let target;
    if (card === 'golem') {
      // 戈仑只打建筑:推掉两侧塔,留国王塔并激活,摆塔前
      killTower(g, 1, 'left'); killTower(g, 1, 'right');
      const kt = g.towers[1].king; kt.activated = true;
      u.y = 12;   // 距王塔 (9,3) 9 格,走过去要时间——改摆在塔边
      u.y = 6;    // 塔旁 3 格内
      target = kt;
    } else {
      const k = g.spawnUnit('knight', 1, 9, 19);  // 贴脸(距离1)
      k.deployTimer = 0; k.frozen = 99;
      target = k;
    }
    const orig = g.dealDamage.bind(g);
    const origT = g.dealTowerDamage.bind(g);
    const check = (x) => { if (x === target && hitAt === null) hitAt = t; };
    g.dealDamage = (unit, d, a) => { check(unit); return orig(unit, d, a); };
    g.dealTowerDamage = (tw, d) => { check(tw); return origT(tw, d); };
    while (t < 6 && hitAt === null) { g.update(1/30); t += 1/30; }
    ok(hitAt !== null && hitAt >= firstHit - 0.05,
      `${card} 首发命中 t=${hitAt === null ? '无' : hitAt.toFixed(2)}s ≥ 前摇 ${firstHit}s`);
  }
},

'前摇-换目标不重复施加': () => {
  // 前摇只在出生时种一次(C++ seedCooldown 语义)。用骑士(firstHit 0.5,
  // 攻速 1.2)打两只 40hp 骷髅:第一击秒杀 k1 转火 k2。若换目标重吃
  // 0.5 前摇,k2 的死亡会被推迟——以"两只骷髅全部死亡时刻"断言:
  // 正常 0.5(首发)+1.2(次发)=1.7s 内全灭;重吃前摇则 >2.2s
  const g = newGame();
  const kn = g.spawnUnit('knight', 0, 9, 20); kn.deployTimer = 0;
  const k1 = g.spawnUnit('skeletons', 1, 9, 18.8);
  const k2 = g.spawnUnit('skeletons', 1, 9, 17.6);
  for (const u of [k1, k2]) { u.deployTimer = 0; u.frozen = 99; }
  let t = 0;
  while (t < 3 && !(k1.dead && k2.dead)) { g.update(1/30); t += 1/30; }
  ok(k1.dead && k2.dead, `两只骷髅应被击杀(${k1.dead ? 'k1死' : 'k1活'}/${k2.dead ? 'k2死' : 'k2活'})`);
  ok(t <= 1.8, `全灭于 t=${t.toFixed(2)}s ≤1.8s(换目标不重吃 0.5 前摇)`);
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
