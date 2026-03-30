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
