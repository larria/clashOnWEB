// ===============================================
// 卡牌数据定义(42 张:24 部队 + 10 建筑 + 8 法术)
// 数值对齐官方 wiki 11级 × 0.5(见 docs/card-stats.json)
//
// 新增卡牌指南:
//   常规属性直接照抄 wiki 换算;
//   特殊效果写在 special 中,由 src/game/abilities.js 解释执行——
//   若效果已有能力键(见 abilities.js 顶部清单),填参数即可;
//   全新机制才需要在 abilities.js 注册新能力。
//
// 字段说明(特殊):
//   deployZone: 部署规则。undefined=己方半场(默认) | 'anywhere'=全场(法术、矿工、飞桶…)
//   hidden:     内部卡(不在选择列表)
// ===============================================

const T = { GROUND: 1, AIR: 2, BUILDING: 4, ALL: 7 };
const SPEED = { SLOW: 0.6, MEDIUM: 1.0, FAST: 1.5, VERY_FAST: 2.0 };
export const KIND = { TROOP: 'troop', BUILDING: 'building', SPELL: 'spell' };

export const CARDS = {
  // ===== 普通 =====
  knight: { id:'knight', name:'骑士', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:883, dmg:101, hitSpeed:1.2, range:1.2, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#9b8c7a', radius:0.42 },
  archers: { id:'archers', name:'弓箭手', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:152, dmg:56, hitSpeed:0.9, range:5.0, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:2, splash:0, deployTime:1, color:'#d65a5a', radius:0.35 },
  goblins: { id:'goblins', name:'哥布林', cost:2, rarity:'普通', kind:KIND.TROOP,
    hp:101, dmg:62, hitSpeed:1.1, range:0.5, sightRange:5.5, speed:SPEED.VERY_FAST,
    targets:T.GROUND, flying:false, count:4, splash:0, deployTime:1, color:'#7cb342', radius:0.32 },
  spearGoblins: { id:'spearGoblins', name:'投矛哥布林', cost:2, rarity:'普通', kind:KIND.TROOP,
    hp:66, dmg:40, hitSpeed:1.6, range:5.0, sightRange:5.0, speed:SPEED.VERY_FAST,
    targets:T.ALL, flying:false, count:3, splash:0, deployTime:1, color:'#8bc34a', radius:0.30 },
  skeletons: { id:'skeletons', name:'骷髅兵', cost:1, rarity:'普通', kind:KIND.TROOP,
    hp:40, dmg:40, hitSpeed:1.1, range:0.5, sightRange:5.0, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:3, splash:0, deployTime:1, color:'#eeeeee', radius:0.28 },
  minions: { id:'minions', name:'亡灵', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:115, dmg:54, hitSpeed:1.2, range:2.5, sightRange:5.5, speed:SPEED.FAST,
    targets:T.ALL, flying:true, count:3, splash:0, deployTime:1, color:'#5c6bc0', radius:0.33 },
  barbarians: { id:'barbarians', name:'野蛮人', cost:5, rarity:'普通', kind:KIND.TROOP,
    hp:358, dmg:96, hitSpeed:1.4, range:0.7, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:5, splash:0, deployTime:1, color:'#bf6b1f', radius:0.36 },
  bomber: { id:'bomber', name:'炸弹兵', cost:2, rarity:'普通', kind:KIND.TROOP,
    hp:152, dmg:112, hitSpeed:1.8, range:4.5, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:1.5, deployTime:1, color:'#3a3a3a', radius:0.35 },

  // ===== 稀有 =====
  giant: { id:'giant', name:'巨人', cost:5, rarity:'稀有', kind:KIND.TROOP,
    hp:1984, dmg:126, hitSpeed:1.5, range:1.2, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:1, color:'#ff9933', radius:0.55 },
  miniPekka: { id:'miniPekka', name:'迷你皮卡', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:695, dmg:378, hitSpeed:1.6, range:0.8, sightRange:5.5, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#b0bec5', radius:0.4 },
  musketeer: { id:'musketeer', name:'火枪手', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:360, dmg:108, hitSpeed:1.0, range:6.0, sightRange:6.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, color:'#ab47bc', radius:0.38 },
  valkyrie: { id:'valkyrie', name:'女武神', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:954, dmg:133, hitSpeed:1.5, range:1.2, sightRange:5.0, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:2.0, deployTime:1, color:'#e91e63', radius:0.42 },
  hogRider: { id:'hogRider', name:'野猪骑士', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:848, dmg:158, hitSpeed:1.6, range:0.8, sightRange:5.5, speed:SPEED.VERY_FAST,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:1, color:'#8d6e63', radius:0.42,
    special:{ canJumpRiver:true } },
  wizard: { id:'wizard', name:'法师', cost:5, rarity:'稀有', kind:KIND.TROOP,
    hp:416, dmg:140, hitSpeed:1.4, range:5.5, sightRange:6.0, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:1.5, deployTime:1, color:'#42a5f5', radius:0.38 },

  // ===== 史诗 =====
  pekka: { id:'pekka', name:'皮卡超人', cost:7, rarity:'史诗', kind:KIND.TROOP,
    hp:1880, dmg:421, hitSpeed:1.8, range:1.2, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#90a4ae', radius:0.55 },  // wiki 11级×0.5;速度 Slow(45)=0.6格/s;近战 Medium 1.2
  prince: { id:'prince', name:'王子', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:960, dmg:196, hitSpeed:1.4, range:1.6, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#5d4037', radius:0.5,
    special:{ charge:{ distance:2, dmgMult:2.0, speedMult:1.6 } } },  // 冲锋:走2格充能(wiki:travels 2 tiles),命中/眩晕/击退重置
  darkPrince: { id:'darkPrince', name:'黑王子', cost:4, rarity:'史诗', kind:KIND.TROOP,
    hp:600, dmg:133, hitSpeed:1.3, range:1.2, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:1.1, deployTime:1, color:'#37474f', radius:0.5,
    special:{ shield:128, canJumpRiver:true,
      charge:{ distance:3, dmgMult:2.0, speedMult:2.0, splash:1.1 } } },
    // wiki 11级×0.5:hp1200/2=600 盾256/2=128 dmg266/2=133 冲锋532/2=266(=2×dmg)
    // 攻速1.3(wiki atk_speed) 射程1.2 溅射1.1 冲锋3格充能·速度极快(2×中速)
    // 冲锋命中360°溅射(围杀无效);护盾先扣·溢出不穿透;可跳河(2016-02-29 实装)
  babyDragon: { id:'babyDragon', name:'飞龙宝宝', cost:4, rarity:'史诗', kind:KIND.TROOP,
    hp:576, dmg:84, hitSpeed:1.5, range:3.5, sightRange:5.5, speed:SPEED.FAST,
    targets:T.ALL, flying:true, count:1, splash:1.5, deployTime:1, color:'#ec407a', radius:0.45 },
  skeletonArmy: { id:'skeletonArmy', name:'骷髅军团', cost:3, rarity:'史诗', kind:KIND.TROOP,
    hp:40, dmg:40, hitSpeed:1.1, range:0.5, sightRange:5.0, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:15, splash:0, deployTime:1, color:'#fafafa', radius:0.26 },
  witch: { id:'witch', name:'女巫', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:420, dmg:68, hitSpeed:1.1, range:5.5, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:1.5, deployTime:1, color:'#6a1b9a', radius:0.380,
    special:{ summon:{ card:'skeletons', count:4, interval:7, firstDelay:1 } } }, // wiki:每7秒4只,首波部署后1秒
  balloon: { id:'balloon', name:'气球兵', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:840, dmg:320, hitSpeed:2.0, range:0.1, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.BUILDING, flying:true, count:1, splash:1.5, deployTime:1, color:'#26a69a', radius:0.50,
    special:{ deathDamage:{ dmg:120, splash:1.5, targets:T.ALL, delay:3 } } },  // wiki 11级×0.5:死亡伤害 240/2=120  // 3秒引信
  giantSkeleton: { id:'giantSkeleton', name:'骷髅巨人', cost:6, rarity:'史诗', kind:KIND.TROOP,
    hp:1680, dmg:138, hitSpeed:1.3, range:0.8, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#cfd8dc', radius:0.52,
    special:{ deathDamage:{ dmg:344, splash:2.0, targets:T.ALL, delay:3 } } },  // wiki 11级×0.5:死亡 688/2=344 半径 2(原 2.5/对塔双倍为误设)  // 对塔双倍
  golem: { id:'golem', name:'戈仑石人', cost:8, rarity:'史诗', kind:KIND.TROOP,
    hp:2560, dmg:156, hitSpeed:2.5, range:0.75, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:3, color:'#558b2f', radius:0.60,
    special:{ deathDamage:{ dmg:112, splash:2.0, targets:T.ALL }, summonOnDeath:{ card:'golemite', count:2 } } },  // wiki 11级×0.5:部署3s(特有);近战 Short 0.75;死亡伤害 225/2≈112
  minionHorde: { id:'minionHorde', name:'亡灵大军', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:115, dmg:54, hitSpeed:1.1, range:2.5, sightRange:5.5, speed:SPEED.FAST,
    targets:T.ALL, flying:true, count:6, splash:0, deployTime:1, color:'#3949ab', radius:0.32 },

  // ===== 建筑 =====
  cannon: { id:'cannon', name:'加农炮', cost:3, rarity:'普通', kind:KIND.BUILDING,
    hp:412, dmg:106, hitSpeed:1.0, range:5.5, sightRange:5.5, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#455a64', radius:1.35 },
  tesla: { id:'tesla', name:'特斯拉电磁塔', cost:4, rarity:'普通', kind:KIND.BUILDING,
    hp:576, dmg:110, hitSpeed:1.1, range:5.5, sightRange:5.5, speed:0,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, lifetime:25, color:'#ffd54f', radius:0.9 },
  infernoTower: { id:'infernoTower', name:'地狱之塔', cost:5, rarity:'稀有', kind:KIND.BUILDING,
    hp:874, dmg:60, hitSpeed:0.4, range:6.0, sightRange:6.0, speed:0,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, lifetime:40, color:'#ff5722', radius:1.35,
    special:{ rampDamage:{ maxMult:8.0, rampTime:2.5 } } },  // 对空(wiki:air-targeting,可打气球/亡灵)
  bombTower: { id:'bombTower', name:'炸弹塔', cost:4, rarity:'稀有', kind:KIND.BUILDING,
    hp:678, dmg:111, hitSpeed:1.8, range:6.0, sightRange:5.5, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:1.5, deployTime:1, lifetime:30, color:'#37474f', radius:1.35,
    special:{ deathDamage:{ dmg:111, splash:2.0, targets:T.GROUND } } },  // wiki 11级×0.5:死亡伤害 222/2=111
  goblinHut: { id:'goblinHut', name:'哥布林小屋', cost:4, rarity:'稀有', kind:KIND.BUILDING,
    hp:614, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#689f38', radius:1.35,
    special:{ spawn:{ card:'spearGoblins', count:1, interval:2.2, firstDelay:1 } } },  // wiki:每 2.2s 出 1 只投矛(有敌时)
  barbarianHut: { id:'barbarianHut', name:'野蛮人小屋', cost:6, rarity:'稀有', kind:KIND.BUILDING,
    hp:582, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#a1887f', radius:1.35,
    special:{ spawn:{ card:'barbarians', count:2, interval:15, firstDelay:1 }, deathSummon:{ card:'barbarians', count:2 } } },  // wiki:每 15s 出 2 只
  tombstone: { id:'tombstone', name:'骷髅墓碑', cost:3, rarity:'稀有', kind:KIND.BUILDING,
    hp:264, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#9e9e9e', radius:1.35,
    special:{ spawn:{ card:'skeletons', count:2, interval:3.5, firstDelay:1 }, deathSummon:{ card:'skeletons', count:4 } } },  // wiki:每 3.5s 出 2 只
  elixirCollector: { id:'elixirCollector', name:'圣水收集器', cost:6, rarity:'稀有', kind:KIND.BUILDING,
    hp:535, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:93, color:'#d32f2f', radius:1.35,
    special:{ produceElixir:{ amount:1, interval:8.5 } } },  // wiki:寿命 1min33s=93s,产 10 滴(净+4)
  xbow: { id:'xbow', name:'X连弩', cost:6, rarity:'史诗', kind:KIND.BUILDING,
    hp:800, dmg:22, hitSpeed:0.3, range:11.5, sightRange:11.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#5d4037', radius:1.35,
    special:{ targetsTower:true } },  // wiki:寿命 30s
  mortar: { id:'mortar', name:'迫击炮', cost:4, rarity:'普通', kind:KIND.BUILDING,
    hp:684, dmg:133, hitSpeed:5.0, range:12.08, sightRange:12.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:2.0, deployTime:1, lifetime:30, color:'#6d4c41', radius:1.35,
    special:{ blindSpot:4.0, targetsTower:true } },

  // ===== 法术 =====
  fireball: { id:'fireball', name:'火球', cost:4, rarity:'稀有', kind:KIND.SPELL,
    radius:2.5, dmg:344, knockback:0.6, color:'#ff6f00', deployZone:'anywhere', projectile: 15 },  // 投射速度600(wiki),从国王塔飞出
  arrows: { id:'arrows', name:'万箭齐发', cost:3, rarity:'普通', kind:KIND.SPELL,
    radius:3.5, dmg:61, knockback:0, color:'#bdbdbd', deployZone:'anywhere',
    special:{ hits:3 }, projectile: 27.5 },  // 投射速度1100(wiki);每单位命中3次;半径3.5(wiki)
  rocket: { id:'rocket', name:'火箭', cost:6, rarity:'稀有', kind:KIND.SPELL,
    radius:2.0, dmg:742, knockback:0.3, color:'#d50000', deployZone:'anywhere', projectile: 8.75 },  // 投射速度350(wiki),全场约3.2s
  lightning: { id:'lightning', name:'雷电法术', cost:6, rarity:'史诗', kind:KIND.SPELL,
    radius:3.5, dmg:528, knockback:0, color:'#ffd600', deployZone:'anywhere',
    special:{ chain:3, stun:0.5 } },  // 半径3.5(wiki:2018-04-25 从3恢复3.5);眩晕0.5s·无击退(wiki)
  zap: { id:'zap', name:'电击法术', cost:2, rarity:'普通', kind:KIND.SPELL,
    radius:2.5, dmg:96, knockback:0, color:'#29b6f6', deployZone:'anywhere',
    special:{ stun:0.5 }, castTime: 0.5 },  // 施法时间0.5s(wiki);半径2.5(wiki);眩晕0.5s·无击退(wiki,击退是火球/滚木/雪球特性)
  rage: { id:'rage', name:'狂暴法术', cost:2, rarity:'史诗', kind:KIND.SPELL,
    radius:3.0, dmg:0, knockback:0, color:'#ff1744', deployZone:'anywhere',
    special:{ buff:1.35, duration:6.0 } },  // 半径3(wiki);狂暴是增益法术,半径是buff范围
  freeze: { id:'freeze', name:'冰冻法术', cost:4, rarity:'史诗', kind:KIND.SPELL,
    radius:3.0, dmg:58, knockback:0, color:'#4fc3f7', deployZone:'anywhere',
    special:{ freeze:4.0 } },  // 即时生效;伤害 115/2=58(11级×0.5),对塔约 17.5(倍率表 0.3 换算)
  goblinBarrel: { id:'goblinBarrel', name:'哥布林飞桶', cost:3, rarity:'史诗', kind:KIND.SPELL,
    radius:1.5, dmg:0, knockback:0, color:'#7cb342', deployZone:'anywhere', projectile: 13,
    special:{ spawnUnits:{ card:'goblins', count:3, deployTime:1.1, ring:1.6 } } },
    // wiki:3费·半径1.5·2016-01-04 首发;桶从国王塔抛物线飞出,落地炸开3哥布林;
    // 哥布林落地后 1.1s 才可行动(可被预判法术反制的窗口);桶本体无伤害(2016-07 移除)
    // ring=1.6:落地哥布林围绕落点等边三角形散开(扔塔中心时三面包围塔,
    // 官方行为——塔先打靠国王塔一侧的,AOE 难一次全清)
  mirror: { id:'mirror', name:'镜像法术', cost:0, rarity:'史诗', kind:KIND.SPELL,
    radius:0, dmg:0, knockback:0, color:'#9c27b0', deployZone:'anywhere',
    special:{ mirror:true } },

  // ===== 内部卡(不在选择列表)=====
  golemite: { id:'golemite', name:'小戈仑', cost:0, rarity:'史诗', kind:KIND.TROOP,
    hp:520, dmg:42, hitSpeed:2.5, range:0.75, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:0, color:'#7cb342', radius:0.42,
    special:{ deathDamage:{ dmg:50, splash:1.5, targets:T.ALL } }, hidden:true },  // wiki 11级×0.5:hp 1039/2≈520 dmg 84/2=42 死亡 99/2≈50 近战 Short 0.75
};

export const SELECTABLE_CARDS = Object.keys(CARDS).filter(k => !CARDS[k].hidden && k !== 'golemite');
