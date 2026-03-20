/**
 * 单篇文章/回答/想法面板
 * 依赖：detector.js、html-to-markdown.js、export-utils.js、jszip.min.js
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  const u = window.__exportUtils;

  // ============================
  // IndexedDB 持久化 Directory Handle
  // ============================

  const IDB_NAME = 'zhihu-downloader';
  const IDB_STORE = 'handles';
  const IDB_KEY = 'article-save-folder';

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDirHandle(handle) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadDirHandle() {
    try {
      const db = await openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /** 验证 handle 权限，必要时请求授权，失败返回 null */
  async function verifyDirHandle(handle) {
    if (!handle) return null;
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      return perm === 'granted' ? handle : null;
    } catch {
      return null;
    }
  }

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
        <span class="info-value"><span class="badge">${u.TYPE_LABELS[data.type] || data.type}</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">标题</span>
        <span class="info-value title-text">${u.escapeHtml(data.title)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">作者</span>
        <span class="info-value">${u.escapeHtml(data.author)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">图片</span>
        <span class="info-value">${imgUrls.length > 0 ? imgUrls.length + ' 张' : '无'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">内容</span>
        <span class="info-value">${data.html ? data.html.length + ' 字符' : '<span style="color:#e53e3e">空</span>'}</span>
      </div>
      <div class="options">
        <div class="option-item" style="display:flex;gap:12px;align-items:center;">
          <span>导出格式</span>
          <label><input type="radio" name="export-format" value="md" checked> Markdown</label>
          <label><input type="radio" name="export-format" value="docx"> Word</label>
        </div>
        <label class="option-item">
          <span>包含 Front Matter</span>
          <input type="checkbox" id="opt-fm" checked>
        </label>
        <label class="option-item" id="opt-img-row">
          <span>下载图片到本地</span>
          <input type="checkbox" id="opt-img" ${imgUrls.length > 0 ? 'checked' : ''}>
        </label>
        <div class="option-item" id="docx-img-opts" style="display:none;gap:12px;align-items:center;">
          <span>图片处理</span>
          <label><input type="radio" name="docx-img" value="embed" checked> 嵌入文档</label>
          <label><input type="radio" name="docx-img" value="link"> 外部链接</label>
        </div>
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
      <div id="folder-section" style="margin-top:8px;">
        <div id="folder-info" style="display:none;font-size:12px;color:#666;margin-bottom:4px;align-items:center;gap:6px;">
          <span style="flex-shrink:0;">📁</span>
          <span id="folder-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          <button id="btn-change-folder" style="flex-shrink:0;border:none;background:none;color:#0066ff;font-size:12px;cursor:pointer;padding:0;">更换</button>
        </div>
        <button id="btn-save-folder" class="btn" style="background:#00994d;">保存到文件夹</button>
      </div>
      <button id="btn-debug" class="btn" style="margin-top:4px;font-size:12px;padding:4px 8px;background:#666;">保存调试数据</button>
      <div id="article-log" style="margin-top:8px;max-height:120px;overflow-y:auto;font-size:11px;line-height:1.5;color:#888;display:none;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.03);border-radius:4px;padding:6px 8px;"></div>
    `;

    const refs = {
      btn: body.querySelector('#btn-dl'),
      btnSaveFolder: body.querySelector('#btn-save-folder'),
      btnChangeFolder: body.querySelector('#btn-change-folder'),
      folderInfo: body.querySelector('#folder-info'),
      folderName: body.querySelector('#folder-name'),
      optFm: body.querySelector('#opt-fm'),
      optImg: body.querySelector('#opt-img'),
      optComment: body.querySelector('#opt-comment'),
      optImgRow: body.querySelector('#opt-img-row'),
      docxImgOpts: body.querySelector('#docx-img-opts'),
      progressWrap: body.querySelector('#progress-wrap'),
      progressBar: body.querySelector('#progress-bar'),
      progressLabel: body.querySelector('#progress-label'),
      logEl: body.querySelector('#article-log'),
      panelBody: body,
    };

    // 文件夹 handle 状态
    let currentDirHandle = null;

    // 初始化：尝试加载已保存的文件夹
    (async () => {
      const saved = await loadDirHandle();
      const verified = await verifyDirHandle(saved);
      if (verified) {
        currentDirHandle = verified;
        showFolderInfo(refs, verified.name);
      }
    })();

    function showFolderInfo(refs, name) {
      refs.folderInfo.style.display = 'flex';
      refs.folderName.textContent = name;
    }

    async function pickFolder() {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        currentDirHandle = handle;
        await saveDirHandle(handle);
        showFolderInfo(refs, handle.name);
        return handle;
      } catch {
        return null; // 用户取消
      }
    }

    refs.btnChangeFolder.addEventListener('click', (e) => {
      e.stopPropagation();
      pickFolder();
    });

    refs.btnSaveFolder.addEventListener('click', () => handleSaveToFolder(data, imgUrls, refs, currentDirHandle, pickFolder));

    function updateBtnText() {
      const format = body.querySelector('input[name="export-format"]:checked')?.value || 'md';
      const wantComment = refs.optComment.checked;

      if (format === 'docx') {
        refs.btn.textContent = wantComment ? '下载 ZIP（含评论）' : '下载 Word';
      } else {
        const wantImg = refs.optImg.checked && imgUrls.length > 0;
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
    }
    refs.optImg.addEventListener('change', updateBtnText);
    refs.optComment.addEventListener('change', updateBtnText);

    // 格式切换
    body.querySelectorAll('input[name="export-format"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isDocx = body.querySelector('input[name="export-format"]:checked')?.value === 'docx';
        refs.optImgRow.style.display = isDocx ? 'none' : '';
        refs.docxImgOpts.style.display = isDocx ? 'flex' : 'none';
        updateBtnText();
      });
    });

    refs.btn.addEventListener('click', () => handleArticleDownload(data, imgUrls, refs, updateBtnText));

    // 调试按钮：下载提取到的 HTML 原文
    body.querySelector('#btn-debug').addEventListener('click', () => {
      const blob = new Blob([data.html || ''], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `debug-${data.type}-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function articleLog(refs, msg, type = 'info') {
    const el = refs.logEl;
    if (!el) return;
    el.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    const color = type === 'error' ? '#e53e3e' : type === 'warn' ? '#d69e2e' : '#888';
    el.innerHTML += `<span style="color:#aaa">[${time}]</span> <span style="color:${color}">${msg}</span>\n`;
    el.scrollTop = el.scrollHeight;
  }

  async function handleArticleDownload(data, imgUrls, refs, updateBtnText) {
    refs.btn.disabled = true;

    const format = refs.panelBody.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = refs.panelBody.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
    const wantImages = refs.optImg.checked && imgUrls.length > 0;
    const wantFm = refs.optFm.checked;
    const wantComment = refs.optComment.checked;
    const baseName = u.sanitizeFilename(
      `${data.title}-${data.author}的${u.TYPE_LABELS[data.type] || data.type}`
    );
    const commentFileName = `${baseName}-评论.md`;
    const needZip = wantImages || wantComment;

    articleLog(refs, `开始导出: type=${data.type}, title="${data.title}", author="${data.author}"`);
    articleLog(refs, `内容来源: ${data._source || '未知'}`);
    // 计算 HTML 纯文本长度用于对比
    const tmpDiv = document.createElement('div');
    tmpDiv.innerHTML = data.html || '';
    const plainTextLen = (tmpDiv.textContent || '').length;
    articleLog(refs, `HTML 长度: ${(data.html || '').length}, 纯文本: ${plainTextLen}, 图片: ${imgUrls.length} 张`);
    articleLog(refs, `选项: FM=${wantFm}, 图片=${wantImages}, 评论=${wantComment}`);
    articleLog(refs, `文件名: ${baseName}`);

    if (!data.html) {
      articleLog(refs, '警告：HTML 内容为空，导出的 Markdown 将没有正文', 'warn');
    }

    try {
      if (format === 'md') {
        // === EXISTING MARKDOWN LOGIC (unchanged) ===
        let imageMapping = {};
        let imageFiles = [];

        if (wantImages) {
          refs.btn.textContent = '正在下载图片...';
          articleLog(refs, `开始下载 ${imgUrls.length} 张图片...`);
          const result = await u.batchDownloadImages(imgUrls, '', (done, total) => {
            u.showProgress(refs, done, total, `正在下载图片 ${done}/${total}`);
          });
          imageMapping = result.imageMapping;
          imageFiles = result.imageFiles;
          const successCount = Object.keys(imageMapping).length;
          const failCount = imgUrls.length - successCount;
          articleLog(refs, `图片下载完成: 成功 ${successCount}, 失败 ${failCount}${failCount > 0 ? '' : ''}`, failCount > 0 ? 'warn' : 'info');
        }

        articleLog(refs, '正在转换 Markdown...');
        u.showProgress(refs, 1, 1, '正在生成 Markdown...');
        let md = htmlToMarkdown(data.html, imageMapping);
        const mdTextLen = md.length;
        if (wantFm) md = u.buildFrontmatter(data) + md;
        articleLog(refs, `Markdown 生成完成: ${mdTextLen} 字符（含FM: ${md.length}）`);
        if (plainTextLen > 0 && mdTextLen < plainTextLen * 0.5) {
          articleLog(refs, `警告：Markdown(${mdTextLen}) 远小于纯文本(${plainTextLen})，可能有内容丢失`, 'warn');
        }

        let commentMd = '';
        let commentImageFiles = [];

        if (wantComment) {
          refs.btn.textContent = '正在加载评论...';
          const pageInfo = api.detectPage(window.location.href);
          articleLog(refs, `加载评论: type=${pageInfo.type}, id=${pageInfo.id}`);
          const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
            u.showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
          });
          articleLog(refs, `评论加载完成: ${comments.length} 条根评论`);

          let commentImageMapping = {};
          if (wantImages && comments.length > 0) {
            const imgEntries = u.collectCommentImageEntries(comments);
            articleLog(refs, `评论图片: ${imgEntries.length} 张`);
            const imgResult = await u.downloadCommentImages(imgEntries, 'comment_');
            commentImageMapping = imgResult.imageMapping;
            commentImageFiles = imgResult.imageFiles;
          }

          u.showProgress(refs, 1, 1, '正在生成评论 Markdown...');
          commentMd = buildCommentsMarkdown(comments, data.title, commentImageMapping);

          const encodedCommentFile = encodeURIComponent(commentFileName).replace(/\(/g, '%28').replace(/\)/g, '%29');
          md += `\n\n---\n\n> [查看评论区](./${encodedCommentFile})\n`;
        }

        if (needZip) {
          u.showProgress(refs, 1, 1, '正在打包 ZIP...');
          articleLog(refs, `打包 ZIP: 文章=${baseName}.md${wantComment ? ', 评论=' + commentFileName : ''}, 图片=${imageFiles.length + commentImageFiles.length} 张`);
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
            (meta) => u.showProgress(refs, 1, 1, `正在压缩... ${Math.round(meta.percent)}%`)
          );
          articleLog(refs, `ZIP 生成完成: ${(blob.size / 1024).toFixed(1)} KB`);
          u.triggerDownload(blob, `${baseName}.zip`);
        } else {
          const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
          articleLog(refs, `MD 文件: ${(blob.size / 1024).toFixed(1)} KB`);
          u.triggerDownload(blob, `${baseName}.md`);
        }
      } else {
        // === DOCX 导出 ===
        if (typeof window.htmlToDocx !== 'function') {
          articleLog(refs, '正在加载 Word 导出库...', 'info');
          const resp = await chrome.runtime.sendMessage({ action: 'injectDocxLibs' });
          if (!resp?.success) {
            throw new Error('无法加载 Word 导出库: ' + (resp?.error || '未知错误'));
          }
        }

        let imageData = new Map();
        if (docxImgMode === 'embed' && imgUrls.length > 0) {
          refs.btn.textContent = '正在下载图片...';
          articleLog(refs, `开始下载 ${imgUrls.length} 张图片...`);
          const result = await u.batchDownloadImages(imgUrls, '', (done, total) => {
            u.showProgress(refs, done, total, `正在下载图片 ${done}/${total}`);
          });
          imageData = u.buildImageDataMap(result.imageMapping, result.imageFiles);
          articleLog(refs, `图片下载完成: ${imageData.size} 张`);
        }

        articleLog(refs, '正在生成 Word 文档...', 'info');
        u.showProgress(refs, 1, 1, '正在生成 Word 文档...');
        const frontMatter = refs.optFm.checked
          ? { id: data.id, title: data.title, author: data.author, url: data.url, date: new Date().toISOString().split('T')[0] }
          : null;
        const docxBlob = await window.htmlToDocx(data.html, {
          images: docxImgMode,
          imageData,
          frontMatter,
        });
        articleLog(refs, `Word 文档生成完成: ${(docxBlob.size / 1024).toFixed(1)} KB`);

        const baseName = u.sanitizeFilename(
          `${data.title}-${data.author}的${u.TYPE_LABELS[data.type] || data.type}`
        );

        if (wantComment) {
          refs.btn.textContent = '正在加载评论...';
          const pageInfo = api.detectPage(window.location.href);
          articleLog(refs, `加载评论: type=${pageInfo.type}, id=${pageInfo.id}`);
          const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
            u.showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
          });
          articleLog(refs, `评论加载完成: ${comments.length} 条根评论`);

          u.showProgress(refs, 1, 1, '正在生成评论文档...');
          const commentBlob = await window.commentsToDocx(comments, data.title);

          u.showProgress(refs, 1, 1, '正在打包 ZIP...');
          const zip = new JSZip();
          zip.file(`${baseName}.docx`, docxBlob);
          zip.file(`${baseName}-评论.docx`, commentBlob);
          const zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            (meta) => u.showProgress(refs, 1, 1, `正在压缩... ${Math.round(meta.percent)}%`)
          );
          articleLog(refs, `ZIP 生成完成: ${(zipBlob.size / 1024).toFixed(1)} KB`);
          u.triggerDownload(zipBlob, `${baseName}.zip`);
        } else {
          u.triggerDownload(docxBlob, `${baseName}.docx`);
        }
      }

      articleLog(refs, '下载成功 ✓');
      refs.btn.textContent = '下载成功 ✓';
      setTimeout(() => {
        refs.btn.disabled = false;
        updateBtnText();
        u.hideProgress(refs);
      }, 2000);
    } catch (err) {
      articleLog(refs, `导出失败: ${err.message}`, 'error');
      articleLog(refs, `错误堆栈: ${err.stack || '无'}`, 'error');
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  async function handleSaveToFolder(data, imgUrls, refs, dirHandle, pickFolder) {
    // 如果没有已选文件夹，先弹选择器
    if (!dirHandle) {
      dirHandle = await pickFolder();
      if (!dirHandle) return; // 用户取消
    }

    // 再次验证权限
    dirHandle = await verifyDirHandle(dirHandle);
    if (!dirHandle) {
      dirHandle = await pickFolder();
      if (!dirHandle) return;
    }

    refs.btn.disabled = true;
    refs.btnSaveFolder.disabled = true;

    const format = refs.panelBody.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = refs.panelBody.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
    const wantImages = refs.optImg.checked && imgUrls.length > 0;
    const wantFm = refs.optFm.checked;
    const wantComment = refs.optComment.checked;
    const baseName = u.sanitizeFilename(
      `${data.title}-${data.author}的${u.TYPE_LABELS[data.type] || data.type}`
    );
    const commentFileName = `${baseName}-评论.md`;

    articleLog(refs, `开始保存到文件夹: ${dirHandle.name}`);

    try {
      if (format === 'md') {
        // === EXISTING MARKDOWN LOGIC (unchanged) ===
        let imageMapping = {};

        if (wantImages) {
          refs.btnSaveFolder.textContent = '正在下载图片...';
          articleLog(refs, `开始下载 ${imgUrls.length} 张图片到文件夹...`);
          const imagesFolderHandle = await dirHandle.getDirectoryHandle('images', { create: true });
          const result = await u.batchDownloadImagesToFolder(imgUrls, '', imagesFolderHandle);
          imageMapping = result.imageMapping;
          articleLog(refs, `图片保存完成: ${Object.keys(imageMapping).length} 张`);
        }

        articleLog(refs, '正在转换 Markdown...');
        refs.btnSaveFolder.textContent = '正在生成 Markdown...';
        let md = htmlToMarkdown(data.html, imageMapping);
        if (wantFm) md = u.buildFrontmatter(data) + md;

        if (wantComment) {
          refs.btnSaveFolder.textContent = '正在加载评论...';
          const pageInfo = api.detectPage(window.location.href);
          const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
            u.showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
          });
          articleLog(refs, `评论加载完成: ${comments.length} 条根评论`);

          let commentImageMapping = {};
          if (wantImages && comments.length > 0) {
            const imgEntries = u.collectCommentImageEntries(comments);
            if (imgEntries.length > 0) {
              const imagesFolderHandle = await dirHandle.getDirectoryHandle('images', { create: true });
              // 下载评论图片到文件夹
              for (const entry of imgEntries) {
                for (let i = 0; i < entry.urls.length; i++) {
                  const url = entry.urls[i];
                  const result = await u.downloadImage(url);
                  if (result) {
                    const filename = `comment_${String(entry.commentIdx).padStart(3, '0')}_${String(i + 1).padStart(3, '0')}${result.ext}`;
                    commentImageMapping[url] = `images/${filename}`;
                    const fh = await imagesFolderHandle.getFileHandle(filename, { create: true });
                    const w = await fh.createWritable();
                    await w.write(result.buffer);
                    await w.close();
                  }
                }
              }
            }
          }

          const commentMd = buildCommentsMarkdown(comments, data.title, commentImageMapping);
          await u.writeTextFile(dirHandle, commentFileName, commentMd);
          articleLog(refs, `评论已保存: ${commentFileName}`);

          const encodedCommentFile = encodeURIComponent(commentFileName).replace(/\(/g, '%28').replace(/\)/g, '%29');
          md += `\n\n---\n\n> [查看评论区](./${encodedCommentFile})\n`;
        }

        await u.writeTextFile(dirHandle, `${baseName}.md`, md);
        articleLog(refs, `文章已保存: ${baseName}.md`);
      } else {
        // === DOCX 保存到文件夹 ===
        if (typeof window.htmlToDocx !== 'function') {
          articleLog(refs, '正在加载 Word 导出库...', 'info');
          const resp = await chrome.runtime.sendMessage({ action: 'injectDocxLibs' });
          if (!resp?.success) throw new Error('无法加载 Word 导出库: ' + (resp?.error || '未知错误'));
        }

        let imageData = new Map();
        if (docxImgMode === 'embed' && imgUrls.length > 0) {
          refs.btnSaveFolder.textContent = '正在下载图片...';
          articleLog(refs, `开始下载 ${imgUrls.length} 张图片...`);
          const result = await u.batchDownloadImages(imgUrls, '', (done, total) => {
            u.showProgress(refs, done, total, `正在下载图片 ${done}/${total}`);
          });
          imageData = u.buildImageDataMap(result.imageMapping, result.imageFiles);
          articleLog(refs, `图片下载完成: ${imageData.size} 张`);
        }

        articleLog(refs, '正在生成 Word 文档...');
        refs.btnSaveFolder.textContent = '正在生成 Word 文档...';
        const frontMatter = refs.optFm.checked
          ? { id: data.id, title: data.title, author: data.author, url: data.url, date: new Date().toISOString().split('T')[0] }
          : null;
        const docxBlob = await window.htmlToDocx(data.html, {
          images: docxImgMode,
          imageData,
          frontMatter,
        });

        if (wantComment) {
          refs.btnSaveFolder.textContent = '正在加载评论...';
          const pageInfo = api.detectPage(window.location.href);
          const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
            u.showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
          });
          articleLog(refs, `评论加载完成: ${comments.length} 条根评论`);

          const commentBlob = await window.commentsToDocx(comments, data.title);
          await u.writeBlobFile(dirHandle, `${baseName}-评论.docx`, commentBlob);
          articleLog(refs, `评论已保存: ${baseName}-评论.docx`);
        }

        await u.writeBlobFile(dirHandle, `${baseName}.docx`, docxBlob);
        articleLog(refs, `文章已保存: ${baseName}.docx`);
      }

      articleLog(refs, '保存成功 ✓');

      refs.btnSaveFolder.textContent = '保存成功 ✓';
      setTimeout(() => {
        refs.btn.disabled = false;
        refs.btnSaveFolder.disabled = false;
        refs.btnSaveFolder.textContent = '保存到文件夹';
        u.hideProgress(refs);
      }, 2000);
    } catch (err) {
      articleLog(refs, `保存失败: ${err.message}`, 'error');
      refs.btnSaveFolder.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
      refs.btnSaveFolder.disabled = false;
    }
  }

  window.__renderArticlePanel = renderArticlePanel;
})();
