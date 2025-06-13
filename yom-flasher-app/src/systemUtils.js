const { execFile, spawn } = require('child_process'); // Added spawn here
const util = require('util');
const fs = require('fs').promises; // Import fs promises
const execFileAsync = util.promisify(execFile);

/**
 * Lists available block devices with relevant information.
 * Uses lsblk with JSON output.
 * Filters for disks, mmcblk, nvme types.
 * Identifies the OS drive's base device path.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of device objects.
 * Each object will have keys like: path, name, size, model, isRemovable, isOS, filesystemType.
 */
async function listBlockDevices() {
    const command = 'lsblk';
    // -J for JSON output
    // -b for size in bytes
    // -o to specify columns
    // PATH: full device path, NAME: short name, SIZE: size in bytes, MODEL: device model
    // FSTYPE: filesystem type, MOUNTPOINT: where it's mounted
    // PKNAME: parent kernel name (to find parent disk of a partition)
    // TYPE: device type (disk, part, loop, etc.)
    // RM: removable flag (boolean true/false in JSON)
    const args = ['-Jb', '-o', 'PATH,NAME,SIZE,MODEL,FSTYPE,MOUNTPOINT,PKNAME,TYPE,RM'];

    try {
        const { stdout } = await execFileAsync(command, args);
        const lsblkData = JSON.parse(stdout);
        let osDevicePath = null; // Stores the path of the disk hosting the OS, e.g., /dev/sda

        // Helper function to recursively find the device path for the root mountpoint '/'
        function findPathForRootMountpoint(devices) {
            for (const device of devices) {
                if (device.mountpoint === '/') {
                    return device.path; // Path of the partition, e.g., /dev/sda1
                }
                if (device.children) {
                    const rootChildPath = findPathForRootMountpoint(device.children);
                    if (rootChildPath) return rootChildPath;
                }
            }
            return null;
        }

        const rootPartitionPath = findPathForRootMountpoint(lsblkData.blockdevices || []);

        if (rootPartitionPath) {
            // If root is on a partition (e.g., /dev/sda1), find its parent disk (e.g., /dev/sda).
            // If root is directly on a disk (e.g. /dev/sdb, less common), that's our osDevicePath.
            for (const device of lsblkData.blockdevices || []) {
                // Case 1: The root partition path is itself a disk-level device (e.g. /dev/sdb mounted as /)
                if (device.path === rootPartitionPath && ['disk', 'mmcblk', 'nvme'].includes(device.type)) {
                    osDevicePath = device.path;
                    break;
                }
                // Case 2: The root partition is a child of this device
                if (device.children) {
                    if (device.children.some(child => child.path === rootPartitionPath)) {
                        osDevicePath = device.path; // This is the parent disk's path
                        break;
                    }
                }
            }
        }

        const devices = (lsblkData.blockdevices || [])
            .filter(device => ['disk', 'mmcblk', 'nvme'].includes(device.type)) // Only include actual disk-like devices
            .map(device => ({
                path: device.path,
                name: device.name,
                size: device.size, // Size in bytes
                model: device.model || 'Unknown Model',
                isRemovable: device.rm === true, // lsblk JSON uses boolean for 'rm'
                isOS: device.path === osDevicePath,
                filesystemType: device.fstype || null,
                // Add raw details for debugging or future use if needed
                // _rawLsblkInfo: device
            }));

        return devices;

    } catch (error) {
        console.error(`Error listing block devices: ${error.message}`);
        console.error(`Stderr: ${error.stderr}`); // Include stderr for more details
        // For the Electron app, we'll want to send this error to the renderer process
        // so it can be displayed to the user.
        throw new Error(`Failed to list available storage devices (lsblk). Ensure 'lsblk' is installed and you have permissions. Details: ${error.stderr || error.message}`);
    }
}

// Export the function for use in main Electron process
// const { spawn } = require('child_process'); // spawn was already imported/moved to top

/**
 * Flashes a raw image file to a target device using dd.
 * This function spawns a 'dd' process to write the image.
 * It requires 'sudo' privileges for 'dd' to access block devices directly.
 * The 'bs=4M' argument sets a block size of 4MB for potentially faster transfers.
 * 'status=progress' enables progress reporting from GNU dd (stderr).
 * 'conv=fsync' ensures data is physically written to disk before 'dd' exits.
 * @param {string} imagePath Absolute path to the raw image file.
 * @param {string} targetDevicePath Absolute path to the target device (e.g., /dev/sda).
 * @param {number} totalSizeInBytes Total size of the image in bytes for progress calculation.
 * @param {function} onProgress Callback function to report progress.
 *                   It will be called with an object like: { progress: Number, speed: String, rawLine: String }
 *                   Progress is a percentage (0-100).
 * @returns {Promise<void>} A promise that resolves when flashing is complete, or rejects on error.
 */
function flashImage(imagePath, targetDevicePath, totalSizeInBytes, onProgress) {
    return new Promise((resolve, reject) => {
        let lastProgress = 0; // Initialize lastProgress
        const command = 'dd';
        const args = [
            `if=${imagePath}`,
            `of=${targetDevicePath}`,
            'bs=4M',        // Block size
            'status=progress', // Request progress output from dd
            'conv=fsync'    // Ensure data is physically written before dd exits
        ];

        // Note: 'dd' might require sudo/root privileges to write to block devices.
        // Electron app might need to be launched with sudo, or a helper with pkexec/sudo-prompt used.
        // For now, assuming permissions are handled externally or app is run as root.

        console.log(`Executing dd: ${command} ${args.join(' ')}`); // For logging

        const ddProcess = spawn(command, args);

        // const progressRegex = /(\d+)\s*bytes.*copied,\s*([0-9.]+)\s*s,\s*([0-9.]+\s*\wB\/s)/;
        // Example dd output on stderr:
        // 123456789 bytes (123 MB, 118 MiB) copied, 10.123 s, 12.2 MB/s

        ddProcess.stderr.on('data', (data) => {
            const output = data.toString();
            // console.debug(`dd stderr: ${output}`); // Log raw stderr for debugging

            const lines = output.trim().split('\r'); // dd status=progress often uses \r
            const lastLine = lines[lines.length - 1];

            let currentProgressPercentage = lastProgress;
            const bytesMatch = lastLine.match(/(\d+)\s*bytes/);

            if (bytesMatch && totalSizeInBytes > 0) {
                const bytesCopied = parseInt(bytesMatch[1], 10);
                currentProgressPercentage = Math.min(Math.round((bytesCopied / totalSizeInBytes) * 100), 100);

                if (currentProgressPercentage > lastProgress || (lastProgress === 0 && currentProgressPercentage === 0) ) {
                     lastProgress = currentProgressPercentage;
                } else {
                     currentProgressPercentage = lastProgress; // don't go backwards
                }
                if (bytesCopied >= totalSizeInBytes) { // Ensure 100% if bytes copied meet/exceed total
                    currentProgressPercentage = 100;
                    lastProgress = 100;
                }
            } else if (lastLine.toLowerCase().includes('copied') && lastProgress < 99 && !bytesMatch) {
                // Fallback for very brief dd outputs that might not have full stats before finishing
                // or if initial parsing fails but we see "copied"
                lastProgress = Math.min(lastProgress + 1, 99); // very rough increment, avoid hitting 100 prematurely
                currentProgressPercentage = lastProgress;
            }

            const speedMatch = lastLine.match(/([0-9.]+\s*\wB\/s)/);
            let speed = 'N/A';
            if (speedMatch && speedMatch[1]) {
                speed = speedMatch[1];
            }

            if (onProgress && typeof onProgress === 'function') {
                onProgress({
                    progress: currentProgressPercentage,
                    speed: speed,
                    rawLine: lastLine
                });
            }
        });

        ddProcess.on('error', (err) => {
            console.error(`Failed to start dd process: ${err.message}`);
            reject(new Error(`Failed to start flashing process (dd). Ensure 'dd' is installed and you have necessary permissions. Details: ${err.message}`));
        });

        ddProcess.on('close', (code) => {
            if (code === 0) {
                if (onProgress && typeof onProgress === 'function') {
                    onProgress({ progress: 100, speed: 'Done', rawLine: 'Completed successfully.' });
                }
                console.log('dd process completed successfully.');
                resolve();
            } else {
                console.error(`dd process exited with code ${code}`);
                reject(new Error(`Flashing process (dd) failed with exit code ${code}. This may be due to insufficient permissions, incorrect device path, an issue with the image file, or the device being disconnected prematurely. Check logs for more details.`));
            }
        });
    });
}


// Append to existing exports
module.exports = {
    listBlockDevices, // Keep existing
    flashImage,       // Keep existing
    extendPartition,  // Keep existing
    safeEject,        // Add new
    getImageSize,     // Add getImageSize
    checkAllRequiredCommands, // Add checkAllRequiredCommands
};

/**
 * Retrieves the size of an image file.
 * @param {string} imagePath - The path to the image file.
 * @returns {Promise<number>} A promise that resolves with the file size in bytes.
 * @throws {Error} If the file size cannot be determined (e.g., file not found, permissions).
 */
async function getImageSize(imagePath) {
    try {
        const stats = await fs.stat(imagePath);
        return stats.size; // size in bytes
    } catch (error) {
        console.error(`Error getting file size for ${imagePath}:`, error);
        throw new Error(`Could not get image file size for '${imagePath}'. Please ensure the file exists and is accessible. Details: ${error.message}`);
    }
}

/**
 * Checks if a given command-line utility exists and is executable.
 * Uses 'command -v' which is a POSIX standard way to find a command.
 * @param {string} command - The name of the command to check (e.g., "dd", "lsblk").
 * @returns {Promise<boolean>} True if the command exists, false otherwise.
 */
async function checkCommandExists(command) {
    try {
        // Using 'command -v' for better POSIX compatibility over 'which'
        await execFileAsync('command', ['-v', command]);
        return true;
    } catch (error) {
        console.warn(`Command check failed for '${command}': ${error.message}`);
        return false;
    }
}

/**
 * Checks for the existence of a list of required command-line utilities.
 * @param {Array<string>} commands - An array of command names to check.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of missing command names.
 * If all commands exist, the array will be empty.
 */
async function checkAllRequiredCommands(commands) {
    const missingCommands = [];
    for (const cmd of commands) {
        if (!await checkCommandExists(cmd)) {
            missingCommands.push(cmd);
        }
    }
    return missingCommands;
}

/**
 * Extends a specified partition on a target device to fill 100% of the available space.
 * This involves several steps:
 * 1. Attempt to unmount the partition (best-effort, as parted might require this).
 * 2. Use 'parted ---script <device> resizepart <partition_number> 100%' to extend the partition boundary.
 * 3. Use 'resize2fs <partition_device_path>' to resize the ext2/3/4 filesystem within the partition.
 * Note: This function assumes the filesystem is ext2/3/4. Other filesystem types would require different resize tools.
 * @param {string} targetDevicePath - Absolute path to the target disk device (e.g., /dev/sda).
 * @param {number} [partitionNumber=3] - The number of the partition to extend. Defaults to 3.
 * @returns {Promise<void>} A promise that resolves when extension is complete.
 * @throws {Error} If any step of the process fails, including inconsistent paths, parted errors, or resize2fs errors.
 *                 The error message will attempt to provide context and details from stderr where possible.
 */
async function extendPartition(targetDevicePath, partitionNumber = 3) {
    // parted requires the partition not to be mounted for resizing the partition itself.
    // However, after the partition is resized, the filesystem within it needs to be resized too,
    // which usually requires the partition to be mounted (e.g., resize2fs for ext4).
    // This function only handles the partition resizing with parted.
    // Filesystem resize is a separate step, potentially needing a different utility.
    // For now, we focus on what 'parted' does.

    // First, try to unmount the partition if it's mounted. This is often a prerequisite.
    // This is a best-effort; if it fails, parted might still work or might fail with a clearer message.
    // We need to identify the partition path, e.g. /dev/sda3 from /dev/sda and partitionNumber 3
    let partitionDevicePath = targetDevicePath;
    if (!targetDevicePath.match(/[0-9]$/)) { // if targetDevicePath is /dev/sda, append partitionNumber
        partitionDevicePath = targetDevicePath + partitionNumber;
    } else if (targetDevicePath.endsWith(String(partitionNumber))) { // if targetDevicePath is /dev/sda3 already
        // no change needed
    } else {
        // This case is ambiguous, e.g. targetDevicePath /dev/sda1, partitionNumber 3. Error.
        return Promise.reject(new Error(`Target device path ${targetDevicePath} and partition number ${partitionNumber} are inconsistent.`));
    }

    try {
        console.log(`Attempting to unmount partition ${partitionDevicePath} if mounted...`);
        // Use udisksctl for unmounting as it's generally safer and handles multiple users.
        await execFileAsync('udisksctl', ['unmount', '-b', partitionDevicePath]);
        console.log(`Successfully unmounted ${partitionDevicePath} or it was already unmounted.`);
    } catch (error) {
        // Log error but proceed, as parted might still work or provide a more specific error.
        // Common error if not mounted: "Error unmounting /dev/sdXN: GDBus.Error:org.freedesktop.UDisks2.Error.NotMounted: Device is not mounted"
        console.warn(`Could not unmount ${partitionDevicePath} (may be normal if not mounted): ${error.message}`);
    }

    const command = 'parted';
    // ---script: non-interactive
    // <device> resizepart <partition_number> <end_position_100%>
    const args = [
        '---script',
        targetDevicePath,
        'resizepart',
        String(partitionNumber),
        '100%' // Extend to fill the disk
    ];

    console.log(`Executing parted: ${command} ${args.join(' ')}`);

    try {
        // Important: parted might print to stdout on success, or stderr for warnings/errors.
        const { stdout, stderr } = await execFileAsync(command, args);
        if (stdout) console.log(`parted stdout: ${stdout}`);
        if (stderr) console.warn(`parted stderr: ${stderr}`); // stderr might contain warnings even on success

        // After parted resizes the partition, the filesystem needs to be told about the new size.
        // For ext2/3/4, this is typically 'resize2fs /dev/sdXN'.
        // This is a CRITICAL next step not handled by this function directly.
        console.log(`Partition ${partitionNumber} on ${targetDevicePath} resized by parted. Filesystem may need separate resize (e.g., resize2fs).`);

        // Attempt resize2fs
        console.log(`Attempting to resize filesystem on ${partitionDevicePath} using resize2fs...`);
        try {
            // Ensure it's mounted first for resize2fs to work on some systems, or unmounted on others.
            // resize2fs behavior with mounted filesystems can vary. Often it needs to be unmounted or mounted read-only.
            // For simplicity, we'll try it. If it needs unmounting, the previous unmount might have helped.
            // If it needs mounting, that's more complex here.
            // Let's assume for now it works on an unmounted partition or can handle a mounted one if needed.
            const { stdout: resizefs_stdout, stderr: resizefs_stderr } = await execFileAsync('resize2fs', [partitionDevicePath]);
            if (resizefs_stdout) console.log(`resize2fs stdout: ${resizefs_stdout}`);
            if (resizefs_stderr) console.warn(`resize2fs stderr: ${resizefs_stderr}`);
            console.log(`Filesystem on ${partitionDevicePath} successfully resized.`);
        } catch (resizefsError) {
            console.error(`Error during resize2fs for ${partitionDevicePath}: ${resizefsError.message}`);
            console.error(`resize2fs stderr: ${resizefsError.stderr}`);
            // This is a common point of failure if the filesystem type is wrong or other conditions aren't met.
            // We'll throw an error here as extending the partition without resizing the FS is often not useful.
            throw new Error(`Partition was resized, but the filesystem could not be extended automatically. resize2fs failed for ${partitionDevicePath} with message: ${resizefsError.message}. You may need to run resize2fs manually (e.g., sudo resize2fs ${partitionDevicePath}). Stderr: ${resizefsError.stderr || 'N/A'}`);
        }

        return Promise.resolve();
    } catch (error) {
        console.error(`Error during parted operation for ${targetDevicePath}: ${error.message}`);
        console.error(`parted stderr: ${error.stderr}`);
        return Promise.reject(new Error(`parted operation failed for ${targetDevicePath}: ${error.message}. Stderr: ${error.stderr}`));
    }
}

/**
 * Safely ejects a target disk by attempting to unmount all its partitions
 * and then powering off the disk using udisksctl.
 * This function is designed for Linux environments where udisksctl is available.
 * @param {string} targetDevicePath - Absolute path to the target disk device (e.g., /dev/sda).
 * @returns {Promise<void>} A promise that resolves when ejection is complete.
 * @throws {Error} If listing partitions, unmounting, or powering off fails.
 *                 The error will include details from stderr if available.
 */
async function safeEject(targetDevicePath) {
    console.log(`Starting safe eject for ${targetDevicePath}`);

    try {
        // Step 1: List all partitions for the given disk.
        // We can reuse parts of listBlockDevices or call lsblk directly for simplicity here
        // to get children of targetDevicePath.
        const { stdout } = await execFileAsync('lsblk', ['-Jb', '-o', 'PATH,TYPE', targetDevicePath]);
        const lsblkData = JSON.parse(stdout);

        let partitionsToUnmount = [];
        if (lsblkData.blockdevices && lsblkData.blockdevices[0] && lsblkData.blockdevices[0].children) {
            partitionsToUnmount = lsblkData.blockdevices[0].children
                .filter(child => child.type === 'part' && child.path)
                .map(child => child.path);
        } else if (lsblkData.blockdevices && lsblkData.blockdevices[0] && lsblkData.blockdevices[0].type === 'part') {
            // This case handles if targetDevicePath itself is a partition path (though it should be a disk)
            // However, udisksctl power-off needs the main disk device.
            // For unmounting, the partition path is fine.
            // For now, assume targetDevicePath is the main disk.
            console.warn(`safeEject was called with ${targetDevicePath}, which might be a partition. Proceeding with unmount if it is, but power-off might need parent.`);
        }


        if (partitionsToUnmount.length === 0) {
            // If no children partitions, perhaps it's a disk without partitions, or already unmounted/inaccessible.
            // Or it could be that targetDevicePath is a partition itself.
            // Let's try to unmount targetDevicePath directly if it appears to be a partition
            // (e.g. /dev/sda1). This is a fallback.
            const lsblkInfoSelf = await execFileAsync('lsblk', ['-Jb', '-o', 'PATH,TYPE,MOUNTPOINT', targetDevicePath]);
            const selfInfo = JSON.parse(lsblkInfoSelf.stdout).blockdevices[0];
            if (selfInfo && selfInfo.type === 'part' && selfInfo.mountpoint) { // Check if it's a mounted partition
                 partitionsToUnmount.push(targetDevicePath);
            } else if (!selfInfo) {
                 console.warn(`Could not get info for ${targetDevicePath} to determine if it's a partition to unmount.`);
            }
        }

        // Step 2: Unmount each partition.
        for (const partPath of partitionsToUnmount) {
            try {
                console.log(`Attempting to unmount ${partPath}...`);
                await execFileAsync('udisksctl', ['unmount', '-b', partPath]);
                console.log(`Successfully unmounted ${partPath}.`);
            } catch (unmountError) {
                // Ignore "Not Mounted" errors, but log others.
                if (unmountError.stderr && unmountError.stderr.includes('NotMounted')) {
                    console.log(`${partPath} was already not mounted.`);
                } else {
                    console.warn(`Could not unmount ${partPath}: ${unmountError.message}. Stderr: ${unmountError.stderr || ''}`);
                    // Do not re-throw; attempt to power off anyway.
                }
            }
        }

        // Step 3: Power off the disk.
        // udisksctl power-off requires the main block device (e.g. /dev/sda), not a partition.
        console.log(`Attempting to power off ${targetDevicePath}...`);
        await execFileAsync('udisksctl', ['power-off', '-b', targetDevicePath]);
        console.log(`Successfully powered off ${targetDevicePath}.`);

        return Promise.resolve();

    } catch (error) {
        console.error(`Error during safe eject for ${targetDevicePath}: ${error.message}`);
        let errorMessage = error.message;
        if (error.stderr) {
            console.error(`Stderr: ${error.stderr}`);
            errorMessage += ` Stderr: ${error.stderr}`;
        }
        // Specific error for udisksctl power-off if disk is busy
        if (error.stderr && error.stderr.includes('Device is busy')) {
             errorMessage = `Device ${targetDevicePath} is busy. Ensure all filesystems are unmounted and no processes are using it. (${error.stderr})`;
        }
        return Promise.reject(new Error(`Safe eject failed for ${targetDevicePath}: ${errorMessage}`));
    }
}
