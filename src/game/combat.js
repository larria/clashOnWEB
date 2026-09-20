// ===============================================
// 战斗系统 - 寻路/索敌/攻击/伤害结算
// 纯游戏逻辑:不直接操作 DOM,日志/特效通过 game.bus 事件发出
// ===============================================
import { T, dist, dist2 } from '../core/constants.js';
import { afterAttack, applyDeathAbilities } from './abilities.js';

// 判断单位能否攻击某目标类型
// 建筑/塔是地面目标:可打地面(GROUND)或专打建筑(BUILDING)的单位都能攻击
export function canTarget(attacker, targetCard, targetIsFlying, targetIsBuilding) {
  const t = attacker.card.targets;
  if (targetIsBuilding) return (t & (T.BUILDING | T.GROUND)) !== 0;
  if (targetIsFlying) return (t & T.AIR) !== 0;
  return (t & T.GROUND) !== 0;
}

// 判断单位所在侧路:'left' | 'right' | 'mid'
function unitLane(unit) {
  if (unit.x < 8) return 'left';
  if (unit.x > 10) return 'right';
  return 'mid';
}

// 寻找最佳目标(最近的有效敌方单位/塔)
export function findTarget(unit, game) {
  const card = unit.card;
  const sightR = card.sightRange || 0;
  let best = null;
  let bestD = Infinity;

  // 只攻击建筑的单位(giant/hogRider/balloon/golem):只考虑建筑和塔
  const onlyBuilding = (card.targets === T.BUILDING);

  // 敌方单位(含建筑单位——攻城单位可被敌方建筑牵引)
  const enemies = game.units.filter(u => u.side !== unit.side && !u.dead);
  for (const e of enemies) {
    let valid = canTarget(unit, e.card, e.flying, e.isBuilding);
    if (!valid) continue;
    if (onlyBuilding && !e.isBuilding) continue;
    const d = dist(unit, e);
    if (d <= sightR && d < bestD) {
      bestD = d;
      best = { type: 'unit', ref: e, x: e.x, y: e.y, flying: e.flying, isBuilding: e.isBuilding };
    }
  }

  // 敌方塔
  const towers = game.getEnemyTowers(unit.side);
  // 攻城单位(只打建筑)的塔优先级:首选同侧公主塔,该塔被毁后才转国王塔/另一侧
  if (onlyBuilding) {
    const lane = unitLane(unit);
    const sidePrincess = towers.filter(t => !t.dead && t.type === 'princess');
    let preferred = null;
    if (lane === 'left' && !towers.find(t => t.lane === 'left').dead) preferred = towers.find(t => t.lane === 'left');
    else if (lane === 'right' && !towers.find(t => t.lane === 'right').dead) preferred = towers.find(t => t.lane === 'right');
    else if (lane === 'mid') {
      // 中路:选最近的存活公主塔;都毁则国王塔
      preferred = sidePrincess.length > 0 ? sidePrincess.reduce((a,b) => dist(unit,a) < dist(unit,b) ? a : b) : towers.find(t => t.type === 'king' && !t.dead);
    }
    // 同侧公主塔已被推:打国王塔(若活着),否则打另一侧
    if (!preferred) {
      const king = towers.find(t => t.type === 'king' && !t.dead);
      preferred = king || sidePrincess[0] || null;
    }
    if (preferred) {
      const d = dist(unit, preferred);
      if (d <= sightR) {
        best = { type: 'tower', ref: preferred, x: preferred.x, y: preferred.y, flying: false, isBuilding: true, lane: preferred.lane };
      }
    }
    return best; // 攻城单位不做通用塔比较,直接返回
  }

  // 普通单位:所有塔按最近优先
  for (const tw of towers) {
    if (tw.dead) continue;
    let valid = canTarget(unit, null, false, true);
    if (!valid) continue;
    const d = dist(unit, tw);
    if (d <= sightR && d < bestD) {
      bestD = d;
      best = { type: 'tower', ref: tw, x: tw.x, y: tw.y, flying: false, isBuilding: true, lane: tw.lane };
    }
  }

  return best;
}

// 视野内最近的敌方单位(不含塔) - 用于行军中转移目标
export function findNearestEnemyUnit(unit, game) {
  const card = unit.card;
  const sightR = card.sightRange || 0;
  let best = null, bestD = Infinity;
  const enemies = game.units.filter(u => u.side !== unit.side && !u.dead);
  // 只打建筑的单位(巨人/野猪/气球):只对敌方建筑感兴趣(被牵引)
  const onlyBuilding = (card.targets === T.BUILDING);
  for (const e of enemies) {
    if (onlyBuilding && !e.isBuilding) continue;
    if (!canTarget(unit, e.card, e.flying, e.isBuilding)) continue;
    const d = dist(unit, e);
    if (d <= sightR && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// 寻找行军目标(无目标时向敌方塔推进)
export function getMarchTarget(unit, game) {
  const allTowers = game.getEnemyTowers(unit.side);
  const towers = allTowers.filter(t => !t.dead);
  if (towers.length === 0) return null;

  // 攻城单位(只打建筑):首选同侧公主塔,该塔被毁后转国王塔
  if (unit.card.targets === T.BUILDING) {
    const lane = unitLane(unit);
    const left = allTowers.find(t => t.lane === 'left');
    const right = allTowers.find(t => t.lane === 'right');
    const king = allTowers.find(t => t.type === 'king');
    if (lane === 'left' && !left.dead) return left;
    if (lane === 'right' && !right.dead) return right;
    if (lane === 'mid') {
      // 中路:最近的存活公主塔
      const princess = towers.filter(t => t.type === 'princess');
      if (princess.length > 0) return princess.reduce((a,b) => dist(unit,a) < dist(unit,b) ? a : b);
    }
    // 同侧公主塔已毁(或无公主塔):国王塔优先
    if (king && !king.dead) return king;
    return towers[0];
  }

  // 普通单位:最近的存活塔
  let best = towers[0], bd = dist(unit, best);
  for (const t of towers) {
    const d = dist(unit, t);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// 计算路径下一个目标点(简化寻路:地面单位需走桥)
// RIVER_Y1=15, RIVER_Y2=17, 河道占 y=15,16;桥在 x=3.5 / x=14.5
export function nextWaypoint(unit, game, finalTarget) {
  // 飞行单位 或 可跳河单位(野猪骑士):直线朝目标,河道不构成障碍
  if (unit.flying || (unit.card.special && unit.card.special.canJumpRiver)) {
    return { x: finalTarget.x, y: finalTarget.y };
  }
  const ux = unit.x, uy = unit.y;
  const tx = finalTarget.x, ty = finalTarget.y;
  const RY1 = 15, RY2 = 17; // RIVER_Y1/Y2
  // 选择桥(桥心与公主塔 x 对齐:3.5 / 14.5)
  const bridges = [
    { x: 3.5, y: (RY1+RY2)/2 },
    { x: 14.5, y: (RY1+RY2)/2 },
  ];
  // 选离单位最近的桥
  let bridge = bridges[0], bd = Infinity;
  for (const b of bridges) {
    const d = dist2(ux, uy, b.x, b.y);
    if (d < bd) { bd = d; bridge = b; }
  }

  // 阶段判断
  // 上半场(uy <= RY1):AI 侧
  if (uy <= RY1) {
    // 目标也在上半场?直接走
    if (ty <= RY1) return { x: tx, y: ty };
    // 否则先对齐到桥的 x,再走向桥心(过河)
    if (Math.abs(ux - bridge.x) > 0.4) {
      // 先横向对齐到桥口(在己方岸边)
      return { x: bridge.x, y: Math.min(uy + 0.5, RY1 - 0.2) };
    }
    // 已对齐,走向桥心再过河
    return { x: bridge.x, y: RY2 + 0.5 };
  }
  // 下半场(uy >= RY2):玩家侧
  if (uy >= RY2) {
    if (ty >= RY2) return { x: tx, y: ty };
    if (Math.abs(ux - bridge.x) > 0.4) {
      return { x: bridge.x, y: Math.max(uy - 0.5, RY2 + 0.2) };
    }
    return { x: bridge.x, y: RY1 - 0.5 };
  }
  // 在河道里(RY1 < uy < RY2):必须沿桥走,先走到对岸
  if (ty > RY2) return { x: bridge.x, y: RY2 + 0.5 };
  return { x: bridge.x, y: RY1 - 0.5 };
}

// 移动单位
export function moveUnit(unit, game, dt) {
  if (unit.isBuilding || unit.speed === 0) return;
  // 确定移动目标
  let marchTarget = unit.target ? { x: unit.target.x, y: unit.target.y } : getMarchTarget(unit, game);
  if (!marchTarget) return;
  unit.lanePreference = marchTarget.lane;

  const wp = nextWaypoint(unit, game, marchTarget);
  const dx = wp.x - unit.x;
  const dy = wp.y - unit.y;
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d < 0.05) return;

  // 但如果已在攻击范围内,不移动(由攻击逻辑处理)
  // 移动
  const spd = unit.speed * dt;
  if (spd >= d) {
    unit.x = wp.x;
    unit.y = wp.y;
  } else {
    unit.x += (dx / d) * spd;
    unit.y += (dy / d) * spd;
  }

  // 充能判定(王子):持续向同一方向移动累计
  if (unit.card.special && unit.card.special.charge) {
    // 简化:持续向同一方向移动累计
    unit.chargeTimer += dt;
    if (unit.chargeTimer > 1.5 && !unit.charged) {
      unit.charged = true;
      game.bus.emit('unit:charge', { unit }); // 冲锋音效
    }
  }
  // 脚步声:大单位行进间按步频播放(速度越快步频越高)
  if (!unit._stepAcc) unit._stepAcc = 0;
  unit._stepAcc += dt;
  const stepInterval = 1.1 / Math.max(0.6, unit.speed); // 每步约 1.1 格
  if (unit._stepAcc >= stepInterval) {
    unit._stepAcc = 0;
    game.bus.emit('unit:step', { unit });
  }
}

// 单位攻击目标
export function attackTarget(attacker, target, game) {
  const card = attacker.card;
  let dmg = attacker.currentDmg;

  if (target.type === 'unit') {
    const e = target.ref;
    if (card.splash && card.splash > 0) {
      // 范围伤害
      applySplash(game, attacker, e.x, e.y, card.splash, dmg, card.targets);
    } else {
      game.dealDamage(e, dmg, attacker);
    }
  } else if (target.type === 'tower') {
    const tw = target.ref;
    if (card.splash && card.splash > 0) {
      applySplash(game, attacker, tw.x, tw.y, card.splash, dmg, card.targets);
    } else {
      game.dealTowerDamage(tw, dmg);
    }
  }

  // 攻击后能力(地狱塔递增等)
  afterAttack(attacker);

  // 远程攻击有投射物(简化:直接命中,加动画)
  attacker.atkAnim = 0.3;
}

// 范围伤害(单位与敌方塔)
export function applySplash(game, attacker, cx, cy, radius, dmg, targetsMask) {
  // 伤害范围内敌方单位
  const enemies = game.units.filter(u => u.side !== attacker.side && !u.dead);
  for (const e of enemies) {
    let valid;
    if (e.isBuilding) valid = (targetsMask & (T.BUILDING | T.GROUND)) !== 0;
    else if (e.flying) valid = (targetsMask & T.AIR) !== 0;
    else valid = (targetsMask & T.GROUND) !== 0;
    if (!valid) continue;
    const d = dist2(cx, cy, e.x, e.y);
    if (d <= (radius + e.radius) * (radius + e.radius)) {
      game.dealDamage(e, dmg, attacker);
    }
  }
  // 范围内塔
  {
    const towers = game.getEnemyTowers(attacker.side);
    for (const tw of towers) {
      if (tw.dead) continue;
      const d = dist2(cx, cy, tw.x, tw.y);
      if (d <= (radius + tw.radius) * (radius + tw.radius)) {
        game.dealTowerDamage(tw, dmg);
      }
    }
  }
}
