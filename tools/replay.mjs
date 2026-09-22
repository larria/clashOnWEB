#!/usr/bin/env node
// ===============================================
// 对局重放工具 - headless 还原任意时间点并继续推演
//
// 用法:
//   node tools/replay.mjs rec.json                     # 概览:出牌脚本+里程碑
//   node tools/replay.mjs rec.json --at 83.4           # 还原到 83.4s,打印全量状态快照
//   node tools/replay.mjs rec.json --at 83.4 --continue 10   # 从该时刻接管 AI 双方继续推演 10s
//   node tools/replay.mjs rec.json --diff 83.4         # 打印该时刻前最近的关键事件
//
// 重放原理:引擎确定性(种子 RNG + 无其他随机),按时间顺序重放
// 出牌脚本到目标时刻。玩家的牌按脚本出;AI 的牌忽略原脚本、由
// AI 决策系统接管(与原局不同也正常——推演用途)。
// 若想严格复现原局(包括 AI 的原决策),用 --strict(按脚本出 AI 的牌)。
// ===============================================
import { readFileSync } from 'fs';
import { Game } from '../src/game/game.js';
import { AI } from '../src/game/ai.js';
import { CARDS } from '../src/data/cards.js';
import { makeRng } from '../src/core/rng.js';
import { aiLevelInfo } from '../src/core/settings.js';
import { recToText, fmtT } from '../src/core/recorder.js';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('用法: node tools/replay.mjs <rec.json> [--at 秒] [--continue 秒] [--strict] [--json]');
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? parseFloat(v) : true;
};
const rec = JSON.parse(readFileSync(file, 'utf8'));
const at = flag('--at');
const cont = typeof flag('--continue') === 'number' ? flag('--continue') : null;
const strict = !!flag('--strict');
const asJson = !!flag('--json');

const DT = 1 / 30;

// ===== 建局(按记录的初始条件) =====
const game = new Game({ seed: rec.meta.seed });
const aiInfo = aiLevelInfo(rec.meta.aiLevel || 3);
game.aiElixirMult = aiInfo.elixirMult;
const ai = new AI(game, rec.meta.aiDeck || [], 1);
// 玩家手牌系统(与 main.js 同构:洗牌用同 seed 的 game.rng → 手牌序列一致)
let pHand = [], pNext = null, pDrawPile = [];
{
  const { shuffle } = await import('../src/core/rng.js');
  pDrawPile = shuffle((rec.meta.playerDeck || []).slice(), game.rng);
  pHand = pDrawPile.splice(0, 4);
  pNext = pDrawPile.shift();
}
const pCycle = (id, i) => { pHand[i] = pNext; pDrawPile.push(id); pNext = pDrawPile.shift(); };

// ===== 出牌脚本索引 =====
const plays = (rec.plays || []).slice().sort((a, b) => a.t - b.t);
let playIdx = 0;

if (at == null) {
  // 概览模式:打印人类可读脚本
  console.log(recToText(rec));
  console.log(`\n共 ${plays.length} 次出牌。用 --at <秒> 查看任意时刻快照,--continue <秒> 继续推演`);
  process.exit(0);
}

// ===== 重放到 at 时刻 =====
// 出牌按"逻辑帧时间 >= 脚本时间"触发(与浏览器主循环一致:每帧先 update 再检查;
// 这里在 update 前检查,误差 ≤1 帧)
let lastT = 0;
const maxT = at;
const doPlay = (p) => {
  if (p.side === 0) {
    const i = pHand.indexOf(p.cardId);
    if (game.playCard(0, p.cardId, p.x, p.y) && i >= 0) pCycle(p.cardId, i);
  } else if (strict) {
    // 严格复现:AI 的牌也按脚本出(不走 AI 决策)
    const i = ai.hand.indexOf(p.cardId);
    if (game.playCard(1, p.cardId, p.x, p.y) && i >= 0) ai.cycleAfterPlay(p.cardId, i);
  }
  // 非 strict:AI 由决策系统接管(脚本里 AI 的牌忽略——推演用途,不追求逐帧复刻)
};
while (game.time < maxT && !game.gameOver) {
  while (playIdx < plays.length && plays[playIdx].t <= game.time) doPlay(plays[playIdx++]);
  // AI 决策(每 0.7s,与游戏内一致;strict 模式不用 AI)
  if (!strict) {
    ai.thinkTimer += DT;
    if (ai.thinkTimer >= 0.7 && !game.gameOver) { ai.thinkTimer = 0; ai.decide(); }
  }
  game.update(DT);
  lastT = game.time;
}
// 补发 at 时刻前最后一帧内到期的脚本出牌
while (playIdx < plays.length && plays[playIdx].t <= game.time) doPlay(plays[playIdx++]);

// ===== 状态快照输出 =====
function snapshot() {
  const towers = {};
  for (const side of [0, 1]) {
    const t = game.towers[side];
    towers[side === 0 ? '你' : 'AI'] = ['left', 'right', 'king'].map(k =>
      `${k}:${t[k].dead ? '毁' : Math.round(t[k].hp)}${k === 'king' && t[k].activated ? '(激活)' : ''}`);
  }
  const units = game.units.map(u => ({
    side: u.side === 0 ? '你' : 'AI', card: CARDS[u.cardId].name,
    pos: `(${u.x.toFixed(1)},${u.y.toFixed(1)})`, hp: Math.round(u.hp),
    target: u.target ? (u.target.type === 'tower' ? u.target.ref.lane + '塔' : CARDS[u.target.ref.cardId].name) : '-',
    frozen: u.frozen > 0, stunned: u.stunned > 0,
  }));
  return {
    time: +game.time.toFixed(2),
    elixir: { 你: +game.elixirFloat[0].toFixed(1), AI: +game.elixirFloat[1].toFixed(1) },
    towers, units,
    playerHand: pHand, playerNext: pNext,
    aiHand: ai.hand, aiNext: ai.nextCardId,
    gameOver: game.gameOver, winner: game.winner,
  };
}

const snap = snapshot();
if (asJson) {
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.log(`===== ${fmtT(game.time)} 状态快照 =====`);
  console.log(`圣水: 你 ${snap.elixir['你']} / AI ${snap.elixir['AI']}`);
  console.log(`塔: 你 ${snap.towers['你'].join(' ')} | AI ${snap.towers['AI'].join(' ')}`);
  console.log(`你的手牌: ${snap.playerHand.join(',')} 下一张:${snap.playerNext}`);
  console.log(`AI 手牌: ${snap.aiHand.join(',')} 下一张:${snap.aiNext}`);
  console.log(`场上单位(${snap.units.length}):`);
  for (const u of snap.units) {
    console.log(`  [${u.side}] ${u.card} ${u.pos} hp=${u.hp} 目标=${u.target}${u.frozen ? ' ❄冰冻' : ''}${u.stunned ? ' ⚡眩晕' : ''}`);
  }
  if (game.gameOver) console.log(`终局: ${game.winner === 0 ? '玩家胜' : game.winner === 1 ? 'AI胜' : '平局'}`);
}

// ===== 继续推演 =====
if (cont != null && !game.gameOver) {
  console.log(`\n===== 推演 ${cont}s(接管 AI 继续) =====`);
  const stopAt = game.time + cont;
  let markCount = 0;
  game.bus.on('card:played', ({ side, cardId, x, y }) => {
    console.log(`${fmtT(game.time)} ${side === 0 ? '你' : 'AI'} 出 ${CARDS[cardId].name} @(${x.toFixed(1)},${y.toFixed(1)})`);
  });
  game.bus.on('tower:destroyed', ({ tower }) => {
    console.log(`${fmtT(game.time)} ** ${tower.side === 0 ? '玩家' : 'AI'}${tower.lane === 'king' ? '国王塔' : tower.lane === 'left' ? '左公主塔' : '右公主塔'}被摧毁 **`);
  });
  while (game.time < stopAt && !game.gameOver) {
    ai.thinkTimer += DT;
    if (ai.thinkTimer >= 0.7 && !game.gameOver) { ai.thinkTimer = 0; ai.decide(); }
    game.update(DT);
  }
  const snap2 = snapshot();
  console.log(`\n推演结束于 ${fmtT(snap2.time)}:`);
  console.log(`塔: 你 ${snap2.towers['你'].join(' ')} | AI ${snap2.towers['AI'].join(' ')}`);
  console.log(`场上单位(${snap2.units.length}):`);
  for (const u of snap2.units) {
    console.log(`  [${u.side}] ${u.card} ${u.pos} hp=${u.hp} 目标=${u.target}`);
  }
  if (game.gameOver) console.log(`终局: ${game.winner === 0 ? '玩家胜' : game.winner === 1 ? 'AI胜' : '平局'}`);
}
