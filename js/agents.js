/* ================================================================
   agents.js — Three Claude-powered agents
   Key fix: Agent 1 searches competitors in a follow-up message
   so the model doesn't mix up brand attributions
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

/* Force brand attribution by scanning title/snippet/url */
function fixBrand(m, allBrands, fallback) {
  // First try exact match on brand field
  var exact = allBrands.find(function(b) {
    return b.toLowerCase() === (m.brand || '').toLowerCase();
  });
  if (exact) return exact;

  // Scan title + snippet + url for brand name
  var text = ((m.title || '') + ' ' + (m.snippet || '') + ' ' + (m.url || '')).toLowerCase();
  var inferred = allBrands.find(function(b) {
    return text.indexOf(b.toLowerCase()) !== -1;
  });
  return inferred || fallback;
}

/* ── AGENT 01: FIELD OPERATIVE ── */
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching to live web');
  var year      = new Date().getFullYear();
  var allBrands = [brand].concat(competitors);
  var allMentions = [];

  // ── Step 1: Search primary brand ──
  onTrace('Searching primary brand: ' + brand);
  var primaryPrompt =
    'Brand intelligence operative. TODAY: ' + todayFormatted() + '.\n' +
    'Search for recent news and mentions of "' + brand + '" in ' + year + '.\n' +
    'Run 2 searches. Find 5-6 results.\n\n' +
    'Output ONLY a JSON array, no prose, no fences:\n' +
    '[{"brand":"' + brand + '","source":"<outlet>","channel":"web" or "social","title":"<title>","snippet":"<paraphrased 10 words max>","url":"<url>","date":"<YYYY-MM-DD or empty>"}]\n\n' +
    'Every item must have brand="' + brand + '" exactly.';

  var d1 = await callClaude(
    [{ role: 'user', content: primaryPrompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    1500
  );
  var primaryMentions = safeParse(extractText(d1), [], true);
  if (Array.isArray(primaryMentions)) {
    primaryMentions = primaryMentions.map(function(m) {
      m.brand = brand; // force correct attribution
      return m;
    }).filter(function(m) { return m.title; });
    allMentions = allMentions.concat(primaryMentions);
    onTrace(brand + ': ' + primaryMentions.length + ' mentions found');
  }

  // ── Step 2: Search each competitor separately with a pause ──
  for (var i = 0; i < competitors.length; i++) {
    var comp = competitors[i];
    onTrace('Pausing 10s then searching: ' + comp);
    await sleep(10000);

    var compPrompt =
      'Search for recent news and mentions of "' + comp + '" in ' + year + '.\n' +
      'Run 1 search. Find 3-4 results.\n\n' +
      'Output ONLY a JSON array, no prose, no fences:\n' +
      '[{"brand":"' + comp + '","source":"<outlet>","channel":"web" or "social","title":"<title>","snippet":"<paraphrased 10 words max>","url":"<url>","date":"<YYYY-MM-DD or empty>"}]\n\n' +
      'Every item must have brand="' + comp + '" exactly. Do not include results about other brands.';

    try {
      var dc = await callClaude(
        [{ role: 'user', content: compPrompt }],
        [{ type: 'web_search_20250305', name: 'web_search' }],
        1000
      );
      var compMentions = safeParse(extractText(dc), [], true);
      if (Array.isArray(compMentions) && compMentions.length > 0) {
        compMentions = compMentions.map(function(m) {
          m.brand = comp; // force correct attribution
          return m;
        }).filter(function(m) { return m.title; });
        allMentions = allMentions.concat(compMentions);
        onTrace(comp + ': ' + compMentions.length + ' mentions found');
      } else {
        onTrace(comp + ': 0 mentions (search returned nothing)');
        // Add a placeholder so this brand appears in SoV with 0
      }
    } catch(e) {
      onTrace(comp + ': search failed — ' + e.message.slice(0, 50));
    }
  }

  if (allMentions.length === 0) {
    throw new Error('No mentions found for any brand. Try again or use a more well-known brand.');
  }

  // Log final breakdown
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  allMentions.forEach(function(m) { counts[m.brand] = (counts[m.brand] || 0) + 1; });
  onTrace('Final: ' + allBrands.map(function(b) { return b + '=' + counts[b]; }).join(', '));

  return allMentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Pausing 10s before sentiment...');
  await sleep(10000);
  onTrace('Scoring sentiment');

  var allBrands = [brand].concat(competitors);

  // Count mentions per brand — SOURCE OF TRUTH for SoV
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  mentions.forEach(function(m) {
    // Match case-insensitively
    var matched = allBrands.find(function(b) {
      return b.toLowerCase() === (m.brand || '').toLowerCase();
    });
    if (matched) counts[matched]++;
  });
  var total = mentions.length || 1;
  onTrace('Counts: ' + allBrands.map(function(b) { return b + '=' + counts[b]; }).join(', '));

  // Build mention list for scoring
  var lines = mentions.slice(0, 15).map(function(m, i) {
    return i + '|' + m.brand + '|' + (m.channel || 'web') + '|' + (m.snippet || m.title || '').slice(0, 70);
  }).join('\n');

  var prompt =
    'Score sentiment for each mention. Brands: ' + allBrands.join(', ') + '\n\n' +
    'Mentions (index|brand|channel|text):\n' + lines + '\n\n' +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "scored": [{"index":0,"brand":"x","sentiment":"positive","score":0.5,"rationale":"brief text-based reason"}],\n' +
    '  "themes": [{"theme":"topic name","sentiment":"positive","frequency":2}]\n' +
    '}\n\n' +
    'Rules:\n' +
    '- Score based ONLY on the actual snippet text provided\n' +
    '- Max 4 themes, from ' + brand + ' mentions only\n' +
    '- No other fields needed';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = safeParse(extractText(data), null);

  if (!result || !result.scored) {
    console.error('Agent 2 raw:', extractText(data).slice(0, 800));
    throw new Error('Sentiment analyst returned malformed output.');
  }

  // ── COMPUTE EVERYTHING IN CODE — never trust model for numbers ──

  // SoV from actual counts
  result.share_of_voice = allBrands.map(function(b) {
    var count = counts[b] || 0;
    return {
      brand:         b,
      mention_count: count,
      percent:       parseFloat(((count / total) * 100).toFixed(1))
    };
  });

  // Sentiment breakdown from scored results
  var breakdown = {};
  allBrands.forEach(function(b) {
    breakdown[b] = { positive: 0, neutral: 0, negative: 0, net_sentiment: 0 };
  });
  (result.scored || []).forEach(function(s) {
    var matched = allBrands.find(function(b) {
      return b.toLowerCase() === (s.brand || '').toLowerCase();
    });
    if (matched && breakdown[matched] && s.sentiment) {
      breakdown[matched][s.sentiment] = (breakdown[matched][s.sentiment] || 0) + 1;
    }
  });
  allBrands.forEach(function(b) {
    var bd  = breakdown[b];
    var tot = (bd.positive + bd.neutral + bd.negative) || 1;
    bd.net_sentiment = parseFloat(((bd.positive - bd.negative) / tot).toFixed(2));
  });
  result.sentiment_breakdown = breakdown;

  // Channel split from raw mentions
  result.channel_split = {
    web:    mentions.filter(function(m) { return m.channel === 'web'; }).length,
    social: mentions.filter(function(m) { return m.channel === 'social'; }).length
  };

  var pri = result.share_of_voice.find(function(s) {
    return s.brand.toLowerCase() === brand.toLowerCase();
  });
  if (pri) onTrace('SoV ' + brand + ': ' + pri.percent + '%');
  if (competitors.length) {
    competitors.forEach(function(c) {
      var cs = result.share_of_voice.find(function(s) { return s.brand.toLowerCase() === c.toLowerCase(); });
      if (cs) onTrace('SoV ' + c + ': ' + cs.percent + '%');
    });
  }
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Pausing 10s before report...');
  await sleep(10000);
  onTrace('Synthesizing report');

  var today  = todayFormatted();
  var sov    = (analysis.share_of_voice || []).map(function(s) {
    return s.brand + ': ' + s.percent + '% (' + s.mention_count + ' mentions)';
  }).join(', ');
  var pb     = (analysis.sentiment_breakdown || {})[brand] || {};
  var themes = (analysis.themes || []).map(function(t) {
    return t.theme + ' (' + t.sentiment + ' x' + t.frequency + ')';
  }).join(', ');

  var summary =
    'Brand: ' + brand + ' | Date: ' + today + ' | Total mentions: ' + mentions.length + '\n' +
    'Share of Voice — ' + sov + '\n' +
    brand + ' sentiment: +' + (pb.positive||0) + ' neutral=' + (pb.neutral||0) + ' -' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    'Themes: ' + (themes || 'none') +
    (competitors.length ? '\nCompetitors: ' + competitors.join(', ') : '');

  var prompt =
    'Write a brand intelligence briefing. Data:\n\n' + summary + '\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"headline":"<one sentence about ' + brand + ' today>",' +
    '"executive_summary":"<2 sentences present tense>",' +
    '"key_findings":["<finding with real numbers>","<finding 2>","<finding 3>"],' +
    '"share_of_voice_analysis":"<2 sentences using the exact percentages above>",' +
    '"sentiment_analysis":"<2 sentences using the exact numbers above>",' +
    '"themes_analysis":"<1 sentence>",' +
    '"competitive_positioning":"<2 sentences comparing ' + brand + ' vs ' + (competitors.join(', ') || 'market') + '>",' +
    '"recent_highlights":["<highlight>","<highlight>","<highlight>"],' +
    '"earned_media_note":"<1 sentence>",' +
    '"risks":["<risk>","<risk>"],' +
    '"opportunities":["<opportunity>","<opportunity>"],' +
    '"recommendations":["<rec>","<rec>","<rec>"]}';

  var data   = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var report = safeParse(extractText(data), null);

  if (!report) {
    console.error('Agent 3 raw:', extractText(data).slice(0, 800));
    throw new Error('Bureau chief returned malformed report.');
  }

  onTrace('Briefing finalized');
  return report;
}
