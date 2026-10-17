## Handoff (updated 2026-10-17 11:05 EDT, by Claude Code session, Opus 5.5)

- **Milestone:** 0 (scaffold) done; 1 (shell + bridge) built, waiting on a real-Chrome check; 2 —
  click-guard UI only; 8 — fn add-on only
- **Owner:** Evan + Zach. Evan = Person A (browser and data), Zach = Person B (app and sandbox)
- **Just finished:**
  - **Worker A decided: option B** (PLAN.md decision 19). `try-droid` step 2 now uses a real
    sandbox: network off, one harmless text file, three read-only argument-free tools; Droid must
    report the file's SHA-256, which only the tools can give it. Typechecks; **not run yet** (needs
    the droid CLI). Option A (step 3) is opt-in with `AEGIS_TRY_DROID_INSIDE=1`.
  - `extension-heartbeat` merged into `main` (local, not pushed).
  - **Daytona checked live (10:40)** with Evan's key: `pnpm try:daytona` passes (create 0.8–3.8 s,
    upload, run, network off, delete). The org is on Tier 1 or 2: `networkBlockAll` at creation
    works (even npm, an "essential service", is blocked), but allow-lists and changes after
    creation are refused, and Factory's hosts are unreachable. So **analysis offline works now;
    Droid inside the sandbox (option A) and link detonation need Tier 3** or the alternatives in
    `docs/PLAN.md` › Sponsor findings › Daytona › Live results. Evidence:
    `logs/2026-10-17-daytona-tier/`. Leak check: 0 sandboxes left.
  - The try scripts and the app now read `.env.local` as well as `.env` (`.env.local` wins);
    `try-daytona` also probes an essential service, so "network off" is a real test on Tier 1/2.
  - **Review against the plan (01:20)**: `try-droid` now also runs Droid inside a Daytona sandbox
    (option A), as PLAN.md › Branches asks. `try-daytona` now uses the 20 s sandbox-start limit
    with one retry (architectural.md §4.6). New optional env var: `AEGIS_FACTORY_DOMAINS`.
  - **`sponsor-check` (this branch, not merged into `main`)**: the Daytona and Droid docs check.
    Findings with the exact calls are in `docs/PLAN.md` › Sponsor findings. The SDKs are pinned
    (`@daytona/sdk` 0.220.0, `@factory/droid-sdk` 0.9.1). `pnpm try:daytona` and `pnpm try:droid`
    typecheck, but **have not run**: no keys are set, and the droid CLI isn't installed. Without
    keys each exits 1 with a clear message.
  - **Branches for Zach's items**: six local branches cut from `main`, not pushed. Each
    branch's work is in its own commits, and this file is that branch's handoff. Order,
    prerequisites and contents: `docs/PLAN.md` › Branches. `worker-a` and `detonate` are still
    empty, waiting on milestone 3 (joint).
  - **Verified what works** with `pnpm verify` and recorded the evidence in
    [`logs/2026-10-16-2339/`](../logs/2026-10-16-2339/SUMMARY.md): all 16 checks as expected at
    commit `35cba97` (see "What works today" below)
  - Earlier (2026-10-16): Photon deferred to a later mobile feature (PLAN.md decision 18);
    pipeline drafted in `docs/architectural.md` §4, awaiting the team's review; two analysis
    workers designed (decision 17, docs only)
- **In progress:** nothing
- **Next step:** Install the droid CLI (`brew install --cask droid`; Factory's signed binary,
  0.238.0, about 252 MB), run `pnpm try:droid`, save its output under `logs/`, record the result
  in PLAN.md › Sponsor findings › Factory Droid, run the leak check, then merge `sponsor-check`
  into `main`. Link detonation still needs a home (Tier 3 or Chalk).
- **Broken / failing:** typecheck and lint pass. `store.test.ts` › "computes the overview counts"
  fails between midnight and about 1:35 AM (demo timestamps); the fix is on `ui-fixes`. Three
  small UI issues open (see "Open issues"; branch `ui-fixes`).
- **Decisions made this session:** all in `docs/PLAN.md` › Decisions 1–18, plus the branch plan
  (PLAN.md › Branches).
- **Blocked on / questions for the user:** permission to install the droid CLI. Where link
  detonation runs (Tier 3 or Chalk).
- **How to verify current state:** `pnpm verify` — writes a new `logs/<date-time>/` folder with
  every check's output, a bridge smoke test, the app's health report and screenshots. Then compare
  with the latest `SUMMARY.md` in `logs/`.

---

## What works today (verified)

Everything in this table was checked by `pnpm verify` on 2026-10-16 at 23:39 EDT, commit
`35cba97`. Evidence: [`logs/2026-10-16-2339/`](../logs/2026-10-16-2339/SUMMARY.md).

| Area                     | What was shown                                                                                                                                                                                                    | Evidence                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Code quality             | Typecheck (main, renderer, extension) and lint pass; `tokens.css` is current                                                                                                                                      | `typecheck.log`, `lint.log`                            |
| Verdict rules            | 8 unit tests: score bands, hard rules, Unknown, AI can only raise, the four words, never "safe"                                                                                                                   | `tests.log`                                            |
| Local store              | 8 unit tests: schema, idempotent migrations, old-schema rebuild, four-verdict constraint, reports, filters, counts                                                                                                | `tests.log`                                            |
| Bridge security          | 7 unit tests, plus 14 / 14 live HTTP checks: only our extension's Origin is served; web pages, other extensions, no Origin and rebinding Hosts get 403; bad bodies 400; later routes 501; bound to 127.0.0.1 only | `tests.log`, `bridge-smoke.log`                        |
| Bridge → store → UI      | A domain trusted over `POST /trust` appears in Settings › Trusted sites                                                                                                                                           | `bridge-smoke.log`, `screens/real/settings.png`        |
| Extension heartbeat path | `POST /ping` marks the extension connected and turns the Bridge health check from degraded to ok (simulated with `curl`)                                                                                          | `screens/real/log.json`, `status.json`                 |
| Health checks            | The running app checks all 11 connections and reports them correctly with no keys set (protection: degraded)                                                                                                      | `screens/real/status.json`                             |
| Builds                   | Production build, extension build, fn add-on build all succeed                                                                                                                                                    | `build.log`, `extension-build.log`, `native-build.log` |
| Extension identity       | The ID derived from the manifest key matches the one the bridge accepts (`onljkbhkoinihmjibfofcalimkolemam`)                                                                                                      | `extension-id.log`                                     |
| fn add-on                | Loads in Electron (`start`, `stop`); at app start its key listener is running (Input Monitoring granted to Electron)                                                                                              | `native-load.log`, `screens/real/log.json`             |
| App launch, real mode    | Launches in a fresh profile; panel and all 7 main screens render; no renderer or main-process errors                                                                                                              | `screens/real/*.png`, `renderer-errors.log`            |
| App launch, demo mode    | Launches on the demo database; panel and all 7 screens render populated, including the Figma Report; no errors                                                                                                    | `screens/demo/*.png`, `renderer-errors-demo.log`       |
| Placeholder scripts      | `pnpm build:sandbox` and `pnpm eval` exit 1 with "not implemented yet (milestone N)"                                                                                                                              | `placeholder-*.log`                                    |

## Not verified yet

| What                                                                | Why not                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The extension in a real Chrome (load, heartbeat, popup)             | Needs loading by hand; the run simulated the heartbeat with `curl`         |
| A physical fn tap, ⌃⌥A, Esc / ⌘O / ⌘P, tray menu clicks             | The script can't send keyboard or menu-bar input                           |
| Pause / resume, settings toggles, Export CSV, search                | No UI clicks in the run                                                    |
| The click-guard overlay                                             | Checked by eye in the browser pane during development, not in a logged run |
| The Daylight (light) theme                                          | The Mac was in dark mode                                                   |
| Packaging `Aegis.app` (`pnpm app`)                                  | Not run                                                                    |
| Sponsor integrations (Daytona, Droid, Chalk, Safe Browsing lookups) | Not built yet; no keys set                                                 |

## Open issues

Found by the verification run (`logs/2026-10-16-2339/SUMMARY.md` › Problems). All three are
for branch `ui-fixes` (PLAN.md › Branches):

1. Settings › "Text me when Aegis blocks something" still says "Needs Photon (milestone 5)"; Photon
   is now deferred to the later mobile feature.
2. The empty Report's **Back** button uses a forward-pointing arrow.
3. With no history, Links › Awaiting review says "Every link you clicked came back with a verdict…",
   implying links were checked.

---

## Milestone checklist

| #   | Milestone                                                              | Owner       | Status                                                                                         |
| --- | ---------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| 0   | Scaffold, shared types, bridge contract, PLAN/PROGRESS, `.env.example` | Evan + Zach | Done                                                                                           |
| 0a  | `demo/` phishing page, scam texts, invoice email                       | Evan        | Not started                                                                                    |
| 0b  | `demo/` test `.pkg` + scripts, EICAR; `sandbox/Dockerfile`             | Zach        | Not started (branch `sandbox-image`)                                                           |
| 1   | Shell + bridge (Zach); extension skeleton (Evan)                       | Zach / Evan | Built and verified (above); real-Chrome check outstanding                                      |
| 2   | Links                                                                  | Evan        | Click-guard UI built; content script, scoring, wiring not built                                |
| 3   | Downloads (core demo)                                                  | Evan + Zach | Not started                                                                                    |
| 4   | Worker A (Daytona + Droid) + compare                                   | Zach        | Not started (branch `worker-a`; designed: PLAN.md decision 17)                                 |
| 5   | Later: mobile via Photon (screenshots → verdict)                       | Evan        | Deferred, not in the current build                                                             |
| 6   | Chalk: Worker B + link data + evals                                    | Evan        | Not started                                                                                    |
| 7   | Detonation                                                             | Zach        | Not started (branch `detonate`)                                                                |
| 8   | Watcher + resilience + fn add-on                                       | Zach        | fn add-on built and loading; watcher, quarantine, Docker fallback not built (branch `watcher`) |
| 9   | Stretch                                                                | —           | Not started                                                                                    |
| 10  | Prove it and submit                                                    | Evan + Zach | Not started                                                                                    |

### What exists, screen by screen

All of these render in the verification screenshots (`logs/2026-10-16-2339/screens/`). Behaviour
behind clicks is not yet covered by a logged run (see "Not verified yet").

- **Mini panel** (Figma frame): status chip, Daytona / Droid / Photon / Chalk dots, This page (from
  `status.page`, set by the extension in milestone 2), Scanning now with steps, Recent verdicts,
  Pause / Open Aegis.
- **Overview**: banner (newest malicious today, else missing required services), coverage ring,
  four tiles, latest verdicts, where Aegis can see, live scan log.
- **Links / Downloads**: four tiles, tabbed queue with filter and CSV export, row → Report.
  Downloads adds "What caught them" and "By file type".
- **Report** (Figma frame): verdict header with risk score, finding chips and actions (disabled
  until milestone 8), timeline, indicators, code evidence with flagged lines, capabilities, checks
  that ran, sandbox / privacy footer.
- **Messages, Accuracy**: empty states; Messages is a placeholder for the later mobile feature;
  Accuracy reads `evals/results.json` (milestone 6).
- **Settings**: protection toggles (persisted), connections, API key status, trusted sites, sandbox
  budget, permissions, privacy copy.
- **Extension**: fixed ID, offscreen heartbeat to `/ping`, popup with bridge status, click guard
  (`guard.ts`) + `guard-preview.html`.
- **Top bar search** (⌘K): URL, file name or SHA-256 across everything checked.

## Health-check status (verified run, no `.env`)

From `logs/2026-10-16-2339/screens/real/status.json`:

| Check             | State        | Note                                                    |
| ----------------- | ------------ | ------------------------------------------------------- |
| Bridge            | ok           | After the simulated heartbeat; degraded before it       |
| Local store       | ok           |                                                         |
| Daytona           | unconfigured | No key                                                  |
| Sandbox image     | pending      | Milestone 3                                             |
| Docker (fallback) | down         | Docker is installed but not running on Evan's Mac       |
| Droid             | unconfigured | No key                                                  |
| Photon            | unconfigured | Deferred feature; optional                              |
| Chalk             | unconfigured | No key                                                  |
| Safe Browsing     | unconfigured | No key; the live check is implemented but not exercised |
| Downloads folder  | ok           | Granted to Electron under `pnpm dev`                    |
| fn key            | ok           | Add-on built; Input Monitoring granted to Electron      |

## Stubs and simulations

- Demo data only under `AEGIS_DEMO=1`, in its own database, with a "Demo data" chip in the UI.
- Bridge `/page`, `/download`, `/download/quarantined`, `/inspect`, `/scan/:id` → 501 `notImplemented`.
- Report actions disabled until quarantine handling (milestone 8).
- `pnpm build:sandbox` and `pnpm eval` exit 1 with "not implemented yet".
- Sandbox budget meter shows 0 until the queue records jobs (milestone 3).
- Settings › API keys shows status only; paste-in storage (safeStorage) not built.

## Sponsor findings

Daytona and Factory Droid: from each SDK's types, 2026-10-17, branch `sponsor-check`. The try
scripts haven't run yet (no keys). See `docs/PLAN.md` › Sponsor findings.

## Sandbox leak check (Daytona dashboard after each milestone)

| After                                       | Sandboxes left running                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `sponsor-check` live runs, 2026-10-17 10:39 | 0 (checked with `daytona.list()`: 0 sandboxes in the org) |

## Decisions log

- 2026-10-17: Worker A is option B — Droid on the Mac, narrow read-only tools into a network-off
  sandbox (PLAN.md decision 19).

- 2026-10-17: Daytona checked live on `sponsor-check`. This account's tier (1 or 2) allows
  `networkBlockAll` at creation but refuses allow-lists and later changes; Factory and ordinary
  websites are unreachable. Option A (Droid inside) and link detonation need Tier 3 or an
  alternative; the team decides (PLAN.md › Sponsor findings › Daytona › Live results).

- 2026-10-17 00:50: `sponsor-check`: Daytona and Droid findings recorded in PLAN.md. The SDKs are
  pinned. `scripts/try-daytona.mts` and `scripts/try-droid.mts` are written and typechecked, but
  haven't run yet (no keys). New optional env vars: `AEGIS_DAYTONA_SNAPSHOT`, `DROID_PATH`,
  `DAYTONA_API_URL` / `DAYTONA_TARGET`. Open choice for Worker A: Droid inside the sandbox (A) or
  connected to it through MCP tools (B).
- 2026-10-17 00:00: Six local branches cut from `main` for Zach's items, in landing order:
  `sponsor-check`, `sandbox-image`, `ui-fixes`, `worker-a`, `detonate`, `watcher`. Context and
  prerequisites are in PLAN.md › Branches. Not pushed. Joint items (0, 3, 10) have no branch and
  aren't started.
- 2026-10-16 23:39: First logged verification (`logs/2026-10-16-2339/`); fixed a launch crash on
  relative profile paths and duplicate health logging; three UI issues open.
- 2026-10-16: Photon deferred to a later mobile feature (forward a phone screenshot, get a
  verdict). Removed from the current pipeline; app placeholders stay as "Not set up" (PLAN.md
  decision 18).
- 2026-10-16: Pipeline drafted from the architecture (`docs/architectural.md` §4) for team review.
- 2026-10-16: Two analysis workers (Daytona + Droid inside the sandbox; Chalk standalone) test the
  file in their own sandboxes and return results + sandbox logs, compared in `compare.ts`. Differs
  from MEGA_PROMPT §5.3–5.4; see PLAN.md decision 17. In-app privacy copy must change when M4/M6
  land.
- 2026-10-16: fn add-on built early (PLAN.md decision 14); main window became a fixed frame with a
  pinned rail (decision 16).
- 2026-10-16: Figma-only components stay in the app (not `design-system/`). Figma frames for the
  remaining screens will be designed later.
- 2026-10-16: Zach's `fig` commit added `figma/`, `screens/` and the four-verdict design system.
  Rebuilt on `aegis-v2` from it (PLAN.md decisions 1–15). The half-finished rebase of
  `milestone-0-skeleton` onto `fig` was aborted; nothing in it was lost (only a README with
  conflict markers).
- 2026-10-16: Owners: Evan = A, Zach = B. Klair's fn add-on may be used, repurposed for Aegis.
  Deferred: four-track eligibility, demo domain.
- 2026-10-16: First skeleton on `milestone-0-skeleton` (Electron shell, bridge, extension).
- Correction: earlier versions of this file dated some entries 2026-10-17 and stamped the Handoff
  "2026-10-17 01:00"; those were estimates, not the clock. The system clock shows all of this work
  happened on 2026-10-16.
