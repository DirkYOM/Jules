const { app, BrowserWindow, ipcMain, dialog } = require('electron'); // MODIFIED: Added ipcMain, dialog
const path = require('node:path'); // Note: path was 'path' before, ensure 'node:path' is okay or use 'path'
const systemUtils = require('./systemUtils'); // New: Assuming systemUtils.js is in the same directory (src)
const Store = require('electron-store'); // New

const store = new Store(); // New: Initialize electron-store

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
app.whenReady().then(() => {
  const mainWindow = createWindow(); // MODIFIED: Get mainWindow instance

  // IPC handler for image selection
  ipcMain.handle('dialog:selectImage', async () => {
    const lastOpenedDirectory = store.get('lastOpenedDirectory'); // Get stored path

    // mainWindow variable from createWindow() needs to be in scope.
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select RAW Image File',
        buttonLabel: 'Select Image',
        properties: ['openFile'],
        defaultPath: lastOpenedDirectory, // Use stored path as default
        filters: [
            { name: 'RAW Disk Images', extensions: ['img', 'iso', 'bin', 'raw', 'dmg', '*'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (canceled || filePaths.length === 0) {
        return null;
    } else {
        const selectedFilePath = filePaths[0];
        store.set('lastOpenedDirectory', path.dirname(selectedFilePath)); // Save the directory
        return selectedFilePath;
    }
  });

  ipcMain.handle('system:listDevices', async () => {
      try {
          const devices = await systemUtils.listBlockDevices();
          return devices;
      } catch (error) {
          console.error('Error listing devices in main process:', error);
          // It's good practice to return an error object or structure that renderer can check
          return { error: true, message: error.message || 'Failed to list devices.' };
      }
  });

  ipcMain.handle('flash:start', async (event, imagePath, devicePath) => {
      if (!imagePath || !devicePath) {
          return { success: false, message: 'Image path or device path is missing.' };
      }

      const webContents = event.sender;

      try {
          console.log(`Starting flash: Image=${imagePath}, Device=${devicePath}`);
          await systemUtils.flashImage(imagePath, devicePath, (progressData) => {
              console.log('Main process flash progress:', progressData);
              webContents.send('flash:progress', progressData);
          });
          return { success: true, message: 'Flashing completed successfully.' };
      } catch (error) {
          console.error('Error during flashing in main process:', error);
          return { success: false, message: error.message || 'Failed to flash image.' };
      }
  });

  ipcMain.handle('partition:extend', async (event, devicePath, partitionNumber) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for partition extension.' };
      }
      const partNum = partitionNumber || 3; // Default to 3 as per requirements

      try {
          console.log(`Starting partition extend: Device=${devicePath}, Partition=${partNum}`);
          await systemUtils.extendPartition(devicePath, partNum);
          return { success: true, message: `Partition ${partNum} on ${devicePath} extended successfully.` };
      } catch (error) {
          console.error(`Error during partition extension in main process for ${devicePath}:`, error);
          return { success: false, message: error.message || `Failed to extend partition ${partNum} on ${devicePath}.` };
      }
  });

  ipcMain.handle('device:eject', async (event, devicePath) => {
      if (!devicePath) {
          return { success: false, message: 'Device path is missing for eject.' };
      }

      try {
          console.log(`Starting safe eject for: Device=${devicePath}`);
          await systemUtils.safeEject(devicePath);
          return { success: true, message: `Device ${devicePath} ejected successfully.` };
      } catch (error) {
          console.error(`Error during safe eject in main process for ${devicePath}:`, error);
          return { success: false, message: error.message || `Failed to eject device ${devicePath}.` };
      }
  });

  ipcMain.on('dialog:showError', (event, title, content) => {
      dialog.showErrorBox(title || 'Error', content || 'An unexpected error occurred.');
  });

  ipcMain.on('dialog:showSuccess', (event, title, content) => {
      const window = BrowserWindow.fromWebContents(event.sender); // Get the window that sent the message
      dialog.showMessageBox(window || mainWindow, { // Fallback to mainWindow if sender window not found
          type: 'info',
          title: title || 'Success',
          message: content || 'Operation completed successfully.',
          buttons: ['OK']
      });
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
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
