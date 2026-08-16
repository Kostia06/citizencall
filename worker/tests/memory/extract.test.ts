// Multi-fact extraction plumbing (memory/extract.ts): JSON parsing is
// strict-but-tolerant (think-blocks, fences, bare arrays), facts are bounded
// in count and length, and derived titles are clean subject phrases with no
// "This:" artifacts.
import { describe, expect, it } from 'vitest';
import { MAX_FACTS, cleanTitle, parseFacts, titleForFact } from '../../src/memory/extract';

describe('parseFacts', () => {
  it('parses the {"facts": [...]} contract', () => {
    expect(parseFacts('{"facts": ["User\'s name is John", "User deploys on Fridays"]}')).toEqual([
      "User's name is John",
      'User deploys on Fridays',
    ]);
  });

  it('tolerates think-blocks, code fences, and a bare array', () => {
    expect(parseFacts('<think>hmm, a name</think>\n```json\n{"facts": ["The agent should be called Jeff"]}\n```')).toEqual([
      'The agent should be called Jeff',
    ]);
    expect(parseFacts('["User likes tea"]')).toEqual(['User likes tea']);
  });

  it('yields [] for empty facts, prose, and malformed JSON', () => {
    expect(parseFacts('{"facts": []}')).toEqual([]);
    expect(parseFacts('The user likes cats, probably.')).toEqual([]);
    expect(parseFacts('{"facts": "not a list"}')).toEqual([]);
    expect(parseFacts('{"facts": [')).toEqual([]);
  });

  it('drops non-strings, trims whitespace, and bounds count and length', () => {
    const many = JSON.stringify({ facts: Array.from({ length: 20 }, (_, i) => `fact number ${i}  padded`) });
    expect(parseFacts(many).length).toBe(MAX_FACTS);
    const parsed = parseFacts(`{"facts": [42, "  spaced   out  ", "${'x'.repeat(300)}"]}`);
    expect(parsed[0]).toBe('spaced out');
    expect(parsed[1]!.length).toBe(120);
  });
});

describe('cleanTitle / titleForFact', () => {
  it('strips the "This:" family of artifacts and trailing punctuation', () => {
    expect(cleanTitle('This: my name is Jeff')).toBe('My name is Jeff');
    expect(cleanTitle('fact - user likes tea.')).toBe('User likes tea');
    expect(cleanTitle('"Quoted title!"')).toBe('Quoted title');
  });

  it('derives canonical subjects for identity facts', () => {
    expect(titleForFact('The agent should be called Bob.')).toBe("Agent's name");
    expect(titleForFact("User's name is Ann")).toBe("User's name");
  });

  it('derives "Preference: …" for preference facts and clean phrases otherwise', () => {
    expect(titleForFact('User prefers short answers')).toBe('Preference: short answers');
    expect(titleForFact('I always deploy on Fridays')).toBe('Preference: deploy on Fridays');
    expect(titleForFact('User works at Acme as a data engineer in Berlin these days')).toBe(
      'User works at Acme as a data engineer'
    );
  });
});
