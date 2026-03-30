import { useState, useEffect, useCallback } from 'react';

const IDB_NAME = 'zhihu-downloader';
const IDB_STORE = 'handles';
const IDB_KEY = 'article-save-folder';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function verifyDirHandle(handle: FileSystemDirectoryHandle | null): Promise<FileSystemDirectoryHandle | null> {
  if (!handle) return null;
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch {
    return null;
  }
}

export function useFolderHandle() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await loadDirHandle();
      const verified = await verifyDirHandle(saved);
      if (verified) setDirHandle(verified);
    })();
  }, []);

  const pickFolder = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      await saveDirHandle(handle);
      return handle;
    } catch {
      return null;
    }
  }, []);

  return { dirHandle, setDirHandle, pickFolder, verifyDirHandle };
}
