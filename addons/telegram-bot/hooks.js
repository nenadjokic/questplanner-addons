'use strict';

const path = require('path');
const TelegramNotifier = require('./lib/telegram');

let instance = null;
let notifier = null;

module.exports = {
  onLoad(ctx) {
    notifier = require(path.join(ctx.dataDir, '..', 'helpers', 'notifier'));
    instance = new TelegramNotifier(ctx.db);

    notifier.register('telegram-bot', (type, data) => {
      return instance.sendNotification(type, data);
    });

    ctx.app.locals.telegramBot = instance;
    console.log('[telegram-bot] Addon loaded');
  },

  onDisable(ctx) {
    if (notifier) {
      notifier.unregister('telegram-bot');
    }
    delete ctx.app.locals.telegramBot;
    instance = null;
    console.log('[telegram-bot] Addon disabled');
  },

  onUserDelete(ctx, userId) {}
};
