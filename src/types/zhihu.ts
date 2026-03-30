/** 页面类型 */
export type PageType = 'article' | 'answer' | 'question' | 'pin' | 'collection' | 'column';

/** 页面检测结果 */
export interface PageInfo {
  type: PageType;
  id: string;
}

/** 收藏夹/专栏的内容条目（API 返回归一化后） */
export interface ContentItem {
  id: string;
  type: PageType;
  url: string;
  title: string;
  author: string;
  html: string;
  isTruncated: boolean;
  isPaidContent: boolean;
  commentCount: number;
  created_time: number;
  updated_time: number;
  /** 收藏时间（仅收藏夹条目有此字段） */
  collected_time?: number;
}

/** 从当前页面提取的文章/回答内容 */
export interface ExtractedContent {
  id: string;
  type: PageType;
  url: string;
  title: string;
  author: string;
  html: string;
  createdTime?: number | null;
  updatedTime?: number | null;
  _source?: string;
}

/** 收藏夹/专栏信息 */
export interface CollectionInfo {
  id: string;
  title: string;
  itemCount: number;
  apiUrl: string;
}

/** 分页 API 返回 */
export interface PaginatedResult {
  items: ContentItem[];
  nextUrl: string | null;
  totals: number;
}

/** 知乎评论 */
export interface ZhihuComment {
  id: string;
  content: string;
  author: {
    name: string;
    avatar_url?: string;
  };
  created_time: number;
  child_comment_count: number;
  child_comments?: ZhihuComment[];
  like_count?: number;
  reply_to_author?: { name: string };
  author_tag?: Array<{ type: string; text?: string }>;
  comment_tag?: Array<{ type: string; text?: string }>;
}

/** 导出进度 */
export interface ExportProgress {
  collectionId: string;
  collectionName: string;
  articles: {
    exportedIds: string[];
    totalExported: number;
    batchSize: number;
  };
  comments: {
    exportedArticles: string[];
    totalExported: number;
  };
}

/** 图片下载结果 */
export interface ImageDownloadResult {
  imageMapping: Record<string, string>;
  imageFiles: Array<{ path: string; buffer: ArrayBuffer }>;
}

/** 日志级别 */
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

/** 日志条目 */
export interface LogEntry {
  time: string;
  message: string;
  level: LogLevel;
}

/** 导出格式 */
export type ExportFormat = 'md' | 'docx';

/** Docx 图片模式 */
export type DocxImageMode = 'embed' | 'link';
