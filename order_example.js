const Api = require("./lib/RestApi");

let { authparams } = require("./creds");

api = new Api({});
let latestOrders = {};

function receiveQuote(data) {
    // console.log("Quote ::", data);
}

function receiveOrders(data) {
    // console.log("Order ::", data);
    latestOrders[data.tsym] = data;
}

function open(data) {
    let instruments = '';
    api.subscribe(instruments)
    // console.log("subsribing to :: ", instruments);
}

api.login(authparams)
.then((res) => {        
        //cons//ole.log('Reply: ', res);
        params = {
          'socket_open' : open,
          'quote' : receiveQuote,   
          'order' : receiveOrders       
        }

        api.start_websocket(params);

        
        //place order
        let orderparams = {
            'buy_or_sell' : 'B',
            'product_type' : 'C',
            'exchange' : 'NSE',
            'tradingsymbol'  :  'ACC-EQ',
            'quantity' : 1,
            'discloseqty' : 0,
            'price_type' : 'LMT',
            'price' : 2201.0
        };

        setTimeout(() => {
            api.place_order(orderparams)
            .then((reply) => { 
                // console.log(reply, reply);   
                

        // let modifyparams = {
        //     'orderno' : reply.norenordno,
        //     'exchange' : 'NSE',
        //     'tradingsymbol' : 'ACC-EQ',
        //     'newquantity' : 2,
        //     'newprice_type' : 'LMT',
        //     'newprice' : 2202.00
        // }

        // api.modify_order(modifyparams)
        //     .then((modreply) => { 
        //             // console.log(modreply, 'modreply');
                    
        //             api.cancel_order(modreply.result)
        //             .then((cancelreply) => {
        //                 console.log(cancelreply, 'cancelreply');
        //             });
        //             console.log(latestOrders, 'latestOrders2')
        //         });
        });
        },2000 )

        setTimeout(() => {
            // console.log(latestOrders, 'latestOrders1')
        }, 4000)
        

        api.get_orderbook()
        .then(async (reply) => { 
        //   console.log(reply, 'orderbook');
            orders = reply;
            // console.log(reply, "orders data");

            const orderSubCE = {
              buy_or_sell: 'S', product_type: 'M', exchange: "BFO",
              tradingsymbol: 'SENSEX2520476800PE', quantity: 20,
              discloseqty: 0, price_type: 'MKT', price: 0, remarks: 'CommonOrderCEEntryAPI'
          };
        //   const data = await api.get_security_info(exchange='NSE', token='22')
        //   console.log(data, 'data')
          // await placeOrder(api, orderSubCE);
        });
        
        

    }).catch((err) => {
        console.error(err);
    });

