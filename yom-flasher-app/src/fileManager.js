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
     * Get all local firmware versions from RAW folder (.zip or .raw files)
     */
    async getLocalVersions() {
        try {
            const paths = await this.initializePaths();
            const files = await fs.readdir(paths.raw);
            const versions = [];
            
            for (const file of files) {
                // Look for .zip or .raw files in RAW folder
                if (file.endsWith('.zip') || file.endsWith('.raw')) {
                    const versionMatch = file.match(/FlashingApp_v(\d+\.\d+\.\d+)\.(zip|raw)/);
                    if (versionMatch) {
                        const filePath = path.join(paths.raw, file);
                        const stats = await fs.stat(filePath);
                        versions.push({
                            version: `v${versionMatch[1]}`,
                            filename: file,
                            size: stats.size,
                            modified: stats.mtime,
                            path: filePath,
                            type: versionMatch[2] // 'zip' or 'raw'
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
     * Get auto-selected firmware (latest version) - returns path to extracted .img file
     */
    async getAutoSelectedFirmware() {
        try {
            const localVersions = await this.getLocalVersions();
            if (localVersions.length === 0) {
                return null;
            }
            
            // Get the latest version (first in sorted array)
            const latest = localVersions[0];
            
            // Check if we need to extract/process the file
            const extractedPath = await this.ensureFirmwareExtracted(latest);
            
            return {
                version: latest.version,
                filename: path.basename(extractedPath), // e.g., "FlashingApp_v1.2.3.img"
                path: extractedPath, // Path to extracted .img file
                size: latest.size,
                modified: latest.modified,
                sourceType: latest.type // 'zip' or 'raw'
            };
        } catch (error) {
            console.error('Failed to get auto-selected firmware:', error);
            return null;
        }
    }

    /**
     * Ensure firmware is extracted and ready for flashing
     */
    async ensureFirmwareExtracted(versionInfo) {
        const paths = await this.initializePaths();
        const extractedPath = path.join(paths.temp, `FlashingApp_${versionInfo.version}.img`);
        
        try {
            // Check if already extracted
            await fs.access(extractedPath, fs.constants.F_OK);
            console.log(`✅ Firmware already extracted: ${path.basename(extractedPath)}`);
            return extractedPath;
        } catch (error) {
            // Need to extract/process
            console.log(`📦 Processing firmware: ${versionInfo.filename}`);
            
            if (versionInfo.type === 'zip') {
                // Extract from zip
                await this.extractZipToTemp(versionInfo.path, extractedPath, versionInfo.version);
            } else if (versionInfo.type === 'raw') {
                // Copy raw file to temp as .img
                await fs.copyFile(versionInfo.path, extractedPath);
                console.log(`📁 Raw firmware copied to temp: ${path.basename(extractedPath)}`);
            }
            
            return extractedPath;
        }
    }

    /**
     * Extract zip file to temp directory
     */
    async extractZipToTemp(zipPath, targetPath, version) {
        try {
            console.log(`📦 Extracting zip to temp: ${path.basename(zipPath)}`);
            
            const zip = new AdmZip(zipPath);
            const zipEntries = zip.getEntries();
            
            // Find the firmware file in the zip (could be .img, .raw, etc.)
            const firmwareEntry = zipEntries.find(entry => 
                (entry.entryName.endsWith('.img') || entry.entryName.endsWith('.raw')) && !entry.isDirectory
            );
            
            if (!firmwareEntry) {
                throw new Error('No firmware file found in the zip archive');
            }
            
            console.log(`📄 Found firmware in zip: ${firmwareEntry.entryName}`);
            
            // Extract the firmware file to target location
            const firmwareData = zip.readFile(firmwareEntry);
            await fs.writeFile(targetPath, firmwareData);
            
            // Verify extracted file size
            const stats = await fs.stat(targetPath);
            console.log(`📊 Extracted firmware size: ${this.formatFileSize(stats.size)}`);
            
            return targetPath;
            
        } catch (error) {
            console.error(`❌ Zip extraction failed: ${error.message}`);
            throw new Error(`Firmware extraction failed: ${error.message}`);
        }
    }

    // =============================================================================
    // DOWNLOAD & EXTRACTION
    // =============================================================================

    /**
     * Download firmware with zip/raw file support
     * Downloads to RAW folder, extracts to Temp folder for flashing
     */
    async downloadFirmware(version, onProgress) {
        const paths = await this.initializePaths();
        
        try {
            console.log(`🔽 Starting download for firmware ${version}`);
            
            // Get download URL from API
            const response = await fetch(`${this.config.apiBaseUrl}/api/flash-images/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const downloadInfo = await response.json();
            
            // Determine file type and paths
            const isZipped = downloadInfo.filename?.endsWith('.zip') || downloadInfo.download_url.includes('.zip');
            const fileExtension = isZipped ? '.zip' : '.raw';
            const rawFilePath = path.join(paths.raw, `FlashingApp_${version}${fileExtension}`);
            const tempFilePath = path.join(paths.temp, `${version}_download${fileExtension}`);
            
            console.log(`📥 Downloading ${isZipped ? 'compressed' : 'raw'} firmware to RAW folder`);
            
            // Download to temp first
            await this.downloadFile(downloadInfo.download_url, tempFilePath, downloadInfo.file_size, onProgress);
            
            // Verify checksum of downloaded file (ENHANCED with skip option)
            if (downloadInfo.checksum && downloadInfo.checksum !== 'sha256:skip_verification') {
                console.log('🔍 Verifying download checksum...');
                const isValid = await this.verifyChecksum(tempFilePath, downloadInfo.checksum);
                if (!isValid) {
                    throw new Error('Downloaded file checksum verification failed');
                }
                console.log('✅ Download checksum verified');
            } else if (downloadInfo.checksum === 'sha256:skip_verification') {
                console.log('⚠️  Checksum verification skipped for testing');
            } else {
                console.log('ℹ️  No checksum provided, skipping verification');
            }
            
            // Move to RAW folder
            await fs.rename(tempFilePath, rawFilePath);
            console.log(`📁 Firmware saved to RAW folder: ${path.basename(rawFilePath)}`);
            
            // Clean up old versions in RAW folder
            await this.manageStorageLimit();
            
            console.log(`✅ Firmware ${version} downloaded to: ${rawFilePath}`);
            return rawFilePath;
            
        } catch (error) {
            console.error('❌ Download failed:', error);
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
     * Manage storage limit by keeping only latest N versions in RAW folder
     */
    async manageStorageLimit() {
        const paths = await this.initializePaths();
        
        try {
            const firmwareFiles = await this.getLocalVersions(); // Gets .zip/.raw files from RAW
            
            // Keep only the latest N versions in RAW folder
            if (firmwareFiles.length > this.config.maxStoredVersions) {
                const toDelete = firmwareFiles.slice(this.config.maxStoredVersions);
                
                for (const firmware of toDelete) {
                    try {
                        await fs.unlink(firmware.path);
                        console.log(`🗑️  Deleted old firmware from RAW: ${firmware.version} (${this.formatFileSize(firmware.size)} freed)`);
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
     * Cleanup old temporary files and extracted firmware files
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
    // LOGGING SYSTEM
    // =============================================================================

    /**
     * Get device serial number using smartctl
     */
    async getDeviceSerial(devicePath) {
        try {
            const { stdout } = await execAsync('smartctl', ['-i', devicePath]);
            const serialMatch = stdout.match(/Serial Number:\s*(\S+)/);
            return serialMatch ? serialMatch[1] : null;
        } catch (error) {
            console.error('Failed to get device serial:', error);
            return null;
        }
    }

    /**
     * Log flash operation with enhanced details
     */
    async logFlashOperationWithSerial(devicePath, firmwareVersion, status, startTime, endTime, additionalInfo = {}) {
        try {
            const paths = await this.initializePaths();
            
            // Get device serial number
            const deviceSerial = await this.getDeviceSerial(devicePath);
            
            // Calculate duration
            const duration = endTime ? Math.round((endTime - startTime) / 1000) : 0;
            
            // Create log entry in format: {TimeStamp} {Name_version} {serial number}
            const logEntry = {
                timestamp: new Date().toISOString(),
                firmware: firmwareVersion, // e.g., "FlashingApp_v1.2.3"
                serialNumber: deviceSerial || 'UNKNOWN',
                status,
                duration,
                device: devicePath,
                ...additionalInfo
            };
            
            const logPath = path.join(paths.logs, 'flash_operations.csv');
            
            // CSV format: timestamp,firmware,serial,status,duration,device,additional
            const csvLine = [
                logEntry.timestamp,
                logEntry.firmware,
                logEntry.serialNumber,
                logEntry.status,
                logEntry.duration,
                logEntry.device,
                JSON.stringify(additionalInfo)
            ].join(',') + '\n';
            
            await fs.appendFile(logPath, csvLine);
            console.log(`📝 Flash operation logged: ${firmwareVersion} -> ${logEntry.serialNumber}`);
            
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
                const entries = lines.map(line => {
                    const [timestamp, firmware, serialNumber, status, duration, device, additionalInfo] = line.split(',');
                    return {
                        timestamp,
                        firmware,
                        serialNumber,
                        status: status,
                        duration: parseInt(duration) || 0,
                        device,
                        additionalInfo: additionalInfo ? JSON.parse(additionalInfo) : {}
                    };
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