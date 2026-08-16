// Lexical-semantic similarity for the L3 plan cache near-match path (SPEC.md
// §8 "semantic L3" future work, implemented without embedding infra — there is
// no embedding provider on this stack, so matching is lexical: token-set
// Jaccard plus a character-trigram Dice coefficient).
//
// Everything here is pure and operates on ALREADY-NORMALIZED plan keys
// (normalizePlanKey output: lowercase, punctuation stripped, single-spaced).
//
// Threshold tuning (measured against the fixtures in tests/plan-semantic.test.ts):
//   positives  — "summarize this weeks repo changes" vs "give me a summary of
//                the repository changes from this week"  → jaccard 1.00, trigram 0.67
//                "what changed in the repo this week" vs "tell me what changed
//                in the repository this week"             → jaccard 1.00, trigram 0.72
//   negatives  — best impostor observed ("summarize my recent emails" vs
//                "summarize my recent expenses")          → jaccard 0.50, trigram 0.73
// The token channel is primary because soft token matching already absorbs
// morphology (repo/repository, summary/summarize, week/weeks), which keeps
// positive Jaccard near 1.0 while topical negatives stay ≤ 0.5. The global
// trigram channel is a secondary confirmation (floor 0.60) plus its own high
// branch (0.88, with Jaccard ≥ 0.70) for near-identical strings the tokenizer
// splits oddly. Both branches keep ≥ 0.15 margin over the worst negative.
import type { Plan } from '../types';

export const JACCARD_HI = 0.82;
export const TRIGRAM_FLOOR = 0.6;
export const TRIGRAM_HI = 0.88;
export const JACCARD_FLOOR = 0.7;
// Two tokens that soft-match count as the same concept; below this the pair is
// distinct. 0.6 lets summary/summarize (0.67) through and keeps commits/emails out.
const TOKEN_MATCH_DICE = 0.6;

// Function words and imperative filler ("give me", "show me", "please") that
// carry no task content. Time-scope words (week, today, recent, …) are
// deliberately NOT stopwords: a plan minted for "this week" must not be
// borrowed by a "today" prompt — the cached instructions embed the time window.
const STOPWORDS = new Set(
  (
    'a an the this that these those is are was were be been being i you we they ' +
    'it its my your our their me us of in on at for to from with about as and or ' +
    'but if then so please give show tell get what whats how do does did can ' +
    'could would should will'
  ).split(' ')
);

/** Deduplicated, sorted content tokens of a normalized plan key. */
export function contentTokens(normalizedKey: string): string[] {
  const seen = new Set<string>();
  for (const word of normalizedKey.split(' ')) {
    if (word && !STOPWORDS.has(word)) seen.add(word);
  }
  return [...seen].sort();
}

function trigramSet(s: string): Set<string> {
  if (s.length < 3) return new Set(s ? [s] : []);
  const out = new Set<string>();
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigram sets — 0 when either side is empty. */
export function trigramDice(a: string, b: string): number {
  const ta = trigramSet(a);
  const tb = trigramSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const g of ta) if (tb.has(g)) common++;
  return (2 * common) / (ta.size + tb.size);
}

// Soft token equality: exact, prefix (≥4 chars — repo/repository, week/weeks),
// or per-token trigram Dice (summary/summarize).
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && long.startsWith(short)) return true;
  return trigramDice(a, b) >= TOKEN_MATCH_DICE;
}

/** Jaccard over token sets with soft (morphology-tolerant) token equality. */
export function tokenSetJaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const unmatched = new Set(b);
  let matched = 0;
  for (const t of a) {
    for (const candidate of unmatched) {
      if (tokensMatch(t, candidate)) {
        unmatched.delete(candidate);
        matched++;
        break;
      }
    }
  }
  return matched / (a.length + b.length - matched);
}

export interface PlanSimilarity {
  jaccard: number;
  trigram: number;
}

export function planSimilarity(aTokens: readonly string[], bTokens: readonly string[]): PlanSimilarity {
  return {
    jaccard: tokenSetJaccard(aTokens, bTokens),
    // Sorted-token join makes the trigram channel word-order independent.
    trigram: trigramDice(aTokens.join(' '), bTokens.join(' ')),
  };
}

/** Accept only when BOTH channels clear a bar (see tuning note in the header). */
export function isNearMatch(s: PlanSimilarity): boolean {
  return (s.jaccard >= JACCARD_HI && s.trigram >= TRIGRAM_FLOOR) || (s.trigram >= TRIGRAM_HI && s.jaccard >= JACCARD_FLOOR);
}

// ---------------------------------------------------------------------------
// Toolkit safety gate — a wrong plan is worse than a slow plan. A near-match
// may only be accepted when its plan's toolkit requirements are implied by the
// new prompt's own words, and vice versa (an email-ish prompt must never
// inherit a github plan, and a github-ish prompt must never inherit an email
// or no-tool plan). On any doubt: MISS, and let the model plan.
// ---------------------------------------------------------------------------

const TOOLKIT_SIGNALS: Record<string, RegExp> = {
  github: /\b(commit|commits|repo|repos|repository|repositories|pull|pr|prs|github|branch|branches|merge|merges|issue|issues)\b/,
  gmail: /\b(email|emails|gmail|inbox|mail|mails|message|messages)\b/,
};

export function planToolkits(plan: Plan): Set<string> {
  const out = new Set<string>();
  for (const st of plan.subTasks) if (st.toolCall) out.add(st.toolCall.toolkit);
  return out;
}

export function toolkitGateAllows(normalizedKey: string, promptTokens: readonly string[], plan: Plan): boolean {
  const implied = new Set<string>();
  for (const [toolkit, signal] of Object.entries(TOOLKIT_SIGNALS)) {
    if (signal.test(normalizedKey)) implied.add(toolkit);
  }
  const required = planToolkits(plan);
  const tokenSet = new Set(promptTokens);
  for (const toolkit of required) {
    // Unknown (MCP) toolkits have no signal lexicon — require the toolkit name
    // itself to appear in the prompt's tokens, else refuse.
    const ok = toolkit in TOOLKIT_SIGNALS ? implied.has(toolkit) : tokenSet.has(toolkit);
    if (!ok) return false;
  }
  // Symmetric direction: if the prompt clearly implies a builtin toolkit the
  // plan never touches, it is a different task — miss.
  for (const toolkit of implied) if (!required.has(toolkit)) return false;
  return true;
}
