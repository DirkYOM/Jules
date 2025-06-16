#!/usr/bin/env node

const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const { constants: fsConstants } = require('fs');
const execFileAsync = util.promisify(execFile);

let commandPathCache = {};

const COMMON_COMMAND_LOCATIONS = {
    'lsblk': ['/bin/lsblk', '/usr/bin/lsblk'],
    'parted': ['/sbin/parted', '/usr/sbin/parted'],
    'resize2fs': ['/sbin/resize2fs', '/usr/sbin/resize2fs'],
    'udisksctl': ['/bin/udisksctl', '/usr/bin/udisksctl'],
    'sgdisk': ['/sbin/sgdisk', '/usr/sbin/sgdisk', '/usr/bin/sgdisk'],
    'e2fsck': ['/sbin/e2fsck', '/usr/sbin/e2fsck'],
    'partprobe': ['/sbin/partprobe', '/usr/sbin/partprobe'],
    'command': ['/bin/command', '/usr/bin/command']
};

/**
 * Checks if a given command-line utility exists and is executable.
 */
async function checkCommandExists(commandName) {
    // Try common locations first
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
 * Checks for the existence of required commands and populates the cache.
 */
async function checkAllRequiredCommands(commandNames) {
    const missingCommands = [];
    commandPathCache = {};

    for (const cmdName of commandNames) {
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
        const { stdout: checkStdout, stderr: checkStderr } = await execFileAsync(partedPath, ['--script', targetDevicePath, 'print']);
        
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
                
                console.log(`Executing sgdisk: ${commandPathCache['sgdisk']} -e ${targetDevicePath}`);
                await execFileAsync(commandPathCache['sgdisk'], ['-e', targetDevicePath]);
                console.log('GPT fixed using sgdisk');
                
                // Refresh the partition table to inform the kernel
                try {
                    const partprobePath = commandPathCache['partprobe'] || await checkCommandExists('partprobe');
                    if (partprobePath) {
                        commandPathCache['partprobe'] = partprobePath;
                        await execFileAsync(partprobePath, [targetDevicePath]);
                        console.log('Partition table refreshed with partprobe');
                    }
                } catch (partprobeError) {
                    console.warn('partprobe failed, continuing anyway:', partprobeError.message);
                }
            } catch (sgdiskError) {
                console.warn(`sgdisk failed: ${sgdiskError.message}. Trying alternative approach...`);
                
                try {
                    await execFileAsync(partedPath, ['--script', targetDevicePath, 'unit', 's', 'print']);
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
    console.log(`Executing parted: ${partedPath} ${args.join(' ')}`);

    try {
        const { stdout, stderr } = await execFileAsync(partedPath, args);
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
            const { stdout: e2fsck_stdout, stderr: e2fsck_stderr } = await execFileAsync(commandPathCache['e2fsck'], ['-f', '-y', partitionDevicePath]);
            if (e2fsck_stdout) console.log(`e2fsck stdout: ${e2fsck_stdout}`);
            if (e2fsck_stderr) console.warn(`e2fsck stderr: ${e2fsck_stderr}`);
            console.log(`Filesystem check completed on ${partitionDevicePath}.`);
            
            // Now run resize2fs
            const resize2fsPath = commandPathCache['resize2fs'];
            if (!resize2fsPath) throw new Error("'resize2fs' command path not found.");
            const { stdout: resizefs_stdout, stderr: resizefs_stderr } = await execFileAsync(resize2fsPath, [partitionDevicePath]);
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

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: node extend-partition.js <device> [partition_number]');
        console.error('Example: node extend-partition.js /dev/sdb 3');
        process.exit(1);
    }

    const targetDevice = args[0];
    const partitionNumber = args[1] ? parseInt(args[1]) : 3;

    console.log(`🔧 Starting partition extension for ${targetDevice}, partition ${partitionNumber}`);
    console.log('⚠️  Make sure you have sudo privileges and the device is not mounted!');
    console.log('');

    // Check required commands
    const requiredCommands = ['parted', 'resize2fs', 'udisksctl', 'sgdisk', 'e2fsck', 'partprobe'];
    console.log('Checking required commands...');
    const missingCommands = await checkAllRequiredCommands(requiredCommands);
    
    if (missingCommands.length > 0) {
        console.error(`❌ Missing required commands: ${missingCommands.join(', ')}`);
        console.error('Please install the missing commands and try again.');
        process.exit(1);
    }
    
    console.log('✅ All required commands found.');
    console.log('');

    try {
        await extendPartition(targetDevice, partitionNumber);
        console.log('');
        console.log('🎉 Partition extension completed successfully!');
    } catch (error) {
        console.error('');
        console.error('❌ Partition extension failed:');
        console.error(error.message);
        process.exit(1);
    }
}

// Check if this script is being run directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
}