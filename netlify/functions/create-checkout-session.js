'use strict';

/**
 * create-checkout-session.js
 * POST /.netlify/functions/create-checkout-session
 *
 * Creates a Stripe Checkout session for:
 *   - One-off deposits (rebuild £150, conversion system £300)
 *   - Monthly subscription (£29/month) sent from owner workspace page
 *
 * Body:
 *   intent        'rebuild_deposit' | 'conversion_system_deposit' | 'subscription'
 *   name          customer name
 *   email         customer email
 *   websiteUrl    their website (for deposits)
 *   notes         optional notes
 *   prospect_id   optional — links payment to existing owner lead
 *   workspace_id  optional — links subscription to existing workspace
 */

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const PRICE_MAP = {
  rebuild_deposit:           process.env.STRIPE_PRICE_REBUILD,
  conversion_system_deposit: process.env.STRIPE_PRICE_SYSTEM,
  subscription:              process.env.STRIPE_PRICE_MONTHLY,
};

const INTENT_LABELS = {
  rebuild_deposit:           'Website Rebuild Deposit',
  conversion_system_deposit: 'Website + Conversion System Deposit',
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

  const { intent, name, email, websiteUrl, notes, prospect_id, workspace_id } = body;

  if (!intent || !PRICE_MAP[intent]) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown intent: ${intent}` }) };
  }
  if (!email) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email is required' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const siteUrl = (process.env.SITE_URL || process.env.URL || 'https://tradeconvert.co.uk').replace(/\/$/, '');
  const appUrl = 'https://tradeconvert-app.netlify.app';

  const isSubscription = intent === 'subscription';

  try {
    // Build metadata to pass through to webhook
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
      mode:                isSubscription ? 'subscription' : 'payment',
      customer_email:      email.toLowerCase(),
      line_items: [{
        price:    PRICE_MAP[intent],
        quantity: 1,
      }],
      metadata,
      success_url: isSubscription
        ? `${appUrl}/client/dashboard.html?payment=success`
        : `${siteUrl}/?payment=success&intent=${intent}`,
      cancel_url: isSubscription
        ? `${appUrl}/client/dashboard.html?payment=cancelled`
        : `${siteUrl}/#pricing`,
    };

    // For subscriptions, also attach metadata to the subscription itself
    if (isSubscription) {
      sessionParams.subscription_data = { metadata };
    }

    // For deposits, attach metadata to the payment intent
    if (!isSubscription) {
      sessionParams.payment_intent_data = { metadata };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // If we have a prospect_id, create a pending payment event immediately
    if (prospect_id && !isSubscription) {
      try {
        const supabase = getSupabase();
        await supabase.from('tradeconvert_prospect_events').insert({
          prospect_id,
          event_type: 'checkout_started',
          source:     intent,
          title:      `${INTENT_LABELS[intent]} — checkout opened`,
          payload: {
            stripe_session_id: session.id,
            intent,
            amount: intent === 'rebuild_deposit' ? 150 : 300,
          },
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
