// Initialization / nearest expiry / getAtmStrike
// jupyter nbconvert --to script gpt.ipynb
const futureOffset = 0;
// Add these at the top (or near your config section)
const maxLossThreshold = -2;
const maxProfitThreshold = 1.5;
const trailingLossPerLot = 3000;
const eveningExitMinutesIST = (18 * 60) + 30;
const eveningReentryMinutesIST = (21 * 60) + 30;
const trailingMonitorIntervalSeconds = 5;

const debug = false;
let inputProp = true; // true for XEma logic
let limits;
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
  identify_option_type, fetchSpotPrice, getStrike, calcPnL } = require('./utils/customLibrary');
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(telegramBotToken, { polling: true });
const send_notification = async (message, me = false) => (message && console.log(message)) || (!debug && message && await bot.sendMessage((me && !telegramSignals.stopSignal) ? chat_id_me : chat_id, (me && !telegramSignals.stopSignal) ? message : message.replace(/\) /g, ")\n")).catch(console.error));


let notificationBuffer = [];
let lastNotificationSent = Date.now();

function buffer_notification(message, me = false) {
  if (message) notificationBuffer.push({ message, me });
}

async function flush_notifications() {
  if (notificationBuffer.length === 0) return;
  const combinedMessage = notificationBuffer.map(n => n.message).join('\n\n');
  await send_notification(combinedMessage, notificationBuffer.some(n => n.me));
  notificationBuffer = [];
  lastNotificationSent = Date.now();
}

// Send notifications every 3 minutes
setInterval(() => {
  if (Date.now() - lastNotificationSent >= 180000) {
    flush_notifications();
  }
}, 10000);


let globalBigInput = {
  filteredIndexCSV: undefined
}
// getPickedIndexHere = () => debug ? 'NIFTY' : ['NIFTY', 'BANKEX', 'FINNIFTY', 'BANKNIFTY', 'NIFTY', 'SENSEX', 'BANKEX'][new Date().getDay()] || 'NIFTY';
getPickedIndexHere = () => debug ? 'NATURALGAS' : ['NATURALGAS', 'NATURALGAS', 'NATURALGAS', 'NATURALGAS', 'NATURALGAS', 'NATURALGAS', 'NATURALGAS'][new Date().getDay()] || 'NATURALGAS';
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
  // When true, all B (buy) become S (sell) and S become B
  invertBuySell: false,
};
globalInput.token = idxNameTokenMap.get(globalInput.indexName);
globalInput.ocGap = idxNameOcGap.get(globalInput.indexName);

// Helper to swap buy/sell when `globalInput.invertBuySell` is true
const swapSide = (side) => (globalInput.invertBuySell ? (side === 'B' ? 'S' : side === 'S' ? 'B' : side) : side);
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
let websocket_closed = false;
let websocketReady = false;
let intervalId;

let latestQuotes = {};
let latestOrders = {};
const restQuoteSubscriptions = new Set();
const REST_QUOTE_POLL_MS = Number(process.env.SHOONYA_REST_QUOTE_POLL_MS || 3000);
let restQuotePoller;
let restQuotePollInProgress = false;

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
    https.get(url, function (response) {
      response.pipe(file);
      file.on('finish', function () {
        file.close(() => {
          resolve();
        });
      });
    }).on('error', function (err) {
      fs.unlink(destination, () => { }); // Delete the file if an error occurs during download
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
  const exchangeType = globalInput.indexName.includes('NATURALGAS') ? 'MCX' : 'MCX';
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

    await downloadFile(zipFileUrl, downloadedFileName);
    unzipFile(downloadedFileName);
    // Read CSV data into a JavaScript object
    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    const { data: symbolDf } = parse(csvData, { header: true });



    globalBigInput.filteredIndexCSV = filterAndMapDates(moment, symbolDf.filter((row) => ['OPTFUT', 'FUTCOM'].includes(row.Instrument) && row.Symbol === globalInput.indexName));
    // MCX,425852,100,1,NATURALGAS,NATURALGAS14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
    // MCX,260602,100,1,NATURALGAS,NATURALGAS16FEB24,16-FEB-2024,FUTCOM,XX,0,1,

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
    // MCX,425852,100,1,NATURALGAS,NATURALGAS14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
    const expiryFutList = globalBigInput.filteredIndexCSV
      .filter((row) => row.Instrument === 'FUTCOM')
      .map((row) => ({ Exchange: row.Exchange, LotSize: row.LotSize, TradingSymbol: row.TradingSymbol, Expiry: row.Expiry }));
    // MCX,260602,100,1,NATURALGAS,NATURALGAS16FEB24,16-FEB-2024,FUTCOM,XX,0,1,
    expiryList.sort();
    expiryFutList.sort((a, b) => moment(a.Expiry).diff(moment(b.Expiry)));
    tempListOfOptions = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => (row.Instrument === 'OPTFUT' && row.Expiry === expiryList[0])).map((row) => row.TradingSymbol))];
    globalInput.inputOptTsym = tempListOfOptions[tempListOfOptions.length - 1];

    // MCX,425852,100,1,NATURALGAS,NATURALGAS14FEB24C6250,14-FEB-2024,OPTFUT,CE,6250,0.1,
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
const expiryLoadedPromise = runFindNearestExpiry();

const Api = require("./lib/RestApi");
let api = new Api({});

const getAtmStrike = async () => {
  await delay(3000);
  // console.log(`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}`)
  // console.log(globalInput.token)
  // console.log(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]);

  // console.log('latestQuotes', latestQuotes)

  biasProcess.spotObject = latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE' : globalInput.pickedExchange === 'NFO' ? 'NSE' : 'MCX'}|${globalInput.token}`];
  // console.log('biasProcess.spotObject', biasProcess.spotObject)
  // process.exit(0)
  // debug && console.log(biasProcess.spotObject) //updateAtmStrike(s) --> 50, spot object -> s?.lp = 20100
  let spotLp = Number(biasProcess.spotObject?.lp);
  if (!Number.isFinite(spotLp)) {
    console.log('Spot websocket quote unavailable, fetching spot using REST.');
    const spot = await fetchSpotPrice(api, globalInput.token, globalInput.pickedExchange);
    spotLp = Number(spot?.lp);
  }
  if (!Number.isFinite(spotLp) || !Number(globalInput.ocGap)) {
    throw new Error(`Unable to calculate ATM strike. spot=${spotLp}, ocGap=${globalInput.ocGap}`);
  }
  return Math.round((spotLp + futureOffset) / globalInput.ocGap) * globalInput.ocGap
}

// telegram callbackQuery
async function send_callback_notification() {
  try {
    const keyboard = {
      inline_keyboard: [[
        { text: '🐌', callback_data: 'slower' },
        { text: '🚀', callback_data: 'faster' },
        { text: '💹', callback_data: 'toggleExchange' },
        { text: '⏸', callback_data: 'stop' },
        { text: '🛑', callback_data: 'exit' }
      ]]
    };
    !debug && bot.sendMessage(chat_id_me, 'Choose server settings', { reply_markup: keyboard });
  } catch (error) { console.error(error); buffer_notification(error + ' error occured', true) }
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
  if (globalInput.launchChildProcessApp) {
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
  positionProcess.smallestCallPosition = undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
    positionProcess.posCallSubStr = undefined,
    positionProcess.callsNearbyNeighbours = undefined,
    positionProcess.collectedValuesCall = new Map()
};
const resetPuts = () => {
  positionProcess.smallestPutPosition = undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
    positionProcess.posPutSubStr = undefined,
    positionProcess.putsNearbyNeighbours = undefined,
    positionProcess.collectedValuesPut = new Map()
};

const apiResponseSummary = (response) => {
  if (!response || typeof response !== 'object') {
    return response;
  }

  const summary = {};
  ['stat', 'emsg', 'message', 'status', 'request_time', 'norenordno', 'result', 't', 's'].forEach((key) => {
    if (response[key] !== undefined) {
      summary[key] = response[key];
    }
  });
  if (response.data && typeof response.data === 'object') {
    summary.data = apiResponseSummary(response.data);
  }
  return Object.keys(summary).length ? summary : response;
};

const toFiniteNumber = (value) => {
  const rawValue = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const extractIntcPrices = (reply, params, minCandles = 1) => {
  const series = Array.isArray(reply) ? reply : Array.isArray(reply?.values) ? reply.values : null;
  const context = `${params?.exchange || 'unknown'}|${params?.token || 'unknown'}`;

  if (!series) {
    console.error(`TPSeries unavailable for ${context}:`, JSON.stringify(apiResponseSummary(reply)));
    return null;
  }

  const intcPrices = series.map(item => Number(item?.intc)).filter(Number.isFinite);
  if (intcPrices.length < minCandles) {
    console.error(`TPSeries returned ${intcPrices.length} usable candles for ${context}, need ${minCandles}.`);
    return null;
  }

  return intcPrices;
};

const getCurrentISTMinutes = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hours = Number(parts.find(part => part.type === 'hour')?.value);
  const minutes = Number(parts.find(part => part.type === 'minute')?.value);
  return (hours * 60) + minutes;
};

const isEveningNoEntryWindow = () => {
  const minutes = getCurrentISTMinutes();
  return minutes >= eveningExitMinutesIST && minutes < eveningReentryMinutesIST;
};

const isNoPositionsResponse = (response) => response && response.stat === 'Not_Ok' &&
  /no data|no position|no record/i.test(response.emsg || response.message || '');
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


updatePositions = async () => {
  try {
    const data = await api.get_positions();
    debug && console.log(data, ' : positions data');

    if (isWeekend()) {
      positionProcess.smallestCallPosition = biasProcess.itmCallSymbol;
      positionProcess.smallestPutPosition = biasProcess.itmPutSymbol;
    }
    // Check if data is an array
    else if (Array.isArray(data)) {
      // Separate calls and puts for NFO - these are sold options with smallest LTP
      const calls = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'C');
      const puts = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'P');
      positionProcess.smallestCallPosition = calls.length > 0 ? calls.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), calls[0]) : resetCalls();
      positionProcess.smallestPutPosition = puts.length > 0 ? puts.reduce((min, option) => (parseFloat(option?.lp) < parseFloat(min?.lp) ? option : min), puts[0]) : resetPuts();
      debug && console.log(positionProcess, ' : positionProcess');
    } else if (isNoPositionsResponse(data)) {
      resetCalls();
      resetPuts();
      console.log('No open positions returned by API:', JSON.stringify(apiResponseSummary(data)));
    } else {
      console.error('positions data is not an array:', JSON.stringify(apiResponseSummary(data)));
    }

    return data;
  } catch (error) {
    console.error('get_positions failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    return null;
  }
}

const trailingStopState = new Map();
const exitOrdersInProgress = new Set();
let eveningExitInProgress = false;

const positionKey = (position) => `${position?.exch || ''}|${position?.tsym || ''}|${position?.prd || 'M'}`;

const isOpenStrategyPosition = (position) => position?.exch === 'MCX' &&
  position?.tsym?.includes(globalInput.indexName) &&
  Number(position?.netqty) !== 0;

const getPositionLtp = (position) => {
  const positionLtp = toFiniteNumber(position?.lp);
  if (positionLtp !== null) {
    return positionLtp;
  }

  const quoteKey = position?.token ? `${position.exch}|${position.token}` : '';
  const quote = latestQuotes[quoteKey];
  if (quote?.tsym && quote.tsym !== position?.tsym) {
    console.error(`Ignoring mismatched quote for ${positionKey(position)}: ${quote.tsym}`);
    return null;
  }
  return toFiniteNumber(quote?.lp);
};

const getPositionEntryPrice = (position) => {
  const netQty = Number(position?.netqty);
  if (netQty < 0) {
    return toFiniteNumber(position?.netavgprc ?? position?.daysellavgprc);
  }
  return toFiniteNumber(position?.netavgprc ?? position?.daybuyavgprc);
};

const getOpenStrategyPositions = async () => {
  const positions = await api.get_positions();
  if (Array.isArray(positions)) {
    return positions.filter(isOpenStrategyPosition);
  }
  if (!isNoPositionsResponse(positions)) {
    console.error('Unable to read positions:', JSON.stringify(apiResponseSummary(positions)));
  }
  return [];
};

const clearClosedTrailingStops = (openPositions) => {
  const openKeys = new Set(openPositions.map(positionKey));
  [...trailingStopState.keys()].forEach((key) => {
    if (!openKeys.has(key)) {
      trailingStopState.delete(key);
      exitOrdersInProgress.delete(key);
    }
  });
};

const resetLocalPositionState = (symbol) => {
  if (!symbol || positionTakenInSymbol === symbol) {
    positionTaken = false;
    positionTakenInSymbol = '';
    positionDirection = '';
  }
};

const syncPositionStateFromLive = async () => {
  const positions = await getOpenStrategyPositions();
  clearClosedTrailingStops(positions);
  if (positions.length === 0) {
    resetLocalPositionState();
    return [];
  }

  const primaryPosition = positions[0];
  positionTaken = true;
  positionTakenInSymbol = primaryPosition.tsym;
  positionDirection = identify_option_type(primaryPosition.tsym) === 'P' ? 'long' : 'short';
  return positions;
};

const isPositionStillOpen = async (position) => {
  const key = positionKey(position);
  const positions = await getOpenStrategyPositions();
  clearClosedTrailingStops(positions);
  return positions.some(openPosition => positionKey(openPosition) === key);
};

const getOrderStatus = async (orderno) => {
  if (!orderno) {
    return null;
  }
  const orderBook = await api.get_orderbook();
  if (!Array.isArray(orderBook)) {
    return null;
  }
  return orderBook.find(order => order.norenordno === orderno) || null;
};

const waitForExitConfirmation = async (position, orderno) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await delay(2000);
    const orderStatus = await getOrderStatus(orderno);
    if (orderStatus?.status === 'REJECTED') {
      console.error(`Exit order rejected for ${positionKey(position)}: ${orderStatus.rejreason || ''}`);
      return false;
    }
    if (!(await isPositionStillOpen(position))) {
      return true;
    }
  }
  console.error(`Exit order not confirmed for ${positionKey(position)} after waiting.`);
  return false;
};

const placeExitOrderForPosition = async (position, reason) => {
  const key = positionKey(position);
  if (exitOrdersInProgress.has(key)) {
    return false;
  }

  const netQty = Number(position?.netqty);
  const absQty = Math.abs(netQty);
  const ltp = getPositionLtp(position);
  if (!Number.isFinite(netQty) || absQty === 0 || ltp === null) {
    console.error(`Cannot exit ${key}: invalid qty/ltp.`, JSON.stringify(apiResponseSummary(position)));
    return false;
  }

  const buyOrSell = netQty < 0 ? 'B' : 'S';
  const exitPrice = buyOrSell === 'B' ? ltp + 1 : Math.max(0, ltp - 0.3);
  const remarks = reason.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 30) || 'NatEmaExit';
  const order = {
    buy_or_sell: buyOrSell,
    product_type: position.prd || 'M',
    exchange: position.exch,
    tradingsymbol: position.tsym,
    quantity: absQty.toString(),
    discloseqty: '0',
    price_type: 'LMT',
    price: exitPrice.toFixed(2),
    remarks,
  };

  exitOrdersInProgress.add(key);
  try {
    const response = await api.place_order(order);
    console.log(response, `:${reason} exit order`, position.tsym, absQty, buyOrSell, exitPrice.toFixed(2));
    buffer_notification(`${reason}: exiting ${position.tsym} ${buyOrSell} ${absQty} @ ${exitPrice.toFixed(2)}`, true);
    if (response?.stat !== 'Ok') {
      exitOrdersInProgress.delete(key);
      console.error(`Exit order failed for ${key}:`, JSON.stringify(apiResponseSummary(response)));
      return false;
    }

    const confirmed = await waitForExitConfirmation(position, response.norenordno);
    if (confirmed) {
      resetLocalPositionState(position.tsym);
      trailingStopState.delete(key);
      exitOrdersInProgress.delete(key);
      return true;
    }

    exitOrdersInProgress.delete(key);
    await syncPositionStateFromLive();
    return false;
  } catch (error) {
    exitOrdersInProgress.delete(key);
    console.error(`Exit order exception for ${key}:`, error.message || JSON.stringify(apiResponseSummary(error)));
    await syncPositionStateFromLive();
    return false;
  }
};

const exitOpenStrategyPositions = async (reason) => {
  const positions = await getOpenStrategyPositions();
  clearClosedTrailingStops(positions);
  if (positions.length === 0) {
    return false;
  }

  let exitedAny = false;
  for (const position of positions) {
    exitedAny = await placeExitOrderForPosition(position, reason) || exitedAny;
  }
  return exitedAny;
};

let trailingMonitorInProgress = false;
const monitorTrailingLoss = async () => {
  if (trailingMonitorInProgress) {
    return false;
  }

  trailingMonitorInProgress = true;
  try {
    const positions = await getOpenStrategyPositions();
    clearClosedTrailingStops(positions);
    let exited = false;

    for (const position of positions) {
      const key = positionKey(position);
      if (exitOrdersInProgress.has(key)) {
        continue;
      }

      const netQty = Number(position.netqty);
      const absQty = Math.abs(netQty);
      const lotSize = Number(globalInput.LotSize) || 1250;
      const entryPrice = getPositionEntryPrice(position);
      const ltp = getPositionLtp(position);
      if (!Number.isFinite(netQty) || !Number.isFinite(absQty) || entryPrice === null || ltp === null) {
        console.error(`Skipping trailing loss check for ${key}: invalid position data.`);
        continue;
      }

      const side = netQty < 0 ? 'short' : 'long';
      const stopDistance = trailingLossPerLot / lotSize;
      const existing = trailingStopState.get(key);
      const state = existing && existing.side === side && existing.entryPrice === entryPrice
        ? existing
        : { side, entryPrice, bestLtp: entryPrice };

      if (side === 'short') {
        state.bestLtp = Math.min(state.bestLtp, ltp);
        state.stopLtp = Math.min(entryPrice + stopDistance, state.bestLtp + stopDistance);
        state.openPnl = (entryPrice - ltp) * absQty;
        if (ltp >= state.stopLtp) {
          const lots = absQty / lotSize;
          const maxLoss = trailingLossPerLot * lots;
          exited = await placeExitOrderForPosition(
            position,
            `Trailing loss hit max Rs ${maxLoss.toFixed(0)}`
          ) || exited;
          continue;
        }
      } else {
        state.bestLtp = Math.max(state.bestLtp, ltp);
        state.stopLtp = Math.max(entryPrice - stopDistance, state.bestLtp - stopDistance);
        state.openPnl = (ltp - entryPrice) * absQty;
        if (ltp <= state.stopLtp) {
          const lots = absQty / lotSize;
          const maxLoss = trailingLossPerLot * lots;
          exited = await placeExitOrderForPosition(
            position,
            `Trailing loss hit max Rs ${maxLoss.toFixed(0)}`
          ) || exited;
          continue;
        }
      }

      trailingStopState.set(key, state);
    }

    return exited;
  } finally {
    trailingMonitorInProgress = false;
  }
};

let isQueueBusy = false;
const queue = [];

updateTwoSmallestPositionsAndNeighboursSubs = async () => {
  // If the queue is busy, add the function call to the queue
  if (isQueueBusy) {
    debug && console.log('updateTwoSmallestPositionsAndNeighboursSubs is already in progress.');
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  }

  isQueueBusy = true;

  try {
    await delay(2000);
    const positions = await updatePositions();
    updatePositionsNeighboursAndSubs();
    return positions;
  } finally {
    isQueueBusy = false;
    // Process the next function call in the queue if any
    if (queue.length > 0) {
      const nextItem = queue.shift(); // Remove the item from the queue
      // console.log('Processing next item in the updateTwoSmallestPositionsAndNeighboursSubs queue.');
      updateTwoSmallestPositionsAndNeighboursSubs()
        .then(nextItem.resolve)
        .catch(nextItem.reject);
    }
  }
}
// updateTwoSmallestPositionsAndNeighboursSubs();

let prevSellPrice = 0;
postOrderPosTracking = (data) => {
  updateTwoSmallestPositionsAndNeighboursSubs();
  // Update call position subscription
  positionProcess.posCallSubStr = positionProcess.smallestCallPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionProcess.smallestCallPosition.tsym)}` : '';
  //todo verify this before &&
  positionProcess.posCallSubStr && dynamicallyAddSubscription(positionProcess.posCallSubStr);
  // Update put position subscription
  positionProcess.posPutSubStr = positionProcess.smallestPutPosition?.tsym ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionProcess.smallestPutPosition.tsym)}` : '';
  //todo verify this before &&
  positionProcess.posPutSubStr && dynamicallyAddSubscription(positionProcess.posPutSubStr);
  if (data?.trantype === 'S') {
    prevSellPrice = data?.flprc; // Update the previous sell price
    // console.log('prevSellPrice updated to:', prevSellPrice);
    //console last 6 digits of tsym 
    // console.log('data.tsym', data.tsym.substring(data.tsym.length - 6));
  } else {
    buffer_notification(data?.tsym.substring(data.tsym.length - 4) + ' S at ' + prevSellPrice + ' B @' + data?.flprc + ' ' + new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }), true)
    buffer_notification(data?.tsym.substring(data.tsym.length - 4) + ' S at ' + prevSellPrice + ' B @' + data?.flprc + ' ' + new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }))
  }
}

// websocket with update smallest 2 positions on every new order
function receiveQuote(data) {
  // console.log("Quote ::", data);
  // Update the latest quote value for the corresponding instrument
  if (data?.lp) {
    latestQuotes[data.e + '|' + data.tk] = data
    // console.log(latestQuotes[data.e + '|' + data.tk])
  }
  //  else {
  //     latestQuotes[data.e + '|' + data.tk] = data;
  // }
}

function normalizeInstrument(instrument) {
  if (!instrument || typeof instrument !== 'string' || !instrument.includes('|')) {
    return null;
  }

  const [exchange, token] = instrument.split('|');
  if (!exchange || !token || token === 'null' || token === 'undefined') {
    return null;
  }

  return { exchange, token, key: `${exchange}|${token}` };
}

function trackRestQuote(instrument) {
  const normalized = normalizeInstrument(instrument);
  if (!normalized) {
    return;
  }
  restQuoteSubscriptions.add(normalized.key);
}

function hasQuote(instrument) {
  return Boolean(instrument && Number.isFinite(Number(latestQuotes[instrument]?.lp)));
}

function requiredQuotesReady() {
  const missing = [];
  const spotInstrument = `${globalInput.pickedExchange}|${globalInput.token}`;
  const atmCallToken = biasProcess.atmCallSymbol ? getTokenByTradingSymbol(biasProcess.atmCallSymbol) : '';
  const atmPutToken = biasProcess.atmPutSymbol ? getTokenByTradingSymbol(biasProcess.atmPutSymbol) : '';
  const atmCallInstrument = atmCallToken ? `${globalInput.pickedExchange}|${atmCallToken}` : '';
  const atmPutInstrument = atmPutToken ? `${globalInput.pickedExchange}|${atmPutToken}` : '';

  [spotInstrument, atmCallInstrument, atmPutInstrument].filter(Boolean).forEach((instrument) => {
    if (!hasQuote(instrument)) {
      missing.push(instrument);
    }
  });

  return { ready: missing.length === 0, missing };
}

async function refreshRestQuotes() {
  if (restQuotePollInProgress || restQuoteSubscriptions.size === 0) {
    return;
  }

  restQuotePollInProgress = true;
  try {
    const instruments = [...restQuoteSubscriptions];
    await Promise.all(instruments.map(async (instrument) => {
      const normalized = normalizeInstrument(instrument);
      if (!normalized) {
        return;
      }

      try {
        const quote = await api.get_quotes(normalized.exchange, normalized.token);
        if (quote?.stat === 'Not_Ok') {
          console.error(`REST quote failed for ${normalized.key}:`, JSON.stringify(apiResponseSummary(quote)));
          return;
        }

        const lp = quote?.lp ?? quote?.c;
        if (lp === undefined) {
          return;
        }

        latestQuotes[normalized.key] = {
          ...quote,
          e: quote.e || quote.exch || normalized.exchange,
          tk: quote.tk || quote.token || normalized.token,
          lp,
        };
      } catch (error) {
        console.error(`REST quote failed for ${normalized.key}:`, error.message || JSON.stringify(apiResponseSummary(error)));
      }
    }));
  } finally {
    restQuotePollInProgress = false;
  }
}

function startRestQuotePolling() {
  if (restQuotePoller) {
    return;
  }
  restQuotePoller = setInterval(refreshRestQuotes, REST_QUOTE_POLL_MS);
}

const exitAll = async () => {
  await exitOpenStrategyPositions('Exit all strategy positions');
  process.exit(0)
}

function receiveOrders(data) {
  // console.log("Order ::", data);
  // Update the latest order value for the corresponding instrument
  if (data.status === 'REJECTED') {
    buffer_notification('######### ORDER REJECTED PLS CHECK #########', true);
    exitAll();
    // exitSellsAndOrStop(true);
  }
  if (data.status === 'COMPLETE') {
    latestOrders[data.Instrument] = data;
    // update the smallest positions after each order
    postOrderPosTracking(data)
  }
}

function open(data) {
  // console.log(`NSE|${globalInput.token}`)
  console.log('ws open ack:', JSON.stringify(apiResponseSummary(data)));
  if (data?.s && data.s !== 'OK') {
    websocketReady = false;
    websocket_closed = true;
    buffer_notification(`Shoonya websocket auth failed: ${JSON.stringify(apiResponseSummary(data))}`, true);
    return;
  }
  websocketReady = true;
  websocket_closed = false;

  const initialInstruments = [`${globalInput.indexName.includes('NATURALGAS') ? 'MCX' : 'MCX'}|${globalInput.token}`, 'NSE|26017'];

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
    trackRestQuote(instrument);
    if (websocketReady) {
      api.subscribe(instrument);
    }
  });
}

function dynamicallyAddSubscription(newInstrument) {
  if (!newInstrument) {
    return;
  }

  trackRestQuote(newInstrument);
  if (!latestQuotes[newInstrument]) {
    console.log(websocketReady ? "Subscribing to new :: " : "Tracking quote via REST :: ", newInstrument);
    if (websocketReady) {
      api.subscribe(newInstrument);
    }
  }
}

params = {
  'socket_open': open,
  'quote': receiveQuote,
  'order': receiveOrders
};
async function startWebsocket() {
  await delay(1000);
  websocketReady = false;
  try {
    websocket = api.start_websocket(params);
  } catch (error) {
    console.log('Websocket start failed, REST polling will be used:', error.message || JSON.stringify(apiResponseSummary(error)));
    return false;
  }
  await delay(5000);
  if (!websocketReady) {
    console.log('Shoonya websocket did not authenticate; REST polling will be used.');
    return false;
  }
  return true;
}

async function getOptionChain() {
  try {
    biasProcess.atmStrike = await getAtmStrike();
    await delay(2000)
    if (!Number.isFinite(Number(biasProcess.atmStrike))) {
      throw new Error(`Invalid ATM strike for option chain: ${biasProcess.atmStrike}`);
    }
    const optionChainResponse = await api.get_option_chain(globalInput.pickedExchange, globalInput.inputOptTsym, biasProcess.atmStrike, 25);
    // console.log(optionChainResponse, 'optionChainResponse')
    if (optionChainResponse.stat === 'Ok' && Array.isArray(optionChainResponse.values)) {
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
  // Sort options by numeric strike so ATM selection is based on price, not symbol text.
  biasProcess.ocCallOptions.sort((a, b) => Number(a.strprc) - Number(b.strprc));
  biasProcess.ocPutOptions.sort((a, b) => Number(a.strprc) - Number(b.strprc));
  // Assign ITM symbols and strike prices
  // console.log(biasProcess.ocCallOptions, 'callOptions')
  // console.log(biasProcess.ocPutOptions, 'putOptions')

  if (biasProcess.ocCallOptions.length === 0 || biasProcess.ocPutOptions.length === 0) {
    throw new Error(`Option chain has insufficient CE/PE entries. CE=${biasProcess.ocCallOptions.length}, PE=${biasProcess.ocPutOptions.length}, atm=${biasProcess.atmStrike}, input=${globalInput.inputOptTsym}`);
  }

  const atmStrike = Number(biasProcess.atmStrike);
  const callAtmIndex = biasProcess.ocCallOptions.reduce((bestIndex, option, index, options) =>
    Math.abs(Number(option.strprc) - atmStrike) < Math.abs(Number(options[bestIndex].strprc) - atmStrike) ? index : bestIndex, 0);
  const putAtmIndex = biasProcess.ocPutOptions.reduce((bestIndex, option, index, options) =>
    Math.abs(Number(option.strprc) - atmStrike) < Math.abs(Number(options[bestIndex].strprc) - atmStrike) ? index : bestIndex, 0);

  const itmCall = biasProcess.ocCallOptions[Math.max(0, callAtmIndex - 1)];
  const itmPut = biasProcess.ocPutOptions[Math.min(biasProcess.ocPutOptions.length - 1, putAtmIndex + 1)];
  const atmCall = biasProcess.ocCallOptions[callAtmIndex];
  const atmPut = biasProcess.ocPutOptions[putAtmIndex];

  biasProcess.itmCallSymbol = itmCall.tsym;
  biasProcess.itmCallStrikePrice = itmCall.strprc;
  biasProcess.itmPutSymbol = itmPut.tsym;
  biasProcess.itmPutStrikePrice = itmPut.strprc;

  biasProcess.atmCallSymbol = atmCall.tsym;
  biasProcess.atmCallStrikePrice = atmCall.strprc;
  biasProcess.atmPutSymbol = atmPut.tsym;
  biasProcess.atmPutStrikePrice = atmPut.strprc;
  console.log(`ATM selected for ${biasProcess.atmStrike}: ${biasProcess.atmCallSymbol}, ${biasProcess.atmPutSymbol}`);

  // console.log(biasProcess, 'bp')

  return;
}

async function updateITMSymbolfromOC() {
  await delay(5000)
  // Get the Nifty option chain
  biasProcess.optionChain = await getOptionChain();
  // console.log(biasProcess.optionChain, ' :optionChain')
  await delay(1000)
  if (biasProcess.optionChain) {
    // Find the ITM symbol
    await delay(1000)
    updateITMSymbolAndStrike();
    await delay(1000)
    debug && console.log(biasProcess, ' :biasProcess')
  } else {
    throw new Error('Option chain unavailable for NAT EMA startup.');
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

  let newPositionSymbol = (posObj, status) => {
    return status == 'aggressive' ? getCallTokenSymbol(posObj, 'closer') : getCallTokenSymbol(posObj, 'farther')
  }

  const getCallTokenSymbol = (item, distance, level = 1) => {
    if (globalInput.pickedExchange === globalInput.pickedExchange) {//BANKNIFTY22NOV23C43800, FINNIFTY28NOV23C19300, NIFTY23NOV23C19750


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


      return distance === 'closer' ? newString2 : newString;

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
    buy_or_sell: swapSide('B'),
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
    buy_or_sell: swapSide('B'),
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
    buy_or_sell: swapSide('S'),
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
    buy_or_sell: swapSide('S'),
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
    buy_or_sell: swapSide('S'),
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
    buy_or_sell: swapSide('S'),
    product_type: 'I',
    exchange: globalInput.pickedExchange,
    tradingsymbol: orderSubmissivePutPosition,
    quantity: Math.abs(+positionProcess.smallestPutPosition?.netqty + +positionProcess.smallestPutPosition?.ls).toString(),
    discloseqty: 0,
    price_type: 'MKT',
    price: 0,
    remarks: 'WSNewOrderSubmissivePEEntryAPI'
  }

  if (goingUp && !telegramSignals.stopSignal && !debug) {
    await api.place_order(orderCE);
    biasProcess.vix > 0 ? await api.place_order(orderSubmissiveCE) : await api.place_order(orderAggressiveCE);
  } else if (!goingUp && !telegramSignals.stopSignal && !debug) {
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
  // buffer_notification(resStr);
  resStr = '';

  if (parseFloat(pValue2Var) < parseFloat(cValue1Var) || parseFloat(cValue2Var) < parseFloat(pValue1Var)) {
    let up = parseFloat(pValue2Var) < parseFloat(cValue1Var)
    let trendingUp = parseFloat(pValue1Var) > parseFloat(cExtra3Var)
    let trendingDown = parseFloat(cValue1Var) > parseFloat(pExtra3Var)
    //      vix high or early morning then move away
    //      vix low or not early morning then move closer
    if ((up && biasOutput.bias > 0) || (!up && biasOutput.bias < 0) || trendingUp || trendingDown) {
      // buffer_notification(`Going ${up ? 'UP':'DOWN️'}, VIX ${biasProcess.vix}%, Bias ${biasOutput.bias}, 
      //     \nCE: ${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}\nPE: ${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}
      //     \n3:05pm-2distance, 2:40-3, 1:40-4, 12:40-5, 11:40-6, 10:40-7, 9:40-8, 9:18-9`, true);
      await takeAction(up)
    }
  }
}

// updateBias and updateITMSymbolfromOC when atmStrike changes
myRecurringFunction = async () => {
  try {
    tempAtmStrike = await getAtmStrike();
    (tempAtmStrike != biasProcess.atmStrike) && resetBiasProcess() && await updateITMSymbolfromOC() && await dynSubs();
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
    if (websocket_closed && !restQuotePoller) {
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
//         buffer_notification(error, true)
//         getBias();
//     }
// };
// getBias();

const long = async (symbol, qty) => {
  let orderCE = {
    buy_or_sell: swapSide('B'),
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: symbol || 'NATURALGAS14DEC23P6700',
    quantity: (1250 * globalInput.emaLotMultiplier).toString(), // multiplier
    discloseqty: (1250 * globalInput.emaLotMultiplier).toString(), // multiplier
    price_type: 'LMT',
    price: +(latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(symbol)}`]?.lp) + 1 || 0,
    remarks: 'PawanLongCrudeAPI'
  }
  try {
    orderCERespObj = await api.place_order(orderCE);
    console.log(orderCERespObj, ' :orderCERespObj')
    console.log(symbol, qty, ' :symbol qty long')
    return orderCERespObj;
  }
  catch (error) {
    console.log(error)
    return null;
  }

}
const short = async (symbol, qty) => {
  let orderCE = {
    buy_or_sell: swapSide('S'),
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: symbol || 'NATURALGAS14DEC23P6700',
    quantity: (1250 * globalInput.emaLotMultiplier).toString(), // multiplier
    discloseqty: (1250 * globalInput.emaLotMultiplier).toString(), // multiplier
    price_type: 'LMT',
    price: +(latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(symbol)}`]?.lp) - 0.3 || 0,
    remarks: 'PawanShortCrudeAPI'
  }
  try {
    orderPERespObj = await api.place_order(orderCE);
    console.log(orderPERespObj, ' :orderPERespOb')
    console.log(symbol, qty, ' :symbol qty short')
    return orderPERespObj;
  }
  catch (error) {
    console.log(error)
    return null;
  }

}



let positionTaken = false;
// let callPreviousValue = false;
let positionTakenInSymbol = '';

let prevEma9LessThanEma21 = ''
let crossedUp = ''
let firsttime = false;
async function sellercrudecheckCrossOverExit(ema9, ema21) {
  if (prevEma9LessThanEma21 === '') {
    firsttime = true;
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    buffer_notification('first prevEma9LessThanEma21 stored for reference as ' + prevEma9LessThanEma21);
  }
  if ((!positionTaken && prevEma9LessThanEma21 && ema9 > ema21) || (firsttime && crossedUp)) {
    buffer_notification("Cross over detected. Take call position." + new Date());
    await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTakenInSymbol = biasProcess.atmPutSymbol;
    positionTaken = true;
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    firsttime = false;
    // Place your position-taking logic here
  } else if ((!positionTaken && !prevEma9LessThanEma21 && ema9 < ema21) || (firsttime && !crossedUp)) {
    buffer_notification("Cross over detected. Take put position." + new Date());
    await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTakenInSymbol = biasProcess.atmCallSymbol;
    positionTaken = true;
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    firsttime = false;
  }
  else if (positionTaken) {
    if (crossedUp && ema9 < ema21) {
      // exitLong addshort
      await long(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmCallSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;

    } else if (!crossedUp && ema9 > ema21) {
      // exitShort addLong
      await long(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmPutSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
    }
  } else {
    console.log("No signal detected." + new Date());
    // Additional logic if needed
  }
  // positionTakenInSymbol && buffer_notification(positionTakenInSymbol+ ': ltp: '+  +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp )
  positionTakenInSymbol && buffer_notification(`MCX PnL: ${await calcPnL(api, true)}% ${(limits?.collateral)?.substring(0, 3)} \n${positionTakenInSymbol}: ltp: ${latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp}`);
  //send notification
  prevEma9LessThanEma21 = ema9 < ema21;
  crossedUp = ema9 > ema21;
}
let positionDirection = '';
async function XEma(fastEMA, slowEMA) {
  const diff = fastEMA - slowEMA;
  await syncPositionStateFromLive();

  if (!positionTaken) {
    // Sell PUT when diff > 0.3
    if (diff > 0.3) {
      buffer_notification(`SELL PUT: fastEMA (${fastEMA}) - slowEMA (${slowEMA}) = ${diff} > 0.3`);
      const response = await short(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier);
      if (response?.stat === 'Ok') {
        positionTakenInSymbol = biasProcess.atmPutSymbol;
        positionTaken = true;
        positionDirection = 'long';
      }
    }
    // Sell CALL when diff < -0.3
    else if (diff < -0.3) {
      buffer_notification(`SELL CALL: fastEMA (${fastEMA}) - slowEMA (${slowEMA}) = ${diff} < -0.3`);
      const response = await short(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier);
      if (response?.stat === 'Ok') {
        positionTakenInSymbol = biasProcess.atmCallSymbol;
        positionTaken = true;
        positionDirection = 'short';
      }
    }
  } else if (positionTaken) {
    // Buy PUT when diff <= 0.3
    if (positionDirection == 'long' && (diff <= 0.3)) {
      buffer_notification(`BUY PUT: fastEMA (${fastEMA}) - slowEMA (${slowEMA}) = ${diff} <= 0.3`);
      await exitOpenStrategyPositions('EMA PUT exit');
      await syncPositionStateFromLive();
    }
    // Buy CALL when diff >= -0.3
    else if (positionDirection == 'short' && (diff >= -0.3)) {
      buffer_notification(`BUY CALL: fastEMA (${fastEMA}) - slowEMA (${slowEMA}) = ${diff} >= -0.3`);
      await exitOpenStrategyPositions('EMA CALL exit');
      await syncPositionStateFromLive();
    }
  }
  if (positionTaken) {
    positionTakenInSymbolSubStr = positionTakenInSymbol.substring(positionTakenInSymbol.length - 4);
    positionTakenInSymbol && buffer_notification(`MCX PnL: ${await calcPnL(api, true)} % ${(limits?.collateral)?.substring(0, 3)} \n${positionTakenInSymbolSubStr}: S@${prevSellPrice}, ltp: ${latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp}`);
    console.log("Current Time:", moment().utcOffset("+05:30").format('HH:mm:ss'));
  } else {
    console.log(`No position taken. \n${(limits?.collateral)?.substring(0, 3)} MCX PnL: ${await calcPnL(api, true)} % \nCurrent Time:`, moment().utcOffset("+05:30").format('HH:mm:ss'));
    buffer_notification(`No position taken. \n${(limits?.collateral)?.substring(0, 3)} MCX PnL: ${await calcPnL(api, true)} %`);
  }
}

async function crudecheckCrossOverExit(ema9, ema21) {
  if (prevEma9LessThanEma21 === '') {
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    buffer_notification('first prevEma9LessThanEma21 stored for reference as ' + prevEma9LessThanEma21);
  }
  else if (!positionTaken && prevEma9LessThanEma21 && ema9 > ema21) {
    buffer_notification("Cross over detected. Take call position." + new Date());
    await long(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTakenInSymbol = biasProcess.atmCallSymbol;
    positionTaken = true;
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
    // Place your position-taking logic here
  } else if (!positionTaken && !prevEma9LessThanEma21 && ema9 < ema21) {
    buffer_notification("Cross over detected. Take put position." + new Date());
    await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
    positionTakenInSymbol = biasProcess.atmPutSymbol;
    positionTaken = true;
    prevEma9LessThanEma21 = ema9 < ema21;
    crossedUp = ema9 > ema21;
  }
  else if (positionTaken) {
    if (crossedUp && ema9 < ema21) {
      // exitLong addshort
      await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      await long(biasProcess.atmPutSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmPutSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;

    } else if (!crossedUp && ema9 > ema21) {
      // exitShort addLong
      await short(positionTakenInSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      await long(biasProcess.atmCallSymbol, globalInput.LotSize * globalInput.emaLotMultiplier)
      positionTakenInSymbol = biasProcess.atmCallSymbol;
      positionTaken = true;
      prevEma9LessThanEma21 = ema9 < ema21;
      crossedUp = ema9 > ema21;
    }
  } else {
    console.log("No signal detected." + new Date());
    // Additional logic if needed
  }
  positionTakenInSymbol && buffer_notification(`MCX PnL: ${await calcPnL(api, true)} % Rs - ${positionTakenInSymbol}: ltp: ${latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp}`);
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
    console.log("No call signal detected." + new Date());
    // Additional logic if needed
  }
  positionTakenInSymbol && console.log(positionTakenInSymbol, ' : openCallPosition - LTP: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp)
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
    console.log("No call signal detected." + new Date());
    // Additional logic if needed
  }
  positionTakenInSymbol && console.log(positionTakenInSymbol, ' : openCallPosition - LTP: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(positionTakenInSymbol)}`]?.lp)
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
    console.log("No put signal detected." + new Date());
    // Additional logic if needed
  }
  putpositionTakenInSymbol && console.log(putpositionTakenInSymbol, ' : openPutPosition - LTP: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putpositionTakenInSymbol)}`]?.lp)
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
    console.log("No put signal detected." + new Date());
    // Additional logic if needed
  }
  putpositionTakenInSymbol && console.log(putpositionTakenInSymbol, ' : openPutPosition - LTP: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putpositionTakenInSymbol)}`]?.lp)
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
  try {
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = extractIntcPrices(reply, params, 48);
    if (!intcPrices) {
      return [null, null];
    }

    //last 50 items
    const first9Items = intcPrices.slice(0, 80).reverse();
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
    let ema9Values = await ta.ema(first9Items, 13);
    // Calculate 21-period EMA
    let ema21Values = await ta.ema(first21Items, 48);
    //send last item from the array
    return [ema9Values[ema9Values.length - 1], ema21Values[ema21Values.length - 1]];
  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }
}

const emaXValuesIndicators = async (params, emaSpeed = 8) => {
  try {
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = extractIntcPrices(reply, params, emaSpeed);
    if (!intcPrices) {
      return null;
    }

    //last 50 items
    const lastXItems = intcPrices.slice(0, 200).reverse();

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
    let emaXValues = await ta.ema(lastXItems, emaSpeed);
    //send last item from the array
    return emaXValues[emaXValues.length - 1];
  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }
}

const ema9and21Values = async (params) => {
  try {
    const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = extractIntcPrices(reply, params, 21);
    if (!intcPrices) {
      return [null, null];
    }

    // Get the last 9 items
    const first9Items = intcPrices.slice(0, 9);

    // Get the last 21 items
    const first21Items = intcPrices.slice(0, 21);

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
  try {
    tempAtmStrike = await getAtmStrike()
    if (tempAtmStrike != biasProcess.atmStrike) {
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
    await refreshRestQuotes();

    const quoteStatus = requiredQuotesReady();
    if (!quoteStatus.ready) {
      console.log('Skipping NAT EMA tick; missing quotes:', quoteStatus.missing.join(', '));
      return;
    }


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
    const currentDateIST = new Date();

    // Set the time to 2 o'clock
    currentDateIST.setHours(0, 0, 0, 0);

    // Subtract 5 day to get the 5 days earlier time
    currentDateIST.setDate(currentDateIST.getDate() - 5);

    // Get epoch time in milliseconds
    const epochTime = currentDateIST.getTime();
    epochTimeTrimmed = epochTime.toString().slice(0, -3);

    let callSymbolForEma = positionTaken ? positionTakenInSymbol : biasProcess.atmCallSymbol;
    // let putSymbolForEma = putpositionTaken? putpositionTakenInSymbol:biasProcess.atmPutSymbol;

    params = {
      'exchange': globalInput.pickedExchange,
      'token': globalInput.token,
      'starttime': epochTimeTrimmed,
      'interval': '3'
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
      if (inputProp) {
        // const XEmaResponse = await emaXValuesIndicators(params); //call
        let fastEMA = toFiniteNumber(await emaXValuesIndicators(params, 26));
        let slowEMA = toFiniteNumber(await emaXValuesIndicators(params, 96));
        if (fastEMA === null || slowEMA === null) {
          console.log(`Skipping EMA tick: invalid TPSeries data for ${params.exchange}|${params.token}.`);
          return;
        }
        // console.log(fastEMA, slowEMA, ' : fastEMA, slowEMA');
        buffer_notification('NATURALGAS: ltp ' + +latestQuotes[`${globalInput.pickedExchange}|${globalInput.token}`]?.lp + '\nfastEMA ' + parseFloat(fastEMA).toFixed(2) + '\nslowEMA ' + parseFloat(slowEMA).toFixed(2))
        await XEma(fastEMA, slowEMA);
      } else {
        const [callema9, callema21] = await ema9and21ValuesIndicators(params); //call
        if (toFiniteNumber(callema9) === null || toFiniteNumber(callema21) === null) {
          console.log(`Skipping EMA tick: invalid TPSeries data for ${params.exchange}|${params.token}.`);
          return;
        }
        // const [putema9, putema21] = await ema9and21Values(params2); //put

        buffer_notification('NATURALGAS: ltp ' + +latestQuotes[`${globalInput.pickedExchange}|${globalInput.token}`]?.lp + ', ema9 ' + parseFloat(callema9).toFixed(2) + ', ema21 ' + parseFloat(callema21).toFixed(2))
        // console.log(putSymbolForEma,  ': ltp: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putSymbolForEma)}`]?.lp , ' : putema9, putema21. input for position', putema9, putema21)

        //send notification

        // //buyer
        await sellercrudecheckCrossOverExit(callema9, callema21)
        // await crudecheckCrossOverExit(callema9, callema21)
        // await crudecheckCrossOverExit(putema9, putema21)

        // //seller
        // sellercheckCrossOverExit(callema9, callema21)
        // sellerputcheckCrossOverExit(putema9, putema21)
      }

    } catch (error) {
      console.error('Error:', error);
    }



    // Check a condition to determine whether to stop the recurring function
    if (websocket_closed && !restQuotePoller) {
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
let lastPnl;
getEma = async () => {
  var currentDate = new Date();
  var seconds = currentDate.getSeconds();
  if (isEveningNoEntryWindow()) {
    if (seconds % trailingMonitorIntervalSeconds === 0 && !eveningExitInProgress) {
      eveningExitInProgress = true;
      try {
        const exited = await exitOpenStrategyPositions('18:30 IST no-entry window');
        if (exited) {
          buffer_notification('18:30 IST no-entry window: exited open NATURALGAS positions. Re-entry blocked until 21:30 IST.', true);
        }
      } catch (error) {
        console.error('Error enforcing evening no-entry window:', error.message || JSON.stringify(apiResponseSummary(error)));
      } finally {
        eveningExitInProgress = false;
      }
    }
    return;
  }

  if (seconds % trailingMonitorIntervalSeconds === 0) {
    try {
      const exited = await monitorTrailingLoss();
      if (exited) {
        return;
      }
    } catch (error) {
      console.error('Error checking trailing loss:', error.message || JSON.stringify(apiResponseSummary(error)));
    }
  }

  // --- Max loss check ---
  try {
    if (seconds === 50) {
      const pnl = await calcPnL(api, true);
      if (pnl < maxLossThreshold || pnl > maxProfitThreshold) {
        buffer_notification(`PnL threshold reached: ${pnl}. Exiting all positions.`);
        await exitOpenStrategyPositions('PnL threshold reached');
        return;
      }
    }
    // Optionally log PnL changes here if needed
  } catch (e) {
    console.error('Error checking PnL:', e);
  }
  // check when second is 2 on the clock for every minute
  if (seconds === 2) {
    try {
      await emaRecurringFunction();
    } catch (error) {
      console.error("Error occured: " + error);
      // buffer_notification("Error occured: " + error)
      // getBias();
    }
  }
}

const setNearestCrudeFutureToken = async () => {

  let query = `NATURALGAS`;
  let futureObj = await api.searchscrip(exchange = 'MCX', searchtext = query)
  const future = futureObj?.values?.find(item => item?.instname === 'FUTCOM' && item?.token);
  if (!future) {
    throw new Error(`Unable to find NATURALGAS FUTCOM token: ${JSON.stringify(apiResponseSummary(futureObj))}`);
  }

  let futureToken = future.token; // Use the nearest tradable futures contract, not the spot/index token.
  console.log(`Using NATURALGAS futures token ${futureToken}${future.tsym ? ` (${future.tsym})` : ''}.`);
  // console.log(future, ' : @@@ Obj for NATURALGAS');
//   {
//   exch: 'MCX',
//   token: '401',
//   tsym: 'NATURALGAS',
//   nontrd: '1',
//   instname: 'COM',
//   symname: 'NATURALGAS',
//   seg: 'COM',
//   pp: '2',
//   ls: '1250',
//   ti: '0.10'
// } 
  // let futureToken = futureObj.values[5].token; //258003 //next month
  globalInput.token = futureToken;

  // console.log(globalInput.token, 'token')

}

runEma = async () => {
  try {
    await expiryLoadedPromise;
    await executeLogin();
    await setNearestCrudeFutureToken();
    await send_callback_notification();
    subscribeToInstruments([`${globalInput.pickedExchange}|${globalInput.token}`, 'NSE|26017']);
    const websocketAuthenticated = await startWebsocket();
    startRestQuotePolling();
    if (!websocketAuthenticated) {
      console.log('Running nat_ema2 with REST quote polling fallback.');
    }
    await refreshRestQuotes();
    await updateITMSymbolfromOC();
    await dynSubs();
    await refreshRestQuotes();
    limits = await api.get_limits()
    globalInput.emaLotMultiplier = limits?.collateral < 700000 ? 1 : 1;
    intervalId = setInterval(getEma, 1000);
  } catch (error) {
    console.log(error)
  }
}
// runEma();
runEma();
