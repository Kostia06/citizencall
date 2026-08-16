// "What can you do?" fast path. The FIRST thing every new visitor types is
// an identity/capability question, and rung-0 (1.5B) answered it with
// degenerate generic-assistant sludge that the schema verifier happily
// passed (seen live: an endless repeated "travel tips" bullet list). These
// prompts have one correct answer — what UNDERSTUDY actually does — so they
// are answered deterministically: accurate, instant, and $0.
import type { TraceEvent } from '../types';
import { buildRunEndEvent } from './trace';
import { finalizeRun, saveRunAnswer } from '../db';

// Deliberately narrow: bare identity/capability questions only. Anything
// with real content around it ("can you draft an email…") must still go
// through the pipeline. Length cap keeps "what can you do about X" out.
const CAPABILITY_RE =
  /^(hey |hi |hello |yo )?(so |um )?(what (can|do) (you|u) do|what are you( for)?|who are you|what is (this|understudy)|what does (this|understudy) do|how (do|does) (you|this|understudy) work|help|what can i (do|ask)( here)?|what should i ask)\??!?\.?$/i;

export function isCapabilityIntent(text: string): boolean {
  const t = text.trim();
  return t.length <= 60 && CAPABILITY_RE.test(t);
}

const CAPABILITY_ANSWER = `I'm **Understudy** — one command bar that routes each request to a cheap specialist model, **verifies the answer**, and escalates only when the check fails. Ask me anything, or try:

- **Use your apps** — connect GitHub, Gmail, Discord and 1,200+ more, then "list my open pull requests" or "summarize my unread emails"
- **Remember you** — "my name is Jeff — remember that" (see the Memory page)
- **Automate** — "create a routine that checks my email every morning", then bind it to a bar button
- **Answer & write** — questions, comparisons, code, drafts — with the cost and model of every step in the trace below the answer

There's also a macOS Spotlight-style bar — press ⌥Space anywhere (Settings → Personal → Download).`;

/** Same event/persist contract as the routine-intent fast path: answer +
 * run_end + finalized row, so the stream, history, and GET /api/run/:id all
 * behave like a normal (just instant and free) run. */
export async function answerCapability(
  db: D1Database,
  emit: (e: TraceEvent) => void,
  body: { runId: string; userId: string }
): Promise<void> {
  const startedAt = Date.now();
  emit({ t: 'answer', subTaskId: 'capability-intent', text: CAPABILITY_ANSWER });
  await saveRunAnswer(db, body.runId, CAPABILITY_ANSWER).catch(() => undefined);
  const totalMs = Date.now() - startedAt;
  emit(buildRunEndEvent(body.runId, [], totalMs, 0));
  await finalizeRun(db, body.runId, { totalCostUsd: 0, baselineCostUsd: 0, totalMs, cacheHits: 0, planCacheHit: false });
}
