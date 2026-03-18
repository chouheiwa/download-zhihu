/**
 * 收藏夹/专栏面板（简化版）
 * 只展示基本信息 + 跳转到 Extension Page 导出管理器
 * 依赖：detector.js、export-utils.js
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  const u = window.__exportUtils;

  function renderCollectionPanel(body) {
    const info = api.getCollectionInfo();
    if (!info) {
      body.innerHTML = '<div class="status-msg error-msg">无法识别收藏夹信息，请刷新页面</div>';
      return;
    }
    renderPanel(body, info, '收藏夹', 'collection');
  }

  function renderColumnPanel(body) {
    const info = api.getColumnInfo();
    if (!info) {
      body.innerHTML = '<div class="status-msg error-msg">无法识别专栏信息，请刷新页面</div>';
      return;
    }
    renderPanel(body, info, '专栏', 'column');
  }

  function renderPanel(body, info, typeLabel, sourceType) {
    body.innerHTML = `
      <div class="info-row">
        <span class="info-label">类型</span>
        <span class="info-value"><span class="badge badge-green">${typeLabel}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">名称</span>
        <span class="info-value title-text">${u.escapeHtml(info.title)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">数量</span>
        <span id="col-count" class="info-value">加载中...</span>
      </div>
      <button id="btn-open-manager" class="btn" disabled>打开导出管理器</button>
    `;

    const countEl = body.querySelector('#col-count');
    const btn = body.querySelector('#btn-open-manager');

    const fetchPage = sourceType === 'column' ? api.fetchColumnPage : api.fetchCollectionPage;
    fetchPage(info.apiUrl).then((result) => {
      info.itemCount = result.totals;
      countEl.textContent = `${result.totals} 篇`;
      btn.disabled = false;
    }).catch(() => {
      countEl.textContent = '获取失败';
    });

    btn.addEventListener('click', () => {
      const exportUrl = chrome.runtime.getURL(
        `export/export.html?id=${encodeURIComponent(info.id)}&name=${encodeURIComponent(info.title)}&api=${encodeURIComponent(info.apiUrl)}&source=${sourceType}`
      );
      chrome.runtime.sendMessage({ action: 'openExportPage', url: exportUrl });
    });
  }

  window.__renderCollectionPanel = renderCollectionPanel;
  window.__renderColumnPanel = renderColumnPanel;
})();
