import React, { useEffect } from 'react';
import { Layout, Typography } from 'antd';
import styles from '@/shared/theme/ink-wash.module.css';
import { useExportStore } from '@/shared/stores/exportStore';
import { useUIStore } from '@/shared/stores/uiStore';
import { FolderPicker } from './FolderPicker';
import { FormatSelector } from './FormatSelector';
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
    <Layout className={styles.inkWashBg} style={{ minHeight: '100vh' }}>
      <div className={styles.inkWash1} />
      <div className={styles.inkWash2} />
      <div className={styles.ricePaperTexture} />

      <Header style={{ background: 'transparent', textAlign: 'center', padding: '24px 0', height: 'auto', lineHeight: 'normal' }}>
        <div className={styles.sealMark}>藏</div>
        <Typography.Title level={2} style={{ margin: '8px 0 0' }}>导出管理器</Typography.Title>
        <Typography.Text type="secondary">{sourceLabel}：{collectionName}</Typography.Text>
      </Header>

      <Content style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', width: '100%' }}>
        <FolderPicker collectionId={collectionId} collectionName={collectionName} />

        {dirHandle && (
          <>
            <FormatSelector />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
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
            </div>
            <LogPanel />
          </>
        )}
      </Content>

      <Footer style={{ textAlign: 'center', background: 'transparent' }}>
        <Typography.Text type="secondary">知乎导出工具</Typography.Text>
      </Footer>
    </Layout>
  );
}
