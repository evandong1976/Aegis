# Aegis build plan

Specs, in order of precedence for their area:

- `MEGA_PROMPT.md`: behaviour, pipeline, failure handling, safety and privacy.
- `BUILD_PROMPT.md`: process, build order, handoff. §5.1 (look) now points at the design system.
- `design-system/`: tokens, fonts, components and voice. The source of truth for the look.
- `figma/`: the Figma file _Aegis — Demo path_ (https://www.figma.com/design/WrLGMPAzH8nZ8zjd2hJ9Kb):
  the mini panel, Report and click-guard frames plus their components, and specs and reference
  renders for the four dashboard screens (`figma/screens.md`, `figma/reference/*.png`, `screens/*.html`).

Live status and the handoff: `docs/PROGRESS.md`.

Deadline: Devpost closes **Sunday Oct 18, 8:00 AM**. Time checks: milestone 3 working by
**Saturday noon**; feature freeze **Saturday 10 PM**.

## Milestones and owners

**Evan** = Person A (browser and data), **Zach** = Person B (app and sandbox), per MEGA_PROMPT §7.
Claim a milestone in PROGRESS.md before starting it.

| #   | Milestone                                                                                                                                                | Owner       | Status                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------- |
| 0   | Scaffold, shared types + bridge contract, PLAN/PROGRESS, `.env.example`                                                                                  | Evan + Zach | Done (v2)                                          |
| 0a  | `demo/`: phishing page on our public domain, scam texts, fake invoice email                                                                              | Evan        | Not started                                        |
| 0b  | `demo/`: harmless test `.pkg` + scripts, EICAR; `sandbox/Dockerfile`                                                                                     | Zach        | Not started                                        |
| 1   | Shell + bridge: tray, no Dock, main window, panel on ⌃⌥A, SQLite, health, bridge; extension skeleton                                                     | Zach / Evan | Built; extension not yet loaded in a real Chrome   |
| 2   | Links: content script, Tier 1 + Safe Browsing, URL stripping, allow list, outlines, click guard wiring                                                   | Evan        | Click-guard UI built (`extension/src/guard.ts`)    |
| 3   | Downloads: interception, offscreen fetch, pre-check, queue, Daytona sandbox, `analyze.py`, deliver/hold                                                  | Evan + Zach | Not started (Report + Downloads screens are ready) |
| 4   | Worker A: Droid inside the Daytona sandbox, tests the file, returns result + sandbox log; `compare.ts`; prompt-injection test                            | Zach        | Not started (Report renders a Droid timeline)      |
| 5   | Later: mobile via Photon — forward a phone screenshot, get a verdict back (architectural.md §8)                                                          | Evan        | Deferred; not in the current build                 |
| 6   | Chalk: Worker B (standalone analyst + sandbox log), link features + Federated Queries, AI Gateway scam-text, evals per worker and combined, Accuracy tab | Evan        | Not started (Accuracy reads `evals/results.json`)  |
| 7   | Detonation: `detonate.py` + anti-cloaking, Inspect in sandbox, screenshots                                                                               | Zach        | Not started                                        |
| 8   | `~/Downloads` watcher + quarantine, Docker fallback, every §5.9 row, fn add-on (from Klair)                                                              | Zach        | fn add-on done; the rest not started               |
| 9   | Stretch: REA deep dive                                                                                                                                   | —           | Not started                                        |
| 10  | Demo run on a clean account, DoD walk, video, README, Devpost                                                                                            | Evan + Zach | Not started                                        |

## Decisions

Reversible choices. Anything that differs from a spec says why.

1. **Four verdicts: Malicious, Suspicious, Unknown, Clean** (design-system README, BUILD_PROMPT
   §5.1, `figma/screens.md`), replacing MEGA_PROMPT's "No threats found / Caution / Danger".
   They map in one place, `src/shared/verdicts.ts`: Malicious → `critical`, Suspicious → `high`,
   Unknown → `medium`, Clean → `secure`. Scores: 0–29 Clean, 30–69 Suspicious, 70–100 Malicious;
   hard rules force Malicious. **Unknown** means Aegis couldn't reach a confident verdict (partial
   analysis, sandbox unavailable, a brand-new domain with no other signal); `combine(…, {confident:
false})` turns a would-be Clean into Unknown, never the reverse. "AI can only raise" uses the
   order clean < unknown < suspicious < malicious. MEGA_PROMPT's "never say safe" still holds:
   badges say **Clean**, sentences say **No threats found** (`VERDICT_SENTENCE`).
2. **Main-window navigation** follows the Figma screen shell (nav rail + top bar + search):
   Overview, Links, Downloads, then Messages and Accuracy (both required by MEGA_PROMPT §5.7 but
   not in the four Figma screens), then Settings. MEGA_PROMPT's "Scans" tab is split into Links and
   Downloads, and Overview carries the latest of both. **Report** is not a nav item; any row opens
   it, laid out like the Figma "Report — invoice_oct.iso" frame. Nav counts are items waiting on
   you (held links; held + quarantined files), per the NavRail README.
3. **Adapted for one person's Mac, not a company workspace.** The Figma screens show a team
   product (User column, "Northwind" account chip, "Workspace" settings). Aegis is personal, so:
   the User column becomes **Seen in** (Gmail, Chrome, ~/Downloads, iMessage); the account chip
   becomes a protection-status chip that opens Settings; Settings is titled "This Mac". The bell
   button is left out because there's nothing behind it yet.
4. **Overview's coverage ring** is the share of five protection layers that are running (Chrome
   extension, link reputation, download sandbox, Droid, ~/Downloads watcher; Photon left out while
   it's deferred, decision 18), computed
   from the live health checks, with the first missing one named as "the gap". The Figma
   "Where we can see" meters become one status-dot row per layer, since each layer is on or off
   on a single Mac.
5. **Figma-only components live in the app**, not in `design-system/components/` (Zach's
   folder): StatusDot, ScanStep, TimelineStep, CodeLine, finding chips and key/value lists, in
   `src/renderer/src/components/aegis.tsx` + `assets/aegis.css`, tokens only. They stay there
   (team answer, 2026-10-16): don't move them into `design-system/`.
6. **Design-system components are a typed React port** (`src/renderer/src/components/ds/`) of
   `design-system/components/bundle.js`, with the same `ae-*` markup so `bundle.css` styles them.
   Loading the bundle as a global script would need React on `window` and a looser CSP. Aegis
   additions: `NavRail` items are buttons with `onSelect`; `ThreatTable` takes `onRowClick`;
   `SearchField` accepts a `ref` (for ⌘K). Nine icons were added to `bundle.js` and
   `assets/icons/` (link, file-text, message-square, chart-column, pause, play, external-link,
   refresh, box); the path data is shared by the app and the extension in `src/shared/icons.ts`.
7. **Tokens** come only from `design-system/tokens.css` (generated). `main.css` maps them into
   Tailwind v4's `@theme inline` and restates no hex values. `pnpm lint` runs
   `build-tokens.mjs --check`, so a stale `tokens.css` fails the build.
8. **Mini panel** follows the Figma frame (Night ops: ground over macOS vibrancy, surface cards),
   not BUILD_PROMPT §5.1's leftover "light translucent tint, white cards" line, which predates the
   design system. In Daylight it follows the system appearance like everything else.
9. **Click guard** (`extension/src/guard.ts`) renders in a closed Shadow DOM with the design
   system's CSS. A shadow root can't use `@font-face` or `:root`, so the extension's copy of
   `tokens.css` adds `[data-theme]` to the `:root` block and the three fonts are registered with
   the `FontFace` API. It adds **Trust this site** to the Figma frame's three buttons (MEGA_PROMPT
   §5.1 requires it). `ds/*` and `guard.css` are web-accessible with `use_dynamic_url` to limit
   fingerprinting. The content script wires it to real verdicts in milestone 2; until then
   `guard-preview.html` shows it with sample data.
10. **Demo data** (`AEGIS_DEMO=1`, `pnpm dev:demo`) seeds a separate `aegis-demo.db`, rebuilt
    on every demo launch, from the Figma demo path. The UI shows a "Demo data" chip, and the real
    `aegis.db` is never touched. The Accuracy tab never shows sample numbers, demo or not.
11. **SQLite = `node:sqlite`** (Electron 44.8 ships Node 24.22 / SQLite 3.53): no native module.
    The pre-release none/caution/danger schema from the first skeleton is detected and rebuilt
    (it never held real data).
12. **Report actions** (Delete file, Keep in quarantine, Download/Restore anyway) are shown but
    disabled until `quarantine.ts` lands (milestone 8), rather than pretending to work.
13. **Carried over from the first skeleton** (branch `milestone-0-skeleton`, now superseded):
    electron-vite + React 19 + Tailwind v4, the bridge (Origin + Host checks, 501 for routes not
    built yet), health checks, tray, panel window, fixed extension ID
    `onljkbhkoinihmjibfofcalimkolemam`, offscreen heartbeat, placeholder scripts that fail loudly,
    `@electron-toolkit/utils` removed so it can't swallow shortcuts.
14. **fn key** (built 2026-10-16, ahead of milestone 8 at the team's request): Klair's add-on,
    repurposed. `native/fn-key/src/fn_key.c` is a listen-only CGEventTap that reports one event,
    a clean fn tap; Klair's fn+P/Q/H/digit chords and down/up events are removed.
    `src/main/fnkey.ts` loads it (a Node-API module, so not tied to an Electron version), toggles
    the panel on a tap and reports status to the health check; ⌃⌥A stays registered as the
    fallback. Build with `pnpm build:native` (node-gyp 10.2.0 against Electron's headers; output
    gitignored, shipped through `extraResources`). It needs Input Monitoring: under `pnpm dev` that
    is granted to Electron, in a packaged build to Aegis. Settings › Permissions has "Allow Input
    Monitoring" (re-requests and opens the System Settings pane). Declare it as pre-event code on
    Devpost.
15. **Headless UI checks**: `pnpm capture [dir] [routes]` (`scripts/capture.sh`) runs Aegis on
    the demo database in its own profile and bridge port (47399), screenshots the panel and each
    route, and stops only the process it started. It can't collide with a running Aegis.
    `AEGIS_CAPTURE_SCROLL=1` adds a shot of each route scrolled to the bottom.
16. **The main window is a fixed frame**: the title-bar strip and nav rail never move; only the
    right-hand column scrolls (`.app-shell__content`). Window-level scrolling with a sticky rail
    let the rail slide up under the traffic lights.
17. **Two analysis workers, compared** (team direction, 2026-10-16). Every file that needs the
    cloud goes to two independent workers at once, each on its own copy, neither seeing the other:
    **Worker A** is a throwaway Daytona sandbox with Factory Droid living inside it as the analyst;
    **Worker B** is Chalk's AI doing the same job standalone in its own isolated environment. Each
    examines the file, **tests it inside its sandbox**, and returns a verdict, confidence, summary,
    timeline, evidence and **a log of what happened in its sandbox** (`WorkerResult`, to add to
    `src/shared/types.ts` at M3/M4 as a joint change). `compare.ts` reconciles them: agreement → that
    verdict; disagreement → the more severe one, both shown in the report; a test that errors or
    shows harmful behaviour → Malicious; one worker missing → the other's answer, marked partial;
    both missing → pre-check only, never better than Unknown. The result goes through `verdict.ts`,
    so it can only raise. Architecture: `docs/architectural.md` §2.1 and §3.6.
    - **Differs from MEGA_PROMPT:** §5.3 had `analyze.py` as static-only and §5.4 had Droid reading
      results from the main process. Now the file is tested inside the sandbox, and Chalk is a second
      analyst as well as the link-data and eval platform. Unchanged: nothing runs on the Mac; each
      sandbox is fresh, network off, time-limited and destroyed in a `finally`; clean documents are
      still cleared by the local pre-check and never uploaded; demos use EICAR and our own harmless
      test files only.
    - **Privacy copy changes:** risky files now go to both Daytona and Chalk. The README's Privacy
      section is updated; the in-app copy (`SettingsView.tsx` `PRIVACY_COPY`) must change with it
      when M4/M6 land.
    - **Known limits:** Daytona sandboxes are Linux, so macOS apps and Windows programs can't be
      tested there; workers fall back to static analysis for them and say so in the log. "A test
      that errors is dangerous" will also flag benign software that fails in a sandbox; the evals
      measure that false-alarm rate per worker so it can be tuned.
    - **To verify before building** (Sponsor findings below): that Droid can run inside a Daytona
      sandbox, and that Chalk can host its own execution sandbox. If Chalk can't, Worker B runs in
      a second isolated sandbox (another Daytona sandbox, or local Docker) with Chalk's AI doing
      the analysis, and the architecture doc says so.

18. **Photon is out of the current build** (team direction, 2026-10-17). It returns later as the
    mobile feature: forward a screenshot from your phone over iMessage or SMS, and Aegis reads it,
    runs the same checks and replies with a verdict (`docs/architectural.md` §8). Until then: no
    `photon.ts`, no message intake in the pipeline, no alert texts, no `fetch.py`. The app still
    shows Photon in a few places (a service dot in the mini panel, a row in Connections, the
    Messages tab, the "Text me" setting) as "Not set up"; they stay as placeholders for the mobile
    feature unless the team wants them hidden. MEGA_PROMPT §5.5 (messaging agent) is deferred, not
    dropped.

## Sponsor findings (BUILD_PROMPT §4.5)

Not checked yet. Do this before writing each integration, record the exact calls here, and get
`scripts/try-<sponsor>.ts` passing first. Never invent SDK method names.

| Sponsor              | Questions to answer (MEGA_PROMPT §10)                                                                                                                                                                 | Findings                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Daytona              | Snapshot/image options, start-up time, per-sandbox network off, concurrency, credits, can an agent (Droid) run inside a sandbox                                                                       | —                                            |
| Factory Droid        | TS vs Python SDK, **can it run inside a Daytona sandbox** and use tools there (Worker A), MCP (REA), run time, how it reports a log                                                                   | —                                            |
| Photon (later)       | When mobile starts: iMessage/SMS channels, receiving images (screenshots), setup time, exact env var names                                                                                            | —                                            |
| Chalk                | Features / Federated Queries / AI Gateway / Agent Evals availability, **can Chalk host a standalone analysis worker with its own sandbox (Worker B)**, resolver deploy, gateway models, env var names | —                                            |
| Google Safe Browsing | v4 `threatMatches:find` with the documented test URL                                                                                                                                                  | Health check uses it; untested without a key |

## Open questions

- Deferred: can one Devpost project enter all four tracks? (revisit before step 10)
- Deferred: which public domain hosts the demo phishing page? (needed before hosting 0a)
- Chalk env var names in `.env.example` are guesses until the docs check (Photon's too, for later).
- Photon is deferred to the later mobile feature, so the Photon prize track has no entry in the
  current build. Decide before submission whether to build a minimal version of §8 or drop that
  track.

Answered 2026-10-16: the Figma-only components stay in the app (decision 5). Figma frames for the
rest — Messages, Accuracy, first-run setup, the tray menu, link outlines, the scam-text banner
(`figma/built.md` › Not built yet) — will be designed later. Until then those screens are built from
the existing components; restyle them to match when the frames land.
