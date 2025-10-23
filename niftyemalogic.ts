const { idxNameTokenMap } = require('./utils/customLibrary');

  globalInput.token = idxNameTokenMap.get(globalInput.indexName);

   // Get current date and time in IST
      const currentDateIST = new Date();

      // Set the time to 2 o'clock
      currentDateIST.setHours(0, 0, 0, 0);

      // Subtract 5 day to get the 5 days earlier time
      currentDateIST.setDate(currentDateIST.getDate() - 5);

      // Get epoch time in milliseconds
      const epochTime = currentDateIST.getTime();
      epochTimeTrimmed = epochTime.toString().slice(0, -3);

      params = {
        'exchange'   : 'NSE',
        'token' : globalInput.token,
        'starttime'    : epochTimeTrimmed,
        'interval' : '1'
        }

                const [callema9, callema21] = await ema9and21ValuesIndicators(params); //call


                    const { Indicators } = require('@ixjb94/indicators');

                        const reply = await api.get_time_price_series(params);

    // console.log(reply[0], ' : reply'); 
    // Extract 'intc' prices into a new array
    const intcPrices = reply.map(item => parseFloat(item.intc));
    
    //last 50 items
    const first9Items = intcPrices.slice(0,80).reverse();
    const first21Items = first9Items;

     // Calculate 9-period EMA
    let ta = new Indicators();
    let ema9Values = await ta.ema(first9Items, 12);
    // Calculate 21-period EMA
    let ema21Values = await ta.ema(first21Items, 26);
    //send last item from the array
    return [ema9Values[ema9Values.length-1], ema21Values[ema21Values.length-1]];