// ===============================================
// 卡牌图片资源 - 统一加载与取用
//
// 资源:assets/cards/<cardId>.png(42 张,官方 wiki 卡图,最大边 300px)
// 用法:
//   import { cardImages, getCardImage } from '.../cardart.js'
//   const img = getCardImage('knight');   // 可能是 null(未加载完)
//   drawCardImage(ctx, img, x, y, size)   // 等比绘制
//
// 所有 UI(DOM)用 toDataUrl/getImgUrl;canvas 渲染直接用 Image 对象。
// 预加载在模块加载时启动;未加载完时调用方应回退到原 orb 样式。
// ===============================================
import { SELECTABLE_CARDS } from '../data/cards.js';

const _images = new Map();   // cardId -> HTMLImageElement(loaded)
const _urls = new Map();     // cardId -> url(即时可用)

// 构建 URL 并启动预加载
for (const id of [...SELECTABLE_CARDS, 'golemite']) {
  const url = `assets/cards/${id}.png`;
  _urls.set(id, url);
  const img = new Image();
  img.onload = () => { _images.set(id, img); };
  img.src = url;
}

/** DOM 用 URL(如 <img src>/background-image),即时可用 */
export function getCardUrl(cardId) {
  return _urls.get(cardId) || null;
}

/** Canvas 用 Image 对象;未加载完返回 null */
export function getCardImage(cardId) {
  return _images.get(cardId) || null;
}

/**
 * 在 canvas 上等比绘制卡图,限定在 size×size 内(以中心对齐)。
 * img 为 null 时返回 false(调用方回退)。
 * opts.cropSquare: 先裁中央正方形再绘制(圆形头像用,避免宽高比形变)
 */
export function drawCardImage(ctx, img, cx, cy, size, opts = {}) {
  if (!img) return false;
  const w = img.naturalWidth, h = img.naturalHeight;
  let sw = w, sh = h, sx = 0, sy = 0;
  if (opts.cropSquare) {
    const s = Math.min(w, h);
    sx = (w - s) / 2; sy = (h - s) / 2;
    sw = s; sh = s;
  }
  const dw = opts.cropSquare ? size : size * (w / Math.max(w, h));
  const dh = opts.cropSquare ? size : size * (h / Math.max(w, h));
  ctx.drawImage(img, sx, sy, sw, sh, cx - dw/2, cy - dh/2, dw, dh);
  return true;
}

/** 预加载完成度(0~1,调试用) */
export function loadProgress() {
  return _images.size / _urls.size;
}
