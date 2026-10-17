# Sandbox image check — 2026-10-17 00:43 EDT, branch `sandbox-image`

A targeted check of `sandbox/Dockerfile` (milestone 0b), not a full `pnpm verify` run.

| Check                                                                        | Result                                                                                    | Evidence                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `docker build -t aegis-sandbox:dev sandbox/`                                 | Built: `linux/arm64`, 1.56 GB                                                             | `docker-build.log`, `image.txt` |
| capa rules download matches the pinned SHA-256                               | `capa-rules v9.4.0 unpacked to /opt/capa-rules`                                           | `docker-build.log`      |
| `selftest.py` with `--network none`                                          | 7 / 7 ok: every pinned package at its pinned version, tools, 1,045 capa rules, capa 9.4.0, libmagic, headless Chromium 153, uid 10001 | `selftest.log`          |
| `selftest.py` with the fallback's hardening (read-only, `--cap-drop ALL`, `no-new-privileges`, tmpfs for `/tmp`, `/out`, `/sample`) | 7 / 7 ok                                                                                  | `selftest-hardened.log` |

`docker-build.log` is the first, uncached build. The image was rebuilt from cache after
`selftest.py` started printing installed package versions (capstone 5.0.9's own `__version__` says
5.0.7). `image.txt` is that final image.

## Not verified

- A `linux/amd64` build, which is what Daytona runs. The Mac is Apple Silicon and the build ran
  natively. Build the snapshot with `--platform linux/amd64` at milestone 3.
- The Daytona snapshot itself (milestone 3, joint).
- Any analysis of a sample: `analyze.py` and the demo files don't exist yet.
