# Worker A live: Droid by file type, with the reference on every call

Branch `feature/aiSec` (from `main` at `e7f3984`), 2026-10-17 23:30 – 2026-10-18 00:20 EDT.
droid CLI 0.244.0 (Homebrew), `@factory/droid-sdk` 0.9.1, Daytona default snapshot (no
`AEGIS_DAYTONA_SNAPSHOT`). PLAN.md decision 32.

## What ran

`pnpm try:analyst`: five harmless samples, each in its own Daytona sandbox created with the
network off, uploaded and hash-checked, then the toolkit (stop leftovers, upload
`sandbox/aegis_inspect.py` to a random folder and hash-check it, `identify`) and a Droid session
with the tools for the file's reference rows and `resources/droid/file_types_vulnerabilities.md`
in its system prompt. The final verdict is computed by `src/main/verdict.ts`, as in the app.

| Sample           | Rows chosen         | Rules                                     | Droid                | Final          |
| ---------------- | ------------------- | ----------------------------------------- | -------------------- | -------------- |
| `invoice.pdf`    | `.pdf`              | suspicious 60 (auto-run JavaScript)       | suspicious (high)    | **suspicious** |
| `photos.zip`     | `.zip .tar .gz`     | suspicious 65 (Zip Slip into LaunchAgents) | malicious (high)     | **malicious**  |
| `zoom-update.sh` | `.sh .bash .ps1`    | malicious 100 (hard rule: download and run) | malicious (high)     | **malicious**  |
| `settings.env`   | `.env .config .ini` | clean 22 (weaknesses only: exposed keys, debug) | clean (high)   | **clean**, findings listed |
| `notes.txt`      | none                | clean 0                                    | clean (high)         | **clean**      |

5/5 as expected; every sandbox deleted (`all-samples.log`). In each session Droid worked through
the reference's methods for the type: identify by bytes, fingerprint, the row's inspector check,
strings and secrets, then read the file to confirm (the PDF's decoded script, the shell script's
lines). Its SHA-256 matched the upload every time.

## Found and fixed on the way

1. **droid 0.244.0 locked Droid out of its tools.** The first run (`invoice.pdf`) came back
   "The listed inspection tools were not available to call", and Aegis's own pass did all the
   work. Since 0.244.0 (released 2026-10-17) the CLI puts some models in `script_only` mode: MCP
   tools are deferred behind `ToolSearch` and can only be called from inside the built-in
   `Script` tool. The lockdown turns `Script` off, and SDK 0.9.1 rejects `Script`'s permission
   requests ("Invalid request format: received script"). Neither `--tool-execution-mode` in
   `execArgs` (ignored in JSON-RPC mode) nor `updateSettings` (ignored) changes it; the session's
   initialize request does. `droidLockdown.ts › directToolCalls` adds
   `toolExecutionMode: 'direct_only'` to it; Droid then loads each tool with `ToolSearch` and calls
   it directly, the permission handler allows it once, and every built-in stays off.
   `scripts/try-droid.mts` got the same fix.
2. **Secrets could reach Droid unmasked** through `read_sample` and `extract_strings`. Everything
   Droid sees now goes through `maskSecrets` (`fenceToolOutput`). Neither the AWS example secret
   nor the API keys appear in these logs.
3. **A finding Droid confirmed could show a lower severity than the inspector gave it**; Droid
   now only raises it. **A strings hit was counted twice** when the type's own check scored the
   same act (the shell script's persistence and password lookups); now it isn't.
4. The PDF check now shows the inflated script text (Droid asked for it in the first run).

## Not verified

- Option A in `try-droid` (`droid exec` inside a sandbox) with the new
  `--append-system-prompt-file` flag on the pinned droid 0.232.0: opt-in, not run.
- The app itself (`pnpm dev` → Test the sandbox, and a real download): the same agent and toolkit,
  built (`electron-vite build` bundles the reference and the inspector) but not clicked through.
- `store.test.ts › computes the overview counts` fails just after midnight: its demo rows are
  "N minutes ago", so some fall into yesterday. Unrelated to this branch (passed at 23:53).
