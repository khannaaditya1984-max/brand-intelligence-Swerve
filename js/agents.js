/* ================================================================
   agents.js — Three Claude-powered agents (rate-limit safe)
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
async function agentScrape(brand, competitors, onTrace) {
  onTrace('Dispatching to live web');

  var year = new Date().getFullYear();
  var allMentions = [];

  /* Search each brand separately with a pause between each */
  var allBrands = [brand].concat(competitors);

  for (var bi = 0; bi < allBrands.length; bi++) {
    var thisBrand = allBrands[bi];
    var isPrimary = (bi === 0);

    if (bi > 0) {
      onTrace('Pausing before next brand...');
      await sleep(7000);
    }

    onTrace('Searching: ' + thisBrand);

    var maxItems = isPrimary ? 6 : 3;
    var prompt =
      'Search for recent mentions of "' + thisBrand + '" in ' + year + '. Run 1-2 searches.\n\n' +
      'IMPORTANT: Every item in the array must have brand = "' + thisBrand + '" exactly.\n\n' +
      'Reply with ONLY a JSON array, no other text:\n' +
      '[{"brand":"' + thisBrand + '","source":"<outlet name>","channel":"web" or "social",' +
      '"title":"<article title>","snippet":"<10 words max, paraphrased>","url":"<full url>","date":"<YYYY-MM-DD or empty>"}]\n\n' +
      'Return max ' + maxItems + ' items. brand field must always be "' + thisBrand + '".';

    try {
      var data = await callClaude(
        [{ role: 'user', content: prompt }],
        [{ type: 'web_search_20250305', name: 'web_search' }],
        isPrimary ? 1500 : 800
      );

      var found = safeParse(extractText(data), [], true);
      if (Array.isArray(found) && found.length > 0) {
        /* Force correct brand attribution in case model got it wrong */
        found = found.map(function(m) {
          m.brand = thisBrand;
          return m;
        });
        allMentions = allMentions.concat(found);
        onTrace('Found ' + found.length + ' mentions for ' + thisBrand);
      } else {
        onTrace('No results for ' + thisBrand + ' — skipping');
      }
    } catch (e) {
      onTrace('Search failed for ' + thisBrand + ': ' + e.message.slice(0, 60));
    }
  }

  if (allMentions.length === 0) {
    throw new Error('No mentions found. Try a well-known brand like Nike or Apple first.');
  }

  /* Log breakdown so we can verify attribution */
  var breakdown = {};
  allMentions.forEach(function(m) {
    breakdown[m.brand] = (breakdown[m.brand] || 0) + 1;
  });
  onTrace('Breakdown: ' + Object.keys(breakdown).map(function(k) { return k + '=' + breakdown[k]; }).join(', '));

  return allMentions;
}

/* ── AGENT 02: SENTIMENT ANALYST ── */
async function agentSentiment(brand, competitors, mentions, onTrace) {
  onTrace('Pausing before sentiment analysis...');
  await sleep(8000);
  onTrace('Scoring sentiment + Share of Voice');

  var allBrands = [brand].concat(competitors);

  /* Count actual mentions per brand from Agent 1 data */
  var actualCounts = {};
  allBrands.forEach(function(b) { actualCounts[b] = 0; });
  mentions.forEach(function(m) {
    var mb = m.brand || brand;
    /* Match brand name case-insensitively */
    var matchedBrand = allBrands.find(function(b) {
      return b.toLowerCase() === mb.toLowerCase();
    });
    if (matchedBrand) actualCounts[matchedBrand]++;
  });

  var totalMentions = mentions.length || 1;
  onTrace('Mention counts: ' + Object.keys(actualCounts).map(function(k) { return k + '=' + actualCounts[k]; }).join(', '));

  /* Build trimmed mention list for scoring */
  var trimmed = mentions.slice(0, 15).map(function(m, i) {
    return i + '|' + (m.brand || brand) + '|' + (m.channel || 'web') + '|' + (m.snippet || m.title || '').slice(0, 60);
  }).join('\n');

  var brandList = allBrands.map(function(b) { return '"' + b + '"'; }).join(',');

  /* Pre-compute SoV from actual counts so agent can't get it wrong */
  var precomputedSoV = allBrands.map(function(b) {
    var count = actualCounts[b] || 0;
    var pct   = Math.round((count / totalMentions) * 100);
    return '{"brand":"' + b + '","mention_count":' + count + ',"percent":' + pct + '}';
  }).join(',');

  var prompt =
    'Sentiment analysis. Brand: "' + brand + '"' +
    (competitors.length ? ' vs ' + competitors.join(', ') : '') + '.\n\n' +
    'Mentions (index|brand|channel|snippet):\n' + trimmed + '\n\n' +
    'The share_of_voice is already calculated — use EXACTLY these values:\n' +
    '[' + precomputedSoV + ']\n\n' +
    'Return ONLY this JSON structure, no other text:\n' +
    '{\n' +
    '"scored":[{"index":0,"brand":"x","sentiment":"positive","score":0.5,"rationale":"brief"}],\n' +
    '"share_of_voice":[' + precomputedSoV + '],\n' +
    '"sentiment_breakdown":{' + allBrands.map(function(b) {
      return '"' + b + '":{"positive":0,"neutral":0,"negative":0,"net_sentiment":0}';
    }).join(',') + '},\n' +
    '"channel_split":{"web":0,"social":0},\n' +
    '"themes":[{"theme":"x","sentiment":"positive","frequency":1}]\n' +
    '}\n\n' +
    'Fill in scored, sentiment_breakdown, channel_split and themes based on the mentions. ' +
    'Do NOT change share_of_voice — use the values above exactly. Max 4 themes.';

  var data = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var result = safeParse(extractText(data), null);

  if (!result || !result.scored) {
    console.error('Agent 2 raw:', extractText(data).slice(0, 600));
    throw new Error('Sentiment analyst returned malformed output.');
  }

  /* Always enforce correct SoV from our own counts — never trust model for this */
  result.share_of_voice = allBrands.map(function(b) {
    var count = actualCounts[b] || 0;
    var pct   = parseFloat(((count / totalMentions) * 100).toFixed(1));
    return { brand: b, mention_count: count, percent: pct };
  });

  var pri = result.share_of_voice.find(function(s) { return s.brand.toLowerCase() === brand.toLowerCase(); });
  if (pri) onTrace('SoV for ' + brand + ': ' + pri.percent.toFixed(1) + '%');
  onTrace('Analysis complete');
  return result;
}

/* ── AGENT 03: BUREAU CHIEF ── */
async function agentReport(brand, competitors, mentions, analysis, onTrace) {
  onTrace('Pausing before report...');
  await sleep(8000);
  onTrace('Synthesizing report');

  var today = todayFormatted();
  var sov   = (analysis.share_of_voice || []).map(function(s) {
    return s.brand + ':' + s.percent.toFixed(0) + '%(' + s.mention_count + ')';
  }).join(' ');
  var pb     = getPrimaryBreakdown(brand) || {};
  var themes = (analysis.themes || []).map(function(t) { return t.theme; }).join(', ');

  var summary =
    'Brand: ' + brand + ' | Date: ' + today + ' | Total mentions: ' + mentions.length + '\n' +
    'Share of Voice: ' + sov + '\n' +
    'Sentiment: pos=' + (pb.positive||0) + ' neu=' + (pb.neutral||0) + ' neg=' + (pb.negative||0) + ' net=' + (pb.net_sentiment||0) + '\n' +
    'Themes: ' + (themes || 'none') +
    (competitors.length ? '\nCompetitors tracked: ' + competitors.join(', ') : '');

  var prompt =
    'Write a brand intelligence briefing based on this data:\n' + summary + '\n\n' +
    'Return ONLY valid JSON, no other text:\n' +
    '{"headline":"<one punchy sentence about ' + brand + ' right now>",' +
    '"executive_summary":"<2 sentences current state>",' +
    '"key_findings":["<finding 1>","<finding 2>","<finding 3>"],' +
    '"share_of_voice_analysis":"<2 sentences — reference the actual SoV percentages above>",' +
    '"sentiment_analysis":"<2 sentences>",' +
    '"themes_analysis":"<1 sentence>",' +
    '"competitive_positioning":"<2 sentences comparing ' + brand + ' to ' + (competitors.join(', ') || 'the market') + '>",' +
    '"recent_highlights":["<highlight 1>","<highlight 2>","<highlight 3>"],' +
    '"earned_media_note":"<1 sentence>",' +
    '"risks":["<risk 1>","<risk 2>"],' +
    '"opportunities":["<opportunity 1>","<opportunity 2>"],' +
    '"recommendations":["<rec 1>","<rec 2>","<rec 3>"]}';

  var data   = await callClaude([{ role: 'user', content: prompt }], null, 1500);
  var report = safeParse(extractText(data), null);

  if (!report) {
    console.error('Agent 3 raw:', extractText(data).slice(0, 600));
    throw new Error('Bureau chief returned malformed report.');
  }

  onTrace('Briefing finalized');
  return report;
}
