// Renders aegis-promo.html frame by frame with Electron's offscreen renderer.
// Usage: electron render.cjs <out.mp4|dir-for-stills> [fps] [t1,t2,... for stills]
const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu-vsync')

const [out, fpsArg = '30', stills] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('render.cjs') && a !== '.')
const fps = +fpsArg

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } })
  win.webContents.setFrameRate(60)
  await win.loadFile(path.join(__dirname, 'aegis-promo.html'), { query: { render: '1' } })
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  const dur = await win.webContents.executeJavaScript('window.__duration')
  const grab = async (t) => {
    await win.webContents.executeJavaScript(`window.__seek(${t})`)
    const img = await win.webContents.capturePage()
    return img.resize({ width: 1920, height: 1080 })
  }
  if (stills) {
    fs.mkdirSync(out, { recursive: true })
    for (const t of stills.split(',').map(Number)) {
      fs.writeFileSync(path.join(out, `t${t.toFixed(1).padStart(5, '0')}.jpg`), (await grab(t)).toJPEG(85))
    }
    app.quit(); return
  }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
  const n = Math.round(dur * fps)
  const t0 = Date.now()
  for (let f = 0; f < n; f++) {
    const jpg = (await grab(f / fps)).toJPEG(95)
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
    if (f % 150 === 0) console.log(`frame ${f}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
  ff.stdin.end()
  ff.on('close', (code) => { console.log('ffmpeg exit', code); app.quit() })
})
