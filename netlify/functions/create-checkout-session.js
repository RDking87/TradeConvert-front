'use strict';

/**
 * create-checkout-session.js
 * POST /.netlify/functions/create-checkout-session
 *
 * Accepts both formats:
 *   packageKey: 'rebuild' | 'system'  (from front site buy form)
 *   intent: 'rebuild_deposit' | 'conversion_system_deposit' | 'subscription'
 *
 * Env vars needed on the FRONT site:
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_REBUILD          (price_... for £150 deposit)
 *   STRIPE_PRICE_SYSTEM           (price_... for £300 deposit)
 *   STRIPE_PRICE_MONTHLY          (price_... for £29/month)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Map packageKey (from buy form) to intent (canonical)
const PACKAGE_TO_INTENT = {
  rebuild: 'rebuild_deposit',
  system:  'conversion_system_deposit',
  growth:  null, // growth uses application form not checkout
};

// Map intent to Stripe price env var
const INTENT_TO_PRICE_ENV = {
  rebuild_deposit:           'STRIPE_PRICE_REBUILD',
  conversion_system_deposit: 'STRIPE_PRICE_SYSTEM',
  subscription:              'STRIPE_PRICE_MONTHLY',
};

const INTENT_LABELS = {
  rebuild_deposit:           'Website Rebuild Deposit — £150',
  conversion_system_deposit: 'Website + Conversion System Deposit — £300',
  subscription:              'TradeConvert Client Dashboard — £29/month',
};

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Resolve intent — accept either packageKey or intent
  let intent = body.intent || null;
  if (!intent && body.packageKey) {
    intent = PACKAGE_TO_INTENT[body.packageKey] || null;
  }

  if (!intent || !INTENT_TO_PRICE_ENV[intent]) {
    return {
      statusCode: 400, headers: CORS,
      body: JSON.stringify({ error: `Unknown package. Received packageKey="${body.packageKey}" intent="${body.intent}"` })
    };
  }

  const priceEnvKey = INTENT_TO_PRICE_ENV[intent];
  const priceId = process.env[priceEnvKey];
  if (!priceId) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: `Missing env var: ${priceEnvKey}` })
    };
  }

  const { name, email, websiteUrl, notes, prospect_id, workspace_id } = body;

  if (!email) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email is required' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://tradeconvert.co.uk').replace(/\/$/, '');
  const appUrl = 'https://tradeconvert-app.netlify.app';
  const isSubscription = intent === 'subscription';

  try {
    const metadata = {
      intent,
      name:         String(name || '').slice(0, 500),
      email:        String(email || '').toLowerCase().slice(0, 500),
      website_url:  String(websiteUrl || '').slice(0, 500),
      notes:        String(notes || '').slice(0, 500),
      prospect_id:  String(prospect_id || ''),
      workspace_id: String(workspace_id || ''),
    };

    const sessionParams = {
      mode:           isSubscription ? 'subscription' : 'payment',
      customer_email: email.toLowerCase(),
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      success_url: isSubscription
        ? `${appUrl}/client/dashboard.html?payment=success`
        : `${siteUrl}/?payment=success&intent=${intent}`,
      cancel_url: isSubscription
        ? `${appUrl}/client/dashboard.html?payment=cancelled`
        : `${siteUrl}/#pricing`,
    };

    if (isSubscription) sessionParams.subscription_data = { metadata };
    if (!isSubscription) sessionParams.payment_intent_data = { metadata };

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Log checkout started event (non-fatal if this fails)
    if (prospect_id && !isSubscription) {
      try {
        await getSupabase().from('tradeconvert_prospect_events').insert({
          prospect_id,
          event_type: 'checkout_started',
          source:     intent,
          title:      `${INTENT_LABELS[intent]} — checkout opened`,
          payload:    { stripe_session_id: session.id, intent },
        });
      } catch (e) {
        console.warn('Event insert failed (non-fatal):', e.message);
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url: session.url, session_id: session.id }),
    };
  } catch (err) {
    console.error('create-checkout-session error:', err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message || 'Stripe error' }),
    };
  }
};
