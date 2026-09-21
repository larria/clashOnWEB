// ===============================================
// 新旧 AI 对战评测 - 消除地图侧优势的双向对局
// 用法: node tools/eval-ai-vs-baseline.mjs [每方向局数,默认30]
//
// 新 AI (src/game/ai.js) vs 基线 AI (tools/baseline/ai_baseline.mjs)
// 每局随机卡组 × 双方向(新AI当side0/当side1各跑N局),合计统计胜率
// ===============================================
import { Game } from '../src/game/game.js';
import { AI } from '../src/game/ai.js';
import { AIBaseline } from './baseline/ai_baseline.mjs';
import { CARDS } from '../src/data/cards.js';

const PRESET_DECKS = [
  ['giant', 'musketeer', 'minions', 'fireball', 'arrows', 'knight', 'archers', 'skeletons'],
  ['hogRider', 'skeletons', 'cannon', 'musketeer', 'fireball', 'zap', 'goblins', 'archers'],
  ['golem', 'babyDragon', 'minionHorde', 'arrows', 'lightning', 'barbarianHut', 'tombstone', 'minions'],
  ['balloon', 'babyDragon', 'minionHorde', 'minions', 'arrows', 'zap', 'valkyrie', 'musketeer'],
  ['hogRider', 'skeletons', 'cannon', 'goblins', 'fireball', 'zap', 'knight', 'spearGoblins'],
];
function sanitizeDeck(cards) {
  const out = [...new Set(cards)].filter(id => CARDS[id]).slice(0, 8);
  const fallback = ['skeletons', 'goblins', 'archers', 'musketeer', 'fireball', 'arrows', 'knight', 'minions'];
  for (const f of fallback) { if (out.length >= 8) break; if (!out.includes(f)) out.push(f); }
  return out;
}
const DT = 1/30;

function playMatch(deck, newAiSide) {
  const game = new Game();
  const d = deck.slice();
  const aiNew = newAiSide === 0 ? new AI(game, d, 0) : new AI(game, d, 1);
  const aiOld = newAiSide === 0 ? new AIBaseline(game, d, 1) : new AIBaseline(game, d, 0);
  aiNew.thinkTimer = Math.random() * 0.7;
  aiOld.thinkTimer = Math.random() * 0.7;
  let steps = 0;
  const MAX = Math.ceil(310 / DT);
  while (!game.gameOver && steps < MAX) {
    game.update(DT);
    for (const ai of [aiNew, aiOld]) {
      ai.thinkTimer += DT;
      if (ai.thinkTimer >= 0.7 && !game.gameOver) { ai.thinkTimer = 0; ai.decide(); }
    }
    steps++;
  }
  return { winner: game.winner, newAiSide, overtime: game.overtime };
}

const N = parseInt(process.argv[2] || '30', 10);
let newWin = 0, oldWin = 0, draw = 0;
let newAs0 = 0, newAs1 = 0, oldAs0 = 0, oldAs1 = 0;
const t0 = Date.now();

for (let i = 0; i < N * 2 * PRESET_DECKS.length; i++) {
  const deck = sanitizeDeck(PRESET_DECKS[i % PRESET_DECKS.length]);
  const newAiSide = (i % 2 === 0) ? 0 : 1; // 交替侧别
  const r = playMatch(deck, newAiSide);
  if (r.winner === -1 || r.winner == null) { draw++; continue; }
  if (r.winner === newAiSide) {
    newWin++;
    if (newAiSide === 0) newAs0++; else newAs1++;
  } else {
    oldWin++;
    if (newAiSide === 0) oldAs1++; else oldAs0++;
  }
}
const total = newWin + oldWin + draw;
console.log(`新 AI vs 基线 AI:${PRESET_DECKS.length} 卡组 × 每方向 ${N} 局 = ${total} 局`);
console.log(`新 AI 胜 ${newWin} (${(newWin/total*100).toFixed(1)}%) | 基线胜 ${oldWin} (${(oldWin/total*100).toFixed(1)}%) | 平 ${draw}`);
console.log(`侧别分解: 新AI当side0 ${newAs0}胜 / 当side1 ${newAs1}胜;基线当side0 ${oldAs0}胜 / side1 ${oldAs1}胜`);
console.log(`用时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
