## Handoff (updated 2026-10-17 00:45 EDT, by Claude Code session, Opus 5.5)

- **Milestone:** 0 (scaffold, v2) — 100%; 1 (shell + bridge) — ~90%; 2 — click-guard UI only; 8 — fn add-on only
- **Owner:** Evan + Zach. Evan = Person A (browser and data), Zach = Person B (app and sandbox)
- **Just finished:**
  - Pipeline drafted in `docs/architectural.md` §4 (nine stages, link / file / message flows, scan state machine, service-down table, time limits), **awaiting the team's review**. It plans one shared-type change for M3: `ScanStatus` becomes `received → prechecked → queued → analyzing → compared → verdict → done | failed`
  - Architecture changed to **two analysis workers, compared**: Worker A = Daytona sandbox with Factory Droid inside, Worker B = Chalk standalone; both examine and test the file in their own sandbox and return a result + sandbox log; `compare.ts` reconciles (PLAN.md decision 17, `docs/architectural.md` §2.1, §3.6, §7.1). Docs only so far; no code changed
  - fn key: `native/fn-key` (from Klair, chords removed) + `src/main/fnkey.ts`; a clean fn tap toggles the panel, ⌃⌥A still works. Built with `pnpm build:native`; health check reports it (OK on Evan's Mac — Electron already had Input Monitoring)
  - Main window is now a fixed frame: the nav rail and title bar stay put, only the content column scrolls
  - Before that: v2 rebuild on Zach's `fig` commit (four verdicts, Figma shell and frames, demo database, click guard) — see the decisions log
- **In progress:** nothing
- **Next step:** Load `extension/dist` unpacked in Chrome and confirm Settings › Connections shows Bridge = Connected within 30 s (closes milestone 1). Then split: Evan starts milestone 2 (content script → `/page` → wire `showClickGuard` from `extension/src/guard.ts`) and the `demo/` phishing page; Zach starts `sandbox/Dockerfile` + the `demo/` test `.pkg` and the Daytona docs check (PLAN.md › Sponsor findings).
- **Broken / failing:** none. `pnpm typecheck && pnpm lint && pnpm test` pass (23 tests; lint includes the tokens.css staleness check).
- **Decisions made this session:** all in `docs/PLAN.md` › Decisions 1–15 (four verdicts and Unknown semantics, nav = Figma shell + Messages/Accuracy, single-user adaptation, coverage ring, Figma components kept in the app, panel follows Figma, Shadow-DOM guard, demo database). Team answers: Figma-only components stay in the app, not `design-system/`; Figma frames for Messages, Accuracy, first run, tray, link outlines and the scam-text banner come later — restyle those screens when they land. Also decision 17: dual workers (Daytona + Droid, Chalk standalone), more severe answer wins, a test that errors means Malicious, both sandbox logs in the report.
- **Blocked on / questions for the user:** deferred by the team: four-track eligibility, demo/email domain. Nothing blocks the next step. Before M4/M6: verify Droid can run inside a Daytona sandbox and Chalk can host its own sandbox (PLAN.md › Sponsor findings).
- **How to verify current state:**
  - `pnpm install && pnpm typecheck && pnpm lint && pnpm test` → all green
  - `pnpm build:native` once, then `pnpm dev` → menu bar shield, no Dock icon; tap fn (or ⌃⌥A) to toggle the panel; real (empty) history. If fn does nothing, Settings › Permissions shows why (add-on not built / Input Monitoring not granted to Electron), and System Settings › Keyboard › "Press fn (Globe) key to" should be Do Nothing
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
| 4   | Worker A (Daytona + Droid) + compare                                   | Zach        | Not started                                                    |
| 5   | Photon                                                                 | Evan        | Not started                                                    |
| 6   | Chalk: Worker B + link data + evals                                    | Evan        | Not started                                                    |
| 7   | Detonation                                                             | Zach        | Not started                                                    |
| 8   | Watcher + resilience + fn add-on                                       | Zach        | fn add-on done; watcher, quarantine, Docker fallback not built |
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

- 2026-10-17: Pipeline drafted from the architecture (architectural.md §4) for team review.

- 2026-10-17: Two analysis workers (Daytona + Droid inside the sandbox; Chalk standalone) test the file in their own sandboxes and return results + sandbox logs; compared in `compare.ts`. Differs from MEGA_PROMPT §5.3–5.4 (static-only analyze.py, Droid outside the sandbox); see PLAN.md decision 17. In-app privacy copy must be updated when M4/M6 land.

- 2026-10-16: First skeleton on `milestone-0-skeleton` (Electron shell, bridge, extension).
- 2026-10-16: Owners: Evan = A, Zach = B. Klair's fn add-on may be used, repurposed for Aegis. Deferred: four-track eligibility, demo/email domain.
- 2026-10-16: fn add-on built early (PLAN.md decision 14); main window became a fixed frame with a pinned rail (decision 16).
- 2026-10-16: Figma-only components stay in the app (not `design-system/`). Figma frames for the remaining screens will be designed later.
- 2026-10-16: Zach's `fig` commit added `figma/`, `screens/` and the four-verdict design system. Rebuilt on `aegis-v2` from it (PLAN.md decisions 1–15). The half-finished rebase of `milestone-0-skeleton` onto `fig` was aborted; nothing in it was lost (only a README with conflict markers).
