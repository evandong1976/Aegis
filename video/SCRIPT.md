# Aegis — product video script

**Runtime:** 2:05 · **Format:** 1920×1080, 30 fps · **Tone:** calm, specific, analyst to analyst
(design-system/README.md › Content fundamentals). No alarm language, no exclamation marks, and
nothing is ever called "safe".

This cut combines two animations, each scene taken from whichever source tells it best:

- **`index.html`** (the original cut): the 3D cold open, "Threat detected", the logo, links judged
  without opening, the network-off sandbox, the live view, the real-code report and the proof
  counters.
- **`aegis-promo.html`** (the newer promo): four verdicts, two analysts (Droid on Daytona and Chalk
  on Chalk Compute), compare, iMessage via Photon, the menu bar and the outro.

`cut.json` is the edit: which scene plays when and where every voice line lands. Both sources use
the same sample, `zoom-update.sh` (the repo's harmless test sample, `src/main/testSamples.ts`).

## Script

Times are in the finished cut. **VO** is narration, **ON SCREEN** is the picture, **SOUND** is
the design under it.

### 1 · Every click — 0:00–0:06 · `index.html`

**VO** Every day, you click links you didn't write, and open files you didn't make.

**ON SCREEN** Real-looking URLs and file names (`paypa1.com/login`, `invoice.pdf.exe`,
`zoom-update.sh`) stream toward the camera in 3D. *You click links you didn't write. / You open
files you didn't make.*

**SOUND** A dark pad opening up.

### 2 · The old way — 0:06–0:16 · `index.html`

**VO** Most antivirus checks a file after it's already on your Mac. Then it tells you two words.
Threat detected. Not what it would have done. Not why.

**ON SCREEN** A file lands on a Mac, *then* the scan arrives. A grey "Threat detected." dialog
slams in. *Not what it would have done. Not why.* The dialog shatters.

**SOUND** Riser into an impact on the dialog; glass on the shatter.

### 3 · Meet Aegis — 0:16–0:24 · `index.html`

**VO** This is Aegis. It opens the dangerous stuff so you don't have to, and shows you exactly
what it would have done.

**ON SCREEN** The shield draws itself in cyan, a shockwave rings out, the wordmark rises.

**SOUND** Riser, impact; the beat and arpeggio start on the logo.

### 4 · Four verdicts — 0:24–0:30 · `aegis-promo.html`

**VO** Every link and file gets a verdict. Malicious. Suspicious. Unknown. Or clean.

**ON SCREEN** *One of four verdicts — Never a colour alone.* Each badge (icon and word) slams in
on its word with a shockwave in its colour, over an example and its sentence.

**SOUND** A pitched blip and soft kick per badge, climbing.

### 5 · Links — 0:30–0:43 · `index.html`

**VO** Links are judged before you click, without ever being opened. Lookalike domains. Link
text that lies. Three day old sites asking for your password. Checked in under a second.

**ON SCREEN** A phishing email; a scan line flags the bad links. The cursor clicks
`accounts.google.com` and the click guard springs up: *The link said / It actually goes to
`login-northwlnd-io.sbs/sso`*. Each check lights as it's named; **0.6 s**.

**SOUND** Click, a low thunk as the guard opens, ticks as the URL types out.

### 6 · Downloads — 0:43–0:54 · `index.html`

**VO** Downloads are caught in memory, before they ever touch your disk. Risky files go to a
throwaway Daytona sandbox, with the network cut off from the moment it's created.

**ON SCREEN** `zoom-update.sh` is held at `onDeterminingFilename`; a clean PDF stays on the Mac.
The script flies into a glowing sandbox, and six network probes are blocked at its barrier.

**SOUND** A latch on the hold, a chime on Clean, a whoosh into the sandbox, a buzz per probe.

### 7 · Watch it run — 0:54–1:06 · `index.html`

**VO** Then you watch it run. Factory Droid reverse engineers the file from your Mac, through
read only tools that only work inside the sandbox. Every call home fails.

**ON SCREEN** The live view: Droid's tool calls on the left, pulses crossing the *read-only
tools* divider, the sandbox terminal typing the real trace. Blocked lines flash red.

**SOUND** Typing, terminal ticks, a sweep per tool call, buzzes on the blocks.

### 8 · Two analysts — 1:06–1:20 · `aegis-promo.html`

**VO** And Aegis never relies on one opinion. Two independent analysts take it apart at once,
each in its own sandbox. Factory Droid, on Daytona. And Chalk, on Chalk Compute.

**ON SCREEN** *Taken apart in a sandbox. Twice.* The file splits into two panels, each with a red
**Network off** pill. Worker A, Factory Droid on Daytona: `sha256sum`, `droid › review_shell`,
`run_sample sh -x zoom-update.sh`, the `curl` to `updates.zoom-support.invalid` **✕ blocked**, the
LaunchAgent written, the keychain lookup, **verdict › MALICIOUS**. Worker B, Chalk: MalwareBazaar
via Chalk SQL (0 known-bad matches, a new sample), the same behaviour found independently,
**verdict › MALICIOUS**. Each name glows as it's spoken.

**SOUND** The busiest section: typing panned left (A) and right (B), buzzes on the blocks, a tone
on each verdict.

### 9 · Compare — 1:20–1:27 · `aegis-promo.html`

**VO** Aegis compares their answers. The more severe one wins, and AI can only raise a verdict,
never lower it.

**ON SCREEN** The two Malicious cards merge with a flash into **Both analysts agree ·
MALICIOUS**. On the verdict ladder the AI marker lifts the rules' Suspicious to Malicious;
*never lowered*.

**SOUND** The beat drops out; riser into an impact on the merge.

### 10 · The report — 1:27–1:37 · `index.html`

**VO** When the run ends, you get the answer in plain English. It would have fetched a second
stage, started itself at login, and gone looking for your passwords.

**ON SCREEN** **MALICIOUS** slams in and risk counts to **100**. *What would have happened* draws
step by step beside the sample's real code, each matching line lit as its step lands.

**SOUND** Impact on the badge, a tick per step.

### 11 · On your phone — 1:37–1:44 · `aegis-promo.html`

**VO** On your phone? Text Aegis a screenshot, and get a verdict back in seconds.

**ON SCREEN** An iMessage thread: a screenshot of a USPS redelivery text goes out; typing dots;
the reply: Malicious — the link goes to `usps-redelivery.top`, not usps.com.

**SOUND** Send swoosh, typing ticks, a two-note receive tone.

### 12 · Always on — 1:44–1:51 · `aegis-promo.html`

**VO** Everything lives in your menu bar. Always watching, never in the way.

**ON SCREEN** The menu bar shield; the Overview builds behind it. **fn** drops the mini panel:
*Last hour: 3 held, 0 reached this Mac*, with `zoom-update.sh` on top.

**SOUND** Key click, a soft swoosh, counter ticks slowing down.

### 13 · Proof — 1:51–1:56 · `index.html`

**VO** Every claim is backed by a saved run.

**ON SCREEN** **198** unit tests · **26/26** end-to-end download checks · **0** sandboxes left
behind · **6/6** network probes blocked.

### 14 · Outro — 1:56–2:05 · `aegis-promo.html`

**VO** Aegis. Know before you click.

**ON SCREEN** The shield draws beside the wordmark, rings pulse. *Built with Daytona · Factory ·
Chalk · Photon · HackHarvard 2026.* Fade to black.

**SOUND** Riser, the biggest impact, a five-note chime; the score resolves on D and fades.

## Accuracy notes

- Verdict words, the click guard and `login-northwlnd-io.sbs/sso`: `logs/2026-10-17-link-checks/`.
- `zoom-update.sh`, its behaviours and its code: `src/main/testSamples.ts`. Its hosts end in
  `.invalid` and never resolve. The trace lines come from `logs/2026-10-17-1834-live-view/`.
- 198 unit tests, 26/26 end-to-end checks, 0 sandboxes left behind, six probes: `docs/DEVPOST.md`.
- Worker B (Chalk) runs end to end (`pnpm try:chalk`, on `origin/main`), but neither analyst is
  wired into the app's verdicts yet, and the Photon (iMessage) flow is milestone 5. Until those
  land, present scenes 8, 9 and 11 as the design, not a recording. The dashboard numbers in scene
  12 come from the Figma demo data.

## Files

| File                            | What                                                                     |
| ------------------------------- | ------------------------------------------------------------------------ |
| `aegis-product-video.mp4`       | The cut: picture, score, sound design and scratch voiceover              |
| `aegis-product-video-no-vo.mp4` | Same cut without the voice; the music still dips where each line goes    |
| `captions.srt`                  | Captions for the voiceover                                               |
| `cut.json`                      | The edit: segments from each source, and each voice line's time and text |
| `index.html`, `scenes.js`       | The original scenes (GSAP), timed by `timing.json`; open to preview      |
| `aegis-promo.html`              | The newer promo's scenes; open to preview                                |
| `cut.mjs`                       | Renders the cut frame by frame in headless Chrome and encodes it         |
| `score.py`                      | Synthesises the score and effects for the cut and mixes in the voice     |
| `build.sh`                      | Runs everything                                                          |

The voice is a scratch track from macOS `say` (Samantha), one file per line in `audio/vo/`. To use
a real voice, record each line in `cut.json` over its file and run `sh build.sh --audio`. If a take
runs long, `score.py` warns, and you can move that line's `at` in `cut.json`.

```bash
cd video && npm install && sh build.sh
```
