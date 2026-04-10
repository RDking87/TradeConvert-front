'use strict';

/**
 * create-checkout-session.js — FRONT SITE (tradeconvert.co.uk)
 * POST /.netlify/functions/create-checkout-session
 *
 * Called by submitBuyForm() in index.html when a visitor selects a package.
 *
 * Env vars required on the FRONT SITE Netlify site:
 *   STRIPE_SECRET_KEY     — sk_live_... (same key as app site)
 *   STRIPE_PRICE_REBUILD  — price_... for £150 deposit
 *   STRIPE_PRICE_SYSTEM   — price_... for £300 deposit
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function respond(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

const PACKAGE_TO_INTENT = {
  rebuild: 'rebuild_deposit',
  system:  'conversion_system_deposit',
};

const INTENT_TO_PRICE_ENV = {
  rebuild_deposit:           'STRIPE_PRICE_REBUILD',
  conversion_system_deposit: 'STRIPE_PRICE_SYSTEM',
};

async function stripePost(path, params, secretKey) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')   return respond(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  // Resolve intent from packageKey ('rebuild' → 'rebuild_deposit')
  let intent = body.intent || null;
  if (!intent && body.packageKey) intent = PACKAGE_TO_INTENT[body.packageKey] || null;

  if (!intent || !INTENT_TO_PRICE_ENV[intent]) {
    return respond(400, { error: 'Unknown package. Expected packageKey: rebuild or system.' });
  }

  const priceEnvVar = INTENT_TO_PRICE_ENV[intent];
  const priceId     = process.env[priceEnvVar];
  const secretKey   = process.env.STRIPE_SECRET_KEY;

  // Clear, actionable errors for missing env vars (not cryptic 500s)
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY not set on front site');
    return respond(503, {
      error: 'Payments are not yet configured. Please email info@tradeconvert.co.uk to place your order directly.'
    });
  }
  if (!priceId) {
    console.error(`${priceEnvVar} not set on front site`);
    return respond(503, {
      error: 'Payment configuration incomplete. Please email info@tradeconvert.co.uk to place your order directly.'
    });
  }

  const { name, email, websiteUrl, notes } = body;
  if (!email) return respond(400, { error: 'Email is required.' });

  const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://tradeconvert.co.uk').replace(/\/$/, '');

  try {
    const session = await stripePost('/checkout/sessions', {
      mode:                              'payment',
      customer_email:                    email.toLowerCase(),
      'line_items[0][price]':            priceId,
      'line_items[0][quantity]':         1,
      'metadata[intent]':                intent,
      'metadata[name]':                  String(name    || '').slice(0, 500),
      'metadata[email]':                 email.toLowerCase(),
      'metadata[website_url]':           String(websiteUrl || '').slice(0, 500),
      'metadata[notes]':                 String(notes   || '').slice(0, 500),
      'payment_intent_data[metadata][intent]': intent,
      success_url: `${siteUrl}/?payment=success&intent=${intent}`,
      cancel_url:  `${siteUrl}/#pricing`,
    }, secretKey);

    return respond(200, { url: session.url, session_id: session.id });

  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return respond(500, { error: err.message });
  }
};
