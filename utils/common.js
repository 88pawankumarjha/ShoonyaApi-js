const debug = false;
const TelegramBot = require('node-telegram-bot-api');
const { telegramBotToken } = require('../creds');
const { chat_id_me } = require('../creds');
const { chat_id } = require('../creds');
const { isTimeEqualsNotAfterProps, identify_option_type, fetchSpotPrice, delay, getStrike, calcVix, nearByTsymPutAgg, nearByTsymPutSub, nearByTsymCallAgg, nearByTsymCallSub, nearByPositions, calcPnL } = require('./customLibrary');
let apiLocal;
const bot = new TelegramBot(telegramBotToken, { polling: true });
let interval = 10000, setCustomInterval = value => interval = value ? interval + 50000 : 10000, getCustomInterval = () => interval;
let stopSignal = false, setStopSignal = value => stopSignal = value, getStopSignal = () => stopSignal;
const getIsBFO = () => [1, 5, 6].includes(new Date().getDay());
let vixQuoteCalc = 0;

const isTimeAfter330PM = () => {
  //return true;
  return isTimeEqualsNotAfterProps(15,30,false);
};
const isTimeAfter328PM = () => {
  return isTimeEqualsNotAfterProps(15,28,false);
};
const isTimeBefore1147PM = () => {
  return !isTimeEqualsNotAfterProps(23,47,false);
};
const isTimeAfter1147PM = () => !(isTimeAfter330PM && isTimeBefore1147PM());
let pickedExchange = debug ? 'BFO' : isTimeAfter330PM() ? 'MCX' : getIsBFO() ? 'BFO' : 'NFO';
getPickedIndex = () => debug ? 'NIFTY' : ['NIFTY', 'BANKEX', 'FINNIFTY', 'BANKNIFTY', 'NIFTY', 'SENSEX', 'BANKEX'][new Date().getDay()] || 'NIFTY';
const setPickedExchange = value => pickedExchange = value, getPickedExchange = () => pickedExchange;
const send_notification = async (message, me = false) => console.log(message) || (!debug && message && await bot.sendMessage(me ? chat_id_me : chat_id, me ? message : message.replace(/\) /g, ")\n")).catch(console.error));
let calcBias = 0;
let multiplier = 2;
let exitMTM = -1500;
let gainExitMTM = 350;
let magicNumber = 250;
let aggressiveMagicNumber = 350;
let slOrders = '';
let slOrdersExtra = '';
let ocGapCalc = 0;
let mtmValue = 0;
let iterationCounter = 0;
let exitFlag = false;
let exitAllFlag = false;
let positionsData;

let callPositions= [];
let putPositions= [];
let smallestCallPosition = {};
let smallestPutPosition = {};

// Enum for context types
const actionType = {
  BOT: 'bot',
  MANUAL: 'other',
};

async function send_callback_notification() {
  try {
      const keyboard = {inline_keyboard: [[
              { text: '🐌', callback_data: 'slower' },
              { text: '🚀', callback_data: 'faster' },
              { text: 'CA', callback_data: 'CA' },
              { text: 'CS', callback_data: 'CS' },
              { text: 'PA', callback_data: 'PA' },
              { text: 'PS', callback_data: 'PS' },
              { text: '🛑', callback_data: 'stop' },
              { text: '×', callback_data: 'exit' }
            ]]};
    !debug && bot.sendMessage(chat_id_me, 'Choose server settings', { reply_markup: keyboard });
  } catch (error) { console.error(error);send_notification(error + ' error occured', true)}
}

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const exchange = getPickedExchange();
  if (data === 'slower') setCustomInterval(true);
  else if (data === 'faster') setCustomInterval(false);
  else if (data === 'CA') {
    (async () => {
      send_notification('CA clicked', true)
      await takeDecision(apiLocal, false, -1, actionType.MANUAL)
    })();
  }
  else if (data === 'CS') {
    (async () => {
      send_notification('CS clicked', true)
      await takeDecision(apiLocal, true, 1, actionType.MANUAL)
    })();
  }
  else if (data === 'PA') {
    (async () => {
      send_notification('PA clicked', true)
      await takeDecision(apiLocal, true, -1, actionType.MANUAL)
    })();
  }
  else if (data === 'PS') {
    (async () => {
      send_notification('PS clicked', true)
      await takeDecision(apiLocal, false, 1, actionType.MANUAL)
    })();
  }
  else if (data === 'stop') stopSignal = !stopSignal;
  else if (data === 'exit') {getPickedExchange() === 'MCX' ? exitAllFlag=true : exitAll(apiLocal);}
  else if (data === 'toggleExchange') setPickedExchange(getPickedExchange() === 'NFO' ? 'BFO' : getPickedExchange() === 'BFO' ? 'MCX' : 'NFO');
  bot.sendMessage(chatId, `Delay: ${getCustomInterval() / 1000} sec, Exchange: ${getPickedExchange()}, Stopped: ${getStopSignal()}`);
});

async function find_bias(api, inputToken, ocGap, keyword) {
  try {
    const Spot = await fetchSpotPrice(api, inputToken, getPickedExchange());
    if (!Spot) { console.log('Not able to find the spot'); return null; }
    debug && console.log(Spot)
    const ltp_rounded = Math.round(parseFloat(Spot.lp));
    const open = Math.round(parseFloat(Spot.o || Spot.c || Spot.lp)); // c for days when market is closed
    debug && console.log(open, 'open, ', ltp_rounded, ' ltp_rounded, = ', ltp_rounded-open, " ltp_rounded-open")
    const mod = ltp_rounded % ocGap;
    const atmStrike = mod < ocGap / 2 ? Math.floor(ltp_rounded / ocGap) * ocGap : Math.ceil(ltp_rounded / ocGap) * ocGap;

    const getATMToken = async (side) => {
      let newSearchSymbol = keyword + (atmStrike + ocGap * side) + ` ${Number(side) > 0 ? 'PE' : 'CE'}`;
      debug && console.log(newSearchSymbol, 'newSearchSymbol')
      const searchResult = await api.searchscrip(getPickedExchange(), newSearchSymbol);
      // if(keyword[0] === getPickedIndex()[0] && getPickedExchange() === 'BFO')
      //    {
      //       debug && console.log(searchResult, 'searchResult');
      //       return searchResult.values[searchResult.values.length - 1].token;
      //   }
      //   else {
            debug && console.log(searchResult.values[0].tsym, 'searchResult.values[0].tsym');
            return searchResult.values[0].token;
        // }
    };

    let biasDiffOC = getPickedExchange() === 'BFO' ? 1: 2;
    debug && console.log(biasDiffOC, 'biasDiffOC');
    const [ATMToken1, ATMToken2] = await Promise.all([getATMToken(-1 * biasDiffOC), getATMToken(biasDiffOC)]);
    const [ltpPut, ltpCall] = await Promise.all([
      api.get_quotes(getPickedExchange(), ATMToken2).then(response => parseFloat(response.lp) || 0),
      api.get_quotes(getPickedExchange(), ATMToken1).then(response => parseFloat(response.lp) || 0)
    ]);
    const ltpSuggestedPut = atmStrike + ocGap * 2 - ltpPut;
    const ltpSuggestedCall = atmStrike - ocGap * 2 + ltpCall;
    if(debug){console.log(Spot.lp,'Spot') // lp 49911.73
    console.log(ltpPut,'ltpPut')
    console.log(ltpSuggestedPut,'ltpSuggestedPut')
    console.log(ltpCall,'ltpCall')
    console.log(ltpSuggestedCall,'ltpSuggestedCall') }
    let localCalcBias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - ltp_rounded);
    if(keyword[0] === getPickedIndex()[0]) calcBias = localCalcBias;
    debug && console.log(calcBias, ' : calcBias')
    return `${keyword[0]}[${ltp_rounded-open}] ${ltp_rounded+localCalcBias} (${localCalcBias})`;
  } catch (error) { console.error('Error:', error); send_notification(error + ' error occured', true); return null; }
}

async function fetchAllBiases(api, exchange = 'NFO', iteration) {
  try {
    apiLocal = api;
    const biasesConfig = [];
    if (getPickedExchange() === 'NFO') {
        biasesConfig.push({ token: '26000', ocGap: 50, keyword: 'NIFTY ' });
        biasesConfig.push({ token: '26009', ocGap: 100, keyword: 'BANKNIFTY ' });
        biasesConfig.push({ token: '26037', ocGap: 50, keyword: 'FINNIFTY ' });
    }
    if (getPickedExchange() === 'BFO') {
      biasesConfig.push({ token: '1', ocGap: 100, keyword: 'SENSEX ' });
      biasesConfig.push({ token: '12', ocGap: 100, keyword: 'BANKEX ' });
    }
    if (getPickedExchange() === 'MCX') {
//      biasesConfig.push({ token: '1', ocGap: 100, keyword: 'SENSEX ' });
//      biasesConfig.push({ token: '12', ocGap: 100, keyword: 'BANKEX ' });
    }
    const biases = await Promise.all(
      biasesConfig.map(config => find_bias(api, config.token, config.ocGap, config.keyword, getPickedExchange()))
    );
    const filteredBiases = biases.filter(bias => bias !== null);
    await send_notification(filteredBiases.join(' '));

    iteration === 1  && await send_callback_notification();
  } catch (error) { console.error('Error fetching all biases:', error); send_notification(error + ' error occured', true) }
}

const checkL1Alert = (slOrders) => {
    // Regular expression pattern to capture P and C values with both possible orders
    const pattern = /(P: (\d+\.\d+) \((\d+\.\d+)\))|(C: (\d+\.\d+) \((\d+\.\d+)\))/g; //"C: 0.65 (1.05) P: 0.60 (0.80)";
    let match;
    let pValue1Var, pValue2Var, cValue1Var, cValue2Var; //slOrders
    while ((match = pattern.exec(slOrders)) !== null) {
        const [, pGroup, pValue1, pValue2, , cValue1, cValue2] = match;
        pGroup ? ([pValue1Var, pValue2Var] = [pValue1, pValue2]) : ([cValue1Var, cValue2Var] = [cValue1, cValue2]);
    }
    return [pValue1Var, pValue2Var, cValue1Var, cValue2Var];
}
let timeBasedMethodExecuted = false;

const timeToMakeAMove = () => {
  return isTimeEqualsNotAfterProps(9,40,true) || isTimeEqualsNotAfterProps(10,40,true) || isTimeEqualsNotAfterProps(11,40,true) || isTimeEqualsNotAfterProps(12,40,true) || isTimeEqualsNotAfterProps(13,40,true);
}
async function checkAlert(api) {
    let [pValue1Var, pValue2Var, cValue1Var, cValue2Var] = checkL1Alert(slOrders);
    let [pExtra0Var, pExtra3Var, cExtra0Var, cExtra3Var] = checkL1Alert(slOrdersExtra);
    debug && console.log(pExtra0Var,pValue1Var,pValue2Var,pExtra3Var,' P'); //0.65 1.10 2.60 9.05
    debug && console.log(cExtra0Var,cValue1Var,cValue2Var,cExtra3Var,' C'); //1.35 3.70 14.10 57.50
    timeToMakeAMoveVal = timeToMakeAMove()

    if(pValue1Var == undefined || cValue1Var== undefined ) {
      send_notification('SL HIT', true)
    }
    
    if (timeToMakeAMoveVal || parseFloat(pValue2Var) < parseFloat(cValue1Var) || parseFloat(cValue2Var) < parseFloat(pValue1Var)) {
        if(!timeToMakeAMoveVal){
          let up = parseFloat(pValue2Var) < parseFloat(cValue1Var)
          let trendingUp = parseFloat(pValue1Var) > parseFloat(cExtra3Var)
          let trendingDown = parseFloat(cValue1Var) > parseFloat(pExtra3Var)
  //      vix high or early morning or Bias opposite then move away
  //      vix low or not early morning or Bias favouring then move closer
          if((up && calcBias > 0) || (!up && calcBias < 0) || trendingUp || trendingDown ){
              vixQuoteCalc = await calcVix(api);
              debug && console.log(vixQuoteCalc, 'vixQuoteCalc')
              send_notification(`Going ${up ? 'UP':'DOWN️'}, VIX = ${vixQuoteCalc}%, Bias ${calcBias}, '\n'${cExtra0Var} ,${cValue1Var} ,${cValue2Var} ,${cExtra3Var}'\n'${pExtra0Var} ,${pValue1Var} ,${pValue2Var} ,${pExtra3Var}`, true);
              await takeDecision(api, up, vixQuoteCalc, actionType.BOT)
          }
        }
        else{
          timeBasedMethodExecuted = true;
          // time to make a move
          let inputMagicNumber = vixQuoteCalc > 0 ? magicNumber/Math.abs(+smallestCallPosition?.ls): aggressiveMagicNumber/Math.abs(+smallestCallPosition?.ls);
          if(+pValue1Var < inputMagicNumber && +cValue1Var < inputMagicNumber){
            if(+pValue1Var < +cValue1Var){
              // bring put closer
              await takeDecision(apiLocal, true, -1, actionType.BOT)
              send_notification('made a move based on time to take put closer', true)
            }else{
              // bring call closer
              await takeDecision(apiLocal, false, -1, actionType.BOT)
              send_notification('made a move based on time to take call closer', true)
            }
          } else {
            send_notification('no action taken based on time')
          }
          setTimeout(() => {
            timeBasedMethodExecuted = false;
          }, 60000); // Reset the flag after 60 seconds (1 minute)
      }
    }
}

function findCloserToMagicNumber(number1, number2, inputNumber) {
  const difference1 = Math.abs(number1 - inputNumber); // magicNumber = 250, aggressiveMagicNumber = 350
  const difference2 = Math.abs(number2 - inputNumber);

  if (difference1 < difference2) {
      return 1;
  } else if (difference2 <= difference1) {
      return 2; //number2 + " is closer to inputNumber 250";
  }
}

// Example usage
// const result = findCloserToMagicNumber(200, 300, 250);
// console.log(result);


const takeDecision = async (api, up, vixQuoteCalc, actionTypeInput) => {
  try{
    await updatePositions(api);
    
    // goSubmissive if already in straddle
    putStrike = getStrike(smallestPutPosition?.tsym, getPickedExchange())
    callStrike = getStrike(smallestCallPosition?.tsym, getPickedExchange())
    //auto adjustments
    if(actionTypeInput == actionType.BOT) {
      //aggressive if vix is low
      inputNumberSent = vixQuoteCalc > 0 ? magicNumber/Math.abs(+smallestCallPosition?.ls): aggressiveMagicNumber/Math.abs(+smallestCallPosition?.ls);
      //find closest to magic number
      closerNumber = findCloserToMagicNumber(+smallestCallPosition?.lp, +smallestPutPosition?.lp, +inputNumberSent)
      // send_notification(inputNumberSent + ': inputNumberSent, ' + closerNumber + ': closerNumber, ' + smallestCallPosition?.lp + ': smallestCallPosition?.lp, ' + smallestPutPosition?.lp + ': smallestPutPosition?.lp', true)
      if (+closerNumber == 1) { // call is closer to magic number
        if(+smallestCallPosition?.lp < +inputNumberSent){
          if(+smallestCallPosition?.lp < +smallestPutPosition?.lp){
            vixQuoteCalc = -1;
            up = false;
            // send_notification("call comes closer1", true);
          }else{
            vixQuoteCalc = -1;
            up = true;
            // send_notification("put comes closer1", true);
          }
        } else {
          if(+smallestCallPosition?.lp < +smallestPutPosition?.lp){  
            vixQuoteCalc = 1;
            up = false;
            // send_notification("put goes farther1", true);
          }else{
            vixQuoteCalc = 1;
            up = true;
            // send_notification("call goes farther1", true);
          }
        }
      } else if (+closerNumber == 2){
        if(+smallestPutPosition?.lp < +inputNumberSent){
          if(+smallestPutPosition?.lp < +smallestCallPosition?.lp){
            vixQuoteCalc = -1;
            up = true;
            // send_notification("put comes closer2", true);
          }else{
            vixQuoteCalc = -1;
            up = false;
            // send_notification("call comes closer2", true);
          }
        } else {
          if(+smallestPutPosition?.lp < +smallestCallPosition?.lp){  
            vixQuoteCalc = 1;
            up = true;
            // send_notification("call goes farther2", true);
          }else{
            vixQuoteCalc = 1;
            up = false;
            // send_notification("put goes farther2", true);
          }
        }
      }
    }


    // do not go closer than straddle via BOT
    if(putStrike == callStrike) {vixQuoteCalc = 1}
    // do not come closer than 2 strikes distance via BOT
    if(actionTypeInput == actionType.BOT && (((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) <= 2)) {
      vixQuoteCalc = 1;
      send_notification('Avoiding auto bot trades to come closer than 2 strike difference', true);
    }
    
    // send_notification(vixQuoteCalc + " : " + up +" --> vixQuoteCalc : up ", true);
    
    //check condition before action
    if (up && vixQuoteCalc > 0) {
      await takeActionCallAway(api)
      send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) + 1 )+' : strike difference');
      // send_notification("call away", true);
    }
    else if (!up && vixQuoteCalc > 0) {
      await takeActionPutAway(api)
      send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) + 1 )+' : strike difference');
      // send_notification("put away", true);
    }

    // do not come closer via BOT after 2 PM
    else if (!up && vixQuoteCalc <= 0) {
          if(actionTypeInput == actionType.MANUAL) {await takeActionCallCloser(api);
            send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) - 1 )+' : strike difference')}
          else if(actionTypeInput == actionType.BOT && isTimeEqualsNotAfterProps(2,0,false)) {await takeActionCallCloser(api);
            send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) - 1 )+' : strike difference')}
          else {
              send_notification('Avoiding auto bot trades to come closer post 2 PM', true);
          }
          // send_notification("call closer", true);
    }
    else if (up && vixQuoteCalc <= 0) {
          if(actionTypeInput == actionType.MANUAL) {await takeActionPutCloser(api);
            send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) - 1 )+' : strike difference')}
          else if(actionTypeInput == actionType.BOT && isTimeEqualsNotAfterProps(2,0,false)) {await takeActionPutCloser(api);
            send_notification((+((+callStrike - +putStrike)/Math.abs(+ocGapCalc)) - 1 )+' : strike difference')}
          else {
            send_notification('Avoiding auto bot trades to come closer post 2 PM', true);
          }
          // send_notification("put closer", true);
    }

    
    pnl = await calcPnL(api);
    send_notification('PnL : ' + pnl, true)
    
    //send distance and MtoM
    // await updatePositions(api);
    // putStrike = getStrike(smallestPutPosition?.tsym, getPickedExchange())
    // callStrike = getStrike(smallestCallPosition?.tsym, getPickedExchange())
    // send_notification('distance: '+(+callStrike - +putStrike)/Math.abs(+ocGapCalc) + ', MtoM: '+positionsData?.urmtom + ", rPnL: "+ +positionsData?.rpnl + new Date(), true)
    // send_notification((+callStrike - +putStrike)/Math.abs(+ocGapCalc) + ' : taking decision, after action - strike difference' + ', MtoM: '+positionsData?.urmtom + ", rPnL: "+ +positionsData?.rpnl + new Date());
  }
  catch (error) {
    throw error; // Rethrow the error to propagate it
  }
}


    const exitAll = async (api) => {
      try{
        await updatePositions(api);
      } catch (error) {
        throw error; // Rethrow the error to propagate it
      }    

      let orderCE = {};

      orderCE = {
        buy_or_sell: 'B',
        product_type: 'M',
        exchange: getPickedExchange(),
        tradingsymbol: callPositions[0],
        quantity: Math.abs(smallestCallPosition?.netqty).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'CommonOrderCEExitAPI'
  }


  let orderPE = {};

  orderPE = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: getPickedExchange(),
    tradingsymbol: smallestPutPosition?.tsym,
    quantity: Math.abs(smallestPutPosition?.netqty).toString(),
    discloseqty: 0,
    price_type: 'MKT',
    price: 0,
    remarks: 'CommonOrderPEExitAPI'
  }

  const orders = await api.get_orderbook();

  const filtered_data_SL_CE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'C' && item?.instname === 'OPTIDX'): [];
  send_notification("exit "+ orderCE.tradingsymbol,true)
  await api.place_order(orderCE);
  await api.cancel_order(filtered_data_SL_CE[0]?.norenordno)



  const filtered_data_SL_PE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'P' && item?.instname === 'OPTIDX'): [];
    send_notification("exit "+ orderPE.tradingsymbol, true)
    //exit put
    await api.place_order(orderPE);
    await api.cancel_order(filtered_data_SL_PE[0]?.norenordno)
    
  
  send_notification('exited all and stopped', true)  
  process.exit(0);
}

const updateNearByPositions = async (positions) => {
if (getPickedExchange() === 'NFO'){//BANKNIFTY22NOV23C43800, FINNIFTY28NOV23C19300, NIFTY23NOV23C19750
  if (identify_option_type(positions[0]?.tsym) == 'C') {
    item = positions[0];
    strike = getStrike(item?.tsym, pickedExchange)
    prefix = item.tsym.slice(0, -5)
    callPositions.push(item.tsym)
    callPositions.push(prefix + (strike + Math.abs(+ocGapCalc)))
    callPositions.push(prefix + (strike - Math.abs(+ocGapCalc)))
    
    item = positions[1]
    strike = getStrike(item?.tsym, pickedExchange)
    prefix = item.tsym.slice(0, -5)
    putPositions.push(item.tsym)
    putPositions.push(prefix + (strike - Math.abs(+ocGapCalc)))
    putPositions.push(prefix + (strike + Math.abs(+ocGapCalc)))
  } else {
    item = positions[1]
    strike = getStrike(item?.tsym, pickedExchange)
    prefix = item.tsym.slice(0, -5)
    callPositions.push(item.tsym)
    callPositions.push(prefix + (strike + Math.abs(+ocGapCalc)))
    callPositions.push(prefix + (strike - Math.abs(+ocGapCalc)))
    
    item = positions[0]
    strike = getStrike(item?.tsym, pickedExchange)
    prefix = item.tsym.slice(0, -5)
    putPositions.push(item.tsym)
    putPositions.push(prefix + (strike - Math.abs(+ocGapCalc)))
    putPositions.push(prefix + (strike + Math.abs(+ocGapCalc)))
  }
}
else if (getPickedExchange() === 'BFO') {//SENSEX23N1765500PE, BANKEX23N2049300CE
  if (identify_option_type(positions[0]?.tsym) == 'C') {
    item = positions[0];
    callPositions.push(item.tsym)
    callPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) + Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    callPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) - Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    item = positions[1]
    putPositions.push(item.tsym)
    putPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) - Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    putPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) + Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
  } else {
    item = positions[1];
    callPositions.push(item.tsym)
    callPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) + Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    callPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) - Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    item = positions[0]
    putPositions.push(item.tsym)
    putPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) - Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
    putPositions.push(item.tsym.slice(0, -7) + (getStrike(item.tsym, getPickedExchange()) + Math.abs(parseInt(ocGapCalc, 10)))+item.tsym.slice(-2));
  }    
  }  
}

const updatePositions = async (api) => {

  callPositions = []
  putPositions = []
  smallestCallPosition = {};
  smallestPutPosition = {};

  positionsData = await api.get_positions();
  const data = positionsData;
  if (Array.isArray(data)) {
    const sellPositions = data.filter(option => parseInt(option.netqty) < 0);
    sellPositions.sort((a, b) => parseFloat(a.lp) - parseFloat(b.lp));
    const smallestTwoPositions = sellPositions.slice(0, 2);
    await updateNearByPositions(smallestTwoPositions)
  
    // Separate calls and puts for NFO - these are sold options with smallest LTP
    const calls = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'C');
    smallestCallPosition = calls.length > 0 && calls.reduce((min, option) => (parseFloat(option.lp) < parseFloat(min.lp) ? option : min), calls[0]);
    const puts = data.filter(option => parseInt(option.netqty) < 0 && identify_option_type(option.tsym) == 'P');
    smallestPutPosition = puts.length > 0 && puts.reduce((min, option) => (parseFloat(option.lp) < parseFloat(min.lp) ? option : min), puts[0]);
    
}
}

const takeActionCallAway = async (api) => {
 
  let orderCE = {};
  let orderSubCE = {};
  let orderSubCESL = {};
  
          orderCE = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: callPositions[0],
            quantity: Math.abs(smallestCallPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderCEExitAPI'
          }

          // ltporderSubCE = await getCloserTokenLTP(api, smallestCallPosition, -1)

          orderSubCE = {
            buy_or_sell: 'S',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: callPositions[1],
            quantity: Math.abs(smallestCallPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderCEEntryAPI'
          }

          localSLPrice = await getLTPfromSymbol(api, callPositions[1]);
          orderSubCESL = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: callPositions[1],
            quantity: Math.abs(smallestCallPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'SL-LMT',
            price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 4)+2), Number(localSLPrice[1])),
            trigger_price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 4)), (Number(localSLPrice[1])-0.5)),
            remarks: 'CommonOrderCEEntryAPISL'
          }
        
  const orders = await api.get_orderbook();

  const filtered_data_SL_CE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'C' && item?.instname === 'OPTIDX'): [];
  send_notification("exited: "+ orderCE.tradingsymbol+"\nentered: "+orderSubCE.tradingsymbol,true);
  //exit call
  await api.place_order(orderCE);
  await api.cancel_order(filtered_data_SL_CE[0]?.norenordno)
  getPickedExchange() === 'BFO' ? await delay(3500): await delay(1500);
  //move away call
  await api.place_order(orderSubCE);
  await api.place_order(orderSubCESL);
  
}
const takeActionPutAway = async (api) => {

  let orderPE = {};
  let orderSubPE = {};
  let orderSubPESL = {};
  

          orderPE = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: smallestPutPosition?.tsym,
            quantity: Math.abs(smallestPutPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderPEExitAPI'
          }


          // ltporderSubPE = await getCloserTokenLTP(api, smallestPutPosition, -1)

          orderSubPE = {
            buy_or_sell: 'S',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: putPositions[1],
            quantity: Math.abs(smallestPutPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderPEEntryAPI'
          }

          localSLPrice = await getLTPfromSymbol(api, putPositions[1]);
          orderSubPESL = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: putPositions[1],
            quantity: Math.abs(smallestPutPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'SL-LMT',
            price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 4)+2), (Number(localSLPrice[1]))),
            trigger_price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 4)), (Number(localSLPrice[1])-0.5)),
            remarks: 'CommonOrderPEEntryAPISL'
          }
          
  const orders = await api.get_orderbook();

  const filtered_data_SL_PE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'P' && item?.instname === 'OPTIDX'): [];
    send_notification("exited: "+ orderPE.tradingsymbol+"\nentered: "+orderSubPE.tradingsymbol,true);
    //exit put
    await api.place_order(orderPE);
    await api.cancel_order(filtered_data_SL_PE[0]?.norenordno)
    getPickedExchange() === 'BFO' ? await delay(3500): await delay(1500);
    //move away put
    await api.place_order(orderSubPE);
    await api.place_order(orderSubPESL);
}
const takeActionCallCloser = async (api) => {

  let orderCE = {};
  let orderAggCE = {};
  let orderAggCESL = {};
  
          orderCE = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: smallestCallPosition?.tsym,
            quantity: Math.abs(smallestCallPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderCEExitAPI'
          }

          // ltporderAggCE = await getCloserTokenLTP(api, smallestCallPosition, 1)
          orderAggCE = {
            buy_or_sell: 'S',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: callPositions[2],
            quantity: (Math.abs(smallestCallPosition?.netqty) - Math.abs(smallestCallPosition?.ls)).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderCEEntryAPI'
          }
          localSLPrice = await getLTPfromSymbol(api, callPositions[2]);
          orderAggCESL = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: callPositions[2],
            quantity: (Math.abs(smallestCallPosition?.netqty) - Math.abs(smallestCallPosition?.ls)).toString(),
            discloseqty: 0,
            price_type: 'SL-LMT',
            price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 3)+2), (Number(localSLPrice[1]))),
            trigger_price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 3)), (Number(localSLPrice[1])-0.5)),
            remarks: 'CommonOrderCEEntryAPISL'
          }

  const orders = await api.get_orderbook();

  const filtered_data_SL_CE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'C' && item?.instname === 'OPTIDX'): [];
  send_notification("exited: "+ orderCE.tradingsymbol+"\nentered: "+orderAggCE.tradingsymbol,true);
    //exit put
    await api.place_order(orderCE);
    await api.cancel_order(filtered_data_SL_CE[0]?.norenordno)
    getPickedExchange() === 'BFO' ? await delay(3500): await delay(1500);
    //come closer put
    await api.place_order(orderAggCE);
    await api.place_order(orderAggCESL);
  

}
const takeActionPutCloser = async (api) => {
 
  let orderPE = {};
  let orderAggPE = {};
  let orderAggPESL = {};
  
          orderPE = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: smallestPutPosition?.tsym,
            quantity: Math.abs(smallestPutPosition?.netqty).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderPEExitAPI'
          }

          // ltporderAggPE = await getCloserTokenLTP(api, smallestPutPosition, 1)
          orderAggPE = {
            buy_or_sell: 'S',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: putPositions[2],
            quantity: (Math.abs(smallestPutPosition?.netqty) - Math.abs(+smallestPutPosition?.ls)).toString(),
            discloseqty: 0,
            price_type: 'MKT',
            price: 0,
            remarks: 'CommonOrderPEEntryAPI'
          }
          localSLPrice = await getLTPfromSymbol(api, putPositions[2]);
          orderAggPESL = {
            buy_or_sell: 'B',
            product_type: 'M',
            exchange: getPickedExchange(),
            tradingsymbol: putPositions[2],
            quantity: (Math.abs(smallestPutPosition?.netqty)  - Math.abs(+smallestPutPosition?.ls)).toString(),
            discloseqty: 0,
            price_type: 'SL-LMT',
            price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 3)+2), (Number(localSLPrice[1]))),
            trigger_price: Math.min(Number(Math.round(Number(localSLPrice[0] || 10) * 3)), (Number(localSLPrice[1])-0.5)),
            remarks: 'CommonOrderPEEntryAPISL'
          }
          
  const orders = await api.get_orderbook();

  const filtered_data_SL_PE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && identify_option_type(item.tsym) == 'P' && item?.instname === 'OPTIDX'): [];
    send_notification("exited: "+ orderPE.tradingsymbol+"\nentered: "+orderAggPE.tradingsymbol,true);
    //exit call
    await api.place_order(orderPE);
    await api.cancel_order(filtered_data_SL_PE[0]?.norenordno)
    getPickedExchange() === 'BFO' ? await delay(3500): await delay(1500);
    //come closer put
    await api.place_order(orderAggPE);
    await api.place_order(orderAggPESL);
}

const getCloserTokenSymbol = (item, level=1) => {
    if (getPickedExchange() === 'NFO'){//BANKNIFTY22NOV23C43800, FINNIFTY28NOV23C19300, NIFTY23NOV23C19750
        return `${item.tsym.slice(0, -5)}${getStrike(item.tsym, getPickedExchange()) + (parseInt(ocGapCalc, 10)*level)}`;
    }
    else if (getPickedExchange() === 'BFO') {//SENSEX23N1765500PE, BANKEX23N2049300CE
        return `${item.tsym.slice(0, -7)}${getStrike(item.tsym, getPickedExchange()) + (parseInt(ocGapCalc, 10)*level)}${item.tsym.slice(-2)}`;
    }
    else if (getPickedExchange() === 'MCX') {// NATURALGAS23NOV23P230
        const pattern = /(\d+)$/;
        const match = item.tsym.match(pattern);
        if (match) {
            const [, originalStrike] = match;
            const newNumericValue = Number(originalStrike) - parseInt(ocGapCalc, 10);
            return item.tsym.replace(originalStrike, newNumericValue); // NATURALGAS23NOV23P235
        }
    }
    else {
        console.log("Strike price not found in the symbol.");
        return null;
    }
}

async function getLTPfromSymbol(api, tsym) {
  // console.log(tsym)
  localSearch = await api.searchscrip(getPickedExchange(), tsym);
  // console.log(localSearch, 'localSearch')
  localToken = localSearch.values[0].token;
  // console.log(localToken, 'localToken')
  const ltpResponse = await api.get_quotes(getPickedExchange(), localToken);
  // console.log(ltpResponse.lp, 'ltpResponse.lp')
  return [ltpResponse.lp, ltpResponse.uc];
}

async function getCloserTokenLTP(api, item, level=1) {
        const newSymbol = getCloserTokenSymbol(item, level);
        const searchedCloserStrike = await api.searchscrip(getPickedExchange(), newSymbol);
        const ATMCloserToken1 = searchedCloserStrike.values[0].token;
        const ltpResponse = await api.get_quotes(getPickedExchange(), ATMCloserToken1);
        return ltpResponse.lp;
}

async function processOrders(api, exchange = 'NFO') {
  try {
    if(exchange != 'MCX') {
      isTimeAfter328PM() && await exitAll(api);
    }
    const orders = await api.get_orderbook();
    const filtered_data = Array.isArray(orders) ? orders.filter(item => item.status === 'TRIGGER_PENDING' && (exchange === 'MCX' || item?.instname === 'OPTIDX')): [];
    // console.log(filtered_data)
    if (filtered_data.length === 0) { console.log('No orders with status TRIGGER_PENDING.'); return;}
    debug && console.log(filtered_data, 'filtered_data')
    for (const item of filtered_data) {
        const optionType = identify_option_type(item.tsym); // P || C
        const quotesResponse = await api.get_quotes(getPickedExchange(), item.token);
        //BankNifty+Bankex+Sensex=100, NG=5, Nifty+FinNifty=50
        const ocGap =item.tsym.includes('BANK') || item.tsym.includes('EX') ? '100': item.tsym.includes('NATURALGAS') ? '5': '50';
        ocGapCalc = optionType === 'P' ? parseInt(ocGap, 10) : -parseInt(ocGap, 10);

        slOrders += `${optionType}: `;
        slOrders += `${quotesResponse.lp} `; // open order
        slOrders += `(${await getCloserTokenLTP(api, item, 1)}) `//closer
        debug && console.log(slOrdersExtra, 'slOrders')

        slOrdersExtra += `${optionType}: `;
        slOrdersExtra += `${await getCloserTokenLTP(api, item, -1)} `; // farther
        slOrdersExtra += `(${await getCloserTokenLTP(api, item, 2)}) `;//closer 2
        debug && console.log(slOrdersExtra, 'slOrdersExtra')
    }
    if (slOrders) {
      await checkAlert(api);
      await send_notification(slOrders);
      slOrders = '';
      slOrdersExtra = '';
      await updatePositions(api);
      if (Object.keys(smallestCallPosition).length === 0 || Object.keys(smallestPutPosition).length === 0){
        send_notification('################## ORDER REJECTED PLS CHECK ##################', true);
      }
    } else {
      console.log('no SL orders available')
    }
  } catch (error) {console.error(error);send_notification(error + ' error occured', true)}
}

async function isCrudeOrderAlreadyPlaced(api) {
    // return false;
    const orders = await api.get_orderbook();
    const filtered_data = Array.isArray(orders) ? orders.filter(item => item?.remarks?.includes('Pawan') && item?.status === 'COMPLETE') : [];
    // console.log(filtered_data[0],filtered_data[1])
    return !(filtered_data[0] == undefined || filtered_data[0]?.remarks?.includes('PawanExit') || filtered_data[1]?.remarks?.includes('PawanExit'));
}

async function crudeStraddlePlaceOrder(api, exchange='MCX') {
// await send_callback_notification();
//find ATM strike CE and PE

const monthAbbreviation = new Date().toLocaleString('default', { month: 'short' }).toUpperCase();

let query = `CRUDEOIL`;
let futureObj = await api.searchscrip(exchange='MCX', searchtext=query)
let futureToken = futureObj.values[3].token; //258003 //3 as it skips crudeoil, crudeoilm and its future

const Spot = await fetchSpotPrice(api, futureToken, 'MCX');
    if (!Spot) { console.log('Not able to find the spot'); return null; }
    debug && console.log(Spot.lp) // 6241.00

const ATMStrike = Math.round(Spot.lp / 50) * 50 //6250
const ATMCEStrike = ATMStrike%100 !=0 ? +ATMStrike + 50: +ATMStrike;
const ATMPEStrike = ATMStrike%100 !=0 ? +ATMStrike - 50: +ATMStrike;

debug && console.log(ATMCEStrike, ATMPEStrike, 'ATMCEStrike')
//find CE and PE
query = `CRUDEOIL CE ${ATMCEStrike}`;
let ATMCESearchObj = await api.searchscrip(exchange='MCX', searchtext=query)
debug && console.log(ATMCESearchObj.values[0], ATMCESearchObj.values[1], 'ATMCESearchObjs')
let ATMCEToken = ATMCESearchObj.values[0].token;
let ATMCESym = ATMCESearchObj.values[0].tsym;

query = `CRUDEOIL PE ${ATMPEStrike}`;
let ATMPESearchObj = await api.searchscrip(exchange='MCX', searchtext=query)

let ATMPEToken = ATMPESearchObj.values[0].token;
let ATMPESym = ATMPESearchObj.values[0].tsym;
debug && console.log(ATMCESym, ' ', ATMPESym) //CRUDEOIL14DEC23C6250   CRUDEOIL14DEC23P6250

const SpotCEObj = await fetchSpotPrice(api, ATMCEToken, 'MCX');
    if (!SpotCEObj) { console.log('Not able to find the spot'); return null; }
    debug && console.log(SpotCEObj) // 270.00
//    {
//      request_time: '22:37:06 22-11-2023',
//      stat: 'Ok',
//      exch: 'MCX',
//      tsym: 'CRUDEOIL14DEC23C6250',
//      symname: 'CRUDEOIL',
//      seg: 'COM',
//      exd: '14-DEC-2023',
//      instname: 'OPTFUT',
//      optt: 'CE',
//      pp: '2',
//      ls: '100',
//      ti: '0.10',
//      mult: '1',
//      lut: '1700672822',
//      uc: '1100.70',
//      lc: '13.30',
//      wk52_h: '422.60',
//      wk52_l: '0.00',
//      oi: '172',
//      strprc: '6250.00',
//      prcftr_d: '(1 / 1 ) * (1 / 1)',
//      token: '260005',
//      lp: '271.00',
//      c: '357.80',
//      h: '367.30',
//      l: '237.40',
//      ap: '261.33',
//      o: '367.30',
//      v: '1691',
//      ltq: '1',
//      ltt: '22:36:47',
//      ltd: '22-11-2023',
//      tbq: '47',
//      tsq: '62',
//      bp1: '270.80',
//      sp1: '273.00',
//      bp2: '270.20',
//      sp2: '274.30',
//      bp3: '270.10',
//      sp3: '275.00',
//      bp4: '269.60',
//      sp4: '275.20',
//      bp5: '268.80',
//      sp5: '276.00',
//      bq1: '2',
//      sq1: '1',
//      bq2: '4',
//      sq2: '2',
//      bq3: '2',
//      sq3: '13',
//      bq4: '2',
//      sq4: '2',
//      bq5: '2',
//      sq5: '2',
//      bo1: '1',
//      so1: '1',
//      bo2: '2',
//      so2: '1',
//      bo3: '1',
//      so3: '2',
//      bo4: '1',
//      so4: '1',
//      bo5: '1',
//      so5: '1',
//      und_exch: 'MCX',
//      und_tk: '258003'
//    }


//const orders = await api.get_orderbook();
//const filtered_data = Array.isArray(orders) ? orders.filter(item => item.status === 'TRIGGER_PENDING') : [];
//if (filtered_data.length === 0) { console.log('No orders with status TRIGGER_PENDING.'); return;}
//debug && console.log(filtered_data, 'filtered_data')
//

//[
//  {
//    stat: 'Ok',
//    norenordno: '23112201064375',
//    kidid: '1',
//    uid: 'FA63911',
//    actid: 'FA63911',
//    exch: 'MCX',
//    tsym: 'CRUDEOIL14DEC23C6700',
//    qty: '100',
//    ordenttm: '1700667762',
//    trantype: 'B',
//    prctyp: 'SL-LMT',
//    ret: 'DAY',
//    token: '260023',
//    mult: '1',
//    prcftr: '1.000000',
//    instname: 'OPTFUT',
//    ordersource: 'MOB',
//    pp: '2',
//    ls: '100',
//    ti: '0.10',
//    prc: '150.00',
//    trgprc: '142.00',
//    rprc: '150.00',
//    dscqty: '0',
//    s_prdt_ali: 'NRML',
//    prd: 'M',
//    status: 'TRIGGER_PENDING',
//    st_intrn: 'TRIGGER_PENDING',
//    norentm: '21:12:42 22-11-2023',
//    exch_tm: '22-11-2023 21:12:42',
//    exchordid: '332615328793226',
//    rqty: '100'
//  }
//] filtered_data


// sell both strikes

let orderCE = {
    buy_or_sell: 'S',
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: ATMCESym || 'CRUDEOIL14DEC23C6700',
    quantity: (100*multiplier).toString(),// multiplier
    discloseqty: (100*multiplier).toString(),// multiplier
    price_type: 'LMT',
    price: SpotCEObj.bp5 || 0,
    remarks: 'PawanEntryCrudeCEAPI'
}
!debug && await api.place_order(orderCE);

debug && console.log(orderCE)
const SpotPEObj = await fetchSpotPrice(api, ATMPEToken, 'MCX');
    if (!SpotPEObj) { console.log('Not able to find the spot'); return null; }

let orderPE = {
    buy_or_sell: 'S',
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: ATMPESym || 'CRUDEOIL14DEC23P6700',
    quantity: (100*multiplier).toString(), // multiplier
    discloseqty: (100*multiplier).toString(), // multiplier
    price_type: 'LMT',
    price: SpotPEObj.bp5 || 0,
    remarks: 'PawanEntryCrudePEAPI'
}

debug && console.log(orderPE)
!debug && await api.place_order(orderPE);


let orderCESL = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: ATMCESym || 'CRUDEOIL14DEC23C6700',
    quantity: (100*multiplier).toString(),// multiplier
    discloseqty: (100*multiplier).toString(),// multiplier
    price_type: 'SL-LMT',
    price: Number(Math.round(Number(SpotCEObj.lp || 10) * 1.5)-5),
    trigger_price: Number(Math.round(Number(SpotCEObj.lp || 10) * 1.5)-10),
    remarks: 'PawanSLEntryCEAPI'
}

!debug && await api.place_order(orderCESL);

let orderPESL = {
    buy_or_sell: 'B',
    product_type: 'M',
    exchange: 'MCX',
    tradingsymbol: ATMPESym || 'CRUDEOIL14DEC23P6700',
    quantity: (100*multiplier).toString(), // multiplier
    discloseqty: (100*multiplier).toString(), // multiplier
    price_type: 'SL-LMT',
    price: Number(Math.round(Number(SpotPEObj.lp || 10) * 1.5)-5),
    trigger_price: Number(Math.round(Number(SpotPEObj.lp || 10) * 1.5)-10),
    remarks: 'PawanSLEntryPEAPI'
}
!debug && await api.place_order(orderPESL);

return;

}

async function crudeStraddlePostOrderPlacement(api, exchange='MCX') {
    // calculate MTM every second from open positions - if possible use websocket
    const orders = await api.get_orderbook();
    const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.remarks?.includes('Pawan')) : [];

    const orders_exitedAlready = filtered_data_API[0]?.remarks?.includes('PawanExit') &&  filtered_data_API[1]?.remarks?.includes('PawanExit');
    if (orders_exitedAlready || filtered_data_API.length === 0) { console.log('No open straddle'); return;}

    const filtered_data_SL = Array.isArray(orders) ? orders.filter(item => item?.remarks?.includes('PawanSLEntry') && item?.status === 'TRIGGER_PENDING'): [];
    // console.log(filtered_data_SL, 'filtered_data_SL')
    const filtered_data = Array.isArray(orders) ? orders.filter(item => item?.remarks?.includes('PawanEntry') && item?.status === 'COMPLETE') : [];
    if (filtered_data.length === 0) { console.log('No open straddle'); return null;}
    debug && console.log(filtered_data[0].token, filtered_data[0].avgprc, ' ',filtered_data[1].token, filtered_data[1].avgprc,  'filtered_data')
    // console.log(filtered_data, 'filtered_data')
    //CRUDEOIL14DEC23P6300 236.10   CRUDEOIL14DEC23C6400 241.10 filtered_data
    while (!exitFlag) { // run for 5 secs less than picked interval
        //check MTM
        await delay((mtmValue>500 || mtmValue<-1500 )? 1000:5000);
        if(filtered_data){
            const SpotObj1 = await fetchSpotPrice(api, filtered_data[0]?.token, 'MCX');
            if (!SpotObj1) { console.log('Not able to find the spot'); return null; }
            debug && console.log(SpotObj1.lp) // 245.70
            const SpotObj2 = await fetchSpotPrice(api, filtered_data[1]?.token, 'MCX');
            if (!SpotObj2) { console.log('Not able to find the spot'); return null; }
            debug && console.log(SpotObj2.lp) // 233.50
            mtmValue = 2*(Math.round(((+filtered_data[0].avgprc + +filtered_data[1].avgprc) - (+SpotObj1.lp + +SpotObj2.lp))*100));
            // if MTM exit condition then close positions and exit pending orders
            if(exitAllFlag || isTimeAfter1147PM() || mtmValue > (multiplier*gainExitMTM) || mtmValue < (multiplier*exitMTM)){

                //cancel the SL orders
                api.cancel_order(filtered_data_SL[0]?.norenordno)
                api.cancel_order(filtered_data_SL[1]?.norenordno)

                // exit both strikes
                let order1 = {
                    buy_or_sell: 'B',
                    product_type: 'M',
                    exchange: 'MCX',
                    tradingsymbol: SpotObj1.tsym,
                    quantity: (100*multiplier).toString(),// multiplier
                    discloseqty: (100*multiplier).toString(),// multiplier
                    price_type: 'LMT',
                    price: SpotObj1.sp5,
                    remarks: 'PawanExit1API'
                }

                !debug && await api.place_order(order1);

                let order2 = {
                    buy_or_sell: 'B',
                    product_type: 'M',
                    exchange: 'MCX',
                    tradingsymbol: SpotObj2.tsym,
                    quantity: (100*multiplier).toString(), // multiplier
                    discloseqty: (100*multiplier).toString(), // multiplier
                    price_type: 'LMT',
                    price: SpotObj2.sp5,
                    remarks: 'PawanExit2API'
                }
                !debug && await api.place_order(order2);
                send_notification(`Exited with ${mtmValue} Rs.`, true)
                await delay((mtmValue>0)? 1000:300000);
                exitAllFlag=false;
                return mtmValue>0?'profit':'loss';
            }
            //check for any manual stop signal
            else if (getStopSignal()) {
              console.log('Stop signal recieved');
              process.exit(0);
            }
            else {console.log('No action needed', mtmValue)}
        }
        iterationCounter = iterationCounter + 1;
        if (iterationCounter % 12 === 0) send_notification(`MCX PnL:  ${await calcPnL(api, true)} Rs`);
    }
    return;
}

module.exports = { send_notification, find_bias, fetchAllBiases, processOrders, getStopSignal, getCustomInterval, getPickedExchange, crudeStraddlePlaceOrder, crudeStraddlePostOrderPlacement, isCrudeOrderAlreadyPlaced, isTimeAfter1147PM, getPickedIndex, debug };
