# Next Run Manifest Selection

For the next exploratory hosted-agents run, do not rely on the current default sample choices behind `azd ai agent init`.

## Rule
1. Use the private-preview repo as the source of truth:
   - `https://github.com/microsoft/hosted-agents-vnext-private-preview/tree/main/samples`
2. On `pc.int`, make sure the repo is cloned under the `jeffhollan` GitHub account context if needed.
3. Enumerate all available templates by listing manifest files:

```bash
find <repo>/samples -type f -name 'agent.manifest.yaml' | sort
```

4. Choose the manifest that matches the intended lane.
5. Initialize from the manifest URL directly:

```bash
azd ai agent init -m <agent.manifest.yaml URL>
```

6. For any AZD-driven hosted-agent flow, also set:

```bash
azd env set enableHostedAgentVNext=true
```

## Example manifest URL
```bash
azd ai agent init -m https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/01-basic/agent.manifest.yaml
```

## Required logging
For each lane, record:
- the full manifest menu discovered in the repo at run time
- the manifest URL chosen
- why that manifest was selected for the lane
- whether any better-looking manifest existed but was intentionally skipped
