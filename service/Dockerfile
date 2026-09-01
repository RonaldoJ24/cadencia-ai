FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

RUN pip install --no-cache-dir uv==0.11.27 \
    && addgroup --system --gid 10001 cadencia \
    && adduser --system --uid 10001 --gid 10001 cadencia

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache

COPY app.py provider.py ./
RUN chown -R cadencia:cadencia /app

USER cadencia
ENV PORT=8080

CMD ["sh", "-c", "exec /app/.venv/bin/uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --no-access-log --log-level critical"]
