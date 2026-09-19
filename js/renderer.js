// ===============================================
// 渲染器 - Canvas 绘制
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const CELL = CR.CELL;

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;
      canvas.width = CR.CANVAS_W;
      canvas.height = CR.CANVAS_H;
    }

    draw(deployPreview) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawArena();
      this.drawTowers();
      this.drawUnits();
      this.drawEffects();
      if (deployPreview) this.drawPreview(deployPreview);
    }

    drawArena() {
      const ctx = this.ctx;
      // 草地(分两半,颜色略不同)
      ctx.fillStyle = '#3a7d3a';
      ctx.fillRect(0, 0, CR.CANVAS_W, CR.RIVER_Y1 * CELL);
      ctx.fillStyle = '#2e6b2e';
      ctx.fillRect(0, (CR.RIVER_Y2) * CELL, CR.CANVAS_W, (CR.GRID_H - CR.RIVER_Y2) * CELL);
      // 玩家半场用稍亮区分
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, CR.RIVER_Y2 * CELL, CR.CANVAS_W, (CR.GRID_H - CR.RIVER_Y2) * CELL);

      // 网格线(淡)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CR.GRID_W; x++) {
        ctx.beginPath(); ctx.moveTo(x*CELL, 0); ctx.lineTo(x*CELL, CR.CANVAS_H); ctx.stroke();
      }
      for (let y = 0; y <= CR.GRID_H; y++) {
        ctx.beginPath(); ctx.moveTo(0, y*CELL); ctx.lineTo(CR.CANVAS_W, y*CELL); ctx.stroke();
      }

      // 河道
      const ry1 = CR.RIVER_Y1 * CELL, ry2 = CR.RIVER_Y2 * CELL;
      ctx.fillStyle = '#2a6da8';
      ctx.fillRect(0, ry1, CR.CANVAS_W, ry2 - ry1);
      // 河水波纹
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let x = 0; x < CR.CANVAS_W; x += 20) {
        ctx.fillRect(x, ry1 + 8, 12, 3);
      }

      // 桥梁
      ctx.fillStyle = '#8d6e4f';
      for (const bx of [...CR.BRIDGE_LEFT, ...CR.BRIDGE_RIGHT]) {
        ctx.fillRect(bx*CELL, ry1, CELL, ry2 - ry1);
      }
      // 桥纹理
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (const bx of [...CR.BRIDGE_LEFT, ...CR.BRIDGE_RIGHT]) {
        for (let y = ry1; y < ry2; y += 8) {
          ctx.fillRect(bx*CELL, y, CELL, 2);
        }
      }

      // 中线提示
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, (CR.RIVER_Y1+CR.RIVER_Y2)/2 * CELL);
      ctx.lineTo(CR.CANVAS_W, (CR.RIVER_Y1+CR.RIVER_Y2)/2 * CELL);
      ctx.stroke();
    }

    drawTowers() {
      for (const side of [0, 1]) {
        const ts = this.game.towers[side];
        for (const k of ['left','right','king']) {
          const tw = ts[k];
          if (tw.dead) {
            this.drawRubble(tw);
            continue;
          }
          this.drawTower(tw);
        }
      }
    }

    drawTower(tw) {
      const ctx = this.ctx;
      const x = tw.x * CELL, y = tw.y * CELL;
      const r = tw.radius * CELL;
      // 塔基
      ctx.fillStyle = tw.side === 0 ? '#5588cc' : '#cc5555';
      ctx.strokeStyle = tw.side === 0 ? '#336699' : '#993333';
      ctx.lineWidth = 2;
      if (tw.type === 'king') {
        ctx.fillRect(x-r, y-r, r*2, r*2);
        ctx.strokeRect(x-r, y-r, r*2, r*2);
        // 皇冠标识(未激活时暗色+睡眠符号)
        ctx.fillStyle = tw.activated ? '#ffd700' : '#8a8a6a';
        ctx.beginPath();
        ctx.moveTo(x-r*0.4, y-r*0.2);
        ctx.lineTo(x, y-r*0.6);
        ctx.lineTo(x+r*0.4, y-r*0.2);
        ctx.closePath();
        ctx.fill();
        if (!tw.activated) {
          // 未激活:半透明遮罩 + "zZ" 睡眠标识
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x-r, y-r, r*2, r*2);
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = `bold ${Math.floor(r*0.55)}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('💤', x, y + r*0.25);
        }
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        // 炮口
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(x, y, r*0.4, 0, Math.PI*2);
        ctx.fill();
      }

      // ===== 攻击状态显示 =====
      // 1. 瞄准线:有目标时,炮口朝向目标的短指示线
      if (tw.aimAngle !== null && tw.aimAngle !== undefined) {
        const a = tw.aimAngle;
        const sx = x + Math.cos(a) * r * 0.5;
        const sy = y + Math.sin(a) * r * 0.5;
        const ex = x + Math.cos(a) * (r + 10);
        const ey = y + Math.sin(a) * (r + 10);
        ctx.strokeStyle = 'rgba(255,220,80,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 2. 射击闪光:攻击瞬间炮口亮光 + 弹道拖尾
      if (tw.shotFlash > 0) {
        const alpha = tw.shotFlash / 0.25;
        // 炮口闪光
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff176';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI*2);
        ctx.fill();
        // 弹道(塔心到目标)
        if (tw.shotTarget) {
          const tx = tw.shotTarget.x * CELL, ty = tw.shotTarget.y * CELL;
          ctx.strokeStyle = `rgba(255,235,59,${alpha * 0.8})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          // 命中点闪光
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.arc(tx, ty, 6 * alpha, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // 3. 装填条:血条下方的细条,显示攻击冷却进度(满=即将开火)
      if (tw.target && !tw.dead) {
        const reloadRatio = tw.atkCD <= 0 ? 1 : 1 - (tw.atkCD / tw.hitSpeed);
        const bw = r * 2, bh = 3;
        const bx = x - bw/2, by = y - r - 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx-1, by-1, bw+2, bh+2);
        ctx.fillStyle = reloadRatio >= 1 ? '#ffee58' : '#ff9800';
        ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, reloadRatio)), bh);
      }
      // 4. 冰冻状态
      if (tw.frozen > 0) {
        ctx.fillStyle = 'rgba(100,200,255,0.4)';
        ctx.beginPath();
        ctx.arc(x, y, r+3, 0, Math.PI*2);
        ctx.fill();
      }

      // 血条
      this.drawHpBar(x, y - r - 8, r*2, 4, tw.hp/tw.maxHp, tw.side);
    }

    drawRubble(tw) {
      const ctx = this.ctx;
      const x = tw.x * CELL, y = tw.y * CELL;
      const r = tw.radius * CELL;
      ctx.fillStyle = '#555';
      ctx.beginPath();
      ctx.arc(x, y, r*0.7, 0, Math.PI*2);
      ctx.fill();
    }

    drawUnits() {
      // 按y排序保证遮挡
      const units = this.game.units.slice().sort((a,b) => a.y - b.y);
      for (const u of units) {
        this.drawUnit(u);
      }
    }

    drawUnit(u) {
      const ctx = this.ctx;
      const x = u.x * CELL, y = u.y * CELL;
      const r = u.radius * CELL;

      // 部署中(半透明)
      ctx.globalAlpha = u.deployTimer > 0 ? 0.5 : 1;

      // 飞行单位阴影
      if (u.flying) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + r*0.6, r*0.8, r*0.3, 0, 0, Math.PI*2);
        ctx.fill();
      }

      // 身体
      const color = u.card.color;
      ctx.fillStyle = u.side === 0 ? this.lighten(color, 30) : color;
      ctx.strokeStyle = u.side === 0 ? '#225588' : '#882222';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y - (u.flying ? r*0.4 : 0), r, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();

      // 攻击动画
      if (u.atkAnim > 0) {
        ctx.strokeStyle = 'rgba(255,255,0,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - (u.flying ? r*0.4 : 0), r + 4, 0, Math.PI*2);
        ctx.stroke();
      }

      // 冰冻
      if (u.frozen > 0) {
        ctx.fillStyle = 'rgba(100,200,255,0.4)';
        ctx.beginPath();
        ctx.arc(x, y - (u.flying ? r*0.4 : 0), r+2, 0, Math.PI*2);
        ctx.fill();
      }
      // 狂暴
      if (u.rageTimer > 0) {
        ctx.strokeStyle = 'rgba(255,80,80,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y - (u.flying ? r*0.4 : 0), r+3, 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // 血条
      if (u.hp < u.maxHp) {
        this.drawHpBar(x, y - r - 6, r*1.8, 3, u.hp/u.maxHp, u.side);
      }

      // 简单标识文字(首字)
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.floor(r*0.9)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.card.name.charAt(0), x, y - (u.flying ? r*0.4 : 0));
    }

    drawHpBar(x, y, w, h, ratio, side) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x-w/2-1, y-1, w+2, h+2);
      ctx.fillStyle = side === 0 ? '#44dd44' : '#dd4444';
      ctx.fillRect(x-w/2, y, w*Math.max(0,ratio), h);
    }

    drawEffects() {
      const ctx = this.ctx;
      for (const e of this.game.effects) {
        const a = e.life / e.maxLife;
        if (e.type === 'spell') {
          ctx.globalAlpha = a * 0.7;
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.arc(e.x*CELL, e.y*CELL, e.radius*CELL, 0, Math.PI*2);
          ctx.fill();
          ctx.globalAlpha = a;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    drawPreview(p) {
      const ctx = this.ctx;
      const x = p.x * CELL, y = p.y * CELL;
      const card = CR.CARDS[p.cardId];
      ctx.globalAlpha = 0.5;
      if (card.kind === CR.KIND.SPELL) {
        ctx.strokeStyle = card.color;
        ctx.fillStyle = card.color + '33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, card.radius*CELL, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
      } else {
        const r = (card.radius || 0.4) * CELL;
        ctx.fillStyle = card.color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fill();
        // 多体范围
        if (card.count > 1) {
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    lighten(hex, amt) {
      // 简单提亮
      const c = hex.replace('#','');
      const r = Math.min(255, parseInt(c.substr(0,2),16) + amt);
      const g = Math.min(255, parseInt(c.substr(2,2),16) + amt);
      const b = Math.min(255, parseInt(c.substr(4,2),16) + amt);
      return `rgb(${r},${g},${b})`;
    }
  }

  CR.Renderer = Renderer;
})(window.CR);
