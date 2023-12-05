const { spawn } = require('child_process');

// Replace 'child.js' with the actual filename you want to run
const childProcess = spawn('node', ['utils/child.js'], {
    stdio: ['pipe', 'ignore', 'ignore', 'ipc']  // 'ignore' for stdout and stderr
});

childProcess.on('message', (message) => {
    console.log(`Message from Child Process: ${message}`);
});

childProcess.on('close', (code) => {
    console.log(`Child process exited with code ${code}`);
});

// Send a message to the child process
childProcess.send('Hello from the parent process!');
