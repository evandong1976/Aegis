# Aegis

Aegis scans links and downloads. Every URL you click and every file you download gets a verdict —
Malicious, Suspicious, Unknown or Clean — and anything dangerous is held, quarantined or blocked
before it reaches your Mac. Links are judged without ever being opened. Risky files are reverse
engineered by two independent workers at once, each in its own throwaway, network-off cloud
sandbox (Factory Droid working on a Daytona sandbox through fixed tools, and Chalk in a Chalk
sandbox), and their answers are compared and explained in plain English with the suspicious code
and both sandbox logs as evidence. On the phone, send Aegis a screenshot by iMessage and it replies
with a verdict. Built for HackHarvard 2026.

It's a macOS menu bar app (Electron) plus a Chrome extension. The app has a mini panel (fn or ⌃⌥A)
and a main window: **Overview**, **Links**, **Downloads**, **Messages**, **Accuracy**, **Settings**,
and a **Report** for every verdict.

> **Status:** milestones 0–1 built, plus the click-guard UI from milestone 2 and the fn key. The
> screens are in place and backed by the local store. Daytona and Factory Droid have been checked
> live with real keys (`pnpm try:daytona`, `pnpm try:droid`); link checks, download scanning and
> the sponsor integrations in the app are next. Live status and handoff:
> [`docs/PROGRESS.md`](docs/PROGRESS.md). Plan, decisions and their tradeoffs:
> [`docs/PLAN.md`](docs/PLAN.md). How the parts fit: [`docs/architectural.md`](docs/architectural.md).

## Run it

Requirements: macOS, Node 22+, pnpm 10, Chrome 116+.

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

Fill in the keys you have. Every variable is explained in `.env.example`, and a missing key shows
as "Not set up" in Settings rather than breaking anything. The app and scripts read `.env.local`
then `.env` (`.env.local` wins); both are git-ignored.

Worker A also needs the `droid` CLI (`brew install --cask droid`).

```bash
pnpm dev
```

Aegis starts in the menu bar (shield icon, no Dock icon). **⌃⌥A** toggles the mini panel in the
top-right corner; the tray menu's **Open Aegis** opens the main window. Closing windows never quits
Aegis; use **Quit Aegis** in the tray menu.

To see every screen populated with the Figma demo-path data (a separate throwaway database, marked
"Demo data" in the UI):

```bash
pnpm dev:demo
```

Load the extension:

```bash
pnpm build:extension
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick
`extension/dist`. Its ID is always `onljkbhkoinihmjibfofcalimkolemam`, and the app's bridge only
accepts that ID. Within 30 seconds Settings › Connections shows **Bridge: Connected**.

**macOS permissions:** grants are tied to the app's identity. Under `pnpm dev` they apply to
Electron itself; for prompts under the Aegis name, package the app with `pnpm app`.

### Scripts

| Command                                    | What it does                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:demo`               | Run the app (real history / demo database)                            |
| `pnpm typecheck && pnpm lint && pnpm test` | Run before every commit; lint also fails on a stale `tokens.css`      |
| `pnpm build:extension`                     | Build the Chrome extension into `extension/dist`                      |
| `pnpm capture [dir] [routes]`              | Screenshot the panel and each screen on demo data, in its own profile |
| `pnpm tokens`                              | Regenerate `design-system/tokens.css` from `tokens.json`              |
| `pnpm app`                                 | Package `Aegis.app` (unsigned)                                        |
| `pnpm build:native`                        | Build the fn-key add-on (`native/fn-key`) against Electron's headers  |
| `pnpm verify`                              | Every check + app launch + bridge smoke test, evidence to `logs/`     |
| `pnpm try:daytona`, `pnpm try:droid`       | Live sponsor checks with your keys; each deletes its sandbox          |
| `pnpm build:sandbox`, `pnpm eval`          | Not built yet (milestones 3, 6); they exit with a message             |

## Layout

| Folder           | What                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/`    | The contract every part imports: types, verdict words, bridge routes, IPC, constants, icons                                                        |
| `src/main/`      | Electron main: bridge, store, health, settings, verdict rules, tray, panel, windows, demo                                                          |
| `src/preload/`   | The renderer's only API (`window.aegis`): typed, fixed channels                                                                                    |
| `src/renderer/`  | React: mini panel (`#/panel`) and main window (`#/main`), built from the design system                                                             |
| `extension/`     | Chrome MV3: service worker, offscreen document, popup, click guard                                                                                 |
| `design-system/` | Tokens, fonts, the component bundle and the guidelines. Start at its README.                                                                       |
| `figma/`         | The Figma file's record: variables, component and screen specs, reference renders                                                                  |
| `screens/`       | The four dashboard screens as static HTML, the reference the app's screens were built from                                                         |
| `native/fn-key/` | The fn-key add-on (a listen-only CGEventTap, adapted from Klair)                                                                                   |
| `scripts/`       | `verify.sh`, `capture.sh`, and the live sponsor checks `try-daytona.mts`, `try-droid.mts`                                                          |
| `docs/`          | `PLAN.md` (milestones, decisions, tradeoffs, sponsor findings), `PROGRESS.md` (status and handoff), `architectural.md` (parts, pipeline, diagrams) |
| `logs/`          | Evidence behind every "works" claim (`pnpm verify` runs and live sponsor checks)                                                                   |

## How the design system is used

- `design-system/tokens.css` is the only source of colour, type, spacing and radius. The renderer
  imports it and maps it into Tailwind v4 (`src/renderer/src/assets/main.css`); no hex values are
  restated. The extension copies it into `extension/dist/ds/`.
- The components in `design-system/components/` are ported to typed React in
  `src/renderer/src/components/ds/` with the same `ae-*` markup, so `bundle.css` styles them
  unchanged.
- Components that exist in the Figma file but not in the bundle (StatusDot, ScanStep,
  TimelineStep, CodeLine, finding chips) are in `src/renderer/src/components/aegis.tsx`, tokens
  only.
- Verdicts map to badge levels in one place, `src/shared/verdicts.ts`: Malicious is `critical`,
  Suspicious is `high`, Unknown is `medium`, Clean is `secure`.

Rules that are not negotiable (from the design system):

- Text pairs clear 4.5:1 and control borders 3:1 in **both** themes.
- A verdict is never carried by colour alone: every badge keeps its icon and its word.
- Anything a machine produced — URLs, file names, hashes, sizes, timestamps — is set in mono.
- Focus is a 2px `focus-ring` outline on every interactive element, and it is never removed.
- Aegis never calls anything "safe": a clean result is **Clean**, or **No threats found** in a
  sentence.

## Privacy

What leaves this Mac today: **only the health check's Safe Browsing lookup of Google's public test
URL**, and only when `SAFE_BROWSING_KEY` is set.

When the full pipeline lands, this copy (also in Settings) must stay true:

> Documents that look clean are checked on this Mac and never uploaded. Risky files are analysed in
> two isolated cloud sandboxes with no network, one at Daytona and one at Chalk, each deleted after
> the scan. Links are never opened: link domains (with tokens removed) are checked with Chalk,
> Google Safe Browsing and public domain records. Page text is checked for scams by an AI model
> through Chalk and isn't stored. Screenshots you send by iMessage are read by an AI model through
> Chalk and kept only on this Mac. Your Chrome cookies never leave Chrome.

The Settings screen's copy (`PRIVACY_COPY` in `src/renderer/src/views/main/SettingsView.tsx`) still
says links are opened in a Daytona sandbox; it changes with the code (PROGRESS.md › Open issues).

## How the two analysis workers fit together

Every risky file goes to two workers at once, each on its own copy (details and diagrams:
[`docs/architectural.md`](docs/architectural.md) §3.6):

- **Worker A — Daytona + Factory Droid:** a fresh Daytona sandbox created with the network off
  holds the file. Droid runs on the Mac and works on it only through fixed, read-only tools that
  run inside that sandbox. If a test errors or shows harmful behaviour, the file is reported as
  dangerous.
- **Worker B — Chalk:** the same job done independently by Chalk's AI in its own Chalk Compute
  sandbox.

Each returns a verdict, evidence, a "what would have happened" timeline and a log of what happened
in its sandbox. `compare.ts` reconciles them (the more severe answer wins when they disagree) and
the result can only raise Aegis's rule-based verdict, never lower it. The report shows both logs.
Not built yet (milestones 3, 4 and 6); Worker A's approach is proven by `pnpm try:droid`.

## How Aegis uses Daytona

Not built into the app yet (milestones 3 and 4); checked live by `pnpm try:daytona`. Daytona hosts
Worker A: one fresh sandbox per risky file, created with `networkBlockAll` (this account's tier
only allows turning the network off at creation, and then blocks everything), destroyed after every
job in a `finally`; up to 3 at once. Links are not opened in sandboxes: link detonation was dropped
because this tier keeps sandboxes off the open web (docs/PLAN.md decision 20). Each report shows
the sandbox and its log. Calls and evidence: `docs/PLAN.md` › Sponsor findings › Daytona.

## How Aegis uses Droid

Not built into the app yet (milestone 4); proven by `pnpm try:droid`. Droid is Worker A's analyst.
It runs on the Mac (the Factory Droid SDK driving the `droid` CLI) with every built-in tool switched
off, and its only tools are fixed, argument-free commands that run inside the network-off Daytona
sandbox. A permission handler cancels anything else, every tool output is fenced as untrusted, and
each tool call becomes Worker A's sandbox log. It returns a zod-validated result (verdict, timeline
with code evidence, summary), compared with Chalk's, which can only raise the verdict. The file never
shares a machine with Droid or its key. Coordinated from `src/main/workerA.ts`. Why not inside the
sandbox, and the SDK/CLI workaround: `docs/PLAN.md` decision 19 and Sponsor findings › Factory Droid.

## How Aegis uses Photon

Not built yet (milestone 5, built near the end). Send Aegis a screenshot of a suspicious text,
email or page by iMessage, and it replies with a verdict, each link's real domain and one sentence
on why. The links in the screenshot are judged the same way as in Chrome, without being opened.
Uses Photon's `spectrum-ts` SDK (v2 beta). See [`docs/architectural.md`](docs/architectural.md) §8.

## How Aegis uses Chalk

Not built yet (milestone 6). Chalk is Worker B, a standalone second analyst that reverse engineers
each risky file in its own Chalk Compute sandbox and returns a result and sandbox log to compare
with Droid's. It also supplies threat-intel features for link scoring, runs the LLM calls (the
scam-text check, reading Photon screenshots) as Chalk prompts, and runs the evals behind the
Accuracy tab, measuring each worker alone and the pair together. Details: `docs/PLAN.md` › Sponsor
findings › Chalk.
