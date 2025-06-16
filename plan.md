# YOM Flash Tool - Automated Update Management Plan

## Epic Overview
Implement a fully automated update management system that eliminates manual firmware selection by automatically downloading and selecting the latest firmware version, providing a streamlined and error-free flashing experience.

## New Flow Architecture

```
App Start → Password → Auto Check Updates → Show Download Button (if available) → 
Manual Download → Auto Select Latest → Confirm Screen → Device Selection → Flash → 
Log with Serial → Safe Eject → "Flash Another?" Option
```

## Components Required

### 1. Backend API Services
- **Version Check Endpoint**: Returns latest available version metadata
- **Download URL Provider**: Generates secure, time-limited download URLs  
- **File Storage**: AWS S3 or similar for hosting large firmware images

### 2. Frontend Application Updates
- **Automated Update Checker**: Handles version comparison silently on startup with polling
- **Manual Download Manager**: Downloads latest version when user clicks download button
- **Version Control System**: Prevents flashing older versions than currently installed
- **File Manager**: Handles local storage, cleanup, and organization automatically
- **Enhanced Logging System**: Tracks flash operations with device serial numbers and firmware versions
- **Streamlined UI**: Confirmation screen with auto-selected firmware display
- **Continuous Operation**: "Flash Another" workflow for batch operations

### 3. System Integration
- **smartctl Integration**: For retrieving device serial numbers
- **File System Management**: For organizing downloaded images automatically
- **Error Handling**: Comprehensive error management and recovery

---

## Implementation Plan

### Phase 1: Backend API Development

#### Step 1.1: Create Version Management API
```
Endpoint: GET /api/flash-images/latest
Response: {
  "version": "v1.2.3",
  "release_date": "2024-06-15",
  "file_size": 25769803776,
  "checksum": "sha256:abc123...",
  "description": "Latest firmware with security updates",
  "mandatory": true
}
```

#### Step 1.2: Create Download URL Generator
```
Endpoint: POST /api/flash-images/download  
Request: { "version": "v1.2.3" }
Response: {
  "download_url": "https://signed-url-with-expiry",
  "expires_at": "2024-06-16T18:00:00Z",
  "file_size": 25769803776,
  "checksum": "sha256:abc123..."
}
```

#### Step 1.3: Configure File Storage
- Set up AWS S3 bucket with versioned firmware images
- Configure signed URL generation with 2-hour expiry
- Implement file integrity verification

---

### Phase 2: Automated Frontend Services

#### Step 2.1: Automated Update Checker with Polling
```javascript
class AutoUpdateChecker {
  constructor() {
    this.pollingInterval = 5 * 60 * 1000; // 5 minutes
    this.currentVersion = null;
  }

  async checkForUpdates() {
    // Compare local versions with API response
    // Return update availability status
    // Prevent downgrade to older versions
  }
  
  startPolling() {
    // Continuously check for updates every 5 minutes
    // Update UI if new version becomes available
  }
  
  async getLatestLocalVersion() {
    // Scan recommended/ directory
    // Return newest version info
  }
  
  async preventDowngrade(selectedVersion) {
    // Check if selected version is newer than last flashed
    // Return true/false for version compatibility
  }
}
```

#### Step 2.2: Manual Download Manager Service
```javascript
class ManualDownloadManager {
  async downloadLatestImage(onProgress) {
    // Request download URL from API
    // Handle chunked download with progress callback
    // Verify file integrity automatically
    // Clean up old versions (keep max 3)
    // Return download success/failure
  }
  
  async validateDownload(filePath, checksum) {
    // Verify file integrity
    // Handle corrupted downloads
  }
  
  isDownloadInProgress() {
    // Return current download status
  }
}
```

#### Step 2.3: Automated File Manager Service
```javascript
class AutoFileManager {
  async organizeFiles() {
    // Maintain 3-file limit automatically
    // Delete oldest when adding new
    // Handle file movements safely
  }
  
  async getSelectedFirmware() {
    // Return path and info of auto-selected firmware
  }
}
```

---

### Phase 3: Streamlined User Interface

#### Step 3.1: Startup Confirmation Screen
- **Auto Update Status**: Show update check/download progress
- **Selected Firmware Display**: Show name and version of auto-selected firmware
- **Confirmation Button**: "Continue with [version]" to proceed to device selection
- **Background Processing**: All update logic happens automatically

#### Step 3.2: Updated Main Screen Structure
```
┌─────────────────────────────────────┐
│ YOM Flash Tool                      │
├─────────────────────────────────────┤
│ 🔄 Checking for updates...          │
│                                     │
│ Current: FlashingApp_v1.2.2.img     │
│ Available: FlashingApp_v1.2.3.img   │
│                                     │
│ [⬇️ Download v1.2.3] [Status: Ready]│
│                                     │
│ Selected: FlashingApp_v1.2.3.img    │
│ Size: 24.0 GB                       │
│ Released: June 15, 2024             │
│                                     │
│ [Continue to Device Selection]      │
│                                     │
│ [Export Log] [Settings]             │
└─────────────────────────────────────┘
```

#### Step 3.3: Enhanced Flash Completion Flow
```
┌─────────────────────────────────────┐
│ ✅ Flash Completed Successfully     │
├─────────────────────────────────────┤
│ Device: /dev/sdb                    │
│ Serial: ABC123XYZ789                │
│ Firmware: FlashingApp_v1.2.3        │
│ Duration: 00:05:23                  │
│                                     │
│ [✅ Logged] [💾 Safe Eject]         │
│                                     │
│ [🔄 Flash Another Device]           │
│ [🏠 Return to Main Menu]            │
└─────────────────────────────────────┘
```

#### Step 3.3: Legacy Manual Selection (Commented Out)
- Keep existing drag-and-drop functionality commented in code
- Keep file selection dialog commented in code  
- Maintain for potential future manual override feature

---

### Phase 4: Enhanced Logging System

#### Step 4.1: smartctl Integration
```javascript
class SerialNumberService {
  async getDeviceSerial(devicePath) {
    // Execute smartctl command
    // Parse serial number from output
    // Handle errors gracefully
    // Return device serial or null
  }
}
```

#### Step 4.2: Enhanced Flash Logging with Serial Numbers
```javascript
class EnhancedFlashLogger {
  async logFlashOperation(devicePath, firmwareVersion, status, startTime, endTime) {
    // Get device serial number using smartctl
    const deviceSerial = await this.getDeviceSerial(devicePath);
    
    // Calculate duration
    const duration = endTime - startTime;
    
    // Create log entry: {TimeStamp} {Name_version} {serial number}
    const logEntry = {
      timestamp: new Date().toISOString(),
      firmware: firmwareVersion, // e.g., "FlashingApp_v1.2.3"
      serialNumber: deviceSerial || 'UNKNOWN',
      status: status,
      duration: Math.round(duration / 1000) // seconds
    };
    
    // Append to CSV: timestamp,firmware,serial,status,duration
    await this.appendToLog(logEntry);
    return logEntry;
  }
  
  async getDeviceSerial(devicePath) {
    // Execute smartctl to get device serial
    // Return serial number or null if failed
  }
  
  async exportLog(format = 'csv') {
    // Generate exportable log file
    // Format: timestamp,firmware,serial,status,duration
  }
}
```

---

### Phase 5: Error Handling and Recovery

#### Step 5.1: Network Error Handling
- **Retry Mechanisms**: Automatic retry for failed API calls
- **Offline Graceful Degradation**: Use last downloaded version if offline
- **User-Friendly Messages**: Clear status updates during process

#### Step 5.2: Download Error Handling
- **Resume Interrupted Downloads**: Continue partial downloads
- **Corruption Recovery**: Re-download corrupted files automatically
- **Disk Space Validation**: Check available space before download

#### Step 5.3: Fallback Mechanisms
- **Previous Version Fallback**: Use previous working version if latest fails
- **Manual Override**: Hidden developer mode for manual file selection
- **Emergency Recovery**: Reset to factory firmware selection

---

### Phase 6: Integration and Testing

#### Step 6.1: Automated Flow Testing
- End-to-end automated update workflow
- Network failure recovery testing
- Disk space limitation testing
- Firmware corruption handling

#### Step 6.2: Performance Optimization
- Background download performance
- Startup time optimization
- Memory usage during large downloads
- Storage cleanup efficiency

#### Step 6.3: User Experience Testing
- Manufacturer workflow validation
- Error message clarity
- Recovery process effectiveness
- Documentation and training materials

---

## Technical Specifications

### File Structure
```
[userData]/
├── recommended/
│   ├── FlashingApp_v1.2.1.img
│   ├── FlashingApp_v1.2.2.img
│   └── FlashingApp_v1.2.3.img        # Auto-selected latest
├── temp/
│   └── download_staging/
│       └── partial_downloads/
└── logs/
    ├── flash_operations.csv
    ├── download_history.csv
    └── app_errors.log
```

### Configuration
```json
{
  "api_base_url": "https://api.yourcompany.com",
  "auto_update_check": true,
  "manual_download": true,
  "polling_interval": 300000,
  "prevent_downgrade": true,
  "max_stored_versions": 3,
  "download_timeout": 3600,
  "startup_check_timeout": 30,
  "recommended_path": "[userData]/recommended/",
  "batch_mode": true
}
```

### Updated Application Flow
```
1. App Launch
2. Password Authentication
3. Auto Update Check (with polling every 5 minutes)
   ├── If newer version available
   │   ├── Show "Download v1.2.3" button
   │   ├── User clicks download
   │   ├── Download with progress
   │   ├── Verify integrity
   │   └── Clean old versions
   └── If no update needed
       └── Use existing latest
4. Display Confirmation Screen
   ├── Show selected firmware info
   ├── Version downgrade prevention
   ├── "Continue" button
   └── Secondary actions (Export Log, Settings)
5. Device Selection (existing flow)
6. Flash Process (existing flow)
7. Enhanced Completion Flow
   ├── Get device serial with smartctl
   ├── Log: {timestamp} {firmware_version} {serial}
   ├── Safe eject device
   └── Show options:
       ├── "Flash Another Device" (quick restart)
       └── "Return to Main Menu"
```

### Key Dependencies
- **HTTP Client**: For API calls (built-in fetch)
- **File System Utilities**: Node.js fs/promises
- **Crypto**: For checksum verification  
- **CSV Export**: Built-in functionality
- **System Commands**: smartctl via child_process
- **Progress Tracking**: Custom implementation

### Security Considerations
- **Signed URLs**: Time-limited download URLs
- **Checksum Verification**: SHA-256 integrity checks
- **Secure Storage**: Local firmware stored in protected user directory
- **Network Security**: HTTPS-only API communication

---

## Benefits of New Automated Approach

### For Users
- ✅ **Controlled Downloads**: User decides when to download updates  
- ✅ **Version Safety**: Cannot accidentally flash older firmware
- ✅ **Always Latest**: Continuous polling ensures latest version awareness
- ✅ **Batch Efficiency**: "Flash Another" option for multiple devices
- ✅ **Complete Logging**: Full tracking with device serials and firmware versions

### For YOM  
- ✅ **Controlled Distribution**: Users get latest but choose when to download
- ✅ **Better Analytics**: Track firmware usage with device serials automatically
- ✅ **Version Control**: Prevent support issues from firmware downgrades  
- ✅ **Operational Efficiency**: Batch flashing capabilities for manufacturing
- ✅ **Comprehensive Logging**: Complete audit trail of all flash operations

### Technical Advantages
- ✅ **Simplified UI**: Less complex interface
- ✅ **Better Testing**: Predictable firmware versions
- ✅ **Enhanced Logging**: Comprehensive operation tracking
- ✅ **Reliable Process**: Automated verification and fallback