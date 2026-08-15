"""stats.py — Wilson score intervals for proportions (closed-form; bootstrap
collapses to a degenerate [1,1] at 12/12, measured — SPEC.md §9.4), paired
bootstrap for deltas, and the SPEC.md §9.4 promotion rule.

Deliberately NOT implemented: Benjamini-Hochberg FDR control. SPEC.md §9.4
explains why: FDR targets false discoveries under a no-difference null; our
decision is non-inferiority, where the null runs the other way — BH would
reject exactly the equal-quality-cheaper candidates we're looking for.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from scipy.stats import norm

Z_95 = norm.ppf(0.975)

# Absolute quality floor for promotion. A LIVE sweep promoted a candidate at
# 0.0 accuracy — and even the negative control (isBaseNonInstruct) — because
# the non-inferiority rule alone degenerates when the incumbent also
# collapses (candidate >= incumbent - delta_kind is trivially true at 0 >= 0).
# These floors are independent of the incumbent: no candidate is promotable
# below them, no matter how badly the incumbent scored or how cheap the
# candidate is. 0.5 is a deliberately conservative "clearly better than
# coin-flip on a graded task" bar, not a tuned number.
MIN_PROMOTE_ACCURACY = 0.5
MIN_PROMOTE_VALIDITY = 0.5  # fraction of calls that parsed/passed verify (1 - escalation_rate)


def wilson_interval(successes: int, n: int, z: float = Z_95) -> tuple[float, float]:
    """Wilson score interval — NOT bootstrap. Bootstrap at 12/12 collapses to
    a zero-width [1,1] interval (measured, SPEC.md §9.4); Wilson correctly
    reports ~[0.757, 1.0]."""
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z**2 / n
    centre = p + z**2 / (2 * n)
    margin = z * ((p * (1 - p) / n + z**2 / (4 * n**2)) ** 0.5)
    lo = (centre - margin) / denom
    hi = (centre + margin) / denom
    return (max(0.0, lo), min(1.0, hi))


def bootstrap_paired_delta(
    a: list[float], b: list[float], n_boot: int = 2000, seed: int = 42
) -> tuple[float, tuple[float, float]]:
    """Paired bootstrap CI for mean(a) - mean(b). Bootstrap is fine here — the
    quantity of interest is a difference, not a proportion pinned at a
    boundary, so it doesn't hit the degenerate-interval failure mode above."""
    if len(a) != len(b) or not a:
        raise ValueError("paired arrays must be the same non-zero length")
    n = len(a)
    diffs = [ai - bi for ai, bi in zip(a, b)]
    point = sum(diffs) / n
    rng = random.Random(seed)
    boots = [sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot)]
    boots.sort()
    lo = boots[int(0.025 * n_boot)]
    hi = boots[min(n_boot - 1, int(0.975 * n_boot))]
    return point, (lo, hi)


@dataclass
class CandidateStats:
    model_id: str
    accuracy: float
    cost_primary: float  # c_primary — mean per-call cost at the primary rung
    escalation_rate: float  # p_escalate — fraction of calls that failed verify and escalated
    cost_escalation: float  # c_escalation — mean cost of the escalation rung
    # SPEC.md §9.2 negative control tag (deliberately-incompetent base,
    # non-instruct checkpoint). Never promotable, full stop — regardless of
    # what its measured accuracy/cost happen to be.
    is_base_non_instruct: bool = False


def cost_effective(stats: CandidateStats) -> float:
    """SPEC.md §9.4: c_primary + p_escalate * c_escalation. Gating on primary
    cost alone hides the real cost of a high failure rate — at a 55%
    escalation rate a "cheap" candidate can be more expensive than the
    incumbent while still passing a primary-cost-only gate."""
    return stats.cost_primary + stats.escalation_rate * stats.cost_escalation


def promote_decision(
    candidate: CandidateStats, incumbent: CandidateStats, delta_kind: float
) -> tuple[bool, dict[str, Any]]:
    """SPEC.md §9.4 promotion rule, PLUS an absolute quality floor:
      accuracy_heldout >= incumbent_accuracy - delta_kind   (point estimate)
      cost_effective   <= 0.50 * incumbent_cost_effective
      accuracy_heldout >= MIN_PROMOTE_ACCURACY               (floor, incumbent-independent)
      validity         >= MIN_PROMOTE_VALIDITY               (floor, incumbent-independent)
      NOT is_base_non_instruct                                (negative control, never)

    The non-inferiority + cheaper rule alone degenerates when the incumbent
    also collapses (e.g. incumbent_accuracy=0 makes candidate>=0-delta true
    for any candidate). The floor is checked independently of the incumbent
    so a candidate can never ride a bad incumbent to promotion.
    """
    cand_ce = cost_effective(candidate)
    inc_ce = cost_effective(incumbent)
    accuracy_ok = candidate.accuracy >= incumbent.accuracy - delta_kind
    cost_ok = cand_ce <= 0.5 * inc_ce
    candidate_validity = 1.0 - candidate.escalation_rate
    floor_ok = (
        candidate.accuracy >= MIN_PROMOTE_ACCURACY
        and candidate_validity >= MIN_PROMOTE_VALIDITY
        and not candidate.is_base_non_instruct
    )
    return accuracy_ok and cost_ok and floor_ok, {
        "candidateCostEffective": cand_ce,
        "incumbentCostEffective": inc_ce,
        "accuracyMargin": candidate.accuracy - (incumbent.accuracy - delta_kind),
        "accuracyOk": accuracy_ok,
        "costOk": cost_ok,
        "floorOk": floor_ok,
        "candidateValidity": candidate_validity,
        "isBaseNonInstruct": candidate.is_base_non_instruct,
    }


def held_in_to_held_out_drop(held_in_accuracy: float, held_out_accuracy: float) -> float:
    """The winner's-curse estimate: Successive Halving selects the winner on
    held-in data, so its held-in score is optimistically biased. Reporting
    this drop (SPEC.md §9.4) is the credibility move, not hiding it."""
    return held_in_accuracy - held_out_accuracy
