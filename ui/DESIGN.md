# Understudy — Kinetic Visual System

Evolution spec, not a rewrite. Everything below builds on the existing dark glass pill
(`index.css` `.bar-pill`, `.bar-shell`, the `@property --a` conic border) and the existing
Tailwind keyframes (`bar-in`, `hop-in`, `shake`, `breathe`, `ring-expand`, `chip-pop`,
crossfade). Where a spec below says "keep," the implementer changes nothing. Where it says
"extend" or "add," it's new work layered on top of what's there.

---

## 1. Art direction

**One line:** *The routing decision made visible as current — a dark glass control surface
with a living signal moving underneath it, the way electricity looks in a circuit diagram.*

**Mood:** premium, fast, quietly expensive. Not playful-bouncy, not corporate-flat. Closer to
a trading terminal that got a design pass than a marketing site.

**References (name real things):**
- **Linear.app** — the type discipline, the restraint on color count, how their gradient mesh
  backgrounds sit *behind* content and never compete with it.
- **Arc browser / Raycast** — glass surfaces, magnetic hover, command-palette-first UI language
  (directly relevant: this *is* a command bar).
- **Stripe's gradient mesh / aurora backgrounds** — the canvas-mesh technique this spec
  specifies in §4.
- **Vercel / Framer marketing sites** — oversized display type as the primary visual event,
  motion that arrives once and settles, never loops distractingly in the foreground.
- **Cuberto / Lusion (Awwwards-tier studios)** — magnetic buttons, cursor-reactive glow,
  staggered blur-in reveals — the *texture* of motion this spec borrows, dialed back for a
  data-dense product instead of a portfolio site.

**The one new idea this spec adds:** a literal "current" motif. The conic-gradient running
border already reads as electricity circling the bar while a run is live (§6 of SPEC.md, kept
as-is). This spec extends that motif down into the trace: a thin accent line grows down the
left edge of `TracePipeline` in sync with content, like a circuit trace being etched as the
run executes. Same visual language, top to bottom, decoration that's actually load-bearing —
it's the run's live spine.

---

## 2. Design tokens

### Color

**Dark base** (extends existing `surface.*` in `tailwind.config.js`):

| token | value | use |
|---|---|---|
| `void` | `#050506` | canvas fallback, outermost background |
| `surface` (existing) | `#1C1C1E` | glass pill base |
| `surface-raised` (existing) | `#242426` | dropdowns, secondary cards |
| `surface-sunken` (existing) | `#141416` | inset/well elements |
| `hairline` | `rgba(255,255,255,0.08)` | default borders (existing `border-white/10`-ish usage) |
| `hairline-bright` | `rgba(255,255,255,0.28)` | top-edge pill border (existing) |

**Text:**

| token | value |
|---|---|
| `text-primary` | `rgba(255,255,255,0.92)` |
| `text-secondary` | `rgba(255,255,255,0.55)` |
| `text-tertiary` | `rgba(255,255,255,0.35)` |
| `text-quaternary` | `rgba(255,255,255,0.25)` |

**The one bold accent** — keep the existing blue exactly, it's already good, don't introduce a
second "brand" color:

| token | value | use |
|---|---|---|
| `accent` (existing) | `#5B8CFF` | primary interactive color, links, running state |
| `accent-bright` (existing) | `#8FB0FF` | escalation label, emphasis text on accent |
| `accent-dim` (existing) | `#3E5FBE` | pressed/muted accent |
| `accent-glow` | `rgba(91,140,255,0.45)` | box-shadow glow, focus rings |

**Status** (unchanged from current Tailwind defaults already in use — don't rename):
`emerald-400` = pass/success, `red-400` = fail/danger.

**Ember — one transient, kinetic-only hue.** Not a persistent UI color. Used only for the
~150ms flash that distinguishes "escalation just happened" and "⇧⏎ bypassed cache" from
steady-state blue, then it's gone:

| token | value |
|---|---|
| `ember` | `#FF8B5E` |
| `ember-glow` | `rgba(255,139,94,0.4)` |

**Gradient mesh stops** (background only — §4 — never used as foreground UI color, this is
what makes the background feel alive without competing with the accent):

```
mesh-1  #0B0F2E   deep indigo-navy
mesh-2  #1B1464   violet-indigo
mesh-3  #5B8CFF   signal blue (same hex as accent — ties the mesh to the brand)
mesh-4  #22D3EE   cyan
mesh-5  #7C3AED   violet
mesh-6  #FF4D8D   magenta (used sparingly, lowest opacity blob)
```

### Type scale

Base 16px. `display-*` are new; everything else formalizes/extends sizes already in the
codebase (e.g. Roster's `clamp(1.75rem,4vw,2.75rem)` becomes `headline-1`).

| token | size | weight | line-height | tracking | use |
|---|---|---|---|---|---|
| `display-1` | `7rem` (112px) | 700 | 0.95 | -0.03em | hero stat, if a screen ever needs one number to fill it |
| `display-2` | `4.5rem` (72px) | 700 | 1.0 | -0.02em | large but secondary hero numbers |
| `headline-1` | `clamp(2rem,4.5vw,3.5rem)` | 600 | 1.1 | -0.01em | Roster/Benchmark page h1 |
| `headline-2` | `clamp(1.5rem,3vw,2rem)` | 600 | 1.15 | -0.005em | section headers |
| `title` | `1.125rem` (18px) | 600 | 1.3 | 0 | card titles |
| `body-lg` | `1rem` (16px) | 400 | 1.5 | 0 | lede paragraphs |
| `body` | `0.9375rem` (15px) | 400 | 1.5 | 0 | command bar input, default body (matches existing) |
| `label` | `0.8125rem` (13px) | 500 | 1.4 | 0 | HopCard reasons, table cells |
| `caption` | `0.6875rem` (11px) | 500 | 1.3 | 0.08em, uppercase | badges, meta rows (matches existing `text-[11px] uppercase`) |
| `mono` | inherits size | 400–500 | 1.4 | 0 | model IDs, costs — existing `font-mono` stack |

### Spacing / radius / elevation

Spacing: standard 4px grid — `1`=4px … `4`=16px … `8`=32px … `16`=64px … `32`=128px (Tailwind
defaults are fine as-is; no new scale needed, just use it consistently for the new hero
sections in §5).

Radius:

| token | value | existing use |
|---|---|---|
| `pill` | `9999px` | bar, chips (existing) |
| `2xl` | `1rem` | cards (existing `rounded-2xl`) |
| `xl` | `0.75rem` | secondary cards |
| `lg` | `0.625rem` | small controls |
| `sm` | `0.375rem` | inline chips |

Elevation/blur:

| token | value | use |
|---|---|---|
| `glass-strong` | `blur(34px) saturate(180%)` | bar pill (existing, unchanged) |
| `glass-soft` | `blur(20px) saturate(150%)` | dropdowns, table container |
| `shadow-lift` | `0 8px 30px rgba(0,0,0,0.35)` | hovered/lifted elements (magnetic orbs) |
| `shadow-glow-accent` | `0 0 24px rgba(91,140,255,0.35)` | focus rings, running state |
| `shadow-glow-ember` | `0 0 20px rgba(255,139,94,0.4)` | transient escalation/bypass flash |

---

## 3. Motion system

Two engines: **CSS keyframes** (existing `tailwind.config.js` pattern) for anything
declarative and repeatable, **framer-motion** (new dependency — `pnpm add framer-motion`) for
anything that needs a real spring, gesture tracking, or layout animation (magnetic orbs,
`AnimatePresence`/`layout` on `TracePipeline`, shared-element highlight on suggestions).
Canvas background (§4) is neither — it's rAF-driven procedural drawing, no library needed.

### Spring configs (framer-motion `transition` objects)

| class | config | settle time | feel | CSS equivalent (if done as keyframe/transition instead) |
|---|---|---|---|---|
| `entrance-standard` | `{ type:'spring', stiffness:210, damping:26, mass:1 }` | ~550ms | matches existing `bar-in`/`hop-in` exactly | `cubic-bezier(0.22,1,0.36,1)`, 550ms |
| `magnetic-snappy` | `{ type:'spring', stiffness:420, damping:18, mass:0.9 }` | ~220ms | quick, slight overshoot | — (JS-driven, no CSS equivalent) |
| `layout-flow` | `{ type:'spring', stiffness:300, damping:32, mass:1 }` | ~350ms | smooth reflow, no overshoot | `cubic-bezier(0.25,1,0.5,1)`, 350ms |

### Timed (non-spring) motion

| class | curve | duration | use |
|---|---|---|---|
| `shake-impact` | `cubic-bezier(.36,.07,.19,.97)` (existing `shake` keyframe) | 450ms | HopCard failure |
| `count-up` | cubic ease-out (existing `useCountUp`, `1-(1-x)^3`) | 650–900ms | cost/savings numbers |
| `micro` | `ease-out` | 150–200ms | hover color/opacity, ghost-text snap |
| `standard` | `ease-out` | 250–350ms | dropdown open/close, chip states |
| `ambient-loop` | linear, procedural (sin/cos, no easing) | 18–30s/cycle | background mesh blobs |

### Stagger timing

| context | per-item delay |
|---|---|
| HopCard list (existing) | 70ms |
| Roster table rows (new) | 40ms |
| Roster headline lines (new) | 60ms |
| Benchmark bars (new) | 90ms, left→right |
| Suggestion dropdown rows (new) | 30ms |

### Reduced-motion fallback — one per class, not a global blanket

Extend the existing `@media (prefers-reduced-motion: reduce)` block in `index.css`; for
framer-motion usage, gate every spring behind the library's own `useReducedMotion()` hook.

| class | reduced-motion fallback |
|---|---|
| `entrance-standard` | opacity fade only, 150ms linear, no transform/blur |
| `magnetic-snappy` | disable cursor tracking entirely; hover = background-color change only |
| `layout-flow` | instant reflow, content appears in place, no animated height |
| `shake-impact` | replace oscillation with a single 200ms border/opacity flash (translateX shake is a motion-sickness trigger — never keep it under reduced-motion) |
| `count-up` | snap to final value immediately, skip the rAF loop |
| `ambient-loop` | canvas draws exactly one static frame, rAF loop never starts |

### Performance budget

- **60fps target** (16.6ms/frame) on a mid demo laptop while SSE/mock trace events, the
  background mesh, and any hover motion all run concurrently.
- **Transform/opacity/filter only** for anything that runs more than one frame. The one
  existing exception is Benchmark's bar `height` transition (§5) — flagged there as a
  recommended `scaleY` migration, not a blocker.
- **`will-change: transform`** applied only while an element is actively animating (framer-
  motion does this automatically for spring-animated props; for manual CSS, toggle it on
  `mouseenter`/animation-start and remove on `mouseleave`/animation-end). Never leave it set
  on a static element — stray compositor layers are the most common cause of a demo laptop
  dropping frames mid-run.
- **Canvas background**: `devicePixelRatio` capped at 1.5, internal resolution ≤ 0.3× the
  viewport, rAF throttled to ~30fps (skip alternate ticks), paused via
  `document.visibilitychange` when the tab isn't active.
- **If frame budget is tight during the actual run** (trace growing + background live +
  hover), degrade the *background* first (fewer blobs, lower resolution) — never the
  foreground trace motion. The trace is what's on camera.

---

## 4. The animated background

**Canvas 2D gradient mesh, not WebGL/shader, not three.js.** Justification: the visual target
(soft aurora blobs, cursor-reactive drift) doesn't need a fragment shader, and a hackathon
timeline doesn't afford debugging GLSL Saturday night. Canvas 2D with heavy CSS blur gets 90%
of the visual result for a fraction of the risk.

**Build:**

1. One `<canvas>`, `position: fixed; inset: 0; z-index: 0; pointer-events: none;`, sitting
   behind `#root`'s content (content wrapper gets `position: relative; z-index: 1;`). The
   existing static `body` radial gradient (`index.css` lines 24–26) stays as the pre-JS paint
   — the canvas fades in over 400ms once its first frame is ready, so there's never a flash of
   unstyled background.
2. Internal canvas resolution = viewport × 0.25–0.3 (e.g. ~480×270 for a 1920×1080 viewport),
   scaled up to full size via CSS `width/height: 100%`. The upscaling blur is a feature: apply
   `filter: blur(80px)` on the canvas element itself (CSS blur, not per-pixel canvas blur —
   free on the GPU, and it's what hides the low internal resolution).
3. **4–6 radial-gradient "blobs."** Each blob: a center point drifting along a slow Lissajous-
   ish path (`x = cx + sin(t*f1)*ax`, `y = cy + cos(t*f2)*ay`, distinct low frequencies `f1,
   f2` per blob so they never sync), a radius, and a color interpolated between two of the six
   mesh stops (§2) over the blob's lifecycle. Draw each with
   `ctx.createRadialGradient(...)` fading to transparent, composited with
   `globalCompositeOperation = 'lighter'` over a `mesh-1`/`void` base fill so overlaps glow
   instead of muddying.
4. **Cursor reactivity, not cursor-follow.** Track pointer position with a simple exponential
   smoothing toward the target (`pos += (target - pos) * 0.06` per frame — a cheap lerp, no
   physics engine needed). Bias exactly **one** blob's center toward the smoothed cursor
   position, clamped to a max offset of ~120px from its natural path. This reads as "the field
   is aware of you" without literal cursor-chasing, which feels gimmicky and can be nauseating
   at 30fps.
5. **Throttle:** redraw every other `requestAnimationFrame` tick (~30fps) — smooth enough once
   softened by the CSS blur, half the cost of 60fps.
6. **Pause when hidden:** `document.addEventListener('visibilitychange', ...)` — cancel the
   rAF loop when `document.hidden`, restart on return.
7. **Reduced motion:** draw one frame (blobs at `t=0`, no cursor bias) and stop. No loop ever
   starts.
8. **Opacity ceiling:** the whole canvas layer sits at `opacity: 0.4–0.55` behind content —
   text contrast is checked against the *brightest* possible mesh moment, not the average.

---

## 5. Component-by-component motion spec

### Command bar (`CommandBar.tsx`, `index.css` `.bar-pill`/`.bar-shell`)

- **Entrance:** keep `animate-bar-in` exactly (`scale(.955) blur(6px)` → settled, existing
  cubic-bezier). Trigger once on first mount only, not on every re-render.
- **Running state (conic border):** keep the existing `spin-a` 2.4s linear loop. **New:** on
  the `escalate` trace event, spike the ring's `animation-duration` to `1.2s` for 400ms (set
  inline style, then revert) — a visible "the current sped up" cue synced to the moment
  something went wrong and got caught. Cheap (one style mutation), reads clearly on camera.
- **Focus (⌘K):** on focus, one-shot `box-shadow` pulse: `0 0 0 0 accent-glow` →
  `0 0 0 6px transparent` over 400ms ease-out. Signals "you're driving now" without being a
  looping ring.
- **Magnetic orbs** (`Orbs.tsx`): add cursor-proximity magnetism. Within a 40px halo around
  each orb, translate it toward the cursor up to 6px max, using `magnetic-snappy` spring via
  framer-motion `useMotionValue`/`useSpring` (or a small manual lerp hook if avoiding the
  dependency for just this). Layer on top of — don't replace — the existing hover
  `translateY(-3px) scale(1.06)`; drive that via `whileHover` with the same spring instead of
  the current CSS transition, for a slightly livelier settle.
- **⇧⏎ (bypass cache):** distinct visual tell from a normal run — one-shot `ember-glow` flash
  on the pill edge, 150ms, so "cache bypassed" is legible on camera without narration.

### Mic (`Mic.tsx`)

- **Idle → recording:** mic glyph crossfades to the red dot, 150ms ease (currently instant).
- **Breathing ring:** keep `animate-breathe` (1.6s) exactly.
- **Waveform bars:** keep the 5-bar `AnalyserNode` canvas approach. Add per-bar smoothing —
  `barHeight = lerp(prevHeight, targetHeight, 0.35)` each frame — so bars settle instead of
  jitter frame-to-frame. Still pure canvas `fillRect`, zero DOM cost, no budget impact.

### TracePipeline (`TracePipeline.tsx`) — downward growth

- **The signature new motion:** a 2px accent-gradient line running down the left margin of
  the trace column, growing in height in sync with content as it mounts, with a small
  pulsing dot (radius 3px, `animate-breathe`-style, 1.2s) at its leading edge — the "circuit
  being etched" motif from §1. Implement as an absolutely positioned `motion.div` inside the
  trace container, animating `height` via the `layout-flow` spring as sibling content grows
  the container's natural height (framer-motion `layout` prop on the container handles the
  reflow; the line just tracks `scrollHeight` or a ref-measured value).
- **Block-level reveal:** wrap `NormalizeBlock`, each sub-task group, and `RunEndSummary` in
  `AnimatePresence` + `layout`, so new blocks pushing content below them animate the reflow
  with `layout-flow` (350ms, no overshoot) instead of an abrupt jump — this is the actual fix
  for "downward growth" reading as *smooth* growth rather than layout pops.
- Keep everything else (existing `NormalizeBlock` crossfade, `RunEndSummary` count-up)
  unchanged.

### HopCard (`HopCard.tsx`) — the SPEC §15 key beat

- **Staggered blur-in:** keep `animate-hop-in` with the existing 70ms×index stagger exactly.
- **Failure shake, enhanced:** keep the `shake` keyframe (450ms) as the base. Add a
  synchronized `shadow-glow-ember` red-tinted flash (box-shadow `0 → ember-glow(30%) → 0` over
  the same 450ms) so the failure reads as "caught" rather than just "wiggled."
- **Escalation arrow reveal — sequenced, not simultaneous.** This is the shot SPEC §15 names
  explicitly ("we catch it before you ever see it, and step up one rung"), so pace it for the
  camera:
  1. Failed HopCard shakes + flashes (450ms).
  2. 120ms pause (let the failure register).
  3. Escalation line (`↓ catching the failure — stepping up one rung`) reveals via a
     350ms ease-out slide+fade (keep the existing `animate-hop-in` class on this element; it
     already does translateY+blur+fade, which is the right texture here — no new keyframe
     needed).
  4. New (escalated) HopCard blur-in enters immediately after, staggered as normal.
  Total sequence: **~1.4s**, deliberately readable, never rushed — this is the four seconds
  SPEC calls "the thesis" and it should not be undersold by being too fast to read.

### Cost count-up

- Keep `useCountUp`'s cubic ease-out exactly (650–900ms).
- Add a settle pulse on the `RunEndSummary` total only: `scale(1) → scale(1.04) → scale(1)`
  over 200ms, timed to fire when the count-up animation completes (not a loop, one-shot).

### Roster (`Roster.tsx`) — the cold-open, SPEC §15 0:00–0:20

This is where oversized display type earns its place. The headline block is the one moment in
the whole app that should feel like a title card, not a UI screen.

- **Headline reveal:** split the `<h1>` into its natural line breaks (CSS `clamp` already
  wraps it responsively — split by rendered line via a wrapping `<span>` per phrase, e.g.
  "{downloads} downloads." / "Nobody uses {model}." as two lines) and stagger each line in
  with `entrance-standard`, 60ms apart: `translateY(24px) blur(8px) opacity:0` →
  settled. Framer-motion `variants` with a parent `staggerChildren: 0.06`.
- **Table rows:** replace the current flat mount with a 40ms-per-row stagger,
  `translateY(8px) opacity:0 → settled`, keyed off `roster` finishing its fetch (mock mode:
  fires as soon as `fetchRoster()` resolves — near-instant, but the stagger should still play,
  don't skip it just because the data arrived fast).
- Keep the skeleton-row loading state exactly as-is.

### Benchmark (`Benchmark.tsx`) — the four bars

- **Stagger the bars.** Currently all four animate simultaneously on data arrival. Add a 90ms
  `transition-delay` per bar index (left→right) so they read as a sequence, not a single pop.
- **Recommended perf fix (flagged, not blocking):** migrate the bar-height animation from
  `height` (layout-triggering, the one exception to the transform/opacity budget in §3) to
  `transform: scaleY(x)` with `transform-origin: bottom`. Same visual result, GPU-only. Do
  this if time allows; the existing `height` transition is not broken and can ship as-is if
  Saturday is tight.
- **Wire `useCountUp`** (already built, used elsewhere) onto each bar's dollar-amount label so
  the numbers materialize in sync with the bar growing, instead of rendering final values
  immediately.

---

## 6. Interaction inventory

| interaction | existing behavior | motion to add |
|---|---|---|
| `⌘K` | focuses input | focus glow pulse (§5 Command bar) |
| `↑ / ↓` | cycles suggestion highlight via class swap | shared-element highlight: a background pill that *slides* between rows via framer-motion `layoutId`, `magnetic-snappy` spring, instead of an instant class change |
| `⏎` | runs the command | brief confirm pulse on the bar: `scale(1) → 1.015 → 1`, 200ms ease-out, as the run starts |
| `⇧⏎` | runs bypassing cache | same confirm pulse **plus** the `ember-glow` edge flash (§5) — visually distinct from a plain `⏎` |
| `Tab` | accepts ghost autocomplete | ghost text snaps from `text-quaternary` to full white via 120ms crossfade, no transform |
| `Esc` | clears input | existing text scales down + fades, 100ms, before clearing (instead of an abrupt clear) |
| drag-drop | dashed border + `scale(1.022)` + chip pop-in | keep exactly; add a full-viewport radial accent glow at 4–8% opacity fading in during drag-over, cheap single-div opacity transition, for extra drama on camera |
| hover: orbs | `translateY(-3px) scale(1.06)` | add magnetic pull (§5), same spring |
| hover: suggestion rows | background color change | keep, no change needed |
| hover: Roster table rows | background color change | add a 2px accent border-left tick that slides in from the left over 150ms |

---

## 7. What NOT to break

- **The scripted mock run must still play end-to-end unmodified.** `mock/scenario.ts`'s
  `TraceEvent` timeline and `lib/traceReducer.ts`'s state transitions are the product — motion
  wraps around trace events, it never gates or delays their arrival. If a motion sequence
  (e.g. the 1.4s escalation beat in §5) would visually overlap two events arriving close
  together, let it — don't add artificial delays to `scenario.ts` to "make room" for animation.
- **All three routes** (`/`, `/roster`, `/benchmark`) stay reachable and functional exactly as
  now — new entrance/stagger motion on Roster and Benchmark must not block content from
  rendering if `fetchRoster`/`fetchBenchmark` resolve instantly (mock mode does).
- **Keyboard flows preserved exactly:** `⌘K` focus, `↑↓` navigate, `⏎` run, `⇧⏎` bypass cache,
  `Tab` accept ghost, `Esc` clear — the *logic* in `CommandBar.tsx` doesn't change, only what
  visually happens on top of it.
- **`prefers-reduced-motion: reduce` must disable or simplify every new animation added**,
  per the fallback table in §3 — not just the animations already covered by the existing
  `index.css` media query. That includes: the canvas background (one static frame, no loop),
  magnetic orbs (disabled, plain hover only), the trace's growing accent line (appears at full
  height instantly, no growth animation), and the Roster/Benchmark staggers (content appears
  in place, no stagger delay).
- **Canvas background is `pointer-events: none` and z-index 0, always.** It must never
  intercept drag-drop, clicks, or text selection — DropZone's window-level listeners assume
  nothing else in the DOM is eating drag events.
- **Demo shots stay filmable — motion supports the narrative, never obscures the numbers.**
  Concretely: the escalation sequence (§5) is ~1.4s, not longer — SPEC §15 budgets 0:40–1:05
  (25s) for the whole run-and-catch narration, and a bloated animation sequence eats into that.
  Count-up animations (650–900ms) must finish well before a narrator would reference the
  number on camera. Nothing decorative should run longer than ~1s in the foreground trace path.
- **60fps holds during the actual demo condition**: mock trace streaming + background mesh +
  any hover motion, all concurrent, on the machine used to film. If it doesn't, degrade the
  background first (§3) — the foreground trace is what's on camera and is non-negotiable.
- **The existing Tailwind keyframes stay as the foundation.** `bar-in`, `hop-in`, `shake`,
  `breathe`, `ring-expand`, `chip-pop`, and the crossfade classes are correct as-is and are
  reused/extended throughout this spec, not replaced.
