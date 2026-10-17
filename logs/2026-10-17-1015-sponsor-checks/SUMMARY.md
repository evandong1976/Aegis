# Sponsor live checks — 2026-10-17 10:15 EDT, branch `sponsor-check`

A targeted check of `src/main/sponsors.ts`, not a full `pnpm verify` run. **No request reached
Daytona or Factory, and no credits were used.**

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck`, `pnpm lint` | Pass | — |
| `pnpm test` | 43 / 43, including 20 new tests in `sponsors.test.ts` against mocked SDKs | `tests.log` |
| App with no keys | Daytona and Droid "Not set up"; Sandbox image "Not checked" | `nokeys/*` |
| App with dummy keys: Daytona pointed at `127.0.0.1:9` (refused), droid CLI path missing | Daytona, Sandbox image and Droid "Down" with the reason and next step; the tray turns "Degraded"; the panel shows red dots | `dummy/*` |

Both runs used a fresh profile, and the capture mode never runs live tests. Neither run logged a
renderer or main-process error.

## Not verified

- Real calls with real keys: the lookups every 60 s, and the live tests at start and on Check
  now. The keys are held back to save credits.
- The cooldowns in a running app. The unit tests cover them with a fake clock.
