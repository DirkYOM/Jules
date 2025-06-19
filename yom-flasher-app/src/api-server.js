const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Real YOM ZIP file configuration - YOM naming convention
const REAL_FIRMWARE_ZIP = path.join(os.homedir(), 'Documents', 'yom-node-os-P1-disk.zip');

// Check if real ZIP file exists and get its size
let realZipExists = false;
let realZipSize = 0;
let realZipChecksum = 'sha256:skip_verification'; // Skip checksum for real file testing

try {
    const stats = fs.statSync(REAL_FIRMWARE_ZIP);
    realZipExists = true;
    realZipSize = stats.size;
    console.log(`✅ Real YOM firmware ZIP found: ${REAL_FIRMWARE_ZIP}`);
    console.log(`📦 ZIP file size: ${(realZipSize / (1024**3)).toFixed(2)} GB`);
    
} catch (error) {
    console.log(`⚠️  Real YOM firmware ZIP not found at: ${REAL_FIRMWARE_ZIP}`);
    console.log('📝 Will use valid mock data with YOM naming instead');
}

// YOM Firmware versions with proper naming convention
const FIRMWARE_VERSIONS = [
    {
        version: "P0.9",
        release_date: "2024-05-15",
        file_size: 104857600, // 100MB mock
        checksum: "sha256:abc123def456",
        description: "Beta release for testing",
        filename: "yom-node-os-P0.9-disk.zip",
        type: "mock"
    },
    {
        version: "P0.95", 
        release_date: "2024-06-01",
        file_size: 104857600, // 100MB mock
        checksum: "sha256:def456ghi789", 
        description: "Release candidate with bug fixes",
        filename: "yom-node-os-P0.95-disk.zip",
        type: "mock"
    },
    {
        version: "P1",
        release_date: "2024-06-15", 
        file_size: realZipExists ? realZipSize : 104857600, // Use actual zip size or 100MB mock
        checksum: realZipExists ? realZipChecksum : "sha256:ghi789jkl012",
        description: realZipExists ? "Production release P1 with real firmware data" : "Production release P1 with valid mock firmware",
        filename: "yom-node-os-P1-disk.zip",
        type: realZipExists ? "real" : "mock",
        realZipPath: realZipExists ? REAL_FIRMWARE_ZIP : null
    }
];

// Get latest version
app.get('/api/flash-images/latest', (req, res) => {
    const latest = FIRMWARE_VERSIONS[FIRMWARE_VERSIONS.length - 1];
    console.log('API: Serving latest version:', latest.version, `(${latest.type}) - ZIP format`);
    res.json(latest);
});

// Get all versions
app.get('/api/flash-images/versions', (req, res) => {
    console.log('API: Serving all versions - all ZIP format');
    res.json(FIRMWARE_VERSIONS);
});

// Generate download URL
app.post('/api/flash-images/download', (req, res) => {
    const { version } = req.body;
    console.log('API: Download requested for version:', version);
    
    if (!version) {
        return res.status(400).json({ error: 'Version is required' });
    }
    
    const firmware = FIRMWARE_VERSIONS.find(f => f.version === version);
    if (!firmware) {
        return res.status(404).json({ error: 'Version not found' });
    }
    
    // Validate that we only serve ZIP files
    if (!firmware.filename.endsWith('.zip')) {
        return res.status(400).json({ error: 'Only ZIP files are supported' });
    }
    
    // Generate download URL
    const downloadUrl = `http://localhost:${PORT}/api/flash-images/file/${version}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    
    res.json({
        download_url: downloadUrl,
        expires_at: expiresAt.toISOString(),
        file_size: firmware.file_size,
        checksum: firmware.checksum,
        filename: firmware.filename,
        type: 'zip',
        format: 'zip'
    });
});

// FIXED: Enhanced file download - serves valid ZIP files only
app.get('/api/flash-images/file/:version', (req, res) => {
    const { version } = req.params;
    console.log('API: ZIP file download requested for version:', version);
    
    const firmware = FIRMWARE_VERSIONS.find(f => f.version === version);
    if (!firmware) {
        return res.status(404).json({ error: 'Version not found' });
    }
    
    // Validate ZIP format
    if (!firmware.filename.endsWith('.zip')) {
        return res.status(400).json({ error: 'Only ZIP files are served' });
    }
    
    // Set common headers for ZIP download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${firmware.filename}"`);
    
    if (firmware.type === 'real' && firmware.realZipPath) {
        // Serve real ZIP file
        console.log(`API: Streaming real ZIP file: ${firmware.realZipPath}`);
        console.log(`📦 Real ZIP file size: ${(firmware.file_size / (1024**2)).toFixed(1)} MB`);
        
        res.setHeader('Content-Length', firmware.file_size);
        
        const fileStream = fs.createReadStream(firmware.realZipPath);
        
        fileStream.on('error', (error) => {
            console.error('Error streaming real ZIP file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream ZIP file' });
            }
        });
        
        fileStream.on('open', () => {
            console.log('📡 Started streaming real ZIP file...');
        });
        
        fileStream.on('end', () => {
            console.log('✅ Finished streaming real ZIP file');
        });
        
        // Add progress logging for large files
        let streamedBytes = 0;
        fileStream.on('data', (chunk) => {
            streamedBytes += chunk.length;
            const progress = ((streamedBytes / firmware.file_size) * 100).toFixed(1);
            
            // Log progress every 10%
            if (streamedBytes % Math.floor(firmware.file_size / 10) < chunk.length) {
                console.log(`📡 ZIP streaming progress: ${progress}% (${(streamedBytes / (1024**2)).toFixed(1)} MB)`);
            }
        });
        
        fileStream.pipe(res);
        
    } else {
        // FIXED: Create a proper valid mock ZIP file
        console.log(`API: Creating valid mock ZIP file for ${firmware.filename}`);
        
        try {
            const zip = new AdmZip();
            
            // Create realistic mock firmware content (100MB for testing)
            const mockRawSize = 100 * 1024 * 1024; // 100MB
            console.log(`📦 Creating ${(mockRawSize / (1024**2)).toFixed(1)} MB mock firmware...`);
            
            // Create mock raw data with realistic pattern
            const mockRawData = Buffer.alloc(mockRawSize);
            
            // Fill with repeating pattern to simulate firmware structure
            const pattern = Buffer.from('YOM_FIRMWARE_DATA_BLOCK_');
            for (let i = 0; i < mockRawSize; i += pattern.length) {
                const remainingBytes = Math.min(pattern.length, mockRawSize - i);
                pattern.copy(mockRawData, i, 0, remainingBytes);
            }
            
            // Add some variation to make it more realistic
            for (let i = 0; i < mockRawSize; i += 4096) {
                const blockNum = Math.floor(i / 4096);
                const blockHeader = Buffer.from(`BLOCK_${blockNum.toString().padStart(8, '0')}_`);
                blockHeader.copy(mockRawData, i, 0, Math.min(blockHeader.length, mockRawSize - i));
            }
            
            // Add the raw file to zip with YOM naming convention
            zip.addFile('yom-node-os-P1-disk.raw', mockRawData, 'YOM firmware image file for P1 version');
            
            // Generate the ZIP buffer
            const zipBuffer = zip.toBuffer();
            
            if (!zipBuffer || zipBuffer.length === 0) {
                throw new Error('Failed to generate ZIP buffer');
            }
            
            res.setHeader('Content-Length', zipBuffer.length);
            console.log(`📦 Valid mock ZIP created: ${(zipBuffer.length / (1024**2)).toFixed(1)} MB`);
            console.log(`📄 Contains: yom-node-os-P1-disk.raw (${(mockRawSize / (1024**2)).toFixed(1)} MB raw data)`);
            
            // Send the ZIP buffer
            res.send(zipBuffer);
            console.log('✅ Mock ZIP file streamed successfully');
            
        } catch (zipError) {
            console.error('❌ Failed to create mock ZIP:', zipError);
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: 'Failed to create ZIP file',
                    details: zipError.message 
                });
            }
        }
    }
});

// Health check with enhanced info
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        versions: FIRMWARE_VERSIONS.length,
        format: 'ZIP-ONLY',
        realZipAvailable: realZipExists,
        realZipPath: realZipExists ? REAL_FIRMWARE_ZIP : null,
        realZipSize: realZipExists ? `${(realZipSize / (1024**3)).toFixed(2)} GB` : 'N/A'
    });
});

// Test endpoint to verify real ZIP file access
app.get('/api/test-real-file', (req, res) => {
    if (!realZipExists) {
        return res.status(404).json({ 
            error: 'Real ZIP file not found',
            expectedPath: REAL_FIRMWARE_ZIP,
            suggestion: 'Place yom-node-os-P1-disk.zip in ~/Documents/ directory'
        });
    }
    
    // Test ZIP file integrity
    try {
        const zip = new AdmZip(REAL_FIRMWARE_ZIP);
        const entries = zip.getEntries();
        
        res.json({
            success: true,
            zipPath: REAL_FIRMWARE_ZIP,
            zipSize: realZipSize,
            zipSizeFormatted: `${(realZipSize / (1024**3)).toFixed(2)} GB`,
            zipEntries: entries.length,
            zipContents: entries.map(entry => ({
                name: entry.entryName,
                size: entry.header.size,
                compressedSize: entry.header.compressedSize
            }))
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to read ZIP file',
            message: error.message
        });
    }
});

// SILENT API LOGGING ENDPOINT
app.post('/api/flash-log', (req, res) => {
    try {
        const { timestamp, firmware, serialNumber, status, stationId, duration, device } = req.body;
        
        // Validate required fields
        if (!timestamp || !firmware || !serialNumber || !status) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                details: 'timestamp, firmware, serialNumber, and status are required'
            });
        }
        
        // Validate status value
        if (!['success', 'failed'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status value',
                details: 'status must be either "success" or "failed"'
            });
        }
        
        // Create log entry
        const logEntry = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp,
            firmware,
            serialNumber,
            status,
            stationId: stationId || 'unknown',
            duration: duration || 0,
            device: device || 'unknown',
            receivedAt: new Date().toISOString()
        };
        
        // Log to console (in production, you'd save to database)
        console.log(`📝 FLASH LOG: ${status.toUpperCase()} - ${firmware} → ${serialNumber} (${stationId}) [${duration}s]`);
        
        res.json({
            success: true,
            message: 'Flash operation logged successfully',
            logId: logEntry.id,
            timestamp: logEntry.receivedAt
        });
        
    } catch (error) {
        console.error('Flash log error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 YOM Flash Tool API Server running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
    console.log(`⚡ Latest version: http://localhost:${PORT}/api/flash-images/latest`);
    console.log(`🧪 Test real file: http://localhost:${PORT}/api/test-real-file`);
    console.log(`📝 Flash logging: http://localhost:${PORT}/api/flash-log`);
    
    console.log(`\n📦 ZIP-ONLY MODE ENABLED`);
    console.log(`✅ All firmware served as valid ZIP files`);
    
    if (realZipExists) {
        console.log(`\n✅ Real YOM firmware ZIP detected:`);
        console.log(`   📁 YOM ZIP file: ${REAL_FIRMWARE_ZIP}`);
        console.log(`   📦 ZIP size: ${(realZipSize / (1024**3)).toFixed(2)} GB`);
        console.log(`   🎯 Will be served as P1 firmware ZIP file`);
    } else {
        console.log(`\n⚠️  Real YOM firmware ZIP not found:`);
        console.log(`   📁 Expected: ${REAL_FIRMWARE_ZIP}`);
        console.log(`   💡 Using valid mock YOM ZIP data (100MB) for all versions`);
    }
    
    console.log('\n💡 Start your Electron app and it will automatically connect to this API server.');
    console.log('📁 Downloaded ZIP files will be extracted to: artifacts/RAW/');
    console.log('📄 Flash logs will be received and displayed in console.\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down API server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down API server...');
    process.exit(0);
});