// Renders index.html frame by frame in headless Chrome, then encodes with ffmpeg.
//   node render.mjs                 every frame -> frames/, then video-silent.mp4
//   node render.mjs --stills 12,28  PNG stills at those seconds -> stills/
//   node render.mjs --workers 6     parallel pages (default 6)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // the page reads ../design-system for tokens and fonts
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const timing = JSON.parse(fs.readFileSync(path.join(here, 'timing.json'), 'utf8'));
const fps = timing.fps;
const total = Math.round(timing.duration * fps);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/video/index.html?render=1`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 30000,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--font-render-hinting=none'],
});
async function openPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 });
  const err = await page.evaluate('window.__error');
  if (err) throw new Error(err);
  return page;
}
const shoot = async (page, t, file, type = 'jpeg') => {
  await page.evaluate((t) => window.__seek(t), t);
  await page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality: 95 } : {}), optimizeForSpeed: true, captureBeyondViewport: false });
};

try {
  if (args.includes('--stills')) {
    const times = opt('stills', '0').split(',').map(Number);
    const dir = path.join(here, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const page = await openPage();
    for (const t of times) {
      const f = path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`);
      await shoot(page, t, f, 'png');
      console.log(f);
    }
  } else {
    const workers = +opt('workers', 6);
    const from = Math.round(+opt('from', 0) * fps), to = Math.round(+opt('to', timing.duration) * fps);
    const dir = path.join(here, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const per = Math.ceil((to - from) / workers);
    let done = 0;
    const started = Date.now();
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const a = from + w * per, b = Math.min(to, a + per);
      if (a >= b) return;
      let page = await openPage();
      for (let f = a; f < b; f++) {
        const file = path.join(dir, `f${String(f).padStart(5, '0')}.jpg`);
        if (fs.existsSync(file) && fs.statSync(file).size > 0) { done++; continue; } // resume
        try {
          await shoot(page, f / fps, file);
        } catch (e) {
          console.error(`frame ${f}: ${e.message}; reopening the page`);
          await page.close().catch(() => {});
          page = await openPage();
          await shoot(page, f / fps, file);
        }
        if (++done % 150 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${done}/${to - from} frames · ${(done / el).toFixed(1)} fps · ~${Math.round(((to - from - done) / done) * el)} s left`);
        }
      }
      await page.close();
    }));
    console.log(`frames done in ${Math.round((Date.now() - started) / 1000)} s`);
    if (from === 0 && to === total) {
      const out = path.join(here, 'build-silent.mp4');
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%05d.jpg'),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('ffmpeg failed');
      console.log(out);
    }
  }
} finally {
  await browser.close();
  server.close();
}
