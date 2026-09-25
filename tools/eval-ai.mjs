// ===============================================
// AI 评测 harness - headless AI vs AI 对局统计
// 用法:
//   node tools/eval-ai.mjs                    # 默认:5 预设卡组 × 20 局 = 100 局
//   node tools/eval-ai.mjs 50                 # 每卡组 50 局
//   AI_CONFIG_A=... AI_CONFIG_B=... 可选(见 --help)
//
// 设计:
//   - 双方都是 AI 类实例(镜像对局),side 0/1 各一
//   - 同卡组对同卡组:消除卡组强度差异,纯测决策质量
//   - 帧步进 dt=1/30,决策间隔 0.7s(与游戏内"普通"强度一致)
//   - 交替先手(开局洗牌随机,天然公平)
//   - 输出:胜/负/平 + 平均皇冠 + 加时率 + 决策统计
// ===============================================
import { Game } from '../src/game/game.js';
import { AI } from '../src/game/ai.js';
import { CARDS } from '../src/data/cards.js';

// 预设卡组(与游戏内 DECKS 前 5 套保持一致——从 deckeditor 复制核心阵容)
const PRESET_DECKS = {
  '巨人体系':   ['giant', 'musketeer', 'minions', 'fireball', 'arrows', 'knight', 'archers', 'skeletons'],
  '速转猪':     ['hogRider', 'iceSpirit', 'iceGolem', 'theLog', 'skeletons', 'cannon', 'zap', 'fireball'],
  '戈仑重击':   ['golem', 'babyDragon', 'minionHorde', 'arrows', 'lightning', 'barbarianHut', 'tombstone', 'megaMinion_x'],
  '空军流':     ['balloon', 'babyDragon', 'minionHorde', 'minions', 'arrows', 'zap', 'valkyrie', 'musketeer'],
  '速转流':     ['hogRider', 'skeletons', 'cannon', 'iceSpirit_x', 'fireball', 'zap', 'goblins', 'spearGoblins'],
};
// 校正:用实际存在的卡替换占位 id
function sanitizeDeck(cards) {
  const out = [...new Set(cards)].filter(id => CARDS[id]).slice(0, 8);
  const fallback = ['skeletons', 'goblins', 'archers', 'musketeer', 'fireball', 'arrows', 'knight', 'minions'];
  for (const f of fallback) { if (out.length >= 8) break; if (!out.includes(f)) out.push(f); }
  return out;
}

const DT = 1 / 30;           // 模拟帧长
const DECIDE_INTERVAL = 0.7; // 决策间隔(与 aiLevel=1 普通一致)

// 跑一局:返回 { winner, crowns0, crowns1, overtime, time }
function playMatch(deck, seedNoise) {
  const game = new Game();
  // 评测时静默事件(避免日志堆积)
  const ai0 = new AI(game, deck.slice(), 0);
  const ai1 = new AI(game, deck.slice(), 1);
  ai0.thinkTimer = seedNoise; // 打散双方决策相位,避免同步决策
  let steps = 0;
  const MAX_STEPS = Math.ceil((180 + 120 + 10) / DT); // 常规+加时+裕量

  while (!game.gameOver && steps < MAX_STEPS) {
    game.update(DT);
    // 双方决策
    for (const [ai, side] of [[ai0, 0], [ai1, 1]]) {
      ai.thinkTimer += DT;
      if (ai.thinkTimer >= DECIDE_INTERVAL && !game.gameOver) {
        ai.thinkTimer = 0;
        ai.decide();
      }
    }
    steps++;
  }
  const crowns = (side) => (game.towers[side].king.dead ? 3 :
    (game.towers[side].left.dead ? 1 : 0) + (game.towers[side].right.dead ? 1 : 0));
  return {
    winner: game.winner,
    // crowns0 = side0 的塔被打掉数(即 side1 的皇冠)
    crownsA: crowns(1), // A(side0=新AI) 拿的皇冠
    crownsB: crowns(0),
    overtime: game.overtime,
    time: +game.time.toFixed(1),
  };
}

// ===== 主流程 =====
const gamesPerDeck = parseInt(process.argv[2] || '20', 10);
const decks = Object.entries(PRESET_DECKS).map(([name, cards]) => [name, sanitizeDeck(cards)]);

console.log(`AI 评测: ${decks.length} 卡组 × ${gamesPerDeck} 局 = ${decks.length * gamesPerDeck} 局`);
console.log(`决策间隔 ${DECIDE_INTERVAL}s(普通强度)· 帧长 ${DT.toFixed(3)}s\n`);

const t0 = Date.now();
let totalA = 0, totalB = 0, totalDraw = 0, totalOT = 0;
let totalCrownsA = 0, totalCrownsB = 0;
const perDeck = [];

for (const [name, deck] of decks) {
  let a = 0, b = 0, d = 0, ot = 0, ca = 0, cb = 0;
  for (let i = 0; i < gamesPerDeck; i++) {
    // A=side0,B=side1;side0 有后手优势(下方),用随机相位+双倍局数自然抵消
    const r = playMatch(deck, Math.random() * DECIDE_INTERVAL);
    if (r.winner === 0) a++; else if (r.winner === 1) b++; else d++;
    if (r.overtime) ot++;
    ca += r.crownsA; cb += r.crownsB;
  }
  totalA += a; totalB += b; totalDraw += d; totalOT += ot;
  totalCrownsA += ca; totalCrownsB += cb;
  const n = gamesPerDeck;
  perDeck.push({ name, a, b, d, ot });
  console.log(`${name.padEnd(8, '　')} A胜 ${String(a).padStart(3)} | B胜 ${String(b).padStart(3)} | 平 ${String(d).padStart(3)} | 加时率 ${(ot / n * 100).toFixed(0)}% | 皇冠 ${ca}:${cb}`);
}

const total = totalA + totalB + totalDraw;
console.log('─'.repeat(60));
console.log(`总计     A(side0) ${totalA} 胜 ${(totalA / total * 100).toFixed(1)}% | B(side1) ${totalB} 胜 ${(totalB / total * 100).toFixed(1)}% | 平局 ${totalDraw} (${(totalDraw / total * 100).toFixed(1)}%)`);
console.log(`加时率 ${(totalOT / total * 100).toFixed(1)}% · 总皇冠 ${totalCrownsA}:${totalCrownsB} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('\n注:镜像对局(side0/1 仅出生方位不同),A/B 胜率差 = 地图侧优势;');
console.log('    评测改进时:基线 AI 固定一侧,新 AI 另一侧,再交换侧别各跑一轮取平均。');
