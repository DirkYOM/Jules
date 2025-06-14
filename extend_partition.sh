#!/bin/bash

# Script to extend the last partition on a target SSD.

# Prerequisite check for parted
command -v parted >/dev/null 2>&1 || { echo >&2 "Error: 'parted' command not found. Please install it and try again."; exit 1; }

# Validate arguments
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 TARGET_DEVICE"
  echo "Example: $0 /dev/sda"
  exit 1
fi

TARGET_DEVICE="$1"

# Check if target device is a block device
if [ ! -b "${TARGET_DEVICE}" ]; then
  echo "Error: Target device '${TARGET_DEVICE}' is not a block device."
  exit 1
fi

echo "Attempting to extend the last partition on ${TARGET_DEVICE}..."

# Get partition information
echo "Current partition table:"
if ! sudo parted --script "${TARGET_DEVICE}" print; then
  echo "Error: Failed to print partition table for ${TARGET_DEVICE}."
  exit 1
fi

# Identify the number of the last partition
# This is a common way to get the last partition number.
# It assumes standard parted output and that the last partition is the one to resize.
LAST_PARTITION_NUMBER=$(sudo parted --script "${TARGET_DEVICE}" print | awk '/^[ ]*[0-9]+/{print $1}' | tail -n 1)

if [ -z "${LAST_PARTITION_NUMBER}" ]; then
  echo "Error: Could not determine the last partition number on ${TARGET_DEVICE}."
  exit 1
fi

echo "Identified last partition number as: ${LAST_PARTITION_NUMBER}"

# Display warning and get confirmation
echo ""
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "!! WARNING: RESIZING PARTITIONS CAN POTENTIALLY LEAD TO DATA LOSS IF DONE       !!"
echo "!! INCORRECTLY OR IF THE FILESYSTEM ISN'T PROPERLY HANDLED AFTERWARDS.          !!"
echo "!! This script will attempt to resize partition ${LAST_PARTITION_NUMBER} on ${TARGET_DEVICE} to 100%."
echo "!! Ensure the partition is unmounted if necessary for the filesystem type.      !!"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""
read -p "Type 'YES' (all caps) to proceed with resizing, or anything else to abort: " CONFIRMATION

if [ "${CONFIRMATION}" != "YES" ]; then
  echo "Aborting resize operation."
  exit 1
fi

echo ""
echo "Attempting to resize partition ${LAST_PARTITION_NUMBER} on ${TARGET_DEVICE} to fill available space..."

# Attempt to resize the last partition
# Note: resizepart might fail if the partition is mounted.
# The filesystem on the partition will likely need to be resized separately after this.
if sudo parted ---script "${TARGET_DEVICE}" resizepart "${LAST_PARTITION_NUMBER}" 100%; then
  echo "Successfully sent resize command for partition ${LAST_PARTITION_NUMBER} on ${TARGET_DEVICE}."
  echo "The partition itself has been resized."
  echo "IMPORTANT: You may need to resize the filesystem on the partition separately"
  echo "(e.g., using resize2fs for ext2/3/4, xfs_growfs for XFS, etc.)"
  echo "to use the new space."
else
  echo "Error: Failed to resize partition ${LAST_PARTITION_NUMBER} on ${TARGET_DEVICE}."
  echo "This could be due to the partition being mounted, or other issues."
  echo "Please check the output above and ensure the partition is unmounted if required."
  exit 1
fi

# Show the new partition table
echo ""
echo "New partition table for ${TARGET_DEVICE}:"
if ! sudo parted ---script "${TARGET_DEVICE}" print; then
  echo "Error: Failed to print updated partition table for ${TARGET_DEVICE}."
  # Even if printing fails, the resize might have succeeded, so don't exit with error code 1 here
  # as the primary operation (resize) reported success.
fi

exit 0
