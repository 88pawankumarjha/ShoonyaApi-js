const http = require('http');
const https = require('https');

try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional for callers that already provide process.env.
}

const falseValues = new Set(['0', 'false', 'off', 'no']);

const isMirrorEnabled = () => !falseValues.has(String(process.env.KITE_MIRROR_ENABLED || '0').trim().toLowerCase());

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstValue = (object, keys) => {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== '') {
      return object[key];
    }
  }
  return undefined;
};

const normalizeOrderSignal = (order, context = {}) => {
  const trantype = String(firstValue(order, ['trantype', 'buy_or_sell']) || '').toUpperCase();
  const quantity = toFiniteNumber(firstValue(order, ['flqty', 'qty', 'quantity']));
  const price = toFiniteNumber(firstValue(order, ['avgprc', 'flprc', 'prc', 'price']));
  const exchange = firstValue(order, ['exch', 'exchange']) || context.exchange || '';
  const tradingsymbol = firstValue(order, ['tsym', 'tradingsymbol']) || '';
  const orderno = firstValue(order, ['norenordno', 'orderno', 'result']) || '';
  const strategy = context.strategy || 'unknown';
  const status = String(firstValue(order, ['status']) || 'COMPLETE').toUpperCase();

  if (!tradingsymbol || !['B', 'S'].includes(trantype) || quantity === null || quantity <= 0 || price === null || price <= 0) {
    return null;
  }

  return {
    type: 'order_complete',
    strategy,
    broker: 'shoonya',
    source: context.source || 'REST',
    idempotency_key: `${strategy}|${orderno || `${exchange}|${tradingsymbol}|${trantype}|${quantity}|${price}`}`,
    order: {
      orderno,
      status,
      exchange,
      tradingsymbol,
      side: trantype === 'B' ? 'BUY' : 'SELL',
      shoonya_side: trantype,
      quantity,
      price,
      product: firstValue(order, ['prd', 'product_type']) || context.product || '',
      order_type: firstValue(order, ['prctyp', 'price_type']) || context.order_type || '',
      raw_time: firstValue(order, ['norentm', 'request_time', 'exch_tm']) || '',
    },
    generated_at: new Date().toISOString(),
  };
};

const postJson = (targetUrl, token, payload) => new Promise((resolve, reject) => {
  let url;
  try {
    url = new URL(targetUrl);
  } catch (error) {
    reject(new Error(`Invalid KITE_MIRROR_SIGNAL_URL: ${targetUrl}`));
    return;
  }

  const body = JSON.stringify(payload);
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request({
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    timeout: Number(process.env.KITE_MIRROR_TIMEOUT_MS || 1500),
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...(token ? { 'x-kite-mirror-token': token } : {}),
    },
  }, (response) => {
    response.resume();
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`kite mirror status ${response.statusCode}`));
      }
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error('kite mirror timeout'));
  });
  request.on('error', reject);
  request.end(body);
});

const emitKiteMirrorSignal = async (order, context = {}) => {
  if (!isMirrorEnabled()) {
    return false;
  }

  const targetUrl = process.env.KITE_MIRROR_SIGNAL_URL;
  const token = process.env.KITE_MIRROR_TOKEN || '';
  if (!targetUrl || !token) {
    console.error('Kite mirror signal skipped: KITE_MIRROR_SIGNAL_URL and KITE_MIRROR_TOKEN are required.');
    return false;
  }

  const signal = normalizeOrderSignal(order, context);
  if (!signal) {
    console.error('Kite mirror signal skipped: order could not be normalized.');
    return false;
  }

  try {
    await postJson(targetUrl, token, signal);
    return true;
  } catch (error) {
    console.error(`Kite mirror signal failed: ${error.message || error}`);
    return false;
  }
};

module.exports = {
  emitKiteMirrorSignal,
  normalizeOrderSignal,
};
