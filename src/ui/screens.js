// ===============================================
// 界面管理 - 遮罩(开始/暂停)与结算弹窗
// 遮罩即未来的游戏封面:logo 固定顶部、标题自适应字号
// ===============================================
export class Screens {
  constructor({ overlay, ovTitle, ovDesc, ovBtn, ovHint, result, resultText, resultSub }) {
    this.overlayEl = overlay;
    this.titleEl = ovTitle;
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
    this.titleEl.textContent = title;
    this.descEl.textContent = desc || '';
    this.btnEl.textContent = btn;
    this.btnEl.style.display = '';
    this.hintEl.style.display = '';
    this._fitTitle();
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }

  // 标题自适应缩字号(nowrap 防折行,过长则缩小)
  _fitTitle() {
    requestAnimationFrame(() => {
      const canvasW = this.overlayEl.parentElement.getBoundingClientRect().width;
      const chars = (this.titleEl.textContent || '').replace(/\s/g, '').length;
      if (chars > 0) {
        const fit = Math.max(16, Math.min(30, (canvasW * 0.88) / (chars * 1.15)));
        this.titleEl.style.fontSize = fit.toFixed(0) + 'px';
      }
    });
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
