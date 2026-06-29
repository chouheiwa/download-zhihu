#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUT_DIR = 'exports';

function printUsage() {
  console.log(`Usage:
  npm run export:local -- <zhihu-url> [more-urls...] [options]
  npm run export:local -- --input urls.txt [options]

Options:
  --out <dir>          Output directory. Default: ${DEFAULT_OUT_DIR}
  --input <file>       Read URLs from a text file, one URL per line
  --cookie <cookie>    Raw Cookie header for pages that need login
  --cookie-file <file> Read raw Cookie header from a file
  --no-images          Do not download article images
  --help               Show this help

Examples:
  npm run export:local -- https://zhuanlan.zhihu.com/p/123456
  npm run export:local -- https://www.zhihu.com/collection/825550242 --out ./zhihu-export
  npm run export:local -- --input urls.txt --out ./zhihu-export
`);
}

function parseArgs(argv) {
  const opts = {
    outDir: DEFAULT_OUT_DIR,
    inputFile: '',
    cookie: '',
    downloadImages: true,
    urls: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--out') opts.outDir = argv[++i] || opts.outDir;
    else if (arg === '--input') opts.inputFile = argv[++i] || '';
    else if (arg === '--cookie') opts.cookie = argv[++i] || '';
    else if (arg === '--cookie-file') opts.cookieFile = argv[++i] || '';
    else if (arg === '--no-images') opts.downloadImages = false;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else opts.urls.push(arg);
  }

  return opts;
}

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
      return { type, id: type === 'answer' ? match[2] : match[1] };
    }
  }
  return null;
}

function sanitizeFilename(name) {
  return String(name || '知乎内容')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/:*?"<>|#^\[\]()（）]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || '知乎内容';
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildFrontmatter(data) {
  const lines = [
    '---',
    `id: "${data.id || ''}"`,
    `title: "${String(data.title || '').replace(/"/g, '\\"')}"`,
    `author: "${String(data.author || '').replace(/"/g, '\\"')}"`,
    `type: zhihu-${data.type}`,
    `source: "${data.url}"`,
  ];
  const created = formatTimestamp(data.createdTime);
  const updated = formatTimestamp(data.updatedTime);
  if (created) lines.push(`created: "${created}"`);
  if (updated) lines.push(`updated: "${updated}"`);
  const collected = formatTimestamp(data.collectedTime);
  if (collected) lines.push(`collected: "${collected}"`);
  lines.push(`downloaded: "${new Date().toISOString().split('T')[0]}"`);
  lines.push('---', '');
  return lines.join('\n');
}

function fixHttpUrl(url) {
  return url ? url.replace(/^http:\/\//, 'https://') : null;
}

function buildItemName(item, num) {
  const typeLabels = {
    article: '文章',
    answer: '回答',
    question: '问题',
    pin: '想法',
  };
  const typeLabel = typeLabels[item.type] || item.type || '内容';
  if (item.type === 'article') return item.title || `${item.author}的文章_${num}`;
  if (item.type === 'answer') return item.title ? `${item.title}-${item.author}的回答` : `${item.author}的回答_${num}`;
  if (item.type === 'pin') return item.title ? `${item.title}-${item.author}的想法` : `${item.author}的想法_${num}`;
  return item.title ? `${item.title}-${item.author}的${typeLabel}` : `${item.author}的${typeLabel}_${num}`;
}

function extractInitialData(document) {
  const script = document.querySelector('script#js-initialData[type="text/json"]');
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent);
  } catch {
    return null;
  }
}

function extractFromInitialData(root, pageInfo, url) {
  const { type, id } = pageInfo;
  const state = root?.initialState?.entities || {};

  if (type === 'answer') {
    const questionId = url.match(/question\/(\d+)/)?.[1] || '';
    const data = state.answers?.[id];
    if (!data) return null;
    return {
      id,
      type,
      url,
      title: data.question?.title || `知乎问题${questionId}`,
      author: data.author?.name || '知乎用户',
      html: data.content || '',
      createdTime: data.created_time || null,
      updatedTime: data.updated_time || null,
    };
  }

  if (type === 'article') {
    const data = state.articles?.[id];
    if (!data) return null;
    return {
      id,
      type,
      url,
      title: data.title || `知乎文章${id}`,
      author: data.author?.name || '知乎用户',
      html: data.content || '',
      createdTime: data.created || null,
      updatedTime: data.updated || null,
    };
  }

  if (type === 'question') {
    const data = state.questions?.[id];
    if (!data) return null;
    let answersHtml = '';
    for (const answer of Object.values(state.answers || {})) {
      const author = answer?.author?.name || '知乎用户';
      const answerUrl = `https://www.zhihu.com/question/${id}/answer/${answer?.id}`;
      answersHtml += `<h1><a href="${answerUrl}">${author}的回答</a></h1><div>${answer?.content || ''}</div>`;
    }
    return {
      id,
      type,
      url,
      title: data.title || `知乎问题${id}`,
      author: data.author?.name || '知乎用户',
      html: `${data.detail || ''}${answersHtml}`,
      createdTime: data.created || null,
      updatedTime: data.updated_time || null,
    };
  }

  if (type === 'pin') {
    const data = state.pins?.[id];
    if (!data) return null;
    const users = Object.values(state.users || {});
    const author = users.find((u) => u?.name)?.name || '知乎用户';
    const contentHtml = typeof data.contentHtml === 'string' ? data.contentHtml : '';
    const imageHtml = Array.isArray(data.content)
      ? data.content
          .filter((item) => item?.type === 'image' && (item.originalUrl || item.url))
          .map((item) => `<img src="${item.originalUrl || item.url}" alt="" />`)
          .join('\n')
      : '';
    return {
      id,
      type,
      url,
      title: `想法${id}`,
      author,
      html: `${contentHtml}${imageHtml ? `<div>${imageHtml}</div>` : ''}`,
      createdTime: data.created || null,
      updatedTime: data.updated || null,
    };
  }

  return null;
}

function extractFromDOM(document, pageInfo, url) {
  const { type, id } = pageInfo;
  if (type === 'article') {
    return {
      id,
      type,
      url,
      title: document.querySelector('.Post-Title')?.textContent?.trim() || document.title || '知乎文章',
      author: document.querySelector('.AuthorInfo-name .UserLink-link')?.textContent?.trim() || '知乎用户',
      html: document.querySelector('.Post-RichText')?.innerHTML || '',
    };
  }
  if (type === 'answer') {
    return {
      id,
      type,
      url,
      title: document.querySelector('.QuestionHeader-title')?.textContent?.trim() || document.title || '知乎回答',
      author: document.querySelector('.AuthorInfo-name .UserLink-link')?.textContent?.trim() || '知乎用户',
      html: document.querySelector('.RichContent-inner')?.innerHTML || '',
    };
  }
  if (type === 'question') {
    return {
      id,
      type,
      url,
      title: document.querySelector('.QuestionHeader-title')?.textContent?.trim() || document.title || '知乎问题',
      author: '知乎用户',
      html: document.querySelector('.QuestionRichText--collapsed, .QuestionRichText--expandable')?.innerHTML || '',
    };
  }
  if (type === 'pin') {
    return {
      id,
      type,
      url,
      title: '知乎想法',
      author: '知乎用户',
      html: document.querySelector('.PinItem-contentWrapper')?.innerHTML || '',
    };
  }
  return null;
}

function chooseContent(fromData, fromDOM) {
  if (fromData && fromDOM) {
    return (fromDOM.html || '').length > (fromData.html || '').length ? fromDOM : fromData;
  }
  return fromData || fromDOM;
}

function parseContentItem(rawItem) {
  const collectedTime = rawItem.created
    ? Math.floor(new Date(rawItem.created).getTime() / 1000)
    : 0;
  const c = rawItem.content || {};
  const type = c.type || 'unknown';

  let title = '';
  let html = '';
  if (type === 'article') {
    title = c.title || '';
    html = c.content || '';
  } else if (type === 'answer') {
    title = c.question?.title || '';
    html = c.content || '';
  } else if (type === 'pin') {
    html = (typeof c.content === 'string' ? c.content : '') || c.excerpt || '';
    const textContent = html.replace(/<[^>]*>/g, '').trim();
    title = textContent.slice(0, 30) || '想法';
    if (Array.isArray(c.content)) {
      const imgsHtml = c.content
        .filter((entry) => entry?.type === 'image' && (entry.originalUrl || entry.url))
        .map((entry) => `<img src="${entry.originalUrl || entry.url}" alt="" />`)
        .join('\n');
      if (imgsHtml) html += `\n${imgsHtml}`;
    }
  } else {
    html = (typeof c.content === 'string' ? c.content : '') || c.excerpt || '';
    title = c.title || '';
  }

  return {
    id: String(c.id || c.url || `${type}_${collectedTime || Math.random()}`),
    type,
    url: c.url || '',
    title,
    author: c.author?.name || '知乎用户',
    html,
    isTruncated: !!c.content_need_truncated,
    isPaidContent: c.is_free === 0,
    createdTime: c.created_time || c.created || 0,
    updatedTime: c.updated_time || c.updated || 0,
    collectedTime,
  };
}

function getCollectionTitle(document, id) {
  const titleEl =
    document.querySelector('.CollectionDetailPageHeader-title') ||
    document.querySelector('[class*="CollectionDetail"] h2') ||
    document.querySelector('h1');
  const title = titleEl?.textContent?.trim();
  if (title) return title;
  const pageTitle = (document.title || '').replace(/^\(\d+\s*条消息\)\s*/, '').split(' - ')[0].trim();
  return pageTitle || `收藏夹${id}`;
}

function getImageUrl(img) {
  const attrs = ['data-original', 'data-actualsrc', 'data-src', 'src'];
  for (const attr of attrs) {
    const value = img.getAttribute(attr);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  const srcset = img.getAttribute('srcset') || '';
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return first && /^https?:\/\//i.test(first) ? first : '';
}

function getLatex(el) {
  const attrs = ['data-tex', 'data-latex', 'alt'];
  for (const attr of attrs) {
    const value = el.getAttribute(attr);
    if (value && /\\|[\^_{}]/.test(value)) return value;
  }
  const src = el.getAttribute('src') || '';
  try {
    const parsed = new URL(src);
    const tex = parsed.searchParams.get('tex') || parsed.searchParams.get('latex');
    if (tex) return tex;
  } catch {
    // ignore invalid URLs
  }
  return '';
}

function replaceMathImages(document) {
  for (const el of Array.from(document.querySelectorAll('[data-tex], [data-latex], img'))) {
    const latex = getLatex(el);
    if (!latex) continue;
    const marker = el.closest('span, img') || el;
    marker.replaceWith(document.createTextNode(`$${latex}$`));
  }
}

function inferExt(url, contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
  };
  if (byMime[mime]) return byMime[mime];
  try {
    const match = new URL(url).pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch {
    // ignore invalid URLs
  }
  return '.jpg';
}

async function downloadImages(document, imagesDir, headers, imageSrcPrefix = 'images/') {
  await mkdir(imagesDir, { recursive: true });
  const imgs = Array.from(document.querySelectorAll('img'));
  let index = 0;
  let ok = 0;

  for (const img of imgs) {
    const url = getImageUrl(img);
    if (!url) continue;
    index++;
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = inferExt(url, response.headers.get('content-type'));
      const filename = `${String(index).padStart(3, '0')}${ext}`;
      await writeFile(path.join(imagesDir, filename), buffer);
      img.setAttribute('src', `${imageSrcPrefix}${filename}`);
      img.removeAttribute('srcset');
      ok++;
    } catch (err) {
      console.warn(`  图片下载失败: ${url} (${err.message})`);
    }
  }

  return { total: index, ok };
}

function addMarkdownRules(turndownService) {
  turndownService.addRule('preWithLang', {
    filter: (node) => node.nodeName === 'PRE' && node.getAttribute('lang') !== null,
    replacement: (_content, node) => {
      const lang = node.getAttribute('lang') || '';
      const code = node.textContent || '';
      return `\n\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
    },
  });

  turndownService.addRule('tableToMarkdown', {
    filter: ['table'],
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const cellsOf = (row) => Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent.trim());
      const headers = cellsOf(rows[0]);
      const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '-----').join(' | ')} |`,
      ];
      for (const row of rows.slice(1)) {
        lines.push(`| ${cellsOf(row).join(' | ')} |`);
      }
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });

  turndownService.addRule('figureToImage', {
    filter: ['figure'],
    replacement: (_content, node) => {
      const img = node.querySelector('img');
      if (!img) return '';
      const src = img.getAttribute('src') || '';
      const alt = node.querySelector('figcaption')?.textContent?.trim() || img.getAttribute('alt') || '';
      return src ? `\n\n![${alt}](${src})\n\n` : '';
    },
  });
}

async function htmlToMarkdown(html, JSDOM, TurndownService, sourceUrl, opts) {
  const dom = new JSDOM(`<main>${html || ''}</main>`, { url: sourceUrl });
  const document = dom.window.document;
  replaceMathImages(document);

  let imageStats = { total: 0, ok: 0 };
  if (opts.downloadImages) {
    imageStats = await downloadImages(document, opts.imagesDir, opts.headers, opts.imageSrcPrefix);
  }

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });
  addMarkdownRules(turndownService);

  return {
    markdown: turndownService.turndown(document.querySelector('main').innerHTML),
    imageStats,
  };
}

async function fetchHtml(url, headers) {
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`请求失败: HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    headers: {
      ...headers,
      accept: 'application/json, text/plain, */*',
      referer: 'https://www.zhihu.com/',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    const hint = response.status === 403 || response.status === 401
      ? '，可能需要传入登录 Cookie，例如 --cookie-file ./cookie.txt'
      : '';
    throw new Error(`API 请求失败: HTTP ${response.status}${hint}`);
  }
  return await response.json();
}

async function fetchFullContentFromPage(item, deps, opts) {
  if (!item.url || !['article', 'answer', 'question', 'pin'].includes(item.type)) return null;
  try {
    const html = await fetchHtml(item.url, opts.headers);
    const dom = new deps.JSDOM(html, { url: item.url });
    const document = dom.window.document;
    const pageInfo = detectPage(item.url);
    if (!pageInfo) return null;
    const initialData = extractInitialData(document);
    const content = chooseContent(
      initialData ? extractFromInitialData(initialData, pageInfo, item.url) : null,
      extractFromDOM(document, pageInfo, item.url),
    );
    return content?.html ? content : null;
  } catch (err) {
    console.warn(`  完整正文补全失败: ${item.title || item.id} (${err.message})`);
    return null;
  }
}

async function exportContent(content, deps, opts) {
  const num = opts.num || 1;
  const baseName = sanitizeFilename(opts.baseName || buildItemName(content, num));
  const imageDirName = sanitizeFilename(baseName);
  const imagesDir = path.join(opts.outDir, 'images', imageDirName);
  const imageSrcPrefix = `images/${imageDirName}/`;
  const { markdown, imageStats } = await htmlToMarkdown(content.html, deps.JSDOM, deps.TurndownService, content.url, {
    ...opts,
    imagesDir,
    imageSrcPrefix,
  });
  const outputPath = path.join(opts.outDir, `${baseName}.md`);
  await mkdir(opts.outDir, { recursive: true });
  await writeFile(outputPath, `${buildFrontmatter(content)}${markdown}\n`, 'utf8');

  return { outputPath, imageStats, title: content.title, filename: `${baseName}.md` };
}

async function exportSinglePage(url, deps, opts) {
  const pageInfo = detectPage(url);
  if (!pageInfo || pageInfo.type === 'collection') {
    throw new Error('不是单篇内容 URL');
  }

  const html = await fetchHtml(url, opts.headers);
  const dom = new deps.JSDOM(html, { url });
  const document = dom.window.document;
  const initialData = extractInitialData(document);
  const content = chooseContent(
    initialData ? extractFromInitialData(initialData, pageInfo, url) : null,
    extractFromDOM(document, pageInfo, url),
  );

  if (!content?.html) {
    throw new Error('未能提取正文，可能需要登录 Cookie，或知乎页面结构已变化');
  }

  return await exportContent(content, deps, {
    ...opts,
    baseName: `${content.title}-${content.author}的${content.type}`,
  });
}

function buildTocMarkdown(collectionName, entries) {
  const lines = [
    `# ${collectionName}`,
    '',
    `> 共 ${entries.length} 篇，导出于 ${new Date().toISOString().split('T')[0]}`,
    '',
  ];
  for (const entry of entries) {
    const encoded = encodeURIComponent(entry.filename).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const title = entry.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    lines.push(`${entry.num}. [${title}](./articles/${encoded}) - ${entry.author}（${entry.type}）`);
  }
  lines.push('');
  return lines.join('\n');
}

async function fetchCollectionPage(apiUrl, opts) {
  const data = await fetchJson(apiUrl, opts.headers);
  const paging = data.paging || {};
  return {
    items: (data.data || []).map(parseContentItem),
    nextUrl: paging.is_end ? null : fixHttpUrl(paging.next),
    totals: paging.totals || 0,
  };
}

async function exportCollection(url, deps, opts) {
  const pageInfo = detectPage(url);
  if (!pageInfo || pageInfo.type !== 'collection') {
    throw new Error('不是收藏夹 URL');
  }

  const collectionHtml = await fetchHtml(url, opts.headers);
  const dom = new deps.JSDOM(collectionHtml, { url });
  const collectionName = getCollectionTitle(dom.window.document, pageInfo.id);
  const collectionDir = path.join(opts.outDir, sanitizeFilename(collectionName));
  const articlesDir = path.join(collectionDir, 'articles');
  await mkdir(articlesDir, { recursive: true });

  console.log(`  收藏夹: ${collectionName} (#${pageInfo.id})`);
  let nextUrl = `https://www.zhihu.com/api/v4/collections/${pageInfo.id}/items?offset=0&limit=20`;
  let pageNum = 0;
  let exported = 0;
  let failed = 0;
  const usedNames = new Set();
  const tocEntries = [];

  while (nextUrl) {
    pageNum++;
    console.log(`  读取目录第 ${pageNum} 页...`);
    const page = await fetchCollectionPage(nextUrl, opts);
    console.log(`  第 ${pageNum} 页 ${page.items.length} 条${page.totals ? `，总数约 ${page.totals}` : ''}`);

    for (const item of page.items) {
      if (!item.id || !['article', 'answer', 'question', 'pin'].includes(item.type)) {
        console.warn(`  跳过不支持条目: ${item.title || item.id || 'unknown'} (${item.type})`);
        continue;
      }

      try {
        let content = item;
        if ((!content.html || content.isTruncated) && content.url) {
          const full = await fetchFullContentFromPage(content, deps, opts);
          if (full && (full.html || '').length > (content.html || '').length) {
            content = {
              ...content,
              ...full,
              collectedTime: item.collectedTime,
              createdTime: full.createdTime || item.createdTime,
              updatedTime: full.updatedTime || item.updatedTime,
            };
          }
        }

        if (!content.html) {
          throw new Error('正文为空');
        }

        const num = exported + 1;
        let baseName = sanitizeFilename(buildItemName(content, num));
        if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
        usedNames.add(baseName);

        const result = await exportContent(content, deps, {
          ...opts,
          outDir: articlesDir,
          num,
          baseName,
        });
        exported++;
        tocEntries.push({
          num: exported,
          title: content.title || baseName,
          author: content.author || '知乎用户',
          type: content.type,
          filename: result.filename,
        });

        const imageNote = opts.downloadImages
          ? `，图片 ${result.imageStats.ok}/${result.imageStats.total}`
          : '';
        console.log(`    [${exported}] ${result.filename}${imageNote}`);
      } catch (err) {
        failed++;
        console.error(`    失败: ${item.title || item.id} (${err.message})`);
      }
    }

    nextUrl = page.nextUrl;
  }

  await writeFile(path.join(collectionDir, 'README.md'), buildTocMarkdown(collectionName, tocEntries), 'utf8');
  return { outputPath: collectionDir, exported, failed };
}

async function exportOne(url, deps, opts) {
  const pageInfo = detectPage(url);
  if (pageInfo?.type === 'collection') {
    const result = await exportCollection(url, deps, opts);
    return {
      outputPath: result.outputPath,
      imageStats: { ok: 0, total: 0 },
      isCollection: true,
      title: `收藏夹导出 ${result.exported} 篇${result.failed ? `，失败 ${result.failed} 篇` : ''}`,
    };
  }
  return await exportSinglePage(url, deps, opts);
}

async function loadUrls(opts) {
  const urls = [...opts.urls];
  if (opts.inputFile) {
    const text = await readFile(opts.inputFile, 'utf8');
    urls.push(
      ...text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    );
  }
  return Array.from(new Set(urls));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.cookieFile) {
    opts.cookie = (await readFile(opts.cookieFile, 'utf8')).trim();
  }

  const urls = await loadUrls(opts);
  if (urls.length === 0) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const headers = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  opts.headers = headers;
  opts.outDir = path.resolve(opts.outDir);

  let JSDOM;
  let TurndownService;
  try {
    [{ JSDOM }, { default: TurndownService }] = await Promise.all([
      import('jsdom'),
      import('turndown'),
    ]);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('缺少本地依赖，请先运行 npm ci 后再执行本地导出');
    }
    throw err;
  }
  const deps = { JSDOM, TurndownService };

  let failed = 0;
  for (const url of urls) {
    try {
      console.log(`导出: ${url}`);
      const result = await exportOne(url, deps, opts);
      const imageNote = opts.downloadImages && !result.isCollection
        ? `，图片 ${result.imageStats.ok}/${result.imageStats.total}`
        : '';
      const titleNote = result.isCollection ? `（${result.title}）` : '';
      console.log(`  完成: ${result.outputPath}${imageNote}${titleNote}`);
    } catch (err) {
      failed++;
      console.error(`  失败: ${err.message}`);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
