'use strict';

/**
 * create-checkout-session.js
 * Uses native fetch to call Stripe API — no stripe npm package needed.
 * This avoids all bundling/module issues.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const PACKAGE_TO_INTENT = {
  rebuild: 'rebuild_deposit',
  system:  'conversion_system_deposit',
};

const INTENT_TO_PRICE_ENV = {
  rebuild_deposit:           'STRIPE_PRICE_REBUILD',
  conversion_system_deposit: 'STRIPE_PRICE_SYSTEM',
  subscription:              'STRIPE_PRICE_MONTHLY',
};

async function stripePost(path, params, secretKey) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Resolve intent from packageKey or intent
  let intent = body.intent || null;
  if (!intent && body.packageKey) intent = PACKAGE_TO_INTENT[body.packageKey] || null;

  if (!intent || !INTENT_TO_PRICE_ENV[intent]) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown package: packageKey="${body.packageKey}" intent="${body.intent}"` }) };
  }

  const priceId = process.env[INTENT_TO_PRICE_ENV[intent]];
  if (!priceId) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: `Missing env var: ${INTENT_TO_PRICE_ENV[intent]}` }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }) };
  }

  const { name, email, websiteUrl, notes } = body;
  if (!email) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email is required' }) };

  const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://tradeconvert.co.uk').replace(/\/$/, '');

  try {
    const session = await stripePost('/checkout/sessions', {
      mode:                        'payment',
      customer_email:              email.toLowerCase(),
      'line_items[0][price]':      priceId,
      'line_items[0][quantity]':   1,
      'metadata[intent]':          intent,
      'metadata[name]':            String(name || '').slice(0, 500),
      'metadata[email]':           email.toLowerCase(),
      'metadata[website_url]':     String(websiteUrl || '').slice(0, 500),
      'metadata[notes]':           String(notes || '').slice(0, 500),
      'payment_intent_data[metadata][intent]': intent,
      success_url:                 `${siteUrl}/?payment=success&intent=${intent}`,
      cancel_url:                  `${siteUrl}/#pricing`,
    }, secretKey);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url: session.url, session_id: session.id }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
