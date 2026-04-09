const r = await fetch('/.netlify/functions/create-checkout-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Test', email: 'test@test.com', websiteUrl: 'https://test.co.uk', packageKey: 'rebuild' })
});
console.log(await r.text());
