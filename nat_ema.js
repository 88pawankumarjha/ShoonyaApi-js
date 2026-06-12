// Initialization / nearest expiry / getAtmStrike
// jupyter nbconvert --to script gpt.ipynb
const futureOffset = 0;
// Add these at the top (or near your config section)
const maxLossThreshold = -2;
const maxProfitThreshold = 1.5;
const trailingLossPerLot = 3000;
const trailActivationProfitPerLot = 1000;
const normalTrailLossPerLot = 1000;
const tightTrailLossPerLot = 500;
const tightTrailProfitPerLot = 3000;
const emaGapSignalThreshold = 0.15;
const profitMonitorLogIntervalMs = 30 * 1000;
const telegramMinuteDivider = '────────────────────';
const eveningExitMinutesIST = (18 * 60) + 25;
const eveningReentryMinutesIST = (21 * 60) + 25;
const nightShutdownMinutesIST = (23 * 60) + 17;
const trailingMonitorIntervalSeconds = 5;
const reentryCooldownMs = 20 * 60 * 1000;
const profitReentryCooldownMs = 20 * 60 * 1000;
const reentryCooldownFile = '.nat-ema-reentry-cooldown.json';
const natEmaPm2ProcessName = process.env.NAT_EMA_PM2_NAME || 'nat_ema2';
const orderPriceSlippageRatio = 0.02;
const orderPriceSlippageMin = 1;
const orderPriceSlippageMax = 5;
const orderTickSize = 0.1;
const paperStrategyFastPeriod = 5;
const paperStrategySlowPeriod = 13;
const paperStrategySignalThreshold = 0.05;
const paperStrategyLogPrefix = 'NAT_EMA_PAPER';

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
const { spawn } = require('child_process');


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

function bufferMinuteDivider() {
  buffer_notification(telegramMinuteDivider);
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

const toPnlNumber = (value) => {
  if (typeof value === 'string') {
    return toFiniteNumber(value.replace('%', '').trim());
  }
  return toFiniteNumber(value);
};

const getPnlMood = (value) => {
  const numericValue = toPnlNumber(value);
  if (numericValue === null) {
    return { label: 'neutral', icon: '😐' };
  }
  if (numericValue > 0.33) {
    return { label: 'good', icon: '🙂' };
  }
  if (numericValue < -0.33) {
    return { label: 'bad', icon: '☹️' };
  }
  return { label: 'neutral', icon: '😐' };
};

const getEmaGapMood = (gap) => {
  const numericGap = toFiniteNumber(gap);
  if (numericGap === null) {
    return { label: 'unknown', icon: '❔' };
  }
  if (numericGap > emaGapSignalThreshold) {
    return { label: 'bullish gap', icon: '📈' };
  }
  if (numericGap < -emaGapSignalThreshold) {
    return { label: 'bearish gap', icon: '📉' };
  }
  return { label: 'flat gap', icon: '➖' };
};

const getPositionMood = (direction) => {
  if (direction === 'long') {
    return { label: 'long bias / short PUT', icon: '🟢' };
  }
  if (direction === 'short') {
    return { label: 'short bias / short CALL', icon: '🔴' };
  }
  return { label: 'no position', icon: '⚪' };
};

const formatPriceText = (value) => {
  const numericValue = toFiniteNumber(value);
  return numericValue === null ? 'NA' : numericValue.toFixed(2);
};

const formatPnlText = (value, includePercent = false) => {
  const mood = getPnlMood(value);
  const numericValue = toPnlNumber(value);
  if (!includePercent || numericValue === null) {
    return mood.icon;
  }
  return `${mood.icon} ${numericValue.toFixed(2)}%`;
};

const formatPnlPercent = (value) => {
  const numericValue = toPnlNumber(value);
  return numericValue === null ? 'NA' : `${numericValue.toFixed(2)}%`;
};

const toDisplayNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return toFiniteNumber(value);
};

const formatSignedPointText = (value) => {
  const numericValue = toDisplayNumber(value);
  if (numericValue === null) {
    return 'NA';
  }
  const prefix = numericValue > 0 ? '+' : '';
  return `${prefix}${numericValue.toFixed(2)} pt`;
};

const formatEmaGapText = (gap) => {
  const mood = getEmaGapMood(gap);
  const numericGap = toFiniteNumber(gap);
  return `${mood.icon} ${mood.label}${numericGap === null ? '' : ` ${numericGap.toFixed(2)}`}`;
};

const formatCompactEmaGapText = (gap) => {
  const mood = getEmaGapMood(gap);
  const numericGap = toDisplayNumber(gap);
  return `${mood.icon} ${numericGap === null ? 'NA' : numericGap.toFixed(2)}`;
};

const formatNatPositionText = (direction) => {
  if (direction === 'long') {
    return '🟢 SHORT PUT';
  }
  if (direction === 'short') {
    return '🔴 SHORT CALL';
  }
  return '⚪ NONE';
};

const formatCompactTrailLabel = (state) => {
  if (!state || toDisplayNumber(state.stopLtp) === null) {
    return 'pending';
  }
  const stopType = state.trailingActive
    ? state.tightTrailActive ? 'TIGHT' : 'TSL'
    : 'HSL';
  return `${formatPriceText(state.stopLtp)} ${stopType}`;
};

const formatNatRiskLine = ({ symbol, sell, trail, ltp, side = 'short', pending = false }) => {
  const sellValue = toDisplayNumber(sell);
  const ltpValue = toDisplayNumber(ltp);
  const points = sellValue === null || ltpValue === null
    ? null
    : side === 'long' ? ltpValue - sellValue : sellValue - ltpValue;
  const compactSymbol = symbol ? String(symbol).slice(-4) : '';
  const symbolPrefix = compactSymbol ? `${compactSymbol} | ` : '';
  const pendingPrefix = pending ? 'SL pending | ' : '';
  const sellText = sellValue === null ? 'NA' : sellValue.toFixed(2);
  return `${symbolPrefix}${pendingPrefix}S ${sellText} | T ${trail || 'pending'} | ${formatSignedPointText(points)}`;
};

const formatProfitLockLine = (state) => {
  if (!state) {
    return '👀 waiting';
  }
  const perLot = Number.isFinite(state.profitPerLot) ? `Rs ${state.profitPerLot.toFixed(0)}/lot` : 'Rs NA/lot';
  if (!state.trailingActive) {
    return `👀 ${perLot}`;
  }
  const mode = state.tightTrailActive ? 'tight' : 'trail';
  return `🔒 ${mode} | ${perLot}`;
};

const getCollateralLabel = () => {
  const label = String(limits?.collateral ?? 'NA').substring(0, 3);
  return label || 'NA';
};

const formatNatMessage = (title, rows = []) => [
  `NAT EMA | ${title}`,
  ...rows
    .filter(row => row && row[1] !== undefined && row[1] !== null && row[1] !== '')
    .map(([label, value]) => `${label}: ${value}`),
].join('\n');

const roundOrderPrice = (price, side) => {
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  const ticks = price / orderTickSize;
  const rounded = side === 'B'
    ? Math.ceil(ticks) * orderTickSize
    : Math.floor(ticks) * orderTickSize;
  return Number(Math.max(orderTickSize, rounded).toFixed(2));
};

const getLimitPriceFromLtp = (ltp, side) => {
  const numericLtp = toFiniteNumber(ltp);
  if (numericLtp === null || numericLtp <= 0) {
    return null;
  }
  const slippage = Math.max(orderPriceSlippageMin, Math.min(orderPriceSlippageMax, numericLtp * orderPriceSlippageRatio));
  const rawPrice = side === 'B'
    ? numericLtp + slippage
    : numericLtp - slippage;
  return roundOrderPrice(rawPrice, side);
};

const formatEntryOrderMessage = ({ reason, symbol, side, qty, price, ltp, direction, emaGap }) => {
  return formatNatMessage(`🟦 ENTRY | ${reason}`, [
    ['Position', formatNatPositionText(direction, emaGap)],
    ['Gap', emaGap === undefined ? undefined : formatCompactEmaGapText(emaGap)],
    ['Order', `${side || 'NA'} ${qty || 'NA'} @${formatPriceText(price)}`],
    ['Risk', formatNatRiskLine({
      symbol,
      sell: price,
      trail: 'pending',
      ltp,
      side: 'short',
      pending: true,
    })],
  ]);
};

const formatExitOrderMessage = ({ reason, symbol, side, qty, price, ltp, entry, stop, pnl }) => formatNatMessage(`🟧 EXIT | ${reason}`, [
  ['Order', `${side || 'NA'} ${qty || 'NA'} @${formatPriceText(price)}`],
  ['Risk', formatNatRiskLine({
    symbol,
    sell: entry,
    trail: stop === undefined ? formatPriceText(price) : formatPriceText(stop),
    ltp,
    side: 'short',
  })],
  ['Mood', formatPnlText(pnl)],
  ['PnL', formatPnlPercent(pnl)],
]);

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

const getCurrentISTDateParts = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hours = Number(parts.find(part => part.type === 'hour')?.value);
  const minutes = Number(parts.find(part => part.type === 'minute')?.value);
  return {
    weekday: parts.find(part => part.type === 'weekday')?.value,
    minutes: (hours * 60) + minutes,
  };
};

const getCurrentISTMinutes = () => {
  return getCurrentISTDateParts().minutes;
};

const isEveningNoEntryWindow = () => {
  const { weekday, minutes } = getCurrentISTDateParts();
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) &&
    minutes >= eveningExitMinutesIST &&
    minutes < eveningReentryMinutesIST;
};

const isNightShutdownDue = () => getCurrentISTMinutes() >= nightShutdownMinutesIST;

let reentryBlockedUntil = 0;

const formatISTTime = (timestamp) => new Date(timestamp).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour12: false,
});

const loadReentryCooldown = () => {
  try {
    if (!fs.existsSync(reentryCooldownFile)) {
      return 0;
    }
    const data = JSON.parse(fs.readFileSync(reentryCooldownFile, 'utf8'));
    return Number.isFinite(Number(data.blockedUntil)) ? Number(data.blockedUntil) : 0;
  } catch (error) {
    console.error('Unable to read NAT EMA re-entry cooldown:', error.message);
    return 0;
  }
};

const clearReentryCooldown = () => {
  reentryBlockedUntil = 0;
  try {
    if (fs.existsSync(reentryCooldownFile)) {
      fs.unlinkSync(reentryCooldownFile);
    }
  } catch (error) {
    console.error('Unable to clear NAT EMA re-entry cooldown:', error.message);
  }
};

const startReentryCooldown = (reason, durationMs = reentryCooldownMs) => {
  reentryBlockedUntil = Date.now() + durationMs;
  const payload = {
    blockedUntil: reentryBlockedUntil,
    reason,
    durationMs,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(reentryCooldownFile, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Unable to persist NAT EMA re-entry cooldown:', error.message);
  }
  const message = formatNatMessage('⏳ RE-ENTRY COOLDOWN', [
    ['Until', `${formatISTTime(reentryBlockedUntil)} IST`],
    ['Reason', reason],
  ]);
  console.log(message);
  buffer_notification(message, true);
};

const isReentryCooldownActive = () => {
  reentryBlockedUntil = Math.max(reentryBlockedUntil, loadReentryCooldown());
  if (!reentryBlockedUntil || Date.now() >= reentryBlockedUntil) {
    clearReentryCooldown();
    return false;
  }
  return true;
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
let lastEveningPauseNoticeAt = 0;
let nightShutdownInProgress = false;
let latestNatEmaSnapshot = {
  fast: null,
  slow: null,
  gap: null,
  updatedAt: 0,
};

const positionKey = (position) => `${position?.exch || ''}|${position?.tsym || ''}|${position?.prd || 'M'}`;

const isOpenStrategyPosition = (position) => position?.exch === 'MCX' &&
  position?.tsym?.includes(globalInput.indexName) &&
  Number(position?.netqty) !== 0;

const getPositionToken = (position) => position?.token || getTokenByTradingSymbol(position?.tsym);

const getFreshPositionLtp = async (position) => {
  const token = getPositionToken(position);
  if (!token) {
    return null;
  }

  try {
    const quote = await api.get_quotes(position.exch, token);
    const quoteSymbol = quote?.tsym || quote?.tradingSymbol;
    if (quoteSymbol && position?.tsym && quoteSymbol !== position.tsym) {
      console.error(`Ignoring mismatched REST quote for ${positionKey(position)}: ${quoteSymbol}`);
      return null;
    }
    const ltp = toFiniteNumber(quote?.lp);
    if (ltp !== null) {
      const quoteKey = `${position.exch}|${token}`;
      latestQuotes[quoteKey] = {
        ...quote,
        e: quote?.e || quote?.exch || position.exch,
        tk: quote?.tk || quote?.token || token,
        tsym: quote?.tsym || position.tsym,
      };
      return ltp;
    }
  } catch (error) {
    console.error(`REST quote fetch failed for ${positionKey(position)}:`, error.message || JSON.stringify(apiResponseSummary(error)));
  }

  return null;
};

const getPositionLtp = async (position, forceRest = false) => {
  if (forceRest) {
    const freshLtp = await getFreshPositionLtp(position);
    if (freshLtp !== null) {
      return freshLtp;
    }
  }

  const token = getPositionToken(position);
  const quoteKey = token ? `${position.exch}|${token}` : '';
  const quote = latestQuotes[quoteKey];
  if (quote?.tsym && quote.tsym !== position?.tsym) {
    console.error(`Ignoring mismatched quote for ${positionKey(position)}: ${quote.tsym}`);
    return null;
  }
  const cachedLtp = toFiniteNumber(quote?.lp);
  if (cachedLtp !== null) {
    return cachedLtp;
  }

  const positionLtp = toFiniteNumber(position?.lp);
  if (positionLtp !== null) {
    return positionLtp;
  }

  return null;
};

const getPositionEntryPrice = (position) => {
  const netQty = Number(position?.netqty);
  if (netQty < 0) {
    return toFiniteNumber(position?.netavgprc ?? position?.daysellavgprc);
  }
  return toFiniteNumber(position?.netavgprc ?? position?.daybuyavgprc);
};

const getSymbolLtp = async (symbol, forceRest = false) => {
  const token = getTokenByTradingSymbol(symbol);
  if (!symbol || !token) {
    return null;
  }

  const quoteKey = `${globalInput.pickedExchange}|${token}`;
  if (forceRest) {
    try {
      const quote = await api.get_quotes(globalInput.pickedExchange, token);
      const quoteSymbol = quote?.tsym || quote?.tradingSymbol || quote?.ts;
      if (quoteSymbol && quoteSymbol !== symbol) {
        console.error(`Ignoring mismatched REST quote for ${symbol}: ${quoteSymbol}`);
        return null;
      }
      const ltp = toFiniteNumber(quote?.lp);
      if (ltp !== null) {
        latestQuotes[quoteKey] = {
          ...quote,
          e: quote?.e || quote?.exch || globalInput.pickedExchange,
          tk: quote?.tk || quote?.token || token,
          tsym: quote?.tsym || symbol,
        };
        return ltp;
      }
    } catch (error) {
      console.error(`REST quote fetch failed for ${symbol}:`, error.message || JSON.stringify(apiResponseSummary(error)));
    }
  }

  return toFiniteNumber(latestQuotes[quoteKey]?.lp);
};

const getUnderlyingLtp = async (forceRest = false) => {
  const quoteKey = `${globalInput.pickedExchange}|${globalInput.token}`;
  if (forceRest) {
    try {
      const quote = await api.get_quotes(globalInput.pickedExchange, globalInput.token);
      const ltp = toFiniteNumber(quote?.lp ?? quote?.c);
      if (ltp !== null) {
        latestQuotes[quoteKey] = {
          ...quote,
          e: quote?.e || quote?.exch || globalInput.pickedExchange,
          tk: quote?.tk || quote?.token || globalInput.token,
          lp: ltp,
        };
        return ltp;
      }
    } catch (error) {
      console.error(`REST quote fetch failed for ${quoteKey}:`, error.message || JSON.stringify(apiResponseSummary(error)));
    }
  }
  return toFiniteNumber(latestQuotes[quoteKey]?.lp);
};

const createPaperStrategyState = () => ({
  emas: new Map(),
  position: null,
  realizedPnl: 0,
  trades: [],
  blockedTradeKey: null,
  lastTick: null,
  eodSummarySent: false,
});

const paperStrategyState = createPaperStrategyState();

const paperStrategyQty = () => {
  const lotSize = toFiniteNumber(globalInput.LotSize);
  const multiplier = toFiniteNumber(globalInput.emaLotMultiplier);
  return Math.max(1, (lotSize || 1250) * (multiplier || 1));
};

const paperLog = (event, payload = {}) => {
  try {
    console.log(`${paperStrategyLogPrefix} ${JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ist: formatISTTime(Date.now()),
      ...payload,
    })}`);
  } catch (error) {
    console.error(`${paperStrategyLogPrefix}_LOG_ERROR`, error.message || error);
  }
};

const updatePaperOptionEma = (symbol, ltp) => {
  const existing = paperStrategyState.emas.get(symbol);
  const fastAlpha = 2 / (paperStrategyFastPeriod + 1);
  const slowAlpha = 2 / (paperStrategySlowPeriod + 1);
  const next = existing
    ? {
      fast: (ltp * fastAlpha) + (existing.fast * (1 - fastAlpha)),
      slow: (ltp * slowAlpha) + (existing.slow * (1 - slowAlpha)),
      samples: existing.samples + 1,
    }
    : { fast: ltp, slow: ltp, samples: 1 };
  next.gap = next.fast - next.slow;
  paperStrategyState.emas.set(symbol, next);
  return next;
};

const getPaperTradeKey = (signal) => signal ? `${signal.side}|${signal.symbol}` : null;

const choosePaperSignal = ({ callSymbol, putSymbol, callLtp, putLtp, callEma, putEma }) => {
  if (callEma.samples < paperStrategyFastPeriod || putEma.samples < paperStrategyFastPeriod) {
    return null;
  }

  const candidates = [];
  if (callEma.gap <= -paperStrategySignalThreshold) {
    candidates.push({
      side: 'SELL_CALL',
      direction: 'short',
      symbol: callSymbol,
      ltp: callLtp,
      gap: callEma.gap,
      fast: callEma.fast,
      slow: callEma.slow,
    });
  }
  if (putEma.gap <= -paperStrategySignalThreshold) {
    candidates.push({
      side: 'SELL_PUT',
      direction: 'long',
      symbol: putSymbol,
      ltp: putLtp,
      gap: putEma.gap,
      fast: putEma.fast,
      slow: putEma.slow,
    });
  }

  return candidates.sort((left, right) => left.gap - right.gap)[0] || null;
};

const paperPositionPnl = (position, ltp = position?.lastLtp) => {
  const numericLtp = toFiniteNumber(ltp);
  if (!position || numericLtp === null) {
    return 0;
  }
  return (position.entry - numericLtp) * position.qty;
};

const paperTrailSnapshot = (position, ltp) => {
  const numericLtp = toFiniteNumber(ltp);
  if (!position || numericLtp === null || numericLtp <= 0) {
    return null;
  }

  position.lastLtp = numericLtp;
  position.bestLtp = Math.min(position.bestLtp, numericLtp);
  const snapshot = getRiskStopSnapshot({
    entryPrice: position.entry,
    ltp: numericLtp,
    bestLtp: position.bestLtp,
    side: 'short',
    lotSize: position.qty,
    forceTightTrail: isEveningNoEntryWindow(),
    trailAlreadyActive: Boolean(position.profitLockActive),
    tightTrailAlreadyActive: Boolean(position.tightTrailActive),
  });
  if (!snapshot) {
    return null;
  }

  if (!position.profitLockActive && snapshot.trailActive) {
    position.profitLockActive = true;
    position.profitLockActivatedAt = Date.now();
    paperLog('trail_started', {
      symbol: position.symbol,
      entry: position.entry,
      bestLtp: position.bestLtp,
      profitPerLot: snapshot.profitPerLot,
      mode: snapshot.mode,
    });
  }
  if (snapshot.tightTrailActive) {
    position.tightTrailActive = true;
  }

  const pnl = paperPositionPnl(position, numericLtp);

  return {
    ltp: numericLtp,
    hardStop: snapshot.hardStop,
    trailStop: snapshot.trailStop,
    stop: snapshot.stop,
    pnl,
    profitPerLot: snapshot.profitPerLot,
    mode: snapshot.mode,
    exitHit: numericLtp >= snapshot.stop,
    exitReason: numericLtp >= snapshot.stop
      ? snapshot.trailActive ? `${snapshot.mode}_trail_hit` : 'hard_loss_hit'
      : null,
  };
};

const exitPaperPosition = (snapshot) => {
  const position = paperStrategyState.position;
  if (!position) {
    return;
  }

  const exitPrice = snapshot?.ltp ?? position.lastLtp;
  const pnl = paperPositionPnl(position, exitPrice);
  const trade = {
    ...position,
    exit: exitPrice,
    exitedAt: new Date().toISOString(),
    pnl,
    reason: snapshot?.exitReason || 'manual_paper_exit',
  };
  paperStrategyState.realizedPnl += pnl;
  paperStrategyState.trades.push(trade);
  paperStrategyState.position = null;
  paperStrategyState.blockedTradeKey = pnl > 0 ? `${position.side}|${position.symbol}` : null;
  paperLog('exit', {
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    exit: trade.exit,
    qty: trade.qty,
    pnl: trade.pnl,
    reason: trade.reason,
    blockedTradeKey: paperStrategyState.blockedTradeKey,
  });
};

const exitPaperPositionForEveningPause = async () => {
  const position = paperStrategyState.position;
  if (!position) {
    return false;
  }

  let ltp = await getSymbolLtp(position.symbol, true);
  if (toFiniteNumber(ltp) === null) {
    ltp = position.lastLtp;
  }
  if (toFiniteNumber(ltp) === null) {
    paperLog('pause_exit_skipped', {
      reason: 'ltp_missing',
      symbol: position.symbol,
      side: position.side,
      entry: position.entry,
    });
    return false;
  }

  exitPaperPosition({
    ltp,
    exitReason: 'evening_pause_exit',
  });
  return true;
};

const exitPaperPositionForEveningPauseSafely = async () => {
  try {
    return await exitPaperPositionForEveningPause();
  } catch (error) {
    console.error(`${paperStrategyLogPrefix}_PAUSE_EXIT_ERROR`, error.message || JSON.stringify(apiResponseSummary(error)));
    return false;
  }
};

const updatePaperOpenPosition = async ({ callSymbol, callLtp, putSymbol, putLtp }) => {
  const position = paperStrategyState.position;
  if (!position) {
    return false;
  }

  let ltp = position.symbol === callSymbol
    ? callLtp
    : position.symbol === putSymbol
      ? putLtp
      : null;
  if (toFiniteNumber(ltp) === null) {
    ltp = await getSymbolLtp(position.symbol, true);
  }
  if (toFiniteNumber(ltp) === null) {
    paperLog('position_ltp_missing', { symbol: position.symbol, lastLtp: position.lastLtp });
    return true;
  }

  const snapshot = paperTrailSnapshot(position, ltp);
  if (!snapshot) {
    return true;
  }

  if (snapshot.exitHit) {
    exitPaperPosition(snapshot);
    return false;
  }

  paperLog('position_tick', {
    symbol: position.symbol,
    side: position.side,
    entry: position.entry,
    ltp: snapshot.ltp,
    bestLtp: position.bestLtp,
    stop: snapshot.stop,
    trailStop: snapshot.trailStop,
    hardStop: snapshot.hardStop,
    pnl: snapshot.pnl,
    profitPerLot: snapshot.profitPerLot,
    trailMode: snapshot.mode,
    locked: Boolean(position.profitLockActive),
  });
  return true;
};

const enterPaperPosition = (signal) => {
  const qty = paperStrategyQty();
  paperStrategyState.position = {
    symbol: signal.symbol,
    side: signal.side,
    direction: signal.direction,
    entry: signal.ltp,
    lastLtp: signal.ltp,
    bestLtp: signal.ltp,
    qty,
    openedAt: new Date().toISOString(),
    atmStrike: biasProcess.atmStrike,
    signalGap: signal.gap,
    signalFast: signal.fast,
    signalSlow: signal.slow,
    profitLockActive: false,
    tightTrailActive: false,
  };
  paperLog('entry', {
    symbol: signal.symbol,
    side: signal.side,
    entry: signal.ltp,
    qty,
    atmStrike: biasProcess.atmStrike,
    signalGap: signal.gap,
  });
};

const runPaperStrategyTick = async () => {
  const callSymbol = biasProcess.atmCallSymbol;
  const putSymbol = biasProcess.atmPutSymbol;
  if (!callSymbol || !putSymbol) {
    paperLog('skip', { reason: 'atm_symbols_missing', callSymbol, putSymbol });
    return;
  }

  const [callLtp, putLtp] = await Promise.all([
    getSymbolLtp(callSymbol, true),
    getSymbolLtp(putSymbol, true),
  ]);
  if (toFiniteNumber(callLtp) === null || toFiniteNumber(putLtp) === null) {
    paperLog('skip', { reason: 'ltp_missing', callSymbol, callLtp, putSymbol, putLtp });
    return;
  }

  const callEma = updatePaperOptionEma(callSymbol, callLtp);
  const putEma = updatePaperOptionEma(putSymbol, putLtp);
  paperStrategyState.lastTick = {
    callSymbol,
    putSymbol,
    callLtp,
    putLtp,
    callGap: callEma.gap,
    putGap: putEma.gap,
    samples: Math.min(callEma.samples, putEma.samples),
  };

  const positionStillOpen = await updatePaperOpenPosition({ callSymbol, callLtp, putSymbol, putLtp });
  const signal = choosePaperSignal({ callSymbol, putSymbol, callLtp, putLtp, callEma, putEma });
  const signalKey = getPaperTradeKey(signal);

  if (paperStrategyState.blockedTradeKey && paperStrategyState.blockedTradeKey !== signalKey) {
    paperLog('same_trade_block_cleared', {
      blockedTradeKey: paperStrategyState.blockedTradeKey,
      signalKey,
    });
    paperStrategyState.blockedTradeKey = null;
  }

  if (!positionStillOpen && signal) {
    if (paperStrategyState.blockedTradeKey === signalKey) {
      paperLog('entry_blocked_same_trade', {
        signalKey,
        symbol: signal.symbol,
        side: signal.side,
        gap: signal.gap,
      });
    } else {
      enterPaperPosition(signal);
    }
  }

  paperLog('tick', {
    callSymbol,
    putSymbol,
    callLtp,
    putLtp,
    callGap: callEma.gap,
    putGap: putEma.gap,
    samples: paperStrategyState.lastTick.samples,
    signal: signal ? { side: signal.side, symbol: signal.symbol, gap: signal.gap } : null,
    openSymbol: paperStrategyState.position?.symbol || null,
    realizedPnl: paperStrategyState.realizedPnl,
  });
};

const runPaperStrategyTickSafely = async () => {
  try {
    await runPaperStrategyTick();
  } catch (error) {
    console.error(`${paperStrategyLogPrefix}_ERROR`, error.message || JSON.stringify(apiResponseSummary(error)));
  }
};

const bufferPaperStrategySummary = async (reason) => {
  if (paperStrategyState.eodSummarySent) {
    return;
  }
  paperStrategyState.eodSummarySent = true;

  const openPosition = paperStrategyState.position;
  let openLtp = openPosition ? await getSymbolLtp(openPosition.symbol, true) : null;
  if (openPosition && toFiniteNumber(openLtp) === null) {
    openLtp = openPosition.lastLtp;
  }
  const openPnl = openPosition ? paperPositionPnl(openPosition, openLtp) : 0;
  const totalPnl = paperStrategyState.realizedPnl + openPnl;
  const summary = {
    reason,
    realizedPnl: paperStrategyState.realizedPnl,
    openPnl,
    totalPnl,
    trades: paperStrategyState.trades.length,
    openSymbol: openPosition?.symbol || null,
    openSide: openPosition?.side || null,
    openLtp,
    lastTick: paperStrategyState.lastTick,
  };

  paperLog('eod_summary', summary);
  buffer_notification(formatNatMessage('🧾 PAPER STRATEGY EOD', [
    ['Reason', reason],
    ['Realized', `Rs ${summary.realizedPnl.toFixed(2)}`],
    ['Open', `Rs ${summary.openPnl.toFixed(2)}`],
    ['Possible Total', `Rs ${summary.totalPnl.toFixed(2)}`],
    ['Trades', summary.trades],
    ['Open Position', openPosition ? `${openPosition.side} ${openPosition.symbol} @${formatPriceText(openPosition.entry)}` : 'none'],
  ]), true);
};

const bufferPaperStrategySummarySafely = async (reason) => {
  try {
    await bufferPaperStrategySummary(reason);
  } catch (error) {
    console.error(`${paperStrategyLogPrefix}_SUMMARY_ERROR`, error.message || JSON.stringify(apiResponseSummary(error)));
  }
};

const getOrderStatusText = (orderStatus) => String(orderStatus?.status || orderStatus?.st_intrn || '').toUpperCase();

const isRejectedOrderStatus = (orderStatus) =>
  ['REJECTED', 'CANCELED', 'CANCELLED'].includes(getOrderStatusText(orderStatus));

const getOrderFilledPrice = (orderStatus) =>
  toFiniteNumber(orderStatus?.avgprc ?? orderStatus?.flprc ?? orderStatus?.rprc ?? orderStatus?.prc);

const getOrderSymbol = (orderStatus) =>
  orderStatus?.tsym || orderStatus?.tradingsymbol || orderStatus?.Instrument || orderStatus?.instrument || orderStatus?.ts || '';

const isStrategyOrderEvent = (orderStatus) => {
  const symbol = getOrderSymbol(orderStatus);
  return !symbol || String(symbol).includes(globalInput.indexName);
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

const updateLatestEmaSnapshot = (fastEMA, slowEMA) => {
  const fast = toFiniteNumber(fastEMA);
  const slow = toFiniteNumber(slowEMA);
  latestNatEmaSnapshot = {
    fast,
    slow,
    gap: fast !== null && slow !== null ? fast - slow : null,
    updatedAt: Date.now(),
  };
  return latestNatEmaSnapshot;
};

const getLatestEmaSnapshot = () => {
  const ageMs = latestNatEmaSnapshot.updatedAt ? Date.now() - latestNatEmaSnapshot.updatedAt : null;
  return {
    ...latestNatEmaSnapshot,
    ageMs,
  };
};

const getProfitMoveRatio = (entryPrice, ltp, side) => {
  if (!entryPrice || entryPrice <= 0 || ltp === null) {
    return null;
  }
  const move = side === 'short'
    ? entryPrice - ltp
    : ltp - entryPrice;
  return move / entryPrice;
};

const getPerLotPnl = (entryPrice, ltp, side, lotSize) => {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(ltp) || !Number.isFinite(lotSize) || lotSize <= 0) {
    return null;
  }
  const points = side === 'short'
    ? entryPrice - ltp
    : ltp - entryPrice;
  return points * lotSize;
};

const getRiskStopSnapshot = ({
  entryPrice,
  ltp,
  bestLtp,
  side,
  lotSize,
  forceTightTrail = false,
  trailAlreadyActive = false,
  tightTrailAlreadyActive = false,
}) => {
  const profitPerLot = getPerLotPnl(entryPrice, ltp, side, lotSize);
  if (profitPerLot === null) {
    return null;
  }

  const hardDistance = trailingLossPerLot / lotSize;
  const trailActive = forceTightTrail || trailAlreadyActive || profitPerLot >= trailActivationProfitPerLot;
  const tightTrailActive = trailActive && (forceTightTrail || tightTrailAlreadyActive || profitPerLot >= tightTrailProfitPerLot);
  const trailLossPerLot = tightTrailActive ? tightTrailLossPerLot : normalTrailLossPerLot;
  const trailDistance = trailLossPerLot / lotSize;
  const hardStop = side === 'short'
    ? entryPrice + hardDistance
    : entryPrice - hardDistance;
  const trailStop = trailActive
    ? side === 'short'
      ? bestLtp + trailDistance
      : bestLtp - trailDistance
    : null;
  const stop = trailStop === null
    ? hardStop
    : side === 'short'
      ? Math.min(hardStop, trailStop)
      : Math.max(hardStop, trailStop);

  return {
    profitPerLot,
    hardDistance,
    hardStop,
    trailActive,
    tightTrailActive,
    trailLossPerLot,
    trailDistance,
    trailStop,
    stop,
    mode: trailActive ? tightTrailActive ? 'tight' : 'normal' : 'hard',
  };
};

const getTrailingStateForSymbol = (symbol) => {
  if (!symbol) {
    return null;
  }
  for (const [key, state] of trailingStopState.entries()) {
    if (key.includes(`|${symbol}|`)) {
      return state;
    }
  }
  return null;
};

const formatProfitTrackingText = (state) => {
  if (!state) {
    return 'watching';
  }
  const movePercent = Number.isFinite(state.profitMoveRatio) ? `${(state.profitMoveRatio * 100).toFixed(1)}%` : 'NA';
  const lock = state.profitLockActive ? '🔒 locked' : 'watching';
  const target = state.profitBookLtp === undefined ? '' : ` target ${formatPriceText(state.profitBookLtp)}`;
  const trail = state.profitTrailExitLtp === undefined || state.profitTrailExitLtp === null ? '' : ` trail ${formatPriceText(state.profitTrailExitLtp)}`;
  return `${lock} ${movePercent}${target}${trail}`;
};

const formatTrailingStopText = (state) => {
  if (!state) {
    return 'calculating';
  }
  const stopType = state.trailingActive ? 'trailing' : 'hard max';
  const stop = formatPriceText(state.stopLtp);
  const best = formatPriceText(state.bestLtp);
  return `${stopType} @${stop} best ${best}`;
};

const logProfitMonitorState = (position, state, event = 'check') => {
  const now = Date.now();
  const shouldLog = event !== 'check' || !state.lastProfitLogAt || now - state.lastProfitLogAt >= profitMonitorLogIntervalMs;
  if (!shouldLog) {
    return;
  }
  state.lastProfitLogAt = now;
  const payload = {
    event,
    timeIST: moment().utcOffset('+05:30').format('YYYY-MM-DD HH:mm:ss'),
    symbol: position?.tsym,
    side: state.side,
    optionType: identify_option_type(position?.tsym),
    entry: state.entryPrice,
    ltp: state.lastLtp,
    bestLtp: state.bestLtp,
    profitMovePct: Number.isFinite(state.profitMoveRatio) ? Number((state.profitMoveRatio * 100).toFixed(2)) : null,
    profitPerLot: Number.isFinite(state.profitPerLot) ? Number(state.profitPerLot.toFixed(2)) : null,
    profitLockActive: Boolean(state.profitLockActive),
    trailingActive: Boolean(state.trailingActive),
    tightTrailActive: Boolean(state.tightTrailActive),
    trailMode: state.trailMode,
    trailLossPerLot: state.trailLossPerLot,
    lockStartLtp: state.profitLockStartLtp,
    profitBookLtp: state.profitBookLtp,
    profitTrailExitLtp: state.profitTrailExitLtp,
    emaGap: state.emaGap,
    emaGapAgeSec: Number.isFinite(state.emaGapAgeMs) ? Number((state.emaGapAgeMs / 1000).toFixed(1)) : null,
    openPnl: Number.isFinite(state.openPnl) ? Number(state.openPnl.toFixed(2)) : null,
    stopLtp: state.stopLtp,
    inEveningPause: Boolean(state.inEveningPause),
  };
  console.log(`NAT_EMA_PROFIT_MONITOR ${JSON.stringify(payload)}`);
};

const resetLocalPositionState = (symbol) => {
  if (!symbol || positionTakenInSymbol === symbol) {
    positionTaken = false;
    positionTakenInSymbol = '';
    positionDirection = '';
    positionEntryPrice = null;
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
  positionEntryPrice = getPositionEntryPrice(primaryPosition);
  if (positionEntryPrice !== null) {
    prevSellPrice = positionEntryPrice;
  }
  return positions;
};

const resolveEntryPriceForSymbol = async (symbol = positionTakenInSymbol) => {
  if (!symbol) {
    return null;
  }

  const currentEntryPrice = toFiniteNumber(positionEntryPrice);
  if (currentEntryPrice !== null && positionTakenInSymbol === symbol) {
    return currentEntryPrice;
  }

  const positions = await getOpenStrategyPositions();
  clearClosedTrailingStops(positions);
  const matchingPosition = positions.find(position => position.tsym === symbol && Number(position.netqty) !== 0);
  const liveEntryPrice = matchingPosition ? getPositionEntryPrice(matchingPosition) : null;
  if (liveEntryPrice !== null) {
    positionEntryPrice = liveEntryPrice;
    prevSellPrice = liveEntryPrice;
    return liveEntryPrice;
  }

  const previousSellPrice = toFiniteNumber(prevSellPrice);
  return previousSellPrice !== null && previousSellPrice > 0 ? previousSellPrice : null;
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
  let lastOrderStatus = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await delay(2000);
    const orderStatus = await getOrderStatus(orderno);
    lastOrderStatus = orderStatus || lastOrderStatus;
    if (isRejectedOrderStatus(orderStatus)) {
      console.error(`Exit order rejected for ${positionKey(position)}: ${orderStatus.rejreason || ''}`);
      return { confirmed: false, orderStatus };
    }
    if (!(await isPositionStillOpen(position))) {
      return { confirmed: true, orderStatus };
    }
  }
  console.error(`Exit order not confirmed for ${positionKey(position)} after waiting.`);
  return { confirmed: false, orderStatus: lastOrderStatus || await getOrderStatus(orderno) };
};

const pauseForManualReview = async (reason, data) => {
  manualInterventionRequired = true;
  orderPlacementPausedForManualReview = true;
  const summary = data ? JSON.stringify(apiResponseSummary(data)) : '';
  console.error(`${reason}${summary ? `: ${summary}` : ''}`);
  buffer_notification(formatNatMessage('🚨 MANUAL REVIEW', [
    ['Reason', reason],
    ['Action', 'All new NAT EMA order placement paused'],
    ['Check', 'Verify live positions and orderbook manually'],
    ['Detail', summary],
  ]), true);
  await syncPositionStateFromLive();
};

const placeExitOrderForPosition = async (position, reason) => {
  if (orderPlacementPausedForManualReview) {
    console.log('Skipping NAT EMA exit; manual intervention required after prior order issue.');
    return false;
  }

  const key = positionKey(position);
  if (exitOrdersInProgress.has(key)) {
    return false;
  }

  const netQty = Number(position?.netqty);
  const absQty = Math.abs(netQty);
  const ltp = await getPositionLtp(position, true);
  if (!Number.isFinite(netQty) || absQty === 0 || ltp === null) {
    await pauseForManualReview(`Cannot exit ${key}: invalid qty/ltp`, position);
    return false;
  }

  const buyOrSell = netQty < 0 ? 'B' : 'S';
  const exitPrice = getLimitPriceFromLtp(ltp, buyOrSell);
  if (exitPrice === null) {
    await pauseForManualReview(`Cannot exit ${key}: unable to calculate safe ${buyOrSell} price`, { ltp });
    return false;
  }
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
    if (response?.stat !== 'Ok') {
      exitOrdersInProgress.delete(key);
      await pauseForManualReview(`Exit order failed for ${key}`, response);
      return false;
    }
    if (!response.norenordno) {
      exitOrdersInProgress.delete(key);
      await pauseForManualReview(`Exit order missing order number for ${key}`, response);
      return false;
    }

    const confirmation = await waitForExitConfirmation(position, response.norenordno);
    if (confirmation.confirmed) {
      const pnlAfterExit = await calcPnL(api, true);
      buffer_notification(formatExitOrderMessage({
        reason,
        symbol: position.tsym,
        side: buyOrSell,
        qty: absQty,
        price: getOrderFilledPrice(confirmation.orderStatus) ?? exitPrice,
        ltp,
        entry: getPositionEntryPrice(position),
        pnl: pnlAfterExit,
      }), true);
      resetLocalPositionState(position.tsym);
      trailingStopState.delete(key);
      exitOrdersInProgress.delete(key);
      return true;
    }

    exitOrdersInProgress.delete(key);
    await pauseForManualReview(`Exit order not confirmed for ${key}`, confirmation.orderStatus || response);
    await syncPositionStateFromLive();
    return false;
  } catch (error) {
    exitOrdersInProgress.delete(key);
    await pauseForManualReview(`Exit order exception for ${key}`, error);
    await syncPositionStateFromLive();
    return false;
  }
};

const exitOpenStrategyPositions = async (reason) => {
  if (orderPlacementPausedForManualReview) {
    console.log(`Skipping NAT EMA exit-all for ${reason}; manual intervention required after prior order issue.`);
    return false;
  }

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

const waitForEntryConfirmation = async (symbol, orderno) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    await delay(2000);
    const orderStatus = await getOrderStatus(orderno);
    const statusText = getOrderStatusText(orderStatus);
    if (isRejectedOrderStatus(orderStatus)) {
      console.error(`Entry order rejected for ${symbol}: ${orderStatus?.rejreason || ''}`);
      return { confirmed: false, orderStatus };
    }

    const positions = await getOpenStrategyPositions();
    clearClosedTrailingStops(positions);
    const openPosition = positions.find(position => position.tsym === symbol && Number(position.netqty) !== 0);
    if (statusText === 'COMPLETE' && openPosition) {
      return { confirmed: true, orderStatus, position: openPosition };
    }
  }

  console.error(`Entry order not confirmed COMPLETE for ${symbol} after waiting.`);
  return { confirmed: false, orderStatus: await getOrderStatus(orderno) };
};

const pauseNewEntriesForManualReview = async (reason, data) => {
  manualInterventionRequired = true;
  const summary = data ? JSON.stringify(apiResponseSummary(data)) : '';
  console.error(`${reason}${summary ? `: ${summary}` : ''}`);
  buffer_notification(formatNatMessage('🚨 ENTRY PAUSED', [
    ['Reason', reason],
    ['Action', 'New NAT EMA entries paused'],
    ['Risk', 'Existing exits and risk controls remain active'],
    ['Detail', summary],
  ]), true);
  await syncPositionStateFromLive();
};

const placeEntryOrderAndConfirm = async (symbol, direction, reason, emaGap) => {
  if (manualInterventionRequired) {
    console.log('Skipping NAT EMA entry; manual intervention required after prior order issue.');
    return false;
  }
  if (entryOrderInProgress) {
    console.log('Skipping NAT EMA entry; another entry order is still being confirmed.');
    return false;
  }
  if (!symbol) {
    console.error(`Cannot place NAT EMA entry for ${reason}: missing symbol.`);
    return false;
  }

  entryOrderInProgress = true;
  try {
    const existingPositions = await syncPositionStateFromLive();
    if (existingPositions.length > 0) {
      console.log(`Skipping NAT EMA entry for ${symbol}; live position already exists.`);
      return false;
    }

    const ltp = await getSymbolLtp(symbol, true);
    if (ltp === null) {
      await pauseNewEntriesForManualReview(`Cannot place NAT EMA entry for ${symbol}: missing LTP`);
      return false;
    }

    const buyOrSell = swapSide('S');
    const entryPrice = getLimitPriceFromLtp(ltp, buyOrSell);
    if (entryPrice === null) {
      await pauseNewEntriesForManualReview(`Cannot place NAT EMA entry for ${symbol}: unable to calculate safe ${buyOrSell} price`, { ltp });
      return false;
    }
    const quantity = (Number(globalInput.LotSize || 1250) * Number(globalInput.emaLotMultiplier || 1)).toString();
    const order = {
      buy_or_sell: buyOrSell,
      product_type: 'M',
      exchange: 'MCX',
      tradingsymbol: symbol,
      quantity,
      discloseqty: quantity,
      price_type: 'LMT',
      price: entryPrice.toFixed(2),
      remarks: 'NatEmaEntry',
    };

    const response = await api.place_order(order);
    console.log(response, `:${reason} entry order`, symbol, quantity, buyOrSell, entryPrice.toFixed(2));
    buffer_notification(formatEntryOrderMessage({
      reason,
      symbol,
      side: buyOrSell,
      qty: quantity,
      price: entryPrice,
      ltp,
      direction,
      emaGap,
    }), true);
    if (response?.stat !== 'Ok') {
      await pauseNewEntriesForManualReview(`NAT EMA entry order failed for ${symbol}`, response);
      return false;
    }
    if (!response.norenordno) {
      await pauseNewEntriesForManualReview(`NAT EMA entry order missing order number for ${symbol}`, response);
      return false;
    }

    const confirmation = await waitForEntryConfirmation(symbol, response.norenordno);
    if (!confirmation.confirmed) {
      await pauseNewEntriesForManualReview(`NAT EMA entry order not confirmed COMPLETE for ${symbol}`, confirmation.orderStatus || response);
      return false;
    }

    let confirmedEntryPrice = getPositionEntryPrice(confirmation.position) ?? getOrderFilledPrice(confirmation.orderStatus);
    positionTaken = true;
    positionTakenInSymbol = confirmation.position.tsym;
    positionDirection = direction;
    positionEntryPrice = confirmedEntryPrice;
    if (confirmedEntryPrice !== null) {
      prevSellPrice = confirmedEntryPrice;
    }
    confirmedEntryPrice = await resolveEntryPriceForSymbol(confirmation.position.tsym);
    if (confirmedEntryPrice === null) {
      await pauseNewEntriesForManualReview(`NAT EMA entry price unresolved after COMPLETE for ${symbol}`, confirmation.orderStatus || response);
      return false;
    }
    clearClosedTrailingStops([confirmation.position]);
    buffer_notification(formatNatMessage('✅ ENTRY CONFIRMED', [
      ['Position', formatNatPositionText(direction, emaGap)],
      ['Gap', emaGap === undefined ? undefined : formatCompactEmaGapText(emaGap)],
      ['Risk', formatNatRiskLine({
        symbol,
        sell: confirmedEntryPrice,
        trail: 'pending',
        ltp: confirmedEntryPrice,
        side: 'short',
        pending: true,
      })],
    ]), true);
    return true;
  } catch (error) {
    await pauseNewEntriesForManualReview(`NAT EMA entry exception for ${symbol}`, error);
    return false;
  } finally {
    entryOrderInProgress = false;
  }
};

const stopNatEmaPm2Process = () => {
  const pm2Command = process.env.PM2_BIN || (fs.existsSync('/usr/bin/pm2') ? '/usr/bin/pm2' : 'pm2');
  try {
    const child = spawn(pm2Command, ['stop', natEmaPm2ProcessName], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      console.error(`PM2 stop command failed for ${natEmaPm2ProcessName}:`, error.message);
    });
    child.unref();
    console.log(`Requested PM2 stop for ${natEmaPm2ProcessName} using ${pm2Command}.`);
  } catch (error) {
    console.error(`Unable to request PM2 stop for ${natEmaPm2ProcessName}:`, error.message);
  }

  setTimeout(() => process.exit(0), 10000).unref();
};

const runNightShutdownIfDue = async () => {
  if (!isNightShutdownDue() || nightShutdownInProgress) {
    return false;
  }

  nightShutdownInProgress = true;
  try {
    buffer_notification(formatNatMessage('🌙 NIGHT SHUTDOWN', [
      ['Time', '23:17 IST cutoff reached'],
      ['Action', 'Exit positions and stop nat_ema2'],
    ]), true);
    await exitOpenStrategyPositions('23:17 IST shutdown');
    await bufferPaperStrategySummarySafely('23:17 IST shutdown');

    const remainingPositions = await getOpenStrategyPositions();
    clearClosedTrailingStops(remainingPositions);
    if (remainingPositions.length > 0) {
      const symbols = remainingPositions.map(position => position.tsym).filter(Boolean).join(', ');
      buffer_notification(formatNatMessage('⚠️ NIGHT RETRY NEEDED', [
        ['Open Positions', remainingPositions.length],
        ['Symbols', symbols || 'NA'],
      ]), true);
      await flush_notifications();
      nightShutdownInProgress = false;
      return true;
    }

    resetLocalPositionState();
    buffer_notification(formatNatMessage('✅ NIGHT SHUTDOWN COMPLETE', [
      ['Positions', 'none open'],
      ['Action', 'Stopping nat_ema2 PM2 process'],
    ]), true);
    await flush_notifications();
    stopNatEmaPm2Process();
    return true;
  } catch (error) {
    console.error('Error during 23:17 IST shutdown:', error.message || JSON.stringify(apiResponseSummary(error)));
    buffer_notification(formatNatMessage('🚨 NIGHT SHUTDOWN ERROR', [
      ['Error', error.message || JSON.stringify(apiResponseSummary(error))],
    ]), true);
    await flush_notifications();
    nightShutdownInProgress = false;
    return true;
  }
};

let trailingMonitorInProgress = false;
const monitorTrailingLoss = async () => {
  if (trailingMonitorInProgress) {
    return false;
  }
  if (orderPlacementPausedForManualReview) {
    console.log('Skipping NAT EMA trailing/profit monitor; manual intervention required after prior order issue.');
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
      const ltp = await getPositionLtp(position, true);
      if (!Number.isFinite(netQty) || !Number.isFinite(absQty) || entryPrice === null || ltp === null) {
        console.error(`Skipping trailing loss check for ${key}: invalid position data.`);
        continue;
      }

      const side = netQty < 0 ? 'short' : 'long';
      const existing = trailingStopState.get(key);
      const state = existing && existing.side === side && existing.entryPrice === entryPrice
        ? existing
        : { side, entryPrice, bestLtp: entryPrice, trailingActive: false };
      const lots = absQty / lotSize;
      const maxLoss = trailingLossPerLot * lots;
      const emaSnapshot = getLatestEmaSnapshot();
      const profitMoveRatio = getProfitMoveRatio(entryPrice, ltp, side);
      const forceTightTrail = isEveningNoEntryWindow();
      const previousTrailingActive = Boolean(state.trailingActive);
      const previousTightTrailActive = Boolean(state.tightTrailActive);

      state.lastLtp = ltp;
      state.profitMoveRatio = profitMoveRatio;
      state.profitLockStartLtp = side === 'short'
        ? entryPrice - (trailActivationProfitPerLot / lotSize)
        : entryPrice + (trailActivationProfitPerLot / lotSize);
      state.profitBookLtp = null;
      state.emaGap = emaSnapshot.gap;
      state.emaGapAgeMs = emaSnapshot.ageMs;
      state.inEveningPause = forceTightTrail;

      if (side === 'short') {
        state.bestLtp = Math.min(state.bestLtp, ltp);
        state.openPnl = (entryPrice - ltp) * absQty;
      } else {
        state.bestLtp = Math.max(state.bestLtp, ltp);
        state.openPnl = (ltp - entryPrice) * absQty;
      }

      const riskSnapshot = getRiskStopSnapshot({
        entryPrice,
        ltp,
        bestLtp: state.bestLtp,
        side,
        lotSize,
        forceTightTrail,
        trailAlreadyActive: previousTrailingActive,
        tightTrailAlreadyActive: previousTightTrailActive,
      });
      if (!riskSnapshot) {
        console.error(`Skipping trailing loss check for ${key}: unable to calculate risk snapshot.`);
        continue;
      }

      state.hardStopLtp = riskSnapshot.hardStop;
      state.trailingActive = riskSnapshot.trailActive;
      state.tightTrailActive = riskSnapshot.tightTrailActive;
      state.trailingStopLtp = riskSnapshot.trailStop;
      state.stopLtp = riskSnapshot.stop;
      state.stopDistance = riskSnapshot.trailActive ? riskSnapshot.trailDistance : riskSnapshot.hardDistance;
      state.profitTrailExitLtp = riskSnapshot.trailStop;
      state.profitTrailBounceDistance = riskSnapshot.trailActive ? riskSnapshot.trailDistance : null;
      state.profitPerLot = riskSnapshot.profitPerLot;
      state.trailLossPerLot = riskSnapshot.trailLossPerLot;
      state.trailMode = riskSnapshot.mode;
      state.profitLockActive = riskSnapshot.trailActive;
      if (riskSnapshot.trailActive && !previousTrailingActive) {
        state.profitLockActivatedAt = Date.now();
        buffer_notification(formatNatMessage('🔒 TRAIL ON', [
          ['Position', formatNatPositionText(identify_option_type(position.tsym) === 'P' ? 'long' : 'short')],
          ['Risk', formatNatRiskLine({
            symbol: position.tsym,
            sell: entryPrice,
            trail: formatCompactTrailLabel(state),
            ltp,
            side,
          })],
          ['Mode', riskSnapshot.tightTrailActive ? 'tight' : 'normal'],
        ]), true);
        logProfitMonitorState(position, state, 'trail_started');
      } else if (riskSnapshot.tightTrailActive && !previousTightTrailActive) {
        buffer_notification(formatNatMessage('🔐 TIGHT TRAIL', [
          ['Risk', formatNatRiskLine({
            symbol: position.tsym,
            sell: entryPrice,
            trail: formatCompactTrailLabel(state),
            ltp,
            side,
          })],
          ['Reason', forceTightTrail ? 'pause window' : `profit >= Rs ${tightTrailProfitPerLot}/lot`],
        ]), true);
        logProfitMonitorState(position, state, 'tight_trail_started');
      }

      const stopHit = side === 'short' ? ltp >= state.stopLtp : ltp <= state.stopLtp;
      if (stopHit) {
        const stopType = state.trailingActive
          ? state.tightTrailActive ? 'Tight trailing SL' : 'Trailing SL'
          : 'Hard max loss';
        const exitConfirmed = await placeExitOrderForPosition(
          position,
          `${stopType} hit stop ${state.stopLtp.toFixed(2)} ltp ${ltp.toFixed(2)}`
        );
        logProfitMonitorState(position, state, exitConfirmed ? `${riskSnapshot.mode}_trail_exit_confirmed` : `${riskSnapshot.mode}_trail_exit_failed`);
        if (exitConfirmed) {
          startReentryCooldown(`${stopType.toLowerCase()} exit for ${position.tsym}`);
        }
        exited = exitConfirmed || exited;
        continue;
      }

      state.lots = lots;
      state.maxLoss = maxLoss;
      logProfitMonitorState(position, state);
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
postOrderPosTracking = async (data) => {
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
    const fillPrice = toFiniteNumber(data?.flprc ?? data?.avgprc ?? data?.rprc);
    if (fillPrice !== null) {
      prevSellPrice = fillPrice;
      positionEntryPrice = fillPrice;
    }
    // console.log('prevSellPrice updated to:', prevSellPrice);
    //console last 6 digits of tsym 
    // console.log('data.tsym', data.tsym.substring(data.tsym.length - 6));
  } else {
    const suffix = data?.tsym ? data.tsym.substring(data.tsym.length - 4) : 'NAT';
    const buyPrice = toFiniteNumber(data?.flprc ?? data?.avgprc ?? data?.rprc);
    const sellPrice = await resolveEntryPriceForSymbol(data?.tsym || positionTakenInSymbol);
    if (sellPrice === null || buyPrice === null) {
      console.error(`Suppressing NAT EMA completion notification; unresolved prices for ${data?.tsym || positionTakenInSymbol}.`, JSON.stringify(apiResponseSummary(data)));
      buffer_notification(`NAT EMA completion price unresolved for ${data?.tsym || positionTakenInSymbol}; check orderbook before new entry.`, true);
      return;
    }
    const completionMessage = formatNatMessage('✅ ORDER COMPLETE', [
      ['Risk', formatNatRiskLine({
        symbol: suffix,
        sell: sellPrice,
        trail: formatPriceText(buyPrice),
        ltp: buyPrice,
        side: 'short',
      })],
      ['Time', new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })],
    ]);
    buffer_notification(completionMessage, true)
    buffer_notification(completionMessage)
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
  if (getOrderStatusText(data) === 'REJECTED') {
    if (!isStrategyOrderEvent(data)) {
      console.log('Ignoring rejected non-NAT EMA order event:', JSON.stringify(apiResponseSummary(data)));
      return;
    }
    pauseNewEntriesForManualReview('NAT EMA order rejected from websocket', data)
      .catch(error => console.error('Error handling rejected order:', error.message || JSON.stringify(apiResponseSummary(error))));
    return;
    // exitSellsAndOrStop(true);
  }
  if (getOrderStatusText(data) === 'COMPLETE') {
    if (!isStrategyOrderEvent(data)) {
      console.log('Ignoring complete non-NAT EMA order event:', JSON.stringify(apiResponseSummary(data)));
      return;
    }
    latestOrders[data.Instrument] = data;
    // update the smallest positions after each order
    postOrderPosTracking(data)
      .catch(error => console.error('Error tracking completed order:', error.message || JSON.stringify(apiResponseSummary(error))));
  }
}

function open(data) {
  // console.log(`NSE|${globalInput.token}`)
  console.log('ws open ack:', JSON.stringify(apiResponseSummary(data)));
  if (data?.s && data.s !== 'OK') {
    websocketReady = false;
    websocket_closed = true;
    buffer_notification(formatNatMessage('⚠️ WEBSOCKET', [
      ['Status', 'auth failed'],
      ['Fallback', 'REST polling'],
      ['Detail', JSON.stringify(apiResponseSummary(data))],
    ]), true);
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
  await pauseForManualReview(`Retired NAT EMA legacy takeAction path invoked (${goingUp ? 'up' : 'down'}); no order placed`);
  return false;
  return false;
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
    price: 'RETIRED_UNSAFE_PATH',
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
    price: 'RETIRED_UNSAFE_PATH',
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
    price: 'RETIRED_UNSAFE_PATH',
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
    price: 'RETIRED_UNSAFE_PATH',
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
    price: 'RETIRED_UNSAFE_PATH',
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
    price: 'RETIRED_UNSAFE_PATH',
    remarks: 'WSNewOrderSubmissivePEEntryAPI'
  }

  if (goingUp && !telegramSignals.stopSignal && !debug) {
    await retiredUnsafeOrderPath('takeAction(orderCE)', orderCE.tradingsymbol, orderCE.quantity);
    biasProcess.vix > 0
      ? await retiredUnsafeOrderPath('takeAction(orderSubmissiveCE)', orderSubmissiveCE.tradingsymbol, orderSubmissiveCE.quantity)
      : await retiredUnsafeOrderPath('takeAction(orderAggressiveCE)', orderAggressiveCE.tradingsymbol, orderAggressiveCE.quantity);
  } else if (!goingUp && !telegramSignals.stopSignal && !debug) {
    await retiredUnsafeOrderPath('takeAction(orderPE)', orderPE.tradingsymbol, orderPE.quantity);
    biasProcess.vix > 0
      ? await retiredUnsafeOrderPath('takeAction(orderSubmissivePE)', orderSubmissivePE.tradingsymbol, orderSubmissivePE.quantity)
      : await retiredUnsafeOrderPath('takeAction(orderAggressivePE)', orderAggressivePE.tradingsymbol, orderAggressivePE.quantity);
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

const retiredUnsafeOrderPath = async (helperName, symbol, qty) => {
  await pauseForManualReview(
    `Retired NAT EMA unsafe helper ${helperName} invoked; no order placed`,
    { symbol, qty }
  );
  return null;
};

const long = async (symbol, qty) => retiredUnsafeOrderPath('long()', symbol, qty);
const short = async (symbol, qty) => retiredUnsafeOrderPath('short()', symbol, qty);



let positionTaken = false;
// let callPreviousValue = false;
let positionTakenInSymbol = '';
let positionEntryPrice = null;
let entryOrderInProgress = false;
let manualInterventionRequired = false;
let orderPlacementPausedForManualReview = false;

let prevEma9LessThanEma21 = ''
let crossedUp = ''
let firsttime = false;
async function sellercrudecheckCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy sellercrudecheckCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
}
let positionDirection = '';
async function XEma(fastEMA, slowEMA) {
  const diff = fastEMA - slowEMA;
  updateLatestEmaSnapshot(fastEMA, slowEMA);
  await syncPositionStateFromLive();

  if (!positionTaken) {
    if (isReentryCooldownActive()) {
      console.log(`Skipping NAT EMA entry; re-entry cooldown active until ${formatISTTime(reentryBlockedUntil)} IST.`);
      return;
    }

    // Sell PUT when the futures EMA gap is meaningfully positive.
    if (diff > emaGapSignalThreshold) {
      buffer_notification(formatNatMessage('📈 SIGNAL', [
        ['Action', 'SELL PUT'],
        ['Position', formatNatPositionText('long', diff)],
        ['Gap', formatCompactEmaGapText(diff)],
      ]));
      await placeEntryOrderAndConfirm(biasProcess.atmPutSymbol, 'long', 'SELL PUT', diff);
    }
    // Sell CALL when the futures EMA gap is meaningfully negative.
    else if (diff < -emaGapSignalThreshold) {
      buffer_notification(formatNatMessage('📉 SIGNAL', [
        ['Action', 'SELL CALL'],
        ['Position', formatNatPositionText('short', diff)],
        ['Gap', formatCompactEmaGapText(diff)],
      ]));
      await placeEntryOrderAndConfirm(biasProcess.atmCallSymbol, 'short', 'SELL CALL', diff);
    }
  } else if (positionTaken) {
    // Buy PUT when the positive futures EMA gap collapses.
    if (positionDirection == 'long' && (diff <= emaGapSignalThreshold)) {
      buffer_notification(formatNatMessage('🔄 EXIT SIGNAL', [
        ['Action', 'BUY PUT'],
        ['Reason', 'EMA gap crossed back'],
        ['Position', formatNatPositionText(positionDirection, diff)],
        ['Gap', formatCompactEmaGapText(diff)],
      ]));
      await exitOpenStrategyPositions('EMA PUT exit');
      await syncPositionStateFromLive();
      return;
    }
    // Buy CALL when the negative futures EMA gap collapses.
    else if (positionDirection == 'short' && (diff >= -emaGapSignalThreshold)) {
      buffer_notification(formatNatMessage('🔄 EXIT SIGNAL', [
        ['Action', 'BUY CALL'],
        ['Reason', 'EMA gap crossed back'],
        ['Position', formatNatPositionText(positionDirection, diff)],
        ['Gap', formatCompactEmaGapText(diff)],
      ]));
      await exitOpenStrategyPositions('EMA CALL exit');
      await syncPositionStateFromLive();
      return;
    }
  }
  if (positionTaken) {
    positionTakenInSymbolSubStr = positionTakenInSymbol.substring(positionTakenInSymbol.length - 4);
    const displayEntryPrice = await resolveEntryPriceForSymbol(positionTakenInSymbol);
    if (displayEntryPrice === null) {
      console.error(`Suppressing NAT EMA position notification; unresolved entry price for ${positionTakenInSymbol}.`);
      buffer_notification(`NAT EMA entry price unresolved for ${positionTakenInSymbol}; suppressing S@ status until live position price is available.`, true);
      return;
    }
    const pnl = await calcPnL(api, true);
    const displayLtp = await getSymbolLtp(positionTakenInSymbol, true);
    const profitState = getTrailingStateForSymbol(positionTakenInSymbol);
    positionTakenInSymbol && buffer_notification(formatNatMessage(formatNatPositionText(positionDirection, diff), [
      ['Mood', formatPnlText(pnl)],
      ['Risk', formatNatRiskLine({
        symbol: positionTakenInSymbolSubStr,
        sell: displayEntryPrice,
        trail: formatCompactTrailLabel(profitState),
        ltp: displayLtp,
        side: profitState?.side || 'short',
        pending: !profitState,
      })],
      ['Lock', formatProfitLockLine(profitState)],
    ]));
    console.log("Current Time:", moment().utcOffset("+05:30").format('HH:mm:ss'));
  } else {
    const pnl = await calcPnL(api, true);
    console.log(`No position taken. ${getCollateralLabel()} MCX PnL: ${pnl} % Current Time:`, moment().utcOffset("+05:30").format('HH:mm:ss'));
    buffer_notification(formatNatMessage(formatNatPositionText('', diff), [
      ['Mood', formatPnlText(pnl)],
    ]));
  }
}

async function crudecheckCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy crudecheckCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
}
async function checkCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy checkCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
}

async function sellercheckCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy sellercheckCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
}

let putpositionTaken = false;
let putPreviousValue = false;
let putpositionTakenInSymbol = '';

async function putcheckCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy putcheckCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
}


async function sellerputcheckCrossOverExit(ema9, ema21) {
  await pauseForManualReview('Retired NAT EMA legacy sellerputcheckCrossOverExit path invoked; no order placed', { ema9, ema21 });
  return false;
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
        const underlyingLtp = await getUnderlyingLtp(true);
        buffer_notification(formatNatMessage('📊 EMA CHECK', [
          ['Spot', `${globalInput.indexName} @${formatPriceText(underlyingLtp)}`],
          ['Gap', formatCompactEmaGapText(fastEMA - slowEMA)],
        ]));
        await XEma(fastEMA, slowEMA);
        await runPaperStrategyTickSafely();
        bufferMinuteDivider();
      } else {
        const [callema9, callema21] = await ema9and21ValuesIndicators(params); //call
        if (toFiniteNumber(callema9) === null || toFiniteNumber(callema21) === null) {
          console.log(`Skipping EMA tick: invalid TPSeries data for ${params.exchange}|${params.token}.`);
          return;
        }
        // const [putema9, putema21] = await ema9and21Values(params2); //put

        const underlyingLtp = await getUnderlyingLtp(true);
        buffer_notification(formatNatMessage('📊 EMA CHECK', [
          ['Spot', `${globalInput.indexName} @${formatPriceText(underlyingLtp)}`],
          ['Gap', formatCompactEmaGapText(callema9 - callema21)],
        ]));
        // console.log(putSymbolForEma,  ': ltp: ', +latestQuotes[`${globalInput.pickedExchange}|${getTokenByTradingSymbol(putSymbolForEma)}`]?.lp , ' : putema9, putema21. input for position', putema9, putema21)

        //send notification

        // //buyer
        await sellercrudecheckCrossOverExit(callema9, callema21)
        bufferMinuteDivider();
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
  if (await runNightShutdownIfDue()) {
    return;
  }

  if (isEveningNoEntryWindow()) {
    if (seconds % trailingMonitorIntervalSeconds === 0 && !eveningExitInProgress) {
      eveningExitInProgress = true;
      try {
        await monitorTrailingLoss();
      } catch (error) {
        console.error('Error enforcing evening no-entry window trailing monitor:', error.message || JSON.stringify(apiResponseSummary(error)));
      } finally {
        eveningExitInProgress = false;
      }
    }
    if (Date.now() - lastEveningPauseNoticeAt >= 180000) {
      lastEveningPauseNoticeAt = Date.now();
      buffer_notification(formatNatMessage('⏸ PAUSE', [
        ['Window', '18:25-21:25 IST weekday'],
        ['Mode', 'no fresh entry, tight trail active'],
      ]), true);
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
        buffer_notification(formatNatMessage('🚨 PNL THRESHOLD', [
          ['Mood', formatPnlText(pnl)],
          ['PnL', formatPnlPercent(pnl)],
          ['Action', 'Exiting all positions'],
        ]));
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
    const exitAllOnce = process.argv.includes('--exit-all');
    await expiryLoadedPromise;
    await executeLogin();
    await setNearestCrudeFutureToken();
    await send_callback_notification();
    await updateITMSymbolfromOC();
    if (exitAllOnce) {
      const exited = await exitOpenStrategyPositions('Manual NAT EMA restart exit');
      if (!exited) {
        console.log('No open NAT EMA positions found for manual exit.');
      }
      await flush_notifications();
      process.exit(0);
    }
    subscribeToInstruments([`${globalInput.pickedExchange}|${globalInput.token}`, 'NSE|26017']);
    const websocketAuthenticated = await startWebsocket();
    startRestQuotePolling();
    if (!websocketAuthenticated) {
      console.log('Running nat_ema2 with REST quote polling fallback.');
    }
    await refreshRestQuotes();
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
