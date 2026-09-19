// ===============================================
// 卡组编辑器 - 5 个可编辑卡组槽,localStorage 持久化
// 数据结构:槽 0~4,各自 8 张卡 id 数组
// 槽即游戏内可选卡组(deckSelect value = 'slot0'..'slot4')
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const LS_KEY = 'CR_CUSTOM_DECKS_V1';
  const DECK_SIZE = 8;

  // 默认 5 套卡组(与原预设一致,作为"恢复默认"基准)
  const DEFAULT_DECKS = [
    { name: '巨人体系', cards: ['giant', 'miniPekka', 'musketeer', 'wizard', 'skeletons', 'arrows', 'fireball', 'minions'] },
    { name: '野猪快攻', cards: ['hogRider', 'musketeer', 'archers', 'skeletons', 'zap', 'fireball', 'cannon', 'goblins'] },
    { name: '戈仑重击', cards: ['golem', 'babyDragon', 'miniPekka', 'wizard', 'minions', 'arrows', 'zap', 'barbarianHut'] },
    { name: '空军流',   cards: ['balloon', 'minionHorde', 'minions', 'babyDragon', 'musketeer', 'arrows', 'fireball', 'skeletons'] },
    { name: '速转流',   cards: ['hogRider', 'skeletons', 'goblins', 'spearGoblins', 'zap', 'archers', 'fireball', 'musketeer'] },
  ];

  // ===== 存取 =====
  function loadDecks() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { saved = null; }
    const decks = DEFAULT_DECKS.map(d => ({ name: d.name, cards: d.cards.slice() }));
    if (saved && Array.isArray(saved)) {
      for (let i = 0; i < decks.length; i++) {
        const s = saved[i];
        if (s && Array.isArray(s.cards)) {
          // 只保留有效、不重复的卡,截断到 8
          const valid = [...new Set(s.cards)].filter(id => CR.CARDS[id] && !CR.CARDS[id].hidden && id !== 'golemite');
          decks[i].cards = valid.slice(0, DECK_SIZE);
          if (s.name) decks[i].name = String(s.name).slice(0, 8);
        }
      }
    }
    return decks;
  }

  function saveDecks(decks) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(decks)); } catch (e) { /* 隐私模式等存不进则忽略 */ }
  }

  // ===== 编辑器 UI =====
  let editorEl = null, slotsEl = null, deckRowEl = null, gridEl = null, curLabelEl = null, avgEl = null;
  let curSlot = 0;
  let decks = null;
  let onChangeCb = null; // 数据变化回调(刷新 deckSelect)

  function ensureEls() {
    if (editorEl) return;
    editorEl = document.getElementById('deckEditor');
    slotsEl = document.getElementById('deSlots');
    deckRowEl = document.getElementById('deDeckRow');
    gridEl = document.getElementById('deCardGrid');
    curLabelEl = document.getElementById('deCurLabel');
    avgEl = document.getElementById('deAvg');

    document.getElementById('deDone').addEventListener('click', close);
    document.getElementById('deClear').addEventListener('click', () => {
      decks[curSlot].cards = [];
      persistAndRender();
    });
    document.getElementById('deReset').addEventListener('click', () => {
      decks[curSlot].cards = DEFAULT_DECKS[curSlot].cards.slice();
      persistAndRender();
    });
    // 点击遮罩关闭
    editorEl.addEventListener('click', (e) => { if (e.target === editorEl) close(); });
  }

  function persistAndRender() {
    saveDecks(decks);
    renderSlots();
    renderDeckRow();
    renderGrid();
    renderAvg();
    if (onChangeCb) onChangeCb();
  }

  function renderSlots() {
    slotsEl.innerHTML = '';
    decks.forEach((d, i) => {
      const s = document.createElement('div');
      s.className = 'deSlot' + (i === curSlot ? ' active' : '');
      s.innerHTML = `<div class="deSlotName">${i + 1}. ${d.name}</div>` +
        `<div class="deSlotCount">${d.cards.length}/8 张</div>`;
      s.addEventListener('click', () => { curSlot = i; persistAndRender(); });
      slotsEl.appendChild(s);
    });
  }

  function cardChipHtml(id, extraCls) {
    const c = CR.CARDS[id];
    return `<div class="deDeckCard ${extraCls || ''}" data-card="${id}">
      <div class="deName">${c.name}</div>
      <div class="deOrb" style="background:${c.color};"></div>
      <div class="deCost">💧${c.cost}</div>
      <div class="deRm">✕</div>
    </div>`;
  }

  function renderDeckRow() {
    const d = decks[curSlot];
    curLabelEl.textContent = `当前编辑:卡组 ${curSlot + 1}「${d.name}」`;
    deckRowEl.innerHTML = d.cards.length
      ? d.cards.map(id => cardChipHtml(id)).join('')
      : '<div style="color:#6b7399;font-size:11px;align-self:center;margin:auto;">空卡组 — 点击下方卡牌加入</div>';
    // 点击卡组中的卡 = 移除
    deckRowEl.querySelectorAll('.deDeckCard').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.card;
        const arr = decks[curSlot].cards;
        arr.splice(arr.indexOf(id), 1);
        persistAndRender();
      });
    });
  }

  function renderGrid() {
    const inDeck = new Set(decks[curSlot].cards);
    gridEl.innerHTML = CR.SELECTABLE_CARDS.map(id => {
      const c = CR.CARDS[id];
      return `<div class="dePoolCard ${inDeck.has(id) ? 'inDeck' : ''}" data-card="${id}">
        <div class="deRarityTag" style="background:${rarityColor(c.rarity)};"></div>
        <div class="deName">${c.name}</div>
        <div class="deOrb" style="background:${c.color};"></div>
        <div class="deCost">💧${c.cost}</div>
      </div>`;
    }).join('');
    gridEl.querySelectorAll('.dePoolCard').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.card;
        const arr = decks[curSlot].cards;
        if (arr.includes(id)) return; // 已在卡组
        if (arr.length >= DECK_SIZE) return; // 已满 8 张
        arr.push(id);
        persistAndRender();
      });
    });
  }

  function rarityColor(r) {
    return { '普通': '#cfd8dc', '稀有': '#ffb74d', '史诗': '#ba68c8' }[r] || '#cfd8dc';
  }

  function renderAvg() {
    const d = decks[curSlot];
    if (!d.cards.length) { avgEl.innerHTML = '平均圣水:—'; return; }
    const avg = d.cards.reduce((s, id) => s + CR.CARDS[id].cost, 0) / d.cards.length;
    avgEl.innerHTML = `平均圣水:<b>${avg.toFixed(1)}</b> · ${d.cards.length}/8 张`;
  }

  function open(slot) {
    ensureEls();
    decks = loadDecks();
    if (typeof slot === 'number') curSlot = Math.max(0, Math.min(decks.length - 1, slot));
    editorEl.classList.add('show');
    persistAndRender();
  }

  function close() {
    if (editorEl) editorEl.classList.remove('show');
  }

  function isOpen() { return editorEl && editorEl.classList.contains('show'); }

  // ===== 对外接口 =====
  CR.DeckEditor = {
    open, close, isOpen,
    loadDecks,                 // 读取(含本地覆盖)后的 5 套卡组
    DEFAULT_DECKS,
    onChange(cb) { onChangeCb = cb; },
  };
})(window.CR);
