# Droid tool lockdown — 2026-10-17 11:26 EDT

Branch `droid-tool-lockdown`. Worker A's lockdown rules moved out of `scripts/try-droid.mts` into
`src/main/droidLockdown.ts`, so the live check and (at milestone 4) `workerA.ts` share one tested
copy.

## What was shown

| Check | Result | Evidence |
| --- | --- | --- |
| Unit tests (`src/main/droidLockdown.test.ts`) | 15 new tests pass; 38 in total | `pnpm test` |
| The tests catch a weakened lockdown | Changing the permission handler's `every` to `some` fails 1 test; adding `curl` to a sandbox tool fails 2. Both changes were reverted. | run by hand during the session |
| `pnpm typecheck && pnpm lint` | Pass | — |
| `pnpm try:droid` with the shared module | Exit 0: 31 built-in tools off, `ToolSearch` the only exception; Droid made 3 tool calls into a network-off Daytona sandbox, reported the correct SHA-256, verdict `clean` for a line of harmless text; sandbox deleted | `try-droid.log` |
| Sandbox leak check | 0 sandboxes in the org afterwards | `leak-check.txt` |

## What the tests pin down

- The permission handler proceeds **once** only when every tool use in a request is an MCP tool
  from `aegis-sandbox`. It cancels shell commands, edits, new files, patches, MCP tools from any
  other server (including a look-alike name) or with no server, mixed batches, and empty requests.
- Every built-in tool is disabled; `ToolSearch` is the only allowed exception, and any other
  built-in tool left on is reported.
- The sandbox tools run only `ls`, `wc`, `sha256sum` and `head`, with no output redirection,
  command substitution, `;` or pipes, and touch only the `sample` folder.
- Every tool output starts with the UNTRUSTED fence and is capped at 8,192 characters.
- A sample that talks Droid into "clean" can't lower a Malicious verdict (`applyAiSuggestion`).

## Not verified

- A real prompt-injection sample run through Droid live (the unit test covers the verdict rule;
  the live run used harmless text only).
- How droid names MCP tool IDs beyond "starts with the server name" (the test fixtures assume a
  `aegis-sandbox___<tool>` form; the live run confirms the prefix rule works).
