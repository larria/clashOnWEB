// ===============================================
// AI 决策系统
// 策略:局面评估 + counter 出牌 + 攻防节奏
// 目标:同卡组下对熟练玩家胜率 >= 50%
// 日志通过 game.bus 发出(不直接依赖 UI)
// ===============================================
import { T, RIVER_Y1, RIVER_Y2, GRID_W, GRID_H, SIDE_PLAYER, dist, canDeploy } from '../core/constants.js';
import { CARDS, KIND } from '../data/cards.js';

// counter 关系:威胁卡 -> 推荐应对卡
// 玩法逻辑:AI 检测到敌方威胁,选最优解牌
const COUNTERS = {
  // 坦克(只打建筑):用高伤地面/递增伤害解
  giant:        ['miniPekka', 'infernoTower', 'barbarians', 'skeletonArmy'],
  golem:        ['infernoTower', 'miniPekka', 'pekka'],
  hogRider:     ['cannon', 'skeletons', 'tombstone', 'barbarians'],
  balloon:      ['minions', 'minionHorde', 'wizard', 'archers', 'tesla'],
  giantSkeleton:['barbarians', 'miniPekka', 'skeletonArmy'],
  // 群体:用法术/范围
  skeletonArmy:  ['arrows', 'zap', 'wizard', 'bomber', 'valkyrie'],
  barbarians:    ['bomber', 'fireball', 'valkyrie', 'wizard'],
  goblins:       ['zap', 'arrows', 'bomber', 'valkyrie'],
  spearGoblins:  ['zap', 'arrows', 'archers'],
  minions:       ['arrows', 'wizard', 'archers', 'musketeer'],
  minionHorde:   ['arrows', 'wizard', 'fireball'],
  // 高伤单体:用群兵围杀
  miniPekka:     ['barbarians', 'skeletonArmy', 'goblins', 'skeletons'],
  pekka:         ['barbarians', 'skeletonArmy', 'infernoTower'],
  prince:        ['barbarians', 'skeletonArmy', 'tombstone', 'skeletons'],
  valkyrie:      ['minions', 'minionHorde', 'musketeer', 'archers'],
  musketeer:     ['barbarians', 'goblins', 'miniPekka'],
  wizard:        ['miniPekka', 'musketeer', 'goblins'],
  witch:         ['miniPekka', 'valkyrie', 'fireball'],
  // 飞龙:用对空远程
  babyDragon:    ['musketeer', 'minions', 'archers'],
  // 建筑
  xbow:          ['hogRider', 'giant', 'rocket', 'miniPekka'],
  mortar:        ['hogRider', 'giant', 'miniPekka'],
  tesla:         ['hogRider', 'fireball'],
  infernoTower:  ['hogRider', 'goblins', 'skeletons', 'fireball'],
  bombTower:     ['minions', 'minionHorde', 'musketeer'],
  goblinHut:     ['rocket', 'fireball', 'hogRider'],
  tombstone:     ['arrows', 'zap'],
  elixirCollector:['rocket', 'fireball', 'hogRider'],
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

export class AI {
  constructor(game, deck) {
    this.game = game;
    this.side = 1; // SIDE_AI
    this.deck = deck || [];
    this.hand = [];
    this.handSize = 4;
    this.drawPile = [];
    this.thinkTimer = 0;
    this.nextCardId = null;
    this.aggression = 0.5; // 进攻倾向
    this.drawHand();
  }

  // 抽牌
  drawHand() {
    this.drawPile = this.deck.slice();
    // 洗牌
    for (let i = this.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [this.drawPile[i],this.drawPile[j]] = [this.drawPile[j],this.drawPile[i]];
    }
    this.hand = [];
    // 初始手牌:先抽 4 张,第 5 张作为 next
    for (let i = 0; i < this.handSize; i++) this.hand.push(this.drawPile.shift());
    this.nextCardId = this.drawPile.shift();
  }

  // 出牌后循环:打出的卡进入抽牌堆底部,next 补到该手牌位,再从抽牌堆顶抽新 next
  cycleAfterPlay(playedCardId, playedIndex) {
    this.hand[playedIndex] = this.nextCardId;
    this.drawPile.push(playedCardId); // 打出的卡放回抽牌堆底部
    this.nextCardId = this.drawPile.shift();
  }

  // 手牌中是否有某卡
  hasCard(cardId) {
    return this.hand.indexOf(cardId);
  }

  decide() {
    const game = this.game;
    const enemies = game.units.filter(u => u.side === SIDE_PLAYER && !u.dead);
    const myUnits = game.units.filter(u => u.side === this.side && !u.dead);
    const elixir = game.elixir[this.side];

    // 1. 检测威胁:已过河或即将过河的敌方单位,特别是针对我方塔的
    const threats = this.identifyThreats(enemies);

    // 2. 若有威胁,优先防守 counter
    if (threats.length > 0) {
      const action = this.pickDefense(threats, elixir);
      if (action) {
        this.execute(action);
        return;
      }
    }

    // 3. 法术补刀:敌方残血塔或聚集单位
    const spellAction = this.pickSpellFinish(enemies, elixir);
    if (spellAction) {
      this.execute(spellAction);
      return;
    }

    // 4. 进攻:圣水足够时发起
    const hasWincon = this.hand.some(id => ROLE.WIN_CON.includes(id));
    const hasTank = this.hand.some(id => ROLE.TANK.includes(id));
    const attackThreshold = hasTank ? 7 : (hasWincon ? 5 : 8);
    if (elixir >= attackThreshold || (elixir >= 5 && this.aggression > 0.6)) {
      const attack = this.pickAttack(myUnits, elixir);
      if (attack) {
        this.execute(attack);
        return;
      }
    }

    // 5. 低费时:若手牌有低费卡且接近满费,甩低费卡(避免溢出)
    if (elixir >= 9) {
      const cycle = this.pickCycle(enemies, elixir);
      if (cycle) {
        this.execute(cycle);
        return;
      }
    }
  }

  // 推进方向:AI(上方,side=1)向下 +y;玩家(下方,side=0)向上 -y
  get dir() { return this.side === 1 ? 1 : -1; }
  // 我方岸边靠河的 y(部署进攻起点,需在可部署区域内)
  get myBackY() { return this.side === 1 ? RIVER_Y1 - 2 : RIVER_Y2 + 2; }
  get myRiverEdgeY() { return this.side === 1 ? RIVER_Y1 - 1 : RIVER_Y2 + 1; }
  get sideName() { return this.side === 1 ? 'ai' : 'player'; }

  // 识别威胁:进入我方半场或正朝我方推进的敌方单位
  identifyThreats(enemies) {
    const threats = [];
    for (const e of enemies) {
      // 我方半场判定:AI(side=1)半场 y<RIVER_Y1;玩家(side=0)半场 y>RIVER_Y2
      const inMyHalf = this.side === 1
        ? (e.y < RIVER_Y1 + 1)
        : (e.y > RIVER_Y2 - 1);
      // 即将进入我方半场(河道靠我方一侧附近)
      const approaching = this.side === 1
        ? (e.y < RIVER_Y2 + 3 && e.y > RIVER_Y1 - 1)
        : (e.y > RIVER_Y1 - 3 && e.y < RIVER_Y2 + 1);
      if (!inMyHalf && !approaching) continue;
      // 威胁度
      let score = e.card.cost * 2 + (e.card.hp / 100);
      if (e.card.targets === T.BUILDING) score *= 1.5;
      if (e.flying) score *= 1.2;
      const nearestTower = this.nearestMyTower(e);
      score += (20 - dist(e, nearestTower)) * 2;
      threats.push({ unit: e, score });
    }
    threats.sort((a, b) => b.score - a.score);
    return threats;
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

  // 选择防守动作
  pickDefense(threats, elixir) {
    const threat = threats[0];
    const e = threat.unit;
    const cardId = e.card.id;

    // 查 counter 表
    const counters = COUNTERS[cardId] || [];
    // 优先选手牌中有的 counter
    for (const c of counters) {
      const idx = this.hasCard(c);
      if (idx < 0) continue;
      const cc = CARDS[c];
      if (elixir < cc.cost) continue;
      // 部署位置:在威胁单位前方(我方塔与威胁之间)
      const pos = this.defensePosition(e, c);
      if (!pos) continue;
      return { cardId: c, x: pos.x, y: pos.y, handIndex: idx, role: 'defense' };
    }

    // 无精确 counter,用通用防守:有威胁就用我方半场部署高性价比单位
    // 选手牌中能打该目标的最低费单位
    let bestIdx = -1, bestCost = Infinity;
    for (let i = 0; i < this.hand.length; i++) {
      const c = CARDS[this.hand[i]];
      if (c.kind !== KIND.TROOP && c.kind !== KIND.BUILDING) continue;
      if (c.cost > elixir) continue;
      // 能否打该目标(建筑视为地面目标)
      let valid;
      if (e.isBuilding) valid = (c.targets & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (c.targets & T.AIR) !== 0;
      else valid = (c.targets & T.GROUND) !== 0;
      if (!valid) continue;
      if (c.cost < bestCost) { bestCost = c.cost; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      const pos = this.defensePosition(e, this.hand[bestIdx]);
      if (pos) return { cardId: this.hand[bestIdx], x: pos.x, y: pos.y, handIndex: bestIdx, role: 'defense' };
    }
    return null;
  }

  // 防守部署位置:在威胁路径上、我方塔前方拦截
  defensePosition(threat, cardId) {
    const c = CARDS[cardId];
    const dir = this.dir; // 拦截点在威胁"前方"(威胁行进方向再往前)
    // 建筑放塔前
    if (c.kind === KIND.BUILDING) {
      const tower = this.nearestMyTower(threat);
      const dx = threat.x - tower.x, dy = threat.y - tower.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const px = tower.x + (dx/d) * 3.5;
      const py = tower.y + (dy/d) * 3.5;
      if (this.canPlace(px, py)) return { x: px, y: py };
      return { x: tower.x, y: tower.y + dir * 2 };
    }
    // 部队:在威胁行进方向前方拦截
    let py = threat.y + dir * 1.5;
    let px = threat.x;
    // 限制在我方半场
    if (this.side === 1) {
      if (py > RIVER_Y1 - 1) py = RIVER_Y1 - 1;
      if (py < 2) py = 2;
    } else {
      if (py < RIVER_Y2 + 1) py = RIVER_Y2 + 1;
      if (py > GRID_H - 2) py = GRID_H - 2;
    }
    px = Math.max(1, Math.min(GRID_W-1, px));
    return { x: px, y: py };
  }

  // AI 部署合法性(含卡牌级部署规则)
  canPlace(x, y, cardId) {
    const card = cardId ? CARDS[cardId] : null;
    return canDeploy(this.sideName, x, y, this.game.towers[1 - this.side], { zone: card && card.deployZone });
  }

  // 法术补刀/解场
  pickSpellFinish(enemies, elixir) {
    // 1. 残血塔补刀
    const enemyTowers = this.game.getEnemyTowers(this.side);
    for (const tw of enemyTowers) {
      if (tw.dead) continue;
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind !== KIND.SPELL) continue;
        if (!c.dmg) continue;
        if (elixir < c.cost) continue;
        // 火箭/雷电能秒残血塔
        if (tw.hp <= c.dmg && c.cost <= 6) {
          return { cardId: this.hand[i], x: tw.x, y: tw.y, handIndex: i, role: 'spell_finish' };
        }
      }
    }

    // 2. 聚集单位用法术解(群体)
    const clusters = this.findClusters(enemies, 2.5);
    for (const cluster of clusters) {
      if (cluster.units.length < 3) continue;
      for (let i = 0; i < this.hand.length; i++) {
        const c = CARDS[this.hand[i]];
        if (c.kind !== KIND.SPELL || !c.dmg) continue;
        if (elixir < c.cost) continue;
        // 法术能击杀大部分
        const willKill = cluster.units.filter(u => u.hp <= c.dmg).length;
        if (willKill >= cluster.units.length - 1 && willKill >= 2) {
          return { cardId: this.hand[i], x: cluster.cx, y: cluster.cy, handIndex: i, role: 'spell_clear' };
        }
      }
    }
    return null;
  }

  // 找聚集单位
  findClusters(units, r) {
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

  // 进攻选择
  pickAttack(myUnits, elixir) {
    const dir = this.dir;
    // 已有推进单位(过河)?补充后排
    const pushingTanks = myUnits.filter(u => ROLE.TANK.includes(u.cardId) &&
      (this.side === 1 ? u.y > RIVER_Y2 : u.y < RIVER_Y1));
    if (pushingTanks.length > 0) {
      for (let i = 0; i < this.hand.length; i++) {
        if (!ROLE.SUPPORT.includes(this.hand[i])) continue;
        const c = CARDS[this.hand[i]];
        if (elixir < c.cost) continue;
        const tank = pushingTanks[0];
        // 放在坦克后方(我方一侧)
        const px = tank.x, py = tank.y - dir * 2;
        if (this.canPlace(px, py)) {
          return { cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'support' };
        }
      }
    }

    // 选最弱的敌方公主塔
    const enemyTowers = this.game.getEnemyTowers(this.side).filter(t => !t.dead && t.type === 'princess');
    if (enemyTowers.length === 0) return null;
    const target = enemyTowers.sort((a,b) => a.hp - b.hp)[0];
    const laneX = target.x;

    // 坦克推进:部署在我方岸边靠河处
    for (let i = 0; i < this.hand.length; i++) {
      if (!ROLE.TANK.includes(this.hand[i])) continue;
      const c = CARDS[this.hand[i]];
      if (elixir < c.cost) continue;
      const px = laneX;
      const py = this.myBackY;
      if (this.canPlace(px, py)) {
        return { cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'tank_push' };
      }
    }

    // 快攻(win con)
    if (elixir >= 5) {
      for (let i = 0; i < this.hand.length; i++) {
        if (!ROLE.WIN_CON.includes(this.hand[i])) continue;
        const c = CARDS[this.hand[i]];
        if (elixir < c.cost) continue;
        const px = laneX;
        const py = this.myRiverEdgeY;
        if (this.canPlace(px, py)) {
          return { cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'wincon' };
        }
      }
    }

    return null;
  }

  // 低费卡避免溢出(法术必须有实际目标才有价值,空放=浪费圣水,因此过牌只甩部队/建筑)
  pickCycle(enemies, elixir) {
    for (let i = 0; i < this.hand.length; i++) {
      const c = CARDS[this.hand[i]];
      // 法术不参与过牌:万箭/电击等砸空地纯属送费
      if (c.kind === KIND.SPELL) continue;
      if (c.cost <= 3 && c.cost > 0 && elixir >= c.cost) {
        const px = enemies.length > 0 ? enemies[0].x : 9;
        const py = this.myRiverEdgeY;
        if (this.canPlace(px, py)) {
          return { cardId: this.hand[i], x: px, y: py, handIndex: i, role: 'cycle' };
        }
      }
    }
    return null;
  }

  execute(action) {
    const card = CARDS[action.cardId];
    const ok = this.game.playCard(this.side, action.cardId, action.x, action.y);
    if (ok) {
      // 全面日志:记录 AI 的每次行动
      const roleNames = {
        defense: '防守', support: '支援', tank_push: '坦克推进', wincon: '快攻',
        cycle: '过牌', spell_finish: '法术补刀', spell_clear: '法术解场'
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

  // 供外部设置卡组
  setDeck(deck) {
    this.deck = deck.slice();
    this.drawHand();
  }
}
