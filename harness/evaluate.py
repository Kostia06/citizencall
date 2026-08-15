"""evaluate.py — runs a candidate over a set of instances via the scheduler,
returns per-instance outputs + hop metadata for grade.py to score.

Runtime `verify()` (schema/non-empty) lives here, NOT grade.py — SPEC.md §5.4
keeps them separate on purpose: verify has no labels and drives escalation,
grade needs gold labels and only ever runs in the harness.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass

from common import ModelCandidate, TaskInstance, TaskKind, concurrency_cost_for
from scheduler import FeatherlessClient, UnitSemaphore

MAX_TOKENS_BY_KIND: dict[TaskKind, int] = {
    "classify": 16,
    "extract_fields": 256,
    "summarize": 200,
    "normalize": 64,
}


@dataclass
class EvalResult:
    instance_id: str
    model_id: str
    output: str
    verdict: str  # Verdict from types.ts, computed here at runtime — no gold used
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    latency_ms: float


def verify(kind: TaskKind, output: str) -> str:
    """Runtime verdict — schema validity / non-empty, no gold labels involved."""
    if not output or not output.strip():
        return "fail_empty"
    if kind == "extract_fields":
        try:
            json.loads(output)
        except json.JSONDecodeError:
            return "fail_schema"
    return "pass"


def _cost_usd(model: ModelCandidate, prompt_tokens: int, completion_tokens: int) -> float:
    return (
        prompt_tokens * model["pricePerMTokIn"] / 1_000_000
        + completion_tokens * model["pricePerMTokOut"] / 1_000_000
    )


def _model_skill(model: ModelCandidate) -> float:
    """Deterministic pseudo-skill for the offline stub path — NOT a real eval.

    Loosely correlated with size plus per-model hash noise, so the offline
    demo isn't monotonic in params (mirrors the real non-monotonic pricing
    finding in SPEC.md §5.2). The negative control (a non-instruct base
    checkpoint, SPEC.md §9.2) is pinned low so it reliably gets eliminated in
    round 1, as a real base model would on instruction-following tasks.
    """
    if model.get("isBaseNonInstruct"):
        return 0.12
    h = int(hashlib.sha256(model["id"].encode()).hexdigest()[:8], 16)
    noise = (h % 1000) / 1000 * 0.3 - 0.15  # +/- 0.15
    base = 0.55 + min(model.get("paramsB", 1), 70) / 70 * 0.35
    return max(0.05, min(0.97, base + noise))


def _stub_output(kind: TaskKind, instance: TaskInstance, model: ModelCandidate) -> str:
    """Deterministic offline stand-in for a real Featherless completion.

    Whether the stub is "correct" is decided by hashing (model, instance)
    against the model's pseudo-skill — deterministic across runs (no RNG
    state carried between calls) while still varying across models/instances,
    so successive-halving has something real to differentiate on offline.
    """
    skill = _model_skill(model)
    h = int(hashlib.sha256(f"{model['id']}|{instance['id']}".encode()).hexdigest()[:8], 16)
    roll = (h % 10_000) / 10_000
    correct = roll < skill

    gold = instance["gold"]
    if kind == "classify":
        return str(gold) if correct else "unknown"
    if kind == "extract_fields":
        if correct:
            return json.dumps(gold)
        if isinstance(gold, dict) and gold:
            partial = dict(list(gold.items())[:-1])  # drop one field to simulate a partial miss
            return json.dumps(partial)
        return "{}"
    if kind == "summarize":
        facts = gold if isinstance(gold, list) else [str(gold)]
        if correct:
            return ". ".join(facts[: max(1, len(facts) - 1)]) + "."
        return instance["input"]  # verbatim copy — meant to trip the compression guard
    if kind == "normalize":
        return str(gold) if correct else instance["input"]
    return ""


def run_candidate(
    model: ModelCandidate,
    instances: list[TaskInstance],
    sem: UnitSemaphore,
    client: FeatherlessClient,
) -> list[EvalResult]:
    """Evaluates one candidate over `instances`. Cheapest-first ORDERING OF
    CANDIDATES is the caller's responsibility (SPEC.md §9.6: a scheduling bug
    found on call 900 of a cheap model is much cheaper than on an expensive
    one) — this function just runs one candidate's calls in instance order.
    """
    results: list[EvalResult] = []
    units = model.get("concurrencyCost") or concurrency_cost_for(model.get("paramsB", 1))
    for inst in instances:
        max_tokens = MAX_TOKENS_BY_KIND[inst["kind"]]
        start = time.monotonic()
        try:
            with sem.reserve(units):
                if client.offline:
                    output = _stub_output(inst["kind"], inst, model)
                    prompt_tokens = max(1, len(inst["input"].split()))
                    completion_tokens = max(1, len(output.split()))
                    latency_ms = 5.0
                else:
                    chat = client.chat(
                        model["id"],
                        [{"role": "user", "content": f"{inst['instruction']}\n\n{inst['input']}"}],
                        max_tokens,
                    )
                    output = chat.text
                    prompt_tokens, completion_tokens = chat.prompt_tokens, chat.completion_tokens
                    latency_ms = chat.latency_ms
        except Exception:  # ModelColdError, ConcurrencyExhausted, PlanExclusionError, etc.
            results.append(
                EvalResult(
                    instance_id=inst["id"],
                    model_id=model["id"],
                    output="",
                    verdict="fail_cold",
                    prompt_tokens=0,
                    completion_tokens=0,
                    cost_usd=0.0,
                    latency_ms=(time.monotonic() - start) * 1000,
                )
            )
            continue
        verdict = verify(inst["kind"], output)
        cost = _cost_usd(model, prompt_tokens, completion_tokens)
        results.append(
            EvalResult(
                instance_id=inst["id"],
                model_id=model["id"],
                output=output,
                verdict=verdict,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost,
                latency_ms=latency_ms,
            )
        )
    return results
