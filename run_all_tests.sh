#!/bin/bash

TESTS=(
    "tests/auth.spec.js"
    "tests/backup.spec.js"
    "tests/config.spec.js"
    "tests/console.spec.js"
    "tests/deck_refresh.spec.js"
    "tests/feature.spec.js"
    "tests/firestore_proof.spec.js"
    "tests/font_size.spec.js"    "tests/modal_keyboard.spec.js"
    "tests/reset_button.spec.js"
    "tests/restore.spec.js"
    "tests/restore_sync.spec.js"
    "tests/rss_content.spec.js"
    "tests/shuffle.spec.js"
    "tests/theme_persistence.spec.js"
    "tests/theme.spec.js"
    "tests/tts.spec.js"
    "tests/ui.spec.js"
    "tests/undo.spec.js"
    "tests/unread.spec.js"
)

echo "Starting Comprehensive Test Suite Run..."
echo "----------------------------------------"

PASSED=0
FAILED=0
FAILED_TESTS=()

for test_file in "${TESTS[@]}"; do
    echo "Running $test_file..."
    # Run all tests in the file (regex ".*")
    ./run_single_test.sh "$test_file" ".*" > /tmp/test_output 2>&1
    EXIT_CODE=$?
    
    # Check output for failure indicators (since run_single_test.sh might swallow exit codes if piped)
    if grep -q "✕" /tmp/test_output || grep -q "Error:" /tmp/test_output; then
        echo "❌ FAILED: $test_file"
        cat /tmp/test_output
        FAILED=$((FAILED + 1))
        FAILED_TESTS+=("$test_file")
    else
        echo "✅ PASSED: $test_file"
        PASSED=$((PASSED + 1))
    fi
    echo "----------------------------------------"
done

echo "Test Run Complete."
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
    echo "Failed Tests:"
    for t in "${FAILED_TESTS[@]}"; do
        echo "- $t"
    done
    exit 1
else
    exit 0
fi
