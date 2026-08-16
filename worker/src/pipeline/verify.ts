// Stage 4 — verify (SPEC.md §5.4). Runtime-only, no gold labels: schema
// validity, non-empty, tool succeeded. This is deliberately independent of
// any statistics (Wilson intervals, quality scores) — those live in policy.json
// and drive routing, not verification. grade.py (harness-only) is what needs
// labels; verify() must never reach for one.
import { z } from 'zod';
import type { TaskKind, Verdict } from '../types';

const extractFieldsSchema = z.record(z.string(), z.unknown());

export interface VerifyInput {
  kind: TaskKind;
  output: string;
  needsTools: boolean;
  toolOk?: boolean;
}

// Models wrap valid JSON in a markdown fence even when told "Reply with only
// JSON" (GLM-5.2, observed live 2026-08-16 — it escalated/failed on a
// formatting quirk while the payload was correct). The fence is presentation,
// not schema: tolerate exactly one enclosing fence.
function stripEnclosingFence(text: string): string {
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(text);
  return fenced ? fenced[1]!.trim() : text;
}

// Small models under-sample into loops — seen live: rung-0 answered "what
// can you do" with dozens of near-identical "Offer travel tips" bullets and
// passed, because nothing here looked at CONTENT. Two cheap detectors: a
// mostly-duplicate line set, and one 5-word shingle repeating 5+ times.
// Lines under 12 chars don't count (code braces, list dashes legitimately
// repeat); JSON output is exempt (keys repeat by design).
function isDegenerateRepetition(text: string): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length >= 12);
  if (lines.length >= 8 && new Set(lines).size / lines.length < 0.6) return true;

  const words = text.toLowerCase().split(/\s+/);
  const shingles = new Map<string, number>();
  for (let i = 0; i + 5 <= words.length; i++) {
    const key = words.slice(i, i + 5).join(' ');
    const n = (shingles.get(key) ?? 0) + 1;
    if (n >= 5) return true;
    shingles.set(key, n);
  }
  return false;
}

export function verify(input: VerifyInput): Verdict {
  if (input.needsTools && input.toolOk === false) return 'fail_tool';

  const trimmed = input.output.trim();
  if (trimmed.length === 0) return 'fail_empty';

  if (input.kind === 'extract_fields') {
    try {
      extractFieldsSchema.parse(JSON.parse(stripEnclosingFence(trimmed)));
    } catch {
      return 'fail_schema';
    }
  }

  if (input.kind === 'classify') {
    // A label is one short line, not a sentence — anything else means the
    // model didn't follow the output contract.
    if (trimmed.includes('\n') || trimmed.length > 100) return 'fail_schema';
  }

  if (input.kind !== 'extract_fields' && isDegenerateRepetition(trimmed)) return 'fail_schema';

  return 'pass';
}
