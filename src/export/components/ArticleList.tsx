import React, { useCallback } from 'react';
import { Button, Card, Checkbox, Progress, Typography } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import { fetchCollectionPage, fetchColumnPage, checkPaidAccess, fetchFullContent } from '@/shared/api/zhihu-api';
import {
  sanitizeFilename,
  buildFrontmatter,
  batchDownloadImages,
  batchDownloadImagesToFolder,
  writeTextFile,
  writeBlobFile,
  buildImageDataMap,
  TYPE_LABELS,
  buildTocMarkdown,
} from '@/shared/utils/export-utils';
import { htmlToMarkdown, extractImageUrls } from '@/shared/converters/html-to-markdown';
import { htmlToDocx } from '@/shared/converters/html-to-docx';
import { addExportedArticle } from '@/shared/utils/progress';
import type { ContentItem, PaginatedResult } from '@/types/zhihu';

interface Props {
  collectionId: string;
  collectionName: string;
  collectionApiUrl: string;
  sourceType: 'collection' | 'column';
}

/**
 * Build display filename for an item based on its type.
 * Ported from export.js buildItemName (lines 498-515)
 */
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

export function ArticleList({
  collectionId,
  collectionName,
  collectionApiUrl,
  sourceType,
}: Props) {
  const dirHandle = useExportStore((s) => s.dirHandle);
  const format = useExportStore((s) => s.format);
  const docxImageMode = useExportStore((s) => s.docxImageMode);
  const wantImages = useExportStore((s) => s.wantImages);
  const setWantImages = useExportStore((s) => s.setWantImages);
  const progressData = useExportStore((s) => s.progressData);
  const isExportingArticles = useExportStore((s) => s.isExportingArticles);
  const setIsExportingArticles = useExportStore((s) => s.setIsExportingArticles);
  const exportProgress = useExportStore((s) => s.exportProgress);
  const setExportProgress = useExportStore((s) => s.setExportProgress);
  const setItems = useExportStore((s) => s.setItems);
  const addLog = useUIStore((s) => s.addLog);

  /**
   * Paginated directory fetching.
   * Ported from export.js fetchDirectoryPages (lines 91-131)
   */
  const fetchDirectoryPages = useCallback(
    async (onPage: (items: ContentItem[], pageNum: number) => Promise<void>) => {
      const fetchFn = sourceType === 'column' ? fetchColumnPage : fetchCollectionPage;
      let nextPageUrl: string | null = collectionApiUrl;
      let pageNum = 0;
      let totalFetched = 0;

      while (nextPageUrl) {
        pageNum++;
        addLog(`正在请求第 ${pageNum} 页...`, 'info');

        let result: PaginatedResult;
        try {
          result = await fetchFn(nextPageUrl);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`加载第 ${pageNum} 页目录失败: ${msg}`, 'error');
          addLog(`已加载 ${totalFetched} 篇，后续页面未加载`, 'warn');
          return;
        }

        totalFetched += result.items.length;
        addLog(`第 ${pageNum} 页返回 ${result.items.length} 篇（累计 ${totalFetched} 篇）`, 'info');

        // Log anomalous entries
        for (const item of result.items) {
          if (!item.id) {
            addLog(`警告：发现无 ID 条目，标题="${item.title || '无'}"，类型=${item.type}，将跳过`, 'warn');
          } else if (!item.html && item.type !== 'unknown') {
            addLog(`注意：条目 ${item.id}（${item.title || '无标题'}）内容为空`, 'warn');
          }
        }

        if (result.items.length > 0) {
          await onPage(result.items, pageNum);
        }

        nextPageUrl = result.nextUrl;
        if (!nextPageUrl) {
          addLog(`全部页面加载完成，共 ${pageNum} 页 ${totalFetched} 篇`, 'info');
        }
      }
    },
    [sourceType, collectionApiUrl, addLog],
  );

  /**
   * Scan articles folder and generate/update README.md
   * Ported from export.js updateReadme (lines 700-735)
   */
  const updateReadme = useCallback(
    async (collectionFolder: FileSystemDirectoryHandle) => {
      try {
        const articlesFolder = await collectionFolder.getDirectoryHandle('articles');
        const fileNames: string[] = [];

        for await (const [name, handle] of (articlesFolder as any).entries()) {
          if (handle.kind !== 'file') continue;
          if (!name.endsWith('.md') && !name.endsWith('.docx')) continue;
          if (name.endsWith('-评论.md') || name.endsWith('-评论.docx')) continue;
          fileNames.push(name);
        }

        fileNames.sort();
        const entries = fileNames.map((name, idx) => ({
          num: idx + 1,
          title: name.replace(/\.(md|docx)$/, ''),
          author: '',
          type: 'article',
          filename: name,
          url: '',
        }));

        const tocMd = buildTocMarkdown(collectionName, entries);
        await writeTextFile(collectionFolder, 'README.md', tocMd);
      } catch {
        // README update failure should not affect the main flow
      }
    },
    [collectionName],
  );

  /**
   * Main article export handler.
   * Ported from export.js handleExportArticles (lines 521-698)
   */
  const handleExport = useCallback(async () => {
    const store = useExportStore.getState();
    if (store.isExportingArticles || !store.dirHandle || !store.progressData) return;

    setIsExportingArticles(true);

    const currentFormat = store.format;
    const currentDocxImgMode = store.docxImageMode;
    const currentWantImg = currentFormat === 'md' ? store.wantImages : (currentDocxImgMode === 'embed');
    const currentDirHandle = store.dirHandle;
    const currentProgressData = store.progressData;

    try {
      // Create sub-folders
      const collectionFolder = await currentDirHandle.getDirectoryHandle(
        sanitizeFilename(collectionName),
        { create: true },
      );
      const articlesFolder = await collectionFolder.getDirectoryHandle('articles', { create: true });
      let imagesFolder: FileSystemDirectoryHandle | null = null;
      if (currentWantImg && currentFormat === 'md') {
        imagesFolder = await articlesFolder.getDirectoryHandle('images', { create: true });
      }

      const exportedIds = new Set(currentProgressData.articles.exportedIds || []);
      const usedNames = new Set<string>();
      let exportedInBatch = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const allItems: ContentItem[] = [];

      // Fetch page by page, process each page
      await fetchDirectoryPages(async (pageItems, pageNum) => {
        allItems.push(...pageItems);

        // Filter entries without ID
        const noIdItems = pageItems.filter((item) => !item.id);
        if (noIdItems.length > 0) {
          skippedCount += noIdItems.length;
        }

        // Filter already-exported entries
        const pending = pageItems.filter((item) => item.id && !exportedIds.has(item.id));
        const alreadyExported = pageItems.length - noIdItems.length - pending.length;

        if (pending.length === 0) {
          addLog(`第 ${pageNum} 页：${pageItems.length} 篇全部已导出，跳过`, 'info');
          return;
        }

        addLog(
          `第 ${pageNum} 页：${pageItems.length} 篇（待导出 ${pending.length}，已导出 ${alreadyExported}${noIdItems.length > 0 ? `，无ID跳过 ${noIdItems.length}` : ''}）`,
          'info',
        );

        for (const item of pending) {
          const itemLabel = `${item.title || item.id}（${item.type}, id=${item.id}）`;

          try {
            exportedInBatch++;
            // Read latest totalExported from store each iteration
            const latestProgress = useExportStore.getState().progressData;
            const num = (latestProgress?.articles.totalExported ?? currentProgressData.articles.totalExported) + 1;
            const typeLabel = TYPE_LABELS[item.type] || item.type;
            let baseName = sanitizeFilename(buildItemName(item, typeLabel, num));
            if (usedNames.has(baseName)) baseName = `${baseName}_${num}`;
            usedNames.add(baseName);

            // Check if file already exists on disk
            let filename = currentFormat === 'docx' ? `${baseName}.docx` : `${baseName}.md`;
            try {
              await articlesFolder.getFileHandle(filename);
              filename = currentFormat === 'docx' ? `${baseName}_${num}.docx` : `${baseName}_${num}.md`;
              addLog(`文件名冲突，改用: ${filename}`, 'warn');
            } catch {
              /* File doesn't exist — normal */
            }

            setExportProgress({
              current: 0,
              total: 1,
              text: `第 ${pageNum} 页 - 正在处理: ${(item.title || '').slice(0, 20)}...`,
            });
            addLog(`处理 [${exportedInBatch}]: ${itemLabel} → ${filename}`, 'info');

            // Content truncation detection
            if (item.isTruncated && (item.type === 'article' || item.type === 'answer')) {
              let shouldFetch = true;

              if (item.isPaidContent) {
                addLog('  付费内容，检查购买状态...', 'info');
                const hasPaid = await checkPaidAccess(item.type, item.id);
                if (hasPaid) {
                  addLog('  已购买，请求完整内容...', 'info');
                } else {
                  addLog('  未购买，跳过补全', 'warn');
                  shouldFetch = false;
                }
              } else {
                addLog('  内容被截断，请求完整内容...', 'info');
              }

              if (shouldFetch) {
                try {
                  const fullHtml = await fetchFullContent(item.type, item.url);
                  if (fullHtml && fullHtml.length > (item.html || '').length) {
                    addLog(`  内容补全: ${(item.html || '').length} → ${fullHtml.length}`, 'info');
                    item.html = fullHtml;
                  }
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  addLog(`  补全失败: ${msg}，使用截断内容`, 'warn');
                }
              }
            }

            if (currentFormat === 'docx') {
              // === DOCX mode ===
              let imageData = new Map<string, { buffer: ArrayBuffer; ext: string }>();
              if (currentWantImg && item.html) {
                const imgUrls = extractImageUrls(item.html);
                if (imgUrls.length > 0) {
                  const prefix = `${String(num).padStart(3, '0')}_`;
                  const imgResult = await batchDownloadImages(imgUrls, prefix);
                  imageData = buildImageDataMap(imgResult.imageMapping, imgResult.imageFiles);
                  addLog(`  图片: ${imgUrls.length} 张，嵌入 ${imageData.size} 张`, 'info');
                }
              }

              const docxBlob = await htmlToDocx(item.html || '', {
                images: currentDocxImgMode,
                imageData,
                frontMatter: {
                  id: item.id,
                  title: item.title,
                  author: item.author,
                  url: item.url,
                  createdTime: item.created_time || undefined,
                  updatedTime: item.updated_time || undefined,
                },
              });

              await writeBlobFile(articlesFolder, filename, docxBlob);
            } else {
              // === Markdown mode ===
              let imageMapping: Record<string, string> = {};
              if (currentWantImg && item.html) {
                const imgUrls = extractImageUrls(item.html);
                if (imgUrls.length > 0 && imagesFolder) {
                  const prefix = `${String(num).padStart(3, '0')}_`;
                  const imgResult = await batchDownloadImagesToFolder(imgUrls, prefix, imagesFolder);
                  imageMapping = imgResult.imageMapping;
                  addLog(`  图片: ${imgUrls.length} 张，成功 ${Object.keys(imgResult.imageMapping).length} 张`, 'info');
                }
              }

              let md = htmlToMarkdown(item.html || '', imageMapping);
              md = buildFrontmatter(item) + md;
              await writeTextFile(articlesFolder, filename, md);
            }

            // Update progress per article (so interruptions don't lose data)
            await addExportedArticle(currentDirHandle, collectionId, currentProgressData, item.id);
            exportedIds.add(item.id);
            // Update Zustand store
            useExportStore.getState().markArticleExported(item.id);
          } catch (err: unknown) {
            failedCount++;
            const msg = err instanceof Error ? err.message : String(err);
            addLog(`导出失败 [${itemLabel}]: ${msg}`, 'error');
          }
        }
      });

      // Cache items for the comment export panel
      if (allItems.length > 0) {
        setItems(allItems);
      }

      // Summary log
      const summary = [
        `导出完成：本次导出 ${exportedInBatch - failedCount} 篇，共已导出 ${useExportStore.getState().progressData?.articles.totalExported ?? 0} 篇`,
      ];
      if (failedCount > 0) summary.push(`失败 ${failedCount} 篇`);
      if (skippedCount > 0) summary.push(`跳过无ID ${skippedCount} 篇`);

      if (exportedInBatch > 0 || failedCount > 0) {
        await updateReadme(collectionFolder);
        addLog(summary.join('，'), failedCount > 0 ? 'warn' : 'success');
      } else {
        addLog('没有需要导出的新内容', 'warn');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`导出失败: ${msg}`, 'error');
    } finally {
      setIsExportingArticles(false);
      setExportProgress(null);
    }
  }, [
    collectionId,
    collectionName,
    fetchDirectoryPages,
    updateReadme,
    addLog,
    setIsExportingArticles,
    setExportProgress,
    setItems,
  ]);

  // Derived UI values
  const exported = progressData?.articles.totalExported ?? 0;
  const dateInfo = progressData?.articles.newestExportedTime
    ? `（截至 ${new Date(progressData.articles.newestExportedTime).toLocaleDateString('zh-CN')}）`
    : '';

  const buttonText = isExportingArticles
    ? '导出中...'
    : exported > 0
      ? '导出全部（跳过已导出）'
      : '开始导出';

  const progressPercent =
    exportProgress && exportProgress.total > 0
      ? Math.round((exportProgress.current / exportProgress.total) * 100)
      : 0;

  return (
    <Card title="文章导出">
      <Typography.Text>
        已导出 {exported} 篇{dateInfo}
      </Typography.Text>

      {format === 'md' && (
        <div style={{ marginTop: 8 }}>
          <Checkbox
            checked={wantImages}
            onChange={(e) => setWantImages(e.target.checked)}
          >
            存图
          </Checkbox>
        </div>
      )}

      <div style={{ marginTop: 4 }}>
        <span className="note-text">含 Front Matter 元信息，供评论导出识别</span>
      </div>

      {exportProgress && (
        <div style={{ marginTop: 8 }}>
          <Progress percent={progressPercent} size="small" />
          <Typography.Text type="secondary">{exportProgress.text}</Typography.Text>
        </div>
      )}

      <Button
        type="primary"
        block
        onClick={handleExport}
        loading={isExportingArticles}
        disabled={!dirHandle}
        style={{ marginTop: 12 }}
      >
        {buttonText}
      </Button>
    </Card>
  );
}
