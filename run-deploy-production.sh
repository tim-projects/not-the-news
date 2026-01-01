#!/bin/bash

# Exit on error
set -e

# Ensure we are on main or master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
    echo "Error: Deployment is only allowed from 'main' or 'master' branch."
    echo "Current branch is: $CURRENT_BRANCH"
    exit 1
fi

echo "Starting production deployment for Not The News..."

# 1. Build the frontend
echo "Building frontend production assets..."
npm run build

# 2. Deploy to Cloudflare
echo "Deploying to Cloudflare (Worker + Pages Assets)..."
cd worker
npm run deploy

echo "------------------------------------------------"
echo "Deployment complete!"
echo "Your application should be live at: https://news.loveopenly.net"
echo "------------------------------------------------"
