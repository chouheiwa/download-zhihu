import React, { useState, useMemo, useCallback } from 'react';
import { Card, Checkbox, Typography, Button, Progress, Tag } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import { fetchAllComments } from '@/shared/api/zhihu-api';
import {
  sanitizeFilename,
  TYPE_LABELS,
  writeTextFile,
  writeBlobFile,
  collectCommentImageEntries,
  downloadCommentImages,
} from '@/shared/utils/export-utils';
import { buildCommentsMarkdown } from '@/shared/converters/html-to-markdown';
import { commentsToDocx } from '@/shared/converters/html-to-docx';
import { updateCommentProgress } from '@/shared/utils/progress';
import type { ContentItem } from '@/types/zhihu';

interface Props {
  collectionId: string;
  collectionName: string;
}

function buildItemName(item: ContentItem, typeLabel: string, num: number): string {
  switch (item.type) {
    case 'article':
      return item.title || `${item.author}的文章_${num}`;
    case 'answer':
      return item.title
        ? `${item.title}-${item.author}的回答`
        : `${item.author}的回答_${num}`;
    case 'pin':
      return item.title
        ? `${item.title}-${item.author}的想法`
        : `${item.author}的想法_${num}`;
    default:
      return item.title
        ? `${item.title}-${item.author}的${typeLabel}`
        : `${item.author}的${typeLabel}_${num}`;
  }
}

export function CommentExport({ collectionId, collectionName }: Props) {
  const dirHandle = useExportStore((s) => s.dirHandle);
  const format = useExportStore((s) => s.format);
  const progressData = useExportStore((s) => s.progressData);
  const items = useExportStore((s) => s.items);
  const isExportingComments = useExportStore((s) => s.isExportingComments);
  const setIsExportingComments = useExportStore((s) => s.setIsExportingComments);
  const markCommentExported = useExportStore((s) => s.markCommentExported);
  const addLog = useUIStore((s) => s.addLog);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [commentProgress, setCommentProgress] = useState<{
    current: number;
    total: number;
    text: string;
  } | null>(null);

  // Filter items to only show exported articles
  const availableItems = useMemo(() => {
    if (!progressData) return [];
    const exportedIds = new Set(progressData.articles.exportedIds || []);
    return items.filter((item) => item.id && exportedIds.has(item.id));
  }, [items, progressData]);

  const commentedSet = useMemo(() => {
    if (!progressData) return new Set<string>();
    return new Set(progressData.comments.exportedArticles || []);
  }, [progressData]);

  const totalArticles = progressData?.articles.totalExported ?? 0;
  const exportedComments = progressData?.comments.totalExported ?? 0;

  // Selection helpers
  const allSelected = availableItems.length > 0 && availableItems.every((item) => selectedIds.has(item.id));
  const someSelected = !allSelected && availableItems.some((item) => selectedIds.has(item.id));

  const selectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableItems.map((item) => item.id)));
    }
  }, [allSelected, availableItems]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Button text
  const buttonText = useMemo(() => {
    if (isExportingComments) return '导出中...';
    if (selectedIds.size > 0) return `导出选中的 ${selectedIds.size} 篇评论`;
    return '请选择要导出评论的文章';
  }, [isExportingComments, selectedIds.size]);

  // Export handler
  const handleExportComments = useCallback(async () => {
    if (isExportingComments || !dirHandle || !progressData) return;

    const selected = availableItems.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) {
      addLog('未选择任何文章', 'warn');
      return;
    }

    setIsExportingComments(true);

    try {
      const collectionFolder = await dirHandle.getDirectoryHandle(
        sanitizeFilename(collectionName),
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles');
      let imagesFolder: FileSystemDirectoryHandle | null = null;
      try {
        imagesFolder = await articlesFolder.getDirectoryHandle('images');
      } catch {
        /* no images folder is fine */
      }

      addLog(`开始导出 ${selected.length} 篇文章的评论`, 'info');

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        const displayTitle = item.title || `${item.author}的${TYPE_LABELS[item.type] || item.type}`;

        setCommentProgress({
          current: i + 1,
          total: selected.length,
          text: `正在处理 ${i + 1}/${selected.length}: ${displayTitle.slice(0, 20)}...`,
        });

        try {
          addLog(`加载评论: ${displayTitle}（${item.type} #${item.id}）`, 'info');
          const comments = await fetchAllComments(item.type, item.id, (done, total) => {
            setCommentProgress({
              current: i + 1,
              total: selected.length,
              text: `${displayTitle.slice(0, 15)}... 子评论 ${done}/${total}`,
            });
          });

          if (comments.length > 0) {
            // Comment image processing
            let commentImageMapping: Record<string, string> = {};
            if (imagesFolder) {
              const imgEntries = collectCommentImageEntries(comments);
              if (imgEntries.length > 0) {
                const prefix = `comment_${item.id}_`;
                const imgResult = await downloadCommentImages(imgEntries, prefix);
                commentImageMapping = imgResult.imageMapping;
                for (const f of imgResult.imageFiles) {
                  const fh = await imagesFolder.getFileHandle(f.path, { create: true });
                  const w = await fh.createWritable();
                  await w.write(f.buffer);
                  await w.close();
                }
              }
            }

            // Generate comment filename matching article name
            const typeLabel = TYPE_LABELS[item.type] || item.type;
            const baseName = sanitizeFilename(buildItemName(item, typeLabel, 0));

            if (format === 'docx') {
              const commentBlob = await commentsToDocx(comments, displayTitle);
              const commentFilename = `${baseName}-评论.docx`;
              await writeBlobFile(articlesFolder, commentFilename, commentBlob);

              const totalComments = comments.reduce(
                (sum, c) => sum + 1 + (c.child_comments || []).length,
                0,
              );
              addLog(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
            } else {
              const commentMd = buildCommentsMarkdown(comments, displayTitle, commentImageMapping);
              const commentFilename = `${baseName}-评论.md`;
              await writeTextFile(articlesFolder, commentFilename, commentMd);

              const totalComments = comments.reduce(
                (sum, c) => sum + 1 + (c.child_comments || []).length,
                0,
              );
              addLog(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
            }
          } else {
            addLog(`${displayTitle}：无评论`, 'info');
          }

          await updateCommentProgress(dirHandle, collectionId, progressData, item.id);
          markCommentExported(item.id);
        } catch (err: unknown) {
          const error = err as { httpStatus?: number; message?: string };
          if (error.httpStatus === 403 || error.message?.includes('403')) {
            addLog(
              `被知乎限流（HTTP 403），可能需要完成验证码。请切换到知乎页面完成验证后重试剩余文章。已处理 ${i + 1}/${selected.length} 篇`,
              'error',
            );
            break;
          }
          addLog(`${displayTitle} 评论导出失败: ${error.message}`, 'error');
        }
      }

      addLog(`评论导出完成，共处理 ${selected.length} 篇`, 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      addLog(`评论导出失败: ${error.message}`, 'error');
    } finally {
      setIsExportingComments(false);
      setCommentProgress(null);
    }
  }, [
    isExportingComments,
    dirHandle,
    progressData,
    availableItems,
    selectedIds,
    collectionName,
    collectionId,
    format,
    addLog,
    setIsExportingComments,
    markCommentExported,
  ]);

  // If no articles exported yet
  if (totalArticles === 0) {
    return (
      <Card title={<><span className="title-decoration">三</span>评论导出</>}>
        <Typography.Text type="secondary">请先导出文章</Typography.Text>
      </Card>
    );
  }

  const progressPercent =
    commentProgress && commentProgress.total > 0
      ? Math.round((commentProgress.current / commentProgress.total) * 100)
      : 0;

  return (
    <Card title={<><span className="title-decoration">三</span>评论导出</>}>
      {/* Status */}
      <Typography.Text>
        已导出 {exportedComments} / {totalArticles} 篇文章的评论
      </Typography.Text>

      {/* Select all */}
      <div style={{ margin: '12px 0 8px' }}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={selectAll}
          disabled={isExportingComments}
        >
          全选
        </Checkbox>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
          已选 {selectedIds.size} 篇
        </Typography.Text>
      </div>

      {/* Article list with checkboxes */}
      <div className="scrollable-list" style={{ marginBottom: 12 }}>
        {availableItems.map((item) => {
          const isCommented = commentedSet.has(item.id);
          const typeLabel = TYPE_LABELS[item.type] || item.type;
          const title = item.title || `${item.author}的${typeLabel}`;
          return (
            <div key={item.id} className="comment-article-item">
              <Checkbox
                checked={selectedIds.has(item.id)}
                onChange={() => toggle(item.id)}
                disabled={isExportingComments}
              />
              <span className="item-title">{title}</span>
              {isCommented && <Tag color="green">已导出</Tag>}
            </div>
          );
        })}
      </div>

      {/* Progress */}
      {commentProgress && (
        <div style={{ marginBottom: 12 }}>
          <Progress percent={progressPercent} size="small" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {commentProgress.text}
          </Typography.Text>
        </div>
      )}

      {/* Export button */}
      <Button
        type="primary"
        block
        onClick={handleExportComments}
        loading={isExportingComments}
        disabled={selectedIds.size === 0 && !isExportingComments}
      >
        {buttonText}
      </Button>
    </Card>
  );
}
