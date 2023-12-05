function createRealTimeDataHandler(api) {
    const latestQuotes = {};
    const latestOrders = {};
    const subscribedInstruments = [];

    function receiveQuote(data) {
        console.log("Quote ::", data);
        latestQuotes[data.e + '|' + data.tk] = data;
    }

    function receiveOrders(data) {
        console.log("Order ::", data);
        latestOrders[data.Instrument] = data;
    }

    function open(instruments) {
        if (!Array.isArray(instruments)) {
            console.error("Invalid instruments format. Expecting an array.");
            return;
        }

        subscribeToInstruments(instruments);
        console.log("Subscribing to :: ", instruments);
    }


    function subscribeToInstruments(instruments) {
        if (!Array.isArray(instruments)) {
            console.error("Invalid instruments format. Expecting an array.");
            return;
        }

        instruments.forEach(instrument => {
            if (!subscribedInstruments.includes(instrument)) {
                api.subscribe(instrument);
                subscribedInstruments.push(instrument);
            }
        });
    }


    function dynamicallyAddSubscription(newInstrument) {
        if (!latestQuotes[newInstrument]) {
            api.subscribe(newInstrument);
            console.log("Subscribing to :: ", newInstrument);
        }
    }

    function startRealTimeData(interval = 5000) {
        const params = {
            'socket_open': open,
            'quote': receiveQuote,
            'order': receiveOrders
        };

        api.start_websocket(params);

        // Print the latest values every specified interval
        setInterval(() => {
            console.log("Latest Values for NSE|22 :: Quote:", latestQuotes['NSE|22'] ? latestQuotes['NSE|22'].lp : "N/A", "Order:", latestOrders['NSE|22']);
            console.log("Latest Values for BSE|500400 :: Quote:", latestQuotes['BSE|500400'] ? latestQuotes['BSE|500400'].lp : "N/A", "Order:", latestOrders['BSE|500400']);
            console.log("Latest Values for NSE|26000 :: Quote:", latestQuotes['NSE|26000'] ? latestQuotes['NSE|26000'].lp : "N/A", "Order:", latestOrders['NSE|26000']);
        }, interval);
    }

    return {
        receiveQuote,
        receiveOrders,
        open,
        subscribeToInstruments,
        dynamicallyAddSubscription,
        startRealTimeData
    };
}

module.exports = createRealTimeDataHandler;

