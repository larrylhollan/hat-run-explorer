#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

try:
    import markdown
except ImportError:
    raise SystemExit(
        "ERROR: 'markdown' package not installed.\n"
        "Install it with: python3 -m pip install markdown\n"
        "Or set SKIP_BUILD_DATA=1 to skip data rebuild."
    )

ROOT = Path('/Users/larry/.openclaw/workspace-radar')
RUNS_JSON = ROOT / 'explorer/data/runs.json'
RUNS_DIR = ROOT / 'explorer/data/runs'
INDEX_JSON = ROOT / 'explorer/data/index.json'
PAPERCLIP_KEY_PATH = ROOT / 'paperclip-claimed-api-key.json'
COMPANY_ID = '8b2d40ce-d5a7-404c-bea8-7ae41a071502'
PHASES = ['Create/Scaffold', 'Provision', 'Local Run', 'Deploy', 'Remote Invoke', 'Monitor', 'Update & Redeploy', 'Cleanup']
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
PHASE_ORDER = {name: i for i, name in enumerate(PHASES, start=1)}
ARTIFACT_RE = re.compile(r'```json\n(.*?)```', re.S)


def env_required(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise SystemExit(f'{name} is required')
    return value


def http_get_json(url: str, headers: dict[str, str]) -> object:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def strip_jit(comments: list[dict]) -> list[dict]:
    return [c for c in comments if '<!-- jit-' not in (c.get('body') or '')]


def parse_title(title: str) -> tuple[str, str]:
    m = re.search(r'\] P\d+:\s*([^-—]+?)\s*[—-]\s*(.*)$', title)
    if not m:
        return title, title
    return m.group(1).strip(), m.group(2).strip()


def parse_artifact(comments: list[dict]) -> dict | None:
    artifact = None
    for c in comments:
        body = c.get('body') or ''
        for m in ARTIFACT_RE.finditer(body):
            text = m.group(1)
            if 'artifact_version' not in text or 'phase_id' not in text:
                continue
            try:
                artifact = json.loads(text)
            except Exception:
                continue
    return artifact


def extract_fenced_blocks(body: str) -> list[tuple[str, str]]:
    blocks = []
    for m in re.finditer(r'```([\w+-]*)\n(.*?)```', body, re.S):
        lang = (m.group(1) or '').strip().lower()
        text = m.group(2).strip()
        if text:
            blocks.append((lang, text))
    return blocks


def extract_commands_and_outputs(body: str) -> tuple[list[str], list[str], list[dict]]:
    command_snippets: list[str] = []
    output_snippets: list[str] = []
    timeline: list[dict] = []
    for lang, text in extract_fenced_blocks(body):
        first = text.splitlines()[0] if text.splitlines() else text
        is_command = lang in {'bash', 'sh', 'shell'} or bool(re.search(r'\b(azd|az|curl|git|dotnet|python3|npm|node|kill|cd)\b', first))
        if is_command:
            if text not in command_snippets:
                command_snippets.append(text)
                timeline.append({'type': 'command', 'text': text[:3000]})
        else:
            if text not in output_snippets:
                output_snippets.append(text)
                timeline.append({'type': 'output', 'text': text[:3000]})
    return command_snippets[:5], output_snippets[:5], timeline[:12]


def summarize_body(body: str) -> str:
    lines = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith('```') or line.startswith('<!--'):
            continue
        line = re.sub(r'^#+\s*', '', line)
        line = re.sub(r'^[-*]\s*', '', line)
        line = re.sub(r'^\*\*([^*]+)\*\*: ?\s*', '', line)
        lines.append(line)
    return lines[0][:400] if lines else 'No summary captured.'


def make_html(comments: list[dict]) -> str:
    blocks = [(c.get('body') or '').strip() for c in comments]
    text = '\n\n---\n\n'.join(b for b in blocks if b) or 'No journal captured.'
    return markdown.markdown(text, extensions=['fenced_code', 'tables'])


def classify_sample(steps: list[dict]) -> tuple[str, str, list[str]]:
    statuses = [step['status'] for step in steps]
    if all(status == 'pass' for status in statuses):
        if any(step['artifact'] and step['artifact'].get('workaround_used') for step in steps):
            return 'partial', 'Completed all phases, but needed one or more manual workarounds or non-canonical azd recoveries.', ['azd-papercuts']
        return 'pass', 'Completed all eight phases through the canonical path recorded in Paperclip.', ['baseline-pass']
    first_fail = next((step for step in steps if step['status'] != 'pass'), None)
    text = ((first_fail or {}).get('error') or (first_fail or {}).get('summary') or '').lower()
    all_text = ' '.join(filter(None, [((step.get('error') or '') + ' ' + (step.get('summary') or '')).lower() for step in steps]))
    if 'cascade blocked' in all_text or 'hard dependency' in all_text or 'dependency was cancelled' in all_text:
        return 'fail', 'Blocked before completion because an upstream dependency never became runnable or was cancelled, so downstream phases are harness noise rather than independent product failures.', ['harness-noise']
    if any(s in text for s in ['project not found', 'subdomain does not map to a resource', 'resourcenotfound']):
        return 'fail', 'Remote deploy or invoke failed because the Foundry data plane did not recognize a provisioned project or subdomain.', ['platform-data-plane']
    if any(s in text for s in ['resource group', 'deleted between', 'nxdomain', 'does not resolve']):
        return 'fail', 'Run integrity broke because infrastructure disappeared or no longer resolved between phases.', ['infra-integrity']
    if any(s in text for s in ['missing infra/', 'infra/main.bicep', 'no azure.ai.agent service found', 'no services section', 'template structural bug']):
        return 'fail', 'The sample/template shape does not satisfy the documented azd flow without manual repair.', ['template-contract']
    if any(s in text for s in ['rbac', 'credential', 'session_creation_failed']):
        return 'fail', 'Deploy completed far enough to create the service, but postdeploy identity or RBAC setup did not finish.', ['postdeploy-rbac']
    return 'fail', 'One or more phases failed and need narrative review.', ['needs-review']


def theme_paragraph(run_id: str, key: str) -> str:
    paragraphs = {
        'baseline-pass': f'This explorer entry was generated directly from Paperclip artifacts for {run_id}. Samples marked clean pass completed all eight phases without recorded workaround use.',
        'azd-papercuts': 'These samples completed their phase set, but the canonical azd path still was not clean. Engineers had to work around prompts, missing service declarations, build gaps, or protocol mismatches to keep the sample moving.',
        'platform-data-plane': 'These failures did not look like simple sample bugs. Provision or deploy created enough Azure-side state to continue, but the Foundry data plane still returned Project not found or Subdomain does not map to a resource on real remote use.',
        'infra-integrity': 'These failures are run-integrity problems. The underlying resource group or endpoint disappeared between phases, which makes downstream deploy, invoke, and monitor results unreliable as product signals.',
        'template-contract': 'These samples failed because the scaffolded project shape and the azd contract do not agree. Missing infra files, missing azure.ai.agent service entries, or no-op deploy shapes forced manual repair or immediate failure.',
        'postdeploy-rbac': 'These samples got through the core deploy path, but the postdeploy identity or RBAC steps did not finish, so the agent could not create sessions or complete remote work.',
        'harness-noise': 'These samples were blocked by upstream harness state rather than by an independently exercised product failure. They should be read as run-noise and dependency fallout, not as clean sample verdicts.',
        'needs-review': 'These samples need manual review before treating the explorer summary as final.',
    }
    return paragraphs[key]


def main() -> None:
    parent_id = env_required('HAT_PARENT_ID')
    run_id = env_required('HAT_RUN_ID')
    run_date = env_required('HAT_RUN_DATE')
    run_slug = f"{run_date}-{run_id.lower()}"
    out_path = RUNS_DIR / f'{run_slug}.json'

    token = json.loads(PAPERCLIP_KEY_PATH.read_text())['token']
    headers = {'Authorization': f'Bearer {token}'}
    base = 'http://127.0.0.1:3100/api'
    query = urllib.parse.urlencode({'parentId': parent_id, 'limit': '200'})
    children = http_get_json(f'{base}/companies/{COMPANY_ID}/issues?{query}', headers)
    if isinstance(children, dict):
        children = children.get('issues', [])
    assert isinstance(children, list)

    by_sample: dict[str, list[dict]] = defaultdict(list)
    comments_cache: dict[str, list[dict]] = {}
    sample_issue_re = re.compile(r'\] P0([1-8]):\s*.+[—-].+')
    for child in children:
        comments = http_get_json(f"{base}/issues/{child['id']}/comments", headers)
        assert isinstance(comments, list)
        comments_cache[child['id']] = strip_jit(comments)
        title = child['title']
        if not sample_issue_re.search(title):
            continue
        phase, sample = parse_title(title)
        by_sample[sample].append(child)

    samples = []
    bucket_counts = Counter()
    for sample_name in sorted(by_sample):
        steps = []
        for child in sorted(by_sample[sample_name], key=lambda c: PHASE_ORDER.get(parse_title(c['title'])[0], 999)):
            phase, _ = parse_title(child['title'])
            comments = comments_cache[child['id']]
            artifact = parse_artifact(comments)
            body = (comments[-1].get('body') if comments else '') or ''
            status = (artifact or {}).get('status') or ('pass' if child.get('status') == 'done' else child.get('status', 'unknown'))
            if status == 'done':
                status = 'pass'
            command_snippets, output_snippets, timeline = extract_commands_and_outputs(body)
            steps.append({
                'issueId': child.get('identifier') or child['id'],
                'phase': phase,
                'objective': PHASE_GOALS.get(phase, ''),
                'summary': summarize_body(body),
                'status': status,
                'displayStatus': status,
                'attention': status != 'pass' or len(comments) > 1 or bool((artifact or {}).get('workaround_used')),
                'attentionReasons': ([f'Latest step status is {status}'] if status != 'pass' else []) + ([f'{len(comments)} journal comments captured'] if len(comments) > 1 else []) + (['Recorded workaround used'] if (artifact or {}).get('workaround_used') else []),
                'html': make_html(comments),
                'commandSnippets': command_snippets,
                'outputSnippets': output_snippets,
                'rootCauses': [],
                'workarounds': [x for x in [
                    (artifact or {}).get('workaround_reason'),
                    (artifact or {}).get('workaround_command'),
                ] if x],
                'timeline': timeline,
                'commentCount': len(comments),
                'coverageGaps': [],
                'artifact': artifact,
                'error': (artifact or {}).get('error'),
            })
        outcome, plain, buckets = classify_sample(steps)
        for b in buckets:
            bucket_counts[b] += 1
        first_failure = 'No major failure detected.'
        for step in steps:
            if step['status'] != 'pass':
                first_failure = f"{step['phase']}: {step['error'] or step['summary']}"
                break
        samples.append({
            'name': sample_name,
            'slug': re.sub(r'[^a-z0-9]+', '-', sample_name.lower()).strip('-'),
            'outcome': outcome,
            'plainSummary': plain,
            'firstFailure': first_failure,
            'buckets': buckets,
            'steps': [{k: v for k, v in step.items() if k != 'artifact'} for step in steps],
        })

    summary_counts = Counter(sample['outcome'] for sample in samples)
    bucket_labels = {
        'baseline-pass': 'Clean pass',
        'azd-papercuts': 'azd or operator-experience papercut',
        'platform-data-plane': 'Foundry data-plane inconsistency',
        'infra-integrity': 'Run integrity or infrastructure deletion',
        'template-contract': 'Template or azd contract mismatch',
        'postdeploy-rbac': 'Postdeploy RBAC or identity failure',
        'harness-noise': 'Harness or environment noise',
        'needs-review': 'Needs review',
    }
    summary = {
        'pass': summary_counts.get('pass', 0),
        'partial': summary_counts.get('partial', 0),
        'fail': summary_counts.get('fail', 0),
        'bucketCounts': [
            {'key': key, 'label': bucket_labels[key], 'count': count}
            for key, count in bucket_counts.most_common()
        ],
        'executiveThemes': [
            {
                'key': key,
                'label': bucket_labels[key],
                'count': count,
                'paragraph': theme_paragraph(run_id, key),
                'examples': [s['name'] for s in samples if key in s['buckets']][:6],
            }
            for key, count in bucket_counts.most_common()
        ],
    }

    payload = {
        'runId': run_id,
        'runDate': run_date,
        'runSlug': run_slug,
        'title': f'HAT Run {run_id}',
        'phases': PHASES,
        'phaseGoals': PHASE_GOALS,
        'summary': summary,
        'samples': samples,
        'bucketLabels': bucket_labels,
    }

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))

    runs = json.loads(RUNS_JSON.read_text()) if RUNS_JSON.exists() else []
    runs = [r for r in runs if r.get('runId') != run_id]
    runs.insert(0, {
        'runId': run_id,
        'runDate': run_date,
        'label': f'{run_id} · {run_date}',
        'file': f'runs/{run_slug}.json',
        'sampleCount': len(samples),
        'summary': {
            'pass': summary['pass'],
            'partial': summary['partial'],
            'fail': summary['fail'],
        },
    })
    RUNS_JSON.write_text(json.dumps(runs, indent=2))

    if INDEX_JSON.exists():
        idx = json.loads(INDEX_JSON.read_text())
        run_index = idx.get('runs', [])
        run_index = [r for r in run_index if r.get('runId') != run_id]
        run_index.insert(0, {
            'slug': run_slug,
            'runId': run_id,
            'runDate': run_date,
            'title': f'HAT Run {run_id}',
            'summary': {'pass': summary['pass'], 'partial': summary['partial'], 'fail': summary['fail']},
            'file': f'./data/runs/{run_slug}.json',
        })
        idx['runs'] = run_index
        INDEX_JSON.write_text(json.dumps(idx, indent=2))

    print(json.dumps({'out': str(out_path), 'summary': summary}, indent=2))


if __name__ == '__main__':
    main()
