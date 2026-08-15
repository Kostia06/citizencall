# desktop/ — the macOS Spotlight overlay

A frameless, vibrant, always-on-top panel that shows **only the command bar**.
It is a shell around `ui/`'s `/spotlight` route — not a second implementation
of the bar — which is why the whole thing is ~150 lines. SPEC.md §3 budgets it
as "optional, Sunday, ~60 lines".

```bash
# terminal 1 — the UI the overlay renders
cd ui && pnpm install && pnpm dev

# terminal 2 — the overlay
cd desktop && pnpm install && pnpm dev
```

`pnpm dev` waits for Vite to answer before launching, so the order above is a
convenience, not a requirement. `pnpm start` skips the wait.

**Port discovery.** Vite takes 5173 when it's free and walks upward when it
isn't, so the overlay probes 5173–5177 and attaches to the server whose
`index.html` says `<title>Understudy</title>` — never to another project that
happens to own 5173. Override with `UNDERSTUDY_URL` to skip discovery.

## Using it

| action | result |
|---|---|
| **⌥Space** | toggle the overlay |
| **Esc** | clears the input; pressing it again on an empty input dismisses |
| click away | dismisses (set `UNDERSTUDY_KEEP_OPEN=1` to keep it up while debugging) |
| drag anywhere on the panel | moves it — controls stay clickable |

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
  (`understudy:set-height`) and the panel grows as the trace expands and
  shrinks back when it clears — capped at 900px.
- **Follows the active display.** It opens centred on whichever screen the
  cursor is on, 22% down.
- **Floats over full-screen apps** (`alwaysOnTop` at `screen-saver` level).

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
exactly two functions (`setHeight`, `hide`) — see `preload.js` and the
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
