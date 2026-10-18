# Analysis sandbox image

The image every sandbox job runs in, for both analysis workers (`docs/architectural.md` §3.6). It is
used two ways:

- **Daytona**: built into a snapshot so each job starts in seconds (milestone 3, `pnpm build:sandbox`).
- **Local Docker fallback**, when Daytona is down (milestone 8, MEGA_PROMPT §5.9). It runs with
  `--network none`, a read-only filesystem and all capabilities dropped.

Nothing from a sample is ever opened or run on the Mac.

## What's in it

| Layer          | Contents                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base           | `python:3.12.14-slim-bookworm`, pinned by digest                                                                                                                                          |
| Native tools   | `7z` (zip, xar/`.pkg`, most `.dmg`), `cpio` (`.pkg` payloads and install scripts), `file` and libmagic, `strings` and `objdump`                                                           |
| Python         | [`requirements.txt`](requirements.txt): oletools (Office macros), pefile, pyelftools and LIEF (PE/ELF/Mach-O), capstone (disassembly), capa, yara-python, py7zr, python-magic, Playwright |
| capa rules     | `/opt/capa-rules`, the release that matches capa (9.4.0), checked against a pinned SHA-256 by [`fetch_capa_rules.py`](fetch_capa_rules.py)                                                |
| Chromium       | Playwright's headless Chromium and its system libraries, for link detonation (milestone 7)                                                                                                |
| User & folders | Runs as `analyst` (uid 10001), not root. A job uploads the file to `/sample` and writes results to `/out`                                                                                 |

Every version is exact and was at least two weeks old when pinned.

## The inspector: `aegis_inspect.py`

The checks Droid runs on a caught file, one per row of
[`resources/droid/file_types_vulnerabilities.md`](../resources/droid/file_types_vulnerabilities.md)
(plus `identify`, `strings`, `secrets` and `capa`). Droid can only run them as fixed tools,
`python3 -I <folder>/aegis_inspect.py <check> sample/file` (`src/main/droidLockdown.ts`). Every
check reads the file and reports; none runs, extracts or changes it.

- **Standard library only**, so it works in Daytona's default image today. The app uploads it into
  each sandbox after the sample has run, into a fresh folder, and checks its SHA-256
  (`src/main/droidToolkit.ts`). It doesn't need to be in the image.
- **Uses the dedicated tool when the image has it** (Bandit, ShellCheck, flawfinder, cppcheck,
  olevba, capa, 7z, openssl) and says "not installed in this sandbox image" when it doesn't.
- **Output:** findings first for Droid (at most 7,000 characters), then one `AEGIS_RESULT {json}`
  line the app's rules read and Droid never sees. Secret values are masked.
- **Tests:** `src/main/inspector.test.ts` runs it on harmless files written by the test.

```bash
python3 -I sandbox/aegis_inspect.py pdf path/to/sample/file
```

## Not in it yet

- `entry.py`, `analyze.py` and `observe.py`: milestone 3, joint.
- `detonate.py`: milestone 7.
- `rules/*.yar`: milestone 3, with `analyze.py`.
- The Daytona snapshot and `pnpm build:sandbox`: milestone 3. The script still exits 1 with "not
  implemented yet".
- The test files in `demo/` (milestone 0b): Zach writes these by hand.

## Build and check

```bash
docker build -t aegis-sandbox sandbox/
```

```bash
docker run --rm --network none aegis-sandbox python /opt/aegis/selftest.py
```

The same check passes with the flags the Docker fallback will use (MEGA_PROMPT §5.9):

```bash
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp --tmpfs /out --tmpfs /sample aegis-sandbox python /opt/aegis/selftest.py
```

[`selftest.py`](selftest.py) checks that the Python modules import, the command-line tools and capa
rules are present, capa runs, libmagic identifies a file, headless Chromium starts and renders a
page, and the image isn't running as root. It prints one line per check and exits 1 if any fails.

Daytona runs `linux/amd64`. On an Apple Silicon Mac a plain `docker build` produces `arm64`, which
is right for the local fallback. Build the Daytona snapshot with `--platform linux/amd64`.
