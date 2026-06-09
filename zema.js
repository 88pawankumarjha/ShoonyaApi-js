const fs = require('fs');
let calcVWAP;
function updateCalcVWAPFromFile() {
  try {
    calcVWAP = parseFloat(
      fs.readFileSync('C:/Users/88paw/OneDrive/Documents/aws/vwapValue2.txt', 'utf-8').trim()
    );
  } catch (e) {
    console.error('### Could not read VWAP value from file, using default.');
    calcVWAP = 24875; // fallback value
  }
}
updateCalcVWAPFromFile();
setInterval(updateCalcVWAPFromFile, 60000);

const debug = false;
const pnlThreshold = -0.75; // 0.75% PnL threshold for exit
const pnlUpThreshold = 0.5; // 0.5% PnL threshold for exit
const hardMaxLossPerLotRs = 2000;
const trailingSLPerLotRs = 800;
const trailingSLActivationDecay = 0.20;
const riskMonitorIntervalSeconds = 5;
const riskRestQuoteRefreshMs = 60 * 1000;
const riskLiveQuoteMaxAgeMs = 10 * 1000;
const riskMissingLtpWarningMs = 60 * 1000;
const riskOrderbookRefreshMs = 15 * 1000;
const orderStatusPollMs = 1000;
const orderStatusMaxAttempts = 15;
const orderPriceSlippageRatio = 0.02;
const orderPriceSlippageMax = 5;
const orderTickSize = 0.05;
const smallAccountQty = [65, 65, 65, 65, 65, 65, 65];
const bigAccountQty = [195, 195, 195, 195, 195, 195, 195];
const smallAccountDailyQty = 65;
const bigAccountDailyQty = 130;
const smallAccountLot = [1, 1, 1, 1, 1, 1, 1];
const bigAccountLot = [3, 3, 3, 3, 3, 3, 3];
const indexDayArray = ['NIFTY', 'NIFTY', 'NIFTY', 'NIFTY', 'NIFTY', 'NIFTY', 'NIFTY']; //sunday to saturday
let biasCalcFlag = false;
let pnlMood = 'neutral';

const today = new Date();
let isExpiryToday = today.getDay() === 1 || today.getDay() === 2; //1 for monday and 2 for tuesday

function isWeekend() {
  return false; // used to set the positions to ITM
}

const axios = require('axios');
const unzipper = require('unzipper');

const https = require('https');
const AdmZip = require('adm-zip');

const { parse } = require('papaparse');
const moment = require('moment');
const { idxNameTokenMap, idxNameOcGap, downloadCsv, filterAndMapDates, 
  identify_option_type, fetchSpotPrice, getStrike, getOptionBasedOnNearestPremium, calcPnL, isTimeEqualsNotAfterProps } = require('./utils/customLibrary');
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(telegramBotToken, { polling: true });
const send_notification = async (message, me = false) => (message && console.log(message)) || (!debug && message && await bot.sendMessage((me && !telegramSignals.stopSignal) ? chat_id_me : chat_id, (me && !telegramSignals.stopSignal) ? message : message.replace(/\) /g, ")\n")).catch(console.error));

let globalBigInput = {
  filteredIndexCSV: undefined
}
//TODO change index
 getPickedIndexHere = () => debug ? 'NIFTY' : indexDayArray[new Date().getDay()] || 'NIFTY';
 getEMAQtyFor2L = () => debug ? 65 : [65, 65, 65, 65, 65, 65, 65][new Date().getDay()] || 100; // qty for margin to sell both sides

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
let websocketReady = false;
let websocketAuthFailed = false;
let websocketReconnectTimer;
let intervalId;
let intervalIdForEMA;
const delayForEMA = 1000; 

let latestQuotes = {};
let latestQuotesTimestamps = {}; // Add this map
let latestOrders = {};

let positionProcess = {
  soldPrice: 0,
  soldTsym: '',
  soldToken: '',
  trailPrice: 0,
  smallestCallPosition: undefined, // [{tsym: 'NIFTY07DEC23P20850', lp: '1.55', netqty: '-800', s_prdt_ali: 'MIS'}]
  smallestPutPosition: undefined,
  hedgeCall: undefined,
  hedgePut: undefined,
  posCallSubStr: undefined,
  posPutSubStr: undefined,
  callsNearbyNeighbours: undefined,
  putsNearbyNeighbours: undefined,
  collectedValuesCall: new Map(),
  collectedValuesPut: new Map(),
}

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

function unzipFile(zipFilePath) {
  const zip = new AdmZip(zipFilePath);
  zip.extractAllTo('./', true);
}

async function findNearestExpiry() {
  let csvUrl, zipFilePath, csvFilePath;
  const exchangeType = 'NFO';
  csvUrl = `https://api.shoonya.com/${exchangeType}_symbols.txt.zip`;
  const zipFileUrl = csvUrl;
  // Replace 'downloaded_file.zip' with the desired file name
  const downloadedFileName = 'downloaded_file.zip';
  zipFilePath = `./${exchangeType}_symbols.zip`;
  csvFilePath = `./${exchangeType}_symbols.txt`;
  try {

    downloadFile(zipFileUrl, downloadedFileName)
    .then(() => {
        unzipFile(downloadedFileName);
    })
    .catch(error => {
        console.error('Error:', error);
    });
    await delay(1000);
    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    const { data: symbolDf } = parse(csvData, { header: true });
    
    globalBigInput.filteredIndexCSV = filterAndMapDates(moment, symbolDf.filter((row) => ['OPTIDX', 'FUTIDX'].includes(row.Instrument) && row.TradingSymbol.startsWith(globalInput.indexName) && !row.TradingSymbol.startsWith('NIFTYNXT50') && !row.TradingSymbol.startsWith('SENSEX50') && !row.TradingSymbol.startsWith('ZYDUSLIFE')));

    const expiryList = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => row.Instrument === 'OPTIDX').map((row) => row.Expiry))];
    const expiryFutList = globalBigInput.filteredIndexCSV
      .filter((row) => row.Instrument === 'FUTIDX')
      .map((row) => ({ Exchange: row.Exchange, LotSize: row.LotSize, TradingSymbol: row.TradingSymbol, Expiry: row.Expiry }));
    expiryList.sort();
    expiryFutList.sort((a, b) => moment(a.Expiry).diff(moment(b.Expiry)));
    
    globalInput.inputOptTsym = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => (row.Instrument === 'OPTIDX' && row.Expiry === expiryList[isExpiryToday? 1: 0])).map((row) => row.TradingSymbol))][0];
    globalInput.WEEKLY_EXPIRY = expiryList[isExpiryToday? 1: 0];
    globalInput.MONTHLY_EXPIRY = expiryFutList[0].Expiry;
    globalInput.pickedExchange = expiryFutList[0].Exchange;
    globalInput.LotSize = expiryFutList[0].LotSize;
    globalInput.emaLotMultiplier = Math.floor(globalInput.emaLotMultiplierQty/globalInput.LotSize);
  } catch (error) {
    console.error('Error:', error.message);
  }
};


const Api = require("./lib/RestApi");
let api = new Api({});

let limits;

getEMAQtyForGeneric = () => {
  // return debug ? 100 : 
  // limits?.collateral < 800000 ? 
  // [100, 65, 240, 65, 200, 70, 65][new Date().getDay()] : 
  // [400, 525, 1600, 525, 1050, 490, 525][new Date().getDay()]

  return debug ? 65 : 
  limits?.collateral < 700000 ? 
  smallAccountQty[new Date().getDay()] : 
  bigAccountQty[new Date().getDay()]
  // bnf early expiry
  // [100, 300, 300, 300, 800, 250, 65][new Date().getDay()] : 
  // [100, 600, 720, 720, 1700, 500, 65][new Date().getDay()]
  }

  const getDailyQty = () => {
    // Returns daily quantity (number). Respects debug and limits collateral threshold.
    if (debug) return smallAccountDailyQty;
    return limits?.collateral < 700000 ? smallAccountDailyQty : bigAccountDailyQty;
  }

  getFreezeQty = () => {
    return [500, 500, 500, 1800, 1800, 500, 500][new Date().getDay()]
    // bnf early expiry
    // return [600, 600, 900, 900, 1800, 500, 65][new Date().getDay()]
    }

// Execute the findNearestExpiry function
findNearestExpiry();

const getAtmStrike = async () => {
  // TODO
  // return 50700;
  // console.log(`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}`)
  // console.log(globalInput.token)
  // console.log(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'BSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'MCX'}|${globalInput.token}`]);
  biasProcess.spotObject = latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'NSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'NSE'}|${globalInput.token}`];
  // debug && console.log(biasProcess.spotObject) //updateAtmStrike(s) --> 50, spot object -> s?.lp = 20100
  // console.log(biasOutput.bias, 'biasOutput.bias')
  // send_notification(biasOutput.bias + ' biasOutput.bias');
  const spotLtp = toFiniteNumber(biasProcess.spotObject?.lp);
  const biasValue = toFiniteNumber(biasOutput.bias) ?? 0;
  const atm = spotLtp === null ? null : Math.round((spotLtp + (biasValue !== 0 ? biasValue : 0)) / globalInput.ocGap) * globalInput.ocGap;
  if (atm !== null && !isNaN(atm)) {return atm;}
  else { 
    const Spot = await fetchSpotPrice(api, globalInput.token, globalInput.pickedExchange);
    if (!Spot) { console.log('Not able to find the spot'); return null; }
    // debug && console.log(Spot)
    const fallbackSpotLtp = toFiniteNumber(Spot.lp);
    if (fallbackSpotLtp === null) {
      console.log('Skipping ATM update: missing spot LTP.');
      return null;
    }
    const ltp_rounded = Math.round(fallbackSpotLtp);
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
{ text: '⏸', callback_data: 'isPlayingSignal' }
]]};
!debug && bot.sendMessage(chat_id_me, 'Choose server settings', { reply_markup: keyboard });
} catch (error) { console.error(error);
send_notification(error + ' error occured', true)
}
  }
  bot.on('callback_query', (callbackQuery) => {
const chatId = callbackQuery.message.chat.id;
const data = callbackQuery.data;
if (data === 'isPlayingSignal') {
if(telegramSignals.isPlaying){pauseEma()}
else {resumeEma()}
}
if (data === 'stop') telegramSignals.stopSignal = !telegramSignals.stopSignal;
bot.sendMessage(chatId, `EMA isPlaying: ${telegramSignals.isPlaying}`);
});

// login method
const { spawn } = require('child_process');
const { send } = require('process');
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

const apiResponseSummary = (response) => {
    if (!response || typeof response !== 'object') {
        return response;
    }

    const summary = {};
    ['stat', 'emsg', 'message', 'status', 'request_time', 'norenordno', 'result'].forEach((key) => {
        if (response[key] !== undefined) {
            summary[key] = response[key];
        }
    });
    if (response.data && typeof response.data === 'object') {
        summary.data = apiResponseSummary(response.data);
    }
    return Object.keys(summary).length ? summary : response;
};

const isOrderAccepted = (response) => response && (
    response.stat === 'Ok' ||
    response.norenordno ||
    response.result
);

const isNoPositionsResponse = (response) => response && response.stat === 'Not_Ok' &&
    /no data|no position|no record/i.test(response.emsg || response.message || '');

const shortOptionRiskState = new Map();
const riskExitOrdersInProgress = new Set();
const riskRestQuoteFetchedAt = new Map();
const riskMissingLtpWarnedAt = new Map();
let riskOrderbookCache = [];
let riskOrderbookFetchedAt = 0;

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
        return 'neutral';
    }
    if (numericValue > 0.33) {
        return 'good';
    }
    if (numericValue < -0.33) {
        return 'bad';
    }
    return 'neutral';
};

const formatPnlPercent = (value) => {
    const numericValue = toPnlNumber(value);
    return numericValue === null ? 'NA' : `${numericValue.toFixed(2)}%`;
};

const formatPriceText = (value) => {
    const numericValue = toFiniteNumber(value);
    return numericValue === null ? 'NA' : numericValue.toFixed(2);
};

const getCollateralLabel = () => {
    const label = String(limits?.collateral ?? 'NA').substring(0, 3);
    return label || 'NA';
};

const formatTelegramMessage = (title, rows = []) => [
    `ZEMA | ${title}`,
    ...rows
        .filter(row => row && row[1] !== undefined && row[1] !== null && row[1] !== '')
        .map(([label, value]) => `${label}: ${value}`),
].join('\n');

const formatExitOrderMessage = ({
    reason,
    symbol,
    qty,
    side = 'B',
    price,
    entry,
    ltp,
    stop,
    pnl,
}) => formatTelegramMessage(`EXIT | ${reason}`, [
    ['Symbol', symbol || 'NA'],
    ['Qty', qty || 'NA'],
    ['Order', `${side} @${formatPriceText(price)}`],
    ['Entry', entry === undefined ? undefined : formatPriceText(entry)],
    ['LTP', ltp === undefined ? undefined : formatPriceText(ltp)],
    ['Stop', stop === undefined ? undefined : formatPriceText(stop)],
    ['Mood', getPnlMood(pnl)],
    ['PnL', formatPnlPercent(pnl)],
]);

const getFinalFillPrice = (responses, fallbackPrice) => {
    const finalOrder = Array.isArray(responses) ? responses[responses.length - 1]?.finalOrder : null;
    return toFiniteNumber(finalOrder?.avgprc ?? finalOrder?.flprc ?? finalOrder?.prc) ?? toFiniteNumber(fallbackPrice);
};

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
    const slippage = Math.max(orderTickSize, Math.min(orderPriceSlippageMax, numericLtp * orderPriceSlippageRatio));
    const rawPrice = side === 'B'
        ? numericLtp + slippage
        : numericLtp - slippage;
    return roundOrderPrice(rawPrice, side);
};

const getSafeOrderPriceFromQuote = async (symbol, side) => {
    const token = getTokenByTradingSymbol(symbol);
    if (!symbol || !token) {
        throw new Error(`Cannot price ${side} order: missing token for ${symbol || 'unknown symbol'}`);
    }

    const quote = await api.get_quotes(globalInput.pickedExchange, token);
    const quoteSymbol = quote?.tsym || quote?.tradingSymbol || quote?.ts;
    if (quoteSymbol && quoteSymbol !== symbol) {
        throw new Error(`Quote symbol mismatch for ${symbol}: got ${quoteSymbol}`);
    }

    const ltp = toFiniteNumber(quote?.lp);
    const price = getLimitPriceFromLtp(ltp, side);
    if (price === null) {
        throw new Error(`Cannot price ${side} order for ${symbol}: invalid LTP ${quote?.lp}`);
    }

    console.log(`Safe ${side} price for ${symbol}: ltp=${ltp}, price=${price}`);
    return price;
};

const getSafeOrderPriceFromPosition = async (position, side) => {
    const priceFromPosition = getLimitPriceFromLtp(position?.lp, side);
    if (priceFromPosition !== null) {
        return priceFromPosition;
    }
    return getSafeOrderPriceFromQuote(position?.tsym, side);
};

const positionKey = (position) => `${position?.exch || globalInput.pickedExchange}|${position?.tsym || ''}|${position?.prd || 'M'}`;

const isOpenShortOptionPosition = (position) => position?.exch === globalInput.pickedExchange &&
    Number(position?.netqty) < 0 &&
    ['C', 'P'].includes(identify_option_type(position?.tsym || ''));

const getCompletedOrderFillQty = (order) => toFiniteNumber(order?.fillshares ?? order?.flqty ?? order?.qty);

const getCompletedOrderFillPrice = (order) => toFiniteNumber(order?.avgprc ?? order?.flprc ?? order?.prc);

const getOrderTimeMs = (order) => {
    const candidates = [
        { value: order?.norentm, format: 'HH:mm:ss DD-MM-YYYY' },
        { value: order?.exch_tm, format: 'DD-MM-YYYY HH:mm:ss' },
    ];
    for (const candidate of candidates) {
        const parsed = moment(candidate.value, candidate.format, true);
        if (parsed.isValid()) {
            return parsed.valueOf();
        }
    }
    return 0;
};

const getRiskOrderbook = async () => {
    if (Date.now() - riskOrderbookFetchedAt < riskOrderbookRefreshMs && riskOrderbookCache.length > 0) {
        return riskOrderbookCache;
    }

    const orders = await api.get_orderbook();
    if (Array.isArray(orders)) {
        riskOrderbookCache = orders;
        riskOrderbookFetchedAt = Date.now();
        return riskOrderbookCache;
    }

    console.error('Risk monitor could not read orderbook:', JSON.stringify(apiResponseSummary(orders)));
    return [];
};

const getOrderStatusText = (orderStatus) => String(orderStatus?.status || orderStatus?.st_intrn || '').toUpperCase();

const isRejectedOrderStatus = (orderStatus) =>
    ['REJECTED', 'CANCELED', 'CANCELLED'].includes(getOrderStatusText(orderStatus));

const getOrderByNumber = async (orderno) => {
    if (!orderno) {
        return null;
    }
    const orderbook = await api.get_orderbook();
    if (!Array.isArray(orderbook)) {
        console.error('Could not read orderbook for confirmation:', JSON.stringify(apiResponseSummary(orderbook)));
        return null;
    }
    return orderbook.find(order => order.norenordno === orderno) || null;
};

const waitForOrderCompletion = async (orderno, orderContext) => {
    for (let attempt = 0; attempt < orderStatusMaxAttempts; attempt++) {
        await delay(orderStatusPollMs);
        const orderStatus = await getOrderByNumber(orderno);
        const statusText = getOrderStatusText(orderStatus);
        if (statusText === 'COMPLETE') {
            return orderStatus;
        }
        if (isRejectedOrderStatus(orderStatus)) {
            const reason = orderStatus?.rejreason || statusText;
            const message = `Shoonya order rejected: ${reason}`;
            await stopForManualReview(message, JSON.stringify({
                ...orderContext,
                norenordno: orderno,
                status: statusText,
                rejreason: orderStatus?.rejreason,
            }));
            throw new Error(message);
        }
    }

    const message = `Shoonya order not confirmed COMPLETE after ${orderStatusMaxAttempts}s`;
    await stopForManualReview(message, JSON.stringify({ ...orderContext, norenordno: orderno }));
    throw new Error(message);
};

const waitForOpenShortPosition = async (symbol, label) => {
    for (let attempt = 0; attempt < 6; attempt++) {
        await delay(1000);
        const positions = await api.get_positions();
        const position = Array.isArray(positions)
            ? positions.find(item => item?.tsym === symbol && Number(item?.netqty) < 0)
            : null;
        if (position) {
            return position;
        }
    }

    const message = `${label} order completed but live short position not found`;
    await stopForManualReview(message, JSON.stringify({ symbol }));
    throw new Error(message);
};

const getActiveShortEntryFromOrderbook = async (position) => {
    const absQty = Math.abs(Number(position?.netqty));
    if (!Number.isFinite(absQty) || absQty <= 0 || !position?.tsym) {
        return null;
    }

    const orders = await getRiskOrderbook();
    const matchingOrders = orders
        .filter((order) => order?.status === 'COMPLETE' &&
            order?.tsym === position.tsym &&
            (order?.exch || position.exch || globalInput.pickedExchange) === (position.exch || globalInput.pickedExchange))
        .sort((a, b) => getOrderTimeMs(a) - getOrderTimeMs(b));

    const openShortLots = [];
    for (const order of matchingOrders) {
        const qty = getCompletedOrderFillQty(order);
        const price = getCompletedOrderFillPrice(order);
        if (qty === null || qty <= 0 || price === null) {
            continue;
        }

        if (order.trantype === 'S') {
            openShortLots.push({ qty, price });
            continue;
        }

        if (order.trantype === 'B') {
            let remainingBuyQty = qty;
            while (remainingBuyQty > 0 && openShortLots.length > 0) {
                const lot = openShortLots[0];
                const coveredQty = Math.min(lot.qty, remainingBuyQty);
                lot.qty -= coveredQty;
                remainingBuyQty -= coveredQty;
                if (lot.qty <= 0) {
                    openShortLots.shift();
                }
            }
        }
    }

    const openQty = openShortLots.reduce((total, lot) => total + lot.qty, 0);
    if (openQty <= 0 || openQty < absQty) {
        return null;
    }

    const openValue = openShortLots.reduce((total, lot) => total + (lot.qty * lot.price), 0);
    return openValue / openQty;
};

const getPositionEntryPrice = async (position, existingState) => {
    if (existingState?.entryPrice) {
        return existingState.entryPrice;
    }

    const orderbookEntryPrice = await getActiveShortEntryFromOrderbook(position);
    return orderbookEntryPrice ?? toFiniteNumber(position?.netavgprc ?? position?.daysellavgprc);
};

const getPositionToken = (position) => position?.token || getTokenByTradingSymbol(position?.tsym);

const getFreshQuoteLtp = async (position, token, quoteKey) => {
    if (!token) {
        return null;
    }

    try {
        const quote = await api.get_quotes(position?.exch || globalInput.pickedExchange, token);
        const ltp = toFiniteNumber(quote?.lp);
        const quoteSymbol = quote?.tsym || quote?.tradingSymbol;
        if (quoteSymbol && position?.tsym && quoteSymbol !== position.tsym) {
            console.error(`REST quote symbol mismatch for ${positionKey(position)}: expected ${position.tsym}, got ${quoteSymbol}`);
            return null;
        }
        if (ltp !== null) {
            latestQuotes[quoteKey] = {
                ...quote,
                e: quote?.e || quote?.exch || position?.exch || globalInput.pickedExchange,
                tk: quote?.tk || quote?.token || token,
                tsym: quote?.tsym || position?.tsym,
            };
            latestQuotesTimestamps[quoteKey] = Date.now();
            riskRestQuoteFetchedAt.set(quoteKey, Date.now());
            return ltp;
        }
    } catch (error) {
        console.error(`REST quote fetch failed for ${positionKey(position)}:`, error.message || JSON.stringify(apiResponseSummary(error)));
    }

    return null;
};

const getCachedQuoteLtp = (quoteKey, maxAgeMs = riskLiveQuoteMaxAgeMs) => {
    if (!quoteKey) {
        return null;
    }

    const quoteAgeMs = Date.now() - (latestQuotesTimestamps[quoteKey] || 0);
    if (quoteAgeMs > maxAgeMs) {
        return null;
    }

    return toFiniteNumber(latestQuotes[quoteKey]?.lp);
};

const getPositionLtp = async (position, forceRest = false) => {
    const token = getPositionToken(position);
    const quoteKey = token ? `${position?.exch || globalInput.pickedExchange}|${token}` : '';

    if (forceRest) {
        const freshLtp = await getFreshQuoteLtp(position, token, quoteKey);
        if (freshLtp !== null) {
            return freshLtp;
        }
    }

    const cachedLtp = getCachedQuoteLtp(quoteKey);
    if (cachedLtp !== null) {
        return cachedLtp;
    }

    const freshLtp = await getFreshQuoteLtp(position, token, quoteKey);
    if (freshLtp !== null) {
        return freshLtp;
    }

    const positionLtp = toFiniteNumber(position?.lp);
    if (positionLtp !== null) {
        return positionLtp;
    }

    return null;
};

const getPerLotRiskConfig = () => {
    const lotSize = Number(globalInput.LotSize) || Number(getDailyQty()) || smallAccountDailyQty;
    return {
        lotSize,
        maxLossPerLotDistance: hardMaxLossPerLotRs / lotSize,
        trailingDistance: trailingSLPerLotRs / lotSize,
    };
};

const clearClosedRiskStates = (openPositions) => {
    const openKeys = new Set(openPositions.map(positionKey));
    [...shortOptionRiskState.keys()].forEach((key) => {
        if (!openKeys.has(key)) {
            shortOptionRiskState.delete(key);
            riskExitOrdersInProgress.delete(key);
            riskMissingLtpWarnedAt.delete(key);
        }
    });
};

const getRiskStateForSymbol = (symbol) => {
    if (!symbol) {
        return null;
    }
    return [...shortOptionRiskState.entries()]
        .find(([key]) => key.includes(`|${symbol}|`))?.[1] || null;
};

const formatRiskStopLabel = (riskState) => {
    const activeStopLtp = toFiniteNumber(riskState?.activeStopLtp);
    if (activeStopLtp === null) {
        return null;
    }
    const stopType = riskState.trailingActive ? 'TSL' : 'HSL';
    return `${activeStopLtp.toFixed(2)} ${stopType}`;
};

const shouldRefreshRiskQuote = (position) => {
    const token = getPositionToken(position);
    if (!token) {
        return false;
    }
    const quoteKey = `${position?.exch || globalInput.pickedExchange}|${token}`;
    return Date.now() - (riskRestQuoteFetchedAt.get(quoteKey) || 0) >= riskRestQuoteRefreshMs;
};

const warnMissingRiskLtp = (position) => {
    const key = positionKey(position);
    const lastWarnedAt = riskMissingLtpWarnedAt.get(key) || 0;
    if (Date.now() - lastWarnedAt < riskMissingLtpWarningMs) {
        return;
    }
    riskMissingLtpWarnedAt.set(key, Date.now());
    const message = `Risk monitor missing LTP for ${position?.tsym}; checked websocket cache, REST quote, and position lp.`;
    console.error(message);
    send_notification(message, true);
};

const exitShortOptionPositionForRisk = async (position, reason, state) => {
    const key = positionKey(position);
    if (riskExitOrdersInProgress.has(key)) {
        return false;
    }

    const absQty = Math.abs(Number(position?.netqty));
    const ltp = await getPositionLtp(position, true);
    if (!Number.isFinite(absQty) || absQty <= 0 || ltp === null) {
        await stopForManualReview(
            `Cannot risk-exit ${key}: invalid qty/ltp`,
            JSON.stringify(apiResponseSummary(position))
        );
        return false;
    }

    const exitPrice = getLimitPriceFromLtp(ltp, 'B');
    if (exitPrice === null) {
        await stopForManualReview(
            `Cannot risk-exit ${key}: unable to calculate buy price from LTP`,
            JSON.stringify({ ltp })
        );
        return false;
    }
    const order = {
        buy_or_sell: 'B',
        product_type: position.prd || 'M',
        exchange: position.exch || globalInput.pickedExchange,
        tradingsymbol: position.tsym,
        quantity: absQty.toString(),
        discloseqty: 0,
        price_type: 'LMT',
        price: exitPrice,
        remarks: 'RiskExitAPI',
    };

    riskExitOrdersInProgress.add(key);
    isExiting = true;
    try {
        await cancelOpenOrders();
        const exitResponses = await my_default_place_order(order);
        await delay(1000);
        const pnlAfterExit = await calcPnL(api);
        const triggerLtp = toFiniteNumber(state.triggerLtp ?? state.lastLtp);
        send_notification(formatExitOrderMessage({
            reason,
            symbol: position.tsym,
            qty: absQty,
            side: 'B',
            price: getFinalFillPrice(exitResponses, exitPrice),
            entry: state.entryPrice,
            ltp: triggerLtp ?? ltp,
            stop: state.activeStopLtp,
            pnl: pnlAfterExit,
        }), true);
        if (identify_option_type(position.tsym) === 'P') {
            longPositionTaken = false;
        } else if (identify_option_type(position.tsym) === 'C') {
            shortPositionTaken = false;
        }
        shortOptionRiskState.delete(key);
        largeEmaGapExitTime = Date.now();
        resetTrailPrice();
        await updateTwoSmallestPositionsAndNeighboursSubs(false);
        return true;
    } catch (error) {
        console.error(`Risk exit failed for ${key}:`, error.message || JSON.stringify(apiResponseSummary(error)));
        send_notification(`Risk exit failed for ${position.tsym}: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
        await stopForManualReview('Risk exit failed', error.message || JSON.stringify(apiResponseSummary(error)));
        return false;
    } finally {
        riskExitOrdersInProgress.delete(key);
        if (!fatalOrderRejection) {
            isExiting = false;
        }
    }
};

const monitorPerPositionRisk = async () => {
    if (isExiting) {
        return false;
    }

    const positions = await api.get_positions();
    if (!Array.isArray(positions)) {
        if (isNoPositionsResponse(positions)) {
            clearClosedRiskStates([]);
        } else {
            console.error('Risk monitor could not read positions:', JSON.stringify(apiResponseSummary(positions)));
        }
        return false;
    }

    const shortPositions = positions.filter(isOpenShortOptionPosition);
    clearClosedRiskStates(shortPositions);

    for (const position of shortPositions) {
        const key = positionKey(position);
        if (riskExitOrdersInProgress.has(key)) {
            continue;
        }

        const absQty = Math.abs(Number(position.netqty));
        const existing = shortOptionRiskState.get(key);
        const reusableExistingState = existing && existing.openQty === absQty ? existing : null;
        const entryPrice = await getPositionEntryPrice(position, reusableExistingState);
        const ltp = await getPositionLtp(position, true);
        const { lotSize, maxLossPerLotDistance, trailingDistance } = getPerLotRiskConfig();
        if (entryPrice === null || ltp === null || !Number.isFinite(absQty) || absQty <= 0) {
            console.error(`Skipping risk monitor for ${key}: invalid position data.`);
            if (ltp === null) {
                warnMissingRiskLtp(position);
            }
            continue;
        }

        const state = reusableExistingState || { entryPrice, bestLtp: entryPrice, trailingActive: false };

        state.bestLtp = Math.min(state.bestLtp, ltp);
        state.openQty = absQty;
        state.lotSize = lotSize;
        state.lots = absQty / lotSize;
        state.lastLtp = ltp;
        state.openPnl = (entryPrice - ltp) * absQty;
        state.maxLossPerLotDistance = maxLossPerLotDistance;
        state.trailingDistance = trailingDistance;
        state.hardStopLtp = entryPrice + maxLossPerLotDistance;
        state.trailingActivationLtp = entryPrice;

        if (state.bestLtp < state.trailingActivationLtp) {
            state.trailingActive = true;
        }

        state.trailingStopLtp = state.trailingActive ? state.bestLtp + trailingDistance : null;
        state.activeStopLtp = state.trailingActive
            ? Math.min(state.hardStopLtp, state.trailingStopLtp)
            : state.hardStopLtp;
        shortOptionRiskState.set(key, state);

        if (!positionProcess.soldTsym || positionProcess.soldTsym === position.tsym) {
            positionProcess.soldPrice = entryPrice;
            positionProcess.soldTsym = position.tsym;
            positionProcess.soldToken = position.token || getTokenByTradingSymbol(position.tsym);
            positionProcess.trailPrice = state.activeStopLtp.toFixed(2);
        }

        if (ltp >= state.activeStopLtp) {
            state.triggerLtp = ltp;
            const reason = state.trailingActive ? 'Trailing SL hit' : 'Hard max loss hit';
            return await exitShortOptionPositionForRisk(position, reason, state);
        }
    }

    return false;
};

exitHedgeOrder = async (positionsData) => {
  try {
    const exitPrice = await getSafeOrderPriceFromPosition(positionsData, 'S');
    let order = {
        buy_or_sell: 'S',
        product_type: 'M',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionsData.tsym.toString(),
        quantity: positionsData.netqty.toString(),
        discloseqty: 0,
        price_type: 'LMT',
        price: exitPrice,
        remarks: 'ExitHedgeAPI'
    }
    // console.log('exitHedgeOrder ignored: ', order);
    await my_default_place_order(order);
  } catch (error) {
    console.error('exitHedgeOrder failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    send_notification(`exitHedgeOrder failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
    await stopForManualReview('exitHedgeOrder failed', error.message || JSON.stringify(apiResponseSummary(error)));
  }
}

exitHedges = async () => {
  const data = await api.get_positions();
  if (Array.isArray(data)) {
    // Separate calls and puts for NFO - these are bought hedge options.
    const calls = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'C');
    const puts = data.filter(option => parseInt(option.netqty) > 0 && identify_option_type(option.tsym) == 'P');
    await Promise.all([...calls, ...puts].map(position => exitHedgeOrder(position)));
  }
}

updatePositions = async () => {
    try {
        const data = await api.get_positions();

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
        } else if (isNoPositionsResponse(data)) {
            resetCalls();
            resetPuts();
            positionProcess.hedgeCall = [];
            positionProcess.hedgePut = [];
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

let isQueueBusy = false;
const queue = [];

updateTwoSmallestPositionsAndNeighboursSubs = async (autoSubs = true) => {
    // If the queue is busy, add the function call to the queue
    if (isQueueBusy) {
        debug && console.log('updateTwoSmallestPositionsAndNeighboursSubs is already in progress.');
        return new Promise((resolve, reject) => {
            queue.push({ autoSubs, resolve, reject });
        });
    }

    isQueueBusy = true;

    try {
        await delay(2000);
        const positions = await updatePositions();
        updatePositionsNeighboursAndSubs(autoSubs);
        return positions;
    } finally {
        isQueueBusy = false;
        // Process the next function call in the queue if any
        if (queue.length > 0) {
            const nextItem = queue.shift(); // Remove the item from the queue
            // console.log('Processing next item in the updateTwoSmallestPositionsAndNeighboursSubs queue.');
            updateTwoSmallestPositionsAndNeighboursSubs(nextItem.autoSubs)
                .then(nextItem.resolve)
                .catch(nextItem.reject);
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
    pnl = await calcPnL(api);
    send_notification(formatTelegramMessage('ORDER UPDATE', [
      ['Action', `${data?.trantype || 'NA'} ${data?.tsym || 'NA'}`],
      ['Fill', formatPriceText(data?.flprc)],
      ['Mood', getPnlMood(pnl)],
      ['Capital', getCollateralLabel()],
    ]));
    
    if(data?.trantype === 'S') {
      positionProcess.soldPrice = +data?.flprc || 0;
      positionProcess.trailPrice = 0;
      positionProcess.soldTsym = data?.tsym;
      positionProcess.soldToken = getTokenByTradingSymbol(positionProcess.soldTsym);
      console.log(`positionProcess ${positionProcess.soldPrice} ${positionProcess.soldTsym}; risk monitor will set SL`)
    }
}

let lastNotificationTime = 0; // Initialize the last notification time
let subStrTemp2;
let latestQuote;

function receiveQuote(data) {
    // Ignore quotes with undefined/null/empty lp
    if (data.lp === undefined || data.lp === null || data.lp === '') {
        // Optionally log or silently ignore
        return;
    }

    const key = data.e + '|' + data.tk;
    const now = Date.now();

    // Always update the latest quote value for the corresponding instrument
    // Only update if 2 seconds have passed since last update for this key
    if (!latestQuotesTimestamps[key] || now - latestQuotesTimestamps[key] > 2000) {
        latestQuotes[key] = data;
        latestQuotesTimestamps[key] = now;
    }

    // Only proceed if soldToken is set and not empty
    if (!positionProcess.soldToken) return;

    const subStrTemp2 = `${globalInput.pickedExchange}|${String(positionProcess.soldToken).trim()}`;
    const receivedKey = `${data.e}|${String(data.tk).trim()}`;

    // Only set latestQuote if lp is defined and not null/empty string
    const quoteObj = latestQuotes[subStrTemp2];
    if (
        quoteObj &&
        quoteObj.lp !== undefined &&
        quoteObj.lp !== null &&
        quoteObj.lp !== ''
    ) {
        latestQuote = quoteObj.lp;
    } else {
        // Do not update latestQuote if lp is missing
        return;
    }

    // Exits are handled by monitorPerPositionRisk() using live positions.
}

let debounceTimer = null;
let fatalOrderRejection = false;
function receiveOrders(data) {
    // console.log("Order ::", data);
    // Update the latest order value for the corresponding instrument
    if (data.status === 'REJECTED') {
      send_notification('######### ORDER REJECTED PLS CHECK #########', true);

      // Clear any existing debounce timer
      if (debounceTimer) {
          clearTimeout(debounceTimer);
      }

      // Set a new debounce timer
      debounceTimer = setTimeout(() => {
          stopForManualReview('Order rejected from websocket', JSON.stringify(apiResponseSummary(data))).then(() => {
              console.log('stopped for manual review');
          }).catch((error) => {
              console.error('Error stopping for manual review:', error);
          }).finally(() => {
            // Reset the debounceTimer to null after the timeout function completes
            debounceTimer = null;
          });
      }, 1000); // Debounce duration in milliseconds (e.g., 1000ms = 1 second)
  }
  
  if (data.status === 'COMPLETE') {
      latestOrders[data.Instrument] = data;
      // update the smallest positions after each order
      postOrderPosTracking(data);
  }
}

function open(data) {
    console.log('ws open ack:', JSON.stringify(apiResponseSummary(data)));
    if (data?.s && data.s !== 'OK') {
        websocketReady = false;
        websocketAuthFailed = true;
        const message = `Shoonya websocket auth failed: ${JSON.stringify(apiResponseSummary(data))}. Order confirmation will use REST orderbook polling.`;
        console.error(message);
        send_notification(message, true);
        return;
    }

    websocketReady = true;
    websocketAuthFailed = false;
    websocket_closed = false;
    const initialInstruments = [`${globalInput.indexName.includes('EX') ? 'NSE' : 'NSE'}|${globalInput.token}`, 'NSE|26017']; 

    subscribeToInstruments(initialInstruments);
}

const scheduleWebsocketReconnect = (reason) => {
    if (fatalOrderRejection || websocketAuthFailed || websocketReconnectTimer) {
        return;
    }
    console.error(`Shoonya websocket ${reason}; reconnecting in 30s.`);
    websocketReconnectTimer = setTimeout(async () => {
        websocketReconnectTimer = null;
        try {
            await startWebsocket();
        } catch (error) {
            console.error('Shoonya websocket reconnect failed:', error.message || JSON.stringify(apiResponseSummary(error)));
            scheduleWebsocketReconnect('reconnect failed');
        }
    }, 30000);
};

const onSocketClose = (data) => {
    websocketReady = false;
    websocket_closed = true;
    console.error('Shoonya websocket closed:', data);
    scheduleWebsocketReconnect('closed');
};

const onSocketError = (data) => {
    websocketReady = false;
    console.error('Shoonya websocket error:', data);
    scheduleWebsocketReconnect('errored');
};

function subscribeToInstruments(instruments) {
    if (!websocketReady) {
        console.log('Skipping websocket subscribe; websocket is not ready.');
        return;
    }
    instruments.forEach(instrument => {
        api.subscribe(instrument);
    });
}

function dynamicallyAddSubscription(newInstrument) {
    if (!websocketReady) {
        return;
    }
    if (!latestQuotes[newInstrument]) {
        console.log("Subscribing to new :: ", newInstrument);
        api.subscribe(newInstrument);
    }
}

params = {
    'socket_open': open,
    'socket_close': onSocketClose,
    'socket_error': onSocketError,
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
        console.log(biasProcess.atmStrike, ' : biasProcess.atmStrike')
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
    // true && console.log(biasProcess.ocCallOptions, 'callOptions')
    debug && console.log(biasProcess.ocPutOptions, 'putOptions')
    
    biasProcess.itmCallSymbol = biasProcess.ocCallOptions[13].tsym;
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
    await delay(1000)
    if (biasProcess.optionChain) {
        // Find the ITM symbol
        await delay(1000)
        updateITMSymbolAndStrike();
        await delay(1000)
        
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
    resStr = '';

    if (parseFloat(pValue2Var) < parseFloat(cValue1Var) || parseFloat(cValue2Var) < parseFloat(pValue1Var)) {
        let up = parseFloat(pValue2Var) < parseFloat(cValue1Var)
        let trendingUp = parseFloat(pValue1Var) > parseFloat(cExtra3Var)
        let trendingDown = parseFloat(cValue1Var) > parseFloat(pExtra3Var);
        if((up && biasOutput.bias > 0) || (!up && biasOutput.bias < 0) || trendingUp || trendingDown ){
            await takeAction(up)
        }
    }
}

let isExiting = false; // Add this flag to block new entries during exit

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
            console.error(`optionChain is not an array for ${tsym?.tsym}.`);
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
biasProcess.callSubStr = biasProcess.itmCallSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmCallSymbol)}` : '';
biasProcess.putSubStr = biasProcess.itmPutSymbol ? `${globalInput.pickedExchange}|${getTokenByTradingSymbol(biasProcess.itmPutSymbol)}` : '';
dynamicallyAddSubscription(biasProcess.callSubStr);
dynamicallyAddSubscription(biasProcess.putSubStr);
await delay(2000)
return;
}

const ema9_21_3ValuesIndicators = async (params) => {
  try{

    
    const { Indicators, ema, vwap, avgprice } = require('@ixjb94/indicators');

    if(params.token == globalInput.token) {
      console.log('ema9_21_3ValuesIndicators called with params:', params);
      const replyNifty = await api.get_time_price_series(params);
              console.log('get_time_price_series replyNifty[0]: ' + replyNifty[0])

      if (Array.isArray(replyNifty) && replyNifty.length > 0 && replyNifty[0].intvwap !== undefined) {
        // avgprice
        calcVWAP = replyNifty[0]['intvwap'];
        console.log('Updated calcVWAP:', calcVWAP);
      } else {
        console.log('VWAP data not available in replyNifty:', replyNifty);
      }
      return;
    } 
    const reply = await api.get_time_price_series(params);
    // console.log('VWAP: ' + reply[0]['intvwap'])


    // Fix: Ensure reply is an array before mapping
    if (!Array.isArray(reply)) {
      console.log('Error: get_time_price_series did not return an array:', reply, params);
      throw new Error('get_time_price_series did not return an array');
    }

    // Extract 'intc' prices into a new array
    const intcPrices = reply.map(item => parseFloat(item.intc));
    
    //last 50 items
    const last80Items = intcPrices.slice(0,80).reverse();

    // Calculate 9-period EMA
    let ta = new Indicators();
    let ema3Values = await ta.ema(last80Items, 8);
    let ema9Values = await ta.ema(last80Items, 13);
    // Calculate 21-period EMA
    let ema21Values = await ta.ema(last80Items, 48);
    //send last item from the array
    return [ema9Values[ema9Values.length-1], ema21Values[ema21Values.length-1], ema3Values[ema21Values.length-1]];
  }
  catch (error) {
    console.error('Error:', error);
    throw error; // Rethrow the error to be caught in the calling function
  }
}

const emaMonitorATMs = async () => {
  try{

    //commented out to disable change actions on ATM
    let tempAtmStrike = await getAtmStrike()
    if (tempAtmStrike!= biasProcess.atmStrike){
      // if (longPositionTaken || shortPositionTaken) { await triggerATMChangeActions() }
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
    // get nifty vwap via ema9_21_3ValuesIndicators
    paramsNifty = {
      'exchange'   : globalInput.pickedExchange,
      'token' : globalInput.token,
      'starttime'    : epochTimeTrimmed,
      'interval' : '1'
      }
    // await ema9_21_3ValuesIndicators(paramsNifty);

    const [callemaMedium, callemaSlow, callemaFast] = await ema9_21_3ValuesIndicators(paramsCall);
    const [putemaMedium, putemaSlow, putemaFast] = await ema9_21_3ValuesIndicators(paramsPut);
    const riskExitedForNotification = await monitorPerPositionRisk();
    if (riskExitedForNotification) {
      return [prevEmaUpFastCall, prevEmaUpFastPut];
    }
    const subStrTemp = `${globalInput.pickedExchange}|${positionProcess.soldToken}`
    // console.log('subStrTemp : ', subStrTemp) // subStrTemp :  NFO|61726
    const latestQuote2 = toFiniteNumber(latestQuotes[subStrTemp]?.lp);
    const riskState = getRiskStateForSymbol(positionProcess.soldTsym);
    const riskStopLabel = formatRiskStopLabel(riskState);
    if (riskStopLabel) {
      positionProcess.trailPrice = riskState.activeStopLtp.toFixed(2);
    }
    const soldDisplay = toFiniteNumber(riskState?.entryPrice ?? positionProcess.soldPrice);
    const ltpDisplay = toFiniteNumber(riskState?.lastLtp ?? latestQuote2);
    const soldText = soldDisplay === null ? 'NA' : soldDisplay.toFixed(2);
    const ltpText = ltpDisplay === null ? 'NA' : ltpDisplay.toFixed(2);
    const hasTrackedRiskPosition = riskState || soldDisplay > 0 || Boolean(positionProcess.soldTsym);
    const riskText = riskStopLabel
                  ? `S @${soldText} | T @${riskStopLabel} | L @${ltpText}`
                  : hasTrackedRiskPosition
                    ? `SL pending | S @${soldText} | T @pending | L @${ltpText}`
                    : undefined;
    send_notification(formatTelegramMessage('EMA CHECK', [
      ['Risk', riskText],
      ['Slow', `CE ${parseFloat(callemaSlow).toFixed(2)} | PE ${parseFloat(putemaSlow).toFixed(2)}`],
      ['Medium', `CE ${parseFloat(callemaMedium).toFixed(2)} | PE ${parseFloat(putemaMedium).toFixed(2)}`],
    ]));
   
    emaUpFastCall = callemaMedium - callemaSlow > -2;
    emaUpFastPut = putemaMedium - putemaSlow > -2;
    
    // Check for large EMA gap (> 20) and exit if gap is significant
    const callEmaGap = callemaSlow - callemaMedium;
    const putEmaGap = putemaSlow - putemaMedium;
    
    console.log(`[EMA Gap Debug] callEmaGap: ${parseFloat(callEmaGap).toFixed(2)}, putEmaGap: ${parseFloat(putEmaGap).toFixed(2)}, Threshold: ${EMA_GAP_THRESHOLD}`);
    
    if (callEmaGap > EMA_GAP_THRESHOLD || putEmaGap > EMA_GAP_THRESHOLD) {
      console.log(`[EMA Gap Alert] Large gap detected! callEmaGap: ${parseFloat(callEmaGap).toFixed(2)}, putEmaGap: ${parseFloat(putEmaGap).toFixed(2)}`);
      if (shortPositionTaken || longPositionTaken) {
        console.log(`[EMA Gap Action] Pausing trading. shortPositionTaken: ${shortPositionTaken}, longPositionTaken: ${longPositionTaken}`);
        send_notification(formatTelegramMessage('LARGE EMA GAP', [
          ['Call Gap', parseFloat(callEmaGap).toFixed(2)],
          ['Put Gap', parseFloat(putEmaGap).toFixed(2)],
          ['Action', 'Exit positions; wait 30 min'],
        ]));
        await exitSellsAndOrStop(false);
        largeEmaGapExitTime = Date.now();
      }
    }
    
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
let largeEmaGapExitTime = 0; // Timestamp when large EMA gap exit occurred
const EMA_GAP_COOLDOWN = 20 * 60 * 1000; // 30 minutes in milliseconds
const EMA_GAP_THRESHOLD = 30; // Gap threshold between medium and slow EMA

// Reusable method to check if in cooldown period after exit
const isInCooldownPeriod = (functionName = '') => {
  const timeSinceLargeGapExit = Date.now() - largeEmaGapExitTime;
  if (timeSinceLargeGapExit < EMA_GAP_COOLDOWN && largeEmaGapExitTime > 0) {
    const remainingCooldown = Math.ceil((EMA_GAP_COOLDOWN - timeSinceLargeGapExit) / 1000 / 60);
    const prefix = functionName ? `${functionName}: ` : '';
    const message = `${prefix}In cooldown period. ${remainingCooldown} minutes remaining before new positions allowed.`;
    console.log(message);
    send_notification(formatTelegramMessage('COOLDOWN', [
      ['Status', 'active'],
      ['Wait', `${remainingCooldown} min`],
      ['Scope', functionName || 'strategy'],
    ]));
    return true;
  }
  return false;
}

const cancelOpenOrders = async () => {
  const orders = await api.get_orderbook();
  const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'OPEN') : [];
  for (const order of filtered_data_API) {
    if (order?.norenordno) {
      await api.cancel_order(order.norenordno);
    }
  }
}

let manualReviewStopInProgress = false;
const stopForManualReview = async (reason, details = '') => {
  fatalOrderRejection = true;
  isExiting = true;
  telegramSignals.isPlaying = false;
  if (intervalIdForEMA) {
    clearInterval(intervalIdForEMA);
    intervalIdForEMA = null;
  }
  if (manualReviewStopInProgress) {
    return;
  }

  manualReviewStopInProgress = true;
  const message = `Manual review required: ${reason}${details ? ` ${details}` : ''}. zema2 is paused and will not take new positions. PM2 remains online.`;
  console.error(message);
  send_notification(message, true);

  try {
    await cancelOpenOrders();
  } catch (error) {
    console.error('cancelOpenOrders failed during manual-review stop:', error.message || JSON.stringify(apiResponseSummary(error)));
  }
}

function cleanupAndExit() {
  console.log('Cleanup actions completed.');
  process.exit(0);
}

function resetTrailPrice() {
  // Clear position process state
  positionProcess.soldToken = '';
  positionProcess.soldTsym = '';
  positionProcess.soldPrice = 0;
  positionProcess.trailPrice = 0;
}

let lastExecutionTime = 0;
const exitSellsAndOrStop = async (stop = false) => {
  isExiting = stop ? true : false; // Set exit mode
  await delay(1000);
  pnlTemp1 = await calcPnL(api);
  const pnlValue = toPnlNumber(pnlTemp1);
  if (pnlValue !== null && ((pnlValue < pnlThreshold) || (pnlValue > pnlUpThreshold))) {
    stop = true;
  } else {
    send_notification(formatTelegramMessage('EXIT CHECK', [
      ['Mood', getPnlMood(pnlTemp1)],
      ['Result', 'No stop threshold hit'],
    ]));
  }

  const currentTime = Date.now();
  // Check if one minute has passed since the last execution
  if (currentTime - lastExecutionTime < 55000) {
      return; // Exit if less than one minute has passed
  }

  lastExecutionTime = currentTime;

  try {
      await cancelOpenOrders();
  } catch (error) {
      console.error('cancelOpenOrders failed before exit:', error.message || JSON.stringify(apiResponseSummary(error)));
  }

  // Exit positions
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  let positionsExited = false;
  if (positionProcess.smallestPutPosition?.tsym) {
      await exitXemaLong();
      longPositionTaken = false;
      positionsExited = true;
  }
  if (positionProcess.smallestCallPosition?.tsym) {
      await exitXemaShort();
      shortPositionTaken = false;
      positionsExited = true;
  }
  
  // Start 30-minute cooldown after exit
  if (positionsExited) {
      largeEmaGapExitTime = Date.now();
      send_notification(formatTelegramMessage('POST EXIT', [
        ['Status', 'positions exited'],
        ['Wait', '30 min before next trade'],
      ]));
  }
  
  if (stop) {
      send_notification(formatTelegramMessage('STOP', [
        ['Action', 'exit all and stop'],
      ]));
      setTimeout(function() {
          cancelOpenOrders();
      }, 2000);
      setTimeout(function() {
          exitHedges();
      }, 4000);
      setTimeout(function() {
          cleanupAndExit();
          // Also reset position flags after cleanup
          longPositionTaken = false;
          shortPositionTaken = false;
          isExiting = false; // Reset after exit
      }, 10000);
  } else {
      if (longPositionTaken || shortPositionTaken) {
          send_notification(formatTelegramMessage('EXIT', [
            ['Action', 'exit all'],
          ]));
      }
      // Also reset position flags after normal exit
      longPositionTaken = false;
      shortPositionTaken = false;
      isExiting = false; // Reset after exit
  }
}

const triggerATMChangeActions = async () => {
  await exitSellsAndOrStop(false);
}
const my_default_place_order = async (order) => {
  const freeze_qty = Number(getFreezeQty());
  let remainingQty = Number(order.quantity);
  const responses = [];

  if (!Number.isFinite(remainingQty) || remainingQty <= 0) {
    throw new Error(`Invalid order quantity: ${order.quantity}`);
  }

  while (remainingQty > 0) {
    const chunkQty = Math.min(remainingQty, freeze_qty);
    const chunkOrder = { ...order, quantity: chunkQty.toString() };
    const response = await api.place_order(chunkOrder);
    const summary = apiResponseSummary(response);

    console.log('place_order response:', JSON.stringify({
      ...summary,
      trantype: chunkOrder.buy_or_sell,
      exch: chunkOrder.exchange,
      tsym: chunkOrder.tradingsymbol,
      qty: chunkOrder.quantity,
      prctyp: chunkOrder.price_type,
      prc: chunkOrder.price
    }));

    if (!isOrderAccepted(response)) {
      const message = `Shoonya order not accepted: ${JSON.stringify(summary)}`;
      await stopForManualReview(message, JSON.stringify({
        trantype: chunkOrder.buy_or_sell,
        exch: chunkOrder.exchange,
        tsym: chunkOrder.tradingsymbol,
        qty: chunkOrder.quantity,
        prctyp: chunkOrder.price_type,
        prc: chunkOrder.price
      }));
      throw new Error(message);
    }

    const finalOrder = await waitForOrderCompletion(response.norenordno || response.result, {
      trantype: chunkOrder.buy_or_sell,
      exch: chunkOrder.exchange,
      tsym: chunkOrder.tradingsymbol,
      qty: chunkOrder.quantity,
      prctyp: chunkOrder.price_type,
      prc: chunkOrder.price,
    });

    responses.push({ response, finalOrder });
    remainingQty -= chunkQty;
  }

  return responses;
}

//buy Put
const exitXemaLong = async () => {
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  let exitOrderAccepted = false;
  if(positionProcess.smallestPutPosition?.tsym) {
    try {
      const order = {
        buy_or_sell: 'B',
        product_type: 'M',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionProcess.smallestPutPosition.tsym,
        quantity: getDailyQty().toString(),
        discloseqty: 0,
        price_type: 'LMT',
        price: await getSafeOrderPriceFromPosition(positionProcess.smallestPutPosition, 'B'),
        remarks: 'API'
      };
      const exitResponses = await my_default_place_order(order);
      exitOrderAccepted = true;
      const riskState = shortOptionRiskState.get(positionKey(positionProcess.smallestPutPosition));
      const pnlAfterExit = await calcPnL(api);
      send_notification(formatExitOrderMessage({
        reason: 'PUT SHORT EXIT',
        symbol: order.tradingsymbol,
        qty: order.quantity,
        side: 'B',
        price: getFinalFillPrice(exitResponses, order.price),
        entry: riskState?.entryPrice ?? positionProcess.soldPrice,
        ltp: positionProcess.smallestPutPosition?.lp,
        stop: riskState?.activeStopLtp ?? positionProcess.trailPrice,
        pnl: pnlAfterExit,
      }), true);
    } catch (error) {
      console.error('exitXemaLong order failed:', error.message || JSON.stringify(apiResponseSummary(error)));
      send_notification(`exitXemaLong order failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
      await stopForManualReview('exitXemaLong order failed', error.message || JSON.stringify(apiResponseSummary(error)));
    }
  }
  longPositionTaken = exitOrderAccepted ? false:longPositionTaken;
  // Set cooldown period when exiting position
  if(positionProcess.smallestPutPosition?.tsym) {
    largeEmaGapExitTime = Date.now();
  }
  resetTrailPrice();
  await delay(1000);
  pnlTemp1 = await calcPnL(api);
  const pnlValue = toPnlNumber(pnlTemp1);
  if (pnlValue !== null && ((pnlValue < pnlThreshold) || (pnlValue > pnlUpThreshold))) {
    await exitSellsAndOrStop(true);
  } else {
    send_notification(formatTelegramMessage('EXIT CHECK', [
      ['Mood', getPnlMood(pnlTemp1)],
      ['Result', 'No stop threshold hit'],
    ]));
  }
  }
const enterXemaLong = async () => {
  if (fatalOrderRejection) return;
  if (isInCooldownPeriod('enterXemaLong')) return;
  if (isExiting) return; // Block entry during exit
  let tempTradingPutSymbol = biasProcess.atmPutSymbol;

  try {
    const order = {
      buy_or_sell: 'S',
      product_type: 'M',
      exchange: globalInput.pickedExchange,
      tradingsymbol: tempTradingPutSymbol,
      quantity: getDailyQty().toString(),
      discloseqty: 0,
      price_type: 'LMT',
      price: await getSafeOrderPriceFromQuote(tempTradingPutSymbol, 'S'),
      remarks: 'API'
    };
    await my_default_place_order(order);
    await waitForOpenShortPosition(tempTradingPutSymbol, 'enterXemaLong');
    // send_notification('entering Long', true)
    longPositionTaken = true;
  } catch (error) {
    longPositionTaken = false;
    console.error('enterXemaLong order failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    send_notification(`enterXemaLong order failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
    await stopForManualReview('enterXemaLong order failed', error.message || JSON.stringify(apiResponseSummary(error)));
  }
  await delay(1000);
}

//Exit short Call
const exitXemaShort = async () => {
  await updateTwoSmallestPositionsAndNeighboursSubs(false);
  let exitOrderAccepted = false;
  if(positionProcess.smallestCallPosition?.tsym) {
    try {
      const order = {
        buy_or_sell: 'B',
        product_type: 'M',
        exchange: globalInput.pickedExchange,
        tradingsymbol: positionProcess.smallestCallPosition.tsym,
        quantity: getDailyQty().toString(),
        discloseqty: 0,
        price_type: 'LMT',
        price: await getSafeOrderPriceFromPosition(positionProcess.smallestCallPosition, 'B'),
        remarks: 'API'
      };
      const exitResponses = await my_default_place_order(order);
      exitOrderAccepted = true;
      const riskState = shortOptionRiskState.get(positionKey(positionProcess.smallestCallPosition));
      const pnlAfterExit = await calcPnL(api);
      send_notification(formatExitOrderMessage({
        reason: 'CALL SHORT EXIT',
        symbol: order.tradingsymbol,
        qty: order.quantity,
        side: 'B',
        price: getFinalFillPrice(exitResponses, order.price),
        entry: riskState?.entryPrice ?? positionProcess.soldPrice,
        ltp: positionProcess.smallestCallPosition?.lp,
        stop: riskState?.activeStopLtp ?? positionProcess.trailPrice,
        pnl: pnlAfterExit,
      }), true);
    } catch (error) {
      console.error('exitXemaShort order failed:', error.message || JSON.stringify(apiResponseSummary(error)));
      send_notification(`exitXemaShort order failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
      await stopForManualReview('exitXemaShort order failed', error.message || JSON.stringify(apiResponseSummary(error)));
    }
  }
  shortPositionTaken = exitOrderAccepted ? false:shortPositionTaken;
  // Set cooldown period when exiting position
  if(positionProcess.smallestCallPosition?.tsym) {
    largeEmaGapExitTime = Date.now();
  }
  resetTrailPrice();
  await delay(1000);

  pnlTemp1 = await calcPnL(api);
  const pnlValue = toPnlNumber(pnlTemp1);
  if (pnlValue !== null && ((pnlValue < pnlThreshold) || (pnlValue > pnlUpThreshold))) {
    await exitSellsAndOrStop(true);
  } else {
    send_notification(formatTelegramMessage('EXIT CHECK', [
      ['Mood', getPnlMood(pnlTemp1)],
      ['Result', 'No stop threshold hit'],
    ]));
  }
}
const enterXemaShort = async () => {
  if (fatalOrderRejection) return;
  if (isInCooldownPeriod('enterXemaShort')) return;
  if (isExiting) return; // Block entry during exit

  let tempTradingCallSymbol = biasProcess.atmCallSymbol;

  try {
    const order = {
      buy_or_sell: 'S',
      product_type: 'M',
      exchange: globalInput.pickedExchange,
      tradingsymbol: tempTradingCallSymbol,
      quantity: getDailyQty().toString(),
      discloseqty: 0,
      price_type: 'LMT',
      price: await getSafeOrderPriceFromQuote(tempTradingCallSymbol, 'S'),
      remarks: 'API'
    };
    await my_default_place_order(order);
    await waitForOpenShortPosition(tempTradingCallSymbol, 'enterXemaShort');
    // send_notification('entering Short', true)
    shortPositionTaken = true;
  } catch (error) {
    shortPositionTaken = false;
    console.error('enterXemaShort order failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    send_notification(`enterXemaShort order failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
    await stopForManualReview('enterXemaShort order failed', error.message || JSON.stringify(apiResponseSummary(error)));
  }
  await delay(1000);
}



const enterXemaBuyCall = async () => {
  try {
    nearestCETsym = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocCallOptions, 1)
    order = {
      buy_or_sell: 'B',
      product_type: 'M',
      exchange: globalInput.pickedExchange,
      tradingsymbol: nearestCETsym,
      quantity: getDailyQty().toString(),
      discloseqty: 0,
      price_type: 'LMT',
      price: await getSafeOrderPriceFromQuote(nearestCETsym, 'B'),
      remarks: 'API'
    }
    await my_default_place_order(order);
    send_notification('bought hedge call', true)
  } catch (error) {
    console.error('enterXemaBuyCall failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    send_notification(`enterXemaBuyCall failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
    await stopForManualReview('enterXemaBuyCall failed', error.message || JSON.stringify(apiResponseSummary(error)));
  }
}

const enterXemaBuyPut = async () => {
  try {
    nearestPETsym = await getOptionBasedOnNearestPremium(api, globalInput.pickedExchange, biasProcess.ocPutOptions, 1)
    order = {
      buy_or_sell: 'B',
      product_type: 'M',
      exchange: globalInput.pickedExchange,
      tradingsymbol: nearestPETsym,
      quantity: getDailyQty().toString(),
      discloseqty: 0,
      price_type: 'LMT',
      price: await getSafeOrderPriceFromQuote(nearestPETsym, 'B'),
      remarks: 'API'
    }
    await my_default_place_order(order);
    send_notification('bought hedge put', true)
  } catch (error) {
    console.error('enterXemaBuyPut failed:', error.message || JSON.stringify(apiResponseSummary(error)));
    send_notification(`enterXemaBuyPut failed: ${error.message || JSON.stringify(apiResponseSummary(error))}`, true);
    await stopForManualReview('enterXemaBuyPut failed', error.message || JSON.stringify(apiResponseSummary(error)));
  }
}

async function takeEMADecision(emaMonitorFastCallUp, emaFastMonitorPutUp) {
  if (fatalOrderRejection) return;
  // Check if we're in cooldown period after exit
  if (isInCooldownPeriod()) return;
  
  if (typeof currentPositionStatus === 'undefined' || currentPositionStatus === 'No Position') {
    biasCalcFlag = !biasCalcFlag;
    console.log('biasCalcFlag toggled (no position).');
  } else {
    console.log('biasCalcFlag unchanged (currentPositionStatus: ', currentPositionStatus, ').');
  }

  console.log('biasCalcFlag: ', biasCalcFlag, '\ncalcVWAP: ', calcVWAP, '\ntime: ', new Date().toLocaleTimeString("en-IN", {timeZone: "Asia/Kolkata"}), '\nspotObject.lp: ', biasProcess.spotObject?.lp);
  // biasCalcFlag = false ? biasOutput.bias > 0 : biasOutput.bias <= 0; // if near expiry today, then go with bias calculation
  if(biasCalcFlag){
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
  pnl = await calcPnL(api);
  pnlMood = getPnlMood(pnl);
  const biasDisplay = Number.isFinite(Number(biasOutput.bias)) ? biasOutput.bias : 'NA';
  send_notification(formatTelegramMessage('STATUS', [
    ['Mood', pnlMood],
    ['Position', currentPositionStatus],
    ['Bias', biasDisplay],
    ['Capital', getCollateralLabel()],
  ]));
  console.log(' PnL: ' + pnl);
}

const setBiasValue = async () => {
  const putStrike = toFiniteNumber(biasProcess.itmPutStrikePrice);
  const putLtp = toFiniteNumber(latestQuotes[biasProcess.putSubStr]?.lp);
  const callStrike = toFiniteNumber(biasProcess.itmCallStrikePrice);
  const callLtp = toFiniteNumber(latestQuotes[biasProcess.callSubStr]?.lp);
  const spotLtp = toFiniteNumber(latestQuotes[`${globalInput.pickedExchange === 'BFO' ? 'NSE':globalInput.pickedExchange === 'NFO'? 'NSE': 'NSE'}|${globalInput.token}`]?.lp);

  if ([putStrike, putLtp, callStrike, callLtp, spotLtp].some(value => value === null)) {
    console.log('Skipping bias update: missing quote data.');
    return false;
  }

  ltpSuggestedPut = putStrike - putLtp;
  ltpSuggestedCall = callLtp + callStrike;
  biasOutput.bias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - spotLtp);
  return Number.isFinite(biasOutput.bias);
}

const optionBasedEmaRecurringFunction = async () => {
  if (fatalOrderRejection) return;
  // Block entire EMA logic during cooldown period
  if (isInCooldownPeriod('optionBasedEmaRecurringFunction')) {
    return;
  }
  
  const biasReady = await setBiasValue();
  if (!biasReady) {
    return;
  }
  let [emaMonitorMediumCallUp, emaMediumMonitorPutUp] = await emaMonitorATMs();
  await takeEMADecision(emaMonitorMediumCallUp, emaMediumMonitorPutUp)
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
}

// main run by calling recurring function and subscribe to new ITMs for BiasCalculation
getEma = async () => {
  if (fatalOrderRejection) {
    return;
  }
  var currentDate = new Date();
  var seconds = currentDate.getSeconds();
  if (seconds % riskMonitorIntervalSeconds === 0) {
    try {
      const riskExited = await monitorPerPositionRisk();
      if (riskExited) {
        return;
      }
    } catch (error) {
        console.error("Error occured in monitorPerPositionRisk: " + error);
        send_notification("Error occured in monitorPerPositionRisk")
    }
  }
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
      if(isTimeEqualsNotAfterProps(15,15,false)) {
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
    //process.exit(0);
    // await send_callback_notification();
    await updateITMSymbolfromOC();
    await dynSubs();
    await updateTwoSmallestPositionsAndNeighboursSubs(false);
    limits = await api.get_limits()

    globalInput.emaLotMultiplierQty = getEMAQtyForGeneric();
    globalInput.emaLotMultiplier = Math.floor(globalInput.emaLotMultiplierQty/globalInput.LotSize);
            
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
    console.log("#############pausing")
    clearInterval(intervalIdForEMA);
    telegramSignals.isPlaying = false;
  }
};

// Function to resume the EMA calculations
const resumeEma = () => {
  if (!telegramSignals.isPlaying) {
    console.log("#############resuming")
    intervalIdForEMA = setInterval(getEma, delayForEMA);
    telegramSignals.isPlaying = true;
  }
};

runEma();
