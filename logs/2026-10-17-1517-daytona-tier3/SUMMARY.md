# Daytona tier check with the earlier key — 2026-10-17 15:17 EDT

Same probe as `../2026-10-17-1524-daytona-tier3-newkey/`, run with the key then in `.env`. That
key's org was **still on Tier 1/2**: the default sandbox reached only npm, `updateNetworkSettings`
and `domainAllowList` were refused, `networkBlockAll` at creation blocked everything. 0 sandboxes
left. Seven minutes later a key from the Tier 3 org passed (`../2026-10-17-1524-daytona-tier3-newkey/`).
