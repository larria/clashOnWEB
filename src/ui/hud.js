// ===============================================
// HUD - 倒计时/阶段标签 + 中央大提示 + 战斗信息面板
// ===============================================
import { MATCH_TIME } from '../core/constants.js';

export class Hud {
  constructor({ hudTimer, hudPhase, bigAnnounce, info: infoEl }) {
    this.timerEl = hudTimer;
    this.phaseEl = hudPhase;
    this.announceEl = bigAnnounce;
    this.infoEl = infoEl;
  }

  /** 每帧调用(game 为当前局;仅 playing 时) */
  update(game) {
    const remain = Math.max(0, MATCH_TIME - game.time);
    const m = String(Math.floor(remain/60)).padStart(2,'0');
    const s = String(Math.floor(remain%60)).padStart(2,'0');
    this.timerEl.textContent = `${m}:${s}`;
    // 危险态:最后60秒变红,最后10秒脉冲
    this.timerEl.classList.toggle('danger', remain <= 60);
    this.timerEl.classList.toggle('pulse', remain <= 10);
    // 阶段标签
    if (game.doubleElixir) {
      this.phaseEl.textContent = '双倍圣水 ×2';
      this.phaseEl.classList.add('double');
    } else {
      this.phaseEl.textContent = '常规时间';
      this.phaseEl.classList.remove('double');
    }
  }

  /** 信息面板(每帧,任意 phase) */
  renderInfo(game) { this._renderInfo(game); }

  _renderInfo(game) {
    const remain = Math.max(0, Math.ceil(MATCH_TIME - game.time));
    const m = String(Math.floor(remain/60)).padStart(2,'0');
    const s = String(remain%60).padStart(2,'0');
    const de = game.doubleElixir ? ' <span style="color:#ff8a80;font-weight:700;">×2</span>' : '';
    const pt = game.towers[0], at = game.towers[1];
    const towerLine = (tw, color) => {
      const hp = tw.dead ? '<span style="color:#666;">✕</span>' : Math.round(tw.hp);
      return `<span style="color:${color};">${hp}</span>`;
    };
    this.infoEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:15px;font-weight:700;letter-spacing:1px;">⏳ 剩余 ${m}:${s}</span>${de ? `<span style="background:rgba(255,80,80,0.18);padding:1px 8px;border-radius:8px;font-size:10px;color:#ff8a80;border:1px solid rgba(255,80,80,0.35);">⚡双倍圣水</span>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;">
        <span style="color:#e07bff;">💧 你 <b>${game.elixir[0]}</b>/10</span>
        <span style="color:#ffab91;">AI <b>${game.elixir[1]}</b>/10 💧</span>
      </div>
      <div style="height:1px;background:rgba(255,255,255,0.1);margin:7px 0;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
        <span style="color:#7fd4ff;">👑 ${Math.max(0,Math.round(pt.king.hp))}</span>
        <span style="color:#7fd4ff;font-size:10px;">你的塔</span>
        <span>🏰 ${towerLine(pt.left,'#7fd4ff')} · ${towerLine(pt.right,'#7fd4ff')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-top:3px;">
        <span style="color:#ffab91;">👑 ${Math.max(0,Math.round(at.king.hp))}</span>
        <span style="color:#ffab91;font-size:10px;">AI的塔</span>
        <span>🏰 ${towerLine(at.left,'#ffab91')} · ${towerLine(at.right,'#ffab91')}</span>
      </div>
    `;
  }

  /** 中央大提示(字号按 canvas 宽自适应,防止长文案溢出) */
  announce(main, sub, color) {
    this.announceEl.innerHTML = `<div class="baMain" style="color:${color || '#ffe082'};">${main}</div>` +
      (sub ? `<div class="baSub">${sub}</div>` : '');
    // 按显示宽度自适应:基础 42px,每字符约占 1.05em,超出则等比缩小
    const mainEl = this.announceEl.querySelector('.baMain');
    const canvasW = this.announceEl.parentElement.getBoundingClientRect().width;
    if (mainEl) {
      const chars = main.replace(/\s/g, '').length;
      const fit = Math.max(16, Math.min(42, (canvasW * 0.92) / (chars * 1.12)));
      mainEl.style.fontSize = fit.toFixed(0) + 'px';
    }
    this.announceEl.classList.remove('show');
    // 强制重启动画
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('show');
  }
}
