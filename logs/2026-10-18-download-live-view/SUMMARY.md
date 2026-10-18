# Real downloads in the live view — 2026-10-18

Branch `feature/download-live-view`. Every file a real Chrome download sends to the sandbox now
gets the same live view as Downloads › **Test the sandbox** (`zoom-update.sh`): sandbox up with the
network off, the file opened on the sandbox's own Linux desktop, the Terminal tab streaming the
run, Droid's read-only tool calls, then the Report.

## How it was run

`sh logs/2026-10-18-download-live-view/run.sh <run-dir> <file> <out-name>` from the repo root:

- `demo/` served with `python3 -m http.server 8765 --bind 127.0.0.1` as in `demo/README.md`, plus
  `setup.exe` (`MZ` and 4094 zero bytes, harmless) for a file that isn't a shell script.
- The built extension (bridge port rewritten to 47398) in a fresh headless Chrome profile opens the
  file's URL; the extension holds it at `onDeterminingFilename` and sends the bytes to the app.
- The real app (`electron-vite dev`, throwaway profile and downloads folder) with live Daytona and
  Droid (`FACTORY_API_KEY` from `.env`). `AEGIS_CAPTURE_LIVE=download` makes the app screenshot
  the main window every 2 s from the moment the first download's live view begins until the
  Report replaces it, then save the run's events (`live-events.json`, desktop frames left out).
- `leak-check.mjs` lists the Daytona org's sandboxes afterwards.

## Results (final code, 06:39–06:43 UTC)

| File | Live view | Verdict | Sandbox |
| --- | --- | --- | --- |
| `terminal-demo/`: `aegis-terminal-demo.command` (the demo script) | caught → sandbox (network off, probed) → opened: desktop on, `sh -x` trace streamed, `AEGIS_DEMO_EXECUTED` in the window (`live-09.png`–`live-13.png`) → Droid, 6 tools → verdict → Report (`live-31.png`) | Clean, delivered (63 s) | network off, deleted |
| `windows-exe/`: `setup.exe` | same stages; **not run** ("an executable isn't a shell script, so it was opened for reading only"), its type, first bytes and strings shown in the desktop window → Droid, 7 tools → Report | Suspicious, held (73 s) | network off, deleted |

`e2e.log` / `results.json`: 4 / 4 in each folder. `leak-check.txt`: **0** sandboxes left after each
run. `scan-row.json` is the stored scan; `log.json` the app's scan log.

## Found and fixed on the way

1. A Droid-reviewed download with no reasons of its own said **"Not analysed yet"** on the Report
   (`scans.ts`). It now says "Reviewed in the sandbox" (unit test in `scans.test.ts`).
2. The read-only stage said "a executable"; `withArticle` picks a / an.
3. Harness, not product: Chrome shows a file served as `image/jpeg` instead of downloading it, so the
   first non-script attempt (`photo.jpg`) never reached the extension; `setup.exe` replaced it.

## Not shown here

- **Worker B (Chalk)** failed in every run with `ConnectError: no environment … for team …` (the
  Chalk environment in `.env` doesn't exist for that team). The live view shows that line; Worker A
  decided alone. Unrelated to this branch.
- The watcher path (`~/Downloads`) uses the same `ScanService` code but wasn't driven here.
- Headless Chrome only; the extension in a normal Chrome window wasn't re-checked.

## Checks on the final code

`pnpm typecheck`, `pnpm lint` and `pnpm test` (293 tests) pass. `pnpm verify`
(`logs/2026-10-18-0238/`): everything as expected except **bridge smoke 17 / 19**: it still expects
`POST /download` and `POST /scan/:id` to answer 501 "milestone 3", but both are built on `main` now
(400 for the smoke's empty body, 404 for an unknown scan). `scripts/verify.sh` is unchanged on this
branch; its expectations need updating separately.
