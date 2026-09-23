// ===============================================
// 多体部署队形 - CR 式横排队列
// 2个:左右横排(放底部中央时自然分两路)  3个:横排
// 4个:2x2  5个:3+2  15个:5x3 密集方阵
// 边界钳制:不越出地图、不落入河道
// ===============================================
import { GRID_W, GRID_H, isRiver, isBridge } from '../core/constants.js';

export function getDeployPositions(cx, cy, count, r) {
  if (count <= 1) return [{ x: cx, y: cy }];
  const spacing = Math.max(0.9, (r || 0.35) * 2.4); // 单位横向间距
  const rowSpacing = spacing * 0.9;                  // 行距

  // 计算每行人数:横排优先,最多 5 列
  const cols = Math.min(count, count <= 3 ? count : (count <= 6 ? Math.ceil(count / 2) : 5));
  const rows = Math.ceil(count / cols);
  // 行内人数分配(上行多、下行少:3+2 形态)
  const perRow = [];
  let remaining = count;
  for (let i = 0; i < rows; i++) {
    const rowN = Math.ceil(remaining / (rows - i));
    perRow.push(rowN);
    remaining -= rowN;
  }

  const positions = [];
  for (let ri = 0; ri < rows; ri++) {
    const n = perRow[ri];
    const rowW = (n - 1) * spacing;
    for (let i = 0; i < n; i++) {
      let x = cx - rowW / 2 + i * spacing;
      let y = cy + (ri - (rows - 1) / 2) * rowSpacing;
      positions.push({ x, y });
    }
  }

  // 边界钳制:x 不出地图,y 不进河道(非桥)
  const inRiver = (x, y) => isRiver(x, y) && !isBridge(x, y);
  const clamped = positions.map(p => {
    let x = Math.max(r + 0.1, Math.min(GRID_W - r - 0.1, p.x));
    let y = p.y;
    if (inRiver(x, y)) {
      // 尝试仅动 y(保持 x):向部署中心方向退
      const tryYs = [cy, cy + (y > cy ? 1.2 : -1.2), cy + (y > cy ? 2.4 : -2.4)];
      for (const ty of tryYs) {
        if (!inRiver(x, ty)) { y = ty; break; }
      }
    }
    y = Math.max(r + 0.1, Math.min(GRID_H - r - 0.1, y));
    return { x, y };
  });
  return clamped;
}

// 环形布局:count 个单位围绕中心点 (cx,cy) 均匀分布(等边三角形/正方形…)
// 用途:飞桶扔在塔中心时哥布林向四周散开(官方行为——加大 AOE 反制难度)
// ring: 距中心距离(格);rotation: 起始角(弧度,默认 -90°=正上方)
export function getRingPositions(cx, cy, count, ring, rotation = -Math.PI / 2) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const a = rotation + (i * 2 * Math.PI) / count;
    positions.push({ x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring });
  }
  // 边界钳制(同 getDeployPositions:不出地图、不落非桥河道)
  const r = 0.35;
  const inRiver = (x, y) => isRiver(x, y) && !isBridge(x, y);
  return positions.map(p => {
    let x = Math.max(r + 0.1, Math.min(GRID_W - r - 0.1, p.x));
    let y = p.y;
    if (inRiver(x, y)) y = cy < 16 ? 14.5 : 17.5;   // 退回近侧岸边
    y = Math.max(r + 0.1, Math.min(GRID_H - r - 0.1, y));
    return { x, y };
  });
}
