// netlify/functions/claude.js
exports.handler = async function(event) {

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Try every possible env var name variation
  var apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.anthropic_api_key ||
    process.env.ANTHROPIC_KEY ||
    '';

  // Strip any accidental whitespace or quotes
  apiKey = apiKey.trim().replace(/^["']|["']$/g, '');

  if (!apiKey || apiKey.length < 20) {
    // Return debug info so we can see what env vars ARE available
    var envKeys = Object.keys(process.env)
      .filter(function(k) { return !k.includes('npm') && !k.includes('PATH'); })
      .sort();
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: {
          message: 'ANTHROPIC_API_KEY not found. Available env vars: ' + envKeys.join(', ')
        }
      })
    };
  }

  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: event.body
    });

    var data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: data
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};
