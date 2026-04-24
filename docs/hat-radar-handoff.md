# HAT Post-Run Handoff: Radar's Ownership Point

> Defines when Radar takes ownership after a HAT run completes, what Radar is responsible for, and the boundary between Canary (execution) and Radar (analysis/reporting).

## Ownership Timeline

```
Canary runs HAT phases (P01–P08)
        │
        ▼
All phases complete or timed out
        │
        ▼
Canary emits structured artifacts (per-phase JSON with command, output, exit code, issue IDs)
        │
        ▼
════════════════════════════════════
  HANDOFF POINT: Radar takes over
════════════════════════════════════
        │
        ▼
Radar: pull artifacts, classify, write report, publish explorer
        │
        ▼
Report delivered
```

## Canary's Responsibility (before handoff)

Canary owns the run and produces:
1. **Per-phase structured artifacts** with:
   - Canonical command attempted
   - Full output (stdout/stderr)
   - Exit code
   - Workaround commands (if any), flagged as non-canonical
   - Issue IDs (HOL-XXXX)
   - Timestamps
2. **Phase outcomes** (pass/fail/partial/skipped/cascade)
3. **Dependency cascade markers** — which phases were skipped due to upstream failure
4. **Raw evidence preservation** — terminal output and logs available for Radar to inspect

Canary does NOT write the executive summary, classify failure themes, or make editorial judgments about severity. That is Radar's job.

## Radar's Responsibility (after handoff)

After Canary's structured artifacts are available, Radar owns:

### 1. Classification Pass
- Read all phase artifacts across all samples
- Classify each failure into the rubric buckets:
  - `broken-template-contract`
  - `postdeploy-auth`
  - `sample-runtime-bug`
  - `azd-papercuts`
  - `harness-noise`
  - `baseline-pass`
- Separate harness noise from product signal using the decision tree in the reporting rubric

### 2. Narrative Report
- Write the executive summary per the reporting rubric
- Frame against the canonical customer flow
- Include concrete command/output evidence for each theme
- Rank engineering priorities by customer impact
- Write the appendix with full sample-by-sample detail
- Produce both `.md` (primary) and `.txt` (email-friendly) formats

### 3. Explorer Data
- Generate or update the explorer JSON files:
  - `runs.json` — run index
  - `<run-slug>.json` — full run data with samples, steps, buckets, themes
  - `index.json` — cross-run index with summary stats
- Ensure explorer data matches the narrative report (same outcomes, same bucket counts)

### 4. Quality Gate
Before publishing, Radar verifies:
- [ ] Every sample has an outcome (no "unknown" or missing)
- [ ] Every failure has at least one concrete command + output pair
- [ ] Harness noise is separated from product signal in the scorecard
- [ ] The executive summary can be read in under 5 minutes
- [ ] The canonical customer commands are visible in the evidence
- [ ] Workaround paths are labeled as workarounds, not as primary flow evidence

### 5. Delivery
- Report files written to `reports/` in the Radar workspace (e.g. `reports/hat-report-2026-04-18.md`)
- Reports are generated during run analysis — they do NOT exist before a run is analyzed. Do not probe for today’s report file at session startup.
- `reports/` is a directory — use `ls` to list contents, not `read`.
- Explorer data written to `explorer/data/`
- If Jeff requested email delivery: the `.txt` format is used
- Radar posts a completion comment on the parent run issue with a link to the report

## What Radar Does NOT Own

- **Harness execution** — Canary runs the phases
- **SSH/credential management** — infrastructure concern
- **Issue creation for product bugs** — Radar may recommend, but product bug issues should be created by the run owner or engineering lead
- **Harness improvements** — Hal owns harness code changes; Radar can file issues
- **Explorer web deployment** — separate publish pipeline (future automation)

## Escalation

If Radar finds that:
- More than 50% of failures are harness-noise → flag to Jeff that run integrity is too low for useful product signal
- A new failure pattern appears that doesn't fit existing buckets → propose a new bucket key and add it to the rubric
- Structured artifacts are missing or incomplete → post a comment on the run issue requesting re-run or artifact repair from Canary/Hal

## Timing

Radar should complete the analysis pass within **2 hours** of run completion for normal-sized runs (≤20 samples). Larger runs may take longer.

The executive summary should be ready before the next business morning if the run finished overnight.
