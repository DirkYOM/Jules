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
            // Production API configuration
            apiBaseUrl: config.apiBaseUrl || process.env.YOM_PRODUCTION_API || 'https://your-production-api.com',
            maxStoredVersions: config.maxStoredVersions || 3,
            downloadTimeout: config.downloadTimeout || 7200 * 1000, // 2 hours for large files
            tempFileMaxAge: config.tempFileMaxAge || 24 * 60 * 60 * 1000, // 24 hours
            stationId: config.stationId || 'YOM-FLASH-001',
            ...config
        };
        
        this.paths = null;
        this.initialized = false;
        this.cachedDownloadUrl = null;
        this.downloadUrlExpiry = null;
    }

    // =============================================================================
    // DIRECTORY INITIALIZATION & SETUP
    // =============================================================================

    async createArtifactsDirectoryStructure() {
        try {
            const artifactsPath = path.join(process.cwd(), 'artifacts');
            const subdirs = ['RAW', 'Export', 'Temp', 'Logs'];
            
            console.log('🔧 Creating artifacts directory structure...');
            
            await execAsync('sudo', ['mkdir', '-p', artifactsPath]);
            
            for (const subdir of subdirs) {
                const subdirPath = path.join(artifactsPath, subdir);
                await execAsync('sudo', ['mkdir', '-p', subdirPath]);
            }
            
            await execAsync('sudo', ['chmod', '-R', '755', artifactsPath]);
            
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
    // PRODUCTION API CALLS
    // =============================================================================

    /**
     * Make HTTP request to production API
     */
    async makeApiRequest(endpoint, options = {}) {
        const url = `${this.config.apiBaseUrl}${endpoint}`;
        const isHttps = url.startsWith('https:');
        
        return new Promise((resolve, reject) => {
            const requestOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'YOM-Flash-Tool/1.0.0',
                    ...options.headers
                },
                timeout: options.timeout || 30000
            };

            const client = isHttps ? https : http;
            const req = client.request(url, requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve({
                            statusCode: res.statusCode,
                            data: jsonData,
                            headers: res.headers
                        });
                    } catch (error) {
                        resolve({
                            statusCode: res.statusCode,
                            data: data,
                            headers: res.headers
                        });
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(new Error(`API request failed: ${error.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('API request timeout'));
            });
            
            if (options.body) {
                req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            }
            
            req.end();
        });
    }

    /**
     * Get latest firmware version from production API
     */
    async getLatestFirmwareVersion() {
        try {
            console.log('🔍 Fetching latest firmware from production API...');
            
            const response = await this.makeApiRequest('/flash-images/latest');
            
            if (response.statusCode === 200) {
                console.log(`✅ Latest firmware: ${response.data.version}`);
                return {
                    success: true,
                    firmware: response.data
                };
            } else if (response.statusCode === 404) {
                console.log('⚠️ No firmware available from production API');
                return {
                    success: false,
                    error: response.data?.data?.message || 'No flash images available'
                };
            } else {
                throw new Error(`API returned ${response.statusCode}: ${response.data?.data?.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('❌ Failed to fetch latest firmware:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get download URL for specific firmware version
     */
    async getDownloadUrl(version) {
        try {
            console.log(`📥 Requesting download URL for version: ${version}`);
            
            const response = await this.makeApiRequest('/flash-images/download', {
                method: 'POST',
                body: { version }
            });
            
            if (response.statusCode === 200) {
                const downloadData = response.data;
                
                console.log(`✅ Download URL generated for ${version}`);
                console.log(`📦 File size: ${this.formatFileSize(downloadData.file_size)}`);
                console.log(`⏰ Expires at: ${downloadData.expires_at}`);
                
                // Cache the download URL and expiry
                this.cachedDownloadUrl = downloadData.download_url;
                this.downloadUrlExpiry = new Date(downloadData.expires_at);
                
                return {
                    success: true,
                    downloadUrl: downloadData.download_url,
                    expiresAt: downloadData.expires_at,
                    fileSize: downloadData.file_size,
                    filename: downloadData.filename
                };
            } else if (response.statusCode === 404) {
                return {
                    success: false,
                    error: response.data?.data?.message || 'Flash image version not found'
                };
            } else if (response.statusCode === 400) {
                return {
                    success: false,
                    error: response.data?.data?.message || 'Version is required'
                };
            } else {
                throw new Error(`API returned ${response.statusCode}`);
            }
        } catch (error) {
            console.error('❌ Failed to get download URL:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if cached download URL is still valid
     */
    isDownloadUrlValid() {
        if (!this.cachedDownloadUrl || !this.downloadUrlExpiry) {
            return false;
        }
        
        const now = new Date();
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
        return now.getTime() < (this.downloadUrlExpiry.getTime() - bufferTime);
    }

    // =============================================================================
    // FIRMWARE VERSION MANAGEMENT
    // =============================================================================

    async checkForUpdates() {
        try {
            const latestResult = await this.getLatestFirmwareVersion();
            
            if (!latestResult.success) {
                return { 
                    hasUpdate: false, 
                    error: latestResult.error 
                };
            }
            
            const latest = latestResult.firmware;
            const localVersions = await this.getLocalVersions();
            const latestLocal = this.getLatestVersion(localVersions);
            
            const hasUpdate = !latestLocal || this.compareVersions(latest.version, latestLocal) > 0;
            
            return {
                hasUpdate,
                latest,
                current: latestLocal,
                localVersions
            };
        } catch (error) {
            console.error('Update check failed:', error);
            return { hasUpdate: false, error: error.message };
        }
    }

    async getLocalVersions() {
        try {
            const paths = await this.initializePaths();
            const files = await fs.readdir(paths.raw);
            const versions = [];
            
            for (const file of files) {
                if (file.endsWith('.raw')) {
                    const filePath = path.join(paths.raw, file);
                    const stats = await fs.stat(filePath);
                    
                    const version = this.extractVersionFromFilename(file);
                    
                    versions.push({
                        version: version,
                        filename: file,
                        size: stats.size,
                        modified: stats.mtime,
                        path: filePath,
                        type: 'raw'
                    });
                }
            }
            
            return versions.sort((a, b) => this.compareVersions(b.version, a.version));
        } catch (error) {
            console.error('Failed to get local versions:', error);
            return [];
        }
    }

    extractVersionFromFilename(filename) {
        // Handle FlashingApp_v1.2.3.raw pattern
        const flashingAppMatch = filename.match(/FlashingApp_(v\d+\.\d+\.\d+)/);
        if (flashingAppMatch) {
            return flashingAppMatch[1];
        }
        
        // Handle generic version patterns
        const versionMatch = filename.match(/(v\d+\.\d+\.\d+)/);
        if (versionMatch) {
            return versionMatch[1];
        }
        
        // Fallback
        return filename.replace(/\.(raw|img)$/i, '');
    }

    async getAutoSelectedFirmware() {
        try {
            const localVersions = await this.getLocalVersions();
            if (localVersions.length === 0) {
                return null;
            }
            
            const latest = localVersions[0];
            
            return {
                version: latest.version,
                filename: latest.filename,
                path: latest.path,
                size: latest.size,
                modified: latest.modified,
                sourceType: 'raw'
            };
        } catch (error) {
            console.error('Failed to get auto-selected firmware:', error);
            return null;
        }
    }

    // =============================================================================
    // DOWNLOAD & EXTRACTION
    // =============================================================================

    async downloadFirmware(version, onProgress) {
        const paths = await this.initializePaths();
        
        try {
            console.log(`🔽 Starting firmware download for ${version}`);
            
            // Get download URL
            const urlResult = await this.getDownloadUrl(version);
            if (!urlResult.success) {
                throw new Error(urlResult.error);
            }
            
            const tempZipPath = path.join(paths.temp, urlResult.filename);
            const finalRawPath = path.join(paths.raw, `FlashingApp_${version}-disk.raw`);
            
            console.log(`📥 Downloading firmware from S3...`);
            
            // Download from S3
            await this.downloadFile(urlResult.downloadUrl, tempZipPath, urlResult.fileSize, onProgress);
            
            console.log(`📦 Extracting firmware to RAW folder...`);
            await this.extractZipToRawFolder(tempZipPath, finalRawPath);
            
            // Delete the ZIP file to save space
            console.log(`🗑️ Deleting ZIP file to save space...`);
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

    async downloadFile(url, filePath, expectedSize, onProgress) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            const file = require('fs').createWriteStream(filePath);
            
            const request = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(filePath).catch(() => {});
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
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
            
            request.setTimeout(this.config.downloadTimeout, () => {
                request.destroy();
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(new Error('Download timeout'));
            });
        });
    }

    async extractZipToRawFolder(zipPath, targetRawPath) {
        try {
            console.log(`📦 Extracting ZIP to RAW folder: ${path.basename(zipPath)}`);
            
            const rawDir = path.dirname(targetRawPath);
            
            console.log(`🔍 Listing ZIP contents...`);
            const { stdout: listOutput } = await execAsync('unzip', ['-l', zipPath]);
            
            const rawFileMatch = listOutput.match(/^\s*\d+\s+[\d\-\:\s]+\s+(.+\.raw)$/m);
            if (!rawFileMatch) {
                throw new Error('No .raw firmware file found in the ZIP archive');
            }
            
            const rawFileName = rawFileMatch[1].trim();
            console.log(`📄 Found RAW firmware in ZIP: ${rawFileName}`);
            
            console.log(`📤 Extracting ${rawFileName} to RAW folder...`);
            await execAsync('unzip', ['-j', zipPath, rawFileName, '-d', rawDir]);
            
            const extractedOriginalPath = path.join(rawDir, rawFileName);
            
            try {
                await fs.access(extractedOriginalPath);
            } catch (error) {
                throw new Error(`Extracted file not found: ${extractedOriginalPath}`);
            }
            
            if (extractedOriginalPath !== targetRawPath) {
                console.log(`📝 Renaming to: ${path.basename(targetRawPath)}`);
                await fs.rename(extractedOriginalPath, targetRawPath);
            }
            
            const stats = await fs.stat(targetRawPath);
            console.log(`✅ RAW firmware ready: ${this.formatFileSize(stats.size)}`);
            
            return targetRawPath;
            
        } catch (error) {
            console.error(`❌ ZIP extraction failed: ${error.message}`);
            
            try {
                await fs.unlink(targetRawPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            throw new Error(`Firmware extraction failed: ${error.message}`);
        }
    }

    // =============================================================================
    // PRODUCTION FLASH LOGGING
    // =============================================================================

    async logFlashOperationWithSerial(devicePath, firmwareVersion, status, startTime, endTime, additionalInfo = {}) {
        try {
            const paths = await this.initializePaths();
            
            const deviceSerial = await this.getDeviceSerial(devicePath);
            const duration = endTime ? Math.round((endTime - startTime) / 1000) : 0;
            
            const logEntry = {
                timestamp: new Date().toISOString(),
                version: firmwareVersion,
                ssdId: deviceSerial,
                success: status === 'success',
                ...(status === 'failed' && additionalInfo.error && {
                    reason: additionalInfo.error
                })
            };
            
            // Log to local CSV (backup)
            await this.logToLocalCSV(logEntry, paths);
            
            // Send to production API
            try {
                await this.sendToProductionApi(logEntry);
                console.log(`📝 Flash operation logged to production: ${firmwareVersion} -> ${deviceSerial} (${status})`);
            } catch (apiError) {
                console.warn('Production API logging failed (operation continues):', apiError.message);
            }
            
            return {
                ...logEntry,
                serialNumber: deviceSerial,
                duration: duration,
                device: devicePath,
                stationId: this.config.stationId
            };
            
        } catch (error) {
            console.error('Failed to log flash operation:', error);
            throw error;
        }
    }

    async sendToProductionApi(logEntry) {
        try {
            const response = await this.makeApiRequest('/flash-logs/upload', {
                method: 'POST',
                body: logEntry,
                timeout: 10000 // 10 second timeout for logging
            });
            
            if (response.statusCode === 201) {
                const responseData = response.data;
                console.log(`✅ Flash log uploaded: ${responseData.data?.logId}`);
                return responseData;
            } else {
                throw new Error(`API returned ${response.statusCode}: ${response.data?.data?.message || 'Unknown error'}`);
            }
        } catch (error) {
            throw new Error(`Production API logging failed: ${error.message}`);
        }
    }

    async logToLocalCSV(logEntry, paths) {
        const logPath = path.join(paths.logs, 'flash_operations.csv');
        
        try {
            await fs.access(logPath);
        } catch (error) {
            const header = 'timestamp,version,ssdId,success,reason\n';
            await fs.writeFile(logPath, header);
        }
        
        const csvLine = [
            logEntry.timestamp,
            logEntry.version,
            logEntry.ssdId,
            logEntry.success,
            logEntry.reason || ''
        ].join(',') + '\n';
        
        await fs.appendFile(logPath, csvLine);
    }

    // =============================================================================
    // STORAGE MANAGEMENT
    // =============================================================================

    async manageStorageLimit() {
        try {
            const firmwareFiles = await this.getLocalVersions();
            
            if (firmwareFiles.length > this.config.maxStoredVersions) {
                const toDelete = firmwareFiles.slice(this.config.maxStoredVersions);
                
                for (const firmware of toDelete) {
                    try {
                        await fs.unlink(firmware.path);
                        console.log(`🗑️ Deleted old firmware: ${firmware.version} (${this.formatFileSize(firmware.size)} freed)`);
                    } catch (error) {
                        console.error(`Failed to delete ${firmware.version}:`, error);
                    }
                }
            }
            
            await this.cleanupTempFiles();
            
        } catch (error) {
            console.error('Storage management failed:', error);
        }
    }

    async cleanupTempFiles() {
        const paths = await this.initializePaths();
        
        try {
            const tempFiles = await fs.readdir(paths.temp);
            const now = Date.now();
            
            for (const file of tempFiles) {
                const filePath = path.join(paths.temp, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > this.config.tempFileMaxAge) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Cleaned up old temp file: ${file}`);
                }
            }
        } catch (error) {
            console.error('Temp file cleanup failed:', error);
        }
    }

    // =============================================================================
    // DEVICE SERIAL DETECTION
    // =============================================================================

    async getDeviceSerial(devicePath) {
        try {
            console.log(`🔍 Getting serial number for device: ${devicePath}`);

            const baseDevicePath = this.getBaseDevicePath(devicePath);
            const partition3Path = this.getPartition3Path(baseDevicePath);

            const serialAttempts = [
                () => this.trySmartctlSerial(partition3Path),
                () => this.trySmartctlSerial(this.getPartition1Path(baseDevicePath)),
                () => this.trySmartctlSerial(this.getPartition2Path(baseDevicePath)),
                () => this.trySmartctlSerial(baseDevicePath),
                () => this.trySerialFromDiskById(baseDevicePath),
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
                    console.log(`⚠️ Serial attempt failed: ${error.message}`);
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

    getBaseDevicePath(devicePath) {
        if (devicePath.match(/\/dev\/sd[a-z]\d+$/)) {
            return devicePath.replace(/\d+$/, '');
        }
        if (devicePath.match(/\/dev\/nvme\d+n\d+p\d+$/)) {
            return devicePath.replace(/p\d+$/, '');
        }
        if (devicePath.match(/\/dev\/mmcblk\d+p\d+$/)) {
            return devicePath.replace(/p\d+$/, '');
        }
        return devicePath;
    }

    getPartition3Path(baseDevicePath) {
        if (baseDevicePath.match(/\/dev\/sd[a-z]$/)) {
            return baseDevicePath + '3';
        }
        if (baseDevicePath.match(/\/dev\/nvme\d+n\d+$/)) {
            return baseDevicePath + 'p3';
        }
        if (baseDevicePath.match(/\/dev\/mmcblk\d+$/)) {
            return baseDevicePath + 'p3';
        }
        return baseDevicePath + '3';
    }

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

    async trySerialFromDiskById(devicePath) {
        try {
            const { stdout } = await execAsync('ls', ['-la', '/dev/disk/by-id/']);
            const deviceName = path.basename(devicePath);
            
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes(`-> ../../${deviceName}`) || line.includes(`-> ../..${devicePath}`)) {
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

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

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

    getLatestVersion(versions) {
        return versions.length > 0 ? versions[0].version : null;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(1)} B/s`;
        if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    async exportFlashLog(format = 'csv') {
        try {
            const paths = await this.initializePaths();
            const logPath = path.join(paths.logs, 'flash_operations.csv');
            
            const logData = await fs.readFile(logPath, 'utf-8');
            
            if (format === 'json') {
                const lines = logData.trim().split('\n');
                const headers = lines[0].split(',');
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
}

module.exports = { FileManager };