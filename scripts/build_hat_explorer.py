#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import markdown

ROOT = Path('/Users/larry/.openclaw/workspace-radar')
TMP = ROOT / 'tmp'
OUT = ROOT / 'explorer'
DATA_DIR = OUT / 'data'
RUNS_DIR = DATA_DIR / 'runs'
COMMENTS_DIR = TMP / 'hol-3224-comments'
ISSUES_PATH = TMP / 'hol-3224-issues.json'

PHASE_ORDER = {
    'Create/Scaffold': 1,
    'Provision': 2,
    'Local Run': 3,
    'Deploy': 4,
    'Remote Invoke': 5,
    'Monitor': 6,
    'Update & Redeploy': 7,
    'Cleanup': 8,
}

PHASE_GOALS = {
    'Create/Scaffold': 'Create the sample workspace, pull down the sample files, and initialize the azd project shape needed for the rest of the run.',
    'Provision': 'Provision the Azure-side infrastructure and verify that the expected account, project, model, and related resources exist.',
    'Local Run': 'Run the sample locally and prove that the basic protocol path works before deploying it remotely.',
    'Deploy': 'Package the sample, push the image if needed, and register or deploy the hosted agent so the remote endpoint exists.',
    'Remote Invoke': 'Call the remotely deployed sample the way a user or engineer would and verify the result, latency, and first-use behavior.',
    'Monitor': 'Inspect the deployed agent, capture its metadata, and confirm whether the runtime looks healthy from a monitoring perspective.',
    'Update & Redeploy': 'Make a visible code change, redeploy it, and verify that the new behavior appears on a fresh remote execution path.',
    'Cleanup': 'Remove provisioned resources so the next run starts from a clean state and does not leak infrastructure.',
}

SAMPLE_META = {
    'Echo Non-Streaming (.NET, /responses)': {
        'slug': 'echo-non-streaming-dotnet-responses',
        'outcome': 'pass',
        'firstFailure': 'No major failure. This was the cleanest end-to-end sample in the run.',
        'bucket': ['baseline-pass', 'azd-papercuts'],
        'plainSummary': 'Cleanest row in the run. It still had a few small CLI limitations, but it validated the full path end to end.',
    },
    'Echo Streaming (.NET, /invocations)': {
        'slug': 'echo-streaming-dotnet-invocations',
        'outcome': 'partial',
        'firstFailure': 'The official invoke flow was not clean. Canary had to repair the setup and use direct endpoint calls to prove the sample worked.',
        'bucket': ['azd-papercuts', 'postdeploy-auth'],
        'plainSummary': 'The hosted agent worked, but the official tool flow was still rough and required manual correction.',
    },
    'Multi-Turn Chat (.NET, /responses)': {
        'slug': 'multiturn-dotnet-responses',
        'outcome': 'partial',
        'firstFailure': 'The remote path worked, but the CLI hid the assistant text and later update/redeploy was interrupted by resource-group loss.',
        'bucket': ['azd-papercuts', 'harness-noise'],
        'plainSummary': 'Strong sample, but still not a clean engineer experience because the CLI hides useful output and the late run was noisy.',
    },
    'Echo Non-Streaming (Python, /invocations)': {
        'slug': 'echo-non-streaming-python-invocations',
        'outcome': 'fail',
        'firstFailure': 'Remote phases ran before deploy had really happened, and the sample still finished in an auth-broken state.',
        'bucket': ['harness-noise', 'postdeploy-auth'],
        'plainSummary': 'Recovered locally, but remote validation was not clean and later invoke checks still broke on auth.',
    },
    'Echo Streaming (Python, /invocations)': {
        'slug': 'echo-streaming-python-invocations',
        'outcome': 'fail',
        'firstFailure': 'Deploy contract mismatch: provision created one resource shape, deploy expected another.',
        'bucket': ['broken-template-contract'],
        'plainSummary': 'The sample scaffolded and ran locally, but deploy was structurally broken.',
    },
    'Multi-Turn Chat (Python, /invocations)': {
        'slug': 'multiturn-python-invocations',
        'outcome': 'fail',
        'firstFailure': 'The local sample already failed because the request body was empty by the time the handler read it.',
        'bucket': ['sample-runtime-bug', 'postdeploy-auth'],
        'plainSummary': 'Real sample/runtime bug locally, then remote auth trouble on top of that.',
    },
    'Echo Streaming (Python, /responses)': {
        'slug': 'echo-streaming-python-responses',
        'outcome': 'fail',
        'firstFailure': 'Scaffold needed manual recovery, then deploy failed because the infrastructure never created the target deploy resource.',
        'bucket': ['broken-template-contract', 'azd-papercuts', 'harness-noise'],
        'plainSummary': 'Lots of operator effort up front, then the deploy contract still broke later.',
    },
    'Multi-Turn Chat (Python, /responses)': {
        'slug': 'multiturn-python-responses',
        'outcome': 'fail',
        'firstFailure': 'Local model access failed, and the remote path never became usable because postdeploy RBAC did not finish.',
        'bucket': ['postdeploy-auth', 'azd-papercuts'],
        'plainSummary': 'The service shape was there, but both local and remote use were blocked by auth and tooling friction.',
    },
    'LangGraph Calculator (Python, /responses)': {
        'slug': 'langgraph-calculator-python-responses',
        'outcome': 'fail',
        'firstFailure': 'Provision failed immediately because the template is missing infra/main.bicep.',
        'bucket': ['broken-template-contract', 'harness-noise'],
        'plainSummary': 'Structurally broken for the documented provision flow.',
    },
    'Echo Non-Streaming (.NET, /invocations)': {
        'slug': 'echo-non-streaming-dotnet-invocations',
        'outcome': 'fail',
        'firstFailure': 'Local validation only worked through manual fallback, and remote invoke stayed 403 after deploy.',
        'bucket': ['postdeploy-auth', 'azd-papercuts'],
        'plainSummary': 'Healthy enough to monitor, but still not actually usable through the expected path.',
    },
    'Multi-Turn Chat (.NET, /invocations)': {
        'slug': 'multiturn-dotnet-invocations',
        'outcome': 'fail',
        'firstFailure': 'The local behavior was already suspect and the remote session never became ready.',
        'bucket': ['sample-runtime-bug'],
        'plainSummary': 'This one looks like a true sample/runtime problem, not just auth or harness noise.',
    },
    'Echo Streaming (.NET, /responses)': {
        'slug': 'echo-streaming-dotnet-responses',
        'outcome': 'fail',
        'firstFailure': 'Service mapping and environment targeting were wrong, so the correct remote deployment never really happened.',
        'bucket': ['broken-template-contract'],
        'plainSummary': 'Local behavior looked good, but the deployment mapping was wrong and the remote sample never came up correctly.',
    },
}

BUCKET_LABELS = {
    'baseline-pass': 'Clean pass',
    'broken-template-contract': 'Broken template or deploy contract',
    'postdeploy-auth': 'Postdeploy RBAC or identity failure',
    'sample-runtime-bug': 'Sample or runtime bug',
    'azd-papercuts': 'azd or operator-experience papercut',
    'harness-noise': 'Harness or environment noise',
}

ESSENTIAL_COMMAND_PATTERNS = [
    r'azd\s+ai\s+agent\s+init',
    r'azd\s+ai\s+agent\s+run',
    r'azd\s+ai\s+agent\s+invoke',
    r'azd\s+ai\s+agent\s+show',
    r'azd\s+ai\s+agent\s+monitor',
    r'azd\s+provision',
    r'azd\s+deploy',
    r'azd\s+down',
    r'azd\s+init',
    r'azd\s+env\s+get-values',
    r'curl\b',
    r'dotnet\s+run',
    r'dotnet\s+build',
    r'python3\s+main\.py',
    r'\.venv/bin/python\s+main\.py',
]

PHASE_COMMAND_PATTERNS = {
    'Create/Scaffold': [
        r'azd\s+ai\s+agent\s+init',
        r'azd\s+init',
    ],
    'Provision': [
        r'azd\s+provision',
    ],
    'Local Run': [
        r'azd\s+ai\s+agent\s+run',
        r'dotnet\s+run',
        r'python3\s+main\.py',
        r'\.venv/bin/python\s+main\.py',
        r'curl\b',
    ],
    'Deploy': [
        r'azd\s+deploy',
    ],
    'Remote Invoke': [
        r'azd\s+ai\s+agent\s+invoke',
        r'curl\b',
    ],
    'Monitor': [
        r'azd\s+ai\s+agent\s+show',
        r'azd\s+ai\s+agent\s+monitor',
        r'logs?\b',
    ],
    'Update & Redeploy': [
        r'azd\s+deploy',
        r'azd\s+ai\s+agent\s+invoke',
        r'curl\b',
    ],
    'Cleanup': [
        r'azd\s+down',
    ],
}

EXPECTED_PHASE_EVIDENCE = {
    'Create/Scaffold': [
        ('azd init evidence missing', r'azd\s+(?:ai\s+agent\s+init|init)'),
    ],
    'Provision': [
        ('azd provision evidence missing', r'azd\s+provision'),
    ],
    'Local Run': [
        ('azd ai agent run evidence missing', r'azd\s+ai\s+agent\s+run'),
    ],
    'Deploy': [
        ('azd deploy evidence missing', r'azd\s+deploy'),
    ],
    'Remote Invoke': [
        ('azd ai agent invoke evidence missing', r'azd\s+ai\s+agent\s+invoke'),
    ],
    'Monitor': [
        ('monitor evidence missing', r'(?:azd\s+ai\s+agent\s+monitor|log(?:s| file)\b)'),
    ],
    'Update & Redeploy': [
        ('redeploy evidence missing', r'azd\s+deploy'),
    ],
}

EXECUTIVE_THEME_TEXT = {
    'broken-template-contract': 'Several samples did not fail because the hosted-agent platform crashed. They failed because the scaffolded project shape, Azure resources, and deploy target disagreed with each other. In practice that means engineers would follow the documented flow, get through scaffold or provision, and only discover at deploy time that the target resource does not actually exist in the expected form.',
    'postdeploy-auth': 'A second major bucket got through deploy and looked healthy enough to inspect, but still broke on first real remote use. The recurring pattern was that image build, push, and agent registration succeeded, while the postdeploy identity or RBAC setup did not. That is especially painful because it looks like a success until the first invoke.',
    'sample-runtime-bug': 'A smaller but important bucket appears to be true sample or runtime behavior, not just tooling friction. The Python multi-turn invocations sample loses the request body before the handler reads it, and the .NET multi-turn invocations sample never becomes ready after deploy. Those look like defects in the sample path itself.',
    'azd-papercuts': 'Even where the underlying sample was healthy enough to run, the tool experience often was not. The run repeatedly needed manual intervention for prompts, token audience, agent-name selection, hidden assistant output, hardcoded ports, or direct process launch. That means the product may be healthier than the raw fail count suggests, but the engineer experience is still too rough.',
    'harness-noise': 'A few failures were not fair product attempts at all. Some phases ran before their upstream deploys had really completed, two scaffolds were temporarily blocked by SSH credential issues, and one late-stage sample lost its resource group unexpectedly. These do not remove the product bugs, but they do distort the run unless they are clearly separated out.',
}


def strip_jit_comments(comments: list[dict]) -> list[dict]:
    return [c for c in comments if '<!-- jit-' not in c.get('body', '')]


def parse_issue_title(title: str) -> tuple[str, str]:
    phase_match = re.search(r'\] (P\d+): ([^-—]+?)(?:\s+—|$)', title)
    phase = phase_match.group(2).strip() if phase_match else title
    template = re.search(r'— (.*)$', title).group(1)
    return phase, template


def infer_step_status(text: str) -> str:
    low = text.lower()
    if any(x in low for x in ['partial', 'mixed result']):
        return 'partial'
    if any(x in low for x in ['fail', 'failed', 'blocked', 'cascade failure', 'cannot execute', 'expected failure']):
        return 'fail'
    if any(x in low for x in ['pass', 'passed', 'success', 'succeeded', 'complete', 'completed successfully']):
        return 'pass'
    return 'unknown'


def extract_summary(comments: list[dict]) -> str:
    for c in comments:
        body = c.get('body', '')
        line = next((ln.strip() for ln in body.splitlines() if ln.strip()), '')
        if line:
            return line
    return ''


def dedupe(values: list[str]) -> list[str]:
    out = []
    seen = set()
    for v in values:
        v2 = v.strip()
        if not v2:
            continue
        k = re.sub(r'\s+', ' ', v2)
        if k in seen:
            continue
        seen.add(k)
        out.append(v2)
    return out


def interesting_command(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith('cd '):
        return any(re.search(pat, stripped, re.I) for pat in ESSENTIAL_COMMAND_PATTERNS)
    if stripped.startswith('azd env set') or stripped.startswith('azd env new') or stripped.startswith('azd env select'):
        return False
    for pat in ESSENTIAL_COMMAND_PATTERNS:
        if re.search(pat, stripped, re.I):
            return True
    return False


def filter_commands(block: str) -> list[str]:
    lines = [ln.rstrip() for ln in block.splitlines()]
    picked = [ln.strip() for ln in lines if interesting_command(ln)]
    return picked[:4]


def filter_output(block: str) -> str:
    lines = [ln.rstrip() for ln in block.splitlines() if ln.strip() and ln.strip() != '```']
    if not lines:
        return ''
    preferred = []
    for ln in lines:
        low = ln.lower()
        if any(x in low for x in ['error', 'exception', 'failed', 'http ', 'request_id', 'trace id', 'session_not_ready', 'session_creation_failed', 'permission denied', 'not found', 'resource not found', 'jsondecodeerror']):
            preferred.append(ln)
    use = preferred[:18] if preferred else lines[:18]
    return '\n'.join(use)


def looks_like_shell_command(text: str) -> bool:
    prefixes = (
        'azd ',
        'dotnet ',
        'python',
        '.venv/bin/python',
        'curl ',
        'timeout ',
        'cd ',
        'uv ',
    )
    return text.startswith(prefixes)


def normalize_shell_command_line(line: str) -> str:
    raw = line.strip().strip('`')
    if not raw:
        return ''

    inline_commands = re.findall(r'`([^`]+)`', raw)
    for cmd in inline_commands:
        cmd = cmd.strip()
        if looks_like_shell_command(cmd):
            return cmd

    candidate = re.sub(r'^#+\s*', '', raw)
    candidate = re.sub(r'^[\s\-\*\d\.)]+', '', candidate)
    candidate = re.sub(r'^(Command|Commands)\s*:\s*', '', candidate, flags=re.I)
    candidate = re.sub(r'^(Step|Attempt)\s+[A-Za-z0-9_.-]+\s*:\s*', '', candidate, flags=re.I)
    candidate = candidate.strip().strip('`')

    if not candidate or candidate.startswith('#'):
        return ''
    return candidate if looks_like_shell_command(candidate) else ''


def prune_commands(commands: list[str]) -> list[str]:
    cleaned = []
    for cmd in dedupe(commands):
        low = cmd.lower().strip()
        if low in {'azd ai agent invoke', 'azd ai agent show', 'azd ai agent monitor'}:
            continue
        if low.startswith('azd ai agent invoke ') and '(' in low and '"' not in cmd and '--' not in low:
            continue
        if low.startswith('curl ') and not re.search(r'curl\s+(?:-|https?://)', low):
            continue
        if any(low != other.lower().strip() and other.lower().strip().startswith(low) for other in commands):
            continue
        cleaned.append(cmd)
    return cleaned or dedupe(commands)


def score_output_snippet(text: str) -> int:
    low = text.lower()
    score = 0
    for token in ['error', 'http', 'trace id', 'response', 'listening', 'downloaded', 'deploying', 'session', 'manifest', 'ready', 'failed', '200 ok']:
        if token in low:
            score += 2
    for token in ['plan', 'executing now', 'next:', 'duration', 'status:']:
        if token in low:
            score -= 1
    return score


def split_sections(body: str) -> list[str]:
    sections = [part.strip() for part in re.split(r'(?m)(?=^##+\s)', body) if part.strip()]
    return sections or [body]


def fallback_output_from_section(section: str) -> str:
    cleaned = re.sub(r'\*\*Command:?\*\*\s*```.*?```', '', section, flags=re.S)
    cleaned = re.sub(r'\*\*Commands:?\*\*\s*```.*?```', '', cleaned, flags=re.S)
    cleaned = re.sub(r'\*\*Command:?\*\*\s*`[^`]+`', '', cleaned)
    cleaned = re.sub(r'\*\*Commands:?\*\*\s*`[^`]+`', '', cleaned)
    cleaned = re.sub(r'^###+\s.*$', '', cleaned, flags=re.M)
    cleaned = re.sub(r'^---\s*$', '', cleaned, flags=re.M)
    lines = []
    for raw in cleaned.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == '```':
            continue
        if line.startswith('**Exit code') or line.startswith('**Duration') or line.startswith('**Status'):
            continue
        if line.startswith('**Command') or line.startswith('**Commands'):
            continue
        lines.append(line)
    return '\n'.join(lines[:10]).strip()


def extract_blocks(body: str) -> dict:
    command_blocks = []
    output_blocks = []
    root_causes = []
    workarounds = []

    for m in re.finditer(r'\*\*Command:?\*\*\s*```(?:bash|text)?\n(.*?)```', body, re.S):
        command_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Commands:?\*\*\s*```(?:bash|text)?\n(.*?)```', body, re.S):
        command_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Command:?\*\*\s*`([^`]+)`', body):
        command_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Commands:?\*\*\s*`([^`]+)`', body):
        command_blocks.append(m.group(1).strip())

    for m in re.finditer(r'\*\*Output:?\*\*\s*```(?:bash|text|json)?\n(.*?)```', body, re.S):
        output_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Error:?\*\*\s*```(?:bash|text|json)?\n(.*?)```', body, re.S):
        output_blocks.append(m.group(1).strip())
    for m in re.finditer(r'```(?:bash|text|json)?\n(.*?)```', body, re.S):
        block = m.group(1).strip()
        low = block.lower()
        if block in command_blocks:
            continue
        if any(token in low for token in ['error', 'exception', 'failed', 'http/', 'http ', 'trace id', 'response:', 'listening', 'downloaded', 'deploying service', 'session_not_ready', 'session_creation_failed']):
            output_blocks.append(block)
    for m in re.finditer(r'\*\*Output:?\*\*\s*`([^`]+)`', body):
        output_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Error:?\*\*\s*`([^`]+)`', body):
        output_blocks.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Output:?\*\*\s*(?!```|`)(.*?)(?:\n##|\n###|\n---|\Z)', body, re.S):
        text = m.group(1).strip()
        if text:
            output_blocks.append(text)
    for m in re.finditer(r'\*\*Error:?\*\*\s*(?!```|`)(.*?)(?:\n##|\n###|\n---|\Z)', body, re.S):
        text = m.group(1).strip()
        if text:
            output_blocks.append(text)

    for raw_line in body.splitlines():
        line = raw_line.strip().strip('`')
        if not line:
            continue

        candidate = normalize_shell_command_line(line)

        if candidate and '->' in candidate:
            left, right = [part.strip() for part in candidate.split('->', 1)]
            if interesting_command(left):
                command_blocks.append(left)
                if right:
                    output_blocks.append(right)
                continue

        if candidate and interesting_command(candidate):
            command_blocks.append(candidate)
            continue

        if re.match(r'^(HTTP/|ERROR:|Trace ID:|Body:|Listening on|Downloaded to:|Added service entry|SUCCESS:|FAILED:|x-agent-)', line, re.I):
            output_blocks.append(line)

    for m in re.finditer(r'### Root Cause\n(.*?)(?:\n#|\Z)', body, re.S):
        root_causes.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Root cause:?\*\*\s*(.*)', body):
        root_causes.append(m.group(1).strip())
    for m in re.finditer(r'### Workaround Applied\n(.*?)(?:\n#|\Z)', body, re.S):
        workarounds.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Workaround:?\*\*\s*(.*)', body):
        workarounds.append(m.group(1).strip())
    for m in re.finditer(r'\*\*Fix:?\*\*\s*(.*)', body):
        workarounds.append(m.group(1).strip())

    return {
        'command_blocks': command_blocks,
        'output_blocks': output_blocks,
        'rootCauses': dedupe(root_causes)[:2],
        'workarounds': dedupe(workarounds)[:3],
    }


def command_matches_phase(command: str, phase: str) -> bool:
    patterns = PHASE_COMMAND_PATTERNS.get(phase, [])
    return any(re.search(pattern, command, re.I) for pattern in patterns)


def build_phase_timeline(phase: str, comment_bodies: list[str]) -> dict:
    commands = []
    outputs = []
    timeline = []
    output_candidates = []

    for body in comment_bodies:
        for section in split_sections(body):
            blocks = extract_blocks(section)
            filtered_commands = []
            for block in blocks['command_blocks']:
                filtered_commands.extend(filter_commands(block))

            phase_commands = [cmd for cmd in dedupe(filtered_commands) if command_matches_phase(cmd, phase)]
            phase_outputs = []
            for block in blocks['output_blocks']:
                filtered = filter_output(block)
                if filtered:
                    phase_outputs.append(filtered)
            phase_outputs = dedupe(phase_outputs)

            if phase_commands:
                for cmd in phase_commands[:2]:
                    if cmd not in commands:
                        commands.append(cmd)
                        timeline.append({'type': 'command', 'text': cmd})
                if phase_outputs:
                    for output in phase_outputs[:2]:
                        output_candidates.append(output)
                else:
                    fallback = fallback_output_from_section(section)
                    if fallback:
                        output_candidates.append(fallback)

    commands = prune_commands(commands)[:4]
    outputs = [text for text in dedupe(sorted(output_candidates, key=score_output_snippet, reverse=True))[:4]]
    timeline = [{'type': 'command', 'text': cmd} for cmd in commands[:2]] + [{'type': 'output', 'text': out} for out in outputs[:2]]

    return {
        'commands': commands,
        'outputs': outputs,
        'timeline': timeline[:6],
    }


def detect_attention(status: str, summary: str, body: str, highlights: dict) -> list[str]:
    reasons = []
    combined = f"{summary}\n{body}".lower()
    if highlights['workarounds']:
        reasons.append('Workaround was needed')
    if highlights['rootCauses']:
        reasons.append('Issue or bug was called out')
    if highlights['outputs'] and any(
        token in '\n'.join(highlights['outputs']).lower()
        for token in ['error', 'exception', 'failed', 'not found', 'permission denied', '403', '500']
    ):
        reasons.append('Exception or failure output was captured')
    if any(token in combined for token in ['workaround', 'manual', 'fallback', 'repair', 'known bug', 'hook failed', 'rbac failed', 're-run', 'retry']):
        reasons.append('Manual intervention or retry was mentioned')

    # For cells that look green today but were not actually clean.
    if status == 'pass' and reasons:
        return dedupe(reasons)
    return dedupe(reasons)


def detect_coverage_gaps(phase: str, summary: str, body: str, commands: list[str]) -> list[str]:
    combined = '\n'.join(commands) + '\n' + summary + '\n' + body
    gaps = []
    for label, pattern in EXPECTED_PHASE_EVIDENCE.get(phase, []):
        if not re.search(pattern, combined, re.I):
            gaps.append(label)

    if phase == 'Local Run':
        has_runtime = any(re.search(r'(dotnet\s+run|python3\s+main\.py|\.venv/bin/python\s+main\.py)', cmd, re.I) for cmd in commands)
        mentions_runtime_fallback = bool(re.search(r'(workaround|ran .* directly|dotnet directly|python3 main\.py|\.venv/bin/python)', body, re.I))
        if mentions_runtime_fallback and not has_runtime:
            gaps.append('runtime fallback command evidence missing')

        mentions_azd_run_failure = bool(re.search(r'azd\s+ai\s+agent\s+run.*failed', body, re.I))
        has_azd_run = any(re.search(r'azd\s+ai\s+agent\s+run', cmd, re.I) for cmd in commands)
        if mentions_azd_run_failure and not has_azd_run:
            gaps.append('azd ai agent run failed but the literal command/output was not captured')

    return dedupe(gaps)


def extract_highlights(body: str) -> dict:
    blocks = extract_blocks(body)

    essential_commands = []
    for block in blocks['command_blocks']:
        essential_commands.extend(filter_commands(block))

    essential_outputs = []
    for block in blocks['output_blocks']:
        filtered = filter_output(block)
        if filtered:
            essential_outputs.append(filtered)

    timeline = []
    for cmd in dedupe(essential_commands)[:2]:
        timeline.append({'type': 'command', 'text': cmd})
    for out in dedupe(essential_outputs)[:2]:
        timeline.append({'type': 'output', 'text': out})

    return {
        'commands': dedupe(essential_commands)[:3],
        'outputs': dedupe(essential_outputs)[:3],
        'rootCauses': blocks['rootCauses'],
        'workarounds': blocks['workarounds'],
        'timeline': timeline,
    }


def build_executive_themes(bucket_counts: Counter, samples: list[dict]) -> list[dict]:
    examples = defaultdict(list)
    for sample in samples:
        for bucket in sample['buckets']:
            examples[bucket].append(sample['name'])

    themes = []
    for key, count in bucket_counts.most_common():
        themes.append({
            'key': key,
            'label': BUCKET_LABELS[key],
            'count': count,
            'paragraph': EXECUTIVE_THEME_TEXT.get(key, ''),
            'examples': examples[key][:4],
        })
    return themes


def build_dataset() -> dict:
    issues = json.loads(ISSUES_PATH.read_text())
    by_template = defaultdict(list)
    samples = []

    for issue in issues:
        phase, template = parse_issue_title(issue['title'])
        comments_path = COMMENTS_DIR / f"{issue['identifier']}.json"
        comments = strip_jit_comments(json.loads(comments_path.read_text()))
        summary = extract_summary(comments)
        latest_body = comments[0]['body'] if comments else ''
        detail_comments = comments[1:] if len(comments) > 1 else comments
        ordered_comment_bodies = [
            c['body'] for c in reversed(detail_comments) if c.get('body', '').strip()
        ]
        detailed_body = '\n\n---\n\n'.join(
            ordered_comment_bodies
        ) or latest_body
        highlights = extract_highlights(detailed_body)
        phase_highlights = build_phase_timeline(phase, ordered_comment_bodies)
        if phase_highlights['commands']:
            highlights['commands'] = phase_highlights['commands']
        if phase_highlights['outputs']:
            highlights['outputs'] = phase_highlights['outputs']
        if phase_highlights['timeline']:
            highlights['timeline'] = phase_highlights['timeline']
        coverage_gaps = detect_coverage_gaps(phase, summary, detailed_body, highlights['commands'])
        md_html = markdown.markdown(detailed_body, extensions=['fenced_code', 'tables', 'sane_lists'])
        status = infer_step_status(summary)
        if status == 'unknown':
            status = infer_step_status(detailed_body)
        attention_reasons = detect_attention(status, summary, detailed_body, highlights)
        attention_reasons = dedupe(attention_reasons + coverage_gaps)
        display_status = 'partial' if status == 'pass' and attention_reasons else status
        step = {
            'issueId': issue['identifier'],
            'phase': phase,
            'objective': PHASE_GOALS.get(phase, ''),
            'summary': summary,
            'status': status,
            'displayStatus': display_status,
            'attention': bool(attention_reasons),
            'attentionReasons': attention_reasons,
            'html': md_html,
            'commandSnippets': highlights['commands'],
            'outputSnippets': highlights['outputs'],
            'rootCauses': highlights['rootCauses'],
            'workarounds': highlights['workarounds'],
            'timeline': highlights['timeline'],
            'coverageGaps': coverage_gaps,
            'commentCount': len(comments),
        }
        by_template[template].append(step)

    outcome_counts = Counter()
    bucket_counts = Counter()

    for template, steps in sorted(by_template.items()):
        meta = SAMPLE_META.get(template, {
            'slug': re.sub(r'[^a-z0-9]+', '-', template.lower()).strip('-'),
            'outcome': 'unknown',
            'firstFailure': '',
            'bucket': [],
            'plainSummary': '',
        })
        steps_sorted = sorted(steps, key=lambda s: PHASE_ORDER.get(s['phase'], 999))
        outcome_counts[meta['outcome']] += 1
        for bucket in meta['bucket']:
            bucket_counts[bucket] += 1
        samples.append({
            'name': template,
            'slug': meta['slug'],
            'outcome': meta['outcome'],
            'plainSummary': meta['plainSummary'],
            'firstFailure': meta['firstFailure'],
            'buckets': meta['bucket'],
            'steps': steps_sorted,
        })

    executive_themes = build_executive_themes(bucket_counts, samples)

    return {
        'runId': 'HOL-3224',
        'runDate': '2026-04-14',
        'runSlug': '2026-04-14-hol-3224',
        'title': 'HAT Run HOL-3224',
        'phases': list(PHASE_ORDER.keys()),
        'phaseGoals': PHASE_GOALS,
        'summary': {
            'pass': outcome_counts['pass'],
            'partial': outcome_counts['partial'],
            'fail': outcome_counts['fail'],
            'bucketCounts': [
                {'key': k, 'label': BUCKET_LABELS[k], 'count': v}
                for k, v in bucket_counts.most_common()
            ],
            'executiveThemes': executive_themes,
        },
        'samples': samples,
        'bucketLabels': BUCKET_LABELS,
    }


def write_files(dataset: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)

    run_filename = f"{dataset['runSlug']}.json"
    run_path = RUNS_DIR / run_filename
    run_path.write_text(json.dumps(dataset, indent=2))

    # Legacy single-run path kept for backwards compatibility during transition.
    (DATA_DIR / 'hol-3224.json').write_text(json.dumps(dataset, indent=2))

    runs = []
    for path in sorted(RUNS_DIR.glob('*.json')):
        payload = json.loads(path.read_text())
        runs.append({
            'slug': payload.get('runSlug') or path.stem,
            'runId': payload.get('runId', path.stem),
            'runDate': payload.get('runDate', ''),
            'title': payload.get('title') or payload.get('runId', path.stem),
            'summary': payload.get('summary', {}),
            'file': f'./data/runs/{path.name}',
        })

    index_payload = {
        'runs': runs,
    }
    (DATA_DIR / 'index.json').write_text(json.dumps(index_payload, indent=2))

    legacy_runs_payload = [
        {
            'runId': run['runId'],
            'runDate': run['runDate'],
            'label': f"{run['runId']} · {run['runDate']}",
            'file': f"runs/{Path(run['file']).name}",
            'sampleCount': len(json.loads((RUNS_DIR / f"{run['slug']}.json").read_text()).get('samples', [])),
            'summary': {
                'pass': run.get('summary', {}).get('pass', 0),
                'partial': run.get('summary', {}).get('partial', 0),
                'fail': run.get('summary', {}).get('fail', 0),
            },
        }
        for run in runs
    ]
    (DATA_DIR / 'runs.json').write_text(json.dumps(legacy_runs_payload, indent=2))


def main() -> None:
    dataset = build_dataset()
    write_files(dataset)
    print(f"Wrote explorer dataset for {len(dataset['samples'])} samples")


if __name__ == '__main__':
    main()
