// ===============================================
// 塔类 - 公主塔/国王塔
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  let _tid = 1;

  class Tower {
    constructor(side, lane, pos) {
      this.uid = 'T' + (_tid++);
      this.side = side; // 0=玩家,1=AI
      this.lane = lane; // 'left'|'right'|'king'
      this.x = pos.x;
      this.y = pos.y;
      this.type = pos.type;
      const st = CR.TOWER_STATS[pos.type];
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
      this.activated = (pos.type === 'king'); // 国王塔默认激活,公主塔被摧毁会激活同侧国王塔(此处简化:始终激活)
    }
    get canAct() { return this.frozen <= 0 && this.stunned <= 0 && !this.dead; }
    get hitSpeed() { return this.rageTimer > 0 ? this._hitSpeed / 1.35 : this._hitSpeed; }
  }

  CR.Tower = Tower;
})(window.CR);
