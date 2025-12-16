#!/bin/bash
# Help function
usage() {
    echo "Usage: $0 [-p PASSWORD] [-n]"
    echo
    echo "Options:"
    echo "  -p PASSWORD  [Optional] Site protection password"
    echo "  -n           Disable Docker build cache"
    echo "  -h           Show this help message"
    exit 1
}

# Parse arguments with debug
echo "Parsing arguments..."
while getopts ":hn" opt; do
    case $opt in

        n) NO_CACHE=1; echo "Disabling cache" ;; 
        h) usage ;; 
        \?) echo "Invalid option -$OPTARG" >&2; usage ;; 
        :) echo "Option -$OPTARG requires an argument" >&2; usage ;; 
    esac
done

# Hardcode DOMAIN and EMAIL for dev mode
DOMAIN="localhost"
EMAIL="dev@localhost.com"
PASSWORD="devtestpwd" # Hardcoded password for dev environment
echo "Set DOMAIN: $DOMAIN (dev mode)"
echo "Set EMAIL: $EMAIL (dev mode)"
echo "Set PASSWORD: [redacted] (dev mode)"

# --- Pre-load local images if available ---
LOCAL_IMAGES_DIR="docker-images"
IMAGE_TARBALLS=(
    "node-20-slim.tar"  # New entry for Debian-based Node.js slim
)

echo "Checking for local image tarballs in '$LOCAL_IMAGES_DIR' நான"
for tarball in "${IMAGE_TARBALLS[@]}"; do
    tarball_path="$LOCAL_IMAGES_DIR/$tarball"
    if [ -f "$tarball_path" ]; then
        echo "Found local image $tarball, loading into podman..."
        if podman load -i "$tarball_path"; then
            echo "Successfully loaded $tarball."
        else
            echo "Warning: Failed to load $tarball." >&2
        fi
    else
        echo "Local image $tarball not found, will pull from remote registry if needed."
    fi
done
# --- End of Pre-load section ---

# Docker volume setup - using a named volume for persistent storage
VOLUME_NAME="ntn-dev-data"
echo "Ensuring Docker volume '$VOLUME_NAME' exists..."
podman volume create "$VOLUME_NAME" || true # Create if it doesn't exist

# Ensure the Docker volume is cleaned up on exit (optional, for dev convenience)
# trap "echo 'Cleaning up Docker volume: $VOLUME_NAME'; podman volume rm -f $VOLUME_NAME" EXIT

# Populate the volume with test data
HOST_BACKUP_DIR="$(pwd)/backup"
ARCHIVE_PATH="$HOST_BACKUP_DIR/ntn-test-data.tar.gz"
CONTAINER_MOUNT_PATH="/data" # This is where the volume is mounted in the container



# Build arguments
echo "Configuring build arguments:"
BUILD_ARGS=(
    "--build-arg" "DOMAIN=$DOMAIN"
    "--build-arg" "EMAIL=$EMAIL"
    "--build-arg" "CACHE_BUST=$(date +%s)"
)

if [ -n "$PASSWORD" ]; then
    echo "Adding hardcoded password argument..."
    ESCAPED_PWD=$(printf '%q' "$PASSWORD")
    BUILD_ARGS+=("--build-arg" "APP_PASSWORD=$ESCAPED_PWD")
fi

# --- Check and kill processes using port 8085 ---
echo "Checking for processes using port 8085..."
if command -v lsof &> /dev/null; then
    PIDS=$(lsof -t -i :8085)
    if [ -n "$PIDS" ]; then
        echo "Found processes using port 8085: $PIDS. Attempting to kill them..."
        kill -9 $PIDS
        sleep 1 # Give the system a moment to release the port
        echo "Processes killed. Port 8085 should now be free."
    else
        echo "No processes found using port 8085."
    fi
else
    echo "lsof not found. Skipping direct port check. Relying on podman stop/rm."
fi
# --- End of port check ---

# Build arguments
[ -n "$NO_CACHE" ] && { 
    echo "Adding no-cache flag and performing system prune..."
    BUILD_ARGS+=("--no-cache")
    podman system prune -f # Added for --no-cache builds
}

# Build process
echo "Starting build process..."
(
    set -x  # Show git/podman commands

    podman stop ntn-dev || true && \
    podman rm -f ntn-dev || true && \
    sleep 2 && \
    podman build -f dockerfile-dev "${BUILD_ARGS[@]}" -t not-the-news-dev . && \
    podman run -d -p 8085:80 -p 8443:443 \
        -v "$VOLUME_NAME":/data \
        -v "$(pwd)"/reconstruct_api.py:/tmp/reconstruct_api.py \
        -v "$(pwd)"/build_entrypoint.sh:/usr/local/bin/docker-entrypoint.sh \
        -v "$(pwd)"/Caddyfile-dev:/etc/caddy/Caddyfile \
        -v "$(pwd)"/data/config/feeds.txt:/data/config/feeds.txt \
        -v "$(pwd)"/data/config/filter_keywords.txt:/data/config/filter_keywords.txt \
        -v "$(pwd)"/rss/:/rss/ \
        -v /etc/ssl/certs/vscode.tail06b521.ts.net.crt:/etc/caddy/certs/vscode.tail06b521.ts.net.crt \
        -v /etc/ssl/certs/vscode.tail06b521.ts.net.key:/etc/caddy/certs/vscode.tail06b521.ts.net.key \
        --name ntn-dev not-the-news-dev
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# podman image prune -f
# podman builder prune -f
# podman buildx rm caddy-builder --force
