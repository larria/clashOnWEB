// ===============================================
// 主入口 - 游戏循环/玩家交互/手牌UI
// ===============================================
window.CR = window.CR || {};
(function (CR) {
  'use strict';

  const DECKS = {
    strong: ['giant','miniPekka','musketeer','wizard','skeletons','arrows','fireball','minions'],
    hog: ['hogRider','musketeer','archers','skeletons','zap','fireball','skeletons','goblins'],
    golem: ['golem','babyDragon','miniPekka','wizard','minions','arrows','zap','barbarianHut'],
    air: ['balloon','minionHorde','minions','babyDragon','musketeer','arrows','fireball','skeletons'],
    cycle: ['hogRider','skeletons','goblins','spearGoblins','zap','archers','fireball','musketeer'],
  };
  // 修正:确保所有卡都存在
  for (const k of Object.keys(DECKS)) {
    DECKS[k] = DECKS[k].filter(id => CR.CARDS[id] && !CR.CARDS[id].hidden && id!=='golemite').slice(0,8);
    if (DECKS[k].length < 8) {
      // 补足
      const fallback = ['skeletons','goblins','archers','musketeer','fireball','arrows','knight','minions'];
      for (const f of fallback) {
        if (DECKS[k].length >= 8) break;
        if (!DECKS[k].includes(f)) DECKS[k].push(f);
      }
    }
  }

  let game, renderer, ai;
  let playerHand = [];
  let playerDeck = [];
  let playerDrawPile = [];
  let playerNext = null;
  let selectedCardIdx = -1;
  let mouseGrid = { x: 0, y: 0 };
  let lastTime = 0;
  let aiLevel = 1.3;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const logEl = document.getElementById('log');
  const infoEl = document.getElementById('info');
  const resultEl = document.getElementById('result');
  const resultText = document.getElementById('resultText');

  // 全面日志系统
  // who: 'me'(玩家) | 'ai'(AI) | 'sys'(系统) | 'kill'(击杀) | 'spell'(法术)
  function log(msg, who) {
    const div = document.createElement('div');
    div.className = who || 'sys';
    const prefix = { me:'[你] ', ai:'[AI] ', sys:'', kill:'', spell:'' }[who || 'sys'] || '';
    div.textContent = prefix + msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    if (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
  }
  // 暴露给 AI / game 模块
  CR.log = log;

  // 玩家手牌(与 AI 一致规则:4手牌+1next)
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
    playerDrawPile.push(playedCardId); // 打出的卡放回抽牌堆底部
    playerNext = playerDrawPile.shift();
  }

  function start() {
    const deckKey = document.getElementById('deckSelect').value;
    playerDeck = DECKS[deckKey].slice();
    aiLevel = parseFloat(document.getElementById('aiLevel').value);
    game = new CR.Game();
    game.onTowerDestroyedCb = (tw) => {
      const sideName = tw.side === 0 ? '你的' : 'AI的';
      const laneName = tw.lane === 'king' ? '国王塔' : (tw.lane === 'left' ? '左公主塔' : '右公主塔');
      // 计算双方剩余皇冠
      const myCrowns = (game.towers[1].left.dead?1:0)+(game.towers[1].right.dead?1:0)+(game.towers[1].king.dead?1:0);
      const aiCrowns = (game.towers[0].left.dead?1:0)+(game.towers[0].right.dead?1:0)+(game.towers[0].king.dead?1:0);
      log(`${sideName}${laneName}被摧毁! 皇冠 ${myCrowns} : ${aiCrowns}`, tw.side === 0 ? 'ai' : 'me');
      if (tw.lane === 'king') {
        log(sideName === '你的' ? '💀 你的国王塔陨落,战斗失败!' : '🏆 AI国王塔陨落,胜利!', sideName === '你的' ? 'ai' : 'me');
      }
    };
    renderer = new CR.Renderer(canvas, game);
    // AI 使用同卡组
    ai = new CR.AI(game, playerDeck.slice());
    drawPlayerHand();
    selectedCardIdx = -1;
    lastTime = performance.now();
    logEl.innerHTML = '';
    resultEl.style.display = 'none';
    log('战斗开始!同卡组对战:' + playerDeck.map(id=>CR.CARDS[id].name).join('、'), 'me');
    fitCanvas();
    window.scrollTo(0, 0);
    requestAnimationFrame(loop);
  }

  // 缩放 canvas 适配窗口(同时考虑宽高,留出标题+手牌区空间,避免溢出视口)
  function fitCanvas() {
    // 标题~40 + 手牌区~135 + 边距~25
    const maxH = window.innerHeight - 200;
    // 窄屏时侧边栏换行到下方,canvas 可占满宽度
    const sideW = window.innerWidth > 820 ? 252 : 20;
    const maxW = window.innerWidth - sideW;
    const scale = Math.min(1, maxH / CR.CANVAS_H, maxW / CR.CANVAS_W);
    canvas.style.width = (CR.CANVAS_W * scale) + 'px';
    canvas.style.height = (CR.CANVAS_H * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);

  function loop(now) {
    try {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      game.update(dt);
      // AI 更新(按强度调整决策间隔)
      ai.thinkTimer += dt;
      const interval = 0.7 / aiLevel;
      if (ai.thinkTimer >= interval && !game.gameOver) {
        ai.thinkTimer = 0;
        ai.decide();
      }
      drawHandUI();
      drawInfo();
      renderer.draw(getPreview());
      if (game.gameOver) {
        showResult();
        return;
      }
    } catch (e) {
      console.error('游戏循环异常:', e);
    }
    requestAnimationFrame(loop);
  }

  function getPreview() {
    if (selectedCardIdx < 0) return null;
    const cardId = playerHand[selectedCardIdx];
    if (!cardId) return null;
    const card = CR.CARDS[cardId];
    const cost = card.cost;
    if (game.elixir[0] < cost) return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: true };
    return { cardId, x: mouseGrid.x, y: mouseGrid.y, invalid: false };
  }

  function showResult() {
    let txt;
    if (game.winner === 0) txt = '🏆 胜利!';
    else if (game.winner === 1) txt = '💀 失败';
    else txt = '⚖️ 平局';
    resultText.textContent = txt;
    resultText.style.color = game.winner === 0 ? '#7fd' : (game.winner === 1 ? '#f87' : '#ffd700');
    resultEl.style.display = 'block';
  }

  function drawInfo() {
    const t = Math.floor(game.time);
    const m = String(Math.floor(t/60)).padStart(2,'0');
    const s = String(t%60).padStart(2,'0');
    const de = game.doubleElixir ? ' ×2圣水' : '';
    let html = `⏱ ${m}:${s}${de}<br>`;
    html += `🔵 你的圣水:${game.elixir[0]} / 10<br>`;
    html += `🔴 AI圣水:${game.elixir[1]} / 10<br>`;
    // 塔血
    const pt = game.towers[0], at = game.towers[1];
    html += `<br>👑 你的国王塔:${Math.max(0,Math.round(pt.king.hp))}<br>`;
    html += `🏰 左塔:${pt.left.dead?'×':Math.round(pt.left.hp)} | 右塔:${pt.right.dead?'×':Math.round(pt.right.hp)}<br>`;
    html += `<br>👑 AI国王塔:${Math.max(0,Math.round(at.king.hp))}<br>`;
    html += `🏰 左塔:${at.left.dead?'×':Math.round(at.left.hp)} | 右塔:${at.right.dead?'×':Math.round(at.right.hp)}<br>`;
    infoEl.innerHTML = html;
  }

  // 手牌 UI(绘制在 canvas 下方 #handArea)— 增量更新,避免每帧重建导致点击丢失
  let handEl = null;
  let lastHandSig = '';
  function ensureHandEl() {
    if (handEl) return handEl;
    handEl = document.getElementById('handArea');
    return handEl;
  }

  function drawHandUI() {
    const el = ensureHandEl();
    // 签名:手牌内容 + 选中 + 圣水(决定可玩状态)
    const sig = playerHand.join(',') + '|' + selectedCardIdx + '|' + game.elixir[0];
    if (sig !== lastHandSig) {
      lastHandSig = sig;
      el.innerHTML = '';
      // 圣水条
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;margin-bottom:4px;';
      let barHtml = '<div style="display:flex;gap:1px;">';
      for (let i = 0; i < 10; i++) {
        const filled = i < game.elixir[0];
        barHtml += `<div style="width:14px;height:14px;border-radius:50%;background:${filled?'#d32f2f':'#555'};border:1px solid #333;"></div>`;
      }
      barHtml += `</div><div style="margin-left:6px;color:#ff6666;font-weight:bold;">${game.elixir[0]}</div>`;
      bar.innerHTML = barHtml;
      el.appendChild(bar);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;';
      for (let i = 0; i < playerHand.length; i++) {
        const cardId = playerHand[i];
        const card = CR.CARDS[cardId];
        const cost = card.cost;
        const canPlay = game.elixir[0] >= cost;
        const selected = i === selectedCardIdx;
        const d = document.createElement('div');
        d.style.cssText = `width:80px;height:100px;background:${selected?'#4a6daa':'#2a2a4e'};border:2px solid ${selected?'#ffd700':'#555'};border-radius:6px;padding:4px;cursor:${canPlay?'pointer':'not-allowed'};opacity:${canPlay?1:0.5};position:relative;text-align:center;font-size:11px;display:flex;flex-direction:column;justify-content:space-between;`;
        d.innerHTML = `
          <div style="font-weight:bold;color:${card.color};text-shadow:0 0 3px #000;">${card.name}</div>
          <div style="width:30px;height:30px;border-radius:50%;background:${card.color};margin:0 auto;"></div>
          <div style="color:#ff6666;font-weight:bold;">💧${cost}</div>
        `;
        d.dataset.idx = i;
        // 始终绑定点击,内部判断圣水
        d.addEventListener('click', () => {
          if (game.elixir[0] < CR.CARDS[playerHand[i]].cost) { flashMsg('圣水不足'); return; }
          selectedCardIdx = (selectedCardIdx === i ? -1 : i);
        });
        row.appendChild(d);
      }
      // next 卡
      const nd = document.createElement('div');
      nd.style.cssText = 'width:60px;height:100px;background:#1a1a2e;border:2px dashed #555;border-radius:6px;padding:4px;text-align:center;font-size:10px;display:flex;flex-direction:column;justify-content:center;opacity:0.7;';
      const nc = CR.CARDS[playerNext];
      nd.innerHTML = `<div>下一张</div><div style="font-weight:bold;color:${nc.color}">${nc.name}</div><div style="color:#ff6666">💧${nc.cost}</div>`;
      row.appendChild(nd);
      el.appendChild(row);
    }
  }

  // 鼠标交互
  function canvasToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * CR.CANVAS_W;
    const sy = (e.clientY - rect.top) / rect.height * CR.CANVAS_H;
    return { x: sx / CR.CELL, y: sy / CR.CELL };
  }

  canvas.addEventListener('mousemove', (e) => {
    mouseGrid = canvasToGrid(e);
  });
  canvas.addEventListener('click', (e) => {
    if (selectedCardIdx < 0 || game.gameOver) return;
    const g = canvasToGrid(e);
    const cardId = playerHand[selectedCardIdx];
    const card = CR.CARDS[cardId];
    if (game.elixir[0] < card.cost) {
      flashMsg('圣水不足');
      return;
    }
    // 部署区域检查(法术可全场)
    if (card.kind !== CR.KIND.SPELL) {
      if (!CR.canDeploy('player', g.x, g.y)) {
        flashMsg('只能在己方半场(河道下方)部署');
        return;
      }
    }
    const ok = game.playCard(0, cardId, g.x, g.y);
    if (ok) {
      const posStr = `(${g.x.toFixed(1)},${g.y.toFixed(1)})`;
      if (card.kind === CR.KIND.SPELL) {
        log(`施放 ${card.name} ${posStr}`, 'spell');
      } else if (card.kind === CR.KIND.BUILDING) {
        log(`建造 ${card.name} ${posStr}`, 'me');
      } else {
        log(`部署 ${card.name} ${posStr}`, 'me');
      }
      playerCycle(cardId, selectedCardIdx);
      selectedCardIdx = -1;
    } else {
      flashMsg('部署失败');
    }
  });

  // 顶部提示
  let flashTimer = null;
  function flashMsg(msg) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.style.display = 'block';
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = ''; }, 1500);
  }

  document.getElementById('restart').addEventListener('click', start);
  document.getElementById('deckSelect').addEventListener('change', () => { if (confirm('切换卡组将重新开始,确定?')) start(); });

  // 启动
  fitCanvas();
  start();

})(window.CR);
