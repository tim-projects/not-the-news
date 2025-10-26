#!/bin/bash
# Help function
usage() {
    echo "Usage: $0 -d DOMAIN -e EMAIL [-p PASSWORD] [-n]"
    echo
    echo "Options:"
    echo "  -d DOMAIN    Domain name for the service"
    echo "  -e EMAIL     Email for Let's Encrypt certificates"
    echo "  -p PASSWORD  [Optional] Site protection password"
    echo "  -n           Disable Docker build cache"
    echo "  -h           Show this help message"
    exit 1
}

# Parse arguments with debug
echo "Parsing arguments..."
while getopts ":d:e:p:hn" opt; do
    case $opt in
        d) DOMAIN="$OPTARG"; echo "Set DOMAIN: $DOMAIN" ;;
        e) EMAIL="$OPTARG"; echo "Set EMAIL: $EMAIL" ;;
        p) PASSWORD="$OPTARG"; echo "Set PASSWORD: [redacted]" ;;
        n) NO_CACHE=1; echo "Disabling cache" ;;
        h) usage ;;
        \?) echo "Invalid option -$OPTARG" >&2; usage ;;
        :) echo "Option -$OPTARG requires an argument" >&2; usage ;;
    esac
done

# Validate required args
echo "Validating arguments..."
[[ -z "$DOMAIN" || -z "$EMAIL" ]] && {
    echo "Error: Missing required arguments!" >&2
    usage
}

# Docker volume setup
echo "Checking Docker volume..."
sudo podman volume inspect not-the-news_volume >/dev/null 2>&1 || {
    echo "Creating volume..."
    sudo podman volume create not-the-news_volume
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
    set -x  # Show git/podman commands
    #git pull && \
    sudo podman rm -f ntn && \
    sudo podman container prune -f && \
    sudo podman build "${BUILD_ARGS[@]}" -t not-the-news . && \
    sudo podman run -d -p 80:80 -p 443:443 -v not-the-news_volume:/data --name ntn not-the-news
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# sudo podman image prune -f
# sudo podman builder prune -f
# podman buildx rm caddy-builder --force
