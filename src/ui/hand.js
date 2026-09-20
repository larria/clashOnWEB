// ===============================================
// 玩家手牌 UI - 圣水条 + 4手牌 + next
// 增量更新(签名变化才重建,避免每帧重建导致点击丢失)
// 出牌回调由外部注入(保持 UI 无游戏逻辑)
// ===============================================
import { CARDS } from '../data/cards.js';
import { getCardUrl } from '../render/cardart.js';

export class HandUI {
  /**
   * @param el       #handArea 容器
   * @param onPlay   (handIndex) => void  点击手牌(选牌)回调
   */
  constructor(el, onPlay) {
    this.el = el;
    this.onPlay = onPlay;
    this.lastSig = '';
    this.state = { hand: [], next: null, elixir: 0, selectedIdx: -1 };
  }

  /** 每帧调用:状态变化时重建 DOM */
  update(state) {
    Object.assign(this.state, state);
    const s = this.state;
    const sig = s.hand.join(',') + '|' + s.selectedIdx + '|' + s.elixir;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this._render();
  }

  invalidate() { this.lastSig = ''; }

  _render() {
    const s = this.state;
    const el = this.el;
    el.innerHTML = '';

    // 圣水条(立体珠+满水光晕)
    const isMobile = window.innerWidth <= 860;
    const orbSz = isMobile ? 11 : 14;
    const full = s.elixir >= 10;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;margin-bottom:5px;padding:4px 8px;border-radius:10px;background:rgba(12,15,30,0.6);border:1px solid rgba(255,255,255,0.08);' + (full ? 'box-shadow:0 0 12px rgba(210,76,255,0.5);' : '');
    let barHtml = '<div style="display:flex;gap:2px;flex-wrap:nowrap;">';
    for (let i = 0; i < 10; i++) {
      const filled = i < s.elixir;
      barHtml += `<div style="width:${orbSz}px;height:${orbSz}px;border-radius:50%;flex-shrink:0;${filled
        ? `background:radial-gradient(circle at 35% 30%, #f2a7ff, #d24cff 55%, #8a1ec9);box-shadow:0 1px 3px rgba(0,0,0,0.5), inset 0 -2px 3px rgba(0,0,0,0.3);border:1px solid #5c1090;`
        : `background:radial-gradient(circle at 35% 30%, #3a4266, #262b4a);border:1px solid #1a1e38;`}"></div>`;
    }
    barHtml += `</div><div style="margin-left:6px;color:#e07bff;font-weight:800;font-size:${orbSz+4}px;text-shadow:0 0 8px rgba(210,76,255,0.6);">${s.elixir}</div>`;
    bar.innerHTML = barHtml;
    el.appendChild(bar);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;max-width:100%;';
    for (let i = 0; i < s.hand.length; i++) {
      const cardId = s.hand[i];
      const card = CARDS[cardId];
      const cost = card.cost;
      const canPlay = s.elixir >= cost;
      const selected = i === s.selectedIdx;
      const d = document.createElement('div');
      d.className = 'handCard';
      // 选中态:金边+上浮+光晕;不可用:暗化
      d.style.cssText = selected
        ? `border-color:#ffd54f;transform:translateY(-6px);box-shadow:0 8px 18px rgba(0,0,0,0.55), 0 0 14px rgba(255,213,79,0.35);`
        : (canPlay ? '' : 'opacity:0.45;filter:grayscale(0.5);cursor:not-allowed;');
      d.innerHTML = `
        <div class="cardArt" style="background-image:url('${getCardUrl(cardId)}');"></div>
        <div class="cardName">${card.name}</div>
        <div class="cost">💧${cost}</div>
      `;
      d.dataset.idx = i;
      // 始终绑定点击,内部判断圣水
      d.addEventListener('click', () => this.onPlay(i));
      row.appendChild(d);
    }
    // next 卡(仅预览:加暗色遮罩 + 角标 + 禁点,防止误当成手牌点击)
    const nc = CARDS[s.next];
    const nd = document.createElement('div');
    nd.className = 'nextCard';
    nd.title = '下一张(预览,不可点击)';
    nd.innerHTML = `<div class="label">下一张</div>` +
      `<div class="nextWrap"><div class="nextArt" style="background-image:url('${getCardUrl(s.next)}');"></div>` +
      `<div class="nextVeil"><span>NEXT</span></div></div>` +
      `<div style="font-weight:700;color:${nc.color};font-size:calc(var(--card-font) - 1px);">${nc.name}</div>` +
      `<div style="color:#e07bff;font-weight:700;">💧${nc.cost}</div>`;
    nd.addEventListener('click', () => {
      // 明确反馈:不是可打出的牌
      const el = nd.querySelector('.nextVeil span');
      if (el) {
        el.textContent = '不可点击';
        nd.classList.add('shake');
        setTimeout(() => { el.textContent = 'NEXT'; nd.classList.remove('shake'); }, 900);
      }
    });
    row.appendChild(nd);
    el.appendChild(row);
  }

  /** 卡片尺寸适配(canvas 缩放联动) */
  static fitCards(canvas, scale) {
    const isMobile = window.innerWidth <= 860;
    const canvasW = canvas.getBoundingClientRect().width || 0;
    let cardW = 80;
    if (isMobile) {
      // 4卡 + next(0.75卡) + 4gap 需 ≤ canvasW
      cardW = Math.max(52, Math.floor((canvasW - 4*6) / 4.75));
    }
    document.documentElement.style.setProperty('--card-w', cardW + 'px');
    document.documentElement.style.setProperty('--card-h', Math.floor(cardW * 1.25) + 'px');
    document.documentElement.style.setProperty('--card-font', Math.max(9, Math.floor(cardW * 0.14)) + 'px');
    document.documentElement.style.setProperty('--orb-size', Math.floor(cardW * 0.38) + 'px');
  }
}
