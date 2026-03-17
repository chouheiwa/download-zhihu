/**
 * 收藏夹面板 + ZIP/文件夹导出
 * 依赖：detector.js、html-to-markdown.js、export-utils.js、jszip.min.js
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

    body.innerHTML = `
      <div class="info-row">
        <span class="info-label">类型</span>
        <span class="info-value"><span class="badge badge-green">收藏夹</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">名称</span>
        <span class="info-value title-text">${u.escapeHtml(info.title)}</span>
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
        <label class="option-item">
          <span>导出评论区</span>
          <input type="checkbox" id="col-opt-comment">
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
      optComment: body.querySelector('#col-opt-comment'),
      progressWrap: body.querySelector('#col-progress-wrap'),
      progressBar: body.querySelector('#col-progress-bar'),
      progressLabel: body.querySelector('#col-progress-label'),
    };

    const getExportMode = () => body.querySelector('input[name="col-export-mode"]:checked').value;

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

  // ============================
  // 收藏夹逐篇处理的公共逻辑
  // ============================

  function prepareItemMeta(item, num, usedNames) {
    const typeLabel = u.TYPE_LABELS[item.type] || item.type;
    let baseName = u.sanitizeFilename(
      item.title
        ? `${item.title}-${item.author}的${typeLabel}`
        : `${item.author}的${typeLabel}_${num}`
    );
    if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
    usedNames.add(baseName);

    return {
      typeLabel,
      baseName,
      filename: `${baseName}.md`,
      tocEntry: {
        num,
        title: item.title || `${item.author}的${typeLabel}`,
        author: item.author,
        type: item.type,
        filename: `${baseName}.md`,
        url: item.url,
      },
    };
  }

  async function processItemComments(item, comments, num, wantImages) {
    let commentImageMapping = {};
    let commentImageFiles = [];

    if (wantImages && comments.length > 0) {
      const imgEntries = u.collectCommentImageEntries(comments);
      const prefix = `${String(num).padStart(3, '0')}_comment_`;
      const imgResult = await u.downloadCommentImages(imgEntries, prefix);
      commentImageMapping = imgResult.imageMapping;
      commentImageFiles = imgResult.imageFiles;
    }

    const meta = prepareItemMeta(item, num, new Set()); // 仅用于 title
    const typeLabel = u.TYPE_LABELS[item.type] || item.type;
    const commentMd = buildCommentsMarkdown(
      comments, item.title || `${item.author}的${typeLabel}`, commentImageMapping
    );

    return { commentMd, commentImageMapping, commentImageFiles };
  }

  // ============================
  // ZIP 导出
  // ============================

  async function handleCollectionExport(info, refs) {
    refs.btn.disabled = true;

    try {
      refs.btn.textContent = '正在加载收藏夹...';
      const allItems = [];
      let nextUrl = info.apiUrl;
      let pageNum = 0;

      while (nextUrl) {
        pageNum++;
        u.showProgress(refs, 0, 1, `正在加载第 ${pageNum} 页...`);
        const result = await api.fetchCollectionPage(nextUrl);
        allItems.push(...result.items);
        u.showProgress(refs, allItems.length, result.totals, `已加载 ${allItems.length}/${result.totals} 篇`);
        nextUrl = result.nextUrl;
      }

      if (allItems.length === 0) throw new Error('收藏夹为空');

      const wantImages = refs.optImg.checked;
      const wantFm = refs.optFm.checked;
      const wantComment = refs.optComment.checked;
      const collectionName = u.sanitizeFilename(info.title);
      const zip = new JSZip();
      const rootFolder = zip.folder(collectionName);
      const articlesFolder = rootFolder.folder('articles');
      const imagesFolder = wantImages ? articlesFolder.folder('images') : null;
      const usedNames = new Set();
      const tocEntries = [];

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const num = i + 1;
        const { typeLabel, baseName, filename, tocEntry } = prepareItemMeta(item, num, usedNames);
        tocEntries.push(tocEntry);

        u.showProgress(refs, num, allItems.length, `正在转换 ${num}/${allItems.length}: ${(item.title || '').slice(0, 15)}...`);
        refs.btn.textContent = `正在转换 ${num}/${allItems.length}...`;

        let imageMapping = {};
        if (wantImages && item.html) {
          const itemImgUrls = extractImageUrls(item.html);
          if (itemImgUrls.length > 0) {
            const prefix = `${String(num).padStart(3, '0')}_`;
            const result = await u.batchDownloadImages(itemImgUrls, prefix, null);
            imageMapping = result.imageMapping;
            for (const f of result.imageFiles) imagesFolder.file(f.path, f.buffer);
          }
        }

        let md = htmlToMarkdown(item.html || '', imageMapping);
        if (wantFm) md = u.buildFrontmatter(item) + md;

        if (wantComment) {
          u.showProgress(refs, num, allItems.length, `正在加载评论 ${num}/${allItems.length}...`);
          try {
            const contentId = u.extractContentId(item);
            if (contentId) {
              const comments = await api.fetchAllComments(item.type, contentId, null);
              if (comments.length > 0) {
                let commentImageMapping = {};
                if (wantImages) {
                  const imgEntries = u.collectCommentImageEntries(comments);
                  const prefix = `${String(num).padStart(3, '0')}_comment_`;
                  const imgResult = await u.downloadCommentImages(imgEntries, prefix);
                  commentImageMapping = imgResult.imageMapping;
                  for (const f of imgResult.imageFiles) imagesFolder.file(f.path, f.buffer);
                }

                const commentFilename = `${baseName}-评论.md`;
                articlesFolder.file(commentFilename, buildCommentsMarkdown(
                  comments, item.title || `${item.author}的${typeLabel}`, commentImageMapping
                ));

                const encodedCF = encodeURIComponent(commentFilename).replace(/\(/g, '%28').replace(/\)/g, '%29');
                md += `\n\n---\n\n> [查看评论区](./${encodedCF})\n`;
              }
            }
          } catch { /* 评论加载失败不影响文章导出 */ }
        }

        articlesFolder.file(filename, md);
      }

      rootFolder.file('README.md', u.buildTocMarkdown(collectionName, tocEntries));

      refs.btn.textContent = '正在打包...';
      u.showProgress(refs, allItems.length, allItems.length, '正在压缩 ZIP...');

      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => u.showProgress(refs, allItems.length, allItems.length, `正在压缩... ${Math.round(meta.percent)}%`)
      );

      u.triggerDownload(blob, `${collectionName}.zip`);

      refs.btn.textContent = `导出成功 ✓（${allItems.length} 篇）`;
      setTimeout(() => {
        refs.btn.textContent = '导出整个收藏夹';
        refs.btn.disabled = false;
        u.hideProgress(refs);
      }, 3000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  // ============================
  // 文件夹导出（流式，低内存）
  // ============================

  async function handleCollectionExportToFolder(info, refs) {
    refs.btn.disabled = true;

    try {
      let rootHandle;
      try {
        rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        refs.btn.disabled = false;
        return;
      }

      const collectionName = u.sanitizeFilename(info.title);
      const folderHandle = await rootHandle.getDirectoryHandle(collectionName, { create: true });
      const articlesFolderHandle = await folderHandle.getDirectoryHandle('articles', { create: true });
      const wantImages = refs.optImg.checked;
      const wantFm = refs.optFm.checked;
      const wantComment = refs.optComment.checked;

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

      while (nextUrl) {
        pageNum++;
        u.showProgress(refs, itemIndex, totalItems || 1, `正在加载第 ${pageNum} 页...`);

        const result = await api.fetchCollectionPage(nextUrl);
        if (totalItems === 0) totalItems = result.totals;
        nextUrl = result.nextUrl;

        for (const item of result.items) {
          itemIndex++;
          const num = itemIndex;
          const { typeLabel, baseName, filename, tocEntry } = prepareItemMeta(item, num, usedNames);
          tocEntries.push(tocEntry);

          u.showProgress(refs, num, totalItems, `正在处理 ${num}/${totalItems}: ${(item.title || '').slice(0, 15)}...`);
          refs.btn.textContent = `正在处理 ${num}/${totalItems}...`;

          let imageMapping = {};
          if (wantImages && item.html) {
            const itemImgUrls = extractImageUrls(item.html);
            if (itemImgUrls.length > 0) {
              const prefix = `${String(num).padStart(3, '0')}_`;
              const result = await u.batchDownloadImagesToFolder(itemImgUrls, prefix, imagesFolderHandle);
              imageMapping = result.imageMapping;
            }
          }

          let md = htmlToMarkdown(item.html || '', imageMapping);
          if (wantFm) md = u.buildFrontmatter(item) + md;

          if (wantComment) {
            u.showProgress(refs, num, totalItems, `正在加载评论 ${num}/${totalItems}...`);
            try {
              const contentId = u.extractContentId(item);
              if (contentId) {
                const comments = await api.fetchAllComments(item.type, contentId, null);
                if (comments.length > 0) {
                  let commentImageMapping = {};
                  if (wantImages && imagesFolderHandle) {
                    const imgEntries = u.collectCommentImageEntries(comments);
                    const prefix = `${String(num).padStart(3, '0')}_comment_`;
                    const imgResult = await u.downloadCommentImages(imgEntries, prefix);
                    commentImageMapping = imgResult.imageMapping;
                    for (const f of imgResult.imageFiles) {
                      const fh = await imagesFolderHandle.getFileHandle(f.path, { create: true });
                      const w = await fh.createWritable();
                      await w.write(f.buffer);
                      await w.close();
                    }
                  }

                  const commentFilename = `${baseName}-评论.md`;
                  await u.writeTextFile(articlesFolderHandle, commentFilename, buildCommentsMarkdown(
                    comments, item.title || `${item.author}的${typeLabel}`, commentImageMapping
                  ));

                  const encodedCF = encodeURIComponent(commentFilename).replace(/\(/g, '%28').replace(/\)/g, '%29');
                  md += `\n\n---\n\n> [查看评论区](./${encodedCF})\n`;
                }
              }
            } catch { /* 评论加载失败不影响文章导出 */ }
          }

          await u.writeTextFile(articlesFolderHandle, filename, md);
        }
      }

      if (itemIndex === 0) throw new Error('收藏夹为空');

      u.showProgress(refs, totalItems, totalItems, '正在生成目录...');
      await u.writeTextFile(folderHandle, 'README.md', u.buildTocMarkdown(collectionName, tocEntries));

      refs.btn.textContent = `导出成功 ✓（${itemIndex} 篇）`;
      setTimeout(() => {
        refs.btn.textContent = '导出整个收藏夹';
        refs.btn.disabled = false;
        u.hideProgress(refs);
      }, 3000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  window.__renderCollectionPanel = renderCollectionPanel;
})();
