"""promote.py — orchestrates the sweep over snapshot/retrieve/warmup output,
applies the SPEC.md §9.4 promotion rule, and writes policy.json / results.json
/ funnel.json, appending every model call to sweep-log.jsonl.

Mechanically ASSERTS the held-out data-splitting invariant: instances used to
report accuracy must be disjoint from every instance used to select the
winner (round 1 + round 2 held-in). "Successive Halving selects on held-in;
all reported inference is on held-out instances the selector never saw" —
SPEC.md §9.4.
"""
from __future__ import annotations

import argparse
import datetime as dt
from typing import Any

from common import ARTIFACTS_DIR, TASKS_DIR, TaskInstance, TaskKind, append_jsonl, load_json, load_jsonl, save_json
from evaluate import run_candidate
from grade import grade
from halving import CandidateRoundResult, SweepOutcome, run_sweep
from scheduler import FeatherlessClient, UnitSemaphore
from stats import CandidateStats, cost_effective, held_in_to_held_out_drop, promote_decision, wilson_interval

TASK_KINDS: list[TaskKind] = ["classify", "extract_fields", "summarize", "normalize"]
DELTA_KIND = 0.15  # set BY sample size at n=12 — SPEC.md §9.4, not tuned per kind
FRONTIER_MODEL_ID = "zai-org/GLM-5.2"
CHEAP_DEFAULT_MODEL_ID = "Qwen/Qwen3-4B"
DEFAULT_UNITS = 8

SWEEP_LOG = ARTIFACTS_DIR / "sweep-log.jsonl"


def _load_task_instances(kind: TaskKind) -> list[TaskInstance]:
    return load_jsonl(TASKS_DIR / f"{kind}.jsonl")  # type: ignore[return-value]


def _split_instances(instances: list[TaskInstance]) -> tuple[list[TaskInstance], list[TaskInstance]]:
    held_in = [i for i in instances if i["split"] == "held_in"]
    held_out = [i for i in instances if i["split"] == "held_out"]
    return held_in, held_out


def _round_instance_sets(held_in: list[TaskInstance]) -> tuple[list[TaskInstance], list[TaskInstance]]:
    """Round 1 and round 2 use DISJOINT held-in instances (SPEC.md §9.3: round
    2 is "fresh"). With the seed task files (~6/kind, not the full 24) we
    split held_in in half rather than reuse — small n, but never overlapping."""
    if len(held_in) >= 2:
        mid = len(held_in) // 2
        return held_in[:mid], held_in[mid:]
    return held_in, held_in


def _log_round_calls(kind: TaskKind, round_idx: int, results: list[CandidateRoundResult]) -> None:
    for r in results:
        append_jsonl(
            SWEEP_LOG,
            {
                "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
                "kind": kind,
                "round": round_idx,
                "modelId": r.model_id,
                "meanAccuracy": round(r.mean_accuracy, 4),
                "meanCost": round(r.mean_cost, 6),
                "dropped": r.dropped,
                "dropReason": r.drop_reason,
            },
        )


def _assert_held_out_invariant(outcome: SweepOutcome, held_out: list[TaskInstance]) -> None:
    selection_ids: set[str] = set()
    for round_results in (outcome.round1, outcome.round2):
        for r in round_results:
            selection_ids |= set(r.per_instance_accuracy)
    held_out_ids = {i["id"] for i in held_out}
    overlap = selection_ids & held_out_ids
    assert not overlap, f"data-splitting invariant violated: {overlap} used in both selection and held-out report"


def _evaluate_and_grade(
    kind: TaskKind, model: dict, instances: list[TaskInstance], sem: UnitSemaphore, client: FeatherlessClient
) -> dict[str, Any]:
    evals = run_candidate(model, instances, sem, client)
    by_id = {i["id"]: i for i in instances}
    scores = [grade(kind, e.output, by_id[e.instance_id]["gold"], by_id[e.instance_id]["input"]) for e in evals]
    validity = sum(1 for e in evals if e.verdict == "pass") / len(evals) if evals else 0.0
    mean_cost = sum(e.cost_usd for e in evals) / len(evals) if evals else 0.0
    return {"scores": scores, "validity": validity, "meanCost": mean_cost}


def _candidate_models(candidates_by_kind: dict, catalog_by_id: dict[str, dict], kind: TaskKind) -> list[dict]:
    ids = candidates_by_kind.get(kind, {}).get("retrieved", [])
    return [catalog_by_id[mid] for mid in ids if mid in catalog_by_id]


def run_offline_pipeline(units: int = DEFAULT_UNITS) -> dict[str, Any]:
    candidates_by_kind = load_json(ARTIFACTS_DIR / "candidates.json")
    catalog = load_json(ARTIFACTS_DIR / "catalog.json")["models"]
    catalog_by_id = {m["id"]: m for m in catalog}

    client = FeatherlessClient(offline=True)
    sem = UnitSemaphore(total_units=units)

    per_kind_results: list[dict[str, Any]] = []
    ladders: dict[str, list[str]] = {}
    quality: dict[str, dict[str, float]] = {}
    quality_ci: dict[str, dict[str, list[float]]] = {}
    survived_round1 = 0
    promoted_count = 0

    for kind in TASK_KINDS:
        instances = _load_task_instances(kind)
        if not instances:
            continue
        held_in, held_out = _split_instances(instances)
        round1_inst, round2_inst = _round_instance_sets(held_in)

        candidate_models = _candidate_models(candidates_by_kind, catalog_by_id, kind)
        if not candidate_models:
            continue

        outcome = run_sweep(kind, candidate_models, round1_inst, round2_inst, sem, client)
        _log_round_calls(kind, 1, outcome.round1)
        _log_round_calls(kind, 2, outcome.round2)
        # outcome.round2 is exactly the round-1 survivors re-scored — its
        # length IS the round-1 survivor count, not `not r.dropped` on round1
        # (that flag only marks true errors, not the 4 eliminated by rank).
        survived_round1 += len(outcome.round2)

        if outcome.finalist is None or not held_out:
            continue

        _assert_held_out_invariant(outcome, held_out)

        finalist_model = catalog_by_id[outcome.finalist]
        final = _evaluate_and_grade(kind, finalist_model, held_out, sem, client)
        held_out_scores = final["scores"]
        held_out_acc = sum(held_out_scores) / len(held_out_scores) if held_out_scores else 0.0

        successes = round(held_out_acc * len(held_out_scores))
        ci = wilson_interval(successes, len(held_out_scores))
        drop = held_in_to_held_out_drop(outcome.held_in_accuracy, held_out_acc)

        cand_stats = CandidateStats(
            model_id=finalist_model["id"],
            accuracy=held_out_acc,
            cost_primary=final["meanCost"],
            escalation_rate=1.0 - final["validity"],
            # One escalation rung, conservatively costed at 2x the primary
            # call (SPEC.md §5.4: exactly one rung max) — we don't have a
            # real escalation-target price without running it, so this is a
            # documented approximation, not a measured number.
            cost_escalation=final["meanCost"] * 2,
        )

        frontier_model = catalog_by_id.get(FRONTIER_MODEL_ID)
        promoted = False
        if frontier_model:
            incumbent_final = _evaluate_and_grade(kind, frontier_model, held_out, sem, client)
            inc_scores = incumbent_final["scores"]
            inc_acc = sum(inc_scores) / len(inc_scores) if inc_scores else 0.0
            inc_stats = CandidateStats(
                model_id=FRONTIER_MODEL_ID,
                accuracy=inc_acc,
                cost_primary=incumbent_final["meanCost"],
                escalation_rate=1.0 - incumbent_final["validity"],
                cost_escalation=incumbent_final["meanCost"] * 2,
            )
            promoted, _decision_detail = promote_decision(cand_stats, inc_stats, DELTA_KIND)

        ladders[kind] = [finalist_model["id"], FRONTIER_MODEL_ID] if frontier_model else [finalist_model["id"]]
        quality.setdefault(finalist_model["id"], {})[kind] = round(held_out_acc, 4)
        quality_ci.setdefault(finalist_model["id"], {})[kind] = [round(ci[0], 4), round(ci[1], 4)]
        if promoted:
            promoted_count += 1

        per_kind_results.append(
            {
                "kind": kind,
                "promoted": finalist_model["id"] if promoted else None,
                "accuracy": round(held_out_acc, 4),
                "ci": [round(ci[0], 4), round(ci[1], 4)],
                "validity": round(final["validity"], 4),
                "incumbent": FRONTIER_MODEL_ID,
                "heldInAccuracy": round(outcome.held_in_accuracy, 4),
                "heldOutAccuracy": round(held_out_acc, 4),
                "heldInToHeldOutDrop": round(drop, 4),
                "costEffective": round(cost_effective(cand_stats), 6),
                "eliminatedRound1And2": outcome.eliminated_with_reason,
                "n": len(held_out_scores),
            }
        )

    return {
        "ladders": ladders,
        "quality": quality,
        "qualityCi": quality_ci,
        "perKind": per_kind_results,
        "survivedRound1": survived_round1,
        "promoted": promoted_count,
    }


def write_artifacts(pipeline_out: dict[str, Any]) -> None:
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()

    policy = {
        "version": "v1-offline",
        "generatedAt": generated_at,
        "weights": {"quality": 1.0, "cost": 0.35},
        "ladders": pipeline_out["ladders"],
        "quality": pipeline_out["quality"],
        "qualityCI": pipeline_out["qualityCi"],
        "baselines": {"frontier": FRONTIER_MODEL_ID, "cheapDefault": CHEAP_DEFAULT_MODEL_ID},
        "margin": {k: DELTA_KIND for k in TASK_KINDS},
    }
    save_json(ARTIFACTS_DIR / "policy.json", policy)

    results = {
        "generatedAt": generated_at,
        "perKind": pipeline_out["perKind"],
        "note": "Produced by harness/promote.py --offline using deterministic stub responses, not real Featherless calls. Run with --live snapshot/warmup + a real sweep for reportable numbers.",
    }
    save_json(ARTIFACTS_DIR / "results.json", results)

    catalog = load_json(ARTIFACTS_DIR / "catalog.json")
    candidates = load_json(ARTIFACTS_DIR / "candidates.json")
    warm_status_path = ARTIFACTS_DIR / "warm_status.json"
    reachable = None
    if warm_status_path.exists():
        warm_status = load_json(warm_status_path)
        reachable = sum(1 for s in warm_status["models"] if s["reachable"])

    n_prefilter = sum(v.get("prefilterCount", 0) for v in candidates.values() if isinstance(v, dict))
    n_retrieved = sum(len(v.get("retrieved", [])) for v in candidates.values() if isinstance(v, dict))

    funnel = {
        "stages": [
            {"label": "models catalogued", "count": catalog.get("count", 0)},
            {"label": "tool-use-capable", "count": sum(1 for m in catalog["models"] if m.get("toolUse"))},
            {"label": "passed metadata prefilter", "count": n_prefilter},
            {"label": "retrieved (8 x kinds)", "count": n_retrieved},
            {"label": "reachable at sweep time", "count": reachable},
            {"label": "survived round 1", "count": pipeline_out["survivedRound1"]},
            {"label": "promoted", "count": pipeline_out["promoted"]},
        ],
        "note": (
            "Offline-sample numbers, not the real 45,190/34,504 catalog crawl — "
            "those require `snapshot.py --live`. Download-distribution histogram "
            "requires hfDownloads on reachable vs unreachable candidates from a "
            "live warmup run; not computed on the offline stub path."
        ),
    }
    save_json(ARTIFACTS_DIR / "funnel.json", funnel)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", default=True, help="Use deterministic stub responses (default; no API key required)")
    parser.add_argument("--units", type=int, default=DEFAULT_UNITS)
    args = parser.parse_args()

    if SWEEP_LOG.exists():
        SWEEP_LOG.unlink()  # each run starts a fresh audit log

    pipeline_out = run_offline_pipeline(units=args.units)
    write_artifacts(pipeline_out)
    print("promote: wrote policy.json, results.json, funnel.json, sweep-log.jsonl")


if __name__ == "__main__":
    main()
