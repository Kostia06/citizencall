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
});
