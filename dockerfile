# syntax=docker/dockerfile:1.4
##############################################################################
# Build caddy with brotli compression support
FROM caddy:builder-alpine AS caddy-builder

# Enable cgo for compiling the Brotli plugin
ENV CGO_ENABLED=1

# Install C toolchain, Brotli and redis plugin dependencies
RUN apk add --no-cache \
    brotli-dev \
    pkgconfig \
    git \
    build-base \
  && xcaddy build \
      --with github.com/dunglas/caddy-cbrotli \
      --with github.com/caddyserver/cache-handler@latest \
      --with github.com/pberkel/caddy-storage-redis

##############################################################################
# Stage 0: Frontend Assets Builder with Vite
# This stage builds your Vite assets (www folder)
FROM node:20-slim as frontend-builder
WORKDIR /app
# Copy package.json and package-lock.json first to leverage Docker cache
COPY package.json package-lock.json ./
# Use npm ci for clean install if package-lock.json exists, otherwise npm install
RUN npm ci || npm install
# Copy all source files required for the build (e.g., src/, public/ if any)
COPY . .
# Run the Vite build command to generate the 'www' directory
# This uses the `build` script we added to your package.json
RUN npm run build
RUN mv /app/www/src/index.html /app/www/ && \
    mv /app/www/src/login.html /app/www/ && \
    rm -r /app/www/src

##############################################################################
# 1. Base image (now main Caddy stage)
FROM caddy:2-alpine

# Install Brotli, redis runtime libraries (libbrotlidec.so.1, libbrotlienc.so.1)
RUN apk add --no-cache brotli-libs redis

# 1.1 Replace core caddy binary with our custom-built one
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy

##############################################################################
# 2. Build args & env
ARG DOMAIN
ARG EMAIL
ARG APP_PASSWORD
ENV DOMAIN=${DOMAIN} \
    EMAIL=${EMAIL} \
    APP_PASSWORD=${APP_PASSWORD} \
    ACME_CA=https://acme-v02.api.letsencrypt.org/directory

##############################################################################
# 3. System deps
RUN apk add --no-cache \
      bash procps python3 py3-pip py3-virtualenv ca-certificates \
      curl \
      gnupg \
    && update-ca-certificates \
    && GOSU_VERSION="1.16" \
    && ALPINE_ARCH="$(apk --print-arch)" \
    && case "${ALPINE_ARCH}" in \
        x86_64) GOSU_ARCH="amd64" ;; \
        aarch64) GOSU_ARCH="arm64" ;; \
        armhf) GOSU_ARCH="armhf" ;; \
        *) echo "Unsupported architecture: ${ALPINE_ARCH}"; exit 1 ;; \
       esac \
    && curl -Lo /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/${GOSU_VERSION}/gosu-${GOSU_ARCH}" \
    && curl -Lo /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/${GOSU_VERSION}/gosu-${GOSU_ARCH}.asc" \
    && export GNUPGHOME="$(mktemp -d)" \
    && gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4 \
    && gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu \
    && rm -rf "$GNUPGHOME" /usr/local/bin/gosu.asc \
    && chmod +x /usr/local/bin/gosu

##############################################################################
# 4. Python venv & packages
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"
RUN pip install \
      feedparser feedgen requests python-dateutil \
      Flask==2.2.5 Werkzeug==2.3.7 bleach markdown \
      gunicorn Flask-Caching redis \
    && rm -rf /root/.cache/pip

##############################################################################
# 5. Copy code & initial data
WORKDIR /app
COPY rss/ /rss/

# IMPORTANT: This line now copies the 'www' folder, which Vite will generate.
COPY --from=frontend-builder /app/www/ /app/www/
COPY src/api.py /app/www/api.py

COPY data/ /data/feed/

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

##############################################################################
# 6. Build entrypoint
RUN mkdir -p /usr/local/bin && \
    echo '#!/usr/bin/env bash' > /usr/local/bin/docker-entrypoint.sh && \
    echo 'set -e' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'mkdir -p /data/feed /data/user_state /data/config' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'chown -R appuser:appgroup /data/user_state /data/feed /app /rss' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'mkdir -p /data/redis && chown redis:redis /data/redis' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'cat <<EOF > /etc/redis.conf' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'dir /data/redis' >> /etc/redis.conf && \
    echo 'save 900 1' >> /etc/redis.conf && \
    echo 'save 300 10' >> /etc/redis.conf && \
    echo 'appendonly yes' >> /etc/redis.conf && \
    echo 'appendfsync always' >> /etc/redis.conf && \
    echo 'appendfilename "appendonly.aof"' >> /etc/redis.conf && \
    echo 'appenddirname "appendonlydir"' >> /etc/redis.conf && \
    echo 'EOF' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'redis-server /etc/redis.conf --daemonize yes &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'gosu appuser /venv/bin/gunicorn --chdir /app/www --bind 127.0.0.1:4575 --workers 1 --threads 3 api:app &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'gosu appuser python3 /rss/run.py --daemon &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'if ! caddy run --config /etc/caddy/Caddyfile --adapter caddyfile; then' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  echo "Falling back to Let''s Encrypt staging CA"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  export ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

##############################################################################
# 7. copy Caddyfile (persist to /data, allow ACME_CA override)
COPY Caddyfile /etc/caddy/Caddyfile
RUN sed -i "s|{\$EMAIL}|${EMAIL}|g" /etc/caddy/Caddyfile && \
    sed -i "s|{\$ACME_CA:[^}]*}|${ACME_CA}|g" /etc/caddy/Caddyfile && \
    sed -i "s|{\$DOMAIN}|${DOMAIN}|g" /etc/caddy/Caddyfile

##############################################################################
# 8. Declare the data volume & expose ports
VOLUME /data
EXPOSE 80 443 4575

##############################################################################
# 9. Entrypoint + default CMD
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]