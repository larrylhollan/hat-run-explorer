# Hosted Agents Release-Readiness Rerun Spec, 2026-04-20

## Goal
Run a fresh hosted-agents exploratory pass focused on release readiness for this week.

This run should answer:
- what breaks for a customer today
- what breaks because of docs versus samples versus product
- what exact commands and errors were observed
- what specific docs changes should be made before release

## Default execution rules
- Use Paperclip for orchestration.
- Run substantive execution on `pc.int`.
- Default deployment region is `northcentralus`.
- Follow public docs by default.

## Known current-bits deltas allowed for this rerun
1. For any AZD-driven hosted-agent flow, run:
   ```bash
   azd env set enableHostedAgentVNext=true
   ```
2. Do not rely on current default sample choices behind `azd ai agent init`.
3. Use manifest-based init directly:
   ```bash
   azd ai agent init -m <agent.manifest.yaml URL>
   ```
4. Source sample manifests from the private-preview repo on `pc.int`:
   - repo clone: `/mnt/d/Docs/hosted-agents-vnext-private-preview`
   - samples root: `/mnt/d/Docs/hosted-agents-vnext-private-preview/samples`
5. When repo auth context matters on `pc.int`, prefer:
   ```bash
   gh auth switch -u jeffhollan
   ```

Outside of those explicit deltas, execution should follow public docs and staged samples as written.

## Template selection rule
Before picking a sample for a lane, enumerate the actual manifest menu from the repo clone:

```bash
find /mnt/d/Docs/hosted-agents-vnext-private-preview/samples -type f -name 'agent.manifest.yaml' | sort
```

Then select the intended manifest and convert it to the matching GitHub blob URL under:

```text
https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/.../agent.manifest.yaml
```

## Core lanes
1. MAF Python
2. MAF .NET
3. LangGraph
4. Copilot-related / hybrid path

## Standard lifecycle per executable lane
1. setup
2. provision
3. deploy
4. execute
5. monitor
6. redeploy
7. re-execute
8. cleanup

If a lane is not truly an executable hosted-agent lane, convert it into a research verdict quickly and say so.

## Evidence requirements
Every lane must capture:
- exact command attempted
- complete stdout and stderr
- exit code
- wall-clock duration
- Azure request IDs or operation IDs when present
- manifest menu seen at run time
- manifest URL chosen
- region used, confirming `northcentralus`
- whether the path followed public docs or needed a workaround
- if workaround used, why the documented path was insufficient

## Failure and gap classification
Each failure should be classified into one primary bucket:
- `doc-gap`
- `sample-gap`
- `product-gap`
- `env-gap`
- `ownership-gap`

For each gap, capture:
- lane
- lifecycle step
- source doc or manifest URL
- exact failing command
- exact error output
- blocker severity
- workaround if any
- proposed doc improvement
- proposed product or sample fix

## Reporting requirements
Produce a comprehensive report that includes:
1. executive summary
2. lane scorecard
3. root-cause grouping
4. command-plus-error evidence for every important failure
5. explicit doc improvements recommended before release this week
6. clear statement of which lanes are customer-ready, partially ready, or not ready

## Release-readiness framing
The final report must explicitly call out:
- what should be fixed in docs before release this week
- what can ship as known limitations
- what should not be presented as customer-ready

## Cleanup rule
Do not leave stale exploratory subissues hanging open. At run end, collapse the run into:
- completed lane issues
- explicit follow-up gaps that still matter
- final report issue
