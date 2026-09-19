// ===============================================
// 游戏主类 - 状态、更新循环、胜负判定
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  class Game {
    constructor() {
      this.units = [];
      this.effects = [];
      this.towers = { 0: {}, 1: {} };
      this.elixir = { 0: 5, 1: 5 };
      this.elixirFloat = { 0: 5, 1: 5 };
      this.time = 0;
      this.doubleElixir = false;
      this.lastPlayedCard = null;
      this.winner = null; // 0/1/null
      this.gameOver = false;
      this.onTowerDestroyedCb = null;
      this.initTowers();
    }

    initTowers() {
      // side 0 = player, 1 = ai
      for (const side of [0, 1]) {
        const tw = CR.TOWERS[side === 0 ? 'player' : 'ai'];
        this.towers[side].left = new CR.Tower(side, 'left', tw.left);
        this.towers[side].right = new CR.Tower(side, 'right', tw.right);
        this.towers[side].king = new CR.Tower(side, 'king', tw.king);
      }
    }

    addUnit(u) { this.units.push(u); }
    addEffect(e) { this.effects.push(e); }

    getEnemyTowers(side) {
      const eSide = 1 - side;
      const t = this.towers[eSide];
      return [t.left, t.right, t.king];
    }

    getAliveEnemyTowers(side) {
      return this.getEnemyTowers(side).filter(t => !t.dead);
    }

    onTowerDestroyed(tower) {
      if (this.onTowerDestroyedCb) this.onTowerDestroyedCb(tower);
      // 检查胜负
      this.checkWin();
    }

    checkWin() {
      // 国王塔被摧毁即败
      if (this.towers[0].king.dead) { this.winner = 1; this.gameOver = true; }
      else if (this.towers[1].king.dead) { this.winner = 0; this.gameOver = true; }
    }

    // 主更新
    update(dt) {
      if (this.gameOver) return;
      this.time += dt;

      // 双倍圣水(3分钟后,简化为2分钟)
      if (this.time > 120 && !this.doubleElixir) {
        this.doubleElixir = true;
        if (CR.log) CR.log('⚡ 双倍圣水开启!', 'sys');
      }

      // 圣水回复
      const rate = CR.ELIXIR_RATE * (this.doubleElixir ? 2 : 1);
      this.elixirFloat[0] = Math.min(CR.MAX_ELIXIR, this.elixirFloat[0] + rate * dt);
      this.elixirFloat[1] = Math.min(CR.MAX_ELIXIR, this.elixirFloat[1] + rate * dt);
      this.elixir[0] = Math.floor(this.elixirFloat[0]);
      this.elixir[1] = Math.floor(this.elixirFloat[1]);

      // 更新单位
      this.updateTowers(dt);
      this.updateUnits(dt);
      this.updateEffects(dt);

      // 清理死亡单位
      this.units = this.units.filter(u => !u.dead);

      // 超时判定(3分钟后比塔血,简化:总时长180秒)
      if (this.time >= 180 && !this.gameOver) {
        this.decideByDamage();
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
      const crowns0 = (this.towers[1].left.dead?1:0) + (this.towers[1].right.dead?1:0) + (this.towers[1].king.dead?1:0);
      const crowns1 = (this.towers[0].left.dead?1:0) + (this.towers[0].right.dead?1:0) + (this.towers[0].king.dead?1:0);
      if (crowns0 > crowns1) { this.winner = 0; }
      else if (crowns1 > crowns0) { this.winner = 1; }
      else if (s0 > s1) { this.winner = 0; }
      else if (s1 > s0) { this.winner = 1; }
      else { this.winner = -1; } // 平局
      this.gameOver = true;
      if (CR.log) {
        CR.log(`⏰ 时间到!皇冠 ${crowns0} : ${crowns1},塔血 ${Math.round(s0)} : ${Math.round(s1)}`, 'sys');
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
          if (tw.rageTimer > 0) tw.rageTimer -= dt;
          if (tw.atkCD > 0) tw.atkCD -= dt;
          if (tw.atkAnim > 0) tw.atkAnim -= dt;
          if (tw.shotFlash > 0) tw.shotFlash -= dt;
          if (!tw.canAct) continue;

          // 索敌
          if (!tw.target || tw.target.ref.dead || CR.dist(tw, tw.target.ref) > tw.range + 1) {
            tw.target = this.findTowerTarget(tw);
          }
          if (tw.target) {
            // 记录瞄准方向(用于渲染状态)
            const tRef = tw.target.ref;
            tw.aimAngle = Math.atan2(tRef.y - tw.y, tRef.x - tw.x);
            const d = CR.dist(tw, tw.target.ref);
            if (d <= tw.range + tw.target.ref.radius) {
              if (tw.atkCD <= 0) {
                const dmg = tw.dmg * (tw.rageTimer > 0 ? 1.35 : 1);
                if (tw.target.type === 'unit') CR.dealDamage(tw.target.ref, dmg, this, tw);
                else CR.dealTowerDamage(tw.target.ref, dmg, this);
                tw.atkCD = tw.hitSpeed;
                tw.atkAnim = 0.25;
                // 记录弹道(射击方向与目标位置,用于渲染)
                tw.shotFlash = 0.25;
                tw.shotTarget = { x: tRef.x, y: tRef.y };
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
        if (e.isBuilding) valid = (tw.targets & (CR.T.BUILDING | CR.T.GROUND)) !== 0;
        else if (e.flying) valid = (tw.targets & CR.T.AIR) !== 0;
        else valid = (tw.targets & CR.T.GROUND) !== 0;
        if (!valid) continue;
        const d = CR.dist(tw, e);
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
            // 死亡召唤(墓碑/野蛮人小屋):到期自然消亡同样触发
            if (u.card.special && u.card.special.deathSummon) {
              const ds = u.card.special.deathSummon;
              const positions = CR.getDeployPositions(u.x, u.y, ds.count, 0.3);
              for (let i = 0; i < ds.count; i++) {
                const nu = new CR.Unit(ds.card, u.side, positions[i].x, positions[i].y);
                this.addUnit(nu);
              }
            }
            continue;
          }
        }

        // 特殊:产兵建筑
        if (u.card.special) {
          const sp = u.card.special;
          if (sp.spawn) {
            // 首波较快(firstDelay),之后按 interval 循环
            u.specialTimer += dt;
            const first = sp.spawn.firstDelay != null ? sp.spawn.firstDelay : sp.spawn.interval;
            const due = u.spawnedOnce ? sp.spawn.interval : first;
            if (u.specialTimer >= due) {
              u.specialTimer = 0;
              u.spawnedOnce = true;
              for (let i = 0; i < sp.spawn.count; i++) {
                const nu = new CR.Unit(sp.spawn.card, u.side, u.x, u.y + (u.side === 0 ? -0.8 : 0.8));
                this.addUnit(nu);
              }
            }
          }
          if (sp.produceElixir) {
            u.specialTimer += dt;
            if (u.specialTimer >= sp.produceElixir.interval) {
              u.specialTimer = 0;
              this.elixirFloat[u.side] = Math.min(CR.MAX_ELIXIR, this.elixirFloat[u.side] + sp.produceElixir.amount);
            }
          }
          if (sp.summon && u.deployTimer <= 0) { // 女巫召唤骷髅
            u.specialTimer += dt;
            if (u.specialTimer >= sp.summon.interval) {
              u.specialTimer = 0;
              for (let i = 0; i < sp.summon.count; i++) {
                const nu = new CR.Unit(sp.summon.card, u.side, u.x + (Math.random()-0.5), u.y + (u.side===0?-1:1)*0.5);
                this.addUnit(nu);
              }
            }
          }
        }

        if (!u.canAct) continue;

        // 索敌(如果当前目标失效)
        if (u.target && (u.target.ref.dead || CR.dist(u, u.target.ref) > (u.card.range + u.target.ref.radius + 1))) {
          u.target = null;
        }
        if (!u.target) {
          u.target = CR.findTarget(u, this);
        } else {
          // 行军中(未进入攻击范围)重新索敌:
          // 若出现更近的敌方单位,转移目标(模拟 CR 中行军部队会攻击路过的新敌人)
          const dCur = CR.dist(u, u.target.ref);
          const effRange = u.card.range + u.target.ref.radius;
          if (dCur > effRange) {
            const nearer = CR.findNearestEnemyUnit(u, this);
            if (nearer && CR.dist(u, nearer) < dCur) {
              u.target = { type: 'unit', ref: nearer, x: nearer.x, y: nearer.y, flying: nearer.flying, isBuilding: nearer.isBuilding };
            }
          }
        }

        if (u.target) {
          const d = CR.dist(u, u.target.ref);
          const effRange = u.card.range + u.target.ref.radius;
          if (d <= effRange) {
            // 在攻击范围,攻击
            if (u.atkCD <= 0) {
              CR.attackTarget(u, u.target, this);
              u.atkCD = u.hitSpeed;
              // 充能重置(攻击后取消冲锋)
              if (u.charged) { u.charged = false; u.chargeTimer = 0; }
            }
          } else {
            // 不在范围,移动接近
            CR.moveUnit(u, this, dt);
            // 移动后若脱离充能方向,重置充能
            if (!u.charged) u.chargeTimer = 0;
          }
        } else {
          // 无目标,推进
          CR.moveUnit(u, this, dt);
          if (!u.charged) u.chargeTimer = 0;
        }
      }
      // 单位碰撞分离:地面单位互不重叠,后进单位被挤出(模拟 CR 部队互相阻挡)
      this.separateUnits();
    }

    // 地面单位碰撞分离(每帧移动后调用)
    // 飞行单位不参与(空中);建筑是静态障碍,把单位挤出
    separateUnits() {
      const movers = this.units.filter(u => !u.dead && !u.flying && !u.isBuilding && u.deployTimer <= 0);
      const solids = this.units.filter(u => !u.dead && !u.flying && u.isBuilding);
      // 1. 单位 vs 建筑静态挤出
      for (const m of movers) {
        for (const b of solids) {
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
      const nx = Math.max(u.radius, Math.min(CR.GRID_W - u.radius, u.x + dx));
      let ny = u.y + dy;
      // 河道限制(地面单位只能走桥)
      if (CR.isRiver(nx, ny) && !CR.isBridge(nx, ny)) {
        // 尝试仅 y 不动
        if (!CR.isRiver(u.x, u.y + dy) || CR.isBridge(u.x, u.y + dy)) {
          ny = u.y + dy;
        } else {
          ny = u.y; // 保持原 y
        }
      }
      ny = Math.max(u.radius, Math.min(CR.GRID_H - u.radius, ny));
      u.x = nx;
      u.y = ny;
    }

    updateEffects(dt) {
      for (const e of this.effects) e.life -= dt;
      this.effects = this.effects.filter(e => e.life > 0);
    }

    // 玩家/AI 出牌
    playCard(side, cardId, x, y) {
      const card = CR.CARDS[cardId];
      if (!card) return false;

      // 镜像法术费用 = 上一张牌费用 + 1
      let cost = card.cost;
      if (card.special && card.special.mirror) {
        const last = this.lastPlayedCard;
        if (!last || last === 'mirror') return false;
        cost = CR.CARDS[last].cost + 1;
      }
      if (this.elixir[side] < cost) return false;

      // 法术可全场释放;部队/建筑只能在己方半场
      if (card.kind === CR.KIND.SPELL) {
        CR.castSpell(cardId, side, x, y, this);
      } else {
        const ok = CR.deployCard(cardId, side, x, y, this);
        if (!ok) return false;
      }

      this.elixirFloat[side] -= cost;
      this.elixir[side] = Math.floor(this.elixirFloat[side]);
      return true;
    }
  }

  CR.Game = Game;
})(window.CR);
