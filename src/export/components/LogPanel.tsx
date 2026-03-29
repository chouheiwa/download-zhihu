import React, { useEffect, useRef } from 'react';
import { Card } from 'antd';
import { useUIStore } from '@/shared/stores/uiStore';

const levelClasses: Record<string, string> = {
  info: '',
  warn: 'log-warn',
  error: 'log-error',
  success: 'log-success',
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
    <Card title="操作日志" className="log-panel-card" style={{ marginTop: 24 }}>
      <div ref={scrollRef} className="log-scroll">
        {logs.map((log, i) => (
          <div key={i} className="log-entry">
            <span className="log-time">[{log.time}]</span>
            <span className={levelClasses[log.level]}>{log.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
