# 收藏夹分批导出 + 独立评论导出 设计文档

## 背景

当前收藏夹导出功能在导出大量文章时，评论 API 请求密集，容易触发知乎 403 限制。用户希望能按时间线分批导出，方便大型收藏夹逐步归档，同时将评论导出拆分为独立功能以降低请求压力。

## 核心决策

| 决策项 | 结论 |
|--------|------|
| 导出方式 | 去掉 ZIP 模式，只保留文件夹模式 |
| 分批策略 | 按时间线从旧到新分批导出 |
| 时间基准 | 收藏时间（文章被加入收藏夹的时间） |
| 默认批次大小 | 50 篇，用户可自定义 |
| 评论导出 | 与文章导出完全独立，单独区域、单独进度 |
| 进度存储 | 写入用户导出文件夹的 `export-progress.json` |
| 请求节流 | 自动节流（500ms 间隔）+ 403 指数退避重试 |
| UI 载体 | Extension Page（独立标签页），浮窗收藏夹面板简化为跳转入口 |
| UI 风格 | 引入 Pico CSS 轻量框架 |
| 单篇下载 | 保留在浮窗中，不迁移 |

## 架构设计

### 整体流程

```
用户在知乎收藏夹页面
    ↓
浮窗识别到收藏夹 → 简化面板（名称 + "打开导出管理器"按钮）
    ↓ 点击按钮
打开 Extension Page（chrome-extension://xxx/export.html?id=xxx&name=xxx&api=xxx）
    ↓
导出管理器页面：文章导出区 + 评论导出区
    ↓
进度文件 (export-progress.json) 存储在用户选择的文件夹中
```

### 执行上下文与模块复用

**关键架构决策：** Extension Page 和 content script 是不同的执行上下文。Extension Page 拥有独立的 JS 环境，不能直接访问 content script 注入的 `window.__zhihuDownloader` 等全局对象。

**解决方案：** 将现有 `detector.js` 中的 API 调用逻辑（收藏夹分页、评论获取）抽取为独立的 ES 模块 `lib/zhihu-api.js`，供 Extension Page 直接 import 使用。Extension Page 通过 `host_permissions` 直接调用知乎 API，不依赖 content script 做中转。

**模块划分：**

- `lib/zhihu-api.js`（新增）：从 `detector.js` 抽取的纯 API 调用层（fetchCollectionPage、fetchAllComments 等），使用 `throttledFetch` 替代原始 `fetch`
- `content/detector.js`（修改）：页面检测和内容提取保留，API 调用改为引用 `lib/zhihu-api.js`（content script 上下文通过 script 标签加载）
- `lib/html-to-markdown.js`（现有）：纯函数，Extension Page 可直接加载
- `lib/turndown.js`（现有）：Extension Page 可直接加载
- `content/export-utils.js`（现有）：图片下载和文件操作，Extension Page 可直接加载

Extension Page 的 `export.html` 通过 `<script>` 标签加载所需的 lib 模块，与 content script 共享同一份代码，不做重复实现。

### 文件结构变化

**新增：**

```
├── export/                        # Extension Page
│   ├── export.html               # 导出管理器页面
│   ├── export.js                 # 页面主逻辑
│   └── export.css                # 自定义样式（配合 Pico CSS）
├── lib/
│   ├── pico.min.css              # 轻量 CSS 框架
│   ├── zhihu-api.js              # 从 detector.js 抽取的 API 调用层
│   ├── throttle.js               # 请求节流 + 403 重试
│   └── progress.js               # 进度文件读写管理
```

**修改：**

- `content/detector.js`：API 调用逻辑抽取到 `lib/zhihu-api.js`，本文件保留页面检测和内容提取
- `content/collection-panel.js`：简化为基本信息 + 跳转按钮
- `manifest.json`：注册 Extension Page

**删除：**

- `collection-panel.js` 中的 `handleCollectionExport()`（ZIP 模式）
- `collection-panel.js` 中的 `handleCollectionExportToFolder()`（文件夹模式）
- 收藏夹面板中的选项 UI（Front Matter、下载图片、导出评论复选框，导出方式单选按钮）
- `lib/jszip.min.js`：ZIP 模式已移除，不再需要
- `manifest.json` 中对 `jszip.min.js` 的引用

## 模块设计

### 1. 请求节流模块 (`lib/throttle.js`)

**职责：** 统一的 API 请求节流和错误重试。

**核心 API：**

```javascript
throttledFetch(url, options) → Promise<Response>
```

**机制：**

- 请求间隔：每个 API 请求之间至少 500ms
- 403 重试：指数退避，30s → 60s → 120s，最多 3 次
- 全局队列：所有 API 请求（收藏夹分页、评论分页）共享同一队列
- 进度回调：重试时通过回调通知 UI（如 "请求被限制，等待 30 秒后重试（1/3）..."）

**集成方式：** `lib/zhihu-api.js` 中的 API 调用使用 `throttledFetch()` 替代原始 `fetch()`。Extension Page 和 content script 共享同一个 `throttle.js` 模块。在 Extension Page 中，所有 API 请求直接从页面发出（通过 `host_permissions` 授权），不经过 content script。

### 2. 进度管理模块 (`lib/progress.js`)

**职责：** 进度文件的读写管理。

**进度文件结构（`export-progress.json`）：**

```json
{
  "collectionId": "123456",
  "collectionName": "我的收藏夹",
  "articles": {
    "newestExportedTime": "2025-06-15T10:30:00Z",
    "totalAtLastExport": 500,
    "nextOffset": 351,
    "totalExported": 150,
    "batchSize": 50
  },
  "comments": {
    "exportedArticles": ["article-id-1", "article-id-2"],
    "totalExported": 80
  }
}
```

**核心 API：**

```javascript
readProgress(dirHandle) → ProgressData | null
writeProgress(dirHandle, progressData)
updateArticleProgress(dirHandle, newestTime, batchCount, currentTotal, nextOffset)
updateCommentProgress(dirHandle, articleId)
```

**关键设计：**

- 每批文章导出完成后立即更新进度文件，中途中断不丢进度
- 评论通过 `exportedArticles` 数组记录已导出的文章 ID（对于数千篇的大型收藏夹，此数组可能较大，但作为 JSON 字符串存储开销可控）
- 首次打开无进度文件时自动创建

### 3. Extension Page (`export/`)

**数据传递：** 浮窗通过 URL 参数传递收藏夹信息：

```javascript
chrome.runtime.getURL(
  `export/export.html?id=${collectionId}&name=${encodeURIComponent(name)}&api=${encodeURIComponent(apiUrl)}`
)
```

**页面布局：**

```
┌──────────────────────────────────────────────────────┐
│  知乎收藏夹导出管理器                                  │
│  收藏夹：[收藏夹名称]                                  │
│                                                       │
│  ┌─ 选择导出文件夹 ─────────────────────────────────┐  │
│  │  📁 路径显示                                     │  │
│  │  [选择文件夹]                                     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ 文章导出 ───────────────────────────────────────┐  │
│  │  已导出 150 / 500 篇  （截至 2025-06-15）         │  │
│  │  ████████████████░░░░░░░░  30%                    │  │
│  │  每批数量: [50] 篇                                │  │
│  │  ☑ 包含 Front Matter    ☑ 下载图片到本地          │  │
│  │  [继续导出下一批]                                  │  │
│  │  状态：正在导出第 3/50 篇...                       │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─ 评论导出 ───────────────────────────────────────┐  │
│  │  已导出 80 / 150 篇文章的评论                     │  │
│  │  ██████████████░░░░░░░░░  53%                    │  │
│  │  每批数量: [50] 篇                                │  │
│  │  [继续导出评论]                                    │  │
│  │  状态：等待中                                      │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**按钮状态变化：**

| 状态 | 文章按钮 | 评论按钮 |
|------|---------|---------|
| 首次 | 开始导出 | 开始导出评论 |
| 有进度 | 继续导出下一批 | 继续导出评论 |
| 导出中 | 导出中...（禁用） | 导出中...（禁用） |
| 全部完成 | 已全部导出 ✓ | 已全部导出 ✓ |
| 有新增 | 导出新增内容（N 篇） | 导出新增评论（N 篇） |

**打开时自动检测：** 请求收藏夹总数，对比进度文件中的已导出数，有新增则在按钮上提示。

### 4. 收藏夹浮窗面板简化 (`collection-panel.js`)

**简化后：**

```
┌─ Panel Header ───────────────────┐
│ 知乎文章下载器           ✕      │
├──────────────────────────────────┤
│ 类型:    [收藏夹]                │
│ 名称:    收藏夹名称              │
│ 数量:    N 篇                    │
│ ─────────────────────────────────│
│ [打开导出管理器]                 │
└──────────────────────────────────┘
```

删除所有导出逻辑和选项 UI，只保留信息展示 + 跳转按钮。

## 核心算法

### 文章导出定位算法

知乎收藏夹 API 返回从新到旧排序。要实现从旧到新的分批导出：

1. 获取当前收藏夹总数 `currentTotal`
2. 从进度文件读取 `totalAtLastExport` 和 `nextOffset`
3. 计算调整后的 offset：`adjustedOffset = nextOffset + (currentTotal - totalAtLastExport)`
4. 从 `adjustedOffset` 位置开始分页读取
5. **时间戳兜底**：逐篇对比收藏时间
   - 收藏时间 <= `newestExportedTime` → 跳过
   - 收藏时间 > `newestExportedTime` → 导出
6. 凑够 batchSize 或到达列表末尾 → 停止
7. 更新进度文件

offset 推算只是快速定位的优化手段，时间戳才是判断是否已导出的最终依据。即使 offset 偏移了几页，也只是多读几页空跑，不会漏导或重复导出。

### 评论导出流程

1. 扫描文件夹中已有的文章 Markdown 文件（匹配 `*.md` 排除 `*-评论.md` 和 `README.md`），从文件的 Front Matter 或文件名提取文章 ID
2. 对比进度文件中的 `exportedArticles`，找出未导出评论的文章
3. 显示 "已导出 M / N 篇文章的评论"
4. 用户点击导出 → 分批处理（每批 50 篇的评论）
5. 每篇文章的评论导出完成后立即更新进度文件
6. 请求经过 throttle 模块统一节流

## 权限变更

`manifest.json` 需要：

- 注册 `export/export.html` 为 Extension Page
- 确保 `host_permissions` 覆盖知乎 API 域名（现有配置应已满足）
- File System Access API 不需要额外权限（由用户交互触发）
