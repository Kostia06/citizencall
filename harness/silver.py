"""silver.py — the frontier-baseline pass SPEC.md §9.5 asks for.

    "Run the frontier baseline once per instance, then hand-correct."

Runs the incumbent (GLM-5.2) over every instance, grades its answer against
the CURRENT label, and writes a review file listing every DISAGREEMENT for a
human to adjudicate.

Why it stops at "listing disagreements" and does not rewrite anything:
SPEC.md §9.5 is explicit that unedited frontier output cannot be gold — the
incumbent would then score 1.000 by construction and no candidate could ever
win, degenerating the benchmark into "agreement with GLM-5.2". The same
circularity applies to ANY model adjudicating, so the resolution column is
left empty on purpose. A human fills it in.

    python silver.py --live      # real GLM-5.2 calls (needs FEATHERLESS_API_KEY)
    python silver.py             # offline stub — exercises the plumbing only

Output: artifacts/silver-review.json  (+ a printed summary)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from typing import Any

from common import ARTIFACTS_DIR, TASKS_DIR, TaskKind, load_jsonl, save_json
from evaluate import MAX_TOKENS_BY_KIND
from grade import grade
from scheduler import FeatherlessClient, UnitSemaphore

FRONTIER_MODEL_ID = "zai-org/GLM-5.2"
TASK_KINDS: list[TaskKind] = ["classify", "extract_fields", "summarize", "normalize"]

# The frontier is asked for the SAME output shape the graders expect, so a
# disagreement is a genuine content difference and not a formatting artifact.
SYSTEM_BY_KIND: dict[str, str] = {
    "classify": "Reply with only the single label, lowercase, nothing else.",
    "extract_fields": "Reply with only a single JSON object, no prose and no code fences.",
    "summarize": "Reply with one or two sentences. Be concise and factual.",
    "normalize": "Reply with only the cleaned instruction, no preamble.",
}


def _gold_repr(gold: Any) -> str:
    return json.dumps(gold, ensure_ascii=False) if not isinstance(gold, str) else gold


def run(live: bool, units: int) -> dict[str, Any]:
    client = FeatherlessClient(offline=not live)
    sem = UnitSemaphore(total_units=units)

    rows: list[dict[str, Any]] = []
    calls = 0

    for kind in TASK_KINDS:
        instances = load_jsonl(TASKS_DIR / f"{kind}.jsonl")
        for inst in instances:
            messages = [
                {"role": "system", "content": SYSTEM_BY_KIND[kind]},
                {"role": "user", "content": f"{inst['instruction']}\n\n{inst['input']}"},
            ]
            try:
                with sem.reserve(4):  # GLM-5.2 is a 70B+ model — 4 units (§9.6)
                    res = client.chat(FRONTIER_MODEL_ID, messages, MAX_TOKENS_BY_KIND[kind])
                out, err = res.text.strip(), None
            except Exception as exc:  # cold / plan / backpressure — recorded, never silent
                out, err = "", str(exc)
            calls += 1

            score = grade(kind, out, inst["gold"], inst["input"]) if out else 0.0
            if score < 1.0:
                rows.append(
                    {
                        "id": inst["id"],
                        "kind": kind,
                        "split": inst["split"],
                        "instruction": inst["instruction"],
                        "input": inst["input"],
                        "currentLabel": inst["gold"],
                        "frontierAnswer": out,
                        "score": round(score, 4),
                        "error": err,
                        # A human writes one of: keep-label | use-frontier | rewrite-both
                        "resolution": "",
                        "resolutionNote": "",
                    }
                )

    return {"disagreements": rows, "calls": calls}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Real GLM-5.2 calls (needs FEATHERLESS_API_KEY)")
    parser.add_argument("--units", type=int, default=8)
    args = parser.parse_args()

    out = run(args.live, args.units)
    total = sum(len(load_jsonl(TASKS_DIR / f"{k}.jsonl")) for k in TASK_KINDS)
    rows = out["disagreements"]

    save_json(
        ARTIFACTS_DIR / "silver-review.json",
        {
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "provenance": "live-featherless" if args.live else "offline-stub",
            "frontier": FRONTIER_MODEL_ID,
            "instancesChecked": total,
            "disagreements": len(rows),
            "note": (
                "Each row is a case where the frontier baseline disagreed with the current "
                "label. Fill `resolution` per row: keep-label | use-frontier | rewrite-both. "
                "Leaving frontier output as gold is what SPEC.md §9.5 forbids — the incumbent "
                "would score 1.000 by construction."
            ),
            "rows": rows,
        },
    )

    by_kind: dict[str, int] = {}
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
    print(f"silver: {len(rows)}/{total} disagreements ({'live' if args.live else 'offline stub'})")
    for k in TASK_KINDS:
        n = sum(1 for _ in load_jsonl(TASKS_DIR / f"{k}.jsonl"))
        print(f"  {k:16} {by_kind.get(k, 0):2}/{n}")
    print(f"-> {ARTIFACTS_DIR / 'silver-review.json'}  (fill in `resolution` per row)")


if __name__ == "__main__":
    main()
