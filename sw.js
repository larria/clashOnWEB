// ===============================================
// Service Worker - PWA 离线缓存 + 静默更新
//
// 策略:
//   install : 预缓存核心资源(index/css/js 模块),大体积资源后台补齐
//   fetch   : stale-while-revalidate —— 先回缓存(秒开/离线可用),
//             同时后台拉新写回缓存,下次启动即新版本
//   activate: 清理旧版本缓存
//
// 版本号 APP_VERSION 与 src/version.js 保持一致(改版本两处同改;
// 不一致时 SW 缓存仍按此处的版本换新,页面显示按它自己的,不会错乱)
//
// 更新流:页面 registration.update() 检测到新 SW → installed 状态 →
// 页面显示更新提示条 → 用户点"立即更新" → postMessage skipWaiting →
// controllerchange → reload。
// ===============================================
const APP_VERSION = '0.6.13';

const CACHE = `clash-v${APP_VERSION}`;
const CORE = `clash-core-v${APP_VERSION}`;

// 核心资源(必须完整才算安装成功)
const CORE_ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './manifest.webmanifest',
  './src/main.js',
  './libs/pixi.min.mjs',
];
// src 模块(index.html 只引 main.js,其余为 ES Modules 按需加载,
// 用显式清单列出保证离线可用)
const SRC_MODULES = [
  'version.js',
  'core/constants.js', 'core/events.js', 'core/settings.js', 'core/rng.js',
  'core/recorder.js',
  'data/cards.js',
  'game/game.js', 'game/ai.js', 'game/combat.js', 'game/spells.js',
  'game/abilities.js', 'game/unit.js', 'game/tower.js', 'game/formation.js',
  'game/projectile.js', 'game/movement.js',
  'render/renderer.js', 'render/pixilayer.js', 'render/graphics.js', 'render/cardart.js',
  'ui/hand.js', 'ui/hud.js', 'ui/gamelog.js', 'ui/deckeditor.js',
  'ui/settingsui.js', 'ui/screens.js',
  'input/input.js',
  'audio/audio.js',
];
// 大体积资源(卡图/音效):install 后台补齐,失败不阻塞
const BULK_PATTERNS = [/^\.\/assets\/cards\//, /^\.\/assets\/sfx\//, /^\.\/icons\//];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const coreCache = await caches.open(CORE);
    // 核心资源逐一缓存(全成功才激活;失败的资源让 install 失败重试)
    await coreCache.addAll(CORE_ASSETS);
    await coreCache.addAll(SRC_MODULES.map(m => './src/' + m));
    // 大体积资源后台补(不阻塞安装)
    const bulkCache = await caches.open(CACHE);
    event.waitUntil(precacheBulk(bulkCache));
  })());
});

// 枚举 bulk 资源清单(SW 无法枚举目录,借助生成好的清单文件)
async function precacheBulk(cache) {
  try {
    const res = await fetch('./assets-manifest.json', { cache: 'no-store' });
    const list = await res.json();
    await cache.addAll(list);
  } catch (e) {
    // 清单缺失/部分失败:离线时按需回源失败就失败(核心玩法不受影响)
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清理一切非当前版本的缓存
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== CORE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 只管同源

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      // stale-while-revalidate:回旧内容,后台拉新
      event.waitUntil(revalidate(req));
      return cached;
    }
    // 无缓存:网络优先,成功则写回(导航请求失败时回退缓存首页)
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(pickCache(url.pathname));
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      if (req.mode === 'navigate') {
        const index = await caches.match('./index.html');
        if (index) return index;
      }
      throw e;
    }
  })());
});

async function revalidate(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const url = new URL(req.url);
      const cache = await caches.open(pickCache(url.pathname));
      await cache.put(req, fresh.clone());
    }
  } catch (e) { /* 离线:保留旧缓存 */ }
}

function pickCache(pathname) {
  return BULK_PATTERNS.some(p => p.test('.' + pathname)) ? CACHE : CORE;
}

// 版本更新流:页面侧 registration.update() 检测到新 SW 后自行
// 监听 statechange 提示用户;用户确认后发 skip-waiting
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
