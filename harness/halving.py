"""halving.py — 2-round paired, blocked successive halving (SPEC.md §9.3).

8 candidates x held-in (round 1, all see the SAME instances) -> keep 4
4 candidates x held-in (round 2, fresh instances)             -> rank -> 1

Not Karnin/Sequential-Halving's or Jamieson-Talwalkar's Successive-Halving
stochastic-bandit rate guarantee: at temperature:0 the arms are deterministic
given the instance, so the only randomness left is instance sampling. This is
used purely as a budget-allocation heuristic (SPEC.md §9.3 says so, in the
README, explicitly).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from common import ModelCandidate, TaskInstance, TaskKind
from evaluate import run_candidate
from grade import grade
from scheduler import FeatherlessClient, UnitSemaphore


@dataclass
class CandidateRoundResult:
    model_id: str
    mean_accuracy: float
    mean_cost: float
    per_instance_accuracy: dict[str, float]
    dropped: bool = False
    drop_reason: str | None = None


def _score_candidate(
    model: ModelCandidate,
    instances: list[TaskInstance],
    sem: UnitSemaphore,
    client: FeatherlessClient,
    kind: TaskKind,
) -> CandidateRoundResult:
    """Scores one candidate over the round's instances. Errored/cold
    candidates are DROPPED WITH A REASON, never silently excluded (SPEC.md
    §9.2) — silent elimination biases against exactly the long-tail models
    this project exists to find."""
    try:
        evals = run_candidate(model, instances, sem, client)
    except Exception as exc:
        return CandidateRoundResult(model["id"], 0.0, 0.0, {}, dropped=True, drop_reason=str(exc))

    by_id = {inst["id"]: inst for inst in instances}
    per_instance: dict[str, float] = {}
    costs: list[float] = []
    for res in evals:
        inst = by_id[res.instance_id]
        if res.verdict == "fail_cold":
            per_instance[res.instance_id] = 0.0
            continue
        per_instance[res.instance_id] = grade(kind, res.output, inst["gold"], inst["input"])
        costs.append(res.cost_usd)

    if not costs:
        return CandidateRoundResult(
            model["id"], 0.0, 0.0, per_instance, dropped=True, drop_reason="all instances fail_cold"
        )

    mean_acc = sum(per_instance.values()) / len(per_instance)
    mean_cost = sum(costs) / len(costs)
    return CandidateRoundResult(model["id"], mean_acc, mean_cost, per_instance)


def _rank(results: list[CandidateRoundResult]) -> list[CandidateRoundResult]:
    """Explicit tie-break: (accuracy desc, cost asc) — SPEC.md §9.3. Without
    this, a stable sort over price-ordered input becomes a price sort with
    extra steps, which is exactly what v2 shipped by accident."""
    return sorted(results, key=lambda r: (-r.mean_accuracy, r.mean_cost))


def _eliminate_on_paired_diff(
    results: list[CandidateRoundResult], keep: int
) -> tuple[list[CandidateRoundResult], list[CandidateRoundResult]]:
    """Blocking: eliminate on mean PAIRED difference vs the round leader (same
    instances for every candidate in the round), not raw score — instance
    difficulty is the dominant variance component (SPEC.md §9.3)."""
    survivors = [r for r in results if not r.dropped]
    dropped = [r for r in results if r.dropped]
    if not survivors:
        return [], dropped

    ranked = _rank(survivors)
    leader = ranked[0]
    shared = set(leader.per_instance_accuracy)
    for r in ranked[1:]:
        shared &= set(r.per_instance_accuracy)

    def paired_diff(r: CandidateRoundResult) -> float:
        if not shared:
            return leader.mean_accuracy - r.mean_accuracy
        diffs = [leader.per_instance_accuracy[i] - r.per_instance_accuracy[i] for i in shared]
        return sum(diffs) / len(diffs)

    challengers = sorted(ranked[1:], key=lambda r: (paired_diff(r), r.mean_cost))
    ordered = [leader] + challengers
    return ordered[:keep], dropped + ordered[keep:]


@dataclass
class SweepOutcome:
    kind: TaskKind
    round1: list[CandidateRoundResult]
    round2: list[CandidateRoundResult]
    finalist: str | None
    held_in_accuracy: float
    eliminated_with_reason: list[tuple[str, str]] = field(default_factory=list)


def run_sweep(
    kind: TaskKind,
    candidates: list[ModelCandidate],
    round1_instances: list[TaskInstance],
    round2_instances: list[TaskInstance],
    sem: UnitSemaphore,
    client: FeatherlessClient,
) -> SweepOutcome:
    """Caller supplies DISJOINT held-in instance sets for the two rounds and
    keeps the held-out set entirely separate (promote.py owns the split)."""
    round1_results = [_score_candidate(m, round1_instances, sem, client, kind) for m in candidates]
    survivors, eliminated1 = _eliminate_on_paired_diff(round1_results, keep=4)
    reasons = [
        (r.model_id, r.drop_reason or "eliminated round 1 (paired diff vs leader)") for r in eliminated1
    ]

    models_by_id = {m["id"]: m for m in candidates}
    round2_candidates = [models_by_id[r.model_id] for r in survivors]
    round2_results = [_score_candidate(m, round2_instances, sem, client, kind) for m in round2_candidates]
    finalists, eliminated2 = _eliminate_on_paired_diff(round2_results, keep=1)
    reasons += [
        (r.model_id, r.drop_reason or "eliminated round 2 (paired diff vs leader)") for r in eliminated2
    ]

    finalist_id = finalists[0].model_id if finalists else None
    held_in_acc = finalists[0].mean_accuracy if finalists else 0.0

    return SweepOutcome(
        kind=kind,
        round1=round1_results,
        round2=round2_results,
        finalist=finalist_id,
        held_in_accuracy=held_in_acc,
        eliminated_with_reason=reasons,
    )
