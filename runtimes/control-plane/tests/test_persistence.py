"""Restart-survival tests for the SQLite-backed registries.

These tests live in the control-plane suite (not session_manager's) because
the persistence helper is shared by both `_jobs` and `LocalSessionBackend`.

Every test that opens a SQLite-backed store closes it before the test
returns — either via a `with` block (the store is its own context
manager) or via a fixture's teardown. CodeRabbit caught that orphan
sqlite3 handles can make `tmp_path` cleanup flaky on Windows; this is
cheap insurance.
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


# ----- fixtures --------------------------------------------------------------


@pytest.fixture
def make_backend(tmp_path):
    """Yield a factory that builds a LocalSessionBackend on a fresh
    SQLite path; closes every backend it produced on teardown so the
    underlying connections are released before pytest deletes tmp_path.
    """
    created: list[sm.LocalSessionBackend] = []

    def _factory(name: str = "sessions.db", *, db_path: str | None = None) -> sm.LocalSessionBackend:
        path = db_path if db_path is not None else str(tmp_path / name)
        backend = sm.LocalSessionBackend(db_path=path)
        created.append(backend)
        return backend

    yield _factory
    for backend in created:
        try:
            backend.close()
        except Exception:
            pass


# ----- SqliteJsonStore basic shape ------------------------------------------


def test_store_in_memory_default_is_isolated():
    with SqliteJsonStore() as a, SqliteJsonStore() as b:
        a["k"] = {"v": 1}
        # In-memory connections must not share state across instances —
        # otherwise unit tests would leak into each other.
        assert "k" not in b
        assert a["k"] == {"v": 1}


def test_store_persists_across_instances(tmp_path):
    db = tmp_path / "jobs.db"
    with SqliteJsonStore(path=str(db)) as s1:
        s1["job-1"] = {"status": "running", "result_ref": None}
        s1.update_fields("job-1", status="completed", result_ref="offload/x.json")

    with SqliteJsonStore(path=str(db)) as s2:
        assert "job-1" in s2
        assert s2["job-1"]["status"] == "completed"
        assert s2["job-1"]["result_ref"] == "offload/x.json"
        # values() must surface every issued ref so /artifacts can reject
        # unknown ones after a restart, not just session ones.
        refs = {e.get("result_ref") for e in s2.values()}
        assert "offload/x.json" in refs


def test_store_pop_returns_value_and_removes(tmp_path):
    db = tmp_path / "jobs.db"
    with SqliteJsonStore(path=str(db)) as s:
        s["k"] = {"v": 1}
        assert s.pop("k") == {"v": 1}
        assert "k" not in s
        # pop with default doesn't raise on a missing key.
        assert s.pop("k", None) is None
        with pytest.raises(KeyError):
            s.pop("k")


def test_store_update_fields_raises_on_missing():
    with SqliteJsonStore() as s:
        with pytest.raises(KeyError):
            s.update_fields("nope", status="x")


def test_store_keys_values_items_round_trip():
    with SqliteJsonStore() as s:
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
    other = sm.LocalSessionBackend()
    try:
        rec = backend.create(scenario="x", profile="small")
        assert backend.get(rec.session_id) is not None
        # A second instance with no path is a fresh DB, so the record isn't
        # visible — same as the legacy dict.
        assert other.get(rec.session_id) is None
    finally:
        backend.close()
        other.close()


def test_local_backend_records_survive_restart(make_backend):
    b1 = make_backend()
    rec = b1.create(scenario="market-research", profile="medium")
    sid = rec.session_id

    # Simulate a process restart by closing b1 and reopening on the same path.
    b1.close()
    b2 = make_backend(db_path=b1._store._path)
    rehydrated = b2.get(sid)
    assert rehydrated is not None
    assert rehydrated.scenario == "market-research"
    assert rehydrated.profile == "medium"
    assert rehydrated.cpu_request == "4"  # medium profile in PROFILES


def test_local_backend_advance_persists_terminal_state(make_backend, monkeypatch):
    """A session that completed before the restart must come back as
    Completed, not Pending — otherwise the simulator's state machine
    re-runs the full timer on every restart, which the demo viewer sees
    as "the job is running forever"."""
    t0 = 1_700_000_000.0
    monkeypatch.setattr(sm.time, "time", lambda: t0)

    b1 = make_backend()
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
    db_path = b1._store._path
    b1.close()

    # Restart: rehydrated record must already be Completed.
    b2 = make_backend(db_path=db_path)
    rehydrated = b2.get(rec.session_id)
    assert rehydrated is not None
    assert rehydrated.status == sm.STATUS_COMPLETED
    assert rehydrated.completed_at is not None


def test_local_backend_delete_removes_from_disk(make_backend):
    b1 = make_backend()
    rec = b1.create(scenario="x", profile="small")
    assert b1.delete(rec.session_id) is True
    db_path = b1._store._path
    b1.close()

    b2 = make_backend(db_path=db_path)
    assert b2.get(rec.session_id) is None


# ----- Persist-then-mutate ordering (CodeRabbit Major) ---------------------


def test_local_backend_create_rolls_back_cache_on_persist_failure(make_backend, monkeypatch):
    """If the SQLite write fails, the in-memory cache must NOT carry the
    new record — otherwise we'd serve a session that vanishes on restart."""
    backend = make_backend()

    def boom(*_a, **_kw):
        raise RuntimeError("disk full")

    monkeypatch.setattr(backend, "_persist", boom)
    with pytest.raises(RuntimeError, match="disk full"):
        backend.create(scenario="x", profile="small", session_id="sess-fail")
    assert backend.get("sess-fail") is None
    assert "sess-fail" not in backend._records


def test_local_backend_advance_rolls_back_on_persist_failure(make_backend, monkeypatch):
    """If _advance can't durably write the new state, the in-memory record
    must be restored to its prior status. Otherwise the session reads as
    Completed in this process but Pending after a restart."""
    t0 = 1_700_000_000.0
    monkeypatch.setattr(sm.time, "time", lambda: t0)
    backend = make_backend()
    rec = backend.create(scenario="x", profile="small")

    # create() happened with the real _persist; break persistence now so
    # the next state transition triggers the rollback path.
    def boom(*_a, **_kw):
        raise RuntimeError("disk full")

    monkeypatch.setattr(backend, "_persist", boom)
    monkeypatch.setattr(
        sm.time,
        "time",
        lambda: t0 + sm.LocalSessionBackend.PENDING_SECONDS + 0.1,
    )
    with pytest.raises(RuntimeError, match="disk full"):
        backend.get(rec.session_id)
    # Cache snapped back to Pending — matches what disk would replay on restart.
    assert backend._records[rec.session_id].status == sm.STATUS_PENDING
    assert backend._records[rec.session_id].started_at is None
