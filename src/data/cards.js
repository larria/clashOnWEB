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
    hp:883, dmg:101, hitSpeed:1.2, range:1.65, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#9b8c7a', radius:0.45 },
  archers: { id:'archers', name:'弓箭手', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:152, dmg:56, hitSpeed:0.9, range:5.0, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:2, splash:0, deployTime:1, color:'#d65a5a', radius:0.35 },
  goblins: { id:'goblins', name:'哥布林', cost:2, rarity:'普通', kind:KIND.TROOP,
    hp:101, dmg:62, hitSpeed:1.1, range:0.82, sightRange:5.5, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:3, splash:0, deployTime:1, color:'#7cb342', radius:0.32 },
  spearGoblins: { id:'spearGoblins', name:'投矛哥布林', cost:2, rarity:'普通', kind:KIND.TROOP,
    hp:66, dmg:40, hitSpeed:1.6, range:5.3, sightRange:5.0, speed:SPEED.FAST,
    targets:T.ALL, flying:false, count:3, splash:0, deployTime:1, color:'#8bc34a', radius:0.30 },
  skeletons: { id:'skeletons', name:'骷髅兵', cost:1, rarity:'普通', kind:KIND.TROOP,
    hp:40, dmg:40, hitSpeed:1.1, range:0.78, sightRange:5.0, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:4, splash:0, deployTime:1, color:'#eeeeee', radius:0.28 },
  minions: { id:'minions', name:'亡灵', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:115, dmg:54, hitSpeed:1.2, range:2.83, sightRange:5.5, speed:SPEED.FAST,
    targets:T.ALL, flying:true, count:3, splash:0, deployTime:1, color:'#5c6bc0', radius:0.33 },
  barbarians: { id:'barbarians', name:'野蛮人', cost:5, rarity:'普通', kind:KIND.TROOP,
    hp:358, dmg:96, hitSpeed:1.4, range:1.08, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:5, splash:0, deployTime:1, color:'#bf6b1f', radius:0.38 },
  bomber: { id:'bomber', name:'炸弹兵', cost:3, rarity:'普通', kind:KIND.TROOP,
    hp:152, dmg:112, hitSpeed:1.8, range:4.85, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:1.5, deployTime:1, color:'#3a3a3a', radius:0.35 },

  // ===== 稀有 =====
  giant: { id:'giant', name:'巨人', cost:5, rarity:'稀有', kind:KIND.TROOP,
    hp:1984, dmg:126, hitSpeed:1.5, range:1.75, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:1, color:'#ff9933', radius:0.55 },
  miniPekka: { id:'miniPekka', name:'迷你皮卡', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:695, dmg:378, hitSpeed:1.6, range:1.25, sightRange:5.5, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#b0bec5', radius:0.45 },
  musketeer: { id:'musketeer', name:'火枪手', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:360, dmg:108, hitSpeed:1.0, range:6.38, sightRange:6.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, color:'#ab47bc', radius:0.38 },
  valkyrie: { id:'valkyrie', name:'女武神', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:954, dmg:133, hitSpeed:1.5, range:1.65, sightRange:5.0, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:2.0, deployTime:1, color:'#e91e63', radius:0.45 },
  hogRider: { id:'hogRider', name:'野猪骑士', cost:4, rarity:'稀有', kind:KIND.TROOP,
    hp:848, dmg:158, hitSpeed:1.6, range:1.25, sightRange:5.5, speed:SPEED.VERY_FAST,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:1, color:'#8d6e63', radius:0.45,
    special:{ canJumpRiver:true } },
  wizard: { id:'wizard', name:'法师', cost:5, rarity:'稀有', kind:KIND.TROOP,
    hp:416, dmg:140, hitSpeed:1.4, range:5.88, sightRange:6.0, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:1.5, deployTime:1, color:'#42a5f5', radius:0.38 },

  // ===== 史诗 =====
  pekka: { id:'pekka', name:'皮卡超人', cost:7, rarity:'史诗', kind:KIND.TROOP,
    hp:1880, dmg:421, hitSpeed:1.8, range:1.35, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#90a4ae', radius:0.55 },
  prince: { id:'prince', name:'王子', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:960, dmg:196, hitSpeed:1.4, range:2.08, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#5d4037', radius:0.48,
    special:{ charge:{ distance:3.5, dmgMult:2.0, speedMult:1.6 } } },
  babyDragon: { id:'babyDragon', name:'飞龙宝宝', cost:4, rarity:'史诗', kind:KIND.TROOP,
    hp:576, dmg:84, hitSpeed:1.5, range:3.98, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:true, count:1, splash:1.5, deployTime:1, color:'#ec407a', radius:0.48 },
  skeletonArmy: { id:'skeletonArmy', name:'骷髅军团', cost:3, rarity:'史诗', kind:KIND.TROOP,
    hp:40, dmg:40, hitSpeed:1.1, range:0.76, sightRange:5.0, speed:SPEED.FAST,
    targets:T.GROUND, flying:false, count:15, splash:0, deployTime:1, color:'#fafafa', radius:0.26 },
  witch: { id:'witch', name:'女巫', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:420, dmg:68, hitSpeed:1.1, range:5.4, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, color:'#6a1b9a', radius:0.40,
    special:{ summon:{ card:'skeletons', count:4, interval:7, firstDelay:1 } } }, // wiki:每7秒4只,首波部署后1秒
  balloon: { id:'balloon', name:'气球兵', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:840, dmg:320, hitSpeed:2.0, range:0.6, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.BUILDING, flying:true, count:1, splash:1.5, deployTime:1, color:'#26a69a', radius:0.50,
    special:{ deathDamage:{ dmg:320, splash:1.5, targets:T.ALL, delay:3 } } },  // 3秒引信
  giantSkeleton: { id:'giantSkeleton', name:'骷髅巨人', cost:6, rarity:'史诗', kind:KIND.TROOP,
    hp:1680, dmg:138, hitSpeed:1.4, range:1.32, sightRange:5.5, speed:SPEED.MEDIUM,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, color:'#cfd8dc', radius:0.52,
    special:{ deathDamage:{ dmg:138, splash:2.5, targets:T.ALL, delay:3, towerMult:2 } } },  // 对塔双倍
  golem: { id:'golem', name:'戈仑石人', cost:8, rarity:'史诗', kind:KIND.TROOP,
    hp:2560, dmg:156, hitSpeed:2.5, range:1.35, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:1, color:'#558b2f', radius:0.60,
    special:{ deathDamage:{ dmg:156, splash:2.0, targets:T.ALL }, summonOnDeath:{ card:'golemite', count:2 } } },
  minionHorde: { id:'minionHorde', name:'亡灵大军', cost:5, rarity:'史诗', kind:KIND.TROOP,
    hp:115, dmg:54, hitSpeed:1.2, range:2.82, sightRange:5.5, speed:SPEED.FAST,
    targets:T.ALL, flying:true, count:6, splash:0, deployTime:1, color:'#3949ab', radius:0.32 },

  // ===== 建筑 =====
  cannon: { id:'cannon', name:'加农炮', cost:3, rarity:'普通', kind:KIND.BUILDING,
    hp:412, dmg:106, hitSpeed:1.0, range:6.05, sightRange:5.5, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:30, color:'#455a64', radius:1.35 },
  tesla: { id:'tesla', name:'特斯拉电磁塔', cost:4, rarity:'普通', kind:KIND.BUILDING,
    hp:576, dmg:110, hitSpeed:1.1, range:6.0, sightRange:5.0, speed:0,
    targets:T.ALL, flying:false, count:1, splash:0, deployTime:1, lifetime:35, color:'#ffd54f', radius:0.9 },
  infernoTower: { id:'infernoTower', name:'地狱之塔', cost:5, rarity:'稀有', kind:KIND.BUILDING,
    hp:874, dmg:60, hitSpeed:0.4, range:6.55, sightRange:6.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:40, color:'#ff5722', radius:1.35,
    special:{ rampDamage:{ maxMult:8.0, rampTime:2.5 } } },
  bombTower: { id:'bombTower', name:'炸弹塔', cost:4, rarity:'稀有', kind:KIND.BUILDING,
    hp:678, dmg:111, hitSpeed:1.8, range:6.55, sightRange:5.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:2.0, deployTime:1, lifetime:35, color:'#37474f', radius:1.35 },
  goblinHut: { id:'goblinHut', name:'哥布林小屋', cost:5, rarity:'稀有', kind:KIND.BUILDING,
    hp:614, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:45, color:'#689f38', radius:1.35,
    special:{ spawn:{ card:'spearGoblins', count:1, interval:4.9, firstDelay:1 } } },
  barbarianHut: { id:'barbarianHut', name:'野蛮人小屋', cost:7, rarity:'稀有', kind:KIND.BUILDING,
    hp:582, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:50, color:'#a1887f', radius:1.35,
    special:{ spawn:{ card:'barbarians', count:2, interval:13, firstDelay:1 }, deathSummon:{ card:'barbarians', count:2 } } },
  tombstone: { id:'tombstone', name:'骷髅墓碑', cost:3, rarity:'稀有', kind:KIND.BUILDING,
    hp:264, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:40, color:'#9e9e9e', radius:1.35,
    special:{ spawn:{ card:'skeletons', count:1, interval:2.9, firstDelay:1 }, deathSummon:{ card:'skeletons', count:4 } } },
  elixirCollector: { id:'elixirCollector', name:'圣水收集器', cost:5, rarity:'稀有', kind:KIND.BUILDING,
    hp:535, dmg:0, hitSpeed:0, range:0, sightRange:0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:50, color:'#d32f2f', radius:1.35,
    special:{ produceElixir:{ amount:1, interval:8.5 } } },
  xbow: { id:'xbow', name:'X连弩', cost:6, rarity:'史诗', kind:KIND.BUILDING,
    hp:800, dmg:22, hitSpeed:0.3, range:12.1, sightRange:11.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:0, deployTime:1, lifetime:40, color:'#5d4037', radius:1.35,
    special:{ targetsTower:true } },
  mortar: { id:'mortar', name:'迫击炮', cost:4, rarity:'普通', kind:KIND.BUILDING,
    hp:684, dmg:133, hitSpeed:5.0, range:12.08, sightRange:12.0, speed:0,
    targets:T.GROUND, flying:false, count:1, splash:2.0, deployTime:1, lifetime:30, color:'#6d4c41', radius:1.35,
    special:{ blindSpot:4.0, targetsTower:true } },

  // ===== 法术 =====
  fireball: { id:'fireball', name:'火球', cost:4, rarity:'稀有', kind:KIND.SPELL,
    radius:2.5, dmg:344, knockback:0.6, color:'#ff6f00', deployZone:'anywhere' },
  arrows: { id:'arrows', name:'万箭齐发', cost:3, rarity:'普通', kind:KIND.SPELL,
    radius:4.0, dmg:61, knockback:0, color:'#bdbdbd', deployZone:'anywhere',
    special:{ hits:3 } }, // 每单位命中3次(61x3=183总伤,可秒亡灵)
  rocket: { id:'rocket', name:'火箭', cost:6, rarity:'稀有', kind:KIND.SPELL,
    radius:2.0, dmg:742, knockback:0.3, color:'#d50000', deployZone:'anywhere' },
  lightning: { id:'lightning', name:'雷电法术', cost:6, rarity:'史诗', kind:KIND.SPELL,
    radius:3.0, dmg:528, knockback:0.8, color:'#ffd600', deployZone:'anywhere',
    special:{ chain:3, stun:1.0 } },
  zap: { id:'zap', name:'电击法术', cost:2, rarity:'普通', kind:KIND.SPELL,
    radius:2.5, dmg:96, knockback:0.4, color:'#29b6f6', deployZone:'anywhere',
    special:{ stun:0.5 } },
  rage: { id:'rage', name:'狂暴法术', cost:2, rarity:'史诗', kind:KIND.SPELL,
    radius:5.0, dmg:0, knockback:0, color:'#ff1744', deployZone:'anywhere',
    special:{ buff:1.35, duration:6.0 } },
  freeze: { id:'freeze', name:'冰冻法术', cost:3, rarity:'史诗', kind:KIND.SPELL,
    radius:3.5, dmg:60, knockback:0, color:'#4fc3f7', deployZone:'anywhere',
    special:{ freeze:4.0 } },
  mirror: { id:'mirror', name:'镜像法术', cost:0, rarity:'史诗', kind:KIND.SPELL,
    radius:0, dmg:0, knockback:0, color:'#9c27b0', deployZone:'anywhere',
    special:{ mirror:true } },

  // ===== 内部卡(不在选择列表)=====
  golemite: { id:'golemite', name:'小戈仑', cost:0, rarity:'史诗', kind:KIND.TROOP,
    hp:520, dmg:42, hitSpeed:2.5, range:1.17, sightRange:5.5, speed:SPEED.SLOW,
    targets:T.BUILDING, flying:false, count:1, splash:0, deployTime:0, color:'#7cb342', radius:0.42,
    special:{ deathDamage:{ dmg:42, splash:1.5, targets:T.ALL } }, hidden:true },
};

export const SELECTABLE_CARDS = Object.keys(CARDS).filter(k => !CARDS[k].hidden && k !== 'golemite');
