"""Worker B end to end: one file in, one result out.

    sample → Chalk sandbox (network off, proven) → agent through the Model Gateway → result

The result carries the analyst's report, every tool call, and the sandbox's own log (create,
network probe, upload check, each tool, terminate), so the Aegis report can show what happened
in Chalk. If the Model Gateway can't be reached the playbook's rules still run in the sandbox and
the result says "rules only".

Run by the app (`python -m aegis_worker_b.worker < request.json`), by the Chalk Function in
function.py, and by the evals.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import time
from dataclasses import asdict
from typing import Any, Callable

from . import agent
from .chalk_sandbox import sample_sandbox


def run(
    filename: str,
    data: bytes,
    *,
    scan_id: str | None = None,
    use_agent: bool = True,
    log: Callable[[str], None] = lambda _: None,
) -> dict:
    started = time.monotonic()
    sha = hashlib.sha256(data).hexdigest()
    out: dict[str, Any] = {"worker": "B", "provider": "chalk", "filename": filename, "sha256": sha, "size": len(data)}
    sandbox_log: list[dict] = []
    try:
        with sample_sandbox(data, scan_id=scan_id, log=sandbox_log) as box:
            out["sandbox_id"] = box.id
            log(f"sandbox {box.id} ready, network off, sample verified")
            result: agent.AgentResult | None = None
            if use_agent:
                try:
                    client = agent.gateway_client()
                    model = agent.gateway_model(client)
                    result = agent.analyze(
                        filename=filename, sha256=sha, size=len(data), head=data[:4096],
                        run_tool=box.run_tool, messages_api=client.messages, model=model, log=log,
                    )
                except Exception as e:  # noqa: BLE001 - the gateway is optional; rules still run
                    out["analyst_error"] = f"{type(e).__name__}: {e}"[:400]
                    log(f"analyst unavailable: {out['analyst_error']}")
            if result is None:
                result = agent.baseline(filename=filename, head=data[:4096], run_tool=box.run_tool)
            out["analysis"] = asdict(result)
    except Exception as e:  # noqa: BLE001 - Worker B missing is a result the app handles
        out["error"] = f"{type(e).__name__}: {e}"[:500]
    finally:
        out["sandbox_log"] = sandbox_log
        out["ms"] = int((time.monotonic() - started) * 1000)
    return out


def main() -> int:
    """stdin: {"filename", "data_b64", "scan_id"?, "use_agent"?}; stdout: the result JSON.
    Progress goes to stderr, one line per step."""
    req = json.load(sys.stdin)
    if req.get("via") == "function":
        # The deployed Chalk Function: the agent runs on Chalk Compute.
        # Not imported from function.py: importing that module deploys the Function.
        from chalkcompute import RemoteFunction

        print("calling the Chalk Function aegis_worker_b", file=sys.stderr, flush=True)
        fn = RemoteFunction.from_name("aegis_worker_b")
        sys.stdout.write(fn.remote(req["filename"], req["data_b64"]))
        return 0
    data = base64.b64decode(req["data_b64"])
    res = run(
        req["filename"], data, scan_id=req.get("scan_id"), use_agent=req.get("use_agent", True),
        log=lambda m: print(m, file=sys.stderr, flush=True),
    )
    json.dump(res, sys.stdout)
    return 0 if "error" not in res else 1


if __name__ == "__main__":
    sys.exit(main())
