/**
 * HTML 转 Markdown 转换器
 * 移植自 Obsidian 知乎插件的 html_to_markdown.ts
 * 使用 Turndown 库，添加知乎特定的转换规则
 */

/**
 * 从 HTML 中提取所有图片 URL
 * @param {string} html - HTML 内容
 * @returns {string[]} 图片 URL 列表（已去重）
 */
function extractImageUrls(html) {
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const urls = new Set();

  doc.querySelectorAll('img').forEach((img) => {
    // 跳过数学公式图片
    if (img.getAttribute('eeimg')) return;

    const src =
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('src') ||
      '';

    if (src && /^https?:\/\//i.test(src)) {
      urls.add(src);
    }
  });

  return Array.from(urls);
}

/**
 * 从图片 URL 推断文件扩展名
 * @param {string} url - 图片 URL
 * @param {string} contentType - Content-Type 响应头
 * @returns {string} 文件扩展名（含点号）
 */
function inferImageExtension(url, contentType) {
  // 优先使用 Content-Type
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
  };

  if (contentType) {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (mimeToExt[mime]) return mimeToExt[mime];
  }

  // 从 URL 路径推断
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch {
    // ignore
  }

  return '.jpg';
}

/**
 * 将知乎 HTML 内容转换为 Markdown
 * @param {string} html - 知乎文章的 HTML 内容
 * @param {Object.<string, string>} [imageMapping] - URL → 本地路径的映射表，用于替换图片路径
 * @returns {string} Markdown 格式文本
 */
function htmlToMarkdown(html, imageMapping) {
  if (!html || typeof html !== 'string') return '';

  try {
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });

    /**
     * 解析图片 src，优先取高清源
     */
    function resolveImgSrc(node) {
      return (
        node.getAttribute('data-original') ||
        node.getAttribute('data-actualsrc') ||
        node.getAttribute('src') ||
        ''
      );
    }

    /**
     * 将图片 URL 映射为本地路径（如果有 mapping）
     */
    function mapImageUrl(url) {
      if (imageMapping && imageMapping[url]) {
        return imageMapping[url];
      }
      return url;
    }

    // 规则 1：数学公式图片转为 LaTeX（行内公式）
    turndownService.addRule('mathInlineToLatex', {
      filter(node) {
        return (
          node.nodeName === 'IMG' &&
          node.getAttribute('eeimg') === '1'
        );
      },
      replacement(content, node) {
        const alt = node.getAttribute('alt') || '';
        const trimmedAlt = alt.trim();
        if (trimmedAlt.endsWith('\\\\')) {
          return `$$${trimmedAlt.slice(0, -2)}$$`;
        }
        return `$${trimmedAlt}$`;
      },
    });

    // 规则 2：数学公式图片转为 LaTeX（块级公式）
    turndownService.addRule('mathBlockToLatex', {
      filter(node) {
        return (
          node.nodeName === 'IMG' &&
          node.getAttribute('eeimg') === '2'
        );
      },
      replacement(content, node) {
        const alt = node.getAttribute('alt') || '';
        return `$$${alt.trim()}$$`;
      },
    });

    // 规则 3：带 lang 的 <pre> 转为围栏代码块
    turndownService.addRule('preWithLang', {
      filter(node) {
        return (
          node.nodeName === 'PRE' &&
          node.getAttribute('lang') !== null
        );
      },
      replacement(content, node) {
        const lang = node.getAttribute('lang') || '';
        const code = node.textContent || '';
        return `\`\`\`${lang}\n${code.trim()}\n\`\`\``;
      },
    });

    // 规则 4：HTML 表格转 Markdown 表格
    turndownService.addRule('tableToMarkdown', {
      filter: ['table'],
      replacement(content, node) {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (rows.length === 0) return '';

        let markdown = '';
        const headers = Array.from(rows[0].querySelectorAll('th, td'));
        const headerTexts = headers.map(
          (cell) => cell.textContent?.trim() || ''
        );
        markdown += `| ${headerTexts.join(' | ')} |\n`;
        markdown += `| ${headerTexts.map(() => '-----').join(' | ')} |\n`;
        rows.slice(1).forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          const cellTexts = cells.map(
            (cell) => cell.textContent?.trim() || ''
          );
          markdown += `| ${cellTexts.join(' | ')} |\n`;
        });

        return markdown;
      },
    });

    // 规则 5：<figure> 中的图片和标题（带图片路径映射）
    turndownService.addRule('figureToImage', {
      filter: ['figure'],
      replacement(content, node) {
        const img = node.querySelector('img');
        const figcaption = node.querySelector('figcaption');
        if (!img) return '';
        const src = resolveImgSrc(img);
        const localSrc = mapImageUrl(src);
        const alt = figcaption?.textContent?.trim() || '';
        return `![${alt}](${localSrc})`;
      },
    });

    // 规则 6：忽略标题标签中的 <br>
    turndownService.addRule('ignoreBrInHeading', {
      filter(node) {
        return (
          node.nodeName === 'BR' &&
          node.parentElement?.nodeName.match(/^H[1-6]$/) !== null
        );
      },
      replacement() {
        return '';
      },
    });

    // 脚注收集
    const footnotes = {};

    // 规则 7：知乎引用脚注 <sup data-*>
    turndownService.addRule('footnote', {
      filter(node) {
        return (
          node.nodeName === 'SUP' &&
          typeof node.dataset?.text === 'string' &&
          typeof node.dataset?.url === 'string' &&
          /^\[\d+\]$/.test(node.textContent || '')
        );
      },
      replacement(content, node) {
        const numero = node.dataset.numero || '1';
        const label = `[^${numero}]`;
        footnotes[numero] = `${node.dataset.text} ${node.dataset.url}`;
        return label;
      },
    });

    // 规则 8：知乎视频占位
    turndownService.addRule('zhihuVideo', {
      filter(node) {
        return (
          node.nodeName === 'A' &&
          node.classList.contains('video-box')
        );
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const titleEl = node.querySelector('.video-box-title');
        const title = titleEl?.textContent?.trim() || '视频';
        return `[${title}](${href})`;
      },
    });

    // 规则 9：知乎链接卡片
    turndownService.addRule('zhihuLinkCard', {
      filter(node) {
        return (
          node.nodeName === 'A' &&
          node.classList.contains('LinkCard')
        );
      },
      replacement(content, node) {
        const href = node.getAttribute('href') || '';
        const titleEl = node.querySelector('.LinkCard-title');
        const title = titleEl?.textContent?.trim() || href;
        return `[${title}](${href})`;
      },
    });

    // 规则 10：普通 img 标签（非数学公式）也需要路径映射
    turndownService.addRule('imgWithMapping', {
      filter(node) {
        return (
          node.nodeName === 'IMG' &&
          !node.getAttribute('eeimg') &&
          !node.closest('figure')
        );
      },
      replacement(content, node) {
        const src = resolveImgSrc(node);
        const localSrc = mapImageUrl(src);
        const alt = node.getAttribute('alt') || '';
        if (!src) return '';
        return `![${alt}](${localSrc})`;
      },
    });

    let markdown = turndownService.turndown(html);

    // 将脚注追加到文末
    const footnoteEntries = Object.entries(footnotes)
      .map(([num, text]) => `[^${num}]: ${text}`)
      .join('\n');

    if (footnoteEntries) {
      markdown += `\n\n${footnoteEntries}`;
    }

    return markdown;
  } catch (error) {
    console.error('HTML 转 Markdown 失败:', error);
    return '';
  }
}

// 导出供 popup 使用
if (typeof window !== 'undefined') {
  window.htmlToMarkdown = htmlToMarkdown;
  window.extractImageUrls = extractImageUrls;
  window.inferImageExtension = inferImageExtension;
}
