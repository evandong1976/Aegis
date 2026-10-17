# Droid inside a Daytona sandbox (option A) on Tier 3 — 2026-10-17 15:36–15:53 EDT

Evidence for the team's call on PLAN.md decision 19 (option A vs B) now that the org is on Tier 3
(decision 28). The plan and Worker A's design are unchanged. Branch off `feature/sandbox`
(`a7505e1`), plus the step 3 change to `scripts/try-droid.mts`.

**Result: option A works.** `AEGIS_TRY_DROID_INSIDE=1 pnpm try:droid` passes all three steps
(exit 0, `try-droid.log`). Inside a sandbox whose network allows only `api.factory.ai` and
`prem.factory.ai`, `droid exec` installs and answers ("This check worked.") in 5.5 s. Anything
outside the list is unreachable, and the org has 0 sandboxes left.

## What ran

`AEGIS_TRY_DROID_INSIDE=1 pnpm try:droid`, run as the equivalent `node` command with the main
checkout's `.env` (this worktree has none), and with `DROID_PATH` set to `droid@0.238.0` from npm,
installed in a scratch folder (this Mac had no droid CLI). Keys are scrubbed from every file here
(checked).

| File                                    | What                                                                                     | Exit |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| `try-droid.log`                         | **Run of record**: new key, final script, Factory hosts `api.factory.ai,prem.factory.ai` | 0    |
| `try-droid-newkey.log`                  | New key, Factory hosts `app.factory.ai,api.factory.ai`: steps 1–2 pass; inside gets 403  | 1    |
| `diagnose-403.probe.mjs` / `.json`      | Same 403 with droid 0.232.0 and 0.238.0; droid's logs: `CloudSyncService` session create | —    |
| `diagnose-403-urls.probe.mjs` / `.json` | `factory.ai,*.factory.ai` allowed: droid answers; example.com still blocked              | —    |
| `diagnose-hosts.probe.mjs` / `.json`    | Adding relay or telemetry alone doesn't fix it; Daytona's allow-list is a proxy (below)  | —    |
| `diagnose-proxy.probe.mjs` / `.json`    | A logging proxy shows the hosts droid uses; direct (no-proxy) traffic is blocked         | —    |
| `diagnose-dns.probe.mjs` / `.json`      | `api` + `prem` alone are enough; raw DNS to public resolvers gets NXDOMAIN, not answers  | —    |
| `try-droid-{1-first,2,3-oldkey,api-only}.log` | Earlier, with the old Factory key (401 "appears to be invalid"; rotated since)     | 1    |

Before these, a throwaway `networkBlockAll` sandbox (deleted) showed the default snapshot has
**Node.js v25.9.0 and npm 11.12.1** (Debian 13, x86_64, user `daytona`). `sandbox/Dockerfile`,
Aegis's analysis image, has neither.

## Step 3 now (option A)

1. Create with `domainAllowList: 'api.factory.ai,prem.factory.ai,registry.npmjs.org'`, ephemeral,
   `ttlMinutes: 30`. It refuses a sandbox that comes back without the list. Never open internet,
   and it never holds a sample.
2. `npm install -g droid@0.232.0`.
3. `updateNetworkSettings({ domainAllowList: 'api.factory.ai,prem.factory.ai' })`: narrows only
   (drops npm), so it matches what a prebuilt option A image would run with.
4. Probe from inside with curl: both Factory hosts, `example.com`, `registry.npmjs.org`,
   `telemetry.factory.ai`, and `1.1.1.1` by IP.
5. `droid exec --output-format json "<one-sentence prompt>"` with `FACTORY_API_KEY` in the
   command's env.
6. Delete in `finally`, then walk `daytona.list()` until the org has 0 sandboxes (up to 20 s).

## Results (`try-droid.log`)

| Check                              | Result                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Step 1: `run()` on the Mac         | ok, 6.6 s                                                                                                    |
| Step 2: option B, as chosen        | ok: 3 sandbox tool calls, SHA-256 matches, verdict clean, 8.6 s                                              |
| Sandbox with the allow-list        | Accepted, 0.9 s; the sandbox reports `api.factory.ai,prem.factory.ai,registry.npmjs.org`                     |
| droid installs                     | **Yes**: `npm install -g droid@0.232.0` exit 0 in 7.9 s (7.9–22 s across runs)                               |
| Allow-list holds (after narrowing) | `api.factory.ai` 200, `prem.factory.ai` 401 (reached; `/` needs auth); `example.com`, `registry.npmjs.org`, `telemetry.factory.ai`, `1.1.1.1` **unreachable** |
| droid answers                      | **Yes**: exit 0 in 5.5 s, `"result":"This check worked."` (Droid's own `duration_ms` 2170; 5.5–8 s across runs) |
| Sandboxes left                     | **0** (2.1 s after the delete)                                                                               |
| Whole run                          | 42 s wall clock for all three steps                                                                          |

## Hosts Droid needed

- **Install:** `registry.npmjs.org` only. `droid` pulls its binary from the optional dependency
  `@factory/cli-linux-x64`, and `install.js` falls back to the same registry (checked by reading the
  package, not running it on the Mac).
- **Run:** **`api.factory.ai`** (auth and model calls) and **`prem.factory.ai`** (session sync).
  Through a logging proxy in front of Daytona's (`diagnose-proxy.json`), one `droid exec` made 2
  connections to `api`, 8 to `prem` and 1 to `telemetry`.
  - `telemetry.factory.ai` is optional: with it blocked, droid logs a warning and carries on.
  - `app.factory.ai` isn't used.
  - Without `prem.factory.ai`, session create gets 403 and `droid exec` fails with
    "403 status code (no body)". Droid 0.232.0 and 0.238.0 behave the same.
- That 403 comes from Daytona, not Factory: Daytona's allow-list proxy refuses the CONNECT.

## How Daytona enforces `domainAllowList` (seen from inside)

- It sets `HTTP(S)_PROXY=http://172.20.0.1:18080`, a proxy that answers `403` to CONNECT for
  unlisted hosts and `200` for listed ones.
- **It isn't only the proxy:**
  - Direct connections that ignore it (`curl --noproxy '*'` to `example.com`, `1.1.1.1` and even
    `api.factory.ai`; Node's `fetch`, which ignores proxy env) all fail.
  - The resolver has no answer for `example.com`.
  - Raw UDP DNS queries to 8.8.8.8, 1.1.1.1 and 9.9.9.9 get a reply that looks as if it comes from
    each server, but it's always NXDOMAIN with no answers, so something on the path is intercepting
    and refusing them.
  - With `networkBlockAll`, the same DNS queries get no reply at all.
- Not tested: whether those intercepted DNS queries are forwarded upstream (a DNS tunnel would need
  that), and non-HTTP protocols to the allowed hosts' IPs.

## Tradeoffs for the team (option A vs B)

- **Factory key in the sandbox.** Droid needs `FACTORY_API_KEY` in the sandbox: passed in the
  command's env here, or as a Daytona Secret (not tried; that would store the key in Daytona's
  org). With a sample in the same sandbox, a malicious sample could read the key, and since Factory
  stays reachable it could use it, or send data to Factory's hosts. Option B keeps the key on the
  Mac.
- **Node.js in the image.** The default snapshot has it; `sandbox/Dockerfile` would need Node.js
  plus a pinned `droid` baked in, so the analysis sandbox would start with no install host.
- **Sample shares a machine with Droid.** The sample, Droid's process and its key share one
  container and one network path to `api` and `prem.factory.ai`. "Network off from creation"
  (decision 28) becomes "Factory only".
- **Credits:** each `droid exec` here used about 5,500–6,700 Factory credits for one sentence.
- **What A gains:** Droid's own shell and file tools on the sample directly, instead of three
  fixed read-only tools, and no SDK/CLI protocol workaround.

## Also found

- **`daytona.list()` is an async iterator** in `@daytona/sdk` 0.220.0. The Tier 3 probe
  (`../2026-10-17-1524-daytona-tier3-newkey/tier3.probe.mjs`) counted `r.items ?? []`, which is
  always 0, so its "0 left" wasn't really checked. Walking the iterator after every run here found
  0, so nothing leaked.
- A sandbox just deleted is still listed, as "started", for a second or two after `delete()`
  returns. Step 3's leak check waits for it to go.
- The first Factory key was rejected (401); it had been pasted in chat and was rotated. The new one
  works.

## Not verified

- Droid using its tools on a file inside the sandbox; Droid with a real sample; a Daytona Secret
  for the key.
- Whether intercepted DNS queries reach the internet (DNS tunnelling), and non-HTTP(S) traffic to
  the allowed hosts.
- A prebuilt image with `droid` baked in (here it was installed at run time with npm allowed, then
  the list was narrowed).
