# Verification — 2026-10-18 02:57 EDT (Accuracy screen fix)

Produced by `pnpm verify` (`scripts/verify.sh`) at commit **765e1d0** on
`fix/accuracy-chalk-results`, with no uncommitted code changes (`environment.txt`: only this
folder untracked). Node 22.16.0, pnpm 10.30.1, Electron 44.8.0, macOS 26.6.2 (arm64). The app ran
in throwaway profiles on spare ports (47398 real, 47399 demo).

## What this run checks

On `main` (91716e2) the Accuracy screen threw
`TypeError: Cannot convert undefined or null to object` at `AccuracyView.tsx:30`
(`Object.entries(results.datasets)`) in both modes, because commit 9a9dbce replaced
`evals/results.json` with Chalk Evaluations output (`generated_at`, `worker_b[]` runs with `means`
and `per_sample`), which has no `datasets` field. The main process cast it to the old type unchecked.

The fix (765e1d0):

- `src/shared/evals.ts`: a zod schema for the Chalk shape. `parseEvalResults` never throws; non-JSON
  or a malformed field returns `{ error }` naming the field.
- `src/main/ipc.ts`: `evals:get` returns `null` (no file), the parsed results, or `{ error }`.
- `AccuracyView.tsx`: one card per run (verdict match, found planted, evidence verified, valid JSON),
  a side-by-side table and a per-sample table. An unreadable file shows the reason, not a crash.
- `eslint.config.mjs` ignores `video/**`: the same hunk as `fix/verify-bridge-smoke-m3`, so
  `pnpm lint` passes on a branch from `main`.

## Results (`results.tsv`)

| Check                                         | Exit | Expected | Evidence                                    |
| --------------------------------------------- | ---- | -------- | ------------------------------------------- |
| Typecheck (main, renderer, extension)         | 0    | 0        | `typecheck.log`                             |
| Lint + `tokens.css` staleness check           | 0    | 0        | `lint.log`                                  |
| Unit tests (Vitest, verbose)                  | 0    | 0        | `tests.log`: 292 / 292 in 22 files          |
| Production build (electron-vite)              | 0    | 0        | `build.log`                                 |
| Extension build                               | 0    | 0        | `extension-build.log`                       |
| Extension ID matches the manifest key         | 0    | 0        | `extension-id.log`                          |
| fn add-on build (node-gyp)                    | 0    | 0        | `native-build.log`                          |
| fn add-on loads in Electron                   | 0    | 0        | `native-load.log`                           |
| `pnpm build:sandbox` placeholder fails loudly | 1    | 1        | `placeholder-sandbox.log`                   |
| `pnpm eval` placeholder fails loudly          | 1    | 1        | `placeholder-eval.log`                      |
| Bridge smoke test: 17 pass, 2 fail            | 2    | 0        | `bridge-smoke.log`: **not this fix, below** |
| Real mode: app launched, 8 screenshots        | 8    | 8        | `app-real.log`, `screens/real/`             |
| Real mode: live status + health written       | 0    | 0        | `screens/real/status.json`                  |
| Real mode: renderer and main errors           | 0    | 0        | `renderer-errors.log` (empty)               |
| Demo mode: app launched, 8 screenshots        | 8    | 8        | `app-demo.log`, `screens/demo/`             |
| Demo mode: renderer and main errors           | 0    | 0        | `renderer-errors-demo.log` (empty)          |

## The fix, in evidence

- **0 renderer errors in both modes** (`renderer-errors.log`, `renderer-errors-demo.log`, both 0
  bytes). Before the fix, run `2026-10-18-0250` (on `fix/verify-bridge-smoke-m3`, which has the
  same `AccuracyView` as `main`) recorded 2 per mode: the TypeError and a React warning after it.
- **`screens/real/accuracy.png` and `screens/demo/accuracy.png`** show the run of
  2026-10-18 05:40:45 UTC, 35 samples each. Rules: verdict match 80.0%, found planted 100.0%,
  evidence verified 100.0%, valid JSON 100.0%. Agent: 88.6%, 74.3%, 75.7%, 100.0%. These match
  `evals/results.json`. Demo mode shows the same numbers: there is no sample eval data.
- **`tests.log`, `src/shared/evals.test.ts` (6)**: the committed `evals/results.json` parses
  (rules and agent, rows = per-sample count); a well-formed file round-trips; missing optional
  fields get defaults and null scores stay null; the old `ranAt`/`configurations` shape returns
  an error instead of throwing; malformed fields (`means` a string, negative `rows`,
  `worker_b: null`, `null`, `[]`) return errors; non-JSON and empty text return errors.

## Open, not part of this fix

- **Bridge smoke 17 / 2**: `POST /download` expected 501 got 400, and `POST /scan/abc` expected
  501 got 404. The script still expects the milestone-3 placeholders, but those routes are built
  now. `fix/verify-bridge-smoke-m3` fixes the expectations (its run `2026-10-18-0250`: 19 / 0).
