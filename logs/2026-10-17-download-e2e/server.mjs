// Test site for the download end-to-end run: one page with a link for each interception path.
// Every file is harmless: the demo script only echoes, the "photo" is a Mach-O header and zeros.
// Usage: node server.mjs <port> <repo-root>
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , portArg, repo] = process.argv
const port = Number(portArg)
const script = readFileSync(join(repo, 'demo/aegis-terminal-demo.command'))
const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n')
const macho = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]), Buffer.alloc(4088)])
const requests = []
let onceServed = false

const page = `<!doctype html><meta charset="utf-8"><title>Aegis download test</title>
<h1>Downloads</h1>
<p><a id="script" href="/dl/aegis-terminal-demo.command">Terminal demo (script)</a></p>
<p><a id="pdf" href="/dl/statement.pdf">Bank statement (plain PDF)</a></p>
<p><a id="fakejpg" href="/dl/photo.jpg">Holiday photo (really a Mac program)</a></p>
<p><a id="cookie" href="/private/report.sh">Logged-in download (needs the session cookie)</a></p>
<p><a id="once" href="/once/invoice.pdf">One-time link (a sign-in page the second time)</a></p>
<p><a id="data" download="hello.sh" href="data:text/x-sh;base64,${Buffer.from('#!/bin/sh\necho data-url\n').toString('base64')}">data: link</a></p>
<p><a id="blob" download="notes.sh" href="#">blob: link</a></p>
<script>
  const b = new Blob(['#!/bin/sh\\necho blob-url\\n'], { type: 'text/x-sh' })
  document.getElementById('blob').href = URL.createObjectURL(b)
</script>`

const attach = (res, name, type, body) => {
  res.writeHead(200, {
    'content-type': type,
    'content-disposition': `attachment; filename="${name}"`,
    'content-length': body.length
  })
  res.end(body)
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  requests.push({ at: new Date().toISOString(), path, cookie: req.headers.cookie ?? null })
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=ok; Path=/; SameSite=Lax' })
    return res.end(page)
  }
  if (path === '/dl/aegis-terminal-demo.command') return attach(res, 'aegis-terminal-demo.command', 'application/octet-stream', script)
  if (path === '/dl/statement.pdf') return attach(res, 'statement.pdf', 'application/pdf', pdf)
  if (path === '/dl/photo.jpg') return attach(res, 'photo.jpg', 'image/jpeg', macho)
  if (path === '/private/report.sh') {
    if (!/session=ok/.test(req.headers.cookie ?? '')) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      return res.end('sign in first')
    }
    return attach(res, 'report.sh', 'application/x-sh', Buffer.from('#!/bin/sh\necho logged-in\n'))
  }
  if (path === '/once/invoice.pdf') {
    if (!onceServed) {
      onceServed = true
      return attach(res, 'invoice.pdf', 'application/pdf', pdf)
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end('<!doctype html><title>Sign in</title><form>Password <input type=password></form>')
  }
  if (path === '/requests') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(requests, null, 2))
  }
  res.writeHead(404)
  res.end()
}).listen(port, '127.0.0.1', () => console.log(`test site on http://127.0.0.1:${port}/`))
