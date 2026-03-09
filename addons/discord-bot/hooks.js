'use strict';

const path = require('path');
const QuestPlannerBot = require('./lib/bot');

let botInstance = null;
let notifier = null;

module.exports = {
  onLoad(ctx) {
    // Stop previous bot instance if exists (prevents duplicate handlers on reload)
    if (botInstance) {
      botInstance.stop();
      botInstance = null;
    }

    // Get notifier reference (works for both preinstalled and community addons)
    notifier = require(path.join(ctx.dataDir, '..', 'helpers', 'notifier'));

    botInstance = new QuestPlannerBot(ctx);
    botInstance.start().then(started => {
      if (started) {
        console.log('[discord-bot] Bot started successfully');
      }
    }).catch(err => {
      console.error('[discord-bot] Failed to start bot:', err.message);
    });

    // Register with central notifier
    notifier.register('discord-bot', (type, data) => {
      if (botInstance && botInstance.ready) {
        return botInstance.sendNotification(type, data);
      }
    });

    // Make bot instance available to routes via app.locals
    ctx.app.locals.discordBot = botInstance;
  },

  onDisable(ctx) {
    if (notifier) {
      notifier.unregister('discord-bot');
    }
    if (botInstance) {
      botInstance.stop();
      botInstance = null;
    }
    delete ctx.app.locals.discordBot;
    console.log('[discord-bot] Addon disabled, bot stopped');
  },

  onUserDelete(ctx, userId) {
    ctx.db.prepare('DELETE FROM discord_linked_accounts WHERE user_id = ?').run(userId);
  }
};
