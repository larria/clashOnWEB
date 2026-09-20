// ===============================================
// 渲染器 - Canvas 绘制(战场/塔/单位/特效/部署区)
// 只读 Game 状态 + 消费 game.effects;不修改游戏逻辑
// 设置(部署区显示/瞄准线)通过 settings 读取
// ===============================================
import {
  CELL, CANVAS_W, CANVAS_H, GRID_W, GRID_H, RIVER_Y1, RIVER_Y2,
  BRIDGE_LEFT, BRIDGE_RIGHT, TOWERS, canDeploy,
} from '../core/constants.js';
import { CARDS, KIND } from '../data/cards.js';
import { settings } from '../core/settings.js';
import { PAL, sideColors, orbFill, shade, roundRect, drawUnitIcon, drawSpellFx } from './graphics.js';
import { getCardImage, drawCardImage } from './cardart.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
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
    const previewCard = deployPreview ? CARDS[deployPreview.cardId] : null;
    const showDeployZone = previewCard && previewCard.kind !== KIND.SPELL && settings.get('showDeployZone');
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
    const x0 = uf.lane === 'left' ? 0 : 9;
    const w = 9;
    const isGold = uf.color.indexOf('255,213') === 0;
    let y0, h;
    if (isGold) {
      y0 = 5; h = RIVER_Y1 - 5;          // AI 半场该路(玩家新解锁区)
    } else {
      y0 = RIVER_Y2; h = 27 - RIVER_Y2; // 玩家半场该路(AI 新解锁区)
    }
    ctx.save();
    ctx.fillStyle = `rgba(${uf.color},${alpha})`;
    ctx.fillRect(x0*CELL+1, y0*CELL, w*CELL-2, h*CELL);
    ctx.strokeStyle = `rgba(${uf.color},${Math.min(1, alpha*3)})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 30;
    ctx.strokeRect(x0*CELL+1, y0*CELL, w*CELL-2, h*CELL);
    ctx.setLineDash([]);
    // 该侧桥面也闪烁(解锁后桥面可部署,与 canDeploy 一致)
    const bridgeXs = uf.lane === 'left' ? BRIDGE_LEFT : BRIDGE_RIGHT;
    for (const bx of bridgeXs) {
      ctx.fillStyle = `rgba(${uf.color},${alpha})`;
      ctx.fillRect(bx*CELL+1, RIVER_Y1*CELL, CELL-2, (RIVER_Y2-RIVER_Y1)*CELL);
      ctx.strokeStyle = `rgba(${uf.color},${Math.min(1, alpha*3)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]); ctx.lineDashOffset = -t * 30;
      ctx.strokeRect(bx*CELL+1, RIVER_Y1*CELL, CELL-2, (RIVER_Y2-RIVER_Y1)*CELL);
      ctx.setLineDash([]);
    }
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
    for (let gy = RIVER_Y2; gy < GRID_H; gy += 0.5) {
      for (let gx = 0; gx < GRID_W; gx += 0.5) {
        ctx.fillStyle = `rgba(100,220,140,${breathe})`;
        ctx.fillRect(gx*CELL, gy*CELL, CELL*0.5, CELL*0.5);
      }
    }
    // 区域描边:己方半场底线区域
    ctx.strokeStyle = `rgba(100,220,140,${0.35 + 0.15*Math.sin(t*3)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, RIVER_Y2*CELL, CANVAS_W-2, (GRID_H-RIVER_Y2)*CELL);
    // 解锁区描边(如有):y 从塔前(5)到河岸排末尾(RIVER_Y1,含岸边整行)
    const unlock = [];
    if (enemyTowers.left.dead) unlock.push({x:0, w:9});
    if (enemyTowers.right.dead) unlock.push({x:9, w:9});
    const unlockTop = 5, unlockH = (RIVER_Y1 - unlockTop); // 含岸排(y=14)整行
    for (const u of unlock) {
      // 解锁区金色微光填充
      ctx.fillStyle = `rgba(255,213,79,${breathe * 0.9})`;
      ctx.fillRect(u.x*CELL+1, unlockTop*CELL, u.w*CELL-2, unlockH*CELL);
      ctx.strokeStyle = `rgba(255,213,79,${0.5 + 0.2*Math.sin(t*3)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(u.x*CELL+1, unlockTop*CELL, u.w*CELL-2, unlockH*CELL);
      ctx.setLineDash([]);
      // 解锁侧桥面高亮(该侧公主塔被推后桥面也可部署,与 canDeploy 一致)
      const bridgeXs = u.x === 0 ? BRIDGE_LEFT : BRIDGE_RIGHT;
      for (const bx of bridgeXs) {
        ctx.fillStyle = `rgba(255,213,79,${breathe * 0.9})`;
        ctx.fillRect(bx*CELL+1, RIVER_Y1*CELL, CELL-2, (RIVER_Y2-RIVER_Y1)*CELL);
        ctx.strokeStyle = `rgba(255,213,79,${0.5 + 0.2*Math.sin(t*3)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bx*CELL+1, RIVER_Y1*CELL, CELL-2, (RIVER_Y2-RIVER_Y1)*CELL);
        ctx.setLineDash([]);
      }
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
    c.width = CANVAS_W; c.height = CANVAS_H;
    const ctx = c.getContext('2d');

    // --- 草地:双色棋盘格 + 双半场色差 ---
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const top = gy < RIVER_Y1;
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
      const x = rnd() * CANVAS_W, y = rnd() * CANVAS_H;
      if (y > RIVER_Y1*CELL && y < RIVER_Y2*CELL) continue;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 200; i++) {
      const x = rnd() * CANVAS_W, y = rnd() * CANVAS_H;
      if (y > RIVER_Y1*CELL && y < RIVER_Y2*CELL) continue;
      ctx.fillRect(x, y, 2, 2);
    }

    // --- 河岸(上下边缘,立体感) ---
    const ry1 = RIVER_Y1*CELL, ry2 = RIVER_Y2*CELL;
    ctx.fillStyle = PAL.bank;
    ctx.fillRect(0, ry1 - 5, CANVAS_W, 5);
    ctx.fillRect(0, ry2, CANVAS_W, 5);
    ctx.fillStyle = PAL.bankDark;
    ctx.fillRect(0, ry1 - 2, CANVAS_W, 2);
    ctx.fillRect(0, ry2 + 3, CANVAS_W, 2);

    // --- 河水底色 ---
    const rg = ctx.createLinearGradient(0, ry1, 0, ry2);
    rg.addColorStop(0, PAL.riverDeep);
    rg.addColorStop(0.5, PAL.river);
    rg.addColorStop(1, PAL.riverDeep);
    ctx.fillStyle = rg;
    ctx.fillRect(0, ry1, CANVAS_W, ry2 - ry1);

    // --- 桥(立体木桥) ---
    for (const bx of [...BRIDGE_LEFT, ...BRIDGE_RIGHT]) {
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
    this.drawTowerPad(ctx, TOWERS.player.left);
    this.drawTowerPad(ctx, TOWERS.player.right);
    this.drawTowerPad(ctx, TOWERS.player.king);
    this.drawTowerPad(ctx, TOWERS.ai.left);
    this.drawTowerPad(ctx, TOWERS.ai.right);
    this.drawTowerPad(ctx, TOWERS.ai.king);

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
    const ry1 = RIVER_Y1*CELL, ry2 = RIVER_Y2*CELL;
    const t = this.animTime;
    ctx.save();
    // 流动波光带
    for (let row = 0; row < 3; row++) {
      const y = ry1 + 8 + row * ((ry2-ry1-10)/3);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = PAL.riverLight;
      const off = (t * (18 + row*8)) % (CELL*4);
      for (let x = -CELL*4; x < CANVAS_W + CELL*4; x += CELL*4) {
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
      const x = ((i*337 + t*26) % CANVAS_W);
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
    const sc = sideColors(tw.side);

    ctx.save();

    if (tw.type === 'king') {
      // ===== 国王塔:方形城堡 =====
      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      roundRect(ctx, x-r+3, y-r+5, r*2, r*2, 6); ctx.fill();
      // 塔身(渐变)
      const bg = ctx.createLinearGradient(x-r, y-r, x+r, y+r);
      bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
      ctx.fillStyle = bg;
      roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
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
        roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
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
      ctx.fillStyle = orbFill(ctx, x, y, r, sc.base, sc.light);
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
    if (settings.get('showAimLine') && tw.aimAngle !== null && tw.aimAngle !== undefined) {
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
    // 狂暴(受 rage 法术):红光脉冲闪烁
    if (tw.rageTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 9);
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      ctx.fillStyle = '#ff1744';
      ctx.beginPath(); ctx.arc(x, y, r+2, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.6 + 0.35 * pulse;
      ctx.strokeStyle = '#ff1744'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r+4, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 血条
    // 血条:玩家塔放下方(上方易被 HUD/单位遮挡),AI 塔保持上方
    const barY = tw.side === 0 ? y + r + 12 : y - r - 20;
    this.drawHpBar(x, barY, r*2, 5, tw.hp/tw.maxHp, tw.side);
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
      roundRect(ctx, -sz/2, -sz/2, sz, sz, 2); ctx.fill();
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
    const sc = sideColors(u.side);
    const isBuilding = u.isBuilding;
    const art = getCardImage(u.cardId);
    // 多体单位(骷髅/亡灵/哥布林等):单个单位以小圆形头像展示
    const isSwarm = (u.card.count || 1) > 1;

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

    if (art) {
      // ===== 卡图渲染 =====
      // 视觉尺寸:单位碰撞半径 × 放大系数,大单位(巨人 r=0.55)明显大于小的(火枪手 r=0.38)
      // 多体小单位画得更小(它们以"群体"出现,单个是杂兵)
      const artScale = isSwarm ? 2.1 : 2.8;          // 半径 → 卡图宽(像素)
      const artW = r * artScale * 2;                  // 卡图宽度
      if (isSwarm) {
        // 群体单位:小圆形头像(中央正方形裁剪 + 圆形 clip)
        const rr = r * 2.1;                           // 圆半径
        ctx.save();
        // 阵营描边圆底
        ctx.fillStyle = sc.dark;
        ctx.beginPath(); ctx.arc(x, cy, rr + 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, cy, rr, 0, Math.PI*2); ctx.clip();
        drawCardImage(ctx, art, x, cy, rr*2, { cropSquare: true });
        ctx.restore();
        // 阵营细环
        ctx.strokeStyle = u.side === 0 ? 'rgba(111,168,224,0.9)' : 'rgba(224,130,120,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, cy, rr, 0, Math.PI*2); ctx.stroke();
      } else if (isBuilding) {
        // 建筑:卡图 + 阵营色方形底框
        // 视觉尺寸与碰撞半径解耦:3×3 建筑视觉与火枪手卡图同大(≈81px),
        // 特斯拉(2×2)更小(≈64px);碰撞半径(1.35/0.9)不变
        const isSmall = u.radius < 1.1; // 特斯拉 2×2
        const vr = (isSmall ? 0.84 : 1.07) * CELL; // 视觉半宽(格 × CELL)
        const bg = ctx.createLinearGradient(x-vr, y-vr, x+vr, y+vr);
        bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
        ctx.fillStyle = bg;
        roundRect(ctx, x-vr, cy-vr, vr*2, vr*2, 6); ctx.fill();
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2; ctx.stroke();
        // 卡图裁入圆角方形
        ctx.save();
        roundRect(ctx, x-vr+2, cy-vr+2, vr*2-4, vr*2-4, 4); ctx.clip();
        drawCardImage(ctx, art, x, cy, vr*2 - 4, { cropSquare: true });
        ctx.restore();
      } else {
        // 单体部队:完整卡图(等比,含卡框),宽度按单位大小缩放
        // 底部阵营光环(区分敌我)
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(x, y + r*0.42, r*0.8, r*0.3, 0, 0, Math.PI*2); ctx.fill();
        drawCardImage(ctx, art, x, cy, artW);
        // 阵营色描边弧(贴在图底部,不遮卡面)
        ctx.strokeStyle = u.side === 0 ? 'rgba(111,168,224,0.95)' : 'rgba(224,130,120,0.95)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, cy + artW*0.36, r*0.62, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();
      }
    } else {
      // ===== 回退:图片未加载完时用原 orb 样式 =====
      if (isBuilding) {
        const bg = ctx.createLinearGradient(x-r, y-r, x+r, y+r);
        bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
        ctx.fillStyle = bg;
        roundRect(ctx, x-r, cy-r, r*2, r*2, 5); ctx.fill();
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        roundRect(ctx, x-r*0.7, cy-r*0.85, r*1.4, r*0.5, 3); ctx.fill();
      } else {
        ctx.fillStyle = sc.base;
        ctx.strokeStyle = sc.dark; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y + (u.flying ? r*0.55 : r*0.42), r*0.8, r*0.3, 0, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = orbFill(ctx, x, cy, r, u.card.color, shade(u.card.color, 55));
        ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = shade(u.card.color, -45); ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(x - r*0.3, cy - r*0.4, r*0.28, r*0.18, -0.6, 0, Math.PI*2); ctx.fill();
      }
      drawUnitIcon(ctx, u.cardId, x, cy, r * (isBuilding ? 0.85 : 1));
    }

    // 攻击闪光(扩大到卡图范围;建筑用视觉半径,部队用卡图半径)
    const buildVR = isBuilding ? (u.radius < 1.1 ? 0.84 : 1.07) * CELL : 0;
    const fxR = art ? (isBuilding ? buildVR : Math.max(r, (isSwarm ? r*2.1 : r*2.6))) : r;
    if (u.atkAnim > 0) {
      const a = u.atkAnim / 0.3;
      ctx.strokeStyle = `rgba(255,235,59,${a*0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, cy, fxR + 5*a, 0, Math.PI*2); ctx.stroke();
    }
    // 冲锋状态(王子)
    if (u.charged) {
      ctx.strokeStyle = 'rgba(255,152,0,0.85)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(x, cy, fxR + 4, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 冰冻
    if (u.frozen > 0) {
      ctx.fillStyle = 'rgba(100,200,255,0.42)';
      ctx.beginPath(); ctx.arc(x, cy, fxR+2, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#e1f5fe'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const a = (i/5)*Math.PI*2 + 0.5;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a)*fxR*0.2, cy + Math.sin(a)*fxR*0.2);
        ctx.lineTo(x + Math.cos(a)*(fxR+2), cy + Math.sin(a)*(fxR+2));
        ctx.stroke();
      }
    }
    // 狂暴状态:单位泛红脉冲闪烁(原版视觉)+ 上升粒子
    if (u.rageTimer > 0) {
      // 红色泛光圈(呼吸脉冲闪烁)+ 内部淡红罩
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 9 + u.uid);
      ctx.save();
      // 外圈(亮红,闪烁)
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, cy, fxR + 3, 0, Math.PI*2); ctx.stroke();
      // 内部淡红罩(半透明,不遮死卡图)
      ctx.globalAlpha = 0.22 + 0.18 * pulse;
      ctx.fillStyle = '#ff1744';
      ctx.beginPath(); ctx.arc(x, cy, fxR + 1, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // 粒子
      ctx.fillStyle = 'rgba(255,80,80,0.85)';
      for (let i = 0; i < 3; i++) {
        const ph = (this.animTime*2.5 + i*0.33 + (u.uid%10)*0.1) % 1;
        ctx.globalAlpha = (u.deployTimer > 0 ? 0.55 : 1) * (1-ph) * 0.9;
        ctx.beginPath();
        ctx.arc(x + Math.sin(ph*9+i)*fxR*0.5, cy - fxR - ph*fxR*1.3, 2.2, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;
    }

    ctx.restore();

    // 血条(受损才显示;按视觉尺寸上移)
    if (u.hp < u.maxHp - 0.5) {
      const topR = art ? (isBuilding ? buildVR : (isSwarm ? r*2.1 : r*2.6)) : r;
      this.drawHpBar(x, cy - topR - 8, Math.max(r*1.9, 18), 4, u.hp/u.maxHp, u.side);
    }
  }

  // ===== 血条(分段式CR风格) =====
  drawHpBar(x, y, w, h, ratio, side) {
    const ctx = this.ctx;
    ratio = Math.max(0, Math.min(1, ratio));
    // 底
    ctx.fillStyle = 'rgba(12,16,24,0.82)';
    roundRect(ctx, x-w/2-1.5, y-1.5, w+3, h+3, 2.5); ctx.fill();
    // 填充
    const col = side === 0 ? '#5cd65c' : '#ff5a4f';
    const g = ctx.createLinearGradient(x-w/2, y, x-w/2, y+h);
    g.addColorStop(0, shade(col, 45)); g.addColorStop(1, col);
    ctx.fillStyle = g;
    if (ratio > 0) {
      roundRect(ctx, x-w/2, y, w*ratio, h, 1.5); ctx.fill();
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
    roundRect(ctx, x-w/2-1, y-1, w+2, h+2, 2); ctx.fill();
    if (ratio > 0) {
      ctx.fillStyle = color;
      roundRect(ctx, x-w/2, y, w*ratio, h, 1.5); ctx.fill();
    }
  }

  // ===== 法术特效 =====
  drawEffects() {
    const ctx = this.ctx;
    for (const e of this.game.effects) {
      const t = e.life / e.maxLife;
      if (e.type === 'spell') {
        drawSpellFx(ctx, e.cardId, e.x*CELL, e.y*CELL, e.radius, t);
      } else if (e.type === 'spellProjectile') {
        this.drawSpellProjectile(e, t);
      } else if (e.type === 'spellCast') {
        // 固定施法时间:目标处预警圈(脉冲收缩)
        const x = e.x*CELL, y = e.y*CELL, R = e.radius*CELL;
        const tt = this.animTime;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 5]); ctx.lineDashOffset = -tt*20;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.15 + 0.1*Math.sin(tt*6);
        ctx.fillStyle = e.color;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (e.type === 'deathBomb') {
        this.drawDeathBomb(e, t);
      } else if (e.type === 'elixirPop') {
        // 圣水收集器产费:紫色圣水滴升腾 + 光晕闪现
        const x = e.x*CELL, y = e.y*CELL;
        const p = 1 - t; // 0→1 上升进度
        ctx.save();
        // 地面光晕(紫色,渐隐)
        ctx.globalAlpha = t * 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
        g.addColorStop(0, 'rgba(242,167,255,0.9)'); g.addColorStop(1, 'rgba(138,30,201,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI*2); ctx.fill();
        // 升腾的圣水滴(3 滴错开)
        for (let i = 0; i < 3; i++) {
          const ph = Math.min(1, p * 1.3 - i * 0.12);
          if (ph <= 0 || ph >= 1) continue;
          const dx = Math.sin(i * 2.1) * 8;
          const dy = -ph * 46;
          const dropR = 4.5 * (1 - ph * 0.5);
          ctx.globalAlpha = (1 - ph) * 0.95;
          const dg = ctx.createRadialGradient(x + dx - dropR*0.3, y + dy - dropR*0.4, 0, x + dx, y + dy, dropR);
          dg.addColorStop(0, '#f2a7ff'); dg.addColorStop(0.55, '#d24cff'); dg.addColorStop(1, '#8a1ec9');
          ctx.fillStyle = dg;
          // 水滴形(上尖下圆)
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy - dropR*1.4);
          ctx.quadraticCurveTo(x + dx + dropR, y + dy - dropR*0.2, x + dx, y + dy + dropR);
          ctx.quadraticCurveTo(x + dx - dropR, y + dy - dropR*0.2, x + dx, y + dy - dropR*1.4);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // 法术投射物(从国王塔飞向目标):按卡型绘制 + 轨迹 + 落点预警
  drawSpellProjectile(e, t) {
    const ctx = this.ctx;
    const p = 1 - t; // 0→1 飞行进度
    const fx = e.fromX*CELL, fy = e.fromY*CELL;
    const tx = e.toX*CELL, ty = e.toY*CELL;
    const x = fx + (tx - fx) * p;
    const y = fy + (ty - fy) * p;
    const ang = Math.atan2(ty - fy, tx - fx);
    const tt = this.animTime;
    ctx.save();

    // 落点预警圈(虚线,目标处)
    const card = CARDS[e.cardId] || {};
    const R = (card.radius || 2.5) * CELL;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = card.color || '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]); ctx.lineDashOffset = -tt*15;
    ctx.beginPath(); ctx.arc(tx, ty, R, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);

    // 飞行轨迹(渐隐尾迹)
    ctx.globalAlpha = 0.35;
    const trailN = 6;
    for (let i = 1; i <= trailN; i++) {
      const tp = Math.max(0, p - i * 0.04);
      const txx = fx + (tx - fx) * tp, tyy = fy + (ty - fy) * tp;
      ctx.fillStyle = card.color || '#fff';
      ctx.globalAlpha = 0.3 * (1 - i / trailN);
      ctx.beginPath(); ctx.arc(txx, tyy, Math.max(2, 10 - i*1.4), 0, Math.PI*2); ctx.fill();
    }

    // 投射物本体(按卡型)
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (e.cardId === 'fireball') {
      // 火球:橙红渐变球 + 火焰拖尾
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 11);
      g.addColorStop(0, '#fff8e1'); g.addColorStop(0.4, '#ff9800'); g.addColorStop(1, 'rgba(230,81,0,0.1)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI*2); ctx.fill();
      // 尾焰
      ctx.fillStyle = 'rgba(255,152,0,0.5)';
      ctx.beginPath();
      ctx.moveTo(-4, -5); ctx.lineTo(-20, 0); ctx.lineTo(-4, 5);
      ctx.closePath(); ctx.fill();
    } else if (e.cardId === 'rocket') {
      // 火箭:弹体 + 尾焰 + 烟迹
      ctx.fillStyle = '#c62828';
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-2, -4); ctx.lineTo(-2, 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-2, -4, 4, 8);
      const fg = ctx.createLinearGradient(-4, 0, -26, 0);
      fg.addColorStop(0, '#ffee58'); fg.addColorStop(1, 'rgba(255,152,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-4, -3.5); ctx.lineTo(-26, 0); ctx.lineTo(-4, 3.5);
      ctx.closePath(); ctx.fill();
    } else if (e.cardId === 'arrows') {
      // 万箭:一簇箭矢(扇形)
      ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        const off = i * 4;
        ctx.beginPath();
        ctx.moveTo(-8, off * 0.6 + Math.sin(i) * 2);
        ctx.lineTo(8, off * 0.6);
        ctx.stroke();
      }
      // 箭头
      ctx.fillStyle = '#cfd8dc';
      for (let i = -2; i <= 2; i++) {
        const off = i * 4;
        ctx.beginPath();
        ctx.moveTo(12, off * 0.6);
        ctx.lineTo(6, off * 0.6 - 2.5);
        ctx.lineTo(6, off * 0.6 + 2.5);
        ctx.closePath(); ctx.fill();
      }
    } else {
      // 通用:发光球
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 9);
      g.addColorStop(0, '#fff'); g.addColorStop(1, card.color || '#fff');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // 延时死亡炸弹(气球/骷髅巨人):黑圆炸弹 + 引信火花闪烁 + 剩余时间环
  drawDeathBomb(e, t) {
    const ctx = this.ctx;
    const x = e.x * CELL, y = e.y * CELL;
    const R = 13;
    const tt = this.animTime;
    ctx.save();
    // 地面阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + R*0.8, R*0.9, R*0.35, 0, 0, Math.PI*2); ctx.fill();
    // 炸弹本体(黑球+高光)
    const g = ctx.createRadialGradient(x - R*0.3, y - R*0.4, R*0.1, x, y, R);
    g.addColorStop(0, '#5c6470'); g.addColorStop(0.6, '#2b3038'); g.addColorStop(1, '#14171c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(x - R*0.3, y - R*0.4, R*0.24, R*0.15, -0.6, 0, Math.PI*2); ctx.fill();
    // 引信 + 火花(临近爆炸闪烁加快)
    const flash = t < 0.35 ? (Math.sin(tt*24) > 0) : (Math.sin(tt*8) > 0);
    ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - R); ctx.quadraticCurveTo(x + R*0.3, y - R*1.4, x + R*0.55, y - R*1.2); ctx.stroke();
    if (flash) {
      const fg = ctx.createRadialGradient(x + R*0.55, y - R*1.2, 0, x + R*0.55, y - R*1.2, R*0.5);
      fg.addColorStop(0, '#fff59d'); fg.addColorStop(0.6, '#ff9800'); fg.addColorStop(1, 'rgba(255,87,34,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(x + R*0.55, y - R*1.2, R*0.5, 0, Math.PI*2); ctx.fill();
    }
    // 剩余引信时间环(红,逐渐消耗)
    ctx.strokeStyle = 'rgba(255,82,82,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, R + 5, -Math.PI/2, -Math.PI/2 + t * Math.PI*2); ctx.stroke();
    // 爆炸范围提示(淡)
    ctx.strokeStyle = 'rgba(255,111,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, e.radius*CELL, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ===== 部署预览 =====
  // 无幻影单位:仅光圈 + 多体数量;法术显示范围圈
  drawPreview(p) {
    const ctx = this.ctx;
    const card = CARDS[p.cardId];
    const x = p.x*CELL, y = p.y*CELL;
    const t = this.animTime;
    if (card.kind === KIND.SPELL) {
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
      // 合法/非法标识(含推塔解锁区;卡牌级部署规则由 canDeploy 解释)
      const ok = canDeploy('player', p.x, p.y, this.game.towers[1], { zone: card.deployZone });
      // 预览卡图(半透明,按单位视觉尺寸;多体单位显示小圆头像示意)
      const isSwarm = (card.count || 1) > 1;
      const isBuildingCard = card.kind === KIND.BUILDING;
      const art = getCardImage(p.cardId);
      // 建筑预览视觉半径与实际渲染一致(3×3→1.07 格,特斯拉 0.84)
      const bvr = ((card.radius || 0.4) < 1.1 ? 0.84 : 1.07) * CELL;
      const fxR = art ? (isSwarm ? r*2.1 : (isBuildingCard ? bvr : r*2.6)) : r;
      if (art && !p.invalid) {
        ctx.globalAlpha = ok ? 0.65 : 0.3;
        if (isSwarm) {
          // 群体单位:画 count 个小圆头像围绕部署点(示意分布)
          const n = Math.min(card.count, 5);
          const rr = r * 2.1;
          for (let i = 0; i < n; i++) {
            const a = (i/n) * Math.PI*2 - Math.PI/2;
            const px = x + Math.cos(a) * r*1.9, py = y + Math.sin(a) * r*1.9;
            ctx.save();
            ctx.beginPath(); ctx.arc(px, py, rr*0.72, 0, Math.PI*2); ctx.clip();
            drawCardImage(ctx, art, px, py, rr*1.44, { cropSquare: true });
            ctx.restore();
            ctx.strokeStyle = ok ? 'rgba(127,255,158,0.8)' : 'rgba(255,123,123,0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(px, py, rr*0.72, 0, Math.PI*2); ctx.stroke();
          }
        } else if (isBuildingCard) {
          // 建筑:圆角方形裁剪预览(与实际渲染一致的底座尺寸)
          ctx.save();
          roundRect(ctx, x-bvr+2, y-bvr+2, bvr*2-4, bvr*2-4, 5); ctx.clip();
          drawCardImage(ctx, art, x, y, bvr*2 - 4, { cropSquare: true });
          ctx.restore();
        } else {
          drawCardImage(ctx, art, x, y, fxR*2);
        }
      }
      // 光圈
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ok ? '#7fff9e' : '#ff7b7b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t*20;
      ctx.beginPath(); ctx.arc(x, y, (isSwarm ? r*3.4 : fxR) + 6, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // 多体指示
      if (card.count > 1) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('×' + card.count, x + (isSwarm ? r*3.4 : fxR) + 8, y - (isSwarm ? r*3.4 : fxR) - 4);
      }
      // 吸附提示:指针在区域外附近,部署点已吸附到最近边缘 —— 画引导线 + 标记
      if (p.snapped && p.pointer) {
        const px = p.pointer.x * CELL, py = p.pointer.y * CELL;
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = '#7fff9e';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        ctx.setLineDash([]);
        // 指针处小叉(原点击位置)
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#9aa3c7'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px-4, py-4); ctx.lineTo(px+4, py+4);
        ctx.moveTo(px+4, py-4); ctx.lineTo(px-4, py+4);
        ctx.stroke();
        // 吸附点标签
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#7fff9e';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('吸附部署', x, y - (isSwarm ? r*3.4 : fxR) - 8);
      }
      ctx.restore();
    }
  }

  // 暗角(氛围)
  drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      CANVAS_W/2, CANVAS_H/2, CANVAS_H*0.35,
      CANVAS_W/2, CANVAS_H/2, CANVAS_H*0.75
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}
