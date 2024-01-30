// Initialization / nearest expiry / getAtmStrike
const debug = false;


const axios = require('axios');
const fs = require('fs');
const unzipper = require('unzipper');
const { parse } = require('papaparse');
const moment = require('moment');
const { idxNameTokenMap, idxNameOcGap, downloadCsv, filterAndMapDates, 
  identify_option_type, fetchSpotPrice, getStrike } = require('./utils/customLibrary');
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(telegramBotToken, { polling: true });
const send_notification = async (message, me = false) => console.log(message) || (!debug && message && await bot.sendMessage(me ? chat_id_me : chat_id, me ? message : message.replace(/\) /g, ")\n")).catch(console.error));
  
let globalBigInput = {
  filteredIndexCSV: undefined
}

getPickedIndexHere = () => debug ? 'NIFTY' : ['UNKNOWN', 'BANKEX', 'FINNIFTY', 'BANKNIFTY', 'NIFTY', 'SENSEX'][new Date().getDay()] || 'NIFTY';

let globalInput = {
  susertoken: '',
  secondSession: false,
  launchChildProcessApp: false,
  indexName: getPickedIndexHere(),
  delayTime: 10000,
  ocGap: undefined,
  token: undefined,
  pickedExchange: undefined,
  inputOptTsym: undefined,
  WEEKLY_EXPIRY: undefined,
  MONTHLY_EXPIRY: undefined,
};
globalInput.token = idxNameTokenMap.get(globalInput.indexName);
globalInput.ocGap = idxNameOcGap.get(globalInput.indexName);
let biasProcess = {
  optionChain: undefined,
  ocCallOptions: undefined,
  ocPutOptions: undefined,
  itmCallSymbol: undefined,
  itmCallStrikePrice: undefined,
  callSubStr: undefined,
  itmPutSymbol: undefined,
  itmPutStrikePrice: undefined,
  putSubStr: undefined,
  vix: undefined,
  spotObject: undefined
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

async function findNearestExpiry() {
  let csvUrl, zipFilePath, csvFilePath;
  const exchangeType = globalInput.indexName.includes('EX') ? 'BFO' : 'NFO';
  csvUrl = `https://api.shoonya.com/${exchangeType}_symbols.txt.zip`;
  zipFilePath = `./${exchangeType}_symbols.zip`;
  csvFilePath = `./${exchangeType}_symbols.txt`;
  try {
    // Download and extract the CSV file
    await downloadCsv(csvUrl, zipFilePath);
    await fs.createReadStream(zipFilePath).pipe(unzipper.Extract({ path: '.' }));

    // Read CSV data into a JavaScript object
    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    const { data: symbolDf } = parse(csvData, { header: true });
    
    globalBigInput.filteredIndexCSV = filterAndMapDates(symbolDf.filter((row) => ['OPTIDX', 'FUTIDX'].includes(row.Instrument) && row.TradingSymbol.startsWith(globalInput.indexName)));
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
    globalInput.WEEKLY_EXPIRY = expiryList[0];
    globalInput.MONTHLY_EXPIRY = expiryFutList[0].Expiry;
    globalInput.pickedExchange = expiryFutList[0].Exchange;
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    // Clean up: Delete downloaded files
    fs.unlinkSync(zipFilePath);
    fs.unlinkSync(csvFilePath);
  }
};
// Execute the findNearestExpiry function
findNearestExpiry();

const Api = require("./lib/RestApi");
let api = new Api({});

const getAtmStrike = () => {
  
  biasProcess.spotObject = latestQuotes[`NSE|${globalInput.token}`];
  // debug && console.log(biasProcess.spotObject) //updateAtmStrike(s) --> 50, spot object -> s.lp = 20100
  return Math.round(biasProcess.spotObject.lp / globalInput.ocGap) * globalInput.ocGap
}

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

function isWeekend() {
  //todo
  return true; // used to set the positions to ITM
  // const today = new Date();
  // const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  // return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

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
              positionProcess.smallestCallPosition = calls.length > 0 ? calls.reduce((min, option) => (parseFloat(option.lp) < parseFloat(min.lp) ? option : min), calls[0]) : null;;
              positionProcess.smallestPutPosition = puts.length > 0 ? puts.reduce((min, option) => (parseFloat(option.lp) < parseFloat(min.lp) ? option : min), puts[0]) : null;
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
      await delay(1000);
      await updatePositions();
      updatePositionsNeighboursAndSubs();
  } finally {
      isQueueBusy = false;
      // Process the next function call in the queue if any
      if (queue.length > 0) {
          const nextItem = queue.shift(); // Remove the item from the queue
          console.log('Processing next item in the updateTwoSmallestPositionsAndNeighboursSubs queue.');
          updateTwoSmallestPositionsAndNeighboursSubs();
      }
  }
}
// updateTwoSmallestPositionsAndNeighboursSubs();


postOrderPosTracking = () => {
  updateTwoSmallestPositionsAndNeighboursSubs();
  // Update call position subscription
  positionProcess.posCallSubStr = positionProcess.smallestCallPosition?.tsym ? `NFO|${getTokenByTradingSymbol(positionProcess.smallestCallPosition.tsym)}` : '';
  dynamicallyAddSubscription(positionProcess.posCallSubStr);
  // Update put position subscription
  positionProcess.posPutSubStr = positionProcess.smallestPutPosition?.tsym ? `NFO|${getTokenByTradingSymbol(positionProcess.smallestPutPosition.tsym)}` : '';
  dynamicallyAddSubscription(positionProcess.posPutSubStr);
}

// websocket with update smallest 2 positions on every new order
function receiveQuote(data) {
  // console.log("Quote ::", data);
  // Update the latest quote value for the corresponding instrument
  latestQuotes[data.e + '|' + data.tk] = data;
}

function receiveOrders(data) {
  // console.log("Order ::", data);
  // Update the latest order value for the corresponding instrument
  latestOrders[data.Instrument] = data;
  // update the smallest positions after each order
  postOrderPosTracking()
}

function open(data) {
  // console.log(`NSE|${globalInput.token}`)
  const initialInstruments = [`NSE|${globalInput.token}`, 'NSE|26017']; 

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
  await delay(2000);
}




// updateITMSymbolfromOC
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
  return;
}

async function updateITMSymbolfromOC() {
  await delay(1000)
  // Get the Nifty option chain
  biasProcess.optionChain = await getOptionChain();
  if (biasProcess.optionChain) {
      // Find the ITM symbol
      updateITMSymbolAndStrike();
      debug && console.log(biasProcess, ' :biasProcess')
  }
}




async function checkAlert() {
  send_notification(
      globalInput.indexName.charAt(0) +
      '[' + latestQuotes[`NSE|${globalInput.token}`]?.pc + '%] ' +
      + (latestQuotes[`NSE|${globalInput.token}`] ? Math.round(parseFloat(latestQuotes[`NSE|${globalInput.token}`].lp)): 'N/A') +
      ' (' + biasOutput.bias + ') VIX =' + biasProcess.vix + '%'
    );            
  const getVar = (key, map) => (map.get(key) ?? [])[1] ?? null;

  let cExtraVars = Array.from({ length: 4 }, (_, index) => getVar(index, positionProcess.collectedValuesCall));
  let pExtraVars = Array.from({ length: 4 }, (_, index) => getVar(index, positionProcess.collectedValuesPut));

  let [cExtra0Var, cValue1Var, cValue2Var, cExtra3Var] = cExtraVars;
  let [pExtra0Var, pValue1Var, pValue2Var, pExtra3Var] = pExtraVars;

  if (parseFloat(pValue2Var) < parseFloat(cValue1Var) || parseFloat(cValue2Var) < parseFloat(pValue1Var)) {
      let up = parseFloat(pValue2Var) < parseFloat(cValue1Var)
      let trendingUp = parseFloat(pValue1Var) > parseFloat(cExtra3Var)
      let trendingDown = parseFloat(cValue1Var) > parseFloat(pExtra3Var)
//      vix high or early morning then move away
//      vix low or not early morning then move closer
      if((up && biasOutput.bias > 0) || (!up && biasOutput.bias < 0) || trendingUp || trendingDown ){
          send_notification(`Going ${up ? 'UP':'DOWN️'}, VIX = ${biasProcess.vix}%, Bias ${biasOutput.bias}, \nCE: ${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}\nPE: ${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}`, true);
      }
  }
}



// updateBias and updateITMSymbolfromOC when atmStrike changes
myRecurringFunction = async () => {

  getAtmStrike()!= biasProcess.atmStrike && await updateITMSymbolfromOC();
  biasProcess.vix = latestQuotes['NSE|26017']?.pc;
  // console.log(latestQuotes['NSE|26017'], "latestQuotes['NSE|26017']")
  debug && console.log(`${biasProcess.itmCallSymbol}:`, latestQuotes[biasProcess.callSubStr] ? latestQuotes[biasProcess.callSubStr].lp : "N/A", "Order:", latestOrders[biasProcess.callSubStr]);
  debug && console.log(`${biasProcess.itmPutSymbol}:`, latestQuotes[biasProcess.putSubStr] ? latestQuotes[biasProcess.putSubStr].lp : "N/A", "Order:", latestOrders[biasProcess.putSubStr]);

  ltpSuggestedPut = +biasProcess.itmPutStrikePrice - (+latestQuotes[biasProcess.putSubStr].lp);
  ltpSuggestedCall = (+latestQuotes[biasProcess.callSubStr].lp + +biasProcess.itmCallStrikePrice);
  biasOutput.bias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - latestQuotes[`NSE|${globalInput.token}`].lp);
  // console.log(biasOutput.bias, ' : biasOutput.bias');
  // console.log(`vix = ${biasProcess.vix}`);

  async function dynamicallyLogPositionsLTP() {
  
    const logSubscriptions = (options, type) => {
      options?.forEach((option, key) => {
        const ltp = latestQuotes[`NFO|${getTokenByTradingSymbol(option.tsym)}`]?.lp;
        // positionProcess[type === 'PE' ? 'collectedValuesPut' : 'collectedValuesCall'].set(key, [`NFO|${option.token}`, ltp]);
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
}

function getTokenByTradingSymbol(tradingSymbol) {
  const option = biasProcess.optionChain.values.find(option => option.tsym === tradingSymbol);
  if (option) {
    return option.token;
  } else {
    return null; // TradingSymbol not found
  }
}



function updatePositionsNeighboursAndSubs() {
  const updateNeighbours = (optionChain, tsym, nearbyNeighbours, type) => {
      if (Array.isArray(optionChain)) {
          const index = optionChain.findIndex(option => option.tsym === tsym);
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
  positionProcess.callsNearbyNeighbours = updateNeighbours(biasProcess.ocCallOptions, positionProcess.smallestCallPosition, positionProcess.callsNearbyNeighbours, 'CE');
  positionProcess.putsNearbyNeighbours = updateNeighbours(biasProcess.ocPutOptions, positionProcess.smallestPutPosition, positionProcess.putsNearbyNeighbours, 'PE');

  // console.log(positionProcess, ' : positionProcess')
  // subscribe
  function dynamicallyAddSubscriptions() {
      const addSubscriptions = (options) => {
          options.forEach(option => {
              dynamicallyAddSubscription(option.tsym ? `NFO|${getTokenByTradingSymbol(option.tsym)}` : '');
              console.log(option.tsym, ' :subscribed')
          });
      };
      addSubscriptions(positionProcess.putsNearbyNeighbours);
      addSubscriptions(positionProcess.callsNearbyNeighbours);
  }
  
  // Call the function to dynamically add subscriptions for each tsym
  dynamicallyAddSubscriptions();
  

}




// main run by calling recurring function and subscribe to new ITMs for BiasCalculation
getBias = async () => {
  try {
      await executeLogin();
      await startWebsocket();
      await updateITMSymbolfromOC();
      // Start the recurring function and store the interval identifier
      intervalId = setInterval(await myRecurringFunction, globalInput.delayTime);
      // Dynamically add a subscription after 10 seconds
      biasProcess.callSubStr = biasProcess.itmCallSymbol ? `NFO|${getTokenByTradingSymbol(biasProcess.itmCallSymbol)}` : '';
      biasProcess.putSubStr = biasProcess.itmPutSymbol ? `NFO|${getTokenByTradingSymbol(biasProcess.itmPutSymbol)}` : '';
      dynamicallyAddSubscription(biasProcess.callSubStr);
      dynamicallyAddSubscription(biasProcess.putSubStr);
      await delay(1000);
      await updateTwoSmallestPositionsAndNeighboursSubs();
      await delay(1000);
      updatePositionsNeighboursAndSubs();

      // setTimeout(() => {
      //     api.closeWebSocket();
      //     websocket_closed = true;
      // }, 10000);
  } catch (error) {
      console.error(error);
  }
};
getBias();



