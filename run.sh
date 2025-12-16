#!/bin/bash
set -euo pipefail

# Default to production build
BUILD_TYPE="prod"
PASSWORD=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dev)
            BUILD_TYPE="dev"
            shift # Remove --dev from processing
            ;;
        --prod)
            BUILD_TYPE="prod"
            shift # Remove --prod from processing
            ;;
        -p|--password)
            PASSWORD="$2"
            shift # Remove -p
            shift # Remove password value
            ;;
        *)
            # Unknown option, pass it to the build scripts
            ;;
    esac
done

if [ "$BUILD_TYPE" == "dev" ]; then
    echo "Running in development mode..."
    if [ -n "$PASSWORD" ]; then
        bash build-dev.sh -p "$PASSWORD" "$@"
    else
        bash build-dev.sh "$@"
    fi
else
    echo "Running in production mode..."
    # Placeholder for actual production domain/email if not passed
    DOMAIN="news.loveopenly.net"
    EMAIL="admin@loveopenly.net"

    # Pass remaining arguments to build.sh.
    # We explicitly pass -d, -e, -p here to ensure they are handled by build.sh
    # which expects them.
    if [ -n "$PASSWORD" ]; then
        bash build.sh -d "$DOMAIN" -e "$EMAIL" -p "$PASSWORD" "$@"
    else
        bash build.sh -d "$DOMAIN" -e "$EMAIL" "$@"
    fi
fi