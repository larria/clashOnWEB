// ===============================================
// 强制位移系统(机制底盘,规格 §4.4 对照 C++ Entity.h 位移四件套)
//
// 设计原则(全部来自参考实现的教训):
//   1. 所有位移(钩拉/龙卷风聚拢/击退/横向甩飞)统一走这四个函数,
//      禁止任何代码直接写 unit.x/y 施加位移(移动/碰撞系统除外)
//   2. 建筑与塔永远免疫位移,只吃伤害——在函数内一次强制,
//      而非每个调用点自查
//   3. distance ≤ 0 为 no-op:调用方算的"还需靠近多少"(dist - range)
//      对已贴脸目标是负数,不防会倒拉
//   4. 位移后统一 clampPosition(河/界),分离系统不管边界——
//      这是"位移不守边界、钳制统一兜底"的分层
//
// 现有调用方迁移说明:spells.js 的法术击退目前手写径向位移 + clamp,
// 保留其特化逻辑(击退打断冲锋等),后续渔夫/龙卷风实装时迁到此处。
// ===============================================

// 建筑免疫(塔是静态障碍,isBuilding 的建筑单位同样不可移动)
function immovable(entity) {
  return entity.isBuilding || entity.isTower;
}

// 拉近:向 point 移动至多 distance 格,永不越过(渔夫钩拉/龙卷风聚拢)
export function pullToward(game, entity, point, distance) {
  if (immovable(entity) || distance <= 0) return;
  const dx = point.x - entity.x, dy = point.y - entity.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 0.01) return;   // 重合:无方向
  const moveBy = Math.min(distance, d);
  clampUnit(game, entity, entity.x + (dx / d) * moveBy, entity.y + (dy / d) * moveBy);
}

// 推离:沿 point→entity 连线方向推 distance 格(击退)
export function pushAway(game, entity, point, distance) {
  if (immovable(entity) || distance <= 0) return;
  const dx = entity.x - point.x, dy = entity.y - point.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 0.01) return;
  clampUnit(game, entity, entity.x + (dx / d) * distance, entity.y + (dy / d) * distance);
}

// 沿给定方向推 distance 格(滚木横向甩飞:被卷入位置决定方向,
// 径向 pushAway 表达不了;方向不必归一,零向量 no-op)
export function pushAlong(game, entity, dirX, dirY, distance) {
  if (immovable(entity) || distance <= 0) return;
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (len <= 0.0001) return;
  clampUnit(game, entity, entity.x + (dirX / len) * distance, entity.y + (dirY / len) * distance);
}

// 镜像换线:x 镜像到对侧车道(强力矿工逃生/巨人投掷)
export function mirrorToOppositeLane(game, entity) {
  if (immovable(entity)) return;
  clampUnit(game, entity, 17 - entity.x, entity.y);
}

// 统一边界钳制(内部):地面单位不进非桥河道、不出地图
import { GRID_W, GRID_H, isRiver, isBridge } from '../core/constants.js';
function clampUnit(game, entity, nx, ny) {
  nx = Math.max(entity.radius, Math.min(GRID_W - entity.radius, nx));
  if (!entity.flying && isRiver(nx, ny) && !isBridge(nx, ny)) {
    // 尝试仅保留 x / 仅保留 y / 退回原位(与 game.pushUnit 同策略)
    if (!isRiver(entity.x, ny) || isBridge(entity.x, ny)) {
      ny = entity.y;
    } else if (!isRiver(nx, entity.y) || isBridge(nx, entity.y)) {
      ny = entity.y;
    } else {
      return;   // 两个方向都进河:不动
    }
  }
  ny = Math.max(entity.radius, Math.min(GRID_H - entity.radius, ny));
  entity.x = nx;
  entity.y = ny;
}
