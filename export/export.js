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

  // ============================
  // URL 参数解析
  // ============================

  const params = new URLSearchParams(window.location.search);
  const collectionId = params.get('id') || '';
  const collectionName = params.get('name') || '未知';
  const collectionApiUrl = params.get('api') || '';
  const sourceType = params.get('source') || 'collection'; // 'collection' | 'column'
  const sourceLabel = sourceType === 'column' ? '专栏' : '收藏夹';

  // ============================
  // DOM 引用
  // ============================

  const els = {
    collectionName: document.getElementById('collection-name'),
    folderPath: document.getElementById('folder-path'),
    btnSelectFolder: document.getElementById('btn-select-folder'),
    articleStatus: document.getElementById('article-status'),
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
    formatSection: document.getElementById('format-section'),
    docxImgOpts: document.getElementById('docx-img-opts'),
    mdImgRow: document.getElementById('md-img-row'),
  };

  // ============================
  // 状态
  // ============================

  let dirHandle = null;
  let progressData = null;
  let cachedItems = null; // 最近一次导出拉取的条目，供评论列表使用
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
  // 逐页拉取 API 目录
  // ============================

  /**
   * 逐页拉取目录，每拉到一页就调用 onPage 回调处理
   * @param {function} onPage - async (items, pageNum) => void
   */
  async function fetchDirectoryPages(onPage) {
    const fetchFn = sourceType === 'column' ? api.fetchColumnPage : api.fetchCollectionPage;
    let nextPageUrl = collectionApiUrl;
    let pageNum = 0;
    let totalFetched = 0;

    while (nextPageUrl) {
      pageNum++;
      log(`正在请求第 ${pageNum} 页...`);

      let result;
      try {
        result = await fetchFn(nextPageUrl);
      } catch (err) {
        log(`加载第 ${pageNum} 页目录失败: ${err.message}`, 'error');
        log(`已加载 ${totalFetched} 篇，后续页面未加载`, 'warn');
        return;
      }

      totalFetched += result.items.length;
      log(`第 ${pageNum} 页返回 ${result.items.length} 篇（累计 ${totalFetched} 篇）`);

      // 记录异常条目
      for (const item of result.items) {
        if (!item.id) {
          log(`警告：发现无 ID 条目，标题="${item.title || '无'}"，类型=${item.type}，将跳过`, 'warn');
        } else if (!item.html && item.type !== 'unknown') {
          log(`注意：条目 ${item.id}（${item.title || '无标题'}）内容为空`, 'warn');
        }
      }

      if (result.items.length > 0) {
        await onPage(result.items, pageNum);
      }

      nextPageUrl = result.nextUrl;
      if (!nextPageUrl) {
        log(`全部页面加载完成，共 ${pageNum} 页 ${totalFetched} 篇`);
      }
    }
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
    els.collectionName.textContent = `${sourceLabel}：${collectionName}`;
    document.title = `导出管理器 - ${sourceLabel} - ${collectionName}`;

    els.btnSelectFolder.addEventListener('click', handleSelectFolder);
    els.btnExportArticles.addEventListener('click', handleExportArticles);
    els.btnExportComments.addEventListener('click', handleExportComments);

    // 格式切换
    document.querySelectorAll('input[name="export-format"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isDocx = document.querySelector('input[name="export-format"]:checked')?.value === 'docx';
        if (els.docxImgOpts) els.docxImgOpts.style.display = isDocx ? '' : 'none';
        if (els.mdImgRow) els.mdImgRow.style.display = isDocx ? 'none' : '';
      });
    });

    log(`已加载${sourceLabel}：${collectionName}（ID: ${collectionId}）`);
    updateUI();
  }

  // ============================
  // 文件夹选择
  // ============================

  async function handleSelectFolder() {
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      els.folderPath.textContent = dirHandle.name;
      log(`已选择文件夹：${dirHandle.name}`);

      progressData = await progress.readProgress(dirHandle, collectionId);

      if (progressData) {
      } else {
        progressData = progress.createInitialProgress(collectionId, collectionName);
        log('未找到进度文件，将从头开始导出');
      }

      // 扫描实际文件校准计数（进度文件计数器可能漂移）
      await reconcileProgress();

      log(`已导出 ${progressData.articles.totalExported} 篇文章、${progressData.comments.totalExported} 篇评论`);
      if (els.formatSection) els.formatSection.style.display = '';
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
      const fileItems = []; // 从文件 Front Matter 恢复的文章元数据

      for await (const [name, handle] of articlesFolder.entries()) {
        if (handle.kind !== 'file') continue;
        if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
        if (name === 'README.md' || name === 'README.docx') continue;

        if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) {
          commentedFiles.add(name.replace(/-评论\.(md|docx)$/, '.$1'));
          continue;
        }

        // docx 文件无法从内容提取 ID，依赖进度文件记录
        if (name.endsWith('.docx')) continue;

        // 读取 Front Matter 提取 ID 和元数据
        try {
          const file = await handle.getFile();
          const head = await file.slice(0, 500).text();
          // 优先直接读 id 字段
          const idMatch = head.match(/^id:\s*"([^"]+)"/m);
          let articleId = null;
          if (idMatch && idMatch[1]) {
            articleId = idMatch[1];
          } else {
            // 兼容旧文件：从 source URL 解析
            const sourceMatch = head.match(/^source:\s*"([^"]+)"/m);
            if (sourceMatch) {
              const pageInfo = api.detectPage(sourceMatch[1]);
              if (pageInfo && pageInfo.id) {
                articleId = pageInfo.id;
              }
            }
          }
          if (articleId) {
            foundIds.add(articleId);
            // 提取元数据供评论列表使用
            const titleMatch = head.match(/^title:\s*"(.+)"/m);
            const authorMatch = head.match(/^author:\s*"(.+)"/m);
            const typeMatch = head.match(/^type:\s*zhihu-(\S+)/m);
            const sourceMatch = head.match(/^source:\s*"([^"]+)"/m);
            fileItems.push({
              id: articleId,
              title: titleMatch ? titleMatch[1].replace(/\\"/g, '"') : '',
              author: authorMatch ? authorMatch[1].replace(/\\"/g, '"') : '',
              type: typeMatch ? typeMatch[1] : 'article',
              url: sourceMatch ? sourceMatch[1] : '',
            });
          }
        } catch { /* 读取失败跳过 */ }
      }

      // 当 cachedItems 为空时，用文件元数据填充，确保评论列表可见
      if (!cachedItems && fileItems.length > 0) {
        cachedItems = fileItems;
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
        await progress.writeProgress(dirHandle, collectionId, progressData);
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

    let statusHtml = `<p>已导出 ${exported} 篇`;
    if (progressData.articles.newestExportedTime) {
      const date = new Date(progressData.articles.newestExportedTime).toLocaleDateString('zh-CN');
      statusHtml += `（截至 ${date}）`;
    }
    statusHtml += `</p>`;
    els.articleStatus.innerHTML = statusHtml;

    if (isExportingArticles) {
      els.btnExportArticles.textContent = '导出中...';
      els.btnExportArticles.disabled = true;
    } else {
      els.btnExportArticles.textContent = exported > 0 ? '导出全部（跳过已导出）' : '开始导出';
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
      checkbox.disabled = isExportingComments;
      checkbox.checked = false;

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
      meta.textContent = isDone ? '已导出 · 可更新' : commentInfo;

      entry.appendChild(checkbox);
      entry.appendChild(checkBox);
      entry.appendChild(title);
      entry.appendChild(author);
      entry.appendChild(type);
      entry.appendChild(time);
      entry.appendChild(meta);
      listItems.appendChild(entry);

      articleEntries.push({ checkbox, item });
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
  // 文件命名规则
  // ============================

  /**
   * 根据类型生成文件名：
   * - 文章：直接用标题
   * - 回答：问题标题-作者的回答
   * - 想法：想法内容前30字-作者的想法
   * - 其他：标题-作者的类型
   */
  function buildItemName(item, typeLabel, num) {
    switch (item.type) {
      case 'article':
        return item.title || `${item.author}的文章_${num}`;
      case 'answer':
        return item.title
          ? `${item.title}-${item.author}的回答`
          : `${item.author}的回答_${num}`;
      case 'pin':
        return item.title
          ? `${item.title}-${item.author}的想法`
          : `${item.author}的想法_${num}`;
      default:
        return item.title
          ? `${item.title}-${item.author}的${typeLabel}`
          : `${item.author}的${typeLabel}_${num}`;
    }
  }

  // ============================
  // 文章导出
  // ============================

  async function handleExportArticles() {
    if (isExportingArticles || !dirHandle || !progressData) return;
    isExportingArticles = true;
    updateUI();

    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = document.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
    const wantImg = format === 'md' ? els.optImg.checked : (docxImgMode === 'embed');

    try {
      // 创建子文件夹
      const collectionFolder = await dirHandle.getDirectoryHandle(
        u.sanitizeFilename(collectionName), { create: true }
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles', { create: true });
      let imagesFolder = null;
      if (wantImg && format === 'md') {
        imagesFolder = await articlesFolder.getDirectoryHandle('images', { create: true });
      }

      const exportedIds = new Set(progressData.articles.exportedIds || []);
      const usedNames = new Set();
      let exportedInBatch = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const allItems = []; // 收集所有条目供评论列表使用

      // 逐页拉取、逐页处理
      await fetchDirectoryPages(async (pageItems, pageNum) => {
        allItems.push(...pageItems);

        // 过滤无 ID 条目
        const noIdItems = pageItems.filter((item) => !item.id);
        if (noIdItems.length > 0) {
          skippedCount += noIdItems.length;
        }

        // 过滤已导出的
        const pending = pageItems.filter((item) => item.id && !exportedIds.has(item.id));
        const alreadyExported = pageItems.length - noIdItems.length - pending.length;

        if (pending.length === 0) {
          log(`第 ${pageNum} 页：${pageItems.length} 篇全部已导出，跳过`);
          return;
        }

        log(`第 ${pageNum} 页：${pageItems.length} 篇（待导出 ${pending.length}，已导出 ${alreadyExported}${noIdItems.length > 0 ? `，无ID跳过 ${noIdItems.length}` : ''}）`);

        for (const item of pending) {
          const itemLabel = `${item.title || item.id}（${item.type}, id=${item.id}）`;

          try {
            exportedInBatch++;
            const num = progressData.articles.totalExported + 1;
            const typeLabel = u.TYPE_LABELS[item.type] || item.type;
            let baseName = u.sanitizeFilename(buildItemName(item, typeLabel, num));
            if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
            usedNames.add(baseName);

            // 检查磁盘上是否已存在同名文件
            let filename = format === 'docx' ? `${baseName}.docx` : `${baseName}.md`;
            try {
              await articlesFolder.getFileHandle(filename);
              filename = format === 'docx' ? `${baseName}_${num}.docx` : `${baseName}_${num}.md`;
              log(`文件名冲突，改用: ${filename}`, 'warn');
            } catch { /* 文件不存在，正常 */ }

            showArticleProgress(0, 1,
              `第 ${pageNum} 页 - 正在处理: ${(item.title || '').slice(0, 20)}...`);
            log(`处理 [${exportedInBatch}]: ${itemLabel} → ${filename}`);

            // 内容截断检测：content_need_truncated 表示列表 API 返回的内容不完整
            if (item.isTruncated && (item.type === 'article' || item.type === 'answer')) {
              let shouldFetch = true;

              if (item.isPaidContent) {
                // 付费内容：查询用户是否已购买
                log(`  付费内容，检查购买状态...`);
                const hasPaid = await api.checkPaidAccess(item.type, item.id);
                if (hasPaid) {
                  log(`  已购买，请求完整内容...`);
                } else {
                  log(`  未购买，跳过补全`, 'warn');
                  shouldFetch = false;
                }
              } else {
                log(`  内容被截断，请求完整内容...`);
              }

              if (shouldFetch) {
                try {
                  const fullHtml = await api.fetchFullContent(item.type, item.url);
                  if (fullHtml && fullHtml.length > (item.html || '').length) {
                    log(`  内容补全: ${(item.html || '').length} → ${fullHtml.length}`);
                    item.html = fullHtml;
                  }
                } catch (err) {
                  log(`  补全失败: ${err.message}，使用截断内容`, 'warn');
                }
              }
            }

            if (format === 'docx') {
              // === DOCX 模式 ===
              let imageData = new Map();
              if (wantImg && item.html) {
                const imgUrls = extractImageUrls(item.html);
                if (imgUrls.length > 0) {
                  const prefix = `${String(num).padStart(3, '0')}_`;
                  const imgResult = await u.batchDownloadImages(imgUrls, prefix, null);
                  imageData = u.buildImageDataMap(imgResult.imageMapping, imgResult.imageFiles);
                  log(`  图片: ${imgUrls.length} 张，嵌入 ${imageData.size} 张`);
                }
              }

              const docxBlob = await window.htmlToDocx(item.html || '', {
                images: docxImgMode,
                imageData,
                frontMatter: {
                  id: item.id,
                  title: item.title,
                  author: item.author?.name || item.author,
                  url: item.url,
                  createdTime: item.created_time || item.created || null,
                  updatedTime: item.updated_time || item.updated || null,
                },
              });

              await u.writeBlobFile(articlesFolder, filename, docxBlob);
            } else {
              // === Markdown 模式（existing code） ===
              let imageMapping = {};
              if (wantImg && item.html) {
                const imgUrls = extractImageUrls(item.html);
                if (imgUrls.length > 0 && imagesFolder) {
                  const prefix = `${String(num).padStart(3, '0')}_`;
                  const imgResult = await u.batchDownloadImagesToFolder(imgUrls, prefix, imagesFolder);
                  imageMapping = imgResult.imageMapping;
                  log(`  图片: ${imgUrls.length} 张，成功 ${Object.keys(imgResult.imageMapping).length} 张`);
                }
              }

              let md = htmlToMarkdown(item.html || '', imageMapping);
              md = u.buildFrontmatter(item) + md;
              await u.writeTextFile(articlesFolder, filename, md);
            }

            // 逐篇更新进度（中途中断也不丢）
            await progress.addExportedArticle(dirHandle, collectionId, progressData, item.id);
            exportedIds.add(item.id);
          } catch (err) {
            failedCount++;
            log(`导出失败 [${itemLabel}]: ${err.message}`, 'error');
          }
        }
      });

      cachedItems = allItems.length > 0 ? allItems : null;

      // 汇总日志
      const summary = [`导出完成：本次导出 ${exportedInBatch - failedCount} 篇，共已导出 ${progressData.articles.totalExported} 篇`];
      if (failedCount > 0) summary.push(`失败 ${failedCount} 篇`);
      if (skippedCount > 0) summary.push(`跳过无ID ${skippedCount} 篇`);

      if (exportedInBatch > 0 || failedCount > 0) {
        await updateReadme(collectionFolder);
        log(summary.join('，'), failedCount > 0 ? 'warn' : 'success');
      } else {
        log('没有需要导出的新内容', 'warn');
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
        if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
        if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) continue;
        fileNames.push(name);
      }

      fileNames.sort();
      for (const name of fileNames) {
        num++;
        entries.push({
          num,
          title: name.replace(/\.(md|docx)$/, ''),
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

      const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';

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
            const baseName = u.sanitizeFilename(buildItemName(item, typeLabel, 0));

            if (format === 'docx') {
              const commentBlob = await window.commentsToDocx(comments, displayTitle);
              const commentFilename = `${baseName}-评论.docx`;
              await u.writeBlobFile(articlesFolder, commentFilename, commentBlob);

              const totalComments = comments.reduce((sum, c) => sum + 1 + (c.child_comments || []).length, 0);
              log(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
            } else {
              const commentMd = buildCommentsMarkdown(comments, displayTitle, commentImageMapping);
              const commentFilename = `${baseName}-评论.md`;
              await u.writeTextFile(articlesFolder, commentFilename, commentMd);

              const totalComments = comments.reduce((sum, c) => sum + 1 + (c.child_comments || []).length, 0);
              log(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
            }
          } else {
            log(`${displayTitle}：无评论`);
          }

          await progress.updateCommentProgress(dirHandle, collectionId, progressData, item.id);
        } catch (err) {
          if (err.httpStatus === 403 || err.message?.includes('403')) {
            log(`⚠️ 被知乎限流（HTTP 403），可能需要完成验证码。请切换到知乎页面完成验证后重试剩余文章。已处理 ${i + 1}/${selected.length} 篇`, 'error');
            break;
          }
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
