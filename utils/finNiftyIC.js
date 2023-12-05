const { debug, getPickedIndex, getPickedExchange } = require('./common');
const { identify_option_type, fetchSpotPrice, delay, getStrike, calcVix } = require('./customLibrary');

module.exports.runFinNiftyContinuumIC = async (api) => {
    try {
        debug && console.log('inside runFinNiftyContinuumIC')
        const pickedIndex = await getPickedIndex(api); // FINNIFTY

        //vix
        const calcVixVal = await calcVix(api);

        //finNifty Bias
        const finNiftyBias = await find_bias(api, '26037', '50', pickedIndex, getPickedExchange())
        debug && console.log('finNiftyBias: ', finNiftyBias);

        //raise sell orders
        //raise SL orders
        //close CE orders
        //far CE orders
        //close PE orders
        //far PE orders
    } catch (error) {
        console.error("Error in runFinNiftyContinuumIC:", error);
        return null;
    }
}

//___
// global call and put levels
// global finNifty Bias (initiates in first call -- changes after each fetchBias from common)
// global VIX (initiates in first call -- changes after each alert)

//initiate morning
//raise SL orders

// adjust go far in call side
// raise SL orders

// adjust go far in put side
// raise SL orders

// adjust come close in call side
// raise SL orders

// adjust come close in put side
// raise SL orders