#!/bin/bash

# Script to orchestrate flashing an image and then extending its last partition.

# Prerequisite check for zenity
command -v zenity >/dev/null 2>&1 || { echo >&2 "Error: 'zenity' command not found. Please install it (e.g., sudo apt install zenity) and try again."; exit 1; }

zenity --info --title="Welcome" --text="<b>Welcome to the Image Flasher and Partition Extender!</b>\n\nThis utility will guide you through:\n1. Flashing a raw disk image to a target SSD.\n2. Extending the last partition on that SSD to fill available space.\n\n<b>IMPORTANT:</b>\n- This script involves potentially destructive operations.\n- Ensure you have backups of any critical data.\n- Double-check the target device to avoid data loss." --width=500 --no-wrap 2>/dev/null

# Get image path from user using Zenity
IMAGE_PATH=$(zenity --file-selection --title="Select the RAW image file to flash" 2>/dev/null)
if [[ -z "$IMAGE_PATH" ]]; then
    zenity --error --text="No file selected. Exiting." --no-wrap 2>/dev/null
    exit 1
fi
if [[ ! -f "$IMAGE_PATH" ]]; then
    zenity --error --text="Selected file does not exist: $IMAGE_PATH. Exiting." --no-wrap 2>/dev/null
    exit 1
fi

# Target Device Selection & Safety Checks
OS_DRIVE_PART=$(df / | awk 'NR==2 {print $1}')
OS_DRIVE_RAW=$(lsblk -no pkname "$OS_DRIVE_PART" 2>/dev/null)
if [[ -z "$OS_DRIVE_RAW" ]]; then # Fallback if pkname fails
    OS_DRIVE_RAW=$(echo "$OS_DRIVE_PART" | sed 's/[0-9]*$//' | sed 's|^/dev/||') # e.g. sda from /dev/sda1
else
    OS_DRIVE_RAW=$(echo "$OS_DRIVE_RAW" | sed 's|^/dev/||') # e.g. sda from /dev/sda
fi
# If OS_DRIVE_RAW is something like "mapper/vg-lv", we need a simpler name for comparison
# This might happen with LVM. We'll try to make it more robust but it's complex.
# For now, if it contains '/', it's likely a complex mapping we won't simply match.
if echo "$OS_DRIVE_RAW" | grep -q '/'; then
    OS_DRIVE="complex_os_drive_mapping_cannot_reliably_block" # A placeholder that won't match /dev/sdX
else
    OS_DRIVE="$OS_DRIVE_RAW"
fi


IMAGE_SOURCE_DRIVE=""
IMAGE_ON_REMOVABLE=false
if [[ "$IMAGE_PATH" = /* ]]; then # Path is absolute
    IMAGE_SOURCE_PART_CHECK=$(df "$IMAGE_PATH" | awk 'NR==2 {print $1}')
    if [[ -n "$IMAGE_SOURCE_PART_CHECK" ]] && [[ "$IMAGE_SOURCE_PART_CHECK" = /dev/* ]]; then
        IMAGE_SOURCE_DRIVE_TEMP_RAW=$(lsblk -no pkname "$IMAGE_SOURCE_PART_CHECK" 2>/dev/null)
        if [[ -z "$IMAGE_SOURCE_DRIVE_TEMP_RAW" ]]; then
            IMAGE_SOURCE_DRIVE_TEMP_RAW=$(echo "$IMAGE_SOURCE_PART_CHECK" | sed 's/[0-9]*$//' | sed 's|^/dev/||')
        else
            IMAGE_SOURCE_DRIVE_TEMP_RAW=$(echo "$IMAGE_SOURCE_DRIVE_TEMP_RAW" | sed 's|^/dev/||')
        fi

        if ! echo "$IMAGE_SOURCE_DRIVE_TEMP_RAW" | grep -q '/'; then # Only proceed if not a complex mapping
            IS_REMOVABLE=$(lsblk -dno RM "/dev/${IMAGE_SOURCE_DRIVE_TEMP_RAW}" 2>/dev/null)
            # Check if removable AND not the OS drive itself (in case image is on OS drive's removable media)
            if [[ "$IS_REMOVABLE" == "1" ]] && [[ "$IMAGE_SOURCE_DRIVE_TEMP_RAW" != "$OS_DRIVE" ]]; then
                IMAGE_SOURCE_DRIVE="$IMAGE_SOURCE_DRIVE_TEMP_RAW" # Store short name like sdb
                IMAGE_ON_REMOVABLE=true
            fi
        fi
    fi
fi

mapfile -t DEVICES_INFO < <(lsblk -dplnxo NAME,SIZE,MODEL,TYPE | grep -E 'disk|mmcblk|nvme' | grep -vE 'loop|sr|ram')
ZENTY_LIST_ARGS=()
HAS_ENABLED_DEVICE=false
for INFO_LINE in "${DEVICES_INFO[@]}"; do
    DEVICE_NAME_FULL=$(echo "$INFO_LINE" | awk '{print $1}') # Full path e.g. /dev/sda
    DEVICE_NAME_SHORT=$(echo "$DEVICE_NAME_FULL" | sed 's|^/dev/||') # Short name e.g. sda
    DEVICE_SIZE=$(echo "$INFO_LINE" | awk '{print $2}')
    # Model can have spaces, so grab the rest of the line
    DEVICE_MODEL=$(echo "$INFO_LINE" | awk '{for(i=3;i<=(NF-1);i++) printf "%s ", $i; print ""}' | sed 's/ $//') # Model (NF-1 because last is TYPE)

    DISABLED_STR="FALSE"
    TOOLTIP_TEXT=""

    if [[ "$DEVICE_NAME_SHORT" == "$OS_DRIVE" ]]; then
        DISABLED_STR="TRUE"
        TOOLTIP_TEXT=" (OS Drive - Cannot select)"
    elif [[ "$IMAGE_ON_REMOVABLE" == true && "$DEVICE_NAME_SHORT" == "$IMAGE_SOURCE_DRIVE" ]]; then
        DISABLED_STR="TRUE"
        TOOLTIP_TEXT=" (Source Drive for Image - Cannot select)"
    else
        HAS_ENABLED_DEVICE=true
    fi
    ZENTY_LIST_ARGS+=("$DISABLED_STR" "$DEVICE_NAME_FULL" "${DEVICE_SIZE} - ${DEVICE_MODEL}${TOOLTIP_TEXT}")
done

if [[ "$HAS_ENABLED_DEVICE" == false ]]; then
    zenity --error --text="No suitable target devices found or all valid devices are disabled (OS drive or image source drive). Exiting." --no-wrap --width=450 2>/dev/null
    exit 1
fi
if [[ ${#ZENTY_LIST_ARGS[@]} -eq 0 ]]; then # Should be caught by HAS_ENABLED_DEVICE, but as a fallback
    zenity --error --text="No block devices found to list. Exiting." --no-wrap 2>/dev/null
    exit 1
fi

TARGET_DEVICE_FULL=$(zenity --list --radiolist \
                                 --title="Select Target SSD/Device" \
                                 --text="<b>WARNING: Data on the selected device will be ERASED.</b>\nOS drive and Source drive (if on removable media) are disabled." \
                                 --column="Select" --column="Device Path" --column="Info" \
                                 "${ZENTY_LIST_ARGS[@]}" --height 400 --width 700 2>/dev/null)

if [[ -z "$TARGET_DEVICE_FULL" ]]; then
    zenity --error --text="No target device selected. Exiting." --no-wrap 2>/dev/null
    exit 1
fi

# Graphical Confirmation
CONFIRMATION_TEXT="<b>About to flash:</b>\nImage: $IMAGE_PATH\nTo Device: $TARGET_DEVICE_FULL\n\n<span color='red'><b>ALL DATA ON $TARGET_DEVICE_FULL WILL BE PERMANENTLY ERASED.</b></span>\n\nAre you absolutely sure you want to proceed?"
if ! zenity --question --title="Final Confirmation - DATA LOSS WARNING" --text="$CONFIRMATION_TEXT" --no-wrap --width=500 --height=200 2>/dev/null; then
    zenity --info --text="Operation cancelled by user. Exiting." --no-wrap 2>/dev/null
    exit 0 # User explicitly cancelled, not an error
fi

echo ""
echo "Proceeding with operations..."
echo "Image:          ${IMAGE_PATH}"
echo "Target Device:  ${TARGET_DEVICE_FULL}"
echo "---------------------------------------------------------------------"

# Step 1: Flash the image
SCRIPT_DIR=$(dirname "$0") # Should be the current directory
FLASH_SCRIPT="./flash_image.sh" # Assuming it's in the same directory

if [ ! -f "${FLASH_SCRIPT}" ]; then
    zenity --error --text="Error: flash_image.sh script not found in $(pwd)." --no-wrap 2>/dev/null
    exit 1
fi
if [ ! -x "${FLASH_SCRIPT}" ]; then
    zenity --error --text="Error: flash_image.sh is not executable. Please run 'chmod +x ${FLASH_SCRIPT}'." --no-wrap 2>/dev/null
    exit 1
fi

echo "Stage 1: Flashing image '${IMAGE_PATH}' to '${TARGET_DEVICE_FULL}'..."
echo "You will be asked for confirmation by the flash_image.sh script again (text-based)."
"${FLASH_SCRIPT}" "${IMAGE_PATH}" "${TARGET_DEVICE_FULL}"
FLASH_EXIT_CODE=$?

if [ ${FLASH_EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "---------------------------------------------------------------------"
  ERROR_MSG_FLASH="Image flashing failed with exit code ${FLASH_EXIT_CODE}.\nPlease check the output from flash_image.sh above for details.\nAborting further operations."
  echo -e "${ERROR_MSG_FLASH}"
  zenity --error --text="${ERROR_MSG_FLASH}" --no-wrap 2>/dev/null
  echo "---------------------------------------------------------------------"
  exit 1
fi

echo ""
echo "Image flashing completed successfully."
zenity --info --text="Image flashing completed successfully." --no-wrap 2>/dev/null
echo "---------------------------------------------------------------------"

# Step 2: Extend the partition
EXTEND_SCRIPT="./extend_partition.sh" # Assuming it's in the same directory

if [ ! -f "${EXTEND_SCRIPT}" ]; then
    zenity --error --text="Error: extend_partition.sh script not found in $(pwd)." --no-wrap 2>/dev/null
    exit 1
fi
if [ ! -x "${EXTEND_SCRIPT}" ]; then
    zenity --error --text="Error: extend_partition.sh is not executable. Please run 'chmod +x ${EXTEND_SCRIPT}'." --no-wrap 2>/dev/null
    exit 1
fi

echo "Stage 2: Extending the last partition on '${TARGET_DEVICE_FULL}'..."
echo "You will be asked for confirmation by the extend_partition.sh script again (text-based)."
"${EXTEND_SCRIPT}" "${TARGET_DEVICE_FULL}"
EXTEND_EXIT_CODE=$?

if [ ${EXTEND_EXIT_CODE} -ne 0 ]; then
  echo ""
  echo "---------------------------------------------------------------------"
  ERROR_MSG_EXTEND="Partition extension failed with exit code ${EXTEND_EXIT_CODE}.\nPlease check the output from extend_partition.sh above for details.\nNote: The image was flashed, but partition extension encountered an issue."
  echo -e "${ERROR_MSG_EXTEND}"
  zenity --error --text="${ERROR_MSG_EXTEND}" --no-wrap 2>/dev/null
  echo "---------------------------------------------------------------------"
  exit 1
fi

echo ""
echo "---------------------------------------------------------------------"
SUCCESS_MSG="Operation Completed Successfully!\nImage '${IMAGE_PATH}' was flashed to '${TARGET_DEVICE_FULL}' and its last partition extended.\n\nRemember: You might still need to resize the filesystem within the extended partition (e.g., using resize2fs, xfs_growfs) to utilize the new space."
echo -e "${SUCCESS_MSG}"
zenity --info --title="Success!" --text="${SUCCESS_MSG}" --no-wrap --width=500 2>/dev/null
echo "---------------------------------------------------------------------"

exit 0
