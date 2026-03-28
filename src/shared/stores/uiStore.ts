import { create } from 'zustand';
import type { LogEntry, LogLevel } from '@/types/zhihu';

interface RetryInfo {
  count: number;
  max: number;
  waitMs: number;
}

interface UIState {
  panelOpen: boolean;
  logs: LogEntry[];
  retryInfo: RetryInfo | null;

  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  addLog: (message: string, level: LogLevel) => void;
  clearLogs: () => void;
  setRetryInfo: (info: RetryInfo | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  panelOpen: false,
  logs: [],
  retryInfo: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),
  addLog: (message, level) => set((s) => ({
    logs: [...s.logs, {
      time: new Date().toLocaleTimeString(),
      message,
      level,
    }],
  })),
  clearLogs: () => set({ logs: [] }),
  setRetryInfo: (info) => set({ retryInfo: info }),
}));
