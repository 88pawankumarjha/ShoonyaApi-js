const { isTimeEqualsNotAfterProps, identify_option_type, fetchSpotPrice, delay, getStrike, calcVix, nearByTsymPutAgg, nearByTsymPutSub, nearByTsymCallAgg, nearByTsymCallSub, nearByPositions, calcPnL } = require('./customLibrary');
const debug = false;
module.exports.calculateAtmOptionsSumPrice = (atmOptionsPrice) => {
  console.log(atmOptionsPrice);
    return atmOptionsPrice.reduce((acc, price) => acc + parseFloat(price), 0);
  }


module.exports.i4find_bias = async (api, inputToken, ocGap, keyword, exchange) => {
    try {
      const Spot = await fetchSpotPrice(api, inputToken, exchange);
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
        const searchResult = await api.searchscrip(exchange, newSearchSymbol);
        // if(keyword[0] === getPickedIndex()[0] && exchange === 'BFO')
        //    {
        //       debug && console.log(searchResult, 'searchResult');
        //       return searchResult.values[searchResult.values.length - 1].token;
        //   }
        //   else {
              debug && console.log(searchResult.values[0].tsym, 'searchResult.values[0].tsym');
              return searchResult.values[0].token;
          // }
      };
  
      let biasDiffOC = exchange === 'BFO' ? 1: 2;
      debug && console.log(biasDiffOC, 'biasDiffOC');
      const [ATMToken1, ATMToken2] = await Promise.all([getATMToken(-1 * biasDiffOC), getATMToken(biasDiffOC)]);
      const [ltpPut, ltpCall] = await Promise.all([
        api.get_quotes(exchange, ATMToken2).then(response => parseFloat(response.lp) || 0),
        api.get_quotes(exchange, ATMToken1).then(response => parseFloat(response.lp) || 0)
      ]);
      const ltpSuggestedPut = atmStrike + ocGap * 2 - ltpPut;
      const ltpSuggestedCall = atmStrike - ocGap * 2 + ltpCall;
      if(debug){console.log(Spot.lp,'Spot') // lp 49911.73
      console.log(ltpPut,'ltpPut')
      console.log(ltpSuggestedPut,'ltpSuggestedPut')
      console.log(ltpCall,'ltpCall')
      console.log(ltpSuggestedCall,'ltpSuggestedCall') }
      let localCalcBias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - ltp_rounded);
      if(keyword[0] === exchange) calcBias = localCalcBias;
      debug && console.log(calcBias, ' : calcBias')
      return `${keyword[0]}[${ltp_rounded-open}] ${ltp_rounded+localCalcBias} (${localCalcBias})`;
    } catch (error) { console.error('Error:', error); return null; }
  }