# HAT v2 Report Website — Data Contract

## Overview

The HAT v2 report website is a static site that reads grading data from JSON files and renders three views:
- **Dashboard**: scorecard matrix, GA readiness score, breakdowns, trend
- **Run Details**: full transcript, commands, reasoning, errors, improvement suggestions
- **Failure Taxonomy**: failures by pillar, category frequency, root causes, proposed fixes

## Directory Structure

```
explorer/v2/
├── index.html          # Main HTML
├── app.js              # Application logic (vanilla JS)
├── styles.css          # Styles (vanilla CSS, dark theme)
└── data/
    ├── runs.json       # Run index (array of run entries)
    └── runs/
        └── YYYY-MM-DD-{id}.json   # Per-run grading data
```

## Run Index (`data/runs.json`)

```json
[
  {
    "date": "2026-05-11",
    "label": "2026-05-11 (description)",
    "file": "runs/2026-05-11-mock.json",
    "scorecard": { "total": 16, "pass": 4, "partial": 4, "fail": 8 }
  }
]
```

Array sorted newest-first. The `file` path is relative to `data/`.

## Per-Run Data (`data/runs/YYYY-MM-DD-*.json`)

Top-level structure (output of `grader.py summarize`):

```json
{
  "version": "2.0",
  "date": "YYYY-MM-DD",
  "generatedAt": "ISO-8601",
  "graderModel": "gpt-5.4",
  "scorecard": {
    "total": 16,
    "pass": 4,
    "partial": 4,
    "fail": 8,
    "passRate": 0.25,
    "passPartialRate": 0.5
  },
  "failureCategoryDistribution": { "category_name": count, ... },
  "readinessPillarBreakdown": {
    "Quality": { "pass": N, "partial": N, "fail": N },
    "Tools": { ... },
    "Docs": { ... },
    "Samples": { ... },
    "Seams": { ... }
  },
  "scenarioBreakdown": {
    "S1": { "pass": N, "partial": N, "fail": N },
    "S2": { ... },
    "S3": { ... },
    "S4": { ... }
  },
  "strategyBreakdown": {
    "A": { "pass": N, "partial": N, "fail": N },
    "B": { ... },
    "C": { ... },
    "D": { ... }
  },
  "agentBreakdown": {
    "claude": { "pass": N, "partial": N, "fail": N },
    "copilot": { ... }
  },
  "skillsDeltaSummary": { "applicable": false },
  "topRootCauses": [
    { "cause": "description", "count": N }
  ],
  "cliInteractiveIssues": {
    "total": N,
    "issues": [
      { "cli": "azd", "prompt": "...", "missingFlag": "...", "affectedRuns": ["S1-A-copilot"] }
    ]
  },
  "grades": [ ... individual grade objects ... ]
}
```

## Individual Grade Object

Each entry in the `grades` array:

```json
{
  "runId": "S1-A-claude",
  "success": "pass" | "partial" | "fail",
  "failureCategory": "category string" | null,
  "failureCategoryDetail": "explanation" | null,
  "readinessPillar": "Quality" | "Tools" | "Docs" | "Samples" | "Seams",
  "rootCause": "specific technical gap description",
  "improvementSuggestions": {
    "docContent": "string" | null,
    "errorMessage": "string" | null,
    "sampleCode": "string" | null
  },
  "cliInteractiveIssues": [
    { "cli": "azd", "prompt": "...", "missingFlag": "..." }
  ],
  "draftFix": "markdown diff string" | null,
  "agentPath": {
    "usedTemplate": true | false,
    "iterationCount": 1-5,
    "stuckPoints": ["description"],
    "timeoutReached": true | false
  },
  "confidenceScore": 0.0-1.0,
  "transcript": {
    "excerpt": "first 500 chars...",
    "commands": [
      { "cmd": "azd ...", "exitCode": 0, "output": "..." }
    ],
    "reasoning": ["agent reasoning text..."],
    "errors": ["error message..."],
    "durationSeconds": 300-1200
  },
  "_meta": {
    "scenario": 1-4,
    "scenarioName": "Greenfield MAF Agent",
    "strategy": "A" | "B" | "C" | "D",
    "strategyName": "Open-Ended",
    "agent": "claude" | "copilot",
    "gradedAt": "ISO-8601",
    "model": "gpt-5.4",
    "temperature": 0.1
  }
}
```

## Failure Categories (from grader.py)

- ACR permissions issue
- Manifest format confusion
- azure.yaml structure wrong
- Model deployment issue
- Docker build failure
- Interactive CLI stuck
- Docs gap
- Concept gap
- Seam failure
- Toolbox/connection configuration
- Azure Skills gap
- Azure Skills incorrect
- Timeout
- Other

## GA Readiness Pillars

- **Quality**: Agent successfully completed the scenario
- **Tools**: CLI/SDK tooling worked correctly
- **Docs**: Documentation was sufficient for discovery
- **Samples**: Sample code/templates were available
- **Seams**: Cross-feature integration worked (manifests, configs, deployment)

## Publishing Flow

1. Nightly runner produces transcripts → `runner/runs/{date}/`
2. `grader.py grade-batch` grades all transcripts → `daily_grades.json`
3. `grader.py summarize` aggregates → `daily_summary.json`
4. Publisher converts summary to v2 format → `explorer/v2/data/runs/{date}.json`
5. Publisher updates `explorer/v2/data/runs.json` index
6. Git push to `larrylhollan/hat-run-explorer` repo
7. Azure App Service picks up the push and serves the site

## Deployment

- **App Service**: `hatrunexplorerjeff0414`
- **Resource Group**: `hat-run-explorer-rg`
- **Region**: North Central US
- **Deploy method**: Local git push from pc.int
- **URL**: https://hatrunexplorerjeff0414.azurewebsites.net

### Deploy steps (from pc.int):
```bash
cd ~/hat-run-explorer
git pull origin main
git push azure main
```

Note: App Service basic publishing credentials must be temporarily enabled for deploy, then restored to disabled. See MEMORY.md for details.
