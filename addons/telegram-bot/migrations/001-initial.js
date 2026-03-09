'use strict';

module.exports = {
  version: 1,
  description: 'Create telegram_bot_settings table',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_bot_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        bot_token TEXT,
        chat_id TEXT,
        public_url TEXT,
        enabled INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('INSERT OR IGNORE INTO telegram_bot_settings (id) VALUES (1)');
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS telegram_bot_settings');
  }
};
