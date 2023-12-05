const Api = require('./lib/RestApi');
const { debug, getPickedIndex, isTimeAfter1147PM, isCrudeOrderAlreadyPlaced, crudeStraddlePlaceOrder, crudeStraddlePostOrderPlacement, fetchAllBiases, processOrders, getCustomInterval, getStopSignal, getPickedExchange } = require('./utils/common');
const { delay } = require('./utils/customLibrary');
const { runFinNiftyContinuumIC } = require('./utils/finNiftyIC');
const { authparams } = require('./creds');

const api = new Api({});
let iteration = 0;
let exitResult = '';

api.login(authparams)
  .then((res) => {
    console.log('Reply: ', res);
  })
  .catch((err) => {
    console.error(err);
  });

async function runIteration(api) {
  try {
    await delay(1000);
    await fetchAllBiases(api, getPickedExchange(), iteration);

    await delay(1000);
    await processOrders(api, getPickedExchange()); //NFO, BFO

    // Increment the iteration counter
    iteration++;

    // Check if we've received a stop signal from telegram
    if (!getStopSignal()) {
      await delay(getCustomInterval()); // Delay for 10 seconds (10000 milliseconds)
      await runIteration(api); 
    } else {
      console.log('Finished all iterations.');
      process.exit(0);
    }
  } catch (error) {
    console.error(error);
  }
}

// Initial call to start running the code
getPickedExchange() != 'MCX' && runIteration(api);

//debug && getPickedIndex() === 'FINNIFTY' && runFinNiftyContinuumIC(api);

async function runMCXIteration(api) {
  while (!isTimeAfter1147PM()) {
    try {
      console.log('Calling runMCXIteration');
      await delay(1000);
      // Check if an order is already placed
      const isOrderPlacedNow = await isCrudeOrderAlreadyPlaced(api);
      console.log(isOrderPlacedNow, 'isOrderPlacedNow');

      // Place an order if not already placed
      if (!isOrderPlacedNow) {
        await crudeStraddlePlaceOrder(api, 'MCX');
      }

      // Wait for 5 seconds
      await delay(5000);

      // Check if an order is placed again after the delay
      const isOrderPlacedAfterDelay = await isCrudeOrderAlreadyPlaced(api);
      console.log(isOrderPlacedAfterDelay, 'isOrderPlacedAfterDelay');

      // Process the order if placed again
      if (isOrderPlacedAfterDelay) {
        exitResult = await crudeStraddlePostOrderPlacement(api, 'MCX');
        console.log('Exited postOrder loop: ', exitResult); // Profit or loss
      }

      // Wait for either 5 seconds or 300 seconds based on the exit result
      await delay(exitResult === 'loss' ? 300000 : 5000);
    } catch (error) {
      console.error(error);
    }
  }
  console.log('MCX Iteration calls completed.');
}

// Start the non-recursive function
getPickedExchange() === 'MCX' && runMCXIteration(api);
