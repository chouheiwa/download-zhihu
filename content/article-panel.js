/**
 * 单篇文章/回答/想法面板
 * 依赖：detector.js、html-to-markdown.js、export-utils.js、jszip.min.js
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  const u = window.__exportUtils;

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
    const baseName = u.sanitizeFilename(
      `${data.title}-${data.author}的${u.TYPE_LABELS[data.type] || data.type}`
    );
    const commentFileName = `${baseName}-评论.md`;
    const needZip = wantImages || wantComment;

    try {
      let imageMapping = {};
      let imageFiles = [];

      if (wantImages) {
        refs.btn.textContent = '正在下载图片...';
        const result = await u.batchDownloadImages(imgUrls, '', (done, total) => {
          u.showProgress(refs, done, total, `正在下载图片 ${done}/${total}`);
        });
        imageMapping = result.imageMapping;
        imageFiles = result.imageFiles;
      }

      u.showProgress(refs, 1, 1, '正在生成 Markdown...');
      let md = htmlToMarkdown(data.html, imageMapping);
      if (wantFm) md = u.buildFrontmatter(data) + md;

      let commentMd = '';
      let commentImageFiles = [];

      if (wantComment) {
        refs.btn.textContent = '正在加载评论...';
        const pageInfo = api.detectPage(window.location.href);
        const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
          u.showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
        });

        let commentImageMapping = {};
        if (wantImages && comments.length > 0) {
          const imgEntries = u.collectCommentImageEntries(comments);
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
        u.triggerDownload(blob, `${baseName}.zip`);
      } else {
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        u.triggerDownload(blob, `${baseName}.md`);
      }

      refs.btn.textContent = '下载成功 ✓';
      setTimeout(() => {
        refs.btn.disabled = false;
        updateBtnText();
        u.hideProgress(refs);
      }, 2000);
    } catch (err) {
      refs.btn.textContent = `失败: ${err.message}`;
      refs.btn.disabled = false;
    }
  }

  window.__renderArticlePanel = renderArticlePanel;
})();
