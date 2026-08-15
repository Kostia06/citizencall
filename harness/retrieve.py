"""retrieve.py — prefilter (SPEC.md §9.2) -> BM25 + dense + Reciprocal Rank
Fusion (k=60) -> top-8 candidates per task kind, plus the two controls.

Hybrid because model-card text is unreliable: only ~67% of HF models have
cards, ~30% of derivative cards are auto-generated, and card length drops
~5,000 chars parent->child. Lexical (BM25) catches naming conventions like
`-coder-`/`-instruct-`; dense catches paraphrase; RRF merges with no tuning.
"""
from __future__ import annotations

import argparse
import random
import re
from typing import Any

import numpy as np
from rank_bm25 import BM25Okapi

from common import ARTIFACTS_DIR, ModelCandidate, load_json, save_json

RRF_K = 60
TOP_K = 8
PREFILTER_MAX_PARAMS_B = 35  # SPEC.md §9.2 — the sweep budget can't reach big models anyway

KIND_SPECS: dict[str, dict[str, Any]] = {
    "classify": {
        "query": "text classification instruction following short label output",
        "ctx": 4096,
        "needs_tools": False,
    },
    "extract_fields": {
        "query": "structured field extraction json output instruction following schema",
        "ctx": 8192,
        "needs_tools": False,
    },
    "summarize": {
        "query": "summarization long document condensation instruction following",
        "ctx": 16384,
        "needs_tools": False,
    },
    "normalize": {
        "query": "clean up messy transcribed speech into a clear short instruction",
        "ctx": 2048,
        "needs_tools": False,
    },
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _card_text(m: ModelCandidate) -> str:
    return f"{m['id']} {m.get('modelClass', '')} {m.get('cardText', '')}"


def prefilter(catalog: list[ModelCandidate], kind: str) -> list[ModelCandidate]:
    spec = KIND_SPECS[kind]
    return [
        m
        for m in catalog
        if m.get("contextLength", 0) >= spec["ctx"]
        and (m.get("toolUse") or not spec["needs_tools"])
        and m.get("availability") in ("warm", "loading")
        and m.get("availableOnPlan")
        and m.get("paramsB", 0) <= PREFILTER_MAX_PARAMS_B
    ]


def _bm25_rank(pool: list[ModelCandidate], query: str) -> list[str]:
    corpus = [_tokenize(_card_text(m)) for m in pool]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(_tokenize(query))
    order = np.argsort(-scores)
    return [pool[i]["id"] for i in order]


def _hashing_embed(text: str, dims: int = 256) -> np.ndarray:
    """Feature-hashing fallback dense embedding, used when sentence-
    transformers isn't installed — deterministic, no download, good enough
    for RRF to catch loose paraphrase overlap that exact-token BM25 misses."""
    vec = np.zeros(dims, dtype=np.float64)
    for tok in _tokenize(text):
        idx = hash(tok) % dims
        vec[idx] += 1.0
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def _dense_rank(pool: list[ModelCandidate], query: str) -> list[str]:
    try:
        from sentence_transformers import SentenceTransformer  # optional — see requirements.txt

        model = SentenceTransformer("all-MiniLM-L6-v2")
        card_vecs = model.encode([_card_text(m) for m in pool], normalize_embeddings=True)
        query_vec = model.encode([query], normalize_embeddings=True)[0]
        scores = card_vecs @ query_vec
    except ImportError:
        card_vecs = np.stack([_hashing_embed(_card_text(m)) for m in pool])
        query_vec = _hashing_embed(query)
        scores = card_vecs @ query_vec
    order = np.argsort(-scores)
    return [pool[i]["id"] for i in order]


def reciprocal_rank_fusion(*rankings: list[str], k: int = RRF_K) -> list[str]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, model_id in enumerate(ranking):
            scores[model_id] = scores.get(model_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda mid: -scores[mid])


def retrieve_for_kind(catalog: list[ModelCandidate], kind: str, seed: int = 42) -> dict[str, Any]:
    pool = prefilter(catalog, kind)
    if not pool:
        return {"retrieved": [], "prefilterCount": 0, "negativeControl": None, "retrievalControl": []}

    spec = KIND_SPECS[kind]
    lexical = _bm25_rank(pool, spec["query"])
    dense = _dense_rank(pool, spec["query"])
    fused = reciprocal_rank_fusion(dense, lexical)

    # Negative control (SPEC.md §9.2): force in one deliberately-incompetent
    # base, non-instruct checkpoint. If it survives round 2, the graders are
    # broken and we learn it before the camera.
    negative_control = next((m["id"] for m in pool if m.get("isBaseNonInstruct")), None)
    top = [mid for mid in fused if mid != negative_control][: TOP_K - (1 if negative_control else 0)]
    retrieved = top + ([negative_control] if negative_control else [])

    # Retrieval control (SPEC.md §9.2): 2 candidates drawn uniformly at
    # random from the prefilter pool. If the retrieved 6 don't beat these,
    # hybrid retrieval added nothing.
    rng = random.Random(seed)
    pool_ids = [m["id"] for m in pool]
    retrieval_control = rng.sample(pool_ids, k=min(2, len(pool_ids)))

    return {
        "retrieved": retrieved,
        "prefilterCount": len(pool),
        "negativeControl": negative_control,
        "retrievalControl": retrieval_control,
    }


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()

    catalog = load_json(ARTIFACTS_DIR / "catalog.json")["models"]
    out = {kind: retrieve_for_kind(catalog, kind) for kind in KIND_SPECS}
    save_json(ARTIFACTS_DIR / "candidates.json", out)
    for kind, res in out.items():
        print(
            f"retrieve[{kind}]: prefilter={res['prefilterCount']} "
            f"retrieved={len(res['retrieved'])} negControl={res['negativeControl']}"
        )


if __name__ == "__main__":
    main()
