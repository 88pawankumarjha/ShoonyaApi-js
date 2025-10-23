const runAsyncTasks = async (api, hasRunFindNearestExpiry) => {
  try {
const axios = require('axios');
const fs = require('fs');
const unzipper = require('unzipper');
const https = require('https');
const AdmZip = require('adm-zip');
const { parse } = require('papaparse');
const moment = require('moment');
let apiLocal = api;
const today = new Date();
let isExpiryToday = today.getDay() === 1 || today.getDay() === 2; //1 for monday and 2 for tuesday
let passiveScale = isExpiryToday? 0: -1;
// let temporaryHardodedVWAPValue = 24875;

let temporaryHardodedVWAPValue;
try {
  temporaryHardodedVWAPValue = parseFloat(
    fs.readFileSync('C:/Users/88paw/OneDrive/Documents/aws/vwapValue.txt', 'utf-8').trim()
  );
  console.log('###VWAP value read from file:', temporaryHardodedVWAPValue);
} catch (e) {
  console.error('###Could not read VWAP value from file, using default.');
  temporaryHardodedVWAPValue = 24875; // fallback value
}
let biasFlag = false, biasFlagNumber = 0;
// let indices = ['SENSEX'];
let indices = ['NIFTY'];
// const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX'];

const { calculateAtmOptionsSumPrice, i4find_bias } = require('./utils/i4Utils');
let { authparams, telegramBotToken, chat_id, chat_id_me } = require("./creds");
const { idxNameTokenMap, idxNameOcGap, downloadCsv, filterAndMapDates,
  identify_option_type, fetchSpotPrice, getStrike, getOptionBasedOnNearestPremium, calcPnL, isTimeEqualsNotAfterProps, calcVix } = require('./utils/customLibrary');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let globalBigInput = {filteredIndexCSV: undefined}

const debug = false;

// getPickedIndexHere = () => debug ? 'NIFTY' : indexDayArray[new Date().getDay()] || 'NIFTY';
getPickedIndexHere = () => 'NIFTY';
// qty for margin to sell both sides
getEMAQtyFor2L = () => debug ? 100 : [100, 60, 120, 60, 150, 50, 100][new Date().getDay()] || 100;

let globalInput = {
  susertoken: '',
  secondSession: false,
  launchChildProcessApp: false,
  indexName: getPickedIndexHere(),
  previousIndexName: '',
  previousWeeklyExpiry: '',
  finalWeeklyExpiry: '',
  finalWeeklyExpiryName: '',
  finalWeeklyExpiryExchange: '',
  emaLotMultiplierQty: getEMAQtyFor2L(),
  inputOptTsym: '',
  WEEKLY_EXPIRY: '',
  MONTHLY_EXPIRY: '',
  pickedExchange: '',
  LotSize: '',
  emaLotMultiplier: 0,
  token: '',
  ocGap: 0,
  keyword: '',
  atmStrike: 0,
  atmStrikePrice: 0,
  atmStrikeToken: '',
  optionInAction: '',
  bias: false,
  limits: 0,
  spotLP: 0,
  resultBias : {}
}

// globalInput.atmStrikeToken:  {
//   susertoken: '',
//   secondSession: false,
//   launchChildProcessApp: false,
//   indexName: 'NIFTY',
//   previousIndexName: '',
//   previousWeeklyExpiry: '',
//   finalWeeklyExpiry: '2024-12-19',
//   finalWeeklyExpiryName: 'NIFTY',
//   finalWeeklyExpiryExchange: 'NFO',
//   emaLotMultiplierQty: 60,
//   inputOptTsym: 'NIFTY19DEC24P29500',
//   WEEKLY_EXPIRY: '2024-12-19',
//   MONTHLY_EXPIRY: '2024-12-26',
//   pickedExchange: 'NFO',
//   LotSize: '25',
//   emaLotMultiplier: 2,
//   token: '26000',
//   ocGap: 50,
//   keyword: 'NIFTY ',
//   atmStrike: 24600,
//   atmStrikePrice: 24600,
//   atmStrikeToken: '47416',
//   optionInAction: 'NIFTY19DEC24P24600'
// }

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
    try {
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo('./', true);
    //console.log('Unzipped in the current working directory.');
  } catch (error) {
    console.error('Error in unzipFile');
  }
}

async function findNearestExpiry(exchangeType, inputIndexName) {
  let csvUrl, zipFilePath, csvFilePath;
  csvUrl = `https://api.shoonya.com/${exchangeType}_symbols.txt.zip`;
  const zipFileUrl = csvUrl;
  const downloadedFileName = `${exchangeType}_symbols.txt.zip`;
  zipFilePath = `./${exchangeType}_symbols.zip`;
  csvFilePath = `./${exchangeType}_symbols.txt`;
  try {
    if (!hasRunFindNearestExpiry) {
      downloadFile(zipFileUrl, downloadedFileName)
        .then(() => {
          unzipFile(downloadedFileName);
        })
        .catch(error => {
          console.error('Error in unzipping file');
        });
    }
    await delay(1000);
    // Read CSV data into a JavaScript object
    const csvData = fs.readFileSync(csvFilePath, 'utf-8');
    const { data: symbolDf } = parse(csvData, { header: true });
    //exclude sensex50
    // console.log(symbolDf, "symbolDf");
    // console.log(inputIndexName, 'inputIndexName');
    const filteredRows = symbolDf.filter((row) => ['OPTIDX', 'FUTIDX'].includes(row.Instrument) && row.TradingSymbol.toUpperCase().startsWith(inputIndexName.toUpperCase()) && !row.TradingSymbol.startsWith('NIFTYNXT50') && !row.TradingSymbol.startsWith('SENSEX50') && !row.TradingSymbol.startsWith('ZYDUSLIFE'))
    // console.log(filteredRows, 'filteredRows');
    globalBigInput.filteredIndexCSV = filterAndMapDates(moment, filteredRows);
    // console.log('Input Index Name:', inputIndexName);
    // console.log('Final Filtered Rows:', globalBigInput.filteredIndexCSV);
    const expiryList = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => row.Instrument === 'OPTIDX').map((row) => row?.Expiry || ''))];
    const expiryFutList = globalBigInput.filteredIndexCSV
      .filter((row) => row.Instrument === 'FUTIDX')
      .map((row) => ({ Exchange: row.Exchange, LotSize: row.LotSize, TradingSymbol: row.TradingSymbol, Expiry: row?.Expiry || '' }));
    expiryList.sort();
    expiryFutList.sort((a, b) => moment(a.Expiry).diff(moment(b.Expiry)));

    globalInput.inputOptTsym = [...new Set(globalBigInput.filteredIndexCSV.filter((row) => (row.Instrument === 'OPTIDX' && row.Expiry === expiryList[isExpiryToday? 1: 0])).map((row) => row.TradingSymbol))][0];
    globalInput.WEEKLY_EXPIRY = expiryList[isExpiryToday? 1: 0];
    globalInput.MONTHLY_EXPIRY = expiryFutList[0]?.Expiry;
    globalInput.pickedExchange = expiryFutList[0]?.Exchange;
    globalInput.LotSize = expiryFutList[0]?.LotSize ? Number(expiryFutList[0].LotSize) : 75;
    // globalInput.LotSize = 75;
    globalInput.emaLotMultiplier = Math.floor(globalInput.emaLotMultiplierQty / globalInput.LotSize);

    // globalInput.finalWeeklyExpiryName.obj =expiryFutList[0]
    // console.log('findNearest Expiry done: ', inputIndexName , ' : ', globalInput);
  } catch (error) {
    console.error('Error in reading file');
  }
};

async function runFindNearestExpiry(currentIndexType, currentIndexName) {
  try {
    await findNearestExpiry(currentIndexType, currentIndexName);

    const previousFinalWeeklyExpiry = globalInput.finalWeeklyExpiry;
    const previousFinalWeeklyExpiryName = globalInput.finalWeeklyExpiryName;
    const previousFinalWeeklyExpiryExchange = globalInput.finalWeeklyExpiryExchange;

    const currentWeeklyExpiry = globalInput.WEEKLY_EXPIRY;

    if (globalInput.finalWeeklyExpiry != '' && previousFinalWeeklyExpiry < currentWeeklyExpiry) { // '2024-11-25' < '2024-11-26' ==> true
      globalInput.finalWeeklyExpiry = previousFinalWeeklyExpiry;
      globalInput.finalWeeklyExpiryName = previousFinalWeeklyExpiryName;
      globalInput.finalWeeklyExpiryExchange = previousFinalWeeklyExpiryExchange;

    } else {
      globalInput.finalWeeklyExpiry = currentWeeklyExpiry;
      globalInput.finalWeeklyExpiryName = currentIndexName;
      globalInput.finalWeeklyExpiryExchange = currentIndexType;
    }
    return;
  } catch (error) {
    console.error(`Error running findNearestExpiry for ${currentIndexType} ${currentIndexName}:`, error);
  }
}

async function findNearestExpiryLoop() {
    // await runFindNearestExpiry('NFO', 'BANKNIFTY');
    // await runFindNearestExpiry('NFO', 'FINNIFTY');
    // await runFindNearestExpiry('BFO', 'BANKEX');
    await runFindNearestExpiry('NFO', 'NIFTY');
    // await runFindNearestExpiry('BFO', 'SENSEX');

    // console.log(globalInput, 'globalInput.finalWeeklyExpiryExchange, globalInput.finalWeeklyExpiryName')
// console.log('before then async', globalInput.LotSize)
    // await runFindNearestExpiry(globalInput.finalWeeklyExpiryExchange, globalInput.finalWeeklyExpiryName)
    await runFindNearestExpiry(globalInput.finalWeeklyExpiryExchange, globalInput.finalWeeklyExpiryName);
    // console.log('after then async', globalInput.LotSize)
    // console.log(globalInput, 'globalInput.finalWeeklyExpiryExchange, globalInput.finalWeeklyExpiryName2')
// try{
//     let searchResult2 = await apiLocal.searchscrip(globalInput.finalWeeklyExpiryExchange, globalInput.inputOptTsym.replace(/\d+$/, ''));
//     console.log(searchResult2, 'searchResult2');
//   } catch (error) {
//     console.log('error in findNearestExpiryLoop', error);
//   }
// console.log(apiLocal, globalInput.atmStrikeToken, globalInput.finalWeeklyExpiryExchange, 'apiLocal, globalInput.atmStrikeToken, globalInput.finalWeeklyExpiryExchange');
//     fetchSpotPrice(apiLocal, globalInput.atmStrikeToken, globalInput.finalWeeklyExpiryExchange).then((SpotOfATMOption) => {  
      // console.log('SpotOfATMOption: ', SpotOfATMOption)
    // })
    // console.log('SpotOfATMOption: ', SpotOfATMOption)

  // })
  globalInput.indexName = globalInput.finalWeeklyExpiryName; // Update the indexName
  // console.log("globalInput.finalWeeklyExpiry: ", globalInput.finalWeeklyExpiry, globalInput.finalWeeklyExpiryName);
  // STEP 2: find the index name which has nearest expiry
  await runEma();
}

const runEma = async () => {
  try {
    const searchResult = await apiLocal.searchscrip(globalInput.finalWeeklyExpiryExchange, globalInput.inputOptTsym);
    // console.log(searchResult, 'searchResult2');
    globalInput.LotSize = searchResult.values[0].ls ? Number(searchResult.values[0].ls) : 75;
    // globalInput.LotSize = 75;
    await findBias();
    await takePosition();

  } catch (error) {
    console.log(error)
  }
}

let atmStrike = '';
let atmCalcStrike = '';
let atmOptions = [];
let atmOptionsPrice = [];
let atmOptionsSumPriceVwap = '';
let bias = '';
let indexLP = "25000";

// const getAtmStrike = async () => {
//   try {
//       atmStrike = "25000";
//   } catch (error) {
//     console.log('error in getAtmStrike')
//   }
// };


// const getCalcAtmStrike = async () => {
//   try {
//       atmCalcStrike = atmStrike + (atmOptionsPrice[0] - atmOptionsPrice[1])/2;
//   } catch (error) {
//     console.log('error in getCalcAtmStrike')
//   }
// };

// const getAtmOptions = async (atmStrikeInput) => {
//   try {
//     //refer atmStrike and atmCalcStrike as inputs
//     atmOptions = ['NIFTY05DEC24C25000', 'NIFTY05DEC24P25000'];
//     atmOptionsPrice = ['10', '11'];
//     bias = (+atmOptionsPrice[0] - +atmOptionsPrice[1])/2;
//   } catch (error) {
//     console.log('error in getAtmOptions')
//   }
// };

// const getAtmOptionsSumPriceVwap = async () => {
//   try {
//     atmOptionsSumPriceVwap = "22";
//   } catch (error) {
//     console.log('error in getVWAP')
//   }
// };

let nbfsbBias = [];

const findBias= async () => {
// TODO
  // find vwap of sum of ATM options price - if price from calc of ATM options price > vwap then do not sell
  // if(indexLP > indexVwap) ==> console.log('only +ve bias to be considered - positive bias  is ', bias > 0);
  

  // await getAtmStrike();
  // await getAtmOptions(atmStrike);
  // // await getCalcAtmStrike();
  // // await getAtmOptions(atmCalcStrike);
  // const atmOptionsSumPrice = calculateAtmOptionsSumPrice(atmOptionsPrice);
  // await getAtmOptionsSumPriceVwap(atmOptions);
  // if(atmOptionsSumPrice > atmOptionsSumPriceVwap) {
  //   console.log('do not enter sell trades as atmOptionsSumPrice > atmOptionsSumPriceVwap is true');
  // }
  // else{
  //   // find VWAP of index - above VWAP only +ve bias to be considered and below VWAP only -ve bias
  //   indexVwap = "25001";
  //   if(indexLP > indexVwap) {
  //     console.log('only +ve bias to be considered - positive bias  is ', bias > 0);
  //   } else {
  //     console.log('only -ve bias to be considered - negative bias  is ', bias < 0);
  //   }
  // }
  const biasesConfig = [];

    biasesConfig.push({ exch: 'NFO', token: '26000', ocGap: 50, keyword: 'NIFTY ' });
    // biasesConfig.push({ exch: 'NFO', token: '26009', ocGap: 100, keyword: 'BANKNIFTY ' });
    // biasesConfig.push({ exch: 'NFO', token: '26037', ocGap: 50, keyword: 'FINNIFTY ' });
    // biasesConfig.push({ exch: 'BFO', token: '1', ocGap: 100, keyword: 'SENSEX ' });
    // biasesConfig.push({ exch: 'BFO', token: '12', ocGap: 100, keyword: 'BANKEX ' });
    
    const biases = await Promise.all(
      biasesConfig.map(config => i4find_bias(apiLocal, config.token, config.ocGap, config.keyword, config.exch))
    );
    
    const filteredBiases = biases.filter(bias => bias !== null);
    // console.log(filteredBiases);
    try {
      nbfsbBias = filteredBiases.map(item => {
        const match = item.match(/\((-?\d+)\)$/);
        return match && match[1] ? match[1] : null;
      });
      // console.log("nbfsb bias: ", nbfsbBias);

      globalInput.token = biasesConfig.find(obj => obj.keyword.includes(globalInput.finalWeeklyExpiryName))?.token;
      globalInput.ocGap = biasesConfig.find(obj => obj.keyword.includes(globalInput.finalWeeklyExpiryName))?.ocGap;
      globalInput.keyword = biasesConfig.find(obj => obj.keyword.includes(globalInput.finalWeeklyExpiryName))?.keyword;
    } catch (error) {
      console.log('error in findBias', error);
    }
    
};

const findIndexVwapValue = async () => {
  try {
    return temporaryHardodedVWAPValue;
  } catch (error) {
    console.log('error in findIndexVwapValue', error);
  }
};

const checkPositiveBias = async () => {
  indices = [globalInput.finalWeeklyExpiryName];
  indices.forEach((index, i) => {
    globalInput.resultBias[index] = nbfsbBias[i];
  });
  
  biasFlagNumber = globalInput.resultBias[globalInput.finalWeeklyExpiryName] > 0 ? biasFlagNumber + 1 : biasFlagNumber - 1;
    console.log('### --- biasFlagNumber0 bias:', biasFlagNumber);

    //calc if spot is above vwap then increase biasFlagNumber else decrease biasFlagNumber
  let indexLP = globalInput.spotLP;
  // indexVwap = globalInput.atmStrikePrice;
  let indexVwap = await findIndexVwapValue();

  biasFlagNumber = indexLP > indexVwap ? biasFlagNumber + 2 : biasFlagNumber - 2;
  console.log('### --- biasFlagNumber vwap:', biasFlagNumber);

  //vix (if high vix then decrease biasFlagNumber else increase biasFlagNumber)
  const calcVixVal = await calcVix(api);
  if(calcVixVal > 0) {biasFlagNumber = biasFlagNumber > 0 ? biasFlagNumber - 1 : biasFlagNumber < 0 ? biasFlagNumber + 1 : biasFlagNumber}
  else if(calcVixVal < 0) {biasFlagNumber = biasFlagNumber > 0 ? biasFlagNumber + 1 : biasFlagNumber - 1}
  console.log('### --- biasFlagNumber vix:', biasFlagNumber);

  
  //vix (if PNL is positive then move it towards negative biasFlagNumber else bring it closer to 0)
  const calcPnLValue = await calcPnL(api);
  if(calcPnLValue < 0) {biasFlagNumber = biasFlagNumber > 0 ? biasFlagNumber - 1 : biasFlagNumber < 0 ? biasFlagNumber + 1 : biasFlagNumber}
  else if(calcPnLValue > 0) {biasFlagNumber = biasFlagNumber > 0 ? biasFlagNumber + 1 : biasFlagNumber - 1}
  console.log('### --- biasFlagNumber PnL:', biasFlagNumber);

  // set the biasFlag 
  if (biasFlagNumber > 0) {biasFlag = true, globalInput.skipTakingNewOrders = false}
  else if (biasFlagNumber < 0) {biasFlag = false, globalInput.skipTakingNewOrders = false}
  else {biasFlag = false, globalInput.skipTakingNewOrders = true}
  
  console.log('### vw', indexVwap, 'v:', calcVixVal, ' bias#:', biasFlagNumber);

  return biasFlag;
}

const getATMToken = async (side) => {
  // console.log(globalInput.keyword, globalInput.atmStrike, side, 'globalInput.keyword, globalInput.atmStrike, side')
  // let newSearchSymbol = globalInput.keyword + (globalInput.atmStrike) + ` ${side ? 'PE' : 'CE'}`;
  // console.log(newSearchSymbol, 'newSearchSymbol')
  // const searchResult = await apiLocal.searchscrip(globalInput.finalWeeklyExpiryExchange, newSearchSymbol);
  // console.log(searchResult, 'searchResult');
  // if(keyword[0] === getPickedIndex()[0] && globalInput.finalWeeklyExpiryExchange === 'BFO')
  //    {
  //       debug && console.log(searchResult, 'searchResult');
  //       return searchResult.values[searchResult.values.length - 1].token;
  //   }
  //   else {
        // console.log(searchResult.values[0].tsym, 'searchResult.values[0].tsym');
        
        //TODO: improve this hardcoded one
        globalInput.ocGap = globalInput.keyword.startsWith('NIFTY') ? 50 : 100;
        
        calcOcGapMultiplier = side? -(passiveScale):(passiveScale);
        let mewOTMSearchSymbol = globalInput.keyword + (globalInput.atmStrike + (globalInput.ocGap * calcOcGapMultiplier)) + ` ${side ? 'PE' : 'CE'}`;
        const searchResultOTM = await apiLocal.searchscrip(globalInput.finalWeeklyExpiryExchange, mewOTMSearchSymbol);
        globalInput.optionInAction = searchResultOTM.values[isExpiryToday? 1: 0].tsym;

        return searchResultOTM?.values[0].token;
    // }
};

const findATM = async () => {
  try {

    const Spot = await fetchSpotPrice(apiLocal, globalInput.token, globalInput.finalWeeklyExpiryExchange);
    console.log('### SPT :', Spot?.lp)
    globalInput.spotLP = Spot?.lp;
    // Spot:  {
    //   request_time: '11:01:08 17-12-2024',
    //   stat: 'Ok',
    //   exch: 'NSE',
    //   tsym: 'Nifty 50',
    //   cname: 'NIFTY INDEX',
    //   symname: 'NIFTY',
    //   seg: 'EQT',
    //   instname: 'UNDIND',
    //   pp: '2',
    //   ls: '1',
    //   ti: '0.05',
    //   mult: '1',
    //   lut: '1734413467',
    //   wk52_h: '26277.35',
    //   wk52_l: '21137.20',
    //   toi: '30151175',
    //   cutof_all: 'false',
    //   prcftr_d: '(1 / 1 ) * (1 / 1)',
    //   token: '26000',
    //   lp: '24493.60',
    //   c: '24668.25',
    //   h: '24624.10',
    //   l: '24383.75',
    //   o: '24584.80'
    // }

    if (!Spot) { console.log('Not able to find the spot'); return null; }
    
    const ltp_rounded = Math.round(parseFloat(Spot.lp));
    const open = Math.round(parseFloat(Spot.o || Spot.c || Spot.lp)); // c for days when market is closed
    // console.log(open, 'open, ', ltp_rounded, ' ltp_rounded, = ', ltp_rounded-open, " ltp_rounded-open", globalInput.ocGap, 'globalInput.ocGap')
    const mod = ltp_rounded % globalInput.ocGap;
    const atmStrike = mod < globalInput.ocGap / 2 ? Math.floor(ltp_rounded / globalInput.ocGap) * globalInput.ocGap : Math.ceil(ltp_rounded / globalInput.ocGap) * globalInput.ocGap;

    globalInput.atmStrike = atmStrike;
    globalInput.atmStrikePrice = atmStrike;
    const checkPositiveBiasValue = await checkPositiveBias();
    globalInput.bias = checkPositiveBiasValue;
    globalInput.atmStrikeToken = await getATMToken(checkPositiveBiasValue);
    // globalInput.atmStrikeToken = await getATMToken(false);
    
    // console.log("###globalInput.atmStrikeToken: ", globalInput);
  
  } catch (error) { 
    console.log('error in findATM', error);
  }
}

const getLimitsCash = async () => {
  try {
    const limits = await apiLocal.get_limits()
    // console.log("Limits: ", limits);
    // Limits:  {
    //   request_time: '11:49:38 06-01-2025',
    //   stat: 'Ok',
    //   prfname: 'SHOONYA',
    //   cash: '267557.00',
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
    //   turnover: '3856636.00',
    //   pendordval: '8280.00',
    //   marginused: '205139.31',
    //   peak_mar: '219355.26',
    //   margincurper: '76.67',
    //   urmtom: '-1807.00',
    //   span: '170271.15',
    //   expo: '32792.52',
    //   premium: '2044.00',
    //   brokerage: '31.64',
    //   uzpnl_d_m: '-1807.00',
    //   span_d_m: '170271.15',
    //   expo_d_m: '32792.52',
    //   premium_d_m: '984.00',
    //   premium_c_m: '1060.00',
    //   brkage_d_m: '25.58',
    //   brkage_c_m: '6.06',
    //   blk_amt: '0.00',
    //   mr_der_u: '1938.52',
    //   mr_com_u: '10.60',
    //   mr_der_a: '938.54',
    //   mr_com_a: '266618.46'
    // }
    globalInput.limits = Math.floor(+(limits?.collateral) + +(limits?.payout));
    // console.log("Limits: ", globalInput.limits);

  } catch (error) {
    console.log('error in getLimitsCash', error);
  }
}

const takePosition = async () => {
  
  // globalInput.bias = false;
  await findATM();
  await getLimitsCash();

  // console.log(" dummy takePosition");
  //find old bias rule then sell OTM worth Rs 200 and SL as double price of entry price
  // as soon as 50 Rs decay then bring SL to entry price
  //exit on 100 Rs decay
  //repeat after exit until 2:50 PM 
};


// STEP 1: find the index name which has nearest expiry
await findNearestExpiryLoop();


return globalInput;
} catch (error) {
  console.error("Error in runAsyncTasks:", error);
  // throw error;
}

}
module.exports = {runAsyncTasks};
