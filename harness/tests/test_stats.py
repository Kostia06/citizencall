from stats import CandidateStats, cost_effective, held_in_to_held_out_drop, promote_decision, wilson_interval


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
