## Handoff (updated 2026-10-16 22:45 EDT, by Claude Code session, Opus 5.5)

- **Milestone:** 0 (scaffold, v2) — 100%; 1 (shell + bridge) — ~90%; 2 — click-guard UI only
- **Owner:** Evan + Zach. Evan = Person A (browser and data), Zach = Person B (app and sandbox)
- **Just finished:**
  - Rebuilt on Zach's `fig` commit (branch `aegis-v2` from `origin/main`): four verdicts (Malicious / Suspicious / Unknown / Clean), the Figma screen shell (Overview, Links, Downloads, Messages, Accuracy, Settings) and Figma Report, mini panel and click-guard frames, all from `design-system/` tokens and components
  - Store schema and queries behind the screens; `AEGIS_DEMO=1` demo database from the Figma demo path; `pnpm capture` for headless screenshots
  - Plumbing carried over from `milestone-0-skeleton` (bridge, health, tray, panel window, extension with fixed ID)
- **In progress:** nothing
- **Next step:** Load `extension/dist` unpacked in Chrome and confirm Settings › Connections shows Bridge = Connected within 30 s (closes milestone 1). Then split: Evan starts milestone 2 (content script → `/page` → wire `showClickGuard` from `extension/src/guard.ts`) and the `demo/` phishing page; Zach starts `sandbox/Dockerfile` + the `demo/` test `.pkg` and the Daytona docs check (PLAN.md › Sponsor findings).
- **Broken / failing:** none. `pnpm typecheck && pnpm lint && pnpm test` pass (23 tests; lint includes the tokens.css staleness check).
- **Decisions made this session:** all in `docs/PLAN.md` › Decisions 1–15 (four verdicts and Unknown semantics, nav = Figma shell + Messages/Accuracy, single-user adaptation, coverage ring, Figma components kept in the app, panel follows Figma, Shadow-DOM guard, demo database).
- **Blocked on / questions for the user:** deferred by the team: four-track eligibility, demo/email domain. For Zach: move the Figma-only components into `design-system/`? Figma frames for Messages/Accuracy/first run? Nothing blocks the next step.
- **How to verify current state:**
  - `pnpm install && pnpm typecheck && pnpm lint && pnpm test` → all green
  - `pnpm dev` → menu bar shield, no Dock icon; ⌃⌥A toggles the panel; real (empty) history
  - `pnpm dev:demo` → same app on the demo database: populated Overview / Links / Downloads, open `invoice_oct.iso` for the Figma Report
  - `pnpm capture /tmp/aegis-capture` → PNGs of the panel and every screen, compare with `figma/reference/*.png` and the Figma frames
  - `pnpm build:extension`, then serve `extension/dist` and open `guard-preview.html` → the click guard
  - `curl -H "Origin: chrome-extension://onljkbhkoinihmjibfofcalimkolemam" http://127.0.0.1:47321/status` → `{"app":"aegis",...}`; any other Origin → 403

---

## Milestone checklist

| #   | Milestone                                                              | Owner       | Status                                                         |
| --- | ---------------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| 0   | Scaffold, shared types, bridge contract, PLAN/PROGRESS, `.env.example` | Evan + Zach | Done (v2)                                                      |
| 0a  | `demo/` phishing page, scam texts, invoice email                       | Evan        | Not started                                                    |
| 0b  | `demo/` test `.pkg` + scripts, EICAR; `sandbox/Dockerfile`             | Zach        | Not started                                                    |
| 1   | Shell + bridge (Zach); extension skeleton (Evan)                       | Zach / Evan | In progress: built; extension not loaded in a real Chrome yet  |
| 2   | Links                                                                  | Evan        | Click-guard UI done; content script, scoring, wiring not built |
| 3   | Downloads (core demo)                                                  | Evan + Zach | Not started                                                    |
| 4   | Droid                                                                  | Zach        | Not started                                                    |
| 5   | Photon                                                                 | Evan        | Not started                                                    |
| 6   | Chalk                                                                  | Evan        | Not started                                                    |
| 7   | Detonation                                                             | Zach        | Not started                                                    |
| 8   | Watcher + resilience + fn add-on                                       | Zach        | Not started                                                    |
| 9   | Stretch                                                                | —           | Not started                                                    |
| 10  | Prove it and submit                                                    | Evan + Zach | Not started                                                    |

### What exists, screen by screen

- **Mini panel** (Figma frame): status chip, Daytona / Droid / Photon / Chalk dots, This page (from `status.page`, set by the extension in milestone 2), Scanning now with steps, Recent verdicts, Pause / Open Aegis. Esc, ⌘O, ⌘P.
- **Overview**: banner (newest malicious today, else missing required service), coverage ring, four tiles, latest verdicts, where Aegis can see, live scan log.
- **Links / Downloads**: four tiles, tabbed queue with filter and CSV export, row → Report. Downloads adds "What caught them" and "By file type".
- **Report** (Figma frame): verdict header with risk score, finding chips and actions (disabled until milestone 8), timeline, indicators, code evidence with flagged lines, capabilities, checks that ran, sandbox / privacy footer.
- **Messages, Accuracy**: empty states until milestones 5 and 6; Accuracy reads `evals/results.json`.
- **Settings**: protection toggles (persisted), connections, API key status, trusted sites, sandbox budget, permissions, privacy copy.
- **Extension**: fixed ID, offscreen heartbeat to `/ping`, popup with bridge status, click guard (`guard.ts`) + `guard-preview.html`.
- **Top bar search** (⌘K): URL, file name or SHA-256 across everything checked.

## Health-check status (last local run, no `.env`)

| Check             | State       | Note                                    |
| ----------------- | ----------- | --------------------------------------- |
| Bridge            | Degraded    | Listening; extension not connected yet  |
| Local store       | OK          |                                         |
| Daytona           | Not set up  | No key                                  |
| Sandbox image     | Not checked | Milestone 3                             |
| Docker (fallback) | Down        | Installed but not running on Evan's Mac |
| Droid             | Not set up  | No key                                  |
| Photon            | Not set up  | No key                                  |
| Chalk             | Not set up  | No key                                  |
| Safe Browsing     | Not set up  | No key; the live check is implemented   |
| Downloads folder  | OK          | Granted to Electron under `pnpm dev`    |
| fn key            | Not set up  | Add-on not built (milestone 8)          |

## Stubs and simulations

- Demo data only under `AEGIS_DEMO=1`, in its own database, with a "Demo data" chip in the UI.
- Bridge `/page`, `/download`, `/download/quarantined`, `/inspect`, `/scan/:id` → 501 `notImplemented`.
- Report actions disabled until quarantine handling (milestone 8).
- `pnpm build:sandbox`, `build:native`, `eval` exit 1 with "not implemented yet".
- Sandbox budget meter shows 0 until the queue records jobs (milestone 3).
- Settings › API keys shows status only; paste-in storage (safeStorage) not built.

## Sponsor findings

None yet; see `docs/PLAN.md` › Sponsor findings.

## Sandbox leak check (Daytona dashboard after each milestone)

| After milestone | Sandboxes left running |
| --------------- | ---------------------- |
| —               | Daytona not used yet   |

## Decisions log

- 2026-10-16: First skeleton on `milestone-0-skeleton` (Electron shell, bridge, extension).
- 2026-10-16: Owners: Evan = A, Zach = B. Klair's fn add-on may be used, repurposed for Aegis. Deferred: four-track eligibility, demo/email domain.
- 2026-10-16: Zach's `fig` commit added `figma/`, `screens/` and the four-verdict design system. Rebuilt on `aegis-v2` from it (PLAN.md decisions 1–15). The half-finished rebase of `milestone-0-skeleton` onto `fig` was aborted; nothing in it was lost (only a README with conflict markers).
