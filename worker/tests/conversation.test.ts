// pipeline/conversation.ts — the budget walker (LibreChat-style), the
// /api/run history boundary schema (caps truncate, never reject), and the
// planner disambiguator line.
import { describe, expect, it } from 'vitest';
import {
  buildConversationBlock,
  CONVERSATION_CHAR_BUDGET,
  historySchema,
  lastUserTurnHint,
  MAX_HISTORY_TURNS,
  MAX_TURN_CHARS,
  type ConversationTurn,
} from '../src/pipeline/conversation';

const u = (text: string): ConversationTurn => ({ role: 'user', text });
const a = (text: string): ConversationTurn => ({ role: 'assistant', text });

describe('buildConversationBlock — budget walk', () => {
  // Table-driven: [name, history, budget, expected-contains, expected-absent]
  const cases: Array<{
    name: string;
    history: ConversationTurn[] | undefined;
    budget?: number;
    contains: string[];
    absent: string[];
  }> = [
    { name: 'undefined history → empty', history: undefined, contains: [], absent: ['Conversation'] },
    { name: 'empty history → empty', history: [], contains: [], absent: ['Conversation'] },
    { name: 'whitespace-only turns → empty', history: [u('   '), a('\n')], contains: [], absent: ['Conversation'] },
    {
      name: 'single user turn',
      history: [u('my favorite color is teal')],
      contains: ['Conversation so far', 'User: my favorite color is teal'],
      absent: ['Assistant:'],
    },
    {
      name: 'pairs keep chronological order, roles labelled',
      history: [u('first question'), a('first answer'), u('second question')],
      contains: ['User: first question\nAssistant: first answer\nUser: second question'],
      absent: [],
    },
    {
      name: 'over-budget older turns are dropped WHOLE, never truncated',
      history: [u('x'.repeat(400)), u('young turn fits')],
      budget: 50,
      contains: ['User: young turn fits'],
      absent: ['x'], // not even a sliced prefix of the dropped turn
    },
    {
      name: 'newest turn always survives even if it alone exceeds the budget',
      history: [u('older context'), a('y'.repeat(300))],
      budget: 100,
      contains: [`Assistant: ${'y'.repeat(300)}`],
      absent: ['older context'],
    },
    {
      name: 'blank turn between real ones is skipped, budget unaffected',
      history: [u('keep me'), a('   '), u('and me')],
      contains: ['User: keep me\nUser: and me'],
      absent: [],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const block = buildConversationBlock(c.history, c.budget ?? CONVERSATION_CHAR_BUDGET);
      if (c.contains.length === 0) expect(block).toBe('');
      for (const s of c.contains) expect(block).toContain(s);
      for (const s of c.absent) expect(block).not.toContain(s);
    });
  }

  it('stays near the budget: many short turns stop once ~1500 chars are used', () => {
    const history = Array.from({ length: 100 }, (_, i) => u(`turn number ${i} with some padding text`));
    const block = buildConversationBlock(history);
    expect(block.length).toBeLessThanOrEqual(CONVERSATION_CHAR_BUDGET + 200); // header + one-turn slack
    // Newest turns kept, oldest dropped.
    expect(block).toContain('turn number 99');
    expect(block).not.toContain('turn number 0 ');
  });
});

describe('historySchema — boundary caps truncate, never reject', () => {
  it(`keeps only the ${MAX_HISTORY_TURNS} NEWEST turns`, () => {
    const parsed = historySchema.parse(Array.from({ length: 20 }, (_, i) => u(`t${i}`)));
    expect(parsed).toHaveLength(MAX_HISTORY_TURNS);
    expect(parsed[0]!.text).toBe('t8'); // 20 - 12
    expect(parsed[parsed.length - 1]!.text).toBe('t19');
  });

  it(`truncates each text to ${MAX_TURN_CHARS} chars`, () => {
    const parsed = historySchema.parse([u('z'.repeat(5000))]);
    expect(parsed[0]!.text).toHaveLength(MAX_TURN_CHARS);
  });

  it('rejects an unknown role', () => {
    expect(historySchema.safeParse([{ role: 'system', text: 'nope' }]).success).toBe(false);
  });

  it('rejects a non-array', () => {
    expect(historySchema.safeParse('not history').success).toBe(false);
  });
});

describe('lastUserTurnHint', () => {
  it('returns the most recent USER turn, skipping assistant turns', () => {
    expect(lastUserTurnHint([u('older'), u('the real hint'), a('an answer')])).toBe('the real hint');
  });

  it('collapses whitespace and caps at 200 chars', () => {
    const hint = lastUserTurnHint([u(`  multi\n  line\t text ${'w'.repeat(300)}`)]);
    expect(hint.startsWith('multi line text')).toBe(true);
    expect(hint.length).toBeLessThanOrEqual(200);
  });

  it('empty when there is no user turn', () => {
    expect(lastUserTurnHint([a('only assistant')])).toBe('');
    expect(lastUserTurnHint(undefined)).toBe('');
  });
});
