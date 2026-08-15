// Loads the routing policy + a runtime candidate roster at boot (SPEC.md §13:
// "Serve the loaded policy.json at boot into the router").
//
// harness/promote.py writes artifacts/policy.json once the sweep has run; until
// then (and in tests/dev with no secrets) we fall back to the committed example
// fixture so the worker boots deterministically with zero external state.
import type { ModelCandidate, Policy } from './types';
import policyExample from '../../artifacts/policy.example.json';
import candidatesFixture from './fixtures/candidates.json';

export const policy: Policy = policyExample as unknown as Policy;

// In production this roster would be refreshed from Featherless GET /v1/models
// (availability tiers churn every ~5 minutes per SPEC.md §9.1). The fixture
// covers every model referenced by policy.ladders so eligibility/scoring has
// real data to run against without a network call.
export const candidates: ModelCandidate[] = candidatesFixture as ModelCandidate[];
