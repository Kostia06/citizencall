// PWA install plumbing (replaced the retired Electron overlay). Chrome-family
// browsers fire `beforeinstallprompt` — we stash it so an Install button can
// re-fire it on click; Safari never fires it, so callers fall back to
// share-menu instructions.

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no mini-infobar; we present our own Install button
    deferredPrompt = e as InstallPromptEvent;
    listeners.forEach((l) => l(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((l) => l(false));
  });
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Fires the browser's install dialog. Resolves true when installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  return outcome === 'accepted';
}

/** Subscribe to install-availability changes (returns unsubscribe). */
export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(canPromptInstall());
  return () => listeners.delete(cb);
}
