# HAT Explorer Cell Data Contract

## Purpose

This document defines the **minimum evidence required for every scorecard cell** in the HAT Run Explorer.

The goal is not just to make the UI prettier. The goal is to make each cell auditable:
- what command the agent was expected to run,
- what actually happened,
- what output or error came back,
- whether the agent fell back to a workaround,
- and whether the harness itself failed to capture required evidence.

This is the contract the test harness should satisfy if we want the explorer to become the canonical run-review surface.

---

## Core Principle

A cell should never look complete just because a phase summary exists.

A cell is only truly complete when it contains:
1. **expected command evidence**,
2. **result evidence** (stdout/stderr, response, health, or explicit no-op/cascade explanation),
3. **error evidence** when a failure happened,
4. **workaround evidence** when the documented flow broke,
5. **coverage-gap evidence** when the harness did not record one of the key commands.

If the harness skipped or failed to capture a key command, the explorer should call that out explicitly, not silently imply success.

---

## The Basic Cell Model

Each scorecard cell in the explorer should resolve to a structured object like this:

```json
{
  "phase": "Local Run",
  "status": "pass | partial | fail | blocked | cascade",
  "summary": "One-line human summary",
  "expectedCommands": [
    {
      "kind": "azd_run",
      "required": true,
      "captured": false,
      "command": null,
      "exitCode": null,
      "durationMs": null,
      "stdout": null,
      "stderr": null,
      "notes": "Expected azd run attempt was described but literal command/output was not captured"
    },
    {
      "kind": "runtime_fallback",
      "required": false,
      "captured": true,
      "command": "dotnet run --no-build -c Release",
      "exitCode": 0,
      "durationMs": 4000,
      "stdout": "Listening on http://[::]:8088",
      "stderr": "",
      "notes": "Used because azd ai agent run path was broken"
    }
  ],
  "outputs": [
    {
      "type": "http_response",
      "text": "HTTP/1.1 200 OK ..."
    }
  ],
  "errors": [
    {
      "type": "cli_error",
      "text": "ERROR: ..."
    }
  ],
  "workarounds": [
    "Ran dotnet directly instead of azd ai agent run"
  ],
  "coverageGaps": [
    "azd ai agent run failed but the literal command/output was not captured"
  ]
}
```

The current explorer approximates this from semi-structured journals. The harness should eventually emit this shape directly.

---

## Required Evidence by Phase

## 1. Create / Scaffold

### What the phase is proving
- The sample can be scaffolded or initialized from its manifest/template.
- The source files land where expected.
- The azd project shape is valid enough to proceed.

### Required command evidence
At minimum one of:
- `azd ai agent init ...`
- `azd init ...`

If both are run, capture both.

### Required outputs
At minimum one of:
- manifest validation output,
- downloaded/generated file list,
- destination path,
- interactive prompt appearance if it blocked completion,
- explicit error output.

### Required metadata
- source manifest URL
- target directory
- file count or file list
- whether interactive project selection appeared
- exit code
- duration

### Failure/coverage flags
Flag the cell if:
- `azd ai agent init` / `azd init` was expected but not captured,
- scaffold was summarized as successful but no concrete init output exists,
- files appeared on disk but the actual init command/output was not recorded,
- SSH or JIT issues blocked scaffold before command execution.

### Harness recommendation
Emit a dedicated scaffold step record:
```json
{
  "phase": "Create/Scaffold",
  "commandKind": "azd_init",
  "command": "azd ai agent init -m <manifest>",
  "stdout": "...",
  "stderr": "...",
  "exitCode": 0,
  "durationMs": 60000
}
```

---

## 2. Provision

### What the phase is proving
- Azure resources can be provisioned for the sample.
- The project/account/model/registry/resource group shape is correct.

### Required command evidence
- `azd provision ...`

### Required outputs
At minimum one of:
- resource creation progress,
- final success output,
- Bicep/infra compile error,
- resource validation output,
- explicit provisioning exception.

### Required metadata
- environment name
- subscription ID
- location
- resource group
- AI account / project if created
- duration
- exit code

### Failure/coverage flags
Flag the cell if:
- the phase summary claims provision failed or passed but no literal `azd provision` evidence exists,
- a template/infra error is described without the original stderr,
- provision cascades later phases but the root-cause command/output is missing here.

### Harness recommendation
Always capture the exact `azd provision` invocation plus terminal tail.
If output is long, also store a structured `resourceSummary` object.

---

## 3. Local Run

### What the phase is proving
- The sample can run locally through the documented path.
- If the documented path breaks, the workaround path is explicitly captured.

### Required command evidence
Expected primary command:
- `azd ai agent run ...`

Optional but often essential fallback/runtime commands:
- `dotnet run ...`
- `python3 main.py`
- `.venv/bin/python main.py`
- `uv run ...`
- `curl ...` to local endpoint
- local invoke commands such as `azd ai agent invoke --local ...`

### Required outputs
At minimum:
- startup output (`Listening on`, bound port, PID, server banner),
- local invoke output or curl response,
- timeout/error if `azd ai agent run` or `azd ai agent invoke --local` failed,
- explicit workaround explanation when fallback was used.

### Required metadata
- runtime path used (`azd`, `dotnet`, `python`, etc.)
- local port
- local endpoint path (`/responses`, `/invocations`)
- duration
- exit code(s)
- whether the fallback path was needed

### Critical requirement
For Local Run, the explorer should ideally show **both**:
1. the documented path (`azd ai agent run`), and
2. the fallback/runtime path if used.

If the agent says "azd run failed, so I ran dotnet/python directly", that is not enough. The harness should preserve the actual failed azd command and output.

### Failure/coverage flags
Flag the cell if:
- `azd ai agent run` was expected but not captured,
- the journal says `azd ai agent run` failed but the literal command/output is absent,
- a runtime fallback is mentioned but the runtime command is not captured,
- only local curl logs are present with no record of how the server was started,
- the fallback path passed but the official path was never attempted.

### Current real examples from HOL-3224
- **Echo Non-Streaming (.NET, /invocations)**: journal says `azd ai agent run` failed because shared `azure.yaml` pointed to `python main.py`, but the literal failed azd-run command/output is not preserved. This is a **harness evidence gap**.
- **Echo Streaming (.NET, /responses)**: runtime `dotnet run` output exists, but the expected azd-run evidence is missing.
- **Echo Streaming (Python, /responses)**: local response/curl evidence exists, but both azd-run evidence and clear runtime-start evidence are thin.

### Harness recommendation
Split Local Run into substeps in the raw journal:
- `local_run.azd_run_attempt`
- `local_run.runtime_fallback_start`
- `local_run.local_invoke_attempt`
- `local_run.local_invoke_fallback`
- `local_run.stop_server`

That prevents the explorer from having to infer too much from prose.

---

## 4. Deploy

### What the phase is proving
- The sample can be packaged and deployed into the hosted-agent environment.

### Required command evidence
- `azd deploy ...`

### Required outputs
At minimum one of:
- packaging/publishing/deploy progress,
- created agent version,
- image tag,
- endpoint URL,
- postdeploy hook output,
- explicit error output.

### Required metadata
- service name
- agent name/version
- endpoint URL
- container image if applicable
- duration
- exit code
- whether postdeploy failed while deploy itself succeeded

### Failure/coverage flags
Flag the cell if:
- deploy is described but no literal `azd deploy` evidence exists,
- deploy succeeded but postdeploy hook failed and that distinction is not visible,
- the actual deployed target/project differs from the intended target and the logs do not make that obvious.

### Harness recommendation
Emit structured deploy result fields, especially:
- `deployStatus`
- `postdeployStatus`
- `agentVersion`
- `endpoint`
- `image`
- `rbacSetupStatus`

---

## 5. Remote Invoke

### What the phase is proving
- The deployed sample is usable remotely through the documented path.
- If the documented path breaks, direct endpoint evidence is captured separately.

### Required command evidence
Expected primary:
- `azd ai agent invoke ...`

Optional secondary:
- `curl ...` or other direct endpoint call

### Required outputs
At minimum one of:
- assistant/agent response,
- HTTP status,
- trace/request IDs,
- latency/cold-start timing,
- auth/RBAC/session errors,
- fallback direct invoke evidence.

### Required metadata
- endpoint URL
- agent/session IDs
- trace ID / request ID
- duration
- exit code
- whether direct invoke was needed because azd invoke failed

### Important distinction
The explorer should distinguish:
- **documented invoke path failed, but underlying endpoint worked**
from
- **underlying endpoint itself failed**

Those are materially different product signals.

### Failure/coverage flags
Flag the cell if:
- `azd ai agent invoke` was expected but absent,
- only a prose summary exists without the original remote invoke stderr,
- direct endpoint invoke worked but the azd failure is not visible,
- no invoke was attempted because provision/deploy failed upstream and the cell does not clearly say that it is cascade-only.

### Current real examples from HOL-3224
- Some remote invoke cells contain only `azd ai agent invoke` evidence and no `curl`, which is acceptable **unless** the phase relied on a direct-call workaround and the actual direct command/output was omitted.
- **LangGraph Calculator (Python, /responses)** remote invoke is a cascade from failed provision. Missing invoke evidence there should be treated as expected cascade, not the same class of harness omission.

---

## 6. Monitor

### What the phase is proving
- The deployed agent is visible and inspectable.
- Health/readiness/log signals match the observed run behavior.

### Required command evidence
At minimum one of:
- `azd ai agent show ...`
- `azd ai agent monitor ...`
- explicit log file / log tail evidence

### Required outputs
At minimum one of:
- agent metadata,
- endpoint/version/protocol info,
- readiness/health output,
- session/container logs,
- explicit statement that monitoring could not run because deploy/provision never succeeded.

### Required metadata
- agent name/version
- endpoint
- protocol
- health/readiness result
- monitor session ID if any
- duration
- exit code

### Failure/coverage flags
Flag the cell if:
- monitor is summarized but no show/monitor/log evidence exists,
- logs were referenced but not surfaced,
- monitoring was skipped due to cascade and that reason is not explicit.

### Harness recommendation
Always preserve at least one health-oriented output block, not just a prose summary.

---

## 7. Update & Redeploy

### What the phase is proving
- A visible source change can be redeployed.
- The new version can be observed on a fresh remote path.

### Required command evidence
Required:
- the source-change description,
- `azd deploy ...`

Usually also expected:
- `azd ai agent invoke ...`
- optional direct `curl` if used to validate the updated behavior

### Required outputs
At minimum:
- what source change was applied,
- redeploy output,
- new version/image/endpoint,
- follow-up invoke output or error,
- statement if the phase was a no-op because upstream infra never existed.

### Required metadata
- changed file
- before/after behavior intent
- new version
- invoke/session IDs
- duration
- exit code(s)

### Failure/coverage flags
Flag the cell if:
- redeploy was expected but literal `azd deploy` output is missing,
- invoke validation was claimed but no evidence is shown,
- the phase is cascade-only and the no-op nature is not explicit,
- a code change is mentioned without the target file or behavioral intent.

---

## 8. Cleanup

Jeff explicitly said cleanup is lower priority in the explorer.
That said, the harness should still record it for completeness.

Recommended minimal evidence:
- `azd down --force --purge`
- success or failure summary
- duration

Cleanup can stay visually de-emphasized in the UI.

---

## UI Requirements Driven by This Contract

The UI should separate these concepts visibly:
1. **Expected command(s)**
2. **Captured output**
3. **Error / exception**
4. **Workaround**
5. **Coverage gap / harness gap**

A scorecard cell should be able to show one of these states:
- clean pass
- pass with workaround
- fail with evidence
- cascade fail
- evidence incomplete / harness gap

Right now the explorer approximates this via `attentionReasons` and `coverageGaps`. Longer term it should have first-class badges.

---

## Recommended Harness Journal Schema

Instead of freeform markdown-only journals, the harness should emit a machine-readable envelope per substep.

Suggested schema:

```json
{
  "template": "Echo Non-Streaming (.NET, /invocations)",
  "phase": "Local Run",
  "substep": "azd_run_attempt",
  "commandKind": "azd_run",
  "command": "azd ai agent run --port 8088",
  "cwd": "/home/jeffhollan/hal-workspace/...",
  "env": {
    "AZURE_ENV_NAME": "echo-nonstreaming-dotnet-invocations"
  },
  "startTime": "2026-04-14T13:00:00Z",
  "endTime": "2026-04-14T13:00:21Z",
  "durationMs": 21000,
  "exitCode": 1,
  "stdout": "...",
  "stderr": "...",
  "status": "fail",
  "classification": "cli_bug",
  "requestIds": [],
  "traceIds": [],
  "notes": "shared azure.yaml startupCommand points to python main.py"
}
```

Then the markdown narrative can be generated from the structured record, rather than the other way around.

---

## Commands That Should Be Explicitly Captured When They Exist

The explorer currently looks for these patterns because they are operationally important:

- `azd ai agent init`
- `azd init`
- `azd provision`
- `azd ai agent run`
- `dotnet run`
- `python3 main.py`
- `.venv/bin/python main.py`
- `azd deploy`
- `azd ai agent invoke`
- `azd ai agent show`
- `azd ai agent monitor`
- `curl`
- `azd down`

This list should become a stable harness constant, not just an explorer regex list.

---

## Coverage Gaps Observed in HOL-3224

These are the current known evidence gaps surfaced during explorer work.

### Local Run
- **Echo Non-Streaming (.NET, /invocations)**
  - azd-run failure described but literal command/output missing
- **Echo Non-Streaming (.NET, /responses)**
  - azd-run evidence missing
- **Echo Streaming (.NET, /responses)**
  - azd-run evidence missing
- **Echo Streaming (Python, /responses)**
  - azd-run evidence missing
  - runtime fallback command evidence weak or missing
- **Multi-Turn Chat (Python, /responses)**
  - runtime fallback command evidence incomplete

### Remote Invoke
- **LangGraph Calculator (Python, /responses)**
  - invoke evidence absent, but this is expected cascade from failed provision rather than a harness omission of a run attempt

These gaps matter because they blur the line between:
- product bug,
- workaround,
- harness omission,
- and true non-attempt.

---

## Recommended Explorer Enhancements

## Short term
1. Add a **coverage audit view** that shows, per phase, whether expected command evidence is present.
2. Add badges like:
   - `Captured`
   - `Workaround`
   - `Cascade`
   - `Harness gap`
3. In the detail pane, render separate sections:
   - Expected command(s)
   - Output
   - Errors
   - Workarounds
   - Missing evidence

## Medium term
1. Stop relying on regex-only extraction from prose.
2. Have the harness emit structured JSON artifacts alongside markdown summaries.
3. Make the explorer consume those JSON artifacts directly.

## Long term
1. Make coverage gaps actionable in the harness itself.
2. If Local Run completes without any recorded `azd ai agent run` attempt for a sample that should have one, fail or warn the phase automatically.
3. If a fallback command is used without preserved output, mark the phase as incomplete evidence.

---

## What “Done” Looks Like

The system should eventually make it impossible for us to ask questions like:
- “Did the agent actually run `azd ai agent run`, or did it just say it did?”
- “Was the fallback path real, or was it only summarized?”
- “Is this a UI extraction miss or a harness capture miss?”

A fully mature run-review surface should let Jeff click any cell and immediately see:
- the exact command,
- the exact output/error,
- the workaround if used,
- whether the official path broke,
- and whether the evidence itself is incomplete.

That is the bar this document is trying to set.
