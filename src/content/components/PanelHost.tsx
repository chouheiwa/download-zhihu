import React, { useRef, useEffect, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { StyleProvider, createCache } from '@ant-design/cssinjs';
import { ConfigProvider } from 'antd';
import { inkWashTheme } from '@/shared/theme/token';

export function PanelHost({ children }: PropsWithChildren) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mountTarget, setMountTarget] = useState<{
    container: HTMLDivElement;
    shadowRoot: ShadowRoot;
  } | null>(null);
  const cacheRef = useRef(createCache());

  useEffect(() => {
    if (!hostRef.current || mountTarget) return;
    const shadowRoot = hostRef.current.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :host { all: initial; }
    `;
    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    shadowRoot.appendChild(container);
    setMountTarget({ container, shadowRoot });
  }, []);

  return (
    <>
      <div ref={hostRef} style={{ all: 'initial', position: 'fixed', zIndex: 2147483647, top: 0, left: 0, width: 0, height: 0 }} />
      {mountTarget &&
        createPortal(
          <StyleProvider container={mountTarget.shadowRoot} cache={cacheRef.current}>
            <ConfigProvider
              theme={inkWashTheme}
              getPopupContainer={() => mountTarget.container}
            >
              {children}
            </ConfigProvider>
          </StyleProvider>,
          mountTarget.container
        )
      }
    </>
  );
}
