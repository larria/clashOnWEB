// ===============================================
// Pixi 场景层(WebGL)- 塔与单位 sprite 化 + 批渲染
//
// 迁移策略(v0.6.0):渲染分两层——
//   底层 #game   :Pixi Application(本文件),静态战场 + 部署遮罩 +
//                  河水 + 塔 + 单位。数量多、变化快的 sprite 全部
//                  走 GPU 批渲染,替代 canvas 2D 逐个 drawImage/路径
//   顶层 #fx     :canvas 2D(renderer.js),特效/状态圈/血条/部署预览/
//                  暗角。短生命周期矢量绘制,保留原代码不动
//
// 纹理策略:全部由现有 canvas 2D 预渲染代码生成(Textures.from
// 传入离屏 canvas),确保视觉与 v0.5.x 像素级一致:
//   - arena 纹理   :Renderer.buildArenaCache() 的原绘制代码
//   - 塔纹理        :Renderer.drawTower() 的塔身绘制部分(6 种:
//                     侧别×公主/国王)
//   - 卡图纹理     :cardart.js 的 Image,预烘焙 4 种变体
//                     (full 完整卡图 / square 中央裁方 /
//                      circle 圆头像 / roundrect 圆角方)
//
// Pixi ticker 不用(应用 RAF 由 main.js 统一驱动,renderer.draw
// 每帧调 pixi.render());preferWebGL 失败时 Pixi 自动回退 canvas 2D,
// 行为不变。
// ===============================================
import * as PIXI from '../../libs/pixi.min.mjs';
import {
  CELL, CANVAS_W, CANVAS_H, GRID_W, GRID_H, RIVER_Y1, RIVER_Y2,
  BRIDGE_LEFT, BRIDGE_RIGHT, TOWERS, canDeploy, KING_BACK,
} from '../core/constants.js';
import { PAL, sideColors, orbFill, shade, roundRect } from './graphics.js';
import { getCardImage } from './cardart.js';

const SIDE_STR = ['player', 'ai'];

/** canvas/HTMLImageElement → Pixi 纹理。
 *  Pixi 8 的 Texture.from() 对 canvas 走 autoDetectSource,旧版
 *  传法会报 "Could not find a source type" —— 显式按资源类型建
 *  Source(ImageSource/CanvasSource)再包 Texture */
function toTexture(res) {
  if (res instanceof HTMLImageElement || (typeof Image !== 'undefined' && res instanceof Image)) {
    return new PIXI.Texture(new PIXI.ImageSource({ resource: res }));
  }
  return new PIXI.Texture(new PIXI.CanvasSource({ resource: res }));
}

export class PixiLayer {
  constructor(fxRenderer, canvas) {
    this.fx = fxRenderer;                 // 借用 fx 层的预渲染代码(塔纹理烘焙)
    this.canvas = canvas;                 // #game 画布(Pixi 直接渲染)
    this.game = fxRenderer.game;
    this.app = new PIXI.Application();
    this.ready = false;                   // init() 异步完成前 render() 为 no-op
    this.showDeployZone = false;          // 由 Renderer.draw 每帧设置
    // 单位/塔 sprite 池:uid -> Sprite
    this.unitSprites = new Map();
    this.towerSprites = new Map();
    this.tex = {};                        // 纹理注册表
  }

  async init() {
    await this.app.init({
      canvas: this.canvas,                // 渲染到 #game(WebGL)
      width: CANVAS_W, height: CANVAS_H,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      preference: 'webgl',
    });
    this.root = new PIXI.Container();
    this.app.stage.addChild(this.root);

    this.buildTextures();
    this.buildStatic();
    this.ready = true;
  }

  /** 帧驱动:由 Renderer.draw 调用,不用 Pixi 自己的 ticker */
  render(dt) {
    if (!this.ready) return;
    this.updateRiver(dt);
    this.maskG.visible = this.showDeployZone;
    if (this.showDeployZone) this.updateDeployMask();
    this.syncTowers();
    this.syncUnits();
    this.app.render();
  }

  // ===== 纹理生成(全部走现有 canvas 2D 代码,视觉零偏移) =====
  buildTextures() {
    // 1. 战场静态层(草地/河岸/桥/塔位地基/底线石墙)
    this.tex.arena = toTexture(this.fx.buildArenaCache());

    // 2. 塔纹理:借 Renderer.drawTower 的塔身部分画到离屏
    for (const side of [0, 1]) {
      for (const type of ['princess', 'king']) {
        const key = `tower_${side}_${type}`;
        this.tex[key] = toTexture(this.bakeTowerTexture(side, type));
      }
    }

    // 3. 卡图纹理:4 种变体(完整/裁方/圆头像/圆角方),按需烘焙
    //    (sprite 创建时调 getCardTexture,首次访问时烘焙并缓存)
    this._cardTexCache = new Map();
  }

  /** 塔身纹理:以塔中心为原点,含阴影。半径取 Tower 实际值
   *  (constants.js TOWER_STATS:公主 1.2/国王 1.6),padding 容纳
   *  公主塔尖顶(r*1.25)与垛口 */
  bakeTowerTexture(side, type) {
    const radius = type === 'king' ? 1.6 : 1.2;
    const r = radius * CELL;
    // 纹理半宽:尖顶 1.25r(公主)/ 垛口 1.1r(国王)+ 阴影 5px 余量
    const half = Math.ceil((type === 'king' ? r * 1.1 : r * 1.25) + 6);
    const size = half * 2;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const x = size / 2, y = size / 2;
    const sc = sideColors(side);

    ctx.save();
    if (type === 'king') {
      // ===== 国王塔:方形城堡(复刻 drawTower 的 king 分支) =====
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      roundRect(ctx, x-r+3, y-r+5, r*2, r*2, 6); ctx.fill();
      const bg = ctx.createLinearGradient(x-r, y-r, x+r, y+r);
      bg.addColorStop(0, sc.light); bg.addColorStop(0.5, sc.base); bg.addColorStop(1, sc.dark);
      ctx.fillStyle = bg;
      roundRect(ctx, x-r, y-r, r*2, r*2, 6); ctx.fill();
      ctx.strokeStyle = sc.dark; ctx.lineWidth = 2.5; ctx.stroke();
      // 垛口
      ctx.fillStyle = sc.dark;
      const mw = r*2/5;
      for (let i = 0; i < 5; i += 2) {
        ctx.fillRect(x-r + i*mw + 2, y-r-5, mw-4, 7);
      }
      // 皇冠:金色(激活色。沉睡态由 fx 层画 zZ 暗罩,无需暗色变体)
      ctx.fillStyle = PAL.gold;
      ctx.strokeStyle = PAL.goldDark; ctx.lineWidth = 1.5;
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
      // ===== 公主塔:圆形石塔(复刻 drawTower 的 princess 分支) =====
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x+2, y+4, r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = orbFill(ctx, x, y, r, sc.base, sc.light);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = sc.dark; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r*0.7, 0, Math.PI*2); ctx.stroke();
      // 尖顶
      ctx.fillStyle = sc.dark;
      ctx.beginPath();
      ctx.moveTo(x - r*0.42, y - r*0.55);
      ctx.lineTo(x, y - r*1.25);
      ctx.lineTo(x + r*0.42, y - r*0.55);
      ctx.closePath(); ctx.fill();
      // 旗帜
      ctx.fillStyle = side === 0 ? PAL.gold : '#ffca28';
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
    this._towerTexMeta = this._towerTexMeta || {};
    this._towerTexMeta[`tower_${side}_${type}`] = { size, r };
    return c;
  }

  /** 卡图纹理(按需烘焙):variant 决定裁剪/形状
   *  full:完整等比卡图(单体部队)
   *  square:中央裁方(建筑/预览用)
   *  circle:圆头像+阵营描边底(群体单位) —— 阵营描边需 2 份(side0/1)
   *  roundrect:圆角方+阵营色渐变底框(建筑) —— 同样 2 份
   */
  getCardTexture(cardId, variant, side) {
    const key = `${cardId}|${variant}|${side || 0}`;
    if (this._cardTexCache.has(key)) return this._cardTexCache.get(key);
    const img = getCardImage(cardId);
    if (!img) return null;
    const w = img.naturalWidth, h = img.naturalHeight;
    let tex = null;
    if (variant === 'full') {
      tex = toTexture(img);
    } else if (variant === 'square') {
      const s = Math.min(w, h);
      const frame = new PIXI.Rectangle((w-s)/2, (h-s)/2, s, s);
      tex = new PIXI.Texture(toTexture(img).source, frame);
    } else if (variant === 'circle') {
      // 圆头像:阵营描边圆底 + 圆形裁剪卡图(直径 = img 短边)
      const s = Math.min(w, h);
      const c = document.createElement('canvas');
      c.width = s + 8; c.height = s + 8;
      const ctx = c.getContext('2d');
      const sc = sideColors(side || 0);
      ctx.fillStyle = sc.dark;
      ctx.beginPath(); ctx.arc(s/2+4, s/2+4, s/2+4, 0, Math.PI*2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(s/2+4, s/2+4, s/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(img, (w-s)/2, (h-s)/2, s, s, 4, 4, s, s);
      ctx.restore();
      // 阵营细环
      ctx.strokeStyle = (side === 0) ? 'rgba(111,168,224,0.9)' : 'rgba(224,130,120,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s/2+4, s/2+4, s/2, 0, Math.PI*2); ctx.stroke();
      tex = toTexture(c);
    } else if (variant === 'roundrect') {
      // 圆角方:阵营渐变底框 + 圆角裁剪卡图(建筑)
      const s = Math.min(w, h);
      const c = document.createElement('canvas');
      c.width = s + 8; c.height = s + 8;
      const ctx = c.getContext('2d');
      const sc = sideColors(side || 0);
      const g = ctx.createLinearGradient(0, 0, s+8, s+8);
      g.addColorStop(0, sc.light); g.addColorStop(0.5, sc.base); g.addColorStop(1, sc.dark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, s+8, s+8, 6); ctx.fill();
      ctx.save();
      roundRect(ctx, 2, 2, s+4, s+4, 4); ctx.clip();
      ctx.drawImage(img, (w-s)/2, (h-s)/2, s, s, 4, 4, s, s);
      ctx.restore();
      tex = toTexture(c);
    }
    this._cardTexCache.set(key, tex);
    return tex;
  }

  // ===== 静态层组装 =====
  buildStatic() {
    // 战场(最底)
    this.arenaSprite = new PIXI.Sprite(this.tex.arena);
    this.arenaSprite.zIndex = 0;
    this.root.addChild(this.arenaSprite);

    // 河水动画层(河水底色在 arena 纹理里,这里只画波光;
    // 波光每帧变化 → 用 Graphics 重画,数量小(3 行椭圆×~19 + 5 点)开销可忽略)
    this.riverG = new PIXI.Graphics();
    this.riverG.zIndex = 1;
    this.root.addChild(this.riverG);

    // 部署遮罩层(红色不可部署区;内容变化时重画)
    this.maskG = new PIXI.Graphics();
    this.maskG.zIndex = 2;
    this.root.addChild(this.maskG);

    // 塔 + 单位容器(zIndex 排序按 y)
    this.entityC = new PIXI.Container();
    this.entityC.sortableChildren = true;
    this.entityC.zIndex = 3;
    this.root.addChild(this.entityC);

    // 屏幕震动:整体 root 位移
    this.shakeOffsets = { x: 0, y: 0 };
  }

  // ===== 河水波光(每帧;从 drawRiverAnim 移植) =====
  updateRiver(dt) {
    this.riverT = (this.riverT || 0) + dt;
    const t = this.riverT;
    const g = this.riverG;
    g.clear();
    const ry1 = RIVER_Y1*CELL, ry2 = RIVER_Y2*CELL;
    // 流动波光带
    for (let row = 0; row < 3; row++) {
      const y = ry1 + 8 + row * ((ry2-ry1-10)/3);
      g.fill({ color: PAL.riverLight, alpha: 0.14 });
      const off = (t * (18 + row*8)) % (CELL*4);
      for (let x = -CELL*4; x < CANVAS_W + CELL*4; x += CELL*4) {
        const xx = x + off;
        g.ellipse(xx, y, CELL*0.9, 2.2);
      }
    }
    // 高光点
    for (let i = 0; i < 5; i++) {
      const phase = (t * 0.5 + i * 0.37) % 1;
      const x = ((i*337 + t*26) % CANVAS_W);
      const y = ry1 + 6 + ((i*89) % (ry2-ry1-12));
      g.fill({ color: 0xbde3ff, alpha: 0.2 * Math.sin(phase * Math.PI) });
      g.circle(x, y, 1.8);
    }
  }

  // ===== 部署遮罩(形状变化时重画;呼吸透明度每帧) =====
  updateDeployMask() {
    const game = this.game;
    if (!game) return;
    // 与 fx 层 Renderer.drawDeployMask 相同的签名逻辑(独立实现,
    // 避免 fx 层持缓存 canvas 又被 Pixi 引用后清空重画)
    const enemyTowers = game.towers[1];
    const myTowers = game.towers[0];
    const buildings = game.units.filter(u => u.isBuilding && !u.dead);
    const towersSig = ['left','right','king'].map(k => enemyTowers[k].dead ? 0 : 1).join('') +
      ['left','right','king'].map(k => myTowers[k].dead ? 0 : 1).join('');
    const bSig = buildings.map(b => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.radius}`).join(';');
    const sig = towersSig + '|' + bSig;
    if (this._maskSig === sig && this._maskBuilt) {
      // 仅呼吸
      this.maskG.alpha = 0.42 + 0.04 * Math.sin(this.riverT * 2.2);
      return;
    }
    this._maskSig = sig;
    this._maskBuilt = true;
    const g = this.maskG;
    g.clear();
    const step = 0.5;
    const okAt = (gx, gy) => {
      if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return false;
      return canDeploy('player', gx + step/2, gy + step/2, enemyTowers, { zone: 'own' }, myTowers, buildings);
    };
    // 红遮罩(单次 fill:Graphics 合并所有 rect)
    g.fill({ color: 0xd02c2c, alpha: 1 });
    for (let gy = 0; gy < GRID_H; gy += step) {
      for (let gx = 0; gx < GRID_W; gx += step) {
        if (okAt(gx, gy)) continue;
        const px = gx*CELL, py = gy*CELL, s = CELL*step;
        g.rect(px, py, s, s);
      }
    }
    // 金色边界线
    g.fill({ color: 0xffe082, alpha: 1 });
    const inField = (gx, gy) => gx >= 0 && gy >= 0 && gx < GRID_W && gy < GRID_H;
    for (let gy = 0; gy < GRID_H; gy += step) {
      for (let gx = 0; gx < GRID_W; gx += step) {
        if (!okAt(gx, gy)) continue;
        const px = gx*CELL, py = gy*CELL, s = CELL*step;
        if (inField(gx, gy - step) && !okAt(gx, gy - step)) g.rect(px, py + 1.5, s, 3);
        if (inField(gx, gy + step) && !okAt(gx, gy + step)) g.rect(px, py + s - 4.5, s, 3);
        if (inField(gx - step, gy) && !okAt(gx - step, gy)) g.rect(px + 1.5, py, 3, s);
        if (inField(gx + step, gy) && !okAt(gx + step, gy)) g.rect(px + s - 4.5, py, 3, s);
      }
    }
    g.alpha = 0.42 + 0.04 * Math.sin(this.riverT * 2.2);
  }

  // ===== 塔同步 =====
  syncTowers() {
    const game = this.game;
    for (const side of [0, 1]) {
      const ts = game.towers[side];
      for (const k of ['left', 'right', 'king']) {
        const tw = ts[k];
        const key = tw.uid;
        let s = this.towerSprites.get(key);
        if (!s) {
          const type = tw.type === 'king' ? 'king' : 'princess';
          const tex = this.tex[`tower_${tw.side}_${type}`];
          s = new PIXI.Sprite(tex);
          s.anchor.set(0.5);
          s.zIndex = tw.y;
          this.entityC.addChild(s);
          this.towerSprites.set(key, s);
        }
        // 废墟:隐藏 sprite,由 fx 层画碎石
        s.visible = !tw.dead;
        s.position.set(tw.x * CELL, tw.y * CELL);
        // zIndex 按行:保证下方塔压上方(塔间距大,直接行序即可)
        s.zIndex = tw.y * CELL;
      }
    }
    // 清理已销毁的塔 sprite(塔不会消失,但保险起见)
    if (this.towerSprites.size > 6) {
      const alive = new Set();
      for (const side of [0, 1]) for (const k of ['left','right','king']) alive.add(game.towers[side][k].uid);
      for (const [k, s] of this.towerSprites) if (!alive.has(k)) { s.destroy(); this.towerSprites.delete(k); }
    }
  }

  // ===== 单位同步 =====
  syncUnits() {
    const game = this.game;
    const seen = new Set();
    for (const u of game.units) {
      if (u.dead) continue;
      seen.add(u.uid);
      let s = this.unitSprites.get(u.uid);
      const artId = u.card.artCard || u.cardId;
      const isSwarm = (u.card.count || 1) > 1;
      // 纹理变体:群体圆头像 / 建筑圆角方(阵营进纹理)/ 单体完整卡图
      let variant, sideKey = 0;
      if (isSwarm) { variant = 'circle'; sideKey = u.side; }
      else if (u.isBuilding) { variant = 'roundrect'; sideKey = u.side; }
      else variant = 'full';
      const tex = this.getCardTexture(artId, variant, sideKey);
      if (!tex) {
        // 卡图未加载:隐藏 sprite,fx 层用 orb 回退全量绘制
        if (s) s.visible = false;
        continue;
      }
      if (!s) {
        s = new PIXI.Sprite(tex);
        s.anchor.set(0.5);
        this.entityC.addChild(s);
        this.unitSprites.set(u.uid, s);
      } else if (s._texKey !== tex) {
        s.texture = tex;
      }
      s._texKey = tex;

      const x = u.x * CELL, y = u.y * CELL;
      const r = u.radius * CELL;
      const bob = u.flying ? Math.sin(this.riverT*4 + u.uid) * r*0.12 : 0;
      let jumpLift = 0;
      if (u.jumpTimer > 0) {
        const jp = u.jumpTimer / 0.55;
        jumpLift = Math.sin((1 - jp) * Math.PI) * r * 3.2;
      }
      const cy = y - (u.flying ? r*0.55 : 0) + bob - jumpLift;

      // 尺寸:与 fx 层 drawUnit 的 artScale 分档一致
      if (u.isBuilding) {
        // 建筑:视觉 = 碰撞半径方形(vr*2),纹理内含 4px 底框边距
        const vr = u.radius * CELL;
        const scale = (vr*2 + 8) / tex.width;   // 纹理已含边距,等比放大
        s.scale.set(scale);
      } else if (isSwarm) {
        // 圆头像:纹理直径含 8px 描边底,渲染直径 = rr*2 + 8 同源等比
        const rr = r * 2.1;
        const scale = (rr*2 + 8) / tex.width;
        s.scale.set(scale);
      } else {
        // 单体:完整卡图等比,宽 = r × artScale × 2
        let artScale;
        if (r >= 0.55*CELL) artScale = 3.3;
        else if (r >= 0.45*CELL) artScale = 2.8;
        else artScale = 2.7;
        const artW = r * artScale * 2;
        const ratio = tex.width / tex.height;
        s.width = artW;
        s.height = artW / ratio;
      }
      s.position.set(x, cy);
      s.zIndex = y;
      s.alpha = u.deployTimer > 0 ? 0.55 : 1;
      s.visible = true;
    }
    // 清理死亡单位 sprite
    for (const [uid, s] of this.unitSprites) {
      if (!seen.has(uid)) { s.destroy(); this.unitSprites.delete(uid); }
    }
  }

  /** 跨局复用:换 Game 实例时由 Renderer 通知,清空 sprite 池 */
  rebind(game) {
    this.game = game;
    for (const s of this.unitSprites.values()) s.destroy();
    this.unitSprites.clear();
    for (const s of this.towerSprites.values()) s.destroy();
    this.towerSprites.clear();
    this._maskSig = null;
    this._maskBuilt = false;
  }

  /** 屏幕震动(fx 层算好偏移传入) */
  setShake(x, y) {
    if (!this.ready) return;
    this.root.x = x; this.root.y = y;
  }
}
