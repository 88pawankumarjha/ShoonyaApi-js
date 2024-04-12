// Initialization / nearest expiry / getAtmStrike
// jupyter nbconvert --to script gpt.ipynb
const debug = false;

function isWeekend() {
  //todo
  return false; // used to set the positions to ITM
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

const axios = require('axios');
const fs = require('fs');
const unzipper = require('unzipper');

const https = require('https');
const AdmZip = require('adm-zip');

const { parse } = require('papaparse');
const moment = require('moment');
const { idxNameTokenMap, idxNameOcGap, downloadCsv, filterAndMapDates, 
  identify_option_type, fetchSpotPrice, getStrike, getOptionBasedOnNearestPremium, calcPnL, isTimeEqualsNotAfterProps } = require('./utils/customLibrary');
// let { authparams } = require("./creds");
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(telegramBotToken, { polling: true });
const send_notification = async (message, me = false) => (message && console.log(message)) || (!debug && message && await bot.sendMessage((me && !telegramSignals.stopSignal) ? chat_id_me : chat_id, (me && !telegramSignals.stopSignal) ? message : message.replace(/\) /g, ")\n")).catch(console.error));

let globalBigInput = {
  filteredIndexCSV: undefined
}
//TODO change index
getPickedIndexHere = () => debug ? 'NIFTY' : ['NIFTY', 'BANKEX', 'FINNIFTY', 'BANKNIFTY', 'NIFTY', 'SENSEX', 'BANKEX'][new Date().getDay()] || 'NIFTY';
getEMAQtyFor2L = () => debug ? 100 : [100, 60, 120, 60, 150, 50, 100][new Date().getDay()] || 100; // qty for margin to sell both sides
let telegramSignals = {
  stopSignal: false,
  exitSignal: false,
  slower: false,
  faster: false,
  isPlaying: true
}
let globalInput = {
  susertoken: '',
  secondSession: false,
  launchChildProcessApp: false,
  indexName: getPickedIndexHere(),
  delayTime: 30000,
  ocGap: undefined,
  token: undefined,
  pickedExchange: undefined,
  inputOptTsym: undefined,
  WEEKLY_EXPIRY: undefined,
  MONTHLY_EXPIRY: undefined,
  LotSize: undefined,
  emaLotMultiplier: undefined,
  emaLotMultiplierQty: getEMAQtyFor2L(),
  multiplier: 1,
};
globalInput.token = idxNameTokenMap.get(globalInput.indexName);
globalInput.ocGap = idxNameOcGap.get(globalInput.indexName);
let biasProcess = {
  optionChain: undefined,
  ocCallOptions: undefined,
  ocPutOptions: undefined,
  itmCallSymbol: undefined,
  itmCallStrikePrice: undefined,
  atmCallSymbol: undefined,
  atmCallStrikePrice: undefined,
  otmCallSymbol: undefined,
  otmCallStrikePrice: undefined,
  otm2CallSymbol: undefined,
  otm2CallStrikePrice: undefined,
  otm3CallSymbol: undefined,
  otm3CallStrikePrice: undefined,
  callSubStr: undefined,
  itmPutSymbol: undefined,
  itmPutStrikePrice: undefined,
  atmPutSymbol: undefined,
  atmPutStrikePrice: undefined,
  otmPutSymbol: undefined,
  otmPutStrikePrice: undefined,
  otm2PutSymbol: undefined,
  otm2PutStrikePrice: undefined,
  otm3PutSymbol: undefined,
  otm3PutStrikePrice: undefined,
  putSubStr: undefined,
  vix: undefined,
  spotObject: undefined
}

const resetBiasProcess = () => {
  biasProcess.optionChain = undefined,
  biasProcess.ocCallOptions = undefined,
  biasProcess.ocPutOptions = undefined,
  biasProcess.itmCallSymbol = undefined,
  biasProcess.itmCallStrikePrice = undefined,
  biasProcess.itmPutSymbol = undefined,
  biasProcess.itmPutStrikePrice = undefined,
  biasProcess.ocPutOptions = undefined,
  biasProcess.atmCallSymbol = undefined,
  biasProcess.atmCallStrikePrice = undefined,
  biasProcess.atmPutSymbol = undefined,
  biasProcess.atmPutStrikePrice = undefined,
  biasProcess.otmCallSymbol = undefined,
  biasProcess.otmCallStrikePrice = undefined,
  biasProcess.otmPutSymbol = undefined,
  biasProcess.otmPutStrikePrice = undefined,
  biasProcess.atmStrike = undefined,
  biasProcess.otm2CallSymbol = undefined,
  biasProcess.otm2CallStrikePrice = undefined,
  biasProcess.otm2PutSymbol = undefined,
  biasProcess.otm2PutStrikePrice = undefined,
  biasProcess.otm3CallSymbol = undefined,
  biasProcess.otm3CallStrikePrice = undefined,
  biasProcess.otm3PutSymbol = undefined,
  biasProcess.otm3PutStrikePrice = undefined,
  biasProcess.spotObject = undefined,
  biasProcess.callSubStr = undefined,
  biasProcess.putSubStr = undefined
}


let biasOutput = { // N[46] 20155 (-20)
  tsym: '',
  bias: 0,
  deltaMove: 0,
  spotLP: 0
}
let prevEmaUpFastCall = true;
let prevEmaUpFastPut = true;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

//websocket
let websocket;
let websocket_closed= false;
let intervalId;
let intervalIdForEMA;
const delayForEMA = 1000; 

let latestQuotes = {};
let latestOrders = {};

let positionProcess = {
  smallestCallPosition: undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
  smallestPutPosition: undefined,
  hedgeCall: undefined,
  hedgePut: undefined,
  posCallSubStr: undefined,
  posPutSubStr: undefined,
  callsNearbyNeighbours: undefined,
  putsNearbyNeighbours: undefined, 
  // putsNearbyNeighbours:  [
//   { tsym: 'NIFTY14DEC23P20900' },
//   { tsym: 'NIFTY14DEC23P20950' },
//   { tsym: 'NIFTY14DEC23P21000' },
//   { tsym: 'NIFTY14DEC23P21050' },
//   { tsym: 'NIFTY14DEC23P21100' }
// ]
  collectedValuesCall: new Map(),
  collectedValuesPut: new Map(),
  // CE:  [ '247.60', '206.60', '170.05', '137.90', '110.40' ]
  // PE:  [ '57.20', '74.85', '95.70', '121.05', '151.25' ]
// for ATM 20950:
// CE:  [
//   'NIFTY14DEC23C20800 247.60',
//   'NIFTY14DEC23C20850 206.60',
//   'NIFTY14DEC23C20900 170.05',
//   'NIFTY14DEC23C20950 137.90',
//   'NIFTY14DEC23C21000 110.40'
// ]
// PE:  [
//   'NIFTY14DEC23P20900 57.20',
//   'NIFTY14DEC23P20950 74.85',
//   'NIFTY14DEC23P21000 95.70',
//   'NIFTY14DEC23P21050 121.05',
//   'NIFTY14DEC23P21100 151.25'
// ]
}

// Function to download the ZIP file
function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destination);
      https.get(url, function(response) {
          response.pipe(file);
          file.on('finish', function() {
              file.close(() => {
                  resolve();
              });
          });
      }).on('error', function(err) {
          fs.unlink(destination, () => {}); // Delete the file if an error occurs during download
          reject(err);
      });
  });
}

// Function to unzip the downloaded file in the current working directory
function unzipFile(zipFilePath) {
  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo('./', true);
  //console.log('Unzipped in the current working directory.');
}

async function findNearestExpiry() {
  let csvUrl, zipFilePath, csvFilePath;
  const exchangeType = globalInput.indexName.includes('EX') ? 'BFO' : 'NFO';
  csvUrl = `https://api.shoonya.com/${exchangeType}_symbols.txt.zip`;
  const zipFileUrl = csvUrl;
  // Replace 'downloaded_file.zip' with the desired file name
  const downloadedFileName = 'downloaded_file.zip';
  zipFilePath = `./${exchangeType}_symbols.zip`;
  csvFilePath = `./${exchangeType}_symbols.txt`;
  try {
    // Download and extract the CSV file
    // await downloadCsv(csvUrl, zipFilePath, axios, fs);
    // await fs.createReadStream(zipFilePath).pipe(unzipper.Extract({ path: '.' }));

    downloadFile(zipFileUrl, downloadedFileName)
    .then(() => {
        unzipFile(downloadedFileName);
    })
    .catch(error => {
        console.error('Error:', error);
    });
    await delay(1000);
    // Read CSV data into a JavaScript object
    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    const { data: symbolDf } = parse(csvData, { header: true });
    
    globalBigInput.filteredIndexCSV = filterAndMapDates(moment, symbolDf.filter((row) => ['OPTIDX', 'FUTIDX'].includes(row.Instrument) && row.TradingSymbol.startsWith(globalInput.indexName)));
    // console.log(globalBigInput.filteredIndexCSV);
    // [
    //  {
    //   Exchange: 'NFO',
    //   Token: '72903',
    //   LotSize: '50',
    //   Symbol: 'NIFTY',
    //   TradingSymbol: 'NIFTY29FEB24P21750',
    //   Expiry: '2024-02-29',
    //   Instrument: 'OPTIDX',
    //   OptionType: 'PE',
    //   StrikePrice: '21750',
    //   TickSize: '0.05',
    //   '': ''
    // },
    //BFO,833613,15,BKXFUT,BANKEX24FEBFUT,26-FEB-2024,FUTIDX,XX,0,0.05,
    const expiryList = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => row.Instrument === 'OPTIDX').map((row) => row.Expiry))];
    const expiryFutList = globalBigInput.filteredIndexCSV
      .filter((row) => row.Instrument === 'FUTIDX')
      .map((row) => ({ Exchange: row.Exchange, LotSize: row.LotSize, TradingSymbol: row.TradingSymbol, Expiry: row.Expiry }));
    expiryList.sort();
    expiryFutList.sort((a, b) => moment(a.Expiry).diff(moment(b.Expiry)));
    
    globalInput.inputOptTsym = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => (row.Instrument === 'OPTIDX' && row.Expiry === expiryList[0])).map((row) => row.TradingSymbol))][0];
    // console.log(globalInput.inputOptTsym, 'globalInput.inputOptTsym')
    globalInput.WEEKLY_EXPIRY = expiryList[0];
    globalInput.MONTHLY_EXPIRY = expiryFutList[0].Expiry;
    globalInput.pickedExchange = expiryFutList[0].Exchange;
    globalInput.LotSize = expiryFutList[0].LotSize;
    globalInput.emaLotMultiplier = Math.floor(globalInput.emaLotMultiplierQty/globalInput.LotSize);
  } catch (error) {
    console.error('Error:', error.message);
  } 
  // finally {
    // Clean up: Delete downloaded files
    // if (fs.existsSync(zipFilePath)) {
    //   fs.unlinkSync(zipFilePath);
    // }
    // if (fs.existsSync(csvFilePath)) {
    //   fs.unlinkSync(csvFilePath);
    // }
  // }
};


const Api = require("./lib/RestApi");
let api = new Api({});

let limits;
getEMAQtyForGeneric = () => {
  // return debug ? 100 : 
  // limits?.cash < 800000 ? 
  // [100, 75, 240, 75, 200, 70, 75][new Date().getDay()] : 
  // [400, 525, 1600, 525, 1050, 490, 525][new Date().getDay()]

  return debug ? 100 : 
  limits?.cash < 1500000 ? 
  [100, 300, 800, 300, 800, 250, 75][new Date().getDay()] : 
  [100, 600, 1600, 600, 1500, 500, 75][new Date().getDay()]
  }

// Execute the findNearestExpiry function
findNearestExpiry();

const getAtmStrike = async () => {
  // TODO
  // return 50700;
  // console.log(`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}`)
  // console.log(globalInput.token)
  // console.log(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]);
  biasProcess.spotObject = latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`];
  // debug && console.log(biasProcess.spotObject) //updateAtmStrike(s) --> 50, spot object -> s?.lp = 20100
  console.log(biasOutput.bias, 'biasOutput.bias')
  atm = Math.round((biasProcess.spotObject?.lp + (biasOutput.bias !== 0 ? biasOutput.bias : 0)) / globalInput.ocGap) * globalInput.ocGap;
  if (!isNaN(atm)) {return atm;}  
  else { 
    const Spot = await fetchSpotPrice(api, globalInput.token, globalInput.pickedExchange);
    if (!Spot) { console.log('Not able to find the spot'); return null; }
    // debug && console.log(Spot)
    const ltp_rounded = Math.round(parseFloat(Spot.lp));
    // const open = Math.round(parseFloat(Spot.o || Spot.c || Spot.lp)); // c for days when market is closed
    // debug && console.log(open, 'open, ', ltp_rounded, ' ltp_rounded, = ', ltp_rounded-open, " ltp_rounded-open")
    const mod = ltp_rounded % globalInput.ocGap;
    const atmStrike = mod < globalInput.ocGap / 2 ? Math.floor(ltp_rounded / globalInput.ocGap) * globalInput.ocGap : Math.ceil(ltp_rounded / globalInput.ocGap) * globalInput.ocGap;
    return atmStrike;
  }

}

// telegram callbackQuery
async function send_callback_notification() {
try {
const keyboard = {inline_keyboard: [[
// { text: '🐌', callback_data: 'slower' },
// { text: '🚀', callback_data: 'faster' },
// { text: '💹', callback_data: 'toggleExchange' },
{ text: '⏸', callback_data: 'isPlayingSignal' },
// { text: '🛑', callback_data: 'exit' }
]]};
!debug && bot.sendMessage(chat_id_me, 'Choose server settings', { reply_markup: keyboard });
} catch (error) { console.error(error);
send_notification(error + ' error occured', true)
}
  }
  bot.on('callback_query', (callbackQuery) => {
const chatId = callbackQuery.message.chat.id;
const data = callbackQuery.data;
const exchange = globalInput.pickedExchange;
// if (data === 'slower') setCustomInterval(true);
// else if (data === 'faster') setCustomInterval(false);
// else if (data === 'stop') stopSignal = !stopSignal;

// telegramSignals = {
//   stopSignal: false,
//   exitSignal: false,
//   slower: false,
//   faster: false,
// }
if (data === 'isPlayingSignal') {
if(telegramSignals.isPlaying){pauseEma()}
else {resumeEma()}
}
    if (data === 'exit') telegramSignals.exitSignal = true;
if (data === 'stop') telegramSignals.stopSignal = !telegramSignals.stopSignal;
else if (data === 'toggleExchange') globalInput.pickedExchange = (globalInput.pickedExchange === 'NFO' ? 'BFO' : globalInput.pickedExchange === 'BFO' ? 'MCX' : 'NFO');
// bot.sendMessage(chatId, `Exchange: ${globalInput.pickedExchange}, Paused: ${telegramSignals.stopSignal} - pause, exit, slower, faster are not implemented`);
bot.sendMessage(chatId, `EMA isPlaying: ${telegramSignals.isPlaying}`);
});

// login method
const { spawn } = require('child_process');
login = async (api) => {
    try {
        const res = await api.login(authparams);
        return true;
    } catch (err) {
        return false;
    }
};
executeLogin = async () => {
    const isLoggedIn = await login(api);
    if (globalInput.launchChildProcessApp){    
        const childProcess = spawn('node', ['app.js'], {
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
    }
    if (!isLoggedIn) {
        return;
    }
};


// updateTwoSmallestPositionsAndNeighboursSubs

const resetCalls = () => {
    positionProcess.smallestCallPosition=undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
    positionProcess.posCallSubStr=undefined,
    positionProcess.callsNearbyNeighbours=undefined,
    positionProcess.collectedValuesCall=new Map()
};
const resetPuts = () => {
    positionProcess.smallestPutPosition=undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
    positionProcess.posPutSubStr=undefined,
    positionProcess.putsNearbyNeighbours=undefined,
    positionProcess.collectedValuesPut=new Map()
};
// const data = [
//     {
//         tsym: 'NIFTY07DEC23P20850',
//         lp: '1.55',
//         netqty: '-800',
//         s_prdt_ali: 'MIS'
//     },
//     {
//         tsym: 'NIFTY07DEC23P20851',
//         lp: '1.53',
//         netqty: '-800',
//         s_prdt_ali: 'MIS'
//     },
//     {
//         tsym: 'NIFTY07DEC23C20950',
//         lp: '2.60',
//         netqty: '-800',
//         s_prdt_ali: 'MIS'
//     },
//     {
//         tsym: 'NIFTY07DEC23C21000',
//         lp: '2.59',
//         netqty: '-800',
//         s_prdt_ali: 'MIS'
//     },
//     // Add more data as needed
// ];

// let orderCE = {
//     buy_or_sell: 'B',
//     product_type: 'M',
//     exchange: 'NFO',
//     tradingsymbol: positionProcess.smallestCallPosition,
//     quantity: positionsData.netqty.toString(),
//     discloseqty: positionsData.netqty.toString(),
//     price_type: 'LMT',
//     price: SpotCEObj.bp5 || 0,
//     remarks: 'WSExitAPI'
// }
// !debug && await api.place_order(orderCE);

exitHedgeOrder = async (positionsData) => {
  let order = {
        buy_or_sell: 'S',
        product_type: 'M',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionsData.tsym.toString(),
        quantity: positionsData.netqty.toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'ExitHedgeAPI'
    }
    await api.place_order(order);
}

exitHedges = async () => {
  api.get_positions()
        .then((data) => { 
          if (Array.isArray(data)) {
            // Separate calls and puts for NFO - these are sold options with smallest LTP
            const calls = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'C');
            const puts = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'P');

            calls.forEach(position => {
                exitHedgeOrder(position)
            });
            puts.forEach(position => {
                exitHedgeOrder(position)
            });
          }
        });
}

updatePositions = async () => {
    api.get_positions()
        .then((data) => { 
            debug && console.log(data, ' : positions data');
            if(isWeekend()) {
                positionProcess.smallestCallPosition = biasProcess.itmCallSymbol;
                positionProcess.smallestPutPosition = biasProcess.itmPutSymbol;
            }
            // Check if data is an array
            else if (Array.isArray(data)) {
                // Separate calls and puts for NFO - these are sold options with smallest LTP
                const calls = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'C');
                const puts = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'P');
                // Separate calls and puts for NFO - these are sold options with smallest LTP
                positionProcess.hedgeCall = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'C');
                positionProcess.hedgePut = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'P');
                positionProcess.smallestCallPosition = calls.length > 0 ? calls.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), calls[0]) : resetCalls();
                positionProcess.smallestPutPosition = puts.length > 0 ? puts.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), puts[0]) : resetPuts();
                // send_notification('MtoM: '+data?.urmtom + ", rPnL: "+ +data?.rpnl)
                console.log('positionProcess.smallestCallPosition: '+positionProcess.smallestCallPosition?.tsym)
                console.log('positionProcess.smallestPutPosition: '+positionProcess.smallestPutPosition?.tsym)
                debug && console.log(positionProcess, ' : positionProcess');    
            } else {
                console.error('positions data is not an array.');
            }
            // [
            //     {
            //       tsym: 'NIFTY07DEC23P20850',
            //       lp: '1.55',
            //       netqty: '-800',
            //       s_prdt_ali: 'MIS'
            //     },
            //     {
            //       tsym: 'NIFTY07DEC23C20950',
            //       lp: '2.60',
            //       netqty: '-800',
            //       s_prdt_ali: 'MIS'
            //     }
            //   ]
        });
        return true;
}

let isQueueBusy = false;
const queue = [];

updateTwoSmallestPositionsAndNeighboursSubs = async (autoSubs = true) => {
    // If the queue is busy, add the function call to the queue
    if (isQueueBusy) {
        debug && console.log('updateTwoSmallestPositionsAndNeighboursSubs is already in progress.');
        queue.push(true);
        return;
    }

    isQueueBusy = true;

    try {
        await delay(2000);
        await updatePositions();
        updatePositionsNeighboursAndSubs(autoSubs);
    } finally {
        isQueueBusy = false;
        // Process the next function call in the queue if any
        if (queue.length > 0) {
            const nextItem = queue.shift(); // Remove the item from the queue
            // console.log('Processing next item in the updateTwoSmallestPositionsAndNeighboursSubs queue.');
            updateTwoSmallestPositionsAndNeighboursSubs(autoSubs);
        }
    }
}
// updateTwoSmallestPositionsAndNeighboursSubs();


postOrderPosTracking = async (data) => {
    await updateTwoSmallestPositionsAndNeighboursSubs(false);
    // Update call position subscription
    positionProcess.posCallSubStr = positionProcess.smallestCallPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionProcess.smallestCallPosition.tsym)}` : '';
    
    positionProcess.posCallSubStr && dynamicallyAddSubscription(positionProcess.posCallSubStr);
    // Update put position subscription
    positionProcess.posPutSubStr = positionProcess.smallestPutPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionProcess.smallestPutPosition.tsym)}` : '';
    
    positionProcess.posPutSubStr && dynamicallyAddSubscription(positionProcess.posPutSubStr);
    // console.log('order placed: ', data)
    str = '\n' + data?.trantype + ' ' + data?.flprc + ' ' + data?.tsym + ' ';
    pnl = await calcPnL(api);
    // send_notification(pnl + ' ' + str, true)
    send_notification((limits?.cash)?.substring(0,3) + ' : PNL : ' + pnl + ' ' + str)
}

// websocket with update smallest 2 positions on every new order
function receiveQuote(data) {
    // console.log("Quote ::", data);
    // Update the latest quote value for the corresponding instrument
    if(data?.lp) {
        latestQuotes[data.e + '|' + data.tk] = data
        // console.log(latestQuotes[data.e + '|' + data.tk])
    }
    //  else {
    //     latestQuotes[data.e + '|' + data.tk] = data;
    // }
}

function receiveOrders(data) {
    // console.log("Order ::", data);
    // Update the latest order value for the corresponding instrument
    if(data.status === 'REJECTED') {
      send_notification('################## ORDER REJECTED PLS CHECK ##################', true);
      exitSellsAndOrStop(true);
    }
    if(data.status === 'COMPLETE') {
        latestOrders[data.Instrument] = data;
        // update the smallest positions after each order
        postOrderPosTracking(data)
    }
}

function open(data) {
    // console.log(`NSE|${globalInput.token}`)
    
    const initialInstruments = [`${globalInput.indexName.includes('EX') ? 'BSE' : 'NSE'}|${globalInput.token}`, 'NSE|26017']; 

    //vix:
    // {
    //     t: 'tf',
    //     e: 'NSE',
    //     tk: '26017',
    //     lp: '12.77',
    //     pc: '-7.06',
    //     ft: '1701931151'
    //   } latestQuotes['NSE|26017']
    subscribeToInstruments(initialInstruments);
    // console.log("Subscribing to :: ", initialInstruments);
}

function subscribeToInstruments(instruments) {
    instruments.forEach(instrument => {
      // console.log(instrument, ' :subscribing to instrument')
        api.subscribe(instrument);
    });
}

function dynamicallyAddSubscription(newInstrument) {
    if (!latestQuotes[newInstrument]) {
        console.log("Subscribing to new :: ", newInstrument);
        api.subscribe(newInstrument);
    }
}

params = {
    'socket_open': open,
    'quote': receiveQuote,
    'order': receiveOrders
};
async function startWebsocket() {
    websocket = api.start_websocket(params);
    await delay(5000);
}

async function getOptionChain() {
    try {
        biasProcess.atmStrike = await getAtmStrike();
        const optionChainResponse = await api.get_option_chain(globalInput.pickedExchange, globalInput.inputOptTsym, biasProcess.atmStrike, 15);
        // console.log(optionChainResponse, 'optionChainResponse')
        if (optionChainResponse.stat === 'Ok') {
            debug && console.log(optionChainResponse, 'optionChainResponse')
            return optionChainResponse;
        } else {
            console.error('Error getting option chain:', optionChainResponse);
            return null;
        }
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    }
}

// Function to find the ITM symbol from the option chain
function updateITMSymbolAndStrike(optionType) {
    // Filter options by type (CE for Call, PE for Put)
    biasProcess.ocCallOptions = biasProcess.optionChain.values.filter(option => option.optt === 'CE');
    biasProcess.ocPutOptions = biasProcess.optionChain.values.filter(option => option.optt === 'PE');
    // Sort options by tsym for both Call and Put
    biasProcess.ocCallOptions.sort((a, b) => a.tsym.localeCompare(b.tsym));
    biasProcess.ocPutOptions.sort((a, b) => a.tsym.localeCompare(b.tsym));
    // Assign ITM symbols and strike prices
    debug && console.log(biasProcess.ocCallOptions, 'callOptions')
    debug && console.log(biasProcess.ocPutOptions, 'putOptions')
    biasProcess.itmCallSymbol = biasProcess.ocCallOptions[14].tsym;
    biasProcess.itmCallStrikePrice = biasProcess.ocCallOptions[14].strprc;
    biasProcess.itmPutSymbol = biasProcess.ocPutOptions[16].tsym;
    biasProcess.itmPutStrikePrice = biasProcess.ocPutOptions[16].strprc;
    biasProcess.atmCallSymbol = biasProcess.ocCallOptions[15].tsym;
    biasProcess.atmCallStrikePrice = biasProcess.ocCallOptions[15].strprc;
    biasProcess.atmPutSymbol = biasProcess.ocPutOptions[15].tsym;
    biasProcess.atmPutStrikePrice = biasProcess.ocPutOptions[15].strprc;
    biasProcess.otmCallSymbol = biasProcess.ocCallOptions[16].tsym;
    biasProcess.otmCallStrikePrice = biasProcess.ocCallOptions[16].strprc;
    biasProcess.otmPutSymbol = biasProcess.ocPutOptions[14].tsym;
    biasProcess.otmPutStrikePrice = biasProcess.ocPutOptions[14].strprc;
    biasProcess.otm2CallSymbol = biasProcess.ocCallOptions[17].tsym;
    biasProcess.otm2CallStrikePrice = biasProcess.ocCallOptions[17].strprc;
    biasProcess.otm2PutSymbol = biasProcess.ocPutOptions[13].tsym;
    biasProcess.otm2PutStrikePrice = biasProcess.ocPutOptions[13].strprc;
    biasProcess.otm3CallSymbol = biasProcess.ocCallOptions[18].tsym;
    biasProcess.otm3CallStrikePrice = biasProcess.ocCallOptions[18].strprc;
    biasProcess.otm3PutSymbol = biasProcess.ocPutOptions[12].tsym;
    biasProcess.otm3PutStrikePrice = biasProcess.ocPutOptions[12].strprc;
    return;
}

async function updateITMSymbolfromOC() {
    await delay(1000)
    // Get the Nifty option chain
    biasProcess.optionChain = await getOptionChain();
    // console.log(biasProcess.optionChain)
    // post https://api.shoonya.com/NorenWClientTP/GetOptionChain jData={"uid":"FA63911",
    // "exch":"BFO","tsym":"BANKEX24JAN57700PE","strprc":"50700","cnt":"15"}&jKey=c49727e66cb3d1eca0c2c048a7a3e0804dc9aacf45848b7835f6c93cc9bb0d92
    // {
    //   stat: 'Ok',
    //   values: [
    //     {
    //       exch: 'BFO',
    //       token: '1153140',
    //       tsym: 'BANKEX24JAN50700CE',
    //       optt: 'CE',
    //       pp: '2',
    //       ls: '15',
    //       ti: '0.05',
    //       strprc: '50700.00'
    //     },
    //     {
    //       exch: 'BFO',
    //       token: '1152365',
    //       tsym: 'BANKEX24JAN50800CE',
    //       optt: 'CE',
    //       pp: '2',
    //       ls: '15',
    //       ti: '0.05',
    //       strprc: '50800.00'
    //     },
    // ... 
    // ... 
    // {
    //   exch: 'BFO',
    //   token: '1137016',
    //   tsym: 'BANKEX24JAN49300CE',
    //   optt: 'CE',
    //   pp: '2',
    //   ls: '15',
    //   ti: '0.05',
    //   strprc: '49300.00'
    // },
    // {
    //   exch: 'BFO',
    //   token: '1136711',
    //   tsym: 'BANKEX24JAN49200CE',
    //   optt: 'CE',
    //   pp: '2',
    //   ls: '15',
    //   ti: '0.05',
    //   strprc: '49200.00'
    // },
    // {
    //   exch: 'BFO',
    //   token: '1153390',
    //   tsym: 'BANKEX24JAN50700PE',
    //   optt: 'PE',
    //   pp: '2',
    //   ls: '15',
    //   ti: '0.05',
    //   strprc: '50700.00'
    // },
    // {
    //   exch: 'BFO',
    //   token: '1152588',
    //   tsym: 'BANKEX24JAN50800PE',
    //   optt: 'PE',
    //   pp: '2',
    //   ls: '15',
    //   ti: '0.05',
    //   strprc: '50800.00'
    // },
    // ... 
    // ... 
//     {
//       exch: 'BFO',
//       token: '1137242',
//       tsym: 'BANKEX24JAN49300PE',
//       optt: 'PE',
//       pp: '2',
//       ls: '15',
//       ti: '0.05',
//       strprc: '49300.00'
//     },
//     {
//       exch: 'BFO',
//       token: '1136922',
//       tsym: 'BANKEX24JAN49200PE',
//       optt: 'PE',
//       pp: '2',
//       ls: '15',
//       ti: '0.05',
//       strprc: '49200.00'
//     }
//   ]
// }
    await delay(1000)
    if (biasProcess.optionChain) {
        // Find the ITM symbol
        await delay(1000)
        updateITMSymbolAndStrike();
        await delay(1000)
        // let quoteResp = await api.get_quotes(globalInput.pickedExchange, biasProcess.ocCallOptions[15].token)
        
        // {
        //   '835288': '11.35',
        //   '1136711': '1591.10',
        //   '1136748': '823.45',
        //   '1136770': '1399.35',
        //   '1136806': '606.90',
        //   '1136828': '1212.75',
        //   '1136887': '453.50',
        //   '1136903': '853.75',
        //   '1137016': '1494.70',
        //   '1137066': '1305.30',
        //   '1137137': '1122.05',
        //   '1137444': '907.85',
        //   '1137493': '658.15',
        //   '1137542': '484.55',
        //   '1137607': '393.40',
        //   '1137624': '1039.05',
        //   '1152365': '306.40',
        //   '1152724': '210.05',
        //   '1153140': '342.75',
        //   '1153214': '269.15',
        //   '1153994': '140.45',
        //   '1154243': '180.25',
        //   '1154316': '109.60',
        //   '1154790': '57.25',
        //   '1154944': '73.95',
        //   '1154987': '46.95',
        //   '1157331': '31.55',
        //   '1157442': '22.55',
        //   '1158334': '14.25',
        //   '1158879': '13.20'
        // } optionChainDataMap

        // const targetPrice = 200;
        
        // nearestCE = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocCallOptions, targetPrice)
        // nearestPE = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocPutOptions, targetPrice)

        // console.log(nearestCE); // 1152724
        // console.log(nearestPE); // 1153390
        
        debug && console.log(biasProcess, ' :biasProcess')
    }
}

// takeAction(true)

async function checkAlert() {
    
    const getVar = (key, map) => (map.get(key) ?? [])[1] ?? null;

    let cExtraVars = Array.from({ length: 4 }, (_, index) => getVar(index, positionProcess.collectedValuesCall));
    let pExtraVars = Array.from({ length: 4 }, (_, index) => getVar(index, positionProcess.collectedValuesPut));

    let [cExtra0Var, cValue1Var, cValue2Var, cExtra3Var] = cExtraVars;
    let [pExtra0Var, pValue1Var, pValue2Var, pExtra3Var] = pExtraVars;
    // console.log(pExtraVars, ' : pExtraVars')
    resStr = '';
    // resStr += (cExtraVars.length !== 0) ? `CE: ${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}` : '';
    if (!cExtraVars.every(element => element === null)) {
        resStr += `CE: ${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}`;
    }
    if (!pExtraVars.every(element => element === null)) {
    resStr += `\nPE: ${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}`;
    }
    // resStr += (pExtraVars.length !== 0) ? `\nPE: ${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}` : '';
    // send_notification(resStr);
    resStr = '';

    if (parseFloat(pValue2Var) < parseFloat(cValue1Var) || parseFloat(cValue2Var) < parseFloat(pValue1Var)) {
        let up = parseFloat(pValue2Var) < parseFloat(cValue1Var)
        let trendingUp = parseFloat(pValue1Var) > parseFloat(cExtra3Var)
        let trendingDown = parseFloat(cValue1Var) > parseFloat(pExtra3Var)
//      vix high or early morning then move away
//      vix low or not early morning then move closer
        if((up && biasOutput.bias > 0) || (!up && biasOutput.bias < 0) || trendingUp || trendingDown ){
            // send_notification(`Going ${up ? 'UP':'DOWN️'}, VIX ${biasProcess.vix}%, Bias ${biasOutput.bias}, 
            //     \nCE: ${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}\nPE: ${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}
            //     \n3:05pm-2distance, 2:40-3, 1:40-4, 12:40-5, 11:40-6, 10:40-7, 9:40-8, 9:18-9`, true);
            await takeAction(up)
        }
    }
}

function getTokenByTradingSymbol(tradingSymbol) {
    const option = biasProcess.optionChain?.values.find(option => option?.tsym === tradingSymbol);
    if (option) {
      return option?.token;
    } else {
      return null; // TradingSymbol not found
    }
  }

function updatePositionsNeighboursAndSubs(autoSubs=true) {
    const updateNeighbours = (optionChain, tsym, nearbyNeighbours, type) => {
        if (Array.isArray(optionChain)) {
            const index = optionChain.findIndex(option => option.tsym === tsym?.tsym);
            if (index !== -1) {
                const startIndex = Math.max(0, index - 2);
                const endIndex = Math.min(optionChain.length - 1, index + 2);
                nearbyNeighbours = optionChain.slice(startIndex, endIndex + 1);
            } else {
                console.error('tsym not found in the array.');
            }
        } else {
            console.error(`optionChain is not an array for ${tsym}.`);
        }
        if (type === 'PE') {
            // Remove the last entries
            nearbyNeighbours && nearbyNeighbours.splice(0, 1);
            
        } else if (type === 'CE') {
            // Remove the first entries
            nearbyNeighbours && nearbyNeighbours.splice(-1);
            nearbyNeighbours && nearbyNeighbours.reverse();
        }
        
        return nearbyNeighbours || [];
    };
    if (positionProcess.smallestCallPosition) positionProcess.callsNearbyNeighbours = updateNeighbours(biasProcess.ocCallOptions, positionProcess.smallestCallPosition, positionProcess.callsNearbyNeighbours, 'CE');
    if (positionProcess.smallestPutPosition) positionProcess.putsNearbyNeighbours = updateNeighbours(biasProcess.ocPutOptions, positionProcess.smallestPutPosition, positionProcess.putsNearbyNeighbours, 'PE');

    // console.log(positionProcess, ' : positionProcess')
    // subscribe
    function dynamicallyAddSubscriptions() {
        const addSubscriptions = (options) => {
            options.forEach(option => {
                dynamicallyAddSubscription(option.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(option.tsym)}` : '');
                console.log(option.tsym, ' :subscribed')
            });
        };
        positionProcess.putsNearbyNeighbours && addSubscriptions(positionProcess.putsNearbyNeighbours);
        positionProcess.callsNearbyNeighbours && addSubscriptions(positionProcess.callsNearbyNeighbours);
    }
    
    // Call the function to dynamically add subscriptions for each tsym
    autoSubs && dynamicallyAddSubscriptions();
    

}

const dynSubs = async () => {
// Dynamically add a subscription after 10 seconds
biasProcess.callSubStr = biasProcess.itmCallSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmCallSymbol)}` : '';
biasProcess.putSubStr = biasProcess.itmPutSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmPutSymbol)}` : '';
dynamicallyAddSubscription(biasProcess.callSubStr);
dynamicallyAddSubscription(biasProcess.putSubStr);
await delay(2000)
return;
}

function getTokenByTradingSymbol(tradingSymbol) {
  const option = biasProcess.optionChain?.values.find(option => option?.tsym === tradingSymbol);
  if (option) {
    return option?.token;
  } else {
    return null; // TradingSymbol not found
  }
}

const ema9_21_3ValuesIndicators = async (params) => {
  try{
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = reply.map(item => parseFloat(item.intc));
    
    //last 50 items
    const last80Items = intcPrices.slice(0,80).reverse();

    // console.log(first21Items)
    //     [
    //       22112,  22121.2,
    //    22119.45,    22122,
    //    22125.15,  22132.5,
    //    22132.25, 22126.65,
    //     22130.1
    //  ]  : first9Items
    //  [
    //       22112,  22121.2, 22119.45,
    //       22122, 22125.15,  22132.5,
    //    22132.25, 22126.65,  22130.1,
    //    22131.75,    22130,    22123,
    //     22122.5,  22121.9,  22130.4,
    //    22125.65,    22123,  22122.9,
    //    22120.35,  22120.2,    22120
    //  ]  : first21Items

    const { Indicators } = require('@ixjb94/indicators');

    // Sample financial data (replace this with your data)
    // const closePrices9 = [42, 45, 48, 50, 55, 60, 65, 70, 75];
    // const closePrices = [10, 15, 12, 18, 20, 22, 25, 28, 30, 32, 35, 40, 42, 45, 48, 50, 55, 60, 65, 70, 75];

    // Calculate 9-period EMA
    let ta = new Indicators();
    let ema3Values = await ta.ema(last80Items, 3);
    let ema9Values = await ta.ema(last80Items, 8);
    // Calculate 21-period EMA
    let ema21Values = await ta.ema(last80Items, 21);
    //send last item from the array
    return [ema9Values[ema9Values.length-1], ema21Values[ema21Values.length-1], ema3Values[ema21Values.length-1]];
  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }
}
//
  // [
  //   {
  //     stat: 'Ok',
  //     time: '16-01-2024 11:06:00',
  //     ssboe: '1705383360',
  //     into: '22116.85',
  //     inth: '22120.95',
  //     intl: '22112.25',
  //     intc: '22115.75',
  //     intvwap: '0.00',
  //     intv: '0',
  //     intoi: '0',
  //     v: '0',
  //     oi: '0'
  //   },
  //   {
  //     stat: 'Ok',
  //     time: '16-01-2024 11:03:00',
  //     ssboe: '1705383180',
  //     into: '22113.40',
  //     inth: '22117.05',
  //     intl: '22110.40',
  //     intc: '22115.60',
  //     intvwap: '0.00',
  //     intv: '0',
  //     intoi: '0',
  //     v: '0',
  //     oi: '0'
  //   },
  //   {
  //     stat: 'Ok',
  //     time: '16-01-2024 11:00:00',
  //     ssboe: '1705383000',
  //     into: '22113.80',
  //     inth: '22116.70',
  //     intl: '22110.10',
  //     intc: '22111.75',
  //     intvwap: '0.00',
  //     intv: '0',
  //     intoi: '0',
  //     v: '0',
  //     oi: '0'
  //   }
  // ]  : reply

const emaMonitorATMs = async () => {
  try{
    let tempAtmStrike = await getAtmStrike()
    if (tempAtmStrike!= biasProcess.atmStrike){
      if (longPositionTaken || shortPositionTaken) { await triggerATMChangeActions() }
      send_notification('ATM changed')
      resetBiasProcess();
      await updateITMSymbolfromOC()
      await dynSubs();
    }

    // Get current date and time in IST
    const currentDateIST = new Date();
    // Set the time to 12 o'clock mid night
    currentDateIST.setHours(0, 0, 0, 0);
    // Subtract 5 day to get the 5 days earlier time
    currentDateIST.setDate(currentDateIST.getDate() - 5);
    // Get epoch time in milliseconds
    const epochTime = currentDateIST.getTime();
    epochTimeTrimmed = epochTime.toString().slice(0, -3);

    paramsCall = {
      'exchange'   : globalInput.pickedExchange,
      'token' : getTokenByTradingSymbol(biasProcess.atmCallSymbol),
      'starttime'    : epochTimeTrimmed,
      'interval' : '1'
      }
    paramsPut = {
      'exchange'   : globalInput.pickedExchange,
      'token' : getTokenByTradingSymbol(biasProcess.atmPutSymbol),
      'starttime'    : epochTimeTrimmed,
      'interval' : '1'
      }
    const [callemaMedium, callemaSlow, callemaFast] = await ema9_21_3ValuesIndicators(paramsCall);
    const [putemaMedium, putemaSlow, putemaFast] = await ema9_21_3ValuesIndicators(paramsPut);
    send_notification('cem : ' + parseFloat(callemaMedium ).toFixed(2)+ ' pem : ' +parseFloat(putemaMedium ).toFixed(2)+ '\ncef : ' + parseFloat(callemaFast).toFixed(2) + ' pef : ' +parseFloat(putemaFast).toFixed(2))
    emaUpFastCall = callemaFast > callemaMedium;
    emaUpFastPut = putemaFast > putemaMedium;
    prevEmaUpFastCall = emaUpFastCall;
    prevEmaUpFastPut = emaUpFastPut;
    return [prevEmaUpFastCall, prevEmaUpFastPut];
  } catch (error) {
    // handle the exception locally
    console.error("Child method encountered an exception:", error.message);
    // optionally, rethrow the exception if needed
    return [prevEmaUpFastCall, prevEmaUpFastPut];
  }
}

let longPositionTaken = false; // Variable to track long position status
let shortPositionTaken = false; // Variable to track short position status

const cancelOpenOrders = async () => {
  const orders = await api.get_orderbook();
  const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'OPEN') : [];
  if (filtered_data_API[0]?.norenordno) {await api.cancel_order(filtered_data_API[0]?.norenordno);}
}

function cleanupAndExit() {
  console.log('Cleanup actions completed.');
  process.exit(0);
}

const exitSellsAndOrStop = async (stop = false) => {
  //exit positions
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  if (positionProcess.smallestPutPosition?.tsym) { await exitXemaLong();}
  if(positionProcess.smallestCallPosition?.tsym) {await exitXemaShort();}
  if(stop) {
    send_notification('exiting all and stopping', true)
    setTimeout(function() {
      cancelOpenOrders();
    }, 2000);
    setTimeout(function() {
      exitHedges();
    }, 4000);
    setTimeout(function() {
      cleanupAndExit();
    }, 6000);
  } else {
    if (longPositionTaken || shortPositionTaken) { send_notification('exiting all');}
  }
}

const triggerATMChangeActions = async () => {
  await exitSellsAndOrStop(false);
}
// const my_default_place_order = async (order) => {
//   const orderno = await api.place_order(order)
//   await delay(2000);
//   return orderno;
// }
// const checkIfOrderNoIsCompletedOrNot = async (orderno) => {
//   //check order status
//   api.singleorderhistory(orderno)
//   await delay(2000);
// }
// const customPlaceOrder = async (order) => {
//   const ordernoToCheck = await my_default_place_order(order)
//   setTimeout(function() {
//   const isCompleted = checkIfOrderNoIsCompletedOrNot(orderno);
//   }, 2000);
// } 
//buy Put
const exitXemaLong = async () => {
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  order = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: positionProcess.smallestPutPosition?.tsym,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: Math.ceil(+positionProcess.smallestPutPosition?.lp + (+positionProcess.smallestPutPosition?.lp/10)),
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  if(positionProcess.smallestPutPosition?.tsym) {await api.place_order(order)}
  longPositionTaken = positionProcess.smallestPutPosition?.tsym ? false:longPositionTaken;
  await delay(1000);
}
const enterXemaLong = async () => {
  let tempTradingPutSymbol = biasProcess.atmPutSymbol;
  //if(isTimeEqualsNotAfterProps(11,40,false)) {tempTradingPutSymbol = biasProcess.otmPutSymbol;}
  //if(globalInput.pickedExchange === 'BFO') {tempTradingPutSymbol = biasProcess.otmPutSymbol;}
  const quotesResponse = await api.get_quotes(globalInput.pickedExchange, getTokenByTradingSymbol(tempTradingPutSymbol));

  order = {
    buy_or_sell: 'S',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: tempTradingPutSymbol,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: +quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5) > 0.1 ? Math.floor(+quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5)) > 0.1 ? Math.floor(+quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5)) : 0.1 : 0.1,
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  await api.place_order(order);
  // send_notification('entering Long', true)
  longPositionTaken = true;
  await delay(1000);
}

//Exit short Call
const exitXemaShort = async () => {
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  order = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: positionProcess.smallestCallPosition?.tsym,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: Math.ceil(+positionProcess.smallestCallPosition?.lp + (+positionProcess.smallestCallPosition?.lp/10)),
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  if(positionProcess.smallestCallPosition?.tsym) {await api.place_order(order)}
  shortPositionTaken = positionProcess.smallestCallPosition?.tsym ? false:shortPositionTaken;
  await delay(1000);
}
const enterXemaShort = async () => {
  let tempTradingCallSymbol = biasProcess.atmCallSymbol;
  //if(isTimeEqualsNotAfterProps(12,40,false)) {tempTradingCallSymbol = biasProcess.atmCallSymbol;}
  //if(globalInput.pickedExchange === 'BFO') {tempTradingCallSymbol = biasProcess.otmCallSymbol;}

  const quotesResponse = await api.get_quotes(globalInput.pickedExchange, getTokenByTradingSymbol(tempTradingCallSymbol));

  order = {
    buy_or_sell: 'S',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: tempTradingCallSymbol,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: +quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5) > 0.1 ? Math.floor(+quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5)) > 0.1 ? Math.floor(+quotesResponse.bp5 - Math.min(+quotesResponse.lp/2 , 5)) : 0.1 : 0.1,
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  await api.place_order(order);
  // send_notification('entering Short', true)
  shortPositionTaken = true;
  await delay(1000);
}



const enterXemaBuyCall = async () => {
  nearestCETsym = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocCallOptions, 1)
  const quotesResponse = await api.get_quotes(globalInput.pickedExchange, getTokenByTradingSymbol(nearestCETsym));
  order = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: nearestCETsym,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: Math.ceil(+quotesResponse.sp5 +3),
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  await api.place_order(order);
  send_notification('bought hedge call', true)
}

const enterXemaBuyPut = async () => {
  nearestPETsym = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocPutOptions, 1)
  const quotesResponse = await api.get_quotes(globalInput.pickedExchange, getTokenByTradingSymbol(nearestPETsym));
  order = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: globalInput.pickedExchange,
    tradingsymbol: nearestPETsym,
    quantity: Math.abs(globalInput.LotSize * globalInput.emaLotMultiplier).toString(),
    discloseqty: 0,
    price_type: 'LMT',
    price: Math.ceil(+quotesResponse.sp5 +3),
    remarks: 'API'
  }
  if(globalInput.pickedExchange != 'BFO' ) {order.price_type = 'MKT', order.price = 0}
  await api.place_order(order);
  send_notification('bought hedge put', true)
}
async function takeEMADecision(emaMonitorFastCallUp, emaFastMonitorPutUp) {
  if(biasOutput.bias > 0){
    //positive bias
    if(shortPositionTaken) {
      await exitXemaShort();
    }
    if((emaFastMonitorPutUp) && longPositionTaken) {
      await exitXemaLong();
    }
    if(!emaFastMonitorPutUp && !longPositionTaken) {
      await enterXemaLong()
    }
  }else{
    //negative bias
    if(longPositionTaken) {
      await exitXemaLong();
    }
    if((emaMonitorFastCallUp) && shortPositionTaken) {
      await exitXemaShort();
    }
    if(!emaMonitorFastCallUp && !shortPositionTaken) {
      await enterXemaShort()
    }
  }
  currentPositionStatus = longPositionTaken ? 'Long' : shortPositionTaken ? 'Short' : 'No Position';
  send_notification(biasOutput.bias + ' ' + currentPositionStatus)
}

const setBiasValue = async () => {
  ltpSuggestedPut = +biasProcess.itmPutStrikePrice - (+latestQuotes[biasProcess.putSubStr]?.lp);
  ltpSuggestedCall = (+latestQuotes[biasProcess.callSubStr]?.lp + +biasProcess.itmCallStrikePrice);
  biasOutput.bias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - +(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`].lp));
}

const optionBasedEmaRecurringFunction = async () => {
  await setBiasValue();
  let [emaMonitorFastCallUp, emaFastMonitorPutUp] = await emaMonitorATMs();
  await takeEMADecision(emaMonitorFastCallUp, emaFastMonitorPutUp)
}

// let openOrderTimeCounter = 0;  
const checkForOpenOrders = async () => {
  const orders = await api.get_orderbook();
  const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'OPEN') : [];
  if (filtered_data_API[0]?.norenordno) {
    await cancelOpenOrders();
    await triggerATMChangeActions()
    send_notification('open order handled')
  }
  // if(openOrderTimeCounter == 2){
  //   await cancelOpenOrders();
  //   await triggerATMChangeActions()
  //   send_notification('open order handled')
  //   openOrderTimeCounter = 0;
  // }
  // const orders = await api.get_orderbook();
  // const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'OPEN') : [];
  // if (filtered_data_API[0]?.norenordno) {openOrderTimeCounter = openOrderTimeCounter + 1}
  // else {openOrderTimeCounter = 0;}
}

// main run by calling recurring function and subscribe to new ITMs for BiasCalculation
getEma = async () => {
  var currentDate = new Date();
  var seconds = currentDate.getSeconds();
  // check when second is 2 on the clock for every minute
  if (seconds === 2) {
  //TODO 
  // if (seconds % 5 == 0) {
    try {
      await optionBasedEmaRecurringFunction();
    } catch (error) {
        console.error("Error occured in optionBasedEmaRecurringFunction: " + error);
        send_notification("Error occured in optionBasedEmaRecurringFunction")
        // getBias();
    }
  }
  if(seconds === 15){
    try {
      await checkForOpenOrders()
    } catch (error) {
        console.error("Error occured in checkForOpenOrders: " + error);
        send_notification("Error occured in checkForOpenOrders")
    }
  }
  if(seconds === 25){
    try {
      //TODO uncomment
      if(isTimeEqualsNotAfterProps(15,26,false)) {
        await exitSellsAndOrStop(true);
      }
    } catch (error) {
        console.error("Error occured in checkForOpenOrders: " + error);
        send_notification("Error occured in checkForOpenOrders")
    }
  }
}

const runEma = async () => {
  try {
    await executeLogin();
    await startWebsocket();
    await send_callback_notification();
    await updateITMSymbolfromOC();
    await dynSubs();
    await updateTwoSmallestPositionsAndNeighboursSubs(false);
    limits = await api.get_limits()

    globalInput.emaLotMultiplierQty = getEMAQtyForGeneric();
    globalInput.emaLotMultiplier = Math.floor(globalInput.emaLotMultiplierQty/globalInput.LotSize);
    
    // console.log(limits?.cash, ' limits')
    // console.log(globalInput.emaLotMultiplierQty, ' globalInput.emaLotMultiplierQty')
    // console.log(globalInput.emaLotMultiplier, ' globalInput.emaLotMultiplier')
    //TODO uncomment
    if(positionProcess.hedgeCall === undefined || positionProcess.hedgeCall?.length === 0) {await enterXemaBuyCall()};
    if(positionProcess.hedgePut === undefined || positionProcess.hedgePut?.length === 0) {await enterXemaBuyPut()};
    


  //   request_time: '23:28:00 31-01-2024',
  //   stat: 'Ok',
  //   prfname: 'SHOONYA1',
  //   cash: '206923.34',
  //   payin: '0.00',
  //   payout: '0.00',
  //   brkcollamt: '0.00',
  //   unclearedcash: '0.00',
  //   aux_daycash: '0.00',
  //   aux_brkcollamt: '0.00',
  //   aux_unclearedcash: '0.00',
  //   daycash: '0.00',
  //   turnoverlmt: '999999999999.00',
  //   pendordvallmt: '999999999999.00',
  //   remarks_amt: '0.00',
  //   turnover: '786041727.25',
  //   marginused: '20470.00',
  //   peak_mar: '189634.50',
  //   margincurper: '9.13',
  //   premium: '17310.25',
  //   brokerage: '1579.78',
  //   premium_d_i: '-4095.00',
  //   premium_d_m: '935.25',
  //   premium_c_m: '20470.00',
  //   brkage_d_i: '68.69',
  //   brkage_d_m: '887.15',
  //   brkage_c_m: '623.94',
  //   blk_amt: '0.00',
  //   mr_der_u: '9.35',
  //   mr_com_u: '204.70',
  //   mr_der_a: '155452.29'
  // }  limits
// process.exit(0)
            
    if (telegramSignals.isPlaying) {
      intervalIdForEMA = setInterval(getEma, delayForEMA);
    }
    
  } catch (error) {
    console.log(error);
  }
};

// Function to pause the EMA calculations
const pauseEma = () => {
  if (telegramSignals.isPlaying) {
    console.log("#########################pausing")
    clearInterval(intervalIdForEMA);
    telegramSignals.isPlaying = false;
  }
};

// Function to resume the EMA calculations
const resumeEma = () => {
  if (!telegramSignals.isPlaying) {
    console.log("#########################resuming")
    intervalIdForEMA = setInterval(getEma, delayForEMA);
    telegramSignals.isPlaying = true;
  }
};

runEma();
