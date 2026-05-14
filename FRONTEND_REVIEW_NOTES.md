# TradeConvert Front-End Review Notes

## Changes made in this build

- Added the supplied main video as a new `Watch the overview` section directly after the hero/trade strips and before the before/after slider.
- Compressed the uploaded 171MB MP4 into a web-friendly 540p MP4 at ~16MB:
  - `media/tradeconvert-main-video.mp4`
  - `assets/tradeconvert-main-video-poster.jpg`
- Kept the original scanner, lead capture, modal, Stripe, Calendly, before/after slider, Netlify function, and Supabase-facing hooks intact.
- Updated several copy lines to avoid overclaiming, especially around search behaviour, enquiries, and urgency.
- Improved the top-of-page conversion structure:
  1. Hero problem and CTA
  2. Trust/trade fit strips
  3. Main explainer video
  4. Before/after transformation
  5. Pain-point loop
  6. Free scanner
  7. Features, estimator, ROI, pricing, CTA

## Why the main video was placed there

The video is a trust and context asset. It should appear before the scanner because it explains the problem and gives visitors a reason to care before asking them to interact with the tool.

Placing it too low, such as inside the proof section near the bottom, would waste it. Placing it inside the hero could distract from the primary CTA and make the first screen too heavy.

## Areas still unfinished / worth improving next

1. Proof cards are still illustrative placeholders. The section says `Dashboard preview`, `Mobile preview`, and `Before / after preview`, but these are icon cards rather than real screenshots. Replace these with real screen captures when available.

2. The scanner relies on Netlify functions and environment variables. Front-end syntax is intact, but live behaviour still depends on deployed backend settings including `PAGESPEED_API_KEY`, Supabase values, and Stripe values.

3. The before/after slider is strong, but it is visually complex. Once the real promo video and scanner are working live, consider reducing one of the supporting sections to avoid the page feeling long.

4. Pricing needs final commercial confirmation. The page currently uses deposits and fixed package prices. Make sure this matches the actual sales process before sending traffic.

5. The lead proof is intentionally conservative because there are not yet real client results. Replace the pilot note with real case studies once the first builds produce evidence.

## Deployment note

Deploy the whole folder, not just `index.html`, because the page now depends on files in `/media` and `/assets`.
