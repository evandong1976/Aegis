"""Known-bad file hashes, kept in Chalk and looked up with a federated Chalk SQL query.

- refresh(): downloads MalwareBazaar's export of recent malware samples (abuse.ch, public, updated
  continuously), merges it with what Chalk already holds (a rolling 30 days), and uploads it as the
  named dataset `aegis_known_bad_hashes`. Chalk SQL then sees it as
  "chalk.datasets.aegis_known_bad_hashes". A scheduled Chalk Function runs it hourly (function.py).
- lookup(sha256): one Chalk SQL query for that hash. The hash is computed by Aegis and checked to be
  64 hex characters before it goes into the query; the model never writes SQL.

A match is a hard rule (MEGA_PROMPT §5.3: a threat-feed match is Malicious, whatever else says).
Only the hash leaves the Mac for this check, never the file.
"""

from __future__ import annotations

import csv
import io
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

DATASET = "aegis_known_bad_hashes"
TABLE = f'"chalk.datasets.{DATASET}"'
FEED_URL = "https://bazaar.abuse.ch/export/csv/recent/"
KEEP_DAYS = 30
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COLUMNS = ["sha256", "first_seen", "file_name", "file_type", "signature", "reporter", "source"]

# EICAR: the standard, harmless antivirus test file (a 68-byte string every scanner flags). Kept in
# the table so the demo and the evals have one known-bad file that's safe to carry around.
EICAR = {
    "sha256": "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    "first_seen": "1991-01-01 00:00:00",
    "file_name": "eicar.com",
    "file_type": "com",
    "signature": "EICAR-Test-File (not a virus)",
    "reporter": "EICAR",
    "source": "EICAR test file",
}


def parse_feed(text: str) -> list[dict]:
    """MalwareBazaar's CSV: comment lines start with '#', fields are quoted and comma+space separated."""
    rows = []
    body = "\n".join(line for line in text.splitlines() if line.strip() and not line.startswith("#"))
    for rec in csv.reader(io.StringIO(body), skipinitialspace=True):
        if len(rec) < 9:
            continue
        sha = rec[1].strip().lower()
        if not SHA256.match(sha):
            continue
        rows.append({
            "sha256": sha,
            "first_seen": rec[0].strip(),
            "file_name": rec[5].strip()[:200],
            "file_type": rec[6].strip()[:40],
            "signature": (rec[8].strip() if rec[8].strip() not in ("", "n/a") else "unknown family")[:80],
            "reporter": rec[4].strip()[:80],
            "source": "MalwareBazaar",
        })
    return rows


def merge(old: list[dict], new: list[dict], now: datetime | None = None) -> list[dict]:
    """Union by hash (newest row wins), drop rows older than KEEP_DAYS, always keep EICAR."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    by_hash = {r["sha256"]: r for r in old}
    by_hash.update({r["sha256"]: r for r in new})
    kept = [r for r in by_hash.values() if r["first_seen"] >= cutoff and r["sha256"] != EICAR["sha256"]]
    kept.sort(key=lambda r: r["first_seen"], reverse=True)
    return [EICAR, *[{c: r.get(c, "") for c in COLUMNS} for r in kept]]


def download(url: str = FEED_URL) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Aegis/0.1 (+https://github.com/evandong1976/Aegis)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def refresh(
    *,
    fetch: Callable[[], str] = download,
    query: Callable[[str], list[dict]] | None = None,
    upload: Callable[[list[dict]], None] | None = None,
    log: Callable[[str], None] = print,
) -> dict:
    """Feed → merge with what Chalk already holds (read back with Chalk SQL) → upload."""
    new = parse_feed(fetch())
    old: list[dict] = []
    try:
        old = (query or _chalk_sql)(f"SELECT {', '.join(COLUMNS)} FROM {TABLE}")
    except Exception as e:  # noqa: BLE001 - first run, or SQL unavailable: today's feed alone
        log(f"no earlier {DATASET} read ({type(e).__name__}: {str(e)[:120]}); starting from today's feed")
    rows = merge(old, new)
    (upload or _upload)(rows)
    out = {"dataset": DATASET, "from_feed": len(new), "earlier": len(old), "uploaded": len(rows),
           "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    log(str(out))
    return out


def lookup(sha256: str, *, query: Callable[[str], list[dict]] | None = None) -> dict:
    """Is this hash a known-bad file? One federated Chalk SQL query over the dataset."""
    sha = (sha256 or "").strip().lower()
    if not SHA256.match(sha):
        return {"error": "not a SHA-256"}
    sql = (
        f"SELECT sha256, first_seen, file_name, file_type, signature, reporter, source FROM {TABLE} "
        f"WHERE sha256 = '{sha}' LIMIT 5"
    )
    t0 = time.monotonic()
    try:
        rows = (query or _chalk_sql)(sql)
    except Exception as e:  # noqa: BLE001 - an unanswered lookup is "unknown", never "clean"
        return {"error": f"Chalk SQL: {type(e).__name__}: {str(e)[:300]}", "query": sql}
    return {
        "matched": bool(rows),
        "matches": rows,
        "query": sql,
        "ms": int((time.monotonic() - t0) * 1000),
        "source": "Chalk SQL over chalk.datasets." + DATASET + " (MalwareBazaar, abuse.ch)",
    }


def _upload(rows: list[dict]) -> None:
    import chalkcompute

    chalkcompute.DatasetClient().upload(DATASET, rows)


def _chalk_sql(sql: str) -> list[dict]:
    from chalkcompute import SQLClient

    with SQLClient() as c:
        return c.query(sql, timeout=30).to_arrow().to_pylist()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "refresh"
    if cmd == "refresh":
        refresh()
    elif cmd == "lookup":
        print(lookup(sys.argv[2]))
