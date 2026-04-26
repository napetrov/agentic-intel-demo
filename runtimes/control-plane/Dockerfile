FROM python:3.12-slim

WORKDIR /app

RUN useradd --create-home --uid 1000 --shell /bin/bash appuser

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
COPY session_manager.py /app/session_manager.py
COPY persistence.py /app/persistence.py

# Default location for the durable job/session sqlite databases. The
# compose file mounts a named volume here so a `docker compose restart`
# preserves issued result_refs and the multi-agent fan-out table.
RUN mkdir -p /var/lib/control-plane && chown appuser:appuser /var/lib/control-plane
ENV JOBS_DB_PATH=/var/lib/control-plane/jobs.db \
    SESSIONS_DB_PATH=/var/lib/control-plane/sessions.db

USER appuser

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
