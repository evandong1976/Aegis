"""The eval scorers, and the rules-only baseline scored over every sample locally."""

import json
from dataclasses import asdict

from aegis_worker_b import agent, sandbox_tools, scoring
from aegis_worker_b.samples import all_samples


def out(verdict, vulns=()):
    return json.dumps({"analysis": {"verdict": verdict, "vulnerabilities": list(vulns)}})


def test_verdict_match():
    assert scoring.verdict_match(out("malicious"), "malicious") == 1.0
    assert scoring.verdict_match(out("suspicious"), "malicious") == 0.5
    assert scoring.verdict_match(out("clean"), "malicious") == 0.0
    assert scoring.verdict_match(out("suspicious"), "clean") == 0.0
    assert scoring.verdict_match("not json", "clean") == 0.0


def test_found_planted_needs_a_verified_finding():
    kw = json.dumps(scoring.keywords(["Zip Slip"]))
    good = {"type": "Path traversal (Zip Slip)", "severity": "high", "verified": True, "explanation": "", "evidence": "../../evil.sh"}
    assert scoring.found_planted(out("malicious", [good]), kw) == 1.0
    assert scoring.found_planted(out("malicious", [{**good, "verified": False}]), kw) == 0.0
    assert scoring.found_planted(out("clean"), json.dumps([])) == 1.0
    assert scoring.found_planted(out("suspicious", [good]), json.dumps([])) == 0.0


def test_evidence_verified_share():
    assert scoring.evidence_verified(out("clean")) == 1.0
    assert scoring.evidence_verified(out("x", [{"verified": True}, {"verified": False}])) == 0.5


def test_every_planted_vulnerability_has_keywords():
    for s in all_samples():
        assert (len(scoring.keywords(list(s.vulnerabilities))) > 0) == (s.verdict != "clean"), s.name


def test_dataset_rows_use_no_reserved_columns():
    rows = scoring.dataset_rows()
    assert len(rows) == len(all_samples())
    assert not {"output", "trace"} & set(rows[0]) and not any(k.startswith("__chalk") for k in rows[0])


def test_rules_baseline_locally(tmp_path, capsys):
    """Not a pass/fail bar: prints the baseline's numbers, and checks the scorers run end to end."""
    totals = {"verdict": 0.0, "found": 0.0}
    for s in all_samples():
        p = tmp_path / s.name
        p.write_bytes(s.data)
        res = agent.baseline(filename=s.filename, head=s.data[:4096], run_tool=lambda t, a, p=str(p): sandbox_tools.TOOLS[t](p, *a))
        o = json.dumps({"analysis": asdict(res)})
        totals["verdict"] += scoring.verdict_match(o, s.verdict)
        totals["found"] += scoring.found_planted(o, json.dumps(scoring.keywords(list(s.vulnerabilities))))
    n = len(all_samples())
    with capsys.disabled():
        print(f"\nrules baseline over {n} samples: verdict_match {totals['verdict'] / n:.2f}, found_planted {totals['found'] / n:.2f}")
    assert totals["found"] / n > 0.5
