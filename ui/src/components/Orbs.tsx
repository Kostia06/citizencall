import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Reorder, motion, useDragControls, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { magneticSnappy } from '../lib/motion';
import { APPS } from '../store/apps';
import type { Routine, UserPrefsButton } from '../api';

// Poll window after an orb-initiated connect — the Composio OAuth flow
// completes in a new tab/window with no callback into this one, so this is
// how the orb notices without a manual reload. "Only-real" orbs slice.
const CONNECT_POLL_INTERVAL_MS = 3000;
const CONNECT_POLL_WINDOW_MS = 2 * 60 * 1000;

interface OrbsProps {
  /** The bar buttons in saved order — prefs.buttons (settings §Buttons). */
  buttons: UserPrefsButton[];
  /** Toolkits with an active connection (mock fallback pre-seeds github+gmail). */
  connectedSlugs: Set<string>;
  liveToolkit: 'github' | 'gmail' | null;
  policyVersion?: string;
  currentUser: string;
  onToggleUser(): void;
  /** Connect an unconnected toolkit orb — opens the Composio OAuth flow. */
  onConnect(slug: string): void;
  /** Hold-drag reorder — fires with the full new order; parent persists it. */
  onReorder(next: UserPrefsButton[]): void;
  /** When supplied, route-opening orbs call this instead of navigating in
   * place. The Electron overlay passes it so the roster opens in the real
   * browser — navigating a 720px panel to a full page would replace the
   * search field and strand the user there. Browser routes leave it
   * undefined and keep the plain <Link>. */
  onOpenRoute?(path: string): void;
  /** The user's routines, for resolving a `routine:<id>` button's icon/name.
   * Empty/omitted degrades to showing the raw id. */
  routines?: Routine[];
  /** Fires a routine's prompt through the bar — `routine:<id>` orb click. */
  onRunRoutine?(routineId: string): void;
  /** ▶ / ⚡ orb click — submits whatever is typed in the bar (bypassCache
   * for ⚡), same as Enter / ⌘⏎. Omitted (Spotlight) leaves them inert. */
  onRun?(bypassCache: boolean): void;
  /** ✦ orb click — flips the next-action suggestions setting. */
  onToggleSuggestions?(): void;
  /** Re-fetches connections — called on an interval after an orb-initiated
   * connect so a completed OAuth flow (new tab, no callback into this one)
   * lights the orb up without a manual reload. Polling and its cleanup live
   * entirely here; omit to disable (e.g. anonymous/MOCK callers that don't
   * need it). */
  onPollConnections?(): void;
}

const HALO = 40; // px — cursor-proximity radius that triggers magnetism
const MAX_PULL = 6; // px — max translate toward cursor
const HOLD_MS = 200; // hold-to-drag threshold — under it, a press is a click

const MotionLink = motion(Link);

function PulseRings() {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 rounded-full border border-accent/60 animate-ring-expand" />
      <span
        className="pointer-events-none absolute inset-0 rounded-full border border-accent/60 animate-ring-expand"
        style={{ animationDelay: '0.55s' }}
      />
    </>
  );
}

/** One orb with cursor-proximity magnetism layered on top of the existing
 * hover lift/scale — DESIGN.md §5 Command bar "Magnetic orbs". Reduced
 * motion disables cursor tracking entirely; hover falls back to a plain
 * background-color change via the `hover:` classes already on the button. */
function Orb({
  className,
  title,
  onClick,
  as: As = 'div',
  to,
  children,
}: {
  className: string;
  title: string;
  onClick?: () => void;
  as?: 'div' | 'button' | 'link';
  to?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, magneticSnappy);
  const springY = useSpring(y, magneticSnappy);

  function handlePointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (reduceMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const reach = rect.width / 2 + HALO;
    if (dist < reach) {
      const pull = Math.min(1, (reach - dist) / reach);
      x.set((dx / reach) * MAX_PULL * pull);
      y.set((dy / reach) * MAX_PULL * pull);
    } else {
      x.set(0);
      y.set(0);
    }
  }

  function handlePointerLeave() {
    x.set(0);
    y.set(0);
  }

  const motionProps = reduceMotion
    ? {}
    : {
        style: { x: springX, y: springY },
        whileHover: { y: -3, scale: 1.06, transition: magneticSnappy },
        onPointerMove: handlePointerMove,
        onPointerLeave: handlePointerLeave,
      };

  if (As === 'link' && to) {
    return (
      <MotionLink to={to} title={title} className={className} {...motionProps}>
        {children}
      </MotionLink>
    );
  }
  if (As === 'button') {
    return (
      <motion.button type="button" title={title} onClick={onClick} className={className} {...motionProps}>
        {children}
      </motion.button>
    );
  }
  return (
    <motion.div title={title} className={className} {...motionProps}>
      {children}
    </motion.div>
  );
}

const orbBase =
  'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.04] cursor-pointer select-none hover:bg-ink/[0.07] transition-colors duration-200';

/** Which toolkit a button action binds to, if any — `connect:github`/`connect:gmail`
 * (legacy fixed actions) and `toolkit:<slug>` (bound from the settings arranger)
 * all resolve to a slug; pure actions (run, open:roster…) resolve to null. */
function actionToolkit(action: string): string | null {
  if (action === 'connect:github') return 'github';
  if (action === 'connect:gmail') return 'gmail';
  if (action.startsWith('toolkit:')) return action.slice('toolkit:'.length);
  return null;
}

/** `routine:<id>` -> the routine id, or null for every other action. */
function actionRoutine(action: string): string | null {
  return action.startsWith('routine:') ? action.slice('routine:'.length) : null;
}

function ToolkitLogo({ slug }: { slug: string }) {
  const app = APPS.find((a) => a.slug === slug);
  const [failed, setFailed] = useState(false);
  if (!app?.logo || failed) return <span className="text-lg leading-none">⬡</span>;
  return (
    <img
      src={app.logo}
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
      // Deliberately literal white backing (not the themed `ink` scale) —
      // toolkit PNGs assume a white tile regardless of app theme.
      className="h-5 w-5 rounded-sm bg-paper object-contain p-0.5"
    />
  );
}

/** One draggable slot in the bar. Hold ~200ms to pick the orb up and drag it
 * to a new position (framer Reorder, x-axis); a shorter press is a normal
 * click and triggers the orb's action. Reduced motion: no drag — order still
 * renders from prefs, reordering lives in the settings arranger's buttons. */
function OrbSlot({
  button,
  children,
}: {
  button: UserPrefsButton;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const controls = useDragControls();
  const holdTimer = useRef<number | undefined>(undefined);
  // Set the moment a drag actually starts; the click that the browser fires
  // on release is swallowed once, so REORDERING an orb never TRIGGERS it
  // (reported live: dragging ran the orb's action on drop).
  const draggedRef = useRef(false);

  function clearHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  }

  return (
    <Reorder.Item
      as="div"
      value={button}
      dragListener={false}
      dragControls={controls}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (reduceMotion) return;
        clearHold();
        holdTimer.current = window.setTimeout(() => {
          draggedRef.current = true;
          controls.start(e);
        }, HOLD_MS);
      }}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onDragEnd={clearHold}
      onClickCapture={(e: React.MouseEvent) => {
        if (draggedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          draggedRef.current = false;
        }
      }}
      className="relative"
      whileDrag={reduceMotion ? undefined : { scale: 1.12, zIndex: 30 }}
    >
      {children}
    </Reorder.Item>
  );
}

/** The bar orbs — SPEC.md §6, now driven by prefs.buttons: saved order,
 * per-button actions (fixed, `toolkit:<slug>` from the settings arranger, or
 * `routine:<id>`), and hold-drag reordering persisted by the parent.
 * The settings arranger is the single source of truth: EVERY configured
 * button renders here, in its saved order — hiding unconnected-toolkit orbs
 * made the live bar visibly disagree with the arranger ("buttons aren't
 * synced"). Unconnected toolkit orbs render dimmed and click-to-connect. */
export default function Orbs({
  buttons,
  connectedSlugs,
  liveToolkit,
  policyVersion,
  currentUser,
  onToggleUser,
  onConnect,
  onReorder,
  onOpenRoute,
  routines = [],
  onRunRoutine,
  onRun,
  onToggleSuggestions,
  onPollConnections,
}: OrbsProps) {
  const [userSpun, setUserSpun] = useState(false);
  const pollTimers = useRef<{ interval?: number; timeout?: number }>({});

  useEffect(() => {
    return () => {
      if (pollTimers.current.interval) window.clearInterval(pollTimers.current.interval);
      if (pollTimers.current.timeout) window.clearTimeout(pollTimers.current.timeout);
    };
  }, []);

  function stopConnectPoll() {
    if (pollTimers.current.interval) window.clearInterval(pollTimers.current.interval);
    if (pollTimers.current.timeout) window.clearTimeout(pollTimers.current.timeout);
    pollTimers.current = {};
  }

  /** Starts (or restarts) the 3s poll for up to 2 minutes after a connect
   * click — self-clearing, and re-triggering just refreshes the window
   * rather than stacking intervals. */
  function startConnectPoll() {
    if (!onPollConnections) return;
    stopConnectPoll();
    pollTimers.current.interval = window.setInterval(onPollConnections, CONNECT_POLL_INTERVAL_MS);
    pollTimers.current.timeout = window.setTimeout(stopConnectPoll, CONNECT_POLL_WINDOW_MS);
  }

  // Unconnected toolkit orbs are HIDDEN on the live bar (user request —
  // reversed from the earlier dim-and-click-to-connect rendering); the
  // settings arranger still shows every configured button. Retired fixed
  // actions (user/run/bypassCache/suggest/theme — orbs are connection-only
  // now) hide the same way for stale saved prefs.
  const RETIRED_ACTIONS = new Set(['toggle:user', 'toggle:theme', 'run', 'bypassCache', 'suggest']);
  const visibleButtons = buttons.filter((b) => {
    if (RETIRED_ACTIONS.has(b.action)) return false;
    const slug = actionToolkit(b.action);
    return !slug || connectedSlugs.has(slug);
  });

  function handleReorder(nextVisible: UserPrefsButton[]) {
    // Reorder only sees the visible subset — merge it back over the full
    // list so hidden (unconnected) buttons keep their saved slots instead
    // of being dropped from prefs by a drag.
    const visibleIds = new Set(nextVisible.map((b) => b.id));
    const queue = nextVisible.slice();
    onReorder(buttons.map((b) => (visibleIds.has(b.id) ? queue.shift()! : b)));
  }

  function renderOrb(btn: UserPrefsButton) {
    const slug = actionToolkit(btn.action);
    if (slug) {
      // visibleButtons already guarantees `connected` here, but the check
      // stays defensive in case connectedSlugs updates mid-render.
      const connected = connectedSlugs.has(slug);
      const name = btn.label ?? (APPS.find((a) => a.slug === slug)?.name || slug);
      return (
        <Orb
          as="button"
          className={`${orbBase} ${connected ? 'text-ink' : 'text-ink/35'}`}
          title={connected ? `${name} connected` : `Connect ${name}`}
          onClick={() => {
            if (!connected) {
              onConnect(slug);
              startConnectPoll();
            }
          }}
        >
          {liveToolkit === slug && <PulseRings />}
          {slug === 'github' ? <GithubIcon /> : slug === 'gmail' ? <GmailIcon /> : <ToolkitLogo slug={slug} />}
        </Orb>
      );
    }

    const routineId = actionRoutine(btn.action);
    if (routineId) {
      const routine = routines.find((r) => r.id === routineId);
      const name = btn.label ?? routine?.name ?? 'Routine';
      // Several special buttons side by side need distinct faces — the
      // label/name initial reads better than a row of identical ⟳.
      const initial = (btn.label ?? routine?.name ?? '').trim().charAt(0).toUpperCase();
      return (
        <Orb
          as="button"
          className={`${orbBase} text-ink/70`}
          title={routine ? `Run "${name}"` : `${name} (routine not found)`}
          onClick={() => onRunRoutine?.(routineId)}
        >
          {initial ? (
            <span className="text-[13px] font-semibold leading-none">{initial}</span>
          ) : (
            <span className="text-lg leading-none">⟳</span>
          )}
        </Orb>
      );
    }

    switch (btn.action) {
      case 'open:roster':
        // Removed from the bar (user request) — Roster lives in the top nav.
        return null;
      case 'input':
        // The input pseudo-button is rendered by the PARENT as the command
        // bar itself (Bar.tsx splits the row around it) — never as an orb.
        return null;
      case 'toggle:theme':
        // Dark-only now — stale saved theme orbs just don't render.
        return null;
      case 'toggle:user':
        return (
          <Orb
            as="button"
            className={`${orbBase} text-ink/70`}
            title={btn.label ?? 'Account — settings & sign-in'}
            onClick={() => {
              setUserSpun((s) => !s);
              onToggleUser();
            }}
          >
            <span
              className="text-lg leading-none transition-transform duration-500 ease-out"
              style={{ transform: userSpun ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ◑
            </span>
          </Orb>
        );
      case 'run':
        return (
          <Orb as="button" className={`${orbBase} text-ink/70`} title={btn.label ?? 'Run what you typed (Enter)'} onClick={() => onRun?.(false)}>
            <span className="text-[15px] leading-none">▶</span>
          </Orb>
        );
      case 'bypassCache':
        return (
          <Orb as="button" className={`${orbBase} text-ink/70`} title={btn.label ?? 'Run fresh, skip the cache (⌘⏎)'} onClick={() => onRun?.(true)}>
            <span className="text-lg leading-none">⚡</span>
          </Orb>
        );
      case 'suggest':
        return (
          <Orb as="button" className={`${orbBase} text-ink/70`} title={btn.label ?? 'Toggle next-action suggestions'} onClick={() => onToggleSuggestions?.()}>
            <span className="text-lg leading-none">✦</span>
          </Orb>
        );
      default:
        return (
          <Orb className={`${orbBase} text-ink/40`} title={btn.label ?? btn.action}>
            <span className="text-[13px] leading-none">⬡</span>
          </Orb>
        );
    }
  }

  return (
    <Reorder.Group as="div" axis="x" values={visibleButtons} onReorder={handleReorder} className="flex items-center gap-3">
      {visibleButtons.map((btn) => (
        <OrbSlot key={btn.id} button={btn}>
          {renderOrb(btn)}
        </OrbSlot>
      ))}
    </Reorder.Group>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.42.36.78 1.07.78 2.16 0 1.56-.02 2.81-.02 3.19 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
      <path d="M3.5 6l8.5 7 8.5-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
