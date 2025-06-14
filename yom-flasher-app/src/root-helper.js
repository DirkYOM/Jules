const net = require('net');
const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const SOCKET_PATH = '/tmp/yom-flasher-helper.sock'; // Using a temporary, fixed path for now

// Ensure the socket doesn't already exist
try {
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }
} catch (err) {
  console.error('Error removing existing socket:', err);
  process.exit(1);
}

const server = net.createServer((client) => {
  console.log('Root Helper: Client connected.');

  client.on('data', (data) => {
    const messageString = data.toString().trim(); // Trim to handle potential multiple newlines
    if (!messageString) return; // Ignore empty messages

    console.log('Root Helper: Received raw data:', messageString);
    try {
        const message = JSON.parse(messageString);
        console.log('Root Helper: Parsed message:', message);

        if (message.command === 'list-devices') {
            handleListDevices(client, message); // Pass message for potential future request IDs
        } else {
            console.warn('Root Helper: Unknown command:', message.command);
            client.write(JSON.stringify({
                command: 'unknown-command-response',
                error: `Unknown command: ${message.command}`
            }) + '\n');
        }
    } catch (e) {
        console.error('Root Helper: Error parsing JSON message or handling command:', e, messageString);
        client.write(JSON.stringify({
            command: 'error-response',
            error: 'Invalid message format or internal error.'
        }) + '\n');
    }
  });

  client.on('end', () => {
    console.log('Root Helper: Client disconnected.');
  });

  client.on('error', (err) => {
    console.error('Root Helper: Client connection error:', err);
  });
});

server.on('error', (err) => {
  console.error('Root Helper: Server error:', err);
  process.exit(1);
});

server.listen(SOCKET_PATH, () => {
  console.log(`Root Helper: Server listening on ${SOCKET_PATH}`);
  // On Linux, we might need to set permissions on the socket file if it's a Unix socket
  // so the main app (running as user) can connect to it (helper running as root).
  // However, often the default permissions are okay, or the act of root creating it in /tmp is accessible.
  // For now, let's assume default permissions are sufficient.
  // fs.chmodSync(SOCKET_PATH, '0777'); // Example: make it world-writable (use with caution)
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Root Helper: Received SIGINT. Shutting down.');
  server.close(() => {
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Root Helper: Received SIGTERM. Shutting down.');
  server.close(() => {
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    process.exit(0);
  });
});

// Keep the helper running
// This is a simplified way; a real daemon might have more robust lifecycle management.
console.log('Root Helper: Script started. PID:', process.pid);

// A simple way to keep it alive, though the server listening will also do that.
// setInterval(() => {}, 1000 * 60 * 60); // Keep alive for a long time

async function handleListDevices(client, requestMessage) { // requestMessage can be used for req ID later
    const lsblkPath = 'lsblk'; // Assuming lsblk is in PATH for root
    const args = ['-Jb', '-o', 'PATH,NAME,SIZE,MODEL,FSTYPE,MOUNTPOINT,PKNAME,TYPE,RM'];
    console.log('Root Helper: Executing lsblk...');
    try {
        const { stdout } = await execFileAsync(lsblkPath, args);
        const lsblkData = JSON.parse(stdout);

        // Simplified OS detection (Placeholder - full logic should be ported from original systemUtils.js)
        // For now, we'll not determine the OS drive accurately in this step.
        // This requires finding the root mount point ('/') and its parent device.
        // const osDrivePath = determineOsDrive(lsblkData); // This function would need to be defined/ported.

        const devices = (lsblkData.blockdevices || [])
            .filter(device => ['disk', 'mmcblk', 'nvme'].includes(device.type))
            .map(device => ({
                path: device.path,
                name: device.name,
                size: device.size,
                model: device.model || 'Unknown Model',
                isRemovable: device.rm === true,
                // isOS: device.path === osDrivePath, // Full OS detection needed
                isOS: false, // Temporary placeholder
                filesystemType: device.fstype || null,
            }));
        
        console.log('Root Helper: Successfully listed devices.');
        client.write(JSON.stringify({
            command: 'list-devices-response',
            requestId: requestMessage.id, // If requestMessage contains an ID
            data: devices
        }) + '\n');

    } catch (error) {
        console.error('Root Helper: Error executing lsblk or parsing its output:', error);
        client.write(JSON.stringify({
            command: 'list-devices-response',
            requestId: requestMessage.id, // If requestMessage contains an ID
            error: `Failed to list devices in helper: ${error.message}`
        }) + '\n');
    }
}
