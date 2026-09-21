# 开发文档

面向开发者的技术规格:架构、约定、扩展指南、验证方法。
只描述当前版本,历史变更见 `docs/LOG.md`。

## 目录结构

```
clash/
├── index.html            入口(DOM 骨架,无逻辑)
├── css/main.css          全部样式
├── src/
│   ├── main.js           应用入口:流程状态机 + 模块编排(唯一知道所有模块的文件)
│   ├── core/             与游戏无关的基础设施
│   │   ├── constants.js  战场常量/坐标系/部署判定(canDeploy)
│   │   ├── events.js     事件总线(EventBus + appBus)
│   │   └── settings.js   设置存储(localStorage + settings:changed 事件)
│   ├── data/             纯数据
│   │   └── cards.js      42 张卡牌定义(数值/特殊效果参数/deployZone)
│   ├── game/             游戏逻辑(不知道 UI 存在)
│   │   ├── game.js       Game 类:状态/更新循环/胜负/schedule 延迟结算/事件总线
│   │   ├── unit.js       Unit 类
│   │   ├── tower.js      Tower 类
│   │   ├── combat.js     寻路/索敌/攻击/范围伤害
│   │   ├── spells.js     法术效果 + 部署入口
│   │   ├── abilities.js  ★ 能力系统:卡牌特殊效果的唯一解释器
│   │   ├── formation.js  多体部署队形
│   │   └── ai.js         AI 决策
│   ├── render/           表现层
│   │   ├── renderer.js   Canvas 渲染(只读 Game 状态)
│   │   ├── graphics.js   绘制原语/调色板/单位图形/法术特效(orb 回退样式)
│   │   └── cardart.js    卡牌图片资源(assets/cards/,统一加载与绘制)
│   ├── ui/               DOM 界面
│   │   ├── screens.js    遮罩(开始/暂停,未来封面)与结算
│   │   ├── hand.js       手牌/圣水条
│   │   ├── hud.js        倒计时/大提示/信息面板
│   │   ├── gamelog.js    战斗日志
│   │   ├── deckeditor.js 卡组编辑器(5 槽,localStorage)
│   │   └── settingsui.js 设置页(definitions 驱动,自动出现新设置项)
│   ├── input/
│   │   └── input.js      Pointer Events 抽象(拖拽放兵扩展点)
│   └── audio/
│       └── audio.js      音频系统(WebAudio:懒加载/节流/事件订阅/音乐循环)
└── docs/                 DEV.md / PRODUCT.md / LOG.md / 数值存档
```

## 核心约定

### 1. 单向依赖:Game 不知道 UI

```
input.js ─┐
          ├─→ main.js ─→ Game(逻辑)
ui/*  ────┘      ↑            │
                │            emit 事件
audio.js ←──────┴──────────────┘ (订阅 game.bus)
```

- Game 及 game/* 模块**不 import** render/ui/audio 任何东西
- 游戏内沟通全部走 `game.bus`(EventBus):`unit:killed`、`tower:destroyed`、
  `spell:hit`、`card:played`、`log`、`match:end` 等,事件清单见 events.js 头部注释
- 应用级(跨局)事件走 `appBus`:`settings:changed`、`decks:changed`
- 伤害结算统一入口 `game.dealDamage` / `game.dealTowerDamage`,死亡效果由 abilities 接管

### 2. 能力系统(abilities.js)

卡牌特殊效果统一由 abilities.js 解释,不散落在 game/combat/spells 的 if-chain:
- 卡牌数据 `special` 里的键 → abilities.js 里的执行逻辑(键清单见该文件头部注释)
- **新卡牌效果已有键** → 只改 data/cards.js 填参数
- **全新机制** → abilities.js 注册 + 对应系统留一个挂钩点

### 3. 延迟结算(game.schedule)

`game.schedule(delay, fn)` 在**游戏时间尺度**上延迟执行(暂停即冻结):
- 法术动画延时:先播动画 → schedule 落伤害
- 攻击前摇/后摇:schedule(前摇时长) → 落伤害

### 4. 部署规则(data 驱动)

`card.deployZone`:`undefined`(己方半场,默认)| `'anywhere'`(法术、矿工、飞桶)
`canDeploy(side, x, y, enemyTowers, {zone})` 统一解释,游戏与渲染共用同一判定。

### 5. AI 决策与评测

- `game/ai.js`:评分制决策(候选动作枚举打分),AI 类支持 `side` 参数
  (评测镜像用);COUNTERS/ROLE 表为新卡接 AI 的入口
- 评测(不改游戏规则,纯决策层验证):
  - `node tools/eval-ai.mjs [N]` — AI 镜像对局(健康度/平衡性检查)
  - `node tools/eval-ai-vs-baseline.mjs [N]` — 新 AI vs 基线
    (`tools/baseline/ai_baseline.mjs` 为上次快照),交替侧别消除
    地图侧优势;**改 AI 后必跑**
  - 对战系统无 DOM 依赖,Node 直接 import 即可 headless 驱动
  - 换基线:改进验收后 `git show HEAD:src/game/ai.js` 覆盖 baseline

### 6. 设置

`core/settings.js` 定义项 → `ui/settingsui.js` 自动渲染控件 → `settings:changed`
事件驱动各处(音频开关、部署区显示、AI 强度)。新增设置只改 definitions + 一个订阅处。

### 7. 数值口径

游戏内数值 = 官方 wiki 11 级 × 0.5(四舍五入)。数据来源与换算规则见
`docs/CARD-STATS.md`,原始快照 `docs/card-stats.json`(离线可查,无需重新抓取)。

### 8. 卡图素材(命名与校验)

- **权威映射**:`docs/card-art-map.json`(cardId → wiki 文件名,已逐一核验)。
  wiki 卡图命名是**驼峰无空格**(`HogRiderCard.png`)。2026-09 事故根因:
  脚本猜测下划线命名(`Hog_RiderCard.png`)在 wiki 不存在,兜底静默抓了
  横版渲染图,17 张卡图规格错误
- **重取/校验**:`python3 tools/fetch-card-art.py`(校验)/ `--fetch`(重下)。
  脚本只认映射文件,下载后强制规格校验(比例 ≈0.84、≤300px),不符即
  报错拒绝——禁止静默兜底换素材
- 例外:miniPekka/pekka 在 wiki 无标准 Card.png(见映射 _meta.special),
  本地为竖版裁剪图;golemite 复用 golem 图

## 常见扩展指南

### 添加新卡牌

1. `data/cards.js` 加卡(数值照 docs/card-stats.json 换算)
2. 卡图:在 `docs/card-art-map.json` 登记真实 wiki 文件名(用 pageimages
   API 核验),再 `python3 tools/fetch-card-art.py --fetch <cardId>` 下载;
   cardart.js 自动加载;无图时自动回退 orb 样式
3. 特殊效果:special 填已有能力键;全新机制在 `game/abilities.js` 注册
4. 图形(回退样式):`render/graphics.js` drawUnitIcon 加一个 case
5. 部署特殊(矿工/飞桶):`deployZone:'anywhere'`
6. AI 认识它:`game/ai.js` 的 COUNTERS/ROLE 表加条目

### 添加新设置项

1. `core/settings.js` 的 DEFINITIONS 加一项(key/def/label)
2. 在消费处 `settings.get(key)` 或订阅 `settings:changed`
3. 设置页控件自动出现,无需改 settingsui.js

### 添加新领域事件

1. `game` 内 `this.bus.emit('xxx', payload)`(事件名与 payload 注释加到 events.js 头部清单)
2. 表现层订阅,回调内不得反向修改游戏状态

## 回归验证

headless 方式:浏览器 evaluate 直接驱动 `CR._dbg.game.update(dt)` + `ai.decide()`
(`CR._dbg` 是 main.js 留的调试出口),跑完整一局确认无异常。发版前至少:
- 3 局完整对战无 JS 错误
- 机制抽查:万箭秒亡灵 / 野猪跳河 / 国王塔激活时序 / 推塔部署解锁 /
  圣水收集器产费 / 墓碑死亡召唤
- UI 链路:选牌→部署、卡组编辑器、设置页开关

## 运行与部署

无构建、无依赖,静态托管即用:

```bash
cd clash && python3 -m http.server 8000   # 本地
```

线上:GitHub Pages 自动部署自 main 分支(https://larria.github.io/clashOnWEB/)。
注意 ES Modules 要求 http(s) 协议,file:// 直开不可用。

## 文档维护规则

**每次改动需评估是否同步文档:**
- 改架构/依赖关系/模块职责 → 本文档(DEV.md)
- 改玩法规则/卡牌/界面功能 → PRODUCT.md
- 完成一个阶段的工作 → LOG.md 追加一条
- 开发与产品文档只对当前版本负责,不写历史(历史只进 LOG.md)
