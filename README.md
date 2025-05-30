# Ubuntu SSD Flashing and Partition Extension Utility

## Overview

This utility provides a set of bash scripts to simplify the process of:
1.  Flashing a raw disk image (e.g., an Ubuntu Server image) to an SSD or other block device.
2.  Extending the last partition on that device to utilize all available space.

It is designed to be run on Ubuntu-like systems.

## Prerequisites

*   **Command-line Utilities & GUI:**
    *   `bash`: The scripts are written in bash.
    *   `dd`: Used for the low-level disk write operation during image flashing.
    *   `parted`: Used for partition table manipulation (viewing and resizing).
    *   `zenity`: Used to provide a graphical user interface for file and device selection, and for confirmations.
    *   These utilities (`dd`, `parted`) are typically pre-installed on most Ubuntu and Debian-based systems. `zenity` might also be pre-installed on desktop editions.
    *   If any are missing, they can be installed, for example on Ubuntu/Debian:
        ```bash
        sudo apt update && sudo apt install coreutils parted zenity
        ```
*   **Root Privileges:**
    *   Accessing raw disk devices (like `/dev/sda` or `/dev/nvme0n1`), modifying partition tables, and often running `dd` effectively requires root privileges. Therefore, the main script **must** be run with `sudo`.

## Scripts

The utility consists of the following scripts:

*   `flash_and_extend_app.sh`:
    *   This is the main interactive application script that orchestrates the entire process.
    *   It prompts the user for necessary information (image path, target device) and calls the other scripts.
*   `flash_image.sh`:
    *   This script is responsible for flashing the raw image file to the specified target device using `dd`.
    *   It includes multiple safety checks and requires explicit user confirmation before writing to the disk.
    *   It is typically called by `flash_and_extend_app.sh`.
*   `extend_partition.sh`:
    *   This script handles the extension of the last partition on the target device to fill the remaining space.
    *   It uses `parted` to modify the partition table.
    *   It also includes safety checks and user confirmation.
    *   It is typically called by `flash_and_extend_app.sh` after a successful image flash.

## Usage

1.  **Ensure all scripts are executable:**
    If you've cloned the repository or downloaded the scripts, make sure they are executable:
    ```bash
    chmod +x flash_and_extend_app.sh flash_image.sh extend_partition.sh
    ```
    (The tool already does this for each script upon creation).

2.  **Run the main application script:**
    Open a terminal and navigate to the directory containing the scripts. Run the main application script with `sudo` from a graphical environment (as it uses `zenity`):
    ```bash
    sudo ./flash_and_extend_app.sh
    ```

3.  **Follow the GUI prompts:**
    *   A welcome message will be displayed.
    *   **Image File Selection:** A file dialog will appear, allowing you to browse and select the raw image file (e.g., `/home/user/Downloads/ubuntu-server.img`).
    *   **Target Device Selection:** A dialog will list available block devices.
        *   It will display the device path (e.g., `/dev/sda`), size, and model.
        *   **Safety Feature:** The script attempts to identify and disable selection of your current operating system drive and the drive from which the image is being read (if it's a distinct removable device).
        *   **Be extremely careful when selecting the target device from this list.**
    *   **Final Confirmation:** A graphical confirmation dialog will summarize the selected image and target device, and will prominently warn you about data erasure. You must explicitly agree to proceed.
    *   The underlying scripts (`flash_image.sh` and `extend_partition.sh`) still have their own final text-based "Type YES to proceed" confirmations in the terminal as an additional safety layer for the critical `dd` and `parted` commands.

## WARNINGS

*   **EXTREME RISK OF DATA LOSS:** Writing an image to a device with `dd` is a destructive operation. **ALL DATA on the selected target device will be PERMANENTLY ERASED AND OVERWRITTEN.**
*   **SELECT THE CORRECT TARGET DEVICE:**
    *   While the GUI attempts to prevent you from selecting your OS drive or the image's source drive (if on removable media), these checks might not be foolproof in all system configurations.
    *   **You are ultimately responsible for verifying the correct target device.** Double-check, triple-check, and then check again.
    *   Use system tools like `lsblk -f`, `gparted`, or `Disks` (on GNOME) to be absolutely certain about device names and their contents before proceeding.
    *   Choosing the wrong device can lead to complete data loss on that device.
*   **BACKUP YOUR DATA:** Before using this utility on any device, ensure you have a complete and verified backup of any important data on it and on other connected devices.
*   **PARTITION RESIZING:** While `parted` is generally reliable, operations on partition tables always carry a slight risk. The script attempts to resize the *last* partition. Ensure this is the desired behavior. After the partition is resized, the *filesystem* on it will also need to be resized to use the new space (e.g., using `resize2fs` for ext2/3/4, `xfs_growfs` for XFS). The `extend_partition.sh` script will remind you of this.

## Disclaimer

Use this utility entirely at your own risk. The authors and contributors are not responsible for any data loss, system damage, or other issues that may arise from its use or misuse. Always understand what the scripts do before running them, especially when operations involve `sudo` and direct disk access.
