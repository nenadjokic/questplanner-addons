'use strict';

const QuestPlannerBot = require('./lib/bot');

let botInstance = null;

module.exports = {
  onLoad(ctx) {
    // Stop previous bot instance if exists (prevents duplicate handlers on reload)
    if (botInstance) {
      botInstance.stop();
      botInstance = null;
    }

    botInstance = new QuestPlannerBot(ctx);
    botInstance.start().then(started => {
      if (started) {
        console.log('[discord-bot] Bot started successfully');
      }
    }).catch(err => {
      console.error('[discord-bot] Failed to start bot:', err.message);
    });

    // Make bot instance available to routes via app.locals
    ctx.app.locals.discordBot = botInstance;
  },

  onDisable(ctx) {
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
