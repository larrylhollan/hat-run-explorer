# Exploratory HAT Run Spec, 2026-04-20

## Goal
Run a more open-ended HAT pass that measures whether staged docs and staged samples are sufficient for a developer to succeed end to end, not just whether a prewritten script can be executed.

This run should be driven in Paperclip, executed on `pc.int`, and include an explicit shepherd flow for documentation, sample, or product gaps discovered during analysis or execution.

## Core scenario families
1. Microsoft Agent Framework, Python
2. Microsoft Agent Framework, .NET
3. LangGraph agent
4. Copilot SDK journey

## Standard lifecycle per scenario
1. Setup
2. Provision
3. Deploy
4. Execute
5. Monitor
6. Redeploy
7. Re-execute
8. Cleanup

## What is different from classic HAT
Classic HAT is script-forward. This run is evidence-forward.

Default rule: follow public docs.

The current known execution exceptions for the next run are:
- for any `azd`-driven hosted-agent flow, run `azd env set enableHostedAgentVNext=true`
- do not rely on the current GitHub samples wired into `azd ai agent init` defaults, because they are not the right hosted-agent samples yet
- instead, initialize from the private-preview manifest URL for the intended sample by using `azd ai agent init -m <agent.manifest.yaml URL>`

Treat these as explicit known-docs gaps. Outside of those exceptions, execution should follow public docs and staged samples as written.

Each execution issue should stay short and focus on:
- scenario goal
- source docs and samples
- expected outcome
- required evidence
- what to do if the docs are incomplete or contradictory

The run is successful only when we can answer both:
- Did the product journey work?
- Could a preview customer realistically complete it from the staged docs and samples?

## Working assumptions from current docs scan
- Hosted agents docs clearly support Microsoft Agent Framework in Python and C#.
- Hosted agents docs clearly support LangGraph in Python.
- Copilot appears partly as a publish/distribution journey rather than obviously as the same hosted-agent authoring path. This ambiguity should be treated as a first-class test target, not papered over.

## Run structure in Paperclip

### Parent issue
Owns the whole exploratory run, links the staged docs branch and repo context, and defines success criteria.

### Research and synthesis issues
- R00, branch and docs inventory
- R01, scenario extraction and sample mapping
- R02, scenario brief synthesis

These issues should produce a normalized scenario brief for each lane:
- journey name
- framework and language
- repo path or sample source
- required prerequisites
- commands implied by docs
- success criteria
- unresolved questions

### Execution lanes
One lane per scenario family:
- L01, MAF Python
- L02, MAF .NET
- L03, LangGraph
- L04, Copilot SDK journey

Each lane then gets these child issues:
- Setup
- Provision
- Deploy
- Execute
- Monitor
- Redeploy
- Re-execute
- Cleanup

### Shepherd issues
Two cross-cutting shepherd issues:
- Gap Shepherd, assigned to Radar
- Run Shepherd, assigned to Hal

#### Gap Shepherd responsibilities
- watch for issues tagged or classified as `doc gap`, `sample gap`, `product gap`, `env gap`, or `ambiguity`
- create or request focused follow-up issues when a lane gets blocked
- keep root causes grouped so the run does not inflate failures
- produce a concise gap ledger by lane and severity

#### Run Shepherd responsibilities
- ensure execution happens on `pc.int`
- keep lane issues moving
- make sure evidence is captured step by step
- trigger retries or environment fixes only when they preserve signal

## Required evidence on every execution issue
- exact command attempted
- complete stdout and stderr
- exit code
- duration
- any Azure request IDs or operation IDs
- whether the action followed the documented path or a workaround
- if workaround used, why the documented path was insufficient
- whether the lane used the intended manifest-based init path, for example `azd ai agent init -m <agent.manifest.yaml URL>`
- which manifest options were available in the repo at run time, and which one was chosen
- whether the lane deployed to `northcentralus`
- whether the only deviations from public docs were the known `azd env set enableHostedAgentVNext=true` and manifest-based-init requirements, or whether additional undocumented steps were needed

## Gap taxonomy
When a problem appears, classify it into one primary bucket:
- `doc-gap`: required information missing, contradictory, stale, or too ambiguous
- `sample-gap`: linked sample broken, incomplete, wrong branch, or missing artifacts
- `product-gap`: service, CLI, portal, SDK, or runtime behavior does not match expected journey
- `env-gap`: dependency, auth, role, quota, subscription, or machine setup issue
- `ownership-gap`: unclear whether docs, sample, or platform owns the failure

Each gap record should include:
- lane
- lifecycle step
- source doc URL or repo file
- exact failure evidence
- blocker severity
- workaround if any
- recommendation

## pc.int execution model
- All substantive scenario execution runs on `pc.int`.
- Default deployment region for exploratory hosted-agent runs is `northcentralus`.
- Docs repo on `pc.int` is expected at `/mnt/d/Docs/azure-ai-docs-pr`.
- Private-preview sample repo should come from `https://github.com/microsoft/hosted-agents-vnext-private-preview/tree/main/samples`. If it is not already cloned on `pc.int`, clone it using the `jeffhollan` GitHub account context.
- Before selecting a sample for a lane, enumerate all available manifest-backed templates from the repo clone so the run is choosing from the actual current menu, not stale defaults.
- When repo or branch operations depend on GitHub auth context, prefer `gh auth switch jeffhollan` over `jeffhollan_microsoft` unless the lane proves otherwise.
- For any `azd`-driven hosted-agent flow, set the feature flag before proceeding: `azd env set enableHostedAgentVNext=true`.
- Ensure the environment and provisioning path target `northcentralus` unless a lane explicitly says otherwise.
- For the next run, prefer `azd ai agent init -m <agent.manifest.yaml URL>` against the intended private-preview sample manifest rather than generic interactive `azd ai agent init` selection flows.
- Manifest URL example: `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/01-basic/agent.manifest.yaml`
- Start by enumerating manifest files from the repo clone, for example:
  ```bash
  find <repo>/samples -type f -name 'agent.manifest.yaml' | sort
  ```
- Then convert the chosen local manifest path into a GitHub blob URL under `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/.../agent.manifest.yaml` and use that URL with `azd ai agent init -m ...`.
- Use JIT-backed access patterns already established for HAT.
- Preserve interactive `azd` and related prompt handling only where still required after manifest-based init.
- Keep artifacts and logs in a dedicated exploratory run directory so Radar can analyze them later.

## Reporting outputs
The final assessment should answer:
- which lanes completed end to end
- which lanes only worked with undocumented workarounds
- which failures were root-cause product failures versus docs or sample failures
- whether a customer could complete the journey from staged docs and staged samples
- the highest-value gaps to fix before wider exposure

## Immediate implementation plan
1. Create Paperclip parent issue for the exploratory run.
2. Create child issues for research, lane execution, and shepherding.
3. Hand the run shepherd issue to Hal so execution design can be wired to `pc.int`.
4. Keep Radar on the gap shepherd and final assessment path.
5. Once the branch-specific docs inventory is done, tighten lane issue bodies with exact repo paths and branch URLs.
