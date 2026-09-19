// ===============================================
// 战场常量与坐标系
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  // 目标类型位掩码(基础常量,最先定义)
  CR.T = {
    GROUND: 1,
    AIR: 2,
    BUILDING: 4,
    ALL: 7,
    GROUND_BUILDING: 5,
  };

  // 网格:18 宽 x 32 高(单位:格)
  // y=0 顶部=AI(对手)侧, y=31 底部=玩家侧
  // 河道在 y=15..16 之间(两条河流)
  // 桥梁 2 格宽(原 3 格收窄 1/3),对齐公主塔 x 坐标
  const GRID_W = 18;
  const GRID_H = 32;
  const RIVER_Y1 = 15; // 河道上沿(不含)
  const RIVER_Y2 = 17; // 河道下沿(不含),即河道占 y=15,16 两行
  const BRIDGE_LEFT = [3, 4];     // 中心 3.5,对齐左公主塔
  const BRIDGE_RIGHT = [14, 15];  // 中心 14.5,对齐右公主塔

  // 塔位置(格坐标,塔心)
  // AI 塔(上方)
  const TOWERS = {
    ai: {
      left:  { x: 3.5,  y: 4,  type:'princess', lane:'left'  },
      right: { x: 14.5, y: 4,  type:'princess', lane:'right' },
      king:  { x: 9,    y: 1.5, type:'king',     lane:'king'  },
    },
    player: {
      left:  { x: 3.5,  y: 27, type:'princess', lane:'left'  },
      right: { x: 14.5, y: 27, type:'princess', lane:'right' },
      king:  { x: 9,    y: 30.5, type:'king',    lane:'king'  },
    },
  };

  // 塔属性(对齐 wiki 11级 × 0.5:公主塔 3052/109/0.8s,国王塔约 4834/109/1.0s)
  const TOWER_STATS = {
    princess: { hp: 1526, dmg: 54, hitSpeed: 0.8, range: 7.5, sightRange: 7.5, targets: CR.T.ALL, radius: 0.8 },
    king:     { hp: 2417, dmg: 54, hitSpeed: 1.0, range: 7.0, sightRange: 7.0, targets: CR.T.ALL, radius: 1.0 },
  };

  // 圣水
  const MAX_ELIXIR = 10;
  const ELIXIR_RATE = 1 / 2.8; // 每秒增长(2.8秒1费),双倍圣水时翻倍

  // 渲染尺寸
  const CELL = 38; // 每格像素
  const CANVAS_W = GRID_W * CELL;   // 684
  const CANVAS_H = GRID_H * CELL;   // 1216 -> 太高,用缩放

  // 部署区域(连续坐标语义:与像素渲染一致,河道像素区 y∈[15,17)格)
  // 基础:己方半场(玩家 y>=17,AI y<15;紧贴河道的岸边一排可部署)
  // 解锁:摧毁敌方某侧公主塔后,该侧敌方"塔前到河边"的区域可部署(两侧对称)
  // side: 'player' | 'ai';enemyTowers: 敌方塔 {left,right} 状态(可选,传入后启用解锁判定)
  function canDeploy(side, x, y, enemyTowers) {
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
    // 该侧公主塔身前到河边的区域(连续坐标:含岸边整排)
    // (玩家打 AI:区域 y∈[5,15);AI 打玩家:区域 y∈[17,27))
    if (side === 'player') {
      return y >= 5 && y < RIVER_Y1;
    } else {
      return y >= RIVER_Y2 && y < 27;
    }
  }

  // 是否在河道(阻挡地面单位)
  function isRiver(x, y) {
    return y > RIVER_Y1 && y < RIVER_Y2;
  }
  // 是否在桥上(地面可通过)
  function isBridge(x, y) {
    if (!(y > RIVER_Y1 && y < RIVER_Y2)) return false;
    const ix = Math.floor(x);
    return BRIDGE_LEFT.includes(ix) || BRIDGE_RIGHT.includes(ix);
  }

  // 距离(格)
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx*dx + dy*dy);
  }
  function dist2(ax, ay, bx, by) {
    const dx = ax-bx, dy = ay-by;
    return dx*dx+dy*dy;
  }

  // 阵营:0=玩家,1=AI
  const SIDE_PLAYER = 0;
  const SIDE_AI = 1;

  CR.GRID_W = GRID_W;
  CR.GRID_H = GRID_H;
  CR.RIVER_Y1 = RIVER_Y1;
  CR.RIVER_Y2 = RIVER_Y2;
  CR.BRIDGE_LEFT = BRIDGE_LEFT;
  CR.BRIDGE_RIGHT = BRIDGE_RIGHT;
  CR.TOWERS = TOWERS;
  CR.TOWER_STATS = TOWER_STATS;
  CR.MAX_ELIXIR = MAX_ELIXIR;
  CR.ELIXIR_RATE = ELIXIR_RATE;
  CR.CELL = CELL;
  CR.CANVAS_W = CANVAS_W;
  CR.CANVAS_H = CANVAS_H;
  CR.canDeploy = canDeploy;
  CR.isRiver = isRiver;
  CR.isBridge = isBridge;
  CR.dist = dist;
  CR.dist2 = dist2;
  CR.SIDE_PLAYER = SIDE_PLAYER;
  CR.SIDE_AI = SIDE_AI;
})(window.CR);
