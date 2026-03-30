/**
 * 进度文件读写管理
 * 使用 File System Access API 操作 export-progress-{collectionId}.json
 */

import type { ExportProgress } from '@/types/zhihu';

function getFilename(collectionId: string): string {
  return `export-progress-${collectionId}.json`;
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
    const data: ExportProgress = JSON.parse(text);
    if (!data.articles.exportedIds) {
      data.articles.exportedIds = [];
    }
    return data;
  } catch { /* 新格式不存在 */ }

  // 兼容旧格式：读 export-progress.json，验证 collectionId 匹配
  try {
    const fileHandle = await dirHandle.getFileHandle('export-progress.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data: ExportProgress = JSON.parse(text);
    if (data.collectionId === collectionId) {
      if (!data.articles.exportedIds) {
        data.articles.exportedIds = [];
      }
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
  await writable.write(JSON.stringify(progressData, null, 2));
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
      exportedIds: [],
      totalExported: 0,
      batchSize: 50,
    },
    comments: {
      exportedArticles: [],
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
  if (!progress.articles.exportedIds.includes(articleId)) {
    progress.articles.exportedIds.push(articleId);
    progress.articles.totalExported = progress.articles.exportedIds.length;
  }
  await writeProgress(dirHandle, collectionId, progress);
}

export async function updateCommentProgress(
  dirHandle: FileSystemDirectoryHandle,
  collectionId: string,
  progress: ExportProgress,
  articleId: string,
): Promise<void> {
  if (!progress.comments.exportedArticles.includes(articleId)) {
    progress.comments.exportedArticles.push(articleId);
    progress.comments.totalExported = progress.comments.exportedArticles.length;
  }
  await writeProgress(dirHandle, collectionId, progress);
}
