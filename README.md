# YOM SSD Flasher Electron App

## Overview

The YOM SSD Flasher is a GUI application built with Electron for flashing raw disk images (e.g., OS images like Ubuntu Server, custom YOM images) to SSDs, SD cards, USB drives, or other block devices. It also provides functionality to extend the primary partition on the flashed device to utilize all available space.

This application is primarily designed for Linux systems and relies on common Linux command-line utilities for its core operations.

## Prerequisites

Before using this application, please ensure the following command-line utilities are installed on your system and are accessible via your system's `PATH`:

*   **`dd`**: Used for the low-level disk write operation during image flashing.
*   **`lsblk`**: Used to list available block devices and gather information about them (e.g., size, model, OS drive detection).
*   **`parted`**: Used for partition table manipulation (specifically for extending the partition).
*   **`resize2fs`**: Used to resize ext2/3/4 filesystems after the partition has been extended. (If you are using a different filesystem, you might need to resize it manually using appropriate tools.)
*   **`udisksctl`**: Used for safe device ejection (unmounting and powering off).

The application performs a check for these commands at startup. If any are missing, it will display a warning dialog. Without these utilities, the application will not function correctly.

### Root/Sudo Privileges

**Crucial:** This application interacts directly with block devices (e.g., `/dev/sda`, `/dev/nvme0n1`) for flashing and partitioning. These operations require **root (sudo) privileges**.

You will need to run the YOM SSD Flasher application with `sudo`. For example:
*   If running from source in a development environment: `sudo npm start`
*   If running a packaged executable: `sudo ./yom-flasher-app` (or the equivalent for your executable name).

Failure to run with sufficient privileges will cause the underlying `dd`, `parted`, etc., commands to fail, likely resulting in errors related to permissions or device access.

## Usage

1.  **Installation (Development):**
    *   Clone the repository (if you haven't already).
    *   Install dependencies: `npm install`
2.  **Running the Application:**
    *   As mentioned in "Prerequisites", run with `sudo`:
        ```bash
        sudo npm start
        ```
    *   (If you have a packaged version, run the executable with `sudo`.)
3.  **Application Flow:**
    *   **Select Image:** Click the "Select Firmware File" (or similar) button to open a file dialog. Choose the raw disk image file (`.img`, `.iso`, `.bin`, etc.) you wish to flash. The selected path will be displayed.
    *   **Select Target Device:**
        *   The application will attempt to list available block devices. Click "Refresh List" if needed.
        *   Devices are listed with their path, model, and size.
        *   **Safety Feature:** The application attempts to identify and visually mark your current operating system drive (e.g., "(OS Drive)"). **It is strongly recommended NOT to select your OS drive.**
        *   Carefully select the target device from the list. The selected device info will be displayed.
    *   **Start Flashing:** Once both an image and a target device are selected, the "Start Flashing" button (or similar) will become available.
        *   Clicking this button will prompt you with a **critical confirmation dialog** summarizing your selections and warning about data erasure.
        *   You must explicitly confirm to proceed.
    *   **Flashing Progress:** A progress bar will show the status of the flashing operation, including speed and percentage completion. Detailed output from `dd` is also shown.
    *   **Post-Flashing Operations:**
        *   After successful flashing, the application will automatically attempt to:
            1.  **Extend Partition:** Resize the last partition (assumed to be the main data partition, typically partition 3 for YOM images) on the target device to use all available space.
            2.  **Safe Eject:** Unmount all partitions on the target device and then power it off.
        *   Progress and status for these operations will also be displayed.
    *   **Completion:** A success message will be shown upon successful completion of all steps. The UI will then reset for a new operation.

## WARNINGS - READ CAREFULLY!

*   **EXTREME RISK OF DATA LOSS:**
    *   Flashing an image to a device using `dd` is a **destructive operation**.
    *   **ALL DATA on the selected target device will be PERMANENTLY ERASED AND OVERWRITTEN.** There is typically no way to recover this data.

*   **SELECT THE CORRECT TARGET DEVICE:**
    *   This is the most critical step. **Mistakes here can lead to irreversible data loss on the wrong drive (e.g., your main OS drive, backup drives).**
    *   While the application attempts to identify your OS drive, this detection might not be foolproof in all system configurations.
    *   **YOU ARE SOLELY RESPONSIBLE for verifying the correct target device.**
    *   Before proceeding, use system tools like `lsblk -f`, `sudo fdisk -l`, `gparted`, or the "Disks" utility (on GNOME) to be absolutely certain about device names (e.g., `/dev/sda`, `/dev/sdb`, `/dev/nvme0n1`) and their contents.
    *   **Double-check, triple-check, and then check again before confirming the flash operation.**

*   **BACKUP YOUR DATA:**
    *   Before using this utility on any device, ensure you have a complete and verified backup of any important data on that device.
    *   It's also wise to ensure backups of other critical data on your system are up to date, just in case of accidental misselection.

*   **PARTITION RESIZING:**
    *   The application attempts to extend the 3rd partition. Ensure this is appropriate for your image and use case.
    *   Operations on partition tables always carry a slight risk. The `resize2fs` command is used for `ext2/3/4` filesystems. If your image uses a different filesystem on the target partition, `resize2fs` will fail, and you will need to resize the filesystem manually after the partition boundary is extended.

## Disclaimer

This utility is provided "as-is" without any warranties. Use it entirely at your own risk. The authors and contributors are not responsible for any data loss, system damage, or other issues that may arise from its use or misuse. Always understand the operations being performed before proceeding, especially when direct disk access with root privileges is involved.
