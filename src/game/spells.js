// ===============================================
// 法术系统 + 卡牌部署入口
// ===============================================
import { CARDS, KIND } from '../data/cards.js';
import { canDeploy, dist2, GRID_W, GRID_H, isRiver, isBridge } from '../core/constants.js';
import { isHeavy } from './abilities.js';
import { getDeployPositions, getRingPositions } from './formation.js';

// 法术对塔减伤倍率(单一权威来源;ai.js 补刀判定从这里 import)
export const TOWER_MULT = {
  arrows: 0.20, rocket: 0.23, lightning: 0.15,
  fireball: 0.25, zap: 0.25, freeze: 0.30, theLog: 0.30,
};

// 施放法术(返回 false = 施放失败,如镜像复制的部署位非法;
// 调用方 playCard 依赖此返回值决定是否扣费)
export function castSpell(cardId, side, x, y, game) {
  let card = CARDS[cardId];
  if (!card || card.kind !== KIND.SPELL) return false;

  // 镜像法术:复制己方上一张打出的牌(对齐 CR:不复制对手的)
  if (card.special && card.special.mirror) {
    const last = game.lastPlayedCard[side];
    if (!last || last === 'mirror') return false; // 无可复制目标
    const lastCard = CARDS[last];
    if (lastCard.kind === KIND.SPELL) {
      // 复制法术(费用+1)
      return castSpell(last, side, x, y, game);
    } else {
      // 复制部队/建筑(部署失败需传播,否则圣水蒸发)
      return deployCard(last, side, x, y, game);
    }
  }

  // 范围伤害法术
  if (card.dmg > 0 || card.special) {
    // 法术图标在释放位置快速显隐(无论是否延时,立即给玩家落点反馈)
    game.addEffect({ type: 'spellIcon', cardId: card.id, x, y, life: 0.6, maxLife: 0.6 });
    // 滚木:直线滚动扫掠(规格 §6.2 滚动扫掷;即时起滚,无施法延时)
    if (card.special && card.special.roll) {
      startRoll(card, side, x, y, game);
      game.lastPlayedCard[side] = cardId;
      return true;
    }
    // 投射/施法延时(原版:火球/万箭/火箭从释放方国王塔飞出,飞行时间与
    // 距离正相关;电击/冰冻有固定施法时间;雷电/狂暴即时)
    const delay = getSpellDelay(card, side, x, y);
    if (delay > 0) {
      if (card.projectile) {
        // 飞行投射:发射点 = 己方国王塔后方,渲染投射物动画,到达后结算
        const from = { x: 9, y: side === 0 ? 30.5 : 1.5 };
        game.addEffect({
          type: 'spellProjectile', cardId: card.id, side,
          fromX: from.x, fromY: from.y, toX: x, toY: y,
          life: delay, maxLife: delay,
        });
      } else {
        // 固定施法时间:目标点预警圈
        game.addEffect({
          type: 'spellCast', cardId: card.id, side,
          x, y, radius: card.radius, life: delay, maxLife: delay, color: card.color,
        });
      }
      game.schedule(delay, () => applySpellEffect(card, side, x, y, game));
    } else {
      applySpellEffect(card, side, x, y, game);
    }
  }

  game.lastPlayedCard[side] = cardId;
  return true;
}

// 法术延迟:投射法术按距离/速度;固定施法时间法术用 castTime;其余即时
function getSpellDelay(card, side, x, y) {
  if (card.projectile) {
    const from = { x: 9, y: side === 0 ? 30.5 : 1.5 }; // 己方国王塔
    const d = Math.hypot(x - from.x, y - from.y);
    return d / card.projectile;
  }
  if (card.castTime) return card.castTime;
  return 0;
}

function applySpellEffect(card, side, x, y, game) {
  const radius = card.radius;
  const dmg = card.dmg;
  const sp = card.special;

  // 落地生成部队(飞桶类:桶落地炸开,内部单位按队形出现;deployTime
  // 后即可行动——对齐原版"落地后单位还有部署时间"的窗口,可被预判法术反制)
  if (sp && sp.spawnUnits) {
    const s = sp.spawnUnits;
    // 队形:ring=围绕落点环形散开(飞桶扔塔中心的官方行为——3 哥布林
    // 分居塔四周成等边三角形,加大 AOE 反制难度);
    // 默认横排(其他 spawnUnits 卡可自选)
    const positions = s.ring
      ? getRingPositions(x, y, s.count, s.ring)
      : game.getDeployPositions(x, y, s.count, 0.35);
    for (let i = 0; i < s.count; i++) {
      const u = game.spawnUnit(s.card, side, positions[i].x, positions[i].y);
      if (s.deployTime != null) u.deployTimer = s.deployTime;
    }
    game.bus.emit('unit:spawned', { spawner: { card, side }, card: s.card }); // 生兵音效
  }

  // 伤害敌方单位(皇室战争中法术只伤害敌方)
  const enemies = game.units.filter(u => u.side !== side && !u.dead);
  let spellHits = 0;
  const spellKills = [];

  // 连锁法术(雷电):只打击半径内血量最高的 N 个目标(对齐 CR)
  let targets = enemies;
  if (sp && sp.chain) {
    targets = enemies
      .filter(e => dist2(x, y, e.x, e.y) <= (radius + e.radius) * (radius + e.radius))
      .sort((a, b) => b.hp - a.hp)
      .slice(0, sp.chain);
  }

  // 持续伤害法术(毒药):区域内每 tick 跳一次伤害 + 持续减速,
  // 走出区域即不再受伤害(减速短暂残留);对塔伤害按 towerDmg 每跳结算。
  // 首跳延迟 tick 间隔(原版:伤害不即时,1 秒后第一跳)
  if (sp && sp.dot) {
    const d = sp.dot;
    for (let i = 1; i <= d.hits; i++) {
      game.schedule(d.tick * i, () => {
        if (game.gameOver) return;
        let hits = 0;
        for (const e of game.units) {
          if (e.dead || e.side === side) continue;
          if (dist2(x, y, e.x, e.y) > (radius + e.radius) * (radius + e.radius)) continue;
          game.dealDamage(e, d.dmg, null, card);
          hits++;
          // 每跳刷新减速(出圈后 ~1 tick 残留,对齐"离开后短暂保持")
          if (d.slow) {
            if (e.slowTimer < d.slow.duration) { e.slowTimer = d.slow.duration; e.slowFactor = d.slow.factor; }
          }
        }
        // 塔伤害(每跳独立结算,用专用对塔伤害而非倍率)
        if (d.towerDmg) {
          for (const tw of game.getEnemyTowers(side)) {
            if (tw.dead) continue;
            if (dist2(x, y, tw.x, tw.y) <= (radius + tw.radius) * (radius + tw.radius)) {
              game.dealTowerDamage(tw, d.towerDmg);
            }
          }
        }
        if (hits > 0) game.bus.emit('spell:hit', { cardId: card.id, side, x, y, radius, hits, kills: [] });
      });
    }
    // 视觉:毒雾区域(全程持续;渲染层按 life 渐隐)
    game.addEffect({ type: 'poisonCloud', x, y, radius, life: d.tick * d.hits, maxLife: d.tick * d.hits, color: card.color });
    game.lastPlayedCard[side] = card.id;
    return;   // dot 法术不走下面的即时伤害逻辑
  }

  for (const e of targets) {
    if (!(sp && sp.chain)) {
      const d = dist2(x, y, e.x, e.y);
      if (d > (radius + e.radius) * (radius + e.radius)) continue;
    }
    spellHits++;
    if (dmg > 0) {
      // 多段命中(万箭齐发 3 次/单位)
      const totalDmg = dmg * ((sp && sp.hits) || 1);
      game.dealDamage(e, totalDmg, null, card);
      if (e.hp <= 0 || e.dead) spellKills.push(e.card.name); // 记录击杀(日志用)
    }
    // 击退(重型单位免疫:巨人等大块头岿然不动)——补间动画 0.45s:
    // 沿爆炸径向滑出,期间硬直(不可攻击/移动/索敌,前摇打断);
    // 河/界钳制由 movement.applyKnockback 内建
    if (card.knockback && card.knockback > 0 && !e.isBuilding && !isHeavy(e)) {
      const dx = e.x - x, dy = e.y - y;
      applyKnockback(game, e, dx, dy, card.knockback, 0.45);
      // 击退同样重置冲锋充能(原版:滚木/雪球击退打断王子冲锋)
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
    }
    // 眩晕(重置王子等单位的冲锋充能——原版电系打断充能;
    // 同时重置地狱塔递增伤害——官方 zap/雷电重置充能是知名机制,
    // C++ 版冻结同样重置 ramp)
    if (sp && sp.stun) {
      e.stunned = Math.max(e.stunned, sp.stun);
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
      if (e.card.special && e.card.special.rampDamage) { e.rampMult = 1; e.rampTimer = 0; e._lastRampTarget = null; }
    }
    // 冰冻(同样打断充能;重置地狱塔递增——冻结=控制状态)
    if (sp && sp.freeze) {
      e.frozen = Math.max(e.frozen, sp.freeze);
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
      if (e.card.special && e.card.special.rampDamage) { e.rampMult = 1; e.rampTimer = 0; e._lastRampTarget = null; }
    }
  }

  // 狂暴:增益己方单位与塔(移动/攻击加速,原版对塔同样生效)
  if (sp && sp.buff) {
    const allies = game.units.filter(u => u.side === side && !u.dead && !u.isSpell);
    for (const a of allies) {
      const d = dist2(x, y, a.x, a.y);
      if (d <= (radius + a.radius) * (radius + a.radius)) {
        a.rageTimer = Math.max(a.rageTimer, sp.duration);
      }
    }
    // 己方塔(公主塔/激活的国王塔)
    const myTowers = [game.towers[side].left, game.towers[side].right, game.towers[side].king];
    for (const tw of myTowers) {
      if (tw.dead) continue;
      const d = dist2(x, y, tw.x, tw.y);
      if (d <= (radius + tw.radius) * (radius + tw.radius)) {
        tw.rageTimer = Math.max(tw.rageTimer, sp.duration);
      }
    }
    game.bus.emit('rage:applied', { side, x, y, radius });
  }

  // 冰冻:也冻结敌方塔
  if (sp && sp.freeze) {
    const towers = game.getEnemyTowers(side);
    for (const tw of towers) {
      if (tw.dead) continue;
      const d = dist2(x, y, tw.x, tw.y);
      if (d <= (radius + tw.radius) * (radius + tw.radius)) {
        tw.frozen = Math.max(tw.frozen, sp.freeze);
      }
    }
  }

  // 伤害塔(皇冠塔减伤:各法术倍率不同,对齐 wiki——
  // 万箭 20% / 火箭 23% / 雷电 15% / 火球·电击 25% / 冰冻 30%(wiki:35/115≈0.3)
  if (dmg > 0) {
    const mult = TOWER_MULT[card.id] != null ? TOWER_MULT[card.id] : 0.3;
    const towers = game.getEnemyTowers(side);
    const towerDmg = dmg * mult * ((sp && sp.hits) || 1);
    for (const tw of towers) {
      if (tw.dead) continue;
      const d = dist2(x, y, tw.x, tw.y);
      if (d <= (radius + tw.radius) * (radius + tw.radius)) {
        game.dealTowerDamage(tw, towerDmg);
      }
    }
  }

  // 法术命中事件(日志/音效/动画由订阅者消费)
  game.bus.emit('spell:hit', { cardId: card.id, side, x, y, radius, hits: spellHits, kills: spellKills });

  // 视觉特效(游戏状态内的效果队列,渲染层消费)
  game.addEffect({ type: 'spell', cardId: card.id, x, y, radius, life: 0.5, maxLife: 0.5, color: card.color });
}

// 部署卡牌(部队/建筑) - 由 player/AI 调用
export function deployCard(cardId, side, x, y, game, opts = {}) {
  const card = CARDS[cardId];
  if (!card) return false;
  if (card.kind === KIND.SPELL) {
    castSpell(cardId, side, x, y, game);
    return true;
  }
  // 部署区域检查(镜像召唤可豁免;传入双方塔状态:敌方塔判解锁区,
  // 己方塔判占面积;卡牌级部署规则 deployZone 由 canDeploy 解释;
  // 场上建筑单位同样占位,不可重叠)
  const enemyTowers = game && game.towers ? game.towers[1 - side] : null;
  const myTowers = game && game.towers ? game.towers[side] : null;
  const buildings = game && game.units ? game.units.filter(u => u.isBuilding && !u.dead) : null;
  if (!opts.bypass && !canDeploy(side === 0 ? 'player' : 'ai', x, y, enemyTowers, { zone: card.deployZone }, myTowers, buildings)) return false;

  const count = card.count || 1;
  // 多体单位排布 + 逐个落地(对齐官方 deploy stagger:多单位卡每个
  // 间隔 ~0.1 秒依次出现,期间虚影/不可行动但可被攻击;骷髅军团是
  // 官方例外——scatter 阵型全体同时落地,不设 stagger)
  const stagger = (count > 1 && cardId !== 'skeletonArmy') ? 0.1 : 0;
  const positions = getDeployPositions(x, y, count, card.radius);
  for (let i = 0; i < count; i++) {
    const p = positions[i];
    if (i === 0 || stagger === 0) {
      game.spawnUnit(cardId, side, p.x, p.y);
    } else {
      game.schedule(stagger * i, () => game.spawnUnit(cardId, side, p.x, p.y));
    }
  }
  game.lastPlayedCard[side] = cardId;
  return true;
}

// ===== 滚木:直线滚动扫掠(规格 §6.2 对照 C++ AreaSpell 滚动扫掷)=====
// 三条官方规则:
//   1. 走廊判定含目标半径(表面命中):弹头碰到目标近缘即命中
//   2. 每目标每滚至多一次(swept 记录)
//   3. 横向甩飞方向由被卷入位置决定:中心沿滚向推、边缘横甩
//      (movement.pushAlong;规格注释明言径向 pushAway 表达不了)
// 滚木挂在 game._rolls(逻辑) + game.effects(视觉),game.update 每帧调
// updateRolls 推进;对塔伤害走 TOWER_MULT 减伤(法术对塔统一规则)
import { pushAlong, applyKnockback } from './movement.js';

function startRoll(card, side, x, y, game) {
  const roll = card.special.roll;
  const dirY = side === 0 ? -1 : 1;   // 玩家(下方)向上滚,AI 向下
  const st = {
    type: 'rollingLog', cardId: card.id, side,
    x, y0: y, dirY, roll, dmg: card.dmg,
    towerMult: TOWER_MULT[card.id] != null ? TOWER_MULT[card.id] : 0.3,
    travelled: 0, swept: new Set(),
    // 视觉生命 = 滚完全程的时间(effects 按此渐隐)
    life: roll.range / roll.speed, maxLife: roll.range / roll.speed,
  };
  game.effects.push(st);       // 渲染层画滚木视觉(leading edge 位置)
  if (!game._rolls) game._rolls = [];
  game._rolls.push(st);
  game.bus.emit('spell:hit', { cardId: card.id, side, x, y,
    radius: roll.width / 2, hits: 0, kills: [] });   // 音效/日志
}

// 每帧推进所有在滚的滚木(由 game.update 调用)
export function updateRolls(game, dt) {
  if (!game._rolls) return;
  for (const st of game._rolls) {
    st.travelled += st.roll.speed * dt;
    if (st.travelled > st.roll.range) st.travelled = st.roll.range;
    st.y = st.y0 + st.dirY * st.travelled;   // leading edge(视觉+判定)
    const half = st.roll.width / 2;
    // 单位(只打地面)
    for (const e of game.units) {
      if (e.dead || e.side === st.side || st.swept.has(e.uid)) continue;
      if (e.flying) continue;
      const r = e.radius;
      const dx = e.x - st.x;
      const dy = (e.y - st.y0) * st.dirY;   // 沿滚向的偏移(正=前方)
      if (Math.abs(dx) > half + r) continue;   // 走廊外
      if (dy + r < 0) continue;                // 完全在起点后方
      if (dy - r > st.travelled) continue;     // 弹头未触及近缘
      st.swept.add(e.uid);
      game.dealDamage(e, st.dmg, null);
      // 横向甩飞:lateral ∈ [-1,1] 是被卷入的横向位置;中心前推边缘横甩
      const lateral = half > 0 ? Math.max(-1, Math.min(1, dx / half)) : 0;
      const forward = 1 - Math.abs(lateral);
      // 甩飞补间 0.5s(官方滚木把人整个推开+短暂硬直;pushAlong 是瞬移
      // 语义,这里用 applyKnockback 表达滑动过程)
      applyKnockback(game, e, lateral, forward * st.dirY, st.roll.knockback, 0.5);
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
    }
    // 塔(对塔减伤;塔不可位移——pushAlong 内建免疫)
    for (const tw of game.getEnemyTowers(st.side)) {
      if (tw.dead || st.swept.has(tw.uid)) continue;
      const r = tw.radius;
      const dx = tw.x - st.x;
      const dy = (tw.y - st.y0) * st.dirY;
      if (Math.abs(dx) > half + r) continue;
      if (dy + r < 0) continue;
      if (dy - r > st.travelled) continue;
      st.swept.add(tw.uid);
      game.dealTowerDamage(tw, st.dmg * st.towerMult);
    }
  }
  game._rolls = game._rolls.filter(s => s.travelled < s.roll.range);
}
