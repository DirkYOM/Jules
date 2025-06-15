// YOM Flash Tool - Renderer Process
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

    // State
    let currentSelectedImagePath = null;
    let currentSelectedDevicePath = null;
    let availableDevices = [];

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
            'flashing-progress-view'
        ];
        
        views.forEach(view => {
            const element = document.getElementById(view);
            if (element) {
                element.style.display = view === viewId ? 'block' : 'none';
            }
        });
    }

    function checkShowFlashingButton() {
        if (currentSelectedImagePath && currentSelectedDevicePath) {
            if (flashingControlsView) flashingControlsView.style.display = 'block';
        } else {
            if (flashingControlsView) flashingControlsView.style.display = 'none';
        }
    }

    function resetToInitialState() {
        showView('image-selection-view');
        
        // Reset file selection
        currentSelectedImagePath = null;
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
        
        currentSelectedImagePath = fullPath; // Use the full path provided
        
        if (fileName) fileName.textContent = file.name;
        if (fileSize) fileSize.textContent = formatFileSize(file.size || 0);
        if (selectedFile) selectedFile.style.display = 'block';
        
        console.log('Selected image with full path:', currentSelectedImagePath);
        switchToDeviceSelectionView();
    }

    // Upload area handlers - Use Electron dialog instead of file input
    if (uploadArea) {
        uploadArea.addEventListener('click', async () => {
            try {
                const filePath = await window.electronAPI.selectImage();
                if (filePath) {
                    currentSelectedImagePath = filePath;
                    
                    // Extract filename and update UI
                    const selectedFileName = filePath.split('/').pop() || filePath.split('\\').pop();
                    
                    // Update UI elements using getElementById to avoid conflicts
                    if (fileName) fileName.textContent = selectedFileName;
                    if (fileSize) fileSize.textContent = 'Getting file size...';
                    if (selectedFile) selectedFile.style.display = 'block';
                    
                    // Try to get file info for better display
                    try {
                        const fileInfo = await window.electronAPI.getFileInfo(filePath);
                        if (fileInfo.success && fileSize) {
                            fileSize.textContent = formatFileSize(fileInfo.size);
                        }
                    } catch (error) {
                        console.warn('Could not get file info:', error);
                        if (fileSize) fileSize.textContent = 'Unknown size';
                    }
                    
                    console.log('Selected image via click:', currentSelectedImagePath);
                    switchToDeviceSelectionView();
                }
            } catch (error) {
                console.error('Error selecting image:', error);
                showGlobalMessage('Error selecting file: ' + error.message, 'error');
            }
        });
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#00FF44';
            uploadArea.style.background = 'rgba(0, 255, 68, 0.1)';
        });
        
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'rgba(0, 255, 68, 0.3)';
            uploadArea.style.background = 'transparent';
        });
        
        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'rgba(0, 255, 68, 0.3)';
            uploadArea.style.background = 'transparent';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                console.log('Dropped file:', file.name);
                
                showGlobalMessage(`Locating "${file.name}"...`, 'info', 2000);
                
                try {
                    // Try to find the dragged file in common locations
                    const result = await window.electronAPI.validateDraggedFile(file.name);
                    
                    if (result.success && result.found) {
                        // File found! Use it directly
                        currentSelectedImagePath = result.path;
                        
                        // Update UI elements
                        if (fileName) fileName.textContent = result.name;
                        if (fileSize) fileSize.textContent = formatFileSize(result.size);
                        if (selectedFile) selectedFile.style.display = 'block';
                        
                        showGlobalMessage(`Successfully located: ${result.name}`, 'success', 2000);
                        console.log('Auto-selected dragged file:', currentSelectedImagePath);
                        
                        switchToDeviceSelectionView();
                    } else {
                        // File not found - fall back to dialog
                        showGlobalMessage(`Could not locate "${file.name}". Please select it manually...`, 'info', 3000);
                        
                        setTimeout(async () => {
                            try {
                                const filePath = await window.electronAPI.selectImage({ 
                                    suggestedFilename: file.name 
                                });
                                
                                if (filePath) {
                                    const selectedFileName = filePath.split('/').pop() || filePath.split('\\').pop();
                                    
                                    if (selectedFileName === file.name) {
                                        showGlobalMessage(`Perfect! Selected the dragged file: ${file.name}`, 'success', 2000);
                                    } else {
                                        showGlobalMessage(`Selected: ${selectedFileName}`, 'info', 2000);
                                    }
                                    
                                    currentSelectedImagePath = filePath;
                                    
                                    if (fileName) fileName.textContent = selectedFileName;
                                    if (fileSize) fileSize.textContent = formatFileSize(file.size || 0);
                                    if (selectedFile) selectedFile.style.display = 'block';
                                    
                                    console.log('Selected image after drag-drop dialog:', currentSelectedImagePath);
                                    switchToDeviceSelectionView();
                                } else {
                                    showGlobalMessage('File selection cancelled', 'info', 2000);
                                }
                            } catch (error) {
                                console.error('Error in drag-drop file selection:', error);
                                showGlobalMessage('Error selecting file: ' + error.message, 'error');
                            }
                        }, 500);
                    }
                } catch (error) {
                    console.error('Error validating dragged file:', error);
                    showGlobalMessage('Error processing dragged file: ' + error.message, 'error');
                }
            }
        });
    }

    // Legacy button support - Keep original working logic
    if (selectImageButton) {
        selectImageButton.addEventListener('click', async () => {
            try {
                const filePath = await window.electronAPI.selectImage();
                if (filePath) {
                    currentSelectedImagePath = filePath;
                    if (selectedImagePathText) {
                        selectedImagePathText.textContent = filePath;
                    }
                    
                    // Extract filename and update UI
                    const selectedFileName = filePath.split('/').pop() || filePath.split('\\').pop();
                    
                    // Update new UI elements
                    if (fileName) fileName.textContent = selectedFileName;
                    if (fileSize) fileSize.textContent = 'Getting file size...';
                    if (selectedFile) selectedFile.style.display = 'block';
                    
                    // Try to get file info for better display
                    try {
                        const fileInfo = await window.electronAPI.getFileInfo(filePath);
                        if (fileInfo.success && fileSize) {
                            fileSize.textContent = formatFileSize(fileInfo.size);
                        }
                    } catch (error) {
                        console.warn('Could not get file info:', error);
                        if (fileSize) fileSize.textContent = 'Unknown size';
                    }
                    
                    console.log('Selected image path:', filePath);
                    switchToDeviceSelectionView();
                }
            } catch (error) {
                console.error('Error selecting image:', error);
                if (selectedImagePathText) {
                    selectedImagePathText.textContent = 'Error selecting file.';
                }
                showGlobalMessage('Error selecting file: ' + error.message, 'error');
            }
        });
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
                    checkShowFlashingButton();
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

    // Flash Operation
    if (startFlashingButton) {
        startFlashingButton.addEventListener('click', async () => {
            // Validation
            if (globalMessageContainer) globalMessageContainer.style.display = 'none';
            if (!currentSelectedImagePath || !currentSelectedDevicePath) {
                if (window.electronAPI && window.electronAPI.showErrorDialog) {
                    window.electronAPI.showErrorDialog('Input Missing', 'Please select an image file and a target device first.');
                }
                return;
            }

            // Confirmation
            const confirmed = confirm(
                `WARNING: You are about to flash:\n\n` +
                `Image: ${currentSelectedImagePath}\n` +
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
            [selectImageButton, refreshDevicesButton, startFlashingButton].forEach(btn => {
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
                                    if (window.electronAPI && window.electronAPI.showSuccessDialog) {
                                        window.electronAPI.showSuccessDialog('Operation Successful', 'All operations completed successfully! The device can now be safely removed.');
                                    }
                                    resetToInitialState();
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
                [selectImageButton, refreshDevicesButton, startFlashingButton].forEach(btn => {
                    if (btn) btn.disabled = false;
                });
                listItems.forEach(item => item.classList.remove('disabled-during-flash'));
            }
        });
    }

    // Make switchToDeviceSelectionView available globally for legacy support
    window.switchToDeviceSelectionView = switchToDeviceSelectionView;

    // Initialize
    checkShowFlashingButton();
    if (globalMessageContainer) globalMessageContainer.style.display = 'none';
});