// ===============================================
// 音频系统(桩)- 音乐/音效框架
//
// 现状:接口与事件订阅已就位,实际发声待接入音频资源。
// 接入方式(后续迭代):
//   1. 音频文件放 assets/sfx/*.mp3、assets/music/*.mp3
//   2. 实现 _ensureCtx/_playSfx/_playMusic 的加载与播放
//   3. settings 的 music/sfx 开关已联动(见构造函数订阅)
//
// 事件音效点已布好(发布即响):card:played/unit:killed/tower:destroyed/spell:hit/match:start/match:end
// ===============================================
import { appBus } from '../core/events.js';
import { settings } from '../core/settings.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;          // AudioContext(首次用户交互后创建)
    this._musicOn = settings.get('music');
    this._sfxOn = settings.get('sfx');

    // 设置开关联动(遮罩/设置页的开关即时生效)
    appBus.on('settings:changed', ({ key, value }) => {
      if (key === 'music') { this._musicOn = value; value ? this.resumeMusic() : this.stopMusic(); }
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

  /** 订阅一局游戏的音效事件(game.bus 生命周期与 Game 相同) */
  bindGame(bus) {
    bus.on('card:played', () => this.playSfx('deploy'));
    bus.on('unit:killed', () => this.playSfx('kill'));
    bus.on('tower:destroyed', () => this.playSfx('tower_down'));
    bus.on('spell:hit', () => this.playSfx('spell'));
    bus.on('match:end', () => this.playSfx('match_end'));
  }

  /** 播放音效(桩:静默;接入资源后按 key 查表播放) */
  playSfx(key) {
    if (!this._sfxOn) return;
    // TODO: 接入音频资源后实现
    // this._ensureCtx(); this._playSfx(key);
  }

  playMusic() {
    if (!this._musicOn) return;
    // TODO: 接入音乐资源后实现
  }
  resumeMusic() { this.playMusic(); }
  stopMusic() {
    // TODO: 接入音乐资源后实现
  }
}

// 应用级单例
export const audio = new AudioSystem();
