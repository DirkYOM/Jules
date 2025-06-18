// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // === ADMIN SETUP ===
    requestAdminSetup: () => ipcRenderer.invoke('admin:setup'),
    
    // === FILE OPERATIONS ===
    // Still needed for firmware file info and validation
    getFileInfo: (filePath) => ipcRenderer.invoke('file:getInfo', filePath),
    
    // === DEVICE MANAGEMENT ===
    listDevices: () => ipcRenderer.invoke('system:listDevices'),
    getDeviceSerial: (devicePath) => ipcRenderer.invoke('device:getSerial', devicePath),
    
    // === FLASH OPERATIONS ===
    startFlash: (imagePath, devicePath) => ipcRenderer.invoke('flash:start', imagePath, devicePath),
    onFlashProgress: (callback) => ipcRenderer.on('flash:progress', (_event, value) => callback(value)),
    removeFlashProgressListener: (callback) => ipcRenderer.removeListener('flash:progress', callback),
    
    // === POST-FLASH OPERATIONS ===
    extendPartition: (devicePath, partitionNumber) => ipcRenderer.invoke('partition:extend', devicePath, partitionNumber),
    safeEject: (devicePath) => ipcRenderer.invoke('device:eject', devicePath),
    
    // === DIALOG HELPERS ===
    showErrorDialog: (title, content) => ipcRenderer.send('dialog:showError', title, content),
    showSuccessDialog: (title, content) => ipcRenderer.send('dialog:showSuccess', title, content),
    
    // === UPDATE MANAGEMENT ===
    
    // Update checking
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    onNewVersionAvailable: (callback) => ipcRenderer.on('update:newVersionAvailable', (_event, value) => callback(value)),
    removeNewVersionListener: (callback) => ipcRenderer.removeListener('update:newVersionAvailable', callback),
    
    // Version management
    getLocalVersions: () => ipcRenderer.invoke('update:getLocalVersions'),
    getAutoSelectedFirmware: () => ipcRenderer.invoke('update:getAutoSelected'),
    
    // Manual download management
    downloadFirmware: (version) => ipcRenderer.invoke('update:download', version),
    onDownloadProgress: (callback) => ipcRenderer.on('update:downloadProgress', (_event, value) => callback(value)),
    removeDownloadProgressListener: (callback) => ipcRenderer.removeListener('update:downloadProgress', callback),
    
    // Firmware refresh event
    onFirmwareRefreshed: (callback) => ipcRenderer.on('update:firmwareRefreshed', (_event, value) => callback(value)),
    removeFirmwareRefreshListener: (callback) => ipcRenderer.removeListener('update:firmwareRefreshed', callback),
    
    // Log management
    exportFlashLog: (format = 'csv') => ipcRenderer.invoke('update:exportLog', format),
    
    // Storage management
    validateStorage: () => ipcRenderer.invoke('update:validateStorage'),
    cleanupStorage: () => ipcRenderer.invoke('update:cleanupStorage'),
    
    // === UTILITY FUNCTIONS ===
    
    // Format file sizes for display
    formatFileSize: (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    
    // Format time duration for display
    formatDuration: (seconds) => {
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    },
    
    // Compare version strings
    compareVersions: (a, b) => {
        const aVersion = a.replace(/^v/, '').split('.').map(Number);
        const bVersion = b.replace(/^v/, '').split('.').map(Number);
        
        for (let i = 0; i < Math.max(aVersion.length, bVersion.length); i++) {
            const aNum = aVersion[i] || 0;
            const bNum = bVersion[i] || 0;
            
            if (aNum > bNum) return 1;
            if (aNum < bNum) return -1;
        }
        return 0;
    }
});