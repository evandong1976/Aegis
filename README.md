# Aegis

Aegis scans links and downloads. Every URL you click and every file you download gets a verdict —
Malicious, Suspicious, Unknown or Clean — and anything dangerous is held, quarantined or blocked
before it reaches your Mac. Risky files are reverse engineered by two independent workers at once,
each in its own throwaway cloud sandbox (Daytona with Factory Droid inside, and Chalk), and their
answers are compared and explained in plain English with the suspicious code and both sandbox logs
as evidence. Built for
HackHarvard 2026.

It's a macOS menu bar app (Electron) plus a Chrome extension. The app has a mini panel (fn or ⌃⌥A)
and a main window: **Overview**, **Links**, **Downloads**, **Messages**, **Accuracy**, **Settings**,
and a **Report** for every verdict.

> **Status:** milestones 0–1 built, plus the click-guard UI from milestone 2. The screens are in
> place and backed by the local store; link checks, download scanning and the sponsor integrations
> are next. Live status: [`docs/PROGRESS.md`](docs/PROGRESS.md). Plan and decisions:
> [`docs/PLAN.md`](docs/PLAN.md).

## Run it

Requirements: macOS, Node 22+, pnpm 10, Chrome 116+.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Fill in the keys you have. Every variable is explained in `.env.example`, and a missing key shows
as "Not set up" in Settings rather than breaking anything.

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

| Command                                                | What it does                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:demo`                           | Run the app (real history / demo database)                            |
| `pnpm typecheck && pnpm lint && pnpm test`             | Run before every commit; lint also fails on a stale `tokens.css`      |
| `pnpm build:extension`                                 | Build the Chrome extension into `extension/dist`                      |
| `pnpm capture [dir] [routes]`                          | Screenshot the panel and each screen on demo data, in its own profile |
| `pnpm tokens`                                          | Regenerate `design-system/tokens.css` from `tokens.json`              |
| `pnpm app`                                             | Package `Aegis.app` (unsigned)                                        |
| `pnpm build:sandbox`, `pnpm build:native`, `pnpm eval` | Not built yet (milestones 3, 8, 6); they exit with a message          |

## Layout

| Folder           | What                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `src/shared/`    | The contract every part imports: types, verdict words, bridge routes, IPC, constants, icons |
| `src/main/`      | Electron main: bridge, store, health, settings, verdict rules, tray, panel, windows, demo   |
| `src/preload/`   | The renderer's only API (`window.aegis`): typed, fixed channels                             |
| `src/renderer/`  | React: mini panel (`#/panel`) and main window (`#/main`), built from the design system      |
| `extension/`     | Chrome MV3: service worker, offscreen document, popup, click guard                          |
| `design-system/` | Tokens, fonts, the component bundle and the guidelines. Start at its README.                |
| `figma/`         | The Figma file's record: variables, component and screen specs, reference renders           |
| `screens/`       | The four dashboard screens as static HTML, the reference the app's screens were built from  |
| `docs/`          | `PLAN.md` (milestones, decisions, sponsor findings) and `PROGRESS.md` (status and handoff)  |

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
> two isolated cloud sandboxes, one at Daytona and one at Chalk, each deleted after the scan.
> Suspicious links are opened in a Daytona sandbox. Link domains
> (with tokens removed) are checked with Chalk and Google Safe Browsing. Page text is checked for
> scams by an AI model through Chalk and isn't stored. Your Chrome cookies never leave Chrome.

## How the two analysis workers fit together

Every risky file goes to two workers at once, each on its own copy (details and diagrams:
[`docs/architectural.md`](docs/architectural.md) §3.6):

- **Worker A — Daytona + Factory Droid:** a fresh Daytona sandbox, network off, with Droid living
  inside it as the analyst. Droid examines the file, tests it inside the sandbox and reports back;
  if the test errors or shows harmful behaviour, it reports the file as dangerous.
- **Worker B — Chalk:** the same job done independently by Chalk's AI in its own isolated sandbox.

Each returns a verdict, evidence, a "what would have happened" timeline and a log of what happened
in its sandbox. `compare.ts` reconciles them (the more severe answer wins when they disagree) and
the result can only raise Aegis's rule-based verdict, never lower it. The report shows both logs.
Not built yet (milestones 3, 4 and 6).

## How Aegis uses Daytona

Not built yet (milestones 3, 4, 7). Daytona hosts Worker A: one fresh, network-off sandbox per
risky file, with Factory Droid inside, destroyed after every job; up to 3 at once. It also opens
suspicious links in network-on sandboxes for detonation. Each report shows the sandbox and its log.

## How Aegis uses Droid

Not built yet (milestone 4). Droid is Worker A's analyst, living inside the Daytona sandbox: it
examines and tests the file there, then returns a zod-validated result (verdict, timeline with code
evidence, summary) and its sandbox log. All sample content is fenced as untrusted. Its answer is
compared with Chalk's and can only raise the verdict. Coordinated from `src/main/workerA.ts`.

## Later: Aegis on your phone (Photon)

Not in the current build. Photon will bring Aegis to phones: forward a screenshot of a suspicious
text, email or page to Aegis over iMessage or SMS, and it replies with a verdict, the real
destination of each link and one sentence on why. See
[`docs/architectural.md`](docs/architectural.md) §8.

## How Aegis uses Chalk

Not built yet (milestone 6). Chalk is Worker B, a standalone second analyst that reverse engineers
each risky file in its own sandbox and returns a result and sandbox log to compare with Droid's. It
also supplies threat-intel features and Federated Queries for link scoring, the AI Gateway for
scam-text checks, and the Agent Evals behind the Accuracy tab, measuring each worker alone and the
pair together. Details will be in `docs/CHALK.md`.
