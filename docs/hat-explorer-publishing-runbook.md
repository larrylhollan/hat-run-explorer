# HAT Explorer Publishing Runbook

## Purpose

This document captures how the HAT Run Explorer currently works, where it is deployed, and what must happen when a future daily report should become a new record on the site.

The intended future workflow is:
1. a daily HAT run finishes,
2. Radar writes the narrative report,
3. Radar generates a new explorer dataset for that run,
4. the dataset is added as a new selectable day/run on the website,
5. the Azure App Service is redeployed so the new run is live.

---

## Current live deployment

- **Live site:** `https://hatrunexplorerjeff0414.azurewebsites.net`
- **App Service name:** `hatrunexplorerjeff0414`
- **Resource group:** `hat-run-explorer-rg`
- **Region:** `northcentralus`
- **OS/runtime:** Linux, `NODE|20-lts`
- **Plan:** `jeffhollan_asp_4898`

---

## Source control

- **Private repo:** `https://github.com/larrylhollan/hat-run-explorer`
- **Default branch:** `main`

This repo contains only the explorer app and publishing artifacts, not the full Radar workspace state.

---

## Current app structure

## Main files
- `explorer/index.html` — shell of the web app
- `explorer/app.js` — run selector, scorecard UI, detail view, executive summary
- `explorer/styles.css` — app styling
- `scripts/build_hat_explorer.py` — builds explorer datasets from issue/comment exports
- `scripts/deploy_app_service.sh` — deploys the app to Azure App Service
- `package.json` — Node start script for App Service
- `web.config` — static hosting rewrite support

## Data files
- `explorer/data/runs/<run-slug>.json` — one JSON file per published run/day
- `explorer/data/runs.json` — run selector index consumed by the app
- `explorer/data/index.json` — richer run index emitted by the builder
- `explorer/data/hol-3224.json` — legacy compatibility file kept during transition

## Current published run
- `explorer/data/runs/2026-04-14-hol-3224.json`

---

## How the site works today

1. The landing page loads `explorer/data/runs.json`.
2. Each entry in `runs.json` appears as a selectable run/day card.
3. Clicking a run loads the referenced JSON dataset from `explorer/data/runs/`.
4. The app renders:
   - summary cards,
   - scorecard,
   - sample outcomes,
   - executive themes,
   - detail pane with command/output/workaround/coverage-gap evidence.
5. The selected run is reflected in the URL via `?run=<path>`.

This means the site is already structured to support multiple daily runs. The missing piece is making dataset generation less manual for future runs.

---

## Important current limitation

`scripts/build_hat_explorer.py` is still **run-specific** today.

It is currently wired around the `HOL-3224` export set:
- `tmp/hol-3224-issues.json`
- `tmp/hol-3224-comments/`
- run metadata such as `HOL-3224` and `2026-04-14`

So the website supports many runs, but the builder is not yet fully generalized.

### What this means
For the next daily run, future-Radar will need to do one of these:
1. **short-term/manual path:** adapt the exported tmp files / constants for the new run, then rebuild,
2. **better path:** parameterize `build_hat_explorer.py` so it accepts run id/date/input paths as arguments.

---

## Required future workflow when a daily report is complete

## Step 1: collect run artifacts
Export the completed parent run and child issue journals from Paperclip into a new tmp bundle for that run.

Minimum required inputs:
- parent/child issue list JSON
- per-issue comment/journal JSON
- run id
- run date

## Step 2: build a dataset for the run
Generate a new file in:
- `explorer/data/runs/<date>-<runid>.json`

The dataset should include:
- run metadata
- sample list
- per-phase cells
- command snippets
- output/error snippets
- workarounds
- coverage gaps
- executive themes

## Step 3: update the run index
Append a new entry in:
- `explorer/data/runs.json`

Each entry should look like:

```json
{
  "runId": "HOL-XXXX",
  "runDate": "YYYY-MM-DD",
  "label": "HOL-XXXX · YYYY-MM-DD",
  "file": "runs/YYYY-MM-DD-hol-xxxx.json",
  "sampleCount": 12,
  "summary": {
    "pass": 1,
    "partial": 2,
    "fail": 9
  }
}
```

## Step 4: redeploy the site
Run:

```bash
APP_NAME=hatrunexplorerjeff0414 RESOURCE_GROUP=hat-run-explorer-rg LOCATION=northcentralus bash scripts/deploy_app_service.sh
```

That rebuilds the explorer data, packages the repo, and republishes the site.

## Step 5: verify live output
Verify:
- homepage loads
- new run appears on landing page
- new run JSON is reachable
- scorecard renders

---

## Recommended automation target

The future ideal is:

1. Coordinator finishes the run.
2. Radar writes the daily report.
3. A publish step runs automatically, parameterized by run id/date.
4. The builder emits a new `explorer/data/runs/<run>.json`.
5. The builder regenerates `runs.json`.
6. The site redeploys to the existing App Service.

That can be done by teaching the report-completion path to call a generalized explorer publish script.

---

## What future-Radar should remember

- The **site already supports multiple days**.
- The **builder is the part that still needs generalization**.
- The explorer should be treated as a companion artifact to the daily report.
- Every future published run should become a **new record**, not overwrite the prior run.
- The target App Service already exists and should be reused.

---

## Suggested next engineering tasks

1. Parameterize `scripts/build_hat_explorer.py` with arguments like:
   - `--run-id`
   - `--run-date`
   - `--issues-json`
   - `--comments-dir`
   - `--out-slug`
2. Add a wrapper script like `scripts/publish_hat_run.py` that:
   - pulls/export Paperclip data,
   - invokes the builder,
   - updates `runs.json`,
   - deploys App Service.
3. Hook that script into the daily report completion workflow.
4. Add a coverage-audit view so missing required evidence becomes visible at a glance.

---

## Files that contain the most important current knowledge

- `docs/hat-explorer-cell-data-contract.md`
- `docs/hat-explorer-publishing-runbook.md`
- `README.md`
- `scripts/build_hat_explorer.py`
- `scripts/deploy_app_service.sh`

These are the main durable references future-Radar should read before publishing another run.
