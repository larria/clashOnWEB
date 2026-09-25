// ===============================================
// 投射物实体系统(机制底盘,规格 §6.1 对照 C++ Projectile.h)
//
// 设计(对照参考实现的取舍):
//   - 弱引用追踪:target 死亡 → 投射物自灭,不找替身(C++ 同款)
//   - 命中吸附:一步内到达(dist ≤ speed*dt)→ 位置吸附命中点再结算
//   - on-hit 随弹飞行:attackSlow 等命中效果在到达时施加(而非出手时)
//   - 塔与远程单位共用(塔箭 = 投射物,消除"塔瞬发"差异)
//   - 溅射投射物:命中点为圆心的范围伤害(法师/炸弹兵)
//
// 不做(当前无卡需要,需要时再加):
//   回旋镖(处刑者)/穿透线(保龄球手)/分裂箭——
//   P1 批次实装时在本文件扩展,结算回调机制已预留(payload)
//
// 出于重放确定性:无随机,纯追踪运动
// ===============================================

export class Projectile {
  // target: { ref } 弱引用式目标对象(与单位/塔的 target 同构)
  // opts: { speed, dmg, splash, targets, onHit: {slow:{duration,factor}}, color }
  constructor(side, x, y, target, opts) {
    this.side = side;
    this.x = x;
    this.y = y;
    this.target = target;          // { type:'unit'|'tower', ref }
    this.speed = opts.speed || 12; // 格/秒(塔箭 12 ≈ C++ 1.2格/tick×10)
    this.dmg = opts.dmg;
    this.splash = opts.splash || 0;
    this.targets = opts.targets;   // 溅射目标掩码(单发不检查——只打锁定目标)
    this.onHit = opts.onHit || null; // 命中时施加的效果(attackSlow 等)
    this.color = opts.color || '#ffee58';
    this.attacker = opts.attacker || null; // 发射者(伤害归属/受击音效用)
    this.dead = false;
    this.isProjectile = true;
    // 视觉轨迹(渲染层画拖尾):记录最近位置
    this.trail = [];
  }

  update(game, dt) {
    const t = this.target && this.target.ref;
    if (!t || t.dead) { this.dead = true; return; }
    const dx = t.x - this.x, dy = t.y - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = this.speed * dt;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 5) this.trail.shift();
    if (d <= step) {
      // 命中吸附:落在目标当前位置
      this.x = t.x; this.y = t.y;
      this._land(game, t);
      this.dead = true;
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  // 命中结算:伤害(单发/溅射)+ on-hit 效果
  _land(game, t) {
    if (this.splash > 0) {
      game.applyAreaDamageAt(this.x, this.y, this.dmg, this.splash, this.targets, this.side, 1, null, false);
    } else if (this.target.type === 'unit') {
      game.dealDamage(t, this.dmg, this.attacker);
    } else {
      game.dealTowerDamage(t, this.dmg);
    }
    // on-hit 效果(冰法师减速等):命中才施加
    if (this.onHit && this.onHit.slow && !t.dead) {
      if (this.target.type === 'unit') {
        game.applySlowAt(this.x, this.y, this.splash || 0.5, this.side,
          this.onHit.slow.duration, this.onHit.slow.factor);
      } else if (t.slowTimer !== undefined) {
        // 塔被减速(攻速降低)
        if (t.slowTimer < this.onHit.slow.duration) { t.slowTimer = this.onHit.slow.duration; t.slowFactor = this.onHit.slow.factor; }
      }
    }
    game.addEffect({
      type: 'hitBurst', x: this.x, y: this.y, r: this.splash || 0.4,
      life: 0.2, maxLife: 0.2,
    });
  }
}
