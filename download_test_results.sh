#!/bin/bash

echo "Downloading test results from ntn-dev container..."

HOST_TEST_RESULTS_DIR="./test-results"
HOST_PLAYWRIGHT_LOG="./playwright_test_output.log"
CONTAINER_TEST_RESULTS_DIR="/app/test-results"
CONTAINER_PLAYWRIGHT_LOG="/tmp/playwright_test_output.log"

# 1. Clean up host's test-results directory
echo "Cleaning up host's test-results directory: $HOST_TEST_RESULTS_DIR"
rm -rf "${HOST_TEST_RESULTS_DIR}/*"

# 2. Copy contents of container's test-results to host
echo "Copying test results from container: ${CONTAINER_TEST_RESULTS_DIR}/. to ${HOST_TEST_RESULTS_DIR}/"
podman cp "ntn-dev:${CONTAINER_TEST_RESULTS_DIR}/." "${HOST_TEST_RESULTS_DIR}/"

# 3. Copy playwright_test_output.log from container to host
echo "Copying Playwright log from container: ${CONTAINER_PLAYWRIGHT_LOG} to ${HOST_PLAYWRIGHT_LOG}"
podman cp "ntn-dev:${CONTAINER_PLAYWRIGHT_LOG}" "${HOST_PLAYWRIGHT_LOG}"

if [ $? -eq 0 ]; then
    echo "Test results and log downloaded successfully."
else
    echo "Error downloading test results or log."
    exit 1
fi
