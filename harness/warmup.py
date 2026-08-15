"""warmup.py — warms retrieved candidates, baseline (largest/slowest) first.

Docs say large models can take up to an hour to warm, small ones ~5 minutes
(SPEC.md §9.1) — starting the slowest one first means it's warm by the time
everything else finishes. `availability.tier` only refreshes every ~5
minutes, so we confirm `warm` with one cheap real request (max_tokens=1)
rather than trusting the last snapshot (SPEC.md §9.1, §9.6).
"""
from __future__ import annotations

import argparse
import time
from typing import Any

from common import ARTIFACTS_DIR, load_json, save_json
from scheduler import FeatherlessClient, ModelColdError, UnitSemaphore


def _baseline_first(models: list[dict]) -> list[dict]:
    return sorted(models, key=lambda m: -m.get("paramsB", 0))


def warm_one(client: FeatherlessClient, sem: UnitSemaphore, model: dict) -> dict[str, Any]:
    units = model.get("concurrencyCost", 1)
    start = time.monotonic()
    try:
        with sem.reserve(units):
            client.chat(model["id"], [{"role": "user", "content": "ping"}], max_tokens=1)
        return {
            "modelId": model["id"],
            "reachable": True,
            "reason": None,
            "ms": (time.monotonic() - start) * 1000,
        }
    except ModelColdError:
        return {
            "modelId": model["id"],
            "reachable": False,
            "reason": "cold (400)",
            "ms": (time.monotonic() - start) * 1000,
        }
    except Exception as exc:
        return {
            "modelId": model["id"],
            "reachable": False,
            "reason": str(exc),
            "ms": (time.monotonic() - start) * 1000,
        }


def _candidate_ids(candidates: dict) -> set[str]:
    ids: set[str] = set()
    for kind_data in candidates.values():
        if isinstance(kind_data, dict):
            ids |= set(kind_data.get("retrieved", []))
            ids |= set(kind_data.get("retrievalControl", []))
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--units", type=int, default=8)
    args = parser.parse_args()

    catalog = load_json(ARTIFACTS_DIR / "catalog.json")["models"]
    candidates = load_json(ARTIFACTS_DIR / "candidates.json")
    catalog_by_id = {m["id"]: m for m in catalog}

    models = _baseline_first([catalog_by_id[mid] for mid in _candidate_ids(candidates) if mid in catalog_by_id])

    client = FeatherlessClient(offline=not args.live)
    sem = UnitSemaphore(total_units=args.units)

    statuses = []
    for m in models:
        if client.offline:
            statuses.append({"modelId": m["id"], "reachable": True, "reason": "offline stub", "ms": 0.0})
        else:
            statuses.append(warm_one(client, sem, m))

    save_json(ARTIFACTS_DIR / "warm_status.json", {"models": statuses})
    reachable = sum(1 for s in statuses if s["reachable"])
    print(f"warmup: {reachable}/{len(statuses)} reachable ({'live' if args.live else 'offline stub'})")


if __name__ == "__main__":
    main()
