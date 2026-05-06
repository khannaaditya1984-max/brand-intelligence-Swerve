/* ================================================================
   agents.js — Three Claude-powered agents
   API calls go to /api/claude (Netlify function) which adds the
   Anthropic API key server-side from environment variables.
   ================================================================ */

async function callClaude(messages, tools, maxTokens) {
  var apiKey = window.ANTHROPIC_KEY || '';
  if (!apiKey) throw new Error('No API key set. Please enter your Anthropic API key.');

  var body = {
    model:      'claude-sonnet-4-5',
    max_tokens: maxTokens || 4000,
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
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data;
}

/* ── AGENT 01: FIELD OPERATIVE ── */
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching to live web');
  onTrace('"' + brand + '"' + (competitors.length ? ' + ' + competitors.length + ' competitor(s)' : ''));

  var today    = todayFormatted();
  var year     = new Date().getFullYear();
  var compLine = competitors.length
    ? 'Also search for these competitors: ' + competitors.join(', ') + '. Run a dedicated search for each one.'
    : '';

  var prompt =
    'You are a brand intelligence field operative. TODAY IS ' + today + '.\n' +
    'Use the web_search tool to find CURRENT mentions of "' + brand + '" from the last 30 days.\n' +
    'Always include the year ' + year + ' in search queries for fresh results.\n' +
    'Cover: news, blogs, reviews, Reddit, Twitter/X, LinkedIn, YouTube, TikTok.\n' +
    'Run 4-6 searches total.\n' +
    compLine + '\n\n' +
    'Suggested searches:\n' +
    '  "' + brand + ' ' + year + '"\n' +
    '  "' + brand + ' ' + year + ' review"\n' +
    '  "' + brand + ' reddit ' + year + '"\n' +
    '  "' + brand + ' news ' + year + '"\n\n' +
    'CRITICAL OUTPUT RULE:\n' +
    'Your FINAL message must be ONLY a valid JSON array — no prose, no markdown fences.\n' +
    'Schema for each object:\n' +
    '{"brand":"<name>","source":"<outlet>","channel":"web" or "social","title":"<title>","snippet":"<paraphrased sentence max 25 words>","url":"<url>","date":"<YYYY-MM-DD or empty>"}\n\n' +
    'Target: 8-12 mentions for the primary brand, 3-5 per competitor.\n' +
    'ALWAYS paraphrase snippets — never copy text verbatim.';

  var data = await callClaude(
    [{ role: 'user', content: prompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    6000
  );

  var searches = (data.content || []).filter(function(b) { return b.type === 'server_tool_use'; }).length;
  if (searches) onTrace('Completed ' + searches + ' live searches');
  onTrace('Compiling mention dossier');

  var mentions = safeParse(extractText(data), [], true);
  if (!Array.isArray(mentions) || mentions.length === 0) {
    console.error('Raw agent 1 response:', extractText(data).slice(0, 800));
    throw new Error(
      'Field operative returned no mentions. ' +
      'Try a more widely-covered brand. ' +
      'Check browser console (F12) for raw response.'
    );
  }

  onTrace('Filed ' + mentions.length + ' mentions');
  return mentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Reviewing mention dossier');
  onTrace('Scoring sentiment + Share of Voice');

  var allBrands = [brand].concat(competitors);

  var prompt =
    'You are a brand intelligence sentiment analyst.\n' +
    'Analyze these mentions for "' + brand + '"' +
    (competitors.length ? ' and competitors: ' + competitors.join(', ') : '') + '.\n\n' +
    'Mentions:\n' + JSON.stringify(mentions, null, 2) + '\n\n' +
    'Return ONLY a valid JSON object — no prose, no fences:\n' +
    '{\n' +
    '  "scored": [{"index":<int>,"brand":"<name>","sentiment":"positive"|"neutral"|"negative","score":<-1 to 1>,"rationale":"<one sentence>"}],\n' +
    '  "share_of_voice": [{"brand":"<name>","mention_count":<int>,"percent":<0-100>}],\n' +
    '  "sentiment_breakdown": {"<brand>":{"positive":<int>,"neutral":<int>,"negative":<int>,"avg_score":<num>,"net_sentiment":<num>}},\n' +
    '  "channel_split": {"web":<int>,"social":<int>},\n' +
    '  "themes": [{"theme":"<short label>","sentiment":"positive"|"neutral"|"negative","frequency":<int>}]\n' +
    '}\n\n' +
    'Rules:\n' +
    '- share_of_voice must include ALL brands: ' + allBrands.map(function(b) { return '"' + b + '"'; }).join(', ') + '\n' +
    '- Percents must sum to ~100\n' +
    '- Include every brand in sentiment_breakdown (use 0s if no mentions)\n' +
    '- 4-6 themes from PRIMARY brand mentions only';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 3000);
  var result = safeParse(extractText(data), null);
  if (!result || !result.scored) {
    console.error('Raw agent 2 response:', extractText(data).slice(0, 800));
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
  onTrace('Bureau chief synthesizing live intelligence');

  var today = todayFormatted();

  var prompt =
    'You are the bureau chief writing a CURRENT brand intelligence briefing for "' + brand + '"' +
    (competitors.length ? ', benchmarked against: ' + competitors.join(', ') : '') + '.\n' +
    'Today is ' + today + '. Data gathered TODAY — write in present tense throughout.\n\n' +
    'DATA:\n' +
    JSON.stringify({ generatedOn: today, totalMentions: mentions.length, analysis: analysis }, null, 2) + '\n\n' +
    'Return ONLY a valid JSON object — no prose, no fences:\n' +
    '{\n' +
    '  "headline":                "<one striking present-tense sentence about the brand RIGHT NOW>",\n' +
    '  "executive_summary":       "<2-3 sentences — current state, present tense>",\n' +
    '  "key_findings":            ["<f1>","<f2>","<f3>","<f4>"],\n' +
    '  "share_of_voice_analysis": "<2-3 sentences citing actual numbers>",\n' +
    '  "sentiment_analysis":      "<2-3 sentences on current sentiment>",\n' +
    '  "themes_analysis":         "<2-3 sentences on what people discuss NOW>",\n' +
    '  "competitive_positioning": "<2-3 sentences vs competitors today>",\n' +
    '  "recent_highlights":       ["<notable current story 1>","<story 2>","<story 3>"],\n' +
    '  "earned_media_note":       "<1-2 sentences on media coverage>",\n' +
    '  "risks":                   ["<risk 1>","<risk 2>"],\n' +
    '  "opportunities":           ["<opp 1>","<opp 2>"],\n' +
    '  "recommendations":         ["<rec 1>","<rec 2>","<rec 3>"]\n' +
    '}\n\n' +
    'Cite actual numbers. Present tense. Confident analyst voice. No filler.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 3000);
  var report = safeParse(extractText(data), null);
  if (!report) {
    console.error('Raw agent 3 response:', extractText(data).slice(0, 800));
    throw new Error('Bureau chief returned malformed report. Check browser console.');
  }

  onTrace('Briefing finalized');
  return report;
}
