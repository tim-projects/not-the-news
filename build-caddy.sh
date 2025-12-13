#!/bin/bash
# Script to build the custom Caddy image

IMAGE_NAME="not-the-news-caddy"
DOCKERFILE="dockerfile-caddy"

# --- Pre-load local images if available ---
LOCAL_IMAGES_DIR="docker-images"
IMAGE_TARBALLS=(
    "golang-1.22-bullseye.tar" # New entry for Debian-based Caddy builder
    "caddy-2.tar"       # New entry for Debian-based Caddy final image
)

echo "Checking for local image tarballs in '$LOCAL_IMAGES_DIR'..."
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


echo "Building custom Caddy image: $IMAGE_NAME from $DOCKERFILE"

podman build -f "$DOCKERFILE" -t "$IMAGE_NAME" .

if [ $? -eq 0 ]; then
    echo "Successfully built custom Caddy image: $IMAGE_NAME"
else
    echo "Failed to build custom Caddy image: $IMAGE_NAME" >&2
    exit 1
fi