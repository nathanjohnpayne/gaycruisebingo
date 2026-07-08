// Themed HTML for the OG image, mirroring the app's neon palettes.
type Palette = { bg: string; ink: string; primary: string; secondary: string; accent: string };

const THEMES: Record<string, Palette> = {
  'neon-playground': { bg: '#07060d', ink: '#f6ecff', primary: '#ff2d95', secondary: '#00e6ff', accent: '#ffd23f' },
  'get-sporty': { bg: '#0a0f0b', ink: '#f2fff4', primary: '#39ff88', secondary: '#eaffef', accent: '#ffe600' },
  'duty-free': { bg: '#0a0e1a', ink: '#eef3ff', primary: '#ff4d5e', secondary: '#3aa0ff', accent: '#ffd23f' },
  glamiators: { bg: '#0c0a08', ink: '#fff7e8', primary: '#e8c86a', secondary: '#c9a24a', accent: '#ffffff' },
  'summer-white': { bg: '#f6f1e7', ink: '#20170f', primary: '#8f600d', secondary: '#8a5c12', accent: '#20170f' },
  'dog-tag': { bg: '#0c0e0a', ink: '#eef2e6', primary: '#b5c15a', secondary: '#8f9b8a', accent: '#ffd23f' },
  'revival-disco': { bg: '#120a14', ink: '#ffeede', primary: '#ff7a1a', secondary: '#c04bff', accent: '#ffd23f' },
  'seriously-pink': { bg: '#1a0713', ink: '#ffe9f5', primary: '#ff4fb0', secondary: '#ff9ed8', accent: '#fff06a' },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function renderHtml(opts: { kind: string; title: string; subtitle: string; theme: string }): string {
  const p = THEMES[opts.theme] ?? THEMES['neon-playground'];
  const badge = opts.kind === 'leaderboard' ? 'LEADERBOARD' : 'BINGO';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@600&display=swap');
    *{margin:0;box-sizing:border-box}
    html,body{width:1200px;height:630px}
    body{background:
      radial-gradient(60% 45% at 10% -10%, ${p.primary}55, transparent 60%),
      radial-gradient(55% 42% at 100% 0%, ${p.secondary}44, transparent 60%),
      ${p.bg};
      color:${p.ink};font-family:'Oswald',sans-serif;
      display:flex;flex-direction:column;justify-content:center;align-items:center;
      padding:70px;text-align:center}
    .frame{position:absolute;inset:26px;border:3px solid ${p.primary};border-radius:28px;opacity:.8}
    .badge{font-family:'Bebas Neue';font-size:40px;letter-spacing:.3em;color:${p.secondary};
      text-shadow:0 0 22px ${p.secondary}}
    .title{font-family:'Bebas Neue';font-size:118px;line-height:.95;margin:10px 40px;color:#fff;
      text-shadow:0 0 8px #fff,0 0 40px ${p.primary},0 0 90px ${p.primary}}
    .sub{font-size:34px;color:${p.accent};letter-spacing:.04em;margin-top:6px}
    .foot{position:absolute;bottom:54px;font-size:24px;letter-spacing:.24em;color:${p.ink};opacity:.75}
  </style></head><body>
    <div class="frame"></div>
    <div class="badge">${esc(badge)}</div>
    <div class="title">${esc(opts.title)}</div>
    ${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}
    <div class="foot">GAYCRUISEBINGO.COM · TRIESTE → BARCELONA</div>
  </body></html>`;
}
