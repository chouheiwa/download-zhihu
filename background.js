/**
 * Service Worker：消息中转
 * 1. content script → 打开导出页面
 * 2. Extension Page → content script 代理 API 请求（保持同源）
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openExportPage') {
    chrome.tabs.create({ url: message.url });
    return;
  }

  if (message.action === 'injectDocxLibs') {
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          files: ['lib/docx.min.js', 'lib/temml.min.js', 'lib/mathml2omml.min.js', 'lib/html-to-docx.js'],
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // Extension Page 请求代理
  if (message.action === 'proxyFetch') {
    if (message.responseType === 'text') {
      // 文本请求（如获取页面 HTML）：service worker 直接 fetch，不受 CORS 限制
      fetch(message.url, { credentials: 'include' })
        .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    } else {
      // JSON API 请求：转发给知乎页面的 content script（需要 x-zse 签名）
      proxyFetchViaContentScript(message.url, message.options, message.responseType)
        .then((result) => sendResponse({ ok: true, data: result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
    }
    return true; // 保持 sendResponse 通道
  }
});

/**
 * 找到一个知乎标签页，让其 content script 发起请求
 */
async function proxyFetchViaContentScript(url, options, responseType) {
  // 找到所有知乎标签页
  const tabs = await chrome.tabs.query({
    url: ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
  });

  if (tabs.length === 0) {
    throw new Error('请保持至少一个知乎页面打开（用于代理 API 请求）');
  }

  // 逐个尝试，直到有一个 content script 能响应
  for (const tab of tabs) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'fetchProxy',
          url,
          options,
          responseType,
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('content script 无响应'));
            return;
          }
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.data);
        });
      });
    } catch {
      // 该标签页失败，尝试下一个
      continue;
    }
  }

  throw new Error(`所有知乎页面均无法连接（共 ${tabs.length} 个标签页），请刷新任意一个知乎页面后重试`);
}
