// ===============================================
// AI 决策系统 v2 - 评分制决策 + 圣水价值交换 + 防守反击 + 记牌
//
// 架构:每次决策枚举候选动作(防守/法术/进攻/过牌),按期望价值打分,
// 取最高分执行。价值 = 交换收益(圣水当量) - 风险代价。
// 设计原则(对齐原版高手打法):
//   1. 防守赚费优先:解牌费用 < 威胁费用时是最优解
//   2. 法术按簇内圣水总值决策,补刀塔血按真实对塔倍率算
//   3. 威胁解除后组织 counter-push(防守反击)
//   4. 记牌:追踪对手已出卡;对手圣水低时是进攻窗口
//   5. 开局收敛:不裸送首波 wincon
// 日志通过 game.bus 发出(不直接依赖 UI)
// ===============================================
import { T, RIVER_Y1, RIVER_Y2, GRID_W, GRID_H, SIDE_PLAYER, MATCH_TIME, dist, canDeploy } from '../core/constants.js';
import { CARDS, KIND } from '../data/cards.js';

// counter 关系:威胁卡 -> 推荐应对卡(按交换效率排序,前者优先)
const COUNTERS = {
  // 坦克(只打建筑):用高伤地面/递增伤害解
  giant:        ['miniPekka', 'infernoTower', 'barbarians', 'skeletonArmy', 'pekka'],
  golem:        ['infernoTower', 'miniPekka', 'pekka', 'barbarians'],
  hogRider:     ['cannon', 'tombstone', 'skeletons', 'barbarians', 'tesla'],
  balloon:      ['minions', 'minionHorde', 'archers', 'musketeer', 'wizard', 'tesla'],
  giantSkeleton:['barbarians', 'miniPekka', 'skeletonArmy', 'infernoTower'],
  // 群体:用法术/范围
  skeletonArmy:  ['arrows', 'zap', 'wizard', 'bomber', 'valkyrie'],
  barbarians:    ['bomber', 'fireball', 'valkyrie', 'wizard'],
  goblins:       ['zap', 'arrows', 'bomber', 'valkyrie', 'skeletons'],
  spearGoblins:  ['zap', 'arrows', 'archers'],
  minions:       ['arrows', 'zap', 'wizard', 'archers', 'musketeer'],
  minionHorde:   ['arrows', 'wizard', 'fireball', 'musketeer'],
  // 高伤单体:用群兵围杀
  miniPekka:     ['barbarians', 'skeletonArmy', 'goblins', 'skeletons', 'tombstone'],
  pekka:         ['barbarians', 'skeletonArmy', 'infernoTower', 'tombstone'],
  prince:        ['barbarians', 'skeletonArmy', 'tombstone', 'skeletons', 'goblins'],
  valkyrie:      ['minions', 'minionHorde', 'musketeer', 'archers', 'skeletonArmy'],
  musketeer:     ['barbarians', 'goblins', 'miniPekka', 'fireball'],
  wizard:        ['miniPekka', 'musketeer', 'goblins', 'fireball'],
  witch:         ['miniPekka', 'valkyrie', 'fireball', 'musketeer'],
  // 飞龙:用对空远程
  babyDragon:    ['musketeer', 'minions', 'archers', 'wizard'],
  knight:        ['minions', 'skeletonArmy', 'miniPekka', 'barbarians'],
  // 建筑(玩家在我方领土附近放的防御建筑不响应,但进攻型建筑需要处理)
  xbow:          ['hogRider', 'giant', 'rocket', 'miniPekka'],
  mortar:        ['hogRider', 'giant', 'miniPekka', 'rocket'],
};

// 卡牌角色分类(用于进攻组队)
export const ROLE = {
  TANK: ['giant', 'golem', 'giantSkeleton', 'knight', 'valkyrie'],
  WIN_CON: ['hogRider', 'balloon', 'xbow', 'mortar', 'pekka', 'miniPekka'],
  SUPPORT: ['musketeer', 'wizard', 'archers', 'minions', 'minionHorde', 'witch', 'babyDragon', 'bomber'],
  CYCLE: ['skeletons', 'goblins', 'spearGoblins', 'zap', 'arrows'],
  SPELL: ['fireball', 'arrows', 'rocket', 'lightning', 'zap', 'freeze', 'rage'],
  DEFENSE_BUILDING: ['cannon', 'tesla', 'infernoTower', 'bombTower', 'tombstone'],
  SPAWN_BUILDING: ['goblinHut', 'barbarianHut', 'elixirCollector'],
};

export function getRole(cardId) {
  for (const k of Object.keys(ROLE)) if (ROLE[k].includes(cardId)) return k;
  return 'TROOP';
}

// 法术对塔减伤倍率(权威来源 spells.js;此前双份硬编码已发生 freeze 漂移)
import { TOWER_MULT } from './spells.js';

// ===== 局面感知 =====

// 威胁:已进入或即将进入我方半场的敌方单位
function collectThreats(game, side) {
  const threats = [];
  for (const e of game.units) {
    if (e.side === side || e.dead) continue;
    // 距离我方最近塔的距离:越近威胁越大
    let nearest = null, nd = Infinity;
    const ts = game.towers[side];
    for (const tw of [ts.left, ts.right, ts.king]) {
      if (tw.dead) continue;
      const d = dist(e, tw);
      if (d < nd) { nd = d; nearest = tw; }
    }
    if (!nearest) continue;
    // 威胁判定:进入我方半场,或距我方塔 < 9 格(约 3 秒行程)
    const inMyHalf = side === 1 ? e.y < RIVER_Y1 + 1 : e.y > RIVER_Y2 - 1;
    const nearTower = nd < 9;
    // 即将过河(距河 < 3 格且朝我方移动)
    const approaching = side === 1
      ? (e.y < RIVER_Y2 + 3)
      : (e.y > RIVER_Y1 - 3);
    if (!inMyHalf && !nearTower && !approaching) continue;
    // 威胁度:费用为主,攻城单位加权,离塔越近越急
    let score = e.card.cost * 2 + e.hp / 100;
    if (e.card.targets === T.BUILDING) score *= 1.6;   // 攻城单位直捣塔
    if (e.flying) score *= 1.15;
    score += Math.max(0, (12 - nd)) * 1.5;
    threats.push({ unit: e, score, nearestTower: nearest, towerDist: nd });
  }
  threats.sort((a, b) => b.score - a.score);
  return threats;
}

// 评估"我方单位 a 能否在威胁 e 打到塔之前拦住"——简化:距离/速度
function interceptOk(defender, threat) { return true; } // 部署位置的拦截可行性由部署点决定

export class AI {
  constructor(game, deck, side = 1) {
    this.game = game;
    this.side = side; // 默认 SIDE_AI;评测时可为 0 当"玩家"侧镜像 AI
    this.deck = deck || [];
    this.hand = [];
    this.handSize = 4;
    this.drawPile = [];
    this.thinkTimer = 0;
    this.nextCardId = null;
    this.aggression = 0.5;        // 进攻倾向(动态:局势落后时上调)
    this.lastThreatCount = 0;     // 上一轮威胁数(检测"威胁解除"→触发反击)
    this.counterPushUntil = 0;    // 反击窗口截止时间
    this.counterPushLaneX = null; // 反击路线
    this.enemyPlayed = {};        // 记牌:对手已出的卡(本局)
    this._bindTracking();
    this.drawHand();
  }

  // 记牌:监听对手出牌
  _bindTracking() {
    this.game.bus.on('card:played', ({ side, cardId }) => {
      if (side !== this.side) this.enemyPlayed[cardId] = (this.enemyPlayed[cardId] || 0) + 1;
    });
  }

  // 抽牌
  drawHand() {
    this.drawPile = this.deck.slice();
    for (let i = this.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [this.drawPile[i],this.drawPile[j]] = [this.drawPile[j],this.drawPile[i]];
    }
    this.hand = [];
    for (let i = 0; i < this.handSize; i++) this.hand.push(this.drawPile.shift());
    this.nextCardId = this.drawPile.shift();
  }

  // 出牌后循环
  cycleAfterPlay(playedCardId, playedIndex) {
    this.hand[playedIndex] = this.nextCardId;
    this.drawPile.push(playedCardId);
    this.nextCardId = this.drawPile.shift();
  }

  hasCard(cardId) { return this.hand.indexOf(cardId); }

  /** 每帧驱动:按 thinkMult(难度决策频率倍率)节流调用 decide。
   *  编排层只调这个,不直接碰 thinkTimer(决策节律是 AI 的内部知识)。 */
  update(dt, thinkMult = 1) {
    this.thinkTimer += dt;
    const interval = 0.7 / thinkMult;
    if (this.thinkTimer >= interval && !this.game.gameOver) {
      this.thinkTimer = 0;
      this.decide();
    }
  }

  // ===== 主决策:评分制 =====
  decide() {
    const game = this.game;
    const elixir = game.elixir[this.side];
    const enemies = game.units.filter(u => u.side !== this.side && !u.dead);
    const myUnits = game.units.filter(u => u.side === this.side && !u.dead);
    const threats = collectThreats(game, this.side);

    // 动态进攻倾向:落后(塔血/皇冠)时更激进
    this._updateAggression();

    // 候选动作收集
    const candidates = [];
    const ctx = { game, enemies, myUnits, threats, elixir };

    // 1. 防守(含 counter)
    this._collectDefense(ctx, candidates);
    // 2. 法术(解场/补刀)
    this._collectSpells(ctx, candidates);
    // 3. 进攻(组队/快攻/反击)
    this._collectAttack(ctx, candidates);
    // 4. 过牌(防溢出)
    this._collectCycle(ctx, candidates);

    if (candidates.length === 0) return;
    // 评分排序,最高分执行(分数 <= 0 的动作不做)
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best.score <= 0) return;
    this.execute(best);
  }

  // 动态倾向:皇冠或塔血落后 → aggression 升高(0.5~0.85)
  _updateAggression() {
    const game = this.game;
    const myCrowns = game._crowns ? game._crowns(1 - this.side) : 0;
    const enemyCrowns = game._crowns ? game._crowns(this.side) : 0;
    const sumHp = (s) => {
      const t = game.towers[s];
      return (t.left.dead ? 0 : t.left.hp) + (t.right.dead ? 0 : t.right.hp) + (t.king.dead ? 0 : t.king.hp);
    };
    const diff = (sumHp(this.side) - sumHp(1 - this.side)) / 3000; // 正=领先
    let target = 0.5 - diff * 0.3 + (enemyCrowns - myCrowns) * 0.15;
    this.aggression = Math.max(0.35, Math.min(0.85, target));
  }

  // ===== 1. 防守候选 =====
  _collectDefense({ threats, elixir, game }, out) {
    if (threats.length === 0) return;
    const threat = threats[0];
    const e = threat.unit;

    // counter 表首选:按交换效率(费用差)排序而非表序
    // 法术不进防守部署:defensePosition 算的是部队拦截位(己方岸边),
    // 法术走那里会在空地"部署"出一次空放——法术瞄准一律由 _collectSpells
    // 按簇价值决策(曾经因此对未过河的火枪手在自家河边空放火球)
    const counters = COUNTERS[e.card.id] || [];
    const counterOptions = [];
    for (const c of counters) {
      const idx = this.hasCard(c);
      if (idx < 0) continue;
      const cc = CARDS[c];
      if (elixir < cc.cost) continue;
      if (cc.kind === KIND.SPELL) continue;
      counterOptions.push({ cardId: c, idx, cc, tradeRatio: e.card.cost / cc.cost });
    }
    // 已在场的我方单位若足以解威胁,降低再下牌的优先级(避免过度防守)
    const defendersNear = this._countDefenders(threat);
    const overDefended = defendersNear * 3 >= threat.unit.card.cost + 2;
    counterOptions.sort((a, b) => b.tradeRatio - a.tradeRatio);
    for (const opt of counterOptions) {
      const pos = this.defensePosition(e, opt.cardId);
      if (!pos) continue;
      // 评分:交换比 > 1 赚费;威胁紧急度加权;过度防守惩罚
      let score = 30 + opt.tradeRatio * 10 + threat.score * 0.3;
      if (overDefended) score -= 18;
      out.push({ cardId: opt.cardId, x: pos.x, y: pos.y, handIndex: opt.idx, role: 'defense', score });
      break; // 用最优 counter,不重复枚举
    }

    // 通用防守:能打该目标的最低费单位(counter 不在手上时)
    if (counterOptions.length === 0 && !overDefended) {
      let bestIdx = -1, bestCost = Infinity;
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind !== KIND.TROOP && c.kind !== KIND.BUILDING) continue;
        if (c.cost > elixir) continue;
        let valid;
        if (e.isBuilding) valid = (c.targets & (T.BUILDING | T.GROUND)) !== 0;
        else if (e.flying) valid = (c.targets & T.AIR) !== 0;
        else valid = (c.targets & T.GROUND) !== 0;
        if (!valid) continue;
        if (c.cost < bestCost) { bestCost = c.cost; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        const pos = this.defensePosition(e, this.hand[bestIdx]);
        if (pos) {
          let score = 22 + threat.score * 0.3 - (e.card.cost / bestCost < 0.7 ? 8 : 0);
          out.push({ cardId: this.hand[bestIdx], x: pos.x, y: pos.y, handIndex: bestIdx, role: 'defense', score });
        }
      }
    }
  }

  // 威胁附近我方防守单位数(避免过度防守)
  _countDefenders(threat) {
    let n = 0;
    for (const u of this.game.units) {
      if (u.side !== this.side || u.dead) continue;
      if (dist(u, threat.unit) < 6) n++;
    }
    return n;
  }

  // ===== 2. 法术候选 =====
  _collectSpells({ enemies, elixir, game }, out) {
    // 2a. 塔补刀:按真实对塔倍率算能秒才放(不再用面板伤害误判)
    for (const tw of game.getEnemyTowers(this.side)) {
      if (tw.dead) continue;
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind !== KIND.SPELL || !c.dmg) continue;
        if (elixir < c.cost) continue;
        const mult = TOWER_MULT[c.id] != null ? TOWER_MULT[c.id] : 0.3;
        const realDmg = c.dmg * mult * ((c.special && c.special.hits) || 1);
        if (tw.hp <= realDmg) {
          // 补刀必杀:高分
          out.push({ cardId: this.hand[i], x: tw.x, y: tw.y, handIndex: i, role: 'spell_finish', score: 100 });
          return;
        }
      }
    }

    // 2b. 解场:按簇内圣水总值决策(≥ 法术费 × 1.2 才值)
    const clusters = this._findClusters(enemies, 2.5);
    for (const cluster of clusters) {
      // 单只价值 = 整卡费用 / 卡片单位数(多体卡每只是均摊,不是整卡费)
      const unitValue = (u) => (u.card.cost / (u.card.count || 1)) * (u.hp / u.card.hp > 0.4 ? 1 : 0.3);
      const liveValue = cluster.units.reduce((s, u) => s + unitValue(u), 0);
      if (liveValue < 2.5) continue; // 簇总价值太低不值得法术
      // 深入敌方领土的簇(对手沉底部署/后场产出)不算法术目标:
      // 它们离威胁我方还很远,法术砸过去既亏费又可能蹭醒对方国王塔
      // (side1=AI 在上方,敌方领土=玩家半场 y > RIVER_Y2+4;side0 对称)
      const inEnemyTerritory = this.side === 1
        ? cluster.cy > RIVER_Y2 + 4
        : cluster.cy < RIVER_Y1 - 4;
      if (inEnemyTerritory) continue;
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind !== KIND.SPELL || !c.dmg) continue;
        if (elixir < c.cost) continue;
        const willKill = cluster.units.filter(u => u.hp <= c.dmg * ((c.special && c.special.hits) || 1)).length;
        // 击杀的圣水价值 + 削血折算(均摊单只价值,多体卡不虚高)
        const killValue = cluster.units
          .filter(u => u.hp <= c.dmg * ((c.special && c.special.hits) || 1))
          .reduce((s, u) => s + unitValue(u), 0);
        const chipValue = cluster.units
          .filter(u => u.hp > c.dmg * ((c.special && c.special.hits) || 1))
          .reduce((s, u) => s + unitValue(u) * 0.3, 0);
        const value = killValue + chipValue;
        if (value >= c.cost * 1.2 && willKill >= 1) {
          let score = 15 + value * 6 - c.cost * 3;
          // 误唤醒敌方沉睡国王塔的惩罚:法术范围够到未激活国王塔时
          // 大幅降分(沉底单位/女巫骷髅不值得帮对手激活国王塔;
          // 只有簇价值极高(≥8)时才接受代价)
          const enemyKing = game.towers[1 - this.side].king;
          if (!enemyKing.dead && !enemyKing.activated) {
            const kd = Math.hypot(cluster.cx - enemyKing.x, cluster.cy - enemyKing.y);
            if (kd <= (c.radius || 2.5) + enemyKing.radius) {
              if (value < 8) continue;   // 价值不够 → 不放这个法术
              score -= 20;               // 价值够 → 接受代价但降优先级
            }
          }
          out.push({ cardId: this.hand[i], x: cluster.cx, y: cluster.cy, handIndex: i, role: 'spell_clear', score });
        }
      }
    }
  }

  _findClusters(units, r) {
    const clusters = [];
    const used = new Set();
    for (const u of units) {
      if (used.has(u.uid)) continue;
      const group = [u];
      let cx = u.x, cy = u.y;
      for (const u2 of units) {
        if (used.has(u2.uid) || u2 === u) continue;
        if (dist(u, u2) < r) {
          group.push(u2);
          used.add(u2.uid);
          cx += u2.x; cy += u2.y;
        }
      }
      used.add(u.uid);
      cx /= group.length; cy /= group.length;
      clusters.push({ units: group, cx, cy });
    }
    return clusters;
  }

  // ===== 3. 进攻候选 =====
  _collectAttack({ myUnits, threats, elixir, game, enemies }, out) {
    const dir = this.dir;
    const enemyElixir = game.elixir[1 - this.side];
    const time = game.time;
    // 开局收敛:前 30 秒不主动快攻(除非对手已先攻暴露)
    const openingSafe = time > 30 || this._enemyCommitted();

    // 3a. counter-push:威胁刚解除(威胁数下降)且我方有存活兵力 → 3 秒反击窗口
    if (threats.length === 0 && this.lastThreatCount > 0) {
      this.counterPushUntil = time + 3;
      // 反击路线 = 我方存活进攻单位所在路线
      const survivors = myUnits.filter(u => !u.isBuilding && u.card.cost >= 2);
      if (survivors.length) {
        const lead = survivors.reduce((a, b) => (this._advanceProgress(b) > this._advanceProgress(a) ? b : a));
        this.counterPushLaneX = lead.x;
      }
    }
    this.lastThreatCount = threats.length;

    // 3b. 已有坦克在推进 → 补后排
    const pushingTanks = myUnits.filter(u => ROLE.TANK.includes(u.cardId) &&
      (this.side === 1 ? u.y > RIVER_Y2 : u.y < RIVER_Y1));
    if (pushingTanks.length > 0) {
      for (let i = 0; i < this.hand.length; i++) {
        if (!ROLE.SUPPORT.includes(this.hand[i])) continue;
        const c = CARDS[this.hand[i]];
        if (elixir < c.cost) continue;
        const tank = pushingTanks[0];
        const px = tank.x, py = tank.y - dir * 2;
        if (this.canPlace(px, py)) {
          out.push({ cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'support', score: 26 });
          break;
        }
      }
    }

    // 3c. 反击窗口 + 手上有 wincon/suppport → 抓住时机
    const inCounterPush = time < this.counterPushUntil && threats.length === 0;
    if (inCounterPush && this.counterPushLaneX != null) {
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind === KIND.SPELL) continue;
        if (!ROLE.WIN_CON.includes(this.hand[i]) && !ROLE.SUPPORT.includes(this.hand[i])) continue;
        if (elixir < c.cost) continue;
        const py = this.myRiverEdgeY;
        if (this.canPlace(this.counterPushLaneX, py)) {
          out.push({ cardId: this.hand[i], x: this.counterPushLaneX, y: py, handIndex: i, role: 'counter_push', score: 34 });
          break;
        }
      }
    }

    // 3d. 常规进攻:对手圣水低(刚花完)是最佳窗口
    const enemyPoor = enemyElixir <= 3;
    const windowBonus = enemyPoor ? 12 : 0;
    const target = this._pickTargetTower();
    if (!target) return;
    const laneX = target.x;

    // 坦克推进:满费窗口
    const tankThreshold = 8 - this.aggression * 2; // aggression 0.5 → 7;0.85 → 6.3
    if (elixir >= tankThreshold) {
      for (let i = 0; i < this.hand.length; i++) {
        if (!ROLE.TANK.includes(this.hand[i])) continue;
        const c = CARDS[this.hand[i]];
        if (elixir < c.cost) continue;
        const py = this.myBackY;
        if (this.canPlace(laneX, py)) {
          let score = 20 + windowBonus - (game.doubleElixir ? 0 : 4);
          // 双倍圣水阶段更愿意投入
          if (game.doubleElixir) score += 6;
          out.push({ cardId: this.hand[i], x: laneX, y: py, handIndex: i, role: 'tank_push', score });
          break;
        }
      }
    }

    // 快攻 wincon:只在安全窗口(开局保护 + 对手圣水低/落后追分)
    if (elixir >= 7 && openingSafe) {
      for (let i = 0; i < this.hand.length; i++) {
        if (!ROLE.WIN_CON.includes(this.hand[i])) continue;
        const c = CARDS[this.hand[i]];
        if (elixir < c.cost) continue;
        const py = this.myRiverEdgeY;
        if (this.canPlace(laneX, py)) {
          let score = 16 + windowBonus + (this.aggression - 0.5) * 20;
          // 单独快攻容易被解;若对手手里可能有 counter(记牌:本局没见过他的 key 防守牌)降分
          if (this._enemyMayHaveCounter(this.hand[i])) score -= 8;
          out.push({ cardId: this.hand[i], x: laneX, y: py, handIndex: i, role: 'wincon', score });
          break;
        }
      }
    }
  }

  // 对手是否已投入进攻(开局安全判定)
  _enemyCommitted() {
    return this.game.units.some(u => u.side !== this.side && !u.dead && u.card.cost >= 3);
  }

  // 记牌推断:对手的 key 防守牌本局还没出过(手里大概率有)
  _enemyMayHaveCounter(winconId) {
    const keyCounters = COUNTERS[winconId] || [];
    for (const c of keyCounters) {
      if (!this.enemyPlayed[c] && this._deckHas(c)) return true;
    }
    return false;
  }
  _deckHas(cardId) {
    // 无法知道对手卡组(信息不完全),保守假设他可能有 → 用出牌记录判断
    return true;
  }

  // 单位推进进度(离敌方国王塔的距离,越近越深)
  _advanceProgress(u) {
    const enemyKing = this.game.towers[1 - this.side].king;
    return 40 - dist(u, enemyKing);
  }

  _pickTargetTower() {
    const towers = this.game.getEnemyTowers(this.side).filter(t => !t.dead && t.type === 'princess');
    if (towers.length === 0) return null;
    return towers.sort((a, b) => a.hp - b.hp)[0];
  }

  // ===== 4. 过牌候选 =====
  _collectCycle({ elixir, enemies, myUnits }, out) {
    if (elixir < 9) return;
    for (let i = 0; i < this.hand.length; i++) {
      const c = CARDS[this.hand[i]];
      if (c.kind === KIND.SPELL) continue;
      if (c.cost <= 3 && c.cost > 0 && elixir >= c.cost) {
        // 过牌位置:国王塔侧后方的空地(原 (9,4) 落在国王塔占面积内恒非法)
        const px = 13;
        const py = this.side === 1 ? 7 : GRID_H - 7;
        if (this.canPlace(px, py, this.hand[i])) {
          out.push({ cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'cycle', score: 6 });
          break;
        }
      }
    }
  }

  // 推进方向:AI(上方,side=1)向下 +y;玩家(下方,side=0)向上 -y
  get dir() { return this.side === 1 ? 1 : -1; }
  get myBackY() { return this.side === 1 ? RIVER_Y1 - 2 : RIVER_Y2 + 2; }
  get myRiverEdgeY() { return this.side === 1 ? RIVER_Y1 - 1 : RIVER_Y2 + 1; }
  get sideName() { return this.side === 1 ? 'ai' : 'player'; }

  // 防守部署位置
  defensePosition(threat, cardId) {
    const c = CARDS[cardId];
    const dir = this.dir;
    if (c.kind === KIND.BUILDING) {
      const tower = this.nearestMyTower(threat);
      const dx = threat.x - tower.x, dy = threat.y - tower.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const px = tower.x + (dx/d) * 3.5;
      const py = tower.y + (dy/d) * 3.5;
      if (this.canPlace(px, py)) return { x: px, y: py };
      return { x: tower.x, y: tower.y + dir * 2 };
    }
    // 部队:威胁与塔之间偏塔侧(贴着威胁后方,让它走过来挨打)
    let py = threat.y + dir * 1.5;
    let px = threat.x;
    if (this.side === 1) {
      if (py > RIVER_Y1 - 1) py = RIVER_Y1 - 1;
      if (py < 2) py = 2;
    } else {
      if (py < RIVER_Y2 + 1) py = RIVER_Y2 + 1;
      if (py > GRID_H - 2) py = GRID_H - 2;
    }
    px = Math.max(1, Math.min(GRID_W-1, px));
    // 可部署性校验:px 可能落在己方塔占面积上,不校验会导致最高分
    // 防守动作静默失败、该决策周期完全空转
    if (!this.canPlace(px, py, cardId)) return null;
    return { x: px, y: py };
  }

  canPlace(x, y, cardId) {
    const card = cardId ? CARDS[cardId] : null;
    return canDeploy(this.sideName, x, y, this.game.towers[1 - this.side], { zone: card && card.deployZone }, this.game.towers[this.side]);
  }

  nearestMyTower(unit) {
    const t = this.game.towers[this.side];
    const all = [t.left, t.right, t.king].filter(tw => !tw.dead);
    let best = all[0], bd = Infinity;
    for (const tw of all) {
      const d = dist(unit, tw);
      if (d < bd) { bd = d; best = tw; }
    }
    return best;
  }

  execute(action) {
    const card = CARDS[action.cardId];
    const ok = this.game.playCard(this.side, action.cardId, action.x, action.y);
    if (ok) {
      const roleNames = {
        defense: '防守', support: '支援', tank_push: '坦克推进', wincon: '快攻',
        cycle: '过牌', spell_finish: '法术补刀', spell_clear: '法术解场', counter_push: '防守反击'
      };
      const roleStr = roleNames[action.role] ? `(${roleNames[action.role]})` : '';
      const posStr = `(${action.x.toFixed(1)},${action.y.toFixed(1)})`;
      const who = this.side === 1 ? 'ai' : 'me';
      if (card.kind === KIND.SPELL) {
        this.game.bus.emit('log', { who, msg: `施放 ${card.name} ${posStr} ${roleStr}`, cls: 'spell' });
      } else if (card.kind === KIND.BUILDING) {
        this.game.bus.emit('log', { who, msg: `建造 ${card.name} ${posStr} ${roleStr}`, cls: 'ai' });
      } else {
        this.game.bus.emit('log', { who, msg: `部署 ${card.name} ${posStr} ${roleStr}`, cls: 'ai' });
      }
      this.cycleAfterPlay(action.cardId, action.handIndex);
    }
  }

  setDeck(deck) {
    this.deck = deck.slice();
    this.drawHand();
  }
}
