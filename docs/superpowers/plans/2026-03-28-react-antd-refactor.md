# React + Ant Design 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 DownloadZhihu Chrome 扩展从原生 JS 重构为 React 18 + TypeScript + Ant Design 5 + Zustand 架构。

**Architecture:** 三个打包入口（Content Script、Extension Page、Service Worker），Content Script 使用 Shadow DOM 隔离 + Antd StyleProvider 注入样式，fetch-bridge.js 保持原生 JS 不参与打包。所有 `window.__xxx` 全局挂载改为 ES module import/export。

**Tech Stack:** React 18, TypeScript, Ant Design 5.x, Zustand, Vite + CRXJS, Turndown (npm), JSZip (npm), docx (npm), Temml (npm)

**Spec:** `docs/superpowers/specs/2026-03-28-react-antd-refactor-design.md`

---

## File Structure

### New files to create

```
package.json
tsconfig.json
vite.config.ts
src/
├── manifest.ts
├── background/
│   └── index.ts
├── content/
│   ├── index.tsx
│   ├── fetch-bridge.js              (copy from content/fetch-bridge.js)
│   ├── detector.ts
│   ├── components/
│   │   ├── FloatingButton.tsx
│   │   ├── PanelHost.tsx
│   │   ├── ArticlePanel.tsx
│   │   ├── CollectionPanel.tsx
│   │   └── ColumnPanel.tsx
│   └── hooks/
│       ├── usePageDetect.ts
│       └── useFolderHandle.ts
├── export/
│   ├── index.html
│   ├── main.tsx
│   ├── components/
│   │   ├── ExportManager.tsx
│   │   ├── FolderPicker.tsx
│   │   ├── FormatSelector.tsx
│   │   ├── ArticleList.tsx
│   │   ├── CommentExport.tsx
│   │   └── LogPanel.tsx
│   └── hooks/
│       └── useExportProgress.ts
├── shared/
│   ├── api/
│   │   ├── zhihu-api.ts
│   │   ├── throttle.ts
│   │   └── proxy-fetch.ts
│   ├── converters/
│   │   ├── html-to-markdown.ts
│   │   ├── html-to-docx.ts
│   │   └── zhihu-html-utils.ts
│   ├── stores/
│   │   ├── exportStore.ts
│   │   └── uiStore.ts
│   ├── utils/
│   │   ├── export-utils.ts
│   │   └── progress.ts
│   └── theme/
│       ├── token.ts
│       └── ink-wash.module.css
├── types/
│   ├── zhihu.ts
│   └── messages.ts
└── assets/
    └── icons/                       (copy from icons/)
```

### Old files to remove (after migration complete)

All files in the root directory except `docs/`, `.git/`, `.gitignore` and any config files created by the new build system.

---

## Phase 1: Project Scaffolding

### Task 1: Initialize npm project + Vite + CRXJS + TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/manifest.ts`
- Create: `src/assets/icons/` (copy existing icons)

- [ ] **Step 1: Initialize npm project**

```bash
cd "/Users/chouheiwa/Desktop/web/chrome插件/DownloadZhihu"
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react react-dom antd @ant-design/cssinjs zustand turndown jszip docx temml
npm install -D typescript @types/react @types/react-dom @types/turndown @types/chrome vite @crxjs/vite-plugin@latest @vitejs/plugin-react
```

Note: `mathml2omml` may not have an npm package. If not available, keep it as a vendored file in `src/vendor/mathml2omml.min.js` and import with a `.d.ts` declaration.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        export: resolve(__dirname, 'src/export/index.html'),
      },
    },
  },
});
```

- [ ] **Step 5: Create src/manifest.ts**

```typescript
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '知乎文章下载器',
  description: '将知乎文章、回答、问题、想法、收藏夹导出为 Markdown 或 Word (.docx) 文件',
  version: '3.0.0',
  permissions: ['activeTab', 'storage', 'unlimitedStorage', 'scripting'],
  host_permissions: [
    'https://www.zhihu.com/*',
    'https://zhuanlan.zhihu.com/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
  },
  icons: {
    '16': 'src/assets/icons/icon16.png',
    '48': 'src/assets/icons/icon48.png',
    '128': 'src/assets/icons/icon128.png',
  },
  content_scripts: [
    {
      matches: [
        'https://www.zhihu.com/*',
        'https://zhuanlan.zhihu.com/*',
      ],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/assets/icons/icon48.png', 'src/content/fetch-bridge.js'],
      matches: ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
    },
  ],
});
```

- [ ] **Step 6: Copy icons to src/assets/icons/**

```bash
mkdir -p src/assets/icons
cp icons/icon16.png icons/icon48.png icons/icon128.png icons/icon.png src/assets/icons/
```

- [ ] **Step 7: Copy fetch-bridge.js to src/content/**

```bash
mkdir -p src/content
cp content/fetch-bridge.js src/content/fetch-bridge.js
```

- [ ] **Step 8: Create minimal placeholder files for build verification**

Create `src/background/index.ts`:
```typescript
console.log('DownloadZhihu service worker loaded');
```

Create `src/content/index.tsx`:
```typescript
console.log('DownloadZhihu content script loaded');
```

Create `src/export/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>知乎导出管理器</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

Create `src/export/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <div>Export Manager Loading...</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 9: Verify build**

```bash
npx vite build
```

Expected: Build succeeds, produces `dist/` with manifest.json, content script bundle, service worker, and export page.

- [ ] **Step 10: Add .gitignore entries**

Add to `.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts src/ .gitignore
git commit -m "chore: 初始化 Vite + CRXJS + React + TypeScript 项目结构"
```

---

## Phase 2: Type Definitions + Shared Pure Logic

### Task 2: TypeScript type definitions

**Files:**
- Create: `src/types/zhihu.ts`
- Create: `src/types/messages.ts`

- [ ] **Step 1: Create zhihu.ts**

Define all Zhihu domain types based on current code usage (from `export-utils.js`, `zhihu-api.js`, `detector.js`):

```typescript
// src/types/zhihu.ts

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
```

- [ ] **Step 2: Create messages.ts**

```typescript
// src/types/messages.ts

/** Content Script / Extension Page → Service Worker 消息 */
export type ExtensionMessage =
  | { action: 'openExportPage'; url: string }
  | { action: 'proxyFetch'; url: string; responseType?: 'text' | 'json' }

/** Service Worker → Content Script 消息 */
export type ContentScriptMessage =
  | { action: 'fetchProxy'; url: string; responseType?: 'text' | 'json' }

/** proxyFetch 响应 */
export type ProxyResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number }

/** API 请求错误（携带 HTTP 状态码） */
export class ApiError extends Error {
  httpStatus?: number;
  partialComments?: unknown[];

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = status;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/
git commit -m "feat: 添加 TypeScript 类型定义"
```

### Task 3: Migrate throttle.ts

**Files:**
- Create: `src/shared/api/throttle.ts`
- Source: `lib/throttle.js`

- [ ] **Step 1: Create throttle.ts**

Convert the IIFE to ES module. Remove `window.__throttle` global. The logic stays identical:

```typescript
// src/shared/api/throttle.ts

const MIN_INTERVAL = 500;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 30000;

let lastRequestTime = 0;
let onRetryCallback: ((retryCount: number, maxRetries: number, waitMs: number) => void) | null = null;

export function setOnRetry(cb: typeof onRetryCallback): void {
  onRetryCallback = cb;
}

export function getOnRetry(): typeof onRetryCallback {
  return onRetryCallback;
}

export async function waitForInterval(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise<void>((r) => setTimeout(r, MIN_INTERVAL - elapsed));
  }
}

export async function throttledFetch(url: string, options?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForInterval();
    lastRequestTime = Date.now();

    const response = await fetch(url, options);

    if (response.status === 403 && attempt < MAX_RETRIES) {
      const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
      if (onRetryCallback) {
        onRetryCallback(attempt + 1, MAX_RETRIES, backoff);
      }
      await new Promise<void>((r) => setTimeout(r, backoff));
      continue;
    }

    return response;
  }

  throw new Error('请求失败：已达最大重试次数');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/api/throttle.ts
git commit -m "feat: 迁移 throttle 请求节流模块为 TypeScript ES module"
```

### Task 4: Migrate proxy-fetch.ts

**Files:**
- Create: `src/shared/api/proxy-fetch.ts`
- Source: proxyFetch logic from `lib/zhihu-api.js` lines 36-59 + proxyFetchWithRetry lines 39-56

- [ ] **Step 1: Create proxy-fetch.ts**

Extract the Extension Page proxy fetch logic into its own module:

```typescript
// src/shared/api/proxy-fetch.ts
import { ApiError } from '@/types/messages';
import * as throttle from './throttle';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 30000;

interface ProxyResponseData {
  ok?: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

/**
 * 通过 content script 代理请求（Extension Page 专用）
 * 返回类 Response 对象
 */
function proxyFetch(url: string, responseType?: string): Promise<{ ok: true; status: 200; json: () => Promise<unknown>; text: () => Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'proxyFetch', url, responseType },
      (response: ProxyResponseData) => {
        if (chrome.runtime.lastError) {
          reject(new ApiError(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          const err = new ApiError(response?.error || '代理请求失败', response?.status);
          reject(err);
          return;
        }
        resolve({
          ok: true as const,
          status: 200,
          json: async () => response.data,
          text: async () => response.data,
        });
      }
    );
  });
}

/**
 * Extension Page 专用：带 403 指数退避重试的代理请求
 */
export async function proxyFetchWithRetry(url: string, responseType?: string): ReturnType<typeof proxyFetch> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) await throttle.waitForInterval();
      return await proxyFetch(url, responseType);
    } catch (err) {
      if (err instanceof ApiError && err.httpStatus === 403 && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF * Math.pow(2, attempt);
        const onRetry = throttle.getOnRetry();
        if (onRetry) onRetry(attempt + 1, MAX_RETRIES, backoff);
        await new Promise<void>((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError('请求被限制：已达最大重试次数，请稍后再试或手动完成验证码后重试', 403);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/api/proxy-fetch.ts
git commit -m "feat: 迁移 proxyFetch 代理请求模块为 TypeScript"
```

### Task 5: Migrate zhihu-html-utils.ts

**Files:**
- Create: `src/shared/converters/zhihu-html-utils.ts`
- Source: `lib/zhihu-html-utils.js` (143 lines)

- [ ] **Step 1: Create zhihu-html-utils.ts**

Convert the IIFE to ES module. These are all pure functions — straightforward migration. Read `lib/zhihu-html-utils.js`, convert each function to a named export, add type annotations to parameters and return values. Remove the `window` assignments at the bottom.

Key functions to export:
- `isEeimgFormula(el: Element): boolean`
- `isBlockFormula(el: Element): boolean`
- `getHighResImageUrl(el: Element): string | null`
- `isVideoBox(el: Element): boolean`
- `isLinkCard(el: Element): boolean`
- `hasFootnoteSup(el: Element): boolean`
- `isCatalogNav(el: Element): boolean`
- `isReferenceList(el: Element): boolean`
- `extractImageUrls(html: string): string[]`
- `extractCommentImageUrls(html: string): string[]`

- [ ] **Step 2: Commit**

```bash
git add src/shared/converters/zhihu-html-utils.ts
git commit -m "feat: 迁移 zhihu-html-utils 为 TypeScript ES module"
```

### Task 6: Migrate zhihu-api.ts

**Files:**
- Create: `src/shared/api/zhihu-api.ts`
- Source: `lib/zhihu-api.js` (414 lines)

- [ ] **Step 1: Create zhihu-api.ts**

Convert IIFE to ES module. Key changes:
1. Replace `window.__throttle` with `import * as throttle from './throttle'`
2. Replace `proxyFetch` inline with `import { proxyFetchWithRetry } from './proxy-fetch'`
3. Use `ApiError` from types instead of plain Error with httpStatus
4. `isExtensionPage` detection: `const isExtensionPage = typeof chrome !== 'undefined' && chrome.runtime?.getURL !== undefined && location.protocol === 'chrome-extension:';`
5. Add type annotations to all functions
6. Export all public functions as named exports
7. Remove `window.__zhihuApi` assignment

The `apiFetch` function:
```typescript
import * as throttle from './throttle';
import { proxyFetchWithRetry } from './proxy-fetch';
import { ApiError } from '@/types/messages';
import type { PageInfo, ContentItem, PaginatedResult, ZhihuComment } from '@/types/zhihu';

const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<unknown>;
};

async function apiFetch(url: string, responseType?: string): Promise<FetchLikeResponse> {
  await throttle.waitForInterval();
  if (isExtensionPage) {
    return proxyFetchWithRetry(url, responseType);
  }
  return throttle.throttledFetch(url, {
    credentials: 'include',
    headers: { 'Accept': '*/*' },
  });
}
```

Export: `detectPage`, `fetchCollectionPage`, `fetchColumnPage`, `checkPaidAccess`, `fetchFullContent`, `fetchRootComments`, `fetchChildComments`, `fetchAllComments`, `parseContentItem`.

Migrate every function from `lib/zhihu-api.js` to this file, preserving all logic including the 403 error handling added earlier.

- [ ] **Step 2: Commit**

```bash
git add src/shared/api/zhihu-api.ts
git commit -m "feat: 迁移 zhihu-api 为 TypeScript ES module"
```

### Task 7: Migrate html-to-markdown.ts

**Files:**
- Create: `src/shared/converters/html-to-markdown.ts`
- Source: `lib/html-to-markdown.js` (361 lines)

- [ ] **Step 1: Create html-to-markdown.ts**

Key changes:
1. `import TurndownService from 'turndown';` (npm package)
2. Import zhihu-html-utils functions from `@/shared/converters/zhihu-html-utils`
3. Remove all `window.xxx` assignments
4. Export: `htmlToMarkdown(html: string, imageMapping?: Record<string, string>): string`
5. Export: `buildCommentsMarkdown(comments: ZhihuComment[], title: string, imageMapping?: Record<string, string>): string`
6. Export: `commentHtmlToText(html: string): string`

Convert the IIFE. All Turndown custom rules stay identical — just import dependencies via ES modules instead of globals.

- [ ] **Step 2: Commit**

```bash
git add src/shared/converters/html-to-markdown.ts
git commit -m "feat: 迁移 html-to-markdown 为 TypeScript，使用 npm turndown"
```

### Task 8: Migrate html-to-docx.ts

**Files:**
- Create: `src/shared/converters/html-to-docx.ts`
- Source: `lib/html-to-docx.js` (908 lines)

- [ ] **Step 1: Create html-to-docx.ts**

Key changes:
1. `import { Document, Packer, Paragraph, ... } from 'docx';` (npm)
2. `import temml from 'temml';` (npm)
3. For `mathml2omml`: check if npm package exists. If not, copy `lib/mathml2omml.min.js` to `src/vendor/mathml2omml.min.js`, create `src/vendor/mathml2omml.d.ts` with `declare function mathml2omml(mathml: string): string; export default mathml2omml;`
4. Import zhihu-html-utils from `@/shared/converters/zhihu-html-utils`
5. Export: `htmlToDocx(html: string, options: DocxOptions): Promise<Blob>`
6. Export: `commentsToDocx(comments: ZhihuComment[], title: string): Promise<Blob>`
7. Remove all `window.htmlToDocx`, `window.commentsToDocx` assignments

This is the largest single file (908 lines). The migration is mechanical — same logic, just change imports from globals to ES modules.

- [ ] **Step 2: Commit**

```bash
git add src/shared/converters/html-to-docx.ts src/vendor/
git commit -m "feat: 迁移 html-to-docx 为 TypeScript，使用 npm docx/temml"
```

### Task 9: Migrate export-utils.ts

**Files:**
- Create: `src/shared/utils/export-utils.ts`
- Source: `content/export-utils.js` (265 lines)

- [ ] **Step 1: Create export-utils.ts**

Key changes:
1. Remove `window.__exportUtils` assignment
2. Remove dependency on `window.__zhihuDownloader` — import `detectPage` from `@/shared/api/zhihu-api`
3. Import `extractImageUrls`, `extractCommentImageUrls` from `@/shared/converters/zhihu-html-utils`
4. `showProgress`/`hideProgress` are DOM-manipulation helpers specific to the old UI — these will NOT be migrated (React components manage their own rendering). Remove them.
5. Export all pure utility functions: `TYPE_LABELS`, `buildFrontmatter`, `sanitizeFilename`, `escapeHtml`, `triggerDownload`, `downloadImage`, `batchDownloadImages`, `batchDownloadImagesToFolder`, `writeTextFile`, `writeBlobFile`, `buildImageDataMap`, `collectCommentImageEntries`, `downloadCommentImages`, `buildTocMarkdown`
6. `inferImageExtension` — include as internal helper (already exists in original code but not shown in excerpt)

- [ ] **Step 2: Commit**

```bash
git add src/shared/utils/export-utils.ts
git commit -m "feat: 迁移 export-utils 为 TypeScript ES module"
```

### Task 10: Migrate progress.ts

**Files:**
- Create: `src/shared/utils/progress.ts`
- Source: `lib/progress.js` (92 lines)

- [ ] **Step 1: Create progress.ts**

Straightforward conversion. Import `ExportProgress` type. Remove `window.__progress`.

```typescript
// src/shared/utils/progress.ts
import type { ExportProgress } from '@/types/zhihu';
import { detectPage } from '@/shared/api/zhihu-api';

function getFilename(collectionId: string): string {
  return `export-progress-${collectionId}.json`;
}

export async function readProgress(dirHandle: FileSystemDirectoryHandle, collectionId: string): Promise<ExportProgress | null> {
  // ... same logic as lib/progress.js
}

export async function writeProgress(dirHandle: FileSystemDirectoryHandle, collectionId: string, progressData: ExportProgress): Promise<void> {
  // ... same logic
}

export function createInitialProgress(collectionId: string, collectionName: string): ExportProgress {
  // ... same logic
}

export async function addExportedArticle(dirHandle: FileSystemDirectoryHandle, collectionId: string, progress: ExportProgress, articleId: string): Promise<void> {
  // ... same logic
}

export async function updateCommentProgress(dirHandle: FileSystemDirectoryHandle, collectionId: string, progress: ExportProgress, articleId: string): Promise<void> {
  // ... same logic
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/utils/progress.ts
git commit -m "feat: 迁移 progress 进度管理为 TypeScript ES module"
```

---

## Phase 3: Theme, Stores, Background

### Task 11: Create Ant Design theme + ink-wash CSS module

**Files:**
- Create: `src/shared/theme/token.ts`
- Create: `src/shared/theme/ink-wash.module.css`

- [ ] **Step 1: Create token.ts**

```typescript
// src/shared/theme/token.ts
import type { ThemeConfig } from 'antd';

export const inkWashTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2c3e50',
    colorSuccess: '#27ae60',
    colorWarning: '#d69e2e',
    colorError: '#c0392b',
    colorBgBase: '#f5f0e8',
    colorBgContainer: '#faf6ef',
    colorBorder: '#d4c5a9',
    colorText: '#2c3e50',
    colorTextSecondary: '#666',
    fontFamily: '"Noto Serif SC", "LXGW WenKai", serif',
    borderRadius: 4,
  },
  components: {
    Button: { borderRadius: 6 },
    Card: { borderRadius: 8 },
  },
};
```

- [ ] **Step 2: Create ink-wash.module.css**

Extract the visual texture effects from `export/export.css` (ink wash decorations, rice paper texture, seal mark). These are pure CSS visual effects that overlay on containers.

Port the key visual classes from `export/export.css`:
- `.inkWashBg` — the overall background with paper texture
- `.inkWash1`, `.inkWash2` — decorative ink splash elements
- `.ricePaperTexture` — SVG noise filter overlay
- `.sealMark` — the red seal stamp decoration
- `.dividerInk` — ornamental section dividers

Convert class names to camelCase for CSS Modules.

- [ ] **Step 3: Commit**

```bash
git add src/shared/theme/
git commit -m "feat: 创建 Antd 水墨主题 token 和纹理 CSS module"
```

### Task 12: Create Zustand stores

**Files:**
- Create: `src/shared/stores/uiStore.ts`
- Create: `src/shared/stores/exportStore.ts`

- [ ] **Step 1: Create uiStore.ts**

```typescript
// src/shared/stores/uiStore.ts
import { create } from 'zustand';
import type { LogEntry, LogLevel } from '@/types/zhihu';

interface RetryInfo {
  count: number;
  max: number;
  waitMs: number;
}

interface UIState {
  panelOpen: boolean;
  logs: LogEntry[];
  retryInfo: RetryInfo | null;

  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  addLog: (message: string, level: LogLevel) => void;
  clearLogs: () => void;
  setRetryInfo: (info: RetryInfo | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  panelOpen: false,
  logs: [],
  retryInfo: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  addLog: (message, level) => set((s) => ({
    logs: [...s.logs, {
      time: new Date().toLocaleTimeString(),
      message,
      level,
    }],
  })),

  clearLogs: () => set({ logs: [] }),
  setRetryInfo: (info) => set({ retryInfo: info }),
}));
```

- [ ] **Step 2: Create exportStore.ts**

```typescript
// src/shared/stores/exportStore.ts
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
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/stores/
git commit -m "feat: 创建 Zustand stores（UI 状态 + 导出状态）"
```

### Task 13: Migrate background service worker

**Files:**
- Modify: `src/background/index.ts`
- Source: `background.js` (93 lines)

- [ ] **Step 1: Rewrite src/background/index.ts**

Convert `background.js` to TypeScript. The service worker doesn't use React — it's pure message handling.

Key changes:
1. Use typed messages from `@/types/messages`
2. `proxyFetchViaContentScript` typed with proper error handling
3. Remove `injectDocxLibs` handler (docx libs are now bundled via npm imports)
4. Keep `openExportPage` and `proxyFetch` handlers

```typescript
// src/background/index.ts
import type { ExtensionMessage, ContentScriptMessage } from '@/types/messages';

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.action === 'openExportPage') {
    chrome.tabs.create({ url: message.url });
    return;
  }

  if (message.action === 'proxyFetch') {
    if (message.responseType === 'text') {
      fetch(message.url, { credentials: 'include' })
        .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    } else {
      proxyFetchViaContentScript(message.url, message.responseType)
        .then((result) => sendResponse({ ok: true, data: result }))
        .catch((err: Error & { httpStatus?: number }) => sendResponse({ ok: false, error: err.message, status: err.httpStatus }));
    }
    return true;
  }
});

async function proxyFetchViaContentScript(url: string, responseType?: string): Promise<unknown> {
  const tabs = await chrome.tabs.query({
    url: ['https://www.zhihu.com/*', 'https://zhuanlan.zhihu.com/*'],
  });

  if (tabs.length === 0) {
    throw new Error('请保持至少一个知乎页面打开（用于代理 API 请求）');
  }

  for (const tab of tabs) {
    try {
      return await new Promise((resolve, reject) => {
        if (!tab.id) { reject(new Error('no tab id')); return; }
        const msg: ContentScriptMessage = { action: 'fetchProxy', url, responseType };
        chrome.tabs.sendMessage(tab.id, msg, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('content script 无响应'));
            return;
          }
          if (response.error) {
            const err = new Error(response.error) as Error & { httpStatus?: number };
            err.httpStatus = response.status;
            reject(err);
            return;
          }
          resolve(response.data);
        });
      });
    } catch {
      continue;
    }
  }

  throw new Error(`所有知乎页面均无法连接（共 ${tabs.length} 个标签页），请刷新任意一个知乎页面后重试`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/background/index.ts
git commit -m "feat: 迁移 background service worker 为 TypeScript"
```

---

## Phase 4: Content Script (Detector + UI Components)

### Task 14: Migrate detector.ts

**Files:**
- Create: `src/content/detector.ts`
- Source: `content/detector.js` (327 lines)

- [ ] **Step 1: Create detector.ts**

Migrate the content extraction logic and fetch-bridge setup. Key changes:
1. Import `detectPage` from `@/shared/api/zhihu-api` instead of `window.__zhihuApi`
2. Export functions directly: `extractContent()`, `getCollectionInfo()`, `getColumnInfo()`, `setupFetchBridge()`, `pageFetch()`
3. Remove `window.__zhihuDownloader` assignment
4. `setupFetchBridge()` handles the script injection + CustomEvent listeners + chrome.runtime.onMessage listener for fetchProxy
5. Type all extracted data with `ExtractedContent`, `CollectionInfo`

The `setupFetchBridge()` function:
```typescript
export function setupFetchBridge(): void {
  // Inject bridge script into page context
  const bridgeScript = document.createElement('script');
  bridgeScript.src = chrome.runtime.getURL('src/content/fetch-bridge.js');
  (document.head || document.documentElement).appendChild(bridgeScript);
  bridgeScript.onload = () => bridgeScript.remove();

  // Listen for responses from bridge
  window.addEventListener('__zhihu_dl_fetch_response', ((e: CustomEvent) => {
    const { id, data, error, status } = e.detail;
    const pending = pendingRequests.get(id);
    if (pending) {
      pendingRequests.delete(id);
      if (error) {
        const err = new Error(error) as Error & { httpStatus?: number };
        err.httpStatus = status;
        pending.reject(err);
      } else {
        pending.resolve(data);
      }
    }
  }) as EventListener);

  // Listen for proxy requests from service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'fetchProxy') return;
    pageFetch(message.url, message.responseType)
      .then((data: unknown) => sendResponse({ data }))
      .catch((err: Error & { httpStatus?: number }) => sendResponse({ error: err.message, status: err.httpStatus }));
    return true;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/detector.ts
git commit -m "feat: 迁移 detector 内容提取模块为 TypeScript"
```

### Task 15: Create PanelHost component (Shadow DOM + Antd StyleProvider)

**Files:**
- Create: `src/content/components/PanelHost.tsx`

- [ ] **Step 1: Create PanelHost.tsx**

This is the critical Shadow DOM integration component:

```tsx
// src/content/components/PanelHost.tsx
import React, { useRef, useEffect, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { StyleProvider, createCache } from '@ant-design/cssinjs';
import { ConfigProvider } from 'antd';
import { inkWashTheme } from '@/shared/theme/token';

export function PanelHost({ children }: PropsWithChildren) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mountTarget, setMountTarget] = useState<{
    container: HTMLDivElement;
    shadowRoot: ShadowRoot;
  } | null>(null);
  const cacheRef = useRef(createCache());

  useEffect(() => {
    if (!hostRef.current || mountTarget) return;
    const shadowRoot = hostRef.current.attachShadow({ mode: 'closed' });

    // Inject reset styles into shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :host { all: initial; }
    `;
    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    shadowRoot.appendChild(container);
    setMountTarget({ container, shadowRoot });
  }, []);

  return (
    <>
      <div ref={hostRef} style={{ all: 'initial', position: 'fixed', zIndex: 2147483647, top: 0, left: 0, width: 0, height: 0 }} />
      {mountTarget &&
        createPortal(
          <StyleProvider container={mountTarget.shadowRoot} cache={cacheRef.current}>
            <ConfigProvider
              theme={inkWashTheme}
              getPopupContainer={() => mountTarget.container}
            >
              {children}
            </ConfigProvider>
          </StyleProvider>,
          mountTarget.container
        )
      }
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/components/PanelHost.tsx
git commit -m "feat: 创建 PanelHost Shadow DOM + Antd StyleProvider 组件"
```

### Task 16: Create FloatingButton component

**Files:**
- Create: `src/content/components/FloatingButton.tsx`
- Source: `content/floating-ui.js` (drag logic, position persistence)

- [ ] **Step 1: Create FloatingButton.tsx**

Port the FAB with drag functionality:

```tsx
// src/content/components/FloatingButton.tsx
import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/shared/stores/uiStore';

const STORAGE_KEY = 'zhihu-downloader-pos';
const DEFAULT_POS = { right: 24, bottom: 100 };

function loadPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { right: number; bottom: number };
  } catch { /* ignore */ }
  return DEFAULT_POS;
}

function savePosition(right: number, bottom: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ right, bottom }));
  } catch { /* ignore */ }
}

export function FloatingButton() {
  const togglePanel = useUIStore((s) => s.togglePanel);
  const [pos, setPos] = useState(loadPosition);
  const dragState = useRef({ isDragging: false, hasMoved: false, startX: 0, startY: 0, startRight: 0, startBottom: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current;
    ds.isDragging = true;
    ds.hasMoved = false;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.startRight = pos.right;
    ds.startBottom = pos.bottom;
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.isDragging) return;
      const dx = ds.startX - e.clientX;
      const dy = ds.startY - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.hasMoved = true;
      if (!ds.hasMoved) return;
      setPos({
        right: Math.max(0, Math.min(window.innerWidth - 50, ds.startRight + dx)),
        bottom: Math.max(0, Math.min(window.innerHeight - 50, ds.startBottom + dy)),
      });
    };

    const onMouseUp = () => {
      const ds = dragState.current;
      if (!ds.isDragging) return;
      ds.isDragging = false;
      if (ds.hasMoved) {
        // Save on next render when pos is updated
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Persist position on change (debounced by drag end)
  useEffect(() => {
    savePosition(pos.right, pos.bottom);
  }, [pos]);

  const onClick = useCallback(() => {
    if (dragState.current.hasMoved) return;
    togglePanel();
  }, [togglePanel]);

  const iconUrl = chrome.runtime.getURL('src/assets/icons/icon48.png');

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{
        position: 'fixed',
        right: pos.right,
        bottom: pos.bottom,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#0066ff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        zIndex: 2147483647,
      }}
    >
      <img src={iconUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, pointerEvents: 'none' }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/components/FloatingButton.tsx
git commit -m "feat: 创建 FloatingButton 可拖拽悬浮按钮组件"
```

### Task 17: Create usePageDetect hook + useFolderHandle hook

**Files:**
- Create: `src/content/hooks/usePageDetect.ts`
- Create: `src/content/hooks/useFolderHandle.ts`

- [ ] **Step 1: Create usePageDetect.ts**

```typescript
// src/content/hooks/usePageDetect.ts
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
```

- [ ] **Step 2: Create useFolderHandle.ts**

Extract the IndexedDB folder handle persistence from `article-panel.js`:

```typescript
// src/content/hooks/useFolderHandle.ts
import { useState, useEffect, useCallback } from 'react';

const IDB_NAME = 'zhihu-downloader';
const IDB_STORE = 'handles';
const IDB_KEY = 'article-save-folder';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function verifyDirHandle(handle: FileSystemDirectoryHandle | null): Promise<FileSystemDirectoryHandle | null> {
  if (!handle) return null;
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

export function useFolderHandle() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await loadDirHandle();
      const verified = await verifyDirHandle(saved);
      if (verified) setDirHandle(verified);
    })();
  }, []);

  const pickFolder = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' } as DirectoryPickerOptions);
      setDirHandle(handle);
      await saveDirHandle(handle);
      return handle;
    } catch {
      return null;
    }
  }, []);

  return { dirHandle, setDirHandle, pickFolder, verifyDirHandle };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/content/hooks/
git commit -m "feat: 创建 usePageDetect 和 useFolderHandle hooks"
```

### Task 18: Create ArticlePanel component

**Files:**
- Create: `src/content/components/ArticlePanel.tsx`
- Source: `content/article-panel.js` (600 lines)

- [ ] **Step 1: Create ArticlePanel.tsx**

This is the most complex content script component. Port all export logic from `article-panel.js`.

Use Antd components: `Card`, `Button`, `Checkbox`, `Radio`, `Progress`, `Space`, `Tag`, `Typography`, `message`.

The component should:
1. Accept `content: ExtractedContent` and `pageInfo: PageInfo` as props
2. Use `useFolderHandle` hook for folder persistence
3. Use `useUIStore` for logging
4. Local state: `format`, `wantFm`, `wantComment`, `wantImages`, `isExporting`, `progress`
5. Port `handleArticleDownload` and `handleSaveToFolder` as async handler functions inside the component
6. Import converters: `htmlToMarkdown`, `htmlToDocx`, `commentsToDocx` from `@/shared/converters/*`
7. Import utils: `sanitizeFilename`, `buildFrontmatter`, `triggerDownload`, etc. from `@/shared/utils/export-utils`
8. Import API: `fetchAllComments`, `detectPage` from `@/shared/api/zhihu-api`
9. Set up throttle retry callback via `setOnRetry` to update component state
10. Use `extractImageUrls` from `@/shared/converters/zhihu-html-utils`

Render with Antd components replacing the manual DOM:
- Info rows → `Descriptions` or styled `div`s with `Tag` for type badge
- Export format → `Radio.Group`
- Checkboxes → Antd `Checkbox`
- Progress → Antd `Progress`
- Buttons → Antd `Button`
- Debug log → collapsible `div` with monospace text

- [ ] **Step 2: Commit**

```bash
git add src/content/components/ArticlePanel.tsx
git commit -m "feat: 创建 ArticlePanel 文章导出面板组件"
```

### Task 19: Create CollectionPanel + ColumnPanel components

**Files:**
- Create: `src/content/components/CollectionPanel.tsx`
- Create: `src/content/components/ColumnPanel.tsx`
- Source: `content/collection-panel.js` (70 lines)

- [ ] **Step 1: Create CollectionPanel.tsx**

Simple component that shows collection info and "Open Export Manager" button:

```tsx
// src/content/components/CollectionPanel.tsx
import React, { useEffect, useState } from 'react';
import { Button, Tag, Space, Spin } from 'antd';
import { fetchCollectionPage } from '@/shared/api/zhihu-api';
import type { CollectionInfo } from '@/types/zhihu';

interface Props {
  info: CollectionInfo;
}

export function CollectionPanel({ info }: Props) {
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchCollectionPage(info.apiUrl)
      .then((result) => {
        setItemCount(result.totals);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [info.apiUrl]);

  const openExportManager = () => {
    const exportUrl = chrome.runtime.getURL(
      `src/export/index.html?id=${encodeURIComponent(info.id)}&name=${encodeURIComponent(info.title)}&api=${encodeURIComponent(info.apiUrl)}&source=collection`
    );
    chrome.runtime.sendMessage({ action: 'openExportPage', url: exportUrl });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div><Tag color="green">收藏夹</Tag></div>
      <div style={{ fontWeight: 600 }}>{info.title}</div>
      <div style={{ color: '#888', fontSize: 13 }}>
        {loading ? <Spin size="small" /> : error ? '获取数量失败' : `${itemCount} 篇`}
      </div>
      <Button type="primary" block onClick={openExportManager} disabled={loading && !error}>
        打开导出管理器
      </Button>
    </Space>
  );
}
```

- [ ] **Step 2: Create ColumnPanel.tsx**

Nearly identical to CollectionPanel but uses `fetchColumnPage` and `source=column`:

```tsx
// src/content/components/ColumnPanel.tsx
import React, { useEffect, useState } from 'react';
import { Button, Tag, Space, Spin } from 'antd';
import { fetchColumnPage } from '@/shared/api/zhihu-api';
import type { CollectionInfo } from '@/types/zhihu';

interface Props {
  info: CollectionInfo;
}

export function ColumnPanel({ info }: Props) {
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchColumnPage(info.apiUrl)
      .then((result) => {
        setItemCount(result.totals);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [info.apiUrl]);

  const openExportManager = () => {
    const exportUrl = chrome.runtime.getURL(
      `src/export/index.html?id=${encodeURIComponent(info.id)}&name=${encodeURIComponent(info.title)}&api=${encodeURIComponent(info.apiUrl)}&source=column`
    );
    chrome.runtime.sendMessage({ action: 'openExportPage', url: exportUrl });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div><Tag color="blue">专栏</Tag></div>
      <div style={{ fontWeight: 600 }}>{info.title}</div>
      <div style={{ color: '#888', fontSize: 13 }}>
        {loading ? <Spin size="small" /> : error ? '获取数量失败' : `${itemCount} 篇`}
      </div>
      <Button type="primary" block onClick={openExportManager} disabled={loading && !error}>
        打开导出管理器
      </Button>
    </Space>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/content/components/CollectionPanel.tsx src/content/components/ColumnPanel.tsx
git commit -m "feat: 创建 CollectionPanel 和 ColumnPanel 组件"
```

### Task 20: Create Content Script entry (index.tsx)

**Files:**
- Modify: `src/content/index.tsx`

- [ ] **Step 1: Rewrite src/content/index.tsx**

Wire everything together — initialize fetch bridge, render FAB + panel:

```tsx
// src/content/index.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupFetchBridge } from './detector';
import { PanelHost } from './components/PanelHost';
import { FloatingButton } from './components/FloatingButton';
import { ContentApp } from './components/ContentApp';

// Initialize fetch bridge (must happen before any API calls)
setupFetchBridge();

// Create host element
const host = document.createElement('div');
host.id = 'zhihu-downloader-root';
document.body.appendChild(host);

createRoot(host).render(
  <PanelHost>
    <FloatingButton />
    <ContentApp />
  </PanelHost>
);
```

Create `src/content/components/ContentApp.tsx`:

```tsx
// src/content/components/ContentApp.tsx
import React from 'react';
import { Card, Typography } from 'antd';
import { useUIStore } from '@/shared/stores/uiStore';
import { usePageDetect } from '../hooks/usePageDetect';
import { ArticlePanel } from './ArticlePanel';
import { CollectionPanel } from './CollectionPanel';
import { ColumnPanel } from './ColumnPanel';

export function ContentApp() {
  const panelOpen = useUIStore((s) => s.panelOpen);
  const setPanelOpen = useUIStore((s) => s.setPanelOpen);
  const { pageInfo, content, collectionInfo } = usePageDetect();

  if (!panelOpen) return null;

  // Extension updated detection
  if (!chrome.runtime?.id) {
    return (
      <PanelWrapper onClose={() => setPanelOpen(false)}>
        <div style={{ textAlign: 'center', padding: 16, color: '#e67e22' }}>
          插件已更新，请刷新页面后使用
          <br />
          <button onClick={() => location.reload()} style={{ marginTop: 10, padding: '6px 16px', border: 'none', borderRadius: 6, background: '#0066ff', color: '#fff', cursor: 'pointer' }}>
            刷新页面
          </button>
        </div>
      </PanelWrapper>
    );
  }

  if (!pageInfo) {
    return (
      <PanelWrapper onClose={() => setPanelOpen(false)}>
        <div style={{ textAlign: 'center', padding: 16, color: '#888', fontSize: 13 }}>
          当前页面不是可导出的知乎内容
          <br />
          <span style={{ fontSize: 12, color: '#aaa' }}>支持：文章、回答、问题、想法、收藏夹、专栏</span>
        </div>
      </PanelWrapper>
    );
  }

  return (
    <PanelWrapper onClose={() => setPanelOpen(false)}>
      {pageInfo.type === 'collection' && collectionInfo && <CollectionPanel info={collectionInfo} />}
      {pageInfo.type === 'column' && collectionInfo && <ColumnPanel info={collectionInfo} />}
      {!['collection', 'column'].includes(pageInfo.type) && content && <ArticlePanel content={content} pageInfo={pageInfo} />}
    </PanelWrapper>
  );
}

function PanelWrapper({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Card
      title={<span style={{ color: '#0066ff', fontWeight: 600 }}>知乎文章下载器</span>}
      extra={<button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#999' }}>✕</button>}
      style={{
        position: 'fixed',
        right: 24,
        bottom: 160,
        width: 340,
        maxHeight: 480,
        overflow: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        zIndex: 2147483647,
      }}
      bodyStyle={{ padding: 16, maxHeight: 400, overflowY: 'auto' }}
    >
      {children}
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/
git commit -m "feat: 创建 Content Script 入口和 ContentApp 面板路由"
```

---

## Phase 5: Extension Page

### Task 21: Create Extension Page HTML + entry + main layout

**Files:**
- Modify: `src/export/index.html`
- Modify: `src/export/main.tsx`
- Create: `src/export/components/ExportManager.tsx`

- [ ] **Step 1: Update src/export/index.html**

Add Google Fonts links for the ink-wash theme:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>知乎导出管理器</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700;900&family=LXGW+WenKai:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Update src/export/main.tsx**

```tsx
// src/export/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { inkWashTheme } from '@/shared/theme/token';
import { setOnRetry } from '@/shared/api/throttle';
import { useUIStore } from '@/shared/stores/uiStore';
import { ExportManager } from './components/ExportManager';

// Wire throttle retry callback to UI store
setOnRetry((attempt, max, waitMs) => {
  const seconds = Math.round(waitMs / 1000);
  useUIStore.getState().addLog(`请求被限制，等待 ${seconds} 秒后重试（${attempt}/${max}）...`, 'warn');
  useUIStore.getState().setRetryInfo({ count: attempt, max, waitMs });
});

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={inkWashTheme}>
    <ExportManager />
  </ConfigProvider>
);
```

- [ ] **Step 3: Create ExportManager.tsx**

Main layout component that replaces `export.html`'s static markup:

```tsx
// src/export/components/ExportManager.tsx
import React from 'react';
import { Layout, Typography } from 'antd';
import styles from '@/shared/theme/ink-wash.module.css';
import { FolderPicker } from './FolderPicker';
import { FormatSelector } from './FormatSelector';
import { ArticleList } from './ArticleList';
import { CommentExport } from './CommentExport';
import { LogPanel } from './LogPanel';
import { useExportStore } from '@/shared/stores/exportStore';

const { Header, Content, Footer } = Layout;

export function ExportManager() {
  const params = new URLSearchParams(window.location.search);
  const collectionId = params.get('id') || '';
  const collectionName = params.get('name') || '未知';
  const collectionApiUrl = params.get('api') || '';
  const sourceType = (params.get('source') || 'collection') as 'collection' | 'column';
  const sourceLabel = sourceType === 'column' ? '专栏' : '收藏夹';
  const dirHandle = useExportStore((s) => s.dirHandle);

  React.useEffect(() => {
    document.title = `导出管理器 - ${sourceLabel} - ${collectionName}`;
  }, [sourceLabel, collectionName]);

  return (
    <Layout className={styles.inkWashBg} style={{ minHeight: '100vh' }}>
      <div className={styles.inkWash1} />
      <div className={styles.inkWash2} />
      <div className={styles.ricePaperTexture} />

      <Header style={{ background: 'transparent', textAlign: 'center', padding: '24px 0' }}>
        <div className={styles.sealMark}>藏</div>
        <Typography.Title level={2} style={{ margin: 0 }}>导出管理器</Typography.Title>
        <Typography.Text type="secondary">{sourceLabel}：{collectionName}</Typography.Text>
      </Header>

      <Content style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <FolderPicker collectionId={collectionId} collectionName={collectionName} />

        {dirHandle && (
          <>
            <FormatSelector />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
              <ArticleList
                collectionId={collectionId}
                collectionName={collectionName}
                collectionApiUrl={collectionApiUrl}
                sourceType={sourceType}
              />
              <CommentExport
                collectionId={collectionId}
                collectionName={collectionName}
              />
            </div>
            <LogPanel />
          </>
        )}
      </Content>

      <Footer style={{ textAlign: 'center', background: 'transparent' }}>
        <Typography.Text type="secondary">知乎导出工具</Typography.Text>
      </Footer>
    </Layout>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/export/
git commit -m "feat: 创建 Extension Page 入口和 ExportManager 主布局"
```

### Task 22: Create LogPanel component

**Files:**
- Create: `src/export/components/LogPanel.tsx`

- [ ] **Step 1: Create LogPanel.tsx**

```tsx
// src/export/components/LogPanel.tsx
import React, { useEffect, useRef } from 'react';
import { Card } from 'antd';
import { useUIStore } from '@/shared/stores/uiStore';

const levelColors: Record<string, string> = {
  info: 'inherit',
  warn: '#d69e2e',
  error: '#e53e3e',
  success: '#27ae60',
};

export function LogPanel() {
  const logs = useUIStore((s) => s.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Card title="操作日志" style={{ marginTop: 24 }}>
      <div
        ref={scrollRef}
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12,
          lineHeight: 1.8,
        }}
      >
        {logs.map((log, i) => (
          <div key={i}>
            <span style={{ color: '#aaa' }}>[{log.time}]</span>{' '}
            <span style={{ color: levelColors[log.level] }}>{log.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/export/components/LogPanel.tsx
git commit -m "feat: 创建 LogPanel 日志面板组件"
```

### Task 23: Create FolderPicker + FormatSelector components

**Files:**
- Create: `src/export/components/FolderPicker.tsx`
- Create: `src/export/components/FormatSelector.tsx`

- [ ] **Step 1: Create FolderPicker.tsx**

Handles folder selection, progress file reading, and reconciliation (port from `export.js` `handleSelectFolder` + `reconcileProgress`):

```tsx
// src/export/components/FolderPicker.tsx
import React from 'react';
import { Button, Card, Space, Typography } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import * as progress from '@/shared/utils/progress';
// reconcileProgress logic ported from export.js lines 229-324

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
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' } as DirectoryPickerOptions);
      setDirHandle(handle);
      addLog(`已选择文件夹：${handle.name}`, 'info');

      let progressData = await progress.readProgress(handle, collectionId);
      if (!progressData) {
        progressData = progress.createInitialProgress(collectionId, collectionName);
        addLog('未找到进度文件，将从头开始导出', 'info');
      }

      // TODO: reconcileProgress — port from export.js lines 229-324
      // Scan actual files to calibrate progress counters

      setProgressData(progressData);
      addLog(`已导出 ${progressData.articles.totalExported} 篇文章、${progressData.comments.totalExported} 篇评论`, 'info');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        addLog(`选择文件夹失败: ${err.message}`, 'error');
      }
    }
  };

  return (
    <Card style={{ marginTop: 24 }}>
      <Space>
        <Typography.Text>
          {dirHandle ? `📁 ${dirHandle.name}` : '未选择文件夹'}
        </Typography.Text>
        <Button icon={<FolderOpenOutlined />} onClick={handleSelectFolder}>
          {dirHandle ? '更换文件夹' : '选择文件夹'}
        </Button>
      </Space>
    </Card>
  );
}
```

The `reconcileProgress` function (port from `export.js:229-324`) should be extracted to `src/export/hooks/useExportProgress.ts` or as a standalone function in the FolderPicker. It scans the selected folder's articles directory, reads Front Matter from `.md` files to rebuild the exported IDs set, and calibrates the progress data.

- [ ] **Step 2: Create FormatSelector.tsx**

```tsx
// src/export/components/FormatSelector.tsx
import React from 'react';
import { Card, Radio, Checkbox, Space } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';

export function FormatSelector() {
  const format = useExportStore((s) => s.format);
  const setFormat = useExportStore((s) => s.setFormat);
  const docxImageMode = useExportStore((s) => s.docxImageMode);
  const setDocxImageMode = useExportStore((s) => s.setDocxImageMode);
  const wantImages = useExportStore((s) => s.wantImages);
  const setWantImages = useExportStore((s) => s.setWantImages);

  return (
    <Card title="导出格式" style={{ marginTop: 16 }}>
      <Space direction="vertical">
        <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)}>
          <Radio value="md">Markdown</Radio>
          <Radio value="docx">Word (.docx)</Radio>
        </Radio.Group>

        {format === 'md' && (
          <Checkbox checked={wantImages} onChange={(e) => setWantImages(e.target.checked)}>
            存图
          </Checkbox>
        )}

        {format === 'docx' && (
          <Radio.Group value={docxImageMode} onChange={(e) => setDocxImageMode(e.target.value)}>
            <Radio value="embed">嵌入图片到文档</Radio>
            <Radio value="link">图片使用外部链接</Radio>
          </Radio.Group>
        )}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/export/components/FolderPicker.tsx src/export/components/FormatSelector.tsx
git commit -m "feat: 创建 FolderPicker 和 FormatSelector 组件"
```

### Task 24: Create ArticleList component

**Files:**
- Create: `src/export/components/ArticleList.tsx`
- Source: `export.js` handleExportArticles (lines 521-698) + fetchDirectoryPages (lines 91-131)

- [ ] **Step 1: Create ArticleList.tsx**

This is the largest Extension Page component. Port the article export logic:

```tsx
// src/export/components/ArticleList.tsx
import React, { useCallback } from 'react';
import { Button, Card, Progress, Typography, Checkbox } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import * as zhihuApi from '@/shared/api/zhihu-api';
import * as exportUtils from '@/shared/utils/export-utils';
import * as progress from '@/shared/utils/progress';
import { htmlToMarkdown, extractImageUrls } from '@/shared/converters/html-to-markdown';
import { htmlToDocx } from '@/shared/converters/html-to-docx';
import type { ContentItem } from '@/types/zhihu';

interface Props {
  collectionId: string;
  collectionName: string;
  collectionApiUrl: string;
  sourceType: 'collection' | 'column';
}

export function ArticleList({ collectionId, collectionName, collectionApiUrl, sourceType }: Props) {
  const store = useExportStore();
  const addLog = useUIStore((s) => s.addLog);

  const handleExport = useCallback(async () => {
    if (store.isExportingArticles || !store.dirHandle || !store.progressData) return;
    store.setIsExportingArticles(true);

    // Port the full handleExportArticles logic from export.js lines 521-698
    // This includes:
    // 1. fetchDirectoryPages() — paginated directory fetch
    // 2. Per-item export (markdown or docx)
    // 3. Truncation detection + full content fetch
    // 4. Image download
    // 5. Progress persistence per article
    // 6. README.md generation

    try {
      // ... full export logic ...
      // Use addLog() instead of log()
      // Use store.setExportProgress() for progress updates
      // Use store.markArticleExported() after each article
    } catch (err: unknown) {
      addLog(`导出失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      store.setIsExportingArticles(false);
      store.setExportProgress(null);
    }
  }, [store, addLog, collectionId, collectionName, collectionApiUrl, sourceType]);

  const progressData = store.progressData;
  const exported = progressData?.articles.totalExported ?? 0;

  return (
    <Card title="文章导出">
      <Typography.Text>
        已导出 {exported} 篇
        {progressData?.articles.newestExportedTime && (
          <span>（截至 {new Date(progressData.articles.newestExportedTime).toLocaleDateString('zh-CN')}）</span>
        )}
      </Typography.Text>

      {store.exportProgress && (
        <Progress
          percent={Math.round((store.exportProgress.current / store.exportProgress.total) * 100)}
          size="small"
          style={{ marginTop: 8 }}
        />
      )}
      {store.exportProgress && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {store.exportProgress.text}
        </Typography.Text>
      )}

      <Button
        type="primary"
        block
        onClick={handleExport}
        loading={store.isExportingArticles}
        disabled={!store.dirHandle || !store.progressData}
        style={{ marginTop: 12 }}
      >
        {store.isExportingArticles ? '导出中...' : exported > 0 ? '导出全部（跳过已导出）' : '开始导出'}
      </Button>
    </Card>
  );
}
```

The handler function body should be a faithful port of `handleExportArticles` from `export.js`, using the new module imports instead of globals. Key mappings:
- `log(msg, type)` → `addLog(msg, type)`
- `showArticleProgress(...)` → `store.setExportProgress({ current, total, text })`
- `api.fetchCollectionPage` → `zhihuApi.fetchCollectionPage`
- `u.sanitizeFilename` → `exportUtils.sanitizeFilename`
- `progress.addExportedArticle` → `progress.addExportedArticle`

- [ ] **Step 2: Commit**

```bash
git add src/export/components/ArticleList.tsx
git commit -m "feat: 创建 ArticleList 文章导出组件"
```

### Task 25: Create CommentExport component

**Files:**
- Create: `src/export/components/CommentExport.tsx`
- Source: `export.js` handleExportComments (lines 741-844) + updateCommentUI (lines 363-485)

- [ ] **Step 1: Create CommentExport.tsx**

Port the comment export UI and logic. Uses Antd `Table` or `Checkbox.Group` for the article selection list:

```tsx
// src/export/components/CommentExport.tsx
import React, { useState, useMemo, useCallback } from 'react';
import { Button, Card, Checkbox, List, Progress, Tag, Typography } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import * as zhihuApi from '@/shared/api/zhihu-api';
import * as exportUtils from '@/shared/utils/export-utils';
import * as progress from '@/shared/utils/progress';
import { buildCommentsMarkdown } from '@/shared/converters/html-to-markdown';
import { commentsToDocx } from '@/shared/converters/html-to-docx';

interface Props {
  collectionId: string;
  collectionName: string;
}

export function CommentExport({ collectionId, collectionName }: Props) {
  const store = useExportStore();
  const addLog = useUIStore((s) => s.addLog);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [commentProgress, setCommentProgress] = useState<{ current: number; total: number; text: string } | null>(null);

  const progressData = store.progressData;
  const exportedIds = useMemo(() => new Set(progressData?.articles.exportedIds || []), [progressData]);
  const commentedSet = useMemo(() => new Set(progressData?.comments.exportedArticles || []), [progressData]);

  // Filter items to show only exported articles
  const availableItems = useMemo(
    () => store.items.filter((item) => item.id && exportedIds.has(item.id)),
    [store.items, exportedIds]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === availableItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableItems.map((i) => i.id)));
    }
  };

  const handleExportComments = useCallback(async () => {
    if (store.isExportingComments || !store.dirHandle || !progressData) return;
    const selected = availableItems.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) { addLog('未选择任何文章', 'warn'); return; }

    store.setIsExportingComments(true);

    // Port handleExportComments from export.js lines 741-844
    // Use addLog, setCommentProgress, store.markCommentExported

    try {
      // ... full comment export logic ...
    } catch (err: unknown) {
      addLog(`评论导出失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      store.setIsExportingComments(false);
      setCommentProgress(null);
    }
  }, [store, addLog, progressData, availableItems, selectedIds, collectionId, collectionName]);

  if (!progressData || progressData.articles.totalExported === 0) {
    return (
      <Card title="评论导出">
        <Typography.Text type="secondary">请先导出文章</Typography.Text>
      </Card>
    );
  }

  return (
    <Card title="评论导出">
      <Typography.Text>
        已导出 {progressData.comments.totalExported} / {progressData.articles.totalExported} 篇文章的评论
      </Typography.Text>

      <div style={{ marginTop: 12 }}>
        <Checkbox
          checked={selectedIds.size === availableItems.length && availableItems.length > 0}
          indeterminate={selectedIds.size > 0 && selectedIds.size < availableItems.length}
          onChange={selectAll}
          disabled={store.isExportingComments}
        >
          全选
        </Checkbox>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
          已选 {selectedIds.size} 篇
        </Typography.Text>
      </div>

      <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
        {availableItems.map((item) => (
          <div key={item.id} style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelect(item.id)}
              disabled={store.isExportingComments}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title || `${item.author}的${exportUtils.TYPE_LABELS[item.type] || item.type}`}
            </span>
            {commentedSet.has(item.id) && <Tag color="green" style={{ fontSize: 11 }}>已导出</Tag>}
          </div>
        ))}
      </div>

      {commentProgress && (
        <Progress
          percent={Math.round((commentProgress.current / commentProgress.total) * 100)}
          size="small"
          style={{ marginTop: 8 }}
        />
      )}

      <Button
        type="primary"
        block
        onClick={handleExportComments}
        loading={store.isExportingComments}
        disabled={selectedIds.size === 0 || store.isExportingComments}
        style={{ marginTop: 12 }}
      >
        {store.isExportingComments ? '导出中...' : selectedIds.size > 0 ? `导出选中的 ${selectedIds.size} 篇评论` : '请选择要导出评论的文章'}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/export/components/CommentExport.tsx
git commit -m "feat: 创建 CommentExport 评论导出组件"
```

---

## Phase 6: Integration + Cleanup

### Task 26: Build verification + fix CRXJS issues

**Files:**
- Possibly modify: `vite.config.ts`, `src/manifest.ts`, various components

- [ ] **Step 1: Run full build**

```bash
npm run build
```

- [ ] **Step 2: Fix any TypeScript errors**

Resolve all `tsc` errors. Common issues:
- Missing type imports
- `@types/chrome` API surface mismatches
- `FileSystemDirectoryHandle` types (may need `lib: ["ES2021"]` in tsconfig)
- CSS Module type declarations (create `src/types/css.d.ts` with `declare module '*.module.css'`)

- [ ] **Step 3: Fix CRXJS-specific issues**

Common CRXJS issues to watch for:
- Content script `import()` dynamic imports — if CRXJS doesn't support them, make docx imports static
- `web_accessible_resources` paths — CRXJS transforms paths, verify `fetch-bridge.js` is accessible
- Extension page HTML path in manifest

- [ ] **Step 4: Load extension in Chrome**

```
1. Open chrome://extensions
2. Enable Developer mode
3. Load unpacked → select dist/ folder
4. Navigate to a zhihu article page
5. Verify FAB appears and panel opens
```

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: 修复构建和 CRXJS 集成问题"
```

### Task 27: End-to-end smoke test + cleanup

- [ ] **Step 1: Test single article export (Markdown)**

Navigate to a zhihu article → click FAB → select Markdown → click Download → verify `.md` file

- [ ] **Step 2: Test single article export (Word)**

Same flow with Word format → verify `.docx` file

- [ ] **Step 3: Test collection export manager**

Navigate to a collection page → click FAB → click "打开导出管理器" → verify Extension Page opens with correct collection info

- [ ] **Step 4: Test batch export in export manager**

Select folder → start article export → verify files are created and progress updates

- [ ] **Step 5: Test comment export**

After article export → select articles for comment export → verify comment files

- [ ] **Step 6: Test 403 retry UI**

Verify retry callback shows warning in logs and UI when rate-limited

- [ ] **Step 7: Remove old source files**

Once everything works, remove the old vanilla JS source files. Keep them in git history:

```bash
rm -rf content/ export/ lib/ background.js icons/
rm -f manifest.json
```

**Note:** Only remove old files after confirming all functionality works in the new build.

- [ ] **Step 8: Update .gitignore**

Ensure `node_modules/` and `dist/` are ignored.

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore: 移除旧版原生 JS 源文件，完成 React + Antd 重构"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1 | Project scaffolding (Vite + CRXJS + TS) |
| 2 | 2-10 | Type definitions + shared pure logic migration (9 modules) |
| 3 | 11-13 | Theme + stores + background service worker |
| 4 | 14-20 | Content Script (detector, Shadow DOM, FAB, panels) |
| 5 | 21-25 | Extension Page (export manager, 6 components) |
| 6 | 26-27 | Integration, build fixes, smoke tests, cleanup |

Total: **27 tasks** across 6 phases. Each phase can be built and partially tested independently.

**Critical path:** Phase 1 → Phase 2 (types + logic) → Phase 3 (stores) → then Phase 4 and Phase 5 can be developed in parallel.
