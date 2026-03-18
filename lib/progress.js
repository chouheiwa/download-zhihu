/**
 * 进度文件读写管理
 * 使用 File System Access API 操作 export-progress-{collectionId}.json
 * 挂载到 window.__progress
 */

(() => {
  'use strict';

  function getFilename(collectionId) {
    return `export-progress-${collectionId}.json`;
  }

  async function readProgress(dirHandle, collectionId) {
    // 优先读新格式（带 ID 的文件名）
    try {
      const fileHandle = await dirHandle.getFileHandle(getFilename(collectionId));
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
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
      const data = JSON.parse(text);
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

  async function writeProgress(dirHandle, collectionId, progressData) {
    const fileHandle = await dirHandle.getFileHandle(getFilename(collectionId), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(progressData, null, 2));
    await writable.close();
  }

  function createInitialProgress(collectionId, collectionName) {
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

  async function addExportedArticle(dirHandle, collectionId, progress, articleId) {
    if (!progress.articles.exportedIds.includes(articleId)) {
      progress.articles.exportedIds.push(articleId);
      progress.articles.totalExported = progress.articles.exportedIds.length;
    }
    await writeProgress(dirHandle, collectionId, progress);
  }

  async function updateCommentProgress(dirHandle, collectionId, progress, articleId) {
    if (!progress.comments.exportedArticles.includes(articleId)) {
      progress.comments.exportedArticles.push(articleId);
      progress.comments.totalExported = progress.comments.exportedArticles.length;
    }
    await writeProgress(dirHandle, collectionId, progress);
  }

  window.__progress = {
    readProgress,
    writeProgress,
    createInitialProgress,
    addExportedArticle,
    updateCommentProgress,
  };
})();
