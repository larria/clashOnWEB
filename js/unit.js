// ===============================================
// 单位类 - 部队/建筑实例
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  let _uid = 1;

  class Unit {
    constructor(cardId, side, x, y) {
      this.uid = _uid++;
      this.card = CR.CARDS[cardId];
      this.cardId = cardId;
      this.side = side; // 0=玩家, 1=AI
      this.x = x;
      this.y = y;
      this.hp = this.card.hp;
      this.maxHp = this.card.hp;
      this.dmg = this.card.dmg;
      this.radius = this.card.radius || 0.4;

      // 计时器
      this.atkCD = 0;          // 攻击冷却
      this.deployTimer = this.card.deployTime || 0; // 部署延迟
      this.lifetime = this.card.lifetime || 0; // 存活时间(建筑)
      this.isBuilding = this.card.kind === CR.KIND.BUILDING;
      this.isSpell = false;

      // 目标
      this.target = null; // {type:'unit'|'tower', ref, x, y}

      // 状态
      this.frozen = 0;      // 冰冻剩余秒
      this.stunned = 0;     // 眩晕剩余秒
      this.rageTimer = 0;   // 狂暴剩余秒
      this.dead = false;

      // 移动方向缓存
      this.movingTarget = null;

      // 特殊:冲锋(王子)
      this.chargeTimer = 0; // 持续直行时间,用于触发冲锋
      this.charged = false; // 当前是否已冲锋

      // 地狱塔:伤害递增
      this.rampMult = 1.0;
      this.rampTimer = 0;

      // 召唤/产出计时器
      this.specialTimer = 0;

      // 击退位移(瞬时)
      this.knockX = 0;
      this.knockY = 0;

      // 攻击动画
      this.atkAnim = 0;
    }

    get flying() { return !!this.card.flying; }
    get speed() {
      let s = this.card.speed || 0;
      if (this.rageTimer > 0) s *= 1.35;
      if (this.charged && this.card.special && this.card.special.charge) {
        s *= this.card.special.charge.speedMult;
      }
      return s;
    }
    get hitSpeed() {
      let hs = this.card.hitSpeed;
      if (this.rageTimer > 0) hs /= 1.35;
      return hs;
    }
    get currentDmg() {
      let d = this.dmg;
      if (this.rageTimer > 0) d *= 1.35;
      if (this.charged && this.card.special && this.card.special.charge) {
        d *= this.card.special.charge.dmgMult;
      }
      if (this.card.special && this.card.special.rampDamage) {
        d *= this.rampMult;
      }
      return d;
    }

    get canAct() {
      return this.deployTimer <= 0 && this.frozen <= 0 && this.stunned <= 0 && !this.dead;
    }
  }

  CR.Unit = Unit;
})(window.CR);
