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
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');

// ⌥Space, not ⌘Space: ⌘Space is macOS Spotlight's own and cannot be taken.
const HOTKEY = process.env.UNDERSTUDY_HOTKEY || 'Alt+Space';

// Vite takes 5173 if it's free and walks upward if it isn't, so a hardcoded
// port attaches to whatever other project happens to own 5173. Probe the
// range and pick the server that is actually serving THIS app, identified by
// index.html's <title>. UNDERSTUDY_URL skips discovery entirely.
const PORT_RANGE = [5173, 5174, 5175, 5176, 5177];
const APP_TITLE = '<title>Understudy</title>';

// The worker's session cookies are `__Host-` prefixed (`__Host-refresh`,
// `__Host-anon`). Chromium only accepts that prefix from an https: scheme —
// http://localhost is refused even though it's a secure context (verified:
// plain Secure cookies stick there, `__Host-` ones vanish) — so signing in
// against the DEV server silently failed to persist. Rename the prefix to
// `dev-host-` on responses and back on requests, for plain-http origins
// only; https (prod) is untouched.
function bridgeHostCookiesForHttp(ses, origin) {
  const filter = { urls: [`${origin}/*`] };
  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = details.responseHeaders ?? {};
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'set-cookie') {
        headers[key] = headers[key].map((v) => v.replace(/^__Host-/, 'dev-host-'));
      }
    }
    callback({ responseHeaders: headers });
  });
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const cookie = details.requestHeaders.Cookie;
    if (cookie && cookie.includes('dev-host-')) {
      details.requestHeaders.Cookie = cookie.replaceAll('dev-host-', '__Host-');
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

const PROD_URL = 'https://citizencall.dev/spotlight';

async function resolveUrl() {
  if (process.env.UNDERSTUDY_URL) return process.env.UNDERSTUDY_URL;
  // A packaged .app has no dev server to find — it talks to production.
  if (app.isPackaged) return PROD_URL;
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

// Wider than the pill itself (620px, ui/src/routes/Spotlight.tsx) so the
// pill can sit exactly on the display's horizontal midline while orb
// clusters hang off either edge without being clipped: half-width must cover
// half the pill (310) + gap (12) + a side's orb row (4 orbs ≈ 228) + the
// shell's 20px padding.
const WIDTH = 1160;
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
    // The window itself paints NOTHING — no vibrancy, no shadow, no panel
    // rect. The only visible chrome is the pill, orbs and answer card, each
    // its own floating element with CSS-drawn fill and shadow (native
    // hasShadow would draw a rectangle around the whole invisible rect).
    hasShadow: false,
    backgroundColor: '#00000000',
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

  // Glassmorphism, Spotlight-style: a translucent surface tint + backdrop
  // blur. In a transparent Electron window backdrop-filter can only sample
  // PAGE content (the desktop behind the window is out of reach), so the
  // tint carries most of the effect — strong enough that nothing behind
  // reads sharply, weak enough to stay visibly glassy. Injected here rather
  // than in ui/ so a browser tab at /spotlight is untouched.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.insertCSS(
      'html.spotlight-shell .bar-pill { background: rgba(28, 28, 32, 0.78) !important; backdrop-filter: blur(24px) saturate(140%); -webkit-backdrop-filter: blur(24px) saturate(140%); }' +
        'html.spotlight-shell .spotlight-orbs button { background-color: rgba(28, 28, 32, 0.72) !important; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }' +
        'html.spotlight-shell [class*="rounded-2xl"] { background-color: rgba(24, 24, 28, 0.82) !important; backdrop-filter: blur(24px) saturate(140%); -webkit-backdrop-filter: blur(24px) saturate(140%); }' +
        // Light theme (data-theme flips live via the ☾ orb / account prefs);
        // the text inside uses the ink token, which flips with it.
        "html.spotlight-shell[data-theme='light'] .bar-pill { background: rgba(245, 245, 247, 0.8) !important; border-color: rgba(0, 0, 0, 0.14) !important; }" +
        "html.spotlight-shell[data-theme='light'] .spotlight-orbs button { background-color: rgba(245, 245, 247, 0.75) !important; }" +
        "html.spotlight-shell[data-theme='light'] [class*='rounded-2xl'] { background-color: rgba(250, 250, 252, 0.85) !important; }" +
        // The command field is a TEXTAREA, which index.css's no-drag list
        // (input/button/a/canvas) misses — without this the whole field is a
        // drag region and clicks/keystrokes move the window instead of
        // focusing it.
        'html.spotlight-shell textarea { -webkit-app-region: no-drag; }',
    );
  });

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
  if (baseOrigin.startsWith('http://')) {
    bridgeHostCookiesForHttp(session.defaultSession, baseOrigin);
  }
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

// Sign-in for the overlay's own session. openExternal can't do it — the
// system browser's cookies never reach Electron's cookie jar — so login
// happens in a small NORMAL window sharing the default (persistent) session.
// The refresh cookie outlives restarts, so this is a one-time step per
// machine. On close the overlay reloads to pick up the new identity.
/** @type {BrowserWindow | null} */
let authWin = null;
ipcMain.on('understudy:open-auth', () => {
  if (!baseOrigin) return;
  if (authWin) {
    authWin.focus();
    return;
  }
  authWin = new BrowserWindow({
    width: 480,
    height: 680,
    title: 'Sign in to Understudy',
    alwaysOnTop: true,
  });
  authWin.loadURL(`${baseOrigin}/login`);
  authWin.on('closed', () => {
    authWin = null;
    win?.webContents.reload();
    show();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// An overlay has no windows to "reopen" — closing the last window must not
// quit, or the hotkey dies with it.
app.on('window-all-closed', () => {});
app.on('activate', show);
