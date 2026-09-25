// ===============================================
// 卡组系统(双轨制,v0.6.12 重设计)
//
//   经典卡组(CLASSIC_DECKS,代码内置,只读):
//     - 永远展示、永远可用,不受 localStorage 影响
//     - 内容随版本更新(新卡实装即进经典卡组)
//   玩家自定义卡组(localStorage 持久化,CR_USER_DECKS_V1):
//     - 可新建/删除/重命名,存玩家自编的 8 张组合
//     - 互相独立;清缓存/换设备只丢自定义,经典卡组无感
//
// 对外接口(不变):loadDecks() 返回 [{name, cards, kind}] 供
// main.js 下拉渲染;deckEditor 编辑器只编辑自定义卡组(经典卡组
// 只读展示,点击提示"经典卡组不可编辑")。
// ===============================================
import { CARDS, SELECTABLE_CARDS } from '../data/cards.js';
import { appBus } from '../core/events.js';
import { getCardUrl } from '../render/cardart.js';

const LS_KEY = 'CR_USER_DECKS_V1';
const LS_LAST_KEY = 'CR_LAST_DECK';
const DECK_SIZE = 8;
export const MAX_USER_DECKS = 8;   // 自定义卡组上限

// ===== 经典卡组(代码内置,只读;新卡实装在此维护)=====
export const CLASSIC_DECKS = [
  { name: '速转猪',   cards: ['hogRider', 'iceSpirit', 'iceGolem', 'theLog', 'skeletons', 'cannon', 'zap', 'fireball'] },
  { name: '巨人体系', cards: ['giant', 'darkPrince', 'threeMusketeers', 'wizard', 'skeletons', 'arrows', 'poison', 'minions'] },
  { name: '戈仑重击', cards: ['golem', 'babyDragon', 'miniPekka', 'iceWizard', 'minions', 'arrows', 'zap', 'barbarianHut'] },
  { name: '空军流',   cards: ['balloon', 'minionHorde', 'minions', 'babyDragon', 'musketeer', 'arrows', 'fireball', 'skeletons'] },
  { name: '速转流',   cards: ['hogRider', 'skeletons', 'goblins', 'spearGoblins', 'zap', 'archers', 'fireball', 'musketeer'] },
  { name: '公主控制', cards: ['princess', 'knight', 'musketeer', 'skeletonArmy', 'fireball', 'zap', 'cannon', 'goblins'] },
];

// ===== 自定义卡组存取 =====
function sanitizeCards(ids) {
  return [...new Set(ids)].filter(id => CARDS[id] && !CARDS[id].hidden && id !== 'golemite').slice(0, DECK_SIZE);
}
export function loadUserDecks() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { saved = null; }
  const out = [];
  if (saved && Array.isArray(saved.decks)) {
    for (const s of saved.decks) {
      if (!s || !Array.isArray(s.cards)) continue;
      out.push({
        name: String(s.name || '自定义').slice(0, 8),
        cards: sanitizeCards(s.cards),
        kind: 'user',
      });
    }
  }
  return out.slice(0, MAX_USER_DECKS);
}
function saveUserDecks(decks) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, decks }));
  } catch (e) { /* 隐私模式等存不进则忽略 */ }
}

// 全量卡组(经典 + 自定义):供下拉选择
export function loadDecks() {
  return [
    ...CLASSIC_DECKS.map(d => ({ name: d.name, cards: d.cards.slice(), kind: 'classic' })),
    ...loadUserDecks(),
  ];
}

// ===== 选中记忆 =====
export function saveLastDeck(deckKey) {
  try { localStorage.setItem(LS_LAST_KEY, String(deckKey)); } catch (e) { /* 忽略 */ }
}
export function getLastDeck() {
  try { return localStorage.getItem(LS_LAST_KEY); } catch (e) { return null; }
}

// ===== 编辑器 UI(只编辑自定义卡组)=====
export class DeckEditor {
  constructor() {
    this.editorEl = null;
    this.curSlot = null;      // 自定义卡组索引(null=未选中/经典)
    this.userDecks = null;
    this._els = {};
  }

  _ensureEls() {
    if (this.editorEl) return;
    this.editorEl = document.getElementById('deckEditor');
    this._els = {
      slots: document.getElementById('deSlots'),
      deckRow: document.getElementById('deDeckRow'),
      grid: document.getElementById('deCardGrid'),
      curLabel: document.getElementById('deCurLabel'),
      avg: document.getElementById('deAvg'),
    };
    document.getElementById('deDone').addEventListener('click', () => this.close());
    document.getElementById('deClear').addEventListener('click', () => {
      if (this.curSlot == null) return;
      this.userDecks[this.curSlot].cards = [];
      this._persistAndRender();
    });
    document.getElementById('deReset').addEventListener('click', () => {
      if (this.curSlot == null) return;
      this.userDecks[this.curSlot].cards = [];
      this.userDecks[this.curSlot].name = '自定义';
      this._persistAndRender();
    });
    this.editorEl.addEventListener('click', (e) => { if (e.target === this.editorEl) this.close(); });
  }

  _persistAndRender() {
    saveUserDecks(this.userDecks);
    this._renderSlots();
    this._renderDeckRow();
    this._renderGrid();
    this._renderAvg();
    appBus.emit('decks:changed', {});
  }

  _renderSlots() {
    const { slots } = this._els;
    slots.innerHTML = '';
    // 经典卡组区(只读)
    const clsHead = document.createElement('div');
    clsHead.className = 'deSlotHead';
    clsHead.textContent = '经典卡组(内置·不可编辑)';
    slots.appendChild(clsHead);
    CLASSIC_DECKS.forEach((d) => {
      const s = document.createElement('div');
      s.className = 'deSlot classic';
      s.innerHTML = `<div class="deSlotName">★ ${d.name}</div>
        <div class="deSlotCount">${d.cards.length}/8 张</div>`;
      s.addEventListener('click', () => {
        this.curSlot = null;
        this._renderSlots(); this._renderDeckRow(); this._renderGrid(); this._renderAvg();
      });
      slots.appendChild(s);
    });
    // 自定义区
    const usrHead = document.createElement('div');
    usrHead.className = 'deSlotHead';
    usrHead.innerHTML = `我的卡组(${this.userDecks.length}/${MAX_USER_DECKS})` +
      (this.userDecks.length < MAX_USER_DECKS
        ? ` <button class="btn btn-blue btn-sm" id="deNewBtn">+ 新建</button>` : '');
    usrHead.querySelector('#deNewBtn')?.addEventListener('click', () => {
      this.userDecks.push({ name: `自定义${this.userDecks.length + 1}`, cards: [], kind: 'user' });
      this.curSlot = this.userDecks.length - 1;
      this._persistAndRender();
    });
    slots.appendChild(usrHead);
    if (!this.userDecks.length) {
      const empty = document.createElement('div');
      empty.className = 'deSlot empty';
      empty.innerHTML = '<div class="deSlotName" style="color:#6b7399;">暂无自定义卡组</div>';
      slots.appendChild(empty);
    }
    this.userDecks.forEach((d, i) => {
      const s = document.createElement('div');
      s.className = 'deSlot' + (i === this.curSlot ? ' active' : '');
      const empty = d.cards.length === 0;
      s.innerHTML = `<div class="deSlotName">${i + 1}. ${d.name}</div>
        <div class="deSlotCount ${empty ? 'empty' : ''}">${d.cards.length}/8 张</div>
        <div class="deDel" title="删除卡组">🗑</div>`;
      s.addEventListener('click', (e) => {
        if (e.target.classList.contains('deDel')) {
          this.userDecks.splice(i, 1);
          this.curSlot = null;
          this._persistAndRender();
          return;
        }
        this.curSlot = i;
        this._renderSlots(); this._renderDeckRow(); this._renderGrid(); this._renderAvg();
      });
      slots.appendChild(s);
    });
  }

  _renderDeckRow() {
    const { deckRow, curLabel } = this._els;
    if (this.curSlot == null) {
      curLabel.innerHTML = '经典卡组为内置预设,点击下方"我的卡组"新建或编辑自定义卡组';
      deckRow.innerHTML = '<div style="color:#6b7399;font-size:11px;align-self:center;margin:auto;">选择一个自定义卡组开始编辑</div>';
      return;
    }
    const d = this.userDecks[this.curSlot];
    curLabel.innerHTML = `我的卡组 ${this.curSlot + 1} ` +
      `<input id="deNameInput" class="deNameInput" value="${d.name.replace(/"/g, '&quot;')}" maxlength="8" title="点击修改名称">`;
    curLabel.querySelector('#deNameInput').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) {
        d.name = v.slice(0, 8);
        saveUserDecks(this.userDecks);
        this._renderSlots();
        appBus.emit('decks:changed', {});
      }
    });
    deckRow.innerHTML = d.cards.length
      ? d.cards.map(id => this._cardChipHtml(id)).join('')
      : '<div style="color:#6b7399;font-size:11px;align-self:center;margin:auto;">空卡组 — 点击下方卡牌加入</div>';
    deckRow.querySelectorAll('.deDeckCard').forEach(el => {
      el.addEventListener('click', () => {
        const arr = this.userDecks[this.curSlot].cards;
        arr.splice(arr.indexOf(el.dataset.card), 1);
        this._persistAndRender();
      });
    });
  }

  _cardChipHtml(id) {
    const c = CARDS[id];
    return `<div class="deDeckCard" data-card="${id}">
      <div class="deArt" style="background-image:url('${getCardUrl(id)}');"></div>
      <div class="deName">${c.name}</div>
      <div class="deCost">💧${c.cost}</div>
      <div class="deRm">✕</div>
    </div>`;
  }

  _renderGrid() {
    const { grid } = this._els;
    if (this.curSlot == null) {
      grid.innerHTML = '';
      grid.style.opacity = '0.35';
      grid.style.pointerEvents = 'none';
      return;
    }
    grid.style.opacity = '1';
    grid.style.pointerEvents = '';
    const inDeck = new Set(this.userDecks[this.curSlot].cards);
    grid.innerHTML = SELECTABLE_CARDS.map(id => {
      const c = CARDS[id];
      return `<div class="dePoolCard ${inDeck.has(id) ? 'inDeck' : ''}" data-card="${id}">
        <div class="deRarityTag" style="background:${rarityColor(c.rarity)};"></div>
        <div class="deArt" style="background-image:url('${getCardUrl(id)}');"></div>
        <div class="deName">${c.name}</div>
        <div class="deCost">💧${c.cost}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.dePoolCard').forEach(el => {
      el.addEventListener('click', () => {
        const arr = this.userDecks[this.curSlot].cards;
        if (arr.includes(el.dataset.card)) return;
        if (arr.length >= DECK_SIZE) return;
        arr.push(el.dataset.card);
        this._persistAndRender();
      });
    });
  }

  _renderAvg() {
    const { avg } = this._els;
    if (this.curSlot == null) { avg.innerHTML = ''; return; }
    const d = this.userDecks[this.curSlot];
    if (!d.cards.length) { avg.innerHTML = '平均圣水:—'; return; }
    const a = d.cards.reduce((s, id) => s + CARDS[id].cost, 0) / d.cards.length;
    avg.innerHTML = `平均圣水:<b>${a.toFixed(1)}</b> · ${d.cards.length}/8 张`;
  }

  open(slot) {
    this._ensureEls();
    this.userDecks = loadUserDecks();
    // slot 兼容旧 key('slotN'):N>=经典数则对应自定义索引
    if (typeof slot === 'number') {
      this.curSlot = slot >= CLASSIC_DECKS.length ? Math.min(slot - CLASSIC_DECKS.length, this.userDecks.length - 1) : null;
      if (this.curSlot != null && this.curSlot < 0) this.curSlot = null;
    } else {
      this.curSlot = this.userDecks.length ? 0 : null;
    }
    this.editorEl.classList.add('show');
    this._persistAndRender();
  }

  close() {
    if (this.editorEl) this.editorEl.classList.remove('show');
  }

  isOpen() { return this.editorEl && this.editorEl.classList.contains('show'); }
}

function rarityColor(r) {
  return { '普通': '#cfd8dc', '稀有': '#ffb74d', '史诗': '#ba68c8', '传奇': '#7de3ff' }[r] || '#cfd8dc';
}

export const deckEditor = new DeckEditor();
