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
echo "Set EMAIL: $EMAIL (dev mode)


# Docker volume setup
echo "Checking Docker volume..."
sudo docker volume inspect not-the-news_volume >/dev/null 2>&1 || {
    echo "Creating volume..."
    sudo docker volume create not-the-news_volume
}

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
    set -x  # Show git/docker commands
    #git pull && \
    sudo docker rm -f ntn && \
    sudo docker container prune -f && \
    sudo docker buildx build -f dockerfile-dev "${BUILD_ARGS[@]}" -t not-the-news-dev . && \
    sudo docker run -d -p 80:80 -p 443:443 -v not-the-news_volume:/data --name ntn-dev not-the-news-dev
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# sudo docker image prune -f
# sudo docker builder prune -f
# docker buildx rm caddy-builder --force
