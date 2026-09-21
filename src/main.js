// ===============================================
// 应用入口 - 游戏循环 / 流程状态机 / 模块编排
//
// 职责边界:
//   Game(逻辑) ← bus 事件 → UI/HUD/日志/音频(表现)
//   main 只做编排:创建实例、转发输入、驱动循环
// ===============================================
import { MATCH_TIME, CANVAS_W, CANVAS_H, canDeploy, snapToDeployZone } from './core/constants.js';
import { CARDS, KIND } from './data/cards.js';
import { settings } from './core/settings.js';
import { appBus } from './core/events.js';
import { Game } from './game/game.js';
import { AI } from './game/ai.js';
import { Renderer } from './render/renderer.js';
import { InputController } from './input/input.js';
import { audio } from './audio/audio.js';
import { loadDecks, deckEditor, getLastDeck, saveLastDeck } from './ui/deckeditor.js';
import { settingsScreen } from './ui/settingsui.js';
import { GameLog } from './ui/gamelog.js';
import { HandUI } from './ui/hand.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';

// ===== DOM 引用 =====
const canvas = document.getElementById('game');
const els = {
  log: document.getElementById('log'),
  info: document.getElementById('info'),
  handArea: document.getElementById('handArea'),
  status: document.getElementById('status'),
  overlay: document.getElementById('overlay'),
  ovTitle: document.getElementById('ovTitle'),
  ovDesc: document.getElementById('ovDesc'),
  ovBtn: document.getElementById('ovBtn'),
  ovHint: document.getElementById('ovHint'),
  hudTimer: document.getElementById('hudTimer'),
  hudPhase: document.getElementById('hudPhase'),
  bigAnnounce: document.getElementById('bigAnnounce'),
  pauseBtn: document.getElementById('pauseBtn'),
  restart: document.getElementById('restart'),
  result: document.getElementById('result'),
  resultText: document.getElementById('resultText'),
  resultSub: document.getElementById('resultSub'),
  deckSelect: document.getElementById('deckSelect'),
  openDeckEditor: document.getElementById('openDeckEditor'),
};

// ===== 模块实例 =====
const gameLog = new GameLog(els.log);
const handUI = new HandUI(els.handArea, onHandCardClick);
const hud = new Hud(els);
const screens = new Screens(els);

// ===== 应用状态 =====
let game, renderer, ai;
let playerHand = [];
let playerDeck = [];
let aiDeck = [];
let playerDrawPile = [];
let playerNext = null;
let selectedCardIdx = -1;
let mouseGrid = { x: 0, y: 0 };
let lastTime = 0;
let aiLevel = settings.get('aiLevel');
// phase: 'ready'(待开始) | 'playing' | 'paused' | 'over-wait' | 'over'
let phase = 'ready';
// 阶段提示状态
let announcedDouble = false, announcedLastMinute = false, announcedTimeUp = false, announcedOvertime = false;

// ===== 卡组管理 =====
let DECKS = {};
function refreshDecks() {
  const list = loadDecks();
  DECKS = {};
  list.forEach((d, i) => { DECKS['slot' + i] = d; });
  buildDeckSelect();
  // 恢复上次选中的卡组(无效 key 或空卡组时保持当前)
  const last = getLastDeck();
  if (last && DECKS[last] && DECKS[last].cards.length > 0) {
    els.deckSelect.value = last;
  } else if (DECKS[els.deckSelect.value] && DECKS[els.deckSelect.value].cards.length === 0) {
    // 当前选中是空卡组:切到第一个非空
    const firstOk = Object.keys(DECKS).find(k => DECKS[k].cards.length > 0);
    if (firstOk) els.deckSelect.value = firstOk;
  }
}
function buildDeckSelect() {
  const sel = els.deckSelect;
  const prev = sel.value;
  sel.innerHTML = '';
  Object.keys(DECKS).forEach((k, i) => {
    const opt = document.createElement('option');
    opt.value = k;
    const d = DECKS[k];
    opt.textContent = `卡组${i + 1} · ${d.name}${d.cards.length === 0 ? '(空)' : ''}`;
    sel.appendChild(opt);
  });
  if (prev && DECKS[prev]) sel.value = prev;
}
// 修正:确保所有卡都存在且不重复;不足 8 张自动补足
function sanitizeDeck(cards) {
  const out = [...new Set(cards)].filter(id => CARDS[id] && !CARDS[id].hidden && id !== 'golemite').slice(0, 8);
  if (out.length < 8) {
    const fallback = ['skeletons','goblins','archers','musketeer','fireball','arrows','knight','minions'];
    for (const f of fallback) {
      if (out.length >= 8) break;
      if (!out.includes(f)) out.push(f);
    }
  }
  return out;
}

// ===== 玩家手牌(与 AI 一致规则:4手牌+1next)=====
function drawPlayerHand() {
  playerDrawPile = playerDeck.slice();
  for (let i = playerDrawPile.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [playerDrawPile[i],playerDrawPile[j]] = [playerDrawPile[j],playerDrawPile[i]];
  }
  playerHand = [];
  for (let i = 0; i < 4; i++) playerHand.push(playerDrawPile.shift());
  playerNext = playerDrawPile.shift();
}

// 出牌后循环:打出的卡进入抽牌堆底部,next 补到该手牌位,再从抽牌堆顶抽新 next
function playerCycle(playedCardId, idx) {
  playerHand[idx] = playerNext;
  playerDrawPile.push(playedCardId);
  playerNext = playerDrawPile.shift();
}

// ===== 建局 =====
// 选择用于开局的卡组:空卡组(未编辑完)回退到第一个非空
function pickPlayableDeckKey() {
  const cur = els.deckSelect.value;
  if (DECKS[cur] && DECKS[cur].cards.length > 0) return cur;
  return Object.keys(DECKS).find(k => DECKS[k].cards.length > 0) || 'slot0';
}

function initGame() {
  const deckKey = pickPlayableDeckKey();
  if (els.deckSelect.value !== deckKey) els.deckSelect.value = deckKey;
  playerDeck = sanitizeDeck(DECKS[deckKey] ? DECKS[deckKey].cards : DECKS['slot0'].cards);
  aiLevel = settings.get('aiLevel');
  // AI 每局从非空卡组中随机选择一套(不再与玩家同卡组)
  const presetKeys = Object.keys(DECKS).filter(k => DECKS[k].cards.length > 0);
  const pickKey = presetKeys[Math.floor(Math.random() * presetKeys.length)];
  aiDeck = sanitizeDeck(DECKS[pickKey].cards);

  game = new Game();
  renderer = new Renderer(canvas, game);
  ai = new AI(game, aiDeck.slice());
  window.CR = window.CR || {};
  CR._dbg = { game, ai, get playerDeck(){return playerDeck;}, get aiDeck(){return aiDeck;} }; // 调试/测试出口

  // ===== 事件接线(表现层订阅)=====
  gameLog.bind(game.bus);
  audio.bindGame(game.bus);
  game.bus.on('unit:killed', ({ unit, attacker }) => {
    // 高价值单位(成本>=5)被击杀时记录日志,避免低费杂兵刷屏
    if (unit.card.cost < 5) return;
    const victimSide = unit.side === 0 ? '你的' : 'AI的';
    const killerName = attacker ? (attacker.card ? attacker.card.name : (attacker.isTower ? '塔' : '未知')) : '法术';
    const killerSide = attacker ? (attacker.side === 0 ? '你的' : 'AI的') : '';
    gameLog.push(`${victimSide}${unit.card.name} 被 ${killerSide}${killerName} 击杀`, 'kill');
  });
  game.bus.on('spell:hit', ({ cardId, side, hits, kills }) => {
    const card = CARDS[cardId];
    const sideName = side === 0 ? '你的' : 'AI的';
    let msg = `${sideName}${card.name} 命中 ${hits} 个单位`;
    gameLog.push(msg, 'spell');
  });
  game.bus.on('card:played', ({ side, cardId, x, y, kind }) => {
    // 玩家出牌日志(AI 的日志在 AI 模块内发)
    if (side !== 0) return;
    const card = CARDS[cardId];
    const posStr = `(${x.toFixed(1)},${y.toFixed(1)})`;
    if (kind === KIND.SPELL) gameLog.push(`施放 ${card.name} ${posStr}`, 'spell');
    else if (kind === KIND.BUILDING) gameLog.push(`建造 ${card.name} ${posStr}`, 'me');
    else gameLog.push(`部署 ${card.name} ${posStr}`, 'me');
  });
  game.bus.on('tower:destroyed', ({ tower, myCrowns, aiCrowns }) => {
    // 屏幕震动(塔被摧毁的分量感;国王塔更猛)
    renderer.shake = { t: tower.lane === 'king' ? 0.7 : 0.45, dur: tower.lane === 'king' ? 0.7 : 0.45, amp: tower.lane === 'king' ? 10 : 6 };
    const sideName = tower.side === 0 ? '你的' : 'AI的';
    const laneName = tower.lane === 'king' ? '国王塔' : (tower.lane === 'left' ? '左公主塔' : '右公主塔');
    gameLog.push(`${sideName}${laneName}被摧毁! 皇冠 ${myCrowns} : ${aiCrowns}`, tower.side === 0 ? 'ai' : 'me');
    if (tower.lane === 'king') {
      gameLog.push(sideName === '你的' ? '💀 你的国王塔陨落,战斗失败!' : '🏆 AI国王塔陨落,胜利!', sideName === '你的' ? 'ai' : 'me');
    }
    // 公主塔被推:解锁区域当场闪烁提示(几秒渐隐;常驻高亮仍仅选牌时显示)
    if (tower.lane !== 'king') {
      const isMyKill = tower.side === 1; // 敌方(玩家打掉的塔)→ 金色增益提示
      renderer.unlockFlash = {
        lane: tower.lane,
        color: isMyKill ? '255,213,79' : '255,90,79', // 金(我方解锁)/红(敌方解锁警示)
        until: performance.now() + 3200,  // 闪烁 3.2 秒
      };
      if (isMyKill) {
        hud.announce('🔓 部署区解锁', (tower.lane === 'left' ? '左路' : '右路') + '敌方区域已开放', '#ffd54f');
        gameLog.push(`🔓 ${tower.lane === 'left' ? '左' : '右'}路敌方部署区已解锁(3秒高亮,选牌时可见)`, 'sys');
      } else {
        hud.announce('⚠️ 防线告急', '敌方解锁了你的' + (tower.lane === 'left' ? '左' : '右') + '路部署区', '#ff5a4f');
      }
    }
  });

  drawPlayerHand();
  selectedCardIdx = -1;
  els.result.classList.remove('show');
  fitCanvas();
  window.scrollTo(0, 0);
}

// ===== 流程状态机 =====
function setPhase(p) {
  phase = p;
  if (p === 'ready') {
    screens.showOverlay({
      title: '准备战斗',
      desc: '选择卡组与 AI 强度后开始 · 摧毁对方国王塔获胜',
      btn: '开始战斗',
      hint: '空格键 暂停/继续',
    });
    els.pauseBtn.textContent = '⏸ 暂停';
    els.pauseBtn.disabled = true;
  } else if (p === 'playing') {
    screens.hideOverlay();
    els.pauseBtn.disabled = false;
    els.pauseBtn.textContent = '⏸ 暂停';
  } else if (p === 'paused') {
    screens.showOverlay({
      title: '已暂停',
      desc: '圣水已冻结,战术思考一下?',
      btn: '继续战斗',
      hint: '空格键 暂停/继续',
    });
    els.pauseBtn.textContent = '▶ 继续';
  } else if (p === 'over') {
    screens.hideOverlay();
    els.pauseBtn.disabled = true;
  }
}

function startGame() {
  initGame();
  lastTime = performance.now();
  setPhase('playing');
  gameLog.push('战斗开始!你的卡组:' + playerDeck.map(id => CARDS[id].name).join('、'), 'me');
  gameLog.push('AI 使用卡组:' + aiDeck.map(id => CARDS[id].name).join('、'), 'ai');
  hud.announce('战斗开始', 'BATTLE START', '#ffe082');
  announcedDouble = false;
  announcedLastMinute = false;
  announcedTimeUp = false;
  announcedOvertime = false;
  audio.play('battle_start');
  audio.playMusic();
}

function togglePause() {
  if (phase === 'playing') {
    setPhase('paused');
    audio.stopMusic();
    gameLog.push('⏸ 游戏已暂停', 'sys');
  } else if (phase === 'paused') {
    lastTime = performance.now();
    setPhase('playing');
    audio.playMusic();
    gameLog.push('▶ 继续战斗', 'sys');
  }
}

// 页面不可见时自动暂停(防止后台节流导致游戏时间失真/错过操作)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') {
    togglePause();
    gameLog.push('页面切到后台,游戏已自动暂停', 'sys');
  }
});
// 切回前台时校准时间基准(避免恢复瞬间 dt 跳变)
window.addEventListener('focus', () => {
  if (phase === 'playing') lastTime = performance.now();
});

// ===== 主循环 =====
function loop(now) {
  try {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (phase === 'playing' && game) {
      game.update(dt);
      // AI 更新(按强度调整决策间隔)
      ai.thinkTimer += dt;
      const interval = 0.7 / aiLevel;
      if (ai.thinkTimer >= interval && !game.gameOver) {
        ai.thinkTimer = 0;
        ai.decide();
      }
      hud.update(game);
      // 阶段提示
      const remain = MATCH_TIME - game.time;
      if (!announcedDouble && game.doubleElixir) {
        announcedDouble = true;
        hud.announce('⚡ 双倍圣水', 'DOUBLE ELIXIR', '#ff8a80');
      }
      if (!announcedLastMinute && remain <= 60 && remain > 0) {
        announcedLastMinute = true;
        // 双倍圣水提示(120s)与本提示同时刻,错开播放避免覆盖
        setTimeout(() => { if (phase === 'playing') hud.announce('⏰ 最后 1 分钟', 'FINAL MINUTE', '#ffe082'); }, 2800);
      }
      if (!announcedOvertime && game.overtime) {
        announcedOvertime = true;
        hud.announce('⏱ 加时赛', 'SUDDEN DEATH · 先摧毁任意塔者胜', '#ff8a80');
      }
      if (!announcedTimeUp && game.gameOver && game.time >= MATCH_TIME - 0.01 && !game.overtime) {
        announcedTimeUp = true;
        hud.announce('⏱ 时间到!', '判定胜负…', '#eceef5');
      }
    }
    if (game) {
      handUI.update({
        hand: playerHand, next: playerNext,
        elixir: game.elixir[0], elixirFloat: game.elixirFloat[0], selectedIdx: selectedCardIdx,
      });
      hud.renderInfo(game); // 信息面板每帧刷新(ready 态也显示)
      renderer.draw(phase === 'playing' ? getPreview() : null, phase === 'playing' ? dt : 0);
    }
    if (phase === 'playing' && game && game.gameOver) {
      // 终场提示后稍作停顿再弹结算
      if (!announcedTimeUp && game.time < MATCH_TIME - 0.01) {
        // 国王塔陨落型结束(非超时)
        hud.announce(game.winner === 0 ? '👑 国王塔陨落!' : '💥 防线崩溃!', game.winner === 0 ? 'VICTORY' : 'DEFEAT', game.winner === 0 ? '#7fd4ff' : '#ff8a80');
      }
      setTimeout(() => { if (phase !== 'over') { setPhase('over'); screens.showResult(game.winner); } }, 1200);
      phase = 'over-wait';
    }
  } catch (e) {
    console.error('游戏循环异常:', e);
  }
  requestAnimationFrame(loop);
}

// ===== 部署预览 =====
// 部队/建筑:若指针在可部署区外附近,预览显示吸附后的位置(与实际部署一致)
function getPreview() {
  if (selectedCardIdx < 0) return null;
  const cardId = playerHand[selectedCardIdx];
  if (!cardId) return null;
  const card = CARDS[cardId];
  const cost = card.cost;
  if (game.elixir[0] < cost) return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: true };
  if (card.kind !== KIND.SPELL) {
    const snapped = snapToDeployZone('player', mouseGrid.x, mouseGrid.y, game.towers[1], { zone: card.deployZone });
    if (snapped) {
      const moved = Math.abs(snapped.x - mouseGrid.x) > 0.01 || Math.abs(snapped.y - mouseGrid.y) > 0.01;
      return { cardId, x: snapped.x, y: snapped.y, invalid: false, snapped: moved, pointer: mouseGrid };
    }
    return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: true };
  }
  return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: false };
}

// ===== 输入接线 =====
function onHandCardClick(i) {
  const cardId = playerHand[i];
  if (!cardId) return;
  if (game.elixir[0] < CARDS[cardId].cost) { flashMsg('圣水不足'); return; }
  const newlySelected = selectedCardIdx !== i;
  selectedCardIdx = (selectedCardIdx === i ? -1 : i);
  if (newlySelected) audio.cardSelect(cardId);
}

const input = new InputController(canvas, {
  onPointer: (g) => { mouseGrid = g; },
  onDragStart: (g) => { mouseGrid = g; }, // 拖拽放兵扩展点:onDragStart 可携带手牌来源
  onTap: (g) => {
    if (phase !== 'playing') return;
    if (selectedCardIdx < 0 || game.gameOver) return;
    const cardId = playerHand[selectedCardIdx];
    const card = CARDS[cardId];
    if (game.elixir[0] < card.cost) {
      flashMsg('圣水不足');
      return;
    }
    // 部署区域检查(法术可全场;卡牌级部署规则由 canDeploy 解释)
    // 越界附近点击:自动吸附到最近的合法边缘(snapToDeployZone)
    if (card.kind !== KIND.SPELL) {
      if (!canDeploy('player', g.x, g.y, game.towers[1], { zone: card.deployZone })) {
        const snapped = snapToDeployZone('player', g.x, g.y, game.towers[1], { zone: card.deployZone });
        if (!snapped) {
          flashMsg('只能在己方半场(或已解锁区域)部署');
          return;
        }
        g = snapped;
      }
    }
    const ok = game.playCard(0, cardId, g.x, g.y);
    if (ok) {
      playerCycle(cardId, selectedCardIdx);
      selectedCardIdx = -1;
    } else {
      flashMsg('部署失败');
    }
  },
  onPressEscape: () => {
    if (phase === 'playing' || phase === 'paused') togglePause();
  },
});

// 顶部提示
let flashTimer = null;
function flashMsg(msg) {
  const el = els.status;
  el.textContent = msg;
  el.style.display = 'block';
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

// ===== 布局适配 =====
// 缩放 canvas 适配窗口(桌面:侧栏并排;移动端≤860px:纵向堆叠)
function fitCanvas() {
  const isMobile = window.innerWidth <= 860;
  // 可用宽度:桌面减去侧栏,移动端占满视口
  const maxW = isMobile ? window.innerWidth - 12 : window.innerWidth - 264;
  // 可用高度:留出标题+手牌区;移动端手牌更紧凑
  const chromeH = isMobile ? 150 : 200;
  const maxH = Math.max(300, window.innerHeight - chromeH);
  const scale = Math.min(1, maxW / CANVAS_W, maxH / CANVAS_H);
  canvas.style.width = Math.floor(CANVAS_W * scale) + 'px';
  canvas.style.height = Math.floor(CANVAS_H * scale) + 'px';
  // 同步手牌卡尺寸
  HandUI.fitCards(canvas, scale);
  handUI.invalidate();
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', fitCanvas);

// ===== UI 事件 =====
els.restart.addEventListener('click', () => {
  setPhase('ready');
  initGame();
  handUI.invalidate();
  renderer.draw(null, 0);
});
els.ovBtn.addEventListener('click', () => {
  audio.unlock(); // 首次交互解锁音频
  if (phase === 'ready') startGame();
  else if (phase === 'paused') togglePause();
});
els.pauseBtn.addEventListener('click', () => { if (phase === 'playing' || phase === 'paused') togglePause(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (phase === 'playing' || phase === 'paused')) {
    e.preventDefault();
    togglePause();
  }
});
els.deckSelect.addEventListener('change', () => {
  // 记住选中的卡组(下次默认使用)
  saveLastDeck(els.deckSelect.value);
  // ready 态切卡组直接重建预览
  if (phase === 'ready') { initGame(); handUI.invalidate(); renderer.draw(null, 0); }
  else if (confirm('切换卡组将重新开始,确定?')) { setPhase('ready'); initGame(); handUI.invalidate(); renderer.draw(null, 0); }
});
els.openDeckEditor.addEventListener('click', () => {
  const cur = els.deckSelect.value;
  const slotIdx = parseInt((cur || 'slot0').replace('slot', ''), 10);
  deckEditor.open(isNaN(slotIdx) ? 0 : slotIdx);
});
document.getElementById('openSettings').addEventListener('click', () => settingsScreen.open());
document.getElementById('againBtn').addEventListener('click', () => location.reload());

// 侧栏 AI 强度下拉 ↔ settings 双向同步(设置页改动时联动)
const aiLevelSelect = document.getElementById('aiLevel');
aiLevelSelect.value = String(settings.get('aiLevel'));
aiLevelSelect.addEventListener('change', () => {
  const v = parseFloat(aiLevelSelect.value);
  if (!isNaN(v)) settings.set('aiLevel', v);
});
appBus.on('settings:changed', ({ key, value }) => {
  if (key === 'aiLevel') aiLevelSelect.value = String(value);
});

// 卡组编辑器数据变化 → 刷新下拉与预览
appBus.on('decks:changed', () => {
  refreshDecks();
  if (phase === 'ready') { initGame(); handUI.invalidate(); renderer.draw(null, 0); }
});

// ===== 启动:进入待开始状态,不自动开战 =====
refreshDecks();
fitCanvas();
setPhase('ready');
initGame();
renderer.draw(null, 0);
lastTime = performance.now();
requestAnimationFrame(loop);
