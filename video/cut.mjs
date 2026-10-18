// Renders the combined cut (cut.json) frame by frame in headless Chrome, then encodes it.
// Each segment is rendered from its own source page: index.html (via __seek) or
// aegis-promo.html (via __render, with __only limiting it to that segment's scene).
//   node cut.mjs                   every frame -> frames/cut/, then build-silent.mp4 (resumes)
//   node cut.mjs --stills 12,40.5  PNG stills at those times in the cut -> stills/
//   node cut.mjs --workers 6       parallel pages (default 6)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // pages read ../design-system for tokens and fonts
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cut = JSON.parse(fs.readFileSync(path.join(here, 'cut.json'), 'utf8'));
const fps = cut.fps;

// Every frame of the cut: which page, which scene, which source time.
const frames = [];
let offset = 0;
for (const seg of cut.segments) {
  const n = Math.round((seg.to - seg.from) * fps);
  for (let i = 0; i < n; i++) frames.push({ src: seg.src, scene: seg.scene, t: seg.from + i / fps });
  seg.start = offset;
  offset += n / fps;
}
const at = (T) => frames[Math.min(frames.length - 1, Math.max(0, Math.round(T * fps)))];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/video/`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 60000,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--font-render-hinting=none'],
});

// One page per source per worker, opened on first use.
function pages() {
  const open = {};
  return async (src) => {
    if (open[src]) return open[src];
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error(`${src} page error:`, e.message));
    await page.goto(base + cut.sources[src] + '?render=1', { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 });
    const err = await page.evaluate('window.__error');
    if (err) throw new Error(err);
    await page.evaluate(() => document.fonts.ready);
    return (open[src] = page);
  };
}
async function shoot(get, f, file, type = 'jpeg') {
  const page = await get(f.src);
  if (f.src === 'promo') await page.evaluate((s, t) => { window.__only = [s]; window.__render(t); }, f.scene, f.t);
  else await page.evaluate((t) => window.__seek(t), f.t);
  await page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality: 95 } : {}), optimizeForSpeed: true, captureBeyondViewport: false });
}

try {
  if (args.includes('--stills')) {
    const dir = path.join(here, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const get = pages();
    for (const T of opt('stills', '0').split(',').map(Number)) {
      const file = path.join(dir, `t${T.toFixed(2).padStart(6, '0')}.png`);
      await shoot(get, at(T), file, 'png');
      console.log(file);
    }
  } else {
    const workers = +opt('workers', 6);
    const dir = path.join(here, 'frames', 'cut');
    fs.mkdirSync(dir, { recursive: true });
    const per = Math.ceil(frames.length / workers);
    let done = 0;
    const started = Date.now();
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
      const a = w * per, b = Math.min(frames.length, a + per);
      let get = pages();
      for (let i = a; i < b; i++) {
        const file = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);
        if (fs.existsSync(file) && fs.statSync(file).size > 0) { done++; continue; } // resume
        try {
          await shoot(get, frames[i], file);
        } catch (e) {
          console.error(`frame ${i}: ${e.message}; reopening pages`);
          get = pages();
          await shoot(get, frames[i], file);
        }
        if (++done % 300 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${done}/${frames.length} frames · ~${Math.round(((frames.length - done) / done) * el)} s left`);
        }
      }
    }));
    console.log(`${frames.length} frames (${(frames.length / fps).toFixed(1)} s) in ${Math.round((Date.now() - started) / 1000)} s`);
    const out = path.join(here, 'build-silent.mp4');
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%05d.jpg'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    console.log(out);
  }
} finally {
  await browser.close();
  server.close();
}
