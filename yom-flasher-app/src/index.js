const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // MODIFIED: Added ipcMain, dialog
const path = require('node:path'); // Note: path was 'path' before, ensure 'node:path' is okay or use 'path'
const fixPath = require('fix-path'); // To ensure PATH is correctly set for child processes
const sudoPrompt = require('sudo-prompt');
const net = require('net');
// const systemUtils = require('./systemUtils'); // Old way
const { listBlockDevices, flashImage, extendPartition, safeEject, getImageSize, checkAllRequiredCommands } = require('./systemUtils'); // New: Destructured import + checkAllRequiredCommands
const Store = require('electron-store').default; // For persisting simple key-value data like last opened directory

const SOCKET_PATH = '/tmp/yom-flasher-helper.sock';

// Initialize electron-store. User data is typically stored in app.getPath('userData').
const store = new Store();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window with YOM branding and modern styling
  const mainWindow = new BrowserWindow({
    width: 1000, // Increased width for better content display
    height: 700, // Increased height for better content display
    minWidth: 800, // Set minimum dimensions
    minHeight: 600,
    titleBarStyle: 'hiddenInset', // Modern titlebar on macOS
    backgroundColor: '#0a0a0a', // YOM dark background
    icon: path.join(__dirname, 'assets', 'icon.png'), // App icon
    show: false, // Don't show until ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // MODIFIED: Recommended for security
      nodeIntegration: false // MODIFIED: Recommended for security
    },
  });

  // Set window title to match YOM branding
  mainWindow.setTitle('YOM Flash Tool');

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open the DevTools only in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow; // MODIFIED: Return mainWindow
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Attempt to call fix-path, checking if it's a direct function or has a .default function
  if (typeof fixPath === 'function') {
    fixPath();
    console.log('fix-path called directly.');
  } else if (fixPath && typeof fixPath.default === 'function') {
    fixPath.default();
    console.log('fix-path called via .default().');
  } else {
    console.error('fix-path was loaded, but its structure is not as expected (not a function, no .default function). PATH environment variable might not be corrected. Type of fixPath:', typeof fixPath);
  }

  // Start the root helper script asynchronously (don't wait for it)
  const helperScriptPath = path.join(__dirname, 'root-helper.js');
  const command = `node "${helperScriptPath}"`;
  const options = { 
    name: 'YOM Flash Tool Background Service', // Updated service name
    env: {
      'DISPLAY': process.env.DISPLAY,
      ...(process.env.XAUTHORITY && {'XAUTHORITY': process.env.XAUTHORITY})
    }
  };

  // Start helper but don't block app startup
  sudoPrompt.exec(command, options, (error, stdout, stderr) => {
    if (error) {
      console.error('Failed to start root helper:', error);
      console.error('sudo-prompt stdout:', stdout);
      console.error('sudo-prompt stderr:', stderr);
      dialog.showErrorBox('YOM Flash Tool - Error', 'Failed to start background service with root privileges.');
      return;
    }
    console.log('Root helper script launched by sudo-prompt.');
    console.log('Helper stdout:', stdout);
    if (stderr && !stderr.includes("XDG_RUNTIME_DIR not set")) {
      console.warn('Helper stderr:', stderr);
    }
    
    // Try to connect after a short delay to allow helper to start
    setTimeout(() => {
      connectToHelper();
    }, 2000); // 2 second delay
  });
  
  // Create the main window immediately (don't wait for helper)
  const mainWindow = createWindow();

  // --- Application Startup Checks ---
  // Check for required command-line utilities critical for the app's functionality.
  // If any are missing, an error dialog is shown to the user.
  // The application will still load, but core operations will likely fail.
  const requiredCommands = ['dd', 'lsblk', 'parted', 'resize2fs', 'udisksctl', 'sgdisk', 'e2fsck', 'sudo'];
  const missingCommands = await checkAllRequiredCommands(requiredCommands);
  if (missingCommands.length > 0) {
      dialog.showErrorBox(
          'YOM Flash Tool - Missing Required Commands',
          `The following critical commands are missing or not found in PATH: \n\n${missingCommands.join(', ')}\n\nPlease install them and ensure they are in your system's PATH for the application to function correctly.`
      );
      // For a flasher utility, these commands are essential.
      // Consider whether the app should quit if commands are missing: app.quit();
  }

  // --- IPC Handlers ---
  // These handlers define how the main process responds to messages (invocations) from the renderer process.

  // Enhanced dialog handler that can accept filename hints for drag-and-drop
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

    // If we have a suggested filename, try to set the default path to that file
    if (suggestedFilename && lastOpenedDirectory) {
        const suggestedPath = path.join(lastOpenedDirectory, suggestedFilename);
        try {
            // Check if the suggested file exists in the last directory
            const fs = require('fs');
            if (fs.existsSync(suggestedPath)) {
                dialogOptions.defaultPath = suggestedPath;
                console.log('Pre-selecting dragged file:', suggestedPath);
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

  // New handler to get file info from a path (for drag-and-drop validation)
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
          console.error('Error getting file info:', error);
          return {
              success: false,
              error: error.message,
              exists: false
          };
      }
  });

  // Enhanced drag-and-drop handler - searches for dragged files in common locations
  ipcMain.handle('file:validateDraggedFile', async (event, fileName, possiblePaths = []) => {
      const fs = require('fs');
      
      // Common locations where files might be
      const searchPaths = [
          ...possiblePaths,
          process.cwd(), // Current working directory
          require('os').homedir(), // Home directory
          path.join(require('os').homedir(), 'Downloads'), // Downloads folder
          path.join(require('os').homedir(), 'Desktop'), // Desktop
          path.join(require('os').homedir(), 'Documents'), // Documents
      ];
      
      // Add last opened directory if available
      const lastDir = store.get('lastOpenedDirectory');
      if (lastDir) {
          searchPaths.unshift(lastDir); // Add to beginning for priority
      }
      
      // Search for the file in common locations
      for (const searchPath of searchPaths) {
          try {
              const fullPath = path.join(searchPath, fileName);
              if (fs.existsSync(fullPath)) {
                  const stats = fs.statSync(fullPath);
                  console.log('Found dragged file at:', fullPath);
                  
                  // Store this directory for future use
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
              // Continue searching
              continue;
          }
      }
      
      // File not found in common locations
      return {
          success: false,
          found: false,
          searched: searchPaths,
          message: `Could not locate "${fileName}" in common directories`
      };
  });

  // Handles request from renderer to list available block/storage devices.
  // Calls systemUtils.listBlockDevices and returns the result or an error object.
  ipcMain.handle('system:listDevices', async () => {
      try {
          // Using destructured listBlockDevices directly
          const devices = await listBlockDevices();
          return devices;
      } catch (error) {
          console.error('Error listing devices in main process:', error);
          // It's good practice to return an error object or structure that renderer can check
          return { error: true, message: error.message || 'Failed to list devices.' };
      }
  });

  // Handles request to start the image flashing process.
  // Takes imagePath and devicePath from renderer, gets image size, then calls systemUtils.flashImage.
  // Progress is streamed back to the renderer via 'flash:progress' events.
  ipcMain.handle('flash:start', async (event, imagePath, devicePath) => {
      if (!imagePath || !devicePath) {
          return { success: false, message: 'Image path or device path is missing.' };
      }

      const webContents = event.sender; // To send progress updates back to the correct window.

      try {
          const totalSize = await getImageSize(imagePath); // Get image size for accurate progress.
          if (!totalSize || totalSize <= 0) {
              return { success: false, message: 'Could not determine image size or image is empty.' };
          }

          console.log(`Starting flash: Image=${imagePath}, Device=${devicePath}, Size=${totalSize}`);
          
          // Update window title to show flashing status
          mainWindow.setTitle('YOM Flash Tool - Flashing...');
          
          // Using destructured flashImage directly
          await flashImage(imagePath, devicePath, totalSize, (progressData) => {
              // console.log('Main process flash progress:', progressData); // Optional: can be very noisy
              webContents.send('flash:progress', progressData); // Send progress data to renderer.
              
              // Update window title with progress
              if (progressData.progress !== undefined) {
                  const percent = Math.round(progressData.progress);
                  mainWindow.setTitle(`YOM Flash Tool - Flashing ${percent}%`);
              }
          });
          
          // Reset window title after completion
          mainWindow.setTitle('YOM Flash Tool');
          
          return { success: true, message: 'Flashing completed successfully.' };
      } catch (error) {
          console.error('Error during flashing in main process:', error);
          // Reset window title on error
          mainWindow.setTitle('YOM Flash Tool');
          return { success: false, message: error.message || 'Failed to flash image.' };
      }
  });

  // Handles request to extend a partition on the target device after flashing.
  // Calls systemUtils.extendPartition.
  ipcMain.handle('partition:extend', async (event, devicePath, partitionNumber) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for partition extension.' };
      }
      const partNum = partitionNumber || 3; // Default to partition number 3 if not specified.

      try {
          console.log(`Starting partition extend: Device=${devicePath}, Partition=${partNum}`);
          
          // Update window title to show partition extension status
          mainWindow.setTitle('YOM Flash Tool - Extending Partition...');
          
          // Using destructured extendPartition directly
          await extendPartition(devicePath, partNum);
          
          // Reset window title
          mainWindow.setTitle('YOM Flash Tool');
          
          return { success: true, message: `Partition ${partNum} on ${devicePath} extended successfully.` };
      } catch (error) {
          console.error(`Error during partition extension in main process for ${devicePath}:`, error);
          // Reset window title on error
          mainWindow.setTitle('YOM Flash Tool');
          return { success: false, message: error.message || `Failed to extend partition ${partNum} on ${devicePath}.` };
      }
  });

  // Handles request to safely eject the target device.
  // Calls systemUtils.safeEject.
  ipcMain.handle('device:eject', async (event, devicePath) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for eject.' };
      }

      try {
          console.log(`Starting safe eject for: Device=${devicePath}`);
          
          // Update window title to show ejection status
          mainWindow.setTitle('YOM Flash Tool - Ejecting Device...');
          
          // Using destructured safeEject directly
          await safeEject(devicePath);
          
          // Reset window title
          mainWindow.setTitle('YOM Flash Tool');
          
          return { success: true, message: `Device ${devicePath} ejected successfully.` };
      } catch (error) {
          console.error(`Error during safe eject in main process for ${devicePath}:`, error);
          // Reset window title on error
          mainWindow.setTitle('YOM Flash Tool');
          return { success: false, message: error.message || `Failed to eject device ${devicePath}.` };
      }
  });

  // Handles request from renderer to show a native error dialog.
  ipcMain.on('dialog:showError', (event, title, content) => {
      dialog.showErrorBox(
          title ? `YOM Flash Tool - ${title}` : 'YOM Flash Tool - Error', 
          content || 'An unexpected error occurred.'
      );
  });

  // Handles request from renderer to show a native success/info message dialog.
  ipcMain.on('dialog:showSuccess', (event, title, content) => {
      const window = BrowserWindow.fromWebContents(event.sender); // Get the window that sent the message
      dialog.showMessageBox(window || mainWindow, { // Fallback to mainWindow if sender window not found
          type: 'info',
          title: title ? `YOM Flash Tool - ${title}` : 'YOM Flash Tool - Success',
          message: content || 'Operation completed successfully.',
          buttons: ['OK']
      });
  });

  // macOS specific: Re-create a window when the dock icon is clicked and no other windows are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle protocol for deep linking (future feature)
app.setAsDefaultProtocolClient('yom-flash');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// IPC Client Connection Logic
let helperClient = null; // Keep a reference to the client

function connectToHelper() {
  console.log('Attempting to connect to root helper at:', SOCKET_PATH);
  helperClient = net.createConnection({ path: SOCKET_PATH });

  helperClient.on('connect', () => {
    console.log('Main App: Connected to root helper.');
    helperClient.write('Hello from main app');
    // Make client available globally or through a module after connection
    global.helperClient = helperClient; 
  });

  helperClient.on('data', (data) => {
    console.log('Main App: Received from helper:', data.toString());
  });

  helperClient.on('error', (err) => {
    console.error('Main App: Connection to root helper failed:', err.message);
    helperClient = null;
    global.helperClient = null;
    
    // Retry connection after a delay
    setTimeout(() => {
      console.log('Retrying connection to helper...');
      connectToHelper();
    }, 3000); // Retry after 3 seconds
  });

  helperClient.on('close', () => {
    console.log('Main App: Connection to root helper closed.');
    helperClient = null;
    global.helperClient = null;
  });
}