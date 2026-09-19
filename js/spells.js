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

  // 重型单位(不受法术击退):巨人/戈仑/皮卡/骷髅巨人/野蛮人小屋等大型单位
  const HEAVY_UNITS = new Set(['giant', 'golem', 'golemite', 'pekka', 'giantSkeleton', 'barbarianHut']);

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
          // 多段命中(万箭齐发 3 次/单位)
          const totalDmg = dmg * ((sp && sp.hits) || 1);
          e.hp -= totalDmg;
          if (e.hp <= 0 && !e.dead) { e.hp = 0; e.dead = true; spellKills.push(e.card.name); CR.onUnitDeath(e, game); }
        }
        // 击退
        // 击退(重型单位免疫:巨人等大块头岿然不动)
        if (card.knockback && card.knockback > 0 && !e.isBuilding && !HEAVY_UNITS.has(e.cardId)) {
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

    // 伤害塔(皇冠塔减伤:法术对塔约 30% 伤害;多段命中同样适用)
    if (dmg > 0) {
      const towers = game.getEnemyTowers(side);
      const towerDmg = dmg * 0.3 * ((sp && sp.hits) || 1);
      for (const tw of towers) {
        if (tw.dead) continue;
        const d = CR.dist2(x, y, tw.x, tw.y);
        if (d <= (radius + tw.radius) * (radius + tw.radius)) {
          CR.dealTowerDamage(tw, towerDmg, game);
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
    // 部署区域检查(镜像召唤可豁免;传入敌方塔状态以支持推塔解锁区)
    const enemyTowers = game && game.towers ? game.towers[1 - side] : null;
    if (!opts.bypass && !CR.canDeploy(side === 0 ? 'player' : 'ai', x, y, enemyTowers)) return false;

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

  // 计算多体部署位置(CR 式横排队列:横排为主轴,多行沿 y 堆叠)
  // 2个:左右横排(放底部中央时自然分两路)  3个:横排
  // 4个:2x2  5个:3+2  15个:5x3 密集方阵
  // 边界钳制:不越出地图、不落入河道
  function getDeployPositions(cx, cy, count, r) {
    if (count <= 1) return [{ x: cx, y: cy }];
    const spacing = Math.max(0.9, (r || 0.35) * 2.4); // 单位横向间距
    const rowSpacing = spacing * 0.9;                  // 行距

    // 计算每行人数:横排优先,最多 5 列
    const cols = Math.min(count, count <= 3 ? count : (count <= 6 ? Math.ceil(count / 2) : 5));
    const rows = Math.ceil(count / cols);
    // 行内人数分配(上行多、下行少:3+2 形态)
    const perRow = [];
    let remaining = count;
    for (let i = 0; i < rows; i++) {
      const rowN = Math.ceil(remaining / (rows - i));
      perRow.push(rowN);
      remaining -= rowN;
    }

    const positions = [];
    for (let ri = 0; ri < rows; ri++) {
      const n = perRow[ri];
      const rowW = (n - 1) * spacing;
      for (let i = 0; i < n; i++) {
        let x = cx - rowW / 2 + i * spacing;
        let y = cy + (ri - (rows - 1) / 2) * rowSpacing;
        positions.push({ x, y });
      }
    }

    // 边界钳制:x 不出地图,y 不进河道(非桥)
    const inRiver = (x, y) => CR.isRiver(x, y) && !CR.isBridge(x, y);
    const clamped = positions.map(p => {
      let x = Math.max(r + 0.1, Math.min(CR.GRID_W - r - 0.1, p.x));
      let y = p.y;
      if (inRiver(x, y)) {
        // 尝试仅动 y(保持 x):向部署中心方向退
        const tryYs = [cy, cy + (y > cy ? 1.2 : -1.2), cy + (y > cy ? 2.4 : -2.4)];
        for (const ty of tryYs) {
          if (!inRiver(x, ty)) { y = ty; break; }
        }
      }
      y = Math.max(r + 0.1, Math.min(CR.GRID_H - r - 0.1, y));
      return { x, y };
    });
    return clamped;
  }

  CR.castSpell = castSpell;
  CR.deployCard = deployCard;
  CR.getDeployPositions = getDeployPositions;
})(window.CR);
