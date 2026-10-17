"""Checks that the sandbox image has every tool the analysis scripts rely on.

Run with the network off, the way analysis jobs run:
    docker run --rm --network none aegis-sandbox python /opt/aegis/selftest.py
Prints one line per check and exits 1 if any fails.
"""

import os
import shutil
import subprocess
import sys

results: list[tuple[str, bool, str]] = []


def check(name: str, fn) -> None:
    try:
        detail = fn() or ""
        results.append((name, True, str(detail)))
    except Exception as e:  # noqa: BLE001 - report every failure, keep going
        results.append((name, False, f"{type(e).__name__}: {e}"))


def imports() -> str:
    from importlib.metadata import version

    import capa.main  # noqa: F401
    import capstone  # noqa: F401
    import elftools  # noqa: F401
    import lief  # noqa: F401
    import magic  # noqa: F401
    import oletools.olevba  # noqa: F401
    import pefile  # noqa: F401
    import py7zr  # noqa: F401
    import yara  # noqa: F401

    # Installed package versions; some modules' own __version__ strings lag (capstone 5.0.9 says 5.0.7).
    names = ["capstone", "flare-capa", "lief", "oletools", "pefile", "playwright", "py7zr"]
    names += ["pyelftools", "python-magic", "yara-python"]
    return ", ".join(f"{n} {version(n)}" for n in names)


def binaries() -> str:
    missing = [b for b in ("7z", "cpio", "file", "strings", "objdump", "capa") if not shutil.which(b)]
    if missing:
        raise RuntimeError(f"missing: {', '.join(missing)}")
    return "7z, cpio, file, strings, objdump, capa"


def capa_rules() -> str:
    root = os.environ["CAPA_RULES"]
    n = sum(f.endswith(".yml") for _, _, files in os.walk(root) for f in files)
    if n < 500:
        raise RuntimeError(f"only {n} rules in {root}")
    return f"{n} rules"


def capa_cli() -> str:
    out = subprocess.run(["capa", "--version"], capture_output=True, text=True, timeout=60)
    return (out.stdout or out.stderr).strip()


def file_type() -> str:
    import magic

    return magic.from_buffer(b"%PDF-1.7\n", mime=True)


def chromium() -> str:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content("<title>aegis</title>")
        title = page.title()
        version = browser.version
        browser.close()
    if title != "aegis":
        raise RuntimeError(f"unexpected title {title!r}")
    return f"Chromium {version}"


def user() -> str:
    if os.geteuid() == 0:
        raise RuntimeError("running as root")
    return f"uid {os.geteuid()}"


for name, fn in [
    ("python modules", imports),
    ("command-line tools", binaries),
    ("capa rules", capa_rules),
    ("capa", capa_cli),
    ("libmagic", file_type),
    ("headless chromium", chromium),
    ("unprivileged user", user),
]:
    check(name, fn)

for name, ok, detail in results:
    print(f"{'ok  ' if ok else 'FAIL'} {name}: {detail}")
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
