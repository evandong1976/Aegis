# `pnpm try:sandbox`, live on Daytona, faster network check — 2026-10-17 12:38 EDT

Same run as `../2026-10-17-1229-sandbox-run/`, with the network check rewritten: all six probes
(2 hosts × curl, wget, python3) now run at once instead of one after another. Each still gets its
full limit, so it is just as strict. **All 7 checks pass; exit 0; 0 sandboxes left**
(`leak-check.txt`).

| Step                    | 12:29 run | This run | Result                                                       |
| ----------------------- | --------- | -------- | ------------------------------------------------------------ |
| Create, network off     | 0.8 s     | 5.0 s    | `networkBlockAll=true`, 1 attempt (Daytona's start time varies) |
| Upload + SHA-256 inside | 0.5 s     | 1.2 s    | `cfd92c5a…9053` matches                                      |
| **Network check**       | **36.2 s** | **8.1 s** | example.com and registry.npmjs.org: all blocked              |
| Run sample              | 25.2 s    | 24.2 s   | exit 0; 14 commands, LaunchAgent written, 2 blocked downloads |
| Delete                  | 0.3 s     | 0.3 s    | deleted                                                      |

**The check works both ways** (local Docker, `aegis-sandbox:dev`, same command): with
`--network none` it prints `BLOCKED`; with the network on it prints
`REACHED python3 https://example.com` and `REACHED python3 https://registry.npmjs.org/` (that image
has python3 but not curl or wget).

**Why 8 s and not 5:** on Daytona a blocked connection hangs rather than failing, and python3's
`timeout=5` doesn't cover the DNS lookup, so the 8 s `timeout` cap ends it.

**Where the rest of the time goes:** the sample's run is mostly its own two download attempts
waiting on a blocked network; that's the sample, not Aegis.
