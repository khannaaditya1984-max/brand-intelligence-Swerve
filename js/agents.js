/* ================================================================
   agents.js — Three Claude-powered agents
   ================================================================ */

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function callClaude(messages, tools, maxTokens) {
  var apiKey = window.ANTHROPIC_KEY || '';
  if (!apiKey) throw new Error('No API key set. Please enter your Anthropic API key.');
  var body = { model: 'claude-sonnet-4-5', max_tokens: maxTokens || 1500, messages: messages };
  if (tools) body.tools = tools;
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/* Extract ALL content blocks including tool results from a response */
function extractAllText(data) {
  var parts = [];
  (data.content || []).forEach(function(block) {
    if (block.type === 'text') parts.push(block.text);
    if (block.type === 'tool_result') {
      (block.content || []).forEach(function(c) { if (c.text) parts.push(c.text); });
    }
  });
  return parts.join('\n');
}

/* Aggressively extract all JSON objects from any text */
function extractAllObjects(text) {
  var results = [];
  var i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      var depth = 0, inStr = false, esc = false, start = i;
      for (var j = i; j < text.length; j++) {
        var c = text[j];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { try { results.push(JSON.parse(text.slice(start, j + 1))); } catch(e) {} i = j; break; } }
      }
    }
    i++;
  }
  return results;
}

/* Search one brand and return mentions with brand forced */
async function searchBrand(brandName, isPrimary, onTrace) {
  var year = new Date().getFullYear();
  var count = isPrimary ? '5' : '3';

  var prompt =
    'Search for "' + brandName + ' ' + year + '" and find ' + count + ' recent news articles or mentions.\n\n' +
    'After searching, list your results as a JSON array only:\n' +
    '[{"source":"outlet name","channel":"web","title":"article title","snippet":"brief paraphrase under 12 words","url":"full url","date":"YYYY-MM-DD"}]\n\n' +
    'JSON array only. No other text.';

  var data = await callClaude(
    [{ role: 'user', content: prompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    isPrimary ? 1500 : 1000
  );

  var raw = extractAllText(data);
  console.log('[' + brandName + '] raw length:', raw.length);
  console.log('[' + brandName + '] raw preview:', raw.slice(0, 300));

  /* Try standard safeParse first */
  var found = safeParse(raw, [], true);

  /* If that fails, extract individual objects */
  if (!Array.isArray(found) || found.length === 0) {
    var objs = extractAllObjects(raw);
    found = objs.filter(function(o) { return o.title || o.source; });
    if (found.length > 0) {
      console.log('[' + brandName + '] recovered ' + found.length + ' objects via aggressive parse');
    }
  }

  if (!Array.isArray(found)) found = [];

  /* Force brand on every result */
  found = found
    .filter(function(m) { return m && (m.title || m.source); })
    .map(function(m) {
      return {
        brand:   brandName,
        source:  m.source || 'Unknown',
        channel: m.channel || 'web',
        title:   m.title  || '',
        snippet: m.snippet || '',
        url:     m.url    || '',
        date:    m.date   || ''
      };
    });

  onTrace(brandName + ': ' + found.length + ' mentions');
  return found;
}

/* ── AGENT 01: FIELD OPERATIVE ── */
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching agents');
  var allMentions = [];

  /* Primary brand */
  var primary = await searchBrand(brand, true, onTrace);
  allMentions = allMentions.concat(primary);

  /* Each competitor with a pause */
  for (var i = 0; i < competitors.length; i++) {
    onTrace('Waiting 12s before ' + competitors[i] + '...');
    await sleep(12000);
    var compResults = await searchBrand(competitors[i], false, onTrace);
    allMentions = allMentions.concat(compResults);
  }

  if (allMentions.length === 0) {
    throw new Error('No mentions found for any brand. Check browser console (F12) for raw API responses.');
  }

  /* Final breakdown */
  var allBrands = [brand].concat(competitors);
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  allMentions.forEach(function(m) { counts[m.brand] = (counts[m.brand] || 0) + 1; });
  onTrace('Totals: ' + allBrands.map(function(b) { return b + '=' + counts[b]; }).join(', '));

  return allMentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Waiting 12s before sentiment...');
  await sleep(12000);
  onTrace('Scoring sentiment');

  var allBrands = [brand].concat(competitors);

  /* Count per brand — source of truth for SoV */
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  mentions.forEach(function(m) {
    var matched = allBrands.find(function(b) { return b.toLowerCase() === (m.brand || '').toLowerCase(); });
    if (matched) counts[matched]++;
  });
  var total = mentions.length || 1;

  /* Pipe-separated list for model to score */
  var lines = mentions.slice(0, 15).map(function(m, i) {
    return i + '|' + m.brand + '|' + (m.snippet || m.title || '').slice(0, 60);
  }).join('\n');

  var prompt =
    'Score the sentiment of each of these brand mentions.\n\n' +
    lines + '\n\n' +
    'Return ONLY JSON:\n' +
    '{"scored":[{"index":0,"brand":"x","sentiment":"positive","score":0.5,"rationale":"reason"}],' +
    '"themes":[{"theme":"topic","sentiment":"positive","frequency":1}]}\n\n' +
    'Base scores on the text only. Max 4 themes for ' + brand + ' only.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = safeParse(extractAllText(data), null);

  if (!result || !result.scored) {
    /* Try object extraction fallback */
    var objs = extractAllObjects(extractAllText(data));
    result = objs.find(function(o) { return o.scored; }) || null;
    if (!result) throw new Error('Sentiment analyst failed. Check browser console.');
  }

  /* SoV — computed entirely in code */
  result.share_of_voice = allBrands.map(function(b) {
    var c = counts[b] || 0;
    return { brand: b, mention_count: c, percent: parseFloat(((c / total) * 100).toFixed(1)) };
  });

  /* Sentiment breakdown — computed from scored results */
  var breakdown = {};
  allBrands.forEach(function(b) { breakdown[b] = { positive: 0, neutral: 0, negative: 0, net_sentiment: 0 }; });
  (result.scored || []).forEach(function(s) {
    var b = allBrands.find(function(ab) { return ab.toLowerCase() === (s.brand || '').toLowerCase(); });
    if (b && s.sentiment && breakdown[b]) breakdown[b][s.sentiment]++;
  });
  allBrands.forEach(function(b) {
    var bd = breakdown[b], t = (bd.positive + bd.neutral + bd.negative) || 1;
    bd.net_sentiment = parseFloat(((bd.positive - bd.negative) / t).toFixed(2));
  });
  result.sentiment_breakdown = breakdown;

  /* Channel split — from raw data */
  result.channel_split = {
    web:    mentions.filter(function(m) { return m.channel === 'web'; }).length,
    social: mentions.filter(function(m) { return m.channel === 'social'; }).length
  };

  result.share_of_voice.forEach(function(s) {
    onTrace('SoV ' + s.brand + ': ' + s.percent + '% (' + s.mention_count + ')');
  });
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Waiting 12s before report...');
  await sleep(12000);
  onTrace('Writing report');

  var today  = todayFormatted();
  var sov    = (analysis.share_of_voice || []).map(function(s) { return s.brand + ': ' + s.percent + '% (' + s.mention_count + ')'; }).join(', ');
  var pb     = (analysis.sentiment_breakdown || {})[brand] || {};
  var themes = (analysis.themes || []).map(function(t) { return t.theme; }).join(', ');

  var prompt =
    'Write a brand intelligence briefing for "' + brand + '" (date: ' + today + ').\n\n' +
    'Data:\n' +
    '- Total mentions: ' + mentions.length + '\n' +
    '- Share of Voice: ' + sov + '\n' +
    '- ' + brand + ' sentiment: positive=' + (pb.positive||0) + ' neutral=' + (pb.neutral||0) + ' negative=' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    '- Themes: ' + (themes || 'none') + '\n' +
    (competitors.length ? '- Competitors tracked: ' + competitors.join(', ') + '\n' : '') +
    '\nReturn ONLY valid JSON:\n' +
    '{"headline":"<sentence>","executive_summary":"<2 sentences>",' +
    '"key_findings":["<f1>","<f2>","<f3>"],"share_of_voice_analysis":"<2 sentences with the exact % numbers>",' +
    '"sentiment_analysis":"<2 sentences>","themes_analysis":"<1 sentence>",' +
    '"competitive_positioning":"<2 sentences>","recent_highlights":["<h1>","<h2>","<h3>"],' +
    '"earned_media_note":"<1 sentence>","risks":["<r1>","<r2>"],' +
    '"opportunities":["<o1>","<o2>"],"recommendations":["<rec1>","<rec2>","<rec3>"]}';

  var data   = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var report = safeParse(extractAllText(data), null);
  if (!report) {
    var objs = extractAllObjects(extractAllText(data));
    report = objs.find(function(o) { return o.headline; }) || null;
    if (!report) throw new Error('Report generation failed. Check browser console.');
  }

  onTrace('Report ready');
  return report;
}
