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

// 国王塔后凸出排(对齐官方场地:国王塔后方多出的一排可部署格)
//   宽度 6 格(国王塔 4 格宽,两侧各多 1 格),位于国王塔后方(贴底线)
//   ai 侧   → y = 0        (国王塔中心 y=3,占 y∈[1,5])
//   player 侧 → y = 31     (国王塔中心 y=29,占 y∈[27,31])
export const KING_BACK = {
  row: { ai: 0, player: GRID_H - 1 },
  x0: 6, x1: 12,   // [6,12) 共 6 格,以国王塔 x=9 居中
};

// 推塔解锁区深度(格):官方"破塔后多出一块 9×4 的区域"——
// 宽 9(该路整宽)、深 4(贴河岸边向敌方纵深 4 格)
export const UNLOCK_DEPTH = 4;

// 塔位置(格坐标,塔心)—— 对齐官方场地测量:
//   公主塔 3×3:前沿距河边 7 格(AI 侧塔占 y∈[5,8),前沿 y=8,距河 y=15 共 7 格);
//             后沿 y=5 与国王塔前沿(占 y∈[1,5))对齐 —— 塔心 y=6.5/25.5
//   射程 7.5 → 覆盖到己方岸边最后一格(y=14),不越河(官方行为)
//   国王塔 4×4,距底线 1 格(中心 y=3 / 29)
export const TOWERS = {
  ai: {
    left:  { x: 3.5, y: 6.5,  type: 'princess', lane: 'left'  },
    right: { x: 14.5, y: 6.5, type: 'princess', lane: 'right' },
    king:  { x: 9,   y: 3,    type: 'king',     lane: 'king'  },
  },
  player: {
    left:  { x: 3.5, y: 25.5, type: 'princess', lane: 'left'  },
    right: { x: 14.5, y: 25.5, type: 'princess', lane: 'right' },
    king:  { x: 9,   y: 29,   type: 'king',     lane: 'king'  },
  },
};

// 塔属性(wiki 11级 × 0.5;射程 7.5/7 为官方值)
// radius 为碰撞半径(略小于视觉:公主 3×3/国王 4×4)
export const TOWER_STATS = {
  princess: { hp: 1526, dmg: 54, hitSpeed: 0.8, range: 7.5, sightRange: 7.5, targets: T.ALL, radius: 1.2 },
  king:     { hp: 2417, dmg: 54, hitSpeed: 1.0, range: 7.0, sightRange: 7.0, targets: T.ALL, radius: 1.6 },
};

// 圣水
export const MAX_ELIXIR = 10;
export const ELIXIR_RATE = 1 / 2.8; // 每秒增长(2.8秒1费),双倍圣水时翻倍

// 比赛时长(秒)、双倍圣水、加时(sudden death 2 分钟,最后 1 分钟三倍圣水)
export const MATCH_TIME = 180;
export const DOUBLE_ELIXIR_AT = 120;
export const OVERTIME = 120;
export const TRIPLE_ELIXIR_AT = MATCH_TIME + OVERTIME - 60; // 加时第 60 秒起三倍

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
// myTowers:    己方塔(占面积判定,可选;不传则跳过己方塔碰撞)
export function canDeploy(side, x, y, enemyTowers, opts = {}, myTowers) {
  // 卡牌级部署规则优先(打破常规部署区域的卡:法术/矿工/飞桶…)
  if (opts.zone === 'anywhere') return true;

  // 塔占面积:不可部署在任何存活塔的格子上(公主 3×3,国王 4×4)
  // (已毁的塔为瓦砾,不阻挡部署)
  if (!blockByTower(enemyTowers, x, y) && !blockByTower(myTowers, x, y)) {
    // fallthrough 继续区域判定
  } else {
    return false;
  }

  const inOwnHalf = side === 'player'
    ? y >= RIVER_Y2
    : y < RIVER_Y1;
  if (inOwnHalf) {
    // 己方半场主体可部署;但**最贴近底线的那一行**,仅国王塔正后方 6 格
    // 可部署(对齐官方:国王塔后凸出一排,底线两角在部署区之外)
    // 塔占面积已在上方统一判定,国王塔身所在格不会命中
    const kbRow = KING_BACK.row[side === 'player' ? 'player' : 'ai'];
    if (Math.floor(y) === kbRow) {
      return x >= KING_BACK.x0 && x < KING_BACK.x1;
    }
    return true;
  }
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
  // 解锁区(对齐真实 CR:破塔后"多出一块 9×4 的区域")
  //   - 横向:该路 9 格宽(左 x∈[0,9),右 x∈[9,18))
  //   - 纵向:自河岸边起向敌方纵深 4 格
  //       player(下方攻上):y ∈ [RIVER_Y1-4, RIVER_Y1) = [11,15)
  //       ai   (上方攻下):y ∈ [RIVER_Y2, RIVER_Y2+4) = [17,21)
  //   桥面:解锁侧桥面可部署(见上)
  // 说明:两侧公主塔都破时,两路各自 4 格深,合起来即"敌方半场除桥外只解锁 4 格"
  if (side === 'player') {
    return y >= RIVER_Y1 - UNLOCK_DEPTH && y < RIVER_Y1;
  } else {
    return y >= RIVER_Y2 && y < RIVER_Y2 + UNLOCK_DEPTH;
  }
}

// 塔占面积判定:点是否落在某存活塔的格子上(公主 3×3 → 半宽 1.5;国王 4×4 → 半宽 2)
function blockByTower(towers, x, y) {
  if (!towers) return false;
  for (const k of ['left', 'right', 'king']) {
    const tw = towers[k];
    if (!tw || tw.dead) continue;
    const hw = tw.type === 'king' ? 2.0 : 1.5;
    if (Math.abs(x - tw.x) <= hw && Math.abs(y - tw.y) <= hw) return true;
  }
  return false;
}

// ===== 部署点吸附 =====
// 点击在可部署区域外附近时,吸附到最近的合法边缘(宽容操作,减少部署失败挫败感)
// 返回吸附后的 {x, y};若点击点本身合法,原样返回;离区域太远(maxSnap 格)返回 null
// 与 canDeploy 同源判定:己方半场 + 解锁区(含解锁侧桥面)
export function snapToDeployZone(side, x, y, enemyTowers, opts = {}, myTowers, maxSnap = 2.5) {
  if (canDeploy(side, x, y, enemyTowers, opts, myTowers)) return { x, y };

  // 候选锚点:沿可部署区域边缘采样,取最近的合法点
  let best = null, bestD2 = Infinity;
  const consider = (cx, cy) => {
    if (!canDeploy(side, cx, cy, enemyTowers, opts, myTowers)) return;
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
  // 4. 解锁区(敌方侧):贴河 4 格深、该路 9 格宽的区域 + 该侧桥面
  if (leftUnlocked || rightUnlocked) {
    const lanes = leftUnlocked && rightUnlocked ? ['l', 'r'] : (leftUnlocked ? ['l'] : ['r']);
    for (const lane of lanes) {
      const x0 = lane === 'l' ? 0.3 : 9.3, x1 = lane === 'l' ? 8.7 : GRID_W - 0.3;
      // 解锁区两条横边:贴河沿 + 敌方纵深侧(距河边 DEPTH 格)
      const bankY = side === 'player' ? RIVER_Y1 - 0.05 : RIVER_Y2 + 0.3;
      const farY  = side === 'player' ? RIVER_Y1 - UNLOCK_DEPTH + 0.05 : RIVER_Y2 + UNLOCK_DEPTH - 0.05;
      for (let sx = x0; sx <= x1; sx += 0.5) {
        consider(sx, bankY);
        consider(sx, farY);
      }
      // 解锁区左右两条竖边
      for (let sy = Math.min(bankY, farY); sy <= Math.max(bankY, farY); sy += 0.5) {
        consider(x0, sy); consider(x1, sy);
      }
      // 桥面(解锁侧)
      const bx = lane === 'l' ? BRIDGE_LEFT : BRIDGE_RIGHT;
      const midY = (RIVER_Y1 + RIVER_Y2) / 2;
      for (const bxx of bx) consider(bxx + 0.5, midY);
    }
  }
  // 5. 国王塔后凸排(己方底线那行 6 格)
  {
    const kbRow = KING_BACK.row[side === 'player' ? 'player' : 'ai'];
    for (let sx = KING_BACK.x0 + 0.3; sx <= KING_BACK.x1 - 0.3; sx += 0.5) {
      consider(sx, kbRow + 0.5);
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
