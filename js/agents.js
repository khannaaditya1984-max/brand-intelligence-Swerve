/* ================================================================
   agents.js — Three Claude-powered agents (rate-limit safe)
   ================================================================ */

/* 5 second pause between agents to avoid hitting 30k TPM limit */
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
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching to live web');

  var year = new Date().getFullYear();

  /* Search primary brand only first — lean prompt */
  var prompt =
    'Search for recent news and social mentions of "' + brand + '" in ' + year + '. ' +
    'Run 2 searches only.\n\n' +
    'Reply with ONLY a JSON array. No text before or after it.\n' +
    'Schema: [{"brand":"' + brand + '","source":"<outlet>","channel":"web" or "social",' +
    '"title":"<title>","snippet":"<10 words max>","url":"<url>","date":"<YYYY-MM-DD or empty>"}]\n' +
    'Return max 6 items. Very short snippets.';

  var data = await callClaude(
    [{ role: 'user', content: prompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    1500
  );

  onTrace('Primary brand searched');
  var mentions = safeParse(extractText(data), [], true);
  if (!Array.isArray(mentions)) mentions = [];

  /* Search competitors one at a time with a pause */
  for (var ci = 0; ci < competitors.length; ci++) {
    var comp = competitors[ci];
    onTrace('Searching competitor: ' + comp);
    await sleep(6000); /* wait 6s between each search to let TPM reset */

    var cp =
      'Search for 2-3 recent mentions of "' + comp + '" in ' + year + '. Run 1 search.\n\n' +
      'Reply with ONLY a JSON array.\n' +
      'Schema: [{"brand":"' + comp + '","source":"<s>","channel":"web" or "social",' +
      '"title":"<t>","snippet":"<10 words>","url":"<u>","date":"<YYYY-MM-DD or empty>"}]\n' +
      'Return max 3 items.';

    try {
      var cd = await callClaude(
        [{ role: 'user', content: cp }],
        [{ type: 'web_search_20250305', name: 'web_search' }],
        800
      );
      var cm = safeParse(extractText(cd), [], true);
      if (Array.isArray(cm)) mentions = mentions.concat(cm);
    } catch (e) {
      onTrace('Skipped ' + comp + ' (rate limit — will use primary data)');
    }
  }

  if (mentions.length === 0) {
    throw new Error('No mentions found. Try a well-known brand like Nike or Apple first.');
  }

  onTrace('Filed ' + mentions.length + ' mentions');
  return mentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Pausing before sentiment analysis...');
  await sleep(8000); /* 8s pause so TPM window resets */
  onTrace('Scoring sentiment + Share of Voice');

  var allBrands = [brand].concat(competitors);

  /* Send only the bare minimum needed for scoring */
  var trimmed = mentions.slice(0, 15).map(function(m, i) {
    return i + '|' + (m.brand || brand) + '|' + (m.channel || 'web') + '|' + (m.snippet || m.title || '').slice(0, 60);
  }).join('\n');

  var brandList = allBrands.map(function(b) { return '"' + b + '"'; }).join(',');

  var prompt =
    'Sentiment analysis for brand "' + brand + '"' +
    (competitors.length ? ' vs ' + competitors.join(', ') : '') + '.\n\n' +
    'Mentions (index|brand|channel|snippet):\n' + trimmed + '\n\n' +
    'Return ONLY this JSON structure:\n' +
    '{\n' +
    '"scored":[{"index":0,"brand":"x","sentiment":"positive","score":0.5,"rationale":"brief"}],\n' +
    '"share_of_voice":[{"brand":"x","mention_count":1,"percent":100}],\n' +
    '"sentiment_breakdown":{"BrandName":{"positive":1,"neutral":0,"negative":0,"net_sentiment":1}},\n' +
    '"channel_split":{"web":1,"social":0},\n' +
    '"themes":[{"theme":"x","sentiment":"positive","frequency":1}]\n' +
    '}\n\n' +
    'Rules: share_of_voice must include ' + brandList + '. Percents sum 100. Max 4 themes. No extra text.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = safeParse(extractText(data), null);
  if (!result || !result.scored) {
    console.error('Agent 2 raw:', extractText(data).slice(0, 600));
    throw new Error('Sentiment analyst returned malformed output. Check browser console.');
  }

  var sov = result.share_of_voice || [];
  var pri = sov.find(function(s) { return s.brand && s.brand.toLowerCase() === brand.toLowerCase(); });
  if (pri) onTrace('SoV for ' + brand + ': ' + pri.percent.toFixed(1) + '%');
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Pausing before report...');
  await sleep(8000); /* 8s pause */
  onTrace('Synthesizing report');

  var today = todayFormatted();
  var sov = (analysis.share_of_voice || []).map(function(s) {
    return s.brand + ':' + s.percent.toFixed(0) + '%';
  }).join(' ');
  var pb = (analysis.sentiment_breakdown || {})[brand] ||
           (analysis.sentiment_breakdown || {})[Object.keys(analysis.sentiment_breakdown || {})[0]] || {};
  var themes = (analysis.themes || []).map(function(t) { return t.theme; }).join(', ');

  var summary =
    'Brand: ' + brand + ' | Date: ' + today + ' | Mentions: ' + mentions.length + '\n' +
    'SoV: ' + sov + '\n' +
    'Sentiment: pos=' + (pb.positive||0) + ' neu=' + (pb.neutral||0) + ' neg=' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    'Themes: ' + themes +
    (competitors.length ? '\nCompetitors: ' + competitors.join(', ') : '');

  var prompt =
    'Write a brand intelligence briefing. Data:\n' + summary + '\n\n' +
    'Return ONLY this JSON — fill every field with real content based on the data:\n' +
    '{"headline":"...","executive_summary":"...","key_findings":["...","...","..."],' +
    '"share_of_voice_analysis":"...","sentiment_analysis":"...",' +
    '"themes_analysis":"...","competitive_positioning":"...",' +
    '"recent_highlights":["...","...","..."],"earned_media_note":"...",' +
    '"risks":["...","..."],"opportunities":["...","..."],"recommendations":["...","...","..."]}';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var report = safeParse(extractText(data), null);
  if (!report) {
    console.error('Agent 3 raw:', extractText(data).slice(0, 600));
    throw new Error('Bureau chief returned malformed report. Check browser console.');
  }

  onTrace('Briefing finalized');
  return report;
}
