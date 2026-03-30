/**
 * 导出相关的共享工具函数
 * 从 content/export-utils.js 迁移为 TypeScript ES module
 */

import type { ExtractedContent, ContentItem, ImageDownloadResult, ZhihuComment } from '@/types/zhihu';

export const TYPE_LABELS: Record<string, string> = {
  article: '文章',
  answer: '回答',
  question: '问题',
  pin: '想法',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * 从图片 URL 推断文件扩展名
 */
function inferImageExtension(url: string, contentType: string): string {
  const mimeToExt: Record<string, string> = {
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
 * 从评论 HTML 中提取图片 URL
 */
function extractCommentImageUrls(html: string): string[] {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const urls: string[] = [];
  div.querySelectorAll('a.comment_img').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href && /^https?:\/\//i.test(href)) {
      urls.push(href);
    }
  });
  return urls;
}

function _formatTimestamp(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Exported functions ────────────────────────────────────────────────────────

export function buildFrontmatter(data: ExtractedContent | ContentItem): string {
  const authorValue = typeof (data as ExtractedContent).author === 'string'
    ? (data as ExtractedContent).author
    : ((data as ExtractedContent).author as unknown as { name: string })?.name || '';

  const lines = [
    '---',
    `id: "${data.id || ''}"`,
    `title: "${(data.title || '').replace(/"/g, '\\"')}"`,
    `author: "${authorValue.replace(/"/g, '\\"')}"`,
    `type: zhihu-${data.type}`,
    `source: "${data.url}"`,
  ];

  const d = data as ExtractedContent & ContentItem;
  const created = _formatTimestamp(
    (d as ExtractedContent).createdTime ??
    (d as ContentItem).created_time ??
    undefined
  );
  const updated = _formatTimestamp(
    (d as ExtractedContent).updatedTime ??
    (d as ContentItem).updated_time ??
    undefined
  );

  if (created) lines.push(`created: "${created}"`);
  if (updated) lines.push(`updated: "${updated}"`);
  const collected = _formatTimestamp((d as ContentItem).collected_time ?? undefined);
  if (collected) lines.push(`collected: "${collected}"`);
  lines.push(`downloaded: "${new Date().toISOString().split('T')[0]}"`);
  lines.push('---', '');
  return lines.join('\n');
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/<[^>]*>/g, '')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/:*?"<>|#^\[\]()（）]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function triggerDownload(blob: Blob, filename: string): void {
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

export async function downloadImage(url: string): Promise<{ buffer: ArrayBuffer; ext: string } | null> {
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

export async function batchDownloadImages(
  urls: string[],
  prefix: string,
  onProgress?: (done: number, total: number) => void,
  imagePathPrefix = 'images/'
): Promise<ImageDownloadResult> {
  const imageMapping: Record<string, string> = {};
  const imageFiles: Array<{ path: string; buffer: ArrayBuffer }> = [];
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

export async function batchDownloadImagesToFolder(
  urls: string[],
  prefix: string,
  imagesFolderHandle: FileSystemDirectoryHandle
): Promise<{ imageMapping: Record<string, string> }> {
  const imageMapping: Record<string, string> = {};
  const concurrency = 5;
  let index = 0;

  async function worker() {
    while (index < urls.length) {
      const i = index++;
      const url = urls[i];
      const result = await downloadImage(url);
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

export async function writeTextFile(
  folderHandle: FileSystemDirectoryHandle,
  filename: string,
  text: string
): Promise<void> {
  const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * 将 Blob 写入文件夹（用于 docx 等二进制文件）
 */
export async function writeBlobFile(
  folderHandle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<void> {
  const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * 将 batchDownloadImages 的结果转换为 html-to-docx 需要的 imageData Map
 */
export function buildImageDataMap(
  imageMapping: Record<string, string>,
  imageFiles: Array<{ path: string; buffer: ArrayBuffer }>
): Map<string, { buffer: ArrayBuffer; ext: string }> {
  const map = new Map<string, { buffer: ArrayBuffer; ext: string }>();
  const pathToBuffer = new Map<string, ArrayBuffer>();
  for (const file of imageFiles) {
    pathToBuffer.set(file.path, file.buffer);
  }
  for (const [url, path] of Object.entries(imageMapping)) {
    const basename = path.split('/').pop()!;
    const buffer = pathToBuffer.get(basename) || pathToBuffer.get(path);
    if (buffer) {
      map.set(url, { buffer, ext: path.split('.').pop() || 'jpg' });
    }
  }
  return map;
}

export function collectCommentImageEntries(
  comments: ZhihuComment[]
): Array<{ commentIdx: number; urls: string[] }> {
  const entries: Array<{ commentIdx: number; urls: string[] }> = [];
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

export async function downloadCommentImages(
  entries: Array<{ commentIdx: number; urls: string[] }>,
  prefix: string
): Promise<ImageDownloadResult> {
  const imageMapping: Record<string, string> = {};
  const imageFiles: Array<{ path: string; buffer: ArrayBuffer }> = [];
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

export function buildTocMarkdown(
  collectionName: string,
  entries: Array<{ num: number; title: string; author: string; type: string; filename: string; url: string }>
): string {
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
