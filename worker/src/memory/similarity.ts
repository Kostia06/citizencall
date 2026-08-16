// Tiny keyword-similarity kit shared by retrieval (context.ts) and
// reconciliation (reconcile.ts). Deliberately dumb — no embeddings on this
// stack — but consistent: everything that compares memory text does it
// through these three functions.

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

/** How many of `tokens` appear in `text`. */
export function overlapScore(tokens: Set<string>, text: string): number {
  let score = 0;
  for (const tok of tokenize(text)) {
    if (tokens.has(tok)) score++;
  }
  return score;
}

/** Jaccard similarity of two token sets — 1 means identical vocabulary.
 * Used to drop near-duplicate facts at injection time. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
