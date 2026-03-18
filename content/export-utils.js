/**
 * 导出相关的共享工具函数
 * 挂载到 window.__exportUtils 供其他模块使用
 */

(() => {
  'use strict';

  const api = window.__zhihuDownloader;
  const TYPE_LABELS = { article: '文章', answer: '回答', question: '问题', pin: '想法' };

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
      `id: "${data.id || ''}"`,
      `title: "${(data.title || '').replace(/"/g, '\\"')}"`,
      `author: "${(data.author || '').replace(/"/g, '\\"')}"`,
      `type: zhihu-${data.type}`,
      `source: "${data.url}"`,
      `date: "${new Date().toISOString().split('T')[0]}"`,
      '---',
      '',
    ].join('\n');
  }

  function extractContentId(item) {
    const pageInfo = api.detectPage(item.url);
    return pageInfo ? pageInfo.id : '';
  }

  function sanitizeFilename(name) {
    return name
      .replace(/<[^>]*>/g, '')
      .replace(/[\\/:*?"<>|#^\[\]()（）]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
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

  async function batchDownloadImagesToFolder(urls, prefix, imagesFolderHandle) {
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

  async function writeTextFile(folderHandle, filename, text) {
    const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  function collectCommentImageEntries(comments) {
    const entries = [];
    let commentIdx = 0;
    for (const c of comments) {
      commentIdx++;
      const urls = extractCommentImageUrls(c.content || '');
      if (urls.length > 0) entries.push({ commentIdx, urls });
      for (const child of (c.child_comments || [])) {
        commentIdx++;
        const childUrls = extractCommentImageUrls(child.content || '');
        if (childUrls.length > 0) entries.push({ commentIdx, urls: childUrls });
      }
    }
    return entries;
  }

  async function downloadCommentImages(entries, prefix) {
    const imageMapping = {};
    const imageFiles = [];
    for (const entry of entries) {
      for (let i = 0; i < entry.urls.length; i++) {
        const url = entry.urls[i];
        const result = await downloadImage(url);
        if (result) {
          const filename = `${prefix}${String(entry.commentIdx).padStart(3, '0')}_${String(i + 1).padStart(3, '0')}${result.ext}`;
          imageMapping[url] = `images/${filename}`;
          imageFiles.push({ path: filename, buffer: result.buffer });
        }
      }
    }
    return { imageMapping, imageFiles };
  }

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

  window.__exportUtils = {
    TYPE_LABELS,
    showProgress,
    hideProgress,
    buildFrontmatter,
    extractContentId,
    sanitizeFilename,
    escapeHtml,
    triggerDownload,
    downloadImage,
    batchDownloadImages,
    batchDownloadImagesToFolder,
    writeTextFile,
    collectCommentImageEntries,
    downloadCommentImages,
    buildTocMarkdown,
  };
})();
