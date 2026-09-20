// ===============================================
// 音频系统 - WebAudio 实装
//
// 资源:assets/sfx/*.ogg(原版游戏提取,89 个)
// 三层 API:
//   audio.play('deploy_knight')     按名播放音效(未加载完自动忽略)
//   audio.bindGame(bus)             订阅一局游戏的领域事件
//   audio.playMusic()/stopMusic()   战斗音乐循环
//
// 节流:同类音效 80ms 内只播一次(群体攻击不炸耳);攻击音效全局每秒限次。
// 音量:音乐 0.35 / 音效 0.55(可按需再接 settings)。
// ===============================================
import { appBus } from '../core/events.js';
import { settings } from '../core/settings.js';

const SFX_VOLUME = 0.55;
const MUSIC_VOLUME = 0.35;

// 声明资源(加载懒触发:首次播放该名字时 fetch 解码)
const SFX_FILES = [
  // 部署(卡牌专属)
  'deploy_knight','deploy_archers','deploy_goblins','deploy_spearGoblins','deploy_skeletons',
  'deploy_minions','deploy_barbarians','deploy_bomber','deploy_giant','deploy_miniPekka',
  'deploy_musketeer','deploy_valkyrie','deploy_hogRider','deploy_wizard','deploy_pekka',
  'deploy_prince','deploy_babyDragon','deploy_skeletonArmy','deploy_witch','deploy_balloon',
  'deploy_giantSkeleton','deploy_golem','deploy_minionHorde','deploy_cannon','deploy_tesla',
  'deploy_infernoTower','deploy_bombTower','deploy_goblinHut','deploy_barbarianHut',
  'deploy_tombstone','deploy_elixirCollector','deploy_xbow','deploy_mortar',
  // 攻击(卡牌专属)
  'atk_knight','atk_archers','atk_goblins','atk_spearGoblins','atk_skeletons','atk_minions',
  'atk_barbarians','atk_bomber','atk_giant','atk_miniPekka','atk_musketeer','atk_valkyrie',
  'atk_hogRider','atk_wizard','atk_pekka','atk_prince','atk_babyDragon','atk_skeletonArmy',
  'atk_witch','atk_balloon','atk_giantSkeleton','atk_golem','atk_minionHorde','atk_cannon',
  'atk_tesla','atk_infernoTower','atk_bombTower','atk_xbow','atk_mortar',
  // 法术
  'spell_fireball','spell_arrows','spell_rocket','spell_lightning','spell_zap',
  'spell_rage','spell_freeze','spell_mirror',
  // 塔
  'tower_fire','king_fire','king_activate','tower_destroyed','princess_destroyed',
  // 通用
  'battle_start','battle_end_horn','victory','defeat','crown_get','elixir_double',
  'warn_60s','unit_die','unit_die_big','enemy_deploy','card_select','ui_click',
  'elixir_collect',
  // 音乐
  'music_battle',
];

class AudioSystem {
  constructor() {
    this.ctx = null;
    this._buffers = new Map();   // name -> AudioBuffer
    this._loading = new Set();   // 加载中
    this._lastPlay = new Map();  // name -> timestamp(节流)
    this._musicSource = null;
    this._musicGain = null;
    this._musicOn = settings.get('music');
    this._sfxOn = settings.get('sfx');
    this._gameBus = null;

    // 设置开关联动
    appBus.on('settings:changed', ({ key, value }) => {
      if (key === 'music') { this._musicOn = value; value ? this.playMusic() : this.stopMusic(); }
      if (key === 'sfx') this._sfxOn = value;
    });
  }

  /** 首次用户交互时调用(浏览器自动播放策略) */
  unlock() {
    this._ensureCtx();
  }

  _ensureCtx() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _load(name) {
    if (this._buffers.has(name) || this._loading.has(name)) return;
    this._loading.add(name);
    fetch(`assets/sfx/${name}.ogg`)
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then(ab => this._ensureCtx().decodeAudioData(ab))
      .then(buf => { this._buffers.set(name, buf); })
      .catch(() => { /* 缺资源静默 */ })
      .finally(() => this._loading.delete(name));
  }

  /** 播放音效。opts: { volume, throttle(ms,默认80) } */
  play(name, opts = {}) {
    if (!this._sfxOn || !name) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    this._load(name);
    const buf = this._buffers.get(name);
    if (!buf) return;
    // 节流:同名音效 80ms 内不重复(默认)
    const throttle = opts.throttle != null ? opts.throttle : 80;
    const now = performance.now();
    const last = this._lastPlay.get(name) || 0;
    if (now - last < throttle) return;
    this._lastPlay.set(name, now);
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = (opts.volume != null ? opts.volume : 1) * SFX_VOLUME;
      src.connect(gain).connect(ctx.destination);
      src.start();
    } catch (e) { /* 播放失败静默 */ }
  }

  // ===== 战斗音乐 =====
  playMusic() {
    if (!this._musicOn) return;
    const ctx = this._ensureCtx();
    if (!ctx || this._musicSource) return;
    this._load('music_battle');
    const buf = this._buffers.get('music_battle');
    if (!buf) {
      // 未加载完:等一下再试(加载完成回调里没有钩子,轮询一次)
      setTimeout(() => this.playMusic(), 500);
      return;
    }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = MUSIC_VOLUME;
      src.connect(gain).connect(ctx.destination);
      src.start();
      this._musicSource = src;
      this._musicGain = gain;
    } catch (e) { /* 静默 */ }
  }

  stopMusic() {
    if (this._musicSource) {
      try { this._musicSource.stop(); } catch (e) { /* 静默 */ }
      this._musicSource = null;
    }
  }

  /** 订阅一局游戏的领域事件(每局新 bus) */
  bindGame(bus) {
    this._gameBus = bus;

    // 出牌:玩家用卡牌专属部署音,AI 用敌方部署音
    bus.on('card:played', ({ side, cardId, kind }) => {
      if (side === 0) {
        if (kind === 'spell') return; // 法术音在 spell:hit 播(命中才有意义)
        this.play('deploy_' + cardId, { throttle: 150 });
      } else {
        this.play('enemy_deploy', { throttle: 250 });
      }
    });

    // 法术命中:按法术播专属音
    bus.on('spell:hit', ({ cardId }) => {
      this.play('spell_' + cardId, { throttle: 120, volume: 1.1 });
    });

    // 圣水收集器产费(玩家侧才播,别帮对手配音)
    bus.on('elixir:produced', ({ side }) => {
      if (side === 0) this.play('elixir_collect', { throttle: 400, volume: 0.6 });
    });

    // 单位攻击:attacker 为单位时播卡牌攻击音;塔攻击播塔音
    bus.on('unit:attack', ({ attacker, isTower, isKing }) => {
      if (isTower) {
        this.play(isKing ? 'king_fire' : 'tower_fire', { throttle: 150, volume: 0.7 });
      } else if (attacker && attacker.cardId) {
        this.play('atk_' + attacker.cardId, { throttle: 120, volume: 0.8 });
      }
    });

    // 单位死亡:高费大单位用大死亡音,杂兵用短音(节流防刷屏)
    bus.on('unit:killed', ({ unit }) => {
      if (!unit || !unit.card) return;
      if (unit.card.cost >= 5 || unit.isBuilding) {
        this.play('unit_die_big', { throttle: 200 });
      } else {
        this.play('unit_die', { throttle: 300, volume: 0.6 });
      }
    });

    // 塔:受击/激活/被毁
    bus.on('tower:damaged', () => { /* 受击太频繁,不播(攻击音已覆盖) */ });
    bus.on('king:activated', () => this.play('king_activate'));
    bus.on('tower:destroyed', ({ tower }) => {
      if (tower.lane === 'king') this.play('tower_destroyed');
      else { this.play('princess_destroyed'); this.play('crown_get', { throttle: 0 }); }
    });

    // 对局:开始/双倍圣水/终局/最后警告
    bus.on('match:phase', ({ phase }) => {
      if (phase === 'double_elixir') this.play('elixir_double');
      if (phase === 'last_minute') this.play('warn_60s');
    });
    bus.on('match:end', ({ winner }) => {
      this.stopMusic();
      this.play('battle_end_horn');
      setTimeout(() => this.play(winner === 0 ? 'victory' : (winner === 1 ? 'defeat' : 'crown_get')), 800);
    });
  }

  /** UI 音(选牌/按钮,直接调用) */
  cardSelect() { this.play('card_select'); }
  uiClick() { this.play('ui_click'); }
}

// 应用级单例
export const audio = new AudioSystem();
