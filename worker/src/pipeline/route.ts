// Stage 2 — route (SPEC.md §5.2). Eligibility gates the candidate pool;
// score() ranks what's left. Weights always come from policy.json — never
// hardcoded here, so a re-swept policy changes behavior without a redeploy.
import type { ModelCandidate, Policy, RouteDecision, SubTask } from '../types';

export class NoEligibleModelError extends Error {}

export function eligible(m: ModelCandidate, t: SubTask): boolean {
  return (
    m.contextLength >= t.ctxNeeded &&
    (m.availability === 'warm' || m.availability === 'loading') &&
    m.availableOnPlan &&
    (m.toolUse || !t.needsTools)
  );
}

function combinedPrice(m: ModelCandidate): number {
  return m.pricePerMTokIn + m.pricePerMTokOut;
}

// Cost isn't monotonic in param count on Featherless (SPEC.md §5.2), so we
// normalize against the pool actually being compared rather than a hardcoded
// price ceiling — that ceiling would silently go stale as the catalog moves.
function normCost(m: ModelCandidate, pool: ModelCandidate[]): number {
  const max = Math.max(...pool.map(combinedPrice), Number.EPSILON);
  return combinedPrice(m) / max;
}

export function score(policy: Policy, m: ModelCandidate, t: SubTask, pool: ModelCandidate[]): number {
  const quality = policy.quality[m.id]?.[t.kind] ?? 0;
  return policy.weights.quality * quality - policy.weights.cost * normCost(m, pool);
}

function buildReasons(
  policy: Policy,
  m: ModelCandidate,
  t: SubTask,
  candidatesById: Map<string, ModelCandidate>
): string[] {
  const reasons: string[] = [];
  const q = policy.quality[m.id]?.[t.kind];
  const ci = policy.qualityCI[m.id]?.[t.kind];
  if (q !== undefined) {
    const ciStr = ci ? ` (Wilson [${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}])` : '';
    reasons.push(`accuracy ${q.toFixed(2)} on ${t.kind}${ciStr}`);
  }

  const cheapDefault = candidatesById.get(policy.baselines.cheapDefault);
  if (cheapDefault && cheapDefault.id !== m.id) {
    const mine = combinedPrice(m);
    const theirs = combinedPrice(cheapDefault);
    if (mine > 0 && theirs > mine) {
      reasons.push(
        `$${mine.toFixed(4)}/Mtok vs cheap-default $${theirs.toFixed(4)}/Mtok — ${(theirs / mine).toFixed(1)}x cheaper`
      );
    }
  }

  if (m.availability === 'warm') reasons.push('warm · no cold-start penalty');
  return reasons;
}

export function routeSubTask(
  policy: Policy,
  allCandidates: ModelCandidate[],
  subTask: SubTask,
  ladderPosition: 0 | 1
): RouteDecision {
  // A classify that will run a tool answers verdict + evidence (see
  // execute.ts CLASSIFY_WITH_EVIDENCE_PROMPT) — that's summarize-shaped work,
  // so it routes on the summarize ladder; the 0.5B label-rung ignores the
  // evidence it just fetched (found live with an MCP novelty check).
  const ladderKind = subTask.kind === 'classify' && subTask.needsTools ? 'summarize' : subTask.kind;
  const ladder = policy.ladders[ladderKind] ?? [];
  // Ladder position selects a RUNG (a candidate set), not a fixed model id —
  // score() still decides the winner within that rung. Today ladders are
  // length <=2, so each rung is usually one model, but this stays correct if
  // that changes.
  const rungIds = ladderPosition === 0 ? ladder.slice(0, 1) : ladder.slice(1, 2);
  if (rungIds.length === 0) {
    throw new NoEligibleModelError(`no ladder rung ${ladderPosition} defined for kind ${subTask.kind}`);
  }

  const pool = allCandidates.filter((c) => rungIds.includes(c.id));
  const eligiblePool = pool.filter((m) => eligible(m, subTask));
  if (eligiblePool.length === 0) {
    throw new NoEligibleModelError(`no eligible model for ${subTask.kind} at rung ${ladderPosition}`);
  }

  const candidatesById = new Map(allCandidates.map((c) => [c.id, c]));
  const scored = eligiblePool
    .map((m) => ({ m, s: score(policy, m, subTask, eligiblePool) }))
    .sort((a, b) => b.s - a.s);
  const winner = scored[0]!;

  return {
    subTaskId: subTask.id,
    modelId: winner.m.id,
    score: winner.s,
    reasons: buildReasons(policy, winner.m, subTask, candidatesById),
    ladderPosition,
    candidatesConsidered: eligiblePool.length,
  };
}
