"""SQLite-backed JSON store for the control-plane registries.

Two registries in this process need to survive a restart:

* The offload-job registry (`_jobs` in app.py). A control-plane restart
  used to drop every `result_ref` the relay had ever issued, so the
  GET /artifacts/{ref} guard rejected previously-valid refs as "unknown".
* The LocalSessionBackend record map. A `docker compose restart`
  (or any uvicorn worker recycle) wiped the multi-agent fan-out table.

`SqliteJsonStore` is the smallest thing that fixes both. It exposes the
same mapping shape the in-memory dict had (`__getitem__`, `__setitem__`,
`__contains__`, `keys()`, `values()`, `items()`, `pop()`) and wraps
sqlite3 from the standard library — no new dependency.

Path conventions:

* `path=None` or `path=":memory:"` → in-memory database. Used by the
  unit tests and as the default when no env var is set, so the existing
  test fixtures don't need a writable filesystem.
* Any other string → filesystem path. The parent directory is created
  on first use; concurrent uvicorn workers share access via
  `check_same_thread=False` plus an in-process RLock that callers can
  hold around multi-step "read-modify-write" sequences.

The store is intentionally generic (one TEXT primary key, one TEXT JSON
blob) — it is not a relational schema. Scaling beyond the demo's tens
of rows would warrant migrating to a real ORM; until then this keeps
the operator-visible surface (`sqlite3 jobs.db` works) tiny.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any, Iterator, Optional


_MISSING: Any = object()


def _resolve_path(path: Optional[str]) -> str:
    if not path or path == ":memory:":
        return ":memory:"
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return path


class SqliteJsonStore:
    """Mapping-shaped SQLite-backed JSON store.

    Behaves like a `dict[str, dict]` from the caller's perspective,
    but every mutation is durably committed before the call returns.

    Thread-safety: the wrapped sqlite3.Connection is opened with
    ``check_same_thread=False`` and every operation takes an RLock.
    Callers can also acquire ``.lock`` externally to bracket a multi-step
    sequence (the legacy code held ``_jobs_lock`` around create + update).
    The lock is reentrant so an external caller can hold it while the
    store reaches for it internally without deadlocking.
    """

    def __init__(self, path: Optional[str] = None, table: str = "kv") -> None:
        if not table.replace("_", "").isalnum():
            raise ValueError(f"unsafe table name {table!r}")
        self._path = _resolve_path(path)
        self._table = table
        self.lock = threading.RLock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        # WAL gives concurrent reads a wait-free path while a write is in
        # flight; harmless for :memory: (sqlite ignores it there).
        try:
            self._conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.DatabaseError:
            pass
        self._conn.execute(
            f"CREATE TABLE IF NOT EXISTS {self._table} ("
            "  key TEXT PRIMARY KEY,"
            "  data TEXT NOT NULL"
            ")"
        )
        self._conn.commit()

    # ----- mapping protocol --------------------------------------------------

    def __setitem__(self, key: str, value: dict[str, Any]) -> None:
        payload = json.dumps(value)
        with self.lock:
            self._conn.execute(
                f"INSERT OR REPLACE INTO {self._table} (key, data) VALUES (?, ?)",
                (key, payload),
            )
            self._conn.commit()

    def __getitem__(self, key: str) -> dict[str, Any]:
        rec = self.get(key)
        if rec is None:
            raise KeyError(key)
        return rec

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        with self.lock:
            row = self._conn.execute(
                f"SELECT 1 FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
        return row is not None

    def __iter__(self) -> Iterator[str]:
        return iter(self.keys())

    def __len__(self) -> int:
        with self.lock:
            row = self._conn.execute(
                f"SELECT COUNT(*) FROM {self._table}"
            ).fetchone()
        return int(row[0]) if row else 0

    # ----- dict-style helpers -----------------------------------------------

    def get(self, key: str, default: Any = None) -> Any:
        with self.lock:
            row = self._conn.execute(
                f"SELECT data FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
        return json.loads(row[0]) if row else default

    def pop(self, key: str, default: Any = _MISSING) -> Any:
        with self.lock:
            row = self._conn.execute(
                f"SELECT data FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                if default is _MISSING:
                    raise KeyError(key)
                return default
            self._conn.execute(
                f"DELETE FROM {self._table} WHERE key = ?", (key,)
            )
            self._conn.commit()
        return json.loads(row[0])

    def keys(self) -> list[str]:
        with self.lock:
            rows = self._conn.execute(
                f"SELECT key FROM {self._table}"
            ).fetchall()
        return [r[0] for r in rows]

    def values(self) -> list[dict[str, Any]]:
        with self.lock:
            rows = self._conn.execute(
                f"SELECT data FROM {self._table}"
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def items(self) -> list[tuple[str, dict[str, Any]]]:
        with self.lock:
            rows = self._conn.execute(
                f"SELECT key, data FROM {self._table}"
            ).fetchall()
        return [(k, json.loads(d)) for (k, d) in rows]

    # ----- update helper ----------------------------------------------------

    def update_fields(self, key: str, **fields: Any) -> dict[str, Any]:
        """Read-modify-write a single entry under one lock.

        Returns the merged record. Raises KeyError if the entry doesn't
        exist — callers that want upsert semantics should fall back to
        ``__setitem__`` after catching it.
        """
        with self.lock:
            row = self._conn.execute(
                f"SELECT data FROM {self._table} WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                raise KeyError(key)
            entry = json.loads(row[0])
            entry.update(fields)
            self._conn.execute(
                f"UPDATE {self._table} SET data = ? WHERE key = ?",
                (json.dumps(entry), key),
            )
            self._conn.commit()
        return entry

    def close(self) -> None:
        with self.lock:
            self._conn.close()
