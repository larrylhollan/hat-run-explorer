const CANONICAL_COMMANDS = {
  'Create/Scaffold': [
    { cmd: 'azd extension install', short: 'ext install' },
    { cmd: 'azd ai agent init', short: 'agent init' },
  ],
  'Provision': [
    { cmd: 'azd provision', short: 'provision' },
  ],
  'Local Run': [
    { cmd: 'azd ai agent run', short: 'agent run' },
    { cmd: 'azd ai agent invoke --local', short: 'invoke --local' },
  ],
  'Deploy': [
    { cmd: 'azd deploy', short: 'deploy' },
  ],
  'Remote Invoke': [
    { cmd: 'azd ai agent invoke', short: 'invoke' },
  ],
  'Monitor': [
    { cmd: 'azd ai agent monitor', short: 'monitor' },
  ],
  'Update & Redeploy': [
    { cmd: 'azd deploy', short: 'redeploy' },
    { cmd: 'azd ai agent invoke', short: 're-invoke' },
  ],
  'Cleanup': [
    { cmd: 'azd down', short: 'down' },
  ],
};

function classifyCommand(step, canonicalCmd) {
  if (!step) return 'cascade';
  const status = step.displayStatus || step.status;
  if (status === 'skip' || status === 'cancelled') return 'cascade';

  const cmdLower = canonicalCmd.cmd.toLowerCase();
  const timelineTexts = (step.timeline || []).filter(t => t.type === 'command').map(t => t.text.toLowerCase());
  const snippetTexts = (step.commandSnippets || []).map(t => t.toLowerCase());
  const allCmds = [...timelineTexts, ...snippetTexts];
  const htmlLower = (step.html || '').toLowerCase();

  const found = allCmds.some(t => t.includes(cmdLower)) || htmlLower.includes(cmdLower);

  const gapsLower = (step.coverageGaps || []).map(g => g.toLowerCase());
  const cmdKeywords = cmdLower.replace('azd ', '').replace('--local', '').trim().split(/\s+/);
  const isMissing = gapsLower.some(g => cmdKeywords.every(kw => g.includes(kw)) && (g.includes('missing') || g.includes('not captured')));

  if (isMissing) {
    return (step.workarounds && step.workarounds.length) ? 'workaround' : 'missing';
  }

  if (found) {
    if (status === 'pass' && !(step.workarounds && step.workarounds.length)) return 'pass';
    if (step.workarounds && step.workarounds.length) return 'workaround';
    if (status === 'fail') return 'fail';
    if (status === 'partial' || (step.displayStatus === 'partial')) return 'workaround';
    return 'pass';
  }

  if (status === 'pass') {
    if (step.workarounds && step.workarounds.length) return 'workaround';
    return 'pass';
  }
  if (status === 'fail') return 'fail';
  if (status === 'partial' || step.displayStatus === 'partial') return 'workaround';

  return 'unknown';
}

const state = {
  runs: [],
  activeRunFile: null,
  data: null,
  search: '',
  outcome: 'all',
  tab: 'overview',
  selectedSampleSlug: null,
  selectedPhase: null,
  focusDetail: false,
  expandedThemeKey: null,
};

const els = {
  landing: document.getElementById('landing'),
  runList: document.getElementById('run-list'),
  runPage: document.getElementById('run-page'),
  topbarRunActions: document.getElementById('topbar-run-actions'),
  backToRuns: document.getElementById('back-to-runs'),
  runMeta: document.getElementById('run-meta'),
  summaryCards: document.getElementById('summary-cards'),
  executiveThemes: document.getElementById('executive-themes'),
  executiveThemesPreview: document.getElementById('executive-themes-preview'),
  sampleList: document.getElementById('sample-list'),
  overviewSecondary: document.getElementById('overview-secondary'),
  scorecardTable: document.getElementById('scorecard-table'),
  search: document.getElementById('search'),
  outcomeFilter: document.getElementById('outcome-filter'),
  tabs: [...document.querySelectorAll('.tab')],
  tabPanels: {
    overview: document.getElementById('overview-tab'),
    coverage: document.getElementById('coverage-tab'),
    themes: document.getElementById('themes-tab'),
  },
  coverageSummaryRow: document.getElementById('coverage-summary-row'),
  coverageTable: document.getElementById('coverage-table'),
  coverageGapsList: document.getElementById('coverage-gaps-list'),
  coverageAttribution: document.getElementById('coverage-attribution'),
  detailPanel: document.getElementById('detail-panel'),
  detailEmpty: document.getElementById('detail-empty'),
  detailView: document.getElementById('detail-view'),
  detailPrev: document.getElementById('detail-prev'),
  detailNext: document.getElementById('detail-next'),
  detailBack: document.getElementById('detail-back'),
  detailKicker: document.getElementById('detail-kicker'),
  detailTitle: document.getElementById('detail-title'),
  detailSummary: document.getElementById('detail-summary'),
  detailBadge: document.getElementById('detail-badge'),
  detailObjective: document.getElementById('detail-objective'),
  detailFirstFailure: document.getElementById('detail-first-failure'),
  detailTags: document.getElementById('detail-tags'),
  detailAttention: document.getElementById('detail-attention'),
  detailInsights: document.getElementById('detail-insights'),
  timeline: document.getElementById('timeline'),
  detailJournal: document.getElementById('detail-journal'),
};

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(str) {
  return (str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function make(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function visibleSamples() {
  return state.data.samples.filter((sample) => {
    const text = [
      sample.name,
      sample.plainSummary,
      sample.firstFailure,
      ...(sample.buckets || []),
      ...sample.steps.map((step) => [
        step.phase,
        step.summary,
        ...(step.rootCauses || []),
        ...(step.workarounds || []),
        ...(step.commandSnippets || []),
        ...(step.outputSnippets || []),
        step.issueId,
      ].join(' ')),
    ].join(' ').toLowerCase();

    const searchOk = !state.search || text.includes(state.search.toLowerCase());
    const outcomeOk = state.outcome === 'all' || sample.outcome === state.outcome;
    return searchOk && outcomeOk;
  });
}

function findSample(slug) {
  return state.data.samples.find((sample) => sample.slug === slug);
}

function findStep(sample, phase) {
  return sample?.steps.find((step) => step.phase === phase) || null;
}

function ensureSelection() {
  const samples = visibleSamples();
  if (!samples.length) {
    state.selectedSampleSlug = null;
    state.selectedPhase = null;
    return;
  }

  const selectedStillVisible = samples.some((sample) => sample.slug === state.selectedSampleSlug);
  if (!selectedStillVisible) {
    state.selectedSampleSlug = samples[0].slug;
    state.selectedPhase = sampleDefaultPhase(samples[0]);
  }
}

function renderSummaryCards() {
  const { summary } = state.data;
  els.runMeta.textContent = `${state.data.runId} \u00b7 ${state.data.runDate} \u00b7 ${summary.pass} pass, ${summary.partial} partial, ${summary.fail} fail`;
  els.summaryCards.innerHTML = '';
  [
    ['pass', summary.pass, 'Clean pass', 'pass-card'],
    ['partial', summary.partial, 'Usable but not clean', 'partial-card'],
    ['fail', summary.fail, 'Failed or not good enough', 'fail-card'],
  ].forEach(([key, value, label, cls]) => {
    const card = make('div', `summary-card ${cls}`);
    card.innerHTML = `<div class="summary-num">${value}</div><div class="summary-label">${label}</div>`;
    els.summaryCards.appendChild(card);
  });
}

function themeCardHtml(theme, compact = false, expanded = false) {
  return `
    <div class="theme-top">
      <div>
        <h3>${theme.label}</h3>
        <p class="theme-count">${theme.count} impacted sample${theme.count === 1 ? '' : 's'}</p>
      </div>
      <button class="theme-link" type="button">${expanded ? 'Hide examples' : 'Show examples'}</button>
    </div>
    <p>${theme.paragraph}</p>
    ${expanded ? `
      <div class="example-chip-row">
        ${theme.examples.map((name) => `<button type="button" class="example-chip" data-example="${escapeHtml(name)}">${name}</button>`).join('')}
      </div>
    ` : (compact ? '' : `<p class="theme-examples"><strong>Examples:</strong> ${theme.examples.join(', ')}</p>`)}
  `;
}

function scrollToDetail() {
  requestAnimationFrame(() => {
    els.detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function jumpToSample(sample) {
  state.selectedSampleSlug = sample.slug;
  state.selectedPhase = sampleDefaultPhase(sample);
  state.tab = 'overview';
  state.focusDetail = true;
  render();
  scrollToDetail();
}

function bindThemeCard(container, theme) {
  container.querySelector('.theme-link').addEventListener('click', () => {
    state.expandedThemeKey = state.expandedThemeKey === theme.key ? null : theme.key;
    render();
  });
  container.querySelectorAll('.example-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sample = state.data.samples.find((item) => item.name === btn.dataset.example);
      if (sample) jumpToSample(sample);
    });
  });
}

function renderExecutiveThemes() {
  els.executiveThemes.innerHTML = '';
  els.executiveThemesPreview.innerHTML = '';
  state.data.summary.executiveThemes.forEach((theme, index) => {
    const expanded = state.expandedThemeKey === theme.key;
    const full = make('article', 'theme-card');
    full.innerHTML = themeCardHtml(theme, false, expanded);
    bindThemeCard(full, theme);
    els.executiveThemes.appendChild(full);

    if (index < 3) {
      const preview = make('article', 'theme-card');
      preview.innerHTML = themeCardHtml(theme, true, expanded);
      bindThemeCard(preview, theme);
      els.executiveThemesPreview.appendChild(preview);
    }
  });
}

function renderSampleList() {
  els.sampleList.innerHTML = '';
  const samples = visibleSamples();
  samples.forEach((sample) => {
    const card = make('button', `sample-card ${sample.slug === state.selectedSampleSlug ? 'active' : ''}`);
    card.type = 'button';
    card.innerHTML = `
      <div class="sample-card-top">
        <h3>${sample.name}</h3>
        <span class="badge ${sample.outcome}">${titleCase(sample.outcome)}</span>
      </div>
      <p>${sample.plainSummary}</p>
    `;
    card.addEventListener('click', () => {
      state.selectedSampleSlug = sample.slug;
      state.selectedPhase = sampleDefaultPhase(sample);
      state.focusDetail = false;
      render();
    });
    els.sampleList.appendChild(card);
  });
}

function renderTabs() {
  els.tabs.forEach((tab) => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle('active', active);
  });
  Object.entries(els.tabPanels).forEach(([name, panel]) => {
    panel.classList.toggle('active', name === state.tab);
  });
}

function sampleDefaultPhase(sample) {
  const firstProblem = sample.steps.find((step) => (step.displayStatus || step.status) !== 'pass');
  return firstProblem?.phase || sample.steps[0]?.phase || null;
}

function renderScorecard() {
  const phases = state.data.phases;
  const samples = visibleSamples();
  const header = ['<thead><tr><th class="sample-col sticky-left">Sample</th>']
    .concat(phases.map((phase) => `<th>${phase}</th>`))
    .concat(['</tr></thead>'])
    .join('');

  const rows = samples.map((sample) => {
    const cells = phases.map((phase) => {
      const step = findStep(sample, phase);
      if (!step) return '<td><div class="score-cell empty">—</div></td>';
      const active = sample.slug === state.selectedSampleSlug && phase === state.selectedPhase;
      const displayStatus = step.displayStatus || step.status;
      const text = displayStatus === 'partial' ? '△' : displayStatus === 'pass' ? '✓' : displayStatus === 'fail' ? '✕' : '•';
      const attentionDot = step.attention ? '<span class="attention-dot" aria-hidden="true"></span>' : '';
      return `<td>
        <button class="score-cell ${displayStatus} ${active ? 'active' : ''}" 
          data-sample="${sample.slug}" data-phase="${escapeHtml(phase)}"
          title="${escapeHtml(sample.name)} • ${escapeHtml(phase)} • ${escapeHtml(step.summary || '')}">
          ${attentionDot}
          <span class="score-symbol">${text}</span>
        </button>
      </td>`;
    }).join('');
    return `<tr><th class="sample-col sticky-left">${sample.name}</th>${cells}</tr>`;
  }).join('');

  els.scorecardTable.innerHTML = `${header}<tbody>${rows}</tbody>`;
  els.scorecardTable.querySelectorAll('.score-cell').forEach((btn) => {
    if (btn.classList.contains('empty')) return;
    btn.addEventListener('click', () => {
      state.selectedSampleSlug = btn.dataset.sample;
      state.selectedPhase = btn.dataset.phase;
      state.focusDetail = true;
      render();
      scrollToDetail();
    });
  });
}

function navigateStep(direction) {
  const sample = findSample(state.selectedSampleSlug);
  if (!sample) return;
  const currentPhase = state.selectedPhase || sampleDefaultPhase(sample);
  const index = sample.steps.findIndex((step) => step.phase === currentPhase);
  if (index === -1) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sample.steps.length) return;
  state.selectedPhase = sample.steps[nextIndex].phase;
  state.focusDetail = true;
  render();
  scrollToDetail();
}

function renderDetail() {
  const sample = findSample(state.selectedSampleSlug);
  const desiredPhase = state.selectedPhase || sampleDefaultPhase(sample);
  const step = desiredPhase ? findStep(sample, desiredPhase) : null;

  if (!sample || !step) {
    els.detailEmpty.classList.remove('hidden');
    els.detailView.classList.add('hidden');
    els.detailPrev.classList.add('hidden');
    els.detailNext.classList.add('hidden');
    return;
  }

  els.detailEmpty.classList.add('hidden');
  els.detailView.classList.remove('hidden');
  const stepIndex = sample.steps.findIndex((item) => item.phase === step.phase);
  els.detailPrev.classList.toggle('hidden', stepIndex <= 0);
  els.detailNext.classList.toggle('hidden', stepIndex === -1 || stepIndex >= sample.steps.length - 1);
  els.detailKicker.textContent = sample.name;
  els.detailTitle.textContent = step.phase;
  els.detailSummary.textContent = step.summary || sample.plainSummary;
  const detailStatus = step.displayStatus || step.status;
  els.detailBadge.className = `badge ${detailStatus}`;
  els.detailBadge.textContent = titleCase(detailStatus);
  els.detailObjective.textContent = step.objective || state.data.phaseGoals[step.phase] || '';
  els.detailFirstFailure.textContent = sample.firstFailure;

  els.detailTags.innerHTML = '';
  const issueTag = make('span', 'tag info', step.issueId);
  els.detailTags.appendChild(issueTag);
  sample.buckets.forEach((bucket) => {
    const tag = make('span', 'tag root', state.data.bucketLabels[bucket] || bucket);
    els.detailTags.appendChild(tag);
  });

  if (step.attention && step.attentionReasons?.length) {
    els.detailAttention.classList.remove('hidden');
    els.detailAttention.innerHTML = `<strong>Needs attention:</strong> ${step.attentionReasons.join(' • ')}`;
  } else {
    els.detailAttention.classList.add('hidden');
    els.detailAttention.innerHTML = '';
  }

  els.detailInsights.innerHTML = '';
  if (step.rootCauses?.length) {
    const card = make('div', 'insight-card');
    card.innerHTML = `<h3>Root cause</h3>${step.rootCauses.map((text) => `<p>${text}</p>`).join('')}`;
    els.detailInsights.appendChild(card);
  }
  if (step.workarounds?.length) {
    const card = make('div', 'insight-card');
    card.innerHTML = `<h3>Workaround or fix</h3>${step.workarounds.map((text) => `<p>${text}</p>`).join('')}`;
    els.detailInsights.appendChild(card);
  }
  if (!step.rootCauses?.length && !step.workarounds?.length) {
    const card = make('div', 'insight-card');
    card.innerHTML = `<h3>Overview</h3><p>${sample.plainSummary}</p>`;
    els.detailInsights.appendChild(card);
  }

  els.timeline.innerHTML = '';
  const timelineItems = (step.timeline && step.timeline.length)
    ? step.timeline
    : [
        ...(step.commandSnippets || []).slice(0, 1).map((text) => ({ type: 'command', text })),
        ...(step.outputSnippets || []).slice(0, 1).map((text) => ({ type: 'output', text })),
      ];

  timelineItems.forEach((item) => {
    const bubble = make('div', `timeline-item ${item.type}`);
    bubble.innerHTML = `
      <div class="timeline-label">${item.type === 'command' ? 'Command' : 'Output / exception'}</div>
      <pre><code>${escapeHtml(item.text)}</code></pre>
    `;
    els.timeline.appendChild(bubble);
  });

  if (!timelineItems.length) {
    const bubble = make('div', 'timeline-item note', '<div class="timeline-label">Summary</div><p>No distilled command or output snippet was captured for this step yet. Use the full journal entry below.</p>');
    els.timeline.appendChild(bubble);
  }

  els.detailJournal.innerHTML = step.html;
}

function renderCoverageAudit() {
  if (!els.coverageTable) return;
  const samples = visibleSamples();
  const phases = Object.keys(CANONICAL_COMMANDS);

  // Build flat column list: phase + command pairs
  const columns = [];
  phases.forEach(phase => {
    CANONICAL_COMMANDS[phase].forEach(cc => {
      columns.push({ phase, ...cc });
    });
  });

  // Compute all cell classifications
  let totalCells = 0, passCount = 0, workaroundCount = 0, failCount = 0, missingCount = 0, cascadeCount = 0;
  const cellData = [];
  samples.forEach(sample => {
    const row = [];
    columns.forEach(col => {
      const step = findStep(sample, col.phase);
      const cls = classifyCommand(step, col);
      row.push(cls);
      totalCells++;
      if (cls === 'pass') passCount++;
      else if (cls === 'workaround') workaroundCount++;
      else if (cls === 'fail') failCount++;
      else if (cls === 'missing') missingCount++;
      else if (cls === 'cascade') cascadeCount++;
    });
    cellData.push(row);
  });

  // Summary cards
  const customerClean = samples.filter((_, si) => cellData[si].every(c => c === 'pass')).length;
  els.coverageSummaryRow.innerHTML = [
    ['pass', passCount, 'Canonical pass', 'pass-card'],
    ['partial', workaroundCount, 'Workaround used', 'partial-card'],
    ['fail', failCount + missingCount, 'Failed / missing', 'fail-card'],
    ['cascade', cascadeCount, 'Cascade / skipped', 'cascade-card'],
  ].map(([, value, label, cls]) => `<div class="summary-card ${cls}"><div class="summary-num">${value}</div><div class="summary-label">${label}</div></div>`).join('');

  // Phase header spans
  let phaseHeader = '<th class="sample-col sticky-left"></th>';
  phases.forEach(phase => {
    const span = CANONICAL_COMMANDS[phase].length;
    phaseHeader += `<th colspan="${span}" class="coverage-phase-header">${escapeHtml(phase)}</th>`;
  });

  let cmdHeader = '<th class="sample-col sticky-left">Sample</th>';
  columns.forEach(col => {
    cmdHeader += `<th class="coverage-cmd-header" title="${escapeHtml(col.cmd)}">${escapeHtml(col.short)}</th>`;
  });

  const rows = samples.map((sample, si) => {
    const cells = cellData[si].map((cls, ci) => {
      const col = columns[ci];
      const symbols = { pass: '✓', workaround: '△', fail: '✕', missing: '○', cascade: '—', unknown: '?' };
      const step = findStep(sample, col.phase);
      const tip = `${sample.name} • ${col.cmd} • ${cls}`;
      return `<td><button class="score-cell cov-${cls}" title="${escapeHtml(tip)}" data-sample="${sample.slug}" data-phase="${escapeHtml(col.phase)}"><span class="score-symbol">${symbols[cls] || '?'}</span></button></td>`;
    }).join('');
    return `<tr><th class="sample-col sticky-left">${escapeHtml(sample.name)}</th>${cells}</tr>`;
  }).join('');

  els.coverageTable.innerHTML = `<thead><tr>${phaseHeader}</tr><tr>${cmdHeader}</tr></thead><tbody>${rows}</tbody>`;

  // Click handler: jump to detail
  els.coverageTable.querySelectorAll('.score-cell').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedSampleSlug = btn.dataset.sample;
      state.selectedPhase = btn.dataset.phase;
      state.tab = 'overview';
      state.focusDetail = true;
      render();
      scrollToDetail();
    });
  });

  // Gaps list
  const gapsByPhase = {};
  samples.forEach((sample, si) => {
    columns.forEach((col, ci) => {
      const cls = cellData[si][ci];
      if (cls === 'missing' || cls === 'workaround' || cls === 'fail') {
        const key = col.phase;
        if (!gapsByPhase[key]) gapsByPhase[key] = [];
        const step = findStep(sample, col.phase);
        gapsByPhase[key].push({
          sample: sample.name,
          cmd: col.cmd,
          status: cls,
          workarounds: step?.workarounds || [],
          coverageGaps: step?.coverageGaps || [],
        });
      }
    });
  });

  els.coverageGapsList.innerHTML = '';
  if (Object.keys(gapsByPhase).length === 0) {
    els.coverageGapsList.innerHTML = '<p class="subtle">All canonical commands captured — no gaps.</p>';
  } else {
    Object.entries(gapsByPhase).forEach(([phase, items]) => {
      const card = make('article', 'theme-card');
      const statusIcons = { missing: '○ Missing', workaround: '△ Workaround', fail: '✕ Failed' };
      const itemsHtml = items.map(item => {
        const detail = item.workarounds.length ? `<br/><span class="gap-detail">${escapeHtml(item.workarounds[0].substring(0, 120))}${item.workarounds[0].length > 120 ? '…' : ''}</span>` : '';
        return `<div class="gap-item"><span class="gap-status cov-${item.status}-text">${statusIcons[item.status]}</span> <strong>${escapeHtml(item.cmd)}</strong> — ${escapeHtml(item.sample)}${detail}</div>`;
      }).join('');
      card.innerHTML = `<div class="theme-top"><div><h3>${escapeHtml(phase)}</h3><p class="theme-count">${items.length} issue${items.length === 1 ? '' : 's'}</p></div></div>${itemsHtml}`;
      els.coverageGapsList.appendChild(card);
    });
  }

  // Attribution
  const attrCounts = { platform: 0, tooling: 0, harness: 0, cascade: 0 };
  samples.forEach(sample => {
    const buckets = sample.buckets || [];
    if (buckets.includes('broken-template-contract') || buckets.includes('postdeploy-auth') || buckets.includes('sample-runtime-bug')) attrCounts.platform++;
    if (buckets.includes('azd-papercuts')) attrCounts.tooling++;
    if (buckets.includes('harness-noise')) attrCounts.harness++;
  });
  attrCounts.cascade = cascadeCount;

  els.coverageAttribution.innerHTML = [
    ['Platform / sample bug', attrCounts.platform, 'Broken template, auth failure, or runtime bug in the sample itself'],
    ['azd / tooling bug', attrCounts.tooling, 'CLI or operator-experience issue — the canonical command didn\'t work as documented'],
    ['Harness noise', attrCounts.harness, 'Environment or test harness artifact — not a real product issue'],
    ['Cascade blocks', attrCounts.cascade, 'Commands skipped because an earlier phase failed'],
  ].map(([label, count, desc]) => `<article class="theme-card"><div class="theme-top"><div><h3>${escapeHtml(label)}</h3><p class="theme-count">${count} occurrence${count === 1 ? '' : 's'}</p></div></div><p>${escapeHtml(desc)}</p></article>`).join('');
}

function render() {
  ensureSelection();
  document.body.classList.toggle('detail-focus', state.focusDetail);
  els.detailBack.classList.toggle('hidden', !state.focusDetail);
  renderTabs();
  renderSummaryCards();
  renderExecutiveThemes();
  renderSampleList();
  renderScorecard();
  renderCoverageAudit();
  renderDetail();
}

function showLanding() {
  state.data = null;
  state.activeRunFile = null;
  state.search = '';
  state.outcome = 'all';
  state.selectedSampleSlug = null;
  state.selectedPhase = null;
  state.focusDetail = false;
  state.expandedThemeKey = null;
  els.search.value = '';
  els.outcomeFilter.value = 'all';

  els.landing.classList.remove('hidden');
  els.runPage.classList.add('hidden');
  els.topbarRunActions.classList.add('hidden');
  els.runMeta.textContent = 'Select a run';
  window.history.replaceState({}, '', window.location.pathname);
  renderRunList();
}

function renderRunList() {
  els.runList.innerHTML = '';
  if (!state.runs.length) {
    els.runList.innerHTML = '<p class="subtle">No runs available.</p>';
    return;
  }
  state.runs.forEach((run) => {
    const card = make('button', 'run-card');
    card.type = 'button';
    const total = run.summary.pass + run.summary.partial + run.summary.fail;
    card.innerHTML = `
      <div class="run-card-top">
        <h3>${escapeHtml(run.label)}</h3>
        <span class="badge-pill">${total} sample${total === 1 ? '' : 's'}</span>
      </div>
      <div class="run-card-stats">
        <span class="run-stat pass">${run.summary.pass} pass</span>
        <span class="run-stat partial">${run.summary.partial} partial</span>
        <span class="run-stat fail">${run.summary.fail} fail</span>
      </div>
    `;
    card.addEventListener('click', () => loadRun(run.file));
    els.runList.appendChild(card);
  });
}

async function loadRun(file) {
  els.runMeta.textContent = 'Loading run data\u2026';
  const res = await fetch(`./data/${file}`);
  state.data = await res.json();
  state.activeRunFile = file;
  state.selectedSampleSlug = state.data.samples[0]?.slug || null;
  state.selectedPhase = state.selectedSampleSlug ? sampleDefaultPhase(state.data.samples[0]) : null;

  els.landing.classList.add('hidden');
  els.runPage.classList.remove('hidden');
  els.topbarRunActions.classList.remove('hidden');
  const params = new URLSearchParams();
  params.set('run', file);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  render();
}

function bindGlobalEvents() {
  els.search.addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    render();
  });
  els.outcomeFilter.addEventListener('change', (e) => {
    state.outcome = e.target.value;
    render();
  });
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      renderTabs();
    });
  });
  els.detailPrev.addEventListener('click', () => navigateStep(-1));
  els.detailNext.addEventListener('click', () => navigateStep(1));
  els.detailBack.addEventListener('click', () => {
    state.focusDetail = false;
    render();
    requestAnimationFrame(() => {
      els.scorecardTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  els.backToRuns.addEventListener('click', () => showLanding());
}

async function init() {
  bindGlobalEvents();

  const res = await fetch('./data/runs.json');
  state.runs = await res.json();

  const params = new URLSearchParams(window.location.search);
  const directFile = params.get('run');
  if (directFile && state.runs.some((r) => r.file === directFile)) {
    await loadRun(directFile);
  } else {
    showLanding();
  }
}

init().catch((err) => {
  els.runMeta.textContent = `Failed to load: ${err.message}`;
});
