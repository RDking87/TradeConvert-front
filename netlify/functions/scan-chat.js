'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

function err(code, msg) {
  return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function buildSystem(ctx) {
  console.log("SCAN CONTEXT RECEIVED:", ctx);

  const score = Number(ctx?.score) || null;
  const url = ctx?.url || 'their website';
  const trade = ctx?.trade || 'bathroom fitter';
  const issues = Array.isArray(ctx?.issues) ? ctx.issues : [];
  const cats = ctx?.categories || {};

  const scoreLine = score ? `${score}/100` : 'unknown';

  const issueList = issues.length
    ? issues.slice(0, 5).map(i => `- ${i}`).join('\n')
    : '- No major issues detected';

  const catLines = Object.entries(cats)
    .map(([k, v]) => `- ${k}: ${v}/20`)
    .join('\n');

  return `You are a website expert helping a ${trade} understand their website performance.

SCAN RESULTS:
- Score: ${scoreLine}
- Website: ${url}

${catLines ? `Breakdown:\n${catLines}` : ''}

${issues.length ? `Issues:\n${issueList}` : ''}

Explain clearly in plain English:
- what the score means
- what’s hurting enquiries
- what should be fixed first

Keep it short (2–4 sentences).`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return err(405, 'POST only');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err(503, 'AI unavailable');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { messages, scan_context } = body;

  if (!messages || !scan_context) {
    return err(400, 'Missing messages or scan context');
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307',
        max_tokens: 250,
        system: buildSystem(scan_context),
        messages: messages.slice(-6),
      }),
    });

    const data = await res.json();
    const reply = data?.content?.[0]?.text || "Try asking again.";

    return ok({ reply });

  } catch (e) {
    console.error("SCAN CHAT ERROR:", e);
    return err(500, 'Server error');
  }
};
