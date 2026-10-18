"""How Worker B is graded (pure functions; evals.py wraps them as Chalk Evaluation scorers).

- verdict_match: 1 for the right verdict; 0.5 for flagging a risky file at the wrong severity
  (suspicious vs malicious); 0 for a miss or a false alarm.
- found_planted: for a file with a planted vulnerability, 1 if a *verified* finding names it; for a
  clean file, 1 if there is no verified high or critical finding (no false alarm).
- evidence_verified: the share of the analyst's findings whose evidence really is in the tool
  output it cites (1.0 when it reported none). Low means it is making things up.
"""

from __future__ import annotations

import json

# The playbook's vulnerability names → words an analyst might use for them.
SYNONYMS: dict[str, list[str]] = {
    "buffer overflow": ["overflow", "strcpy", "unbounded"],
    "command injection": ["command injection", "injection", "pipe", "download", "remote script", "executes"],
    "unsafe deserialization": ["deserializ", "pickle", "python/object"],
    "xss": ["xss", "cross-site", "innerhtml"],
    "injection": ["injection", "execut", "wscript", "powershell", "iex", "downloadstring"],
    "sql injection": ["sql injection", "sqli"],
    "excessive permissions": ["permission", "privilege", "grant"],
    "prototype pollution": ["prototype", "__proto__"],
    "mass assignment": ["mass assignment", "isadmin", "privilege"],
    "xxe": ["xxe", "external entit"],
    "entity expansion": ["entity expansion", "billion laughs", "exponential"],
    "insecure ci/cd configuration": ["pull_request_target", "workflow", "ci/cd", "script injection", "pipeline"],
    "zip slip": ["zip slip", "path traversal", "traversal", "outside"],
    "archive bomb": ["bomb", "decompression", "expands"],
    "path traversal": ["traversal", "symlink", "outside"],
    "javascript actions": ["javascript", "openaction", "/js"],
    "malicious macros": ["macro", "vba"],
    "external relationships": ["external", "template", "remote"],
    "svg script injection": ["script", "xss"],
    "malformed-image handling": ["polyglot", "trailing", "appended", "hidden", "embedded", "php"],
    "exposed credentials": ["credential", "secret", "access key", "password", "aws"],
    "debug mode": ["debug"],
    "exposed private key": ["private key"],
    "unsafe exports": ["system", "strcpy", "dangerous", "unsafe", "execve"],
}


def keywords(vulnerabilities: list[str]) -> list[str]:
    out: list[str] = []
    for v in vulnerabilities:
        out += [v.lower(), *SYNONYMS.get(v.lower(), [])]
    return sorted(set(out))


def _analysis(output: str) -> dict:
    try:
        return json.loads(output).get("analysis") or {}
    except (json.JSONDecodeError, AttributeError, TypeError):
        return {}


def verdict_match(output: str, expected_verdict: str) -> float:
    got = _analysis(output).get("verdict", "unknown")
    if got == expected_verdict:
        return 1.0
    risky = {"suspicious", "malicious"}
    if got in risky and expected_verdict in risky:
        return 0.5
    return 0.0


def found_planted(output: str, expected_keywords: str) -> float:
    words = json.loads(expected_keywords or "[]")
    vulns = [v for v in _analysis(output).get("vulnerabilities", []) if v.get("verified")]
    if not words:  # a clean file
        return 0.0 if any(v.get("severity") in ("high", "critical") for v in vulns) else 1.0
    text = " ".join(f"{v.get('type', '')} {v.get('explanation', '')} {v.get('evidence', '')}" for v in vulns).lower()
    return 1.0 if any(w in text for w in words) else 0.0


def evidence_verified(output: str) -> float:
    vulns = _analysis(output).get("vulnerabilities", [])
    if not vulns:
        return 1.0
    return sum(1 for v in vulns if v.get("verified")) / len(vulns)


def dataset_rows() -> list[dict]:
    import base64

    from .samples import all_samples

    return [
        {
            "sample": s.name,
            "filename": s.filename,
            "data_b64": base64.b64encode(s.data).decode(),
            "expected_verdict": s.verdict,
            "expected_keywords": json.dumps(keywords(list(s.vulnerabilities))),
        }
        for s in all_samples()
    ]
