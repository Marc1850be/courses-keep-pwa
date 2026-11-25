FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PWA_DIR=/app/pwa \
    DATA_DIR=/app/data

COPY backend-keep/requirements.txt /app/backend-keep/requirements.txt
RUN pip install --no-cache-dir -r /app/backend-keep/requirements.txt

COPY backend-keep/ /app/backend-keep/
COPY pwa/ /app/pwa/

WORKDIR /app/backend-keep

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
