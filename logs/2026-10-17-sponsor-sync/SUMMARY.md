# Zach's sponsor checks against the real services — 2026-10-17 11:38 EDT

Branch `sponsor-check-sync`. `src/main/sponsors.ts` (Zach, PLAN.md decision 27) was only tested
against mocked SDKs on `sponsor-check` (`logs/2026-10-17-1015-sponsor-checks/`). This run calls
its `checkDaytona`, `checkDroid` and `checkSandboxImage` directly, with the keys in `.env.local`,
from a throwaway test runner (not committed). It isn't a run of the app window.

| Step | Daytona | Droid | Sandbox image |
| --- | --- | --- | --- |
| Lookup only (the every-60 s check) | ok — API reachable, key works (174 ms) | ok — 60 models through `/opt/homebrew/bin/droid` (2.1 s) | pending — no snapshot set yet; Docker not running |
| Check now (live tests) | ok — sandbox with the network off started in 1.4 s, ran a command, deleted | ok — answered the test prompt in 5.5 s | — |
| Check now again within 30 s | reused the result; no new sandbox | reused the result; no new prompt | — |

The app log (`sponsors-live.json` › `appLog`) shows exactly one sandbox and one Droid prompt.
Leak check afterwards: 0 sandboxes in the org (`leak-check.txt`).

Also on this branch: `pnpm typecheck`, `pnpm lint` and `pnpm test` (43 tests, including Zach's 20
in `sponsors.test.ts`) pass.

## Not verified

- The checks inside a running app (Settings › Connections, the tray, the panel), and the 15-minute
  reuse across launches.
- The live tests' failure paths against the real services (covered by Zach's mocked tests only).
