#!/usr/bin/env node
// ===============================================
// 发布前检查 - 版本同步 + SW 清单完整性 + assets-manifest 新鲜度
//
// 用法: node tools/version-check.mjs
// 每次改版本号(至少递增小版本,如 0.4.0→0.4.1)后运行,全绿再提交。
// ===============================================
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

let fail = 0;
const ok = (msg) => console.log('  ✓ ' + msg);
const bad = (msg) => { console.error('  ✗ ' + msg); fail++; };

// 1. 版本三处同步:src/version.js / sw.js / index.html 徽标默认值
const vSrc = readFileSync('src/version.js', 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
const vSw = readFileSync('sw.js', 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
const vHtml = readFileSync('index.html', 'utf8').match(/id="cvVersion"[^>]*>v?([^<]+)</)?.[1];
console.log(`版本: src=${vSrc} sw=${vSw} html=${vHtml}`);
if (!vSrc || vSrc !== vSw) bad('src/version.js 与 sw.js 版本不一致');
else ok('src/sw 版本一致');
if (vHtml && vHtml !== vSrc) bad(`index.html 徽标(${vHtml})与实际版本(${vSrc})不一致(注:页面运行时由 JS 覆写,此项仅提示)`);
// 版本号格式 x.y.z
if (!/^\d+\.\d+\.\d+$/.test(vSrc || '')) bad(`版本号格式应为 x.y.z(当前 ${vSrc})`);
else ok('版本号格式正确');

// 2. SW 模块清单 vs 实际 src 文件
const walk = (dir) => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const actual = walk('src').filter(p => p.endsWith('.js')).map(p => p.slice(4));
const swSrc = readFileSync('sw.js', 'utf8');
const listed = [...swSrc.matchAll(/'([\w/.-]+\.js)'/g)].map(m => m[1]);
const known = new Set(listed);
const missing = actual.filter(a => !known.has(a) && a !== 'main.js'); // main.js 在 CORE_ASSETS 里是完整路径 './src/main.js'
const missingMain = /'\.\/src\/main\.js'/.test(swSrc) ? [] : ['src/main.js'];
const allMissing = [...missing, ...missingMain];
if (allMissing.length) bad('SW 清单遗漏文件: ' + allMissing.join(', '));
else ok('SW 模块清单完整(' + actual.length + ' 个文件)');

// 3. assets-manifest.json 与实际资源对齐(多了无所谓,少了 SW 离线缺资源)
const bulk = walk('assets').filter(p => /\.(png|webp|ogg|mp3|wav|json)$/i.test(p) && !p.endsWith('assets/cards/.DS_Store'))
  .concat(walk('icons').filter(p => p.endsWith('.png')))
  .map(p => './' + p);
const manifest = JSON.parse(readFileSync('assets-manifest.json', 'utf8'));
const mSet = new Set(manifest);
const bulkMissing = bulk.filter(b => !mSet.has(b));
if (bulkMissing.length) {
  // 自动重生成
  writeFileSync('assets-manifest.json', JSON.stringify(bulk, null, 0));
  ok(`assets-manifest 重生成(${manifest.length} → ${bulk.length} 条)`);
} else {
  ok(`assets-manifest 新鲜(${bulk.length} 条)`);
}

// 4. sw.js 缓存名引用 APP_VERSION(防硬编码缓存名漏改)
if (/clash-v\$\{APP_VERSION\}/.test(swSrc) && /clash-core-v\$\{APP_VERSION\}/.test(swSrc)) {
  ok('SW 缓存名绑定 APP_VERSION');
} else bad('SW 缓存名未绑定 APP_VERSION(检查 CACHE/CORE 定义)');

console.log(fail === 0 ? '\n全部通过 ✓' : `\n${fail} 项未通过 ✗`);
process.exit(fail === 0 ? 0 : 1);
