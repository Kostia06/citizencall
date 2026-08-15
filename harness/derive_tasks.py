"""derive_tasks.py — turns logged agent sub-task traces into TaskInstances.

This backs the SPEC.md §17 novelty claim: "task-specific eval sets derived
from the agent's own logged sub-tasks". SPEC.md §17 is explicit about the
alternative: "If derive_tasks.py doesn't get built, delete the 'derived from
traces' clause" — so this module does NOT fabricate trace data to make that
claim true.

TODO(real traces): the worker has no trace export yet. `worker/schema.sql`
defines `sub_tasks` and `hops` tables, but nothing in `worker/` currently
dumps them to a file this script can read (e.g. a `wrangler d1 execute
--command "SELECT ... FROM sub_tasks JOIN hops"` or a `/api/run/:id` JSON
export). Until that exists, `--traces` has nothing real to point at, and
running this script without it is a deliberate, visible no-op (exit 0, not
an error — the offline pipeline must still run clean end-to-end without it).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from common import HARNESS_DIR, TaskInstance


def sub_task_to_instance(sub_task: dict, gold: object, split: str) -> TaskInstance:
    """Mechanical conversion: one logged sub_task + one hand-provided gold
    label becomes one TaskInstance. Gold is NEVER inferred from the
    sub-task's own model output — SPEC.md §9.5 explains why that's circular:
    if gold is unedited frontier output, the frontier model wins by
    construction and no candidate can ever beat it."""
    return TaskInstance(
        id=sub_task["id"],
        kind=sub_task["kind"],
        instruction=sub_task["instruction"],
        input=sub_task.get("payload_json", sub_task.get("input", "")),
        gold=gold,
        split=split,  # type: ignore[typeddict-item]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--traces",
        type=Path,
        default=None,
        help="Path to an exported sub_tasks JSONL from the worker's D1 (not yet produced by worker/)",
    )
    parser.add_argument(
        "--gold", type=Path, default=None, help="Path to a JSON map of sub_task id -> hand-written gold label"
    )
    parser.add_argument("--kind", default=None, help="Restrict to one TaskKind")
    args = parser.parse_args()

    if not args.traces or not args.traces.exists():
        print(
            "derive_tasks: no real trace export found — see module docstring "
            "TODO. Nothing derived; this is expected, not an error.",
            file=sys.stderr,
        )
        return

    sub_tasks = [json.loads(line) for line in args.traces.read_text().splitlines() if line.strip()]
    gold_map = json.loads(args.gold.read_text()) if args.gold and args.gold.exists() else {}

    instances: list[TaskInstance] = []
    for i, st in enumerate(sub_tasks):
        if args.kind and st.get("kind") != args.kind:
            continue
        if st["id"] not in gold_map:
            continue  # never fabricate a gold label just to keep an instance
        split = "held_out" if i % 4 == 0 else "held_in"
        instances.append(sub_task_to_instance(st, gold_map[st["id"]], split))

    if not instances:
        print("derive_tasks: trace export had no gold-labeled sub-tasks; wrote nothing.", file=sys.stderr)
        return

    out_path = HARNESS_DIR / "tasks" / f"derived_{args.kind or 'all'}.jsonl"
    with out_path.open("w") as f:
        for inst in instances:
            f.write(json.dumps(inst) + "\n")
    print(f"derive_tasks: wrote {len(instances)} instances -> {out_path}")


if __name__ == "__main__":
    main()
