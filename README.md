# 知乎文章下载器

一键将知乎内容导出为 Markdown 文件的 Chrome 扩展。支持文章、回答、问题、想法四种内容类型，自动下载图片并打包为 ZIP。

## 功能特性

- **多类型支持** — 文章、回答、问题、想法一键导出
- **高质量转换** — 完整保留数学公式、代码块、表格、脚注、链接卡片
- **图片本地化** — 自动下载文章图片，与 Markdown 一起打包为 ZIP
- **Front Matter** — 可选生成 YAML 元数据（标题、作者、来源、日期）
- **零配置** — 无需登录、无需 API Key，打开知乎页面直接使用
- **隐私安全** — 纯本地运行，不收集任何用户数据

## 安装方式

### 从 Chrome Web Store 安装

> 即将上架，敬请期待

### 开发者模式安装

1. 下载或克隆本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目根目录
5. 完成

## 使用方法

1. 打开任意知乎文章、回答、问题或想法页面
2. 点击浏览器工具栏中的扩展图标
3. 确认识别到的内容信息（标题、作者、图片数量）
4. 根据需要调整选项：
   - **包含 Front Matter** — 在 Markdown 开头添加 YAML 元数据
   - **下载图片到本地** — 将图片下载并打包
5. 点击下载按钮

### 下载规则

| 条件 | 输出格式 |
|------|---------|
| 无图片 / 未勾选下载图片 | `.md` 文件（图片保留远程链接） |
| 有图片 + 勾选下载图片 | `.zip` 压缩包 |

ZIP 包结构：

```
标题-作者的文章.zip
├── 标题-作者的文章.md
└── images/
    ├── image_001.jpg
    ├── image_002.png
    └── ...
```

## 支持的内容类型

| 类型 | URL 格式 | 示例 |
|------|---------|------|
| 文章 | `zhuanlan.zhihu.com/p/{id}` | 知乎专栏文章 |
| 回答 | `zhihu.com/question/{qid}/answer/{aid}` | 问题下的回答 |
| 问题 | `zhihu.com/question/{qid}` | 问题详情及回答 |
| 想法 | `zhihu.com/pin/{id}` | 知乎想法/动态 |

## Markdown 转换规则

- 数学公式（`eeimg`）→ LaTeX `$...$` / `$$...$$`
- 带语言标记的代码块 → 围栏代码块
- HTML 表格 → Markdown 表格
- `<figure>` 图片 → `![alt](src)`
- 知乎脚注 `<sup>` → Markdown 脚注 `[^n]`
- 视频占位 → 链接
- 链接卡片 → Markdown 链接

## 技术架构

```
DownloadZhihu/
├── manifest.json           # Chrome 扩展配置 (Manifest V3)
├── content/
│   └── detector.js         # 内容脚本：页面类型检测 + 内容提取
├── lib/
│   ├── turndown.js         # HTML → Markdown 转换库
│   ├── jszip.min.js        # ZIP 打包库
│   └── html-to-markdown.js # 知乎专用转换规则
├── popup/
│   ├── popup.html          # 弹出窗口
│   ├── popup.css           # 样式
│   └── popup.js            # 下载逻辑（图片下载 + ZIP 打包）
└── icons/                  # 扩展图标
```

## 权限说明

本扩展仅使用 `activeTab` 权限，即只在用户主动点击扩展图标时，读取当前标签页的内容。不会在后台运行，不会访问其他标签页或浏览数据。

## 许可证

MIT
