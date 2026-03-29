import React, { useState, useMemo, useCallback } from 'react';
import { Card, Typography, Button, Progress, Tag, Table } from 'antd';
import type { TableColumnsType } from 'antd';
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

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [commentProgress, setCommentProgress] = useState<{
    current: number;
    total: number;
    text: string;
  } | null>(null);

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

  const columns: TableColumnsType<ContentItem> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (_, record) => {
        const typeLabel = TYPE_LABELS[record.type] || record.type;
        return record.title || `${record.author}的${typeLabel}`;
      },
    },
    {
      title: '作者',
      dataIndex: 'author',
      width: 100,
      ellipsis: true,
      render: (v) => v || '知乎用户',
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 60,
      render: (v) => TYPE_LABELS[v] || v,
    },
    {
      title: '收藏时间',
      dataIndex: 'created_time',
      width: 100,
      render: (v) => formatTimestamp(v),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      align: 'center',
      render: (_, record) =>
        commentedSet.has(record.id) ? (
          <Tag color="green">已导出</Tag>
        ) : (
          <Tag>未导出</Tag>
        ),
    },
  ];

  const handleExportComments = useCallback(async () => {
    if (isExportingComments || !dirHandle || !progressData) return;

    const selected = availableItems.filter((item) => selectedRowKeys.includes(item.id));
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

            const typeLabel = TYPE_LABELS[item.type] || item.type;
            const baseName = sanitizeFilename(buildItemName(item, typeLabel, 0));

            if (format === 'docx') {
              const commentBlob = await commentsToDocx(comments, displayTitle);
              const commentFilename = `${baseName}-评论.docx`;
              await writeBlobFile(articlesFolder, commentFilename, commentBlob);
              const totalComments = comments.reduce(
                (sum, c) => sum + 1 + (c.child_comments || []).length, 0,
              );
              addLog(`已导出 ${totalComments} 条评论: ${commentFilename}`, 'success');
            } else {
              const commentMd = buildCommentsMarkdown(comments, displayTitle, commentImageMapping);
              const commentFilename = `${baseName}-评论.md`;
              await writeTextFile(articlesFolder, commentFilename, commentMd);
              const totalComments = comments.reduce(
                (sum, c) => sum + 1 + (c.child_comments || []).length, 0,
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
    selectedRowKeys,
    collectionName,
    collectionId,
    format,
    addLog,
    setIsExportingComments,
    markCommentExported,
  ]);

  if (totalArticles === 0) {
    return (
      <Card title={<><span className="title-decoration">三</span>评论导出</>} style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">请先导出文章</Typography.Text>
      </Card>
    );
  }

  const progressPercent =
    commentProgress && commentProgress.total > 0
      ? Math.round((commentProgress.current / commentProgress.total) * 100)
      : 0;

  return (
    <Card title={<><span className="title-decoration">三</span>评论导出</>} style={{ marginTop: 16 }}>
      <Typography.Text>
        已导出 {exportedComments} / {totalArticles} 篇文章的评论
      </Typography.Text>

      <Table<ContentItem>
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          getCheckboxProps: () => ({ disabled: isExportingComments }),
        }}
        columns={columns}
        dataSource={availableItems}
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ y: 320 }}
        style={{ marginTop: 12, marginBottom: 12 }}
      />

      {commentProgress && (
        <div style={{ marginBottom: 12 }}>
          <Progress percent={progressPercent} size="small" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {commentProgress.text}
          </Typography.Text>
        </div>
      )}

      <Button
        type="primary"
        block
        onClick={handleExportComments}
        loading={isExportingComments}
        disabled={selectedRowKeys.length === 0 && !isExportingComments}
      >
        {isExportingComments
          ? '导出中...'
          : selectedRowKeys.length > 0
            ? `导出选中的 ${selectedRowKeys.length} 篇评论`
            : '请选择要导出评论的文章'}
      </Button>
    </Card>
  );
}
