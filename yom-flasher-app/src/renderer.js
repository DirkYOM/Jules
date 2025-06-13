// src/renderer.js
document.addEventListener('DOMContentLoaded', () => {
    const selectImageButton = document.getElementById('select-image-button');
    const selectedImagePathText = document.getElementById('selected-image-path-text');
    let currentSelectedImagePath = null;

    // Global Message Helper Function
    const globalMessageContainer = document.getElementById('global-message-container');

    /**
     * Displays a global message at the top of the application.
     * @param {string} message The message to display.
     * @param {'info' | 'success' | 'error'} [type='info'] The type of message, affecting its appearance.
     * @param {number} [duration=5000] How long the message should be visible (in ms) for 'info' and 'success' types. Error messages persist.
     */
    function showGlobalMessage(message, type = 'info', duration = 5000) {
        if (!globalMessageContainer) return;

        globalMessageContainer.textContent = message;
        globalMessageContainer.className = 'message-container'; // Reset classes
        globalMessageContainer.classList.add(type); // Add error, success, or info
        globalMessageContainer.style.display = 'block';

        if (type === 'info' || type === 'success') {
            setTimeout(() => {
                if (globalMessageContainer.textContent === message) { // Hide only if message hasn't changed
                    globalMessageContainer.style.display = 'none';
                }
            }, duration);
        }
        // For 'error' type, it persists until explicitly hidden or replaced.
    }

    // Event listener for the "Select Image" button.
    // Handles opening the file dialog and updating the UI with the selected path.
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
                    // showGlobalMessage('Image selection was cancelled.', 'info'); // Optional
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

    // --- Device Selection Elements and Logic ---
    const deviceSelectionView = document.getElementById('device-selection-view');
    const refreshDevicesButton = document.getElementById('refresh-devices-button'); // Button to refresh the list of devices
    const deviceListContainer = document.getElementById('device-list-container'); // Container for the list of devices
    const selectedDeviceInfoText = document.getElementById('selected-device-info-text');
    let currentSelectedDevicePath = null;
    let availableDevices = []; // To store the fetched device list

    // Placeholder: Simple view switching logic (can be improved later)
    // For now, assume image selection completion will make device view visible.
    // Example: document.getElementById('image-selection-view').style.display = 'none';
    //          deviceSelectionView.style.display = 'block';

    // Event listener for the "Refresh Devices" button.
    // Fetches and displays the list of available block devices.
    if (refreshDevicesButton) {
        refreshDevicesButton.addEventListener('click', async () => {
            refreshDevicesButton.disabled = true;
            deviceListContainer.innerHTML = '<p>Loading devices...</p>'; // Show loading state
            try {
                const result = await window.electronAPI.listDevices();
                if (result.error) {
                    showGlobalMessage(result.message || 'An unknown error occurred while listing devices.', 'error');
                    deviceListContainer.innerHTML = '<p>Failed to load devices. Check messages above.</p>';
                    availableDevices = [];
                    return;
                }

                availableDevices = result; // Store the devices
                renderDeviceList(availableDevices);

            } catch (error) { // Should not happen if main process returns {error: true} structure
                console.error('Error fetching devices in renderer:', error);
                deviceListContainer.innerHTML = `<p style="color: red;">Error fetching devices: ${error.message}</p>`;
                availableDevices = [];
            } finally {
                refreshDevicesButton.disabled = false;
            }
        });
    } else {
        console.error('Refresh devices button not found.');
    }

    /**
     * Renders the list of available block devices in the UI.
     * @param {Array<Object>} devices - An array of device objects from `systemUtils.listBlockDevices`.
     * Each object should have `path`, `model`, `size`, and `isOS` properties.
     */
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

    /**
     * Switches the application to the device selection view.
     * Typically called after an image has been successfully selected.
     * It also triggers an automatic refresh of the device list.
     */
    window.switchToDeviceSelectionView = () => { // Original function modified
        showView('device-selection');
        if(refreshDevicesButton) refreshDevicesButton.click(); // Auto-refresh devices on view switch
        // Check if we can show flashing button - this is now done when a device is selected or image selected.
        // currentSelectedImagePath should be set before this is called.
        checkShowFlashingButton();
    };

    // --- Flashing Controls and Progress Elements ---
    const flashingControlsView = document.getElementById('flashing-controls-view');
    const startFlashingButton = document.getElementById('start-flashing-button'); // Button to initiate the flashing process
    const flashingProgressView = document.getElementById('flashing-progress-view');
    const progressBar = document.getElementById('progress-bar');
    const progressSpeedText = document.getElementById('progress-speed-text');
    const progressRawOutput = document.getElementById('progress-raw-output');
    // const cancelFlashingButton = document.getElementById('cancel-flashing-button'); // For future

    /**
     * Resets the application UI to its initial state, clearing selections,
     * progress, and messages, and returning to the image selection view.
     */
    function resetToInitialState() {
        showView('image-selection');

        selectedImagePathText.textContent = 'None';
        currentSelectedImagePath = null;
        selectedDeviceInfoText.textContent = 'None';
        currentSelectedDevicePath = null;

        deviceListContainer.innerHTML = '<p>Click "Refresh Device List" to load devices.</p>';
        availableDevices = []; // Clear cached devices

        checkShowFlashingButton(); // This will hide flashing-controls-view

        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            progressBar.style.backgroundColor = '#00FF44'; // YOM Green
        }
        if (progressSpeedText) progressSpeedText.textContent = 'Speed: -';
        if (progressRawOutput) progressRawOutput.textContent = '';

        // Ensure flashing progress view is hidden if not already by showView
        if (flashingProgressView) flashingProgressView.style.display = 'none';

        if (globalMessageContainer) globalMessageContainer.style.display = 'none';

        // Re-enable buttons that might have been disabled if reset is called after partial failure
        if(selectImageButton) selectImageButton.disabled = false;
        if(refreshDevicesButton) refreshDevicesButton.disabled = false;
        if(startFlashingButton) startFlashingButton.disabled = false; // Will be hidden by checkShowFlashingButton if needed
    }

    /**
     * Manages the visibility of different application views.
     * @param {'image-selection' | 'device-selection' | 'flashing-controls' | 'flashing-progress'} viewId - The ID of the view to display.
     * 'flashing-controls' can be shown in conjunction with 'device-selection' or 'image-selection' (though typically shown after both are selected).
     * 'flashing-progress' is typically exclusive.
     */
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

    /**
     * Checks if both an image and a device have been selected, and if so,
     * displays the flashing controls view (which includes the 'Start Flashing' button).
     * Otherwise, it hides the flashing controls view.
     */
    function checkShowFlashingButton() {
        if (currentSelectedImagePath && currentSelectedDevicePath) {
            if(flashingControlsView) flashingControlsView.style.display = 'block';
        } else {
            if(flashingControlsView) flashingControlsView.style.display = 'none';
        }
    }

    // Initial check for showing flashing button, in case selections are restored from a future persisted state.
    checkShowFlashingButton();

    /**
     * Handles progress updates received from the main process during flashing.
     * Updates the progress bar, speed text, and raw output log.
     * @param {object} progressData - The progress data object.
     * @param {number} [progressData.progress] - The current progress percentage.
     * @param {string} [progressData.speed] - The current flashing speed.
     * @param {string} [progressData.rawLine] - The raw output line from the flashing utility.
     */
    const handleFlashProgress = (progressData) => {
        // console.log('Renderer flash progress:', progressData); // Can be noisy
        if (progressData.progress !== undefined) {
            const percent = Math.round(progressData.progress);
            progressBar.style.width = `${percent}%`;
            progressBar.textContent = `${percent}%`; // Ensure this line is using the rounded percent
        }
        if (progressData.speed) {
            progressSpeedText.textContent = `Speed: ${progressData.speed}`;
        }
        if (progressData.rawLine) {
             progressRawOutput.textContent += progressData.rawLine + '\n';
             progressRawOutput.scrollTop = progressRawOutput.scrollHeight; // Auto-scroll to bottom
        }
        if (progressData.progress === 100) {
            progressSpeedText.textContent = 'Finalizing...';
        }
    };
    window.electronAPI.onFlashProgress(handleFlashProgress);
    // TODO: Remember to clean up this listener if the component/view is ever destroyed, e.g., by storing the return of onFlashProgress and calling it.
    // window.electronAPI.removeFlashProgressListener(handleFlashProgress);


    // Event listener for the "Start Flashing" button.
    // This orchestrates the entire flashing sequence including validation, confirmation,
    // calling main process operations, and handling UI updates for progress and completion.
    if (startFlashingButton) {
        startFlashingButton.addEventListener('click', async () => {
            // --- 1. Initial Validation ---
            if (globalMessageContainer) globalMessageContainer.style.display = 'none'; // Clear global message before critical action
            if (!currentSelectedImagePath || !currentSelectedDevicePath) {
                // showErrorDialog is fine here as it's a direct user action validation
                window.electronAPI.showErrorDialog('Input Missing', 'Please select an image file and a target device first.');
                return;
            }

            // --- 2. User Confirmation ---
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

            // --- 3. UI Setup for Flashing ---
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


            progressRawOutput.textContent = ''; // Clear raw output again just in case
            // Disable primary action buttons and device list items
            if(selectImageButton) selectImageButton.disabled = true;
            if(refreshDevicesButton) refreshDevicesButton.disabled = true;
            startFlashingButton.disabled = true;
            const listItems = deviceListContainer.querySelectorAll('ul li:not(.disabled-item)');
            listItems.forEach(item => item.classList.add('disabled-during-flash'));

            // --- 4. Flashing Operation Sequence (Flash, Extend, Eject) ---
            try {
                // --- 4a. Start Flash ---
                const result = await window.electronAPI.startFlash(currentSelectedImagePath, currentSelectedDevicePath);
                if (result.success) {
                    progressBar.textContent = 'Flash Done!';
                    progressBar.style.backgroundColor = '#28a745'; // Green for success
                    progressSpeedText.textContent = 'Flash completed. Now attempting to extend partition...';
                    progressRawOutput.textContent += "\nFlash completed successfully.\nStarting partition extension...\n";
                    progressRawOutput.scrollTop = progressRawOutput.scrollHeight;

                    // --- 4b. Extend Partition ---
                    try {
                        const extendResult = await window.electronAPI.extendPartition(currentSelectedDevicePath, 3); // Assuming partition 3
                        if (extendResult.success) {
                            progressSpeedText.textContent = 'Partition extended. Now attempting safe eject...';
                            progressRawOutput.textContent += extendResult.message + "\nStarting safe eject...\n";
                            progressRawOutput.scrollTop = progressRawOutput.scrollHeight;

                            // --- 4c. Safe Eject ---
                            try {
                                const ejectResult = await window.electronAPI.safeEject(currentSelectedDevicePath);
                                if (ejectResult.success) {
                                    progressBar.textContent = 'All Done!';
                                    progressBar.style.backgroundColor = '#28a745'; // Green for overall success
                                    window.electronAPI.showSuccessDialog('Operation Successful', 'All operations completed successfully! The device can now be safely removed.');
                                    resetToInitialState(); // Reset UI to initial state on full success
                                } else { // Eject failed
                                    if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                                    progressSpeedText.textContent = `Eject Error: ${ejectResult.message}`;
                                    progressRawOutput.textContent += `Eject Error: ${ejectResult.message}\n`;
                                    window.electronAPI.showErrorDialog('Device Eject Failed', ejectResult.message || 'An unknown error occurred during device ejection. Please ensure the device is not in use and try ejecting manually if needed.');
                                }
                            } catch (ejectError) { // Error from safeEject call
                                if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                                console.error('Error calling safeEject in renderer:', ejectError);
                                progressSpeedText.textContent = `Eject Error: ${ejectError.message}`;
                                progressRawOutput.textContent += `Eject Error: ${ejectError.message}\n`;
                                window.electronAPI.showErrorDialog('Device Eject Failed', ejectError.message || 'An unexpected error occurred during device ejection.');
                            }
                        } else { // Partition extension failed
                            if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                            progressSpeedText.textContent = `Partition Extension Error: ${extendResult.message}`;
                            progressRawOutput.textContent += `Partition Extension Error: ${extendResult.message}\n`;
                            window.electronAPI.showErrorDialog('Partition Extension Failed', extendResult.message || 'An unknown error occurred during partition extension.');
                        }
                    } catch (extendError) { // Error from extendPartition call
                        if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                        console.error('Error calling extendPartition in renderer:', extendError);
                        progressSpeedText.textContent = `Partition Extension Error: ${extendError.message}`;
                        progressRawOutput.textContent += `Partition Extension Error: ${extendError.message}\n`;
                        window.electronAPI.showErrorDialog('Partition Extension Failed', extendError.message || 'An unexpected error occurred during partition extension.');
                    }
                } else { // Flashing failed
                    if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                    progressBar.textContent = 'Error!';
                    progressBar.style.backgroundColor = '#dc3545'; // Red for error
                    progressSpeedText.textContent = `Error: ${result.message}`;
                    progressRawOutput.textContent += `Flashing Error: ${result.message}\n`;
                    window.electronAPI.showErrorDialog('Flashing Failed', result.message || 'An unknown error occurred during flashing.');
                }
            } catch (error) { // Catch-all for critical errors in the sequence calls
                if (globalMessageContainer) globalMessageContainer.style.display = 'none';
                console.error('Error in operation sequence:', error);
                progressBar.textContent = 'Critical Error!';
                progressBar.style.backgroundColor = '#dc3545';
                progressSpeedText.textContent = `Critical Error: ${error.message}`;
                window.electronAPI.showErrorDialog('Critical Error', `An unexpected critical error occurred: ${error.message}`);
            } finally {
                // --- 5. UI Cleanup / Re-enable controls ---
                // This block executes regardless of success or failure of the try block.
                if(selectImageButton) selectImageButton.disabled = false;
                if(refreshDevicesButton) refreshDevicesButton.disabled = false;
                startFlashingButton.disabled = false; // Re-enable the start button
                listItems.forEach(item => item.classList.remove('disabled-during-flash')); // Re-enable list items

                // If not resetToInitialState (i.e. on failure), ensure flashing controls are hidden
                // if selections are no longer valid or if we want to force user to re-evaluate.
                // However, resetToInitialState handles this for success cases.
                // For failure cases, user might want to retry with same selections, so just re-enabling buttons is okay.
                // The flashing progress view should ideally be hidden or replaced if an error occurred.
                // For now, it will show the error. A "Go Back" button or similar might be useful for errors.
                // If resetToInitialState() was called, the startFlashingButton would be hidden by checkShowFlashingButton()
                // as selections are cleared. If it wasn't called (e.g. on error), selections remain, so start button might reappear.
            }
        });
    } else {
        console.error('Start flashing button not found.');
    }

    if (globalMessageContainer) globalMessageContainer.style.display = 'none'; // Initial hide
}); // End of DOMContentLoaded
