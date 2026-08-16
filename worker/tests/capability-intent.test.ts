// The identity/capability fast path must catch the bare questions every new
// visitor opens with — and NOTHING with real content, which still deserves
// the pipeline.
import { describe, expect, it } from 'vitest';
import { isCapabilityIntent } from '../src/pipeline/capability-intent';

describe('isCapabilityIntent', () => {
  const hits = [
    'what can you do',
    'What can you do?',
    'hey what can you do',
    'who are you',
    'what are you',
    'what is understudy',
    'how do you work',
    'how does this work',
    'help',
    'what can I ask here?',
    'what should i ask',
  ];
  for (const t of hits) {
    it(`matches: "${t}"`, () => expect(isCapabilityIntent(t)).toBe(true));
  }

  const misses = [
    'what can you do about my failing tests',
    'can you draft an email to my landlord',
    'who are you voting for',
    'help me write a sql query',
    'how do you work out compound interest',
    'what is understudy of a lead actor called in theatre and opera history', // >60 chars
    'say hi',
  ];
  for (const t of misses) {
    it(`does not match: "${t}"`, () => expect(isCapabilityIntent(t)).toBe(false));
  }
});
