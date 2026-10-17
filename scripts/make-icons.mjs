// Draws the tray template icons and the extension icons as PNGs, with no dependencies.
// Shape: the design system's shield (Lucide `shield`, 24-unit grid) with a check or an alert mark.
// Run with `pnpm icons`; outputs are committed.

import { writeFileSync, mkdirSync } from 'fs'
import { deflateSync } from 'zlib'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SHIELD = [
  [12, 2.2],
  [15, 4],
  [19.5, 5],
  [20, 6],
  [20, 13],
  [18.5, 17],
  [15.5, 20],
  [12, 21.9],
  [8.5, 20],
  [5.5, 17],
  [4, 13],
  [4, 6],
  [4.5, 5],
  [9, 4]
]

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax,
    dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const MARKS = {
  check: (x, y) =>
    distToSegment(x, y, [8.3, 12.2], [11, 14.8]) < 1.25 ||
    distToSegment(x, y, [11, 14.8], [15.8, 9.6]) < 1.25,
  alert: (x, y) =>
    distToSegment(x, y, [12, 7.6], [12, 12.6]) < 1.2 || Math.hypot(x - 12, y - 16.2) < 1.3
}

/** Coverage (0–1) of the shield-minus-mark at a pixel, 4×4 supersampled. */
function coverage(px, py, size, mark) {
  let hits = 0
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const x = ((px + (sx + 0.5) / 4) / size) * 24
      const y = ((py + (sy + 0.5) / 4) / size) * 24
      if (inPolygon(x, y, SHIELD) && !MARKS[mark](x, y)) hits++
    }
  return hits / 16
}

function crc32(buf) {
  let c,
    crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
  console.log('wrote', path.replace(root + '/', ''))
}

// macOS tray template images: black + alpha; the system tints them.
for (const [name, mark] of [
  ['trayTemplate', 'check'],
  ['trayAlertTemplate', 'alert']
]) {
  for (const [suffix, size] of [
    ['', 16],
    ['@2x', 32]
  ]) {
    write(
      join(root, 'resources', `${name}${suffix}.png`),
      png(size, (x, y) => [0, 0, 0, Math.round(coverage(x, y, size, mark) * 255)])
    )
  }
}

// Extension icons: accent cyan (#50e6ff) shield on the navy ground (#04111f), rounded square.
const GROUND = [4, 17, 31]
const ACCENT = [80, 230, 255]
for (const size of [16, 32, 48, 128]) {
  const r = size * 0.22
  write(
    join(root, 'extension', 'public', 'icons', `icon-${size}.png`),
    png(size, (x, y) => {
      const cx = Math.min(Math.max(x + 0.5, r), size - r)
      const cy = Math.min(Math.max(y + 0.5, r), size - r)
      const inSquare = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r
      if (!inSquare) return [0, 0, 0, 0]
      // Shield inset to 80% of the square.
      const inset = size * 0.1
      const c = coverage((x - inset) / 0.8, (y - inset) / 0.8, size, 'check')
      return [0, 1, 2].map((i) => Math.round(GROUND[i] + (ACCENT[i] - GROUND[i]) * c)).concat(255)
    })
  )
}
