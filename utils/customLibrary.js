module.exports.fetchSpotPrice = async (api, inputToken, pickedExchange) => {
  try {
      const selectedExchange = pickedExchange === 'BFO' ? 'BSE':pickedExchange === 'NFO'? 'NSE': 'MCX';
      return await api.get_quotes(selectedExchange, inputToken);
  } catch (error) {
      throw new Error(`Error fetching spot price:: ${error.message}`);
  }
}

const identify_option_type = (symbol) => {
  const cleaned_symbol = symbol.replace(/\d+$/, ''); // Remove trailing digits
  return cleaned_symbol.endsWith('C') || cleaned_symbol.endsWith('CE') ? 'C' : cleaned_symbol.endsWith('P') || cleaned_symbol.endsWith('PE') ? 'P' : 'U';
}
module.exports.identify_option_type = identify_option_type;


module.exports.delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports.calcVix = async (api) => {
  const vixQuote = await api.get_quotes('NSE', '26017') || 1;
  return parseFloat((((vixQuote?.lp - vixQuote?.c)/vixQuote?.c)*100) || 1).toFixed(2) || 1;
}

const getStrike = (tsym, pickedExchange) => {
  if (pickedExchange === 'NFO'){//BANKNIFTY22NOV23C43800, FINNIFTY28NOV23C19300, NIFTY23NOV23C19750
          return +tsym.slice(-5);
      }
  else if (pickedExchange === 'BFO') {//SENSEX23N1765500PE, BANKEX23N2049300CE
      return +tsym.slice(-7, -2);
  }
  else {// NATURALGAS23NOV23P230
      return +tsym.slice(-3);
  }
}
module.exports.getStrike = getStrike;

module.exports.nearByTsymPutSub = (item, ocGapCalc, pickedExchange) => {
  return item.tsym.slice(0, -5) + (getStrike(item.tsym, pickedExchange) - parseInt(ocGapCalc, 10))
}
module.exports.nearByTsymCallAgg = (item, ocGapCalc, pickedExchange) => {
  return item.tsym.slice(0, -5) + (getStrike(item.tsym, pickedExchange) - parseInt(ocGapCalc, 10))
}
module.exports.nearByTsymCallSub = (item, ocGapCalc, pickedExchange) => {
  return item.tsym.slice(0, -5) + (getStrike(item.tsym, pickedExchange) + parseInt(ocGapCalc, 10))
}
module.exports.nearByTsymPutAgg = (item, ocGapCalc, pickedExchange) => {
  return item.tsym.slice(0, -5) + (getStrike(item.tsym, pickedExchange) + parseInt(ocGapCalc, 10))
}


//nearest expiry start
module.exports.idxNameOcGap = new Map([
  ['BANKEX', '100'],
  ['FINNIFTY', '50'],
  ['BANKNIFTY', '100'],
  ['NIFTY', '50'],
  ['SENSEX', '100'],
]);
//nearest ocGap
module.exports.idxNameTokenMap = new Map([
  ['BANKEX', '12'],
  ['FINNIFTY', '26037'],
  ['BANKNIFTY', '26009'],
  ['NIFTY', '26000'],
  ['SENSEX', '1'],
]);

module.exports.downloadCsv = async (url, destination, axios, fs) => {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'axios', // Set a User-Agent header
      },
    });
    const writer = fs.createWriteStream(destination);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
};

module.exports.filterAndMapDates = (moment, data) => {
  const currentDate = moment().format('YYYY-MM-DD');
  return data
    .filter((row) => moment(row.Expiry, 'DD-MMM-YYYY').isSameOrAfter(currentDate))
    .map((row) => ({ ...row, Expiry: moment(row.Expiry, 'DD-MMM-YYYY').format('YYYY-MM-DD') }));
};
//nearest expiry end

const istDateTimeFormat = new Intl.DateTimeFormat('en-US', {
timeZone: 'Asia/Kolkata',
hour: 'numeric',
minute: 'numeric',
hour12: false,
});

module.exports.isTimeEqualsNotAfterProps = (inputHrs, inputMins, isEqualNotAfter) => {
if (typeof inputHrs !== 'number' || typeof inputMins !== 'number' || inputHrs < 0 || inputHrs > 23 || inputMins < 0 || inputMins > 59) {
  throw new Error('Invalid input parameters. Hours must be between 0 and 23, and minutes must be between 0 and 59.');
}
const currentDate = new Date();
const formattedTime = istDateTimeFormat.format(currentDate);
const [hours, minutes] = formattedTime.split(':').map(Number);
return isEqualNotAfter ? (hours === inputHrs && minutes === inputMins) : (hours > inputHrs || (hours === inputHrs && minutes >= inputMins));
};
