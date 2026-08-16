# CitizenCall — 3-minute demo script

~400 narration words ≈ 2:45 spoken, leaving breathing room. **Film in Chrome**
(voice demo constraint). Have ready before recording: a logged-in account with
GitHub + Discord connected, the winstreak MCP added, one routine created, an
API key minted, and a terminal with the curl command pasted.

---

## 0:00 – 0:20 — The hook (landing page, then home bar)

> This is CitizenCall. One command bar, twelve hundred apps, and a rule most
> AI products break: never use an expensive model when a cheap one can prove
> it did the job. Everything you're about to see runs on open-source models
> through Featherless — and every answer is verified before you see it.

*Screen: landing "Ask once." → click Try CitizenCall.*

## 0:20 – 0:50 — Live run + the trace (the core loop)

> Watch the trace, not just the answer. I'll ask it to check my GitHub.

*Type: "list my open pull requests". Expand the trace while it runs.*

> A planner breaks the request into steps. Each step routes to the cheapest
> model with a proven pass rate — half-billion-parameter models, fractions of
> a cent. Then a verifier checks the output. If a cheap model lies, waffles,
> or returns garbage, it fails the check and the ladder escalates one rung.
> That escalation you see is the system being honest — and the cost line
> below every answer is measured against a frontier-only baseline. Sometimes
> it even shows negative savings. We kept that. Real numbers or nothing.

## 0:50 – 1:20 — Struggles (stay on the trace, point at it)

> The hard part wasn't calling models — it was trusting them. Small models
> ignored tool evidence, answered questions with raw JSON, or sat sixteen
> seconds producing one empty token. So the verifier grew teeth: answers must
> cite the evidence, user-facing output can never be JSON, stalled rungs get
> fifteen seconds before the ladder moves on. Our other fight was tool
> selection — keyword matching can't tell "novelty" from "naming", so a
> cheap model now reads every tool's real schema and picks with args filled.

## 1:20 – 1:50 — It's an agent, not a chat (memory, routines, notifications)

*Type: "check my slack messages and pr every work day at 6 am".*

> Say a recurring task and it becomes a cron job — six a-m, your timezone,
> no forms. When it runs in the background, the result lands here.

*Click the bell → notifications drawer → click a routine run, it restores as
a session. Then flash Settings → Bar: drag the input pill, bind a Discord
prompt button.*

> Every cron result is a session you can reopen. And the bar itself is
> yours — drag the input, bind one-tap buttons to your connected apps.

## 1:50 – 2:20 — The meta moment (winstreak MCP) + developer API

*Type: "use winstreak to check the novelty of my hackathon project".*

> You can plug in your own MCP servers. This one is mine — it checks
> hackathon ideas against seventy-eight thousand past projects. CitizenCall
> is literally judging itself, live, through the same pipeline.

*Terminal: run the curl.*

```bash
curl -s https://citizencall.dev/v1/ask \
  -H "Authorization: Bearer cc_live_…" \
  -d '{"text":"what can you do"}'
```

> And everything the bar can do, your scripts can do — API keys with usage
> tracking, one endpoint.

## 2:20 – 2:50 — Benchmark + close (benchmark page)

*Screen: Benchmark page — the three bars.*

> Here's the whole argument in one chart: frontier-only cost, cheap-default
> cost, and what CitizenCall actually spent — about ninety-five percent
> cheaper, with every hop, model, and verdict receipted below. The potential
> is simple: agents people actually leave running — daily briefings, inbox
> triage, your own tools — priced like infrastructure, not like magic.
> CitizenCall. Ask once.

---

## Cut list if over 3:00 (in order)
1. The drag-the-bar beat (0:05)
2. The curl close-up — say it over the winstreak run instead (0:10)
3. Shorten struggles to the verifier sentence only (0:15)

## Don'ts
- Don't re-record over a cache hit if a run is slow — one visible escalation
  is WORTH showing; narrate it as the feature it is.
- Don't show Settings → API keys before the key exists (mint it off-camera).
- Don't film voice input in the PWA window — Chrome tab only.
