'use strict';

/**
 * scan-chat.js
 * POST /.netlify/functions/scan-chat
 *
 * Always returns HTTP 200 — errors go in the reply field so the UI
 * handles them as chat messages rather than network failures.
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function respond(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

function buildSystem(ctx) {
  const score  = Number(ctx?.score) || null;
  const url    = ctx?.url    || 'their website';
  const trade  = ctx?.trade  || 'bathroom fitter';
  const issues = Array.isArray(ctx?.issues) ? ctx.issues : [];
  const cats   = ctx?.categories || {};

  const scoreLine = score !== null ? `${score}/100` : 'unknown';

  const issueList = issues.length
    ? issues.slice(0, 5).map(i => `- ${i}`).join('\n')
    : '- No specific issues provided';

  const catLines = Object.entries(cats)
    .map(([k, v]) => {
      const labels = { speed:'Speed', mobileClarity:'Mobile', ctaStrength:'CTA', trustSignals:'Trust', localRelevance:'Local SEO' };
      return `- ${labels[k] || k}: ${v}/20`;
    })
    .join('\n');

  const scoreContext = score !== null
    ? `Overall score: ${scoreLine}${score < 45 ? ' (poor — site is likely losing significant work)' : score < 70 ? ' (fair — room for clear improvement)' : ' (good — some refinement possible)'}`
    : 'Score not available';

  return `You are a friendly website expert for TradeConvert, a UK web agency building websites for bathroom fitters.

A bathroom fitter has just scanned their website and you are helping them understand what the results mean.

THEIR SCAN RESULTS:
URL: ${url}
Trade: ${trade}
${scoreContext}
${catLines ? `\nCategory scores (each out of 20):\n${catLines}` : ''}
${issues.length ? `\nMain issues found:\n${issueList}` : ''}

YOUR ROLE:
- Explain the score and issues in plain English — no jargon
- Be direct and honest about what it means for their business
- For poor scores (under 45): be clear a rebuild would likely get them more jobs
- For fair scores (45-70): explain specifically what's holding them back
- For good scores (70+): acknowledge it and suggest what could push it further
- If they ask about pricing: Website Rebuild is £1,500 (£150 deposit), Website + Conversion System is £3,000 (£300 deposit)
- If they're ready to proceed: tell them to click "Get my site fixed" button above
- Keep answers short — 2-4 sentences unless they ask for detail
- UK English only

Do not replace the sales CTA. Do not be generic. Answer based on their actual scan results.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond({});
  if (event.httpMethod !== 'POST')   return respond({ reply: 'Invalid request.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('scan-chat: ANTHROPIC_API_KEY not set');
    return respond({ reply: 'AI chat is temporarily unavailable. Please try again later or click "Get my site fixed" above.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond({ reply: 'Invalid request.' }); }

  const { messages, scan_context } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return respond({ reply: "I'm ready — ask me anything about your scan results." });
  }

  const trimmed = messages.slice(-8).filter(m => m.role && m.content);
  if (!trimmed.length || trimmed[0].role !== 'user') {
    return respond({ reply: "I'm ready — ask me anything about your scan results." });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 280,
        system:     buildSystem(scan_context || {}),
        messages:   trimmed,
      }),
    });

    const rawText = await anthropicRes.text();

    if (!anthropicRes.ok) {
      console.error('Anthropic error', anthropicRes.status, rawText);
      const fallback =
        anthropicRes.status === 401 ? 'AI key is invalid — please contact TradeConvert.' :
        anthropicRes.status === 429 ? 'Too many requests — please wait a moment and try again.' :
        'AI is temporarily unavailable. Please try again in a moment.';
      return respond({ reply: fallback });
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { return respond({ reply: "Couldn't generate a response. Please try again." }); }

    const reply = data?.content?.[0]?.text || "Couldn't generate a response. Please try again.";
    return respond({ reply });

  } catch (err) {
    console.error('scan-chat error:', err.message);
    return respond({ reply: 'Connection error. Please try again.' });
  }
};
