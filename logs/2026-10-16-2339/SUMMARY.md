# Verification — 2026-10-16 23:39 EDT

Produced by `pnpm verify` (`scripts/verify.sh`) at commit **35cba97** on `aegis-v2`, with no
uncommitted code changes (`environment.txt`). Node 22.16.0, pnpm 10.30.1, Electron 44.8.0,
macOS 26.5.2 (arm64). Every claim below points at a file in this folder; nothing here is from
memory.

The app was run twice, in **throwaway profiles on spare ports** (bridge 47398 for the real run,
47399 for the demo run), so neither run touched a running Aegis or the real history in
`~/Library/Application Support/Aegis`.

## Results (`results.tsv`)

| Check                                         | Exit | Expected | Evidence                           |
| --------------------------------------------- | ---- | -------- | ---------------------------------- |
| Typecheck (main, renderer, extension)         | 0    | 0        | `typecheck.log`                    |
| Lint + `tokens.css` staleness check           | 0    | 0        | `lint.log`                         |
| Unit tests (Vitest, verbose)                  | 0    | 0        | `tests.log` — 23 / 23 passed       |
| Production build (electron-vite)              | 0    | 0        | `build.log`                        |
| Extension build                               | 0    | 0        | `extension-build.log`              |
| Extension ID matches the manifest key         | 0    | 0        | `extension-id.log`                 |
| fn add-on build (node-gyp)                    | 0    | 0        | `native-build.log`                 |
| fn add-on loads in Electron                   | 0    | 0        | `native-load.log`                  |
| `pnpm build:sandbox` placeholder fails loudly | 1    | 1        | `placeholder-sandbox.log`          |
| `pnpm eval` placeholder fails loudly          | 1    | 1        | `placeholder-eval.log`             |
| Bridge smoke test: 14 pass, 0 fail            | 0    | 0        | `bridge-smoke.log`                 |
| Real mode: app launched, 8 screenshots        | 8    | 8        | `app-real.log`, `screens/real/`    |
| Real mode: live status + health written       | 0    | 0        | `screens/real/status.json`         |
| Real mode: renderer and main errors           | 0    | 0        | `renderer-errors.log` (empty)      |
| Demo mode: app launched, 8 screenshots        | 8    | 8        | `app-demo.log`, `screens/demo/`    |
| Demo mode: renderer and main errors           | 0    | 0        | `renderer-errors-demo.log` (empty) |

## What each check shows

### Unit tests — 23 passed (`tests.log`)

- **Verdict rules** (`src/main/verdict.test.ts`, 8): score bands 0–29 / 30–69 / 70–100; weights
  summed and capped at 100; negative weights ignored; a hard rule makes it Malicious; incomplete
  evidence turns Clean into Unknown, never the reverse; AI suggestions raise Clean → Unknown →
  Suspicious → Malicious; AI suggestions never lower a verdict; the four words are Clean, Unknown,
  Suspicious, Malicious and no sentence says "safe".
- **Store** (`src/main/store.test.ts`, 8): every table from BUILD_PROMPT §4.3 exists; migrations are
  idempotent; the pre-release none/caution/danger schema is rebuilt; verdicts outside the four words
  are rejected; a report round-trips; tabs and search filter correctly; overview counts are right on
  the demo data; settings and trusted sites persist.
- **Bridge** (`src/main/bridge.test.ts`, 7): only our extension's origin is accepted; rebinding Host
  headers are rejected; requests without our Origin get 403; `/status` is served; pings and trust
  are recorded; malformed bodies get 400; later-milestone routes answer 501.

### Builds

- The app builds for production (`build.log`) and the extension builds into `extension/dist`
  (`extension-build.log`).
- The extension ID derived from the manifest's `key` is `onljkbhkoinihmjibfofcalimkolemam`, the
  same as `src/shared/constants.ts` (`extension-id.log`), so the bridge accepts the real extension.
- The fn add-on compiles against Electron 44.8.0's headers and loads inside Electron, exporting
  `start` and `stop` (`native-build.log`, `native-load.log`).
- Scripts for later milestones fail with a clear message instead of pretending
  (`placeholder-sandbox.log`: milestone 3, `placeholder-eval.log`: milestone 6).

### The running app, real mode (empty history)

**Bridge over HTTP** (`bridge-smoke.log`, run with `curl` against the live app):

| Request                                        | Expected | Got |
| ---------------------------------------------- | -------- | --- |
| `GET /status` from the Aegis extension         | 200      | 200 |
| `GET /status` with no Origin                   | 403      | 403 |
| `GET /status` from a web page origin           | 403      | 403 |
| `GET /status` from another extension           | 403      | 403 |
| `GET /status` with a rebinding `Host` header   | 403      | 403 |
| `OPTIONS /status` preflight from the extension | 204      | 204 |
| `POST /ping` heartbeat                         | 200      | 200 |
| `POST /trust` example.com                      | 200      | 200 |
| `POST /trust` with an empty domain             | 400      | 400 |
| `POST /page` (milestone 2)                     | 501      | 501 |
| `POST /download` (milestone 3)                 | 501      | 501 |
| `POST /inspect` (milestone 7)                  | 501      | 501 |
| `GET /scan/abc` (milestone 3)                  | 501      | 501 |
| `GET /nope`                                    | 404      | 404 |

The listening socket is `127.0.0.1:47398` only (`lsof` output at the end of `bridge-smoke.log`).

**Health checks the app reported** (`screens/real/status.json`; no `.env` on this run):

| Service           | State        | Required |
| ----------------- | ------------ | -------- |
| Bridge            | ok           | yes      |
| Local store       | ok           | yes      |
| Daytona           | unconfigured | yes      |
| Sandbox image     | pending      | no       |
| Docker (fallback) | down         | no       |
| Droid             | unconfigured | yes      |
| Photon            | unconfigured | no       |
| Chalk             | unconfigured | yes      |
| Safe Browsing     | unconfigured | yes      |
| Downloads folder  | ok           | no       |
| fn key            | ok           | no       |

Protection is therefore **degraded**, which is correct with no API keys. "Bridge ok" here comes from
the `curl` heartbeat, not from a real Chrome. "fn key ok" means the add-on loaded and macOS let it
create its key listener (Electron already has Input Monitoring on this Mac).

**Scan log** (`screens/real/log.json`, 16 lines): bridge listening → fn key running → extension
connected → `trust domain=example.com` → one line per service from the first health check → the
bridge turning `degraded → ok` after the heartbeat. Each service is logged once.

**Screens** (`screens/real/`): the panel, Overview, Links, Downloads, Report, Accuracy, Messages and
Settings all render with the design system. With no history they show their empty states; the
Overview banner names the four required services that aren't set up; coverage is 40 (2 of 5 layers:
extension, ~/Downloads watcher). Settings › Trusted sites lists **example.com**, the domain sent
through `POST /trust` a moment earlier — the bridge → store → UI path works end to end.

### The running app, demo mode (`AEGIS_DEMO=1`)

8 screenshots in `screens/demo/`, no renderer or main-process errors (`renderer-errors-demo.log` is
empty). The demo status reports `demo: true`, one active scan and This page counts of 11 Clean /
1 Malicious (`screens/demo/status.json`). The Report for `invoice_oct.iso` renders the Figma
layout: Malicious badge, risk 94, finding chips, the Droid timeline, indicators, capabilities and
flagged code lines.

## Problems this verification found

1. **App crashed on launch with a relative profile path** (`Error: Path must be absolute`). The
   first run of this script passed `AEGIS_USER_DATA` as a relative path; Electron requires an
   absolute one, the app never started, and the "no renderer errors" check passed vacuously.
   **Fixed** in `ea5179b`: the app resolves the path, and the script now fails unless the app
   produces its screenshots and `status.json`. That run's output was discarded.
2. **Every health check was logged twice** when the extension's first heartbeat arrived during
   startup (two refreshes overlapped). **Fixed** in `35cba97`: refreshes run one at a time. This
   run confirms one line per service.
3. **Stale copy, open:** Settings › "Text me when Aegis blocks something" still says "Needs Photon
   (milestone 5)", but Photon is now deferred to the later mobile feature (`screens/real/settings.png`).
4. **Wrong icon, open:** the empty Report's **Back** button uses a forward-pointing arrow
   (`screens/real/report.png`).
5. **Misleading empty copy, open:** with no history, Links › Awaiting review says "Every link you
   clicked came back with a verdict you didn't need to review", which implies links were checked
   (`screens/real/links.png`).

## Not verified by this run

| Not verified                                                      | Why                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The extension loaded in a real Chrome and sending real heartbeats | Needs loading `extension/dist` by hand in `chrome://extensions`; the heartbeat here is `curl` |
| A physical fn tap opening the panel                               | Can't press keys from the script; the add-on loading and the listener starting are verified   |
| ⌃⌥A, Esc, ⌘O, ⌘P, tray menu clicks                                | Same: no keyboard or menu-bar input from the script                                           |
| Pause / resume, settings toggles, Export CSV, search              | Not driven by this run (no UI clicks)                                                         |
| The click-guard overlay                                           | Checked visually in the browser pane during development; not part of this run                 |
| The Daylight (light) theme                                        | This Mac was in dark mode for both runs                                                       |
| Packaging `Aegis.app` (`pnpm app`)                                | Not run                                                                                       |
| Any sponsor integration (Daytona, Droid, Chalk, Safe Browsing)    | Not built yet, and no keys were set                                                           |

## Reproduce

```bash
pnpm verify
```

A new `logs/<date-time>/` folder appears with the same files. The throwaway profiles inside it are
git-ignored.
