// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File selection and validation
    selectImage: (options) => ipcRenderer.invoke('dialog:selectImage', options), // Enhanced to accept options
    validateDraggedFile: (fileName) => ipcRenderer.invoke('file:validateDraggedFile', fileName), // New: Smart drag-and-drop
    getFileInfo: (filePath) => ipcRenderer.invoke('file:getInfo', filePath), // New: Get file information
    
    // Device management
    listDevices: () => ipcRenderer.invoke('system:listDevices'),
    
    // Flash operations
    startFlash: (imagePath, devicePath) => ipcRenderer.invoke('flash:start', imagePath, devicePath),
    onFlashProgress: (callback) => ipcRenderer.on('flash:progress', (_event, value) => callback(value)),
    removeFlashProgressListener: (callback) => ipcRenderer.removeListener('flash:progress', callback),
    
    // Post-flash operations
    extendPartition: (devicePath, partitionNumber) => ipcRenderer.invoke('partition:extend', devicePath, partitionNumber),
    safeEject: (devicePath) => ipcRenderer.invoke('device:eject', devicePath),
    
    // Dialog helpers
    showErrorDialog: (title, content) => ipcRenderer.send('dialog:showError', title, content),
    showSuccessDialog: (title, content) => ipcRenderer.send('dialog:showSuccess', title, content)
});