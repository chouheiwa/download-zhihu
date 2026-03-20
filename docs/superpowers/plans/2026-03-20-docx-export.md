# Docx 导出功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DownloadZhihu Chrome 扩展新增 Word (.docx) 导出格式，支持单篇和批量导出。

**Architecture:** 在现有 HTML→Markdown 管线旁并行建立 HTML→docx 管线。核心是新模块 `lib/html-to-docx.js`，遍历 HTML DOM 节点树映射到 docx.js 的 Document 对象。UI 层在单篇面板和批量导出页面各增加格式选择。docx 库按需加载，不影响普通页面性能。

**Tech Stack:** docx (npm package `docx`, ~200KB min), @hungknguyen/docx-math-converter (~500KB+, 含 MathJax), Chrome Extension Manifest V3, File System Access API, JSZip

**Spec:** `docs/superpowers/specs/2026-03-20-docx-export-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/docx.min.js` | Create | docx 库 minified bundle |
| `lib/docx-math-converter.min.js` | Create | LaTeX→docx Math 转换库 bundle |
| `lib/html-to-docx.js` | Create | HTML→docx Document 转换器（核心模块） |
| `manifest.json` | Modify | 添加 web_accessible_resources + scripting 权限 |
| `background.js` | Modify | 支持动态注入 docx 库 |
| `content/export-utils.js` | Modify | 添加 writeBlobFile、buildImageDataMap |
| `content/article-panel.js` | Modify | 添加格式选择 UI + docx 下载逻辑 |
| `export/export.html` | Modify | 添加格式选择 UI + 加载 docx 库脚本 |
| `export/export.js` | Modify | 批量导出支持 docx + reconcileProgress 识别 .docx |

---

### Task 1: 获取并集成依赖库

**Files:**
- Create: `lib/docx.min.js`
- Create: `lib/docx-math-converter.min.js`

- [ ] **Step 1: 下载 docx 库的浏览器 bundle**

```bash
cd "/Users/chouheiwa/Desktop/web/chrome插件/DownloadZhihu"
curl -o lib/docx.min.js "https://cdn.jsdelivr.net/npm/docx@9/build/index.umd.min.js"
```

如果 CDN 版本不可用，从 npm 下载：

```bash
npm pack docx --pack-destination /tmp/docx-pack
cd /tmp/docx-pack && tar -xzf docx-*.tgz
cp package/build/index.umd.js "/Users/chouheiwa/Desktop/web/chrome插件/DownloadZhihu/lib/docx.min.js"
```

- [ ] **Step 2: 验证 docx 库导出全局变量**

在浏览器控制台加载后验证：

```js
console.log(typeof docx, typeof docx.Document, typeof docx.Packer);
// 预期: "object" "function" "function"
```

- [ ] **Step 3: 下载 docx-math-converter 库**

```bash
curl -o lib/docx-math-converter.min.js "https://cdn.jsdelivr.net/npm/@hungknguyen/docx-math-converter@1.1.4/dist/index.umd.js"
```

如果不可用，尝试 `@seewo-doc/docx-math-converter`。如果都不可用，回退：

```bash
curl -o lib/temml.min.js "https://cdn.jsdelivr.net/npm/temml@0.10/dist/temml.min.js"
curl -o lib/mathml2omml.min.js "https://cdn.jsdelivr.net/npm/mathml2omml/dist/mathml2omml.umd.js"
```

- [ ] **Step 4: 验证公式转换库**

```js
// docx-math-converter 方案:
console.log(typeof DocxMathConverter);
// 或 Temml+mathml2omml 方案:
console.log(typeof temml, typeof mathml2omml);
```

- [ ] **Step 5: Commit**

```bash
git add lib/docx.min.js lib/docx-math-converter.min.js
git commit -m "chore: add docx and math converter libraries for Word export"
```

---

### Task 2: 创建 html-to-docx.js 核心转换器

**Files:**
- Create: `lib/html-to-docx.js`

完整代码见下方。这是核心模块，负责：
- DOM 节点遍历 → docx 元素映射
- 行内元素（粗斜体、链接、图片、公式、脚注、删除线、下划线）
- 块级元素（标题、段落、引用、列表、代码块、表格、figure、视频、链接卡片）
- Front Matter 元信息表格
- 评论 docx 生成

- [ ] **Step 1: 创建 lib/html-to-docx.js**

```js
// lib/html-to-docx.js
// HTML → docx Document 转换器
// 依赖: docx 库 (全局变量 docx)

(function () {
  'use strict';

  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    ExternalHyperlink, ImageRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType, ShadingType,
    Math: DocxMath, MathRun: DocxMathRun,
    FootnoteReferenceRun,
    LevelFormat, convertInchesToTwip,
  } = docx;

  // ============================================================
  // 工具函数
  // ============================================================

  function parseHTML(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  function getImageUrl(img) {
    return img.getAttribute('data-original')
      || img.getAttribute('data-actualsrc')
      || img.getAttribute('src')
      || '';
  }

  /**
   * 从图片二进制数据解析尺寸（PNG/JPEG）
   */
  function parseImageDimensions(buffer) {
    const view = new DataView(buffer);
    try {
      // PNG
      if (view.getUint32(0) === 0x89504E47) {
        return { width: view.getUint32(16), height: view.getUint32(20) };
      }
      // JPEG: 搜索 SOF0/SOF2
      let offset = 2;
      while (offset < view.byteLength - 8) {
        const marker = view.getUint16(offset);
        if (marker === 0xFFC0 || marker === 0xFFC2) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * 计算图片在 docx 中的显示尺寸（像素），最大宽度 576px（约 6 英寸 96dpi）
   */
  function calcImageSize(widthPx, heightPx) {
    const MAX_WIDTH = 576;
    let w = widthPx;
    let h = heightPx;
    if (w > MAX_WIDTH) {
      const ratio = MAX_WIDTH / w;
      w = MAX_WIDTH;
      h = Math.round(h * ratio);
    }
    return { width: w, height: h };
  }

  // ============================================================
  // LaTeX → docx Math 转换
  // ============================================================

  function convertLatexToDocxMath(latex) {
    try {
      // docx-math-converter 的 API
      if (typeof window.DocxMathConverter !== 'undefined') {
        return window.DocxMathConverter.convertLaTeX(latex);
      }
      // 回退方案：Temml + mathml2omml
      if (typeof window.temml !== 'undefined' && typeof window.mathml2omml !== 'undefined') {
        const mathml = window.temml.renderToString(latex);
        const omml = window.mathml2omml(mathml);
        return parseOmmlToDocxMath(omml);
      }
      return null;
    } catch (e) {
      console.warn('LaTeX→OMML 转换失败:', latex, e);
      return null;
    }
  }

  function parseOmmlToDocxMath(ommlXml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(ommlXml, 'text/xml');
      const runs = [];
      const textNodes = doc.querySelectorAll('m\\:t, t');
      textNodes.forEach(t => {
        runs.push(new DocxMathRun(t.textContent || ''));
      });
      return runs.length > 0 ? runs : null;
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 行内元素收集
  // ============================================================

  function collectInlineElements(node, style, ctx) {
    const runs = [];

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        runs.push(new TextRun({
          text,
          bold: style.bold || false,
          italics: style.italic || false,
          strike: style.strike || false,
          underline: style.underline ? { type: 'single' } : undefined,
          font: style.code ? { name: 'Consolas' } : undefined,
          shading: style.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8E8E8' } : undefined,
        }));
      }
      return runs;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return runs;
    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      runs.push(new TextRun({ break: 1 }));
      return runs;
    }

    if (tag === 'strong' || tag === 'b') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, bold: true }, ctx));
      return runs;
    }

    if (tag === 'em' || tag === 'i') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, italic: true }, ctx));
      return runs;
    }

    if (tag === 'del' || tag === 's') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, strike: true }, ctx));
      return runs;
    }

    if (tag === 'u') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, underline: true }, ctx));
      return runs;
    }

    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
      for (const child of node.childNodes)
        runs.push(...collectInlineElements(child, { ...style, code: true }, ctx));
      return runs;
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const children = [];
      for (const child of node.childNodes)
        children.push(...collectInlineElements(child, style, ctx));
      if (href && children.length > 0) {
        runs.push(new ExternalHyperlink({
          link: href,
          children: children.map(r => {
            if (r instanceof TextRun) {
              return new TextRun({
                text: r.root?.[1]?.root?.[1] || node.textContent || '',
                color: '0563C1',
                underline: { type: 'single' },
                bold: style.bold || false,
                italics: style.italic || false,
              });
            }
            return r;
          }),
        }));
      } else {
        runs.push(...children);
      }
      return runs;
    }

    // 行内公式
    if (tag === 'img' && node.getAttribute('eeimg') === '1') {
      const latex = node.getAttribute('alt') || '';
      const mathRuns = convertLatexToDocxMath(latex);
      if (mathRuns) {
        runs.push(new DocxMath({ children: mathRuns }));
      } else {
        runs.push(new TextRun({ text: `$${latex}$`, font: { name: 'Consolas' } }));
      }
      return runs;
    }

    // 图片（非公式）
    if (tag === 'img' && !node.getAttribute('eeimg')) {
      const url = getImageUrl(node);
      if (!url) return runs;

      if (ctx.images === 'embed' && ctx.imageData) {
        const imgInfo = ctx.imageData.get(url);
        if (imgInfo) {
          const imgW = parseInt(node.getAttribute('width')) || 0;
          const imgH = parseInt(node.getAttribute('height')) || 0;
          let dims;
          if (imgW && imgH) {
            dims = calcImageSize(imgW, imgH);
          } else {
            const parsed = parseImageDimensions(imgInfo.buffer);
            dims = parsed ? calcImageSize(parsed.width, parsed.height) : calcImageSize(600, 400);
          }
          runs.push(new ImageRun({
            data: imgInfo.buffer,
            transformation: { width: dims.width, height: dims.height },
          }));
        } else {
          runs.push(new TextRun({ text: `[图片加载失败](${url})`, color: '999999' }));
        }
      } else {
        runs.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: '[图片]', color: '0563C1', underline: { type: 'single' } })],
        }));
      }
      return runs;
    }

    // 脚注
    if (tag === 'sup' && node.getAttribute('data-text')) {
      const noteText = node.getAttribute('data-text') || node.textContent;
      const footnoteId = ctx.footnotes.length + 1;
      ctx.footnotes.push({ id: footnoteId, text: noteText });
      runs.push(new FootnoteReferenceRun(footnoteId));
      return runs;
    }

    // 默认递归
    for (const child of node.childNodes)
      runs.push(...collectInlineElements(child, style, ctx));
    return runs;
  }

  // ============================================================
  // 块级元素转换
  // ============================================================

  function convertBlockElement(element, ctx, listLevel) {
    if (listLevel === undefined) listLevel = -1;
    const blocks = [];
    const tag = element.tagName?.toLowerCase();
    if (!tag) return blocks;

    // 标题
    const hMatch = tag.match(/^h([1-6])$/);
    if (hMatch) {
      const headingMap = {
        1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
      };
      const children = [];
      for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
      blocks.push(new Paragraph({ heading: headingMap[parseInt(hMatch[1])], children }));
      return blocks;
    }

    // 段落
    if (tag === 'p') {
      const children = [];
      for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
      if (children.length > 0) blocks.push(new Paragraph({ children }));
      return blocks;
    }

    // 块级公式
    if (tag === 'img' && element.getAttribute('eeimg') === '2') {
      const latex = element.getAttribute('alt') || '';
      const mathRuns = convertLatexToDocxMath(latex);
      if (mathRuns) {
        blocks.push(new Paragraph({ children: [new DocxMath({ children: mathRuns })], alignment: AlignmentType.CENTER }));
      } else {
        blocks.push(new Paragraph({ children: [new TextRun({ text: `$$${latex}$$`, font: { name: 'Consolas' } })], alignment: AlignmentType.CENTER }));
      }
      return blocks;
    }

    // 引用块
    if (tag === 'blockquote') {
      const quoteStyle = {
        indent: { left: convertInchesToTwip(0.5) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
        spacing: { before: 60, after: 60 },
      };
      for (const child of element.children) {
        const innerBlocks = convertBlockElement(child, ctx);
        for (const block of innerBlocks) {
          // 为引用中的段落添加样式
          blocks.push(new Paragraph({
            children: block.root ? [] : [new TextRun({ text: '' })],
            ...quoteStyle,
            // 将原段落的 children 合并
          }));
        }
      }
      // 如果 blockquote 没有子元素，直接处理文本
      if (element.children.length === 0) {
        const children = [];
        for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
        if (children.length > 0) blocks.push(new Paragraph({ children, ...quoteStyle }));
      }
      // 简化方案：将 blockquote 的所有内容作为带引用样式的段落
      if (blocks.length === 0) {
        const children = [];
        for (const child of element.childNodes) children.push(...collectInlineElements(child, {}, ctx));
        if (children.length > 0) blocks.push(new Paragraph({ children, ...quoteStyle }));
      }
      return blocks;
    }

    // 列表
    if (tag === 'ul' || tag === 'ol') {
      const newLevel = listLevel + 1;
      for (const li of element.children) {
        if (li.tagName?.toLowerCase() !== 'li') continue;
        const children = [];
        for (const child of li.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE &&
            (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')) {
            blocks.push(...convertBlockElement(child, ctx, newLevel));
          } else {
            children.push(...collectInlineElements(child, {}, ctx));
          }
        }
        if (children.length > 0) {
          blocks.push(new Paragraph({
            children,
            numbering: { reference: tag === 'ol' ? 'ordered-list' : 'bullet-list', level: newLevel },
          }));
        }
      }
      return blocks;
    }

    // 代码块
    if (tag === 'pre') {
      const codeEl = element.querySelector('code') || element;
      const lines = (codeEl.textContent || '').split('\n');
      for (const line of lines) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: line || ' ', font: { name: 'Consolas' }, size: 20 })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
          spacing: { before: 0, after: 0, line: 276 },
          indent: { left: convertInchesToTwip(0.3) },
        }));
      }
      return blocks;
    }

    // 表格
    if (tag === 'table') {
      blocks.push(convertTable(element, ctx));
      return blocks;
    }

    // figure
    if (tag === 'figure') {
      const img = element.querySelector('img');
      const figcaption = element.querySelector('figcaption');
      if (img) blocks.push(...convertBlockElement(img, ctx));
      if (figcaption) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: figcaption.textContent || '', color: '666666', size: 18, italics: true })],
          alignment: AlignmentType.CENTER,
        }));
      }
      return blocks;
    }

    // 知乎视频
    if (element.classList?.contains('video-box')) {
      const link = element.querySelector('a');
      const href = link?.getAttribute('href') || '';
      const text = link?.textContent || '视频';
      blocks.push(new Paragraph({
        children: [
          new TextRun({ text: '[视频] ', bold: true }),
          new ExternalHyperlink({ link: href, children: [new TextRun({ text, color: '0563C1', underline: { type: 'single' } })] }),
        ],
      }));
      return blocks;
    }

    // 链接卡片
    if (element.classList?.contains('LinkCard')) {
      const link = element.querySelector('a');
      const href = link?.getAttribute('href') || element.querySelector('[href]')?.getAttribute('href') || '';
      const title = element.querySelector('.LinkCard-title')?.textContent || link?.textContent || '链接';
      blocks.push(new Paragraph({
        children: [new ExternalHyperlink({ link: href, children: [new TextRun({ text: title, color: '0563C1', underline: { type: 'single' } })] })],
      }));
      return blocks;
    }

    // 独立图片（块级）
    if (tag === 'img' && !element.getAttribute('eeimg')) {
      const inlineRuns = collectInlineElements(element, {}, ctx);
      if (inlineRuns.length > 0) blocks.push(new Paragraph({ children: inlineRuns, alignment: AlignmentType.CENTER }));
      return blocks;
    }

    // 水平线
    if (tag === 'hr') {
      blocks.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        spacing: { before: 120, after: 120 },
      }));
      return blocks;
    }

    // 容器元素：递归
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'span') {
      for (const child of element.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          blocks.push(...convertBlockElement(child, ctx));
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          blocks.push(new Paragraph({ children: collectInlineElements(child, {}, ctx) }));
        }
      }
      return blocks;
    }

    // 未知元素：提取文本
    const textContent = element.textContent?.trim();
    if (textContent) blocks.push(new Paragraph({ children: [new TextRun({ text: textContent })] }));
    return blocks;
  }

  // ============================================================
  // 表格转换
  // ============================================================

  function convertTable(tableEl, ctx) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const cells = [];
      const cellEls = tr.querySelectorAll('th, td');
      const isHeader = cellEls[0]?.tagName.toLowerCase() === 'th';

      for (const cell of cellEls) {
        const children = [];
        for (const child of cell.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            children.push(...convertBlockElement(child, ctx));
          } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            children.push(new Paragraph({ children: collectInlineElements(child, isHeader ? { bold: true } : {}, ctx) }));
          }
        }
        if (children.length === 0) children.push(new Paragraph({ children: [] }));
        cells.push(new TableCell({
          children,
          shading: isHeader ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E7E7' } : undefined,
        }));
      }
      if (cells.length > 0) rows.push(new TableRow({ children: cells }));
    }
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  // ============================================================
  // Front Matter 元信息表格
  // ============================================================

  function buildFrontMatterTable(meta) {
    if (!meta) return [];
    const fields = [
      ['ID', meta.id], ['标题', meta.title], ['作者', meta.author],
      ['来源', meta.url], ['日期', meta.date],
    ].filter(([, v]) => v);

    const rows = fields.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F0F0F0' },
          }),
          new TableCell({
            children: [new Paragraph({
              children: label === '来源'
                ? [new ExternalHyperlink({ link: value, children: [new TextRun({ text: value, color: '0563C1', underline: { type: 'single' }, size: 20 })] })]
                : [new TextRun({ text: String(value), size: 20 })],
            })],
            width: { size: 80, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F8F8F8' },
          }),
        ],
      })
    );

    return [
      new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      new Paragraph({ children: [] }),
    ];
  }

  // ============================================================
  // 主转换函数
  // ============================================================

  /**
   * @param {string} htmlString - 知乎文章 HTML
   * @param {Object} options - { images: 'embed'|'link', imageData: Map<url, {buffer,ext}>, frontMatter: {id,title,author,url,date} }
   * @returns {Promise<Blob>}
   */
  async function htmlToDocx(htmlString, options) {
    options = options || {};
    const doc = parseHTML(htmlString);
    const body = doc.body;

    const ctx = {
      images: options.images || 'link',
      imageData: options.imageData || new Map(),
      footnotes: [],
    };

    const sections = [];

    if (options.frontMatter) sections.push(...buildFrontMatterTable(options.frontMatter));

    for (const child of body.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        sections.push(...convertBlockElement(child, ctx));
      } else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
        sections.push(new Paragraph({ children: [new TextRun({ text: child.textContent })] }));
      }
    }

    const footnotes = {};
    for (const fn of ctx.footnotes) {
      footnotes[fn.id] = {
        children: [new Paragraph({ children: [new TextRun({ text: fn.text })] })],
      };
    }

    const document = new Document({
      numbering: {
        config: [
          {
            reference: 'bullet-list',
            levels: Array.from({ length: 9 }, (_, i) => ({
              level: i,
              format: LevelFormat.BULLET,
              text: i === 0 ? '\u2022' : i === 1 ? '\u25E6' : '\u25AA',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (i + 1)), hanging: convertInchesToTwip(0.25) } } },
            })),
          },
          {
            reference: 'ordered-list',
            levels: Array.from({ length: 9 }, (_, i) => ({
              level: i,
              format: LevelFormat.DECIMAL,
              text: `%${i + 1}.`,
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (i + 1)), hanging: convertInchesToTwip(0.25) } } },
            })),
          },
        ],
      },
      footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
      sections: [{ children: sections }],
    });

    return await Packer.toBlob(document);
  }

  // ============================================================
  // 评论 docx 生成
  // ============================================================

  async function commentsToDocx(comments, title) {
    const sections = [];

    sections.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `${title} - 评论区` })],
    }));

    const totalCount = comments.reduce((sum, c) => sum + 1 + (c.child_comments?.length || 0), 0);
    sections.push(new Paragraph({ children: [new TextRun({ text: `共 ${totalCount} 条评论`, color: '666666' })] }));
    sections.push(new Paragraph({ children: [] }));

    for (const comment of comments) {
      const authorTag = comment.author_tag?.some?.(t => t.type === 'content_author') ? '（作者）' : '';
      const ipInfo = comment.comment_tag?.find?.(t => t.type === 'ip_info')?.text || '';
      const time = _formatTimestamp(comment.created_time);
      const likes = comment.like_count || 0;
      const metaText = [`${comment.author?.name || '匿名'}${authorTag}`, time, ipInfo, `👍 ${likes}`].filter(Boolean).join(' · ');

      sections.push(new Paragraph({
        children: [new TextRun({ text: metaText, bold: true, size: 20 })],
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: '4A90D9', space: 8 } },
        spacing: { before: 120 },
      }));

      sections.push(new Paragraph({
        children: [new TextRun({ text: _htmlToText(comment.content || ''), size: 20 })],
        indent: { left: convertInchesToTwip(0.3) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: '4A90D9', space: 8 } },
        spacing: { after: 60 },
      }));

      if (comment.child_comments?.length > 0) {
        for (const child of comment.child_comments) {
          const cTag = child.author_tag?.some?.(t => t.type === 'content_author') ? '（作者）' : '';
          const cIp = child.comment_tag?.find?.(t => t.type === 'ip_info')?.text || '';
          const cTime = _formatTimestamp(child.created_time);
          const replyTo = child.reply_to_author?.name ? ` 回复 ${child.reply_to_author.name}` : '';
          const cMeta = [`${child.author?.name || '匿名'}${cTag}${replyTo}`, cTime, cIp].filter(Boolean).join(' · ');

          sections.push(new Paragraph({
            children: [new TextRun({ text: cMeta, bold: true, size: 18, color: '555555' })],
            indent: { left: convertInchesToTwip(0.8) },
            border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 8 } },
            spacing: { before: 60 },
          }));

          sections.push(new Paragraph({
            children: [new TextRun({ text: _htmlToText(child.content || ''), size: 18 })],
            indent: { left: convertInchesToTwip(0.8) },
            border: { left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 8 } },
            spacing: { after: 40 },
          }));
        }
      }

      sections.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E0E0E0' } },
        spacing: { before: 80, after: 80 },
      }));
    }

    const document = new Document({ sections: [{ children: sections }] });
    return await Packer.toBlob(document);
  }

  function _htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  function _formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ============================================================
  // 导出
  // ============================================================

  window.htmlToDocx = htmlToDocx;
  window.commentsToDocx = commentsToDocx;
})();
```

- [ ] **Step 2: 验证无语法错误**

在浏览器控制台中先加载 docx.min.js 再加载 html-to-docx.js，确认：

```js
console.log(typeof window.htmlToDocx);    // "function"
console.log(typeof window.commentsToDocx); // "function"
```

- [ ] **Step 3: Commit**

```bash
git add lib/html-to-docx.js
git commit -m "feat: add html-to-docx converter with full element support"
```

---

### Task 3: 更新 manifest.json

**Files:**
- Modify: `manifest.json:5` (permissions)
- Modify: `manifest.json:40-44` (web_accessible_resources)

- [ ] **Step 1: 添加 `scripting` 权限**

在 `manifest.json` 第 5 行的 permissions 数组中添加 `"scripting"`。

当前：
```json
"permissions": ["activeTab", "storage", "unlimitedStorage"],
```

改为：
```json
"permissions": ["activeTab", "storage", "unlimitedStorage", "scripting"],
```

- [ ] **Step 2: 添加 docx 文件到 web_accessible_resources**

当前（行 40-44）：
```json
"web_accessible_resources": [{
  "resources": ["icons/icon48.png", "content/fetch-bridge.js"],
  "matches": ["https://www.zhihu.com/*", "https://zhuanlan.zhihu.com/*"]
}]
```

改为：
```json
"web_accessible_resources": [{
  "resources": [
    "icons/icon48.png",
    "content/fetch-bridge.js",
    "lib/docx.min.js",
    "lib/docx-math-converter.min.js",
    "lib/html-to-docx.js"
  ],
  "matches": ["https://www.zhihu.com/*", "https://zhuanlan.zhihu.com/*"]
}]
```

注意保留原有的两个 matches 条目（不改为通配符）。

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add scripting permission and docx resources to manifest"
```

---

### Task 4: 更新 background.js 支持动态注入

**Files:**
- Modify: `background.js:7-29`

- [ ] **Step 1: 添加 injectDocxLibs 消息处理**

在 `background.js` 的 `chrome.runtime.onMessage.addListener` 回调中，在 `if (message.action === 'openExportPage')` 分支之后、`if (message.action === 'proxyFetch')` 分支之前，添加新的 action。

注意：MV3 中 `chrome.runtime.onMessage` 的回调不能是 async 函数。需要把 async 逻辑包装在立即调用的 async 函数中，并 `return true` 保持 sendResponse 通道。

在 `background.js` 第 11 行（`return;` 之后）添加：

```js

  if (message.action === 'injectDocxLibs') {
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          files: ['lib/docx.min.js', 'lib/docx-math-converter.min.js', 'lib/html-to-docx.js'],
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat: add dynamic docx library injection via background script"
```

---

### Task 5: 添加 docx 工具函数（export-utils.js）

**注意：本 Task 必须在 Task 6 之前完成，因为 Task 6 会使用此处新增的函数。**

**Files:**
- Modify: `content/export-utils.js:143-148` (writeTextFile 附近)
- Modify: `content/export-utils.js:202-218` (exports 对象)

- [ ] **Step 1: 添加 writeBlobFile 函数**

在 `export-utils.js` 的 `writeTextFile` 函数（行 143-148）之后添加：

```js
  /**
   * 将 Blob 写入文件夹（用于 docx 等二进制文件）
   */
  async function writeBlobFile(folderHandle, filename, blob) {
    const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
```

- [ ] **Step 2: 添加 buildImageDataMap 函数**

紧接着 `writeBlobFile` 之后添加：

```js
  /**
   * 将 batchDownloadImages 的结果转换为 html-to-docx 需要的 imageData Map
   * @param {Object} imageMapping - URL → 本地路径
   * @param {Array} imageFiles - { path, buffer } 数组
   * @returns {Map} URL → { buffer, ext }
   */
  function buildImageDataMap(imageMapping, imageFiles) {
    const map = new Map();
    const pathToBuffer = new Map();
    for (const file of imageFiles) {
      pathToBuffer.set(file.path, file.buffer);
    }
    for (const [url, path] of Object.entries(imageMapping)) {
      const buffer = pathToBuffer.get(path);
      if (buffer) {
        map.set(url, { buffer, ext: path.split('.').pop() || 'jpg' });
      }
    }
    return map;
  }
```

- [ ] **Step 3: 更新 exports 对象**

在 `window.__exportUtils` 导出对象（行 202-218）中添加新函数。在 `writeTextFile,` 之后添加：

```js
    writeBlobFile,
    buildImageDataMap,
```

- [ ] **Step 4: Commit**

```bash
git add content/export-utils.js
git commit -m "feat: add writeBlobFile and buildImageDataMap utilities for docx export"
```

---

### Task 6: 更新单篇导出面板（article-panel.js）

**Files:**
- Modify: `content/article-panel.js:78-128` (innerHTML 模板)
- Modify: `content/article-panel.js:130-143` (refs 对象)
- Modify: `content/article-panel.js:182-196` (updateBtnText)
- Modify: `content/article-panel.js:221-338` (handleArticleDownload)
- Modify: `content/article-panel.js:340-440` (handleSaveToFolder)

**重要**：此文件的 UI 是通过 `body.innerHTML = \`...\`` 模板字面量构建的（行 78-128），refs 对象从中查询 DOM 元素（行 130-143）。所有 UI 变更必须在模板内修改，不能用 appendChild。

- [ ] **Step 1: 在 innerHTML 模板中添加格式选择和 docx 图片选项**

在 `article-panel.js` 行 99 的 `<div class="options">` 内，在现有的 3 个 option-item 之前，添加格式选择和 docx 图片选项：

将行 99-111 从：

```html
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
```

改为：

```html
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
```

- [ ] **Step 2: 更新 refs 对象**

在行 130-143 的 refs 对象中，添加新的 DOM 引用。在 `optComment` 之后添加：

```js
      optImgRow: body.querySelector('#opt-img-row'),
      docxImgOpts: body.querySelector('#docx-img-opts'),
```

- [ ] **Step 3: 添加格式切换事件监听**

在行 195-196（`refs.optImg.addEventListener('change', updateBtnText);` 附近）之后，添加格式 radio 的事件监听：

```js
    // 格式切换
    body.querySelectorAll('input[name="export-format"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isDocx = body.querySelector('input[name="export-format"]:checked')?.value === 'docx';
        refs.optImgRow.style.display = isDocx ? 'none' : '';
        refs.docxImgOpts.style.display = isDocx ? 'flex' : 'none';
        updateBtnText();
      });
    });
```

- [ ] **Step 4: 修改 updateBtnText 函数**

将行 182-194 的 `updateBtnText` 替换为：

```js
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
```

- [ ] **Step 5: 修改 handleArticleDownload 添加 docx 分支**

在 `handleArticleDownload` 函数的开头（行 222 之后），添加格式获取：

```js
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = document.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
```

然后在 `try {` 块中（行 247 之后），将整个现有逻辑包裹在 `if (format === 'md') { ... } else { ... }` 中。

`else`（docx）分支的完整代码：

```js
      // ===== DOCX 导出 =====
      // 确保 docx 库已加载
      if (typeof window.htmlToDocx !== 'function') {
        articleLog(refs, '正在加载 Word 导出库...', 'info');
        const resp = await chrome.runtime.sendMessage({ action: 'injectDocxLibs' });
        if (!resp?.success) {
          throw new Error('无法加载 Word 导出库: ' + (resp?.error || '未知错误'));
        }
      }

      // 图片处理
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

      // 生成 docx
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

      // 评论处理
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

        // 打包 ZIP
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
```

**关键变量名对照**（已确认与现有代码一致）：
- `refs.btn` — 下载按钮（行 131）
- `refs.optFm` — Front Matter checkbox（行 136）
- `refs.optImg` — 图片 checkbox（行 137）
- `refs.optComment` — 评论 checkbox（行 138）
- `data.html` — 文章 HTML 内容（由 `api.extractContent()` 返回）
- `data.title`, `data.author`, `data.type`, `data.id`, `data.url` — 元数据字段
- `wantComment` — 已在行 226 定义（`refs.optComment.checked`）

- [ ] **Step 6: 修改 handleSaveToFolder 添加 docx 分支**

在 `handleSaveToFolder` 函数中（行 340），添加格式获取和 docx 分支。

在行 356（`refs.btnSaveFolder.disabled = true;`）之后添加格式获取：

```js
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = document.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
```

然后将 `try { ... }` 内的逻辑（行 367-431）包裹在格式判断中。`format === 'docx'` 分支的完整代码：

```js
      // ===== DOCX 保存到文件夹 =====
      // 加载 docx 库
      if (typeof window.htmlToDocx !== 'function') {
        articleLog(refs, '正在加载 Word 导出库...', 'info');
        const resp = await chrome.runtime.sendMessage({ action: 'injectDocxLibs' });
        if (!resp?.success) throw new Error('无法加载 Word 导出库: ' + (resp?.error || '未知错误'));
      }

      // 图片处理
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

      // 生成 docx
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

      const baseName = u.sanitizeFilename(
        `${data.title}-${data.author}的${u.TYPE_LABELS[data.type] || data.type}`
      );

      // 评论处理
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
```

注意 `wantComment` 变量名需改为读取 `refs.optComment.checked`（或在函数开头定义，参考行 359）。

- [ ] **Step 7: Commit**

```bash
git add content/article-panel.js
git commit -m "feat: add docx format selection and export to article panel"
```

---

### Task 7: 更新批量导出页面（export.html + export.js）

**Files:**
- Modify: `export/export.html:37-48` (文件夹选择之后)
- Modify: `export/export.html:65` (图片选项行)
- Modify: `export/export.html:145-152` (script 标签)
- Modify: `export/export.js:29-45` (DOM 引用)
- Modify: `export/export.js:170-180` (init)
- Modify: `export/export.js:186-210` (handleSelectFolder)

- [ ] **Step 1: 在 export.html 中添加格式选择 UI**

在 `export.html` 的文件夹选择区域之后（约行 48 `</section>` 之后），文章导出区域之前（约行 53 `<section>` 之前），添加：

```html
      <!-- 格式选择（选择文件夹后显示） -->
      <section id="format-section" style="display:none;">
        <h2>导出格式</h2>
        <div style="display:flex;gap:16px;align-items:center;margin-bottom:8px;">
          <label><input type="radio" name="export-format" value="md" checked> Markdown</label>
          <label><input type="radio" name="export-format" value="docx"> Word (.docx)</label>
        </div>
        <div id="docx-img-opts" style="display:none;">
          <label><input type="radio" name="docx-img" value="embed" checked> 嵌入图片到文档</label>
          <label><input type="radio" name="docx-img" value="link"> 图片使用外部链接</label>
        </div>
      </section>
```

- [ ] **Step 2: 给图片选项行添加 id**

在 `export.html` 行 65 附近的图片下载选项处，给包含 `#opt-img` 的容器添加 id `md-img-row`，以便 JS 可以控制显隐：

```html
<div id="md-img-row">
  <label>
    <input type="checkbox" id="opt-img" checked>
    下载图片到本地
  </label>
</div>
```

- [ ] **Step 3: 添加 docx 库的 script 标签**

在 `export.html` 的 script 标签区域（约行 145），在 `<script src="../lib/html-to-markdown.js"></script>` 之后添加：

```html
    <script src="../lib/docx.min.js"></script>
    <script src="../lib/docx-math-converter.min.js"></script>
    <script src="../lib/html-to-docx.js"></script>
```

- [ ] **Step 4: 在 export.js 中添加 DOM 引用和格式切换逻辑**

在 `export.js` 的 `els` 对象（行 29-45）中添加：

```js
    formatSection: document.getElementById('format-section'),
    docxImgOpts: document.getElementById('docx-img-opts'),
    mdImgRow: document.getElementById('md-img-row'),
```

在 `init()` 函数中添加格式切换事件：

```js
    // 格式切换
    document.querySelectorAll('input[name="export-format"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isDocx = document.querySelector('input[name="export-format"]:checked')?.value === 'docx';
        els.docxImgOpts.style.display = isDocx ? '' : 'none';
        if (els.mdImgRow) els.mdImgRow.style.display = isDocx ? 'none' : '';
      });
    });
```

- [ ] **Step 5: 在 handleSelectFolder 成功后显示格式选择**

在 `handleSelectFolder` 函数中（约行 208），成功选择文件夹并 reconcile 完成后添加：

```js
    els.formatSection.style.display = '';
```

- [ ] **Step 6: Commit**

```bash
git add export/export.html export/export.js
git commit -m "feat: add docx format selection UI to batch export page"
```

---

### Task 8: 批量导出 docx 逻辑（export.js）

**Files:**
- Modify: `export/export.js:216-286` (reconcileProgress)
- Modify: `export/export.js:487-636` (handleExportArticles)
- Modify: `export/export.js:641-673` (updateReadme)
- Modify: `export/export.js:679-766` (handleExportComments)

- [ ] **Step 1: 更新 reconcileProgress 识别 .docx 文件**

在 `reconcileProgress` 函数中（行 228-256），当前只扫描 `.md` 文件。需要同时识别 `.docx`。

将行 230 从：
```js
        if (!name.endsWith('.md')) continue;
```

改为：
```js
        if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
```

将行 231 从：
```js
        if (name === 'README.md') continue;
```

改为：
```js
        if (name === 'README.md' || name === 'README.docx') continue;
```

将行 233-234 从：
```js
        if (name.endsWith('-评论.md')) {
          commentedFiles.add(name.replace(/-评论\.md$/, '.md'));
```

改为：
```js
        if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) {
          commentedFiles.add(name.replace(/-评论\.(md|docx)$/, '.$1'));
```

对于 `.docx` 文件的 Front Matter ID 提取：docx 文件是二进制的，无法像 md 文件那样从文本头部读取 id 字段。简化方案：对 `.docx` 文件，从文件名中提取信息（不做 ID 提取，只记录存在），或者在进度文件中增加格式字段。

最简单的方案：在导出 docx 时，把 `item.id` 写入进度文件就足够了（`progress.addExportedArticle` 已经在做这件事）。reconcileProgress 对 `.docx` 文件跳过 Front Matter 读取，但不从 foundIds 中排除它们：

在行 238-256 的 "读取 Front Matter 提取 ID" 块之前添加：

```js
        // docx 文件无法从内容提取 ID，依赖进度文件记录
        if (name.endsWith('.docx')) {
          // 不加入 foundIds，让进度文件保持权威
          continue;
        }
```

但这会导致 docx 模式下 reconcileProgress 无法校准。更好的方案是对 docx 文件完全跳过校准，保持进度文件的记录为准。在函数开头添加格式检查：

```js
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
```

当 `format === 'docx'` 时，跳过文件扫描校准（只信任进度文件）。

- [ ] **Step 2: 修改 handleExportArticles 支持 docx**

在 `handleExportArticles` 函数开头（行 492 之后）添加格式获取：

```js
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
    const docxImgMode = document.querySelector('input[name="docx-img"]:checked')?.value || 'embed';
    const wantImg = format === 'md' ? els.optImg.checked : (docxImgMode === 'embed');
```

将行 492 的 `const wantImg = els.optImg.checked;` 替换为上面的逻辑。

在行 500-503（imagesFolder 创建）添加条件：

```js
      let imagesFolder = null;
      if (wantImg && format === 'md') {
        imagesFolder = await articlesFolder.getDirectoryHandle('images', { create: true });
      }
```

在逐篇处理循环中（行 587-604），将 Markdown 转换和写入包裹在格式判断中。

将行 587-604 从：
```js
            // 图片处理
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

            // 转换 Markdown（始终生成 Front Matter）
            let md = htmlToMarkdown(item.html || '', imageMapping);
            md = u.buildFrontmatter(item) + md;

            // 写入文件
            await u.writeTextFile(articlesFolder, filename, md);
```

改为：
```js
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
                frontMatter: { id: item.id, title: item.title, author: item.author?.name || item.author, url: item.url, date: new Date().toISOString().split('T')[0] },
              });

              const docxFilename = filename.replace(/\.md$/, '.docx');
              await u.writeBlobFile(articlesFolder, docxFilename, docxBlob);
            } else {
              // === Markdown 模式（现有逻辑） ===
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
```

同时需要修改 filename 的构建（行 545）：

```js
            let filename = format === 'docx' ? `${baseName}.docx` : `${baseName}.md`;
```

文件名冲突检查（行 546-550）也需要适配后缀。

- [ ] **Step 3: 修改 updateReadme 识别 .docx 文件**

在 `updateReadme` 函数中（行 641-673），修改文件扫描逻辑。

将行 650 从：
```js
        if (!name.endsWith('.md')) continue;
```

改为：
```js
        if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
```

将行 651 从：
```js
        if (name.endsWith('-评论.md')) continue;
```

改为：
```js
        if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) continue;
```

将行 660 从：
```js
          title: name.replace(/\.md$/, ''),
```

改为：
```js
          title: name.replace(/\.(md|docx)$/, ''),
```

- [ ] **Step 4: 修改 handleExportComments 支持 docx**

在 `handleExportComments` 函数中（行 679），添加格式判断。

在行 694 的 `try {` 之后添加：
```js
      const format = document.querySelector('input[name="export-format"]:checked')?.value || 'md';
```

将行 742-744 从：
```js
            const commentMd = buildCommentsMarkdown(comments, displayTitle, commentImageMapping);
            const commentFilename = `${baseName}-评论.md`;
            await u.writeTextFile(articlesFolder, commentFilename, commentMd);
```

改为：
```js
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
```

并将紧接其后原有的 `const totalComments...` 和 `log(...)` 行删除（已移入上方分支中）。

- [ ] **Step 5: Commit**

```bash
git add export/export.js
git commit -m "feat: add docx export support to batch export manager"
```

---

### Task 9: 端到端测试与修复

- [ ] **Step 1: 测试单篇 docx 导出（链接模式）**

1. 加载扩展（开发者模式）
2. 打开知乎文章，点击浮动按钮
3. 选择 Word 格式 + 图片使用外部链接
4. 点击「下载 Word」
5. 用 Word/WPS 打开，验证标题、段落、粗斜体、链接、引用、列表、代码块

- [ ] **Step 2: 测试单篇 docx 导出（嵌入模式）**

1. 选择"嵌入图片到文档"
2. 下载 .docx，验证图片正常显示

- [ ] **Step 3: 测试数学公式**

1. 找一篇含公式的文章
2. 导出 docx，验证公式为 Word 原生可编辑公式
3. 若公式库加载失败，验证降级为等宽字体 LaTeX 文本

- [ ] **Step 4: 测试评论 docx**

1. 勾选「导出评论区」
2. 下载 ZIP，验证含 文章.docx + 评论.docx
3. 打开评论 docx 验证格式

- [ ] **Step 5: 测试保存到文件夹**

1. Word 格式 → 保存到文件夹
2. 验证 .docx 文件写入正确

- [ ] **Step 6: 测试批量导出 docx**

1. 收藏夹页 → 导出管理器
2. 选择 Word 格式 → 开始导出
3. 验证 .docx 文件内容、README.md 链接、进度恢复

- [ ] **Step 7: 验证 Markdown 导出未受影响**

1. 切回 Markdown 格式
2. 单篇和批量导出均正常

- [ ] **Step 8: 修复问题并提交**

```bash
git add -A
git commit -m "fix: address issues found during docx export testing"
```

---

### Task 10: 版本更新与收尾

- [ ] **Step 1: 更新 manifest.json 版本号**

`2.0.2` → `2.1.0`

- [ ] **Step 2: 更新 README.md changelog**

```markdown
### v2.1.0
- 新增 Word (.docx) 导出格式，支持单篇和批量导出
- 支持图片嵌入或外部链接两种模式
- 数学公式导出为 Word 原生公式（OMML）
- 评论可独立导出为 .docx 文件
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json README.md
git commit -m "chore: bump version to 2.1.0, update changelog for docx export"
```
