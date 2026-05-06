/* ═══════════════════════════════════════════════════════════
   pdf.js — jsPDF report download
   ═══════════════════════════════════════════════════════════ */

function downloadPDF() {
  if (!window.jspdf) { alert('PDF library still loading — try again in a moment.'); return; }

  var jsPDF    = window.jspdf.jsPDF;
  var brand    = STATE.brand;
  var comps    = STATE.competitors;
  var mentions = STATE.mentions;
  var analysis = STATE.analysis || {};
  var report   = STATE.report   || {};

  var doc  = new jsPDF({ unit: 'pt', format: 'letter' });
  var W    = doc.internal.pageSize.getWidth();
  var H    = doc.internal.pageSize.getHeight();
  var M    = 52;
  var y    = M;

  var sov  = analysis.share_of_voice || [];
  var pb   = getPrimaryBreakdown(brand) || {};
  var pri  = sov.find(function(s) { return s.brand && s.brand.toLowerCase() === brand.toLowerCase(); });
  var today = todayFormatted();

  /* Helpers */
  function need(n) { if (y + (n || 60) > H - M) { doc.addPage(); y = M; } }
  function t(str, x, yy, opts) { doc.text(str, x, yy, opts || {}); }

  function wrap(text, size, font, style, color) {
    doc.setFont(font || 'helvetica', style || 'normal');
    doc.setFontSize(size);
    if (color) doc.setTextColor(color[0], color[1], color[2]);
    var lines = doc.splitTextToSize(String(text || ''), W - 2 * M);
    lines.forEach(function(l) { need(size + 4); t(l, M, y); y += size + 4; });
  }

  function sectionHead(title, accent) {
    accent = accent || [30, 77, 183];
    need(34);
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(M, y, 3, 13, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    t(title.toUpperCase(), M + 9, y + 9);
    y += 21;
  }

  function para(text) {
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(51, 65, 85);
    var lines = doc.splitTextToSize(String(text || ''), W - 2 * M);
    lines.forEach(function(l) { need(15); t(l, M, y); y += 15; });
    y += 8;
  }

  function bulletList(items, color) {
    color = color || [30, 77, 183];
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(51, 65, 85);
    (items || []).forEach(function(item) {
      need(18);
      doc.setFillColor(color[0], color[1], color[2]);
      doc.circle(M + 5, y - 3, 2.5, 'F');
      var lines = doc.splitTextToSize(String(item || ''), W - 2 * M - 14);
      lines.forEach(function(l) { need(14); t(l, M + 14, y); y += 14; });
      y += 3;
    });
    y += 6;
  }

  /* ── COVER HEADER ── */
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, W, 94, 'F');
  doc.setFillColor(30, 77, 183);
  doc.rect(0, 94, W, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  t('BRAND INTELLIGENCE REPORT', M, 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(160, 190, 230);
  t('CURRENT INTELLIGENCE  ·  ' + today.toUpperCase(), M, 52);
  if (comps.length) t('BENCHMARKED VS  ' + comps.join('  ·  ').toUpperCase(), M, 68);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  t(brand.toUpperCase(), W - M, 60, { align: 'right' });

  /* ── EXECUTIVE SUMMARY ── */
  y = 128;
  doc.setTextColor(10, 22, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  t('EXECUTIVE SUMMARY', M, y);
  y += 18;

  wrap(report.headline || '', 13, 'times', 'bolditalic', [15, 23, 42]);
  y += 4;
  wrap(report.executive_summary || '', 11, 'times', 'normal', [51, 65, 85]);
  y += 12;

  /* ── STATS STRIP ── */
  need(64);
  var stats = [
    { l: 'TOTAL MENTIONS',  v: String(mentions.length) },
    { l: 'SHARE OF VOICE',  v: pri ? pri.percent.toFixed(1) + '%' : '—' },
    { l: 'NET SENTIMENT',   v: pb.net_sentiment != null ? pb.net_sentiment.toFixed(2) : '—' },
    { l: 'WEB / SOCIAL',    v: (analysis.channel_split ? analysis.channel_split.web : 0) + ' / ' + (analysis.channel_split ? analysis.channel_split.social : 0) }
  ];
  var cw = (W - 2 * M) / 4;
  doc.setFillColor(248, 250, 252);
  doc.rect(M, y, W - 2 * M, 58, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.rect(M, y, W - 2 * M, 58, 'S');

  stats.forEach(function(s, i) {
    var x = M + i * cw;
    if (i > 0) { doc.setDrawColor(226, 232, 240); doc.line(x, y, x, y + 58); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    t(s.l, x + 9, y + 15);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(10, 22, 40);
    t(s.v, x + 9, y + 42);
  });
  y += 74;

  /* ── RECENT HIGHLIGHTS ── */
  if (report.recent_highlights && report.recent_highlights.length) {
    sectionHead('Recent Highlights', [245, 158, 11]);
    bulletList(report.recent_highlights, [245, 158, 11]);
  }

  /* ── NARRATIVE SECTIONS ── */
  sectionHead('Share of Voice Analysis');
  para(report.share_of_voice_analysis || '');

  /* SoV bar chart */
  var maxPct = Math.max.apply(null, sov.map(function(s) { return s.percent; })) || 1;
  var bw = W - 2 * M - 120;
  sov.forEach(function(s) {
    need(20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(51, 65, 85);
    t(s.brand.length > 16 ? s.brand.slice(0, 16) + '…' : s.brand, M, y + 10);
    var bf = (s.percent / maxPct) * bw;
    var isPri = s.brand && s.brand.toLowerCase() === brand.toLowerCase();
    doc.setFillColor.apply(doc, isPri ? [30, 77, 183] : [203, 213, 225]);
    doc.rect(M + 110, y, bf, 13, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    t(s.percent.toFixed(1) + '% (' + s.mention_count + ')', M + 110 + bf + 5, y + 9);
    y += 18;
  });
  y += 10;

  sectionHead('Competitive Positioning');
  para(report.competitive_positioning || '');

  sectionHead('Sentiment Analysis');
  para(report.sentiment_analysis || '');

  sectionHead('Themes & Conversation');
  para(report.themes_analysis || '');

  if (report.key_findings && report.key_findings.length) {
    sectionHead('Key Findings', [51, 65, 85]);
    bulletList(report.key_findings, [51, 65, 85]);
  }
  if (report.risks && report.risks.length) {
    sectionHead('Risks', [239, 68, 68]);
    bulletList(report.risks, [239, 68, 68]);
  }
  if (report.opportunities && report.opportunities.length) {
    sectionHead('Opportunities', [16, 185, 129]);
    bulletList(report.opportunities, [16, 185, 129]);
  }
  if (report.recommendations && report.recommendations.length) {
    sectionHead('Recommendations', [10, 22, 40]);
    bulletList(report.recommendations, [10, 22, 40]);
  }

  /* ── SOURCES APPENDIX ── */
  doc.addPage();
  y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
  t('APPENDIX  ·  SOURCES', M, y);
  y += 22;

  mentions.slice(0, 30).forEach(function(m, i) {
    need(38);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(10, 22, 40);
    t(
      String(i + 1).padStart(2, '0') + '  ' + (m.brand || '—') + '  ·  ' + (m.source || 'Unknown') + '  ·  ' + (m.channel || '').toUpperCase(),
      M, y
    );
    y += 12;
    doc.setFont('times', 'italic'); doc.setFontSize(10); doc.setTextColor(51, 65, 85);
    var tl = doc.splitTextToSize(m.title || m.snippet || '', W - 2 * M);
    tl.slice(0, 2).forEach(function(l) { need(13); t(l, M, y); y += 13; });
    if (m.url) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      need(11);
      t(m.url.length > 90 ? m.url.slice(0, 90) + '…' : m.url, M, y);
      y += 11;
    }
    y += 5;
  });

  /* ── PAGE FOOTERS ── */
  var pages = doc.internal.getNumberOfPages();
  for (var i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(160, 160, 160);
    t('PAGE ' + i + ' OF ' + pages, M, H - 18);
    t('BRAND INTELLIGENCE BUREAU', W - M, H - 18, { align: 'right' });
  }

  /* ── SAVE ── */
  var d = new Date();
  var stamp = d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0');
  doc.save(brand.replace(/ /g, '_') + '_Intelligence_' + stamp + '.pdf');
}
