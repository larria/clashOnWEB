// ===============================================
// 输入抽象 - Pointer Events 统一鼠标/触摸
//
// 对上层暴露语义回调:
//   onPointer(grid)         指针移动/拖动(更新部署预览)
//   onTap(grid)             点击(选牌模式下部署)
//   onDragStart/dragEnd     拖拽起止(拖拽放兵的扩展点)
//   onPressEscape           键盘 Esc
//
// 拖拽放兵(后续迭代):在 onDragStart 时带上来源手牌 index,
// 上层据此直接进入部署预览,松手即部署。
// ===============================================
import { CANVAS_W, CANVAS_H, CELL } from '../core/constants.js';

/** 屏幕坐标(clientX/Y)→ 格坐标(与 main.js 拖拽路径共用同一实现) */
export function clientToGrid(canvas, cx, cy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (cx - rect.left) / rect.width * CANVAS_W / CELL,
    y: (cy - rect.top) / rect.height * CANVAS_H / CELL,
  };
}

export class InputController {
  /**
   * @param canvas  战场 canvas
   * @param handlers { onPointer, onTap, onDragStart, onDragEnd, onPressEscape }
   */
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.dragging = false;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    const TAP_SLOP = 10;  // 按下→抬起位移超过此像素数视为拖动,不触发 tap
    let downX = 0, downY = 0;

    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      downX = e.clientX; downY = e.clientY;
      const g = this.toGrid(e);
      if (this.handlers.onDragStart) this.handlers.onDragStart(g, e);
    });
    c.addEventListener('pointermove', (e) => {
      const g = this.toGrid(e);
      if (this.handlers.onPointer) this.handlers.onPointer(g, e);
    });
    c.addEventListener('pointerup', (e) => {
      const g = this.toGrid(e);
      const wasDragging = this.dragging;
      this.dragging = false;
      if (this.handlers.onDragEnd) this.handlers.onDragEnd(g, e, wasDragging);
      // 简单点击(按下与抬起位置接近)→ tap;位移大视为拖动,不触发
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (this.handlers.onTap && moved <= TAP_SLOP) this.handlers.onTap(g, e);
    });
    c.addEventListener('pointercancel', () => {
      this.dragging = false;
      if (this.handlers.onDragEnd) this.handlers.onDragEnd(null, null, false);
    });

    window.addEventListener('keydown', (e) => {
      // 输入框内不劫持 Esc(卡组编辑器改名等场景)
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape' && this.handlers.onPressEscape) this.handlers.onPressEscape(e);
    });
  }

  /** 屏幕坐标 → 格坐标 */
  toGrid(e) {
    return clientToGrid(this.canvas, e.clientX, e.clientY);
  }
}
