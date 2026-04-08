'use strict';

/**
 * lead.js — Front website lead capture
 * POST /.netlify/functions/lead
 *
 * Accepts submissions from all forms on the front site:
 *   scanner_unlock         — free site scan / reveal
 *   rebuild_deposit        — website rebuild deposit form
 *   conversion_system_deposit — website + conversion system deposit form
 *   custom_build_application  — growth/custom build application form
 *   booking_request        — general booking / contact
 *
 * Dedupes by email (+ website if present). Creates or updates
 * tradeconvert_prospects and appends to tradeconvert_prospect_events.
 */

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── Sanitise / validate ───────────────────────────────────────────────────────

function sanitise(value, max = 400) {
  if (value == null) return '';
  return String(value).trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || '').trim());
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Intent → source mapping ───────────────────────────────────────────────────
// These are the canonical source tags used in tradeconvert_prospects.source

const INTENT_TO_SOURCE = {
  scanner_unlock:               'scanner_unlock',
  rebuild_deposit:              'rebuild_deposit',
  conversion_system_deposit:    'conversion_system_deposit',
  custom_build_application:     'custom_build_application',
  booking_request:              'booking_request',
  // Legacy fallbacks from older front site versions
  unlock:                       'scanner_unlock',
  start_now:                    'rebuild_deposit',       // generic start_now → rebuild as default
  growth_application:           'custom_build_application',
  contact:                      'booking_request',
};

function mapSource(intent) {
  return INTENT_TO_SOURCE[String(intent || '').toLowerCase()] || 'website_enquiry';
}

// ── Field derivation ──────────────────────────────────────────────────────────

function deriveWebsite(body) {
  return sanitise(
    body.websiteUrl || body.website_url || body.website || body.url
    || body.scanPayload?.websiteUrl || body.scanPayload?.url || '',
    300
  );
}

function deriveTrade(body) {
  return sanitise(body.trade || body.scanPayload?.trade || '', 120) || null;
}

function deriveBusinessName(body, websiteUrl) {
  const explicit = sanitise(body.business_name || body.businessName || '', 200);
  if (explicit) return explicit;
  if (!websiteUrl) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`)
      .hostname.replace(/^www\./i, '');
    const root = host.split('.')[0] || host;
    return root.split(/[-_]/g).filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ').slice(0, 200) || null;
  } catch {
    return null;
  }
}

function buildNotes(body) {
  const parts = [];
  const freeText = sanitise(body.notes || body.message || body.goal || '', 3000);
  if (freeText) parts.push(freeText);
  const qualifier = sanitise(body.qualifier || '', 120);
  if (qualifier) parts.push(`Qualifier: ${qualifier}`);
  const volume = sanitise(body.monthlyVolume || body.monthly_volume || body.monthlyJobsGoal || '', 120);
  if (volume) parts.push(`Monthly volume: ${volume}`);
  const toolType = sanitise(body.toolType || body.tool_type || '', 120);
  if (toolType) parts.push(`Requested system: ${toolType}`);
  return parts.join('\n\n') || null;
}

function packageSlug(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (['rebuild', 'website rebuild'].includes(v)) return 'rebuild';
  if (['system', 'conversion system', 'website + conversion system', 'website and conversion system'].includes(v)) return 'system';
  if (['growth', 'growth system', 'custom'].includes(v)) return 'growth';
  return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
}

function buildScanPayload(body) {
  if (body.scanPayload && typeof body.scanPayload === 'object' && !Array.isArray(body.scanPayload)) {
    return body.scanPayload;
  }
  const scan = {};
  const url = sanitise(body.url || body.website || body.websiteUrl || '', 300);
  const trade = sanitise(body.trade || '', 120);
  const jobs = sanitise(body.monthlyJobsGoal || body.monthlyVolume || '', 120);
  const score = (body.scoreSnapshot && typeof body.scoreSnapshot === 'object') ? body.scoreSnapshot : null;
  if (url) scan.url = url;
  if (trade) scan.trade = trade;
  if (jobs) scan.monthlyJobsGoal = jobs;
  if (score) scan.scoreSnapshot = score;
  return Object.keys(scan).length ? scan : null;
}

function buildExtraData(body) {
  const extra = {
    intent:               sanitise(body.intent, 80) || null,
    qualifier:            sanitise(body.qualifier || '', 120) || null,
    monthly_volume:       sanitise(body.monthlyVolume || body.monthly_volume || body.monthlyJobsGoal || '', 120) || null,
    package_interest:     packageSlug(body.package || body.packageKey || body.packageLabel || ''),
    application_type:     sanitise(body.applicationType || '', 120) || null,
    tool_type:            sanitise(body.toolType || body.tool_type || '', 120) || null,
    current_site_status:  sanitise(body.currentSiteStatus || '', 240) || null,
    budget_range:         sanitise(body.budgetRange || '', 120) || null,
    readiness:            sanitise(body.readiness || '', 120) || null,
    selected_option:      sanitise(body.selectedOption || body.selected_option || '', 160) || null,
    score_snapshot:       (body.scoreSnapshot && typeof body.scoreSnapshot === 'object') ? body.scoreSnapshot : null,
    raw_submission:       body,
  };
  // Strip nulls / empty objects
  Object.keys(extra).forEach(k => {
    const v = extra[k];
    if (v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)) {
      delete extra[k];
    }
  });
  return Object.keys(extra).length ? extra : null;
}

function eventTitle(intent, packageKey) {
  const map = {
    scanner_unlock:              'Scanner reveal submitted',
    rebuild_deposit:             packageKey ? `Rebuild deposit submitted (${packageKey})` : 'Rebuild deposit submitted',
    conversion_system_deposit:   packageKey ? `Conversion system deposit submitted (${packageKey})` : 'Conversion system deposit submitted',
    custom_build_application:    'Custom build application submitted',
    booking_request:             'Booking request submitted',
    // Legacy
    unlock:                      'Scanner reveal submitted',
    start_now:                   packageKey ? `Start now submitted (${packageKey})` : 'Start now submitted',
    growth_application:          'Growth application submitted',
    contact:                     'Contact enquiry submitted',
  };
  return map[String(intent || '').toLowerCase()] || 'Website enquiry submitted';
}

// ── Event insert (non-fatal) ──────────────────────────────────────────────────

async function insertProspectEvent(supabase, row) {
  try {
    const { error } = await supabase.from('tradeconvert_prospect_events').insert(row);
    if (error) throw error;
  } catch (err) {
    console.warn('tradeconvert_prospect_events insert failed:', err.message || err);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, message: 'POST only' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, message: 'Invalid JSON body' }) };
  }

  // Honeypot
  if (body.website2) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message: 'OK' }) };
  }

  const name = sanitise(body.name, 120);
  const email = sanitise(body.email, 200).toLowerCase();
  const phone = sanitise(body.phone, 40) || null;
  const intent = sanitise(body.intent, 80) || 'scanner_unlock';
  const websiteUrl = deriveWebsite(body) || null;

  if (name.length < 2) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, message: 'Please enter your name.' }) };
  }
  if (!validEmail(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, message: 'Please enter a valid email address.' }) };
  }

  try {
    const supabase = getSupabase();
    const source = mapSource(intent);
    const selectedPackage = packageSlug(body.package || body.packageKey || body.packageLabel || '');
    const notes = buildNotes(body);
    const businessName = deriveBusinessName(body, websiteUrl);
    const matchEmail = email;
    const matchWebsite = (websiteUrl || '').toLowerCase();
    const scanPayload = buildScanPayload(body);
    const extraData = buildExtraData(body);

    // Dedupe: find existing record by email (prefer matching website too)
    const { data: existingRows, error: fetchError } = await supabase
      .from('tradeconvert_prospects')
      .select('id, status, payment_status, selected_package, created_at, website_url, extra_data, notes')
      .eq('email', matchEmail)
      .order('created_at', { ascending: false })
      .limit(5);

    if (fetchError) throw fetchError;

    const existing = (existingRows || []).find(row =>
      !matchWebsite || String(row.website_url || '').toLowerCase() === matchWebsite
    ) || existingRows?.[0] || null;

    const mergedExtraData = {
      ...(existing?.extra_data && typeof existing.extra_data === 'object' ? existing.extra_data : {}),
      ...(extraData || {}),
    };

    const payload = {
      name,
      email,
      phone,
      website_url: websiteUrl,
      business_name: businessName,
      trade: deriveTrade(body),
      source,
      latest_source: source,
      latest_intent: intent,
      last_submitted_at: new Date().toISOString(),
      status: existing?.status || 'new',
      payment_status: existing?.payment_status || 'unpaid',
      selected_package: selectedPackage || existing?.selected_package || null,
      notes: notes || existing?.notes || null,
      scan_payload: scanPayload,
      extra_data: Object.keys(mergedExtraData).length ? mergedExtraData : null,
    };

    let result;
    let eventAction = 'created';

    if (existing?.id) {
      const { data, error } = await supabase
        .from('tradeconvert_prospects')
        .update({ ...Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)), updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
      eventAction = 'updated';
    } else {
      const { data, error } = await supabase
        .from('tradeconvert_prospects')
        .insert({ ...payload, next_action: 'Review and contact', updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    await insertProspectEvent(supabase, {
      prospect_id: result.id,
      event_type: 'submission',
      source,
      intent,
      title: eventTitle(intent, selectedPackage),
      payload: {
        action: eventAction,
        selected_package: selectedPackage,
        notes,
        scan_payload: scanPayload,
        extra_data: extraData,
      },
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: 'Thank you — your details have been saved.', prospect_id: result.id }),
    };
  } catch (err) {
    console.error('lead.js failed:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'Lead capture failed', details: err.message || 'Unknown error' }),
    };
  }
};
