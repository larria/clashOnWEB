// ===============================================
// 图形库 - 精致化视觉绘制原语
// 调色板 / 渐变 / 立体形状 / 单位图形 / 法术特效
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  // ===== 调色板 =====
  const PAL = {
    // 战场
    grassA: '#4a8f45', grassB: '#438540',
    grassA2: '#52994c', grassB2: '#4a8f45',
    river: '#2f6f9e', riverDeep: '#26587f', riverLight: '#5b9fd0',
    bank: '#8a7a52', bankDark: '#6e6142',
    bridge: '#a07a4e', bridgeDark: '#7d5c39', bridgeLight: '#b8925f',
    // 阵营
    blue: '#3d7dc8', blueDark: '#2a5a99', blueLight: '#6fa8e0',
    red: '#c85348', redDark: '#99392f', redLight: '#e08278',
    // 通用
    stone: '#9aa2ab', stoneDark: '#6f7883', stoneLight: '#c3cad2',
    wood: '#8d6e4f', gold: '#ffd54f', goldDark: '#c9971c',
    white: '#f5f7fa',
  };

  // 阵营取色
  function sideColors(side) {
    return side === 0
      ? { base: PAL.blue, dark: PAL.blueDark, light: PAL.blueLight }
      : { base: PAL.red, dark: PAL.redDark, light: PAL.redLight };
  }

  // 径向渐变(球体感)
  function orbFill(ctx, x, y, r, base, light) {
    const g = ctx.createRadialGradient(x - r*0.35, y - r*0.4, r*0.1, x, y, r);
    g.addColorStop(0, light);
    g.addColorStop(0.55, base);
    g.addColorStop(1, shade(base, -25));
    return g;
  }
  function shade(hex, amt) {
    const c = hex.replace('#','');
    const cl = (v) => Math.max(0, Math.min(255, v));
    const r = cl(parseInt(c.substr(0,2),16) + amt);
    const g = cl(parseInt(c.substr(2,2),16) + amt);
    const b = cl(parseInt(c.substr(4,2),16) + amt);
    return `rgb(${r},${g},${b})`;
  }

  // 圆角矩形
  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x+rad, y);
    ctx.arcTo(x+w, y, x+w, y+h, rad);
    ctx.arcTo(x+w, y+h, x, y+h, rad);
    ctx.arcTo(x, y+h, x, y, rad);
    ctx.arcTo(x, y, x+w, y, rad);
    ctx.closePath();
  }

  // ===== 单位图形(按卡牌 id 绘制辨识图形) =====
  // 在以 (cx,cy) 为中心、半径 r 的圆形身体上叠加标识图形
  function drawUnitIcon(ctx, cardId, cx, cy, r) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    switch (cardId) {
      case 'knight': { // 盾形
        ctx.fillStyle = '#cfd8dc'; ctx.strokeStyle = '#78909c'; ctx.lineWidth = Math.max(1, r*0.12);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r*0.55);
        ctx.lineTo(cx + r*0.45, cy - r*0.3);
        ctx.lineTo(cx + r*0.4, cy + r*0.35);
        ctx.lineTo(cx, cy + r*0.6);
        ctx.lineTo(cx - r*0.4, cy + r*0.35);
        ctx.lineTo(cx - r*0.45, cy - r*0.3);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#546e7a';
        ctx.beginPath(); ctx.moveTo(cx, cy-r*0.4); ctx.lineTo(cx, cy+r*0.45); ctx.stroke();
        break;
      }
      case 'archers': case 'musketeer': { // 弓箭
        ctx.strokeStyle = PAL.white; ctx.lineWidth = Math.max(1, r*0.14);
        ctx.beginPath(); ctx.arc(cx, cy, r*0.5, -Math.PI*0.35, Math.PI*0.35); ctx.stroke(); // 弓
        ctx.strokeStyle = '#d7ccc8'; ctx.lineWidth = Math.max(1, r*0.07);
        ctx.beginPath(); ctx.moveTo(cx, cy - r*0.48); ctx.lineTo(cx, cy + r*0.48); ctx.stroke(); // 弦
        ctx.strokeStyle = PAL.gold; ctx.lineWidth = Math.max(1, r*0.12);
        ctx.beginPath(); ctx.moveTo(cx - r*0.55, cy); ctx.lineTo(cx + r*0.55, cy); ctx.stroke(); // 箭
        break;
      }
      case 'goblins': case 'spearGoblins': { // 尖耳
        ctx.fillStyle = '#e8f5e9';
        ctx.beginPath();
        ctx.moveTo(cx - r*0.5, cy); ctx.lineTo(cx - r*0.15, cy - r*0.45); ctx.lineTo(cx - r*0.08, cy);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + r*0.5, cy); ctx.lineTo(cx + r*0.15, cy - r*0.45); ctx.lineTo(cx + r*0.08, cy);
        ctx.closePath(); ctx.fill();
        // 眼睛
        ctx.fillStyle = '#c62828';
        ctx.beginPath(); ctx.arc(cx - r*0.22, cy + r*0.1, r*0.1, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r*0.22, cy + r*0.1, r*0.1, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'skeletons': case 'skeletonArmy': case 'witch': case 'tombstone': case 'giantSkeleton': { // 骷髅脸
        ctx.fillStyle = PAL.white;
        ctx.beginPath(); ctx.arc(cx, cy - r*0.1, r*0.42, 0, Math.PI*2); ctx.fill(); // 颅骨
        ctx.fillStyle = '#1b1b1b';
        ctx.beginPath(); ctx.arc(cx - r*0.16, cy - r*0.18, r*0.11, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r*0.16, cy - r*0.18, r*0.11, 0, Math.PI*2); ctx.fill();
        ctx.fillRect(cx - r*0.07, cy + r*0.12, r*0.14, r*0.16); // 鼻
        ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - r*0.2, cy + r*0.3); ctx.lineTo(cx + r*0.2, cy + r*0.3); ctx.stroke(); // 牙线
        break;
      }
      case 'minions': case 'minionHorde': { // 蝙蝠翼
        ctx.fillStyle = '#c5cae9';
        ctx.beginPath();
        ctx.moveTo(cx - r*0.15, cy);
        ctx.quadraticCurveTo(cx - r*0.7, cy - r*0.5, cx - r*0.55, cy + r*0.25);
        ctx.quadraticCurveTo(cx - r*0.3, cy + r*0.1, cx - r*0.15, cy + r*0.15);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + r*0.15, cy);
        ctx.quadraticCurveTo(cx + r*0.7, cy - r*0.5, cx + r*0.55, cy + r*0.25);
        ctx.quadraticCurveTo(cx + r*0.3, cy + r*0.1, cx + r*0.15, cy + r*0.15);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'barbarians': case 'barbarianHut': { // 大胡子
        ctx.fillStyle = '#d7a96b';
        ctx.beginPath();
        ctx.moveTo(cx - r*0.5, cy + r*0.05);
        ctx.quadraticCurveTo(cx - r*0.55, cy + r*0.65, cx, cy + r*0.68);
        ctx.quadraticCurveTo(cx + r*0.55, cy + r*0.65, cx + r*0.5, cy + r*0.05);
        ctx.quadraticCurveTo(cx + r*0.2, cy + r*0.25, cx, cy + r*0.22);
        ctx.quadraticCurveTo(cx - r*0.2, cy + r*0.25, cx - r*0.5, cy + r*0.05);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5d4037';
        ctx.beginPath(); ctx.arc(cx, cy - r*0.3, r*0.12, 0, Math.PI*2); ctx.fill(); // 鼻
        break;
      }
      case 'bomber': case 'bombTower': { // 炸弹引线
        ctx.fillStyle = '#263238';
        ctx.beginPath(); ctx.arc(cx, cy + r*0.25, r*0.3, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = Math.max(1, r*0.1);
        ctx.beginPath(); ctx.moveTo(cx, cy - r*0.05); ctx.quadraticCurveTo(cx + r*0.25, cy - r*0.35, cx + r*0.4, cy - r*0.3); ctx.stroke();
        ctx.fillStyle = '#ffca28';
        ctx.beginPath(); ctx.arc(cx + r*0.4, cy - r*0.32, r*0.12, 0, Math.PI*2); ctx.fill(); // 火花
        break;
      }
      case 'giant': case 'golem': case 'golemite': { // 拳头
        ctx.fillStyle = shade('#ff9933', -40);
        roundRect(ctx, cx - r*0.45, cy - r*0.35, r*0.9, r*0.75, r*0.18);
        ctx.fill();
        ctx.strokeStyle = shade('#ff9933', -60); ctx.lineWidth = Math.max(1, r*0.1); ctx.stroke();
        ctx.strokeStyle = shade('#ff9933', -50);
        ctx.beginPath(); ctx.moveTo(cx - r*0.2, cy - r*0.15); ctx.lineTo(cx - r*0.2, cy + r*0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + r*0.05, cy - r*0.15); ctx.lineTo(cx + r*0.05, cy + r*0.2); ctx.stroke();
        break;
      }
      case 'miniPekka': case 'pekka': { // 尖角头盔
        ctx.fillStyle = PAL.stoneLight;
        ctx.beginPath();
        ctx.moveTo(cx - r*0.5, cy - r*0.2);
        ctx.lineTo(cx - r*0.55, cy - r*0.65);
        ctx.lineTo(cx - r*0.15, cy - r*0.35);
        ctx.lineTo(cx, cy - r*0.7);
        ctx.lineTo(cx + r*0.15, cy - r*0.35);
        ctx.lineTo(cx + r*0.55, cy - r*0.65);
        ctx.lineTo(cx + r*0.5, cy - r*0.2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e53935';
        ctx.fillRect(cx - r*0.3, cy + r*0.1, r*0.2, r*0.1); // 眼缝
        ctx.fillRect(cx + r*0.1, cy + r*0.1, r*0.2, r*0.1);
        break;
      }
      case 'valkyrie': { // 双斧
        ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = Math.max(1, r*0.12);
        ctx.beginPath(); ctx.moveTo(cx - r*0.4, cy + r*0.4); ctx.lineTo(cx - r*0.15, cy - r*0.45); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + r*0.4, cy + r*0.4); ctx.lineTo(cx + r*0.15, cy - r*0.45); ctx.stroke();
        ctx.fillStyle = PAL.stoneLight;
        ctx.beginPath(); ctx.arc(cx - r*0.17, cy - r*0.4, r*0.22, Math.PI*0.3, Math.PI*1.7); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r*0.17, cy - r*0.4, r*0.22, Math.PI*1.3, Math.PI*0.7); ctx.fill();
        break;
      }
      case 'hogRider': { // 獠牙猪鼻
        ctx.fillStyle = '#e8a0a8';
        ctx.beginPath(); ctx.ellipse(cx, cy + r*0.1, r*0.35, r*0.28, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#5d4037';
        ctx.beginPath(); ctx.arc(cx - r*0.14, cy + r*0.08, r*0.07, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r*0.14, cy + r*0.08, r*0.07, 0, Math.PI*2); ctx.fill();
        // 獠牙
        ctx.fillStyle = PAL.white;
        ctx.beginPath(); ctx.moveTo(cx - r*0.3, cy - r*0.1); ctx.lineTo(cx - r*0.2, cy - r*0.35); ctx.lineTo(cx - r*0.12, cy - r*0.1); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + r*0.3, cy - r*0.1); ctx.lineTo(cx + r*0.2, cy - r*0.35); ctx.lineTo(cx + r*0.12, cy - r*0.1); ctx.closePath(); ctx.fill();
        break;
      }
      case 'wizard': { // 法杖+火球
        ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = Math.max(1, r*0.12);
        ctx.beginPath(); ctx.moveTo(cx - r*0.35, cy + r*0.5); ctx.lineTo(cx + r*0.15, cy - r*0.4); ctx.stroke();
        const fg = ctx.createRadialGradient(cx + r*0.2, cy - r*0.48, 0, cx + r*0.2, cy - r*0.48, r*0.3);
        fg.addColorStop(0, '#fff59d'); fg.addColorStop(0.6, '#ff9800'); fg.addColorStop(1, 'rgba(255,87,34,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(cx + r*0.2, cy - r*0.48, r*0.3, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'prince': { // 长枪
        ctx.strokeStyle = '#a1887f'; ctx.lineWidth = Math.max(1, r*0.13);
        ctx.beginPath(); ctx.moveTo(cx - r*0.5, cy + r*0.5); ctx.lineTo(cx + r*0.45, cy - r*0.5); ctx.stroke();
        ctx.fillStyle = PAL.stoneLight;
        ctx.beginPath();
        ctx.moveTo(cx + r*0.35, cy - r*0.38);
        ctx.lineTo(cx + r*0.6, cy - r*0.58);
        ctx.lineTo(cx + r*0.48, cy - r*0.22);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'babyDragon': { // 龙翼
        ctx.fillStyle = '#f48fb1';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx - r*0.9, cy - r*0.6, cx - r*0.75, cy + r*0.1);
        ctx.quadraticCurveTo(cx - r*0.35, cy, cx, cy + r*0.2);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + r*0.9, cy - r*0.6, cx + r*0.75, cy + r*0.1);
        ctx.quadraticCurveTo(cx + r*0.35, cy, cx, cy + r*0.2);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'balloon': { // 气球骨架
        ctx.fillStyle = '#b2dfdb';
        ctx.beginPath(); ctx.ellipse(cx, cy - r*0.15, r*0.55, r*0.4, 0, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#00897b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - r*0.3, cy - r*0.15); ctx.lineTo(cx + r*0.3, cy - r*0.15); ctx.stroke();
        break;
      }
      case 'elixirCollector': { // 圣水滴(官方紫色)
        const eg = ctx.createRadialGradient(cx, cy - r*0.1, 0, cx, cy, r*0.45);
        eg.addColorStop(0, '#f2a7ff'); eg.addColorStop(1, '#a829e0');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r*0.5);
        ctx.quadraticCurveTo(cx + r*0.35, cy - r*0.05, cx, cy + r*0.35);
        ctx.quadraticCurveTo(cx - r*0.35, cy - r*0.05, cx, cy - r*0.5);
        ctx.fill();
        break;
      }
      case 'infernoTower': { // 火焰
        const ig = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*0.5);
        ig.addColorStop(0, '#fff176'); ig.addColorStop(0.5, '#ff7043'); ig.addColorStop(1, 'rgba(216,67,21,0)');
        ctx.fillStyle = ig;
        ctx.beginPath(); ctx.arc(cx, cy, r*0.5, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'tesla': { // 闪电
        ctx.strokeStyle = '#ffee58'; ctx.lineWidth = Math.max(1, r*0.15);
        ctx.beginPath();
        ctx.moveTo(cx - r*0.15, cy - r*0.5);
        ctx.lineTo(cx + r*0.12, cy - r*0.1);
        ctx.lineTo(cx - r*0.05, cy - r*0.05);
        ctx.lineTo(cx + r*0.18, cy + r*0.45);
        ctx.stroke();
        break;
      }
      case 'cannon': case 'mortar': { // 炮管
        ctx.fillStyle = PAL.stoneDark;
        roundRect(ctx, cx - r*0.15, cy - r*0.5, r*0.3, r*0.75, r*0.1);
        ctx.fill();
        ctx.fillStyle = '#37474f';
        ctx.beginPath(); ctx.arc(cx, cy + r*0.3, r*0.32, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'xbow': { // 弩
        ctx.strokeStyle = PAL.stoneLight; ctx.lineWidth = Math.max(1, r*0.12);
        ctx.beginPath(); ctx.moveTo(cx - r*0.5, cy - r*0.3); ctx.lineTo(cx - r*0.5, cy + r*0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + r*0.5, cy - r*0.3); ctx.lineTo(cx + r*0.5, cy + r*0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - r*0.5, cy); ctx.lineTo(cx + r*0.5, cy); ctx.stroke();
        break;
      }
      case 'goblinHut': { // 尖顶屋
        ctx.fillStyle = '#558b2f';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r*0.6);
        ctx.lineTo(cx + r*0.5, cy + r*0.15);
        ctx.lineTo(cx - r*0.5, cy + r*0.15);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#33691e';
        ctx.beginPath(); ctx.arc(cx, cy + r*0.25, r*0.22, 0, Math.PI*2); ctx.fill(); // 门
        break;
      }
      default: { // 通用圆点
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(cx, cy, r*0.22, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ===== 法术特效(带时间进度 t: 1→0) =====
  function drawSpellFx(ctx, cardId, x, y, radius, t) {
    ctx.save();
    const card = CR.CARDS[cardId] || {};
    switch (cardId) {
      case 'fireball': case 'rocket': {
        // 爆炸:多层冲击环 + 中心火球
        const R = radius * CELL_CONV();
        const ex = 1 - t; // 扩散进度 0→1
        ctx.globalAlpha = t * 0.9;
        // 冲击环
        ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 4 * t + 1;
        ctx.beginPath(); ctx.arc(x, y, R * (0.5 + 0.6*ex), 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = '#ff6f00'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, R * (0.3 + 0.8*ex), 0, Math.PI*2); ctx.stroke();
        // 中心火球
        const g = ctx.createRadialGradient(x, y, 0, x, y, R*0.45);
        g.addColorStop(0, '#fff8e1'); g.addColorStop(0.4, '#ff9800'); g.addColorStop(1, 'rgba(230,81,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R*0.45*(1+0.3*ex), 0, Math.PI*2); ctx.fill();
        // 火花
        ctx.fillStyle = '#ffd54f';
        for (let i = 0; i < 8; i++) {
          const a = (i/8) * Math.PI * 2 + ex * 2;
          const d = R * (0.5 + 0.5*ex);
          ctx.beginPath(); ctx.arc(x + Math.cos(a)*d, y + Math.sin(a)*d, 2.5*t, 0, Math.PI*2); ctx.fill();
        }
        break;
      }
      case 'arrows': { // 箭雨:落下的箭矢扇形
        ctx.globalAlpha = t;
        ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 2;
        const R = radius * CELL_CONV();
        for (let i = 0; i < 12; i++) {
          const a = (i/12) * Math.PI * 2;
          const d = R * (0.3 + 0.55 * ((i*7919)%100)/100);
          const px = x + Math.cos(a)*d, py = y + Math.sin(a)*d;
          const ang = a + Math.PI/2;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(ang)*5, py - Math.sin(ang)*5);
          ctx.lineTo(px + Math.cos(ang)*5, py + Math.sin(ang)*5);
          ctx.stroke();
        }
        ctx.globalAlpha = t * 0.35;
        ctx.fillStyle = '#90a4ae';
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'lightning': case 'zap': { // 闪电:锯齿放电
        ctx.globalAlpha = t;
        const R = radius * CELL_CONV();
        ctx.strokeStyle = cardId === 'zap' ? '#4fc3f7' : '#ffee58';
        ctx.lineWidth = 3;
        for (let b = 0; b < 4; b++) {
          const a = (b/4)*Math.PI*2 + t*3;
          ctx.beginPath();
          let px = x, py = y - R*1.2;
          ctx.moveTo(px, py);
          for (let s = 0; s < 4; s++) {
            const frac = (s+1)/4;
            const jx = x + Math.cos(a)*R*0.3*frac + (Math.sin(s*13+b*7)*R*0.15);
            const jy = y - R*1.2 + frac * R*1.2;
            ctx.lineTo(jx, jy);
          }
          ctx.lineTo(x + Math.cos(a)*R*0.4, y + Math.sin(a)*R*0.2);
          ctx.stroke();
        }
        // 中心亮光
        ctx.globalAlpha = t * 0.6;
        ctx.fillStyle = cardId === 'zap' ? '#b3e5fc' : '#fff9c4';
        ctx.beginPath(); ctx.arc(x, y, R*0.4, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'freeze': { // 冰冻:冰晶六角
        ctx.globalAlpha = Math.min(1, t*1.5) * 0.85;
        const R = radius * CELL_CONV();
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, 'rgba(179,229,252,0.9)'); g.addColorStop(1, 'rgba(41,182,246,0.15)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#e1f5fe'; ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const a = (i/6)*Math.PI*2;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a)*R*0.2, y + Math.sin(a)*R*0.2);
          ctx.lineTo(x + Math.cos(a)*R*0.9, y + Math.sin(a)*R*0.9);
          ctx.stroke();
        }
        break;
      }
      case 'rage': { // 狂暴:红色粒子上升
        ctx.globalAlpha = t * 0.8;
        const R = radius * CELL_CONV();
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, 'rgba(255,23,68,0.4)'); g.addColorStop(1, 'rgba(255,23,68,0.05)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ff5252';
        for (let i = 0; i < 10; i++) {
          const a = (i/10)*Math.PI*2;
          const d = R * 0.6;
          const rise = (1-t) * R * 0.5;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a)*d, y + Math.sin(a)*d - rise, 3, 0, Math.PI*2);
          ctx.fill();
        }
        break;
      }
      default: { // 通用
        ctx.globalAlpha = t * 0.6;
        ctx.fillStyle = (card.color || '#fff');
        ctx.beginPath(); ctx.arc(x, y, radius * CELL_CONV(), 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // CELL 换算(graphics 可能晚于 constants 加载,用 getter)
  function CELL_CONV() { return CR.CELL; }

  CR.PAL = PAL;
  CR.GFX = {
    sideColors, orbFill, shade, roundRect,
    drawUnitIcon, drawSpellFx,
  };
})(window.CR);
