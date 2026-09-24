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
  fireball: 0.25, zap: 0.25, freeze: 0.30,
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
    // 击退(重型单位免疫:巨人等大块头岿然不动;clamp 地图边界防止推出界外;
    // 地面单位不得被推进非桥河道——被推入则沿 y 退回最近岸边)
    if (card.knockback && card.knockback > 0 && !e.isBuilding && !isHeavy(e)) {
      const dx = e.x - x, dy = e.y - y;
      const dd = Math.sqrt(dx*dx+dy*dy) || 1;
      let nx = e.x + (dx/dd) * card.knockback;
      let ny = e.y + (dy/dd) * card.knockback;
      nx = Math.max(e.radius, Math.min(GRID_W - e.radius, nx));
      ny = Math.max(e.radius, Math.min(GRID_H - e.radius, ny));
      if (!e.flying && isRiver(nx, ny) && !isBridge(nx, ny)) {
        // 退回击退前的 y(岸边)或钳到桥 x
        if (!isRiver(nx, e.y) || isBridge(nx, e.y)) {
          ny = e.y;
        } else {
          const bx = nx < 9 ? 3.5 : 14.5;
          nx = bx;
          if (isRiver(nx, ny) && !isBridge(nx, ny)) ny = e.y;
        }
      }
      e.x = nx;
      e.y = ny;
      // 击退同样重置冲锋充能(原版:滚木/雪球击退打断王子冲锋)
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
    }
    // 眩晕(重置王子等单位的冲锋充能——原版电系打断充能)
    if (sp && sp.stun) {
      e.stunned = Math.max(e.stunned, sp.stun);
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
    }
    // 冰冻(同样打断充能)
    if (sp && sp.freeze) {
      e.frozen = Math.max(e.frozen, sp.freeze);
      if (e.card.special && e.card.special.charge) { e.charged = false; e.chargeTimer = 0; }
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
