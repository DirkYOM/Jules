const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const AdmZip = require('adm-zip');

const execAsync = util.promisify(execFile);

class FileManager {
    constructor(config = {}) {
        this.config = {
            apiBaseUrl: config.apiBaseUrl || 'http://localhost:3001',
            maxStoredVersions: config.maxStoredVersions || 3,
            downloadTimeout: config.downloadTimeout || 3600 * 1000,
            tempFileMaxAge: config.tempFileMaxAge || 24 * 60 * 60 * 1000, // 24 hours
            ...config
        };
        
        this.paths = null;
        this.initialized = false;
    }

    // =============================================================================
    // DIRECTORY INITIALIZATION & SETUP
    // =============================================================================

    /**
     * Create artifacts directory structure with sudo permissions
     * Called right after password/sudo prompt succeeds
     */
    async createArtifactsDirectoryStructure() {
        try {
            const artifactsPath = path.join(process.cwd(), 'artifacts');
            const subdirs = ['RAW', 'Export', 'Temp', 'Logs'];
            
            console.log('🔧 Creating artifacts directory structure...');
            
            // Create main artifacts directory
            await execAsync('sudo', ['mkdir', '-p', artifactsPath]);
            
            // Create subdirectories  
            for (const subdir of subdirs) {
                const subdirPath = path.join(artifactsPath, subdir);
                await execAsync('sudo', ['mkdir', '-p', subdirPath]);
            }
            
            // Set proper permissions (755 = owner can read/write/execute, group and others can read/execute)
            await execAsync('sudo', ['chmod', '-R', '755', artifactsPath]);
            
            // Change ownership to current user
            const user = process.env.USER || process.env.USERNAME || 'root';
            await execAsync('sudo', ['chown', '-R', `${user}:${user}`, artifactsPath]);
            
            console.log('✅ Artifacts directory structure created successfully');
            
            return {
                artifacts: artifactsPath,
                raw: path.join(artifactsPath, 'RAW'),
                export: path.join(artifactsPath, 'Export'),
                temp: path.join(artifactsPath, 'Temp'),
                logs: path.join(artifactsPath, 'Logs')
            };
            
        } catch (error) {
            console.error('❌ Failed to create artifacts directory structure:', error);
            throw new Error(`Directory creation failed: ${error.message}`);
        }
    }

    /**
     * Initialize and verify directory paths
     * Called during app startup after sudo directory creation
     */
    async initializePaths() {
        if (this.initialized && this.paths) {
            return this.paths;
        }

        const artifactsPath = path.join(process.cwd(), 'artifacts');
        
        this.paths = {
            artifacts: artifactsPath,
            raw: path.join(artifactsPath, 'RAW'),
            export: path.join(artifactsPath, 'Export'),
            temp: path.join(artifactsPath, 'Temp'),
            logs: path.join(artifactsPath, 'Logs')
        };
        
        // Verify directories exist (they should from sudo creation)
        for (const [name, dirPath] of Object.entries(this.paths)) {
            try {
                await fs.access(dirPath, fs.constants.F_OK);
                console.log(`✅ Directory verified: ${name} -> ${dirPath}`);
            } catch (error) {
                console.error(`❌ Directory missing: ${name} -> ${dirPath}`);
                throw new Error(`Required directory missing: ${dirPath}. Run with sudo to create directories.`);
            }
        }
        
        this.initialized = true;
        return this.paths;
    }

    // =============================================================================
    // FIRMWARE VERSION MANAGEMENT
    // =============================================================================

    /**
     * Check for firmware updates via API
     */
    async checkForUpdates() {
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/flash-images/latest`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const latest = await response.json();
            const localVersions = await this.getLocalVersions();
            const latestLocal = this.getLatestVersion(localVersions);
            
            const hasUpdate = !latestLocal || this.compareVersions(latest.version, latestLocal) > 0;
            
            return {
                hasUpdate,
                latest,
                current: latestLocal,
                localVersions,
                canDowngrade: false // Always prevent downgrades
            };
        } catch (error) {
            console.error('Update check failed:', error);
            return { hasUpdate: false, error: error.message };
        }
    }

    /**
     * Get all local firmware from RAW folder (.raw files - the extracted and ready files)
     */
    async getLocalVersions() {
        try {
            const paths = await this.initializePaths();
            const files = await fs.readdir(paths.raw);
            const versions = [];
            
            for (const file of files) {
                // Look for .raw files in RAW folder (the final extracted files)
                if (file.endsWith('.raw')) {
                    // Look for the specific naming pattern: yom-node-os-P1-disk.raw
                    if (file === 'yom-node-os-P1-disk.raw') {
                        const filePath = path.join(paths.raw, file);
                        const stats = await fs.stat(filePath);
                        versions.push({
                            version: 'v1.2.3', // Latest version (could be dynamic based on API)
                            filename: file,
                            size: stats.size,
                            modified: stats.mtime,
                            path: filePath,
                            type: 'raw' // Ready-to-flash raw file
                        });
                    }
                }
            }
            
            return versions.sort((a, b) => this.compareVersions(b.version, a.version));
        } catch (error) {
            console.error('Failed to get local versions:', error);
            return [];
        }
    }

    /**
     * Get auto-selected firmware (latest version) - returns path to ready .raw file
     */
    async getAutoSelectedFirmware() {
        try {
            const localVersions = await this.getLocalVersions();
            if (localVersions.length === 0) {
                return null;
            }
            
            // Get the latest version (should be the .raw file)
            const latest = localVersions[0];
            
            // The file should already be ready for flashing (no extraction needed)
            return {
                version: latest.version,
                filename: latest.filename, // e.g., "yom-node-os-P1-disk.raw"
                path: latest.path, // Direct path to .raw file in RAW folder
                size: latest.size,
                modified: latest.modified,
                sourceType: 'raw' // Ready to flash
            };
        } catch (error) {
            console.error('Failed to get auto-selected firmware:', error);
            return null;
        }
    }

    /**
     * Ensure firmware is extracted and ready for flashing
     * ONLY handles ZIP files - extracts to .raw (not .img)
     */
    async ensureFirmwareExtracted(versionInfo) {
        const paths = await this.initializePaths();
        const extractedPath = path.join(paths.temp, `FlashingApp_${versionInfo.version}.raw`); // Keep as .raw
        
        try {
            // Check if already extracted
            await fs.access(extractedPath, fs.constants.F_OK);
            console.log(`✅ Firmware already extracted: ${path.basename(extractedPath)}`);
            
            // Verify the extracted file is not empty/corrupted
            const stats = await fs.stat(extractedPath);
            if (stats.size > 1024 * 1024) { // At least 1MB
                console.log(`✅ Extracted firmware verified: ${this.formatFileSize(stats.size)}`);
                return extractedPath;
            } else {
                console.log(`⚠️  Extracted firmware seems corrupted (${this.formatFileSize(stats.size)}), re-extracting...`);
                await fs.unlink(extractedPath); // Delete corrupted file
                // Fall through to extraction
            }
        } catch (error) {
            // File doesn't exist or error checking - proceed to extraction
        }
        
        // Need to extract from ZIP
        console.log(`📦 Extracting ZIP firmware: ${versionInfo.filename}`);
        
        // ONLY handle ZIP files
        if (versionInfo.type !== 'zip') {
            throw new Error(`Unsupported file type: ${versionInfo.type}. Only ZIP files are supported.`);
        }
        
        // Extract ZIP to .raw file
        await this.extractZipToRaw(versionInfo.path, extractedPath, versionInfo.version);
        
        return extractedPath;
    }

    /**
     * Extract ZIP file directly to RAW folder with consistent naming
     * Uses system unzip command to handle large files (>2GB)
     */
    async extractZipToRawFolder(zipPath, targetRawPath) {
        try {
            console.log(`📦 Extracting ZIP to RAW folder: ${path.basename(zipPath)}`);
            
            const rawDir = path.dirname(targetRawPath);
            
            // First, list contents of ZIP to find the .raw file
            console.log(`🔍 Listing ZIP contents...`);
            const { stdout: listOutput } = await execAsync('unzip', ['-l', zipPath]);
            
            // Find the .raw file in the ZIP listing
            const rawFileMatch = listOutput.match(/^\s*\d+\s+[\d\-\:\s]+\s+(.+\.raw)$/m);
            if (!rawFileMatch) {
                throw new Error('No .raw firmware file found in the ZIP archive');
            }
            
            const rawFileName = rawFileMatch[1].trim();
            console.log(`📄 Found RAW firmware in ZIP: ${rawFileName}`);
            
            // Extract the specific .raw file to RAW directory
            console.log(`📤 Extracting ${rawFileName} to RAW folder...`);
            await execAsync('unzip', ['-j', zipPath, rawFileName, '-d', rawDir]);
            
            // The extracted file will have its original name, rename to consistent name
            const extractedOriginalPath = path.join(rawDir, rawFileName);
            
            // Check if the extracted file exists
            try {
                await fs.access(extractedOriginalPath);
            } catch (error) {
                throw new Error(`Extracted file not found: ${extractedOriginalPath}`);
            }
            
            // Rename to consistent naming: yom-node-os-P1-disk.raw
            if (extractedOriginalPath !== targetRawPath) {
                console.log(`📝 Renaming to consistent name: ${path.basename(targetRawPath)}`);
                await fs.rename(extractedOriginalPath, targetRawPath);
            }
            
            // Verify extracted file size
            const stats = await fs.stat(targetRawPath);
            console.log(`✅ RAW firmware ready: ${this.formatFileSize(stats.size)}`);
            
            return targetRawPath;
            
        } catch (error) {
            console.error(`❌ ZIP extraction failed: ${error.message}`);
            
            // Clean up any partial extraction
            try {
                await fs.unlink(targetRawPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            throw new Error(`Firmware extraction failed: ${error.message}`);
        }
    }

    // =============================================================================
    // DOWNLOAD & EXTRACTION
    // =============================================================================

    /**
     * Download firmware - Downloads ZIP and extracts to RAW folder, then deletes ZIP
     */
    async downloadFirmware(version, onProgress) {
        const paths = await this.initializePaths();
        
        try {
            console.log(`🔽 Starting firmware download for ${version}`);
            
            // Get download URL from API
            const response = await fetch(`${this.config.apiBaseUrl}/api/flash-images/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const downloadInfo = await response.json();
            
            // ENFORCE ZIP-ONLY downloads
            if (!downloadInfo.filename?.endsWith('.zip')) {
                throw new Error(`Only ZIP files are supported. Received: ${downloadInfo.filename}`);
            }
            
            const tempZipPath = path.join(paths.temp, downloadInfo.filename);
            const finalRawPath = path.join(paths.raw, 'yom-node-os-P1-disk.raw');
            
            console.log(`📥 Downloading ZIP firmware to temp folder`);
            
            // Download ZIP to temp folder
            await this.downloadFile(downloadInfo.download_url, tempZipPath, downloadInfo.file_size, onProgress);
            
            // Verify checksum of downloaded ZIP file
            if (downloadInfo.checksum && downloadInfo.checksum !== 'sha256:skip_verification') {
                console.log('🔍 Verifying ZIP download checksum...');
                const isValid = await this.verifyChecksum(tempZipPath, downloadInfo.checksum);
                if (!isValid) {
                    throw new Error('Downloaded ZIP file checksum verification failed');
                }
                console.log('✅ ZIP download checksum verified');
            } else if (downloadInfo.checksum === 'sha256:skip_verification') {
                console.log('⚠️  ZIP checksum verification skipped for testing');
            } else {
                console.log('ℹ️  No checksum provided for ZIP, skipping verification');
            }
            
            // Extract ZIP directly to RAW folder
            console.log(`📦 Extracting firmware to RAW folder...`);
            await this.extractZipToRawFolder(tempZipPath, finalRawPath);
            
            // Delete the ZIP file to save space
            console.log(`🗑️  Deleting ZIP file to save space...`);
            await fs.unlink(tempZipPath);
            
            // Clean up old versions
            await this.manageStorageLimit();
            
            console.log(`✅ Firmware ready for flashing: ${finalRawPath}`);
            return finalRawPath;
            
        } catch (error) {
            console.error('❌ Firmware download/extraction failed:', error);
            throw error;
        }
    }

    /**
     * Download file with progress tracking
     */
    async downloadFile(url, filePath, expectedSize, onProgress) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            const file = require('fs').createWriteStream(filePath);
            
            const request = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(filePath).catch(() => {});
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                
                const totalSize = parseInt(response.headers['content-length']) || expectedSize;
                let downloadedSize = 0;
                let startTime = Date.now();
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    
                    if (onProgress) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = downloadedSize / elapsed;
                        
                        onProgress({
                            progress,
                            downloadedSize,
                            totalSize,
                            speed: this.formatSpeed(speed)
                        });
                    }
                });
                
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            });
            
            request.on('error', (error) => {
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(error);
            });
            
            // Set download timeout
            request.setTimeout(this.config.downloadTimeout, () => {
                request.destroy();
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(new Error('Download timeout'));
            });
        });
    }

    // =============================================================================
    // STORAGE MANAGEMENT
    // =============================================================================

    /**
     * Manage storage limit by keeping only latest N versions in RAW folder (ZIP files)
     */
    async manageStorageLimit() {
        const paths = await this.initializePaths();
        
        try {
            const firmwareFiles = await this.getLocalVersions(); // Gets .zip files from RAW
            
            // Keep only the latest N versions in RAW folder
            if (firmwareFiles.length > this.config.maxStoredVersions) {
                const toDelete = firmwareFiles.slice(this.config.maxStoredVersions);
                
                for (const firmware of toDelete) {
                    try {
                        await fs.unlink(firmware.path);
                        console.log(`🗑️  Deleted old ZIP firmware from RAW: ${firmware.version} (${this.formatFileSize(firmware.size)} freed)`);
                    } catch (error) {
                        console.error(`Failed to delete ${firmware.version}:`, error);
                    }
                }
            }
            
            // Also cleanup any leftover temp files and old extracted files
            await this.cleanupTempFiles();
            
        } catch (error) {
            console.error('Storage management failed:', error);
        }
    }

    /**
     * Cleanup old temporary files and extracted firmware files (.raw files in temp)
     */
    async cleanupTempFiles() {
        const paths = await this.initializePaths();
        
        try {
            const tempFiles = await fs.readdir(paths.temp);
            const now = Date.now();
            
            for (const file of tempFiles) {
                const filePath = path.join(paths.temp, file);
                const stats = await fs.stat(filePath);
                
                // Clean up old temp files (downloads, extractions, etc.)
                if (now - stats.mtime.getTime() > this.config.tempFileMaxAge) {
                    await fs.unlink(filePath);
                    console.log(`🗑️  Cleaned up old temp file: ${file}`);
                }
            }
        } catch (error) {
            console.error('Temp file cleanup failed:', error);
        }
    }

    // =============================================================================
    // ENHANCED LOGGING SYSTEM WITH IMPROVED SERIAL NUMBER PARSING
    // =============================================================================

    /**
     * Enhanced device serial number extraction using smartctl with better error handling
     * Uses partition 3 for smartctl since that's where the data is available after flashing
     */
    async getDeviceSerial(devicePath) {
        try {
            console.log(`🔍 Getting serial number for device: ${devicePath}`);

            // Get the base device path (remove any existing partition numbers)
            const baseDevicePath = this.getBaseDevicePath(devicePath);
            console.log(`📍 Base device path: ${baseDevicePath}`);
            
            // Construct partition 3 path (this is where smartctl data is available after flashing)
            const partition3Path = this.getPartition3Path(baseDevicePath);
            console.log(`📍 Partition 3 path for smartctl: ${partition3Path}`);

            // Try multiple approaches to get serial number, prioritizing partition 3
            const serialAttempts = [
                // Method 1: Direct smartctl on partition 3 (most likely to work)
                () => this.trySmartctlSerial(partition3Path),
                // Method 2: Try other partitions if partition 3 fails
                () => this.trySmartctlSerial(this.getPartition1Path(baseDevicePath)),
                () => this.trySmartctlSerial(this.getPartition2Path(baseDevicePath)),
                // Method 3: Try base device as fallback
                () => this.trySmartctlSerial(baseDevicePath),
                // Method 4: Try with different smartctl options on partition 3
                () => this.trySmartctlSerialWithOptions(partition3Path, ['-i', '-d', 'auto']),
                // Method 5: Parse from /dev/disk/by-id/ symlinks
                () => this.trySerialFromDiskById(baseDevicePath),
                // Method 6: Use lsblk with serial info
                () => this.tryLsblkSerial(baseDevicePath)
            ];

            for (const attempt of serialAttempts) {
                try {
                    const serial = await attempt();
                    if (serial && serial !== 'Unknown' && serial.trim() !== '') {
                        console.log(`✅ Serial number found: ${serial}`);
                        return serial;
                    }
                } catch (error) {
                    console.log(`⚠️  Serial attempt failed: ${error.message}`);
                    continue;
                }
            }

            console.warn(`❌ Could not determine serial number for ${devicePath}`);
            return 'UNKNOWN';

        } catch (error) {
            console.error(`❌ Failed to get device serial for ${devicePath}:`, error);
            return 'UNKNOWN';
        }
    }

    /**
     * Get base device path by removing partition numbers
     */
    getBaseDevicePath(devicePath) {
        // Handle different device naming conventions
        // /dev/sda1 -> /dev/sda
        // /dev/nvme0n1p1 -> /dev/nvme0n1
        // /dev/mmcblk0p1 -> /dev/mmcblk0
        
        if (devicePath.match(/\/dev\/sd[a-z]\d+$/)) {
            return devicePath.replace(/\d+$/, '');
        }
        if (devicePath.match(/\/dev\/nvme\d+n\d+p\d+$/)) {
            return devicePath.replace(/p\d+$/, '');
        }
        if (devicePath.match(/\/dev\/mmcblk\d+p\d+$/)) {
            return devicePath.replace(/p\d+$/, '');
        }
        
        // If no partition number detected, return as-is
        return devicePath;
    }

    /**
     * Get partition 3 path for smartctl (where data is available after flashing)
     */
    getPartition3Path(baseDevicePath) {
        // Handle different device naming conventions
        // /dev/sda -> /dev/sda3
        // /dev/nvme0n1 -> /dev/nvme0n1p3
        // /dev/mmcblk0 -> /dev/mmcblk0p3
        
        if (baseDevicePath.match(/\/dev\/sd[a-z]$/)) {
            return baseDevicePath + '3';
        }
        if (baseDevicePath.match(/\/dev\/nvme\d+n\d+$/)) {
            return baseDevicePath + 'p3';
        }
        if (baseDevicePath.match(/\/dev\/mmcblk\d+$/)) {
            return baseDevicePath + 'p3';
        }
        
        // Fallback: just append 3
        return baseDevicePath + '3';
    }

    /**
     * Get partition 1 path for smartctl fallback
     */
    getPartition1Path(baseDevicePath) {
        if (baseDevicePath.match(/\/dev\/sd[a-z]$/)) {
            return baseDevicePath + '1';
        }
        if (baseDevicePath.match(/\/dev\/nvme\d+n\d+$/)) {
            return baseDevicePath + 'p1';
        }
        if (baseDevicePath.match(/\/dev\/mmcblk\d+$/)) {
            return baseDevicePath + 'p1';
        }
        return baseDevicePath + '1';
    }

    /**
     * Get partition 2 path for smartctl fallback
     */
    getPartition2Path(baseDevicePath) {
        if (baseDevicePath.match(/\/dev\/sd[a-z]$/)) {
            return baseDevicePath + '2';
        }
        if (baseDevicePath.match(/\/dev\/nvme\d+n\d+$/)) {
            return baseDevicePath + 'p2';
        }
        if (baseDevicePath.match(/\/dev\/mmcblk\d+$/)) {
            return baseDevicePath + 'p2';
        }
        return baseDevicePath + '2';
    }

    /**
     * Try to get serial using standard smartctl
     */
    async trySmartctlSerial(devicePath) {
        try {
            const { stdout } = await execAsync('sudo', ['smartctl', '-i', devicePath]);
            const serialMatch = stdout.match(/Serial Number:\s*([^\s\n\r]+)/i);
            if (serialMatch && serialMatch[1]) {
                return serialMatch[1].trim();
            }
            throw new Error('Serial number not found in smartctl output');
        } catch (error) {
            throw new Error(`smartctl failed: ${error.message}`);
        }
    }

    /**
     * Try smartctl with specific options
     */
    async trySmartctlSerialWithOptions(devicePath, options) {
        try {
            const { stdout } = await execAsync('sudo', ['smartctl', ...options, devicePath]);
            const serialMatch = stdout.match(/Serial Number:\s*([^\s\n\r]+)/i);
            if (serialMatch && serialMatch[1]) {
                return serialMatch[1].trim();
            }
            throw new Error('Serial number not found in smartctl output with options');
        } catch (error) {
            throw new Error(`smartctl with options failed: ${error.message}`);
        }
    }

    /**
     * Try to get serial from /dev/disk/by-id/ symlinks
     */
    async trySerialFromDiskById(devicePath) {
        try {
            const { stdout } = await execAsync('ls', ['-la', '/dev/disk/by-id/']);
            const deviceName = path.basename(devicePath);
            
            // Look for entries that point to our device
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes(`-> ../../${deviceName}`) || line.includes(`-> ../..${devicePath}`)) {
                    // Extract serial from the by-id name
                    // Format is usually: {interface}-{model}_{serial}
                    const match = line.match(/([a-zA-Z0-9]+)-([^_]+)_([a-zA-Z0-9]+)/);
                    if (match && match[3]) {
                        return match[3].trim();
                    }
                }
            }
            throw new Error('Serial not found in /dev/disk/by-id/');
        } catch (error) {
            throw new Error(`by-id lookup failed: ${error.message}`);
        }
    }

    /**
     * Try to get serial using lsblk
     */
    async tryLsblkSerial(devicePath) {
        try {
            const { stdout } = await execAsync('lsblk', ['-o', 'NAME,SERIAL', '-n', devicePath]);
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[1] && parts[1] !== '') {
                    return parts[1].trim();
                }
            }
            throw new Error('Serial not found in lsblk output');
        } catch (error) {
            throw new Error(`lsblk failed: ${error.message}`);
        }
    }

    /**
     * Log flash operation with enhanced serial number detection
     */
    async logFlashOperationWithSerial(devicePath, firmwareVersion, status, startTime, endTime, additionalInfo = {}) {
        try {
            const paths = await this.initializePaths();
            
            // Get device serial number with enhanced detection
            const deviceSerial = await this.getDeviceSerial(devicePath);
            
            // Calculate duration
            const duration = endTime ? Math.round((endTime - startTime) / 1000) : 0;
            
            // Create log entry in format: {TimeStamp} {Name_version} {serial number}
            const logEntry = {
                timestamp: new Date().toISOString(),
                firmware: firmwareVersion, // e.g., "FlashingApp_v1.2.3"
                serialNumber: deviceSerial,
                status,
                duration,
                device: devicePath,
                baseDevice: this.getBaseDevicePath(devicePath),
                ...additionalInfo
            };
            
            const logPath = path.join(paths.logs, 'flash_operations.csv');
            
            // Check if CSV file exists and create header if needed
            try {
                await fs.access(logPath);
            } catch (error) {
                // File doesn't exist, create with header
                const header = 'timestamp,firmware,serial\n';
                await fs.writeFile(logPath, header);
            }
            
            // Simple CSV format: timestamp,firmware,serial
            const csvLine = [
                logEntry.timestamp,
                logEntry.firmware,
                logEntry.serialNumber
            ].join(',') + '\n';
            
            await fs.appendFile(logPath, csvLine);
            console.log(`📝 Flash operation logged: ${firmwareVersion} -> ${deviceSerial}`);
            
            return logEntry;
        } catch (error) {
            console.error('Failed to log flash operation:', error);
            throw error;
        }
    }

    /**
     * Export flash logs
     */
    async exportFlashLog(format = 'csv') {
        try {
            const paths = await this.initializePaths();
            const logPath = path.join(paths.logs, 'flash_operations.csv');
            
            const logData = await fs.readFile(logPath, 'utf-8');
            
            if (format === 'csv') {
                return logData;
            } else if (format === 'json') {
                const lines = logData.trim().split('\n');
                const headers = lines[0].split(','); // timestamp,firmware,serial
                const entries = lines.slice(1).map(line => {
                    const values = line.split(',');
                    const entry = {};
                    headers.forEach((header, index) => {
                        entry[header] = values[index] || '';
                    });
                    return entry;
                });
                return JSON.stringify(entries, null, 2);
            }
            
            return logData;
        } catch (error) {
            console.error('Failed to export log:', error);
            throw error;
        }
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

    /**
     * Verify file checksum
     */
    async verifyChecksum(filePath, expectedChecksum) {
        try {
            const hash = crypto.createHash('sha256');
            const stream = require('fs').createReadStream(filePath);
            
            return new Promise((resolve, reject) => {
                stream.on('data', (data) => hash.update(data));
                stream.on('end', () => {
                    const actualChecksum = `sha256:${hash.digest('hex')}`;
                    resolve(actualChecksum === expectedChecksum);
                });
                stream.on('error', reject);
            });
        } catch (error) {
            console.error('Checksum verification failed:', error);
            return false;
        }
    }

    /**
     * Compare version strings
     */
    compareVersions(a, b) {
        const aVersion = a.replace(/^v/, '').split('.').map(Number);
        const bVersion = b.replace(/^v/, '').split('.').map(Number);
        
        for (let i = 0; i < Math.max(aVersion.length, bVersion.length); i++) {
            const aNum = aVersion[i] || 0;
            const bNum = bVersion[i] || 0;
            
            if (aNum > bNum) return 1;
            if (aNum < bNum) return -1;
        }
        return 0;
    }

    /**
     * Get latest version from array
     */
    getLatestVersion(versions) {
        return versions.length > 0 ? versions[0].version : null;
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Format speed for display
     */
    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(1)} B/s`;
        if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    /**
     * Format duration for display
     */
    formatDuration(seconds) {
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    }
}

module.exports = { FileManager };