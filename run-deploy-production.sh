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

# Ensure required environment variables are set
if [ -z "$VITE_PRODUCTION_DOMAIN" ]; then
    echo "Error: VITE_PRODUCTION_DOMAIN environment variable is not set."
    echo "Please set it before running this script, e.g.: export VITE_PRODUCTION_DOMAIN=news.example.com"
    exit 1
fi

# 1. Prepare configuration
echo "Configuring production domain: $VITE_PRODUCTION_DOMAIN"
# Create a temporary wrangler.jsonc with the correct domain
sed "s/VITE_PRODUCTION_DOMAIN_PLACEHOLDER/$VITE_PRODUCTION_DOMAIN/g" worker/wrangler.jsonc > worker/wrangler.deploy.jsonc

# 2. Build the frontend
echo "Building frontend production assets..."
npm run build

# 3. Deploy to Cloudflare
echo "Deploying to Cloudflare (Worker + Pages Assets)..."
cd worker
npx wrangler deploy --config wrangler.deploy.jsonc --keep-vars
rm wrangler.deploy.jsonc

echo "------------------------------------------------"
echo "Deployment complete!"
echo "Your application should be live at: https://$VITE_PRODUCTION_DOMAIN"
echo "------------------------------------------------"
