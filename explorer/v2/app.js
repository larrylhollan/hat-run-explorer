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
  const cc = state.data?.cellClassification || {};
  const harnessLimitedSet = new Set(cc.harnessLimitedCellIds || []);

  return getGrades().filter(g => {
    const text = [g.runId, gradeLabel(g), g.rootCause, g.failureCategory, g.failureCategoryDetail].join(' ').toLowerCase();
    const searchOk = !state.searchFilter || text.includes(state.searchFilter.toLowerCase());
    let outcomeOk;
    if (state.outcomeFilter === 'all') {
      outcomeOk = true;
    } else if (state.outcomeFilter === 'harness') {
      outcomeOk = harnessLimitedSet.has(g.runId) || getBucketForGrade(g) === 'harness';
    } else if (state.outcomeFilter === 'platform') {
      outcomeOk = !harnessLimitedSet.has(g.runId) && g.success !== 'pass' && getBucketForGrade(g) !== 'harness';
    } else if (state.outcomeFilter.startsWith('bucket:')) {
      const targetBucket = state.outcomeFilter.slice(7);
      outcomeOk = getBucketForGrade(g) === targetBucket;
    } else {
      outcomeOk = g.success === state.outcomeFilter;
    }
    return searchOk && outcomeOk;
  });
}

// ---------------------------------------------------------------------------
// Harness-limitation banner
// ---------------------------------------------------------------------------

function renderHarnessBanner() {
  const cc = state.data?.cellClassification || {};
  const harnessLimited = cc.harnessLimitedCount ?? 0;
  const total = cc.totalCells ?? (state.data?.scorecard?.total || 0);
  const platformTestable = cc.platformTestableRuns ?? total;
  const banner = $('harness-banner');
  if (!banner) return;

  if (harnessLimited > 0) {
    const ids = cc.harnessLimitedCellIds || [];
    // Determine agent breakdown of harness-limited
    const grades = getGrades();
    const limitedByAgent = {};
    for (const id of ids) {
      const g = grades.find(g => g.runId === id);
      if (g) {
        const agent = g._meta?.agent || 'unknown';
        limitedByAgent[agent] = (limitedByAgent[agent] || 0) + 1;
      }
    }
    const agentParts = Object.entries(limitedByAgent).map(([a, n]) => `${AGENT_LABELS[a] || a}: ${n}`).join(', ');

    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="banner-icon">⚠️</div>
      <div class="banner-content">
        <strong>Harness Limitation Notice:</strong>
        ${harnessLimited}/${total} cells are harness-limited (${agentParts}) — platform readiness score based on ${platformTestable} testable cells only.
        <span class="banner-detail">Harness-limited cells are shown with ⚠ striping in the scorecard matrix.</span>
      </div>`;
  } else {
    banner.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// 4-Bucket failure classification hero
// ---------------------------------------------------------------------------

const BUCKET_CONFIG = {
  product: { icon: '🏗️', label: 'Product Issues', desc: 'Needs Azure team fix', color: 'var(--fail)' },
  docs: { icon: '📄', label: 'Docs Gaps', desc: 'Needs content', color: 'var(--partial)' },
  skills: { icon: '🔌', label: 'Skills Gaps', desc: 'Needs plugin update', color: '#a78bfa' },
  harness: { icon: '🔧', label: 'Harness Bugs', desc: 'Our infra, being fixed', color: 'var(--text-dim)' },
};

function getBucketData() {
  const grades = getGrades();
  const buckets = { product: [], docs: [], skills: [], harness: [], pass: [] };

  for (const g of grades) {
    if (g.success === 'pass') {
      buckets.pass.push(g);
      continue;
    }
    // Get bucket from failureInfo.bucket or cellClassification fallback
    const bucket = g.failureInfo?.bucket || inferBucket(g);
    if (buckets[bucket]) {
      buckets[bucket].push(g);
    } else {
      // Unknown bucket → product as default for non-pass
      buckets.product.push(g);
    }
  }
  return buckets;
}

function inferBucket(g) {
  // Fallback inference from existing data when failureInfo.bucket is not yet available
  const cc = state.data?.cellClassification || {};
  const harnessSet = new Set(cc.harnessLimitedCellIds || []);

  if (harnessSet.has(g.runId)) return 'harness';

  // Try to classify from rootCause / failureCategory
  const rc = (g.rootCause || '').toLowerCase();
  const fc = (g.failureCategory || '').toLowerCase();
  const combined = rc + ' ' + fc;

  // Harness patterns
  if (combined.includes('timeout') && combined.includes('copilot')) return 'harness';
  if (combined.includes('tmux') || combined.includes('runner') || combined.includes('idle')) return 'harness';
  if (combined.includes('trust prompt') || combined.includes('prompt injection')) return 'harness';
  if (combined.includes('mcp') && combined.includes('install')) return 'harness';

  // Product patterns
  if (combined.includes('rbac') || combined.includes('permission') || combined.includes('quota')) return 'product';
  if (combined.includes('azure') && (combined.includes('error') || combined.includes('500') || combined.includes('4xx'))) return 'product';
  if (combined.includes('deploy') && combined.includes('fail')) return 'product';
  if (combined.includes('provision') && combined.includes('fail')) return 'product';

  // Skills patterns
  if (combined.includes('skill') && !combined.includes('install')) return 'skills';
  if (combined.includes('plugin') && combined.includes('gap')) return 'skills';

  // Docs patterns (default for non-pass with no other signal)
  if (combined.includes('doc') || combined.includes('unclear') || combined.includes('not found')) return 'docs';
  if (combined.includes('wrong approach') || combined.includes('concept')) return 'docs';

  // Final fallback: check pillar
  const pillar = (g.readinessPillar || '').toLowerCase();
  if (pillar === 'docs' || pillar === 'samples') return 'docs';
  if (pillar === 'tools') return 'product';
  if (pillar === 'seams') return 'product';

  return 'docs'; // safe default
}

function renderBucketHero() {
  const bucketEl = $('bucket-hero');
  if (!bucketEl) return;

  const grades = getGrades();
  if (!grades.length) {
    bucketEl.classList.add('hidden');
    return;
  }

  const buckets = getBucketData();
  const total = grades.length;
  const passCount = buckets.pass.length;

  // Platform score (excludes harness)
  const platformTestable = total - buckets.harness.length;
  const platformPass = passCount;
  const platformScore = platformTestable > 0 ? Math.round((platformPass / platformTestable) * 100) : 0;

  // Agent breakdown
  const claudeGrades = grades.filter(g => g._meta?.agent === 'claude');
  const copilotGrades = grades.filter(g => g._meta?.agent === 'copilot');
  const claudePass = claudeGrades.filter(g => g.success === 'pass').length;
  const copilotPass = copilotGrades.filter(g => g.success === 'pass').length;
  const copilotHarness = copilotGrades.filter(g => {
    const b = g.failureInfo?.bucket || inferBucket(g);
    return b === 'harness';
  }).length;
  const copilotStatus = copilotHarness > copilotGrades.length * 0.7
    ? 'pending fix'
    : `${Math.round((copilotPass / (copilotGrades.length || 1)) * 100)}%`;

  bucketEl.classList.remove('hidden');

  let html = `
    <div class="bucket-platform-score">
      <div class="bps-score" style="color:${platformScore >= 70 ? 'var(--pass)' : platformScore >= 40 ? 'var(--partial)' : 'var(--fail)'}">
        ${platformScore}/100
      </div>
      <div class="bps-label">Platform Score <span class="bps-note">(excludes harness bugs)</span></div>
      <div class="bps-agents">
        Claude: ${Math.round((claudePass / (claudeGrades.length || 1)) * 100)}% | Copilot: ${copilotStatus}
      </div>
    </div>
    <div class="bucket-cards">`;

  // Render each bucket
  for (const [key, config] of Object.entries(BUCKET_CONFIG)) {
    const cells = buckets[key];
    const count = cells.length;
    html += `
      <div class="bucket-card" data-bucket="${key}">
        <div class="bucket-card-icon">${config.icon}</div>
        <div class="bucket-card-count" style="color:${config.color}">${count} cells</div>
        <div class="bucket-card-label">${config.label}</div>
        <div class="bucket-card-desc">${config.desc}</div>
      </div>`;
  }

  // Pass bucket
  html += `
      <div class="bucket-card bucket-pass" data-bucket="pass">
        <div class="bucket-card-icon">✅</div>
        <div class="bucket-card-count" style="color:var(--pass)">${passCount} cells</div>
        <div class="bucket-card-label">Passing</div>
        <div class="bucket-card-desc">End-to-end success</div>
      </div>`;

  html += '</div>';

  // Ship-today verdict
  const productCount = buckets.product.length;
  const docsCount = buckets.docs.length;
  html += `
    <div class="bucket-verdict">
      <strong>Ship-today verdict:</strong>
      Platform readiness: ${platformScore}/100.
      ${productCount} product bug${productCount !== 1 ? 's' : ''} + ${docsCount} doc gap${docsCount !== 1 ? 's' : ''} blocking.
      ${copilotHarness > 0 ? `Copilot ${copilotStatus === 'pending fix' ? 'untested (harness fix deploying)' : copilotStatus + ' pass rate'}.` : ''}
    </div>`;

  bucketEl.innerHTML = html;

  // Bind click handlers for bucket drill-down
  bucketEl.querySelectorAll('.bucket-card[data-bucket]').forEach(card => {
    card.addEventListener('click', () => {
      const bucket = card.dataset.bucket;
      showBucketDrillDown(bucket);
    });
  });
}

function showBucketDrillDown(bucket) {
  // Switch to runs tab with the bucket filter active
  state.outcomeFilter = `bucket:${bucket}`;
  els.runOutcomeFilter.value = `bucket:${bucket}`;
  switchTab('runs');
}

function getBucketForGrade(g) {
  if (g.success === 'pass') return 'pass';
  return g.failureInfo?.bucket || inferBucket(g);
}

// ---------------------------------------------------------------------------
// Hero cards
// ---------------------------------------------------------------------------

function renderHero() {
  const sc = state.data?.scorecard || { total: 0, pass: 0, partial: 0, fail: 0 };
  const rate = sc.total ? Math.round((sc.pass / sc.total) * 100) : 0;
  const passPartialRate = sc.total ? Math.round(((sc.pass + sc.partial) / sc.total) * 100) : 0;

  // If we have grades to do bucket analysis, the bucket hero replaces the old cards
  const grades = getGrades();
  if (grades.length > 0) {
    els.heroCards.classList.add('hidden');
    renderBucketHero();
    return;
  }

  // Legacy hero cards when no grade data available
  els.heroCards.classList.remove('hidden');
  $('bucket-hero')?.classList.add('hidden');
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
  const cc = state.data?.cellClassification || {};
  const harnessLimitedSet = new Set(cc.harnessLimitedCellIds || []);

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
        const isHarnessLimited = harnessLimitedSet.has(g.runId);
        let cls, label, title;
        if (isHarnessLimited) {
          cls = 'cell-harness';
          label = '⚠ HARNESS';
          title = 'Harness-limited: agent never received the task (not a platform failure)';
        } else {
          cls = `cell-${g.success}`;
          label = g.success.toUpperCase();
          title = g.rootCause || 'Clean pass';
        }
        html += `<td class="${cls}" data-run-id="${esc(g.runId)}" title="${esc(title)}">${label}</td>`;
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
  const cc = state.data?.cellClassification || {};
  const total = sc.total || 1;

  // Platform readiness score (from cellClassification if available)
  const platformScore = cc.platformReadinessScore ?? null;
  const platformTestable = cc.platformTestableRuns ?? total;
  const platformPassRate = cc.platformPassRate ?? null;
  const harnessOpPct = cc.harnessOperationalPct ?? 100;
  const harnessLimited = cc.harnessLimitedCount ?? 0;

  // Fallback combined score
  const combinedScore = Math.round(((sc.pass || 0) + (sc.partial || 0) * 0.5) / total * 100);

  // If we have platform/harness separation, show dual scores
  if (platformScore !== null && harnessLimited > 0) {
    const platformColor = platformScore >= 70 ? 'var(--pass)' : platformScore >= 40 ? 'var(--partial)' : 'var(--fail)';
    const harnessColor = harnessOpPct >= 80 ? 'var(--pass)' : harnessOpPct >= 50 ? 'var(--partial)' : 'var(--fail)';

    els.readinessGauge.innerHTML = `
      <div class="dual-readiness">
        <div class="readiness-block">
          <div class="gauge-score" style="color:${platformColor}">${platformScore}/100</div>
          <div class="gauge-label">Platform GA Readiness</div>
          <div class="gauge-sublabel">${platformPassRate}% pass (${platformTestable} testable cells)</div>
        </div>
        <div class="readiness-divider"></div>
        <div class="readiness-block">
          <div class="gauge-score harness" style="color:${harnessColor}">${harnessOpPct}%</div>
          <div class="gauge-label">Harness Operational</div>
          <div class="gauge-sublabel">${harnessLimited}/${total} cells harness-limited</div>
        </div>
      </div>`;
  } else {
    // Legacy single score
    const color = combinedScore >= 70 ? 'var(--pass)' : combinedScore >= 40 ? 'var(--partial)' : 'var(--fail)';
    els.readinessGauge.innerHTML = `
      <div class="gauge-score" style="color:${color}">${combinedScore}%</div>
      <div class="gauge-label">GA Readiness Score</div>
    `;
  }

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
  const cc = state.data?.cellClassification || {};
  const harnessLimitedSet = new Set(cc.harnessLimitedCellIds || []);

  els.sidebarList.innerHTML = '';
  if (!grades.length) {
    els.sidebarList.innerHTML = '<p class="subtle" style="padding:0.5rem">No matching runs.</p>';
    return;
  }
  for (const g of grades) {
    const bucket = getBucketForGrade(g);
    const item = make('div', `sidebar-item ${state.selectedRunId === g.runId ? 'selected' : ''}`);
    let badgeCls, badgeText;
    if (g.success === 'pass') {
      badgeCls = 'pass';
      badgeText = 'PASS';
    } else {
      const conf = BUCKET_CONFIG[bucket];
      if (conf) {
        badgeCls = `bucket-${bucket}`;
        badgeText = `${conf.icon} ${bucket.toUpperCase()}`;
      } else {
        badgeCls = g.success;
        badgeText = g.success.toUpperCase();
      }
    }
    item.innerHTML = `
      <span class="sid-name" title="${esc(gradeLabel(g))}">${esc(g.runId)}</span>
      <span class="sidebar-badge ${badgeCls}">${badgeText}</span>`;
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
  const fi = g.failureInfo || {};
  const bucket = getBucketForGrade(g);
  const bucketConf = BUCKET_CONFIG[bucket] || { icon: '✅', label: 'Passing', color: 'var(--pass)' };

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

  // Bucket classification card (prominent)
  if (g.success !== 'pass') {
    html += `
    <div class="bucket-classification-card" style="border-left-color:${bucketConf.color}">
      <div class="bcc-header">
        <span class="bcc-icon">${bucketConf.icon}</span>
        <span class="bcc-bucket" style="color:${bucketConf.color}">${bucketConf.label}</span>
      </div>`;
    if (fi.whatItTried) {
      html += `<div class="bcc-row"><strong>What it tried:</strong> ${esc(fi.whatItTried)}</div>`;
    }
    if (fi.whyItFailed) {
      html += `<div class="bcc-row"><strong>Why it failed:</strong> ${esc(fi.whyItFailed)}</div>`;
    }
    if (fi.whatWouldFix) {
      html += `<div class="bcc-row"><strong>What would fix it:</strong> ${esc(fi.whatWouldFix)}</div>`;
    }
    if (fi.evidenceQuote) {
      html += `<div class="bcc-evidence"><code>${esc(fi.evidenceQuote)}</code></div>`;
    }
    // Fallback evidence from existing fields
    if (!fi.whyItFailed && g.rootCause) {
      html += `<div class="bcc-row"><strong>Root cause:</strong> ${esc(g.rootCause)}</div>`;
    }
    if (!fi.whatItTried && g.failureCategory) {
      html += `<div class="bcc-row"><strong>Category:</strong> ${esc(g.failureCategory)}</div>`;
    }
    html += '</div>';
  }

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
  renderHarnessBanner();
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
