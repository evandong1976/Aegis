"""pnpm try:chalk — checks every Chalk piece Worker B uses, then runs one harmless sample end to end.

1. Auth: the service token in .env.local gets a Chalk access token.
2. Model Gateway: lists models; finds claude-opus-5-5 (or AEGIS_CHALK_MODEL).
3. MCP Gateway: answers initialize (lists registered tools).
4. Sandbox: builds the image, creates the sandbox with the network off, proves it off from inside
   (probes must all fail), uploads and hash-checks a sample, runs one tool, terminates.
5. Worker B: the demo shell script (`sh-dropper`, harmless) through the agent; prints the verdict.

Writes everything to logs/<date-time>-try-chalk/. Exits 1 if any step fails.
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "logs" / f"{time.strftime('%Y-%m-%d-%H%M')}-try-chalk"
OUT.mkdir(parents=True, exist_ok=True)
results: list[dict] = []


def step(name):
    def wrap(fn):
        t0 = time.monotonic()
        try:
            detail = fn()
            ok = True
        except Exception as e:  # noqa: BLE001
            detail = f"{type(e).__name__}: {e}"
            (OUT / f"{name.split()[0]}-traceback.txt").write_text(traceback.format_exc())
            ok = False
        results.append({"step": name, "ok": ok, "s": round(time.monotonic() - t0, 1), "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {name}  ({results[-1]['s']} s)  {json.dumps(detail)[:300]}", flush=True)
        return ok

    return wrap


def main() -> int:
    from aegis_worker_b import agent, chalk_sandbox, worker
    from aegis_worker_b.samples import by_name

    @step("1 auth (service token)")
    def _():
        from chalkcompute._connect import ConnectClient

        c = ConnectClient()
        c._ensure_auth()
        return {"api_server": c._api_server, "environment": c._env_id, "token": bool(c._access_token)}

    @step("2 Model Gateway: claude-opus-5-5")
    def _():
        client = agent.gateway_client()
        ids = [m.id for m in client.models.list()]
        return {"models": ids, "using": agent.gateway_model(client)}

    @step("3 MCP Gateway answers")
    def _():
        import urllib.request

        from chalkcompute._connect import ConnectClient

        c = ConnectClient()
        c._ensure_auth()
        req = urllib.request.Request(
            c._api_server.rstrip("/") + "/v1/mcp",
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "aegis-try", "version": "0"}}}).encode(),
            headers={"Authorization": f"Bearer {c._access_token}", "X-Chalk-Env-Id": c._env_id,
                     "Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
        return {"server": "chalk-mcp-gateway" in body}

    @step("4 sandbox: network off (proven), upload, one tool, terminate")
    def _():
        s = by_name()["sh-dropper"]
        log: list[dict] = []
        with chalk_sandbox.sample_sandbox(s.data, log=log) as box:
            res = box.run_tool("identify", [])
            sid = box.id
        (OUT / "sandbox-log.json").write_text(json.dumps(log, indent=2))
        assert res.get("sha256"), res
        assert log[-1]["step"] == "terminate" and log[-1]["ok"], log[-1]
        return {"sandbox": sid, "steps": [f"{e['step']}: {e['detail']}" for e in log]}

    @step("5 Worker B end to end (sh-dropper, harmless)")
    def _():
        s = by_name()["sh-dropper"]
        res = worker.run(s.filename, s.data, log=lambda m: print("   ", m, flush=True))
        (OUT / "worker-b-result.json").write_text(json.dumps(res, indent=2))
        a = res.get("analysis") or {}
        assert not res.get("error"), res.get("error")
        return {"verdict": a.get("verdict"), "analyst": a.get("analyst"), "analyst_error": res.get("analyst_error"),
                "verified": sum(1 for v in a.get("vulnerabilities", []) if v.get("verified")), "summary": a.get("summary"), "ms": res.get("ms")}

    @step("6 leak check: no Aegis sandboxes left")
    def _():
        from chalkcompute import Sandbox

        time.sleep(3)
        left = [x for x in Sandbox.list_all() if str(getattr(x, "name", "") or "").startswith(("aegis-b-", "aegis-probe-"))
                and str(getattr(x, "status", "")).lower() not in ("terminated", "stopped", "failed", "succeeded")]
        assert not left, [str(x) for x in left]
        return {"left": 0}

    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed — {OUT.relative_to(ROOT)}")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
