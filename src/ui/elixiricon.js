// ===============================================
// 圣水滴图标(官方圣水紫,统一可复用)
//
// 所有圣水标志不再用系统 emoji 💧(跨平台形状/颜色不一致),
// 统一引用本模块的 SVG data-uri 或同文件 assets/icons/elixir-drop.svg。
// data-uri 版供 <img>/background-image 直接使用;文件版供 <img src> 使用。
// ===============================================
import { CARDS } from '../data/cards.js';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="64" height="80">
  <defs><linearGradient id="eg" x1="0.25" y1="0" x2="0.75" y2="1">
    <stop offset="0" stop-color="#f9a8ff"/><stop offset="0.35" stop-color="#ee6cf5"/>
    <stop offset="0.7" stop-color="#d233e0"/><stop offset="1" stop-color="#8f14ab"/>
  </linearGradient></defs>
  <path d="M32 2 C 36 14, 52 30, 56 44 C 61 61, 49 76, 32 76 C 15 76, 3 61, 8 44 C 12 30, 28 14, 32 2 Z"
    fill="url(#eg)" stroke="#5a1066" stroke-width="3" stroke-linejoin="round"/>
  <ellipse cx="22" cy="36" rx="7" ry="12" fill="#ffd8ff" opacity="0.75" transform="rotate(-18 22 36)"/>
  <circle cx="44" cy="26" r="3.5" fill="#ffd8ff" opacity="0.5"/>
</svg>`;

// data-uri(URL 编码,避免 # 被截断)
export const ELIXIR_DROP_URI = 'data:image/svg+xml,' + encodeURIComponent(SVG);

/** 圣水费用徽章 HTML(卡组/选牌等场景复用):水滴图 + 数字 */
export function elixirCostHtml(cost) {
  return `<span class="eDropBadge"><img src="${ELIXIR_DROP_URI}" alt="">${cost}</span>`;
}
