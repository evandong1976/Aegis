# Downloads (milestone 3, intake + sandbox half), end to end — 2026-10-17

Branch `feature/download`. The real app ran in a throwaway profile on bridge port 47398, with
`AEGIS_DOWNLOADS_DIR` pointing at a throwaway downloads folder (never the real `~/Downloads`) and
Daytona live from `.env.local` (`FACTORY_API_KEY` left empty: downloads don't use Droid yet, and the
start-up live test would spend Factory credits). The built extension, its bridge port rewritten to
47398, ran in a fresh headless Chrome 155 profile whose download folder was the same throwaway
folder. Each download was started by a real mouse click on `server.mjs`'s test page.

Re-run: `sh logs/2026-10-17-download-e2e/run.sh <empty-run-dir>` from the repo root. The files here
are from the last run, on `main` after merging `feature/download` with `feature/visualization`
(23:38 UTC): 26 / 26, 0 sandboxes left.

## What passed (26 / 26, `results.json`, `e2e.log`)

| Path | File | Result |
| --- | --- | --- |
| In memory, Content-Disposition | `aegis-terminal-demo.command` (the demo script) | Never in the folder; uploaded to a Daytona sandbox created with `networkBlockAll`, SHA-256 matched inside it, sandbox deleted; **Unknown, held** (no analyst yet) |
| In memory, plain document | `statement.pdf` | Cleared on this Mac, **never uploaded**, the exact bytes delivered into the folder (12 ms) |
| In memory, type lies | `photo.jpg` (a Mach-O header) | Never in the folder; hard rule "named .jpg but is really a Mac program" → **Malicious, quarantined**; also went to the sandbox |
| In memory, logged-in | `report.sh` behind a session cookie | Chrome's request and the offscreen refetch both carried the cookie (`site-requests.json`) |
| In memory, `data:` link | `hello.sh` (from the `download` attribute) | Named correctly, never in the folder, held |
| Fallback, one-time link | `invoice.pdf` (a sign-in page on the second fetch) | The refetch saw HTML instead of a PDF → Chrome downloaded it again (3 requests total) → the app took it the moment it finished, under the name the user expects; held |
| Fallback, `blob:` link | `notes.sh` | Chrome finished it, the app took it at once; held |
| `~/Downloads` watcher | `airdrop-tool.command` written by "another app" | Out of the folder and into quarantine ~3 s after it stopped changing; held |
| Watcher | `old-notes.txt`, older than the app, edited while it ran | Left alone |
| Quarantine | 7 held files | All `<name>.aegis`, mode 600, in the app's own folder (`quarantine-listing.txt`) |
| Sandboxes | 7 created | Each `network=off`, deleted; the Daytona org has **0** left (`leak-check.txt`) |

The app's Downloads screen and the script's Report are in `downloads.png` and `report.png`; the
scan log is `log.json`; every scan row with its report is `scan-rows.json`. No key from
`.env.local` appears anywhere in this folder (checked with `grep -Ff`).

## Bugs these runs found (all fixed on the branch)

1. **Pausing doesn't hold a small download.** Chrome finished a paused 4 KB download as soon as it
   settled the file name (`photo.jpg`: paused +7474 ms, named +7477, complete +7482), so it landed
   in the folder. Downloads are now held at `chrome.downloads.onDeterminingFilename`, which Chrome
   waits on before it writes the file under its name (PLAN.md decision 31).
2. **Our own fallback download was intercepted again.** `byExtensionId` was still unset when
   `onCreated` fired for the extension's own `download()`. Own downloads are now tracked by URL.
3. **The `download` attribute's name was lost** (`hello.sh` came through as `download`): the name
   isn't known at `onCreated`. It now comes from `onDeterminingFilename`.
4. **Chrome refuses `.aegis-quarantine/<name>.aegis`** (MEGA_PROMPT §5.1's fallback path): a path
   part starting with a dot is rejected, and `.aegis` is swapped for the MIME type's extension
   (`invoice.pdf.html`). The fallback now accepts Chrome's name and the expected name travels with
   the handover (decision 31).
5. **The Downloads screen's Kind column was empty**: the store's upsert never updated `file_kind`,
   size or hash after the first save (made before the pre-check).
6. Harness bug, not product: the first runs reused one Chrome profile, so Chrome kept the first
   build's service worker and two fixes looked like they failed.

## What "never on disk" means in practice

`downloads-folder-timeline.txt` records every name that appeared in the folder (polled every
15 ms). For each download, Chrome creates a hidden, randomly named temp file
(`.com.google.Chrome.XXXXXX`) **before any extension event fires**. The cancel deletes it, and the
file never appears under its own name. So in-memory downloads never exist on disk as a usable
file; a few milliseconds of partial bytes in a hidden temp file can't be avoided from an extension.
Fallback files (one-time links, `blob:`) do appear briefly under Chrome's name until the app moves
them out.

## Not verified

- A real Chrome profile with the extension loaded by hand, and real sites (Gmail attachments, Drive).
- Notifications (headless Chrome shows none; the calls are made).
- Files over 200 MB (the `too_large` path) and the "app not running" path (download let through,
  picked up by the watcher at the next start).
- Running the sample in the sandbox, `analyze.py`, Worker A/B: not built (the `analyze` hook in
  `scans.ts` is where Worker A plugs in).
- Report actions (Delete / Download anyway) are still disabled (decision 12, M8).
