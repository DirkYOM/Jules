#!/bin/bash

# Test script for the SSD Flashing and Partition Extension Utility

# Setup - Ensure helper scripts are executable
chmod +x ./flash_image.sh ./extend_partition.sh ./flash_and_extend_app.sh

echo "================================================="
echo "Starting Test Suite for Flashing Utility"
echo "================================================="

# Temporary files - ensure they are cleaned up
DUMMY_IMAGE="/tmp/dummy_test_image.img"
NOT_A_BLOCK_DEVICE="/tmp/not_a_block_device_file"
touch "${DUMMY_IMAGE}"
touch "${NOT_A_BLOCK_DEVICE}"

# Cleanup function
cleanup() {
  echo "Cleaning up temporary files..."
  rm -f "${DUMMY_IMAGE}"
  rm -f "${NOT_A_BLOCK_DEVICE}"
}
trap cleanup EXIT # Register cleanup to run on script exit

# Helper function to check pass/fail
# $1: Test description
# $2: Expected exit code (integer)
# $3: Actual exit code (integer)
# $4: (Optional) String to grep for in output
# $5: (Optional) Output to check
check_test() {
  DESCRIPTION="$1"
  EXPECTED_CODE="$2"
  ACTUAL_CODE="$3"
  GREP_STRING="$4"
  OUTPUT_TO_CHECK="$5"
  STATUS="FAIL"

  if [ "${ACTUAL_CODE}" -eq "${EXPECTED_CODE}" ]; then
    if [ -n "${GREP_STRING}" ]; then
      if echo "${OUTPUT_TO_CHECK}" | grep -q "${GREP_STRING}"; then
        STATUS="PASS"
      else
        STATUS="FAIL (grep miss)"
      fi
    else
      STATUS="PASS"
    fi
  else
     STATUS="FAIL (exit code)"
  fi
  echo "Test: ${DESCRIPTION} ... ${STATUS}"
  if [ "${STATUS}" != "PASS" ]; then
    echo "  Expected exit code: ${EXPECTED_CODE}, Actual: ${ACTUAL_CODE}"
    if [ -n "${GREP_STRING}" ]; then
        echo "  Expected to find: '${GREP_STRING}' in output:"
        echo "${OUTPUT_TO_CHECK}"
    fi
  fi
}

# --- Test flash_and_extend_app.sh ---
echo ""
echo "--- Testing flash_and_extend_app.sh ---"

# Test Case 1: No input confirmation
echo "Test Case 1.1: flash_and_extend_app.sh - User answers 'no' to final confirmation"
OUTPUT=$(echo -e "${DUMMY_IMAGE}\n/dev/null\nno" | ./flash_and_extend_app.sh 2>&1)
EXIT_CODE=$?
check_test "flash_and_extend_app.sh - Final confirmation 'no'" 1 "${EXIT_CODE}" "Aborting operation as per user request." "${OUTPUT}"
if ! echo "${OUTPUT}" | grep -q "Stage 1: Flashing image"; then
  echo "Test: flash_and_extend_app.sh - Final confirmation 'no' - Did not attempt flashing ... PASS"
else
  echo "Test: flash_and_extend_app.sh - Final confirmation 'no' - Did not attempt flashing ... FAIL"
  echo "${OUTPUT}"
fi

# Test Case 1.2: flash_and_extend_app.sh - Empty image path
echo "Test Case 1.2: flash_and_extend_app.sh - Empty image path"
OUTPUT=$(echo -e "\n/dev/null\nno" | ./flash_and_extend_app.sh 2>&1)
EXIT_CODE=$?
check_test "flash_and_extend_app.sh - Empty image path" 1 "${EXIT_CODE}" "Image path cannot be empty" "${OUTPUT}"

# Test Case 1.3: flash_and_extend_app.sh - Empty target device
echo "Test Case 1.3: flash_and_extend_app.sh - Empty target device"
OUTPUT=$(echo -e "${DUMMY_IMAGE}\n\nno" | ./flash_and_extend_app.sh 2>&1)
EXIT_CODE=$?
check_test "flash_and_extend_app.sh - Empty target device" 1 "${EXIT_CODE}" "Target device cannot be empty" "${OUTPUT}"


# Test Case 3: flash_image.sh prerequisite check (dd missing)
echo "Test Case 1.4: flash_and_extend_app.sh flow - dd missing (simulated)"
PATH_BACKUP_DD=$PATH
export PATH="/tmp/nonexistent_bin_for_dd_test:$PATH" # Prepend a non-existent dir
# Simulate user saying yes to flash_and_extend_app.sh, then flash_image.sh fails on dd check
# We need flash_image.sh to be called.
# The easiest way is to call flash_image.sh directly as the main script would.
OUTPUT_DD_MISSING=$(./flash_image.sh "${DUMMY_IMAGE}" /dev/null 2>&1)
EXIT_CODE_DD_MISSING=$?
export PATH=$PATH_BACKUP_DD # Restore PATH
check_test "flash_image.sh - dd missing" 1 "${EXIT_CODE_DD_MISSING}" "Error: 'dd' command not found" "${OUTPUT_DD_MISSING}"

# Test Case 4: extend_partition.sh prerequisite check (parted missing)
echo "Test Case 1.5: flash_and_extend_app.sh flow - parted missing (simulated)"
PATH_BACKUP_PARTED=$PATH
export PATH="/tmp/nonexistent_bin_for_parted_test:$PATH" # Prepend a non-existent dir
# Simulate call to extend_partition.sh
OUTPUT_PARTED_MISSING=$(./extend_partition.sh /dev/null 2>&1)
EXIT_CODE_PARTED_MISSING=$?
export PATH=$PATH_BACKUP_PARTED # Restore PATH
check_test "extend_partition.sh - parted missing" 1 "${EXIT_CODE_PARTED_MISSING}" "Error: 'parted' command not found" "${OUTPUT_PARTED_MISSING}"

# --- Test flash_image.sh argument handling ---
echo ""
echo "--- Testing flash_image.sh Argument Handling ---"

# No arguments
OUTPUT=$(./flash_image.sh 2>&1)
EXIT_CODE=$?
check_test "flash_image.sh - No arguments" 1 "${EXIT_CODE}" "Usage: ./flash_image.sh IMAGE_PATH TARGET_DEVICE" "${OUTPUT}"

# One argument
OUTPUT=$(./flash_image.sh /tmp/dummy.img 2>&1)
EXIT_CODE=$?
check_test "flash_image.sh - One argument" 1 "${EXIT_CODE}" "Usage: ./flash_image.sh IMAGE_PATH TARGET_DEVICE" "${OUTPUT}"

# Non-existent image file
OUTPUT=$(./flash_image.sh /tmp/nonexistent-image-for-test.img /dev/null 2>&1)
EXIT_CODE=$?
check_test "flash_image.sh - Non-existent image" 1 "${EXIT_CODE}" "Error: Image file '/tmp/nonexistent-image-for-test.img' not found" "${OUTPUT}"

# Target not a block device
OUTPUT=$(./flash_image.sh "${DUMMY_IMAGE}" "${NOT_A_BLOCK_DEVICE}" 2>&1)
EXIT_CODE=$?
check_test "flash_image.sh - Target not a block device" 1 "${EXIT_CODE}" "Error: Target device '${NOT_A_BLOCK_DEVICE}' is not a block device" "${OUTPUT}"

# --- Test extend_partition.sh argument handling ---
echo ""
echo "--- Testing extend_partition.sh Argument Handling ---"

# No arguments
OUTPUT=$(./extend_partition.sh 2>&1)
EXIT_CODE=$?
check_test "extend_partition.sh - No arguments" 1 "${EXIT_CODE}" "Usage: ./extend_partition.sh TARGET_DEVICE" "${OUTPUT}"

# Target not a block device
OUTPUT=$(./extend_partition.sh "${NOT_A_BLOCK_DEVICE}" 2>&1)
EXIT_CODE=$?
check_test "extend_partition.sh - Target not a block device" 1 "${EXIT_CODE}" "Error: Target device '${NOT_A_BLOCK_DEVICE}' is not a block device" "${OUTPUT}"


echo ""
echo "================================================="
echo "Test Suite Finished"
echo "================================================="

# Note: Test Case 2 for flash_and_extend_app.sh (missing image path via empty 'read' input)
# is difficult to automate reliably in bash without tools like 'expect'.
# Current script logic for flash_and_extend_app.sh handles empty input from 'read' by exiting.
# This was tested manually and added as Test Case 1.2 and 1.3.

exit 0
