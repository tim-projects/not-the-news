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
podman volume inspect not-the-news_volume >/dev/null 2>&1 || {
    echo "Creating volume..."
    podman volume create not-the-news_volume
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
    echo "Adding no-cache flag and performing system prune..."
    BUILD_ARGS+=("--no-cache")
    podman system prune -f # Added for --no-cache builds
}

# Load environment variables from .env if it exists
if [ -f ".env" ]; then
    echo "Loading .env for build arguments..."
    # Still add them to BUILD_ARGS for the build stage
    while IFS='=' read -r key value || [ -n "$key" ]; do
        key=$(echo "$key" | tr -d '\r' | xargs)
        value=$(echo "$value" | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        if [[ $key == VITE_FIREBASE_* ]]; then
            echo "Found build arg: $key"
            BUILD_ARGS+=("--build-arg" "$key=$value")
        fi
    done < .env
fi

# Build process
echo "Starting build process..."
(
    set -x  # Show git/podman commands

    # Check if custom caddy image exists, if not, instruct user to build it
    if ! podman image inspect not-the-news-caddy &> /dev/null; then
        echo "Error: Custom Caddy image 'not-the-news-caddy' not found." >&2
        echo "Please build it first by running 'bash build-caddy.sh'." >&2
        exit 1
    fi

    podman rm -f ntn && \
    podman container prune -f && \
    podman build "${BUILD_ARGS[@]}" -t not-the-news . && \
    podman run -d -p 80:80 -p 443:443 -v not-the-news_volume:/data --name ntn not-the-news
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# podman image prune -f
# podman builder prune -f
# podman buildx rm caddy-builder --force
