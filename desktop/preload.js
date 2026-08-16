// Minimal bridge — contextIsolation stays on, so the renderer gets exactly
// three functions and no access to Node. Matches the UnderstudyBridge
// interface declared in ui/src/vite-env.d.ts.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('understudy', {
  setHeight: (height) => ipcRenderer.send('understudy:set-height', height),
  hide: () => ipcRenderer.send('understudy:hide'),
  // Secondary screens (roster, benchmark) open in the real browser — the
  // overlay itself must stay on the bar. Main validates the path.
  openExternal: (routePath) => ipcRenderer.send('understudy:open-external', routePath),
  // Login must happen in a window that SHARES the overlay's session (the
  // system browser's cookies never reach Electron's cookie jar), so main
  // opens a small normal window on the same session and reloads the overlay
  // when it closes.
  openAuth: () => ipcRenderer.send('understudy:open-auth'),
  // Fires every time the overlay is summoned — the page refocuses the input
  // so ⌥Space → type works without a click.
  onShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('understudy:shown', listener);
    return () => ipcRenderer.removeListener('understudy:shown', listener);
  },
});
