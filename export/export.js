/**
 * 导出管理器 Extension Page 主逻辑
 * 依赖：zhihu-api.js, progress.js, export-utils.js, html-to-markdown.js
 */

(() => {
  'use strict';

  const api = window.__zhihuApi;
  const progress = window.__progress;
  const u = window.__exportUtils;
  const { htmlToMarkdown, extractImageUrls, buildCommentsMarkdown } = window;

  const PAGE_SIZE = 20; // 知乎 API 每页返回条目数

  // ============================
  // URL 参数解析
  // ============================

  const params = new URLSearchParams(window.location.search);
  const collectionId = params.get('id') || '';
  const collectionName = params.get('name') || '未知收藏夹';
  const collectionApiUrl = params.get('api') || '';

  // ============================
  // DOM 引用
  // ============================

  const els = {
    collectionName: document.getElementById('collection-name'),
    folderPath: document.getElementById('folder-path'),
    btnSelectFolder: document.getElementById('btn-select-folder'),
    articleStatus: document.getElementById('article-status'),
    articleBatchSize: document.getElementById('article-batch-size'),
    optImg: document.getElementById('opt-img'),
    articleProgressWrap: document.getElementById('article-progress-wrap'),
    articleProgress: document.getElementById('article-progress'),
    articleProgressText: document.getElementById('article-progress-text'),
    btnExportArticles: document.getElementById('btn-export-articles'),
    commentStatus: document.getElementById('comment-status'),
    commentProgressWrap: document.getElementById('comment-progress-wrap'),
    commentProgress: document.getElementById('comment-progress'),
    commentProgressText: document.getElementById('comment-progress-text'),
    btnExportComments: document.getElementById('btn-export-comments'),
    logOutput: document.getElementById('log-output'),
  };

  // ============================
  // 状态
  // ============================

  let dirHandle = null;
  let progressData = null;
  let currentTotal = 0;
  let cachedItems = null; // 缓存收藏夹全部条目，避免重复加载
  let isExportingArticles = false;
  let isExportingComments = false;

  // ============================
  // 日志
  // ============================

  function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    const typeClass = type === 'info' ? '' : `log-${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span><span class="${typeClass}">${message}</span>`;
    els.logOutput.appendChild(entry);
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }

  // ============================
  // 节流回调
  // ============================

  window.__throttle.setOnRetry((attempt, max, waitMs) => {
    const seconds = Math.round(waitMs / 1000);
    log(`请求被限制，等待 ${seconds} 秒后重试（${attempt}/${max}）...`, 'warn');
  });

  // ============================
  // 目录缓存（chrome.storage.local）
  // ============================

  const CACHE_KEY = `dir_${collectionId}`;

  /**
   * 加载目录：有缓存直接用，没有才从 API 拉取
   */
  async function loadDirectory() {
    // 尝试读缓存
    try {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const cached = stored[CACHE_KEY]?.items;
      if (cached && cached.length > 0) {
        currentTotal = cached.length;
        log(`从缓存加载目录（${cached.length} 篇）`);
        return cached;
      }
    } catch { /* 缓存读取失败 */ }

    // 无缓存，从 API 拉取
    return await fetchDirectoryFromAPI();
  }

  /**
   * 从 API 拉取完整目录并写入缓存
   */
  async function fetchDirectoryFromAPI() {
    log('正在从 API 加载收藏夹目录...');
    const items = [];
    let nextPageUrl = collectionApiUrl;
    let pageNum = 0;

    while (nextPageUrl) {
      pageNum++;
      showArticleProgress(0, 1, `正在加载第 ${pageNum} 页目录...`);

      let result;
      try {
        result = await api.fetchCollectionPage(nextPageUrl);
      } catch (err) {
        log(`加载目录失败: ${err.message}`, 'error');
        return null;
      }

      items.push(...result.items);
      nextPageUrl = result.nextUrl;
    }

    if (items.length === 0) return null;

    // 按收藏时间升序
    items.sort((a, b) => (a.created_time || 0) - (b.created_time || 0));
    currentTotal = items.length;
    log(`目录加载完成，共 ${items.length} 篇`);

    // 写入缓存
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: { items } });
      log('目录已缓存');
    } catch {
      log('缓存写入失败（数据量过大），不影响使用', 'warn');
    }

    return items;
  }

  /**
   * 刷新目录：重新从 API 拉取，合并缓存中的 html 内容
   */
  async function refreshDirectory() {
    const oldCache = cachedItems || [];
    const freshItems = await fetchDirectoryFromAPI();
    if (!freshItems) return;

    // 用旧缓存的 html 补充新数据中缺失的内容
    if (oldCache.length > 0) {
      const oldMap = new Map();
      for (const item of oldCache) {
        if (item.id) oldMap.set(item.id, item);
      }
      for (const item of freshItems) {
        const old = item.id ? oldMap.get(item.id) : null;
        if (old && !item.html && old.html) {
          item.html = old.html;
        }
      }

      const diff = freshItems.length - oldCache.length;
      if (diff > 0) log(`发现 ${diff} 篇新增内容`, 'success');
      else if (diff < 0) log(`收藏夹减少了 ${-diff} 篇`, 'warn');
      else log('目录无变化');
    }

    cachedItems = freshItems;
    hideArticleProgress();
    updateUI();
  }

  // ============================
  // 进度条辅助
  // ============================

  function showArticleProgress(current, total, text) {
    els.articleProgressWrap.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    els.articleProgress.value = pct;
    els.articleProgress.max = 100;
    els.articleProgressText.textContent = text;
    const fill = document.getElementById('article-progress-fill');
    if (fill) fill.style.width = `${pct}%`;
  }

  function hideArticleProgress() {
    els.articleProgressWrap.classList.add('hidden');
    const fill = document.getElementById('article-progress-fill');
    if (fill) fill.style.width = '0%';
  }

  function showCommentProgress(current, total, text) {
    els.commentProgressWrap.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    els.commentProgress.value = pct;
    els.commentProgress.max = 100;
    els.commentProgressText.textContent = text;
    const fill = document.getElementById('comment-progress-fill');
    if (fill) fill.style.width = `${pct}%`;
  }

  function hideCommentProgress() {
    els.commentProgressWrap.classList.add('hidden');
    const fill = document.getElementById('comment-progress-fill');
    if (fill) fill.style.width = '0%';
  }

  // ============================
  // 初始化
  // ============================

  function init() {
    els.collectionName.textContent = `收藏夹：${collectionName}`;
    document.title = `导出管理器 - ${collectionName}`;

    els.btnSelectFolder.addEventListener('click', handleSelectFolder);
    els.btnExportArticles.addEventListener('click', handleExportArticles);
    els.btnExportComments.addEventListener('click', handleExportComments);
    document.getElementById('btn-refresh-dir').addEventListener('click', refreshDirectory);

    log(`已加载收藏夹：${collectionName}（ID: ${collectionId}）`);

    // 页面打开时就加载目录
    loadDirectoryOnInit();
  }

  async function loadDirectoryOnInit() {
    try {
      cachedItems = await loadDirectory();
      updateUI();
    } catch (err) {
      log(`加载目录失败: ${err.message}`, 'error');
    }
  }

  // ============================
  // 文件夹选择
  // ============================

  async function handleSelectFolder() {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      els.folderPath.textContent = dirHandle.name;
      log(`已选择文件夹：${dirHandle.name}`);

      progressData = await progress.readProgress(dirHandle);

      if (progressData) {
        // 验证进度文件属于当前收藏夹
        if (progressData.collectionId && progressData.collectionId !== collectionId) {
          log(`进度文件属于其他收藏夹（${progressData.collectionName || progressData.collectionId}），将创建新的进度`, 'warn');
          progressData = progress.createInitialProgress(collectionId, collectionName);
        } else {
          if (progressData.articles.batchSize) {
            els.articleBatchSize.value = progressData.articles.batchSize;
          }
        }
      } else {
        progressData = progress.createInitialProgress(collectionId, collectionName);
        log('未找到进度文件，将从头开始导出');
      }

      // 扫描实际文件校准计数（进度文件计数器可能漂移）
      await reconcileProgress();

      // 加载目录（评论列表需要文章数据）
      if (!cachedItems) {
        cachedItems = await loadDirectory();
      }

      log(`已导出 ${progressData.articles.totalExported} 篇文章、${progressData.comments.totalExported} 篇评论`);
      updateUI();
    } catch (err) {
      if (err.name !== 'AbortError') {
        log(`选择文件夹失败: ${err.message}`, 'error');
      }
    }
  }

  // ============================
  // 文件扫描校准进度
  // ============================

  async function reconcileProgress() {
    if (!dirHandle || !progressData) return;

    try {
      const folderName = u.sanitizeFilename(collectionName);
      const collectionFolder = await dirHandle.getDirectoryHandle(folderName);
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles');

      // 扫描实际文件，从 Front Matter 提取 ID 重建 exportedIds
      const foundIds = new Set();
      const commentedFiles = new Set();

      for await (const [name, handle] of articlesFolder.entries()) {
        if (handle.kind !== 'file') continue;
        if (!name.endsWith('.md')) continue;
        if (name === 'README.md') continue;

        if (name.endsWith('-评论.md')) {
          commentedFiles.add(name.replace(/-评论\.md$/, '.md'));
          continue;
        }

        // 读取 Front Matter 提取 ID
        try {
          const file = await handle.getFile();
          const head = await file.slice(0, 500).text();
          // 优先直接读 id 字段
          const idMatch = head.match(/^id:\s*"([^"]+)"/m);
          if (idMatch && idMatch[1]) {
            foundIds.add(idMatch[1]);
          } else {
            // 兼容旧文件：从 source URL 解析
            const sourceMatch = head.match(/^source:\s*"([^"]+)"/m);
            if (sourceMatch) {
              const pageInfo = api.detectPage(sourceMatch[1]);
              if (pageInfo && pageInfo.id) {
                foundIds.add(pageInfo.id);
              }
            }
          }
        } catch { /* 读取失败跳过 */ }
      }

      // 校准文章 ID 列表
      const oldIds = new Set(progressData.articles.exportedIds || []);
      let changed = false;

      if (foundIds.size !== oldIds.size || ![...foundIds].every((id) => oldIds.has(id))) {
        log(`文章 ID 校准：${oldIds.size} → ${foundIds.size}（以实际文件为准）`, 'warn');
        progressData.articles.exportedIds = Array.from(foundIds);
        progressData.articles.totalExported = foundIds.size;
        changed = true;
      }

      // 校准评论
      const oldCommentCount = progressData.comments.totalExported;
      const actualCommentCount = commentedFiles.size;
      if (oldCommentCount !== actualCommentCount) {
        log(`评论计数校准：${oldCommentCount} → ${actualCommentCount}（以实际文件为准）`, 'warn');
        progressData.comments.exportedArticles = Array.from(commentedFiles);
        progressData.comments.totalExported = actualCommentCount;
        changed = true;
      }

      if (changed) {
        await progress.writeProgress(dirHandle, progressData);
      }
    } catch {
      // 文件夹不存在说明还没开始导出，不需要校准
    }
  }

  // ============================
  // UI 更新
  // ============================

  function updateUI() {
    if (!dirHandle || !progressData) {
      els.articleStatus.innerHTML = '<p>请先选择导出文件夹</p>';
      els.commentStatus.innerHTML = '<p>请先选择导出文件夹</p>';
      els.btnExportArticles.disabled = true;
      els.btnExportComments.disabled = true;
      return;
    }

    updateArticleUI();
    updateCommentUI();
  }

  function updateArticleUI() {
    const exported = progressData.articles.totalExported;
    const total = currentTotal;
    const remaining = Math.max(0, total - exported);
    const pct = total > 0 ? Math.round((exported / total) * 100) : 0;

    let statusHtml = `<p>已导出 ${exported} / ${total} 篇`;
    if (progressData.articles.newestExportedTime) {
      const date = new Date(progressData.articles.newestExportedTime).toLocaleDateString('zh-CN');
      statusHtml += `（截至 ${date}）`;
    }
    statusHtml += `</p>`;
    statusHtml += `<progress value="${pct}" max="100"></progress>`;
    els.articleStatus.innerHTML = statusHtml;

    // 检测新增：对比当前总数和上次记录的总数
    const hasNew = exported > 0 &&
      progressData.articles.totalAtLastExport > 0 &&
      currentTotal > progressData.articles.totalAtLastExport;
    const newCount = hasNew ? currentTotal - progressData.articles.totalAtLastExport : 0;

    if (isExportingArticles) {
      els.btnExportArticles.textContent = '导出中...';
      els.btnExportArticles.disabled = true;
    } else if (hasNew) {
      els.btnExportArticles.textContent = `导出新增内容（${newCount} 篇）`;
      els.btnExportArticles.disabled = false;
    } else if (remaining === 0 && exported > 0) {
      els.btnExportArticles.textContent = '已全部导出 ✓';
      els.btnExportArticles.disabled = true;
    } else if (exported === 0) {
      els.btnExportArticles.textContent = '开始导出';
      els.btnExportArticles.disabled = false;
    } else {
      els.btnExportArticles.textContent = `继续导出下一批（剩余 ${remaining} 篇）`;
      els.btnExportArticles.disabled = false;
    }
  }

  function updateCommentUI() {
    const exportedComments = progressData.comments.totalExported;
    const totalArticles = progressData.articles.totalExported;

    const listWrap = document.getElementById('comment-article-list');
    const listItems = document.getElementById('comment-list-items');
    const selectAll = document.getElementById('comment-select-all');
    const selectedCount = document.getElementById('comment-selected-count');

    if (totalArticles === 0) {
      els.commentStatus.innerHTML = '<p class="status-empty">请先导出文章</p>';
      listWrap.classList.add('hidden');
      els.btnExportComments.disabled = true;
      els.btnExportComments.textContent = '请先导出文章';
      return;
    }

    // 状态概览
    els.commentStatus.innerHTML = `<p>已导出 ${exportedComments} / ${totalArticles} 篇文章的评论</p>`;

    // 构建文章列表（从 cachedItems 中取已导出的文章）
    const exportedIds = new Set(progressData.articles.exportedIds || []);
    const commentedSet = new Set(progressData.comments.exportedArticles || []);
    listWrap.classList.remove('hidden');
    listItems.innerHTML = '';

    const articleEntries = []; // 用于跟踪 checkbox 状态

    // 从缓存中获取已导出文章的信息
    const items = (cachedItems || []).filter((item) => item.id && exportedIds.has(item.id));

    for (const item of items) {
      const isDone = commentedSet.has(item.id);
      const entry = document.createElement('label');
      entry.className = `list-item${isDone ? ' list-item-done' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'check-input';
      checkbox.value = item.id;
      checkbox.disabled = isDone || isExportingComments;
      if (!isDone) {
        checkbox.checked = false;
      }

      const checkBox = document.createElement('span');
      checkBox.className = 'check-box';
      checkBox.innerHTML = '<span class="check-tick">&#x2713;</span>';

      const typeLabel = u.TYPE_LABELS[item.type] || item.type;

      const title = document.createElement('span');
      title.className = 'list-item-title';
      title.textContent = item.title || `${item.author}的${typeLabel}`;

      const author = document.createElement('span');
      author.className = 'list-item-author';
      author.textContent = item.author || '知乎用户';

      const type = document.createElement('span');
      type.className = 'list-item-type';
      type.textContent = typeLabel;

      const time = document.createElement('span');
      time.className = 'list-item-time';
      if (item.created_time) {
        const d = new Date(item.created_time * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        time.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }

      const meta = document.createElement('span');
      meta.className = 'list-item-meta';
      const commentInfo = item.commentCount ? `${item.commentCount} 条` : '无';
      meta.textContent = isDone ? '已导出' : commentInfo;

      entry.appendChild(checkbox);
      entry.appendChild(checkBox);
      entry.appendChild(title);
      entry.appendChild(author);
      entry.appendChild(type);
      entry.appendChild(time);
      entry.appendChild(meta);
      listItems.appendChild(entry);

      if (!isDone) {
        articleEntries.push({ checkbox, item });
      }
    }

    // 更新选中计数
    function refreshSelectedCount() {
      const count = articleEntries.filter((e) => e.checkbox.checked).length;
      selectedCount.textContent = `已选 ${count} 篇`;
      els.btnExportComments.disabled = count === 0 || isExportingComments;
      if (isExportingComments) {
        els.btnExportComments.textContent = '导出中...';
      } else if (count > 0) {
        els.btnExportComments.textContent = `导出选中的 ${count} 篇评论`;
      } else {
        els.btnExportComments.textContent = '请选择要导出评论的文章';
      }
    }

    // 全选
    selectAll.checked = false;
    selectAll.disabled = articleEntries.length === 0 || isExportingComments;
    selectAll.onchange = () => {
      for (const e of articleEntries) {
        e.checkbox.checked = selectAll.checked;
      }
      refreshSelectedCount();
    };

    // 单个 checkbox 变化
    for (const e of articleEntries) {
      e.checkbox.onchange = () => {
        selectAll.checked = articleEntries.every((e) => e.checkbox.checked);
        refreshSelectedCount();
      };
    }

    // 存到全局供 handleExportComments 使用
    window._commentArticleEntries = articleEntries;

    refreshSelectedCount();
  }

  // ============================
  // 文章导出（Task 7 实现）
  // ============================

  async function handleExportArticles() {
    if (isExportingArticles || !dirHandle || !progressData) return;
    isExportingArticles = true;
    updateUI();

    const batchSize = parseInt(els.articleBatchSize.value) || 50;
    progressData.articles.batchSize = batchSize;
    const wantImg = els.optImg.checked;

    try {
      // 创建子文件夹
      const collectionFolder = await dirHandle.getDirectoryHandle(
        u.sanitizeFilename(collectionName), { create: true }
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles', { create: true });
      let imagesFolder = null;
      if (wantImg) {
        imagesFolder = await articlesFolder.getDirectoryHandle('images', { create: true });
      }

      // Step 1: 加载目录（内存缓存 → storage 缓存 → API 拉取）
      if (!cachedItems) {
        cachedItems = await loadDirectory();
      } else {
        log(`使用缓存目录（${cachedItems.length} 篇）`);
      }

      if (!cachedItems || cachedItems.length === 0) {
        log('收藏夹为空', 'warn');
        cachedItems = null;
        isExportingArticles = false;
        hideArticleProgress();
        updateUI();
        return;
      }

      const allItems = cachedItems;

      // Step 2: 用 ID 过滤已导出的
      const exportedIds = new Set(progressData.articles.exportedIds || []);
      const pendingItems = allItems.filter((item) => item.id && !exportedIds.has(item.id));

      if (pendingItems.length === 0) {
        log('没有需要导出的新内容', 'warn');
        isExportingArticles = false;
        hideArticleProgress();
        updateUI();
        return;
      }

      log(`待导出 ${pendingItems.length} 篇，本批最多 ${batchSize} 篇`);

      // Step 4: 导出本批
      const batch = pendingItems.slice(0, batchSize);
      let exportedInBatch = 0;
      const usedNames = new Set();
      const tocEntries = [];

      for (const item of batch) {
        exportedInBatch++;
        const num = progressData.articles.totalExported + exportedInBatch;
        const typeLabel = u.TYPE_LABELS[item.type] || item.type;
        let baseName = u.sanitizeFilename(
          item.title
            ? `${item.title}-${item.author}的${typeLabel}`
            : `${item.author}的${typeLabel}_${num}`
        );
        if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
        usedNames.add(baseName);

        // 检查磁盘上是否已存在同名文件
        let filename = `${baseName}.md`;
        try {
          await articlesFolder.getFileHandle(filename);
          filename = `${baseName}_${num}.md`;
        } catch { /* 文件不存在，正常 */ }

        showArticleProgress(exportedInBatch, batch.length,
          `正在处理 ${exportedInBatch}/${batch.length}: ${(item.title || '').slice(0, 20)}...`);
        log(`处理 [${exportedInBatch}/${batch.length}]: ${item.title || baseName}`);

        // 图片处理
        let imageMapping = {};
        if (wantImg && item.html) {
          const imgUrls = extractImageUrls(item.html);
          if (imgUrls.length > 0 && imagesFolder) {
            const prefix = `${String(num).padStart(3, '0')}_`;
            const imgResult = await u.batchDownloadImagesToFolder(imgUrls, prefix, imagesFolder);
            imageMapping = imgResult.imageMapping;
          }
        }

        // 转换 Markdown（始终生成 Front Matter）
        let md = htmlToMarkdown(item.html || '', imageMapping);
        md = u.buildFrontmatter(item) + md;

        // 写入文件
        await u.writeTextFile(articlesFolder, filename, md);

        // 逐篇更新进度（中途中断也不丢）
        await progress.addExportedArticle(dirHandle, progressData, item.id);

        tocEntries.push({
          num,
          title: item.title || `${item.author}的${typeLabel}`,
          author: item.author,
          type: item.type,
          filename,
          url: item.url,
        });
      }

      // Step 5: 更新 README
      if (exportedInBatch > 0) {
        await updateReadme(collectionFolder);
        log(`本批完成：导出 ${exportedInBatch} 篇，共已导出 ${progressData.articles.totalExported} 篇`, 'success');
      }
    } catch (err) {
      log(`导出失败: ${err.message}`, 'error');
    } finally {
      isExportingArticles = false;
      hideArticleProgress();
      updateUI();
    }
  }

  /**
   * 扫描 articles 文件夹生成/更新 README.md
   */
  async function updateReadme(collectionFolder) {
    try {
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles');
      const entries = [];
      let num = 0;

      const fileNames = [];
      for await (const [name, handle] of articlesFolder.entries()) {
        if (handle.kind !== 'file') continue;
        if (!name.endsWith('.md')) continue;
        if (name.endsWith('-评论.md')) continue;
        fileNames.push(name);
      }

      fileNames.sort();
      for (const name of fileNames) {
        num++;
        entries.push({
          num,
          title: name.replace(/\.md$/, ''),
          author: '',
          type: 'article',
          filename: name,
          url: '',
        });
      }

      const tocMd = u.buildTocMarkdown(collectionName, entries);
      await u.writeTextFile(collectionFolder, 'README.md', tocMd);
    } catch {
      // README 更新失败不影响主流程
    }
  }

  // ============================
  // 评论导出（Task 8 实现）
  // ============================

  async function handleExportComments() {
    if (isExportingComments || !dirHandle || !progressData) return;

    // 获取用户选中的文章
    const entries = window._commentArticleEntries || [];
    const selected = entries.filter((e) => e.checkbox.checked);

    if (selected.length === 0) {
      log('未选择任何文章', 'warn');
      return;
    }

    isExportingComments = true;
    updateUI();

    try {
      const collectionFolder = await dirHandle.getDirectoryHandle(
        u.sanitizeFilename(collectionName)
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles');
      let imagesFolder = null;
      try {
        imagesFolder = await articlesFolder.getDirectoryHandle('images');
      } catch { /* 没有 images 文件夹也没关系 */ }

      log(`开始导出 ${selected.length} 篇文章的评论`);

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i].item;
        const displayTitle = item.title || `${item.author}的${u.TYPE_LABELS[item.type] || item.type}`;

        showCommentProgress(i + 1, selected.length,
          `正在处理 ${i + 1}/${selected.length}: ${displayTitle.slice(0, 20)}...`);

        try {
          // 直接用 item.type 和 item.id（来自收藏夹 API，类型准确）
          log(`加载评论: ${displayTitle}（${item.type} #${item.id}）`);
          const comments = await api.fetchAllComments(item.type, item.id, (done, total) => {
            showCommentProgress(i + 1, selected.length,
              `${displayTitle.slice(0, 15)}... 子评论 ${done}/${total}`);
          });

          if (comments.length > 0) {
            // 评论图片处理
            let commentImageMapping = {};
            if (imagesFolder) {
              const imgEntries = u.collectCommentImageEntries(comments);
              if (imgEntries.length > 0) {
                const prefix = `comment_${item.id}_`;
                const imgResult = await u.downloadCommentImages(imgEntries, prefix);
                commentImageMapping = imgResult.imageMapping;
                for (const f of imgResult.imageFiles) {
                  const fh = await imagesFolder.getFileHandle(f.path, { create: true });
                  const w = await fh.createWritable();
                  await w.write(f.buffer);
                  await w.close();
                }
              }
            }

            // 生成评论文件名（和文章文件名对应）
            const typeLabel = u.TYPE_LABELS[item.type] || item.type;
            const baseName = u.sanitizeFilename(
              item.title
                ? `${item.title}-${item.author}的${typeLabel}`
                : `${item.author}的${typeLabel}`
            );
            const commentMd = buildCommentsMarkdown(comments, displayTitle, commentImageMapping);
            const commentFilename = `${baseName}-评论.md`;
            await u.writeTextFile(articlesFolder, commentFilename, commentMd);

            const totalComments = comments.reduce((sum, c) => sum + 1 + (c.child_comments || []).length, 0);
            log(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
          } else {
            log(`${displayTitle}：无评论`);
          }

          await progress.updateCommentProgress(dirHandle, progressData, item.id);
        } catch (err) {
          log(`${displayTitle} 评论导出失败: ${err.message}`, 'error');
        }
      }

      log(`评论导出完成，共处理 ${selected.length} 篇`, 'success');
    } catch (err) {
      log(`评论导出失败: ${err.message}`, 'error');
    } finally {
      isExportingComments = false;
      hideCommentProgress();
      updateUI();
    }
  }

  // ============================
  // 启动
  // ============================

  init();
})();
