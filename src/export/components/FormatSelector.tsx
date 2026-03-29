import React from 'react';
import { Card, Radio, Checkbox, Space } from 'antd';
import { useExportStore } from '@/shared/stores/exportStore';

export function FormatSelector() {
  const format = useExportStore((s) => s.format);
  const setFormat = useExportStore((s) => s.setFormat);
  const docxImageMode = useExportStore((s) => s.docxImageMode);
  const setDocxImageMode = useExportStore((s) => s.setDocxImageMode);
  const wantImages = useExportStore((s) => s.wantImages);
  const setWantImages = useExportStore((s) => s.setWantImages);

  return (
    <Card title="导出格式" style={{ marginBottom: 16 }}>
      <Space direction="vertical">
        <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)}>
          <Radio value="md">Markdown</Radio>
          <Radio value="docx">Word (.docx)</Radio>
        </Radio.Group>

        {format === 'md' && (
          <Checkbox checked={wantImages} onChange={(e) => setWantImages(e.target.checked)}>
            存图
          </Checkbox>
        )}

        {format === 'docx' && (
          <Radio.Group value={docxImageMode} onChange={(e) => setDocxImageMode(e.target.value)}>
            <Radio value="embed">嵌入图片到文档</Radio>
            <Radio value="link">图片使用外部链接</Radio>
          </Radio.Group>
        )}
      </Space>
    </Card>
  );
}
