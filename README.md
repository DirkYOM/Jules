# Ubuntu SSD Flashing and Partition Extension Utility

## Overview

This utility provides a set of bash scripts to simplify the process of:
1.  Flashing a raw disk image (e.g., an Ubuntu Server image) to an SSD or other block device.
2.  Extending the last partition on that device to utilize all available space.

It is designed to be run on Ubuntu-like systems.

## Prerequisites

*   **Command-line Utilities:**
    *   `bash`: The scripts are written in bash.
    *   `dd`: Used for the low-level disk write operation during image flashing.
    *   `parted`: Used for partition table manipulation (viewing and resizing).
    *   These utilities are typically pre-installed on most Ubuntu and Debian-based systems. If not, they can be installed using `sudo apt-get install coreutils parted`.
*   **Root Privileges:**
    *   Accessing raw disk devices (like `/dev/sda` or `/dev/nvme0n1`) and modifying partition tables requires root privileges. Therefore, the main script **must** be run with `sudo`.

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
    Open a terminal and navigate to the directory containing the scripts. Run the main application script with `sudo`:
    ```bash
    sudo ./flash_and_extend_app.sh
    ```

3.  **Follow the prompts:**
    *   The script will first ask for the **full path to the raw image file** you want to flash (e.g., `/home/user/Downloads/ubuntu-server.img`).
    *   Next, it will ask for the **target SSD device** (e.g., `/dev/sda`, `/dev/sdb`, `/dev/nvme0n1`). **Be extremely careful when specifying this device.**
    *   The script will display your inputs and ask for a final confirmation before any operations begin.
    *   The underlying `flash_image.sh` and `extend_partition.sh` scripts will also ask for their own specific confirmations before performing critical operations. You must type `YES` (all caps) to proceed at those stages.

## WARNINGS

*   **EXTREME RISK OF DATA LOSS:** Writing an image to a device with `dd` is a destructive operation. **ALL DATA on the selected `TARGET_DEVICE` will be PERMANENTLY ERASED AND OVERWRITTEN** without further warning beyond the script's confirmations.
*   **SELECT THE CORRECT TARGET DEVICE:** Double-check, triple-check, and then check again that you have specified the correct target device. If you choose the wrong device (e.g., your system drive or a backup drive), you will lose all data on it. Use commands like `lsblk` or `sudo fdisk -l` to list available block devices and verify their names and sizes before running the script.
*   **BACKUP YOUR DATA:** Before using this utility on any device that contains important data, ensure you have a complete and verified backup.
*   **PARTITION RESIZING:** While `parted` is generally reliable, operations on partition tables always carry a slight risk. The script attempts to resize the *last* partition. Ensure this is the desired behavior. After the partition is resized, the *filesystem* on it will also need to be resized to use the new space (e.g., using `resize2fs` for ext2/3/4, `xfs_growfs` for XFS). The `extend_partition.sh` script will remind you of this.

## Disclaimer

Use this utility entirely at your own risk. The authors and contributors are not responsible for any data loss, system damage, or other issues that may arise from its use or misuse. Always understand what the scripts do before running them, especially when operations involve `sudo` and direct disk access.
