'use strict';

const path = require('path');
const ViberNotifier = require('./lib/viber');

let instance = null;
let notifier = null;

module.exports = {
  onLoad(ctx) {
    notifier = require(path.join(ctx.dataDir, '..', 'helpers', 'notifier'));
    instance = new ViberNotifier(ctx.db);

    notifier.register('viber-bot', (type, data) => {
      return instance.sendNotification(type, data);
    });

    ctx.app.locals.viberBot = instance;
    console.log('[viber-bot] Addon loaded');
  },

  onDisable(ctx) {
    if (notifier) {
      notifier.unregister('viber-bot');
    }
    delete ctx.app.locals.viberBot;
    instance = null;
    console.log('[viber-bot] Addon disabled');
  },

  onUserDelete(ctx, userId) {}
};
