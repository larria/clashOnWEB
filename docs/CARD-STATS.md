# 卡牌数值离线参考

`card-stats.json` —— 全部 141 张卡牌(139 卡 + 公主塔/国王塔)的官方 wiki 数据快照,
用于离线添加新卡牌时查阅,避免重新联网抓取。

## 数据来源

- 抓取自 https://clashroyale.fandom.com(MediaWiki API)
- 工具:`fetch_all_stats.py`(可断点续跑,重抓时执行数次直到 pending=0)

## 字段说明

```
cards.<卡名>.kind       'troop' | 'spell' | 'building' | 'tower'
cards.<卡名>.info       { cost, rarity, type } 卡牌信息框
cards.<卡名>.vars       wiki 的 #vardefine 数值变量(11 级基准)
cards.<卡名>.attributes 属性表:费用/攻速/速度/射程/目标/数量/运输 等
cards.<卡名>.levels     静态等级表(仅塔等无公式页)
```

### vars 变量命名规则(重要)

| 变量 | 含义 |
|---|---|
| `hp_11` / `dmg_11` / `atk_speed` | 常规:11 级血量/伤害/攻速 |
| `hp_base` / `dmg_base` | 多单位卡(骷髅/亡灵/弓箭手等):同样是 11 级基准 |
| `hut_hp_11` / `tomb_hp_11` | 产兵建筑本体血量(页面里的 `hp_11` 是它产出的兵!) |
| `golem_hp_11` / `mite_hp_11` | 戈仑页:本体/小戈仑;`golem_death_11` 死亡伤害 |
| `crown_dmg_11` | 法术对皇冠塔伤害(通常为对单位的 30%) |
| `1_dmg_11` `2_dmg_11`… | 多段伤害(如 Mighty Miner) |
| `life` | 建筑持续时间(秒) |

### 全等级换算公式

wiki 表格由公式生成:**`value = var × 1.1^(level − 11)`**(round 0)。
例如亡灵 hp_base=230,9 级 = 230×1.1⁻² ≈ 190。

## 本项目数值缩放

游戏内数值 = **11 级 × 0.5**(四舍五入),与塔一致:
公主塔 11 级 3052/109 → 游戏内 1526/54。

## 常用查值示例

```python
import json
d = json.load(open('docs/card-stats.json'))
c = d['cards']['Musketeer']
print(c['vars'])        # {'hp_11': 721, 'dmg_11': 217, 'atk_speed': 1.0}
print(c['attributes'])  # {'Cost': '4', 'Hit Speed': '1 sec', 'Speed': 'Medium (60)', ...}
# 换算游戏内数值:round(721*0.5)=360 血, round(217*0.5)=108 伤害
```
