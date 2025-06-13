# YOM SSD Flasher Electron App

## Overview

The YOM SSD Flasher is a GUI application built with Electron for flashing raw disk images (e.g., OS images like Ubuntu Server, custom YOM images) to SSDs, SD cards, USB drives, or other block devices. It also provides functionality to extend the primary partition on the flashed device to utilize all available space.

This application is primarily designed for Linux systems and relies on common Linux command-line utilities for its core operations.

## Prerequisites

Before using this application (whether running from source or a packaged version), please ensure the following command-line utilities are installed on your system and are accessible via your system's `PATH`:

*   **`dd`**: Used for the low-level disk write operation during image flashing.
*   **`lsblk`**: Used to list available block devices and gather information about them (e.g., size, model, OS drive detection).
*   **`parted`**: Used for partition table manipulation (specifically for extending the partition).
*   **`resize2fs`**: Used to resize ext2/3/4 filesystems after the partition has been extended. (If you are using a different filesystem, you might need to resize it manually using appropriate tools.)
*   **`udisksctl`**: Used for safe device ejection (unmounting and powering off).

The application performs a check for these commands at startup. If any are missing, it will display a warning dialog. Without these utilities, the application will not function correctly.

### Root/Sudo Privileges for Application Use

**Crucial:** This application interacts directly with block devices (e.g., `/dev/sda`, `/dev/nvme0n1`) for flashing and partitioning. These operations require **root (sudo) privileges**.

You will need to run the YOM SSD Flasher application (packaged executable or via `npm start`) with `sudo`. For example:
*   `sudo ./yom-flasher-app` (or the equivalent for your executable name).
*   `sudo npm start` (when running from source, see "Development Setup" below).

Failure to run with sufficient privileges will cause the underlying `dd`, `parted`, etc., commands to fail, likely resulting in errors related to permissions or device access.

## Development Setup and Running from Source

### Cloning the Repository
To get started with development, clone the repository to your local machine:
```bash
git clone https://github.com/your-username/yom-flasher-app.git
cd yom-flasher-app
```
*(Replace `https://github.com/your-username/yom-flasher-app.git` with the actual URL of this repository.)*

### Installing Dependencies
Navigate to the cloned directory and install the necessary Node.js dependencies:
```bash
npm install
```

### Running the Application (Development)
To run the application in a development environment (with live reload and DevTools access), use:
```bash
npm start
```

**Important for Flashing Operations:** As detailed in the "Prerequisites" section, the core functionalities of this application (flashing, partitioning, ejecting) require root/sudo privileges. Therefore, to test these features properly during development, you must run the start command with `sudo`:
```bash
sudo npm start
```
Without `sudo`, the application will run, but attempts to flash, extend partitions, or eject devices will likely fail due to permission errors.

### Building the Application
This project uses Electron Forge to build distributable packages. To create a package for your current platform (e.g., Linux), you can use:
```bash
npm run make
```
This command will generate installable files (e.g., a `.deb` package, an executable inside a `zip` or `tar.gz` archive) in the `out` directory within your project. Refer to the Electron Forge documentation for more details on configuring different build targets (e.g., for other operating systems or package formats).

After building, you will typically find the executable or installer in a subdirectory like `out/make/deb/x64/` for a Debian package or `out/make/zip/linux/x64/` for a zipped executable. Remember to run the packaged application with `sudo` for it to function correctly.

## Application Workflow (User Guide)

1.  **Launch the Application:** Start the YOM SSD Flasher with `sudo` as described in "Prerequisites" or "Running the Application (Development)".
2.  **Select Image:** Click the "Select Firmware File" (or similar) button to open a file dialog. Choose the raw disk image file (`.img`, `.iso`, `.bin`, etc.) you wish to flash. The selected path will be displayed.
3.  **Select Target Device:**
    *   The application will attempt to list available block devices. Click "Refresh List" if needed.
    *   Devices are listed with their path, model, and size.
    *   **Safety Feature:** The application attempts to identify and visually mark your current operating system drive (e.g., "(OS Drive)"). **It is strongly recommended NOT to select your OS drive.**
    *   Carefully select the target device from the list. The selected device info will be displayed.
4.  **Start Flashing:** Once both an image and a target device are selected, the "Start Flashing" button (or similar) will become available.
    *   Clicking this button will prompt you with a **critical confirmation dialog** summarizing your selections and warning about data erasure.
    *   You must explicitly confirm to proceed.
5.  **Flashing Progress:** A progress bar will show the status of the flashing operation, including speed and percentage completion. Detailed output from `dd` is also shown.
6.  **Post-Flashing Operations:**
    *   After successful flashing, the application will automatically attempt to:
        1.  **Extend Partition:** Resize the last partition (assumed to be the main data partition, typically partition 3 for YOM images) on the target device to use all available space.
        2.  **Safe Eject:** Unmount all partitions on the target device and then power it off.
    *   Progress and status for these operations will also be displayed.
7.  **Completion:** A success message will be shown upon successful completion of all steps. The UI will then reset for a new operation.

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
