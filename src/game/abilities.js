// ===============================================
// 能力系统 - 卡牌特殊效果的唯一解释器
//
// 卡牌数据中的 special 键在这里注册执行逻辑:
//   canJumpRiver    跳河(野猪骑士)              —— combat 移动时查询
//   charge          冲锋(王子)                    —— combat 移动/攻击时查询
//   rampDamage      递增伤害(地狱之塔)            —— combat 攻击后调用
//   summon          周期召唤(女巫)                —— game 每帧调用
//   spawn           产兵建筑(小屋/墓碑)           —— game 每帧调用
//   produceElixir   产圣水(圣水收集器)            —— game 每帧调用
//   deathDamage     死亡伤害(气球/骷髅巨人/戈仑)  —— onUnitDeath 调用
//   summonOnDeath   死亡分裂(戈仑→小戈仑)         —— onUnitDeath 调用
//   deathSummon     死亡召唤(墓碑/野蛮人小屋)     —— onUnitDeath 调用
//   heavy           击退免疫(由 HEAVY_UNITS 判定) —— spells 击退时查询
//   mirror          镜像复制                       —— spells 施放时处理
//   hits            多段命中(万箭)                —— spells 伤害时查询
//   stun/freeze     眩晕/冰冻                      —— spells 效果
//   buff            增益己方(狂暴)                —— spells 效果
//   chain           连锁(雷电)                    —— spells 效果
//
// 新卡牌若效果已有键:填参数即可。
// 全新机制:在此注册 + 在对应系统(combat/game/spells)留一个挂钩点调用。
// ===============================================

// 重型单位(不受法术击退):巨人/戈仑/皮卡/骷髅巨人/野蛮人小屋等大块头
// 新卡是重型 → 往这里加 cardId
const HEAVY_UNITS = new Set(['giant', 'golem', 'golemite', 'pekka', 'giantSkeleton', 'barbarianHut']);

export function isHeavy(unit) {
  return HEAVY_UNITS.has(unit.cardId) || !!(unit.card.special && unit.card.special.heavy);
}

// 每帧周期效果(spawn/summon/produceElixir):由 game.updateUnits 调用
// 返回 true 表示本帧产出了东西(供未来动画/音效订阅)
export function tickPeriodic(unit, game, dt) {
  const sp = unit.card.special;
  if (!sp) return false;
  let produced = false;

  if (sp.spawn) {
    // 首波较快(firstDelay),之后按 interval 循环
    unit.specialTimer += dt;
    const first = sp.spawn.firstDelay != null ? sp.spawn.firstDelay : sp.spawn.interval;
    const due = unit.spawnedOnce ? sp.spawn.interval : first;
    if (unit.specialTimer >= due) {
      unit.specialTimer = 0;
      unit.spawnedOnce = true;
      for (let i = 0; i < sp.spawn.count; i++) {
        game.spawnUnit(sp.spawn.card, unit.side, unit.x, unit.y + (unit.side === 0 ? -0.8 : 0.8));
      }
      game.bus.emit('unit:spawned', { spawner: unit, card: sp.spawn.card }); // 产兵音效
      produced = true;
    }
  }
  if (sp.produceElixir) {
    unit.specialTimer += dt;
    if (unit.specialTimer >= sp.produceElixir.interval) {
      unit.specialTimer = 0;
      game.addElixir(unit.side, sp.produceElixir.amount);
      produced = true;
    }
  }
  if (sp.summon && unit.deployTimer <= 0) { // 女巫召唤骷髅
    unit.specialTimer += dt;
    if (unit.specialTimer >= sp.summon.interval) {
      unit.specialTimer = 0;
      for (let i = 0; i < sp.summon.count; i++) {
        game.spawnUnit(sp.summon.card, unit.side,
          unit.x + (Math.random() - 0.5), unit.y + (unit.side === 0 ? -1 : 1) * 0.5);
      }
      game.bus.emit('unit:summoned', { spawner: unit, card: sp.summon.card }); // 召唤音效
      produced = true;
    }
  }
  return produced;
}

// 单位死亡效果(deathDamage/summonOnDeath/deathSummon):由 combat.onUnitDeath 调用
export function applyDeathAbilities(unit, game) {
  const sp = unit.card.special;
  if (!sp) return;

  if (sp.deathDamage) {
    game.applyAreaDamage(unit, sp.deathDamage.dmg, sp.deathDamage.splash, sp.deathDamage.targets);
    game.bus.emit('unit:deathBomb', { unit }); // 死亡爆炸音效(气球/骷髅巨人/戈仑)
  }
  if (sp.summonOnDeath) {
    for (let i = 0; i < (sp.summonOnDeath.count || 1); i++) {
      const u = game.spawnUnit(sp.summonOnDeath.card, unit.side,
        unit.x + (i - sp.summonOnDeath.count / 2) * 0.6, unit.y);
      u.deployTimer = 0.3;
    }
  }
  if (sp.deathSummon) {
    const positions = game.getDeployPositions(unit.x, unit.y, sp.deathSummon.count, 0.3);
    for (let i = 0; i < sp.deathSummon.count; i++) {
      game.spawnUnit(sp.deathSummon.card, unit.side, positions[i].x, positions[i].y);
    }
  }
}

// 建筑到期自然消亡也触发死亡召唤(墓碑/野蛮人小屋机制)
export function applyExpireAbilities(unit, game) {
  const sp = unit.card.special;
  if (sp && sp.deathSummon) {
    const positions = game.getDeployPositions(unit.x, unit.y, sp.deathSummon.count, 0.3);
    for (let i = 0; i < sp.deathSummon.count; i++) {
      game.spawnUnit(sp.deathSummon.card, unit.side, positions[i].x, positions[i].y);
    }
  }
}

// 攻击后效果(rampDamage 递增):由 combat.attackTarget 调用
export function afterAttack(unit) {
  const sp = unit.card.special;
  if (sp && sp.rampDamage) {
    unit.rampTimer += unit.card.hitSpeed;
    if (unit.rampTimer >= sp.rampDamage.rampTime) {
      unit.rampMult = sp.rampDamage.maxMult;
    } else {
      unit.rampMult = 1 + (sp.rampDamage.maxMult - 1) * (unit.rampTimer / sp.rampDamage.rampTime);
    }
  }
}
