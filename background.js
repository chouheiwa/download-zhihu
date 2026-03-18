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

  // Extension Page 请求代理：转发给知乎页面的 content script
  if (message.action === 'proxyFetch') {
    proxyFetchViaContentScript(message.url, message.options)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // 保持 sendResponse 通道
  }
});

/**
 * 找到一个知乎标签页，让其 content script 发起请求
 */
async function proxyFetchViaContentScript(url, options) {
  // 找到一个知乎标签页
  const tabs = await chrome.tabs.query({
    url: ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
  });

  if (tabs.length === 0) {
    throw new Error('请保持至少一个知乎页面打开（用于代理 API 请求）');
  }

  const tabId = tabs[0].id;

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'fetchProxy',
      url,
      options,
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('content script 无响应，请刷新知乎页面后重试'));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.data);
    });
  });
}
