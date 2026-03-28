import { useMemo } from 'react';
import { detectPage } from '@/shared/api/zhihu-api';
import { extractContent, getCollectionInfo, getColumnInfo } from '@/content/detector';
import type { PageInfo, ExtractedContent, CollectionInfo } from '@/types/zhihu';

export function usePageDetect() {
  return useMemo(() => {
    const pageInfo = detectPage(window.location.href);
    let content: ExtractedContent | null = null;
    let collectionInfo: CollectionInfo | null = null;

    if (pageInfo) {
      if (pageInfo.type === 'collection') {
        collectionInfo = getCollectionInfo();
      } else if (pageInfo.type === 'column') {
        collectionInfo = getColumnInfo();
      } else {
        content = extractContent();
      }
    }

    return { pageInfo, content, collectionInfo };
  }, []);
}
