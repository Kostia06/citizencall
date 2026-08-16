## Inspiration

Every AI assistant we tried had the same tell: it burned a frontier model on questions a half-billion-parameter model could answer, and when the small model *would* have failed, nothing checked. We wanted the opposite — an assistant built like infrastructure: route cheap, verify everything, escalate only on proof of failure, and show the receipt. Featherless giving every participant 30,000+ open models made the question concrete: how far can you get on models that cost fractions of a cent per call?

## What it does

CitizenCall is one command bar for 1,200+ apps ([citizencall.dev](https://citizencall.dev)). Ask it anything — typed or by voice — and a planner splits the request into typed sub-tasks, each routed to the cheapest open-source model with a measured quality bar. A verifier checks every hop (valid schema, no raw JSON at the user, no degenerate repetition, tool actually succeeded); failures escalate exactly one rung up a ladder that ends at GLM-5.2 or your own API key. Beyond chat: connect GitHub/Gmail/Discord and 1,198 more via OAuth, plug in your own MCP servers, say "check my slack every work day at 6 am" and it becomes a real cron job with a notifications feed, attach files, teach it memories, and call the whole pipeline programmatically with `POST /v1/ask` and a `cc_live_…` key. Every answer carries its measured cost against a frontier-only baseline — including the runs where escalation makes savings negative. Real numbers or nothing.

## How we built it

Cloudflare Workers (Hono) with one Durable Object per run streaming the trace over SSE; D1 for state and four cache layers (plans, run results, tool calls, MCP tool lists/selections — cron-warmed every 15 minutes). All inference goes through Featherless: Qwen 2.5 0.5B/1.5B as cheap rungs, GLM-5.2 as the frontier rung and planner. A Python harness sweeps candidate models offline (snapshot → successive halving → grade → Wilson confidence intervals) and promotes winners into the live routing policy the worker boots with. Tools run through Composio's catalog plus a custom MCP client (Streamable HTTP) where a cheap model reads each server's real tool schemas to pick the tool and fill its arguments. The UI is Vite + React with a draggable command bar, live trace, and an honest benchmark page — installable as a PWA.

## Challenges we ran into

The hard part wasn't calling models — it was trusting them. Sub-2B models ignored tool evidence and answered from their heads, dumped raw JSON at users, hallucinated wrong answers confidently, and once sat 15.9 seconds producing a single empty token. Each failure became a verifier contract: evidence-grounded answers must lead with the verdict, user-facing output can never be JSON, stalled cheap rungs get cut at 15 seconds and escalate. MCP tool selection broke on synonyms ("originality" never keyword-matched `check_novelty`), which forced the schema-aware model-assisted selection. And our own demo fallback bit us: a scripted mock run fabricated a Slack summary for an account with no apps connected — we ripped it out the moment we saw it, because an assistant that invents results is worse than one that errors.

## Accomplishments that we're proud of

Warm requests answer in under a second and typical runs cost $0.0001–0.002 — the live benchmark shows ~95% savings against frontier-only, with every hop, model, and verdict receipted. The escalation ladder is proven live: rung-0 failures get caught by the verifier and recovered by the next rung, on camera. The meta moment: we added our own hackathon-strategy MCP server (winstreak, 78K past projects) to CitizenCall and had it judge its own novelty through the same pipeline. And it's a complete product, not a demo shell — auth with 2FA, sessions you can revoke, deletable memory and history, a keyed public API with usage tracking, and 63 test files green.

## What we learned

Verification beats model quality: a cheap model plus a strict structural check outperforms trusting a mid-tier model, and the check is nearly free. Honest accounting is a feature — showing negative savings on some runs made every other number credible. Prompts are contracts: every verifier rule we added ("lead with the verdict in bold") only worked because the failure mode was also detectable. And cache layers compound: plan cache, run cache, tool cache, and MCP caches each looked minor alone but together turned a 20-second pipeline into a sub-second one on warm paths.

## What's next for Citizen Call

Day-of-week cron filters ("work day" currently means daily), vision-capable rungs so attached images and PDFs reach the model, per-key rate plans and webhooks on the developer API, an SSE-transport fallback for legacy MCP servers, and continuous policy re-promotion — the offline harness re-sweeping new Featherless models weekly so the ladder gets cheaper as the open-source ecosystem improves.
