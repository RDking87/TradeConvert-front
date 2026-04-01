'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // IMPORTANT: service role
);

const WORKSPACE_ID = "36e3a296-adbb-4a87-9623-f1fe37f0bd92"; // Pnut Den

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function sanitise(v, max = 200) {
  if (!v || typeof v !== 'string') return '';
  return v.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, max);
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'POST only' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'Invalid JSON' }),
    };
  }

  // honeypot
  if (body.website2) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true }),
    };
  }

  const name = sanitise(body.name, 100);
  const email = sanitise(body.email, 200).toLowerCase();
  const phone = sanitise(body.phone, 30);
  const message = sanitise(body.message || '', 1000);

  if (!name || name.length < 2) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'Enter name' }),
    };
  }

  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'Invalid email' }),
    };
  }

  // 🔥 INSERT INTO SUPABASE
  const { error } = await supabase
    .from('client_leads')
    .insert([
      {
        name,
        email,
        phone,
        message,
        workspace_id: WORKSPACE_ID,
      },
    ]);

  if (error) {
    console.error('Supabase insert error:', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ success: false, message: 'Database error' }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      success: true,
      message: "Lead captured successfully",
    }),
  };
};
