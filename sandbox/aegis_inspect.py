#!/usr/bin/env python3
"""Aegis's file inspector: the per-file-type checks Droid runs inside the analysis sandbox.

Droid never runs this with arguments of its own. Each check is one of its fixed, argument-free
tools (src/main/droidLockdown.ts), always this exact shape:

    python3 -I aegis/aegis_inspect.py <check> sample/file

The checks follow resources/droid/file_types_vulnerabilities.md (file type -> attack surface ->
method). Every check reads the sample and reports; none runs, extracts or changes it. Parsers are
written for hostile input: sizes are capped, archives are listed without extracting, XML is
scanned without resolving entities, and nothing is imported from the sample's folder (`-I`).

Standard library only, so it works in Daytona's default image as well as the Aegis snapshot. Where
the snapshot has a dedicated tool (bandit, shellcheck, flawfinder, cppcheck, olevba, capa), the
check runs it too and says so; where it doesn't, the check says the tool isn't installed.

Output: plain text for Droid (findings first, at most OUTPUT_BUDGET characters), then one line
`AEGIS_RESULT {json}` that the app reads for its own rules. droidAgent.ts removes that line before
Droid sees the output.

Findings carry a kind: `malware` (signs of an attack: download and run, persistence, a web shell,
an exploit payload) or `vulnerability` (a weakness that is dangerous only if attacker input
reaches it). A file extension doesn't establish either; the reference says so, and so do we.
"""

import base64
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
import zlib

# ── Limits ───────────────────────────────────────────────────────────────────────────────────────

TEXT_LIMIT = 4 * 1024 * 1024  # bytes of a text file scanned line by line
BINARY_LIMIT = 32 * 1024 * 1024  # bytes of a binary parsed
OUTPUT_BUDGET = 7000  # characters of plain text before the result line (Droid sees 8192)
PER_CODE = 3  # lines shown per finding code; the rest are counted
EXTERNAL_TIMEOUT_S = 60
SEVERITIES = ("critical", "high", "medium", "low")

# ── Report ───────────────────────────────────────────────────────────────────────────────────────


def clean(text, limit=160):
    """One line of sample text, safe to print: control characters replaced, length capped."""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]", "\u00b7", str(text))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "\u2026"


def mask(value):
    """A secret, shown only by its start and length."""
    return "%s\u2026 (%d chars)" % (value[:4], len(value))


class Report:
    def __init__(self, check, title):
        self.check = check
        self.title = title
        self.findings = []
        self.facts = []
        self.details = []
        self.extra = {}
        self._seen = set()

    def add(self, code, severity, kind, title, detail="", line=None, evidence=None, hard=False):
        key = (code, line, evidence)
        if key in self._seen:
            return
        self._seen.add(key)
        self.findings.append(
            {
                "code": code,
                "severity": severity,
                "kind": kind,
                "title": title,
                "detail": detail,
                "line": line,
                "evidence": clean(evidence) if evidence else None,
                "hard": hard,
            }
        )

    def fact(self, name, value):
        self.facts.append((name, clean(value, 240)))

    def detail(self, text):
        self.details.append(clean(text, 240))

    def text(self):
        out = ["== %s (%s) ==" % (self.title, self.check)]
        groups = {}
        for f in self.findings:
            groups.setdefault(f["code"], []).append(f)
        ordered = sorted(groups.values(), key=lambda g: (SEVERITIES.index(g[0]["severity"]), g[0]["code"]))
        out.append("Findings: %d" % len(groups) if groups else "Findings: none")
        for group in ordered:
            f = group[0]
            head = "- [%s][%s] %s: %s" % (f["severity"].upper(), f["kind"], f["code"], f["title"])
            if f["detail"]:
                head += ". " + f["detail"]
            out.append(head)
            for g in group[:PER_CODE]:
                where = "line %d" % g["line"] if g["line"] else "at"
                if g["evidence"]:
                    out.append("    %s: %s" % (where, g["evidence"]))
            if len(group) > PER_CODE:
                more = [str(g["line"]) for g in group[PER_CODE:] if g["line"]]
                out.append(
                    "    (+%d more%s)" % (len(group) - PER_CODE, ": lines " + ", ".join(more[:12]) if more else "")
                )
        if self.facts:
            out.append("Facts:")
            out.extend("  %s: %s" % kv for kv in self.facts)
        if self.details:
            out.append("Details:")
            out.extend("  " + d for d in self.details)
        text = "\n".join(out)
        if len(text) > OUTPUT_BUDGET:
            text = text[: OUTPUT_BUDGET - 40] + "\n[output cut at %d characters]" % OUTPUT_BUDGET
        return text

    def emit(self):
        sys.stdout.write(self.text() + "\n")
        result = {"check": self.check, "findings": self.findings, "facts": dict(self.facts), "extra": self.extra}
        sys.stdout.write("AEGIS_RESULT " + json.dumps(result, ensure_ascii=True) + "\n")


# ── Reading the sample ───────────────────────────────────────────────────────────────────────────


def read(path, limit):
    with open(path, "rb") as f:
        return f.read(limit)


def meta_for(path):
    """sample/meta.json, written by Aegis at upload: the name the file arrived with."""
    try:
        with open(os.path.join(os.path.dirname(path), "meta.json"), "rb") as f:
            meta = json.loads(f.read(65536).decode("utf-8", "replace"))
        return meta if isinstance(meta, dict) else {}
    except (OSError, ValueError):
        return {}


def claimed_ext(meta):
    name = str(meta.get("filename") or "")
    base = name.rsplit("/", 1)[-1]
    return base.rsplit(".", 1)[-1].lower() if "." in base else ""


def is_text(data):
    head = data[:8192]
    if not head:
        return True
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in head:
        return False
    odd = sum(1 for b in head if b < 9 or (13 < b < 32))
    return odd / len(head) < 0.05


def to_text(data):
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", "replace")
    return data.decode("utf-8", "replace").lstrip("\ufeff")


def entropy(data):
    if not data:
        return 0.0
    counts = [0] * 256
    for b in data:
        counts[b] += 1
    n = float(len(data))
    return -sum(c / n * math.log(c / n, 2) for c in counts if c)


ASCII_STRINGS = re.compile(rb"[\x20-\x7e]{6,}")
UTF16_STRINGS = re.compile(rb"(?:[\x20-\x7e]\x00){6,}")


def strings_of(data):
    found = [m.group(0).decode("ascii") for m in ASCII_STRINGS.finditer(data)]
    found += [m.group(0).decode("utf-16-le") for m in UTF16_STRINGS.finditer(data)]
    return found


def u16(data, at, end="<"):
    return struct.unpack_from(end + "H", data, at)[0]


def u32(data, at, end="<"):
    return struct.unpack_from(end + "I", data, at)[0]


def cstring(data, at, limit=256):
    if at < 0 or at >= len(data):
        return ""
    stop = data.find(b"\x00", at, at + limit)
    return data[at : stop if stop >= 0 else at + limit].decode("latin-1")


# ── Rules over lines of text ─────────────────────────────────────────────────────────────────────


class Rule:
    def __init__(self, code, severity, kind, title, pattern, detail="", flags=0, hard=False):
        self.code = code
        self.severity = severity
        self.kind = kind
        self.title = title
        self.rx = re.compile(pattern, flags)
        self.detail = detail
        self.hard = hard


def scan_lines(rep, text, rules, comments=()):
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or (comments and stripped.startswith(comments)):
            continue
        # Minified files are one long line: scan it in overlapping pieces.
        pieces = [line] if len(line) <= 4000 else [line[i : i + 4000] for i in range(0, len(line), 3500)]
        for rule in rules:
            for piece in pieces:
                m = rule.rx.search(piece)
                if m:
                    shown = stripped if len(stripped) <= 200 else piece[max(0, m.start() - 60) : m.end() + 60]
                    rep.add(rule.code, rule.severity, rule.kind, rule.title, rule.detail, number, shown, rule.hard)
                    break


def run_external(rep, label, argv, timeout=EXTERNAL_TIMEOUT_S, stdin=None):
    """Runs a dedicated analysis tool if the image has it. Returns its stdout, or None."""
    if not shutil.which(argv[0]):
        rep.fact(label, "not installed in this sandbox image")
        return None
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": tempfile.gettempdir(), "LANG": "C.UTF-8"}
    try:
        done = subprocess.run(argv, input=stdin, capture_output=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        rep.fact(label, "ran out of time after %d s" % timeout)
        return None
    except OSError as err:
        rep.fact(label, "could not run: %s" % err)
        return None
    out = done.stdout.decode("utf-8", "replace")
    rep.fact(label, "ran (exit %d, %d lines)" % (done.returncode, len(out.splitlines())))
    return out


class Copy:
    """A temporary copy of the sample with an extension, for tools that decide by file name."""

    def __init__(self, path, ext):
        self.path = path
        self.ext = ext

    def __enter__(self):
        self.dir = tempfile.mkdtemp(prefix="aegis-inspect-")
        target = os.path.join(self.dir, "sample." + self.ext)
        shutil.copyfile(self.path, target)
        return target

    def __exit__(self, *exc):
        shutil.rmtree(self.dir, ignore_errors=True)


# ── Secrets (used by several checks) ─────────────────────────────────────────────────────────────

SECRET_RULES = [
    ("aws_access_key", "critical", "AWS access key ID", r"\b(?P<v>(?:AKIA|ASIA)[0-9A-Z]{16})\b"),
    ("aws_secret_key", "critical", "AWS secret access key", r"(?i)aws_?secret_?access_?key\s*[=:]\s*[\"']?(?P<v>[A-Za-z0-9/+=]{40})"),
    ("github_token", "critical", "GitHub token", r"\b(?P<v>gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})"),
    ("slack_token", "high", "Slack token", r"\b(?P<v>xox[abposr]-[A-Za-z0-9-]{10,})"),
    ("stripe_live_key", "critical", "Stripe live secret key", r"\b(?P<v>[sr]k_live_[0-9a-zA-Z]{20,})"),
    ("google_api_key", "high", "Google API key", r"\b(?P<v>AIza[0-9A-Za-z_\-]{35})"),
    ("anthropic_key", "critical", "Anthropic API key", r"\b(?P<v>sk-ant-[A-Za-z0-9_\-]{20,})"),
    ("openai_key", "critical", "OpenAI API key", r"\b(?P<v>sk-(?!ant-)(?:proj-)?[A-Za-z0-9_\-]{32,})"),
    ("npm_token", "high", "npm access token", r"\b(?P<v>npm_[A-Za-z0-9]{36})\b"),
    ("sendgrid_key", "high", "SendGrid API key", r"\b(?P<v>SG\.[\w\-]{22}\.[\w\-]{43})"),
    ("azure_storage_key", "critical", "Azure storage account key", r"AccountKey=(?P<v>[A-Za-z0-9+/=]{80,})"),
    ("private_key", "critical", "Private key", r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----"),
    ("jwt", "medium", "JSON Web Token", r"\b(?P<v>eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})"),
    ("url_credentials", "high", "Password inside a URL", r"\b[a-z][a-z0-9+.\-]*://[^\s:/@\"']+:(?P<v>[^\s@/\"']{3,})@[^\s\"']+"),
    (
        "hardcoded_secret",
        "medium",
        "Hard-coded password or token",
        r"(?i)\b(?:password|passwd|pwd|secret|token|api[_\-]?key|access[_\-]?key|client[_\-]?secret)\w*[\"']?\s*[=:]\s*[\"']?(?P<v>[^\s\"'#;,]{6,})",
    ),
]
SECRETS = [(c, s, t, re.compile(p)) for c, s, t, p in SECRET_RULES]
PLACEHOLDER = re.compile(
    r"(?i)^(?:x{3,}|\*+|\.+|changeme|change_me|example\w*|sample\w*|dummy\w*|placeholder\w*|your\w*|"
    r"<[^>]*>|\$\{?[\w.]+\}?|%\w+%|\{\{.*\}\}|null|none|true|false|undefined|required|optional)$"
)
CODE_VALUE = re.compile(r"[(\[]|^(?:self|this|request|req|config|settings|options|params|args|env|os|process)\.")


def scan_secrets(rep, text):
    count = 0
    for number, line in enumerate(text.splitlines(), 1):
        if len(line) > 4000:
            line = line[:4000]
        for code, severity, title, rx in SECRETS:
            m = rx.search(line)
            if not m:
                continue
            value = m.groupdict().get("v")
            if value is not None:
                if PLACEHOLDER.match(value) or (code == "hardcoded_secret" and CODE_VALUE.search(value)):
                    continue
                shown = line.replace(value, mask(value))
            else:
                shown = line
            rep.add(
                code,
                severity,
                "vulnerability",
                "Exposed secret: " + title,
                "Anyone with the file can use it. Rotate it if it is real (shown masked)",
                number,
                shown,
            )
            count += 1
            if code != "hardcoded_secret":
                break
    return count


# ── Interesting strings (binaries, documents) ───────────────────────────────────────────────────

STRING_RULES = [
    Rule("ransomware_strings", "high", "malware", "Deletes backups or shadow copies (ransomware behaviour)", r"(?i)vssadmin.*delete|shadowcopy.*delete|wbadmin\s+delete|bcdedit.*recoveryenabled"),
    Rule("persistence_strings", "high", "malware", "Mentions an autostart location", r"(?i)\\CurrentVersion\\Run|LaunchAgents|LaunchDaemons|/etc/cron|crontab\s|systemctl\s+enable|schtasks\s+/create"),
    Rule("shell_strings", "medium", "malware", "Starts a shell or script host", r"(?i)cmd\.exe\s*/c|powershell(\.exe)?\s+-|/bin/(ba|z)?sh\s+-c|wscript\.shell|mshta\s"),
    Rule("download_strings", "medium", "malware", "Downloads from the internet", r"(?i)URLDownloadToFile|InternetOpenUrl|WinHttpOpen|DownloadString|curl\s+-|wget\s+http"),
    Rule("crypto_mining", "high", "malware", "Cryptocurrency mining", r"(?i)stratum\+tcp://|xmrig|cryptonight|coinhive|minexmr"),
    Rule("evasion_strings", "medium", "malware", "Checks for a debugger or virtual machine", r"(?i)IsDebuggerPresent|CheckRemoteDebuggerPresent|VBoxService|vmtoolsd|sandboxie|SbieDll|wine_get_version"),
    Rule("keylogging_strings", "high", "malware", "Keyboard capture", r"(?i)SetWindowsHookEx|GetAsyncKeyState|GetKeyboardState|CGEventTapCreate"),
    Rule("credential_strings", "high", "malware", "Reaches for saved passwords or wallets", r"(?i)Login Data|find-(generic|internet)-password|\\Mozilla\\Firefox\\Profiles|key4\.db|wallet\.dat|\.ssh/id_(rsa|ed25519)|Keychains/"),
    Rule("tor_address", "medium", "malware", "Tor hidden-service address", r"\b[a-z2-7]{16,56}\.onion\b"),
]
URL_RX = re.compile(r"https?://[^\s\"'<>()\\]{4,200}")
IP_RX = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")


def scan_strings(rep, found):
    text = "\n".join(s[:400] for s in found[:20000])
    for rule in STRING_RULES:
        for s in found[:20000]:
            if rule.rx.search(s):
                rep.add(rule.code, rule.severity, rule.kind, rule.title, rule.detail, None, s, rule.hard)
                break
    urls = sorted(set(URL_RX.findall(text)))
    ips = sorted(set(ip for ip in IP_RX.findall(text) if not ip.startswith(("0.", "127.", "255."))))
    if urls:
        rep.fact("URLs", ", ".join(urls[:12]) + (" (+%d more)" % (len(urls) - 12) if len(urls) > 12 else ""))
    if ips:
        rep.fact("IP addresses", ", ".join(ips[:12]))
    return urls, ips


# ── identify ─────────────────────────────────────────────────────────────────────────────────────

FAMILY_EXTS = {
    "c": {"c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"},
    "python": {"py", "pyw", "pyi"},
    "javascript": {"js", "mjs", "cjs", "jsx", "ts", "tsx", "html", "htm", "hta", "xhtml"},
    "php": {"php", "phtml", "php3", "php4", "php5", "php7", "phar"},
    "sql": {"sql"},
    "json": {"json", "jsonc", "geojson"},
    "xml": {"xml", "xsl", "xslt", "xsd", "plist", "rss"},
    "yaml": {"yaml", "yml"},
    "archive": {"zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "pkg", "dmg", "iso"},
    "pdf": {"pdf"},
    "office": {"docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "dotm", "xltm", "doc", "xls", "ppt", "rtf"},
    "image": {"jpg", "jpeg", "png", "svg", "svgz", "gif", "webp", "bmp", "tif", "tiff", "ico"},
    "config": {"env", "config", "ini", "cfg", "conf", "properties", "toml"},
    "shell": {"sh", "bash", "zsh", "ksh", "command", "tool", "ps1", "psm1", "bat", "cmd"},
    "keys": {"pem", "key", "p12", "pfx", "crt", "cer", "der", "ppk"},
    "binary": {"wasm", "so", "dll", "exe", "dylib", "elf", "bin", "o", "sys", "scr", "msi", "class"},
}


def family_of_ext(ext):
    for family, exts in FAMILY_EXTS.items():
        if ext in exts:
            return family
    return None


def sniff(head, tail=b""):
    """(label, family, strong) from the bytes. Strong means a magic number, not a guess."""
    if head.startswith(b"\x7fELF"):
        return "ELF executable", "binary", True
    if head.startswith(b"MZ"):
        return "Windows PE executable (MZ)", "binary", True
    if head[:4] in (b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe"):
        return "Mach-O executable", "binary", True
    if head.startswith(b"\xca\xfe\xba\xbe") and len(head) >= 8:
        return ("Mach-O universal binary", "binary", True) if u32(head, 4, ">") < 30 else ("Java class file", "binary", True)
    if head.startswith(b"\x00asm"):
        return "WebAssembly module", "binary", True
    pdf_at = head.find(b"%PDF-", 0, 1024)
    if pdf_at >= 0:
        return ("PDF document" if pdf_at == 0 else "PDF document (header at byte %d)" % pdf_at), "pdf", True
    if head.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        if b"[Content_Types].xml" in head or b"word/" in head or b"xl/" in head or b"ppt/" in head:
            return "Office Open XML document (zip)", "office", True
        return "ZIP archive", "archive", True
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "OLE2 compound file (legacy Office or MSI)", "office", True
    if head.startswith(b"{\\rtf"):
        return "RTF document", "office", True
    if head.startswith(b"\x1f\x8b"):
        return "gzip data", "archive", True
    if head.startswith(b"BZh"):
        return "bzip2 data", "archive", True
    if head.startswith(b"\xfd7zXZ\x00"):
        return "xz data", "archive", True
    if head.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7-Zip archive", "archive", True
    if head.startswith(b"Rar!\x1a\x07"):
        return "RAR archive", "archive", True
    if head.startswith(b"xar!"):
        return "XAR archive (macOS .pkg)", "archive", True
    if len(head) > 262 and head[257:262] == b"ustar":
        return "tar archive", "archive", True
    if b"koly" in tail[-512:]:
        return "Apple disk image (UDIF)", "archive", True
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG image", "image", True
    if head.startswith(b"\xff\xd8\xff"):
        return "JPEG image", "image", True
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "GIF image", "image", True
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "WebP image", "image", True
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "TIFF image", "image", True
    if head.startswith(b"PuTTY-User-Key-File"):
        return "PuTTY private key", "keys", True
    if not is_text(head):
        if head[:2] == b"\x30\x82":
            return "DER data (certificate, key or PKCS#12)", "keys", False
        return "binary data", None, False
    text = to_text(head[:65536])
    s = text.lstrip()
    first = s.split("\n", 1)[0]
    if first.startswith("#!"):
        interp = first[2:].strip().split()
        if interp and os.path.basename(interp[0]) == "env":
            interp = [w for w in interp[1:] if not w.startswith("-") and "=" not in w]
        word = os.path.basename(interp[0]) if interp else ""
        if re.match(r"(ba|z|da|k|c|tc)?sh$|osascript$", word):
            return "shell script (%s)" % word, "shell", True
        if word.startswith("python"):
            return "Python script", "python", True
        if word in ("node", "deno", "bun", "nodejs"):
            return "JavaScript (node) script", "javascript", True
        if word.startswith("php"):
            return "PHP script", "php", True
        if word.startswith(("pwsh", "powershell")):
            return "PowerShell script", "shell", True
        return "script (%s)" % word, None, True
    if "<?php" in text[:8192]:
        return "PHP source", "php", True
    low = s[:4096].lower()
    if s.startswith("-----BEGIN "):
        return "PEM data", "keys", True
    if "<svg" in low:
        return "SVG image (XML)", "image", True
    if low.startswith(("<!doctype html", "<html")) or "<script" in low:
        return "HTML document", "javascript", False
    if s.startswith("<?xml") or (s.startswith("<") and re.match(r"<[A-Za-z_][\w:.-]*[\s>/]", s)):
        return "XML document", "xml", True
    if s[:1] in "{[":
        try:
            json.loads(text)
            return "JSON data", "json", True
        except ValueError:
            if re.match(r"[{\[]\s*[\"{\[\d-]", s):
                return "JSON data (partial or invalid)", "json", False
    if re.search(r"^\s*#\s*include\s*[<\"]", text, re.M):
        return "C/C++ source", "c", False
    if re.search(r"^(?:import \w|from [\w.]+ import |def \w+\(|class \w+[:(])", text, re.M):
        return "Python source", "python", False
    if re.search(r"(?im)^\s*(?:param\s*\(|\$\w+\s*=|write-host\b|invoke-\w+|new-object\b|powershell(?:\.exe)?\s+-)", text):
        return "PowerShell script", "shell", False
    if re.search(r"(?m)^\s*(?:(?:const|let|var)\s+[\w{\[]|function\s*\w*\s*\(|import .+ from )|\brequire\([\"']|module\.exports\b", text):
        return "JavaScript source", "javascript", False
    if re.search(r"(?im)^\s*(?:select|insert\s+into|create\s+(?:table|user|database|or)|alter\s+\w+|drop\s+\w+|grant\s+\w+|update\s+\w+\s+set)\b", text):
        return "SQL script", "sql", False
    lines = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith(("#", ";"))][:200]
    if lines:
        assigns = sum(1 for l in lines if re.match(r"\s*(?:export\s+)?[A-Za-z_][\w.\-]*\s*=", l))
        sections = sum(1 for l in lines if re.match(r"\s*\[[^\]]+\]\s*$", l))
        mappings = sum(1 for l in lines if re.match(r"\s*(?:- )?[\w\"'.\-]+\s*:(?:\s|$)", l))
        if (assigns + sections) / float(len(lines)) > 0.6:
            return "configuration (key=value)", "config", False
        if mappings / float(len(lines)) > 0.5 or s.startswith("---"):
            return "YAML data", "yaml", False
    if re.search(r"(?m)^\s*(?:set -e|export \w+=|echo |if \[|for \w+ in )", text):
        return "shell commands", "shell", False
    return "text", None, False


def check_identify(path, rep):
    meta = meta_for(path)
    size = os.path.getsize(path)
    head = read(path, 1024 * 1024)
    with open(path, "rb") as f:
        f.seek(max(0, size - 512))
        tail = f.read(512)
    label, family, strong = sniff(head, tail)
    name = str(meta.get("filename") or "")
    ext = claimed_ext(meta)
    claimed = family_of_ext(ext)
    rep.fact("name it arrived with", name or "(unknown)")
    rep.fact("size", "%d bytes" % size)
    rep.fact("magic", label)
    rep.fact("reference row (bytes)", family or "none")
    rep.fact("reference row (name)", claimed or "none")
    sample_entropy = entropy(head)
    rep.fact("entropy (first MB)", "%.2f bits/byte" % sample_entropy)
    rep.fact("first bytes", head[:32].hex(" "))
    if shutil.which("file"):
        out = run_external(rep, "file", ["file", "-b", path], timeout=20)
        if out:
            rep.fact("file says", out.strip())
    if family and claimed and family != claimed and strong:
        danger = family in ("binary", "shell", "python", "javascript", "php") and claimed in (
            "pdf", "office", "image", "json", "xml", "yaml", "config", "sql", "keys",
        )
        rep.add(
            "type_mismatch",
            "high" if danger else "medium",
            "malware",
            "The name says .%s but the bytes are %s" % (ext, label),
            "A disguised file type is a common way to get something opened",
        )
    if re.search(r"\.(pdf|docx?|xlsx?|jpe?g|png|txt|mp4|mp3)\.(exe|scr|js|vbs|bat|cmd|ps1|command|app|sh|hta|jar|lnk)$", name, re.I):
        rep.add("double_extension", "high", "malware", "Double extension hides the real type", "", None, name)
    if re.search(u"[\u202a-\u202e\u2066-\u2069]", name):
        rep.add("rtl_override", "critical", "malware", "The name uses a right-to-left override to disguise its extension", "", None, name)
    compressed = family in ("archive", "office", "image", "pdf") or label.startswith(("gzip", "ZIP"))
    if sample_entropy > 7.6 and not compressed and size > 4096:
        rep.add("high_entropy", "medium", "malware", "Looks encrypted or packed (entropy %.2f)" % sample_entropy, "Packed content hides what it does")
    rep.extra = {"family": family, "claimedFamily": claimed, "label": label, "strong": strong, "ext": ext}


# ── strings and secrets ──────────────────────────────────────────────────────────────────────────


def check_strings(path, rep):
    data = read(path, BINARY_LIMIT)
    found = strings_of(data)
    rep.fact("strings", "%d of 6+ characters" % len(found))
    scan_strings(rep, found)
    shown = []
    for s in found:
        if len(shown) >= 120:
            break
        if len(s) >= 8 and not re.match(r"^[\W_]+$", s):
            shown.append(clean(s, 120))
    if shown:
        rep.detail("first strings: " + " | ".join(shown[:60]))


def check_secrets(path, rep):
    data = read(path, BINARY_LIMIT)
    text = to_text(data[:TEXT_LIMIT]) if is_text(data) else "\n".join(strings_of(data))
    n = scan_secrets(rep, text)
    rep.fact("secrets scanned", "%d lines, %d hits" % (text.count("\n") + 1, n))


# ── Source code ──────────────────────────────────────────────────────────────────────────────────

C_RULES = [
    Rule("c_gets", "critical", "vulnerability", "gets() reads with no length limit (buffer overflow)", r"\bgets\s*\("),
    Rule("c_unbounded_copy", "high", "vulnerability", "Unbounded string copy (buffer overflow)", r"\b(strcpy|strcat|wcscpy|wcscat|lstrcpy[AW]?|lstrcat[AW]?|_mbscpy|StrCpy)\s*\("),
    Rule("c_sprintf", "high", "vulnerability", "sprintf writes with no length limit (buffer overflow)", r"\b(sprintf|vsprintf|swprintf)\s*\("),
    Rule("c_scanf_string", "high", "vulnerability", "scanf %s with no width (buffer overflow)", r"\b(f|s)?scanf\s*\([^;]*\"[^\"]*%s"),
    Rule("c_format_string", "high", "vulnerability", "Format string taken from a variable", r"\b(printf|syslog|NSLog)\s*\(\s*[A-Za-z_]\w*\s*\)|\bfprintf\s*\(\s*\w+\s*,\s*[A-Za-z_]\w*\s*\)|\bsnprintf\s*\([^,]+,[^,]+,\s*[A-Za-z_]\w*\s*\)"),
    Rule("c_alloc_overflow", "medium", "vulnerability", "Allocation size computed by multiplication (integer overflow)", r"\b(malloc|alloca|realloc|kmalloc)\s*\([^;]*[\w)]\s*\*\s*[\w(]"),
    Rule("c_memcpy", "low", "vulnerability", "Memory copy whose length should be checked", r"\b(memcpy|memmove|bcopy|CopyMemory)\s*\("),
    Rule("c_command", "high", "vulnerability", "Runs a command (command injection if input reaches it)", r"\b(system|popen|execl|execlp|execvp|execve|WinExec|ShellExecute[AW]?(Ex)?|CreateProcess[AW]?)\s*\("),
    Rule("c_temp_file", "medium", "vulnerability", "Predictable temporary file name", r"\b(tmpnam|tempnam|mktemp)\s*\("),
    Rule("c_process_injection", "high", "malware", "Process injection or keyboard capture API", r"\b(VirtualAllocEx|WriteProcessMemory|CreateRemoteThread|NtUnmapViewOfSection|QueueUserAPC|SetWindowsHookEx[AW]?|GetAsyncKeyState)\b"),
    Rule("c_anti_debug", "medium", "malware", "Anti-debugging", r"\bptrace\s*\(\s*PTRACE_TRACEME|\bIsDebuggerPresent\s*\("),
    Rule("c_preload", "medium", "malware", "Library injection through LD_PRELOAD or DYLD_INSERT_LIBRARIES", r"LD_PRELOAD|DYLD_INSERT_LIBRARIES"),
]
FREE_RX = re.compile(r"\bfree\s*\(\s*([A-Za-z_][\w.>\-]*)\s*\)")


def c_lifetimes(rep, text):
    """Heuristic double free / use after free: a pointer freed, then freed or used again in the
    next lines before being reassigned."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = FREE_RX.search(line)
        if not m:
            continue
        name = m.group(1)
        esc = re.escape(name)
        reassigned = re.compile(r"(?<![=!<>])\b%s\s*=(?!=)" % esc)
        freed = re.compile(r"\bfree\s*\(\s*%s\s*\)" % esc)
        used = re.compile(r"\b%s\s*(->|\[)|\*\s*%s\b|\(\s*%s\s*[,)]" % (esc, esc, esc))
        used_after = False
        for j in range(i + 1, min(len(lines), i + 40)):
            later = lines[j]
            if reassigned.search(later) or later.startswith("}"):
                break
            if freed.search(later):
                rep.add("c_double_free", "high", "vulnerability", "Freed twice (double free)", "free(%s) at lines %d and %d" % (name, i + 1, j + 1), j + 1, later)
                break
            if not used_after and used.search(later) and not later.strip().startswith(("//", "/*", "*")):
                rep.add("c_use_after_free", "high", "vulnerability", "Used after free", "%s freed at line %d" % (name, i + 1), j + 1, later)
                used_after = True


def check_c(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, C_RULES, comments=("//", "/*", "*"))
    c_lifetimes(rep, text)
    rep.fact("method", "static review: unsafe calls, format strings, allocation sizes, free/use order")
    rep.fact("dynamic testing", "AddressSanitizer, GDB and fuzzing need a build; not run here")
    with Copy(path, "c") as copy:
        out = run_external(rep, "flawfinder", ["flawfinder", "--quiet", "--dataonly", "--minlevel=3", copy])
        if out:
            for l in [l for l in out.splitlines() if l.strip()][:15]:
                rep.detail("flawfinder: " + l.replace(copy, "sample"))
        out = run_external(rep, "cppcheck", ["cppcheck", "--quiet", "--enable=warning", "--template={line}: {severity}: {message}", copy])


PY_RULES = [
    Rule("py_encoded_exec", "critical", "malware", "Runs hidden (encoded or compressed) code", r"\b(exec|eval)\s*\(\s*(__import__\(['\"](base64|zlib|marshal|codecs)['\"]\)|base64\.|zlib\.|marshal\.|codecs\.|bytes\.fromhex)"),
    Rule("py_eval", "high", "vulnerability", "eval/exec of dynamic code", r"(?<![\w.])(eval|exec)\s*\("),
    Rule("py_pickle", "high", "vulnerability", "Unsafe deserialization (pickle-family loads)", r"\b(pickle|cPickle|_pickle|dill|shelve|jsonpickle|joblib)\.(loads?|Unpickler|open|decode)\b|\bmarshal\.loads?\b"),
    Rule("py_yaml_load", "high", "vulnerability", "yaml.load without SafeLoader (unsafe deserialization)", r"\byaml\.(load|load_all)\s*\((?![^)]*Loader\s*=\s*(yaml\.)?(C?SafeLoader|BaseLoader))|\byaml\.(unsafe_load|full_load)\s*\("),
    Rule("py_shell_true", "high", "vulnerability", "subprocess with shell=True (command injection)", r"subprocess\.\w+\([^)]*shell\s*=\s*True"),
    Rule("py_os_command", "high", "vulnerability", "os.system / os.popen runs a shell command (command injection)", r"\bos\.(system|popen[234]?|exec[lv]p?e?|spawn[lv]p?e?)\s*\("),
    Rule("py_sql_format", "high", "vulnerability", "SQL built by string formatting (SQL injection)", r"\.(execute|executemany|raw|extra)\s*\(\s*(f[\"']|[\"'][^\"']*[\"']\s*(%|\+|\.format)|[\w.]+\s*(%|\+))"),
    Rule("py_path_traversal", "medium", "vulnerability", "File path built from input (path traversal)", r"\bopen\s*\([^)]*(request\.|args\[|params|\+\s*\w)|send_file\s*\(\s*[^\"')]|os\.path\.join\([^)]*request\."),
    Rule("py_archive_extract", "medium", "vulnerability", "Archive extracted without checking member paths (Zip Slip)", r"\.extractall\s*\((?![^)]*filter\s*=)|\.extract\s*\("),
    Rule("py_temp_file", "medium", "vulnerability", "tempfile.mktemp is racy (insecure temporary file)", r"\btempfile\.mktemp\s*\("),
    Rule("py_tls_off", "medium", "vulnerability", "TLS certificate checks turned off", r"verify\s*=\s*False|_create_unverified_context|CERT_NONE"),
    Rule("py_debug_server", "medium", "vulnerability", "Web server in debug mode", r"\.run\([^)]*debug\s*=\s*True"),
    Rule("py_reverse_shell", "critical", "malware", "Reverse shell (socket wired to a shell)", r"\bpty\.spawn\s*\(|os\.dup2\s*\(\s*\w+\.fileno\(\)"),
    Rule("py_persistence", "high", "malware", "Installs itself to start automatically", r"LaunchAgents|LaunchDaemons|crontab|\.bashrc|\.zshrc|CurrentVersion\\\\Run|systemctl\s+enable"),
    Rule("py_credential_access", "high", "malware", "Reaches for saved passwords, cookies or keys", r"Login Data|find-(generic|internet)-password|Keychains|Cookies\.binarycookies|key4\.db|\.ssh/id_|wallet\.dat|Local State"),
    Rule("py_keylogger", "high", "malware", "Captures keystrokes", r"\bpynput\b|keyboard\.on_press|GetAsyncKeyState|keyboard\.hook"),
    Rule("py_download_exec", "critical", "malware", "Downloads code and runs it", r"(urlopen|requests\.get|urllib\.request|httpx\.get)\([^)]*\)[^\n]*\b(exec|eval|system|Popen)\b", hard=True),
]


def check_python(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, PY_RULES, comments=("#",))
    rep.fact("method", "code review for injection sinks, unsafe deserialization and path handling (Bandit/Semgrep-style rules)")
    with Copy(path, "py") as copy:
        out = run_external(rep, "bandit", ["bandit", "-q", "-f", "custom", "--msg-template", "{line}: {test_id} {severity}: {msg}", copy])
        if out:
            for l in [l for l in out.splitlines() if re.match(r"\d+:", l)][:15]:
                rep.detail("bandit: " + l)
    rep.fact("semgrep", "not run: the sandbox has no network for its rule registry; these rules cover the same sinks")


JS_RULES = [
    Rule("js_eval", "high", "vulnerability", "eval / new Function / string timers run dynamic code", r"(?<![\w.$])eval\s*\(|\bnew\s+Function\s*\(|\bset(Timeout|Interval)\s*\(\s*[\"'`]"),
    Rule("js_xss_sink", "medium", "vulnerability", "HTML sink (XSS if input reaches it)", r"\.(innerHTML|outerHTML)\s*\+?=|document\.write(ln)?\s*\(|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML|\bv-html\b|\$\([^)]*\)\.html\("),
    Rule("js_prototype_pollution", "medium", "vulnerability", "Prototype pollution", r"__proto__|constructor\s*\[\s*[\"']prototype|\bObject\.prototype\s*\[|\[\s*[\"']constructor[\"']\s*\]"),
    Rule("js_command", "high", "vulnerability", "Runs a command through child_process (command injection)", r"require\(\s*[\"'](node:)?child_process[\"']\s*\)|from\s+[\"'](node:)?child_process[\"']|\b(execSync|spawnSync|execFile)\s*\(|\bexec\s*\(\s*[`\"'][^`\"']*(\$\{|\"\s*\+)"),
    Rule("js_sql_concat", "high", "vulnerability", "SQL built by concatenation (SQL injection)", r"\.(query|execute|raw)\s*\(\s*([\"'][^\"']*(SELECT|INSERT|UPDATE|DELETE)[^\"']*[\"']\s*\+|`[^`]*(SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{)", flags=re.I),
    Rule("js_path_traversal", "medium", "vulnerability", "File path from request input (path traversal)", r"fs\.\w+\s*\([^)]*\breq\.(params|query|body)|res\.sendFile\s*\([^)]*\breq\."),
    Rule("js_open_redirect", "low", "vulnerability", "Redirect target taken from input", r"res\.redirect\s*\([^)]*\breq\.|location(\.href)?\s*=\s*[^;]*(location\.(search|hash)|params\.get)"),
    Rule("js_obfuscation", "medium", "malware", "Obfuscated JavaScript", r"\b_0x[0-9a-f]{4,}\b|(\\x[0-9a-fA-F]{2}){12,}|String\.fromCharCode\(\s*\d+(\s*,\s*\d+){15,}|\batob\s*\([^)]{60,}\)"),
    Rule("js_script_host", "high", "malware", "Uses the Windows script host or ActiveX (dropper behaviour)", r"WScript\.Shell|ActiveXObject|Shell\.Application|Scripting\.FileSystemObject|\bpowershell(\.exe)?\b", flags=re.I),
    Rule("js_download_exec", "critical", "malware", "Downloads code and runs it", r"(fetch|axios\.get|https?\.get|XMLHttpRequest)[^\n]{0,200}\b(eval|new Function|execSync|exec)\s*\(", hard=True),
    Rule("js_html_smuggling", "high", "malware", "Builds a file in the browser and saves it (HTML smuggling)", r"msSaveOrOpenBlob|new\s+Blob\s*\([^)]*atob|URL\.createObjectURL\s*\([^)]*\)[^\n]*\.download\s*="),
    Rule("js_credential_form", "high", "malware", "Password form that posts to another site (phishing)", r"<form[^>]+action\s*=\s*[\"']https?://[^\"']+[\"'][^>]*>|type\s*=\s*[\"']password[\"'][^>]*>[^\n]*https?://", flags=re.I),
    Rule("js_cookie_exfil", "medium", "malware", "Reads cookies or sends data out quietly", r"document\.cookie[^\n]{0,120}(fetch|XMLHttpRequest|sendBeacon|new Image)|navigator\.sendBeacon"),
    Rule("js_crypto_mining", "high", "malware", "Cryptocurrency mining", r"coinhive|cryptonight|stratum\+tcp|CoinImp|webminepool", flags=re.I),
    Rule("js_remote_script", "low", "vulnerability", "Loads a script from another site", r"<script[^>]+src\s*=\s*[\"']https?://", flags=re.I),
]


def check_javascript(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, JS_RULES, comments=("//", "/*", "*"))
    rep.fact("method", "ESLint-security / Semgrep-style rules for XSS sinks, prototype pollution, injection and dropper patterns")
    rep.fact("dependency audit", "not run: npm audit needs the network; check package.json with inspect_json")


PHP_RULES = [
    Rule("php_webshell", "critical", "malware", "Web shell (runs code sent in a request)", r"\b(eval|assert|system|passthru|shell_exec|exec)\s*\(\s*(base64_decode|gzinflate|gzuncompress|str_rot13|\$_(GET|POST|REQUEST|COOKIE|SERVER))|\$_(GET|POST|REQUEST|COOKIE)\s*\[[^\]]*\]\s*\(", hard=True),
    Rule("php_obfuscation", "medium", "malware", "Obfuscated PHP", r"\b(gzinflate|gzuncompress|str_rot13)\s*\(|base64_decode\s*\(\s*[\"'][A-Za-z0-9+/=]{80,}"),
    Rule("php_file_inclusion", "critical", "vulnerability", "File inclusion from request input (LFI/RFI)", r"\b(include|require)(_once)?\b[^;]*\$_(GET|POST|REQUEST|COOKIE)"),
    Rule("php_sql_injection", "high", "vulnerability", "SQL built from request input (SQL injection)", r"(mysql_query|mysqli_query|->query|pg_query|sqlite_query)\s*\([^;]*\$_(GET|POST|REQUEST|COOKIE)|[\"'][^\"']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^\"']*[\"']\s*\.\s*\$", flags=re.I),
    Rule("php_command", "high", "vulnerability", "Runs a shell command (command injection)", r"\b(system|exec|shell_exec|passthru|popen|proc_open|pcntl_exec)\s*\(|`[^`]*\$\w+[^`]*`"),
    Rule("php_eval", "high", "vulnerability", "eval / assert / create_function run dynamic code", r"\b(eval|assert|create_function)\s*\(|preg_replace\s*\(\s*[\"'][^\"']*/e[a-z]*[\"']"),
    Rule("php_unserialize", "high", "vulnerability", "unserialize() of data (object injection)", r"\bunserialize\s*\("),
    Rule("php_upload", "medium", "vulnerability", "Uploaded file moved without type checks", r"move_uploaded_file\s*\("),
    Rule("php_xss", "medium", "vulnerability", "Request input echoed into the page (XSS)", r"\b(echo|print)\b[^;]*\$_(GET|POST|REQUEST|COOKIE)"),
]


def check_php(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, PHP_RULES, comments=("//", "#", "/*", "*"))
    rep.fact("method", "code review for SQL injection, file inclusion, command injection and web-shell patterns")


SQL_RULES = [
    Rule("sql_os_access", "high", "malware", "Runs OS commands or reads/writes server files from SQL", r"xp_cmdshell|sp_OACreate|COPY\s+\S+\s+(FROM|TO)\s+PROGRAM|LOAD_FILE\s*\(|INTO\s+(OUT|DUMP)FILE|lo_import|lo_export", flags=re.I),
    Rule("sql_grant_all", "high", "vulnerability", "Grants every privilege (excessive permissions)", r"\bGRANT\s+ALL\b", flags=re.I),
    Rule("sql_grant_wide", "medium", "vulnerability", "Grants to everyone or passes on grant rights", r"\bTO\s+PUBLIC\b|WITH\s+GRANT\s+OPTION|\bSUPERUSER\b|\bON\s+\*\.\*", flags=re.I),
    Rule("sql_dynamic", "medium", "vulnerability", "Dynamic SQL built from strings (injection if input reaches it)", r"\bEXEC(UTE)?\s*(\(|IMMEDIATE\b|sp_executesql)|\bPREPARE\s+\w+\s+FROM\s+@|\|\|\s*[A-Za-z_@:]\w*\s*\|\||\bCONCAT\s*\([^)]*(@|:)\w+", flags=re.I),
    Rule("sql_destructive", "medium", "vulnerability", "Destructive statement", r"\bDROP\s+(TABLE|DATABASE|SCHEMA|USER)\b|\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+\w+\s*;", flags=re.I),
    Rule("sql_password", "medium", "vulnerability", "Hard-coded database password", r"IDENTIFIED\s+BY\s+'[^']+'|\bPASSWORD\s*(=|\()\s*'[^']+'", flags=re.I),
    Rule("sql_weak_config", "medium", "vulnerability", "Loosens database security settings", r"SET\s+GLOBAL\s+local_infile\s*=\s*(1|ON)|secure_file_priv\s*=\s*['\"]{2}|trustworthy\s+on", flags=re.I),
]


def check_sql(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, SQL_RULES, comments=("--", "#", "/*", "*"))
    rep.fact("method", "query review: parameterization, dynamic SQL, privilege grants, OS access")


SH_RULES = [
    Rule("sh_download_exec", "critical", "malware", "Downloads a script and runs it", r"\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(ba|z)?sh\s+(-c\s+)?[\"']?\$\((curl|wget)\b|\bsource\s+<\((curl|wget)", hard=True),
    Rule("sh_hidden_command", "high", "malware", "Runs hidden (base64-encoded) commands", r"base64\s+(-d|--decode|-D)\b[^|]*\|\s*(ba|z)?sh\b|echo\s+[A-Za-z0-9+/=]{40,}\s*\|\s*base64"),
    Rule("sh_persistence", "high", "malware", "Sets itself to start at login", r"LaunchAgents|LaunchDaemons|crontab\b|\.(bash|zsh)rc\b|\.bash_profile|/etc/rc\.local|systemctl\s+enable|loginitems"),
    Rule("sh_credential_access", "high", "malware", "Looks for saved passwords", r"Login Data|find-(generic|internet)-password|Keychains?/|\.ssh/id_|security\s+dump-keychain|wallet\.dat"),
    Rule("sh_sends_data", "medium", "malware", "Sends data to a server", r"--post-data|--data(-binary|-raw|-urlencode)?\b|\bcurl\b.*\s-(d|F|T)\s|\bnc\s+-?\w*\s*\d{1,3}\.\d|/dev/tcp/"),
    Rule("sh_disable_protection", "high", "malware", "Turns off macOS or system protections", r"spctl\s+--master-disable|csrutil\s+disable|xattr\s+-[a-z]*d[a-z]*\s+com\.apple\.quarantine|xattr\s+-c\b|setenforce\s+0|ufw\s+disable"),
    Rule("sh_fake_prompt", "high", "malware", "Asks for your password in a fake dialog", r"osascript[^\n]*(display dialog|password)", flags=re.I),
    Rule("sh_eval", "medium", "vulnerability", "eval of a variable (command injection)", r"\beval\s+[\"']?\$"),
    Rule("sh_unsafe_permissions", "medium", "vulnerability", "World-writable permissions", r"chmod\s+(-R\s+)?(0?777|a\+w|o\+w|666)\b"),
    Rule("sh_temp_file", "medium", "vulnerability", "Predictable temporary file (race / symlink attack)", r"(>|>>|\bcp\b[^\n]*|\bmv\b[^\n]*)\s*/tmp/[\w.\-]+(\$\$)?(\s|$)"),
    Rule("sh_rm_variable", "high", "vulnerability", "rm -rf of a variable (deletes the wrong thing if it is empty)", r"\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+[\"']?\$\{?\w+\}?/?[\"']?(\s|$|/\*)"),
    Rule("sh_sudo", "low", "vulnerability", "Asks for administrator rights", r"\bsudo\b"),
]
PS_RULES = [
    Rule("ps_download_exec", "critical", "malware", "Downloads a script and runs it", r"(IEX|Invoke-Expression)[^\n]*(DownloadString|Invoke-WebRequest|iwr|Net\.WebClient|irm|Invoke-RestMethod)|(DownloadString|irm|iwr)[^\n]*\|\s*(IEX|Invoke-Expression)", flags=re.I, hard=True),
    Rule("ps_encoded", "high", "malware", "Runs an encoded command", r"-e(nc(odedcommand)?)?\s+[A-Za-z0-9+/=]{20,}|FromBase64String", flags=re.I),
    Rule("ps_defense_evasion", "high", "malware", "Turns off script or antivirus protections", r"-ExecutionPolicy\s+Bypass|-ep\s+bypass|Set-MpPreference\s+-Disable|Add-MpPreference\s+-ExclusionPath|amsiInitFailed|AmsiUtils", flags=re.I),
    Rule("ps_persistence", "high", "malware", "Sets itself to start automatically", r"CurrentVersion\\Run|New-ScheduledTask|Register-ScheduledTask|schtasks\s+/create|Register-ScheduledJob", flags=re.I),
    Rule("ps_hidden", "medium", "malware", "Runs hidden", r"-W(indowStyle)?\s+Hidden|-NonI(nteractive)?\b.*-NoP(rofile)?", flags=re.I),
    Rule("ps_download", "medium", "malware", "Downloads from the internet", r"DownloadFile|DownloadString|Invoke-WebRequest|Start-BitsTransfer|Net\.WebClient", flags=re.I),
    Rule("ps_iex", "high", "vulnerability", "Invoke-Expression runs a string as code", r"\b(IEX|Invoke-Expression)\b", flags=re.I),
]


def check_shell(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    ext = claimed_ext(meta_for(path))
    powershell = ext in ("ps1", "psm1") or re.search(r"(?im)^\s*(param\s*\(|\$\w+\s*=|write-host|invoke-)", text)
    batch = ext in ("bat", "cmd")
    scan_lines(rep, text, SH_RULES, comments=("#", "rem ", "REM ", "::"))
    if powershell or batch:
        scan_lines(rep, text, PS_RULES, comments=("#",))
    rep.fact("language", "PowerShell" if powershell else "batch" if batch else "POSIX shell")
    rep.fact("method", "ShellCheck-style static analysis and input-flow review")
    if not powershell and not batch:
        with Copy(path, "sh") as copy:
            out = run_external(rep, "shellcheck", ["shellcheck", "-f", "gcc", "-S", "warning", copy])
            if out:
                for l in out.splitlines()[:15]:
                    rep.detail("shellcheck: " + l.replace(copy, "sample"))


# ── Data formats ─────────────────────────────────────────────────────────────────────────────────

GADGET_KEYS = {"$type", "@type", "py/object", "py/reduce", "py/function", "@class", "javaClass", "__class__", "_class", "$class", "!!python"}
PRIVILEGE_KEYS = re.compile(r"^(is_?admin|admin|role|roles|permissions?|is_?superuser|is_?staff|verified|balance|price|owner_?id|account_?type|access_?level|group_?id)$", re.I)


def check_json(path, rep):
    data = read(path, TEXT_LIMIT)
    text = to_text(data)
    duplicates = []

    def pairs(items):
        seen = set()
        for k, _ in items:
            if k in seen:
                duplicates.append(k)
            seen.add(k)
        return dict(items)

    try:
        doc = json.loads(text, object_pairs_hook=pairs)
    except ValueError as err:
        rep.add("json_invalid", "low", "vulnerability", "Not valid JSON", str(err)[:120])
        doc = None
    stats = {"depth": 0, "keys": 0, "longest": 0}
    privileged = set()

    def walk(node, depth, trail):
        if depth > 400:
            return
        stats["depth"] = max(stats["depth"], depth)
        if isinstance(node, dict):
            for k, v in node.items():
                stats["keys"] += 1
                if k in ("__proto__", "prototype") or (k == "constructor" and isinstance(v, dict)):
                    rep.add("json_prototype_pollution", "high", "vulnerability", "Prototype pollution key", "A JavaScript merge of this object can change every object's prototype", None, "%s.%s" % (trail, k))
                if k in GADGET_KEYS:
                    rep.add("json_type_gadget", "high", "malware", "Type hint that makes some parsers build arbitrary objects (deserialization gadget)", "Dangerous with Json.NET TypeNameHandling, Jackson default typing, fastjson autoType or jsonpickle", None, "%s.%s = %s" % (trail, k, clean(json.dumps(v)[:80])))
                if PRIVILEGE_KEYS.match(k):
                    privileged.add(k)
                walk(v, depth + 1, "%s.%s" % (trail, k))
        elif isinstance(node, list):
            for i, v in enumerate(node[:5000]):
                walk(v, depth + 1, "%s[%d]" % (trail, i))
        elif isinstance(node, str):
            stats["longest"] = max(stats["longest"], len(node))
            if re.search(r"<script|javascript:|\bon\w+\s*=|\$\{jndi:|\{\{.*\}\}|__import__|\bexec\(", node, re.I):
                rep.add("json_injection_payload", "medium", "malware", "Value that looks like an injection payload", "", None, "%s = %s" % (trail, node[:120]))

    if doc is not None:
        walk(doc, 0, "$")
        if isinstance(doc, dict) and isinstance(doc.get("scripts"), dict):
            for hook in ("preinstall", "install", "postinstall", "prepare"):
                cmd = doc["scripts"].get(hook)
                if isinstance(cmd, str):
                    bad = re.search(r"curl|wget|node\s+-e|base64|\|\s*(ba)?sh|powershell|http", cmd)
                    rep.add("npm_install_script", "high" if bad else "medium", "malware", "Runs a script when the package is installed (%s)" % hook, "npm runs it automatically", None, cmd)
            for section in ("dependencies", "devDependencies", "optionalDependencies"):
                for name, spec in (doc.get(section) or {}).items():
                    if isinstance(spec, str) and re.match(r"(git\+|https?:|file:|github:|[\w-]+/[\w.-]+$)", spec):
                        rep.add("npm_unpinned_source", "medium", "vulnerability", "Dependency fetched from a URL or repo, not the registry", "", None, "%s: %s" % (name, spec))
    if duplicates:
        rep.add("json_duplicate_keys", "medium", "vulnerability", "Duplicate keys (parsers disagree on which one wins)", ", ".join(sorted(set(duplicates))[:10]))
    if stats["depth"] > 100:
        rep.add("json_deep_nesting", "medium", "vulnerability", "Nested %d levels deep (can exhaust a parser)" % stats["depth"])
    if privileged:
        rep.add("json_privilege_fields", "low", "vulnerability", "Fields that grant privileges", "Mass assignment risk if this is bound straight onto a model: " + ", ".join(sorted(privileged)[:10]))
    rep.fact("structure", "depth %d, %d keys, longest string %d chars" % (stats["depth"], stats["keys"], stats["longest"]))
    rep.fact("method", "schema/boundary review: parser-confusing structure, type gadgets, prototype keys, privileged fields")
    scan_secrets(rep, text)


def xml_checks(rep, text, prefix="xml"):
    doctype = re.search(r"<!DOCTYPE[^\[>]*(\[(.*?)\])?\s*>", text, re.S | re.I)
    entities = re.findall(r"<!ENTITY\s+(%\s*)?([\w.:-]+)\s+(SYSTEM|PUBLIC)?\s*(\"[^\"]*\"|'[^']*')(\s*(\"[^\"]*\"|'[^']*'))?", text, re.I)
    if doctype:
        rep.fact("DOCTYPE", clean(doctype.group(0), 120))
        if re.search(r"<!DOCTYPE\s+\S+\s+(SYSTEM|PUBLIC)\s+[^>]*(https?|ftp|file)://", doctype.group(0), re.I):
            rep.add(prefix + "_external_dtd", "medium", "vulnerability", "Loads an external DTD", "A parser that fetches it reaches the network", None, doctype.group(0)[:160])
    for param, name, kind, value, _, value2 in entities:
        target = (value2 or value).strip("\"'")
        if kind:
            hostile = re.match(r"(file|php|expect|jar|netdoc|gopher)://|/etc/|c:\\", target, re.I)
            rep.add(
                prefix + "_xxe",
                "critical" if hostile else "high",
                "malware" if hostile else "vulnerability",
                "External entity (XXE)%s" % (": reads local files" if hostile else ""),
                "A parser that resolves entities fetches %s" % clean(target, 80),
                None,
                "<!ENTITY %s%s %s %s>" % (param or "", name, kind, target),
            )
        refs = len(re.findall(r"&[\w.:-]+;", value))
        if refs >= 5:
            rep.add(prefix + "_entity_bomb", "critical", "malware", "Entity expansion bomb (billion laughs)", "Entity %s expands %d others" % (name, refs), None, "<!ENTITY %s %s>" % (name, value[:100]))
        if param:
            rep.add(prefix + "_parameter_entity", "high", "vulnerability", "Parameter entity (used for out-of-band XXE)", "", None, "<!ENTITY %% %s ...>" % name)
    if entities:
        rep.fact("entities", "%d declared" % len(entities))
    if re.search(r"<(\w+:)?include\b[^>]*xmlns(:\w+)?=\"http://www\.w3\.org/2001/XInclude\"|<xi:include\b", text):
        rep.add(prefix + "_xinclude", "high", "vulnerability", "XInclude pulls in another file", "", None, re.search(r"<[^>]*include[^>]*>", text).group(0))
    m = re.search(r"<msxsl:script|php:function|xmlns:\w+=\"java:|xmlns:\w+=\"http://xml\.apache\.org/xalan/java", text)
    if m:
        rep.add(prefix + "_xslt_code", "high", "malware", "XSLT that can run code", "", None, text[max(0, m.start() - 20) : m.end() + 60])
    if re.search(r"schemaLocation\s*=\s*\"[^\"]*https?://", text):
        rep.add(prefix + "_remote_schema", "low", "vulnerability", "Points at a remote schema", "A validating parser may fetch it")


def check_xml(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    xml_checks(rep, text)
    if "<svg" in text[:4096].lower():
        svg_checks(rep, text)
    rep.fact("method", "parser-configuration review with safe scanning: entities are listed, never resolved")
    scan_secrets(rep, text)


YAML_RULES = [
    Rule("yaml_unsafe_tag", "critical", "malware", "Tag that builds objects or runs code when loaded unsafely", r"!!python/(object|apply|name|module|new)|!ruby/(object|hash|struct)|!!javax?\.|!<tag:yaml\.org,2002:python/|!!js/function|!!perl/"),
    Rule("ci_pr_target", "high", "vulnerability", "pull_request_target runs with secrets on code from forks", r"^\s*(-\s*)?pull_request_target\b|on:\s*\[?[^\]\n]*pull_request_target"),
    Rule("ci_checkout_pr_head", "critical", "vulnerability", "Checks out untrusted pull-request code in a privileged workflow", r"ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)"),
    Rule("ci_script_injection", "high", "vulnerability", "Untrusted event text expanded inside a script (CI script injection)", r"\$\{\{\s*github\.event\.(issue|pull_request|comment|review|review_comment|head_commit|discussion|pages|commits)[\w.\[\]*]*\.(title|body|message|name|label|ref|head_ref|email|default_branch)\s*\}\}|\$\{\{\s*github\.head_ref\s*\}\}"),
    Rule("ci_write_all", "medium", "vulnerability", "Workflow token can write everything", r"permissions:\s*write-all"),
    Rule("ci_pipe_to_shell", "high", "malware", "Downloads a script and runs it in CI", r"(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b"),
    Rule("ci_secret_echo", "high", "vulnerability", "Prints a secret into the CI log", r"(echo|printf|cat)\b[^\n]*\$\{\{\s*secrets\.\w+"),
    Rule("ci_unpinned_action", "low", "vulnerability", "Action pinned to a branch, not a commit", r"uses:\s*[\w.-]+/[\w./-]+@(main|master|latest|dev)\b"),
    Rule("yaml_debug", "medium", "vulnerability", "Debug mode on", r"^\s*debug:\s*(true|yes|on|1)\b", flags=re.I),
]


def check_yaml(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, YAML_RULES, comments=("#",))
    anchors = len(re.findall(r"(?:^|[\s\[{,])&[\w-]+", text))
    aliases = len(re.findall(r"(?:^|[\s\[{,])\*[\w-]+", text))
    if aliases > 50 and aliases > 5 * max(1, anchors):
        rep.add("yaml_alias_bomb", "high", "malware", "Alias expansion bomb (billion laughs in YAML)", "%d aliases over %d anchors" % (aliases, anchors))
    ci = bool(re.search(r"^\s*(jobs|runs-on|steps|stages|script):", text, re.M))
    rep.fact("kind", "CI/CD pipeline" if ci else "YAML data")
    rep.fact("anchors / aliases", "%d / %d" % (anchors, aliases))
    rep.fact("method", "parser review for unsafe tags, CI/CD configuration scanning and secret scanning")
    scan_secrets(rep, text)


CONFIG_RULES = [
    Rule("config_debug", "medium", "vulnerability", "Debug mode on", r"^\s*(export\s+)?\w*DEBUG\w*\s*[=:]\s*[\"']?(true|1|yes|on)\b|<compilation[^>]*debug\s*=\s*\"true\"|display_errors\s*=\s*On", flags=re.I),
    Rule("config_wildcard_hosts", "medium", "vulnerability", "Accepts any host or origin", r"(ALLOWED_HOSTS|CORS\w*|Access-Control-Allow-Origin|allowed_origins)\s*[=:]\s*[\"'\[]*\*", flags=re.I),
    Rule("config_tls_off", "medium", "vulnerability", "TLS checks turned off", r"(ssl|tls)?_?verify\w*\s*[=:]\s*[\"']?(false|0|no|off)\b|InsecureSkipVerify\s*[=:]\s*true|rejectUnauthorized\s*[=:]\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*[\"']?0", flags=re.I),
    Rule("config_default_password", "high", "vulnerability", "Default or trivial password", r"(password|passwd|pwd)\w*\s*[=:]\s*[\"']?(admin|password|123456|12345678|root|changeme|secret|letmein|qwerty|default)[\"']?\s*$", flags=re.I),
    Rule("config_errors_shown", "medium", "vulnerability", "Detailed errors shown to users", r"<customErrors\s+mode\s*=\s*\"Off\"|APP_ENV\s*=\s*(dev|development|local)\b", flags=re.I),
    Rule("config_php_risky", "medium", "vulnerability", "Risky PHP setting", r"allow_url_include\s*=\s*On|allow_url_fopen\s*=\s*On|register_globals\s*=\s*On", flags=re.I),
    Rule("config_ssh_weak", "medium", "vulnerability", "Weak SSH setting", r"^\s*(PermitRootLogin\s+yes|PasswordAuthentication\s+yes|PermitEmptyPasswords\s+yes)", flags=re.I),
    Rule("config_plain_http", "low", "vulnerability", "Service address over plain HTTP", r"(URL|URI|ENDPOINT|HOST)\w*\s*[=:]\s*[\"']?http://(?!localhost|127\.)", flags=re.I),
]


def check_config(path, rep):
    text = to_text(read(path, TEXT_LIMIT))
    scan_lines(rep, text, CONFIG_RULES, comments=("#", ";", "//"))
    n = scan_secrets(rep, text)
    rep.fact("secrets", "%d found (masked)" % n)
    rep.fact("file permissions", "not meaningful here: Aegis set them at upload; check them where the file is deployed")
    rep.fact("method", "secret scanning, configuration review")


# ── Archives ─────────────────────────────────────────────────────────────────────────────────────

RISKY_MEMBER = re.compile(r"\.(exe|dll|scr|com|pif|msi|js|jse|vbs|vbe|wsf|hta|bat|cmd|ps1|sh|command|app/|pkg|dmg|lnk|jar|iso|docm|xlsm|pptm)$", re.I)
NESTED = re.compile(r"\.(zip|rar|7z|tar|gz|tgz|xz|bz2|iso|jar)$", re.I)


def member_path_risk(rep, name, kind="zip"):
    parts = re.split(r"[\\/]+", name)
    if name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name):
        rep.add("archive_absolute_path", "critical", "malware", "Entry with an absolute path (writes outside the folder)", "", None, name)
    elif ".." in parts:
        rep.add("archive_path_traversal", "critical", "malware", "Entry climbs out of the folder (Zip Slip)", "Extracting it writes outside the destination", None, name)
    if "\\" in name and kind == "zip":
        rep.add("archive_backslash", "low", "vulnerability", "Backslash in an entry name (treated as a folder on Windows)", "", None, name)
    if RISKY_MEMBER.search(name):
        rep.add("archive_risky_member", "medium", "malware", "Contains a program or script", "", None, name)
    if NESTED.search(name):
        rep.add("archive_nested", "low", "malware", "Archive inside an archive (can hide content from scanners)", "", None, name)


def is_tar(path):
    try:
        return tarfile.is_tarfile(path)
    except (EOFError, OSError, tarfile.TarError, zlib.error):
        return False


def check_archive(path, rep):
    size = os.path.getsize(path)
    head = read(path, 1024)
    listed = []
    total = 0
    tar = is_tar(path)
    if zipfile.is_zipfile(path):
        rep.fact("format", "ZIP")
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            offsets = {}
            names = {}
            for info in infos[:100000]:
                total += info.file_size
                listed.append(info.filename)
                member_path_risk(rep, info.filename)
                mode = (info.external_attr >> 16) & 0o170000
                if mode == 0o120000:
                    target = z.read(info)[:1024].decode("utf-8", "replace") if info.file_size < 1024 else "?"
                    escapes = target.startswith("/") or ".." in re.split(r"[\\/]+", target)
                    rep.add("archive_symlink", "high" if escapes else "medium", "malware" if escapes else "vulnerability", "Symbolic link%s" % (" pointing outside the folder" if escapes else ""), "", None, "%s -> %s" % (info.filename, target))
                if info.flag_bits & 0x1:
                    rep.add("archive_encrypted", "medium", "malware", "Password-protected entry (scanners can't see inside)", "", None, info.filename)
                if info.compress_size and info.file_size / float(info.compress_size) > 200 and info.file_size > 20 * 1024 * 1024:
                    rep.add("archive_bomb_ratio", "critical", "malware", "Compression ratio of a zip bomb", "%s expands %d x to %d MB" % (info.filename, info.file_size // max(1, info.compress_size), info.file_size // 2**20), None, info.filename)
                offsets[info.header_offset] = offsets.get(info.header_offset, 0) + 1
                names[info.filename] = names.get(info.filename, 0) + 1
            if any(n > 1 for n in offsets.values()):
                rep.add("archive_overlapping", "critical", "malware", "Entries share data (overlapping zip bomb)", "")
            dupes = [n for n, c in names.items() if c > 1]
            if dupes:
                rep.add("archive_duplicate_names", "medium", "malware", "Two entries with the same name (tools disagree on which one you get)", "", None, ", ".join(dupes[:5]))
            rep.fact("entries", str(len(infos)))
    elif head.startswith(b"\x1f\x8b") and not tar:
        rep.fact("format", "gzip (single file)")
        out = 0
        started = time.time()
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        with open(path, "rb") as f:
            try:
                while out < 2 * 2**30 and time.time() - started < 10:
                    chunk = f.read(1 << 16)
                    if not chunk:
                        break
                    out += len(d.decompress(chunk, 1 << 24))
                    while d.unconsumed_tail and out < 2 * 2**30:
                        out += len(d.decompress(d.unconsumed_tail, 1 << 24))
            except zlib.error as err:
                rep.add("archive_corrupt", "low", "vulnerability", "Corrupt compressed data", str(err)[:100])
        if not d.eof:
            rep.fact("stream", "ends early or was cut off after %d bytes" % out)
        total = out
        if size and out / float(size) > 200 and out > 100 * 2**20:
            rep.add("archive_bomb_ratio", "critical", "malware", "Expands like a decompression bomb", "%d bytes become at least %d MB" % (size, out // 2**20))
        name_end = head.find(b"\x00", 10) if head[3] & 0x08 else -1
        if name_end > 10:
            listed.append(head[10:name_end].decode("latin-1"))
            member_path_risk(rep, listed[0], "gzip")
    elif tar:
        rep.fact("format", "tar")
        started = time.time()
        with tarfile.open(path, "r:*") as t:
            count = 0
            for m in t:
                count += 1
                if count > 100000 or time.time() - started > 20:
                    rep.fact("listing", "stopped early (%d entries, %.0f s)" % (count, time.time() - started))
                    break
                total += m.size
                listed.append(m.name)
                member_path_risk(rep, m.name, "tar")
                if m.issym() or m.islnk():
                    escapes = m.linkname.startswith("/") or ".." in re.split(r"[\\/]+", m.linkname)
                    rep.add("archive_symlink", "high" if escapes else "medium", "malware" if escapes else "vulnerability", "%s link%s" % ("Symbolic" if m.issym() else "Hard", " pointing outside the folder" if escapes else ""), "", None, "%s -> %s" % (m.name, m.linkname))
                if m.isdev() or m.isfifo():
                    rep.add("archive_device", "high", "malware", "Device or FIFO entry", "", None, m.name)
                if m.mode & 0o6000:
                    rep.add("archive_setuid", "high", "malware", "Entry with setuid/setgid bits", "", None, m.name)
            rep.fact("entries", str(count))
    else:
        label, _, _ = sniff(head)
        rep.fact("format", label)
        if shutil.which("7z"):
            out = run_external(rep, "7z list", ["7z", "l", "-slt", "-p", path], timeout=60)
            for line in (out or "").splitlines():
                if line.startswith("Path = ") and not line.endswith(path):
                    listed.append(line[7:])
                    member_path_risk(rep, line[7:])
        else:
            rep.fact("7z", "not installed in this sandbox image; can't list this format")
    if total > 2**30:
        rep.add("archive_huge", "high", "malware", "Expands to more than 1 GB", "%d MB from %d bytes" % (total // 2**20, size))
    if listed:
        rep.detail("entries: " + " | ".join(clean(n, 100) for n in listed[:80]))
    rep.fact("uncompressed size", "%d bytes" % total)
    rep.fact("method", "entry paths, links and sizes listed without extracting anything")


# ── PDF ──────────────────────────────────────────────────────────────────────────────────────────

PDF_KEYWORDS = [
    ("/Launch", "pdf_launch", "critical", "malware", "Launch action runs a program"),
    ("/JavaScript", "pdf_javascript", "high", "malware", "Contains JavaScript"),
    ("/JS", "pdf_javascript", "high", "malware", "Contains JavaScript"),
    ("/OpenAction", "pdf_open_action", "medium", "malware", "Does something as soon as it is opened"),
    ("/AA", "pdf_additional_actions", "medium", "malware", "Actions tied to page or form events"),
    ("/EmbeddedFile", "pdf_embedded_file", "medium", "malware", "Carries an embedded file"),
    ("/RichMedia", "pdf_rich_media", "medium", "malware", "Embedded rich media (Flash)"),
    ("/XFA", "pdf_xfa", "medium", "vulnerability", "XFA form (large parser attack surface)"),
    ("/SubmitForm", "pdf_submit_form", "medium", "malware", "Sends form data to a server"),
    ("/GoToR", "pdf_remote_goto", "medium", "malware", "Opens another (remote) document"),
    ("/GoToE", "pdf_remote_goto", "medium", "malware", "Opens an embedded document"),
    ("/ImportData", "pdf_import_data", "medium", "malware", "Imports data from another file"),
    ("/URI", "pdf_uri", "low", "malware", "Links to a web address"),
    ("/ObjStm", "pdf_object_streams", "low", "malware", "Object streams (can hide objects from simple scanners)"),
    ("/Encrypt", "pdf_encrypted", "low", "malware", "Encrypted (hides content from scanners)"),
    ("/JBIG2Decode", "pdf_jbig2", "low", "vulnerability", "JBIG2 images (a parser with a history of exploits)"),
]
PDF_EXPLOIT_JS = re.compile(r"util\.printf|Collab\.(getIcon|collectEmailInfo)|media\.newPlayer|getAnnots|spell\.customDictionaryOpen|app\.launchURL|this\.exportDataObject|unescape\s*\(\s*[\"']%u|String\.fromCharCode|eval\s*\(", re.I)


def pdf_names(data):
    """Normalises #xx escapes in PDF names (/J#61vaScript -> /JavaScript)."""
    return re.sub(rb"/(?:[A-Za-z0-9]|#[0-9A-Fa-f]{2})+", lambda m: re.sub(rb"#([0-9A-Fa-f]{2})", lambda h: bytes([int(h.group(1), 16)]), m.group(0)), data)


def check_pdf(path, rep):
    data = read(path, BINARY_LIMIT)
    at = data.find(b"%PDF-")
    if at < 0:
        rep.add("pdf_no_header", "medium", "malware", "Called a PDF but has no PDF header")
    elif at > 0:
        rep.add("pdf_polyglot", "medium", "malware", "PDF header is not at the start (polyglot file)", "%d bytes come before it" % at)
    eofs = [m.start() for m in re.finditer(rb"%%EOF", data)]
    rep.fact("version", data[at + 5 : at + 8].decode("latin-1") if at >= 0 else "?")
    rep.fact("revisions (%%EOF markers)", str(len(eofs)))
    if eofs and len(data) - eofs[-1] > 1024:
        trailing = data[eofs[-1] + 5 :]
        label, _, strong = sniff(trailing.lstrip()[:4096])
        rep.add("pdf_trailing_data", "high" if strong else "low", "malware", "Data after the end of the PDF", "%d bytes%s" % (len(trailing), ", looks like " + label if strong else ""))
    streams = 0
    inflated = []
    budget = 64 * 2**20
    for m in re.finditer(rb"(?<!end)stream\r?\n", data):
        end = data.find(b"endstream", m.end())
        if end < 0 or budget <= 0:
            break
        raw = data[m.end() : end]
        streams += 1
        try:
            d = zlib.decompressobj()
            out = d.decompress(raw, 8 * 2**20)
            budget -= len(out)
            inflated.append(out)
        except zlib.error:
            pass
    norm = pdf_names(data) + b"\n" + pdf_names(b"\n".join(inflated))
    counts = []
    for word, code, severity, kind, title in PDF_KEYWORDS:
        n = len(re.findall(re.escape(word.encode()) + rb"(?![A-Za-z])", norm))
        if n:
            counts.append("%s %d" % (word, n))
            if code == "pdf_uri":
                uris = sorted(set(u.decode("latin-1") for u in re.findall(rb"/URI\s*\(([^)]{1,300})\)", norm)))
                rep.add(code, severity, kind, title, "%d link(s)" % len(uris), None, ", ".join(uris[:8]) if uris else None)
            else:
                ctx = re.search(re.escape(word.encode()) + rb"(?![A-Za-z]).{0,80}", norm, re.S)
                rep.add(code, severity, kind, title, "", None, ctx.group(0) if ctx else word)
    rep.fact("keyword counts", ", ".join(counts) if counts else "no active-content keywords")
    has_js = re.search(rb"/(JS|JavaScript)(?![A-Za-z])", norm)
    auto = re.search(rb"/(OpenAction|AA)(?![A-Za-z])", norm)
    if has_js and auto:
        rep.add("pdf_auto_javascript", "high", "malware", "Runs JavaScript automatically when opened", "/OpenAction or /AA together with /JavaScript")
    js = PDF_EXPLOIT_JS.search(norm.decode("latin-1"))
    if js:
        rep.add("pdf_exploit_js", "critical", "malware", "JavaScript calls used by known PDF reader exploits", "", None, norm.decode("latin-1")[max(0, js.start() - 40) : js.end() + 60])
    for name in re.findall(rb"/(?:F|UF)\s*\(([^)]{1,200}\.(?:exe|scr|js|vbs|bat|cmd|ps1|hta|jar|dll|app|command|sh|docm|xlsm))\)", norm, re.I):
        rep.add("pdf_embedded_program", "high", "malware", "Embedded file is a program or script", "", None, name.decode("latin-1"))
    rep.fact("streams", "%d (%d inflated)" % (streams, len(inflated)))
    scripts = [s for s in inflated if re.search(rb"app\.|this\.|eval|function|unescape|String\.fromCharCode|util\.|var |getField", s)]
    for i, s in enumerate(scripts[:4]):
        rep.detail("inflated script %d (%d bytes): %s" % (i + 1, len(s), clean(s, 220)))
    rep.fact("method", "metadata and keyword inspection (pdfid-style) over raw and inflated streams; nothing rendered")


# ── Office documents ─────────────────────────────────────────────────────────────────────────────

VBA_WORDS = re.compile(rb"(?i)AutoOpen|Auto_Open|Document_Open|Workbook_Open|AutoExec|Document_Close|Auto_Close|WScript\.Shell|CreateObject|URLDownloadToFile|powershell|cmd(\.exe)? /c|MSXML2\.XMLHTTP|ADODB\.Stream|Shell\s*\(|ExecuteExcel4Macro|CallByName|Environ\(")
AUTO_EXEC = re.compile(rb"(?i)AutoOpen|Auto_Open|Document_Open|Workbook_Open|AutoExec")


def vba_findings(rep, blob, where):
    words = sorted(set(m.group(0).decode("latin-1") for m in VBA_WORDS.finditer(blob)))
    auto = AUTO_EXEC.search(blob)
    risky = [w for w in words if not AUTO_EXEC.match(w.encode())]
    rep.add("office_macros", "high", "malware", "Contains VBA macros", "Keywords seen in %s: %s" % (where, ", ".join(words[:12]) or "none readable"))
    if auto and risky:
        rep.add("office_auto_macro", "critical", "malware", "Macro runs on open and reaches for the shell, network or files", ", ".join(risky[:8]))


def check_office(path, rep):
    head = read(path, 8)
    if zipfile.is_zipfile(path):
        rep.fact("format", "Office Open XML (zip)")
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            for name in names[:20000]:
                member_path_risk(rep, name)
            ctypes = z.read("[Content_Types].xml").decode("utf-8", "replace") if "[Content_Types].xml" in names else ""
            if re.search(r"macroEnabled|vbaProject", ctypes, re.I):
                rep.fact("content type", "macro-enabled")
            for name in names:
                low = name.lower()
                info = z.getinfo(name)
                if low.endswith("vbaproject.bin"):
                    vba_findings(rep, z.read(name)[: 8 * 2**20], name)
                elif "/embeddings/" in low or low.endswith(("oleobject.bin",)) or re.search(r"oleobject\d*\.bin$", low):
                    blob = z.read(name)[: 4 * 2**20]
                    program = re.search(rb"[\w\-. ]+\.(exe|scr|js|vbs|bat|cmd|ps1|hta|jar|dll|lnk)\x00", blob, re.I)
                    rep.add("office_embedded_object", "high" if program else "medium", "malware", "Embedded object%s" % (" carrying a program" if program else ""), "", None, name + (" -> " + program.group(0)[:-1].decode("latin-1") if program else ""))
                    if re.search(rb"(?i)Equation\.3|\x02\xce\x02\x00\x00\x00\x00\x00\xc0\x00\x00\x00\x00\x00\x00\x46", blob):
                        rep.add("office_equation_editor", "critical", "malware", "Equation Editor object (CVE-2017-11882 exploit vector)", "", None, name)
                elif "/activex/" in low:
                    rep.add("office_activex", "medium", "malware", "ActiveX control", "", None, name)
                elif low.startswith("xl/macrosheets/"):
                    rep.add("office_xlm_macro", "high", "malware", "Excel 4.0 (XLM) macro sheet", "Old macro language often used to evade macro scanners", None, name)
                if low.endswith(".rels") and info.file_size < 4 * 2**20:
                    rels = z.read(name).decode("utf-8", "replace")
                    for rel in re.finditer(r"<Relationship\b[^>]*>", rels):
                        tag = rel.group(0)
                        if 'TargetMode="External"' not in tag:
                            continue
                        target = (re.search(r'Target="([^"]*)"', tag) or [None, ""])[1]
                        kind = (re.search(r'Type="[^"]*/([^"/]+)"', tag) or [None, ""])[1]
                        if re.match(r"(?i)(mhtml:|ms-msdt:|search-ms:|ms-word:|ms-excel:)", target) or re.search(r"(?i)!x-usc:|\.html?!$", target):
                            rep.add("office_protocol_handler", "critical", "malware", "External link to a Windows protocol handler (Follina-style exploit)", "", None, "%s: %s" % (kind, target))
                        elif kind in ("attachedTemplate", "oleObject", "frame", "subDocument"):
                            rep.add("office_remote_template", "high", "malware", "Loads a remote %s when opened (template injection)" % kind, "", None, target)
                        elif kind != "hyperlink":
                            rep.add("office_external_relationship", "medium", "malware", "External relationship (%s)" % kind, "", None, target)
                        else:
                            rep.add("office_hyperlink", "low", "malware", "External hyperlink", "", None, target)
                if low.endswith(".xml") and info.file_size < 16 * 2**20:
                    xml = z.read(name).decode("utf-8", "replace")
                    if re.search(r"<!DOCTYPE|<!ENTITY", xml):
                        xml_checks(rep, xml, "office_xml")
                    dde = re.search(r"(DDEAUTO|DDE)\b[^<]{0,120}|ddeService=\"[^\"]*\"[^>]{0,80}", xml)
                    if dde:
                        rep.add("office_dde", "high", "malware", "DDE field runs a command", "", None, dde.group(0))
            rep.detail("parts: " + " | ".join(names[:60]))
    elif head.startswith(b"\xd0\xcf\x11\xe0"):
        rep.fact("format", "OLE2 compound file (legacy .doc/.xls/.ppt or .msi)")
        blob = read(path, BINARY_LIMIT)
        if re.search(rb"_VBA_PROJECT|V\x00B\x00A\x00|Attribute VB_", blob):
            vba_findings(rep, blob, "the OLE streams")
        if re.search(rb"(?i)Equation\.3|\x02\xce\x02\x00\x00\x00\x00\x00\xc0\x00\x00\x00\x00\x00\x00\x46", blob):
            rep.add("office_equation_editor", "critical", "malware", "Equation Editor object (CVE-2017-11882 exploit vector)")
        if re.search(rb"(?i)Ole10Native|Package\x00", blob):
            rep.add("office_embedded_object", "medium", "malware", "Embedded package object")
    elif head.startswith(b"{\\rt"):
        rep.fact("format", "RTF")
        blob = read(path, BINARY_LIMIT)
        for word, code, severity, title in (
            (rb"\\objupdate", "rtf_objupdate", "high", "Object updates itself on open"),
            (rb"\\objdata", "rtf_objdata", "medium", "Embedded object data"),
            (rb"(?i)equation\.3|0002ce02", "office_equation_editor", "critical", "Equation Editor object (CVE-2017-11882 exploit vector)"),
            (rb"\\objautlink|\\objlink", "rtf_linked_object", "medium", "Linked object"),
        ):
            if re.search(word, blob):
                rep.add(code, severity, "malware", title)
    else:
        rep.fact("format", "not an Office container")
    out = run_external(rep, "olevba", ["olevba", "--decode", "-a", path], timeout=90)
    if out:
        for l in [l for l in out.splitlines() if re.match(r"\|\s*(AutoExec|Suspicious|IOC)", l)][:15]:
            rep.detail("olevba: " + l)
    rep.fact("method", "OOXML inspection: parts, macros, embedded objects and external relationships; nothing opened")


# ── Images ───────────────────────────────────────────────────────────────────────────────────────

CODE_IN_IMAGE = re.compile(rb"<\?php|<script|eval\s*\(|base64_decode|\bsystem\s*\(|powershell|#!/bin/", re.I)
EMBEDDED_MAGIC = [(b"PK\x03\x04", "a ZIP archive"), (b"MZ\x90\x00", "a Windows program"), (b"%PDF-", "a PDF"), (b"\x7fELF", "a Linux program"), (b"<?php", "PHP code"), (b"<script", "a script")]


def trailing_payload(rep, data, end, fmt):
    rest = data[end:]
    if len(rest.strip(b"\x00\r\n ")) < 16:
        return
    found = [label for magic, label in EMBEDDED_MAGIC if magic in rest[:1 << 20]]
    rep.add(
        "image_appended_data",
        "high" if found else "medium",
        "malware",
        "Data after the end of the %s%s" % (fmt, (": " + ", ".join(found)) if found else ""),
        "%d extra bytes (hidden payload or polyglot)" % len(rest),
    )


def svg_checks(rep, text):
    rules = [
        Rule("svg_script", "high", "malware", "Script inside the SVG (runs when opened in a browser)", r"<script\b", flags=re.I),
        Rule("svg_event_handler", "high", "malware", "Event handler attribute runs script", r"\son[a-z]+\s*=\s*[\"']", flags=re.I),
        Rule("svg_javascript_url", "high", "malware", "javascript: link", r"(xlink:)?href\s*=\s*[\"']\s*javascript:", flags=re.I),
        Rule("svg_html_payload", "high", "malware", "Embeds HTML (data:text/html or foreignObject with forms)", r"data:text/html|<foreignObject[\s\S]{0,400}<(form|input|iframe)", flags=re.I),
        Rule("svg_foreign_object", "medium", "vulnerability", "foreignObject embeds HTML", r"<foreignObject\b", flags=re.I),
        Rule("svg_external_ref", "medium", "vulnerability", "Loads something from another site", r"(xlink:)?href\s*=\s*[\"']\s*(https?:|//|file:)", flags=re.I),
        Rule("svg_embedded_frame", "medium", "malware", "Embeds a frame or object", r"<(iframe|embed|object)\b", flags=re.I),
    ]
    scan_lines(rep, text, rules)
    xml_checks(rep, text, "svg")


def check_image(path, rep):
    data = read(path, BINARY_LIMIT)
    label, family, _ = sniff(data[:65536])
    rep.fact("format", label)
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        pos, bad_crc, chunks = 8, 0, []
        width = height = 0
        while pos + 8 <= len(data):
            length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
            body = data[pos + 8 : pos + 8 + length]
            crc = data[pos + 8 + length : pos + 12 + length]
            if len(crc) < 4:
                rep.add("image_truncated", "medium", "vulnerability", "Truncated PNG chunk (malformed image)")
                break
            if zlib.crc32(ctype + body) & 0xFFFFFFFF != struct.unpack(">I", crc)[0]:
                bad_crc += 1
            chunks.append(ctype.decode("latin-1"))
            if ctype == b"IHDR" and length >= 8:
                width, height = struct.unpack(">II", body[:8])
            if ctype in (b"tEXt", b"zTXt", b"iTXt", b"eXIf"):
                payload = body
                if ctype == b"zTXt" and b"\x00" in body:
                    try:
                        payload += zlib.decompressobj().decompress(body.split(b"\x00", 1)[1][1:], 1 << 20)
                    except zlib.error:
                        pass
                if CODE_IN_IMAGE.search(payload):
                    rep.add("image_code_in_metadata", "high", "malware", "Code hidden in the image's metadata", "", None, payload[:120])
            pos += 12 + length
            if ctype == b"IEND":
                trailing_payload(rep, data, pos, "PNG")
                break
        rep.fact("PNG", "%d x %d, chunks: %s" % (width, height, " ".join(chunks[:30])))
        if bad_crc:
            rep.add("image_bad_crc", "medium", "vulnerability", "%d chunk(s) with a wrong checksum (malformed image)" % bad_crc, "Decoders that don't check CRCs may misparse it")
        if width * height > 1e9 or width > 60000 or height > 60000:
            rep.add("image_huge_dimensions", "medium", "malware", "Claims %d x %d pixels (decompression bomb)" % (width, height))
    elif data.startswith(b"\xff\xd8\xff"):
        pos, width, height, eoi = 2, 0, 0, -1
        while pos + 4 <= len(data):
            if data[pos] != 0xFF:
                break
            marker = data[pos + 1]
            if marker == 0xD9:
                eoi = pos + 2
                break
            if marker in (0x01,) or 0xD0 <= marker <= 0xD7:
                pos += 2
                continue
            seg = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
            body = data[pos + 4 : pos + 2 + seg]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC) and len(body) >= 5:
                height, width = struct.unpack(">HH", body[1:5])
            if 0xE0 <= marker <= 0xEF or marker == 0xFE:
                if CODE_IN_IMAGE.search(body):
                    rep.add("image_code_in_metadata", "high", "malware", "Code hidden in the image's metadata", "", None, body[:120])
            if marker == 0xDA:
                eoi = data.rfind(b"\xff\xd9")
                eoi = eoi + 2 if eoi > pos else -1
                break
            pos += 2 + seg
        rep.fact("JPEG", "%d x %d" % (width, height))
        if eoi > 0:
            trailing_payload(rep, data, eoi, "JPEG")
        if width * height > 1e9:
            rep.add("image_huge_dimensions", "medium", "malware", "Claims %d x %d pixels (decompression bomb)" % (width, height))
    elif data.startswith((b"GIF87a", b"GIF89a")):
        width, height = struct.unpack("<HH", data[6:10])
        rep.fact("GIF", "%d x %d" % (width, height))
        if re.match(rb"GIF8[79]a/\*", data) or re.search(rb"\*/\s*=", data[:64]):
            rep.add("image_gif_js_polyglot", "high", "malware", "GIF that is also valid JavaScript (polyglot)")
        end = data.rfind(b"\x3b")
        if 0 < end < len(data) - 1:
            trailing_payload(rep, data, end + 1, "GIF")
    elif family == "image" and "SVG" in label or b"<svg" in data[:4096].lower():
        svg_checks(rep, to_text(data[:TEXT_LIMIT]))
    if family != "image":
        rep.add("image_not_an_image", "high", "malware", "Not actually an image: the bytes are %s" % label)
    elif "SVG" not in label and CODE_IN_IMAGE.search(data[: 4 * 2**20]):
        m = CODE_IN_IMAGE.search(data[: 4 * 2**20])
        rep.add("image_code_bytes", "medium", "malware", "Code-like text inside the image data", "", None, data[max(0, m.start() - 20) : m.end() + 80])
    rep.fact("method", "metadata inspection, structure walk and SVG sanitization review; nothing decoded for display")


# ── Keys and certificates ────────────────────────────────────────────────────────────────────────


def der_len(data, at):
    first = data[at]
    if first < 0x80:
        return first, at + 1
    n = first & 0x7F
    return int.from_bytes(data[at + 1 : at + 1 + n], "big"), at + 1 + n


def der_children(data, at=0):
    """Top-level children of the DER SEQUENCE at `at`: (tag, start of value, length)."""
    tag = data[at]
    length, start = der_len(data, at + 1)
    out, pos = [], start
    while pos < start + length and pos < len(data):
        t = data[pos]
        l, s = der_len(data, pos + 1)
        out.append((t, s, l))
        pos = s + l
    return tag, out


def rsa_bits(der):
    """Modulus size of a PKCS#1 or PKCS#8 RSA private key, or None."""
    try:
        _, kids = der_children(der)
        if len(kids) >= 3 and kids[1][0] == 0x30 and kids[2][0] == 0x04:  # PKCS#8 wrapper
            t, s, l = kids[2]
            return rsa_bits(der[s : s + l])
        if len(kids) >= 2 and kids[1][0] == 0x02:
            t, s, l = kids[1]
            modulus = der[s : s + l].lstrip(b"\x00")
            return len(modulus) * 8
    except (IndexError, ValueError):
        return None
    return None


WEAK_SIG_OIDS = {b"\x2a\x86\x48\x86\xf7\x0d\x01\x01\x04": "md5WithRSA", b"\x2a\x86\x48\x86\xf7\x0d\x01\x01\x05": "sha1WithRSA", b"\x2a\x86\x48\xce\x3d\x04\x01": "ecdsa-with-SHA1"}


def check_keys(path, rep):
    data = read(path, 4 * 2**20)
    text = to_text(data) if is_text(data) else ""
    blocks = re.findall(r"-----BEGIN ([A-Z0-9 ]+)-----(.*?)-----END \1-----", text, re.S)
    rep.fact("PEM blocks", ", ".join(b[0] for b in blocks) if blocks else "none")
    for kind, body in blocks:
        headers = body.split("\n\n", 1)[0] if "Proc-Type:" in body else ""
        b64 = re.sub(r"[^A-Za-z0-9+/=]", "", body.split("\n\n", 1)[-1] if headers else body)
        try:
            der = base64.b64decode(b64 + "=" * (-len(b64) % 4))
        except ValueError:
            der = b""
        if "PRIVATE KEY" in kind:
            encrypted = "ENCRYPTED" in kind or "ENCRYPTED" in headers
            if kind == "OPENSSH PRIVATE KEY" and der.startswith(b"openssh-key-v1\x00"):
                cipher_len = struct.unpack(">I", der[15:19])[0]
                encrypted = der[19 : 19 + cipher_len] != b"none"
            rep.add(
                "private_key_encrypted" if encrypted else "private_key_exposed",
                "medium" if encrypted else "critical",
                "vulnerability",
                "Private key (%s)%s" % (kind.replace(" PRIVATE KEY", "") or "PKCS#8", ", encrypted" if encrypted else ", not encrypted: anyone with the file can use it"),
                "Still sensitive: its passphrase can be guessed offline" if encrypted else "Treat it as compromised and replace it",
            )
            bits = rsa_bits(der) if not encrypted and kind in ("RSA PRIVATE KEY", "PRIVATE KEY") else None
            if bits:
                rep.fact("RSA key size", "%d bits" % bits)
                if bits < 2048:
                    rep.add("weak_rsa_key", "high", "vulnerability", "Weak RSA key (%d bits; use 2048 or more)" % bits)
            if kind == "DSA PRIVATE KEY":
                rep.add("weak_dsa_key", "medium", "vulnerability", "DSA keys are deprecated")
        elif kind in ("CERTIFICATE", "X509 CERTIFICATE"):
            for oid, name in WEAK_SIG_OIDS.items():
                if oid in der[:2048]:
                    rep.add("weak_signature", "medium", "vulnerability", "Certificate signed with %s (weak)" % name)
    if "PuTTY-User-Key-File" in text:
        enc = re.search(r"Encryption:\s*(\S+)", text)
        if enc and enc.group(1) == "none":
            rep.add("private_key_exposed", "critical", "vulnerability", "PuTTY private key, not encrypted")
        else:
            rep.add("private_key_encrypted", "medium", "vulnerability", "PuTTY private key, encrypted")
    if not text and data[:1] == b"\x30":
        rep.fact("format", "DER/PKCS#12 binary")
        rep.add("pkcs12_bundle", "medium", "vulnerability", "Binary key bundle (PKCS#12 or DER key)", "Usually holds a private key; check whether its password is empty or weak")
        out = run_external(rep, "openssl", ["openssl", "pkcs12", "-info", "-noout", "-passin", "pass:"], stdin=data, timeout=20)
        if out is not None and "MAC verified OK" in out:
            rep.add("pkcs12_no_password", "critical", "vulnerability", "PKCS#12 bundle opens with an empty password")
    elif blocks and shutil.which("openssl") and any(b[0] == "CERTIFICATE" for b in blocks):
        out = run_external(rep, "openssl", ["openssl", "x509", "-noout", "-subject", "-issuer", "-dates", "-text"], stdin=data, timeout=20)
        for line in (out or "").splitlines():
            if re.search(r"Subject:|Issuer:|Not (Before|After)|Public-Key:|Signature Algorithm", line):
                rep.detail("openssl: " + line.strip())
    rep.fact("file permissions", "not meaningful here: Aegis set them at upload; on disk a key should be readable by its owner only (0600)")
    rep.fact("method", "secret scanning and key/certificate inspection; no key is used")


# ── Binaries ─────────────────────────────────────────────────────────────────────────────────────

API_GROUPS = [
    ("api_injection", "high", "malware", "Process injection APIs", {"VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread", "NtUnmapViewOfSection", "QueueUserAPC", "SetThreadContext", "NtWriteVirtualMemory", "RtlCreateUserThread", "task_for_pid", "mach_vm_write", "thread_create_running"}),
    ("api_keylogging", "high", "malware", "Keyboard capture APIs", {"SetWindowsHookExA", "SetWindowsHookExW", "GetAsyncKeyState", "GetKeyboardState", "CGEventTapCreate"}),
    ("api_anti_debug", "medium", "malware", "Anti-debugging APIs", {"IsDebuggerPresent", "CheckRemoteDebuggerPresent", "NtQueryInformationProcess", "OutputDebugStringA", "ptrace"}),
    ("api_download", "medium", "malware", "Downloads from the internet", {"URLDownloadToFileA", "URLDownloadToFileW", "InternetOpenUrlA", "InternetOpenUrlW", "InternetReadFile", "WinHttpOpen", "HttpSendRequestA"}),
    ("api_execute", "medium", "malware", "Starts other programs", {"WinExec", "ShellExecuteA", "ShellExecuteW", "ShellExecuteExW", "CreateProcessA", "CreateProcessW", "system", "execve", "execvp", "popen", "posix_spawn", "NSTask"}),
    ("api_crypto", "low", "malware", "File encryption APIs (ransomware if combined with file walking)", {"CryptEncrypt", "BCryptEncrypt", "CryptGenKey", "CCCrypt"}),
    ("api_persistence", "medium", "malware", "Registry or service changes (persistence)", {"RegSetValueExA", "RegSetValueExW", "RegCreateKeyExA", "CreateServiceA", "CreateServiceW", "SMLoginItemSetEnabled", "LSSharedFileListInsertItemURL"}),
    ("api_unsafe_c", "medium", "vulnerability", "Unsafe C library calls (memory corruption)", {"gets", "strcpy", "strcat", "sprintf", "vsprintf", "wcscpy", "lstrcpyA", "lstrcpyW", "scanf"}),
    ("api_dynamic_load", "low", "malware", "Loads code at run time", {"LoadLibraryA", "LoadLibraryW", "GetProcAddress", "dlopen", "dlsym", "NSCreateObjectFileImageFromMemory"}),
    ("api_memory_protect", "low", "malware", "Makes memory executable", {"VirtualProtect", "VirtualAlloc", "mprotect", "vm_protect"}),
]


def report_imports(rep, names):
    names = set(names)
    for code, severity, kind, title, group in API_GROUPS:
        hit = sorted(names & group)
        if hit:
            rep.add(code, severity, kind, title, ", ".join(hit[:10]))


def section_entropy(rep, name, blob):
    e = entropy(blob[: 4 * 2**20])
    if e > 7.2 and len(blob) > 4096:
        rep.add("packed_section", "medium", "malware", "Section %s looks packed or encrypted (entropy %.2f)" % (name, e))
    return e


def pe_info(rep, data):
    off = u32(data, 0x3C)
    if data[off : off + 4] != b"PE\x00\x00":
        rep.add("pe_bad_header", "medium", "malware", "MZ header without a valid PE header")
        return
    machine, nsec, stamp, _, _, opt_size, chars = struct.unpack_from("<HHIIIHH", data, off + 4)
    opt = off + 24
    magic = u16(data, opt)
    is64 = magic == 0x20B
    dll_chars = u16(data, opt + 70)
    ndirs = u32(data, opt + (108 if is64 else 92))
    dirs_at = opt + (112 if is64 else 96)
    dirs = [struct.unpack_from("<II", data, dirs_at + 8 * i) for i in range(min(ndirs, 16))]
    sections = []
    for i in range(min(nsec, 96)):
        s = opt + opt_size + 40 * i
        name = data[s : s + 8].rstrip(b"\x00").decode("latin-1")
        vsize, vaddr, rsize, rptr = struct.unpack_from("<IIII", data, s + 8)
        flags = u32(data, s + 36)
        sections.append((name, vsize, vaddr, rsize, rptr, flags))
    rep.fact("PE", "%s, %s, %d sections, built %s" % ("64-bit" if is64 else "32-bit", "DLL" if chars & 0x2000 else "EXE", nsec, time.strftime("%Y-%m-%d", time.gmtime(stamp)) if stamp else "?"))

    def rva(r):
        for name, vsize, vaddr, rsize, rptr, flags in sections:
            if vaddr <= r < vaddr + max(vsize, rsize):
                return rptr + r - vaddr
        return -1

    missing = [n for bit, n in ((0x40, "ASLR"), (0x100, "DEP/NX"), (0x4000, "Control Flow Guard")) if not dll_chars & bit]
    if missing:
        rep.add("pe_hardening_missing", "low", "vulnerability", "Built without " + ", ".join(missing), "Memory-corruption bugs are easier to exploit")
    descs = []
    for name, vsize, vaddr, rsize, rptr, flags in sections:
        e = section_entropy(rep, name, data[rptr : rptr + rsize])
        if flags & 0x20000000 and flags & 0x80000000:
            rep.add("pe_wx_section", "medium", "malware", "Section %s is writable and executable" % name)
        descs.append("%s(%.1f)" % (name, e))
        if name.startswith(("UPX", ".aspack", ".petite", ".themida", ".vmp")):
            rep.add("pe_packer", "medium", "malware", "Packed with a known packer (%s)" % name)
    rep.fact("sections (entropy)", " ".join(descs))
    imports, dlls = [], []
    if len(dirs) > 1 and dirs[1][0]:
        at = rva(dirs[1][0])
        while at > 0 and len(dlls) < 256:
            oft, _, _, name_rva, ft = struct.unpack_from("<IIIII", data, at)
            if not (oft or name_rva or ft):
                break
            dlls.append(cstring(data, rva(name_rva)))
            thunk = rva(oft or ft)
            step, high = (8, 1 << 63) if is64 else (4, 1 << 31)
            while thunk > 0 and len(imports) < 4096:
                value = struct.unpack_from("<Q" if is64 else "<I", data, thunk)[0]
                if not value:
                    break
                name_at = rva(value & 0x7FFFFFFF) if not value & high else -1
                if name_at >= 0:
                    imports.append(cstring(data, name_at + 2))
                thunk += step
            at += 20
    exports = []
    if dirs and dirs[0][0]:
        at = rva(dirs[0][0])
        if at > 0:
            count, names_rva = u32(data, at + 24), u32(data, at + 32)
            names_at = rva(names_rva)
            for i in range(min(count, 2000)):
                if names_at < 0:
                    break
                exports.append(cstring(data, rva(u32(data, names_at + 4 * i))))
    rep.fact("imported DLLs", ", ".join(dlls[:30]) or "none")
    if exports:
        rep.fact("exports", ", ".join(exports[:30]) + (" (+%d)" % (len(exports) - 30) if len(exports) > 30 else ""))
    report_imports(rep, imports)
    signed = len(dirs) > 4 and dirs[4][1] > 0
    rep.fact("Authenticode signature", "present (not verified here)" if signed else "none")
    if len(dirs) > 14 and dirs[14][0]:
        rep.fact(".NET", "managed assembly (decompile with ILSpy or dnSpy for a full review)")
    if len(dirs) > 9 and dirs[9][0]:
        rep.add("pe_tls_callbacks", "low", "malware", "TLS callbacks (code that runs before the entry point)")
    end = max([rptr + rsize for _, _, _, rsize, rptr, _ in sections] or [0])
    overlay = len(data) - end - (dirs[4][1] if signed else 0)
    if overlay > 4096:
        rep.add("pe_overlay", "medium", "malware", "%d bytes appended after the last section (overlay)" % overlay, "Installers do this; so do droppers")


def elf_info(rep, data):
    is64, end = data[4] == 2, "<" if data[5] == 1 else ">"
    if is64:
        e_type, machine, _, entry, phoff, shoff, _, _, phsize, phnum, shsize, shnum, shstrndx = struct.unpack_from(end + "HHIQQQIHHHHHH", data, 16)
    else:
        e_type, machine, _, entry, phoff, shoff, _, _, phsize, phnum, shsize, shnum, shstrndx = struct.unpack_from(end + "HHIIIIIHHHHHH", data, 16)
    progs = []
    for i in range(min(phnum, 128)):
        p = phoff + i * phsize
        if is64:
            ptype, pflags = struct.unpack_from(end + "II", data, p)
        else:
            ptype, pflags = struct.unpack_from(end + "I", data, p)[0], struct.unpack_from(end + "I", data, p + 24)[0]
        progs.append((ptype, pflags))
    types = dict(progs)
    sections = []
    for i in range(min(shnum, 512)):
        s = shoff + i * shsize
        if s + shsize > len(data):
            break
        if is64:
            name, stype, _, _, offset, size, link, _, _, entsize = struct.unpack_from(end + "IIQQQQIIQQ", data, s)
        else:
            name, stype, _, _, offset, size, link, _, _, entsize = struct.unpack_from(end + "IIIIIIIIII", data, s)
        sections.append([name, stype, offset, size, link, entsize])
    if 0 <= shstrndx < len(sections):
        strtab = sections[shstrndx][2]
        for s in sections:
            s[0] = cstring(data, strtab + s[0])
    rep.fact("ELF", "%s, %s, type %s, machine %d" % ("64-bit" if is64 else "32-bit", "little-endian" if end == "<" else "big-endian", {1: "relocatable", 2: "executable", 3: "shared/PIE", 4: "core"}.get(e_type, e_type), machine))
    imports, exports, needed, flags = [], [], [], 0
    for name, stype, offset, size, link, entsize in sections:
        if stype == 11 and 0 <= link < len(sections):
            strtab = sections[link][2]
            step = 24 if is64 else 16
            for at in range(offset, min(offset + size, len(data)), step):
                if is64:
                    st_name, info, _, shndx = struct.unpack_from(end + "IBBH", data, at)
                else:
                    st_name, _, _, info, _, shndx = struct.unpack_from(end + "IIIBBH", data, at)
                sym = cstring(data, strtab + st_name)
                if sym:
                    (imports if shndx == 0 else exports).append(sym)
        if stype == 6 and 0 <= link < len(sections):
            strtab = sections[link][2]
            step = 16 if is64 else 8
            for at in range(offset, min(offset + size, len(data)), step):
                tag, val = struct.unpack_from(end + ("qQ" if is64 else "iI"), data, at)
                if tag == 0:
                    break
                if tag == 1:
                    needed.append(cstring(data, strtab + val))
                if tag in (15, 29):
                    rp = cstring(data, strtab + val)
                    if not rp.startswith("/") or "$ORIGIN/.." in rp:
                        rep.add("elf_relative_rpath", "medium", "vulnerability", "Relative library search path (library hijacking)", "", None, rp)
                if tag == 30:
                    flags |= val
        if name and stype == 1 and size > 4096:
            section_entropy(rep, name, data[offset : offset + size])
    stack = types.get(0x6474E551)
    missing = []
    if stack is None or stack & 1:
        missing.append("NX stack")
    if 0x6474E552 not in types:
        missing.append("RELRO")
    if e_type == 2:
        missing.append("PIE")
    if imports and "__stack_chk_fail" not in imports:
        missing.append("stack canaries")
    if missing and e_type in (2, 3):
        rep.add("elf_hardening_missing", "low", "vulnerability", "Built without " + ", ".join(missing), "Memory-corruption bugs are easier to exploit")
    if b"UPX!" in data[:4096] or b"UPX!" in data[-4096:]:
        rep.add("elf_packer", "medium", "malware", "Packed with UPX")
    if not any(s[1] == 2 for s in sections):
        rep.fact("symbols", "stripped (no .symtab)")
    rep.fact("needed libraries", ", ".join(needed[:30]) or "none")
    if exports:
        rep.fact("exports", ", ".join(exports[:30]) + (" (+%d)" % (len(exports) - 30) if len(exports) > 30 else ""))
    report_imports(rep, imports)


def macho_info(rep, data, at=0):
    magic = data[at : at + 4]
    if magic == b"\xca\xfe\xba\xbe":
        n = u32(data, at + 4, ">")
        rep.fact("universal binary", "%d architectures" % n)
        return macho_info(rep, data, u32(data, at + 16, ">")) if n else None
    end = "<" if magic in (b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe") else ">"
    is64 = magic in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf")
    _, cpu, _, ftype, ncmds, _, flags = struct.unpack_from(end + "IiiIIII", data, at)
    pos = at + (32 if is64 else 28)
    dylibs, signed, rpaths = [], False, []
    for _ in range(min(ncmds, 512)):
        if pos + 8 > len(data):
            break
        cmd, size = struct.unpack_from(end + "II", data, pos)
        if cmd in (0xC, 0x80000018, 0x8000001F, 0xD):
            dylibs.append(cstring(data, pos + u32(data, pos + 8, end)))
        elif cmd == 0x1D:
            signed = True
        elif cmd == 0x8000001C:
            rpaths.append(cstring(data, pos + u32(data, pos + 8, end)))
        elif cmd in (0x19, 0x1):
            seg = data[pos + 8 : pos + 24].rstrip(b"\x00").decode("latin-1")
            prot_at = pos + (56 if is64 else 40)
            initprot = u32(data, prot_at + 4, end)
            if initprot & 0x2 and initprot & 0x4:
                rep.add("macho_wx_segment", "medium", "malware", "Segment %s is writable and executable" % seg)
        if size < 8:
            break
        pos += size
    rep.fact("Mach-O", "%s, cpu %d, file type %d, %d load commands" % ("64-bit" if is64 else "32-bit", cpu, ftype, ncmds))
    rep.fact("linked libraries", ", ".join(dylibs[:30]) or "none")
    if not signed:
        rep.add("macho_unsigned", "medium", "malware", "Not code-signed", "macOS warns about unsigned programs; malware often is")
    if ftype == 2 and not flags & 0x200000:
        rep.add("macho_no_pie", "low", "vulnerability", "Built without PIE (no ASLR)")
    if flags & 0x20000:
        rep.add("macho_exec_stack", "medium", "vulnerability", "Executable stack allowed")
    for rp in rpaths:
        if rp.startswith(("@executable_path/..", "@loader_path/..")) or not rp.startswith(("/", "@")):
            rep.add("macho_relative_rpath", "low", "vulnerability", "Relative library search path (dylib hijacking)", "", None, rp)


def leb(data, pos):
    result = shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        shift += 7
        if not b & 0x80:
            return result, pos


def wasm_name(data, pos):
    n, pos = leb(data, pos)
    return data[pos : pos + n].decode("utf-8", "replace"), pos + n


def wasm_info(rep, data):
    pos, imports, exports, sections = 8, [], [], []
    try:
        while pos < len(data):
            sid = data[pos]
            size, pos = leb(data, pos + 1)
            body_end = pos + size
            sections.append(sid)
            if sid == 2:
                count, p = leb(data, pos)
                for _ in range(min(count, 5000)):
                    mod, p = wasm_name(data, p)
                    field, p = wasm_name(data, p)
                    kind = data[p]
                    p += 1
                    if kind == 0:
                        _, p = leb(data, p)
                    elif kind == 1:
                        p += 1
                        flag = data[p]
                        _, p = leb(data, p + 1)
                        if flag & 1:
                            _, p = leb(data, p)
                    elif kind == 2:
                        flag = data[p]
                        _, p = leb(data, p + 1)
                        if flag & 1:
                            _, p = leb(data, p)
                    elif kind == 3:
                        p += 2
                    else:
                        _, p = leb(data, p + 1)
                    imports.append("%s.%s" % (mod, field))
            if sid == 7:
                count, p = leb(data, pos)
                for _ in range(min(count, 5000)):
                    name, p = wasm_name(data, p)
                    kind = data[p]
                    _, p = leb(data, p + 1)
                    exports.append((name, kind))
            pos = body_end
    except (IndexError, ValueError):
        rep.add("wasm_malformed", "medium", "vulnerability", "Malformed WebAssembly module")
    rep.fact("WebAssembly", "version %d, sections %s" % (u32(data, 4), " ".join(str(s) for s in sections[:40])))
    rep.fact("imports", ", ".join(imports[:30]) or "none")
    rep.fact("exports", ", ".join("%s(%s)" % (n, {0: "func", 1: "table", 2: "memory", 3: "global"}.get(k, k)) for n, k in exports[:30]) or "none")
    risky = [i for i in imports if re.search(r"(system|exec|spawn|eval|sock_|path_open|proc_|fd_write|environ)", i)]
    if risky:
        rep.add("wasm_risky_imports", "medium", "vulnerability", "Imports host functions that reach the system", ", ".join(risky[:10]))
    if any(k == 2 for _, k in exports):
        rep.add("wasm_exported_memory", "low", "vulnerability", "Exports its memory (the host can read and write it)")
    if 8 in sections:
        rep.fact("start function", "runs code as soon as it is instantiated")


def check_binary(path, rep):
    data = read(path, BINARY_LIMIT)
    label, _, _ = sniff(data[:4096])
    rep.fact("format", label)
    try:
        if data.startswith(b"\x7fELF"):
            elf_info(rep, data)
        elif data.startswith(b"MZ"):
            pe_info(rep, data)
        elif data[:4] in (b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe") or label.startswith("Mach-O"):
            macho_info(rep, data)
        elif data.startswith(b"\x00asm"):
            wasm_info(rep, data)
        else:
            rep.fact("parser", "no executable header recognised; strings only")
    except (struct.error, IndexError, ValueError) as err:
        rep.add("binary_malformed", "medium", "malware", "Malformed executable headers (parser confusion)", str(err)[:100])
    found = strings_of(data)
    scan_strings(rep, found)
    scan_secrets(rep, "\n".join(found))
    rep.fact("entropy", "%.2f bits/byte overall" % entropy(data[: 8 * 2**20]))
    rep.fact("method", "binary analysis: headers, hardening, imports/exports (symbol inspection) and strings; fuzzing needs a harness and is not run")


def check_capa(path, rep):
    out = run_external(rep, "capa", ["capa", "-q", path], timeout=150)
    if out:
        for line in [l for l in out.splitlines() if l.strip()][:60]:
            rep.detail(line)
        if re.search(r"(?i)inject|keylog|persist|ransom|anti-(debug|vm)|credential", out):
            rep.add("capa_capabilities", "high", "malware", "capa matched malicious capabilities", "See the details")
    rep.fact("method", "capa capability rules (FLARE) over the binary")


CHECKS = {
    "identify": ("What the file really is", check_identify),
    "strings": ("Readable strings", check_strings),
    "secrets": ("Secret scanning", check_secrets),
    "c": ("C/C++ static review", check_c),
    "python": ("Python code review", check_python),
    "javascript": ("JavaScript/TypeScript/HTML review", check_javascript),
    "php": ("PHP code review", check_php),
    "sql": ("SQL query review", check_sql),
    "shell": ("Shell / PowerShell review", check_shell),
    "json": ("JSON inspection", check_json),
    "xml": ("XML parser-risk inspection", check_xml),
    "yaml": ("YAML and CI/CD inspection", check_yaml),
    "archive": ("Archive inspection (nothing extracted)", check_archive),
    "pdf": ("PDF inspection", check_pdf),
    "office": ("Office document inspection", check_office),
    "image": ("Image inspection", check_image),
    "config": ("Configuration review", check_config),
    "keys": ("Key and certificate inspection", check_keys),
    "binary": ("Binary analysis", check_binary),
    "capa": ("capa capability scan", check_capa),
}


def main(argv):
    if len(argv) != 3 or argv[1] not in CHECKS:
        sys.stderr.write("usage: aegis_inspect.py <%s> <file>\n" % "|".join(CHECKS))
        return 2
    check, path = argv[1], argv[2]
    title, fn = CHECKS[check]
    rep = Report(check, title)
    try:
        fn(path, rep)
    except Exception as err:  # A hostile file must not stop the report: say what broke.
        rep.add("inspector_error", "low", "vulnerability", "The %s check stopped early" % check, "%s: %s" % (type(err).__name__, str(err)[:160]))
    rep.emit()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
