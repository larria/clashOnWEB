# 卡牌架构指南 — 新卡实装 SOP(不补丁化)

目标:**每张新卡 = 1 份卡牌数据 + 0~1 个能力注册项 + 1 份资源**,核心引擎零改动。

## 现有架构分层

```
src/data/cards.js        卡牌数据(纯数据,无逻辑)
  └─ special: { 键: 参数 }        ← 能力声明(数据驱动)
src/game/abilities.js    部队/建筑能力解释器(唯一注册点)
  ├─ tickPeriodic()      每帧周期效果(spawn/summon/produceElixir)
  ├─ applyDeathAbilities() 死亡效果(deathDamage/summonOnDeath/deathSummon)
  ├─ applyExpireAbilities() 建筑到期效果
  ├─ afterAttack()       攻击后效果(rampDamage)
  └─ isHeavy()           击退免疫
src/game/spells.js       法术系统
  ├─ castSpell()         施放入口(投射/延时/镜像)
  └─ applySpellEffect()  落地效果(伤害/击退/眩晕/冰冻/狂暴)
src/game/combat.js       移动/攻击(查询式:canJumpRiver/charge)
```

### 能力键清单(部队/建筑,abilities.js 顶部同步维护)

| 键 | 效果 | 挂钩点 |
|---|---|---|
| `canJumpRiver` | 跳河(带贴桥走桥判定) | combat.nextWaypoint |
| `charge` | 冲锋(距离制) | combat.moveUnit/attackTarget |
| `rampDamage` | 递增伤害 | abilities.afterAttack |
| `spawn` | 周期产兵(建筑) | abilities.tickPeriodic |
| `summon` | 周期召唤(行进方向) | abilities.tickPeriodic |
| `produceElixir` | 产圣水 | abilities.tickPeriodic |
| `deathDamage` | 死亡伤害(可延时炸弹) | abilities.applyDeathAbilities |
| `summonOnDeath` | 死亡分裂 | abilities.applyDeathAbilities |
| `deathSummon` | 死亡召唤(建筑到期也触发) | applyDeath/Expire |
| `heavy` | 击退免疫 | abilities.isHeavy |
| `shield` | 护盾(先扣盾,溢出不穿透) | game.dealDamage + unit.js |
| `charge.splash` | 冲锋命中360°溅射 | combat.attackTarget |
| `attackSlow` | 攻击附带范围减速 | combat.attackTarget + game.applySlowAt |
| `spawnDamage` | 落地范围伤害+减速 | game.updateUnits(部署完成时) |

### 法术 special 键(spells.js)

| 键 | 效果 |
|---|---|
| `mirror` | 镜像复制 |
| `chain` | 连锁(打血量最高 N 个) |
| `hits` | 多段命中 |
| `dot` | 区域持续伤害(每tick跳伤+减速,出圈免伤) | spells.applySpellEffect |
| `spawnUnits` | 落地生成部队(ring=环形散开) | spells.applySpellEffect |
| `stun` / `freeze` / `buff+duration` | 状态效果 |
| `spawnUnits`(本版新增) | 落地生成部队(飞桶/墓园/哥布林钻机…) |

## 新增能力键的设计原则

1. **声明式**:卡牌数据只写"是什么",不写"怎么执行"。
   ✅ `special: { spawnUnits: { card:'goblins', count:3, deployTime:1.1 } }`
   ❌ 在 spells.js 的 applySpellEffect 里加 `if (cardId === 'goblinBarrel') {...}`
2. **单一挂钩点**:新机制的执行逻辑只进一个文件(abilities/spells/combat 之一),
   并在该文件头部清单登记;禁止在渲染/AI/主循环里散射 `if`。
3. **已有键优先**:新卡效果若能由既有键组合表达,一律复用。
   例:哥布林飞桶 = `deployZone:'anywhere'` + `projectile`(飞行) + `spawnUnits`(落地生兵)——
   零核心改动,纯数据。
4. **AI 无需逐卡适配**:AI 按卡牌 kind/dmg/radius 等元数据决策。
   只有全新"决策维度"(如钻机需 AI 评估塔后落点)才允许改 ai.js,
   且必须以通用规则(不是 cardId 白名单)形式加入。
5. **资源规范**:卡图 `assets/cards/<id>.png`(wiki 官方图);
   音效 `spell_<id>.ogg` / `deploy_<id>.ogg`(本地 SFX 库,无则 fallback 已有 generic);
   assets-manifest 由 `node tools/version-check.mjs` 自动重生成。
6. **数值换算**:wiki 11 级值 × 0.5(项目约定),记录在 docs/card-stats.json。

## 新卡实装 SOP(检查单)

1. [ ] 查 `docs/cards-wiki/<Card>.md` 抄 11 级数值(×0.5)
2. [ ] cards.js 加一条数据(效果用能力键表达;全新机制 → 先在本文档登记键名再实现)
3. [ ] 卡图入 assets/cards/,音效入 assets/sfx/(可选,fallback 兜底)
4. [ ] headless 冒烟:spawn → 移动/施放 → 效果断言(参考 tools/eval-ai.mjs 的裸 Game 驱动)
5. [ ] `node tools/version-check.mjs` 全绿(重生成 manifest)
6. [ ] AI 回归 `node tools/eval-ai.mjs 10` 无异常
7. [ ] 版本 +1,LOG.md 记录,提交

## 新增键登记(增量日志)

- v0.4.10 `spells.js`:`spawnUnits { card, count, deployTime }` —— 法术落地生成部队。
  哥布林飞桶首个使用者。后续墓园(持续刷兵)/哥布林钻机/骷髅飞桶复用。
