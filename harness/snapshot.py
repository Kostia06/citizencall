"""snapshot.py — pulls the Featherless model catalog + LIVE prices.

Prices are NOT monotonic in parameter count on Featherless (SPEC.md §5.2):
Qwen3-1.7B is $0.32/$1.60 while Qwen3-8B is $0.0835/$0.4275. Every ladder
must be built from this file's output, never from intuition about size.

Network calls are gated behind --live; the default (offline) path reads a
committed sample fixture so the whole harness runs with zero API key.
"""
from __future__ import annotations

import argparse
import os
import sys

import requests

from common import ARTIFACTS_DIR, FIXTURES_DIR, ModelCandidate, load_json, save_json

FEATHERLESS_MODELS_URL = "https://api.featherless.ai/v1/models"


def fetch_live_catalog(api_key: str) -> list[ModelCandidate]:
    """Pulls the full model list + live pricing/availability from Featherless.
    Raises on network/auth failure rather than silently falling back — a
    --live run that can't reach the API should fail loudly, not produce a
    catalog that looks real but isn't."""
    resp = requests.get(
        FEATHERLESS_MODELS_URL, headers={"Authorization": f"Bearer {api_key}"}, timeout=30
    )
    resp.raise_for_status()
    raw = resp.json().get("data", [])
    return [_to_candidate(m) for m in raw]


def _to_candidate(m: dict) -> ModelCandidate:
    # Featherless's model objects nest pricing/availability differently than
    # our ModelCandidate shape — this is the one place that translation happens.
    return ModelCandidate(
        id=m["id"],
        modelClass=m.get("model_class", m["id"].split("/")[-1]),
        contextLength=int(m.get("context_length", 0)),
        paramsB=float(m.get("params_b", 0) or 0),
        pricePerMTokIn=float(m.get("price_per_mtok_in", 0) or 0),
        pricePerMTokOut=float(m.get("price_per_mtok_out", 0) or 0),
        concurrencyCost=int(m.get("concurrency_cost", 1) or 1),
        availability=m.get("availability", "unknown"),
        isHotLive=bool(m.get("is_hot_live", False)),
        toolUse=bool(m.get("tool_use", False)),
        availableOnPlan=bool(m.get("available_on_plan", True)),
        hfDownloads=m.get("hf_downloads"),
        isBaseNonInstruct=bool(m.get("is_base_non_instruct", False)),
        cardText=m.get("description", ""),
    )


def load_offline_sample() -> list[ModelCandidate]:
    return load_json(FIXTURES_DIR / "catalog_sample.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live", action="store_true", help="Pull live from Featherless (needs FEATHERLESS_API_KEY)"
    )
    args = parser.parse_args()

    if args.live:
        api_key = os.environ.get("FEATHERLESS_API_KEY")
        if not api_key:
            print("FEATHERLESS_API_KEY not set; cannot run --live", file=sys.stderr)
            sys.exit(1)
        catalog = fetch_live_catalog(api_key)
        source = "live"
    else:
        catalog = load_offline_sample()
        source = "offline-sample"

    out_path = ARTIFACTS_DIR / "catalog.json"
    save_json(out_path, {"source": source, "count": len(catalog), "models": catalog})
    print(f"snapshot: wrote {len(catalog)} models ({source}) -> {out_path}")


if __name__ == "__main__":
    main()
