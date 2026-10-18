# Aegis — product video script

**Runtime:** 1:41 · **Format:** 1920×1080, 30 fps · **Tone:** calm, specific, never alarmist (the
design system's voice: state what is true, then what to do; no "safe", no exclamation marks).

Timecodes match `timing.json`, which drives both the animation (`index.html`) and the sound
(`make_audio.py`). The scratch voiceover is macOS `say -v Samantha`; a human read should hit the same
timecodes (each line fits its scene with room to spare).

| #   | Time      | Scene                | Voiceover                                                                                                                                                                        | On screen                                                                                                                                                                                                                         |
| --- | --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:06 | Every click          | Every day, you click links you didn't write, and open files you didn't make.                                                                                                     | Real-looking URLs and file names (`paypa1.com/login`, `invoice.pdf.exe`, `zoom-update.sh`) stream toward the camera in 3D. Kinetic type: *You click links you didn't write. / You open files you didn't make.*                    |
| 2   | 0:06–0:16 | Threat detected      | Most antivirus checks a file after it's already on your Mac. Then it tells you two words. Threat detected. Not what it would have done. Not why.                                 | A file lands on a Mac, *then* the scan arrives. A grey "Threat detected." dialog slams in. *Not what it would have done. Not why.* The dialog shatters.                                                                            |
| 3   | 0:16–0:24 | Meet Aegis           | This is Aegis. It opens the dangerous stuff so you don't have to, and shows you exactly what it would have done.                                                                 | The shield draws itself in cyan light, a shockwave rings out, the wordmark rises. The line from `package.json` sets under it.                                                                                                     |
| 4   | 0:24–0:37 | Links                | Every link gets a verdict before you click, without ever being opened. Lookalike domains. Link text that lies. Three day old sites asking for your password. Checked in under a second. | A phishing email in Chrome. A scan line passes; flagged links get borders. The cursor clicks `accounts.google.com` and the click guard springs up: *The link said / It actually goes to `login-northwlnd-io.sbs/sso`*. Checks light up in sync with the VO; **0.6 s**. |
| 5   | 0:37–0:48 | Downloads            | Downloads are caught in memory, before they ever touch your disk. Risky files go to a throwaway Daytona sandbox, with the network cut off from the moment it's created.          | `zoom-update.sh` starts downloading; brackets lock on: *Held at `onDeterminingFilename`*. A clean PDF stays on the Mac; the script flies along a path into a glowing sandbox. Six network probes fire and are blocked.            |
| 6   | 0:48–0:59 | Watch it run         | Then you watch it run. Factory Droid reverse engineers the file from your Mac, through read only tools that only work inside the sandbox. Every call home fails.                 | The live view: Droid's tool calls on the left, pulses crossing the *read-only tools* divider, the sandbox terminal typing the real trace on the right. Blocked network lines flash red.                                            |
| 7   | 0:59–1:10 | The report           | When the run ends, you get the answer in plain English. It would have fetched a second stage, started itself at login, and gone looking for your passwords.                      | **MALICIOUS** slams in, risk counts to **100**. *What would have happened* draws step by step beside the sample's real code with the dangerous lines lit.                                                                         |
| 8   | 1:10–1:22 | AI can only raise it | And the AI can't be talked out of it. It can only raise the verdict Aegis's rules produce. Never lower it. Aegis never calls anything safe. Without evidence, the answer is Unknown. | The verdict ladder Clean < Unknown < Suspicious < Malicious. *v = max(v_rules, v_AI)*. An AI "Clean" pushes down and bounces off; an AI "Malicious" pushes up and wins. "Safe" is struck out; **Unknown** takes its place.        |
| 9   | 1:22–1:28 | Proof                | Every claim is backed by a saved run.                                                                                                                                            | Counters: **198** unit tests passing · **26/26** end-to-end download checks · **0** sandboxes left behind · **6/6** network probes blocked.                                                                                       |
| 10  | 1:28–1:34 | Built with           | Next, a second analyst in Chalk, and verdicts over iMessage with Photon.                                                                                                         | Daytona and Factory Droid (built) orbit the shield; Chalk and Photon join, tagged *Next*.                                                                                                                                         |
| 11  | 1:34–1:41 | Outro                | Aegis. See what's behind the click, before it lands.                                                                                                                             | Shield and wordmark, light sweep, *HackHarvard 2026*. Fade.                                                                                                                                                                       |

## Accuracy notes

Every claim on screen comes from the repo:

- Verdict words, the guard copy and `login-northwlnd-io.sbs/sso`: `logs/2026-10-17-link-checks/`.
- "Checked in 0.6 s · the link was not opened": the click guard's footer in the same run.
- `zoom-update.sh`, its five behaviours and its code: `src/main/testSamples.ts` (a harmless test
  sample; its hosts are `.invalid` and never resolve).
- The sandbox trace lines: `logs/2026-10-17-1834-live-view/`.
- 198 unit tests, 26/26 end-to-end checks, 0 sandboxes left behind, six probes: `docs/DEVPOST.md`.
- Chalk (Worker B) and Photon (iMessage) are not built yet, so the video says **Next** for both.

## Files

| File                    | What                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `aegis-product-video.mp4` | The cut: animation, music, sound design and scratch voiceover          |
| `aegis-product-video-no-vo.mp4` | Same cut with music and sound only, for a human voiceover          |
| `captions.srt`          | Captions for the voiceover                                                |
| `index.html`            | Every scene, driven by one paused GSAP timeline (open it to preview)      |
| `render.mjs`            | Renders frames with headless Chrome and encodes with ffmpeg               |
| `make_audio.py`         | Synthesises the music bed and sound effects, mixes in the voiceover       |

Re-render after editing a scene:

```bash
cd video && npm install && node render.mjs && python3 make_audio.py && sh mux.sh
```
