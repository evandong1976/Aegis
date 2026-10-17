# Link checks (milestone 2), end to end — 2026-10-17

Branch `link-checks`. The real app ran in a throwaway profile on port 47397 (`AEGIS_USER_DATA`,
`AEGIS_BRIDGE_PORT`), with the keys in `.env.local` (Safe Browsing live). The built extension, with
its bridge port rewritten to 47397, ran in a headless Chrome 155 (loaded through DevTools'
`Extensions.loadUnpacked`, since branded Chrome dropped `--load-extension`) against
`test-page.html`, served from `127.0.0.1:8765`. No link was opened to judge it; the one
URLhaus-listed URL on the page was never clicked.

## What passed

| Check | Evidence |
| --- | --- |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` (106 tests: 28 link-rule, 21 service/lookup) | run before commit |
| Bridge answers `/page` with a verdict per link in ~0.6 s, all six checks live: Tier 1, Safe Browsing, threat feeds (URLhaus 27,758 URLs, OpenPhish 300), RDAP, DNS, certificate logs | `bridge-page-response.json`, `app-log.json` |
| Verdicts: demo phish Malicious; Safe Browsing's test URL Malicious (live match); a URLhaus-listed URL Malicious; text/destination mismatch Suspicious; short link Unknown; `google.com/url?q=` wrapper judged by its destination; `data:` page Suspicious; `javascript:void(0)` ignored; clean GitHub link Clean | `bridge-page-response.json` |
| Browser, 26 / 26 checks: outlines (red dashed, amber dotted), a link added after load gets a verdict, hover note, guard on a malicious click with "link said / goes to" and the session token stripped, no **Inspect in sandbox**, Back to safety stays on the page, short-link guard without **Trust this site**, clean link opens normally, **Continue anyway** opens the link, **Trust this site** opens it and the site is no longer outlined | `screens/results.json`, `screens/1-…4-*.png`, `e2e.mjs` |
| Every click is recorded once and updated when the user decides; stored URLs are stripped; the verdict the user saw is kept after trusting | `recorded-clicks.txt` |
| App: Links screen counts (checked, blocked, median verdict time), panel "This page" counts and top link, Report with every reason and the six checks in words | `screens/app-links.png`, `screens/app-panel.png`, `screens/app-report.png` |
| New bridge checks: `/page` 200 / bad body 400 / web-page Origin 403; `/click` bad id 400; `/trust bit.ly` 400; `/trust shop.example.co.uk` stores `example.co.uk` | run by hand against the app; added to `scripts/verify.sh` |

## Bugs this run found (all fixed on the branch)

1. Guard and hover-note CSS didn't load on pages: `ds/` is web-accessible only at its dynamic URL, which `chrome.runtime.getURL('')` + path doesn't give. Now each file goes through `getURL(path)`.
2. github.com came out Suspicious: URLhaus lists malware *hosted on* GitHub. A host-level feed listing no longer counts for known domains.
3. "update.sh" was read as a domain (`.sh` is a TLD), giving a false text mismatch. File-like TLDs need a URL form.
4. A brand-new domain plus its brand-new certificate scored Suspicious: one fact counted twice. Certificate age now only stands in for a missing registration date.
5. Trusting a site rewrote that click's record as Clean. The record keeps the verdict the user saw.

## Not verified

- A real Chrome profile and real Gmail / Outlook pages (only the local test page, headless).
- Pages inside iframes (the content script runs in the top frame only).
- Behaviour under heavy pages (thousands of links) beyond the 2,000-link batch limit.
- The Daylight (light) theme of the guard.
