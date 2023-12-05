const Api = require("./lib/RestApi");

let { authparams } = require("./cred");

const api = new Api({});
let latestQuotes = {};
let latestOrders = {};

function receiveQuote(data) {
    console.log("Quote ::", data);
    // Update the latest quote value for the corresponding instrument
    latestQuotes[data.e + '|' + data.tk] = data;
}

function receiveOrders(data) {
    console.log("Order ::", data);
    // Update the latest order value for the corresponding instrument
    latestOrders[data.Instrument] = data;
}

function open(data) {
    const initialInstruments = ['NSE|22', 'BSE|500400'];
    subscribeToInstruments(initialInstruments);
    console.log("Subscribing to :: ", initialInstruments);
}

function subscribeToInstruments(instruments) {
    instruments.forEach(instrument => {
        api.subscribe(instrument);
    });
}

function dynamicallyAddSubscription(newInstrument) {
    if (!latestQuotes[newInstrument]) {
        console.log("Subscribing to :: ", newInstrument);
        api.subscribe(newInstrument);
    }
}

api.login(authparams)
    .then((res) => {
        if (res.stat !== 'Ok') return;

        const params = {
            'socket_open': open,
            'quote': receiveQuote,
            'order': receiveOrders
        };

        api.start_websocket(params);

        // Print the latest values every 5 seconds
        setInterval(() => {
            console.log("Latest Values for NSE|22 :: Quote:", latestQuotes['NSE|22'] ? latestQuotes['NSE|22'].lp : "N/A", "Order:", latestOrders['NSE|22']);
            console.log("Latest Values for BSE|500400 :: Quote:", latestQuotes['BSE|500400'] ? latestQuotes['BSE|500400'].lp : "N/A", "Order:", latestOrders['BSE|500400']);
            console.log("Latest Values for NSE|26000 :: Quote:", latestQuotes['NSE|26000'] ? latestQuotes['NSE|26000'].lp : "N/A", "Order:", latestOrders['NSE|26000']);
        }, 5000);

        // Example: Dynamically add a subscription after 10 seconds
        setTimeout(() => {
            dynamicallyAddSubscription('NSE|26000');
        }, 10000);

    })
    .catch((err) => {
        console.error(err);
    });
