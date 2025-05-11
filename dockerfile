# syntax=docker/dockerfile:1.4
##############################################################################
# Build caddy with brotli compression support
FROM caddy:builder-alpine AS caddy-builder

# Enable cgo for compiling the Brotli plugin
ENV CGO_ENABLED=1                                                                  

# Install C toolchain, Brotli and redis plugin dependencies
# - brotli-dev: C headers/libs
# - pkgconfig: metadata for cgo to find Brotli
# - git: fetch xcaddy modules
# - build-base: gcc, musl-dev, make, etc.
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
# 1. Base image
FROM caddy:2-alpine

# Install Brotli, redis runtime libraries (libbrotlidec.so.1, libbrotlienc.so.1)
RUN apk add --no-cache brotli-libs redis

# 1.1 Replace core caddy binary with our custom-built one
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy

##############################################################################
# 2. Build args & env
ARG DOMAIN
ARG EMAIL
ENV DOMAIN=${DOMAIN} \
    EMAIL=${EMAIL} \
    ACME_CA=https://acme-v02.api.letsencrypt.org/directory

##############################################################################
# 3. System deps
RUN apk add --no-cache \
      bash procps python3 py3-pip py3-virtualenv ca-certificates \
    && update-ca-certificates

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
COPY www/ /app/www/
COPY data/ /data/feed/

##############################################################################
# 6. Build entrypoint with echo
RUN mkdir -p /usr/local/bin && \
    echo '#!/usr/bin/env bash' > /usr/local/bin/docker-entrypoint.sh && \
    echo 'set -e' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'mkdir -p /data/redis && chown redis:redis /data/redis' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'cat <<EOF > /etc/redis.conf' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'dir /data/redis' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'save 900 1' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'save 300 10' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'appendonly yes' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'appendfsync always' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'appendfilename "appendonly.aof"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'appenddirname "appendonlydir"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'EOF' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'redis-server /etc/redis.conf --daemonize yes &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'gunicorn --chdir /app/www --bind 127.0.0.1:3000 --workers 1 --threads 3 api:app &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'python3 /rss/run.py --daemon &' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'if [ ! -f "/data/autosave.json" ]; then' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  echo "[entrypoint] No existing cert state—provisioning…"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  if ! caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --environ --watch; then' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    echo "[entrypoint] ACME failed—switching to STAGING CA"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '    export ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  fi' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile' >> /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

##############################################################################
# 7. copy Caddyfile (persist to /data, allow ACME_CA override)
COPY Caddyfile /etc/caddy/Caddyfile

# 7.1 Conditional auth configuration
RUN if [ -n "$CADDY_PASSWORD" ]; then \
    HASH=$(caddy hash-password --plaintext "$CADDY_PASSWORD") && \
    # Uncomment auth block and insert hash
    sed -i "/# AUTH_START/,/# AUTH_END/ { \
        s/# //g; \
        s/<HASH_PLACEHOLDER>/$(echo $HASH | sed 's/[\/&]/\\&/g')/; \
    }" /etc/caddy/Caddyfile && \
    # Uncomment cookie block
    sed -i "/# COOKIE_START/,/# COOKIE_END/ s/# //g" /etc/caddy/Caddyfile; \
fi
##############################################################################
# 8. Declare the data volume & expose ports
VOLUME /data
EXPOSE 80 443 3000

##############################################################################
# 9. Entrypoint + default CMD
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

