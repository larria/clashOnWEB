// ===============================================
// 事件总线 - 模块间解耦的唯一通道
// Game 发出领域事件,UI/音频/动画只订阅不反向调用
// ===============================================

/**
 * 用法:
 *   const bus = new EventBus();
 *   const off = bus.on('unit:killed', payload => {...});
 *   bus.emit('unit:killed', payload);
 *   off(); // 取消订阅
 *
 * 领域事件清单(见 docs/EVENTS.md):
 *   match:start / match:end {winner, reason} / match:phase {phase: double_elixir|last_minute}
 *   card:played {side, cardId, x, y, kind, role}
 *   unit:deployed {unit}
 *   unit:attack {attacker, isTower, isKing}   // 每次攻击结算(音效订阅)
 *   unit:killed  {unit, attacker}
 *   tower:damaged {tower}
 *   tower:destroyed {tower, crowns}
 *   king:activated {tower}                    // 国王塔激活(音效订阅)
 *   elixir:produced {side, amount}            // 收集器产费
 *   spell:hit {cardId, side, x, y, hits, kills}
 *   log {who, msg}           // 游戏逻辑想输出的日志(原 CR.log 全局函数)
 *   announce {main, sub, color}
 *   unlock {lane, side}      // 部署区解锁
 *   effect {type, cardId, x, y, radius, color} // 视觉特效请求(渲染层自治消费)
 */
export class EventBus {
  constructor() {
    this._map = new Map(); // type -> Set<fn>
  }

  /** 订阅;返回取消函数 */
  on(type, fn) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  /** 订阅一次(触发后自动移除) */
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }

  off(type, fn) {
    const s = this._map.get(type);
    if (s) s.delete(fn);
  }

  emit(type, payload) {
    const s = this._map.get(type);
    if (!s) return;
    // 拷贝一份,允许回调内安全地增删订阅
    for (const fn of [...s]) {
      try {
        fn(payload);
      } catch (e) {
        // 单个订阅者异常不拖垮整条事件链
        console.error(`[EventBus] ${type} handler error:`, e);
      }
    }
  }

  clear() { this._map.clear(); }
}

/** 全局应用级总线(设置变更等);每局游戏用 Game 自带的新实例 */
export const appBus = new EventBus();
