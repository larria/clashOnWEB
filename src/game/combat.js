// ===============================================
// 战斗系统 - 寻路/索敌/攻击/伤害结算
// 纯游戏逻辑:不直接操作 DOM,日志/特效通过 game.bus 事件发出
// ===============================================
import { T, RIVER_Y1, RIVER_Y2, dist, dist2, isBridge } from '../core/constants.js';
import { afterAttack } from './abilities.js';

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
  const sp = card.special || {};
  const sightR = card.sightRange || 0;
  let best = null;
  let bestD = Infinity;

  // 只攻击建筑的单位(giant/hogRider/balloon/golem):只考虑建筑和塔
  const onlyBuilding = (card.targets === T.BUILDING);
  // X连弩/迫击炮类(targetsTower):只索敌方塔,不打部队
  const towerOnly = !!sp.targetsTower;
  // 迫击炮类(blindSpot):近身盲区,过近的目标打不着
  const blindSpot = sp.blindSpot || 0;

  // 敌方单位(含建筑单位——攻城单位可被敌方建筑牵引)
  if (!towerOnly) {
    const enemies = game.units.filter(u => u.side !== unit.side && !u.dead);
    for (const e of enemies) {
      let valid = canTarget(unit, e.card, e.flying, e.isBuilding);
      if (!valid) continue;
      if (onlyBuilding && !e.isBuilding) continue;
      const d = dist(unit, e);
      if (blindSpot > 0 && d < blindSpot) continue;   // 近身盲区
      // 索敌半径含目标 hitbox(与攻击判定 d<=range+radius 同口径):
      // 官方射程即"中心到目标边缘"——wiki 记载加农炮/特斯拉的
      // "range bug"修复(显示 5.5 实际不变)即此口径。若索敌不含
      // hitbox,目标恰好停在 range < d <= range+radius 区间时
      // (如塔下拉扯野蛮人)永远不会被还手
      if (d <= unit.radius + sightR + e.radius && d < bestD) {
        bestD = d;
        best = { type: 'unit', ref: e, x: e.x, y: e.y, flying: e.flying, isBuilding: e.isBuilding };
      }
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
      // 含塔 hitbox(同攻击口径)。与已找到的敌方建筑单位比距离:
      // 只在塔更近时才改打塔——否则塔一进视野就会无条件覆盖已锁定的
      // 特斯拉/加农炮等牵引建筑(表现为"被建筑拉了一段又转头去打塔")
      if (d <= unit.radius + sightR + preferred.radius && d < bestD) {
        best = { type: 'tower', ref: preferred, x: preferred.x, y: preferred.y, flying: false, isBuilding: true, lane: preferred.lane };
      }
    }
    return best; // 攻城单位不做通用塔比较,直接返回
  }

  // 普通单位:所有塔按最近优先(targetsTower 单位同样走此分支,
  // 且不与敌方单位比较——bestD 仅在塔之间竞争)
  for (const tw of towers) {
    if (tw.dead) continue;
    let valid = canTarget(unit, null, false, true);
    if (!valid) continue;
    const d = dist(unit, tw);
    if (blindSpot > 0 && d < blindSpot) continue;     // 近身盲区(塔同样适用)
    if (d <= unit.radius + sightR + tw.radius && d < bestD) {       // 含塔 hitbox(同攻击口径)
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
    if (d <= unit.radius + sightR + e.radius && d < bestD) { bestD = d; best = e; }  // 含 hitbox(同攻击口径)
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

// 塔避让:直线路径穿过存活塔的碰撞盒时,走"塔侧走廊"——
// 先横移到塔侧面 x,再沿该 x 纵向通过塔的 y 区间(之后自然汇回路线)。
// (单位常部署在公主塔正后方,不避让会顶在塔后反复挤压/穿模)
// 绕行状态记在 unit._dodge 上(绕哪座塔/哪一侧/是否已过塔心),
// 越过塔 y 区间后清除——防止"绕完又被重新捕获"死循环
//
// 沉底中心放置的官方路线(用户对齐原版确认):
//   1) 沿国王塔底部横走到国王塔底部边缘(king.x±pad)
//   2) 斜向公主塔内侧的底部角(由公主塔内侧走廊承接)
//   3) 沿公主塔内侧(tw.x±pad,朝中线一侧)纵向前进
//   4) 走过公主塔后向桥口汇合(桥对齐逻辑接管)
// 即:己方国王塔走廊=塔侧边缘;己方公主塔绕"内侧"(朝中线)。
function dodgeTower(unit, game, fromX, fromY, toX, toY) {
  for (const side of [0, 1]) {
    const ts = game.towers[side];
    for (const k of ['left', 'right', 'king']) {
      const tw = ts[k];
      if (tw.dead) continue;
      const pad = tw.radius + unit.radius + 0.15;
      // 目标就在这座塔上(攻它)不绕
      if (Math.hypot(toX - tw.x, toY - tw.y) < pad) continue;
      const isOwnKing = (tw.side === unit.side && tw.type === 'king');
      const isOwnPrincess = (tw.side === unit.side && tw.type === 'princess');
      // 续行中的走廊:已越过塔 y 区间则清除,否则继续沿走廊走
      if (unit._dodge && unit._dodge.tw === tw) {
        const s = unit._dodge.side;
        const lx = tw.x + s * pad;
        if (Math.abs(fromY - tw.y) > pad + 0.3) {
          unit._dodge = null;   // 已通过,汇回正常路线
        } else {
          // 未到走廊 x:先横移(保持 y);到位后沿走廊纵向通过塔区
          if (Math.abs(fromX - lx) > 0.2) {
            return { x: lx, y: fromY };
          }
          const dirY = toY >= tw.y ? 1 : -1;
          return { x: lx, y: tw.y + dirY * (pad + 0.5) };
        }
      }
      // 单位到目标线段与塔圆的最近距离
      const abx = toX - fromX, aby = toY - fromY;
      const len2 = abx*abx + aby*aby;
      if (len2 < 0.001) continue;
      let t = ((tw.x - fromX)*abx + (tw.y - fromY)*aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = fromX + abx*t, py = fromY + aby*t;
      if (Math.hypot(px - tw.x, py - tw.y) < pad) {
        // 会撞塔:进走廊模式
        // 侧选择:
        //   己方国王塔:朝行进侧(离目标桥近的一侧=塔边缘出口)
        //   其余塔(含己方公主塔):取单位当前所在的一侧——天然区分
        //     角落沉底(左下来在塔外侧→沿外侧走,过塔奔同侧桥)
        //     与中心沉底(来路在两塔之间→沿内侧走,官方路线)
        let s;
        if (isOwnKing) s = (toX < tw.x) ? -1 : 1;
        else s = fromX <= tw.x ? -1 : 1;
        unit._dodge = { tw, side: s };
        const lx = tw.x + s * pad;
        // 先横移到走廊 x(保持当前 y),到达后再纵走——一步到位的
        // 斜线本身会穿过塔圆,拆两段才能保证全程在塔外
        if (Math.abs(fromX - lx) > 0.2) {
          return { x: lx, y: fromY };
        }
        return { x: lx, y: tw.y };
      }
    }
  }
  return null;
}

// 计算路径下一个目标点(简化寻路:地面单位需走桥)
// RIVER_Y1=15, RIVER_Y2=17, 河道占 y=15,16;桥在 x=3.5 / x=14.5
export function nextWaypoint(unit, game, finalTarget) {
  let canJump = !!(unit.card.special && unit.card.special.canJumpRiver);
  // 飞行单位:直线朝目标,河道不构成障碍
  if (unit.flying) {
    return { x: finalTarget.x, y: finalTarget.y };
  }
  // 可跳河单位(野猪骑士):不是无条件跳——贴近桥时仍走桥过河
  // (原版行为:离桥横向太近会寻找桥直接跑过去,远了才直线跳河;
  //  "pig push"技巧即利用桥最外沿格跳河绕开建筑拉扯)
  // 王子/黑王子:跳河是行走状态的能力,冲锋中遇河必须中断冲锋走桥
  // (原版:冲锋状态不允许跳河;走桥过程中冲锋距离照常累计,过桥后重新起冲)
  if (canJump && unit.card.special.charge && unit.charged) {
    canJump = false;
  }
  if (canJump) {
    const bridges = [
      { x: 3.5, y: (RIVER_Y1 + RIVER_Y2) / 2 },
      { x: 14.5, y: (RIVER_Y1 + RIVER_Y2) / 2 },
    ];
    // 目标与自己在河两侧(需要过河)时,若横向贴近任一桥 → 走桥
    const needCross =
      (unit.y < RIVER_Y1 && finalTarget.y >= RIVER_Y1) ||
      (unit.y >= RIVER_Y2 && finalTarget.y < RIVER_Y2);
    if (needCross) {
      const nearBridgeX = bridges.some(b => Math.abs(unit.x - b.x) < 1.0);
      if (nearBridgeX) canJump = false;   // 按普通地面单位走桥
    }
    if (canJump) {
      // 跳河≠穿塔:直线仍需避让存活塔(沉底放塔后的跳河单位会直线
      // 穿过国王塔——先走塔侧走廊,出走廊后继续直线跳河)
      const d = dodgeTower(unit, game, unit.x, unit.y, finalTarget.x, finalTarget.y);
      if (d) return d;
      return { x: finalTarget.x, y: finalTarget.y };
    }
  }
  const ux = unit.x, uy = unit.y;
  const tx = finalTarget.x, ty = finalTarget.y;
  // 选择桥(桥心与公主塔 x 对齐:3.5 / 14.5)
  const bridges = [
    { x: 3.5, y: (RIVER_Y1+RIVER_Y2)/2 },
    { x: 14.5, y: (RIVER_Y1+RIVER_Y2)/2 },
  ];
  // 选离单位最近的桥
  let bridge = bridges[0], bd = Infinity;
  for (const b of bridges) {
    const d = dist2(ux, uy, b.x, b.y);
    if (d < bd) { bd = d; bridge = b; }
  }



  // 阶段判断
  // 上半场(uy <= RIVER_Y1):AI 侧
  if (uy <= RIVER_Y1) {
    // 目标也在上半场?直接走(先检查塔避让)
    if (ty <= RIVER_Y1) {
      const d = dodgeTower(unit, game, ux, uy, tx, ty);
      if (d) return d;
      return { x: tx, y: ty };
    }
    // 否则先对齐到桥的 x,再走向桥心(过河)
    if (Math.abs(ux - bridge.x) > 0.4) {
      const wy = Math.min(uy + 0.5, RIVER_Y1 - 0.2);
      // 避让探测用"当前位置→桥心"整段路径(短步探测看不到远处的塔)
      const d = dodgeTower(unit, game, ux, uy, bridge.x, (RIVER_Y1+RIVER_Y2)/2);
      if (d) return d;
      // 先横向对齐到桥口(在己方岸边)
      return { x: bridge.x, y: wy };
    }
    // 已对齐,走向桥心再过河(直线可能穿塔,先避让)
    {
      const d = dodgeTower(unit, game, ux, uy, bridge.x, (RIVER_Y1+RIVER_Y2)/2);
      if (d) return d;
    }
    return { x: bridge.x, y: RIVER_Y2 + 0.5 };
  }
  // 下半场(uy >= RIVER_Y2):玩家侧
  if (uy >= RIVER_Y2) {
    if (ty >= RIVER_Y2) {
      const d = dodgeTower(unit, game, ux, uy, tx, ty);
      if (d) return d;
      return { x: tx, y: ty };
    }
    if (Math.abs(ux - bridge.x) > 0.4) {
      const wy = Math.max(uy - 0.5, RIVER_Y2 + 0.2);
      // 避让探测用"当前位置→桥心"整段路径
      const d = dodgeTower(unit, game, ux, uy, bridge.x, (RIVER_Y1+RIVER_Y2)/2);
      if (d) return d;
      return { x: bridge.x, y: wy };
    }
    // 已对齐,走向桥口(直线可能穿塔——塔就在桥的正后方)
    {
      const d = dodgeTower(unit, game, ux, uy, bridge.x, RIVER_Y1 - 0.5);
      if (d) return d;
    }
    return { x: bridge.x, y: RIVER_Y1 - 0.5 };
  }
  // 在河道里(RIVER_Y1 < uy < RIVER_Y2):必须沿桥走,先走到对岸
  if (ty > RIVER_Y2) return { x: bridge.x, y: RIVER_Y2 + 0.5 };
  return { x: bridge.x, y: RIVER_Y1 - 0.5 };
}

// 移动单位
export function moveUnit(unit, game, dt) {
  if (unit.isBuilding || unit.speed === 0) return;
  // 确定移动目标:锁定的目标取其实时位置(快照坐标只作索敌时初值,
  // 不随目标移动更新——用它当移动终点会让追兵朝旧位置跑,表现为
  // "追错方向一段再回头"。塔是静态的,行为不变)
  let marchTarget;
  if (unit.target) {
    marchTarget = { x: unit.target.ref.x, y: unit.target.ref.y };
    marchTarget.lane = unit.target.lane;
  } else {
    marchTarget = getMarchTarget(unit, game);
  }
  if (!marchTarget) return;
  unit.lanePreference = marchTarget.lane;

  const wp = nextWaypoint(unit, game, marchTarget);
  const dx = wp.x - unit.x;
  const dy = wp.y - unit.y;
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d < 0.05) return;

  // 但如果已在攻击范围内,不移动(由攻击逻辑处理)
  // 移动
  const wasInRiver = unit.y > RIVER_Y1 && unit.y < RIVER_Y2 && !unit.flying;
  const spd = unit.speed * dt;
  if (spd >= d) {
    unit.x = wp.x;
    unit.y = wp.y;
  } else {
    unit.x += (dx / d) * spd;
    unit.y += (dy / d) * spd;
  }
  // 跳河单位(野猪骑士)入河瞬间:起跳特效 + 跳跃动画计时。
  // 桥面不算河(isBridge)——走桥过河不触发跳跃动画
  const nowInRiver = unit.y > RIVER_Y1 && unit.y < RIVER_Y2 && !isBridge(unit.x, unit.y);
  if (nowInRiver && !wasInRiver && unit.card.special && unit.card.special.canJumpRiver) {
    unit.jumpTimer = 0.55;               // 跳跃动画时长(渲染抛物线用)
    unit.jumpFrom = { x: unit.x, y: unit.y };
    game.addEffect({ type: 'jumpDust', x: unit.x, y: unit.y, side: unit.side, life: 0.4, maxLife: 0.4 });
    game.bus.emit('unit:jump', { unit }); // 跳河音效
  }
  if (unit.jumpTimer > 0) {
    unit.jumpTimer -= dt;
    // 落地(出河):落点尘土 + 水花(按是否仍在河面)
    if (unit.jumpTimer <= 0) {
      const riverLanding = unit.y > RIVER_Y1 && unit.y < RIVER_Y2;
      game.addEffect({ type: 'jumpLand', x: unit.x, y: unit.y, river: riverLanding, life: 0.45, maxLife: 0.45 });
    }
  }

  // 充能判定(王子):按累计移动距离充能(wiki:走 2 格后开始冲锋)。
  // 距离制而非时间制——攻击/眩晕/击退后从零重新走,原版行为
  if (unit.card.special && unit.card.special.charge) {
    const moved = Math.min(spd, d);   // 本帧实际位移
    unit.chargeTimer += moved;
    if (unit.chargeTimer >= unit.card.special.charge.distance && !unit.charged) {
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
  // 递增伤害(地狱塔)换目标重置:原版机制——烧新目标从 1 倍重新升
  if (attacker._lastRampTarget && attacker._lastRampTarget !== target.ref) {
    attacker.rampTimer = 0;
    attacker.rampMult = 1;
  }
  attacker._lastRampTarget = target.ref;
  let dmg = attacker.currentDmg;

  // 目标位置(特效用)
  const tx = target.ref.x;
  const ty = target.ref.y;

  if (target.type === 'unit') {
    const e = target.ref;
    if (card.splash && card.splash > 0) {
      // 范围伤害
      applySplash(game, attacker, e.x, e.y, card.splash, dmg, card.targets);
    } else {
      game.dealDamage(e, dmg, attacker);
    }
    // 攻击减速(冰法师):命中附带范围减速(溅射范围内敌人一起减速)
    const aslow = card.special && card.special.attackSlow;
    if (aslow) {
      game.applySlowAt(e.x, e.y, card.splash || 0.5, attacker.side, aslow.duration, aslow.factor);
    }
  } else if (target.type === 'tower') {
    const tw = target.ref;
    if (card.splash && card.splash > 0) {
      applySplash(game, attacker, tw.x, tw.y, card.splash, dmg, card.targets);
    } else {
      game.dealTowerDamage(tw, dmg);
    }
    // 塔同样被减速(攻速降低;塔攻击间隔由 tower.update 驱动)
    const aslowT = card.special && card.special.attackSlow;
    if (aslowT && !tw.dead) {
      if (tw.slowTimer == null) { tw.slowTimer = 0; tw.slowFactor = 1; }
      if (tw.slowTimer < aslowT.duration) { tw.slowTimer = aslowT.duration; tw.slowFactor = aslowT.factor; }
    }
  }

  // 攻击后能力(地狱塔递增等)
  afterAttack(attacker);

  // 攻击特效:按攻击类型分近战斩击/远程弹道(渲染层按 card.color 着色)
  const isRanged = card.range >= 3.5;
  game.addEffect({
    type: isRanged ? 'shotTrail' : 'meleeSlash',
    cardId: attacker.cardId, side: attacker.side,
    x: attacker.x, y: attacker.y, tx, ty,
    splash: (card.splash || 0) > 0,
    life: isRanged ? 0.22 : 0.28, maxLife: isRanged ? 0.22 : 0.28,
  });
  // 冲锋命中(王子):重击白闪+放射冲击线(双倍伤害的分量感)
  if (attacker.charged) {
    game.addEffect({ type: 'chargeHit', x: tx, y: ty, life: 0.4, maxLife: 0.4 });
    // 冲锋溅射(黑王子):命中瞬间 360° 环形伤害,围一圈的小兵全吃
    // 冲锋伤害(官方:冲锋命中"hits all enemies in a 360º area")
    const ch = card.special && card.special.charge;
    if (ch && ch.splash) {
      applySplash(game, attacker, attacker.x, attacker.y, ch.splash, dmg, card.targets);
    }
  }

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
