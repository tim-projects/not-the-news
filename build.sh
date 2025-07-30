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

---

## Build Process

Here's the core change. This section now first performs the `npm` steps to get your `www/` folder ready, then proceeds with the Docker build.

```bash
echo "Starting build process..."
(
    set -x  # Show git/docker commands

    # --- npm frontend build steps ---
    echo "Cleaning up previous npm build artifacts..."
    rm -rf node_modules package-lock.json www
    
    echo "Installing npm dependencies..."
    npm install || { echo "npm install failed!" >&2; exit 1; }

    echo "Building frontend assets with Parcel..."
    npm run build || { echo "npm run build failed!" >&2; exit 1; }

    echo "Frontend build complete in www/ directory."
    # --- End npm frontend build steps ---

    #git pull && \ # Uncomment if you want to pull latest code before building
    sudo docker rm -f ntn && \
    sudo docker container prune -f && \
    sudo docker buildx build "${BUILD_ARGS[@]}" -t not-the-news . && \
    sudo docker run -d -p 80:80 -p 443:443 -v not-the-news_volume:/data --name ntn not-the-news
) || {
    echo "Build failed!" >&2
    exit 1
}

# Optional Cleanup
# sudo docker image prune -f
# sudo docker builder prune -f
# docker buildx rm caddy-builder --force