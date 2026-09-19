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
    resultEl.classList.remove('show');
    log('战斗开始!同卡组对战:' + playerDeck.map(id=>CR.CARDS[id].name).join('、'), 'me');
    fitCanvas();
    window.scrollTo(0, 0);
    requestAnimationFrame(loop);
  }

  // 缩放 canvas 适配窗口(桌面:侧栏并排;移动端≤860px:纵向堆叠)
  function fitCanvas() {
    const isMobile = window.innerWidth <= 860;
    // 可用宽度:桌面减去侧栏(220+gap+padding),移动端占满视口(减边框/边距)
    const maxW = isMobile ? window.innerWidth - 12 : window.innerWidth - 264;
    // 可用高度:留出标题+手牌区;移动端手牌更紧凑
    const chromeH = isMobile ? 150 : 200;
    const maxH = Math.max(300, window.innerHeight - chromeH);
    // 战场宽高比 684:1216,按更紧的约束缩放
    const scale = Math.min(1, maxW / CR.CANVAS_W, maxH / CR.CANVAS_H);
    canvas.style.width = Math.floor(CR.CANVAS_W * scale) + 'px';
    canvas.style.height = Math.floor(CR.CANVAS_H * scale) + 'px';
    // 同步手牌卡尺寸:移动端缩小,保证 4卡+next 不超出屏宽
    fitHandCards(scale);
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', fitCanvas);

  // 手牌卡尺寸适配
  function fitHandCards(scale) {
    const isMobile = window.innerWidth <= 860;
    // 基础卡宽80,移动端按 canvas 宽度比例缩小,但不小于 52
    const canvasW = canvas.getBoundingClientRect().width || CR.CANVAS_W * scale;
    let cardW = 80;
    if (isMobile) {
      // 4卡 + next(0.75卡) + 4gap 需 ≤ canvasW
      cardW = Math.max(52, Math.floor((canvasW - 4*6) / 4.75));
    }
    document.documentElement.style.setProperty('--card-w', cardW + 'px');
    document.documentElement.style.setProperty('--card-h', Math.floor(cardW * 1.25) + 'px');
    document.documentElement.style.setProperty('--card-font', Math.max(9, Math.floor(cardW * 0.14)) + 'px');
    document.documentElement.style.setProperty('--orb-size', Math.floor(cardW * 0.38) + 'px');
    // 尺寸变化后强制重建手牌(圣水珠子等内联尺寸需要刷新)
    lastHandSig = '';
  }

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
      renderer.draw(getPreview(), dt);
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
    let txt, sub;
    if (game.winner === 0) { txt = '🏆 胜利!'; sub = 'VICTORY'; }
    else if (game.winner === 1) { txt = '💀 失败'; sub = 'DEFEAT'; }
    else { txt = '⚖️ 平局'; sub = 'DRAW'; }
    resultText.textContent = txt;
    resultText.style.color = game.winner === 0 ? '#7fd4ff' : (game.winner === 1 ? '#ff8a80' : '#ffe082');
    const subEl = document.getElementById('resultSub');
    if (subEl) { subEl.textContent = sub; subEl.style.color = resultText.style.color; }
    resultEl.classList.add('show');
  }

  function drawInfo() {
    const t = Math.floor(game.time);
    const m = String(Math.floor(t/60)).padStart(2,'0');
    const s = String(t%60).padStart(2,'0');
    const de = game.doubleElixir ? ' <span style="color:#ff8a80;font-weight:700;">×2</span>' : '';
    const pt = game.towers[0], at = game.towers[1];
    const towerLine = (tw, color) => {
      const hp = tw.dead ? '<span style="color:#666;">✕</span>' : Math.round(tw.hp);
      return `<span style="color:${color};">${hp}</span>`;
    };
    infoEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:15px;font-weight:700;letter-spacing:1px;">⏱ ${m}:${s}</span>${de ? `<span style="background:rgba(255,80,80,0.18);padding:1px 8px;border-radius:8px;font-size:10px;color:#ff8a80;border:1px solid rgba(255,80,80,0.35);">⚡双倍圣水</span>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;">
        <span style="color:#7fd4ff;">💧 你 <b>${game.elixir[0]}</b>/10</span>
        <span style="color:#ffab91;">AI <b>${game.elixir[1]}</b>/10 💧</span>
      </div>
      <div style="height:1px;background:rgba(255,255,255,0.1);margin:7px 0;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
        <span style="color:#7fd4ff;">👑 ${Math.max(0,Math.round(pt.king.hp))}</span>
        <span style="color:#7fd4ff;font-size:10px;">你的塔</span>
        <span>🏰 ${towerLine(pt.left,'#7fd4ff')} · ${towerLine(pt.right,'#7fd4ff')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-top:3px;">
        <span style="color:#ffab91;">👑 ${Math.max(0,Math.round(at.king.hp))}</span>
        <span style="color:#ffab91;font-size:10px;">AI的塔</span>
        <span>🏰 ${towerLine(at.left,'#ffab91')} · ${towerLine(at.right,'#ffab91')}</span>
      </div>
    `;
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
      // 圣水条(精致:立体珠+满水光晕)
      const isMobile = window.innerWidth <= 860;
      const orbSz = isMobile ? 11 : 14;
      const full = game.elixir[0] >= 10;
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;margin-bottom:5px;padding:4px 8px;border-radius:10px;background:rgba(12,15,30,0.6);border:1px solid rgba(255,255,255,0.08);' + (full ? 'box-shadow:0 0 12px rgba(255,80,80,0.45);' : '');
      let barHtml = '<div style="display:flex;gap:2px;flex-wrap:nowrap;">';
      for (let i = 0; i < 10; i++) {
        const filled = i < game.elixir[0];
        barHtml += `<div style="width:${orbSz}px;height:${orbSz}px;border-radius:50%;flex-shrink:0;${filled
          ? `background:radial-gradient(circle at 35% 30%, #ff8a80, #e53935 60%, #b71c1c);box-shadow:0 1px 3px rgba(0,0,0,0.5), inset 0 -2px 3px rgba(0,0,0,0.3);border:1px solid #7f1d1d;`
          : `background:radial-gradient(circle at 35% 30%, #3a4266, #262b4a);border:1px solid #1a1e38;`}"></div>`;
      }
      barHtml += `</div><div style="margin-left:6px;color:#ff8a80;font-weight:800;font-size:${orbSz+4}px;text-shadow:0 0 8px rgba(255,80,80,0.6);">${game.elixir[0]}</div>`;
      bar.innerHTML = barHtml;
      el.appendChild(bar);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;max-width:100%;';
      for (let i = 0; i < playerHand.length; i++) {
        const cardId = playerHand[i];
        const card = CR.CARDS[cardId];
        const cost = card.cost;
        const canPlay = game.elixir[0] >= cost;
        const selected = i === selectedCardIdx;
        const d = document.createElement('div');
        d.className = 'handCard';
        // 选中态:金边+上浮+光晕;不可用:暗化
        d.style.cssText = selected
          ? `border-color:#ffd54f;transform:translateY(-6px);box-shadow:0 8px 18px rgba(0,0,0,0.55), 0 0 14px rgba(255,213,79,0.35);`
          : (canPlay ? '' : 'opacity:0.45;filter:grayscale(0.5);cursor:not-allowed;');
        d.innerHTML = `
          <div class="cardName">${card.name}</div>
          <div class="cardOrb" style="background:${card.color};"></div>
          <div class="cost">💧${cost}</div>
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
      const nc = CR.CARDS[playerNext];
      const nd = document.createElement('div');
      nd.className = 'nextCard';
      nd.innerHTML = `<div class="label">下一张</div><div style="font-weight:700;color:${nc.color}">${nc.name}</div><div style="color:#ff8a80;font-weight:700;">💧${nc.cost}</div>`;
      row.appendChild(nd);
      el.appendChild(row);
    }
  }

  // 鼠标/触摸交互
  function canvasToGrid(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * CR.CANVAS_W;
    const sy = (e.clientY - rect.top) / rect.height * CR.CANVAS_H;
    return { x: sx / CR.CELL, y: sy / CR.CELL };
  }

  canvas.addEventListener('mousemove', (e) => {
    mouseGrid = canvasToGrid(e);
  });
  // 触屏:按下/移动时更新部署预览位置
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) mouseGrid = canvasToGrid(e.touches[0]);
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) mouseGrid = canvasToGrid(e.touches[0]);
  }, { passive: true });
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
