# Daytona Tier 3 check — 2026-10-17 15:24 EDT

`tier3.probe.mjs` (in this folder) with Zach's key from the Tier 3 org (in `.env`), `@daytona/sdk`
0.220.0, default snapshot. Three throwaway sandboxes, one at a time, each deleted in a `finally`;
**0 left** in the org afterwards. Results in `tier3.json`.

| Trial                                           | Result                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Default (no network setting)                 | **Open internet**: example.com, registry.npmjs.org, app/api.factory.ai all 200  |
| 1b. `updateNetworkSettings({ networkBlockAll })` | **Accepted**; afterwards all four hosts unreachable                             |
| 2. `domainAllowList` = Factory's hosts, at create | **Accepted**: Factory 200; example.com and npm unreachable                      |
| 3. `networkBlockAll: true` at create            | All four hosts unreachable                                                      |

Every setting the Tier 1/2 org refused is now accepted. The same probe with the earlier key, seven
minutes before, still showed Tier 1/2: `../2026-10-17-1517-daytona-tier3/`. What it means for the
plan: PLAN.md decision 28.
