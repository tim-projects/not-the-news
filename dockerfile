# syntax=docker/dockerfile:1.4
##############################################################################
# Build caddy with brotli compression support
FROM docker.io/library/caddy:builder-alpine AS caddy-builder

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
#RUN mv /app/www/src/index.html /app/www/ && \
#    mv /app/www/src/login.html /app/www/ && \
#    rm -r /app/www/src

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

# Copy initial configuration files into the image
COPY ./data/config/rssFeeds.json /data/config/rssFeeds.json
COPY ./data/config/keywordBlacklist.json /data/config/keywordBlacklist.json

COPY data/ /data/feed/

COPY build_entrypoint.sh /build_entrypoint.sh

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown appuser:appgroup /tmp

##############################################################################
# 6. Build entrypoint
RUN cp /build_entrypoint.sh /usr/local/bin/docker-entrypoint.sh && \
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