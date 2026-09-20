// ===============================================
// 设置页 - 独立界面(入口:开始遮罩上的 ⚙ 按钮)
// 控件由 settings.definitions() 驱动;新增设置项自动出现
// ===============================================
import { settings } from '../core/settings.js';

export class SettingsScreen {
  constructor() {
    this.el = null;
  }

  _ensureEls() {
    if (this.el) return;
    this.el = document.getElementById('settingsScreen');

    document.getElementById('settingsClose').addEventListener('click', () => this.close());
    // 点击遮罩关闭
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });

    this._render();
  }

  _render() {
    const box = document.getElementById('settingsList');
    const defs = settings.definitions();
    box.innerHTML = '';
    Object.keys(defs).forEach(key => {
      const def = defs[key];
      const row = document.createElement('div');
      row.className = 'setRow';
      // 布尔型 → 开关;数值型 → 数字输入(后续可扩展为滑条/选项)
      const val = settings.get(key);
      if (typeof def.def === 'boolean') {
        row.innerHTML = `
          <span class="setLabel">${def.label}</span>
          <label class="switch">
            <input type="checkbox" ${val ? 'checked' : ''}>
            <span class="slider"></span>
          </label>`;
        row.querySelector('input').addEventListener('change', (e) => {
          settings.set(key, e.target.checked);
        });
      } else {
        row.innerHTML = `
          <span class="setLabel">${def.label}</span>
          <input type="number" class="setNum" value="${val}" step="0.1">`;
        const input = row.querySelector('input');
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!isNaN(v)) settings.set(key, v);
        });
      }
      box.appendChild(row);
    });
  }

  open() {
    this._ensureEls();
    this._render(); // 打开时刷新控件状态
    this.el.classList.add('show');
  }

  close() {
    if (this.el) this.el.classList.remove('show');
  }

  isOpen() { return this.el && this.el.classList.contains('show'); }
}

export const settingsScreen = new SettingsScreen();
