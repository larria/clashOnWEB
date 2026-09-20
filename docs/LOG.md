# 行动日志

按时间倒序记录每次阶段性工作(做了什么、为什么)。规格与规范不在本文档——
当前版本的规格见 PRODUCT.md,技术规范见 DEV.md。

---

## 2026-09-20 文档体系重整

- 文档拆为三份:DEV.md(开发)/ PRODUCT.md(产品)/ LOG.md(行动,本文档)
- 原 ARCHITECTURE.md 内容融入 DEV.md 后删除;README.md 保留为仓库简介
- 确立文档维护规则:改动需评估同步 DEV/PRODUCT;两者只对当前版本负责,
  不写历史;历史只进 LOG.md
- 顺手修复:侧栏 AI 强度下拉在架构重构后失去绑定(改由 settings 驱动),
  已重新接回并与设置页双向同步

## 2026-09-20 架构重构(ES Modules 分层)

- 平铺 js/ + window.CR 全局 → src/ 分层(core/data/game/render/ui/input/audio)
- Game 与 UI 解耦:EventBus 领域事件;日志/特效/音效改为订阅
- abilities.js 能力系统:卡牌特殊效果集中一处解释;canDeploy 支持
  deployZone(矿工/飞桶类全屏部署卡的扩展点)
- game.schedule 延迟结算(法术动画延时/攻击前后摇扩展点)
- 设置存储 + 独立设置页;音频框架(桩);Pointer Events 输入抽象
- headless 回归通过后删除旧 js/,推送 Pages

## 2026-09-20 功能迭代(三批)

**交互与显示**
- 去除选牌后地图上的幻影单位虚影(保留部署区高亮/范围圈/×N)
- 覆盖层布局调整(logo 上移、内容下移)、文案防折行自适应
- 时间 HUD 移入 canvas 顶部中央,不占首屏高度
- 圣水改官方紫色;皇室战争 logo 移入开始/暂停遮罩

**AI 与卡组**
- AI 每局从 5 套预设卡组随机选择,不再与玩家同卡组
- 新增卡组编辑器:5 槽、42 卡全集、localStorage 持久化、下拉联动
- 修复野猪卡组重复骷髅兵

**机制对齐**
- 万箭齐发多段命中(61×3),恢复秒杀亡灵
- 多体单位部署队形改为 CR 式横排(弓箭手放底部可分两路)
- 弓箭手横排、野猪跳河、攻城单位侧路锁定与建筑牵引、
  国王塔激活时序、野蛮人小屋产兵/掉血/死亡召唤、骷髅军团 15 只、
  推塔解锁部署区(含岸边排)、部队碰撞阻挡、重型单位击退免疫

## 2026-09-20 数据对齐与部署

- 抓取官方 wiki(MediaWiki API 绕过 Cloudflare)141 张卡数值,
  存 docs/card-stats.json 离线参考;全部 42 卡数值改为 wiki 11级 × 0.5
- 部署到 GitHub(https://github.com/larria/clashOnWEB)+
  GitHub Pages(https://larria.github.io/clashOnWEB/),用 REST API 启用 Pages
  (git credential 提取 PAT 推送,无需 gh CLI)

## 2026-09-19 初版实现

- 42 张卡牌、18×32 战场、圣水/手牌循环、塔系统、寻路索敌、法术、
  Canvas 渲染、AI 决策(counter 表 + 攻防节奏),完整可玩对局
- 修复:canvas 裁切与无法放牌、手牌循环重复、GROUND 单位打不了塔、
  推塔后单位横穿、AI 空放法术、PC 布局不居中、自动开始等问题
