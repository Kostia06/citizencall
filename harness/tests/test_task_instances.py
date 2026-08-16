"""Structural QA on the gold instances themselves (SPEC.md §9.5).

These are not model tests — they check that the BENCHMARK IS ANSWERABLE before
a single API credit is spent. A task set that no correct answer can score on
produces a confident-looking zero for every candidate, which is worse than no
measurement at all: it looks like a finding.

The summarize check below is the one that matters. SPEC.md §5.4 grades a
summary on fact coverage AND a compression guard (len(out)/len(src) <= 0.4).
Both are right — the guard is what kills the copy-the-source exploit. But they
interact: if the must-contain facts are long relative to the source, then a
summary that states every fact in ordinary prose busts the guard and scores
0.0. The benchmark then measures terseness, not faithfulness.
"""
from __future__ import annotations

import json

import pytest

from common import TASKS_DIR
from grade import COMPRESSION_GUARD_RATIO, grade

KINDS = {"classify": str, "extract_fields": dict, "summarize": list, "normalize": str}


def load(kind: str) -> list[dict]:
    return [json.loads(line) for line in (TASKS_DIR / f"{kind}.jsonl").open() if line.strip()]


@pytest.mark.parametrize("kind,goldtype", KINDS.items())
def test_gold_type_matches_kind(kind: str, goldtype: type) -> None:
    for r in load(kind):
        assert isinstance(r["gold"], goldtype), f"{r['id']}: gold is {type(r['gold']).__name__}"


@pytest.mark.parametrize("kind", KINDS)
def test_ids_and_inputs_are_unique(kind: str) -> None:
    rows = load(kind)
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), f"{kind}: duplicate instance ids"
    inputs = [r["input"].strip().lower() for r in rows]
    assert len(inputs) == len(set(inputs)), f"{kind}: duplicate inputs (inflates apparent n)"


@pytest.mark.parametrize("kind", KINDS)
def test_split_sizes_match_the_reported_statistics(kind: str) -> None:
    """held-out is reported at n=12; Wilson intervals and delta=0.15 are stated
    for that n (SPEC.md §9.4), so a drifting split silently invalidates them."""
    rows = load(kind)
    assert sum(1 for r in rows if r["split"] == "held_in") == 12
    assert sum(1 for r in rows if r["split"] == "held_out") == 12


def test_classify_gold_is_inside_the_stated_label_set() -> None:
    """grade() is exact match, so a gold outside the instruction's own label
    set is unreachable — no model could produce it by following instructions."""
    import re

    for r in load("classify"):
        m = re.search(r"one of:\s*([a-z_,\s]+)\.", r["instruction"], re.I)
        if not m:
            continue
        allowed = {s.strip() for s in m.group(1).split(",")}
        assert str(r["gold"]).strip() in allowed, f"{r['id']}: gold {r['gold']!r} not in {sorted(allowed)}"


def test_a_fluent_summary_of_every_fact_can_score_full_marks() -> None:
    """THE regression test for SPEC.md §5.4's guard-vs-coverage interaction.

    Writing the must-contain facts out as prose is the most faithful summary
    that exists for an instance. If that scores 0.0, the instance is scoring
    compression rather than correctness and no model can win it honestly.

    Fix by making the SOURCE longer (real summarization compresses 5-20x, not
    2x) or the facts terser/more atomic — not by relaxing the guard.
    """
    broken = []
    for r in load("summarize"):
        facts = r["gold"] if isinstance(r["gold"], list) else [str(r["gold"])]
        fluent = ". ".join(str(f) for f in facts) + "."
        if grade("summarize", fluent, facts, r["input"]) < 1.0:
            ratio = len(fluent) / len(r["input"])
            broken.append(f"{r['id']} (needs ratio<={COMPRESSION_GUARD_RATIO}, got {ratio:.2f})")

    assert not broken, (
        f"{len(broken)} summarize instance(s) cannot be answered correctly — a summary "
        f"stating every required fact still scores 0.0 on the compression guard:\n  "
        + "\n  ".join(broken)
    )
