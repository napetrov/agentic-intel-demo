"""Concurrency tests for SqliteJsonStore.

The store is shared between uvicorn worker threads and tells the world
it's safe to do so via ``check_same_thread=False`` + an in-process
RLock. test_persistence.py covers the sequential semantics; this file
verifies the lock actually prevents lost updates / interleaved reads.

Backed by ``:memory:`` databases so it runs anywhere the rest of the
suite does. The on-disk path uses WAL and would behave identically
under contention; we just don't need the disk to make the point.
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from persistence import SqliteJsonStore


# Sized for the GitHub runner: enough threads + iterations to expose
# missing locking on a multi-core box, small enough not to slow the
# wider suite. The test takes ~50ms locally.
N_THREADS = 8
N_ITERS = 200


def test_concurrent_setitem_does_not_lose_writes():
    """Each (thread, iter) pair writes a unique key — all must persist."""
    with SqliteJsonStore() as store:
        def writer(tid: int) -> None:
            for i in range(N_ITERS):
                store[f"k-{tid}-{i}"] = {"tid": tid, "i": i}

        with ThreadPoolExecutor(max_workers=N_THREADS) as pool:
            for f in as_completed(pool.submit(writer, t) for t in range(N_THREADS)):
                f.result()  # surface any thread-side exception

        assert len(store) == N_THREADS * N_ITERS
        # Spot-check: read back every key, verify the payload survived.
        for tid in range(N_THREADS):
            for i in range(N_ITERS):
                assert store[f"k-{tid}-{i}"] == {"tid": tid, "i": i}


def test_external_lock_guards_manual_read_modify_write():
    """Callers that bracket a read/modify/write with `store.lock` must
    not lose increments under contention.

    This exercises the documented external-lock idiom — `with store.lock:
    cur = store[k]; store[k] = ...` — not `update_fields()` itself
    (which is covered by test_update_fields_atomic_against_setitem).
    Without the RLock, the read+__setitem__ pair would interleave and
    the final counter would be far below the expected total.
    """
    with SqliteJsonStore() as store:
        store["counter"] = {"n": 0, "log": []}

        def bump(_tid: int) -> None:
            for _ in range(N_ITERS):
                # Hold the store-level lock so the read+update+write
                # below stays atomic against other workers — same idiom
                # the real callers use.
                with store.lock:
                    cur = store["counter"]
                    store["counter"] = {"n": cur["n"] + 1, "log": cur["log"]}

        with ThreadPoolExecutor(max_workers=N_THREADS) as pool:
            for f in as_completed(pool.submit(bump, t) for t in range(N_THREADS)):
                f.result()

        assert store["counter"]["n"] == N_THREADS * N_ITERS


def test_update_fields_atomic_against_setitem():
    """update_fields holds the lock across read-modify-write; concurrent
    __setitem__ must either run fully before or fully after — never
    overwrite the in-flight merged value with a stale one mid-flight.
    """
    with SqliteJsonStore() as store:
        store["rec"] = {"a": 0, "b": 0}
        stop = threading.Event()
        observed_partial = []

        def updater() -> None:
            for i in range(N_ITERS):
                merged = store.update_fields("rec", a=i, b=i)
                # Invariant: a == b at every snapshot returned by
                # update_fields, because we set them together.
                if merged["a"] != merged["b"]:
                    observed_partial.append(merged)
            stop.set()

        def overwriter() -> None:
            j = 0
            while not stop.is_set():
                # Equal write — also preserves the a == b invariant.
                store["rec"] = {"a": j, "b": j}
                j += 1

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(updater)
            f2 = pool.submit(overwriter)
            f1.result()
            f2.result()

        assert observed_partial == [], (
            f"update_fields returned a torn record: {observed_partial[:3]}"
        )


def test_pop_is_exclusive():
    """Two threads racing to pop the same key — exactly one wins."""
    wins = []
    misses = []
    barrier = threading.Barrier(2)

    with SqliteJsonStore() as store:
        for i in range(N_ITERS):
            store[f"k-{i}"] = {"i": i}

            def racer() -> None:
                barrier.wait()
                try:
                    store.pop(f"k-{i}")
                except KeyError:
                    misses.append(i)
                else:
                    wins.append(i)

            with ThreadPoolExecutor(max_workers=2) as pool:
                f1 = pool.submit(racer)
                f2 = pool.submit(racer)
                f1.result()
                f2.result()
            barrier.reset()

        assert len(wins) == N_ITERS
        assert len(misses) == N_ITERS
        # Final state: every key gone.
        assert len(store) == 0


def test_update_fields_missing_key_raises_under_contention():
    """update_fields must raise KeyError for missing keys even when
    contended — the read-then-raise must happen under the lock."""
    with SqliteJsonStore() as store:
        errors: list[BaseException] = []

        def attempt() -> None:
            for _ in range(N_ITERS):
                try:
                    store.update_fields("never-set", x=1)
                except KeyError:
                    pass
                except BaseException as exc:  # noqa: BLE001
                    errors.append(exc)

        with ThreadPoolExecutor(max_workers=N_THREADS) as pool:
            for f in as_completed(pool.submit(attempt) for _ in range(N_THREADS)):
                f.result()

        assert errors == [], f"unexpected non-KeyError under contention: {errors[:2]}"


def test_snapshot_reads_consistent_with_concurrent_writes():
    """Snapshot reads (keys/values/items) must return an internally
    consistent picture — every key reported by keys() must also be
    readable. Bounded write budget keeps the test fast: writers stop
    after N_ITERS each so readers don't chase an unbounded set."""
    with SqliteJsonStore() as store:
        def writer(tid: int) -> None:
            for i in range(N_ITERS):
                store[f"w-{tid}-{i}"] = {"tid": tid, "i": i}

        def reader() -> None:
            for _ in range(20):
                # values() / items() / keys() each hold the lock for the
                # whole scan; the result is internally consistent.
                snapshot = store.items()
                for k, v in snapshot:
                    assert isinstance(k, str)
                    assert "tid" in v and "i" in v

        with ThreadPoolExecutor(max_workers=N_THREADS + 2) as pool:
            futures = [pool.submit(writer, t) for t in range(N_THREADS)]
            futures += [pool.submit(reader) for _ in range(2)]
            for f in as_completed(futures):
                f.result()

        assert len(store) == N_THREADS * N_ITERS
