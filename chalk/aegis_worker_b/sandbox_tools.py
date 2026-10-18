"""Worker B's analysis tools. This file is baked into the Chalk sandbox image and runs there, with
the network off, against the one sample at /sample/file. It never executes the sample.

Each tool is one "method to discover them" from docs/file_types_vulnerabilities.md, turned into a
fixed command: `python3 sandbox_tools.py <tool> <path>` prints one JSON object. The agent picks
tools; it can't type commands. Output is capped, and every finding carries the line (or member,
or offset) it came from, so the report can show the evidence.

Standard library only, plus the CLI tools the image installs (file, shellcheck, bandit, olevba,
readelf, objdump, openssl). Python 3.11+.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import Any, Callable

MAX_READ = 2 * 1024 * 1024  # bytes of the sample any text tool reads
MAX_FINDINGS = 40
MAX_LINE = 240


# ── helpers ─────────────────────────────────────────────────────────────────────────────────────


def _read(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read(MAX_READ)


def _text(path: str) -> str:
    return _read(path).decode("utf-8", errors="replace")


def _finding(rule: str, severity: str, detail: str, line: int | None = None, code: str = "", **extra: Any) -> dict:
    f = {"rule": rule, "severity": severity, "detail": detail}
    if line is not None:
        f["line"] = line
    if code:
        f["code"] = code.strip()[:MAX_LINE]
    f.update(extra)
    return f


def _scan_lines(text: str, rules: list[tuple[str, str, str, str]]) -> list[dict]:
    """rules: (rule id, severity, regex, explanation). One finding per matching line per rule."""
    out: list[dict] = []
    compiled = [(r, s, re.compile(p, re.I), d) for r, s, p, d in rules]
    for n, line in enumerate(text.splitlines(), 1):
        for rule, sev, rx, detail in compiled:
            if rx.search(line):
                out.append(_finding(rule, sev, detail, n, line))
                if len(out) >= MAX_FINDINGS:
                    return out
    return out


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    if not shutil.which(cmd[0]):
        return 127, "", f"{cmd[0]} is not installed in this sandbox"
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout[:60_000], p.stderr[:4000]
    except subprocess.TimeoutExpired:
        return 124, "", f"{cmd[0]} ran out of time ({timeout} s)"


# ── generic ─────────────────────────────────────────────────────────────────────────────────────


def identify(path: str) -> dict:
    """What the file really is: size, SHA-256, magic bytes, `file`'s answer."""
    data = Path(path).read_bytes()
    _, out, _ = _run(["file", "-b", path])
    return {
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "magic_hex": data[:16].hex(),
        "file": out.strip() or "unknown",
    }


def read_lines(path: str, start: int = 1, count: int = 80) -> dict:
    """A window of the file as numbered text lines (the agent quotes evidence from here)."""
    start, count = max(1, int(start)), max(1, min(int(count), 200))
    lines = _text(path).splitlines()
    window = lines[start - 1 : start - 1 + count]
    return {
        "total_lines": len(lines),
        "lines": [{"line": start + i, "text": t[:MAX_LINE]} for i, t in enumerate(window)],
    }


URL_RX = re.compile(rb"(?:https?|ftp)://[\x21-\x7e]{4,200}")
IP_RX = re.compile(rb"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def strings_iocs(path: str) -> dict:
    """Printable strings that look like indicators: URLs, IPs, shell and registry fragments."""
    data = _read(path)
    interesting = re.compile(
        rb"(cmd\.exe|powershell|/bin/sh|bash -c|curl |wget |HKEY_|CurrentVersion\\Run|LaunchAgents|"
        rb"keychain|wallet|\.onion|base64)",
        re.I,
    )
    strings = re.findall(rb"[\x20-\x7e]{6,}", data)
    hits = [s.decode()[:MAX_LINE] for s in strings if interesting.search(s)][:MAX_FINDINGS]
    return {
        "urls": sorted({u.decode()[:MAX_LINE] for u in URL_RX.findall(data)})[:40],
        "ips": sorted({i.decode() for i in IP_RX.findall(data)})[:40],
        "suspicious_strings": hits,
        "string_count": len(strings),
    }


# ── source code (.c .py .js .php .sql .sh .ps1) ─────────────────────────────────────────────────

C_RULES = [
    ("c_unbounded_copy", "high", r"\b(strcpy|strcat|sprintf|vsprintf|gets)\s*\(", "unbounded copy: classic buffer overflow"),
    ("c_scanf_s", "medium", r"\bscanf\s*\([^)]*%s", "scanf %s with no width: buffer overflow"),
    ("c_memcpy_len", "medium", r"\bmem(cpy|move)\s*\([^)]*(len|size|n)\b", "memcpy with a computed length: check the bound"),
    ("c_alloc_mul", "medium", r"\bmalloc\s*\([^)]*\*", "malloc(a * b): integer overflow risk"),
    ("c_free", "low", r"\bfree\s*\(", "free(): check for use-after-free / double free"),
    ("c_system", "high", r"\b(system|popen|execl|execv)\s*\(", "runs a shell command"),
]

PY_RULES = [
    ("py_shell", "high", r"\b(os\.system|os\.popen|subprocess\.\w+\([^)]*shell\s*=\s*True)", "command injection: shell command"),
    ("py_eval", "high", r"\b(eval|exec)\s*\(", "eval/exec of a string"),
    ("py_pickle", "high", r"\b(pickle|cPickle|dill|marshal)\.loads?\s*\(", "unsafe deserialization"),
    ("py_yaml_load", "high", r"\byaml\.load\s*\((?![^)]*SafeLoader)", "yaml.load without SafeLoader: unsafe deserialization"),
    ("py_input_to_path", "medium", r"open\s*\([^)]*(input\(|request\.|argv)", "path from user input: path traversal"),
    ("py_download_exec", "high", r"(urlopen|requests\.get)\(.*\)\.(read|content|text).*exec", "downloads and runs code"),
]

JS_RULES = [
    ("js_eval", "high", r"\b(eval|new Function|setTimeout\s*\(\s*['\"])", "eval of a string"),
    ("js_xss_sink", "high", r"\.(innerHTML|outerHTML)\s*=|document\.write\s*\(|insertAdjacentHTML", "XSS sink"),
    ("js_child_process", "high", r"child_process|\bexecSync\s*\(|\bspawn\s*\(", "runs a shell command"),
    ("js_proto", "high", r"__proto__|constructor\s*\[\s*['\"]prototype|Object\.prototype\[", "prototype pollution"),
    ("js_merge_untrusted", "medium", r"(Object\.assign|_\.merge|\$\.extend)\s*\(\s*\{\s*\}\s*,\s*(req\.|JSON\.parse)", "merging untrusted input: prototype pollution"),
    ("js_wscript", "high", r"WScript\.Shell|ActiveXObject|\.Run\s*\(", "Windows Script Host: runs programs"),
]

PHP_RULES = [
    ("php_sqli", "high", r"(mysql_query|mysqli_query|->query)\s*\([^)]*\$_(GET|POST|REQUEST|COOKIE)", "SQL injection: request data in a query"),
    ("php_include", "high", r"\b(include|require)(_once)?\s*\(?\s*\$_(GET|POST|REQUEST)", "file inclusion from request data"),
    ("php_exec", "high", r"\b(system|exec|shell_exec|passthru|popen|proc_open)\s*\(", "runs a shell command"),
    ("php_eval", "high", r"\b(eval|assert|create_function)\s*\(|preg_replace\s*\([^)]*/e['\"]", "eval of a string"),
    ("php_unserialize", "high", r"\bunserialize\s*\(\s*\$_", "unsafe deserialization of request data"),
]

SQL_RULES = [
    ("sql_grant_all", "high", r"\bGRANT\s+ALL\b|\bWITH\s+GRANT\s+OPTION\b|\bSUPERUSER\b", "excessive permissions"),
    ("sql_dynamic", "high", r"\b(EXEC|EXECUTE)\s*\(?\s*@|\bEXECUTE\s+IMMEDIATE\b|\|\|\s*'|'\s*\+\s*@", "dynamic SQL built from strings: injection"),
    ("sql_destructive", "medium", r"\b(DROP\s+(TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM\s+\w+\s*;)", "destructive statement"),
    ("sql_xp_cmdshell", "high", r"xp_cmdshell|COPY\s+.*\s+FROM\s+PROGRAM|LOAD_FILE\s*\(|INTO\s+OUTFILE", "runs commands or touches files from SQL"),
]

SH_RULES = [
    ("sh_pipe_to_shell", "high", r"(curl|wget)[^|;]*\|\s*(sudo\s+)?(ba|z)?sh\b", "downloads and runs a script (curl | sh)"),
    ("sh_b64_exec", "high", r"base64\s+(-d|--decode)[^|]*\|\s*(ba)?sh|eval\s+\"?\$\(", "decodes and runs hidden code"),
    ("sh_world_writable", "medium", r"chmod\s+(-R\s+)?(777|666|a\+w|o\+w)", "world-writable permissions"),
    ("sh_tmp_predictable", "medium", r"(>|cp|mv|cat)\s+/tmp/[A-Za-z0-9_.-]+\b(?!.*mktemp)", "predictable file in /tmp (use mktemp)"),
    ("sh_unquoted_eval", "medium", r"\beval\s+[^\"']*\$", "eval of a variable: command injection"),
    ("sh_persistence", "high", r"LaunchAgents|LaunchDaemons|crontab|/etc/rc\.local|\.bashrc|\.zshrc|systemctl\s+enable", "installs itself to run again"),
    ("sh_credentials", "high", r"security\s+find-(generic|internet)-password|Login Data|Cookies|keychain|\.ssh/id_", "reads saved passwords, cookies or keys"),
    ("sh_destructive", "high", r"rm\s+-rf\s+(/|~|\$HOME|\$1|\"\$)", "deletes files"),
    ("ps_iex", "high", r"Invoke-Expression|\bIEX\b|DownloadString|DownloadFile|-EncodedCommand|-enc\s|FromBase64String", "PowerShell download / hidden code execution"),
    ("ps_bypass", "medium", r"-ExecutionPolicy\s+Bypass|Set-MpPreference|-WindowStyle\s+Hidden", "turns off protections or hides the window"),
]


def code_patterns(path: str, language: str) -> dict:
    """Dangerous calls for one language, with line numbers (code review, as the playbook says)."""
    rules = {"c": C_RULES, "python": PY_RULES, "javascript": JS_RULES, "php": PHP_RULES, "sql": SQL_RULES, "shell": SH_RULES}
    if language not in rules:
        return {"error": f"unknown language {language!r}; one of {sorted(rules)}"}
    return {"language": language, "findings": _scan_lines(_text(path), rules[language])}


def shellcheck(path: str) -> dict:
    code, out, err = _run(["shellcheck", "-f", "json", "-s", "bash", path])
    if code == 127:
        return {"error": err}
    try:
        items = json.loads(out or "[]")
    except json.JSONDecodeError:
        return {"error": (err or out)[:500]}
    return {
        "findings": [
            _finding(f"SC{i['code']}", {"error": "high", "warning": "medium"}.get(i["level"], "low"), i["message"], i["line"])
            for i in items[:MAX_FINDINGS]
        ]
    }


def bandit(path: str) -> dict:
    # Bandit only reads .py files; give it a copy with that name.
    copy = "/tmp/aegis-bandit-sample.py"
    shutil.copyfile(path, copy)
    code, out, err = _run(["bandit", "-f", "json", "-q", copy])
    if code == 127:
        return {"error": err}
    try:
        res = json.loads(out)["results"]
    except (json.JSONDecodeError, KeyError):
        return {"error": (err or out)[:500]}
    return {
        "findings": [
            _finding(r["test_id"], r["issue_severity"].lower(), r["issue_text"], r["line_number"], r.get("code", ""))
            for r in res[:MAX_FINDINGS]
        ]
    }


# ── data formats (.json .xml .svg .yaml) ────────────────────────────────────────────────────────


def json_inspect(path: str) -> dict:
    """Parser review: does it parse, how deep, and keys that ask a deserializer to do something."""
    text = _text(path)
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        return {"parses": False, "error": str(e)}
    risky = {
        "__proto__": "prototype pollution key",
        "constructor": "prototype pollution key",
        "$type": "Json.NET type hint: unsafe deserialization",
        "@type": "Fastjson / Jackson type hint: unsafe deserialization",
        "py/object": "jsonpickle object: unsafe deserialization",
        "py/reduce": "jsonpickle reduce: runs code when loaded",
        "isAdmin": "privilege field: mass assignment if trusted",
        "is_admin": "privilege field: mass assignment if trusted",
        "role": "privilege field: mass assignment if trusted",
        "roles": "privilege field: mass assignment if trusted",
        "permissions": "privilege field: mass assignment if trusted",
    }
    found: list[dict] = []
    max_depth = 0

    def walk(node: Any, depth: int, where: str) -> None:
        nonlocal max_depth
        max_depth = max(max_depth, depth)
        if isinstance(node, dict):
            for k, v in node.items():
                if k in risky and len(found) < MAX_FINDINGS:
                    found.append(_finding("json_key", "medium" if "privilege" in risky[k] else "high", risky[k], key=k, at=f"{where}.{k}"))
                walk(v, depth + 1, f"{where}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node[:1000]):
                walk(v, depth + 1, f"{where}[{i}]")

    walk(doc, 0, "$")
    if max_depth > 64:
        found.append(_finding("json_depth", "medium", f"nested {max_depth} levels deep: can exhaust a recursive parser"))
    for n, line in enumerate(text.splitlines(), 1):
        if "key" in line.lower() and re.search(r"(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36})", line):
            found.append(_finding("json_secret", "high", "credential in the document", n, line))
    return {"parses": True, "depth": max_depth, "top_level": type(doc).__name__, "findings": found}


def xml_entities(path: str) -> dict:
    """XXE and entity expansion, read from the text. Never resolves an entity or fetches anything."""
    text = _text(path)
    findings: list[dict] = []
    for n, line in enumerate(text.splitlines(), 1):
        if re.search(r"<!ENTITY[^>]+(SYSTEM|PUBLIC)", line, re.I):
            findings.append(_finding("xxe_external_entity", "high", "external entity: XXE (reads files or URLs when parsed)", n, line))
        elif re.search(r"<!ENTITY\s+%", line, re.I):
            findings.append(_finding("xxe_parameter_entity", "high", "parameter entity: out-of-band XXE", n, line))
        elif re.search(r"<!ENTITY", line, re.I):
            findings.append(_finding("xml_entity", "low", "internal entity", n, line))
        if re.search(r"<xi:include|xmlns:xi=|<!DOCTYPE[^>]+SYSTEM", line, re.I):
            findings.append(_finding("xml_external_resource", "medium", "external resource resolution (XInclude / external DTD)", n, line))
    entities = len(re.findall(r"<!ENTITY", text, re.I))
    refs = len(re.findall(r"&[A-Za-z_][\w.-]*;", text))
    if entities >= 5 and refs >= entities * 5:
        findings.append(_finding("xml_entity_expansion", "high", f"{entities} entities referenced {refs} times: entity expansion (billion laughs)"))
    return {"has_doctype": "<!DOCTYPE" in text.upper(), "entities": entities, "findings": findings[:MAX_FINDINGS]}


def svg_scripts(path: str) -> dict:
    """SVG script injection: scripts, event handlers, javascript: links, embedded HTML."""
    rules = [
        ("svg_script", "high", r"<script\b", "script in an SVG: runs when opened in a browser"),
        ("svg_event_handler", "high", r"\son[a-z]+\s*=", "event handler attribute: script injection"),
        ("svg_js_href", "high", r"(xlink:)?href\s*=\s*['\"]\s*javascript:", "javascript: link"),
        ("svg_foreign_object", "medium", r"<foreignObject\b", "embedded HTML (foreignObject)"),
        ("svg_external_ref", "medium", r"(xlink:)?href\s*=\s*['\"]\s*(https?:|data:text/html)", "external or HTML resource"),
    ]
    return {"findings": _scan_lines(_text(path), rules)} | {k: v for k, v in xml_entities(path).items() if k != "findings"}


def yaml_inspect(path: str) -> dict:
    """Unsafe tags, risky CI/CD settings and secrets in YAML (configuration scanning)."""
    rules = [
        ("yaml_python_tag", "high", r"!!python/(object|apply|name|module)|!ruby/object|!!javax|tag:yaml\.org,2002:python", "unsafe deserialization tag: runs code when loaded"),
        ("ci_pull_request_target", "high", r"pull_request_target", "pull_request_target: untrusted PRs run with secrets"),
        ("ci_script_injection", "high", r"\$\{\{\s*github\.event\.(issue|pull_request|comment|head_commit)\.[\w.]*(title|body|message|ref)", "untrusted event text in a run step: script injection"),
        ("ci_pipe_to_shell", "high", r"(curl|wget)[^|]*\|\s*(ba)?sh", "downloads and runs a script"),
        ("ci_write_all", "medium", r"permissions:\s*write-all|contents:\s*write", "broad token permissions"),
        ("ci_unpinned_action", "low", r"uses:\s*[\w-]+/[\w-]+@(main|master|v\d+)\s*$", "action not pinned to a commit"),
    ]
    out = _scan_lines(_text(path), rules)
    out += secret_scan(path)["findings"]
    return {"findings": out[:MAX_FINDINGS]}


# ── archives (.zip .tar .gz) ────────────────────────────────────────────────────────────────────

MAX_MEMBERS = 2000


def _bad_member(name: str) -> str | None:
    n = name.replace("\\", "/")
    if n.startswith("/") or re.match(r"^[A-Za-z]:", n):
        return "absolute path"
    if ".." in n.split("/"):
        return "path traversal (../)"
    return None


def archive_listing(path: str) -> dict:
    """Every member's path, size and type without extracting: Zip Slip, symlinks, bombs."""
    members: list[dict] = []
    findings: list[dict] = []
    packed = os.path.getsize(path)
    total = 0
    try:
        if zipfile.is_zipfile(path):
            kind = "zip"
            with zipfile.ZipFile(path) as z:
                for i in z.infolist()[:MAX_MEMBERS]:
                    is_link = (i.external_attr >> 16) & 0o170000 == 0o120000
                    members.append({"name": i.filename, "size": i.file_size, "packed": i.compress_size, "symlink": is_link})
                    total += i.file_size
        else:
            kind = "tar"
            with tarfile.open(path) as t:
                for i in t.getmembers()[:MAX_MEMBERS]:
                    members.append({"name": i.name, "size": i.size, "symlink": i.issym() or i.islnk(), "link_target": i.linkname or None})
                    total += i.size
    except (zipfile.BadZipFile, tarfile.TarError, OSError) as e:
        if path.endswith(".gz") or Path(path).read_bytes()[:2] == b"\x1f\x8b":
            import gzip

            with gzip.open(path) as g:
                size = 0
                while chunk := g.read(1 << 20):
                    size += len(chunk)
                    if size > 1 << 31:
                        break
            ratio = size / max(packed, 1)
            f = [_finding("gzip_bomb", "high", f"expands {ratio:.0f}x") ] if ratio > 200 else []
            return {"kind": "gzip", "expanded_size": size, "findings": f}
        return {"error": f"not a readable archive: {e}"}
    for m in members:
        why = _bad_member(m["name"])
        if why:
            findings.append(_finding("zip_slip", "high", f"{why}: extracting writes outside the target folder", member=m["name"]))
        if m.get("symlink"):
            findings.append(_finding("archive_symlink", "medium", "symlink member: can redirect later writes outside the folder", member=m["name"], target=m.get("link_target")))
        if re.search(r"\.(exe|scr|bat|cmd|ps1|vbs|js|jar|app|command|sh|dll|lnk)$", m["name"], re.I):
            findings.append(_finding("archive_executable", "medium", "executable or script inside", member=m["name"]))
    ratio = total / max(packed, 1)
    if ratio > 100 or total > 1 << 31:
        findings.append(_finding("archive_bomb", "high", f"expands to {total} bytes from {packed} ({ratio:.0f}x): archive bomb"))
    return {"kind": kind, "members": members[:60], "member_count": len(members), "expanded_size": total, "findings": findings[:MAX_FINDINGS]}


def archive_extract_test(path: str) -> dict:
    """Extraction testing in the isolated sandbox, as the playbook says: extract the way a naive
    tool would, into a scratch folder, and report anything that landed outside it."""
    root = Path("/tmp/aegis-extract")
    shutil.rmtree(root, ignore_errors=True)
    target = root / "a" / "b" / "out"
    target.mkdir(parents=True)
    before = {p for p in root.rglob("*")}
    written = 0
    errors: list[str] = []
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as z:
                for i in z.infolist()[:200]:
                    dest = os.path.normpath(os.path.join(target, i.filename))
                    if not dest.startswith(str(root)):
                        errors.append(f"{i.filename}: would leave the scratch area entirely, not written")
                        continue
                    if i.is_dir():
                        continue
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    data = z.read(i)[: 5 << 20]
                    written += len(data)
                    Path(dest).write_bytes(data)
                    if written > 50 << 20:
                        errors.append("stopped at 50 MB")
                        break
        else:
            with tarfile.open(path) as t:
                for i in t.getmembers()[:200]:
                    dest = os.path.normpath(os.path.join(target, i.name))
                    if not dest.startswith(str(root)) or not i.isfile():
                        continue
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    Path(dest).write_bytes((t.extractfile(i) or io.BytesIO()).read()[: 5 << 20])
    except Exception as e:  # noqa: BLE001 - a broken archive is a result, not a crash
        errors.append(str(e)[:200])
    outside = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p not in before and p.is_file() and target not in p.parents)
    findings = [_finding("zip_slip_confirmed", "critical", "extraction wrote a file outside the target folder", member=o) for o in outside]
    shutil.rmtree(root, ignore_errors=True)
    return {"written_outside_target": outside, "notes": errors, "findings": findings}


# ── documents (.pdf .docx .xlsx .pptx .doc .xls) ────────────────────────────────────────────────

PDF_KEYS = ["/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA", "/AcroForm", "/URI", "/SubmitForm", "/ObjStm"]


def pdf_actions(path: str) -> dict:
    """pdfid-style keyword counts, with the object text around each risky one."""
    data = Path(path).read_bytes()[: 20 << 20]
    counts = {k: len(re.findall(re.escape(k.encode()) + rb"(?![A-Za-z])", data)) for k in PDF_KEYS}
    findings: list[dict] = []
    sev = {"/JavaScript": "high", "/JS": "high", "/OpenAction": "high", "/AA": "high", "/Launch": "critical", "/EmbeddedFile": "medium", "/RichMedia": "medium", "/XFA": "medium", "/SubmitForm": "medium"}
    for key, s in sev.items():
        for m in list(re.finditer(re.escape(key.encode()) + rb"(?![A-Za-z])", data))[:5]:
            ctx = data[max(0, m.start() - 60) : m.end() + 120].decode("latin-1", "replace")
            findings.append(_finding("pdf_" + key.strip("/").lower(), s, f"{key}: runs or opens something when the PDF is viewed", offset=m.start(), code=re.sub(r"\s+", " ", ctx)))
    return {"is_pdf": data[:1024].find(b"%PDF-") >= 0, "counts": counts, "findings": findings[:MAX_FINDINGS]}


def ooxml_inspect(path: str) -> dict:
    """Inside an Office Open XML file: macros, embedded objects, external relationships, DDE."""
    if not zipfile.is_zipfile(path):
        return {"error": "not an OOXML (zip) file"}
    findings: list[dict] = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()[:MAX_MEMBERS]
        for n in names:
            low = n.lower()
            if low.endswith("vbaproject.bin"):
                findings.append(_finding("ooxml_macro", "high", "VBA macro project", member=n))
            if "/embeddings/" in low or low.endswith(".bin") and "oleobject" in low:
                findings.append(_finding("ooxml_embedded", "medium", "embedded object", member=n))
            if _bad_member(n):
                findings.append(_finding("zip_slip", "high", "path traversal inside the document", member=n))
            if low.endswith(".rels") or low.endswith(".xml"):
                text = z.read(n)[:MAX_READ].decode("utf-8", "replace")
                for m in re.finditer(r'<Relationship[^>]+TargetMode="External"[^>]*>', text):
                    rel = m.group(0)
                    kind = "remote template (can load macros from the internet)" if "attachedTemplate" in rel else "external relationship"
                    findings.append(_finding("ooxml_external_rel", "high" if "attachedTemplate" in rel or "oleObject" in rel else "medium", kind, member=n, code=rel))
                if re.search(r"DDEAUTO|\bDDE\b\s", text):
                    findings.append(_finding("ooxml_dde", "high", "DDE field: runs a command when the document updates fields", member=n))
                if "<!ENTITY" in text:
                    findings.append(_finding("ooxml_xxe", "high", "entity declaration in document XML: XXE", member=n))
    return {"parts": names[:60], "part_count": len(names), "findings": findings[:MAX_FINDINGS]}


def olevba(path: str) -> dict:
    """oletools' olevba: macro source and the keywords it flags (AutoOpen, Shell, URLs…)."""
    code, out, err = _run(["olevba", "--json", "--decode", path], timeout=90)
    if code == 127:
        return {"error": err}
    try:
        results = json.loads(out)
    except json.JSONDecodeError:
        return {"error": (err or out)[:500]}
    findings: list[dict] = []
    macros: list[dict] = []
    for r in results:
        for m in r.get("macros") or []:
            macros.append({"stream": m.get("vba_filename"), "code": (m.get("code") or "")[:4000]})
        for a in r.get("analysis") or []:
            sev = {"AutoExec": "high", "Suspicious": "high", "IOC": "medium"}.get(a.get("type"), "low")
            findings.append(_finding("olevba_" + (a.get("type") or "x").lower(), sev, f"{a.get('keyword')}: {a.get('description')}"))
    return {"macros": macros[:5], "findings": findings[:MAX_FINDINGS]}


# ── images ──────────────────────────────────────────────────────────────────────────────────────


def image_inspect(path: str) -> dict:
    """Malformed-image handling: does it end where the format says, and what's hidden after."""
    data = Path(path).read_bytes()
    findings: list[dict] = []
    end = None
    kind = "unknown"
    if data[:3] == b"\xff\xd8\xff":
        kind, end = "jpeg", data.rfind(b"\xff\xd9")
        end = end + 2 if end >= 0 else None
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        kind = "png"
        i = data.find(b"IEND")
        end = i + 8 if i >= 0 else None
    elif data[:6] in (b"GIF87a", b"GIF89a"):
        kind, end = "gif", (data.rfind(b"\x3b") + 1) or None
    if end is None and kind != "unknown":
        findings.append(_finding("image_truncated", "medium", f"{kind} has no end marker: malformed"))
    if end is not None and len(data) - end > 16:
        tail = data[end : end + 64]
        findings.append(_finding("image_trailing_data", "high", f"{len(data) - end} bytes after the end of the image (polyglot / hidden payload)", offset=end, code=tail.decode("latin-1", "replace")))
    for rx, what in [(rb"<\?php", "PHP code"), (rb"<script", "script tag"), (rb"MZ\x90\x00", "Windows program"), (rb"\x7fELF", "Linux program"), (rb"PK\x03\x04", "zip archive")]:
        m = re.search(rx, data[8:])
        if m:
            findings.append(_finding("image_embedded", "high", f"{what} hidden inside the image", offset=m.start() + 8))
    return {"kind": kind, "size": len(data), "findings": findings}


# ── secrets, keys and config (.env .ini .config .pem .key .p12) ────────────────────────────────

SECRET_RULES = [
    ("aws_access_key", "high", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b", "AWS access key ID"),
    ("aws_secret", "high", r"aws_secret_access_key\s*[=:]\s*\S{30,}", "AWS secret access key"),
    ("private_key", "critical", r"-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----", "private key"),
    ("api_token", "high", r"\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|xox[bpa]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b", "API token"),
    ("password_assignment", "high", r"\b(pass(word)?|passwd|pwd|secret|token|api_?key)\s*[=:]\s*['\"]?[^\s'\"$<{]{6,}", "credential in plain text"),
    ("db_url_credentials", "high", r"\b\w+://[^/\s:@]+:[^/\s@]+@", "credentials inside a connection URL"),
    ("debug_on", "medium", r"^\s*(DEBUG|APP_DEBUG|FLASK_DEBUG)\s*[=:]\s*(true|1|on|yes)\b", "debug mode on"),
    ("insecure_setting", "medium", r"(ssl_?verify|verify_ssl|tls_verify)\s*[=:]\s*(false|0|off|no)|allow_?all_?origins\s*[=:]\s*true|CORS.*\*", "security check turned off"),
]


def secret_scan(path: str) -> dict:
    """Secret scanning and configuration review. Values are masked in the output."""
    findings = _scan_lines(_text(path), SECRET_RULES)
    for f in findings:
        f["code"] = re.sub(r"([=:]\s*['\"]?)(\S{4})\S+", r"\1\2…(masked)", f.get("code", ""))
    return {"findings": findings}


def key_inspect(path: str) -> dict:
    """Certificates and keys: is a private key exposed, is it encrypted, is it weak."""
    data = Path(path).read_bytes()[:MAX_READ]
    text = data.decode("latin-1")
    findings: list[dict] = []
    blocks = re.findall(r"-----BEGIN ([A-Z0-9 ]+)-----", text)
    for b in blocks:
        if "PRIVATE KEY" in b:
            enc = "ENCRYPTED" in b or "Proc-Type: 4,ENCRYPTED" in text
            findings.append(_finding("private_key_exposed", "medium" if enc else "critical", f"{b}{' (password-protected)' if enc else ' in plain text'}"))
    code, out, _ = _run(["openssl", "x509", "-in", path, "-noout", "-text"], timeout=20)
    info: dict = {"pem_blocks": blocks}
    if code == 0:
        bits = re.search(r"Public-Key: \((\d+) bit", out)
        sig = re.search(r"Signature Algorithm: (\S+)", out)
        info |= {"key_bits": int(bits.group(1)) if bits else None, "signature": sig.group(1) if sig else None}
        if bits and int(bits.group(1)) < 2048 and "RSA" in out:
            findings.append(_finding("weak_key", "high", f"RSA key of {bits.group(1)} bits (< 2048)"))
        if sig and re.search(r"md5|sha1With", sig.group(1), re.I):
            findings.append(_finding("weak_signature", "high", f"weak signature algorithm {sig.group(1)}"))
    if not blocks and data[:1] == b"\x30":
        info["format"] = "DER / PKCS#12 (binary): may hold a private key"
        findings.append(_finding("binary_key_container", "medium", "binary key container (.p12/.der): check it isn't shipping a private key"))
    info["findings"] = findings
    return info


# ── binaries (.exe .dll .so .wasm, ELF, Mach-O) ─────────────────────────────────────────────────

DANGEROUS_IMPORTS = {
    "VirtualAllocEx": "allocates memory in another process (injection)",
    "WriteProcessMemory": "writes into another process (injection)",
    "CreateRemoteThread": "starts code in another process (injection)",
    "URLDownloadToFile": "downloads a file",
    "WinExec": "runs a program",
    "ShellExecute": "runs a program",
    "SetWindowsHookEx": "hooks keyboard/mouse (keylogging)",
    "GetAsyncKeyState": "reads keystrokes",
    "CryptEncrypt": "encrypts data (ransomware pattern when paired with file walking)",
    "IsDebuggerPresent": "detects analysis",
    "system": "runs a shell command",
    "execve": "runs a program",
    "ptrace": "attaches to processes / anti-debugging",
    "dlopen": "loads code at runtime",
    "strcpy": "unbounded copy (memory corruption)",
    "gets": "unbounded read (memory corruption)",
}


def binary_inspect(path: str) -> dict:
    """Symbol inspection and headers: format, imports/exports, dangerous APIs, signs of packing."""
    data = Path(path).read_bytes()
    info: dict = {"format": "unknown"}
    findings: list[dict] = []
    if data[:4] == b"\x7fELF":
        info["format"] = "ELF"
        _, hdr, _ = _run(["readelf", "-h", "-d", path], timeout=30)
        _, syms, _ = _run(["readelf", "--dyn-syms", "-W", path], timeout=30)
        info["header"] = hdr[:1500]
        names = re.findall(r"\s(\w+)(?:@\S+)?\s*$", syms, re.M)
    elif data[:2] == b"MZ":
        info["format"] = "PE (Windows)"
        _, dump, _ = _run(["objdump", "-p", path], timeout=30)
        names = re.findall(r"^\s+[0-9a-f]+\s+\d*\s*(\w+)$", dump, re.M) + re.findall(r"\b([A-Z][A-Za-z]+(?:A|W|Ex)?)\b", dump)
        info["dlls"] = sorted(set(re.findall(r"DLL Name: (\S+)", dump)))[:40]
    elif data[:4] == b"\x00asm":
        info["format"] = "WebAssembly"
        names = [m.decode() for m in re.findall(rb"[A-Za-z_][A-Za-z0-9_]{3,40}", data[:200_000])]
        if b"env" in data[:4096]:
            info["imports_env"] = True
    elif data[:4] in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf"):
        info["format"] = "Mach-O (macOS)"
        names = [m.decode() for m in re.findall(rb"_([A-Za-z][A-Za-z0-9_]{2,40})", data[:2_000_000])]
    else:
        names = []
    # Symbol names also appear as plain strings (and readelf/objdump may be missing or find no
    # dynamic table): read them from the bytes too.
    names += [m.decode() for m in re.findall(rb"[A-Za-z_][A-Za-z0-9_]{2,40}", data[:4_000_000])]
    seen = set(names)
    for api, why in DANGEROUS_IMPORTS.items():
        if api in seen:
            findings.append(_finding("dangerous_api", "medium" if api in {"strcpy", "gets", "dlopen", "system"} else "high", f"{api}: {why}", symbol=api))
    # Packing: high entropy over most of the file.
    if len(data) > 4096:
        import math
        from collections import Counter

        sample = data[: 1 << 20]
        ent = -sum(c / len(sample) * math.log2(c / len(sample)) for c in Counter(sample).values())
        info["entropy"] = round(ent, 2)
        if ent > 7.2:
            findings.append(_finding("packed", "medium", f"entropy {ent:.2f}/8: packed or encrypted (hides its code)"))
    if b"UPX!" in data[:4096]:
        findings.append(_finding("upx", "medium", "UPX-packed"))
    info["findings"] = findings[:MAX_FINDINGS]
    return info


# ── the catalogue ───────────────────────────────────────────────────────────────────────────────

TOOLS: dict[str, Callable[..., dict]] = {
    "identify": identify,
    "read_lines": read_lines,
    "strings_iocs": strings_iocs,
    "code_patterns": code_patterns,
    "shellcheck": shellcheck,
    "bandit": bandit,
    "json_inspect": json_inspect,
    "xml_entities": xml_entities,
    "svg_scripts": svg_scripts,
    "yaml_inspect": yaml_inspect,
    "archive_listing": archive_listing,
    "archive_extract_test": archive_extract_test,
    "pdf_actions": pdf_actions,
    "ooxml_inspect": ooxml_inspect,
    "olevba": olevba,
    "image_inspect": image_inspect,
    "secret_scan": secret_scan,
    "key_inspect": key_inspect,
    "binary_inspect": binary_inspect,
}


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in TOOLS:
        print(json.dumps({"error": f"usage: sandbox_tools.py <{'|'.join(TOOLS)}> <path> [args]"}))
        return 2
    tool, path, *rest = argv[1:]
    try:
        result = TOOLS[tool](path, *rest)
    except Exception as e:  # noqa: BLE001 - report, don't crash the agent's loop
        result = {"error": f"{type(e).__name__}: {e}"[:500]}
    print(json.dumps(result, default=str)[:60_000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
