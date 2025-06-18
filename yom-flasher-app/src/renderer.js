// YOM Flash Tool - Renderer Process with Active Update Checking
document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const selectImageButton = document.getElementById('select-image-button');
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const selectedFile = document.getElementById('selected-file');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const selectedImagePathText = document.getElementById('selected-image-path-text');
    
    const deviceSelectionView = document.getElementById('device-selection-view');
    const refreshDevicesButton = document.getElementById('refresh-devices-button');
    const deviceListContainer = document.getElementById('device-list-container');
    const selectedDeviceInfoText = document.getElementById('selected-device-info-text');
    
    const flashingControlsView = document.getElementById('flashing-controls-view');
    const startFlashingButton = document.getElementById('start-flashing-button');
    const flashingProgressView = document.getElementById('flashing-progress-view');
    const progressBar = document.getElementById('progress-bar');
    const progressSpeedText = document.getElementById('progress-speed-text');
    const progressRawOutput = document.getElementById('progress-raw-output');
    
    const globalMessageContainer = document.getElementById('global-message-container');

    // NEW: Update check elements
    const updateCheckContainer = document.getElementById('update-check-container');
    const updateMessage = document.getElementById('update-message');
    const downloadLatestButton = document.getElementById('download-latest-button');

    // State
    let currentSelectedImagePath = null;
    let currentSelectedDevicePath = null;
    let availableDevices = [];
    let currentFirmwareVersion = null;
    let isLatestVersion = true;
    let isCheckingForUpdates = false;

    // Utility Functions
    function showGlobalMessage(message, type = 'info', duration = 5000) {
        if (!globalMessageContainer) return;

        globalMessageContainer.textContent = message;
        globalMessageContainer.className = 'message-container';
        globalMessageContainer.classList.add(type);
        globalMessageContainer.style.display = 'block';

        if (type === 'info' || type === 'success') {
            setTimeout(() => {
                if (globalMessageContainer.textContent === message) {
                    globalMessageContainer.style.display = 'none';
                }
            }, duration);
        }
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showView(viewId) {
        const views = [
            'image-selection-view',
            'device-selection-view', 
            'flashing-controls-view',
            'flashing-progress-view',
            'flash-completion-view'
        ];
        
        views.forEach(view => {
            const element = document.getElementById(view);
            if (element) {
                element.style.display = view === viewId ? 'block' : 'none';
            }
        });
    }

    // NEW: Active update checking after device selection
    async function checkForUpdatesAfterDeviceSelection() {
        if (isCheckingForUpdates) return;
        
        isCheckingForUpdates = true;
        console.log('🔍 Checking for updates after device selection...');
        
        try {
            const updateResult = await window.electronAPI.checkForUpdates();
            
            if (updateResult.hasUpdate) {
                console.log('🆕 New version available:', updateResult.latest.version);
                isLatestVersion = false;
                showUpdateRequired(updateResult.latest);
            } else {
                console.log('✅ Firmware is up to date');
                isLatestVersion = true;
                hideUpdateRequired();
            }
        } catch (error) {
            console.error('❌ Update check failed:', error);
            // On error, allow flashing with current version
            isLatestVersion = true;
            hideUpdateRequired();
            showGlobalMessage('Update check failed, proceeding with current version', 'warning', 3000);
        } finally {
            isCheckingForUpdates = false;
            updateFlashButtonState();
        }
    }

    // NEW: Show update required UI
    function showUpdateRequired(latestVersion) {
        if (updateCheckContainer) {
            updateCheckContainer.style.display = 'block';
        }
        if (updateMessage) {
            updateMessage.textContent = `Please update to the latest software (${latestVersion.version})`;
        }
    }

    // NEW: Hide update required UI
    function hideUpdateRequired() {
        if (updateCheckContainer) {
            updateCheckContainer.style.display = 'none';
        }
    }

    // NEW: Update flash button state based on version check
    function updateFlashButtonState() {
        const hasValidSelection = currentSelectedImagePath && currentSelectedDevicePath;
        
        if (startFlashingButton) {
            if (hasValidSelection && isLatestVersion) {
                startFlashingButton.disabled = false;
                startFlashingButton.textContent = 'start flash';
            } else if (hasValidSelection && !isLatestVersion) {
                startFlashingButton.disabled = true;
                startFlashingButton.textContent = 'update required first';
            } else {
                startFlashingButton.disabled = true;
                startFlashingButton.textContent = 'start flash';
            }
        }
    }

    function checkShowFlashingButton() {
        if (currentSelectedImagePath && currentSelectedDevicePath) {
            if (flashingControlsView) flashingControlsView.style.display = 'block';
            
            // NEW: Trigger active update check when both image and device are selected
            checkForUpdatesAfterDeviceSelection();
            
            console.log('✅ Ready to flash - checking for updates...');
        } else {
            if (flashingControlsView) flashingControlsView.style.display = 'none';
            hideUpdateRequired();
            console.log('⏳ Waiting for image and device selection');
        }
    }

    function resetToInitialState() {
        showView('image-selection-view');
        
        // Reset file selection
        currentSelectedImagePath = null;
        currentFirmwareVersion = null;
        if (selectedImagePathText) selectedImagePathText.textContent = 'None';
        if (selectedFile) selectedFile.style.display = 'none';
        if (fileInput) fileInput.value = '';
        
        // Reset device selection
        currentSelectedDevicePath = null;
        if (selectedDeviceInfoText) selectedDeviceInfoText.textContent = 'None';
        if (deviceListContainer) {
            deviceListContainer.innerHTML = '<p>Click "refresh device list" to load devices.</p>';
        }
        availableDevices = [];
        
        // Reset update state
        isLatestVersion = true;
        hideUpdateRequired();
        
        // Reset progress
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
        }
        if (progressSpeedText) progressSpeedText.textContent = 'Speed: -';
        if (progressRawOutput) progressRawOutput.textContent = '';
        
        // Hide controls and messages
        checkShowFlashingButton();
        if (globalMessageContainer) globalMessageContainer.style.display = 'none';
        
        // Re-enable buttons
        [selectImageButton, refreshDevicesButton, startFlashingButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });
    }

    // File Selection Handlers
    function processFileWithPath(file, fullPath) {
        if (!file || !fullPath) return;
        
        currentSelectedImagePath = fullPath;
        
        // Extract firmware version from filename
        const versionMatch = file.name.match(/FlashingApp_(v\d+\.\d+\.\d+)/);
        currentFirmwareVersion = versionMatch ? versionMatch[1] : 'Unknown';
        
        if (fileName) fileName.textContent = file.name;
        if (fileSize) fileSize.textContent = formatFileSize(file.size || 0);
        if (selectedFile) selectedFile.style.display = 'block';
        
        console.log('Selected image with full path:', currentSelectedImagePath);
        console.log('Extracted firmware version:', currentFirmwareVersion);
        switchToDeviceSelectionView();
    }

    // Device Selection
    function switchToDeviceSelectionView() {
        showView('device-selection-view');
        if (refreshDevicesButton) refreshDevicesButton.click();
        checkShowFlashingButton();
    }

    function renderDeviceList(devices) {
        if (!deviceListContainer) return;
        
        deviceListContainer.innerHTML = '';

        if (!devices || devices.length === 0) {
            deviceListContainer.innerHTML = '<p>No compatible devices found. Ensure SSD is connected and try refreshing.</p>';
            return;
        }

        const ul = document.createElement('ul');
        devices.forEach(device => {
            const li = document.createElement('li');
            
            let labelText = `${device.path} - ${device.model} (${(device.size / (1024**3)).toFixed(2)} GB)`;
            let isDisabled = false;
            
            if (device.isOS) {
                labelText += ' <strong style="color: #00FF44;">(OS Drive)</strong>';
                isDisabled = true;
                li.title = 'This is your operating system drive and cannot be selected.';
            }

            li.innerHTML = labelText;
            
            if (isDisabled) {
                li.classList.add('disabled-item');
            } else {
                li.addEventListener('click', () => {
                    currentSelectedDevicePath = device.path;
                    if (selectedDeviceInfoText) {
                        selectedDeviceInfoText.textContent = `${device.path} - ${device.model}`;
                    }

                    // Update selection styling
                    const currentSelection = ul.querySelector('li.selected-item');
                    if (currentSelection) {
                        currentSelection.classList.remove('selected-item');
                    }
                    li.classList.add('selected-item');

                    console.log('Selected device:', currentSelectedDevicePath);
                    console.log('Image path available:', currentSelectedImagePath);
                    
                    // Show flash button after device selection and trigger update check
                    checkShowFlashingButton();
                    
                    // Auto-show flash controls if both image and device are selected
                    if (currentSelectedImagePath && currentSelectedDevicePath) {
                        console.log('✅ Both image and device selected - showing flash controls and checking updates');
                        showView('flashing-controls-view');
                        showGlobalMessage('Checking for firmware updates...', 'info', 2000);
                    } else {
                        console.log('⏳ Still missing:', {
                            image: !!currentSelectedImagePath,
                            device: !!currentSelectedDevicePath
                        });
                    }
                });
            }
            ul.appendChild(li);
        });
        deviceListContainer.appendChild(ul);
    }

    if (refreshDevicesButton) {
        refreshDevicesButton.addEventListener('click', async () => {
            refreshDevicesButton.disabled = true;
            deviceListContainer.innerHTML = '<p>Loading devices...</p>';
            
            try {
                const result = await window.electronAPI.listDevices();
                if (result.error) {
                    showGlobalMessage(result.message || 'Failed to list devices.', 'error');
                    deviceListContainer.innerHTML = '<p>Failed to load devices. Check messages above.</p>';
                    availableDevices = [];
                } else {
                    availableDevices = result;
                    renderDeviceList(availableDevices);
                }
            } catch (error) {
                console.error('Error fetching devices:', error);
                deviceListContainer.innerHTML = `<p style="color: #dc3545;">Error fetching devices: ${error.message}</p>`;
                availableDevices = [];
            } finally {
                refreshDevicesButton.disabled = false;
            }
        });
    }

    // NEW: Download latest firmware handler
    if (downloadLatestButton) {
        downloadLatestButton.addEventListener('click', async () => {
            downloadLatestButton.disabled = true;
            downloadLatestButton.textContent = 'Downloading...';
            
            try {
                // Get latest version info first
                const updateResult = await window.electronAPI.checkForUpdates();
                if (!updateResult.hasUpdate) {
                    showGlobalMessage('No updates available', 'info');
                    return;
                }
                
                // Download the latest version
                const result = await window.electronAPI.downloadFirmware(updateResult.latest.version);
                
                if (result.success) {
                    showGlobalMessage('Latest firmware downloaded successfully!', 'success');
                    
                    // Update current selected path to new firmware
                    if (result.firmware && result.firmware.path) {
                        currentSelectedImagePath = result.firmware.path;
                        currentFirmwareVersion = result.firmware.version;
                        
                        // Update file display
                        if (fileName) fileName.textContent = result.firmware.filename;
                        if (fileSize) fileSize.textContent = formatFileSize(result.firmware.size);
                        
                        // Update renderer.js global for compatibility
                        if (window.setCurrentSelectedImagePath) {
                            window.setCurrentSelectedImagePath(result.firmware.path);
                        }
                    }
                    
                    // Mark as latest version and update UI
                    isLatestVersion = true;
                    hideUpdateRequired();
                    updateFlashButtonState();
                    
                    showGlobalMessage('✅ Ready to flash with latest firmware!', 'success');
                } else {
                    showGlobalMessage('Download failed: ' + result.error, 'error');
                }
            } catch (error) {
                showGlobalMessage('Download failed: ' + error.message, 'error');
            } finally {
                downloadLatestButton.disabled = false;
                downloadLatestButton.textContent = 'Download Latest';
            }
        });
    }

    // Flash Progress Handler
    const handleFlashProgress = (progressData) => {
        if (progressData.progress !== undefined) {
            const percent = Math.round(progressData.progress);
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
                progressBar.textContent = `${percent}%`;
            }
        }
        if (progressData.speed && progressSpeedText) {
            progressSpeedText.textContent = `Speed: ${progressData.speed}`;
        }
        if (progressData.rawLine && progressRawOutput) {
            progressRawOutput.textContent += progressData.rawLine + '\n';
            progressRawOutput.scrollTop = progressRawOutput.scrollHeight;
        }
        if (progressData.progress === 100 && progressSpeedText) {
            progressSpeedText.textContent = 'Finalizing...';
        }
    };

    if (window.electronAPI && window.electronAPI.onFlashProgress) {
        window.electronAPI.onFlashProgress(handleFlashProgress);
    }

    // Flash Operation (updated validation)
    if (startFlashingButton) {
        startFlashingButton.addEventListener('click', async () => {
            // Enhanced validation
            if (globalMessageContainer) globalMessageContainer.style.display = 'none';
            
            if (!currentSelectedImagePath || !currentSelectedDevicePath) {
                if (window.electronAPI && window.electronAPI.showErrorDialog) {
                    window.electronAPI.showErrorDialog('Input Missing', 'Please select an image file and a target device first.');
                }
                return;
            }

            if (!isLatestVersion) {
                showGlobalMessage('Please download the latest firmware before flashing', 'error');
                return;
            }

            console.log('Starting flash operation:');
            console.log('Image:', currentSelectedImagePath);
            console.log('Device:', currentSelectedDevicePath);
            console.log('Firmware Version:', currentFirmwareVersion);

            // Confirmation with version info
            const confirmed = confirm(
                `WARNING: You are about to flash:\n\n` +
                `Image: ${currentSelectedImagePath}\n` +
                `Version: ${currentFirmwareVersion}\n` +
                `Target: ${currentSelectedDevicePath}\n\n` +
                `ALL DATA ON ${currentSelectedDevicePath} WILL BE ERASED. ` +
                `This action is irreversible.\n\nAre you absolutely sure you want to proceed?`
            );

            if (!confirmed) {
                console.log('Flashing cancelled by user.');
                return;
            }

            // Setup UI for flashing
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.textContent = '0%';
            }
            if (progressSpeedText) progressSpeedText.textContent = 'Speed: -';
            if (progressRawOutput) progressRawOutput.textContent = '';

            showView('flashing-progress-view');

            // Disable controls
            [selectImageButton, refreshDevicesButton, startFlashingButton, downloadLatestButton].forEach(btn => {
                if (btn) btn.disabled = true;
            });

            const listItems = deviceListContainer.querySelectorAll('ul li:not(.disabled-item)');
            listItems.forEach(item => item.classList.add('disabled-during-flash'));

            try {
                // Flash operation
                const result = await window.electronAPI.startFlash(currentSelectedImagePath, currentSelectedDevicePath);
                
                if (result.success) {
                    if (progressBar) {
                        progressBar.textContent = 'Flash Done!';
                        progressBar.style.background = 'linear-gradient(90deg, #28a745 0%, #20c997 100%)';
                    }
                    if (progressSpeedText) {
                        progressSpeedText.textContent = 'Flash completed. Now attempting to extend partition...';
                    }
                    if (progressRawOutput) {
                        progressRawOutput.textContent += "\nFlash completed successfully.\nStarting partition extension...\n";
                        progressRawOutput.scrollTop = progressRawOutput.scrollHeight;
                    }

                    // Extend partition
                    try {
                        const extendResult = await window.electronAPI.extendPartition(currentSelectedDevicePath, 3);
                        if (extendResult.success) {
                            if (progressSpeedText) {
                                progressSpeedText.textContent = 'Partition extended. Now attempting safe eject...';
                            }
                            if (progressRawOutput) {
                                progressRawOutput.textContent += extendResult.message + "\nStarting safe eject...\n";
                                progressRawOutput.scrollTop = progressRawOutput.scrollHeight;
                            }

                            // Safe eject
                            try {
                                const ejectResult = await window.electronAPI.safeEject(currentSelectedDevicePath);
                                if (ejectResult.success) {
                                    if (progressBar) progressBar.textContent = 'All Done!';
                                    
                                    // Show completion screen if available, otherwise show success dialog
                                    if (result.logEntry && window.updateManager && window.updateManager.showFlashCompletion) {
                                        window.updateManager.showFlashCompletion(result.logEntry);
                                    } else if (window.electronAPI && window.electronAPI.showSuccessDialog) {
                                        window.electronAPI.showSuccessDialog('Operation Successful', 'All operations completed successfully! The device can now be safely removed.');
                                        resetToInitialState();
                                    }
                                } else {
                                    if (progressSpeedText) {
                                        progressSpeedText.textContent = `Eject Error: ${ejectResult.message}`;
                                    }
                                    if (progressRawOutput) {
                                        progressRawOutput.textContent += `Eject Error: ${ejectResult.message}\n`;
                                    }
                                    if (window.electronAPI && window.electronAPI.showErrorDialog) {
                                        window.electronAPI.showErrorDialog('Device Eject Failed', ejectResult.message || 'Failed to eject device.');
                                    }
                                }
                            } catch (ejectError) {
                                console.error('Error calling safeEject:', ejectError);
                                if (progressSpeedText) {
                                    progressSpeedText.textContent = `Eject Error: ${ejectError.message}`;
                                }
                                if (progressRawOutput) {
                                    progressRawOutput.textContent += `Eject Error: ${ejectError.message}\n`;
                                }
                                if (window.electronAPI && window.electronAPI.showErrorDialog) {
                                    window.electronAPI.showErrorDialog('Device Eject Failed', ejectError.message || 'Unexpected error during device ejection.');
                                }
                            }
                        } else {
                            if (progressSpeedText) {
                                progressSpeedText.textContent = `Partition Extension Error: ${extendResult.message}`;
                            }
                            if (progressRawOutput) {
                                progressRawOutput.textContent += `Partition Extension Error: ${extendResult.message}\n`;
                            }
                            if (window.electronAPI && window.electronAPI.showErrorDialog) {
                                window.electronAPI.showErrorDialog('Partition Extension Failed', extendResult.message || 'Failed to extend partition.');
                            }
                        }
                    } catch (extendError) {
                        console.error('Error calling extendPartition:', extendError);
                        if (progressSpeedText) {
                            progressSpeedText.textContent = `Partition Extension Error: ${extendError.message}`;
                        }
                        if (progressRawOutput) {
                            progressRawOutput.textContent += `Partition Extension Error: ${extendError.message}\n`;
                        }
                        if (window.electronAPI && window.electronAPI.showErrorDialog) {
                            window.electronAPI.showErrorDialog('Partition Extension Failed', extendError.message || 'Unexpected error during partition extension.');
                        }
                    }
                } else {
                    if (progressBar) {
                        progressBar.textContent = 'Error!';
                        progressBar.style.background = 'linear-gradient(90deg, #dc3545 0%, #c82333 100%)';
                    }
                    if (progressSpeedText) {
                        progressSpeedText.textContent = `Error: ${result.message}`;
                    }
                    if (progressRawOutput) {
                        progressRawOutput.textContent += `Flashing Error: ${result.message}\n`;
                    }
                    if (window.electronAPI && window.electronAPI.showErrorDialog) {
                        window.electronAPI.showErrorDialog('Flashing Failed', result.message || 'Flashing operation failed.');
                    }
                }
            } catch (error) {
                console.error('Error in operation sequence:', error);
                if (progressBar) {
                    progressBar.textContent = 'Critical Error!';
                    progressBar.style.background = 'linear-gradient(90deg, #dc3545 0%, #c82333 100%)';
                }
                if (progressSpeedText) {
                    progressSpeedText.textContent = `Critical Error: ${error.message}`;
                }
                if (window.electronAPI && window.electronAPI.showErrorDialog) {
                    window.electronAPI.showErrorDialog('Critical Error', `An unexpected critical error occurred: ${error.message}`);
                }
            } finally {
                // Re-enable controls
                [selectImageButton, refreshDevicesButton, startFlashingButton, downloadLatestButton].forEach(btn => {
                    if (btn) btn.disabled = false;
                });
                listItems.forEach(item => item.classList.remove('disabled-during-flash'));
            }
        });
    }

    // Make functions available globally for integration with updateManager
    window.switchToDeviceSelectionView = switchToDeviceSelectionView;
    window.showGlobalMessage = showGlobalMessage;
    window.setCurrentSelectedImagePath = (path) => {
        currentSelectedImagePath = path;
        console.log('Image path set from updateManager:', currentSelectedImagePath);
        checkShowFlashingButton();
    };
    window.getCurrentSelectedImagePath = () => currentSelectedImagePath;

    // Initialize
    checkShowFlashingButton();
    if (globalMessageContainer) globalMessageContainer.style.display = 'none';
});