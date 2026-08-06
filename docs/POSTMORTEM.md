# Postmortem — research runs stalled at the AI step

**Status:** resolved
**Impact window:** 2 – 7 August 2026
**Severity:** the core feature was unusable. Crawling and search worked; every run died before producing a report, so no dossier and no PDF.
**Resolution:** two independent bugs, found by instrumenting the request path rather than by inference.

---

## Summary

Company research completed its crawl and search stages, then hung at the AI analysis step and
eventually timed out. OpenRouter's dashboard reported every request as a success in around five
seconds, which made the failure look like a slow third-party API. It was not. The application was
receiving keep-alive heartbeats and mistaking them for progress, and the prompt had quietly grown to
nearly twice the size that had been measured as fast.

Eight speculative fixes were shipped before the problem was measured. The measurement took ten
minutes and found the cause in one pass.

---

## Timeline

| When | What happened |
| --- | --- |
| 2 Aug | Built and deployed. Reports completed. Analysis stage took 25.0s, 28.2s and 32.0s against a 45s budget — working, but with little headroom. |
| 6 Aug, afternoon | Runs began failing consistently at the AI step. |
| 6 Aug | First real bug found: the abort timer was cleared as soon as `fetch()` resolved, which only covers response headers. `await res.json()` then ran unguarded, so a stalled body hung until Vercel killed the function at 60s with no error reaching the browser. Fixed — the silent hang became a readable error. |
| 6 Aug | A series of changes based on inference: capped reasoning effort, trimmed the corpus 46k → 26k characters, requested throughput-sorted providers, split the retry budget, switched to streaming, reordered JSON mode, added a non-streamed fallback, collapsed three attempts into one. Some were genuine improvements. None fixed the failure. |
| 7 Aug | `scripts/diagnose.mjs` written — five probes against OpenRouter with no application code in the path. **Every probe completed in 3.6–16s with a maximum silence of 0.4s.** The API was healthy. The fault was ours. |
| 7 Aug | Instrumented the real request path with timing logs. First run revealed the actual failure signature. |
| 7 Aug | Both root causes fixed. End-to-end run: **21.5 seconds**, PDF generated. |

---

## Root causes

### 1. Keep-alive heartbeats were counted as progress

The streaming reader had a stall detector: if no data arrived for 20 seconds, abort and report a dead
route. Every chunk reset the timer.

OpenRouter emits SSE comment lines — `: OPENROUTER PROCESSING` — while it waits on the upstream
provider. These are 25–50 byte chunks that arrive every few seconds and carry no content. The
detector treated them as the model working.

The instrumented log made it unmistakable:

```
[openrouter] 0.0s  REQUEST  bodyBytes=25823 budget=44000ms
[openrouter] 5.8s  HEADERS  status=200 type=text/event-stream
[openrouter] 5.8s  FIRST BYTE (50 bytes)
[openrouter] 44.0s ABORT/ERROR name=AbortError
```

Aborting at **44.0s — the full budget — rather than at the 20s stall limit** is the tell. Data was
arriving the whole time; none of it was content. The safety net designed to fail fast was the reason
it failed slowest.

**Fix:** `beat()` is now called only when a `data:` frame is actually parsed. Comment lines no longer
count as progress.

### 2. The prompt had grown past its measured-safe size

The diagnostic proved a 14,000-character prompt completes in about 12 seconds. The real request was
**25,823 bytes** — the crawled corpus plus the JSON schema, the rules block, five sets of search
results and the verified-fields block, each added at a different time, none individually large.

**Fix:** corpus budget cut to 9,000 characters, search context reduced to three results from three
queries. Payload dropped to 15,489 bytes.

### 3. Contributing factor — the wrong model was under test

`DEFAULT_MODEL` still pointed at `openai/gpt-oss-20b:free` while the UI header displayed Gemma, because
the browser remembers the last selection in `localStorage`. Several test cycles were spent measuring a
reasoning model — which spends most of its budget thinking before emitting a token — while believing
Gemma was being measured. The debug log printing `model=` on every request ended the confusion
immediately.

---

## Measurements

| | Before | After |
| --- | --- | --- |
| Request payload | 25,823 bytes | 15,489 bytes |
| Time to first byte | 5.8s | 1.9s |
| Content parsed from stream | 0 characters | 3,068 characters |
| Outcome | abort at 44.0s | dossier in 17.1s |
| Full pipeline | timeout | 21.5s |

---

## Why it worked on 2 August and not on 6 August

It was never comfortably working. The successful runs took 25–32 seconds against a 45-second budget.
The same work measured outside the application took 3.6–16 seconds. That gap was always there.

The system was one variable away from failing, and several variables moved: the prompt grew as
features were added, the model snapshot changed to `gemma-4-26b-a4b-it-20260403`, and the default
model was a reasoning model that consumed its budget before writing. A marginal system does not
degrade gracefully — it looks fine until it looks broken, with nothing in between.

---

## What went wrong in the debugging

**Eight fixes were shipped before anything was measured.** Each was plausible and each was reasoned
from symptoms. The symptom — "OpenRouter reports success, we see nothing" — is a *contradiction*, and a
contradiction means the model of the system is wrong. That is the moment to instrument, not to tune.

**The dashboard was trusted as ground truth.** OpenRouter's "Latency 5.6s" measures their call to the
upstream provider. It says nothing about delivery to the client. Two different numbers were being
compared as if they were the same one.

**Retrying a timeout made it worse.** An early design split the budget across three attempts. A
response needing 25 seconds cannot survive three 15-second slots. Retries help with errors, not with
slowness — and the failures here were all timeouts.

---

## What worked

**Reproducing outside the system.** `scripts/diagnose.mjs` sends the same request with plain Node
`fetch` and reports time-to-first-byte, longest inter-chunk silence, chunk count and byte count. It
established in one run that the API was healthy and the fault was local — which invalidated every
theory to that point.

**Instrumenting the real path.** Once the boundary was clear, five log lines in the actual request
function — request size, headers, first byte, stream completion, abort — showed the exact failure
signature. The `44.0s` abort against a `20s` stall limit was the whole answer.

---

## Lessons

1. **When observed behaviour contradicts your model of the system, measure the boundary.** Do not tune
   inside a model you have reason to believe is wrong.
2. **A heartbeat is not progress.** Liveness checks must count the thing you actually care about.
3. **Third-party latency metrics measure their internals, not your delivery.** Verify end to end.
4. **Retries fix errors, not slowness.** Splitting a budget across attempts starves all of them.
5. **Log the inputs that vary.** Printing `model=` and `bodyBytes=` would have caught both the wrong
   model and the payload growth days earlier.
6. **Watch the margin, not just the outcome.** 32 seconds against a 45-second budget was already a
   failure waiting for a trigger.

---

## Follow-ups

- [ ] Assert on prompt size in `analyse.ts` and log a warning above ~18 KB, so growth is visible.
- [ ] Surface the elapsed AI time in the research trail, so the margin is visible during normal use.
- [ ] Keep `RECON_DEBUG=1` documented; it costs nothing when unset.
- [ ] Consider a paid model for the deployed demo — free routes are queued behind paid traffic and
      throughput varies by hour, which is a reliability risk independent of these bugs. 

---

## Quick recap (plain version)

**What happened.** The app built and deployed fine on 2 Aug and produced reports. Four days later
every run died at the AI step — crawl and search worked, then nothing. No dossier, no PDF.

**What made it confusing.** OpenRouter's dashboard said every request succeeded in ~5 seconds. So it
looked like their problem, not ours. It wasn't. Their "latency" measures their call to the model
provider, not delivery to us — two different numbers being read as one.

**What I tried first, and why it failed.** Eight fixes reasoned from symptoms: timeouts, retries,
provider routing, streaming, JSON mode, prompt trimming. Some were real improvements. None fixed it,
because I was tuning a system I had already misunderstood.

**The turn.** I wrote `scripts/diagnose.mjs` — the same API call with plain Node `fetch` and no app
code in the path, printing time-to-first-byte and longest silence. Five probes, all fast: 3.6–16s.
That proved the API was fine and the bug was mine, which killed every theory to that point.

**Finding it.** I added `RECON_DEBUG=1` logging inside the real request function. One run showed it:
first byte at 5.8s, then abort at **44.0s — the full budget, not my 20-second stall limit**. The
detector meant to fail fast never fired, because OpenRouter sends `: OPENROUTER PROCESSING`
heartbeats while waiting, and I was counting those as the model working. Same log showed the prompt
had grown to 25,823 bytes, nearly double the size the diagnostic proved fast.

**The fix.** Heartbeats no longer reset the stall timer — only real content frames do. Prompt cut to
15,489 bytes. Default model corrected to Gemma (it was still gpt-oss, a reasoning model, while the UI
showed Gemma — so I'd been testing the wrong thing for several rounds).

**Proving it.** Re-ran the same debug trace: first byte 1.9s, 3,068 characters parsed, done at 17.1s,
full run 21.5s, PDF generated. Same instrument, same input, different numbers — that's the difference
between "it stopped failing" and "I fixed it."

**The one sentence.** When what you observe contradicts your model of the system, stop tuning and go
measure the boundary — reproduce outside to find *which side* is broken, instrument inside to find
*where*, then re-run the same measurement to prove it.