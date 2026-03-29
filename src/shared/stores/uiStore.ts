import { create } from 'zustand';
import type { LogEntry, LogLevel } from '@/types/zhihu';

interface RetryInfo {
  count: number;
  max: number;
  waitMs: number;
}

interface FabPosition {
  right: number;
  bottom: number;
}

interface UIState {
  panelOpen: boolean;
  fabPos: FabPosition;
  logs: LogEntry[];
  retryInfo: RetryInfo | null;

  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  setFabPos: (pos: FabPosition) => void;
  addLog: (message: string, level: LogLevel) => void;
  clearLogs: () => void;
  setRetryInfo: (info: RetryInfo | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  panelOpen: false,
  fabPos: { right: 24, bottom: 100 },
  logs: [],
  retryInfo: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setFabPos: (pos) => set({ fabPos: pos }),
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
