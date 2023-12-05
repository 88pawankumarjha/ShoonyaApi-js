const speakeasy = require('speakeasy');

const token = ''; // Replace with your actual secret token

const totp = speakeasy.totp({
  secret: token,
  encoding: 'base32', // Specify the encoding of your secret (usually base32)
  step: 30, // Time step in seconds (usually 30 seconds)
});

// console.log(totp); // This will print the current TOTP value

module.exports.authparams = {
'userid'   : '',
'password' : '',
'twoFA'    : totp,
'vendor_code' : '',
'api_secret' : '',
'imei'       : ''
}

// Replace 'YOUR_BOT_TOKEN' with your actual bot token
module.exports.telegramBotToken = '';
module.exports.chat_id_me = '';
module.exports.chat_id = '';