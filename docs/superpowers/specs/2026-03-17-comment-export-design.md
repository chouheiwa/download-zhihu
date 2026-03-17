# 知乎评论区导出功能设计

## 概述

为知乎文章下载器新增评论区导出功能。用户勾选「导出评论区」后，导出时自动获取完整评论（含子评论），生成独立的评论 Markdown 文件，与文章一同打包。

## API 数据层

在 `detector.js` 中新增以下函数，通过 `window.__zhihuDownloader` 暴露。

### fetchRootComments(type, id)

获取所有一级评论。

- 端点: `GET /api/v4/comment_v5/{type}/{id}/root_comment?order_by=ts&limit=20&offset=`
- type 映射: `article` → `articles`, `answer` → `answers`, `pin` → `pins`
- 若 `type` 不在映射表中，直接返回 `{ comments: [], totals: 0 }`，跳过 API 请求
- 自动翻页: 使用 `paging.next`，直到 `paging.is_end === true`
- 返回: `{ comments: Comment[], totals: number }`

### fetchChildComments(rootCommentId)

获取某条根评论下的所有子评论。

- 首页: `GET /api/v4/comment_v5/comment/{rootCommentId}/anchor_comment?order_by=score&limit=20&offset=`
- 翻页: 读取响应中 `paging.next` 字段作为下一页 URL（指向 `anchor_more_comment` 端点）；`paging.is_end === true` 时停止翻页
- 返回: `Comment[]`

### fetchAllComments(type, id, onProgress)

组合函数，获取完整评论树。

1. 调用 `fetchRootComments` 获取所有一级评论
2. 对每条根评论，当 `child_comments.length < child_comment_count` 时视为子评论不完整，调用 `fetchChildComments(rootComment.id)` 补全
3. `onProgress` 回调用于进度提示
4. 返回: `Comment[]`（每条根评论的 `child_comments` 已完整填充）

### Comment 数据结构（提取字段）

```
{
  id, content (HTML), created_time (Unix),
  author.name, author.url_token,
  like_count, comment_tag (含 ip_info),
  author_tag (含「作者」标签),
  reply_to_author.name (子评论),
  child_comments[], child_comment_count
}
```

## Markdown 格式化

在 `lib/html-to-markdown.js` 中新增以下函数，通过 `window` 暴露给 `floating-ui.js`。

### commentHtmlToText(html)

将评论 HTML 转为纯文本。处理 `<p>`, `<br>`, 表情文字 `[xxx]`，以及 `<a class="comment_img">` 标签。

### extractCommentImageUrls(html)

从评论 HTML 中提取 `<a class="comment_img">` 的 href 作为图片 URL 列表。

### buildCommentsMarkdown(comments, title, imageMapping)

将评论树转为 Markdown 字符串。放在 `lib/html-to-markdown.js` 中，与 `commentHtmlToText` 和 `extractCommentImageUrls` 同文件，便于直接调用。

三个新函数均在文件末尾通过 `window.xxx = xxx` 注册，与现有的 `window.htmlToMarkdown` / `window.extractImageUrls` 模式一致。

### 输出格式

```markdown
# {文章标题} - 评论区

> 共 N 条评论，导出于 YYYY-MM-DD

---

> **用户名** · 2025-03-17 · IP 四川 · 👍 3
>
> 评论正文（HTML 转纯文本）
>
> > **回复者**（作者）回复 **被回复者** · 2025-03-17 · IP 天津
> >
> > 子评论正文

---
```

### 格式细节

- HTML content（`<p>`, `<br>`, 表情文字 `[xxx]`）转为纯文本
- 「作者」标签: 从 `author_tag` 中 `type === 'content_author'` 提取，显示为（作者）
- 子评论: `reply_to_author.name` 用于「回复 xxx」
- 时间戳: Unix timestamp → `YYYY-MM-DD HH:mm` 格式
- IP 属地: 从 `comment_tag` 中 `type === 'ip_info'` 提取
- 评论图片: `<a class="comment_img">` 中的 href 提取为图片 URL

## 评论中的图片

评论 content 中包含 `<a href="图片URL" class="comment_img">查看图片</a>` 形式的图片。

- 勾选「下载图片」时: 下载图片到 `images/` 目录，markdown 中引用为 `![评论图片](images/xxx.jpg)`
- 未勾选时: 保留原始 URL 作为链接 `[查看图片](URL)`

### 评论图片命名规则

评论图片与文章图片共享 `images/` 目录。为避免冲突，使用以下命名规则:

- 文章图片: `{articlePrefix}_{imageIndex}{ext}`（现有逻辑不变）
- 评论图片: `{articlePrefix}_comment_{commentIndex}_{imageIndex}{ext}`

其中 `articlePrefix` 为文章在收藏夹中的序号（如 `001`），单篇导出时为空前缀。

## UI 集成

### 单篇面板

- 在「下载图片到本地」checkbox 下方新增「导出评论区」checkbox（默认不勾选）
- 勾选后导出自动升级为 ZIP（即使未勾选图片）
- ZIP 内容: `{标题}.md` + `{标题}-评论.md`（+ `images/` 如有图片）

### 按钮文字逻辑

根据 checkbox 组合更新按钮文字:

| 图片 | 评论 | 按钮文字 |
|------|------|---------|
| 否 | 否 | 下载 Markdown |
| 是 | 否 | 下载 ZIP（含 N 张图片） |
| 否 | 是 | 下载 ZIP（含评论） |
| 是 | 是 | 下载 ZIP（含图片和评论） |

### 收藏夹面板

- 同样新增「导出评论区」checkbox
- 逐篇处理时，每篇额外调用 `fetchAllComments`
- 评论文件 `{文章名}-评论.md` 放在 `articles/` 目录下
- ZIP 模式和文件夹模式均适用

### 文章末尾引用

勾选评论导出时，文章 markdown 末尾追加:

```markdown

---

> [查看评论区](./{文章名}-评论.md)
```

### 目录结构

单篇导出（ZIP）:
```
{标题}.md
{标题}-评论.md
images/
```

收藏夹导出:
```
收藏夹名/
├── README.md
└── articles/
    ├── 文章1.md
    ├── 文章1-评论.md
    ├── 文章2.md
    ├── 文章2-评论.md
    └── images/
```

### 适用范围

- article（文章）: 支持
- answer（回答）: 支持
- pin（想法）: 支持
- question（问题页）: 不支持（问题页导出多个回答，评论归属不明确）
- collection（收藏夹）: 支持（逐篇处理，每篇文章的 type 若不在映射表中则跳过评论）

### 进度提示

- 「正在加载评论 第 N 页...」
- 「正在加载子评论...」
- 收藏夹模式: 「正在处理 X/Y: 加载评论...」

## 文件修改清单

| 文件 | 改动 |
|------|------|
| `content/detector.js` | 新增 `fetchRootComments`, `fetchChildComments`, `fetchAllComments`，暴露到 API 对象 |
| `content/floating-ui.js` | 新增评论 checkbox UI、修改按钮文字逻辑、修改 `handleArticleDownload` 和 `handleCollectionExport`/`handleCollectionExportToFolder` 集成评论导出 |
| `lib/html-to-markdown.js` | 新增 `extractCommentImageUrls(html)`、`commentHtmlToText(html)`、`buildCommentsMarkdown(comments, title, imageMapping)`，均通过 `window.xxx` 注册 |
