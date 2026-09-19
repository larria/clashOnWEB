// ===============================================
// 战斗系统 - 寻路/索敌/攻击/伤害结算
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const T = CR.T;

  // 判断单位能否攻击某目标类型
  // 建筑/塔是地面目标:可打地面(GROUND)或专打建筑(BUILDING)的单位都能攻击
  function canTarget(attacker, targetCard, targetIsFlying, targetIsBuilding) {
    const t = attacker.card.targets;
    if (targetIsBuilding) return (t & (T.BUILDING | T.GROUND)) !== 0;
    if (targetIsFlying) return (t & T.AIR) !== 0;
    return (t & T.GROUND) !== 0;
  }

  // 寻找最佳目标(最近的有效敌方单位/塔)
  function findTarget(unit, game) {
    const card = unit.card;
    const sightR = card.sightRange || 0;
    let best = null;
    let bestD = Infinity;

    // 优先级:对于只攻击建筑的单位(giant/hogRider/balloon/golem),只考虑建筑和塔
    const onlyBuilding = (card.targets === T.BUILDING);

    // 敌方单位
    const enemies = game.units.filter(u => u.side !== unit.side && !u.dead);
    for (const e of enemies) {
      // 地狱塔/X连弩/迫击炮特殊:可打塔
      let valid = canTarget(unit, e.card, e.flying, e.isBuilding);
      if (!valid) continue;
      // 只打建筑的单位不打普通部队(除非对方也是建筑)
      if (onlyBuilding && !e.isBuilding) continue;
      const d = CR.dist(unit, e);
      if (d <= sightR && d < bestD) {
        bestD = d;
        best = { type: 'unit', ref: e, x: e.x, y: e.y, flying: e.flying, isBuilding: e.isBuilding };
      }
    }

    // 敌方塔
    const towers = game.getEnemyTowers(unit.side);
    for (const tw of towers) {
      if (tw.dead) continue;
      let valid = canTarget(unit, null, false, true);
      if (!valid) continue;
      // 普通部队只有在公主塔被摧毁后才能直接攻击国王塔?简化:国王塔始终可被攻击,但优先打公主塔
      const d = CR.dist(unit, tw);
      if (d <= sightR && d < bestD) {
        bestD = d;
        best = { type: 'tower', ref: tw, x: tw.x, y: tw.y, flying: false, isBuilding: true, lane: tw.lane };
      }
    }

    return best;
  }

  // 视野内最近的敌方单位(不含塔) - 用于行军中转移目标
  function findNearestEnemyUnit(unit, game) {
    const card = unit.card;
    const sightR = card.sightRange || 0;
    // 只打建筑的单位(巨人/野猪/气球)无视部队
    if (card.targets === T.BUILDING) return null;
    let best = null, bestD = Infinity;
    const enemies = game.units.filter(u => u.side !== unit.side && !u.dead);
    for (const e of enemies) {
      if (!canTarget(unit, e.card, e.flying, e.isBuilding)) continue;
      const d = CR.dist(unit, e);
      if (d <= sightR && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // 寻找行军目标(无敌人时向最近的敌方塔推进)
  // 公主塔被推掉后,该路单位自然会选到更近的国王塔
  function getMarchTarget(unit, game) {
    const towers = game.getEnemyTowers(unit.side).filter(t => !t.dead);
    if (towers.length === 0) return null;
    // 选最近的存活塔(公主塔/国王塔统一比较)
    let best = towers[0], bd = CR.dist(unit, best);
    for (const t of towers) {
      const d = CR.dist(unit, t);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // 计算路径下一个目标点(简化寻路:地面单位需走桥)
  // RIVER_Y1=15, RIVER_Y2=17, 河道占 y=15,16;桥在 x=3 和 x=14
  function nextWaypoint(unit, game, finalTarget) {
    if (unit.flying) {
      return { x: finalTarget.x, y: finalTarget.y };
    }
    const ux = unit.x, uy = unit.y;
    const tx = finalTarget.x, ty = finalTarget.y;
    const RY1 = CR.RIVER_Y1, RY2 = CR.RIVER_Y2;
    // 选择桥(按目标 x 选最近的同侧桥)
    const bridges = [
      { x: 3, y: (RY1+RY2)/2 },
      { x: 14, y: (RY1+RY2)/2 },
    ];
    // 选离单位最近的桥
    let bridge = bridges[0], bd = Infinity;
    for (const b of bridges) {
      const d = CR.dist2(ux, uy, b.x, b.y);
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
  function moveUnit(unit, game, dt) {
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

    // 充能判定(王子):直行一段距离后触发
    if (unit.card.special && unit.card.special.charge) {
      // 简化:持续向同一方向移动累计
      unit.chargeTimer += dt;
      if (unit.chargeTimer > 1.5 && !unit.charged) {
        unit.charged = true;
      }
    }
  }

  // 单位攻击目标
  function attackTarget(attacker, target, game) {
    const card = attacker.card;
    let dmg = attacker.currentDmg;

    if (target.type === 'unit') {
      const e = target.ref;
      if (card.splash && card.splash > 0) {
        // 范围伤害
        applySplash(game, attacker, e.x, e.y, card.splash, dmg, card.targets);
      } else {
        dealDamage(e, dmg, game, attacker);
      }
    } else if (target.type === 'tower') {
      const tw = target.ref;
      if (card.splash && card.splash > 0) {
        applySplash(game, attacker, tw.x, tw.y, card.splash, dmg, card.targets, tw);
      } else {
        dealTowerDamage(tw, dmg, game);
      }
    }

    // 地狱塔:持续命中递增伤害
    if (card.special && card.special.rampDamage) {
      attacker.rampTimer += card.hitSpeed;
      if (attacker.rampTimer >= card.special.rampDamage.rampTime) {
        attacker.rampMult = card.special.rampDamage.maxMult;
      } else {
        attacker.rampMult = 1 + (card.special.rampDamage.maxMult - 1) * (attacker.rampTimer / card.special.rampDamage.rampTime);
      }
    }

    // 远程攻击有投射物(简化:直接命中,加动画)
    attacker.atkAnim = 0.3;
  }

  // 范围伤害
  function applySplash(game, attacker, cx, cy, radius, dmg, targetsMask, ignoreTower) {
    // 伤害范围内敌方单位
    const enemies = game.units.filter(u => u.side !== attacker.side && !u.dead);
    for (const e of enemies) {
      let valid;
      if (e.isBuilding) valid = (targetsMask & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (targetsMask & T.AIR) !== 0;
      else valid = (targetsMask & T.GROUND) !== 0;
      if (!valid) continue;
      const d = CR.dist2(cx, cy, e.x, e.y);
      if (d <= (radius + e.radius) * (radius + e.radius)) {
        dealDamage(e, dmg, game, attacker);
      }
    }
    // 范围内塔
    if (!ignoreTower || true) {
      const towers = game.getEnemyTowers(attacker.side);
      for (const tw of towers) {
        if (tw.dead) continue;
        const d = CR.dist2(cx, cy, tw.x, tw.y);
        if (d <= (radius + tw.radius) * (radius + tw.radius)) {
          dealTowerDamage(tw, dmg, game);
        }
      }
    }
  }

  function dealDamage(unit, dmg, game, attacker) {
    if (unit.dead) return;
    unit.hp -= dmg;
    if (unit.hp <= 0) {
      unit.hp = 0;
      unit.dead = true;
      // 高价值单位(成本>=5)被击杀时记录日志,避免低费杂兵刷屏
      if (CR.log && unit.card.cost >= 5) {
        const victimSide = unit.side === 0 ? '你的' : 'AI的';
        const killerName = attacker ? (attacker.card ? attacker.card.name : (attacker.isTower ? '塔' : '未知')) : '未知';
        const killerSide = attacker ? (attacker.side === 0 ? '你的' : 'AI的') : '';
        CR.log(`${victimSide}${unit.card.name} 被 ${killerSide}${killerName} 击杀`, 'kill');
      }
      onUnitDeath(unit, game);
    }
  }

  function dealTowerDamage(tower, dmg, game) {
    if (tower.dead) return;
    tower.hp -= dmg;
    if (tower.hp <= 0) {
      tower.hp = 0;
      tower.dead = true;
      onTowerDeath(tower, game);
    }
  }

  // 单位死亡处理:死亡伤害/召唤
  function onUnitDeath(unit, game) {
    const sp = unit.card.special;
    if (!sp) return;
    // 死亡伤害(气球/骷髅巨人/戈仑石人/小戈仑)
    if (sp.deathDamage) {
      applyDeathDamage(game, unit, sp.deathDamage);
    }
    // 死亡召唤(戈仑石人->小戈仑)
    if (sp.summonOnDeath) {
      const child = CR.CARDS[sp.summonOnDeath.card];
      for (let i = 0; i < (sp.summonOnDeath.count || 1); i++) {
        const u = new CR.Unit(sp.summonOnDeath.card, unit.side,
          unit.x + (i - sp.summonOnDeath.count/2) * 0.6, unit.y);
        u.deployTimer = 0.3;
        game.addUnit(u);
      }
    }
  }

  function applyDeathDamage(game, unit, dd) {
    const cx = unit.x, cy = unit.y;
    const r = dd.splash, dmg = dd.dmg;
    // 敌方单位(死亡伤害对双方都生效?皇室战争中死亡伤害对所有人有效)
    for (const e of game.units) {
      if (e.dead || e === unit) continue;
      let valid;
      if (e.isBuilding) valid = (dd.targets & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (dd.targets & T.AIR) !== 0;
      else valid = (dd.targets & T.GROUND) !== 0;
      if (!valid) continue;
      const d = CR.dist2(cx, cy, e.x, e.y);
      if (d <= (r + e.radius) * (r + e.radius)) {
        e.hp -= dmg;
        if (e.hp <= 0 && !e.dead) { e.hp = 0; e.dead = true; onUnitDeath(e, game); }
      }
    }
    // 塔(只伤害敌方塔)
    const towers = game.getEnemyTowers(unit.side);
    for (const tw of towers) {
      if (tw.dead) continue;
      const d = CR.dist2(cx, cy, tw.x, tw.y);
      if (d <= (r + tw.radius) * (r + tw.radius)) {
        dealTowerDamage(tw, dmg, game);
      }
    }
  }

  function onTowerDeath(tower, game) {
    // 公主塔被摧毁,激活同侧国王塔(简化:国王塔始终激活,这里仅记录)
    game.onTowerDestroyed(tower);
  }

  CR.canTarget = canTarget;
  CR.findNearestEnemyUnit = findNearestEnemyUnit;
  CR.findTarget = findTarget;
  CR.getMarchTarget = getMarchTarget;
  CR.nextWaypoint = nextWaypoint;
  CR.moveUnit = moveUnit;
  CR.attackTarget = attackTarget;
  CR.applySplash = applySplash;
  CR.dealDamage = dealDamage;
  CR.dealTowerDamage = dealTowerDamage;
  CR.onUnitDeath = onUnitDeath;
})(window.CR);
