// Loads the routing policy + a runtime candidate roster at boot (SPEC.md §13:
// "Serve the loaded policy.json at boot into the router").
//
// The real policy is produced by harness/promote.py (artifacts/policy.json). We
// import it directly and fall back to the committed example only if the real file
// is missing its ladders — so the worker always boots deterministically, whether
// or not the offline sweep has been run in this checkout.
import type { ModelCandidate, Policy } from './types';
import policyReal from '../../artifacts/policy.json';
import policyExample from '../../artifacts/policy.example.json';
// The candidate roster is the SAME catalog the harness selects from, so it is
// guaranteed to cover every model the policy's ladders reference. In production
// this would be refreshed from Featherless GET /v1/models (availability tiers
// churn ~every 5 min, SPEC.md §9.1); the committed catalog gives eligibility and
// scoring real metadata to run against with no network call.
import catalog from '../../harness/fixtures/catalog_sample.json';

function hasLadders(p: Policy): boolean {
  return !!p.ladders && Object.values(p.ladders).some((ladder) => ladder.length > 0);
}

const real = policyReal as unknown as Policy;
export const policy: Policy = hasLadders(real) ? real : (policyExample as unknown as Policy);

// catalog_sample.json carries an extra `cardText` field (used by the harness
// retriever) that ModelCandidate doesn't declare; it's harmless at runtime.
export const candidates: ModelCandidate[] = catalog as unknown as ModelCandidate[];
