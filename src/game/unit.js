// ===============================================
// 单位类 - 部队/建筑实例
// ===============================================
import { CARDS, KIND } from '../data/cards.js';
import { RAGE_MULT } from '../core/constants.js';

let _uid = 1;

export class Unit {
  constructor(cardId, side, x, y) {
    this.uid = _uid++;
    this.card = CARDS[cardId];
    this.cardId = cardId;
    this.side = side; // 0=玩家, 1=AI
    this.x = x;
    this.y = y;
    this.hp = this.card.hp;
    this.maxHp = this.card.hp;
    this.dmg = this.card.dmg;
    this.radius = this.card.radius || 0.4;

    // 计时器
    // 攻击冷却:出生时种 firstHit(官方 First Hit Speed 攻击前摇——
    // wiki 统计表逐卡数值;C++ 同概念 initialCooldownTicks/seedCooldown,
    // 仅 spawn 时种一次,换目标不重罚)
    this.atkCD = this.card.firstHit != null ? this.card.firstHit : 0;
    this.deployTimer = this.card.deployTime || 0; // 部署延迟
    this.lifetime = this.card.lifetime || 0; // 存活时间(建筑)
    this.isBuilding = this.card.kind === KIND.BUILDING;
    this.isSpell = false;

    // 目标
    this.target = null; // {type:'unit'|'tower', ref, x, y}

    // ===== 状态计时器(全部在 game.updateUnits 顶部统一递减;
    // 新状态机制的字段加在这里,不要散到各系统)=====
    this.frozen = 0;      // 冰冻剩余秒(时间停止:不动/不索敌/冷却暂停)
    this.stunned = 0;     // 眩晕剩余秒(同冰冻,打断充能)
    this.rageTimer = 0;   // 狂暴剩余秒(移速/攻速/伤害 ×RAGE_MULT)
    this.slowTimer = 0;   // 减速剩余秒(冰法师攻击/落地)
    this.slowFactor = 1;  // 减速系数(0.7 = -30%)
    this.curseTimer = 0;  // 诅咒剩余秒(受击加深,伤害管线第2段)
    this.curseMult = 1;   // 诅咒受击乘区
    this.invulnUntil = 0; // 无敌帧截止 game.time(伤害管线第1段)
    this.dead = false;

    // 护盾(黑王子/皇家卫队):受击先扣盾,盾碎溢出伤害不穿透本体
    this.shield = (this.card.special && this.card.special.shield) || 0;
    this.maxShield = this.shield;

    // 特殊:冲锋(王子)
    this.chargeTimer = 0; // 累计直行距离(格),走满 charge.distance 触发冲锋
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
    if (this.rageTimer > 0) s *= RAGE_MULT;
    if (this.slowTimer > 0) s *= this.slowFactor;
    if (this.charged && this.card.special && this.card.special.charge) {
      s *= this.card.special.charge.speedMult;
    }
    return s;
  }
  get hitSpeed() {
    let hs = this.card.hitSpeed;
    if (this.rageTimer > 0) hs /= RAGE_MULT;
    if (this.slowTimer > 0) hs /= this.slowFactor;   // 减速同样降低攻速
    return hs;
  }
  get currentDmg() {
    let d = this.dmg;
    if (this.rageTimer > 0) d *= RAGE_MULT;
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
