const { execFile, spawn } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const { constants: fsConstants } = require('fs'); // For fs.constants.X_OK
const execFileAsync = util.promisify(execFile);

let commandPathCache = {}; // To store discovered absolute paths for commands

const COMMON_COMMAND_LOCATIONS = {
    'dd': ['/bin/dd', '/usr/bin/dd'],
    'lsblk': ['/bin/lsblk', '/usr/bin/lsblk'],
    'parted': ['/sbin/parted', '/usr/sbin/parted'],
    'resize2fs': ['/sbin/resize2fs', '/usr/sbin/resize2fs'],
    'udisksctl': ['/bin/udisksctl', '/usr/bin/udisksctl'],
    'sgdisk': ['/sbin/sgdisk', '/usr/sbin/sgdisk', '/usr/bin/sgdisk'],
    'e2fsck': ['/sbin/e2fsck', '/usr/sbin/e2fsck'],
    'partprobe': ['/sbin/partprobe', '/usr/sbin/partprobe'],
    'command': ['/bin/command', '/usr/bin/command'],
    'sudo': ['/bin/sudo', '/usr/bin/sudo']
};

/**
 * Helper function to execute a command with sudo privileges
 */
async function execWithSudo(commandPath, args) {
    const sudoPath = commandPathCache['sudo'];
    if (!sudoPath) {
        throw new Error("'sudo' command path not found.");
    }
    
    const sudoArgs = [commandPath, ...args];
    return await execFileAsync(sudoPath, sudoArgs);
}

/**
 * Lists available block devices with relevant information.
 * Uses lsblk with JSON output.
 * Filters for disks, mmcblk, nvme types.
 * Identifies the OS drive's base device path.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of device objects.
 * Each object will have keys like: path, name, size, model, isRemovable, isOS, filesystemType.
 */
async function listBlockDevices() {
    const lsblkPath = commandPathCache['lsblk'];
    if (!lsblkPath) throw new Error("'lsblk' command path not found. Was it checked at startup?");
    
    const args = ['-Jb', '-o', 'PATH,NAME,SIZE,MODEL,FSTYPE,MOUNTPOINT,PKNAME,TYPE,RM'];

    try {
        const { stdout } = await execFileAsync(lsblkPath, args);
        const lsblkData = JSON.parse(stdout);
        let osDevicePath = null;

        function findPathForRootMountpoint(devices) {
            for (const device of devices) {
                if (device.mountpoint === '/') {
                    return device.path;
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
            for (const device of lsblkData.blockdevices || []) {
                if (device.path === rootPartitionPath && ['disk', 'mmcblk', 'nvme'].includes(device.type)) {
                    osDevicePath = device.path;
                    break;
                }
                if (device.children) {
                    if (device.children.some(child => child.path === rootPartitionPath)) {
                        osDevicePath = device.path;
                        break;
                    }
                }
            }
        }

        const devices = (lsblkData.blockdevices || [])
            .filter(device => ['disk', 'mmcblk', 'nvme'].includes(device.type))
            .map(device => ({
                path: device.path,
                name: device.name,
                size: device.size,
                model: device.model || 'Unknown Model',
                isRemovable: device.rm === true,
                isOS: device.path === osDevicePath,
                filesystemType: device.fstype || null,
            }));

        return devices;

    } catch (error) {
        console.error(`Error listing block devices: ${error.message}`);
        console.error(`Stderr: ${error.stderr}`);
        throw new Error(`Failed to list available storage devices (lsblk). Ensure 'lsblk' is installed and you have permissions. Details: ${error.stderr || error.message}`);
    }
}

/**
 * Flashes a raw image file to a target device using dd with sudo privileges.
 */
function flashImage(imagePath, targetDevicePath, totalSizeInBytes, onProgress) {
    return new Promise((resolve, reject) => {
        let lastProgress = 0;
        const ddPath = commandPathCache['dd'];
        const sudoPath = commandPathCache['sudo'];
        
        if (!ddPath) return reject(new Error("'dd' command path not found."));
        if (!sudoPath) return reject(new Error("'sudo' command path not found."));

        const args = [
            ddPath,
            `if=${imagePath}`,
            `of=${targetDevicePath}`,
            'bs=4M',
            'status=progress',
            'conv=fsync'
        ];

        console.log(`Executing dd with sudo: ${sudoPath} ${args.join(' ')}`);

        const ddProcess = spawn(sudoPath, args);

        ddProcess.stderr.on('data', (data) => {
            const output = data.toString();
            const lines = output.trim().split('\r');
            const lastLine = lines[lines.length - 1];

            let currentProgressPercentage = lastProgress;
            const bytesMatch = lastLine.match(/(\d+)\s*bytes/);

            if (bytesMatch && totalSizeInBytes > 0) {
                const bytesCopied = parseInt(bytesMatch[1], 10);
                currentProgressPercentage = Math.min(Math.round((bytesCopied / totalSizeInBytes) * 100), 100);
                
                if (currentProgressPercentage > lastProgress || (lastProgress === 0 && currentProgressPercentage === 0)) {
                    lastProgress = currentProgressPercentage;
                } else {
                    currentProgressPercentage = lastProgress;
                }
                if (bytesCopied >= totalSizeInBytes) {
                    currentProgressPercentage = 100;
                    lastProgress = 100;
                }
            } else if (lastLine.toLowerCase().includes('copied') && lastProgress < 99 && !bytesMatch) {
                lastProgress = Math.min(lastProgress + 1, 99);
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

/**
 * Retrieves the size of an image file.
 */
async function getImageSize(imagePath) {
    try {
        const stats = await fs.stat(imagePath);
        return stats.size;
    } catch (error) {
        console.error(`Error getting file size for ${imagePath}:`, error);
        throw new Error(`Could not get image file size for '${imagePath}'. Please ensure the file exists and is accessible. Details: ${error.message}`);
    }
}

/**
 * Checks if a given command-line utility exists and is executable.
 */
async function checkCommandExists(commandName) {
    const locations = COMMON_COMMAND_LOCATIONS[commandName];
    if (locations) {
        for (const loc of locations) {
            try {
                await fs.access(loc, fsConstants.X_OK);
                console.log(`Command '${commandName}' found at absolute path: ${loc}`);
                return loc;
            } catch (e) {
                // Continue to next location
            }
        }
    }
    console.error(`Command '${commandName}' not found in common locations.`);
    return null;
}

/**
 * Checks for the existence of a list of required command-line utilities and populates the commandPathCache.
 */
async function checkAllRequiredCommands(commandNames) {
    const missingCommands = [];
    commandPathCache = {};

    // Always check for sudo first
    const sudoPath = await checkCommandExists('sudo');
    if (sudoPath) {
        commandPathCache['sudo'] = sudoPath;
    } else {
        missingCommands.push('sudo');
    }

    for (const cmdName of commandNames) {
        if (cmdName === 'sudo') continue; // Already checked
        const path = await checkCommandExists(cmdName);
        if (path) {
            commandPathCache[cmdName] = path;
        } else {
            missingCommands.push(cmdName);
        }
    }
    return missingCommands;
}

/**
 * Extends a specified partition on a target device to fill 100% of the available space.
 */
async function extendPartition(targetDevicePath, partitionNumber = 3) {
    let partitionDevicePath = targetDevicePath;
    if (!targetDevicePath.match(/[0-9]$/)) {
        partitionDevicePath = targetDevicePath + partitionNumber;
    } else if (targetDevicePath.endsWith(String(partitionNumber))) {
        // no change needed
    } else {
        throw new Error(`Target device path ${targetDevicePath} and partition number ${partitionNumber} are inconsistent.`);
    }

    // Try to unmount the partition
    try {
        console.log(`Attempting to unmount partition ${partitionDevicePath} if mounted...`);
        const udisksctlPath = commandPathCache['udisksctl'];
        if (!udisksctlPath) throw new Error("'udisksctl' command path not found.");
        await execFileAsync(udisksctlPath, ['unmount', '-b', partitionDevicePath]);
        console.log(`Successfully unmounted ${partitionDevicePath}`);
    } catch (error) {
        console.warn(`Could not unmount ${partitionDevicePath} (may be normal if not mounted): ${error.message}`);
    }

    const partedPath = commandPathCache['parted'];
    if (!partedPath) throw new Error("'parted' command path not found.");

    // Check if GPT needs fixing
    console.log(`Checking if GPT needs fixing for ${targetDevicePath}...`);
    try {
        const { stdout: checkStdout, stderr: checkStderr } = await execWithSudo(partedPath, ['--script', targetDevicePath, 'print']);
        
        if (checkStderr && checkStderr.includes('you can fix the GPT')) {
            console.log('GPT needs fixing. Using sgdisk to fix...');
            
            try {
                const sgdiskPath = commandPathCache['sgdisk'];
                if (!sgdiskPath) {
                    const sgdiskFound = await checkCommandExists('sgdisk');
                    if (sgdiskFound) {
                        commandPathCache['sgdisk'] = sgdiskFound;
                    } else {
                        throw new Error("'sgdisk' command not found.");
                    }
                }
                
                console.log(`Executing sgdisk with sudo: ${commandPathCache['sgdisk']} -e ${targetDevicePath}`);
                await execWithSudo(commandPathCache['sgdisk'], ['-e', targetDevicePath]);
                console.log('GPT fixed using sgdisk');
                
                // Refresh the partition table
                try {
                    const partprobePath = commandPathCache['partprobe'] || await checkCommandExists('partprobe');
                    if (partprobePath) {
                        commandPathCache['partprobe'] = partprobePath;
                        await execWithSudo(partprobePath, [targetDevicePath]);
                        console.log('Partition table refreshed with partprobe');
                    }
                } catch (partprobeError) {
                    console.warn('partprobe failed, continuing anyway:', partprobeError.message);
                }
            } catch (sgdiskError) {
                console.warn(`sgdisk failed: ${sgdiskError.message}. Trying alternative approach...`);
                
                try {
                    await execWithSudo(partedPath, ['--script', targetDevicePath, 'unit', 's', 'print']);
                    console.log('GPT table refreshed using parted');
                } catch (unitError) {
                    console.warn('Could not refresh GPT table, proceeding anyway');
                }
            }
        } else {
            console.log('No GPT issues detected.');
        }
    } catch (error) {
        console.warn(`GPT check/fix failed (may be normal): ${error.message}`);
    }

    // Resize the partition
    const args = ['--script', targetDevicePath, 'resizepart', String(partitionNumber), '100%'];
    console.log(`Executing parted with sudo: ${partedPath} ${args.join(' ')}`);

    try {
        const { stdout, stderr } = await execWithSudo(partedPath, args);
        if (stdout) console.log(`parted stdout: ${stdout}`);
        if (stderr) console.warn(`parted stderr: ${stderr}`);

        console.log(`Partition ${partitionNumber} on ${targetDevicePath} resized by parted.`);

        // Filesystem operations
        console.log(`Attempting to resize filesystem on ${partitionDevicePath}...`);
        try {
            // First run e2fsck to check filesystem integrity
            const e2fsckPath = commandPathCache['e2fsck'];
            if (!e2fsckPath) {
                const e2fsckFound = await checkCommandExists('e2fsck');
                if (e2fsckFound) {
                    commandPathCache['e2fsck'] = e2fsckFound;
                } else {
                    throw new Error("'e2fsck' command not found.");
                }
            }
            
            console.log(`Running filesystem check with e2fsck on ${partitionDevicePath}...`);
            const { stdout: e2fsck_stdout, stderr: e2fsck_stderr } = await execWithSudo(e2fsckPath, ['-f', '-y', partitionDevicePath]);
            if (e2fsck_stdout) console.log(`e2fsck stdout: ${e2fsck_stdout}`);
            if (e2fsck_stderr) console.warn(`e2fsck stderr: ${e2fsck_stderr}`);
            console.log(`Filesystem check completed on ${partitionDevicePath}.`);
            
            // Now run resize2fs
            const resize2fsPath = commandPathCache['resize2fs'];
            if (!resize2fsPath) throw new Error("'resize2fs' command path not found.");
            const { stdout: resizefs_stdout, stderr: resizefs_stderr } = await execWithSudo(resize2fsPath, [partitionDevicePath]);
            if (resizefs_stdout) console.log(`resize2fs stdout: ${resizefs_stdout}`);
            if (resizefs_stderr) console.warn(`resize2fs stderr: ${resizefs_stderr}`);
            console.log(`Filesystem on ${partitionDevicePath} successfully resized.`);
        } catch (resizefsError) {
            console.error(`Error during filesystem operations for ${partitionDevicePath}: ${resizefsError.message}`);
            console.error(`Filesystem error stderr: ${resizefsError.stderr}`);
            throw new Error(`Partition was resized, but the filesystem could not be extended automatically. Filesystem operations failed for ${partitionDevicePath} with message: ${resizefsError.message}. You may need to run e2fsck and resize2fs manually (e.g., sudo e2fsck -f -y ${partitionDevicePath} && sudo resize2fs ${partitionDevicePath}). Stderr: ${resizefsError.stderr || 'N/A'}`);
        }

        console.log('✅ Partition extension completed successfully!');
    } catch (error) {
        console.error(`❌ Error during parted operation for ${targetDevicePath}: ${error.message}`);
        console.error(`parted stderr: ${error.stderr}`);
        throw new Error(`parted operation failed for ${targetDevicePath}: ${error.message}. Stderr: ${error.stderr}`);
    }
}

/**
 * Safely ejects a target disk by attempting to unmount all its partitions
 * and then powering off the disk using udisksctl.
 */
async function safeEject(targetDevicePath) {
    console.log(`Starting safe eject for ${targetDevicePath}`);

    try {
        const lsblkPathForEject = commandPathCache['lsblk'];
        if (!lsblkPathForEject) throw new Error("'lsblk' command path not found for eject operation.");
        
        const { stdout } = await execFileAsync(lsblkPathForEject, ['-Jb', '-o', 'PATH,TYPE', targetDevicePath]);
        const lsblkData = JSON.parse(stdout);

        let partitionsToUnmount = [];
        if (lsblkData.blockdevices && lsblkData.blockdevices[0] && lsblkData.blockdevices[0].children) {
            partitionsToUnmount = lsblkData.blockdevices[0].children
                .filter(child => child.type === 'part' && child.path)
                .map(child => child.path);
        } else if (lsblkData.blockdevices && lsblkData.blockdevices[0] && lsblkData.blockdevices[0].type === 'part') {
            console.warn(`safeEject was called with ${targetDevicePath}, which might be a partition. Proceeding with unmount if it is, but power-off might need parent.`);
        }

        if (partitionsToUnmount.length === 0) {
            const lsblkInfoSelf = await execFileAsync(lsblkPathForEject, ['-Jb', '-o', 'PATH,TYPE,MOUNTPOINT', targetDevicePath]);
            const selfInfo = JSON.parse(lsblkInfoSelf.stdout).blockdevices[0];
            if (selfInfo && selfInfo.type === 'part' && selfInfo.mountpoint) {
                partitionsToUnmount.push(targetDevicePath);
            } else if (!selfInfo) {
                console.warn(`Could not get info for ${targetDevicePath} to determine if it's a partition to unmount.`);
            }
        }

        // Unmount each partition
        for (const partPath of partitionsToUnmount) {
            try {
                console.log(`Attempting to unmount ${partPath}...`);
                const udisksctlPathForEject = commandPathCache['udisksctl']; 
                if (!udisksctlPathForEject) throw new Error("'udisksctl' command path not found for unmount in eject.");
                await execFileAsync(udisksctlPathForEject, ['unmount', '-b', partPath]);
                console.log(`Successfully unmounted ${partPath}.`);
            } catch (unmountError) {
                if (unmountError.stderr && unmountError.stderr.includes('NotMounted')) {
                    console.log(`${partPath} was already not mounted.`);
                } else {
                    console.warn(`Could not unmount ${partPath}: ${unmountError.message}. Stderr: ${unmountError.stderr || ''}`);
                }
            }
        }

        // Power off the disk
        const udisksctlPathForEjectPowerOff = commandPathCache['udisksctl'];
        if (!udisksctlPathForEjectPowerOff) throw new Error("'udisksctl' command path not found for power-off in eject.");
        console.log(`Attempting to power off ${targetDevicePath}...`);
        await execFileAsync(udisksctlPathForEjectPowerOff, ['power-off', '-b', targetDevicePath]);
        console.log(`Successfully powered off ${targetDevicePath}.`);

        return Promise.resolve();

    } catch (error) {
        console.error(`Error during safe eject for ${targetDevicePath}: ${error.message}`);
        let errorMessage = error.message;
        if (error.stderr) {
            console.error(`Stderr: ${error.stderr}`);
            errorMessage += ` Stderr: ${error.stderr}`;
        }
        if (error.stderr && error.stderr.includes('Device is busy')) {
            errorMessage = `Device ${targetDevicePath} is busy. Ensure all filesystems are unmounted and no processes are using it. (${error.stderr})`;
        }
        return Promise.reject(new Error(`Safe eject failed for ${targetDevicePath}: ${errorMessage}`));
    }
}

module.exports = {
    listBlockDevices,
    flashImage,
    extendPartition,
    safeEject,
    getImageSize,
    checkAllRequiredCommands,
};