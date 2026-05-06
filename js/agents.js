/* ================================================================
   agents.js — Three Claude-powered agents (token-optimised)
   ================================================================ */

async function callClaude(messages, tools, maxTokens) {
  var apiKey = window.ANTHROPIC_KEY || '';
  if (!apiKey) throw new Error('No API key set. Please enter your Anthropic API key.');

  var body = {
    model:      'claude-sonnet-4-5',
    max_tokens: maxTokens || 2000,
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
  onTrace('"' + brand + '"' + (competitors.length ? ' + ' + competitors.length + ' competitor(s)' : ''));

  var today = todayFormatted();
  var year  = new Date().getFullYear();
  var compLine = competitors.length
    ? 'Also search for: ' + competitors.join(', ') + ' (2-3 mentions each).'
    : '';

  var prompt =
    'Brand intelligence operative. TODAY: ' + today + '.\n' +
    'Find CURRENT mentions of "' + brand + '" from last 30 days. Use year ' + year + ' in queries.\n' +
    compLine + '\n' +
    'Run 3 searches max. Cover news, Reddit, social media.\n\n' +
    'OUTPUT: ONLY a JSON array, no prose, no fences.\n' +
    'Each item: {"brand":"<n>","source":"<s>","channel":"web"|"social","title":"<t>","snippet":"<max 15 words paraphrased>","url":"<u>","date":"<YYYY-MM-DD or empty>"}\n' +
    'Max 8 items for primary brand, 3 per competitor. Short snippets only.';

  var data = await callClaude(
    [{ role: 'user', content: prompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    2000
  );

  var searches = (data.content || []).filter(function(b) { return b.type === 'server_tool_use'; }).length;
  if (searches) onTrace('Completed ' + searches + ' searches');
  onTrace('Compiling dossier');

  var mentions = safeParse(extractText(data), [], true);
  if (!Array.isArray(mentions) || mentions.length === 0) {
    console.error('Agent 1 raw:', extractText(data).slice(0, 600));
    throw new Error('No mentions found. Try a well-known brand name.');
  }

  onTrace('Filed ' + mentions.length + ' mentions');
  return mentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Scoring sentiment + Share of Voice');

  var allBrands = [brand].concat(competitors);

  // Trim mentions to keep tokens low — just brand, channel, snippet
  var trimmed = mentions.slice(0, 20).map(function(m, i) {
    return { i: i, brand: m.brand, channel: m.channel, snippet: (m.snippet || '').slice(0, 80) };
  });

  var prompt =
    'Sentiment analyst. Analyze mentions for "' + brand + '"' +
    (competitors.length ? ' vs ' + competitors.join(', ') : '') + '.\n\n' +
    'Mentions: ' + JSON.stringify(trimmed) + '\n\n' +
    'Return ONLY valid JSON, no prose:\n' +
    '{"scored":[{"index":<i>,"brand":"<b>","sentiment":"positive"|"neutral"|"negative","score":<-1to1>,"rationale":"<10 words>"}],' +
    '"share_of_voice":[{"brand":"<b>","mention_count":<n>,"percent":<0-100>}],' +
    '"sentiment_breakdown":{"<brand>":{"positive":<n>,"neutral":<n>,"negative":<n>,"net_sentiment":<n>}},' +
    '"channel_split":{"web":<n>,"social":<n>},' +
    '"themes":[{"theme":"<short>","sentiment":"positive"|"neutral"|"negative","frequency":<n>}]}\n\n' +
    'share_of_voice must include: ' + allBrands.map(function(b) { return '"'+b+'"'; }).join(',') + '. ' +
    'Percents sum to 100. Max 5 themes.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 2000);
  var result = safeParse(extractText(data), null);
  if (!result || !result.scored) {
    console.error('Agent 2 raw:', extractText(data).slice(0, 600));
    throw new Error('Sentiment analyst returned malformed output.');
  }

  var sov = result.share_of_voice || [];
  var pri = sov.find(function(s) { return s.brand && s.brand.toLowerCase() === brand.toLowerCase(); });
  if (pri) onTrace('SoV for ' + brand + ': ' + pri.percent.toFixed(1) + '%');
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Synthesizing report');

  var today = todayFormatted();
  var sov   = (analysis.share_of_voice || []).map(function(s) {
    return s.brand + ' ' + s.percent.toFixed(1) + '% (' + s.mention_count + ')';
  }).join(', ');
  var pb = (analysis.sentiment_breakdown || {})[brand] || {};

  // Send a compact summary instead of the full analysis object
  var summary =
    'Brand: ' + brand + '. Date: ' + today + '.\n' +
    'Total mentions: ' + mentions.length + '.\n' +
    'SoV: ' + sov + '.\n' +
    'Sentiment: +' + (pb.positive||0) + ' neutral:' + (pb.neutral||0) + ' -' + (pb.negative||0) + ' net:' + (pb.net_sentiment||0) + '.\n' +
    'Themes: ' + (analysis.themes||[]).map(function(t){return t.theme+'('+t.sentiment+')';}).join(', ') + '.\n' +
    (competitors.length ? 'Competitors: ' + competitors.join(', ') + '.' : '');

  var prompt =
    'Bureau chief. Write a CURRENT brand intelligence briefing.\n\n' +
    summary + '\n\n' +
    'Return ONLY valid JSON, no prose:\n' +
    '{"headline":"<one sentence now>","executive_summary":"<2 sentences>","key_findings":["<f1>","<f2>","<f3>"],' +
    '"share_of_voice_analysis":"<2 sentences with numbers>","sentiment_analysis":"<2 sentences>",' +
    '"themes_analysis":"<1 sentence>","competitive_positioning":"<2 sentences>",' +
    '"recent_highlights":["<h1>","<h2>","<h3>"],"earned_media_note":"<1 sentence>",' +
    '"risks":["<r1>","<r2>"],"opportunities":["<o1>","<o2>"],"recommendations":["<rec1>","<rec2>","<rec3>"]}';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 2000);
  var report = safeParse(extractText(data), null);
  if (!report) {
    console.error('Agent 3 raw:', extractText(data).slice(0, 600));
    throw new Error('Bureau chief returned malformed report.');
  }

  onTrace('Briefing finalized');
  return report;
}
