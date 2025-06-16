const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Real file configuration
const REAL_FIRMWARE_FILE = path.join(os.homedir(), 'Documents', 'yom-node-os-P1-disk.raw');

// Check if real file exists and get its size
let realFileExists = false;
let realFileSize = 0;
let realFileChecksum = 'sha256:skip_verification'; // Skip checksum for real file testing

try {
    const stats = fs.statSync(REAL_FIRMWARE_FILE);
    realFileExists = true;
    realFileSize = stats.size;
    console.log(`✅ Real firmware file found: ${REAL_FIRMWARE_FILE}`);
    console.log(`📊 File size: ${(realFileSize / (1024**3)).toFixed(2)} GB`);
    
    // Generate actual checksum for real file (optional, for production use)
    // const crypto = require('crypto');
    // const hash = crypto.createHash('sha256');
    // const fileBuffer = fs.readFileSync(REAL_FIRMWARE_FILE);
    // realFileChecksum = `sha256:${hash.update(fileBuffer).digest('hex')}`;
    
} catch (error) {
    console.log(`⚠️  Real firmware file not found at: ${REAL_FIRMWARE_FILE}`);
    console.log('📝 Will use mock data instead');
}

// Enhanced firmware versions with real file support
const FIRMWARE_VERSIONS = [
    {
        version: "v1.2.1",
        release_date: "2024-05-15",
        file_size: 25769803776, // ~24GB (mock)
        checksum: "sha256:abc123def456",
        description: "Stable release with performance improvements",
        filename: "FlashingApp_v1.2.1.img",
        type: "mock"
    },
    {
        version: "v1.2.2", 
        release_date: "2024-06-01",
        file_size: 25869803776,
        checksum: "sha256:def456ghi789", 
        description: "Security updates and bug fixes",
        filename: "FlashingApp_v1.2.2.img",
        type: "mock"
    },
    {
        version: "v1.2.3",
        release_date: "2024-06-15", 
        file_size: realFileExists ? realFileSize : 25969803776,
        checksum: realFileExists ? realFileChecksum : "sha256:ghi789jkl012",
        description: realFileExists ? "Latest firmware with real test data from yom-node-os-P1-disk.raw" : "Latest firmware with new features",
        filename: realFileExists ? "FlashingApp_v1.2.3.raw" : "FlashingApp_v1.2.3.img",
        type: realFileExists ? "real" : "mock",
        realFilePath: realFileExists ? REAL_FIRMWARE_FILE : null
    }
];

// Get latest version
app.get('/api/flash-images/latest', (req, res) => {
    const latest = FIRMWARE_VERSIONS[FIRMWARE_VERSIONS.length - 1];
    console.log('API: Serving latest version:', latest.version, `(${latest.type})`);
    res.json(latest);
});

// Get all versions
app.get('/api/flash-images/versions', (req, res) => {
    console.log('API: Serving all versions');
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
    
    // Generate download URL
    const downloadUrl = `http://localhost:${PORT}/api/flash-images/file/${version}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    
    res.json({
        download_url: downloadUrl,
        expires_at: expiresAt.toISOString(),
        file_size: firmware.file_size,
        checksum: firmware.checksum,
        filename: firmware.filename,
        type: firmware.type
    });
});

// Enhanced file download - serves real file or mock data
app.get('/api/flash-images/file/:version', (req, res) => {
    const { version } = req.params;
    console.log('API: File download requested for version:', version);
    
    const firmware = FIRMWARE_VERSIONS.find(f => f.version === version);
    if (!firmware) {
        return res.status(404).json({ error: 'Version not found' });
    }
    
    // Set common headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${firmware.filename}"`);
    
    if (firmware.type === 'real' && firmware.realFilePath) {
        // Serve real file
        console.log(`API: Streaming real file: ${firmware.realFilePath}`);
        console.log(`📊 Real file size: ${(firmware.file_size / (1024**2)).toFixed(1)} MB`);
        
        res.setHeader('Content-Length', firmware.file_size);
        
        const fileStream = fs.createReadStream(firmware.realFilePath);
        
        fileStream.on('error', (error) => {
            console.error('Error streaming real file:', error);
            res.status(500).json({ error: 'Failed to stream file' });
        });
        
        fileStream.on('open', () => {
            console.log('📡 Started streaming real file...');
        });
        
        fileStream.on('end', () => {
            console.log('✅ Finished streaming real file');
        });
        
        // Add progress logging for large files
        let streamedBytes = 0;
        fileStream.on('data', (chunk) => {
            streamedBytes += chunk.length;
            const progress = ((streamedBytes / firmware.file_size) * 100).toFixed(1);
            
            // Log progress every 10%
            if (streamedBytes % Math.floor(firmware.file_size / 10) < chunk.length) {
                console.log(`📡 Streaming progress: ${progress}% (${(streamedBytes / (1024**2)).toFixed(1)} MB)`);
            }
        });
        
        fileStream.pipe(res);
        
    } else {
        // Serve mock data (original logic)
        const mockSize = 10 * 1024 * 1024; // 10MB for testing
        const mockData = Buffer.alloc(mockSize, 0);
        
        res.setHeader('Content-Length', mockSize);
        console.log(`API: Streaming mock file of ${(mockSize / (1024**2)).toFixed(1)} MB`);
        
        // Simulate streaming with delays for progress testing
        let sent = 0;
        const chunkSize = 64 * 1024; // 64KB chunks
        
        const sendChunk = () => {
            if (sent >= mockSize) {
                console.log('✅ Finished streaming mock file');
                res.end();
                return;
            }
            
            const remainingSize = Math.min(chunkSize, mockSize - sent);
            const chunk = mockData.slice(sent, sent + remainingSize);
            
            res.write(chunk);
            sent += remainingSize;
            
            // Log progress
            const progress = ((sent / mockSize) * 100).toFixed(1);
            if (sent % (1024 * 1024) < chunkSize) { // Log every MB
                console.log(`📡 Mock streaming progress: ${progress}%`);
            }
            
            // Add small delay to simulate real download speed
            setTimeout(sendChunk, 50);
        };
        
        sendChunk();
    }
});

// Health check with enhanced info
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        versions: FIRMWARE_VERSIONS.length,
        realFileAvailable: realFileExists,
        realFilePath: realFileExists ? REAL_FIRMWARE_FILE : null,
        realFileSize: realFileExists ? `${(realFileSize / (1024**3)).toFixed(2)} GB` : 'N/A'
    });
});

// Test endpoint to verify real file access
app.get('/api/test-real-file', (req, res) => {
    if (!realFileExists) {
        return res.status(404).json({ 
            error: 'Real file not found',
            expectedPath: REAL_FIRMWARE_FILE,
            suggestion: 'Place yom-node-os-P1-disk.raw in ~/Documents/ directory'
        });
    }
    
    // Read first 1KB to test access
    const stream = fs.createReadStream(REAL_FIRMWARE_FILE, { start: 0, end: 1023 });
    let testData = Buffer.alloc(0);
    
    stream.on('data', (chunk) => {
        testData = Buffer.concat([testData, chunk]);
    });
    
    stream.on('end', () => {
        res.json({
            success: true,
            filePath: REAL_FIRMWARE_FILE,
            fileSize: realFileSize,
            fileSizeFormatted: `${(realFileSize / (1024**3)).toFixed(2)} GB`,
            testDataLength: testData.length,
            firstBytes: testData.slice(0, 16).toString('hex')
        });
    });
    
    stream.on('error', (error) => {
        res.status(500).json({
            error: 'Failed to read real file',
            message: error.message
        });
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 YOM Flash Tool API Server running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
    console.log(`⚡ Latest version: http://localhost:${PORT}/api/flash-images/latest`);
    console.log(`🧪 Test real file: http://localhost:${PORT}/api/test-real-file`);
    
    if (realFileExists) {
        console.log(`\n✅ Real firmware file detected:`);
        console.log(`   📁 Path: ${REAL_FIRMWARE_FILE}`);
        console.log(`   📊 Size: ${(realFileSize / (1024**3)).toFixed(2)} GB`);
        console.log(`   🎯 Will be served as v1.2.3 (latest version)`);
    } else {
        console.log(`\n⚠️  Real firmware file not found:`);
        console.log(`   📁 Expected: ${REAL_FIRMWARE_FILE}`);
        console.log(`   💡 Using mock data for all versions`);
    }
    
    console.log('\n💡 Start your Electron app and it will automatically connect to this API server.');
    console.log('📁 Downloaded firmware will be stored in: artifacts/RAW/\n');
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