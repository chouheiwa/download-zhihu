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
