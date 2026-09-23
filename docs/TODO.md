# TODO - 待办与规划

当前版本规格见 PRODUCT.md;历史变更见 LOG.md。
新卡实装 SOP(架构/能力键/检查单)见 docs/ARCHITECTURE-CARDS.md;
全卡 ReleaseDate 排序索引见 docs/card-release-dates.json(实装顺序依据)。
官方卡牌完整数据(离线可查):`docs/cards-wiki/`(113 张卡,
来源 clashroyale.fandom.com,2026-09-22 抓取,每卡一文件含
完整 wikitext:数值表/更新历史/策略描述)。

## 卡牌实装进度

**已实装 42 张**(数值已对齐官方 wiki 11 级 × 0.5,核对记录见
LOG.md v0.4.6):

- 部队 23:骑士、弓箭手、哥布林、投矛哥布林、骷髅兵、亡灵、野蛮人、
  炸弹兵、巨人、迷你皮卡、火枪手、女武神、野猪骑士、法师、皮卡超人、
  王子、飞龙宝宝、骷髅军团、女巫、气球兵、骷髅巨人、戈仑石人、亡灵大军
- 建筑 10:加农炮、特斯拉电磁塔、地狱之塔、炸弹塔、哥布林小屋、
  野蛮人小屋、骷髅墓碑、圣水收集器、X连弩、迫击炮
- 法术 9:火球、万箭齐发、火箭、雷电法术、电击法术、狂暴法术、
  冰冻法术、镜像法术、哥布林飞桶

**未实装 71 张**(类型取自官方 Card Infobox;中文名后括号内为
`docs/cards-wiki/` 文件名,查数据直接开对应文件):

### 部队 Troop(49)
飞贼(Bandit)、蝙蝠(Bats)、狂战士(Berserker)、保龄球手(Bowler)、
加农炮车(Cannon Cart)、黑王子(Dark Prince)、飞镖哥布林(Dart Goblin)、
电磁巨人(Electro Giant)、电精灵(Electro Spirit)、闪电法师(Electro Wizard)、
精英野蛮人(Elite Barbarians)、处刑者(Executioner)、火精灵(Fire Spirit)、
鞭炮女郎(Firecracker)、渔夫(Fisherman)、飞行器(Flying Machine)、
熔炉(Furnace)、哥布林爆破手(Goblin Demolisher)、哥布林帮(Goblin Gang)、
哥布林巨人(Goblin Giant)、哥布林机甲(Goblin Machine)、皇家卫队(Guards)、
治疗精灵(Heal Spirit)、猎人(Hunter)、冰巨人(Ice Golem)、
冰精灵(Ice Spirit)、冰法师(Ice Wizard)、地狱飞龙(Inferno Dragon)、
熔岩猎犬(Lava Hound)、伐木工(Lumberjack)、魔法弓箭手(Magic Archer)、
超级骑士(Mega Knight)、巨型亡灵(Mega Minion)、矿工(Miner)、
巫婆(Mother Witch)、暗夜女巫(Night Witch)、凤凰(Phoenix)、
攻城野猪(Ram Rider)、恶棍小队(Rascals)、浪人(Ronin)、
符文巨人(Rune Giant)、骷髅飞桶(Skeleton Barrel)、
骷髅飞龙(Skeleton Dragons)、电磁炮(Sparky)、精灵女皇(Spirit Empress)、
可疑灌木(Suspicious Bush)、三个火枪手(Three Musketeers)、
炸墙桶(Wall Breakers)、电击小车(Zappies)

### 建筑 Building(2)
哥布林牢笼(Goblin Cage)、哥布林钻机(Goblin Drill)

### 法术 Spell(12)
野蛮人木桶(Barbarian Barrel)、复制(Clone)、地震(Earthquake)、
大雪球(Giant Snowball)、哥布林诅咒(Goblin Curse)、墓园(Graveyard)、治疗法术(Heal)、
毒药(Poison)、滚木(The Log)、龙卷风(Tornado)、虚空(Void)

### 冠军卡 Champion(6)
弓箭女王(Archer Queen)、哥布林斯坦(Goblinstein)、小王子(Little Prince)、
强力矿工(Mighty Miner)、武僧(Monk)、骷髅国王(Skeleton King)

### 其他(王塔驻军/活动,4)
炮手(Cannoneer)、匕首女公爵(Dagger Duchess)、亡灵巨人(Minion Giant,
Wiki 无 Type 标注)、Boss Bandit(活动 Boss)

## 机制级 TODO(不新增卡也能做)

- [ ] 滚木/大雪球/野蛮人木桶:直线滚动物理(当前只有径向击退)
- [ ] 矿工/飞桶/钻机类:全场部署(deployZone 已预留 'anywhere' 语义)
- [ ] 墓园/骷髅飞桶:目标点持续刷兵
- [ ] 复制(Clone):镜像已有雏形,克隆场上单位需单位快照
- [ ] 减速状态(冰法师/毒药/地震/大雪球):statusEffects 扩展
- [ ] 护盾(皇家卫队/黑王子/凤凰):受击先扣盾
- [ ] 蓄力攻击(电磁炮/虚空):charge 状态机扩展(王子冲锋已有基础)
- [ ] 变形(巫婆/哥布林诅咒):单位运行时换卡
- [ ] 治疗类(治疗法术/治疗精灵/凤凰):dealDamage 逆操作+上限
- [ ] 冠军主动技能:技能按钮 UI + 冷却
- [ ] 王塔驻军(Cannoneer/Duchess):塔配置系统
- [ ] 地下钻行(矿工/钻机):无视地形路径层

## 已知问题/优化项(来自 code review,低优先级)

- [ ] applySplash 与 applyAreaDamageAt 双实现合并
- [ ] canTarget 目标掩码判定 4 处复制 → 统一引用
- [ ] drawDeployMask 选牌时每帧 ~4600 次 canDeploy 采样 → 离屏缓存
- [ ] formation 多体卡逐点部署校验(当前只校验中心点)
- [ ] deckeditor 卡组名 HTML 转义(现靠 8 字符限长兜底)
- [ ] hud _renderInfo 仍为整段 innerHTML(已节流,可再 diff 化)

## 更新流程

1. 改代码
2. `src/version.js` + `sw.js` 的 APP_VERSION 各递增小版本(如 0.4.6→0.4.7)
3. `node tools/version-check.mjs` 全绿
4. 提交推送(必要时打 tag)
