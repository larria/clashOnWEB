// ===============================================
// 对局记录器 - 可重放快照日志
//
// 设计:引擎已无随机(唯一随机 = 洗牌,已注入种子 RNG)。因此
// "初始条件 + 出牌脚本"即可 headless 确定性重放整局到任意时刻。
//
// 记录内容:
//   meta  : seed/卡组/AI 难度/版本(重放的初始条件)
//   plays : [t, side, cardId, x, y] 每次出牌(双方,按时间排序)
//   marks : 里程碑(塔毁/国王塔激活/双倍圣水/终局)——人类阅读锚点
//
// 用法(编排层):
//   const rec = new Recorder(game, { seed, playerDeck, aiDeck, aiLevel });
//   game.bus.on(...) 内部已自动接线 card:played / tower:destroyed 等
//   rec.export() → JSON 字符串(存 localStorage / 复制给 AI 分析)
//
// 重放(无浏览器):
//   node tools/replay.mjs rec.json [--at 秒] [--continue 秒]
// ===============================================

const REC_VERSION = 1;
const REC_LS_KEY = 'clash_last_recording';

export class Recorder {
  constructor(game, meta = {}) {
    this.game = game;
    this.meta = {
      version: REC_VERSION,
      date: new Date().toISOString(),
      seed: meta.seed,
      playerDeck: meta.playerDeck || null,
      aiDeck: meta.aiDeck || null,
      aiLevel: meta.aiLevel != null ? meta.aiLevel : null,
    };
    this.plays = [];   // {t, side, cardId, x, y}
    this.marks = [];   // {t, type, text}
    this._bind();
  }

  _bind() {
    const bus = this.game.bus;
    bus.on('card:played', ({ side, cardId, x, y }) => {
      this.plays.push({ t: +this.game.time.toFixed(2), side, cardId, x: +x.toFixed(2), y: +y.toFixed(2) });
    });
    bus.on('tower:destroyed', ({ tower }) => {
      const sideName = tower.side === 0 ? '玩家' : 'AI';
      const laneName = tower.lane === 'king' ? '国王塔' : (tower.lane === 'left' ? '左公主塔' : '右公主塔');
      this._mark('tower', `${sideName}${laneName}被摧毁`);
    });
    bus.on('king:activated', ({ tower }) => {
      this._mark('king', `${tower.side === 0 ? '玩家' : 'AI'}国王塔被激活`);
    });
    bus.on('match:phase', ({ phase }) => {
      const names = {
        double_elixir: '⚡ 双倍圣水开启', last_minute: '⏰ 最后 1 分钟',
        triple_elixir: '⚡⚡ 加时三倍圣水', overtime: '⏱ 进入加时(突然死亡)',
      };
      if (names[phase]) this._mark('phase', names[phase]);
    });
    bus.on('match:end', ({ winner, reason }) => {
      const w = winner === 0 ? '玩家胜' : winner === 1 ? 'AI胜' : '平局';
      this._mark('end', `终局:${w}(${reason})`);
    });
  }

  _mark(type, text) {
    this.marks.push({ t: +this.game.time.toFixed(2), type, text });
  }

  /** 导出为可读 JSON(紧凑数组形式,体积小) */
  export() {
    return JSON.stringify({
      meta: this.meta,
      plays: this.plays,
      marks: this.marks,
    });
  }

  /** 存 localStorage(仅最近一局;页面刷新前不清) */
  saveLocal() {
    try {
      localStorage.setItem(REC_LS_KEY, this.export());
    } catch (e) { /* 配额满等情况静默失败,不影响游戏 */ }
  }

  /** 读取最近一局记录(null = 无) */
  static loadLocal() {
    try {
      const raw = localStorage.getItem(REC_LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
}

// ===== 人类可读格式化(日志面板与重放输出共用) =====

/** t(秒) → "[m:ss.s]" */
export function fmtT(t) {
  if (t == null) return '[?]';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `[${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}]`;
}

/** 记录 → 人类可读文本(出牌脚本,带时间戳) */
export function recToText(rec) {
  if (!rec) return '';
  const lines = [];
  const pSide = (s) => (s === 0 ? '你' : 'AI');
  lines.push(`# 对局记录 seed=${rec.meta.seed} AI难度=${rec.meta.aiLevel} ${rec.meta.date || ''}`);
  lines.push(`# 你的卡组:${(rec.meta.playerDeck || []).join(',')}`);
  lines.push(`# AI卡组:${(rec.meta.aiDeck || []).join(',')}`);
  // 出牌与里程碑按时间归并输出
  const events = [
    ...rec.plays.map(p => ({ t: p.t, line: `${fmtT(p.t)} ${pSide(p.side)} 出 ${p.cardId} @(${p.x},${p.y})` })),
    ...rec.marks.map(m => ({ t: m.t, line: `${fmtT(m.t)} ** ${m.text} **` })),
  ].sort((a, b) => a.t - b.t);
  for (const e of events) lines.push(e.line);
  return lines.join('\n');
}
