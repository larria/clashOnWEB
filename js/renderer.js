// ===============================================
// 渲染器 - Canvas 精致绘制
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const CELL = CR.CELL;
  const PAL = CR.PAL;
  const GFX = CR.GFX;

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;
      canvas.width = CR.CANVAS_W;
      canvas.height = CR.CANVAS_H;
      // 静态战场层缓存(离屏 canvas,避免每帧重绘草地纹理)
      this.arenaCache = null;
      this.animTime = 0;
      // 解锁区域当场闪烁提示 {lane, color:'r,g,b', until: 时间戳}
      this.unlockFlash = null;
    }

    draw(deployPreview, dt) {
      const ctx = this.ctx;
      this.animTime = (this.animTime || 0) + (dt || 0.016);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawArena();
      // 选中部队/建筑卡时:高亮全部可部署区域(法术全场有效,不高亮)
      const previewCard = deployPreview ? CR.CARDS[deployPreview.cardId] : null;
      const showDeployZone = previewCard && previewCard.kind !== CR.KIND.SPELL;
      if (showDeployZone) this.drawDeployZoneHighlight();
      // 解锁区当场闪烁(推塔后几秒内,不依赖选牌)
      this.drawUnlockFlash();
      this.drawTowers();
      this.drawUnits();
      this.drawEffects();
      if (deployPreview) this.drawPreview(deployPreview);
      this.drawVignette();
    }

    // 解锁区域当场闪烁(推塔瞬间触发,3 秒渐隐;期间脉冲呼吸)
    drawUnlockFlash() {
      const uf = this.unlockFlash;
      if (!uf || performance.now() > uf.until) { this.unlockFlash = null; return; }
      const ctx = this.ctx;
      const t = this.animTime;
      // 总进度 1→0
      const p = (uf.until - performance.now()) / 3200;
      // 脉冲 + 整体渐隐
      const alpha = (0.22 + 0.13 * Math.sin(t * 6)) * Math.min(1, p * 1.6);
      // 区域:敌方侧(玩家解锁) 或 己方侧(AI 解锁警示)
      // lane 决定 x 范围;颜色区分我方收益/敌方威胁
      const towers = this.game.towers;
      // 判断闪的是哪一侧区域:金色(我方解锁)显示 AI 半场该路;红色警示显示玩家半场该路
      const isGold = uf.color.indexOf('255,213') === 0;
      const x0 = uf.lane === 'left' ? 0 : 9;
      const w = 9;
      let y0, h;
      if (isGold) {
        y0 = 5; h = CR.RIVER_Y1 - 5;          // AI 半场该路(玩家新解锁区)
      } else {
        y0 = CR.RIVER_Y2; h = 27 - CR.RIVER_Y2; // 玩家半场该路(AI 新解锁区)
      }
      ctx.save();
      ctx.fillStyle = `rgba(${uf.color},${alpha})`;
      ctx.fillRect(x0*CELL+1, y0*CELL, w*CELL-2, h*CELL);
      ctx.strokeStyle = `rgba(${uf.color},${Math.min(1, alpha*3)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 30;
      ctx.strokeRect(x0*CELL+1, y0*CELL, w*CELL-2, h*CELL);
      ctx.setLineDash([]);
      // 区域文字
      ctx.globalAlpha = Math.min(1, p * 2) * (0.75 + 0.25*Math.sin(t*6));
      ctx.fillStyle = `rgba(${uf.color},0.95)`;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(isGold ? '🔓 新部署区' : '⚠️ 敌方可在此部署', (x0 + w/2)*CELL, (y0 + h/2)*CELL);
      ctx.restore();
    }

    // 可部署区域高亮(选中卡牌时):己方半场 + 推塔解锁区
    drawDeployZoneHighlight() {
      const ctx = this.ctx;
      const t = this.animTime;
      const enemyTowers = this.game.towers[1];
      ctx.save();
      // 呼吸透明度
      const breathe = 0.16 + 0.07 * Math.sin(t * 3);
      // 己方半场逐格绿色高亮(解锁区另行金色处理)
      for (let gy = CR.RIVER_Y2; gy < CR.GRID_H; gy += 0.5) {
        for (let gx = 0; gx < CR.GRID_W; gx += 0.5) {
          ctx.fillStyle = `rgba(100,220,140,${breathe})`;
          ctx.fillRect(gx*CELL, gy*CELL, CELL*0.5, CELL*0.5);
        }
      }
      // 区域描边:己方半场底线区域
      ctx.strokeStyle = `rgba(100,220,140,${0.35 + 0.15*Math.sin(t*3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, CR.RIVER_Y2*CELL, CR.CANVAS_W-2, (CR.GRID_H-CR.RIVER_Y2)*CELL);
      // 解锁区描边(如有):y 从塔前(5)到河岸排末尾(RIVER_Y1,含岸边整行)
      const unlock = [];
      if (enemyTowers.left.dead) unlock.push({x:0, w:9});
      if (enemyTowers.right.dead) unlock.push({x:9, w:9});
      const unlockTop = 5, unlockH = (CR.RIVER_Y1 - unlockTop); // 含岸排(y=14)整行
      for (const u of unlock) {
        // 解锁区金色微光填充
        ctx.fillStyle = `rgba(255,213,79,${breathe * 0.9})`;
        ctx.fillRect(u.x*CELL+1, unlockTop*CELL, u.w*CELL-2, unlockH*CELL);
        ctx.strokeStyle = `rgba(255,213,79,${0.5 + 0.2*Math.sin(t*3)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(u.x*CELL+1, unlockTop*CELL, u.w*CELL-2, unlockH*CELL);
        ctx.setLineDash([]);
        // 解锁区标记文字
        ctx.fillStyle = 'rgba(255,213,79,0.9)';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🔓 已解锁', (u.x + u.w/2)*CELL, (unlockTop + unlockH/2)*CELL);
      }
      ctx.restore();
    }

    // ===== 战场(带静态缓存) =====
    drawArena() {
      const ctx = this.ctx;
      if (!this.arenaCache) this.buildArenaCache();
      ctx.drawImage(this.arenaCache, 0, 0);
      // 动态河水(每帧):流动波光
      this.drawRiverAnim();
    }

    buildArenaCache() {
      const c = document.createElement('canvas');
      c.width = CR.CANVAS_W; c.height = CR.CANVAS_H;
      const ctx = c.getContext('2d');

      // --- 草地:双色棋盘格 + 双半场色差 ---
      for (let gy = 0; gy < CR.GRID_H; gy++) {
        for (let gx = 0; gx < CR.GRID_W; gx++) {
          const top = gy < CR.RIVER_Y1;
          const checker = (gx + gy) % 2 === 0;
          let col;
          if (top) col = checker ? PAL.grassA : PAL.grassB;
          else col = checker ? PAL.grassA2 : PAL.grassB2;
          ctx.fillStyle = col;
          ctx.fillRect(gx*CELL, gy*CELL, CELL, CELL);
        }
      }

      // --- 草地细碎纹理(随机小草点) ---
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      let seed = 12345;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < 260; i++) {
        const x = rnd() * CR.CANVAS_W, y = rnd() * CR.CANVAS_H;
        if (y > CR.RIVER_Y1*CELL && y < CR.RIVER_Y2*CELL) continue;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let i = 0; i < 200; i++) {
        const x = rnd() * CR.CANVAS_W, y = rnd() * CR.CANVAS_H;
        if (y > CR.RIVER_Y1*CELL && y < CR.RIVER_Y2*CELL) continue;
        ctx.fillRect(x, y, 2, 2);
      }

      // --- 河岸(上下边缘,立体感) ---
      const ry1 = CR.RIVER_Y1*CELL, ry2 = CR.RIVER_Y2*CELL;
      ctx.fillStyle = PAL.bank;
      ctx.fillRect(0, ry1 - 5, CR.CANVAS_W, 5);
      ctx.fillRect(0, ry2, CR.CANVAS_W, 5);
      ctx.fillStyle = PAL.bankDark;
      ctx.fillRect(0, ry1 - 2, CR.CANVAS_W, 2);
      ctx.fillRect(0, ry2 + 3, CR.CANVAS_W, 2);

      // --- 河水底色 ---
      const rg = ctx.createLinearGradient(0, ry1, 0, ry2);
      rg.addColorStop(0, PAL.riverDeep);
      rg.addColorStop(0.5, PAL.river);
      rg.addColorStop(1, PAL.riverDeep);
      ctx.fillStyle = rg;
      ctx.fillRect(0, ry1, CR.CANVAS_W, ry2 - ry1);

      // --- 桥(立体木桥) ---
      for (const bx of [...CR.BRIDGE_LEFT, ...CR.BRIDGE_RIGHT]) {
        const x = bx*CELL;
        // 桥体
        const bg = ctx.createLinearGradient(x, ry1, x+CELL, ry1);
        bg.addColorStop(0, PAL.bridgeLight); bg.addColorStop(0.5, PAL.bridge); bg.addColorStop(1, PAL.bridgeDark);
        ctx.fillStyle = bg;
        ctx.fillRect(x+1, ry1-4, CELL-2, (ry2-ry1)+8);
        // 桥板横纹
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let y = ry1; y < ry2+6; y += 7) ctx.fillRect(x+2, y, CELL-4, 2);
        // 桥栏
        ctx.fillStyle = PAL.bridgeDark;
        ctx.fillRect(x+1, ry1-4, 3, (ry2-ry1)+8);
        ctx.fillRect(x+CELL-4, ry1-4, 3, (ry2-ry1)+8);
      }

      // --- 塔位地基装饰(石板圆环) ---
      this.drawTowerPad(ctx, CR.TOWERS.player.left);
      this.drawTowerPad(ctx, CR.TOWERS.player.right);
      this.drawTowerPad(ctx, CR.TOWERS.player.king);
      this.drawTowerPad(ctx, CR.TOWERS.ai.left);
      this.drawTowerPad(ctx, CR.TOWERS.ai.right);
      this.drawTowerPad(ctx, CR.TOWERS.ai.king);

      this.arenaCache = c;
    }

    drawTowerPad(ctx, pos) {
      const x = pos.x*CELL, y = pos.y*CELL;
      const r = (pos.type === 'king' ? 1.25 : 1.05) * CELL;
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(x, y, r*0.82, 0, Math.PI*2); ctx.fill();
    }

    // 动态水波(每帧,错开相位)
    drawRiverAnim() {
      const ctx = this.ctx;
      const ry1 = CR.RIVER_Y1*CELL, ry2 = CR.RIVER_Y2*CELL;
      const t = this.animTime;
      ctx.save();
      // 流动波光带
      for (let row = 0; row < 3; row++) {
        const y = ry1 + 8 + row * ((ry2-ry1-10)/3);
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = PAL.riverLight;
        const off = (t * (18 + row*8)) % (CELL*4);
        for (let x = -CELL*4; x < CR.CANVAS_W + CELL*4; x += CELL*4) {
          const xx = x + off;
          ctx.beginPath();
          ctx.ellipse(xx, y, CELL*0.9, 2.2, 0, 0, Math.PI*2);
          ctx.fill();
        }
      }
      // 偶尔的高光点
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#bde3ff';
      for (let i = 0; i < 5; i++) {
        const phase = (t * 0.5 + i * 0.37) % 1;
        const x = ((i*337 + t*26) % CR.CANVAS_W);
        const y = ry1 + 6 + ((i*89) % (ry2-ry1-12));
        ctx.globalAlpha = 0.2 * Math.sin(phase * Math.PI);
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }

    // ===== 塔 =====
    drawTowers() {
      // 按y排序(国王塔最后画避免遮挡错误——其实塔不重叠,保持简单)
      for (const side of [1, 0]) {
        const ts = this.game.towers[side];
        for (const k of ['left','right','king']) {
          const tw = ts[k];
          if (tw.dead) { this.drawRubble(tw); continue; }
          this.drawTower(tw);
        }
      }
    }

    drawTower(tw) {
      const ctx = this.ctx;
      const x = tw.x * CELL, y = tw.y * CELL;
      const r = tw.radius * CELL;
      const sc = GFX.sideColors(tw.side);

      ctx.save();

      if (tw.type === 'king') {
        // ===== 国王塔:方形城堡 =====
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        GFX.roundRect(ctx, x-r+3, y-r+5, r*2, r*2, 6); ctx.fill();
        // 塔身(渐变)
        const bg = ctx.createLinearGradient(x-r, y-r, x+r, y+r);
        bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
        ctx.fillStyle = bg;
        GFX.roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2.5; ctx.stroke();
        // 垛口(顶部锯齿)
        ctx.fillStyle = sc.dark;
        const mw = r*2/5;
        for (let i = 0; i < 5; i += 2) {
          ctx.fillRect(x-r + i*mw + 2, y-r-5, mw-4, 7);
        }
        // 皇冠
        ctx.fillStyle = tw.activated ? PAL.gold : '#8a8a6a';
        ctx.strokeStyle = tw.activated ? PAL.goldDark : '#666'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r*0.42, y + r*0.05);
        ctx.lineTo(x - r*0.42, y - r*0.32);
        ctx.lineTo(x - r*0.18, y - r*0.1);
        ctx.lineTo(x, y - r*0.42);
        ctx.lineTo(x + r*0.18, y - r*0.1);
        ctx.lineTo(x + r*0.42, y - r*0.32);
        ctx.lineTo(x + r*0.42, y + r*0.05);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // 炮口
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(x, y + r*0.38, r*0.22, 0, Math.PI*2); ctx.fill();
        // 未激活睡眠
        if (!tw.activated) {
          ctx.fillStyle = 'rgba(10,14,25,0.42)';
          GFX.roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = `bold ${Math.floor(r*0.5)}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('zZ', x + r*0.45, y - r*0.45);
        }
      } else {
        // ===== 公主塔:圆形石塔 =====
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(x+2, y+4, r, 0, Math.PI*2); ctx.fill();
        // 塔身
        ctx.fillStyle = GFX.orbFill(ctx, x, y, r, sc.base, sc.light);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2.5; ctx.stroke();
        // 石纹环
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r*0.7, 0, Math.PI*2); ctx.stroke();
        // 尖顶(三角形旗塔)
        ctx.fillStyle = sc.dark;
        ctx.beginPath();
        ctx.moveTo(x - r*0.42, y - r*0.55);
        ctx.lineTo(x, y - r*1.25);
        ctx.lineTo(x + r*0.42, y - r*0.55);
        ctx.closePath(); ctx.fill();
        // 旗帜
        ctx.fillStyle = tw.side === 0 ? PAL.gold : '#ffca28';
        ctx.beginPath();
        ctx.moveTo(x, y - r*1.25);
        ctx.lineTo(x + r*0.42, y - r*1.12);
        ctx.lineTo(x, y - r*0.98);
        ctx.closePath(); ctx.fill();
        // 炮口
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(x, y + r*0.15, r*0.3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(x - r*0.1, y + r*0.05, r*0.1, 0, Math.PI*2); ctx.fill();
      }

      ctx.restore();

      // ===== 攻击状态 =====
      if (tw.aimAngle !== null && tw.aimAngle !== undefined) {
        const a = tw.aimAngle;
        ctx.strokeStyle = 'rgba(255,220,80,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a)*r*0.6, y + Math.sin(a)*r*0.6);
        ctx.lineTo(x + Math.cos(a)*(r+11), y + Math.sin(a)*(r+11));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (tw.shotFlash > 0) {
        const alpha = tw.shotFlash / 0.25;
        ctx.globalAlpha = alpha;
        // 炮口火光
        const mg = ctx.createRadialGradient(x, y, 0, x, y, r*0.55);
        mg.addColorStop(0, '#fffde7'); mg.addColorStop(1, 'rgba(255,214,0,0)');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(x, y, r*0.55, 0, Math.PI*2); ctx.fill();
        if (tw.shotTarget) {
          const tx = tw.shotTarget.x*CELL, ty = tw.shotTarget.y*CELL;
          // 弹道(渐隐亮线)
          const lg = ctx.createLinearGradient(x, y, tx, ty);
          lg.addColorStop(0, `rgba(255,238,88,${alpha*0.9})`);
          lg.addColorStop(1, `rgba(255,238,88,${alpha*0.15})`);
          ctx.strokeStyle = lg; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
          // 命中星光
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath(); ctx.arc(tx, ty, 5*alpha+2, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // 装填条
      if (tw.target && !tw.dead) {
        const ratio = tw.atkCD <= 0 ? 1 : 1 - (tw.atkCD / tw.hitSpeed);
        this.drawMeter(x, y - r - 12, r*1.9, 3.5, ratio, ratio >= 1 ? '#ffee58' : '#ffa726');
      }
      // 冰冻
      if (tw.frozen > 0) {
        ctx.fillStyle = 'rgba(100,200,255,0.38)';
        ctx.beginPath(); ctx.arc(x, y, r+4, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#e1f5fe'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const a = (i/6)*Math.PI*2;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a)*r*0.3, y + Math.sin(a)*r*0.3);
          ctx.lineTo(x + Math.cos(a)*(r+3), y + Math.sin(a)*(r+3));
          ctx.stroke();
        }
      }

      // 血条
      this.drawHpBar(x, y - r - 20, r*2, 5, tw.hp/tw.maxHp, tw.side);
    }

    drawRubble(tw) {
      const ctx = this.ctx;
      const x = tw.x * CELL, y = tw.y * CELL;
      const r = tw.radius * CELL;
      ctx.save();
      // 焦土
      ctx.fillStyle = 'rgba(30,25,20,0.5)';
      ctx.beginPath(); ctx.arc(x, y, r*0.95, 0, Math.PI*2); ctx.fill();
      // 碎石块
      let seed = tw.uid.charCodeAt(1) * 97;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < 9; i++) {
        const a = rnd()*Math.PI*2, d = rnd()*r*0.7;
        const sx = x + Math.cos(a)*d, sy = y + Math.sin(a)*d;
        const sz = 3 + rnd()*5;
        ctx.fillStyle = ['#78909c', '#607d8b', '#90a4ae'][i%3];
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(rnd()*Math.PI);
        GFX.roundRect(ctx, -sz/2, -sz/2, sz, sz, 2); ctx.fill();
        ctx.restore();
      }
      // 余烬
      ctx.fillStyle = 'rgba(255,120,50,0.5)';
      ctx.beginPath(); ctx.arc(x + r*0.2, y + r*0.1, 2, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // ===== 单位 =====
    drawUnits() {
      const units = this.game.units.slice().sort((a,b) => a.y - b.y);
      for (const u of units) this.drawUnit(u);
    }

    drawUnit(u) {
      const ctx = this.ctx;
      const x = u.x * CELL, y = u.y * CELL;
      const r = u.radius * CELL;
      const bob = u.flying ? Math.sin(this.animTime*4 + u.uid) * r*0.12 : 0; // 飞行浮动
      const cy = y - (u.flying ? r*0.55 : 0) + bob;
      const sc = GFX.sideColors(u.side);
      const isBuilding = u.isBuilding;

      ctx.save();
      ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;

      // 地面阴影
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y + (isBuilding ? r*0.75 : r*0.55), r*0.85, r*0.32, 0, 0, Math.PI*2);
      ctx.fill();

      // 部署波纹
      if (u.deployTimer > 0) {
        const p = 1 - u.deployTimer / (u.card.deployTime || 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.6*(1-p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r*0.6 + p*r*1.4, 0, Math.PI*2); ctx.stroke();
      }

      if (isBuilding) {
        // ===== 建筑方形底座 =====
        const bg = ctx.createLinearGradient(x-r, y-r, x+r, y+r);
        bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
        ctx.fillStyle = bg;
        GFX.roundRect(ctx, x-r, cy-r, r*2, r*2, 5); ctx.fill();
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2; ctx.stroke();
        // 顶部高光
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        GFX.roundRect(ctx, x-r*0.7, cy-r*0.85, r*1.4, r*0.5, 3); ctx.fill();
      } else {
        // ===== 阵营底环 =====
        ctx.fillStyle = sc.base;
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y + (u.flying ? r*0.55 : r*0.42), r*0.8, r*0.3, 0, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
        // ===== 身体(立体球) =====
        ctx.fillStyle = GFX.orbFill(ctx, x, cy, r, u.card.color, GFX.shade(u.card.color, 55));
        ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = GFX.shade(u.card.color, -45); ctx.lineWidth = 2; ctx.stroke();
        // 高光
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(x - r*0.3, cy - r*0.4, r*0.28, r*0.18, -0.6, 0, Math.PI*2); ctx.fill();
      }

      // 类型图形
      GFX.drawUnitIcon(ctx, u.cardId, x, cy, r * (isBuilding ? 0.85 : 1));

      // 攻击闪光
      if (u.atkAnim > 0) {
        const a = u.atkAnim / 0.3;
        ctx.strokeStyle = `rgba(255,235,59,${a*0.8})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, cy, r + 5*a, 0, Math.PI*2); ctx.stroke();
      }
      // 冲锋状态(王子)
      if (u.charged) {
        ctx.strokeStyle = 'rgba(255,152,0,0.85)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(x, cy, r + 4, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      }
      // 冰冻
      if (u.frozen > 0) {
        ctx.fillStyle = 'rgba(100,200,255,0.42)';
        ctx.beginPath(); ctx.arc(x, cy, r+2, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#e1f5fe'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
          const a = (i/5)*Math.PI*2 + 0.5;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a)*r*0.2, cy + Math.sin(a)*r*0.2);
          ctx.lineTo(x + Math.cos(a)*(r+2), cy + Math.sin(a)*(r+2));
          ctx.stroke();
        }
      }
      // 狂暴粒子
      if (u.rageTimer > 0) {
        ctx.fillStyle = 'rgba(255,80,80,0.85)';
        for (let i = 0; i < 3; i++) {
          const ph = (this.animTime*2.5 + i*0.33 + (u.uid%10)*0.1) % 1;
          ctx.globalAlpha = (u.deployTimer > 0 ? 0.55 : 1) * (1-ph) * 0.9;
          ctx.beginPath();
          ctx.arc(x + Math.sin(ph*9+i)*r*0.5, cy - r - ph*r*1.3, 2.2, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;
      }

      ctx.restore();

      // 血条(受损才显示)
      if (u.hp < u.maxHp - 0.5) {
        this.drawHpBar(x, cy - r - 8, Math.max(r*1.9, 18), 4, u.hp/u.maxHp, u.side);
      }
    }

    // ===== 血条(分段式CR风格) =====
    drawHpBar(x, y, w, h, ratio, side) {
      const ctx = this.ctx;
      ratio = Math.max(0, Math.min(1, ratio));
      // 底
      ctx.fillStyle = 'rgba(12,16,24,0.82)';
      GFX.roundRect(ctx, x-w/2-1.5, y-1.5, w+3, h+3, 2.5); ctx.fill();
      // 填充
      const col = side === 0 ? '#5cd65c' : '#ff5a4f';
      const g = ctx.createLinearGradient(x-w/2, y, x-w/2, y+h);
      g.addColorStop(0, GFX.shade(col, 45)); g.addColorStop(1, col);
      ctx.fillStyle = g;
      if (ratio > 0) {
        GFX.roundRect(ctx, x-w/2, y, w*ratio, h, 1.5); ctx.fill();
      }
      // 分段刻度
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const sx = x - w/2 + (w/4)*i;
        if (sx < x - w/2 + w*ratio) {
          ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y+h); ctx.stroke();
        }
      }
    }

    // 窄进度条(装填)
    drawMeter(x, y, w, h, ratio, color) {
      const ctx = this.ctx;
      ratio = Math.max(0, Math.min(1, ratio));
      ctx.fillStyle = 'rgba(12,16,24,0.75)';
      GFX.roundRect(ctx, x-w/2-1, y-1, w+2, h+2, 2); ctx.fill();
      if (ratio > 0) {
        ctx.fillStyle = color;
        GFX.roundRect(ctx, x-w/2, y, w*ratio, h, 1.5); ctx.fill();
      }
    }

    // ===== 法术特效 =====
    drawEffects() {
      const ctx = this.ctx;
      for (const e of this.game.effects) {
        const t = e.life / e.maxLife;
        if (e.type === 'spell') {
          GFX.drawSpellFx(ctx, e.cardId, e.x*CELL, e.y*CELL, e.radius, t);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ===== 部署预览 =====
    drawPreview(p) {
      const ctx = this.ctx;
      const card = CR.CARDS[p.cardId];
      const x = p.x*CELL, y = p.y*CELL;
      const t = this.animTime;
      if (card.kind === CR.KIND.SPELL) {
        // 法术范围圈(脉冲)
        const R = card.radius*CELL;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = card.color; ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 5]); ctx.lineDashOffset = -t*20;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.18 + 0.08*Math.sin(t*5);
        ctx.fillStyle = card.color;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        // 中心十字
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = card.color; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x-7, y); ctx.lineTo(x+7, y);
        ctx.moveTo(x, y-7); ctx.lineTo(x, y+7);
        ctx.stroke();
        ctx.restore();
      } else {
        const r = (card.radius || 0.4) * CELL;
        ctx.save();
        // 合法/非法标识(含推塔解锁区)
        const ok = CR.canDeploy('player', p.x, p.y, this.game.towers[1]);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = ok ? '#7fff9e' : '#ff7b7b';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t*20;
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        // 幻影单位
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = GFX.orbFill(ctx, x, y, r, card.color, GFX.shade(card.color, 55));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = ok ? 'rgba(127,255,158,0.9)' : 'rgba(255,123,123,0.9)';
        ctx.lineWidth = 2; ctx.stroke();
        GFX.drawUnitIcon(ctx, p.cardId, x, y, r);
        // 多体指示
        if (card.count > 1) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('×' + card.count, x + r + 8, y - r - 4);
        }
        ctx.restore();
      }
    }

    // 暗角(氛围)
    drawVignette() {
      const ctx = this.ctx;
      const g = ctx.createRadialGradient(
        CR.CANVAS_W/2, CR.CANVAS_H/2, CR.CANVAS_H*0.35,
        CR.CANVAS_W/2, CR.CANVAS_H/2, CR.CANVAS_H*0.75
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CR.CANVAS_W, CR.CANVAS_H);
    }
  }

  CR.Renderer = Renderer;
})(window.CR);
