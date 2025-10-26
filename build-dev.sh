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
while getopts ":p:hn" opt; do
    case $opt in
        p) PASSWORD="$OPTARG"; echo "Set PASSWORD: [redacted]" ;;
        n) NO_CACHE=1; echo "Disabling cache" ;;
        h) usage ;;
        \?) echo "Invalid option -$OPTARG" >&2; usage ;;
        :) echo "Option -$OPTARG requires an argument" >&2; usage ;;
    esac
done

# Hardcode DOMAIN and EMAIL for dev mode
DOMAIN="localhost"
EMAIL="dev@localhost.com"
echo "Set DOMAIN: $DOMAIN (dev mode)"
echo "Set EMAIL: $EMAIL (dev mode)"

# Docker volume setup - using a named volume for persistent storage
VOLUME_NAME="ntn-dev-data"
echo "Ensuring Docker volume '$VOLUME_NAME' exists..."
sudo podman volume create "$VOLUME_NAME" || true # Create if it doesn't exist

# Ensure the Docker volume is cleaned up on exit (optional, for dev convenience)
# trap "echo 'Cleaning up Docker volume: $VOLUME_NAME'; sudo podman volume rm -f $VOLUME_NAME" EXIT

# Populate the volume with test data
ARCHIVE_PATH="/mnt/host_shares/data/home/tim/git/not-the-news/backup/ntn-test-data.tar.gz"
CONTAINER_MOUNT_PATH="/data" # This is where the volume is mounted in the container
HOST_BACKUP_DIR="/mnt/host_shares/data/home/tim/git/not-the-news/backup"

echo "Populating volume '$VOLUME_NAME' with data from '$ARCHIVE_PATH'..."
sudo podman run --rm \
    -v "$VOLUME_NAME:$CONTAINER_MOUNT_PATH" \
    -v "$HOST_BACKUP_DIR:/host_backup" \
    alpine:latest sh -c "\
        apk add --no-cache tar gzip && \
        cp /host_backup/ntn-test-data.tar.gz $CONTAINER_MOUNT_PATH/ && \
        tar -xzf $CONTAINER_MOUNT_PATH/ntn-test-data.tar.gz -C $CONTAINER_MOUNT_PATH && \
        rm $CONTAINER_MOUNT_PATH/ntn-test-data.tar.gz\
    "

# Build arguments
echo "Configuring build arguments:"
BUILD_ARGS=(
    "--build-arg" "DOMAIN=$DOMAIN"
    "--build-arg" "EMAIL=$EMAIL"
    "--build-arg" "CACHE_BUST=$(date +%s)"
)

if [ -n "$PASSWORD" ]; then
    echo "Adding password argument..."
    ESCAPED_PWD=$(printf '%q' "$PASSWORD")
    BUILD_ARGS+=("--build-arg" "APP_PASSWORD=$ESCAPED_PWD")
fi
# Build arguments
[ -n "$NO_CACHE" ] && {
    echo "Adding no-cache flag..."
    BUILD_ARGS+=("--no-cache")
}

# Build process
echo "Starting build process..."
(
    set -x  # Show git/podman commands
    #git pull && \
    sudo podman rm -f ntn-dev && \
    sudo podman container prune -f && \
    sudo podman build -f dockerfile-dev "${BUILD_ARGS[@]}" -t not-the-news-dev . && \
    sudo podman run -d -p 8080:80 -p 8443:443 -v "$VOLUME_NAME":/data --name ntn-dev not-the-news-dev
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# sudo podman image prune -f
# sudo podman builder prune -f
# podman buildx rm caddy-builder --force
