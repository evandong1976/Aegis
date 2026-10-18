"""Agent Evals: prove Worker B finds what the playbook says to look for.

Dataset: every labeled sample in samples.py (planted vulnerabilities + clean controls).
Two evaluations in one suite, on the same dataset revision, so the dashboard compares them:
  - "worker-b agent": the full Worker B (GPT through the Model Gateway, tools in the sandbox)
  - "worker-b rules": the playbook's rules alone, no model (the baseline the agent must beat)
Scorers: scoring.py's three, plus the built-in json_valid.

    cd chalk && uv run --env-file ../.env.local python -m aegis_worker_b.evals [--rules-only]
Writes evals/results.json at the repo root, which the app's Accuracy tab reads.
"""

from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

import chalkcompute
from chalkcompute import EvaluationScorerResult

from aegis_worker_b import scoring
from aegis_worker_b.function import aegis_worker_b, image

DATASET = "aegis-worker-b-samples"
SUITE = "Aegis Worker B"


@chalkcompute.function(name="aegis-worker-b-rules", image=image, chalk_identity=True, cpu="1", memory="2Gi", concurrency=3)
def aegis_worker_b_rules(filename: str, data_b64: str) -> str:
    """The baseline: the playbook's tools and rules in the same sandbox, no model."""
    from aegis_worker_b.worker import run

    return json.dumps(run(filename, base64.b64decode(data_b64), use_agent=False))


@chalkcompute.function(name="aegis-verdict-match", image=image)
def verdict_match(output: str, expected_verdict: str) -> EvaluationScorerResult:
    from aegis_worker_b import scoring as s

    return EvaluationScorerResult(score=s.verdict_match(output, expected_verdict))


@chalkcompute.function(name="aegis-found-planted", image=image)
def found_planted(output: str, expected_keywords: str) -> EvaluationScorerResult:
    from aegis_worker_b import scoring as s

    return EvaluationScorerResult(score=s.found_planted(output, expected_keywords))


@chalkcompute.function(name="aegis-evidence-verified", image=image)
def evidence_verified(output: str) -> EvaluationScorerResult:
    from aegis_worker_b import scoring as s

    return EvaluationScorerResult(score=s.evidence_verified(output))


# Same image as the rest: its container imports this module, which needs the playbook (function.py).
valid_json = chalkcompute.scorers.json_valid(name="aegis-valid-json", image=image)
SCORERS = [verdict_match, found_planted, evidence_verified, valid_json]
SCORE_COLUMNS = ["aegis-verdict-match", "aegis-found-planted", "aegis-evidence-verified", "aegis-valid-json"]


def _suite():
    return next((x for x in chalkcompute.EvaluationSuite.list_all() if x.name == SUITE), None) or chalkcompute.EvaluationSuite.create(SUITE)


def _summarise(name: str, run, table) -> dict:
    rows = table.to_pylist()
    means = {c: round(sum((r.get(f"{c}_value") or 0.0) for r in rows) / max(len(rows), 1), 3) for c in SCORE_COLUMNS}
    errors = sum(1 for r in rows if r.get("output_error"))
    per_row = []
    for r in rows:
        a = scoring._analysis(r.get("output") or "")
        per_row.append({
            "sample": r["sample"], "expected": r["expected_verdict"], "got": a.get("verdict"),
            "analyst": a.get("analyst"), "scores": {c: r.get(f"{c}_value") for c in SCORE_COLUMNS},
            "error": r.get("output_error"),
        })
    return {"evaluation": name, "run_id": run.id, "status": str(run.status), "rows": len(rows), "row_errors": errors,
            "means": means, "per_sample": per_row}


def main(rules_only: bool = False) -> int:
    dataset = chalkcompute.DatasetClient().upload(DATASET, scoring.dataset_rows())
    suite = _suite()
    tasks = [("worker-b rules", aegis_worker_b_rules)] + ([] if rules_only else [("worker-b agent", aegis_worker_b)])
    results = []
    for name, task in tasks:
        evaluation = chalkcompute.Evaluation.create(
            name, dataset=dataset, task=task, scorers=SCORERS, suite_id=suite.id,
            metadata={"playbook": "docs/file_types_vulnerabilities.md"},
        )
        run = evaluation.run(metadata={"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).wait(timeout=1800.0)
        table = chalkcompute.DatasetClient().read(run.result_dataset)
        summary = _summarise(name, run, table)
        print(json.dumps({k: summary[k] for k in ("evaluation", "status", "rows", "row_errors", "means")}, indent=2))
        results.append(summary)
    out = Path(__file__).resolve().parents[2] / "evals" / "results.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "worker_b": results}, indent=2))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(rules_only="--rules-only" in sys.argv))
