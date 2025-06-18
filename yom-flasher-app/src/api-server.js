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

// Real ZIP file configuration - ONLY look for existing ZIP
const REAL_FIRMWARE_ZIP = path.join(os.homedir(), 'Documents', 'yom-node-os-P1-disk.zip');

// Check if real ZIP file exists and get its size
let realZipExists = false;
let realZipSize = 0;
let realZipChecksum = 'sha256:skip_verification'; // Skip checksum for real file testing

try {
    const stats = fs.statSync(REAL_FIRMWARE_ZIP);
    realZipExists = true;
    realZipSize = stats.size;
    console.log(`✅ Real firmware ZIP found: ${REAL_FIRMWARE_ZIP}`);
    console.log(`📦 ZIP file size: ${(realZipSize / (1024**3)).toFixed(2)} GB`);
    
} catch (error) {
    console.log(`⚠️  Real firmware ZIP not found at: ${REAL_FIRMWARE_ZIP}`);
    console.log('📝 Will use mock data instead');
}

// Enhanced firmware versions with ZIP-ONLY support
const FIRMWARE_VERSIONS = [
    {
        version: "v1.2.1",
        release_date: "2024-05-15",
        file_size: 25769803776, // ~24GB (mock - this would be zip size)
        checksum: "sha256:abc123def456",
        description: "Stable release with performance improvements",
        filename: "FlashingApp_v1.2.1.zip", // Always ZIP
        type: "mock"
    },
    {
        version: "v1.2.2", 
        release_date: "2024-06-01",
        file_size: 25869803776,
        checksum: "sha256:def456ghi789", 
        description: "Security updates and bug fixes",
        filename: "FlashingApp_v1.2.2.zip", // Always ZIP
        type: "mock"
    },
    {
        version: "v1.2.3",
        release_date: "2024-06-15", 
        file_size: realZipExists ? realZipSize : 25969803776, // Use actual zip size
        checksum: realZipExists ? realZipChecksum : "sha256:ghi789jkl012",
        description: realZipExists ? "Latest firmware with real ZIP data from yom-node-os-P1-disk.zip" : "Latest firmware with new features",
        filename: "FlashingApp_v1.2.3.zip", // Always ZIP
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
        type: 'zip', // Always ZIP
        format: 'zip' // Explicit format indicator
    });
});

// Enhanced file download - serves ZIP files only
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
            res.status(500).json({ error: 'Failed to stream ZIP file' });
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
        // Serve mock ZIP data
        console.log(`API: Creating mock ZIP file for ${firmware.filename}`);
        
        const zip = new AdmZip();
        
        // Create mock firmware content (smaller for testing)
        const mockRawSize = 10 * 1024 * 1024; // 10MB mock raw file
        const mockRawData = Buffer.alloc(mockRawSize, 0);
        
        // Add mock raw file to zip with correct naming
        const rawFileName = firmware.filename.replace('.zip', '.raw');
        zip.addFile(rawFileName, mockRawData, 'Mock firmware raw image file');
        
        const zipBuffer = zip.toBuffer();
        
        res.setHeader('Content-Length', zipBuffer.length);
        console.log(`📦 Mock ZIP file created: ${(zipBuffer.length / (1024**2)).toFixed(1)} MB`);
        console.log(`📄 Contains: ${rawFileName} (${(mockRawSize / (1024**2)).toFixed(1)} MB raw)`);
        
        // Stream the zip buffer
        res.end(zipBuffer);
        console.log('✅ Finished streaming mock ZIP file');
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

app.listen(PORT, () => {
    console.log(`\n🚀 YOM Flash Tool API Server running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
    console.log(`⚡ Latest version: http://localhost:${PORT}/api/flash-images/latest`);
    console.log(`🧪 Test real file: http://localhost:${PORT}/api/test-real-file`);
    
    console.log(`\n📦 ZIP-ONLY MODE ENABLED`);
    console.log(`✅ All firmware served as ZIP files only`);
    
    if (realZipExists) {
        console.log(`\n✅ Real firmware ZIP detected:`);
        console.log(`   📁 ZIP file: ${REAL_FIRMWARE_ZIP}`);
        console.log(`   📦 ZIP size: ${(realZipSize / (1024**3)).toFixed(2)} GB`);
        console.log(`   🎯 Will be served as v1.2.3 ZIP file`);
    } else {
        console.log(`\n⚠️  Real firmware ZIP not found:`);
        console.log(`   📁 Expected: ${REAL_FIRMWARE_ZIP}`);
        console.log(`   💡 Using mock ZIP data for all versions`);
    }
    
    console.log('\n💡 Start your Electron app and it will automatically connect to this ZIP-only API server.');
    console.log('📁 Downloaded ZIP files will be stored in: artifacts/RAW/');
    console.log('📄 Extracted RAW files will be in: artifacts/Temp/\n');
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