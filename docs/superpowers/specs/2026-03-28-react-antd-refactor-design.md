# React + Ant Design 重构设计文档

## 概述

将 DownloadZhihu Chrome 扩展从纯原生 JS（~4,500 行，无构建工具）重构为 React + Ant Design 架构。目标是提升可维护性、UI/UX 质量，并为后续新功能开发打下基础。

## 技术栈

| 项 | 选择 | 说明 |
|---|---|---|
| 框架 | React 18 + TypeScript | 组件化 + 类型安全 |
| UI 库 | Ant Design 5.x | CSS-in-JS，支持 Shadow DOM 样式注入 |
| 状态管理 | Zustand | 轻量，支持 React 外部访问 |
| 构建工具 | Vite + CRXJS | HMR 热更新，CRXJS 处理 MV3 扩展打包 |
| 包管理 | npm | 所有依赖 npm 化（turndown、jszip、docx、temml、mathml2omml） |
| fetch-bridge | 保持原生 JS | 不参与打包，作为 web_accessible_resources 静态复制 |

## 项目结构

```
src/
├── manifest.ts                    # CRXJS manifest 定义
├── background/
│   └── index.ts                   # Service Worker（消息中转）
├── content/
│   ├── index.tsx                  # Content Script 入口，注入 FAB
│   ├── fetch-bridge.js            # 原生 JS，web_accessible_resources
│   ├── detector.ts                # 页面检测 + 内容提取（纯逻辑，无 UI）
│   ├── components/
│   │   ├── FloatingButton.tsx     # FAB 悬浮按钮（可拖拽，位置持久化）
│   │   ├── PanelHost.tsx          # Shadow DOM 宿主 + Antd StyleProvider
│   │   ├── ArticlePanel.tsx       # 文章/回答/想法导出面板
│   │   ├── CollectionPanel.tsx    # 收藏夹面板
│   │   └── ColumnPanel.tsx        # 专栏面板
│   └── hooks/
│       ├── usePageDetect.ts       # 检测当前页面类型和内容
│       └── useFolderHandle.ts     # IndexedDB 文件夹句柄持久化
├── export/
│   ├── index.html                 # Extension Page HTML 入口
│   ├── main.tsx                   # Extension Page React 入口
│   ├── components/
│   │   ├── ExportManager.tsx      # 主布局容器
│   │   ├── FolderPicker.tsx       # 文件夹选择器（File System Access API）
│   │   ├── FormatSelector.tsx     # 导出格式选择（MD / Word）
│   │   ├── ArticleList.tsx        # 文章列表（含导出进度、跳过已导出）
│   │   ├── CommentExport.tsx      # 评论导出区（勾选列表 + 批量导出）
│   │   └── LogPanel.tsx           # 日志面板（时间戳 + 颜色分级）
│   └── hooks/
│       └── useExportProgress.ts   # 导出进度管理（读写 JSON 文件）
├── shared/
│   ├── api/
│   │   ├── zhihu-api.ts           # 知乎 API 封装（收藏夹、专栏、评论、全文）
│   │   ├── throttle.ts            # 请求节流 + 403 指数退避重试
│   │   └── proxy-fetch.ts         # Extension Page → content script 代理请求
│   ├── converters/
│   │   ├── html-to-markdown.ts    # Turndown + 知乎自定义规则
│   │   ├── html-to-docx.ts        # docx 库构建 Word 文档
│   │   └── zhihu-html-utils.ts    # 知乎特有 HTML 元素识别（公式、视频、链接卡片等）
│   ├── stores/
│   │   ├── exportStore.ts         # 导出状态（文件夹、格式、进度、文章列表）
│   │   └── uiStore.ts             # UI 状态（面板开关、日志、限流提示）
│   ├── utils/
│   │   ├── export-utils.ts        # 文件写入、图片批量下载、frontmatter 生成
│   │   └── progress.ts            # 进度 JSON 文件读写 + 迁移逻辑
│   └── theme/
│       ├── token.ts               # Antd ConfigProvider 自定义 token（水墨配色）
│       └── ink-wash.module.css    # 水墨纹理效果（宣纸、墨点）
├── types/
│   └── zhihu.ts                   # 知乎 API 响应类型、内容条目类型
└── assets/
    └── icons/                     # 扩展图标（icon16/48/128）
```

## 架构设计

### 1. 三个打包入口

CRXJS 根据 manifest 定义自动生成打包入口：

| 入口 | 源文件 | 产物 | 说明 |
|------|--------|------|------|
| Content Script | `src/content/index.tsx` | 注入知乎页面的 JS bundle | 包含 React、Antd、FAB、面板组件 |
| Extension Page | `src/export/main.tsx` | 导出管理器 SPA | 独立标签页 |
| Service Worker | `src/background/index.ts` | background.js | 无 UI，纯消息中转 |

`fetch-bridge.js` 不参与打包，在 Vite 配置中作为静态资源复制到产物目录，并在 manifest 中声明为 `web_accessible_resources`。

### 2. Shadow DOM + Ant Design 样式注入

Content Script 的所有 UI 运行在 Shadow DOM 中以隔离知乎页面样式。Antd 5 的 CSS-in-JS 方案通过 `@ant-design/cssinjs` 的 `StyleProvider` 将样式注入 Shadow Root 而非 `document.head`：

```tsx
// PanelHost.tsx
import { StyleProvider, createCache } from '@ant-design/cssinjs';
import { ConfigProvider } from 'antd';
import { inkWashTheme } from '@/shared/theme/token';

export function PanelHost({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shadowContainer, setShadowContainer] = useState<HTMLElement | null>(null);
  const cacheRef = useRef(createCache());

  useEffect(() => {
    if (!hostRef.current) return;
    const shadowRoot = hostRef.current.attachShadow({ mode: 'closed' });
    const container = document.createElement('div');
    shadowRoot.appendChild(container);
    setShadowContainer(container);
  }, []);

  return (
    <>
      <div ref={hostRef} />
      {shadowContainer &&
        createPortal(
          <StyleProvider container={shadowContainer.getRootNode() as ShadowRoot} cache={cacheRef.current}>
            <ConfigProvider theme={inkWashTheme}>
              {children}
            </ConfigProvider>
          </StyleProvider>,
          shadowContainer
        )
      }
    </>
  );
}
```

Content Script 入口 `index.tsx` 在知乎页面创建一个宿主 `<div>`，将 `PanelHost` 渲染到 `document.body`。

### 3. 消息通信架构

通信拓扑保持不变，用 TypeScript 类型化消息：

```
页面 JS (fetch-bridge.js) ←CustomEvent→ Content Script (detector.ts)
Content Script ←chrome.runtime.sendMessage→ Service Worker (background)
Service Worker ←chrome.tabs.sendMessage→ Content Script
Extension Page ←chrome.runtime.sendMessage→ Service Worker
```

消息类型定义：

```typescript
// types/messages.ts
type ExtensionMessage =
  | { action: 'openExportPage'; url: string }
  | { action: 'injectDocxLibs' }
  | { action: 'proxyFetch'; url: string; responseType?: 'text' | 'json'; options?: RequestInit }

type ProxyResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number }
```

React 组件不直接发送消息，而是调用 `shared/api/` 层的 async 函数，通信细节被封装。

### 4. Zustand Store 设计

```typescript
// shared/stores/exportStore.ts
interface ExportState {
  // 状态
  dirHandle: FileSystemDirectoryHandle | null;
  format: 'md' | 'docx';
  items: ContentItem[];
  exportedIds: Set<string>;
  isExporting: boolean;
  exportProgress: { current: number; total: number } | null;

  // 操作
  setDirHandle: (handle: FileSystemDirectoryHandle) => void;
  setFormat: (format: 'md' | 'docx') => void;
  setItems: (items: ContentItem[]) => void;
  markExported: (id: string) => void;
  startExport: (selectedIds: string[]) => Promise<void>;
  startCommentExport: (selectedIds: string[]) => Promise<void>;
}

// shared/stores/uiStore.ts
interface UIState {
  panelOpen: boolean;
  logs: LogEntry[];
  retryInfo: { count: number; max: number; waitMs: number } | null;

  togglePanel: () => void;
  addLog: (message: string, level: 'info' | 'warn' | 'error' | 'success') => void;
  clearLogs: () => void;
  setRetryInfo: (info: UIState['retryInfo']) => void;
}
```

Content Script 和 Extension Page 各自实例化独立的 store（它们运行在不同的 JS 上下文中）。

### 5. 水墨主题 Token

```typescript
// shared/theme/token.ts
import type { ThemeConfig } from 'antd';

export const inkWashTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2c3e50',      // 墨色
    colorSuccess: '#27ae60',      // 竹青
    colorWarning: '#d69e2e',      // 赭石
    colorError: '#c0392b',        // 朱红
    colorBgBase: '#f5f0e8',       // 宣纸
    colorBgContainer: '#faf6ef',  // 宣纸浅
    colorBorder: '#d4c5a9',       // 枯叶
    colorText: '#2c3e50',         // 墨色
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

水墨纹理效果（宣纸背景纹理、墨点装饰）通过 CSS Module（`ink-wash.module.css`）叠加到容器组件上，不修改 Antd 组件内部样式。

### 6. 关键组件职责

**Content Script 侧：**

| 组件 | 职责 |
|------|------|
| `FloatingButton` | 可拖拽 FAB，位置存 localStorage，点击切换面板 |
| `PanelHost` | Shadow DOM 创建 + Antd 样式注入 + 主题配置 |
| `ArticlePanel` | 显示文章信息、导出选项（格式/图片/评论/frontmatter），触发下载或保存到文件夹 |
| `CollectionPanel` | 显示收藏夹信息 + 文章数，点击按钮打开导出管理器 |
| `ColumnPanel` | 显示专栏信息 + 文章数，点击按钮打开导出管理器 |

**Extension Page 侧：**

| 组件 | 职责 |
|------|------|
| `ExportManager` | 主布局：header + 内容区 + footer，水墨背景 |
| `FolderPicker` | 文件夹选择 + 权限验证（File System Access API） |
| `FormatSelector` | 导出格式（MD/Word）、图片选项 |
| `ArticleList` | 文章列表 + 导出进度条 + 已导出标记 + 导出按钮 |
| `CommentExport` | 评论文章勾选列表（全选/反选）+ 批量导出评论 |
| `LogPanel` | 时间戳日志流，颜色分级（info/warn/error/success） |

### 7. 纯逻辑模块迁移策略

以下模块迁移为 TypeScript 但保持纯函数/类，不依赖 React：

| 模块 | 迁移方式 |
|------|----------|
| `zhihu-api.ts` | 添加类型定义，移除 `window.__zhihuApi` 挂载，改为 ES module export |
| `throttle.ts` | 添加类型，改为 ES module export |
| `detector.ts` | 保持 DOM 操作逻辑不变，添加返回类型定义 |
| `html-to-markdown.ts` | Turndown 改为 npm import，添加类型 |
| `html-to-docx.ts` | docx 改为 npm import，添加类型 |
| `zhihu-html-utils.ts` | 纯函数，直接添加类型 |
| `export-utils.ts` | 添加类型，移除 `window.__exportUtils` 挂载 |
| `progress.ts` | 添加类型 |

所有 `window.__xxx` 全局挂载改为 ES module 的 `import/export`。

### 8. fetch-bridge 保持策略

`fetch-bridge.js` 保持原生 JS 不参与打包：

- 放在 `src/content/fetch-bridge.js`
- Vite 配置中通过 `vite-plugin-static-copy` 或 CRXJS 的 `web_accessible_resources` 配置复制到产物目录
- Content Script 运行时通过 `document.createElement('script')` 注入到页面 DOM
- 通信机制（CustomEvent `__zhihu_dl_fetch_request` / `__zhihu_dl_fetch_response`）保持不变
- `detector.ts` 中的 `pageFetch` 函数封装通信细节

### 9. docx 相关库加载策略

当前方案（`injectDocxLibs` 按需注入）改为：

- `docx`、`temml`、`mathml2omml` 作为 npm 依赖安装
- 在 `html-to-docx.ts` 中直接 `import`
- 利用 Vite 的 code splitting，这些库会被打包到单独的 chunk 中
- Content Script 入口通过 `import()` 动态导入 `html-to-docx.ts`，实现按需加载
- 移除 `background.js` 中的 `injectDocxLibs` 消息处理逻辑

注意：CRXJS 对 content script 的动态 import 支持需要验证。如果不支持，则回退到在 content script bundle 中包含这些依赖（增大 bundle 体积但简化架构）。

### 10. 错误处理和限流提示

将当前的错误处理增强集成到 React 组件中：

- `throttle.ts` 的 `onRetryCallback` 更新 `uiStore.retryInfo`
- 面板组件监听 `retryInfo` 变化，用 Antd 的 `message.warning` 或内联提示显示限流等待倒计时
- 403 错误在 `LogPanel` 中高亮显示，附带"请在知乎页面完成验证码"的操作提示
- `fetchAllComments` 的 `partialComments` 支持部分导出

## 不变的部分

- Manifest V3 结构和权限配置
- 消息通信拓扑（三层代理链）
- fetch-bridge 的页面上下文注入机制
- 知乎 API 端点和分页逻辑
- HTML → Markdown / HTML → Word 的转换规则
- 导出进度 JSON 文件格式（向后兼容）
- 扩展图标

## 风险点

1. **CRXJS + MV3 content script 动态 import**：CRXJS 对 content script 中 `import()` 的支持可能有限。需要在搭建阶段验证。不支持则将 docx 相关库静态打包进 content script bundle。
2. **Shadow DOM + Antd StyleProvider**：`@ant-design/cssinjs` 的 `container` 选项需要指向 Shadow Root。已有社区实践，但需注意 Antd 组件的 Portal（如 Dropdown、Modal、Tooltip）会默认渲染到 `document.body`，需通过 `ConfigProvider` 的 `getPopupContainer` 重定向到 Shadow DOM 内部。
3. **Content Script bundle 体积**：React + Antd 会显著增大 content script 的体积。可通过 Antd 的 tree-shaking（按需引入组件）和 Vite 的代码分割缓解。预估 content script bundle 约 200-400KB（gzipped ~60-120KB）。
4. **Google Fonts 加载**：Extension Page 的中文字体（Noto Serif SC、LXGW WenKai）依赖外网加载。如果用户网络受限可能影响字体显示。可考虑内置字体子集或改为系统字体 fallback。
