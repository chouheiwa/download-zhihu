import React, { useEffect, useRef } from 'react';
import { Card } from 'antd';
import { useUIStore } from '@/shared/stores/uiStore';

const levelColors: Record<string, string> = {
  info: 'inherit',
  warn: '#d69e2e',
  error: '#e53e3e',
  success: '#27ae60',
};

export function LogPanel() {
  const logs = useUIStore((s) => s.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Card title="操作日志" style={{ marginTop: 24 }}>
      <div
        ref={scrollRef}
        style={{
          maxHeight: 300,
          overflowY: 'auto',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12,
          lineHeight: 1.8,
        }}
      >
        {logs.map((log, i) => (
          <div key={i}>
            <span style={{ color: '#aaa' }}>[{log.time}]</span>{' '}
            <span style={{ color: levelColors[log.level] }}>{log.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
