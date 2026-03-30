import React, { useEffect, useState } from 'react';
import { Button, Tag, Space, Spin, Typography } from 'antd';
import { fetchCollectionPage } from '@/shared/api/zhihu-api';
import type { CollectionInfo } from '@/types/zhihu';

interface Props {
  info: CollectionInfo;
}

export function CollectionPanel({ info }: Props) {
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchCollectionPage(info.apiUrl)
      .then((result) => {
        setItemCount(result.totals);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [info.apiUrl]);

  const openExportManager = () => {
    const exportUrl = chrome.runtime.getURL(
      `src/export/index.html?id=${encodeURIComponent(info.id)}&name=${encodeURIComponent(info.title)}&api=${encodeURIComponent(info.apiUrl)}&source=collection`
    );
    chrome.runtime.sendMessage({ action: 'openExportPage', url: exportUrl });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div><Tag color="green">收藏夹</Tag></div>
      <Typography.Text strong>{info.title}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {loading ? <Spin size="small" /> : error ? '获取数量失败' : `${itemCount} 篇`}
      </Typography.Text>
      <Button type="primary" block onClick={openExportManager} disabled={loading && !error}>
        打开导出管理器
      </Button>
    </Space>
  );
}
