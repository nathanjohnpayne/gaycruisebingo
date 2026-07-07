import express from 'express';
import { chromium, type Browser } from 'playwright';
import { renderHtml } from './template';

const app = express();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return browser;
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
    await page.setContent(html, { waitUntil: 'networkidle' });
    const png = await page.screenshot({ type: 'png' });
    await page.close();
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.type('png').send(png);
  } catch (err) {
    console.error(err);
    res.status(500).send('render error');
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`og-renderer listening on ${port}`));
