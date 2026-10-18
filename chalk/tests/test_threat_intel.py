"""The known-bad-hash feed: parsing MalwareBazaar's export, merging, and the Chalk SQL lookup."""

from datetime import datetime, timezone
from pathlib import Path

from aegis_worker_b import threat_intel as T

FEED = (Path(__file__).parent / "fixtures" / "malwarebazaar-recent-head.csv").read_text()


def test_parses_the_real_export():
    rows = T.parse_feed(FEED)
    assert len(rows) == 3
    r = rows[0]
    assert len(r["sha256"]) == 64 and r["source"] == "MalwareBazaar"
    assert set(r) == set(T.COLUMNS)
    assert r["first_seen"].startswith("2026-10-18")


def test_merge_keeps_30_days_dedupes_and_keeps_eicar():
    now = datetime(2026, 10, 18, tzinfo=timezone.utc)
    old = [
        {**dict.fromkeys(T.COLUMNS, ""), "sha256": "a" * 64, "first_seen": "2026-08-01 00:00:00", "signature": "old"},
        {**dict.fromkeys(T.COLUMNS, ""), "sha256": "b" * 64, "first_seen": "2026-10-10 00:00:00", "signature": "before"},
    ]
    new = [{**dict.fromkeys(T.COLUMNS, ""), "sha256": "b" * 64, "first_seen": "2026-10-17 00:00:00", "signature": "after"}]
    rows = T.merge(old, new, now)
    assert rows[0] == T.EICAR
    assert [(r["sha256"][0], r["signature"]) for r in rows[1:]] == [("b", "after")]


def test_lookup_runs_one_query_for_the_hash():
    seen = []

    def fake(sql):
        seen.append(sql)
        return [{"sha256": T.EICAR["sha256"], "signature": T.EICAR["signature"], "source": "EICAR test file"}]

    res = T.lookup(T.EICAR["sha256"].upper(), query=fake)
    assert res["matched"] is True and res["matches"][0]["signature"].startswith("EICAR")
    assert seen == [res["query"]] and '"chalk.datasets.aegis_known_bad_hashes"' in seen[0]
    assert f"sha256 = '{T.EICAR['sha256']}'" in seen[0]


def test_lookup_refuses_anything_but_a_hash():
    called = []
    assert T.lookup("' OR 1=1 --", query=lambda q: called.append(q) or []) == {"error": "not a SHA-256"}
    assert called == []


def test_an_unanswered_lookup_is_an_error_not_a_miss():
    def broken(sql):
        raise RuntimeError("permission query.online")

    res = T.lookup("c" * 64, query=broken)
    assert "error" in res and "matched" not in res


def test_refresh_merges_what_chalk_already_holds():
    queries, uploaded = [], []
    earlier = [{**dict.fromkeys(T.COLUMNS, ""), "sha256": "d" * 64, "first_seen": "2099-01-01 00:00:00", "signature": "kept"}]
    out = T.refresh(fetch=lambda: FEED, query=lambda q: queries.append(q) or earlier,
                    upload=lambda rows: uploaded.extend(rows), log=lambda _: None)
    assert queries and queries[0].startswith("SELECT sha256") and T.TABLE in queries[0]
    assert out["from_feed"] == 3 and out["earlier"] == 1 and out["uploaded"] == 5
    assert uploaded[0] == T.EICAR and any(r["signature"] == "kept" for r in uploaded)
