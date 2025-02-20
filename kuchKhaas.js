const { exec } = require('child_process'); // Import the exec function
const Api = require("./lib/RestApi"); 
let { authparams } = require("./creds"); 

api = new Api({}); 

// Function to run the batch file
const runBatchFile = () => {
    exec('delete.bat', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing batch file: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Batch file stderr: ${stderr}`);
            return;
        }
        console.log(`Batch file stdout: ${stdout}`);
    });
};

// Run the batch file once
runBatchFile();

const loginAsync = async () => {
    return await api.login(authparams);
};

(async () => { 
    try {
        await loginAsync();

        const i4proTestMethod = require('./i4pro.js');
        await i4proTestMethod(api, false); // hasRunFindNearestExpiry = false
    
        // Set an interval to run the function every minute (60000 milliseconds)
        setInterval(async () => {
            await i4proTestMethod(api, true);
        }, 60000);
    } catch (e) {
        console.log(e);
    }
    
    
})();