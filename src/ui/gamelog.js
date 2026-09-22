// ===============================================
// 战斗日志 - 订阅 game.bus;带时间戳;换局归档上一场
//
// 结构:
//   当前局实时滚动日志(同前)
//   每条带 [m:ss] 时间戳(人类可读,与重放工具的 fmtT 一致,
//   报 bug 时引用时间戳即可在 replay.mjs 里还原该时刻)
//   开新局时旧日志整体归档到"上一场"折叠区(同一 DOM 内,不丢失)
// ===============================================
import { fmtT } from '../core/recorder.js';

export class GameLog {
  constructor(el) {
    this.el = el;
    this._curTime = 0;
    this._build();
  }

  _build() {
    this.el.innerHTML = '';
    // 归档区(上一场;默认折叠)
    this.archiveEl = document.createElement('details');
    this.archiveEl.className = 'logArchive';
    this.archiveEl.style.display = 'none';
    this.archiveEl.innerHTML = '<summary>📦 上一场</summary>';
    this.archiveBody = document.createElement('div');
    this.archiveBody.className = 'logArchiveBody';
    this.archiveEl.appendChild(this.archiveBody);
    this.el.appendChild(this.archiveEl);
    // 当前局
    this.curEl = document.createElement('div');
    this.curEl.className = 'logCur';
    this.el.appendChild(this.curEl);
  }

  /** 绑定本局 bus(开新局时调用:旧日志整体归档到"上一场") */
  bind(bus) {
    if (this.curEl && this.curEl.children.length > 0) {
      this.archiveEl.style.display = '';
      this.archiveEl.open = false;
      this.archiveBody.innerHTML = '';
      while (this.curEl.firstChild) this.archiveBody.appendChild(this.curEl.firstChild);
    }
    this.curEl.innerHTML = '';
    bus.on('log', ({ who, msg, cls }) => this.push(msg, cls || who));
  }

  /** 当前局时间(每帧由主循环喂入;时间戳数据源) */
  setTime(t) { this._curTime = t; }

  push(msg, who) {
    const div = document.createElement('div');
    div.className = who || 'sys';
    const prefix = { me: '[你] ', ai: '[AI] ', sys: '', kill: '', spell: '' }[who || 'sys'] || '';
    const ts = document.createElement('span');
    ts.className = 'logTs';
    ts.textContent = fmtT(this._curTime);
    div.appendChild(ts);
    div.appendChild(document.createTextNode(prefix + msg));
    this.curEl.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    // 当前局上限 400 条(超出裁旧;归档区整场保留)
    if (this.curEl.children.length > 400) this.curEl.removeChild(this.curEl.firstChild);
  }
}
