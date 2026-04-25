FROM python:3.12-slim

WORKDIR /app

# Allow-listed shell tool runs `whoami`, `ls`, `cat`, etc. via subprocess —
# they're already in the slim base, no extra apt packages needed.

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

ENV AGENT_WORKSPACE_DIR=/workspace

# Drop privileges. /workspace is mounted read-only by compose.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
