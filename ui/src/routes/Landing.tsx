import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { entranceStandard, entranceStandardReduced } from '../lib/motion';
import { promptInstall } from '../lib/pwa';

/** The hero IS the product: each example types into the pill, resolves into a
 * one-line answer, then clears for the next. */
const EXAMPLES = [
  { prompt: 'list my open pull requests', answer: '3 open PRs — oldest is feat/auth-flow, 2 days' },
  { prompt: 'your name is Jeff — remember that', answer: 'Saved to memory. Hi, Jeff.' },
  { prompt: 'create a routine that checks my email every morning', answer: 'Routine created — runs daily at 8:00 AM' },
  { prompt: 'post the release notes to Discord', answer: 'Posted to #releases' },
];

const TYPE_MS = 38;
const ERASE_MS = 14;
const ANSWER_DELAY_MS = 450;
const HOLD_MS = 2100;

/** Timer-driven typewriter cycle. When `active` is false (reduced motion)
 * it pins the first example fully typed with its answer shown — no cycling. */
function useTypewriter(active: boolean) {
  const [example, setExample] = useState(0);
  const [text, setText] = useState(active ? '' : EXAMPLES[0].prompt);
  const [showAnswer, setShowAnswer] = useState(!active);

  useEffect(() => {
    if (!active) {
      setText(EXAMPLES[0].prompt);
      setShowAnswer(true);
      return;
    }
    const { prompt } = EXAMPLES[example];
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    for (let i = 1; i <= prompt.length; i++) later(() => setText(prompt.slice(0, i)), i * TYPE_MS);
    const typed = prompt.length * TYPE_MS;
    later(() => setShowAnswer(true), typed + ANSWER_DELAY_MS);
    later(() => setShowAnswer(false), typed + ANSWER_DELAY_MS + HOLD_MS);
    const eraseStart = typed + ANSWER_DELAY_MS + HOLD_MS + 300;
    for (let i = 1; i <= prompt.length; i++)
      later(() => setText(prompt.slice(0, prompt.length - i)), eraseStart + i * ERASE_MS);
    later(() => setExample((e) => (e + 1) % EXAMPLES.length), eraseStart + prompt.length * ERASE_MS + 200);

    return () => timers.forEach((t) => clearTimeout(t));
  }, [active, example]);

  return { text, answer: EXAMPLES[example].answer, showAnswer };
}

/** Full-bleed landing at /welcome — no TopNav, its own minimal chrome. The
 * shared <Background /> mesh (main.tsx) already sits behind every route. */
export default function Landing() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const { text, answer, showAnswer } = useTypewriter(!reduceMotion);
  const entrance = reduceMotion ? entranceStandardReduced : entranceStandard;

  function tryCitizenCall() {
    localStorage.setItem('understudy:visited', '1');
    navigate('/');
  }

  // Entrance springs, staggered by delay — reduced motion collapses to a fade.
  const rise = (delay: number) => ({
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { ...entrance, delay: reduceMotion ? 0 : delay },
  });

  return (
    <div className="relative flex min-h-screen flex-col px-6">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between py-6">
        <span className="text-sm font-semibold tracking-tight text-ink">CitizenCall</span>
        <Link to="/login" className="text-sm text-ink/60 transition-colors hover:text-ink">
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
        <motion.h1 {...rise(0)} className="text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
          Ask once.
        </motion.h1>
        <motion.p {...rise(0.06)} className="mt-5 max-w-md text-base leading-relaxed text-ink/60">
          One command bar for 1,200+ apps. CitizenCall routes each request to a cheap specialist
          model, verifies the answer, and remembers you.
        </motion.p>

        <motion.div {...rise(0.12)} className="mt-12 w-full">
          <button
            type="button"
            onClick={tryCitizenCall}
            aria-label="Try CitizenCall"
            className="bar-pill flex w-full items-center gap-3 px-6 py-4 text-left"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-base text-ink/90" aria-hidden>
              {text}
              {!reduceMotion && (
                <span className="ml-0.5 inline-block h-5 w-[2px] translate-y-[3px] animate-pulse rounded-full bg-accent" />
              )}
            </span>
            <span className="hidden shrink-0 text-xs text-ink/40 sm:block" aria-hidden>
              ⌘K
            </span>
          </button>
          {/* Fixed-height slot so the answer appearing never shifts the layout. */}
          <div className="mt-4 h-6" aria-hidden>
            <AnimatePresence mode="wait">
              {showAnswer && (
                <motion.p
                  key={answer}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={entrance}
                  className="text-sm text-ink/60"
                >
                  <span className="mr-1.5 text-accent">✓</span>
                  {answer}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div {...rise(0.18)} className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
          <button
            type="button"
            onClick={tryCitizenCall}
            className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-paper shadow-glow-accent transition-colors hover:bg-accent-bright"
          >
            Try CitizenCall
          </button>
          <button
            type="button"
            onClick={() => {
              // PWA install (replaced the Electron download): Chrome-family
              // shows the native dialog; Safari has no prompt API, so the
              // fallback is a one-line instruction.
              void promptInstall().then((ok) => {
                if (!ok) window.alert('Install CitizenCall: in Safari use File → Add to Dock; in Chrome click the install icon in the address bar.');
              });
            }}
            className="text-sm text-ink/60 transition-colors hover:text-ink"
          >
            Install the app&nbsp;↓
          </button>
        </motion.div>
      </main>

      <motion.footer {...rise(0.24)} className="pb-10 pt-6">
        <p className="text-center text-sm text-ink/40">
          94.8% cheaper
          <span className="mx-3 text-ink/20">·</span>
          verified answers
          <span className="mx-3 text-ink/20">·</span>
          1,200+ apps
        </p>
      </motion.footer>
    </div>
  );
}
