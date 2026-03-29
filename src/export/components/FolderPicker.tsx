import React from 'react';
import { Button, Card } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import * as progress from '@/shared/utils/progress';
import * as exportUtils from '@/shared/utils/export-utils';
import { detectPage } from '@/shared/api/zhihu-api';
import type { ContentItem } from '@/types/zhihu';

interface Props {
  collectionId: string;
  collectionName: string;
}

export function FolderPicker({ collectionId, collectionName }: Props) {
  const dirHandle = useExportStore((s) => s.dirHandle);
  const setDirHandle = useExportStore((s) => s.setDirHandle);
  const setProgressData = useExportStore((s) => s.setProgressData);
  const setItems = useExportStore((s) => s.setItems);
  const addLog = useUIStore((s) => s.addLog);

  const handleSelectFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      addLog(`已选择文件夹：${handle.name}`, 'info');

      let progressData = await progress.readProgress(handle, collectionId);
      if (!progressData) {
        progressData = progress.createInitialProgress(collectionId, collectionName);
        addLog('未找到进度文件，将从头开始导出', 'info');
      }

      // Reconcile progress by scanning actual files
      await reconcileProgress(handle, progressData, collectionName, collectionId, addLog, setItems);

      setProgressData(progressData);
      addLog(`已导出 ${progressData.articles.totalExported} 篇文章、${progressData.comments.totalExported} 篇评论`, 'info');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        addLog(`选择文件夹失败: ${err.message}`, 'error');
      }
    }
  };

  return (
    <Card title="选择目录" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div className="folder-display">
          {dirHandle ? dirHandle.name : '未选择文件夹'}
        </div>
        <Button icon={<FolderOpenOutlined />} onClick={handleSelectFolder}>
          {dirHandle ? '更换文件夹' : '选择文件夹'}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Scan actual files to calibrate progress counters
 * Ported from export.js reconcileProgress (lines 229-324)
 */
async function reconcileProgress(
  dirHandle: FileSystemDirectoryHandle,
  progressData: any,
  collectionName: string,
  collectionId: string,
  addLog: (msg: string, level: 'info' | 'warn' | 'error' | 'success') => void,
  setItems: (items: ContentItem[]) => void,
) {
  try {
    const folderName = exportUtils.sanitizeFilename(collectionName);
    const collectionFolder = await dirHandle.getDirectoryHandle(folderName);
    const articlesFolder = await collectionFolder.getDirectoryHandle('articles');

    const foundIds = new Set<string>();
    const commentedFiles = new Set<string>();
    const fileItems: ContentItem[] = [];

    for await (const [name, handle] of (articlesFolder as any).entries()) {
      if (handle.kind !== 'file') continue;
      if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
      if (name === 'README.md' || name === 'README.docx') continue;

      if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) {
        commentedFiles.add(name.replace(/-评论\.(md|docx)$/, '.$1'));
        continue;
      }

      if (name.endsWith('.docx')) continue;

      try {
        const file = await handle.getFile();
        const head = await file.slice(0, 500).text();
        const idMatch = head.match(/^id:\s*"([^"]+)"/m);
        let articleId: string | null = null;
        if (idMatch && idMatch[1]) {
          articleId = idMatch[1];
        } else {
          const sourceMatch = head.match(/^source:\s*"([^"]+)"/m);
          if (sourceMatch) {
            const pageInfo = detectPage(sourceMatch[1]);
            if (pageInfo?.id) articleId = pageInfo.id;
          }
        }
        if (articleId) {
          foundIds.add(articleId);
          const titleMatch = head.match(/^title:\s*"(.+)"/m);
          const authorMatch = head.match(/^author:\s*"(.+)"/m);
          const typeMatch = head.match(/^type:\s*zhihu-(\S+)/m);
          const sourceMatch = head.match(/^source:\s*"([^"]+)"/m);
          fileItems.push({
            id: articleId,
            title: titleMatch ? titleMatch[1].replace(/\\"/g, '"') : '',
            author: authorMatch ? authorMatch[1].replace(/\\"/g, '"') : '',
            type: (typeMatch ? typeMatch[1] : 'article') as any,
            url: sourceMatch ? sourceMatch[1] : '',
            html: '',
            isTruncated: false,
            isPaidContent: false,
            commentCount: 0,
            created_time: 0,
            updated_time: 0,
          });
        }
      } catch { /* skip */ }
    }

    if (fileItems.length > 0) {
      setItems(fileItems);
    }

    const oldIds = new Set(progressData.articles.exportedIds || []);
    let changed = false;

    if (foundIds.size !== oldIds.size || ![...foundIds].every((id: string) => oldIds.has(id))) {
      addLog(`文章 ID 校准：${oldIds.size} → ${foundIds.size}（以实际文件为准）`, 'warn');
      progressData.articles.exportedIds = Array.from(foundIds);
      progressData.articles.totalExported = foundIds.size;
      changed = true;
    }

    const oldCommentCount = progressData.comments.totalExported;
    const actualCommentCount = commentedFiles.size;
    if (oldCommentCount !== actualCommentCount) {
      addLog(`评论计数校准：${oldCommentCount} → ${actualCommentCount}（以实际文件为准）`, 'warn');
      progressData.comments.exportedArticles = Array.from(commentedFiles);
      progressData.comments.totalExported = actualCommentCount;
      changed = true;
    }

    if (changed) {
      await progress.writeProgress(dirHandle, collectionId, progressData);
    }
  } catch {
    // Folder doesn't exist = no export yet, no reconciliation needed
  }
}
