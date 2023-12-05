const TelegramBot = require('node-telegram-bot-api');
const { telegramBotToken } = require('../cred');

const token = telegramBotToken;

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Start', callback_data: 'start' },
        { text: 'Stop', callback_data: 'stop' }
      ]
    ]
  };
  bot.sendMessage(chatId, 'Please choose:', { reply_markup: keyboard });
});

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  bot.sendMessage(chatId, `Selected option: ${data}`);
});

