// ===============================================
// 界面管理 - 封面(开始/暂停,全屏)与结算弹窗
// 情境文案以小胶囊标签呈现(弱化),主视觉是盾徽与主按钮
// ===============================================
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
  }

  showOverlay({ title, desc, btn, hint, paused }) {
    this.overlayEl.classList.remove('hidden');
    // 暂停态:封面隐藏配置区(卡组/AI 强度),复用其余设计
    this.overlayEl.classList.toggle('paused', !!paused);
    this.tagEl.textContent = title || '';
    this.tagEl.style.display = title ? '' : 'none';
    this.descEl.textContent = desc || '';
    this.btnEl.textContent = btn;
    this.btnEl.style.display = '';
    this.hintEl.style.display = '';
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
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
