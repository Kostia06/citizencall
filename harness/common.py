"""Shared paths, IO helpers, and typed shapes mirrored from worker/src/types.ts.

Keeping these in one module means every stage (snapshot, retrieve, halving,
grade, stats, promote) agrees on field names — JSON artifacts must match the
TS `Policy` / `ModelCandidate` / `TaskInstance` interfaces.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal, TypedDict

HARNESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_DIR.parent
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
TASKS_DIR = HARNESS_DIR / "tasks"
FIXTURES_DIR = HARNESS_DIR / "fixtures"

ARTIFACTS_DIR.mkdir(exist_ok=True)

# --live runs need FEATHERLESS_API_KEY; load it from a .env at repo root if
# present. Silently a no-op offline — no key is required for --offline runs.
try:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

TaskKind = Literal["classify", "extract_fields", "summarize", "normalize"]
Availability = Literal["warm", "loading", "cold", "offline", "unknown"]
Split = Literal["held_in", "held_out"]


class ModelCandidate(TypedDict, total=False):
    id: str
    modelClass: str
    contextLength: int
    paramsB: float
    pricePerMTokIn: float
    pricePerMTokOut: float
    concurrencyCost: int
    availability: Availability
    isHotLive: bool
    toolUse: bool
    availableOnPlan: bool
    hfDownloads: int
    isBaseNonInstruct: bool  # retrieval-only tag for the SPEC.md §9.2 negative control
    cardText: str  # retrieval-only, not part of the TS ModelCandidate interface


class TaskInstance(TypedDict):
    id: str
    kind: TaskKind
    instruction: str
    input: str
    gold: Any
    split: Split


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def concurrency_cost_for(params_b: float) -> int:
    """Featherless reserves concurrency units by size band — SPEC.md §9.6:
    <16B=1, <34B=2, 70B+=4. The 34-70B gap isn't specified; we round up to 4
    (conservative — better to under-schedule than trip a 429). Prefer the
    API-reported `concurrencyCost` when available; this is the offline/stub
    fallback only, "from the API, never inferred" per spec."""
    if params_b < 16:
        return 1
    if params_b < 34:
        return 2
    return 4
