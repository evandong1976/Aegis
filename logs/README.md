# Verification logs

Each folder here is one run of `pnpm verify` (`scripts/verify.sh`): the raw output of every check,
a `results.tsv` of exit codes, a bridge smoke test against the running app, the app's own health
report (`screens/*/status.json`, `log.json`) and screenshots of every screen. Each folder's
`SUMMARY.md` says what passed, what the run found, and what it did **not** verify.

| Run                                           | Commit    | Result                                            |
| --------------------------------------------- | --------- | ------------------------------------------------- |
| [2026-10-16-2339](2026-10-16-2339/SUMMARY.md) | `35cba97` | All 16 checks as expected; 3 small UI issues open |
| [2026-10-17-0043-sandbox-image](2026-10-17-0043-sandbox-image/SUMMARY.md) | branch `sandbox-image` | Targeted check (not `pnpm verify`): image builds; self-test 7 / 7, plain and hardened |
| [2026-10-18-0257](2026-10-18-0257/SUMMARY.md) | `765e1d0` on `fix/accuracy-chalk-results` | Accuracy screen reads the Chalk results: 0 renderer errors in both modes; bridge smoke 17 / 2 (fixed on `fix/verify-bridge-smoke-m3`) |

To add a run:

```bash
pnpm verify
```

Then write that folder's `SUMMARY.md` from its files, and add a row above. The app runs in
throwaway profiles on spare ports (47398, 47399), so it never touches a running Aegis or the real
history; those profiles are git-ignored.
