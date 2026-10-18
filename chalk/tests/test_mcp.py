"""The MCP tool server (in-process) and the MCP Gateway client (with a scripted gateway)."""

import json

import pytest

from aegis_worker_b import agent
from aegis_worker_b.mcp_gateway import GatewayError, GatewayTools
from aegis_worker_b.mcp_server import SERVER_NAME, asgi_app

HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


@pytest.fixture
def client():
    from starlette.testclient import TestClient

    calls = []

    def fake_exec(sandbox_id, tool, args):
        calls.append((sandbox_id, tool, args))
        return {"tool": tool, "args": args, "findings": []}

    with TestClient(asgi_app(fake_exec, key="k3y")) as c:
        c.calls = calls
        yield c


def rpc(c, method, params=None, key="k3y", id_=1):
    r = c.post("/mcp", headers={**HEADERS, "X-Aegis-Key": key}, json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}})
    return r


def test_needs_the_key_except_health(client):
    assert client.get("/health").status_code == 200
    assert rpc(client, "tools/list", key="wrong").status_code == 401
    assert client.post("/mcp", headers=HEADERS, json={}).status_code == 401


def test_lists_every_playbook_tool(client):
    init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
    assert init.status_code == 200
    names = {t["name"] for t in rpc(client, "tools/list", id_=2).json()["result"]["tools"]}
    assert names == set(agent.TOOL_DESCRIPTIONS)


def test_calls_run_the_fixed_command_on_the_named_sandbox(client):
    rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
    r = rpc(client, "tools/call", {"name": "code_patterns", "arguments": {"sandbox_id": "aegis-b-123", "language": "rm -rf /"}}, id_=3)
    assert r.status_code == 200, r.text
    assert client.calls == [("aegis-b-123", "code_patterns", ["shell"])]
    r = rpc(client, "tools/call", {"name": "read_lines", "arguments": {"sandbox_id": "aegis-b-123", "start": 0, "count": 999}}, id_=4)
    assert client.calls[-1] == ("aegis-b-123", "read_lines", ["1", "200"])


class FakeGateway:
    """Answers like Chalk's gateway, losing the session once."""

    def __init__(self, lose_session=1):
        self.lose = lose_session
        self.calls = []

    def __call__(self, url, body, headers):
        self.calls.append((body["method"], headers.get("Mcp-Session-Id")))
        m = body["method"]
        if m == "initialize":
            return 200, {"mcp-session-id": f"s{len(self.calls)}"}, json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": {}})
        if m == "notifications/initialized":
            return 202, {}, ""
        if self.lose:
            self.lose -= 1
            return 401, {}, "Unauthorized: Session not found"
        assert body["params"]["name"] == f"{SERVER_NAME}__identify"
        result = {"content": [{"type": "text", "text": json.dumps({"sha256": "ab" * 32})}]}
        return 200, {}, "data: " + json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": result}) + "\n\n"


def test_gateway_client_recovers_a_lost_session():
    gw = FakeGateway(lose_session=1)
    tools = GatewayTools("aegis-b-1", post=gw, auth=lambda: ("https://api.chalk.ai", "env", "tok"))
    assert tools("identify", []) == {"sha256": "ab" * 32}
    assert [c[0] for c in gw.calls] == ["initialize", "notifications/initialized", "tools/call",
                                         "initialize", "notifications/initialized", "tools/call"]


def test_gateway_client_gives_up_after_retries():
    tools = GatewayTools("aegis-b-1", post=FakeGateway(lose_session=99), auth=lambda: ("https://x", "e", "t"))
    with pytest.raises(GatewayError, match="losing the session"):
        tools("identify", [])
