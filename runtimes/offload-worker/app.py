"""
Offload API — System B worker for CPU-heavy tasks.
Tasks arrive via POST /run, execute in-process, results saved to MinIO.
"""
import os, json, uuid, traceback, io
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Optional
import boto3

app = FastAPI(title="Offload API", version="0.1.0")

MINIO_ENDPOINT  = os.environ["MINIO_ENDPOINT"]          # e.g. http://minio.system-b:9000
MINIO_ACCESS    = os.environ["MINIO_ACCESS_KEY"]
MINIO_SECRET    = os.environ["MINIO_SECRET_KEY"]
MINIO_BUCKET    = os.environ.get("MINIO_BUCKET", "demo-artifacts")

s3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    region_name="us-east-1",
)


class TaskRequest(BaseModel):
    task_type: str                  # "pandas_describe" | "sklearn_train" | "echo"
    payload:   dict[str, Any]
    session_id: Optional[str] = None


class TaskResult(BaseModel):
    task_id:    str
    status:     str                 # "ok" | "error"
    result_key: Optional[str] = None   # MinIO object key when saved
    result:     Optional[Any] = None   # inline for small responses
    error:      Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run", response_model=TaskResult)
def run_task(req: TaskRequest):
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    try:
        result = dispatch(req.task_type, req.payload)

        # Save to MinIO if result is large
        result_json = json.dumps(result)
        if len(result_json) > 4096:
            key = f"offload/{req.session_id or 'anon'}/{task_id}.json"
            s3.put_object(Bucket=MINIO_BUCKET, Key=key, Body=result_json.encode())
            return TaskResult(task_id=task_id, status="ok", result_key=key)
        else:
            return TaskResult(task_id=task_id, status="ok", result=result)

    except Exception as e:
        return TaskResult(task_id=task_id, status="error", error=traceback.format_exc())


def dispatch(task_type: str, payload: dict) -> Any:
    if task_type == "echo":
        return {"echo": payload}

    elif task_type == "pandas_describe":
        import pandas as pd
        data = payload.get("data")           # list of dicts or CSV string
        if isinstance(data, str):
            df = pd.read_csv(io.StringIO(data))
        else:
            df = pd.DataFrame(data)
        return json.loads(df.describe().to_json())

    elif task_type == "sklearn_train":
        from sklearn.linear_model import LogisticRegression
        from sklearn.model_selection import cross_val_score
        import numpy as np
        X = np.array(payload["X"])
        y = np.array(payload["y"])
        clf = LogisticRegression(max_iter=500)
        scores = cross_val_score(clf, X, y, cv=min(3, len(y)))
        clf.fit(X, y)
        return {
            "cv_scores": scores.tolist(),
            "mean_accuracy": float(scores.mean()),
            "n_samples": len(y),
            "n_features": X.shape[1],
        }

    else:
        raise ValueError(f"Unknown task_type: {task_type!r}")
