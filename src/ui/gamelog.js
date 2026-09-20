// ===============================================
// 战斗日志 - 订阅 game.bus 的 log 事件
// ===============================================
export class GameLog {
  constructor(el) {
    this.el = el;
  }

  bind(bus) {
    this.el.innerHTML = '';
    bus.on('log', ({ who, msg, cls }) => this.push(msg, cls || who));
  }

  push(msg, who) {
    const div = document.createElement('div');
    div.className = who || 'sys';
    const prefix = { me: '[你] ', ai: '[AI] ', sys: '', kill: '', spell: '' }[who || 'sys'] || '';
    div.textContent = prefix + msg;
    this.el.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    if (this.el.children.length > 200) this.el.removeChild(this.el.firstChild);
  }
}
