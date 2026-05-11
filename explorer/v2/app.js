/* ==========================================================================
   HAT v2 Report Dashboard — Application Logic
   Pure vanilla JS. Reads from v2 grading JSON format.
   ========================================================================== */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  runs: [],          // index of available runs
  allData: [],       // loaded run data (for trend)
  data: null,        // currently active run data
  tab: 'dashboard',
  selectedRunId: null,
  searchFilter: '',
  outcomeFilter: 'all',
};

// ---------------------------------------------------------------------------
// Scenario / strategy / agent labels
// ---------------------------------------------------------------------------

const SCENARIO_LABELS = {
  1: 'Greenfield MAF',
  2: 'MAF + Toolbox',
  3: 'LangGraph',
  4: 'Migration',
};
const STRATEGY_LABELS = { A: 'Open-Ended', B: 'Doc-Pointed', C: 'Open-Ended+Skills', D: 'Doc-Pointed+Skills' };
const AGENT_LABELS = { claude: 'Claude Code', copilot: 'Copilot CLI' };
const PILLAR_ICONS = { Quality: 'Q', Tools: 'T', Docs: 'D', Samples: 'S', Seams: '⚡' };
const PILLAR_CLASSES = { Quality: 'quality', Tools: 'tools', Docs: 'docs', Samples: 'samples', Seams: 'seams' };

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const els = {
  landing: $('landing'),
  runList: $('run-list'),
  runPage: $('run-page'),
  runMeta: $('run-meta'),
  btnBack: $('btn-back'),
  runSelector: $('run-selector'),
  heroCards: $('hero-cards'),
  scorecardTable: $('scorecard-table'),
  readinessGauge: $('readiness-gauge'),
  readinessPillars: $('readiness-pillars'),
  chartScenarios: $('chart-scenarios'),
  chartStrategies: $('chart-strategies'),
  chartAgents: $('chart-agents'),
  trendCanvas: $('trend-canvas'),
  trendNoData: $('trend-no-data'),
  runSearch: $('run-search'),
  runOutcomeFilter: $('run-outcome-filter'),
  sidebarList: $('run-sidebar-list'),
  runDetailEmpty: $('run-detail-empty'),
  runDetailContent: $('run-detail-content'),
  pillarChart: $('pillar-chart'),
  categoryBars: $('category-bars'),
  rootCauses: $('root-causes'),
  proposedFixes: $('proposed-fixes'),
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function make(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function getGrades() { return state.data?.grades || []; }

function gradeKey(g) {
  const m = g._meta || {};
  return `S${m.scenario}-${m.strategy}-${m.agent}`;
}

function gradeLabel(g) {
  const m = g._meta || {};
  return `${SCENARIO_LABELS[m.scenario] || `S${m.scenario}`} · ${STRATEGY_LABELS[m.strategy] || m.strategy} · ${AGENT_LABELS[m.agent] || m.agent}`;
}

function filteredGrades() {
  return getGrades().filter(g => {
    const text = [g.runId, gradeLabel(g), g.rootCause, g.failureCategory, g.failureCategoryDetail].join(' ').toLowerCase();
    const searchOk = !state.searchFilter || text.includes(state.searchFilter.toLowerCase());
    const outcomeOk = state.outcomeFilter === 'all' || g.success === state.outcomeFilter;
    return searchOk && outcomeOk;
  });
}

// ---------------------------------------------------------------------------
// Hero cards
// ---------------------------------------------------------------------------

function renderHero() {
  const sc = state.data?.scorecard || { total: 0, pass: 0, partial: 0, fail: 0 };
  const rate = sc.total ? Math.round((sc.pass / sc.total) * 100) : 0;
  const passPartialRate = sc.total ? Math.round(((sc.pass + sc.partial) / sc.total) * 100) : 0;
  els.heroCards.innerHTML = [
    `<div class="hero-card"><div class="hero-num">${sc.total}</div><div class="hero-label">Total Runs</div></div>`,
    `<div class="hero-card pass"><div class="hero-num">${sc.pass}</div><div class="hero-label">Pass</div></div>`,
    `<div class="hero-card partial"><div class="hero-num">${sc.partial}</div><div class="hero-label">Partial</div></div>`,
    `<div class="hero-card fail"><div class="hero-num">${sc.fail}</div><div class="hero-label">Fail</div></div>`,
    `<div class="hero-card rate"><div class="hero-num">${rate}%</div><div class="hero-label">Pass Rate</div></div>`,
    `<div class="hero-card rate"><div class="hero-num">${passPartialRate}%</div><div class="hero-label">Pass + Partial</div></div>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Scorecard matrix
// ---------------------------------------------------------------------------

function renderScorecard() {
  const grades = getGrades();
  // Discover which strategies & agents exist
  const strategies = [...new Set(grades.map(g => g._meta?.strategy))].sort();
  const agents = [...new Set(grades.map(g => g._meta?.agent))].sort();
  const scenarios = [...new Set(grades.map(g => g._meta?.scenario))].sort((a,b) => a - b);

  // Columns: one per strategy×agent combo
  const cols = [];
  for (const s of strategies) {
    for (const a of agents) {
      cols.push({ strategy: s, agent: a, label: `${s} · ${AGENT_LABELS[a] || a}` });
    }
  }

  let html = '<thead><tr><th></th>';
  for (const c of cols) html += `<th>${esc(c.label)}</th>`;
  html += '</tr></thead><tbody>';

  for (const sc of scenarios) {
    html += `<tr><td class="row-label">${esc(SCENARIO_LABELS[sc] || `S${sc}`)}</td>`;
    for (const c of cols) {
      const g = grades.find(g => g._meta?.scenario === sc && g._meta?.strategy === c.strategy && g._meta?.agent === c.agent);
      if (g) {
        const cls = `cell-${g.success}`;
        html += `<td class="${cls}" data-run-id="${esc(g.runId)}" title="${esc(g.rootCause || 'Clean pass')}">${g.success.toUpperCase()}</td>`;
      } else {
        html += '<td class="cell-empty">—</td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody>';
  els.scorecardTable.innerHTML = html;

  // Click handler
  els.scorecardTable.querySelectorAll('td[data-run-id]').forEach(td => {
    td.addEventListener('click', () => {
      switchTab('runs');
      state.selectedRunId = td.dataset.runId;
      renderRunsTab();
    });
  });
}

// ---------------------------------------------------------------------------
// GA Readiness gauge
// ---------------------------------------------------------------------------

function renderReadiness() {
  const sc = state.data?.scorecard || {};
  const total = sc.total || 1;
  // Weighted: pass=1, partial=0.5, fail=0
  const score = Math.round(((sc.pass || 0) + (sc.partial || 0) * 0.5) / total * 100);
  const color = score >= 70 ? 'var(--pass)' : score >= 40 ? 'var(--partial)' : 'var(--fail)';

  els.readinessGauge.innerHTML = `
    <div class="gauge-score" style="color:${color}">${score}%</div>
    <div class="gauge-label">GA Readiness Score</div>
  `;

  // Pillar bars
  const pillars = state.data?.readinessPillarBreakdown || {};
  els.readinessPillars.innerHTML = '';
  for (const [name, data] of Object.entries(pillars)) {
    const total = (data.pass || 0) + (data.partial || 0) + (data.fail || 0);
    const pct = total ? Math.round(((data.pass || 0) + (data.partial || 0) * 0.5) / total * 100) : 0;
    const barColor = pct >= 70 ? 'var(--pass)' : pct >= 40 ? 'var(--partial)' : 'var(--fail)';
    els.readinessPillars.innerHTML += `
      <div class="pillar-row">
        <span class="pillar-name">${esc(name)}</span>
        <div class="pillar-bar-bg">
          <div class="pillar-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          <span class="pillar-bar-label">${pct}%</span>
        </div>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// Breakdown bar charts
// ---------------------------------------------------------------------------

function renderBarChart(container, breakdown) {
  container.innerHTML = '';
  for (const [label, data] of Object.entries(breakdown)) {
    const total = (data.pass || 0) + (data.partial || 0) + (data.fail || 0);
    if (total === 0) continue;
    const pw = (data.pass || 0) / total * 100;
    const pp = (data.partial || 0) / total * 100;
    const pf = (data.fail || 0) / total * 100;
    container.innerHTML += `
      <div class="bar-row">
        <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
        <div class="bar-track">
          <div class="bar-seg pass" style="width:${pw}%"></div>
          <div class="bar-seg partial" style="width:${pp}%"></div>
          <div class="bar-seg fail" style="width:${pf}%"></div>
        </div>
        <span class="bar-value">${data.pass || 0}/${total}</span>
      </div>`;
  }
}

function renderBreakdowns() {
  // Scenario breakdown
  const scenarioData = {};
  for (const [key, data] of Object.entries(state.data?.scenarioBreakdown || {})) {
    scenarioData[SCENARIO_LABELS[key.replace('S', '')] || key] = data;
  }
  renderBarChart(els.chartScenarios, scenarioData);

  // Strategy
  const stratData = {};
  for (const [key, data] of Object.entries(state.data?.strategyBreakdown || {})) {
    stratData[STRATEGY_LABELS[key] || key] = data;
  }
  renderBarChart(els.chartStrategies, stratData);

  // Agent
  const agentData = {};
  for (const [key, data] of Object.entries(state.data?.agentBreakdown || {})) {
    agentData[AGENT_LABELS[key] || key] = data;
  }
  renderBarChart(els.chartAgents, agentData);
}

// ---------------------------------------------------------------------------
// Trend chart (simple canvas)
// ---------------------------------------------------------------------------

function renderTrend() {
  if (state.allData.length < 2) {
    els.trendCanvas.classList.add('hidden');
    els.trendNoData.classList.remove('hidden');
    return;
  }
  els.trendCanvas.classList.remove('hidden');
  els.trendNoData.classList.add('hidden');

  const canvas = els.trendCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = 200;
  ctx.clearRect(0, 0, W, H);

  const points = state.allData.map(d => {
    const sc = d.scorecard || {};
    const total = sc.total || 1;
    return {
      date: d.date,
      passRate: (sc.pass || 0) / total,
      passPartialRate: ((sc.pass || 0) + (sc.partial || 0)) / total,
    };
  });

  const pad = { top: 20, right: 20, bottom: 30, left: 40 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Grid
  ctx.strokeStyle = '#2a2e3b';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#6b7080'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(`${i * 25}%`, pad.left - 5, y + 3);
  }

  // Draw lines
  function drawLine(key, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad.left + (plotW / (points.length - 1)) * i;
      const y = pad.top + plotH * (1 - p[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Dots
    points.forEach((p, i) => {
      const x = pad.left + (plotW / (points.length - 1)) * i;
      const y = pad.top + plotH * (1 - p[key]);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    });
  }

  drawLine('passPartialRate', '#fbbf24');
  drawLine('passRate', '#34d399');

  // X labels
  ctx.fillStyle = '#6b7080'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
  points.forEach((p, i) => {
    const x = pad.left + (plotW / (points.length - 1)) * i;
    ctx.fillText(p.date, x, H - 8);
  });

  // Legend
  ctx.fillStyle = '#34d399'; ctx.fillRect(W - 180, 8, 10, 10);
  ctx.fillStyle = '#e4e6ef'; ctx.font = '11px Inter'; ctx.textAlign = 'left';
  ctx.fillText('Pass Rate', W - 165, 17);
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(W - 90, 8, 10, 10);
  ctx.fillStyle = '#e4e6ef'; ctx.fillText('Pass+Partial', W - 75, 17);
}

// ---------------------------------------------------------------------------
// Runs tab
// ---------------------------------------------------------------------------

function renderSidebar() {
  const grades = filteredGrades();
  els.sidebarList.innerHTML = '';
  if (!grades.length) {
    els.sidebarList.innerHTML = '<p class="subtle" style="padding:0.5rem">No matching runs.</p>';
    return;
  }
  for (const g of grades) {
    const item = make('div', `sidebar-item ${state.selectedRunId === g.runId ? 'selected' : ''}`);
    item.innerHTML = `
      <span class="sid-name" title="${esc(gradeLabel(g))}">${esc(g.runId)}</span>
      <span class="sidebar-badge ${g.success}">${g.success.toUpperCase()}</span>`;
    item.addEventListener('click', () => {
      state.selectedRunId = g.runId;
      renderRunsTab();
    });
    els.sidebarList.appendChild(item);
  }
}

function renderRunDetail() {
  const g = getGrades().find(g => g.runId === state.selectedRunId);
  if (!g) {
    els.runDetailEmpty.classList.remove('hidden');
    els.runDetailContent.classList.add('hidden');
    return;
  }
  els.runDetailEmpty.classList.add('hidden');
  els.runDetailContent.classList.remove('hidden');

  const m = g._meta || {};
  const t = g.transcript || {};
  const ap = g.agentPath || {};
  const sug = g.improvementSuggestions || {};

  let html = `
    <div class="detail-header">
      <h2>${esc(g.runId)} <span class="detail-badge ${g.success}">${g.success.toUpperCase()}</span></h2>
      <div class="detail-meta">
        <span>Scenario: <strong>${esc(SCENARIO_LABELS[m.scenario] || `S${m.scenario}`)}</strong></span>
        <span>Strategy: <strong>${esc(STRATEGY_LABELS[m.strategy] || m.strategy)}</strong></span>
        <span>Agent: <strong>${esc(AGENT_LABELS[m.agent] || m.agent)}</strong></span>
        <span>Duration: <strong>${t.durationSeconds ? Math.round(t.durationSeconds / 60) + 'min' : '—'}</strong></span>
        ${ap.timeoutReached ? '<span style="color:var(--fail)">⏱ Timeout reached</span>' : ''}
      </div>
    </div>`;

  // Meta cards
  html += '<div class="meta-grid">';
  html += `<div class="meta-card"><h4>Failure Category</h4><p>${esc(g.failureCategory || 'None (clean pass)')}</p></div>`;
  html += `<div class="meta-card"><h4>Readiness Pillar</h4><p>${esc(g.readinessPillar || '—')}</p></div>`;
  html += `<div class="meta-card"><h4>Root Cause</h4><p>${esc(g.rootCause || 'No failure')}</p></div>`;
  html += `<div class="meta-card"><h4>Iterations / Retries</h4><p>${ap.iterationCount ?? '—'} cycles</p></div>`;
  html += '</div>';

  // Stuck points
  if (ap.stuckPoints?.length) {
    html += '<div class="detail-section"><h3>Stuck Points</h3><ul>';
    for (const sp of ap.stuckPoints) html += `<li style="font-size:0.85rem;margin-bottom:0.25rem">${esc(sp)}</li>`;
    html += '</ul></div>';
  }

  // Agent reasoning
  if (t.reasoning?.length) {
    html += '<div class="detail-section"><h3>Agent Reasoning</h3><div class="timeline-list">';
    for (const r of t.reasoning) {
      html += `<div class="timeline-entry reasoning"><div class="tl-type reasoning">REASONING</div><div class="tl-text">${esc(r)}</div></div>`;
    }
    html += '</div></div>';
  }

  // Commands timeline
  if (t.commands?.length) {
    html += '<div class="detail-section"><h3>Commands & Output</h3><div class="timeline-list">';
    for (const c of t.commands) {
      const exitColor = c.exitCode === 0 ? 'var(--pass)' : 'var(--fail)';
      html += `<div class="timeline-entry cmd">
        <div class="tl-type cmd">$ ${esc(c.cmd)} <span style="color:${exitColor};font-size:0.7rem">[exit ${c.exitCode}]</span></div>
        <div class="tl-text">${esc(c.output || '')}</div>
      </div>`;
    }
    html += '</div></div>';
  }

  // Errors
  if (t.errors?.length) {
    html += '<div class="detail-section"><h3>Errors</h3><div class="timeline-list">';
    for (const e of t.errors) {
      html += `<div class="timeline-entry error"><div class="tl-type error">ERROR</div><div class="tl-text">${esc(e)}</div></div>`;
    }
    html += '</div></div>';
  }

  // Improvement suggestions
  const hasSuggestions = sug.docContent || sug.errorMessage || sug.sampleCode;
  if (hasSuggestions) {
    html += '<div class="detail-section"><h3>Improvement Suggestions</h3>';
    if (sug.docContent) html += `<div class="suggestion-card"><h4>📄 Documentation</h4><p>${esc(sug.docContent)}</p></div>`;
    if (sug.errorMessage) html += `<div class="suggestion-card"><h4>💬 Error Message</h4><p>${esc(sug.errorMessage)}</p></div>`;
    if (sug.sampleCode) html += `<div class="suggestion-card"><h4>💻 Sample Code</h4><p>${esc(sug.sampleCode)}</p></div>`;
    html += '</div>';
  }

  // Draft fix
  if (g.draftFix) {
    html += `<div class="detail-section"><h3>Draft Fix</h3><pre>${esc(g.draftFix)}</pre></div>`;
  }

  // Confidence
  html += `<p class="subtle" style="margin-top:1rem">Grading confidence: ${((g.confidenceScore || 0) * 100).toFixed(0)}% · Model: ${esc(m.model || '—')}</p>`;

  els.runDetailContent.innerHTML = html;
}

function renderRunsTab() {
  renderSidebar();
  renderRunDetail();
}

// ---------------------------------------------------------------------------
// Failure Taxonomy tab
// ---------------------------------------------------------------------------

function renderTaxonomy() {
  const grades = getGrades();
  const failures = grades.filter(g => g.success !== 'pass');

  // Group by pillar
  const pillarGroups = {};
  for (const p of ['Quality', 'Tools', 'Docs', 'Samples', 'Seams']) pillarGroups[p] = {};
  for (const g of failures) {
    const pillar = g.readinessPillar || 'Quality';
    const cat = g.failureCategory || 'Other';
    if (!pillarGroups[pillar]) pillarGroups[pillar] = {};
    pillarGroups[pillar][cat] = (pillarGroups[pillar][cat] || 0) + 1;
  }

  // Pillar chart
  els.pillarChart.innerHTML = '';
  for (const [pillar, cats] of Object.entries(pillarGroups)) {
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    const cls = PILLAR_CLASSES[pillar] || 'quality';
    let catHtml = '';
    for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      catHtml += `<div class="pillar-cat-row"><span class="pillar-cat-count" style="color:var(--fail)">${count}</span> ${esc(cat)}</div>`;
    }
    els.pillarChart.innerHTML += `
      <div class="pillar-section">
        <h3><span class="pillar-icon ${cls}">${PILLAR_ICONS[pillar]}</span> ${esc(pillar)} <span class="subtle">(${total} failure${total !== 1 ? 's' : ''})</span></h3>
        <div class="pillar-categories">${catHtml || '<span class="subtle">No failures in this pillar</span>'}</div>
      </div>`;
  }

  // Category frequency bars
  const catCounts = {};
  for (const g of failures) {
    const cat = g.failureCategory || 'Other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length ? sorted[0][1] : 1;
  els.categoryBars.innerHTML = '';
  for (const [cat, count] of sorted) {
    const pct = (count / maxCount) * 100;
    els.categoryBars.innerHTML += `
      <div class="bar-row">
        <span class="bar-label" title="${esc(cat)}">${esc(cat)}</span>
        <div class="bar-track"><div class="bar-seg fail" style="width:${pct}%"></div></div>
        <span class="bar-value">${count}</span>
      </div>`;
  }

  // Root causes
  const causeCounts = {};
  for (const g of failures) {
    const rc = g.rootCause || 'Unknown';
    if (!causeCounts[rc]) causeCounts[rc] = { count: 0, runs: [] };
    causeCounts[rc].count++;
    causeCounts[rc].runs.push(g.runId);
  }
  const sortedCauses = Object.entries(causeCounts).sort((a, b) => b[1].count - a[1].count);
  els.rootCauses.innerHTML = '';
  for (const [cause, data] of sortedCauses) {
    els.rootCauses.innerHTML += `
      <div class="root-cause">
        <div class="rc-header">
          <span class="rc-cause">${esc(cause)}</span>
          <span class="rc-count">×${data.count}</span>
        </div>
        <div class="rc-runs">Affected: ${data.runs.map(r => esc(r)).join(', ')}</div>
      </div>`;
  }

  // Proposed fixes
  const fixes = grades.filter(g => g.draftFix || g.improvementSuggestions?.docContent);
  els.proposedFixes.innerHTML = '';
  if (!fixes.length) {
    els.proposedFixes.innerHTML = '<p class="subtle">No proposed fixes in this run.</p>';
    return;
  }
  for (const g of fixes) {
    const sug = g.improvementSuggestions || {};
    let html = `<div class="fix-card">`;
    html += `<div class="fix-type">${esc(g.failureCategory || g.readinessPillar || 'General')}</div>`;
    html += `<h3>${esc(g.runId)}: ${esc(g.rootCause || 'Improvement')}</h3>`;
    if (sug.docContent) html += `<p><strong>Doc fix:</strong> ${esc(sug.docContent)}</p>`;
    if (sug.errorMessage) html += `<p><strong>Error message:</strong> ${esc(sug.errorMessage)}</p>`;
    if (sug.sampleCode) html += `<p><strong>Sample code:</strong> ${esc(sug.sampleCode)}</p>`;
    if (g.draftFix) html += `<pre>${esc(g.draftFix)}</pre>`;
    html += '</div>';
    els.proposedFixes.innerHTML += html;
  }
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(tabName) {
  state.tab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
    p.classList.toggle('hidden', p.id !== `tab-${tabName}`);
  });
  if (tabName === 'runs') renderRunsTab();
  if (tabName === 'taxonomy') renderTaxonomy();
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

function render() {
  els.runMeta.textContent = `${state.data.date} · ${state.data.scorecard.total} runs · ${state.data.scorecard.pass} pass, ${state.data.scorecard.partial} partial, ${state.data.scorecard.fail} fail`;
  renderHero();
  renderScorecard();
  renderReadiness();
  renderBreakdowns();
  renderTrend();
  if (state.tab === 'runs') renderRunsTab();
  if (state.tab === 'taxonomy') renderTaxonomy();
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

function showLanding() {
  state.data = null;
  els.landing.classList.remove('hidden');
  els.runPage.classList.add('hidden');
  els.btnBack.classList.add('hidden');
  els.runSelector.classList.add('hidden');
  els.runMeta.textContent = 'Select a run';
  renderRunList();
}

function renderRunList() {
  els.runList.innerHTML = '';
  if (!state.runs.length) {
    els.runList.innerHTML = '<p class="subtle">No runs available yet. Data will appear after the first nightly run.</p>';
    return;
  }
  for (const run of state.runs) {
    const card = make('button', 'run-card');
    card.type = 'button';
    const sc = run.scorecard || {};
    card.innerHTML = `
      <div class="run-card-top">
        <h3>${esc(run.label || run.date)}</h3>
        <span class="sidebar-badge ${sc.pass > sc.fail ? 'pass' : 'fail'}">${sc.total || 0} runs</span>
      </div>
      <div class="run-card-stats">
        <span class="run-stat pass">${sc.pass || 0} pass</span>
        <span class="run-stat partial">${sc.partial || 0} partial</span>
        <span class="run-stat fail">${sc.fail || 0} fail</span>
      </div>`;
    card.addEventListener('click', () => loadRun(run.file));
    els.runList.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Load a run
// ---------------------------------------------------------------------------

async function loadRun(file) {
  els.runMeta.textContent = 'Loading…';
  const resp = await fetch(`./data/${file}`);
  state.data = await resp.json();

  // Select first run by default
  if (getGrades().length && !state.selectedRunId) {
    state.selectedRunId = getGrades()[0].runId;
  }

  els.landing.classList.add('hidden');
  els.runPage.classList.remove('hidden');
  els.btnBack.classList.remove('hidden');
  els.runSelector.classList.remove('hidden');

  // Populate selector
  els.runSelector.innerHTML = '';
  for (const run of state.runs) {
    const opt = document.createElement('option');
    opt.value = run.file;
    opt.textContent = run.label || run.date;
    opt.selected = run.file === file;
    els.runSelector.appendChild(opt);
  }

  render();
}

// ---------------------------------------------------------------------------
// Load all runs for trend
// ---------------------------------------------------------------------------

async function loadAllRuns() {
  state.allData = [];
  for (const run of state.runs) {
    try {
      const resp = await fetch(`./data/${run.file}`);
      const data = await resp.json();
      state.allData.push(data);
    } catch (e) {
      console.warn(`Failed to load ${run.file}:`, e);
    }
  }
  // Sort by date
  state.allData.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // Back
  els.btnBack.addEventListener('click', showLanding);

  // Run selector
  els.runSelector.addEventListener('change', (e) => loadRun(e.target.value));

  // Run search/filter
  els.runSearch.addEventListener('input', (e) => {
    state.searchFilter = e.target.value.trim();
    renderRunsTab();
  });
  els.runOutcomeFilter.addEventListener('change', (e) => {
    state.outcomeFilter = e.target.value;
    renderRunsTab();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  bindEvents();

  const resp = await fetch('./data/runs.json');
  state.runs = await resp.json();

  await loadAllRuns();

  const params = new URLSearchParams(window.location.search);
  const directFile = params.get('run');
  if (directFile && state.runs.some(r => r.file === directFile)) {
    await loadRun(directFile);
  } else if (state.runs.length === 1) {
    await loadRun(state.runs[0].file);
  } else {
    showLanding();
  }
}

init().catch(err => {
  els.runMeta.textContent = `Failed to load: ${err.message}`;
  console.error(err);
});
