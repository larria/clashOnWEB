// ===============================================
// 卡组编辑器 - 10 个可编辑卡组槽,localStorage 持久化
// 槽 0~4 预填经典卡组,槽 5~9 初始为空待编辑
// 槽即游戏内可选卡组(deckSelect value = 'slot0'..'slot9')
// 选中卡组持久记忆(CR_LAST_DECK),直至再次切换
// ===============================================
import { CARDS, SELECTABLE_CARDS } from '../data/cards.js';
import { appBus } from '../core/events.js';
import { getCardUrl } from '../render/cardart.js';

const LS_KEY = 'CR_CUSTOM_DECKS_V1';
const LS_LAST_KEY = 'CR_LAST_DECK';
export const DECK_COUNT = 10;
const DECK_SIZE = 8;

// 预填 5 套经典卡组(槽 0~4 的"恢复默认"基准);槽 5~9 无默认(空)
// 槽 0 = 玩家默认卡组(野猪快攻)
const DEFAULT_DECKS = [
  { name: '野猪快攻', cards: ['hogRider', 'musketeer', 'archers', 'skeletons', 'zap', 'fireball', 'cannon', 'goblins'] },
  { name: '巨人体系', cards: ['giant', 'miniPekka', 'musketeer', 'wizard', 'skeletons', 'arrows', 'fireball', 'minions'] },
  { name: '戈仑重击', cards: ['golem', 'babyDragon', 'miniPekka', 'wizard', 'minions', 'arrows', 'zap', 'barbarianHut'] },
  { name: '空军流',   cards: ['balloon', 'minionHorde', 'minions', 'babyDragon', 'musketeer', 'arrows', 'fireball', 'skeletons'] },
  { name: '速转流',   cards: ['hogRider', 'skeletons', 'goblins', 'spearGoblins', 'zap', 'archers', 'fireball', 'musketeer'] },
];

// ===== 存取 =====
export function loadDecks() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { saved = null; }
  // 基准:5 预设 + 5 空槽
  const decks = [];
  for (let i = 0; i < DECK_COUNT; i++) {
    if (i < DEFAULT_DECKS.length) {
      decks.push({ name: DEFAULT_DECKS[i].name, cards: DEFAULT_DECKS[i].cards.slice() });
    } else {
      decks.push({ name: `自定义${i - 4}`, cards: [] });
    }
  }
  if (saved && Array.isArray(saved)) {
    for (let i = 0; i < DECK_COUNT; i++) {
      const s = saved[i];
      if (s && Array.isArray(s.cards)) {
        // 只保留有效、不重复的卡,截断到 8
        const valid = [...new Set(s.cards)].filter(id => CARDS[id] && !CARDS[id].hidden && id !== 'golemite');
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

// ===== 选中记忆 =====
/** 记住玩家选中的卡组(下次进入默认使用) */
export function saveLastDeck(slotKey) {
  try { localStorage.setItem(LS_LAST_KEY, String(slotKey)); } catch (e) { /* 忽略 */ }
}
/** 上次选中的卡组 key;无效或未记录时返回 null */
export function getLastDeck() {
  try { return localStorage.getItem(LS_LAST_KEY); } catch (e) { return null; }
}

// ===== 编辑器 UI =====
export class DeckEditor {
  constructor() {
    this.editorEl = null;
    this.curSlot = 0;
    this.decks = null;
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
      this.decks[this.curSlot].cards = [];
      this._persistAndRender();
    });
    document.getElementById('deReset').addEventListener('click', () => {
      // 前 5 槽恢复预填;后 5 槽清空
      if (this.curSlot < DEFAULT_DECKS.length) {
        this.decks[this.curSlot].cards = DEFAULT_DECKS[this.curSlot].cards.slice();
        this.decks[this.curSlot].name = DEFAULT_DECKS[this.curSlot].name;
      } else {
        this.decks[this.curSlot].cards = [];
      }
      this._persistAndRender();
    });
    // 点击遮罩关闭
    this.editorEl.addEventListener('click', (e) => { if (e.target === this.editorEl) this.close(); });
  }

  _persistAndRender() {
    saveDecks(this.decks);
    this._renderSlots();
    this._renderDeckRow();
    this._renderGrid();
    this._renderAvg();
    appBus.emit('decks:changed', {}); // 下拉框等联动
  }

  _renderSlots() {
    const { slots } = this._els;
    slots.innerHTML = '';
    this.decks.forEach((d, i) => {
      const s = document.createElement('div');
      s.className = 'deSlot' + (i === this.curSlot ? ' active' : '');
      const empty = d.cards.length === 0;
      s.innerHTML = `<div class="deSlotName">${i + 1}. ${d.name}</div>` +
        `<div class="deSlotCount ${empty ? 'empty' : ''}">${d.cards.length}/8 张</div>`;
      s.addEventListener('click', () => { this.curSlot = i; this._persistAndRender(); });
      slots.appendChild(s);
    });
  }

  _renderDeckRow() {
    const { deckRow, curLabel } = this._els;
    const d = this.decks[this.curSlot];
    curLabel.innerHTML = `当前编辑:卡组 ${this.curSlot + 1} ` +
      `<input id="deNameInput" class="deNameInput" value="${d.name.replace(/"/g, '&quot;')}" maxlength="8" title="点击修改名称">`;
    // 名称编辑
    const nameInput = curLabel.querySelector('#deNameInput');
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (v) { d.name = v.slice(0, 8); saveDecks(this.decks); this._renderSlots(); appBus.emit('decks:changed', {}); }
    });
    deckRow.innerHTML = d.cards.length
      ? d.cards.map(id => this._cardChipHtml(id)).join('')
      : '<div style="color:#6b7399;font-size:11px;align-self:center;margin:auto;">空卡组 — 点击下方卡牌加入</div>';
    // 点击卡组中的卡 = 移除
    deckRow.querySelectorAll('.deDeckCard').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.card;
        const arr = this.decks[this.curSlot].cards;
        arr.splice(arr.indexOf(id), 1);
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
    const inDeck = new Set(this.decks[this.curSlot].cards);
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
        const id = el.dataset.card;
        const arr = this.decks[this.curSlot].cards;
        if (arr.includes(id)) return; // 已在卡组
        if (arr.length >= DECK_SIZE) return; // 已满 8 张
        arr.push(id);
        this._persistAndRender();
      });
    });
  }

  _renderAvg() {
    const { avg } = this._els;
    const d = this.decks[this.curSlot];
    if (!d.cards.length) { avg.innerHTML = '平均圣水:—'; return; }
    const a = d.cards.reduce((s, id) => s + CARDS[id].cost, 0) / d.cards.length;
    avg.innerHTML = `平均圣水:<b>${a.toFixed(1)}</b> · ${d.cards.length}/8 张`;
  }

  open(slot) {
    this._ensureEls();
    this.decks = loadDecks();
    if (typeof slot === 'number') this.curSlot = Math.max(0, Math.min(this.decks.length - 1, slot));
    this.editorEl.classList.add('show');
    this._persistAndRender();
  }

  close() {
    if (this.editorEl) this.editorEl.classList.remove('show');
  }

  isOpen() { return this.editorEl && this.editorEl.classList.contains('show'); }
}

function rarityColor(r) {
  return { '普通': '#cfd8dc', '稀有': '#ffb74d', '史诗': '#ba68c8' }[r] || '#cfd8dc';
}

export const deckEditor = new DeckEditor();
export { DEFAULT_DECKS };
