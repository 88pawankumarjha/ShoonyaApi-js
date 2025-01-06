// Medha creds
const speakeasy = require('speakeasy');

const token = '24ALV46Z2GRC7YK765GZ24A3D45ADV3U'; // Replace with your actual secret token

const totp = speakeasy.totp({
  secret: token,
  encoding: 'base32', // Specify the encoding of your secret (usually base32)
  step: 30, // Time step in seconds (usually 30 seconds)
});

// console.log(totp); // This will print the current TOTP value

module.exports.authparams = {
'userid'   : 'FA212725',
'password' : '!234qwerR',
'twoFA'    : totp,
'vendor_code' : 'FA212725_U',
'api_secret' : '31c1c07a0cccd73ebf12eac7f8429ab2',
'imei'       : 'abc1234'
}

// Replace 'YOUR_BOT_TOKEN' with your actual bot token
module.exports.telegramBotToken = '6927730686:AAGJs6ElI-CY4B9yrUVgQ8su0GIB-du6jqw';
module.exports.chat_id_me = '1485135293';
module.exports.chat_id = '@TradeSignals_Channel';

// // orig Pawan creds
// const speakeasy = require('speakeasy');

//   const token = 'P76657O6SQKS4IAS24JRM2KE45725F5O'; // Replace with your actual secret token

//   const totp = speakeasy.totp({
//     secret: token,
//     encoding: 'base32', // Specify the encoding of your secret (usually base32)
//     step: 30, // Time step in seconds (usually 30 seconds)
//   });

//   // console.log(totp); // This will print the current TOTP value

//   module.exports.authparams = {
//   'userid'   : 'FA63911',
//   'password' : 'Ssssss6@',
//   'twoFA'    : totp,
//   'vendor_code' : 'FA63911_U',
//   'api_secret' : '347b7539d4b08e343c8ee018e6601bdc',
//   'imei'       : 'abc1234'
//   }

//   // Replace 'YOUR_BOT_TOKEN' with your actual bot token
//   module.exports.telegramBotToken = '6851849646:AAGspAQK11KKmaf8KGRc3f6OQ7Amzq_gpj8';
//   module.exports.chat_id_me = '1485135293';
//   module.exports.chat_id = '@TradeSignals_Channel';