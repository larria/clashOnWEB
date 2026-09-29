// ===============================================
// 界面管理 - 封面(开始/暂停/选卡,全屏)与结算弹窗
// 情境文案以小胶囊标签呈现(弱化),主视觉是盾徽与主按钮
// ===============================================
import { CARDS } from '../data/cards.js';
import { getCardUrl } from '../render/cardart.js';
import { elixirCostHtml } from './elixiricon.js';

export class Screens {
  constructor({ overlay, ovTitle, ovDesc, ovBtn, ovHint, result, resultText, resultSub }) {
    this.overlayEl = overlay;
    this.tagEl = ovTitle;      // 现为 .ovTag 小标签
    this.descEl = ovDesc;
    this.btnEl = ovBtn;
    this.hintEl = ovHint;
    this.resultEl = result;
    this.resultTextEl = resultText;
    this.resultSubEl = resultSub;
    // 选卡面板(动态创建,挂在 overlay 中央;draft 态显示)
    this.draftEl = document.createElement('div');
    this.draftEl.className = 'draftPanel';
    this.draftEl.style.display = 'none';
    this.overlayEl.appendChild(this.draftEl);
    this._draftCb = null;   // 选卡回调(main.js 注入 draftPick)
  }

  showOverlay({ title, desc, btn, hint, paused, draft }) {
    this.overlayEl.classList.remove('hidden');
    // 暂停态:封面隐藏配置区(卡组/AI 强度),复用其余设计
    this.overlayEl.classList.toggle('paused', !!paused);
    this.tagEl.textContent = title || '';
    this.tagEl.style.display = title ? '' : 'none';
    this.descEl.textContent = desc || '';
    this.btnEl.textContent = btn;
    this.btnEl.style.display = btn ? '' : 'none';
    this.hintEl.style.display = hint ? '' : 'none';
    // 选卡模式:显示两张候选卡,点击即选(另一张归 AI)
    if (draft && draft.length === 2) {
      this._renderDraft(draft);
    } else {
      this.draftEl.style.display = 'none';
    }
  }

  /** 选卡回调注册(main.js: draftPick) */
  onDraftPick(cb) { this._draftCb = cb; }

  _renderDraft(pair) {
    const el = this.draftEl;
    el.style.display = '';
    el.innerHTML = pair.map((id, i) => {
      const c = CARDS[id];
      return `<div class="draftCard" data-idx="${i}">
        <div class="draftArt" style="background-image:url('${getCardUrl(id)}');"></div>
        <div class="draftName">${c.name}</div>
        <div class="draftCost">${elixirCostHtml(c.cost)}</div>
        <div class="draftRarity">${c.rarity}</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.draftCard').forEach(card => {
      card.addEventListener('click', () => {
        if (this._draftCb) this._draftCb(+card.dataset.idx);
      });
    });
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
    this.draftEl.style.display = 'none';
  }

  showResult(winner) {
    let txt, sub;
    if (winner === 0) { txt = '🏆 胜利!'; sub = 'VICTORY'; }
    else if (winner === 1) { txt = '💀 失败'; sub = 'DEFEAT'; }
    else { txt = '⚖️ 平局'; sub = 'DRAW'; }
    this.resultTextEl.textContent = txt;
    this.resultTextEl.style.color = winner === 0 ? '#7fd4ff' : (winner === 1 ? '#ff8a80' : '#ffe082');
    this.resultSubEl.textContent = sub;
    this.resultSubEl.style.color = this.resultTextEl.style.color;
    this.resultEl.classList.add('show');
  }

  hideResult() {
    this.resultEl.classList.remove('show');
  }
}
