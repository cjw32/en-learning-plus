FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home publisher
ARG APP_UID=1000
ARG APP_GID=1000
RUN if [ "$APP_GID" != 1000 ]; then groupmod -g "$APP_GID" publisher; fi \
    && if [ "$APP_UID" != 1000 ]; then usermod -u "$APP_UID" -g "$APP_GID" publisher; fi
WORKDIR /app
COPY --chmod=644 server.py /app/server.py
USER publisher
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]
