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

  // ===== 游戏流程状态机 =====
  // phase: 'ready'(待开始) | 'playing' | 'paused' | 'over'
  let phase = 'ready';
  const overlayEl = document.getElementById('overlay');
  const ovIcon = document.getElementById('ovIcon');
  const ovTitle = document.getElementById('ovTitle');
  const ovDesc = document.getElementById('ovDesc');
  const ovBtn = document.getElementById('ovBtn');
  const ovHint = document.getElementById('ovHint');
  const hudTimer = document.getElementById('hudTimer');
  const hudPhase = document.getElementById('hudPhase');
  const bigAnnounce = document.getElementById('bigAnnounce');
  const pauseBtn = document.getElementById('pauseBtn');
  const MATCH_TIME = 180; // 总时长(秒)

  function initGame() {
    const deckKey = document.getElementById('deckSelect').value;
    playerDeck = DECKS[deckKey].slice();
    aiLevel = parseFloat(document.getElementById('aiLevel').value);
    game = new CR.Game();
    game.onTowerDestroyedCb = (tw) => {
      const sideName = tw.side === 0 ? '你的' : 'AI的';
      const laneName = tw.lane === 'king' ? '国王塔' : (tw.lane === 'left' ? '左公主塔' : '右公主塔');
      const myCrowns = (game.towers[1].left.dead?1:0)+(game.towers[1].right.dead?1:0)+(game.towers[1].king.dead?1:0);
      const aiCrowns = (game.towers[0].left.dead?1:0)+(game.towers[0].right.dead?1:0)+(game.towers[0].king.dead?1:0);
      log(`${sideName}${laneName}被摧毁! 皇冠 ${myCrowns} : ${aiCrowns}`, tw.side === 0 ? 'ai' : 'me');
      if (tw.lane === 'king') {
        log(sideName === '你的' ? '💀 你的国王塔陨落,战斗失败!' : '🏆 AI国王塔陨落,胜利!', sideName === '你的' ? 'ai' : 'me');
      }
      // 公主塔被推:解锁区域当场闪烁提示(几秒渐隐;常驻高亮仍仅选牌时显示)
      if (tw.lane !== 'king' && renderer) {
        const isMyKill = tw.side === 1; // 敌方(玩家打掉的塔)→ 金色增益提示
        renderer.unlockFlash = {
          lane: tw.lane,                    // 'left' | 'right'
          color: isMyKill ? '255,213,79' : '255,90,79', // 金(我方解锁)/红(敌方解锁警示)
          until: performance.now() + 3200,  // 闪烁 3.2 秒
        };
        if (isMyKill) {
          announce('🔓 部署区解锁', (tw.lane === 'left' ? '左路' : '右路') + '敌方区域已开放', '#ffd54f');
          log(`🔓 ${tw.lane === 'left' ? '左' : '右'}路敌方部署区已解锁(3秒高亮,选牌时可见)`, 'sys');
        } else {
          announce('⚠️ 防线告急', '敌方解锁了你的' + (tw.lane === 'left' ? '左' : '右') + '路部署区', '#ff5a4f');
        }
      }
    };
    renderer = new CR.Renderer(canvas, game);
    ai = new CR.AI(game, playerDeck.slice());
    drawPlayerHand();
    selectedCardIdx = -1;
    logEl.innerHTML = '';
    resultEl.classList.remove('show');
    fitCanvas();
    window.scrollTo(0, 0);
  }

  function setPhase(p) {
    phase = p;
    if (p === 'ready') {
      overlayEl.classList.remove('hidden');
      ovIcon.textContent = '⚔️';
      ovTitle.textContent = '准备战斗';
      ovDesc.textContent = '选择卡组与 AI 强度后开始 · 摧毁对方国王塔获胜';
      ovBtn.textContent = '开始战斗';
      ovBtn.style.display = '';
      ovHint.style.display = '';
      pauseBtn.textContent = '⏸ 暂停';
      pauseBtn.disabled = true;
    } else if (p === 'playing') {
      overlayEl.classList.add('hidden');
      pauseBtn.disabled = false;
      pauseBtn.textContent = '⏸ 暂停';
    } else if (p === 'paused') {
      overlayEl.classList.remove('hidden');
      ovIcon.textContent = '⏸';
      ovTitle.textContent = '已暂停';
      ovDesc.textContent = '圣水已冻结,战术思考一下?';
      ovBtn.textContent = '继续战斗';
      ovBtn.style.display = '';
      ovHint.style.display = '';
      pauseBtn.textContent = '▶ 继续';
    } else if (p === 'over') {
      overlayEl.classList.add('hidden');
      pauseBtn.disabled = true;
    }
  }

  // 中央大提示
  function announce(main, sub, color) {
    bigAnnounce.innerHTML = `<div class="baMain" style="color:${color || '#ffe082'};">${main}</div>` +
      (sub ? `<div class="baSub">${sub}</div>` : '');
    bigAnnounce.classList.remove('show');
    // 强制重启动画
    void bigAnnounce.offsetWidth;
    bigAnnounce.classList.add('show');
  }

  function startGame() {
    initGame();
    lastTime = performance.now();
    setPhase('playing');
    log('战斗开始!同卡组对战:' + playerDeck.map(id=>CR.CARDS[id].name).join('、'), 'me');
    announce('战斗开始', 'BATTLE START', '#ffe082');
    // 阶段提示状态
    announcedDouble = false;
    announcedLastMinute = false;
    announcedTimeUp = false;
  }

  function togglePause() {
    if (phase === 'playing') {
      setPhase('paused');
      log('⏸ 游戏已暂停', 'sys');
    } else if (phase === 'paused') {
      lastTime = performance.now();
      setPhase('playing');
      log('▶ 继续战斗', 'sys');
    }
  }

  // 阶段提示状态
  let announcedDouble = false, announcedLastMinute = false, announcedTimeUp = false;

  // 页面不可见时自动暂停(防止后台节流导致游戏时间失真/错过操作)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') {
      togglePause();
      log('页面切到后台,游戏已自动暂停', 'sys');
    }
  });
  // 切回前台时校准时间基准(避免恢复瞬间 dt 跳变)
  window.addEventListener('focus', () => {
    if (phase === 'playing') lastTime = performance.now();
  });

  // 重新开始(任何时候可点)
  document.getElementById('restart').addEventListener('click', () => {
    setPhase('ready');
    initGame();
    // ready 态预渲染一帧战场
    drawHandUI();
    drawInfo();
    renderer.draw(null, 0);
  });
  ovBtn.addEventListener('click', () => {
    if (phase === 'ready') startGame();
    else if (phase === 'paused') togglePause();
  });
  pauseBtn.addEventListener('click', () => { if (phase === 'playing' || phase === 'paused') togglePause(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && (phase === 'playing' || phase === 'paused')) {
      e.preventDefault();
      togglePause();
    }
  });
  // 覆盖层存在时阻止 canvas 点击穿透由 CSS pointer-events 处理(overlay 覆盖全屏)
  document.getElementById('deckSelect').addEventListener('change', () => {
    // ready 态切卡组直接重建预览
    if (phase === 'ready') { initGame(); drawHandUI(); drawInfo(); renderer.draw(null, 0); }
    else if (confirm('切换卡组将重新开始,确定?')) { setPhase('ready'); initGame(); drawHandUI(); drawInfo(); renderer.draw(null, 0); }
  });

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
      if (phase === 'playing' && game) {
        game.update(dt);
        // AI 更新(按强度调整决策间隔)
        ai.thinkTimer += dt;
        const interval = 0.7 / aiLevel;
        if (ai.thinkTimer >= interval && !game.gameOver) {
          ai.thinkTimer = 0;
          ai.decide();
        }
        updateHud();
        // 阶段提示
        const remain = MATCH_TIME - game.time;
        if (!announcedDouble && game.doubleElixir) {
          announcedDouble = true;
          announce('⚡ 双倍圣水', 'DOUBLE ELIXIR', '#ff8a80');
        }
        if (!announcedLastMinute && remain <= 60) {
          announcedLastMinute = true;
          // 双倍圣水提示(120s)与本提示同时刻,错开播放避免覆盖
          setTimeout(() => { if (phase === 'playing') announce('⏰ 最后 1 分钟', 'FINAL MINUTE', '#ffe082'); }, 2800);
        }
        if (!announcedTimeUp && game.gameOver && game.time >= MATCH_TIME - 0.01) {
          announcedTimeUp = true;
          announce('⏱ 时间到!', '判定胜负…', '#eceef5');
          log('⏰ 时间到,按皇冠与塔血判定胜负', 'sys');
        }
      }
      if (game) {
        drawHandUI();
        drawInfo();
        renderer.draw(phase === 'playing' ? getPreview() : null, phase === 'playing' ? dt : 0);
      }
      if (phase === 'playing' && game && game.gameOver) {
        // 终场提示后稍作停顿再弹结算
        if (!announcedTimeUp && game.time < MATCH_TIME - 0.01) {
          // 国王塔陨落型结束(非超时)
          announce(game.winner === 0 ? '👑 国王塔陨落!' : '💥 防线崩溃!', game.winner === 0 ? 'VICTORY' : 'DEFEAT', game.winner === 0 ? '#7fd4ff' : '#ff8a80');
        }
        setTimeout(() => { if (phase !== 'over') { setPhase('over'); showResult(); } }, 1200);
        phase = 'over-wait';
      }
    } catch (e) {
      console.error('游戏循环异常:', e);
    }
    requestAnimationFrame(loop);
  }

  // HUD 倒计时更新
  function updateHud() {
    const remain = Math.max(0, MATCH_TIME - game.time);
    const m = String(Math.floor(remain/60)).padStart(2,'0');
    const s = String(Math.floor(remain%60)).padStart(2,'0');
    hudTimer.textContent = `${m}:${s}`;
    // 危险态:最后60秒变红,最后10秒脉冲
    hudTimer.classList.toggle('danger', remain <= 60);
    hudTimer.classList.toggle('pulse', remain <= 10);
    // 阶段标签
    if (game.doubleElixir) {
      hudPhase.textContent = '双倍圣水 ×2';
      hudPhase.classList.add('double');
    } else {
      hudPhase.textContent = '常规时间';
      hudPhase.classList.remove('double');
    }
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
    const remain = Math.max(0, Math.ceil(MATCH_TIME - game.time));
    const m = String(Math.floor(remain/60)).padStart(2,'0');
    const s = String(remain%60).padStart(2,'0');
    const de = game.doubleElixir ? ' <span style="color:#ff8a80;font-weight:700;">×2</span>' : '';
    const pt = game.towers[0], at = game.towers[1];
    const towerLine = (tw, color) => {
      const hp = tw.dead ? '<span style="color:#666;">✕</span>' : Math.round(tw.hp);
      return `<span style="color:${color};">${hp}</span>`;
    };
    infoEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:15px;font-weight:700;letter-spacing:1px;">⏳ 剩余 ${m}:${s}</span>${de ? `<span style="background:rgba(255,80,80,0.18);padding:1px 8px;border-radius:8px;font-size:10px;color:#ff8a80;border:1px solid rgba(255,80,80,0.35);">⚡双倍圣水</span>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;">
        <span style="color:#e07bff;">💧 你 <b>${game.elixir[0]}</b>/10</span>
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
      bar.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;margin-bottom:5px;padding:4px 8px;border-radius:10px;background:rgba(12,15,30,0.6);border:1px solid rgba(255,255,255,0.08);' + (full ? 'box-shadow:0 0 12px rgba(210,76,255,0.5);' : '');
      let barHtml = '<div style="display:flex;gap:2px;flex-wrap:nowrap;">';
      for (let i = 0; i < 10; i++) {
        const filled = i < game.elixir[0];
        barHtml += `<div style="width:${orbSz}px;height:${orbSz}px;border-radius:50%;flex-shrink:0;${filled
          ? `background:radial-gradient(circle at 35% 30%, #f2a7ff, #d24cff 55%, #8a1ec9);box-shadow:0 1px 3px rgba(0,0,0,0.5), inset 0 -2px 3px rgba(0,0,0,0.3);border:1px solid #5c1090;`
          : `background:radial-gradient(circle at 35% 30%, #3a4266, #262b4a);border:1px solid #1a1e38;`}"></div>`;
      }
      barHtml += `</div><div style="margin-left:6px;color:#e07bff;font-weight:800;font-size:${orbSz+4}px;text-shadow:0 0 8px rgba(210,76,255,0.6);">${game.elixir[0]}</div>`;
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
      nd.innerHTML = `<div class="label">下一张</div><div style="font-weight:700;color:${nc.color}">${nc.name}</div><div style="color:#e07bff;font-weight:700;">💧${nc.cost}</div>`;
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
    if (phase !== 'playing') return;
    if (selectedCardIdx < 0 || game.gameOver) return;
    const g = canvasToGrid(e);
    const cardId = playerHand[selectedCardIdx];
    const card = CR.CARDS[cardId];
    if (game.elixir[0] < card.cost) {
      flashMsg('圣水不足');
      return;
    }
    // 部署区域检查(法术可全场;推掉敌方公主塔后该侧敌方区域解锁)
    if (card.kind !== CR.KIND.SPELL) {
      if (!CR.canDeploy('player', g.x, g.y, game.towers[1])) {
        flashMsg('只能在己方半场(或已解锁区域)部署');
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

  // 启动:进入待开始状态,不自动开战
  fitCanvas();
  setPhase('ready');
  initGame();
  drawHandUI();
  drawInfo();
  renderer.draw(null, 0);
  lastTime = performance.now();
  requestAnimationFrame(loop);

})(window.CR);
