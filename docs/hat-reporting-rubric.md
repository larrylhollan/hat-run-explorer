# HAT Reporting Rubric

> Defines what belongs in the **executive summary**, what goes in the **appendix/debug detail**, and how to handle the boundary between customer-visible product behavior and harness/operational noise.

## Canonical Customer Flow

Every HAT report should frame results against this exact customer journey. The customer does not know (or care) about SSH tokens, tmux bridges, or harness orchestration.

| Phase | Customer Command | What the customer expects |
|-------|-----------------|--------------------------|
| P01 Create/Scaffold | `azd ai agent init -m <manifest-url>` | Working project directory, azure.yaml, infra files |
| P02 Provision | `azd provision` | Azure resources provisioned and ready |
| P03 Local Run | `azd ai agent run` + `azd ai agent invoke --local` | Sample runs locally, protocol path works |
| P04 Deploy | `azd deploy` | Hosted agent deployed and registered in cloud |
| P05 Remote Invoke | `azd ai agent invoke` | Remote agent responds correctly |
| P06 Monitor | `azd ai agent monitor` | Visibility into deployed agent health |
| P07 Update & Redeploy | `azd deploy` + `azd ai agent invoke` | Code change visible in fresh remote call |
| P08 Cleanup | `azd down --force --purge` | Resources removed cleanly |

---

## Executive Summary Tier (always include)

These items belong in every report's executive summary and scorecard. They represent what a customer would actually experience.

### Include in executive summary

1. **Sample outcome scorecard** — pass / partial / fail for each sample in the matrix
2. **Failure classification buckets** with counts:
   - Broken template/deploy contract
   - Postdeploy RBAC/identity failure
   - Sample/runtime bug
   - `azd` CLI papercuts (only when they block the documented flow)
3. **Ranked engineering priority list** — ordered by customer impact, not alphabetically
4. **Concrete evidence excerpts** — the actual command + output for each failing phase, but only:
   - The canonical customer command (from the table above)
   - The exact error the customer would see
   - One-sentence interpretation
5. **What actually worked** — specific examples of the flow succeeding, with evidence
6. **Workaround severity** — distinguish:
   - "Works after expert intervention" (partial)
   - "Does not work at all" (fail)
   - "Works on the documented path" (pass)

### Framing rules for executive summary

- Lead with the **customer experience**, not the Paperclip issue number
- Use plain sample names (e.g., "Multi-Turn Chat (.NET, /responses)"), not HOL-XXXX as the primary reference
- Issue IDs go in **reference** lines after each evidence block
- Group failures by **theme/root cause**, not by sample
- Express severity as **what a customer would feel**: "deploy looks successful but first use fails" > "HTTP 424 Failed Dependency"
- Keep harness/operational noise out of the main narrative (see below)

---

## Appendix Tier (include only in full report)

These items belong in the appendix or debug-detail section. They are useful for harness improvement and engineering investigation, but they distort the customer-visible story if mixed into the executive summary.

### Include in appendix

1. **Full sample-by-sample breakdown** with all phase details
2. **Harness/operational noise**, clearly labeled:
   - SSH credential failures/restores
   - Port conflicts, PATH issues in the JIT execution environment
   - Phases that ran out of dependency order
   - Resource groups deleted by external processes
   - Auto-retry churn and orchestration wobbles
3. **Workaround details** — the exact manual steps Canary took when the documented flow failed
4. **Direct curl/process fallback evidence** — include this, but flag it:
   > "This validates the platform is healthy behind the official path. It is not evidence that the customer flow works."
5. **Cold-start latency measurements** and performance observations
6. **Issue inventory** — full list of HOL-XXXX references with classification
7. **Timeline of the run** — when each phase started/finished, retry patterns

### Harness noise handling rules

When an issue is clearly harness-caused (not product-caused), it must be:
- **Separated** from the product failure count in the scorecard
- **Labeled** with a clear tag: `[harness]` or the `harness-noise` bucket
- **Mentioned** in the executive summary only if it materially affected result integrity:
  > "4 of 12 samples had some harness-induced noise (expired SSH, premature phase execution, external resource deletion). These do not change the product failure count but are noted for run-integrity context."
- **Detailed** in the appendix with specific evidence

---

## Failure Classification Decision Tree

For each sample failure, apply this in order:

```
1. Did the canonical customer command fail?
   → YES: product issue (executive summary)
   → NO: go to 2

2. Did a non-canonical workaround succeed where the customer command failed?
   → YES: partial (executive summary, note workaround)
   → NO: go to 3

3. Was the failure caused by harness/operational environment?
   → YES: harness noise (appendix only, with note in executive summary)
   → NO: go to 4

4. Was the failure caused by expired credentials, SSH issues, or infrastructure external to the sample?
   → YES: harness noise (appendix only)
   → NO: product issue (executive summary)
```

---

## Explorer / Structured Data Alignment

The explorer JSON schema already uses `buckets` per sample and `bucketLabels` at the run level. Reports and explorer should stay aligned:

| Bucket Key | Executive Summary? | Appendix? |
|-----------|-------------------|-----------|
| `baseline-pass` | ✅ (What Worked) | ✅ |
| `broken-template-contract` | ✅ (lead theme) | ✅ |
| `postdeploy-auth` | ✅ (lead theme) | ✅ |
| `sample-runtime-bug` | ✅ (lead theme) | ✅ |
| `azd-papercuts` | ✅ (if blocks flow) | ✅ |
| `harness-noise` | ⚠️ (summary mention only) | ✅ (full detail) |

---

## Narrative Tone

- Write as if the reader is a product engineering lead who has 10 minutes
- "If I shipped today, the clearest customer pain would be..."
- "The biggest problem was not X. The biggest problem was Y."
- Avoid: jargon-heavy lists, wall-of-issue-IDs, raw JSON dumps
- Prefer: concrete command/output pairs, one-sentence interpretations, ranked priorities
