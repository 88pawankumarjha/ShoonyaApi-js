let Api;
let api;
let introDelay;
let includeDelay;
let getVix, vix;
const { authparams } = require('./cred');
const { identify_option_type, fetchSpotPrice, getStrike, calcVix } = require('./utils/customLibrary');
Api = require('./lib/RestApi');
api = new Api({});
let ltp_rounded;
let open, mod, atmStrike, newSearchSymbol, searchResult;
let getATMToken;
let ocGap = 50;
let keyword = 'FINNIFTY';
let ATMToken1;
let ATMToken2;
let ltpPut, ltpCall, ltpSuggestedCall, ltpSuggestedPut, calcBias;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
//vix
updateVix = async () => {
    await api.get_quotes('NSE', '26017').then(
        v => {vix = parseFloat((((v?.lp - v?.c)/v?.c)*100)).toFixed(2); }// 0.00 
    )
    return;
};
getATMToken = async (level) => {
    newSearchSymbol = keyword + ' ' + (atmStrike + ocGap * level) + ` ${Number(level) > 0 ? 'PE' : 'CE'}`;
    searchResult = await api.searchscrip('NFO', newSearchSymbol);
    return searchResult.values[0].token;
};
getOCToken = async (level, side) => { // PE || CE, level for distance from ATM (-1 for less and 1 for more)
    newSearchSymbol = keyword + ' ' + (atmStrike + ocGap * level) + ` ${side}`;
    searchResult = await api.searchscrip('NFO', newSearchSymbol);
    return searchResult.values[0].token;
}; //getOCToken(0,'CE') // ATM - FINNIFTY 19650 CE's token
// getOCToken(-1,'PE') // ITM - FINNIFTY 19600 PE's token
// finNifty Bias
getBias = async () => {
    try {
      const s = await fetchSpotPrice(api, '26037', 'NFO');
      ltp_rounded = Math.round(parseFloat(s.lp));
      open = Math.round(parseFloat(s.o || s.c || s.lp));
      mod = ltp_rounded % ocGap;
      atmStrike = mod < ocGap / 2 ? Math.floor(ltp_rounded / ocGap) * ocGap : Math.ceil(ltp_rounded / ocGap) * ocGap;
  
      ATMToken1 = await getATMToken(-2);
      ATMToken2 = await getATMToken(2);
      const resPut = await api.get_quotes('NFO', ATMToken2);
      ltpPut = parseFloat(resPut.lp) || 0;
      const resCall = await api.get_quotes('NFO', ATMToken1);
      ltpCall = parseFloat(resCall.lp) || 0;
      ltpSuggestedPut = atmStrike + ocGap * 2 - ltpPut;
      ltpSuggestedCall = atmStrike - ocGap * 2 + ltpCall;
      calcBias = Math.round(((ltpSuggestedCall + ltpSuggestedPut) / 2) - ltp_rounded);
    } catch (error) {
      console.error('Error in getBias:', error);
      throw error; // Rethrow the error to propagate it
    }
};
api.login(authparams)
    .then(async () => {
      await delay(2000);
      return updateVix();
    })
    .then(async () => {
      await delay(2000);
      return getBias();
    })
    .then(() => {
      console.log(vix);
      console.log(calcBias);
    })
    .catch((err) => {
      console.error(err);
    });
