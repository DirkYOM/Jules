const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // MODIFIED: Added ipcMain, dialog
const path = require('node:path'); // Note: path was 'path' before, ensure 'node:path' is okay or use 'path'
const fixPath = require('fix-path'); // To ensure PATH is correctly set for child processes
// const systemUtils = require('./systemUtils'); // Old way
const { listBlockDevices, flashImage, extendPartition, safeEject, getImageSize, checkAllRequiredCommands } = require('./systemUtils'); // New: Destructured import + checkAllRequiredCommands
const Store = require('electron-store').default; // For persisting simple key-value data like last opened directory

// Initialize electron-store. User data is typically stored in app.getPath('userData').
const store = new Store();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // MODIFIED: Recommended for security
      nodeIntegration: false // MODIFIED: Recommended for security
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
  return mainWindow; // MODIFIED: Return mainWindow
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => { // Make the callback async
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

  const mainWindow = createWindow(); // Create the main application window.

  // --- Application Startup Checks ---
  // Check for required command-line utilities critical for the app's functionality.
  // If any are missing, an error dialog is shown to the user.
  // The application will still load, but core operations will likely fail.
  const requiredCommands = ['dd', 'lsblk', 'parted', 'resize2fs', 'udisksctl'];
  const missingCommands = await checkAllRequiredCommands(requiredCommands);
  if (missingCommands.length > 0) {
      dialog.showErrorBox(
          'Missing Required Commands',
          `The following critical commands are missing or not found in PATH: \n\n${missingCommands.join(', ')}\n\nPlease install them and ensure they are in your system's PATH for the application to function correctly.`
      );
      // For a flasher utility, these commands are essential.
      // Consider whether the app should quit if commands are missing: app.quit();
  }

  // --- IPC Handlers ---
  // These handlers define how the main process responds to messages (invocations) from the renderer process.

  // Handles the 'dialog:selectImage' event trigger from the renderer.
  // Shows an open file dialog to select a raw image file.
  // Persists the last opened directory for a better user experience.
  ipcMain.handle('dialog:selectImage', async () => {
    // Retrieve the last directory path used for opening files, to provide a consistent dialog starting point.
    const lastOpenedDirectory = store.get('lastOpenedDirectory');

    // mainWindow must be in scope for dialog.showOpenDialog.
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select RAW Image File',
        buttonLabel: 'Select Image',
        properties: ['openFile'],
        defaultPath: lastOpenedDirectory, // Start dialog in the last used directory.
        filters: [
            { name: 'RAW Disk Images', extensions: ['img', 'iso', 'bin', 'raw', 'dmg', '*'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (canceled || filePaths.length === 0) {
        return null; // User cancelled or closed the dialog.
    } else {
        const selectedFilePath = filePaths[0];
        // Store the directory of the selected file for next time.
        store.set('lastOpenedDirectory', path.dirname(selectedFilePath));
        return selectedFilePath; // Return the full path of the selected image.
    }
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
          // Using destructured flashImage directly
          await flashImage(imagePath, devicePath, totalSize, (progressData) => {
              // console.log('Main process flash progress:', progressData); // Optional: can be very noisy
              webContents.send('flash:progress', progressData); // Send progress data to renderer.
          });
          return { success: true, message: 'Flashing completed successfully.' };
      } catch (error) {
          console.error('Error during flashing in main process:', error);
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
          // Using destructured extendPartition directly
          await extendPartition(devicePath, partNum);
          return { success: true, message: `Partition ${partNum} on ${devicePath} extended successfully.` };
      } catch (error) {
          console.error(`Error during partition extension in main process for ${devicePath}:`, error);
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
          // Using destructured safeEject directly
          await safeEject(devicePath);
          return { success: true, message: `Device ${devicePath} ejected successfully.` };
      } catch (error) {
          console.error(`Error during safe eject in main process for ${devicePath}:`, error);
          return { success: false, message: error.message || `Failed to eject device ${devicePath}.` };
      }
  });

  // Handles request from renderer to show a native error dialog.
  ipcMain.on('dialog:showError', (event, title, content) => {
      dialog.showErrorBox(title || 'Error', content || 'An unexpected error occurred.');
  });

  // Handles request from renderer to show a native success/info message dialog.
  ipcMain.on('dialog:showSuccess', (event, title, content) => {
      const window = BrowserWindow.fromWebContents(event.sender); // Get the window that sent the message
      dialog.showMessageBox(window || mainWindow, { // Fallback to mainWindow if sender window not found
          type: 'info',
          title: title || 'Success',
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
