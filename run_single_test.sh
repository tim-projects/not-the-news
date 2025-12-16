#!/bin/bash

# Script to run a single Playwright test with minimal output.
# Usage: ./run_single_test.sh <test_file_path> <test_name_regex>
# Example: ./run_single_test.sh tests/ui.spec.js "should load the main page"

TEST_FILE=$1
TEST_NAME_REGEX=$2

if [ -z "$TEST_FILE" ] || [ -z "$TEST_NAME_REGEX" ]; then
  echo "Usage: $0 <test_file_path> <test_name_regex>"
  echo "Example: $0 tests/ui.spec.js \"should load the main page\""
  exit 1
fi

echo "Running single Playwright test: $TEST_NAME_REGEX in $TEST_FILE"

# Run Playwright test with a concise reporter and filter output
# --reporter=line provides a single line per test result
# grep -E '^\s*(✓|✕)' filters for lines starting with checkmark or cross (test pass/fail)
# sed 's/^\s*//' removes leading whitespace
npx playwright test "$TEST_FILE" --grep "$TEST_NAME_REGEX" --reporter=line 2>&1 \
  | grep -E '^\s*(✓|✕|Error:)' \
  | sed 's/^\s*//'
