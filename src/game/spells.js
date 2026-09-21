// ===============================================
// 法术系统 + 卡牌部署入口
// ===============================================
import { CARDS, KIND } from '../data/cards.js';
import { canDeploy, dist2 } from '../core/constants.js';
import { isHeavy } from './abilities.js';
import { getDeployPositions } from './formation.js';
import { Unit } from './unit.js';

// 施放法术
export function castSpell(cardId, side, x, y, game, mirrorSource) {
  let card = CARDS[cardId];
  if (!card || card.kind !== KIND.SPELL) return;

  // 镜像法术:复制上一张打出的牌
  if (card.special && card.special.mirror) {
    const last = game.lastPlayedCard;
    if (!last || last === 'mirror') return; // 无可复制目标
    const lastCard = CARDS[last];
    if (lastCard.kind === KIND.SPELL) {
      // 复制法术(费用+1)
      castSpell(last, side, x, y, game);
    } else {
      // 复制部队/建筑
      deployCard(last, side, x, y, game);
    }
    return;
  }

  // 范围伤害法术
  if (card.dmg > 0 || card.special) {
    // 法术图标在释放位置快速显隐(无论是否延时,立即给玩家落点反馈)
    game.addEffect({ type: 'spellIcon', cardId: card.id, x, y, life: 0.6, maxLife: 0.6 });
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

  game.lastPlayedCard = cardId;
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

  // 伤害敌方单位(皇室战争中法术只伤害敌方)
  const enemies = game.units.filter(u => u.side !== side && !u.dead);
  let spellHits = 0;
  const spellKills = [];

  for (const e of enemies) {
    const d = dist2(x, y, e.x, e.y);
    if (d <= (radius + e.radius) * (radius + e.radius)) {
      spellHits++;
      if (dmg > 0) {
        // 多段命中(万箭齐发 3 次/单位)
        const totalDmg = dmg * ((sp && sp.hits) || 1);
        const hpBefore = e.hp;
        game.dealDamage(e, totalDmg, null, card);
        if (e.hp <= 0 || e.dead) spellKills.push(e.card.name); // 记录击杀(日志用)
      }
      // 击退(重型单位免疫:巨人等大块头岿然不动)
      if (card.knockback && card.knockback > 0 && !e.isBuilding && !isHeavy(e)) {
        const dx = e.x - x, dy = e.y - y;
        const dd = Math.sqrt(dx*dx+dy*dy) || 1;
        e.x += (dx/dd) * card.knockback;
        e.y += (dy/dd) * card.knockback;
      }
      // 眩晕
      if (sp && sp.stun) {
        e.stunned = Math.max(e.stunned, sp.stun);
      }
      // 冰冻
      if (sp && sp.freeze) {
        e.frozen = Math.max(e.frozen, sp.freeze);
      }
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
  // 万箭 20% / 火箭 23% / 雷电 15% / 火球·电击·冰冻·狂暴 25%;多段命中同样适用)
  if (dmg > 0) {
    const TOWER_MULT = { arrows: 0.20, rocket: 0.23, lightning: 0.15, fireball: 0.25, zap: 0.25, freeze: 0.25, rage: 0.25 };
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
  // 部署区域检查(镜像召唤可豁免;传入敌方塔状态以支持推塔解锁区;
  // 卡牌级部署规则 deployZone 由 canDeploy 解释)
  const enemyTowers = game && game.towers ? game.towers[1 - side] : null;
  if (!opts.bypass && !canDeploy(side === 0 ? 'player' : 'ai', x, y, enemyTowers, { zone: card.deployZone })) return false;

  const count = card.count || 1;
  // 多体单位排布
  const positions = getDeployPositions(x, y, count, card.radius);
  for (let i = 0; i < count; i++) {
    const p = positions[i];
    game.spawnUnit(cardId, side, p.x, p.y);
  }
  game.lastPlayedCard = cardId;
  return true;
}
