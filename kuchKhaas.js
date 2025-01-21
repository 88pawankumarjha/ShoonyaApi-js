const Api = require("./lib/RestApi"); 
let { authparams } = require("./creds"); 

api = new Api({}); 

const loginAsync = async () => {
    return await api.login(authparams);
};

(async () => { 
    await loginAsync();

    const i4proTestMethod = require('./i4pro.js');
    await i4proTestMethod(api);

    // Set an interval to run the function every minute (60000 milliseconds)
    setInterval(async () => {
        await i4proTestMethod(api);
    }, 30000);
    
})();