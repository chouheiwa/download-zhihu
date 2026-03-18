# 收藏夹分批导出 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将收藏夹导出改为基于时间线的分批导出，文章与评论独立管理，通过 Extension Page 提供完整的导出管理界面。

**Architecture:** 从 `detector.js` 抽取 API 调用层到 `lib/zhihu-api.js`，新增 `lib/throttle.js`（请求节流）和 `lib/progress.js`（进度文件管理）。收藏夹浮窗面板简化为跳转入口，所有导出逻辑迁移到 Extension Page（`export/`）。现有模块保持 IIFE + `window.*` 全局导出模式，Extension Page 通过 `<script>` 标签加载共享模块。

**Tech Stack:** Chrome Extension Manifest V3, File System Access API, Pico CSS

**Spec:** `docs/superpowers/specs/2026-03-18-collection-batch-export-design.md`

**Note:** 本项目无自动化测试框架，每个 Task 结束时通过手动验证确认功能正确。JSZip 保留给单篇文章面板（article-panel.js）使用，不删除。

---

### Task 1: 创建请求节流模块 `lib/throttle.js`

**Files:**
- Create: `lib/throttle.js`

- [ ] **Step 1: 创建 throttle.js**

```javascript
/**
 * 请求节流模块：统一的 API 请求间隔控制 + 403 指数退避重试
 * 挂载到 window.__throttle 供其他模块使用
 */

(() => {
  'use strict';

  const MIN_INTERVAL = 500; // 请求间最小间隔 (ms)
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF = 30000; // 首次 403 退避 30s

  let lastRequestTime = 0;
  let onRetryCallback = null;

  /**
   * 设置重试时的回调（用于 UI 通知）
   * @param {function(number, number, number): void} cb - (retryCount, maxRetries, waitMs)
   */
  function setOnRetry(cb) {
    onRetryCallback = cb;
  }

  /**
   * 等待直到满足最小请求间隔
   */
  async function waitForInterval() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL - elapsed));
    }
  }

  /**
   * 带节流和 403 重试的 fetch
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  async function throttledFetch(url, options) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await waitForInterval();
      lastRequestTime = Date.now();

      const response = await fetch(url, options);

      if (response.status === 403 && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        if (onRetryCallback) {
          onRetryCallback(attempt + 1, MAX_RETRIES, backoff);
        }
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      return response;
    }

    // 不应到达这里，但作为保底
    throw new Error('请求失败：已达最大重试次数');
  }

  window.__throttle = {
    throttledFetch,
    setOnRetry,
  };
})();
```

- [ ] **Step 2: 验证**

在浏览器开发者工具 Console 中手动测试：
```javascript
// 加载后检查全局对象存在
typeof window.__throttle.throttledFetch === 'function' // true
```

- [ ] **Step 3: Commit**

```bash
git add lib/throttle.js
git commit -m "feat: 新增请求节流模块 lib/throttle.js"
```

---

### Task 2: 抽取 API 调用层到 `lib/zhihu-api.js`

**Files:**
- Create: `lib/zhihu-api.js`
- Modify: `content/detector.js:207-317` (删除 API 函数，改为委托)
- Modify: `content/export-utils.js:9` (更改 api 引用)

- [ ] **Step 1: 创建 lib/zhihu-api.js**

从 `detector.js` 抽取 `fetchCollectionPage`、评论 API 以及 `detectPage`（被 `export-utils.js` 的 `extractContentId` 使用）。使用 `throttledFetch` 替代原始 `fetch`。

```javascript
/**
 * 知乎 API 调用层
 * 从 detector.js 抽取，使用 throttledFetch 实现请求节流
 * 挂载到 window.__zhihuApi 供 Extension Page 和 content script 使用
 */

(() => {
  'use strict';

  const throttle = window.__throttle;

  function apiFetch(url) {
    return throttle.throttledFetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
  }

  // ============================
  // 页面类型检测（纯函数，无 DOM 依赖）
  // ============================

  function detectPage(url) {
    const patterns = [
      { type: 'answer', regex: /zhihu\.com\/question\/(\d+)\/answer\/(\d+)/ },
      { type: 'article', regex: /zhuanlan\.zhihu\.com\/p\/(\d+)/ },
      { type: 'question', regex: /zhihu\.com\/question\/(\d+)\/?(\?|$|#)/ },
      { type: 'pin', regex: /zhihu\.com\/pin\/(\d+)/ },
      { type: 'collection', regex: /zhihu\.com\/collection\/(\d+)/ },
    ];

    for (const { type, regex } of patterns) {
      const match = url.match(regex);
      if (match) {
        const id = type === 'answer' ? match[2] : match[1];
        return { type, id };
      }
    }
    return null;
  }

  // ============================
  // 收藏夹 API
  // ============================

  async function fetchCollectionPage(apiUrl) {
    const response = await apiFetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    const paging = data.paging || {};
    const items = (data.data || []).map((item) => {
      const c = item.content || {};
      const type = c.type || 'unknown';

      let title = '';
      if (type === 'article') {
        title = c.title || '';
      } else if (type === 'answer') {
        title = c.question?.title || '';
      }

      return {
        type,
        url: c.url || '',
        title,
        author: c.author?.name || '知乎用户',
        html: c.content || '',
        created_time: item.created_time || 0,
      };
    });

    return {
      items,
      nextUrl: paging.is_end ? null : (paging.next || null),
      totals: paging.totals || 0,
    };
  }

  // ============================
  // 评论 API
  // ============================

  const COMMENT_TYPE_MAP = {
    article: 'articles',
    answer: 'answers',
    pin: 'pins',
  };

  async function fetchRootComments(type, id) {
    const apiType = COMMENT_TYPE_MAP[type];
    if (!apiType) return { comments: [], totals: 0 };

    const comments = [];
    let totals = 0;
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/${apiType}/${id}/root_comment?order_by=ts&limit=20&offset=`;

    while (nextUrl) {
      const response = await apiFetch(nextUrl);
      if (!response.ok) throw new Error(`评论 API 请求失败: ${response.status}`);

      const data = await response.json();
      const paging = data.paging || {};
      totals = paging.totals ?? totals;
      comments.push(...(data.data || []));
      nextUrl = paging.is_end ? null : (paging.next || null);
    }

    return { comments, totals };
  }

  async function fetchChildComments(rootCommentId) {
    const children = [];
    let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/comment/${rootCommentId}/child_comment?order_by=ts&limit=20&offset=`;

    while (nextUrl) {
      const response = await apiFetch(nextUrl);
      if (!response.ok) break;

      const data = await response.json();
      const paging = data.paging || {};
      children.push(...(data.data || []));
      nextUrl = paging.is_end ? null : (paging.next || null);
    }

    return children;
  }

  async function fetchAllComments(type, id, onProgress) {
    const { comments } = await fetchRootComments(type, id);

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];

      if (comment.child_comment_count > 0 &&
          (comment.child_comments || []).length < comment.child_comment_count) {
        comment.child_comments = await fetchChildComments(comment.id);
      }

      if (onProgress) onProgress(i + 1, comments.length);
    }

    return comments;
  }

  window.__zhihuApi = {
    detectPage,
    fetchCollectionPage,
    fetchRootComments,
    fetchChildComments,
    fetchAllComments,
  };
})();
```

**关键变化：**
- `fetchCollectionPage` 返回的 `items` 新增 `created_time` 字段（收藏时间），从 `item.created_time` 获取
- 所有 `fetch()` 改为 `apiFetch()` 经过节流

- [ ] **Step 2: 修改 content/detector.js**

删除 `fetchCollectionPage`、评论 API 相关代码（第 207-317 行），以及 `detectPage` 函数（第 13-30 行）。改为从 `window.__zhihuApi` 委托。保留 `extractContent`、`getCollectionInfo` 等需要 DOM 的函数。

修改后的 `detector.js`：

```javascript
/**
 * 数据层：知乎页面检测 + 内容提取 + 收藏夹信息
 * 依赖 lib/zhihu-api.js（API 调用层）
 * 所有函数挂载到 window.__zhihuDownloader 供 floating-ui.js 调用
 */

(() => {
  'use strict';

  const zhihuApi = window.__zhihuApi;

  // ============================
  // 单篇内容提取
  // ============================

  function extractContent() {
    const url = window.location.href;
    const pageInfo = zhihuApi.detectPage(url);
    if (!pageInfo || pageInfo.type === 'collection') {
      return null;
    }

    const initialData = extractInitialData();
    if (initialData) {
      return extractFromInitialData(initialData, pageInfo, url);
    }
    return extractFromDOM(pageInfo, url);
  }

  function extractInitialData() {
    const scriptTag = document.querySelector('script#js-initialData[type="text/json"]');
    if (!scriptTag || !scriptTag.textContent) return null;
    try {
      return JSON.parse(scriptTag.textContent);
    } catch {
      return null;
    }
  }

  function extractFromInitialData(jsonData, pageInfo, url) {
    const { type, id } = pageInfo;

    switch (type) {
      case 'answer': {
        const questionMatch = url.match(/question\/(\d+)/);
        const questionId = questionMatch ? questionMatch[1] : '';
        const data = jsonData?.initialState?.entities?.answers?.[id];
        return {
          type, url,
          title: data?.question?.title || `知乎问题${questionId}`,
          author: data?.author?.name || '知乎用户',
          html: data?.content || '',
        };
      }
      case 'article': {
        const data = jsonData?.initialState?.entities?.articles?.[id];
        return {
          type, url,
          title: data?.title || `知乎文章${id}`,
          author: data?.author?.name || '知乎用户',
          html: data?.content || '',
        };
      }
      case 'question': {
        const data = jsonData?.initialState?.entities?.questions?.[id];
        const detail = data?.detail || '';
        const title = data?.title || `知乎问题${id}`;
        const asker = data?.author?.name || '知乎用户';

        const answers = jsonData?.initialState?.entities?.answers || {};
        let answersHtml = '';
        for (const key in answers) {
          const answer = answers[key];
          const aAuthor = answer?.author?.name || '知乎用户';
          const aUrl = `https://www.zhihu.com/question/${id}/answer/${answer?.id}`;
          answersHtml += `<h1><a href="${aUrl}">${aAuthor}的回答</a></h1>`;
          answersHtml += `<div>${answer?.content || ''}</div>`;
        }

        return { type, url, title, author: asker, html: detail + answersHtml };
      }
      case 'pin': {
        const pinData = jsonData?.initialState?.entities?.pins?.[id];
        const users = jsonData?.initialState?.entities?.users || {};

        let author = '知乎用户';
        for (const key in users) {
          if (users[key]?.name) { author = users[key].name; break; }
        }

        const contentHtml = typeof pinData?.contentHtml === 'string' ? pinData.contentHtml : '';
        const contentArr = Array.isArray(pinData?.content) ? pinData.content : [];
        const imgsHtml = contentArr
          .filter((e) => e?.type === 'image' && e?.originalUrl)
          .map((e) => {
            const w = e.width ? ` width="${e.width}"` : '';
            const h = e.height ? ` height="${e.height}"` : '';
            return `<img src="${e.originalUrl}" alt=""${w}${h} />`;
          })
          .join('\n');

        return {
          type, url,
          title: `想法${id}`,
          author,
          html: contentHtml + (imgsHtml ? `<div>${imgsHtml}</div>` : ''),
        };
      }
      default:
        return null;
    }
  }

  function extractFromDOM(pageInfo, url) {
    const { type } = pageInfo;
    switch (type) {
      case 'article': {
        const titleEl = document.querySelector('.Post-Title');
        const contentEl = document.querySelector('.Post-RichText');
        const authorEl = document.querySelector('.AuthorInfo-name .UserLink-link');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎文章',
          author: authorEl?.textContent?.trim() || '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      case 'answer': {
        const titleEl = document.querySelector('.QuestionHeader-title');
        const contentEl = document.querySelector('.RichContent-inner');
        const authorEl = document.querySelector('.AuthorInfo-name .UserLink-link');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎回答',
          author: authorEl?.textContent?.trim() || '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      case 'question': {
        const titleEl = document.querySelector('.QuestionHeader-title');
        const detailEl = document.querySelector('.QuestionRichText--collapsed, .QuestionRichText--expandable');
        return {
          type, url,
          title: titleEl?.textContent?.trim() || '知乎问题',
          author: '知乎用户',
          html: detailEl?.innerHTML || '',
        };
      }
      case 'pin': {
        const contentEl = document.querySelector('.PinItem-contentWrapper');
        return {
          type, url,
          title: '知乎想法',
          author: '知乎用户',
          html: contentEl?.innerHTML || '',
        };
      }
      default:
        return null;
    }
  }

  // ============================
  // 收藏夹信息（需要 DOM）
  // ============================

  function getCollectionInfo() {
    const url = window.location.href;
    const match = url.match(/zhihu\.com\/collection\/(\d+)/);
    if (!match) return null;

    const id = match[1];
    const titleEl =
      document.querySelector('.CollectionDetailPageHeader-title') ||
      document.querySelector('[class*="CollectionDetail"] h2') ||
      document.querySelector('h1');

    return {
      id,
      title: titleEl?.textContent?.trim() || `收藏夹${id}`,
      itemCount: 0,
      apiUrl: `https://www.zhihu.com/api/v4/collections/${id}/items?offset=0&limit=20`,
    };
  }

  // ============================
  // 导出到 window（兼容现有调用方）
  // ============================

  window.__zhihuDownloader = {
    detectPage: zhihuApi.detectPage,
    extractContent,
    getCollectionInfo,
    fetchCollectionPage: zhihuApi.fetchCollectionPage,
    fetchAllComments: zhihuApi.fetchAllComments,
  };
})();
```

- [ ] **Step 3: 修改 content/export-utils.js**

`export-utils.js` 第 9 行 `const api = window.__zhihuDownloader;` 保持不变（`window.__zhihuDownloader` 仍然暴露 `detectPage`），因为 `extractContentId` 使用 `api.detectPage()`。无需修改此文件。

但是在 Extension Page 中，`export-utils.js` 会被加载，此时 `window.__zhihuDownloader` 不存在（因为 `detector.js` 不在 Extension Page 加载）。我们需要在 Extension Page 的脚本中补一个兼容层。

在 `export/export.js` 中（Task 8 实现），在加载 `export-utils.js` 之前，设置：
```javascript
window.__zhihuDownloader = window.__zhihuApi;
```

这样 `export-utils.js` 中的 `api.detectPage()` 就能找到函数。

- [ ] **Step 4: 更新 manifest.json 中 content_scripts 的加载顺序**

在 `content_scripts.js` 数组中，`lib/throttle.js` 和 `lib/zhihu-api.js` 必须在 `content/detector.js` 之前加载。

修改 `manifest.json` 的 `content_scripts[0].js` 为：
```json
[
  "lib/turndown.js",
  "lib/jszip.min.js",
  "lib/html-to-markdown.js",
  "lib/throttle.js",
  "lib/zhihu-api.js",
  "content/detector.js",
  "content/export-utils.js",
  "content/article-panel.js",
  "content/collection-panel.js",
  "content/floating-ui.js"
]
```

同时添加 `host_permissions`：
```json
"host_permissions": [
  "https://www.zhihu.com/*",
  "https://zhuanlan.zhihu.com/*"
]
```

- [ ] **Step 5: 验证**

1. 重新加载插件
2. 打开任意知乎文章页面，确认浮窗能正常显示
3. 点击下载单篇文章，确认功能正常（验证 API 委托没有破坏现有功能）
4. 打开收藏夹页面，确认面板能正常显示收藏夹信息和数量

- [ ] **Step 6: Commit**

```bash
git add lib/zhihu-api.js content/detector.js manifest.json
git commit -m "refactor: 抽取 API 调用层到 lib/zhihu-api.js，集成节流模块"
```

---

### Task 3: 创建进度管理模块 `lib/progress.js`

**Files:**
- Create: `lib/progress.js`

- [ ] **Step 1: 创建 progress.js**

```javascript
/**
 * 进度文件读写管理
 * 使用 File System Access API 操作 export-progress.json
 * 挂载到 window.__progress
 */

(() => {
  'use strict';

  const PROGRESS_FILENAME = 'export-progress.json';

  /**
   * 读取进度文件
   * @param {FileSystemDirectoryHandle} dirHandle
   * @returns {Promise<Object|null>}
   */
  async function readProgress(dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(PROGRESS_FILENAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * 写入进度文件
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {Object} progressData
   */
  async function writeProgress(dirHandle, progressData) {
    const fileHandle = await dirHandle.getFileHandle(PROGRESS_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(progressData, null, 2));
    await writable.close();
  }

  /**
   * 创建初始进度数据
   * @param {string} collectionId
   * @param {string} collectionName
   * @returns {Object}
   */
  function createInitialProgress(collectionId, collectionName) {
    return {
      collectionId,
      collectionName,
      articles: {
        newestExportedTime: null,
        totalAtLastExport: 0,
        nextOffset: 0,
        totalExported: 0,
        batchSize: 50,
      },
      comments: {
        exportedArticles: [],
        totalExported: 0,
      },
    };
  }

  /**
   * 文章导出完一批后更新进度
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {Object} progress - 当前进度对象
   * @param {string} newestTime - 本批最新文章的收藏时间 (ISO string)
   * @param {number} batchCount - 本批导出数量
   * @param {number} currentTotal - 当前收藏夹总数
   * @param {number} nextOffset - 下次开始的 offset
   */
  async function updateArticleProgress(dirHandle, progress, newestTime, batchCount, currentTotal, nextOffset) {
    progress.articles.newestExportedTime = newestTime;
    progress.articles.totalExported += batchCount;
    progress.articles.totalAtLastExport = currentTotal;
    progress.articles.nextOffset = nextOffset;
    await writeProgress(dirHandle, progress);
  }

  /**
   * 评论导出完一篇后更新进度
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {Object} progress - 当前进度对象
   * @param {string} articleId - 已导出评论的文章 ID
   */
  async function updateCommentProgress(dirHandle, progress, articleId) {
    if (!progress.comments.exportedArticles.includes(articleId)) {
      progress.comments.exportedArticles.push(articleId);
      progress.comments.totalExported = progress.comments.exportedArticles.length;
    }
    await writeProgress(dirHandle, progress);
  }

  window.__progress = {
    readProgress,
    writeProgress,
    createInitialProgress,
    updateArticleProgress,
    updateCommentProgress,
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add lib/progress.js
git commit -m "feat: 新增进度文件管理模块 lib/progress.js"
```

---

### Task 4: 简化收藏夹浮窗面板 `collection-panel.js`

**Files:**
- Modify: `content/collection-panel.js` (完全重写)

- [ ] **Step 1: 重写 collection-panel.js**

删除所有导出逻辑（`handleCollectionExport`、`handleCollectionExportToFolder`、`prepareItemMeta`、`processItemComments`），只保留基本信息展示 + 跳转按钮。

```javascript
/**
 * 收藏夹面板（简化版）
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
      <button id="btn-open-manager" class="btn" disabled>打开导出管理器</button>
    `;

    const countEl = body.querySelector('#col-count');
    const btn = body.querySelector('#btn-open-manager');

    api.fetchCollectionPage(info.apiUrl).then((result) => {
      info.itemCount = result.totals;
      countEl.textContent = `${result.totals} 篇`;
      btn.disabled = false;
    }).catch(() => {
      countEl.textContent = '获取失败';
    });

    btn.addEventListener('click', () => {
      const exportUrl = chrome.runtime.getURL(
        `export/export.html?id=${encodeURIComponent(info.id)}&name=${encodeURIComponent(info.title)}&api=${encodeURIComponent(info.apiUrl)}`
      );
      window.open(exportUrl, '_blank');
    });
  }

  window.__renderCollectionPanel = renderCollectionPanel;
})();
```

- [ ] **Step 2: 验证**

1. 重新加载插件
2. 打开知乎收藏夹页面
3. 确认浮窗显示简化后的面板：类型、名称、数量、"打开导出管理器"按钮
4. 点击按钮确认能打开新标签页（此时 export.html 还不存在，会 404，属正常）

- [ ] **Step 3: Commit**

```bash
git add content/collection-panel.js
git commit -m "refactor: 简化收藏夹面板为跳转入口"
```

---

### Task 5: 下载 Pico CSS 并创建 Extension Page 骨架

**Files:**
- Create: `lib/pico.min.css`
- Create: `export/export.html`
- Create: `export/export.css`

- [ ] **Step 1: 下载 Pico CSS**

```bash
curl -o lib/pico.min.css https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css
```

- [ ] **Step 2: 创建 export/export.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>知乎收藏夹导出管理器</title>
  <link rel="stylesheet" href="../lib/pico.min.css">
  <link rel="stylesheet" href="export.css">
</head>
<body>
  <main class="container">
    <header>
      <h1>知乎收藏夹导出管理器</h1>
      <p id="collection-name">收藏夹：加载中...</p>
    </header>

    <!-- 文件夹选择区 -->
    <article id="folder-section">
      <header>选择导出文件夹</header>
      <div class="folder-info">
        <span id="folder-path">未选择文件夹</span>
        <button id="btn-select-folder" class="outline">选择文件夹</button>
      </div>
    </article>

    <!-- 文章导出区 -->
    <article id="article-section">
      <header>文章导出</header>
      <div id="article-status" class="status-info">
        <p>请先选择导出文件夹</p>
      </div>
      <div class="options-row">
        <label>
          每批数量:
          <input type="number" id="article-batch-size" value="50" min="1" max="500" class="batch-input">
          篇
        </label>
        <label>
          <input type="checkbox" id="opt-img" checked>
          下载图片到本地
        </label>
      </div>
      <small class="hint">Front Matter 始终包含（评论导出依赖其中的文章信息）</small>
      <div id="article-progress-wrap" class="progress-wrap hidden">
        <progress id="article-progress" value="0" max="100"></progress>
        <small id="article-progress-text"></small>
      </div>
      <button id="btn-export-articles" disabled>开始导出</button>
    </article>

    <!-- 评论导出区 -->
    <article id="comment-section">
      <header>评论导出</header>
      <div id="comment-status" class="status-info">
        <p>请先选择导出文件夹</p>
      </div>
      <div class="options-row">
        <label>
          每批数量:
          <input type="number" id="comment-batch-size" value="50" min="1" max="500" class="batch-input">
          篇
        </label>
      </div>
      <div id="comment-progress-wrap" class="progress-wrap hidden">
        <progress id="comment-progress" value="0" max="100"></progress>
        <small id="comment-progress-text"></small>
      </div>
      <button id="btn-export-comments" disabled>开始导出评论</button>
    </article>

    <!-- 状态日志区 -->
    <article id="log-section">
      <header>操作日志</header>
      <div id="log-output" class="log-area"></div>
    </article>
  </main>

  <!-- 共享模块 -->
  <script src="../lib/turndown.js"></script>
  <script src="../lib/html-to-markdown.js"></script>
  <script src="../lib/throttle.js"></script>
  <script src="../lib/zhihu-api.js"></script>
  <script src="../lib/progress.js"></script>
  <!-- 兼容层：让 export-utils.js 能找到 api.detectPage -->
  <script>window.__zhihuDownloader = window.__zhihuApi;</script>
  <script src="../content/export-utils.js"></script>
  <!-- 页面主逻辑 -->
  <script src="export.js"></script>
</body>
</html>
```

- [ ] **Step 3: 创建 export/export.css**

```css
/* 自定义样式，配合 Pico CSS */

header h1 {
  margin-bottom: 0.25rem;
}

header p {
  color: var(--pico-muted-color);
  margin-bottom: 0;
}

.folder-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

#folder-path {
  flex: 1;
  color: var(--pico-muted-color);
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-input {
  width: 80px;
  display: inline-block;
  padding: 0.25rem 0.5rem;
  margin: 0 0.25rem;
}

.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
}

.options-row label {
  font-size: 0.9rem;
  margin-bottom: 0;
  cursor: pointer;
}

.status-info {
  margin-bottom: 1rem;
}

.status-info p {
  margin-bottom: 0.25rem;
}

.progress-wrap {
  margin-bottom: 1rem;
}

.progress-wrap progress {
  width: 100%;
  margin-bottom: 0.25rem;
}

.progress-wrap small {
  color: var(--pico-muted-color);
}

.hint {
  display: block;
  color: var(--pico-muted-color);
  margin-bottom: 0.5rem;
}

.hidden {
  display: none !important;
}

/* 操作日志 */
.log-area {
  max-height: 200px;
  overflow-y: auto;
  font-size: 0.8rem;
  font-family: monospace;
  background: var(--pico-code-background-color);
  padding: 0.75rem;
  border-radius: var(--pico-border-radius);
}

.log-area .log-entry {
  margin-bottom: 0.25rem;
  line-height: 1.4;
}

.log-area .log-time {
  color: var(--pico-muted-color);
  margin-right: 0.5rem;
}

.log-area .log-warn {
  color: #e67e22;
}

.log-area .log-error {
  color: #e74c3c;
}

.log-area .log-success {
  color: #27ae60;
}
```

- [ ] **Step 4: 验证**

1. 重新加载插件
2. 在知乎收藏夹页面点击"打开导出管理器"
3. 确认 Extension Page 能打开，显示基本布局（此时功能按钮还不工作）
4. 确认 Pico CSS 样式正常加载

- [ ] **Step 5: Commit**

```bash
git add lib/pico.min.css export/export.html export/export.css
git commit -m "feat: 创建 Extension Page 骨架和样式"
```

---

### Task 6: 实现 Extension Page 文件夹选择和进度加载

**Files:**
- Create: `export/export.js` (第一部分：初始化 + 文件夹选择 + 进度加载)

- [ ] **Step 1: 创建 export.js 初始化和文件夹逻辑**

```javascript
/**
 * 导出管理器 Extension Page 主逻辑
 * 依赖：zhihu-api.js, progress.js, export-utils.js, html-to-markdown.js
 */

(() => {
  'use strict';

  const api = window.__zhihuApi;
  const progress = window.__progress;
  const u = window.__exportUtils;

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
    commentBatchSize: document.getElementById('comment-batch-size'),
    commentProgressWrap: document.getElementById('comment-progress-wrap'),
    commentProgress: document.getElementById('comment-progress'),
    commentProgressText: document.getElementById('comment-progress-text'),
    btnExportComments: document.getElementById('btn-export-comments'),
    logOutput: document.getElementById('log-output'),
  };

  // ============================
  // 状态
  // ============================

  let dirHandle = null;          // 用户选择的文件夹 handle
  let progressData = null;       // 进度数据
  let currentTotal = 0;          // 收藏夹当前总数
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
  // 进度条辅助
  // ============================

  function showArticleProgress(current, total, text) {
    els.articleProgressWrap.classList.remove('hidden');
    els.articleProgress.value = total > 0 ? Math.round((current / total) * 100) : 0;
    els.articleProgress.max = 100;
    els.articleProgressText.textContent = text;
  }

  function hideArticleProgress() {
    els.articleProgressWrap.classList.add('hidden');
  }

  function showCommentProgress(current, total, text) {
    els.commentProgressWrap.classList.remove('hidden');
    els.commentProgress.value = total > 0 ? Math.round((current / total) * 100) : 0;
    els.commentProgress.max = 100;
    els.commentProgressText.textContent = text;
  }

  function hideCommentProgress() {
    els.commentProgressWrap.classList.add('hidden');
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

    log(`已加载收藏夹：${collectionName}（ID: ${collectionId}）`);

    // 获取收藏夹当前总数
    fetchCollectionTotal();
  }

  async function fetchCollectionTotal() {
    try {
      const result = await api.fetchCollectionPage(collectionApiUrl);
      currentTotal = result.totals;
      log(`收藏夹共 ${currentTotal} 篇内容`);
      updateUI();
    } catch (err) {
      log(`获取收藏夹信息失败: ${err.message}`, 'error');
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

      // 读取进度文件
      progressData = await progress.readProgress(dirHandle);

      if (progressData) {
        log(`找到进度文件，已导出 ${progressData.articles.totalExported} 篇文章、${progressData.comments.totalExported} 篇评论`);
        // 恢复批次大小设置
        if (progressData.articles.batchSize) {
          els.articleBatchSize.value = progressData.articles.batchSize;
        }
      } else {
        progressData = progress.createInitialProgress(collectionId, collectionName);
        log('未找到进度文件，将从头开始导出');
      }

      updateUI();
    } catch (err) {
      if (err.name !== 'AbortError') {
        log(`选择文件夹失败: ${err.message}`, 'error');
      }
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

    // 按钮文案
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
    const totalArticles = progressData.articles.totalExported; // 评论基于已导出的文章
    const remaining = Math.max(0, totalArticles - exportedComments);
    const pct = totalArticles > 0 ? Math.round((exportedComments / totalArticles) * 100) : 0;

    let statusHtml = `<p>已导出 ${exportedComments} / ${totalArticles} 篇文章的评论</p>`;
    statusHtml += `<progress value="${pct}" max="100"></progress>`;
    els.commentStatus.innerHTML = statusHtml;

    if (isExportingComments) {
      els.btnExportComments.textContent = '导出中...';
      els.btnExportComments.disabled = true;
    } else if (totalArticles === 0) {
      els.btnExportComments.textContent = '请先导出文章';
      els.btnExportComments.disabled = true;
    } else if (remaining === 0 && exportedComments > 0) {
      els.btnExportComments.textContent = '已全部导出 ✓';
      els.btnExportComments.disabled = true;
    } else if (exportedComments === 0) {
      els.btnExportComments.textContent = '开始导出评论';
      els.btnExportComments.disabled = false;
    } else {
      els.btnExportComments.textContent = `继续导出评论（剩余 ${remaining} 篇）`;
      els.btnExportComments.disabled = false;
    }
  }

  // ============================
  // 占位：文章导出和评论导出（Task 7, 8 实现）
  // ============================

  async function handleExportArticles() {
    log('文章导出功能即将实现...', 'warn');
  }

  async function handleExportComments() {
    log('评论导出功能即将实现...', 'warn');
  }

  // ============================
  // 启动
  // ============================

  init();
})();
```

- [ ] **Step 2: 验证**

1. 重新加载插件
2. 从收藏夹浮窗点击"打开导出管理器"
3. 确认页面正确显示收藏夹名称和总数
4. 点击"选择文件夹"选择一个空文件夹，确认显示"未找到进度文件"
5. 确认文章导出按钮变为"开始导出"且可点击
6. 确认评论导出按钮变为"请先导出文章"且禁用

- [ ] **Step 3: Commit**

```bash
git add export/export.js
git commit -m "feat: 实现 Extension Page 初始化、文件夹选择和进度加载"
```

---

### Task 7: 实现文章分批导出逻辑

**Files:**
- Modify: `export/export.js` (替换 `handleExportArticles` 占位)

- [ ] **Step 1: 实现 handleExportArticles**

替换 `export/export.js` 中的 `handleExportArticles` 函数：

```javascript
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

      // ========================================
      // 分页定位算法（参考 spec "文章导出定位算法"）
      // ========================================
      //
      // 知乎 API 返回顺序：offset=0 是最新，offset 越大越旧。
      // 我们要从旧到新导出，所以：
      //   - 首次导出：从最大 offset（最旧）开始
      //   - 后续导出：从上次记录的 nextOffset 开始（已包含偏移调整）
      //   - 每页读到的数据按收藏时间升序处理（reverse API 返回）
      //   - 时间戳兜底：跳过 <= newestExportedTime 的文章
      //   - 每次处理完一页后 offset 减小（向更新方向移动）
      //
      // 示例：收藏夹 500 篇，每页 20 篇
      //   首次：offset=480 → 读到最旧的 20 篇 → offset=460 → ...
      //   导出 50 篇后 nextOffset=430, totalAtLastExport=500
      //   下次打开，总数变 520（新增 20）：
      //     adjustedOffset = 430 + (520-500) = 450 → 从这里继续

      // Step 1: 计算起始 offset
      let startOffset;
      if (progressData.articles.newestExportedTime) {
        const savedOffset = progressData.articles.nextOffset || 0;
        const totalDiff = currentTotal - (progressData.articles.totalAtLastExport || currentTotal);
        startOffset = Math.max(0, savedOffset + totalDiff);
        log(`继续导出：offset=${startOffset}（保存=${savedOffset}，偏移调整=${totalDiff}）`);
      } else {
        // 首次：从最旧的开始，即最大 offset，向下对齐到页边界
        const pageSize = 20;
        startOffset = Math.max(0, Math.floor((currentTotal - 1) / pageSize) * pageSize);
        log(`首次导出，从 offset ${startOffset} 开始（最旧一页）`);
      }

      // Step 2: 分页获取并处理文章
      const newestExportedTime = progressData.articles.newestExportedTime;
      let exportedInBatch = 0;
      let newestTimeInBatch = newestExportedTime;
      let currentOffset = startOffset;
      const usedNames = new Set();
      const tocEntries = [];
      let reachedNewest = false;

      while (exportedInBatch < batchSize && !reachedNewest && currentOffset >= 0) {
        const pageUrl = collectionApiUrl.replace(/offset=\d+/, `offset=${currentOffset}`);
        showArticleProgress(exportedInBatch, batchSize, `正在加载 offset=${currentOffset}...`);
        log(`请求 offset=${currentOffset}...`);

        let result;
        try {
          result = await api.fetchCollectionPage(pageUrl);
        } catch (err) {
          log(`请求失败: ${err.message}`, 'error');
          break;
        }

        if (result.items.length === 0) {
          break;
        }

        // API 返回从新到旧，reverse 使其从旧到新
        const items = result.items.reverse();

        for (const item of items) {
          if (exportedInBatch >= batchSize) break;

          // 时间戳兜底：跳过已导出的
          const itemTime = item.created_time
            ? new Date(item.created_time * 1000).toISOString()
            : null;

          if (newestExportedTime && itemTime && itemTime <= newestExportedTime) {
            continue; // 已导出过，跳过
          }

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
          const filename = `${baseName}.md`;

          showArticleProgress(exportedInBatch, batchSize,
            `正在处理 ${exportedInBatch}/${batchSize}: ${(item.title || '').slice(0, 20)}...`);
          log(`处理 [${exportedInBatch}/${batchSize}]: ${item.title || baseName}`);

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

          // 转换 Markdown（始终生成 Front Matter，评论导出依赖它提取文章信息）
          let md = htmlToMarkdown(item.html || '', imageMapping);
          md = u.buildFrontmatter(item) + md;

          // 写入文件
          await u.writeTextFile(articlesFolder, filename, md);

          // 更新本批最新时间
          if (itemTime && (!newestTimeInBatch || itemTime > newestTimeInBatch)) {
            newestTimeInBatch = itemTime;
          }

          tocEntries.push({
            num,
            title: item.title || `${item.author}的${typeLabel}`,
            author: item.author,
            type: item.type,
            filename,
            url: item.url,
          });
        }

        // Step 3: offset 减小 → 向更新方向移动
        currentOffset -= 20;
        if (currentOffset < 0) {
          reachedNewest = true;
        }
      }

      // Step 4: 更新进度文件
      if (exportedInBatch > 0) {
        // nextOffset 记录当前处理到的位置，下次从这里继续向更新方向
        const nextOffset = Math.max(0, currentOffset);

        await progress.updateArticleProgress(
          dirHandle, progressData,
          newestTimeInBatch, exportedInBatch, currentTotal, nextOffset
        );

        // 更新 README.md
        await updateReadme(collectionFolder);

        log(`本批完成：导出 ${exportedInBatch} 篇，共已导出 ${progressData.articles.totalExported} 篇`, 'success');
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

      for await (const [name, handle] of articlesFolder.entries()) {
        if (handle.kind !== 'file') continue;
        if (!name.endsWith('.md')) continue;
        if (name.endsWith('-评论.md')) continue;
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
```

- [ ] **Step 2: 验证**

1. 重新加载插件
2. 打开导出管理器，选择文件夹
3. 设置批次大小为 5（方便测试）
4. 点击"开始导出"
5. 确认文件夹中生成了文章 Markdown 文件
6. 确认 `export-progress.json` 被创建且内容正确
7. 再次点击"继续导出下一批"，确认从上次位置继续

- [ ] **Step 3: Commit**

```bash
git add export/export.js
git commit -m "feat: 实现文章分批导出逻辑"
```

---

### Task 8: 实现评论独立导出逻辑

**Files:**
- Modify: `export/export.js` (替换 `handleExportComments` 占位)

- [ ] **Step 1: 实现 handleExportComments**

替换 `export/export.js` 中的 `handleExportComments` 函数：

```javascript
  async function handleExportComments() {
    if (isExportingComments || !dirHandle || !progressData) return;
    isExportingComments = true;
    updateUI();

    const batchSize = parseInt(els.commentBatchSize.value) || 50;

    try {
      const collectionFolder = await dirHandle.getDirectoryHandle(
        u.sanitizeFilename(collectionName)
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles');
      let imagesFolder = null;
      try {
        imagesFolder = await articlesFolder.getDirectoryHandle('images');
      } catch { /* 没有 images 文件夹也没关系 */ }

      // 扫描已导出的文章文件
      const articleFiles = [];
      for await (const [name, handle] of articlesFolder.entries()) {
        if (handle.kind !== 'file') continue;
        if (!name.endsWith('.md')) continue;
        if (name.endsWith('-评论.md')) continue;
        if (name === 'README.md') continue;
        articleFiles.push(name);
      }

      // 过滤出还没导出评论的文章
      const exportedSet = new Set(progressData.comments.exportedArticles);
      const pendingFiles = articleFiles.filter((name) => !exportedSet.has(name));

      if (pendingFiles.length === 0) {
        log('所有文章的评论已导出完毕', 'success');
        isExportingComments = false;
        updateUI();
        return;
      }

      const toProcess = pendingFiles.slice(0, batchSize);
      log(`本批将处理 ${toProcess.length} 篇文章的评论`);

      for (let i = 0; i < toProcess.length; i++) {
        const filename = toProcess[i];
        showCommentProgress(i + 1, toProcess.length,
          `正在处理 ${i + 1}/${toProcess.length}: ${filename.slice(0, 20)}...`);

        try {
          // 从文件中读取 Front Matter 获取 URL 和类型
          const fileHandle = await articlesFolder.getFileHandle(filename);
          const file = await fileHandle.getFile();
          const content = await file.text();

          // 解析 Front Matter 中的 source URL 和 type
          const sourceMatch = content.match(/^source:\s*"([^"]+)"/m);
          const typeMatch = content.match(/^type:\s*zhihu-(\w+)/m);

          if (!sourceMatch || !typeMatch) {
            log(`跳过 ${filename}：无法解析 Front Matter`, 'warn');
            // 仍然标记为已处理，避免反复尝试
            await progress.updateCommentProgress(dirHandle, progressData, filename);
            continue;
          }

          const articleUrl = sourceMatch[1];
          const articleType = typeMatch[1];
          const pageInfo = api.detectPage(articleUrl);

          if (!pageInfo) {
            log(`跳过 ${filename}：无法识别 URL`, 'warn');
            await progress.updateCommentProgress(dirHandle, progressData, filename);
            continue;
          }

          log(`加载评论: ${filename}`);
          const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
            showCommentProgress(i + 1, toProcess.length,
              `${filename.slice(0, 15)}... 子评论 ${done}/${total}`);
          });

          if (comments.length > 0) {
            // 评论图片处理
            let commentImageMapping = {};
            if (imagesFolder) {
              const imgEntries = u.collectCommentImageEntries(comments);
              if (imgEntries.length > 0) {
                const prefix = `comment_${String(i + 1).padStart(3, '0')}_`;
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

            // 生成评论 Markdown
            const baseName = filename.replace(/\.md$/, '');
            const title = baseName;
            const commentMd = buildCommentsMarkdown(comments, title, commentImageMapping);
            const commentFilename = `${baseName}-评论.md`;
            await u.writeTextFile(articlesFolder, commentFilename, commentMd);

            log(`已导出 ${comments.length} 条评论: ${commentFilename}`, 'success');
          } else {
            log(`${filename}：无评论`);
          }

          await progress.updateCommentProgress(dirHandle, progressData, filename);
        } catch (err) {
          log(`${filename} 评论导出失败: ${err.message}`, 'error');
          // 不标记为已处理，下次可以重试
        }
      }

      log(`评论导出完成，本批处理 ${toProcess.length} 篇`, 'success');
    } catch (err) {
      log(`评论导出失败: ${err.message}`, 'error');
    } finally {
      isExportingComments = false;
      hideCommentProgress();
      updateUI();
    }
  }
```

- [ ] **Step 2: 验证**

1. 先完成一批文章导出
2. 点击"开始导出评论"
3. 确认评论 Markdown 文件生成在 articles 文件夹中
4. 确认 `export-progress.json` 的 `comments.exportedArticles` 更新
5. 再次点击，确认跳过已导出的文章
6. 确认日志区显示操作过程

- [ ] **Step 3: Commit**

```bash
git add export/export.js
git commit -m "feat: 实现评论独立导出逻辑"
```

---

### Task 9: 最终清理和集成验证

**Files:**
- Modify: `manifest.json` (确认最终状态)

- [ ] **Step 1: 确认 manifest.json 最终状态**

确保 `manifest.json` 包含以下变更：
1. `host_permissions` 已添加
2. `content_scripts.js` 加载顺序正确（throttle.js → zhihu-api.js 在 detector.js 之前）
3. jszip.min.js 保留（article-panel.js 仍需使用）

- [ ] **Step 2: 端到端验证 - 单篇文章下载**

1. 打开知乎文章页面
2. 点击浮窗，确认单篇面板正常显示
3. 下载 Markdown（无图片）→ 成功
4. 下载 ZIP（含图片）→ 成功
5. 下载 ZIP（含评论）→ 成功

- [ ] **Step 3: 端到端验证 - 收藏夹分批导出**

1. 打开知乎收藏夹页面
2. 点击浮窗，确认显示简化面板 + "打开导出管理器"按钮
3. 点击打开 Extension Page
4. 选择空文件夹
5. 设置批次大小为 3，导出第一批文章
6. 确认文件生成正确，进度文件更新
7. 点击"继续导出下一批"
8. 确认从上次位置继续，无重复
9. 导出评论，确认评论文件生成
10. 关闭页面，重新打开，选择同一文件夹
11. 确认进度恢复正确

- [ ] **Step 4: 端到端验证 - 403 重试**

1. 快速连续操作触发限速（或在开发者工具 Network 中模拟 403）
2. 确认日志显示重试提示
3. 确认重试后能继续正常导出

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 收藏夹分批导出功能完成 v2.0.0"
```
