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
const { isTimeEqualsNotAfterProps, idxNameTokenMap, idxNameOcGap, downloadCsv, filterAndMapDates, 
  identify_option_type, fetchSpotPrice, getStrike } = require('./utils/customLibrary');
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(telegramBotToken, { polling: true });
const send_notification = async (message, me = false) => (message && console.log(message)) || (!debug && message && await bot.sendMessage((me && !telegramSignals.stopSignal) ? chat_id_me : chat_id, (me && !telegramSignals.stopSignal) ? message : message.replace(/\) /g, ")\n")).catch(console.error));

let globalBigInput = {
  filteredIndexCSV: undefined
}
// getPickedIndexHere = () => debug ? 'NIFTY' : ['NIFTY', 'BANKEX', 'FINNIFTY', 'BANKNIFTY', 'NIFTY', 'SENSEX', 'BANKEX'][new Date().getDay()] || 'NIFTY';
getPickedIndexHere = () => debug ? 'CRUDEOIL' : ['CRUDEOIL', 'CRUDEOIL', 'CRUDEOIL', 'CRUDEOIL', 'CRUDEOIL', 'CRUDEOIL', 'CRUDEOIL'][new Date().getDay()] || 'CRUDEOIL';
let telegramSignals = {
  stopSignal: false,
  exitSignal: false,
  slower: false,
  faster: false,
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
  emaLotMultiplier: 1,
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
  ocPutOptions: undefined,
  atmCallSymbol: undefined,
  atmCallStrikePrice: undefined,
  callSubStr: undefined,
  itmPutSymbol: undefined,
  itmPutStrikePrice: undefined,
  atmPutSymbol: undefined,
  atmPutStrikePrice: undefined,
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
  biasProcess.atmStrike = undefined,
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

//websocket
let websocket;
let websocket_closed= false;
let intervalId;

let latestQuotes = {};
let latestOrders = {};

let positionProcess = {
  smallestCallPosition: undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
  smallestPutPosition: undefined,
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
  // const exchangeType = globalInput.indexName.includes('EX') ? 'BFO' : 'NFO';
  const exchangeType = globalInput.indexName.includes('CRUDEOIL') ? 'MCX' : 'MCX';
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

    
    
    globalBigInput.filteredIndexCSV = filterAndMapDates(moment, symbolDf.filter((row) => ['OPTFUT', 'FUTCOM'].includes(row.Instrument) && row.Symbol === globalInput.indexName));
    // MCX,425852,100,1,CRUDEOIL,CRUDEOIL14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
    // MCX,260602,100,1,CRUDEOIL,CRUDEOIL16FEB24,16-FEB-2024,FUTCOM,XX,0,1,

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
    const expiryList = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => row.Instrument === 'OPTFUT').map((row) => row.Expiry))];
    // console.log(expiryList)
    // MCX,425852,100,1,CRUDEOIL,CRUDEOIL14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
    const expiryFutList = globalBigInput.filteredIndexCSV
      .filter((row) => row.Instrument === 'FUTCOM')
      .map((row) => ({ Exchange: row.Exchange, LotSize: row.LotSize, TradingSymbol: row.TradingSymbol, Expiry: row.Expiry }));
      // MCX,260602,100,1,CRUDEOIL,CRUDEOIL16FEB24,16-FEB-2024,FUTCOM,XX,0,1,
    expiryList.sort();
    expiryFutList.sort((a, b) => moment(a.Expiry).diff(moment(b.Expiry)));
    
    globalInput.inputOptTsym = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => (row.Instrument === 'OPTFUT' && row.Expiry === expiryList[0])).map((row) => row.TradingSymbol))][0];
    // MCX,425852,100,1,CRUDEOIL,CRUDEOIL14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
    // console.log(globalInput.inputOptTsym, 'globalInput.inputOptTsym')
    globalInput.WEEKLY_EXPIRY = expiryList[0];
    globalInput.MONTHLY_EXPIRY = expiryFutList[0].Expiry;
    globalInput.pickedExchange = expiryFutList[0].Exchange;
    globalInput.LotSize = expiryFutList[0].LotSize;

    // console.log(globalInput)

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

runFindNearestExpiry = async () => {
  await findNearestExpiry();
}

// Execute the findNearestExpiry function
runFindNearestExpiry();

const Api = require("./lib/RestApi");
let api = new Api({});

const getAtmStrike = () => {
  // console.log(`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}`)
  // console.log(globalInput.token)
  // console.log(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]);
  // process.exit(0)
  biasProcess.spotObject = latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`];
  // debug && console.log(biasProcess.spotObject) //updateAtmStrike(s) --> 50, spot object -> s?.lp = 20100
  return Math.round(biasProcess.spotObject?.lp / globalInput.ocGap) * globalInput.ocGap
}

// telegram callbackQuery
async function send_callback_notification() {
    try {
        const keyboard = {inline_keyboard: [[
                { text: '🐌', callback_data: 'slower' },
                { text: '🚀', callback_data: 'faster' },
                { text: '💹', callback_data: 'toggleExchange' },
                { text: '⏸', callback_data: 'stop' },
                { text: '🛑', callback_data: 'exit' }
              ]]};
      !debug && bot.sendMessage(chat_id_me, 'Choose server settings', { reply_markup: keyboard });
    } catch (error) { console.error(error);send_notification(error + ' error occured', true)}
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
    if (data === 'exit') telegramSignals.exitSignal = true;
    if (data === 'stop') telegramSignals.stopSignal = !telegramSignals.stopSignal;
    else if (data === 'toggleExchange') globalInput.pickedExchange = (globalInput.pickedExchange === 'NFO' ? 'BFO' : globalInput.pickedExchange === 'BFO' ? 'MCX' : 'NFO');
    bot.sendMessage(chatId, `Exchange: ${globalInput.pickedExchange}, Paused: ${telegramSignals.stopSignal} - pause, exit, slower, faster are not implemented`);
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


updatePositions = async => {
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
                const calls = data.filter(option => parseInt(option.netqty) < 0 && option.tsym.match(/C\d+$/));
                const puts = data.filter(option => parseInt(option.netqty) < 0 && option.tsym.match(/P\d+$/));
                positionProcess.smallestCallPosition = calls.length > 0 ? calls.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), calls[0]) : resetCalls();
                positionProcess.smallestPutPosition = puts.length > 0 ? puts.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), puts[0]) : resetPuts();
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

updateTwoSmallestPositionsAndNeighboursSubs = async () => {
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
        updatePositionsNeighboursAndSubs();
    } finally {
        isQueueBusy = false;
        // Process the next function call in the queue if any
        if (queue.length > 0) {
            const nextItem = queue.shift(); // Remove the item from the queue
            // console.log('Processing next item in the updateTwoSmallestPositionsAndNeighboursSubs queue.');
            updateTwoSmallestPositionsAndNeighboursSubs();
        }
    }
}
// updateTwoSmallestPositionsAndNeighboursSubs();


postOrderPosTracking = (data) => {
    updateTwoSmallestPositionsAndNeighboursSubs();
    // Update call position subscription
    positionProcess.posCallSubStr = positionProcess.smallestCallPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionProcess.smallestCallPosition.tsym)}` : '';
    //todo verify this before &&
    positionProcess.posCallSubStr && dynamicallyAddSubscription(positionProcess.posCallSubStr);
    // Update put position subscription
    positionProcess.posPutSubStr = biasProcess.smallestPutPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.smallestPutPosition.tsym)}` : '';
    //todo verify this before &&
    positionProcess.posPutSubStr && dynamicallyAddSubscription(positionProcess.posPutSubStr);

    send_notification(data?.trantype + ' order placed: ' + data?.tsym + ' at ' + data?.flprc + ' ' + new Date().toLocaleTimeString("en-IN", {timeZone: "Asia/Kolkata"}), true )
    send_notification(data?.trantype + ' order placed: ' + data?.tsym + ' at ' + data?.flprc + ' ' + new Date().toLocaleTimeString("en-IN", {timeZone: "Asia/Kolkata"}))
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
    if(data.status === 'COMPLETE') {
        latestOrders[data.Instrument] = data;
        // update the smallest positions after each order
        postOrderPosTracking(data)
    }
}

function open(data) {
    // console.log(`NSE|${globalInput.token}`)
    
    const initialInstruments = [`${globalInput.indexName.includes('CRUDEOIL') ? 'MCX' : 'MCX'}|${globalInput.token}`, 'NSE|26017']; 

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
        biasProcess.atmStrike = getAtmStrike();
        
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

    // console.log(biasProcess, 'bp')
    
    return;
}

async function updateITMSymbolfromOC() {
    await delay(1000)
    // Get the Nifty option chain
    biasProcess.optionChain = await getOptionChain();
    await delay(1000)
    if (biasProcess.optionChain) {
        // Find the ITM symbol
        await delay(1000)
        updateITMSymbolAndStrike();
        await delay(1000)
        debug && console.log(biasProcess, ' :biasProcess')
    }
}

async function takeAction(goingUp) {
    // let orders = await api.get_orderbook() 
    // console.log(orders)

    //BUY
    // {
    //     stat: 'Ok',
    //     norenordno: '23121900039453',
    //     kidid: '1',
    //     uid: 'FA63911',
    //     actid: 'FA63911',
    //     exch: 'NFO',
    //     tsym: 'FINNIFTY19DEC23C21750',
    //     qty: '400',
    //     ordenttm: '1702957680',
    //     trantype: 'B',
    //     prctyp: 'MKT',
    //     ret: 'DAY',
    //     token: '35040',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     instname: 'OPTIDX',
    //     ordersource: 'API',
    //     dname: 'FINNIFTY DEC 21750 CE ',
    //     pp: '2',
    //     ls: '40',
    //     ti: '0.05',
    //     prc: '0.00',
    //     rprc: '1.05',
    //     avgprc: '1.05',
    //     dscqty: '0',
    //     brnchid: 'HO',
    //     C: 'C',
    //     s_prdt_ali: 'MIS',
    //     prd: 'I',
    //     status: 'COMPLETE',
    //     st_intrn: 'COMPLETE',
    //     fillshares: '400',
    //     norentm: '09:18:00 19-12-2023',
    //     exch_tm: '19-12-2023 09:18:00',
    //     remarks: 'Tue IC fin helper_Entry_0_fintarget',
    //     exchordid: '1200000004793558',
    //     rqty: '400'
    //   }

      
    // SELL
    // {
    //     stat: 'Ok',
    //     norenordno: '23121900040101',
    //     kidid: '1',
    //     uid: 'FA63911',
    //     actid: 'FA63911',
    //     exch: 'NFO',
    //     tsym: 'FINNIFTY19DEC23P21150',
    //     qty: '400',
    //     ordenttm: '1702957682',
    //     trantype: 'S',
    //     prctyp: 'MKT',
    //     ret: 'DAY',
    //     token: '51814',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     instname: 'OPTIDX',
    //     ordersource: 'API',
    //     dname: 'FINNIFTY DEC 21150 PE ',
    //     pp: '2',
    //     ls: '40',
    //     ti: '0.05',
    //     prc: '0.00',
    //     rprc: '1.25',
    //     avgprc: '1.25',
    //     dscqty: '0',
    //     brnchid: 'HO',
    //     C: 'C',
    //     s_prdt_ali: 'MIS',
    //     prd: 'I',
    //     status: 'COMPLETE',
    //     st_intrn: 'COMPLETE',
    //     fillshares: '400',
    //     norentm: '09:18:02 19-12-2023',
    //     exch_tm: '19-12-2023 09:18:02',
    //     remarks: 'Tue IC fin helper_Entry_3_fintarget',
    //     exchordid: '1900000004305097',
    //     rqty: '400'
    //   },

    //SL-LMT
    // {
    //   stat: 'Ok',
    //   norenordno: '23121900048453',
    //   kidid: '3',
    //   uid: 'FA63911',
    //   actid: 'FA63911',
    //   exch: 'NFO',
    //   tsym: 'FINNIFTY19DEC23P21200',
    //   qty: '1000',
    //   rorgqty: '800',
    //   ordenttm: '1702960020',
    //   trantype: 'B',
    //   prctyp: 'SL-LMT',
    //   ret: 'DAY',
    //   token: '51816',
    //   mult: '1',
    //   prcftr: '1.000000',
    //   instname: 'OPTIDX',
    //   ordersource: 'MOB',
    //   dname: 'FINNIFTY DEC 21200 PE ',
    //   pp: '2',
    //   ls: '40',
    //   ti: '0.05',
    //   prc: '25.00',
    //   trgprc: '24.00',
    //   rorgprc: '25.00',
    //   rprc: '25.00',
    //   dscqty: '0',
    //   brnchid: 'HO',
    //   C: 'C',
    //   s_prdt_ali: 'MIS',
    //   prd: 'I',
    //   status: 'TRIGGER_PENDING',
    //   st_intrn: 'TRIGGER_PENDING',
    //   norentm: '09:57:00 19-12-2023',
    //   exch_tm: '19-12-2023 09:57:00',
    //   exchordid: '1900000006486411',
    //   rqty: '1000'
    // },
    console.log('take action')
    // let positions = await api.get_positions() 
    // console.log(positions)
    // {
    //     stat: 'Ok',
    //     uid: 'FA63911',
    //     actid: 'FA63911',
    //     exch: 'NFO',
    //     tsym: 'FINNIFTY19DEC23C21500',
    //     s_prdt_ali: 'MIS',
    //     prd: 'I',
    //     token: '51843',
    //     instname: 'OPTIDX',
    //     dname: 'FINNIFTY DEC 21500 CE ',
    //     frzqty: '1801',
    //     pp: '2',
    //     ls: '40',
    //     ti: '0.05',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     daybuyqty: '0',
    //     daysellqty: '1000',
    //     daybuyamt: '0.00',
    //     daybuyavgprc: '0.00',
    //     daysellamt: '5450.00',
    //     daysellavgprc: '5.45',
    //     cfbuyqty: '0',
    //     cfsellqty: '0',
    //     openbuyqty: '1000',
    //     opensellqty: '0',
    //     openbuyamt: '25000.00',
    //     openbuyavgprc: '25.00',
    //     opensellamt: '0.00',
    //     opensellavgprc: '0.00',
    //     dayavgprc: '5.45',
    //     netqty: '-1000',
    //     netavgprc: '5.45',
    //     upldprc: '0.00',
    //     netupldprc: '5.45',
    //     lp: '4.95',
    //     urmtom: '500.00',
    //     bep: '5.45',
    //     totbuyamt: '0.00',
    //     totsellamt: '5450.00',
    //     totsellavgprc: '5.45',
    //     rpnl: '0.00'
    //   },
    //   {
    //     stat: 'Ok',
    //     uid: 'FA63911',
    //     actid: 'FA63911',
    //     exch: 'NFO',
    //     tsym: 'FINNIFTY19DEC23P21200',
    //     s_prdt_ali: 'MIS',
    //     prd: 'I',
    //     token: '51816',
    //     instname: 'OPTIDX',
    //     dname: 'FINNIFTY DEC 21200 PE ',
    //     frzqty: '1801',
    //     pp: '2',
    //     ls: '40',
    //     ti: '0.05',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     daybuyqty: '0',
    //     daysellqty: '1000',
    //     daybuyamt: '0.00',
    //     daybuyavgprc: '0.00',
    //     daysellamt: '3080.00',
    //     daysellavgprc: '3.08',
    //     cfbuyqty: '0',
    //     cfsellqty: '0',
    //     openbuyqty: '1000',
    //     opensellqty: '0',
    //     openbuyamt: '25000.00',
    //     openbuyavgprc: '25.00',
    //     opensellamt: '0.00',
    //     opensellavgprc: '0.00',
    //     dayavgprc: '3.08',
    //     netqty: '-1000',
    //     netavgprc: '3.08',
    //     upldprc: '0.00',
    //     netupldprc: '3.08',
    //     lp: '2.95',
    //     urmtom: '130.00',
    //     bep: '3.08',
    //     totbuyamt: '0.00',
    //     totsellamt: '3080.00',
    //     totsellavgprc: '3.08',
    //     rpnl: '0.00'
    //   },

    console.log('positions')
    // console.log(positionProcess.smallestCallPosition, 'positionProcess.smallestCallPosition')
    // console.log(positionProcess.smallestPutPosition, 'positionProcess.smallestPutPosition')



    //BUY
    // {
    //     stat: 'Ok',
    //     norenordno: '23121900039453',
    //     kidid: '1',
    //     uid: 'FA63911',
    //     actid: 'FA63911',
    //     exch: 'NFO',
    //     tsym: 'FINNIFTY19DEC23C21750',
    //     qty: '400',
    //     ordenttm: '1702957680',
    //     trantype: 'B',
    //     prctyp: 'MKT',
    //     ret: 'DAY',
    //     token: '35040',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     instname: 'OPTIDX',
    //     ordersource: 'API',
    //     dname: 'FINNIFTY DEC 21750 CE ',
    //     pp: '2',
    //     ls: '40',
    //     ti: '0.05',
    //     prc: '0.00',
    //     rprc: '1.05',
    //     avgprc: '1.05',
    //     dscqty: '0',
    //     brnchid: 'HO',
    //     C: 'C',
    //     s_prdt_ali: 'MIS',
    //     prd: 'I',
    //     status: 'COMPLETE',
    //     st_intrn: 'COMPLETE',
    //     fillshares: '400',
    //     norentm: '09:18:00 19-12-2023',
    //     exch_tm: '19-12-2023 09:18:00',
    //     remarks: 'Tue IC fin helper_Entry_0_fintarget',
    //     exchordid: '1200000004793558',
    //     rqty: '400'
    //   }
        
    let newPositionSymbol= (posObj, status) => {
        return status == 'aggressive' ? getCallTokenSymbol(posObj, 'closer') : getCallTokenSymbol(posObj, 'farther')
    }

    const getCallTokenSymbol = (item, distance, level=1) => {
        if (globalInput.pickedExchange === globalInput.pickedExchange){//BANKNIFTY22NOV23C43800, FINNIFTY28NOV23C19300, NIFTY23NOV23C19750


        // Original string
        var originalString = item.tsym //"FINNIFTY19DEC23C21600";
        

        // Using slice(0, -5) to remove the last five characters
        var baseString = originalString.slice(0, -5);
        var lastFiveDigits = originalString.slice(-5);

        // New strike price
        var newStrikePrice = +lastFiveDigits + +globalInput.ocGap;
        var newStrikePrice2 = +lastFiveDigits - +globalInput.ocGap;
        // Creating the new string by appending the new strike price
        var newString = baseString + newStrikePrice;
        var newString2 = baseString + newStrikePrice2;

        // console.log("Original String:", originalString);
        // console.log("New String:", newString);
        // console.log("New String2:", newString2);


        return distance === 'closer' ? newString2: newString;

        }
        // else if (getPickedExchange() === 'BFO') {//SENSEX23N1765500PE, BANKEX23N2049300CE
        //     return `${item.tsym.slice(0, -7)}${getStrike(item.tsym, getPickedExchange()) + (parseInt(ocGapCalc, 10)*level)}${item.tsym.slice(-2)}`;
        // }
        // else if (getPickedExchange() === 'MCX') {// NATURALGAS23NOV23P230
        //     const pattern = /(\d+)$/;
        //     const match = item.tsym.match(pattern);
        //     if (match) {
        //         const [, originalStrike] = match;
        //         const newNumericValue = Number(originalStrike) - parseInt(ocGapCalc, 10);
        //         return item.tsym.replace(originalStrike, newNumericValue); // NATURALGAS23NOV23P235
        //     }
        // }
        // else {
        //     console.log("Strike price not found in the symbol.");
        //     return null;
        // }
    }

    let orderCE = {
        buy_or_sell: 'B',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionProcess.smallestCallPosition?.tsym,
        quantity: Math.abs(positionProcess.smallestCallPosition?.netqty).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSOrderCEExitAPI'
    }
    

    let orderPE = {
        buy_or_sell: 'B',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionProcess.smallestPutPosition?.tsym,
        quantity: Math.abs(positionProcess.smallestPutPosition?.netqty).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSOrderPEExitAPI'
    }
    
    let orderAggressiveCallPosition = newPositionSymbol(positionProcess.smallestCallPosition, 'aggressive')
    let orderSubmissiveCallPosition = newPositionSymbol(positionProcess.smallestCallPosition, 'submissive')


    let orderAggressivePutPosition = newPositionSymbol(positionProcess.smallestPutPosition, 'submissive')
    let orderSubmissivePutPosition = newPositionSymbol(positionProcess.smallestPutPosition, 'aggressive')
    // console.log(orderAggressivePosition, 'orderAggressivePosition')
    // console.log(orderSubmissivePosition, 'orderSubmissivePosition')

    let orderAggressiveCE = {
        buy_or_sell: 'S',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: orderAggressiveCallPosition,
        quantity: Math.abs(+positionProcess.smallestCallPosition?.netqty + +positionProcess.smallestCallPosition?.ls).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSNewOrderAggressiveCEEntryAPI'
    }

    let orderSubmissiveCE = {
        buy_or_sell: 'S',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: orderSubmissiveCallPosition,
        quantity: Math.abs(+positionProcess.smallestCallPosition?.netqty + +positionProcess.smallestCallPosition?.ls).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSNewOrderSubmissiveCEEntryAPI'
    }

    let orderAggressivePE = {
        buy_or_sell: 'S',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: orderAggressivePutPosition,
        quantity: Math.abs(+positionProcess.smallestPutPosition?.netqty + +positionProcess.smallestPutPosition?.ls).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSNewOrderAggressivePEEntryAPI'
    }

    let orderSubmissivePE = {
        buy_or_sell: 'S',
        product_type: 'I',
        exchange: globalInput.pickedExchange,
        tradingsymbol: orderSubmissivePutPosition,
        quantity: Math.abs(+positionProcess.smallestPutPosition?.netqty + +positionProcess.smallestPutPosition?.ls).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'WSNewOrderSubmissivePEEntryAPI'
    }

    if(goingUp && !telegramSignals.stopSignal && !debug) {
        await api.place_order(orderCE);
        biasProcess.vix > 0 ? await api.place_order(orderSubmissiveCE) : await api.place_order(orderAggressiveCE);
    }else if (!goingUp && !telegramSignals.stopSignal && !debug){
        await api.place_order(orderPE);
        biasProcess.vix > 0 ? await api.place_order(orderSubmissivePE) : await api.place_order(orderAggressivePE);
    }
    // console.log(orderCE, 'orderCE')
    // console.log(orderPE, 'orderPE')
    // console.log(orderAggressiveCE, 'orderAggressiveCE')
    // console.log(orderSubmissiveCE, 'orderSubmissiveCE')
    // console.log(orderAggressivePE, 'orderAggressivePE')
    // console.log(orderSubmissivePE, 'orderSubmissivePE')
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

// updateBias and updateITMSymbolfromOC when atmStrike changes
myRecurringFunction = async () => {
  try{

    getAtmStrike()!= biasProcess.atmStrike && resetBiasProcess() && await updateITMSymbolfromOC() && await dynSubs();
    biasProcess.vix = latestQuotes['NSE|26017']?.pc;
    // console.log(latestQuotes['NSE|26017'], "latestQuotes['NSE|26017']")
    debug && console.log(`${biasProcess.itmCallSymbol}:`, latestQuotes[biasProcess.callSubStr] ? latestQuotes[biasProcess.callSubStr]?.lp : "N/A", "Order:", latestOrders[biasProcess.callSubStr]);
    debug && console.log(`${biasProcess.itmPutSymbol}:`, latestQuotes[biasProcess.putSubStr] ? latestQuotes[biasProcess.putSubStr]?.lp : "N/A", "Order:", latestOrders[biasProcess.putSubStr]);

    ltpSuggestedPut = +biasProcess.itmPutStrikePrice - (+latestQuotes[biasProcess.putSubStr]?.lp);
    ltpSuggestedCall = (+latestQuotes[biasProcess.callSubStr]?.lp + +biasProcess.itmCallStrikePrice);
    // console.log(latestQuotes[biasProcess.callSubStr], biasProcess.itmCallStrikePrice, latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]?.lp, 'call')
    // console.log(latestQuotes[biasProcess.putSubStr], biasProcess.itmPutStrikePrice, latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]?.lp, 'put')
    const result = ((ltpSuggestedCall + ltpSuggestedPut) / 2) - +(latestQuotes[`${globalInput.pickedExchange}|${globalInput.token}`]?.lp);

    if (!isNaN(result)) {
      // The result is a valid number
      biasOutput.bias = Math.round(result);
    } else {
      // Handle the case where the result is NaN
      biasOutput.bias = 0;
      // You might want to assign a default value or handle it in another way
    }

    // biasOutput.bias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - +(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]?.lp));
    // console.log(biasOutput.bias, ' : biasOutput.bias');
    // console.log(`vix = ${biasProcess.vix}`);

    async function dynamicallyLogPositionsLTP() {
    
      const logSubscriptions = (options, type) => {
        options?.forEach((option, key) => {
          const ltp = latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(option.tsym)}`]?.lp;
          // positionProcess[type === 'PE' ? 'collectedValuesPut' : 'collectedValuesCall'].set(key, [`${globalInput.pickedExchange}|${option.token}`, ltp]);
          positionProcess[type === 'PE' ? 'collectedValuesPut' : 'collectedValuesCall'].set(key, [option.tsym, ltp]);
        });
      };
    
      positionProcess.callsNearbyNeighbours && logSubscriptions(positionProcess.callsNearbyNeighbours, 'CE');
      positionProcess.putsNearbyNeighbours && logSubscriptions(positionProcess.putsNearbyNeighbours, 'PE');

      // Now, collectedValues contains the assigned values
      // positionProcess.collectedValuesCall.size != 0 && console.log("CE_selected: ", [...positionProcess.collectedValuesCall.get(1)][1]); // get(0) is far, 1 is current, 2 and 3 are near
      debug && positionProcess.collectedValuesCall.size != 0 && console.log("current name: ", [...positionProcess.collectedValuesCall.get(1)][0]); //current name
      debug && positionProcess.collectedValuesCall.size != 0 && console.log("current ltp: ", [...positionProcess.collectedValuesCall.get(1)][1]); //current ltp
      debug && positionProcess.collectedValuesCall.size != 0 && console.log("positionProcess.collectedValuesCall: ", [...positionProcess.collectedValuesCall.values()]);
      debug && positionProcess.collectedValuesPut.size != 0 && console.log("positionProcess.collectedValuesPut: ", [...positionProcess.collectedValuesPut.values()]);
      // current name:  NIFTY14DEC23C20950
      // current ltp:  123.95
      // CE:  [
      //   [ 'NIFTY14DEC23C21000', '94.90' ],
      //   [ 'NIFTY14DEC23C20950', '123.95' ],
      //   [ 'NIFTY14DEC23C20900', '157.25' ],
      //   [ 'NIFTY14DEC23C20850', '196.45' ]
      // ]
      // PE:  [
      //   [ 'NIFTY14DEC23P21000', '82.50' ],
      //   [ 'NIFTY14DEC23P21050', '108.40' ],
      //   [ 'NIFTY14DEC23P21100', '138.00' ],
      //   [ 'NIFTY14DEC23P21150', '172.45' ]
      // ]

      await checkAlert();

      // If you want to use the values individually, you can loop through collectedValues
      // collectedValues.forEach(value => {
      //   // Do something with each value
      //   console.log(value);
      // });
    }
    
  
    // Call the function to log each ltp
    dynamicallyLogPositionsLTP();


    // Check a condition to determine whether to stop the recurring function
    if (websocket_closed) {
      clearInterval(intervalId);
      // console.log(latestOrders, 'latestOrders')
      console.log('Recurring function stopped.');
    }
  } catch (error) {
    // handle the exception locally
    console.error("Child method encountered an exception:", error.message);
    // optionally, rethrow the exception if needed
    throw error;
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

function updatePositionsNeighboursAndSubs() {
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
    dynamicallyAddSubscriptions();
    

}

const dynSubs = async () => {
// Dynamically add a subscription after 10 seconds
biasProcess.callSubStr = biasProcess.itmCallSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmCallSymbol)}` : '';
biasProcess.putSubStr = biasProcess.itmPutSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmPutSymbol)}` : '';
dynamicallyAddSubscription(biasProcess.callSubStr);
dynamicallyAddSubscription(biasProcess.putSubStr);
return;
}

// // main run by calling recurring function and subscribe to new ITMs for BiasCalculation
// getBias = async () => {
//     try {
//         await executeLogin();
//         await startWebsocket();
//         await updateITMSymbolfromOC();
//         // Start the recurring function and store the interval identifier
//         intervalId = setInterval(await myRecurringFunction, globalInput.delayTime);
//         await dynSubs();
//         await delay(1000);
//         await updateTwoSmallestPositionsAndNeighboursSubs();
//         await delay(1000);
//         updatePositionsNeighboursAndSubs();
//         await send_callback_notification();

//         // setTimeout(() => {
//         //     api.closeWebSocket();
//         //     websocket_closed = true;
//         // }, 10000);
//     } catch (error) {
//         console.error(error);
//         send_notification(error, true)
//         getBias();
//     }
// };
// getBias();

const long = async (symbol, qty) => {
let orderCE = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: symbol || 'CRUDEOIL14DEC23P6700',
    quantity: (100*globalInput.emaLotMultiplier).toString(), // multiplier
    discloseqty: (100*globalInput.emaLotMultiplier).toString(), // multiplier
    price_type: 'LMT',
    price: +(latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(symbol)}`]?.lp) + 2 || 0,
    remarks: 'PawanLongCrudeAPI'
  }
  try{
    orderCERespObj = await api.place_order(orderCE);
    console.log(orderCERespObj, ' :orderCERespObj')
    console.log(symbol, qty, ' :symbol qty long')
  }
  catch(error){
    console.log(error)
  }
    
}
const short = async (symbol, qty) => {
    let orderCE = {
      buy_or_sell: 'S',
      product_type: 'M',
      exchange: 'MCX',
      tradingsymbol: symbol || 'CRUDEOIL14DEC23P6700',
      quantity: (100*globalInput.emaLotMultiplier).toString(), // multiplier
      discloseqty: (100*globalInput.emaLotMultiplier).toString(), // multiplier
      price_type: 'LMT',
      price: +(latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(symbol)}`]?.lp) - 2 || 0,
      remarks: 'PawanShortCrudeAPI'
      }
      try{
    orderPERespObj = await api.place_order(orderCE);
    console.log(orderPERespObj, ' :orderPERespOb')
    console.log(symbol, qty, ' :symbol qty short')
  }
  catch(error){
    console.log(error)
  }
    
}



let positionTaken = false;
// let callPreviousValue = false;
let positionTakenInSymbol = '';

let prevEma9LessThanEma21 = ''
let crossedUp = ''

async function sellercrudecheckCrossOverExit(ema9, ema21) {
  if (prevEma9LessThanEma21 === '') {
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    send_notification('first prevEma9LessThanEma21 stored for reference as '+ prevEma9LessThanEma21);
  }
  else if (!positionTaken && prevEma9LessThanEma21 && ema9 > ema21) {
      send_notification("Cross over detected. Take call position." + new Date());
      await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmPutSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
      // Place your position-taking logic here
  } else if (!positionTaken && !prevEma9LessThanEma21 && ema9 < ema21) {
      send_notification("Cross over detected. Take put position." + new Date());
      await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmCallSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
  }
  else if (positionTaken) {
      if(crossedUp && ema9 < ema21){
        // exitLong addshort
        await long(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTakenInSymbol = biasProcess.atmCallSymbol;
        positionTaken = true;
        prevEma9LessThanEma21 = ema9 < ema21;
        crossedUp = ema9 > ema21;
      
      } else if (!crossedUp && ema9 > ema21){
        // exitShort addLong
        await long(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTakenInSymbol = biasProcess.atmPutSymbol;
        positionTaken = true;
        prevEma9LessThanEma21 = ema9 < ema21;
        crossedUp = ema9 > ema21;
      }
  } else {
      console.log("No signal detected."+ new Date());
      // Additional logic if needed
  }
  positionTakenInSymbol && send_notification(positionTakenInSymbol+ ': ltp: '+  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp )
  //send notification
  prevEma9LessThanEma21 = ema9 < ema21;
  crossedUp = ema9 > ema21;
}

async function crudecheckCrossOverExit(ema9, ema21) {
  if (prevEma9LessThanEma21 === '') {
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    send_notification('first prevEma9LessThanEma21 stored for reference as '+ prevEma9LessThanEma21);
  }
  else if (!positionTaken && prevEma9LessThanEma21 && ema9 > ema21) {
      send_notification("Cross over detected. Take call position." + new Date());
      await long(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmCallSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
      // Place your position-taking logic here
  } else if (!positionTaken && !prevEma9LessThanEma21 && ema9 < ema21) {
      send_notification("Cross over detected. Take put position." + new Date());
      await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmPutSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
  }
  else if (positionTaken) {
      if(crossedUp && ema9 < ema21){
        // exitLong addshort
        await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTakenInSymbol = biasProcess.atmPutSymbol;
        positionTaken = true;
        prevEma9LessThanEma21 = ema9 < ema21;
        crossedUp = ema9 > ema21;
      
      } else if (!crossedUp && ema9 > ema21){
        // exitShort addLong
        await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        await long(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTakenInSymbol = biasProcess.atmCallSymbol;
        positionTaken = true;
        prevEma9LessThanEma21 = ema9 < ema21;
        crossedUp = ema9 > ema21;
      }
  } else {
      console.log("No signal detected."+ new Date());
      // Additional logic if needed
  }
  positionTakenInSymbol && send_notification(positionTakenInSymbol+ ': ltp: '+  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp )
  //send notification
  prevEma9LessThanEma21 = ema9 < ema21;
  crossedUp = ema9 > ema21;
}
async function checkCrossOverExit(ema9, ema21) {
    if (callPreviousValue && !positionTaken && ema9 > ema21) {
        console.log("Cross over detected. Take call position." + new Date());
        await long(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTakenInSymbol = biasProcess.atmCallSymbol;
        positionTaken = true;
        // Place your position-taking logic here
    } else if (positionTaken && ema9 < ema21) {
        console.log("Exit signal detected. Close call position." + new Date());
        await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        positionTaken = false;
        positionTakenInSymbol = '';
        // Place your position-closing logic here
    } else {
        console.log("No call signal detected."+ new Date());
        // Additional logic if needed
    }
    positionTakenInSymbol && console.log(positionTakenInSymbol, ' : openCallPosition - LTP: ',  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp )
    //send notification
    callPreviousValue = ema9 < ema21;

}

async function sellercheckCrossOverExit(ema9, ema21) {
  if (callPreviousValue && !positionTaken && ema9 < ema21) {
    console.log("Cross over detected. Take call position." + new Date());
    await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTakenInSymbol = biasProcess.atmCallSymbol;
    positionTaken = true;
    // Place your position-taking logic here
  } else if (positionTaken && ema9 > ema21) {
    console.log("Exit signal detected. Close call position." + new Date());
    await long(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTaken = false;
    positionTakenInSymbol = '';
    // Place your position-closing logic here
  } else {
      console.log("No call signal detected."+ new Date());
      // Additional logic if needed
  }
  positionTakenInSymbol && console.log(positionTakenInSymbol, ' : openCallPosition - LTP: ',  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp )
  //send notification
  callPreviousValue = ema9 > ema21;

}

let putpositionTaken = false;
let putPreviousValue = false;
let putpositionTakenInSymbol = '';

async function putcheckCrossOverExit(ema9, ema21) {
    if (putPreviousValue && !putpositionTaken && ema9 > ema21) {
        console.log("Cross over detected. Take put position." + new Date());
        await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        putpositionTakenInSymbol = biasProcess.atmPutSymbol;
        putpositionTaken = true;
        // Place your position-taking logic here
    } else if (putpositionTaken && ema9 < ema21) {
        console.log("Exit signal detected. Close put position." + new Date());
        await short(putpositionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
        putpositionTaken = false;
        putpositionTakenInSymbol = ''
        // Place your position-closing logic here
    } else {
        console.log("No put signal detected."+ new Date());
        // Additional logic if needed
    }
    putpositionTakenInSymbol && console.log(putpositionTakenInSymbol, ' : openPutPosition - LTP: ',  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putpositionTakenInSymbol)}`]?.lp )
    //send notification
    putPreviousValue = ema9 < ema21;
}


async function sellerputcheckCrossOverExit(ema9, ema21) {
  if (putPreviousValue && !putpositionTaken && ema9 < ema21) {
    console.log("Cross over detected. Take put position." + new Date());
    await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    putpositionTakenInSymbol = biasProcess.atmPutSymbol;
    putpositionTaken = true;
    // Place your position-taking logic here
  } else if (positionTaken && ema9 > ema21) {
    console.log("Exit signal detected. Close put position." + new Date());
    await long(putpositionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    putpositionTaken = false;
    putpositionTakenInSymbol = '';
    // Place your position-closing logic here
  } else {
      console.log("No put signal detected."+ new Date());
      // Additional logic if needed
  }
  putpositionTakenInSymbol && console.log(putpositionTakenInSymbol, ' : openPutPosition - LTP: ',  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putpositionTakenInSymbol)}`]?.lp )
  //send notification
  putPreviousValue = ema9 > ema21;

}

// async function sellerputcheckCrossOverExit(ema9, ema21) {
//     if (putPreviousValue && !putpositionTaken && ema9 < ema21) {
//         console.log("Cross over detected. Take put position." + new Date());
//         await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
//         putpositionTakenInSymbol = biasProcess.atmPutSymbol;
//         putpositionTaken = true;
//         // Place your position-taking logic here
//     } else if (putpositionTaken && ema9 > ema21) {
//         console.log("Exit signal detected. Close put position." + new Date());
//         await short(putpositionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
//         putpositionTakenInSymbol = ''
//         putpositionTaken = false;
//         // Place your position-closing logic here
//     } else {
//         console.log("No put signal detected.");
//         // Additional logic if needed
//     }
//     putpositionTakenInSymbol && console.log(putpositionTakenInSymbol, ' : putpositionTakenInSymbol')
//     putPreviousValue = ema9 > ema21;
// }

// // Example usage
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// // Assuming a crossover has occurred, now check for exit signal
// putcheckCrossOverExit(130.0, 190.0);  // Example values for exit signal
// putcheckCrossOverExit(130.0, 190.0);  // Example values for exit signal
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);
// putcheckCrossOverExit(130.0, 190.0);  // Example values for exit signal
// putcheckCrossOverExit(130.0, 190.0);  // Example values for exit signal
// putcheckCrossOverExit(182.51111111111112, 177.22857142857143);

const ema9and21ValuesIndicators = async (params) => {
  try{
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = reply.map(item => parseFloat(item.intc));
    
    //last 50 items
    const first9Items = intcPrices.slice(0,80).reverse();
    const first21Items = first9Items;

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
    let ema9Values = await ta.ema(first9Items, 8);
    // Calculate 21-period EMA
    let ema21Values = await ta.ema(first21Items, 21);
    //send last item from the array
    return [ema9Values[ema9Values.length-1], ema21Values[ema21Values.length-1]];
  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }
}

const ema9and21Values = async (params) => {
  try{
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = reply.map(item => parseFloat(item.intc));
    
      // Get the last 9 items
    const first9Items = intcPrices.slice(0,9);

    // Get the last 21 items
    const first21Items = intcPrices.slice(0,21);

    // console.log(first9Items, ' : first9Items')
    // console.log(first21Items, ' : first21Items')

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

    const technicalindicators = require('technicalindicators');

    // Sample financial data (replace this with your data)
    // const closePrices9 = [42, 45, 48, 50, 55, 60, 65, 70, 75];
    // const closePrices = [10, 15, 12, 18, 20, 22, 25, 28, 30, 32, 35, 40, 42, 45, 48, 50, 55, 60, 65, 70, 75];

    // Calculate 9-period EMA
    const ema9Input = {
      values: first9Items,
      period: 9,
    };

    const ema9 = new technicalindicators.EMA(ema9Input);
    const ema9Values = ema9.getResult();

    // console.log('9-period EMA Values:', ema9Values);

    // Calculate 21-period EMA
    const ema21Input = {
      values: first21Items,
      period: 21,
    };

    const ema21 = new technicalindicators.EMA(ema21Input);
    const ema21Values = ema21.getResult();

    // console.log('21-period EMA Values:', ema21Values);

    return [ema9Values, ema21Values];

  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }

}// to mins from 11 to 11:10 on Jan 16
  
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
  
  // updateEMA when atmStrike changes
emaRecurringFunction = async () => {
    try{
  
      if (getAtmStrike()!= biasProcess.atmStrike){
        resetBiasProcess();
        await updateITMSymbolfromOC()
      }
      
      // FINNIFTY16JAN24C21450
      // 21450.00
      // FINNIFTY16JAN24P21450

      // console.log(biasProcess.atmStrike)
      // console.log(biasProcess.atmCallSymbol)
      // console.log(biasProcess.atmCallStrikePrice)
      // console.log(biasProcess.atmPutSymbol)
      // console.log(biasProcess.atmPutStrikePrice) 


      // Dynamically add a subscription after 10 seconds
      atmCallSubStr = biasProcess.atmCallSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.atmCallSymbol)}` : '';
      atmPutSubStr = biasProcess.atmPutSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.atmPutSymbol)}` : '';
      dynamicallyAddSubscription(atmCallSubStr);
      dynamicallyAddSubscription(atmPutSubStr);

      
      // console.log(`${biasProcess.atmCallSymbol}:`, latestQuotes[atmCallSubStr] ? latestQuotes[atmCallSubStr]?.lp : "N/A", "Order:", latestOrders[atmCallSubStr]);
      // console.log(`${biasProcess.atmPutSymbol}:`, latestQuotes[atmPutSubStr] ? latestQuotes[atmPutSubStr]?.lp : "N/A", "Order:", latestOrders[atmPutSubStr]);

      // console.log(latestQuotes[atmCallSubStr], 'atmCallSubStr');

      // {
      //   t: 'tf',
      //   e: 'NFO',
      //   tk: '45764',
      //   lp: '21.55',
      //   pc: '-70.09',
      //   ft: '1705394694'
      // } atmCallSubStr

      // {
      //   t: 'tk',
      //   e: 'NFO',
      //   tk: '45764',
      //   ts: 'FINNIFTY16JAN24C21450',
      //   pp: '2',
      //   ls: '40',
      //   ti: '0.05',
      //   lp: '0.05',
      //   pc: '-99.93',
      //   c: '72.05',
      //   ft: '1705402249',
      //   o: '70.00',
      //   h: '80.85',
      //   l: '0.05',
      //   ap: '18.51',
      //   v: '1245198800',
      //   oi: '11984440',
      //   poi: '1510120',
      //   bp1: '0.00',
      //   sp1: '0.05',
      //   bq1: '0',
      //   sq1: '3521840'
      // } atmCallSubStr

      // values["uid"]       = self.__username;
      //     values["exch"]      = params.exchange;
      //     values["token"]     = params.token;          
      //     values["st"]        = params.starttime;
      //     if(params.endtime !== undefined)
      //       values["et"]        = params.endtime;
      //     if(params.interval !== undefined)
      //       values["intrv"]     = params.interval;


      // params = {
      //   'exchange'   : 'NFO',
      //   'token' : getTokenByTradingSymbol(biasProcess.atmCallSymbol),
      //   'starttime'    : '1705383000',
      //   'endtime' : new Date().getTime() / 1000,
      //   'interval' : '1'
      //   }



      // Get current date and time in IST
      // const currentDateIST = new Date();

      // // Set the time to 2 o'clock
      // currentDateIST.setHours(2, 0, 0, 0);

      // // Subtract one day to get the previous day
      // currentDateIST.setDate(currentDateIST.getDate() - 1);

      // // Get epoch time in milliseconds
      // const epochTime = currentDateIST.getTime();

      let callSymbolForEma = positionTaken? positionTakenInSymbol:biasProcess.atmCallSymbol;
      // let putSymbolForEma = putpositionTaken? putpositionTakenInSymbol:biasProcess.atmPutSymbol;
      
      params = {
        'exchange'   : globalInput.pickedExchange,
        'token' : globalInput.token,
        'starttime'    : '1705383000',
        'interval' : '3'
        }

      // params2 = {
      //   'exchange'   : globalInput.pickedExchange,
      //   'token' : getTokenByTradingSymbol(putSymbolForEma),
      //   'starttime'    : '1705383000',
      //   'interval' : '1'
      //   }

      try {
        // const [callema9, callema21] = await ema9and21Values(params);
        // console.log(callema9, callema21, ' : callema9, callema21')

        const [callema9, callema21] = await ema9and21ValuesIndicators(params); //call
        // const [putema9, putema21] = await ema9and21Values(params2); //put

        send_notification('crudeoil: ltp '+ +latestQuotes[`${globalInput.pickedExchange}|${globalInput.token}`]?.lp + ', ema9 '+ parseFloat(callema9).toFixed(2) + ', ema21 ' + parseFloat(callema21).toFixed(2))
        // console.log(putSymbolForEma,  ': ltp: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putSymbolForEma)}`]?.lp , ' : putema9, putema21. input for position', putema9, putema21)
        
        //send notification

        // //buyer
        await sellercrudecheckCrossOverExit(callema9, callema21)
        // await crudecheckCrossOverExit(callema9, callema21)
        // await crudecheckCrossOverExit(putema9, putema21)

        // //seller
        // sellercheckCrossOverExit(callema9, callema21)
        // sellerputcheckCrossOverExit(putema9, putema21)
        
      } catch (error) {
        console.error('Error:', error);
      }
      

      
      // Check a condition to determine whether to stop the recurring function
      if (websocket_closed) {
        clearInterval(intervalId);
        // console.log(latestOrders, 'latestOrders')
        // console.log('Recurring function stopped.');
      }
    } catch (error) {
      // handle the exception locally
      console.error("Child method encountered an exception:", error.message);
      // optionally, rethrow the exception if needed
      throw error;
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

// main run by calling recurring function and subscribe to new ITMs for BiasCalculation
getEma = async () => {
  var currentDate = new Date();
  var seconds = currentDate.getSeconds();

  //exit in the night and stop process.
  if (isTimeEqualsNotAfterProps(15,30,false) && isTimeEqualsNotAfterProps(23,47,false))
  {
    await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    process.exit(0)
  }


  // check when second is 2 on the clock for every minute
  if (seconds === 2) {
    try {
      await emaRecurringFunction();
    } catch (error) {
        console.error("Error occured: " + error);
        // send_notification("Error occured: " + error)
        // getBias();
    }
  }
}

const setNearestCrudeFutureToken = async () => {

  let query = `CRUDEOIL`;
  let futureObj = await api.searchscrip(exchange='MCX', searchtext=query)
  let futureToken = futureObj.values[3].token; //258003 //3 as it skips crudeoil, crudeoilm and its future
  globalInput.token = futureToken;

  // console.log(globalInput.token, 'token')
  
}
runEma = async () => {
  try{
    await executeLogin();
    await setNearestCrudeFutureToken();
    await send_callback_notification();
    await startWebsocket();
    await updateITMSymbolfromOC();
    intervalId = setInterval(getEma, 1000);
  }catch (error) {
    console.log( error)
  }
  }

runEma();