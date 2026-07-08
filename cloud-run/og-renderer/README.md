# OG image renderer (Cloud Run)

Renders retina (2400×1260) Open Graph images with Playwright/Chromium. Runs as a container so the full browser and its system deps are available; scales to zero between requests.

## Local

```bash
npm install
npm run dev
# open http://localhost:8080/og.png?kind=win&title=Nathan%20got%20BINGO&theme=seriously-pink
```

## Deploy to Cloud Run

```bash
gcloud run deploy og-renderer \
  --source . \
  --project gaycruisebingo \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --concurrency 4 --min-instances 0
```

Copy the service URL and set it as `OG_RENDERER_URL` for the `share` Cloud Function (so link unfurls point at `${OG_RENDERER_URL}/og.png?...`).

## Why not a Cloud Function?

Playwright + full Chromium is ~2s/image and exceeds Function size/latency comfort. Cloud Run (container) is the right home; renders are cached a day at the CDN and the browser instance is reused across requests. For higher volume, pre-generate on win/leaderboard-change events and store the PNGs in Cloud Storage instead of rendering on the request path.
