'use strict';

/**
 * scan-chat.js
 * POST /.netlify/functions/scan-chat
 *
 * AI chat proxy for the post-scan conversation on the TradeConvert front site.
 * Receives the user's scan data + conversation history.
 * Returns an AI reply that references their actual results.
 *
 * Body:
 *   messages      array   Conversation history [{role, content}]
 *   scan_context  object  Score, issues, URL, trade from their scan
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function ok(body)  { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function err(code, msg) { return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) }; }

function buildSystem(ctx) {
  const score  = ctx?.score  ?? 'unknown';
  const url    = ctx?.url    ?? 'their website';
  const trade  = ctx?.trade  ?? 'bathroom fitter';
  const issues = Array.isArray(ctx?.issues) ? ctx.issues : [];
  const cats   = ctx?.categories || {};
  const summary = ctx?.summary || {};

  const cleanIssues = issues.map(function(i){
    if (!i) return null;
    if (typeof i === 'string') return i;
    if (typeof i === 'object' && i.issue) return i.issue;
    if (typeof i === 'object' && i.title && i.description) return i.title + ': ' + i.description;
    if (typeof i === 'object' && i.title) return i.title;
    return String(i);
  }).filter(Boolean);

  const issueList = cleanIssues.length
    ? cleanIssues.slice(0, 8).map(i => `- ${i}`).join('\n')
    : '- No specific issues detected';

  const catLines = Object.entries(cats)
    .map(([k, v]) => `- ${k}: ${typeof v === 'number' ? v : (v?.score ?? 0)}/20`)
    .join('\n');

  return `You are a friendly website expert working for TradeConvert, a UK web agency that builds websites for bathroom fitters.

A bathroom fitter has just scanned their website (${url}) and you can see their results. You are having a short conversation to help them understand what their score means and whether a rebuild makes sense.

THEIR SCAN RESULTS:
- Overall score: ${score}/100
- URL scanned: ${url}
- Trade: ${trade}
${catLines ? `Score breakdown:\n${catLines}` : ''}
${issues.length ? `Main issues found:\n${issueList}` : ''}

YOUR ROLE:
- Explain what the score and issues mean in plain English, as if talking to a busy tradesmen (not a tech person)
- Be honest and direct — don't oversell
- If their score is poor (under 45), be clear that a rebuild would likely get them more jobs
- If their score is fair (45-70), explain what's holding them back
- If their score is good (70+), acknowledge it but suggest what could push it further
- Answer questions about pricing, timelines, and what's included
- Keep answers short — 2-4 sentences max unless they ask for detail
- UK English only
- Never use jargon like "CTA" without explaining it (say "call-to-action button" or "phone button")
- If they are ready to proceed, tell them to use the "Choose Your Package" button below

PRICING (only share when asked or relevant):
- Website Rebuild: £1,500 one-off, £150 deposit to secure slot
- Website + Conversion System: £3,000 one-off, £300 deposit (includes budget estimator that filters tyre-kickers)
- Growth System: from £5,000, custom build, application required
- Monthly dashboard: £29/month (for existing clients)

TURNAROUND: First draft in 48-72 hours, refine after.

Do not make up specific statistics or promises you cannot verify. Be helpful, brief, and honest.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST')   return err(405, 'POST only');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err(503, 'Chat is temporarily unavailable.');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err(400, 'Invalid JSON'); }

  const { messages, scan_context } = body;
  if (!Array.isArray(messages) || !messages.length) return err(400, 'messages required');
  console.log('scan-chat context keys:', scan_context ? Object.keys(scan_context) : []);

  // Cap history to last 8 exchanges to keep cost low
  const trimmed = messages.slice(-8);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 280,
        system:     buildSystem(scan_context),
        messages:   trimmed,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Anthropic error:', txt);
      return err(502, 'AI service unavailable. Please try again shortly.');
    }

    const data  = await res.json();
    const reply = data?.content?.[0]?.text || "I couldn't generate a response — please try again.";
    return ok({ reply });

  } catch (e) {
    console.error('scan-chat error:', e.message);
    return err(500, 'Something went wrong. Please try again.');
  }
};
