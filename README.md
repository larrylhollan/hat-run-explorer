# HAT Run Explorer

Interactive scorecard and evidence explorer for Hosted Agents Test (HAT) daily runs.

## What it does
- shows a run/day selector
- renders a scorecard across templates and phases
- drills into each cell with command, output, error, workaround, and coverage-gap evidence
- surfaces root-cause themes across the run

## Local development

```bash
python3 scripts/build_hat_explorer.py
npm install
npm start
```

Open `http://localhost:3000`.

## Data flow
- `scripts/build_hat_explorer.py` builds explorer datasets from Paperclip-exported issue/comment data
- datasets land in `explorer/data/runs/`
- `explorer/data/runs.json` indexes available run days for the landing page

## Deploy
This repo is set up to run as a simple Node-based static site on Azure App Service using:

```bash
npm start
```

The site serves the contents of `explorer/`.

## Publishing a future run
The app now supports multiple run/day records.

### Current live deployment
- site: `https://hatrunexplorerjeff0414.azurewebsites.net`
- app service: `hatrunexplorerjeff0414`
- resource group: `hat-run-explorer-rg`
- region: `northcentralus`

### Future publish flow
1. generate a new run dataset in `explorer/data/runs/`
2. update `explorer/data/runs.json`
3. redeploy the existing App Service

Current deploy command:

```bash
APP_NAME=hatrunexplorerjeff0414 RESOURCE_GROUP=hat-run-explorer-rg LOCATION=northcentralus bash scripts/deploy_app_service.sh
```

### Important note
The web app is ready for multiple runs, but `scripts/build_hat_explorer.py` is still partially hardcoded to the current HOL-3224 export set. Future work should parameterize the builder so each completed daily report can automatically create a new run record and publish it.

See also:
- `docs/hat-explorer-cell-data-contract.md`
- `docs/hat-explorer-publishing-runbook.md`
