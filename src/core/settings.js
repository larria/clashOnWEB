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
  aiLevel:      { def: 3,  label: 'AI 强度' },   // 档位 1-4,默认挑战
};

// ===== AI 难度四档(对外只暴露档位与名称,不暴露内部数值) =====
// thinkMult: 决策频率倍率(数值越大思考越快)
// elixirMult: AI 圣水产生倍率(仅噩梦 >1)
export const AI_LEVELS = [
  { level: 1, name: '普通', thinkMult: 1.0, elixirMult: 1.0 },
  { level: 2, name: '困难', thinkMult: 1.3, elixirMult: 1.0 },
  { level: 3, name: '挑战', thinkMult: 1.6, elixirMult: 1.0 },
  { level: 4, name: '噩梦', thinkMult: 1.6, elixirMult: 1.5 },  // 决策同挑战,AI 圣水×1.5
];

/** 档位信息(越界夹逼到 1-4;兼容旧版数值 1.3→2 困难 / 1.6→3 挑战) */
export function aiLevelInfo(v) {
  let n = Number(v);
  if (isNaN(n)) n = 3;
  if (!Number.isInteger(n)) {
    // 旧版数值语义(决策频率倍率)→ 档位
    if (n <= 1) n = 1;
    else if (n < 1.45) n = 2;      // 1.3 = 困难
    else n = 3;                    // 1.6 = 挑战
  }
  n = Math.max(1, Math.min(4, Math.round(n)));
  return AI_LEVELS[n - 1];
}

function loadRaw() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
}

// 内存缓存:渲染热路径(renderer 每帧)高频 get,避免每次 localStorage+JSON.parse
let _cache = loadRaw();
function invalidateCache() { _cache = loadRaw(); }

// 旧版存储的数值型 aiLevel(1.3/1.6)一次性迁移为档位整数
(function migrateAiLevel() {
  const raw = loadRaw();
  if (raw && 'aiLevel' in raw && !Number.isInteger(raw.aiLevel)) {
    const info = aiLevelInfo(raw.aiLevel);
    try {
      raw.aiLevel = info.level;
      localStorage.setItem(LS_KEY, JSON.stringify(raw));
    } catch (e) { /* 忽略存储失败 */ }
  }
})();

export const settings = {
  /** 读取(未存储时返回默认值;走内存缓存,渲染热路径安全) */
  get(key) {
    if (key in _cache) return _cache[key];
    return DEFINITIONS[key] ? DEFINITIONS[key].def : undefined;
  },

  /** 写入并广播 settings:changed(新旧值都带) */
  set(key, value) {
    const raw = loadRaw();
    const old = key in raw ? raw[key] : (DEFINITIONS[key] ? DEFINITIONS[key].def : undefined);
    raw[key] = value;
    try { localStorage.setItem(LS_KEY, JSON.stringify(raw)); } catch (e) { /* 忽略存储失败 */ }
    invalidateCache();
    appBus.emit('settings:changed', { key, value, old });
  },

  /** 全部定义(设置页遍历渲染用) */
  definitions() { return DEFINITIONS; },

  reset() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* 忽略 */ }
    invalidateCache();
    appBus.emit('settings:reset', {});
  },
};
