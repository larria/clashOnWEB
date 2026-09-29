// ===============================================
// 多体部署队形 - CR 式横排队列
// 2个:左右横排(放底部中央时自然分两路)  3个:横排
// 4个:2x2  5个:3+2  15个:5x3 密集方阵
// 边界钳制:不越出地图、不落入河道
// ===============================================
import { GRID_W, GRID_H, isRiver, isBridge } from '../core/constants.js';

// 官方部署队形(wiki 各卡页原文):
//   哥oblins 4=square(方形) 小骷髅/投矛/亡灵/三火枪/卫队 3=triangle(等边三角形)
//   野蛮人 5=star(五角星) 亡灵大军 6=hexagon(六边形)
//   骷髅军团 15=scatter(散开) 弓箭手 2=horizontal line(横线)
// 3 体三角形特殊语义:2 前 1 后(朝向敌方),敌方视角等边;
// 官方"依次落下"由 spells.js 的 deploy stagger(0.1s/个)表达
export function getDeployPositions(cx, cy, count, r, formation, faceDir = -1) {
  if (count <= 1) return [{ x: cx, y: cy }];
  const spacing = Math.max(0.9, (r || 0.35) * 2.4); // 单位横向间距

  let positions = [];
  const shape = formation || inferFormation(count);
  switch (shape) {
    case 'triangle': {
      // 等边三角形:前排 2 + 后排 1(前排朝敌方)
      // faceDir=-1: 敌在 y 小侧(side0 玩家,向上进攻);+1: 敌在 y 大侧(side1)
      const d = spacing;                        // 边长
      const h = d * Math.sqrt(3) / 2;           // 等边三角形高
      positions = [
        { x: cx - d / 2, y: cy + faceDir * h / 3 },     // 前左(朝敌方)
        { x: cx + d / 2, y: cy + faceDir * h / 3 },     // 前右
        { x: cx,         y: cy - faceDir * 2 * h / 3 }, // 后中
      ].slice(0, count);
      break;
    }
    case 'square': {
      // 方形(4 个):2×2 网格
      positions = [
        { x: cx - spacing / 2, y: cy - spacing / 2 },
        { x: cx + spacing / 2, y: cy - spacing / 2 },
        { x: cx - spacing / 2, y: cy + spacing / 2 },
        { x: cx + spacing / 2, y: cy + spacing / 2 },
      ].slice(0, count);
      break;
    }
    case 'star': {
      // 五角星(5 个):正五边形环(近似官方星形)
      const ring = spacing * 0.85;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        positions.push({ x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring });
      }
      positions = positions.slice(0, count);
      break;
    }
    case 'hexagon': {
      // 六边形(6 个):正六边形环
      const ring = spacing * 0.8;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
        positions.push({ x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring });
      }
      positions = positions.slice(0, count);
      break;
    }
    case 'scatter': {
      // 散开(骷髅军团 15):密集方阵(现有行为,官方为随机散布,
      // 确定性引擎用方阵近似)
      const cols = 5;
      const rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        positions.push({
          x: cx + (col - (cols - 1) / 2) * spacing * 0.9,
          y: cy + (row - (rows - 1) / 2) * spacing * 0.9,
        });
      }
      break;
    }
    default: {
      // 横线(弓箭手 2 等):现有横排
      const cols = Math.min(count, count <= 3 ? count : (count <= 6 ? Math.ceil(count / 2) : 5));
      const rows = Math.ceil(count / cols);
      const perRow = [];
      let remaining = count;
      for (let i = 0; i < rows; i++) {
        const rowN = Math.ceil(remaining / (rows - i));
        perRow.push(rowN);
        remaining -= rowN;
      }
      for (let ri = 0; ri < rows; ri++) {
        const n = perRow[ri];
        const rowW = (n - 1) * spacing;
        for (let i = 0; i < n; i++) {
          positions.push({
            x: cx - rowW / 2 + i * spacing,
            y: cy + (ri - (rows - 1) / 2) * spacing * 0.9,
          });
        }
      }
      break;
    }
  }

  // 边界钳制:x 不出地图,y 不进河道(非桥)
  const inRiver = (x, y) => isRiver(x, y) && !isBridge(x, y);
  return positions.map(p => {
    let x = Math.max((r || 0.35) + 0.1, Math.min(GRID_W - (r || 0.35) - 0.1, p.x));
    let y = p.y;
    if (inRiver(x, y)) {
      // 尝试仅动 y(保持 x):向部署中心方向退
      const tryYs = [cy, cy + (y > cy ? 1.2 : -1.2), cy + (y > cy ? 2.4 : -2.4)];
      for (const ty of tryYs) {
        if (!inRiver(x, ty)) { y = ty; break; }
      }
    }
    y = Math.max((r || 0.35) + 0.1, Math.min(GRID_H - (r || 0.35) - 0.1, y));
    return { x, y };
  });
}

// 按数量推断队形(未显式指定 formation 时的默认;cards.js 逐卡声明优先)
function inferFormation(count) {
  if (count === 3) return 'triangle';
  if (count === 4) return 'square';
  if (count === 5) return 'star';
  if (count === 6) return 'hexagon';
  if (count >= 10) return 'scatter';
  return 'line';
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
