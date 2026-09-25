// ===============================================
// 渲染器 - fx 矢量层(canvas 2D)+ Pixi 场景层编排
//
// v0.6.0 起渲染分两层:
//   #game 画布:PixiLayer(WebGL)—— 战场/部署遮罩/河水/塔/单位 sprite
//   #fx   画布:本文件(canvas 2D)—— 特效/状态圈/血条/部署预览/暗角
//   (短生命周期矢量绘制,保留原实现;数量大且稳定的 sprite 走 GPU 批渲染)
//
// 对外接口不变:main.js 仍 new Renderer(canvas, game) + draw(preview, dt)。
// Pixi 初始化失败时自动回退:本层沿用 v0.5.x 的完整 canvas 2D 绘制。
// ===============================================
import {
  CELL, CANVAS_W, CANVAS_H, GRID_W, GRID_H, RIVER_Y1, RIVER_Y2,
  BRIDGE_LEFT, BRIDGE_RIGHT, TOWERS, canDeploy, KING_BACK,
} from '../core/constants.js';
import { CARDS, KIND } from '../data/cards.js';
import { settings } from '../core/settings.js';
import { PAL, sideColors, orbFill, shade, roundRect, drawUnitIcon, drawSpellFx } from './graphics.js';
import { getDeployPositions } from '../game/formation.js';
import { getCardImage, drawCardImage } from './cardart.js';
import { PixiLayer } from './pixilayer.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;                 // #game → Pixi(WebGL)
    this.game = game;
    this.animTime = 0;
    // 设备性能档:手机(触屏+窄屏)或低端 → 关闭 shadowBlur(手机 GPU
    // 上 shadow 是最贵操作之一,发热主因),发光用多层描边模拟
    this.lowFx = (typeof navigator !== 'undefined' &&
      (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
      Math.min(window.screen.width, window.screen.height) < 900);
    // fx 覆盖画布(#fx):本层 2D 绘制目标(特效/状态/血条/预览/暗角)
    const fxCanvas = document.getElementById('fx');
    if (fxCanvas) {
      fxCanvas.width = CANVAS_W;
      fxCanvas.height = CANVAS_H;
      this.ctx = fxCanvas.getContext('2d');
      this.fxCanvas = fxCanvas;
    } else {
      // 兜底:#fx 不存在(旧 DOM)→ 直接画在 #game(canvas 2D 模式)
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      this.ctx = canvas.getContext('2d');
    }
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    // Pixi 场景层(异步初始化;就绪前由 canvas 2D 全量绘制兜底)
    this.pixi = new PixiLayer(this, canvas);
    this.pixi.init().catch(e => {
      console.warn('[Pixi] 初始化失败,回退纯 canvas 模式:', e);
      this.pixi.ready = false;
    });
  }

  /** 跨局复用:切到新 Game(清离屏缓存与 Pixi sprite 池) */
  setGame(game) {
    this.game = game;
    this._maskSig = null;
    this._maskCache = null;
    if (this.pixi) this.pixi.rebind(game);
  }

  /** 发光描边:高端设备 shadowBlur,低端设备多层半透明描边模拟(视觉近似) */
  glowStroke(x, y, r, color, alpha, width, blur) {
    const ctx = this.ctx;
    if (!this.lowFx) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      // 降级:3 层递减透明度的加宽描边(近似光晕,开销 ~1/10)
      for (let i = 3; i >= 1; i--) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * (0.25 * i);
        ctx.lineWidth = width + i * 2.2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
    }
  }

  draw(deployPreview, dt) {
    const ctx = this.ctx;
    // dt 显式传 0 = 冻结动画(暂停/结算态);仅未传(undefined)时取帧时长兜底
    this.animTime = (this.animTime || 0) + (dt == null ? 0.016 : dt);
    // 屏幕震动(塔被摧毁):震动强度随剩余时间衰减
    let shakeX = 0, shakeY = 0;
    if (this.shake) {
      this.shake.t -= (dt == null ? 0.016 : dt);
      if (this.shake.t <= 0) this.shake = null;
      else {
        const k = this.shake.t / this.shake.dur;         // 1→0 衰减
        const amp = this.shake.amp * k * k;
        shakeX = (Math.sin(this.animTime * 93) + Math.sin(this.animTime * 47)) * amp * 0.5;
        shakeY = (Math.cos(this.animTime * 71) + Math.sin(this.animTime * 59)) * amp * 0.5;
      }
    }
    // Pixi 层是否承担战场/塔/单位(就绪即接管;失败回退 canvas 2D)
    const pixiOn = this.pixi && this.pixi.ready;
    if (pixiOn) {
      this.pixi.setShake(shakeX, shakeY);
      this.pixi.showDeployZone = !!(deployPreview &&
        CARDS[deployPreview.cardId].kind !== KIND.SPELL && settings.get('showDeployZone'));
      this.pixi.render(dt == null ? 0.016 : dt);
    }
    // ===== fx 层(本层):状态叠加 + 特效 + 预览 + 暗角 =====
    const cw = this.fxCanvas ? this.fxCanvas.width : this.canvas.width;
    const ch = this.fxCanvas ? this.fxCanvas.height : this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
    if (!pixiOn) {
      // 回退:canvas 2D 全量绘制(v0.5.x 原路径)
      this.drawArena();
      const previewCard = deployPreview ? CARDS[deployPreview.cardId] : null;
      const showDeployZone = previewCard && previewCard.kind !== KIND.SPELL && settings.get('showDeployZone');
      if (showDeployZone) this.drawDeployMask();
      this.drawTowers();
      this.drawUnits();
    } else {
      // Pixi 模式:塔/单位的状态叠加仍画在 fx 层(冰冻/狂暴/瞄准线/
      // 血条/装填条/zZ 沉睡/废墟);单位不画本体与攻击闪光外的光环底
      this.drawTowerStates();
      this.drawUnitStates();
    }
    this.drawProjectiles();
    this.drawEffects();
    if (deployPreview) this.drawPreview(deployPreview);
    ctx.restore();
    this.drawVignette();
  }

  /**
   * 部署遮罩(选中部队/建筑卡时):不可部署区域铺红色半透明,
   * 可选区域保持原色透出——对齐原版"红色阴影标出不能放的地方"
   *
   * 性能:逐格 canDeploy 采样(36×64/0.25=9216 次)只在部署区形状
   * 变化时重算(塔被毁/建筑增减),缓存到离屏;每帧仅 drawImage +
   * 呼吸透明度。alpha 呼吸用整层 globalAlpha 变化,不动缓存内容
   */
  drawDeployMask() {
    const ctx = this.ctx;
    const t = this.animTime;
    const enemyTowers = this.game.towers[1];
    const myTowers = this.game.towers[0];
    const buildings = this.game.units.filter(u => u.isBuilding && !u.dead);
    // 缓存键:塔存活状态 + 建筑占位集合(决定部署区形状的全部因素)
    const towersSig = ['left','right','king'].map(k => enemyTowers[k].dead ? 0 : 1).join('') +
      ['left','right','king'].map(k => myTowers[k].dead ? 0 : 1).join('');
    const bSig = buildings.map(b => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.radius}`).join(';');
    const sig = towersSig + '|' + bSig;
    if (this._maskSig !== sig || !this._maskCache) {
      this._maskSig = sig;
      const c = document.createElement('canvas');
      c.width = CANVAS_W; c.height = CANVAS_H;
      const mc = c.getContext('2d');
      const step = 0.5;   // 半格粒度采样
      const okAt = (gx, gy) => {
        if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return false;
        return canDeploy('player', gx + step/2, gy + step/2, enemyTowers, { zone: 'own' }, myTowers, buildings);
      };
      // 不可部署 → 红遮罩(单路径合并 fill)
      mc.fillStyle = 'rgba(208,44,44,1)';
      mc.beginPath();
      for (let gy = 0; gy < GRID_H; gy += step) {
        for (let gx = 0; gx < GRID_W; gx += step) {
          if (okAt(gx, gy)) continue;
          const px = gx*CELL, py = gy*CELL, s = CELL*step;
          mc.rect(px, py, s, s);
        }
      }
      mc.fill();
      // 可选区边界描金线:只在"可选 ↔ 红遮罩"分界处画
      const inField = (gx, gy) => gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H;
      mc.strokeStyle = 'rgba(255,224,130,1)';
      mc.lineWidth = 3;
      mc.lineJoin = 'round';
      mc.beginPath();
      for (let gy = 0; gy < GRID_H; gy += step) {
        for (let gx = 0; gx < GRID_W; gx += step) {
          if (!okAt(gx, gy)) continue;
          const px = gx*CELL, py = gy*CELL, s = CELL*step;
          if (inField(gx, gy - step) && !okAt(gx, gy - step)) { mc.moveTo(px, py + 1.5); mc.lineTo(px + s, py + 1.5); }
          if (inField(gx, gy + step) && !okAt(gx, gy + step)) { mc.moveTo(px, py + s - 1.5); mc.lineTo(px + s, py + s - 1.5); }
          if (inField(gx - step, gy) && !okAt(gx - step, gy)) { mc.moveTo(px + 1.5, py); mc.lineTo(px + 1.5, py + s); }
          if (inField(gx + step, gy) && !okAt(gx + step, gy)) { mc.moveTo(px + s - 1.5, py); mc.lineTo(px + s - 1.5, py + s); }
        }
      }
      mc.stroke();
      this._maskCache = c;
    }
    // 每帧:仅 drawImage + 呼吸(红区基准 0.42,金线随层透明度同步呼吸)
    const a = 0.42 + 0.04 * Math.sin(t * 2.2);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(this._maskCache, 0, 0);
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

    // --- 底线石墙(国王塔后凸排两侧的不可部署角) ---
    // y=0/31 行中 x∈[6,12) 是可部署的 6 格凸排,两侧各 6 格画石墙,
    // 直观传达"这里是墙,不能部署"
    this.drawBackWall(ctx, 0, false);           // AI 侧(顶)
    this.drawBackWall(ctx, GRID_H - 1, true);   // 玩家侧(底)

    this.arenaCache = c;
    return c;   // Pixi 层直接取用(烘焙纹理);本层 drawArena 仍走缓存字段
  }

  /** 底线石墙:填满该行除 KING_BACK 凸排外的格子(两侧各 6 格) */
  drawBackWall(ctx, gy, isBottom) {
    // 墙基色带(整行,凸排格稍后由草地覆盖恢复——先画基带再重铺凸排草格)
    const y = gy * CELL;
    // 每侧角区:[0, x0) 与 [x1, GRID_W)
    for (const [x0, x1] of [[0, KING_BACK.x0], [KING_BACK.x1, GRID_W]]) {
      const px = x0 * CELL, pw = (x1 - x0) * CELL;
      // 底色:深灰石砌渐变
      const g = ctx.createLinearGradient(0, y, 0, y + CELL);
      g.addColorStop(0, isBottom ? '#4a4238' : '#544b40');
      g.addColorStop(0.55, isBottom ? '#3a332b' : '#443d33');
      g.addColorStop(1, isBottom ? '#2d2721' : '#353028');
      ctx.fillStyle = g;
      ctx.fillRect(px, y, pw, CELL);
      // 石块(错缝砌筑:两行圆角石,行间错位;伪随机尺寸/明暗)
      let seed = (x0 + 1) * 977 + gy * 131;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let row = 0; row < 2; row++) {
        const rh = CELL * 0.42;
        const ry = y + 3 + row * (CELL * 0.5);
        let rx = px + (row ? -CELL*0.22 : 0);
        while (rx < px + pw) {
          const rw = CELL * (0.42 + rnd() * 0.3);
          const l = 0.85 + rnd() * 0.3;   // 明暗抖动
          ctx.fillStyle = `rgb(${Math.round(126*l)},${Math.round(116*l)},${Math.round(102*l)})`;
          ctx.beginPath();
          roundRect(ctx, rx + 1, ry, Math.min(rw, px+pw-rx-1) - 2, rh, 3);
          ctx.fill();
          // 石块顶面高光(上缘亮线)
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(rx + 2, ry + 1, Math.max(0, Math.min(rw, px+pw-rx-1) - 4), 2);
          // 底缘阴影
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(rx + 2, ry + rh - 2, Math.max(0, Math.min(rw, px+pw-rx-1) - 4), 2);
          rx += rw;
        }
      }
      // 苔藓点缀(墙脚,几处绿斑)
      for (let i = 0; i < 5; i++) {
        const mx = px + rnd() * pw, my = y + CELL - 4 - rnd() * 6;
        ctx.fillStyle = `rgba(${86+rnd()*30|0},${110+rnd()*30|0},60,0.5)`;
        ctx.beginPath(); ctx.ellipse(mx, my, 3 + rnd()*4, 2 + rnd()*2, 0, 0, Math.PI*2); ctx.fill();
      }
      // 墙顶压条(石帽,区分行边界)
      ctx.fillStyle = isBottom ? '#5c5346' : '#665c4e';
      ctx.fillRect(px, y + (isBottom ? CELL - 4 : 0), pw, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(px, y + (isBottom ? CELL - 5 : 4), pw, 1.5);
      // 侧端头:与场内草地的衔接阴影
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x0 === 0 ? px + pw - 3 : px, y, 3, CELL);
    }
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

  /** Pixi 模式:塔状态叠加(不画塔身,sprite 已由 Pixi 层渲染) */
  drawTowerStates() {
    for (const side of [1, 0]) {
      const ts = this.game.towers[side];
      for (const k of ['left','right','king']) {
        const tw = ts[k];
        if (tw.dead) { this.drawRubble(tw); continue; }
        this.drawTowerOverlay(tw);
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

    // ===== 状态叠加(两种模式共用) =====
    this.drawTowerOverlay(tw);
  }

  /** 塔状态叠加(独立于塔身绘制;Pixi 模式下塔身由 sprite 承担,
   *  本方法负责 zZ 沉睡/瞄准线/射击闪光/装填条/冰冻/狂暴/血条) */
  drawTowerOverlay(tw) {
    const ctx = this.ctx;
    const x = tw.x * CELL, y = tw.y * CELL;
    const r = tw.radius * CELL;
    // 未激活睡眠(zZ):Pixi 纹理是激活色,暗罩+文字盖在 sprite 上
    if (tw.type === 'king' && !tw.activated) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,14,25,0.42)';
      roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = `bold ${Math.floor(r*0.5)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('zZ', x + r*0.45, y - r*0.45);
      ctx.restore();
    }
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
    // 狂暴(受 rage 法术):金色光晕 + 上升 chevron(与单位版一致)
    if (tw.rageTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 9);
      ctx.save();
      const rg = ctx.createRadialGradient(x, y, r*0.5, x, y, r + 6);
      rg.addColorStop(0, 'rgba(255,215,64,0)');
      rg.addColorStop(0.85, `rgba(255,193,7,${0.3 + 0.25 * pulse})`);
      rg.addColorStop(1, 'rgba(255,193,7,0)');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = '#ffc107';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const ph = (this.animTime * 2 + i * 0.25) % 1;
        const yy = y + r - ph * r * 2.2;
        const cw = r * 0.5 * (0.6 + 0.4 * Math.sin(ph * Math.PI));
        ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.9;
        ctx.beginPath();
        ctx.moveTo(x - cw, yy + 5);
        ctx.lineTo(x, yy);
        ctx.lineTo(x + cw, yy + 5);
        ctx.stroke();
      }
      ctx.restore();
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

  /** Pixi 模式:单位状态叠加(本体 sprite 由 Pixi 层渲染,
   *  本方法画地面阴影/部署波纹/攻击闪光/护盾/冲锋/眩晕/冰冻减速/
   *  狂暴/血条;无卡图时仍回退到 drawUnit 的 orb 全量绘制) */
  drawUnitStates() {
    const units = this.game.units.slice().sort((a,b) => a.y - b.y);
    for (const u of units) {
      const art = getCardImage(u.card.artCard || u.cardId);
      if (!art) { this.drawUnit(u); continue; }   // 卡图未加载:回退全量
      this.drawUnitStatesOne(u, art);
    }
  }

  drawUnit(u) {
    const ctx = this.ctx;
    const x = u.x * CELL, y = u.y * CELL;
    const r = u.radius * CELL;
    const bob = u.flying ? Math.sin(this.animTime*4 + u.uid) * r*0.12 : 0; // 飞行浮动
    // 跳河抛物线(野猪骑士):jumpTimer 0.55→0,sin 给出对称弧线
    let jumpLift = 0;
    if (u.jumpTimer > 0) {
      const jp = u.jumpTimer / 0.55;               // 1→0
      jumpLift = Math.sin((1 - jp) * Math.PI) * r * 3.2; // 最高点 ≈ 3.2r
    }
    const cy = y - (u.flying ? r*0.55 : 0) + bob - jumpLift;
    const sc = sideColors(u.side);
    const isBuilding = u.isBuilding;
    const art = getCardImage(u.card.artCard || u.cardId);
    // 多体单位(骷髅/亡灵/哥布林等):单个单位以小圆形头像展示
    const isSwarm = (u.card.count || 1) > 1;

    ctx.save();
    ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;

    // 地面阴影(跳跃时缩小+变淡,强化腾空感)
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    const shScale = 1 - Math.min(0.6, jumpLift / (r*4));
    ctx.beginPath();
    ctx.ellipse(x, y + (isBuilding ? r*0.75 : r*0.55), r*0.85*shScale, r*0.32*shScale, 0, 0, Math.PI*2);
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
      // 视觉尺寸:单位碰撞半径 × 体型档放大系数。
      // 分档放大让体型差距可视(否则黑王子 r=0.5 与巨人 r=0.55 仅差 10%,
      // 视觉几乎一样大——官方巨人应明显大于黑王子)。
      //   巨型(巨人/戈仑/皮卡 r≥0.55):3.3  大步(王子/黑王子/飞龙 0.45~0.54):2.8
      //   中步(<0.45):2.7  群体杂兵:2.1
      let artScale;
      if (isSwarm) artScale = 2.1;
      else if (r >= 0.55) artScale = 3.3;
      else if (r >= 0.45) artScale = 2.8;
      else artScale = 2.7;
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
        // 视觉尺寸 = 碰撞半径(建筑占方形面积,画多大就占多大——
        // 此前写死 1.07/0.84 格,3×3 建筑(radius 1.35)显示明显小于
        // 占地,野蛮人小屋等"看着能放进去实际被挡"的错觉来源于此)
        const vr = u.radius * CELL;
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

    this.drawUnitStatesOne(u, art, x, cy, r);
    ctx.restore();
  }

  /** 单位状态叠加(两种模式共用;Pixi 模式传入预计算的 x/cy/r) */
  drawUnitStatesOne(u, art, xPre, cyPre, rPre) {
    const ctx = this.ctx;
    const x = xPre != null ? xPre : u.x * CELL;
    const r = rPre != null ? rPre : u.radius * CELL;
    const y = u.y * CELL;
    const bob = u.flying ? Math.sin(this.animTime*4 + u.uid) * r*0.12 : 0;
    let jumpLift = 0;
    if (u.jumpTimer > 0) {
      const jp = u.jumpTimer / 0.55;
      jumpLift = Math.sin((1 - jp) * Math.PI) * r * 3.2;
    }
    const cy = cyPre != null ? cyPre : (y - (u.flying ? r*0.55 : 0) + bob - jumpLift);
    const isBuilding = u.isBuilding;
    const isSwarm = (u.card.count || 1) > 1;

    // 地面阴影 + 部署波纹(Pixi 模式也画: sprite 无自带阴影)
    if (xPre == null) { /* 全量路径已在 drawUnit 画过阴影,不重复 */ }
    else {
      ctx.save();
      ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      const shScale = 1 - Math.min(0.6, jumpLift / (r*4));
      ctx.beginPath();
      ctx.ellipse(x, y + (isBuilding ? r*0.75 : r*0.55), r*0.85*shScale, r*0.32*shScale, 0, 0, Math.PI*2);
      ctx.fill();
      if (u.deployTimer > 0) {
        const p = 1 - u.deployTimer / (u.card.deployTime || 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.6*(1-p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r*0.6 + p*r*1.4, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }

    // 攻击闪光(扩大到卡图范围;建筑用碰撞半径,部队用卡图半径)
    const buildVR = isBuilding ? u.radius * CELL : 0;
    const fxR = art ? (isBuilding ? buildVR : Math.max(r, (isSwarm ? r*2.1 : r*2.6))) : r;
    if (u.atkAnim > 0) {
      const a = u.atkAnim / 0.3;
      ctx.strokeStyle = `rgba(255,235,59,${a*0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, cy, fxR + 5*a, 0, Math.PI*2); ctx.stroke();
    }
    // 护盾(黑王子):常驻护盾罩——半透明穹顶包住单位 + 青紫光晕边。
    // 盾越满越实,受损后变弱(视觉反馈盾的余量);碎盾瞬间由 shieldBreak
    // 特效表现。护盾罩画在本体外、冲锋/攻击特效之下
    if (u.shield > 0 && u.maxShield > 0) {
      const tt = this.animTime;
      const sr = fxR + 3;                       // 护盾罩半径(略大于卡图)
      const ratio = u.shield / u.maxShield;     // 盾余量 0~1
      const pulse = 0.85 + 0.15 * Math.sin(tt * 4);
      ctx.save();
      // 穹顶填充:盾满时深青半透明,受损时变淡
      const a = 0.22 + 0.18 * ratio;
      ctx.fillStyle = `rgba(120,170,255,${a * pulse})`;
      ctx.beginPath(); ctx.arc(x, cy, sr, 0, Math.PI*2); ctx.fill();
      // 光晕边(发光描边,低端设备自动降级多层描边)
      this.glowStroke(x, cy, sr, '#7ab8ff', (0.55 + 0.35 * ratio) * pulse, 2, 8 * pulse);
      // 顶端高光弧(强化"罩"的立体感)
      ctx.strokeStyle = `rgba(220,240,255,${0.5 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, cy, sr - 1, -Math.PI*0.8, -Math.PI*0.2); ctx.stroke();
      ctx.restore();
    }
    // 冲锋状态(王子/黑王子):身后速度拖影 + 发光冲刺环
    // 冲锋是直线纵向冲刺,拖影方向 = 朝敌方(side 0 向上,side 1 向下)
    if (u.charged) {
      const tt = this.animTime;
      const dirY = u.side === 0 ? 1 : -1;          // 拖影在"身后"(远离敌方)
      const hex = u.cardId === 'darkPrince' ? '#b388ff' : '#ff7043';
      const cr = parseInt(hex.slice(1,3),16), cg = parseInt(hex.slice(3,5),16), cb = parseInt(hex.slice(5,7),16);
      // 身后拖影:3 条递减的椭圆块,随时间脉动
      for (let i = 0; i < 3; i++) {
        const off = (i + 1) * fxR * 0.45;
        const w = fxR * (1 - i * 0.22);
        const a = Math.max(0, 0.42 - i * 0.12 + 0.1 * Math.sin(tt * 18 + i));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.beginPath();
        ctx.ellipse(x, cy + dirY * off, w * 0.7, w * 1.1, 0, 0, Math.PI*2);
        ctx.fill();
      }
      // 发光冲刺环(外发光实线 + 内虚线,脉动;低端设备自动降级)
      const pulse = 0.7 + 0.3 * Math.sin(tt * 16);
      ctx.save();
      this.glowStroke(x, cy, fxR + 4, hex, 0.9 * pulse, 2.8, 12 * pulse);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(x, cy, fxR + 7, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    // 眩晕(电击等):头顶黄色电弧环绕 + 星星打转
    if (u.stunned > 0) {
      const tt = this.animTime;
      const topY = cy - fxR - 6;
      ctx.save();
      // 电弧环绕头顶(2 条随机抖动折线)
      ctx.strokeStyle = '#ffee58';
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(tt * 22);
      for (let b = 0; b < 2; b++) {
        const w = fxR * 1.1;
        ctx.beginPath();
        ctx.moveTo(x - w/2 + b * w * 0.2, topY + b * 4);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const sx = x - w/2 + b * w * 0.2 + (w * 0.8) * s / segs;
          const sy = topY + b * 4 + Math.sin(s * 7 + tt * 30 + b * 3) * 3.5;
          ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      // 星星打转(3 颗,绕椭圆轨道)
      ctx.fillStyle = '#ffe082';
      for (let i = 0; i < 3; i++) {
        const a = tt * 5 + (i / 3) * Math.PI * 2;
        const sx = x + Math.cos(a) * fxR * 0.75;
        const sy = topY - 9 + Math.sin(a) * 3.5;
        const ss = 3.2 + 0.7 * Math.sin(tt * 6 + i * 2);
        // 五角星
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(a * 0.6);
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const ka = (k / 5) * Math.PI * 2 - Math.PI/2;
          const ka2 = ka + Math.PI / 5;
          ctx.lineTo(Math.cos(ka) * ss, Math.sin(ka) * ss);
          ctx.lineTo(Math.cos(ka2) * ss * 0.45, Math.sin(ka2) * ss * 0.45);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
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
    } else if (u.slowTimer > 0) {
      // 减速(冰法师):淡青色底圈(弱化版冰冻视觉,与硬冰冻区分)
      ctx.fillStyle = 'rgba(100,200,255,0.22)';
      ctx.beginPath(); ctx.arc(x, cy, fxR, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(129,212,250,0.7)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]); ctx.lineDashOffset = -this.animTime*12;
      ctx.beginPath(); ctx.arc(x, cy, fxR, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 狂暴状态:金色速度线(向上流动的 chevron)——红色已让位给受击特效
    if (u.rageTimer > 0) {
      const tt = this.animTime;
      // 底部金色光晕(微弱,标示 buff 区域)
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(tt * 9 + u.uid);
      ctx.globalAlpha = 0.25 + 0.2 * pulse;
      const rg = ctx.createRadialGradient(x, cy, fxR*0.4, x, cy, fxR + 4);
      rg.addColorStop(0, 'rgba(255,215,64,0)'); rg.addColorStop(0.85, `rgba(255,193,7,${0.35+0.25*pulse})`); rg.addColorStop(1, 'rgba(255,193,7,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, cy, fxR + 4, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // 上升的金色 chevron(≫ 形速度线 ×3,错相位流动)
      ctx.strokeStyle = '#ffc107';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const ph = (tt * 2.2 + i * 0.33 + (u.uid % 7) * 0.11) % 1;
        const yy = cy + fxR - ph * fxR * 2.4;
        const cw = fxR * 0.55 * (0.6 + 0.4 * Math.sin(ph * Math.PI));
        ctx.globalAlpha = (u.deployTimer > 0 ? 0.55 : 1) * Math.sin(ph * Math.PI) * 0.95;
        ctx.beginPath();
        ctx.moveTo(x - cw, yy + 5);
        ctx.lineTo(x, yy);
        ctx.lineTo(x + cw, yy + 5);
        ctx.stroke();
      }
      ctx.globalAlpha = u.deployTimer > 0 ? 0.55 : 1;
    }

    ctx.restore();

    // 血条(受损才显示;按视觉尺寸上移)
    if (u.hp < u.maxHp - 0.5) {
      const topR = art ? (isBuilding ? buildVR : (isSwarm ? r*2.1 : r*2.6)) : r;
      this.drawHpBar(x, cy - topR - 8, Math.max(r*1.9, 18), 4, u.hp/u.maxHp, u.side);
      // 护盾条(黑王子类):血条上方青白色细条,先于血条消耗
      if (u.shield > 0) {
        this.drawHpBar(x, cy - topR - 13, Math.max(r*1.9, 18), 3, u.shield/u.maxShield, u.side, '#9fd8ff');
      }
    } else if (u.shield > 0 && u.shield < u.maxShield - 0.5) {
      // 本体未损但盾已破:只显示盾条
      const topR = art ? (isBuilding ? buildVR : (isSwarm ? r*2.1 : r*2.6)) : r;
      this.drawHpBar(x, cy - topR - 13, Math.max(r*1.9, 18), 3, u.shield/u.maxShield, u.side, '#9fd8ff');
    }
  }

  // ===== 血条(分段式CR风格) =====
  // 性能:填充用纯色+顶部高光线替代 createLinearGradient(每帧 ~35 次
  // 渐变对象分配;视觉几乎无差,颜色仅 3 种)
  drawHpBar(x, y, w, h, ratio, side, forceColor) {
    const ctx = this.ctx;
    ratio = Math.max(0, Math.min(1, ratio));
    // 底
    ctx.fillStyle = 'rgba(12,16,24,0.82)';
    roundRect(ctx, x-w/2-1.5, y-1.5, w+3, h+3, 2.5); ctx.fill();
    // 填充(纯色 + 顶部高光,替代渐变)
    const col = forceColor || (side === 0 ? '#5cd65c' : '#ff5a4f');
    if (ratio > 0) {
      const fw = w*ratio;
      ctx.fillStyle = col;
      roundRect(ctx, x-w/2, y, fw, h, 1.5); ctx.fill();
      // 顶部高光线(模拟渐变的立体感)
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(ctx, x-w/2, y, fw, Math.max(1, h*0.4), 1.5); ctx.fill();
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

  // ===== 投射物(塔箭/远程弹道;规格 §6.1 实体化后的视觉)=====
  drawProjectiles() {
    const ctx = this.ctx;
    const list = this.game.projectiles;
    if (!list || list.length === 0) return;
    for (const p of list) {
      const x = p.x * CELL, y = p.y * CELL;
      // 拖尾(最近 5 个位置渐隐)
      ctx.save();
      for (let i = 0; i < p.trail.length; i++) {
        const tp = p.trail[i];
        const a = (i + 1) / p.trail.length * 0.5;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        const r = 2 + i * 0.8;
        ctx.beginPath();
        ctx.arc(tp.x * CELL, tp.y * CELL, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 弹头(双层圆点模拟发光;不用 shadowBlur——canvas 2D 最贵
      // 操作,v0.5.x 已做过全局降级,不回退)
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8e1';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
      } else if (e.type === 'meleeSlash') {
        this.drawMeleeSlash(e, t);
      } else if (e.type === 'shotTrail') {
        this.drawShotTrail(e, t);
      } else if (e.type === 'hitBurst') {
        this.drawHitBurst(e, t);
      } else if (e.type === 'rollingLog') {
        // 滚木:横向原木沿滚动方向推进(spells.startRoll 驱动 y 位置;
        // x 是滚动轴线,width 全宽;按已滚进度画前沿原木+后方拖痕)
        const cx = e.x * CELL, cy = e.y * CELL;
        const halfW = (e.roll.width / 2) * CELL;
        const len = Math.min(e.travelled, 1.4) * CELL;   // 原木可见长度
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(e.dirY < 0 ? 0 : Math.PI);   // 统一为"向上滚"
        // 拖痕(已扫过的走廊淡痕)
        ctx.globalAlpha = 0.18 * t;
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(-halfW, -len, halfW * 2, len);
        // 原木主体:圆角矩形+木纹线
        ctx.globalAlpha = 1;
        const bodyH = 0.85 * CELL;
        const grad = ctx.createLinearGradient(-halfW, 0, halfW, 0);
        grad.addColorStop(0, '#5d4037'); grad.addColorStop(0.5, '#8d6e63'); grad.addColorStop(1, '#5d4037');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(-halfW, -bodyH / 2, halfW * 2, bodyH, bodyH / 2);
        ctx.fill();
        ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 2;
        ctx.stroke();
        // 尖刺(官方滚木带钉)
        ctx.fillStyle = '#4e342e';
        for (let i = -2; i <= 2; i++) {
          const sx = i * (halfW / 2.5);
          ctx.beginPath();
          ctx.moveTo(sx - 3, -bodyH / 2);
          ctx.lineTo(sx, -bodyH / 2 - 5);
          ctx.lineTo(sx + 3, -bodyH / 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (e.type === 'spellIcon') {
      } else if (e.type === 'spellIcon') {
        this.drawSpellIcon(e, t);
      } else if (e.type === 'jumpDust' || e.type === 'jumpLand') {
        this.drawJumpFx(e, t);
      } else if (e.type === 'deathBreak') {
        this.drawDeathBreak(e, t);
      } else if (e.type === 'towerExplode') {
        this.drawTowerExplode(e, t);
      } else if (e.type === 'kingActivate') {
        this.drawKingActivate(e, t);
      } else if (e.type === 'chargeHit') {
        this.drawChargeHit(e, t);
      } else if (e.type === 'shieldBreak') {
        // 护盾碎裂(黑王子):青白色环形碎裂 + 碎片飞散
        const x = e.x*CELL, y = e.y*CELL;
        ctx.save();
        const p = 1 - t;
        ctx.globalAlpha = t;
        ctx.strokeStyle = '#9fd8ff';
        ctx.lineWidth = 3 * t + 1;
        ctx.beginPath(); ctx.arc(x, y, e.r*CELL + p*14, 0, Math.PI*2); ctx.stroke();
        // 碎片(6 个方向飞散的小方块)
        ctx.fillStyle = '#cdeaff';
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          const d = e.r*CELL + p * 20;
          ctx.globalAlpha = t * 0.9;
          ctx.fillRect(x + Math.cos(a)*d - 2, y + Math.sin(a)*d - 2, 4, 4);
        }
        ctx.restore();
      } else if (e.type === 'spawnFrost') {
        // 落地冰霜(冰法师):青蓝冲击环 + 地面霜圈
        const x = e.x*CELL, y = e.y*CELL;
        const p = 1 - t;
        ctx.save();
        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, (0.3 + p * 0.9) * e.r * CELL, 0, Math.PI*2); ctx.stroke();
        ctx.globalAlpha = t * 0.35;
        const g = ctx.createRadialGradient(x, y, 0, x, y, e.r*CELL);
        g.addColorStop(0, 'rgba(79,195,247,0.7)'); g.addColorStop(1, 'rgba(79,195,247,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, e.r*CELL, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (e.type === 'poisonCloud') {
        // 毒雾(毒药法术):全程紫绿雾罩 + 冒泡(生命末期渐隐)
        const x = e.x*CELL, y = e.y*CELL, R = e.radius*CELL;
        const tt = this.animTime;
        const fade = t < 0.15 ? (1 - t/0.15) : 1;   // 末段 15% 渐隐
        ctx.save();
        ctx.globalAlpha = 0.30 * fade;
        const g = ctx.createRadialGradient(x, y, R*0.2, x, y, R);
        g.addColorStop(0, 'rgba(156,39,176,0.55)'); g.addColorStop(0.7, 'rgba(76,175,80,0.4)'); g.addColorStop(1, 'rgba(56,142,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        // 边界圈(官方:队伍色环)
        ctx.globalAlpha = 0.75 * fade;
        ctx.strokeStyle = e.color || '#9c27b0';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]); ctx.lineDashOffset = -tt*15;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
        // 毒泡(数个缓慢上升的气泡,相位随时间)
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = '#ce93d8';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 5; i++) {
          const ph = (tt * 0.4 + i * 0.37) % 1;      // 0→1 循环
          const bx = x + Math.cos(i * 2.4 + tt * 0.6) * R * 0.55;
          const by = y + R * 0.6 - ph * R * 1.1;
          const br = 2 + (1 - Math.abs(ph - 0.5) * 2) * 3;
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.stroke();
        }
        ctx.restore();
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
    } else if (e.cardId === 'goblinBarrel') {
      // 飞桶:木桶(旋转) + 抛物线高度模拟(桶飞行中离地"高度"用缩放+阴影表达)
      const hop = Math.sin(Math.PI * p) * 10;   // 0→峰→0
      ctx.translate(0, -hop);
      ctx.rotate(this.animTime * 9);            // 滚动旋转
      ctx.fillStyle = '#8d6e63';
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#5d4037'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.stroke();
      // 桶箍
      ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(10, -3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 3); ctx.lineTo(10, 3); ctx.stroke();
      // 桶面哥布林标记(绿色小圆)
      ctx.fillStyle = '#7cb342';
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI*2); ctx.fill();
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

  // ===== 战斗特效(攻击/受击/跳河/法术图标) =====

  // 近战斩击:攻击者→目标方向的弧形刀光,快速掠过
  drawMeleeSlash(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL, tx = e.tx*CELL, ty = e.ty*CELL;
    const ang = Math.atan2(ty - y, tx - x);
    const p = 1 - t;            // 0→1
    const card = CARDS[e.cardId] || {};
    const col = card.color || '#fff';
    ctx.save();
    // 斩击发生在攻击者前方到目标之间
    const sx = x + Math.cos(ang) * 14, sy = y + Math.sin(ang) * 14;
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    // 弧光(月牙形):随时间扫过并放大淡出
    const sweep = 0.3 + p * 0.9;                 // 弧展开
    const R = 16 + p * 14;
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5 - p * 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, R, -sweep, sweep);
    ctx.stroke();
    // 内侧彩色衬光
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.7;
    ctx.beginPath();
    ctx.arc(-3, 0, R - 4, -sweep * 0.8, sweep * 0.8);
    ctx.stroke();
    // 速度线(3 条短划,强化"斩"的方向感)
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.5;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) {
      const off = i * 6;
      ctx.beginPath();
      ctx.moveTo(-R - 8, off);
      ctx.lineTo(-R - 2 + p * 6, off);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 远程弹道:高速投射物划过 + 渐隐轨迹(0.22s 内飞完全程)
  drawShotTrail(e, t) {
    const ctx = this.ctx;
    const p = 1 - t;            // 0→1 飞行进度
    const x = e.x*CELL, y = e.y*CELL, tx = e.tx*CELL, ty = e.ty*CELL;
    const ang = Math.atan2(ty - y, tx - x);
    const px = x + (tx - x) * p, py = y + (ty - y) * p;
    const card = CARDS[e.cardId] || {};
    const col = card.color || '#ffe082';
    ctx.save();
    // 渐隐轨迹(发光带)
    ctx.globalAlpha = t * 0.45;
    const trailLen = 26;
    const g = ctx.createLinearGradient(px, py, px - Math.cos(ang)*trailLen, py - Math.sin(ang)*trailLen);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.cos(ang)*trailLen, py - Math.sin(ang)*trailLen);
    ctx.stroke();
    // 弹头(按卡型微调:溅射单位画大弹体)
    ctx.globalAlpha = 1;
    ctx.translate(px, py);
    ctx.rotate(ang);
    const headR = e.splash ? 6 : 4;
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, headR + 3);
    hg.addColorStop(0, '#fff'); hg.addColorStop(0.45, col); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, headR + 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    // 命中瞬间(t→0):落点小冲击圈(独立 save/restore,不经过上方平移)
    if (t < 0.35) {
      ctx.save();
      ctx.globalAlpha = t / 0.35 * 0.8;
      ctx.strokeStyle = e.splash ? col : '#fff';
      ctx.lineWidth = 2.5;
      const rr = (1 - t/0.35) * (e.splash ? 18 : 10) + 4;
      ctx.beginPath(); ctx.arc(tx, ty, rr, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }

  // 受击迸发:放射状火花 + 白闪
  drawHitBurst(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const R = Math.max(8, (e.r || 0.4) * CELL);
    const p = 1 - t;
    ctx.save();
    // 白色闪光(中心,快速淡出)
    ctx.globalAlpha = t * 0.7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, '#fff'); g.addColorStop(0.6, 'rgba(255,235,59,0.6)'); g.addColorStop(1, 'rgba(255,235,59,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
    // 放射火花(6 条,长短随机固定相位)
    ctx.globalAlpha = t;
    ctx.strokeStyle = '#ffe082';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (i * 0.7);
      const len = R * (0.5 + ((i * 37) % 10) / 18) * p;
      const r0 = R * 0.4 + p * R * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * (r0 + len), y + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  // 法术图标闪现:释放位置卡图放大→淡出(快速显隐)
  drawSpellIcon(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const art = getCardImage(e.cardId);
    const p = 1 - t;            // 0→1
    // 出现(0~0.25):从大缩小落定 + 淡入;消失(0.25~1):淡出上飘
    const appear = p < 0.25;
    const alpha = appear ? p / 0.25 : t;
    const size = appear ? 64 * (1.4 - p / 0.25 * 0.4) : 64;
    const dy = appear ? 0 : -(1 - t) * 14;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha) * 0.95;
    if (art) {
      // 卡图(裁圆形,带发光描边;低端设备省 shadow,靠白描边)
      ctx.save();
      if (!this.lowFx) {
        ctx.shadowColor = 'rgba(255,255,255,0.8)';
        ctx.shadowBlur = 12;
      }
      ctx.beginPath(); ctx.arc(x, y + dy, size/2, 0, Math.PI*2); ctx.clip();
      drawCardImage(ctx, art, x, y + dy, size, { cropSquare: true });
      ctx.restore();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = Math.min(1, alpha) * 0.9;
      ctx.beginPath(); ctx.arc(x, y + dy, size/2, 0, Math.PI*2); ctx.stroke();
    } else {
      // 无图回退:发光圆 + 卡色
      const card = CARDS[e.cardId] || {};
      ctx.fillStyle = card.color || '#fff';
      ctx.beginPath(); ctx.arc(x, y + dy, size/2.6, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // 跳河特效:起跳尘土 / 落点尘土+水花
  drawJumpFx(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const p = 1 - t;
    ctx.save();
    if (e.type === 'jumpDust') {
      // 起跳:两侧后扬尘土(褐色小粒)
      ctx.globalAlpha = t * 0.8;
      for (let i = 0; i < 5; i++) {
        const dir = i % 2 ? 1 : -1;
        const ph = (i / 5);
        const dx = dir * (4 + p * 16 * (0.6 + ph * 0.6));
        const dy = -p * 10 * (1 - ph * 0.4) + p * p * 8;
        const rr = 3.2 * (1 - p * 0.5);
        ctx.fillStyle = i % 2 ? 'rgba(178,145,108,0.85)' : 'rgba(139,114,85,0.8)';
        ctx.beginPath(); ctx.arc(x + dx, y + dy, rr, 0, Math.PI*2); ctx.fill();
      }
    } else {
      // 落地:河面 → 水花(蓝白液滴 + 涟漪);地面 → 尘土圈
      if (e.river) {
        // 涟漪(两圈扩散)
        for (let k = 0; k < 2; k++) {
          const rp = Math.min(1, p * 1.4 - k * 0.25);
          if (rp <= 0 || rp >= 1) continue;
          ctx.globalAlpha = (1 - rp) * 0.7;
          ctx.strokeStyle = '#b3e5fc';
          ctx.lineWidth = 2 - k * 0.5;
          ctx.beginPath(); ctx.ellipse(x, y, rp * 22, rp * 9, 0, 0, Math.PI*2); ctx.stroke();
        }
        // 溅起水滴(6 滴抛物线)
        ctx.globalAlpha = t;
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI/2 + (i - 2.5) * 0.42;
          const v = 26 + (i % 3) * 7;
          const dx = Math.cos(a) * v * p;
          const dy = Math.sin(a) * v * p + 46 * p * p; // 重力
          ctx.fillStyle = i % 2 ? '#e1f5fe' : '#81d4fa';
          ctx.beginPath(); ctx.arc(x + dx, y + dy, 2.8 - p, 0, Math.PI*2); ctx.fill();
        }
      } else {
        // 地面落点尘土圈
        ctx.globalAlpha = t * 0.85;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.4;
          const dx = Math.cos(a) * (6 + p * 15);
          const dy = Math.sin(a) * (6 + p * 15) * 0.45;
          ctx.fillStyle = 'rgba(178,145,108,0.8)';
          ctx.beginPath(); ctx.arc(x + dx, y + dy, 3 * (1 - p * 0.6), 0, Math.PI*2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  // 单位死亡碎裂:卡色碎片放射飞散 + 阵营色光环收缩淡出;大单位加尘土
  drawDeathBreak(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const R = Math.max(10, e.r * CELL * (e.isBuilding ? 1.0 : 2.2));
    const p = 1 - t;
    ctx.save();
    // 阵营色光环收缩(从单位大小收到中心)
    ctx.globalAlpha = t * 0.6;
    const sc = e.side === 0 ? '#6fa8e0' : '#e08278';
    ctx.strokeStyle = sc;
    ctx.lineWidth = 3 * t + 0.5;
    ctx.beginPath(); ctx.arc(x, y, R * (0.4 + 0.6 * t), 0, Math.PI*2); ctx.stroke();
    // 卡色碎片(10 片,放射飞散+旋转+重力)
    const col = e.color || '#eceff1';
    ctx.globalAlpha = Math.min(1, t * 1.6);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + (i * 0.83);
      const v = 0.5 + ((i * 37) % 10) / 12;
      const dx = Math.cos(a) * v * R * 0.9 * p;
      const dy = Math.sin(a) * v * R * 0.9 * p + 30 * p * p; // 重力下坠
      const sz = (3 + (i % 3) * 1.6) * (1 - p * 0.45);
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.rotate(a + p * 5 * (i % 2 ? 1 : -1));
      ctx.fillStyle = i % 3 === 0 ? '#fff' : col;
      roundRect(ctx, -sz/2, -sz/2, sz, sz * 0.7, 1);
      ctx.fill();
      ctx.restore();
    }
    // 大单位(≥5 费):落点尘土
    if (e.big) {
      ctx.globalAlpha = t * 0.7;
      ctx.fillStyle = 'rgba(178,145,108,0.75)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.6;
        const dx = Math.cos(a) * (R*0.3 + p * R * 0.8);
        const dy = Math.sin(a) * (R*0.3 + p * R*0.8) * 0.4;
        ctx.beginPath(); ctx.arc(x + dx, y + dy, 4 * (1 - p * 0.5), 0, Math.PI*2); ctx.fill();
      }
    }
    // 中心白闪
    ctx.globalAlpha = t * t * 0.8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R*0.6);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R*0.6, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // 塔摧毁爆炸:多圈冲击环 + 碎石飞溅 + 烟尘(国王塔规模更大)
  drawTowerExplode(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const R = e.r * CELL * (e.isKing ? 1.7 : 1.25);
    const p = 1 - t;
    ctx.save();
    // 冲击环(两圈,先快后慢)
    ctx.globalAlpha = Math.min(1, t * 2);
    const ring1 = R * (0.3 + 1.1 * (1 - (1-p) * (1-p)));  // ease-out
    ctx.strokeStyle = '#ffab40'; ctx.lineWidth = 6 * t + 1;
    ctx.beginPath(); ctx.arc(x, y, ring1, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = t * 0.8;
    ctx.strokeStyle = '#ff6f00'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, R * (0.15 + 1.35 * p), 0, Math.PI*2); ctx.stroke();
    // 中心爆炸火球
    ctx.globalAlpha = t;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.7);
    g.addColorStop(0, '#fff8e1'); g.addColorStop(0.35, '#ff9800'); g.addColorStop(0.75, '#e64a19'); g.addColorStop(1, 'rgba(189,14,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R * 0.7 * (1 + 0.4 * p), 0, Math.PI*2); ctx.fill();
    // 碎石飞溅(12 块,重力抛物线)
    const nRock = e.isKing ? 16 : 12;
    ctx.globalAlpha = Math.min(1, t * 1.5);
    for (let i = 0; i < nRock; i++) {
      const a = (i / nRock) * Math.PI * 2 + ((i * 53) % 7) * 0.13;
      const v = 0.55 + ((i * 71) % 10) / 16;
      const dx = Math.cos(a) * v * R * 1.5 * p;
      const dy = Math.sin(a) * v * R * 1.1 * p + 55 * p * p;
      const sz = (4 + (i % 4) * 2.2) * (1 - p * 0.35);
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.rotate(a * 2 + p * 7 * (i % 2 ? 1 : -1));
      ctx.fillStyle = ['#78909c', '#546e7a', '#90a4ae', '#455a64'][i % 4];
      roundRect(ctx, -sz/2, -sz/2, sz, sz * 0.85, 1.5);
      ctx.fill();
      ctx.restore();
    }
    // 火花(8 条放射,快速消失)
    if (t > 0.55) {
      ctx.globalAlpha = (t - 0.55) / 0.45;
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        const r0 = R * 0.5 + p * R * 0.8;
        const r1 = r0 + R * 0.35;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
        ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
    // 烟尘(后期升起)
    if (t < 0.6) {
      ctx.globalAlpha = (1 - t / 0.6) * 0.5;
      ctx.fillStyle = 'rgba(80,75,70,0.6)';
      for (let i = 0; i < 4; i++) {
        const ph = p * 1.2 - i * 0.12;
        if (ph <= 0) continue;
        ctx.beginPath();
        ctx.arc(x + Math.sin(i * 2.3) * R*0.4, y - ph * R * 0.9, R*0.32 * (0.7 + ph * 0.5), 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 国王塔激活:金光迸发 + 光柱冲天 + 光环扩散
  drawKingActivate(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const R = e.r * CELL;
    const p = 1 - t;
    ctx.save();
    // 扩散光环(两圈)
    ctx.globalAlpha = t * 0.8;
    ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3.5 * t + 0.5;
    ctx.beginPath(); ctx.arc(x, y, R * (0.6 + p * 2.2), 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = t * 0.45;
    ctx.strokeStyle = '#ffca28'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, R * (0.4 + p * 1.4), 0, Math.PI*2); ctx.stroke();
    // 光柱冲天(从塔心向上升起的金色光束,头 0.4s)
    if (t > 0.55) {
      const bp = (1 - t) / 0.45;                  // 0→1 上升
      const bh = bp * R * 4.5;                    // 柱高
      const bw = R * 0.55 * (1 - bp * 0.5);
      ctx.globalAlpha = Math.sin(bp * Math.PI) * 0.85;
      const g = ctx.createLinearGradient(x, y, x, y - bh);
      g.addColorStop(0, 'rgba(255,213,79,0.9)'); g.addColorStop(0.7, 'rgba(255,193,7,0.5)'); g.addColorStop(1, 'rgba(255,193,7,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - bw, y);
      ctx.lineTo(x - bw * 0.35, y - bh);
      ctx.lineTo(x + bw * 0.35, y - bh);
      ctx.lineTo(x + bw, y);
      ctx.closePath(); ctx.fill();
    }
    // 金色迸发粒子(12 颗放射)
    ctx.globalAlpha = t;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      const v = 0.6 + ((i * 43) % 10) / 14;
      const dx = Math.cos(a) * v * R * 1.6 * p;
      const dy = Math.sin(a) * v * R * 1.6 * p - 25 * p * p;
      ctx.fillStyle = i % 2 ? '#ffd54f' : '#fff59d';
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 3 * t + 1, 0, Math.PI*2); ctx.fill();
    }
    // 中心闪光
    ctx.globalAlpha = t * t * 0.9;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, R * 0.9);
    cg.addColorStop(0, '#fffde7'); cg.addColorStop(0.5, 'rgba(255,213,79,0.7)'); cg.addColorStop(1, 'rgba(255,193,7,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, y, R * 0.9, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // 王子冲锋命中:重击白闪 + 放射冲击线
  drawChargeHit(e, t) {
    const ctx = this.ctx;
    const x = e.x*CELL, y = e.y*CELL;
    const p = 1 - t;
    ctx.save();
    // 重击白闪(中心,快速衰减)
    ctx.globalAlpha = t * t * 0.95;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, '#fff'); g.addColorStop(0.5, 'rgba(255,238,88,0.75)'); g.addColorStop(1, 'rgba(255,238,88,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI*2); ctx.fill();
    // 放射冲击线(8 条,粗短,快速淡出)
    ctx.globalAlpha = t;
    ctx.strokeStyle = '#ffee58';
    ctx.lineWidth = 3 * t + 0.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39;
      const r0 = 8 + p * 14;
      const r1 = r0 + 9 + p * 7;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.stroke();
    }
    // 冲击环(小,快速)
    ctx.globalAlpha = t * 0.7;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 10 + p * 22, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // ===== 部署预览 =====
  /** 范围圈(乳白色半透明,对齐原版预览样式):细描边 + 淡填充 + 轻微脉冲 */
  drawRangeCircle(x, y, R, t) {
    const ctx = this.ctx;
    ctx.save();
    const pulse = 0.9 + 0.1 * Math.sin(t * 5);
    // 淡填充
    ctx.globalAlpha = 0.13 * pulse;
    ctx.fillStyle = '#fffcf0';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
    // 细描边
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = 'rgba(255,252,240,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // 无幻影单位:仅光圈 + 多体数量;法术显示范围圈
  drawPreview(p) {
    const ctx = this.ctx;
    const card = CARDS[p.cardId];
    const x = p.x*CELL, y = p.y*CELL;
    const t = this.animTime;
    if (card.kind === KIND.SPELL) {
      // 滚木:预览为"向前矩形"——从落点向敌方延伸 roll.range、宽
      // roll.width(官方落点预览即滚动走廊,非圆形)
      if (card.special && card.special.roll) {
        const roll = card.special.roll;
        const dirY = -1;   // 玩家视角预览固定向上(部署方向)
        const half = (roll.width / 2) * CELL;
        const len = roll.range * CELL;
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.08 * Math.sin(t * 5);
        ctx.fillStyle = '#e8d29a';
        ctx.fillRect(x - half, dirY < 0 ? y - len : y, half * 2, len);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#f4e3b0'; ctx.lineWidth = 2;
        ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 30;
        ctx.strokeRect(x - half, dirY < 0 ? y - len : y, half * 2, len);
        ctx.setLineDash([]);
        // 滚动方向箭头(走廊中央)
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#f4e3b0';
        const ay = dirY < 0 ? y - len + 26 : y + len - 26;
        ctx.beginPath();
        ctx.moveTo(x, ay - 10);
        ctx.lineTo(x - 8, ay + 6);
        ctx.lineTo(x + 8, ay + 6);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
      // 法术作用范围圈(乳白色半透明,对齐原版预览样式;轻微脉冲)
      const R = card.radius*CELL;
      this.drawRangeCircle(x, y, R, t);
      }
      // 中心十字
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgba(255,252,240,0.95)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x-7, y); ctx.lineTo(x+7, y);
      ctx.moveTo(x, y-7); ctx.lineTo(x, y+7);
      ctx.stroke();
      ctx.restore();
    } else {
      const r = (card.radius || 0.4) * CELL;
      ctx.save();
      // 合法/非法标识(含推塔解锁区;卡牌级部署规则由 canDeploy 解释;
      // 场上建筑占位同判定;buildings 在本函数内取,勿引用 drawDeployMask 的局部变量)
      const buildings = this.game.units.filter(u => u.isBuilding && !u.dead);
      const ok = canDeploy('player', p.x, p.y, this.game.towers[1], { zone: card.deployZone }, this.game.towers[0], buildings);
      // 预览卡图(半透明,按单位视觉尺寸;多体单位显示小圆头像示意)
      const isSwarm = (card.count || 1) > 1;
      const isBuildingCard = card.kind === KIND.BUILDING;
      const art = getCardImage(card.artCard || p.cardId);
      // 建筑预览视觉半径 = 碰撞半径(与实际渲染/占位一致)
      const bvr = (card.radius || 0.4) * CELL;
      // 体型档放大系数(与实际渲染 drawUnit 一致,见上方分档注释)
      const cr = card.radius || 0.4;
      const artScaleP = isSwarm ? 2.1 : (cr >= 0.55 ? 3.3 : (cr >= 0.45 ? 2.8 : 2.7));
      const fxR = art ? (isSwarm ? r*2.1 : (isBuildingCard ? bvr : r*artScaleP)) : r;
      if (art && !p.invalid) {
        ctx.globalAlpha = ok ? 0.65 : 0.3;
        if (isSwarm) {
          // 群体单位:按实际部署队形(formation.js 横排/方阵)逐个画小圆头像,
          // 预览所见即部署所得
          const positions = getDeployPositions(p.x, p.y, card.count, card.radius || 0.35);
          const rr = r * 2.1;
          for (const pos of positions) {
            const px = pos.x * CELL, py = pos.y * CELL;
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
      // ===== 范围预览(对齐原版) =====
      // 常规部队:无范围圈(原版不显示)。特殊卡显示对应范围(乳白半透明):
      //   - 落地伤害部队(冰法):spawnDamage 半径
      //   - 攻击建筑(加农炮/连弩/电磁塔/迫击炮/地狱塔/炸弹塔):攻击范围
      // 部署合法/非法仍由卡图透明度区分(非法更淡),不再画绿/红圈
      const sp = card.special || {};
      if (sp.spawnDamage) {
        this.drawRangeCircle(x, y, sp.spawnDamage.radius*CELL, t);
      } else if (isBuildingCard && (card.range || 0) > 1.5) {
        // 建筑攻击范围:官方口径=中心到目标边缘,预览圈用 range+典型目标半径
        // 视觉近似即可(原版画的就是攻击范围圈)
        this.drawRangeCircle(x, y, (card.range + 0.4)*CELL, t);
      }
      // 多体单位:无队形包围圈,仅保留小头像(小圆自带阵营描边)
      // 指示物定位半径(×N 徽标/吸附标签):有范围圈用圈,否则用卡图尺寸
      const ringR = sp.spawnDamage ? sp.spawnDamage.radius * CELL
        : (isBuildingCard && (card.range || 0) > 1.5) ? (card.range + 0.4) * CELL
        : fxR + 6;
      // 多体指示
      if (card.count > 1) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('×' + card.count, x + ringR + 8, y - ringR - 4);
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
        ctx.fillText('吸附部署', x, y - ringR - 8);
      }
      ctx.restore();
    }
  }

  // 暗角(氛围)
  drawVignette() {
    const ctx = this.ctx;
    // 暗角是固定的 → 离屏缓存,每帧 1 次 drawImage(原先每帧
    // createRadialGradient+全屏 fill,纯浪费)
    if (!this._vignetteCache) {
      const c = document.createElement('canvas');
      c.width = CANVAS_W; c.height = CANVAS_H;
      const vc = c.getContext('2d');
      const g = vc.createRadialGradient(
        CANVAS_W/2, CANVAS_H/2, CANVAS_H*0.35,
        CANVAS_W/2, CANVAS_H/2, CANVAS_H*0.75
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      vc.fillStyle = g;
      vc.fillRect(0, 0, CANVAS_W, CANVAS_H);
      this._vignetteCache = c;
    }
    ctx.drawImage(this._vignetteCache, 0, 0);
  }
}
