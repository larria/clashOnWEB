// ===============================================
// 应用入口 - 游戏循环 / 流程状态机 / 模块编排
//
// 职责边界:
//   Game(逻辑) ← bus 事件 → UI/HUD/日志/音频(表现)
//   main 只做编排:创建实例、转发输入、驱动循环
// ===============================================
import { MATCH_TIME, CANVAS_W, CANVAS_H, canDeploy, snapToDeployZone } from './core/constants.js';
import { loadProgress } from './render/cardart.js';
import { CARDS, KIND } from './data/cards.js';
import { settings, aiLevelInfo, AI_LEVELS } from './core/settings.js';
import { appBus } from './core/events.js';
import { makeRng, shuffle } from './core/rng.js';
import { Recorder } from './core/recorder.js';
import { APP_VERSION } from './version.js';
import { Game } from './game/game.js';
import { AI } from './game/ai.js';
import { Renderer } from './render/renderer.js';
import { InputController, clientToGrid } from './input/input.js';
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
  aiBadge: document.getElementById('aiBadge'),
  aiBadgeName: document.getElementById('aiBadgeName'),
  bigAnnounce: document.getElementById('bigAnnounce'),
  restart: document.getElementById('cvRestart'),
  result: document.getElementById('result'),
  resultText: document.getElementById('resultText'),
  resultSub: document.getElementById('resultSub'),
  deckSelect: document.getElementById('deckSelect'),
  openDeckEditor: document.getElementById('openDeckEditor'),
};

// ===== 模块实例 =====
const gameLog = new GameLog(els.log);
const handUI = new HandUI(els.handArea, onHandCardClick, onHandCardDrag, () => {
  if (phase === 'playing' || phase === 'paused') togglePause();
});
const hud = new Hud(els);
const screens = new Screens(els);

// ===== 应用状态 =====
let game, renderer, ai, recorder;
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
// (AI 不持有 mirror:它不在任何 ROLE/COUNTERS,AI 抽到永远打不出,是死牌)
function sanitizeDeck(cards, forAI = false) {
  let out = [...new Set(cards)].filter(id => CARDS[id] && !CARDS[id].hidden && id !== 'golemite');
  if (forAI) out = out.filter(id => id !== 'mirror');
  out = out.slice(0, 8);
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
// 洗牌走本局 game.rng(重放确定性;game 未建时用一次性随机)
function drawPlayerHand() {
  playerDrawPile = playerDeck.slice();
  shuffle(playerDrawPile, game ? game.rng : makeRng());
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

// ===== URL 参数 =====
// ?deck=slot1        玩家用指定卡组(slot0-9;也接受卡组名如"野猪快攻")
// &aideck=slot2      AI 用指定卡组(同上;不传则随机)
// &ai=3              AI 难度档位(1-4 = 普通/困难/挑战/噩梦;兼容旧值 1.3→2,1.6→3)
// URL 参数优先级最高,但用户改过下拉后本局不再覆盖
const urlParams = new URLSearchParams(location.search);
let urlPlayerDeckKey = urlParams.get('deck');
let urlAiDeckKey = urlParams.get('aideck');
let urlAiDeckFixed = false;   // URL 指定 AI 卡组后,本会话重开也保持
const urlAiLevel = urlParams.get('ai');
if (urlAiLevel && !isNaN(parseFloat(urlAiLevel))) {
  // 统一转档位整数(旧数值 1.3/1.6 经 aiLevelInfo 归一)
  settings.set('aiLevel', aiLevelInfo(parseFloat(urlAiLevel)).level);
}
// 卡组名 → slotKey 解析
function resolveDeckKey(v) {
  if (!v) return null;
  if (DECKS[v] && DECKS[v].cards.length > 0) return v;
  const byName = Object.keys(DECKS).find(k => DECKS[k].name === v && DECKS[k].cards.length > 0);
  return byName || null;
}

// ===== 建局 =====
// 选择用于开局的卡组:空卡组(未编辑完)回退到第一个非空
function pickPlayableDeckKey() {
  const cur = els.deckSelect.value;
  if (DECKS[cur] && DECKS[cur].cards.length > 0) return cur;
  return Object.keys(DECKS).find(k => DECKS[k].cards.length > 0) || 'slot0';
}

function initGame() {
  // URL 参数指定玩家卡组:首次生效;用户手动切换后(urlPlayerDeckKey 置空)不再覆盖
  if (urlPlayerDeckKey) {
    const resolved = resolveDeckKey(urlPlayerDeckKey);
    if (resolved) { els.deckSelect.value = resolved; }
    urlPlayerDeckKey = null;   // 只在第一次建局生效(ready 态切卡组会走 change 事件)
  }
  const deckKey = pickPlayableDeckKey();
  if (els.deckSelect.value !== deckKey) els.deckSelect.value = deckKey;
  playerDeck = sanitizeDeck(DECKS[deckKey] ? DECKS[deckKey].cards : DECKS['slot0'].cards);
  const aiInfo = aiLevelInfo(settings.get('aiLevel'));
  aiLevel = aiInfo.thinkMult;          // 决策频率倍率(主循环用)
  // 左上角 AI 难度徽章(噩梦档红字提示)
  els.aiBadgeName.textContent = aiInfo.name;
  els.aiBadge.classList.toggle('nightmare', aiInfo.level === 4);
  // AI 卡组:URL 指定优先(本局会话固定),否则每局随机
  if (!urlAiDeckFixed && urlAiDeckKey) {
    const resolved = resolveDeckKey(urlAiDeckKey);
    if (resolved) { aiDeck = sanitizeDeck(DECKS[resolved].cards, true); urlAiDeckFixed = true; }
    urlAiDeckKey = null;
  }
  if (!urlAiDeckFixed) {
    const presetKeys = Object.keys(DECKS).filter(k => DECKS[k].cards.length > 0);
    // 全部卡组被清空时回退到经典卡组(否则 DECKS[undefined] 崩溃,界面卡死在封面)
    const pickKey = presetKeys.length > 0
      ? presetKeys[Math.floor(Math.random() * presetKeys.length)]
      : null;
    aiDeck = sanitizeDeck(pickKey ? DECKS[pickKey].cards : [], true);
  }

  // 本局 RNG + 记录器:seed 记进 Recorder,"seed+出牌脚本"可确定性重放整局
  // (上一局的记录先落盘——不刷新页面时上一场对局可随时导出/重放)
  if (recorder) recorder.saveLocal();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  game = new Game({ seed });
  game.aiElixirMult = aiInfo.elixirMult;   // 噩梦难度:AI 圣水 ×1.5
  recorder = new Recorder(game, {
    seed, playerDeck: playerDeck.slice(), aiDeck: aiDeck.slice(), aiLevel: aiInfo.level,
  });
  // Renderer 跨局复用(Pixi Application/GL 上下文与纹理缓存昂贵);
  // 已存在时仅切到新 game(sprite 池/遮罩签名由 setGame 重置)
  if (renderer) renderer.setGame(game);
  else renderer = new Renderer(canvas, game);
  ai = new AI(game, aiDeck.slice());
  window.CR = window.CR || {};
  CR._dbg = { game, ai, recorder, get renderer(){return renderer;}, get playerDeck(){return playerDeck;}, get aiDeck(){return aiDeck;} }; // 调试/测试出口

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
    // 公主塔被推:部署区解锁(不播特效,仅提示文案;选牌时用红遮罩标出可选范围)
    if (tower.lane !== 'king') {
      const isMyKill = tower.side === 1; // 敌方(玩家打掉的塔)→ 我方解锁
      if (isMyKill) {
        hud.announce('🔓 部署区解锁', (tower.lane === 'left' ? '左路' : '右路') + '敌方区域已开放', '#ffd54f');
        gameLog.push(`🔓 ${tower.lane === 'left' ? '左' : '右'}路敌方部署区已解锁`, 'sys');
      } else {
        hud.announce('⚠️ 防线告急', '敌方解锁了你的' + (tower.lane === 'left' ? '左' : '右') + '路部署区', '#ff5a4f');
      }
    }
  });

  drawPlayerHand();
  // 重置交互状态(防止拖拽/选中跨局残留:重开时仍按住拖拽会在新局误部署)
  selectedCardIdx = -1;
  draggingCardIdx = -1;
  pointerOnCanvas = false;
  handUI.resetDrag();
  els.result.classList.remove('show');
  fitCanvas();
  window.scrollTo(0, 0);
}

// ===== 流程状态机 =====
function setPhase(p) {
  phase = p;
  if (p === 'ready') {
    screens.showOverlay({
      title: 'READY',
      desc: '选择卡组与 AI 强度,摧毁对方国王塔获胜',
      btn: '开始战斗',
      hint: '空格键 暂停/继续',
    });
  } else if (p === 'playing') {
    screens.hideOverlay();
    if (handUI._pauseBtnEl) handUI._pauseBtnEl.classList.remove('isPlay');
  } else if (p === 'paused') {
    // 暂停浮层复用封面(paused 类隐藏配置区)
    screens.showOverlay({
      title: 'PAUSED',
      desc: '圣水已冻结',
      btn: '继续战斗',
      hint: '空格键 暂停/继续',
      paused: true,
    });
    if (handUI._pauseBtnEl) handUI._pauseBtnEl.classList.add('isPlay');
  } else if (p === 'over') {
    screens.hideOverlay();
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

// 页面不可见/窗口失焦时自动暂停(防止后台节流导致游戏时间失真/错过操作)
// - 浏览器标签页:visibilitychange(切标签/最小化)即 document.hidden
// - PWA 独立窗口(standalone):窗口被遮挡/切到别的应用但未最小化时,
//   document.hidden 可能保持 false、visibilitychange 不触发 → 补充
//   window blur 失焦即暂停(仅 standalone 启用:标签页下点地址栏也会
//   触发 blur,误暂停会很烦)
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function autoPause(reason) {
  if (phase === 'playing') {
    togglePause();
    gameLog.push(reason, 'sys');
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autoPause('页面切到后台,游戏已自动暂停');
});
if (isStandalone) {
  window.addEventListener('blur', () => autoPause('窗口失焦,游戏已自动暂停'));
}
// 切回前台时校准时间基准(避免恢复瞬间 dt 跳变)
window.addEventListener('focus', () => {
  if (phase === 'playing') lastTime = performance.now();
});

// ===== 主循环 =====
let _renderAcc = 0;   // 渲染节流累积器(动态帧率)
function loop(now) {
  try {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (phase === 'playing' && game) {
      game.update(dt);
      // AI 更新(决策节律封装在 AI 内,编排层不感知 thinkTimer)
      ai.update(dt, aiLevel);
      hud.update(game);
      gameLog.setTime(game.time);   // 日志时间戳数据源
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
      // 动态渲染节流(发热优化):
      // - 对局中(playing):低端设备(lowFx)渲染降到 ~33fps(游戏逻辑
      //   仍满帧跑,策略游戏 33fps 渲染无感知差异,GPU 占用近乎减半);
      //   高端设备满帧
      // - 非对局(ready/paused/over):一律 ~33fps(战场静止,只余呼吸动画)
      const RENDER_INTERVAL = 0.03;   // 33fps 节流帧距
      _renderAcc += dt;
      const wantFull = phase === 'playing' && !renderer.lowFx;
      if (wantFull || _renderAcc >= RENDER_INTERVAL) {
        _renderAcc = 0;
        renderer.draw(phase === 'playing' ? getPreview() : null, phase === 'playing' ? dt : 0);
      }
    }
    if (phase === 'playing' && game && game.gameOver) {
      // 终场提示后稍作停顿再弹结算
      if (!announcedTimeUp && game.time < MATCH_TIME - 0.01) {
        // 国王塔陨落型结束(非超时)
        hud.announce(game.winner === 0 ? '👑 国王塔陨落!' : '💥 防线崩溃!', game.winner === 0 ? 'VICTORY' : 'DEFEAT', game.winner === 0 ? '#7fd4ff' : '#ff8a80');
      }
      // 捕获本局 game:若 1.2s 内玩家点了重开(initGame 换了新 game),
      // 此回调不得劫持新对局(否则弹空结算并冻结新局)
      const finishedGame = game;
      setTimeout(() => {
        if (phase !== 'over' && game === finishedGame) {
          setPhase('over');
          screens.showResult(finishedGame.winner);
        }
      }, 1200);
      // 终局即落盘本局记录(重开不丢;下次建局会再 saveLocal 兜底)
      if (recorder) recorder.saveLocal();
      phase = 'over-wait';
    }
  } catch (e) {
    console.error('游戏循环异常:', e);
  }
  requestAnimationFrame(loop);
}

// ===== 部署预览 =====
// 预览时机:指针位于战场 canvas 内,且(已选牌 或 正在拖拽携带)——
// 点击选牌/拖拽开始时不显示,移入战场才跟随
let pointerOnCanvas = false;   // 指针是否在战场 canvas 范围内
let draggingCardIdx = -1;      // 拖拽携带中的手牌 idx(-1 无)

function previewGridFor() {
  return mouseGrid;
}

function activeCardIdx() {
  return draggingCardIdx >= 0 ? draggingCardIdx : selectedCardIdx;
}

// 部队/建筑:若指针在可部署区外附近,预览显示吸附后的位置(与实际部署一致)
function getPreview() {
  if (!pointerOnCanvas) return null;
  const idx = activeCardIdx();
  if (idx < 0) return null;
  const cardId = playerHand[idx];
  if (!cardId) return null;
  const card = CARDS[cardId];
  const cost = card.cost;
  if (game.elixir[0] < cost) return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: true };
  if (card.kind !== KIND.SPELL) {
    // 与 deployAtMouse 完全同参(含己方塔+场上建筑占位:预览须与实际一致)
    const snapped = snapToDeployZone('player', mouseGrid.x, mouseGrid.y, game.towers[1], { zone: card.deployZone }, game.towers[0], undefined, game.units.filter(u => u.isBuilding && !u.dead));
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

// 手牌拖拽:进入携带模式 → 战场跟随预览 → 松手部署(合法时)
function onHandCardDrag(i, dragPhase, e) {
  if (dragPhase === 'start') {
    if (!game || phase !== 'playing' || game.gameOver) return;   // 仅对局中
    const cardId = playerHand[i];
    if (!cardId || game.elixir[0] < CARDS[cardId].cost) return;
    draggingCardIdx = i;
    selectedCardIdx = -1;             // 拖拽优先于点击选牌
    audio.cardSelect(cardId);
  } else if (dragPhase === 'move' && e) {
    updatePointerFromClient(e.clientX, e.clientY);
  } else if (dragPhase === 'end') {
    if (draggingCardIdx >= 0 && pointerOnCanvas && phase === 'playing' && game && !game.gameOver) {
      deployAtMouse(draggingCardIdx);
    }
    draggingCardIdx = -1;
    pointerOnCanvas = false;
    handUI.invalidate();   // 拖拽期间被抑制的重建(圣水变化等)此刻补上
  }
}

// 屏幕坐标 → 格坐标(并记录指针是否在 canvas 内)
function updatePointerFromClient(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  const inside = cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
  if (!inside) { pointerOnCanvas = false; return; }
  pointerOnCanvas = true;
  mouseGrid = clientToGrid(canvas, cx, cy);
}

// 在当前指针位置部署指定手牌(拖拽松手/点击战场共用)
function deployAtMouse(idx) {
  const cardId = playerHand[idx];
  if (!cardId || !game || game.gameOver) return;
  const card = CARDS[cardId];
  if (game.elixir[0] < card.cost) { flashMsg('圣水不足'); return; }
  let g = mouseGrid;
  if (card.kind !== KIND.SPELL) {
    // 建筑单位占位与塔一致(场上 3×3/2×2 建筑不可重叠)
    const buildings = game.units.filter(u => u.isBuilding && !u.dead);
    if (!canDeploy('player', g.x, g.y, game.towers[1], { zone: card.deployZone }, game.towers[0], buildings)) {
      const snapped = snapToDeployZone('player', g.x, g.y, game.towers[1], { zone: card.deployZone }, game.towers[0], undefined, buildings);
      if (!snapped) { flashMsg('只能在己方半场(或已解锁区域)部署'); return; }
      g = snapped;
    }
  }
  const ok = game.playCard(0, cardId, g.x, g.y);
  if (ok) {
    playerCycle(cardId, idx);
    if (selectedCardIdx === idx) selectedCardIdx = -1;
  } else {
    flashMsg('部署失败');
  }
}

// 移动端长按默认行为:禁用系统呼出菜单(iOS/Android 长按震动源)
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  // 输入框内保留(粘贴菜单)
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  e.preventDefault();
});
// 双击缩放兜底(部分浏览器忽略 viewport meta)
document.addEventListener('dblclick', (e) => {
  if (e.target && e.target.tagName !== 'INPUT') e.preventDefault();
});

const input = new InputController(canvas, {
  onPointer: (g, e) => {
    mouseGrid = g;
    pointerOnCanvas = true;   // canvas 上指针事件仅在指针位于其上时发生
  },
  onDragStart: (g) => { mouseGrid = g; },
  onTap: (g) => {
    if (phase !== 'playing' || !game || game.gameOver) return;
    const idx = activeCardIdx();
    if (idx < 0) return;
    mouseGrid = g;
    deployAtMouse(idx);
  },
  onPressEscape: () => {
    if (phase === 'playing' || phase === 'paused') togglePause();
  },
});
// 指针离开战场 → 预览隐藏(点击选牌模式下移出即不显示)
canvas.addEventListener('pointerleave', () => {
  if (draggingCardIdx < 0) pointerOnCanvas = false;
});
// 桌面:选牌后鼠标进入战场才开始跟随(canvas pointerenter 已覆盖于 onPointer)

// 顶部提示
let flashTimer = null;
function flashMsg(msg) {
  const el = els.status;
  el.textContent = msg;
  el.style.display = 'block';
  if (flashTimer) clearTimeout(flashTimer);
  // 到期隐藏整个胶囊(只清文字会残留一个空壳)
  flashTimer = setTimeout(() => { el.textContent = ''; el.style.display = 'none'; }, 1500);
}

// ===== 布局适配(全屏自适应,禁止滚动) =====
// 战场 canvas 按视口可用空间等比缩放:宽屏扣除右侧信息栏,窄屏占满;
// 高度扣除手牌区,保证整体始终在视口内不滚动。
// 手牌区高度与 canvas 宽联动(4.75 卡宽 ≈ canvas 宽),迭代一次收敛。
function fitCanvas() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const bodyPad = 22;                        // body padding + 上下余量
  const sideVisible = vw >= 1024 && vh >= 560;
  const sideW = sideVisible ? 230 + 10 : 0;  // 侧栏宽 + gap
  const availW = vw - sideW - bodyPad - 6;

  // 迭代:先假定一个 canvas 宽 → 得手牌高 → 得可用高 → 得 canvas 缩放
  let cw = Math.min(availW, CANVAS_W);
  for (let i = 0; i < 2; i++) {
    const cardW = Math.max(52, Math.min(96, (cw - 4 * 6) / 4.75));
    const handH = 30 + cardW * 1.25 + 12;
    const availH = vh - handH - bodyPad;
    const scale = Math.min(1, availW / CANVAS_W, availH / CANVAS_H);
    cw = Math.floor(CANVAS_W * scale);
    if (cw <= 0) { cw = 100; break; }
  }
  const finalScale = cw / CANVAS_W;
  canvas.style.width = cw + 'px';
  canvas.style.height = Math.floor(CANVAS_H * finalScale) + 'px';
  // fx 覆盖层跟随 #game 同尺寸(叠放在其上)
  const fxC = document.getElementById('fx');
  if (fxC) {
    fxC.style.width = cw + 'px';
    fxC.style.height = Math.floor(CANVAS_H * finalScale) + 'px';
  }
  // 同步手牌卡尺寸(卡宽与 canvas 宽联动)
  HandUI.fitCards(canvas, finalScale);
  handUI.invalidate();
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', fitCanvas);

// ===== UI 事件 =====
function restartGame() {
  audio.stopMusic();   // 中途重开:上一局未结束不会发 match:end,音乐需显式停
  setPhase('ready');
  initGame();
  handUI.invalidate();
  renderer.draw(null, 0);
}
document.getElementById('cvRestart').addEventListener('click', () => {
  restartGame();   // 重开成本低,统一不弹原生 confirm(与游戏内 UI 风格一致)
});
els.ovBtn.addEventListener('click', () => {
  audio.unlock(); // 首次交互解锁音频
  if (phase === 'ready') startGame();
  else if (phase === 'paused') togglePause();
});
window.addEventListener('keydown', (e) => {
  // 输入框内不劫持按键(卡组编辑器改名时按空格不应暂停游戏)
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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

// 封面二级页:战斗日志(与侧栏 #log 实时镜像)
const logScreenEl = document.getElementById('logScreen');
document.getElementById('openBattleLog').addEventListener('click', () => {
  syncLogScreen();
  logScreenEl.classList.add('show');
});
document.getElementById('logScreenClose').addEventListener('click', () => logScreenEl.classList.remove('show'));
logScreenEl.addEventListener('click', (e) => { if (e.target === logScreenEl) logScreenEl.classList.remove('show'); });

// 封面二级页:玩法说明
const helpScreenEl = document.getElementById('helpScreen');
document.getElementById('openHelp').addEventListener('click', () => helpScreenEl.classList.add('show'));
document.getElementById('helpScreenClose').addEventListener('click', () => helpScreenEl.classList.remove('show'));
helpScreenEl.addEventListener('click', (e) => { if (e.target === helpScreenEl) helpScreenEl.classList.remove('show'); });

// 日志镜像:打开二级页时把侧栏日志内容复制过去(节流:打开瞬间快照)
function syncLogScreen() {
  const src = els.log;
  const dst = document.getElementById('logScreenList');
  if (src && dst) dst.innerHTML = src.innerHTML;
}

// 复制对局记录(可重放 JSON):优先当前局进行中的记录,终局/重开后
// 回退到 localStorage 里已落盘的上一场
document.getElementById('copyRecBtn').addEventListener('click', async () => {
  const btn = document.getElementById('copyRecBtn');
  let payload = null, label = '';
  if (recorder && recorder.plays && recorder.plays.length >= 0 && !game.gameOver) {
    payload = recorder.export(); label = '当前局';
  } else if (recorder && recorder.plays && recorder.plays.length > 0) {
    payload = recorder.export(); label = '刚结束的一局';
  } else {
    const last = Recorder.loadLocal();
    if (last) { payload = JSON.stringify(last); label = '上一场(本页会话)'; }
  }
  if (!payload) { flashMsg('暂无可复制的对局记录'); return; }
  try {
    await navigator.clipboard.writeText(payload);
    flashMsg(`已复制${label}对局记录 JSON(${(payload.length / 1024).toFixed(1)}KB)`);
  } catch (e) {
    // 剪贴板 API 不可用时退化为下载文件
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clash-recording.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flashMsg('已下载对局记录 JSON');
  }
});

// 封面 AI 难度下拉(四档)↔ settings 双向同步(设置页改动时联动)
const aiLevelSelect = document.getElementById('aiLevel');
function syncAiSelect() {
  aiLevelSelect.value = String(aiLevelInfo(settings.get('aiLevel')).level);
}
syncAiSelect();
aiLevelSelect.addEventListener('change', () => {
  const v = parseInt(aiLevelSelect.value, 10);
  if (!isNaN(v)) settings.set('aiLevel', Math.max(1, Math.min(4, v)));
});
appBus.on('settings:changed', ({ key, value }) => {
  if (key === 'aiLevel') syncAiSelect();
});

// 卡组编辑器数据变化 → 刷新下拉与预览
appBus.on('decks:changed', () => {
  refreshDecks();
  if (phase === 'ready') { initGame(); handUI.invalidate(); renderer.draw(null, 0); }
});

// ===== PWA 版本显示 + 更新流 =====
// 封面版本徽标(与 sw.js 的 APP_VERSION 同步维护)
const cvVersionEl = document.getElementById('cvVersion');
if (cvVersionEl) cvVersionEl.textContent = 'v' + APP_VERSION;
// SW 更新流:检测到新 SW 已安装 → 底部提示条 → 用户确认 → skipWaiting → reload
if ('serviceWorker' in navigator) {
  const updateBar = document.getElementById('updateBar');
  const updateBtn = document.getElementById('updateBtn');
  let applying = false;
  const applyUpdate = async () => {
    if (applying) return;
    applying = true;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting');
    // 兜底:controllerchange 3s 未触发(极端情况)直接刷新
    setTimeout(() => location.reload(), 3000);
  };
  if (updateBtn) updateBtn.addEventListener('click', applyUpdate);
  navigator.serviceWorker.ready.then((reg) => {
    // 已有 waiting 的 SW(打开页面期间完成的更新)
    if (reg.waiting && updateBar) updateBar.classList.add('show');
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller && updateBar) {
          updateBar.classList.add('show');
        }
      });
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
}

// ===== 启动:进入待开始状态,不自动开战 =====
// 加载遮罩:等卡图预载完成(或 4s 超时)再显示界面,期间盖住全屏防止
// canvas 随图片陆续到达而反复重排抖动
const loadingEl = document.getElementById('loading');
const ldFill = document.getElementById('ldFill');
const loadingStart = performance.now();
const hideLoading = () => {
  if (!loadingEl || loadingEl.classList.contains('hide')) return;
  fitCanvas();           // 资源就位后最终定版布局
  loadingEl.classList.add('hide');
};
const loadingTick = setInterval(() => {
  const p = loadProgress();
  if (ldFill) ldFill.style.width = (p * 100).toFixed(0) + '%';
  if (p >= 1 || performance.now() - loadingStart > 4000) {
    clearInterval(loadingTick);
    hideLoading();
  }
}, 100);

refreshDecks();
fitCanvas();
setPhase('ready');
initGame();
renderer.draw(null, 0);
lastTime = performance.now();
requestAnimationFrame(loop);
