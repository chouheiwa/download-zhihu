/**
 * 浮动按钮 + 面板 UI
 * 使用 Shadow DOM 隔离样式，支持拖拽定位
 * 依赖：detector.js（window.__zhihuDownloader）、turndown.js、jszip.min.js、html-to-markdown.js
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  if (!api) return;

  const TYPE_LABELS = { article: '文章', answer: '回答', question: '问题', pin: '想法' };
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

  // 恢复保存的位置
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
  let panelState = {}; // DOM refs within panel

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
      panelState = {};
    }
  }

  function openPanel() {
    closePanel();

    const pageInfo = api.detectPage(window.location.href);

    panel = document.createElement('div');
    panel.className = 'panel';

    // 计算面板位置：按钮上方
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
      renderCollectionPanel(body);
    } else {
      renderArticlePanel(body, pageInfo);
    }

    shadow.appendChild(panel);
  }

  // ============================
  // 单篇面板
  // ============================

  function renderArticlePanel(body) {
    const data = api.extractContent();
    if (!data) {
      body.innerHTML = '<div class="status-msg error-msg">内容提取失败，请刷新页面后重试</div>';
      return;
    }

    const imgUrls = extractImageUrls(data.html);

    body.innerHTML = `
      <div class="info-row">
        <span class="info-label">类型</span>
        <span class="info-value"><span class="badge">${TYPE_LABELS[data.type] || data.type}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">标题</span>
        <span class="info-value title-text">${escapeHtml(data.title)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">作者</span>
        <span class="info-value">${escapeHtml(data.author)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">图片</span>
        <span class="info-value">${imgUrls.length > 0 ? imgUrls.length + ' 张' : '无'}</span>
      </div>
      <div class="options">
        <label class="option-item">
          <span>包含 Front Matter</span>
          <input type="checkbox" id="opt-fm" checked>
        </label>
        <label class="option-item">
          <span>下载图片到本地</span>
          <input type="checkbox" id="opt-img" ${imgUrls.length > 0 ? 'checked' : ''}>
        </label>
        <label class="option-item">
          <span>导出评论区</span>
          <input type="checkbox" id="opt-comment">
        </label>
      </div>
      <div id="progress-wrap" class="progress-area hidden">
        <div class="progress-track"><div id="progress-bar" class="progress-fill"></div></div>
        <div id="progress-label" class="progress-text"></div>
      </div>
      <button id="btn-dl" class="btn">${imgUrls.length > 0 ? `下载 ZIP（含 ${imgUrls.length} 张图片）` : '下载 Markdown'}</button>
    `;

    const refs = {
      btn: body.querySelector('#btn-dl'),
      optFm: body.querySelector('#opt-fm'),
      optImg: body.querySelector('#opt-img'),
      optComment: body.querySelector('#opt-comment'),
      progressWrap: body.querySelector('#progress-wrap'),
      progressBar: body.querySelector('#progress-bar'),
      progressLabel: body.querySelector('#progress-label'),
    };

    // 切换按钮文字
    function updateBtnText() {
      const wantImg = refs.optImg.checked && imgUrls.length > 0;
      const wantComment = refs.optComment.checked;
      if (wantImg && wantComment) {
        refs.btn.textContent = '下载 ZIP（含图片和评论）';
      } else if (wantImg) {
        refs.btn.textContent = `下载 ZIP（含 ${imgUrls.length} 张图片）`;
      } else if (wantComment) {
        refs.btn.textContent = '下载 ZIP（含评论）';
      } else {
        refs.btn.textContent = '下载 Markdown';
      }
    }
    refs.optImg.addEventListener('change', updateBtnText);
    refs.optComment.addEventListener('change', updateBtnText);

    refs.btn.addEventListener('click', () => handleArticleDownload(data, imgUrls, refs, updateBtnText));
  }

  async function handleArticleDownload(data, imgUrls, refs, updateBtnText) {
    refs.btn.disabled = true;

    const wantImages = refs.optImg.checked && imgUrls.length > 0;
    const wantFm = refs.optFm.checked;
    const wantComment = refs.optComment.checked;
    const baseName = sanitizeFilename(
      `${data.title}-${data.author}的${TYPE_LABELS[data.type] || data.type}`
    );
    const commentFileName = `${baseName}-评论.md`;
    const needZip = wantImages || wantComment;

    try {
      let imageMapping = {};
      let imageFiles = [];

      if (wantImages) {
        refs.btn.textContent = '正在下载图片...';
        const result = await batchDownloadImages(imgUrls, '', (done, total) => {
          showProgress(refs, done, total, `正在下载图片 ${done}/${total}`);
        });
        imageMapping = result.imageMapping;
        imageFiles = result.imageFiles;
      }

      showProgress(refs, 1, 1, '正在生成 Markdown...');
      let md = htmlToMarkdown(data.html, imageMapping);
      if (wantFm) md = buildFrontmatter(data) + md;

      // 评论
      let commentMd = '';
      let commentImageFiles = [];

      if (wantComment) {
        refs.btn.textContent = '正在加载评论...';
        const pageInfo = api.detectPage(window.location.href);
        const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
          showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
        });

        // 评论图片
        let commentImageMapping = {};
        if (wantImages && comments.length > 0) {
          let commentIdx = 0;
          const allCommentEntries = [];
          for (const c of comments) {
            commentIdx++;
            const urls = extractCommentImageUrls(c.content || '');
            if (urls.length > 0) allCommentEntries.push({ commentIdx, urls });
            for (const child of (c.child_comments || [])) {
              commentIdx++;
              const childUrls = extractCommentImageUrls(child.content || '');
              if (childUrls.length > 0) allCommentEntries.push({ commentIdx, urls: childUrls });
            }
          }
          for (const entry of allCommentEntries) {
            for (let i = 0; i < entry.urls.length; i++) {
              const url = entry.urls[i];
              const result = await downloadImage(url);
              if (result) {
                const filename = `comment_${String(entry.commentIdx).padStart(3, '0')}_${String(i + 1).padStart(3, '0')}${result.ext}`;
                commentImageMapping[url] = `images/${filename}`;
                commentImageFiles.push({ path: filename, buffer: result.buffer });
              }
            }
          }
        }

        showProgress(refs, 1, 1, '正在生成评论 Markdown...');
        commentMd = buildCommentsMarkdown(comments, data.title, commentImageMapping);

        // 文章末尾追加评论引用
        const encodedCommentFile = encodeURIComponent(commentFileName).replace(/\(/g, '%28').replace(/\)/g, '%29');
        md += `\n\n---\n\n> [查看评论区](./${encodedCommentFile})\n`;
      }

      if (needZip) {
        showProgress(refs, 1, 1, '正在打包 ZIP...');
        const zip = new JSZip();
        zip.file(`${baseName}.md`, md);
        if (wantComment) zip.file(commentFileName, commentMd);
        if (wantImages || commentImageFiles.length > 0) {
          const imagesFolder = zip.folder('images');
          for (const f of imageFiles) imagesFolder.file(f.path, f.buffer);
          for (const f of commentImageFiles) imagesFolder.file(f.path, f.buffer);
        }
        const blob = await zip.generateAsync(
          { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
          (meta) => showProgress(refs, 1, 1, `正在压缩... ${Math.round(meta.percent)}%`)
        );
        triggerDownload(blob, `${baseName}.zip`);
      } else {
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        triggerDownload(blob, `${baseName}.md`);
      }

      refs.btn.textContent = '下载成功 ✓';
      setTimeout(() => {
        refs.btn.disabled = false;
        updateBtnText();
        hideProgress(refs);
      }, 2000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  // ============================
  // 收藏夹面板
  // ============================

  function renderCollectionPanel(body) {
    const info = api.getCollectionInfo();
    if (!info) {
      body.innerHTML = '<div class="status-msg error-msg">无法识别收藏夹信息，请刷新页面</div>';
      return;
    }

    body.innerHTML = `
      <div class="info-row">
        <span class="info-label">类型</span>
        <span class="info-value"><span class="badge badge-green">收藏夹</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">名称</span>
        <span class="info-value title-text">${escapeHtml(info.title)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">数量</span>
        <span id="col-count" class="info-value">加载中...</span>
      </div>
      <div class="options">
        <label class="option-item">
          <span>包含 Front Matter</span>
          <input type="checkbox" id="col-opt-fm" checked>
        </label>
        <label class="option-item">
          <span>下载图片到本地</span>
          <input type="checkbox" id="col-opt-img" checked>
        </label>
      </div>
      <div class="export-mode">
        <div class="export-mode-title">导出方式</div>
        <label class="option-item">
          <span>导出到文件夹（推荐，省内存）</span>
          <input type="radio" name="col-export-mode" value="folder" checked>
        </label>
        <label class="option-item">
          <span>导出为 ZIP</span>
          <input type="radio" name="col-export-mode" value="zip">
        </label>
      </div>
      <div id="col-progress-wrap" class="progress-area hidden">
        <div class="progress-track"><div id="col-progress-bar" class="progress-fill"></div></div>
        <div id="col-progress-label" class="progress-text"></div>
      </div>
      <button id="btn-export" class="btn" disabled>导出整个收藏夹</button>
    `;

    const countEl = body.querySelector('#col-count');
    const refs = {
      btn: body.querySelector('#btn-export'),
      optFm: body.querySelector('#col-opt-fm'),
      optImg: body.querySelector('#col-opt-img'),
      progressWrap: body.querySelector('#col-progress-wrap'),
      progressBar: body.querySelector('#col-progress-bar'),
      progressLabel: body.querySelector('#col-progress-label'),
    };

    const getExportMode = () => body.querySelector('input[name="col-export-mode"]:checked').value;

    // 通过 API 获取真实数量
    api.fetchCollectionPage(info.apiUrl).then((result) => {
      info.itemCount = result.totals;
      countEl.textContent = `${result.totals} 篇`;
      refs.btn.disabled = false;
    }).catch(() => {
      countEl.textContent = '获取失败';
    });

    refs.btn.addEventListener('click', () => {
      if (getExportMode() === 'folder') {
        handleCollectionExportToFolder(info, refs);
      } else {
        handleCollectionExport(info, refs);
      }
    });
  }

  async function handleCollectionExport(info, refs) {
    refs.btn.disabled = true;

    try {
      // 阶段 1：加载所有内容
      refs.btn.textContent = '正在加载收藏夹...';
      const allItems = [];
      let nextUrl = info.apiUrl;
      let pageNum = 0;

      while (nextUrl) {
        pageNum++;
        showProgress(refs, 0, 1, `正在加载第 ${pageNum} 页...`);

        const result = await api.fetchCollectionPage(nextUrl);
        allItems.push(...result.items);
        showProgress(refs, allItems.length, result.totals, `已加载 ${allItems.length}/${result.totals} 篇`);
        nextUrl = result.nextUrl;
      }

      if (allItems.length === 0) throw new Error('收藏夹为空');

      const wantImages = refs.optImg.checked;
      const wantFm = refs.optFm.checked;
      const collectionName = sanitizeFilename(info.title);
      const zip = new JSZip();
      const rootFolder = zip.folder(collectionName);
      const articlesFolder = rootFolder.folder('articles');
      const imagesFolder = wantImages ? articlesFolder.folder('images') : null;
      const usedNames = new Set();
      const tocEntries = []; // 目录条目 { num, title, author, type, filename }

      // 阶段 2：逐篇转换
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const num = i + 1;
        const typeLabel = TYPE_LABELS[item.type] || item.type;

        showProgress(refs, num, allItems.length, `正在转换 ${num}/${allItems.length}: ${(item.title || '').slice(0, 15)}...`);
        refs.btn.textContent = `正在转换 ${num}/${allItems.length}...`;

        let baseName = sanitizeFilename(
          item.title
            ? `${item.title}-${item.author}的${typeLabel}`
            : `${item.author}的${typeLabel}_${num}`
        );
        if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
        usedNames.add(baseName);

        const filename = `${baseName}.md`;

        tocEntries.push({
          num,
          title: item.title || `${item.author}的${typeLabel}`,
          author: item.author,
          type: item.type,
          filename,
          url: item.url,
        });

        let imageMapping = {};

        if (wantImages && item.html) {
          const itemImgUrls = extractImageUrls(item.html);
          if (itemImgUrls.length > 0) {
            const prefix = `${String(num).padStart(3, '0')}_`;
            const result = await batchDownloadImages(itemImgUrls, prefix, null);
            imageMapping = result.imageMapping;
            for (const f of result.imageFiles) {
              imagesFolder.file(f.path, f.buffer);
            }
          }
        }

        let md = htmlToMarkdown(item.html || '', imageMapping);
        if (wantFm) md = buildFrontmatter(item) + md;
        articlesFolder.file(filename, md);
      }

      // 生成目录文件
      rootFolder.file('README.md', buildTocMarkdown(collectionName, tocEntries));

      // 阶段 3：打包
      refs.btn.textContent = '正在打包...';
      showProgress(refs, allItems.length, allItems.length, '正在压缩 ZIP...');

      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => showProgress(refs, allItems.length, allItems.length, `正在压缩... ${Math.round(meta.percent)}%`)
      );

      triggerDownload(blob, `${collectionName}.zip`);

      refs.btn.textContent = `导出成功 ✓（${allItems.length} 篇）`;
      setTimeout(() => {
        refs.btn.textContent = '导出整个收藏夹';
        refs.btn.disabled = false;
        hideProgress(refs);
      }, 3000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  // ============================
  // 收藏夹导出到文件夹（流式，低内存）
  // ============================

  async function handleCollectionExportToFolder(info, refs) {
    refs.btn.disabled = true;

    try {
      // 让用户选择目标文件夹
      let rootHandle;
      try {
        rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        // 用户取消了选择
        refs.btn.disabled = false;
        return;
      }

      const collectionName = sanitizeFilename(info.title);
      const folderHandle = await rootHandle.getDirectoryHandle(collectionName, { create: true });
      const articlesFolderHandle = await folderHandle.getDirectoryHandle('articles', { create: true });
      const wantImages = refs.optImg.checked;
      const wantFm = refs.optFm.checked;

      let imagesFolderHandle = null;
      if (wantImages) {
        imagesFolderHandle = await articlesFolderHandle.getDirectoryHandle('images', { create: true });
      }

      const usedNames = new Set();
      const tocEntries = [];
      let nextUrl = info.apiUrl;
      let pageNum = 0;
      let itemIndex = 0;
      let totalItems = info.itemCount || 0;

      // 边加载边处理，不积累所有数据
      while (nextUrl) {
        pageNum++;
        showProgress(refs, itemIndex, totalItems || 1, `正在加载第 ${pageNum} 页...`);

        const result = await api.fetchCollectionPage(nextUrl);
        if (totalItems === 0) totalItems = result.totals;
        nextUrl = result.nextUrl;

        // 逐条处理当前页的数据，处理完立即释放
        for (const item of result.items) {
          itemIndex++;
          const num = itemIndex;
          const typeLabel = TYPE_LABELS[item.type] || item.type;

          showProgress(refs, num, totalItems, `正在处理 ${num}/${totalItems}: ${(item.title || '').slice(0, 15)}...`);
          refs.btn.textContent = `正在处理 ${num}/${totalItems}...`;

          let baseName = sanitizeFilename(
            item.title
              ? `${item.title}-${item.author}的${typeLabel}`
              : `${item.author}的${typeLabel}_${num}`
          );
          if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
          usedNames.add(baseName);

          const filename = `${baseName}.md`;

          tocEntries.push({
            num,
            title: item.title || `${item.author}的${typeLabel}`,
            author: item.author,
            type: item.type,
            filename,
            url: item.url,
          });

          // 下载图片并直接写入文件夹
          let imageMapping = {};

          if (wantImages && item.html) {
            const itemImgUrls = extractImageUrls(item.html);
            if (itemImgUrls.length > 0) {
              const prefix = `${String(num).padStart(3, '0')}_`;
              const result = await batchDownloadImagestoFolder(itemImgUrls, prefix, imagesFolderHandle);
              imageMapping = result.imageMapping;
            }
          }

          // 转换并写入 markdown
          let md = htmlToMarkdown(item.html || '', imageMapping);
          if (wantFm) md = buildFrontmatter(item) + md;

          await writeTextFile(articlesFolderHandle, filename, md);
        }
        // result.items 在这里离开作用域，可被 GC 回收
      }

      if (itemIndex === 0) throw new Error('收藏夹为空');

      // 写入目录文件
      showProgress(refs, totalItems, totalItems, '正在生成目录...');
      await writeTextFile(folderHandle, 'README.md', buildTocMarkdown(collectionName, tocEntries));

      refs.btn.textContent = `导出成功 ✓（${itemIndex} 篇）`;
      setTimeout(() => {
        refs.btn.textContent = '导出整个收藏夹';
        refs.btn.disabled = false;
        hideProgress(refs);
      }, 3000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  /**
   * 下载图片并直接写入文件夹，不在内存中积累 buffer
   */
  async function batchDownloadImagestoFolder(urls, prefix, imagesFolderHandle) {
    const imageMapping = {};
    let completed = 0;
    const concurrency = 5;
    let index = 0;

    async function worker() {
      while (index < urls.length) {
        const i = index++;
        const url = urls[i];
        const result = await downloadImage(url);
        completed++;
        if (result) {
          const filename = `${prefix}${String(i + 1).padStart(3, '0')}${result.ext}`;
          imageMapping[url] = `images/${filename}`;
          // 直接写入文件系统，写完 buffer 即可被 GC
          const fileHandle = await imagesFolderHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(result.buffer);
          await writable.close();
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, urls.length) }, () => worker())
    );

    return { imageMapping };
  }

  /**
   * 向文件夹中写入文本文件
   */
  async function writeTextFile(folderHandle, filename, text) {
    const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  // ============================
  // 通用工具
  // ============================

  function showProgress(refs, current, total, text) {
    refs.progressWrap.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    refs.progressBar.style.width = `${pct}%`;
    refs.progressLabel.textContent = text;
  }

  function hideProgress(refs) {
    refs.progressWrap.classList.add('hidden');
    refs.progressBar.style.width = '0%';
  }

  function buildFrontmatter(data) {
    return [
      '---',
      `title: "${(data.title || '').replace(/"/g, '\\"')}"`,
      `author: "${(data.author || '').replace(/"/g, '\\"')}"`,
      `type: zhihu-${data.type}`,
      `source: "${data.url}"`,
      `date: "${new Date().toISOString().split('T')[0]}"`,
      '---',
      '',
    ].join('\n');
  }

  function sanitizeFilename(name) {
    return name
      .replace(/<[^>]*>/g, '')
      .replace(/[\\/:*?"<>|#^\[\]()（）]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * 生成收藏夹目录 Markdown
   */
  function buildTocMarkdown(collectionName, entries) {
    const lines = [
      `# ${collectionName}`,
      '',
      `> 共 ${entries.length} 篇，导出于 ${new Date().toISOString().split('T')[0]}`,
      '',
    ];

    for (const e of entries) {
      const typeLabel = TYPE_LABELS[e.type] || e.type;
      const encodedFilename = encodeURIComponent(e.filename).replace(/\(/g, '%28').replace(/\)/g, '%29');
      const escapedTitle = e.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      lines.push(`${e.num}. [${escapedTitle}](./articles/${encodedFilename}) - ${e.author}（${typeLabel}）`);
    }

    lines.push('');
    return lines.join('\n');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadImage(url) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      const contentType = response.headers.get('Content-Type') || '';
      const buffer = await response.arrayBuffer();
      const ext = inferImageExtension(url, contentType);
      return { buffer, ext };
    } catch {
      return null;
    }
  }

  async function batchDownloadImages(urls, prefix, onProgress, imagePathPrefix = 'images/') {
    const imageMapping = {};
    const imageFiles = [];
    let completed = 0;
    const concurrency = 5;
    let index = 0;

    async function worker() {
      while (index < urls.length) {
        const i = index++;
        const url = urls[i];
        const result = await downloadImage(url);
        completed++;
        if (onProgress) onProgress(completed, urls.length);
        if (result) {
          const filename = `${prefix}${String(i + 1).padStart(3, '0')}${result.ext}`;
          imageMapping[url] = `${imagePathPrefix}${filename}`;
          imageFiles.push({ path: filename, buffer: result.buffer });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, urls.length) }, () => worker())
    );

    return { imageMapping, imageFiles };
  }
})();
