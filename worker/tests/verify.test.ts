// verify() is runtime-only: schema validity, non-empty, tool succeeded — no
// gold labels, no Wilson intervals, no quality scores from policy.json. These
// tests assert that independence directly: verdicts never change based on
// anything except the shape of the output itself.
import { describe, expect, it } from 'vitest';
import { verify } from '../src/pipeline/verify';

describe('verify — structural verdicts only, independent of Wilson/quality stats', () => {
  it('passes a well-formed classify label', () => {
    expect(verify({ kind: 'classify', output: 'positive', needsTools: false })).toBe('pass');
  });

  it('fails a classify output that is not a single short label', () => {
    expect(verify({ kind: 'classify', output: 'positive\nbecause the tone is upbeat', needsTools: false })).toBe(
      'fail_schema'
    );
  });

  it('passes valid JSON for extract_fields', () => {
    expect(verify({ kind: 'extract_fields', output: '{"name":"Kos","role":"engineer"}', needsTools: false })).toBe(
      'pass'
    );
  });

  it('fails malformed JSON for extract_fields', () => {
    expect(verify({ kind: 'extract_fields', output: 'name: Kos, role: engineer', needsTools: false })).toBe(
      'fail_schema'
    );
  });

  it('fails empty output regardless of kind', () => {
    expect(verify({ kind: 'summarize', output: '   ', needsTools: false })).toBe('fail_empty');
  });

  it('fails when a required tool call did not succeed, before any schema check', () => {
    const verdict = verify({ kind: 'extract_fields', output: '{"ok":true}', needsTools: true, toolOk: false });
    expect(verdict).toBe('fail_tool');
  });

  it('does not fail_tool for a successful tool call even though needsTools is true', () => {
    const verdict = verify({ kind: 'summarize', output: 'a valid summary', needsTools: true, toolOk: true });
    expect(verdict).toBe('pass');
  });

  it('two calls with identical shape but wildly different (unmeasured) quality both pass — verify has no notion of quality', () => {
    const mediocre = verify({ kind: 'summarize', output: 'meh, ok summary', needsTools: false });
    const great = verify({ kind: 'summarize', output: 'a genuinely excellent, precise summary', needsTools: false });
    expect(mediocre).toBe('pass');
    expect(great).toBe('pass');
  });
});
