const { glob } = require('fs/promises');
const { isTimeEqualsNotAfterProps, identify_option_type, fetchSpotPrice, delay, getStrike, calcVix, nearByTsymPutAgg, nearByTsymPutSub, nearByTsymCallAgg, nearByTsymCallSub, nearByPositions, calcPnL } = require('./utils/customLibrary');
const moment = require('moment');
const { tr } = require('@ixjb94/indicators');

const maxLossPerOrderPercent = 0.22;
const maxLossPerDayPercent = 0.75, maxGainPerDayPercent = 1.2;
const limitPerLot = 250000, waitAfterLoss = 15, waitAfterGain = 5;
let pnl = '', globalInputCaller = { quantityInLots: 0 };
let soldOptionPrice = 0;
let SLMinorProfitMark = 0.1;
let bookProfitMark = 0.2;
let profitInRs = 0, profitInPercent = 0;
let exitHr = 15, exitMin = 15;

const executeI4Pro = async (api, hasRunFindNearestExpiry) => {
    try {
        const { runAsyncTasks } = require('./queryBias_i4pro.js');
        const globalInput = await runAsyncTasks(api, hasRunFindNearestExpiry);
        globalInputCaller = globalInput;
    } catch (error) {
        console.error(error.response?.status === 502 ? "502 Bad Gateway Error in executeI4Pro:" : "Error in executeI4Pro:", error);
    }
};

const getQuantityInLots = () => globalInputCaller.quantityInLots = Math.floor(globalInputCaller?.limits / limitPerLot);

const getLTPfromSymbol = async (api, tsym) => {
    try {
        const localSearch = await api.searchscrip(globalInputCaller.pickedExchange, tsym);
        const localToken = localSearch.values[0].token;
        const ltpResponse = await api.get_quotes(globalInputCaller.pickedExchange, localToken);
        return [ltpResponse.lp, ltpResponse.uc];
    } catch (error) {
        console.error("Error in getLTPfromSymbol:", error);
        throw error;
    }
};

const placeOrder = async (api, orderParams) => {
    try {
        globalInputCaller.pickedExchange === 'BFO' ? await delay(3500) : await delay(1500);
        const response = await api.place_order(orderParams);
        console.log("Order Response:", response);
        return response;
    } catch (error) {
        console.error("Error in placeOrder:", error);
    }
};

const placeSLOrder = async (api) => {
    try {
        const localSLPrice = await getLTPfromSymbol(api, globalInputCaller.optionInAction);
        const maxLossPerOrder = (globalInputCaller?.limits / 100) * maxLossPerOrderPercent;
        const calcQuantity = globalInputCaller.quantityInLots * globalInputCaller.LotSize;
        const calcSLPrice = Number(localSLPrice[0] || 10) + (maxLossPerOrder / calcQuantity);

        const orderSubCESL = {
            buy_or_sell: 'B', product_type: 'M', exchange: globalInputCaller.pickedExchange,
            tradingsymbol: globalInputCaller.optionInAction, quantity: calcQuantity, discloseqty: 0,
            price_type: 'SL-LMT', price: Math.min(Number(Math.round(calcSLPrice) + 2), Number(localSLPrice[1])),
            trigger_price: Math.min(Number(Math.round(calcSLPrice)), (Number(localSLPrice[1]) - 0.5)),
            remarks: 'CommonOrderCEEntryAPISL'
        };
        await placeOrder(api, orderSubCESL);
    } catch (error) {
        console.error("Error in placeSLOrder:", error);
    }
};

const placeSellOrder = async (api) => {
    try {
        const orderSubCE = {
            buy_or_sell: 'S', product_type: 'M', exchange: globalInputCaller.pickedExchange,
            tradingsymbol: globalInputCaller.optionInAction, quantity: globalInputCaller.quantityInLots * globalInputCaller.LotSize,
            discloseqty: 0, price_type: 'MKT', price: 0, remarks: 'CommonOrderCEEntryAPI'
        };
        globalInputCaller.soldOptionToken = globalInputCaller.atmStrikeToken;
        const response = await placeOrder(api, orderSubCE);
    
        const orders = await api.get_orderbook();
        for (const order of orders) {
            if (order?.norenordno && order?.trantype == 'S') {
                if (order?.norenordno == response?.norenordno) {
                    soldOptionPrice = order?.avgprc;
                }
            }
        }
    } catch (error) {
        console.error("Error in placeSellOrder:", error);
    }
};

const exitOrder = async (position, api) => {
    try {
        const orderSubCE = {
            buy_or_sell: 'B', product_type: 'M', exchange: globalInputCaller.pickedExchange,
            tradingsymbol: position.tsym, quantity: Math.abs(position.netqty).toString(),
            discloseqty: 0, price_type: 'MKT', price: 0, remarks: 'ExitAPI'
        };
        await placeOrder(api, orderSubCE);
    } catch (error) {
        console.error("Error in exitOrder:", error);
    }
};

const cancelOpenOrders = async (api) => {
    try {
        const orders = await api.get_orderbook();
        const filtered_data_API = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING') : [];
        for (const order of filtered_data_API) {
            if (order?.norenordno) {
                await api.cancel_order(order.norenordno);
                console.log("Cancelling order:", order.norenordno);
            }
        }
    } catch (error) {
        console.error("Error in cancelOpenOrders:", error);
    }
};

const exitAll = async (api) => {
    try {
        console.log("### Exiting all positions.");
        const positionsData = await api.get_positions();
        for (let i = 0; i < positionsData.length; i++) {
            if (parseInt(positionsData[i].netqty) < 0) {
                await exitOrder(positionsData[i], api);
                await delay(1500);
                await cancelOpenOrders(api);
            }
        }
    } catch (error) {
        console.error("Error in exitAll:", error);
    }
};

const checkExitCondition = async (globalInputCaller) => {
    try {
        pnl = await calcPnL(api);
        console.log("### PNL :", pnl)

        let shouldExit = false;

        if (isTimeEqualsNotAfterProps(exitHr, exitMin, false) && !(isTimeEqualsNotAfterProps(15, 29, false))) {
            await exitAll(api);
            shouldExit = true;
        } else if (parseFloat(pnl.replace('%', '')) < -maxLossPerDayPercent || parseFloat(pnl.replace('%', '')) > maxGainPerDayPercent) {
            await exitAll(api);
            shouldExit = true;
        }

        if (shouldExit) process.exit(0);

        const positionsData = await api.get_positions();
        const filtered_data = Array.isArray(positionsData) ? positionsData.filter(item => item?.netqty < 0) : [];
        filtered_data?.forEach((position) => console.log("### LTP : " + position?.lp + (soldOptionPrice == 0 ? '' : '(' + profitInPercent + '%)') + ' | ' + position?.tsym.slice(-6)));
        return false;
    } catch (error) {
        console.error("Error in checkExitCondition:", error);
        throw error;
    }
};

const placeOrderSet = async (api) => {
    try {
        await placeSLOrder(api);
        await placeSellOrder(api);
    } catch (error) {
        console.error("Error in placeOrderSet:", error);
    }
};

const updateTriggerOrder = async (api, order) => {
    let orderSubCESL = {};

    console.log(order, " : checking the SL order");
    console.log(order.trgprc, " : order.trgprc");

    localLTPPrice = await getLTPfromSymbol(api, order.tsym);

    const maxLossPerOrder = (globalInputCaller?.limits / 100) * maxLossPerOrderPercent; //200000 / 100 * 0.33 = 660
    const calcQuantity = globalInputCaller.quantityInLots * globalInputCaller.LotSize;
    const calcSLPrice = Number(localLTPPrice[0] || 10) + (maxLossPerOrder / calcQuantity);

    const positionsData = await api.get_positions();
    const filtered_data = Array.isArray(positionsData) ? positionsData.filter(item => item?.netqty < 0) : [];
    const position = filtered_data[0];
    profitInRs = (Math.round(soldOptionPrice - position?.lp) * order.qty);
    profitInPercent = ((profitInRs/globalInputCaller?.limits) * 100).toFixed(2);
    console.log('order & position:', globalInputCaller?.optionInAction, position?.tsym);
    if ( profitInPercent >= bookProfitMark && globalInputCaller?.optionInAction != position?.tsym) {
        console.log('### ------ BP:', profitInPercent);
        await exitAll(api);
        return;
    }
    
    //bring SL to minor profit
    let moveMinorProfitCondition = soldOptionPrice != 0 ? order.trgprc > Math.round(soldOptionPrice): false;
    let movedToMinorProfit = soldOptionPrice != 0 ? order.trgprc <= (Math.round(soldOptionPrice)-1) : true;
    if (moveMinorProfitCondition) {
        console.log('### SSL :', Number(Math.round(order.trgprc)), Number(Math.round(calcSLPrice)), order.tsym.slice(-6));
        if ( profitInPercent >= SLMinorProfitMark) {
            console.log('### ------ SLP:', Number(Math.round(order.trgprc)), Number(Math.round(calcSLPrice)));
            orderSubModSL = {
                orderno: order.norenordno,
                exchange: globalInputCaller.pickedExchange,
                tradingsymbol: order.tsym,
                newquantity: order.qty,
                newprice_type: 'SL-LMT',
                newprice: Number(Math.round(soldOptionPrice) + 1),
                buy_or_sell: 'B',
                product_type: 'M',
                newtrigger_price: Number(Math.round(soldOptionPrice - 1)),
                remarks: 'CommonOrderCEModAPISLP'
            }
            await api.modify_order(orderSubModSL)
            return;
        }
    } else if ((order.trgprc - calcSLPrice > 2) && movedToMinorProfit) {
        let moveSLCloser = soldOptionPrice != 0 ? calcSLPrice <= order.trgprc : true;
        console.log('### SSL :', Number(Math.round(order.trgprc)), Number(Math.round(calcSLPrice)), order.tsym.slice(-6));
        if(moveSLCloser) {
            orderSubModSL = {
                orderno: order.norenordno,
                exchange: globalInputCaller.pickedExchange,
                tradingsymbol: order.tsym,
                newquantity: order.qty,
                newprice_type: 'SL-LMT',
                newprice: Math.min(Number(Math.round(calcSLPrice) + 2), Number(localLTPPrice[1])),
                buy_or_sell: 'B',
                product_type: 'M',
                newtrigger_price: Math.min(Number(Math.round(calcSLPrice)), (Number(localLTPPrice[1]) - 0.5)),
                remarks: 'CommonOrderCEModAPISL'
            }
            await api.modify_order(orderSubModSL)
            console.log('### ------ SLM:', Number(Math.round(order.trgprc)), Number(Math.round(calcSLPrice)));
        }
        return;
    } else {
        console.log('### SSL :', Number(Math.round(order.trgprc)), Number(Math.round(calcSLPrice)), order.tsym.slice(-6));
        return;
    }
}

const i4pro = async (api, hasRunFindNearestExpiry) => {
    try {
        await executeI4Pro(api, hasRunFindNearestExpiry);

        getQuantityInLots();
        const resultBiasString = Object.entries(globalInputCaller?.resultBias).map(([key, value]) => `${key[0]}:${value}`).join(', ');
        console.log("### BIA :", globalInputCaller?.resultBias[globalInputCaller.finalWeeklyExpiryName], '|' , resultBiasString);

        const shouldExit = await checkExitCondition(globalInputCaller);
        if (shouldExit) {
            process.exit(0);
        }

        await delay(1000);

        const orders = await api.get_orderbook();

        const filtered_data_SL_CE = Array.isArray(orders) ? orders.filter(item => item?.status === 'TRIGGER_PENDING' && item?.instname === 'OPTIDX') : [];

        if (filtered_data_SL_CE.length === 0) {
            let mostRecentOrder = null;
            if (orders && orders.length > 0) {
                mostRecentOrder = orders.sort((a, b) => b.ordenttm - a.ordenttm)[0];

                const currentTime = moment().utcOffset("+05:30").unix(); // Current time in seconds (IST)
                let orderTime;
                let orderDate;
                if (mostRecentOrder?.norentm) {
                    orderDate = moment(mostRecentOrder.norentm, 'HH:mm:ss DD-MM-YYYY').utcOffset("+05:30", true);
                    if (orderDate.isValid()) {
                        orderTime = orderDate.unix(); // Convert to seconds since Unix epoch (IST)
                    } else {
                        console.error("Invalid date format for norentm:", mostRecentOrder.norentm);
                        orderTime = parseInt(mostRecentOrder.ordenttm); // Order time in seconds;
                    }
                } else {
                    console.error("No norentm property found in the most recent order:", mostRecentOrder);
                    orderTime = parseInt(mostRecentOrder?.ordenttm); // Order time in seconds;
                }
                const timePassed = Math.abs(currentTime - orderTime); // Absolute difference in seconds
                const minimumWaitTime = waitAfterLoss * 60; // Convert minutes to seconds
                const minimumWaitTimeGain = waitAfterGain * 60; // Convert minutes to seconds

                if (parseFloat(pnl.replace('%', '')) >= 0) {
                    if (timePassed >= Math.max(waitAfterGain, minimumWaitTimeGain)) {
                        await placeOrderSet(api);
                    } else {
                        console.log(`### TIM: ${Math.floor(timePassed / 60)} mins. ${moment().utcOffset("+05:30").format('HH:mm:ss')}`);
                    }
                } else {
                    if (timePassed >= Math.max(waitAfterLoss, minimumWaitTime)) {
                        await placeOrderSet(api);
                    } else {
                        console.log(`### TIM: ${Math.floor(timePassed / 60)} mins. ${moment().utcOffset("+05:30").format('HH:mm:ss')}`);
                    }
                }
            } else {
                console.log("No orders found.");
                await placeOrderSet(api);
            }
        } else {
            // console.log("###trigger: ", filtered_data_SL_CE[0].trgprc);
            await updateTriggerOrder(api, filtered_data_SL_CE[0]);
            console.log("### TRG_PEND at", moment().utcOffset("+05:30").format('HH:mm:ss'));
        }
    } catch (error) {
        console.error("Error in i4pro:", error);
        throw error;
    }
};
// TODO:
// once the LTP has moved to profit then it should shift the SL order to minor profit.

module.exports = i4pro; 