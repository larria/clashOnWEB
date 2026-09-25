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
    // 首波较快(firstDelay),之后按 interval 循环(部署延迟已由调用方 canAct 保证)
    unit.specialTimer += dt;
    const first = sp.spawn.firstDelay != null ? sp.spawn.firstDelay : sp.spawn.interval;
    const due = unit.spawnedOnce ? sp.spawn.interval : first;
    if (unit.specialTimer >= due) {
      unit.specialTimer = 0;
      unit.spawnedOnce = true;
      for (let i = 0; i < sp.spawn.count; i++) {
        // 召唤物无部署硬直(官方:小屋产兵即出即行动)
        const u0 = game.spawnUnit(sp.spawn.card, unit.side, unit.x, unit.y + (unit.side === 0 ? -0.8 : 0.8));
        u0.deployTimer = 0;
      }
      game.bus.emit('unit:spawned', { spawner: unit, card: sp.spawn.card }); // 产兵音效
      produced = true;
    }
  }
  if (sp.produceElixir) {
    unit.specialTimer += dt;
    if (unit.specialTimer >= sp.produceElixir.interval) {
      unit.specialTimer = 0;
      game.addElixir(unit.side, sp.produceElixir.amount, unit);
      produced = true;
    }
  }
  if (sp.summon && unit.deployTimer <= 0) { // 女巫召唤骷髅
    unit.specialTimer += dt;
    // 首波有 firstDelay(女巫:部署后 1 秒出第一波;之后按 interval 循环)
    const first = sp.summon.firstDelay != null ? sp.summon.firstDelay : sp.summon.interval;
    const due = unit.summonedOnce ? sp.summon.interval : first;
    if (unit.specialTimer >= due) {
      unit.specialTimer = 0;
      unit.summonedOnce = true;
      // 官方:召唤 4 个骷髅"surrounding"女巫(围绕四周),非全堆正前方。
      // 围绕生成使骷髅从女巫四周分散出现,行进时自然排成纵队跟随,
      // 不会形成横墙挡住女巫致其停止前进。
      // 环形均匀分布(等角),半径 ~1.4(避开女巫自身碰撞盒)。
      // 沉底国王塔放置时,环形有一只落在另一路——对齐官方
      // "1 of the Skeletons spawn in the other lane"。
      const count = sp.summon.count;
      const ring = sp.summon.ring || 1.4;
      const fwd = (unit.side === 0 ? -1 : 1); // 行进方向偏置:略偏前方
      const rot = fwd === -1 ? -Math.PI / 2 : Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const a = rot + (i * 2 * Math.PI) / count;
        const sx = unit.x + Math.cos(a) * ring;
        const sy = unit.y + Math.sin(a) * ring;
        // stagger 依次落地(0.12s 间隔):骷髅一只接一只冒出,呈纵队感
        // 召唤物无部署硬直(官方:女巫召唤的骷髅即出即行动,deployTimer=0)
        if (i === 0) {
          const u0 = game.spawnUnit(sp.summon.card, unit.side, sx, sy);
          u0.deployTimer = 0;
        } else {
          game.schedule(0.12 * i, () => {
            const us = game.spawnUnit(sp.summon.card, unit.side, sx, sy);
            us.deployTimer = 0;
          });
        }
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
    const dd = sp.deathDamage;
    if (dd.delay > 0) {
      // 延时炸弹(气球/骷髅巨人):掉落可见炸弹,数秒后爆炸
      dropDeathBomb(unit, game, dd);
    } else {
      // 即时死亡伤害(戈仑/小戈仑):只伤敌方单位(CR 无友军伤害机制——
      // 法术/死亡炸弹都只伤敌方;此前误设 hurtAlly=true 会误伤友军)
      game.applyAreaDamage(unit, dd.dmg, dd.splash, dd.targets, false);
      game.bus.emit('unit:deathBomb', { unit });
    }
  }
  if (sp.summonOnDeath) {
    for (let i = 0; i < (sp.summonOnDeath.count || 1); i++) {
      const u = game.spawnUnit(sp.summonOnDeath.card, unit.side,
        unit.x + (i - sp.summonOnDeath.count / 2) * 0.6, unit.y);
      u.deployTimer = 0;   // 召唤物无部署硬直
    }
  }
  if (sp.deathSummon) {
    const positions = game.getDeployPositions(unit.x, unit.y, sp.deathSummon.count, 0.3);
    for (let i = 0; i < sp.deathSummon.count; i++) {
      const u = game.spawnUnit(sp.deathSummon.card, unit.side, positions[i].x, positions[i].y);
      u.deployTimer = 0;   // 召唤物无部署硬直
    }
  }
}

// 掉落延时炸弹(原版:气球/骷髅巨人 3 秒引信;骷髅巨人对塔双倍伤害)
// 炸弹作为视觉效果存在(game.effects),伤害由 game.schedule 延迟结算
function dropDeathBomb(unit, game, dd) {
  const x = unit.x, y = unit.y;
  const delay = dd.delay;
  // 视觉:炸弹实体(渲染层画黑圆+火花+引信闪烁),爆炸时转爆炸特效
  game.addEffect({ type: 'deathBomb', x, y, radius: dd.splash, life: delay, maxLife: delay, side: unit.side });
  game.bus.emit('unit:deathBombDrop', { unit }); // 落地音(轻微)
  game.schedule(delay, () => {
    // 爆炸:范围伤害(骷髅巨人 towerMult 对塔加成);只伤敌方单位——
    // CR 无友军伤害机制(wiki 骷髅巨人+护卫推进战术成立的前提)
    game.applyAreaDamageAt(x, y, dd.dmg, dd.splash, dd.targets, unit.side, dd.towerMult || 1, null, false);
    game.addEffect({ type: 'spell', cardId: 'deathBomb', x, y, radius: dd.splash, life: 0.5, maxLife: 0.5, color: '#ff6f00' });
    game.bus.emit('unit:deathBomb', { unit });
  });
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
