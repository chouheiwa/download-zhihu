# Chrome Web Store 上架信息

## 扩展名称

知乎文章下载器

## 简短描述（132 字符以内）

将知乎文章、回答、问题、想法、收藏夹一键导出为 Markdown，支持图片下载和 ZIP 打包。

## 详细描述

知乎文章下载器是一款轻量级 Chrome 扩展，帮助你将知乎内容快速保存为 Markdown 格式，方便在 Obsidian、Typora、Notion 等工具中归档和阅读。

### 支持的内容类型

- 专栏文章（zhuanlan.zhihu.com/p/...）
- 问题回答（zhihu.com/question/.../answer/...）
- 问题页面（zhihu.com/question/...）含所有回答
- 想法/动态（zhihu.com/pin/...）
- 收藏夹（zhihu.com/collection/...）批量导出全部内容

### 核心功能

- 页面内浮动按钮，点击即用，支持拖拽调整位置
- 高质量 HTML → Markdown 转换：数学公式、代码块、表格、脚注、链接卡片完整保留
- 自动下载图片并与 Markdown 打包为 ZIP
- 可选 YAML Front Matter 元数据（标题、作者、来源、日期）
- 收藏夹批量导出：自动分页获取全部内容，生成可点击跳转的目录索引

### 隐私与权限

- 仅使用 activeTab 权限，不在后台运行
- 不收集、不上传任何用户数据
- 所有处理均在本地完成
- 开源项目，代码完全透明

## 类别

生产力工具（Productivity）

## 语言

中文（简体）

## 截图说明（建议 1280x800 或 640x400）

1. 截图 1：知乎文章页面，浮动按钮展开面板，显示文章信息和下载选项
2. 截图 2：收藏夹页面，展开面板显示收藏夹内容数量和导出进度
3. 截图 3：导出的 ZIP 文件内容展示（Markdown + images 目录）
4. 截图 4：在 Obsidian/Typora 中打开导出的 Markdown 效果

## 上架流程

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 注册开发者账号（一次性费用 $5）
3. 打包扩展：在项目根目录运行 `zip -r DownloadZhihu.zip . -x ".*" "*.crx" "*.pem" "*.har" "node_modules/*" "STORE_LISTING.md"`
4. 上传 ZIP 包
5. 填写上述商店信息
6. 上传截图（至少 1 张）
7. 提交审核（通常 1-3 个工作日）
