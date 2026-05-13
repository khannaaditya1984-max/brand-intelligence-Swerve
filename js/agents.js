/* ================================================================
   agents.js — Brand Intelligence Agents
   Searches: web news, social platforms, retailer pages, reviews
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

function getTextFromResponse(data) {
  return ((data.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n'));
}

/* Walk text extracting every valid JSON object */
function extractObjects(text) {
  var results = [], i = 0;
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

function parseResponse(raw, expectArray) {
  var cleaned = raw.replace(/```json|```/g, '').trim();
  // Try direct parse first
  var so = cleaned.indexOf('{'), sa = cleaned.indexOf('[');
  var first = sa !== -1 && (so === -1 || sa < so) ? sa : so;
  if (first !== -1) {
    var open = cleaned[first], close = open === '{' ? '}' : ']';
    var depth = 0, inStr = false, esc = false, end = -1;
    for (var i = first; i < cleaned.length; i++) {
      var c = cleaned[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) { try { return JSON.parse(cleaned.slice(first, end + 1)); } catch(e) {} }
  }
  // Fallback: extract objects
  if (expectArray) {
    var objs = extractObjects(cleaned);
    if (objs.length > 0) return objs;
  }
  return null;
}

/* Run one web_search call and return parsed mention array */
async function runSearch(searchPrompt, brandName, maxTok) {
  var data = await callClaude(
    [{ role: 'user', content: searchPrompt }],
    [{ type: 'web_search_20250305', name: 'web_search' }],
    maxTok || 1200
  );
  var raw = getTextFromResponse(data);
  console.log('[' + brandName + '] raw:', raw.slice(0, 200));
  var found = parseResponse(raw, true);
  if (!Array.isArray(found)) {
    var objs = extractObjects(raw);
    found = objs.filter(function(o) { return o.title || o.source; });
  }
  if (!Array.isArray(found)) found = [];
  return found.filter(function(m) { return m && (m.title || m.source); }).map(function(m) {
    return {
      brand:   brandName,
      source:  m.source  || 'Unknown',
      channel: m.channel || 'web',
      type:    m.type    || 'news',
      title:   m.title   || '',
      snippet: m.snippet || '',
      url:     m.url     || '',
      date:    m.date    || ''
    };
  });
}

/* ── AGENT 01: FIELD OPERATIVE ── */
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Starting intelligence sweep');
  var year = new Date().getFullYear();
  var allMentions = [];
  var schema = '{"source":"<name>","channel":"web"|"social","type":"news"|"social"|"review"|"retail","title":"<title>","snippet":"<paraphrased 12 words>","url":"<url>","date":"<YYYY-MM-DD or empty>"}';

  // ── 1. News & web mentions for primary brand ──
  onTrace('Searching news: ' + brand);
  var newsResults = await runSearch(
    'Search for recent news articles about "' + brand + '" in ' + year + '. Run 2 searches.\n' +
    'Output ONLY a JSON array. Each item: ' + schema + '\nSet channel="web" type="news". Max 5 items. Paraphrase snippets.',
    brand, 1500
  );
  allMentions = allMentions.concat(newsResults);
  onTrace('News: ' + newsResults.length + ' results');

  await sleep(10000);

  // ── 2. Social media mentions ──
  onTrace('Searching social: Reddit, TikTok, YouTube');
  var socialResults = await runSearch(
    'Search for "' + brand + '" mentions on Reddit site:reddit.com, then "' + brand + '" TikTok reviews, then "' + brand + '" YouTube review ' + year + '.\n' +
    'Output ONLY a JSON array. Each item: ' + schema + '\nSet channel="social". Include platform as source (Reddit/TikTok/YouTube). Max 5 items. Paraphrase snippets.',
    brand, 1500
  );
  allMentions = allMentions.concat(socialResults);
  onTrace('Social: ' + socialResults.length + ' results');

  await sleep(10000);

  // ── 3. Retailer mentions (Walmart, Target, Kohls) ──
  onTrace('Searching retailers: Walmart, Target, Kohls');
  var retailResults = await runSearch(
    'Search for "' + brand + ' walmart", then "' + brand + ' target", then "' + brand + ' kohls".\n' +
    'Output ONLY a JSON array. Each item: ' + schema + '\nSet channel="web" type="retail". Source = the retailer name. Max 5 items. Paraphrase snippets.',
    brand, 1500
  );
  allMentions = allMentions.concat(retailResults);
  onTrace('Retail: ' + retailResults.length + ' results');

  await sleep(10000);

  // ── 4. Customer reviews & testimonials ──
  onTrace('Searching reviews & testimonials');
  var reviewResults = await runSearch(
    'Search for "' + brand + ' review" customer opinions, then "' + brand + ' reddit review" user experiences.\n' +
    'Output ONLY a JSON array. Each item: ' + schema + '\nSet channel="social" type="review". Focus on genuine customer quotes and experiences. Max 5 items. Paraphrase snippets.',
    brand, 1500
  );
  allMentions = allMentions.concat(reviewResults);
  onTrace('Reviews: ' + reviewResults.length + ' results');

  // ── 5. Competitors (with pause) ──
  for (var i = 0; i < competitors.length; i++) {
    var comp = competitors[i];
    onTrace('Pausing 12s then searching: ' + comp);
    await sleep(12000);
    var compResults = await runSearch(
      'Search for recent news about "' + comp + '" in ' + year + '. Run 1 search.\n' +
      'Output ONLY a JSON array. Each item: ' + schema + '\nMax 3 items. Paraphrase snippets.',
      comp, 800
    );
    allMentions = allMentions.concat(compResults);
    onTrace(comp + ': ' + compResults.length + ' results');
  }

  if (allMentions.length === 0) throw new Error('No mentions found. Check browser console.');

  // Final count
  var allBrands = [brand].concat(competitors);
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  allMentions.forEach(function(m) { counts[m.brand] = (counts[m.brand] || 0) + 1; });
  onTrace('Total: ' + allMentions.length + ' — ' + allBrands.map(function(b) { return b + '=' + (counts[b]||0); }).join(', '));

  // Type breakdown
  var byType = {};
  allMentions.forEach(function(m) { byType[m.type] = (byType[m.type]||0)+1; });
  onTrace('Types: ' + Object.keys(byType).map(function(t) { return t+'='+byType[t]; }).join(', '));

  return allMentions;
}

/* ── AGENT 02: SENTIMENT + SOV ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Pausing 12s before sentiment...');
  await sleep(12000);
  onTrace('Scoring sentiment');

  var allBrands = [brand].concat(competitors);

  // Count per brand — source of truth
  var counts = {};
  allBrands.forEach(function(b) { counts[b] = 0; });
  mentions.forEach(function(m) {
    var matched = allBrands.find(function(b) { return b.toLowerCase() === (m.brand||'').toLowerCase(); });
    if (matched) counts[matched]++;
  });
  var total = mentions.length || 1;
  onTrace('Counts: ' + allBrands.map(function(b) { return b+'='+counts[b]; }).join(', '));

  // Score only primary brand mentions
  var primaryMentions = mentions.filter(function(m) {
    return m.brand && m.brand.toLowerCase() === brand.toLowerCase();
  });
  var lines = primaryMentions.slice(0, 15).map(function(m, i) {
    return i + '|' + (m.type||'news') + '|' + (m.snippet || m.title || '').slice(0, 70);
  }).join('\n');

  // Extract testimonials separately
  var testimonials = mentions.filter(function(m) {
    return m.brand.toLowerCase() === brand.toLowerCase() && (m.type === 'review' || m.channel === 'social');
  }).slice(0, 8);

  var prompt =
    'Score sentiment for these ' + brand + ' mentions:\n\n' +
    lines + '\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"scored":[{"index":0,"type":"news","sentiment":"positive","score":0.5,"rationale":"reason from text"}],' +
    '"themes":[{"theme":"topic","sentiment":"positive","frequency":2}],' +
    '"retail_sentiment":{"walmart":"positive"|"neutral"|"negative"|"no data",' +
      '"target":"positive"|"neutral"|"negative"|"no data",' +
      '"kohls":"positive"|"neutral"|"negative"|"no data"},' +
    '"top_testimonials":[{"quote":"paraphrased customer sentiment","sentiment":"positive","source":"platform"}]}\n\n' +
    'Rules: score from text only. Max 4 themes. Max 3 testimonials from review/social mentions. retail_sentiment from any retail mentions found.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = parseResponse(getTextFromResponse(data), false);
  if (!result || !result.scored) {
    var objs = extractObjects(getTextFromResponse(data));
    result = objs.find(function(o) { return o.scored; }) || { scored: [], themes: [] };
  }

  // Add testimonials from raw data if model missed them
  if (!result.top_testimonials || result.top_testimonials.length === 0) {
    result.top_testimonials = testimonials.slice(0, 3).map(function(m) {
      return { quote: m.snippet || m.title, sentiment: 'positive', source: m.source };
    });
  }

  // Compute SoV in code
  result.share_of_voice = allBrands.map(function(b) {
    var c = counts[b] || 0;
    return { brand: b, mention_count: c, percent: parseFloat(((c/total)*100).toFixed(1)) };
  });

  // Compute sentiment breakdown in code
  var breakdown = {};
  allBrands.forEach(function(b) { breakdown[b] = { positive:0, neutral:0, negative:0, net_sentiment:0 }; });
  (result.scored||[]).forEach(function(s) {
    var bd = breakdown[brand];
    if (bd && s.sentiment) bd[s.sentiment]++;
  });
  allBrands.forEach(function(b) {
    var bd = breakdown[b], t = (bd.positive+bd.neutral+bd.negative)||1;
    bd.net_sentiment = parseFloat(((bd.positive-bd.negative)/t).toFixed(2));
  });
  result.sentiment_breakdown = breakdown;

  result.channel_split = {
    web:    mentions.filter(function(m) { return m.channel==='web'; }).length,
    social: mentions.filter(function(m) { return m.channel==='social'; }).length
  };

  result.type_split = {
    news:   mentions.filter(function(m) { return m.type==='news'; }).length,
    social: mentions.filter(function(m) { return m.type==='social'; }).length,
    review: mentions.filter(function(m) { return m.type==='review'; }).length,
    retail: mentions.filter(function(m) { return m.type==='retail'; }).length
  };

  result.share_of_voice.forEach(function(s) {
    onTrace('SoV ' + s.brand + ': ' + s.percent + '% (' + s.mention_count + ')');
  });
  onTrace('Types: news=' + result.type_split.news + ' social=' + result.type_split.social + ' reviews=' + result.type_split.review + ' retail=' + result.type_split.retail);
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Pausing 12s before report...');
  await sleep(12000);
  onTrace('Writing report');

  var today  = todayFormatted();
  var sov    = (analysis.share_of_voice||[]).map(function(s) { return s.brand+': '+s.percent+'% ('+s.mention_count+')'; }).join(', ');
  var pb     = (analysis.sentiment_breakdown||{})[brand] || {};
  var themes = (analysis.themes||[]).map(function(t) { return t.theme+'('+t.sentiment+')'; }).join(', ');
  var retailSent = analysis.retail_sentiment || {};
  var testimonials = (analysis.top_testimonials||[]).map(function(t) { return '"'+t.quote+'" — '+t.source; }).join('\n');
  var typeSplit = analysis.type_split || {};

  var prompt =
    'Brand intelligence briefing for "' + brand + '" — ' + today + '.\n\n' +
    'DATA:\n' +
    '- Total mentions: ' + mentions.length + ' (news=' + (typeSplit.news||0) + ' social=' + (typeSplit.social||0) + ' reviews=' + (typeSplit.review||0) + ' retail=' + (typeSplit.retail||0) + ')\n' +
    '- Share of Voice: ' + sov + '\n' +
    '- Sentiment: pos=' + (pb.positive||0) + ' neu=' + (pb.neutral||0) + ' neg=' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    '- Themes: ' + (themes||'none') + '\n' +
    '- Retailer sentiment: Walmart=' + (retailSent.walmart||'no data') + ' Target=' + (retailSent.target||'no data') + ' Kohls=' + (retailSent.kohls||'no data') + '\n' +
    '- Customer testimonials:\n' + (testimonials||'none found') + '\n' +
    (competitors.length ? '- Competitors: ' + competitors.join(', ') + '\n' : '') +
    '\nReturn ONLY valid JSON:\n' +
    '{\n' +
    '  "headline": "<one punchy sentence>",\n' +
    '  "executive_summary": "<2 sentences present tense>",\n' +
    '  "key_findings": ["<finding with numbers>","<finding>","<finding>"],\n' +
    '  "share_of_voice_analysis": "<2 sentences with exact %s>",\n' +
    '  "sentiment_analysis": "<2 sentences with exact numbers>",\n' +
    '  "themes_analysis": "<1 sentence>",\n' +
    '  "competitive_positioning": "<2 sentences vs ' + (competitors.join(', ')||'market') + '>",\n' +
    '  "testimonial_insights": "<2 sentences summarising what real customers say — use the testimonials above>",\n' +
    '  "retail_analysis": "<2 sentences on Walmart/Target/Kohls performance and opportunities>",\n' +
    '  "recent_highlights": ["<highlight>","<highlight>","<highlight>"],\n' +
    '  "earned_media_note": "<1 sentence>",\n' +
    '  "risks": ["<risk>","<risk>"],\n' +
    '  "opportunities": ["<opp>","<opp>"],\n' +
    '  "marketing_recommendations": [\n' +
    '    {"channel":"Retail Media (Walmart Connect / Target Roundel / Kohls)","recommendation":"<specific sponsored product or display placement strategy with audience targeting based on retailer data>","rationale":"<why based on retailer sentiment data>"},\n' +
    '    {"channel":"Paid Social — Meta & TikTok","recommendation":"<specific campaign idea with audience segments, ad formats, and messaging hooks drawn from themes and testimonials>","rationale":"<why>"},\n' +
    '    {"channel":"Google Search & Shopping","recommendation":"<specific keyword strategy, bidding approach, and product listing optimisation based on how customers search>","rationale":"<why>"},\n' +
    '    {"channel":"Creative Direction","recommendation":"<specific ad creative hooks and messaging angles drawn directly from the customer testimonials found — what to say, how to say it>","rationale":"<why based on testimonials>"},\n' +
    '    {"channel":"Programmatic & Retargeting","recommendation":"<specific display retargeting strategy — audience segments, messaging by funnel stage, placements>","rationale":"<why>"}\n' +
    '  ]\n' +
    '}';

  var data   = await callClaude([{ role: 'user', content: prompt }], null, 2000);
  var report = parseResponse(getTextFromResponse(data), false);
  if (!report) {
    var objs = extractObjects(getTextFromResponse(data));
    report = objs.find(function(o) { return o.headline; }) || null;
    if (!report) throw new Error('Report generation failed. Check browser console.');
  }

  onTrace('Report ready');
  return report;
}
