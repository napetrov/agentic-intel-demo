#!/usr/bin/env python3
"""Tier 1 scenario-slice driver used by CI.

Drives the `market_research` scenario contract end-to-end against a running
control-plane + offload-worker + MinIO stack:

  1. POST /offload {task_type: echo}          -> small-payload path (inline result)
  2. GET  /offload/{job_id}                   -> assert completed + result shape
  3. POST /offload {task_type: pandas_describe, payload: LARGE}
                                              -> forces MinIO-backed result_key
  4. GET  /offload/{job_id}                   -> assert result_ref set
  5. GET  /artifacts/{ref}                    -> presigned URL
  6. HEAD/GET presigned URL                   -> artifact actually readable

Asserts the returned shape matches `docs/contracts/offload-result-contract.md`.

Run via the `tier1-scenario-slice` CI job; fails the job on any mismatch.
"""
from __future__ import annotations

import os
import sys
import time
from urllib.parse import urlparse

import httpx


CONTROL_PLANE = os.environ.get("CONTROL_PLANE_URL", "http://127.0.0.1:8090")
TIMEOUT = httpx.Timeout(30.0, connect=5.0)


def die(msg: str, extra: object = None) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    if extra is not None:
        print(f"  detail: {extra!r}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    with httpx.Client(base_url=CONTROL_PLANE, timeout=TIMEOUT) as c:
        # 0. health — retry: the preceding CI step already waits for a
        # 200 on /health, but a cold process can still return stale
        # connections on the first driver request under load. Cheap.
        deadline = time.time() + 30
        last_error: object = None
        h = None
        while time.time() < deadline:
            try:
                h = c.get("/health")
                if h.status_code == 200:
                    break
                last_error = h.text
            except httpx.HTTPError as exc:
                last_error = exc
            time.sleep(0.5)
        if h is None or h.status_code != 200:
            die("control-plane /health never became ready", last_error)
        print(f"OK  /health -> {h.json()}")

        # 1. small-payload path
        r = c.post(
            "/offload",
            json={
                "task_type": "echo",
                "payload": {"scenario": "market_research", "q": "tea market 2024"},
                "session_id": "ci-sess-1",
            },
        )
        if r.status_code != 200:
            die(f"POST /offload returned {r.status_code}", r.text)
        small = r.json()
        required = {"job_id", "status", "session_id"}
        if not required.issubset(small):
            die("submit response missing required fields", small)
        if small["status"] != "completed":
            die("expected immediate status=completed for echo", small)
        job_id = small["job_id"]
        print(f"OK  POST /offload echo -> {job_id}")

        # 2. GET /offload/{job_id}
        r = c.get(f"/offload/{job_id}")
        if r.status_code != 200:
            die("GET /offload/{id} for echo job", r.text)
        status = r.json()
        for required_field in ("job_id", "status", "task_id", "submitted_at"):
            if required_field not in status:
                die(f"status response missing `{required_field}`", status)
        if status["result"] != {"echo": {"scenario": "market_research", "q": "tea market 2024"}}:
            die("echo result did not round-trip", status)
        if status["result_ref"] is not None:
            die("echo result should be inline, not a ref", status)
        print(f"OK  GET /offload/{job_id} -> result shape matches")

        # 3. large-payload path — echo a payload big enough that the
        # serialized result exceeds the 4KB threshold in
        # runtimes/offload-worker/app.py, forcing the MinIO-backed
        # result_key path. pandas_describe produces tiny stats output
        # regardless of input size, so it's not a good large-output probe.
        big_payload = {"rows": [{"i": i, "s": f"row-{i:04d}-" + "x" * 16} for i in range(400)]}
        r = c.post(
            "/offload",
            json={
                "task_type": "echo",
                "payload": big_payload,
                "session_id": "ci-sess-2",
            },
        )
        if r.status_code != 200:
            die("POST /offload large echo", r.text)
        big = r.json()
        if big["status"] != "completed":
            die("large echo should complete synchronously in the relay", big)
        big_id = big["job_id"]
        print(f"OK  POST /offload large echo -> {big_id}")

        # 4. assert a result_ref was produced
        r = c.get(f"/offload/{big_id}")
        if r.status_code != 200:
            die(f"GET /offload/{{id}} for large echo returned {r.status_code}", r.text)
        big_status = r.json()
        if not big_status.get("result_ref"):
            die("large echo should return a MinIO ref", big_status)
        ref = big_status["result_ref"]
        print(f"OK  GET /offload/{big_id} -> result_ref={ref}")

        # 5. presign it
        r = c.get(f"/artifacts/{ref}")
        if r.status_code != 200:
            die("GET /artifacts/{ref} presign", r.text)
        art = r.json()
        if art["ref"] != ref or not art["url"].startswith("http"):
            die("artifact presign shape mismatch", art)
        print(f"OK  /artifacts/{ref} -> presigned URL")

    # 6. fetch the artifact via the presigned URL (outside the control plane).
    # If MinIO advertised an in-cluster hostname we rewrite the URL host to
    # `localhost` so the runner can actually reach it. SigV4 includes the
    # Host header in the signature, so we must preserve the ORIGINAL host
    # (the one the URL was signed with) as an explicit `Host` header —
    # otherwise MinIO returns `SignatureDoesNotMatch`. See
    # https://github.com/minio/minio/issues/11870.
    url = art["url"]
    parsed = urlparse(url)
    headers: dict[str, str] = {}
    if parsed.hostname and parsed.hostname not in {"localhost", "127.0.0.1"}:
        original_host = parsed.hostname
        if parsed.port:
            original_host = f"{original_host}:{parsed.port}"
        url = url.replace(
            f"{parsed.scheme}://{parsed.netloc}", "http://localhost"
        )
        headers["Host"] = original_host
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.get(url, headers=headers)
        if r.status_code != 200:
            die(f"presigned artifact fetch returned {r.status_code}", r.text[:200])
        body = r.json()
        if body.get("echo", {}).get("rows") is None:
            die("artifact does not look like the echoed payload", str(body)[:200])
        if len(body["echo"]["rows"]) != 400:
            die("artifact row count did not round-trip", len(body["echo"]["rows"]))
        print(f"OK  artifact fetched and parsed — rows={len(body['echo']['rows'])}")

    # 7. unknown job id -> 404
    with httpx.Client(base_url=CONTROL_PLANE, timeout=TIMEOUT) as c:
        r = c.get("/offload/job-does-not-exist")
        if r.status_code != 404:
            die("unknown job id should 404", r.text)
        print("OK  unknown job_id returns 404")

    print("\nAll scenario-slice checks passed.")
    # Small sleep so CI captures trailing logs cleanly.
    time.sleep(0.2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
