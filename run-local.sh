#!/bin/bash

# Get the absolute path of the directory where this script is located
REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SYSTEMD_DIR="$REPO_DIR/systemd"

echo "Configuring Systemd User Services with absolute path: $REPO_DIR"

# 1. Generate final service files from templates
for template in "$SYSTEMD_DIR"/*.template; do
    service_file="${template%.template}"
    sed "s|{{REPO_DIR}}|$REPO_DIR|g" "$template" > "$service_file"
done

BACKEND_UNIT="$SYSTEMD_DIR/ntn-backend.service"
FRONTEND_UNIT="$SYSTEMD_DIR/ntn-frontend.service"

# 2. Link services from repo to systemd
systemctl --user link "$BACKEND_UNIT" "$FRONTEND_UNIT"

# 3. Reload daemon to recognize changes
systemctl --user daemon-reload

echo "Starting Services..."

# 4. Start services
systemctl --user restart ntn-backend
systemctl --user restart ntn-frontend

echo "------------------------------------------------"
echo "Services started!"
echo "Backend: http://localhost:8787"
echo "Frontend: http://localhost:8443"
echo ""
echo "To view logs:"
echo "  journalctl --user -u ntn-frontend -f"
echo "  journalctl --user -u ntn-backend -f"
echo ""
echo "To stop:"
echo "  systemctl --user stop ntn-frontend ntn-backend"
echo "------------------------------------------------"

# Show status of services
systemctl --user status ntn-frontend ntn-backend --no-pager

