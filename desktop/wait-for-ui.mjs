// Blocks until ui/'s Vite dev server answers, so `pnpm dev` in desktop/ can be
// run immediately after starting the UI without racing it to a blank window.
//
// Scans the range Vite walks when its preferred port is busy, and matches on
// index.html's <title> so it never latches onto a different project's dev
// server. main.js does the same discovery; this just fails early with a
// readable message instead of launching Electron to no purpose.
const PORT_RANGE = [5173, 5174, 5175, 5176, 5177];
const APP_TITLE = '<title>CitizenCall</title>';
const explicit = process.env.UNDERSTUDY_URL;
const deadline = Date.now() + 30_000;

async function findServer() {
  if (explicit) {
    try {
      const res = await fetch(explicit, { signal: AbortSignal.timeout(1500) });
      return res.ok ? explicit : null;
    } catch {
      return null;
    }
  }
  for (const port of PORT_RANGE) {
    const origin = `http://localhost:${port}`;
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(1500) });
      if (res.ok && (await res.text()).includes(APP_TITLE)) return `${origin}/spotlight`;
    } catch {
      // keep looking
    }
  }
  return null;
}

while (Date.now() < deadline) {
  const found = await findServer();
  if (found) {
    console.log(`[understudy] ui is up at ${found}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 400));
}

console.error(
  `[understudy] no CitizenCall ui dev server on ports ${PORT_RANGE.join(', ')}.\n` +
    `  Start it first:  cd ui && pnpm dev\n` +
    `  Or override:     UNDERSTUDY_URL=http://localhost:PORT/spotlight`,
);
process.exit(1);
