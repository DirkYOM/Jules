require('dotenv').config();
console.log('🔧 DEBUG - YOM_PRODUCTION_API:', process.env.YOM_PRODUCTION_API);
console.log('🔧 DEBUG - Current working directory:', process.cwd());
console.log('🔧 DEBUG - .env file exists:', require('fs').existsSync('.env'));

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fixPath = require('fix-path');
const sudoPrompt = require('sudo-prompt');
const net = require('net');
const { execFile } = require('child_process');
const util = require('util');
const { listBlockDevices, flashImage, extendPartition, safeEject, getImageSize, checkAllRequiredCommands } = require('./systemUtils');
const Store = require('electron-store').default;
const { FileManager } = require('./fileManager');

const execFileAsync = util.promisify(execFile);
const SOCKET_PATH = '/tmp/yom-flasher-helper.sock';

// Initialize electron-store and FileManager with production configuration
const store = new Store();
const fileManager = new FileManager({
    apiBaseUrl: process.env.YOM_PRODUCTION_API,
    stationId: process.env.YOM_STATION_ID || 'YOM-FLASH-001',
    maxStoredVersions: parseInt(process.env.YOM_MAX_STORED_VERSIONS) || 3,
    downloadTimeout: parseInt(process.env.YOM_DOWNLOAD_TIMEOUT) || 7200000 // 2 hours for large files
});

// Global state
let mainWindow = null;

// =============================================================================
// FIRMWARE VERSION EXTRACTION
// =============================================================================

/**
 * Extract firmware version from firmware filenames
 * Supports: FlashingApp_v1.2.3, v1.2.3, yom-node-os-P1, etc.
 */
function extractFirmwareVersion(imagePath) {
    const filename = path.basename(imagePath);
    
    // FlashingApp pattern (production format)
    const flashingAppMatch = filename.match(/FlashingApp_(v\d+\.\d+\.\d+)/);
    if (flashingAppMatch) {
        return flashingAppMatch[1];
    }
    
    // YOM firmware patterns - looking for yom-node-os-P followed by version
    const yomPatterns = [
        /yom-node-os-P(\d+)/,                    // P1, P2, P10, etc.
        /yom-node-os-P_(\d+)/,                   // P_01, P_02, etc.
        /yom-node-os-P_(\d+\.\d+)/,             // P_0.1, P_1.5, etc.
        /yom-node-os-P_(\d+\.\d+\.\d+)/,        // P_0.1.1, P_1.2.3, etc.
        /yom-node-os-P(\d+\.\d+)/,              // P1.0, P2.1, etc.
        /yom-node-os-P(\d+\.\d+\.\d+)/          // P1.0.0, P1.2.3, etc.
    ];
    
    // Try YOM patterns
    for (const pattern of yomPatterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
            return `yom-node-os-P${match[1]}`;
        }
    }
    
    // Generic version patterns
    const versionMatch = filename.match(/(v\d+\.\d+\.\d+)/);
    if (versionMatch) {
        return versionMatch[1];
    }
    
    // Ultimate fallback - use filename without extension
    return filename.replace(/\.(raw|img|zip)$/i, '');
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
  });

  mainWindow.setTitle('YOM Flash Tool');
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
};

app.whenReady().then(async () => {
  if (typeof fixPath === 'function') {
    fixPath();
  } else if (fixPath && typeof fixPath.default === 'function') {
    fixPath.default();
  }

  mainWindow = createWindow();

  // Log configuration on startup
  console.log('📡 Registering IPC handlers...');
  console.log(`🔗 Production API: ${process.env.YOM_PRODUCTION_API || 'NOT CONFIGURED'}`);
  console.log(`🏭 Station ID: ${process.env.YOM_STATION_ID || 'YOM-FLASH-001'}`);
  
  // === SINGLE ADMIN SETUP HANDLER FOR LINEAR FLOW ===
  ipcMain.handle('admin:setup', async () => {
    try {
        console.log('🔐 Admin setup requested from linear flow');
        
        // Check required commands first
        const requiredCommands = ['dd', 'lsblk', 'parted', 'resize2fs', 'udisksctl', 'sgdisk', 'e2fsck', 'sudo', 'smartctl'];
        const missingCommands = await checkAllRequiredCommands(requiredCommands);
        
        // Build setup command
        let setupCommand = `echo "YOM Flash Tool requesting admin privileges"`;
        
        // Add dependency installation if needed
        if (missingCommands.length > 0) {
            console.log(`📦 Installing missing dependencies: ${missingCommands.join(', ')}`);
            
            // Detect package manager and add install command
            try {
                await execFileAsync('which', ['apt']);
                setupCommand += ` && apt update && apt install -y ${missingCommands.map(cmd => {
                    const packageMap = {
                        'smartctl': 'smartmontools',
                        'parted': 'parted',
                        'resize2fs': 'e2fsprogs',
                        'udisksctl': 'udisks2',
                        'sgdisk': 'gdisk',
                        'e2fsck': 'e2fsprogs',
                        'dd': 'coreutils',
                        'lsblk': 'util-linux',
                        'sudo': 'sudo'
                    };
                    return packageMap[cmd] || cmd;
                }).filter((pkg, index, arr) => arr.indexOf(pkg) === index).join(' ')}`;
            } catch (error) {
                // Try other package managers
                try {
                    await execFileAsync('which', ['dnf']);
                    setupCommand += ` && dnf install -y ${missingCommands.join(' ')}`;
                } catch (error) {
                    try {
                        await execFileAsync('which', ['yum']);
                        setupCommand += ` && yum install -y ${missingCommands.join(' ')}`;
                    } catch (error) {
                        console.warn('No supported package manager found');
                    }
                }
            }
        }
        
        // Add directory creation
        const artifactsPath = path.join(process.cwd(), 'artifacts');
        setupCommand += ` && mkdir -p "${artifactsPath}/RAW" "${artifactsPath}/Export" "${artifactsPath}/Temp" "${artifactsPath}/Logs"`;
        setupCommand += ` && chmod -R 755 "${artifactsPath}"`;
        setupCommand += ` && chown -R ${process.env.USER}:${process.env.USER} "${artifactsPath}"`;
        
        console.log('🔧 Executing admin setup...');
        
        // Execute with sudo prompt
        return new Promise((resolve) => {
            sudoPrompt.exec(setupCommand, 
                { name: 'YOM Flash Tool Setup' }, 
                async (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ Admin setup failed:', error.message);
                        resolve({ 
                            success: false, 
                            error: error.message,
                            details: stderr 
                        });
                    } else {
                        console.log('✅ Admin setup completed successfully');
                        if (stdout) console.log('Setup output:', stdout);
                        
                        // Initialize file manager paths after successful setup
                        try {
                            await fileManager.initializePaths();
                            console.log('✅ FileManager initialized');
                        } catch (initError) {
                            console.warn('FileManager initialization warning:', initError);
                        }
                        
                        resolve({ 
                            success: true,
                            dependenciesInstalled: missingCommands,
                            output: stdout
                        });
                    }
                }
            );
        });
        
    } catch (error) {
        console.error('❌ Admin setup error:', error);
        return { 
            success: false, 
            error: error.message 
        };
    }
  });

  // === FILE OPERATIONS ===
  ipcMain.handle('file:getInfo', async (event, filePath) => {
      try {
          const fs = require('fs');
          const stats = fs.statSync(filePath);
          const fileName = path.basename(filePath);
          
          return {
              success: true,
              name: fileName,
              size: stats.size,
              path: filePath,
              exists: true
          };
      } catch (error) {
          return {
              success: false,
              error: error.message,
              exists: false
          };
      }
  });

  // === SYSTEM OPERATIONS ===
  ipcMain.handle('system:listDevices', async () => {
      try {
          const devices = await listBlockDevices();
          return devices;
      } catch (error) {
          console.error('Error listing devices in main process:', error);
          return { error: true, message: error.message || 'Failed to list devices.' };
      }
  });

  // === ENHANCED FLASH OPERATIONS WITH PRODUCTION API LOGGING ===
  ipcMain.handle('flash:start', async (event, imagePath, devicePath) => {
      if (!imagePath || !devicePath) {
          return { success: false, message: 'Image path or device path is missing.' };
      }

      const webContents = event.sender;
      const startTime = Date.now();

      try {
          const totalSize = await getImageSize(imagePath);
          if (!totalSize || totalSize <= 0) {
              return { success: false, message: 'Could not determine image size or image is empty.' };
          }

          // Extract firmware version using pattern matching
          const firmwareVersion = extractFirmwareVersion(imagePath);
          
          console.log(`Starting flash: Image=${imagePath}, Device=${devicePath}, Size=${totalSize}`);
          console.log(`Firmware version: ${firmwareVersion} (extracted from ${path.basename(imagePath)})`);
          
          mainWindow.setTitle('YOM Flash Tool - Flashing...');
          
          await flashImage(imagePath, devicePath, totalSize, (progressData) => {
              webContents.send('flash:progress', progressData);
              
              if (progressData.progress !== undefined) {
                  const percent = Math.round(progressData.progress);
                  mainWindow.setTitle(`YOM Flash Tool - Flashing ${percent}%`);
              }
          });
          
          const endTime = Date.now();
          mainWindow.setTitle('YOM Flash Tool');
          
          // PRODUCTION API LOGGING: Log successful operation
          try {
              const logEntry = await fileManager.logFlashOperationWithSerial(
                  devicePath, 
                  firmwareVersion, 
                  'success', // Status: success
                  startTime, 
                  endTime, 
                  {
                      imageSize: totalSize,
                      imagePath: imagePath
                  }
              );
              
              console.log(`Flash operation logged to production API: ${firmwareVersion} -> ${logEntry.serialNumber}`);
              
              return { 
                  success: true, 
                  message: 'Flashing completed successfully.',
                  logEntry: logEntry
              };
          } catch (logError) {
              // Don't fail the operation if logging fails
              console.warn('Production API logging failed (operation succeeded):', logError.message);
              return { 
                  success: true, 
                  message: 'Flashing completed successfully.',
                  warning: 'Logging to production API failed'
              };
          }
          
      } catch (error) {
          console.error('Error during flashing in main process:', error);
          const endTime = Date.now();
          mainWindow.setTitle('YOM Flash Tool');
          
          // PRODUCTION API LOGGING: Log failed operation
          try {
              const firmwareVersion = extractFirmwareVersion(imagePath);
              
              await fileManager.logFlashOperationWithSerial(
                  devicePath, 
                  firmwareVersion, 
                  'failed', // Status: failed
                  startTime, 
                  endTime, 
                  {
                      error: error.message,
                      imagePath: imagePath
                  }
              );
              
              console.log(`Failed flash operation logged to production API: ${firmwareVersion}`);
          } catch (logError) {
              console.warn('Failed operation logging to production API failed:', logError.message);
          }
          
          return { success: false, message: error.message || 'Failed to flash image.' };
      }
  });

  // === POST-FLASH OPERATIONS ===
  ipcMain.handle('partition:extend', async (event, devicePath, partitionNumber) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for partition extension.' };
      }
      const partNum = partitionNumber || 3;

      try {
          console.log(`Starting partition extend: Device=${devicePath}, Partition=${partNum}`);
          mainWindow.setTitle('YOM Flash Tool - Extending Partition...');
          
          await extendPartition(devicePath, partNum);
          mainWindow.setTitle('YOM Flash Tool');
          
          return { success: true, message: `Partition ${partNum} on ${devicePath} extended successfully.` };
      } catch (error) {
          console.error(`Error during partition extension in main process for ${devicePath}:`, error);
          mainWindow.setTitle('YOM Flash Tool');
          return { success: false, message: error.message || `Failed to extend partition ${partNum} on ${devicePath}.` };
      }
  });

  ipcMain.handle('device:eject', async (event, devicePath) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for eject.' };
      }

      try {
          console.log(`Starting safe eject for: Device=${devicePath}`);
          mainWindow.setTitle('YOM Flash Tool - Ejecting Device...');
          
          await safeEject(devicePath);
          mainWindow.setTitle('YOM Flash Tool');
          
          return { success: true, message: `Device ${devicePath} ejected successfully.` };
      } catch (error) {
          console.error(`Error during safe eject in main process for ${devicePath}:`, error);
          mainWindow.setTitle('YOM Flash Tool');
          return { success: false, message: error.message || `Failed to eject device ${devicePath}.` };
      }
  });

  // === DIALOG HELPERS ===
  ipcMain.on('dialog:showError', (event, title, content) => {
      dialog.showErrorBox(
          title ? `YOM Flash Tool - ${title}` : 'YOM Flash Tool - Error', 
          content || 'An unexpected error occurred.'
      );
  });

  ipcMain.on('dialog:showSuccess', (event, title, content) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      dialog.showMessageBox(window || mainWindow, {
          type: 'info',
          title: title ? `YOM Flash Tool - ${title}` : 'YOM Flash Tool - Success',
          message: content || 'Operation completed successfully.',
          buttons: ['OK']
      });
  });

  // === PRODUCTION UPDATE MANAGEMENT IPC HANDLERS ===
  ipcMain.handle('update:check', async () => {
      try {
          console.log('🔍 Checking for updates via production API');
          return await fileManager.checkForUpdates();
      } catch (error) {
          console.error('Update check failed:', error);
          return { hasUpdate: false, error: error.message };
      }
  });

  ipcMain.handle('update:getLocalVersions', async () => {
      try {
          return await fileManager.getLocalVersions();
      } catch (error) {
          console.error('Failed to get local versions:', error);
          return { error: error.message };
      }
  });

  ipcMain.handle('update:getAutoSelected', async () => {
      try {
          return await fileManager.getAutoSelectedFirmware();
      } catch (error) {
          console.error('Failed to get auto-selected firmware:', error);
          return { error: error.message };
      }
  });

  // === PRODUCTION DOWNLOAD HANDLER ===
  ipcMain.handle('update:download', async (event, version) => {
      const webContents = event.sender;
      
      try {
          console.log(`🔽 Downloading firmware ${version} from production API`);
          
          const downloadPath = await fileManager.downloadFirmware(version, (progress) => {
              webContents.send('update:downloadProgress', {
                  version,
                  ...progress
              });
          });
          
          console.log('🔄 Download and extraction completed, refreshing firmware selection...');
          
          // Small delay to ensure file system operations are complete
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Get the updated auto-selected firmware
          const updatedFirmware = await fileManager.getAutoSelectedFirmware();
          
          if (updatedFirmware) {
              console.log(`✅ Auto-selected updated firmware: ${updatedFirmware.filename}`);
              
              // Send updated firmware info to frontend
              webContents.send('update:firmwareRefreshed', {
                  firmware: updatedFirmware,
                  version: version,
                  downloadedPath: downloadPath,
                  extractionComplete: true,
                  success: true
              });
          } else {
              console.warn('⚠️  Could not auto-select firmware after download');
              webContents.send('update:firmwareRefreshed', {
                  version: version,
                  downloadedPath: downloadPath,
                  extractionComplete: true,
                  success: false,
                  error: 'Could not auto-select firmware'
              });
          }
          
          return { success: true, path: downloadPath, firmware: updatedFirmware };
      } catch (error) {
          console.error('Download failed:', error);
          
          webContents.send('update:firmwareRefreshed', {
              version: version,
              extractionComplete: false,
              success: false,
              error: error.message
          });
          
          return { success: false, error: error.message };
      }
  });

  // === LOG EXPORT (LOCAL BACKUP) ===
  ipcMain.handle('update:exportLog', async (event, format) => {
      try {
          const logData = await fileManager.exportFlashLog(format);
          
          const window = BrowserWindow.fromWebContents(event.sender);
          const { canceled, filePath } = await dialog.showSaveDialog(window, {
              title: 'Export Flash Log',
              defaultPath: `flash_log_${new Date().toISOString().split('T')[0]}.${format}`,
              filters: [
                  { name: format.toUpperCase(), extensions: [format] },
                  { name: 'All Files', extensions: ['*'] }
              ]
          });
          
          if (!canceled && filePath) {
              const fs = require('fs').promises;
              await fs.writeFile(filePath, logData);
              return { success: true, path: filePath };
          }
          
          return { success: false, canceled: true };
      } catch (error) {
          console.error('Export log failed:', error);
          return { success: false, error: error.message };
      }
  });

  ipcMain.handle('device:getSerial', async (event, devicePath) => {
      try {
          const serial = await fileManager.getDeviceSerial(devicePath);
          return { success: true, serial };
      } catch (error) {
          console.error('Failed to get device serial:', error);
          return { success: false, error: error.message };
      }
  });

  ipcMain.handle('update:validateStorage', async () => {
      try {
          const localVersions = await fileManager.getLocalVersions();
          return {
              totalFiles: localVersions.length,
              versions: localVersions.map(v => ({
                  version: v.version,
                  size: v.size,
                  path: v.path
              }))
          };
      } catch (error) {
          console.error('Storage validation failed:', error);
          return { error: error.message };
      }
  });

  ipcMain.handle('update:cleanupStorage', async () => {
      try {
          await fileManager.manageStorageLimit();
          await fileManager.cleanupTempFiles();
          return { success: true, message: 'Storage cleanup completed' };
      } catch (error) {
          console.error('Storage cleanup failed:', error);
          return { success: false, error: error.message };
      }
  });

  console.log('✅ IPC handlers registered');
  console.log('🚀 YOM Flash Tool ready - using production API with enhanced logging');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean shutdown
});

app.setAsDefaultProtocolClient('yom-flash');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// IPC Client Connection Logic (for future use)
let helperClient = null;

function connectToHelper() {
  console.log('Attempting to connect to root helper at:', SOCKET_PATH);
  helperClient = net.createConnection({ path: SOCKET_PATH });

  helperClient.on('connect', () => {
    console.log('Main App: Connected to root helper.');
    helperClient.write('Hello from main app');
    global.helperClient = helperClient; 
  });

  helperClient.on('data', (data) => {
    console.log('Main App: Received from helper:', data.toString());
  });

  helperClient.on('error', (err) => {
    console.error('Main App: Connection to root helper failed:', err.message);
    helperClient = null;
    global.helperClient = null;
    
    setTimeout(() => {
      console.log('Retrying connection to helper...');
      connectToHelper();
    }, 3000);
  });

  helperClient.on('close', () => {
    console.log('Main App: Connection to root helper closed.');
    helperClient = null;
    global.helperClient = null;
  });
}