import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/shared/stores/uiStore';

const STORAGE_KEY = 'zhihu-downloader-pos';
const DEFAULT_POS = { right: 24, bottom: 100 };

function loadPosition(): { right: number; bottom: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_POS;
}

function savePosition(right: number, bottom: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ right, bottom }));
  } catch { /* ignore */ }
}

export function FloatingButton() {
  const togglePanel = useUIStore((s) => s.togglePanel);
  const [pos, setPos] = useState(loadPosition);
  const dragState = useRef({
    isDragging: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    startRight: 0,
    startBottom: 0,
  });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current;
    ds.isDragging = true;
    ds.hasMoved = false;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.startRight = pos.right;
    ds.startBottom = pos.bottom;
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.isDragging) return;
      const dx = ds.startX - e.clientX;
      const dy = ds.startY - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.hasMoved = true;
      if (!ds.hasMoved) return;
      setPos({
        right: Math.max(0, Math.min(window.innerWidth - 50, ds.startRight + dx)),
        bottom: Math.max(0, Math.min(window.innerHeight - 50, ds.startBottom + dy)),
      });
    };

    const onMouseUp = () => {
      const ds = dragState.current;
      if (!ds.isDragging) return;
      ds.isDragging = false;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    savePosition(pos.right, pos.bottom);
  }, [pos]);

  const onClick = useCallback(() => {
    if (dragState.current.hasMoved) return;
    togglePanel();
  }, [togglePanel]);

  const iconUrl = chrome.runtime.getURL('src/assets/icons/icon48.png');

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{
        position: 'fixed',
        right: pos.right,
        bottom: pos.bottom,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: '#0066ff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        zIndex: 2147483647,
        transition: 'box-shadow 0.2s, transform 0.2s',
      }}
    >
      <img src={iconUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, pointerEvents: 'none' }} />
    </div>
  );
}
