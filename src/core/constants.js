// ===============================================
// 战场常量与坐标系
// ===============================================

// 目标类型位掩码
export const T = {
  GROUND: 1,
  AIR: 2,
  BUILDING: 4,
  ALL: 7,
  GROUND_BUILDING: 5,
};

// 网格:18 宽 x 32 高(单位:格)
// y=0 顶部=AI(对手)侧, y=31 底部=玩家侧
// 河道占 y=15,16 两行;桥 2 格宽,对齐公主塔 x
export const GRID_W = 18;
export const GRID_H = 32;
export const RIVER_Y1 = 15; // 河道上沿(不含)
export const RIVER_Y2 = 17; // 河道下沿(不含)
export const BRIDGE_LEFT = [3, 4];     // 中心 3.5,对齐左公主塔
export const BRIDGE_RIGHT = [14, 15];  // 中心 14.5,对齐右公主塔

// 塔位置(格坐标,塔心)
export const TOWERS = {
  ai: {
    left:  { x: 3.5, y: 4,    type: 'princess', lane: 'left'  },
    right: { x: 14.5, y: 4,   type: 'princess', lane: 'right' },
    king:  { x: 9,   y: 1.5,  type: 'king',     lane: 'king'  },
  },
  player: {
    left:  { x: 3.5, y: 27,   type: 'princess', lane: 'left'  },
    right: { x: 14.5, y: 27,  type: 'princess', lane: 'right' },
    king:  { x: 9,   y: 30.5, type: 'king',     lane: 'king'  },
  },
};

// 塔属性(对齐 wiki 11级 × 0.5)
export const TOWER_STATS = {
  princess: { hp: 1526, dmg: 54, hitSpeed: 0.8, range: 7.5, sightRange: 7.5, targets: T.ALL, radius: 0.8 },
  king:     { hp: 2417, dmg: 54, hitSpeed: 1.0, range: 7.0, sightRange: 7.0, targets: T.ALL, radius: 1.0 },
};

// 圣水
export const MAX_ELIXIR = 10;
export const ELIXIR_RATE = 1 / 2.8; // 每秒增长(2.8秒1费),双倍圣水时翻倍

// 比赛时长(秒)与双倍圣水时间
export const MATCH_TIME = 180;
export const DOUBLE_ELIXIR_AT = 120;

// 渲染尺寸
export const CELL = 38;
export const CANVAS_W = GRID_W * CELL;   // 684
export const CANVAS_H = GRID_H * CELL;   // 1216

export const SIDE_PLAYER = 0;
export const SIDE_AI = 1;

// ===== 部署区域 =====
// 连续坐标语义(与像素渲染一致,河道 y∈[15,17))
// opts: { zone } 卡牌级部署规则(来自卡牌数据 deployZone):
//   undefined / 'own'   → 己方半场(默认)
//   'anywhere'          → 全场(法术;未来矿工/哥布林飞桶等)
//   'riverbanks'        → 仅河岸两侧(未来掘地矿工等特殊卡)
// enemyTowers: 敌方塔 {left,right} 状态(推塔解锁区判定)
export function canDeploy(side, x, y, enemyTowers, opts = {}) {
  // 卡牌级部署规则优先(打破常规部署区域的卡:法术/矿工/飞桶…)
  if (opts.zone === 'anywhere') return true;

  const inOwnHalf = side === 'player'
    ? y >= RIVER_Y2
    : y < RIVER_Y1;
  if (inOwnHalf) return true;
  // 敌方半场:仅在对应侧公主塔被摧毁后解锁
  if (!enemyTowers) return false;
  const leftUnlocked = enemyTowers.left && enemyTowers.left.dead;
  const rightUnlocked = enemyTowers.right && enemyTowers.right.dead;
  if (!leftUnlocked && !rightUnlocked) return false;
  const isLeftLane = x < 9;
  if (isLeftLane && !leftUnlocked) return false;
  if (!isLeftLane && !rightUnlocked) return false;
  // 河道:仅解锁侧的桥面可部署(桥与该侧公主塔同 x 对齐)
  if (y >= RIVER_Y1 && y < RIVER_Y2) {
    return isLeftLane
      ? BRIDGE_LEFT.includes(Math.floor(x))
      : BRIDGE_RIGHT.includes(Math.floor(x));
  }
  // 该侧公主塔身前到河边的区域(连续坐标:含岸边整排)
  if (side === 'player') {
    return y >= 5 && y < RIVER_Y1;
  } else {
    return y >= RIVER_Y2 && y < 27;
  }
}

// ===== 部署点吸附 =====
// 点击在可部署区域外附近时,吸附到最近的合法边缘(宽容操作,减少部署失败挫败感)
// 返回吸附后的 {x, y};若点击点本身合法,原样返回;离区域太远(maxSnap 格)返回 null
// 与 canDeploy 同源判定:己方半场 + 解锁区(含解锁侧桥面)
export function snapToDeployZone(side, x, y, enemyTowers, opts = {}, maxSnap = 2.5) {
  if (canDeploy(side, x, y, enemyTowers, opts)) return { x, y };

  // 候选锚点:沿可部署区域边缘采样,取最近的合法点
  let best = null, bestD2 = Infinity;
  const consider = (cx, cy) => {
    if (!canDeploy(side, cx, cy, enemyTowers, opts)) return;
    const d2 = (cx-x)*(cx-x) + (cy-y)*(cy-y);
    if (d2 < bestD2) { bestD2 = d2; best = { x: cx, y: cy }; }
  };

  const leftUnlocked = enemyTowers && enemyTowers.left && enemyTowers.left.dead;
  const rightUnlocked = enemyTowers && enemyTowers.right && enemyTowers.right.dead;
  const mySide = side === 'player' ? 'bottom' : 'top';

  // 1. 己方半场边缘:河道上/下沿线(对应侧),x 全宽采样
  const riverEdge = mySide === 'bottom' ? RIVER_Y2 : RIVER_Y1 - 0.05;
  const riverFar = mySide === 'bottom' ? RIVER_Y2 - 0.05 : RIVER_Y1;
  for (let sx = 0.3; sx <= GRID_W - 0.3; sx += 0.5) {
    consider(sx, riverEdge);
    consider(sx, riverFar);
  }
  // 2. 地图左右边缘(己方半场段)
  for (let sy = mySide === 'bottom' ? RIVER_Y2 + 0.3 : 0.3;
       sy <= (mySide === 'bottom' ? GRID_H - 0.3 : RIVER_Y1 - 0.3); sy += 0.5) {
    consider(0.3, sy);
    consider(GRID_W - 0.3, sy);
  }
  // 3. 地图底线
  for (let sx = 0.3; sx <= GRID_W - 0.3; sx += 0.5) {
    consider(sx, mySide === 'bottom' ? GRID_H - 0.3 : 0.3);
  }
  // 4. 解锁区(敌方侧):塔前线 + 该侧桥面
  if (leftUnlocked || rightUnlocked) {
    const lanes = leftUnlocked && rightUnlocked ? ['l', 'r'] : (leftUnlocked ? ['l'] : ['r']);
    for (const lane of lanes) {
      const x0 = lane === 'l' ? 0.3 : 9.3, x1 = lane === 'l' ? 8.7 : GRID_W - 0.3;
      // 塔前横线(敌方侧)
      const frontY = side === 'player' ? 5.05 : 26.7;
      const bankY = side === 'player' ? RIVER_Y1 - 0.05 : RIVER_Y2 + 0.3;
      for (let sx = x0; sx <= x1; sx += 0.5) {
        consider(sx, frontY);
        consider(sx, bankY);
      }
      // 桥面(解锁侧)
      const bx = lane === 'l' ? BRIDGE_LEFT : BRIDGE_RIGHT;
      const midY = (RIVER_Y1 + RIVER_Y2) / 2;
      for (const bxx of bx) consider(bxx + 0.5, midY);
    }
  }

  if (!best || bestD2 > maxSnap * maxSnap) return null;
  return best;
}

// 是否在河道(阻挡地面单位)
export function isRiver(x, y) {
  return y > RIVER_Y1 && y < RIVER_Y2;
}
// 是否在桥上(地面可通过)
export function isBridge(x, y) {
  if (!(y > RIVER_Y1 && y < RIVER_Y2)) return false;
  const ix = Math.floor(x);
  return BRIDGE_LEFT.includes(ix) || BRIDGE_RIGHT.includes(ix);
}

// 距离(格)
export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}
export function dist2(ax, ay, bx, by) {
  const dx = ax-bx, dy = ay-by;
  return dx*dx + dy*dy;
}
