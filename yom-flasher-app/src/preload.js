// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'), // Existing
    listDevices: () => ipcRenderer.invoke('system:listDevices'), // Existing
    startFlash: (imagePath, devicePath) => ipcRenderer.invoke('flash:start', imagePath, devicePath), // New
    onFlashProgress: (callback) => ipcRenderer.on('flash:progress', (_event, value) => callback(value)), // Existing
    // For removing listener later if needed:
    removeFlashProgressListener: (callback) => ipcRenderer.removeListener('flash:progress', callback), // Existing
    extendPartition: (devicePath, partitionNumber) => ipcRenderer.invoke('partition:extend', devicePath, partitionNumber), // Existing
    safeEject: (devicePath) => ipcRenderer.invoke('device:eject', devicePath), // Existing
    showErrorDialog: (title, content) => ipcRenderer.send('dialog:showError', title, content), // New
    showSuccessDialog: (title, content) => ipcRenderer.send('dialog:showSuccess', title, content) // New
});
