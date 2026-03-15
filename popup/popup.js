/**
 * Popup 主逻辑
 * 检测当前标签页是否为知乎页面，提取内容并下载
 * - 无图片：直接下载 .md 文件
 * - 有图片 + 勾选下载图片：下载 .zip（含 .md + images/）
 * - 有图片 + 未勾选：直接下载 .md（保留远程图片链接）
 */

(() => {
  'use strict';

  // DOM 元素
  const notZhihuEl = document.getElementById('not-zhihu');
  const detectedEl = document.getElementById('zhihu-detected');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorTextEl = document.getElementById('error-text');

  const contentTypeEl = document.getElementById('content-type');
  const contentTitleEl = document.getElementById('content-title');
  const contentAuthorEl = document.getElementById('content-author');
  const contentImagesEl = document.getElementById('content-images');
  const btnDownload = document.getElementById('btn-download');

  const optFrontmatter = document.getElementById('opt-frontmatter');
  const optImages = document.getElementById('opt-images');

  const progressArea = document.getElementById('progress-area');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  // 类型中文映射
  const TYPE_LABELS = {
    article: '文章',
    answer: '回答',
    question: '问题',
    pin: '想法',
  };

  // 缓存数据
  let extractedData = null;
  let imageUrls = [];

  /**
   * 显示指定状态区域
   */
  function showSection(section) {
    [notZhihuEl, detectedEl, loadingEl, errorEl].forEach((el) =>
      el.classList.add('hidden')
    );
    section.classList.remove('hidden');
  }

  /**
   * 显示错误
   */
  function showError(message) {
    errorTextEl.textContent = message;
    showSection(errorEl);
  }

  /**
   * 更新进度
   */
  function updateProgress(current, total, text) {
    progressArea.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = text || `${current}/${total}`;
  }

  /**
   * 隐藏进度
   */
  function hideProgress() {
    progressArea.classList.add('hidden');
    progressBar.style.width = '0%';
  }

  /**
   * 获取当前活动标签页
   */
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  /**
   * 向 content script 发送消息
   */
  function sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * 生成 frontmatter
   */
  function buildFrontmatter(data) {
    const lines = [
      '---',
      `title: "${data.title.replace(/"/g, '\\"')}"`,
      `author: "${data.author.replace(/"/g, '\\"')}"`,
      `type: zhihu-${data.type}`,
      `source: "${data.url}"`,
      `date: "${new Date().toISOString().split('T')[0]}"`,
      '---',
      '',
    ];
    return lines.join('\n');
  }

  /**
   * 移除文件名中的特殊字符
   */
  function sanitizeFilename(name) {
    return name
      .replace(/<[^>]*>/g, '')
      .replace(/[\\/:*?"<>|#^\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * 触发浏览器下载
   */
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * 下载单张图片，返回 ArrayBuffer + 元信息
   * @param {string} url - 图片 URL
   * @returns {Promise<{ buffer: ArrayBuffer, ext: string } | null>}
   */
  async function downloadImage(url) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;

      const contentType = response.headers.get('Content-Type') || '';
      const buffer = await response.arrayBuffer();
      const ext = window.inferImageExtension(url, contentType);

      return { buffer, ext };
    } catch {
      return null;
    }
  }

  /**
   * 生成基础文件名（无后缀）
   */
  function buildBaseName() {
    const { title, author, type } = extractedData;
    const typeLabel = TYPE_LABELS[type] || type;
    return sanitizeFilename(`${title}-${author}的${typeLabel}`);
  }

  /**
   * 处理下载（核心流程）
   */
  async function handleDownload() {
    if (!extractedData) {
      showError('未找到可下载的内容');
      return;
    }

    btnDownload.disabled = true;
    hideProgress();

    try {
      const { html } = extractedData;
      const baseName = buildBaseName();
      const wantImages = optImages.checked && imageUrls.length > 0;

      if (wantImages) {
        await downloadAsZip(html, baseName);
      } else {
        downloadAsMd(html, baseName);
      }

      btnDownload.textContent = '下载成功 ✓';
      setTimeout(() => {
        btnDownload.textContent = wantImages
          ? `下载 ZIP（含 ${imageUrls.length} 张图片）`
          : '下载 Markdown';
        btnDownload.disabled = false;
        hideProgress();
      }, 2000);
    } catch (error) {
      showError(error.message);
      btnDownload.textContent = '下载 Markdown';
      btnDownload.disabled = false;
      hideProgress();
    }
  }

  /**
   * 纯 Markdown 下载（无图片 / 不下载图片）
   */
  function downloadAsMd(html, baseName) {
    btnDownload.textContent = '正在转换...';

    let markdown = window.htmlToMarkdown(html);
    if (!markdown) {
      throw new Error('内容转换失败，请刷新页面后重试');
    }

    if (optFrontmatter.checked) {
      markdown = buildFrontmatter(extractedData) + markdown;
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, `${baseName}.md`);
  }

  /**
   * ZIP 下载（Markdown + 本地图片）
   */
  async function downloadAsZip(html, baseName) {
    const total = imageUrls.length;

    // 阶段 1：下载所有图片
    btnDownload.textContent = '正在下载图片...';
    updateProgress(0, total, `正在下载图片 0/${total}`);

    const imageMapping = {};  // url → 本地相对路径
    const imageFiles = [];    // { path, buffer }

    let completed = 0;

    // 并发下载，限制并发数为 5
    const concurrency = 5;
    const queue = [...imageUrls];
    let index = 0;

    async function worker() {
      while (index < queue.length) {
        const i = index++;
        const url = queue[i];

        const result = await downloadImage(url);
        completed++;
        updateProgress(completed, total, `正在下载图片 ${completed}/${total}`);

        if (result) {
          const filename = `image_${String(i + 1).padStart(3, '0')}${result.ext}`;
          const localPath = `images/${filename}`;

          imageMapping[url] = localPath;
          imageFiles.push({ path: localPath, buffer: result.buffer });
        }
        // 下载失败则保留原始 URL（不加入 mapping）
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, total) },
      () => worker()
    );
    await Promise.all(workers);

    // 阶段 2：生成 Markdown（用本地路径替换图片 URL）
    btnDownload.textContent = '正在打包...';
    updateProgress(total, total, '正在生成 Markdown...');

    let markdown = window.htmlToMarkdown(html, imageMapping);
    if (!markdown) {
      throw new Error('内容转换失败，请刷新页面后重试');
    }

    if (optFrontmatter.checked) {
      markdown = buildFrontmatter(extractedData) + markdown;
    }

    // 阶段 3：打包 ZIP
    updateProgress(total, total, '正在打包 ZIP...');

    const zip = new JSZip();
    zip.file(`${baseName}.md`, markdown);

    const imagesFolder = zip.folder('images');
    for (const file of imageFiles) {
      const filename = file.path.replace('images/', '');
      imagesFolder.file(filename, file.buffer);
    }

    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        updateProgress(total, total, `正在压缩... ${Math.round(meta.percent)}%`);
      }
    );

    triggerDownload(zipBlob, `${baseName}.zip`);
  }

  /**
   * 更新按钮文本和图片选项联动
   */
  function updateButtonText() {
    const hasImages = imageUrls.length > 0;

    if (hasImages && optImages.checked) {
      btnDownload.textContent = `下载 ZIP（含 ${imageUrls.length} 张图片）`;
    } else {
      btnDownload.textContent = '下载 Markdown';
    }
  }

  /**
   * 初始化：检测当前页面
   */
  async function init() {
    showSection(loadingEl);

    try {
      const tab = await getActiveTab();
      if (!tab?.url) {
        showSection(notZhihuEl);
        return;
      }

      // 检查是否是知乎页面
      const isZhihu =
        tab.url.includes('zhihu.com/question') ||
        tab.url.includes('zhuanlan.zhihu.com/p/') ||
        tab.url.includes('zhihu.com/pin/');

      if (!isZhihu) {
        showSection(notZhihuEl);
        return;
      }

      // 发送检测消息
      const detection = await sendMessage(tab.id, { action: 'detect' });
      if (!detection) {
        showSection(notZhihuEl);
        return;
      }

      // 提取内容
      const result = await sendMessage(tab.id, { action: 'extract' });
      if (!result?.success) {
        showError(result?.error || '内容提取失败');
        return;
      }

      extractedData = result.data;

      // 提取图片 URL 列表
      imageUrls = window.extractImageUrls(extractedData.html);

      // 显示内容信息
      contentTypeEl.textContent = TYPE_LABELS[extractedData.type] || extractedData.type;
      contentTitleEl.textContent = extractedData.title;
      contentAuthorEl.textContent = extractedData.author;
      contentImagesEl.textContent = imageUrls.length > 0
        ? `${imageUrls.length} 张`
        : '无';

      updateButtonText();
      showSection(detectedEl);
    } catch (error) {
      if (error.message.includes('Receiving end does not exist')) {
        showError('请刷新知乎页面后重试');
      } else {
        showError(`检测失败: ${error.message}`);
      }
    }
  }

  // 事件绑定
  btnDownload.addEventListener('click', handleDownload);
  optImages.addEventListener('change', updateButtonText);

  // 启动
  init();
})();
