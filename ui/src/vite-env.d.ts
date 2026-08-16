/// <reference types="vite/client" />

// Bridge exposed by desktop/preload.js when the UI runs inside the Electron
// Spotlight shell. Undefined in a normal browser tab — always optional-chain.
interface UnderstudyBridge {
  /** Report the rendered content height so the overlay can size to fit. */
  setHeight(height: number): void;
  /** Dismiss the overlay (Esc, or after a run completes). */
  hide(): void;
  /** Open an app route in the user's real browser instead of navigating the
   * overlay away from the bar. Path must start with "/". */
  openExternal(routePath: string): void;
  /** Open the login page in a small window on the overlay's OWN session (the
   * real browser's cookies never reach Electron); the overlay reloads when
   * it closes so the new session takes effect. */
  openAuth(): void;
  /** Subscribe to "overlay was summoned" — refocus the input. Returns an
   * unsubscribe function. */
  onShown(callback: () => void): () => void;
}

interface Window {
  understudy?: UnderstudyBridge;
}
