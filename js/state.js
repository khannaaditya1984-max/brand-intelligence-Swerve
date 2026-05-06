/* ═══════════════════════════════════════════════════════════
   state.js — Shared state, constants, utilities
   ═══════════════════════════════════════════════════════════ */

var STATE = {
  brand:       '',
  competitors: [],
  mentions:    [],
  analysis:    null,
  report:      null
};

var BRAND_COLORS = [
  '#1e4db7','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1'
];

var MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

/* Return the color assigned to a brand */
function colorForBrand(brand, fallbackIdx) {
  var all = [STATE.brand].concat(STATE.competitors);
  var idx = all.findIndex(function(b) { return b.toLowerCase() === brand.toLowerCase(); });
  return BRAND_COLORS[(idx >= 0 ? idx : (fallbackIdx || 0)) % BRAND_COLORS.length];
}

/* Get sentiment breakdown for a brand */
function getPrimaryBreakdown(brand) {
  var sb = (STATE.analysis && STATE.analysis.sentiment_breakdown) ? STATE.analysis.sentiment_breakdown : {};
  var key = Object.keys(sb).find(function(k) { return k.toLowerCase() === brand.toLowerCase(); });
  return key ? sb[key] : Object.values(sb)[0];
}

/* Safe HTML escape */
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/* Robust JSON extractor — handles prose wrapping, partial arrays, fences */
function safeParse(txt, fallback, expectArr) {
  if (!txt) return fallback;
  var c = txt.replace(/```json|```/g, '').trim();
  var so = c.indexOf('{'), sa = c.indexOf('[');
  var first = so === -1 ? sa : sa === -1 ? so : expectArr ? (sa !== -1 ? sa : so) : Math.min(so, sa);
  if (first === -1) return fallback;

  var op = c[first], cl = op === '{' ? '}' : ']';
  var depth = 0, inStr = false, esc2 = false, end = -1;
  for (var i = first; i < c.length; i++) {
    var ch = c[i];
    if (esc2)   { esc2 = false; continue; }
    if (ch === '\\') { esc2 = true; continue; }
    if (ch === '"')  { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === op) depth++;
    else if (ch === cl) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end !== -1) {
    try { return JSON.parse(c.slice(first, end + 1)); } catch (e) { /* fall through */ }
  }

  /* Array recovery — grab individual {...} objects even from truncated response */
  if (op === '[') {
    var items = [], ii = first + 1;
    while (ii < c.length) {
      while (ii < c.length && c[ii] !== '{') ii++;
      if (ii >= c.length) break;
      var os = ii, d = 0, s = false, e2 = false, oe = -1;
      for (var j = ii; j < c.length; j++) {
        var cc = c[j];
        if (e2) { e2 = false; continue; }
        if (cc === '\\') { e2 = true; continue; }
        if (cc === '"') { s = !s; continue; }
        if (s) continue;
        if (cc === '{') d++;
        else if (cc === '}') { d--; if (d === 0) { oe = j; break; } }
      }
      if (oe === -1) break;
      try { items.push(JSON.parse(c.slice(os, oe + 1))); } catch (_) {}
      ii = oe + 1;
    }
    if (items.length > 0) return items;
  }

  console.error('[safeParse] failed on:', txt.slice(0, 400));
  return fallback;
}

/* Extract text content blocks from a Claude API response */
function extractText(data) {
  return ((data && data.content) ? data.content : [])
    .filter(function(b) { return b.type === 'text'; })
    .map(function(b) { return b.text; })
    .join('\n');
}

/* Today's date formatted for display */
function todayFormatted() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* Last N calendar months from today */
function lastNMonths(n) {
  var d = new Date(), out = [];
  for (var i = n - 1; i >= 0; i--) {
    var idx = ((d.getMonth() - i) + 12) % 12;
    out.push(MONTH_NAMES[idx]);
  }
  return out;
}

/* Current period label e.g. "May 2026" */
function currentPeriodLabel() {
  var d = new Date();
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}
