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

  const hu = window.__zhihuHtmlUtils;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const urls = new Set();

  doc.querySelectorAll('img').forEach((img) => {
    if (hu.isMath(img)) return;
    const src = hu.getImageUrl(img);
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

    const hu = window.__zhihuHtmlUtils;

    function mapImageUrl(url) {
      return (imageMapping && imageMapping[url]) ? imageMapping[url] : url;
    }

    // 规则 0：跳过知乎目录导航和参考文献列表
    turndownService.addRule('skipZhihuCatalogAndRef', {
      filter: (node) => hu.isCatalog(node) || hu.isReferenceList(node),
      replacement: () => '',
    });

    // 规则 1：行内公式
    turndownService.addRule('mathInlineToLatex', {
      filter: (node) => hu.isInlineMath(node),
      replacement(content, node) {
        const latex = hu.getLatex(node);
        if (!latex) return '';
        if (latex.endsWith('\\\\')) return `$$${latex.slice(0, -2)}$$`;
        return `$${latex}$`;
      },
    });

    // 规则 2：块级公式
    turndownService.addRule('mathBlockToLatex', {
      filter: (node) => hu.isBlockMath(node),
      replacement: (content, node) => `$$${hu.getLatex(node)}$$`,
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
        const src = hu.getImageUrl(img);
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

    // 规则 7：知乎引用脚注
    turndownService.addRule('footnote', {
      filter: (node) => hu.isFootnote(node) && /^\[\d+\]$/.test(node.textContent || ''),
      replacement(content, node) {
        const info = hu.getFootnoteInfo(node);
        footnotes[info.numero] = `${info.text} ${info.url}`;
        return `[^${info.numero}]`;
      },
    });

    // 规则 8：知乎视频占位
    turndownService.addRule('zhihuVideo', {
      filter: (node) => hu.isVideo(node),
      replacement(content, node) {
        const info = hu.getVideoInfo(node);
        return `[${info.title}](${info.href})`;
      },
    });

    // 规则 9：知乎链接卡片
    turndownService.addRule('zhihuLinkCard', {
      filter: (node) => hu.isLinkCard(node),
      replacement(content, node) {
        const info = hu.getLinkCardInfo(node);
        return `[${info.title}](${info.href})`;
      },
    });

    // 规则 10：普通 img 标签（非数学公式）也需要路径映射
    turndownService.addRule('imgWithMapping', {
      filter: (node) => node.nodeName === 'IMG' && !hu.isMath(node) && !node.closest('figure'),
      replacement(content, node) {
        const src = hu.getImageUrl(node);
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

function commentHtmlToText(html, imageMapping) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

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

  div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  div.querySelectorAll('p').forEach((p) => {
    p.insertAdjacentText('afterend', '\n');
  });

  return div.textContent.trim();
}

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

// 导出供 popup 使用
if (typeof window !== 'undefined') {
  window.htmlToMarkdown = htmlToMarkdown;
  window.extractImageUrls = extractImageUrls;
  window.inferImageExtension = inferImageExtension;
  window.commentHtmlToText = commentHtmlToText;
  window.extractCommentImageUrls = extractCommentImageUrls;
  window.buildCommentsMarkdown = buildCommentsMarkdown;
}
