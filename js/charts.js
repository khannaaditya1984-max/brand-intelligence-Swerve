/* ═══════════════════════════════════════════════════════════
   charts.js — Chart.js rendering
   ═══════════════════════════════════════════════════════════ */

var CHARTS = {};

function drawCharts() {
  var analysis = STATE.analysis || {};
  var sov = (analysis.share_of_voice || []);
  var sb  = (analysis.sentiment_breakdown || {});
  var cs  = (analysis.channel_split || { web: 0, social: 0 });

  drawSOVDonut(sov);
  drawSOVBars(sov);
  drawSentimentBars(sb);
  drawChannelDonut(cs);
}

function destroyChart(key) {
  if (CHARTS[key]) {
    try { CHARTS[key].destroy(); } catch(e) {}
    delete CHARTS[key];
  }
}

/* SoV donut */
function drawSOVDonut(sov) {
  var el = document.getElementById('chart-sov');
  if (!el || !sov.length) return;
  destroyChart('sov');

  CHARTS.sov = new Chart(el, {
    type: 'doughnut',
    data: {
      labels:   sov.map(function(s) { return s.brand; }),
      datasets: [{
        data:            sov.map(function(s) { return s.percent; }),
        backgroundColor: sov.map(function(s, i) { return colorForBrand(s.brand, i); }),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(c) { return c.label + ': ' + c.parsed.toFixed(1) + '%'; }
          }
        }
      }
    }
  });

  var leg = document.getElementById('leg-sov');
  if (leg) {
    leg.innerHTML = sov.map(function(s, i) {
      return (
        '<div class="dl-row">' +
          '<div class="dl-dot" style="background:' + colorForBrand(s.brand, i) + '"></div>' +
          '<div class="dl-name">' + esc(s.brand) + '</div>' +
          '<div class="dl-val">'  + s.mention_count + '</div>' +
          '<div class="dl-pct">'  + s.percent.toFixed(1) + '%</div>' +
        '</div>'
      );
    }).join('');
  }
}

/* SoV bar chart (custom HTML) */
function drawSOVBars(sov) {
  var el = document.getElementById('sov-bars');
  if (!el || !sov.length) return;

  var maxV = Math.max.apply(null, sov.map(function(s) { return s.mention_count; })) || 1;

  el.innerHTML = sov.map(function(s, i) {
    var pct = (s.mention_count / maxV) * 100;
    return (
      '<div class="bar-row">' +
        '<div class="bar-label">' + esc(s.brand.length > 11 ? s.brand.slice(0, 11) + '…' : s.brand) + '</div>' +
        '<div class="bar-track">' +
          '<div class="bar-fill" style="width:' + pct + '%;background:' + colorForBrand(s.brand, i) + '">' +
            '<span class="bar-val">' + s.mention_count + '</span>' +
          '</div>' +
          '<span class="bar-val-out">' + s.percent.toFixed(1) + '%</span>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* Stacked sentiment bar per brand */
function drawSentimentBars(sb) {
  var el = document.getElementById('chart-sent-bar');
  if (!el) return;
  destroyChart('sent');

  var brands = Object.keys(sb).filter(function(b) {
    var v = sb[b];
    return (v.positive || 0) + (v.neutral || 0) + (v.negative || 0) > 0;
  });
  if (!brands.length) return;

  CHARTS.sent = new Chart(el, {
    type: 'bar',
    data: {
      labels: brands.map(function(b) { return b.length > 10 ? b.slice(0, 10) + '…' : b; }),
      datasets: [
        { label: 'Positive', data: brands.map(function(b) { return sb[b].positive || 0; }), backgroundColor: '#10b981' },
        { label: 'Neutral',  data: brands.map(function(b) { return sb[b].neutral  || 0; }), backgroundColor: '#f59e0b' },
        { label: 'Negative', data: brands.map(function(b) { return sb[b].negative || 0; }), backgroundColor: '#ef4444' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
      }
    }
  });
}

/* Channel donut */
function drawChannelDonut(cs) {
  var el = document.getElementById('chart-chan');
  if (!el) return;
  destroyChart('chan');

  var w = cs.web || 0, s = cs.social || 0;

  CHARTS.chan = new Chart(el, {
    type: 'doughnut',
    data: {
      labels: ['Web', 'Social'],
      datasets: [{ data: [w, s], backgroundColor: ['#1e4db7', '#8b5cf6'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { display: false } }
    }
  });

  var leg = document.getElementById('leg-chan');
  if (leg) {
    var total = (w + s) || 1;
    leg.innerHTML = [['Web', w, '#1e4db7'], ['Social', s, '#8b5cf6']].map(function(item) {
      return (
        '<div class="dl-row">' +
          '<div class="dl-dot" style="background:' + item[2] + '"></div>' +
          '<div class="dl-name">' + item[0] + '</div>' +
          '<div class="dl-val">'  + item[1] + '</div>' +
          '<div class="dl-pct">'  + ((item[1] / total) * 100).toFixed(1) + '%</div>' +
        '</div>'
      );
    }).join('');
  }
}
