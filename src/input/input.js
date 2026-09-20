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

    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
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
      // 简单点击(按下与抬起位置接近)→ tap
      if (this.handlers.onTap) this.handlers.onTap(g, e);
    });
    c.addEventListener('pointercancel', () => {
      this.dragging = false;
      if (this.handlers.onDragEnd) this.handlers.onDragEnd(null, null, false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.handlers.onPressEscape) this.handlers.onPressEscape(e);
    });
  }

  /** 屏幕坐标 → 格坐标 */
  toGrid(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * CANVAS_W;
    const sy = (e.clientY - rect.top) / rect.height * CANVAS_H;
    return { x: sx / CELL, y: sy / CELL };
  }
}
