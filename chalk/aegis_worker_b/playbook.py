"""The playbook: docs/file_types_vulnerabilities.md, read at runtime.

The md's table (file type → common vulnerabilities → methods to discover them) is the agent's
plan. This module parses it, finds the row(s) for a file from its name *and* its real type (the
md's own warning: an extension doesn't establish anything), and maps each row's "methods" to the
tools in sandbox_tools.py. Edit the md and the playbook changes with it; the method → tool map
below is the only part that lives in code.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATHS = [
    os.environ.get("AEGIS_PLAYBOOK", ""),
    "/opt/aegis/playbook.md",  # inside the Chalk images
    str(Path(__file__).resolve().parents[2] / "docs" / "file_types_vulnerabilities.md"),
]


@dataclass(frozen=True)
class Row:
    extensions: tuple[str, ...]
    vulnerabilities: str
    methods: str

    @property
    def label(self) -> str:
        return ", ".join(self.extensions)


@dataclass(frozen=True)
class ToolCall:
    tool: str
    args: tuple[str, ...] = ()


def load_path() -> str:
    for p in DEFAULT_PATHS:
        if p and Path(p).is_file():
            return p
    raise FileNotFoundError("file_types_vulnerabilities.md not found (set AEGIS_PLAYBOOK)")


def load_text() -> str:
    return Path(load_path()).read_text()


def parse(text: str) -> list[Row]:
    rows = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 3 or not cells[0].startswith("`"):
            continue
        exts = tuple(e.lower() for e in re.findall(r"`(\.[\w.]+)`", cells[0]))
        if exts:
            rows.append(Row(exts, cells[1], cells[2]))
    return rows


def rows() -> list[Row]:
    return parse(load_text())


def real_kind(head: bytes) -> str | None:
    """What the bytes say, regardless of the name."""
    if head[:4] == b"\x7fELF" or head[:2] == b"MZ" or head[:4] == b"\x00asm":
        return ".exe"
    if head[:4] in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf"):
        return ".exe"
    if head[:4] == b"PK\x03\x04":
        return ".zip"
    if head[:2] == b"\x1f\x8b":
        return ".gz"
    if head.lstrip()[:5] == b"%PDF-" or b"%PDF-" in head[:1024]:
        return ".pdf"
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return ".doc"
    if head[:2] == b"#!":
        return ".sh"
    if b"-----BEGIN" in head[:64]:
        return ".pem"
    return None


def rows_for(filename: str, head: bytes, table: list[Row] | None = None) -> list[Row]:
    """The playbook rows for this file: by its real type first, then by its name."""
    table = table if table is not None else rows()
    name = filename.lower()
    wanted: list[str] = []
    kind = real_kind(head)
    if kind:
        wanted.append(kind)
    ext = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    if name.startswith(".env") or name == ".env":
        wanted.append(".env")
    if ext in (".docm", ".xlsm", ".pptm", ".dotm"):
        wanted.append(".docx")
    if ext in (".tgz",) or name.endswith(".tar.gz"):
        wanted.append(".tar")
    if ext in (".command", ".zsh"):
        wanted.append(".sh")
    if ext in (".mjs", ".cjs", ".jsx", ".tsx"):
        wanted.append(".js")
    if ext:
        wanted.append(ext)
    out: list[Row] = []
    for w in wanted:
        for r in table:
            if w in r.extensions and r not in out:
                out.append(r)
    return out


def _lang(row: Row, filename: str) -> str | None:
    e = row.extensions
    if ".py" in e:
        return "python"
    if ".js" in e:
        return "javascript"
    if ".php" in e:
        return "php"
    if ".sql" in e:
        return "sql"
    if ".c" in e:
        return "c"
    if ".sh" in e:
        return "shell"
    return None


def tools_for(filename: str, head: bytes, table: list[Row] | None = None) -> list[ToolCall]:
    """The tools the playbook's methods call for, in order, always starting with identify."""
    calls = [ToolCall("identify")]
    matched = rows_for(filename, head, table)
    for row in matched:
        m = row.methods.lower()
        lang = _lang(row, filename)
        if lang:
            calls.append(ToolCall("code_patterns", (lang,)))
        if "shellcheck" in m:
            calls.append(ToolCall("shellcheck"))
        if "bandit" in m:
            calls.append(ToolCall("bandit"))
        if ".json" in row.extensions:
            calls.append(ToolCall("json_inspect"))
        if ".xml" in row.extensions:
            calls.append(ToolCall("xml_entities"))
        if ".svg" in row.extensions and filename.lower().endswith(".svg"):
            calls.append(ToolCall("svg_scripts"))
        if ".yaml" in row.extensions:
            calls.append(ToolCall("yaml_inspect"))
        if ".zip" in row.extensions:
            calls += [ToolCall("archive_listing"), ToolCall("archive_extract_test")]
        if ".pdf" in row.extensions:
            calls.append(ToolCall("pdf_actions"))
        if ".docx" in row.extensions:
            calls += [ToolCall("ooxml_inspect"), ToolCall("olevba")]
        if ".jpg" in row.extensions and not filename.lower().endswith(".svg"):
            calls.append(ToolCall("image_inspect"))
        if "secret scanning" in m or ".env" in row.extensions:
            calls.append(ToolCall("secret_scan"))
        if ".pem" in row.extensions:
            calls.append(ToolCall("key_inspect"))
        if ".exe" in row.extensions:
            calls += [ToolCall("binary_inspect"), ToolCall("strings_iocs")]
    if not matched:
        # Not in the playbook: read it and look for indicators.
        calls += [ToolCall("strings_iocs"), ToolCall("secret_scan")]
    seen: set[ToolCall] = set()
    return [c for c in calls if not (c in seen or seen.add(c))]


def describe(filename: str, head: bytes) -> str:
    """The playbook rows for this file, as text for the agent's prompt."""
    matched = rows_for(filename, head)
    if not matched:
        return "No row in the playbook matches this file. Identify it, look for indicators and secrets."
    return "\n".join(
        f"- Row {r.label}: common vulnerabilities: {r.vulnerabilities}. Methods: {r.methods}." for r in matched
    )
