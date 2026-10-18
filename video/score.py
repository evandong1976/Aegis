"""Soundtrack for the combined cut (cut.json), synthesised from scratch.

- Music: one continuous D-minor score at 96 BPM, anchored to the logo hit, whose layers
  (pads, sub bass, arpeggio, drums) follow each segment's energy.
- Sound effects: every effect from both source timelines, written against its source time
  and scene, then moved to wherever that scene sits in the cut. A whoosh marks each cut.
- Voice: each line in cut.json, placed at its source time inside its segment; the music
  ducks under it.

Writes audio/build/mix_vo.wav, audio/build/mix_novo.wav and captions.srt.
"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = json.load(open(os.path.join(HERE, 'cut.json')))
TIMING = json.load(open(os.path.join(HERE, 'timing.json')))  # index.html's own timeline
SR = 48000
FPS = CUT['fps']
OUT = os.path.join(HERE, 'audio', 'build')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- the cut
SEG = {}
pos = 0.0
for s in CUT['segments']:
    n = round((s['to'] - s['from']) * FPS)
    s['start'], s['end'] = pos, pos + n / FPS
    pos = s['end']
    SEG[s['id']] = s
DUR = pos
N = int(np.ceil(DUR * SR))
# which segment shows each source scene
SCENE_SEG = {('scenes', sc['id']): s['id'] for s in CUT['segments'] if s['src'] == 'scenes'
             for sc in TIMING['scenes'] if sc['start'] == s['from']}
SCENE_SEG.update({('promo', s['scene']): s['id'] for s in CUT['segments'] if s['src'] == 'promo'})


def scene_of(t):
    for sc in TIMING['scenes']:
        if sc['start'] <= t < sc['end']:
            return sc['id']
    return None


def to_cut(src, scene, t):
    """Source time -> time in the cut, or None when that scene isn't in the cut."""
    seg = SCENE_SEG.get((src, scene))
    if seg is None:
        return None
    s = SEG[seg]
    return s['start'] + (t - s['from'])


# ---------------------------------------------------------------- dsp helpers
def tt(n):
    return np.arange(n) / SR


def place(buf, t0, sig, gain=1.0):
    i = int(round(t0 * SR))
    if i >= N:
        return
    s = sig
    if i < 0:
        s, i = s[-i:], 0
    j = min(N, i + len(s))
    buf[i:j] += s[: j - i] * gain


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


TABLE = 4096


def saw_table(f, fc):
    """One period of a band-limited saw, its harmonics rolled off like a low-pass at fc."""
    x = np.arange(TABLE) / TABLE
    out = np.zeros(TABLE)
    k = 1
    while k * f < min(fc * 5, 16000) and k < 80:
        out += (1 / k) / (1 + (k * f / fc) ** 2) * np.sin(2 * np.pi * k * x)
        k += 1
    return out / (np.max(np.abs(out)) + 1e-9)


def osc(table, f, n, detune_cents=0.0, phase0=0.0, vib=0.0):
    t = tt(n)
    ff = f * 2 ** (detune_cents / 1200)
    ph = phase0 + ff * t + (vib * np.sin(2 * np.pi * 0.23 * t + phase0 * 6) if vib else 0)
    return table[(ph * TABLE).astype(np.int64) & (TABLE - 1)]


def adsr(n, a, r, curve=1.0):
    t = tt(n)
    return np.minimum(1, t / max(a, 1e-4)) ** curve * np.clip((n / SR - t) / max(r, 1e-4), 0, 1)


def reverb_ir(seconds, decay, seed, bright=6000):
    n = int(seconds * SR)
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-tt(n) / decay)
    ir = lp(ir, bright)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return ir / np.sqrt(np.sum(ir ** 2))


def stereo_reverb(x, seconds=3.0, decay=0.7, wet=0.3, bright=6000):
    return (fftconvolve(x, reverb_ir(seconds, decay, 1, bright))[:N] * wet,
            fftconvolve(x, reverb_ir(seconds, decay, 2, bright))[:N] * wet)


def ramp_marks(marks, step=480):
    xs, ys = zip(*marks)
    return np.repeat(np.interp(np.arange(0, N, step) / SR, xs, ys), step)[:N]


# ---------------------------------------------------------------- music
BEAT = 60 / 96
ANCHOR = to_cut('scenes', 's03', 17.35)  # the logo hit sits on a downbeat
CHORD_LEN = 8 * BEAT
CHORDS = [  # i - VI - III - VII in D minor: (bass midi, pad voicing)
    (38, [50, 53, 57, 62]), (34, [50, 53, 58, 62]), (41, [48, 53, 57, 60]), (36, [48, 52, 55, 60]),
]
OUTRO_HIT = to_cut('promo', 's12', 87.1)

# per segment: pad cutoff, arp level, drums (beats per kick, hats, claps, strength) or None, bass
ENERGY = {
    'open':      (520, 0.0, None, 0),
    'oldway':    (380, 0.0, None, 0),
    'meet':      (1500, 0.35, None, 1),
    'verdicts':  (1300, 0.5, None, 1),
    'links':     (1100, 0.55, (2, '8', False, 0.8), 1),
    'downloads': (1300, 0.6, (1, '8', True, 0.85), 1),
    'liveview':  (1600, 0.7, (1, '16', True, 0.9), 1),
    'analysts':  (2000, 0.8, (1, '16', True, 1.0), 1),
    'compare':   (900, 0.35, None, 0.5),
    'report':    (1700, 0.7, (1, '16', True, 1.0), 1),
    'phone':     (1100, 0.5, (2, '8', False, 0.75), 1),
    'menubar':   (1200, 0.55, (2, '8', False, 0.8), 1),
    'proof':     (1800, 0.75, (1, '16', True, 0.95), 1),
    'outro':     (2300, 0.0, None, 0),
}


def seg_at(t):
    for s in CUT['segments']:
        if s['start'] <= t < s['end']:
            return s
    return CUT['segments'][-1]


def chord_at(t):
    k = int(np.floor((t - ANCHOR) / CHORD_LEN))
    return CHORDS[k % 4], ANCHOR + k * CHORD_LEN


def cutoff(t):
    s = seg_at(t)
    if s['id'] == 'meet' and t < ANCHOR:
        return 420
    return ENERGY[s['id']][0]


def beats(t0, t1, step=1.0, offset=0.0):
    out, k = [], int(np.ceil((t0 - ANCHOR) / (BEAT * step) - offset))
    while True:
        t = ANCHOR + (k + offset) * BEAT * step
        if t >= t1:
            return out
        if t >= t0:
            out.append(t)
        k += 1


padL = np.zeros(N); padR = np.zeros(N)
c0 = ANCHOR - CHORD_LEN * np.ceil(ANCHOR / CHORD_LEN)
while c0 < OUTRO_HIT:
    (bass, notes), _ = chord_at(c0 + 0.01)
    fc = cutoff(max(c0 + 0.5, 0))
    n = int((CHORD_LEN + 2.2) * SR)
    env = adsr(n, 1.3, 2.0, 1.5)
    for m in notes:
        f = hz(m)
        tab = saw_table(f, fc)
        for d, pan in ((-9, 0.25), (0, 0.5), (9, 0.75)):
            v = osc(tab, f, n, d, rng.random(), vib=0.15) * env * 0.05
            place(padL, c0, v * np.sqrt(1 - pan)); place(padR, c0, v * np.sqrt(pan))
    f = hz(bass + 12)
    v = osc(saw_table(f, fc * 0.6), f, n, 0, 0.3) * env * 0.06
    place(padL, c0, v); place(padR, c0, v)
    c0 += CHORD_LEN
# the pad stops at the outro hit, where the final chord takes over
padGain = ramp_marks([(0, 0), (0.4, 0.85), (SEG['oldway']['start'] + 5, 1.0), (SEG['meet']['start'], 0.6), (ANCHOR, 1.0),
                      (OUTRO_HIT - 0.3, 1.0), (OUTRO_HIT + 0.6, 0.0), (DUR, 0.0)])
padL *= padGain; padR *= padGain


def kick(strength=1.0):
    n = int(0.45 * SR)
    t = tt(n)
    f = 46 + 90 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * 1.6 * strength) * 0.9


def hat(open_=False):
    n = int((0.18 if open_ else 0.06) * SR)
    return hp(rng.standard_normal(n), 7000, 4) * np.exp(-tt(n) / (0.05 if open_ else 0.014))


def clap():
    n = int(0.25 * SR)
    t = tt(n)
    return bp(rng.standard_normal(n), 900, 3000) * np.exp(-t / 0.09) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < 0.03))


drums = np.zeros(N); hats = np.zeros(N); kick_times = []
bassL = np.zeros(N); arp = np.zeros(N)
pattern = [0, 2, 1, 3, 2, 4, 3, 1]
for s in CUT['segments']:
    fc, arp_lvl, dr, bass_on = ENERGY[s['id']]
    a, b = max(s['start'] + 0.15, ANCHOR if s['id'] == 'meet' else 0), s['end'] - 0.15
    if s['id'] == 'outro':
        b = OUTRO_HIT
    if dr:
        every, hmode, claps, strength = dr
        for t in beats(a, b, every):
            place(drums, t, kick(strength)); kick_times.append(t)
        if hmode == '8':
            for t in beats(a, b, 1, 0.5):
                place(hats, t, hat(), 0.5)
        else:
            for i, t in enumerate(beats(a, b, 0.25)):
                place(hats, t, hat(i % 4 == 2), 0.55 if i % 2 else 0.3)
        if claps:
            for t in beats(a, b, 2, 0.5):
                place(drums, t, clap(), 0.35)
    if bass_on and a < b:
        step = 0.5 if bass_on == 1 else 1.0
        for t in beats(max(a, ANCHOR), b, step):
            (root, _), _ = chord_at(t + 0.01)
            f = hz(root)
            n = int(BEAT * step * SR * 0.95)
            x_ = tt(n)
            x = np.sin(2 * np.pi * f * x_) + 0.25 * np.sin(4 * np.pi * f * x_) + 0.08 * np.sin(6 * np.pi * f * x_)
            place(bassL, t, np.tanh(1.8 * x * np.minimum(1, x_ / 0.006) * np.exp(-x_ / 0.32)) * 0.45 * bass_on)
    if arp_lvl and a < b:
        for i, t in enumerate(beats(max(a, ANCHOR), b, 0.5)):
            (root, notes), _ = chord_at(t + 0.01)
            tones = sorted(set([m + 12 for m in notes] + [notes[0] + 24]))
            m = tones[pattern[i % len(pattern)] % len(tones)]
            f = hz(m)
            n = int(0.5 * SR)
            x = osc(saw_table(f, 2600), f, n) * np.exp(-tt(n) / 0.11) * np.minimum(1, tt(n) / 0.003)
            place(arp, t, x, 0.11 * arp_lvl)

duck = np.ones(N)
for tk in kick_times:
    i = int(tk * SR); n = int(0.35 * SR); j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], (1 - 0.55 * np.exp(-tt(n) / 0.09))[: j - i])
d = int(BEAT * 0.75 * SR)
arpL = arp.copy(); arpR = arp * 0.6
for k in range(1, 5):
    sh = np.zeros(N); sh[d * k:] = arp[: N - d * k] * 0.42 ** k
    if k % 2:
        arpR += sh
    else:
        arpL += sh

outro = np.zeros(N)
n = int(min(7.5, DUR - OUTRO_HIT) * SR)
for m in [38, 50, 57, 62, 64, 69]:
    f = hz(m)
    v = osc(saw_table(f, 1800), f, n, rng.normal() * 5, rng.random(), 0.2) * adsr(n, 0.08, 5.0, 1.0) * np.exp(-tt(n) / 3.5)
    place(outro, OUTRO_HIT, v, 0.09)

musicL = (padL + arpL + bassL) * duck + drums * 0.62 + hats * 0.16 + outro
musicR = (padR + arpR + bassL) * duck + drums * 0.62 + hats * 0.13 + outro
rvL, rvR = stereo_reverb(padL * 0.6 + arp * 0.9 + outro, 3.5, 0.9, 0.55)
musicL += rvL; musicR += rvR
fade = np.clip(tt(N) / 0.8, 0, 1) * np.clip((DUR - tt(N)) / 1.8, 0, 1)
musicL *= fade; musicR *= fade

# ---------------------------------------------------------------- sound effects
sfxL = np.zeros(N); sfxR = np.zeros(N); send = np.zeros(N)


def put(t0, sig, gain=1.0, pan=0.5, verb=0.3):
    if t0 is None:
        return
    place(sfxL, t0, sig * np.sqrt(1 - pan), gain); place(sfxR, t0, sig * np.sqrt(pan), gain)
    place(send, t0, sig, gain * verb)


def whoosh(dur=0.9, up=True):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    for i in range(0, n, 1024):
        k = i / n
        c = 300 + 5200 * k ** 1.6 if up else 5000 - 4500 * k
        y = bp(x[max(0, i - 2048): i + 1024], c * 0.6, min(c * 1.6, 20000))
        out[i: i + 1024] = y[-len(out[i: i + 1024]):]
    return out * np.sin(np.pi * np.clip(tt(n) / dur, 0, 1)) ** 2


def boom(strength=1.0, length=1.6):
    n = int(length * SR)
    t = tt(n)
    body = np.sin(2 * np.pi * np.cumsum(38 + 70 * np.exp(-t / 0.08)) / SR) * np.exp(-t / (0.45 * length))
    return np.tanh((body + lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.12) * 0.5) * 1.4 * strength)


def riser(dur=1.4):
    n = int(dur * SR)
    k = tt(n) / dur
    return whoosh(dur) * k ** 2 + np.sin(2 * np.pi * np.cumsum(200 + 900 * k ** 2) / SR) * k ** 3 * 0.25


def ping(f, decay=0.4):
    n = int(decay * 4 * SR)
    t = tt(n)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t)) * np.exp(-t / decay)


def shatter():
    n = int(1.2 * SR)
    out = hp(rng.standard_normal(n), 2500) * np.exp(-tt(n) / 0.08) * 0.6
    for _ in range(36):
        s = ping(rng.uniform(2200, 8500), rng.uniform(0.03, 0.12))
        i = int(rng.uniform(0, 0.55) ** 2 * SR); j = min(n, i + len(s))
        out[i:j] += s[: j - i] * rng.uniform(0.1, 0.35)
    return out


def tone(f, ms=40):
    n = int(ms / 1000 * SR)
    return np.sin(2 * np.pi * f * tt(n)) * np.exp(-tt(n) / (ms / 4000))


def deny():
    n = int(0.16 * SR)
    t = tt(n)
    return lp(np.sign(np.sin(2 * np.pi * 150 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 151.5 * t)) * 0.5, 1400) * np.exp(-t / 0.06)


def lock():
    a = tone(2600, 25)
    n = int(0.12 * SR)
    b = np.sin(2 * np.pi * np.cumsum(700 + 900 * tt(n) / 0.12) / SR) * np.exp(-tt(n) / 0.05)
    out = np.zeros(int(0.2 * SR)); out[: len(a)] += a; out[int(0.04 * SR): int(0.04 * SR) + n] += b * 0.7
    return out


def chime(notes, gap=0.07, decay=0.38):
    parts = [ping(hz(m), decay) for m in notes]
    out = np.zeros(int(gap * SR) * len(notes) + max(len(p) for p in parts))
    for i, p in enumerate(parts):
        o = int(i * gap * SR); out[o: o + len(p)] += p / len(notes) ** 0.5
    return out


def blip(f0, f1, length=0.18):
    n = int(length * SR)
    t = tt(n)
    return np.sin(2 * np.pi * np.cumsum(f0 + (f1 - f0) * t / length) / SR) * np.exp(-t * 6 / length)


def click():
    n = int(0.05 * SR)
    t = tt(n)
    return rng.uniform(-1, 1, n) * np.exp(-t * 220) + np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 300) * 0.5


def keytick():
    n = int(0.012 * SR)
    return hp(rng.standard_normal(n), 2000) * np.exp(-tt(n) / 0.003)


def buzz():
    n = int(0.22 * SR)
    t = tt(n)
    return np.sign(np.sin(2 * np.pi * 110 * t)) * np.exp(-t * 14) * (1 - np.exp(-t * 400))


# cuts
for s in CUT['segments'][1:]:
    put(s['start'] - 0.45, whoosh(0.9), 0.2, 0.5, 0.4)
    w = whoosh(0.9) * 0.1
    place(sfxL, s['start'] - 0.45, w * np.linspace(1, 0, len(w))); place(sfxR, s['start'] - 0.45, w * np.linspace(0, 1, len(w)))

# index.html scenes: hits from timing.json, risers into the big ones
M = lambda t, sc=None: to_cut('scenes', sc or scene_of(t), t)
for t_hit in (11.85, 17.35, 60.4):
    put(M(t_hit) - 1.4 if M(t_hit) is not None else None, riser(1.4), 0.16, 0.5, 0.3)
for h in TIMING['hits']:
    t, kind = h['t'], h['kind']
    c = M(t)
    if c is None:
        continue
    if kind == 'impact':
        put(c, boom(1.0), 0.55, 0.5, 0.45)
    elif kind == 'impact-soft':
        put(c, boom(0.6, 1.0), 0.32, 0.5, 0.35)
    elif kind == 'shatter':
        put(c, shatter(), 0.5, 0.5, 0.5); put(c, boom(0.7, 1.0), 0.3)
    elif kind == 'click':
        put(c, tone(3200, 18), 0.35, 0.35, 0.1); put(c, keytick(), 0.1, 0.35, 0.1)
    elif kind == 'lock':
        put(c, lock(), 0.35, 0.3, 0.2)
    elif kind == 'chime':
        put(c, chime([88, 95], 0.07, 0.35), 0.25, 0.5, 0.5)
    elif kind == 'deny':
        put(c, deny(), 0.22, 0.65, 0.2)
    elif kind == 'alarm-soft':
        put(c, deny(), 0.25, 0.6, 0.3); put(c + 0.18, deny(), 0.2, 0.6, 0.3)
    elif kind == 'tick':
        put(c, tone(1900, 40), 0.18, 0.5, 0.25)
    elif kind == 'strike':
        n = int(0.28 * SR)
        put(c, bp(rng.standard_normal(n), 1500, 6000) * np.minimum(1, tt(n) / 0.01) * np.exp(-tt(n) / 0.08), 0.3, 0.6, 0.2)
    elif kind == 'rise-hit':
        put(c - 0.9, riser(0.9), 0.1, 0.5, 0.2); put(c, boom(0.5, 0.9), 0.3, 0.5, 0.3)
for t0, dur in [(28.25, 0.7), (48.6, 0.58), (49.75, 0.47), (50.3, 0.28), (51.5, 0.7)]:
    for k in range(int(dur * 34)):
        put(M(t0) + k / 34 + rng.uniform(0, 0.01), keytick(), 0.08 + rng.uniform(0, 0.04), 0.5 + rng.uniform(-0.2, 0.2), 0.1)
for t0 in [49.4, 50.75, 51.0, 52.8, 53.3, 54.2, 54.6, 55.0, 55.4, 55.8]:
    put(M(t0), tone(2400, 20), 0.06, 0.7, 0.05)
for t0 in [52.3, 53.7, 56.3]:
    put(M(t0), deny(), 0.14, 0.7, 0.2)
for t0 in [50.45, 51.7, 53.65, 55.25]:  # Droid's tool calls cross the divider
    n = int(0.3 * SR)
    put(M(t0), np.sin(2 * np.pi * np.cumsum(500 + 1600 * tt(n) / 0.3) / SR) * np.sin(np.pi * tt(n) / 0.3) * 0.5, 0.12, 0.6, 0.3)
put(M(41.2), whoosh(1.35), 0.3, 0.6, 0.3)  # the file flies into the sandbox

# aegis-promo.html scenes (times from its own timeline)
P = lambda sc, t: to_cut('promo', sc, t)
for i, (t, m) in enumerate([(23.9, 62), (24.8, 65), (25.65, 69), (26.55, 74)]):  # badges land
    put(P('s4', t), blip(hz(m + 12) * 1.5, hz(m + 12), 0.25), 0.16, 0.28 + i * 0.15, 0.3)
    put(P('s4', t), kick(0.6), 0.3, 0.5, 0)
put(P('s7', 47.6), blip(400, 800, 0.3), 0.08, 0.25); put(P('s7', 47.6), blip(400, 800, 0.3), 0.08, 0.75)
put(P('s7', 47.9) - 0.36, whoosh(0.6), 0.12)
for t in [48.5, 49.1, 49.7, 50.4, 51.2, 51.8, 52.9, 53.4, 54.0, 54.7]:  # Worker A typing, left
    for i in range(5):
        put(P('s7', t + i * 0.06), tone(3200, 30), 0.04, 0.22, 0.05)
for t in [48.9, 49.5, 50.2, 50.6, 51.3, 52.1, 53.7, 54.6]:  # Worker B typing, right
    for i in range(5):
        put(P('s7', t + i * 0.06), tone(3200, 30), 0.04, 0.78, 0.05)
put(P('s7', 52.3), buzz(), 0.11, 0.25, 0.1); put(P('s7', 52.8), buzz(), 0.11, 0.75, 0.1)
put(P('s7', 53.3), blip(120, 90, 0.5), 0.1)
put(P('s7', 55.6), blip(220, 220, 0.5), 0.14, 0.25); put(P('s7', 57.4), blip(220, 220, 0.5), 0.14, 0.75)
put(P('s8', 59.9), riser(1.3), 0.12, 0.5, 0.5)
put(P('s8', 61.2), boom(0.9), 0.5, 0.5, 0.45); put(P('s8', 61.3), chime([62, 69, 74]), 0.2, 0.5, 0.6)
put(P('s8', 63.4), blip(300, 900, 0.9), 0.09); put(P('s8', 65.0), buzz(), 0.07)
put(P('s10', 75.5) - 0.24, whoosh(0.4), 0.1); put(P('s10', 75.45), blip(1200, 1500, 0.12), 0.1)
for i in range(6):
    put(P('s10', 76.3 + i * 0.17), tone(3200, 30), 0.015)
put(P('s10', 77.3), blip(hz(88), hz(88), 0.3), 0.09); put(P('s10', 77.42), blip(hz(84), hz(84), 0.4), 0.09)
put(P('s11', 81.5), click(), 0.35, 0.5, 0.1); put(P('s11', 81.95) - 0.24, whoosh(0.4), 0.08)
for t in np.arange(81.7, 83.3, 0.045):
    put(P('s11', t), tone(3200, 30), 0.02 * (1 - (t - 81.7) / 1.6) + 0.004)
put(P('s12', 85.8), riser(1.3), 0.14, 0.5, 0.5)
put(OUTRO_HIT, boom(1.0), 0.6, 0.5, 0.5); put(P('s12', 88.3), chime([62, 69, 74, 78, 81], 0.09, 0.45), 0.3, 0.5, 0.6)

rL, rR = stereo_reverb(send, 2.6, 0.55, 0.6, 7000)
sfxL += rL; sfxR += rR

# ---------------------------------------------------------------- voice
vo = np.zeros(N)
lines = []
for v in CUT['vo']:
    s = SEG[v['seg']]
    wav = os.path.join(OUT, v['file'] + '.wav')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(HERE, 'audio', 'vo', v['file'] + '.aiff'),
                    '-ac', '1', '-ar', str(SR), wav], check=True)
    _, x = wavfile.read(wav)
    x = hp(x.astype(np.float64) / 32768.0, 90)
    x /= np.max(np.abs(x)) + 1e-9
    a = s['start'] + (v['at'] - s['from'])
    place(vo, a, x)
    lines.append((a, a + len(x) / SR, v['text'], v['seg'], s['end']))
for a, b, text, seg, end in lines:
    if b > end + 0.05:
        print(f'warning: "{text[:40]}…" runs {b - end:.2f} s past the end of {seg}')
lines.sort()
for (a1, b1, t1, *_), (a2, *_rest) in zip(lines, lines[1:]):
    if b1 > a2 + 0.05:
        print(f'warning: "{t1[:40]}…" overlaps the next line by {b1 - a2:.2f} s')
voRvL, voRvR = stereo_reverb(vo, 1.0, 0.18, 0.1, 5000)

env = np.convolve(np.abs(vo), np.ones(int(0.05 * SR)) / int(0.05 * SR), mode='same')
env = np.clip(env / 0.08, 0, 1)
rel = np.exp(-1 / (0.35 * SR)) ** 64
sm = np.empty(N); acc = 0.0
for i in range(0, N, 64):
    acc = env[i] if env[i] > acc else acc * rel
    sm[i: i + 64] = acc
duckVO = 1 - 0.62 * sm


def master(L, R, name):
    st = np.tanh(np.stack([L, R], 1) * 1.1) / 1.1
    st *= 0.9 / (np.max(np.abs(st)) + 1e-9)
    path = os.path.join(OUT, name)
    wavfile.write(path, SR, (st * 32767).astype(np.int16))
    print(path)


master(musicL * duckVO * 0.42 + sfxL * 0.7 + vo + voRvL, musicR * duckVO * 0.42 + sfxR * 0.7 + vo + voRvR, 'mix_vo.wav')
master(musicL * duckVO * 0.8 + sfxL, musicR * duckVO * 0.8 + sfxR, 'mix_novo.wav')


def ts(x):
    h, x = divmod(x, 3600); m, x = divmod(x, 60)
    return f'{int(h):02d}:{int(m):02d}:{int(x):02d},{int(round((x % 1) * 1000)) % 1000:03d}'


with open(os.path.join(HERE, 'captions.srt'), 'w') as f:
    for i, (a, b, text, *_) in enumerate(lines, 1):
        f.write(f'{i}\n{ts(a)} --> {ts(b)}\n{text}\n\n')
print(f'captions.srt · cut is {DUR:.2f} s')
