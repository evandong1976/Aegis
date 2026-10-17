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

| #   | Milestone                                                                                              | Owner       | Status                                             |
| --- | ------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------- |
| 0   | Scaffold, shared types + bridge contract, PLAN/PROGRESS, `.env.example`                                | Evan + Zach | Done (v2)                                          |
| 0a  | `demo/`: phishing page on our public domain, scam texts, fake invoice email                            | Evan        | Not started                                        |
| 0b  | `demo/`: harmless test `.pkg` + scripts, EICAR; `sandbox/Dockerfile`                                   | Zach        | Not started                                        |
| 1   | Shell + bridge: tray, no Dock, main window, panel on ⌃⌥A, SQLite, health, bridge; extension skeleton   | Zach / Evan | Built; extension not yet loaded in a real Chrome   |
| 2   | Links: content script, Tier 1 + Safe Browsing, URL stripping, allow list, outlines, click guard wiring | Evan        | Click-guard UI built (`extension/src/guard.ts`)    |
| 3   | Downloads: interception, offscreen fetch, pre-check, Daytona, `analyze.py`, verdict, deliver/hold      | Evan + Zach | Not started (Report + Downloads screens are ready) |
| 4   | Droid Stage 2 timeline + code evidence, prompt-injection test, README section                          | Zach        | Not started (Report renders `DroidReport`)         |
| 5   | Photon: iMessage/SMS, email, alerts, follow-ups, Messages tab                                          | Evan        | Not started                                        |
| 6   | Chalk: features + Federated Queries, AI Gateway scam-text, evals, `pnpm eval`, Accuracy tab            | Evan        | Not started (Accuracy reads `evals/results.json`)  |
| 7   | Detonation: `detonate.py` + anti-cloaking, Inspect in sandbox, screenshots                             | Zach        | Not started                                        |
| 8   | `~/Downloads` watcher + quarantine, Docker fallback, every §5.9 row, fn add-on (from Klair)            | Zach        | Not started                                        |
| 9   | Stretch: REA deep dive, Photon voice                                                                   | —           | Not started                                        |
| 10  | Demo run on a clean account, DoD walk, video, README, Devpost                                          | Evan + Zach | Not started                                        |

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
4. **Overview's coverage ring** is the share of six protection layers that are running (Chrome
   extension, link reputation, download sandbox, Droid, ~/Downloads watcher, Photon), computed
   from the live health checks, with the first missing one named as "the gap". The Figma
   "Where we can see" meters become one status-dot row per layer, since each layer is on or off
   on a single Mac.
5. **Figma-only components live in the app**, not in `design-system/components/` (Zach's
   folder): StatusDot, ScanStep, TimelineStep, CodeLine, finding chips and key/value lists, in
   `src/renderer/src/components/aegis.tsx` + `assets/aegis.css`, tokens only. Promote them to the
   design system if Zach wants them there.
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
14. **fn key**: reuse Klair's add-on, repurposed for Aegis (team answer, 2026-10-16). Copy
    `~/Downloads/Klair/native/fn-key` → `native/fn-key` and `~/Downloads/Klair/src/main/fnkey.ts`
    → `src/main/fnkey.ts` in milestone 8, rename to Aegis, drop unused events, wire a clean fn tap
    to `togglePanel()`, keep ⌃⌥A as the fallback, and declare it as pre-event code on Devpost.
15. **Headless UI checks**: `pnpm capture [dir] [routes]` (`scripts/capture.sh`) runs Aegis on
    the demo database in its own profile and bridge port (47399), screenshots the panel and each
    route, and stops only the process it started. It can't collide with a running Aegis.

## Sponsor findings (BUILD_PROMPT §4.5)

Not checked yet. Do this before writing each integration, record the exact calls here, and get
`scripts/try-<sponsor>.ts` passing first. Never invent SDK method names.

| Sponsor              | Questions to answer (MEGA_PROMPT §10)                                                                                | Findings                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Daytona              | Snapshot/image options, start-up time, per-sandbox network off, concurrency, credits                                 | —                                            |
| Factory Droid        | TS vs Python SDK, can it run in/connect to a Daytona sandbox, MCP (REA), run time                                    | —                                            |
| Photon               | Day-one channels, email attachments, voice setup, exact env var names                                                | —                                            |
| Chalk                | Features / Federated Queries / AI Gateway / Agent Evals availability, resolver deploy, gateway models, env var names | —                                            |
| Google Safe Browsing | v4 `threatMatches:find` with the documented test URL                                                                 | Health check uses it; untested without a key |

## Open questions

- Deferred: can one Devpost project enter all four tracks? (revisit before step 10)
- Deferred: which public domain hosts the demo phishing page and the Photon email subdomain?
  (needed before hosting 0a and Photon email)
- Photon and Chalk env var names in `.env.example` are guesses until the docs check.
- Zach: should the Figma-only components (decision 5) move into `design-system/components/`?
- Zach: Figma has no frames yet for Messages, Accuracy, first-run setup, the tray menu, link
  outlines or the scam-text banner (`figma/built.md` › Not built yet). Those screens are built
  from the existing components for now.
