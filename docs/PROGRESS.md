## Handoff (updated 2026-10-17 12:20 EDT, by Claude Code session, Opus 5.5)

**New here?** Read in this order: this Handoff → `docs/PLAN.md` (Milestones, Branches, Decisions
1–27, "Tradeoffs at a glance", Sponsor findings) → `docs/architectural.md` (how the parts fit, the
pipeline) → `MEGA_PROMPT.md` §0 (what changed from the original brief, with tradeoffs). Where they
disagree, PLAN.md › Decisions wins.

- **Milestones:** 0 done; 1 built and verified, waiting on a real-Chrome check; 2 — click-guard UI
  only; 4 — approach proven (`pnpm try:droid`); 8 — fn add-on only. Everything else not started.
  Table: "Milestone checklist" below.
- **Owner:** Evan = Person A (browser and data), Zach = Person B (app and sandbox)
- **Just finished — branch `extension-status` (uncommitted):** the milestone-1 Chrome check
  found that the app said Connected but the extension's badge and popup stayed on "Not
  connected". Chrome leaves `Origin` off an extension's GET requests, so the bridge answered
  `GET /status` with 403 (only `POST /ping` passed). `/status` and `/scan/:id` are now POST
  (decision 28), and the popup re-reads the status every 3 s while open. Checked in a headless
  Chrome 155 with the built extension against the new bridge code: every request 200, popup
  "Protected / Connected", badge cleared; no Origin, other origins and rebinding Hosts still 403,
  GET 404. `pnpm verify`'s smoke checks are updated to POST.
- **Earlier — branch `sponsor-check-sync`, merged into `main` and pushed:** Zach's later
  `sponsor-check` work, brought into `main`'s line with `main`'s docs as the source of truth:
  - **Live sponsor checks in the app** (`src/main/sponsors.ts`, Zach; now PLAN.md decision 27):
    free lookups every 60 s, a tiny live test at start and on Check now. Zach tested it against
    mocks only; it has now **run against the real services** with the keys in `.env.local`:
    Daytona ok (sandbox started in 1.4 s, ran a command, deleted), Droid ok (60 models; test prompt
    answered in 5.5 s), Sandbox image pending (no snapshot yet, Docker not running); a second Check
    now within 30 s reused the result; 0 sandboxes left. Evidence `logs/2026-10-17-sponsor-sync/`.
  - Adapted to the plan: setup messages say `.env.local`; `.env.example`'s Photon and Chalk notes
    match decisions 21 and 24 and the Chalk findings.
  - **Chalk project files moved into `chalk/`** (with a README): at the root, `chalk apply` would
    upload the whole repo and Chalk's 593-line agent guide would load into every coding session.
  - **Correction from Chalk's guide:** Chalk sandboxes allow outbound network **by default**. Our
    docs said "no allow-list, so no network", which would have left Worker B online. Fixed in
    PLAN.md, MEGA_PROMPT §5.3, §5.6 and §6 rule 2, and architectural.md §3.6: Worker B passes a
    `NetworkPolicy` that allows no hosts, and `try-chalk` must prove it.
  - Also from Zach: two Chalk credentials (a service token for the app, `chalk login` for
    developers); Chalk's LLM router is the "Model Gateway"; `chalkcompute` has Evaluations.
- **Just finished — branch `docs-update`, merged into `main`; `main` pushed to `origin`:** the docs
  now match everything decided on 2026-10-16/17, each change with its tradeoff:
  - `docs/PLAN.md`: decisions 20–25, a "Tradeoffs at a glance" table, Chalk and Photon findings
    from their docs, milestones and branches updated, open questions refreshed.
  - `docs/architectural.md`: Worker A is Droid on the Mac working through tools; links judged
    without opening them (no detonation); Photon back in scope as the screenshot feature. All 10
    Mermaid diagrams render.
  - `MEGA_PROMPT.md`: a new §0 table of every change since the first version (what, why,
    tradeoff, where), and §1–§10 edited so nothing contradicts the plan; §10 now records the
    answers found so far.
  - This file and the README's sponsor sections.
  - **Short links are held at the click as Unknown** and the user double-checks (decision 26).
- **Earlier on 2026-10-17:**
  - **Merged into `main`**: `extension-heartbeat` (the offscreen heartbeat
    crash Evan found in real Chrome) and `sponsor-check`. `pnpm typecheck && pnpm lint && pnpm
test` pass on `main`.
  - **Daytona checked live:** `pnpm try:daytona` passes (create 0.8–3.8 s, upload, run, network
    off, delete). The org is on Tier 1 or 2: `networkBlockAll` **at creation** works and blocks
    even npm; allow-lists and changes after creation are refused; Factory and ordinary websites are
    unreachable. Evidence `logs/2026-10-17-daytona-tier/`.
  - **Worker A decided and proven: option B** (decision 19). `pnpm try:droid` passes: Droid on
    the Mac, 31 built-in tools off, three read-only argument-free tools into a network-off Daytona
    sandbox; correct SHA-256, verdict and summary in about 10 s; every tool call logged; 0
    sandboxes left. Two surprises, both handled: an SDK/CLI protocol mismatch (worked around) and
    `ToolSearch` can't be disabled (allowed as the one exception; it can only load schemas).
    Evidence `logs/2026-10-17-droid/`. The `droid` CLI 0.238.0 is installed on Evan's Mac via
    Homebrew.
  - **Links are judged without opening them** (decision 20): link detonation is dropped, so the
    Tier 3 question no longer blocks anything.
  - **Photon is in scope** (decision 21), built near the end; **demo materials at the end**
    (decision 22); **one branch per feature** (23); **keys in `.env.local`** (24).
- **In progress:** nothing. **Done on branch `droid-tool-lockdown`, merged into `main`:** Worker A's
  lockdown rules moved from `scripts/try-droid.mts` into `src/main/droidLockdown.ts` with 15 unit
  tests (permission handler, disabled tools, read-only commands, untrusted fence, prompt
  injection); `try-droid` imports the same module and still passes live. Evidence
  `logs/2026-10-17-droid-lockdown/`. `tsconfig.node.json` now allows `.ts` import extensions so
  the script can import from `src/main/` under Node.
- **Next step:**
  1. **Zach:** your `sponsor-check` commits are in `main` (via `sponsor-check-sync`); your
     decision 19 is now 27, and `chalk.yaml` & co. are in `chalk/` (run Chalk commands from there).
     An untracked `hello_chalk.py` (Chalk's hello-world sandbox) appeared in the repo root at 11:46;
     it belongs in `chalk/` if kept.
  2. **Evan:** branch `link-checks` from `main` (M2): content script, Tier 1 rules, Safe Browsing,
     RDAP, DNS and certificate-log checks, wiring the click guard — no link is ever opened. The
     code still assumes detonation in a few places (Open issues 4–7); clean that up first, on
     `link-checks` or its own branch.
  3. **Zach:** `sandbox-image`, `ui-fixes` and `watcher` have work on `origin` (pushed 01:17) that
     predates the decisions above. Merge the latest `main` into each before continuing (PLAN.md ›
     Branches), then `sandbox-image` first.
  4. With `extension-status`: restart Aegis (`pnpm dev` doesn't reload the main process), run
     `pnpm build:extension`, reload the extension in Chrome, and confirm Settings › Connections
     shows Bridge = Connected **and** the popup shows Connected with no `!` badge (closes
     milestone 1).
  5. Write `scripts/try-chalk` (it must prove Worker B's network is off, PLAN.md › Sponsor findings
     › Chalk) and `scripts/try-photon`. `CHALK_ENVIRONMENT` is already set in `.env.local`.
  6. Rotate the Factory key (it was pasted into chat on 2026-10-17).
- **Broken / failing:** typecheck, lint and tests pass. `store.test.ts` › "computes the overview
  counts" fails between midnight and about 1:35 AM (demo timestamps); the fix is on `ui-fixes`.
  Three small UI issues open ("Open issues" below). `src/shared/constants.ts` still carries
  `detonatePageLoad` / `detonateTotal` from the dropped detonation; remove them when M2 or M4
  touches that file.
- **Uncommitted on purpose:** `.DS_Store` and `logs/2026-10-16-2356/` (left as they are at the
  team's request).
- **Blocked on / questions for the team:**
  - Merge Zach's newer `origin/sponsor-check` commits into `main` (Next step 1)?
- **How to verify current state:** `pnpm verify` writes a new `logs/<date-time>/` folder with every
  check's output, a bridge smoke test, the app's health report and screenshots; compare with the
  latest `SUMMARY.md` in `logs/`. `pnpm try:daytona` and `pnpm try:droid` re-check the sponsors
  with the keys in `.env.local` (each deletes its sandbox; check the leak table below).

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

| What                                                                           | Why not                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The extension in a real Chrome (load, heartbeat, popup)                        | Needs loading by hand; the run simulated the heartbeat with `curl`                                                                                                                    |
| A physical fn tap, ⌃⌥A, Esc / ⌘O / ⌘P, tray menu clicks                        | The script can't send keyboard or menu-bar input                                                                                                                                      |
| Pause / resume, settings toggles, Export CSV, search                           | No UI clicks in the run                                                                                                                                                               |
| The click-guard overlay                                                        | Checked by eye in the browser pane during development, not in a logged run                                                                                                            |
| The Daylight (light) theme                                                     | The Mac was in dark mode                                                                                                                                                              |
| Packaging `Aegis.app` (`pnpm app`)                                             | Not run                                                                                                                                                                               |
| Sponsor integrations in the app (Daytona, Droid, Chalk, Photon, Safe Browsing) | Not built yet. Daytona and Droid were checked on their own by `pnpm try:daytona` / `pnpm try:droid` (passing, evidence in `logs/2026-10-17-*`); Chalk and Photon only from their docs |

## Open issues

Found by the verification run (`logs/2026-10-16-2339/SUMMARY.md` › Problems). All three are
for branch `ui-fixes` (PLAN.md › Branches):

1. Settings › "Text me when Aegis blocks something" still says "Needs Photon (milestone 5)". Photon
   is back in scope (decision 21), but only as screenshot → verdict; alert texts are not planned,
   so the setting should be hidden or say "Not planned".
2. The empty Report's **Back** button uses a forward-pointing arrow.
3. With no history, Links › Awaiting review says "Every link you clicked came back with a verdict…",
   implying links were checked.

Found while updating the docs (2026-10-17): **the code still assumes link detonation**, which
decision 20 dropped. Fix on its own branch (e.g. `drop-detonation`) or as part of `link-checks`:

4. `extension/src/guard.ts` still shows **Inspect in sandbox** (hide it).
5. Settings: the "auto-detonate" toggle (`autoDetonate` in `src/shared/ipc.ts`,
   `src/main/settings.ts`, `SettingsView.tsx`), the sandbox-budget description ("Automatic
   detonations stop…") and `PRIVACY_COPY` ("suspicious links are opened in a Daytona sandbox") —
   use the README's Privacy copy.
6. Downloads › a tile caption says "opened in a Daytona sandbox today"; the demo data has a
   "Detonation" check row (`src/main/demo.ts`).
7. Leftovers to remove or leave for later: the bridge's `POST /inspect` route (501 today),
   `TIMEOUTS_MS.detonatePageLoad` / `detonateTotal`, and the `detonations` table in `store.ts` (a
   schema change; its test lists the table).

Found while merging Zach's `sponsor-check` work (2026-10-17):

8. The seven Chalk skills in `.claude/skills/` point to `references/*.md` and `scripts/` files
   that weren't committed by `chalk init`; re-copy them from Chalk's skill package or drop the
   skills.

---

## Milestone checklist

| #   | Milestone                                                              | Owner       | Status                                                                                         |
| --- | ---------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| 0   | Scaffold, shared types, bridge contract, PLAN/PROGRESS, `.env.example` | Evan + Zach | Done                                                                                           |
| 0a  | `demo/` phishing page, scam texts, invoice email                       | Evan        | Moved to the end (decision 22)                                                                 |
| 0b  | `sandbox/Dockerfile` now; `demo/` test `.pkg` + scripts, EICAR at end  | Zach        | Dockerfile on branch `sandbox-image` (origin); demo files at the end (decision 22)             |
| 1   | Shell + bridge (Zach); extension skeleton (Evan)                       | Zach / Evan | Built and verified; real-Chrome check found the GET/Origin bug, fixed on `extension-status`    |
| 2   | Links, judged without opening them (decision 20)                       | Evan        | Click-guard UI built; content script, scoring, wiring next on branch `link-checks`             |
| 3   | Downloads (core demo)                                                  | Evan + Zach | Not started                                                                                    |
| 4   | Worker A (Droid on the Mac + Daytona sandbox) + compare                | Zach        | Approach proven by `pnpm try:droid` (decision 19); build on branch `worker-a` after M3         |
| 5   | Photon: phone screenshot by iMessage → verdict                         | Evan        | In scope (decision 21); built near the end                                                     |
| 6   | Chalk: Worker B + link data + evals                                    | Evan        | Not started                                                                                    |
| 7   | ~~Link detonation~~                                                    | Zach        | Dropped for now (decision 20); branch `detonate` parked                                        |
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
- **Messages, Accuracy**: empty states; Messages will hold the Photon screenshot threads (M5);
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
| Photon            | unconfigured | M5, built near the end                                  |
| Chalk             | unconfigured | No key                                                  |
| Safe Browsing     | unconfigured | No key; the live check is implemented but not exercised |
| Downloads folder  | ok           | Granted to Electron under `pnpm dev`                    |
| fn key            | ok           | Add-on built; Input Monitoring granted to Electron      |

With keys (2026-10-17 11:38, `sponsors.ts` called directly, not through the app window): Daytona
**ok**, Droid **ok**, Sandbox image **pending** (`logs/2026-10-17-sponsor-sync/sponsors-live.json`).
Not yet seen in a running app's Settings › Connections.

## Stubs and simulations

- Demo data only under `AEGIS_DEMO=1`, in its own database, with a "Demo data" chip in the UI.
- Bridge `/page`, `/download`, `/download/quarantined`, `/inspect`, `/scan/:id` → 501 `notImplemented`.
- Report actions disabled until quarantine handling (milestone 8).
- `pnpm build:sandbox` and `pnpm eval` exit 1 with "not implemented yet".
- Sandbox budget meter shows 0 until the queue records jobs (milestone 3).
- Settings › API keys shows status only; paste-in storage (safeStorage) not built.

## Sponsor findings

All in `docs/PLAN.md` › Sponsor findings. Daytona and Factory Droid: checked against each SDK's
types, then **run live** on 2026-10-17 (`pnpm try:daytona`, `pnpm try:droid`, both passing;
evidence `logs/2026-10-17-daytona-tier/`, `logs/2026-10-17-droid/`). Chalk and Photon: from their
docs and dashboards only; `try-chalk` and `try-photon` are next. The app's own Daytona and Droid
checks (`sponsors.ts`) also passed against the real services (`logs/2026-10-17-sponsor-sync/`).

## Sandbox leak check (Daytona dashboard after each milestone)

| After                                       | Sandboxes left running                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `sponsor-check` live runs, 2026-10-17 10:39 | 0 (checked with `daytona.list()`: 0 sandboxes in the org) |
| `try-droid` live runs, 2026-10-17 10:58     | 0 (`logs/2026-10-17-droid/leak-check.txt`)                |
| `droid-tool-lockdown` live run, 11:27       | 0 (`logs/2026-10-17-droid-lockdown/leak-check.txt`)       |
| `sponsor-check-sync` live checks, 11:39     | 0 (`logs/2026-10-17-sponsor-sync/leak-check.txt`)         |

## Decisions log

- 2026-10-17 11:50: `sponsor-check-sync` and `droid-tool-lockdown` merged into `main`; `main`
  pushed to `origin`.
- 2026-10-17 11:45: `sponsor-check-sync`: Zach's live sponsor checks (decision 27, was his 19),
  Chalk credentials and `chalk init` files merged with `main`'s docs as the source of truth; Chalk
  files moved to `chalk/`; Worker B must turn its network off (Chalk sandboxes are open by
  default).
- 2026-10-17 11:27: `droid-tool-lockdown`: the lockdown rules are shared code with tests
  (`src/main/droidLockdown.ts`); `workerA.ts` must use them at milestone 4.
- 2026-10-17 11:35: Short links are held at the click as Unknown and the user double-checks
  (PLAN.md decision 26). Droid lockdown tests go on their own branch, `droid-tool-lockdown`.
  `docs-update` merged into `main`; `main` pushed to `origin`.
- 2026-10-17 11:15: Docs brought up to date on branch `docs-update`: PLAN.md decisions 20–25 and a
  tradeoffs table; architectural.md (Worker A option B, no detonation, Photon screenshots);
  MEGA_PROMPT.md §0 "What changed" with each change's tradeoff, and §1–§10 edited to match.
- 2026-10-17: Link detonation dropped; links are judged without opening them (PLAN.md decision
  20). Short links become Unknown; "Inspect in sandbox" is hidden.
- 2026-10-17: One Devpost entry enters all four tracks; Photon is back in scope as screenshot →
  verdict, built near the end (decision 21, supersedes the "deferred" part of 18).
- 2026-10-17: Demo materials move to the end (decision 22); one branch per feature (23); keys in
  `.env.local` (24); every "works" claim needs evidence in `logs/` (25).

- 2026-10-17: `extension-heartbeat` and `sponsor-check` merged into `main`.

- 2026-10-17: `pnpm try:droid` passes with option B. Workaround for the SDK 0.9.1 / droid 0.238.0
  protocol mismatch recorded in PLAN.md › Sponsor findings › Factory Droid › Live results.

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
