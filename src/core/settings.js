// ===============================================
// 设置 - localStorage 持久化 + 变更事件
// 设置页/遮罩开关(音乐音效等)统一走这里
// ===============================================
import { appBus } from './events.js';

const LS_KEY = 'CR_SETTINGS_V1';

/**
 * 设置项定义(新增设置只需在此加一项 + 设置页加一个控件):
 *   key: 存储键
 *   def: 默认值
 */
const DEFINITIONS = {
  music:        { def: true,  label: '音乐' },
  sfx:          { def: true,  label: '音效' },
  showDeployZone: { def: true, label: '显示部署区域' },
  showAimLine:  { def: true,  label: '显示塔瞄准线' },
  aiLevel:      { def: 1.6,  label: 'AI 强度' },   // 默认挑战(最高)
};

function loadRaw() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
}

export const settings = {
  /** 读取(未存储时返回默认值) */
  get(key) {
    const raw = loadRaw();
    if (key in raw) return raw[key];
    return DEFINITIONS[key] ? DEFINITIONS[key].def : undefined;
  },

  /** 写入并广播 settings:changed(新旧值都带) */
  set(key, value) {
    const raw = loadRaw();
    const old = key in raw ? raw[key] : (DEFINITIONS[key] ? DEFINITIONS[key].def : undefined);
    raw[key] = value;
    try { localStorage.setItem(LS_KEY, JSON.stringify(raw)); } catch (e) { /* 忽略存储失败 */ }
    appBus.emit('settings:changed', { key, value, old });
  },

  /** 全部定义(设置页遍历渲染用) */
  definitions() { return DEFINITIONS; },

  reset() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* 忽略 */ }
    appBus.emit('settings:reset', {});
  },
};
