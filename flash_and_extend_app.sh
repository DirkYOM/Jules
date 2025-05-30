#!/bin/bash

# Script to orchestrate flashing an image and then extending its last partition.

echo "---------------------------------------------------------------------"
echo "Welcome to the Image Flasher and Partition Extender!"
echo "---------------------------------------------------------------------"
echo "This script will guide you through:"
echo "1. Flashing a raw disk image to a target SSD."
echo "2. Extending the last partition on that SSD to fill available space."
echo ""
echo "IMPORTANT:"
echo "- This script involves potentially destructive operations (writing to a disk)."
echo "- Ensure you have backups of any critical data."
echo "- Double-check the target device to avoid data loss on the wrong disk."
echo "---------------------------------------------------------------------"
echo ""

# Get image path from user
read -p "Enter the full path to the raw image file (e.g., /path/to/image.img): " IMAGE_PATH

if [ -z "${IMAGE_PATH}" ]; then
  echo "Error: Image path cannot be empty."
  exit 1
fi

# Get target device from user
read -p "Enter the target SSD device (e.g., /dev/sda, /dev/nvme0n1): " TARGET_DEVICE

if [ -z "${TARGET_DEVICE}" ]; then
  echo "Error: Target device cannot be empty."
  exit 1
fi

echo ""
echo "---------------------------------------------------------------------"
echo "Please confirm the details:"
echo "  Image Path:    ${IMAGE_PATH}"
echo "  Target Device: ${TARGET_DEVICE}"
echo "---------------------------------------------------------------------"
echo ""

read -p "Are you absolutely sure you want to proceed with these settings? (yes/no): " FINAL_CONFIRMATION

if [ "${FINAL_CONFIRMATION}" != "yes" ]; then
  echo "Aborting operation as per user request."
  exit 1
fi

echo ""
echo "Proceeding with operations..."
echo "---------------------------------------------------------------------"

# Step 1: Flash the image
SCRIPT_DIR=$(dirname "$0")
FLASH_SCRIPT="${SCRIPT_DIR}/flash_image.sh"

if [ ! -f "${FLASH_SCRIPT}" ]; then
    echo "Error: flash_image.sh script not found in ${SCRIPT_DIR}."
    echo "Please ensure it is in the same directory as this script."
    exit 1
fi
if [ ! -x "${FLASH_SCRIPT}" ]; then
    echo "Error: flash_image.sh is not executable. Please run 'chmod +x ${FLASH_SCRIPT}'."
    exit 1
fi


echo "Stage 1: Flashing image '${IMAGE_PATH}' to '${TARGET_DEVICE}'..."
echo "You will be asked for confirmation by the flash_image.sh script again."
"${FLASH_SCRIPT}" "${IMAGE_PATH}" "${TARGET_DEVICE}"
FLASH_EXIT_CODE=$?

if [ ${FLASH_EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "---------------------------------------------------------------------"
  echo "Error: Image flashing failed with exit code ${FLASH_EXIT_CODE}."
  echo "Please check the output from flash_image.sh above for details."
  echo "Aborting further operations."
  echo "---------------------------------------------------------------------"
  exit 1
fi

echo ""
echo "Image flashing completed successfully."
echo "---------------------------------------------------------------------"

# Step 2: Extend the partition
EXTEND_SCRIPT="${SCRIPT_DIR}/extend_partition.sh"

if [ ! -f "${EXTEND_SCRIPT}" ]; then
    echo "Error: extend_partition.sh script not found in ${SCRIPT_DIR}."
    echo "Please ensure it is in the same directory as this script."
    exit 1
fi
if [ ! -x "${EXTEND_SCRIPT}" ]; then
    echo "Error: extend_partition.sh is not executable. Please run 'chmod +x ${EXTEND_SCRIPT}'."
    exit 1
fi

echo "Stage 2: Extending the last partition on '${TARGET_DEVICE}'..."
echo "You will be asked for confirmation by the extend_partition.sh script again."
"${EXTEND_SCRIPT}" "${TARGET_DEVICE}"
EXTEND_EXIT_CODE=$?

if [ ${EXTEND_EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "---------------------------------------------------------------------"
  echo "Error: Partition extension failed with exit code ${EXTEND_EXIT_CODE}."
  echo "Please check the output from extend_partition.sh above for details."
  echo "Note: The image was flashed, but partition extension encountered an issue."
  echo "---------------------------------------------------------------------"
  exit 1
fi

echo ""
echo "---------------------------------------------------------------------"
echo "Operation Completed Successfully!"
echo "Image '${IMAGE_PATH}' was flashed to '${TARGET_DEVICE}' and its last partition extended."
echo "Remember: You might still need to resize the filesystem within the extended partition"
echo "(e.g., using resize2fs, xfs_growfs) to utilize the new space."
echo "---------------------------------------------------------------------"

exit 0
