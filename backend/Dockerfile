FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --uid 10001 --create-home studio && mkdir -p /data/documents && chown studio:studio /data/documents
COPY backend/ ./
USER studio
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]

FROM base AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ocrmypdf tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
USER studio
CMD ["python", "worker.py"]


