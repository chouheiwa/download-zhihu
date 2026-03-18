/**
 * 进度文件读写管理
 * 使用 File System Access API 操作 export-progress.json
 * 挂载到 window.__progress
 */

(() => {
  'use strict';

  const PROGRESS_FILENAME = 'export-progress.json';

  async function readProgress(dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(PROGRESS_FILENAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      // 兼容旧版：确保 exportedIds 存在
      if (!data.articles.exportedIds) {
        data.articles.exportedIds = [];
      }
      return data;
    } catch {
      return null;
    }
  }

  async function writeProgress(dirHandle, progressData) {
    const fileHandle = await dirHandle.getFileHandle(PROGRESS_FILENAME, { create: true });
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

  /**
   * 文章导出完一篇后更新进度
   */
  async function addExportedArticle(dirHandle, progress, articleId) {
    if (!progress.articles.exportedIds.includes(articleId)) {
      progress.articles.exportedIds.push(articleId);
      progress.articles.totalExported = progress.articles.exportedIds.length;
    }
    await writeProgress(dirHandle, progress);
  }

  async function updateCommentProgress(dirHandle, progress, articleId) {
    if (!progress.comments.exportedArticles.includes(articleId)) {
      progress.comments.exportedArticles.push(articleId);
      progress.comments.totalExported = progress.comments.exportedArticles.length;
    }
    await writeProgress(dirHandle, progress);
  }

  window.__progress = {
    readProgress,
    writeProgress,
    createInitialProgress,
    addExportedArticle,
    updateCommentProgress,
  };
})();
