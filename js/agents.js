/* ================================================================
   agents.js — Three Claude-powered agents
   ================================================================ */

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function callClaude(messages, tools, maxTokens) {
  var apiKey = window.ANTHROPIC_KEY || '';
  if (!apiKey) throw new Error('No API key set. Please enter your Anthropic API key.');

  var body = {
    model:      'claude-sonnet-4-5',
    max_tokens: maxTokens || 1500,
    messages:   messages
  };
  if (tools) body.tools = tools;

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });

  var data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/* ── AGENT 01: FIELD OPERATIVE ── */
/* Single call searching ALL brands at once — avoids multiple rate-limited calls */
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching to live web');

  var year      = new Date().getFullYear();
  var allBrands = [brand].concat(competitors);

  onTrace('Searching: ' + allBrands.join(', '));

  /* Tell the model exactly which brands to search and how to tag them */
  var brandInstructions = allBrands.map(function(b, i) {
    return (i + 1) + '. Search for "' + b + ' ' + year + '" — find ' + (i === 0 ? '5-6' : '2-3') + ' recent mentions. Tag each with brand="' + b + '"';
  }).join('\n');

  var prompt =
    'You are a brand intelligence operative. TODAY: ' + todayFormatted() + '.\n\n' +
    'Use web_search to find recent mentions for each of these brands:\n' +
    brandInstructions + '\n\n' +
    'Run one search per brand (' + allBrands.length + ' searches total).\n\n' +
    'After all searches, output ONLY a JSON array — no prose, no fences.\n' +
    'Every object must follow this exact schema:\n' +
    '{"brand":"<exact brand name from the list above>","source":"<outlet>","channel":"web" or "social","title":"<title>","snippet":"<paraphrased, max 12 words>","url":"<url>","date":"<YYYY-MM-DD or empty>"}\n\n' +
    'CRITICAL: The "brand" field must be one of: ' + allBrands.map(function(b){ return '"' + b + '"'; }).join(', ') + '\n' +
    'Do not use any other brand names. Do not mix up which brand a result belongs to.';

  var data = await callClaude(
    [{ role: 'user', content: prompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    2000
  );

  var searches = (data.content || []).filter(function(b) { return b.type === 'server_tool_use'; }).length;
  onTrace('Completed ' + searches + ' web searches');

  var mentions = safeParse(extractText(data), [], true);
  if (!Array.isArray(mentions) || mentions.length === 0) {
    console.error('Agent 1 raw:', extractText(data).slice(0, 800));
    throw new Error('No mentions found. Check browser console for raw response.');
  }

  /* Validate and fix brand attribution */
  mentions = mentions.filter(function(m) { return m && m.title; });
  mentions = mentions.map(function(m) {
    /* Find the closest matching brand name (case-insensitive) */
    var matched = allBrands.find(function(b) {
      return b.toLowerCase() === (m.brand || '').toLowerCase();
    });
    /* If model got the brand wrong, try to infer from title/snippet */
    if (!matched) {
      matched = allBrands.find(function(b) {
        var text = ((m.title || '') + ' ' + (m.snippet || '') + ' ' + (m.url || '')).toLowerCase();
        return text.indexOf(b.toLowerCase()) !== -1;
      });
    }
    m.brand = matched || brand; /* fallback to primary brand */
    return m;
  });

  /* Log breakdown */
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  mentions.forEach(function(m) { counts[m.brand] = (counts[m.brand] || 0) + 1; });
  onTrace('Mentions: ' + allBrands.map(function(b) { return b + '=' + (counts[b] || 0); }).join(', '));

  /* Warn if any brand got 0 mentions */
  allBrands.forEach(function(b) {
    if (!counts[b]) onTrace('WARNING: 0 mentions found for ' + b);
  });

  return mentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Pausing 8s before sentiment...');
  await sleep(8000);
  onTrace('Scoring sentiment');

  var allBrands = [brand].concat(competitors);

  /* Count mentions per brand — this is our source of truth for SoV */
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  mentions.forEach(function(m) {
    var b = allBrands.find(function(ab) { return ab.toLowerCase() === (m.brand || '').toLowerCase(); });
    if (b) counts[b]++;
  });
  var total = mentions.length || 1;

  onTrace('SoV counts: ' + allBrands.map(function(b) { return b + '=' + counts[b]; }).join(', '));

  /* Build pipe-separated mention list for the model to score */
  var lines = mentions.slice(0, 15).map(function(m, i) {
    return i + '|' + m.brand + '|' + (m.channel || 'web') + '|' + (m.snippet || m.title || '').slice(0, 70);
  }).join('\n');

  var prompt =
    'Score the sentiment of each mention below for brand "' + brand + '".\n\n' +
    'Mentions (index|brand|channel|text):\n' + lines + '\n\n' +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "scored": [{"index":<n>,"brand":"<brand>","sentiment":"positive"|"neutral"|"negative","score":<-1.0 to 1.0>,"rationale":"<8 words max based on the actual text>"}],\n' +
    '  "sentiment_breakdown": {' + allBrands.map(function(b) { return '"' + b + '":{"positive":0,"neutral":0,"negative":0,"net_sentiment":0}'; }).join(',') + '},\n' +
    '  "channel_split": {"web":' + mentions.filter(function(m){return m.channel==='web';}).length + ',"social":' + mentions.filter(function(m){return m.channel==='social';}).length + '},\n' +
    '  "themes": [{"theme":"<topic>","sentiment":"positive"|"neutral"|"negative","frequency":<n>}]\n' +
    '}\n\n' +
    'Score each mention based ONLY on its text. Max 4 themes from primary brand mentions.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = safeParse(extractText(data), null);

  if (!result || !result.scored) {
    console.error('Agent 2 raw:', extractText(data).slice(0, 800));
    throw new Error('Sentiment analyst returned malformed output.');
  }

  /* ALWAYS compute SoV ourselves — never trust the model for this */
  result.share_of_voice = allBrands.map(function(b) {
    var count = counts[b] || 0;
    return {
      brand:         b,
      mention_count: count,
      percent:       parseFloat(((count / total) * 100).toFixed(1))
    };
  });

  /* Recompute sentiment_breakdown from scored results */
  var breakdown = {};
  allBrands.forEach(function(b) {
    breakdown[b] = { positive: 0, neutral: 0, negative: 0, net_sentiment: 0 };
  });
  (result.scored || []).forEach(function(s) {
    var b = allBrands.find(function(ab) { return ab.toLowerCase() === (s.brand || '').toLowerCase(); });
    if (b && breakdown[b]) {
      breakdown[b][s.sentiment] = (breakdown[b][s.sentiment] || 0) + 1;
    }
  });
  allBrands.forEach(function(b) {
    var bd = breakdown[b];
    var tot = bd.positive + bd.neutral + bd.negative || 1;
    bd.net_sentiment = parseFloat(((bd.positive - bd.negative) / tot).toFixed(2));
  });
  result.sentiment_breakdown = breakdown;

  var pri = result.share_of_voice.find(function(s) { return s.brand.toLowerCase() === brand.toLowerCase(); });
  if (pri) onTrace('SoV ' + brand + ': ' + pri.percent + '%');
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Pausing 8s before report...');
  await sleep(8000);
  onTrace('Synthesizing report');

  var today  = todayFormatted();
  var sov    = (analysis.share_of_voice || []).map(function(s) {
    return s.brand + ': ' + s.percent + '% (' + s.mention_count + ' mentions)';
  }).join(', ');
  var pb     = (analysis.sentiment_breakdown || {})[brand] || {};
  var themes = (analysis.themes || []).map(function(t) { return t.theme + '(' + t.sentiment + ')'; }).join(', ');

  var summary =
    'Primary brand: ' + brand + '\n' +
    'Report date: ' + today + '\n' +
    'Total mentions collected: ' + mentions.length + '\n' +
    'Share of Voice: ' + sov + '\n' +
    'Sentiment for ' + brand + ': positive=' + (pb.positive||0) + ' neutral=' + (pb.neutral||0) + ' negative=' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    'Key themes: ' + (themes || 'none') + '\n' +
    (competitors.length ? 'Competitors: ' + competitors.join(', ') : '');

  var prompt =
    'Write a brand intelligence briefing based exactly on this data:\n\n' +
    summary + '\n\n' +
    'Return ONLY valid JSON, no other text:\n' +
    '{\n' +
    '  "headline": "<one sentence about ' + brand + ' right now>",\n' +
    '  "executive_summary": "<2 sentences, present tense>",\n' +
    '  "key_findings": ["<specific finding with numbers>","<finding 2>","<finding 3>"],\n' +
    '  "share_of_voice_analysis": "<2 sentences referencing the exact SoV percentages above>",\n' +
    '  "sentiment_analysis": "<2 sentences referencing the exact sentiment numbers above>",\n' +
    '  "themes_analysis": "<1 sentence about the themes>",\n' +
    '  "competitive_positioning": "<2 sentences comparing ' + brand + ' to ' + (competitors.join(' and ') || 'competitors') + ' using the SoV data>",\n' +
    '  "recent_highlights": ["<real highlight from data>","<highlight 2>","<highlight 3>"],\n' +
    '  "earned_media_note": "<1 sentence>",\n' +
    '  "risks": ["<risk based on data>","<risk 2>"],\n' +
    '  "opportunities": ["<opportunity based on data>","<opportunity 2>"],\n' +
    '  "recommendations": ["<actionable rec 1>","<rec 2>","<rec 3>"]\n' +
    '}';

  var data   = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var report = safeParse(extractText(data), null);

  if (!report) {
    console.error('Agent 3 raw:', extractText(data).slice(0, 800));
    throw new Error('Bureau chief returned malformed report.');
  }

  onTrace('Briefing finalized');
  return report;
}
