"""grade.py — the gold-label grader. SEPARATE from runtime verify() in
evaluate.py (SPEC.md §5.4): verify has no labels and drives escalation; grade
needs gold labels and only ever runs in the harness, never at request time.

Per-kind metrics, verbatim from the SPEC.md §5.4 table:
  classify        -> exact match
  extract_fields  -> per-field exact match, mean (partial credit)
  summarize       -> fraction of must-contain facts entailed AND a
                     compression guard, len(out)/len(src) <= 0.4
  normalize       -> token-F1 vs the reference clean instruction
"""
from __future__ import annotations

import json
import re
from typing import Any

from common import TaskKind

COMPRESSION_GUARD_RATIO = 0.4  # SPEC.md §5.4 — kills the copy-the-source exploit


def grade(kind: TaskKind, output: str, gold: Any, source: str = "") -> float:
    if kind == "classify":
        return _grade_classify(output, gold)
    if kind == "extract_fields":
        return _grade_extract_fields(output, gold)
    if kind == "summarize":
        return _grade_summarize(output, gold, source)
    if kind == "normalize":
        return _grade_normalize(output, gold)
    raise ValueError(f"unknown kind: {kind}")


def _grade_classify(output: str, gold: Any) -> float:
    return 1.0 if output.strip().lower() == str(gold).strip().lower() else 0.0


def _grade_extract_fields(output: str, gold: Any) -> float:
    """Per-field exact match, averaged — partial credit for partial extraction."""
    if not isinstance(gold, dict) or not gold:
        return 0.0
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return 0.0
    if not isinstance(parsed, dict):
        return 0.0
    hits = sum(
        1
        for k, v in gold.items()
        if str(parsed.get(k, "__missing__")).strip().lower() == str(v).strip().lower()
    )
    return hits / len(gold)


_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _fact_entailed(fact: str, output: str) -> bool:
    """Heuristic entailment: no NLI model available offline, so a fact counts
    as covered if most of its content words appear in the output. Cheap and
    conservative enough not to be gamed by keyword stuffing alone (needs a
    >=60% token overlap with the fact itself, not the whole output)."""
    fact_tokens = set(_tokens(fact))
    if not fact_tokens:
        return False
    output_tokens = set(_tokens(output))
    overlap = len(fact_tokens & output_tokens) / len(fact_tokens)
    return overlap >= 0.6


def _grade_summarize(output: str, gold: Any, source: str) -> float:
    facts = gold if isinstance(gold, list) else [str(gold)]
    if source and len(output) / max(1, len(source)) > COMPRESSION_GUARD_RATIO:
        # Verbatim-copy exploit: a copy of the source trivially "contains"
        # every fact. Zero it out regardless of fact coverage — this is the
        # one line SPEC.md §5.4 says kills that exploit.
        return 0.0
    if not facts:
        return 0.0
    entailed = sum(1 for f in facts if _fact_entailed(str(f), output))
    return entailed / len(facts)


def _grade_normalize(output: str, gold: Any) -> float:
    """Token-F1 vs the reference clean instruction."""
    pred_tokens = _tokens(output)
    gold_tokens = _tokens(str(gold))
    if not pred_tokens or not gold_tokens:
        return 0.0
    pred_set, gold_set = set(pred_tokens), set(gold_tokens)
    common = pred_set & gold_set
    if not common:
        return 0.0
    precision = len(common) / len(pred_set)
    recall = len(common) / len(gold_set)
    return 2 * precision * recall / (precision + recall)
