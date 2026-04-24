FROM python:3.12-slim

WORKDIR /app

# `bash` is required by the `shell` task type (run.sh under SCENARIO_SCRIPTS_DIR).
# The `slim` base ships dash as /bin/sh; install bash explicitly.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

# Default location for scenario scripts; override with SCENARIO_SCRIPTS_DIR.
# Compose mounts the repo's agents/scenarios here read-only.
ENV SCENARIO_SCRIPTS_DIR=/scenarios

# Run as a non-root user. The shell task type executes mounted scripts; if
# one ever changes unexpectedly, dropping privileges contains the blast
# radius. /scenarios is read-only-mounted by compose, so the worker doesn't
# need write access there.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
