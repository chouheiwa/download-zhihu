import React, { useEffect } from 'react';
import { Layout, Typography } from 'antd';
import styles from '@/shared/theme/ink-wash.module.css';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import { FolderPicker } from './FolderPicker';

import { ArticleList } from './ArticleList';
import { CommentExport } from './CommentExport';
import { LogPanel } from './LogPanel';

const { Header, Content, Footer } = Layout;

export function ExportManager() {
  const params = new URLSearchParams(window.location.search);
  const collectionId = params.get('id') || '';
  const collectionName = params.get('name') || '未知';
  const collectionApiUrl = params.get('api') || '';
  const sourceType = (params.get('source') || 'collection') as 'collection' | 'column';
  const sourceLabel = sourceType === 'column' ? '专栏' : '收藏夹';
  const dirHandle = useExportStore((s) => s.dirHandle);
  const addLog = useUIStore((s) => s.addLog);

  useEffect(() => {
    document.title = `导出管理器 - ${sourceLabel} - ${collectionName}`;
    addLog(`已加载${sourceLabel}：${collectionName}（ID: ${collectionId}）`, 'info');
  }, []);

  return (
    <Layout className={`${styles.inkWashBg} export-app`} style={{ minHeight: '100vh', background: 'transparent' }}>
      <div className={styles.inkWash1} />
      <div className={styles.inkWash2} />
      <div className={styles.ricePaperTexture} />

      <Header className="app-header" style={{ background: 'transparent', height: 'auto', lineHeight: 'normal' }}>
        <div className={styles.sealMark}>藏</div>
        <div className="header-center">
          <Typography.Title level={2} className="app-title">导出管理器</Typography.Title>
          <Typography.Text className="app-subtitle">{sourceLabel}：{collectionName}</Typography.Text>
        </div>
        <div className="header-status">
          <span className="status-dot" />
          已就绪
        </div>
      </Header>

      <Content style={{ maxWidth: 880, margin: '0 auto', padding: '1.5rem 2rem', width: '100%' }}>
        <FolderPicker collectionId={collectionId} collectionName={collectionName} />

        {dirHandle && (
          <>
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
            <LogPanel />
          </>
        )}
      </Content>

      <Footer className="app-footer" style={{ background: 'transparent' }}>
        <div className="footer-line" />
        <p>知乎导出工具</p>
      </Footer>
    </Layout>
  );
}
