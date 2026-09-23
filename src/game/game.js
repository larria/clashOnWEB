// ===============================================
// 游戏主类 - 状态、更新循环、胜负判定、延迟结算
//
// 架构约定:
//   - Game 不 import 任何 UI;对外沟通全部通过 this.bus 事件
//   - schedule(delay, fn):延迟结算队列(法术动画延时/攻击前后摇的扩展点)
//   - 伤害结算统一走 dealDamage/dealTowerDamage(死亡效果由 abilities 接管)
// ===============================================
import {
  T, GRID_W, GRID_H, TOWERS, MAX_ELIXIR, ELIXIR_RATE, RAGE_MULT,
  MATCH_TIME, DOUBLE_ELIXIR_AT, OVERTIME, TRIPLE_ELIXIR_AT, dist, isRiver, isBridge,
} from '../core/constants.js';
import { makeRng } from '../core/rng.js';
import { CARDS, KIND } from '../data/cards.js';
import { EventBus } from '../core/events.js';
import { Tower } from './tower.js';
import { Unit } from './unit.js';
import { tickPeriodic, applyDeathAbilities, applyExpireAbilities } from './abilities.js';
import { getDeployPositions } from './formation.js';
import { findTarget, findNearestEnemyUnit, getMarchTarget, moveUnit, attackTarget } from './combat.js';
import { castSpell, deployCard } from './spells.js';

export class Game {
  constructor(opts = {}) {
    this.bus = new EventBus();          // 本局事件总线
    this.units = [];
    this.effects = [];                  // 视觉特效队列(渲染层消费)
    this.towers = { 0: {}, 1: {} };
    this.elixir = { 0: 5, 1: 5 };
    this.elixirFloat = { 0: 5, 1: 5 };
    this.time = 0;
    this.doubleElixir = false;
    this.tripleElixir = false;          // 加时最后 1 分钟三倍圣水
    this.overtime = false;              // 加时(sudden death:先推塔者胜)
    this.aiElixirMult = 1;              // AI 圣水产生倍率(噩梦难度 1.5;由应用层按难度注入)
    this.lastPlayedCard = { 0: null, 1: null }; // 各自上一张出的牌(镜像只复制己方)
    this.winner = null; // 0/1/-1/null
    this.gameOver = false;
    this._timers = [];                  // 延迟结算队列 {due, fn}
    // 本局 RNG:引擎内随机(洗牌等)必须走它;记录 seed 即可确定性重放
    this.rng = opts.rng || makeRng(opts.seed);
    this.initTowers();
  }

  initTowers() {
    // side 0 = player, 1 = ai
    for (const side of [0, 1]) {
      const tw = TOWERS[side === 0 ? 'player' : 'ai'];
      this.towers[side].left = new Tower(side, 'left', tw.left);
      this.towers[side].right = new Tower(side, 'right', tw.right);
      this.towers[side].king = new Tower(side, 'king', tw.king);
    }
  }

  // ===== 延迟结算(法术动画延时/攻击前后摇的扩展点)=====
  // 游戏时间尺度(暂停时冻结),与渲染动画解耦
  schedule(delay, fn) {
    this._timers.push({ due: this.time + delay, fn });
  }
  _runTimers() {
    if (!this._timers.length) return;
    // 到期的执行,未到期保留
    const ready = this._timers.filter(t => t.due <= this.time);
    if (ready.length) {
      this._timers = this._timers.filter(t => t.due > this.time);
      for (const t of ready) {
        try { t.fn(); } catch (e) { console.error('[Game.schedule]', e); }
      }
    }
  }

  // ===== 实体工厂 =====
  addUnit(u) { this.units.push(u); }
  spawnUnit(cardId, side, x, y) {
    const u = new Unit(cardId, side, x, y);
    this.addUnit(u);
    this.bus.emit('unit:deployed', { unit: u });
    return u;
  }
  addEffect(e) { this.effects.push(e); }
  getDeployPositions(cx, cy, count, r) { return getDeployPositions(cx, cy, count, r); }

  addElixir(side, amount, source) {
    this.elixirFloat[side] = Math.min(MAX_ELIXIR, this.elixirFloat[side] + amount);
    this.bus.emit('elixir:produced', { side, amount, source });
    // 视觉:圣水滴从收集器升起(渲染层消费)
    if (source && !source.dead) {
      this.addEffect({ type: 'elixirPop', x: source.x, y: source.y, life: 0.8, maxLife: 0.8, side });
    }
  }

  getEnemyTowers(side) {
    const eSide = 1 - side;
    const t = this.towers[eSide];
    return [t.left, t.right, t.king];
  }

  getAliveEnemyTowers(side) {
    return this.getEnemyTowers(side).filter(t => !t.dead);
  }

  // ===== 伤害结算(唯一入口;死亡效果由 abilities 接管)=====
  dealDamage(unit, dmg, attacker, sourceCard) {
    if (unit.dead) return;
    // 护盾(黑王子类):先扣盾,盾碎的溢出伤害不穿透本体
    // (官方机制:雷电 1056 打在 240 盾上,溢出 816 完全无效)
    if (unit.shield > 0) {
      // 有盾:本次伤害全部由盾承担(最多吸到盾空),溢出部分不穿透本体
      // (官方机制:雷电 1056 打在 240 盾上,溢出 816 完全无效)
      const absorbed = Math.min(unit.shield, dmg);
      unit.shield -= absorbed;
      if (unit.shield <= 0) {
        this.addEffect({ type: 'shieldBreak', x: unit.x, y: unit.y, r: unit.radius + 0.3, life: 0.35, maxLife: 0.35 });
      }
      this.bus.emit('unit:damaged', { unit, dmg: absorbed, attacker });
      return;   // 盾在场时不掉本体血
    }
    unit.hp -= dmg;
    this.bus.emit('unit:damaged', { unit, dmg, attacker }); // 受击音效
    // 受击迸发特效(同一单位 0.15s 内不重复,防止群攻刷屏)
    if (!unit._hitFxAt || this.time - unit._hitFxAt > 0.15) {
      unit._hitFxAt = this.time;
      this.addEffect({ type: 'hitBurst', x: unit.x, y: unit.y, r: unit.radius, life: 0.25, maxLife: 0.25 });
    }
    if (unit.hp <= 0) {
      unit.hp = 0;
      unit.dead = true;
      // 死亡碎裂特效(渲染层画碎裂粒子;属性快照供粒子取色)
      this.addEffect({
        type: 'deathBreak', cardId: unit.cardId, side: unit.side,
        x: unit.x, y: unit.y, r: unit.radius,
        color: unit.card.color, big: unit.card.cost >= 5 && !unit.isBuilding,
        isBuilding: unit.isBuilding,
        life: 0.5, maxLife: 0.5,
      });
      this.bus.emit('unit:killed', { unit, attacker, sourceCard });
      applyDeathAbilities(unit, this);
    }
  }

  dealTowerDamage(tower, dmg) {
    if (tower.dead) return;
    tower.hp -= dmg;
    tower.onDamaged(); // 国王塔受到任何伤害(含法术)即激活
    this.bus.emit('tower:damaged', { tower, dmg });
    // 塔受击迸发(节流同单位)
    if (!tower._hitFxAt || this.time - tower._hitFxAt > 0.15) {
      tower._hitFxAt = this.time;
      this.addEffect({ type: 'hitBurst', x: tower.x, y: tower.y, r: tower.radius, life: 0.25, maxLife: 0.25 });
    }
    if (tower.hp <= 0) {
      tower.hp = 0;
      tower.dead = true;
      this.onTowerDeath(tower);
    }
  }

  // 区域伤害(死亡伤害等;对双方单位生效 + 敌方塔)
  applyAreaDamage(source, dmg, radius, targetsMask) {
    this.applyAreaDamageAt(source.x, source.y, dmg, radius, targetsMask, source.side, 1, source);
  }

  // 按坐标的区域伤害(延时炸弹爆炸;towerMult:对塔伤害倍率)
  applyAreaDamageAt(cx, cy, dmg, radius, targetsMask, side, towerMult = 1, source) {
    for (const e of this.units) {
      if (e.dead || e === source) continue;
      let valid;
      if (e.isBuilding) valid = (targetsMask & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (targetsMask & T.AIR) !== 0;
      else valid = (targetsMask & T.GROUND) !== 0;
      if (!valid) continue;
      const d = dist2s(cx, cy, e.x, e.y);
      if (d <= (radius + e.radius) * (radius + e.radius)) {
        this.dealDamage(e, dmg, source);
      }
    }
    // 塔(只伤害施放方的敌方塔;支持 towerMult 如骷髅巨人双倍)
    const towers = this.getEnemyTowers(side);
    for (const tw of towers) {
      if (tw.dead) continue;
      const d = dist2s(cx, cy, tw.x, tw.y);
      if (d <= (radius + tw.radius) * (radius + tw.radius)) {
        this.dealTowerDamage(tw, dmg * towerMult);
      }
    }
  }

  onTowerDeath(tower) {
    // 塔摧毁爆炸特效(冲击环+碎石飞溅;渲染层另做屏幕震动)
    this.addEffect({
      type: 'towerExplode', side: tower.side,
      x: tower.x, y: tower.y, r: tower.radius,
      isKing: tower.type === 'king',
      life: 0.9, maxLife: 0.9,
    });
    // 公主塔被摧毁 → 激活同方国王塔
    if (tower.type === 'princess') {
      const king = this.towers[tower.side].king;
      if (king && !king.dead && !king.activated) {
        king.activated = true;
        // 激活特效:金光迸发 + 光柱冲天
        this.addEffect({ type: 'kingActivate', x: king.x, y: king.y, r: king.radius, life: 1.1, maxLife: 1.1 });
        this.bus.emit('king:activated', { tower: king });
        this.bus.emit('log', { who: 'sys', msg: (tower.side === 0 ? '你的' : 'AI的') + '国王塔被激活!' });
      }
    }
    const myCrowns = this._crowns(1);
    const aiCrowns = this._crowns(0);
    this.bus.emit('tower:destroyed', { tower, myCrowns, aiCrowns });
    this.checkWin();
  }

  _crowns(side) {
    const t = this.towers[side];
    return (t.left.dead?1:0) + (t.right.dead?1:0) + (t.king.dead?1:0);
  }

  checkWin() {
    // 已终局不再重判(同帧内 splash/延时炸弹连拆多塔会重复 emit match:end)
    if (this.gameOver) return;
    // 国王塔被摧毁即败
    if (this.towers[0].king.dead) { this.winner = 1; this.gameOver = true; }
    else if (this.towers[1].king.dead) { this.winner = 0; this.gameOver = true; }
    if (this.gameOver) this.bus.emit('match:end', { winner: this.winner, reason: 'king' });
  }

  // ===== 主更新 =====
  update(dt) {
    if (this.gameOver) return;
    this.time += dt;
    this._runTimers();

    // 双倍圣水
    if (this.time > DOUBLE_ELIXIR_AT && !this.doubleElixir) {
      this.doubleElixir = true;
      this.bus.emit('log', { who: 'sys', msg: '⚡ 双倍圣水开启!' });
      this.bus.emit('match:phase', { phase: 'double_elixir' });
    }
    // 加时最后 1 分钟三倍圣水
    if (this.overtime && this.time >= TRIPLE_ELIXIR_AT && !this.tripleElixir) {
      this.tripleElixir = true;
      this.bus.emit('log', { who: 'sys', msg: '⚡⚡ 加时三倍圣水!' });
      this.bus.emit('match:phase', { phase: 'triple_elixir' });
    }
    // 常规时间最后 1 分钟警告(只发一次)
    if (!this._warned60 && this.time >= MATCH_TIME - 60 && this.time < MATCH_TIME) {
      this._warned60 = true;
      this.bus.emit('match:phase', { phase: 'last_minute' });
    }

    // 圣水回复(AI 侧乘难度倍率:噩梦 ×1.5)
    const rate = ELIXIR_RATE * (this.tripleElixir ? 3 : (this.doubleElixir ? 2 : 1));
    this.elixirFloat[0] = Math.min(MAX_ELIXIR, this.elixirFloat[0] + rate * dt);
    this.elixirFloat[1] = Math.min(MAX_ELIXIR, this.elixirFloat[1] + rate * this.aiElixirMult * dt);
    this.elixir[0] = Math.floor(this.elixirFloat[0]);
    this.elixir[1] = Math.floor(this.elixirFloat[1]);

    // 更新实体
    this.updateTowers(dt);
    this.updateUnits(dt);
    this.updateEffects(dt);

    // 清理死亡单位
    this.units = this.units.filter(u => !u.dead);

    // 常规时间结束:皇冠领先即胜;平皇冠进加时(sudden death)
    if (!this.overtime && this.time >= MATCH_TIME && !this.gameOver) {
      const crowns0 = this._crowns(1); // 玩家皇冠
      const crowns1 = this._crowns(0); // AI 皇冠
      if (crowns0 !== crowns1) {
        this.decideByDamage();
      } else {
        // 平皇冠 → 加时;快照公主塔存活状态——加时只对"加时开始后
        // 新被摧毁"的塔判 sudden death(1:1 平皇冠进场时已有塔是死的)
        this.overtime = true;
        this._otDead = {
          0: { left: this.towers[0].left.dead, right: this.towers[0].right.dead },
          1: { left: this.towers[1].left.dead, right: this.towers[1].right.dead },
        };
        this.bus.emit('log', { who: 'sys', msg: '⏱ 常规时间结束,皇冠持平 — 进入加时(先摧毁任意塔者胜)!' });
        this.bus.emit('match:phase', { phase: 'overtime' });
      }
    }
    // 加时中任意塔被摧毁 → 塔方立即判负(onTowerDeath → checkWin 已处理国王塔;
    // 公主塔需在此判定;排除加时开始前就已摧毁的塔)
    if (this.overtime && !this.gameOver) {
      const newDead = (s) => {
        const t = this.towers[s];
        const o = this._otDead[s];
        return (t.left.dead && !o.left) || (t.right.dead && !o.right);
      };
      if (newDead(1)) { this.winner = 0; this.gameOver = true; this.bus.emit('match:end', { winner: 0, reason: 'overtime' }); }
      else if (newDead(0)) { this.winner = 1; this.gameOver = true; this.bus.emit('match:end', { winner: 1, reason: 'overtime' }); }
      // 加时耗尽 → 最低塔血者负(简化 tiebreaker)
      else if (this.time >= MATCH_TIME + OVERTIME) {
        this.decideByDamage();
      }
    }
  }

  decideByDamage() {
    // 比较双方剩余公主塔+国王塔血量
    const sum = (side) => {
      const t = this.towers[side];
      return (t.left.dead ? 0 : t.left.hp) + (t.right.dead ? 0 : t.right.hp) + (t.king.dead ? 0 : t.king.hp);
    };
    const s0 = sum(0), s1 = sum(1);
    // 摧毁公主塔数比较
    const crowns0 = this._crowns(1);
    const crowns1 = this._crowns(0);
    if (crowns0 > crowns1) { this.winner = 0; }
    else if (crowns1 > crowns0) { this.winner = 1; }
    else if (s0 > s1) { this.winner = 0; }
    else if (s1 > s0) { this.winner = 1; }
    else { this.winner = -1; } // 平局
    this.gameOver = true;
    this.bus.emit('log', { who: 'sys', msg: `⏰ 时间到!皇冠 ${crowns0} : ${crowns1},塔血 ${Math.round(s0)} : ${Math.round(s1)}` });
    this.bus.emit('match:end', { winner: this.winner, reason: 'time' });
  }

  updateTowers(dt) {
    for (const side of [0, 1]) {
      const ts = this.towers[side];
      for (const k of ['left','right','king']) {
        const tw = ts[k];
        if (tw.dead) continue;
        if (tw.frozen > 0) tw.frozen -= dt;
        if (tw.stunned > 0) tw.stunned -= dt;
        if (tw.rageTimer > 0) tw.rageTimer -= dt;
        if (tw.atkCD > 0) tw.atkCD -= dt;
        if (tw.atkAnim > 0) tw.atkAnim -= dt;
        if (tw.shotFlash > 0) tw.shotFlash -= dt;
        if (!tw.canAct) continue;

        // 索敌(弃目标阈值与攻击范围衔接,缓冲 0.25 格——与单位侧一致,
        // 旧 +1 缓冲会让目标在"打不到也不换"区间卡住)
        if (!tw.target || tw.target.ref.dead || dist(tw, tw.target.ref) > tw.range + tw.target.ref.radius + 0.25) {
          tw.target = this.findTowerTarget(tw);
        }
        if (tw.target) {
          // 记录瞄准方向(用于渲染状态)
          const tRef = tw.target.ref;
          tw.aimAngle = Math.atan2(tRef.y - tw.y, tRef.x - tw.x);
          const d = dist(tw, tw.target.ref);
          if (d <= tw.range + tw.target.ref.radius) {
            if (tw.atkCD <= 0) {
              const dmg = tw.dmg * (tw.rageTimer > 0 ? RAGE_MULT : 1);
              if (tw.target.type === 'unit') this.dealDamage(tw.target.ref, dmg, tw);
              else this.dealTowerDamage(tw.target.ref, dmg);
              tw.atkCD = tw.hitSpeed;
              tw.atkAnim = 0.25;
              // 记录弹道(射击方向与目标位置,用于渲染)
              tw.shotFlash = 0.25;
              tw.shotTarget = { x: tRef.x, y: tRef.y };
              // 攻击事件(音效订阅;isKing 区分国王塔)
              this.bus.emit('unit:attack', { attacker: tw, isTower: true, isKing: tw.type === 'king' });
            }
          }
        } else {
          tw.aimAngle = null;
        }
      }
    }
  }

  findTowerTarget(tw) {
    let best = null, bd = tw.sightRange;
    const enemies = this.units.filter(u => u.side !== tw.side && !u.dead);
    for (const e of enemies) {
      // 塔可打地面/空中(看塔 targets;建筑视为地面目标)
      let valid;
      if (e.isBuilding) valid = (tw.targets & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (tw.targets & T.AIR) !== 0;
      else valid = (tw.targets & T.GROUND) !== 0;
      if (!valid) continue;
      const d = dist(tw, e);
      if (d <= bd) { bd = d; best = { type:'unit', ref:e }; }
    }
    return best;
  }

  updateUnits(dt) {
    for (const u of this.units) {
      if (u.dead) continue;

      // 计时器
      if (u.deployTimer > 0) u.deployTimer -= dt;
      if (u.frozen > 0) u.frozen -= dt;
      if (u.stunned > 0) u.stunned -= dt;
      if (u.rageTimer > 0) u.rageTimer -= dt;
      if (u.atkCD > 0) u.atkCD -= dt;
      if (u.atkAnim > 0) u.atkAnim -= dt;

      // 建筑存活时间:血量随剩余时间线性衰减(CR 建筑机制)
      if (u.lifetime > 0) {
        u.lifetime -= dt;
        // 每秒衰减 = 最大血量 / 总存活时间
        const decay = u.maxHp * dt / u.card.lifetime;
        u.hp -= decay;
        if (u.lifetime <= 0 || u.hp <= 0) {
          u.hp = Math.max(0, u.hp);
          u.dead = true;
          // 死亡特效/事件与被击杀路径统一(否则建筑无声消失)
          this.addEffect({
            type: 'deathBreak', cardId: u.cardId, side: u.side,
            x: u.x, y: u.y, r: u.radius, color: u.card.color,
            big: false, isBuilding: true, life: 0.5, maxLife: 0.5,
          });
          this.bus.emit('unit:killed', { unit: u, attacker: null });
          // 到期自然消亡同样触发死亡召唤
          applyExpireAbilities(u, this);
          continue;
        }
      }

      // 特殊:周期能力(产兵/召唤/产圣水)。
      // 冰冻/眩晕中暂停产能(对齐 CR);部署延时中也暂停(spawn 路径
      // 原先不查 deployTimer,与 summon 路径规则不一致)
      if (u.canAct) tickPeriodic(u, this, dt);

      if (!u.canAct) continue;

      // 索敌(如果当前目标失效)
      // 失效阈值 = 攻击范围 + 0.25 格小缓冲:官方行为是锁定后贴身追击
      // 当前位置,只有真走远才弃目标重索(旧 +1 格缓冲让目标在
      // "攻击范围外一点点"时既打不到也不换目标,造成边界抖动)
      if (u.target && (u.target.ref.dead || dist(u, u.target.ref) > (u.card.range + u.target.ref.radius + 0.25))) {
        u.target = null;
      }
      if (!u.target) {
        u.target = findTarget(u, this);
      } else {
        // 行军中(未进入攻击范围)重新索敌:
        // 若出现更近的敌方单位,转移目标(模拟 CR 中行军部队会攻击路过的新敌人)
        const dCur = dist(u, u.target.ref);
        const effRange = u.card.range + u.target.ref.radius;
        if (dCur > effRange) {
          const nearer = findNearestEnemyUnit(u, this);
          if (nearer && dist(u, nearer) < dCur) {
            u.target = { type: 'unit', ref: nearer, x: nearer.x, y: nearer.y, flying: nearer.flying, isBuilding: nearer.isBuilding };
          }
        }
      }

      if (u.target) {
        const d = dist(u, u.target.ref);
        const effRange = u.card.range + u.target.ref.radius;
        if (d <= effRange) {
          // 在攻击范围,攻击
          if (u.atkCD <= 0) {
            attackTarget(u, u.target, this);
            u.atkCD = u.hitSpeed;
            // 充能重置(攻击命中后取消冲锋并清零累计距离——
            // 原版需重新直行 2 格才能再次冲锋;此前只取消状态
            // 不清进度,杀完敌立即快充导致二次冲锋间隔过短)
            if (u.charged) { u.charged = false; }
            if (u.card.special && u.card.special.charge) u.chargeTimer = 0;
            // 攻击事件(音效订阅)
            this.bus.emit('unit:attack', { attacker: u, isTower: false, isKing: false });
          }
        } else {
          // 不在范围,移动接近(充能计时在 moveUnit 内累计)
          moveUnit(u, this, dt);
        }
      } else {
        // 无目标,推进
        moveUnit(u, this, dt);
      }
    }
    // 单位碰撞分离:地面单位互不重叠,后进单位被挤出(模拟 CR 部队互相阻挡)
    this.separateUnits();
  }

  // 地面单位碰撞分离(每帧移动后调用)
  // 飞行单位不参与(空中);建筑是静态障碍,把单位挤出。
  // 存活塔同样是静态障碍(塔不在 units 里,需单独纳入——
  // 此前单位会径直穿过公主塔)
  separateUnits() {
    const movers = this.units.filter(u => !u.dead && !u.flying && !u.isBuilding && u.deployTimer <= 0);
    const solids = this.units.filter(u => !u.dead && !u.flying && u.isBuilding);
    const towers = [];
    for (const side of [0, 1]) {
      for (const k of ['left', 'right', 'king']) {
        const tw = this.towers[side][k];
        if (!tw.dead) towers.push(tw);
      }
    }
    // 1. 单位 vs 建筑/塔静态挤出
    for (const m of movers) {
      for (const b of [...solids, ...towers]) {
        const minD = m.radius + b.radius;
        const dx = m.x - b.x, dy = m.y - b.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < minD && d > 0.001) {
          m.x = b.x + (dx/d) * minD;
          m.y = b.y + (dy/d) * minD;
        } else if (d <= 0.001) {
          m.y += minD; // 完全重合,向下弹出
        }
      }
    }
    // 2. 单位 vs 单位软分离(多次迭代收敛)
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < movers.length; i++) {
        for (let j = i+1; j < movers.length; j++) {
          const a = movers[i], b = movers[j];
          const minD = a.radius + b.radius;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d < minD) {
            if (d > 0.001) {
              // 沿连线各退一半
              const push = (minD - d) / 2;
              const nx = dx/d, ny = dy/d;
              this.pushUnit(a, -nx*push, -ny*push);
              this.pushUnit(b, nx*push, ny*push);
            } else {
              this.pushUnit(a, -0.1, 0);
              this.pushUnit(b, 0.1, 0);
            }
          }
        }
      }
    }
  }

  // 推动单位但不得进入河道(非桥)或出地图
  pushUnit(u, dx, dy) {
    const nx = Math.max(u.radius, Math.min(GRID_W - u.radius, u.x + dx));
    let ny = u.y + dy;
    // 河道限制(地面单位只能走桥)
    if (isRiver(nx, ny) && !isBridge(nx, ny)) {
      // 尝试仅 y 不动
      if (!isRiver(u.x, u.y + dy) || isBridge(u.x, u.y + dy)) {
        ny = u.y + dy;
      } else {
        ny = u.y; // 保持原 y
      }
    }
    ny = Math.max(u.radius, Math.min(GRID_H - u.radius, ny));
    u.x = nx;
    u.y = ny;
  }

  updateEffects(dt) {
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter(e => e.life > 0);
  }

  // 玩家/AI 出牌
  playCard(side, cardId, x, y) {
    const card = CARDS[cardId];
    if (!card) return false;

    // 镜像法术费用 = 己方上一张牌费用 + 1(镜像只复制己方上一张,对齐 CR)
    let cost = card.cost;
    if (card.special && card.special.mirror) {
      const last = this.lastPlayedCard[side];
      if (!last || last === 'mirror') return false;
      cost = CARDS[last].cost + 1;
    }
    if (this.elixir[side] < cost) return false;

    // 法术可全场释放;部队/建筑按卡牌部署规则(canDeploy 解释 deployZone)
    if (card.kind === KIND.SPELL) {
      // 法术本体全场可放;但镜像复制的部队/建筑可能因部署位非法失败——
      // 失败不扣费(否则圣水蒸发无反馈)
      const spellOk = castSpell(cardId, side, x, y, this);
      if (!spellOk) return false;
    } else {
      const ok = deployCard(cardId, side, x, y, this);
      if (!ok) return false;
    }

    this.elixirFloat[side] -= cost;
    // 下限保护:浮点边界下扣费可能轻微透支(如 9.99 圣水放 10 费镜像)
    if (this.elixirFloat[side] < 0) this.elixirFloat[side] = 0;
    this.elixir[side] = Math.floor(this.elixirFloat[side]);
    this.bus.emit('card:played', { side, cardId, x, y, kind: card.kind });
    return true;
  }
}

// 内部工具:平方距离(避免与 constants.dist2 的导入混用命名)
function dist2s(ax, ay, bx, by) {
  const dx = ax-bx, dy = ay-by;
  return dx*dx + dy*dy;
}
