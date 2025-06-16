#!/bin/bash

# Script to flash a raw image file to a target SSD.

# Prerequisite check for dd
command -v dd >/dev/null 2>&1 || { echo >&2 "Error: 'dd' command not found. Please install it and try again."; exit 1; }

# Validate arguments
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 IMAGE_PATH TARGET_DEVICE"
  echo "Example: $0 /path/to/image.img /dev/sda"
  exit 1
fi

IMAGE_PATH="$1"
TARGET_DEVICE="$2"

# Check if image file exists
if [ ! -f "${IMAGE_PATH}" ]; then
  echo "Error: Image file '${IMAGE_PATH}' not found."
  exit 1
fi

# Check if target device is a block device
if [ ! -b "${TARGET_DEVICE}" ]; then
  echo "Error: Target device '${TARGET_DEVICE}' is not a block device."
  exit 1
fi

# Display warning and get confirmation
echo ""
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "!! WARNING: THIS WILL DESTROY ALL DATA ON '${TARGET_DEVICE}'. !!"
echo "!!                                                                              !!"
echo "!! Make absolutely sure you have selected the correct target device.            !!"
echo "!! There is NO UNDO.                                                            !!"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""
read -p "Type 'YES' (all caps) to proceed, or anything else to abort: " CONFIRMATION

if [ "${CONFIRMATION}" != "YES" ]; then
  echo "Aborting."
  exit 1
fi

echo ""
echo "Proceeding with flashing '${IMAGE_PATH}' to '${TARGET_DEVICE}'..."

# Execute dd command
if sudo dd if="${IMAGE_PATH}" of="${TARGET_DEVICE}" bs=4M status=progress conv=fsync; then
  echo ""
  echo "Successfully flashed '${IMAGE_PATH}' to '${TARGET_DEVICE}'."
  # It's good practice to run sync again to ensure all caches are flushed
  sudo sync
  echo "Data synchronized to disk."
else
  echo ""
  echo "Error: Failed to flash '${IMAGE_PATH}' to '${TARGET_DEVICE}'."
  exit 1
fi

exit 0
