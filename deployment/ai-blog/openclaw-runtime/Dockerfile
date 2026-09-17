ARG OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw:2026.9.4
FROM ${OPENCLAW_BASE_IMAGE}
USER root
ARG APP_UID=1000
ARG APP_GID=1000
RUN if [ "$APP_GID" != 1000 ]; then groupmod -g "$APP_GID" node; fi \
    && if [ "$APP_UID" != 1000 ]; then usermod -u "$APP_UID" -g "$APP_GID" node; fi
USER node
