"""Every tool on every labeled sample, locally. Tools whose CLI isn't installed here (shellcheck,
bandit, olevba, readelf) report an error and are skipped; the sandbox image has them."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from aegis_worker_b import sandbox_tools as T
from aegis_worker_b.playbook import tools_for
from aegis_worker_b.samples import all_samples, by_name

SAMPLES = all_samples()


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    d = tmp_path_factory.mktemp("samples")
    out = {}
    for s in SAMPLES:
        p = d / s.name
        p.write_bytes(s.data)
        out[s.name] = str(p)
    return out


def run_all(path: str, filename: str) -> list[dict]:
    findings = []
    for call in tools_for(filename, Path(path).read_bytes()[:4096]):
        res = T.TOOLS[call.tool](path, *call.args)
        if "error" in res:
            continue
        findings += res.get("findings", [])
    return findings


@pytest.mark.parametrize("sample", [s for s in SAMPLES if s.verdict != "clean"], ids=lambda s: s.name)
def test_planted_vulnerability_is_found(sample, files):
    rules = {f["rule"] for f in run_all(files[sample.name], sample.filename)}
    assert rules & set(sample.expected_rules), f"{sample.name}: found {sorted(rules)}"


@pytest.mark.parametrize("sample", [s for s in SAMPLES if s.verdict == "clean"], ids=lambda s: s.name)
def test_clean_files_have_no_high_findings(sample, files):
    bad = [f for f in run_all(files[sample.name], sample.filename) if f["severity"] in ("high", "critical")]
    assert bad == []


def test_identify_hashes_the_file(files):
    s = by_name()["sh-dropper"]
    res = T.identify(files["sh-dropper"])
    import hashlib

    assert res["sha256"] == hashlib.sha256(s.data).hexdigest()
    assert res["size"] == len(s.data)


def test_read_lines_is_numbered_and_capped(files):
    res = T.read_lines(files["sh-dropper"], "2", "500")
    assert res["lines"][0]["line"] == 2
    assert "curl" in res["lines"][0]["text"]
    assert len(res["lines"]) <= 200


def test_extraction_test_confirms_zip_slip(files):
    res = T.archive_extract_test(files["zip-slip"])
    assert res["written_outside_target"] == ["a/evil.sh"]
    assert res["findings"][0]["rule"] == "zip_slip_confirmed"
    assert not Path("/tmp/aegis-extract").exists()


def test_secret_values_are_masked(files):
    codes = " ".join(f.get("code", "") for f in T.secret_scan(files["env-secrets"])["findings"])
    assert "hunter2pass" not in codes and "masked" in codes


def test_cli_prints_one_json_object(files):
    out = subprocess.run(
        [sys.executable, T.__file__, "xml_entities", files["xml-xxe"]], capture_output=True, text=True, check=True
    ).stdout
    assert json.loads(out)["findings"][0]["rule"] == "xxe_external_entity"


def test_cli_refuses_unknown_tools():
    out = subprocess.run([sys.executable, T.__file__, "rm", "/"], capture_output=True, text=True).stdout
    assert "usage" in json.loads(out)["error"]
