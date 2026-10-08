/*
 * coi-sw.js — 让 GitHub Pages 也能拿到 COOP/COEP，从而启用 WebAssembly 多线程
 *
 * 用法：在 jieqi.html 的 <head> 里加一行
 *   <script src="./coi-sw.js"></script>
 * （必须同源独立文件，不能内嵌进 HTML，也不能从 CDN 加载）
 *
 * 工作原理：
 *   1) 页面上下文：发现 crossOriginIsolated 为 false → 注册本文件为 Service Worker
 *   2) 注册成功后刷新一次页面（首次访问会刷新，之后不再刷新）
 *   3) SW 上下文：拦截所有响应，注入 COOP / COEP 头 → 隔离生效
 *   4) 隔离仍失败时，自动从 credentialless 降级到 require-corp 再试一次
 *
 * 基于 gzuidhof/coi-serviceworker 思路重写，MIT 协议。
 */
(function () {
  'use strict';

  var KEY_TRIED = 'jieqi-coi-tried';      // 已尝试过的模式列表
  var KEY_MODE  = 'jieqi-coi-mode';       // 当前使用的模式

  /* ==========================================================
     分支一：运行在页面上下文（被 <script src> 加载）
     ========================================================== */
  if (typeof window !== 'undefined' && window.document) {
    // 已经隔离成功，什么都不用做
    if (window.crossOriginIsolated === true) return;

    // 不支持 Service Worker，或不是安全上下文（file:// 或无 HTTPS）→ 放弃
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    var tried = [];
    try { tried = JSON.parse(sessionStorage.getItem(KEY_TRIED) || '[]'); } catch (e) { tried = []; }
    if (!Array.isArray(tried)) tried = [];

    var ORDER = ['credentialless', 'require-corp'];
    var mode = ORDER[0];
    for (var i = 0; i < ORDER.length; i++) {
      if (tried.indexOf(ORDER[i]) < 0) { mode = ORDER[i]; break; }
    }
    // 两种都试过了还失败 → 彻底放弃（保持单线程，游戏照常可玩）
    if (tried.length >= ORDER.length) {
      if (window.console && console.info) {
        console.info('[coi] 两种隔离模式均未能生效，保持单线程运行');
      }
      return;
    }
    try { sessionStorage.setItem(KEY_MODE, mode); } catch (e) {}

    var swUrl = './coi-sw.js?coi=' + encodeURIComponent(mode);
    navigator.serviceWorker.register(swUrl, { scope: './' }).then(function (reg) {
      // 已经受控但隔离仍失败 → 说明当前模式无效，记下来并刷新换下一种
      if (navigator.serviceWorker.controller) {
        markTried(mode);
        if (tried.length + 1 < ORDER.length) {
          safeReload();
        }
        return;
      }
      // 首次注册：SW 尚未接管页面，刷新一次让它生效
      if (window.console && console.info) {
        console.info('[coi] Service Worker 已注册，正在刷新以启用隔离（模式：' + mode + '）');
      }
      safeReload();
    }).catch(function (err) {
      if (window.console && console.warn) {
        console.warn('[coi] Service Worker 注册失败：', err && err.message);
      }
    });

    function markTried(m) {
      var t = [];
      try { t = JSON.parse(sessionStorage.getItem(KEY_TRIED) || '[]'); } catch (e) { t = []; }
      if (t.indexOf(m) < 0) t.push(m);
      try { sessionStorage.setItem(KEY_TRIED, JSON.stringify(t)); } catch (e) {}
    }
    function safeReload() {
      // 防抖：2 秒内不重复刷新，避免死循环
      var last = 0;
      try { last = parseInt(sessionStorage.getItem('jieqi-coi-reload-at') || '0', 10); } catch (e) {}
      var now = Date.now();
      if (now - last < 2000) return;
      try { sessionStorage.setItem('jieqi-coi-reload-at', String(now)); } catch (e) {}
      setTimeout(function () { window.location.reload(); }, 60);
    }
    return;
  }

  /* ==========================================================
     分支二：运行在 Service Worker 上下文
     ========================================================== */
  var MODE = 'credentialless';
  try {
    var m = /(?:^|[?&])coi=([^&]*)/.exec(self.location.search);
    if (m && m[1]) MODE = decodeURIComponent(m[1]);
  } catch (e) {}

  var COEP = (MODE === 'require-corp') ? 'require-corp' : 'credentialless';

  self.addEventListener('install', function () {
    self.skipWaiting();
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'deregister') {
      self.registration.unregister().then(function () {
        self.clients.matchAll().then(function (clients) {
          clients.forEach(function (c) { c.navigate(c.url); });
        });
      });
    }
  });

  self.addEventListener('fetch', function (event) {
    var req = event.request;
    // 只处理 GET
    if (req.method !== 'GET') return;
    // 避免与 only-if-cached 冲突
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

    event.respondWith(
      fetch(req).then(function (res) {
        var headers = new Headers(res.headers);
        var url = '';
        try { url = new URL(req.url); } catch (e) {}

        if (req.mode === 'navigate' || (url && url.pathname && /\.html?$/i.test(url.pathname))) {
          // 文档响应：注入隔离头
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Embedder-Policy', COEP);
        } else {
          // 子资源：标注同源资源策略，保证 require-corp 下也能加载
          if (url && url.origin === self.location.origin) {
            headers.set('Cross-Origin-Resource-Policy', 'same-origin');
          }
          // 顺手修正 wasm 的 MIME，避免流式编译失败
          if (url && /\.wasm$/i.test(url.pathname)) {
            var ct = headers.get('Content-Type') || '';
            if (ct.indexOf('application/wasm') < 0) headers.set('Content-Type', 'application/wasm');
          }
        }

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: headers
        });
      }).catch(function (err) {
        // 网络失败时透传，让页面自己的错误处理接管
        return Response.error();
      })
    );
  });
})();
