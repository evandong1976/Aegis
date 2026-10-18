"""Soundtrack for the Aegis product video, synthesised from scratch.

Music (D minor, 96 BPM): pads, sub bass, arpeggio and drums whose intensity follows the scenes.
Sound effects sit on the hits and transitions in timing.json, so they land on the animation.
The scratch voiceover (audio/vo/*.aiff, macOS `say`) is placed at each scene's "vo" offset and
the music ducks under it.

Writes audio/build/mix_vo.wav and audio/build/mix_novo.wav (48 kHz stereo).
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, 'timing.json')))
SR = 48000
DUR = T['duration']
N = int(DUR * SR)
rng = np.random.default_rng(7)
OUT = os.path.join(HERE, 'audio', 'build')
os.makedirs(OUT, exist_ok=True)


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
        w = (1 / k) / (1 + (k * f / fc) ** 2)
        out += w * np.sin(2 * np.pi * k * x)
        k += 1
    return out / (np.max(np.abs(out)) + 1e-9)


def osc(table, f, n, detune_cents=0.0, phase0=0.0, vib=0.0):
    t = tt(n)
    ff = f * 2 ** (detune_cents / 1200)
    ph = phase0 + ff * t + (vib * np.sin(2 * np.pi * 0.23 * t + phase0 * 6) if vib else 0)
    return table[(ph * TABLE).astype(np.int64) & (TABLE - 1)]


def adsr(n, a, r, curve=1.0):
    t = tt(n)
    env = np.minimum(1, t / max(a, 1e-4)) ** curve
    rel = np.clip((n / SR - t) / max(r, 1e-4), 0, 1)
    return env * rel


def reverb_ir(seconds, decay, seed, bright=6000):
    n = int(seconds * SR)
    r = np.random.default_rng(seed)
    ir = r.standard_normal(n) * np.exp(-tt(n) / decay)
    ir = lp(ir, bright)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return ir / np.sqrt(np.sum(ir ** 2))


def stereo_reverb(x, seconds=3.0, decay=0.7, wet=0.3, bright=6000):
    l = fftconvolve(x, reverb_ir(seconds, decay, 1, bright))[:N]
    r = fftconvolve(x, reverb_ir(seconds, decay, 2, bright))[:N]
    return l * wet, r * wet


# ---------------------------------------------------------------- music
BEAT = 60 / 96
ANCHOR = 17.35  # the logo hit sits on a downbeat
CHORD_LEN = 8 * BEAT  # two bars
# i - VI - III - VII in D minor; (bass midi, pad voicing)
CHORDS = [
    (38, [50, 53, 57, 62]),  # Dm
    (34, [50, 53, 58, 62]),  # Bb
    (41, [48, 53, 57, 60]),  # F
    (36, [48, 52, 55, 60]),  # C
]


def chord_at(t):
    k = int(np.floor((t - ANCHOR) / CHORD_LEN))
    return CHORDS[k % 4], ANCHOR + k * CHORD_LEN


def cutoff(t):
    marks = [(0, 520), (5.8, 380), (15.8, 420), (17.3, 1500), (23.8, 1100), (59.3, 1700), (69.8, 850), (82.3, 1200), (93.8, 2300), (101, 2300)]
    xs, ys = zip(*marks)
    return float(np.interp(t, xs, ys))


def level(t, marks):
    xs, ys = zip(*marks)
    return float(np.interp(t, xs, ys))


padL = np.zeros(N); padR = np.zeros(N)
first = ANCHOR - CHORD_LEN * np.ceil(ANCHOR / CHORD_LEN)
c0 = first
while c0 < DUR:
    (bass, notes), _ = chord_at(c0 + 0.01)
    fc = cutoff(max(c0, 0))
    n = int((CHORD_LEN + 2.2) * SR)
    env = adsr(n, 1.3, 2.0, 1.5)
    for m in notes:
        f = hz(m)
        tab = saw_table(f, fc)
        for d, pan in ((-9, 0.25), (0, 0.5), (9, 0.75)):
            v = osc(tab, f, n, d, rng.random(), vib=0.15) * env * 0.05
            place(padL, c0, v * np.sqrt(1 - pan))
            place(padR, c0, v * np.sqrt(pan))
    # an octave-down drone keeps the low end warm under the pads
    f = hz(bass + 12)
    v = osc(saw_table(f, fc * 0.6), f, n, 0, 0.3) * env * 0.06
    place(padL, c0, v); place(padR, c0, v)
    c0 += CHORD_LEN
padGain = np.array([level(s / SR, [(0, 0.0), (0.4, 0.85), (5.8, 0.9), (11.8, 1.0), (15.4, 0.6), (17.35, 1.0), (101, 1.0)]) for s in range(0, N, 480)])
padGain = np.repeat(padGain, 480)[:N]
padL *= padGain; padR *= padGain


def beats(t0, t1, step=1.0, offset=0.0):
    k0 = int(np.ceil((t0 - ANCHOR) / (BEAT * step) - offset))
    out = []
    while True:
        t = ANCHOR + (k0 + offset) * BEAT * step
        if t >= t1:
            return out
        if t >= t0:
            out.append(t)
        k0 += 1


def kick(strength=1.0):
    n = int(0.45 * SR)
    t = tt(n)
    f = 46 + 90 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.16)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh((body + click) * 1.6 * strength) * 0.9


def hat(open_=False):
    n = int((0.18 if open_ else 0.06) * SR)
    x = hp(rng.standard_normal(n), 7000, 4) * np.exp(-tt(n) / (0.05 if open_ else 0.014))
    return x


def clap():
    n = int(0.25 * SR)
    t = tt(n)
    x = bp(rng.standard_normal(n), 900, 3000)
    env = np.exp(-t / 0.09) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < 0.03))
    return x * env


drums = np.zeros(N); hats = np.zeros(N)
kick_times = []
sections = [  # (start, end, kick every n beats, hats, claps, strength)
    (24.0, 37.0, 1, '8', False, 0.8),
    (37.0, 48.0, 1, '8', True, 0.85),
    (48.0, 59.3, 1, '16', True, 0.9),
    (59.6, 69.8, 1, '16', True, 1.0),
    (70.2, 76.0, 2, '8', False, 0.75),
    (76.0, 82.2, 1, '8', True, 0.85),
    (82.6, 88.0, 1, '16', True, 0.95),
    (88.0, 94.4, 1, '16', True, 1.0),
]
for a, b, every, hmode, claps, s in sections:
    for t in beats(a, b, every):
        place(drums, t, kick(s)); kick_times.append(t)
    if hmode == '8':
        for t in beats(a, b, 1, 0.5):
            place(hats, t, hat(), 0.5)
    else:
        for i, t in enumerate(beats(a, b, 0.25)):
            place(hats, t, hat(i % 4 == 2), 0.55 if i % 2 else 0.3)
    if claps:
        for t in beats(a, b, 2, 0.5):
            place(drums, t, clap(), 0.35)

# sidechain from the kicks
duck = np.ones(N)
for tk in kick_times:
    i = int(tk * SR); n = int(0.35 * SR)
    seg = 1 - 0.55 * np.exp(-tt(n) / 0.09)
    j = min(N, i + n)
    duck[i:j] = np.minimum(duck[i:j], seg[: j - i])

# sub bass: eighths on the chord root
bassL = np.zeros(N)
for a, b in [(17.35, 70.0), (70.0, 82.2), (82.6, 94.4)]:
    step = 0.5 if a != 70.0 else 1.0
    for t in beats(a, b, step):
        (root, _), _ = chord_at(t + 0.01)
        f = hz(root)
        n = int(BEAT * step * SR * 0.95)
        tt_ = tt(n)
        x = np.sin(2 * np.pi * f * tt_) + 0.25 * np.sin(4 * np.pi * f * tt_) + 0.08 * np.sin(6 * np.pi * f * tt_)
        env = np.minimum(1, tt_ / 0.006) * np.exp(-tt_ / 0.32)
        place(bassL, t, np.tanh(1.8 * x * env) * 0.45)

# arpeggio: plucked 16ths over the chord, with a ping-pong delay
arp = np.zeros(N)
pattern = [0, 2, 1, 3, 2, 4, 3, 1]
for a, b in [(17.35, 94.6)]:
    for i, t in enumerate(beats(a, b, 0.5)):
        (root, notes), _ = chord_at(t + 0.01)
        tones = sorted(set([m + 12 for m in notes] + [notes[0] + 24]))
        m = tones[pattern[i % len(pattern)] % len(tones)]
        f = hz(m)
        n = int(0.5 * SR)
        x = osc(saw_table(f, 2600), f, n) * np.exp(-tt(n) / 0.11) * np.minimum(1, tt(n) / 0.003)
        lvl = level(t, [(17.35, 0.35), (24, 0.55), (59.5, 0.7), (70, 0.4), (82.5, 0.7), (94.6, 0.7)])
        place(arp, t, x, 0.11 * lvl)
d = int(BEAT * 0.75 * SR)
arpL = arp.copy(); arpR = arp * 0.6
for k in range(1, 5):
    g = 0.42 ** k
    sh = np.zeros(N); sh[d * k:] = arp[: N - d * k] * g
    if k % 2:
        arpR += sh
    else:
        arpL += sh

# final chord: outro swell
outro = np.zeros(N)
n = int(6.5 * SR)
for m in [38, 50, 57, 62, 64, 69]:
    f = hz(m)
    v = osc(saw_table(f, 1800), f, n, rng.normal() * 5, rng.random(), 0.2) * adsr(n, 0.08, 5.5, 1.0) * np.exp(-tt(n) / 3.5)
    place(outro, 94.7, v, 0.09)

musicL = (padL + arpL) * duck + bassL * duck + drums * 0.62 + hats * 0.16 + outro
musicR = (padR + arpR) * duck + bassL * duck + drums * 0.62 + hats * 0.13 + outro
rvL, rvR = stereo_reverb(padL * 0.6 + arp * 0.9 + outro, 3.5, 0.9, 0.55)
musicL += rvL; musicR += rvR
# fade the whole bed in and out
fade = np.clip(tt(N) / 0.8, 0, 1) * np.clip((DUR - tt(N)) / 1.6, 0, 1)
musicL *= fade; musicR *= fade

# ---------------------------------------------------------------- sound effects
sfxL = np.zeros(N); sfxR = np.zeros(N); send = np.zeros(N)


def pan_place(t0, sig, gain=1.0, pan=0.5, verb=0.3):
    place(sfxL, t0, sig * np.sqrt(1 - pan), gain)
    place(sfxR, t0, sig * np.sqrt(pan), gain)
    place(send, t0, sig, gain * verb)


def whoosh(dur=0.9):
    n = int(dur * SR)
    t = tt(n)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    # sweep a band upward in small blocks
    blk = 1024
    for i in range(0, n, blk):
        k = i / n
        c = 300 + 5200 * k ** 1.6
        seg = x[max(0, i - 2048): i + blk]
        y = bp(seg, c * 0.6, min(c * 1.6, 20000))
        out[i: i + blk] = y[-len(out[i: i + blk]):]
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return out * env


def boom(strength=1.0, length=1.6):
    n = int(length * SR)
    t = tt(n)
    f = 38 + 70 * np.exp(-t / 0.08)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.45 * length))
    hiss = lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.12) * 0.5
    return np.tanh((body + hiss) * 1.4 * strength)


def riser(dur=1.4):
    n = int(dur * SR)
    t = tt(n)
    x = whoosh(dur) * (t / dur) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / dur) ** 2) / SR) * (t / dur) ** 3 * 0.25
    return x + tone


def ping(f, decay=0.4):
    n = int(decay * 4 * SR)
    t = tt(n)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t)) * np.exp(-t / decay)


def shatter():
    n = int(1.2 * SR)
    out = hp(rng.standard_normal(n), 2500) * np.exp(-tt(n) / 0.08) * 0.6
    for _ in range(36):
        f = rng.uniform(2200, 8500)
        s = ping(f, rng.uniform(0.03, 0.12))
        i = int(rng.uniform(0, 0.55) ** 2 * SR)
        j = min(n, i + len(s))
        out[i:j] += s[: j - i] * rng.uniform(0.1, 0.35)
    return out


def tick_(f=1900, n_ms=40, g=1.0):
    n = int(n_ms / 1000 * SR)
    return np.sin(2 * np.pi * f * tt(n)) * np.exp(-tt(n) / (n_ms / 4000)) * g


def deny():
    n = int(0.16 * SR)
    t = tt(n)
    sq = np.sign(np.sin(2 * np.pi * 150 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 151.5 * t)) * 0.5
    return lp(sq, 1400) * np.exp(-t / 0.06)


def lock():
    a = tick_(2600, 25)
    n = int(0.12 * SR)
    t = tt(n)
    b = np.sin(2 * np.pi * np.cumsum(700 + 900 * t / 0.12) / SR) * np.exp(-t / 0.05)
    out = np.zeros(int(0.2 * SR)); out[: len(a)] += a; out[int(0.04 * SR): int(0.04 * SR) + n] += b * 0.7
    return out


def chime():
    a, b = ping(1318.5, 0.35), ping(1975.5, 0.3)
    out = np.zeros(int(0.07 * SR) + max(len(a), len(b)))
    out[: len(a)] += a * 0.5
    out[int(0.07 * SR): int(0.07 * SR) + len(b)] += b * 0.4
    return out


def strike():
    n = int(0.28 * SR)
    t = tt(n)
    return bp(rng.standard_normal(n), 1500, 6000) * np.minimum(1, t / 0.01) * np.exp(-t / 0.08)


def typing(t0, dur, rate=34):
    k = 0
    while k / rate < dur:
        pan_place(t0 + k / rate + rng.uniform(0, 0.01), hp(rng.standard_normal(int(0.012 * SR)), 2000) * np.exp(-tt(int(0.012 * SR)) / 0.003), 0.08 + rng.uniform(0, 0.04), 0.5 + rng.uniform(-0.2, 0.2), 0.1)
        k += 1


for tr in T['transitions']:
    pan_place(tr - 0.45, whoosh(0.9), 0.22, 0.5, 0.4)
# sweep pans left to right with the light bar
for tr in T['transitions']:
    w = whoosh(0.9) * 0.12
    place(sfxL, tr - 0.45, w * np.linspace(1, 0, len(w)))
    place(sfxR, tr - 0.45, w * np.linspace(0, 1, len(w)))
for t_hit in (11.85, 17.35, 60.4, 94.7):
    pan_place(t_hit - 1.4, riser(1.4), 0.16, 0.5, 0.3)

for h in T['hits']:
    t, kind = h['t'], h['kind']
    if kind == 'impact':
        pan_place(t, boom(1.0), 0.55, 0.5, 0.45)
    elif kind == 'impact-soft':
        pan_place(t, boom(0.6, 1.0), 0.32, 0.5, 0.35)
    elif kind == 'shatter':
        pan_place(t, shatter(), 0.5, 0.5, 0.5); pan_place(t, boom(0.7, 1.0), 0.3)
    elif kind == 'click':
        pan_place(t, tick_(3200, 18), 0.35, 0.35, 0.1); pan_place(t, hp(rng.standard_normal(int(0.01 * SR)), 3000) * np.exp(-tt(int(0.01 * SR)) / 0.002), 0.1, 0.35, 0.1)
    elif kind == 'lock':
        pan_place(t, lock(), 0.35, 0.3, 0.2)
    elif kind == 'chime':
        pan_place(t, chime(), 0.22, 0.5, 0.5)
    elif kind == 'deny':
        pan_place(t, deny(), 0.22, 0.65, 0.2)
    elif kind == 'alarm-soft':
        pan_place(t, deny(), 0.25, 0.6, 0.3); pan_place(t + 0.18, deny(), 0.2, 0.6, 0.3)
    elif kind == 'tick':
        pan_place(t, tick_(1900, 40), 0.18, 0.5, 0.25)
    elif kind == 'strike':
        pan_place(t, strike(), 0.3, 0.6, 0.2)
    elif kind == 'rise-hit':
        pan_place(t - 0.9, riser(0.9), 0.1, 0.5, 0.2); pan_place(t, boom(0.5, 0.9), 0.3, 0.5, 0.3)

for t0, dur in [(28.25, 0.7), (48.6, 0.58), (49.75, 0.47), (50.3, 0.28), (51.5, 0.7)]:
    typing(t0, dur)
# terminal lines landing in the sandbox
for t0 in [49.4, 50.75, 51.0, 52.8, 53.3, 54.2, 54.6, 55.0, 55.4, 55.8]:
    pan_place(t0, tick_(2400, 20), 0.06, 0.7, 0.05)
for t0 in [52.3, 53.7, 56.3]:
    pan_place(t0, deny(), 0.14, 0.7, 0.2)
# Droid's tool calls cross the divider
for t0 in [50.45, 51.7, 53.65, 55.25]:
    n = int(0.3 * SR)
    s = np.sin(2 * np.pi * np.cumsum(500 + 1600 * tt(n) / 0.3) / SR) * np.sin(np.pi * tt(n) / 0.3) * 0.5
    pan_place(t0, s, 0.12, 0.6, 0.3)
# file flies into the sandbox
pan_place(41.2, whoosh(1.35), 0.3, 0.6, 0.3)

rL, rR = stereo_reverb(send, 2.6, 0.55, 0.6, 7000)
sfxL += rL; sfxR += rR

# ---------------------------------------------------------------- voiceover
vo = np.zeros(N)
vo_dir = os.path.join(HERE, 'audio', 'vo')
for s in T['scenes']:
    src = os.path.join(vo_dir, s['id'] + '.aiff')
    wav = os.path.join(OUT, s['id'] + '.wav')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(SR), wav], check=True)
    _, x = wavfile.read(wav)
    x = x.astype(np.float64) / 32768.0
    x = hp(x, 90)
    x /= np.max(np.abs(x)) + 1e-9
    place(vo, s['start'] + s['vo'], x, 1.0)
voRvL, voRvR = stereo_reverb(vo, 1.0, 0.18, 0.1, 5000)

# duck the music under the voice
env = np.abs(vo)
win = int(0.05 * SR)
env = np.convolve(env, np.ones(win) / win, mode='same')
env = np.clip(env / 0.08, 0, 1)
# slow release
rel = np.exp(-1 / (0.35 * SR))
sm = np.empty(N); acc = 0.0
for i in range(0, N, 64):
    v = env[i]
    acc = v if v > acc else acc * rel ** 64
    sm[i: i + 64] = acc
duckVO = 1 - 0.62 * sm


def master(L, R, name):
    st = np.stack([L, R], 1)
    st = np.tanh(st * 1.1) / 1.1
    st /= np.max(np.abs(st)) + 1e-9
    st *= 0.9
    path = os.path.join(OUT, name)
    wavfile.write(path, SR, (st * 32767).astype(np.int16))
    print(path)


master(musicL * duckVO * 0.42 + sfxL * 0.7 + vo + voRvL, musicR * duckVO * 0.42 + sfxR * 0.7 + vo + voRvR, 'mix_vo.wav')
master(musicL * duckVO * 0.8 + sfxL, musicR * duckVO * 0.8 + sfxR, 'mix_novo.wav')

# captions from the VO lines
lines = dict(l.strip().split('|', 1) for l in open(os.path.join(HERE, 'vo-lines.txt')) if '|' in l)


def ts(x):
    h, x = divmod(x, 3600); m, x = divmod(x, 60)
    return f'{int(h):02d}:{int(m):02d}:{int(x):02d},{int(round((x % 1) * 1000)) % 1000:03d}'


with open(os.path.join(HERE, 'captions.srt'), 'w') as f:
    for i, s in enumerate(T['scenes'], 1):
        _, x = wavfile.read(os.path.join(OUT, s['id'] + '.wav'))
        a = s['start'] + s['vo']
        b = a + len(x) / SR
        f.write(f"{i}\n{ts(a)} --> {ts(b)}\n{lines[s['id']]}\n\n")
print('captions.srt')
