// L3 plan cache is EXACT match on normalized text (SPEC.md §8) — lowercase,
// strip punctuation, collapse whitespace. Not semantic; these tests pin down
// exactly what "normalized" means so the cache-scoping demo shot (identical
// intent, different phrasing -> same key) stays honest.
import { describe, expect, it } from 'vitest';
import { normalizePlanKey } from '../src/cache/plan';

describe('normalizePlanKey', () => {
  it('lowercases the input', () => {
    expect(normalizePlanKey('Summarize This Week')).toBe('summarize this week');
  });

  it('strips punctuation', () => {
    expect(normalizePlanKey("What changed in the repo, this week?!")).toBe('what changed in the repo this week');
  });

  it('collapses repeated whitespace, including newlines and tabs', () => {
    expect(normalizePlanKey('summarize   this\n\tweek')).toBe('summarize this week');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizePlanKey('  summarize this week  ')).toBe('summarize this week');
  });

  it('two differently-punctuated phrasings of the same request collapse to one key', () => {
    const a = normalizePlanKey('Summarize this week\'s repo changes.');
    const b = normalizePlanKey('summarize this weeks repo changes');
    expect(a).toBe(b);
  });

  it('is exact-match, not semantic: a real paraphrase does NOT collapse to the same key', () => {
    const a = normalizePlanKey('Summarize this week\'s repository changes.');
    const b = normalizePlanKey('Tell me what changed in the repo this week.');
    expect(a).not.toBe(b);
  });
});
