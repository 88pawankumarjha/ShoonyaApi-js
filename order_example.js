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
        .then((reply) => { 
          console.log(reply, 'orderbook');
            orders = reply;
            let mostRecentOrder = null;
            console.log(reply, "orders data");
            if (orders && orders.length > 0) {
                mostRecentOrder = orders.sort((a, b) => b.ordenttm - a.ordenttm)[0];
                console.log("Most Recent Order:", mostRecentOrder);

                /*
                Most Recent Order: {
                  stat: 'Ok',
                  norenordno: '25012000134817',   
                  kidid: '2',
                  uid: 'FA63911',
                  actid: 'FA63911',
                  exch: 'BFO',
                  tsym: 'SENSEX2512176800CE',     
                  rejby: '',
                  src_uid: 'FA63911',
                  qty: '20',
                  rorgqty: '20',
                  ipaddr: '49.43.251.49',
                  ordenttm: '1737350184',
                  trantype: 'B',
                  prctyp: 'LMT',
                  ret: 'DAY',
                  rejreason: ' ',
                  token: '837087',
                  mult: '1',
                  prcftr: '1.000000',
                  instname: 'OPTIDX',
                  ordersource: 'MOB',
                  pp: '2',
                  ls: '20',
                  ti: '0.05',
                  prc: '327.00',
                  trgprc: '325.00',
                  rorgprc: '355.00',
                  rprc: '327.00',
                  avgprc: '325.00',
                  dscqty: '0',
                  brnchid: 'HO',
                  C: 'C',
                  s_prdt_ali: 'NRML',
                  prd: 'M',
                  status: 'COMPLETE',
                  st_intrn: 'COMPLETE',
                  fillshares: '20',
                  norentm: '10:46:54 20-01-2025', 
                  exch_tm: '20-01-2025 10:46:24', 
                  remarks: 'CommonOrderCEEntryAPISL',
                  exchordid: '1737348198860425810',
                  rqty: '20'
                }
                */
              } else {
                console.log("No orders found.");
              }

               // Check if 30 minutes have passed
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      const orderTime = parseInt(mostRecentOrder.ordenttm); // Order time in seconds
      const timePassed = currentTime - orderTime;

      if (timePassed >= 30 * 60) { // 30 minutes in seconds
        console.log("Success: 30 minutes have passed since the most recent order.");
      } else {
        console.log(`Time passed since the most recent order: ${timePassed} seconds.`);
      }
        });
        
        

    }).catch((err) => {
        console.error(err);
    });

