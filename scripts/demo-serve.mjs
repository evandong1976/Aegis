// Demo only, not for production: a local "update" page whose download is demo/ZoomUpdate.command,
// a harmless file that does nothing but open Terminal when double-clicked (demo/README.md).
//
//   pnpm demo:serve        then open http://127.0.0.1:8787
//
// The .command file is zipped on start (demo/dist/ZoomUpdate.zip, git-ignored) because a file
// downloaded straight from a browser loses its execute bit and then won't open; the zip keeps it.
// Listens on 127.0.0.1 only.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const PORT = Number(process.env.AEGIS_DEMO_PORT) || 8787
const SOURCE = join('demo', 'ZoomUpdate.command')
const ZIP = join('demo', 'dist', 'ZoomUpdate.zip')

mkdirSync(join('demo', 'dist'), { recursive: true })
rmSync(ZIP, { force: true })
// ditto keeps the execute bit and leaves out macOS metadata (._ files).
execFileSync('ditto', ['-c', '-k', '--norsrc', SOURCE, ZIP])
const zip = readFileSync(ZIP)
const page = readFileSync(join('demo', 'site', 'index.html'))

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page)
  } else if (path === '/download/ZoomUpdate.zip') {
    res
      .writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="ZoomUpdate.zip"',
        'Content-Length': zip.length
      })
      .end(zip)
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n')
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Aegis demo page: http://127.0.0.1:${PORT}  (download: ${ZIP}, ${zip.length} bytes)`)
})
