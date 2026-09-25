# 第三方实现规格提炼 —— 寻路 / 战斗逻辑参考手册

> 来源:`/Users/larkin_1/Downloads/clashRoyaleGithubs/` 下仅存的两个项目
> - **ClashRoyaleAi**(C++17,确定性模拟引擎,RL 训练用,含完整测试与审计工具)—— 主要参考对象,本文档主体
> - **Crash-Loyal**(Unity C#,MonoBehaviour 触发器式实现)—— 次要参考,只取其"与真实游戏行为吻合的规则",实现方式不采
>
> 本文档目的:沉淀两项目中经得起推敲的规则设计,供本项目后续实装卡牌/修 bug/重构时对照。所有行号为提炼时的源码位置,便于回查原文。

---

## 一、ClashRoyaleAi 总体架构速览

| 模块 | 文件 | 职责 |
|---|---|---|
| 场地几何 | `include/core/ArenaLayout.h` | 所有常量唯一来源(尺寸/塔位/桥位/镜像函数) |
| 棋盘 | `include/core/Board.h` | 河流约束、桥选择、碰撞分离、建筑推离、实体生命周期 |
| 车道寻路 | `include/core/LanePath.h` | 盲行目标(laneObjective)与接近点(approachPoint) |
| 实体基类 | `include/entities/Entity.h` | 位置/血量/半径口径 + 强制位移四件套 |
| 战斗实体 | `include/entities/CombatEntity.h` | 索敌/锁定/攻击节奏/全部战斗机制字段 |
| 部队/近战/远程 | `Troop.h` / `MeleeTroop.h` / `RangedTroop.h` | 移动、直击、投射物 |
| 建筑/塔 | `Building.h` / `Tower.h` | 寿命衰减、国王塔休眠 |
| 只打建筑 | `BuildingTargeter.h` | 巨人/野猪类索敌 |
| 法术 | `include/entities/AreaSpell.h` | 即时/多段/滚动/增益/克隆全类法术 |
| 投射物 | `include/entities/Projectile.h` | 追踪、命中结算、穿透线 |
| 比赛 | `MatchRules.h` / `TimeoutRules.h` | 终局判定 |
| 对局 | `GameManager.h` | tick 循环、圣水、出牌合法性、手牌循环 |
| 启发式 AI | `HeuristicOpponent.h` | 防/攻/蓄三态 bot |

**tick 制**:10 tick = 1 秒(`ELIXIR_REGEN_RATE = 0.035`/tick ≈ 1 费/2.857s)。全部逻辑整数/浮点确定性,保证 `Board::deepCopy` 快照回放与 RL rollout 一致。

---

## 二、场地几何(ArenaLayout.h)

```
棋盘 18 × 34(格子索引 x∈[0,17], y∈[0,33])
中心线 x = (W-1)/2 = 8.5      ← 注意不是 9.0
镜像   mirrorX(x) = 17 - x ; mirrorY(y) = 33 - y
公主塔列 LEFT_LANE_X = 3.0 / RIGHT_LANE_X = 14.0
塔行   国王 y=2.5(镜像 30.5),公主 y=6.0(镜像 27.0)
桥心   LEFT_BRIDGE_X = 2.5 / RIGHT_BRIDGE_X = 14.5, BRIDGE_Y = 16.5
河流带 [15.5, 17.5)(y 语义:左闭右开,中点 16.5,在 y→33-y 镜像下对称)
```

关键设计决策(均带注释论证):

1. **桥宽 2 格、桥心落在两格接缝上**:格 i 覆盖 `[i-0.5, i+0.5]`,桥心 2.5 + `BRIDGE_HALF_WIDTH=1.0` 恰好覆盖格 2 和格 3。本项目同口径。
2. **棋盘物理边界是 ±0.5 超出索引范围的**(`CELL_HALF_EXTENT`):部署脚印校验必须用物理边界,否则边缘两列的单位永远不合法。
3. **底线死区**:每侧国王塔后排只有中间 6 格(±3.0)是实地,两角不可部署(`isBackRowDeadZone`)。
4. **车道判定 `isLeftLane(x) = x < 8.5`,逐次求值不缓存**——与桥选择用同一规则,保证"盲行目标"与"过河路径"永远一致,不会出现目标在左路、桥选了右路的分裂。

---

## 三、寻路体系(Board.h + LanePath.h + Troop.h)

### 3.1 桥选择:getNextWaypoint(Board.h:371)

无 A*、无网格寻路——**每帧由当前位置到目标位置几何直推**:

```
同侧(都在河上方/下方/都在河带内) → 直接返回目标点
跨河:
  bridgeX = 距当前位置更近的桥(每帧重估,不锁定)
  若在本方河岸:目标 = (bridgeX, 本侧河岸线);已站在近岸口(≤EPS)则改给对岸口
  若在河带内:  目标 = (bridgeX, 出口岸线);已到出口(≤EPS)则直接返回目标点
```

三条防呆注释值得抄录:

- **岸线判断用闭区间**(≤riverY_start 仍算"下方"),站在近岸的单位要给对岸点,否则被路由到自己脚下。
- **河带内不能回给岸线本身**——差 EPS 就到岸却永远冻结在"快上岸"位置(test_board.cpp 的 bridge-exit 块)。
- **WAYPOINT_ARRIVAL_EPS = 0.01 是全局唯一到达容差**,`moveTowards` 与 `getNextWaypoint` 必须共用同一常量——"两个不同 epsilon 在桥口产生吸收态"是该项目实测踩过的坑(注释原话:double epsilon bridge-mouth orbit)。

### 3.2 桥口轨道抖动抑制(Troop.h:34-49)

```
step = min(currentSpeed, distToWaypoint)   // 永不越过路点
```

注释点名根因:**沿河岸线方向的 overshoot 会让单位仍处于"河下方"状态,于是下一帧又被交回同一个桥口,围绕桥口永久公转**(UPSTREAM_REQUESTS item 31)。所以速度钳制到剩余距离,精确落在路点上。本项目 v0.6.x 的桥选择/移动同构。

### 3.3 盲行目标:laneObjective(LanePath.h:22)

视野内无敌人时,部队**不走"全场最近的塔",而是走自己车道的目标**:

```
lane = isLeftLane(from.x)              // 由当前位置定,逐次求值
目标 = 己方车道对应的敌方公主塔(存活时);该塔已倒 → 敌方国王塔
```

注释给出动机:一侧公主塔倒下后,"最近塔"规则会把盲行单位斜着引向另一路,而真实游戏是沿原车道直进国王塔。

### 3.4 国王塔接近点:approachPoint(LanePath.h:49)

打国王塔不打直线,走三段路:

```
W0 = 桥口 (2.5|14.5, 16.5)
W1 = (车道x 3.0|14.0, 敌公主塔行 y)     ← 借用必然空置的公主塔槽位
W2 = 国王塔
```

释放条件:进入 W1 的 EPS 范围,或已到达公主塔所在行(推进方向判断:team0 向 +y)。注释特别警告:**W1 永远不要交给已经站在它上面的单位**,否则 `moveTowards` 拒绝移动、单位冻结。本项目(v0.6.4 之前)修过的"沉底单位绕国王塔"bug 与此同源。

### 3.5 河流约束与越界钳制(clampToBoard,Board.h:351)

```
x,y 钳到 [0, W-1]×[0, H-1]
不在桥上且 y 落入河流带 → 钳回较近的岸线(y < 16.5 → 15.5,否则 17.5)
```

`isOnBridge(x)` 是唯一桥判定函数,物理(clampToBoard)与观测编码共用,**防止两处各写一份产生分歧**(注释明言)。

### 3.6 忽略河流单位

`riverIgnores`(野猪跳河等):`moveTowards` 直接朝目标走,跳过 `getNextWaypoint`;但 `clampToBoard` 同样跳过河流钳制。河带判断全部以该标志为开关,没有特例单位名单。

---

## 四、碰撞与位移体系(Board.h + Entity.h)

### 4.1 半径三口径(易混,该项目拆得很清楚)

| 口径 | 函数 | 用途 |
|---|---|---|
| 碰撞半径 | `getCollisionRadius()` | 物理推离。部队=0(无值),建筑=1.0,公主塔=1.5,国王塔=2.0 |
| 隐式部队半径 | `IMPLICIT_TROOP_RADIUS = 0.4` | 碰撞半径≤0 的实体在物理/射程数学中占的半径 |
| 索敌脚印半径 | `getTargetingRadius()` | **只用于索敌排序**,塔特有(公主 3.3 / 国王 4.4),其余=碰撞半径 |

### 4.2 单位间分离(resolveCollisions,Board.h:274)

每 tick 全量两两(只对 troop×troop 同空域):

```
minDist = 2 × IMPLICIT_TROOP_RADIUS
重叠 → 沿连线各推一半 overlap
+ 垂直方向 0.01 noise      // 防 jitter lock(对称死锁)
完全重合(dist<0.001)→ 给定 (+1,0) 方向
飞行单位间同规则,但飞行 vs 地面不碰撞
```

结束后**全部实体重新 clampPosition**——推离可能把单位推进河或推出界,这是"碰撞不守边界,钳制统一兜底"的分层设计。

### 4.3 建筑推离(resolvePositionAgainstBuildings)

移动结算时逐个建筑 `pushAwayFrom`,minDist = 建筑碰撞半径 + 0.4。`pushAwayFrom`(Board.h:218)带 **0.05 的切向滑动分量**——纯径向推出会贴着墙卡死,切向滑动让它绕行。性能上用 colliders 脏缓存(只有实体增删才失效),移动部队不必全表扫描。

### 4.4 强制位移四件套(Entity.h:128-176)

所有位移(钩拉/龙卷/击退/镜像换线)统一走这四个函数,**禁止任何代码直接写 position**:

```
pullToward(entity, point, distance)      // 拉近,永不超过 point;distance≤0 no-op
pushAway(entity, point, distance)        // 推离
pushAlong(entity, dirX, dirY, distance)  // 沿给定方向推(滚动法术横向甩)
mirrorToOppositeLane(entity, boardWidth) // x 镜像换线
```

统一约束:**建筑(tower/building)永远免疫位移**,只吃伤害——在四个函数里一次性强制,而非每个调用点自查。`distance≤0` no-op 的原因:调用方算的"还需靠近多少"(dist - meleeRange)对已贴脸目标是负数,不防会倒拉。

---

## 五、索敌与攻击(CombatEntity.h)

### 5.1 有效射程:边缘到边缘

```
effectiveRangeTo(target) = attackRange + 自身有效半径 + 目标有效半径
有效半径 = collisionRadius > 0 ? collisionRadius : 0.4
```

本项目同口径。该函数是 static 公开的(`effectiveRadiusOf`),因为法术滚动扫掠也要同一套半径。

### 5.2 视野(sightRange)与射程的分层 —— 该项目最精细的一处

视野是**纯中心到中心距离**(不是边缘到边缘),理由写在注释里:官方公布的射程数据(Hog Rider 9.5)就是中心距口径,"半径回答的是命中盒问题,不是视野问题"。

但纯中心距会产生矛盾:**射程是表面到表面,视野是中心到中心 → 单位可能"打得着却看不见",站在原地发呆**。两个火枪手会在彼此视野外互相僵持。解法(`effectiveSightWith`,CombatEntity.h:772):

```
attackReach = attackRange + myRadius + targetRadius
若 sightRange ≥ attackRange(目录保证成立)且 attackReach > sightRange:
    有效视野 = attackReach          // 视野被抬到不低于攻击触及
否则 = sightRange
```

即:**视野永不低于自己的攻击触及**;bind 的只有射程≈视野的卡(塔、火枪手类),长视野卡(盲行距 5.5+)不受影响。本项目 v0.6.x 修特斯拉"视野与攻击范围口径不一致"时用的是同思路。

### 5.3 目标锁定模型(CombatEntity.h:556-575)

```
每 tick:
  有 taunt 强制目标 → 用之(最高优先)
  否则:
    lock = resolveCurrentTarget()          // 按 id 回查已锁目标
    lock 仅在「处于攻击射程内」时可信;出射程(追击中/被击退/被拉走)视为无锁
    无可信 lock → findTarget() 全场重扫
  冻结(眩晕)状态直接不取目标,并重置锁定
```

注释里的话值得原文引用:"locked on once fighting, re-evaluating while chasing"——**交战中锁定、追击中每帧重扫**。这正是真实游戏行为,也是本项目一直采用的模型(交叉验证确认一致)。

### 5.4 findTarget 排序(CombatEntity.h:798)

```
对每个合法目标:
  dist = 中心距
  塔 → 同时记入「最近塔」备胎(仅兜底用)
  rank = dist - entity.getTargetingRadius()       // ★ 索敌用脚印距离排序
  rank ≤ 有效视野 且 rank < 当前最小 → 记为「视野内最近」
结果优先级:视野内最近 > 车道目标(laneObjective)> 最近塔
```

**塔的 targetingRadius 3.3/4.4 是经验拟合值,非官方数据**——注释给出推导:野猪在加农炮离车道 7-8 格时仍直走公主塔、6 格才转向,反推出 2.92 < r < 3.65,取中值 3.3;国王塔按碰撞半径同比例(2.0/1.5)放大到 4.4。本项目用的是纯中心距,差异 <0.5 格,已记录不修。

合法目标谓词 `isValidTarget`:敌对 + 存活 + 可选中(非隐身)+ 非自身 + (目标飞行 → 需 targetsAir)+ **不在 minAttackRange 盲区内**(迫击炮:盲区内目标直接非法,选下一个,而非站着发呆)。

### 5.5 只打建筑(BuildingTargeter.h)

巨人/野猪类:`findTarget` 同 5.4 但过滤 `!entity->isBuilding()` 跳过;塔与建筑平等竞争。车道兜底同样适用,**保证只打建筑的单位和它的护卫队走向同一座塔**(注释明言这是共用 LanePath 的原因)。

### 5.6 攻击节奏与结算顺序(CombatEntity.h:596-725)

一次完整 update 的次序(严格遵守):

```
1. deployTicksRemaining > 0 → 只减计时器,不索敌不攻击(部署时间内可被打)
2. 状态计时器递减(freeze/buff/curse/cooldown…)
3. 索敌(见 5.3)
4. dist ≤ effectiveRange:
     cooldown==0 → performAttack + 各种 on-hit 附加效果 + cooldown 重置
   否则若 dist ∈ [jumpMin, jumpMax] 且 cooldown==0 → 跳跃攻击(超级骑士)
   否则若 dist ≤ hookRange → 钩拉(渔夫)
   否则 → moveTowards(approachPoint)     // 追击,充能进度累加移动距离
```

**冻结语义**:冻结期间 cooldown 按 freezeSlow 慢速恢复而非暂停;冻结被打断时锁定的 ramp/charge 全重置;`resetCooldownOnFreeze`(电磁炮)在冻结时把冷却重置回满(重新蓄力)。

**部署时间**:targetable + damageable 但 inert(不动不索敌不打),**独立于冻结**——注释特别说明"新单位没有被眩晕过,冻结重置充能/冷却的规则不应误伤它"。本项目同设计。

### 5.7 伤害管线(takeDamage,CombatEntity.h:418)

```
1. 冲锋无敌帧(Bandit 过半程)→ 直接免疫
2. 诅咒乘区(curseDamageTakenMultiplier)
3. 招架(parry)→ 完全抵消,且不消耗护盾   // 顺序:先 parry 后 shield
4. 护盾吸收(shieldHp 先扣,溢出进 hp)
5. hp 扣减 + onDamageTaken 触发器
```

**无友军伤害**:全部区域伤害函数(applySplashDamage/AreaSpell)都以 `entity->team == attackerTeam → skip` 开头,连骷髅巨人死亡炸弹也一样——死亡效果 `deathEffect->apply(board, position, team)` 把 team 传进伤害判定,与本项目 v0.6.4 修复后的行为一致。

### 5.8 伤害计算链(getCurrentDamage)

```
base = damage
× ramp 伤害段(地狱塔:按 ticksOnTarget 分段乘数)
× 冲锋倍率(充能满)
× buff 乘区(狂暴/符文巨人)
× 距离衰减(猎人:线性)
× 距离区间加成(弓箭手 Power Shot:4-6 格 +50%)
× 暴发段(每 N 击爆发)
÷ 分裂目标数(电法系:伤害均摊;电龙 fullDamage 例外)
```

全部乘区集中在 `getCurrentDamage()` 一处,performAttack 只调它——**伤害规则的单一出口**,值得作为实装新卡时的架构原则。

---

## 六、投射物与法术

### 6.1 Projectile.h

- **弱引用追踪目标**:target 死亡 → 投射物下一 tick 自灭,不造成伤害(不找替身)。
- 命中判定 `dist ≤ speed`(一步内到达)→ 位置吸附到命中点再结算。
- on-hit 效果(冰法减速等)**随投射物飞行、命中时才施加**,不是出手时。
- 回旋镖(Executioner):命中后不消失,returnDelay 后同一目标二次伤害。
- 穿透线(滚木/魔法弓手):`applyLineSplashDamage` 用**点到线段投影 + 垂距**判定,proj 钳到 [0, range]。

### 6.2 AreaSpell.h(法术全类)

一次施放的参数空间(构造器一目了然):

| 参数 | 覆盖机制 |
|---|---|
| delayTicks | 引信(火球飞行延迟) |
| remainingHits + tickInterval | 多段(毒药:每跳重查半径内目标,**走出一半就不吃后半段**) |
| groundOnly | 滚木/野蛮人滚筒只打地面 |
| buffsAllies | 狂暴:增益友军而非伤害敌人 |
| knockback(正负) | 正=推离,负=拉近(龙卷风);建筑只吃伤害不被移动 |
| clonesAllies | 克隆:半径内友军各复制 1 hp 分身(先收集后克隆,防边迭代边增长) |
| targetTopHpCount | 藤蔓:只取 N 个最高 hp 目标 |
| tieredDamage | Void:按命中数分档(1 / 2-4 / 5+) |
| spellTowerDamageMultiplier | 对塔伤害乘区(常规法术对塔 30% 系列由数据行给) |
| rollRange/rollWidth/rollSpeed/rollKnockback | 滚动扫掠(见下) |

**滚动扫掷**(滚木)的三条精妙规则:

1. 走廊判定用**目标表面**而非中心:`dy - r > rollTravelled → continue`,注释给出验证:桥上放滚木 10.1 距离恰够到敌公主塔**近缘**(9.00)但够不到中心(10.50),被测试钉死。
2. 每目标每滚**至多一次**(`sweptIds`)。
3. 横向甩飞方向由**被卷入时在走廊的横向位置**决定:中心被沿滚向推、边缘被横甩、中间插值(`pushAlong(lateral, forward)`)——径向 pushAway 表达不了这个,专门为此加了 pushAlong。

### 6.3 建筑(Building.h)

- 寿命衰减:**到期用时钟判定**(ticksAlive ≥ lifetimeTicks),不等整数衰减恰好扣完;衰减伤害每 10 tick 一次,`maxHp / (lifetime/10)`。
- 到期死亡走 `hp = 0` **不走 takeDamage**——过期不是伤害,不触发护盾/受伤效果。
- 衰减每跳发 attributionCleared 事件:防止早前的战斗伤害被误记为击杀。

---

## 七、塔(Tower.h)

1. **国王塔休眠**:不能索敌开火,但**保持 targetable**——这正是"受到任何伤害即可唤醒"触发器能生效的前提。唤醒是单稳态(only sets,治疗不能重新睡)。
2. 唤醒双触发:① hp < maxHp(用 hp 比较而非钩 takeDamage,单一锁存点);② 友方公主塔被毁(**首次 update 记录初始数量再比较**,而非硬编码 2——空棋盘的单元测试没有塔)。
3. **塔的索敌视野由数据给,不从攻击范围推导**(King 7.0 有出处);构造器里 `sightRange = attackRange` 只是测试兜底。
4. 判定国王塔用 `isTower() && symbol=='R'`,注释警告 **Mortar(卡 93)也用 'R' 符号**——必须先 isTower() 再看符号,否则活着的迫击炮会被当成敌方国王塔参与终局判定(MatchRules.h:47 同样防了这一点)。

---

## 八、比赛规则与圣水(GameManager.h / MatchRules.h / TimeoutRules.h)

### 8.1 圣水时刻表(10 tick/s)

```
ELIXIR_REGEN_RATE = 0.035/tick(1 费/2.857s)
0:00-2:00 1x | 2:00-3:00 2x | 3:00+ 3x
DOUBLE_ELIXIR_TICK=1200, TRIPLE_ELIXIR_TICK=1800
static_assert(TRIPLE == REGULATION_END)   // 三倍圣水与加时同刻,编译期钉死
```

圣水按 float 累加,上限 10;**阶段乘数在 tick 推进后读一次、两队共用**;对手 handicap 乘数(oppElixirMultiplier)叠加在阶段乘数上(1.5x 对手在双倍期实际 3x)。

### 8.2 终局四规则(MatchRules.h:72)

```
1. 国王塔倒 → 立即结束;同 tick 双倒 = 平局
2. 常规时间结束(1800 tick)有皇冠差 → 领先者胜
3. 加时先得任意皇冠 → 立即胜
4. 加时耗尽 → 最弱塔血量 tiebreak
```

规则 2/3 合并成一个谓词:`tick ≥ 1800 且 aliveCount[0] ≠ aliveCount[1] → 结束`。

### 8.3 tiebreak(TimeoutRules.h)

```
1. 存活塔数少者负
2. 数量相同 → 最弱塔 hp 低者负(**绝对值**,非百分比——注释明言这是与真机的已知分歧:真机比百分比,King 4008 vs Princess 2534 两种口径常得出不同结论,有意选绝对值)
3. 全等 = 平局
```

### 8.4 出牌合法性(isValidPlacement)

```
1. 界内(x/y ∈ [0, max]) + 非底线死区
2. 非法术:
   - 脚印不出物理边界(±0.5)
   - 非 deploy-anywhere 卡守己方半场(河岸 -0.5 缓冲)
   - 不与现有建筑重叠(所需间距 = 新卡脚印 + 建筑碰撞半径)
3. 滚动法术特例:只能放在己方半场或河带内(深入敌方半场会滚出棋盘)
   注释给出依据:从桥上放滚木,10.1 距离恰好够到敌公主塔近缘 9.00
```

Miner/Goblin Drill 的 `deployAnywhere` 跳过半场规则但**不跳过**建筑重叠检查。

### 8.5 tick 主循环(step)

```
tick++
读圣水阶段(一次,两队共用)
圣水回复 + 手牌冷却 tick
commitPendingEntities()          // 上一 tick 出的牌入场
所有存活实体 update()
收集器产圣水 drain(带上限)
commitPendingEntities()          // 本 tick 攻击产生的投射物/召唤物入场
resolveCollisions()              // 分离 + 重新 clamp
MatchRules::evaluateAtTick()     // 终局判定
syncChampionCooldowns()          // 在实体更新后、清尸前(死亡英雄的冷却要被记录)
cleanDeadEntities()              // 死亡效果 → onNearbyDeath 广播 → 移除
```

**两次 commit 的含义**:实体在 pending 列表里"存在但未入场",本 tick 的攻击打不到它们——这是"部署 1 秒 inert"之外的另一层时间隔离。死亡清理的三段式(onDeath 先于移除、onNearbyDeath 单独一轮只达在场实体)保证死亡效果新召唤的单位不会立刻收到"附近有人死了"的广播(骷髅王收魂逻辑)。

---

## 九、速度与时间基准(CardStats.h)

官方速度只有五档(tiles/min):**30 / 45 / 60 / 90 / 120**(Very Slow..Very Fast)。该项目用两帧实测标定换算(Giant 45→0.987 格/s,Mini PEKKA 90→2.003,吻合 1.5%),并且**以"命名档位"而非全局乘子实现**——注释理由:同档位的卡必须同速,全局 scale 无法保证这一点。部署时间统一 10 tick(1.0s),注释称不设部署时间是"系统性偏袒防守"。

---

## 十、启发式 AI(HeuristicOpponent.h)—— 防攻蓄三态

```
每 25 tick 才可能行动一次(防持续喂兵)
可负担的手牌集合;然后:
  威胁检测:敌方(team0)最深入本方半场的 targetable 单位(投射物/隐身不算)
  DEFEND:威胁过河 → 出「最贵可负担卡」打在威胁位置(y 钳到本方半场内)
  ATTACK:圣水 ≥ 7 → 出最贵卡在本局随机选定的车道桥口
  HOLD:否则不出
  法术特例:目标 y 可直接取威胁位置(法术全场)
```

值得借鉴的细节:出牌选**最贵**可负担卡(max_element by cost)而非随机——保证防御强度下限;push 阈值 7 而非 10,注释:"要留一张跟进牌的钱"。本项目 AI 更精细,但"威胁=最深入半场的可选中单位"的威胁定义可对照。

---

## 十一、Crash-Loyal(Unity)可取的规则点

实现为 OnTriggerEnter/Exit 触发器 + 协程,物理交给 Unity NavMesh,**工程方式不可取**(索敌列表增删在遍历中、无确定性、无战争迷雾),但以下行为规则与真实游戏吻合,可作旁证:

1. **攻击节奏模型**(Unit.cs:132):锁定目标 → 停止移动 → 每 0.05s 检查「目标死亡或超出 range → 解锁重索」——与 ClashRoyaleAi 的"交战中锁定、脱离重扫"互相印证。
2. **索敌重扫节流**:每 0.1-0.2s(随机)才 SetTarget 一次,而非每帧——帧率无关的近似,印证"索敌不必每帧"。
3. **国王塔激活双触发**(Tower.cs):公主塔被毁事件 + 受到伤害时 `isActive = true`,与 C++ 版一致;但**它只在 OnTriggerEnter 时才 SetNewTarget,休眠塔被打醒后要等下一次索敌周期才开火**——真实游戏唤醒即刻可打,C++ 版(唤醒后正常 findTarget)更准,本项目从 C++ 版。
4. **目标建筑选择**(TowerManager.cs:25):只看 **|x 差|**(车道),不看欧氏距离——与 LanePath 的"车道优先"思想一致,是"车道制而非最近制"的第二个旁证。但它的循环 `for (i < 2 && i < count)` 隐含"敌方塔列表前两个是公主塔"的脆弱假设,不采。
5. **对空判定**(Unit.cs:121):不能对空的单位把空军从索敌列表里过滤掉(而非选中后打不到干瞪眼)——与 isValidTarget 的 targetsAir 过滤一致。
6. **飞行单位不走 NavMesh**(AirMeleeUnit.cs):自己 MoveTowards 直线飞 + 无视地形——印证 isFlying 的物理豁免(不碰撞、不绕河)。

---

## 十二、与本项目(clash)的对照结论

交叉验证过的部分(一致,无需改):

| 规则 | 两项目口径 | 本项目 |
|---|---|---|
| 桥选择 | 最近桥,逐次重估 | 一致 |
| 攻击射程 | 边缘到边缘(+双方半径) | 一致 |
| 追击重扫 | 交战锁定,追击每帧重索 | 一致 |
| 死亡炸弹/法术友伤 | 只伤敌方 | 一致(v0.6.4 修复后) |
| 国王塔唤醒 | 受伤或公主塔毁,单稳态 | 一致 |
| 部署时间 | 可受击但 inert | 一致 |

已知的可参考改进点(本项目尚未实装/可对照检查):

1. **视野与射程的 floor 规则**(§5.2):视野被抬到不低于攻击触及——实装"射程≈视野"的卡(塔类、火枪手)时必须检查,否则出现打不着却站桩的僵局。
2. **索敌排序的塔脚印折算**(§5.4):塔用 3.3/4.4 拟合半径参与排序,使"打塔 vs 打靠近的部队"的权衡更接近真机。本项目用纯中心距,差异 <0.5 格,已记录,修不修待定。
3. **车道目标制**(§3.3):一侧公主塔倒后,盲行单位沿原车道直进国王塔而非斜切另一路。本项目桥选择每帧重估,塔目标若取"最近塔"可能出现斜切——实装推塔后场景时可对照检查。
4. **国王塔三段接近点**(§3.4):打国王先沿车道到公主塔行再拐入。本项目 dodgeTower 已有类似绕行,但未显式建模 W1 路点。
5. **河带内路点不回给岸线**(§3.1):差 EPS 冻结在河里——排查"单位卡河"类 bug 时优先查这里。
6. **碰撞后统一 re-clamp**(§4.2):推离可能把单位推进河/出界,分离之后必须整体钳制一遍。
7. **伤害规则单一出口**(§5.8):所有乘区集中在一个 getCurrentDamage,实装新机制(狂暴/冲锋/爆发)时避免散落在 performAttack 各处。
8. **对塔伤害乘区**(§6.2):法术对塔减伤是数据行字段(spellTowerDamageMultiplier),实装火箭/火球等时用数据而非 if 卡名。
9. **多段法术逐跳重查半径**(§6.2):毒药每跳重新判定圈内目标,走出的不再受伤。

---

*文档生成于 v0.6.6 之后;行号对应 2026-09 提炼时的源码版本。*
