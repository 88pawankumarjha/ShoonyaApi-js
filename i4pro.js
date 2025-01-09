const { glob } = require('fs/promises');
const { isTimeEqualsNotAfterProps, identify_option_type, fetchSpotPrice, delay, getStrike, calcVix, nearByTsymPutAgg, nearByTsymPutSub, nearByTsymCallAgg, nearByTsymCallSub, nearByPositions, calcPnL } = require('./utils/customLibrary');

const maxLossPerOrderPercent = 0.33; // 0.33% of the limits
const maxLossPerDayPercent = 1; // 1% of the limits
const maxGainPerDayPercent = 1; // 1% of the limits
const limitPerLot = 260000; // 300000 Lakh per lot


let globalInputCaller = {
    quantityInLots: 0
};

// Define the named asynchronous function
async function executeI4Pro(api) {
    try {
        // Wait for the exported Promise to resolve
        const {runAsyncTasks} = require('./queryBias_i4pro.js');
        const globalInput = await runAsyncTasks(api);
        globalInputCaller = globalInput;



// module.exports = async function() {
//     let globalInput = {
//       susertoken: '',
//       secondSession: false,
//       launchChildProcessApp: false,
//       indexName: getPickedIndexHere(),
//       delayTime: 10000,
//       ocGap: undefined,
//       token: undefined,
//       pickedExchange: undefined,
//       inputOptTsym: undefined,
//       WEEKLY_EXPIRY: undefined,
//       MONTHLY_EXPIRY: undefined,
//     };
  
//     globalInput.token = idxNameTokenMap.get(globalInput.indexName);
//     globalInput.ocGap = idxNameOcGap.get(globalInput.indexName);
  
//     // ... (rest of the code remains the same)
  
//     return globalInput;
//   };

    } catch (error) {
        if (error.response && error.response.status === 502) {
            console.error("502 Bad Gateway Error in executeI4Pro:", error);
        } else {
            console.error("Error in executeI4Pro:", error);
        }
    }
}

const getQuantityInLots = () => {
    globalInputCaller.quantityInLots = Math.floor(globalInputCaller?.limits / limitPerLot) //assume 1 Lakh per lot
}

async function getLTPfromSymbol(api, tsym) {
    // console.log(tsym)
    localSearch = await api.searchscrip(globalInputCaller.pickedExchange, tsym);
    // console.log(localSearch, 'localSearch')
    localToken = localSearch.values[0].token;
    // console.log(localToken, 'localToken')
    const ltpResponse = await api.get_quotes(globalInputCaller.pickedExchange, localToken);
    // console.log(ltpResponse.lp, 'ltpResponse.lp')
    return [ltpResponse.lp, ltpResponse.uc];
  }

const placeSLOrder = async (api) => {
    let orderSubCESL = {};
    localSLPrice = await getLTPfromSymbol(api, globalInputCaller.optionInAction);
    // take limits and then calculate the SL price -> sl loss should be 0.33% of the limits
    
    const maxLossPerOrder = (globalInputCaller?.limits / 100) * maxLossPerOrderPercent; //200000 / 100 * 0.33 = 660
    const calcQuantity = globalInputCaller.quantityInLots * globalInputCaller.LotSize;
    const calcSLPrice = Number(localSLPrice[0] || 10) + (maxLossPerOrder/calcQuantity);

    orderSubCESL = {
                buy_or_sell: 'B',
                product_type: 'M',
                exchange: globalInputCaller.pickedExchange,
                tradingsymbol: globalInputCaller.optionInAction,
                quantity: calcQuantity,
                discloseqty: 0,
                price_type: 'SL-LMT',
                price: Math.min(Number(Math.round(calcSLPrice)+2), Number(localSLPrice[1])), // price should be 4 times the LTP
                trigger_price: Math.min(Number(Math.round(calcSLPrice)), (Number(localSLPrice[1])-0.5)),
                remarks: 'CommonOrderCEEntryAPISL'
              }
    globalInputCaller.pickedExchange === 'BFO' ? await delay(3500) : await delay(1500);
    const response = await api.place_order(orderSubCESL);
    console.log("orderSubCESL Response:", response);
    
}

const placeSellOrder = async (api) => {
    let orderSubCE = {};
    orderSubCE = {
        buy_or_sell: 'S',
        product_type: 'M',
        exchange: globalInputCaller.pickedExchange,
        tradingsymbol: globalInputCaller.optionInAction,
        quantity: globalInputCaller.quantityInLots * globalInputCaller.LotSize,
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'CommonOrderCEEntryAPI'
    }
    globalInputCaller.pickedExchange === 'BFO' ? await delay(3500) : await delay(1500);
    const response = await api.place_order(orderSubCE);
    globalInputCaller.soldOptionToken = globalInputCaller.atmStrikeToken
    console.log("orderSubCE Response:", response);
}

const exitOrder = async (position, api) => {
    let orderSubCE = {};
    orderSubCE = {
        buy_or_sell: 'B',
        product_type: 'M',
        exchange: globalInputCaller.pickedExchange,
        tradingsymbol: position.tsym,
        quantity: Math.abs(position.netqty).toString(),
        discloseqty: 0,
        price_type: 'MKT',
        price: 0,
        remarks: 'ExitAPI'
    }
    globalInputCaller.pickedExchange === 'BFO' ? await delay(3500) : await delay(1500);
    const response = await api.place_order(orderSubCE);
    console.log("orderSubCE Response:", response);
}

const cancelOpenOrders = async (api) => {
    const orders = await api.get_orderbook();
    const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING') : [];
    for (const order of filtered_data_API) {
      if (order?.norenordno) {
        await api.cancel_order(order.norenordno);
      }
    }
  }

const exitAll = async (api) => {
    const positionsData = await api.get_positions();
    // console.log(positionsData, "positionsData");
    
    // [
    //   {
    //     stat: 'Ok',
    //     uid: 'ADMIN',
    //     actid: 'FA212725',
    //     exch: 'MCX',
    //     tsym: 'CRUDEOIL15JAN25C7000',
    //     s_prdt_ali: 'NRML',
    //     prd: 'M',
    //     token: '441363',
    //     gn: '1',
    //     gd: '1',
    //     pn: '1',
    //     pd: '1',
    //     instname: 'OPTFUT',
    //     frzqty: '10000',
    //     pp: '2',
    //     ls: '100',
    //     ti: '0.10',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     daybuyqty: '600',
    //     daysellqty: '0',
    //     daybuyamt: '5940.00',
    //     daybuyavgprc: '9.90',
    //     daysellamt: '0.00',
    //     daysellavgprc: '0.00',
    //     cfbuyqty: '0',
    //     cfsellqty: '600',
    //     cfbuyamt: '0.00',
    //     cfbuyavgprc: '0.00',
    //     cfsellamt: '6480.00',
    //     cfsellavgprc: '10.80',
    //     openbuyqty: '0',
    //     opensellqty: '0',
    //     openbuyamt: '0.00',
    //     openbuyavgprc: '0.00',
    //     opensellamt: '0.00',
    //     opensellavgprc: '0.00',
    //     dayavgprc: '9.90',
    //     netqty: '0',
    //     netavgprc: '0.00',
    //     upldprc: '9.67',
    //     netupldprc: '0.00',
    //     lp: '10.50',
    //     urmtom: '0.00',
    //     bep: '0.00',
    //     totbuyamt: '5940.00',
    //     totsellamt: '6480.00',
    //     totbuyavgprc: '9.90',
    //     totsellavgprc: '10.80',
    //     rpnl: '540.00'
    //   },
    //   {
    //     stat: 'Ok',
    //     uid: 'FA212725',
    //     actid: 'FA212725',
    //     exch: 'BFO',
    //     tsym: 'SENSEX2510778300CE',
    //     s_prdt_ali: 'NRML',
    //     prd: 'M',
    //     token: '822231',
    //     instname: 'OPTIDX',
    //     frzqty: '1000',
    //     pp: '2',
    //     ls: '20',
    //     ti: '0.05',
    //     mult: '1',
    //     prcftr: '1.000000',
    //     daybuyqty: '200',
    //     daysellqty: '300',
    //     daybuyamt: '94198.00',
    //     daybuyavgprc: '470.99',
    //     daysellamt: '129053.00',
    //     daysellavgprc: '430.18',
    //     cfbuyqty: '0',
    //     cfsellqty: '0',
    //     cfbuyamt: '0.00',
    //     cfbuyavgprc: '0.00',
    //     cfsellamt: '0.00',
    //     cfsellavgprc: '0.00',
    //     openbuyqty: '100',
    //     opensellqty: '0',
    //     openbuyamt: '55200.00',
    //     openbuyavgprc: '552.00',
    //     opensellamt: '0.00',
    //     opensellavgprc: '0.00',
    //     dayavgprc: '430.18',
    //     netqty: '-100',
    //     netavgprc: '430.18',
    //     upldprc: '0.00',
    //     netupldprc: '430.18',
    //     lp: '268.25',
    //     urmtom: '16192.67',
    //     bep: '348.55',
    //     totbuyamt: '94198.00',
    //     totsellamt: '129053.00',
    //     totbuyavgprc: '470.99',
    //     totsellavgprc: '430.18',
    //     rpnl: '-8162.67'
    //   }
    // ] positionsData

    for (let i = 0; i < positionsData.length; i++) {
        if ((positionsData[i].tsym.includes("PE") || positionsData[i].tsym.includes("CE")) && parseInt(positionsData[i].netqty) < 0) {
            await exitOrder(positionsData[i], api);
            await delay(1500);
            await cancelOpenOrders(api)
        }
    }
}

const checkExitCondition = async (globalInputCaller) => {

    let pnl = await calcPnL(api);
    console.log("######pnl: ", pnl)

    // exit this script if the loss is more than 1% of the limits or the gain is more than 1% of the limits
    console.log("parseFloat(pnl.replace('%', '')) , -maxLossPerDayPercent , parseFloat(pnl.replace('%', '')) , maxGainPerDayPercent: ", parseFloat(pnl.replace('%', '')) , -maxLossPerDayPercent , parseFloat(pnl.replace('%', '')) , maxGainPerDayPercent);
    console.log("parseFloat(pnl.replace('%', '')) < -maxLossPerDayPercent , parseFloat(pnl.replace('%', '')) > maxGainPerDayPercent: ", parseFloat(pnl.replace('%', '')) < -maxLossPerDayPercent , parseFloat(pnl.replace('%', '')) > maxGainPerDayPercent);
    if (parseFloat(pnl.replace('%', '')) < -maxLossPerDayPercent || parseFloat(pnl.replace('%', '')) > maxGainPerDayPercent) {
        exitAll(api).then(() => {
            console.log("######Exiting the script as the loss is more than 1% of the limits or the gain is more than 1% of the limits.");
            process.exit(0);

        });
    }

    if(isTimeEqualsNotAfterProps(14,40,false) && !(isTimeEqualsNotAfterProps(15,29,false))){
        exitAll(api).then(() => {
            console.log("######Exiting the script as the time is more than cut off time eg: 2:40 PM.");
            process.exit(0);
        });
        
    }

    
    //get ltp of the option
    // console.log("######globalInputCaller?.optionInAction: ", globalInputCaller?.optionInAction);
    // console.log("######globalInputCaller?.soldOptionToken: ", globalInputCaller?.soldOptionToken);
    const positionsData = await api.get_positions();
    // console.log("######positionsData: ", positionsData);
    const filtered_data = Array.isArray(positionsData) ? positionsData.filter(item => item?.netqty < 0) : [];
    filtered_data?.forEach((position) => {
        
            console.log("######position lp: ", position?.lp);
        
    });

    // console.log("######globalInputCaller?.finalWeeklyExpiryExchange: ", globalInputCaller?.finalWeeklyExpiryExchange);
    // let quoteResp = await api.get_quotes(globalInputCaller?.finalWeeklyExpiryExchange, globalInputCaller?.soldOptionToken)
    // console.log("######quoteResp: ", quoteResp?.lp);


    return false;
};

// Use an IIFE to handle `await` at the top level
const i4pro = async (api) => {
    // console.log("i4pro function called", api);
    
    await executeI4Pro(api); // sets values to globalInputCaller

    // eg:

    // {
    //     susertoken: '',
    //     secondSession: false,
    //     launchChildProcessApp: false,
    //     indexName: 'SENSEX',
    //     previousIndexName: '',
    //     previousWeeklyExpiry: '',
    //     finalWeeklyExpiry: '2025-01-03',
    //     finalWeeklyExpiryName: 'SENSEX',
    //     finalWeeklyExpiryExchange: 'BFO',
    //     emaLotMultiplierQty: 50,
    //     inputOptTsym: 'SENSEX2510386100PE',
    //     WEEKLY_EXPIRY: '2025-01-03',
    //     MONTHLY_EXPIRY: '2025-01-03',
    //     pickedExchange: 'BFO',
    //     LotSize: '10',
    //     emaLotMultiplier: 5,
    //     token: '1',
    //     ocGap: 100,
    //     keyword: 'SENSEX ',
    //     atmStrike: 79700,
    //     atmStrikePrice: 79700,
    //     atmStrikeToken: '1170703',
    //     optionInAction: 'SENSEX2510379700PE',
    //     bias: true,
    //     limits: 270018,
    //     resultBias: {
    //       NIFTY: '-6',
    //       BANKNIFTY: '162',
    //       FINNIFTY: '77',
    //       SENSEX: '39',
    //       BANKEX: '188'
    //     },
    //     api: NorenRestApi {
    //       __susertoken: '2cc98d2162e37e28588078163fb8e7b8147f0c06222bace34db86a16d7441890',
    //       setSessionDetails: [Function (anonymous)],
    //       login: [Function (anonymous)],
    //       get_option_chain: [Function (anonymous)],
    //       searchscrip: [Function (anonymous)],
    //       get_quotes: [Function (anonymous)],
    //       get_time_price_series: [Function (anonymous)],
    //       place_order: [Function (anonymous)],
    //       modify_order: [Function (anonymous)],
    //       cancel_order: [Function (anonymous)],
    //       exit_order: [Function (anonymous)],
    //       get_orderbook: [Function (anonymous)],
    //       get_tradebook: [Function (anonymous)],
    //       get_holdings: [Function (anonymous)],
    //       get_positions: [Function (anonymous)],
    //       get_limits: [Function (anonymous)],
    //       start_websocket: [Function (anonymous)],
    //       closeWebSocket: [Function (anonymous)],
    //       subscribe: [Function (anonymous)],
    //       __username: 'FA63911',
    //       __accountid: 'FA63911'
    //     },
    //     quantityInLots: 1
    //   } i4pro

    getQuantityInLots();
    console.log("###### ",globalInputCaller?.resultBias[globalInputCaller.finalWeeklyExpiryName], "calcbias", globalInputCaller.finalWeeklyExpiryName) // Output the result after function execution

    const shouldExit = await checkExitCondition(globalInputCaller);
    if (shouldExit) {
        process.exit(0);
    }
    
    // create SL order + sell optionInAction --> quantityInLots * LotSize

    // const positionsData = await api.get_positions();
    // console.log(positionsData, "positionsData");

    const orders = await api.get_orderbook();
    // console.log(orders, "orders");

    // if(orders is not pending)
    const filtered_data_SL_CE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING'  && item?.instname === 'OPTIDX'): [];

    if (filtered_data_SL_CE.length === 0) {

        // sell optionInAction 
        await placeSLOrder(api);

        // await checkIfSLOrderPlaced(api);
        
        await placeSellOrder(api);
        // await checkIfSellOrderPlaced(api);

    } else {
        console.log("######trigger: ", filtered_data_SL_CE[0].trgprc);
        console.log("######There are orders with status 'TRIGGER_PENDING' and instname 'OPTIDX'.");
    }

};

const runI4ProEveryMinute = async (api) => {
    // Run the function immediately
    await i4pro(api);
    
  }
  
  module.exports = runI4ProEveryMinute;
// TODO:
// once the LTP has moved to profit then it should shift the SL order to minor profit.

// other file is ccalled only once, even if called multiple times it login is giving issue

// check executeI4Pro commented  code + separate login method
// or merge both files

module.exports = i4pro; // Export the function for testing purposes