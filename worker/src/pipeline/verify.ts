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

export function verify(input: VerifyInput): Verdict {
  if (input.needsTools && input.toolOk === false) return 'fail_tool';

  const trimmed = input.output.trim();
  if (trimmed.length === 0) return 'fail_empty';

  if (input.kind === 'extract_fields') {
    try {
      extractFieldsSchema.parse(JSON.parse(trimmed));
    } catch {
      return 'fail_schema';
    }
  }

  if (input.kind === 'classify') {
    // A label is one short line, not a sentence — anything else means the
    // model didn't follow the output contract.
    if (trimmed.includes('\n') || trimmed.length > 100) return 'fail_schema';
  }

  return 'pass';
}
