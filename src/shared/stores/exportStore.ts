import { create } from 'zustand';
import type { ContentItem, ExportFormat, DocxImageMode, ExportProgress } from '@/types/zhihu';

interface ExportState {
  dirHandle: FileSystemDirectoryHandle | null;
  format: ExportFormat;
  docxImageMode: DocxImageMode;
  wantImages: boolean;
  items: ContentItem[];
  progressData: ExportProgress | null;
  isExportingArticles: boolean;
  isExportingComments: boolean;
  exportProgress: { current: number; total: number; text: string } | null;

  setDirHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setFormat: (format: ExportFormat) => void;
  setDocxImageMode: (mode: DocxImageMode) => void;
  setWantImages: (want: boolean) => void;
  setItems: (items: ContentItem[]) => void;
  setProgressData: (data: ExportProgress | null) => void;
  setIsExportingArticles: (v: boolean) => void;
  setIsExportingComments: (v: boolean) => void;
  setExportProgress: (p: ExportState['exportProgress']) => void;
  markArticleExported: (id: string) => void;
  markCommentExported: (id: string) => void;
}

export const useExportStore = create<ExportState>((set) => ({
  dirHandle: null,
  format: 'md',
  docxImageMode: 'embed',
  wantImages: true,
  items: [],
  progressData: null,
  isExportingArticles: false,
  isExportingComments: false,
  exportProgress: null,

  setDirHandle: (handle) => set({ dirHandle: handle }),
  setFormat: (format) => set({ format }),
  setDocxImageMode: (mode) => set({ docxImageMode: mode }),
  setWantImages: (want) => set({ wantImages: want }),
  setItems: (items) => set({ items }),
  setProgressData: (data) => set({ progressData: data }),
  setIsExportingArticles: (v) => set({ isExportingArticles: v }),
  setIsExportingComments: (v) => set({ isExportingComments: v }),
  setExportProgress: (p) => set({ exportProgress: p }),
  markArticleExported: (id) => set((s) => {
    if (!s.progressData) return s;
    const ids = [...s.progressData.articles.exportedIds, id];
    return {
      progressData: {
        ...s.progressData,
        articles: { ...s.progressData.articles, exportedIds: ids, totalExported: ids.length },
      },
    };
  }),
  markCommentExported: (id) => set((s) => {
    if (!s.progressData) return s;
    const articles = [...s.progressData.comments.exportedArticles, id];
    return {
      progressData: {
        ...s.progressData,
        comments: { ...s.progressData.comments, exportedArticles: articles, totalExported: articles.length },
      },
    };
  }),
}));
