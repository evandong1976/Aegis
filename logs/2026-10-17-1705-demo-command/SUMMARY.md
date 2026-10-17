# Demo `.command` file — 2026-10-17 17:05 EDT

`demo/ZoomUpdate.command`, served zipped by `pnpm demo:serve` (demo only, not for production).

| Check | Result |
| --- | --- |
| Demo page | Renders at `http://127.0.0.1:8787` (browser pane) |
| Download | `/download/ZoomUpdate.zip`: `application/zip`, `attachment; filename="ZoomUpdate.zip"` |
| Zip contents | One entry, `ZoomUpdate.command`, mode `-rwxr-xr-x` kept (`zipinfo.txt`); unzips at the top level |
| What the file does | Run in the hardened local Docker sandbox (`aegis-sandbox:dev`, `--network none --read-only --cap-drop ALL`): exit 0, no output, no commands, no files written, no network attempts (`sandbox-observation.json`) |

**Not verified here:** double-clicking it on a Mac. That opens Terminal on whoever's screen runs it,
so it was left for the person giving the demo (demo/README.md). Gatekeeper will block it the first
time because it's downloaded and unsigned.
