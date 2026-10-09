/*
 * coi-sw.js —— 为 GitHub Pages 注入 COOP/COEP 响应头，启用 WebAssembly 多线程
 *
 * 【职责边界 · 重要】
 * 本文件【只做响应头注入】，不参与注册决策、不刷新页面。
 * 注册 / 模式选择 / 刷新 全部由 jieqi.html 内联的那段代码负责，
 * 它通过  ?coi=<模式>  把模式告诉本文件：
 *
 *     navigator.serviceWorker.register('./coi-sw.js?coi=require-corp', { scope:'./' })
 *
 * 早期版本本文件内含「页面上下文分支」，会自行注册 + 刷新，与 HTML 内联逻辑
 * 形成两套并行状态机，共用同一批 sessionStorage KEY，互相干扰。
 * 现该分支已删除 —— HTML 是唯一决策方，行为可预测。
 *
 * 两种模式的内核支持差异（由 HTML 决定尝试顺序）：
 *   require-corp   —— Chrome / Edge / Firefox 均支持（首选）
 *   credentialless —— 仅 Chrome / Edge；Firefox 会静默忽略，隔离不生效
 *
 * 基于 gzuidhof/coi-serviceworker 思路重写，MIT 协议。
 */
(function () {
  'use strict';

  /* ---- 模式：由 URL 查询参数指定；缺失时默认 require-corp（兼容性最广） ---- */
  var MODE = 'require-corp';
  try {
    var m = /(?:^|[?&])coi=([^&]*)/.exec(self.location.search);
    if (m && m[1]) MODE = decodeURIComponent(m[1]);
  } catch (e) {}
  var COEP = (MODE === 'credentialless') ? 'credentialless' : 'require-corp';

  /* ---- 立即接管，不等旧 SW 退出 ---- */
  self.addEventListener('install', function () { self.skipWaiting(); });
  self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

  /* ---- 支持从页面反注册（切换模式时清理旧 SW） ---- */
  self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'deregister') {
      self.registration.unregister().then(function () {
        return self.clients.matchAll();
      }).then(function (clients) {
        clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
      }).catch(function () {});
    }
  });

  /* ---- 拦截响应并注入隔离头 ---- */
  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;
    /* 避免与 only-if-cached 冲突导致注册失败 */
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

    event.respondWith(
      fetch(req).then(function (res) {
        var headers = new Headers(res.headers);
        var url = null;
        try { url = new URL(req.url); } catch (e) {}

        /* 文档响应：注入隔离头（这是启用多线程的关键） */
        if (req.mode === 'navigate' || (url && /\.html?$/i.test(url.pathname))) {
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');
          headers.set('Cross-Origin-Embedder-Policy', COEP);
        } else {
          /* 子资源：标注同源策略，保证 require-corp 下同源文件仍可加载 */
          if (url && url.origin === self.location.origin) {
            headers.set('Cross-Origin-Resource-Policy', 'same-origin');
          }
          /* 修正 wasm 的 MIME，避免流式编译失败走降级路径 */
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
      }).catch(function () {
        return Response.error();
      })
    );
  });
})();
