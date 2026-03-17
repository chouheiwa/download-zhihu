# 评论区导出 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增评论区导出功能，用户勾选后自动获取完整评论树并生成独立评论 Markdown 文件。

**Architecture:** 在 `detector.js` 新增评论 API 函数（fetchRootComments / fetchChildComments / fetchAllComments），在 `html-to-markdown.js` 新增评论格式化函数（commentHtmlToText / extractCommentImageUrls / buildCommentsMarkdown），在 `floating-ui.js` 新增 UI checkbox 并修改导出流程集成评论。

**Tech Stack:** Chrome Extension Manifest V3, Content Scripts, Zhihu Comment API v5, Turndown.js

**Spec:** `docs/superpowers/specs/2026-03-17-comment-export-design.md`

---

## Task 1: 评论 API 数据层（detector.js）

**Files:**
- Modify: `content/detector.js:247-257`（在导出对象前添加新函数，并注册到 `window.__zhihuDownloader`）

- [ ] **Step 1: 添加 COMMENT_TYPE_MAP 和 fetchRootComments**

在 `content/detector.js` 的 `// 导出到 window` 注释之前，添加评论相关代码：

```javascript
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
  let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/${apiType}/${id}/root_comment?order_by=ts&limit=20&offset=`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) throw new Error(`评论 API 请求失败: ${response.status}`);

    const data = await response.json();
    const paging = data.paging || {};
    comments.push(...(data.data || []));
    nextUrl = paging.is_end ? null : (paging.next || null);
  }

  return { comments, totals: comments.length };
}
```

- [ ] **Step 2: 添加 fetchChildComments**

紧接着 `fetchRootComments` 之后添加：

```javascript
async function fetchChildComments(rootCommentId) {
  const children = [];
  let nextUrl = `https://www.zhihu.com/api/v4/comment_v5/comment/${rootCommentId}/anchor_comment?order_by=score&limit=20&offset=`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) break;

    const data = await response.json();
    const paging = data.paging || {};
    children.push(...(data.data || []));
    nextUrl = paging.is_end ? null : (paging.next || null);
  }

  return children;
}
```

- [ ] **Step 3: 添加 fetchAllComments**

紧接着 `fetchChildComments` 之后添加：

```javascript
async function fetchAllComments(type, id, onProgress) {
  const { comments } = await fetchRootComments(type, id);

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    if (onProgress) onProgress(i + 1, comments.length);

    if (comment.child_comment_count > 0 &&
        (comment.child_comments || []).length < comment.child_comment_count) {
      comment.child_comments = await fetchChildComments(comment.id);
    }
  }

  return comments;
}
```

- [ ] **Step 4: 注册到 window.__zhihuDownloader**

修改导出对象，添加 `fetchAllComments`：

```javascript
window.__zhihuDownloader = {
  detectPage,
  extractContent,
  getCollectionInfo,
  fetchCollectionPage,
  fetchAllComments,
};
```

- [ ] **Step 5: Commit**

```bash
git add content/detector.js
git commit -m "feat: 新增评论 API 数据层（fetchRootComments/fetchChildComments/fetchAllComments）"
```

---

## Task 2: 评论 Markdown 格式化（html-to-markdown.js）

**Files:**
- Modify: `lib/html-to-markdown.js:300-306`（在文件末尾 window 导出区域前添加新函数，并注册到 window）

- [ ] **Step 1: 添加 commentHtmlToText**

在 `lib/html-to-markdown.js` 的 `// 导出供 popup 使用` 注释之前添加：

```javascript
/**
 * 将评论 HTML 转为纯文本
 * 处理 <p>, <br>, 表情 [xxx], <a class="comment_img">
 */
function commentHtmlToText(html, imageMapping) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  // 替换评论图片链接
  div.querySelectorAll('a.comment_img').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (imageMapping && imageMapping[href]) {
      const imgNode = document.createTextNode(`![评论图片](${imageMapping[href]})`);
      a.replaceWith(imgNode);
    } else if (href) {
      const linkNode = document.createTextNode(`[查看图片](${href})`);
      a.replaceWith(linkNode);
    }
  });

  // 替换 <br> 为换行
  div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));

  // 替换 <p> 为段落
  div.querySelectorAll('p').forEach((p) => {
    p.insertAdjacentText('afterend', '\n');
  });

  return div.textContent.trim();
}
```

- [ ] **Step 2: 添加 extractCommentImageUrls**

紧接着 `commentHtmlToText` 之后添加：

```javascript
/**
 * 从评论 HTML 中提取图片 URL
 */
function extractCommentImageUrls(html) {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const urls = [];
  div.querySelectorAll('a.comment_img').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href && /^https?:\/\//i.test(href)) {
      urls.push(href);
    }
  });
  return urls;
}
```

- [ ] **Step 3: 添加 buildCommentsMarkdown**

紧接着 `extractCommentImageUrls` 之后添加：

```javascript
/**
 * 将评论树转为 Markdown
 * @param {Array} comments - 根评论数组（含 child_comments）
 * @param {string} title - 文章标题
 * @param {Object} imageMapping - 图片 URL → 本地路径映射
 * @returns {string} Markdown 文本
 */
function buildCommentsMarkdown(comments, title, imageMapping) {
  const totalCount = comments.reduce(
    (sum, c) => sum + 1 + (c.child_comments || []).length, 0
  );

  const lines = [
    `# ${title} - 评论区`,
    '',
    `> 共 ${totalCount} 条评论，导出于 ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  for (const comment of comments) {
    lines.push('---', '');
    lines.push(formatComment(comment, imageMapping));

    for (const child of (comment.child_comments || [])) {
      lines.push(formatChildComment(child, imageMapping));
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatComment(c, imageMapping) {
  const author = c.author?.name || '匿名用户';
  const authorTag = getAuthorTag(c);
  const time = formatTimestamp(c.created_time);
  const ip = getIpInfo(c);
  const likes = c.like_count || 0;
  const text = commentHtmlToText(c.content || '', imageMapping);

  const meta = [`**${author}**${authorTag}`, time, ip, `👍 ${likes}`]
    .filter(Boolean).join(' · ');

  return `> ${meta}\n>\n> ${text.replace(/\n/g, '\n> ')}\n`;
}

function formatChildComment(c, imageMapping) {
  const author = c.author?.name || '匿名用户';
  const authorTag = getAuthorTag(c);
  const replyTo = c.reply_to_author?.name;
  const time = formatTimestamp(c.created_time);
  const ip = getIpInfo(c);
  const text = commentHtmlToText(c.content || '', imageMapping);

  const replyPart = replyTo ? ` 回复 **${replyTo}**` : '';
  const meta = [`**${author}**${authorTag}${replyPart}`, time, ip]
    .filter(Boolean).join(' · ');

  return `> > ${meta}\n> >\n> > ${text.replace(/\n/g, '\n> > ')}\n`;
}

function getAuthorTag(comment) {
  const tag = (comment.author_tag || []).find((t) => t.type === 'content_author');
  return tag ? '（作者）' : '';
}

function getIpInfo(comment) {
  const tag = (comment.comment_tag || []).find((t) => t.type === 'ip_info');
  return tag ? `IP ${tag.text}` : '';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 4: 注册到 window**

修改文件末尾的 window 导出部分：

```javascript
if (typeof window !== 'undefined') {
  window.htmlToMarkdown = htmlToMarkdown;
  window.extractImageUrls = extractImageUrls;
  window.inferImageExtension = inferImageExtension;
  window.commentHtmlToText = commentHtmlToText;
  window.extractCommentImageUrls = extractCommentImageUrls;
  window.buildCommentsMarkdown = buildCommentsMarkdown;
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/html-to-markdown.js
git commit -m "feat: 新增评论 Markdown 格式化函数（commentHtmlToText/extractCommentImageUrls/buildCommentsMarkdown）"
```

---

## Task 3: 单篇面板 UI + 导出逻辑（floating-ui.js）

**Files:**
- Modify: `content/floating-ui.js:303-407`（renderArticlePanel + handleArticleDownload）

- [ ] **Step 1: renderArticlePanel 添加评论 checkbox**

在 `content/floating-ui.js` 的 `renderArticlePanel` 函数中，在「下载图片到本地」checkbox 之后、`</div>` 关闭 options div 之前，添加评论 checkbox：

找到（约 line 334-337）：
```html
        <label class="option-item">
          <span>下载图片到本地</span>
          <input type="checkbox" id="opt-img" ${imgUrls.length > 0 ? 'checked' : ''}>
        </label>
      </div>
```

替换为：
```html
        <label class="option-item">
          <span>下载图片到本地</span>
          <input type="checkbox" id="opt-img" ${imgUrls.length > 0 ? 'checked' : ''}>
        </label>
        <label class="option-item">
          <span>导出评论区</span>
          <input type="checkbox" id="opt-comment">
        </label>
      </div>
```

- [ ] **Step 2: 添加 optComment 到 refs 并更新按钮文字逻辑**

在 refs 对象中添加 `optComment`：

```javascript
const refs = {
  btn: body.querySelector('#btn-dl'),
  optFm: body.querySelector('#opt-fm'),
  optImg: body.querySelector('#opt-img'),
  optComment: body.querySelector('#opt-comment'),
  progressWrap: body.querySelector('#progress-wrap'),
  progressBar: body.querySelector('#progress-bar'),
  progressLabel: body.querySelector('#progress-label'),
};
```

替换现有的按钮文字切换逻辑（`refs.optImg.addEventListener('change', ...)` 部分）为：

```javascript
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
```

- [ ] **Step 3: 修改 handleArticleDownload 集成评论导出**

重写 `handleArticleDownload` 函数。核心变化：当 `wantComment` 为 true 时，获取评论并生成评论 markdown，强制使用 ZIP 打包。

```javascript
async function handleArticleDownload(data, imgUrls, refs) {
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
    let commentImageMapping = {};
    let commentImageFiles = [];

    if (wantComment) {
      refs.btn.textContent = '正在加载评论...';
      const pageInfo = api.detectPage(window.location.href);
      const comments = await api.fetchAllComments(pageInfo.type, pageInfo.id, (done, total) => {
        showProgress(refs, done, total, `正在加载子评论 ${done}/${total}...`);
      });

      // 评论图片
      if (wantImages) {
        const commentImgUrls = [];
        const commentImgMap = []; // [{ commentIndex, urls }]
        let commentIdx = 0;
        for (const c of comments) {
          commentIdx++;
          const urls = extractCommentImageUrls(c.content || '');
          if (urls.length > 0) commentImgMap.push({ commentIdx, urls });
          for (const child of (c.child_comments || [])) {
            commentIdx++;
            const childUrls = extractCommentImageUrls(child.content || '');
            if (childUrls.length > 0) commentImgMap.push({ commentIdx, urls: childUrls });
          }
        }
        for (const entry of commentImgMap) {
          for (let i = 0; i < entry.urls.length; i++) {
            const url = entry.urls[i];
            const prefix = `comment_${String(entry.commentIdx).padStart(3, '0')}_`;
            const result = await downloadImage(url);
            if (result) {
              const filename = `${prefix}${String(i + 1).padStart(3, '0')}${result.ext}`;
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
      if (wantImages) {
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
```

注意：`updateBtnText` 需要在 `handleArticleDownload` 的闭包作用域内可访问。由于两者都在 `renderArticlePanel` 内，这没问题。但 `handleArticleDownload` 需要从独立函数改为在 `renderArticlePanel` 中定义，或者把 `updateBtnText` 提升。最简方案：将 click handler 改为内联调用。

将 `refs.btn.addEventListener('click', ...)` 改为：
```javascript
refs.btn.addEventListener('click', () => handleArticleDownload(data, imgUrls, refs, updateBtnText));
```

并在 `handleArticleDownload` 签名中添加 `updateBtnText` 参数，在成功后调用它。

- [ ] **Step 4: Commit**

```bash
git add content/floating-ui.js
git commit -m "feat: 单篇面板集成评论导出（UI + 下载逻辑）"
```

---

## Task 4: 收藏夹面板集成评论导出（floating-ui.js）

**Files:**
- Modify: `content/floating-ui.js`（renderCollectionPanel + handleCollectionExport + handleCollectionExportToFolder）

- [ ] **Step 1: renderCollectionPanel 添加评论 checkbox**

在收藏夹面板的 options div（`col-opt-img` 之后、`</div>` 之前），添加：

```html
        <label class="option-item">
          <span>导出评论区</span>
          <input type="checkbox" id="col-opt-comment">
        </label>
```

在 refs 对象中添加：
```javascript
optComment: body.querySelector('#col-opt-comment'),
```

- [ ] **Step 2: 修改 handleCollectionExport（ZIP 模式）集成评论**

在 ZIP 模式的 `handleCollectionExport` 函数中，阶段 2 逐篇转换循环内，在写入文章 markdown 之后、循环末尾之前，添加评论处理逻辑：

```javascript
const wantComment = refs.optComment.checked;

// 在循环内，item 处理完文章 markdown 之后：
if (wantComment) {
  showProgress(refs, num, allItems.length, `正在加载评论 ${num}/${allItems.length}...`);
  try {
    const comments = await api.fetchAllComments(item.type, extractContentId(item), null);
    if (comments.length > 0) {
      // 评论图片
      let commentImageMapping = {};
      if (wantImages) {
        const commentPrefix = `${String(num).padStart(3, '0')}_comment_`;
        let commentImgIdx = 0;
        for (const c of comments) {
          for (const url of extractCommentImageUrls(c.content || '')) {
            commentImgIdx++;
            const result = await downloadImage(url);
            if (result) {
              const imgName = `${commentPrefix}${String(commentImgIdx).padStart(3, '0')}${result.ext}`;
              commentImageMapping[url] = `images/${imgName}`;
              imagesFolder.file(imgName, result.buffer);
            }
          }
          for (const child of (c.child_comments || [])) {
            for (const url of extractCommentImageUrls(child.content || '')) {
              commentImgIdx++;
              const result = await downloadImage(url);
              if (result) {
                const imgName = `${commentPrefix}${String(commentImgIdx).padStart(3, '0')}${result.ext}`;
                commentImageMapping[url] = `images/${imgName}`;
                imagesFolder.file(imgName, result.buffer);
              }
            }
          }
        }
      }

      const commentMd = buildCommentsMarkdown(comments, item.title || `${item.author}的${typeLabel}`, commentImageMapping);
      const commentFilename = `${baseName}-评论.md`;
      articlesFolder.file(commentFilename, commentMd);

      // 文章末尾追加评论引用
      const encodedCF = encodeURIComponent(commentFilename).replace(/\(/g, '%28').replace(/\)/g, '%29');
      md += `\n\n---\n\n> [查看评论区](./${encodedCF})\n`;
    }
  } catch { /* 评论加载失败不影响文章导出 */ }
}

// 注意：md 的追加需要在 articlesFolder.file(filename, md) 之前完成
// 因此需要调整代码顺序：先处理评论，再写入文章
```

重要：需要调整代码顺序，将 `articlesFolder.file(filename, md)` 移到评论处理之后，因为评论引用需要追加到 md 末尾。

- [ ] **Step 3: 添加 extractContentId 辅助函数**

收藏夹中的 item 没有直接的 content ID，需要从 URL 中提取。在 `floating-ui.js` 的通用工具区域添加：

```javascript
function extractContentId(item) {
  const pageInfo = api.detectPage(item.url);
  return pageInfo ? pageInfo.id : '';
}
```

- [ ] **Step 4: 修改 handleCollectionExportToFolder（文件夹模式）集成评论**

与 ZIP 模式类似，在文件夹模式的逐条处理循环中添加评论逻辑。区别是图片通过 `batchDownloadImagestoFolder` 写入文件系统：

```javascript
if (wantComment) {
  showProgress(refs, num, totalItems, `正在加载评论 ${num}/${totalItems}...`);
  try {
    const comments = await api.fetchAllComments(item.type, extractContentId(item), null);
    if (comments.length > 0) {
      let commentImageMapping = {};
      if (wantImages) {
        const commentPrefix = `${String(num).padStart(3, '0')}_comment_`;
        let commentImgIdx = 0;
        for (const c of comments) {
          for (const url of extractCommentImageUrls(c.content || '')) {
            commentImgIdx++;
            const result = await downloadImage(url);
            if (result) {
              const imgName = `${commentPrefix}${String(commentImgIdx).padStart(3, '0')}${result.ext}`;
              commentImageMapping[url] = `images/${imgName}`;
              const fh = await imagesFolderHandle.getFileHandle(imgName, { create: true });
              const w = await fh.createWritable();
              await w.write(result.buffer);
              await w.close();
            }
          }
          for (const child of (c.child_comments || [])) {
            for (const url of extractCommentImageUrls(child.content || '')) {
              commentImgIdx++;
              const result = await downloadImage(url);
              if (result) {
                const imgName = `${commentPrefix}${String(commentImgIdx).padStart(3, '0')}${result.ext}`;
                commentImageMapping[url] = `images/${imgName}`;
                const fh = await imagesFolderHandle.getFileHandle(imgName, { create: true });
                const w = await fh.createWritable();
                await w.write(result.buffer);
                await w.close();
              }
            }
          }
        }
      }

      const commentMd = buildCommentsMarkdown(comments, item.title || `${item.author}的${typeLabel}`, commentImageMapping);
      const commentFilename = `${baseName}-评论.md`;
      await writeTextFile(articlesFolderHandle, commentFilename, commentMd);

      // 文章末尾追加评论引用
      const encodedCF = encodeURIComponent(commentFilename).replace(/\(/g, '%28').replace(/\)/g, '%29');
      md += `\n\n---\n\n> [查看评论区](./${encodedCF})\n`;
    }
  } catch { /* 评论加载失败不影响文章导出 */ }
}

// 同样需要将 writeTextFile(articlesFolderHandle, filename, md) 移到评论处理之后
```

- [ ] **Step 5: Commit**

```bash
git add content/floating-ui.js
git commit -m "feat: 收藏夹导出集成评论（ZIP + 文件夹模式）"
```

---

## Task 5: 手动测试验证

无自动化测试框架，通过手动测试验证。

- [ ] **Step 1: 加载扩展到 Chrome**

在 `chrome://extensions/` 页面，开发者模式下加载解压的扩展。

- [ ] **Step 2: 测试单篇文章 — 不勾选评论**

访问一篇知乎文章，点击浮动按钮，确认：
- 面板中有「导出评论区」checkbox
- 不勾选时，按钮文字正常（"下载 Markdown" 或 "下载 ZIP（含 N 张图片）"）
- 下载结果与之前一致

- [ ] **Step 3: 测试单篇文章 — 勾选评论**

勾选「导出评论区」，确认：
- 按钮文字变为 "下载 ZIP（含评论）" 或 "下载 ZIP（含图片和评论）"
- 下载的 ZIP 中包含 `{标题}-评论.md`
- 评论 markdown 格式正确（blockquote、作者、时间、IP、子评论缩进）
- 文章 markdown 末尾有 `> [查看评论区](...)` 链接

- [ ] **Step 4: 测试收藏夹 — 勾选评论**

访问一个收藏夹页面，勾选评论，导出几篇，确认：
- 每篇文章旁边有对应的 `-评论.md` 文件
- 评论图片（如有）在 images/ 中，命名无冲突
- 文件夹模式和 ZIP 模式都正常

- [ ] **Step 5: 测试边界情况**

- 无评论的文章：勾选评论后导出，评论文件应显示 "共 0 条评论"
- question 类型页面：不应显示评论 checkbox（或勾选后不影响）
- 评论中包含图片的情况

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: 评论区导出功能完成"
```
