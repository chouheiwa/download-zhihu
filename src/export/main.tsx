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
