/**
 * 浮动按钮 + 面板 UI 主入口
 * 使用 Shadow DOM 隔离样式，支持拖拽定位
 * 依赖：detector.js、export-utils.js、article-panel.js、collection-panel.js
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  if (!api) return;

  const STORAGE_KEY = 'zhihu-downloader-pos';

  // ============================
  // Shadow DOM 容器
  // ============================

  const host = document.createElement('div');
  host.id = 'zhihu-downloader-host';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; top:0; left:0; width:0; height:0;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  // ============================
  // 样式
  // ============================

  const style = document.createElement('style');
  style.textContent = `
    * { margin:0; padding:0; box-sizing:border-box; }

    /* 浮动按钮 */
    .fab {
      position: fixed;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #0066ff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: box-shadow 0.2s, transform 0.2s;
      user-select: none;
      -webkit-user-select: none;
    }
    .fab:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.3); transform: scale(1.08); }
    .fab:active { cursor: grabbing; }
    .fab img { width: 28px; height: 28px; border-radius: 4px; pointer-events: none; }

    /* 面板 */
    .panel {
      position: fixed;
      width: 340px;
      max-height: 480px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      color: #1a1a2e;
      overflow: hidden;
      animation: panelIn 0.2s ease;
    }
    @keyframes panelIn {
      from { opacity: 0; transform: scale(0.95) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #f0f0f0;
    }
    .panel-title { font-size: 15px; font-weight: 600; color: #0066ff; }
    .panel-close {
      width: 24px; height: 24px;
      border: none; background: none;
      font-size: 18px; color: #999;
      cursor: pointer; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
    }
    .panel-close:hover { background: #f0f0f0; color: #333; }
    .panel-body { padding: 16px; overflow-y: auto; max-height: 400px; }

    /* 信息行 */
    .info-row { display: flex; align-items: flex-start; margin-bottom: 8px; gap: 8px; }
    .info-label { flex-shrink: 0; font-size: 12px; color: #888; min-width: 36px; padding-top: 2px; }
    .info-value { font-size: 14px; color: #333; word-break: break-word; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 12px; font-weight: 500; background: #e8f4fd; color: #0066ff;
    }
    .badge-green { background: #e8fdf0; color: #00994d; }
    .title-text { font-weight: 600; line-height: 1.4; }

    /* 选项 */
    .options { border-top: 1px solid #eee; margin: 12px 0; padding-top: 12px; }
    .option-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 0; cursor: pointer; font-size: 13px; color: #555;
    }
    .option-item input[type="checkbox"] {
      width: 16px; height: 16px; accent-color: #0066ff; cursor: pointer;
    }

    /* 进度条 */
    .progress-area { margin-top: 10px; }
    .progress-track {
      width: 100%; height: 6px; background: #e9ecef;
      border-radius: 3px; overflow: hidden;
    }
    .progress-fill {
      height: 100%; width: 0; background: #0066ff;
      border-radius: 3px; transition: width 0.3s ease;
    }
    .progress-text { font-size: 12px; color: #888; margin-top: 5px; text-align: center; }

    /* 按钮 */
    .btn {
      width: 100%; padding: 10px; margin-top: 12px;
      border: none; border-radius: 8px;
      background: #0066ff; color: #fff;
      font-size: 14px; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
    }
    .btn:hover { background: #0052cc; }
    .btn:active { background: #003d99; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }

    /* 导出模式选择 */
    .export-mode-title { font-size: 12px; color: #888; margin-bottom: 4px; }
    .export-mode label {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 0; cursor: pointer; font-size: 13px; color: #555;
    }
    .export-mode input[type="radio"] {
      width: 16px; height: 16px; accent-color: #0066ff; cursor: pointer;
    }

    /* 状态 */
    .status-msg { text-align: center; padding: 16px; color: #888; font-size: 13px; }
    .error-msg { color: #e74c3c; }
    .hidden { display: none !important; }
  `;
  shadow.appendChild(style);

  // ============================
  // 浮动按钮
  // ============================

  const fab = document.createElement('div');
  fab.className = 'fab';

  const fabIcon = document.createElement('img');
  fabIcon.src = chrome.runtime.getURL('icons/icon48.png');
  fab.appendChild(fabIcon);
  shadow.appendChild(fab);

  const savedPos = loadPosition();
  fab.style.right = `${savedPos.right}px`;
  fab.style.bottom = `${savedPos.bottom}px`;

  // 拖拽逻辑
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let fabStartRight = 0;
  let fabStartBottom = 0;
  let hasMoved = false;

  fab.addEventListener('mousedown', (e) => {
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    fabStartRight = parseInt(fab.style.right) || savedPos.right;
    fabStartBottom = parseInt(fab.style.bottom) || savedPos.bottom;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = dragStartX - e.clientX;
    const dy = dragStartY - e.clientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
    if (!hasMoved) return;

    const newRight = Math.max(0, Math.min(window.innerWidth - 50, fabStartRight + dx));
    const newBottom = Math.max(0, Math.min(window.innerHeight - 50, fabStartBottom + dy));
    fab.style.right = `${newRight}px`;
    fab.style.bottom = `${newBottom}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    if (hasMoved) {
      savePosition(parseInt(fab.style.right), parseInt(fab.style.bottom));
    }
  });

  fab.addEventListener('click', () => {
    if (hasMoved) return;
    togglePanel();
  });

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { right: 24, bottom: 100 };
  }

  function savePosition(right, bottom) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ right, bottom }));
    } catch { /* ignore */ }
  }

  // ============================
  // 面板
  // ============================

  let panel = null;

  function togglePanel() {
    if (panel) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function closePanel() {
    if (panel) {
      shadow.removeChild(panel);
      panel = null;
    }
  }

  function openPanel() {
    closePanel();

    const pageInfo = api.detectPage(window.location.href);

    panel = document.createElement('div');
    panel.className = 'panel';

    const fabRight = parseInt(fab.style.right) || 24;
    const fabBottom = parseInt(fab.style.bottom) || 100;
    panel.style.right = `${Math.max(8, fabRight - 148)}px`;
    panel.style.bottom = `${fabBottom + 56}px`;

    // header
    const header = document.createElement('div');
    header.className = 'panel-header';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = '知乎文章下载器';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // body
    const body = document.createElement('div');
    body.className = 'panel-body';
    panel.appendChild(body);

    if (!pageInfo) {
      body.innerHTML = '<div class="status-msg">当前页面不是可导出的知乎内容<br><span style="font-size:12px;color:#aaa;">支持：文章、回答、问题、想法、收藏夹</span></div>';
      shadow.appendChild(panel);
      return;
    }

    if (pageInfo.type === 'collection') {
      window.__renderCollectionPanel(body);
    } else {
      window.__renderArticlePanel(body, pageInfo);
    }

    shadow.appendChild(panel);
  }
})();
