// ===============================================
// 玩家手牌 UI - 圣水条 + 4手牌 + next
// 增量更新(签名变化才重建,避免每帧重建导致点击丢失)
// 出牌回调由外部注入(保持 UI 无游戏逻辑)
// ===============================================
import { CARDS } from '../data/cards.js';
import { getCardUrl } from '../render/cardart.js';

export class HandUI {
  /**
   * @param el        #handArea 容器
   * @param onPlay    (handIndex) => void  点击手牌(选牌)回调
   * @param onDragCard (handIndex|null, phase) => void
   *                  拖拽手牌事件:phase 'start'|'move'|'end'
   *                  上层据此进入"携带卡牌"模式并在战场显示跟随预览
   * @param onPause   () => void  点击手牌栏暂停按钮回调
   */
  constructor(el, onPlay, onDragCard, onPause) {
    this.el = el;
    this.onPlay = onPlay;
    this.onDragCard = onDragCard || null;
    this.onPause = onPause || null;
    this.dragIdx = -1;          // 拖拽中的手牌 idx(-1 无)
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
      // 拖拽进行中不重建 DOM(重建会销毁被 pointer-capture 的卡牌,中断拖拽);
      // 拖拽结束后 invalidate 会补上这次重建
      if (this.dragIdx < 0) {
        this.lastSig = sig;
        this._render();
      }
    }
    this._updateElixirBar();
    this._updateLockMasks();
  }

  invalidate() { this.lastSig = ''; }

  /** 强制复位拖拽状态(重开局时调用:旧 DOM 若仍按住,解除门控并重建) */
  resetDrag() {
    if (this.dragIdx < 0) return;
    this.dragIdx = -1;
    const d = this.el.querySelector('.handCard.dragging');
    if (d) d.classList.remove('dragging');
    this.invalidate();
  }

  /** 圣水条增量更新:两段式 —— 已满格全紫 + 正在涨的格半透明,左→右 */
  _updateElixirBar() {
    const s = this.state;
    const bar = this._barRefs;
    if (!bar) return;
    const ef = Math.max(0, Math.min(10, s.elixirFloat != null ? s.elixirFloat : s.elixir));
    const whole = Math.floor(ef);
    const frac = ef - whole;
    const full = ef >= 9.999;

    // 已满格:全紫实心;当前格:半透明紫(涨满瞬间并入实心段)
    bar.fill.style.width = (whole * 10) + '%';
    bar.partial.style.left = (whole * 10) + '%';
    bar.partial.style.width = (frac * 10).toFixed(1) + '%';
    // 满水辉光
    bar.root.classList.toggle('full', full);
    // 数字徽章(data-num 供 CSS content 渲染)
    const shown = Math.floor(ef);
    if (shown !== this.lastElixirShown) {
      this.lastElixirShown = shown;
      bar.num.dataset.num = shown;
      bar.num.classList.remove('pop');
      void bar.num.offsetWidth;
      bar.num.classList.add('pop');
    }
  }

  /**
   * 费用不足遮罩:半透明黑扇形,随 elixirFloat 顺时针"消退"
   * progress = 已集满比例(0~1),对应角度 deg = progress*360;
   * 0~deg 已集满(透明),deg~360 还差多少(黑遮罩) —— 缺口从12点方向顺时针扩大
   */
  _updateLockMasks() {
    const refs = this._cardRefs;
    if (!refs) return;
    const s = this.state;
    const ef = Math.max(0, Math.min(10, s.elixirFloat != null ? s.elixirFloat : s.elixir));
    for (const r of refs) {
      const locked = ef < r.cost;
      r.el.classList.toggle('locked', locked);
      if (locked) {
        const progress = Math.max(0, Math.min(1, ef / r.cost));
        const deg = (progress * 360).toFixed(1);
        r.mask.style.background = `conic-gradient(transparent 0deg, transparent ${deg}deg, rgba(10,12,22,0.5) ${deg}deg, rgba(10,12,22,0.5) 360deg)`;
      }
    }
  }

  _render() {
    const s = this.state;
    const el = this.el;
    el.innerHTML = '';

    // 左侧 strip(托盘之外):❌ 暂停按钮 + "下一张"预览
    const leftCol = document.createElement('div');
    leftCol.className = 'handLeftCol';

    // 暂停按钮(对应原版截图 ❌ 按钮的位置与尺寸)
    if (this.onPause) {
      const pb = document.createElement('button');
      pb.className = 'handPauseBtn';
      pb.title = '暂停';
      pb.addEventListener('click', () => this.onPause());
      leftCol.appendChild(pb);
      this._pauseBtnEl = pb;
    }

    // next 卡(仅预览:加暗色遮罩 + 角标 + 禁点,防止误当成手牌点击)
    const nc = CARDS[s.next];
    const nd = document.createElement('div');
    nd.className = 'nextCard';
    nd.title = '下一张(预览,不可点击):' + nc.name;
    nd.innerHTML = `<div class="label">下一张</div>` +
      `<div class="nextWrap"><div class="nextArt" style="background-image:url('${getCardUrl(s.next)}');"></div>` +
      `<div class="nextCost">${nc.cost}</div></div>`;
    nd.addEventListener('click', () => {
      // 明确反馈:不是可打出的牌
      nd.classList.add('shake');
      setTimeout(() => nd.classList.remove('shake'), 500);
    });
    leftCol.appendChild(nd);
    el.appendChild(leftCol);

    // 木托盘:只包住 4 张手牌 + 圣水条
    const tray = document.createElement('div');
    tray.className = 'handTray';

    const row = document.createElement('div');
    row.className = 'handCards';
    this._cardRefs = [];
    for (let i = 0; i < s.hand.length; i++) {
      const cardId = s.hand[i];
      const card = CARDS[cardId];
      const cost = card.cost;
      const canPlay = s.elixir >= cost;
      const selected = i === s.selectedIdx;
      const d = document.createElement('div');
      d.className = 'handCard' + (selected ? ' selected' : '') + (canPlay ? '' : ' locked');
      d.title = card.name;
      d.innerHTML = `
        <div class="cardArt" style="background-image:url('${getCardUrl(cardId)}');">
          <div class="costMask"></div>
        </div>
        <div class="cost">${cost}</div>
      `;
      d.dataset.idx = i;
      this._cardRefs.push({ el: d, mask: d.querySelector('.costMask'), cost });
      // 始终绑定点击,内部判断圣水
      d.addEventListener('click', () => {
        // 拖拽过(发生了移动)的 pointerup 不触发选牌,由 pointer 逻辑处理
        if (d._dragConsumed) { d._dragConsumed = false; return; }
        this.onPlay(i);
      });
      // 拖拽部署:pointerdown 起,移动超阈值即进入携带模式,松手结束
      // (移动阈值防误触:轻点仍走 click 选牌)
      this._bindDrag(d, i, canPlay);
      row.appendChild(d);
    }
    tray.appendChild(row);
    el.appendChild(tray);
    this._updateLockMasks();

    // 圣水条(托盘底部):水滴徽标 + 两段式液体(已满格全紫/当前格半透明) + 分段线
    const bar = document.createElement('div');
    bar.className = 'elixirBar';
    bar.innerHTML = `
      <div class="eNum" data-num="0"></div>
      <div class="eTrack"><div class="eFill"></div><div class="ePartial"></div><div class="eSeg"></div></div>
    `;
    tray.appendChild(bar);
    // 缓存引用,供每帧增量更新
    this._barRefs = {
      root: bar,
      num: bar.querySelector('.eNum'),
      fill: bar.querySelector('.eFill'),
      partial: bar.querySelector('.ePartial'),
    };
    this.lastElixirShown = -1; // 强制下一帧刷新数字
    this._updateElixirBar();
  }

  /** 手牌拖拽:按下→移动超阈值进入携带→全局 move/up 追踪 */
  _bindDrag(d, i, canPlay) {
    let startX = 0, startY = 0, active = false;
    d.addEventListener('pointerdown', (e) => {
      if (!canPlay) return;                      // 圣水不足不可拖
      if (e.button !== undefined && e.button !== 0) return; // 仅主键/触摸
      startX = e.clientX; startY = e.clientY;
      active = true;
      // capture 保证 move/up 持续派发给本元素;失败(如合成事件)不中断
      try { d.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    d.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (this.dragIdx < 0 && (dx*dx + dy*dy) > 12*12) {  // 12px 阈值
        this.dragIdx = i;
        d._dragConsumed = true;
        d.classList.add('dragging');
        if (this.onDragCard) this.onDragCard(i, 'start');
      }
      if (this.dragIdx === i && this.onDragCard) this.onDragCard(i, 'move', e);
    });
    const end = (e) => {
      active = false;
      if (this.dragIdx === i) {
        d.classList.remove('dragging');
        this.dragIdx = -1;
        if (this.onDragCard) this.onDragCard(i, 'end', e);
      }
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
  }

  /**
   * 卡片尺寸适配(canvas 缩放联动,全屏布局统一按 canvas 宽算)
   * 布局:[左侧竖列(固定宽 leftColW)] + [4 手牌均分剩余宽度(flex,由 CSS 撑满)]
   * 这里只需算出每张手牌的等效宽度(用于卡高/字号/角标缩放的基准),
   * 实际卡片宽度由 .handCards flex 布局撑满,不用 JS 逐一设宽
   */
  static fitCards(canvas, scale) {
    const canvasW = canvas.getBoundingClientRect().width || 0;
    const leftColW = Math.max(40, Math.min(56, Math.floor(canvasW * 0.13)));
    // 4卡 + 3gap(12px) 需占满 (canvasW - 左strip宽 - strip与托盘gap - 托盘左右padding)
    const cardsAreaW = Math.max(0, canvasW - leftColW - 6 - 14 - 3*12);
    let cardW = Math.max(52, Math.min(96, Math.floor(cardsAreaW / 4)));
    // 手牌区(含圣水条)与战场 canvas 同宽,保证圣水条占满"当前栏"
    const ha = document.getElementById('handArea');
    if (ha) ha.style.maxWidth = Math.max(0, canvasW) + 'px';
    document.documentElement.style.setProperty('--leftcol-w', leftColW + 'px');
    document.documentElement.style.setProperty('--card-w', cardW + 'px');
    document.documentElement.style.setProperty('--card-h', Math.floor(cardW * 1.25) + 'px');
    document.documentElement.style.setProperty('--card-font', Math.max(9, Math.floor(cardW * 0.14)) + 'px');
    document.documentElement.style.setProperty('--orb-size', Math.floor(cardW * 0.38) + 'px');
  }
}
