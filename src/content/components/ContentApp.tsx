import React from 'react';
import { Card } from 'antd';
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
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 10, padding: '6px 16px', border: 'none', borderRadius: 6, background: '#0066ff', color: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
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
      {!['collection', 'column'].includes(pageInfo.type) && content && (
        <ArticlePanel content={content} pageInfo={pageInfo} />
      )}
    </PanelWrapper>
  );
}

function PanelWrapper({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Card
      title={<span style={{ color: '#0066ff', fontWeight: 600 }}>知乎文章下载器</span>}
      extra={
        <button
          onClick={onClose}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#999', lineHeight: 1 }}
        >
          ✕
        </button>
      }
      style={{
        position: 'fixed',
        right: 24,
        bottom: 160,
        width: 340,
        maxHeight: 480,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        zIndex: 2147483647,
      }}
      styles={{ body: { padding: 16, maxHeight: 400, overflowY: 'auto' } }}
    >
      {children}
    </Card>
  );
}
