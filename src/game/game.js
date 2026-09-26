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
  MATCH_TIME, DOUBLE_ELIXIR_AT, OVERTIME, TRIPLE_ELIXIR_AT, dist, isRiver, isBridge, canDeploy,
} from '../core/constants.js';
import { makeRng } from '../core/rng.js';
import { CARDS, KIND } from '../data/cards.js';
import { EventBus } from '../core/events.js';
import { Tower } from './tower.js';
import { Unit } from './unit.js';
import { tickPeriodic, applyDeathAbilities, tickTransform } from './abilities.js';
import { Projectile } from './projectile.js';
import { getDeployPositions } from './formation.js';
import { findTarget, findNearestEnemyUnit, getMarchTarget, moveUnit, attackTarget } from './combat.js';
import { castSpell, deployCard, updateRolls } from './spells.js';
import { tickKnockback as tickKnock } from './movement.js';

export class Game {
  constructor(opts = {}) {
    this.bus = new EventBus();          // 本局事件总线
    this.units = [];
    this.projectiles = [];              // 投射物(塔箭/远程弹道;规格 §6.1)
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
  // 特效入队(性能护栏:超上限时丢弃低频视觉特效,防止大团战
  // 法术齐爆时 effects 数组膨胀拖慢渲染;伤害等逻辑不走这里不受影响)
  addEffect(e) {
    if (this.effects.length >= 40) {
      // 满了:优先丢"非关键"的(脚步/水花/攻击闪光类短命特效)
      const dropIdx = this.effects.findIndex(f =>
        f.type === 'jumpDust' || f.type === 'jumpLand' || f.type === 'shotTrail' ||
        f.type === 'meleeSlash' || f.type === 'elixirPop' || f.type === 'spellIcon');
      if (dropIdx >= 0) this.effects.splice(dropIdx, 1);
      else return;   // 全是关键特效:不再入队
    }
    this.effects.push(e);
  }
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
  // 伤害管线定序(规格 §5.7,对齐 C++ CombatEntity::takeDamage):
  //   1. 无敌帧(冲锋过半程等) → 完全免疫
  //   2. 诅咒乘区(受击加深)
  //   3. 招架(格挡本次攻击,不消耗护盾)
  //   4. 护盾(先扣盾;溢出不穿透)
  //   5. 扣血 + 受击触发器
  // 各段位由 unit 上的可选字段驱动(未实装的机制字段不存在 = 跳过该段),
  // 新状态机制加进这里,禁止在调用方预判。
  dealDamage(unit, dmg, attacker, sourceCard) {
    if (unit.dead || dmg <= 0) return;
    // 1. 无敌帧(飞贼冲刺/弓箭女王隐身等;invulnUntil 为 game.time 戳)
    if (unit.invulnUntil && this.time < unit.invulnUntil) return;
    // 2. 诅咒乘区(巫婆诅咒类:受击伤害加深;curseMult 缺省 1)
    if (unit.curseTimer > 0 && unit.curseMult > 1) {
      dmg = dmg * unit.curseMult;
    }
    // 3. 招架(武僧类:间隔性完全格挡一次攻击,不消耗护盾)
    if (unit.parryReady) {
      unit.parryReady = false;
      this.addEffect({ type: 'hitBurst', x: unit.x, y: unit.y, r: unit.radius + 0.2, life: 0.3, maxLife: 0.3 });
      return;   // 完全格挡
    }
    // 4. 护盾(黑王子类):本次伤害全部由盾承担(最多吸到盾空),
    //    溢出部分不穿透本体(官方:雷电1056打240盾,溢出816完全无效)
    if (unit.shield > 0) {
      const absorbed = Math.min(unit.shield, dmg);
      unit.shield -= absorbed;
      if (unit.shield <= 0) {
        this.addEffect({ type: 'shieldBreak', x: unit.x, y: unit.y, r: unit.radius + 0.3, life: 0.35, maxLife: 0.35 });
      }
      this.bus.emit('unit:damaged', { unit, dmg: absorbed, attacker });
      return;   // 盾在场时不掉本体血
    }
    // 5. 扣血
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

  // 治疗(带上限;规格 §2 P1 治疗系底盘——治疗法术/治疗精灵/凤凰复用)
  // 特效暂用受击 hitBurst 占位(视觉区分留给治疗系卡实装时做专属 greenPulse)
  healUnit(unit, amount) {
    if (unit.dead || amount <= 0) return;
    unit.hp = Math.min(unit.maxHp, unit.hp + amount);
    this.addEffect({ type: 'hitBurst', x: unit.x, y: unit.y, r: unit.radius, life: 0.3, maxLife: 0.3 });
    this.bus.emit('unit:healed', { unit, amount });
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
  // hurtAlly: 是否伤害同阵营单位。死亡炸弹(骷髅巨人/气球/戈仑)是中立
  // 爆炸物,伤双方=true;冰法落地伤害等友军技能只伤敌方=false(默认)
  applyAreaDamage(source, dmg, radius, targetsMask, hurtAlly = false) {
    this.applyAreaDamageAt(source.x, source.y, dmg, radius, targetsMask, source.side, 1, source, hurtAlly);
  }

  // 区域减速(冰法师攻击/落地):范围内敌方单位移动+攻击减速
  // (factor=0.7 即 -30%;持续取最大值不叠加)
  applySlowAt(cx, cy, radius, side, duration, factor) {
    for (const e of this.units) {
      if (e.dead || e.side === side) continue;
      const d = dist2s(cx, cy, e.x, e.y);
      if (d <= (radius + e.radius) * (radius + e.radius)) {
        if (e.slowTimer < duration) { e.slowTimer = duration; e.slowFactor = factor; }
      }
    }
  }

  // 按坐标的区域伤害(延时炸弹爆炸;towerMult:对塔伤害倍率)
  // hurtAlly: 同阵营单位是否受伤(死亡炸弹=true 中立爆炸;友军技能=false)
  applyAreaDamageAt(cx, cy, dmg, radius, targetsMask, side, towerMult = 1, source, hurtAlly = false) {
    for (const e of this.units) {
      if (e.dead || e === source) continue;
      if (!hurtAlly && e.side === side) continue;   // 友军技能不误伤同阵营
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
    if (this.gameOver) {
      // 终局清空在飞投射物(update 已停,不清会悬停在画面上)
      this.projectiles.length = 0;
      this.bus.emit('match:end', { winner: this.winner, reason: 'king' });
    }
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
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    updateRolls(this, dt);   // 滚木扫掠推进(在单位更新后,与法术结算同步)

    // 清理死亡单位与失效投射物
    this.units = this.units.filter(u => !u.dead);
    this.projectiles = this.projectiles.filter(p => !p.dead);

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
    this.projectiles.length = 0;   // 终局清空在飞投射物
    this.bus.emit('log', { who: 'sys', msg: `⏰ 时间到!皇冠 ${crowns0} : ${crowns1},塔血 ${Math.round(s0)} : ${Math.round(s1)}` });
    this.bus.emit('match:end', { winner: this.winner, reason: 'time' });
  }

  // ===== 攻击判定共享(Unit/Tower 双轨统一;规格 §3.1 偿债)=====
  // 单位与塔的攻击循环此前两份实现,每加一个状态机制要改两遍且会分叉
  // (历史 bug:公主塔攻击不到刚过河单位)。现统一为一组判定函数,
  // 塔与单位只保留各自的状态字段与渲染字段,判定逻辑单一来源。
  //
  // 目标是否失效(死亡/走远):缓冲 0.25 格,与攻击范围衔接
  isTargetLost(attacker, target) {
    if (!target || target.ref.dead) return true;
    return dist(attacker, target.ref) > attacker.radius + this.attackRangeOf(attacker) + target.ref.radius + 0.25;
  }
  // 攻击者有效射程(塔用 range,单位用 card.range)
  attackRangeOf(attacker) {
    return attacker.isTower ? attacker.range : attacker.card.range;
  }
  // 是否在攻击范围内(边缘到边缘口径:双方半径+射程)
  // kamikaze 单位例外:用溅射半径作为触发距离(贴脸自爆——官方精灵
  // 冲到敌人身前爆开,range 2.5 是锁定距离而非起爆距离)
  inAttackRange(attacker, target) {
    const kami = !attacker.isTower && attacker.card && attacker.card.special && attacker.card.special.kamikaze;
    const range = kami ? (attacker.card.splash || 1.5) : this.attackRangeOf(attacker);
    return dist(attacker, target.ref) <= attacker.radius + range + target.ref.radius;
  }

  // ===== 投射物系统(规格 §6.1)=====
  // 塔与远程单位共用;发射即入列,命中由 Projectile 自身结算
  fireProjectile(from, target, opts) {
    const p = new Projectile(from.side, from.x, from.y, target,
      Object.assign({ attacker: from }, opts));
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.dead) p.update(this, dt);
    }
  }

  updateTowers(dt) {
    for (const side of [0, 1]) {
      const ts = this.towers[side];
      for (const k of ['left','right','king']) {
        const tw = ts[k];
        if (tw.dead) continue;
        if (tw.frozen > 0) tw.frozen -= dt;
        if (tw.stunned > 0) tw.stunned -= dt;
        if (tw.slowTimer > 0) tw.slowTimer -= dt;
        if (tw.rageTimer > 0) tw.rageTimer -= dt;
        // 同单位:冻结/眩晕中攻击冷却暂停
        if (tw.atkCD > 0 && tw.frozen <= 0 && tw.stunned <= 0) tw.atkCD -= dt;
        if (tw.atkAnim > 0) tw.atkAnim -= dt;
        if (tw.shotFlash > 0) tw.shotFlash -= dt;
        if (!tw.canAct) continue;

        // 索敌(共享判定)
        if (this.isTargetLost(tw, tw.target)) {
          tw.target = this.findTowerTarget(tw);
        }
        if (tw.target) {
          const tRef = tw.target.ref;
          tw.aimAngle = Math.atan2(tRef.y - tw.y, tRef.x - tw.x);
          if (this.inAttackRange(tw, tw.target)) {
            if (tw.atkCD <= 0) {
              const dmg = tw.dmg * (tw.rageTimer > 0 ? RAGE_MULT : 1);
              // 塔箭 = 投射物(规格 §6.1:追踪+命中结算,不再瞬发)
              this.fireProjectile(tw, tw.target, { speed: 12, dmg, color: '#ffe082' });
              tw.atkCD = tw.hitSpeed;
              tw.atkAnim = 0.25;
              tw.shotFlash = 0.25;
              tw.shotTarget = { x: tRef.x, y: tRef.y };
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
    let best = null, bd = Infinity;
    const enemies = this.units.filter(u => u.side !== tw.side && !u.dead);
    // 有效视野 = max(sight, range),判定含双方半径(与攻击判定同口径):
    // 索敌绝不低于攻击触及,否则"打得着却看不见"(单位侧 findTarget
    // 同规则;塔侧原先不含目标半径,大体积单位在视野边缘不被索敌)
    const sight = Math.max(tw.sightRange, tw.range);
    for (const e of enemies) {
      // 塔可打地面/空中(看塔 targets;建筑视为地面目标)
      let valid;
      if (e.isBuilding) valid = (tw.targets & (T.BUILDING | T.GROUND)) !== 0;
      else if (e.flying) valid = (tw.targets & T.AIR) !== 0;
      else valid = (tw.targets & T.GROUND) !== 0;
      if (!valid) continue;
      const d = dist(tw, e);
      if (d <= tw.radius + sight + e.radius && d < bd) { bd = d; best = { type:'unit', ref:e }; }
    }
    return best;
  }

  updateUnits(dt) {
    for (const u of this.units) {
      if (u.dead) continue;

      // 计时器
      if (u.deployTimer > 0) {
        u.deployTimer -= dt;
        // 部署完成瞬间:落地伤害(冰法师类——部署时对周围敌人
        // 造成范围伤害+减速,官方 spawn damage)
        if (u.deployTimer <= 0 && u.card.special && u.card.special.spawnDamage) {
          const sd = u.card.special.spawnDamage;
          this.applyAreaDamage(u, sd.dmg, sd.radius, u.card.targets);
          // 落地减速(可独立时长;默认与攻击减速一致)
          const slow = sd.slow != null ? sd.slow : (u.card.special.attackSlow || null);
          if (slow) this.applySlowAt(u.x, u.y, sd.radius, u.side, slow.duration, slow.factor);
          this.addEffect({ type: 'spawnFrost', x: u.x, y: u.y, r: sd.radius, life: 0.5, maxLife: 0.5 });
          this.bus.emit('unit:spawnDamage', { unit: u });
        }
      }
      // ===== 击退补间(硬直):滑动推进,期间完全跳过下方一切行为
      // (索敌/攻击/移动;攻击前摇被打断——atkCD 不再递减,落地重新计)。
      // 状态计时器在补间前照常递减:被击退的冰冻单位若在补间期间暂停
      // frozen 倒数,冻结会被净延长整个补间时长(0.45-0.5s)=====
      if (u._knock && !u.dead) {
        if (u.frozen > 0) u.frozen -= dt;
        if (u.stunned > 0) u.stunned -= dt;
        if (u.curseTimer > 0) u.curseTimer -= dt;
        tickKnock(u, dt);
        continue;
      }
      if (u.knockUntil > this.time) continue;   // 补间已结束但硬直尾帧

      // ===== 状态计时器统一递减(规格 §5.6:集中一处,禁止散落)=====
      if (u.frozen > 0) u.frozen -= dt;
      if (u.stunned > 0) u.stunned -= dt;
      if (u.rageTimer > 0) u.rageTimer -= dt;
      if (u.slowTimer > 0) u.slowTimer -= dt;
      if (u.curseTimer > 0) u.curseTimer -= dt;
      // 攻击冷却:冻结/眩晕中暂停恢复(时间停止语义,对齐规格 §5.6
      // ——冻结期间 cd 按 freezeSlow=0 即不恢复;电击重置地狱塔充能
      // 的机制也依赖"控制期间攻击进度不走")
      if (u.atkCD > 0 && u.frozen <= 0 && u.stunned <= 0) u.atkCD -= dt;
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
          // 到期自然消亡同样触发全部死亡能力(炸弹塔到期爆炸/墓碑召唤)
          applyDeathAbilities(u, this);
          continue;
        }
      }

      // 特殊:周期能力(产兵/召唤/产圣水)。
      // 冰冻/眩晕中暂停产能(对齐 CR);部署延时中也暂停(spawn 路径
      // 原先不查 deployTimer,与 summon 路径规则不一致)
      if (u.canAct) tickPeriodic(u, this, dt);

      // 变形检查(hp 阈值触发,伤害结算后每帧查;部署/冰冻中同样生效——
      // 变形不是行动,是被动响应)
      tickTransform(u, this);

      if (!u.canAct) continue;

      // 索敌(共享判定:isTargetLost/inAttackRange,与塔同源)
      if (this.isTargetLost(u, u.target)) {
        u.target = null;
      }
      if (!u.target) {
        u.target = findTarget(u, this);
      } else {
        // 行军中(未进入攻击范围)重新索敌:
        // 若出现更近的敌方单位,转移目标(模拟 CR 中行军部队会攻击路过的新敌人)
        if (!this.inAttackRange(u, u.target)) {
          const nearer = findNearestEnemyUnit(u, this);
          if (nearer && dist(u, nearer) < dist(u, u.target.ref)) {
            u.target = { type: 'unit', ref: nearer, x: nearer.x, y: nearer.y, flying: nearer.flying, isBuilding: nearer.isBuilding };
          }
        }
      }

      if (u.target) {
        if (this.inAttackRange(u, u.target)) {
          // 在攻击范围,攻击
          if (u.atkCD <= 0) {
            attackTarget(u, u.target, this);
            u.atkCD = u.hitSpeed;
            // 充能重置(攻击命中后取消冲锋并清零累计距离——
            // 原版需重新直行 2 格才能再次冲锋;此前只取消状态
            // 不清进度,杀完敌立即快充导致二次冲锋间隔过短)
            if (u.charged) { u.charged = false; }
            if (u.card.special && u.card.special.charge) u.chargeTimer = 0;
            // 攻击事件(音效订阅;target/distance 供命中音区分目标类型
            // 并按弹飞行时间延迟,音画同步)
            this.bus.emit('unit:attack', { attacker: u, target: u.target.ref,
              isTower: false, isKing: false, distance: dist(u, u.target.ref) });
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
          // 径向推出 + re-clamp(挤出可能把单位推进河/出界——
          // 分离不守边界,钳制统一兜底;pushUnit 内含河/界约束)
          this.pushUnit(m, (dx/d) * minD - dx, (dy/d) * minD - dy);
        } else if (d <= 0.001) {
          this.pushUnit(m, 0, minD); // 完全重合,向下弹出
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
              // 沿连线各退一半 + 切向微扰(规格 §4.2:C++ 同款 noise——
              // 两只单位相向走进同一条走廊时,纯径向推挤会与移动力
              // 每帧精确抵消,部队原地锁死(战报:4 哥布林沉底 12s 不动);
              // 切向分量让它们沿彼此滑开绕行,恢复自然分流)
              const push = (minD - d) / 2;
              const nx = dx/d, ny = dy/d;
              const noise = 0.01;
              this.pushUnit(a, -nx*push + ny*noise, -ny*push - nx*noise);
              this.pushUnit(b,  nx*push - ny*noise,  ny*push + nx*noise);
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

    // 法术可全场释放;部队/建筑按卡牌部署规则(canDeploy 解释 deployZone)。
    // 例外:滚木类 deployZone:'riverbanks' 法术——canDeploy 会判定其
    // "己方半场+河带"限制(官方:滚木只能部署己方半场)
    if (card.kind === KIND.SPELL) {
      if (card.deployZone && card.deployZone !== 'anywhere') {
        // 非常规部署区法术(riverbanks):先做区域校验,失败不扣费
        if (!canDeploy(side === 0 ? 'player' : 'ai', x, y, this.towers[1 - side],
          { zone: card.deployZone })) return false;
      }
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
