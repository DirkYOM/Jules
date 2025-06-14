// This module will act as a proxy to send commands to the root-helper.js script
// and receive responses via IPC.

// For now, we assume global.helperClient is set by index.js after connection.
// A more robust solution might involve passing the client or using an event emitter.

function listBlockDevices() {
  return new Promise((resolve, reject) => {
    if (!global.helperClient || global.helperClient.destroyed) {
      return reject(new Error('Not connected to root helper service.'));
    }

    const requestPayload = JSON.stringify({ command: 'list-devices' });

    // Listener for the response
    const onData = (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.command === 'list-devices-response') {
          if (response.error) {
            console.error('systemUtilsProxy:listBlockDevices - Helper returned error:', response.error);
            reject(new Error(response.error));
          } else {
            resolve(response.data);
          }
        } else {
          // It's possible to receive other messages if the IPC mechanism is used for more things.
          // For now, we only care about the specific response to our command.
          // A more robust system would use message IDs to correlate requests and responses.
          console.log('systemUtilsProxy:listBlockDevices - Received unrelated message:', response);
        }
      } catch (e) {
        console.error('systemUtilsProxy:listBlockDevices - Error parsing response from helper or unrelated message:', e, data.toString());
        // Do not reject here, as it might be an unrelated message.
        // Wait for the actual response or a timeout.
      } finally {
        // Clean up this specific listener after processing the relevant response or an error related to this call
        // This is tricky without message IDs. If we resolve/reject, we should remove.
        // For simplicity now, if we resolve or reject due to response.error, we remove.
        // Otherwise, we might be removing a listener needed for a *different* pending request if calls overlap.
        // This simple model assumes one request/response cycle at a time for listBlockDevices.
        if (data.toString().includes('list-devices-response')) { // crude check
            global.helperClient.removeListener('data', onData);
            global.helperClient.removeListener('error', onError); // Also remove error listener
        }
      }
    };

    // Listener for errors on this specific request
    const onError = (err) => {
      global.helperClient.removeListener('data', onData); // Clean up data listener
      console.error('systemUtilsProxy:listBlockDevices - Error on helper client during request:', err);
      reject(new Error('Connection error during list-devices request: ' + err.message));
    };
    
    // Set up listeners for this specific request
    // Note: Adding listeners directly like this for each call can lead to multiple listeners
    // if not cleaned up properly or if client is persistent.
    // A better model would have a central dispatcher on global.helperClient in index.js that
    // manages callbacks based on request IDs.
    // For this phase, we'll use this simpler, but potentially flawed model if calls are concurrent.
    global.helperClient.on('data', onData);
    global.helperClient.once('error', onError); // Use 'once' for error to avoid it staying for next requests

    console.log('systemUtilsProxy: Sending list-devices command to helper.');
    global.helperClient.write(requestPayload + '\n'); // Adding newline as a simple delimiter

    // Implement a timeout for the request
    const timeoutId = setTimeout(() => {
      global.helperClient.removeListener('data', onData);
      global.helperClient.removeListener('error', onError);
      reject(new Error('Request to helper service timed out for list-devices.'));
    }, 10000); // 10-second timeout

    // When the promise settles (resolve or reject), clear the timeout
    // This is done by chaining finally to the promise this function returns.
    // However, we need to clear it when onData or onError fires.
    // So, modifying onData and onError to clear timeoutId.

    // Modified onData to clear timeout
    const originalOnData = onData; // keep reference
    const newOnData = (data) => {
        clearTimeout(timeoutId);
        originalOnData(data); // call original
    };
    global.helperClient.removeListener('data', onData); // remove old
    global.helperClient.on('data', newOnData); // add new

    // Modified onError to clear timeout
    const originalOnError = onError;
    const newOnError = (err) => {
        clearTimeout(timeoutId);
        originalOnError(err);
    };
    global.helperClient.removeListener('error', onError);
    global.helperClient.once('error', newOnError);


  });
}

module.exports = {
  listBlockDevices,
};
