"""The Chalk sandbox that holds the sample: network off, tools baked in, deleted in a `finally`.

Network off means an empty host allow-list *and* every IPv4 route denied (Chalk sandboxes on the
`host` compute class are open by default; denied routes win over everything; Chalk takes IPv4 CIDRs
only, so IPv6 is covered by the probe).
It is proven off from inside, with the same probes `try-daytona` uses, before the sample goes in;
a sandbox that can reach anything is terminated and refused.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator

from . import playbook

SAMPLE_PATH = "/sample/file"
TOOLS_PATH = "/opt/aegis/sandbox_tools.py"
PLAYBOOK_PATH = "/opt/aegis/playbook.md"
LIFETIME = "600s"  # a backstop: the sandbox is terminated in a finally long before this

# An ordinary site, a package registry, Chalk's own API, and raw IPv4 and IPv6 addresses (Chalk's
# denied_routes take IPv4 CIDRs only, so IPv6 is proven blocked here rather than assumed).
PROBE_URLS = [
    "https://example.com",
    "https://registry.npmjs.org/",
    "https://api.chalk.ai",
    "http://1.1.1.1",
    "http://[2606:4700:4700::1111]",
]


def image() -> Any:
    """Debian + the playbook's tools. Content-addressed, so Chalk builds it once and reuses it."""
    from chalkcompute import Image

    here = Path(__file__).resolve().parent
    return (
        Image.debian_slim("3.12")
        .run_commands(
            "apt-get update && apt-get install -y --no-install-recommends "
            "file binutils shellcheck libxml2-utils openssl curl wget && rm -rf /var/lib/apt/lists/*"
        )
        .pip_install(["bandit==1.8.6", "oletools==0.60.2"])
        # Uploaded when the sandbox starts (strategy "copy" caps files at 32 KiB; the tools are larger).
        .add_local_file(str(here / "sandbox_tools.py"), TOOLS_PATH)
        .add_local_file(playbook.load_path(), PLAYBOOK_PATH)
    )


def network_off() -> Any:
    from chalkcompute import NetworkPolicy

    # No hostnames allowed, and every IPv4 route denied (Chalk accepts IPv4 CIDRs only here; the
    # IPv6 probe covers the rest).
    return NetworkPolicy(allowed_hosts=[], denied_routes=["0.0.0.0/0"])


def probe_command() -> str:
    """Every URL with curl and python at once; prints REACHED lines, or BLOCKED."""
    jobs = []
    for u in PROBE_URLS:
        jobs.append(f'(timeout 8 curl -sS -m 5 -o /dev/null {u} && echo "REACHED curl {u}" >> "$P/hits") 2>/dev/null &')
        jobs.append(
            f"(timeout 8 python3 -c \"import urllib.request; urllib.request.urlopen('{u}', timeout=5)\" "
            f'&& echo "REACHED python {u}" >> "$P/hits") 2>/dev/null &'
        )
    return "\n".join(['P=$(mktemp -d)', *jobs, "wait", 'if [ -s "$P/hits" ]; then cat "$P/hits"; else echo BLOCKED; fi'])


@dataclass
class LogEntry:
    at: str
    step: str
    ok: bool
    ms: int
    detail: str


class SampleSandbox:
    """One sample in one network-off sandbox, with the log of everything done to it."""

    def __init__(self, sandbox: Any, log: list[dict] | None = None):
        self.sandbox = sandbox
        self.log: list[dict] = log if log is not None else []

    @property
    def id(self) -> str:
        return str(self.sandbox.id)

    def record(self, step: str, ok: bool, started: float, detail: str) -> None:
        self.log.append(asdict(LogEntry(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), step, ok,
                                        int((time.monotonic() - started) * 1000), detail[:300])))

    def exec(self, *cmd: str, timeout: int = 90) -> Any:
        return self.sandbox.exec(*cmd, timeout_secs=timeout)

    def prove_network_off(self) -> bool:
        t0 = time.monotonic()
        r = self.exec("sh", "-c", probe_command(), timeout=40)
        out = (r.stdout_text or "").strip()
        ok = r.exit_code == 0 and out == "BLOCKED"
        self.record(f"network probe ({len(PROBE_URLS)} hosts × curl, python)", ok, t0, "all blocked" if ok else out.replace("\n", "; "))
        return ok

    def upload(self, data: bytes) -> str:
        t0 = time.monotonic()
        want = hashlib.sha256(data).hexdigest()
        # Chalk's upload won't create parent folders (NotFound, errno 2).
        self.exec("mkdir", "-p", "-m", "700", SAMPLE_PATH.rsplit("/", 1)[0], timeout=30)
        self.sandbox.fs.write_bytes(SAMPLE_PATH, data, mode=0o600)
        got = (self.exec("sha256sum", SAMPLE_PATH, timeout=30).stdout_text or "").split()
        ok = bool(got) and got[0] == want
        self.record("upload + SHA-256 check", ok, t0, f"{len(data)} bytes, sha256 {want[:16]}…" + ("" if ok else f" sandbox has {got[:1]}"))
        if not ok:
            raise RuntimeError("the sample's SHA-256 didn't match inside the sandbox")
        return want

    def logged(self, via: str, executor: Any) -> Any:
        """Wraps another way of running tools (the MCP Gateway) so its calls land in this log too."""

        def run(tool: str, args: list[str]) -> dict:
            t0 = time.monotonic()
            out = executor(tool, args)
            self.record(f"tool {tool} {' '.join(args)} (via {via})".strip(), "error" not in out, t0, f"{len(json.dumps(out, default=str))} bytes")
            return out

        return run

    def run_tool(self, tool: str, args: list[str]) -> dict:
        """One fixed tool from sandbox_tools.py on the sample. The agent never types a command."""
        t0 = time.monotonic()
        r = self.exec("python3", TOOLS_PATH, tool, SAMPLE_PATH, *[str(a) for a in args], timeout=120)
        try:
            out = json.loads(r.stdout_text or "{}")
        except json.JSONDecodeError:
            out = {"error": f"tool printed no JSON (exit {r.exit_code}): {(r.stderr_text or '')[:300]}"}
        self.record(f"tool {tool} {' '.join(args)}".strip(), "error" not in out, t0, f"exit {r.exit_code}, {len(r.stdout_text or '')} bytes")
        return out


@contextmanager
def sample_sandbox(data: bytes, *, scan_id: str | None = None, log: list[dict] | None = None) -> Iterator[SampleSandbox]:
    """Create → prove the network is off → upload and verify → yield → terminate, always.
    `log` collects every step, including a refusal before the sample ever went in."""
    from chalkcompute import Sandbox

    t0 = time.monotonic()
    sb = Sandbox(
        image=image(),
        name=f"aegis-b-{(scan_id or uuid.uuid4().hex)[:12]}",
        network_policy=network_off(),
        lifetime=LIFETIME,
        cpu="1",
        memory="2Gi",
        tags={"app": "aegis", "worker": "b"},
    ).run()
    box = SampleSandbox(sb, log)
    box.record("create (Chalk sandbox, gVisor, network policy: no hosts, all routes denied)", True, t0, f"sandbox {box.id}")
    try:
        if not box.prove_network_off():
            raise RuntimeError(f"Chalk sandbox {box.id} could reach the network; refused before any sample went in")
        box.upload(data)
        yield box
    finally:
        t1 = time.monotonic()
        try:
            sb.terminate(grace_period_seconds=5)
            box.record("terminate", True, t1, box.id)
        except Exception as e:  # noqa: BLE001 - record it; the lifetime is the backstop
            box.record("terminate", False, t1, f"{box.id}: {e}")
