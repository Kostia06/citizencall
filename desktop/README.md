# desktop/ — the macOS Spotlight overlay

A frameless, transparent, always-on-top window whose only visible chrome is
the floating command pill, the orb cluster to its right, and — after a run —
the **result-only answer card** (the trace stays on the web app; the overlay
shows the final answer with *copy* and *View steps on web ↗*). It is a shell
around `ui/`'s `/spotlight` route — not a second implementation of the bar —
which is why the whole thing is ~150 lines. SPEC.md §3 budgets it as
"optional, Sunday, ~60 lines".

```bash
# terminal 1 — the UI the overlay renders
cd ui && pnpm install && pnpm dev

# terminal 2 — the overlay
cd desktop && pnpm install && pnpm dev
```

`pnpm dev` waits for Vite to answer before launching, so the order above is a
convenience, not a requirement. `pnpm start` skips the wait, and
`pnpm start:prod` needs no local servers at all — it loads
`https://citizencall.dev/spotlight` directly.

**Packaged build.** `pnpm dist` produces `dist/Understudy-macos-arm64.zip`
(unsigned, arm64). The packaged app defaults to production
(`https://citizencall.dev/spotlight`); `UNDERSTUDY_URL` still overrides. It is
unsigned, so on first launch either right-click → Open, or clear quarantine:

```bash
xattr -dc Understudy.app
```

**Port discovery.** Vite takes 5173 when it's free and walks upward when it
isn't, so the overlay probes 5173–5177 and attaches to the server whose
`index.html` says `<title>Understudy</title>` — never to another project that
happens to own 5173. Override with `UNDERSTUDY_URL` to skip discovery.

## Using it

| action | result |
|---|---|
| **⌥Space** | toggle the overlay |
| **Enter** | run the prompt; the answer streams into a card under the pill |
| **Esc** | layered: clears the input → collapses the answer card (stopping a live run; the session keeps threading) → dismisses the overlay |
| **copy** / **View steps on web ↗** | under the answer: copy it, or open the full app (with the run trace) in the real browser |
| click away | dismisses (set `UNDERSTUDY_KEEP_OPEN=1` to keep it up while debugging) |
| drag anywhere on the pill row | moves it — controls stay clickable |

**Why ⌥Space and not ⌘Space:** ⌘Space belongs to macOS Spotlight and cannot be
registered by another app. Override with `UNDERSTUDY_HOTKEY`, using
[Electron accelerator syntax](https://www.electronjs.org/docs/latest/api/accelerator):

```bash
UNDERSTUDY_HOTKEY="Control+Space" pnpm start
```

If the hotkey is already taken the app logs which one failed and stays usable —
it still shows itself once on launch.

## Behaviour worth knowing

- **No Dock icon.** `app.dock.hide()` makes it an accessory app, like Spotlight.
  Quit it from the terminal it was launched in (⌃C).
- **Sizes to content.** The renderer reports its rendered height over IPC
  (`understudy:set-height`) and the window grows as the answer streams in and
  shrinks back when Esc collapses it — capped to the display's work area.
- **Follows the active display.** It opens on whichever screen the cursor is
  on, 22% down, with the pill exactly on the display's horizontal midline
  (the window is wider than the pill so the orbs hang right without pushing
  it off-centre).
- **Draws no window chrome.** The window is fully transparent with no native
  shadow or vibrancy; the pill, orbs and answer card paint their own
  near-opaque fills (injected from `main.js`, so a browser tab at `/spotlight`
  keeps the stock styling).
- **Floats over full-screen apps** (`alwaysOnTop` at `screen-saver` level).
- **Has its own sign-in.** Electron's cookie jar is separate from the
  browser's, so the overlay starts anonymous and shows a subtle *Sign in to
  use your account* link. It opens a small window on the overlay's own
  (persistent) session — one login survives restarts for ~30 days, and the
  orbs/connections/theme follow the account. Against the plain-http dev
  server, main.js bridges the worker's `__Host-` cookies (Chromium refuses
  that prefix off https) — prod needs no such help.

## ⚠️ Voice does not work here — SPEC.md §7.3

`webkitSpeechRecognition` throws a `network` error inside Electron: Electron
builds don't ship Google's Speech API keys, so the recognition service is
unreachable. This is long-standing and unresolved
([electron/electron#7749](https://github.com/electron/electron/issues/7749)).

The mic button degrades honestly — it toasts *"Speech unavailable — type
instead"* rather than pretending. SPEC.md §7.3's recommendation stands: **film
the voice beat in Chrome and the hotkey beat here, as two separate cuts.**
Nobody notices the edit; a dead mic on camera is noticed immediately.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`, and a preload that exposes
exactly three functions (`setHeight`, `hide`, `openExternal`) — see `preload.js` and the
`UnderstudyBridge` interface in `ui/src/vite-env.d.ts`. External links are
handed to the system browser instead of loading in the overlay.

## Not done yet

- **No packaging.** It loads the Vite dev server. Shipping a double-clickable
  `.app` needs `electron-builder` plus a production load path — `BrowserRouter`
  doesn't survive `file://`, so the packaged build would need either a custom
  protocol handler or a switch to `HashRouter`. Point `UNDERSTUDY_URL` at any
  other host in the meantime.
- **No tray icon**, so with no Dock icon the only way to quit is the launching
  terminal.
