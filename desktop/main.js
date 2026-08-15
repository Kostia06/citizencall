// Understudy — macOS Spotlight-style overlay. SPEC.md §3 budgets this file at
// "optional, Sunday, ~60 lines"; it is a shell around ui/'s /spotlight route,
// not a second implementation of the bar.
//
// Behaviour it mimics from Spotlight: a frameless, vibrant, always-on-top
// panel that appears on a global hotkey near the top-third of the active
// display, sizes itself to its content, and dismisses on Esc or on blur.
//
// ⚠️ VOICE DOES NOT WORK HERE — SPEC.md §7.3. Electron ships no Google Speech
// API key, so `webkitSpeechRecognition` throws `network` on start. The mic
// button degrades to a toast ("Speech unavailable — type instead"). Film the
// voice beat in Chrome and the ⌘-hotkey beat here, as two cuts.
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('node:path');

// ⌥Space, not ⌘Space: ⌘Space is macOS Spotlight's own and cannot be taken.
const HOTKEY = process.env.UNDERSTUDY_HOTKEY || 'Alt+Space';

// Vite takes 5173 if it's free and walks upward if it isn't, so a hardcoded
// port attaches to whatever other project happens to own 5173. Probe the
// range and pick the server that is actually serving THIS app, identified by
// index.html's <title>. UNDERSTUDY_URL skips discovery entirely.
const PORT_RANGE = [5173, 5174, 5175, 5176, 5177];
const APP_TITLE = '<title>Understudy</title>';

async function resolveUrl() {
  if (process.env.UNDERSTUDY_URL) return process.env.UNDERSTUDY_URL;
  for (const port of PORT_RANGE) {
    const origin = `http://localhost:${port}`;
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.includes(APP_TITLE)) {
        console.log(`[understudy] found the ui dev server on ${origin}`);
        return `${origin}/spotlight`;
      }
    } catch {
      // port closed or slow — keep looking
    }
  }
  return null;
}

const WIDTH = 720;
const INITIAL_HEIGHT = 96;
// Fraction of the display height the overlay's top edge sits at.
const TOP_FRACTION = 0.22;

/** @type {BrowserWindow | null} */
let win = null;
/** Origin of the resolved dev server, used to open secondary routes in the
 * user's real browser rather than inside the overlay. */
let baseOrigin = null;

function createWindow(url) {
  win = new BrowserWindow({
    width: WIDTH,
    height: INITIAL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Both of these draw on the WINDOW RECT, not on the pill inside it, so
    // either one paints a visible box around a bar that is supposed to look
    // like it's floating on the desktop:
    //   vibrancy  -> a frosted rectangle filling the whole window
    //   hasShadow -> a rectangular drop shadow around that same rect
    // The pill carries its own translucency and its own shadow in CSS
    // instead (see `html.spotlight-shell .bar-pill` in ui/src/index.css).
    hasShadow: false,
    backgroundColor: '#00000000',
    // Opt back in to the native frosted panel if you prefer it — it does give
    // real desktop blur, which CSS backdrop-filter cannot do in a transparent
    // Electron window. It brings the box back with it.
    ...(process.env.UNDERSTUDY_VIBRANCY
      ? { vibrancy: 'hud', visualEffectState: 'active', hasShadow: true, roundedCorners: true }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above full-screen apps, the way Spotlight does.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreenWindows: true });

  win.loadURL(url);

  // Renderer errors would otherwise be invisible — a frameless window with a
  // crashed React tree just looks like an empty pane.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, description, failedUrl) => {
    console.error(`[understudy] failed to load ${failedUrl}: ${description} (${code})`);
  });

  win.on('blur', () => {
    if (!process.env.UNDERSTUDY_KEEP_OPEN) hide();
  });

  // Any target="_blank" (or external link) opens in the real browser rather
  // than replacing the overlay.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function positionOnActiveDisplay() {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [, height] = win.getSize();
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * TOP_FRACTION),
    width: WIDTH,
    height,
  });
}

function show() {
  if (!win) return;
  positionOnActiveDisplay();
  win.show();
  win.focus();
  win.webContents.focus();
  win.webContents.send('understudy:shown');
}

function hide() {
  if (!win || !win.isVisible()) return;
  win.hide();
  // Hand focus back to whatever the user was doing.
  if (app.hide) app.hide();
}

function toggle() {
  if (!win) return;
  win.isVisible() ? hide() : show();
}

app.whenReady().then(async () => {
  // Accessory app: no Dock icon, no menu bar presence — it is an overlay, not
  // a window you switch to.
  if (app.dock) app.dock.hide();

  const url = await resolveUrl();
  if (!url) {
    console.error(
      `[understudy] no ui dev server found on ports ${PORT_RANGE.join(', ')}.\n` +
        `  Start it first:  cd ui && pnpm dev\n` +
        `  Or point at one: UNDERSTUDY_URL=http://localhost:PORT/spotlight pnpm start`,
    );
    app.quit();
    return;
  }

  baseOrigin = new URL(url).origin;
  createWindow(url);

  if (!globalShortcut.register(HOTKEY, toggle)) {
    console.error(
      `[understudy] could not register hotkey "${HOTKEY}" — another app already owns it. ` +
        `Set UNDERSTUDY_HOTKEY to something else, e.g. UNDERSTUDY_HOTKEY="Control+Space".`,
    );
  } else {
    console.log(`[understudy] press ${HOTKEY} to toggle the overlay`);
  }

  // Show once on launch so there is something to look at without guessing
  // the hotkey.
  show();
});

// Renderer reports its rendered height; the panel grows and shrinks with the
// trace instead of reserving dead space that would swallow clicks.
//
// The ceiling is derived from the display rather than a constant: a full run
// renders ~1100px of trace, so a fixed cap silently clipped the run_end
// summary off the bottom. Whatever is left over after the cap, the page
// scrolls internally (see `html.spotlight-shell body` in ui/src/index.css).
ipcMain.on('understudy:set-height', (_event, rawHeight) => {
  if (!win) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const top = Math.round(workArea.height * TOP_FRACTION);
  const maxHeight = Math.max(INITIAL_HEIGHT, workArea.height - top - 24);
  const height = Math.max(INITIAL_HEIGHT, Math.min(Math.round(rawHeight), maxHeight));
  const [, current] = win.getSize();
  if (height === current) return;
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, width: WIDTH, height });
});

// The overlay must never navigate away from the bar — opening the roster
// inside a 720px panel replaces the search field and strands the user (the
// roster's own back link points at the browser layout, not at /spotlight).
// Secondary screens open in the real browser instead.
ipcMain.on('understudy:open-external', (_event, routePath) => {
  if (!baseOrigin || typeof routePath !== 'string' || !routePath.startsWith('/')) return;
  shell.openExternal(`${baseOrigin}${routePath}`);
});

ipcMain.on('understudy:hide', hide);

app.on('will-quit', () => globalShortcut.unregisterAll());

// An overlay has no windows to "reopen" — closing the last window must not
// quit, or the hotkey dies with it.
app.on('window-all-closed', () => {});
app.on('activate', show);
