import express from 'express';
import { chromium, type Browser } from 'playwright';
import { renderHtml } from './template';

const app = express();
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  // Share a single launch across concurrent cold-start requests so we never
  // orphan a second Chromium process.
  if (launching) return launching;
  const pending = chromium
    .launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    .then((b) => {
      browser = b;
      return b;
    })
    .finally(() => {
      // Reset once settled so a failed launch can be retried on the next request.
      launching = null;
    });
  launching = pending;
  return pending;
}

app.get('/healthz', (_req, res) => {
  res.send('ok');
});

// GET /og.png?kind=win&title=...&subtitle=...&theme=neon-playground  -> 2400x1260 PNG
app.get('/og.png', async (req, res) => {
  const q = req.query as Record<string, string>;
  try {
    const html = renderHtml({
      kind: q.kind || 'win',
      title: q.title || 'GAY CRUISE BINGO',
      subtitle: q.subtitle || '',
      theme: q.theme || 'neon-playground',
    });
    const b = await getBrowser();
    const page = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
    try {
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 10_000 });
      const png = await page.screenshot({ type: 'png' });
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.type('png').send(png);
    } finally {
      await page.close();
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('render error');
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`og-renderer listening on ${port}`));
