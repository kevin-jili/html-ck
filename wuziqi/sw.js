/* 五子棋 · Service Worker（离线支持）
   策略：
   - 页面/同源资源：network-first（优先取最新，断网回落缓存）
   - 引擎/组件等跨域资源：cache-first（下一次起永久秒开）
   - 带 ?_cb= 的请求不缓存（删除引擎功能靠它做真下载测试）
*/
var CACHE = 'gomoku-v5.92.0';
var PRECACHE = ['./wuziqi.html', './manifest.json'];
var ASSET_HOSTS = ['jsdelivr.net', 'githubusercontent.com', 'github.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    Promise.all(PRECACHE.map(function (u) {
      return caches.open(CACHE)
        .then(function (c) { return c.add(new Request(u, { cache: 'reload' })); })
        .catch(function () {});
    })).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function cacheable(res) {
  return res && res.ok && (res.type === 'basic' || res.type === 'cors');
}
function store(req, res) {
  try {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
  } catch (e) {}
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 跨域静态资源（引擎 rapfi / 联机组件 peerjs / 更新正文）：缓存优先
  var isAsset = false;
  for (var i = 0; i < ASSET_HOSTS.length; i++) {
    if (url.hostname.indexOf(ASSET_HOSTS[i]) >= 0) { isAsset = true; break; }
  }
  if (isAsset) {
    if (url.search.indexOf('_cb=') >= 0) return; // 破缓存测试，交给网络
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (cacheable(res)) store(req, res);
          return res;
        });
      })
    );
    return;
  }

  // 导航请求 / 同源资源：网络优先，断网回落
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (cacheable(res)) store(req, res);
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./wuziqi.html');
        });
      })
    );
  }
});
