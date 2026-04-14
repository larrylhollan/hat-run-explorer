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
