# `pnpm try:sandbox`, live on Daytona — 2026-10-17 12:29 EDT

Branch `feature/sandbox`. Zach's Daytona key (in `.env`), default Daytona snapshot (no Aegis
snapshot yet). A harmless test shell script that only looks malicious was written on the Mac
(mode 644, never run there), uploaded to a sandbox created with `networkBlockAll`, and run inside
it. **All 7 checks pass; exit 0.**

| Step                       | Time   | Result                                                                                 |
| -------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Create, network off        | 0.8 s  | `networkBlockAll=true`, 1 attempt                                                      |
| Upload + SHA-256 inside    | 0.5 s  | `cfd92c5a…9053` matches                                                                |
| Network probes             | 36.2 s | example.com and registry.npmjs.org (a Daytona "essential service") both **blocked**    |
| Run sample (30 s limit)    | 25.2 s | exit 0; 14 commands; 1 file written; 2 network attempts, both blocked                  |
| Delete (`finally`)         | 0.3 s  | deleted                                                                                |
| Leak check after the run   | —      | **0 sandboxes** in the org (`leak-check.txt`)                                          |

What the sample did inside the sandbox (`run.json` › `observation`): ran `curl … | sh` against a
`.invalid` host (nothing downloaded), wrote `home/Library/LaunchAgents/us.zoom.updater.plist` in
its scratch home, looked for Chrome's `Login Data` and the keychain (neither exists on Linux),
decoded base64 into `sh` (prints `aegis-test-stage`), and tried to post the hostname with `wget`
(blocked).

## Earlier attempts (kept as evidence)

- `../2026-10-17-1226-sandbox-run/`: **failed safely.** The npm network probe outran its 30 s
  command limit because `wget` retries up to 20 times by default, so the script refused to run the
  sample and deleted the sandbox. Fix: every probe tool is capped with `timeout 8`, `wget` gets
  `--tries=1`, and the probe command gets 39 s (`daytona.ts`, with a test).
- `../2026-10-17-1227-sandbox-run/`: network proven off and everything recorded, but the
  **sample's own** `wget` (no retry limit) hung until the 30 s limit stopped it (exit 124). The time
  limit worked; the test sample's `wget` now has `-T 5 --tries=1` so the run finishes and every check
  is meaningful.

## Not verified

- The Aegis snapshot (`pnpm build:sandbox`, milestone 3): the run used Daytona's default image.
- Anything in the app: this is the script only; `scans.ts` / `workerA.ts` don't call `daytona.ts`
  yet.
- Speed: the two network probes take about 18 s each, a third of the 120 s worker budget. Worth
  shortening (one probe tool, or a probe in parallel with the upload) before M3.
