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

// Initialize electron-store and FileManager
const store = new Store();
const fileManager = new FileManager({
    apiBaseUrl: process.env.YOM_API_URL || 'http://localhost:3001',
    maxStoredVersions: 3,
    pollingInterval: 5 * 60 * 1000, // 5 minutes
    downloadTimeout: 3600 * 1000, // 1 hour
    preventDowngrade: true
});

// Global state for polling
let updatePollingInterval = null;
let mainWindow = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

/**
 * Auto-install missing system dependencies
 */
async function autoInstallMissingDependencies(missingCommands) {
    const commandToPackageMap = {
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

    const packagesToInstall = [];
    const unresolvableCommands = [];

    for (const command of missingCommands) {
        const packageName = commandToPackageMap[command];
        if (packageName && !packagesToInstall.includes(packageName)) {
            packagesToInstall.push(packageName);
        } else if (!packageName) {
            unresolvableCommands.push(command);
        }
    }

    if (packagesToInstall.length === 0) {
        console.log('No packages to install.');
        return { success: true, installed: [], failed: unresolvableCommands };
    }

    console.log(`📦 Auto-installing missing packages: ${packagesToInstall.join(', ')}`);

    try {
        // Show progress dialog
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'YOM Flash Tool - Installing Dependencies',
            message: `Installing required system packages:\n\n${packagesToInstall.join(', ')}\n\nThis may take a few minutes...`,
            buttons: ['Installing...'],
            defaultId: 0
        });

        // Detect package manager and install
        let installCommand;

        // Check if apt is available (Debian/Ubuntu)
        try {
            await execFileAsync('which', ['apt']);
            installCommand = `apt install -y ${packagesToInstall.join(' ')}`;
        } catch (error) {
            // Check if yum is available (RHEL/CentOS)
            try {
                await execFileAsync('which', ['yum']);
                installCommand = `yum install -y ${packagesToInstall.join(' ')}`;
            } catch (error) {
                // Check if dnf is available (Fedora)
                try {
                    await execFileAsync('which', ['dnf']);
                    installCommand = `dnf install -y ${packagesToInstall.join(' ')}`;
                } catch (error) {
                    throw new Error('No supported package manager found (apt, yum, or dnf)');
                }
            }
        }

        console.log(`Executing with sudo-prompt: ${installCommand}`);

        // Execute installation with sudo prompt (WITHOUT "sudo" prefix)
        return new Promise((resolve) => {
            sudoPrompt.exec(installCommand, 
                { name: 'YOM Flash Tool Install Dependencies' }, 
                (error, stdout, stderr) => {
                    if (error) {
                        console.error('Installation failed:', error);
                        dialog.showErrorBox(
                            'YOM Flash Tool - Installation Failed',
                            `Failed to install dependencies:\n\n${error.message}\n\nPlease install manually:\nsudo apt install ${packagesToInstall.join(' ')}`
                        );
                        resolve({ success: false, error: error.message, failed: packagesToInstall });
                    } else {
                        console.log('✅ Dependencies installed successfully');
                        if (stdout) console.log('Install output:', stdout);
                        
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'YOM Flash Tool - Installation Complete',
                            message: `Successfully installed:\n\n${packagesToInstall.join(', ')}\n\nPlease restart the application.`,
                            buttons: ['Restart Now', 'Continue']
                        }).then((result) => {
                            if (result.response === 0) {
                                app.relaunch();
                                app.exit();
                            }
                        });
                        
                        resolve({ success: true, installed: packagesToInstall, failed: unresolvableCommands });
                    }
                }
            );
        });

    } catch (error) {
        console.error('Auto-install error:', error);
        dialog.showErrorBox(
            'YOM Flash Tool - Auto-Install Failed',
            `Could not auto-install dependencies: ${error.message}\n\nPlease install manually:\nsudo apt install ${packagesToInstall.join(' ')}`
        );
        return { success: false, error: error.message, failed: packagesToInstall };
    }
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

// Start update polling
function startUpdatePolling() {
    if (updatePollingInterval) {
        clearInterval(updatePollingInterval);
    }
    
    updatePollingInterval = setInterval(async () => {
        try {
            const updateResult = await fileManager.checkForUpdates();
            if (updateResult.hasUpdate && mainWindow) {
                mainWindow.webContents.send('update:newVersionAvailable', updateResult.latest);
            }
        } catch (error) {
            console.error('Polling update check failed:', error);
        }
    }, fileManager.config.pollingInterval);
    
    console.log(`Started update polling every ${fileManager.config.pollingInterval / 1000 / 60} minutes`);
}

// Stop update polling
function stopUpdatePolling() {
    if (updatePollingInterval) {
        clearInterval(updatePollingInterval);
        updatePollingInterval = null;
        console.log('Stopped update polling');
    }
}

app.whenReady().then(async () => {
  if (typeof fixPath === 'function') {
    fixPath();
  } else if (fixPath && typeof fixPath.default === 'function') {
    fixPath.default();
  }

  mainWindow = createWindow();

  // === REGISTER ALL IPC HANDLERS FIRST ===
  console.log('📡 Registering IPC handlers...');
  
  // === LEGACY FILE SELECTION HANDLERS (COMMENTED OUT) ===
  /*
  // LEGACY: Manual file selection - commented out for new automated flow
  ipcMain.handle('dialog:selectImage', async (event, options = {}) => {
    const lastOpenedDirectory = store.get('lastOpenedDirectory');
    const { suggestedFilename } = options;

    let dialogOptions = {
        title: 'YOM Flash Tool - Select RAW Image File',
        buttonLabel: 'Select Image',
        properties: ['openFile'],
        defaultPath: lastOpenedDirectory,
        filters: [
            { name: 'RAW Disk Images', extensions: ['img', 'iso', 'bin', 'raw', 'dmg'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    };

    if (suggestedFilename && lastOpenedDirectory) {
        const suggestedPath = path.join(lastOpenedDirectory, suggestedFilename);
        try {
            const fs = require('fs');
            if (fs.existsSync(suggestedPath)) {
                dialogOptions.defaultPath = suggestedPath;
            }
        } catch (error) {
            console.log('Could not pre-select suggested file:', error.message);
        }
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, dialogOptions);
    
    if (canceled || filePaths.length === 0) {
        return null;
    } else {
        const selectedFilePath = filePaths[0];
        store.set('lastOpenedDirectory', path.dirname(selectedFilePath));
        return selectedFilePath;
    }
  });

  // LEGACY: Drag and drop validation - commented out for new automated flow
  ipcMain.handle('file:validateDraggedFile', async (event, fileName, possiblePaths = []) => {
      const fs = require('fs');
      
      const searchPaths = [
          ...possiblePaths,
          process.cwd(),
          require('os').homedir(),
          path.join(require('os').homedir(), 'Downloads'),
          path.join(require('os').homedir(), 'Desktop'),
          path.join(require('os').homedir(), 'Documents'),
      ];
      
      const lastDir = store.get('lastOpenedDirectory');
      if (lastDir) {
          searchPaths.unshift(lastDir);
      }
      
      for (const searchPath of searchPaths) {
          try {
              const fullPath = path.join(searchPath, fileName);
              if (fs.existsSync(fullPath)) {
                  const stats = fs.statSync(fullPath);
                  store.set('lastOpenedDirectory', searchPath);
                  
                  return {
                      success: true,
                      path: fullPath,
                      name: fileName,
                      size: stats.size,
                      found: true
                  };
              }
          } catch (error) {
              continue;
          }
      }
      
      return {
          success: false,
          found: false,
          searched: searchPaths,
          message: `Could not locate "${fileName}" in common directories`
      };
  });
  */

  // === ACTIVE IPC HANDLERS ===

  // File info handler (still needed for firmware file info)
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

  // System device listing
  ipcMain.handle('system:listDevices', async () => {
      try {
          const devices = await listBlockDevices();
          return devices;
      } catch (error) {
          console.error('Error listing devices in main process:', error);
          return { error: true, message: error.message || 'Failed to list devices.' };
      }
  });

  // Enhanced flash operation with serial logging
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

          // Extract firmware version from filename
          const filename = path.basename(imagePath);
          const versionMatch = filename.match(/FlashingApp_(v\d+\.\d+\.\d+)/);
          const firmwareVersion = versionMatch ? versionMatch[1] : filename;

          console.log(`Starting flash: Image=${imagePath}, Device=${devicePath}, Size=${totalSize}, Version=${firmwareVersion}`);
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
          
          // Log the successful flash operation with serial number using FileManager
          try {
              const logEntry = await fileManager.logFlashOperationWithSerial(
                  devicePath, 
                  firmwareVersion, 
                  'success', 
                  startTime, 
                  endTime, 
                  {
                      imageSize: totalSize,
                      imagePath: imagePath
                  }
              );
              
              console.log('Flash operation logged:', logEntry);
              
              return { 
                  success: true, 
                  message: 'Flashing completed successfully.',
                  logEntry: logEntry
              };
          } catch (logError) {
              console.warn('Failed to log flash operation:', logError);
              return { 
                  success: true, 
                  message: 'Flashing completed successfully (logging failed).'
              };
          }
          
      } catch (error) {
          console.error('Error during flashing in main process:', error);
          const endTime = Date.now();
          mainWindow.setTitle('YOM Flash Tool');
          
          // Log the failed flash operation using FileManager
          try {
              const filename = path.basename(imagePath);
              const versionMatch = filename.match(/FlashingApp_(v\d+\.\d+\.\d+)/);
              const firmwareVersion = versionMatch ? versionMatch[1] : filename;
              
              await fileManager.logFlashOperationWithSerial(
                  devicePath, 
                  firmwareVersion, 
                  'failed', 
                  startTime, 
                  endTime, 
                  {
                      error: error.message,
                      imagePath: imagePath
                  }
              );
          } catch (logError) {
              console.warn('Failed to log flash operation:', logError);
          }
          
          return { success: false, message: error.message || 'Failed to flash image.' };
      }
  });

  // Partition extension
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

  // Safe device ejection
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

  // Dialog helpers
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

  // === NEW AUTOMATED UPDATE MANAGEMENT IPC HANDLERS (Using FileManager) ===
  
  // Update checking with polling
  ipcMain.handle('update:check', async () => {
      try {
          return await fileManager.checkForUpdates();
      } catch (error) {
          console.error('Update check failed:', error);
          return { hasUpdate: false, error: error.message };
      }
  });

  // Get local versions
  ipcMain.handle('update:getLocalVersions', async () => {
      try {
          return await fileManager.getLocalVersions();
      } catch (error) {
          console.error('Failed to get local versions:', error);
          return { error: error.message };
      }
  });

  // Get auto-selected firmware
  ipcMain.handle('update:getAutoSelected', async () => {
      try {
          return await fileManager.getAutoSelectedFirmware();
      } catch (error) {
          console.error('Failed to get auto-selected firmware:', error);
          return { error: error.message };
      }
  });

  // Download firmware (manual trigger with zip support)
  ipcMain.handle('update:download', async (event, version) => {
      const webContents = event.sender;
      
      try {
          const downloadPath = await fileManager.downloadFirmware(version, (progress) => {
              webContents.send('update:downloadProgress', {
                  version,
                  ...progress
              });
          });
          
          // After successful download, automatically refresh and update UI
          console.log('🔄 Download completed, refreshing firmware selection...');
          
          // Get the updated auto-selected firmware
          const updatedFirmware = await fileManager.getAutoSelectedFirmware();
          
          if (updatedFirmware) {
              console.log(`✅ Auto-selected updated firmware: ${updatedFirmware.filename}`);
              
              // Send updated firmware info to frontend
              webContents.send('update:firmwareRefreshed', {
                  firmware: updatedFirmware,
                  version: version,
                  downloadedPath: downloadPath
              });
          }
          
          return { success: true, path: downloadPath, firmware: updatedFirmware };
      } catch (error) {
          console.error('Download failed:', error);
          return { success: false, error: error.message };
      }
  });

  // Export logs using FileManager
  ipcMain.handle('update:exportLog', async (event, format) => {
      try {
          // Get log data from FileManager
          const logData = await fileManager.exportFlashLog(format);
          
          // Show save dialog
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

  // Get device serial number using FileManager
  ipcMain.handle('device:getSerial', async (event, devicePath) => {
      try {
          const serial = await fileManager.getDeviceSerial(devicePath);
          return { success: true, serial };
      } catch (error) {
          console.error('Failed to get device serial:', error);
          return { success: false, error: error.message };
      }
  });

  // Storage validation
  ipcMain.handle('update:validateStorage', async () => {
      try {
          // Use FileManager to get storage info
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

  // Manual storage cleanup
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

  // === ENHANCED DEPENDENCY CHECKING WITH AUTO-INSTALL ===
  console.log('🔍 Checking required system commands...');
  const requiredCommands = ['dd', 'lsblk', 'parted', 'resize2fs', 'udisksctl', 'sgdisk', 'e2fsck', 'sudo', 'smartctl'];
  const missingCommands = await checkAllRequiredCommands(requiredCommands);
  
  if (missingCommands.length > 0) {
      console.log(`❌ Missing commands: ${missingCommands.join(', ')}`);
      console.log('📋 Will install missing dependencies after getting admin privileges...');
  } else {
      console.log('✅ All required commands found');
  }

  // === ENHANCED DIRECTORY CREATION WITH SINGLE SUDO PROMPT ===
  console.log('📁 Setting up directory structure...');
  
  // SINGLE SUDO COMMAND: Get admin privileges, install dependencies, and create directories
  console.log('🔐 Requesting administrator privileges...');
  
  let setupCommand = `echo "YOM Flash Tool requesting admin privileges"`;
  
  // Add dependency installation if needed
  if (missingCommands.length > 0) {
    setupCommand += ` && apt update && apt install -y smartmontools`;
  }
  
  // Add directory creation
  setupCommand += ` && mkdir -p "${process.cwd()}/artifacts/RAW" "${process.cwd()}/artifacts/Export" "${process.cwd()}/artifacts/Temp" "${process.cwd()}/artifacts/Logs" && chmod -R 755 "${process.cwd()}/artifacts" && chown -R ${process.env.USER}:${process.env.USER} "${process.cwd()}/artifacts"`;
  
  sudoPrompt.exec(setupCommand, 
    { name: 'YOM Flash Tool Setup' }, 
    async (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Failed to complete setup with admin privileges:', error.message);
        
        // Try fallback for directories only
        try {
          const fs = require('fs').promises;
          await fs.mkdir(path.join(process.cwd(), 'artifacts', 'RAW'), { recursive: true });
          await fs.mkdir(path.join(process.cwd(), 'artifacts', 'Export'), { recursive: true });
          await fs.mkdir(path.join(process.cwd(), 'artifacts', 'Temp'), { recursive: true });
          await fs.mkdir(path.join(process.cwd(), 'artifacts', 'Logs'), { recursive: true });
          console.log('✅ Directories created with fallback method');
          
          if (missingCommands.length > 0) {
            console.warn('⚠️  Please install missing dependencies manually: sudo apt install smartmontools');
          }
        } catch (fallbackError) {
          console.error('❌ Fallback setup also failed:', fallbackError);
          dialog.showErrorBox(
            'YOM Flash Tool - Setup Failed', 
            'Failed to complete setup. Please run manually:\nsudo apt install smartmontools\nmkdir -p artifacts/{RAW,Export,Temp,Logs}'
          );
        }
      } else {
        console.log('✅ Admin setup completed successfully');
        if (missingCommands.length > 0) {
          console.log('✅ Dependencies installed');
        }
        console.log('✅ Directories created with proper permissions');
        if (stdout) console.log('Setup output:', stdout);
      }
      
      // Initialize file manager after setup
      try {
        await fileManager.initializePaths();
        console.log('✅ FileManager initialized successfully');
      } catch (initError) {
        console.error('❌ FileManager initialization failed:', initError);
      }
      
      // Start update polling after everything is set up
      setTimeout(() => {
        startUpdatePolling();
      }, 2000); // Start polling after 2 seconds
    }
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopUpdatePolling(); // Clean up polling on app close
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopUpdatePolling(); // Clean up polling before quit
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

// IPC Client Connection Logic
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