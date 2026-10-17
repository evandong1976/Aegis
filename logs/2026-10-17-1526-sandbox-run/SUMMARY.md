# `pnpm try:sandbox` on Daytona Tier 3 — 2026-10-17 15:26 EDT

The first run with the Tier 3 key. On Tier 3 a sandbox with no network setting has the whole
internet (`../2026-10-17-1524-daytona-tier3-newkey/`), so this is the run that shows
`networkBlockAll` at creation still holds. **All 7 checks pass; exit 0; 0 sandboxes left**
(`leak-check.txt`).

| Step                    | Time   | Result                                                         |
| ----------------------- | ------ | -------------------------------------------------------------- |
| Create, network off     | 0.9 s  | `networkBlockAll=true`, 1 attempt                              |
| Upload + SHA-256 inside | 0.5 s  | `cfd92c5a…9053` matches                                        |
| Network check           | 8.2 s  | example.com and registry.npmjs.org: all blocked                |
| Run sample              | 22.2 s | exit 0; 14 commands, LaunchAgent written, 2 blocked downloads  |
| Delete                  | 0.2 s  | deleted                                                        |
