from stats import (
    MIN_PROMOTE_ACCURACY,
    MIN_PROMOTE_VALIDITY,
    CandidateStats,
    cost_effective,
    held_in_to_held_out_drop,
    promote_decision,
    wilson_interval,
)


def test_wilson_12_of_12_is_not_degenerate():
    """SPEC.md §9.4: bootstrap at 12/12 collapses to [1,1] (zero width, 0%
    coverage); Wilson must not — it should give roughly [0.757, 1.0]."""
    lo, hi = wilson_interval(12, 12)
    assert (lo, hi) != (1.0, 1.0)
    assert lo < 1.0
    assert hi == 1.0
    assert 0.7 < lo < 0.8


def test_wilson_zero_n_is_full_interval():
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_wilson_interval_widens_with_smaller_n():
    lo_small, _ = wilson_interval(6, 6)
    lo_large, _ = wilson_interval(60, 60)
    assert lo_small < lo_large  # more data -> tighter interval at the same proportion


def test_cost_effective_includes_escalation_cost():
    cheap_but_flaky = CandidateStats("cheap", accuracy=0.8, cost_primary=0.001, escalation_rate=0.5, cost_escalation=0.01)
    assert cost_effective(cheap_but_flaky) > cheap_but_flaky.cost_primary


def test_promote_decision_requires_both_accuracy_and_cost():
    incumbent = CandidateStats("frontier", accuracy=0.95, cost_primary=0.01, escalation_rate=0.0, cost_escalation=0.0)

    good = CandidateStats("candidate", accuracy=0.90, cost_primary=0.002, escalation_rate=0.0, cost_escalation=0.0)
    promoted, _ = promote_decision(good, incumbent, delta_kind=0.15)
    assert promoted

    too_expensive = CandidateStats("candidate", accuracy=0.90, cost_primary=0.009, escalation_rate=0.0, cost_escalation=0.0)
    promoted, _ = promote_decision(too_expensive, incumbent, delta_kind=0.15)
    assert not promoted

    too_inaccurate = CandidateStats("candidate", accuracy=0.5, cost_primary=0.001, escalation_rate=0.0, cost_escalation=0.0)
    promoted, _ = promote_decision(too_inaccurate, incumbent, delta_kind=0.15)
    assert not promoted


def test_held_in_to_held_out_drop_is_the_winners_curse_gap():
    assert abs(held_in_to_held_out_drop(0.95, 0.80) - 0.15) < 1e-9


def test_promotion_floor_blocks_collapsed_incumbent_degenerate_case():
    """Reproduces the exact LIVE-sweep bug: when the incumbent also collapses
    to 0.0 accuracy, non-inferiority (candidate >= incumbent - delta) is
    trivially satisfied by a 0.0-accuracy candidate too. The absolute floor
    must block this regardless of cost."""
    collapsed_incumbent = CandidateStats(
        "frontier", accuracy=0.0, cost_primary=0.01, escalation_rate=0.0, cost_escalation=0.0
    )
    zero_accuracy_candidate = CandidateStats(
        "candidate", accuracy=0.0, cost_primary=0.001, escalation_rate=0.0, cost_escalation=0.0
    )
    promoted, detail = promote_decision(zero_accuracy_candidate, collapsed_incumbent, delta_kind=0.15)
    assert not promoted
    assert not detail["floorOk"]


def test_candidate_below_accuracy_or_validity_floor_never_promoted():
    """Below-floor candidates are blocked even against a weak (but non-zero)
    incumbent that the non-inferiority rule alone would clear."""
    weak_incumbent = CandidateStats(
        "frontier", accuracy=0.3, cost_primary=0.01, escalation_rate=0.0, cost_escalation=0.0
    )
    below_accuracy_floor = CandidateStats(
        "candidate", accuracy=0.4, cost_primary=0.001, escalation_rate=0.0, cost_escalation=0.0
    )
    promoted, _ = promote_decision(below_accuracy_floor, weak_incumbent, delta_kind=0.15)
    assert below_accuracy_floor.accuracy < MIN_PROMOTE_ACCURACY  # sanity: this candidate IS below floor
    assert not promoted

    below_validity_floor = CandidateStats(
        "candidate", accuracy=0.9, cost_primary=0.001, escalation_rate=0.6, cost_escalation=0.001
    )
    promoted, detail = promote_decision(below_validity_floor, weak_incumbent, delta_kind=0.15)
    assert detail["candidateValidity"] < MIN_PROMOTE_VALIDITY
    assert not promoted


def test_negative_control_never_promoted_even_if_metrics_look_good():
    """isBaseNonInstruct candidates are never promotable, full stop — even one
    that (implausibly) posts strong accuracy and cost numbers."""
    incumbent = CandidateStats("frontier", accuracy=0.95, cost_primary=0.01, escalation_rate=0.0, cost_escalation=0.0)
    fake_strong_negative_control = CandidateStats(
        "base-non-instruct",
        accuracy=0.99,
        cost_primary=0.001,
        escalation_rate=0.0,
        cost_escalation=0.0,
        is_base_non_instruct=True,
    )
    promoted, detail = promote_decision(fake_strong_negative_control, incumbent, delta_kind=0.15)
    assert not promoted
    assert detail["isBaseNonInstruct"] is True


def test_kind_with_no_qualifying_candidate_promotes_nothing():
    """When every candidate for a kind fails the floor, none of them should be
    promoted — the kind is left to the frontier/cheap-default rather than
    forcing a pick."""
    incumbent = CandidateStats("frontier", accuracy=0.0, cost_primary=0.01, escalation_rate=0.0, cost_escalation=0.0)
    candidates = [
        CandidateStats("c1", accuracy=0.0, cost_primary=0.0001, escalation_rate=0.0, cost_escalation=0.0),
        CandidateStats("c2", accuracy=0.2, cost_primary=0.0001, escalation_rate=0.0, cost_escalation=0.0),
        CandidateStats(
            "negctrl", accuracy=0.8, cost_primary=0.0001, escalation_rate=0.0, cost_escalation=0.0, is_base_non_instruct=True
        ),
    ]
    results = [promote_decision(c, incumbent, delta_kind=0.15)[0] for c in candidates]
    assert not any(results)
