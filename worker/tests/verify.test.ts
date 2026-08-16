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

  it('fails degenerate line repetition (live: rung-0 looped "Offer travel tips" bullets and passed)', () => {
    const sludge = [
      '- Offer mental health support',
      '- Provide travel itineraries',
      '- Offer travel tips',
      '- Help with travel bookings',
      '- Offer travel tips',
      '- Provide travel itineraries',
      '- Offer travel insurance advice',
      '- Offer travel tips',
      '- Provide travel itineraries',
      '- Offer travel insurance advice',
    ].join('\n');
    expect(verify({ kind: 'summarize', output: sludge, needsTools: false })).toBe('fail_schema');
  });

  it('fails an inline 5-word shingle repeated 5+ times', () => {
    const loop = 'I can help you with that. '.repeat(8);
    expect(verify({ kind: 'summarize', output: loop, needsTools: false })).toBe('fail_schema');
  });

  it('does NOT fail legitimate lists, code (repeated short lines), or JSON with repeated keys', () => {
    const list = ['- Learn basic greetings', '- Practice with a partner daily', '- Watch films with subtitles'].join('\n');
    expect(verify({ kind: 'summarize', output: list, needsTools: false })).toBe('pass');
    const code = 'function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\nfunction c() {\n  return 3;\n}\n}\n}\n}\n}\n}\n}\n}';
    expect(verify({ kind: 'summarize', output: code, needsTools: false })).toBe('pass');
    const json = JSON.stringify({ items: [{ name: 'a', qty: 1 }, { name: 'b', qty: 2 }, { name: 'c', qty: 3 }] }, null, 2);
    expect(verify({ kind: 'extract_fields', output: json, needsTools: false })).toBe('pass');
  });
});
