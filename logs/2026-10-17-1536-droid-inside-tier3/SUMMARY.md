# Droid inside a Daytona sandbox (option A) on Tier 3 — 2026-10-17 15:36 EDT

Evidence for the team's call on PLAN.md decision 19 (option A vs B) now that the org is on Tier 3
(decision 28). The plan and Worker A's design are unchanged. Branch off `feature/sandbox`
(`a7505e1` + the step 3 change to `scripts/try-droid.mts` in this commit).

**Result: the network side of option A works; whether Droid answers inside is still unproven,
because the Factory key in `.env` is invalid.** Factory returns 401 for it from the Mac (open
network, steps 1–2) and from inside the sandbox. That's a key problem, not a sandbox or network
problem. Re-run with a valid key: `AEGIS_TRY_DROID_INSIDE=1 pnpm try:droid`.

## What ran

`AEGIS_TRY_DROID_INSIDE=1 pnpm try:droid`, run as the equivalent `node` command with the main
checkout's `.env` (this worktree has none), and with `DROID_PATH` set to `droid@0.238.0` from npm,
installed in a scratch folder (this Mac had no droid CLI). Keys are scrubbed from every log.

| File                     | Run                                                                        | Exit |
| ------------------------ | -------------------------------------------------------------------------- | ---- |
| `try-droid.log`          | The run of record (final script): Factory's hosts `app.factory.ai,api.factory.ai` | 1 |
| `try-droid-2.log`        | Same, one script revision earlier (before the empty-host guard)            | 1    |
| `try-droid-api-only.log` | `AEGIS_FACTORY_DOMAINS=api.factory.ai`: is `app.factory.ai` needed?        | 1    |
| `try-droid-1-first.log`  | First run; its leak check counted the just-deleted sandbox (since fixed)   | 1    |

Before these, a throwaway `networkBlockAll` sandbox (deleted) showed the default snapshot has
**Node.js v25.9.0 and npm 11.12.1** (Debian 13, x86_64, user `daytona`). `sandbox/Dockerfile`,
Aegis's analysis image, has neither.

## Step 3 now (option A)

1. Create with `domainAllowList: 'app.factory.ai,api.factory.ai,registry.npmjs.org'`, ephemeral,
   `ttlMinutes: 30`. It refuses a sandbox that comes back without the list. Never open internet,
   and it never holds a sample.
2. `npm install -g droid@0.232.0`.
3. `updateNetworkSettings({ domainAllowList: <Factory's hosts> })`: narrows only (drops npm), so it
   matches what a prebuilt option A image would run with.
4. Probe from inside with curl: each Factory host, `example.com`, `registry.npmjs.org`, `1.1.1.1`
   by IP.
5. `droid exec --output-format json "<one-sentence prompt>"` with `FACTORY_API_KEY` in the
   command's env.
6. Delete in `finally`, then walk `daytona.list()` until the org has 0 sandboxes (up to 20 s).

## Results (`try-droid.log`)

| Check                         | Result                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sandbox with the allow-list   | Accepted, 0.9–1.2 s; the sandbox reports `app.factory.ai,api.factory.ai,registry.npmjs.org`                 |
| droid installs                | **Yes**: `npm install -g droid@0.232.0` exit 0 in 8.8–22.2 s; `droid --version` 0.232.0                     |
| Allow-list holds (after narrowing) | Factory hosts **HTTP 200**; `example.com`, `registry.npmjs.org`, `1.1.1.1` **unreachable**             |
| droid answers                 | **Not proven**: exit 1 in 7.1–11.2 s. Droid reached Factory, which answered "Authentication failed. FACTORY_API_KEY is set but appears to be invalid" (`duration_ms` 208–3775) |
| Sandboxes left                | **0** (found within 2.1–2.3 s of the delete)                                                                    |
| Whole run                     | 39–49 s wall clock for all three steps                                                                            |

Steps 1–2 (option B, Droid on the Mac) fail the same way with this key (`401 status code`). The
option B sandbox was still created network-off, and deleted.

## Hosts Droid needed

- **Install:** `registry.npmjs.org` only. `droid@0.232.0` pulls its binary from the optional
  dependency `@factory/cli-linux-x64`, and its `install.js` falls back to the same registry
  (checked by reading the package, not running it on the Mac).
- **Run:** with **only `api.factory.ai`** allowed (`try-droid-api-only.log`), Droid still got
  Factory's auth answer. So far Factory's API host is enough, and `app.factory.ai` may not be
  needed. That's only up to the key check, though; a full answer with a valid key still has to
  confirm it.
- **Seen in the CLI's strings, not needed so far:** `telemetry.factory.ai`, `downloads.factory.ai`
  (updates; npm builds don't auto-update), `relay.factory.ai`. With these blocked, `droid exec`
  didn't hang: `droid exec` took 7–11 s, mostly CLI start-up; Droid's own `duration_ms` was 0.2–3.8 s.

## Tradeoffs for the team (option A vs B)

- **Factory key in the sandbox.** Droid needs `FACTORY_API_KEY` in the sandbox, passed in the
  command's env here, or as a Daytona Secret (not tried; it would store the key in Daytona's org).
  With a sample in the same sandbox, a malicious sample could read the key and, with Factory
  reachable, use it. Option B keeps the key on the Mac.
- **Node.js in the image.** The default snapshot has it; `sandbox/Dockerfile` would need Node.js
  plus a pinned `droid` baked in, so the analysis sandbox would start with no install host.
- **Sample shares a machine with Droid.** The sample, Droid's process and its key share one
  container and one network path to Factory's API. Network off from creation (decision 28)
  becomes "Factory only" — an exfiltration path through Factory, and anything else Factory's hosts
  allow. Option B: the sample's sandbox has no network at all.
- **What A gains:** Droid's own shell and file tools work on the sample directly, instead of three
  fixed read-only tools, and no SDK/CLI protocol workaround is needed.

## Also found

- **`daytona.list()` is an async iterator** in `@daytona/sdk` 0.220.0. The Tier 3 probe
  (`../2026-10-17-1524-daytona-tier3-newkey/tier3.probe.mjs`) counted `r.items ?? []`, which is
  always 0, so its "0 left" wasn't really checked. Walking the iterator today found 0, so nothing
  leaked.
- A sandbox just deleted is still listed, as "started", for a second or two after
  `delete()` returns. Step 3's leak check now waits for it to go.

## Not verified

- Droid answering a prompt inside the sandbox (needs a valid Factory key).
- Droid's tools working inside the sandbox; Droid with a sample; a Daytona Secret for the key.
- Whether `domainAllowList` holds against DNS tunnelling or other non-HTTP(S) traffic (only HTTPS
  to hosts and one IP was probed).
- Option B (steps 1–2) on Tier 3: with this key both fail on the same 401, so this run does not re-confirm them.
