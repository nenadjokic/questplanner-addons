'use strict';

module.exports = {
  version: 1,
  description: 'Create viber_bot_settings table',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS viber_bot_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        auth_token TEXT,
        admin_id TEXT,
        public_url TEXT,
        enabled INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('INSERT OR IGNORE INTO viber_bot_settings (id) VALUES (1)');
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS viber_bot_settings');
  }
};
