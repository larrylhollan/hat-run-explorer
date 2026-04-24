# Private Preview Manifest Menu for Next Exploratory Run

Source of truth on `pc.int`:
- Repo clone: `/mnt/d/Docs/hosted-agents-vnext-private-preview`
- Samples root: `/mnt/d/Docs/hosted-agents-vnext-private-preview/samples`

For the next run, agents should enumerate manifests from the clone before choosing a lane:

```bash
find /mnt/d/Docs/hosted-agents-vnext-private-preview/samples -type f -name 'agent.manifest.yaml' | sort
```

Then use the corresponding GitHub blob URL with:

```bash
azd ai agent init -m <manifest-url>
azd env set enableHostedAgentVNext=true
```

Default region: `northcentralus`

## Canonical manifest URLs for the main exploratory lanes

### MAF Python
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/01-basic/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/02-tools/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/03-mcp/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/04-foundry-toolbox/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/responses/06-workflows/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/agent-framework/invocations/01-basic/agent.manifest.yaml`

### LangGraph-oriented Python options
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/bring-your-own/responses/langgraph-chat/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/bring-your-own/invocations/langgraph-chat/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/agentserver-responses/langgraph-chat/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/agentserver-invocations/langgraph-chat/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/toolbox/langgraph/agent.manifest.yaml`

### Copilot-related Python options
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/hosted-agents/bring-your-own/invocations/github-copilot/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/python/agentserver-invocations/github-copilot/agent.manifest.yaml`

### MAF .NET options
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/HelloWorld/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/foundry-agent/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/invocations-echo-agent/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/local-tools/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/mcp-tools/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/simple-agent/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/text-search-rag/agent.manifest.yaml`
- `https://github.com/microsoft/hosted-agents-vnext-private-preview/blob/main/samples/dotnet/hosted-agents/agent-framework/workflows/agent.manifest.yaml`

## Additional available families discovered in the repo

### Python
- `agentserver-invocations`: ag-ui, crewai-chat, echo-agent-nonstreaming, echo-agent-streaming, github-copilot, human-in-the-loop, langchain-travel-agent, langgraph-chat, longrunning-agent, lro-pipeline, multiturn-chat, notetaking-agent, openclaw, webrtc-agent-streaming
- `agentserver-responses`: background-agent, crewai-chat, echo-agent-streaming, langchain-travel-agent, langgraph-chat, multiturn-chat, notetaking-agent
- `hosted-agents/bring-your-own/invocations`: ag-ui, github-copilot, hello-world, human-in-the-loop, langgraph-chat, notetaking-agent, toolbox
- `hosted-agents/bring-your-own/responses`: background-agent, hello-world, langgraph-chat, notetaking-agent, toolbox
- `toolbox/azd/azd-samples`: a2a, ai-search, bing-custom-search, code-interpreter, file-search, mcp-agent-identity, mcp-entra-passthrough, mcp-keyauth, mcp-noauth, mcp-oauth-custom, mcp-oauth-managed, multi-tool, openapi-keyauth, web-search
- `toolbox`: langgraph, maf

### .NET
- `agentserver-invocations`: echo-agent-nonstreaming, echo-agent-streaming, human-in-the-loop, multiturn-chat, notetaking-agent
- `agentserver-responses`: background-agent, echo-agent-nonstreaming, echo-agent-streaming, multiturn-chat, notetaking-agent
- `hosted-agents/bring-your-own/invocations`: HelloWorld, human-in-the-loop, notetaking-agent
- `hosted-agents/bring-your-own/responses`: HelloWorld, background-agent, notetaking-agent
- `toolbox/maf`: ToolboxMafAgent

## Selection rule for the next run
- Start from this menu, not from stale default `azd ai agent init` sample choices.
- Use manifest-based init.
- Record the full menu available at run time, the chosen manifest URL, and why it was chosen.
- Prefer `northcentralus`.
