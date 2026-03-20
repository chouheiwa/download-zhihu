# Docx 导出功能设计

## 概述

为 DownloadZhihu Chrome 扩展新增 Word (.docx) 导出格式，与现有 Markdown 导出并行存在。支持单篇文章和批量导出（收藏夹/专栏），包含完整的格式还原（标题、段落、粗斜体、链接、图片、引用、列表、代码块、表格、数学公式）。

## 需求

| 维度 | 决定 |
|------|------|
| 适用范围 | 单篇 + 批量都支持 docx |
| 图片处理 | 用户可选：嵌入到文档 / 外部链接 |
| 格式丰富度 | 尽量还原（标题、段落、粗斜体、链接、图片、引用、列表、代码块、表格、数学公式） |
| 评论 | 单独生成一个 .docx 文件（与 Markdown 做法一致） |
| 数学公式 | 直接转为 OMML（Word 原生公式格式），不降级为图片 |

## 依赖库

| 库 | 用途 | 约体积 |
|---|---|---|
| `docx` | 生成 .docx 文件（OOXML 格式） | ~200KB min |
| `docx-math-converter` | LaTeX → docx Math 对象（内含 MathJax） | ~500KB+ |

均以 minified JS 内嵌到 `lib/` 目录，与现有 turndown.js、jszip.min.js 风格一致。

> **注意**：`docx-math-converter` 具体指 npm 包 `@hungknguyen/docx-math-converter` 或 `@seewo-doc/docx-math-converter`，两者均基于 MathJax 实现 LaTeX → docx Math 对象的转换。实现前需验证所选包的浏览器端 UMD/ESM bundle 可用性，若不可用则回退到 Temml（~163KB）+ mathml2omml（~64KB）+ 自定义 OMML→docx 映射层的方案。

## 新增文件

- `lib/docx.min.js` — docx 库
- `lib/docx-math-converter.min.js` — 公式转换库（含 MathJax）
- `lib/html-to-docx.js` — 核心模块：HTML → docx Document 转换器

## manifest.json 变更

docx 相关库**不加入** `content_scripts`（避免每个知乎页面都加载 ~700KB 额外脚本），采用按需加载：

- **单篇导出**：用户在浮动面板中选择 Word 格式并点击下载时，通过 `chrome.scripting.executeScript` 动态注入 docx 相关库
- **批量导出**：在 `export/export.html` 中通过 `<script>` 标签加载（该页面仅在用户主动打开时加载）

需要将 docx 相关文件加入 `web_accessible_resources`：

```json
"web_accessible_resources": [{
  "resources": ["lib/docx.min.js", "lib/docx-math-converter.min.js", "lib/html-to-docx.js"],
  "matches": ["*://*.zhihu.com/*"]
}]
```

## 总体架构

不改动现有 Markdown 导出逻辑，docx 作为独立的输出格式并行存在：

```
知乎 HTML 内容
  ├── → html-to-markdown.js → .md 文件  (现有，不变)
  └── → html-to-docx.js → .docx 文件    (新增)
```

## html-to-docx.js 转换器

### 转换规则

| HTML 元素 | docx 输出 |
|---|---|
| `<h1>`~`<h6>` | Heading 1~6 |
| `<p>` | Paragraph |
| `<strong>/<b>` | Bold Run |
| `<em>/<i>` | Italic Run |
| `<a href>` | Hyperlink |
| `<img>` (普通) | ImageRun（嵌入模式）或文字超链接（链接模式） |
| `<img eeimg="1">` | 行内公式 → docx-math-converter → 行内 Math 对象 |
| `<img eeimg="2">` | 块级公式 → docx-math-converter → 独立段落 Math 对象 |
| `<blockquote>` | 带左边框缩进样式的段落 |
| `<ul>/<ol> > <li>` | 有序/无序列表段落（支持嵌套列表，通过 indent level 区分层级） |
| `<pre>` / `<code>` | 等宽字体（Consolas/Courier New）+ 灰色背景段落 |
| `<table>` | Table + TableRow + TableCell |
| `<figure>` | 提取内部 img + figcaption |
| `<br>` | Break |
| `.video-box` | 文字链接 `[视频](url)` |
| `.LinkCard` | 文字链接 `[标题](url)` |
| `<sup data-text>` | 脚注 → docx Footnote（与 Markdown 导出的 `[^n]` 对应） |
| `<del>/<s>` | Strikethrough Run |
| `<u>` | Underline Run |

### 图片处理

根据用户选择：

- **嵌入模式**：下载图片为 ArrayBuffer → `ImageRun({ data, transformation: { width, height } })`
  - 图片尺寸获取：优先从 HTML `<img>` 标签的 `width`/`height` 属性读取；若无属性，则从图片二进制头解析（PNG/JPEG header）；最终回退到默认尺寸 600x400
  - 复用现有 `export-utils.js` 的 `downloadImage()` 方法获取 ArrayBuffer
- **链接模式**：插入 `[图片](url)` 文本超链接

### Front Matter

不输出 YAML 文本，而是在 docx 开头生成一个**元信息表格**（2 列：字段名 | 值），包含 id、标题、作者、来源、日期，灰色背景区分正文。

### 公开 API

```js
async function htmlToDocx(htmlString, options) → Blob
// options: {
//   images: 'embed' | 'link',
//   frontMatter: { id, title, author, url, date }  // 可选
// }
```

## UI 交互

### 单篇导出（article-panel.js）

- 新增**格式选择** radio：`Markdown` / `Word (.docx)`，默认 Markdown
- 选择 Word 时的 UI 变化：
  - 现有「下载图片到本地」checkbox 隐藏，替换为 radio：`嵌入图片到文档` / `图片使用外部链接`
  - Front Matter 勾选 → 生成元信息表格
  - 评论勾选 → 生成独立 `文章名-评论.docx`
  - 下载按钮文字变为「下载 Word」或「下载 ZIP」（有评论时）
- 下载行为（所有组合）：
  - Word 嵌入图片，无评论 → 直接下载 `.docx`
  - Word 嵌入图片，有评论 → 下载 `.zip`（文章.docx + 评论.docx）
  - Word 外部链接，无评论 → 直接下载 `.docx`
  - Word 外部链接，有评论 → 下载 `.zip`（文章.docx + 评论.docx）
  - 保存到文件夹 → 写 `.docx` 文件到目录（评论为独立文件）

### 批量导出（export.js）

- 页面顶部新增**格式选择**：`Markdown` / `Word (.docx)`
- 选择 Word 时显示图片处理选项（嵌入/链接）
- 导出流程不变，最终写文件时调用 `htmlToDocx()` 替代 `htmlToMarkdown()`
- 目录结构：
  ```
  collection-name/
  ├── README.md          (目录索引，保持 md 格式，但链接指向 .docx 文件)
  └── articles/
      ├── 1-article.docx
      ├── 1-article-评论.docx
      (docx 模式不生成 images/ 目录，图片嵌入文档内或使用外部链接)
  ```
- 进度文件格式不变，兼容现有进度恢复逻辑

### 评论的 docx 格式

- 每条根评论 → 带左边框的引用段落（加粗作者名 + 灰色时间/IP/点赞数）
- 子评论 → 双层缩进段落
- 评论间用分隔线隔开

## 错误处理与边界情况

### 公式转换失败

某个 LaTeX 公式转 OMML 失败时，降级为纯文本显示（等宽字体包裹原始 LaTeX 字符串，如 `$E=mc^2$`），不中断整篇导出。

### 图片下载失败（嵌入模式）

- 复用现有重试逻辑
- 最终仍失败的图片 → 插入占位文字 `[图片加载失败]` + 原始 URL

### 超大文章

- docx 库在内存中构建文档，图片嵌入占用较多内存
- 批量导出逐篇生成、逐篇写入磁盘，不在内存中积累多篇（与现有 Markdown 流式处理一致）

### 付费内容 / 截断内容

完全复用现有检测和处理逻辑，仅最终输出格式不同。

### 文件命名

复用现有 `sanitizeFileName()` 逻辑，后缀从 `.md` 改为 `.docx`。

## 不需要变更的文件

- `collection-panel.js` — 收藏夹/专栏面板仅负责跳转到导出管理页面，格式选择在导出管理页面上完成，无需改动
- `detector.js` — 内容提取逻辑不变，docx 和 Markdown 共用同一份 HTML 内容
- `fetch-bridge.js` — 请求代理层不变
- `throttle.js` — 请求节流逻辑不变
