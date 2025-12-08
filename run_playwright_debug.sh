#!/bin/bash
export APP_URL=http://localhost:8080

podman exec -e APP_URL ntn-dev bash -c "npx playwright test tests/ui.spec.js > /tmp/playwright_test_output.log 2>&1"

# Download test results after the playwright tests have finished
bash download_test_results.sh