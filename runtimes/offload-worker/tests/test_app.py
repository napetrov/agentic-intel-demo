"""Smoke tests for the offload-worker API.

Small payloads only so the S3/MinIO put_object path is not exercised. That keeps
the test self-contained — no moto, no local MinIO. Environment variables
(MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY) are consumed by app.py at
import time but boto3 creates the client lazily, so any non-empty values work.
"""
import os
import sys
from pathlib import Path

os.environ.setdefault("MINIO_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("MINIO_ACCESS_KEY", "dummy")
os.environ.setdefault("MINIO_SECRET_KEY", "dummy")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_echo_returns_payload_inline():
    r = client.post(
        "/run",
        json={"task_type": "echo", "payload": {"msg": "hi"}, "session_id": "s1"},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"] == {"echo": {"msg": "hi"}}
    assert body["result_key"] is None
    assert body["task_id"].startswith("task-")


def test_pandas_describe():
    r = client.post(
        "/run",
        json={
            "task_type": "pandas_describe",
            "payload": {"data": [{"a": 1, "b": 2}, {"a": 3, "b": 4}, {"a": 5, "b": 6}]},
        },
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["a"]["mean"] == 3.0
    assert body["result"]["b"]["mean"] == 4.0


def test_pandas_describe_from_csv_string():
    r = client.post(
        "/run",
        json={
            "task_type": "pandas_describe",
            "payload": {"data": "a,b\n1,2\n3,4\n5,6\n"},
        },
    )
    assert r.json()["status"] == "ok"


def test_sklearn_train():
    r = client.post(
        "/run",
        json={
            "task_type": "sklearn_train",
            "payload": {
                "X": [[0, 0], [1, 1], [0, 1], [1, 0], [2, 2], [2, 0]],
                "y": [0, 1, 0, 1, 1, 1],
            },
        },
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["n_samples"] == 6
    assert body["result"]["n_features"] == 2
    assert 0.0 <= body["result"]["mean_accuracy"] <= 1.0


def test_unknown_task_type_returns_error():
    r = client.post(
        "/run",
        json={"task_type": "does-not-exist", "payload": {}},
    )
    body = r.json()
    assert r.status_code == 200  # endpoint shape: errors are in the body
    assert body["status"] == "error"
    assert body["error"] is not None


def test_validation_error_for_bad_request():
    # missing required field "payload"
    r = client.post("/run", json={"task_type": "echo"})
    assert r.status_code == 422
