# 知乎文章下载器

一键将知乎内容导出为 Markdown 或 Word (.docx) 文件的 Chrome 扩展。支持文章、回答、问题、想法、收藏夹、专栏六种内容类型，自动下载图片、导出评论区。

## 功能特性

- **多类型支持** — 文章、回答、问题、想法、收藏夹、专栏一键导出
- **个人主页导出** — 导出本人主页（`/people/:token`）的文章、回答、想法
- **导出管理器** — 独立的 Extension Page，支持收藏夹、专栏和个人主页的批量导出管理
- **按时间线导出** — 从旧到新按时间线导出，支持增量导出（只导出新增内容）
- **评论区导出** — 文章列表勾选式评论导出，显示作者、类型、收藏时间、评论数量
- **进度持久化** — 导出进度保存在文件夹中，中断后可继续，多收藏夹互不冲突
- **流式导出** — 逐页拉取逐页处理，无需等待全部目录加载完成
- **请求节流** — 自动控制请求频率（500ms 间隔），403 时指数退避重试
- **高质量转换** — 完整保留数学公式、代码块、表格、脚注、链接卡片
- **图片本地化** — 自动下载文章和评论中的图片，存入本地文件夹
- **Front Matter** — 自动生成 YAML 元数据（id、标题、作者、来源、日期）
- **浮动按钮** — 知乎页面内直接显示可拖拽按钮，无需打开弹窗
- **零配置** — 无需登录、无需 API Key，打开知乎页面直接使用
- **隐私安全** — 纯本地运行，不收集任何用户数据

## 安装方式

### 从 GitHub Release 下载

1. 前往 [Releases](../../releases) 页面下载最新版 ZIP 包
2. 解压到一个固定位置（不要删除解压后的文件夹）
3. 打开 Chrome，访问 `chrome://extensions/`
4. 右上角开启 **开发者模式**
5. 点击 **加载已解压的扩展程序**，选择解压后的文件夹

### 从源码构建

1. 克隆本仓库
2. 安装依赖并构建：
   ```bash
   npm ci
   npm run build
   ```
3. 打开 Chrome，访问 `chrome://extensions/`
4. 开启右上角 **开发者模式**
5. 点击 **加载已解压的扩展程序**，选择 `dist/` 目录

## 使用方法

### 本地自动导出（无需安装扩展）

本方式不需要在 Chrome 扩展页加载插件，也不需要点击知乎页面右下角按钮。安装依赖后直接传入知乎链接，脚本会抓取页面、提取正文、下载图片并输出 Markdown 文件。

```bash
npm ci
npm run export:local -- https://zhuanlan.zhihu.com/p/123456
```

默认输出到 `exports/` 目录。也可以批量导出：

```bash
npm run export:local -- --input urls.txt --out ./zhihu-export
```

`urls.txt` 每行一个知乎链接，空行和 `#` 开头的注释会被忽略。当前本地自动导出支持文章、回答、问题、想法、收藏夹页面，以及用户主页的回答、文章、专栏内容。收藏夹会导出到 `输出目录/收藏夹名称/articles/`，并生成 `README.md` 索引。

导出收藏夹示例：

```bash
npm run export:local -- https://www.zhihu.com/collection/825550242 --out ./zhihu-export
```

导出某个用户的公开内容：

```bash
# 导出全部回答
npm run export:local -- https://www.zhihu.com/people/mr-dang-77/answers --out ./zhihu-export --cookie-file ./cookie.txt

# 导出全部文章
npm run export:local -- https://www.zhihu.com/people/mr-dang-77/posts --out ./zhihu-export --cookie-file ./cookie.txt

# 导出全部专栏内容（先读取该用户的专栏列表，再逐个导出专栏文章）
npm run export:local -- https://www.zhihu.com/people/mr-dang-77/columns --out ./zhihu-export --cookie-file ./cookie.txt

# 也可以传用户主页根路径，一次顺序导出回答、文章、专栏
npm run export:local -- https://www.zhihu.com/people/mr-dang-77 --out ./zhihu-export --cookie-file ./cookie.txt
```

用户主页导出的目录结构示例：

```text
zhihu-export/
└── mr-dang-77/
    ├── README.md
    ├── 回答/
    │   ├── README.md
    │   └── articles/
    ├── 文章/
    │   ├── README.md
    │   └── articles/
    └── 专栏/
        ├── README.md
        └── 专栏名称/
            ├── README.md
            └── articles/
```

如果页面需要登录后才能看到完整内容，可以传入浏览器中的 Cookie：

```bash
npm run export:local -- https://zhuanlan.zhihu.com/p/123456 --cookie "z_c0=..."
npm run export:local -- https://www.zhihu.com/collection/825550242 --out ./zhihu-export --cookie-file ./cookie.txt
```

#### 快速获取 Cookie

不要在 Application 面板的 Cookie 表格里逐项复制。更快的方式是从 Network 请求里一次性复制完整 `Cookie` 请求头：

1. 在 Chrome 中打开要导出的知乎收藏夹页面，例如 `https://www.zhihu.com/collection/825550242`。
2. 打开开发者工具，进入 `Network` 面板。
3. 刷新页面。
4. 在请求列表里点击一个知乎请求，优先选择 `api/v4/collections/825550242/items...`；如果没有看到，任意 `www.zhihu.com` 请求通常也可以。
5. 在右侧 `Headers` 中找到 `Request Headers` 里的 `Cookie: ...`。
6. 只复制 `Cookie:` 后面的整段内容，不要包含 `Cookie:` 这个字段名。
7. 在项目根目录创建 `cookie.txt`，把复制到的一整行 Cookie 粘贴进去。

`cookie.txt` 示例格式如下：

```text
z_c0=...; _xsrf=...; d_c0=...; q_c1=...; SESSIONID=...; JOID=...; osd=...; _zap=...; __zse_ck=...
```

然后运行：

```bash
npm run export:local -- https://www.zhihu.com/collection/825550242 --out ./zhihu-export --cookie-file ./cookie.txt
```

也可以在 `Network` 面板中右键请求，选择 `Copy` → `Copy as cURL`，再从复制出的命令里取出 `-H 'cookie: ...'` 后面的 Cookie 内容。`z_c0` 是知乎登录凭证，请只保存在本机，不要提交到 Git，也不要发给别人。

如果命令提示 `HTTP 401` 或 `HTTP 403`，通常表示 Cookie 没有带上、已过期、复制不完整，或当前账号没有该收藏夹访问权限。重新打开知乎确认已登录，再按上面的 Network 方法复制一次即可。

常用参数：

| 参数 | 说明 |
|------|------|
| `--out <dir>` | 指定输出目录，默认 `exports/` |
| `--input <file>` | 从文本文件读取多个 URL |
| `--cookie <cookie>` | 为请求附加原始 Cookie |
| `--cookie-file <file>` | 从文件读取原始 Cookie |
| `--no-images` | 只导出 Markdown，不下载图片 |
| `--max-pages <n>` | 只拉取前 n 页 API，用于调试；正式全量导出不要传 |

### 单篇下载

1. 打开任意知乎文章、回答、问题或想法页面
2. 页面右下角会出现一个可拖拽的浮动按钮
3. 点击按钮展开面板，确认识别到的内容信息
4. 根据需要调整选项（下载图片、导出评论区等）
5. 点击下载按钮

| 条件 | 输出格式 |
|------|---------|
| 无图片、无评论 | `.md` 文件 |
| 有图片或有评论 | `.zip` 压缩包 |

### 收藏夹 / 专栏批量导出

1. 打开知乎收藏夹或专栏页面
2. 点击浮动按钮，面板显示"打开导出管理器"
3. 在导出管理器页面中选择导出文件夹
4. 点击"开始导出"，自动按时间线从旧到新导出全部内容
5. 新增内容后，再次打开导出管理器即可增量导出

**评论导出：** 在导出管理器的"评论导出"区域，勾选需要导出评论的文章，点击导出即可。

```
导出文件夹/
├── export-progress-{id}.json       # 进度文件（自动管理）
└── 收藏夹名称/
    ├── README.md                   # 目录索引
    └── articles/
        ├── 文章标题.md
        ├── 问题标题-作者的回答.md
        ├── 问题标题-作者的回答-评论.md
        └── images/
            ├── 001_001.jpg
            └── comment_xxx_001_001.jpg
```

### 文件命名规则

| 类型 | 文件名格式 |
|------|-----------|
| 文章 | `文章标题.md` |
| 回答 | `问题标题-作者的回答.md` |
| 想法 | `内容前30字-作者的想法.md` |

## 支持的内容类型

| 类型 | URL 格式 | 单篇下载 | 批量导出 | 评论导出 |
|------|---------|---------|---------|---------|
| 文章 | `zhuanlan.zhihu.com/p/{id}` | 支持 | — | 支持 |
| 回答 | `zhihu.com/question/{qid}/answer/{aid}` | 支持 | — | 支持 |
| 问题 | `zhihu.com/question/{qid}` | 支持 | — | — |
| 想法 | `zhihu.com/pin/{id}` | 支持 | — | 支持 |
| 收藏夹 | `zhihu.com/collection/{id}` | — | 支持 | 支持 |
| 专栏 | `zhihu.com/column/{id}` | — | 支持 | 支持 |

## Markdown 转换规则

- 数学公式（`eeimg`）→ LaTeX `$...$` / `$$...$$`
- 带语言标记的代码块 → 围栏代码块
- HTML 表格 → Markdown 表格
- `<figure>` 图片 → `![alt](src)`
- 知乎脚注 `<sup>` → Markdown 脚注 `[^n]`
- 视频占位 → 链接
- 链接卡片 → Markdown 链接

## 技术架构

**技术栈：** React 19 + Ant Design 5 + TypeScript + Zustand + Vite 8 + CRXJS

```
src/
├── manifest.ts                         # CRXJS 扩展清单 (Manifest V3)
├── background/
│   └── index.ts                        # Service Worker：消息中转、打开导出页面
├── content/
│   ├── index.tsx                       # Content Script 入口：React 渲染
│   ├── detector.ts                     # 页面检测 + 内容提取 + fetch 代理
│   ├── fetch-bridge.js                 # 页面上下文桥接（携带 x-zse 签名）
│   ├── hooks/
│   │   ├── usePageDetect.ts            # 页面类型检测 Hook
│   │   └── useFolderHandle.ts          # IndexedDB 文件夹句柄持久化 Hook
│   └── components/
│       ├── PanelHost.tsx               # Shadow DOM + Antd StyleProvider 隔离
│       ├── FloatingButton.tsx          # 可拖拽浮动按钮
│       ├── ContentApp.tsx              # 面板路由调度
│       ├── ArticlePanel.tsx            # 单篇导出面板
│       ├── CollectionPanel.tsx         # 收藏夹面板
│       └── ColumnPanel.tsx             # 专栏面板
├── export/
│   ├── index.html                      # 导出管理器页面
│   ├── main.tsx                        # 导出管理器入口
│   ├── export.css                      # 水墨风界面样式
│   └── components/
│       ├── ExportManager.tsx           # 主布局
│       ├── FolderPicker.tsx            # 文件夹选择 + 进度校准
│       ├── ArticleList.tsx             # 文章批量导出
│       ├── CommentExport.tsx           # 评论导出（Antd Table）
│       └── LogPanel.tsx                # 日志面板
├── shared/
│   ├── api/
│   │   ├── zhihu-api.ts                # 知乎 API 层（收藏夹/专栏/评论）
│   │   ├── proxy-fetch.ts              # Extension Page 代理请求 + 403 重试
│   │   └── throttle.ts                 # 请求节流
│   ├── converters/
│   │   ├── html-to-markdown.ts         # Turndown 自定义规则
│   │   ├── html-to-docx.ts             # docx 库 + 公式转换
│   │   └── zhihu-html-utils.ts         # 知乎 HTML 元素识别
│   ├── stores/
│   │   ├── uiStore.ts                  # UI 状态（Zustand）
│   │   └── exportStore.ts              # 导出状态（Zustand）
│   ├── theme/
│   │   ├── token.ts                    # Antd 主题配置
│   │   └── ink-wash.module.css         # 水墨纹理装饰
│   └── utils/
│       ├── export-utils.ts             # 文件操作、图片下载、Front Matter
│       └── progress.ts                 # 进度文件管理
└── types/
    ├── zhihu.ts                        # 领域类型定义
    └── messages.ts                     # 消息协议类型
```

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 读取当前知乎页面内容 |
| `storage` | 缓存收藏夹/专栏目录数据 |
| `unlimitedStorage` | 支持大型收藏夹的目录缓存 |
| `host_permissions` (zhihu.com) | 从导出管理器页面访问知乎 API |

本扩展不会在后台运行，不会访问其他标签页或浏览数据。

## 发布流程(维护者)

1. 在下方「更新日志」新增 `### vX.Y.Z` 小节并写明本次变更(CI 会直接复用为 GitHub Release 正文;缺失则发布失败)。
2. 提交改动:`git commit -am "docs: vX.Y.Z 更新日志"`。
3. 升版本并打 tag(三选一):`npm version patch` / `npm version minor` / `npm version major` —— 自动 bump `package.json`、提交并打好 `vX.Y.Z` tag(`src/manifest.ts` 版本由 `package.json` 自动派生,无需手改)。
4. 推送:`git push --follow-tags`。
5. 其余交给 CI:校验版本 == tag → 构建打包 → 发 GitHub Release(正文 = 更新日志 + 安装说明)→ 发布到 Chrome Web Store / Edge Add-ons。

## 更新日志

### v3.1.0

- **新增个人主页导出**：支持导出知乎个人主页(`/people/:token`)的文章、回答、想法;仅允许导出已登录用户**本人**主页,防止滥用
- **性能**：操作日志仅保留最近 500 条,修复大批量导出时日志累积导致的界面卡顿(单次追加与渲染量由 O(N) 降为常数级,整场导出由 O(N²) 降为 O(N))
- **Word 公式导出重构**：改用 OMML 直接注入(temml → mml2omml → `ImportedXmlComponent`),替换有损的手写 OMML→docx 转换器
- 修复多行公式(`\begin{equation}`/`\begin{split}` 等)在 Word 中导出为空白
- 修复 `\oint`(环路积分)、`\prod`(连乘)被错误渲染为求和号 Σ
- 修复 `\mathbf`/`\mathcal`/`\text`/`\operatorname` 等样式丢失为默认斜体
- 修复 `\dot`/`\vec`/`\hat` 等重音渲染异常(改为正确的 `m:acc`/`m:groupChr`)
- 还原 `\boxed{}` 公式方框
- 消除 ∑/∏/∫ 等算符后的空白方框
- 引入 Vitest + jsdom 测试体系:含 96 条真实公式回归测试与端到端 `.docx` 校验

### v3.0.0

- **全面重构**：从原生 JavaScript 迁移至 React 19 + Ant Design 5 + TypeScript + Zustand
- **构建工具**：使用 Vite 8 + CRXJS 插件，支持热更新开发和代码分割
- **UI 升级**：Content Script 使用 Shadow DOM 隔离样式，导出管理器采用 Ant Design 组件
- **评论导出表格化**：评论导出改用 Antd Table，支持按收藏时间排序和多选
- **收藏时间记录**：区分文章创建时间与收藏时间，Front Matter 新增 `collected` 字段
- **CI 适配**：GitHub Actions release workflow 适配 Vite 构建流程

### v2.1.3

- 修复收藏夹/专栏批量导出时缺少创建时间和修改时间的问题

### v2.1.2

- 修复 Markdown 导出公式丢失：兼容知乎新版 `<span data-eeimg>` 公式格式
- 提取共享 HTML 识别模块 `zhihu-html-utils.js`，统一公式、图片、脚注、视频、链接卡片的检测逻辑
- Markdown 导出跳过知乎目录导航和参考文献列表
- Front Matter 新增创建时间和修改时间，原日期字段改为下载日期
- 修复单篇导出时 id 和时间信息缺失的问题

### v2.1.1

- 升级 docx 库至 v9.6.1，引用改用尾注，减少页面空间占用
- 改进 Word 排版：标题加粗加大、引用块楷体灰色背景、正文 1.5 倍行距
- 跳过知乎目录导航区域的导出
- 改进评论区样式：增大字号、优化间距和背景色
- 插件更新后自动检测版本不匹配，提示刷新页面
- 已导出评论的文章允许重新导出，支持评论更新

### v2.1.0

- 新增 Word (.docx) 导出格式，支持单篇和批量导出
- 支持图片嵌入或外部链接两种模式
- 数学公式导出为 Word 原生公式（OMML），转换失败时降级为 LaTeX 文本
- 评论可独立导出为 .docx 文件
- docx 库按需加载，不影响普通页面性能

### v2.0.2

- 新增"保存到文件夹"功能：单篇导出时可直接写入指定文件夹（适配 Obsidian vault 等场景），文件夹路径自动记忆
- 新增长文章内容补全：收藏夹导出时自动检测截断内容，请求完整页面补全
- 新增付费内容检测：自动识别付费文章并检查购买状态，未购买内容使用截断版本
- 新增 `zhuanlan.zhihu.com/{id}` 格式专栏 URL 识别
- 内容提取改为 initialData + DOM 双源取长，解决部分长文章截断问题
- 代理请求改为逐标签页尝试，单个标签页失败不阻塞整体
- 收藏夹导出增加单篇失败容错和详细日志汇总
- 单篇导出面板增加调试日志区域

### v2.0.1

- 修复专栏 URL 识别：支持任意格式的专栏 ID（如 `AndyLee`），不再限制为 `c_数字` 格式
- 导出管理器改为流式处理：逐页拉取逐页导出，无需等待全部目录加载完成
- 修复文件名含零宽字符（如零宽空格）导致文件写入失败的问题
- 移除目录缓存机制和刷新缓存按钮，简化导出流程

### v2.0.0

- 全新导出管理器，支持收藏夹和专栏的批量导出
- 评论区导出：勾选式选择文章，批量导出评论
- 进度持久化：中断后可继续导出
- 请求节流与 403 自动重试
- 图片本地化：自动下载文章和评论中的图片

## 许可证

MIT
