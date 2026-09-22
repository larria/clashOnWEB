// ===============================================
// 塔类 - 公主塔/国王塔
// ===============================================
import { TOWER_STATS, RAGE_MULT } from '../core/constants.js';

let _tid = 1;

export class Tower {
  constructor(side, lane, pos) {
    this.uid = 'T' + (_tid++);
    this.side = side; // 0=玩家,1=AI
    this.lane = lane; // 'left'|'right'|'king'
    this.x = pos.x;
    this.y = pos.y;
    this.type = pos.type;
    const st = TOWER_STATS[pos.type];
    this.hp = st.hp;
    this.maxHp = st.hp;
    this.dmg = st.dmg;
    this._hitSpeed = st.hitSpeed;
    this.range = st.range;
    this.sightRange = st.sightRange;
    this.targets = st.targets;
    this.radius = st.radius;
    this.atkCD = 0;
    this.target = null;
    this.frozen = 0;
    this.stunned = 0;
    this.rageTimer = 0;
    this.atkAnim = 0;
    // 攻击状态渲染
    this.aimAngle = null;   // 当前瞄准方向(有目标时)
    this.shotFlash = 0;     // 射击闪光剩余时间
    this.shotTarget = null; // 最近一次射击目标位置(弹道)
    this.isTower = true;
    this.dead = false;
    // 国王塔默认未激活:某侧公主塔被摧毁、或国王塔自身受到伤害时激活
    // 公主塔始终激活
    this.activated = (pos.type !== 'king');
  }
  get canAct() { return this.activated && this.frozen <= 0 && this.stunned <= 0 && !this.dead; }
  get hitSpeed() { return this.rageTimer > 0 ? this._hitSpeed / RAGE_MULT : this._hitSpeed; }
  // 受到伤害:国王塔被击中即激活
  onDamaged() {
    if (!this.activated) this.activated = true;
  }
}
