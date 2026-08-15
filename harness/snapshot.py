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
import re
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


# Featherless encodes model size in the id/model_class (e.g. "llama33-70b"),
# not a numeric field — parse it, taking the first "<n>b" token.
_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*b\b")
_INSTRUCT_MARKERS = ("instruct", "-it", "chat", "sft", "dpo", "rlhf", "-rl")


def _parse_params_b(model_class: str, model_id: str) -> float:
    for s in (model_class or "", model_id or ""):
        match = _SIZE_RE.search(s.lower())
        if match:
            return float(match.group(1))
    return 0.0


def _is_base_non_instruct(model_id: str) -> bool:
    low = model_id.lower()
    return "base" in low and not any(mk in low for mk in _INSTRUCT_MARKERS)


def _synth_card(model_id: str, model_class: str) -> str:
    # /v1/models carries no description, so the id + model_class are the only
    # text signal for BM25/dense retrieval — synthesize a card from them.
    tokens = re.split(r"[^a-z0-9.]+", f"{model_id} {model_class}".lower())
    return " ".join(t for t in tokens if t)


def _to_candidate(m: dict) -> ModelCandidate:
    # Featherless's model objects nest pricing/features differently than our
    # ModelCandidate shape — this is the one place that translation happens.
    # Real /v1/models fields: id, model_class, context_length, concurrency_cost,
    # pricing{input,output}, features{tool_use}, available_on_current_plan,
    # is_gated. There is NO params_b, availability tier, or hf_downloads.
    model_id = m["id"]
    model_class = m.get("model_class") or model_id.split("/")[-1]
    pricing = m.get("pricing") or {}
    features = m.get("features") or {}
    return ModelCandidate(
        id=model_id,
        modelClass=model_class,
        contextLength=int(m.get("context_length", 0) or 0),
        paramsB=_parse_params_b(model_class, model_id),
        # pricing.input / pricing.output are $ per 1M tokens.
        pricePerMTokIn=float(pricing.get("input", 0) or 0),
        pricePerMTokOut=float(pricing.get("output", 0) or 0),
        concurrencyCost=int(m.get("concurrency_cost", 1) or 1),
        # No availability tier in the catalog (SPEC.md §9.1) — warmth is only
        # knowable by probing (warmup.py) or at call time (400 => cold).
        availability="unknown",
        isHotLive=False,
        toolUse=bool(features.get("tool_use", False)),
        # Gated models 403 on call (HF auth), so treat them as off-plan here.
        availableOnPlan=bool(m.get("available_on_current_plan", True)) and not bool(m.get("is_gated", False)),
        hfDownloads=None,
        isBaseNonInstruct=_is_base_non_instruct(model_id),
        cardText=_synth_card(model_id, model_class),
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
