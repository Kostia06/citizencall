"""scheduler.py — Featherless concurrency-unit semaphore + HTTP client wrapper.

Featherless RESERVES concurrency units per in-flight call (SPEC.md §9.6):
<16B=1, <34B=2, 70B+=4. Going over budget is an immediate 429 with NO queue —
so this semaphore must reject rather than block when the budget is exhausted,
unlike a normal bounded worker pool.
"""
from __future__ import annotations

import hashlib
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator

import requests

FEATHERLESS_CHAT_URL = "https://api.featherless.ai/v1/chat/completions"
REQUEST_TIMEOUT_S = 120  # no documented upstream timeout — SPEC.md §5.3
MAX_RETRIES_503 = 3


class ConcurrencyExhausted(RuntimeError):
    """Raised immediately when reserving would exceed the unit budget — no queue."""


class ModelColdError(RuntimeError):
    """400 — model cold. Requeue elsewhere; never a benchmark failure (SPEC.md §5.3)."""


class PlanExclusionError(RuntimeError):
    """403 — plan exclusion or HF gating (SPEC.md §5.3)."""


class UnitSemaphore:
    """Reserves Featherless concurrency units. Thread-safe; fails fast, never queues."""

    def __init__(self, total_units: int) -> None:
        self._total = total_units
        self._used = 0
        self._lock = threading.Lock()

    @contextmanager
    def reserve(self, units: int) -> Iterator[None]:
        with self._lock:
            if self._used + units > self._total:
                raise ConcurrencyExhausted(
                    f"need {units} units, {self._total - self._used} available of {self._total}"
                )
            self._used += units
        try:
            yield
        finally:
            with self._lock:
                self._used -= units

    @property
    def available(self) -> int:
        with self._lock:
            return self._total - self._used


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    status_code: int


class FeatherlessClient:
    """Thin wrapper around /v1/chat/completions with the retry/error table
    from SPEC.md §5.3. offline=True (or no key) short-circuits to a
    deterministic stub so the whole harness runs without an API key.
    """

    def __init__(self, api_key: str | None = None, offline: bool = False) -> None:
        self.api_key = api_key or os.environ.get("FEATHERLESS_API_KEY")
        self.offline = offline or not self.api_key

    def chat(self, model_id: str, messages: list[dict[str, str]], max_tokens: int) -> ChatResult:
        if self.offline:
            return self._stub_chat(model_id, messages)
        return self._live_chat(model_id, messages, max_tokens)

    def _stub_chat(self, model_id: str, messages: list[dict[str, str]]) -> ChatResult:
        # Generic deterministic stub used only when no task-aware caller (e.g.
        # warmup.py's ping) needs a real response. evaluate.py bypasses this
        # with a gold-aware stub — see its module docstring for why.
        prompt = messages[-1]["content"] if messages else ""
        digest = hashlib.sha256(f"{model_id}|{prompt}".encode()).hexdigest()
        text = f"[stub:{model_id.split('/')[-1]}] {digest[:8]}"
        return ChatResult(
            text=text,
            prompt_tokens=max(1, len(prompt.split())),
            completion_tokens=max(1, len(text.split())),
            latency_ms=5.0,
            status_code=200,
        )

    def _live_chat(self, model_id: str, messages: list[dict[str, str]], max_tokens: int) -> ChatResult:
        payload = {
            "model": model_id,
            "messages": messages,
            "temperature": 0,
            "seed": 42,
            "max_tokens": max_tokens,  # ALWAYS set — SPEC.md §5.3
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        attempt = 0
        while True:
            start = time.monotonic()
            resp = requests.post(
                FEATHERLESS_CHAT_URL, json=payload, headers=headers, timeout=REQUEST_TIMEOUT_S
            )
            latency_ms = (time.monotonic() - start) * 1000
            if resp.status_code == 503 and attempt < MAX_RETRIES_503:
                attempt += 1
                time.sleep(min(2**attempt, 8))
                continue
            if resp.status_code == 400:
                raise ModelColdError(model_id)
            if resp.status_code == 403:
                raise PlanExclusionError(model_id)
            if resp.status_code == 429:
                raise ConcurrencyExhausted(f"{model_id}: units exhausted (429)")
            resp.raise_for_status()
            body = resp.json()
            usage = body.get("usage", {})
            return ChatResult(
                text=body["choices"][0]["message"]["content"],
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0),
                latency_ms=latency_ms,
                status_code=resp.status_code,
            )
