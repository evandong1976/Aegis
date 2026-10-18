// Synthesizes the score and sound design for aegis-promo.html and mixes in the narration.
// Every time here matches a moment in the HTML timeline.
// Usage: node audio.mjs  (reads build/vo/*.aiff, writes build/mix.wav and build/mix_novo.wav)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const B = path.join(DIR, 'build')
const SR = 48000
const DUR = 96
const N = SR * DUR
const TAU = Math.PI * 2

// ---------- narration ----------
const VO_AT = {
  '01': 1.2, '02': 8.6, '03': 16.8,
  '04a': 22.4, '04b': 23.85, '04c': 24.75, '04d': 25.6, '04e': 26.35,
  '05a': 28.6, '05b': 33.35, '05c': 34.35, '05d': 35.55, '05e': 36.6,
  '06': 41.5, '07a': 47.0, '07b': 54.3, '07c': 56.6,
  '08': 60.4, '09': 67.5, '10': 75.0, '11': 81.6, '12': 88.5,
}
const vo = new Float32Array(N)
for (const [id, at] of Object.entries(VO_AT)) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(B, 'vo', `${id}.aiff`), '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 })
  const s = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const o = Math.round(at * SR)
  for (let i = 0; i < s.length && o + i < N; i++) vo[o + i] += s[i]
}
// gentle presence lift and level for the voice
{ let lp = 0; for (let i = 0; i < N; i++) { lp += 0.06 * (vo[i] - lp); vo[i] = (vo[i] + 0.35 * (vo[i] - lp)) * 1.15 } }
// ducking envelope from the voice
const duck = new Float32Array(N)
{ let env = 0; for (let i = 0; i < N; i++) { const a = Math.abs(vo[i]); env = a > env ? env + 0.004 * (a - env) : env + 0.00003 * (a - env); duck[i] = 1 - 0.5 * Math.min(1, env * 9) } }

// ---------- helpers ----------
const L = new Float32Array(N), R = new Float32Array(N) // music bus
const SL = new Float32Array(N), SRb = new Float32Array(N) // sfx bus
const VL = new Float32Array(N), VR = new Float32Array(N) // reverb send
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const ramp = (t, a, b) => clamp((t - a) / (b - a))
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1

function add(busL, busR, at, len, fn, pan = 0, send = 0) {
  const o = Math.round(at * SR), n = Math.round(len * SR)
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4)
  for (let i = 0; i < n; i++) {
    const j = o + i; if (j < 0 || j >= N) continue
    const v = fn(i / SR, i)
    busL[j] += v * gl; busR[j] += v * gr
    if (send) { VL[j] += v * gl * send; VR[j] += v * gr * send }
  }
}
const sfx = (at, len, fn, pan = 0, send = 0.25) => add(SL, SRb, at, len, fn, pan, send)

// ---------- harmony ----------
const CH = {
  Dm: [50, 57, 62, 64, 65, 69], Bb: [46, 53, 58, 62, 65, 69], F: [41, 53, 57, 60, 65, 67], C: [48, 55, 60, 62, 64, 67],
  Gm: [43, 50, 55, 58, 62], A: [45, 52, 57, 61, 64], Dsus: [50, 57, 62, 64, 67, 69],
}
const prog = [[0, 'Dm'], [4, 'Bb'], [8, 'Gm'], [11.75, 'A']]
for (let t = 15.5, k = 0; t < 87; t += 5, k++) prog.push([t, ['Dm', 'Bb', 'F', 'C'][k % 4]])
prog.push([87, 'Bb'], [90.5, 'Dsus'])

// pad: detuned saws through a moving low-pass
function cutoffAt(t) {
  if (t < 8) return 380 + 500 * ramp(t, 0, 7)
  if (t < 15.5) return 520
  if (t < 46.5) return 1500
  if (t < 60) return 2300
  if (t < 87) return 1700
  return 1400 - 700 * ramp(t, 91, 96)
}
{
  const st = prog.map(([t, c], i) => ({ t, notes: CH[c], end: i + 1 < prog.length ? prog[i + 1][0] : DUR }))
  const phases = {}
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0
  for (let i = 0; i < N; i++) {
    const t = i / SR
    let sl = 0, sr = 0
    for (const s of st) {
      if (t < s.t || t > s.end + 1.6) continue
      const env = ramp(t, s.t, s.t + 0.9) * (1 - ramp(t, s.end, s.end + 1.6))
      s.notes.forEach((m, n) => {
        for (const d of [-0.07, 0.07]) {
          const key = `${s.t}|${n}|${d}`
          const f = mtof(m + d) * (1 + 0.0015 * Math.sin(t * 0.7 + n))
          phases[key] = ((phases[key] || rnd() * 0.5 + 0.5) + f / SR) % 1
          const v = (2 * phases[key] - 1) * env * 0.05
          if ((n + (d > 0)) % 2) sl += v * 1.2; else sr += v * 1.2
        }
      })
    }
    const fc = cutoffAt(t) * (1 + 0.15 * Math.sin(t * 0.4))
    const a = 1 - Math.exp(-TAU * fc / SR)
    l1 += a * (sl - l1); l2 += a * (l1 - l2); r1 += a * (sr - r1); r2 += a * (r1 - r2)
    const fade = t > 93 ? 1 - ramp(t, 93, 96) : 1
    L[i] += l2 * fade; R[i] += r2 * fade
    VL[i] += l2 * 0.5 * fade; VR[i] += r2 * 0.5 * fade
  }
}
// sub bass on chord roots
{
  let ph = 0
  for (let i = 0; i < N; i++) {
    const t = i / SR
    let cur = prog[0]; for (const p of prog) if (t >= p[0]) cur = p
    const f = mtof(CH[cur[1]][0] - 12)
    ph = (ph + f / SR) % 1
    const lvl = (t < 15.5 ? 0.5 * ramp(t, 2, 8) : 1) * (t > 92 ? 1 - ramp(t, 92, 96) : 1)
    const v = Math.sin(TAU * ph) * 0.16 * lvl
    L[i] += v; R[i] += v
  }
}
// arpeggio, eighth notes at 96 bpm with a ping-pong delay
const BEAT = 60 / 96
function arpLevel(t) {
  if (t < 17) return 0
  if (t < 28) return 0.7 * ramp(t, 17, 22)
  if (t < 41) return 0.55
  if (t < 46.5) return 0.8
  if (t < 60) return 1.1
  if (t < 67) return 0.7
  if (t < 86.5) return 0.85
  return 0
}
{
  const dl = new Float32Array(N), dr = new Float32Array(N)
  const pattern = [0, 2, 3, 4, 5, 4, 3, 2]
  for (let k = 0, t = 15.5; t < 86.5; k++, t = 15.5 + k * BEAT / 2) {
    const lvl = arpLevel(t); if (!lvl) continue
    let cur = prog[0]; for (const p of prog) if (t >= p[0]) cur = p
    const notes = CH[cur[1]]
    const m = notes[pattern[k % 8] % notes.length] + 12
    const f = mtof(m), acc = k % 4 === 0 ? 1 : 0.7
    add(dl, dr, t, 0.6, (x) => (Math.sin(TAU * f * x) + 0.3 * Math.sin(TAU * 2 * f * x) * Math.exp(-x * 30)) * Math.exp(-x * 9) * 0.06 * lvl * acc, k % 2 ? 0.35 : -0.35)
  }
  const D = Math.round(BEAT * 0.75 * SR)
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const fb = i >= D ? 0.38 : 0
    const xl = dl[i] + (i >= D ? dr[i - D] * fb : 0), xr = dr[i] + (i >= D ? dl[i - D] * fb : 0)
    dl[i] = xl; dr[i] = xr
    L[i] += xl; R[i] += xr; VL[i] += xl * 0.3; VR[i] += xr * 0.3
    void t
  }
}
// kick and hats
function kick(at, amp = 0.5) {
  add(L, R, at, 0.5, (x) => {
    const f = 45 + 90 * Math.exp(-x * 28)
    return Math.sin(TAU * (45 * x + (90 / 28) * (1 - Math.exp(-x * 28)))) * Math.exp(-x * 7) * amp * (x < 0.002 ? x / 0.002 : 1) + (f > 1e9 ? 0 : 0)
  })
}
for (let t = 28; t < 86; t += BEAT) {
  const busy = (t >= 46.5 && t < 60) || (t >= 67 && t < 74.5)
  const beatIdx = Math.round((t - 28) / BEAT)
  if (busy || beatIdx % 2 === 0) kick(t, busy ? 0.42 : 0.32)
}
for (let t = 46.5; t < 81; t += BEAT / 4) {
  if (t >= 60 && t < 67) continue
  const k = Math.round((t - 46.5) / (BEAT / 4))
  const amp = (k % 4 === 2 ? 0.05 : 0.022) * (t > 74.5 ? 0.6 : 1)
  let hp = 0, prev = 0
  add(L, R, t, 0.08, (x) => { const n = rnd(); hp = 0.85 * (hp + n - prev); prev = n; return hp * Math.exp(-x * 60) * amp }, k % 2 ? 0.3 : -0.3)
}

// ---------- sound design ----------
function whoosh(at, len = 0.7, amp = 0.16, up = true) {
  let b1 = 0, b2 = 0
  sfx(at - len * 0.6, len, (x) => {
    const k = x / len
    const fc = up ? 300 + 5000 * k * k : 5000 - 4500 * k
    const a = 1 - Math.exp(-TAU * fc / SR)
    b1 += a * (rnd() - b1); b2 += a * (b1 - b2)
    return (b1 - b2) * Math.sin(Math.PI * k) * amp * 3
  }, 0, 0.4)
}
function impact(at, amp = 0.8) {
  sfx(at, 2.5, (x) => Math.sin(TAU * (38 * x + 3 * (1 - Math.exp(-x * 9)))) * Math.exp(-x * 1.6) * amp * 0.7, 0, 0.3)
  let lp = 0
  sfx(at, 1.8, (x) => { lp += 0.25 * (rnd() - lp); return lp * Math.exp(-x * 3.2) * amp * 0.5 }, 0, 0.8)
}
function riser(from, to, amp = 0.12) {
  let lp = 0
  sfx(from, to - from, (x) => {
    const k = x / (to - from)
    const a = 1 - Math.exp(-TAU * (200 + 7000 * k * k) / SR)
    lp += a * (rnd() - lp)
    return (lp * 0.7 + Math.sin(TAU * (200 + 600 * k) * x) * 0.15) * k * k * amp * 2.5
  }, 0, 0.5)
}
function chime(at, notes, amp = 0.12, gap = 0.07) {
  notes.forEach((m, i) => {
    const f = mtof(m)
    sfx(at + i * gap, 2.2, (x) => (Math.sin(TAU * f * x) + 0.35 * Math.sin(TAU * f * 2.01 * x) * Math.exp(-x * 4)) * Math.exp(-x * 2.6) * amp, i % 2 ? 0.3 : -0.3, 0.7)
  })
}
function blip(at, f0, f1, len = 0.18, amp = 0.15, pan = 0) {
  sfx(at, len, (x) => { const f = f0 + (f1 - f0) * (x / len); return Math.sin(TAU * f * x) * Math.exp(-x * (6 / len)) * amp }, pan, 0.3)
}
function click(at, amp = 0.25) {
  sfx(at, 0.05, (x) => rnd() * Math.exp(-x * 220) * amp + Math.sin(TAU * 2400 * x) * Math.exp(-x * 300) * amp * 0.5, 0, 0.1)
}
function tick(at, amp = 0.05, pan = 0) {
  sfx(at, 0.03, (x) => Math.sin(TAU * 3200 * x) * Math.exp(-x * 400) * amp, pan, 0.05)
}
function buzz(at, amp = 0.09, pan = 0) {
  sfx(at, 0.22, (x) => Math.sign(Math.sin(TAU * 110 * x)) * Math.exp(-x * 14) * amp * (1 - Math.exp(-x * 400)), pan, 0.1)
}

// scene transitions
for (const b of [8, 15.5, 22, 28, 41, 46.5, 60, 67, 74.5, 81, 87]) whoosh(b + 0.25, 0.75, b === 15.5 || b === 87 ? 0.0 : 0.14)
// S1: soft ticks as rows stream, click at the end
for (let t = 1; t < 7.5; t += 0.21) tick(t, 0.012 + 0.01 * ramp(t, 5, 7.5), Math.sin(t * 9) * 0.6)
// S2: files fall in, alert, the quiet miss
whoosh(9.8, 0.8, 0.1, false); buzz(9.95, 0.12); buzz(10.2, 0.08)
whoosh(12.6, 0.8, 0.08, false); blip(12.75, 660, 880, 0.25, 0.08)
blip(13.2, 220, 207, 0.6, 0.06)
// S3: logo
riser(13.9, 15.6, 0.12); impact(15.6, 0.9)
for (let i = 0; i < 12; i++) tick(15.6 + i * 0.09, 0.02 + i * 0.002, (i % 2 ? 0.4 : -0.4))
chime(16.9, [74, 81, 86, 90], 0.1)
// S4: badges land
;[[23.9, 62], [24.8, 65], [25.65, 69], [26.55, 74]].forEach(([t, m], i) => { blip(t, mtof(m + 12) * 1.5, mtof(m + 12), 0.25, 0.14, -0.45 + i * 0.3); kick(t, 0.25) })
// S5: outline, cursor click, guard
blip(29.2, 300, 260, 0.2, 0.08); click(30.4, 0.3); impact(30.6, 0.25); blip(30.65, 587, 587, 0.3, 0.07); blip(30.85, 440, 440, 0.4, 0.07)
;[33.4, 34.4, 35.6, 36.8].forEach((t, i) => blip(t, 900 + i * 80, 700 + i * 80, 0.12, 0.08, 0.3 - i * 0.15))
click(39.75, 0.3); chime(40.1, [74, 78, 81], 0.06, 0.05)
// S6: download held
for (let t = 41.4; t < 42.4; t += 0.08) tick(t, 0.02)
click(42.4, 0.35); click(42.47, 0.25); blip(42.5, 180, 150, 0.4, 0.15); chime(42.55, [69, 76], 0.05)
blip(43.6, 140, 110, 0.35, 0.14)
// S7: split, terminal ticks, blocks, verdicts
whoosh(47.9, 0.6, 0.1); blip(47.6, 400, 800, 0.3, 0.06, -0.5); blip(47.6, 400, 800, 0.3, 0.06, 0.5)
const A7 = [48.5, 49.1, 49.7, 50.4, 51.2, 51.8, 52.9, 53.4, 54.0, 54.7], B7 = [48.9, 49.5, 50.2, 50.6, 51.3, 52.1, 53.7, 54.6]
A7.forEach((t) => { for (let i = 0; i < 5; i++) tick(t + i * 0.06, 0.03, -0.55) })
B7.forEach((t) => { for (let i = 0; i < 5; i++) tick(t + i * 0.06, 0.03, 0.55) })
buzz(52.3, 0.11, -0.5); buzz(52.8, 0.11, 0.5)
blip(53.3, 120, 90, 0.5, 0.08)
blip(55.6, 220, 220, 0.5, 0.12, -0.5); blip(57.4, 220, 220, 0.5, 0.12, 0.5)
// S8: merge
riser(59.9, 61.2, 0.08); impact(61.2, 0.75); chime(61.3, [62, 69, 74], 0.07)
blip(63.4, 300, 900, 0.9, 0.07); buzz(65.0, 0.06)
// S9: code highlights
;[69.6, 70.5, 71.4].forEach((t, i) => { blip(t, 500 + i * 60, 420 + i * 60, 0.18, 0.1); tick(t + 0.2, 0.04) })
// S10: iMessage
whoosh(75.5, 0.4, 0.08); blip(75.45, 1200, 1500, 0.12, 0.08)
for (let i = 0; i < 6; i++) tick(76.3 + i * 0.17, 0.012)
blip(77.3, mtof(88), mtof(88), 0.3, 0.07); blip(77.42, mtof(84), mtof(84), 0.4, 0.07)
// S11: fn key, panel, counters
click(81.5, 0.35); whoosh(81.95, 0.4, 0.06)
for (let t = 81.7; t < 83.3; t += 0.045) tick(t, 0.02 * (1 - ramp(t, 81.7, 83.3)) + 0.004)
// S12: outro
riser(85.8, 87.1, 0.1); impact(87.1, 1.0); chime(88.3, [62, 69, 74, 78, 81], 0.09, 0.09)

// ---------- reverb on the send (Freeverb-style) ----------
function reverb(inp) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ b: new Float32Array(d), i: 0, f: 0 }))
  const aps = [556, 441, 341].map((d) => ({ b: new Float32Array(d), i: 0 }))
  const out = new Float32Array(N)
  for (let n = 0; n < N; n++) {
    let s = 0
    for (const c of combs) { const y = c.b[c.i]; c.f = y * 0.75 + c.f * 0.25; c.b[c.i] = inp[n] * 0.015 + c.f * 0.86; c.i = (c.i + 1) % c.b.length; s += y }
    for (const a of aps) { const y = a.b[a.i]; a.b[a.i] = s + y * 0.5; s = y - s * 0.5; a.i = (a.i + 1) % a.b.length }
    out[n] = s
  }
  return out
}
const RL = reverb(VL), RR = reverb(VR.map((v, i) => (i > 23 ? VR[i - 23] : 0)))

// ---------- mix ----------
function mix(withVo) {
  const out = Buffer.alloc(N * 2 * 4)
  let peak = 0
  const Lm = new Float32Array(N), Rm = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const d = withVo ? duck[i] : 1
    let l = (L[i] + RL[i] * 0.9) * d * 0.9 + SL[i] + (withVo ? vo[i] * 0.95 : 0)
    let r = (R[i] + RR[i] * 0.9) * d * 0.9 + SRb[i] + (withVo ? vo[i] * 0.95 : 0)
    l = Math.tanh(l * 1.1); r = Math.tanh(r * 1.1)
    Lm[i] = l; Rm[i] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r))
  }
  const g = 0.89 / peak
  for (let i = 0; i < N; i++) { out.writeFloatLE(Lm[i] * g, i * 8); out.writeFloatLE(Rm[i] * g, i * 8 + 4) }
  return out
}
for (const [name, withVo] of [['mix', true], ['mix_novo', false]]) {
  const raw = path.join(B, `${name}.f32`)
  fs.writeFileSync(raw, mix(withVo))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', String(SR), path.join(B, `${name}.wav`)])
  fs.unlinkSync(raw)
  console.log('wrote', `${name}.wav`)
}

// levels per 8 s window, to keep the voice on top: voice / music (ducked) / sfx, in dBFS before loudnorm
if (process.env.LEVELS) {
  const db = (a, b, f) => { let s = 0; for (let i = a; i < b; i++) s += f(i) ** 2; return (10 * Math.log10(s / (b - a) + 1e-12)).toFixed(1) }
  for (let w = 0; w < DUR; w += 8) {
    const a = w * SR, b = Math.min(N, (w + 8) * SR)
    console.log(`${String(w).padStart(2)}s  voice ${db(a, b, (i) => vo[i])}  music ${db(a, b, (i) => (L[i] + RL[i] * 0.9) * duck[i] * 0.9)}  sfx ${db(a, b, (i) => SL[i])}`)
  }
}
