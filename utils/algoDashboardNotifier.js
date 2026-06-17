const http = require('http');
const https = require('https');

try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional for callers that already provide process.env.
}

const falseValues = new Set(['0', 'false', 'off', 'no']);

const isTelegramEnabled = () => !falseValues.has(String(process.env.ALGO_TELEGRAM_ENABLED ?? '1').trim().toLowerCase());

const dashboardWebhookUrl = () => process.env.ALGO_DASHBOARD_WEBHOOK_URL || 'http://127.0.0.1:8787/events';

const postDashboardEvent = (payload) => new Promise((resolve, reject) => {
  const targetUrl = dashboardWebhookUrl();
  const webhookToken = process.env.ALGO_WEBHOOK_TOKEN || process.env.ALGO_DASHBOARD_TOKEN || '';
  let url;
  try {
    url = new URL(targetUrl);
  } catch (error) {
    reject(new Error(`Invalid ALGO_DASHBOARD_WEBHOOK_URL: ${targetUrl}`));
    return;
  }

  const body = JSON.stringify(payload);
  const client = url.protocol === 'https:' ? https : http;
  const request = client.request({
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    timeout: 1500,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...(webhookToken ? { 'x-algo-webhook-token': webhookToken } : {}),
    },
  }, (response) => {
    response.resume();
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`dashboard webhook status ${response.statusCode}`));
      }
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error('dashboard webhook timeout'));
  });
  request.on('error', reject);
  request.end(body);
});

const createAlgoNotifier = ({
  bot,
  chat_id,
  chat_id_me,
  debug = false,
  source = 'algo',
  getTelegramSignals = () => ({}),
}) => async (message, me = false) => {
  if (message) {
    console.log(message);
  }
  if (!message || debug) {
    return;
  }

  postDashboardEvent({
    source,
    important: Boolean(me),
    message,
  }).catch((error) => {
    console.error(`Algo dashboard webhook failed: ${error.message || error}`);
  });

  if (!isTelegramEnabled() || !bot?.sendMessage) {
    return;
  }

  const telegramSignals = getTelegramSignals() || {};
  const targetChatId = (me && !telegramSignals.stopSignal) ? chat_id_me : chat_id;
  const telegramMessage = (me && !telegramSignals.stopSignal) ? message : message.replace(/\) /g, ')\n');
  await bot.sendMessage(targetChatId, telegramMessage).catch(console.error);
};

const createTelegramBot = (TelegramBot, telegramBotToken) => {
  if (!isTelegramEnabled()) {
    return {
      on: () => {},
      onText: () => {},
      sendMessage: async () => {},
    };
  }
  return new TelegramBot(telegramBotToken, { polling: true });
};

module.exports = {
  createAlgoNotifier,
  createTelegramBot,
  isTelegramEnabled,
  postDashboardEvent,
};
