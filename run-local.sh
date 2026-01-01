#!/bin/bash

# Kill background processes on exit
trap "kill 0" EXIT

echo "Starting Local Development Environment (No Root)..."

# 1. Start the local Worker (Backend)
echo "Launching Cloudflare Worker on port 8787..."
cd worker && npx wrangler dev &
cd ..

# 2. Start Vite (Frontend)
echo "Launching Vite Frontend..."
npx vite --mode development
