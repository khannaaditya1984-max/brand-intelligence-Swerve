/* ═══════════════════════════════════════════════════════════
   app.js — Main controller: setup, pipeline, navigation
   ═══════════════════════════════════════════════════════════ */

/* ── SCREEN HELPERS ── */
function showScreen(id) {
  ['setup-screen', 'pipeline-screen', 'report-screen'].forEach(function(s) {
    var el = document.getElementById(s);
    if (!el) return;
    if (s === id) {
      el.style.display = (s === 'report-screen') ? 'block' : 'flex';
    } else {
      el.style.display = 'none';
    }
  });
}

/* ── SETUP: COMPETITOR CHIPS ── */
function addCompetitor() {
  var input = document.getElementById('comp-input');
  var v = input.value.trim();
  if (!v || STATE.competitors.includes(v) || STATE.competitors.length >= 5) return;
  STATE.competitors.push(v);
  input.value = '';
  renderChips();
  console.log('[DEBUG] competitors now:', JSON.stringify(STATE.competitors));
}

function removeCompetitor(c) {
  STATE.competitors = STATE.competitors.filter(function(x) { return x !== c; });
  renderChips();
}

function renderChips() {
  document.getElementById('chips').innerHTML = STATE.competitors.map(function(c) {
    return (
      '<div class="chip">' + esc(c) +
      '<span class="chip-x" onclick="removeCompetitor(\'' + c.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">&times;</span>' +
      '</div>'
    );
  }).join('');
}

function showSetupError(msg) {
  var el = document.getElementById('setup-error');
  el.style.display = 'block';
  el.textContent = msg;
}

/* ── PIPELINE CARDS ── */
var AGENT_DEFS = [
  { id: 'a0', num: '01', icon: '🔍', name: 'Field Operative',   role: 'Live Web + Social Search' },
  { id: 'a1', num: '02', icon: '🧠', name: 'Sentiment Analyst',  role: 'Scoring · Share of Voice' },
  { id: 'a2', num: '03', icon: '📋', name: 'Bureau Chief',       role: 'Report Synthesis · PDF'   }
];

function renderPipelineCards() {
  document.getElementById('pipeline-agents').innerHTML = AGENT_DEFS.map(function(a, i) {
    return (
      '<div class="agent-card" id="' + a.id + '">' +
        '<div class="status-dot"></div>' +
        '<div class="agent-num">AGENT ' + a.num + '</div>' +
        '<div class="agent-icon">' + a.icon + '</div>' +
        '<div class="agent-name">' + a.name + '</div>' +
        '<div class="agent-role">' + a.role + '</div>' +
        '<div class="agent-log" id="log-' + a.id + '"></div>' +
      '</div>' +
      (i < 2 ? '<div class="connector">→</div>' : '')
    );
  }).join('');
}

function setAgentState(idx, state) {
  var el = document.getElementById(AGENT_DEFS[idx].id);
  if (el) el.className = 'agent-card ' + state;
}

function addLog(idx, msg) {
  var el = document.getElementById('log-' + AGENT_DEFS[idx].id);
  if (!el) return;
  var div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = '<span class="log-arrow">↳</span><span>' + esc(msg) + '</span>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

/* ── PIPELINE ORCHESTRATION ── */
async function startPipeline() {
  var brand  = document.getElementById('brand-input').value.trim();

  if (!brand)  { showSetupError('Please enter a brand name.');            return; }

  var apiKey = (document.getElementById('api-key-input') || {value:''}).value.trim();
  if (!apiKey) { showSetupError('Please enter your Anthropic API key.'); return; }
  window.ANTHROPIC_KEY = apiKey;

  STATE.brand    = brand;
  STATE.mentions = [];
  STATE.analysis = null;
  STATE.report   = null;

  document.getElementById('setup-error').style.display = 'none';
  document.getElementById('btn-run').disabled = true;

  showScreen('pipeline-screen');
  renderPipelineCards();
  document.getElementById('pipeline-title').textContent = 'Agents working…';

  try {
    console.log('[DEBUG] brand:', STATE.brand);
    console.log('[DEBUG] competitors:', JSON.stringify(STATE.competitors));
    console.log('[DEBUG] competitors length:', STATE.competitors.length);
    setAgentState(0, 'active');
    STATE.mentions = await agentScrape(STATE.brand, STATE.competitors, function(m) { addLog(0, m); });
    setAgentState(0, 'done');

    setAgentState(1, 'active');
    STATE.analysis = await agentSentiment(STATE.brand, STATE.competitors, STATE.mentions, function(m) { addLog(1, m); });
    setAgentState(1, 'done');

    setAgentState(2, 'active');
    STATE.report = await agentReport(STATE.brand, STATE.competitors, STATE.mentions, STATE.analysis, function(m) { addLog(2, m); });
    setAgentState(2, 'done');

    document.getElementById('pipeline-title').textContent = '✓ Report ready';
    setTimeout(function() {
      showScreen('report-screen');
      renderReport();
    }, 900);

  } catch (err) {
    console.error('[Pipeline error]', err);
    AGENT_DEFS.forEach(function(a, i) {
      var el = document.getElementById(a.id);
      if (el && el.classList.contains('active')) setAgentState(i, 'error');
    });
    document.getElementById('pipeline-title').textContent = '⚠ ' + (err.message || 'Pipeline failed. See browser console.');
    document.getElementById('btn-run').disabled = false;
  }
}

/* ── RESET ── */
function resetToSetup() {
  Object.keys(CHARTS).forEach(function(k) {
    try { CHARTS[k].destroy(); } catch(e) {}
    delete CHARTS[k];
  });

  window.ANTHROPIC_KEY = '';
  STATE.brand       = '';
  STATE.competitors = [];
  STATE.mentions    = [];
  STATE.analysis    = null;
  STATE.report      = null;

  document.getElementById('brand-input').value = '';
  document.getElementById('comp-input').value  = '';
  document.getElementById('chips').innerHTML   = '';
  document.getElementById('btn-run').disabled  = false;
  document.getElementById('setup-error').style.display = 'none';
  document.getElementById('report-body').innerHTML = '';

  showScreen('setup-screen');
}

/* ── EVENT WIRING ── */
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('brand-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('comp-input').focus();
  });
  document.getElementById('comp-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addCompetitor();
  });
  document.getElementById('btn-add-comp').addEventListener('click', addCompetitor);
  document.getElementById('btn-run').addEventListener('click', startPipeline);
  document.getElementById('btn-new').addEventListener('click', resetToSetup);
  document.getElementById('btn-download').addEventListener('click', downloadPDF);

  /* Start on setup screen */
  showScreen('setup-screen');
});
