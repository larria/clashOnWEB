// ===============================================
// 种子随机数 - 可重放对局的前提
// 引擎内所有随机必须走注入的 RNG(不允许直接 Math.random),
// 这样"初始 seed + 出牌脚本"即可确定性重放整局。
//
// mulberry32:体积极小、速度快、分布足够好(游戏洗牌用,非加密场景)
// ===============================================

/** 创建种子 PRNG;不传 seed 用一次性随机种子(真随机开局,但种子会被记录) */
export function makeRng(seed) {
  let a = (seed == null ? (Math.random() * 0xffffffff) >>> 0 : seed >>> 0);
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = a;
  return rng;
}

/** 用 rng 洗牌(Fisher-Yates;与原 Math.random 版语义一致) */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
