#!/bin/bash

# build.sh - Unified Build and Deployment Script for Not The News

# Exit on error
set -e

# --- Configuration ---
PROD_DOMAIN=${VITE_PRODUCTION_DOMAIN:-"news.loveopenly.net"}
DEV_DOMAIN="dev-news.loveopenly.net"
DEV_PROJECT_ID="not-the-news-dev"
PROD_PROJECT_ID="not-the-news"

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# --- Functions ---

show_help() {
    echo "Usage: ./build.sh [FLAGS]"
    echo ""
    echo "Flags:"
    echo "  --local    Build and start local development environment (Wrangler + Vite)"
    echo "  --dev      Deploy to Development environment (Cloudflare + Firebase Hosting)"
    echo "  --prod     Deploy to Production environment (Cloudflare)"
    echo "  --all      Run Local, Dev, and Prod sequentially"
    echo "  --help     Show this help message"
}

run_local() {
    echo ">>> Starting LOCAL development environment..."
    ./run-local.sh
}

deploy_dev() {
    echo ">>> Starting DEVELOPMENT deployment to $DEV_DOMAIN..."
    
    # 1. Prepare wrangler config
    sed "s/VITE_PRODUCTION_DOMAIN_PLACEHOLDER/$DEV_DOMAIN/g" worker/wrangler.jsonc | \
    sed "s/\"FIREBASE_PROJECT_ID\": \"not-the-news\"/\"FIREBASE_PROJECT_ID\": \"$DEV_PROJECT_ID\"/" | \
    sed 's/"name": "ntn-backend"/"name": "ntn-backend-dev"/' > worker/wrangler.dev.jsonc

    # 2. Build for development
    echo "Building frontend for DEV..."
    export VITE_API_BASE_URL="https://$DEV_DOMAIN"
    export VITE_PRODUCTION_DOMAIN="$DEV_DOMAIN"
    npm run build:dev

    # 3. Deploy to Cloudflare
    echo "Deploying to Cloudflare (Worker + Pages)..."
    cd worker
    npx wrangler deploy --config wrangler.dev.jsonc --keep-vars
    rm wrangler.dev.jsonc
    cd ..

    # 4. Deploy to Firebase (Hosting only)
    # This provides the /__/firebase/init.json and auth handlers
    echo "Deploying to Firebase Hosting (Project: $DEV_PROJECT_ID)..."
    npx firebase deploy --only hosting --project "$DEV_PROJECT_ID"

    echo "DEVELOPMENT deployment complete: https://$DEV_DOMAIN"
}

deploy_prod() {
    echo ">>> Starting PRODUCTION deployment to $PROD_DOMAIN..."
    
    # Branch check
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
        echo "Error: Production deployment is only allowed from 'main' or 'master' branch."
        exit 1
    fi

    # Mandatory user confirmation to prevent automated agent deployments
    echo ""
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!!! WARNING: YOU ARE DEPLOYING TO PRODUCTION ($PROD_DOMAIN) !!!"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo ""
    printf "Type 'DEPLOY' to confirm production deployment: "
    read CONFIRMATION
    if [ "$CONFIRMATION" != "DEPLOY" ]; then
        echo "Deployment aborted."
        exit 1
    fi
    echo "Confirmation received. Proceeding..."

    # 1. Prepare wrangler config
    sed "s/VITE_PRODUCTION_DOMAIN_PLACEHOLDER/$PROD_DOMAIN/g" worker/wrangler.jsonc > worker/wrangler.deploy.jsonc

    # 2. Build for production
    echo "Building frontend for PROD..."
    export VITE_API_BASE_URL="https://$PROD_DOMAIN"
    export VITE_PRODUCTION_DOMAIN="$PROD_DOMAIN"
    npm run build

    # 3. Deploy to Cloudflare
    echo "Deploying to Cloudflare (Worker + Pages)..."
    cd worker
    npx wrangler deploy --config wrangler.deploy.jsonc --keep-vars
    rm wrangler.deploy.jsonc
    cd ..

    echo "PRODUCTION deployment complete: https://$PROD_DOMAIN"
}

# --- Main Execution ---

if [ $# -eq 0 ]; then
    show_help
    exit 1
fi

DO_LOCAL=false
DO_DEV=false
DO_PROD=false

for arg in "$@"; do
    case $arg in
        --local) DO_LOCAL=true ;;
        --dev)   DO_DEV=true   ;;
        --prod)  DO_PROD=true  ;;
        --all)   DO_LOCAL=true; DO_DEV=true; DO_PROD=true ;; 
        --help)  show_help; exit 0 ;; 
        *)       echo "Unknown flag: $arg"; show_help; exit 1 ;; 
    esac
done

if [ "$DO_LOCAL" = true ]; then run_local; fi
if [ "$DO_DEV" = true ];   then deploy_dev; fi
if [ "$DO_PROD" = true ];  then deploy_prod; fi
