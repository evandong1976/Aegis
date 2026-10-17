# Live view: a file opened in a real sandbox, watched as it happens (2026-10-17, `feature/visualization`)

What was checked: the live view (PLAN.md decision 30) against **real** network-off Daytona
sandboxes, with only Droid's words scripted. Run on the demo database in its own profile
(`AEGIS_DEMO=1`, `AEGIS_CAPTURE_LIVE=<sample>`, `src/main/devcapture.ts`), one screenshot every 2 s.

## Before building: can a network-off sandbox show a desktop? (`scripts/try-desktop.mts`)

| Run                                    | Result                                                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../2026-10-17-1817-desktop-probe/`    | Desktop starts (Computer Use: Xvfb + xfce4 + VNC, 3.4 s), screenshots in 0.1 s, network still off afterwards. **The terminal window did not open** (killed with its command's process group).                             |
| (1818, first try, overwritten)         | `setsid -f` + `--disable-server` (no D-Bus): xfce4-terminal said `Unknown option "--disable-server --hold …"`: the sandbox's shell passed `$A` as one word.                                                                  |
| `../2026-10-17-1818-desktop-probe/`    | Arguments spelled out: **7/7 pass**. A window titled `aegis-terminal-demo.command` shows the demo's output (`frame-1.jpg`). Network blocked before and after the desktop started; sandbox deleted.                          |

## Run 1: fake Zoom installer (`zoom-update.sh`, from `src/main/testSamples.ts`)

Malicious, score 100, 57.7 s from caught to verdict (`log.json`). Most of the time is the sample's
own `curl` waiting on DNS with no network, as in the `try:sandbox` runs.

| Screenshot                        | Shows                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `1-sandbox-starting.png`          | Stage rail; terminal: `daytona create --network-block-all`, upload, SHA-256 match, network probe                              |
| `2-desktop-starting.png`          | Desktop tab follows the run: the sandbox's xfce desktop before the window opens                                              |
| `3-file-opened-on-desktop.png`    | A terminal window titled `zoom-update.sh` on the sandbox desktop, showing the run's `sh -x` trace live                        |
| `4-file-finished-on-desktop.png`  | The same window at the end: the LaunchAgent write, password lookups, base64 decode, the blocked upload                       |
| `5-droid-reaching-in.png`         | Droid (scripted stand-in) on the left, real tool calls with their output; terminal: blocked network attempts in red          |
| `6-report.png`                    | The Report that replaces it: five findings, timeline labelled "Scripted stand-in for Droid"                                   |
| `7-report-sandbox-session.png`    | The sandbox session kept as a card at the end of the Report                                                                   |
| `downloads-test-card.png`         | The "Test the sandbox" card on Downloads                                                                                      |
| `panel-mid-run-old-steps.png`     | **Bug found:** the panel showed the old step list while the desktop started (no stage active). Fixed before run 2.           |

Also fixed after this run: the terminal and Droid's list stopped following new lines after a tall
block (or a tab switch); a tool call (~0.1 s) was too quick to see Droid "reach in" (now shown for
at least ~0.7 s; the call itself is not slowed).

## Run 2: terminal demo (`demo/aegis-terminal-demo.command`), after the fixes

Clean, score 0, 28.1 s (`../2026-10-17-1837-live-view-terminal-demo/`).

| Screenshot                        | Shows                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `1-file-opened-on-desktop.png`    | The demo's message in a terminal window on the sandbox desktop                            |
| `2-droid-tools-in-terminal.png`   | Both panes pinned to their newest line; Droid's commands land in the terminal (`droid ›`) |
| `3-report-clean.png`              | "It ran in the sandbox, printed a message, wrote 0 files and tried no network."           |
| `4-report-sandbox-session.png`    | Sandbox session card                                                                      |
| `panel-watch.png`                 | The panel's live line, "Opening it in the sandbox…", with **Watch**                       |

## Checks

- `pnpm typecheck`: pass. `eslint src scripts extension`: pass. `pnpm test`: 148 / 148 (new:
  `live.test.ts`, `liveAgent.test.ts`, `sandboxScan.test.ts`). `pnpm lint` over the whole folder
  also lints `.claude/worktrees/` (another session's worktree, 863 errors, not part of this change).
- Leak check after both runs and the probes: **0** sandboxes labelled `app=aegis` left on Daytona.
- No renderer errors in either run's `dev.log`. No API key in any file here.

## Not checked

- A real Chrome download (milestone 3 isn't built; the test button stands in for it).
- The real Droid session (milestone 4): the agent pane is driven by the scripted stand-in.
- The light theme (the terminal and desktop are dark in both by design; the rest uses tokens).
