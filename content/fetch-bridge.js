/**
 * 页面 JS 上下文桥接脚本
 * 通过 <script src> 注入到页面，在页面的 JS 环境中执行
 * 这样 fetch() 调用会经过知乎的请求拦截器，自动带上 x-zse 签名头
 */

(function() {
  'use strict';

  window.addEventListener('__zhihu_dl_fetch_request', async function(e) {
    var detail = e.detail;
    try {
      var response = await fetch(detail.url, {
        credentials: 'include',
      });
      var data = null;
      var error = null;
      if (response.ok) {
        data = await response.json();
      } else {
        error = 'HTTP ' + response.status;
      }
      window.dispatchEvent(new CustomEvent('__zhihu_dl_fetch_response', {
        detail: { id: detail.id, data: data, error: error }
      }));
    } catch(err) {
      window.dispatchEvent(new CustomEvent('__zhihu_dl_fetch_response', {
        detail: { id: detail.id, data: null, error: err.message }
      }));
    }
  });
})();
