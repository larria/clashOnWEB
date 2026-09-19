// ===============================================
// 法术系统
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const T = CR.T;

  // 施放法术
  function castSpell(cardId, side, x, y, game, mirrorSource) {
    let card = CR.CARDS[cardId];
    if (!card || card.kind !== CR.KIND.SPELL) return;

    // 镜像法术:复制上一张打出的牌
    if (card.special && card.special.mirror) {
      const last = game.lastPlayedCard;
      if (!last || last === 'mirror') return; // 无可复制目标
      const lastCard = CR.CARDS[last];
      if (lastCard.kind === CR.KIND.SPELL) {
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
      applySpellEffect(card, side, x, y, game);
    }

    game.lastPlayedCard = cardId;
  }

  function applySpellEffect(card, side, x, y, game) {
    const radius = card.radius;
    const dmg = card.dmg;
    const sp = card.special;

    // 伤害敌方单位(法术不分敌我?皇室战争中法术只伤害敌方,这里只伤害敌方)
    const enemies = game.units.filter(u => u.side !== side && !u.dead);
    let hitTargets = []; // 用于雷电连锁
    let spellKills = [];
    let spellHits = 0;

    for (const e of enemies) {
      const d = CR.dist2(x, y, e.x, e.y);
      if (d <= (radius + e.radius) * (radius + e.radius)) {
        spellHits++;
        if (dmg > 0) {
          e.hp -= dmg;
          if (e.hp <= 0 && !e.dead) { e.hp = 0; e.dead = true; spellKills.push(e.card.name); CR.onUnitDeath(e, game); }
        }
        // 击退
        if (card.knockback && card.knockback > 0 && !e.isBuilding) {
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
        // 狂暴(对己方?狂暴只对己方单位,这里 side 的己方单位)
        hitTargets.push(e);
      }
    }

    // 狂暴:增益己方单位
    if (sp && sp.buff) {
      const allies = game.units.filter(u => u.side === side && !u.dead && !u.isSpell);
      for (const a of allies) {
        const d = CR.dist2(x, y, a.x, a.y);
        if (d <= (radius + a.radius) * (radius + a.radius)) {
          a.rageTimer = Math.max(a.rageTimer, sp.duration);
        }
      }
    }

    // 冰冻:也冻结敌方塔
    if (sp && sp.freeze) {
      const towers = game.getEnemyTowers(side);
      for (const tw of towers) {
        if (tw.dead) continue;
        const d = CR.dist2(x, y, tw.x, tw.y);
        if (d <= (radius + tw.radius) * (radius + tw.radius)) {
          tw.frozen = Math.max(tw.frozen, sp.freeze);
        }
      }
    }

    // 雷电连锁:伤害最高的N个目标(已在范围内,这里额外选最近的3个高血量)
    if (sp && sp.chain && dmg > 0) {
      // 范围内目标按血量降序取前 chain 个,确保都受伤(已受伤,这里仅做眩晕)
      // 简化:范围内全部眩晕已处理
    }

    // 伤害塔
    if (dmg > 0) {
      const towers = game.getEnemyTowers(side);
      for (const tw of towers) {
        if (tw.dead) continue;
        const d = CR.dist2(x, y, tw.x, tw.y);
        if (d <= (radius + tw.radius) * (radius + tw.radius)) {
          CR.dealTowerDamage(tw, dmg, game);
        }
      }
    }

    // 法术命中汇总日志
    if (CR.log && (spellHits > 0 || spellKills.length > 0)) {
      const sideName = side === 0 ? '你的' : 'AI的';
      let msg = `${sideName}${card.name} 命中 ${spellHits} 个单位`;
      if (spellKills.length > 0) msg += `,击杀:${spellKills.join('、')}`;
      CR.log(msg, 'spell');
    }

    // 视觉特效
    game.addEffect({ type: 'spell', cardId: card.id, x, y, radius, life: 0.5, maxLife: 0.5, color: card.color });
  }

  // 部署卡牌(部队/建筑) - 由 player/AI 调用
  function deployCard(cardId, side, x, y, game, opts = {}) {
    const card = CR.CARDS[cardId];
    if (!card) return false;
    if (card.kind === CR.KIND.SPELL) {
      castSpell(cardId, side, x, y, game);
      return true;
    }
    // 部署区域检查(镜像召唤可豁免)
    if (!opts.bypass && !CR.canDeploy(side === 0 ? 'player' : 'ai', x, y)) return false;

    const count = card.count || 1;
    // 多体单位排布
    const positions = getDeployPositions(x, y, count, card.radius);
    for (let i = 0; i < count; i++) {
      const p = positions[i];
      const u = new CR.Unit(cardId, side, p.x, p.y);
      game.addUnit(u);
    }
    game.lastPlayedCard = cardId;
    return true;
  }

  // 计算多体部署位置(环形/方阵)
  function getDeployPositions(cx, cy, count, r) {
    if (count <= 1) return [{ x: cx, y: cy }];
    const positions = [];
    const radius = 0.7;
    if (count <= 4) {
      // 小环形
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 - Math.PI/2;
        positions.push({ x: cx + Math.cos(a)*radius, y: cy + Math.sin(a)*radius });
      }
    } else {
      // 大数量(骷髅军团15):多圈
      const ring1 = 6, ring2 = count - 6;
      for (let i = 0; i < Math.min(ring1, count); i++) {
        const a = (i / ring1) * Math.PI * 2;
        positions.push({ x: cx + Math.cos(a)*0.7, y: cy + Math.sin(a)*0.7 });
      }
      for (let i = 0; i < ring2 && positions.length < count; i++) {
        const a = (i / ring2) * Math.PI * 2 + 0.3;
        positions.push({ x: cx + Math.cos(a)*1.3, y: cy + Math.sin(a)*1.3 });
      }
    }
    return positions;
  }

  CR.castSpell = castSpell;
  CR.deployCard = deployCard;
  CR.getDeployPositions = getDeployPositions;
})(window.CR);
