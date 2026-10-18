"""Worker B's tools, called through Chalk's MCP Gateway (AEGIS_WORKER_B_TOOLS=mcp).

The gateway fronts the aegis-playbook-tools server (mcp_server.py) and namespaces its tools as
`aegis-playbook-tools__<tool>`. Calling through it means Chalk checks each call against the
gateway's policies and writes it to the audit log under this workload's identity.

A small synchronous JSON-RPC client: the gateway sometimes answers "Session not found" on a
follow-up request (seen 2026-10-18), so a lost session is re-initialized and the call retried.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Callable

from .mcp_server import SERVER_NAME

PROTOCOL = "2025-06-18"


class GatewayError(RuntimeError):
    pass


def _token() -> tuple[str, str, str]:
    from chalkcompute._connect import ConnectClient

    c = ConnectClient()
    c._ensure_auth()
    return (c._api_server or "https://api.chalk.ai").rstrip("/"), c._env_id or "", c._access_token or ""


def _post(url: str, body: dict, headers: dict) -> tuple[int, dict, str]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read().decode()


def _messages(text: str) -> list[dict]:
    """JSON-RPC replies from a JSON body or an SSE stream."""
    text = text.strip()
    if text.startswith("{"):
        return [json.loads(text)]
    return [json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith("data:") and line[5:].strip().startswith("{")]


class GatewayTools:
    """A ToolExecutor (see agent.py) that runs each tool through the MCP Gateway."""

    def __init__(self, sandbox_id: str, *, post: Callable[[str, dict, dict], tuple[int, dict, str]] = _post,
                 auth: Callable[[], tuple[str, str, str]] = _token, retries: int = 3):
        self.sandbox_id = sandbox_id
        self.post = post
        self.api, self.env, self.token = auth()
        self.session: str | None = None
        self.retries = retries
        self._id = 0

    def _headers(self) -> dict:
        h = {"Authorization": f"Bearer {self.token}", "X-Chalk-Env-Id": self.env,
             "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self.session:
            h["Mcp-Session-Id"] = self.session
        return h

    def _rpc(self, method: str, params: dict | None = None, notify: bool = False) -> tuple[int, dict | None, str]:
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notify:
            self._id += 1
            body["id"] = self._id
        status, headers, text = self.post(self.api + "/v1/mcp", body, self._headers())
        sid = next((v for k, v in headers.items() if k.lower() == "mcp-session-id"), None)
        if sid:
            self.session = sid
        reply = next((m for m in _messages(text) if m.get("id") == body.get("id")), None) if not notify and status == 200 else None
        return status, reply, text

    def _connect(self) -> None:
        self.session = None
        status, reply, text = self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                                       "clientInfo": {"name": "aegis-worker-b", "version": "1"}})
        if status != 200 or not reply or "error" in reply:
            raise GatewayError(f"MCP Gateway initialize failed ({status}): {text[:200]}")
        self._rpc("notifications/initialized", notify=True)

    def __call__(self, tool: str, args: list[str]) -> dict:
        arguments: dict[str, Any] = {"sandbox_id": self.sandbox_id}
        if tool == "read_lines":
            arguments |= {"start": int(args[0]), "count": int(args[1])}
        elif tool == "code_patterns":
            arguments["language"] = args[0]
        last = ""
        for _ in range(self.retries):
            if not self.session:
                self._connect()
            status, reply, text = self._rpc("tools/call", {"name": f"{SERVER_NAME}__{tool}", "arguments": arguments})
            if status in (401, 404) and "session" in text.lower():
                self.session = None  # lost by the gateway: start a new one
                last = text
                continue
            if status != 200 or reply is None:
                raise GatewayError(f"MCP Gateway tools/call {tool} failed ({status}): {text[:200]}")
            if "error" in reply:
                return {"error": f"gateway: {reply['error'].get('message', reply['error'])}"}
            result = reply.get("result", {})
            if result.get("isError"):
                return {"error": " ".join(c.get("text", "") for c in result.get("content", []))[:500]}
            if isinstance(result.get("structuredContent"), dict) and "result" in result["structuredContent"]:
                payload = result["structuredContent"]["result"]
            else:
                payload = next((c.get("text") for c in result.get("content", []) if c.get("type") == "text"), "{}")
            return json.loads(payload) if isinstance(payload, str) else payload
        raise GatewayError(f"MCP Gateway kept losing the session: {last[:200]}")
