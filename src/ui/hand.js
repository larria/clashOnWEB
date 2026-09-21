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
    this.lastBarSig = '';
    this.lastElixirShown = -1; // 圣水数字徽章上次显示值(检测变化触发弹跳)
    this.state = { hand: [], next: null, elixir: 0, elixirFloat: 0, selectedIdx: -1 };
  }

  /** 每帧调用:手牌变化重建;圣水条只做增量样式更新(不重建 DOM,防点击丢失) */
  update(state) {
    Object.assign(this.state, state);
    const s = this.state;
    const sig = s.hand.join(',') + '|' + s.selectedIdx + '|' + s.elixir;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this._render();
    }
    this._updateElixirBar();
  }

  invalidate() { this.lastSig = ''; }

  /** 圣水条增量更新:连续充盈进度(原版按小数部分平滑上涨) */
  _updateElixirBar() {
    const s = this.state;
    const bar = this._barRefs;
    if (!bar) return;
    const ef = Math.max(0, Math.min(10, s.elixirFloat != null ? s.elixirFloat : s.elixir));
    const whole = Math.floor(ef);
    const frac = ef - whole;
    const full = ef >= 9.999;

    // 10 个液槽:已满格 100%,当前格按小数充盈,其余 0
    for (let i = 0; i < 10; i++) {
      const p = i < whole ? 1 : (i === whole ? frac : 0);
      const f = bar.fills[i];
      if (f) f.style.height = (p * 100).toFixed(1) + '%';
    }
    // 满水辉光
    bar.root.classList.toggle('full', full);
    bar.root.classList.toggle('gushing', full && ef >= 10);
    // 数字徽章
    const shown = Math.floor(ef);
    if (shown !== this.lastElixirShown) {
      this.lastElixirShown = shown;
      bar.num.textContent = shown;
      bar.num.classList.remove('pop');
      void bar.num.offsetWidth;
      bar.num.classList.add('pop');
    }
  }

  _render() {
    const s = this.state;
    const el = this.el;
    el.innerHTML = '';

    // 圣水条(全宽液态分段条,对齐原版:连续充盈+满水辉光)
    const bar = document.createElement('div');
    bar.className = 'elixirBar';
    let slotsHtml = '';
    for (let i = 0; i < 10; i++) {
      slotsHtml += `<div class="eSlot"><div class="eFill"></div></div>`;
    }
    bar.innerHTML = `
      <div class="eNum" data-num>0</div>
      <div class="eTrack">${slotsHtml}</div>
    `;
    el.appendChild(bar);
    // 缓存引用,供每帧增量更新
    this._barRefs = {
      root: bar,
      num: bar.querySelector('.eNum'),
      fills: [...bar.querySelectorAll('.eFill')],
    };
    this.lastElixirShown = -1; // 强制下一帧刷新数字
    this._updateElixirBar();

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
    // 手牌区(含圣水条)与战场 canvas 同宽,保证圣水条占满"当前栏"
    const ha = document.getElementById('handArea');
    if (ha) ha.style.maxWidth = Math.max(0, canvasW) + 'px';
    document.documentElement.style.setProperty('--card-w', cardW + 'px');
    document.documentElement.style.setProperty('--card-h', Math.floor(cardW * 1.25) + 'px');
    document.documentElement.style.setProperty('--card-font', Math.max(9, Math.floor(cardW * 0.14)) + 'px');
    document.documentElement.style.setProperty('--orb-size', Math.floor(cardW * 0.38) + 'px');
  }
}
