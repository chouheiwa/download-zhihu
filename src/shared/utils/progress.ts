/**
 * 进度文件读写管理
 * 使用 File System Access API 操作 export-progress-{collectionId}.json
 */

import type { ExportProgress } from '@/types/zhihu';

function getFilename(collectionId: string): string {
  return `export-progress-${collectionId}.json`;
}

/**
 * 磁盘上存的是数组，读入后统一转 Set 供运行时高效查重（_collection 属性保证类型正确）
 */
function normalizeProgress(data: ExportProgress): ExportProgress {
  if (!(data.articles.exportedIds instanceof Set)) {
    data.articles.exportedIds = new Set(data.articles.exportedIds ?? []);
  }
  if (!(data.comments.exportedArticles instanceof Set)) {
    data.comments.exportedArticles = new Set(data.comments.exportedArticles ?? []);
  }
  return data;
}

export async function readProgress(
  dirHandle: FileSystemDirectoryHandle,
  collectionId: string,
): Promise<ExportProgress | null> {
  // 优先读新格式（带 ID 的文件名）
  try {
    const fileHandle = await dirHandle.getFileHandle(getFilename(collectionId));
    const file = await fileHandle.getFile();
    const text = await file.text();
    return normalizeProgress(JSON.parse(text) as ExportProgress);
  } catch { /* 新格式不存在 */ }

  // 兼容旧格式：读 export-progress.json，验证 collectionId 匹配
  try {
    const fileHandle = await dirHandle.getFileHandle('export-progress.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = normalizeProgress(JSON.parse(text) as ExportProgress);
    if (data.collectionId === collectionId) {
      // 迁移：写入新格式文件
      await writeProgress(dirHandle, collectionId, data);
      return data;
    }
  } catch { /* 旧格式也不存在 */ }

  return null;
}

export async function writeProgress(
  dirHandle: FileSystemDirectoryHandle,
  collectionId: string,
  progressData: ExportProgress,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(getFilename(collectionId), { create: true });
  const writable = await fileHandle.createWritable();
  // Set 无法直接 JSON.stringify，序列化前转回数组以保持磁盘格式
  await writable.write(JSON.stringify(progressData, (_key, value) => {
    return value instanceof Set ? Array.from(value) : value;
  }, 2));
  await writable.close();
}

export function createInitialProgress(
  collectionId: string,
  collectionName: string,
): ExportProgress {
  return {
    collectionId,
    collectionName,
    articles: {
      exportedIds: new Set<string>(),
      totalExported: 0,
      batchSize: 50,
    },
    comments: {
      exportedArticles: new Set<string>(),
      totalExported: 0,
    },
  };
}

export async function addExportedArticle(
  dirHandle: FileSystemDirectoryHandle,
  collectionId: string,
  progress: ExportProgress,
  articleId: string,
): Promise<void> {
  if (!progress.articles.exportedIds.has(articleId)) {
    progress.articles.exportedIds.add(articleId);
    progress.articles.totalExported = progress.articles.exportedIds.size;
  }
  await writeProgress(dirHandle, collectionId, progress);
}

export async function updateCommentProgress(
  dirHandle: FileSystemDirectoryHandle,
  collectionId: string,
  progress: ExportProgress,
  articleId: string,
): Promise<void> {
  if (!progress.comments.exportedArticles.has(articleId)) {
    progress.comments.exportedArticles.add(articleId);
    progress.comments.totalExported = progress.comments.exportedArticles.size;
  }
  await writeProgress(dirHandle, collectionId, progress);
}
