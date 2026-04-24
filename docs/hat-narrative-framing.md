# HAT Narrative Framing Guide

> Practical guidance for writing HAT reports that separate customer-visible product behavior from harness/operational noise, with stronger narrative framing.

## Core Principle

**The report tells the story of a customer trying to use the documented `azd` flow.**

Every section should read as if a product engineering lead is asking: "If a customer followed our docs today, what would happen?"

The harness, SSH credentials, orchestration retries, and agent infrastructure are invisible to the customer. They belong in the appendix, not the story.

## Report Structure Template

### 1. One-Sentence Verdict
Start with one sentence that a VP can read in a meeting.

> "Today's run: 1 of 12 templates passes the documented `azd` flow end-to-end; the main blockers are broken template deploy contracts and silent postdeploy identity failures."

### 2. Scorecard (visual)
| Sample | P01 | P02 | P03 | P04 | P05 | P06 | P07 | P08 | Outcome |
|--------|-----|-----|-----|-----|-----|-----|-----|-----|---------|

Use ✅ / ⚠️ / ❌ / ⬜ (skipped) per phase. This makes the run instantly scannable.

### 3. Theme Blocks (not sample blocks)
Group by root cause, not by sample. Each theme block contains:
- **What a customer would experience** (1-2 sentences)
- **How many samples were affected** (count)
- **Concrete evidence** (command + output, from the canonical flow)
- **Engineering recommendation** (1 sentence)

Order themes by customer impact severity, not by count.

### 4. What Worked
Always include. This is not filler — it establishes the baseline and shows where the product is healthy.

### 5. Harness Note
One paragraph at the end of the executive summary:
> "N samples had results affected by harness or operational factors (SSH credential expiry, premature phase execution, external resource deletion). These do not change the product failure count. Details are in the appendix."

### 6. Appendix
Full sample-by-sample breakdown with all evidence, including harness detail.

---

## Evidence Formatting

### Good evidence block
```
**Multi-Turn Chat (Python, /responses) — Remote Invoke**

Customer runs:
  azd ai agent invoke multiturn-chat-responses "My name is Alice" --no-prompt

Customer sees:
  HTTP 500: session_creation_failed
  request_id: 5c5275a6d03e05efa55afc03c81f4799

Why: postdeploy RBAC hook failed — agent exists but identity setup never completed.
Ref: HOL-3261
```

### Bad evidence block
```
HOL-3261 failed with HTTP 500 session_creation_failed.
See also HOL-3259, HOL-3262, HOL-3263 for related issues.
The postdeploy hook reported AzureDeveloperCLICredential error.
```

The good version tells the story. The bad version is an issue tracker dump.

---

## Workaround Framing

When a workaround succeeded but the canonical path failed:

> **Echo Streaming (.NET, /invocations)** — the `azd ai agent invoke` path failed with HTTP 424. Direct endpoint call with the correct `https://ai.azure.com` token audience returned HTTP 200 and a valid response. This means the hosted agent platform is healthy, but the documented tool path is broken.

This framing:
1. States what failed (canonical path)
2. States what worked (workaround)
3. Draws the conclusion (platform healthy, tooling broken)
4. Does NOT treat the workaround as a pass

---

## Things to Avoid

| Instead of... | Write... |
|--------------|----------|
| "HOL-3261 failed" | "Multi-Turn Chat (Python, /responses) — remote invoke failed" |
| "The run had 9 failures" | "9 of 12 templates could not complete the documented `azd` flow" |
| "SSH credential expired" | (appendix only — this is harness noise) |
| "Canary manually set ENABLE_HOSTED_AGENTS=true" | "The deploy required a non-documented environment variable to proceed" (if relevant to product) or (appendix, if purely harness recovery) |
| "Exit code 1" | "The command failed with: [actual error message]" |
| Raw JSON output | Extracted key fields in readable format |

---

## Cross-Run Trend Framing (future)

When multiple runs exist, the report should include:

1. **Regression detection** — did any previously-passing sample regress?
2. **Improvement tracking** — did any previously-failing sample improve?
3. **Persistent failures** — which failure themes have appeared in N consecutive runs?
4. **Bucket trend** — are harness-noise incidents increasing or decreasing?

This is not yet required (only one full run exists) but should be planned for.

---

## Applying to the 2026-04-14 Report

The existing `hat-daily-report-2026-04-14-readable.md` already follows many of these principles well:
- ✅ Leads with customer-facing themes, not issue IDs
- ✅ Groups by root cause
- ✅ Includes concrete command/output evidence
- ✅ Separates harness noise as its own theme
- ✅ Ranks engineering priorities

Areas where the next report should improve:
- Add a **visual phase scorecard** (✅/⚠️/❌ grid) at the top
- Move the sample-by-sample appendix into a clearly-labeled appendix section
- Add the one-sentence verdict before the executive summary
- Reduce harness detail in the main body to a single paragraph with an appendix pointer
- Make the canonical customer commands more prominent in evidence blocks (show what the customer runs, not what Canary ran)
