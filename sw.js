/*
 * jili-game Service Worker
 * 设计原则：网络优先（network-first），永不锁版本。
 * - 平时联网：永远从网络取最新版，你改一版 GitHub，用户立刻看到新版。
 * - 断网时：才用缓存兜底，保证离线能打开。
 * - 缓存名固定为 'jili-pwa'，永不改名，所以你以后改版完全不用碰这个文件。
 * - sw.js 自身和 manifest.json 永不缓存，浏览器每次都会检查更新。
 */
const CACHE = 'jili-pwa';
const PRECACHE = ['./jili-game.html', './manifest.json'];

self.addEventListener('install', function (e) {
  // 立即接管，不等旧 SW 释放 —— 避免"等半天才更新"
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .catch(function () { /* 预缓存失败不影响主流程 */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    // 清理历史遗留的其它缓存名（只保留固定名 jili-pwa）
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

// 网络优先：先请求网络，成功则写缓存；失败才回退缓存
async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try { c.put(req, res.clone()); } catch (_) {}
    }
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    // 断网打开页面时的兜底：回退到平台主页
    if (req.mode === 'navigate') {
      const fallback = await c.match('./jili-game.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u;
  try { u = new URL(req.url); } catch (_) { return; }
  // 只处理同源请求，第三方资源（如 raw.githubusercontent 图标）不拦截
  if (u.origin !== self.location.origin) return;

  // sw.js 与 manifest.json 自身：永远走网络，保证随时能更新
  if (u.pathname.endsWith('/sw.js') || u.pathname.endsWith('/manifest.json')) {
    e.respondWith(fetch(req).catch(function () { return caches.match(req); }));
    return;
  }

  e.respondWith(networkFirst(req));
});

// 支持 ?sw=off 一键彻底注销（应急开关，正常用不到）
self.addEventListener('message', function (e) {
  if (e.data === 'SKIP') self.skipWaiting();
});
