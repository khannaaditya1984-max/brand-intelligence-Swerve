/* ═══════════════════════════════════════════════════════════
   render.js — Report DOM rendering
   ═══════════════════════════════════════════════════════════ */

function renderReport() {
  var brand       = STATE.brand;
  var competitors = STATE.competitors;
  var mentions    = STATE.mentions;
  var analysis    = STATE.analysis;
  var report      = STATE.report;

  var sov    = (analysis && analysis.share_of_voice) ? analysis.share_of_voice : [];
  var priSov = sov.find(function(s) { return s.brand && s.brand.toLowerCase() === brand.toLowerCase(); });
  var pb     = getPrimaryBreakdown(brand) || {};
  var today  = todayFormatted();

  /* Header */
  document.getElementById('rh-brand').textContent     = brand;
  document.getElementById('rh-period').textContent    = 'Current Intelligence · ' + today;
  document.getElementById('rh-competitors').textContent = competitors.length
    ? 'Benchmarked vs: ' + competitors.join(' · ')
    : '';

  document.getElementById('rh-right').innerHTML =
    '<div class="rh-stat"><div class="rh-stat-v">' + mentions.length + '</div><div class="rh-stat-l">Total Mentions</div></div>' +
    '<div class="rh-divider"></div>' +
    '<div class="rh-stat"><div class="rh-stat-v">' + (priSov ? priSov.percent.toFixed(1) + '%' : '—') + '</div><div class="rh-stat-l">Share of Voice</div></div>' +
    '<div class="rh-divider"></div>' +
    '<div class="rh-stat"><div class="rh-stat-v">' + (pb.net_sentiment != null ? pb.net_sentiment.toFixed(2) : '—') + '</div><div class="rh-stat-l">Net Sentiment</div></div>';

  document.getElementById('dl-brand').textContent = brand + ' Intelligence Report';
  document.getElementById('dl-sub').textContent   = 'Generated ' + today;

  /* Tabs */
  var tabs = ['Current Results', 'Share of Voice', 'Sentiment', 'Earned Media', 'Influencers'];
  document.getElementById('report-nav').innerHTML = tabs.map(function(t, i) {
    return '<div class="nav-tab' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' + esc(t) + '</div>';
  }).join('');

  document.querySelectorAll('.nav-tab').forEach(function(el) {
    el.addEventListener('click', function() {
      document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
      el.classList.add('active');
      document.querySelectorAll('.report-section').forEach(function(s, i) {
        s.classList.toggle('active', i === parseInt(el.dataset.idx));
      });
      setTimeout(drawCharts, 60);
    });
  });

  /* Build sections */
  var body = document.getElementById('report-body');
  body.innerHTML = '';
  body.appendChild(buildCurrentResults());
  body.appendChild(buildSOVSection());
  body.appendChild(buildSentimentSection());
  body.appendChild(buildEarnedSection());
  body.appendChild(buildInfluencerSection());

  document.querySelectorAll('.report-section')[0].classList.add('active');
  setTimeout(drawCharts, 120);
}

/* ── SECTION 1: CURRENT RESULTS ── */
function buildCurrentResults() {
  var brand    = STATE.brand;
  var mentions = STATE.mentions;
  var analysis = STATE.analysis;
  var report   = STATE.report || {};

  var sov    = (analysis && analysis.share_of_voice) ? analysis.share_of_voice : [];
  var priSov = sov.find(function(s) { return s.brand && s.brand.toLowerCase() === brand.toLowerCase(); });
  var pb     = getPrimaryBreakdown(brand) || {};
  var web    = (analysis && analysis.channel_split) ? (analysis.channel_split.web || 0)    : 0;
  var social = (analysis && analysis.channel_split) ? (analysis.channel_split.social || 0) : 0;

  var months = lastNMonths(3);
  var third  = Math.ceil(mentions.length / 3);
  var period = currentPeriodLabel();

  /* Month cards */
  var monthCardsHtml = months.map(function(month, i) {
    var slice  = mentions.slice(i * third, (i + 1) * third);
    var scored = (analysis && analysis.scored ? analysis.scored : []).filter(function(s) {
      return s.index >= i * third && s.index < (i + 1) * third;
    });
    var pos = scored.filter(function(s) { return s.sentiment === 'positive'; }).length;
    var er  = scored.length ? ((pos / scored.length) * 100).toFixed(0) + '%' : '—';

    /* Use recent_highlights if available, else key_findings */
    var bullets = [];
    if (report.recent_highlights && report.recent_highlights[i]) {
      bullets.push('<strong>Recent:</strong> ' + esc(report.recent_highlights[i]));
    } else if (report.key_findings && report.key_findings[i]) {
      bullets.push(esc(report.key_findings[i]));
    }
    if (report.key_findings && report.key_findings[i + 1] && bullets.length < 2) {
      bullets.push(esc(report.key_findings[i + 1]));
    }

    return (
      '<div class="month-card">' +
        '<div class="mc-head"><div class="mc-month">' + esc(month) + '</div><div class="mc-period">' + esc(period) + '</div></div>' +
        '<div class="mc-stats">' +
          '<div class="mc-stat"><div class="mc-stat-v">' + slice.length + '</div><div class="mc-stat-l">Mentions</div></div>' +
          '<div class="mc-stat"><div class="mc-stat-v">' + er + '</div><div class="mc-stat-l">Positive Rate</div></div>' +
          '<div class="mc-stat"><div class="mc-stat-v">' + slice.filter(function(m) { return m.channel === 'web'; }).length + '</div><div class="mc-stat-l">Web</div></div>' +
          '<div class="mc-stat"><div class="mc-stat-v">' + slice.filter(function(m) { return m.channel === 'social'; }).length + '</div><div class="mc-stat-l">Social</div></div>' +
        '</div>' +
        '<div class="mc-body"><ul class="mc-bullets">' + bullets.map(function(b) { return '<li>' + b + '</li>'; }).join('') + '</ul></div>' +
      '</div>'
    );
  }).join('');

  /* Recent highlights + key findings */
  var findingsHtml = '';
  if (report.recent_highlights && report.recent_highlights.length) {
    findingsHtml += report.recent_highlights.map(function(h) {
      return '<div class="finding-row"><div class="finding-dot gold"></div><p><strong>' + esc(h) + '</strong></p></div>';
    }).join('');
  }
  findingsHtml += (report.key_findings || []).map(function(f) {
    return '<div class="finding-row"><div class="finding-dot"></div><p>' + esc(f) + '</p></div>';
  }).join('');

  var sec = document.createElement('div');
  sec.className = 'report-section';
  sec.innerHTML =
    '<div class="section-header">' +
      '<div><div class="section-title">Current Results</div>' +
      '<div class="section-sub">' + esc(report.headline || '') + '</div></div>' +
    '</div>' +

    '<div class="stat-strip">' +
      '<div class="ss-item"><div class="ss-val">' + mentions.length + '</div><div class="ss-label">Total Mentions</div></div>' +
      '<div class="ss-item"><div class="ss-val">' + (priSov ? priSov.percent.toFixed(1) + '%' : '—') + '</div><div class="ss-label">Share of Voice</div></div>' +
      '<div class="ss-item"><div class="ss-val">' + (pb.net_sentiment != null ? pb.net_sentiment.toFixed(2) : '—') + '</div><div class="ss-label">Net Sentiment</div></div>' +
      '<div class="ss-item"><div class="ss-val">' + web + '</div><div class="ss-label">Web Stories</div></div>' +
      '<div class="ss-item"><div class="ss-val">' + social + '</div><div class="ss-label">Social</div></div>' +
      '<div class="ss-item"><div class="ss-val">' + (pb.positive || 0) + '</div><div class="ss-label">Positive</div></div>' +
    '</div>' +

    '<div class="month-grid">' + monthCardsHtml + '</div>' +

    '<div class="findings-list">' + findingsHtml + '</div>';

  return sec;
}

/* ── SECTION 2: SHARE OF VOICE ── */
function buildSOVSection() {
  var sov    = (STATE.analysis && STATE.analysis.share_of_voice) ? STATE.analysis.share_of_voice : [];
  var report = STATE.report || {};
  var period = currentPeriodLabel();

  var sec = document.createElement('div');
  sec.className = 'report-section';
  sec.innerHTML =
    '<div class="section-header">' +
      '<div><div class="section-title">Share of Voice</div>' +
      '<div class="section-sub">Brand mentions relative to the competitive set — live data</div></div>' +
      '<div class="section-badge">' + sov.length + ' brands tracked</div>' +
    '</div>' +

    '<div class="info-card">' +
      '<div class="info-card-title">Category Snapshot</div>' +
      '<p>' + esc(report.share_of_voice_analysis || '') + '</p>' +
      (report.competitive_positioning
        ? '<div class="takeaway"><strong>Competitive Position:</strong> ' + esc(report.competitive_positioning) + '</div>'
        : '') +
    '</div>' +

    '<div class="chart-grid">' +
      '<div class="chart-card">' +
        '<div class="chart-title">SoV by Mentions</div>' +
        '<div class="chart-period">' + period + ' · Live Data</div>' +
        '<div class="chart-wrap"><canvas id="chart-sov"></canvas></div>' +
        '<div class="donut-legend" id="leg-sov"></div>' +
      '</div>' +
      '<div class="chart-card">' +
        '<div class="chart-title">Mention Volume — Ranked</div>' +
        '<div class="chart-period">' + period + '</div>' +
        '<div id="sov-bars" style="margin-top:8px"></div>' +
      '</div>' +
    '</div>' +

    '<div class="chart-grid">' +
      '<div class="chart-card">' +
        '<div class="chart-title">Sentiment by Brand</div>' +
        '<div class="chart-period">Positive / Neutral / Negative</div>' +
        '<div class="chart-wrap"><canvas id="chart-sent-bar"></canvas></div>' +
      '</div>' +
      '<div class="chart-card">' +
        '<div class="chart-title">Channel Split</div>' +
        '<div class="chart-period">Web vs Social</div>' +
        '<div class="chart-wrap"><canvas id="chart-chan"></canvas></div>' +
        '<div class="donut-legend" id="leg-chan"></div>' +
      '</div>' +
    '</div>';

  return sec;
}

/* ── SECTION 3: SENTIMENT ── */
function buildSentimentSection() {
  var brand    = STATE.brand;
  var analysis = STATE.analysis || {};
  var report   = STATE.report   || {};
  var pb       = getPrimaryBreakdown(brand) || {};

  var pos = pb.positive || 0, neu = pb.neutral || 0, neg = pb.negative || 0, tot = pos + neu + neg || 1;
  var themes  = analysis.themes || [];
  var scored  = analysis.scored || [];

  var rows = scored.slice(0, 20).map(function(s) {
    var m = STATE.mentions[s.index] || {};
    return (
      '<tr>' +
        '<td>' + esc(m.source || '—') + '</td>' +
        '<td><span class="badge ' + (m.channel || 'web') + '">' + (m.channel || 'web').toUpperCase() + '</span></td>' +
        '<td style="max-width:260px">' + esc(m.snippet || m.title || '—') + '</td>' +
        '<td><span class="badge ' + s.sentiment + '">' + s.sentiment + '</span></td>' +
        '<td>' + esc(s.rationale || '') + '</td>' +
      '</tr>'
    );
  }).join('');

  var sec = document.createElement('div');
  sec.className = 'report-section';
  sec.innerHTML =
    '<div class="section-header"><div class="section-title">Sentiment Analysis</div></div>' +

    '<div class="sentiment-summary">' +
      '<div class="sent-card"><div class="sent-val positive">' + pos + '</div><div class="sent-lbl">Positive</div></div>' +
      '<div class="sent-card"><div class="sent-val neutral">'  + neu + '</div><div class="sent-lbl">Neutral</div></div>' +
      '<div class="sent-card"><div class="sent-val negative">' + neg + '</div><div class="sent-lbl">Negative</div></div>' +
      '<div class="sent-card"><div class="sent-val" style="color:var(--blue)">' + ((pos / tot) * 100).toFixed(0) + '%</div><div class="sent-lbl">Positive Rate</div></div>' +
    '</div>' +

    '<div class="info-card">' +
      '<p>' + esc(report.sentiment_analysis || '') + '</p>' +
      (report.themes_analysis ? '<p>' + esc(report.themes_analysis) + '</p>' : '') +
    '</div>' +

    (themes.length
      ? '<div style="margin-bottom:22px"><div class="section-title" style="font-size:15px;margin-bottom:12px">Themes in Circulation</div>' +
        '<div class="theme-chips">' +
          themes.map(function(t) {
            return '<div class="theme-chip ' + t.sentiment + '">' + esc(t.theme) + ' <span style="opacity:.55;font-size:10px">×' + t.frequency + '</span></div>';
          }).join('') +
        '</div></div>'
      : '') +

    '<div class="section-title" style="font-size:15px;margin-bottom:12px">Scored Mentions</div>' +
    '<div class="table-wrap">' +
      '<table class="mentions-table">' +
        '<thead><tr><th>Source</th><th>Channel</th><th>Snippet</th><th>Sentiment</th><th>Rationale</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  return sec;
}

/* ── SECTION 4: EARNED MEDIA ── */
function buildEarnedSection() {
  var brand    = STATE.brand;
  var mentions = STATE.mentions;
  var report   = STATE.report   || {};
  var analysis = STATE.analysis || {};

  var web = mentions.filter(function(m) {
    return m.channel === 'web' && m.brand && m.brand.toLowerCase() === brand.toLowerCase();
  });

  var cards = web.slice(0, 9).map(function(m) {
    return (
      '<div class="highlight-card">' +
        '<div class="hc-outlet"><span>' + esc(m.source || 'Publication') + '</span><span class="hc-date">' + esc(m.date || '') + '</span></div>' +
        '<div class="hc-body">' +
          '<div class="hc-title">' + esc(m.title || 'Coverage') + '</div>' +
          '<div class="hc-snippet">' + esc(m.snippet || '') + '</div>' +
          (m.url ? '<a class="hc-link" href="' + esc(m.url) + '" target="_blank" rel="noopener">↗ ' + esc(m.url.slice(0, 55)) + '…</a>' : '') +
        '</div>' +
      '</div>'
    );
  }).join('');

  var risks = (report.risks || []).map(function(r) {
    return '<div class="finding-row"><div class="finding-dot" style="background:#ef4444"></div><p>' + esc(r) + '</p></div>';
  }).join('');

  var opps = (report.opportunities || []).map(function(o) {
    return '<div class="finding-row"><div class="finding-dot" style="background:#10b981"></div><p>' + esc(o) + '</p></div>';
  }).join('');

  /* Testimonials */
  var testimonials = (report.top_testimonials || analysis.top_testimonials || []);
  var testimonialsHtml = testimonials.length
    ? testimonials.map(function(t) {
        return '<div style="padding:14px 16px;border-left:3px solid var(--blue);margin-bottom:12px;background:var(--gray-50);border-radius:0 8px 8px 0">' +
          '<p style="font-size:13px;font-style:italic;color:var(--gray-700);line-height:1.6">"' + esc(t.quote || '') + '"</p>' +
          '<p style="font-size:11px;color:var(--gray-500);margin-top:6px">— ' + esc(t.source || 'Customer') + ' · <span class="badge ' + (t.sentiment||'neutral') + '">' + (t.sentiment||'') + '</span></p>' +
        '</div>';
      }).join('')
    : '<p style="color:var(--gray-500);font-size:13px">No customer reviews found in this search.</p>';

  /* Retail cards */
  var retailMentions = mentions.filter(function(m) { return m.type === 'retail' && m.brand && m.brand.toLowerCase() === brand.toLowerCase(); });
  var retailCards = retailMentions.length
    ? retailMentions.map(function(m) {
        return '<div class="highlight-card">' +
          '<div class="hc-outlet" style="background:#0071ce"><span>' + esc(m.source) + '</span><span class="hc-date">' + esc(m.date||'') + '</span></div>' +
          '<div class="hc-body"><div class="hc-title">' + esc(m.title) + '</div><div class="hc-snippet">' + esc(m.snippet) + '</div>' +
          (m.url ? '<a class="hc-link" href="' + esc(m.url) + '" target="_blank" rel="noopener">↗ ' + esc(m.url.slice(0,55)) + '…</a>' : '') +
          '</div></div>';
      }).join('')
    : '';

  var sec = document.createElement('div');
  sec.className = 'report-section';
  sec.innerHTML =
    '<div class="section-header">' +
      '<div><div class="section-title">Earned Media Coverage</div>' +
      '<div class="section-sub">' + web.length + ' web placements · live data</div></div>' +
      '<div class="section-badge">' + web.length + ' Stories</div>' +
    '</div>' +

    '<div class="info-card"><p>' + esc(report.earned_media_note || '') + '</p></div>' +

    '<div class="highlights-grid">' +
      (cards || '<p style="color:var(--gray-500);padding:16px">No web news found.</p>') +
    '</div>' +

    (retailCards ? '<div class="section-title" style="font-size:16px;margin:24px 0 14px">Retailer Coverage</div>' +
      '<div class="info-card"><p>' + esc(report.retail_analysis || '') + '</p></div>' +
      '<div class="highlights-grid">' + retailCards + '</div>' : '') +

    '<div class="section-title" style="font-size:16px;margin:24px 0 14px">Customer Testimonials</div>' +
    '<div class="info-card"><p>' + esc(report.testimonial_insights || '') + '</p></div>' +
    '<div style="margin-bottom:24px">' + testimonialsHtml + '</div>' +

    '<div class="two-col">' +
      '<div class="info-card"><div class="info-card-title" style="color:#ef4444">⚠ Risks</div>' + risks + '</div>' +
      '<div class="info-card"><div class="info-card-title" style="color:#10b981">✦ Opportunities</div>' + opps + '</div>' +
    '</div>';

  return sec;
}

/* ── SECTION 5: INFLUENCERS ── */
function buildInfluencerSection() {
  var brand    = STATE.brand;
  var mentions = STATE.mentions;
  var report   = STATE.report   || {};
  var analysis = STATE.analysis || {};

  var social = mentions.filter(function(m) {
    return m.channel === 'social' && m.brand && m.brand.toLowerCase() === brand.toLowerCase();
  });

  var allSocial = mentions.filter(function(m) { return m.channel === 'social'; }).length;
  var period    = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  var cards = social.slice(0, 9).map(function(m) {
    var handle = (m.source || 'creator').replace('@', '').split(' ')[0].toLowerCase();
    return (
      '<div class="inf-card">' +
        '<div class="inf-handle">@' + esc(handle) + '</div>' +
        '<div class="inf-meta">' + esc(m.source || 'Social') + ' · ' + esc(m.date || period) + '</div>' +
        '<div class="inf-stats">' +
          '<div class="inf-s"><div class="inf-s-v">—</div><div class="inf-s-l">Followers</div></div>' +
          '<div class="inf-s"><div class="inf-s-v">—</div><div class="inf-s-l">ER</div></div>' +
          '<div class="inf-s"><div class="inf-s-v">—</div><div class="inf-s-l">Likes</div></div>' +
        '</div>' +
        '<div class="inf-snippet">' + esc(m.snippet || m.title || '') + '</div>' +
      '</div>'
    );
  }).join('');

  var recs = (report.recommendations || []).map(function(r, i) {
    return '<div class="rec-row"><div class="rec-num">' + (i + 1) + '</div><div class="rec-text">' + esc(r) + '</div></div>';
  }).join('');

  /* Marketing recommendations */
  var mktRecs = (report.marketing_recommendations || []);
  var mktRecsHtml = mktRecs.length
    ? mktRecs.map(function(r) {
        var channelColors = {
          'Retail Media (Walmart Connect / Target Roundel / Kohls)': '#0071ce',
          'Paid Social — Meta & TikTok': '#8b5cf6',
          'Google Search & Shopping': '#ea4335',
          'Creative Direction': '#f59e0b',
          'Programmatic & Retargeting': '#1e4db7'
        };
        var color = channelColors[r.channel] || 'var(--blue)';
        return '<div style="border:1px solid var(--gray-200);border-radius:10px;overflow:hidden;margin-bottom:12px">' +
          '<div style="background:' + color + ';color:#fff;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.04em">' + esc(r.channel || '') + '</div>' +
          '<div style="padding:14px 16px">' +
            '<p style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:6px">' + esc(r.recommendation || '') + '</p>' +
            '<p style="font-size:12px;color:var(--gray-500);line-height:1.5">' + esc(r.rationale || '') + '</p>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<p style="color:var(--gray-500);font-size:13px">No marketing recommendations generated.</p>';

  var sec = document.createElement('div');
  sec.className = 'report-section';
  sec.innerHTML =
    '<div class="section-header">' +
      '<div><div class="section-title">Social & Influencer Coverage</div>' +
      '<div class="section-sub">' + social.length + ' social mentions · live data</div></div>' +
    '</div>' +

    '<div class="emv-strip">' +
      '<div><div class="emv-stat-v">' + social.length + '</div><div class="emv-stat-l">Brand Social Mentions</div></div>' +
      '<div class="emv-divider"></div>' +
      '<div><div class="emv-stat-v">' + allSocial + '</div><div class="emv-stat-l">Total Social (All Brands)</div></div>' +
      '<div class="emv-divider"></div>' +
      '<div style="flex:1"><p style="color:rgba(255,255,255,.6);font-size:13px;line-height:1.6">' + esc(report.themes_analysis || 'Social engagement reflects current audience interest.') + '</p></div>' +
    '</div>' +

    '<div class="inf-grid">' +
      (cards || '<p style="color:var(--gray-500)">No social mentions found for this brand in the live search.</p>') +
    '</div>' +

    '<div class="info-card" style="margin-top:24px">' +
      '<div class="info-card-title">Strategic Recommendations</div>' +
      recs +
    '</div>' +
    '<div class="section-title" style="font-size:16px;margin:24px 0 14px">Marketing Recommendations</div>' +
    mktRecsHtml;

  return sec;
}
