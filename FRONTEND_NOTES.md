# TradeConvert front-end finish notes

Updated: 2026-05-14

## What changed

- Removed embedded base64 media from `index.html`.
  - Promo loop video moved to `media/promo-loop-1.mp4`.
  - Inline JPEGs moved to `assets/tc-inline-1.jpg` and `assets/tc-inline-2.jpg`.
  - `index.html` reduced from roughly 9.1MB to roughly 270KB.
- Disabled browser-side PageSpeed API use by clearing the exposed `PSI_API_KEY` constant.
  - The scanner now relies on `/.netlify/functions/scan`, which already reads `PAGESPEED_API_KEY` from Netlify environment variables.
- Changed the promo video preload from `auto` to `metadata` to reduce upfront load weight.
- Replaced the placeholder/fake testimonial with a safer pilot-slots proof note.
- Added a final CSS finish patch to reduce visual clutter, improve mobile spacing, and keep the scanner/pricing sections visually cleaner.

## Preserved hooks

No IDs or JS function names were intentionally changed. The following front-end hooks remain in place:

- `#scanner`
- `scStartScan()`
- `/.netlify/functions/scan`
- `/.netlify/functions/lead`
- `/.netlify/functions/scan-chat`
- `/.netlify/functions/create-checkout-session`
- `openBuyModal()`
- `openGrowthModal()`
- Stripe checkout flow
- Calendly booking modal
- Before/after slider IDs: `tcSlider`, `tcDrag`, `tcDivider`, `tcAfterPanel`, `tcBeforeSite`, `tcAfterSite`, `tcHint`

## Deploy note

Upload/commit the whole folder, not only `index.html`, because the page now references files in `/assets` and `/media`.
