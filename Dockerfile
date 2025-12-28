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

# Pass build arguments to Vite
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

# Run the Vite build command to generate the 'www' directory
# This uses the `build` script we added to your package.json
RUN npm run build
#RUN mv /app/www/src/index.html /app/www/ && \
#    mv /app/www/src/login.html /app/www/ && \
#    rm -r /app/www/src

##############################################################################
# 1. Base image
FROM node:20-slim

# Install Caddy, Redis, and other dependencies
RUN apt-get update && apt-get install -y \
    caddy \
    redis-server \
    redis-tools \
    bash \
    procps \
    curl \
    gnupg \
    gosu \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
# 3. System deps & Gosu
RUN GOSU_VERSION="1.16" \
    && dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')" \
    && curl -Lo /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/${GOSU_VERSION}/gosu-${dpkgArch}" \
    && curl -Lo /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/${GOSU_VERSION}/gosu-${dpkgArch}.asc" \
    && export GNUPGHOME="$(mktemp -d)" \
    && gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4 \
    && gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu \
    && rm -rf "$GNUPGHOME" /usr/local/bin/gosu.asc \
    && chmod +x /usr/local/bin/gosu

##############################################################################
# 4. Copy code & initial data
WORKDIR /app

# Create appuser and appgroup
RUN groupadd --system appgroup && useradd --system --gid appgroup --home-dir /app --create-home appuser

# Create logs directory
RUN mkdir -p /app/logs && chown appuser:appgroup /app/logs

# NEW: Copy source files and entrypoint into the image
COPY package.json package-lock.json /app/
COPY worker/ /app/worker/
COPY build_entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh # Make the entrypoint executable

# IMPORTANT: This line now copies the 'www' folder, which Vite will generate.
COPY --from=frontend-builder /app/www/ /app/www/
# Ensure appuser has read/write access to everything in /app
RUN chown -R appuser:appgroup /app

# Copy initial configuration files into the image
COPY ./data/config/rssFeeds.json /data/config/rssFeeds.json
COPY ./data/config/keywordBlacklist.json /data/config/keywordBlacklist.json

##############################################################################
# 7. copy Caddyfile (persist to /data, allow ACME_CA override)
COPY Caddyfile /etc/caddy/Caddyfile
RUN sed -i "s|{\$EMAIL}|${EMAIL}|g" /etc/caddy/Caddyfile && \
    sed -i "s|{\$ACME_CA:[^}]*}|${ACME_CA}|g" /etc/caddy/Caddyfile && \
    sed -i "s|{\$DOMAIN}|${DOMAIN}|g" /etc/caddy/Caddyfile

##############################################################################
# 8. Declare the data volume & expose ports
VOLUME /data
EXPOSE 80 443

##############################################################################
# 9. Entrypoint + default CMD
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]