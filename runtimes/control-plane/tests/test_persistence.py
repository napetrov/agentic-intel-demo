"""Restart-survival tests for the SQLite-backed registries.

These tests live in the control-plane suite (not session_manager's) because
the persistence helper is shared by both `_jobs` and `LocalSessionBackend`.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Same module-load dance as test_app.py / test_sessions.py — load app.py
# under a unique name so the three test files don't collide on
# sys.modules when pytest collects them in one process.
_HERE = Path(__file__).resolve().parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import session_manager as sm  # noqa: E402
from persistence import SqliteJsonStore  # noqa: E402


# ----- SqliteJsonStore basic shape ------------------------------------------


def test_store_in_memory_default_is_isolated():
    a = SqliteJsonStore()
    b = SqliteJsonStore()
    a["k"] = {"v": 1}
    # In-memory connections must not share state across instances —
    # otherwise unit tests would leak into each other.
    assert "k" not in b
    assert a["k"] == {"v": 1}


def test_store_persists_across_instances(tmp_path):
    db = tmp_path / "jobs.db"
    s1 = SqliteJsonStore(path=str(db))
    s1["job-1"] = {"status": "running", "result_ref": None}
    s1.update_fields("job-1", status="completed", result_ref="offload/x.json")
    s1.close()

    s2 = SqliteJsonStore(path=str(db))
    assert "job-1" in s2
    assert s2["job-1"]["status"] == "completed"
    assert s2["job-1"]["result_ref"] == "offload/x.json"
    # values() must surface every issued ref so /artifacts can reject
    # unknown ones after a restart, not just session ones.
    refs = {e.get("result_ref") for e in s2.values()}
    assert "offload/x.json" in refs


def test_store_pop_returns_value_and_removes(tmp_path):
    db = tmp_path / "jobs.db"
    s = SqliteJsonStore(path=str(db))
    s["k"] = {"v": 1}
    assert s.pop("k") == {"v": 1}
    assert "k" not in s
    # pop with default doesn't raise on a missing key.
    assert s.pop("k", None) is None
    with pytest.raises(KeyError):
        s.pop("k")


def test_store_update_fields_raises_on_missing():
    s = SqliteJsonStore()
    with pytest.raises(KeyError):
        s.update_fields("nope", status="x")


def test_store_keys_values_items_round_trip():
    s = SqliteJsonStore()
    s["a"] = {"v": 1}
    s["b"] = {"v": 2}
    assert sorted(s.keys()) == ["a", "b"]
    assert sorted(e["v"] for e in s.values()) == [1, 2]
    assert dict(s.items()) == {"a": {"v": 1}, "b": {"v": 2}}
    assert len(s) == 2


def test_store_rejects_unsafe_table_name():
    # The table name flows into a CREATE TABLE / INSERT string interpolation
    # because sqlite3 doesn't parameterize identifiers — guard the surface.
    with pytest.raises(ValueError):
        SqliteJsonStore(table="jobs; DROP TABLE jobs--")


# ----- LocalSessionBackend persistence --------------------------------------


def test_local_backend_in_memory_default_unchanged():
    """Sanity: passing no path keeps the previous in-memory behavior."""
    backend = sm.LocalSessionBackend()
    rec = backend.create(scenario="x", profile="small")
    assert backend.get(rec.session_id) is not None
    # A second instance with no path is a fresh DB, so the record isn't
    # visible — same as the legacy dict.
    other = sm.LocalSessionBackend()
    assert other.get(rec.session_id) is None


def test_local_backend_records_survive_restart(tmp_path):
    db = tmp_path / "sessions.db"
    b1 = sm.LocalSessionBackend(db_path=str(db))
    rec = b1.create(scenario="market-research", profile="medium")
    sid = rec.session_id

    # Simulate a process restart by dropping b1 and rebuilding from disk.
    b1._store.close()
    b2 = sm.LocalSessionBackend(db_path=str(db))
    rehydrated = b2.get(sid)
    assert rehydrated is not None
    assert rehydrated.scenario == "market-research"
    assert rehydrated.profile == "medium"
    assert rehydrated.cpu_request == "4"  # medium profile in PROFILES


def test_local_backend_advance_persists_terminal_state(tmp_path, monkeypatch):
    """A session that completed before the restart must come back as
    Completed, not Pending — otherwise the simulator's state machine
    re-runs the full timer on every restart, which the demo viewer sees
    as "the job is running forever"."""
    db = tmp_path / "sessions.db"
    t0 = 1_700_000_000.0
    monkeypatch.setattr(sm.time, "time", lambda: t0)

    b1 = sm.LocalSessionBackend(db_path=str(db))
    rec = b1.create(scenario="x", profile="small")

    # Jump well past PENDING+RUNNING so _advance() drives the record into
    # Completed and persists it. The next get() does the write-through.
    monkeypatch.setattr(
        sm.time,
        "time",
        lambda: t0
        + sm.LocalSessionBackend.PENDING_SECONDS
        + sm.LocalSessionBackend.RUNNING_SECONDS
        + 1.0,
    )
    final = b1.get(rec.session_id)
    assert final.status == sm.STATUS_COMPLETED
    b1._store.close()

    # Restart: rehydrated record must already be Completed.
    b2 = sm.LocalSessionBackend(db_path=str(db))
    rehydrated = b2.get(rec.session_id)
    assert rehydrated is not None
    assert rehydrated.status == sm.STATUS_COMPLETED
    assert rehydrated.completed_at is not None


def test_local_backend_delete_removes_from_disk(tmp_path):
    db = tmp_path / "sessions.db"
    b1 = sm.LocalSessionBackend(db_path=str(db))
    rec = b1.create(scenario="x", profile="small")
    assert b1.delete(rec.session_id) is True
    b1._store.close()

    b2 = sm.LocalSessionBackend(db_path=str(db))
    assert b2.get(rec.session_id) is None
