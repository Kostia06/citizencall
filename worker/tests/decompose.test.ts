// Unit tests for the real decompose planner's parsing layer (SPEC.md §5, §1
// pipeline). planFromContent is the pure model-text -> Plan step; a planning
// misfire must return null so decompose() falls back to the heuristic.
import { describe, expect, it } from 'vitest';
import { planFromContent } from '../src/pipeline/decompose';

describe('planFromContent', () => {
  it('parses a multi-sub-task JSON array and chains dependencies in order', () => {
    const content = JSON.stringify([
      { kind: 'summarize', instruction: 'Summarize this week of commits', needsTools: true, toolkit: 'github' },
      { kind: 'extract_fields', instruction: 'Extract action items as JSON', needsTools: false, toolkit: null },
    ]);
    const plan = planFromContent(content);
    expect(plan).not.toBeNull();
    expect(plan!.subTasks).toHaveLength(2);

    const [first, second] = plan!.subTasks;
    expect(first!.kind).toBe('summarize');
    expect(first!.needsTools).toBe(true);
    expect(first!.toolCall).toEqual({ toolkit: 'github', tool: 'list_commits', args: {} });
    expect(first!.dependsOn).toEqual([]);

    // second is chained onto the first, and has no tool
    expect(second!.dependsOn).toEqual([first!.id]);
    expect(second!.needsTools).toBe(false);
    expect(second!.toolCall).toBeUndefined();
    expect(second!.idx).toBe(1);
  });

  it('tolerates a ```json code fence around the array', () => {
    const content = '```json\n[{"kind":"classify","instruction":"Label the ticket"}]\n```';
    const plan = planFromContent(content);
    expect(plan!.subTasks[0]!.kind).toBe('classify');
  });

  it('accepts an object wrapper { subTasks: [...] }', () => {
    const content = '{"subTasks":[{"kind":"normalize","instruction":"Clean it up"}]}';
    const plan = planFromContent(content);
    expect(plan!.subTasks).toHaveLength(1);
    expect(plan!.subTasks[0]!.kind).toBe('normalize');
  });

  it('returns null on the stub / non-JSON output so decompose falls back', () => {
    expect(planFromContent('[stub:zai-org/GLM-5.2] summarize the repo')).toBeNull();
    expect(planFromContent('')).toBeNull();
  });

  it('returns null on a schema-invalid kind rather than emitting a bad plan', () => {
    const content = JSON.stringify([{ kind: 'translate', instruction: 'do a thing' }]);
    expect(planFromContent(content)).toBeNull();
  });

  it('caps the plan at four sub-tasks', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ kind: 'summarize', instruction: `step ${i}` }));
    expect(planFromContent(JSON.stringify(five))).toBeNull();
  });
});
