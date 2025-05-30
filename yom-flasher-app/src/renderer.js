// src/renderer.js
document.addEventListener('DOMContentLoaded', () => {
    const selectImageButton = document.getElementById('select-image-button');
    const selectedImagePathText = document.getElementById('selected-image-path-text');
    let currentSelectedImagePath = null;

    if (selectImageButton) {
        selectImageButton.addEventListener('click', async () => {
            try {
                const filePath = await window.electronAPI.selectImage();
                if (filePath) {
                    selectedImagePathText.textContent = filePath;
                    currentSelectedImagePath = filePath;
                    console.log('Selected image path:', filePath);
                    // TODO: Store this path for the next step in the workflow
                    if(window.switchToDeviceSelectionView) window.switchToDeviceSelectionView(); // Switch to device selection view
                } else {
                    // selectedImagePathText.textContent = 'No file selected.'; // Or keep previous
                    console.log('File selection cancelled or no file selected.');
                }
            } catch (error) {
                console.error('Error selecting image:', error);
                selectedImagePathText.textContent = 'Error selecting file.';
            }
        });
    } else {
        console.error('Select image button not found.');
    }

    const deviceSelectionView = document.getElementById('device-selection-view');
    const refreshDevicesButton = document.getElementById('refresh-devices-button');
    const deviceListContainer = document.getElementById('device-list-container');
    const selectedDeviceInfoText = document.getElementById('selected-device-info-text');
    let currentSelectedDevicePath = null;
    let availableDevices = []; // To store the fetched device list

    // Placeholder: Simple view switching logic (can be improved later)
    // For now, assume image selection completion will make device view visible.
    // Example: document.getElementById('image-selection-view').style.display = 'none';
    //          deviceSelectionView.style.display = 'block';

    if (refreshDevicesButton) {
        refreshDevicesButton.addEventListener('click', async () => {
            deviceListContainer.innerHTML = '<p>Loading devices...</p>'; // Show loading state
            try {
                const result = await window.electronAPI.listDevices();
                if (result.error) {
                    deviceListContainer.innerHTML = `<p style="color: red;">Error: ${result.message}</p>`;
                    availableDevices = [];
                    return;
                }

                availableDevices = result; // Store the devices
                renderDeviceList(availableDevices);

            } catch (error) { // Should not happen if main process returns {error: true} structure
                console.error('Error fetching devices in renderer:', error);
                deviceListContainer.innerHTML = `<p style="color: red;">Error fetching devices: ${error.message}</p>`;
                availableDevices = [];
            }
        });
    } else {
        console.error('Refresh devices button not found.');
    }

    function renderDeviceList(devices) {
        deviceListContainer.innerHTML = ''; // Clear previous list or loading message

        if (!devices || devices.length === 0) {
            deviceListContainer.innerHTML = '<p>No compatible devices found. Ensure SSD is connected and try refreshing.</p>';
            return;
        }

        const ul = document.createElement('ul');
        ul.style.listStyleType = 'none';
        ul.style.padding = '0';

        devices.forEach(device => {
            const li = document.createElement('li');
            li.style.padding = '8px';
            li.style.borderBottom = '1px solid #eee';
            li.style.cursor = 'pointer';

            let labelText = `${device.path} - ${device.model} (${(device.size / (1024**3)).toFixed(2)} GB)`;
            let isDisabled = false;
            let tooltip = '';

            if (device.isOS) {
                labelText += ' <strong style="color: orange;">(OS Drive)</strong>';
                isDisabled = true;
                tooltip = 'This is your operating system drive and cannot be selected.';
            }
            // TODO: Implement source drive check if currentSelectedImagePath is set and device.path matches its source.
            // For now, only OS drive check from systemUtils is used.

            li.innerHTML = labelText;
            if (isDisabled) {
                // li.style.opacity = '0.5'; // Covered by .disabled-item class
                // li.style.cursor = 'not-allowed'; // Covered by .disabled-item class
                li.classList.add('disabled-item');
                li.title = tooltip;
            } else {
                // Hover effects are now handled by CSS :not(.disabled-item):hover
                li.addEventListener('click', () => {
                    currentSelectedDevicePath = device.path;
                    selectedDeviceInfoText.textContent = `${device.path} - ${device.model}`;

                    // Handle selected item styling via class
                    const currentSelection = ul.querySelector('li.selected-item');
                    if (currentSelection) {
                        currentSelection.classList.remove('selected-item');
                    }
                    li.classList.add('selected-item');

                    console.log('Selected device:', currentSelectedDevicePath);
                    // TODO: Store this for the flashing step.
                    checkShowFlashingButton(); // Check if we can show flashing button
                });
            }
            ul.appendChild(li);
        });
        deviceListContainer.appendChild(ul);
    }

    // Basic view switching example (call this when image selection is done)
    window.switchToDeviceSelectionView = () => { // Original function modified
        showView('device-selection');
        if(refreshDevicesButton) refreshDevicesButton.click();
        // Check if we can show flashing button - this is now done when a device is selected or image selected.
        // currentSelectedImagePath should be set before this is called.
        checkShowFlashingButton();
    };

    const flashingControlsView = document.getElementById('flashing-controls-view');
    const startFlashingButton = document.getElementById('start-flashing-button');
    const flashingProgressView = document.getElementById('flashing-progress-view');
    const progressBar = document.getElementById('progress-bar');
    const progressSpeedText = document.getElementById('progress-speed-text');
    const progressRawOutput = document.getElementById('progress-raw-output');
    // const cancelFlashingButton = document.getElementById('cancel-flashing-button'); // For future

    // Function to update view states (can be expanded)
    function showView(viewId) {
        const imageSelView = document.getElementById('image-selection-view');
        // deviceSelectionView is already defined
        // flashingControlsView and flashingProgressView are already defined

        if(imageSelView) imageSelView.style.display = 'none';
        if(deviceSelectionView) deviceSelectionView.style.display = 'none';
        if(flashingControlsView) flashingControlsView.style.display = 'none';
        if(flashingProgressView) flashingProgressView.style.display = 'none';

        if (viewId === 'image-selection') {
            if(imageSelView) imageSelView.style.display = 'block';
        } else if (viewId === 'device-selection') {
            if(deviceSelectionView) deviceSelectionView.style.display = 'block';
        } else if (viewId === 'flashing-controls') { // This view is an addition to others
            if(flashingControlsView) flashingControlsView.style.display = 'block';
        } else if (viewId === 'flashing-progress') {
            if(flashingProgressView) flashingProgressView.style.display = 'block';
        }
    }

    function checkShowFlashingButton() {
        if (currentSelectedImagePath && currentSelectedDevicePath) {
            if(flashingControlsView) flashingControlsView.style.display = 'block';
        } else {
            if(flashingControlsView) flashingControlsView.style.display = 'none';
        }
    }

    // Initial check in case paths are already set (e.g. future state persistence)
    checkShowFlashingButton();

    // Event listener for the flash progress IPC message
    const handleFlashProgress = (progressData) => {
        console.log('Renderer flash progress:', progressData);
        if (progressData.progress !== undefined) {
            progressBar.style.width = `${progressData.progress}%`;
            progressBar.textContent = `${progressData.progress}%`;
        }
        if (progressData.speed) {
            progressSpeedText.textContent = `Speed: ${progressData.speed}`;
        }
        if (progressData.rawLine) {
             progressRawOutput.textContent += progressData.rawLine + '\n';
             progressRawOutput.scrollTop = progressRawOutput.scrollHeight;
        }
        if (progressData.progress === 100) {
            progressSpeedText.textContent = 'Finalizing...';
        }
    };
    window.electronAPI.onFlashProgress(handleFlashProgress);
    // Remember to clean up this listener if the component/view is ever destroyed:
    // window.electronAPI.removeFlashProgressListener(handleFlashProgress);


    if (startFlashingButton) {
        startFlashingButton.addEventListener('click', async () => {
            if (!currentSelectedImagePath || !currentSelectedDevicePath) {
                window.electronAPI.showErrorDialog('Input Missing', 'Please select an image file and a target device first.');
                return;
            }

            const confirmed = confirm(
                `WARNING: You are about to flash:\n\n` +
                `Image: ${currentSelectedImagePath}\n` +
                `Target: ${currentSelectedDevicePath}\n\n` +
                `ALL DATA ON ${currentSelectedDevicePath} WILL BE ERASED. ` +
                `This action is irreversible.\n\nAre you absolutely sure you want to proceed?`
            );

            if (!confirmed) {
                console.log('Flashing cancelled by user confirmation.');
                return;
            }

            // Reset progress UI for a new flashing attempt
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            progressBar.style.backgroundColor = '#00FF44'; // YOM Green
            progressSpeedText.textContent = 'Speed: -';
            progressRawOutput.textContent = '';


            showView('flashing-progress'); // Show only progress view
            // Hide device selection and image selection views explicitly if not handled by showView
            if(document.getElementById('image-selection-view')) document.getElementById('image-selection-view').style.display = 'none';
            if(document.getElementById('device-selection-view')) document.getElementById('device-selection-view').style.display = 'none';
            if(flashingControlsView) flashingControlsView.style.display = 'none';


            progressRawOutput.textContent = '';
            if(selectImageButton) selectImageButton.disabled = true;
            if(refreshDevicesButton) refreshDevicesButton.disabled = true;
            startFlashingButton.disabled = true;
            // TODO: Disable device list items interactivity more robustly

            try {
                const result = await window.electronAPI.startFlash(currentSelectedImagePath, currentSelectedDevicePath);
                if (result.success) {
                    progressBar.textContent = 'Flash Done!';
                    progressBar.style.backgroundColor = '#28a745'; // Green for success
                    progressSpeedText.textContent = 'Flash completed. Now attempting to extend partition...';
                    progressRawOutput.textContent += "\nFlash completed successfully.\nStarting partition extension...\n";
                    progressRawOutput.scrollTop = progressRawOutput.scrollHeight;

                    // --- NEW: Call extendPartition ---
                    try {
                        // Assuming currentSelectedDevicePath holds the path like /dev/sda
                        const extendResult = await window.electronAPI.extendPartition(currentSelectedDevicePath, 3);
                        if (extendResult.success) {
                            progressSpeedText.textContent = 'Partition extended. Now attempting safe eject...';
                            progressRawOutput.textContent += extendResult.message + "\nStarting safe eject...\n";
                            progressRawOutput.scrollTop = progressRawOutput.scrollHeight;

                            // --- NEW: Call safeEject ---
                            try {
                                const ejectResult = await window.electronAPI.safeEject(currentSelectedDevicePath);
                                if (ejectResult.success) {
                                    progressSpeedText.textContent = 'All operations completed successfully! Device ejected.';
                                    progressRawOutput.textContent += ejectResult.message + "\n";
                                    progressBar.textContent = 'All Done!';
                                    progressBar.style.backgroundColor = '#28a745'; // Green for overall success
                                    window.electronAPI.showSuccessDialog('Operation Successful', 'All operations completed successfully! The device can now be safely removed.');
                                    // Optionally reset UI to initial state here or provide a button to do so
                                } else {
                                    progressSpeedText.textContent = `Eject Error: ${ejectResult.message}`;
                                    progressRawOutput.textContent += `Eject Error: ${ejectResult.message}\n`;
                                    window.electronAPI.showErrorDialog('Device Eject Failed', ejectResult.message || 'An unknown error occurred during device ejection. Please ensure the device is not in use and try ejecting manually if needed.');
                                    // progressBar.style.backgroundColor = '#ffc107'; // Yellow for partial success
                                }
                            } catch (ejectError) { // Should not happen
                                console.error('Error calling safeEject in renderer:', ejectError);
                                progressSpeedText.textContent = `Eject Error: ${ejectError.message}`;
                                progressRawOutput.textContent += `Eject Error: ${ejectError.message}\n`;
                                window.electronAPI.showErrorDialog('Device Eject Failed', ejectError.message || 'An unexpected error occurred during device ejection.');
                                // progressBar.style.backgroundColor = '#ffc107';
                            }
                            // --- END NEW ---
                        } else { // Partition extension failed
                            progressSpeedText.textContent = `Partition Extension Error: ${extendResult.message}`;
                            progressRawOutput.textContent += `Partition Extension Error: ${extendResult.message}\n`;
                            window.electronAPI.showErrorDialog('Partition Extension Failed', extendResult.message || 'An unknown error occurred during partition extension.');
                            // progressBar.style.backgroundColor = '#ffc107'; // Yellow for partial success?
                        }
                    } catch (extendError) { // Error from extendPartition call
                        console.error('Error calling extendPartition in renderer:', extendError);
                        progressSpeedText.textContent = `Partition Extension Error: ${extendError.message}`;
                        progressRawOutput.textContent += `Partition Extension Error: ${extendError.message}\n`;
                        window.electronAPI.showErrorDialog('Partition Extension Failed', extendError.message || 'An unexpected error occurred during partition extension.');
                        // progressBar.style.backgroundColor = '#ffc107';
                    }
                } else { // Flashing failed
                    progressBar.textContent = 'Error!';
                    progressBar.style.backgroundColor = '#dc3545'; // Red for error
                    progressSpeedText.textContent = `Error: ${result.message}`;
                    progressRawOutput.textContent += `Flashing Error: ${result.message}\n`;
                    window.electronAPI.showErrorDialog('Flashing Failed', result.message || 'An unknown error occurred during flashing.');
                }
            } catch (error) { // This catches errors from any of the await window.electronAPI calls if they throw directly
                              // or any other synchronous error in the main try block of the sequence.
                console.error('Error in operation sequence:', error);
                progressBar.textContent = 'Critical Error!';
                progressBar.style.backgroundColor = '#dc3545';
                progressSpeedText.textContent = `Critical Error: ${error.message}`;
                window.electronAPI.showErrorDialog('Critical Error', `An unexpected critical error occurred: ${error.message}`);
            } finally {
                // This block will execute regardless of success or failure of the try block.
                if(selectImageButton) selectImageButton.disabled = false;
                if(refreshDevicesButton) refreshDevicesButton.disabled = false;
                startFlashingButton.disabled = false;
                // Consider resetting views or state here based on overall success.
                // For example, if all successful, could hide progress and show initial view:
                // if (progressBar.textContent === 'All Done!') {
                //   showView('image-selection');
                //   selectedImagePathText.textContent = 'None';
                //   selectedDeviceInfoText.textContent = 'None';
                //   currentSelectedImagePath = null;
                //   currentSelectedDevicePath = null;
                //   checkShowFlashingButton(); // this will hide flashing-controls-view
                // }
            }
        });
    } else {
        console.error('Start flashing button not found.');
    }

}); // End of DOMContentLoaded
