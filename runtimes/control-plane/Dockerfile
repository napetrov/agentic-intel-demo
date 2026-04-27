FROM python:3.12-slim

WORKDIR /app

RUN useradd --create-home --uid 1000 --shell /bin/bash appuser

# Build context is the repo root (see docker-compose.yaml) so this
# Dockerfile can pull both the control-plane sources and the agent
# registry seed under config/. Sources are copied one-by-one (rather
# than `COPY runtimes/control-plane /app`) so unrelated files in that
# directory don't sneak into the image.
COPY runtimes/control-plane/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY runtimes/control-plane/app.py /app/app.py
COPY runtimes/control-plane/session_manager.py /app/session_manager.py
COPY runtimes/control-plane/persistence.py /app/persistence.py
COPY runtimes/control-plane/agent_registry.py /app/agent_registry.py

# Bake the agent registry seed into the image so `docker run` (no
# compose, no volume mount) boots with the four default long-lived
# agents visible. The compose file bind-mounts the live in-tree file
# over this path so dev iteration on agents.yaml takes effect on
# restart without a rebuild.
COPY config/agents.yaml /etc/control-plane/agents.yaml

# Default location for the durable job/session sqlite databases. The
# compose file mounts a named volume here so a `docker compose restart`
# preserves issued result_refs and the multi-agent fan-out table.
RUN mkdir -p /var/lib/control-plane && chown appuser:appuser /var/lib/control-plane
ENV JOBS_DB_PATH=/var/lib/control-plane/jobs.db \
    SESSIONS_DB_PATH=/var/lib/control-plane/sessions.db \
    AGENT_REGISTRY_PATH=/etc/control-plane/agents.yaml

USER appuser

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
